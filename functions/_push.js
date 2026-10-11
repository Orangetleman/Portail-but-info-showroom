/* ==========================================================================
   Web Push — chiffrer pour un navigateur, signer pour son service de push
   ==========================================================================

   Ce que partagent /api/push/envoyer (chaque message) et /api/push/rappels
   (la tâche toutes les cinq minutes) : reconnaître la base qui appelle,
   parler à PostgREST avec la clé de service, et surtout POUSSER — c'est-
   à-dire fabriquer, pour chaque navigateur abonné, un paquet que son
   service de push (Google, Mozilla, Apple) transporte sans pouvoir le lire,
   et que le service worker du navigateur (site/sw.js) déchiffre.

   Deux normes, écrites ici sans bibliothèque (Cloudflare ne fournit que
   WebCrypto, et c'est suffisant) :

     RFC 8291 — le chiffrement (« aes128gcm »). Le navigateur a donné une
       clé publique P-256 (p256dh) et 16 octets de secret (auth). On tire
       une paire de clés éphémère, on fait un échange ECDH avec la clé du
       navigateur, puis deux HKDF (le secret auth, puis un sel aléatoire)
       donnent une clé AES-128-GCM et un nonce. Le corps envoyé est :
       sel (16) | taille d'enregistrement (4) | longueur de clé (1) |
       clé publique éphémère (65) | texte chiffré (+ 16 octets d'étiquette).
       Le texte clair reçoit un octet 0x02 de fin d'enregistrement avant
       chiffrement. Un seul enregistrement : une notification tient dans
       4096 octets.

     RFC 8292 — VAPID. Le service de push veut savoir QUI pousse : un
       JWT ES256 (aud = l'origine du service, exp ≤ 24 h, sub = un contact)
       signé de la clé privée du site, et la clé publique à côté :
       « Authorization: vapid t=<jwt>, k=<clé> ». Le navigateur s'est
       abonné avec cette même clé publique (applicationServerKey) : le
       service refuse tout paquet signé d'une autre.

   Les clés VAPID vivent dans les variables de Cloudflare — la privée en
   secret, jamais dans le dépôt (docs/deploiement.md). Le format est celui
   de la bibliothèque web-push : la publique, 65 octets (point non
   compressé) en base64url ; la privée, ses 32 octets (le scalaire d) en
   base64url. C'est ce que produit la commande donnée dans deploiement.md.

   Testé contre le vecteur de l'annexe A de la RFC 8291 (sel et paire
   éphémère injectés) : le corps obtenu est identique octet pour octet ;
   la signature VAPID est vérifiée par node avec la clé publique seule.
   ========================================================================== */

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const TAILLE_ENREGISTREMENT = 4096;
const MAX_CHARGE = 3800;     /* 4096 moins l'en-tête, l'étiquette, la marge */
const DUREE_JWT_S = 12 * 3600;


/* ---------- octets et base64url ---------- */

