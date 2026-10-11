/* ==========================================================================
   /api/groupes/:id — un groupe : tout ce qu'il contient, le modifier, le
   supprimer
   ==========================================================================

   GET     { groupe: { …, cree_par, parametres, prive }, mon_id, mon_role,
             mon_statut, fondateur (uuid), peut_inviter, membres: [ { id,
             pseudo, role, statut, depuis, promu_par, fondateur } ], seances,
             messages, lectures, mes_signalements,
             avec: { id, pseudo } | null, ouverte: bool  (conversation privée) }
           « groupe.chiffre_depuis » (lot H, session 2) dit si la
           conversation est chiffrée ; les messages portent alors
           « chiffre » et « cle_version », que la page déchiffre — la route
           les transmet tels quels.
           — une CONVERSATION PRIVÉE (lot H, groupes.prive) est un groupe à
           deux : « avec » est l'autre membre accepté (null s'il est parti),
           « ouverte » dit si l'on peut encore s'y écrire (les deux sont
           toujours en contact — conversation_ouverte(), c'est la règle
           d'accès messages_ecrits qui refuse pour de vrai). Ni fondateur ni
           invitation : la base le dit, la route le reflète.
           — ce que la règle d'accès laisse voir : un invité voit le groupe et
           ses membres, pas la discussion ni les séances (listes vides).
           L'administrateur du site, qui n'est pas membre, ne voit RIEN —
           sauf pendant un signalement ouvert (lot E) : le nom du groupe,
           les membres, et le message signalé avec ceux qui le précèdent
           (règle « messages_porte_signalement »). « ?fenetre=1 » relève la
           limite de messages à 600, pour qu'une fenêtre de 500 tienne.
           « mes_signalements » : ceux que la personne a déposés sur ce
           groupe, avec leur verdict.
           « fondateur » et « peut_inviter » sont calculés ici COMME la base
           les calcule (fondateur_du_groupe, peut_inviter dans
           supabase/2026_roles_groupe.sql) : la page s'en sert pour montrer
           ou cacher des boutons ; c'est la base qui refuse, le cas échéant.
   PATCH   { nom?, description?, parametres?: { inviter } } → le groupe relu.
           Admins du groupe (la base ne laisse écrire que ces colonnes-là :
           cree_par n'est pas à portée d'un PATCH).
   DELETE  → { ok }. Fondateur du groupe. Tout part avec (cascade).
   ========================================================================== */

import { json, identifier, commeElle, messageDe } from "../../../_emploi.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


