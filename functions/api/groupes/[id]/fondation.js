/* ==========================================================================
   /api/groupes/:id/fondation — transférer la fondation du groupe
   ==========================================================================

   POST { membre } → { ok, pseudo }   la fondation passe à ce membre accepté

   Fondateur seulement : c'est la fonction SQL transferer_fondation
   (supabase/2026_roles_groupe.sql) qui le vérifie, avec le jeton de la
   personne. Le nouveau fondateur devient administrateur sans personne
   au-dessus ; l'ancien reste administrateur, nommé par le nouveau. La
   route ne fait que transmettre, et rendre le pseudo relu.
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
  const membre = String((corps && corps.membre) || "");
  if (!UUID.test(membre)) return json({ erreur: "Membre inconnu." }, 400);
  if (membre === qui.verdict.id) return json({ erreur: "Tu es déjà le fondateur." }, 400);

  const r = await commeElle(qui.jeton, env, "/rest/v1/rpc/transferer_fondation", {
    method: "POST", body: JSON.stringify({ g: id, cible: membre }),
  });
  if (r.status === 404) {
    return json({ erreur: "Les rôles de groupe ne sont pas encore ouverts sur ce site (supabase/2026_roles_groupe.sql).", indisponible: true }, 503);
  }
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "Le transfert a échoué." }, 400);
  const pseudo = await r.json();
  if (!pseudo) return json({ erreur: "La base n'a rien écrit." }, 502);
  return json({ ok: true, pseudo: pseudo });
}
