/* ==========================================================================
   /api/push/envoyer — un message vient d'être écrit : prévenir le groupe
   ==========================================================================

   POST, appelé par la BASE (déclencheur messages_push, pg_net —
   supabase/2026_notifications.sql), jamais par une page. Corps : la forme
   des « Database Webhooks » de Supabase,

     { type: "INSERT", table: "messages", schema: "public",
       record: { id, groupe, auteur, texte, cree_le } }

   Garde : l'en-tête X-Push-Secret doit être PUSH_SECRET (posé dans
   Cloudflare et dans le coffre Supabase). Sans la variable : 503, fail
   closed — personne ne peut faire pousser le site à sa place. Ce chemin
   n'est PAS dans les zones du middleware (pas de cookie ici), c'est ce
   secret qui tient la porte.

   Ce qu'elle fait, avec la clé de service (c'est l'expéditeur : il lit
   les abonnements de tout un groupe, et n'en renvoie rien) :
     1. les membres ACCEPTÉS du groupe, l'auteur exclu ;
     2. moins ceux qui ont coupé « messages » dans leurs paramètres ;
     3. leurs abonnements ; une notification par navigateur, chiffrée pour
        lui (functions/_push.js) : le nom du groupe en titre, « pseudo :
        extrait » en corps, la page du groupe au clic, un tag par groupe
        (la nouvelle remplace la précédente au lieu d'empiler) ;
     4. les abonnements que le service de push dit morts (404, 410) sont
        effacés.
   Réponse : { ok, destinataires, abonnements, envoyes, echecs, supprimes }.
   La base n'attend pas cette réponse (pg_net) ; elle se lit dans
   net._http_response pour vérifier.

   Coût : une exécution par message écrit (conception § 12) — tenable ; et
   autant d'appels sortants qu'il y a de navigateurs abonnés dans le groupe.
   ========================================================================== */

import { json, appelAutorise, commeService, abonnementsDe, pousserATous, extrait, vapidPret, avecGarde, autoTest, messageDe } from "../../_push.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


/** Le message tel que la base l'a envoyé, ou null. Exporté pour les tests. */
export function messageValide(corps) {
  const c = corps && typeof corps === "object" ? corps : {};
  if (c.type !== "INSERT" || c.table !== "messages") return null;
  const r = c.record && typeof c.record === "object" ? c.record : null;
  if (!r) return null;
  const id = Number(r.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (!UUID.test(String(r.groupe || ""))) return null;
  const auteur = r.auteur && UUID.test(String(r.auteur)) ? String(r.auteur) : null;
  return { id, groupe: String(r.groupe), auteur, texte: String(r.texte || ""), cree_le: r.cree_le || null,
           /* lot H, session 2 : un message chiffré de bout en bout — l'expéditeur
              n'en voit que l'existence, et la notification ne dira rien du texte */
           chiffre: typeof r.chiffre === "string" && r.chiffre.length > 0 };
}


/** GET : l'auto-test, sans secret — les clés sont-elles utilisables dans
    CE runtime ? (https://exemple.fr/api/push/envoyer dans un
    navigateur) */
export const onRequestGet = avecGarde(async ({ env }) => json(await autoTest(env)));

export const onRequestPost = avecGarde(async (context) => {
  const { request, env } = context;
  if (!env.PUSH_SECRET || !env.SUPABASE_SERVICE_ROLE) {
    return json({ erreur: "expéditeur non configuré (PUSH_SECRET, SUPABASE_SERVICE_ROLE)" }, 503);
  }
  if (!appelAutorise(request, env)) return json({ erreur: "appel non autorisé" }, 401);
  if (!(await vapidPret(env))) return json({ erreur: "clés VAPID absentes ou mal formées" }, 503);

  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  const m = messageValide(corps);
  if (!m) return json({ erreur: "pas un message inséré" }, 400);

  /* 1. qui : les membres acceptés, sauf l'auteur ; le nom du groupe ; le pseudo */
  const g = encodeURIComponent(m.groupe);
  let [rM, rG, rA] = await Promise.all([
    commeService(env, "/rest/v1/membres?select=membre&groupe=eq." + g + "&statut=eq.accepte" + (m.auteur ? "&membre=neq." + encodeURIComponent(m.auteur) : "")),
    commeService(env, "/rest/v1/groupes?select=nom,prive&id=eq." + g),
    m.auteur ? commeService(env, "/rest/v1/profiles?select=pseudo&id=eq." + encodeURIComponent(m.auteur)) : Promise.resolve(null),
  ]);
  if (!rM.ok) return json({ ok: false, erreur: "membres illisibles : " + rM.status + " " + (await messageDe(rM)) });
  /* « prive » n'existe qu'avec 2026_messagerie_privee.sql : 400 sinon, on relit sans */
  if (rG.status === 400) rG = await commeService(env, "/rest/v1/groupes?select=nom&id=eq." + g);
  const membres = (await rM.json()).map((l) => l.membre);
  const groupes = rG.ok ? await rG.json() : [];
  const nomGroupe = groupes[0] && groupes[0].nom ? groupes[0].nom : "Groupe";
  const prive = !!(groupes[0] && groupes[0].prive === true);
  const profils = rA && rA.ok ? await rA.json() : [];
  const pseudo = profils[0] && profils[0].pseudo ? profils[0].pseudo : "quelqu'un";
  if (!membres.length) return json({ ok: true, destinataires: 0, abonnements: 0, envoyes: 0, echecs: [], supprimes: 0 });

  /* 2. et 3. — une conversation privée (lot H) n'a pas de nom : le pseudo
     de l'auteur en titre, le message seul en corps */
  let cibles;
  try { cibles = await abonnementsDe(env, membres, "messages"); }
  catch (e) { return json({ ok: false, erreur: e.message }); }
  const charge = {
    titre: prive ? pseudo : nomGroupe,
    corps: m.chiffre ? "Nouveau message" : (prive ? "" : pseudo + " : ") + (extrait(m.texte) || "(un message)"),
    url: "/groupes/groupe.html?id=" + m.groupe + "#m" + m.id,
    tag: "groupe:" + m.groupe,
    quand: m.cree_le,
  };
  const bilan = await pousserATous(env, cibles.abonnements, charge);
  return json(Object.assign({ ok: true, destinataires: cibles.destinataires, abonnements: cibles.abonnements.length }, bilan));
});
