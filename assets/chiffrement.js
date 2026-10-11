/* ==========================================================================
   Le chiffrement de bout en bout des messages privés (lot H, session 2)
   ==========================================================================

   Conception : docs/chiffrement.md. Ce fichier en est la seule pièce
   cryptographique ; le script des pages (site.js) l'appelle et ne contient
   aucune primitive. Il se charge dans le navigateur (window.Chiffrement)
   et en node (module.exports), pour que le même code joue les vecteurs
   connus et chiffre dans la page.

   Tout vient de WebCrypto (crypto.subtle), rien d'autre :
     * clé d'identité : ECDH P-256 — la privée importée NON EXTRACTABLE dans
       le navigateur (elle sert, elle ne se lit pas) ;
     * dérivation : HKDF-SHA-256 (depuis un secret ECDH), PBKDF2-HMAC-SHA-256
       (depuis la phrase de récupération, 600 000 itérations) ;
     * chiffrement : AES-256-GCM, nonce de 12 octets tiré au hasard et posé
       en tête, étiquette de 16 octets, DONNÉES ASSOCIÉES qui lient chaque
       chiffré à sa place (conversation, auteur, version…) : déplacé, il ne
       s'ouvre plus.

   Trois formats, tous en base64url, nonce en tête :
     * la copie de la clé privée (cles_privees.enveloppe) : AES-GCM(PBKDF2(
       phrase, sel), PKCS #8, AAD = "fiches-but/cle-privee/v1|membre|version") ;
     * une enveloppe (cles_conversation.enveloppe) : AES-GCM(HKDF(ECDH(privée
       de `par`, publique de `membre`), sel, info), 32 octets de clé de
       conversation, AAD = "fiches-but/enveloppe/v1|groupe|version|membre|
       membre_version|par|par_version") ;
     * un message (messages.chiffre) : AES-GCM(clé de conversation, JSON
       { v, t, refs }, AAD = "fiches-but/message/v1|groupe|auteur|cle_version").

   La phrase : douze mots de la liste française de BIP-39 (2 048 mots, MIT,
   crédits @Kirvx @NicolasDorier @ecdsa @EricLarch), 132 bits. Elle entre dans
   PBKDF2 sous sa forme normalisée : minuscules, SANS ACCENTS, un espace entre
   les mots — donc tapée sans accents, elle vaut la même chose (la liste a été
   faite pour que « é » et « e » ne distinguent jamais deux mots).

   Les fonctions rendent des promesses et lèvent une Error en français quand
   quelque chose n'est pas ce qu'on attend — jamais un résultat approché.
   ========================================================================== */
