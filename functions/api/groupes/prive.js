/* ==========================================================================
   /api/groupes/prive — ouvrir une conversation privée avec un contact
   ==========================================================================

   POST  { avec: <uuid du contact> } → { ok, id }
         L'identifiant de la conversation existante entre nous deux, ou
         d'une nouvelle. C'est un groupe (groupes.prive = true) : la page
         est /groupes/groupe.html?id=… comme pour tout groupe, et tout ce
         qui s'y fait passe par les routes des groupes.

   Aucun pouvoir propre : la fonction SQL ouvrir_conversation
   (supabase/2026_messagerie_privee.sql) vérifie elle-même que la personne
   est connectée, a un pseudo, et que l'autre est un CONTACT (décision 4 :
   on n'écrit en privé qu'à quelqu'un qui a accepté). Son message d'erreur
   est celui qu'on affiche. 404 de PostgREST = la migration n'est pas
   passée : on le dit, plutôt qu'un « échec » muet.
   ========================================================================== */

import { json, identifier, commeElle, messageDe } from "../../_emploi.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


export async function onRequestPost(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  const avec = String((corps && corps.avec) || "");
  if (!UUID.test(avec)) return json({ erreur: "Choisis un contact à qui écrire." }, 400);
  if (avec.toLowerCase() === String(qui.verdict.id).toLowerCase()) return json({ erreur: "C'est toi." }, 400);

  const r = await commeElle(qui.jeton, env, "/rest/v1/rpc/ouvrir_conversation", {
    method: "POST", body: JSON.stringify({ avec }),
  });
  if (r.status === 404) {
    return json({ erreur: "La messagerie privée n'est pas encore ouverte sur ce site "
                        + "(supabase/2026_messagerie_privee.sql).", indisponible: true }, 503);
  }
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "La conversation n'a pas pu être ouverte." }, 400);
  const id = await r.json();
  if (!id || !UUID.test(String(id))) return json({ erreur: "La base n'a rien rendu." }, 502);
  return json({ ok: true, id });
}
