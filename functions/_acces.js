const DUREE_SESSION_S = 60 * 60;
const COOKIE = "fb_session";


function base64Url(octets) {
  let binaire = "";
  for (const octet of octets) binaire += String.fromCharCode(octet);
  return btoa(binaire).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}


function octetsBase64Url(texte) {
  const base64 = texte.replace(/-/g, "+").replace(/_/g, "/");
  const rembourre = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binaire = atob(rembourre);
  return Uint8Array.from(binaire, (caractere) => caractere.charCodeAt(0));
}


async function signature(texte, secret) {
  const cle = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return crypto.subtle.sign("HMAC", cle, new TextEncoder().encode(texte));
}


/* Le cookie vaut-il pour tout le domaine, ou seulement pour cet hôte ?

   Sans « Domain », le cookie n'est renvoyé qu'à exemple.fr : un outil
   voisin hébergé sur outils.exemple.fr ne le verrait jamais, et il
   faudrait se reconnecter en passant d'un outil à l'autre. Avec
   « Domain=exemple.fr », il vaut pour le domaine ET ses sous-domaines
   — une seule connexion pour tout le portail.

   La valeur vient d'une variable d'environnement plutôt que d'être écrite en
   dur, pour une raison pratique : sur une adresse de prévisualisation
   (*.pages.dev), un Domain pointant vers le vrai domaine ferait rejeter le
   cookie par le navigateur, et plus personne n'entrerait. Variable absente =
   cookie limité à l'hôte, ce qui marche partout. */
export function attributDomaine(domaine) {
  return domaine ? "Domain=" + domaine : null;
}


export async function creerCookie(secret, domaine) {
  const charge = base64Url(new TextEncoder().encode(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + DUREE_SESSION_S,
  })));
  const signe = base64Url(new Uint8Array(await signature(charge, secret)));
  return [
    `${COOKIE}=${charge}.${signe}`,
    "Path=/",
    attributDomaine(domaine),
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${DUREE_SESSION_S}`,
  ].filter(Boolean).join("; ");
}


/** Extrait un cookie de l'en-tête brut. Utilisé par le middleware et /api/moi. */
export function lireCookie(requete, nom) {
  const brut = requete.headers.get("Cookie") || "";
  for (const morceau of brut.split(";")) {
    const [cle, ...valeur] = morceau.trim().split("=");
    if (cle === nom) return decodeURIComponent(valeur.join("="));
  }
  return null;
}


export async function accesValide(jeton, secret) {
  if (!jeton || !secret) return false;
  const [charge, signe] = jeton.split(".");
  if (!charge || !signe) return false;

  let donnees;
  try {
    donnees = JSON.parse(new TextDecoder().decode(octetsBase64Url(charge)));
  } catch (err) {
    return false;
  }

  if (typeof donnees.exp !== "number" || donnees.exp * 1000 <= Date.now()) return false;

  const cle = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    cle,
    octetsBase64Url(signe),
    new TextEncoder().encode(charge),
  );
}


export { COOKIE };
