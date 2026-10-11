/* ==========================================================================
   /api/cles — mes clés de chiffrement (lot H, session 2)
   ==========================================================================

   GET   → { moi: <mon uuid>, publique: { version, algo, cle, empreinte, cree_le } | null,
             privee:   { version, kdf, iterations, sel, enveloppe } | null,
             anciennes: [ { version, empreinte, remplacee_le } ] }
           « privee » est la copie de ma clé privée CHIFFRÉE PAR MA PHRASE
           (dans le navigateur) : la base ne sait pas l'ouvrir, la route non
           plus ; elle la transmet pour qu'un nouvel appareil la déverrouille.
   PUT   { publique: { algo, cle, empreinte }, privee: { kdf, iterations, sel, enveloppe } }
           → publier une clé (première fois, ou régénération après une phrase
             perdue : version + 1) — publier_cle_publique, qui écrit les deux
             dans la même transaction ;
         { publique } seul (lot K3)
           → publier une clé SANS copie par phrase — publier_cle_seule : la
             personne choisira ensuite sa sauvegarde (passkey, phrase) ;
         { privee: { kdf, iterations, sel, enveloppe } } seul
           → noter ou changer sa phrase — deposer_phrase (K3, qui insère ou
             remplace), avec repli sur changer_phrase (lot H) si la
             migration K3 n'est pas encore passée.
           → { ok, version }

   Aucun pouvoir propre, aucune cryptographie : la route vérifie des formes
   (un JWK P-256 bien formé, du base64url, des tailles) et transmet ; la base
   recommence. Voir docs/chiffrement.md, § 9 et § 10.
   ========================================================================== */

import { json, identifier, commeElle, messageDe } from "../../_emploi.js";

const B64U = /^[A-Za-z0-9_-]+$/;
const EMPREINTE = /^(\d{5} ){11}\d{5}$/;

function tableAbsente() {
  return json({ erreur: "Le chiffrement des messages privés n'est pas encore ouvert sur ce site "
                      + "(supabase/2026_chiffrement.sql).", indisponible: true }, 503);
}

/** La clé publique telle qu'on accepte de la transmettre ; une chaîne
    d'erreur sinon. */
export function publiqueValide(p) {
  if (!p || typeof p !== "object") return "Il manque la clé publique.";
  if (p.algo !== "ecdh-p256") return "Algorithme inconnu.";
  const c = p.cle;
  if (!c || typeof c !== "object" || c.kty !== "EC" || c.crv !== "P-256"
      || typeof c.x !== "string" || typeof c.y !== "string"
      || !/^[A-Za-z0-9_-]{43}$/.test(c.x) || !/^[A-Za-z0-9_-]{43}$/.test(c.y)
      || Object.keys(c).some((k) => !["kty", "crv", "x", "y"].includes(k))) return "Clé publique mal formée.";
  if (typeof p.empreinte !== "string" || !EMPREINTE.test(p.empreinte)) return "Empreinte mal formée.";
  return null;
}

/** La copie chiffrée de la clé privée ; une chaîne d'erreur sinon. */
export function priveeValide(p) {
  if (!p || typeof p !== "object") return "Il manque la copie chiffrée de la clé privée.";
  if (p.kdf !== "pbkdf2-sha256") return "Dérivation de la phrase inconnue.";
  const it = Number(p.iterations);
  if (!Number.isInteger(it) || it < 100000 || it > 10000000) return "Nombre d'itérations hors bornes.";
  if (typeof p.sel !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(p.sel)) return "Sel mal formé.";
  if (typeof p.enveloppe !== "string" || !B64U.test(p.enveloppe) || p.enveloppe.length < 40 || p.enveloppe.length > 4096) return "Copie de la clé privée mal formée.";
  return null;
}


