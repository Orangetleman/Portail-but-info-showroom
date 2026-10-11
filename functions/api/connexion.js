/* ==========================================================================
   /api/connexion — se connecter avec son adresse OU son pseudo
   ==========================================================================

   Supabase authentifie sur une adresse de courriel, et sur rien d'autre.
   Accepter un pseudo suppose donc de traduire l'un en l'autre — et c'est
   précisément la traduction qu'il ne faut pas ouvrir : elle transforme un
   pseudo, qui est public, en adresse, qui ne l'est pas.

   Elle se fait donc ici, sur le serveur, avec la clé « service_role » qui ne
   vit que dans les variables d'environnement de Cloudflare. L'adresse ne
   remonte jamais au navigateur : elle sert sur place à demander un jeton, et
   c'est le jeton qui repart. Le navigateur, lui, n'a envoyé qu'un identifiant
   et un mot de passe, et ne saura jamais lequel des deux il a utilisé.

   Un pseudo EST un identifiant, au sens plein : sa valeur est unique (index
   unique insensible à la casse) et sa liaison à un compte est stable. C'est
   ce qui autorise à s'en servir pour se connecter.

   ---------------------------------------------------------------------------
   Une seule réponse pour tous les échecs
   ---------------------------------------------------------------------------
   Pseudo inconnu, adresse inconnue, mot de passe faux : même message, même
   code. Distinguer « ce pseudo n'existe pas » de « mot de passe incorrect »
   offrirait un annuaire : on essaie des pseudos jusqu'à ce que le message
   change, et l'on sait qui a un compte ici. Le confort d'un message précis ne
   vaut pas ça.
   ========================================================================== */

function json(donnees, code) {
  return new Response(JSON.stringify(donnees), {
    status: code || 200,
    headers: { "content-type": "application/json", "Cache-Control": "private, no-store" },
  });
}


/* Le même refus, quelle qu'en soit la cause. */
function refus() {
  return json({
    erreur: "Identifiant ou mot de passe incorrect.",
  }, 401);
}


/** L'adresse derrière un pseudo, ou null. Ne sort jamais de cette fonction. */
async function adresseDuPseudo(pseudo, env) {
  const r = await fetch(env.SUPABASE_URL + "/rest/v1/rpc/courriel_du_pseudo", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + env.SUPABASE_SERVICE_ROLE,
      "apikey": env.SUPABASE_SERVICE_ROLE,
      "content-type": "application/json",
    },
    body: JSON.stringify({ candidat: pseudo }),
  });
  if (!r.ok) return null;
  try {
    const v = await r.json();
    return typeof v === "string" && v ? v : null;
  } catch (err) {
    return null;
  }
}


export async function onRequestPost(context) {
  const { request, env } = context;

  let corps;
  try {
    corps = await request.json();
  } catch (err) {
    return json({ erreur: "requête illisible" }, 400);
  }

  const identifiant = String((corps && corps.identifiant) || "").trim();
  const motDePasse = String((corps && corps.mot_de_passe) || "");
  if (!identifiant || !motDePasse) return refus();

  /* Une arobase tranche : c'est une adresse. Sans arobase, c'est un pseudo —
     la forme des pseudos (lettres, chiffres, tiret, souligné) exclut l'@, les
     deux ensembles ne se recouvrent donc jamais. */
  let adresse = identifiant;
  if (identifiant.indexOf("@") === -1) {
    if (!env.SUPABASE_SERVICE_ROLE) {
      /* Sans la clé, on ne peut pas traduire. Le dire franchement plutôt que
         de renvoyer un refus qui ferait douter la personne de son mot de
         passe : ici c'est le site qui est mal configuré, pas elle. */
      return json({
        erreur: "La connexion par pseudo n'est pas disponible. "
              + "Utilise ton adresse de courriel.",
      }, 503);
    }
    adresse = await adresseDuPseudo(identifiant, env);
    if (!adresse) return refus();
  }

  const r = await fetch(env.SUPABASE_URL + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: {
      "apikey": env.SUPABASE_ANON_KEY || "",
      "content-type": "application/json",
    },
    body: JSON.stringify({ email: adresse, password: motDePasse }),
  });

  let donnees = null;
  try { donnees = await r.json(); } catch (err) { /* corps vide */ }

  if (!r.ok || !donnees || !donnees.access_token) {
    /* Une adresse non confirmée mérite son propre message : la personne a le
       bon mot de passe, et l'envoyer chercher une faute qui n'existe pas la
       ferait tourner en rond. Ce cas ne révèle rien qu'elle ne sache déjà. */
    const code = donnees && (donnees.error_code || donnees.error);
    if (code === "email_not_confirmed") {
      return json({
        erreur: "Ton adresse n'est pas encore confirmée. Ouvre le courriel "
              + "qui t'a été envoyé, et pense aux indésirables.",
      }, 401);
    }
    return refus();
  }

  /* Les jetons repartent vers le navigateur, qui les rend aussitôt à
     /api/session : c'est là, et là seulement, qu'ils deviennent des cookies
     HttpOnly. Le jeton de renouvellement n'y sera gardé que si la personne a
     coché « rester connecté » ; sinon le navigateur l'oublie avec la page. */
  return json({
    ok: true,
    access_token: donnees.access_token,
    refresh_token: donnees.refresh_token || null,
  });
}
