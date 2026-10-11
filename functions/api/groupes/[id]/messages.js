/* ==========================================================================
   /api/groupes/:id/messages — écrire dans la discussion, effacer un message
   ==========================================================================

   POST    { texte, refs?, reponse_a? }
                                 → le message relu (auteur = la personne ;
                                   membres acceptés seulement — règle
                                   « messages_ecrits »). reponse_a : le
                                   numéro d'un message du même groupe que
                                   celui-ci cite ; vérifié avant d'écrire.
           { chiffre, cle_version, reponse_a? }
                                 → un message CHIFFRÉ de bout en bout (lot
                                   H, session 2 : conversation privée
                                   chiffrée) : la route ne voit que du
                                   base64url et une version ; la base
                                   exige le bon régime (chiffré si la
                                   conversation l'est, clair sinon).
                                   Jamais les deux à la fois.
   PATCH   { id, texte, refs? }  → le message relu (le sien seulement —
                                   règle « messages_modifies » ; la base
                                   pose modifie_le)
           { id, chiffre, cle_version } → rechiffré, même règle
   DELETE  ?id=<n>               → { ok } (le sien, ou n'importe lequel
                                   pour un admin)
   DELETE  ?ids=<n,n,n>          → { ok, effaces: [n…] } — plusieurs d'un
                                   coup (la sélection) ; la règle d'accès
                                   trie ligne par ligne, la réponse dit
                                   lesquels sont partis

   « refs » : ce que le message cite. Un tableau, dix éléments au plus,
   chacun { type: "fiche", id: "S1-R104-06" } ou { type: "seance",
   id: "<uuid>" }. La route ne garde que cette forme ; ce qui n'y entre
   pas est refusé, pas nettoyé en silence.
   ========================================================================== */

import { json, identifier, commeElle, messageDe } from "../../../_emploi.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FICHE = /^S[1-6]-R[0-9]{3}-[0-9]{2}(#[a-z0-9-]{1,80})?$/;
const COLONNES = "id,texte,cree_le,modifie_le,refs,reponse_a,auteur,chiffre,cle_version,qui:profiles!messages_auteur_fkey(pseudo)";
const COLONNES_SANS_CHIFFRE = "id,texte,cree_le,modifie_le,refs,reponse_a,auteur,qui:profiles!messages_auteur_fkey(pseudo)";
const B64U = /^[A-Za-z0-9_-]+$/;

/** Le corps d'un message, clair OU chiffré — jamais les deux, jamais aucun.
    Rend { ligne } (ce qu'on écrit) ou { erreur }. */
function lireCorps(corps) {
  const c = corps && typeof corps === "object" ? corps : {};
  const chiffre = c.chiffre !== undefined && c.chiffre !== null && c.chiffre !== "";
  const clair = c.texte !== undefined && c.texte !== null && String(c.texte).trim() !== "";
  if (chiffre && clair) return { erreur: "Un message est chiffré ou en clair, pas les deux." };
  if (chiffre) {
    if (typeof c.chiffre !== "string" || !B64U.test(c.chiffre) || c.chiffre.length < 40 || c.chiffre.length > 16384) return { erreur: "Message chiffré mal formé." };
    const v = Number(c.cle_version);
    if (!Number.isInteger(v) || v < 1 || v > 1000000) return { erreur: "Version de clé invalide." };
    if (c.refs !== undefined && c.refs !== null && !(Array.isArray(c.refs) && !c.refs.length)) return { erreur: "Les références d'un message chiffré sont dans le chiffré." };
    return { ligne: { texte: "", refs: [], chiffre: c.chiffre, cle_version: v } };
  }
  const t = lireTexte(c.texte);
  if (t.erreur) return { erreur: t.erreur };
  const refs = lireRefs(c.refs);
  if (refs === null) return { erreur: "Références mal formées." };
  return { ligne: { texte: t.texte, refs, chiffre: null, cle_version: null } };
}

/** Une écriture qui nomme chiffre/cle_version alors que la migration n'est
    pas passée : PostgREST répond 400 « colonne inconnue ». Un message en
    clair est réécrit sans ces colonnes ; un message chiffré ne peut pas
    l'être, et on le dit. */