export async function onRequestGet(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const moi = encodeURIComponent(qui.verdict.id);

  const [rP, rS] = await Promise.all([
    commeElle(qui.jeton, env, "/rest/v1/cles_publiques?select=version,algo,cle,empreinte,cree_le,remplacee_le&membre=eq." + moi + "&order=version.desc"),
    /* piège n° 1 : la règle d'accès ne rend que la mienne, et la requête le redit */
    commeElle(qui.jeton, env, "/rest/v1/cles_privees?select=version,kdf,iterations,sel,enveloppe,modifie_le&membre=eq." + moi),
  ]);
  if (rP.status === 404 || rS.status === 404) return tableAbsente();
  if (!rP.ok || !rS.ok) return json({ erreur: "La base n'a pas répondu : " + ((await messageDe(rP.ok ? rS : rP)) || "?") }, 502);
  const publiques = await rP.json(), privees = await rS.json();
  const courante = (Array.isArray(publiques) ? publiques : []).find((p) => !p.remplacee_le) || null;
  return json({
    moi: qui.verdict.id,   /* la page en a besoin pour ranger la clé par compte ; /api/moi ne le dit pas */
    publique: courante ? { version: courante.version, algo: courante.algo, cle: courante.cle, empreinte: courante.empreinte, cree_le: courante.cree_le } : null,
    privee: Array.isArray(privees) && privees[0] ? privees[0] : null,
    anciennes: (Array.isArray(publiques) ? publiques : []).filter((p) => p.remplacee_le)
      .map((p) => ({ version: p.version, empreinte: p.empreinte, remplacee_le: p.remplacee_le })),
  });
}


export async function onRequestPut(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  corps = corps && typeof corps === "object" ? corps : {};

  /* K3 : une clé publique seule — pas de copie par phrase. */
  if (corps.publique !== undefined && corps.privee === undefined) {
    const e = publiqueValide(corps.publique);
    if (e) return json({ erreur: e }, 400);
    const r0 = await commeElle(qui.jeton, env, "/rest/v1/rpc/publier_cle_seule", {
      method: "POST",
      body: JSON.stringify({ algo_donne: "ecdh-p256", cle_donnee: corps.publique.cle, empreinte_donnee: corps.publique.empreinte }),
    });
    /* Sans la migration K3 : la page sait revenir à l'ancien chemin (la
       phrase d'abord). On le lui dit par « indisponible », pas par un 500. */
    if (r0.status === 404) {
      return json({ erreur: "Créer ses clés sans phrase n'est pas encore ouvert sur ce site "
                          + "(supabase/2026_sauvegardes.sql).", indisponible: true, sans_phrase: false }, 503);
    }
    if (!r0.ok) return json({ erreur: (await messageDe(r0)) || "La base a refusé." }, 400);
    const v0 = await r0.json();
    if (!Number.isInteger(v0) || v0 < 1) return json({ erreur: "La base n'a rien écrit." }, 502);
    return json({ ok: true, version: v0, sans_phrase: true });
  }

  const ep = priveeValide(corps.privee);
  if (ep) return json({ erreur: ep }, 400);
  const privee = { kdf_donne: "pbkdf2-sha256", iterations_donnees: Number(corps.privee.iterations), sel_donne: corps.privee.sel, enveloppe_donnee: corps.privee.enveloppe };

  let r;
  if (corps.publique !== undefined) {
    const e = publiqueValide(corps.publique);
    if (e) return json({ erreur: e }, 400);
    r = await commeElle(qui.jeton, env, "/rest/v1/rpc/publier_cle_publique", {
      method: "POST",
      body: JSON.stringify(Object.assign({ algo_donne: "ecdh-p256", cle_donnee: corps.publique.cle, empreinte_donnee: corps.publique.empreinte }, privee)),
    });
  } else {
    /* Noter ou changer sa phrase : deposer_phrase insère OU remplace (K3 —
       on peut avoir des clés sans phrase) ; sans la migration K3, on revient
       à changer_phrase, qui ne sait que remplacer. */
    r = await commeElle(qui.jeton, env, "/rest/v1/rpc/deposer_phrase", { method: "POST", body: JSON.stringify(privee) });
    if (r.status === 404) {
      r = await commeElle(qui.jeton, env, "/rest/v1/rpc/changer_phrase", { method: "POST", body: JSON.stringify(privee) });
    }
  }
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "La base a refusé." }, 400);
  const version = await r.json();
  if (!Number.isInteger(version) || version < 1) return json({ erreur: "La base n'a rien écrit." }, 502);
  return json({ ok: true, version });
}
