/* ==========================================================================
   /api/groupes/rejoindre — ce que vaut un lien d'invitation, et rejoindre
   ==========================================================================

   GET  ?code=…   → { valide, raison?, groupe: { id, nom, description,
                      membres }, invite_par, deja }   (fonction infos_lien)
   POST { code }  → { ok, id }                        (rejoindre_par_lien)

   Il faut un compte (le middleware y veille, la base recommence). La page
   /groupes/rejoindre.html enchaîne les deux : elle montre le groupe, puis
   un bouton.
   ========================================================================== */

import { json, identifier, commeElle, messageDe } from "../../_emploi.js";

const CODE = /^[A-Za-z0-9_-]{8,64}$/;

function tableAbsente() {
  return json({ erreur: "Les liens d'invitation ne sont pas encore ouverts (supabase/2026_liens_invitation.sql).", indisponible: true }, 503);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const code = new URL(request.url).searchParams.get("code") || "";
  if (!CODE.test(code)) return json({ valide: false, raison: "inconnu" });

  const r = await commeElle(qui.jeton, env, "/rest/v1/rpc/infos_lien", {
    method: "POST", body: JSON.stringify({ code_lien: code }),
  });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "La base n'a pas répondu." }, 502);
  return json(await r.json());
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  const code = String((corps && corps.code) || "");
  if (!CODE.test(code)) return json({ erreur: "Ce lien n'est pas valable." }, 400);

  const r = await commeElle(qui.jeton, env, "/rest/v1/rpc/rejoindre_par_lien", {
    method: "POST", body: JSON.stringify({ code_lien: code }),
  });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "Impossible de rejoindre." }, 400);
  const id = await r.json();
  return json({ ok: true, id });
}
