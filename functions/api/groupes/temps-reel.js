/* ==========================================================================
   /api/groupes/temps-reel — le jeton, pour parler directement à Supabase
   ==========================================================================

   GET → { jeton, expire_le }

   La page d'un groupe ouvre une connexion Realtime (WebSocket) directement
   avec Supabase, pour recevoir les messages sans repasser par ici. Cette
   connexion s'authentifie avec le jeton de la personne — celui que le site
   garde dans un cookie HttpOnly, que la page ne peut pas lire. On le lui
   remet donc, à elle seule, sur demande.

   Ce que cela change, à savoir : le jeton devient lisible par le script de
   la page. Un script hostile injecté dans le site (XSS) pourrait donc le
   prendre. Mais ce même script pourrait déjà appeler toutes les routes
   /api/ avec le cookie : le jeton ne lui donnerait rien de plus que ce que
   le cookie lui donne, pendant la même heure. La protection réelle reste
   l'absence de tout script tiers sur le site.

   Le middleware a déjà garanti un compte (zone « connecte ») et reconduit
   la session si elle avait expiré : le cookie lu ici est à jour.
   ========================================================================== */

import { json, identifier } from "../../_emploi.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  /* L'échéance est dans le jeton lui-même (exp, en secondes). La page
     s'en sert pour redemander un jeton neuf avant la coupure. */
  let expire = null;
  try {
    const corps = JSON.parse(atob(qui.jeton.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (corps && corps.exp) expire = new Date(corps.exp * 1000).toISOString();
  } catch (err) { /* un jeton sans échéance lisible : la page fera sans */ }

  return new Response(JSON.stringify({ jeton: qui.jeton, expire_le: expire }), {
    status: 200,
    headers: { "content-type": "application/json", "Cache-Control": "private, no-store" },
  });
}
