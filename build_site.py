#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Générateur du site de consultation — BUT Informatique
======================================================

Deuxième sortie de la chaîne. Elle consomme EXACTEMENT les mêmes sources que
build.py :

    modules/<CODE>.json   identité du module + liste des parties
    content/<CODE>/*.html corps sémantique de chaque fiche

et produit un site statique dans site/ :

    site/index.html            accueil, par semestre
    site/s1/index.html         les modules du semestre 1
    site/s1/R104/index.html    les fiches du module
    site/s1/R104/01.html       une fiche : contenu + télécharger / imprimer / partager
    site/pdf/…                 les PDF A5, et leur version livret
    site/catalogue.json        contrat de lecture pour un outil tiers
    site/assets/…              CSS, JS, index de recherche

Aucun fichier de content/ n'est modifié : les adaptations pour l'écran
(identifiants de section, tableaux défilants, renvois cliquables) sont faites
ici, à la volée. Si une fiche s'affiche mal, on corrige assets/site.css ou ce
script — jamais le contenu.

Usage :  python build_site.py            (tout)
         python build_site.py --sans-pdf (sans recopier ni imposer les PDF,
                                          beaucoup plus rapide en mise au point)
"""

import colorsys
import html
import json
import re
import shutil
import sys
from pathlib import Path

import carte as carte_projet          # la structure de la carte, extraite du code

from pypdf import PdfReader

import livret

# Les blocs sortis de ce fichier (conception § 45)
from ossature import ICONES, _H2, _texte_nu, ancre_section, date_fr, e, empreinte
from zones import inscrire_zones, inventaire_zones, poser_drapeaux, zone
from documents import (DOCS_AVERTISSEMENTS, JOURNAL, ancres_conception, docs_disponibles, est_archive,
                       est_partie_journal, md_vers_html, resume_doc)
from carte_site import carte_du_site

# --------------------------------------------------------------------------
# Réglages du site
# --------------------------------------------------------------------------

ROOT    = Path(__file__).parent
ASSETS  = ROOT / "assets"
MODULES = ROOT / "modules"
CONTENT = ROOT / "content"
SITE    = ROOT / "site"

# D'où viennent les PDF déjà produits par build.py
SORTIE_PDF = ROOT.parent / "Cours Fiches"

# Les fiches ne sont plus à la racine : la racine, c'est le portail, qui
# présente tous les outils de la promo. Les fiches en sont un parmi d'autres.
# Un seul endroit à changer si ce choix évolue.
PREFIXE_FICHES = "fiches"

TITRE       = "Fiches BUT Informatique — IUT d'Orsay"
SOUS_TITRE  = "Université Paris-Saclay"
SEMESTRE_EN_COURS = 1
SEMESTRES   = [1, 2, 3, 4, 5, 6]

ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
         "XI", "XII", "XIII", "XIV", "XV"]

# Réglages de la porte d'entrée, lus dans auth.config.json et partagés par
# toutes les fonctions de rendu. Tant que supabase_url est vide, le site est
# généré sans connexion : c'est l'état par défaut, utilisable en local.
AUTH = {}

# Empreinte des ressources, calculée à la génération et collée à leur adresse.
# Voir empreinte() : c'est ce qui fait qu'une mise à jour arrive vraiment
# jusqu'au navigateur.
VERSION = "0"

# Le registre des outils du portail, lu dans apps.json.
APPS = {}

# Les deux journaux. changelog.json dit ce que le SITE sait faire de neuf ;
# changelog-fiches.json dit ce que le CORPUS a gagne — une fiche, une section,
# des questions. Deux ecritures independantes (l'une suit une livraison de
# code, l'autre une integration de sources), deux fichiers, mais une seule
# page a deux onglets et une seule fenetre a l'arrivee : le lecteur n'a qu'un
# endroit a connaitre.
CHANGELOG = {}
CHANGELOG_FICHES = {}
# Le troisieme journal, celui de l'administration (chantier n° 6) : ce qui
# change pour qui administre, et ce qu'il doit faire. Il n'entre JAMAIS dans
# nouveautes.json ni dans une page publique — decrire une faille corrigee en
# public, c'est la publier. Il n'a qu'une page, sous /admin, et
# version_nouveautes() ne le lit pas : la fenetre des eleves l'ignore.
CHANGELOG_ADMIN = {}


def charger_auth() -> dict:
    """Lit auth.config.json s'il existe. Absent ou vide = pas d'authentification."""
    fichier = ROOT / "auth.config.json"
    if not fichier.exists():
        return {}
    cfg = json.loads(fichier.read_text(encoding="utf-8"))
    # Les clés commençant par « _ » sont des commentaires à l'usage du lecteur.
    return {k: v for k, v in cfg.items() if not k.startswith("_")}


def auth_active() -> bool:
    """Le site a-t-il des comptes ? Oui dès qu'une adresse Supabase est configurée."""
    return bool(AUTH.get("supabase_url"))


def charger_journal(nom: str) -> dict:
    """Lit un journal des changements, version par version.

    Absent, pas de journal : ni page, ni fenetre a l'arrivee. Le site doit
    rester constructible sans lui. La forme est controlee par
    verifier_corpus.py (question 10), pas ici.
    """
    fichier = ROOT / nom
    if not fichier.exists():
        return {"versions": []}
    cfg = json.loads(fichier.read_text(encoding="utf-8"))
    return {k: v for k, v in cfg.items() if not k.startswith("_")}


def version_nouveautes() -> str:
    """La version courante du journal : la date de sa premiere entree.

    Posee sur <html data-nouveautes> de chaque page : c'est elle que la
    fenetre de l'arrivee compare a la derniere version vue sur l'appareil.
    """
    dates = [str((j.get("versions") or [{}])[0].get("date", ""))
             for j in (CHANGELOG, CHANGELOG_FICHES) if j.get("versions")]
    return max(dates) if dates else ""


def charger_apps() -> dict:
    """Lit apps.json : la liste des outils présentés sur le portail.

    Absent, on se rabat sur les seules fiches. Le site doit rester
    constructible même si ce fichier n'existe pas encore.
    """
    fichier = ROOT / "apps.json"
    if not fichier.exists():
        return {"apps": [{"id": "fiches", "nom": "Fiches de révision",
                          "resume": "", "url": PREFIXE_FICHES + "/index.html",
                          "icone": "fiches", "actif": True}]}
    cfg = json.loads(fichier.read_text(encoding="utf-8"))
    return {k: v for k, v in cfg.items() if not k.startswith("_")}


def publier_fiches() -> bool:
    return bool(APPS.get("publier_fiches", True))


def apps_actives() -> list:
    """Les applications du portail que la configuration allume."""
    return [a for a in APPS.get("apps", []) if a.get("actif")]


def sources_index() -> list:
    """Les outils qui publient un index de ressources rattachées aux fiches.

    C'est ce qui permet à une fiche d'afficher « à travailler avec » : chaque
    outil publie ce qu'il a, tagué par module et par numéro de fiche, et
    chacun lit l'index de l'autre. Voir docs/integration-outils.md.
    """
    return [{"id": a["id"], "nom": a["nom"], "index": a["index"]}
            for a in apps_actives() if a.get("index")]


# --------------------------------------------------------------------------
# Couleurs
# --------------------------------------------------------------------------

def hex_vers_hsl(couleur: str):
    """Une couleur « #rrggbb » décomposée en teinte, saturation, luminosité."""
    r, g, b = (int(couleur[i:i + 2], 16) / 255 for i in (1, 3, 5))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return h, s, l


def hsl_vers_hex(h: float, s: float, l: float) -> str:
    """Teinte, saturation, luminosité recomposées en couleur « #rrggbb »."""
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


def variantes_sombres(accent: str):
    """Décline un accent pensé pour le papier blanc en version fond sombre.

    Les accents des modules sont très foncés (violet #3d1152, bordeaux
    #6d1220…) : parfaits sur du papier, illisibles sur un fond sombre. On
    conserve la teinte, on remonte la luminosité, et on fabrique un fond
    d'encadré très sombre de la même teinte.
    """
    h, s, _ = hex_vers_hsl(accent)
    s = max(s, 0.42)
    return (
        hsl_vers_hex(h, min(s, 0.62), 0.66),   # --accent
        hsl_vers_hex(h, min(s, 0.20), 0.15),   # --accent-soft
        hsl_vers_hex(h, min(s, 0.40), 0.40),   # --accent-line
    )


def regle(selecteurs: list, accent: str, doux: str, filet: str,
          indent: str = "") -> str:
    """Une règle CSS qui pose les trois couleurs d'accent d'un module sur ses sélecteurs."""
    return ("%s%s {\n%s  --accent:      %s;\n%s  --accent-soft: %s;\n"
            "%s  --accent-line: %s;\n%s}"
            % (indent, (",\n" + indent).join(selecteurs),
               indent, accent, indent, doux, indent, filet, indent))


def bloc_couleurs(modules: list) -> str:
    """Les règles CSS d'accent, une par module, pour les deux thèmes.

    L'attribut data-module se trouve à deux endroits : sur <html> pour les
    pages d'un module, et sur chaque carte de l'accueil. Les sélecteurs
    couvrent donc les deux cas (élément descendant, ou racine elle-même).
    """
    clair, sombre_systeme, sombre_force = [], [], []

    # Les apps aussi : chacune a SA couleur (apps.json, clé accent), portée
    # par data-app — sur <html> dans ses pages, sur sa carte au portail. Un
    # outil qui empruntait la couleur d'un module (le quiz en R106, les
    # groupes en R108…) changeait d'identité d'une page à l'autre.
    for app in APPS.get("apps", []):
        if not app.get("accent"):
            continue
        h, s, _ = hex_vers_hsl(app["accent"])
        code = app["id"]
        clair.append(regle(['[data-app="%s"]' % code], app["accent"],
                           hsl_vers_hex(h, min(max(s, 0.3), 0.5), 0.94),
                           hsl_vers_hex(h, min(max(s, 0.3), 0.5), 0.62)))
        a, doux, filet = variantes_sombres(app["accent"])
        sombre_systeme.append(regle(
            ['  :root:not([data-theme="light"]) [data-app="%s"]' % code,
             ':root:not([data-theme="light"])[data-app="%s"]' % code],
            a, doux, filet, indent="  ").lstrip())
        sombre_force.append(regle(
            [':root[data-theme="dark"] [data-app="%s"]' % code,
             ':root[data-theme="dark"][data-app="%s"]' % code],
            a, doux, filet))

    for cfg in modules:
        code = cfg["code"]
        clair.append(regle(['[data-module="%s"]' % code], cfg["accent"],
                           cfg["accent_soft"], cfg["accent_line"]))

        a, doux, filet = variantes_sombres(cfg["accent"])
        sombre_systeme.append(regle(
            ['  :root:not([data-theme="light"]) [data-module="%s"]' % code,
             ':root:not([data-theme="light"])[data-module="%s"]' % code],
            a, doux, filet, indent="  ").lstrip())
        sombre_force.append(regle(
            [':root[data-theme="dark"] [data-module="%s"]' % code,
             ':root[data-theme="dark"][data-module="%s"]' % code],
            a, doux, filet))

    return (
        "\n\n/* ==========================================================\n"
        "   Couleurs des modules — bloc GÉNÉRÉ par build_site.py.\n"
        "   Ne pas modifier à la main : les valeurs viennent de\n"
        "   modules/<CODE>.json (clé accent). Les variantes sombres sont\n"
        "   recalculées à partir de la teinte : un accent conçu pour le\n"
        "   papier blanc est illisible sur fond sombre.\n"
        "   ========================================================== */\n\n"
        + "\n\n".join(clair)
        + "\n\n@media (prefers-color-scheme: dark) {\n  "
        + "\n\n  ".join(sombre_systeme)
        + "\n}\n\n"
        + "\n\n".join(sombre_force)
        + "\n"
    )


# --------------------------------------------------------------------------
# Lecture des sources
# --------------------------------------------------------------------------

def slug(texte: str) -> str:
    """Reprend exactement la règle de build.py, pour retrouver les PDF."""
    import unicodedata
    t = unicodedata.normalize("NFKD", texte)
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"[^A-Za-z0-9]+", "_", t)
    return t.strip("_")


def charger_modules() -> list:
    """Les modules du corpus, chaque fiche complétée du nom, du chemin et du nombre de pages de son PDF."""
    modules = []
    for f in sorted(MODULES.glob("*.json")):
        cfg = json.loads(f.read_text(encoding="utf-8"))
        for partie in cfg["parties"]:
            partie["nom_pdf"] = "Fiche_%s_%02d_%s.pdf" % (
                cfg["code"], partie["numero"], slug(partie["titre"]))
            chemin = SORTIE_PDF / cfg.get("dossier_sortie", "") / partie["nom_pdf"]
            partie["chemin_pdf"] = chemin
            partie["pages"] = len(PdfReader(str(chemin)).pages) if chemin.exists() else None
        modules.append(cfg)
    return modules


# --------------------------------------------------------------------------
# Adaptation du contenu pour l'écran
# --------------------------------------------------------------------------

_TABLE = re.compile(r"(<table>.*?</table>)", re.DOTALL)
_RENVOI_FICHE = re.compile(r"(fiche\s+)(\d{2})")


def adapter_contenu(corps: str) -> tuple:
    """Prépare un fragment pour l'écran.

    Renvoie (html, [(rang, roman, titre, cle)]) : « rang » est l'ancre
    historique (s1, s2…), « cle » le slug publié dans l'index.

    Trois adaptations, toutes réversibles et faites ici plutôt que dans le
    fichier source :
      - chaque <h2> reçoit deux identifiants, pour que le sommaire y renvoie et
        pour qu'un outil voisin puisse viser la section par son nom ;
      - chaque tableau est enveloppé dans un conteneur qui défile seul, sinon
        un tableau large déforme la page sur téléphone ;
      - « fiche 02 » dans un renvoi devient un lien vers la fiche voisine.
    """
    sections = []

    def marquer(m):
        roman, titre = m.group(1), m.group(2)
        # Le texte du titre, et non son HTML : « 2&gt;&amp;1 » doit donner
        # l'ancre « 2-1 », pas « 2-gt-amp-1 » — et le sommaire de la page,
        # qui repasse par e(), affichait sinon « &amp;lt; » en toutes lettres.
        propre = html.unescape(re.sub(r"<[^>]+>", "", titre)).strip()
        rang = "s%d" % (len(sections) + 1)
        # Deux identifiants sur le meme titre, et c'est voulu.
        #   - le slug (« organisation-physique-de-la-ram ») porte l'id du <h2> :
        #     c'est lui que publie l'index, pour qu'un autre outil vise une
        #     section par son nom et non par son rang, qui bouge des qu'on
        #     insere une partie ;
        #   - « s3 », historique, survit dans une ancre vide juste avant, pour
        #     que les liens deja partages continuent d'aboutir.
        cle = ancre_section(propre) or rang
        sections.append((rang, roman, propre, cle))
        return ('<span class="ancre-heritee" id="%s"></span>'
                '<h2 id="%s"><span class="rom">%s.</span>%s</h2>'
                % (rang, cle, roman, titre))

    corps = _H2.sub(marquer, corps)
    corps = _TABLE.sub(r'<div class="table-scroll">\1</div>', corps)

    # Les renvois ne pointent que vers des fiches du même module.
    def lier(m):
        return '%s<a href="%s.html">%s</a>' % (m.group(1), m.group(2), m.group(2))

    def dans_renvoi(m):
        return '<p class="renvoi">%s</p>' % _RENVOI_FICHE.sub(lier, m.group(1))

    corps = re.sub(r'<p class="renvoi">(.*?)</p>', dans_renvoi, corps, flags=re.DOTALL)
    return corps, sections


# --------------------------------------------------------------------------
# Gabarits de page
# --------------------------------------------------------------------------

def page(titre_onglet: str, racine: str, corps: str, module: str = "",
         fil: str = "", classe_body: str = "", fiche: int = 0,
         recherche: bool = False, app: str = "",
         chiffrement: bool = False, cible: str = "", cible_titre: str = "",
         carte: bool = False) -> str:
    """Ossature commune : en-tête collante, recherche, thème, pied de page.

    `racine` est le chemin relatif vers la racine du site ("", "../",
    "../../"). Tout est relatif : le site fonctionne aussi bien ouvert par
    double-clic que servi depuis un sous-dossier.

    `recherche` n'est vrai que dans l'espace des fiches. L'index de recherche
    contient tous les titres et tous les intitulés de section : le charger sur
    une page publique reviendrait à publier la table des matières de ce qu'on
    protège. Il vit donc sous /fiches/, avec le reste.

    `chiffrement` charge assets/chiffrement.js (le bout en bout des messages
    privés, lot H) — sur la messagerie et les paramètres seulement : 40 Ko
    dont la liste de mots, inutiles ailleurs. Il est déclaré AVANT site.js,
    tous deux « defer » : l'ordre est garanti, window.Chiffrement existe
    quand site.js s'exécute.

    `carte` charge assets/carte.js (le graphe et le radial de la carte du
    projet) — sur cette seule page, la seule qui porte un arbre à dessiner.
    Même règle d'ordre : déclaré avant site.js, window.CarteVues existe quand
    site.js branche les filtres dessus.

    `cible` (lot L) est la racine des propositions de cette page : « /quiz/ »,
    « S1-R104-06 », « S1-R104 ». Elle suffit à tout déclencher — les blocs
    marqués par zone() reçoivent leur ⚑, les zones entrent dans l'inventaire,
    et la fenêtre « Proposer » est posée en fin de corps. Une page sans cible
    n'offre rien : c'est le cas de l'administration et de la connexion, où
    proposer n'aurait pas de sens.
    """
    # Le ⚑ de chaque zone, la fenêtre, l'inventaire : tout part d'ici, pour
    # qu'aucune page n'ait à y penser deux fois.
    attr_cible = ""
    if cible:
        corps, zones = poser_drapeaux(corps, cible)
        corps += dialogue_proposition()
        attr_cible = ' data-cible="%s"' % e(cible)
        # Le contenu des fiches est réservé (reader_user) : les intitulés de
        # ses sections ne peuvent pas aller dans l'inventaire public — c'est
        # le raisonnement de `recherche` ci-dessus, appliqué aux zones.
        inscrire_zones(cible, cible_titre or titre_onglet, zones,
                       prive=not cible.startswith("/") or cible.startswith("/fiches"))
    attr_module = ' data-module="%s"' % e(module) if module else ""
    # Une page d'app porte la couleur de son app, pas celle d'un module.
    if app:
        attr_module = ' data-app="%s"' % e(app)
    # Le module et le numéro de fiche sont posés sur <html> pour que le script
    # sache de quoi parle la page — c'est la clé qui sert à retrouver les
    # ressources des autres outils.
    attr_fiche = ' data-fiche="%d"' % fiche if fiche else ""

    script_recherche = ('<script src="%sfiches/recherche.js?v=%s" defer></script>\n'
                        % (e(racine), VERSION)) if recherche else ""
    if chiffrement:
        script_recherche += ('<script src="%sassets/chiffrement.js?v=%s" defer></script>\n'
                             % (e(racine), VERSION))
    if carte:
        script_recherche += ('<script src="%sassets/carte.js?v=%s" defer></script>\n'
                             % (e(racine), VERSION))

    boite_recherche = """
      <div class="recherche">
        <input type="search" id="q" placeholder="Rechercher une fiche…"
               autocomplete="off" aria-label="Rechercher une fiche">
        <div class="resultats" id="resultats" hidden></div>
      </div>""" if recherche else ""

    # Le bouton de déconnexion n'a de sens que s'il y a une connexion.
    deconnexion = ""
    if auth_active():
        deconnexion = (
            '<button class="btn btn-icone" id="deconnexion" type="button"'
            ' title="Se déconnecter" aria-label="Se déconnecter">'
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"'
            ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/>'
            '<path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/></svg></button>')

    return """<!DOCTYPE html>
<html lang="fr"%s%s%s data-racine="%s" data-version="%s" data-nouveautes="%s">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>%s</title>
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
<link rel="stylesheet" href="%sassets/site.css?v=%s">
%s<script src="%sassets/config.js?v=%s"></script>
<script src="%sassets/apps.js?v=%s" defer></script>
<script src="%sassets/site.js?v=%s" defer></script>
</head>
<body%s>

<header class="barre">
  <div class="barre-int">
    <button class="btn btn-icone btn-retour" id="retour" type="button"
            title="Page précédente" aria-label="Page précédente" hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button>
    <a class="marque" href="%sindex.html">BUT Info <span>· IUT d'Orsay</span></a>
    <nav class="fil">%s</nav>
    <div class="barre-fin">%s
      <a class="btn btn-icone btn-messages" id="lien-messages" data-connecte-cache
         href="/groupes/" title="Messages" aria-label="Messages">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3 9 9 0 0 1-3.8-.8L3.5 20.5l1.6-4.6A8.2 8.2 0 0 1 4 11.5 8.4 8.4 0 0 1 12.5 3.2a8.4 8.4 0 0 1 8.5 8.3z"/></svg>
        <span class="nl-pastille nl-pastille-coin" id="messages-pastille" hidden></span></a>
      <a class="btn btn-icone" id="lien-admin" data-role-cache="super_user"
         href="/admin.html" title="Administration" aria-label="Administration">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2.5 4 6v5.5c0 4.6 3.2 8.4 8 10 4.8-1.6 8-5.4 8-10V6z"/>
          <path d="m9 12 2 2 4-4"/></svg></a>
      <a class="btn btn-accent btn-compte" id="lien-compte"
         href="/connexion">Se connecter</a>
      <button class="btn btn-icone" id="theme" type="button"
              title="Basculer clair / sombre" aria-label="Basculer clair / sombre">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/>
          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/>
        </svg>
      </button>
      %s
    </div>
  </div>
</header>

%s

<footer class="pied-site">
  <div class="enveloppe">
    Outils de révision de la promo. Site personnel, sans lien officiel avec
    l'IUT d'Orsay ni avec l'Université Paris-Saclay.
    <span class="pied-liens">
      <a href="%sdonnees.html">Données personnelles</a>
      <a href="%scompte.html">Mon compte</a>
      <a href="%sparametres.html">Paramètres</a>
      <a href="%snouveautes.html">Nouveautés</a>
    </span>
  </div>
</footer>

<div class="bulle" id="bulle" hidden></div>
</body>
</html>
""" % (attr_module, attr_fiche, attr_cible, e(racine),
       # data-version : l'empreinte des ressources, pour que le script
       # demande recherche-contenu.js avec la meme (lot I) ; data-nouveautes :
       # la version du journal des changements (lot J).
       VERSION, e(version_nouveautes()), e(titre_onglet),
       e(racine), VERSION, script_recherche,
       # config.js (adresse et cle publique de Supabase) : la page d'un
       # groupe en a besoin pour la connexion directe. Il n'etait servi que
       # sur la page de connexion — d'ou un direct silencieusement absent,
       # le 13 septembre. Sur toutes les pages, c'est 1 Ko.
       e(racine), VERSION, e(racine), VERSION,
       e(racine), VERSION,
       (' class="%s"' % classe_body) if classe_body else "",
       # Le corps vient avant le pied de page dans le gabarit : les quatre
       # dernieres racines sont celles des liens du pied.
       e(racine), fil, boite_recherche, deconnexion, corps, e(racine), e(racine), e(racine), e(racine))


def fil_selon_acces(demo: list, complet: list) -> str:
    """Deux fils pour une même page : celui d'un visiteur, celui d'un compte.

    Une fiche marquée « demo » est lisible sans compte, et son fil ne peut
    donc pas remonter l'arborescence réelle — chacun de ses échelons
    (Fiches, Semestre, module) est fermé à un visiteur. Mais pour qui porte
    l'accès étendu, ces échelons sont ouverts, et lui montrer « Fiches
    (démonstration) » l'envoie sur une page qui n'est pas la sienne — c'est
    le défaut que l'auteur a vu le 23 septembre.

    Le site étant statique, la page ne peut pas savoir à la génération qui la
    lira : elle porte donc LES DEUX fils, et le script commun garde celui qui
    correspond au rang (une seule question à /api/moi, déjà posée). Sans
    script, ou hors ligne, c'est le fil de la démonstration qui reste : il
    mène à une page ouverte à tout le monde, donc jamais à un refus.
    """
    return ('<span data-fil-demo>%s</span>'
            '<span data-role-cache="reader_user">%s</span>'
            % (fil_ariane(demo), fil_ariane(complet)))


def fil_ariane(elements: list) -> str:
    """[(libellé, href ou None)] — le dernier élément n'est pas un lien."""
    bouts = []
    for i, (libelle, href) in enumerate(elements):
        if i:
            bouts.append('<span class="sep">›</span>')
        if href:
            bouts.append('<a href="%s">%s</a>' % (e(href), e(libelle)))
        else:
            bouts.append("<strong>%s</strong>" % e(libelle))
    return "".join(bouts)


ICONES_APPS = {
    'quiz': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.6v.4"/><path d="M12 17h.01"/></svg>',
    'groupes': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><circle cx="17" cy="9.5" r="2.4"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M14.5 18.5a4 4 0 0 1 6.5-2.6"/></svg>',
    'fiches': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H11v18H5.5A1.5 1.5 0 0 1 4 19.5z"/><path d="M20 4.5A1.5 1.5 0 0 0 18.5 3H13v18h5.5a1.5 1.5 0 0 0 1.5-1.5z"/></svg>',
    'agenda': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M8 14h3v3H8z"/></svg>',
    'emploi': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M9 9v12M15 9v12"/></svg>',
    'exos': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h5M4 12h5M4 18h5"/><path d="m13 5 2 2 4-4"/><path d="M13 12h7M13 18h7"/></svg>',
    'ressources': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    'outil': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5.5a4 4 0 0 0 5 5L21 12l-9 9-4.5-1.5L6 15l9-9z"/><circle cx="8" cy="16" r="1"/></svg>',
}


# --------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------

FLECHES = {"vers": "→", "depuis": "←", "double": "⇄"}


def fiches_demo(modules: list) -> list:
    """Les fiches ouvertes sans compte : (cfg, partie), dans l'ordre du corpus.

    Une seule fonction pour tout le monde — la page de démonstration, le fil
    d'Ariane, les chemins ouverts du middleware. Trois listes tenues
    séparément finiraient par ne plus désigner les mêmes fiches, et celle qui
    se tromperait enverrait un visiteur sur un refus.
    """
    trouvees = []
    for cfg in modules:
        for part in cfg["parties"]:
            if part.get("demo"):
                trouvees.append((cfg, part))
    return trouvees


