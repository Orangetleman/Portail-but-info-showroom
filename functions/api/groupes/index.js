/* ==========================================================================
   /api/groupes — mes groupes, mes invitations, en créer un
   ==========================================================================

   GET   { groupes: [ { id, nom, description, cree_le, mon_role, membres,
                        fondateur (bool : c'est moi), peut_inviter,
                        non_lus, dernier_message, dernier,
                        prive (bool), avec: { id, pseudo } | null } ],
           invitations: [ { id, nom, description, invite_par } ],
           camarades: [ pseudo, ... ],
           non_lus: <total>, conversations_non_lues: <nombre de groupes avec du non-lu> }

   « prive » et « avec » (lot H) : une conversation privée est un groupe à
   deux (groupes.prive, supabase/2026_messagerie_privee.sql) ; « avec »
   est l'autre membre accepté (null s'il a quitté la conversation). La page
   la liste dans son volet « Privés », sous le pseudo de l'autre. Ni
   fondateur ni invitation dans un groupe privé — comme la base le dit.
   Tant que la colonne n'existe pas (migration pas passée), PostgREST
   répond 400 : on relit sans, et rien n'est privé.

   « chiffre_depuis », « enveloppes » et « cles » (lot H, session 2) : une
   conversation chiffrée rend, pour que la page déchiffre l'aperçu de son
   dernier message, mes enveloppes de clé de conversation (embarquées dans
   la même requête, filtrées sur moi) et, à part, les clés publiques des
   membres qui les ont faites (une requête pour toute la liste). Le dernier
   message d'une conversation chiffrée arrive avec « chiffre », « cle_version »
   et « auteur » ; « texte » y est vide.

   « non_lus » et « dernier_message » (lot F, puis la messagerie du 15
   septembre) : les messages du groupe que je n'ai pas encore lus (au-delà
   de ma marque dans `lectures`, les miens exclus), et le dernier message
   (texte tronqué, pseudo, date) — la ligne d'une conversation. Lus par la
   fonction SQL apercu_groupes() (supabase/2026_messagerie.sql), une
   requête pour tous les groupes. Tant qu'elle n'existe pas (404), l'ancien
   calcul : on embarque les 100 derniers numéros de messages de chaque
   groupe (limite PAR groupe, LATERAL) et ma ligne de lectures — plafonné
   à 100 (« 99+ »), sans texte du dernier message. Table lectures absente :
   tout compte 0, pas de fausse pastille. Les groupes sont rendus du plus
   récemment actif au plus ancien.

   « fondateur » et « peut_inviter » suivent les règles de la base (lot D,
   supabase/2026_roles_groupe.sql) ; la page s'en sert pour le menu ⋯ d'une
   carte. Tant que cette migration n'est pas passée, les colonnes
   parametres / promu_par n'existent pas : on relit sans, et tout membre
   peut inviter (le défaut de la base).

   « camarades » : les pseudos des membres acceptés de mes groupes, moi
   exclu, sans doublon, triés. C'est la seule définition de « camarade »
   qu'on ait : quelqu'un avec qui on est déjà dans un groupe. L'emploi du
   temps s'en sert pour proposer un nom dans « Avec qui » — proposer, pas
   imposer : le champ reste libre pour une personne hors du site.
   POST  { nom, description? } → { ok, id }

   Aucun pouvoir propre : le jeton de la personne, et la base décide
   (règles d'accès sur groupes/membres, fonction creer_groupe qui exige
   l'accès étendu). Le middleware garde déjà /api/groupes derrière
   reader_user ; la base recommence.

   Les aides communes (json, identifier, commeElle, messageDe) viennent de
   _emploi.js : elles n'ont rien de propre à l'emploi du temps.
   ========================================================================== */

import { json, identifier, commeElle, messageDe } from "../../_emploi.js";


function tableAbsente() {
  return json({ erreur: "Les groupes ne sont pas encore ouverts sur ce site "
                      + "(supabase/2026_groupes.sql).", indisponible: true }, 503);
}


