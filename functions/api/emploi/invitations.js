/* ==========================================================================
   /api/emploi/invitations — proposer un événement à ses contacts, répondre
   ==========================================================================

   GET     → { recues: [ { id, etat, cree_le, de_pseudo, evenement, type,
                           titre, debut, fin, journee, details } ] }
             (mes invitations reçues, en attente d'abord)
   POST    { evenement, vers: [ <uuid>, … ] } → { ok, envoyees, refusees: [ … ] }
             (un événement À MOI, à un ou plusieurs CONTACTS)
   PATCH   { id, accepte: true | false } → { ok, etat, copie? }
             (accepter copie l'événement chez moi : `copie` = son id)
   DELETE  ?id=<uuid> → { ok }

   Décision 4 de la feuille de route : un événement partagé se pose chez
   les contacts choisis, qui l'acceptent d'un clic depuis leur emploi du
   temps. Les règles sont dans la base (supabase/2026_contacts.sql) : la
   règle d'insertion refuse un destinataire qui n'est pas un contact ou un
   événement qui n'est pas le mien ; répondre passe par la fonction
   `repondre_invitation_evenement`, qui copie. Chaque écriture est relue :
   un POST rend la liste de ce qui n'a PAS pu partir.
   ========================================================================== */

import { json, identifier, commeElle, messageDe } from "../../_emploi.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DESTINATAIRES = 20;

function tableAbsente() {
  return json({ erreur: "Les invitations ne sont pas encore ouvertes sur ce site (supabase/2026_contacts.sql).",
                indisponible: true }, 503);
}


export async function onRequestGet(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const r = await commeElle(qui.jeton, env, "/rest/v1/rpc/mes_invitations_evenement", {
    method: "POST", body: "{}",
  });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: "La base n'a pas répondu : " + ((await messageDe(r)) || r.status) }, 502);
  const lignes = await r.json();
  const recues = (Array.isArray(lignes) ? lignes : []).sort((a, b) => {
    if ((a.etat === "en_attente") !== (b.etat === "en_attente")) return a.etat === "en_attente" ? -1 : 1;
    return String(b.cree_le).localeCompare(String(a.cree_le));
  });
  return json({ recues });
}


export async function onRequestPost(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  const evenement = String((corps && corps.evenement) || "");
  if (!UUID.test(evenement)) return json({ erreur: "Événement inconnu." }, 400);
  const vers = Array.isArray(corps.vers) ? corps.vers.map((v) => String(v || "")) : [];
  const propres = vers.filter((v, i) => UUID.test(v) && vers.indexOf(v) === i && v !== qui.verdict.id);
  if (!propres.length) return json({ erreur: "Il faut au moins un destinataire." }, 400);
  if (propres.length > MAX_DESTINATAIRES) return json({ erreur: MAX_DESTINATAIRES + " destinataires au plus." }, 400);

  /* Une ligne par destinataire, une écriture chacune : la base refuse
     celle qui vise un non-contact (42501) sans emporter les autres, et on
     dit lesquelles. */
  const envoyees = [], refusees = [];
  for (const v of propres) {
    const r = await commeElle(qui.jeton, env, "/rest/v1/invitations_evenement?select=id,vers", {
      method: "POST", prefer: "return=representation",
      body: JSON.stringify({ evenement, de: qui.verdict.id, vers: v }),
    });
    if (r.status === 404) return tableAbsente();
    if (r.ok) {
      const l = await r.json();
      if (Array.isArray(l) && l.length === 1) envoyees.push({ id: l[0].id, vers: v });
      else refusees.push({ vers: v, raison: "rien n'a été écrit" });
    } else {
      const m = (await messageDe(r)) || "";
      refusees.push({ vers: v, raison: /409|duplicate|unique/i.test(m + r.status) ? "déjà invité"
                                     : (/42501/.test(m) ? "pas un contact, ou pas ton événement" : (m || "refusé")) });
    }
  }
  return json({ ok: envoyees.length > 0, envoyees: envoyees.length, refusees }, envoyees.length ? 201 : 400);
}


export async function onRequestPatch(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  const id = String((corps && corps.id) || "");
  if (!UUID.test(id)) return json({ erreur: "Invitation inconnue." }, 400);
  const accepte = corps.accepte === true;
  const r = await commeElle(qui.jeton, env, "/rest/v1/rpc/repondre_invitation_evenement", {
    method: "POST", body: JSON.stringify({ inv: id, accepte }),
  });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "La réponse n'a pas été enregistrée." }, 400);
  const copie = await r.json();
  return json({ ok: true, etat: accepte ? "acceptee" : "refusee", copie: accepte ? copie : null });
}


export async function onRequestDelete(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!UUID.test(id)) return json({ erreur: "Invitation inconnue." }, 400);
  const r = await commeElle(qui.jeton, env, "/rest/v1/invitations_evenement?id=eq." + id + "&select=id", {
    method: "DELETE", prefer: "return=representation",
  });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "Le retrait a échoué." }, 400);
  const lignes = await r.json();
  if (!Array.isArray(lignes) || lignes.length !== 1) return json({ erreur: "Cette invitation n'existe pas, ou n'est pas la tienne." }, 404);
  return json({ ok: true });
}
