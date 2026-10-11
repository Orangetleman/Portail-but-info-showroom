# -*- coding: utf-8 -*-
"""docs/*.md, lus et rendus en HTML : le convertisseur Markdown et l'inventaire.

Les pages qui les montrent (page_doc, page_docs_index) restent dans
build_site.py ; carte_site.py y prend le titre de chaque document. Ne dépend
que d'ossature.py.

Sorti de build_site.py le 1er octobre 2026 (conception § 45).
"""
import html
import re
from pathlib import Path

ROOT = Path(__file__).parent

from ossature import ancre_section, e


# --------------------------------------------------------------------------
# La documentation, lisible depuis l'administration (lot G)
# --------------------------------------------------------------------------
#
# docs/*.md sont la mémoire du projet ; jusqu'ici il fallait le dépôt pour
# les lire. Ils sont rendus en HTML sous /admin/docs/ — zone gardée par le
# middleware derrière super_user, comme /admin.html — par un convertisseur
# Markdown MINIMAL, sans dépendance, dans l'esprit de rendreMarkdown() des
# messages (assets/site.js) : titres, paragraphes, listes, code, citations,
# tableaux, filets, gras, italique, code en ligne, liens. Rien d'autre, et
# surtout pas de HTML brut : tout est échappé (un document est un texte, pas
# une page). Ce que le convertisseur ne connaît pas s'affiche tel quel, ce
# qui vaut mieux qu'un rendu faux.

DOCS = ROOT / "docs"

# Le journal de conception : un sommaire (docs/conception.md) et des parties
# par sujet (docs/conception-<sujet>.md). Les sections gardent d'une partie à
# l'autre le numéro qu'elles avaient dans le journal entier — c'est leur
# adresse : « conception § 44 » se cite partout, et se rend en lien.
JOURNAL = "conception"
_NUMERO = re.compile(r"(\d+(?: [a-z]+)?)\. ")
_RENVOI = re.compile(r"\bconception § (\d+(?: (?:bis|ter|quater|quinquies))?)")

# Ce qu'il faut savoir avant de lire tel document. Le prompt général de la
# feuille de route dit « ne lis PAS docs/archives/reprise-avant-refonte.md
# (périmé) » : le rendu le dit en tête, plutôt que de le taire ou de
# retirer le fichier.
DOCS_AVERTISSEMENTS = {
    "reprise-avant-refonte": "Périmé : ce document décrit l'état d'avant la refonte du "
                           "8 septembre 2026. Lire docs/conception.md à la place.",
}

_MD_TITRE = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
_MD_LISTE = re.compile(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$")
_MD_FILET = re.compile(r"^\s*([-*_])(\s*\1){2,}\s*$")
_MD_SEPARATEUR_TABLE = re.compile(r"^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")


def md_en_ligne(t: str, docs_connus: set, renvois: dict = None) -> str:
    """La mise en forme dans une ligne : code, liens, gras, italique, barré.

    On échappe d'abord, on met le code et les liens à l'abri (leur contenu ne
    se met pas en forme), puis on traite le reste. Une mention « docs/X.md »
    — dans le texte ou dans un code en ligne — devient un lien vers le rendu
    de X quand il existe : les documents se citent beaucoup entre eux. Un
    renvoi « conception § N » devient un lien vers la partie du journal qui
    porte la section N, à sa place (renvois : ancres_conception).
    """
    t = html.escape(t, quote=False)
    abris = []

    def abri(fragment):
        abris.append(fragment)
        return "\x00%d\x00" % (len(abris) - 1)

    def lien_doc(nom, texte):
        if nom in docs_connus:
            return '<a href="%s.html">%s</a>' % (e(nom), texte)
        return texte

    def code(m):
        contenu = m.group(1)
        md = re.fullmatch(r"docs/([A-Za-z0-9_-]+)\.md", contenu)
        dedans = lien_doc(md.group(1), contenu) if md else contenu
        return abri("<code>%s</code>" % dedans)

    t = re.sub(r"`([^`]+)`", code, t)
    t = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)",
               lambda m: abri('<a href="%s">%s</a>' % (m.group(2), m.group(1))), t)
    t = re.sub(r"docs/([A-Za-z0-9_-]+)\.md",
               lambda m: abri(lien_doc(m.group(1), m.group(0))), t)
    if renvois:
        t = _RENVOI.sub(lambda m: abri('<a href="%s">%s</a>' % (e(renvois[m.group(1)]), m.group(0)))
                        if m.group(1) in renvois else m.group(0), t)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)", r"<em>\1</em>", t)
    t = re.sub(r"(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?!\w)", r"<em>\1</em>", t)
    t = re.sub(r"~~(.+?)~~", r"<del>\1</del>", t)
    return re.sub(r"\x00(\d+)\x00", lambda m: abris[int(m.group(1))], t)


