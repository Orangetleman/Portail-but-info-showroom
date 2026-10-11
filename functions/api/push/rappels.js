/* ==========================================================================
   /api/push/rappels — toutes les cinq minutes : ce qui arrive à échéance
   ==========================================================================

   POST, appelé par la BASE (tâche pg_cron « rappels-push », pg_net —
   supabase/2026_notifications.sql), jamais par une page. Même garde que
   /api/push/envoyer : l'en-tête X-Push-Secret.

   Un rappel est porté par la séance (seances.rappels) ou l'événement
   (evenements.rappels) : une liste de minutes avant le début — [60] =
   une heure avant. Décision 3 de la feuille de route : la séance dit
   QUAND, chaque personne dit SI (parametres_notifications.rappels).

   À chaque passage :
     1. lire les séances et les événements qui commencent dans les sept
        jours (le plus long rappel possible) et portent des rappels ;
     2. pour chaque (cible, minutes) dont l'heure « début − minutes » est
        passée depuis moins de GRACE (15 min : deux passages manqués ne
        perdent pas un rappel, trois le perdent — mieux qu'un rappel qui
        arrive une heure après la séance) ;
     3. RÉSERVER la ligne dans rappels_envoyes (insertion, « ignore-
        duplicates », relue) : si la ligne existait, un autre passage
        l'a déjà envoyé — on ne renvoie pas ;
     4. pousser : une séance → les membres acceptés du groupe qui n'ont
        pas coupé les rappels ; un événement → sa propriétaire ;
     5. purger rappels_envoyes au-delà de sept jours.
   Réponse : { ok, examines, dus, envoyes, echecs, supprimes, purges }.
   ========================================================================== */

import { json, appelAutorise, commeService, abonnementsDe, pousserATous, vapidPret, avecGarde, autoTest, messageDe } from "../../_push.js";

const GRACE_MS = 15 * 60 * 1000;
const HORIZON_MS = 7 * 24 * 3600 * 1000;
const PURGE_MS = 7 * 24 * 3600 * 1000;


/** Les rappels dus maintenant parmi des lignes { id, debut, rappels } :
    [{ ligne, minutes }]. Exporté pour les tests. */
export function rappelsDus(lignes, maintenant) {
  const dus = [];
  for (const l of lignes) {
    const debut = new Date(l.debut).getTime();
    if (!Array.isArray(l.rappels) || isNaN(debut)) continue;
    for (const m of l.rappels) {
      const minutes = Number(m);
      if (!Number.isInteger(minutes) || minutes < 0) continue;
      const echeance = debut - minutes * 60000;
      if (echeance <= maintenant && echeance > maintenant - GRACE_MS) dus.push({ ligne: l, minutes });
    }
  }
  return dus;
}


/** « Dans 1 h », « Dans 15 min », « Maintenant », « Demain ». */
export function libelleDelai(minutes) {
  if (minutes <= 0) return "Maintenant";
  if (minutes < 60) return "Dans " + minutes + " min";
  if (minutes < 1440) return "Dans " + (minutes % 60 ? Math.round(minutes / 60 * 10) / 10 : minutes / 60) + " h";
  if (minutes === 1440) return "Demain";
  return "Dans " + Math.round(minutes / 1440) + " jours";
}

function quand(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
}


/** Réserve (cible, minutes) ; vrai si c'est nous qui l'avons posée. */
async function reserver(env, cible, minutes) {
  const r = await commeService(env, "/rest/v1/rappels_envoyes?on_conflict=cible,minutes&select=cible", {
    method: "POST", prefer: "resolution=ignore-duplicates,return=representation",
    body: JSON.stringify({ cible, minutes }),
  });
  if (!r.ok) throw new Error("rappels_envoyes : " + r.status);
  const lignes = await r.json();
  return Array.isArray(lignes) && lignes.length === 1;
}


export const onRequestGet = avecGarde(async ({ env }) => json(await autoTest(env)));

