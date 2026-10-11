/* ==========================================================================
   Connexion, inscription, choix du pseudo
   ==========================================================================

   Un seul fichier pour deux pages — connexion et accès réservé —
   parce qu'elles partagent le même mécanisme et qu'une page n'active que ce
   qu'elle contient.

   Le principe qui commande tout : le jeton ne reste jamais dans la page. Il
   est transmis une fois à /api/session, qui le revérifie et pose un cookie
   HttpOnly. Aucun script ne peut ensuite le relire, donc aucune faille
   d'affichage ne permet de voler une session.

   Aucune bibliothèque : Supabase est interrogé directement en HTTP. Le site
   n'a pas de dépendance, et deux appels ne justifient pas d'en introduire une.
   ========================================================================== */

const CFG = window.CONFIG || {};
const API = CFG.supabaseUrl || "";
const CLE = CFG.supabaseAnonKey || "";

const $ = (sel) => document.querySelector(sel);
const etat = $("#etat");

/* Le jeton reçu par lien de réinitialisation. Gardé en mémoire, le temps de
   poser le nouveau mot de passe, et jamais écrit nulle part. */
let jetonRecuperation = null;


function dire(message, type) {
  if (!etat) return;
  etat.textContent = message;
  etat.className = "etat" + (type ? " etat-" + type : "");
  etat.hidden = !message;
}


/** Appel à Supabase, avec la clé publique.

    La méthode est un paramètre parce que toutes les portes de Supabase ne
    s'ouvrent pas de la même façon : créer quelque chose se fait en POST,
    modifier son propre compte (/auth/v1/user) en PUT. Un POST y répond 405,
    et l'erreur ne dit rien de ce qu'il fallait faire. */
async function supabase(chemin, corps, jeton, methode) {
  const entetes = { "content-type": "application/json", "apikey": CLE };
  if (jeton) entetes["Authorization"] = "Bearer " + jeton;

  const r = await fetch(API + chemin, {
    method: methode || "POST",
    headers: entetes,
    body: JSON.stringify(corps),
  });
  let donnees = null;
  try { donnees = await r.json(); } catch (err) { /* réponse vide */ }
  return { ok: r.ok, statut: r.status, donnees };
}


/** Cette adresse recevra-t-elle nos courriels ?

    Certaines messageries acceptent le message puis le suppriment sans
    rien afficher : la personne attend un courriel qui n'arrivera jamais
    et croit le site cassé. Autant le dire avant. */
function courrielImpossible(adresse) {
  const bloques = CFG.domainesBloques || {};
  const domaine = (adresse.split("@")[1] || "").toLowerCase();
  return bloques[domaine] || null;
}


/** Message lisible à partir d'une réponse d'erreur de Supabase. */
function messageErreur(reponse, defaut) {
  const d = reponse.donnees || {};
  const brut = d.error_description || d.msg || d.message || "";
  if (/invalid login credentials/i.test(brut)) return "Adresse ou mot de passe incorrect.";
  if (/already registered/i.test(brut)) return "Un compte existe déjà avec cette adresse.";
  if (/password should be/i.test(brut)) return "Le mot de passe doit faire au moins 8 caractères.";
  if (/rate limit|too many/i.test(brut)) return "Trop de tentatives. Réessaie dans quelques minutes.";
  return brut || defaut;
}


