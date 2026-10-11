/* ==========================================================================
   /api/groupes/:id/seances — proposer, modifier, retirer une séance
   ==========================================================================

   POST    { titre, debut, fin?, lieu?, fiches?, fiche?, note? } → la séance relue
   PATCH   { id, titre?, debut?, fin?, lieu?, fiches?, fiche?, note? } → relue
   DELETE  ?id=<uuid> → { ok }

   Tout membre accepté propose ; l'auteur ou un admin modifie et retire
   (règles « seances_* »). L'emploi du temps de chaque membre lit ces lignes
   (mes_seances) : rien à propager.

   « fiches » est un tableau d'identifiants de chapitre (dix au plus),
   chacun éventuellement suivi d'une section : S1-R104-06, ou
   S1-R104-06#les-tubes-et-tee. C'est la liaison groupes ↔ fiches du § 6,
   sans rien d'autre que des identifiants publics. « fiche » (une seule)
   reste acceptée en entrée et renvoyée en sortie : c'est la première du
   tableau, gardée pour la compatibilité (supabase/2026_seances_fiches.sql).
   Tant que cette migration n'est pas passée, la base ne connaît que
   « fiche » : la route le détecte (colonne inconnue) et écrit sans le
   tableau — la première fiche seulement, plutôt qu'un refus.
   ========================================================================== */

import { json, identifier, commeElle, messageDe, colonneInconnue, rappelsValides } from "../../../_emploi.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FICHE = /^S[1-6]-R[0-9]{3}-[0-9]{2}(#[a-z0-9-]+)?$/;
const COLS = "id,titre,debut,fin,lieu,fiche,fiches,rappels,note,cree_le,cree_par,auteur:profiles!seances_cree_par_fkey(pseudo)";
const MAX_FICHES = 10;

/** Écrit la séance ; si la base ne connaît pas encore une colonne
    (« fiches » : 2026_seances_fiches.sql ; « rappels » :
    2026_notifications.sql — PostgREST répond 400 en la nommant), on la
    retire et on réécrit sans, jusqu'à deux fois. Renvoie la réponse, et
    la ligne finalement écrite. */
async function ecrireAvecRepli(qui, env, chemin, methode, ligne) {
  let cols = COLS, r;
  for (let essai = 0; essai < 3; essai++) {
    r = await commeElle(qui.jeton, env, chemin + "select=" + cols, {
      method: methode, prefer: "return=representation", body: JSON.stringify(ligne),
    });
    if (r.ok) return { r, ligne };
    const message = await messageDe(r);
    const inconnue = colonneInconnue(r.status, message);
    if (!inconnue || !cols.includes("," + inconnue)) return { r, ligne, message };
    cols = cols.replace("," + inconnue, "");
    delete ligne[inconnue];
    if (methode === "PATCH" && !Object.keys(ligne).length) {
      return { r, ligne, message: "« " + inconnue + " » n'est pas encore ouvert sur ce site (migration à passer).", vide: true };
    }
  }
  return { r, ligne, message: await messageDe(r) };
}


function dateValide(v) {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString();
}