export async function onRequestGet(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  /* Une requête : mes lignes de membres, avec le groupe et, pour chaque
     groupe, ses membres acceptés (pour l'effectif). Les groupes ne sont
     visibles que par ceux qui y sont liés : la règle d'accès fait le tri. */
  const moi = encodeURIComponent(qui.verdict.id);
  /* l'aperçu (non-lus, dernier message) par la fonction SQL ; 404 = la
     migration n'est pas passée, on comptera par l'embed */
  const rAp = await commeElle(qui.jeton, env, "/rest/v1/rpc/apercu_groupes", { method: "POST", body: "{}" });
  const apercu = new Map();
  if (rAp.ok) {
    const lignes = await rAp.json();
    for (const a of Array.isArray(lignes) ? lignes : []) apercu.set(a.groupe, a);
  }
  const avecApercu = rAp.ok;
  const requete = (avecRoles, avecLectures, avecPrive, avecChiffre) => "/rest/v1/membres?select=groupe,role_groupe,statut,invite_par,"
    + "groupes!membres_groupe_fkey(id,nom,description,cree_le,cree_par" + (avecRoles ? ",parametres" : "") + (avecPrive ? ",prive" : "")
    + (avecChiffre ? ",chiffre_depuis,enveloppes:cles_conversation!cles_conversation_groupe_fkey(version,membre,membre_version,par,par_version,sel,enveloppe)" : "") + ","
    + "membres!membres_groupe_fkey(membre,statut,role_groupe,cree_le,repondu_le,profil:profiles!membres_profil_fkey(pseudo))"
    + (avecLectures ? ",derniers:messages!messages_groupe_fkey(id,cree_le),lectures!lectures_groupe_fkey(dernier_lu)" : "")
    + "),inviteur:profiles!membres_invite_par_fkey(pseudo)"
    + "&membre=eq." + moi
    + (avecLectures
        ? "&groupes.derniers.order=id.desc&groupes.derniers.limit=" + PLAFOND_NON_LUS
          + "&groupes.lectures.membre=eq." + moi
        : "")
    + (avecChiffre ? "&groupes.enveloppes.membre=eq." + moi : "")
    + "&order=cree_le.desc";
  let avecRoles = true, avecLectures = !avecApercu, avecPrive = true, avecChiffre = true, sansRoles = false;
  let r = await commeElle(qui.jeton, env, requete(avecRoles, avecLectures, avecPrive, avecChiffre));
  /* 400 = une colonne ou une table inconnue : la migration de la messagerie
     privée (2026_messagerie_privee.sql, « prive »), celle des lectures
     (2026_discussion.sql) ou celle des rôles (2026_roles_groupe.sql) n'est
     pas passée. PostgREST nomme ce qui manque : on écarte cela, et on
     relit ; message muet, on écarte du plus récent au plus ancien. Sans les
     trois, les règles d'avant tiennent (seuls les administrateurs invitent,
     rien de compté, rien de privé). */
  for (let essai = 0; r.status === 400 && essai < 4; essai++) {
    const detail = await r.clone().text();
    if (avecChiffre && /chiffre|cles_conversation/.test(detail)) avecChiffre = false;
    else if (avecPrive && /prive/.test(detail)) avecPrive = false;
    else if (avecLectures && /lectures/.test(detail)) avecLectures = false;
    else if (avecRoles && /parametres/.test(detail)) { avecRoles = false; sansRoles = true; }
    else if (avecChiffre) avecChiffre = false;
    else if (avecPrive) avecPrive = false;
    else if (avecLectures) avecLectures = false;
    else if (avecRoles) { avecRoles = false; sansRoles = true; }
    else break;
    r = await commeElle(qui.jeton, env, requete(avecRoles, avecLectures, avecPrive, avecChiffre));
  }
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: "La base n'a pas répondu : " + ((await messageDe(r)) || r.status) }, 502);

  const lignes = await r.json();
  const groupes = [], invitations = [], camarades = new Set();
  let totalNonLus = 0, conversationsNonLues = 0;
  /* les clés publiques de ceux qui ont fait mes enveloppes (« par »), pour
     que la page les ouvre : une seule requête pour toute la liste */
  const auteursEnveloppes = new Set();
  for (const l of lignes) for (const e of (l.groupes && l.groupes.enveloppes) || []) if (e.par) auteursEnveloppes.add(e.par);
  const cles = {};
  if (auteursEnveloppes.size) {
    const rC = await commeElle(qui.jeton, env, "/rest/v1/cles_publiques?select=membre,version,algo,cle,empreinte,remplacee_le&membre=in.("
      + Array.from(auteursEnveloppes).map(encodeURIComponent).join(",") + ")&order=version.asc");
    if (rC.ok) for (const c of await rC.json()) { (cles[c.membre] = cles[c.membre] || []).push(c); }
  }
  for (const l of lignes) {
    const g = l.groupes;
    if (!g) continue;
    if (l.statut === "accepte") {
      const acceptes = (g.membres || []).filter((m) => m.statut === "accepte");
      const inviter = (g.parametres && g.parametres.inviter) || (sansRoles ? "admins" : "membres");
      const a = apercu.get(g.id);
      const nonLus = a ? { compte: Number(a.non_lus) || 0, dernier: a.dernier_le || null } : compterNonLus(g);
      totalNonLus += nonLus.compte;
      if (nonLus.compte > 0) conversationsNonLues++;
      const prive = g.prive === true;
      /* une conversation privée : l'autre membre accepté (null s'il est
         parti) ; le dernier message est-il le mien (« toi : … ») */
      const moiMembre = acceptes.find((m) => m.membre === qui.verdict.id);
      const autre = prive ? acceptes.find((m) => m.membre !== qui.verdict.id) : null;
      const monPseudo = moiMembre && moiMembre.profil ? moiMembre.profil.pseudo : null;
      groupes.push({
        id: g.id, nom: g.nom, description: g.description, cree_le: g.cree_le,
        mon_role: l.role_groupe,
        membres: acceptes.length,
        fondateur: !prive && fondateurDe(g, acceptes) === qui.verdict.id,
        peut_inviter: !prive && (l.role_groupe === "admin" || inviter !== "admins"),
        non_lus: nonLus.compte,
        dernier_message: nonLus.dernier,
        /* le dernier message, pour la ligne de conversation (aperçu seul) */
        dernier: a && a.dernier_id ? { id: a.dernier_id, texte: a.dernier_texte || "", pseudo: a.dernier_pseudo || null, le: a.dernier_le,
                                       mien: !!(monPseudo && a.dernier_pseudo === monPseudo),
                                       auteur: a.dernier_auteur || null, chiffre: a.dernier_chiffre || null, cle_version: a.dernier_cle_version || null } : null,
        prive: prive,
        avec: autre ? { id: autre.membre, pseudo: (autre.profil && autre.profil.pseudo) || "compte supprimé" } : null,
        chiffre_depuis: g.chiffre_depuis || null,
        enveloppes: prive ? (Array.isArray(g.enveloppes) ? g.enveloppes.filter((e) => e.membre === qui.verdict.id) : []) : [],
      });
      /* les camarades : les membres de mes GROUPES — une conversation
         privée n'en est pas un (l'autre est déjà un contact) */
      if (!prive) for (const m of acceptes) {
        if (m.membre !== qui.verdict.id && m.profil && m.profil.pseudo) camarades.add(m.profil.pseudo);
      }
    } else {
      invitations.push({
        id: g.id, nom: g.nom, description: g.description,
        invite_par: l.inviteur ? l.inviteur.pseudo : null,
      });
    }
  }
  /* du plus récemment actif au plus ancien : la conversation vivante en
     haut, comme dans toute messagerie ; sans message, la date de création */
  groupes.sort((x, y) => {
    const dx = x.dernier_message || x.cree_le || "", dy = y.dernier_message || y.cree_le || "";
    return dx < dy ? 1 : dx > dy ? -1 : 0;
  });
  return json({ groupes, invitations,
                camarades: Array.from(camarades).sort((a, b) => a.localeCompare(b, "fr")),
                non_lus: totalNonLus, conversations_non_lues: conversationsNonLues, apercu: avecApercu, cles });
}