def md_vers_html(texte: str, docs_connus: set = frozenset(), renvois: dict = None) -> tuple:
    """Un document Markdown → (html, [(niveau, titre, id)]).

    Bloc par bloc : bloc de code (```), titre, filet, tableau, citation,
    liste, paragraphe. Un paragraphe ou un élément de liste continue sur les
    lignes suivantes jusqu'à une ligne vide ou le début d'un autre bloc —
    les documents sont écrits à 78 colonnes. Les titres reçoivent un
    identifiant (ancre_section, dédoublonné), pour le sommaire et les liens.
    """
    lignes = texte.replace("\r\n", "\n").split("\n")
    n = len(lignes)
    out, titres, ids_vus = [], [], set()

    def debut_de_bloc(l):
        return (l.startswith("```") or _MD_TITRE.match(l) or _MD_FILET.match(l)
                or l.startswith("|") or l.startswith(">") or _MD_LISTE.match(l))

    def ancre(titre):
        base = ancre_section(re.sub(r"[`*_~\[\]]", "", titre)) or "titre"
        cle, k = base, 2
        while cle in ids_vus:
            cle, k = "%s-%d" % (base, k), k + 1
        ids_vus.add(cle)
        return cle

    i = 0
    while i < n:
        l = lignes[i]
        if not l.strip():
            i += 1
            continue

        if l.startswith("```"):
            j = i + 1
            while j < n and not lignes[j].startswith("```"):
                j += 1
            out.append("<pre><code>%s</code></pre>" % html.escape("\n".join(lignes[i + 1:j]), quote=False))
            i = j + 1
            continue

        m = _MD_TITRE.match(l)
        if m:
            niveau, titre = len(m.group(1)), m.group(2)
            cle = ancre(titre)
            titres.append((niveau, re.sub(r"[`*_~]", "", titre), cle))
            out.append('<h%d id="%s">%s</h%d>' % (niveau, cle, md_en_ligne(titre, docs_connus, renvois), niveau))
            i += 1
            continue

        if _MD_FILET.match(l):
            out.append("<hr>")
            i += 1
            continue

        if l.startswith("|"):
            j = i
            while j < n and lignes[j].startswith("|"):
                j += 1
            rangs = [r for r in lignes[i:j] if not _MD_SEPARATEUR_TABLE.match(r)]
            entete = j - i > 1 and _MD_SEPARATEUR_TABLE.match(lignes[i + 1]) is not None
            def cellules(r):
                r = r.strip()
                if r.startswith("|"): r = r[1:]
                if r.endswith("|"): r = r[:-1]
                return [c.strip() for c in r.split("|")]
            corps = []
            for k, r in enumerate(rangs):
                balise = "th" if (entete and k == 0) else "td"
                corps.append("<tr>%s</tr>" % "".join("<%s>%s</%s>" % (balise, md_en_ligne(c, docs_connus, renvois), balise)
                                                     for c in cellules(r)))
            out.append('<div class="table-scroll"><table>%s</table></div>' % "".join(corps))
            i = j
            continue

        if l.startswith(">"):
            j = i
            while j < n and lignes[j].startswith(">"):
                j += 1
            dedans = "\n".join(re.sub(r"^>\s?", "", x) for x in lignes[i:j])
            out.append("<blockquote>%s</blockquote>" % md_vers_html(dedans, docs_connus, renvois)[0])
            i = j
            continue

        m = _MD_LISTE.match(l)
        if m:
            ordonnee = m.group(2)[0].isdigit()
            balise = "ol" if ordonnee else "ul"
            items, j = [], i
            while j < n:
                mm = _MD_LISTE.match(lignes[j])
                if not mm or mm.group(2)[0].isdigit() != ordonnee:
                    break
                contenu, j = [mm.group(3)], j + 1
                # continuation : lignes non vides, indentées, qui ne commencent pas un élément
                while j < n and lignes[j].strip() and lignes[j].startswith(" ") and not _MD_LISTE.match(lignes[j]):
                    contenu.append(lignes[j].strip())
                    j += 1
                items.append("<li>%s</li>" % md_en_ligne(" ".join(contenu), docs_connus, renvois))
            out.append("<%s>%s</%s>" % (balise, "".join(items), balise))
            i = j
            continue

        # un paragraphe : jusqu'à une ligne vide ou un autre bloc
        j = i + 1
        while j < n and lignes[j].strip() and not debut_de_bloc(lignes[j]):
            j += 1
        out.append("<p>%s</p>" % md_en_ligne(" ".join(x.strip() for x in lignes[i:j]), docs_connus, renvois))
        i = j

    return "\n".join(out), titres


