/* ==========================================================================
   /api/quiz/session — la session de quiz en pause, une par personne
   ==========================================================================

   GET     → { session: { ids, resultats, choix } | null, maj_le }
   PUT     { etat: { ids, resultats, choix } } → { ok, maj_le }
   DELETE  → { ok, effacee: true | false }

   Une session, c'est la liste des questions tirées (leurs identifiants —
   les questions elles-mêmes sont dans le dépôt), les réponses déjà
   données, et le choix qui l'a composée (fiches, nombre, mode), pour que la
   page se remette dans le même état. La position n'est pas envoyée : c'est
   le nombre de réponses. Décision de l'auteur (docs/feuille-de-route.md,
   décision 1) : la reprise se fait depuis n'importe quel appareil, donc en
   base, une ligne par personne (supabase/2026_sessions_quiz.sql).

   La route ne fait que vérifier la FORME avant d'écrire — tout ce qui n'a
   pas la forme attendue est refusé, pas « nettoyé », pour qu'une page
   cassée ne dépose pas un état illisible qu'elle ne saurait plus relire.
   Aucun pouvoir propre : le jeton de la personne, la règle d'accès
   « ma_session_quiz ». Chaque écriture est relue : une écriture qui ne
   renvoie pas la ligne est une erreur, jamais un succès.
   ========================================================================== */

import { json, identifier, commeElle, messageDe } from "../../_emploi.js";

const QUESTION = /^[A-Z][0-9]{3}-[0-9]{2}-[0-9]{2,3}$/;
const CHAPITRE = /^S[0-9]-[A-Z][0-9]{3}-[0-9]{2}$/;
const MODES = ["revoir", "melange", "ratees"];
const MAX_QUESTIONS = 600;      /* « toutes » sur la banque entière, avec de la marge */
const MAX_OCTETS = 65536;       /* la même borne que la contrainte de la table */
const COLS = "etat,maj_le";


/** « &proprietaire=eq.<moi> » — le jeton porte mon identifiant (sub) ;
    s'il manquait (jeton ancien), on s'en remet à la règle d'accès seule. */
function filtreMoi(qui) {
  const id = qui.verdict && qui.verdict.id;
  return id ? "&proprietaire=eq." + encodeURIComponent(id) : "";
}


function tableAbsente() {
  return json({ erreur: "La pause du quiz n'est pas encore ouverte sur ce site (supabase/2026_sessions_quiz.sql).",
                indisponible: true }, 503);
}


/** L'état tel qu'on accepte de le garder, ou null s'il n'a pas la forme.
    Exporté pour être testé sans serveur. */
export function etatValide(etat) {
  if (!etat || typeof etat !== "object" || Array.isArray(etat)) return null;
  const ids = Array.isArray(etat.ids) ? etat.ids : null;
  if (!ids || !ids.length || ids.length > MAX_QUESTIONS) return null;
  if (!ids.every((x) => typeof x === "string" && QUESTION.test(x))) return null;
  if (new Set(ids).size !== ids.length) return null;

  const resultats = Array.isArray(etat.resultats) ? etat.resultats : null;
  if (!resultats || resultats.length > ids.length) return null;
  const propres = [];
  for (const r of resultats) {
    if (!r || typeof r !== "object" || typeof r.q !== "string" || !QUESTION.test(r.q)) return null;
    if (typeof r.ok !== "boolean") return null;
    if (ids.indexOf(r.q) === -1) return null;
    propres.push({ q: r.q, ok: r.ok });
  }

  const c = etat.choix && typeof etat.choix === "object" && !Array.isArray(etat.choix) ? etat.choix : {};
  const fiches = Array.isArray(c.fiches) ? c.fiches : [];
  if (fiches.length > 100 || !fiches.every((x) => typeof x === "string" && CHAPITRE.test(x))) return null;
  const nombre = Number.isInteger(c.nombre) && c.nombre >= 0 && c.nombre <= MAX_QUESTIONS ? c.nombre : 0;
  const mode = MODES.indexOf(c.mode) !== -1 ? c.mode : "revoir";

  const propre = { ids, resultats: propres, choix: { fiches, nombre, mode } };
  if (JSON.stringify(propre).length > MAX_OCTETS) return null;
  return propre;
}


export async function onRequestGet(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  /* La règle d'accès ne rend que ma ligne, mais on filtre quand même sur
     mon identifiant (piège n° 1 de conception § 7 bis : une requête sans filtre sur une
     table permissive sert la ligne de quelqu'un d'autre) ; « limit=1 » dit
     qu'on n'en attend pas plus, la clé primaire l'a déjà garanti. */
  const r = await commeElle(qui.jeton, env, "/rest/v1/sessions_quiz?select=" + COLS + filtreMoi(qui) + "&limit=1");
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: "La base n'a pas répondu." }, 502);
  const lignes = await r.json();
  const l = Array.isArray(lignes) && lignes[0];
  if (!l) return json({ session: null });
  /* Relue avec la même exigence qu'à l'écriture : une ligne qu'on ne sait
     plus lire (format changé) vaut « pas de session », pas une page cassée. */
  const etat = etatValide(l.etat);
  if (!etat) return json({ session: null, maj_le: l.maj_le, illisible: true });
  return json({ session: etat, maj_le: l.maj_le });
}


export async function onRequestPut(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  const etat = etatValide(corps && corps.etat);
  if (!etat) return json({ erreur: "La session n'a pas la forme attendue." }, 400);

  const maj_le = new Date().toISOString();
  /* Une ligne par personne : l'insertion fusionne sur la clé primaire
     (le propriétaire, posé par la base depuis le jeton). */
  const r = await commeElle(qui.jeton, env,
    "/rest/v1/sessions_quiz?on_conflict=proprietaire&select=maj_le", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=representation",
      body: JSON.stringify({ etat, maj_le }),
    });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "La base a refusé l'écriture." }, 400);
  const ecrit = await r.json();
  if (!Array.isArray(ecrit) || ecrit.length !== 1) {
    return json({ erreur: "La base n'a pas écrit la session." }, 502);
  }
  return json({ ok: true, maj_le: ecrit[0].maj_le || maj_le });
}


export async function onRequestDelete(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  /* Filtré sur mon identifiant (la règle d'accès le garantit déjà ; un
     DELETE sans filtre reste un geste qu'on ne fait pas). On relit ce qui
     est parti — 0 ligne n'est pas une erreur ici (rien à effacer), mais on
     le dit, au lieu de prétendre avoir effacé. */
  const r = await commeElle(qui.jeton, env, "/rest/v1/sessions_quiz?select=proprietaire" + filtreMoi(qui), {
    method: "DELETE",
    prefer: "return=representation",
  });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "La base a refusé l'effacement." }, 400);
  const parties = await r.json();
  return json({ ok: true, effacee: Array.isArray(parties) && parties.length > 0 });
}