export async function onRequestGet(context) {
  const { request, env, params } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const id = String(params.id || "");
  if (!UUID.test(id)) return json({ erreur: "Groupe inconnu." }, 400);

  const fenetre = new URL(request.url).searchParams.get("fenetre") === "1";
  const [rG, rM, rS, rX, rL, rSig] = await Promise.all([
    /* Les clés étrangères sont NOMMÉES : entre groupes et profiles il existe
       deux chemins (cree_par, et membres en table de liaison), et PostgREST
       refuse de choisir — PGRST201, vu en production le 12 septembre.
       « parametres » et « promu_par » n'existent que si 2026_roles_groupe.sql
       est passée : PostgREST répond 400 sinon, et on relit sans (lireAvecRepli). */
    lireAvecRepli(qui, env,
      "/rest/v1/groupes?select=id,nom,description,cree_le,cree_par,parametres,prive,chiffre_depuis,createur:profiles!groupes_cree_par_fkey(pseudo)&id=eq." + id,
      "/rest/v1/groupes?select=id,nom,description,cree_le,cree_par,parametres,prive,createur:profiles!groupes_cree_par_fkey(pseudo)&id=eq." + id,
      "/rest/v1/groupes?select=id,nom,description,cree_le,cree_par,parametres,createur:profiles!groupes_cree_par_fkey(pseudo)&id=eq." + id,
      "/rest/v1/groupes?select=id,nom,description,cree_le,cree_par,createur:profiles!groupes_cree_par_fkey(pseudo)&id=eq." + id),
    lireAvecRepli(qui, env,
      "/rest/v1/membres?select=membre,role_groupe,statut,cree_le,repondu_le,promu_par,profil:profiles!membres_profil_fkey(pseudo)"
      + "&groupe=eq." + id + "&order=cree_le.asc",
      "/rest/v1/membres?select=membre,role_groupe,statut,cree_le,repondu_le,profil:profiles!membres_profil_fkey(pseudo)"
      + "&groupe=eq." + id + "&order=cree_le.asc"),
    commeElle(qui.jeton, env,
      "/rest/v1/seances?select=id,titre,debut,fin,lieu,fiche,fiches,rappels,note,cree_le,cree_par,auteur:profiles!seances_cree_par_fkey(pseudo)"
      + "&groupe=eq." + id + "&order=debut.asc&limit=500"),
    lireAvecRepli(qui, env,
      "/rest/v1/messages?select=id,texte,cree_le,modifie_le,refs,reponse_a,auteur,chiffre,cle_version,qui:profiles!messages_auteur_fkey(pseudo)"
      + "&groupe=eq." + id + "&order=cree_le.desc&limit=" + (fenetre ? 600 : 200),
      "/rest/v1/messages?select=id,texte,cree_le,modifie_le,refs,reponse_a,auteur,qui:profiles!messages_auteur_fkey(pseudo)"
      + "&groupe=eq." + id + "&order=cree_le.desc&limit=" + (fenetre ? 600 : 200)),
    /* Les lectures : qui a lu jusqu'où. Table absente (migration
       2026_discussion.sql pas passée) : une liste vide, la page dit
       simplement « envoyé ». */
    commeElle(qui.jeton, env,
      "/rest/v1/lectures?select=membre,dernier_lu&groupe=eq." + id),
    /* Mes signalements sur ce groupe (piège n° 1 : « par=eq.moi » en plus
       de la règle d'accès). Table absente : liste vide. */
    commeElle(qui.jeton, env,
      "/rest/v1/signalements?select=id,message,motif,contexte,cree_le,verdict,verdict_note,verdict_le"
      + "&groupe=eq." + id + "&par=eq." + qui.verdict.id + "&order=cree_le.desc&limit=50"),
  ]);
  if (rG.status === 404) return json({ erreur: "Les groupes ne sont pas encore ouverts sur ce site.", indisponible: true }, 503);
  if (!rG.ok) return json({ erreur: "La base n'a pas répondu : " + ((await messageDe(rG)) || rG.status) }, 502);
  const groupes = await rG.json();
  if (!Array.isArray(groupes) || groupes.length !== 1) {
    return json({ erreur: "Ce groupe n'existe pas, ou tu n'en fais pas partie." }, 404);
  }
  const groupe = groupes[0];
  /* sans la migration des rôles (lecture de repli au-delà de la première
     forme), les règles d'avant tiennent : seuls les administrateurs
     invitent — on l'affiche tel quel, sinon un membre verrait « Inviter… »
     pour se faire refuser. Sans celle de la messagerie privée, rien n'est
     privé. */
  const sansRoles = rG.repli >= 3;
  if (!groupe.parametres || typeof groupe.parametres !== "object") groupe.parametres = { inviter: sansRoles ? "admins" : "membres" };
  groupe.prive = groupe.prive === true;
  groupe.chiffre_depuis = groupe.chiffre_depuis || null;
  const membres = rM.ok ? await rM.json() : [];
  const moi = membres.find((m) => m.membre === qui.verdict.id);
  const fondateur = groupe.prive ? null : fondateurDe(groupe, membres);
  /* une conversation privée : l'autre, et peut-on encore s'y écrire —
     demandé à la base, qui applique la même règle à l'insertion */
  const autre = groupe.prive ? membres.find((m) => m.membre !== qui.verdict.id && m.statut === "accepte") : null;
  let ouverte = !groupe.prive;
  if (groupe.prive) {
    const rO = await commeElle(qui.jeton, env, "/rest/v1/rpc/conversation_ouverte", { method: "POST", body: JSON.stringify({ g: id }) });
    ouverte = rO.ok && (await rO.json()) === true;
  }

  return json({
    groupe: groupe,
    mon_id: qui.verdict.id,
    mon_role: moi ? moi.role_groupe : null,
    mon_statut: moi ? moi.statut : null,
    fondateur: fondateur,
    peut_inviter: !groupe.prive && !!moi && moi.statut === "accepte"
      && (moi.role_groupe === "admin" || groupe.parametres.inviter !== "admins"),
    avec: autre ? { id: autre.membre, pseudo: (autre.profil && autre.profil.pseudo) || "compte supprimé" } : null,
    ouverte: ouverte,
    membres: membres.map((m) => ({
      id: m.membre, pseudo: (m.profil && m.profil.pseudo) || "compte supprimé",
      role: m.role_groupe, statut: m.statut, depuis: m.cree_le,
      promu_par: m.promu_par || null,
      fondateur: m.membre === fondateur,
    })),
    seances: await lireSeances(rS, qui, env, id),
    /* La discussion est renvoyée du plus ancien au plus récent : on l'a
       demandée dans l'autre sens pour prendre les 200 derniers. */
    messages: rX.ok ? (await rX.json()).reverse() : [],
    lectures: rL.ok ? await rL.json() : [],
    mes_signalements: rSig.ok ? await rSig.json() : [],
  });
}


/** Une lecture qui demande des colonnes récentes, et se rabat sur les formes
    plus anciennes, dans l'ordre, tant que PostgREST répond 400 (« colonne
    inconnue » : la migration n'est pas passée). Toute autre réponse est
    rendue telle quelle ; `repli` dit combien de formes ont été écartées
    (0 : la plus récente a été servie). */
async function lireAvecRepli(qui, env, ...chemins) {
  let r = null;
  for (let i = 0; i < chemins.length; i++) {
    r = await commeElle(qui.jeton, env, chemins[i]);
    r.repli = i;
    if (r.status !== 400 || i === chemins.length - 1) return r;
  }
  return r;
}


