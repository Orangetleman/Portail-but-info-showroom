/* ==========================================================================
   La serrure — s'exécute AVANT que quoi que ce soit ne soit servi
   ==========================================================================

   Sur Cloudflare Pages, ce fichier s'interpose devant chaque requête du site,
   y compris les fichiers PDF. C'est ce qui distingue une vraie protection d'un
   simple rideau : une page de connexion écrite en JavaScript n'empêche
   personne de demander directement l'adresse d'un fichier. Ici, si le rôle ne
   suit pas, le fichier n'est jamais lu.

   ─── Le changement de modèle, à comprendre avant de modifier ce fichier ───

   Le site est désormais public. Le modèle s'inverse : « ouvert par défaut »,
   avec une liste de zones protégées. C'est le bon sens fonctionnel, mais c'est
   aussi le modèle le plus facile à trouer, parce qu'une nouvelle zone privée
   oubliée dans la liste est servie à tout le monde sans que rien ne le
   signale.

   D'où deux règles de conduite :

     1. toute zone contenant autre chose que du public s'ajoute à ZONES,
        AVANT d'écrire la première page qui la remplira ;
     2. ce qui n'a pas à être publié n'est pas généré du tout. Les fiches, par
        exemple, ne sont plus écrites dans site/ : elles ne peuvent donc pas
        fuir, même si cette liste était fausse.

   ========================================================================== */

import { sessionDe, avecCookies } from "./_session.js";
import { origineAutorisee, avecCors, reponsePrealable } from "./_cors.js";
import { lireProfilBase } from "./_profil.js";
import { CHEMINS_DEMO } from "./_demo.js";

/* Les rôles, du plus faible au plus fort. Le rang sert de comparaison : avoir
   le rôle N donne accès à tout ce qui demande N ou moins. */
const RANG = { user: 0, reader_user: 1, super_user: 2 };

/* Les zones protégées, et ce qu'elles exigent.

   « connecte » signifie : n'importe quel compte, quel que soit son rôle.
   Le préfixe se compare sur une frontière de chemin, pour que « /fiches-truc »
   ne soit pas confondu avec « /fiches ». */
const ZONES = [
  { prefixe: "/admin", exige: "super_user" },
  { prefixe: "/api/admin", exige: "super_user" },
  /* La liste de ce qui manque a un site est un renseignement : on ne la
     donne qu'a qui administre. */
  { prefixe: "/api/diagnostic", exige: "super_user" },
  { prefixe: "/fiches", exige: "reader_user" },
  /* Les PDF : administrateurs seulement (conception § 3 et § 11). Une page
     se lit la ou on la sert ; un fichier part, se copie et ne se rappelle
     pas. La lecture reste ouverte a reader_user, le fichier non. */
  { prefixe: "/pdf", exige: "super_user" },
  /* Les groupes : ouverts a tout compte depuis le 12 septembre (decision
     de l'auteur, supabase/2026_groupes_pour_tous.sql). Une seance qui cite
     une fiche mene un « user » a l'acces reserve, qui propose la demande. */
  { prefixe: "/groupes", exige: "connecte" },
  { prefixe: "/catalogue.json", exige: "reader_user" },
  { prefixe: "/api/groupes", exige: "connecte" },
  { prefixe: "/compte", exige: "connecte" },
  { prefixe: "/mes-demandes", exige: "connecte" },
  /* La demande d'acces : il faut un compte pour demander, pas plus. */
  { prefixe: "/demande-acces", exige: "connecte" },
  /* L'emploi du temps : des donnees personnelles, un compte suffit. */
  { prefixe: "/emploi", exige: "connecte" },
  /* Les contacts (lot C-12) : ses demandes et ses contacts, un compte suffit. */
  { prefixe: "/contacts", exige: "connecte" },
  { prefixe: "/api/contacts", exige: "connecte" },
  /* Les cles du chiffrement de bout en bout (lot H, session 2) : les
     siennes, celles d'un contact — un compte suffit, la base trie. */
  { prefixe: "/api/cles", exige: "connecte" },
  /* La memoire du quiz : la banque est sous /fiches (reader_user), la
     progression suit. La page /quiz elle-meme est publique : elle joue la
     demo a qui n'a pas l'acces. */
  { prefixe: "/api/quiz", exige: "reader_user" },
  { prefixe: "/api/emploi", exige: "connecte" },
  { prefixe: "/api/demande", exige: "connecte" },
  { prefixe: "/api/compte", exige: "connecte" },
  { prefixe: "/api/pseudo", exige: "connecte" },
  { prefixe: "/api/identites", exige: "connecte" },
  /* Les notifications (lot F) : ses abonnements, ses parametres — un
     compte suffit. Les deux routes sont nommees UNE PAR UNE, et non par le
     prefixe /api/push : /api/push/envoyer et /api/push/rappels sont
     appelees par la BASE (pg_net), sans cookie ; elles se gardent par un
     secret partage (PUSH_SECRET), pas par une session. */
  { prefixe: "/parametres", exige: "connecte" },
  { prefixe: "/api/push/abonnement", exige: "connecte" },
  { prefixe: "/api/push/parametres", exige: "connecte" },
  /* Les propositions (lot G) : tout compte peut proposer, motivé. */
  { prefixe: "/api/propositions", exige: "connecte" },
  /* Accepter la notice de données : un compte, rien de plus. */
  { prefixe: "/api/consentement", exige: "connecte" },
];

