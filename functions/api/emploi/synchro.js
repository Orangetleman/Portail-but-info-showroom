/* ==========================================================================
   /api/emploi/synchro — relire les liens ICS suivis
   ==========================================================================

   POST  { id? } → synchronise un calendrier (id) ou tous ceux de la
         personne. Réponse : { bilans: [ { id, nom, ok, ecrits, supprimes,
         ignores, erreur? } ] }.

   Le serveur va chercher le calendrier à l'adresse enregistrée, le lit
   (_ics.js), et verse les événements avec le jeton de la personne
   (_emploi.js, verserCalendrier). Il ne garde rien : pas de cache, pas de
   copie. La synchronisation est déclenchée par la page — à l'ouverture si
   la dernière date de plus de six heures, ou sur le bouton — jamais par une
   tâche de fond : c'est la personne qui consulte SON calendrier, quand elle
   le consulte.

   Ce qui peut mal tourner, et ce qu'on en dit : l'adresse ne répond pas ;
   elle répond autre chose qu'un calendrier (une page de connexion, par
   exemple — c'est le cas d'un lien expiré) ; le calendrier est vide. Chaque
   cas est écrit dans « dernier_etat », que la page affiche à côté du lien.
   ========================================================================== */

import { json, identifier, commeElle, verserCalendrier, tableAbsente } from "../../_emploi.js";
import { lireCalendrier } from "../../_ics.js";

const TAILLE_MAX = 3 * 1024 * 1024;       // un emploi du temps annuel fait quelques centaines de ko
const DELAI_MS = 15000;


/** Va chercher le texte d'un calendrier. { ok, texte } ou { ok:false, erreur }. */
async function telecharger(url) {
  const arret = new AbortController();
  const minuterie = setTimeout(() => arret.abort(), DELAI_MS);
  try {
    const r = await fetch(url, {
      headers: { "Accept": "text/calendar, text/plain;q=0.8, */*;q=0.1",
                 "User-Agent": "exemple.fr (emploi du temps personnel)" },
      redirect: "follow",
      signal: arret.signal,
    });
    if (!r.ok) return { ok: false, erreur: "l'adresse répond " + r.status };
    const longueur = Number(r.headers.get("content-length") || 0);
    if (longueur > TAILLE_MAX) return { ok: false, erreur: "fichier trop gros" };
    const texte = await r.text();
    if (texte.length > TAILLE_MAX) return { ok: false, erreur: "fichier trop gros" };
    return { ok: true, texte };
  } catch (err) {
    return { ok: false, erreur: err.name === "AbortError" ? "l'adresse ne répond pas (15 s)" : "l'adresse est injoignable" };
  } finally {
    clearTimeout(minuterie);
  }
}


/** Synchronise UN calendrier et écrit son état. Renvoie le bilan. */
export async function synchroniser(jeton, env, cal) {
  const bilan = { id: cal.id, nom: cal.nom, ok: false, ecrits: 0, supprimes: 0, ignores: 0 };

  const t = await telecharger(cal.url);
  if (!t.ok) {
    bilan.erreur = t.erreur;
  } else if (!/BEGIN:VCALENDAR/i.test(t.texte)) {
    /* Une page HTML à la place du fichier : le cas d'un lien qui demande
       une connexion, ou qui a expiré. Le dire sauve une heure de doute. */
    bilan.erreur = "l'adresse ne renvoie pas un calendrier (lien expiré, ou page de connexion ?)";
  } else {
    const lu = lireCalendrier(t.texte, "Europe/Paris");
    bilan.ignores = lu.ignores;
    if (!lu.evenements.length) {
      bilan.erreur = "le calendrier est vide";
    } else {
      const v = await verserCalendrier(jeton, env, lu.evenements, cal.id);
      if (!v.ok) bilan.erreur = v.erreur || "la base a refusé l'écriture";
      else { bilan.ok = true; bilan.ecrits = v.ecrits; bilan.supprimes = v.supprimes; }
    }
  }

  const etat = bilan.ok
    ? bilan.ecrits + " événement" + (bilan.ecrits > 1 ? "s" : "")
      + (bilan.supprimes ? ", " + bilan.supprimes + " retiré" + (bilan.supprimes > 1 ? "s" : "") : "")
      + (bilan.ignores ? ", " + bilan.ignores + " illisible" + (bilan.ignores > 1 ? "s" : "") : "")
    : "échec : " + bilan.erreur;

  /* L'état est écrit même en cas d'échec — surtout en cas d'échec : c'est là
     qu'il renseigne. On relit la ligne pour la renvoyer telle qu'elle est. */
  const r = await commeElle(jeton, env,
    "/rest/v1/calendriers?id=eq." + cal.id + "&select=id,nom,url,derniere_synchro,dernier_etat", {
      method: "PATCH",
      prefer: "return=representation",
      body: JSON.stringify({ derniere_synchro: new Date().toISOString(), dernier_etat: etat }),
    });
  if (r.ok) {
    const lignes = await r.json();
    if (Array.isArray(lignes) && lignes.length === 1) bilan.calendrier = lignes[0];
  }
  bilan.etat = etat;
  return bilan;
}


export async function onRequestPost(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  let corps = {};
  try { corps = await request.json(); } catch (err) { /* sans corps : tous */ }
  const id = corps && corps.id ? String(corps.id) : "";

  const r = await commeElle(qui.jeton, env,
    "/rest/v1/calendriers?select=id,nom,url" + (id ? "&id=eq." + encodeURIComponent(id) : ""));
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: "La base n'a pas répondu." }, 502);
  const cals = await r.json();
  if (!Array.isArray(cals) || !cals.length) {
    return json({ erreur: id ? "Ce calendrier n'existe pas, ou n'est pas à toi." : "Aucun lien à synchroniser." }, 404);
  }

  const bilans = [];
  for (const cal of cals) bilans.push(await synchroniser(qui.jeton, env, cal));
  return json({ bilans });
}