def page_demo(modules: list) -> str:
    """L'accueil des fiches, version sans compte.

    Bâtie comme l'accueil réel, avec les mêmes cartes : ce qu'on montre doit
    ressembler à ce qu'on obtient, sinon la démonstration ne démontre rien.
    Elle ne liste que les fiches ouvertes, et dit franchement ce qui manque.
    """
    cartes = []
    for cfg, part in fiches_demo(modules):
        sem = cfg.get("semestre", 1)
        cartes.append(
            '<a class="carte fiche-item" href="%s/s%d/%s/%02d.html">'
            '<div class="f-code">%s · Partie %02d</div>'
            '<div class="f-titre">%s</div>'
            '<div class="f-st">%s</div>'
            '<div class="f-meta">%d sections</div></a>'
            % (PREFIXE_FICHES, sem, cfg["code"], part["numero"],
               e(cfg["code"]), part["numero"], e(part["titre"]),
               e(part.get("sous_titre", "")), len(part["sommaire"])))

    corps = """
<main class="enveloppe">
  <div class="entete">
    <div class="e-code">Fiches · démonstration</div>
    <h1>Deux fiches, en entier</h1>
    <p class="e-st">Elles se lisent sans compte, et sans rien installer. Ce
       sont des fiches complètes, pas des extraits : c'est exactement ce à
       quoi ressemblent les %d autres.</p>
  </div>

  <div class="grille grille-fiches">%s</div>

  <h2 class="section">Et le reste ?</h2>
  <p>Le corpus complet compte <strong>%d fiches</strong> sur %d modules, avec
     les PDF à imprimer, la recherche dans le texte et le catalogue. Il demande
     un compte, puis un accès accordé à la main — les fiches restent réservées
     à la promo.</p>
  <p><a class="btn btn-accent" href="/connexion" id="demo-creer">Créer un compte</a>
     <a class="btn btn-accent" href="/demande-acces.html" id="demo-demander" hidden>Demander l'accès</a>
     <a class="btn" href="/">Retour aux outils</a></p>
</main>
""" % (sum(len(c["parties"]) for c in modules) - len(cartes),
       "".join(cartes),
       sum(len(c["parties"]) for c in modules), len(modules))

    return page("Fiches — démonstration", "", corps,
                cible="/demo.html", cible_titre="Les fiches de démonstration",
                fil=fil_ariane([("Accueil", "/"),
                                ("Fiches (démonstration)", None)]))


def page_portail(modules: list) -> str:
    """La page d'accueil du portail : tous les outils, sans hierarchie.

    Deux regles de conception.

    D'abord, rien n'indique qui a ecrit quoi : pour la personne qui consulte,
    c'est un seul service. La separation technique - chacun heberge le sien -
    n'a aucune raison d'etre visible ici.

    Ensuite, on montre plutot qu'on explique. Une carte porte un pictogramme,
    un nom, une indication de trois mots, et des fleches vers les outils
    auxquels elle est reliee. Pas de phrase : ce qui se comprend d'un coup
    d'oeil n'a pas a etre lu.
    """
    # Dans les pastilles de lien, la place est comptee : on prend le nom
    # court quand il existe.
    noms = {a["id"]: a.get("nom_court") or a["nom"]
            for a in APPS.get("apps", [])}
    total_f = sum(len(c["parties"]) for c in modules) if publier_fiches() else 0

    cartes = []
    for a in APPS.get("apps", []):
        icone = ICONES_APPS.get(a.get("icone", "outil"), ICONES_APPS["outil"])
        interne = not a.get("url", "").startswith("http")

        # Les fiches comptent ce qu'elles contiennent vraiment ; les autres
        # portent l'indication ecrite dans apps.json.
        meta = a.get("meta", "")
        if a["id"] == "fiches":
            meta = "%d fiches · %d modules" % (total_f, len(modules))

        # Une fleche dit le rapport entre deux outils mieux qu'une phrase.
        liens = "".join(
            '<span class="a-lien"><span class="fl">%s</span>%s</span>'
            % (FLECHES.get(l.get("sens", "vers"), FLECHES["vers"]),
               e(noms.get(l.get("vers"), "")))
            for l in a.get("liens", []) if l.get("vers") in noms)

        # Deux pastilles, deux questions differentes. « bientot » dit que
        # l'outil n'existe pas encore ; « compte requis » dit qu'il existe mais
        # qu'il faut entrer pour le voir. Melanger les deux laisserait croire
        # qu'un outil disponible est encore en chantier.
        etiquettes = ""
        if not a.get("actif"):
            etiquettes += ' <span class="a-bientot">bientôt</span>'
        if a.get("role"):
            # Le texte par defaut suppose un visiteur non connecte : c'est le
            # cas le plus frequent, et c'est celui ou l'invitation sert le
            # plus. Le script le corrige des qu'il sait a qui il parle.
            etiquettes += (' <span class="a-acces" data-acces>compte requis'
                           '</span>')

        dedans = ('<div class="a-ico">%s</div>'
                  '<div class="a-nom">%s%s</div>'
                  '<div class="a-meta">%s</div>'
                  '<div class="a-liens">%s</div>'
                  % (icone, e(a["nom"]), etiquettes, e(meta), liens))

        # Le role exige voyage sur la carte. Il ne sert plus a la CACHER : une
        # carte absente n'apprend rien, et le portail d'un visiteur non
        # connecte paraissait vide alors qu'il y a de quoi le convaincre.
        # Le script s'en sert pour ajuster la pastille d'acces.
        #
        # Repetons-le : c'est de l'AFFICHAGE, pas de la protection. La zone est
        # gardee par le middleware, et cliquer une carte a laquelle on n'a pas
        # droit mene a une page qui l'explique.
        attr_role = (' data-role="%s"' % e(a["role"])) if a.get("role") else ""

        # L'outil a-t-il de quoi se montrer sans compte ? Aujourd'hui les
        # fiches, demain un autre. L'attribut porte l'adresse plutôt qu'un
        # simple « oui » : le script n'a alors rien à deviner, et aucune
        # adresse n'est écrite deux fois.
        attr_demo = ""
        if a.get("id") == "fiches" and fiches_demo(modules):
            attr_demo = ' data-demo="demo.html"'


        attr_app = ' data-app="%s"' % e(a["id"]) if a.get("accent") else ""
        if a.get("actif"):
            cartes.append('<a class="carte app"%s%s%s href="%s"%s>%s</a>'
                          % (attr_app, attr_role, attr_demo, e(a["url"]),
                             "" if interne else ' rel="noopener"', dedans))
        else:
            # Le role voyage aussi sur une carte inactive : sans lui, sa
            # pastille resterait figee sur « compte requis » meme pour
            # quelqu'un qui a deja l'acces, et annoncerait un obstacle qui
            # n'existe pas.
            cartes.append('<span class="carte app inactive"%s%s>%s</span>'
                          % (attr_app, attr_role, dedans))

    corps = """
<main class="enveloppe">
  <section class="hero hero-portail"%s>
    <h1>%s</h1>
    <p>%s</p>
  </section>

  <div class="bandeau-compte" data-anonyme%s>
    <div>
      <strong>Crée un compte pour voir ce qui est disponible.</strong>
      <span>Adresse personnelle, ou Google, GitHub, Discord. Rien à installer,
            et tu choisis simplement un pseudo.</span>
    </div>
    <a class="btn btn-accent btn-large" href="/connexion">Créer un compte</a>
  </div>

  <!-- U3 : une réponse à une demande ou à une proposition. Cachée par
       défaut, et posée par le script : on n'annonce pas « rien de neuf ». -->
  <a class="bandeau-suivi" id="portail-suivi" href="/mes-demandes.html" hidden>
    <span class="nl-pastille" id="portail-suivi-nombre"></span>
    <span id="portail-suivi-texte"></span>
  </a>

  <div class="grille grille-apps"%s>%s</div>

  <p class="c-note portail-proposer">Un problème, une idée ?
    <button class="btn btn-petit" type="button" data-proposer="technique" data-cible="/"
            data-cible-titre="le site">%s Proposer</button>
    <span data-anonyme>— avec un compte.</span></p>
</main>
""" % (zone("accueil", "L'en-tête du portail"),
       e(APPS.get("titre", "Les outils de la promo")),
       e(APPS.get("sous_titre", SOUS_TITRE)),
       zone("invitation", "L'invitation à créer un compte"),
       zone("outils", "La liste des outils"), "".join(cartes),
       ICONES["proposer"])

    return page(APPS.get("titre", "Les outils de la promo"), "", corps,
                classe_body="portail",
                fil=fil_ariane([("Accueil", None)]),
                cible="/", cible_titre="Le portail")


def page_accueil(modules: list) -> str:
    """L'accueil des fiches : les modules du semestre en cours, puis les autres semestres."""
    par_semestre = {}
    for cfg in modules:
        par_semestre.setdefault(cfg.get("semestre", 1), []).append(cfg)

    cartes_courant = "".join(
        '<a class="carte" data-module="%s" href="s%d/%s/index.html">'
        '<div class="c-code">%s</div><div class="c-nom">%s</div>'
        '<div class="c-meta">%d fiche%s · %d pages</div></a>'
        % (cfg["code"], cfg.get("semestre", 1), cfg["code"], cfg["code"],
           e(cfg["intitule"]), len(cfg["parties"]),
           "s" if len(cfg["parties"]) > 1 else "",
           sum(p["pages"] or 0 for p in cfg["parties"]))
        for cfg in par_semestre.get(SEMESTRE_EN_COURS, []))

    autres = []
    for s in SEMESTRES:
        mods = par_semestre.get(s, [])
        if s == SEMESTRE_EN_COURS:
            continue
        if mods:
            autres.append('<a class="carte" href="s%d/index.html">'
                          '<div class="c-code">Semestre %d</div>'
                          '<div class="c-meta">%d module(s)</div></a>' % (s, s, len(mods)))
        else:
            autres.append('<span class="carte inactive">'
                          '<div class="c-code">Semestre %d</div>'
                          '<div class="c-meta">à venir</div></span>' % s)

    total_f = sum(len(c["parties"]) for c in modules)
    total_p = sum(p["pages"] or 0 for c in modules for p in c["parties"])

    corps = """
<main class="enveloppe">
  <section class="hero">
    <h1>%s</h1>
    <p>%s · %d fiches · %d pages A5</p>
  </section>

  <h2 class="section">Semestre %d — en cours</h2>
  <div class="grille">%s</div>

  <h2 class="section">Les autres semestres</h2>
  <div class="grille">%s</div>
</main>
""" % (e(TITRE), e(SOUS_TITRE), total_f, total_p,
       SEMESTRE_EN_COURS, cartes_courant, "".join(autres))

    return page(TITRE, "../", corps, recherche=True,
                cible="/fiches/", cible_titre="L'accueil des fiches",
                fil=fil_ariane([("Accueil", "../index.html"), ("Fiches", None)]))


def page_semestre(numero: int, modules: list) -> str:
    """La page d'un semestre : une carte par module, avec son nombre de fiches et de pages."""
    cartes = "".join(
        '<a class="carte" data-module="%s" href="%s/index.html">'
        '<div class="c-code">%s</div><div class="c-nom">%s</div>'
        '<div class="c-meta">%d fiche%s · %d pages</div></a>'
        % (cfg["code"], cfg["code"], cfg["code"], e(cfg["intitule"]),
           len(cfg["parties"]), "s" if len(cfg["parties"]) > 1 else "",
           sum(p["pages"] or 0 for p in cfg["parties"]))
        for cfg in modules)

    corps = """
<main class="enveloppe">
  <div class="entete">
    <div class="e-code">Semestre %d</div>
    <h1>Les modules du semestre %d</h1>
    <p class="e-st">%d module%s</p>
  </div>
  <div class="grille">%s</div>
</main>
""" % (numero, numero, len(modules), "s" if len(modules) > 1 else "",
       cartes)

    return page("Semestre %d — %s" % (numero, TITRE), "../../", corps,
                recherche=True,
                cible="/fiches/s%d/" % numero,
                cible_titre="Le semestre %d" % numero,
                fil=fil_ariane([("Accueil", "../../index.html"),
                                ("Fiches", "../index.html"),
                                ("Semestre %d" % numero, None)]))


def page_module(cfg: dict) -> str:
    """La page d'un module : ses fiches, leur sommaire, et leurs PDF à lire ou imprimer."""
    s = cfg.get("semestre", 1)
    items = []
    for p in cfg["parties"]:
        sommaire = "".join("<li>%s</li>" % e(x) for x in p["sommaire"])
        items.append("""
<li class="fiche-item">
  <span class="num">Partie %02d</span>
  <div class="corps">
    <div class="t"><a href="%02d.html">%s</a></div>
    <div class="st">%s</div>
    <details class="sommaire-repli">
      <summary>%d sections · %s</summary>
      <ol>%s</ol>
    </details>
  </div>
  <div class="actions">
    <a class="btn" href="../../../pdf/%s" download data-role-cache="super_user">%s PDF</a>
    <a class="btn btn-accent" href="%02d.html">Lire</a>
  </div>
</li>""" % (p["numero"], p["numero"], e(p["titre"]), e(p.get("sous_titre", "")),
            len(p["sommaire"]),
            ("%d pages" % p["pages"]) if p["pages"] else "PDF manquant",
            sommaire, e(p["nom_pdf"]), ICONES["telecharger"], p["numero"]))

    sources = ""
    if cfg.get("sources"):
        sources = ('<h2 class="section">Sources</h2><ul class="e-st">%s</ul>'
                   % "".join("<li>%s</li>" % e(x) for x in cfg["sources"]))

    corps = """
<main class="enveloppe">
  <div class="entete">
    <div class="e-code">%s · Semestre %d</div>
    <h1>%s</h1>
    <p class="e-st">%d fiche%s · %d pages A5 · une fiche par partie</p>
    <div class="outils">
      <button class="btn" type="button" data-proposer="ajout" data-cible="%s"
              data-cible-titre="%s">%s Proposer</button>
    </div>
  </div>
  <ul class="liste-fiches">%s</ul>

  <section class="liees" id="liees" hidden>
    <h2 class="section">À travailler avec</h2>
    <div class="grille grille-liees" id="liees-liste"></div>
  </section>
  %s
</main>
""" % (cfg["code"], s, e(cfg["intitule"]), len(cfg["parties"]),
       "s" if len(cfg["parties"]) > 1 else "",
       sum(p["pages"] or 0 for p in cfg["parties"]),
       e("S%d-%s" % (s, cfg["code"])),
       e("%s — %s" % (cfg["code"], cfg["intitule"])), ICONES["proposer"],
       "".join(items), sources)

    return page("%s — %s" % (cfg["code"], e(cfg["intitule"])), "../../../", corps,
                module=cfg["code"], recherche=True,
                cible="S%d-%s" % (s, cfg["code"]),
                cible_titre="%s — %s" % (cfg["code"], cfg["intitule"]),
                fil=fil_ariane([("Accueil", "../../../index.html"),
                                ("Fiches", "../../index.html"),
                                ("Semestre %d" % s, "../index.html"),
                                (cfg["code"], None)]))


# ---------------------------------------------------------------------------
# Les zones proposables (lot L) : voir zones.py
# ---------------------------------------------------------------------------


def dialogue_proposition() -> str:
    """La fenêtre « Proposer » (lot G, refondue au lot L), posée par page()
    sur toute page qui déclare une racine de cible.

    Quatre types : corriger, ajouter, signaler un problème technique,
    proposer une fonctionnalité — mais tous ne sont pas offerts partout :
    « corriger » et « ajouter » visent du contenu (une fiche, un module,
    une de leurs sections), les deux autres visent le site. La fenêtre le
    déduit de la CIBLE, elle ne le demande pas.

    La cible vient du ⚑ cliqué et s'affiche en clair, avec son chemin
    (« Le quiz › Le choix des fiches ») : l'identifiant reste réservé au
    code, jamais montré ni demandé (doctrine du projet). « Changer » ouvre
    l'inventaire des zones (zones.json, écrit à la génération) : on peut
    donc parler de n'importe quelle partie du site depuis n'importe où,
    sans que personne n'ait à tenir une liste à jour — c'est ce qui
    remplace le <select> de neuf pages du lot G.

    La proposition est motivée — décision 6 de la feuille de route — et la
    fenêtre dit ce qu'il advient du texte : il est lu par l'administrateur,
    et il reste si le compte disparaît (conception § 5, comme un message de
    groupe).
    """
    return """
<template id="prop-drapeau-modele"><button class="prop-drapeau prop-drapeau-bloc" type="button"
  data-proposer="technique">%s</button></template>
<dialog id="prop-dialogue" class="edt-dialogue prop-dialogue">
  <form method="dialog" id="prop-form" class="grp-form">
    <h2 id="prop-titre">Proposer</h2>
    <div class="prop-cible">
      <div class="prop-cible-dit">
        <span class="c-note">Ce dont tu parles</span>
        <strong id="prop-cible-texte"></strong>
        <span class="c-note" id="prop-cible-ou"></span>
      </div>
      <button class="btn btn-mini" type="button" id="prop-changer">Changer…</button>
    </div>
    <input type="hidden" id="prop-cible" value="">
    <div class="prop-choisir" id="prop-choisir" hidden>
      <label for="prop-recherche">De quoi veux-tu parler ?</label>
      <input type="search" id="prop-recherche" autocomplete="off"
             placeholder="une page, une fiche, une section…">
      <ul class="prop-zones" id="prop-zones"></ul>
      <p class="c-note" id="prop-zones-etat"></p>
    </div>
    <fieldset class="grp-p-inviter" id="prop-types">
      <legend>Quoi</legend>
      <label class="grp-p-radio" data-type="correction"><input type="radio" name="prop-type" value="correction"> <span>Corriger</span></label>
      <label class="grp-p-radio" data-type="ajout"><input type="radio" name="prop-type" value="ajout"> <span>Ajouter</span></label>
      <label class="grp-p-radio" data-type="technique"><input type="radio" name="prop-type" value="technique"> <span>Signaler un problème technique</span></label>
      <label class="grp-p-radio" data-type="fonctionnalite"><input type="radio" name="prop-type" value="fonctionnalite"> <span>Proposer une fonctionnalité</span></label>
    </fieldset>
    <label for="prop-texte" id="prop-texte-label">Ta proposition</label>
    <textarea id="prop-texte" rows="4" minlength="10" maxlength="5000" required
              placeholder="Ce qu'il faut changer, ajouter, ou ce qui ne marche pas — précisément."></textarea>
    <label for="prop-motivation">Pourquoi <span class="c-note">(40 caractères au moins)</span></label>
    <textarea id="prop-motivation" rows="3" minlength="40" maxlength="2000" required
              placeholder="Ce qui te fait dire ça : une source, un exemple, ce que tu as constaté."></textarea>
    <p class="c-note prop-compte" id="prop-compte"></p>
    <p class="grp-sig-avertissement">Ta proposition est lue par l'administrateur du site, sous ton
       pseudo ; tu verras sa réponse sur ta page <a href="/compte.html">Mon compte</a>.
       <strong>Elle reste si tu supprimes ton compte</strong>, détachée de toi — comme un message
       de groupe.</p>
    <div class="etat" id="prop-etat" hidden></div>
    <div class="edt-boutons">
      <button class="btn btn-accent" type="submit" id="prop-envoyer">Envoyer</button>
      <button class="btn" type="button" id="prop-annuler">Annuler</button>
    </div>
  </form>
</dialog>
""" % ICONES["proposer"]


def page_fiche(cfg: dict, partie: dict) -> str:
    """La page d'une fiche : son contenu lisible en ligne, section par section, avec son PDF."""
    s = cfg.get("semestre", 1)
    fragment = (CONTENT / cfg["code"] / partie["fichier"]).read_text(encoding="utf-8")
    corps_fiche, sections = adapter_contenu(fragment)
    chapitre = chapitre_de(cfg, partie)

    # Chaque section ET chaque sous-chapitre se vise (lot L). On ne pose ici
    # que la MARQUE — zone() — : c'est page() qui injecte les boutons, calcule
    # les cibles (chapitre#ancre) et inscrit les zones à l'inventaire. Un
    # sous-chapitre n'avait pas d'identifiant jusqu'ici : on lui en donne un,
    # dérivé de son intitulé comme pour les sections, et distinct de ceux
    # déjà pris dans la fiche.
    ancres_prises = set()

    def titre_propre(brut: str) -> str:
        sans_rom = re.sub(r'<span class="rom">[^<]*</span>', "", brut)
        return html.unescape(re.sub(r"<[^>]+>", "", sans_rom)).strip()

    def marquer_section(m):
        cle, titre = m.group(1), m.group(2)
        ancres_prises.add(cle)
        return '<h2 id="%s"%s>%s</h2>' % (cle, zone(cle, titre_propre(titre)), titre)

    corps_fiche = re.sub(r'<h2 id="([^"]+)">(.*?)</h2>', marquer_section,
                         corps_fiche, flags=re.DOTALL)

    def marquer_sous_chapitre(m):
        attributs, titre = m.group(1), m.group(2)
        if "id=" in attributs:
            return m.group(0)
        propre = titre_propre(titre)
        base = ancre_section(propre)
        if not base:
            return m.group(0)   # un sous-titre sans texte ne se vise pas
        cle, n = base, 2
        while cle in ancres_prises:
            cle, n = "%s-%d" % (base, n), n + 1
        ancres_prises.add(cle)
        return '<h3 id="%s"%s%s>%s</h3>' % (cle, attributs, zone(cle, propre), titre)

    corps_fiche = re.sub(r"<h3([^>]*)>(.*?)</h3>", marquer_sous_chapitre,
                         corps_fiche, flags=re.DOTALL)

    plan = "".join('<li><span class="rn">%s.</span><a href="#%s">%s</a></li>'
                   % (roman, cle, e(titre))
                   for _rang, roman, titre, cle in sections)

    # Les sections sont relues plus tard par le catalogue et par l'index, qui
    # ne lisent pas les fragments : on les depose sur la partie au passage.
    partie["sections"] = sections

    # Une fiche de démonstration ne propose PAS ses voisines : elles sont
    # fermées, et le lien n'irait qu'à un refus. Mieux vaut ne rien offrir
    # qu'offrir une porte close.
    numeros = [p["numero"] for p in cfg["parties"]]
    i = numeros.index(partie["numero"])
    nav = []
    if partie.get("demo"):
        numeros = []
    if numeros and i > 0:
        pr = cfg["parties"][i - 1]
        nav.append('<a href="%02d.html"><div class="sens">← Partie %02d</div>'
                   '<div class="quoi">%s</div></a>'
                   % (pr["numero"], pr["numero"], e(pr["titre"])))
    if numeros and i < len(cfg["parties"]) - 1:
        su = cfg["parties"][i + 1]
        nav.append('<a class="suivant" href="%02d.html">'
                   '<div class="sens">Partie %02d →</div>'
                   '<div class="quoi">%s</div></a>'
                   % (su["numero"], su["numero"], e(su["titre"])))

    # Les sources de la fiche si elle en porte, celles du module sinon. La
    # doctrine du nouveau corpus veut des sources PAR FICHE, verifiables ; les
    # modules pas encore reprises n'en ont qu'au niveau du module.
    refs = partie.get("sources") or cfg.get("sources")
    # « Sources » quand ce sont de vraies references publiques ; « D'apres »
    # reste plus juste pour l'ancien corpus, qui reformule.
    etiquette = "Sources" if cfg.get("corpus") == "public" else "D'après"
    sources = ""
    if refs:
        sources = ("""
<div class="box ex sources-fiche">
  <span class="box-t">%s</span>
  <ul>%s</ul>
</div>""" % (e(etiquette), "".join("<li>%s</li>" % e(x) for x in refs)))

    # Les outils liés au PDF. Une fiche de démonstration ne les porte pas : son
    # PDF n'est pas ouvert, et un bouton de téléchargement ne mènerait qu'à un
    # refus. Le panneau d'impression tombe avec eux — il ne fait qu'offrir des
    # liens vers les deux mêmes fichiers. Reste « Partager le lien », qui vaut
    # pour tout le monde.
    outils_pdf, panneau_impression = "", ""
    if not partie.get("demo"):
        # Les deux boutons ne se montrent qu'a un administrateur (conception
        # § 11) : le middleware refuse /pdf a tout autre role, et un bouton
        # qui mene a un refus est pire qu'un bouton absent. « data-role-cache »
        # les tient caches jusqu'a ce que /api/moi confirme le role.
        outils_pdf = ("""
      <a class="btn btn-accent" href="../../../pdf/%s" download data-role-cache="super_user">%s Télécharger le PDF</a>
      <button class="btn" type="button" id="imprimer" data-role-cache="super_user"
              data-pdf="../../../pdf/%s" data-livret="../../../pdf/livret/%s"
              data-pages="%s">%s Imprimer</button>"""
            % (e(partie["nom_pdf"]), ICONES["telecharger"],
               e(partie["nom_pdf"]),
               e(partie["nom_pdf"].replace(".pdf", "_livret.pdf")),
               partie["pages"] or "?", ICONES["imprimer"]))

        panneau_impression = """
<div class="voile" id="voile-impression" hidden>
  <div class="panneau" role="dialog" aria-modal="true" aria-labelledby="titre-impression">
    <h2 id="titre-impression">Imprimer cette fiche</h2>
    <p class="e-st">Deux façons de faire, selon le résultat voulu.</p>
    <h3>Deux A5 par feuille A4</h3>
    <ol>
      <li>Ouvrir le PDF, puis lancer l'impression.</li>
      <li>Format <strong>A4</strong>, orientation <strong>paysage</strong>.</li>
      <li><strong>2 pages par feuille</strong>, recto-verso sur le
          <strong>bord court</strong>.</li>
    </ol>
    <h3>Vrai carnet à plier</h3>
    <ol>
      <li>Télécharger la <strong>version livret</strong> : les pages y sont
          déjà réordonnées.</li>
      <li>Imprimer en A4 paysage, <strong>recto-verso bord court</strong>,
          <strong>100 %%</strong> (surtout pas « ajuster à la page »).</li>
      <li>Empiler, plier en deux, agrafer dans le pli.</li>
    </ol>
    <div class="pied">
      <a class="btn" href="../../../pdf/livret/%s" download>%s Version livret</a>
      <a class="btn btn-accent" href="../../../pdf/%s" target="_blank" rel="noopener">Ouvrir le PDF</a>
      <button class="btn" type="button" data-fermer>Fermer</button>
    </div>
  </div>
</div>
""" % (e(partie["nom_pdf"].replace(".pdf", "_livret.pdf")), ICONES["livret"],
       e(partie["nom_pdf"]))

    corps = """
<main class="enveloppe">
  <div class="entete">
    <div class="e-code">%s · Partie %02d</div>
    <h1>%s</h1>
    <p class="e-st">%s</p>
    <div class="outils">%s
      <button class="btn" type="button" id="partager">%s Partager le lien</button>
      <button class="btn" type="button" data-proposer="ajout" data-cible="%s"
              data-cible-titre="%s">%s Proposer</button>
    </div>
  </div>

  <nav class="plan"%s>
    <div class="p-t">Sommaire</div>
    <ol>%s</ol>
  </nav>

  <article class="fiche">
%s
  </article>
  %s

  <section class="liees" id="liees" hidden>
    <h2 class="section">À travailler avec</h2>
    <div class="grille grille-liees" id="liees-liste"></div>
  </section>

  <nav class="pagination">%s</nav>
</main>
%s
""" % (cfg["code"], partie["numero"], e(partie["titre"]),
       e(partie.get("sous_titre", "")), outils_pdf, ICONES["partager"],
       e(chapitre), e("%s %02d — %s" % (cfg["code"], partie["numero"], partie["titre"])),
       ICONES["proposer"], zone("le-sommaire", "Le sommaire de la fiche"),
       plan, corps_fiche, sources, "".join(nav), panneau_impression)

    return page("%s %02d — %s" % (cfg["code"], partie["numero"], partie["titre"]),
                "../../../", corps, module=cfg["code"],
                fiche=partie["numero"],
                cible=chapitre,
                cible_titre="%s %02d — %s" % (cfg["code"], partie["numero"], partie["titre"]),
                # Une fiche de demonstration est lue sans compte : lui joindre
                # l'index de recherche publierait la table des matieres de tout
                # ce qu'on protege (cf. la docstring de page()).
                recherche=not partie.get("demo"),
                # Le fil d'une fiche de démonstration ne peut pas remonter
                # l'arborescence réelle : chacun de ses échelons est fermé. Il
                # ramène donc à la page de démonstration, qui est ouverte.
                fil=(fil_selon_acces(
                        [("Accueil", "../../../index.html"),
                         ("Fiches (démonstration)", "../../../demo.html"),
                         ("Partie %02d" % partie["numero"], None)],
                        [("Accueil", "../../../index.html"),
                         ("Fiches", "../../index.html"),
                         ("Semestre %d" % s, "../index.html"),
                         (cfg["code"], "index.html"),
                         ("Partie %02d" % partie["numero"], None)])
                     if partie.get("demo") else
                     fil_ariane(
                        [("Accueil", "../../../index.html"),
                         ("Fiches", "../../index.html"),
                         ("Semestre %d" % s, "../index.html"),
                         (cfg["code"], "index.html"),
                         ("Partie %02d" % partie["numero"], None)])))


