# -*- coding: utf-8 -*-
"""Les zones proposables : le ⚑ posé sur chaque bloc, et l'inventaire qui en sort.

page() appelle poser_drapeaux() et inscrire_zones() pour chaque page ;
construire() écrit l'inventaire à la fin (inventaire_zones). Ne dépend que
d'ossature.py.

Sorti de build_site.py le 1er octobre 2026 (conception § 45).
"""
import html
import json
import re

from ossature import ICONES, _texte_nu, ancre_section, e


# ---------------------------------------------------------------------------
# Les zones proposables (lot L)
# ---------------------------------------------------------------------------
# Au lot G, le ⚑ était posé à la main (les <h2> d'une fiche, l'en-tête d'une
# fiche, une ligne du portail) et la liste des pages visables était un
# <select> écrit dans le code. Deux défauts, les mêmes : une zone ajoutée
# demain n'est pas proposable tant qu'on n'a pas retouché la fenêtre, et une
# page retirée reste dans la liste.
#
# Ici, l'inverse. Un bloc devient proposable en portant UN attribut —
# zone("filtres", "Les filtres") — et tout le reste suit : le ⚑ est injecté
# dans le bloc à la génération, la cible complète est calculée (la racine de
# la page + l'ancre de la zone), et la zone entre dans l'inventaire écrit en
# fin de build. Rien n'est énuméré deux fois : l'inventaire EST la liste des
# zones déclarées, donc il ne peut pas être périmé.
#
# La cible suit la grammaire de supabase/2026_propositions_2.sql :
#   racine « S1-R104-06 » (une fiche), « S1-R104 » (un module), « /quiz/ »
#   (une page) ; ancre « #filtres » (une zone de cette racine).
#
# Deux inventaires, et c'est important : les intitulés des sections de fiche
# sont du contenu réservé (même raison que l'index de recherche — voir page()),
# ils vont dans site/fiches/zones.json, derrière reader_user. Le reste, qui ne
# dit rien de plus que ce qu'on voit sans compte, va dans site/zones.json.

# racine -> {"titre": …, "prive": bool, "zones": [ {"id": …, "titre": …} ]}
ZONES_SITE: dict = {}

# Les zones déclarées à la main, par racine : { racine: [ (id, intitulé) ] }.
# Elles complètent ce que _marquer_doffice() trouve tout seul (l'en-tête, les
# titres de section) là où la page n'a pas cette forme : des panneaux, des
# bandeaux, une messagerie. On désigne l'élément par son `id`, qui est déjà
# son ancre.
#
# Deux garanties tiennent à ce que ce soit une TABLE et non un attribut semé
# dans les gabarits :
#   - on lit d'un coup d'œil ce qu'une page offre de viser ;
#   - un identifiant qui n'existe plus dans la page FAIT ÉCHOUER LE BUILD
#     (poser_drapeaux). Un attribut, lui, disparaîtrait en silence avec le
#     bloc qu'on déplace, et la zone s'évaporerait sans que personne ne le
#     voie — exactement la dérive qu'on veut éviter.
ZONES_DECLAREES = {
    "/quiz/": [
        ("quiz-demo-banniere", "Le bandeau de démonstration du quiz"),
        ("quiz-reprise", "Le bandeau « une session en pause »"),
        ("quiz-stats", "Les statistiques de progression du quiz"),
        ("quiz-form", "Le choix des fiches et des options"),
        ("quiz-session", "La carte de question"),
    ],
    "/emploi/": [
        ("edt-invitations", "Le bandeau « on te propose »"),
        ("edt-barre", "La barre de navigation de la semaine"),
        ("edt-grille", "La grille de la semaine"),
        ("edt-taches-bloc", "Les tâches à faire"),
        ("edt-sources", "L'import et le suivi de calendriers"),
    ],
    "/groupes/": [
        ("msg-cote", "La liste des conversations"),
        ("msg-conv", "Le panneau « choisis une conversation »"),
    ],
    "/groupes/groupe.html": [
        ("msg-cote", "La liste des conversations"),
        ("grp-onglets", "Les onglets d'un groupe"),
        ("grp-messages", "Le fil des messages"),
        ("grp-form-message", "Le champ d'écriture d'un message"),
        ("grp-seances", "La liste des séances d'un groupe"),
        ("grp-membres-section", "L'onglet Membres d'un groupe"),
    ],
    "/contacts/": [
        ("ct-form", "L'ajout d'un contact par son pseudo"),
    ],
}

_MOTIF_ZONE_ID = re.compile(r"^[a-z0-9-]{1,120}$")

# Les blocs qu'on sait décorer. Une balise ouvrante, et c'est tout : on
# n'analyse pas le HTML, on insère à un endroit connu (dans un titre, juste
# avant sa fermeture ; ailleurs, juste après l'ouverture).
_MOTIF_ZONE = re.compile(
    r"<(h[1-6]|section|article|div|aside|nav|form|fieldset|details)\b[^>]*"
    r'\bdata-zone="([^"]+)"[^>]*>', re.I)
