#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Générateur de fiches de révision — BUT Informatique
====================================================

Principe : chaque MODULE possède un fichier de configuration JSON
(modules/R101.json) qui décrit son identité visuelle et la LISTE de
ses parties. Chaque partie a un fichier de contenu HTML autonome
(content/R101/01_xxx.html) contenant uniquement le corps de la fiche.

Le script assemble : couverture générée + contenu + pied de page.

Ajouter une partie plus tard :
  1. écrire content/<MODULE>/06_xxx.html
  2. ajouter une entrée dans modules/<MODULE>.json
  3. relancer : python build.py R101
Les fiches déjà existantes n'ont PAS besoin d'être refaites : le repère
de position est un numéro absolu ("Partie 03"), sans dénominateur.

Usage :  python build.py R101 [R105 ...]
         python build.py --all
         python build.py R101 --sortie chemin/de/sortie

MOTEUR DE RENDU
---------------
La chaîne d'origine utilisait wkhtmltopdf, aujourd'hui abandonné (dernière
version 2020) et absent des machines Windows. Il est remplacé par Chrome
sans interface graphique ("headless"), déjà installé et qui applique
correctement le CSS. Conséquences :
  - le format de page et les marges ne sont plus passés en options de
    ligne de commande mais déclarés dans assets/fiche.css (règle @page) ;
  - les font-size du CSS sont en px pour reproduire à l'identique la
    densité des fiches déjà validées (explication détaillée dans fiche.css).
Le pied de page reste produit par reportlab puis fusionné par pypdf : c'est
la seule façon d'y écrire "n / total", le total n'étant connu qu'une fois
le PDF rendu.
"""

import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A5
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

# --------------------------------------------------------------------------
# Chemins
# --------------------------------------------------------------------------

ROOT     = Path(__file__).parent
ASSETS   = ROOT / "assets"
MODULES  = ROOT / "modules"
CONTENT  = ROOT / "content"
BUILD    = ROOT / "build"

# Sortie par défaut : le dossier "Cours Fiches" voisin, où les fiches sont
# rangées par module. Chaque module indique son sous-dossier via la clé
# "dossier_sortie" de son JSON ; à défaut, les PDF tombent dans build/.
SORTIE_RACINE = ROOT.parent / "Cours Fiches"

# Marges de la page, en millimètres. À garder en accord avec la règle @page
# de assets/fiche.css : elles servent ici à placer le pied de page.
MARGIN_T, MARGIN_B, MARGIN_L, MARGIN_R = 12, 13, 12, 12

ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
         "XI", "XII", "XIII", "XIV", "XV"]


# --------------------------------------------------------------------------
# Découverte de l'environnement (polices, navigateur)
# --------------------------------------------------------------------------

def dossier_polices() -> Path:
    """Répertoire contenant les DejaVu*.ttf, selon le système."""
    candidats = [
        Path(r"C:\Windows\Fonts"),                      # Windows
        Path("/usr/share/fonts/truetype/dejavu"),       # Debian / Ubuntu
        Path("/usr/share/fonts/dejavu"),                # Fedora / Arch
        Path("/Library/Fonts"),                         # macOS
    ]
    for d in candidats:
        if (d / "DejaVuSans.ttf").exists():
            return d
    raise SystemExit(
        "Polices DejaVu introuvables. Sous Windows, installer la famille "
        "DejaVu ; sous Debian : apt-get install fonts-dejavu."
    )


def chemin_navigateur() -> str:
    """Exécutable Chrome/Chromium/Edge servant de moteur de rendu PDF."""
    candidats = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]
    for c in candidats:
        if Path(c).exists():
            return c
    for nom in ("chrome", "chromium", "google-chrome", "msedge"):
        trouve = shutil.which(nom)
        if trouve:
            return trouve
    raise SystemExit(
        "Aucun navigateur Chrome/Chromium/Edge trouve : il sert de moteur de "
        "rendu PDF. Installer Google Chrome, ou adapter chemin_navigateur()."
    )


# --------------------------------------------------------------------------
# Utilitaires
# --------------------------------------------------------------------------

def slug(texte: str) -> str:
    """'Types, variables & constantes' -> 'Types_variables_constantes'"""
    t = unicodedata.normalize("NFKD", texte)
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"[^A-Za-z0-9]+", "_", t)
    return t.strip("_")


def lire_config(code: str) -> dict:
    """La configuration d'un module, lue dans modules/<code>.json."""
    with open(MODULES / f"{code}.json", encoding="utf-8") as f:
        return json.load(f)