export function deBase64Url(t) {
  const b = String(t || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = b + "===".slice((b.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function enBase64Url(octets) {
  const o = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
  let bin = "";
  for (let i = 0; i < o.length; i++) bin += String.fromCharCode(o[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}

/** HKDF-SHA256 (extraction puis expansion, RFC 5869) en une passe. */
async function hkdf(sel, ikm, info, octets) {
  const cle = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: sel, info }, cle, octets * 8);
  return new Uint8Array(bits);
}


/* ---------- les clés ---------- */

/** La clé publique du site, telle que le navigateur la veut (65 octets),
    ou null si la variable manque ou n'a pas la forme. */
export function clePubliqueVapid(env) {
  try {
    const o = deBase64Url(env.VAPID_PUBLIC_KEY);
    return o.length === 65 && o[0] === 4 ? o : null;
  } catch (e) { return null; }
}

/** La clé privée du site, importée pour signer (ES256). Les coordonnées
    x, y viennent de la clé publique : le format web-push ne garde que d. */
export async function clePriveeVapid(env) {
  const pub = clePubliqueVapid(env);
  let d;
  try { d = deBase64Url(env.VAPID_PRIVATE_KEY); } catch (e) { d = null; }
  if (!pub || !d || d.length !== 32) return null;
  const jwk = { kty: "EC", crv: "P-256", x: enBase64Url(pub.slice(1, 33)), y: enBase64Url(pub.slice(33, 65)), d: enBase64Url(d), ext: true };
  return subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** Les notifications sont-elles configurées (les deux clés, cohérentes) ? */
export async function vapidPret(env) {
  try { return !!(clePubliqueVapid(env) && await clePriveeVapid(env)); } catch (e) { return false; }
}


/* ---------- RFC 8291 : chiffrer pour un navigateur ---------- */

/**
 * Chiffre `charge` (texte ou octets) pour l'abonnement { p256dh, auth }.
 * `injecte` sert aux tests : { sel: 16 octets, prive: JWK de la clé
 * éphémère (avec x, y, d) } — sans lui, sel et paire sont tirés au hasard.
 * Renvoie le corps complet à envoyer (Uint8Array).
 */
export async function chiffrer(charge, p256dh, auth, injecte) {
  const clair = typeof charge === "string" ? enc.encode(charge) : new Uint8Array(charge);
  if (clair.length > MAX_CHARGE) throw new Error("charge trop longue (" + clair.length + " octets)");
  const uaPublic = deBase64Url(p256dh);
  const secretAuth = deBase64Url(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("p256dh : pas une clé P-256 non compressée");
  if (secretAuth.length !== 16) throw new Error("auth : 16 octets attendus");

  const sel = injecte && injecte.sel ? new Uint8Array(injecte.sel) : crypto.getRandomValues(new Uint8Array(16));
  let paire;
  if (injecte && injecte.prive) {
    const jwkPub = Object.assign({}, injecte.prive); delete jwkPub.d;
    paire = {
      privateKey: await subtle.importKey("jwk", injecte.prive, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]),
      publicKey: await subtle.importKey("jwk", jwkPub, { name: "ECDH", namedCurve: "P-256" }, true, []),
    };
  } else {
    paire = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  }
  const asPublic = new Uint8Array(await subtle.exportKey("raw", paire.publicKey));
  const cleUa = await subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, true, []);
  const secretEcdh = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: cleUa }, paire.privateKey, 256));

  /* IKM = HKDF(auth, ecdh, "WebPush: info" | 0 | ua_public | as_public, 32) */
  const infoCle = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(secretAuth, secretEcdh, infoCle, 32);
  /* CEK = HKDF(sel, IKM, "Content-Encoding: aes128gcm" | 0, 16) ;
     NONCE = HKDF(sel, IKM, "Content-Encoding: nonce" | 0, 12) */
  const cek = await hkdf(sel, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(sel, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const cleAes = await subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  /* un seul enregistrement, donc le délimiteur de fin est 0x02 */
  const enregistrement = concat(clair, new Uint8Array([2]));
  const chiffre = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, cleAes, enregistrement));

  const entete = new Uint8Array(16 + 4 + 1 + 65);
  entete.set(sel, 0);
  new DataView(entete.buffer).setUint32(16, TAILLE_ENREGISTREMENT, false);
  entete[20] = 65;
  entete.set(asPublic, 21);
  return concat(entete, chiffre);
}


/* ---------- RFC 8292 : VAPID ---------- */

/** L'en-tête Authorization pour ce service de push. `maintenant` (ms) et
    `sujet` servent aux tests. */
export async function enteteVapid(endpoint, env, options) {
  const o = options || {};
  const prive = o.prive || await clePriveeVapid(env);
  const pub = clePubliqueVapid(env);
  if (!prive || !pub) throw new Error("clés VAPID absentes ou mal formées");
  const aud = new URL(endpoint).origin;
  const maintenant = Math.floor((o.maintenant || Date.now()) / 1000);
  const sujet = o.sujet || env.VAPID_SUBJECT || (env.CONTACT_RGPD ? "mailto:" + env.CONTACT_RGPD : "https://exemple.fr");
  const b64 = (obj) => enBase64Url(enc.encode(JSON.stringify(obj)));
  const donnees = b64({ typ: "JWT", alg: "ES256" }) + "." + b64({ aud, exp: maintenant + DUREE_JWT_S, sub: sujet });
  const signature = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, prive, enc.encode(donnees)));
  return "vapid t=" + donnees + "." + enBase64Url(signature) + ", k=" + enBase64Url(pub);
}


/* ---------- pousser ---------- */

/**
 * Pousse `charge` (un objet : { titre, corps, url, tag, quand }) à un
 * abonnement { endpoint, p256dh, auth }. Renvoie { ok, statut, perime } —
 * « perime » (404, 410) : le navigateur s'est désabonné, la ligne est à
 * effacer. Ne lève jamais : un échec est une réponse.
 */
