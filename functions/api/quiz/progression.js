/* ==========================================================================
   /api/quiz/progression — où en est chacun, question par question
   ==========================================================================

   GET   → { progression: { "R104-06-01": { boite, prochaine, vues, reussies }, … } }
   POST  { resultats: [ { question, ok } ] } → { ok, ecrites }

   La répétition espacée est calculée ICI, pas dans le navigateur : la page
   dit seulement « juste » ou « faux », et c'est le serveur qui décide de la
   boîte et de l'échéance — sinon un script pourrait se déclarer expert. Ce
   n'est pas une question de triche (personne ne triche avec sa propre
   mémoire), c'est que le calcul doit être le même sur tous les appareils.

   Leitner, cinq boîtes : juste → boîte + 1 (5 au plus) ; faux → boîte 1.
   L'échéance suit la boîte : 0, 1, 3, 7, 14 jours.

   Aucun pouvoir propre : le jeton de la personne, la règle d'accès
   « ma_progression ». Chaque écriture est relue : le nombre renvoyé est
   celui des lignes que la base a réellement écrites.
   ========================================================================== */

import { json, identifier, commeElle, messageDe } from "../../_emploi.js";

const JOURS = [0, 1, 3, 7, 14];
const QUESTION = /^[A-Z][0-9]{3}-[0-9]{2}-[0-9]{2,3}$/;
const COLS = "question,boite,prochaine,vues,reussies,derniere_le";


function tableAbsente() {
  return json({ erreur: "Le quiz n'a pas encore de mémoire sur ce site (supabase/2026_quiz.sql).",
                indisponible: true }, 503);
}


export async function onRequestGet(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  const r = await commeElle(qui.jeton, env, "/rest/v1/progression_quiz?select=" + COLS + "&limit=5000");
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: "La base n'a pas répondu." }, 502);
  const lignes = await r.json();
  const progression = {};
  for (const l of lignes) progression[l.question] = l;
  return json({ progression });
}


export async function onRequestPost(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  const resultats = Array.isArray(corps && corps.resultats) ? corps.resultats : [];
  /* Une seule réponse par question dans un envoi : la dernière compte. */
  const parQuestion = new Map();
  for (const x of resultats) {
    const q = String((x && x.question) || "");
    if (!QUESTION.test(q)) continue;
    parQuestion.set(q, x.ok === true);
  }
  if (!parQuestion.size) return json({ erreur: "Aucun résultat lisible." }, 400);
  if (parQuestion.size > 200) return json({ erreur: "200 réponses au plus par envoi." }, 400);

  /* L'état actuel de ces questions, pour calculer la suite. */
  const ids = Array.from(parQuestion.keys());
  const rLu = await commeElle(qui.jeton, env,
    "/rest/v1/progression_quiz?select=" + COLS + "&question=in.(" + ids.map(encodeURIComponent).join(",") + ")");
  if (rLu.status === 404) return tableAbsente();
  if (!rLu.ok) return json({ erreur: "La base n'a pas répondu." }, 502);
  const actuel = {};
  for (const l of await rLu.json()) actuel[l.question] = l;

  const maintenant = Date.now();
  const lignes = ids.map((q) => {
    const a = actuel[q] || { boite: 1, vues: 0, reussies: 0 };
    const ok = parQuestion.get(q);
    /* Une question jamais vue et réussie du premier coup part en boîte 2 ;
       une question déjà en boîte n monte ou retombe. */
    const boite = ok ? Math.min(5, (a.vues ? a.boite : 1) + 1) : 1;
    return {
      question: q,
      boite,
      prochaine: new Date(maintenant + JOURS[boite - 1] * 86400000).toISOString(),
      vues: (a.vues || 0) + 1,
      reussies: (a.reussies || 0) + (ok ? 1 : 0),
      derniere_le: new Date(maintenant).toISOString(),
    };
  });

  const r = await commeElle(qui.jeton, env,
    "/rest/v1/progression_quiz?on_conflict=proprietaire,question&select=question", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=representation",
      body: JSON.stringify(lignes),
    });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "La base a refusé l'écriture." }, 400);
  const ecrit = await r.json();
  const ecrites = Array.isArray(ecrit) ? ecrit.length : 0;
  if (ecrites !== lignes.length) {
    return json({ erreur: "La base n'a écrit que " + ecrites + " ligne(s) sur " + lignes.length + "." }, 502);
  }
  return json({ ok: true, ecrites, etat: lignes });
}