# Insécable : espace qui interdit un retour à la ligne à cet endroit.
INSECABLE = " "

# Un signe double (; : ! ?) précédé d'une espace, ou une espace intérieure de
# guillemets français. Ces espaces doivent être insécables, sinon la
# justification rejette le signe seul en début de ligne.
_AVANT_SIGNE = re.compile(r"[ \t]+(?=[;:!?](?:\s|$|<))")
_APRES_GUILLEMET = re.compile(r"«[ \t]+")
_AVANT_GUILLEMET = re.compile(r"[ \t]+»")

# Découpages successifs : d'abord les blocs de code (intouchables), puis les
# balises, pour n'appliquer la règle qu'au texte réellement affiché.
_BLOCS_CODE = re.compile(r"(<pre\b.*?</pre>)", re.DOTALL | re.IGNORECASE)
_BALISES = re.compile(r"(<[^>]+>)")


def typographie(html: str) -> str:
    """Applique les espaces insécables de la typographie française.

    Le français exige une espace avant « ; : ! ? » et à l'intérieur des
    guillemets. Une espace ordinaire y autorise un retour à la ligne : le
    signe se retrouve alors seul en début de ligne. On la remplace donc par
    une espace insécable.

    Le contenu des blocs <pre> (code shell, C++, SQL) et le texte des balises
    elles-mêmes sont laissés strictement intacts.
    """
    morceaux = []
    for bloc in _BLOCS_CODE.split(html):
        if bloc[:4].lower() == "<pre":
            morceaux.append(bloc)          # code : aucune retouche
            continue
        for segment in _BALISES.split(bloc):
            if segment[:1] == "<":
                morceaux.append(segment)   # balise : aucune retouche
                continue
            segment = _AVANT_SIGNE.sub(INSECABLE, segment)
            segment = _APRES_GUILLEMET.sub("«" + INSECABLE, segment)
            segment = _AVANT_GUILLEMET.sub(INSECABLE + "»", segment)
            morceaux.append(segment)
    return "".join(morceaux)


def dossier_sortie(cfg: dict, force):
    """Où déposer les PDF d'un module.

    Priorité : option --sortie > clé "dossier_sortie" du JSON > build/.
    Le chemin du JSON est relatif à SORTIE_RACINE ("Cours Fiches"), pour que
    les fiches produites se rangent d'elles-mêmes à côté des cours.
    """
    if force is not None:
        return force
    rel = cfg.get("dossier_sortie")
    return (SORTIE_RACINE / rel) if rel else BUILD


# --------------------------------------------------------------------------
# Construction du HTML complet d'une fiche
# --------------------------------------------------------------------------

def html_couverture(cfg: dict, partie: dict) -> str:
    """Page de couverture : bandeau, code module, repère, titre, sommaire."""
    num = partie["numero"]

    # Sommaire numéroté : les sections internes, en chiffres romains
    lignes = "".join(
        f'<li><span class="num">{ROMAN[i + 1]}.</span>{s}</li>'
        for i, s in enumerate(partie["sommaire"])
    )

    # Repère de collection : situe la fiche parmi les autres du module
    autres = [p for p in cfg["parties"] if p["numero"] != num]
    if autres:
        liste = " · ".join(f'{p["numero"]:02d} {p["titre"]}' for p in autres)
        collection = (
            f'<div class="cover-collection">'
            f'<strong>Collection {cfg["code"]}</strong> — '
            f'cette fiche est la partie {num:02d}.<br>'
            f'<span class="autres">Autres fiches : {liste}</span>'
            f'</div>'
        )
    else:
        collection = ""

    sous_titre = partie.get("sous_titre", "")
    sous_titre_html = f'<div class="cover-sous-titre">{sous_titre}</div>' if sous_titre else ""

    return f"""
<section class="cover">
  <div class="cover-bandeau">{cfg["bandeau"]}</div>

  <div class="cover-module">{cfg["code"]}</div>
  <div class="cover-module-nom">{cfg["intitule"]}</div>

  <div class="cover-repere">Partie {num:02d}</div>
  <h1 class="cover-titre">{partie["titre"]}</h1>
  {sous_titre_html}

  <hr class="cover-rule">

  <div class="sommaire-titre">Sommaire</div>
  <ol class="sommaire">{lignes}</ol>

  {collection}
</section>
"""


