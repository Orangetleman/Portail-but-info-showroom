/* ==========================================================================
   La session : deux cookies, une reconduction, une marque du jour
   ==========================================================================

   Jusqu'au 11 septembre 2026, le site ne gardait QUE le jeton d'accès, dans
   un cookie d'une heure. Passé l'heure, il fallait se reconnecter : le
   serveur n'avait aucun moyen d'obtenir un jeton neuf. C'était un choix (un
   jeton de renouvellement vit longtemps, et ne pas le garder réduit ce qu'un
   vol de cookie permettrait), et il reste le comportement PAR DÉFAUT.

   « Rester connecté » est une OPTION, cochée sur le formulaire de connexion.
   Elle pose un second cookie, HttpOnly comme le premier, qui porte le jeton
   de renouvellement. Pourquoi une option et non un défaut : le site se lit
   depuis des postes partagés, remis à zéro entre deux personnes — une session
   qui survit par défaut sur une machine de salle, c'est un compte laissé
   ouvert pour le suivant. Le confort se demande ; le risque, non.

   ─── Les trois cookies ───

     fb_session          le jeton d'accès Supabase, une heure. Le seul qui
                         donne accès à quelque chose.
     fb_renouvellement   le jeton de renouvellement, 30 jours glissants,
                         SEULEMENT si la personne l'a demandé. Ne donne accès
                         à rien directement : il sert à obtenir un fb_session
                         neuf quand l'ancien est mort.
     fb_vu               une simple date, un jour. Dit « la visite du jour
                         est déjà notée », pour ne pas réécrire la base à
                         chaque page. Ne contient rien de personnel.

   ─── La reconduction ───

   Quand une requête arrive avec un fb_session mort (ou absent) mais un
   fb_renouvellement vivant, on demande à Supabase un jeton neuf. Supabase
   REMPLACE le jeton de renouvellement à chaque usage (rotation) : les deux
   cookies sont donc réécrits dans la même réponse. Si Supabase refuse — jeton
   révoqué, périmé, déjà utilisé — on efface les deux cookies et la personne
   retombe sur la connexion, une fois, proprement. Jamais de boucle : sans
   cookie de renouvellement, la requête suivante ne tente plus rien.

   La reconduction se fait CÔTÉ SERVEUR, au fil des requêtes : aucune page ne
   se recharge, aucun script n'intervient. Deux endroits l'invoquent, parce
   que ce sont les deux endroits qui vérifient un jeton : le middleware, pour
   les zones protégées, et /api/moi, que chaque page appelle.

   ─── La marque du jour (vu_le) ───

   Supabase n'écrit last_sign_in_at qu'à la connexion. Quelqu'un qui reste
   connecté un mois ne se connecte plus : sa date n'avancerait pas, et la
   purge annuelle le prendrait pour un compte mort. Le site note donc lui-même
   une visite par jour (fonction SQL marquer_vu, qui n'écrit que si la
   dernière marque a plus d'un jour). Le cookie fb_vu évite l'appel les fois
   suivantes ; il n'est posé QUE si la base a confirmé l'écriture.
   ========================================================================== */

import { verifierJeton } from "./_verifier.js";
import { lireCookie, attributDomaine, COOKIE } from "./_acces.js";

export const COOKIE_RENOUVELLEMENT = "fb_renouvellement";
export const COOKIE_VU = "fb_vu";

/* Le jeton d'accès vit une heure chez Supabase : le cookie ne lui survit
   pas. Trente jours glissants pour le renouvellement : réécrit à chaque
   reconduction, il ne meurt que si l'on ne vient plus pendant un mois. */
export const DUREE_SESSION_S = 60 * 60;
export const DUREE_RENOUVELLEMENT_S = 30 * 24 * 60 * 60;
export const DUREE_VU_S = 24 * 60 * 60;


/** Un cookie HttpOnly du site. Durée 0 = effacement (mêmes attributs que la
    pose, sinon le navigateur ne le reconnaît pas et le garde). */