ICONES_FOURNISSEURS = {
    "google": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285f4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.6z"/><path fill="#34a853" d="M12 24c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3C3.7 21.4 7.6 24 12 24z"/><path fill="#fbbc05" d="M5.6 14.3a7.2 7.2 0 0 1 0-4.6v-3H1.8a12 12 0 0 0 0 10.6l3.8-3z"/><path fill="#ea4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.7 1.2 15.1 0 12 0 7.6 0 3.7 2.6 1.8 6.7l3.8 3C6.5 6.8 9 4.8 12 4.8z"/></svg>',
    "github": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.9 10.9c.6.1.8-.2.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.4-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.1.1 1.7 1.2 1.7 1.2 1 1.8 2.7 1.3 3.4 1 .1-.7.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.3 11.3 0 0 1 6 0C17.5 4.6 18.5 5 18.5 5c.6 1.7.2 2.9.1 3.2.8.8 1.2 1.8 1.2 3.1 0 4.5-2.7 5.5-5.3 5.8.4.4.8 1.1.8 2.2v3.3c0 .4.2.7.8.6A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5z"/></svg>',
    "discord": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#5865f2" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.3.5c1.6.4 2.9 1 4.2 1.8a14 14 0 0 0-9.4-.9C8.7 4.1 8 4 7.3 3.9c-.4 0-.6.1-.9.2A16.2 16.2 0 0 0 3.7 4.4C.6 9 0 13.4.3 17.8a19.9 19.9 0 0 0 6 3l.7-1.1c-.7-.3-1.3-.6-1.9-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.2.7-1.9 1l.8 1.1a19.8 19.8 0 0 0 6-3c.4-5.1-.6-9.5-3-13.4zM8.3 15.3c-1.2 0-2.1-1.1-2.1-2.4 0-1.3.9-2.4 2.1-2.4s2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4zm7.4 0c-1.2 0-2.1-1.1-2.1-2.4 0-1.3.9-2.4 2.1-2.4s2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4z"/></svg>',
    "facebook": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#1877f2" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.6 4.5-4.6 1.3 0 2.6.2 2.6.2v2.9h-1.5c-1.5 0-1.9.9-1.9 1.8V12h3.3l-.5 3.5h-2.8v8.4A12 12 0 0 0 24 12z"/></svg>',
}

# Ce que chaque role ouvre. Ecrit ici plutot que dans la page : le middleware
# et cette liste doivent dire la meme chose, et une seule source le garantit.
ROLES_DESCRIPTION = [
    ("user",
     "Le portail, la démo des quiz, son propre compte. Tout compte "
     "commence ici."),
    ("reader_user",
     "En plus : les fiches de révision, les PDF, le catalogue et les "
     "groupes."),
    ("super_user",
     "En plus : cette page, l'attribution des rôles et le journal."),
]


ICONE_COURRIEL = (
    '<svg viewBox="0 0 24 24" aria-hidden="true">'
    '<path fill="none" stroke="currentColor" stroke-width="1.8" '
    'stroke-linejoin="round" d="M3 6h18v12H3z"/>'
    '<path fill="none" stroke="currentColor" stroke-width="1.8" '
    'stroke-linecap="round" stroke-linejoin="round" d="m3 7 9 6 9-6"/>'
    '</svg>')

NOMS_FOURNISSEURS = {"google": "Google", "github": "GitHub",
                     "discord": "Discord", "facebook": "Facebook"}


def page_connexion() -> str:
    """La page de connexion et d'inscription.

    Elle n'utilise PAS l'ossature commune : la barre du haut charge des
    scripts et des liens qui supposent une session. Une page de connexion doit
    se suffire à elle-même, sinon on se retrouve à devoir être connecté pour
    pouvoir se connecter.
    """
    f = AUTH.get("fournisseurs", {})

    # Les portes d'entree se ressemblent toutes. Un fournisseur externe et une
    # adresse de courriel ne se ressemblent pas techniquement, mais pour la
    # personne qui arrive ce sont deux facons de faire la meme chose. Les
    # presenter differemment (des boutons d'un cote, un formulaire de l'autre)
    # suggere une hierarchie qui n'existe pas.
    boutons = ""
    for cle in ("google", "github", "discord", "facebook"):
        if f.get(cle):
            boutons += ("""
      <button class="btn btn-large btn-fournisseur" type="button"
              data-fournisseur="%s">%s Continuer avec %s</button>"""
                        % (cle, ICONES_FOURNISSEURS[cle], NOMS_FOURNISSEURS[cle]))

    if f.get("lien_courriel"):
        boutons += ("""
      <button class="btn btn-large btn-fournisseur" type="button"
              data-vue="vue-lien">%s Continuer avec mon adresse</button>"""
                    % ICONE_COURRIEL)

    if boutons:
        boutons += '\n      <div class="ou"><span>ou</span></div>'

    mot_de_passe = ""
    if f.get("mot_de_passe"):
        mot_de_passe = """
    <form id="form-mot-de-passe">
      <!-- Le champ accepte une adresse OU un pseudo : « text » et non
           « email », sinon le navigateur refuserait un pseudo avant même
           qu'on l'ait lu. C'est le script qui exige une adresse quand on
           cree un compte, et l'etiquette qui le dit. -->
      <label for="adresse" id="label-adresse">Adresse de courriel ou pseudo</label>
      <input type="text" id="adresse" name="adresse" required
             autocomplete="username" spellcheck="false" autocapitalize="off">

      <!-- Demande a l'inscription seulement. Pas d'attribut « required » :
           un champ cache mais obligatoire bloque l'envoi du formulaire sans
           rien afficher. La verification est dans le script. -->
      <div id="bloc-pseudo" hidden>
        <label for="pseudo">Pseudo</label>
        <input type="text" id="pseudo" name="pseudo"
               autocomplete="nickname" spellcheck="false"
               minlength="3" maxlength="20" autocapitalize="off">
        <p class="c-note" id="etat-pseudo">C'est le nom que les autres
           verront ; ton adresse, elle, n'est jamais affichée.
           3 à 20 caractères : lettres, chiffres, tiret et souligné.</p>
      </div>

      <label for="mot-de-passe">Mot de passe</label>
      <div class="champ-mdp">
        <input type="password" id="mot-de-passe" name="mot-de-passe" required
               autocomplete="current-password" minlength="8">
        <button type="button" class="oeil" data-oeil="mot-de-passe"></button>
      </div>

      <!-- Une option, jamais cochee par defaut : le site se lit depuis des
           postes partages. La case vaut pour toutes les portes d'entree
           (mot de passe, lien, fournisseurs) : le script memorise le choix
           avant un detour par un fournisseur externe. -->
      <label class="consentement" id="bloc-rester">
        <input type="checkbox" id="rester">
        <span>Rester connecté sur cet appareil pendant 30 jours.
              <em>Pas sur un ordinateur partagé.</em></span>
      </label>

      <label class="consentement" id="bloc-consentement" hidden>
        <input type="checkbox" id="consentement">
        <span>J'accepte que mon adresse et mon pseudo soient enregistrés pour
              faire fonctionner mon compte.
              <a href="/donnees.html">Ce qui en est fait</a></span>
      </label>

      <button class="btn btn-accent btn-large" type="submit" id="valider">
        Se connecter</button>
    </form>

    <div class="liens-connexion">
      <button type="button" class="lien-bouton" id="bascule">
        Créer un compte</button>
      <button type="button" class="lien-bouton" id="oubli" data-vue="vue-oubli">
        Mot de passe oublié</button>
    </div>"""

    lien = ""
    if f.get("lien_courriel"):
        lien = """
  <div class="vue" id="vue-lien" hidden>
    <form id="form-lien">
      <label for="adresse-lien">Ton adresse de courriel</label>
      <input type="email" id="adresse-lien" name="adresse-lien" required
             autocomplete="email" spellcheck="false">
      <button class="btn btn-accent btn-large" type="submit">
        Envoyer le lien</button>
    </form>
    <div class="liens-connexion">
      <button type="button" class="lien-bouton" data-vue="vue-principal">
        Retour</button>
    </div>
  </div>"""

    oubli = ""
    if f.get("mot_de_passe"):
        oubli = """
  <div class="vue" id="vue-oubli" hidden>
    <form id="form-oubli">
      <label for="adresse-oubli">Ton adresse de courriel</label>
      <input type="email" id="adresse-oubli" name="adresse-oubli" required
             autocomplete="email" spellcheck="false">
      <button class="btn btn-accent btn-large" type="submit">
        Envoyer le lien</button>
    </form>
    <div class="liens-connexion">
      <button type="button" class="lien-bouton" data-vue="vue-principal">
        Retour</button>
    </div>
  </div>

  <div class="vue" id="vue-nouveau" hidden>
    <form id="form-nouveau">
      <input type="email" id="nouveau-compte" autocomplete="username" hidden>
      <label for="nouveau">Nouveau mot de passe</label>
      <div class="champ-mdp">
        <input type="password" id="nouveau" required minlength="8"
               autocomplete="new-password">
        <button type="button" class="oeil" data-oeil="nouveau"></button>
      </div>
      <button class="btn btn-accent btn-large" type="submit">
        Enregistrer</button>
    </form>
  </div>"""

    corps = """
<main class="connexion">
  <div class="connexion-carte">
    <img class="connexion-logo" src="/assets/favicon.svg" alt="">
    <div class="c-marque">%s</div>
    <h1 id="titre-connexion">Connexion</h1>
    <p class="c-intro" id="intro-connexion">Un compte donne accès aux outils
       de la promo. N'importe quelle adresse convient.</p>

  <div class="vue" id="vue-principal">
%s
  %s
  </div>
%s
%s

    <div class="etat" id="etat" hidden></div>

    <p class="c-note c-sortie">
       <a href="/">Continuer sans compte</a></p>
    <p class="c-note"><a href="/donnees.html">Données personnelles</a></p>
  </div>
</main>
""" % (e(TITRE), boutons, mot_de_passe, lien, oubli)

    return """<!DOCTYPE html>
<html lang="fr" data-racine="" data-module="R105">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Connexion — %s</title>
<link rel="stylesheet" href="/assets/site.css?v=%s">
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
<script src="/assets/config.js?v=%s"></script>
<script type="module" src="/assets/auth.js?v=%s"></script>
</head>
<body>
%s
</body>
</html>
""" % (e(TITRE), VERSION, VERSION, VERSION, corps)


def page_acces_reserve() -> str:
    """Le refus par rôle, pour quelqu'un qui est déjà connecté.

    Sans cette page, un compte sans le rôle voulu serait renvoyé vers la
    connexion : il se reconnecterait, reviendrait, et repartirait vers la
    connexion. Une impasse, et un utilisateur convaincu que le site est cassé.

    Refonte du 12 septembre : la page disait tout sur le même ton, en
    paragraphes. Elle hiérarchise : d'abord ce qu'on peut FAIRE (demander
    l'accès, voir la démonstration) en cartes ; le reste — rouvrir la
    session, revenir — en bas, en petit. Le script montre les cartes qui
    ont un sens pour la page refusée (les fiches : demande et démo ;
    l'administration : rien de tout cela).
    """
    corps = """
<main class="enveloppe page-texte">
  <div class="entete">
    <div class="e-code">Accès réservé</div>
    <h1>Cette partie ne t'est pas encore ouverte</h1>
    <p class="e-st" id="detail-refus">Ton compte fonctionne, mais il n'a pas
       le niveau d'accès nécessaire pour cette page.</p>
  </div>

  <div class="etat" id="etat" hidden></div>

  <div class="grp-grille" id="acces-cartes" hidden>
    <a class="grp-carte grp-carte-invitation" href="/demande-acces.html" id="demander-acces">
      <div class="grp-carte-titre">Demander l'accès aux fiches</div>
      <p class="grp-carte-desc">Un texte à écrire, une personne qui lit, une
         réponse ici même — en général sous une semaine.</p>
      <div class="grp-carte-pied"><span class="grp-pastille">le chemin</span></div>
    </a>
    <a class="grp-carte" href="/demo.html" id="voir-demo">
      <div class="grp-carte-titre">Voir la démonstration</div>
      <p class="grp-carte-desc">Deux fiches se lisent sans aucun accès :
         elles montrent ce que contient une fiche.</p>
      <div class="grp-carte-pied"><span class="grp-pastille grp-pastille-neutre">tout de suite</span></div>
    </a>
  </div>

  <details class="admin-aide">
    <summary>Pourquoi, et que faire si l'accès vient de t'être accordé</summary>
    <p>Certaines parties du site demandent un accès accordé à la main : c'est
       une décision humaine, pas un réglage que tu peux changer toi-même.</p>
    <p>Si un accès vient de t'être accordé et que cette page te refuse quand
       même, refais un tour par la connexion : ta session date d'avant, et
       elle porte encore l'ancien niveau.</p>
    <p><button class="btn btn-mini" type="button" id="renouveler">Rouvrir ma session</button></p>
  </details>

  <p class="grp-actions-fin">
     <a class="btn btn-mini" href="/">Retour à l'accueil</a>
     <a class="btn btn-mini" href="/compte.html">Mon compte</a></p>

  <p class="c-note" id="ou-tu-allais" hidden></p>
</main>
"""
    # Meme accent que les fiches : c'est d'elles qu'il s'agit presque toujours.
    return page("Accès réservé — %s" % TITRE, "", corps,
                classe_body="compte", app="fiches",
                fil=fil_ariane([("Accueil", "index.html"),
                                ("Accès réservé", None)]))

def page_demande_acces() -> str:
    """Le tunnel : demander l'accès aux fiches, en quatre temps.

    Le compte `user` refusé sur les fiches tombait sur « accès réservé », qui
    expliquait un refus sans ouvrir de chemin (conception § 9 bis).
    Cette page est le chemin. Elle dit comment on accède, POURQUOI ce n'est
    pas ouvert, demande une justification sincère, et annonce qu'un humain
    lit — sous quel délai.
    """
    r = AUTH.get("rgpd", {})
    contact = e(r.get("contact", ""))
    corps = """
<main class="enveloppe page-texte">
  <div class="entete">
    <div class="e-code">Fiches de révision</div>
    <h1>Demander l'accès aux fiches</h1>
    <p class="e-st">Une personne lit ta demande, et te répond ici.</p>
  </div>

  <div class="etat" id="etat" hidden></div>

  <!-- L'etat de la demande, peint par le script. C'est la PREMIERE chose
       de la page : ce qu'on vient y chercher, c'est « où j'en suis ». -->
  <section id="demande-etat" class="dem-etat" hidden>
    <h2 class="section" id="demande-etat-titre"></h2>
    <p id="demande-etat-texte"></p>
    <blockquote class="demande-motif" id="demande-motif" hidden></blockquote>
    <p id="demande-etat-suite"></p>
    <p class="dem-actions" id="demande-etat-actions" hidden></p>
  </section>

  <details class="dem-pourquoi">
    <summary>Comment l'accès est décidé, et pourquoi il se demande</summary>

  <h2 class="section">Comment on y accède</h2>
  <p>Les fiches, leurs PDF, la recherche dans le texte et le catalogue sont
     ouverts aux comptes qui portent l'accès étendu. Cet accès n'est pas un
     réglage : il est <strong>donné à la main</strong>, par une personne, après
     lecture d'une demande. Deux fiches se lisent dès maintenant, sans rien
     demander : <a href="/demo.html">la démonstration</a> montre ce que
     contient une fiche.</p>
  </details>

  <h2 class="section">Ta demande</h2>
  <p>Le critère est simple, et c'est le seul : <strong>l'accès sert un
     travail personnel</strong> — réviser, reprendre une notion, préparer une
     évaluation — <strong>pas à remplacer la présence en cours</strong>.
     Écris ce que tu comptes en faire, avec tes mots. Il n'y a pas de
     formule attendue et pas de longueur à atteindre : quelques lignes
     sincères valent mieux qu'une page.</p>

  <form id="form-demande" hidden>
    <label for="justification">Ta demande</label>
    <textarea id="justification" name="justification" rows="7" minlength="30"
              maxlength="2000" required
              placeholder="Pourquoi tu veux accéder aux fiches, et ce que tu en feras."></textarea>
    <p class="c-note">Entre 30 et 2000 caractères. Ce texte est lu par
       l'administrateur du site, et par personne d'autre. Il reste attaché à
       ton compte, avec la réponse, et disparaît avec lui
       (<a href="/donnees.html">ce qui en est fait</a>).</p>
    <button class="btn btn-accent" type="submit" id="envoyer-demande">
      Envoyer ma demande</button>
  </form>

  <details class="dem-pourquoi">
    <summary>Ce qui se passe ensuite, et à qui s'adresser</summary>

  <p><strong>Une personne lit ta demande</strong>, pas un programme. Elle
     répond en général <strong>sous une semaine</strong>, ici même : cette page
     te dira si l'accès est ouvert, ou pourquoi il ne l'est pas. Un refus est
     toujours motivé, et tu peux redemander après l'avoir lu.</p>
  <p>Si tu penses qu'une décision est injuste, dis-le à quelqu'un d'autre que
     la page qui l'a prise : <a href="mailto:%s">%s</a>. Une décision doit
     pouvoir être rediscutée ailleurs que là où elle a été rendue.</p>

  </details>

  <p><a class="btn" href="/">Retour à l'accueil</a>
     <a class="btn" href="/demo.html">Voir la démonstration</a></p>
</main>
""" % (contact, contact)

    return page("Demander l'accès — %s" % TITRE, "", corps,
                classe_body="compte", app="fiches",
                cible="/demande-acces.html", cible_titre="La demande d'accès",
                fil=fil_ariane([("Accueil", "index.html"),
                                ("Demande d'accès", None)]))


def page_emploi() -> str:
    """L'emploi du temps : une grille vide, que chacun remplit.

    Ce que la page contient est décrit à conception § 6 ter (étape 4 bis) :
    la semaine, les événements et les tâches, le dépôt d'un fichier .ics, le
    suivi d'un lien ICS. Tout vient de /api/emploi avec le jeton de la
    personne ; la page ne voit jamais que ses propres lignes.

    Le registre des types d'événement vit dans le script (TYPES_EVENEMENT) :
    ajouter un type, c'est ajouter une entrée — un libellé, une couleur, les
    champs propres — sans toucher à la base ni aux routes.
    """
    corps = """
<main class="enveloppe">
  <div class="entete">
    <div class="e-code">Emploi du temps</div>
    <h1>Ta semaine</h1>
    <p class="e-st">Tes cours, tes séances, tes tâches. Rien n'y est mis
       à ta place : importe ton calendrier, ou ajoute ce que tu veux.</p>
  </div>

  <div class="etat" id="etat" hidden></div>

  <section class="grp-banniere edt-invitations" id="edt-invitations" hidden>
    <p><strong>On te propose</strong> <span class="c-note">(un contact t'invite à un événement ; accepter le copie dans ta grille)</span></p>
    <ul class="grp-membres" id="edt-liste-invitations"></ul>
  </section>

  <div class="edt-barre" id="edt-barre">
    <div class="edt-nav">
      <button class="btn btn-mini" type="button" id="edt-prec" title="Précédent">←</button>
      <!-- Le titre est un bouton : il ouvre un calendrier pour sauter a une
           date, comme quand on cree un evenement. « Aujourd'hui » reste, en
           petit. -->
      <label class="edt-aller" title="Aller à une date">
        <strong id="edt-titre"></strong>
        <input type="date" id="edt-aller" aria-label="Aller à une date">
      </label>
      <button class="btn btn-mini" type="button" id="edt-suiv" title="Suivant">→</button>
      <button class="lien-bouton" type="button" id="edt-auj">aujourd'hui</button>
    </div>
    <div class="edt-actions">
      <a class="btn btn-mini" href="../contacts/">Contacts</a>
      <button class="btn btn-mini" type="button" id="edt-ouvrir-import">⇩ Importer un calendrier</button>
      <button class="btn btn-accent btn-mini" type="button" id="edt-ajouter">+ Ajouter</button>
    </div>
  </div>

  <div class="edt-grille" id="edt-grille" aria-live="polite"></div>

  <section class="edt-taches" id="edt-taches-bloc">
    <h2 class="section">À faire</h2>
    <p class="c-note" id="edt-taches-note"></p>
    <ul class="edt-liste-taches" id="edt-taches"></ul>
  </section>

  <details class="admin-aide" id="edt-sources">
    <summary>Importer et suivre un calendrier</summary>

    <h3>Un fichier .ics</h3>
    <p>Télécharge ton emploi du temps depuis le portail (le lien prévu pour
       Google Agenda ou Outlook donne un fichier <code>.ics</code>), puis
       dépose-le ici. Le redéposer met à jour sans doubler.</p>
    <p><input type="file" id="edt-fichier" accept=".ics,text/calendar">
       <button class="btn btn-mini" type="button" id="edt-importer">Déposer</button></p>

    <h3>Un lien suivi</h3>
    <p>Colle l'adresse du calendrier : le site ira le relire quand tu ouvres
       cette page (au plus toutes les six heures), et retirera ce qui a
       disparu. <strong>Ce lien est personnel</strong> : il n'est lisible que
       par toi, jamais par l'administration, et disparaît avec ton compte
       (<a href="/donnees.html">ce qui en est fait</a>).</p>
    <form id="edt-form-lien" class="edt-form-lien">
      <input type="url" id="edt-lien-url" placeholder="https://…/emploi-du-temps.ics" required>
      <input type="text" id="edt-lien-nom" placeholder="Nom (facultatif)" maxlength="80">
      <button class="btn btn-mini btn-accent" type="submit">Suivre</button>
    </form>
    <ul class="edt-liste-cals" id="edt-cals"></ul>
  </details>

  <dialog id="edt-dialogue" class="edt-dialogue">
    <form method="dialog" id="edt-form">
      <h2 id="edt-dialogue-titre">Nouvel événement</h2>
      <label for="edt-type">Type</label>
      <div class="edt-type-ligne">
        <span class="edt-pastille-type" id="edt-pastille-type" aria-hidden="true"></span>
        <select id="edt-type"></select>
      </div>
      <!-- 1.e : une seance se rattache a un groupe — elle sera creee DANS le
           groupe, et chaque membre la verra. Montre seulement pour ce type. -->
      <div id="edt-bloc-groupe" hidden>
        <label for="edt-groupe">Groupe</label>
        <select id="edt-groupe"><option value="">— sans groupe (juste pour moi)</option></select>
      </div>
      <label for="edt-titre-champ">Titre</label>
      <input type="text" id="edt-titre-champ" maxlength="200" required>
      <div class="edt-ligne">
        <div><label for="edt-date">Date</label><input type="date" id="edt-date" required></div>
        <div><label for="edt-heure">De</label><input type="time" id="edt-heure"></div>
        <div><label for="edt-heure-fin">à</label><input type="time" id="edt-heure-fin"></div>
      </div>
      <label class="consentement"><input type="checkbox" id="edt-journee"><span>Journée entière</span></label>
      <div id="edt-champs-type"></div>
      <fieldset class="rappels-choix" id="edt-rappels">
        <legend>Me rappeler <span class="c-note">(notification, si tu les as activées)</span></legend>
        <label><input type="checkbox" value="15"> 15 min avant</label>
        <label><input type="checkbox" value="60"> 1 h avant</label>
        <label><input type="checkbox" value="1440"> la veille</label>
      </fieldset>
      <!-- Proposer l'evenement a des contacts (decision 4) : ils le recoivent
           sur leur page et l'acceptent d'un clic. Cache pour une seance de
           groupe (elle est deja chez chaque membre) et pour ce qui n'est pas
           a moi. -->
      <div id="edt-bloc-contacts" hidden>
        <label for="edt-contacts">Proposer aussi à</label>
        <input type="text" id="edt-contacts" hidden>
        <div class="sf-champ sf-champ-multi" id="edt-contacts-champ">
          <span class="sf-lu sf-etiquettes" id="edt-contacts-liste"></span>
          <button class="btn btn-petit" type="button" id="edt-choisir-contacts">Choisir des contacts…</button>
        </div>
      </div>
      <p class="c-note" id="edt-origine" hidden></p>
      <div class="edt-boutons">
        <button class="btn btn-accent" type="submit" id="edt-enregistrer">Enregistrer</button>
        <button class="btn" type="button" id="edt-annuler">Annuler</button>
        <button class="btn btn-danger" type="button" id="edt-supprimer" hidden>Supprimer</button>
      </div>
    </form>
  </dialog>
</main>
"""
    return page("Emploi du temps — %s" % TITRE, "../", corps,
                classe_body="compte", app="emploi",
                cible="/emploi/", cible_titre="L'emploi du temps",
                fil=fil_ariane([("Accueil", "../index.html"),
                                ("Emploi du temps", None)]))


