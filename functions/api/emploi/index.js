/* ==========================================================================
   /api/emploi — lire une période, créer un événement
   ==========================================================================

   GET   ?du=ISO&au=ISO → { evenements: [...], en_retard: [...] }
         les événements dont le début tombe dans [du, au[, et les tâches non
         faites dont l'échéance est passée (elles ne doivent pas disparaître
         de la vue parce que la semaine a tourné).
   POST  { type, titre, debut, fin?, journee?, fait?, details? } → la ligne
         créée, telle que la base l'a écrite.

   Voir _emploi.js pour ce que ces routes ont en commun.
   ========================================================================== */

import { json, identifier, commeElle, messageDe, normaliserEvenement,
         tableAbsente, COLONNES, COLONNES_SANS_RAPPELS, colonneInconnue } from "../../_emploi.js";


function isoOu(valeur, defaut) {
  const d = new Date(valeur || "");
  return isNaN(d) ? defaut : d.toISOString();
}


export async function onRequestGet(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  const url = new URL(request.url);
  const maintenant = Date.now();
  const du = isoOu(url.searchParams.get("du"), new Date(maintenant - 7 * 86400000).toISOString());
  const au = isoOu(url.searchParams.get("au"), new Date(maintenant + 21 * 86400000).toISOString());
  if (au <= du) return json({ erreur: "La période est vide." }, 400);
  /* Une fenêtre bornée : la page demande une semaine ou un mois, pas
     l'histoire entière. Un an suffit à n'importe quelle vue. */
  if (new Date(au) - new Date(du) > 400 * 86400000) return json({ erreur: "Période trop longue." }, 400);

  /* Les séances de mes groupes (2026_groupes.sql, mes_seances) : lues, pas
     recopiées. Elles arrivent sous la même forme qu'un événement, avec
     source = groupe, et ne se modifient que dans le groupe. Tant que la
     migration des groupes n'est pas passée, la fonction n'existe pas :
     on s'en passe, sans bruit. */
  const rSeances = commeElle(qui.jeton, env, "/rest/v1/rpc/mes_seances", {
    method: "POST", body: JSON.stringify({ du, au }),
  });
  const lire = (cols) => Promise.all([
    commeElle(qui.jeton, env,
      "/rest/v1/evenements?select=" + cols
      + "&debut=gte." + encodeURIComponent(du) + "&debut=lt." + encodeURIComponent(au)
      + "&order=debut.asc&limit=2000"),
    commeElle(qui.jeton, env,
      "/rest/v1/evenements?select=" + cols
      + "&type=eq.tache&fait=eq.false&debut=lt." + encodeURIComponent(du)
      + "&order=debut.asc&limit=200"),
  ]);
  let [rPeriode, rRetard] = await lire(COLONNES);
  /* la colonne « rappels » n'existe pas encore (lot F pas passé) : sans elle */
  if (rPeriode.status === 400 && colonneInconnue(400, await rPeriode.clone().text()) === "rappels") {
    [rPeriode, rRetard] = await lire(COLONNES_SANS_RAPPELS);
  }

  if (rPeriode.status === 404) return tableAbsente();
  if (!rPeriode.ok) return json({ erreur: "La base n'a pas répondu." }, 502);

  let seances = [];
  try {
    const rs = await rSeances;
    if (rs.ok) {
      const lues = await rs.json();
      seances = (Array.isArray(lues) ? lues : []).map((s) => ({
        id: "seance-" + s.id, type: "seance", titre: s.titre, debut: s.debut, fin: s.fin,
        journee: false, fait: null,
        /* « fiche » = la liste, séparée par des virgules (le champ de la
           grille lit ce format) ; « fiches » = le tableau, pour un outil */
        details: { groupe: s.groupe_nom, lieu: s.lieu,
                   fiche: (Array.isArray(s.fiches) && s.fiches.length ? s.fiches : (s.fiche ? [s.fiche] : [])).join(","),
                   fiches: Array.isArray(s.fiches) && s.fiches.length ? s.fiches : (s.fiche ? [s.fiche] : []),
                   note: s.note, propose_par: s.cree_par_pseudo },
        source: "groupe", source_id: s.id, groupe_id: s.groupe,
      }));
    }
  } catch (err) { /* pas de séances : la grille reste juste */ }

  const evenements = (await rPeriode.json()).concat(seances)
    .sort((a, b) => (a.debut < b.debut ? -1 : a.debut > b.debut ? 1 : 0));

  return json({
    du, au,
    evenements,
    en_retard: rRetard.ok ? await rRetard.json() : [],
  });
}


export async function onRequestPost(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  let corps;
  try {
    corps = await request.json();
  } catch (err) {
    return json({ erreur: "requête illisible" }, 400);
  }

  const v = normaliserEvenement(corps, false);
  if (!v.ok) return json({ erreur: v.erreur }, 400);

  /* Une tâche créée à la main commence « à faire » ; les autres types n'ont
     pas d'état. Le navigateur peut le préciser, mais pas l'oublier. */
  if (v.ligne.type === "tache" && !("fait" in v.ligne)) v.ligne.fait = false;

  let r = await commeElle(qui.jeton, env, "/rest/v1/evenements?select=" + COLONNES, {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify(v.ligne),
  });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) {
    const detail = await messageDe(r);
    /* « rappels » inconnue (lot F pas passé) : on écrit sans, la page le
       montrera absent plutôt que de perdre l'événement */
    if (colonneInconnue(r.status, detail) !== "rappels") return json({ erreur: detail || "L'événement n'a pas été enregistré." }, 400);
    delete v.ligne.rappels;
    r = await commeElle(qui.jeton, env, "/rest/v1/evenements?select=" + COLONNES_SANS_RAPPELS, {
      method: "POST", prefer: "return=representation", body: JSON.stringify(v.ligne),
    });
    if (!r.ok) return json({ erreur: (await messageDe(r)) || "L'événement n'a pas été enregistré." }, 400);
  }

  /* On relit ce que la base a écrit : c'est la ligne, avec son identifiant,
     qui repart — pas ce qu'on croyait envoyer. */
  const lignes = await r.json();
  if (!Array.isArray(lignes) || lignes.length !== 1) {
    return json({ erreur: "La base n'a rien écrit." }, 502);
  }
  return json({ ok: true, evenement: lignes[0] }, 201);
}