export async function pousser(abonnement, charge, env, options) {
  const o = options || {};
  try {
    const corps = await chiffrer(JSON.stringify(charge), abonnement.p256dh, abonnement.auth);
    const autorisation = o.autorisation || await enteteVapid(abonnement.endpoint, env, { prive: o.prive });
    const entetes = {
      "Authorization": autorisation,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": String(o.ttl || 24 * 3600),
      "Urgency": o.urgence || "normal",
    };
    if (charge && charge.tag) entetes["Topic"] = String(charge.tag).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined;
    if (!entetes["Topic"]) delete entetes["Topic"];
    const r = await fetch(abonnement.endpoint, { method: "POST", headers: entetes, body: corps });
    return { ok: r.ok, statut: r.status, perime: r.status === 404 || r.status === 410 };
  } catch (e) {
    return { ok: false, statut: 0, perime: false, erreur: e && e.message };
  }
}


/* ---------- ce que partagent les deux routes appelées par la base ---------- */

/** L'appel vient-il de la base ? Le secret partagé (PUSH_SECRET, posé
    aussi dans le coffre Supabase) dans l'en-tête X-Push-Secret. Sans
    variable : refus (fail closed). La comparaison ne s'arrête pas au
    premier caractère différent. */
export function appelAutorise(request, env) {
  const attendu = String(env.PUSH_SECRET || "");
  const donne = String(request.headers.get("X-Push-Secret") || "");
  if (attendu.length < 16 || donne.length !== attendu.length) return false;
  let diff = 0;
  for (let i = 0; i < attendu.length; i++) diff |= attendu.charCodeAt(i) ^ donne.charCodeAt(i);
  return diff === 0;
}

/** Le message d'erreur de PostgREST, code compris. */
export async function messageDe(r) {
  try { const e = await r.json(); return (e.message || e.hint || e.details || "") + (e.code ? " [" + e.code + "]" : ""); }
  catch (x) { return ""; }
}

export function json(donnees, code) {
  return new Response(JSON.stringify(donnees), {
    status: code || 200, headers: { "content-type": "application/json", "Cache-Control": "no-store" },
  });
}

/** PostgREST avec la clé de service : l'expéditeur lit les abonnements de
    tout le monde — c'est le seul endroit du site où cette clé lit des
    données de plusieurs personnes, et il n'en renvoie rien au navigateur. */
export function commeService(env, chemin, options) {
  const o = options || {};
  const entetes = {
    "Authorization": "Bearer " + env.SUPABASE_SERVICE_ROLE,
    "apikey": env.SUPABASE_SERVICE_ROLE,
    "content-type": "application/json",
    "Accept": "application/json",
  };
  if (o.prefer) entetes["Prefer"] = o.prefer;
  return fetch(env.SUPABASE_URL + chemin, { method: o.method || "GET", headers: entetes, body: o.body });
}

/** Les abonnements des membres donnés, moins ceux qui ont coupé `choix`
    (« messages » ou « rappels ») dans leurs paramètres. */
export async function abonnementsDe(env, membres, choix) {
  const ids = Array.from(new Set(membres.filter(Boolean)));
  if (!ids.length) return { abonnements: [], destinataires: 0 };
  const liste = "in.(" + ids.map(encodeURIComponent).join(",") + ")";
  const [rP, rA] = await Promise.all([
    commeService(env, "/rest/v1/parametres_notifications?select=membre&" + choix + "=eq.false&membre=" + liste),
    commeService(env, "/rest/v1/abonnements_push?select=endpoint,p256dh,auth,membre&membre=" + liste),
  ]);
  if (rA.status === 404) throw new Error("table abonnements_push absente (supabase/2026_notifications.sql)");
  if (!rA.ok) throw new Error("abonnements illisibles : " + rA.status + " " + (await messageDe(rA)));
  const coupes = new Set(rP.ok ? (await rP.json()).map((l) => l.membre) : []);
  const destinataires = ids.filter((m) => !coupes.has(m));
  const abonnements = (await rA.json()).filter((a) => !coupes.has(a.membre));
  return { abonnements, destinataires: destinataires.length };
}