(function (racine, fabrique) {
  if (typeof module === "object" && module.exports) module.exports = fabrique(globalThis);
  else racine.Chiffrement = fabrique(racine);
})(typeof self !== "undefined" ? self : this, function (env) {
  "use strict";

  const VERSION = 1;
  const ITERATIONS = 600000;
  const ALGO = "ecdh-p256";
  const INFO_ENVELOPPE = "fiches-but/cle-conversation/v1";
  const INFO_TRANSFERT = "fiches-but/transfert/v1";
  const INFO_PASSKEY = "fiches-but/passkey/v1";
  const TEXTE_MAX = 2000, REFS_MAX = 10, CHIFFRE_MAX = 16384;
  const ENC = new TextEncoder(), DEC = new TextDecoder("utf-8", { fatal: true });
  const subtle = env.crypto && env.crypto.subtle;

  function disponible() {
    return !!(subtle && env.crypto.getRandomValues && typeof TextEncoder !== "undefined" && typeof BigInt === "function");
  }
  function aleatoire(n) { const a = new Uint8Array(n); env.crypto.getRandomValues(a); return a; }
  function concat() {
    let n = 0; for (const a of arguments) n += a.length;
    const r = new Uint8Array(n); let i = 0;
    for (const a of arguments) { r.set(a, i); i += a.length; }
    return r;
  }
  function memes(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }

  /* ---------- base64url, strict ---------- */
  function b64u(octets) {
    let s = ""; for (let i = 0; i < octets.length; i++) s += String.fromCharCode(octets[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function deB64u(texte) {
    if (typeof texte !== "string" || !/^[A-Za-z0-9_-]*$/.test(texte)) throw new Error("base64url attendu");
    const b = texte.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - texte.length % 4) % 4);
    const s = atob(b); const r = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) r[i] = s.charCodeAt(i);
    return r;
  }
  function hex(octets) { return Array.prototype.map.call(octets, (o) => o.toString(16).padStart(2, "0")).join(""); }
  function deHex(t) { const r = new Uint8Array(t.length / 2); for (let i = 0; i < r.length; i++) r[i] = parseInt(t.substr(2 * i, 2), 16); return r; }

  /* ---------- les primitives (exposées au banc de vecteurs) ----------
     Ce sont ELLES que le schéma appelle : un vecteur qui passe ici garantit
     le chemin réel, pas une copie. */
  async function aesGcmChiffrer(cleRaw, nonce, donnees, aad) {
    const k = cleRaw instanceof CryptoKey ? cleRaw : await subtle.importKey("raw", cleRaw, "AES-GCM", false, ["encrypt"]);
    return new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 }, k, donnees));
  }
  async function aesGcmDechiffrer(cleRaw, nonce, chiffre, aad) {
    const k = cleRaw instanceof CryptoKey ? cleRaw : await subtle.importKey("raw", cleRaw, "AES-GCM", false, ["decrypt"]);
    return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 }, k, chiffre));
  }
  async function hkdf(secret, sel, info, longueur) {
    const k = await subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: sel, info: info }, k, longueur * 8));
  }
  async function pbkdf2(motDePasse, sel, iterations, longueur) {
    const k = await subtle.importKey("raw", ENC.encode(motDePasse), "PBKDF2", false, ["deriveBits"]);
    return new Uint8Array(await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sel, iterations: iterations }, k, longueur * 8));
  }
  async function ecdh(privee, publiqueJwk) {
    const pub = await importerPublique(publiqueJwk);
    return new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: pub }, privee, 256));
  }
  async function sha256(octets) { return new Uint8Array(await subtle.digest("SHA-256", octets)); }

  /* Une clé AES-GCM non extractable depuis des octets (clé de conversation,
     clé dérivée) : elle sert, elle ne se relit pas. */
  async function cleAes(octets, usages) {
    return subtle.importKey("raw", octets, "AES-GCM", false, usages || ["encrypt", "decrypt"]);
  }
  /* nonce || chiffré, en base64url ; et l'inverse */
  async function sceller(cle, donnees, aad) {
    const nonce = aleatoire(12);
    const c = await aesGcmChiffrer(cle, nonce, donnees, aad);
    return b64u(concat(nonce, c));
  }
  async function ouvrir(cle, texte, aad, quoi) {
    let o;
    try { o = deB64u(texte); } catch (e) { throw new Error(quoi); }
    if (o.length < 12 + 16) throw new Error(quoi + " : trop court");
    try { return await aesGcmDechiffrer(cle, o.subarray(0, 12), o.subarray(12), aad); }
    catch (e) { throw new Error(quoi); }
  }
  const aad = (parties) => ENC.encode(parties.join("|"));

  /* ---------- la clé d'identité ---------- */
  function publiqueValide(jwk) {
    return !!jwk && typeof jwk === "object" && jwk.kty === "EC" && jwk.crv === "P-256"
      && typeof jwk.x === "string" && typeof jwk.y === "string"
      && /^[A-Za-z0-9_-]{43}$/.test(jwk.x) && /^[A-Za-z0-9_-]{43}$/.test(jwk.y);
  }
  async function importerPublique(jwk) {
    if (!publiqueValide(jwk)) throw new Error("clé publique mal formée");
    return subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true }, { name: "ECDH", namedCurve: "P-256" }, true, []);
  }
  async function importerPriveeNonExtractable(pkcs8) {
    return subtle.importKey("pkcs8", pkcs8, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  }
  /* Génère une paire ; rend la publique (JWK, sans rien de privé), la
     privée en PKCS #8 (à envelopper avec la phrase, puis à importer non
     extractable — l'octet brut ne doit vivre que ce temps-là), l'empreinte. */
  async function genererIdentite() {
    const paire = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const pub = await subtle.exportKey("jwk", paire.publicKey);
    const publiqueJwk = { kty: "EC", crv: "P-256", x: pub.x, y: pub.y };
    const priveePkcs8 = new Uint8Array(await subtle.exportKey("pkcs8", paire.privateKey));
    return { publiqueJwk, priveePkcs8, empreinte: await empreinte(publiqueJwk) };
  }
  /* L'empreinte : SHA-256 du point non compressé (04 || x || y), rendue en
     60 chiffres, 12 groupes de 5 — comparable à voix haute. */
  async function empreinte(jwk) {
    if (!publiqueValide(jwk)) throw new Error("clé publique mal formée");
    const brut = concat(new Uint8Array([4]), deB64u(jwk.x), deB64u(jwk.y));
    const h = await sha256(brut);
    const n = BigInt("0x" + hex(h)) % (10n ** 60n);
    const chiffres = n.toString().padStart(60, "0");
    return chiffres.match(/.{5}/g).join(" ");
  }

  /* ---------- lier un appareil depuis un autre (lot K1) ----------
     Le NOUVEL appareil fabrique une paire ÉPHÉMÈRE, qui ne vit que le
     temps de la page, et montre l'empreinte de sa publique. L'appareil
     DÉJÀ OUVERT lit cette publique, montre la même empreinte, et
     n'enveloppe la clé privée d'identité qu'après un « c'est bien lui ».

     Ce que ce contrôle arrête : la base (ou qui la détiendrait) pourrait
     substituer une publique éphémère à elle pour se faire envoyer la clé
     — mais l'empreinte affichée des deux côtés ne serait alors plus la
     même. C'est lui, et lui seul, qui remplace la phrase ici : sans la
     comparaison faite par la personne, cette étape n'aurait pas le droit
     d'exister. Voir docs/messagerie-accessible.md, § K1.

     Le secret vient d'un ECDH entre la privée d'IDENTITÉ de l'appareil
     ouvert et la publique ÉPHÉMÈRE du nouveau : seul quelqu'un qui détient
     l'identité peut fabriquer cette enveloppe, et seul le nouvel appareil
     peut l'ouvrir. */
  async function genererEphemere() {
    /* extractable : c'est la PUBLIQUE qu'on exporte ; la privée reste dans
       cet objet, n'est jamais exportée, et meurt avec la page */
    const paire = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const pub = await subtle.exportKey("jwk", paire.publicKey);
    const publiqueJwk = { kty: "EC", crv: "P-256", x: pub.x, y: pub.y };
    return { publiqueJwk, privee: paire.privateKey, empreinte: await empreinte(publiqueJwk) };
  }
  function champsTransfert(c) {
    for (const k of ["transfert", "membre", "version"]) {
      if (c[k] === undefined || c[k] === null || c[k] === "") throw new Error("transfert : champ manquant « " + k + " »");
    }
    return aad(["fiches-but/transfert/v" + VERSION, c.transfert, c.membre, c.version]);
  }
  /* L'appareil déjà ouvert : ma clé privée d'identité, enveloppée pour la
     publique éphémère du nouvel appareil. `champs` lie l'enveloppe à CE
     transfert, à CE compte et à CETTE version : recopiée ailleurs, elle ne
     s'ouvre pas. */
  async function envelopperIdentite(pkcs8, maPriveeIdentite, sonEphemereJwk, champs) {
    if (!(pkcs8 instanceof Uint8Array) || !pkcs8.length) throw new Error("clé privée absente");
    const a = champsTransfert(champs);
    const sel = aleatoire(32);
    const secret = await ecdh(maPriveeIdentite, sonEphemereJwk);
    const cle = await cleAes(await hkdf(secret, sel, ENC.encode(INFO_TRANSFERT), 32));
    return { sel: b64u(sel), enveloppe: await sceller(cle, pkcs8, a) };
  }
  /* Le nouvel appareil : la privée éphémère et la publique d'identité
     (publique, lue en base) rendent le même secret. */
  async function ouvrirTransfert(env_, monEphemerePrivee, saPubliqueIdentiteJwk, champs) {
    if (!env_ || typeof env_.sel !== "string" || typeof env_.enveloppe !== "string") throw new Error("transfert illisible");
    const a = champsTransfert(champs);
    const secret = await ecdh(monEphemerePrivee, saPubliqueIdentiteJwk);
    const cle = await cleAes(await hkdf(secret, deB64u(env_.sel), ENC.encode(INFO_TRANSFERT), 32));
    return ouvrir(cle, env_.enveloppe, a, "transfert illisible");
  }
  /* La clé reçue est-elle bien celle que la base publie ? Sans ce
     contrôle, le nouvel appareil rangerait ce qu'on lui donne. */
  async function correspond(pkcs8, publiqueJwk) {
    if (!publiqueValide(publiqueJwk)) return false;
    try {
      const k = await subtle.importKey("pkcs8", pkcs8, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
      const jwk = await subtle.exportKey("jwk", k);
      return jwk.x === publiqueJwk.x && jwk.y === publiqueJwk.y;
    } catch (e) { return false; }
  }

  /* ---------- la clé scellée par une passkey (lot K2) ----------
     WebAuthn a une extension, « prf » : lors d'une assertion,
     l'authentificateur (Face ID, empreinte, Windows Hello, clé physique)
     calcule HMAC(le secret de la passkey, un sel) et rend les 32 octets AU
     NAVIGATEUR — jamais au serveur, qui ne connaît pas ce secret. C'est ce
     nombre qui, par HKDF, donne la clé AES qui enveloppe la clé privée
     d'identité : le même rôle que la phrase, sans rien à taper.

     Ces deux fonctions ne PARLENT PAS à WebAuthn : elles prennent le secret
     déjà calculé. C'est voulu — la cryptographie reste ici, testable en
     node avec un faux authentificateur, et les pages gardent l'appel au
     navigateur (`navigator.credentials`), qui, lui, ne se simule pas.

     `credential` (l'identifiant public de la passkey) et `membre` entrent
     dans les données associées : une enveloppe faite pour une passkey ne
     s'ouvre pas avec une autre, ni sous un autre compte. */
  function champsPasskey(c) {
    for (const k of ["membre", "credential", "version"]) {
      if (c[k] === undefined || c[k] === null || c[k] === "") throw new Error("passkey : champ manquant « " + k + " »");
    }
    return aad(["fiches-but/passkey/v" + VERSION, c.membre, c.credential, c.version]);
  }
  async function cleDeSecret(secret, sel) {
    if (!(secret instanceof Uint8Array) || secret.length < 32) throw new Error("secret de passkey trop court");
    return cleAes(await hkdf(secret, sel, ENC.encode(INFO_PASSKEY), 32));
  }
  /* Le sel à donner à l'authentificateur : 32 octets, tirés une fois et
     gardés en base à côté de l'enveloppe. Deux passkeys, deux sels : le
     même geste ne donne pas le même secret d'une passkey à l'autre. */
  function selPasskey() { return aleatoire(32); }
  async function scellerParPasskey(pkcs8, secret, sel, champs) {
    if (!(pkcs8 instanceof Uint8Array) || !pkcs8.length) throw new Error("clé privée absente");
    const a = champsPasskey(champs);
    const cle = await cleDeSecret(secret, sel);
    return { sel: b64u(sel), enveloppe: await sceller(cle, pkcs8, a) };
  }
  async function ouvrirParPasskey(copie, secret, champs) {
    if (!copie || typeof copie.sel !== "string" || typeof copie.enveloppe !== "string") throw new Error("passkey illisible");
    const a = champsPasskey(champs);
    const cle = await cleDeSecret(secret, deB64u(copie.sel));
    return ouvrir(cle, copie.enveloppe, a, "passkey illisible");
  }

  /* ---------- la phrase de récupération ---------- */
  const MOTS = [
    "abaisser", "abandon", "abdiquer", "abeille", "abolir", "aborder", "aboutir", "aboyer", "abrasif", "abreuver", "abriter", "abroger", "abrupt", "absence", "absolu", "absurde",
    "abusif", "abyssal", "académie", "acajou", "acarien", "accabler", "accepter", "acclamer", "accolade", "accroche", "accuser", "acerbe", "achat", "acheter", "aciduler", "acier",
    "acompte", "acquérir", "acronyme", "acteur", "actif", "actuel", "adepte", "adéquat", "adhésif", "adjectif", "adjuger", "admettre", "admirer", "adopter", "adorer", "adoucir",
    "adresse", "adroit", "adulte", "adverbe", "aérer", "aéronef", "affaire", "affecter", "affiche", "affreux", "affubler", "agacer", "agencer", "agile", "agiter", "agrafer",
    "agréable", "agrume", "aider", "aiguille", "ailier", "aimable", "aisance", "ajouter", "ajuster", "alarmer", "alchimie", "alerte", "algèbre", "algue", "aliéner", "aliment",
    "alléger", "alliage", "allouer", "allumer", "alourdir", "alpaga", "altesse", "alvéole", "amateur", "ambigu", "ambre", "aménager", "amertume", "amidon", "amiral", "amorcer",
    "amour", "amovible", "amphibie", "ampleur", "amusant", "analyse", "anaphore", "anarchie", "anatomie", "ancien", "anéantir", "angle", "angoisse", "anguleux", "animal", "annexer",
    "annonce", "annuel", "anodin", "anomalie", "anonyme", "anormal", "antenne", "antidote", "anxieux", "apaiser", "apéritif", "aplanir", "apologie", "appareil", "appeler", "apporter",
    "appuyer", "aquarium", "aqueduc", "arbitre", "arbuste", "ardeur", "ardoise", "argent", "arlequin", "armature", "armement", "armoire", "armure", "arpenter", "arracher", "arriver",
    "arroser", "arsenic", "artériel", "article", "aspect", "asphalte", "aspirer", "assaut", "asservir", "assiette", "associer", "assurer", "asticot", "astre", "astuce", "atelier",
    "atome", "atrium", "atroce", "attaque", "attentif", "attirer", "attraper", "aubaine", "auberge", "audace", "audible", "augurer", "aurore", "automne", "autruche", "avaler",
    "avancer", "avarice", "avenir", "averse", "aveugle", "aviateur", "avide", "avion", "aviser", "avoine", "avouer", "avril", "axial", "axiome", "badge", "bafouer",
    "bagage", "baguette", "baignade", "balancer", "balcon", "baleine", "balisage", "bambin", "bancaire", "bandage", "banlieue", "bannière", "banquier", "barbier", "baril", "baron",
    "barque", "barrage", "bassin", "bastion", "bataille", "bateau", "batterie", "baudrier", "bavarder", "belette", "bélier", "belote", "bénéfice", "berceau", "berger", "berline",
    "bermuda", "besace", "besogne", "bétail", "beurre", "biberon", "bicycle", "bidule", "bijou", "bilan", "bilingue", "billard", "binaire", "biologie", "biopsie", "biotype",
    "biscuit", "bison", "bistouri", "bitume", "bizarre", "blafard", "blague", "blanchir", "blessant", "blinder", "blond", "bloquer", "blouson", "bobard", "bobine", "boire",
    "boiser", "bolide", "bonbon", "bondir", "bonheur", "bonifier", "bonus", "bordure", "borne", "botte", "boucle", "boueux", "bougie", "boulon", "bouquin", "bourse",
    "boussole", "boutique", "boxeur", "branche", "brasier", "brave", "brebis", "brèche", "breuvage", "bricoler", "brigade", "brillant", "brioche", "brique", "brochure", "broder",
    "bronzer", "brousse", "broyeur", "brume", "brusque", "brutal", "bruyant", "buffle", "buisson", "bulletin", "bureau", "burin", "bustier", "butiner", "butoir", "buvable",
    "buvette", "cabanon", "cabine", "cachette", "cadeau", "cadre", "caféine", "caillou", "caisson", "calculer", "calepin", "calibre", "calmer", "calomnie", "calvaire", "camarade",
    "caméra", "camion", "campagne", "canal", "caneton", "canon", "cantine", "canular", "capable", "caporal", "caprice", "capsule", "capter", "capuche", "carabine", "carbone",
    "caresser", "caribou", "carnage", "carotte", "carreau", "carton", "cascade", "casier", "casque", "cassure", "causer", "caution", "cavalier", "caverne", "caviar", "cédille",
    "ceinture", "céleste", "cellule", "cendrier", "censurer", "central", "cercle", "cérébral", "cerise", "cerner", "cerveau", "cesser", "chagrin", "chaise", "chaleur", "chambre",
    "chance", "chapitre", "charbon", "chasseur", "chaton", "chausson", "chavirer", "chemise", "chenille", "chéquier", "chercher", "cheval", "chien", "chiffre", "chignon", "chimère",
    "chiot", "chlorure", "chocolat", "choisir", "chose", "chouette", "chrome", "chute", "cigare", "cigogne", "cimenter", "cinéma", "cintrer", "circuler", "cirer", "cirque",
    "citerne", "citoyen", "citron", "civil", "clairon", "clameur", "claquer", "classe", "clavier", "client", "cligner", "climat", "clivage", "cloche", "clonage", "cloporte",
    "cobalt", "cobra", "cocasse", "cocotier", "coder", "codifier", "coffre", "cogner", "cohésion", "coiffer", "coincer", "colère", "colibri", "colline", "colmater", "colonel",
    "combat", "comédie", "commande", "compact", "concert", "conduire", "confier", "congeler", "connoter", "consonne", "contact", "convexe", "copain", "copie", "corail", "corbeau",
    "cordage", "corniche", "corpus", "correct", "cortège", "cosmique", "costume", "coton", "coude", "coupure", "courage", "couteau", "couvrir", "coyote", "crabe", "crainte",
    "cravate", "crayon", "créature", "créditer", "crémeux", "creuser", "crevette", "cribler", "crier", "cristal", "critère", "croire", "croquer", "crotale", "crucial", "cruel",
    "crypter", "cubique", "cueillir", "cuillère", "cuisine", "cuivre", "culminer", "cultiver", "cumuler", "cupide", "curatif", "curseur", "cyanure", "cycle", "cylindre", "cynique",
    "daigner", "damier", "danger", "danseur", "dauphin", "débattre", "débiter", "déborder", "débrider", "débutant", "décaler", "décembre", "déchirer", "décider", "déclarer", "décorer",
    "décrire", "décupler", "dédale", "déductif", "déesse", "défensif", "défiler", "défrayer", "dégager", "dégivrer", "déglutir", "dégrafer", "déjeuner", "délice", "déloger", "demander",
    "demeurer", "démolir", "dénicher", "dénouer", "dentelle", "dénuder", "départ", "dépenser", "déphaser", "déplacer", "déposer", "déranger", "dérober", "désastre", "descente", "désert",
    "désigner", "désobéir", "dessiner", "destrier", "détacher", "détester", "détourer", "détresse", "devancer", "devenir", "deviner", "devoir", "diable", "dialogue", "diamant", "dicter",
    "différer", "digérer", "digital", "digne", "diluer", "dimanche", "diminuer", "dioxyde", "directif", "diriger", "discuter", "disposer", "dissiper", "distance", "divertir", "diviser",
    "docile", "docteur", "dogme", "doigt", "domaine", "domicile", "dompter", "donateur", "donjon", "donner", "dopamine", "dortoir", "dorure", "dosage", "doseur", "dossier",
    "dotation", "douanier", "double", "douceur", "douter", "doyen", "dragon", "draper", "dresser", "dribbler", "droiture", "duperie", "duplexe", "durable", "durcir", "dynastie",
    "éblouir", "écarter", "écharpe", "échelle", "éclairer", "éclipse", "éclore", "écluse", "école", "économie", "écorce", "écouter", "écraser", "écrémer", "écrivain", "écrou",
    "écume", "écureuil", "édifier", "éduquer", "effacer", "effectif", "effigie", "effort", "effrayer", "effusion", "égaliser", "égarer", "éjecter", "élaborer", "élargir", "électron",
    "élégant", "éléphant", "élève", "éligible", "élitisme", "éloge", "élucider", "éluder", "emballer", "embellir", "embryon", "émeraude", "émission", "emmener", "émotion", "émouvoir",
    "empereur", "employer", "emporter", "emprise", "émulsion", "encadrer", "enchère", "enclave", "encoche", "endiguer", "endosser", "endroit", "enduire", "énergie", "enfance", "enfermer",
    "enfouir", "engager", "engin", "englober", "énigme", "enjamber", "enjeu", "enlever", "ennemi", "ennuyeux", "enrichir", "enrobage", "enseigne", "entasser", "entendre", "entier",
    "entourer", "entraver", "énumérer", "envahir", "enviable", "envoyer", "enzyme", "éolien", "épaissir", "épargne", "épatant", "épaule", "épicerie", "épidémie", "épier", "épilogue",
    "épine", "épisode", "épitaphe", "époque", "épreuve", "éprouver", "épuisant", "équerre", "équipe", "ériger", "érosion", "erreur", "éruption", "escalier", "espadon", "espèce",
    "espiègle", "espoir", "esprit", "esquiver", "essayer", "essence", "essieu", "essorer", "estime", "estomac", "estrade", "étagère", "étaler", "étanche", "étatique", "éteindre",
    "étendoir", "éternel", "éthanol", "éthique", "ethnie", "étirer", "étoffer", "étoile", "étonnant", "étourdir", "étrange", "étroit", "étude", "euphorie", "évaluer", "évasion",
    "éventail", "évidence", "éviter", "évolutif", "évoquer", "exact", "exagérer", "exaucer", "exceller", "excitant", "exclusif", "excuse", "exécuter", "exemple", "exercer", "exhaler",
    "exhorter", "exigence", "exiler", "exister", "exotique", "expédier", "explorer", "exposer", "exprimer", "exquis", "extensif", "extraire", "exulter", "fable", "fabuleux", "facette",
    "facile", "facture", "faiblir", "falaise", "fameux", "famille", "farceur", "farfelu", "farine", "farouche", "fasciner", "fatal", "fatigue", "faucon", "fautif", "faveur",
    "favori", "fébrile", "féconder", "fédérer", "félin", "femme", "fémur", "fendoir", "féodal", "fermer", "féroce", "ferveur", "festival", "feuille", "feutre", "février",
    "fiasco", "ficeler", "fictif", "fidèle", "figure", "filature", "filetage", "filière", "filleul", "filmer", "filou", "filtrer", "financer", "finir", "fiole", "firme",
    "fissure", "fixer", "flairer", "flamme", "flasque", "flatteur", "fléau", "flèche", "fleur", "flexion", "flocon", "flore", "fluctuer", "fluide", "fluvial", "folie",
    "fonderie", "fongible", "fontaine", "forcer", "forgeron", "formuler", "fortune", "fossile", "foudre", "fougère", "fouiller", "foulure", "fourmi", "fragile", "fraise", "franchir",
    "frapper", "frayeur", "frégate", "freiner", "frelon", "frémir", "frénésie", "frère", "friable", "friction", "frisson", "frivole", "froid", "fromage", "frontal", "frotter",
    "fruit", "fugitif", "fuite", "fureur", "furieux", "furtif", "fusion", "futur", "gagner", "galaxie", "galerie", "gambader", "garantir", "gardien", "garnir", "garrigue",
    "gazelle", "gazon", "géant", "gélatine", "gélule", "gendarme", "général", "génie", "genou", "gentil", "géologie", "géomètre", "géranium", "germe", "gestuel", "geyser",
    "gibier", "gicler", "girafe", "givre", "glace", "glaive", "glisser", "globe", "gloire", "glorieux", "golfeur", "gomme", "gonfler", "gorge", "gorille", "goudron",
    "gouffre", "goulot", "goupille", "gourmand", "goutte", "graduel", "graffiti", "graine", "grand", "grappin", "gratuit", "gravir", "grenat", "griffure", "griller", "grimper",
    "grogner", "gronder", "grotte", "groupe", "gruger", "grutier", "gruyère", "guépard", "guerrier", "guide", "guimauve", "guitare", "gustatif", "gymnaste", "gyrostat", "habitude",
    "hachoir", "halte", "hameau", "hangar", "hanneton", "haricot", "harmonie", "harpon", "hasard", "hélium", "hématome", "herbe", "hérisson", "hermine", "héron", "hésiter",
    "heureux", "hiberner", "hibou", "hilarant", "histoire", "hiver", "homard", "hommage", "homogène", "honneur", "honorer", "honteux", "horde", "horizon", "horloge", "hormone",
    "horrible", "houleux", "housse", "hublot", "huileux", "humain", "humble", "humide", "humour", "hurler", "hydromel", "hygiène", "hymne", "hypnose", "idylle", "ignorer",
    "iguane", "illicite", "illusion", "image", "imbiber", "imiter", "immense", "immobile", "immuable", "impact", "impérial", "implorer", "imposer", "imprimer", "imputer", "incarner",
    "incendie", "incident", "incliner", "incolore", "indexer", "indice", "inductif", "inédit", "ineptie", "inexact", "infini", "infliger", "informer", "infusion", "ingérer", "inhaler",
    "inhiber", "injecter", "injure", "innocent", "inoculer", "inonder", "inscrire", "insecte", "insigne", "insolite", "inspirer", "instinct", "insulter", "intact", "intense", "intime",
    "intrigue", "intuitif", "inutile", "invasion", "inventer", "inviter", "invoquer", "ironique", "irradier", "irréel", "irriter", "isoler", "ivoire", "ivresse", "jaguar", "jaillir",
    "jambe", "janvier", "jardin", "jauger", "jaune", "javelot", "jetable", "jeton", "jeudi", "jeunesse", "joindre", "joncher", "jongler", "joueur", "jouissif", "journal",
    "jovial", "joyau", "joyeux", "jubiler", "jugement", "junior", "jupon", "juriste", "justice", "juteux", "juvénile", "kayak", "kimono", "kiosque", "label", "labial",
    "labourer", "lacérer", "lactose", "lagune", "laine", "laisser", "laitier", "lambeau", "lamelle", "lampe", "lanceur", "langage", "lanterne", "lapin", "largeur", "larme",
    "laurier", "lavabo", "lavoir", "lecture", "légal", "léger", "légume", "lessive", "lettre", "levier", "lexique", "lézard", "liasse", "libérer", "libre", "licence",
    "licorne", "liège", "lièvre", "ligature", "ligoter", "ligue", "limer", "limite", "limonade", "limpide", "linéaire", "lingot", "lionceau", "liquide", "lisière", "lister",
    "lithium", "litige", "littoral", "livreur", "logique", "lointain", "loisir", "lombric", "loterie", "louer", "lourd", "loutre", "louve", "loyal", "lubie", "lucide",
    "lucratif", "lueur", "lugubre", "luisant", "lumière", "lunaire", "lundi", "luron", "lutter", "luxueux", "machine", "magasin", "magenta", "magique", "maigre", "maillon",
    "maintien", "mairie", "maison", "majorer", "malaxer", "maléfice", "malheur", "malice", "mallette", "mammouth", "mandater", "maniable", "manquant", "manteau", "manuel", "marathon",
    "marbre", "marchand", "mardi", "maritime", "marqueur", "marron", "marteler", "mascotte", "massif", "matériel", "matière", "matraque", "maudire", "maussade", "mauve", "maximal",
    "méchant", "méconnu", "médaille", "médecin", "méditer", "méduse", "meilleur", "mélange", "mélodie", "membre", "mémoire", "menacer", "mener", "menhir", "mensonge", "mentor",
    "mercredi", "mérite", "merle", "messager", "mesure", "métal", "météore", "méthode", "métier", "meuble", "miauler", "microbe", "miette", "mignon", "migrer", "milieu",
    "million", "mimique", "mince", "minéral", "minimal", "minorer", "minute", "miracle", "miroiter", "missile", "mixte", "mobile", "moderne", "moelleux", "mondial", "moniteur",
    "monnaie", "monotone", "monstre", "montagne", "monument", "moqueur", "morceau", "morsure", "mortier", "moteur", "motif", "mouche", "moufle", "moulin", "mousson", "mouton",
    "mouvant", "multiple", "munition", "muraille", "murène", "murmure", "muscle", "muséum", "musicien", "mutation", "muter", "mutuel", "myriade", "myrtille", "mystère", "mythique",
    "nageur", "nappe", "narquois", "narrer", "natation", "nation", "nature", "naufrage", "nautique", "navire", "nébuleux", "nectar", "néfaste", "négation", "négliger", "négocier",
    "neige", "nerveux", "nettoyer", "neurone", "neutron", "neveu", "niche", "nickel", "nitrate", "niveau", "noble", "nocif", "nocturne", "noirceur", "noisette", "nomade",
    "nombreux", "nommer", "normatif", "notable", "notifier", "notoire", "nourrir", "nouveau", "novateur", "novembre", "novice", "nuage", "nuancer", "nuire", "nuisible", "numéro",
    "nuptial", "nuque", "nutritif", "obéir", "objectif", "obliger", "obscur", "observer", "obstacle", "obtenir", "obturer", "occasion", "occuper", "océan", "octobre", "octroyer",
    "octupler", "oculaire", "odeur", "odorant", "offenser", "officier", "offrir", "ogive", "oiseau", "oisillon", "olfactif", "olivier", "ombrage", "omettre", "onctueux", "onduler",
    "onéreux", "onirique", "opale", "opaque", "opérer", "opinion", "opportun", "opprimer", "opter", "optique", "orageux", "orange", "orbite", "ordonner", "oreille", "organe",
    "orgueil", "orifice", "ornement", "orque", "ortie", "osciller", "osmose", "ossature", "otarie", "ouragan", "ourson", "outil", "outrager", "ouvrage", "ovation", "oxyde",
    "oxygène", "ozone", "paisible", "palace", "palmarès", "palourde", "palper", "panache", "panda", "pangolin", "paniquer", "panneau", "panorama", "pantalon", "papaye", "papier",
    "papoter", "papyrus", "paradoxe", "parcelle", "paresse", "parfumer", "parler", "parole", "parrain", "parsemer", "partager", "parure", "parvenir", "passion", "pastèque", "paternel",
    "patience", "patron", "pavillon", "pavoiser", "payer", "paysage", "peigne", "peintre", "pelage", "pélican", "pelle", "pelouse", "peluche", "pendule", "pénétrer", "pénible",
    "pensif", "pénurie", "pépite", "péplum", "perdrix", "perforer", "période", "permuter", "perplexe", "persil", "perte", "peser", "pétale", "petit", "pétrir", "peuple",
    "pharaon", "phobie", "phoque", "photon", "phrase", "physique", "piano", "pictural", "pièce", "pierre", "pieuvre", "pilote", "pinceau", "pipette", "piquer", "pirogue",
    "piscine", "piston", "pivoter", "pixel", "pizza", "placard", "plafond", "plaisir", "planer", "plaque", "plastron", "plateau", "pleurer", "plexus", "pliage", "plomb",
    "plonger", "pluie", "plumage", "pochette", "poésie", "poète", "pointe", "poirier", "poisson", "poivre", "polaire", "policier", "pollen", "polygone", "pommade", "pompier",
    "ponctuel", "pondérer", "poney", "portique", "position", "posséder", "posture", "potager", "poteau", "potion", "pouce", "poulain", "poumon", "pourpre", "poussin", "pouvoir",
    "prairie", "pratique", "précieux", "prédire", "préfixe", "prélude", "prénom", "présence", "prétexte", "prévoir", "primitif", "prince", "prison", "priver", "problème", "procéder",
    "prodige", "profond", "progrès", "proie", "projeter", "prologue", "promener", "propre", "prospère", "protéger", "prouesse", "proverbe", "prudence", "pruneau", "psychose", "public",
    "puceron", "puiser", "pulpe", "pulsar", "punaise", "punitif", "pupitre", "purifier", "puzzle", "pyramide", "quasar", "querelle", "question", "quiétude", "quitter", "quotient",
    "racine", "raconter", "radieux", "ragondin", "raideur", "raisin", "ralentir", "rallonge", "ramasser", "rapide", "rasage", "ratisser", "ravager", "ravin", "rayonner", "réactif",
    "réagir", "réaliser", "réanimer", "recevoir", "réciter", "réclamer", "récolter", "recruter", "reculer", "recycler", "rédiger", "redouter", "refaire", "réflexe", "réformer", "refrain",
    "refuge", "régalien", "région", "réglage", "régulier", "réitérer", "rejeter", "rejouer", "relatif", "relever", "relief", "remarque", "remède", "remise", "remonter", "remplir",
    "remuer", "renard", "renfort", "renifler", "renoncer", "rentrer", "renvoi", "replier", "reporter", "reprise", "reptile", "requin", "réserve", "résineux", "résoudre", "respect",
    "rester", "résultat", "rétablir", "retenir", "réticule", "retomber", "retracer", "réunion", "réussir", "revanche", "revivre", "révolte", "révulsif", "richesse", "rideau", "rieur",
    "rigide", "rigoler", "rincer", "riposter", "risible", "risque", "rituel", "rival", "rivière", "rocheux", "romance", "rompre", "ronce", "rondin", "roseau", "rosier",
    "rotatif", "rotor", "rotule", "rouge", "rouille", "rouleau", "routine", "royaume", "ruban", "rubis", "ruche", "ruelle", "rugueux", "ruiner", "ruisseau", "ruser",
    "rustique", "rythme", "sabler", "saboter", "sabre", "sacoche", "safari", "sagesse", "saisir", "salade", "salive", "salon", "saluer", "samedi", "sanction", "sanglier",
    "sarcasme", "sardine", "saturer", "saugrenu", "saumon", "sauter", "sauvage", "savant", "savonner", "scalpel", "scandale", "scélérat", "scénario", "sceptre", "schéma", "science",
    "scinder", "score", "scrutin", "sculpter", "séance", "sécable", "sécher", "secouer", "sécréter", "sédatif", "séduire", "seigneur", "séjour", "sélectif", "semaine", "sembler",
    "semence", "séminal", "sénateur", "sensible", "sentence", "séparer", "séquence", "serein", "sergent", "sérieux", "serrure", "sérum", "service", "sésame", "sévir", "sevrage",
    "sextuple", "sidéral", "siècle", "siéger", "siffler", "sigle", "signal", "silence", "silicium", "simple", "sincère", "sinistre", "siphon", "sirop", "sismique", "situer",
    "skier", "social", "socle", "sodium", "soigneux", "soldat", "soleil", "solitude", "soluble", "sombre", "sommeil", "somnoler", "sonde", "songeur", "sonnette", "sonore",
    "sorcier", "sortir", "sosie", "sottise", "soucieux", "soudure", "souffle", "soulever", "soupape", "source", "soutirer", "souvenir", "spacieux", "spatial", "spécial", "sphère",
    "spiral", "stable", "station", "sternum", "stimulus", "stipuler", "strict", "studieux", "stupeur", "styliste", "sublime", "substrat", "subtil", "subvenir", "succès", "sucre",
    "suffixe", "suggérer", "suiveur", "sulfate", "superbe", "supplier", "surface", "suricate", "surmener", "surprise", "sursaut", "survie", "suspect", "syllabe", "symbole", "symétrie",
    "synapse", "syntaxe", "système", "tabac", "tablier", "tactile", "tailler", "talent", "talisman", "talonner", "tambour", "tamiser", "tangible", "tapis", "taquiner", "tarder",
    "tarif", "tartine", "tasse", "tatami", "tatouage", "taupe", "taureau", "taxer", "témoin", "temporel", "tenaille", "tendre", "teneur", "tenir", "tension", "terminer",
    "terne", "terrible", "tétine", "texte", "thème", "théorie", "thérapie", "thorax", "tibia", "tiède", "timide", "tirelire", "tiroir", "tissu", "titane", "titre",
    "tituber", "toboggan", "tolérant", "tomate", "tonique", "tonneau", "toponyme", "torche", "tordre", "tornade", "torpille", "torrent", "torse", "tortue", "totem", "toucher",
    "tournage", "tousser", "toxine", "traction", "trafic", "tragique", "trahir", "train", "trancher", "travail", "trèfle", "tremper", "trésor", "treuil", "triage", "tribunal",
    "tricoter", "trilogie", "triomphe", "tripler", "triturer", "trivial", "trombone", "tronc", "tropical", "troupeau", "tuile", "tulipe", "tumulte", "tunnel", "turbine", "tuteur",
    "tutoyer", "tuyau", "tympan", "typhon", "typique", "tyran", "ubuesque", "ultime", "ultrason", "unanime", "unifier", "union", "unique", "unitaire", "univers", "uranium",
    "urbain", "urticant", "usage", "usine", "usuel", "usure", "utile", "utopie", "vacarme", "vaccin", "vagabond", "vague", "vaillant", "vaincre", "vaisseau", "valable",
    "valise", "vallon", "valve", "vampire", "vanille", "vapeur", "varier", "vaseux", "vassal", "vaste", "vecteur", "vedette", "végétal", "véhicule", "veinard", "véloce",
    "vendredi", "vénérer", "venger", "venimeux", "ventouse", "verdure", "vérin", "vernir", "verrou", "verser", "vertu", "veston", "vétéran", "vétuste", "vexant", "vexer",
    "viaduc", "viande", "victoire", "vidange", "vidéo", "vignette", "vigueur", "vilain", "village", "vinaigre", "violon", "vipère", "virement", "virtuose", "virus", "visage",
    "viseur", "vision", "visqueux", "visuel", "vital", "vitesse", "viticole", "vitrine", "vivace", "vivipare", "vocation", "voguer", "voile", "voisin", "voiture", "volaille",
    "volcan", "voltiger", "volume", "vorace", "vortex", "voter", "vouloir", "voyage", "voyelle", "wagon", "xénon", "yacht", "zèbre", "zénith", "zeste", "zoologie"
  ];
  function normaliser(texte) {
    return String(texte || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[\s ]+/g, " ").trim();
  }
  const MOTS_NORMALISES = new Map();
  for (const m of MOTS) MOTS_NORMALISES.set(normaliser(m), m);
  function genererPhrase() {
    const idx = new Uint16Array(12); env.crypto.getRandomValues(idx);   /* 65536 = 32 × 2048 : pas de biais */
    const mots = Array.prototype.map.call(idx, (i) => MOTS[i & 2047]);
    return { mots: mots, phrase: mots.join(" ") };
  }
  /* Ce qu'on a tapé : 12 mots de la liste (accents et casse libres) ou la
     liste de ce qui cloche. `canonique` est ce qui entre dans PBKDF2. */
  function analyserPhrase(texte) {
    const mots = normaliser(texte).split(" ").filter(Boolean);
    const inconnus = mots.filter((m) => !MOTS_NORMALISES.has(m));
    return { ok: mots.length === 12 && !inconnus.length, nombre: mots.length, inconnus: inconnus,
             mots: mots.map((m) => MOTS_NORMALISES.get(m) || m), canonique: mots.join(" ") };
  }
  async function cleDePhrase(canonique, sel, iterations) {
    const octets = await pbkdf2(canonique, sel, iterations, 32);
    return cleAes(octets);
  }
  /* La copie de la clé privée, chiffrée par la phrase. `membre` et `version`
     entrent dans l'AAD : la copie d'un autre, ou d'une autre version, ne
     s'ouvre pas avec cette phrase-ci. */
  async function envelopperPrivee(pkcs8, phrase, membre, version, iterations) {
    const a = analyserPhrase(phrase);
    if (!a.ok) throw new Error("phrase invalide");
    const it = iterations || ITERATIONS;
    const sel = aleatoire(16);
    const cle = await cleDePhrase(a.canonique, sel, it);
    const enveloppe = await sceller(cle, pkcs8, aad(["fiches-but/cle-privee/v" + VERSION, membre, version]));
    return { kdf: "pbkdf2-sha256", iterations: it, sel: b64u(sel), enveloppe: enveloppe };
  }
  async function ouvrirPrivee(copie, phrase, membre) {
    const a = analyserPhrase(phrase);
    if (!a.ok) throw new Error("phrase invalide");
    if (!copie || copie.kdf !== "pbkdf2-sha256" || !Number.isInteger(copie.iterations)) throw new Error("copie de clé illisible");
    const cle = await cleDePhrase(a.canonique, deB64u(copie.sel), copie.iterations);
    return ouvrir(cle, copie.enveloppe, aad(["fiches-but/cle-privee/v" + VERSION, membre, copie.version]), "phrase incorrecte");
  }
  /* Le fichier .txt à télécharger (demande de l'auteur) : la phrase, et ce
     qu'elle vaut, en clair — à garder hors d'un poste partagé. */
  function fichierPhrase(mots, pseudo, quand) {
    return "Fiches BUT — phrase de récupération des messages privés\n"
      + "Compte : " + (pseudo || "?") + " — créée le " + (quand || new Date().toLocaleDateString("fr-FR")) + "\n\n"
      + mots.map((m, i) => (i + 1) + ". " + m).join("\n") + "\n\n"
      + "Cette phrase déverrouille tes messages privés chiffrés sur un nouvel appareil.\n"
      + "Le site ne la connaît pas et ne peut pas la remontrer : sans elle, les messages\n"
      + "chiffrés sont perdus. Garde ce fichier hors d'un ordinateur partagé.\n";
  }

  /* ---------- la clé de conversation et ses enveloppes ---------- */
  function genererCleConversation() { return aleatoire(32); }
  async function importerCleConversation(octets) {
    if (!(octets instanceof Uint8Array) || octets.length !== 32) throw new Error("clé de conversation : 32 octets attendus");
    return cleAes(octets);
  }
  function champsEnveloppe(c) {
    for (const k of ["groupe", "version", "membre", "membre_version", "par", "par_version"]) {
      if (c[k] === undefined || c[k] === null || c[k] === "") throw new Error("enveloppe : champ manquant « " + k + " »");
    }
    return aad(["fiches-but/enveloppe/v" + VERSION, c.groupe, c.version, c.membre, c.membre_version, c.par, c.par_version]);
  }
  /* Enveloppe la clé de conversation pour `membre` : ECDH statique-statique
     entre MA privée et SA publique, HKDF avec un sel neuf, AES-GCM. Seul
     quelqu'un qui détient ma privée peut produire cette enveloppe ; seul
     `membre` (avec sa privée et ma publique) peut l'ouvrir. */
  async function envelopper(cleConversation, maPrivee, saPubliqueJwk, champs) {
    if (!(cleConversation instanceof Uint8Array) || cleConversation.length !== 32) throw new Error("clé de conversation : 32 octets attendus");
    const a = champsEnveloppe(champs);
    const sel = aleatoire(32);
    const secret = await ecdh(maPrivee, saPubliqueJwk);
    const cle = await cleAes(await hkdf(secret, sel, ENC.encode(INFO_ENVELOPPE), 32));
    return { sel: b64u(sel), enveloppe: await sceller(cle, cleConversation, a) };
  }
  async function ouvrirEnveloppe(env_, maPrivee, saPubliqueJwk, champs) {
    const a = champsEnveloppe(champs);
    const secret = await ecdh(maPrivee, saPubliqueJwk);
    const cle = await cleAes(await hkdf(secret, deB64u(env_.sel), ENC.encode(INFO_ENVELOPPE), 32));
    const octets = await ouvrir(cle, env_.enveloppe, a, "enveloppe illisible");
    if (octets.length !== 32) throw new Error("enveloppe illisible");
    return octets;
  }

  /* ---------- les messages ---------- */
  const FICHE = /^S[1-6]-R[0-9]{3}-[0-9]{2}(#[a-z0-9-]{1,80})?$/;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  /* Les références telles qu'on accepte de les chiffrer (la route ne les
     voit plus) ; null si la forme n'y est pas. */
  function refsValides(brut) {
    if (brut === undefined || brut === null) return [];
    if (!Array.isArray(brut) || brut.length > REFS_MAX) return null;
    const propres = [];
    for (const r of brut) {
      if (!r || typeof r !== "object") return null;
      const id = String(r.id || "");
      if (r.type === "fiche" && FICHE.test(id)) propres.push({ type: "fiche", id: id });
      else if (r.type === "seance" && UUID.test(id)) propres.push({ type: "seance", id: id });
      else return null;
    }
    return propres;
  }
  function champsMessage(c) {
    for (const k of ["groupe", "auteur", "cle_version"]) {
      if (c[k] === undefined || c[k] === null || c[k] === "") throw new Error("message : champ manquant « " + k + " »");
    }
    return aad(["fiches-but/message/v" + VERSION, c.groupe, c.auteur, c.cle_version]);
  }
  async function chiffrerMessage(cleConversation, clair, champs) {
    const t = String(clair && clair.t || "").trim();
    if (!t) throw new Error("Le message est vide.");
    if (t.length > TEXTE_MAX) throw new Error(TEXTE_MAX + " caractères au plus.");
    const refs = refsValides(clair && clair.refs);
    if (refs === null) throw new Error("Références mal formées.");
    const a = champsMessage(champs);
    const chiffre = await sceller(cleConversation, ENC.encode(JSON.stringify({ v: VERSION, t: t, refs: refs })), a);
    if (chiffre.length > CHIFFRE_MAX) throw new Error("Message trop long une fois chiffré.");
    return chiffre;
  }
  /* Rend { v, t, refs }. Un clair qui n'est pas le JSON attendu est rendu
     comme du texte (v = 0), jamais interprété. Lève « message illisible »
     si la clé, la place (AAD) ou les octets ne sont pas les bons. */
  async function dechiffrerMessage(cleConversation, chiffre, champs) {
    const a = champsMessage(champs);
    const octets = await ouvrir(cleConversation, chiffre, a, "message illisible");
    let texte;
    try { texte = DEC.decode(octets); } catch (e) { throw new Error("message illisible"); }
    let o = null;
    try { o = JSON.parse(texte); } catch (e) { o = null; }
    if (!o || typeof o !== "object" || typeof o.t !== "string") return { v: 0, t: texte, refs: [] };
    const refs = refsValides(o.refs);
    return { v: Number(o.v) || 0, t: o.t.slice(0, TEXTE_MAX), refs: refs || [] };
  }

  /* ---------- le rangement local (IndexedDB) ----------
     La clé privée (non extractable) et les clés de conversation (idem) de
     la personne connectée, par identifiant de compte : un navigateur qui
     sert à deux comptes ne mélange rien. `effacerTout()` à la déconnexion.
     Sans IndexedDB (navigateur privé, node) : rien n'est gardé, et on le
     dit (disponible() = false) — la phrase sera redemandée. */
  const BASE = "fiches-but-cles", MAGASIN = "cles";
  function baseLocale() {
    return new Promise((ok, non) => {
      if (!env.indexedDB) { non(new Error("pas d'IndexedDB")); return; }
      const d = env.indexedDB.open(BASE, 1);
      d.onupgradeneeded = () => { d.result.createObjectStore(MAGASIN, { keyPath: "id" }); };
      d.onsuccess = () => ok(d.result);
      d.onerror = () => non(d.error || new Error("IndexedDB refusé"));
      d.onblocked = () => non(new Error("IndexedDB bloqué"));
    });
  }
  function requete(mode, action) {
    return baseLocale().then((db) => new Promise((ok, non) => {
      const tx = db.transaction(MAGASIN, mode);
      const r = action(tx.objectStore(MAGASIN));
      tx.oncomplete = () => { db.close(); ok(r && "result" in r ? r.result : undefined); };
      tx.onerror = () => { db.close(); non(tx.error || new Error("IndexedDB : échec")); };
      tx.onabort = () => { db.close(); non(tx.error || new Error("IndexedDB : annulé")); };
    }));
  }
  const stockage = {
    disponible: () => !!env.indexedDB,
    lireIdentite: (membre) => requete("readonly", (s) => s.get("identite:" + membre)).then((r) => r || null).catch(() => null),
    /* `pkcs8` (facultatif) : les octets de la clé privée, gardés EN PLUS
       de la CryptoKey non extractable — c'est ce qui permet à cet appareil
       d'en ouvrir un autre sans la phrase (lot K1). Ce que ça coûte est
       écrit dans docs/chiffrement.md, § 9 : un script injecté sur notre
       origine pourrait les emporter, là où il ne pouvait que s'en servir.
       Un appareil qui n'en a pas (rangé avant le lot K1) ouvre l'autre
       appareil par la phrase : rien ne casse, on le dit. */
    ecrireIdentite: (membre, version, privee, publiqueJwk, pkcs8) =>
      requete("readwrite", (s) => s.put({ id: "identite:" + membre, membre, version, privee, publiqueJwk,
                                          pkcs8: (pkcs8 instanceof Uint8Array) ? new Uint8Array(pkcs8) : null,
                                          le: new Date().toISOString() })),
    lireCleConversation: (membre, groupe, version) =>
      requete("readonly", (s) => s.get("conversation:" + membre + ":" + groupe + ":" + version)).then((r) => r ? r.cle : null).catch(() => null),
    ecrireCleConversation: (membre, groupe, version, cle) =>
      requete("readwrite", (s) => s.put({ id: "conversation:" + membre + ":" + groupe + ":" + version, membre, groupe, version, cle })),
    /* les versions de la clé d'identité d'un contact que J'AI acceptées
       (la première par confiance au premier usage, les suivantes à la main,
       après l'alerte) : sans cette mémoire, une clé substituée passerait
       pour une clé changée qu'on a déjà vérifiée */
    lireAcceptees: (membre, autre) =>
      requete("readonly", (s) => s.get("acceptees:" + membre + ":" + autre)).then((r) => (r && Array.isArray(r.versions)) ? r.versions : []).catch(() => []),
    ecrireAcceptees: (membre, autre, versions) =>
      requete("readwrite", (s) => s.put({ id: "acceptees:" + membre + ":" + autre, membre, autre, versions: versions.slice() })),
    effacerTout: () => requete("readwrite", (s) => s.clear()).catch(() => undefined),
  };

  return {
    VERSION, ITERATIONS, ALGO, TEXTE_MAX, REFS_MAX, CHIFFRE_MAX, MOTS,
    disponible, b64u, deB64u, hex, deHex, aleatoire, memes,
    primitives: { aesGcmChiffrer, aesGcmDechiffrer, hkdf, pbkdf2, ecdh, sha256 },
    publiqueValide, importerPublique, importerPriveeNonExtractable, genererIdentite, empreinte,
    genererEphemere, envelopperIdentite, ouvrirTransfert, correspond,
    selPasskey, scellerParPasskey, ouvrirParPasskey,
    normaliser, genererPhrase, analyserPhrase, envelopperPrivee, ouvrirPrivee, fichierPhrase,
    genererCleConversation, importerCleConversation, envelopper, ouvrirEnveloppe,
    refsValides, chiffrerMessage, dechiffrerMessage,
    stockage,
  };
});
