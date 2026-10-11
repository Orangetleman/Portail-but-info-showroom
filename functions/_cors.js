/* ==========================================================================
   Qui a le droit de nous interroger depuis une autre adresse
   ==========================================================================

   Un navigateur interdit par défaut à une page de lire la réponse d'un autre
   site. C'est la règle qui empêche n'importe quelle page ouverte dans un
   onglet d'aller lire tes données ailleurs. Pour qu'un outil hébergé sur
   « outils.exemple.fr » puisse interroger ce site-ci, il faut donc
   l'autoriser explicitement, origine par origine.

   La règle retenue : sont autorisés le domaine lui-même et ses sous-domaines,
   en HTTPS uniquement. Rien d'autre. On ne renvoie JAMAIS « * » : une
   autorisation ouverte est incompatible avec l'envoi du cookie de session,
   et de toute façon on ne veut pas que n'importe quel site puisse lire la
   liste des fiches.

   DOMAINE_COOKIE est la variable qui porte le domaine parent (par exemple
   « exemple.fr »). Tant qu'elle est absente, aucune origine tierce
   n'est autorisée — l'état par défaut est donc le plus fermé.
   ========================================================================== */

/** Renvoie l'origine à autoriser, ou null si la demande ne vient pas de chez nous. */
export function origineAutorisee(requete, env) {
  const origine = requete.headers.get("Origin");
  const parent = env.DOMAINE_COOKIE;
  if (!origine || !parent) return null;

  let hote;
  try {
    const u = new URL(origine);
    if (u.protocol !== "https:") return null;
    hote = u.hostname;
  } catch (err) {
    return null;
  }

  /* Le domaine lui-même, ou un de ses sous-domaines. Le point est capital :
     sans lui, « mechant-exemple.fr » passerait le test. */
  if (hote === parent || hote.endsWith("." + parent)) return origine;
  return null;
}


/** Pose les en-têtes d'autorisation sur une réponse déjà construite. */
export function avecCors(reponse, origine) {
  if (!origine) return reponse;
  const copie = new Response(reponse.body, reponse);
  copie.headers.set("Access-Control-Allow-Origin", origine);
  copie.headers.set("Access-Control-Allow-Credentials", "true");
  /* Deux origines différentes peuvent recevoir deux réponses différentes :
     il faut le dire aux caches, sinon l'une reçoit la réponse de l'autre. */
  copie.headers.append("Vary", "Origin");
  return copie;
}


/** Réponse à la question préalable que pose le navigateur (requête OPTIONS). */
export function reponsePrealable(origine) {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origine,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    },
  });
}