/* --------------------------------------------------------------------------
   Où aller après la connexion
   --------------------------------------------------------------------------
   Le paramètre « suite » vient de l'adresse, donc de l'extérieur. On ne le
   suit QUE s'il désigne un chemin de ce site.

   Sans ce contrôle, un lien du type
       /connexion?suite=https://site-pirate.example
   renverrait la personne ailleurs juste après qu'elle se soit connectée, en
   lui donnant l'impression que le site l'y envoie lui-même. C'est ce qu'on
   appelle une redirection ouverte.

   La double barre est refusée aussi : « //ailleurs.example » est un chemin
   valide vers un autre domaine.

   Et ce n'est pas tout, vu le 1er octobre par le banc d'essai
   (essais/pages/connexion.essai.mjs) : le navigateur lit « \ » comme « / »,
   et retire tabulations et retours à la ligne avant de lire une adresse.
   « /\ailleurs.example » ou « /<tab>/ailleurs.example » passent donc le
   premier test et mènent pourtant ailleurs. On ne juge plus la chaîne : on
   la résout comme le navigateur le fera, et on n'en garde le chemin que si
   elle reste sur ce site.
-------------------------------------------------------------------------- */
function destination() {
  const demande = new URLSearchParams(location.search).get("suite") || "/";
  if (!demande.startsWith("/") || demande.startsWith("//")) return "/";
  let cible;
  try { cible = new URL(demande, location.origin); } catch (err) { return "/"; }
  if (cible.origin !== location.origin) return "/";
  return cible.pathname + cible.search + cible.hash;
}


/* --------------------------------------------------------------------------
   « Rester connecté »
   --------------------------------------------------------------------------
   Une case sur le formulaire. Cochée, le jeton de renouvellement part avec le
   jeton d'accès vers /api/session, qui le garde trente jours dans un second
   cookie HttpOnly. Décochée, le navigateur l'oublie avec la page : une heure,
   puis on se reconnecte — le comportement par défaut, voulu pour les postes
   partagés.

   Avec Google, GitHub ou Discord, on quitte la page avant de revenir avec
   les jetons : le choix est mis de côté dans sessionStorage — propre à cet
   onglet, effacé quand il se ferme — le temps du détour.
-------------------------------------------------------------------------- */
const CLE_RESTER = "fb_rester";

function resterCoche() {
  const c = document.getElementById("rester");
  return !!(c && c.checked);
}

function memoriserRester() {
  try {
    if (resterCoche()) sessionStorage.setItem(CLE_RESTER, "1");
    else sessionStorage.removeItem(CLE_RESTER);
  } catch (err) { /* stockage indisponible : on partira sans */ }
}

function resterMemorise() {
  try {
    const v = sessionStorage.getItem(CLE_RESTER) === "1";
    sessionStorage.removeItem(CLE_RESTER);
    return v;
  } catch (err) { return false; }
}


/** Échange les jetons contre un ou deux cookies, puis oriente selon l'état
    du compte. « renouvellement » et « rester » sont facultatifs : sans eux,
    on obtient exactement la session d'une heure d'avant. */
async function ouvrirSession(jeton, renouvellement, rester) {
  const r = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      access_token: jeton,
      refresh_token: rester && renouvellement ? renouvellement : null,
      rester: !!rester,
    }),
  });
  if (!r.ok) {
    dire("La connexion n'a pas pu être établie. Réessaie.", "erreur");
    return;
  }

  /* Un compte sans pseudo est désormais rattrapé par la fenêtre du site, qui
     se présente sur n'importe quelle page tant qu'il en manque un. Il n'y a
     donc plus de détour à faire ici : on va où l'on allait.

     L'ancienne version détournait vers une page dédiée. Une page se quitte —
     et des comptes sont restés sans pseudo pour l'avoir simplement fermée.
     Une fenêtre qui revient à chaque page, non. */
  location.replace(destination());
}