def html_complet(cfg: dict, partie: dict, corps: str) -> str:
    """La page HTML d'une fiche prête à passer en PDF : couverture, corps, couleurs du module."""
    css = (ASSETS / "fiche.css").read_text(encoding="utf-8")
    # Injection de la couleur d'accent propre au module
    css = css.replace("--accent:        #3d1152;",
                      f'--accent:        {cfg["accent"]};')
    css = css.replace("--accent-soft:   #f2ecf6;",
                      f'--accent-soft:   {cfg["accent_soft"]};')
    css = css.replace("--accent-line:   #b490c9;",
                      f'--accent-line:   {cfg["accent_line"]};')

    # La typographie française s'applique à tout le texte affiché : couverture
    # (titres et sommaire venus du JSON) comme corps de la fiche. Le CSS, lui,
    # est assemblé après coup pour rester hors de portée.
    contenu = typographie(html_couverture(cfg, partie) + "\n" + corps)

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>{cfg["code"]} — {partie["titre"]}</title>
<style>
{css}
</style>
</head>
<body>
{contenu}
</body>
</html>
"""


# --------------------------------------------------------------------------
# Rendu HTML -> PDF (Chrome sans interface)
# --------------------------------------------------------------------------

# Préférences posées dans chaque profil neuf : correcteur d'orthographe coupé.
# Sans cela, Chrome télécharge à chaque impression son dictionnaire
# (fr-FR-3-0.bdic, 1 Mo), et un de ses processus enfants le tient encore
# ouvert quelques dizaines de millisecondes après la fin de l'impression :
# l'effacement du profil échouait alors sur PermissionError (WinError 32).
# Aucun drapeau de ligne de commande ne l'empêche : --disable-component-update,
# --disable-background-networking et --disable-features=SpellCheck laissent
# tous le téléchargement se faire (mesuré sur Chrome 154).
PREFERENCES_PROFIL = {"browser": {"enable_spellchecking": False}}


def effacer_profil(profil: Path):
    """Efface un profil temporaire de Chrome, en réessayant un peu.

    Un processus enfant de Chrome peut survivre au processus principal et
    tenir un fichier du profil : de 30 à 160 ms mesurés sur une machine
    chargée. On réessaie pendant deux secondes ; au-delà on renonce sans
    bruit, car un dossier oublié dans le répertoire temporaire ne vaut pas
    d'arrêter la construction.
    """
    for _ in range(10):
        shutil.rmtree(profil, ignore_errors=True)
        if not profil.exists():
            return
        time.sleep(0.2)


def rendre_pdf(f_html: Path, f_pdf: Path):
    """Convertit un fichier HTML local en PDF via Chrome headless.

    --user-data-dir pointe sur un profil neuf à chaque fiche : sans cela
    Chrome refuse de démarrer si une fenêtre du navigateur est déjà ouverte.
    Le format A5 et les marges viennent de la règle @page du CSS.
    """
    if f_pdf.exists():
        f_pdf.unlink()          # sinon on ne détecterait pas un rendu raté

    profil = Path(tempfile.mkdtemp(prefix="fiches-but-chrome-"))
    try:
        (profil / "Default").mkdir()
        (profil / "Default" / "Preferences").write_text(
            json.dumps(PREFERENCES_PROFIL), encoding="utf-8")
        subprocess.run([
            chemin_navigateur(),
            "--headless",
            "--disable-gpu",
            "--no-sandbox",
            "--no-pdf-header-footer",          # pas d'en-tête/pied du navigateur
            # Sans lui, un profil neuf télécharge les extensions déclarées au
            # registre par d'autres logiciels (Adobe Acrobat, McAfee…) et
            # abandonne leur paquet dans %TEMP% : jusqu'à 15 Mo par fiche.
            "--disable-extensions",
            "--user-data-dir=" + str(profil),
            "--print-to-pdf=" + str(f_pdf.resolve()),
            f_html.resolve().as_uri(),
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    finally:
        effacer_profil(profil)

    if not f_pdf.exists():
        raise SystemExit("Le rendu a echoue : " + str(f_pdf) + " n'a pas ete produit.")


# --------------------------------------------------------------------------
# Pied de page (pypdf + reportlab)
# --------------------------------------------------------------------------

def enregistrer_polices():
    """Déclare les polices DejaVu auprès de reportlab, pour écrire les pieds de page accentués."""
    d = dossier_polices()
    pdfmetrics.registerFont(TTFont("DejaVu", str(d / "DejaVuSans.ttf")))
    pdfmetrics.registerFont(TTFont("DejaVu-Bold", str(d / "DejaVuSans-Bold.ttf")))


def ajouter_pieds(pdf_in: Path, pdf_out: Path, gauche: str, accent: str):
    """Filet fin + titre à gauche + 'n / total' à droite, sur chaque page."""
    reader = PdfReader(str(pdf_in))
    total = len(reader.pages)
    writer = PdfWriter()

    largeur, hauteur = A5
    marge_l = MARGIN_L * 72 / 25.4
    marge_r = MARGIN_R * 72 / 25.4
    y_texte = 15.5
    y_filet = y_texte + 8.5

    # Couleur du filet, dérivée de l'accent du module
    r = int(accent[1:3], 16) / 255
    g = int(accent[3:5], 16) / 255
    b = int(accent[5:7], 16) / 255

    tmp = pdf_in.parent / (pdf_in.stem + "_pieds.pdf")
    c = canvas.Canvas(str(tmp), pagesize=A5)
    for n in range(1, total + 1):
        c.setStrokeColorRGB(r, g, b)
        c.setLineWidth(0.4)
        c.line(marge_l, y_filet, largeur - marge_r, y_filet)

        c.setFillColorRGB(0.32, 0.32, 0.32)
        c.setFont("DejaVu", 6.2)
        c.drawString(marge_l, y_texte, gauche)

        c.setFont("DejaVu-Bold", 6.2)
        c.setFillColorRGB(r, g, b)
        c.drawRightString(largeur - marge_r, y_texte, str(n) + " / " + str(total))
        c.showPage()
    c.save()

    calques = PdfReader(str(tmp))
    for i, page in enumerate(reader.pages):
        page.merge_page(calques.pages[i])
        writer.add_page(page)
    with open(pdf_out, "wb") as f:
        writer.write(f)
    tmp.unlink()


# --------------------------------------------------------------------------
# Génération d'un module
# --------------------------------------------------------------------------

def construire_module(code: str, force_sortie=None) -> list:
    """Produit les PDF de toutes les fiches d'un module, et renvoie leurs chemins."""
    cfg = lire_config(code)
    BUILD.mkdir(exist_ok=True)
    sortie = dossier_sortie(cfg, force_sortie)
    sortie.mkdir(parents=True, exist_ok=True)
    produits = []

    for partie in cfg["parties"]:
        num = partie["numero"]
        src = CONTENT / code / partie["fichier"]
        if not src.exists():
            print("  !! contenu manquant : " + str(src))
            continue

        corps = src.read_text(encoding="utf-8")
        html = html_complet(cfg, partie, corps)

        f_html = BUILD / (code + "_" + format(num, "02d") + ".html")
        f_brut = BUILD / (code + "_" + format(num, "02d") + "_brut.pdf")
        f_html.write_text(html, encoding="utf-8", newline="\n")

        rendre_pdf(f_html, f_brut)

        nom = "Fiche_" + code + "_" + format(num, "02d") + "_" + slug(partie["titre"]) + ".pdf"
        final = sortie / nom
        pied_gauche = code + " · Partie " + format(num, "02d") + " — " + partie["titre"]
        ajouter_pieds(f_brut, final, pied_gauche, cfg["accent"])

        pages = len(PdfReader(str(final)).pages)
        print("  ok  " + nom + "  (" + str(pages) + " p.)")
        produits.append(str(final))

    print("  -> " + str(sortie))
    return produits


def main():
    """Construit les fiches PDF des modules nommés, ou de tous (« --sortie » change le dossier)."""
    enregistrer_polices()

    args = sys.argv[1:]
    # Option --sortie <chemin> : force le dossier de destination
    force_sortie = None
    if "--sortie" in args:
        i = args.index("--sortie")
        force_sortie = Path(args[i + 1])
        del args[i:i + 2]

    if not args or args[0] == "--all":
        codes = sorted(p.stem for p in MODULES.glob("*.json"))
    else:
        codes = args

    tous = []
    for code in codes:
        print("\n=== Module " + code + " ===")
        tous += construire_module(code, force_sortie)
    print("\n" + str(len(tous)) + " fiche(s) generee(s).")


if __name__ == "__main__":
    main()