/* Les fiches de demonstration. Leur contenu est adosse a des sources
   publiques : plus rien ne justifie de les fermer, et elles donnent a voir ce
   qu'un compte ouvre. La liste est GENEREE par build_site.py depuis le drapeau
   « demo » de modules/<CODE>.json — la tenir a la main finirait par designer
   une fiche disparue, ou par laisser fermee une fiche qu'on croyait ouverte.

   Ce sont des chemins EXACTS, jamais des prefixes : une exception par prefixe
   ouvrirait tout un dossier, et c'est ainsi qu'on publie par megarde l'index
   de recherche ou le catalogue, qui decrivent le corpus entier. */
/* Cloudflare Pages sert « /x/y.html » à l'adresse « /x/y » et redirige l'une
   vers l'autre. Le chemin qui arrive ici porte donc la forme courte, alors
   que la liste générée porte la longue. On compare sur une forme commune :
   sans extension, sans barre finale. Sans cela, aucune fiche ouverte n'était
   reconnue — et le refus renvoyait vers la page de démonstration, elle-même
   raccourcie, ce qui donnait l'impression de tourner en rond. */
function formeCommune(chemin) {
  return chemin.replace(/\.html$/, "").replace(/\/+$/, "") || "/";
}

const DEMO = new Set(CHEMINS_DEMO.map(formeCommune));

const CONNEXION = "/connexion";

/* L'accueil de démonstration. build_site.py ne l'écrit que s'il existe au
   moins une fiche « demo » — c'est-à-dire exactement quand CHEMINS_DEMO n'est
   pas vide. Le test porte donc sur la liste générée, jamais sur une
   supposition. */
const DEMO_ACCUEIL = "/demo.html";
const REFUS = "/acces-reserve";


/** Ce chemin est-il une exception publique explicite ? */
function estDemo(chemin) {
  if (DEMO.has(formeCommune(chemin))) return true;
  /* Le chemin d'une requete arrive pourcent-code ; les noms de PDF portent des
     accents et des espaces. On compare donc aussi la forme decodee. Un codage
     invalide n'est pas une exception : c'est un refus. */
  try {
    return DEMO.has(formeCommune(decodeURIComponent(chemin)));
  } catch {
    return false;
  }
}


/** La zone qui gouverne ce chemin, ou null s'il est public. */
function zoneDe(chemin) {
  if (estDemo(chemin)) return null;      // ouvert nommement, avant tout prefixe
  for (const z of ZONES) {
    if (chemin === z.prefixe
        || chemin.startsWith(z.prefixe + "/")
        || chemin.startsWith(z.prefixe + ".")) {
      return z;
    }
  }
  return null;
}


/** Le rôle constaté suffit-il à ce que la zone exige ? */
function roleSuffit(role, exige) {
  if (exige === "connecte") return true;      // être connecté suffit
  const a = RANG[role];
  const b = RANG[exige];
  if (a === undefined || b === undefined) return false;   // inconnu = refus
  return a >= b;
}


/** Une requête de données, par opposition à une navigation ? */
function attendDuJson(requete) {
  const accept = requete.headers.get("Accept") || "";
  return accept.includes("application/json")
      || requete.headers.get("X-Requested-With") === "fetch";
}


function refusJson(message, code) {
  return new Response(JSON.stringify({ erreur: message }), {
    status: code,
    headers: { "content-type": "application/json", "Cache-Control": "no-store" },
  });
}


