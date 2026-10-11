/* ==========================================================================
   Vérification d'un jeton Supabase — partagée par le middleware et /api/session
   ==========================================================================

   Un jeton (JWT) est fait de trois parties séparées par des points :

       en-tête . charge utile . signature

   Les deux premières sont lisibles par n'importe qui — ce ne sont que des
   données encodées en base64, pas chiffrées. Tout l'intérêt tient donc dans
   la SIGNATURE : elle prouve que le jeton a bien été émis par Supabase et
   qu'il n'a pas été retouché depuis.

   Ne jamais se contenter de lire la charge utile : n'importe qui peut en
   fabriquer une qui prétend « je suis prenom.nom@universite-paris-saclay.fr ».
   C'est la vérification de signature qui fait la différence entre une serrure
   et un rideau.

   Supabase signe de deux façons selon l'âge du projet :
     - ES256/RS256 (asymétrique) : la clé publique est publiée sur le point
       .well-known/jwks.json du projet. C'est le cas par défaut aujourd'hui.
     - HS256 (symétrique) : un secret partagé, à fournir via la variable
       d'environnement SUPABASE_JWT_SECRET.
   Les deux sont gérées ici.
   ========================================================================== */

/* Cache des clés publiques : les rechercher à chaque requête coûterait un
   aller-retour réseau par fichier servi. Une heure suffit largement. */
let cacheJwks = { url: null, cles: null, expire: 0 };

const DUREE_CACHE_MS = 60 * 60 * 1000;


function base64UrlVersOctets(texte) {
  const base64 = texte.replace(/-/g, "+").replace(/_/g, "/");
  const rembourre = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binaire = atob(rembourre);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return octets;
}


function lireJson(partie) {
  return JSON.parse(new TextDecoder().decode(base64UrlVersOctets(partie)));
}


async function clesPubliques(supabaseUrl) {
  const url = supabaseUrl.replace(/\/$/, "") + "/auth/v1/.well-known/jwks.json";
  const maintenant = Date.now();

  if (cacheJwks.url === url && cacheJwks.cles && cacheJwks.expire > maintenant) {
    return cacheJwks.cles;
  }

  const reponse = await fetch(url);
  if (!reponse.ok) return [];               // projet en HS256 : pas de JWKS

  const { keys } = await reponse.json();
  cacheJwks = { url, cles: keys || [], expire: maintenant + DUREE_CACHE_MS };
  return cacheJwks.cles;
}


/* Nom de l'algorithme au format attendu par Web Crypto. */
function parametresAlgo(alg) {
  if (alg === "ES256") {
    return [{ name: "ECDSA", namedCurve: "P-256" }, { name: "ECDSA", hash: "SHA-256" }];
  }
  if (alg === "RS256") {
    return [{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
            { name: "RSASSA-PKCS1-v1_5" }];
  }
  if (alg === "HS256") {
    return [{ name: "HMAC", hash: "SHA-256" }, { name: "HMAC" }];
  }
  return null;
}


async function signatureValide(jeton, enTete, secretPartage, supabaseUrl) {
  const [partieEnTete, partieCharge, partieSignature] = jeton.split(".");
  const signe = new TextEncoder().encode(partieEnTete + "." + partieCharge);
  const signature = base64UrlVersOctets(partieSignature);

  const algo = parametresAlgo(enTete.alg);
  if (!algo) return false;
  const [paramsImport, paramsVerif] = algo;

  if (enTete.alg === "HS256") {
    if (!secretPartage) return false;
    const cle = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secretPartage), paramsImport, false, ["verify"]);
    return crypto.subtle.verify(paramsVerif, cle, signature, signe);
  }

  /* Asymétrique : on cherche la clé publique dont l'identifiant (kid)
     correspond à celui annoncé dans l'en-tête du jeton. */
  const cles = await clesPubliques(supabaseUrl);
  const jwk = cles.find((k) => k.kid === enTete.kid) || cles[0];
  if (!jwk) return false;

  const cle = await crypto.subtle.importKey("jwk", jwk, paramsImport, false, ["verify"]);
  return crypto.subtle.verify(paramsVerif, cle, signature, signe);
}


/**
 * Vérifie un jeton de bout en bout.
 *
 * Renvoie { ok: true, email } si et seulement si TOUT est vrai :
 *   - la structure est celle d'un JWT ;
 *   - la signature est authentique ;
 *   - le jeton n'est pas expiré ;
 *   - l'adresse appartient au domaine autorisé.
 *
 * Sinon { ok: false, raison } — la raison sert aux journaux, pas au visiteur :
 * on ne lui dit jamais POURQUOI ça a échoué, cela renseignerait un curieux.
 */
export async function verifierJeton(jeton, env) {
  const supabaseUrl = env.SUPABASE_URL || "";
  const domaine = (env.DOMAINE_AUTORISE || "").toLowerCase();

  if (!jeton) return { ok: false, raison: "aucun jeton" };
  if (!supabaseUrl) return { ok: false, raison: "SUPABASE_URL non configurée" };

  const parties = jeton.split(".");
  if (parties.length !== 3) return { ok: false, raison: "jeton malformé" };

  let enTete, charge;
  try {
    enTete = lireJson(parties[0]);
    charge = lireJson(parties[1]);
  } catch (err) {
    return { ok: false, raison: "jeton illisible" };
  }

  if (!(await signatureValide(jeton, enTete, env.SUPABASE_JWT_SECRET, supabaseUrl))) {
    return { ok: false, raison: "signature invalide" };
  }

  /* exp est en secondes depuis 1970, Date.now() en millisecondes. */
  if (typeof charge.exp !== "number" || charge.exp * 1000 <= Date.now()) {
    return { ok: false, raison: "jeton expiré" };
  }

  const email = (charge.email || "").toLowerCase();

  /* Restriction de domaine : hérité de l'époque où le site était réservé à
     l'université. Le site est public depuis la refonte, donc la variable
     DOMAINE_AUTORISE n'est plus renseignée et le test ne s'applique pas.
     Le code reste : il redeviendrait utile pour un espace réservé. */
  if (domaine && !email.endsWith("@" + domaine)) {
    return { ok: false, raison: "domaine non autorisé" };
  }

  /* Le rôle et le pseudo voyagent dans le jeton, posés par le hook
     « jeton_avec_role » de Supabase (voir supabase/2026_comptes_roles.sql).
     La signature vient d'être vérifiée : on peut s'y fier.

     Défaut prudent : en l'absence de la revendication — hook non activé,
     jeton ancien — on considère le rôle le plus faible. Un rôle manquant ne
     doit jamais valoir un rôle élevé. */
  const roles = ["user", "reader_user", "super_user"];
  const role = roles.includes(charge.role_site) ? charge.role_site : "user";

  /* La version de la notice acceptée, dans les métadonnées du compte que le
     jeton porte aussi (user_metadata). Absente pour un compte venu par
     Google, GitHub ou Discord : aucune case n'a jamais été cochée. Le jeton
     peut retarder d'une heure sur une acceptation toute fraîche ; la page
     s'en souvient elle-même entre-temps (demanderNotice). */
  const meta = charge.user_metadata && typeof charge.user_metadata === "object" ? charge.user_metadata : {};
  const consentement_version = typeof meta.consentement_version === "string" ? meta.consentement_version : null;

  return { ok: true, email, role, pseudo: charge.pseudo || null, id: charge.sub || null, consentement_version };
}
