# -*- coding: utf-8 -*-
"""L'ossature du site : les briques sans état que toutes les autres utilisent.

Échapper un texte (e), dater (date_fr), calculer une empreinte, nommer une
ancre de section, les pictogrammes. Rien ici ne lit un fichier ni l'état
d'une construction : c'est ce qui permet à zones.py, documents.py et
carte_site.py de vivre hors de build_site.py sans s'importer en rond.

Sorti de build_site.py le 1er octobre 2026 (conception § 45).
"""
import hashlib
import html
import re


def empreinte(*contenus) -> str:
    """Huit caractères tirés du contenu des ressources.

    Tant que rien ne change, l'empreinte ne bouge pas et le cache fait son
    travail. Dès qu'une ligne change, l'adresse change et le navigateur va
    chercher la nouvelle version. C'est le seul moyen fiable : demander
    gentiment de ne pas mettre en cache ne marche jamais complètement.
    """
    h = hashlib.sha1()
    for c in contenus:
        h.update(c.encode("utf-8"))
    return h.hexdigest()[:8]


MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
           "août", "septembre", "octobre", "novembre", "décembre"]


def date_fr(iso: str) -> str:
    """« 2026-09-22 » → « 22 septembre 2026 » ; tel quel si la forme est autre."""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", iso or "")
    if not m:
        return iso or ""
    jour = int(m.group(3))
    return "%s %s %s" % ("1er" if jour == 1 else jour, MOIS_FR[int(m.group(2)) - 1], m.group(1))


def ancre_section(texte: str) -> str:
    """L'identifiant d'une section : « organisation-physique-de-la-ram ».

    Minuscules et traits d'union, la forme fixee par conception § 2. Ce
    n'est PAS slug() : celui-la sert a retrouver les PDF sur le disque, et
    changer sa regle renommerait les 37 fichiers.
    """
    import unicodedata
    t = unicodedata.normalize("NFKD", texte)
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"[^A-Za-z0-9]+", "-", t).strip("-")
    return t.lower()


_H2 = re.compile(r'<h2><span class="rom">([IVX]+)\.</span>(.*?)</h2>', re.DOTALL)


def e(t) -> str:
    """Échappe un texte pour le glisser sans risque dans du HTML, attributs compris."""
    return html.escape(str(t), quote=True)


ICONES = {
    "telecharger": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 19h16"/></svg>',
    "imprimer": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 15h10v6H7z"/></svg>',
    "partager": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="m8.3 10.8 7.4-4.3M8.3 13.2l7.4 4.3"/></svg>',
    "livret": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v16"/><path d="M12 5a6 6 0 0 0-6-2H3v16h3a6 6 0 0 1 6 2"/><path d="M12 5a6 6 0 0 1 6-2h3v16h-3a6 6 0 0 0-6 2"/></svg>',
    # Le drapeau : « proposer » (lot G). Un fanion, pas un point d'exclamation.
    "proposer": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/></svg>',
}


def _texte_nu(brut: str) -> str:
    """Le texte d'un fragment de HTML, sans balise ni entité."""
    sans_rom = re.sub(r'<span class="rom">[^<]*</span>', "", brut)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", sans_rom))).strip()