export function cookieHttpOnly(nom, valeur, dureeSecondes, domaine) {
  return [
    nom + "=" + encodeURIComponent(valeur || ""),
    "Path=/",
    attributDomaine(domaine),
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=" + dureeSecondes,
  ].filter(Boolean).join("; ");
}

export function cookieSession(jeton, domaine) {
  return cookieHttpOnly(COOKIE, jeton, DUREE_SESSION_S, domaine);
}

export function cookieRenouvellement(jeton, domaine) {
  return cookieHttpOnly(COOKIE_RENOUVELLEMENT, jeton, DUREE_RENOUVELLEMENT_S, domaine);
}

/** Les trois cookies, effacés. C'est la déconnexion, et c'est aussi ce
    qu'on renvoie quand Supabase refuse une reconduction. */
export function cookiesEffaces(domaine) {
  return [
    cookieHttpOnly(COOKIE, "", 0, domaine),
    cookieHttpOnly(COOKIE_RENOUVELLEMENT, "", 0, domaine),
    cookieHttpOnly(COOKIE_VU, "", 0, domaine),
  ];
}


/** Ajoute des Set-Cookie à une réponse — y compris une redirection, qui est
    immuable telle que Response.redirect la fabrique. */
export function avecCookies(reponse, cookies) {
  if (!cookies || !cookies.length) return reponse;
  const copie = new Response(reponse.body, reponse);
  for (const c of cookies) copie.headers.append("Set-Cookie", c);
  return copie;
}


/** La même requête, avec un cookie remplacé : ce que voit le gestionnaire
    en aval après une reconduction. Sans cela, /api/compte lirait encore le
    jeton mort dans l'en-tête Cookie de la requête d'origine. */
export function requeteAvecCookie(request, nom, valeur) {
  const brut = request.headers.get("Cookie") || "";
  const autres = brut.split(";").map((m) => m.trim())
    .filter((m) => m && m.split("=")[0] !== nom);
  autres.push(nom + "=" + encodeURIComponent(valeur));
  const entetes = new Headers(request.headers);
  entetes.set("Cookie", autres.join("; "));
  return new Request(request, { headers: entetes });
}


/** Demande un jeton neuf à Supabase. Renvoie { ok, access_token,
    refresh_token } ou { ok:false, definitif } — « definitif » quand Supabase
    a REFUSÉ le jeton (il faut effacer le cookie), par opposition à une base
    injoignable (on ne touche à rien : la personne réessaiera). */
async function reconduireAupresDeSupabase(renouvellement, env) {
  let r;
  try {
    r = await fetch(env.SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: {
        "apikey": env.SUPABASE_ANON_KEY || "",
        "content-type": "application/json",
      },
      body: JSON.stringify({ refresh_token: renouvellement }),
    });
  } catch (err) {
    return { ok: false, definitif: false };
  }
  let d = null;
  try { d = await r.json(); } catch (err) { /* corps vide */ }
  if (r.ok && d && d.access_token && d.refresh_token) {
    return { ok: true, access_token: d.access_token, refresh_token: d.refresh_token };
  }
  /* 400/401/403 : Supabase a lu le jeton et l'a refusé. Le reste (5xx,
     réponse illisible) est une panne, pas un verdict. */
  return { ok: false, definitif: r.status >= 400 && r.status < 500 };
}


/** L'état de session d'une requête, reconduction comprise.

    Renvoie { verdict, jeton, cookies, requete } :
      - verdict  : ce que dit verifierJeton du jeton retenu ;
      - jeton    : le jeton d'accès valide, ou null ;
      - cookies  : les Set-Cookie à joindre à la réponse (vides s'il ne
                   s'est rien passé) ;
      - requete  : la requête à passer en aval — réécrite si le jeton a
                   changé, la même sinon.

    Le chemin ordinaire (jeton valide) ne coûte rien de plus qu'avant : une
    signature à vérifier. Seul un jeton mort avec un cookie de renouvellement
    paie un aller et retour vers Supabase — au plus une fois par heure. */