/* --------------------------------------------------------------------------
   Retour d'un lien reçu par courriel, ou d'un fournisseur externe
   --------------------------------------------------------------------------
   Supabase renvoie le jeton dans le FRAGMENT de l'adresse, après le « # », et
   non dans la requête : le fragment n'est transmis ni au serveur ni aux
   journaux. On le lit, on le retire de la barre d'adresse pour qu'il ne
   traîne pas dans l'historique, puis on l'échange contre un cookie.
-------------------------------------------------------------------------- */
async function retourDeLien() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const jeton = fragment.get("access_token");
  const renouvellement = fragment.get("refresh_token");
  const erreur = fragment.get("error_description");
  const type = fragment.get("type");
  const rester = resterMemorise();

  if (!jeton && !erreur) return false;

  history.replaceState(null, "", location.pathname + location.search);

  if (erreur) {
    dire(decodeURIComponent(erreur.replace(/\+/g, " ")), "erreur");
    return true;
  }

  /* Un lien de réinitialisation ouvre bien une session, mais l'envoyer sur le
     site sans changer le mot de passe laisserait la personne devant le même
     problème dans une heure. On lui fait poser son nouveau mot de passe. */
  if (type === "recovery") {
    jetonRecuperation = jeton;
    montrerVue("vue-nouveau");
    return true;
  }

  dire("Connexion en cours…", "info");
  await ouvrirSession(jeton, renouvellement, rester);
  return true;
}


/* --------------------------------------------------------------------------
   Page de connexion
-------------------------------------------------------------------------- */

const formulaireMotDePasse = $("#form-mot-de-passe");
const formulaireLien = $("#form-lien");
const champAdresse = $("#adresse");
const champMotDePasse = $("#mot-de-passe");
const boutonValider = $("#valider");
const boutonBascule = $("#bascule");
const blocPseudo = $("#bloc-pseudo");
const champPseudo = $("#pseudo");
const etatPseudo = $("#etat-pseudo");
const etiquetteAdresse = $("#label-adresse");
const blocConsentement = $("#bloc-consentement");
const caseConsentement = $("#consentement");
const titre = $("#titre-connexion");
const intro = $("#intro-connexion");
const formulaireOubli = $("#form-oubli");
const formulaireNouveau = $("#form-nouveau");

let mode = "connexion";        // « connexion » ou « inscription »


/* --------------------------------------------------------------------------
   Les vues de la carte de connexion
   --------------------------------------------------------------------------
   Une seule page, quatre états : le choix d'une porte d'entrée, la demande
   d'un lien, la demande d'un mot de passe oublié, le choix d'un nouveau mot
   de passe. Chacun a besoin d'une seule chose à la fois.

   Quand on vient de cliquer « mot de passe oublié », voir encore les boutons
   Google et le formulaire de connexion n'aide pas : on sait déjà qu'on ne
   peut pas s'en servir. La carte ne montre donc que l'étape en cours.
-------------------------------------------------------------------------- */

const TITRES_VUES = {
  "vue-lien": ["Lien de connexion",
               "On t'envoie un lien à ouvrir. Aucun mot de passe à retenir."],
  "vue-oubli": ["Mot de passe oublié",
                "Saisis ton adresse : tu recevras un lien pour en choisir un "
                + "nouveau."],
  "vue-nouveau": ["Nouveau mot de passe",
                  "Choisis un mot de passe d'au moins 8 caractères."],
};


function montrerVue(nom) {
  document.querySelectorAll(".vue").forEach((v) => { v.hidden = v.id !== nom; });

  if (nom === "vue-principal") {
    titresPrincipaux();
  } else if (TITRES_VUES[nom]) {
    if (titre) titre.textContent = TITRES_VUES[nom][0];
    if (intro) intro.textContent = TITRES_VUES[nom][1];
  }
  dire("");

  /* Le premier champ de la vue reçoit le curseur : la personne vient de
     cliquer pour arriver là, lui faire cliquer une seconde fois est de trop. */
  const champ = document.querySelector("#" + nom + " input:not([hidden])");
  if (champ) champ.focus();
}


function titresPrincipaux() {
  const inscrit = mode === "inscription";
  if (titre) titre.textContent = inscrit ? "Créer un compte" : "Connexion";
  if (intro) {
    intro.textContent = inscrit
      ? "N'importe quelle adresse convient. Choisis aussi le pseudo sous lequel "
        + "les autres te verront."
      : "Un compte donne accès aux outils de la promo. N'importe quelle adresse convient.";
  }
}