function colonnesChiffreInconnues(statut, message) {
  return statut === 400 && /chiffre|cle_version/.test(message || "") && /column|colonne|schema cache/i.test(message || "");
}

/** Les références, validées ; null si la forme est mauvaise. */
function lireRefs(brut) {
  if (brut === undefined || brut === null) return [];
  if (!Array.isArray(brut) || brut.length > 10) return null;
  const propres = [];
  for (const r of brut) {
    if (!r || typeof r !== "object") return null;
    const id = String(r.id || "");
    if (r.type === "fiche" && FICHE.test(id)) propres.push({ type: "fiche", id });
    else if (r.type === "seance" && UUID.test(id)) propres.push({ type: "seance", id });
    else return null;
  }
  return propres;
}

/** Le texte, validé ; une chaîne d'erreur sinon. */
function lireTexte(brut) {
  const texte = String(brut || "").trim();
  if (!texte) return { erreur: "Le message est vide." };
  if (texte.length > 2000) return { erreur: "2000 caractères au plus." };
  return { texte };
}


export async function onRequestPost(context) {
  const { request, env, params } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const id = String(params.id || "");
  if (!UUID.test(id)) return json({ erreur: "Groupe inconnu." }, 400);

  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  const lu = lireCorps(corps);
  if (lu.erreur) return json({ erreur: lu.erreur }, 400);

  /* La citation : un message du MÊME groupe, qu'on relit avant d'écrire.
     Un numéro d'un autre groupe (ou inventé) est refusé, pas ignoré. */
  let reponse_a = null;
  if (corps && corps.reponse_a !== undefined && corps.reponse_a !== null && corps.reponse_a !== "") {
    const num = String(corps.reponse_a);
    if (!/^\d{1,12}$/.test(num)) return json({ erreur: "Message à citer inconnu." }, 400);
    const rc = await commeElle(qui.jeton, env, "/rest/v1/messages?select=id&groupe=eq." + id + "&id=eq." + num);
    const cites = rc.ok ? await rc.json() : [];
    if (!Array.isArray(cites) || cites.length !== 1) return json({ erreur: "Message à citer inconnu." }, 400);
    reponse_a = Number(num);
  }

  const ligne = Object.assign({ groupe: id, auteur: qui.verdict.id, reponse_a }, lu.ligne);
  let r = await commeElle(qui.jeton, env, "/rest/v1/messages?select=" + COLONNES, {
    method: "POST", prefer: "return=representation", body: JSON.stringify(ligne),
  });
  if (!r.ok) {
    const m = (await messageDe(r)) || "";
    if (colonnesChiffreInconnues(r.status, m)) {
      if (ligne.chiffre) return json({ erreur: "Le chiffrement des messages privés n'est pas encore ouvert sur ce site (supabase/2026_chiffrement.sql).", indisponible: true }, 503);
      delete ligne.chiffre; delete ligne.cle_version;
      r = await commeElle(qui.jeton, env, "/rest/v1/messages?select=" + COLONNES_SANS_CHIFFRE, {
        method: "POST", prefer: "return=representation", body: JSON.stringify(ligne),
      });
      if (!r.ok) return json({ erreur: (await messageDe(r)) || "Le message n'a pas été enregistré." }, 400);
    } else {
      /* la règle d'accès a refusé. Plusieurs causes possibles (pas membre,
         conversation fermée, mauvais régime) : on ne parle de régime
         qu'après avoir relu celui du groupe — une page qui a une vue
         périmée doit l'apprendre, quelqu'un qui n'est pas membre non. */
      if (/row-level security/.test(m)) {
        const rG = await commeElle(qui.jeton, env, "/rest/v1/groupes?select=chiffre_depuis&id=eq." + id);
        const g = rG.ok ? (await rG.json())[0] : null;
        if (g && ligne.chiffre && !g.chiffre_depuis) return json({ erreur: "Cette conversation n'est pas (encore) chiffrée : recharge-la avant d'écrire." }, 409);
        if (g && !ligne.chiffre && g.chiffre_depuis) return json({ erreur: "Cette conversation est chiffrée : recharge-la avant d'écrire.", chiffree: true }, 409);
      }
      return json({ erreur: m || "Le message n'a pas été enregistré." }, 400);
    }
  }
  const lignes = await r.json();
  if (!Array.isArray(lignes) || lignes.length !== 1) return json({ erreur: "La base n'a rien écrit." }, 502);
  return json({ ok: true, message: lignes[0] }, 201);
}


