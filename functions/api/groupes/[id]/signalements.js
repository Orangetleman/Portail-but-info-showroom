/* ==========================================================================
   /api/groupes/:id/signalements — signaler un message de la discussion
   ==========================================================================

   POST  { message, motif, texte?, contexte? }
         → 201 { ok, id, contexte, note }

   « motif » : illicite | harcelement | spam | autre. « contexte » : le
   nombre de messages qui précèdent le message signalé et que le
   signalement ouvre à l'administrateur du site (50 par défaut, 0 à 500 —
   décision 2 de la feuille de route : c'est la personne qui signale qui
   choisit). « texte » : mille caractères au plus, facultatif.

   La route ne fait que vérifier la forme et transmettre : c'est la fonction
   SQL « signaler » (supabase/2026_signalements.sql) qui vérifie que la
   personne est membre du groupe, que le message est bien dans CE groupe et
   n'est pas le sien, qu'il n'y a pas déjà un signalement ouvert de sa part
   sur ce message — et qui ouvre la porte en l'inscrivant au journal.

   Ce qu'on relit : l'identifiant renvoyé par la fonction. Pas d'identifiant,
   pas de succès.
   ========================================================================== */

import { json, identifier, commeElle, messageDe } from "../../../_emploi.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MOTIFS = ["illicite", "harcelement", "spam", "autre"];
export const CONTEXTE_DEFAUT = 50;
export const CONTEXTE_MAX = 500;


export async function onRequestPost(context) {
  const { request, env, params } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const id = String(params.id || "");
  if (!UUID.test(id)) return json({ erreur: "Groupe inconnu." }, 400);

  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  corps = corps && typeof corps === "object" ? corps : {};

  const num = String(corps.message === undefined || corps.message === null ? "" : corps.message);
  if (!/^\d{1,12}$/.test(num)) return json({ erreur: "Message inconnu." }, 400);
  const motif = String(corps.motif || "").trim();
  if (!MOTIFS.includes(motif)) return json({ erreur: "Motif inconnu : illicite, harcelement, spam ou autre." }, 400);
  const texte = String(corps.texte || "").trim();
  if (texte.length > 1000) return json({ erreur: "Le texte du signalement fait 1000 caractères au plus." }, 400);
  /* le contexte : un entier, borné ici pour parler clair — la base le borne
     aussi (deux fois : la fonction, puis la contrainte) */
  let contexte = CONTEXTE_DEFAUT;
  if (corps.contexte !== undefined && corps.contexte !== null && corps.contexte !== "") {
    const c = Number(corps.contexte);
    if (!Number.isInteger(c) || c < 0 || c > CONTEXTE_MAX) {
      return json({ erreur: "Le contexte transmis va de 0 à " + CONTEXTE_MAX + " messages." }, 400);
    }
    contexte = c;
  }

  /* Conversation chiffrée (lot H, session 2) : le contenu DÉCHIFFRÉ par la
     personne qui signale — le message et ceux qui le précèdent — sans quoi
     l'administrateur ne lirait que des octets. Un tableau de { id, auteur,
     le, texte }, borné ici en forme ; la base vérifie que chaque numéro
     est dans la fenêtre et que le message signalé y est. */
  let contenu = null;
  if (corps.contenu !== undefined && corps.contenu !== null) {
    if (!Array.isArray(corps.contenu) || corps.contenu.length > contexte + 1) {
      return json({ erreur: "Contenu transmis mal formé : au plus le message signalé et les " + contexte + " qui le précèdent." }, 400);
    }
    contenu = [];
    for (const e of corps.contenu) {
      const eid = Number(e && e.id);
      if (!e || typeof e !== "object" || !Number.isInteger(eid) || eid <= 0
          || typeof e.texte !== "string" || e.texte.length > 2000
          || typeof e.auteur !== "string" || e.auteur.length > 40
          || typeof e.le !== "string" || e.le.length > 40) {
        return json({ erreur: "Contenu transmis mal formé." }, 400);
      }
      contenu.push({ id: eid, auteur: e.auteur, le: e.le, texte: e.texte });
    }
    if (!contenu.some((e) => e.id === Number(num))) return json({ erreur: "Le contenu transmis doit contenir le message signalé." }, 400);
  }

  const appel = { g: id, m: Number(num), motif_donne: motif, texte_donne: texte || null, contexte_donne: contexte };
  if (contenu) appel.contenu_donne = contenu;
  const r = await commeElle(qui.jeton, env, "/rest/v1/rpc/signaler", { method: "POST", body: JSON.stringify(appel) });
  if (r.status === 404) {
    return json({ erreur: "Les signalements ne sont pas encore ouverts sur ce site (supabase/2026_signalements.sql).",
                  indisponible: true }, 503);
  }
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "Le signalement n'a pas été enregistré." }, r.status === 403 ? 403 : 400);

  const rendu = await r.json();
  const numero = Number(rendu);
  if (!Number.isInteger(numero) || numero <= 0) return json({ erreur: "La base n'a rien écrit." }, 502);
  return json({
    ok: true, id: numero, contexte,
    note: contenu
      ? "Signalement envoyé, avec " + contenu.length + " message" + (contenu.length > 1 ? "s" : "") + " déchiffré" + (contenu.length > 1 ? "s" : "")
        + " que tu as transmis à l'administrateur du site ; tu verras le verdict ici."
      : "Signalement envoyé. L'administrateur du site pourra lire ce message et les "
        + contexte + " qui le précèdent, le temps de rendre un verdict ; tu le verras ici.",
  }, 201);
}