/* --------------------------------------------------------------------------
   Voir ce qu'on tape
   --------------------------------------------------------------------------
   Un mot de passe masqué se tape à l'aveugle, et une faute de frappe ne se
   distingue pas d'un mot de passe oublié. L'œil ouvert propose de regarder ;
   une fois le mot de passe visible, il se barre pour proposer de le cacher.
-------------------------------------------------------------------------- */

const OEIL = '<svg viewBox="0 0 24 24" aria-hidden="true">'
  + '<path fill="none" stroke="currentColor" stroke-width="1.8" '
  + 'd="M1.8 12S5.6 5.2 12 5.2 22.2 12 22.2 12 18.4 18.8 12 18.8 1.8 12 1.8 12z"/>'
  + '<circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" '
  + 'stroke-width="1.8"/></svg>';

const OEIL_BARRE = '<svg viewBox="0 0 24 24" aria-hidden="true">'
  + '<path fill="none" stroke="currentColor" stroke-width="1.8" '
  + 'd="M1.8 12S5.6 5.2 12 5.2 22.2 12 22.2 12 18.4 18.8 12 18.8 1.8 12 1.8 12z"/>'
  + '<circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" '
  + 'stroke-width="1.8"/>'
  + '<path stroke="currentColor" stroke-width="1.8" stroke-linecap="round" '
  + 'd="m4 20 16-16"/></svg>';


function peindreOeil(bouton, visible) {
  bouton.innerHTML = visible ? OEIL_BARRE : OEIL;
  bouton.setAttribute("aria-label",
    visible ? "Masquer le mot de passe" : "Afficher le mot de passe");
  bouton.setAttribute("aria-pressed", visible ? "true" : "false");
}


function brancherOeil(bouton) {
  const champ = document.getElementById(bouton.getAttribute("data-oeil"));
  if (!champ) return;
  peindreOeil(bouton, false);
  bouton.addEventListener("click", () => {
    const visible = champ.type === "password";
    champ.type = visible ? "text" : "password";
    peindreOeil(bouton, visible);
    champ.focus();
  });
}


function basculerMode() {
  mode = mode === "connexion" ? "inscription" : "connexion";
  const inscrit = mode === "inscription";

  titresPrincipaux();
  if (boutonValider) boutonValider.textContent = inscrit ? "Créer mon compte" : "Se connecter";
  if (boutonBascule) boutonBascule.textContent = inscrit ? "J'ai déjà un compte" : "Créer un compte";
  if (champMotDePasse) {
    champMotDePasse.autocomplete = inscrit ? "new-password" : "current-password";
  }

  /* Le pseudo se choisit à l'inscription, avec le reste. L'ancienne page
     dédiée arrivait après coup, et se quittait sans rien remplir : des
     comptes se sont retrouvés sans pseudo. Demandé ici, il fait partie du
     geste de création. */
  if (blocPseudo) blocPseudo.hidden = !inscrit;

  /* En connexion, le champ accepte l'un ou l'autre ; à l'inscription, c'est
     forcément une adresse — c'est là que le compte se crée. */
  if (etiquetteAdresse) {
    etiquetteAdresse.textContent = inscrit
      ? "Adresse de courriel"
      : "Adresse de courriel ou pseudo";
  }

  /* Le consentement ne se demande qu'à l'inscription : c'est là que la
     collecte commence. Le redemander à chaque connexion serait du bruit. */
  if (blocConsentement) blocConsentement.hidden = !inscrit;
  if (caseConsentement) caseConsentement.checked = false;
  majBoutonValider();
  dire("");
}


/* --------------------------------------------------------------------------
   Le pseudo est-il libre ?
   --------------------------------------------------------------------------
   La question se pose à la base, par « pseudo_disponible », une fonction
   faite pour ça et ouverte aux visiteurs : elle ne répond que oui ou non, sur
   un nom qui est de toute façon public.

   Ce n'est PAS une garantie : entre la réponse et l'inscription, quelqu'un
   peut prendre le même nom. C'est l'index unique de la base qui tranche pour
   de bon, et le déclencheur qui, dans ce cas, crée le compte sans pseudo — la
   fenêtre du site en redemandera un. Cette vérification-ci ne sert qu'à
   éviter le cas courant, et à le dire tout de suite.
-------------------------------------------------------------------------- */
const FORME_PSEUDO = /^[A-Za-z0-9_-]{3,20}$/;
let verificationEnCours = 0;