_MOTIF_ZONE_TITRE = re.compile(r'\bdata-zone-titre="([^"]*)"')


def zone(identifiant: str, titre: str) -> str:
    """Les attributs qui rendent un bloc proposable.

    À poser sur le bloc lui-même : `<section%s>` % zone("filtres", "Les
    filtres du quiz"). L'identifiant devient l'ancre de la cible, il obéit
    donc à la grammaire de la base ; le titre est ce que la fenêtre montre
    et ce qui est enregistré avec la proposition, pour qu'elle reste
    lisible même si la zone disparaît plus tard.
    """
    if not _MOTIF_ZONE_ID.match(identifiant):
        raise ValueError("identifiant de zone hors grammaire : %r "
                         "(attendu : [a-z0-9-], 120 au plus)" % identifiant)
    if not titre.strip() or len(titre) > 200:
        raise ValueError("titre de zone vide ou trop long : %r" % titre)
    return ' data-zone="%s" data-zone-titre="%s"' % (e(identifiant), e(titre))


def _marquer_doffice(corps: str) -> str:
    """Marque comme zones ce qui en est une par construction.

    L'en-tête d'une page et ses titres de section n'ont pas à être déclarés
    un par un : ils SONT la structure. Une section ajoutée demain devient
    donc proposable sans qu'on touche à quoi que ce soit — c'est la moitié
    de ce que demande « modulable en fonction des mises à jour ».

    Le repérage s'arrête au <main> : une fenêtre de dialogue, un panneau
    d'impression, un pied de page viennent après, et on ne propose pas « sur
    un dialogue ». Un bloc déjà marqué à la main n'est pas retouché, et un
    titre vide (rempli par le script) est laissé tranquille : une zone sans
    nom ne se désigne pas.
    """
    debut = corps.find("<main")
    fin = corps.find("</main>", debut) if debut >= 0 else -1
    if debut < 0 or fin < 0:
        return corps
    tete, milieu, queue = corps[:debut], corps[debut:fin], corps[fin:]
    pris = set(re.findall(r'data-zone="([^"]+)"', corps))

    def retenir(propose: str) -> str:
        cle, n = propose, 2
        while cle in pris:
            cle, n = "%s-%d" % (propose, n), n + 1
        pris.add(cle)
        return cle

    def entete(m):
        if "data-zone=" in m.group(0):
            return m.group(0)
        titre = _texte_nu(re.search(r"<h1[^>]*>(.*?)</h1>", milieu, re.DOTALL).group(1)) \
            if re.search(r"<h1[^>]*>(.*?)</h1>", milieu, re.DOTALL) else ""
        return m.group(0)[:-1] + zone(retenir("entete"),
                                      "L'en-tête" + (" : " + titre if titre else "")) + ">"

    milieu = re.sub(r'<div class="entete[^"]*"[^>]*>', entete, milieu, count=1)

    def section(m):
        attributs, contenu = m.group(1), m.group(2)
        if "data-zone=" in attributs:
            return m.group(0)
        titre = _texte_nu(contenu)
        if not titre:
            return m.group(0)        # un titre rempli par le script ne se vise pas
        # Un identifiant déjà posé EST l'ancre de la page : la cible doit
        # être atteignable, on ne lui en invente pas une seconde.
        depose = re.search(r'\bid="([a-z0-9-]{1,120})"', attributs)
        cle = depose.group(1) if depose else ancre_section(titre)
        if not cle:
            return m.group(0)
        if not depose:
            cle = retenir(cle)
        else:
            pris.add(cle)
        return '<h2 class="section"%s%s>%s</h2>' % (attributs, zone(cle, titre), contenu)

    milieu = re.sub(r'<h2 class="section"([^>]*)>(.*?)</h2>', section, milieu, flags=re.DOTALL)
    return tete + milieu + queue


def _marquer_declarees(corps: str, racine: str) -> str:
    """Applique ZONES_DECLAREES à la page, par l'`id` des éléments.

    Une déclaration sans élément correspondant arrête le build : c'est le
    but de la table (voir son commentaire). Le contraire — un élément sans
    déclaration — est normal : tout n'a pas à être proposable.
    """
    for identifiant, titre in ZONES_DECLAREES.get(racine, []):
        motif = re.compile(r'<([a-z]+)((?:[^>]*?\s)?id="%s")([^>]*)>' % re.escape(identifiant))
        m = motif.search(corps)
        if not m:
            raise ValueError(
                "zone déclarée introuvable sur %s : aucun élément id=\"%s\". "
                "Le bloc a été renommé ou retiré — corriger ZONES_DECLAREES."
                % (racine, identifiant))
        if "data-zone=" in m.group(0):
            continue
        # Une balise hors de celles que poser_drapeaux sait décorer perdrait
        # la zone en silence : on le dit tout de suite.
        if not re.match(r"^(h[1-6]|section|article|div|aside|nav|form|fieldset|details)$",
                        m.group(1), re.I):
            raise ValueError(
                "zone déclarée sur une balise indécorable : %s porte id=\"%s\" "
                "sur <%s> (attendu : un bloc, pas un <%s>)"
                % (racine, identifiant, m.group(1), m.group(1)))
        corps = corps[:m.end() - 1] + zone(identifiant, titre) + corps[m.end() - 1:]
    return corps


