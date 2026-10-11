/* ==========================================================================
   /api/push/parametres — ce que je veux recevoir
   ==========================================================================

   GET  → { parametres: { messages, rappels }, appareils }
   PUT  { messages?, rappels? } → { ok, parametres }

   Deux booléens par personne (parametres_notifications,
   supabase/2026_notifications.sql) : les messages de mes groupes, les
   rappels de séances et d'événements. Sans ligne, tout est reçu — c'est
   le défaut de la table, et c'est ce que la route répond quand elle ne
   trouve rien. Aucun pouvoir propre : le jeton de la personne, la règle
   d'accès « mes_parametres_notifications », l'écriture relue.

   L'expéditeur (envoyer.js, rappels.js) lit la même table avec la clé de
   service : une personne qui a coupé les messages n'en reçoit plus dès la
   ligne écrite, sans rien redéployer.
   ========================================================================== */

import { json, identifier, commeElle, messageDe } from "../../_emploi.js";

const DEFAUTS = { messages: true, rappels: true };
const COLS = "messages,rappels,maj_le";


function tableAbsente() {
  return json({ erreur: "Les notifications ne sont pas encore ouvertes sur ce site (supabase/2026_notifications.sql).",
                indisponible: true }, 503);
}


/** La ligne à écrire, ou null si rien n'a la forme d'un booléen. Exporté
    pour être testé sans serveur. */
export function parametresValides(corps) {
  const c = corps && typeof corps === "object" ? corps : {};
  const ligne = {};
  for (const k of Object.keys(DEFAUTS)) {
    if (k in c) {
      if (typeof c[k] !== "boolean") return null;
      ligne[k] = c[k];
    }
  }
  return Object.keys(ligne).length ? ligne : null;
}


async function lire(qui, env) {
  const moi = encodeURIComponent(qui.verdict.id);
  const [rP, rA] = await Promise.all([
    commeElle(qui.jeton, env, "/rest/v1/parametres_notifications?select=" + COLS + "&membre=eq." + moi),
    commeElle(qui.jeton, env, "/rest/v1/abonnements_push?select=endpoint&membre=eq." + moi),
  ]);
  if (rP.status === 404) return null;
  if (!rP.ok) throw new Error("La base n'a pas répondu : " + ((await messageDe(rP)) || rP.status));
  const lignes = await rP.json();
  const l = Array.isArray(lignes) && lignes[0] ? lignes[0] : null;
  const appareils = rA.ok ? (await rA.json()).length : 0;
  return {
    parametres: { messages: l ? !!l.messages : DEFAUTS.messages, rappels: l ? !!l.rappels : DEFAUTS.rappels },
    maj_le: l ? l.maj_le : null,
    appareils,
  };
}


export async function onRequestGet(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  let etat;
  try { etat = await lire(qui, env); } catch (e) { return json({ erreur: e.message }, 502); }
  if (!etat) return tableAbsente();
  return json(etat);
}


export async function onRequestPut(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  const ligne = parametresValides(corps);
  if (!ligne) return json({ erreur: "Il faut « messages » ou « rappels », vrai ou faux." }, 400);

  /* insertion ou mise à jour, en une écriture (on_conflict sur la clé) ;
     les colonnes non envoyées gardent leur valeur (merge-duplicates), ou
     le défaut de la table pour une première ligne */
  const r = await commeElle(qui.jeton, env,
    "/rest/v1/parametres_notifications?on_conflict=membre&select=" + COLS, {
      method: "POST", prefer: "resolution=merge-duplicates,return=representation",
      body: JSON.stringify(Object.assign({ membre: qui.verdict.id, maj_le: new Date().toISOString() }, ligne)),
    });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "Les paramètres n'ont pas été enregistrés." }, 400);
  const lignes = await r.json();
  const l = Array.isArray(lignes) && lignes[0] ? lignes[0] : null;
  if (!l) return json({ erreur: "La base n'a rien écrit." }, 502);
  for (const k of Object.keys(ligne)) {
    if (!!l[k] !== ligne[k]) return json({ erreur: "La base n'a pas gardé « " + k + " »." }, 502);
  }
  return json({ ok: true, parametres: { messages: !!l.messages, rappels: !!l.rappels }, maj_le: l.maj_le });
}