async function pseudoLibre(candidat) {
  const r = await supabase("/rest/v1/rpc/pseudo_disponible", { candidat: candidat });
  if (!r.ok) return null;             // on ne sait pas : ne rien affirmer
  return r.donnees === true;
}

function direPseudo(texte, type) {
  if (!etatPseudo) return;
  etatPseudo.textContent = texte;
  etatPseudo.className = "c-note" + (type ? " etat-" + type : "");
}

async function verifierPseudo() {
  if (!champPseudo || mode !== "inscription") return;
  const v = champPseudo.value.trim();
  if (!v) {
    direPseudo("C'est le nom que les autres verront ; ton adresse, elle, "
               + "n'est jamais affichée. 3 à 20 caractères : lettres, "
               + "chiffres, tiret et souligné.");
    return;
  }
  if (!FORME_PSEUDO.test(v)) {
    direPseudo("3 à 20 caractères : lettres, chiffres, tiret et souligné.",
               "erreur");
    return;
  }

  /* Deux frappes rapides lancent deux vérifications ; la plus lente peut
     répondre en dernier et écraser la bonne réponse. On ne retient donc que
     la dernière demandée. */
  const mien = ++verificationEnCours;
  direPseudo("Vérification\u2026");
  const libre = await pseudoLibre(v);
  if (mien !== verificationEnCours) return;

  if (libre === null) direPseudo("Impossible de vérifier pour l'instant.");
  else if (libre) direPseudo("« " + v + " » est libre.", "succes");
  else direPseudo("« " + v + " » est déjà pris.", "erreur");
}


function majBoutonValider() {
  if (!boutonValider) return;
  const besoin = mode === "inscription" && caseConsentement && !caseConsentement.checked;
  boutonValider.disabled = besoin;
}