export async function sessionDe(request, env) {
  const domaine = env.DOMAINE_COOKIE;
  let jeton = lireCookie(request, COOKIE);
  let verdict = await verifierJeton(jeton, env);
  if (verdict.ok) return { verdict, jeton, cookies: [], requete: request };

  const renouvellement = lireCookie(request, COOKIE_RENOUVELLEMENT);
  if (!renouvellement || !env.SUPABASE_URL) {
    return { verdict, jeton: null, cookies: [], requete: request };
  }

  const neuf = await reconduireAupresDeSupabase(renouvellement, env);
  if (!neuf.ok) {
    /* Refus franc : on efface, et la personne repasse par la connexion une
       fois. Panne : on ne touche pas aux cookies, le prochain essai verra. */
    return {
      verdict,
      jeton: null,
      cookies: neuf.definitif ? cookiesEffaces(domaine) : [],
      requete: request,
    };
  }

  /* On ne pose JAMAIS un cookie sur la seule foi d'une réponse : le jeton
     neuf est vérifié comme n'importe quel autre, signature comprise. */
  const verdictNeuf = await verifierJeton(neuf.access_token, env);
  if (!verdictNeuf.ok) {
    return { verdict, jeton: null, cookies: cookiesEffaces(domaine), requete: request };
  }

  return {
    verdict: verdictNeuf,
    jeton: neuf.access_token,
    cookies: [
      cookieSession(neuf.access_token, domaine),
      cookieRenouvellement(neuf.refresh_token, domaine),
    ],
    requete: requeteAvecCookie(request, COOKIE, neuf.access_token),
  };
}


/** Note la visite du jour, si ce n'est pas déjà fait.

    Renvoie le Set-Cookie fb_vu à joindre, ou null. Le cookie n'est posé que
    si la base a répondu : « true » (elle a écrit) ou « false » (elle avait
    déjà la marque du jour — quelqu'un d'autre l'a posée, un autre appareil,
    un autre navigateur). Une base injoignable ne pose rien : on réessaiera
    à la page suivante, plutôt que de croire une visite notée qui ne l'est
    pas. */
export async function marquerVu(request, jeton, env) {
  if (!jeton || !env.SUPABASE_URL) return null;
  if (lireCookie(request, COOKIE_VU)) return null;     // déjà fait aujourd'hui

  let r;
  try {
    r = await fetch(env.SUPABASE_URL + "/rest/v1/rpc/marquer_vu", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + jeton,
        "apikey": env.SUPABASE_ANON_KEY || "",
        "content-type": "application/json",
        "Accept": "application/json",
      },
      body: "{}",
    });
  } catch (err) {
    return null;
  }
  /* 404 : la fonction n'est pas installée (2026_derniere_activite.sql). On
     ne pose pas le cookie non plus : le jour où elle le sera, la page
     suivante écrira. Le diagnostic, lui, le signale. */
  if (!r.ok) return null;

  const jour = new Date().toISOString().slice(0, 10);
  return cookieHttpOnly(COOKIE_VU, jour, DUREE_VU_S, env.DOMAINE_COOKIE);
}


/** Révoque la session courante chez Supabase (le jeton de renouvellement
    qui va avec ne pourra plus servir), puis efface les cookies. Si le jeton
    d'accès est mort, on le reconduit d'abord : il faut un jeton vivant pour
    dire à Supabase lequel révoquer. Quoi qu'il arrive, les cookies partent.

    « scope=local » : cette session-ci, pas celles des autres appareils —
    se déconnecter d'un poste de salle ne doit pas déconnecter son téléphone. */
export async function fermerSession(request, env) {
  const etat = await sessionDe(request, env);
  if (etat.jeton && env.SUPABASE_URL) {
    try {
      await fetch(env.SUPABASE_URL + "/auth/v1/logout?scope=local", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + etat.jeton,
          "apikey": env.SUPABASE_ANON_KEY || "",
        },
      });
    } catch (err) { /* la révocation a échoué : les cookies partent quand même */ }
  }
  return cookiesEffaces(env.DOMAINE_COOKIE);
}
