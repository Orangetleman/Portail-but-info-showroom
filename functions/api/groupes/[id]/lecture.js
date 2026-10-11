/* ==========================================================================
   /api/groupes/:id/lecture — « j'ai lu jusqu'ici »
   ==========================================================================

   POST { dernier_lu } → { ok, dernier_lu }

   La page l'appelle quand la discussion est sous les yeux de la personne
   et qu'un message plus récent que le dernier noté est affiché — pas à
   chaque message reçu, pas quand l'onglet est caché. Une ligne par membre
   et par groupe (table lectures, migration 2026_discussion.sql) : on
   insère ou on met à jour.
   ========================================================================== */

import { json, identifier, commeElle, messageDe } from "../../../_emploi.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onRequestPost(context) {
  const { request, env, params } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const id = String(params.id || "");
  if (!UUID.test(id)) return json({ erreur: "Groupe inconnu." }, 400);

  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  const dernier = Number(corps && corps.dernier_lu);
  if (!Number.isInteger(dernier) || dernier < 0 || dernier > 1e12) return json({ erreur: "Numéro invalide." }, 400);

  /* Un même appel sert d'insertion et de mise à jour : sur conflit de clé
     (groupe, membre), PostgREST fusionne. */
  const r = await commeElle(qui.jeton, env,
    "/rest/v1/lectures?on_conflict=groupe,membre&select=dernier_lu", {
      method: "POST", prefer: "resolution=merge-duplicates,return=representation",
      body: JSON.stringify({ groupe: id, membre: qui.verdict.id, dernier_lu: dernier, lu_le: new Date().toISOString() }),
    });
  if (r.status === 404) return json({ erreur: "Les lectures ne sont pas encore ouvertes (2026_discussion.sql).", indisponible: true }, 503);
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "La lecture n'a pas été notée." }, 400);
  const lignes = await r.json();
  return json({ ok: true, dernier_lu: Array.isArray(lignes) && lignes[0] ? lignes[0].dernier_lu : dernier });
}