def barre_messagerie() -> str:
    """La barre des conversations, commune a la liste (/groupes/) et a la
    page d'un groupe : c'est ce qui fait d'une suite de pages une
    messagerie. En haut, le titre et « + » ; une recherche ; deux volets,
    Groupes (les invitations d'abord, puis une ligne par conversation :
    avatar, nom, dernier message, heure, non-lus, le « ⋯ ») et Contacts
    (demandes recues, mes contacts, une demande par pseudo). Tout est peint
    par le script depuis /api/groupes et /api/contacts. Entre les deux,
    depuis le lot H, le volet « Prives » : les conversations privees (un
    groupe a deux, groupes.prive), sous le pseudo de l'autre, et le bouton
    « Ecrire a un contact… ».

    La fenetre « Nouveau groupe » et la barre de selection vivent ici aussi,
    pour que les deux pages partagent le meme script sans condition."""
    return """
  <aside class="msg-cote" id="msg-cote">
    <div class="msg-cote-tete">
      <h1 class="msg-titre">Messages</h1>
      <span class="msg-cote-actions">
        <a class="btn btn-icone" href="/parametres.html" title="Paramètres des notifications" aria-label="Paramètres des notifications">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg></a>
        <button class="btn btn-accent btn-icone" type="button" id="grp-ouvrir-creer" title="Nouveau groupe" aria-label="Nouveau groupe">+</button>
      </span>
    </div>
    <div class="msg-recherche">
      <input type="search" id="msg-recherche" placeholder="Rechercher…" aria-label="Rechercher une conversation ou un contact" autocomplete="off">
    </div>
    <nav class="msg-volets" aria-label="Volets">
      <button type="button" class="msg-volet-bouton est-actif" data-volet="groupes">Groupes <span class="nl-pastille" id="msg-groupes-pastille" hidden></span></button>
      <button type="button" class="msg-volet-bouton" data-volet="prives" title="Conversations privées">Privés <span class="nl-pastille" id="msg-prives-pastille" hidden></span></button>
      <button type="button" class="msg-volet-bouton" data-volet="contacts">Contacts <span class="nl-pastille" id="msg-contacts-pastille" hidden></span></button>
    </nav>

    <div class="msg-volet" data-volet="groupes">
      <div class="grp-selection" id="grp-selection" hidden>
        <span id="grp-selection-compte">0 sélectionné</span>
        <span class="grp-selection-actions">
          <button class="btn btn-petit btn-danger" type="button" id="grp-selection-retirer">Retirer</button>
          <button class="btn btn-petit" type="button" id="grp-selection-annuler">Annuler</button>
        </span>
      </div>
      <section id="grp-invitations" hidden>
        <h2 class="msg-sous-titre">Invitations</h2>
        <div class="msg-liste" id="grp-liste-invitations"></div>
      </section>
      <div class="msg-liste" id="grp-liste"></div>
      <p class="c-note msg-note" id="grp-note"></p>
    </div>

    <div class="msg-volet" data-volet="prives" hidden>
      <div class="msg-ajout-contact">
        <button class="btn btn-petit btn-accent" type="button" id="msg-ecrire-a">Écrire à un contact…</button>
      </div>
      <p class="c-note msg-note msg-prives-cles" id="msg-prives-cles" hidden>🔑 Tes messages chiffrés ne sont pas
         déverrouillés sur cet appareil. <button type="button" class="lien-bouton" id="msg-prives-passkey" hidden>Déverrouiller par un geste</button>
         · <button type="button" class="lien-bouton" id="msg-prives-lier">Recevoir mes clés ici</button>
         · <button type="button" class="lien-bouton" id="msg-prives-deverrouiller">Entrer ma phrase</button></p>
      <p class="cles-sans-sauvegarde" id="msg-prives-sauvegarde" hidden>⚠ Tes clés ne sont
         sauvegardées nulle part : perdre cet appareil, c'est perdre tes messages privés.
         <a href="/parametres.html#carte-chiffrement">Les protéger</a></p>
      <div class="msg-liste" id="msg-liste-prives"></div>
      <p class="c-note msg-note" id="msg-prives-note"></p>
    </div>

    <div class="msg-volet" data-volet="contacts" hidden>
      <form class="msg-ajout-contact" id="msg-form-contact">
        <input type="text" id="msg-contact-pseudo" placeholder="Pseudo à ajouter" minlength="3" maxlength="20" autocomplete="off" aria-label="Pseudo">
        <button class="btn btn-petit" type="submit">Demander</button>
      </form>
      <section id="msg-contacts-recues" hidden>
        <h2 class="msg-sous-titre">Demandes reçues</h2>
        <div class="msg-liste" id="msg-liste-recues"></div>
      </section>
      <div class="msg-liste" id="msg-liste-contacts"></div>
      <p class="c-note msg-note" id="msg-contacts-note"></p>
      <section id="msg-contacts-envoyees" hidden>
        <h2 class="msg-sous-titre">Demandes envoyées</h2>
        <div class="msg-liste" id="msg-liste-envoyees"></div>
      </section>
      <p class="c-note msg-note"><a href="/contacts/">Tout gérer</a></p>
    </div>
  </aside>

  <dialog id="grp-dialogue-creer" class="edt-dialogue">
    <form method="dialog" id="grp-form-creer" class="grp-form">
      <div class="sf-tete"><h2>Nouveau groupe</h2>
        <button type="button" class="btn btn-icone sf-fermer" aria-label="Fermer" title="Fermer">×</button></div>
      <label for="grp-nom">Nom</label>
      <input type="text" id="grp-nom" maxlength="60" minlength="2" required
             placeholder="R104 — révisions du jeudi">
      <label for="grp-description">Description <span class="c-note">(facultatif)</span></label>
      <textarea id="grp-description" rows="2" maxlength="500"
                placeholder="Ce qu'on y fait, quand, pour qui."></textarea>
      <p class="c-note">Tu en seras l'administrateur. Ce qui s'écrit dans un
         groupe reste visible des membres, même si son auteur supprime son
         compte (<a href="/donnees.html">ce qui en est fait</a>).</p>
      <div class="edt-boutons">
        <button class="btn btn-accent" type="submit">Créer</button>
        <button class="btn" type="button" id="grp-annuler-creer">Annuler</button>
      </div>
    </form>
  </dialog>
"""


def page_groupes() -> str:
    """La messagerie : la barre des conversations a gauche, et a droite,
    tant qu'aucune n'est ouverte, l'invitation a en choisir une ou a creer
    un groupe. Sur un petit ecran, la barre seule : on ouvre une
    conversation en pleine page (groupe.html).

    Reserve a un compte (middleware : /groupes exige d'etre connecte). Tout
    vient de /api/groupes ; la page ne montre que ce que la base laisse
    voir.
    """
    corps = """
<main class="enveloppe msg-app" id="msg-app">
  <div class="etat" id="etat" hidden></div>
""" + barre_messagerie() + """

  <section class="msg-conv msg-conv-vide" id="msg-conv">
    <div class="msg-vide">
      <div class="msg-vide-ico">%s</div>
      <p><strong>Choisis une conversation</strong>, crée un groupe pour réviser à plusieurs,
         ou écris à un contact (volet Contacts, ⋯ → Écrire).</p>
      <p><button class="btn btn-accent" type="button" id="msg-vide-creer">+ Nouveau groupe</button></p>
      <p class="c-note">Une séance proposée dans un groupe se pose dans l'emploi du temps de
         chacun ; un message peut citer une fiche ; les non-lus se voient d'ici et depuis
         l'accueil.</p>
    </div>
  </section>
</main>
""" % ICONES_APPS["groupes"]
    return page("Messages — %s" % TITRE, "../", corps,
                classe_body="compte messagerie", app="groupes", chiffrement=True,
                cible="/groupes/", cible_titre="Les messages et les groupes",
                fil=fil_ariane([("Accueil", "../index.html"),
                                ("Messages", None)]))


def page_contacts() -> str:
    """Mes contacts : les demandes reçues, envoyées, et la liste.

    Décision 4 de la feuille de route : un contact n'existe qu'après une
    demande acceptée ; être dans un même groupe ne fait pas un contact. Tout
    vient de /api/contacts avec le jeton de la personne (supabase/
    2026_contacts.sql : chacun ne voit que les lignes où il figure).
    """
    corps = """
<main class="enveloppe enveloppe-etroite">
  <div class="entete grp-entete">
    <div>
      <div class="e-code">Contacts</div>
      <h1>Mes contacts</h1>
      <p class="e-st">Une personne devient un contact quand elle accepte ta
         demande (ou toi la sienne). Un contact peut te proposer un
         événement dans ton emploi du temps.</p>
    </div>
  </div>

  <div class="etat" id="etat" hidden></div>

  <form id="ct-form" class="ct-form">
    <label for="ct-pseudo">Demander quelqu'un par son pseudo</label>
    <div class="ct-ligne">
      <input type="text" id="ct-pseudo" maxlength="20" required autocomplete="off" placeholder="pseudo">
      <button class="btn btn-accent btn-mini" type="submit">Envoyer la demande</button>
    </div>
  </form>

  <section id="ct-recues" hidden>
    <h2 class="section">Demandes reçues</h2>
    <ul class="grp-membres" id="ct-liste-recues"></ul>
  </section>

  <section id="ct-contacts">
    <h2 class="section">Contacts</h2>
    <p class="c-note" id="ct-note"></p>
    <ul class="grp-membres" id="ct-liste-contacts"></ul>
  </section>

  <section id="ct-envoyees" hidden>
    <h2 class="section">Demandes envoyées</h2>
    <ul class="grp-membres" id="ct-liste-envoyees"></ul>
  </section>
</main>
"""
    return page("Contacts — %s" % TITRE, "../", corps,
                classe_body="compte", app="groupes",
                cible="/contacts/", cible_titre="Les contacts",
                fil=fil_ariane([("Accueil", "../index.html"),
                                ("Contacts", None)]))


def page_rejoindre() -> str:
    """L'invitation par lien : qui t'invite, dans quel groupe, un bouton.
    Le middleware garde /groupes : sans compte, on passe par la connexion
    (ou la création de compte) et on revient ici — « suite » est retenu
    jusqu'au retour du courriel de confirmation."""
    corps = """
<main class="enveloppe enveloppe-etroite">
  <div class="entete grp-entete">
    <div>
      <div class="e-code">Invitation</div>
      <h1 id="rj-titre">Un groupe t'invite</h1>
      <p class="e-st" id="rj-sous-titre">Un instant…</p>
    </div>
  </div>
  <div class="etat" id="etat" hidden></div>
  <section class="carte rj-carte" id="rj-carte" hidden>
    <h2 id="rj-nom">…</h2>
    <p class="c-note" id="rj-desc"></p>
    <p class="c-note" id="rj-membres"></p>
    <p>
      <button class="btn btn-accent" type="button" id="rj-rejoindre">Rejoindre le groupe</button>
      <a class="btn btn-accent" id="rj-ouvrir" hidden>Ouvrir le groupe</a>
      <a class="btn" href="index.html">Mes groupes</a>
    </p>
  </section>
</main>
"""
    return page("Invitation — %s" % TITRE, "../", corps,
                classe_body="compte", app="groupes",
                fil=fil_ariane([("Accueil", "../index.html"),
                                ("Groupes", "index.html"),
                                ("Invitation", None)]))


def page_groupe() -> str:
    """Un groupe : en-tête avec les membres, trois onglets (discussion en
    fil de bulles, séances en cartes datées, membres). L'identifiant est
    dans l'adresse (?id=…) ; la page ne montre que ce que /api/groupes/:id
    renvoie — donc ce que la base laisse voir à cette personne.

    Avec « &signalement=<n> » (lot E), la même page passe en LECTURE DE
    SIGNALEMENT pour l'administrateur du site : bandeau rouge, la discussion
    lue jusqu'au message signalé (ce que la règle d'accès « porte » laisse
    voir : ce message et ceux qui le précèdent), les boutons de verdict ;
    pas de composeur, pas de direct, pas de sondage.

    Une CONVERSATION PRIVÉE (lot H, groupes.prive) est la même page, sans
    onglets : le pseudo de l'autre en titre, son avatar, le fil, le
    composeur (« Écrire à bob… »), un « ⋯ » dans l'en-tête pour quitter ;
    ni séances, ni membres, ni invitation. Si les deux ne sont plus en
    contact, le composeur disparaît et une bannière le dit."""
    corps = """
<main class="enveloppe msg-app msg-ouvert" id="msg-app">
""" + barre_messagerie() + """
  <section class="msg-conv" id="msg-conv">
  <div class="grp-tete msg-conv-tete">
    <a class="btn btn-icone msg-retour" href="index.html" title="Toutes les conversations" aria-label="Toutes les conversations">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></a>
    <div class="grp-tete-texte">
      <h1 id="grp-titre">…</h1>
      <p class="c-note" id="grp-desc"></p>
      <p class="c-note grp-chiffre-etat" id="grp-chiffre-etat" hidden></p>
    <p class="cles-sans-sauvegarde" id="grp-sauvegarde" hidden>⚠ Tes clés ne sont sauvegardées
       nulle part : si tu perds cet appareil, ces messages sont perdus.
       <a href="/parametres.html#carte-chiffrement">Les protéger</a></p>
    </div>
    <div class="grp-avatars" id="grp-avatars" title="Membres"></div>
    <button class="btn btn-icone grp-tete-menu" type="button" id="grp-tete-menu" title="Actions" aria-label="Actions sur la conversation" hidden>⋯</button>
  </div>

  <div class="etat" id="etat" hidden></div>

  <!-- Conversation privée fermée (lot H) : les deux ne sont plus en contact,
       ou l'autre est parti. Lisible, plus d'écriture (la base refuse). -->
  <section id="grp-prive-note" class="grp-banniere grp-banniere-privee" hidden>
    <p></p>
  </section>

  <!-- Les clés de l'autre ont changé (lot H, session 2) : rien n'est
       accepté sans un geste — sinon la base pourrait substituer une clé.
       L'empreinte se compare par un autre moyen. -->
  <section id="grp-cles-alerte" class="grp-banniere grp-banniere-signalement" hidden>
    <p><strong>Les clés de <span id="grp-cles-alerte-qui"></span> ont changé</strong>
       <span id="grp-cles-alerte-quand"></span>. C'est normal si cette personne a perdu
       sa phrase ou changé d'appareil — et c'est aussi ce que ferait quelqu'un qui se
       ferait passer pour elle. Vérifie avec elle, <strong>par un autre moyen</strong>,
       que son empreinte est bien :</p>
    <p class="grp-empreinte" id="grp-cles-alerte-empreinte"></p>
    <p><button class="btn btn-accent btn-mini" type="button" id="grp-cles-accepter">C'est bien elle — lire ses messages et lui rendre l'historique</button>
       <button class="btn btn-mini" type="button" id="grp-cles-plus-tard">Pas maintenant</button></p>
  </section>

  <!-- Lecture de signalement (administrateur du site). Tout ce qui est
       peint ici vient de /api/admin/signalements?id=n (qui inscrit
       l'ouverture au journal), puis de /api/groupes/:id?fenetre=1 (la
       porte, tenue par la base). -->
  <section id="grp-signalement" class="grp-banniere grp-banniere-signalement" hidden>
    <p class="grp-sig-titre"><strong>Lecture de signalement</strong> <span id="grp-sig-num"></span></p>
    <p id="grp-sig-detail"></p>
    <blockquote class="demande-motif" id="grp-sig-texte" hidden></blockquote>
    <p class="c-note" id="grp-sig-porte"></p>
    <div id="grp-sig-verdict-zone">
      <textarea id="grp-sig-note" rows="2" maxlength="1000" placeholder="Une note (facultative) : la personne qui a signalé la lira."></textarea>
      <p class="grp-sig-boutons">
        <button class="btn btn-mini btn-danger" type="button" id="grp-sig-retirer">Retirer le message</button>
        <button class="btn btn-mini" type="button" id="grp-sig-avertir">Avertissement</button>
        <button class="btn btn-mini" type="button" id="grp-sig-sans-suite">Sans suite</button>
      </p>
    </div>
    <p id="grp-sig-rendu" hidden></p>
    <p class="c-note"><a href="../admin.html">← Retour à l'administration</a></p>
  </section>

  <section id="grp-invite-banniere" class="grp-banniere" hidden>
    <p><strong>On t'invite dans ce groupe.</strong> Tant que tu n'as pas
       accepté, tu n'en vois ni la discussion ni les séances.</p>
    <p><button class="btn btn-accent" type="button" id="grp-accepter">Accepter</button>
       <button class="btn" type="button" id="grp-decliner">Décliner</button></p>
  </section>

  <nav class="admin-onglets" id="grp-onglets">
    <button type="button" class="admin-onglet est-actif" data-onglet="discussion">Discussion</button>
    <button type="button" class="admin-onglet" data-onglet="seances">Séances <span class="admin-badge" id="grp-badge-seances" hidden>0</span></button>
    <button type="button" class="admin-onglet" data-onglet="membres">Membres <span class="admin-badge admin-badge-neutre" id="grp-badge-membres" hidden>0</span></button>
  </nav>

  <section class="admin-section" data-section="discussion" id="grp-discussion">
    <!-- l'appui long sur un message (telephone) : ses actions, en haut de l'ecran -->
    <div class="grp-barre-msg" id="grp-barre-msg" role="toolbar" aria-label="Actions sur le message" hidden>
      <span class="grp-barre-msg-actions" id="grp-barre-msg-actions"></span>
      <button class="grp-ref-retirer grp-barre-fermer" type="button" id="grp-barre-fermer" title="Fermer" aria-label="Fermer">×</button>
    </div>
    <div class="grp-selection" id="grp-selection" hidden>
      <span id="grp-selection-compte">0 sélectionné</span>
      <span class="grp-selection-actions">
        <button class="btn btn-petit" type="button" id="grp-selection-effacer">Effacer</button>
        <button class="btn btn-petit" type="button" id="grp-selection-annuler">Annuler</button>
      </span>
    </div>
    <div class="grp-fil" id="grp-messages"></div>
    <p class="grp-frappe" id="grp-frappe" aria-live="polite" hidden></p>
    <div class="grp-reponse" id="grp-reponse" hidden>
      <div class="grp-reponse-corps"><span class="grp-reponse-qui" id="grp-reponse-qui"></span>
        <span class="grp-reponse-texte" id="grp-reponse-texte"></span></div>
      <button class="grp-ref-retirer" type="button" id="grp-reponse-retirer" title="Ne plus répondre">×</button>
    </div>
    <div class="grp-reponse grp-edition" id="grp-edition" hidden>
      <div class="grp-reponse-corps"><span class="grp-reponse-qui">Modifier le message</span>
        <span class="grp-reponse-texte" id="grp-edition-texte"></span></div>
      <button class="grp-ref-retirer" type="button" id="grp-edition-annuler" title="Annuler la modification (Échap)" aria-label="Annuler la modification">×</button>
    </div>
    <div class="grp-refs-choisies" id="grp-refs" hidden></div>
    <form id="grp-form-message" class="grp-composeur">
      <div class="grp-plus">
        <button class="btn btn-icone" type="button" id="grp-plus" title="Joindre une référence" aria-label="Joindre une référence" aria-haspopup="menu">+</button>
        <div class="grp-menu" id="grp-menu-plus" role="menu" hidden>
          <button type="button" role="menuitem" id="grp-ref-fiches">Une ou plusieurs fiches…</button>
          <button type="button" role="menuitem" id="grp-ref-seance">Une séance du groupe…</button>
        </div>
      </div>
      <textarea id="grp-texte" rows="1" maxlength="2000" required placeholder="Écrire au groupe…"></textarea>
      <button class="btn btn-accent" type="submit" title="Envoyer">➤</button>
    </form>
    <p class="c-note grp-direct" id="grp-direct" title="Les messages arrivent sans recharger" hidden>
      <span class="grp-point"></span> en direct</p>
    <!-- Les signalements que j'ai déposés sur ce groupe, avec leur verdict :
         c'est ici que la personne qui a signalé apprend ce qu'il en est. -->
    <div class="grp-mes-signalements" id="grp-mes-signalements" hidden></div>
  </section>

  <section class="admin-section" data-section="seances" hidden>
    <div class="grp-barre-section">
      <p class="c-note">Une séance proposée ici se pose dans l'emploi du temps de chaque membre.</p>
      <button class="btn btn-accent btn-mini" type="button" id="grp-ouvrir-seance">+ Proposer</button>
    </div>
    <div class="grp-grille" id="grp-seances"></div>
  </section>

  <section class="admin-section" data-section="membres" id="grp-membres-section" hidden>
    <div class="grp-barre-section">
      <p class="c-note" id="grp-membres-note"></p>
      <button class="btn btn-accent btn-mini" type="button" id="grp-ouvrir-inviter" hidden>Inviter…</button>
    </div>
    <ul class="grp-membres" id="grp-membres"></ul>
    <p class="c-note grp-chaine-note" id="grp-chaine-note" hidden>Le
       <strong>fondateur</strong> ne peut être ni rétrogradé ni retiré.
       Un administrateur ne peut retirer l'administration qu'à ceux qu'il a
       nommés (et à ceux qu'ils ont nommés), jamais à celui qui l'a nommé.</p>
    <p class="grp-actions-fin">
      <button class="btn btn-mini" type="button" id="grp-parametres" hidden>⚙ Paramètres</button>
      <button class="btn btn-mini" type="button" id="grp-quitter">Quitter le groupe</button>
    </p>
  </section>
  </section>

  <dialog id="grp-dialogue-seance" class="edt-dialogue">
    <form method="dialog" id="grp-form-seance" class="grp-form">
      <div class="sf-tete"><h2 id="grp-s-titre-dialogue">Proposer une séance</h2>
        <button type="button" class="btn btn-icone sf-fermer" aria-label="Fermer" title="Fermer">×</button></div>
      <label for="grp-s-titre">Titre</label>
      <input type="text" id="grp-s-titre" maxlength="200" required placeholder="Réviser les jointures">
      <div class="edt-ligne">
        <div><label for="grp-s-date">Date</label><input type="date" id="grp-s-date" required></div>
        <div><label for="grp-s-heure">De</label><input type="time" id="grp-s-heure" required></div>
        <div><label for="grp-s-fin">à</label><input type="time" id="grp-s-fin"></div>
      </div>
      <label for="grp-s-lieu">Lieu</label>
      <input type="text" id="grp-s-lieu" maxlength="200" placeholder="BU, salle I218, en ligne…">
      <label for="grp-s-fiche">Fiches à travailler</label>
      <input type="text" id="grp-s-fiche" maxlength="900" placeholder="S1-R105-04, S1-R105-05">
      <label for="grp-s-note">Note</label>
      <textarea id="grp-s-note" rows="2" maxlength="1000"></textarea>
      <fieldset class="rappels-choix" id="grp-s-rappels">
        <legend>Me rappeler <span class="c-note">(notification, si tu les as activées)</span></legend>
        <label><input type="checkbox" value="15"> 15 min avant</label>
        <label><input type="checkbox" value="60"> 1 h avant</label>
        <label><input type="checkbox" value="1440"> la veille</label>
      </fieldset>
      <input type="hidden" id="grp-s-id">
      <div class="edt-boutons">
        <button class="btn btn-accent" type="submit" id="grp-s-enregistrer">Proposer</button>
        <button class="btn" type="button" id="grp-s-annuler">Annuler</button>
      </div>
    </form>
  </dialog>

  <dialog id="grp-dialogue-signaler" class="edt-dialogue">
    <form method="dialog" id="grp-form-signaler" class="grp-form">
      <div class="sf-tete"><h2>Signaler ce message</h2>
        <button type="button" class="btn btn-icone sf-fermer" aria-label="Fermer" title="Fermer">×</button></div>
      <blockquote class="demande-motif grp-sig-cite" id="grp-sig-cite"></blockquote>
      <fieldset class="grp-p-inviter">
        <legend>Motif</legend>
        <label class="grp-p-radio"><input type="radio" name="grp-sig-motif" value="illicite"> <span>Contenu illicite</span></label>
        <label class="grp-p-radio"><input type="radio" name="grp-sig-motif" value="harcelement"> <span>Harcèlement</span></label>
        <label class="grp-p-radio"><input type="radio" name="grp-sig-motif" value="spam"> <span>Spam</span></label>
        <label class="grp-p-radio"><input type="radio" name="grp-sig-motif" value="autre" checked> <span>Autre</span></label>
      </fieldset>
      <label for="grp-sig-explication">Explique <span class="c-note">(facultatif)</span></label>
      <textarea id="grp-sig-explication" rows="3" maxlength="1000"></textarea>
      <label for="grp-sig-contexte" class="grp-sig-contexte">Contexte transmis : les
        <input type="number" id="grp-sig-contexte" min="0" max="500" step="1" value="50" required>
        messages précédents</label>
      <p class="grp-sig-avertissement">Ton signalement ouvre à l'administrateur du site
         <strong>ce message et les <span id="grp-sig-n">50</span> qui le précèdent</strong>,
         le temps du verdict ; la porte se referme ensuite. Tu verras le verdict ici.</p>
      <div class="edt-boutons">
        <button class="btn btn-accent" type="submit">Signaler</button>
        <button class="btn" type="button" id="grp-sig-annuler">Annuler</button>
      </div>
    </form>
  </dialog>

  <dialog id="grp-dialogue-parametres" class="edt-dialogue">
    <form method="dialog" id="grp-form-parametres" class="grp-form">
      <div class="sf-tete"><h2>Paramètres du groupe</h2>
        <button type="button" class="btn btn-icone sf-fermer" aria-label="Fermer" title="Fermer">×</button></div>
      <label for="grp-p-nom">Nom</label>
      <input type="text" id="grp-p-nom" maxlength="60" minlength="2" required>
      <label for="grp-p-description">Description <span class="c-note">(facultatif)</span></label>
      <textarea id="grp-p-description" rows="2" maxlength="500"></textarea>
      <fieldset class="grp-p-inviter">
        <legend>Qui peut inviter ?</legend>
        <label class="grp-p-radio"><input type="radio" name="grp-p-inviter" value="membres">
          <span><strong>Tous les membres</strong> — chacun crée son lien d'invitation et invite par pseudo.</span></label>
        <label class="grp-p-radio"><input type="radio" name="grp-p-inviter" value="admins">
          <span><strong>Les administrateurs seulement</strong> — les liens des membres cessent de valoir.</span></label>
      </fieldset>
      <div class="edt-boutons">
        <button class="btn btn-accent" type="submit">Enregistrer</button>
        <button class="btn" type="button" id="grp-p-annuler">Annuler</button>
      </div>
    </form>
    <section class="grp-p-fondation" id="grp-p-fondation" hidden>
      <h3>Fondation</h3>
      <p class="c-note">Le fondateur ne peut être ni rétrogradé ni retiré, et lui seul
         supprime le groupe. Transférer la fondation te laisse administrateur,
         nommé par le nouveau fondateur.</p>
      <div class="grp-p-ligne">
        <select id="grp-p-nouveau-fondateur" aria-label="Nouveau fondateur"></select>
        <button class="btn btn-mini" type="button" id="grp-p-transferer">Transférer la fondation</button>
      </div>
      <p><button class="btn btn-mini btn-danger" type="button" id="grp-supprimer">Supprimer le groupe</button></p>
    </section>
  </dialog>
</main>
"""
    return page("Groupe — %s" % TITRE, "../", corps,
                classe_body="compte messagerie", app="groupes", chiffrement=True,
                cible="/groupes/groupe.html", cible_titre="La page d'un groupe",
                fil=fil_ariane([("Accueil", "../index.html"),
                                ("Messages", "index.html"),
                                ("Groupe", None)]))



# --------------------------------------------------------------------------
# Le quiz : la banque de questions et sa démo
# --------------------------------------------------------------------------

QUESTIONS = ROOT / "questions"


def themes_de(cfg: dict) -> list:
    """Les thèmes d'un module : un regroupement de parties, entre le module
    et la fiche. Déclarés dans modules/<CODE>.json (« themes »), facultatifs.
    Chaque thème sort avec ses numéros de partie ET ses identifiants de
    chapitre, pour que le quiz et un outil tiers filtrent sans recalculer.
    Une partie hors de tout thème reste accessible : le thème est un filtre
    de plus, jamais une condition (conception § 6 quater)."""
    par_numero = {p["numero"]: p for p in cfg["parties"]}
    out = []
    for t in cfg.get("themes", []):
        parties = [n for n in t["parties"] if n in par_numero]
        out.append({"nom": t["nom"], "parties": parties,
                    "chapitres": [chapitre_de(cfg, par_numero[n]) for n in parties]})
    return out


