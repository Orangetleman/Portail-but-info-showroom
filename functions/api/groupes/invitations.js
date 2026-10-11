/* ==========================================================================
   /api/groupes/invitations — répondre à une invitation
   ==========================================================================

   POST  { groupe, accepte: true|false } → { ok }

   La fonction « repondre_invitation » n'agit que sur SA propre ligne, à
   l'état « invite » ; elle renvoie si une ligne a été touchée — un « ok »
   sans ligne serait une invitation déjà traitée, ou qui n'a jamais existé.
   ========================================================================== */

import { json, identifier, commeElle, messageDe } from "../../_emploi.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


export async function onRequestPost(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  const groupe = String((corps && corps.groupe) || "");
  if (!UUID.test(groupe)) return json({ erreur: "Groupe inconnu." }, 400);
  const accepte = corps.accepte === true;

  const r = await commeElle(qui.jeton, env, "/rest/v1/rpc/repondre_invitation", {
    method: "POST", body: JSON.stringify({ g: groupe, accepte }),
  });
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "La réponse n'a pas été enregistrée." }, 400);
  const touche = await r.json();
  if (touche !== true) return json({ erreur: "Cette invitation n'existe plus." }, 404);
  return json({ ok: true, accepte });
}
