/* ==========================================================================
   /api/push/abonnement — ce navigateur, abonné aux notifications ou non
   ==========================================================================

   GET    ?endpoint=<url>  → { configure, cle_publique, abonne, appareils }
          « configure » : la clé VAPID publique est posée dans Cloudflare
          (sans elle, rien ne peut s'abonner : la page le dit). « abonne » :
          CET endpoint est enregistré à mon nom. « appareils » : combien de
          navigateurs le sont, tous appareils confondus.
   POST   { endpoint, p256dh, auth, navigateur?, ancien? } → { ok, appareils }
          Enregistre ce navigateur à mon nom (enregistrer_abonnement,
          supabase/2026_notifications.sql : un navigateur appartient à la
          dernière personne qui s'y abonne). « ancien » : l'endpoint que le
          navigateur vient de remplacer de lui-même (pushsubscriptionchange),
          retiré s'il est à moi.
   DELETE ?endpoint=<url>  → { ok, appareils }   retire ce navigateur
   DELETE ?tous=1          → { ok, appareils: 0 } retire tous les miens

   La route ne fait que vérifier la FORME (une adresse https, deux clés
   base64url de la bonne longueur — RFC 8291) avant d'appeler la base, qui
   recommence (contraintes). Aucun pouvoir propre : le jeton de la personne,
   la règle d'accès « abonnements_miens ». La clé privée VAPID n'est jamais
   ici — seulement dans l'expéditeur (envoyer.js), et elle n'en sort pas.

   Ce qu'un abonnement est : une adresse chez le service de push du
   navigateur (Google, Mozilla, Apple) et deux clés avec lesquelles on
   chiffre POUR ce navigateur. Le service de push transporte un paquet qu'il
   ne sait pas lire ; la notice /donnees.html le dit.
   ========================================================================== */

import { json, identifier, commeElle, messageDe } from "../../_emploi.js";

const B64URL_87 = /^[A-Za-z0-9_-]{87}$/;   /* 65 octets : la clé publique P-256 non compressée */
const B64URL_22 = /^[A-Za-z0-9_-]{22}$/;   /* 16 octets : le secret d'authentification */
const MAX_URL = 2000;


function tableAbsente() {
  return json({ erreur: "Les notifications ne sont pas encore ouvertes sur ce site (supabase/2026_notifications.sql).",
                indisponible: true }, 503);
}


/** Une adresse d'abonnement recevable : https, bornée. Exporté pour être
    testé sans serveur. */
export function endpointValide(v) {
  if (typeof v !== "string" || v.length > MAX_URL) return null;
  let u;
  try { u = new URL(v); } catch (e) { return null; }
  if (u.protocol !== "https:") return null;
  return u.href;
}


/** Ce que le navigateur a donné, ou null s'il manque quelque chose. */
export function abonnementValide(corps) {
  const c = corps && typeof corps === "object" ? corps : {};
  const endpoint = endpointValide(c.endpoint);
  if (!endpoint) return null;
  if (!B64URL_87.test(String(c.p256dh || ""))) return null;
  if (!B64URL_22.test(String(c.auth || ""))) return null;
  let navigateur = c.navigateur === undefined || c.navigateur === null ? null : String(c.navigateur).trim().slice(0, 120);
  if (navigateur === "") navigateur = null;
  return { endpoint, p256dh: c.p256dh, auth: c.auth, navigateur };
}


/** Mes abonnements (la règle d'accès ne rend que les miens ; on filtre
    aussi sur membre=eq.moi — piège n° 1). null = table absente. */
async function lesMiens(qui, env) {
  const r = await commeElle(qui.jeton, env,
    "/rest/v1/abonnements_push?select=endpoint,navigateur,cree_le,vu_le&membre=eq." + encodeURIComponent(qui.verdict.id));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("La base n'a pas répondu : " + ((await messageDe(r)) || r.status));
  const lignes = await r.json();
  return Array.isArray(lignes) ? lignes : [];
}


export async function onRequestGet(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const endpoint = new URL(request.url).searchParams.get("endpoint") || "";
  const configure = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
  let miens;
  try { miens = await lesMiens(qui, env); } catch (e) { return json({ erreur: e.message }, 502); }
  if (miens === null) return tableAbsente();
  return json({
    configure,
    cle_publique: configure ? env.VAPID_PUBLIC_KEY : null,
    abonne: !!endpoint && miens.some((a) => a.endpoint === endpoint),
    appareils: miens.length,
    navigateurs: miens.map((a) => a.navigateur || "navigateur inconnu"),
  });
}


export async function onRequestPost(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  if (!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)) {
    return json({ erreur: "Les notifications ne sont pas configurées sur ce site (clés VAPID absentes).", indisponible: true }, 503);
  }
  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  const a = abonnementValide(corps);
  if (!a) return json({ erreur: "Abonnement mal formé : il faut une adresse https et les deux clés du navigateur." }, 400);

  const r = await commeElle(qui.jeton, env, "/rest/v1/rpc/enregistrer_abonnement", {
    method: "POST",
    body: JSON.stringify({ endpoint_donne: a.endpoint, p256dh_donne: a.p256dh, auth_donne: a.auth, navigateur_donne: a.navigateur }),
  });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "L'abonnement n'a pas été enregistré." }, 400);

  /* l'ancien endpoint, si le navigateur vient d'en changer : le sien, ou rien */
  const ancien = endpointValide(corps && corps.ancien);
  if (ancien && ancien !== a.endpoint) {
    await commeElle(qui.jeton, env, "/rest/v1/abonnements_push?endpoint=eq." + encodeURIComponent(ancien)
      + "&membre=eq." + encodeURIComponent(qui.verdict.id), { method: "DELETE" });
  }

  /* relire : une écriture qui ne se relit pas n'est pas un succès */
  let miens;
  try { miens = await lesMiens(qui, env); } catch (e) { return json({ erreur: e.message }, 502); }
  if (!miens || !miens.some((x) => x.endpoint === a.endpoint)) {
    return json({ erreur: "La base n'a pas gardé l'abonnement." }, 502);
  }
  return json({ ok: true, appareils: miens.length }, 201);
}


export async function onRequestDelete(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const p = new URL(request.url).searchParams;
  const moi = "&membre=eq." + encodeURIComponent(qui.verdict.id);
  let filtre;
  if (p.get("tous") === "1") filtre = "";
  else {
    const endpoint = endpointValide(p.get("endpoint") || "");
    if (!endpoint) return json({ erreur: "Il faut l'adresse de l'abonnement, ou ?tous=1." }, 400);
    filtre = "&endpoint=eq." + encodeURIComponent(endpoint);
  }
  const r = await commeElle(qui.jeton, env, "/rest/v1/abonnements_push?select=endpoint" + moi + filtre, {
    method: "DELETE", prefer: "return=representation",
  });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "Rien n'a été retiré." }, 400);
  const parties = await r.json();
  let miens;
  try { miens = await lesMiens(qui, env); } catch (e) { return json({ erreur: e.message }, 502); }
  return json({ ok: true, retires: Array.isArray(parties) ? parties.length : 0, appareils: miens ? miens.length : 0 });
}