def charger_questions(modules: list) -> dict:
    """Toutes les questions du dépôt, avec ce qu'il faut pour les filtrer.

    Renvoie { "modules": [ { code, intitule, fiches: [ { chapitre, numero,
    titre, demo, questions: n } ] } ], "questions": [ ... ] }. Les questions
    sont recopiées telles quelles (verifier_questions.py a déjà contrôlé
    leur forme et leurs cibles) ; on y ajoute « module » et « fiche » pour
    que la page filtre sans analyser la cible.
    """
    toutes, par_fiche = [], {}
    for f in sorted(QUESTIONS.glob("*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        for q in d.get("questions", []):
            q = dict(q)
            q["module"] = d["module"]
            q["fiche"] = q["cible"].split("#")[0]
            toutes.append(q)
            par_fiche[q["fiche"]] = par_fiche.get(q["fiche"], 0) + 1
    liste = []
    for cfg in modules:
        fiches = []
        for p in cfg["parties"]:
            ch = chapitre_de(cfg, p)
            fiches.append({"chapitre": ch, "numero": p["numero"], "titre": p["titre"],
                           "demo": bool(p.get("demo")), "questions": par_fiche.get(ch, 0)})
        liste.append({"code": cfg["code"], "intitule": cfg["intitule"], "accent": cfg["accent"],
                      "themes": themes_de(cfg),
                      "fiches": fiches, "questions": sum(x["questions"] for x in fiches)})
    return {"schema": "quiz-but/v1", "modules": liste, "questions": toutes}


def banque_et_demo(modules: list) -> tuple:
    """La banque entière (sous /fiches/, donc derrière reader_user) et la
    démo publique : les seules questions des fiches ouvertes sans compte —
    un condensé d'une fiche fermée n'a rien à faire dans un fichier public.
    Le nombre total de questions et de fiches est donné à la démo, pour
    dire ce qu'un compte ouvre sans rien en montrer."""
    tout = charger_questions(modules)
    ouvertes = {f["chapitre"] for m in tout["modules"] for f in m["fiches"] if f["demo"]}
    demo = {
        "schema": "quiz-but/v1",
        "demo": True,
        "total": {"questions": len(tout["questions"]),
                  "fiches": len([f for m in tout["modules"] for f in m["fiches"] if f["questions"]])},
        "modules": [dict(m, fiches=[f for f in m["fiches"] if f["chapitre"] in ouvertes],
                         questions=sum(f["questions"] for f in m["fiches"] if f["chapitre"] in ouvertes))
                    for m in tout["modules"]
                    if any(f["chapitre"] in ouvertes for f in m["fiches"])],
        "questions": [q for q in tout["questions"] if q["fiche"] in ouvertes],
    }
    return tout, demo


# Les zones que le middleware garde (functions/_middleware.js, ZONES), sous la
# forme des motifs de _routes.json. Les deux listes doivent se recouvrir :
# une zone absente ici serait servie en statique, SANS passer par la serrure.
# verifier_corpus.py compare les deux.
ZONES_FONCTIONS = [
    "/admin", "/api", "/fiches", "/pdf", "/groupes", "/catalogue.json",
    "/compte", "/demande-acces", "/emploi", "/contacts", "/parametres",
    "/mes-demandes",
]


def routes_fonctions(ouverts: list) -> str:
    """Le fichier _routes.json de Cloudflare Pages : sur quels chemins les
    fonctions s'executent. Sans lui, CHAQUE requete — la feuille de style,
    une image, une page publique, un robot qui tate /wp-admin — passe par le
    middleware et compte dans le quota journalier du plan gratuit (100 000
    par jour). Le 12 septembre 2026, ce quota a ete depasse et le site
    entier est tombe : les fonctions refusaient, et tout passait par elles.

    Ici, seules les zones protegees et l'API passent par les fonctions ; le
    reste est servi directement depuis les fichiers, sans rien compter. Un
    motif est large (/compte, /compte.html et /compte/*) : c'est le
    middleware qui tranche finement, le fichier ne
    fait que dire ou il tourne. Etre trop large ne coute qu'une execution ;
    etre trop etroit servirait une zone privee en clair.

    Ce que le 12 septembre a aussi appris : quand le quota est depasse,
    Cloudflare sert par defaut les fichiers SANS les fonctions (« fail
    open »). Ce jour-la, fiches, catalogue et PDF ont ete servis a
    quiconque. Le reglage du projet doit donc etre « fail closed » (voir
    docs/deploiement.md) : les zones gardees repondent alors une erreur au
    lieu de s'ouvrir, et le public — hors perimetre grace a ce fichier —
    reste servi.

    Les fiches de demonstration sont exclues nommement : le middleware les
    laisserait passer de toute facon, autant ne pas le reveiller. Une
    exclusion l'emporte sur une inclusion. Cloudflare ne compare pas les
    formes longue et courte (/x.html et /x) : on ecrit les deux.

    Ce que cela change pour l'exterieur : les en-tetes CORS ne sont plus
    poses sur les fichiers publics (ils le restent sur /api/). Un outil
    heberge sur un sous-domaine qui voudrait lire apps.json devra passer
    par une route /api/ — aucun ne le fait a ce jour."""
    # Trois formes par zone — la nue, la page (.html) et le dossier — plutot
    # qu'un joker en fin de motif, dont la portee exacte n'est pas garantie
    # par la documentation de Cloudflare. Un fichier nomme (catalogue.json)
    # n'a que sa forme nue.
    inclus = []
    for z in ZONES_FONCTIONS:
        inclus.append(z)
        if "." not in z:
            inclus += [z + ".html", z + "/*"]
    exclus = []
    for c in ouverts:
        if c.endswith(".html"):
            exclus += [c, c[:-len(".html")]]
    return json.dumps({"version": 1, "include": inclus, "exclude": exclus},
                      ensure_ascii=False, indent=2) + "\n"


def page_quiz() -> str:
    """Le quiz : choisir un module et des fiches, répondre, relire la fiche.

    La page est publique : sans l'accès étendu, elle joue la démo (les
    questions des fiches ouvertes, sans mémoire) ; avec, elle charge la
    banque sous /fiches/ et la progression de la personne. C'est la
    réponse du middleware (401 en JSON) qui décide, pas un test de rôle
    dans la page.

    Le registre TYPES_QUESTION, dans le script, dit comment chaque format
    se dessine, se lit et se corrige : ajouter un format = une entrée.

    Une session se met en pause et se reprend plus tard, depuis n'importe
    quel appareil : elle est gardée en base (/api/quiz/session, une par
    personne) à chaque réponse ; le bandeau « Une session en pause » de la
    vue « choisir » propose Reprendre / Recommencer. En démo (sans compte),
    la session ne survit qu'à l'onglet (sessionStorage).
    """
    corps = """
<main class="enveloppe">
  <div class="entete grp-entete">
    <div>
      <div class="e-code">Quiz</div>
      <h1>S'interroger, pas relire</h1>
      <p class="e-st">Des questions écrites depuis les fiches ; chaque réponse
         renvoie à la section qui l'explique, et ce que tu rates revient
         plus tôt.</p>
    </div>
  </div>

  <div class="etat" id="etat" hidden></div>

  <section id="quiz-demo-banniere" class="grp-banniere" hidden>
    <p><strong>Démonstration.</strong> Tu vois les questions des fiches
       ouvertes sans compte, et ta progression n'est pas enregistrée.
       <span id="quiz-demo-total"></span></p>
    <p><a class="btn btn-accent" href="/connexion" id="quiz-demo-creer">Créer un compte</a>
       <a class="btn btn-accent" href="/demande-acces.html" id="quiz-demo-demander" hidden>Demander l'accès</a>
       <a class="btn" href="/demo.html">Lire les fiches de démonstration</a></p>
  </section>

  <!-- 1. choisir -->
  <section id="quiz-choix">
    <div class="grp-banniere quiz-reprise" id="quiz-reprise" hidden>
      <p><strong>Une session en pause</strong> — <span id="quiz-reprise-detail"></span></p>
      <p><button class="btn btn-accent" type="button" id="quiz-reprendre">Reprendre</button>
         <button class="btn" type="button" id="quiz-recommencer">Recommencer</button></p>
    </div>
    <div class="quiz-stats" id="quiz-stats" hidden></div>
    <div class="quiz-form" id="quiz-form">
      <label>Fiches</label>
      <div class="sf-champ quiz-selection">
        <div class="quiz-choisies" id="quiz-choisies"></div>
        <button class="btn btn-petit" type="button" id="quiz-ouvrir-fiches">Choisir les fiches…</button>
      </div>
      <div class="edt-ligne quiz-options">
        <div>
          <label for="quiz-nombre">Combien</label>
          <select id="quiz-nombre">
            <option value="10">10 questions</option>
            <option value="20">20 questions</option>
            <option value="0">toutes</option>
          </select>
        </div>
        <div>
          <label for="quiz-mode">Lesquelles</label>
          <select id="quiz-mode">
            <option value="revoir">à revoir d'abord, puis les nouvelles</option>
            <option value="melange">au hasard</option>
            <option value="ratees">seulement celles que j'ai ratées</option>
          </select>
        </div>
      </div>
      <p><button class="btn btn-accent" type="button" id="quiz-commencer">Commencer</button>
         <span class="c-note" id="quiz-compte"></span></p>
    </div>
  </section>

  <!-- 2. répondre -->
  <section id="quiz-session" hidden>
    <div class="quiz-barre">
      <div class="quiz-progression"><div id="quiz-jauge"></div></div>
      <span class="c-note" id="quiz-position"></span>
      <button class="lien-bouton" type="button" id="quiz-pause">mettre en pause</button>
      <button class="lien-bouton" type="button" id="quiz-quitter">arrêter</button>
    </div>
    <article class="quiz-carte">
      <div class="quiz-cible"><a id="quiz-lien-fiche" href="#"></a><span class="grp-pastille grp-pastille-neutre" id="quiz-niveau"></span></div>
      <pre class="quiz-code" id="quiz-code" hidden></pre>
      <h2 id="quiz-enonce"></h2>
      <div id="quiz-reponse"></div>
      <div class="quiz-verdict" id="quiz-verdict" hidden>
        <div class="quiz-verdict-titre" id="quiz-verdict-titre"></div>
        <p id="quiz-explication"></p>
        <p><a class="btn btn-mini" id="quiz-lien-section" href="#">Relire la section</a></p>
      </div>
      <div class="edt-boutons">
        <button class="btn btn-accent" type="button" id="quiz-valider">Valider</button>
        <button class="btn btn-accent" type="button" id="quiz-suivant" hidden>Suivant</button>
      </div>
    </article>
  </section>

  <!-- 3. le bilan -->
  <section id="quiz-fin" hidden>
    <h2 class="section">Bilan</h2>
    <p id="quiz-score" class="quiz-score"></p>
    <ul class="grp-liste" id="quiz-ratees"></ul>
    <p><button class="btn btn-accent" type="button" id="quiz-refaire" hidden>Refaire les ratées</button>
       <button class="btn" type="button" id="quiz-retour">Choisir d'autres fiches</button></p>
  </section>
</main>
"""
    return page("Quiz — %s" % TITRE, "../", corps,
                classe_body="compte", app="quiz",
                cible="/quiz/", cible_titre="Le quiz",
                fil=fil_ariane([("Accueil", "../index.html"),
                                ("Quiz", None)]))

def sommaire_ancres(corps: str, label: str) -> str:
    """Un sommaire des <h2 class="section"> d'une page longue (U4).

    Les identifiants sont ceux que la page portera : la même fonction
    (`ancre_section`) les calcule ici et là, donc ils s'accordent. Le banc
    vérifie qu'ils désignent tous un élément qui existe — c'est la seule
    garantie qui vaille.
    """
    titres = []
    for m in re.finditer(r'<h2 class="section"[^>]*>(.*?)</h2>', corps, re.DOTALL):
        depose = re.search(r'\bid="([a-z0-9-]{1,120})"', m.group(0))
        titre = _texte_nu(m.group(1))
        if not titre:
            continue
        cle = depose.group(1) if depose else ancre_section(titre)
        if cle:
            titres.append((cle, titre))
    if len(titres) < 4:
        return ""
    liens = "".join('<a href="#%s">%s</a>' % (e(c), e(t)) for c, t in titres)
    return ('<nav class="par-sommaire par-sommaire-long" aria-label="%s">%s</nav>'
            % (e(label), liens))


def page_donnees() -> str:
    """La notice d'information sur les données personnelles.

    Elle est LIBRE d'accès, et ce n'est pas un détail : on ne peut pas demander
    à quelqu'un de consentir à un traitement dont l'explication se trouve
    derrière la porte à laquelle il n'a pas encore accès.

    Son contenu vient du bloc « rgpd » de auth.config.json et de la liste des
    fournisseurs activés : une seule source. Une notice qui décrit autre chose
    que ce qui est réellement fait est pire qu'une notice absente — d'où le
    fait que la liste des services externes soit calculée, et non recopiée.
    """
    r = AUTH.get("rgpd", {})
    contact = e(r.get("contact", ""))

    noms = {"google": "Google", "github": "GitHub", "discord": "Discord",
            "facebook": "Facebook"}
    externes = [noms[k] for k in noms if AUTH.get("fournisseurs", {}).get(k)]
    ligne_externes = ", ".join(externes) if externes else "aucun pour l'instant"

    corps = """
<main class="enveloppe page-texte">
  <div class="entete">
    <div class="e-code">Données personnelles</div>
    <h1>Ce que ce site sait de toi</h1>
    <p class="e-st">Notice du %s</p>
  </div>

  <!--SOMMAIRE-->

  <h2 class="section">En une phrase</h2>
  <p>Créer un compte enregistre <strong>ton adresse de courriel et le pseudo
     que tu choisis</strong>. C'est tout ce qui permet de te reconnaître. Pas
     de nom, pas de suivi, pas de statistiques de lecture, pas de publicité.</p>

  <h2 class="section">Ce qui est enregistré</h2>
  <table>
    <tr><th>Adresse de courriel</th><td>pour te connecter, et pour te
        permettre de récupérer ton mot de passe. <strong>Elle n'est jamais
        affichée aux autres.</strong></td></tr>
    <tr><th>Pseudo</th><td>ton identité publique sur le site : les autres ne
        voient que lui.</td></tr>
    <tr><th>Niveau d'accès</th><td>détermine les parties du site qui te sont
        ouvertes. Il est attribué à la main.</td></tr>
    <tr><th>Dates</th><td>création du compte, dernière connexion, et
        <strong>dernière visite, au jour près</strong> — notée par le site
        au plus une fois par jour quand tu ouvres une page connecté. Pas
        d'heure, pas de pages vues : une date. <strong>L'administrateur voit
        cette dernière activité pour chaque compte</strong> : pour donner un
        accès à quelqu'un qui vient encore, et pour vérifier que la
        suppression après douze mois d'absence s'applique bien.</td></tr>
    <tr><th>Consentement</th><td>la date à laquelle tu as accepté et la
        version de cette notice. C'est ce qui permet de prouver que le
        consentement a bien été recueilli, et pour quoi.</td></tr>
    <tr><th>Si tu passes par un service externe</th><td>l'identifiant que ce
        service nous renvoie. Rien d'autre : ni contacts, ni profil, ni
        publications.</td></tr>
    <tr><th>Si tu utilises le quiz</th><td>pour chaque question : combien
        de fois tu l'as vue et réussie, et quand la revoir. C'est ce qui fait
        revenir plus tôt ce que tu rates. Et, si tu mets une session en
        pause, les questions tirées et tes réponses déjà données, pour la
        reprendre depuis n'importe quel appareil — effacées quand la session
        se termine. Visible par toi seul ; rien n'est
        enregistré en démonstration.</td></tr>
    <tr><th>Si tu demandes quelqu'un en contact</th><td>la demande (qui,
        à qui, quand), sa réponse, et la liste de tes contacts ; visibles
        des deux personnes seulement. Un événement que tu proposes à un
        contact lui est montré (titre, date, type) jusqu'à sa réponse ;
        s'il accepte, il en reçoit une copie qui lui appartient. Tout cela
        part avec ton compte.</td></tr>
    <tr><th>Si tu rejoins un groupe de révision</th><td>ton appartenance,
        ton rôle dans le groupe (et, si tu es administrateur, qui t'a
        nommé), les liens d'invitation que tu crées, ce que tu y écris et
        les séances que tu proposes. Visibles des membres du groupe. <strong>Ce que tu y as
        écrit reste après la suppression de ton compte</strong>, sous
        « compte supprimé » : c'est dit ici et rappelé avant d'écrire.
        L'administrateur du site voit la liste des groupes et leurs
        effectifs — pas les discussions, <strong>sauf sur signalement</strong>
        (ligne suivante) — et chaque consultation est inscrite dans un
        journal.</td></tr>
    <tr id="chiffrement"><th>Si tu écris en privé à un contact</th><td>une
        conversation privée est une discussion à deux, ouverte depuis un
        contact. Dès que vous avez chacun créé vos clés, elle est
        <strong>chiffrée de bout en bout</strong> : les messages sont
        chiffrés dans ton navigateur avec une clé que seuls vous deux avez,
        et la base ne garde que des octets sans sens — ni le site, ni
        Supabase, ni l'administrateur ne peuvent les lire. Ta clé privée vit
        dans ton navigateur, et <strong>n'en sort que si tu choisis une
        sauvegarde</strong> : une copie chiffrée par une <strong>phrase de
        récupération</strong> (douze mots, montrés une fois, que le site ne
        connaît pas), ou par une <strong>passkey</strong> (Face ID,
        empreinte, Windows Hello, une clé physique). Pour une passkey, le
        site garde son identifiant public, une copie chiffrée qu'il ne sait
        pas plus ouvrir, et si ton appareil la dit synchronisée ou non —
        c'est ton appareil qui calcule la clé, et <strong>aucune donnée
        biométrique ne quitte jamais l'appareil</strong> ni n'arrive ici. Un
        appareil peut aussi en ouvrir un autre directement (un code à six
        chiffres et une empreinte à comparer) ; ce transfert ne vit que dix
        minutes. <strong>Sans sauvegarde — ni phrase, ni passkey
        synchronisée —, les messages chiffrés sont perdus</strong> pour toi
        si tu perds cet appareil ou t'y déconnectes, sauf ce qu'un contact
        te rend après t'avoir vérifié ; le site te le rappelle tant que
        c'est le cas. Ce que le site sait quand même : qui parle à
        qui, quand, combien de messages et leur taille, qui a lu jusqu'où,
        qui répond à quel message. Ce que le chiffrement ne protège pas : un
        script servi par le site lui-même — c'est la limite de tout
        chiffrement dans une page web, et on ne promet pas plus. Les messages
        écrits avant que les deux aient leurs clés restent en clair, marqués
        comme tels. Ce que tu écris reste lisible de l'autre après la
        suppression de ton compte (« compte supprimé »). Retirer le contact
        ferme la conversation à l'écriture ; la quitter la fait disparaître
        pour toi. L'administrateur ne voit <strong>pas la liste</strong> des
        conversations privées et n'en lit une que sur signalement (ligne
        suivante) — et, chiffrée, seulement ce que la personne qui signale
        lui transmet.</td></tr>
    <tr><th>Si un message est signalé</th><td>un membre peut signaler un
        message d'un autre (motif, explication). <strong>Le signalement
        ouvre à l'administrateur du site ce message et ceux qui le
        précèdent</strong> — 50 par défaut, la personne qui signale choisit
        le nombre (500 au plus) — <strong>le temps du verdict seulement</strong> :
        il rend un verdict (message retiré, avertissement, ou sans suite),
        et la porte se referme. Chaque ouverture et chaque verdict sont
        inscrits au journal. Si ton message est dans cette fenêtre, il a pu
        être lu par l'administrateur, que tu sois visé ou non. Le
        signalement (qui, quel message, motif, texte, verdict) est visible de
        la personne qui l'a déposé et de l'administrateur, et effacé
        <strong>six mois après le verdict</strong>. <strong>Dans une
        conversation privée chiffrée</strong>, l'administrateur ne peut rien
        lire : c'est <strong>toi qui déchiffres et lui transmets</strong> le
        message signalé et ceux qui le précèdent, en signalant — la fenêtre
        le dit avant l'envoi ; ce contenu transmis est effacé avec le
        signalement.</td></tr>
    <tr><th>Si tu utilises l'emploi du temps</th><td>tes événements et tes
        tâches (titre, dates, détails que tu saisis), et — si tu choisis de
        suivre un lien — <strong>l'adresse de ton calendrier</strong>, qui
        est un accès personnel : le site ne s'en sert que pour relire ton
        calendrier quand tu ouvres la page, ne le montre à personne, et
        l'efface avec le lien ou avec ton compte. Un fichier .ics déposé
        n'est pas conservé : seuls les événements qu'il contient le sont.
        Visible par toi seul.</td></tr>
    <tr><th>Si tu demandes l'accès aux fiches</th><td>le texte que tu écris,
        sa date, la décision et le motif de l'administrateur. Lu par lui
        seul. Gardé avec ton compte, pour que tu puisses relire la réponse,
        et supprimé avec lui.</td></tr>
    <tr><th>Si tu proposes quelque chose au site</th><td>le ⚑ d'une zone,
        ou « Proposer » : le type (corriger, ajouter, un problème, une
        fonctionnalité), ce que tu vises (une fiche, un module, une page,
        ou une zone de l'un des trois — jamais rien d'autre) <em>et son
        intitulé tel qu'il s'affiche</em>, pour que ta proposition reste
        lisible si cette partie du site change, ton texte et ta
        motivation, la date, puis la décision et la note de l'administrateur,
        que tu lis sur ta page Mon compte. Lu par lui seul, sous ton pseudo.
        <strong>Une proposition reste si tu supprimes ton compte</strong>,
        détachée de toi (« compte supprimé ») : c'est un contenu offert au
        site, comme un message de groupe, et la fenêtre le rappelle avant
        d'envoyer. Effacée six mois après avoir été intégrée ou
        refusée.</td></tr>
    <tr id="notifications"><th>Si tu actives les notifications</th><td>ce que
        ton navigateur donne quand tu acceptes : <strong>une adresse chez le
        service de notifications de ton navigateur</strong> (Google pour
        Chrome et Edge, Mozilla pour Firefox, Apple pour Safari) et deux
        clés qui servent à <strong>chiffrer chaque notification pour ce
        navigateur seul</strong> — le service ne transporte qu'un paquet
        qu'il ne peut pas lire. Il sait qu'une notification t'est envoyée,
        et quand ; pas ce qu'elle dit. Une ligne par navigateur, visible de
        toi seul (nom du navigateur, date), effacée quand tu coupes les
        notifications sur cet appareil, quand le service dit que
        l'abonnement n'existe plus, ou avec ton compte. Tes deux choix
        (messages des groupes, rappels) sont enregistrés aussi. Les
        rappels que tu poses sur une séance ou un événement sont dans la
        séance ou l'événement. Tout se règle dans
        <a href="/parametres.html">tes paramètres</a>.</td></tr>
  </table>

  <h2 class="section">Qui d'autre est dans la boucle</h2>
  <table>
    <tr><th>Responsable</th><td>%s, étudiant en BUT Informatique. Site
        personnel, sans lien officiel avec l'IUT d'Orsay ni avec l'Université
        Paris-Saclay.</td></tr>
    <tr><th>Hébergement du site</th><td>%s</td></tr>
    <tr><th>Hébergement des comptes</th><td>%s</td></tr>
    <tr><th>Connexion par un service externe</th><td>%s. Ils n'interviennent
        que si tu choisis ce moyen de connexion.</td></tr>
    <tr><th>Transfert hors Union européenne</th><td>aucun pour les comptes. Un
        service externe de connexion peut, lui, être établi ailleurs : c'est
        ton choix de l'utiliser ou non. Si tu actives les notifications, le
        service de notifications de <em>ton</em> navigateur (Google, Mozilla
        ou Apple selon le navigateur) reçoit des paquets chiffrés pour toi,
        dont il ne lit pas le contenu : là aussi, c'est ton choix, et il se
        défait d'un clic.</td></tr>
  </table>

  <h2 class="section">Combien de temps</h2>
  <p>%s.</p>

  <h2 class="section">Sur quelle base</h2>
  <p>Ton <strong>consentement</strong>, donné en cochant la case au moment de
     créer ton compte. Tu peux le retirer à tout moment en supprimant ton
     compte, sans avoir à te justifier.</p>

  <h2 class="section">Ce qui se passe si tu supprimes ton compte</h2>
  <p>Ton adresse et ton pseudo sont effacés définitivement.
     <strong>Ce que tu as publié et qui sert aux autres reste en ligne, mais
     cesse d'être rattaché à toi</strong> : cela s'affiche « compte supprimé ».
     Ce qui ne servait qu'à toi disparaît : tes réglages, tes inscriptions à
     une séance organisée par quelqu'un d'autre, les groupes dont tu étais le
     seul membre.</p>
  <p>C'est écrit ici, et redit au moment de créer ton compte. Garder un
     contenu après le départ de son auteur n'est loyal que si celui-ci le
     savait en le publiant.</p>

  <h2 class="section">Les cookies</h2>
  <p>Aucun ne sert à te suivre. Tous sont posés par ce site, pour lui seul.</p>
  <table>
    <tr><th><code>fb_session</code></th><td>te garde connecté pendant une
        heure, puis disparaît. Strictement nécessaire : sans lui, il faudrait
        se reconnecter à chaque page.</td></tr>
    <tr><th><code>fb_renouvellement</code></th><td><strong>seulement si tu
        coches « rester connecté »</strong>. Trente jours, prolongés à chaque
        visite ; il permet de rouvrir ta session sans mot de passe. Il
        disparaît quand tu te déconnectes. Ne le demande pas sur un
        ordinateur partagé.</td></tr>
    <tr><th><code>fb_vu</code></th><td>une date, valable un jour : elle évite
        de noter ta visite plus d'une fois par jour. Rien d'autre.</td></tr>
  </table>

  <h2 class="section">Tes droits</h2>
  <p>Depuis <a href="/compte.html">ton espace</a> : consulter ce qui est
     enregistré, changer ton pseudo, emporter tes données dans un fichier, et
     supprimer ton compte. La suppression est immédiate et définitive.</p>
  <p>Si quelque chose ne fonctionne pas, ou si tu préfères passer par un
     humain : <a href="mailto:%s">%s</a>. Je réponds sous un mois au plus tard,
     comme la loi l'exige.</p>
  <p>Tu peux aussi saisir la CNIL si tu estimes que tes droits ne sont pas
     respectés : <a href="https://www.cnil.fr" rel="noopener">cnil.fr</a>.</p>

  <h2 class="section">Ce que le site ne contient pas</h2>
  <p>Aucun support de cours : ni polycopié, ni diaporama, ni enregistrement.
     Aucune publicité, aucune régie, aucune mesure d'audience.</p>
</main>
""" % (e(r.get("version", "")), e(r.get("responsable", "")),
       e(r.get("hebergeur_site", "")), e(r.get("hebergeur_comptes", "")),
       e(ligne_externes), e(r.get("conservation", "")), contact, contact)

    corps = corps.replace("<!--SOMMAIRE-->", sommaire_ancres(corps, "Les sections de la notice"))
    return page("Données personnelles — %s" % TITRE, "", corps,
                cible="/donnees.html", cible_titre="La notice sur les données",
                fil=fil_ariane([("Accueil", "index.html"),
                                ("Données personnelles", None)]))


# Les familles des nouveautes (chantier n° 6) : une couleur et une icone par
# sujet, pour qu'une carte se reconnaisse avant d'etre lue. La famille se
# DEDUIT du lien de l'entree (groupes/ -> messages) : rien a ecrire de plus
# dans les journaux, et rien qui puisse y contredire le lien. Les couleurs
# sont assez sombres pour porter un bouton a texte blanc, dans les deux
# themes. La fenetre de l'arrivee les recoit par nouveautes.json : la table
# n'existe qu'ici.
_SVG = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">%s</svg>')
FAMILLES_NOUV = {
    "messages": ("#2563eb", _SVG % '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
    "prives":   ("#0d9488", _SVG % '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    "reglages": ("#7c3aed", _SVG % '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
    "compte":   ("#7c3aed", _SVG % '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    "fiches":   ("#15803d", ICONES["livret"].replace("<svg ", '<svg aria-hidden="true" ', 1)),
    "quiz":     ("#c2410c", _SVG % '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
    "emploi":   ("#be185d", _SVG % '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
    "contacts": ("#2563eb", _SVG % '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>'),
    "neuf":     ("#b45309", _SVG % '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>'),
}
_FAMILLE_DU_LIEN = {"groupes": "messages", "parametres": "reglages", "mes-demandes": "compte",
                    "compte": "compte", "donnees": "compte", "connexion": "compte",
                    "demande-acces": "compte", "quiz": "quiz", "emploi": "emploi",
                    "contacts": "contacts", "fiches": "fiches"}
_CADENAS = _SVG % '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'


def famille_nouv(c: dict, journal: str) -> str:
    """La famille d'une entree : le corpus, ou le premier segment de son lien."""
    lien = c.get("lien") or ""
    if journal == "fiches":
        return "fiches"
    if "#prives" in lien:
        return "prives"
    return _FAMILLE_DU_LIEN.get(re.split(r"[/.#?]", lien)[0], "neuf")


def avec_familles(journal: dict, nom: str) -> list:
    """Les versions d'un journal public, chaque entree avec sa famille — ce
    que la fenetre de l'arrivee lit dans nouveautes.json."""
    return [dict(v, changements=[dict(c, famille=famille_nouv(c, nom))
                                 for c in v.get("changements") or []])
            for v in journal.get("versions") or []]


def carte_nouv(c: dict, journal: str) -> str:
    """Une nouveaute en carte : l'icone de sa famille, ce qu'on peut faire,
    et un bouton qui y mene."""
    couleur, icone = FAMILLES_NOUV[famille_nouv(c, journal)]
    compte = ('<span class="nv-compte">%savec un compte</span>' % _CADENAS
              if c.get("pour") == "comptes" else "")
    bouton = ('<a class="nv-essayer" href="%s">%s</a>'
              % (e(c["lien"]), "Lire la fiche" if journal == "fiches" else "Essayer")
              if c.get("lien") else "")
    return ('<article class="nv-carte" style="--nv:%s"><div class="nv-icone">%s</div>'
            '<h3>%s</h3><p>%s</p><div class="nv-pied">%s%s</div></article>'
            % (couleur, icone, e(c.get("titre", "")), e(c.get("texte", "")), compte, bouton))


def page_nouveautes() -> str:
    """Le journal des changements du site, version par version (lot J).

    LIBRE d'acces, comme la notice : ce que le site fait de neuf n'a pas a
    se cacher derriere un compte. Les entrees marquees « avec un compte »
    le disent. Le contenu vient de changelog.json et changelog-fiches.json,
    et d'eux seuls — la fenetre de l'arrivee lit les memes, publies en
    nouveautes.json. Le journal de l'administration n'y entre jamais.

    Depuis le chantier n° 6 : la derniere version en grand, en cartes qui
    donnent envie d'essayer ; les plus anciennes repliees, une ligne par date
    avec les icones de ce qu'elles apportent.

    Chaque version reste une zone de proposition (⚑), sous le MEME nom
    qu'avant le chantier, quand elle etait un titre de section
    (« 26-septembre-2026-vos-propositions-integrees ») : une proposition deja
    deposee mene toujours quelque part. Ce nom est aussi l'ancre du bloc.
    """
    pris = set()

    def nom_de_zone(v):
        texte = "%s — %s" % (date_fr(str(v.get("date", ""))), v.get("titre", ""))
        base = ancre_section(texte) or "version"
        cle, n = base, 2
        while cle in pris:
            cle, n = "%s-%d" % (base, n), n + 1
        pris.add(cle)
        return cle, texte

    def blocs_de(journal, nom):
        versions = journal.get("versions") or []
        if not versions:
            return '<p class="c-note">Rien encore.</p>'
        une = versions[0]
        cle, texte = nom_de_zone(une)
        h = ('<section class="nv-une" id="%s"%s><p class="nv-quand">'
             '<span class="nv-pastille">Le plus récent</span>%s</p>'
             '<h2 class="nv-titre-une">%s</h2><div class="nv-cartes">%s</div></section>'
             % (cle, zone(cle, texte), e(date_fr(str(une.get("date", "")))),
                e(une.get("titre", "")),
                "".join(carte_nouv(c, nom) for c in une.get("changements") or [])))
        if len(versions) > 1:
            h += '<h2 class="nv-plus-tot-titre">Plus tôt</h2><div class="nv-plus-tot">'
            for v in versions[1:]:
                chg = v.get("changements") or []
                cle, texte = nom_de_zone(v)
                minis = "".join('<span class="nv-mini" style="--nv:%s">%s</span>'
                                % FAMILLES_NOUV[famille_nouv(c, nom)] for c in chg)
                h += ('<div class="nv-version" id="%s"%s><details><summary>'
                      '<span class="nv-v-date">%s</span><span class="nv-v-titre">%s</span>'
                      '<span class="nv-v-minis">%s</span><span class="nv-v-n">%d nouveauté%s</span>'
                      '</summary><div class="nv-cartes">%s</div></details></div>'
                      % (cle, zone(cle, texte), e(date_fr(str(v.get("date", "")))),
                         e(v.get("titre", "")), minis, len(chg), "s" if len(chg) > 1 else "",
                         "".join(carte_nouv(c, nom) for c in chg)))
            h += "</div>"
        return h

    corps = """
<main class="enveloppe page-texte nouveautes">
  <div class="entete">
    <div class="e-code">Nouveautés</div>
    <h1>Ce qui a changé</h1>
    <p class="e-st">Ce que <strong>le site</strong> sait faire de neuf, et ce
       que <strong>les fiches</strong> ont gagné — le plus récent en tête. Quand
       quelque chose a changé depuis ta dernière visite, une fenêtre te le dit
       à l'arrivée — une fois, puis plus.</p>
  </div>

  <!-- Deux journaux publics, deux ecritures independantes : l'une suit une
       livraison de code, l'autre une integration de sources
       (docs/protocole-sources.md). Un seul endroit pour les lire. Le
       troisieme, celui de l'administration, vit sous /admin : un lien y
       mene, reserve a qui administre, et rien de son contenu n'est ici. -->
  <nav class="admin-onglets" id="nouv-onglets" aria-label="Les deux journaux">
    <button type="button" class="admin-onglet est-actif" data-onglet="site">Le site</button>
    <button type="button" class="admin-onglet" data-onglet="fiches">Les fiches</button>
  </nav>
  <div class="nouv-journal" data-journal="site">%s</div>
  <div class="nouv-journal" data-journal="fiches" hidden>%s</div>
  <p class="c-note nv-vers-admin" data-role-cache="super_user"><a href="admin/changements.html">Ce qui a changé pour l'administration →</a></p>
</main>
""" % (blocs_de(CHANGELOG, "site"), blocs_de(CHANGELOG_FICHES, "fiches"))
    return page("Nouveautés — BUT Info", "", corps,
                cible="/nouveautes.html", cible_titre="Les nouveautés",
                fil=fil_ariane([("Accueil", "index.html"), ("Nouveautés", None)]),
                classe_body="page-nouveautes")


def page_admin_changements(ancres: dict) -> str:
    """Le journal de l'administration (changelog-admin.json, chantier n° 6).

    Sous /admin, zone super_user : c'est la SEULE page ou ses entrees sont
    ecrites. Une entree dit ce qui a change, ce qu'il faut faire (une
    migration a passer, dans quel ordre), et renvoie a la section du
    journal de conception qui donne le detail : ancres (ancres_conception)
    dit dans quelle partie elle vit.
    """
    blocs = []
    for v in CHANGELOG_ADMIN.get("versions") or []:
        entrees = []
        for c in v.get("changements") or []:
            faire = c.get("faire") or []
            bloc_faire = ('<div class="adm-faire"><strong>À faire</strong><ol>%s</ol></div>'
                          % "".join("<li>%s</li>" % e(x) for x in faire)) if faire else ""
            liens = []
            sec = str(c.get("conception", ""))
            if sec:
                liens.append('<a href="docs/%s">Le détail : conception § %s</a>'
                             % (e(ancres.get(sec, JOURNAL + ".html")), e(sec)))
            if c.get("lien"):
                liens.append('<a href="../%s">Ouvrir</a>' % e(c["lien"]))
            entrees.append(
                '<article class="adm-entree%s"><h3>%s</h3><p>%s</p>%s<p class="adm-liens">%s</p></article>'
                % (" adm-a-faire" if faire else "", e(c.get("titre", "")), e(c.get("texte", "")),
                   bloc_faire, " · ".join(liens)))
        blocs.append('<section class="adm-version" id="a-%s"><h2 class="section">%s'
                     '<span class="nouv-titre"> — %s</span></h2>%s</section>'
                     % (e(str(v.get("date", ""))), e(date_fr(str(v.get("date", "")))),
                        e(v.get("titre", "")), "".join(entrees)))
    corps = """
<main class="enveloppe page-texte nouveautes">
  <div class="entete">
    <div class="e-code">Administration</div>
    <h1>Ce qui a changé pour l'administration</h1>
    <p class="e-st">L'outillage, la base, la sécurité — et ce qu'il faut faire
       après une livraison. Les élèves ont leur propre journal, public :
       <a href="../nouveautes.html">les nouveautés</a>. Celui-ci ne sort pas
       de l'administration.</p>
  </div>
  %s
</main>
""" % ("".join(blocs) or '<p class="c-note">Rien encore.</p>')
    return page("Changements — Administration", "../", corps,
                classe_body="compte",
                fil=fil_ariane([("Accueil", "../index.html"),
                                ("Administration", "../admin.html"),
                                ("Changements", None)]))


def page_mes_demandes() -> str:
    """« Mes demandes » : où j'en suis (U3, docs/interface.md).

    Tout ce qui attend une réponse, au même endroit : la demande d'accès aux
    fiches, et les propositions faites au site. Aucune donnée nouvelle — les
    deux existaient et étaient déjà servies ; elles vivaient dans deux pages
    qu'on ne trouvait pas. L'auteur, qui avait commandé les propositions, ne
    les avait pas trouvées : c'était un défaut de navigation.

    La page retient dans le navigateur la dernière réponse vue, pour que la
    pastille s'éteigne (comme « plus tard » des notifications, lot F).
    """
    corps = """
<main class="enveloppe page-texte">
  <div class="entete">
    <div class="e-code">Mes demandes</div>
    <h1>Où j'en suis</h1>
    <p class="e-st">Ce que tu as demandé au site, et ce qu'on en a fait.</p>
  </div>

  <div class="etat" id="etat" hidden></div>

  <section class="par-carte" id="carte-acces">
    <h2 class="section">L'accès aux fiches</h2>
    <div id="dem-acces"><p class="c-note">Chargement…</p></div>
  </section>

  <section class="par-carte" id="carte-propositions">
    <h2 class="section">Mes propositions</h2>
    <p class="c-note">Ce que tu as proposé au site — depuis le ⚑ d'une fiche
       ou d'une zone, ou « Proposer » sur le portail.</p>
    <div id="dem-propositions"><p class="c-note">Chargement…</p></div>
  </section>

  <p class="c-note">Tes données, ton export et la suppression de ton compte
     sont sur <a href="/compte.html">Mon compte</a>.</p>
</main>
"""
    return page("Mes demandes — %s" % TITRE, "", corps,
                classe_body="compte",
                cible="/mes-demandes.html", cible_titre="Mes demandes",
                fil=fil_ariane([("Accueil", "index.html"),
                                ("Mes demandes", None)]))


def page_compte() -> str:
    """L'espace personnel : voir, exporter, supprimer.

    Le RGPD ne demande pas seulement d'informer : il demande que les droits
    soient exercables. Une adresse de contact suffit legalement, mais un
    bouton qui supprime vraiment vaut mieux - c'est la difference entre un
    droit annonce et un droit disponible.

    La page est vide au chargement : tout vient de /api/compte, donc du
    serveur, apres verification de la session.
    """
    corps = """
<main class="enveloppe page-texte">
  <div class="entete">
    <div class="e-code">Mon compte</div>
    <h1>Mes données</h1>
    <p class="e-st">Ce qui est enregistré à ton sujet, et ce que tu peux en
       faire.</p>
  </div>

  <div class="etat" id="etat" hidden></div>

  <table id="compte-table" hidden>
    <tr><th>Pseudo</th><td id="compte-pseudo"></td></tr>
    <tr><th>Adresse</th><td id="compte-adresse"></td></tr>
    <tr><th>Niveau d'accès</th><td id="compte-role"></td></tr>
    <tr><th>Ma demande d'accès</th><td id="compte-demande">…</td></tr>
    <tr><th>Connexion par</th><td id="compte-fournisseur"></td></tr>
    <tr><th>Compte créé le</th><td id="compte-cree"></td></tr>
    <tr><th>Dernière connexion</th><td id="compte-vue"></td></tr>
    <tr><th>Dernière visite notée</th><td id="compte-visite"></td></tr>
    <tr><th>Consentement</th><td id="compte-consentement"></td></tr>
  </table>

  <h2 class="section">Changer de pseudo</h2>
  <p>C'est le seul nom que les autres voient.</p>
  <form id="form-pseudo-compte" class="form-pseudo-compte">
    <input type="text" id="nouveau-pseudo" required minlength="3" maxlength="20"
           spellcheck="false" autocapitalize="off" autocomplete="nickname">
    <button class="btn" type="submit">Enregistrer</button>
  </form>

  <h2 class="section">Services reliés</h2>
  <p>Plusieurs portes mènent au même compte. Quand tu te connectes par Google
     ou GitHub avec l'adresse de ce compte, tu arrives ici — c'est pour cela
     que tu n'as jamais eu à en créer un second. Cette liste dit lesquelles
     sont ouvertes, et te laisse en fermer.</p>
  <div id="identites" class="identites">
    <p class="c-note">Chargement…</p>
  </div>
  <div class="etat" id="etat-identites" hidden></div>

  <h2 class="section">Mes propositions</h2>
  <p>Ce que tu as proposé au site (depuis le ⚑ d'une fiche, ou « Proposer »
     sur le portail), et ce qu'en a fait l'administrateur.</p>
  <div id="mes-propositions" class="mes-propositions">
    <p class="c-note">Chargement…</p>
  </div>

  <h2 class="section">Emporter mes données</h2>
  <p>Un fichier lisible contenant tout ce qui est enregistré à ton sujet.</p>
  <p><button class="btn" type="button" id="exporter">Télécharger</button></p>

  <h2 class="section">Supprimer mon compte</h2>
  <p>Ton adresse est effacée immédiatement et définitivement. Tu es
     déconnecté dans la foulée. Tu pourras revenir quand tu veux : il te
     suffira de te reconnecter, ce qui recréera un compte neuf.</p>
  <p><button class="btn btn-danger" type="button" id="supprimer">
       Supprimer mon compte</button></p>

  <p class="c-note">Le détail de ce qui est collecté, pourquoi et pour
     combien de temps : <a href="/donnees.html">données personnelles</a>.</p>
</main>
"""
    return page("Mon compte — %s" % TITRE, "", corps,
                classe_body="compte",
                cible="/compte.html", cible_titre="Mon compte",
                fil=fil_ariane([("Accueil", "index.html"),
                                ("Mon compte", None)]))


def page_parametres() -> str:
    """Les parametres generaux du site (lot F) : les notifications d'abord,
    le theme ensuite. La page est reservee aux comptes (middleware :
    /parametres exige d'etre connecte) parce que les notifications sont
    rattachees a la personne ; le theme, lui, vit dans ce navigateur.

    Tout ce qui touche aux notifications est peint par le script depuis
    l'etat reel : ce que le navigateur sait faire, ce qu'il a autorise, si
    CET appareil est abonne, combien d'appareils le sont, et les deux choix
    par personne (messages, rappels). Rien n'est suppose.
    """
    corps = """
<main class="enveloppe page-texte">
  <div class="entete">
    <div class="e-code">Paramètres</div>
    <h1>Mes réglages</h1>
    <p class="e-st">Ce que le site a le droit de te dire, et comment il se
       présente sur cet appareil.</p>
  </div>

  <!-- U2 : le sommaire. Trois ancres, et la page voisine. Un lien « #ancre »
       défile et met en lumière (lot A) : rien à écrire de plus. -->
  <nav class="par-sommaire" aria-label="Les réglages">
    <a href="#carte-theme">Thème</a>
    <a href="#carte-notifications">Notifications</a>
    <a href="#carte-chiffrement">Messages chiffrés</a>
    <a class="par-sommaire-voisin" href="/compte.html">Mon compte →</a>
  </nav>

  <div class="etat" id="etat" hidden></div>

  <!-- 1. Le thème : un clic, tout le monde, aucun compte nécessaire. Il
       était le plus loin ; il est le premier. -->
  <section class="par-carte" id="carte-theme">
    <h2 class="section">Thème</h2>
    <p class="par-etat" id="theme-etat">…</p>
    <div class="notif-theme" role="radiogroup" aria-label="Thème">
      <label><input type="radio" name="theme" value=""> Comme le système</label>
      <label><input type="radio" name="theme" value="light"> Clair</label>
      <label><input type="radio" name="theme" value="dark"> Sombre</label>
    </div>
    <p class="c-note">Le choix reste sur cet appareil.</p>
  </section>

  <!-- 2. Les notifications. -->
  <section class="par-carte" id="carte-notifications">
    <h2 class="section">Notifications</h2>

  <div class="notif-bloc" id="notif-bloc">
    <div class="notif-appareil">
      <div>
        <strong>Cet appareil</strong>
        <div class="c-note" id="notif-etat">…</div>
      </div>
      <span class="notif-actions">
        <button class="btn btn-accent" type="button" id="notif-activer" hidden>Activer sur cet appareil</button>
        <button class="btn" type="button" id="notif-couper" hidden>Couper sur cet appareil</button>
      </span>
    </div>
    <p class="c-note" id="notif-ios" hidden>Sur iPhone et iPad, les notifications
       ne marchent que si le site est <strong>ajouté à l'écran d'accueil</strong>
       (Partager → Sur l'écran d'accueil), puis ouvert depuis là.</p>
    <p class="c-note" id="notif-refuse" hidden>Ce navigateur a refusé les
       notifications pour ce site. Pour revenir dessus : l'icône à gauche de
       l'adresse (le cadenas ou les réglages du site) → Notifications →
       Autoriser, puis recharger cette page.</p>

    <fieldset class="notif-choix" id="notif-choix" disabled>
      <legend>Ce que tu veux recevoir <span class="c-note">(sur tous tes appareils)</span></legend>
      <label><input type="checkbox" id="notif-messages" checked> Les messages de mes groupes</label>
      <label><input type="checkbox" id="notif-rappels" checked> Les rappels de séances et d'événements</label>
    </fieldset>
    <p class="c-note" id="notif-appareils"></p>
    <p><button class="lien-bouton" type="button" id="notif-tout-couper" hidden>Retirer tous mes appareils</button></p>
  </div>

    <details class="par-plus">
      <summary>Ce que tu reçois, et ce que le service de notifications voit</summary>
      <p>Une notification par message dans tes groupes, et les rappels que tu
         poses sur une séance ou un événement (« me rappeler une heure
         avant »). Elles arrivent même quand le site est fermé, par le
         service de notifications de ton navigateur — qui ne peut pas les lire :
         elles lui sont remises chiffrées pour ce navigateur seul
         (<a href="/donnees.html#notifications">ce qui en est fait</a>).</p>
    </details>
  </section>

  <!-- 3. Le chiffrement : le plus technique, le plus rare. -->
  <section class="par-carte" id="carte-chiffrement">
    <h2 class="section">Messages privés chiffrés</h2>
  <div class="etat" id="par-chiffre-etat" hidden></div>
  <ul class="par-liste" id="par-chiffre">
    <li><strong>Mes clés</strong> : <span id="par-chiffre-cles">…</span></li>
    <li><strong>Cet appareil</strong> : <span id="par-chiffre-appareil">…</span></li>
    <li><strong>Sauvegardes</strong> : <span id="par-chiffre-sauvegardes">…</span></li>
    <li><strong>Passkeys</strong> : <span id="par-chiffre-passkeys">…</span></li>
  </ul>
  <p class="par-actions">
    <button class="btn btn-mini" type="button" id="par-chiffre-creer" hidden>Créer mes clés</button>
    <button class="btn btn-mini" type="button" id="par-chiffre-passkey-ouvrir" hidden>Ouvrir avec ma passkey</button>
    <button class="btn btn-mini" type="button" id="par-chiffre-recevoir" hidden>Recevoir mes clés ici</button>
    <button class="btn btn-mini" type="button" id="par-chiffre-deverrouiller" hidden>Entrer ma phrase</button>
    <button class="btn btn-mini" type="button" id="par-chiffre-passkey" hidden>Protéger avec cet appareil (passkey)</button>
    <button class="btn btn-mini" type="button" id="par-chiffre-lier" hidden>Ouvrir un autre appareil</button>
    <button class="btn btn-mini" type="button" id="par-chiffre-changer" hidden>Noter une phrase de récupération</button>
    <button class="btn btn-mini" type="button" id="par-chiffre-regenerer" hidden>Régénérer mes clés</button>
    <button class="btn btn-mini" type="button" id="par-chiffre-retirer" hidden>Retirer mes clés de cet appareil</button>
  </p>

    <details class="par-plus">
      <summary>Ce que le chiffrement protège, et comment on déverrouille</summary>
      <p>Tes messages privés sont chiffrés de bout en bout : ni le site, ni la
         base, ni l'administrateur ne peuvent les lire. Ils se déverrouillent sur chaque
         appareil : par une <strong>passkey</strong> (Face ID, empreinte, Windows Hello — un
         geste, rien à taper), depuis un appareil déjà ouvert, ou avec ta <strong>phrase de
         récupération</strong>, douze mots que le site ne connaît pas.
         <a href="/donnees.html#chiffrement">Ce que ça protège, et ce que ça ne protège
         pas</a>.</p>
    </details>
  </section>
</main>
"""
    return page("Paramètres — %s" % TITRE, "", corps,
                classe_body="compte", chiffrement=True,
                cible="/parametres.html", cible_titre="Les paramètres",
                fil=fil_ariane([("Accueil", "index.html"), ("Paramètres", None)]))


def page_admin() -> str:
    """L'administration : attribuer les roles, lire le journal.

    La page est vide au chargement. Tout vient de /api/admin/roles, apres
    verification de la session ET du role par la base elle-meme.

    Elle ne montre AUCUNE adresse de courriel, et pas par oubli : la table des
    profils n'en contient pas. Administrer le site ne demande pas de savoir
    qui est qui dans la vie, seulement de reconnaitre un pseudo. Moins on
    peut voir, moins on peut laisser fuiter.
    """
    lignes_roles = "".join(
        '<tr><th>%s</th><td>%s</td></tr>' % (e(code), e(desc))
        for code, desc in ROLES_DESCRIPTION
    )

    corps = """
<main class="enveloppe page-texte">
  <div class="entete">
    <div class="e-code">Administration</div>
    <h1>Comptes et rôles</h1>
    <p class="e-st">Qui a accès à quoi, et depuis quand.</p>
  </div>

  <div class="etat" id="etat" hidden></div>

  <!-- Trois onglets : chaque section est un ecran a part, pour ne pas
       descendre toute la page a la recherche des demandes. Le script montre
       l'un et cache les autres ; l'onglet Demandes porte le nombre de
       demandes en attente, pour qu'on le voie sans l'ouvrir. -->
  <nav class="admin-onglets" id="admin-onglets" aria-label="Sections de l'administration">
    <button type="button" class="admin-onglet est-actif" data-onglet="comptes">Comptes</button>
    <button type="button" class="admin-onglet" data-onglet="demandes">Demandes <span class="admin-badge" id="badge-demandes" hidden>0</span></button>
    <button type="button" class="admin-onglet" data-onglet="groupes">Groupes <span class="admin-badge" id="badge-signalements" hidden>0</span></button>
    <button type="button" class="admin-onglet" data-onglet="propositions">Propositions <span class="admin-badge" id="badge-propositions" hidden>0</span></button>
    <button type="button" class="admin-onglet" data-onglet="journal">Journal</button>
    <button type="button" class="admin-onglet" data-onglet="documentation">Documentation</button>
  </nav>

  <section class="admin-section" data-section="comptes">
  <h2 class="section">Attribuer un rôle</h2>
  <p>On désigne la personne par son pseudo. Le changement prend effet à sa
     prochaine connexion, ou au plus tard dans une heure.</p>
  <form id="form-role" class="form-role">
    <!-- « list » branche le champ sur les suggestions : le navigateur
         filtre a la frappe, gere les fleches et le tactile. -->
    <input type="text" id="role-pseudo" required minlength="3" maxlength="20"
           spellcheck="false" autocapitalize="off" placeholder="pseudo"
           list="liste-pseudos" autocomplete="off">
    <datalist id="liste-pseudos"></datalist>
    <select id="role-valeur">
      <option value="user">user</option>
      <option value="reader_user">reader_user</option>
      <option value="super_user">super_user</option>
    </select>
    <button class="btn btn-accent" type="submit">Attribuer</button>
  </form>

  <details class="admin-aide">
    <summary>Ce que chaque rôle ouvre</summary>
    <table>%s</table>
  </details>

  <h2 class="section">Les comptes</h2>
  <p>La dernière activité dit si un compte sert encore : la plus récente
     de la dernière connexion et de la dernière visite notée par le site
     (au jour près). C’est la date que regarde la purge (douze mois sans
     activité, et le compte est supprimé). Elle est lue dans la base par
     une fonction réservée aux administrateurs, et la notice de données
     l’annonce.</p>
  <p id="admin-resume" class="c-note"></p>
  <!-- Les filtres vivent HORS de la boite qui defile : dedans, ils
       partaient avec la premiere ligne. -->
  <div class="tableau-entete-filtre">
    <div id="filtres-roles-boutons" class="admin-roles-filtre"></div>
  </div>
  <div class="tableau-large">
    <table id="table-comptes">
      <thead><tr><th class="tri-colonne" data-colonne="pseudo">Pseudo</th><th class="tri-colonne" data-colonne="role">Rôle</th><th class="tri-colonne" data-colonne="cree_le">Inscrit le</th><th class="tri-colonne" data-colonne="derniere_connexion">Dernière activité</th><th></th></tr></thead>
      <tbody></tbody>
    </table>
  </div>


  </section>

  <section class="admin-section" data-section="demandes" hidden>
  <h2 class="section">Demandes d'accès</h2>
  <p>Chaque demande est un texte écrit par une personne : on le lit avant
     de trancher. <strong>Un refus se motive</strong> — le demandeur lira le
     motif sur sa page, et pourra redemander. Une acceptation donne
     l'accès étendu et s'inscrit dans le journal des attributions.</p>
  <p id="demandes-resume" class="c-note"></p>
  <div id="liste-demandes"></div>
  <details class="admin-aide">
    <summary>Décisions déjà rendues</summary>
    <div id="liste-demandes-traitees"></div>
  </details>

  </section>


  <section class="admin-section" data-section="groupes" hidden>
  <h2 class="section">Signalements</h2>
  <p>Un membre a signalé un message d'un autre. <strong>Le signalement
     ouvre, le temps du verdict, ce message et ceux qui le précèdent</strong>
     (le nombre est choisi par la personne qui signale) — rien d'autre du
     groupe. Ouvrir un signalement est inscrit au journal des consultations ;
     le verdict aussi. « Retirer » efface le message pour tout le groupe ;
     « avertissement » et « sans suite » ne touchent à rien. La personne
     qui a signalé lit le verdict (et ta note) dans le groupe. Un signalement
     jugé est effacé six mois après.</p>
  <p id="signalements-note" class="c-note"></p>
  <div id="liste-signalements"></div>
  <details class="admin-aide">
    <summary>Verdicts déjà rendus</summary>
    <div id="liste-signalements-clos"></div>
  </details>

  <h2 class="section">Les groupes de révision</h2>
  <p>La liste et les effectifs — pas les discussions, pas les séances :
     administrer n'en a pas besoin, donc ce n'est pas ouvert (hors
     signalement, ci-dessus). <strong>Chaque
     ouverture de cet onglet est inscrite au journal des consultations</strong>
     (RGPD : c'est un accès à des données d'autrui).</p>
  <p id="groupes-admin-note" class="c-note"></p>
  <div class="tableau-large">
    <table id="table-groupes-admin">
      <thead><tr><th>Groupe</th><th>Créé par</th><th>Le</th><th>Membres</th><th>Séances</th><th>Messages</th><th>Signalements</th></tr></thead>
      <tbody id="liste-groupes-admin"></tbody>
    </table>
  </div>
  </section>

  <section class="admin-section" data-section="propositions" hidden>
  <h2 class="section">Propositions</h2>
  <p>Ce que les comptes proposent : corriger une section, ajouter à une
     fiche, signaler un problème, proposer une fonctionnalité — toujours
     motivé. <strong>Accepter</strong> met de côté pour la prochaine reprise ;
     <strong>Intégrée</strong> dit que c'est fait ; <strong>un refus se
     motive</strong>, l'auteur lit la note sur sa page. « Exporter » écrit un
     fichier texte, groupé par fiche, à coller dans une session Claude pour
     faire la reprise — l'idée de l'agrégateur du site de philosophie, sans
     l'agrégateur.</p>
  <p id="propositions-note" class="c-note"></p>
  <p class="admin-roles">
    <button class="btn btn-mini" type="button" id="propositions-exporter">Exporter (.txt)</button>
    <label class="c-note prop-export-choix"><input type="checkbox" id="propositions-export-acceptees" checked> les acceptées</label>
    <label class="c-note prop-export-choix"><input type="checkbox" id="propositions-export-attente" checked> les en attente</label>
  </p>
  <div id="liste-propositions"></div>
  <details class="admin-aide">
    <summary>Déjà triées</summary>
    <div id="liste-propositions-triees"></div>
  </details>
  </section>

  <section class="admin-section" data-section="journal" hidden>
  <h2 class="section">Journal des attributions</h2>
  <p>Donner un rôle, c'est ouvrir des contenus à quelqu'un. Le RGPD demande
     de pouvoir en rendre compte : voici la trace, dans l'ordre inverse.</p>
  <div class="tableau-large">
    <table id="table-journal">
      <thead><tr><th>Quand</th><th>Qui</th><th>Sur</th><th>Changement</th></tr></thead>
      <tbody></tbody>
    </table>
  </div>
  </section>

  <section class="admin-section" data-section="documentation" hidden>
  <h2 class="section">Ce qui a changé</h2>
  <p>Le journal de l'administration : à chaque livraison, ce qui a changé
     pour qui administre, <strong>ce qu'il faut faire</strong> (une migration
     à passer, dans quel ordre) et la section du journal de conception
     qui donne le détail. Il ne sort pas de l'administration ; les élèves ont
     le leur, public.</p>
  <p><a class="btn btn-accent" href="/admin/changements.html">Ouvrir le journal →</a></p>
  <h2 class="section">La carte</h2>
  <p>Trois vues, toutes tirées du code à chaque construction — donc jamais
     périmées. <strong>Le projet</strong> : les domaines, les modules et leurs
     fonctions, à lire en « Découverte » ou en « Technique ».
     <strong>Le site</strong> : les zones gardées, les routes de
     <code>functions/</code>, les tables et fonctions des migrations, les
     pages. <strong>La frise</strong> : les derniers commits. Chaque nœud dit
     dans quel fichier, et à quelle ligne, il vit.</p>
  <p class="c-note">Les mots de la carte s'écrivent dans
     <code>docs/carte/textes.json</code> ; sa structure, jamais.</p>
  <p><a class="btn btn-accent" href="/admin/carte.html">Ouvrir la carte →</a></p>
  <h2 class="section">Les documents</h2>
  <p>La mémoire du projet, <code>docs/*.md</code>, rendue en pages lisibles
     ici — sans avoir à ouvrir le dépôt. Le fichier fait foi : ce rendu est
     refait à chaque construction.</p>
  %s
  </section>
</main>
""" % (lignes_roles, liste_docs_html(docs_disponibles(), "/"))

    return page("Administration — %s" % TITRE, "", corps,
                classe_body="compte",
                fil=fil_ariane([("Accueil", "index.html"),
                                ("Administration", None)]))


# --------------------------------------------------------------------------
# La documentation, lisible depuis l'administration (lot G)
# --------------------------------------------------------------------------
# Le convertisseur Markdown et l'inventaire de docs/ : documents.py


def page_doc(nom: str, texte: str, docs_connus: set, renvois: dict = None) -> str:
    """Un document de docs/ rendu, avec son sommaire (titres de niveau 2).

    renvois (ancres_conception) : où mène « conception § N »."""
    corps_doc, titres = md_vers_html(texte, docs_connus, renvois)
    titre, _ = resume_doc(texte)
    sommaire = "".join('<li><a href="#%s">%s</a></li>' % (cle, e(t))
                       for niv, t, cle in titres if niv == 2)
    avert = DOCS_AVERTISSEMENTS.get(nom)
    bandeau = ('<p class="grp-sig-avertissement">%s</p>' % e(avert)) if avert else ""
    plan = ('<nav class="plan"><div class="p-t">Sommaire</div><ol>%s</ol></nav>' % sommaire) if sommaire else ""
    corps = """
<main class="enveloppe page-texte doc-page">
  <div class="entete">
    <div class="e-code">Documentation · docs/%s.md</div>
    <h1>%s</h1>
    <p class="e-st">Rendu à la génération du site — le fichier du dépôt fait foi.</p>
  </div>
  %s
  %s
  <article class="doc">
%s
  </article>
</main>
""" % (e(nom), e(titre or nom), bandeau, plan, corps_doc)
    return page("%s — Documentation" % (titre or nom), "../../", corps,
                classe_body="compte",
                fil=fil_ariane([("Accueil", "../../index.html"),
                                ("Administration", "../../admin.html"),
                                ("Documentation", "index.html"),
                                (nom, None)]))


def liste_docs_html(docs: list, racine: str) -> str:
    """La liste des documents : la doctrine d'abord, les archives ensuite."""
    def ligne(nom, texte):
        titre, para = resume_doc(texte)
        avert = DOCS_AVERTISSEMENTS.get(nom)
        chemin = "docs/archives/%s.md" % nom if est_archive(nom) else "docs/%s.md" % nom
        return ('<li><a href="%sadmin/docs/%s.html"><strong>%s</strong></a> '
                '<span class="c-note">%s%s</span><br>%s</li>'
                % (e(racine), e(nom), e(titre or nom), e(chemin),
                   ' · <strong>périmé</strong>' if avert else "",
                   e(para[:220] + ("…" if len(para) > 220 else ""))))

    # Les parties du journal de conception se rangent sous son sommaire
    parties = "".join(ligne(n, t) for n, t in docs if est_partie_journal(n))
    vivants = []
    for n, t in docs:
        if est_archive(n) or est_partie_journal(n):
            continue
        li = ligne(n, t)
        if n == JOURNAL and parties:
            li = li[:-len("</li>")] + '<ul class="doc-liste">%s</ul></li>' % parties
        vivants.append(li)
    archives = [ligne(n, t) for n, t in docs if est_archive(n)]
    html = '<ul class="doc-liste">%s</ul>' % "".join(vivants)
    if archives:
        html += ('<h2 class="doc-archives">Archives</h2>'
                 '<p class="c-note">Des écrits datés — une lettre envoyée, un dossier '
                 'préparé. Ils se lisent encore ; ils ne se mettent plus à jour.</p>'
                 '<ul class="doc-liste">%s</ul>' % "".join(archives))
    return html


def page_docs_index(docs: list) -> str:
    """L'index de la documentation : les documents du projet, et le chemin vers sa carte."""
    corps = """
<main class="enveloppe page-texte">
  <div class="entete">
    <div class="e-code">Documentation</div>
    <h1>Les documents du projet</h1>
    <p class="e-st">docs/*.md, rendus à la génération du site ; et la carte, tirée du code.</p>
  </div>
  <p><a class="btn btn-accent" href="../carte.html">La carte du projet →</a></p>
  %s
</main>
""" % liste_docs_html(docs, "../../")
    return page("Documentation — %s" % TITRE, "../../", corps,
                classe_body="compte",
                fil=fil_ariane([("Accueil", "../../index.html"),
                                ("Administration", "../../admin.html"),
                                ("Documentation", None)]))


# --------------------------------------------------------------------------
# La carte du site, générée depuis le code (lot G)
# --------------------------------------------------------------------------
# L'extraction (zones, routes, base, pages) : carte_site.py. Ici, son rendu.

DEPOT_GITHUB = "https://github.com/Orangetleman/portail-but-info-showroom/blob/main/"


def _ref_depot(ref: str) -> str:
    """« build_site.py:3091 » → un lien vers la ligne, dans le dépôt."""
    if not ref:
        return ""
    fichier, _, ligne = ref.rpartition(":")
    if not fichier or not ligne.isdigit():
        return ('<a class="carte-ref" href="%s%s" target="_blank" rel="noopener">%s</a>'
                % (DEPOT_GITHUB, e(ref), e(ref)))
    return ('<a class="carte-ref" href="%s%s#L%s" target="_blank" rel="noopener">%s</a>'
            % (DEPOT_GITHUB, e(fichier), e(ligne), e(ref)))


def arbre_carte(c: dict) -> str:
    """L'arbre de la carte du projet, du domaine à la variable.

    Un <details> par nœud qui a des enfants : replier et déplier ne demande
    aucun script, et fonctionne au clavier. Les domaines sont ouverts, le
    reste est fermé — sinon la page s'ouvre sur quatre cents lignes.

    Chaque nœud porte son domaine et son genre en attribut : c'est sur eux que
    les filtres travaillent, sans avoir à reconstruire l'arbre.
    """
    enfants = {}
    for n in c["noeuds"]:
        enfants.setdefault(n["parent"], []).append(n)
    couleurs = {d["id"]: d["couleur"] for d in c["domaines"]}
    genres = c.get("genres") or {}

    def bloc(n):
        fils = enfants.get(n["id"]) or []
        tete = (
            '<span class="ca-pastille" style="background:%s"></span>'
            '<span class="ca-label">%s</span>'
            '<span class="ca-genre">%s</span>%s'
            % (e(couleurs.get(n["domaine"], "#888")), e(n["label"]),
               e(genres.get(n["genre"], n["genre"])), _ref_depot(n.get("ref"))))
        mots = ""
        if n.get("novice"):
            mots += '<p class="ca-novice">%s</p>' % e(n["novice"])
        if n.get("ingenieur"):
            mots += '<p class="ca-ing">%s</p>' % e(n["ingenieur"])
        if not mots and n["niveau"] <= 2:
            mots = '<p class="ca-manque">Pas encore décrit.</p>'
        attrs = ('class="ca-n" data-id="%s" data-domaine="%s" data-genre="%s" data-niveau="%d"'
                 % (e(n["id"]), e(n["domaine"]), e(n["genre"]), n["niveau"]))
        if not fils:
            return ('<div %s><div class="ca-t">%s</div>%s</div>'
                    % (attrs, tete, mots))
        return ('<details %s%s><summary class="ca-t">%s</summary>%s<div class="ca-fils">%s</div></details>'
                % (attrs, " open" if n["niveau"] == 0 else "", tete, mots,
                   "".join(bloc(f) for f in fils)))

    return "".join(bloc(n) for n in c["noeuds"] if n["niveau"] == 0)


def frise_html(commits: list) -> str:
    """La frise des commits : ce que le projet a fait, dans l'ordre du temps.

    Lue depuis git à la construction. Sans git, la liste est vide et la page
    le dit — elle ne ment pas en affichant une frise périmée.
    """
    if not commits:
        return ('<p class="c-note">Pas d\'historique ici : la frise est lue depuis '
                'git à la construction du site.</p>')
    jours = []
    for c in commits:
        if not jours or jours[-1][0] != c["date"]:
            jours.append((c["date"], []))
        jours[-1][1].append(c)
    out = []
    for date, lot in jours:
        out.append('<li class="fr-jour"><span class="fr-date">%s</span><ul class="fr-lot">%s</ul></li>'
                   % (e(date_fr(date)),
                      "".join('<li><a class="carte-ref" href="%scommit/%s" target="_blank" '
                              'rel="noopener">%s</a> %s</li>'
                              % (DEPOT_GITHUB.replace("blob/main/", ""), e(c["sha"]),
                                 e(c["sha"]), e(c["titre"]))
                              for c in lot)))
    return '<ul class="frise">%s</ul>' % "".join(out)


def page_carte(carte: dict, projet: dict, commits: list) -> str:
    """La carte, en trois onglets : le projet, le site, la frise.

    « Le projet » vient de carte.py : la structure est extraite du code, les
    mots sont écrits dans docs/carte/textes.json. « Le site » est la carte des
    adresses, celle des zones gardées et des routes. « La frise » est git.
    """
    def gh(fichier, ligne):
        return '<a class="carte-ref" href="%s%s#L%d" target="_blank" rel="noopener">%s:%d</a>' % (
            DEPOT_GITHUB, e(fichier), ligne, e(fichier), ligne)
    def chips(liste, classe, prefixe=""):
        return " ".join('<a class="carte-chip %s" href="#%s%s">%s</a>' % (classe, prefixe, e(x), e(x)) for x in liste)

    zones = "".join(
        '<tr id="zone-%s"><td><code>%s</code></td><td>%s</td><td>%s</td><td>%s</td></tr>'
        % (e(ancre_section(z["prefixe"])), e(z["prefixe"]), e(z["exige"]),
           chips(z["routes"], "carte-chip-route", "route-") or '<span class="c-note">pages statiques</span>',
           gh(z["fichier"], z["ligne"]))
        for z in carte["zones"])

    def ligne_route(r):
        appels = chips(r["rpc"], "carte-chip-sql", "sql-") + " " + " ".join(
            '<a class="carte-chip carte-chip-table" href="#table-%s">%s</a>' % (e(t), e(t)) for t in r["tables"])
        if r["inconnus"]:
            appels += ' <span class="carte-inconnu" title="appelé par la route, introuvable dans supabase/">? %s</span>' % e(", ".join(r["inconnus"]))
        return ('<tr id="route-%s"><td><code>%s</code><br><span class="c-note">%s</span></td>'
                '<td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>'
                % (e(r["adresse"]), e(r["adresse"]), e(r["titre"]), e(" ".join(r["methodes"])),
                   ('<code>%s</code>' % e(r["zone"])) if r["zone"] else '<strong class="carte-public">public</strong>',
                   appels or "—", gh(r["fichier"], r["ligne"])))
    routes = "".join(ligne_route(r) for r in carte["routes"])

    def bloc_migration(m):
        def liste(items, classe, prefixe):
            return " ".join('<span class="carte-chip %s" id="%s%s">%s <span class="c-note">%s</span></span>'
                            % (classe, prefixe, e(x[0]), e(x[0]), gh(m["fichier"], x[-1])) for x in items)
        parties = []
        if m["tables"]: parties.append("<dt>Tables</dt><dd>%s</dd>" % liste(m["tables"], "carte-chip-table", "table-"))
        if m["colonnes"]: parties.append("<dt>Colonnes ajoutées</dt><dd>%s</dd>" % liste(m["colonnes"], "carte-chip-table", "col-"))
        if m["fonctions"]: parties.append("<dt>Fonctions</dt><dd>%s</dd>" % liste(m["fonctions"], "carte-chip-sql", "sql-"))
        if m["regles"]: parties.append("<dt>Règles d'accès</dt><dd>%s</dd>" % " ".join(
            '<span class="carte-chip carte-chip-regle">%s <span class="c-note">sur %s · %s</span></span>' % (e(n), e(t), gh(m["fichier"], l)) for n, t, l in m["regles"]))
        if m["declencheurs"]: parties.append("<dt>Déclencheurs</dt><dd>%s</dd>" % liste(m["declencheurs"], "carte-chip-regle", "trg-"))
        return ('<section class="carte-migration" id="mig-%s"><h3><code>%s</code> <span class="c-note">%s</span></h3>'
                '<p class="c-note">%s</p><dl>%s</dl></section>'
                % (e(m["nom"]), e(m["fichier"]), gh(m["fichier"], 1), e(m["titre"]), "".join(parties)))
    base = "".join(bloc_migration(m) for m in carte["base"])

    pages = "".join('<tr><td><code>%s</code></td><td>%s</td><td>%s</td></tr>'
                    % (e(p["fonction"]), e(p["titre"]), gh(p["fichier"], p["ligne"])) for p in carte["pages"])
    docs = "".join('<li><a href="docs/%s.html">%s</a> <span class="c-note">%s</span></li>'
                   % (e(d["nom"]), e(d["titre"] or d["nom"]), e(d["fichier"])) for d in carte["documents"])
    n_fn = sum(len(m["fonctions"]) for m in carte["base"])
    n_tables = sum(len(m["tables"]) for m in carte["base"])
    n_regles = sum(len(m["regles"]) for m in carte["base"])

    domaines = "".join(
        '<button type="button" class="ca-dom est-actif" data-dom="%s">'
        '<span class="ca-pastille" style="background:%s"></span>%s</button>'
        % (e(d["id"]), e(d["couleur"]), e(d["label"])) for d in projet["domaines"])
    manquants = len(projet.get("sans_texte") or [])

    corps = """
<main class="enveloppe page-texte doc-page carte-site">
  <div class="entete">
    <div class="e-code">Documentation · la carte</div>
    <h1>La carte du projet</h1>
    <p class="e-st">Ce que ce dépôt contient, du domaine jusqu'à la fonction.
       La <strong>structure est extraite du code</strong> à chaque
       construction — elle ne peut donc pas être périmée ; les
       <strong>mots</strong> sont écrits à la main dans
       <code>docs/carte/textes.json</code>.</p>
  </div>

  <nav class="admin-onglets" id="carte-onglets" aria-label="Les trois cartes">
    <button type="button" class="admin-onglet est-actif" data-onglet="projet">Le projet</button>
    <button type="button" class="admin-onglet" data-onglet="site">Le site</button>
    <button type="button" class="admin-onglet" data-onglet="frise">La frise</button>
  </nav>

  <section class="ca-vue" data-carte="projet">
    <div class="ca-barre">
      <input type="search" id="ca-chercher" class="carte-filtre" placeholder="Chercher un domaine, un module, une fonction…" autocomplete="off" aria-label="Chercher dans la carte">
      <div class="ca-lecture" role="group" aria-label="Niveau de lecture">
        <button type="button" class="ca-mode est-actif" data-mode="novice">Découverte</button>
        <button type="button" class="ca-mode" data-mode="ingenieur">Technique</button>
      </div>
      <div class="ca-outils">
        <button type="button" class="btn btn-mince" id="ca-deplier">Tout déplier</button>
        <button type="button" class="btn btn-mince" id="ca-replier">Tout replier</button>
      </div>
    </div>
    <div class="ca-dispo" id="ca-dispo" role="group" aria-label="Disposition de la carte">
      <button type="button" class="ca-vueb est-actif" data-vue="arbre" aria-pressed="true">Arbre</button>
      <button type="button" class="ca-vueb" data-vue="graphe" aria-pressed="false">Graphe</button>
      <button type="button" class="ca-vueb" data-vue="radial" aria-pressed="false">Radial</button>
    </div>
    <div class="ca-domaines" id="ca-domaines" aria-label="Filtrer par domaine">%s</div>
    <p class="c-note ca-aide">%d nœuds, relus le %s. Un nœud se déplie d'un clic ;
       sa référence mène à la ligne exacte dans le dépôt. <strong>Découverte</strong>
       explique sans jargon, <strong>Technique</strong> donne le détail — pour une
       fonction Python, la première ligne de sa docstring.%s</p>
    <p class="c-note ca-aide">Trois façons de regarder le même arbre :
       l'<strong>arbre</strong> se lit et s'imprime, le <strong>graphe</strong>
       montre les niveaux côte à côte, le <strong>radial</strong> montre la part
       de chaque domaine. Replier une branche dans l'une la replie dans les
       autres : l'état est commun. Sur les deux dessins, on se déplace en
       tirant, on grossit à la molette ou à deux doigts.</p>
    <div class="ca-arbre" id="ca-arbre">%s</div>
    <div class="ca-toile" id="ca-toile" hidden>
      <div class="ca-zoom">
        <button type="button" class="btn btn-mince" id="ca-zplus" aria-label="Agrandir">+</button>
        <button type="button" class="btn btn-mince" id="ca-zmoins" aria-label="Réduire">−</button>
        <button type="button" class="btn btn-mince" id="ca-cadrer">Recadrer</button>
      </div>
      <svg id="ca-svg" viewBox="0 0 1200 800" role="img"
           aria-label="La carte dessinée. L'arbre, à côté, donne le même contenu en texte."></svg>
    </div>
    <div class="ca-detail" id="ca-detail" hidden></div>
    <p class="c-note" id="ca-rien" hidden>Rien ne porte ce nom.</p>
  </section>

  <section class="ca-vue" data-carte="frise" hidden>
    <p class="c-note">Les cent vingt derniers commits, du plus récent au plus
       ancien, lus depuis git à la construction.</p>
    %s
  </section>

  <section class="ca-vue" data-carte="site" hidden>
  <p class="e-st">Générée le %s depuis le code — %d zones gardées, %d routes,
     %d migrations (%d tables, %d fonctions, %d règles d'accès), %d gabarits de page.</p>
  <p><input type="search" id="carte-filtre" class="carte-filtre" placeholder="Filtrer : un nom de route, de table, de fonction…" autocomplete="off" aria-label="Filtrer la carte"></p>
  <p class="c-note">Comment lire : une <strong>zone</strong> est un préfixe que
     <code>functions/_middleware.js</code> garde derrière un rôle ; une
     <strong>route</strong> est un fichier de <code>functions/api/</code>, sans pouvoir
     propre — elle transmet le jeton à la base, qui décide ; ce qu'elle appelle
     (<span class="carte-chip carte-chip-sql">fonction SQL</span>,
     <span class="carte-chip carte-chip-table">table</span>) vit dans une
     <strong>migration</strong> de <code>supabase/</code>, qui porte les
     <span class="carte-chip carte-chip-regle">règles d'accès</span>. Les pages sont
     écrites par <code>build_site.py</code>. Voir <a href="docs/conception.html">le journal de conception</a>
     et <a href="docs/deploiement.html">le déploiement</a>.</p>

  <h2 class="section" id="zones">Les zones gardées</h2>
  <div class="table-scroll"><table class="carte-table">
    <thead><tr><th>Préfixe</th><th>Exige</th><th>Routes dessous</th><th>Où</th></tr></thead>
    <tbody>%s</tbody></table></div>
  <p class="c-note">Routes hors de toute zone (publiques, ou gardées autrement — par un secret partagé) :
     %s.</p>

  <h2 class="section" id="routes">Les routes</h2>
  <div class="table-scroll"><table class="carte-table">
    <thead><tr><th>Adresse</th><th>Méthodes</th><th>Zone</th><th>Appelle</th><th>Où</th></tr></thead>
    <tbody>%s</tbody></table></div>

  <h2 class="section" id="base">La base : les migrations</h2>
  <p class="c-note">Dans l'ordre alphabétique des fichiers ; l'ordre de passage est écrit en tête de chacun.</p>
  %s

  <h2 class="section" id="pages">Les gabarits de page</h2>
  <div class="table-scroll"><table class="carte-table">
    <thead><tr><th>Fonction</th><th>Ce qu'elle écrit</th><th>Où</th></tr></thead>
    <tbody>%s</tbody></table></div>

  <h2 class="section" id="documents">Les documents</h2>
  <ul class="doc-liste">%s</ul>
  </section>
</main>
""" % (domaines, len(projet["noeuds"]), e(date_fr(projet["genere_le"])),
       (" <strong>%d</strong> domaine(s) ou module(s) attendent encore leurs mots." % manquants) if manquants else "",
       arbre_carte(projet), frise_html(commits),
       e(carte["genere_le"]), len(carte["zones"]), len(carte["routes"]), len(carte["base"]),
       n_tables, n_fn, n_regles, len(carte["pages"]),
       zones, ", ".join("<code>%s</code>" % e(a) for a in carte["publiques"]) or "aucune",
       routes, base, pages, docs)
    return page("La carte — %s" % TITRE, "../", corps,
                classe_body="compte", carte=True,
                fil=fil_ariane([("Accueil", "../index.html"),
                                ("Administration", "../admin.html"),
                                ("Documentation", "docs/index.html"),
                                ("Carte", None)]))


def config_js() -> str:
    """Les réglages que le navigateur a besoin de connaître.

    Uniquement des valeurs publiques : l'URL du projet et la clé « anon »,
    qui est faite pour vivre dans une page web.
    """
    public = {
        "supabaseUrl": AUTH.get("supabase_url", ""),
        "supabaseAnonKey": AUTH.get("supabase_anon_key", ""),
        "sitePublic": bool(AUTH.get("site_public", True)),
        "authentification": bool(AUTH.get("supabase_url")),
        "fournisseurs": AUTH.get("fournisseurs", {}),
        "domainesBloques": AUTH.get("domaines_bloques", {}),
        # La version de la notice est enregistree avec le consentement : elle
        # permet de savoir qui a accepte quoi, et de redemander si la notice
        # change de facon substantielle.
        "rgpdVersion": AUTH.get("rgpd", {}).get("version", ""),
        "contact": AUTH.get("rgpd", {}).get("contact", ""),
    }
    return ("/* Réglages publics — GÉNÉRÉ par build_site.py depuis auth.config.json. */\n"
            "window.CONFIG = %s;\n" % json.dumps(public, ensure_ascii=False))


def apps_js() -> str:
    """Le registre des outils, mis à disposition du navigateur.

    Comme l'index de recherche : un <script src> plutôt qu'un fetch(), pour
    que le site reste utilisable ouvert par double-clic, où fetch est bloqué.
    """
    return ("/* Registre des outils — GÉNÉRÉ par build_site.py depuis apps.json. */\n"
            "window.APPS = %s;\n"
            % json.dumps({"apps": APPS.get("apps", [])}, ensure_ascii=False))


def service_worker_js() -> str:
    """Le service worker : recevoir une notification, l'afficher, ouvrir la
    page au clic. Rien d'autre — pas de cache, pas d'interception : un
    fichier qu'on peut lire en entier avant de lui confier l'affichage
    des notifications.

    Il vit a la racine (site/sw.js) parce qu'un service worker ne voit que
    ce qui est sous son chemin, et qu'il doit pouvoir ouvrir un groupe
    comme l'emploi du temps. La racine est publique : le middleware ne
    tourne pas pour lui (site/_routes.json), il ne coute rien.

    La charge d'un push est le JSON que l'expediteur (functions/_push.js)
    a chiffre pour ce navigateur : { titre, corps, url, tag }. Le service
    de push ne l'a jamais lu.
    """
    return r"""/* ==========================================================================
   Le service worker de exemple.fr — GENERE par build_site.py
   ==========================================================================
   Trois evenements, rien de plus :
     push                   : afficher la notification recue ;
     notificationclick      : ouvrir (ou ramener) la page qu'elle designe ;
     pushsubscriptionchange : le navigateur a change l'abonnement de
                              lui-meme, on redonne le nouveau au site.
   Pas de cache, pas d'interception de requete : la page se charge exactement
   comme sans lui. */

self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; }
  catch (err) { d = { corps: e.data ? e.data.text() : "" }; }
  if (!d || typeof d !== "object") d = {};
  var titre = String(d.titre || "Fiches BUT");
  var options = {
    body: String(d.corps || ""),
    icon: "/assets/favicon.png",
    badge: "/assets/favicon.png",
    /* un tag par conversation : la nouvelle remplace l'ancienne au lieu
       d'empiler dix bulles pour dix messages */
    tag: d.tag ? String(d.tag) : undefined,
    renotify: !!d.tag,
    data: { url: String(d.url || "/") },
    timestamp: d.quand ? new Date(d.quand).getTime() : Date.now(),
  };
  /* et le dire a chaque onglet du site deja ouvert : la pastille « Messages »
     et la liste des conversations se mettent a jour sans actualiser */
  var prevenir = self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (fenetres) {
    fenetres.forEach(function (f) { f.postMessage({ type: "push", tag: options.tag || null, url: options.data.url }); });
  }).catch(function () {});
  e.waitUntil(Promise.all([self.registration.showNotification(titre, options), prevenir]));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var cible = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin);
  /* n'ouvrir que chez nous : une charge qui dirait « http://ailleurs »
     ramenerait a l'accueil */
  if (cible.origin !== self.location.origin) cible = new URL("/", self.location.origin);
  var sans = function (u) { return String(u).split("#")[0]; };
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (fenetres) {
    for (var i = 0; i < fenetres.length; i++) {
      if (sans(fenetres[i].url) === sans(cible.href) && "focus" in fenetres[i]) {
        return fenetres[i].focus();
      }
    }
    for (var j = 0; j < fenetres.length; j++) {
      if ("navigate" in fenetres[j] && "focus" in fenetres[j]) {
        return fenetres[j].navigate(cible.href).then(function (f) { return f && f.focus(); });
      }
    }
    return self.clients.openWindow(cible.href);
  }));
});

self.addEventListener("pushsubscriptionchange", function (e) {
  var ancien = e.oldSubscription;
  var options = ancien && ancien.options ? ancien.options : null;
  if (!options || !options.applicationServerKey) return;
  e.waitUntil(self.registration.pushManager.subscribe({
    userVisibleOnly: true, applicationServerKey: options.applicationServerKey,
  }).then(function (sub) {
    var j = sub.toJSON();
    return fetch("/api/push/abonnement", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
                             ancien: ancien ? ancien.endpoint : null }),
    });
  }).catch(function () { /* on reessaiera a la prochaine page ouverte */ }));
});
"""


# --------------------------------------------------------------------------
# Sorties annexes
# --------------------------------------------------------------------------

def chapitre_de(cfg: dict, partie: dict) -> str:
    """L'identifiant de chapitre d'une fiche : « S1-R103-04 ».

    Lu dans modules/<CODE>.json quand il y figure, calcule sinon. La forme est
    entierement determinee par le semestre, le module et le numero : un
    identifiant absent de la source n'est donc pas une raison pour qu'un outil
    voisin ne puisse pas designer cette fiche. L'ecrire dans le JSON sert a le
    FIGER — a le garder stable si un jour la fiche est renumerotee.
    """
    return partie.get("chapitre") or ("S%d-%s-%02d"
        % (cfg.get("semestre", 1), cfg["code"], partie["numero"]))


def sections_de(cfg: dict, partie: dict) -> list:
    """Les sections d'une fiche, avec leur identifiant complet.

    « S1-R103-04#organisation-physique-de-la-ram » : de quoi dire « reviser
    ceci » et non « reviser cette fiche ». Les sections sont deposees sur la
    partie par page_fiche(), qui seule lit les fragments ; la liste est donc
    vide si les pages n'ont pas ete generees.
    """
    ch = chapitre_de(cfg, partie)
    return [{"id": "%s#%s" % (ch, cle), "titre": titre, "ancre": cle}
            for _rang, _roman, titre, cle in partie.get("sections", [])]


def chemins_demo(modules: list) -> list:
    """Les chemins que le middleware laisse passer sans compte.

    Une fiche marquee « demo » dans modules/<CODE>.json est publique : son
    contenu est sourcé publiquement, elle sert de vitrine. Sa PAGE, et rien
    d'autre : son PDF reste ferme. Tout le reste de /fiches et /pdf l'est aussi — en particulier l'index de recherche et le
    catalogue, qui decrivent le corpus ENTIER et n'ont donc rien a faire ici.
    """
    chemins = []
    for cfg in modules:
        s = cfg.get("semestre", 1)
        for p in cfg["parties"]:
            if not p.get("demo"):
                continue
            # La PAGE seulement. Le PDF d'une fiche de demonstration reste
            # ferme : c'est un fichier qui circule, qu'on ne peut plus
            # rappeler une fois telecharge, et la vitrine n'a pas besoin de
            # ca pour montrer ce que vaut une fiche.
            chemins.append("/%s/s%d/%s/%02d.html"
                           % (PREFIXE_FICHES, s, cfg["code"], p["numero"]))
    return chemins


def module_fournisseurs() -> str:
    """Les fournisseurs externes activés, pour /api/identites.

    Le registre est auth.config.json, et lui seul. Une seconde liste tenue à
    la main dans la fonction finirait par proposer de relier un service
    désactivé — c'est exactement ce qui est arrivé avec Facebook.

    Le mot de passe et le lien par courriel n'y figurent pas : ce ne sont pas
    des services à relier, ce sont deux façons de se servir de son adresse.
    Supabase les compte d'ailleurs comme une seule identité, « email ».
    """
    actifs = [nom for nom in ("google", "github", "discord", "facebook")
              if AUTH.get("fournisseurs", {}).get(nom)]
    return (u"/* Fournisseurs externes activés — GÉNÉRÉ par build_site.py.\n"
            u"   La source est auth.config.json : ne pas éditer ici. */\n"
            u"export const FOURNISSEURS = %s;\n"
            % json.dumps(actifs, ensure_ascii=False))


def module_notice() -> str:
    """La version de la notice, pour les fonctions (/api/moi, /api/consentement).
    Generee depuis auth.config.json, comme config.js : une seule source."""
    return ('/* Version de la notice de données — GÉNÉRÉ par build_site.py depuis\n'
            '   auth.config.json (rgpd.version), ne pas éditer. */\n'
            'export const VERSION_NOTICE = %s;\n'
            % json.dumps(AUTH.get("rgpd", {}).get("version", ""), ensure_ascii=False))


def module_demo(chemins: list) -> str:
    """Le fichier que le middleware importe. Genere, jamais edite a la main.

    Une liste tenue a la main finirait par designer une fiche disparue, ou par
    laisser fermee une fiche qu'on croyait ouverte.
    """
    return ('''/* Chemins publics — GÉNÉRÉ par build_site.py, ne pas éditer.
   Les fiches marquées « demo » dans modules/<CODE>.json, et leurs PDF.
   Liste vide = rien d'ouvert, ce qui est le bon défaut. */
export const CHEMINS_DEMO = %s;
''' % json.dumps(chemins, ensure_ascii=False, indent=2))


def catalogue(modules: list) -> dict:
    """Le contrat de lecture pour un outil tiers.

    Un fichier, un schéma versionné, des chemins relatifs à la racine du site.
    Personne n'a besoin de comprendre la chaîne pour savoir ce qui existe.
    """
    par_semestre = {}
    for cfg in modules:
        par_semestre.setdefault(cfg.get("semestre", 1), []).append(cfg)

    return {
        "schema": "fiches-but/v1",
        "titre": TITRE,
        "etablissement": SOUS_TITRE,
        "semestre_en_cours": SEMESTRE_EN_COURS,
        "semestres": [
            {
                "numero": s,
                "modules": [
                    {
                        "code": cfg["code"],
                        "intitule": cfg["intitule"],
                        "accent": cfg["accent"],
                        # « public » = module repris sous la doctrine des
                        # sources publiques (cf. conception § 2).
                        "corpus": cfg.get("corpus", "origine"),
                        "page": "%s/s%d/%s/index.html"
                                % (PREFIXE_FICHES, s, cfg["code"]),
                        # Les thèmes : un regroupement de fiches, facultatif
                        # (voir themes_de).
                        "themes": themes_de(cfg),
                        "fiches": [
                            {
                                "numero": p["numero"],
                                "chapitre": chapitre_de(cfg, p),
                                "titre": p["titre"],
                                "sous_titre": p.get("sous_titre", ""),
                                "sommaire": p["sommaire"],
                                "sections": sections_de(cfg, p),
                                "sources": p.get("sources") or cfg.get("sources", []),
                                "pages": p["pages"],
                                "page": "%s/s%d/%s/%02d.html"
                                        % (PREFIXE_FICHES, s, cfg["code"], p["numero"]),
                                "pdf": "pdf/%s" % p["nom_pdf"],
                                "pdf_livret": "pdf/livret/%s"
                                              % p["nom_pdf"].replace(".pdf", "_livret.pdf"),
                            }
                            for p in cfg["parties"]
                        ],
                    }
                    for cfg in par_semestre[s]
                ],
            }
            for s in sorted(par_semestre)
        ],
    }


def index_recherche(modules: list) -> str:
    """Index de recherche embarqué dans un fichier JS.

    Volontairement un <script src> et non un fetch() : le site doit rester
    utilisable ouvert par double-clic (file://), où fetch est bloqué.
    """
    entrees = []
    for cfg in modules:
        s = cfg.get("semestre", 1)
        for p in cfg["parties"]:
            entrees.append({
                "c": cfg["code"],
                "m": cfg["intitule"],
                "n": p["numero"],
                # « ch » et « se » : ce que vise un autre outil. « so » reste
                # le sommaire brut, sur lequel la recherche du site s'appuie.
                "ch": chapitre_de(cfg, p),
                "se": [{"i": x["id"], "t": x["titre"]} for x in sections_de(cfg, p)],
                "t": p["titre"],
                "st": p.get("sous_titre", ""),
                "so": p["sommaire"],
                "u": "%s/s%d/%s/%02d.html" % (PREFIXE_FICHES, s, cfg["code"], p["numero"]),
                "p": p["pages"],
            })
    return ("/* Index de recherche — GÉNÉRÉ par build_site.py, ne pas éditer. */\n"
            "window.FICHES = %s;\n"
            % json.dumps(entrees, ensure_ascii=False, separators=(",", ":")))


def index_contenu(modules: list) -> str:
    """Le TEXTE des fiches, dans un fichier a part.

    A part, et pas dans recherche.js, parce qu'il est vingt fois plus gros :
    le charger sur chaque page ferait payer a toutes les visites une
    recherche que peu de gens font. Il n'arrive que sur demande.

    Le contenu est reduit a sa prose - ni balises, ni entites - et les blancs
    sont ecrases : ce qui compte ici est de retrouver un mot, pas de restituer
    une mise en page.
    """
    def prose(morceau):
        t = re.sub(r"<[^>]+>", " ", morceau)
        t = html.unescape(t)
        return re.sub(r"\s+", " ", t).strip()

    entrees, bornes = {}, {}
    for cfg in modules:
        for p in cfg["parties"]:
            brut = (CONTENT / cfg["code"] / p["fichier"]).read_text(encoding="utf-8")
            # Le texte est decoupe a chaque <h2>, puis recolle : le meme
            # texte qu'avant, mais on sait ou chaque section commence (lot
            # I : un resultat trouve dans le corps mene a SA section, non a
            # la tete de la fiche). Les ancres viennent des sections que
            # page_fiche() a deposees sur la partie ; sans elles (pages non
            # generees), le texte reste, les bornes non.
            debuts = [m.start() for m in _H2.finditer(brut)]
            coupes = [0] + debuts + [len(brut)]
            morceaux = [brut[a:b] for a, b in zip(coupes, coupes[1:])]
            texte, debuts_sections = "", []
            for i, morceau in enumerate(morceaux):
                t = prose(morceau)
                if i:
                    debuts_sections.append(len(texte) + (1 if texte and t else 0))
                if t:
                    texte = (texte + " " + t) if texte else t
            cle = "%s-%02d" % (cfg["code"], p["numero"])
            entrees[cle] = texte
            ancres = [x[3] for x in p.get("sections", [])]
            if ancres and len(ancres) == len(debuts_sections):
                bornes[cle] = [[d, a] for d, a in zip(debuts_sections, ancres)]
    return ("/* Texte des fiches, pour la recherche approfondie — GENERE"
            " par build_site.py. */\n"
            "window.FICHES_CONTENU = %s;\n"
            "/* Ou commence chaque section dans ce texte : [position, ancre]. */\n"
            "window.FICHES_SECTIONS = %s;\n"
            % (json.dumps(entrees, ensure_ascii=False, separators=(",", ":")),
               json.dumps(bornes, ensure_ascii=False, separators=(",", ":"))))


# --------------------------------------------------------------------------
# Construction
# --------------------------------------------------------------------------

def construire(avec_pdf: bool = True):
    """Construit tout le site dans site/ : pages, scripts, carte, et les PDF sauf avis contraire."""
    global AUTH, APPS, VERSION, CHANGELOG, CHANGELOG_FICHES, CHANGELOG_ADMIN
    AUTH = charger_auth()
    APPS = charger_apps()
    CHANGELOG = charger_journal("changelog.json")
    CHANGELOG_FICHES = charger_journal("changelog-fiches.json")
    CHANGELOG_ADMIN = charger_journal("changelog-admin.json")

    # Calculée avant toute écriture de page : c'est elle qui sera collée aux
    # adresses des ressources dans chaque page produite. TOUT fichier servi
    # avec « ?v= » doit y entrer : auth.js en était absent jusqu'au 1er
    # octobre 2026, si bien qu'une correction d'auth.js seul (la redirection
    # ouverte, conception § 43) gardait son ancienne adresse. Il est ajouté EN
    # DERNIER : l'ordre des autres ne bouge pas.
    VERSION = empreinte((ASSETS / "site.css").read_text(encoding="utf-8"),
                        (ASSETS / "site.js").read_text(encoding="utf-8"),
                        config_js(), apps_js(),
                        (ASSETS / "chiffrement.js").read_text(encoding="utf-8"),
                        (ASSETS / "carte.js").read_text(encoding="utf-8"),
                        (ASSETS / "auth.js").read_text(encoding="utf-8"))

    modules = charger_modules()

    if SITE.exists():
        shutil.rmtree(SITE)
    (SITE / "assets").mkdir(parents=True)

    # --- feuilles et scripts
    css = (ASSETS / "site.css").read_text(encoding="utf-8") + bloc_couleurs(modules)
    (SITE / "assets" / "site.css").write_text(css, encoding="utf-8", newline="\n")
    # Le script commun à toutes les pages. Il a longtemps été la chaîne
    # SITE_JS de ce fichier ; c'est un fichier comme auth.js ou carte.js.
    shutil.copy2(ASSETS / "site.js", SITE / "assets" / "site.js")
    (SITE / "assets" / "apps.js").write_text(apps_js(), encoding="utf-8", newline="\n")

    # --- porte d'entrée
    (SITE / "assets" / "config.js").write_text(config_js(), encoding="utf-8", newline="\n")
    shutil.copy2(ASSETS / "auth.js", SITE / "assets" / "auth.js")
    # Le chiffrement de bout en bout des messages prives (lot H, session 2) :
    # un fichier a part, charge par les pages qui en ont besoin (page(...,
    # chiffrement=True)), joue tel quel en node par son banc de vecteurs.
    shutil.copy2(ASSETS / "chiffrement.js", SITE / "assets" / "chiffrement.js")
    # Le graphe et le radial de /admin/carte.html : chargés par cette page
    # seule, qui est la seule a porter un arbre a redessiner.
    shutil.copy2(ASSETS / "carte.js", SITE / "assets" / "carte.js")
    shutil.copy2(ASSETS / "favicon.svg", SITE / "assets" / "favicon.svg")
    # L'icone des notifications : un PNG, que tous les systemes savent
    # afficher dans une bulle (le SVG, non).
    shutil.copy2(ASSETS / "favicon.png", SITE / "assets" / "favicon.png")
    # Le service worker, a la racine : il doit pouvoir ouvrir n'importe
    # quelle page du site au clic sur une notification (lot F).
    (SITE / "sw.js").write_text(service_worker_js(), encoding="utf-8", newline="\n")
    (SITE / "parametres.html").write_text(page_parametres(), encoding="utf-8", newline="\n")
    (SITE / "connexion.html").write_text(page_connexion(), encoding="utf-8", newline="\n")
    # La notice est libre d'acces : on ne peut pas demander de consentir a un
    # traitement dont l'explication est derriere la porte.
    (SITE / "acces-reserve.html").write_text(page_acces_reserve(), encoding="utf-8", newline="\n")
    (SITE / "donnees.html").write_text(page_donnees(), encoding="utf-8", newline="\n")
    # --- le journal des changements (lot J) : la page, et le JSON que la
    # fenetre de l'arrivee lit (les versions telles quelles, sans le mode
    # d'emploi du fichier source).
    (SITE / "nouveautes.html").write_text(page_nouveautes(), encoding="utf-8", newline="\n")
    (SITE / "nouveautes.json").write_text(
        json.dumps({"version": version_nouveautes(),
                    "versions": avec_familles(CHANGELOG, "site"),
                    "fiches": avec_familles(CHANGELOG_FICHES, "fiches"),
                    "familles": {cle: {"couleur": c, "icone": i}
                                 for cle, (c, i) in FAMILLES_NOUV.items()}},
                   ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8", newline="\n")
    (SITE / "compte.html").write_text(page_compte(), encoding="utf-8", newline="\n")
    (SITE / "mes-demandes.html").write_text(page_mes_demandes(), encoding="utf-8", newline="\n")
    (SITE / "demande-acces.html").write_text(page_demande_acces(), encoding="utf-8", newline="\n")
    (SITE / "emploi").mkdir(parents=True, exist_ok=True)
    (SITE / "emploi" / "index.html").write_text(page_emploi(), encoding="utf-8", newline="\n")
    # --- le quiz : la page (publique), la demo (publique), la banque (/fiches/)
    banque, demo = banque_et_demo(modules)
    (SITE / "quiz").mkdir(parents=True, exist_ok=True)
    (SITE / "quiz" / "index.html").write_text(page_quiz(), encoding="utf-8", newline="\n")
    (SITE / "quiz" / "demo.json").write_text(json.dumps(demo, ensure_ascii=False), encoding="utf-8", newline="\n")
    if publier_fiches():
        # Le dossier des fiches est cree plus loin par leur generation ; la
        # banque doit vivre dedans (c'est la zone gardee), donc on le cree ici.
        (SITE / "fiches").mkdir(parents=True, exist_ok=True)
        (SITE / "fiches" / "quiz-banque.json").write_text(json.dumps(banque, ensure_ascii=False), encoding="utf-8", newline="\n")
    (SITE / "groupes").mkdir(parents=True, exist_ok=True)
    (SITE / "groupes" / "index.html").write_text(page_groupes(), encoding="utf-8", newline="\n")
    (SITE / "groupes" / "groupe.html").write_text(page_groupe(), encoding="utf-8", newline="\n")
    (SITE / "groupes" / "rejoindre.html").write_text(page_rejoindre(), encoding="utf-8", newline="\n")
    (SITE / "contacts").mkdir(parents=True, exist_ok=True)
    (SITE / "contacts" / "index.html").write_text(page_contacts(), encoding="utf-8", newline="\n")
    (SITE / "admin.html").write_text(page_admin(), encoding="utf-8", newline="\n")
    # --- la documentation, sous /admin/ (zone super_user, lot G)
    docs = docs_disponibles()
    connus = {nom for nom, _ in docs}
    renvois = ancres_conception(docs)
    (SITE / "admin" / "docs").mkdir(parents=True, exist_ok=True)
    (SITE / "admin" / "docs" / "index.html").write_text(page_docs_index(docs), encoding="utf-8", newline="\n")
    for nom, texte in docs:
        (SITE / "admin" / "docs" / (nom + ".html")).write_text(
            page_doc(nom, texte, connus, renvois), encoding="utf-8", newline="\n")
    # --- le journal de l'administration : cette page, et AUCUNE autre (le
    # banc le verifie, essais/construction/journal_admin.essai.mjs)
    (SITE / "admin" / "changements.html").write_text(
        page_admin_changements(renvois),
        encoding="utf-8", newline="\n")
    # --- la carte du site, générée depuis le code ; le JSON pour le contrôle
    carte = carte_du_site(docs)
    projet = carte_projet.structure()
    commits = carte_projet.frise()
    (SITE / "admin" / "carte.html").write_text(page_carte(carte, projet, commits),
                                               encoding="utf-8", newline="\n")
    (SITE / "admin" / "carte-projet.json").write_text(
        json.dumps(projet, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
    (SITE / "admin" / "carte.json").write_text(
        json.dumps(carte, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")

    # --- PDF : copie, puis version livret
    if avec_pdf and not publier_fiches():
        print("  fiches non publiees : aucun PDF copie dans le site")
    if avec_pdf and publier_fiches():
        (SITE / "pdf" / "livret").mkdir(parents=True)
        for cfg in modules:
            for p in cfg["parties"]:
                src = p["chemin_pdf"]
                if not src.exists():
                    print("  !! PDF manquant :", src.name)
                    continue
                shutil.copy2(src, SITE / "pdf" / p["nom_pdf"])
                cible = SITE / "pdf" / "livret" / p["nom_pdf"].replace(".pdf", "_livret.pdf")
                livret.imposer(src, cible)

    # --- pages
    # La racine du site, c'est le portail : la porte commune à tous les
    # outils. Les fiches sont l'un d'eux, et vivent donc sous /fiches/.
    (SITE / "index.html").write_text(page_portail(modules), encoding="utf-8", newline="\n")

    # L'accueil de démonstration. Écrit seulement s'il y a quelque chose à
    # montrer : une page qui annoncerait « deux fiches » et n'en listerait
    # aucune serait pire que son absence.
    if publier_fiches() and fiches_demo(modules):
        (SITE / "demo.html").write_text(page_demo(modules), encoding="utf-8", newline="\n")

    if publier_fiches():
        coin_fiches = SITE / PREFIXE_FICHES
        coin_fiches.mkdir(parents=True, exist_ok=True)
        (coin_fiches / "index.html").write_text(page_accueil(modules), encoding="utf-8", newline="\n")

        par_semestre = {}
        for cfg in modules:
            par_semestre.setdefault(cfg.get("semestre", 1), []).append(cfg)

        for s, mods in par_semestre.items():
            dossier = coin_fiches / ("s%d" % s)
            dossier.mkdir(parents=True, exist_ok=True)
            (dossier / "index.html").write_text(page_semestre(s, mods), encoding="utf-8", newline="\n")
            for cfg in mods:
                d = dossier / cfg["code"]
                d.mkdir(exist_ok=True)
                (d / "index.html").write_text(page_module(cfg), encoding="utf-8", newline="\n")
                for p in cfg["parties"]:
                    (d / ("%02d.html" % p["numero"])).write_text(
                        page_fiche(cfg, p), encoding="utf-8", newline="\n")

    # --- annexes
    # Le registre des outils est publié tel quel : un outil voisin peut ainsi
    # savoir ce qui existe sur le portail sans avoir à le demander.
    (SITE / "apps.json").write_text(
        json.dumps({"schema": APPS.get("schema", "portail-but/v1"),
                    "apps": APPS.get("apps", [])},
                   ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8", newline="\n")

    # L'index et le catalogue vivent sous /fiches/, zone protégée par le
    # middleware : ils décrivent le contenu, donc ils se protègent comme lui.
    if publier_fiches():
        coin = SITE / PREFIXE_FICHES
        coin.mkdir(parents=True, exist_ok=True)
        (coin / "recherche.js").write_text(index_recherche(modules),
                                           encoding="utf-8", newline="\n")
        # Le texte des fiches decrit le corpus aussi surement que le
        # catalogue : il vit donc sous /fiches/, derriere le meme controle.
        (coin / "recherche-contenu.js").write_text(index_contenu(modules),
                                                   encoding="utf-8", newline="\n")
        (coin / "catalogue.json").write_text(
            json.dumps(catalogue(modules), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8", newline="\n")

    # L'inventaire des zones proposables (lot L). Écrit APRÈS toutes les
    # pages : ZONES_SITE est rempli par page(), donc il n'existe qu'une fois
    # la dernière page rendue. C'est ce qui garantit qu'il ne peut pas être
    # périmé — il n'est pas tenu à la main, il est le résidu de la
    # génération.
    #
    # Deux fichiers, deux protections. Les intitulés des sections de fiche
    # décrivent le corpus, comme l'index de recherche : ils vont sous
    # /fiches/, derrière reader_user. Le reste est public, comme les pages
    # qu'il décrit.
    (SITE / "zones.json").write_text(inventaire_zones(prive=False, version=VERSION), encoding="utf-8", newline="\n")
    if publier_fiches():
        coin = SITE / PREFIXE_FICHES
        coin.mkdir(parents=True, exist_ok=True)
        (coin / "zones.json").write_text(inventaire_zones(prive=True, version=VERSION), encoding="utf-8", newline="\n")

    # Les exceptions publiques du middleware. Ecrites A CHAQUE generation, y
    # compris vide : si les fiches ne sont pas publiees, rien ne doit rester
    # ouvert, et un fichier perime le laisserait croire.
    ouverts = chemins_demo(modules) if publier_fiches() else []
    (ROOT / "functions" / "_demo.js").write_text(module_demo(ouverts),
                                                 encoding="utf-8", newline="\n")
    # Meme raison : ce que la page compte propose de relier doit venir du
    # registre, jamais d'une liste recopiee.
    (ROOT / "functions" / "_fournisseurs.js").write_text(
        module_fournisseurs(), encoding="utf-8", newline="\n")
    (ROOT / "functions" / "_notice.js").write_text(module_notice(), encoding="utf-8", newline="\n")
    if ouverts:
        print("  demo publique : %d chemin(s) ouverts sans compte"
              % len(ouverts))

    # Consultation privée : on demande explicitement à ne pas être référencé.
    (SITE / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8", newline="\n")

    # Le perimetre des fonctions Cloudflare (voir routes_fonctions). Ecrit a
    # chaque generation, comme _demo.js, et pour la meme raison.
    (SITE / "_routes.json").write_text(routes_fonctions(ouverts), encoding="utf-8", newline="\n")

    pages = len(list(SITE.rglob("*.html")))
    fiches = sum(len(c["parties"]) for c in modules)
    print("Site généré dans %s" % SITE)
    if publier_fiches():
        print("  %d pages HTML · %d fiches · %d modules" % (pages, fiches, len(modules)))
        if avec_pdf:
            print("  %d PDF + %d versions livret" % (fiches, fiches))
    else:
        print("  %d pages HTML · fiches NON publiees (%d fiches gardees en local)"
              % (pages, fiches))


def main():
    """Construit le site ; « --sans-pdf » laisse les PDF de côté."""
    construire(avec_pdf="--sans-pdf" not in sys.argv[1:])


if __name__ == "__main__":
    main()
