/* ==========================================================================
   /api/cles/passkeys — déverrouiller ses messages par une passkey
   (lot K, étape K2)
   ==========================================================================

   GET    → { passkeys: [ { credential_id, version, sel, enveloppe, nom,
                            cree_le, utilisee_le, synchronisee } ] }
            « synchronisee » (K3) : true si la passkey survit à la perte de
            l'appareil (trousseau iCloud, gestionnaire Google), false si
            elle est liée à l'appareil — alors ce n'est pas une sauvegarde —,
            null si on ne sait pas.
            Les miennes seulement (la règle d'accès le redit). La page s'en
            sert pour deux choses : proposer les bonnes passkeys au
            navigateur (`allowCredentials`), et ouvrir l'enveloppe après le
            geste.
   POST   { credential_id, version, sel, enveloppe, nom? }
            → enregistrer (ou remplacer) une passkey. → { ok: true }
   PATCH  { credential_id } → dire qu'elle a servi. → { ok, marquee }
   DELETE ?credential_id=… → la retirer. → { ok, retire }

   Ce que cette route NE fait pas, et n'a pas à faire : vérifier une
   signature WebAuthn. Ce n'est pas la passkey qui dit qui on est — c'est le
   cookie de session, comme partout. La passkey sert à DÉCHIFFRER : son
   secret « prf » ne quitte jamais l'authentificateur, et sans lui
   l'enveloppe ne vaut pas plus qu'une copie chiffrée par la phrase.
   Voir docs/messagerie-accessible.md, § K2.
   ========================================================================== */

import { json, identifier, commeElle, messageDe } from "../../_emploi.js";

const B64U = /^[A-Za-z0-9_-]+$/;

function tableAbsente() {
  return json({ erreur: "Les passkeys ne sont pas encore ouvertes sur ce site "
                      + "(supabase/2026_passkeys.sql).", indisponible: true }, 503);
}

/** L'identifiant d'une passkey, tel qu'on accepte de le transmettre. Sa
    longueur n'est pas normalisée (16 octets chez l'un, 64 chez l'autre) :
    on borne large, et on refuse ce qui n'est pas du base64url. */
export function credentialValide(c) {
  return typeof c === "string" && B64U.test(c) && c.length >= 16 && c.length <= 1024;
}

/** Le dépôt : la version de l'identité, le sel (32 octets) et l'enveloppe. */
export function depotValide(d) {
  if (!d || typeof d !== "object") return "Il manque l'enveloppe.";
  if (!credentialValide(d.credential_id)) return "Identifiant de passkey mal formé.";
  const v = Number(d.version);
  if (!Number.isInteger(v) || v < 1) return "Version mal formée.";
  if (typeof d.sel !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(d.sel)) return "Sel mal formé.";
  if (typeof d.enveloppe !== "string" || !B64U.test(d.enveloppe)
      || d.enveloppe.length < 40 || d.enveloppe.length > 8192) return "Enveloppe mal formée.";
  if (d.nom !== undefined && d.nom !== null
      && (typeof d.nom !== "string" || d.nom.length > 60)) return "Nom trop long.";
  if (d.synchronisee !== undefined && d.synchronisee !== null
      && typeof d.synchronisee !== "boolean") return "« synchronisee » : vrai ou faux.";
  return null;
}

const COLONNES = "credential_id,version,sel,enveloppe,nom,cree_le,utilisee_le";
const COLONNES_K3 = COLONNES + ",synchronisee";

/** Dire si une passkey est synchronisée (K3). Sans la migration K3, la
    fonction n'existe pas : ce n'est qu'une information de plus, on se tait. */
async function marquer(qui, env, credential, synchronisee) {
  if (typeof synchronisee !== "boolean") return;
  try {
    await commeElle(qui.jeton, env, "/rest/v1/rpc/marquer_passkey", {
      method: "POST", body: JSON.stringify({ credential_donne: credential, synchronisee_donnee: synchronisee }),
    });
  } catch (e) { /* rien : la passkey marche sans cette mention */ }
}


export async function onRequestGet(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  let r = await commeElle(qui.jeton, env,
    "/rest/v1/cles_privees_passkey?select=" + COLONNES_K3 + "&order=cree_le.desc");
  /* Sans la migration K3, la colonne « synchronisee » n'existe pas et
     PostgREST refuse toute la requête : on la redemande sans elle. */
  if (r.status === 400) {
    r = await commeElle(qui.jeton, env,
      "/rest/v1/cles_privees_passkey?select=" + COLONNES + "&order=cree_le.desc");
  }
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: "La base n'a pas répondu : " + ((await messageDe(r)) || "?") }, 502);
  const lignes = await r.json();
  return json({ passkeys: Array.isArray(lignes) ? lignes : [] });
}


export async function onRequestPost(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  corps = corps && typeof corps === "object" ? corps : {};
  const e = depotValide(corps);
  if (e) return json({ erreur: e }, 400);

  const r = await commeElle(qui.jeton, env, "/rest/v1/rpc/enregistrer_passkey", {
    method: "POST",
    body: JSON.stringify({
      credential_donne: corps.credential_id, version_donnee: Number(corps.version),
      sel_donne: corps.sel, enveloppe_donnee: corps.enveloppe,
      nom_donne: (typeof corps.nom === "string" && corps.nom.trim()) ? corps.nom.trim() : null,
    }),
  });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "La base a refusé." }, 400);
  if ((await r.json()) !== true) return json({ erreur: "La base n'a rien enregistré." }, 502);
  await marquer(qui, env, corps.credential_id, corps.synchronisee);
  return json({ ok: true });
}


export async function onRequestPatch(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  corps = corps && typeof corps === "object" ? corps : {};
  if (!credentialValide(corps.credential_id)) return json({ erreur: "Identifiant de passkey mal formé." }, 400);

  const r = await commeElle(qui.jeton, env, "/rest/v1/rpc/passkey_a_servi", {
    method: "POST", body: JSON.stringify({ credential_donne: corps.credential_id }),
  });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "La base a refusé." }, 400);
  /* Une passkey qu'on ne connaît pas n'est pas une erreur : la page le dit
     par « marquee: false », et rien de plus — ce n'est qu'une date. */
  const marquee = (await r.json()) === true;
  /* K3 : l'état de synchronisation peut avoir changé depuis l'enregistrement */
  if (marquee) await marquer(qui, env, corps.credential_id, corps.synchronisee);
  return json({ ok: true, marquee });
}


export async function onRequestDelete(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  const id = new URL(request.url).searchParams.get("credential_id") || "";
  if (!credentialValide(id)) return json({ erreur: "Identifiant de passkey mal formé." }, 400);
  const r = await commeElle(qui.jeton, env, "/rest/v1/rpc/retirer_passkey", {
    method: "POST", body: JSON.stringify({ credential_donne: id }),
  });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "La base a refusé." }, 400);
  return json({ ok: true, retire: (await r.json()) === true });
}