def poser_drapeaux(corps: str, racine: str) -> tuple:
    """Injecte un ⚑ dans chaque bloc marqué, et rend la liste des zones.

    Le bouton porte la cible COMPLÈTE (racine#zone) et le titre en clair :
    la fenêtre n'a rien à recalculer, et une page servie depuis un cache
    ancien reste cohérente avec ce qu'elle affiche.

    Un titre reçoit son ⚑ juste avant sa fermeture (il flotte à droite du
    texte) ; tout autre bloc, juste après son ouverture (il se cale en haut
    à droite du bloc). Deux zones imbriquées — un panneau et l'un de ses
    titres — en reçoivent chacune un : c'est voulu, c'est la granularité.

    Un bloc marqué reçoit aussi un `id` s'il n'en a pas : l'ancre de la
    cible doit pouvoir être ATTEINTE, sinon « ouvrir la cible » depuis
    l'administration ne mènerait nulle part.
    """
    corps = _marquer_doffice(corps)
    corps = _marquer_declarees(corps, racine)
    type_defaut = "technique" if racine.startswith("/") else "correction"
    zones, insertions, vus = [], [], set()

    for m in _MOTIF_ZONE.finditer(corps):
        balise, identifiant = m.group(1).lower(), m.group(2)
        titre_m = _MOTIF_ZONE_TITRE.search(m.group(0))
        titre = html.unescape(titre_m.group(1)) if titre_m else identifiant
        if identifiant in vus:
            raise ValueError("zone en double sur %s : %r" % (racine, identifiant))
        vus.add(identifiant)
        zones.append({"id": identifiant, "titre": titre})

        cible = racine + "#" + identifiant
        bouton = ('<button class="prop-drapeau%s" type="button" data-proposer="%s" '
                  'data-cible="%s" data-cible-titre="%s" title="Proposer : %s" '
                  'aria-label="Proposer quelque chose sur : %s">%s</button>'
                  % ("" if balise.startswith("h") else " prop-drapeau-bloc",
                     type_defaut, e(cible), e(titre), e(titre), e(titre),
                     ICONES["proposer"]))
        if balise.startswith("h"):
            fin = corps.find("</%s>" % balise, m.end())
            if fin < 0:
                raise ValueError("titre de zone jamais refermé : %r sur %s"
                                 % (identifiant, racine))
            insertions.append((fin, bouton))
        else:
            insertions.append((m.end(), bouton))
        if ' id="' not in m.group(0):
            insertions.append((m.start() + 1 + len(balise),
                               ' id="%s"' % e(identifiant)))

    for position, bouton in sorted(insertions, reverse=True):
        corps = corps[:position] + bouton + corps[position:]
    return corps, zones


def inscrire_zones(racine: str, titre: str, zones: list, prive: bool) -> None:
    """Dépose ce qu'une page vient de déclarer dans l'inventaire du site.

    Une racine peut être servie par plusieurs pages (le gabarit d'un groupe
    vaut pour tous les groupes) : on fusionne, sans doublon.
    """
    entree = ZONES_SITE.setdefault(racine, {"titre": titre, "prive": prive, "zones": []})
    if titre and not entree["titre"]:
        entree["titre"] = titre
    entree["prive"] = entree["prive"] or prive
    connus = {z["id"] for z in entree["zones"]}
    entree["zones"].extend(z for z in zones if z["id"] not in connus)


def inventaire_zones(prive: bool, version: str) -> str:
    """L'inventaire, tel qu'il est écrit dans le site.

    Lu par la fenêtre (pour offrir « changer de zone ») et par
    l'administration (pour dire si la cible d'une vieille proposition existe
    encore). `version` permet de dater une disparition : une cible absente
    d'un inventaire plus récent que la proposition a bel et bien été retirée.
    """
    racines = [
        {"cible": racine, "titre": d["titre"],
         "contenu": not racine.startswith("/"),
         "zones": sorted(d["zones"], key=lambda z: z["id"])}
        for racine, d in sorted(ZONES_SITE.items())
        if d["prive"] == prive
    ]
    return json.dumps({"version": version, "racines": racines},
                      ensure_ascii=False, separators=(",", ":"))