export const onRequestPost = avecGarde(async (context) => {
  const { request, env } = context;
  if (!env.PUSH_SECRET || !env.SUPABASE_SERVICE_ROLE) {
    return json({ erreur: "expéditeur non configuré (PUSH_SECRET, SUPABASE_SERVICE_ROLE)" }, 503);
  }
  if (!appelAutorise(request, env)) return json({ erreur: "appel non autorisé" }, 401);
  if (!(await vapidPret(env))) return json({ erreur: "clés VAPID absentes ou mal formées" }, 503);

  const maintenant = Date.now();
  const de = new Date(maintenant - GRACE_MS).toISOString(), a = new Date(maintenant + HORIZON_MS).toISOString();
  const fenetre = "&rappels=neq.[]&debut=gte." + de + "&debut=lte." + a + "&order=debut.asc&limit=500";
  const [rS, rE] = await Promise.all([
    commeService(env, "/rest/v1/seances?select=id,groupe,titre,debut,lieu,rappels,groupes!seances_groupe_fkey(nom)" + fenetre),
    commeService(env, "/rest/v1/evenements?select=id,proprietaire,titre,debut,rappels,details" + fenetre),
  ]);
  if (rS.status === 404 || rE.status === 404) return json({ erreur: "colonne rappels absente (supabase/2026_notifications.sql)" }, 503);
  if (!rS.ok || !rE.ok) return json({ ok: false, erreur: "lecture impossible : seances " + rS.status + " " + (rS.ok ? "" : await messageDe(rS)) + " / evenements " + rE.status + " " + (rE.ok ? "" : await messageDe(rE)) });
  const seances = await rS.json(), evenements = await rE.json();

  const bilan = { ok: true, examines: seances.length + evenements.length, dus: 0, envoyes: 0, echecs: [], supprimes: 0, purges: 0, detail: [] };
  const taches = [];
  for (const { ligne, minutes } of rappelsDus(seances, maintenant)) taches.push({ type: "seance", ligne, minutes });
  for (const { ligne, minutes } of rappelsDus(evenements, maintenant)) taches.push({ type: "evenement", ligne, minutes });

  for (const t of taches) {
    const cible = t.type + ":" + t.ligne.id;
    let mien;
    try { mien = await reserver(env, cible, t.minutes); } catch (e) { bilan.echecs.push(e.message); continue; }
    if (!mien) continue;         /* déjà envoyé par un passage précédent */
    bilan.dus++;
    let membres, charge;
    if (t.type === "seance") {
      const rM = await commeService(env, "/rest/v1/membres?select=membre&groupe=eq." + encodeURIComponent(t.ligne.groupe) + "&statut=eq.accepte");
      membres = rM.ok ? (await rM.json()).map((l) => l.membre) : [];
      const nomGroupe = t.ligne.groupes && t.ligne.groupes.nom ? t.ligne.groupes.nom : "Groupe";
      charge = {
        titre: libelleDelai(t.minutes) + " : " + t.ligne.titre,
        corps: nomGroupe + " · " + quand(t.ligne.debut) + (t.ligne.lieu ? " · " + t.ligne.lieu : ""),
        url: "/groupes/groupe.html?id=" + t.ligne.groupe + "#seances",
        tag: "rappel:" + t.ligne.id,
        quand: new Date(maintenant).toISOString(),
      };
    } else {
      membres = [t.ligne.proprietaire];
      const d = t.ligne.details && typeof t.ligne.details === "object" ? t.ligne.details : {};
      charge = {
        titre: libelleDelai(t.minutes) + " : " + t.ligne.titre,
        corps: quand(t.ligne.debut) + (d.lieu ? " · " + d.lieu : ""),
        url: "/emploi/",
        tag: "rappel:" + t.ligne.id,
        quand: new Date(maintenant).toISOString(),
      };
    }
    try {
      const cibles = await abonnementsDe(env, membres, "rappels");
      const b = await pousserATous(env, cibles.abonnements, charge, { urgence: "high" });
      bilan.envoyes += b.envoyes; bilan.supprimes += b.supprimes; bilan.echecs.push(...b.echecs);
      bilan.detail.push({ cible, minutes: t.minutes, destinataires: cibles.destinataires, abonnements: cibles.abonnements.length, envoyes: b.envoyes });
    } catch (e) { bilan.echecs.push(e.message); }
  }

  /* la purge : ce qui a plus de sept jours n'est plus en concurrence avec rien */
  const rP = await commeService(env, "/rest/v1/rappels_envoyes?envoye_le=lt." + new Date(maintenant - PURGE_MS).toISOString() + "&select=cible",
    { method: "DELETE", prefer: "return=representation" });
  if (rP.ok) { const p = await rP.json(); bilan.purges = Array.isArray(p) ? p.length : 0; }
  return json(bilan);
});
