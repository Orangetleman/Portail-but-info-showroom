/* ==========================================================================
   /api/session — pose et retire le cookie de session
   ==========================================================================

   Pourquoi passer par le serveur pour poser un cookie, alors que le navigateur
   sait le faire tout seul ?

   Parce qu'un cookie posé en JavaScript est lisible en JavaScript. Ici, le
   cookie est marqué HttpOnly : le navigateur l'envoie à chaque requête, mais
   aucun script de la page ne peut le lire. Si une faille permettait un jour
   d'injecter du script dans le site, la session ne serait pas volable pour
   autant.

   Le jeton est revérifié ici avant d'être accepté : on ne pose jamais un
   cookie sur la seule foi de ce que le navigateur affirme.

   Depuis l'ouverture du site au public, c'est la seule porte : le mot de
   passe commun n'existait que pour restreindre l'accès à l'université.

   Depuis le 11 septembre 2026, « rester connecté » (voir _session.js) : si
   la personne l'a coché ET que le navigateur transmet le jeton de
   renouvellement, un second cookie HttpOnly le garde trente jours. Sans la
   case, rien ne change : une heure, puis on se reconnecte.
   ========================================================================== */

import { verifierJeton } from "../_verifier.js";
import { cookieSession, cookieRenouvellement, fermerSession } from "../_session.js";


/** POST : le navigateur vient de se connecter et transmet son jeton. */
export async function onRequestPost(context) {
  const { request, env } = context;

  let corps;
  try {
    corps = await request.json();
  } catch (err) {
    return refus("requête illisible", 400);
  }

  const verdict = await verifierJeton(corps && corps.access_token, env);
  if (!verdict.ok) {
    /* Le visiteur n'apprend pas ce qui a échoué ; le journal, si. */
    console.log("session refusée :", verdict.raison);
    return refus("connexion refusée", 401);
  }

  const entetes = new Headers({
    "content-type": "application/json",
    "Cache-Control": "no-store",
  });
  entetes.append("Set-Cookie", cookieSession(corps.access_token, env.DOMAINE_COOKIE));

  /* Le second cookie ne se pose que sur demande EXPLICITE (rester: true) et
     si un jeton de renouvellement est fourni. Un client qui enverrait le
     jeton sans la case n'obtient qu'une heure, comme avant. */
  const rester = corps.rester === true && typeof corps.refresh_token === "string"
                 && corps.refresh_token.length > 0;
  if (rester) {
    entetes.append("Set-Cookie", cookieRenouvellement(corps.refresh_token, env.DOMAINE_COOKIE));
  }

  return new Response(JSON.stringify({ ok: true, email: verdict.email, rester }), {
    status: 200,
    headers: entetes,
  });
}


/** DELETE : déconnexion. La session est révoquée chez Supabase (le jeton de
    renouvellement de cet appareil ne pourra plus servir), puis les trois
    cookies sont effacés en les faisant expirer.

    Le domaine doit être RÉPÉTÉ (dans _session.js) : un cookie ne s'efface
    qu'avec les mêmes attributs que ceux qui l'ont posé. L'oublier laisserait
    la session en place, et la déconnexion serait un bouton qui ne fait rien. */
export async function onRequestDelete(context) {
  const cookies = await fermerSession(context.request, context.env);
  const entetes = new Headers({
    "content-type": "application/json",
    "Cache-Control": "no-store",
  });
  for (const c of cookies) entetes.append("Set-Cookie", c);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: entetes });
}


function refus(message, code) {
  return new Response(JSON.stringify({ erreur: message }), {
    status: code,
    headers: { "content-type": "application/json", "Cache-Control": "no-store" },
  });
}
