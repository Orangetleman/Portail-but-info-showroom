/* ==========================================================================
   /api/cles/transfert — lier un appareil depuis un appareil déjà ouvert
   (lot K, étape K1)
   ==========================================================================

   POST   { publique: { kty, crv, x, y }, empreinte }
            → le NOUVEL appareil ouvre un transfert : sa clé publique
              éphémère et son empreinte. → { ok, id, code, expire_le }
   GET    → mes transferts en cours (le nouvel appareil attend l'enveloppe,
            l'appareil déjà ouvert cherche celui qu'on lui annonce) ;
            ?id=<uuid> ou ?code=<6 chiffres> pour n'en vouloir qu'un.
            → { transferts: [ { id, code, publique_ephemere, empreinte,
                                version, sel, enveloppe, cree_le, expire_le } ] }
   PATCH  { id, version, sel, enveloppe }
            → l'appareil DÉJÀ OUVERT dépose la clé privée enveloppée pour
              la publique éphémère de l'autre. Une seule fois. → { ok: true }
   DELETE ?id=<uuid> → retirer un transfert (servi, ou abandonné).

   La route ne chiffre ni ne déchiffre, et ne peut pas : l'enveloppe ne
   s'ouvre qu'avec la privée éphémère, qui ne quitte jamais le nouvel
   appareil. Elle vérifie des formes, la base recommence, et c'est
   l'EMPREINTE comparée par la personne — des deux côtés, avant de
   déposer — qui empêche qu'on se fasse envoyer la clé en substituant une
   publique. Voir docs/messagerie-accessible.md, § K1.
   ========================================================================== */

import { json, identifier, commeElle, messageDe } from "../../_emploi.js";

const B64U = /^[A-Za-z0-9_-]+$/;
const EMPREINTE = /^(\d{5} ){11}\d{5}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[0-9]{6}$/;

function tableAbsente() {
  return json({ erreur: "Lier un appareil n'est pas encore ouvert sur ce site "
                      + "(supabase/2026_transferts_cles.sql).", indisponible: true }, 503);
}

/** La clé publique éphémère telle qu'on accepte de la transmettre ; une
    chaîne d'erreur sinon. La même forme qu'une clé d'identité — c'est une
    clé publique P-256, et rien de plus : surtout pas de champ « d ». */
export function ephemereValide(c) {
  if (!c || typeof c !== "object" || c.kty !== "EC" || c.crv !== "P-256"
      || typeof c.x !== "string" || typeof c.y !== "string"
      || !/^[A-Za-z0-9_-]{43}$/.test(c.x) || !/^[A-Za-z0-9_-]{43}$/.test(c.y)
      || Object.keys(c).some((k) => !["kty", "crv", "x", "y"].includes(k))) return "Clé éphémère mal formée.";
  return null;
}

/** Le dépôt : le sel (32 octets) et l'enveloppe. */
export function depotValide(d) {
  if (!d || typeof d !== "object") return "Il manque l'enveloppe.";
  if (typeof d.id !== "string" || !UUID.test(d.id)) return "Transfert inconnu.";
  const v = Number(d.version);
  if (!Number.isInteger(v) || v < 1) return "Version mal formée.";
  if (typeof d.sel !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(d.sel)) return "Sel mal formé.";
  if (typeof d.enveloppe !== "string" || !B64U.test(d.enveloppe)
      || d.enveloppe.length < 40 || d.enveloppe.length > 8192) return "Enveloppe mal formée.";
  return null;
}

const COLONNES = "id,code,publique_ephemere,empreinte,version,sel,enveloppe,cree_le,expire_le,depose_le";


export async function onRequestGet(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  const code = url.searchParams.get("code") || "";
  let filtre = "";
  if (id) {
    if (!UUID.test(id)) return json({ erreur: "Transfert inconnu." }, 400);
    filtre = "&id=eq." + encodeURIComponent(id);
  } else if (code) {
    if (!CODE.test(code)) return json({ erreur: "Un code a six chiffres." }, 400);
    filtre = "&code=eq." + encodeURIComponent(code);
  }
  /* La règle d'accès ne rend que les miens, et seulement tant qu'ils
     vivent : la route n'a pas à le redire, mais elle ordonne. */
  const r = await commeElle(qui.jeton, env,
    "/rest/v1/transferts_cles?select=" + COLONNES + filtre + "&order=cree_le.desc&limit=5");
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: "La base n'a pas répondu : " + ((await messageDe(r)) || "?") }, 502);
  const lignes = await r.json();
  return json({ transferts: Array.isArray(lignes) ? lignes : [] });
}


export async function onRequestPost(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  corps = corps && typeof corps === "object" ? corps : {};
  const e = ephemereValide(corps.publique);
  if (e) return json({ erreur: e }, 400);
  if (typeof corps.empreinte !== "string" || !EMPREINTE.test(corps.empreinte)) return json({ erreur: "Empreinte mal formée." }, 400);

  const r = await commeElle(qui.jeton, env, "/rest/v1/rpc/ouvrir_transfert", {
    method: "POST",
    body: JSON.stringify({ publique_donnee: corps.publique, empreinte_donnee: corps.empreinte }),
  });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "La base a refusé." }, 400);
  const t = await r.json();
  if (!t || !t.id || !t.code) return json({ erreur: "La base n'a rien ouvert." }, 502);
  return json({ ok: true, id: t.id, code: t.code, expire_le: t.expire_le });
}


export async function onRequestPatch(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  corps = corps && typeof corps === "object" ? corps : {};
  const e = depotValide(corps);
  if (e) return json({ erreur: e }, 400);

  const r = await commeElle(qui.jeton, env, "/rest/v1/rpc/deposer_transfert", {
    method: "POST",
    body: JSON.stringify({ t: corps.id, version_donnee: Number(corps.version), sel_donne: corps.sel, enveloppe_donnee: corps.enveloppe }),
  });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "La base a refusé." }, 400);
  const pose = await r.json();
  if (pose !== true) return json({ erreur: "La base n'a rien déposé." }, 502);
  return json({ ok: true });
}


export async function onRequestDelete(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  const id = new URL(request.url).searchParams.get("id") || "";
  if (!UUID.test(id)) return json({ erreur: "Transfert inconnu." }, 400);
  const r = await commeElle(qui.jeton, env, "/rest/v1/rpc/retirer_transfert", {
    method: "POST", body: JSON.stringify({ t: id }),
  });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "La base a refusé." }, 400);
  /* Retirer ce qui n'existe plus n'est pas une erreur : le nouvel appareil
     le fait après avoir rangé la clé, et la page peut le redemander. */
  return json({ ok: true, retire: (await r.json()) === true });
}