/* Au-delà, la page dit « 99+ » : on n'embarque pas plus de numéros. */
const PLAFOND_NON_LUS = 100;

/** Les messages non lus d'un groupe : ceux dont le numéro dépasse ma marque.
    « derniers » (les PLAFOND_NON_LUS derniers numéros, filtrés par la règle
    d'accès) et « lectures » (ma ligne seule, filtrée dans la requête) sont
    absents quand la table n'existe pas encore : alors rien n'est compté. */
function compterNonLus(g) {
  const derniers = Array.isArray(g.derniers) ? g.derniers : [];
  const lecture = Array.isArray(g.lectures) && g.lectures[0] ? g.lectures[0] : null;
  const marque = lecture ? Number(lecture.dernier_lu) || 0 : 0;
  const compte = derniers.filter((m) => Number(m.id) > marque).length;
  const dernier = derniers.length ? derniers[0].cree_le || null : null;
  return { compte, dernier };
}


/** Le fondateur, comme fondateur_du_groupe() en base : cree_par s'il est
    membre accepté ; sinon le plus ancien administrateur accepté. */
function fondateurDe(g, acceptes) {
  if (g.cree_par && acceptes.some((m) => m.membre === g.cree_par)) return g.cree_par;
  const admins = acceptes.filter((m) => m.role_groupe === "admin").sort((a, b) => {
    const ra = a.repondu_le || "￿", rb = b.repondu_le || "￿";
    return ra < rb ? -1 : ra > rb ? 1 : (a.cree_le < b.cree_le ? -1 : a.cree_le > b.cree_le ? 1 : 0);
  });
  return admins.length ? admins[0].membre : null;
}


export async function onRequestPost(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  const nom = String((corps && corps.nom) || "").trim();
  const description = String((corps && corps.description) || "").trim();
  if (nom.length < 2 || nom.length > 60) return json({ erreur: "Il faut un nom, de 2 à 60 caractères." }, 400);
  if (description.length > 500) return json({ erreur: "La description fait 500 caractères au plus." }, 400);

  const r = await commeElle(qui.jeton, env, "/rest/v1/rpc/creer_groupe", {
    method: "POST",
    body: JSON.stringify({ nom_groupe: nom, description_groupe: description || null }),
  });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "Le groupe n'a pas été créé." }, 400);
  const id = await r.json();
  if (!id) return json({ erreur: "La base n'a rien écrit." }, 502);
  return json({ ok: true, id }, 201);
}