/** Valide ce que le navigateur envoie. `partiel` pour un PATCH. */
function normaliser(corps, partiel) {
  const c = corps && typeof corps === "object" ? corps : {};
  const l = {};
  if ("titre" in c || !partiel) {
    const t = String(c.titre || "").trim();
    if (!t || t.length > 200) return { erreur: "Il faut un titre (200 caractères au plus)." };
    l.titre = t;
  }
  if ("debut" in c || !partiel) {
    const d = dateValide(c.debut);
    if (!d) return { erreur: "Il faut une date de début." };
    l.debut = d;
  }
  if ("fin" in c) {
    if (!c.fin) l.fin = null;
    else { const f = dateValide(c.fin); if (!f) return { erreur: "Date de fin illisible." }; l.fin = f; }
  }
  if (l.debut && l.fin && l.fin < l.debut) return { erreur: "La fin est avant le début." };
  if ("lieu" in c) { const v = String(c.lieu || "").trim(); if (v.length > 200) return { erreur: "Lieu trop long." }; l.lieu = v || null; }
  if ("note" in c) { const v = String(c.note || "").trim(); if (v.length > 1000) return { erreur: "Note trop longue." }; l.note = v || null; }
  /* Les rappels (lot F) : les minutes avant le début, [60] = une heure avant */
  if ("rappels" in c) {
    const r = rappelsValides(c.rappels === null ? [] : c.rappels);
    if (!r) return { erreur: "« rappels » : des minutes avant le début, entières, une semaine au plus, cinq au plus." };
    l.rappels = r;
  }
  /* Les fiches : « fiches » (tableau) d'abord ; sinon « fiche » (une
     seule, ancien client). Dédoublonnées, dix au plus ; « fiche » = la
     première. */
  if ("fiches" in c || "fiche" in c) {
    let liste = Array.isArray(c.fiches) ? c.fiches : null;
    if (liste === null) {
      const v = String(c.fiche || "").trim();
      liste = v ? v.split(",") : [];
    }
    const propres = [];
    for (const x of liste) {
      const v = String(x || "").trim();
      if (!v) continue;
      if (!FICHE.test(v)) return { erreur: "Identifiant de fiche mal formé (ex. S1-R104-06)." };
      if (propres.indexOf(v) === -1) propres.push(v);
    }
    if (propres.length > MAX_FICHES) return { erreur: MAX_FICHES + " fiches au plus par séance." };
    l.fiches = propres;
    l.fiche = propres[0] || null;
  }
  if (partiel && !Object.keys(l).length) return { erreur: "Rien à modifier." };
  return { ligne: l };
}


export async function onRequestPost(context) {
  const { request, env, params } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const id = String(params.id || "");
  if (!UUID.test(id)) return json({ erreur: "Groupe inconnu." }, 400);

  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  const v = normaliser(corps, false);
  if (v.erreur) return json({ erreur: v.erreur }, 400);
  v.ligne.groupe = id;
  v.ligne.cree_par = qui.verdict.id;

  const { r, message } = await ecrireAvecRepli(qui, env, "/rest/v1/seances?", "POST", v.ligne);
  if (!r.ok) return json({ erreur: message || "La séance n'a pas été enregistrée." }, 400);
  const lignes = await r.json();
  if (!Array.isArray(lignes) || lignes.length !== 1) return json({ erreur: "La base n'a rien écrit." }, 502);
  return json({ ok: true, seance: lignes[0] }, 201);
}


export async function onRequestPatch(context) {
  const { request, env, params } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const id = String(params.id || "");
  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  const sid = String((corps && corps.id) || "");
  if (!UUID.test(id) || !UUID.test(sid)) return json({ erreur: "Séance inconnue." }, 400);
  const v = normaliser(corps, true);
  if (v.erreur) return json({ erreur: v.erreur }, 400);

  const { r, message, vide } = await ecrireAvecRepli(qui, env, "/rest/v1/seances?groupe=eq." + id + "&id=eq." + sid + "&", "PATCH", v.ligne);
  if (vide) return json({ erreur: message }, 503);
  if (!r.ok) return json({ erreur: message || "La modification a échoué." }, 400);
  const lignes = await r.json();
  if (!Array.isArray(lignes) || lignes.length !== 1) {
    return json({ erreur: "Cette séance n'existe pas, ou tu ne peux pas la modifier." }, 404);
  }
  return json({ ok: true, seance: lignes[0] });
}


export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const id = String(params.id || "");
  const sid = new URL(request.url).searchParams.get("id") || "";
  if (!UUID.test(id) || !UUID.test(sid)) return json({ erreur: "Séance inconnue." }, 400);

  const r = await commeElle(qui.jeton, env,
    "/rest/v1/seances?groupe=eq." + id + "&id=eq." + sid + "&select=id", {
      method: "DELETE", prefer: "return=representation",
    });
  if (!r.ok) return json({ erreur: "Le retrait a échoué." }, 400);
  const lignes = await r.json();
  if (!Array.isArray(lignes) || lignes.length !== 1) {
    return json({ erreur: "Cette séance n'existe pas, ou tu ne peux pas la retirer." }, 404);
  }
  return json({ ok: true });
}