export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const chemin = url.pathname;

  /* Une requête de reconnaissance (OPTIONS) arrive sans cookie, par
     construction. La traiter comme les autres la ferait refuser, et la vraie
     requête n'aurait jamais lieu. Y répondre ne divulgue rien. */
  const origine = origineAutorisee(request, env);
  if (request.method === "OPTIONS" && origine) return reponsePrealable(origine);

  const zone = zoneDe(chemin);

  /* Chemin public : on sert, et on s'arrête là. C'est le cas de la très grande
     majorité des requêtes depuis que le site est ouvert. */
  if (!zone) {
    const reponse = await next();
    return avecCors(reponse, origine);
  }

  /* Zone protégée : il faut un jeton valide. sessionDe() le lit, et — si
     la personne a demandé à rester connectée — en obtient un neuf quand
     l'ancien est mort. « cookies » porte alors les deux cookies réécrits,
     à joindre à TOUTE réponse, refus compris ; « requete » est la requête à
     passer en aval, réécrite pour que le gestionnaire voie le jeton neuf. */
  const session = await sessionDe(request, env);
  const { verdict, jeton } = session;
  const cookies = session.cookies;

  if (!verdict.ok) {
    if (attendDuJson(request)) return avecCookies(refusJson("non authentifié", 401), cookies);

    /* Un visiteur sans compte qui vise les fiches a quelque chose à lire :
       on l'y emmène plutôt que de lui présenter un formulaire. C'est vrai de
       la carte du portail comme d'un lien partagé ou d'une adresse tapée —
       et cela supprime au passage une course : le script du portail ne
       bascule le lien de la carte vers la démonstration qu'après la réponse
       de /api/moi, et un clic plus rapide suivait l'ancien lien. */
    if (CHEMINS_DEMO.length && zone.prefixe === "/fiches") {
      return avecCookies(
        Response.redirect(new URL(DEMO_ACCUEIL, url.origin).toString(), 302), cookies);
    }

    /* On mémorise la destination pour y revenir après connexion. C'est ce qui
       fait qu'un lien partagé vers une fiche continue de fonctionner : on
       passe par la connexion, puis on atterrit au bon endroit. */
    const vers = new URL(CONNEXION, url.origin);
    vers.searchParams.set("suite", chemin + url.search);
    return avecCookies(Response.redirect(vers.toString(), 302), cookies);
  }

  /* --------------------------------------------------------------------
     Le rare cas où le jeton a tort
     --------------------------------------------------------------------
     Le rôle est inscrit dans le jeton au moment où Supabase le fabrique, ce
     qui rend le contrôle instantané : une signature à vérifier, aucun aller
     et retour vers la base. C'est ce qui permet de garder des centaines de
     fichiers sans les ralentir.

     Mais un jeton ne change plus une fois émis. Quelqu'un qu'on vient de
     promouvoir porte encore, pendant une heure, un jeton qui dit son ancien
     rôle. L'interface montrait la porte — elle lit la base, qui est à jour —
     et la porte refusait. Montrer une porte qui se ferme est pire que ne rien
     montrer du tout.

     La sortie tient en une observation : on ne consulte la base QUE si le
     jeton refuse. Le chemin normal, celui de toutes les requêtes qui
     aboutissent, ne coûte toujours rien. Seul le refus paie un aller et
     retour, et un refus est rare par construction.

     Ce qui reste vrai dans l'autre sens : un rôle RETIRÉ met jusqu'à une
     heure à fermer les portes, puisque le jeton continue d'accepter et qu'on
     ne va donc jamais interroger la base. C'est assumé : les écritures, elles,
     sont refusées immédiatement par les règles d'accès de la base, qui ne
     regardent pas le jeton. Une lecture de trop pendant une heure, contre un
     aller et retour sur chaque page servie : le compte est vite fait.
  -------------------------------------------------------------------- */
  let role = verdict.role;

  if (!roleSuffit(role, zone.exige)) {
    const profil = await lireProfilBase(jeton, env, verdict.id);
    if (profil && !profil.absent && profil.role) role = profil.role;
  }

  if (!roleSuffit(role, zone.exige)) {
    if (attendDuJson(request)) return avecCookies(refusJson("rôle insuffisant", 403), cookies);

    /* Le point qui compte : cette personne EST connectée. La renvoyer vers la
       page de connexion serait une impasse — elle se reconnecterait et
       retomberait ici. On lui explique à la place. */
    const vers = new URL(REFUS, url.origin);
    vers.searchParams.set("vers", chemin);
    vers.searchParams.set("exige", zone.exige);
    return avecCookies(Response.redirect(vers.toString(), 302), cookies);
  }

  /* Après une reconduction, le gestionnaire en aval reçoit la requête
     réécrite : /api/compte, /api/pseudo… lisent le cookie de la requête, et
     y trouveraient sinon le jeton mort. */
  const reponse = await next(session.requete);

  /* Ces pages sont personnelles : ni Cloudflare ni un cache intermédiaire ne
     doit les garder pour les resservir à quelqu'un d'autre. */
  const copie = new Response(reponse.body, reponse);
  copie.headers.set("Cache-Control", "private, no-store");
  return avecCors(avecCookies(copie, cookies), origine);
}
