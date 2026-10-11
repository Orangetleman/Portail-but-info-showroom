/* ==========================================================================
   /api/emploi/:id — modifier ou supprimer UN événement
   ==========================================================================

   PATCH  { titre?, debut?, fin?, journee?, fait?, details?, type? } → la
          ligne modifiée. Ce qui n'est pas envoyé ne change pas.
   DELETE → { ok: true }.

   Le point qui compte (conception § 7 bis, piège n° 2) : un PATCH ou un DELETE
   qui ne trouve aucune ligne réussit sans rien faire. On demande donc à la
   base de RENVOYER ce qu'elle a touché, et on refuse d'annoncer un succès
   sans une ligne dans la réponse. « Aucune ligne » veut dire : pas à toi,
   ou déjà partie — et dans les deux cas, 404.
   ========================================================================== */

import { json, identifier, commeElle, messageDe, normaliserEvenement,
         tableAbsente, COLONNES, COLONNES_SANS_RAPPELS, colonneInconnue } from "../../_emploi.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


export async function onRequestPatch(context) {
  const { request, env, params } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  const id = String(params.id || "");
  if (!UUID.test(id)) return json({ erreur: "Événement inconnu." }, 400);

  let corps;
  try {
    corps = await request.json();
  } catch (err) {
    return json({ erreur: "requête illisible" }, 400);
  }
  const v = normaliserEvenement(corps, true);
  if (!v.ok) return json({ erreur: v.erreur }, 400);

  let r = await commeElle(qui.jeton, env,
    "/rest/v1/evenements?id=eq." + id + "&select=" + COLONNES, {
      method: "PATCH",
      prefer: "return=representation",
      body: JSON.stringify(v.ligne),
    });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) {
    const detail = await messageDe(r);
    if (colonneInconnue(r.status, detail) !== "rappels") return json({ erreur: detail || "La modification a échoué." }, 400);
    delete v.ligne.rappels;
    if (!Object.keys(v.ligne).length) return json({ erreur: "Les rappels ne sont pas encore ouverts sur ce site (supabase/2026_notifications.sql)." }, 503);
    r = await commeElle(qui.jeton, env,
      "/rest/v1/evenements?id=eq." + id + "&select=" + COLONNES_SANS_RAPPELS, {
        method: "PATCH", prefer: "return=representation", body: JSON.stringify(v.ligne),
      });
    if (!r.ok) return json({ erreur: (await messageDe(r)) || "La modification a échoué." }, 400);
  }
  const lignes = await r.json();
  if (!Array.isArray(lignes) || lignes.length !== 1) {
    return json({ erreur: "Cet événement n'existe pas, ou n'est pas à toi." }, 404);
  }
  return json({ ok: true, evenement: lignes[0] });
}


export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  const id = String(params.id || "");
  if (!UUID.test(id)) return json({ erreur: "Événement inconnu." }, 400);

  const r = await commeElle(qui.jeton, env,
    "/rest/v1/evenements?id=eq." + id + "&select=id", {
      method: "DELETE",
      prefer: "return=representation",
    });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: "La suppression a échoué." }, 400);
  const lignes = await r.json();
  if (!Array.isArray(lignes) || lignes.length !== 1) {
    return json({ erreur: "Cet événement n'existe pas, ou n'est pas à toi." }, 404);
  }
  return json({ ok: true });
}