/** Pousse à chacun, efface les abonnements périmés, résume. */
export async function pousserATous(env, abonnements, charge, options) {
  /* la clé privée s'importe une fois, et le JWT VAPID ne dépend que de
     l'origine du service de push : un par origine, pas un par navigateur
     — le plan gratuit compte le CPU (10 ms par requête) */
  const prive = await clePriveeVapid(env);
  const parOrigine = new Map();
  for (const a of abonnements) {
    let origine;
    try { origine = new URL(a.endpoint).origin; } catch (e) { continue; }
    if (!parOrigine.has(origine)) {
      try { parOrigine.set(origine, await enteteVapid(a.endpoint, env, { prive })); } catch (e) { parOrigine.set(origine, null); }
    }
  }
  const resultats = await Promise.all(abonnements.map((a) => {
    let origine = null;
    try { origine = new URL(a.endpoint).origin; } catch (e) {}
    return pousser(a, charge, env, Object.assign({}, options, { prive, autorisation: origine ? parOrigine.get(origine) : null }));
  }));
  const perimes = abonnements.filter((a, i) => resultats[i].perime).map((a) => a.endpoint);
  /* un DELETE par adresse : une adresse d'abonnement porte des caractères
     qu'une liste « in.() » de PostgREST obligerait à citer et à échapper */
  for (const e of perimes) {
    await commeService(env, "/rest/v1/abonnements_push?endpoint=eq." + encodeURIComponent(e), { method: "DELETE" });
  }
  return {
    envoyes: resultats.filter((r) => r.ok).length,
    echecs: resultats.filter((r) => !r.ok && !r.perime).map((r) => r.statut || r.erreur),
    supprimes: perimes.length,
  };
}

/** Une exception dans l'expéditeur devient une réponse JSON qui la décrit.

    Constaté le 20 septembre : Cloudflare REMPLACE le corps d'une réponse
    502 (et 504, 52x) d'une fonction par sa page « error code: 502 » — la
    base ne lisait que cela, alors que la fonction avait terminé (« Ok »
    dans le journal en direct). Les routes appelées par la base répondent
    donc 200 avec { ok: false, erreur } quand elles échouent : le seul
    lecteur est net._http_response, et ce qu'on y veut, c'est la cause. */
export function avecGarde(gestionnaire) {
  return async (context) => {
    try {
      return await gestionnaire(context);
    } catch (e) {
      return json({ erreur: "exception dans l'expéditeur", message: String(e && e.message || e),
                    pile: String(e && e.stack || "").split("\n").slice(0, 8) }, 500);
    }
  };
}

/** L'auto-test (GET, sans secret : il ne révèle rien) : les clés sont-elles
    utilisables ICI, dans ce runtime ? Il importe la clé privée, chiffre une
    charge pour un navigateur fictif et signe un JWT, et dit combien de
    temps cela a pris. */
export async function autoTest(env) {
  const debut = Date.now();
  const etat = { configure: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY), secret_pose: !!(env.PUSH_SECRET && String(env.PUSH_SECRET).length >= 16),
                 cle_service_posee: !!env.SUPABASE_SERVICE_ROLE, publique_bien_formee: !!clePubliqueVapid(env), paire_utilisable: false, essai: null, duree_ms: 0 };
  try {
    etat.paire_utilisable = await vapidPret(env);
    if (etat.paire_utilisable) {
      const paire = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
      const p256dh = enBase64Url(new Uint8Array(await subtle.exportKey("raw", paire.publicKey)));
      const auth = enBase64Url(crypto.getRandomValues(new Uint8Array(16)));
      const corps = await chiffrer(JSON.stringify({ titre: "test", corps: "auto-test" }), p256dh, auth);
      const entete = await enteteVapid("https://fcm.googleapis.com/fcm/send/x", env);
      etat.essai = "ok : " + corps.length + " octets chiffrés, en-tête VAPID de " + entete.length + " caractères";
    } else {
      etat.essai = "les clés ne sont pas utilisables (voir /api/diagnostic, notifications_cles)";
    }
  } catch (e) {
    etat.essai = "ÉCHEC : " + String(e && e.message || e);
  }
  etat.duree_ms = Date.now() - debut;
  return etat;
}

/** Un extrait lisible d'un message pour le corps d'une notification :
    sans les marques Markdown les plus courantes, borné. */
export function extrait(texte, max) {
  const t = String(texte || "").replace(/```[\s\S]*?```/g, "[code]").replace(/[*_~`>#]/g, "").replace(/\s+/g, " ").trim();
  return t.length > (max || 140) ? t.slice(0, (max || 140) - 1) + "…" : t;
}