export async function onRequestPatch(context) {
  const { request, env, params } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const id = String(params.id || "");
  if (!UUID.test(id)) return json({ erreur: "Groupe inconnu." }, 400);

  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  const num = String((corps && corps.id) || "");
  if (!/^\d{1,12}$/.test(num)) return json({ erreur: "Message inconnu." }, 400);
  const lu = lireCorps(corps);
  if (lu.erreur) return json({ erreur: lu.erreur }, 400);

  /* La règle d'accès ne laisse passer que l'auteur : pour un autre, la
     base ne touche aucune ligne et on répond 404, sans dire s'il existe. */
  const modif = lu.ligne.chiffre
    ? { chiffre: lu.ligne.chiffre, cle_version: lu.ligne.cle_version, texte: "", refs: [] }
    : { texte: lu.ligne.texte, refs: lu.ligne.refs };
  let r = await commeElle(qui.jeton, env,
    "/rest/v1/messages?groupe=eq." + id + "&id=eq." + num + "&select=" + COLONNES, {
      method: "PATCH", prefer: "return=representation", body: JSON.stringify(modif),
    });
  if (!r.ok && colonnesChiffreInconnues(r.status, await r.clone().text())) {
    if (lu.ligne.chiffre) return json({ erreur: "Le chiffrement des messages privés n'est pas encore ouvert sur ce site (supabase/2026_chiffrement.sql).", indisponible: true }, 503);
    r = await commeElle(qui.jeton, env,
      "/rest/v1/messages?groupe=eq." + id + "&id=eq." + num + "&select=" + COLONNES_SANS_CHIFFRE, {
        method: "PATCH", prefer: "return=representation", body: JSON.stringify(modif),
      });
  }
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "La modification a échoué." }, 400);
  const lignes = await r.json();
  if (!Array.isArray(lignes) || lignes.length !== 1) {
    return json({ erreur: "Ce message n'existe pas, ou n'est pas à toi." }, 404);
  }
  return json({ ok: true, message: lignes[0] });
}


export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const id = String(params.id || "");
  const url = new URL(request.url);
  if (!UUID.test(id)) return json({ erreur: "Groupe inconnu." }, 400);

  /* Plusieurs d'un coup : la sélection. Cinquante au plus par appel. */
  const ids = url.searchParams.get("ids");
  if (ids !== null) {
    const nums = ids.split(",").map((x) => x.trim()).filter(Boolean);
    if (!nums.length || nums.length > 50 || nums.some((x) => !/^\d{1,12}$/.test(x))) {
      return json({ erreur: "Sélection invalide." }, 400);
    }
    const r = await commeElle(qui.jeton, env,
      "/rest/v1/messages?groupe=eq." + id + "&id=in.(" + nums.join(",") + ")&select=id", {
        method: "DELETE", prefer: "return=representation",
      });
    if (!r.ok) return json({ erreur: "L'effacement a échoué." }, 400);
    const lignes = await r.json();
    const effaces = Array.isArray(lignes) ? lignes.map((l) => l.id) : [];
    if (!effaces.length) return json({ erreur: "Aucun de ces messages n'est à toi." }, 404);
    return json({ ok: true, effaces });
  }

  const num = url.searchParams.get("id") || "";
  if (!/^\d{1,12}$/.test(num)) return json({ erreur: "Message inconnu." }, 400);

  const r = await commeElle(qui.jeton, env,
    "/rest/v1/messages?groupe=eq." + id + "&id=eq." + num + "&select=id", {
      method: "DELETE", prefer: "return=representation",
    });
  if (!r.ok) return json({ erreur: "L'effacement a échoué." }, 400);
  const lignes = await r.json();
  if (!Array.isArray(lignes) || lignes.length !== 1) {
    return json({ erreur: "Ce message n'existe pas, ou n'est pas à toi." }, 404);
  }
  return json({ ok: true });
}