def est_archive(nom: str) -> bool:
    """Un document rangé dans docs/archives/ : un écrit daté, pas de la doctrine.

    Une lettre envoyée, un dossier préparé pour un rendez-vous : cela se lit
    encore, mais ne se met pas à jour. On le range pour que la doctrine reste
    lisible — sans le retirer du site, car ce qui n'est plus rendu n'est plus lu.
    """
    return (DOCS / "archives" / (nom + ".md")).exists()


def est_partie_journal(nom: str) -> bool:
    """Une partie du journal de conception (docs/conception-<sujet>.md)."""
    return nom.startswith(JOURNAL + "-")


def ancres_conception(docs: list) -> dict:
    """Où vit chaque section du journal de conception : son numéro (« 44 »,
    « 7 ter ») → « conception-<sujet>.html#<ancre> ». Calculé par le même
    convertisseur que les pages : les deux ne peuvent pas diverger."""
    ancres = {}
    for nom, texte in docs:
        if not est_partie_journal(nom):
            continue
        for niv, titre, cle in md_vers_html(texte)[1]:
            m = _NUMERO.match(titre)
            if niv == 2 and m:
                ancres.setdefault(m.group(1), "%s.html#%s" % (nom, cle))
    return ancres


def docs_disponibles() -> list:
    """Les documents rendus : docs/*.md, puis docs/archives/*.md.

    Renvoie des couples (nom, texte). Le nom est le radical du fichier, et il
    sert d'adresse : deux documents ne peuvent pas porter le même, archive ou
    non — le contrôle ci-dessous le rappelle si cela arrive.
    """
    if not DOCS.exists():
        return []
    docs = [(f.stem, f.read_text(encoding="utf-8")) for f in sorted(DOCS.glob("*.md"))]
    docs += [(f.stem, f.read_text(encoding="utf-8"))
             for f in sorted((DOCS / "archives").glob("*.md"))]
    noms = [nom for nom, _ in docs]
    assert len(noms) == len(set(noms)), "deux documents portent le même nom : %s" % noms
    return docs


def resume_doc(texte: str) -> tuple:
    """Le titre (première ligne « # ») et le premier paragraphe d'un document."""
    titre, para = "", []
    for l in texte.replace("\r\n", "\n").split("\n"):
        if not titre:
            m = _MD_TITRE.match(l)
            if m:
                titre = re.sub(r"[`*_~]", "", m.group(2))
            continue
        if l.strip() and not _MD_TITRE.match(l) and not l.startswith(("|", ">", "```", "-", "*")):
            para.append(l.strip())
        elif para:
            break
    return titre, re.sub(r"[`*_~]", "", " ".join(para))
