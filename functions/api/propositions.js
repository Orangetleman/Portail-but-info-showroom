/* ==========================================================================
   /api/propositions — proposer quelque chose au site, et relire ses envois
   ==========================================================================

   GET   { propositions: [ { id, type, cible, cible_titre, texte, motivation,
           etat, note, cree_le, traite_le } ] } — les propositions de la
           personne connectée, la plus récente en premier (20 au plus).
   POST  { type, cible, cible_titre, texte, motivation } → { ok, id } —
           dépose une proposition. `type` ∈ correction | ajout | technique |
           fonctionnalite ; `cible` suit la grammaire du lot L : une RACINE
           — une fiche (S1-R104-06), un module (S1-R104) ou une page
           (/quiz/) — suivie d'une ANCRE facultative désignant une zone
           (#filtres, #la-chaine-de-compilation). `cible_titre` est le nom
           lisible de cette zone au moment de l'envoi (« Les filtres du
           quiz ») : il permet de relire une proposition dont la zone a
           disparu depuis. Les deux sont posés par la page — jamais tapés
           par la personne.

   Aucun pouvoir ici (comme /api/demande) : le jeton de la personne part à
   PostgREST, la règle « propositions_les_miennes » lit, la fonction
   « proposer » écrit après avoir tout vérifié (supabase/
   2026_propositions.sql). La route vérifie la FORME avant d'appeler, pour
   répondre en français sans aller-retour ; la base recommence, et c'est
   voulu. Le middleware garde /api/propositions derrière « connecté ».
   ========================================================================== */

import { json, identifier, commeElle, messageDe } from "../_emploi.js";

export const TYPES = ["correction", "ajout", "technique", "fonctionnalite"];
/* La grammaire des cibles (lot L), la même qu'en base — une racine, une
   ancre facultative. Le « -NN » facultatif, c'est le module entier ; l'ancre
   sur une page, c'est une zone de cette page. Rien n'énumère les zones ici :
   le site les déclare, on ne vérifie que la forme. */
export const CIBLE_FICHE = /^S\d-[A-Z]\d{3}(-\d{2})?(#[a-z0-9-]{1,120})?$/;
export const CIBLE_PAGE = /^\/[a-z0-9/._-]{0,120}(#[a-z0-9-]{1,120})?$/;
export const MAX_CIBLE_TITRE = 200;
const COLS = "id,type,cible,texte,motivation,etat,note,cree_le,traite_le";
const INDISPONIBLE = "Les propositions ne sont pas encore ouvertes sur ce site (supabase/2026_propositions.sql).";


/** La forme d'une proposition, ou le message qui dit ce qui cloche. */
export function verifierProposition(corps) {
  const c = corps && typeof corps === "object" ? corps : {};
  const type = String(c.type || "").trim();
  const cible = String(c.cible || "").trim();
  const texte = String(c.texte || "").trim();
  const motivation = String(c.motivation || "").trim();
  /* Le titre est facultatif : une page servie depuis un cache ancien
     n'en envoie pas, et sa proposition doit partir quand même. */
  const cibleTitre = String(c.cible_titre || "").trim();
  if (!TYPES.includes(type)) return { erreur: "Type de proposition inconnu." };
  if (!(CIBLE_FICHE.test(cible) || CIBLE_PAGE.test(cible))) {
    return { erreur: "La cible n'a pas la forme attendue (une fiche, un module, une page, ou une zone de l'un des trois)." };
  }
  if ((type === "correction" || type === "ajout") && cible.startsWith("/")) {
    return { erreur: "Corriger ou ajouter vise une fiche ou un module, pas une page du site." };
  }
  if (cibleTitre.length > MAX_CIBLE_TITRE) {
    return { erreur: "Le nom de la zone visée fait " + MAX_CIBLE_TITRE + " caractères au plus." };
  }
  if (texte.length < 10) return { erreur: "Dis ce que tu proposes : dix caractères au moins." };
  if (texte.length > 5000) return { erreur: "La proposition fait 5000 caractères au plus." };
  if (motivation.length < 40) {
    return { erreur: "Motive ta proposition : quarante caractères au moins, c'est ce qui la fait lire." };
  }
  if (motivation.length > 2000) return { erreur: "La motivation fait 2000 caractères au plus." };
  return { ok: true, type, cible, texte, motivation, cible_titre: cibleTitre || null };
}


export async function onRequestGet(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  /* Filtré sur la personne (piège n° 1 de conception § 7 bis : une règle permissive
     sert une requête approximative). La règle d'accès le fait déjà ; le
     filtre le dit. */
  const mesPropositions = (colonnes) =>
    commeElle(qui.jeton, env, "/rest/v1/propositions?select=" + colonnes
      + "&par=eq." + encodeURIComponent(qui.verdict.id) + "&order=cree_le.desc&limit=20");

  let r = await mesPropositions(COLS + ",cible_titre");
  /* Tant que supabase/2026_propositions_2.sql n'est pas passée, la colonne
     n'existe pas : PostgREST répond 400. Le lot G marche toujours, on ne va
     pas répondre « pas encore ouvert » pour autant — on relit sans elle. */
  if (r.status === 400 && /cible_titre/.test((await messageDe(r)) || "")) {
    r = await mesPropositions(COLS);
  }
  if (r.status === 404) {
    return json({ propositions: [], indisponible: true, note: INDISPONIBLE });
  }
  if (!r.ok) return json({ erreur: "La base n'a pas répondu." }, 502);
  const lignes = await r.json();
  return json({ propositions: Array.isArray(lignes) ? lignes : [] });
}


export async function onRequestPost(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  const v = verifierProposition(corps);
  if (!v.ok) return json({ erreur: v.erreur }, 400);

  const deposer = (avecTitre) => {
    const corps = { type_donne: v.type, cible_donnee: v.cible,
                    texte_donne: v.texte, motivation_donnee: v.motivation };
    if (avecTitre) corps.titre_donne = v.cible_titre;
    return commeElle(qui.jeton, env, "/rest/v1/rpc/proposer", { method: "POST", body: JSON.stringify(corps) });
  };

  let r = await deposer(v.cible_titre !== null);
  /* Même raison qu'au GET : sans la migration du lot L, la fonction n'a que
     quatre arguments et PostgREST ne trouve pas la signature à cinq (404).
     On redépose sans le titre plutôt que de perdre la proposition — c'est
     la zone visée qui compte, le titre n'est qu'un confort de relecture. */
  if (r.status === 404 && v.cible_titre !== null) r = await deposer(false);
  if (r.status === 404) return json({ erreur: INDISPONIBLE, indisponible: true }, 503);
  if (!r.ok) {
    const m = await messageDe(r);
    return json({ erreur: m || "La proposition n'a pas pu être enregistrée." }, 400);
  }
  /* La fonction renvoie l'identifiant créé : la preuve que la ligne existe.
     Une réponse vide serait un « ça a marché » sans rien derrière. */
  const id = await r.json();
  if (typeof id !== "number") return json({ erreur: "La base n'a rien écrit." }, 502);
  return json({ ok: true, id,
                note: "Merci. Ta proposition sera lue par l'administrateur ; tu verras sa réponse sur ta page Mon compte." });
}