/** Le fondateur, comme fondateur_du_groupe() le calcule en base : cree_par
    s'il est membre accepté ; sinon le plus ancien administrateur accepté
    (repondu_le, puis cree_le). null si personne. */
function fondateurDe(groupe, membres) {
  if (groupe.cree_par && membres.some((m) => m.membre === groupe.cree_par && m.statut === "accepte")) {
    return groupe.cree_par;
  }
  const admins = membres.filter((m) => m.statut === "accepte" && m.role_groupe === "admin")
    .sort((a, b) => {
      const ra = a.repondu_le || "\uffff", rb = b.repondu_le || "\uffff";
      return ra < rb ? -1 : ra > rb ? 1 : (a.cree_le < b.cree_le ? -1 : a.cree_le > b.cree_le ? 1 : 0);
    });
  return admins.length ? admins[0].membre : null;
}


/** Les séances, avec leurs fiches et leurs rappels. Tant que
    2026_notifications.sql (« rappels ») ou 2026_seances_fiches.sql
    (« fiches ») n'est pas passée, PostgREST répond 400 : on relit sans la
    colonne récente, puis sans les deux, plutôt que de rendre une liste vide
    sans un mot. */
async function lireSeances(rS, qui, env, id) {
  if (rS.ok) return await rS.json();
  if (rS.status !== 400) return [];
  for (const cols of ["id,titre,debut,fin,lieu,fiche,fiches,note", "id,titre,debut,fin,lieu,fiche,note"]) {
    const r2 = await commeElle(qui.jeton, env,
      "/rest/v1/seances?select=" + cols + ",cree_le,cree_par,auteur:profiles!seances_cree_par_fkey(pseudo)"
      + "&groupe=eq." + id + "&order=debut.asc&limit=500");
    if (r2.ok) return await r2.json();
    if (r2.status !== 400) return [];
  }
  return [];
}


export async function onRequestPatch(context) {
  const { request, env, params } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const id = String(params.id || "");
  if (!UUID.test(id)) return json({ erreur: "Groupe inconnu." }, 400);

  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  const ligne = {};
  if ("nom" in corps) {
    const nom = String(corps.nom || "").trim();
    if (nom.length < 2 || nom.length > 60) return json({ erreur: "Le nom fait de 2 à 60 caractères." }, 400);
    ligne.nom = nom;
  }
  if ("description" in corps) {
    const d = String(corps.description || "").trim();
    if (d.length > 500) return json({ erreur: "500 caractères au plus." }, 400);
    ligne.description = d || null;
  }
  if ("parametres" in corps) {
    /* un seul réglage connu ; la base refuse toute autre clé (contrainte
       groupes_parametres_valides), on le fait ici d'abord pour parler clair */
    const p = corps.parametres && typeof corps.parametres === "object" ? corps.parametres : null;
    if (!p || Object.keys(p).some((k) => k !== "inviter")) return json({ erreur: "Paramètre inconnu." }, 400);
    if (!["membres", "admins"].includes(p.inviter)) return json({ erreur: "« Qui peut inviter » vaut « membres » ou « admins »." }, 400);
    ligne.parametres = { inviter: p.inviter };
  }
  if (!Object.keys(ligne).length) return json({ erreur: "Rien à modifier." }, 400);
  ligne.modifie_le = new Date().toISOString();

  const colonnes = "id,nom,description" + (ligne.parametres ? ",parametres" : "");
  const r = await commeElle(qui.jeton, env, "/rest/v1/groupes?id=eq." + id + "&select=" + colonnes, {
    method: "PATCH", prefer: "return=representation", body: JSON.stringify(ligne),
  });
  if (!r.ok) {
    const m = (await messageDe(r)) || "";
    /* la colonne « parametres » n'existe pas encore : la migration des rôles */
    if (ligne.parametres && r.status === 400 && /parametres/.test(m)) {
      return json({ erreur: "Les paramètres de groupe ne sont pas encore ouverts sur ce site (supabase/2026_roles_groupe.sql).", indisponible: true }, 503);
    }
    return json({ erreur: m || "La modification a échoué." }, 400);
  }
  const lignes = await r.json();
  if (!Array.isArray(lignes) || lignes.length !== 1) {
    return json({ erreur: "Ce groupe n'existe pas, ou tu n'en es pas administrateur." }, 404);
  }
  return json({ ok: true, groupe: lignes[0] });
}


export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const id = String(params.id || "");
  if (!UUID.test(id)) return json({ erreur: "Groupe inconnu." }, 400);

  const r = await commeElle(qui.jeton, env, "/rest/v1/groupes?id=eq." + id + "&select=id", {
    method: "DELETE", prefer: "return=representation",
  });
  if (!r.ok) return json({ erreur: "La suppression a échoué." }, 400);
  const lignes = await r.json();
  if (!Array.isArray(lignes) || lignes.length !== 1) {
    return json({ erreur: "Ce groupe n'existe pas, ou tu n'en es pas le fondateur : seul le fondateur peut le supprimer." }, 404);
  }
  return json({ ok: true });
}