async function envoyerMotDePasse(ev) {
  ev.preventDefault();
  const saisi = champAdresse.value.trim();
  const adresse = saisi.toLowerCase();
  const motDePasse = champMotDePasse.value;

  if (mode === "inscription") {
    const empeche = courrielImpossible(adresse);
    if (empeche) { dire(empeche, "erreur"); return; }

    const pseudo = champPseudo ? champPseudo.value.trim() : "";
    if (!FORME_PSEUDO.test(pseudo)) {
      dire("Choisis un pseudo : 3 à 20 caractères, lettres, chiffres, tiret "
           + "et souligné.", "erreur");
      if (champPseudo) champPseudo.focus();
      return;
    }
    /* Dernière vérification avant l'envoi. Elle ne garantit rien — c'est
       l'index unique de la base qui tranche — mais elle évite d'envoyer une
       inscription qu'on sait déjà perdante. */
    if (await pseudoLibre(pseudo) === false) {
      dire("Ce pseudo est déjà pris. Choisis-en un autre.", "erreur");
      if (champPseudo) champPseudo.focus();
      return;
    }

    if (!caseConsentement || !caseConsentement.checked) {
      dire("Il faut accepter l'enregistrement de tes données pour créer un compte.", "erreur");
      return;
    }
    dire("Création du compte…", "info");

    /* redirect_to : le lien du courriel de confirmation ramène ICI, avec la
       requête (dont « suite ») — sans lui, Supabase renvoie à l'adresse par
       défaut du projet, et une invitation ouverte avant de créer le compte
       serait perdue. Même mécanique que le lien magique. */
    const r = await supabase("/auth/v1/signup?redirect_to=" + encodeURIComponent(retour()), {
      email: adresse,
      password: motDePasse,
      /* La preuve du consentement voyage avec la demande et reste attachée au
         compte : savoir QUE quelqu'un a consenti ne suffit pas, il faut
         pouvoir dire quand, et à quelle version de la notice. */
      data: {
        /* Le pseudo voyage dans les métadonnées : avec la confirmation
           d'adresse, l'inscription n'ouvre pas de session, et il n'y aurait
           donc personne pour l'écrire ensuite. C'est le déclencheur de la
           base qui le pose sur le profil qu'il crée déjà. */
        pseudo: pseudo,
        consentement_date: new Date().toISOString(),
        consentement_version: CFG.rgpdVersion || "",
      },
    });

    if (!r.ok) { dire(messageErreur(r, "La création a échoué."), "erreur"); return; }

    /* Avec la confirmation d'adresse activée, l'inscription ne renvoie pas de
       session : il faut d'abord cliquer dans le courriel. */
    if (r.donnees && r.donnees.access_token) {
      await ouvrirSession(r.donnees.access_token, r.donnees.refresh_token, resterCoche());
      return;
    }

    /* Adresse déjà inscrite : Supabase répond 200 avec un utilisateur
       factice dont « identities » est vide, et n'envoie AUCUN courriel (c'est
       sa protection contre l'énumération des comptes). Sans ce test, on
       annonçait un courriel qui ne partirait jamais, et la personne
       attendait dans le vide. On préfère ici l'aveu à la discrétion : le
       site s'adresse à une promo, pas à des inconnus. */
    const u = r.donnees && r.donnees.user ? r.donnees.user : r.donnees;
    if (u && Array.isArray(u.identities) && u.identities.length === 0) {
      dire("Cette adresse a déjà un compte, donc aucun courriel n'a été "
           + "renvoyé. Passe par « J'ai déjà un compte », ou par « Mot de "
           + "passe oublié » si tu ne l'as plus.", "erreur");
      return;
    }

    dire("Courriel de confirmation envoyé à " + adresse
         + ". Ouvre-le pour activer ton compte, et pense aux indésirables.",
         "succes");
    return;
  }

  /* La connexion passe par le serveur, et non plus directement par Supabase :
     lui seul peut traduire un pseudo en adresse, avec une clé que le site n'a
     pas. Le navigateur envoie un identifiant sans savoir lequel des deux
     c'est, et reçoit un jeton ou un refus. */
  dire("Connexion en cours…", "info");
  let rep = null;
  let donnees = null;
  try {
    rep = await fetch("/api/connexion", {
      method: "POST",
      headers: { "content-type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ identifiant: saisi, mot_de_passe: motDePasse }),
    });
    donnees = await rep.json();
  } catch (err) {
    dire("Service indisponible. Réessaie dans un instant.", "erreur");
    return;
  }

  if (!rep.ok || !donnees || !donnees.access_token) {
    dire((donnees && donnees.erreur) || "Connexion refusée.", "erreur");
    return;
  }
  await ouvrirSession(donnees.access_token, donnees.refresh_token, resterCoche());
}


async function envoyerLien(ev) {
  ev.preventDefault();
  const adresse = $("#adresse-lien").value.trim().toLowerCase();

  const empeche = courrielImpossible(adresse);
  if (empeche) { dire(empeche, "erreur"); return; }

  dire("Envoi du lien…", "info");
  memoriserRester();

  const r = await supabase("/auth/v1/otp?redirect_to=" + encodeURIComponent(retour()),
                           { email: adresse, create_user: true });
  if (!r.ok) { dire(messageErreur(r, "L'envoi a échoué."), "erreur"); return; }
  dire("Lien de connexion envoyé à " + adresse
       + ". Il est valable une heure, et pense aux indésirables.", "succes");
}


async function motDePasseOublie(ev) {
  ev.preventDefault();
  const champ = $("#adresse-oubli");
  const adresse = champ ? champ.value.trim().toLowerCase() : "";
  if (!adresse) return;

  dire("Envoi du lien de réinitialisation…", "info");
  const r = await supabase("/auth/v1/recover?redirect_to=" + encodeURIComponent(retour()),
                           { email: adresse });
  if (!r.ok) { dire(messageErreur(r, "L'envoi a échoué."), "erreur"); return; }
  dire("Si un compte existe avec cette adresse, un lien vient d'être envoyé.", "succes");
}


/** L'adresse de retour après un courriel ou un fournisseur externe. */
function retour() {
  return location.origin + "/connexion" + location.search;
}


async function enregistrerNouveauMotDePasse(ev) {
  ev.preventDefault();
  dire("Enregistrement…", "info");

  /* PUT, et non POST : /auth/v1/user modifie un compte existant. */
  const r = await supabase("/auth/v1/user", { password: $("#nouveau").value },
                           jetonRecuperation, "PUT");
  if (!r.ok) { dire(messageErreur(r, "Impossible d'enregistrer."), "erreur"); return; }

  /* Le jeton de réinitialisation vaut déjà session : redemander de se
     connecter avec le mot de passe qu'on vient de poser n'apprendrait rien
     à personne. */
  dire("Mot de passe enregistré. Connexion…", "succes");
  await ouvrirSession(jetonRecuperation);
}


/** Les fournisseurs externes : une simple redirection, tout se passe chez eux.

    Constaté le 15 septembre 2026 : après « Se déconnecter », cliquer Google
    reconnectait le MÊME compte sans rien demander — Google réutilise sa
    session ouverte tant qu'on ne lui dit pas de proposer le choix. GoTrue
    transmet au fournisseur les paramètres qu'il ne connaît pas : « prompt »
    force ce choix (select_account chez Google, consent chez Discord).
    GitHub n'a pas d'équivalent : pour changer de compte, il faut se
    déconnecter de github.com. */
const PROMPT_FOURNISSEUR = { google: "select_account", discord: "consent" };

function brancherFournisseurs() {
  document.querySelectorAll("[data-fournisseur]").forEach((bouton) => {
    bouton.addEventListener("click", () => {
      const nom = bouton.getAttribute("data-fournisseur");
      memoriserRester();
      const prompt = PROMPT_FOURNISSEUR[nom] ? "&prompt=" + PROMPT_FOURNISSEUR[nom] : "";
      location.href = API + "/auth/v1/authorize?provider=" + encodeURIComponent(nom)
                    + prompt + "&redirect_to=" + encodeURIComponent(retour());
    });
  });
}


/* -------------------------------------------------------------------------- */

if (formulaireMotDePasse || formulaireLien) {
  if (!CFG.authentification) {
    dire("L'authentification n'est pas encore configurée sur ce site.", "info");
  } else {
    brancherFournisseurs();
    document.querySelectorAll("[data-oeil]").forEach(brancherOeil);
    document.querySelectorAll("[data-vue]").forEach((b) => {
      b.addEventListener("click", () => montrerVue(b.getAttribute("data-vue")));
    });
    if (formulaireMotDePasse) {
      formulaireMotDePasse.addEventListener("submit", envoyerMotDePasse);
    }
    if (formulaireLien) formulaireLien.addEventListener("submit", envoyerLien);
    /* On verifie quand la personne quitte le champ, pas a chaque touche :
       annoncer « deja pris » au deuxieme caractere serait faux et penible. */
    if (champPseudo) {
      champPseudo.addEventListener("blur", verifierPseudo);
      champPseudo.addEventListener("change", verifierPseudo);
    }
    if (formulaireOubli) formulaireOubli.addEventListener("submit", motDePasseOublie);
    if (formulaireNouveau) {
      formulaireNouveau.addEventListener("submit", enregistrerNouveauMotDePasse);
    }
    if (boutonBascule) boutonBascule.addEventListener("click", basculerMode);
    if (caseConsentement) caseConsentement.addEventListener("change", majBoutonValider);
    retourDeLien();
  }
}
