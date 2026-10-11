#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Imposition en livret — BUT Informatique
========================================

Transforme un PDF A5 en un PDF A4 paysage prêt à être plié en carnet.

Le principe (« cahier piqué », saddle stitch) : on imprime en recto-verso,
on empile les feuilles, on plie l'ensemble en deux d'un coup, et les pages
tombent dans l'ordre. Pour que cela marche, l'ordre des pages sur les
feuilles n'est PAS 1-2-3-4 : la première feuille porte la dernière page à
gauche et la première à droite.

Pour 8 pages, les quatre faces imprimées sont donc :

    feuille 1 recto : 8 | 1        feuille 1 verso : 2 | 7
    feuille 2 recto : 6 | 3        feuille 2 verso : 4 | 5

Le nombre de pages doit être un multiple de 4 : on complète avec des pages
blanches si besoin.

Usage :  python livret.py fichier.pdf [sortie.pdf]
         (mais il est normalement appelé par build_site.py)
"""

import sys
from pathlib import Path

from pypdf import PdfReader, PdfWriter, Transformation
from pypdf.generic import RectangleObject

# Dimensions en points PostScript (1 pt = 1/72 pouce)
A5_L, A5_H = 419.53, 595.28     # A5 portrait
A4_L, A4_H = 841.89, 595.28     # A4 paysage : exactement deux A5 côte à côte


def ordre_livret(nb_pages: int) -> list:
    """Ordre d'imposition des pages, par face imprimée.

    Renvoie une liste de couples (gauche, droite), en indices 0-based, et
    None pour une page blanche. Chaque couple est une face de feuille ;
    elles se suivent recto, verso, recto, verso…
    """
    # On complète à un multiple de 4 : une feuille pliée porte 4 pages.
    total = nb_pages + (-nb_pages % 4)
    pages = list(range(nb_pages)) + [None] * (total - nb_pages)

    faces = []
    for i in range(total // 4):
        faces.append((pages[total - 1 - 2 * i], pages[2 * i]))       # recto
        faces.append((pages[1 + 2 * i], pages[total - 2 - 2 * i]))   # verso
    return faces


def imposer(pdf_in: Path, pdf_out: Path) -> int:
    """Écrit la version livret de pdf_in. Renvoie le nombre de feuilles."""
    lecteur = PdfReader(str(pdf_in))
    faces = ordre_livret(len(lecteur.pages))
    ecrivain = PdfWriter()

    # Centrage : deux A5 font 839,06 pt de large, l'A4 paysage 841,89.
    marge = (A4_L - 2 * A5_L) / 2

    for gauche, droite in faces:
        feuille = ecrivain.add_blank_page(width=A4_L, height=A4_H)
        for page_idx, decalage in ((gauche, marge), (droite, marge + A5_L)):
            if page_idx is None:
                continue                       # page blanche : rien à poser
            source = lecteur.pages[page_idx]
            # On recale la page sur son coin bas-gauche avant de la déplacer,
            # sinon un mediabox ne partant pas de (0,0) décalerait le résultat.
            origine_x = float(source.mediabox.left)
            origine_y = float(source.mediabox.bottom)
            feuille.merge_transformed_page(
                source,
                Transformation().translate(decalage - origine_x, -origine_y),
            )
        feuille.mediabox = RectangleObject((0, 0, A4_L, A4_H))

    with open(pdf_out, "wb") as f:
        ecrivain.write(f)
    return len(faces) // 2


def main():
    """Met en livret le PDF nommé sur la ligne de commande, à côté de lui ou là où l'on dit."""
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    entree = Path(sys.argv[1])
    sortie = Path(sys.argv[2]) if len(sys.argv) > 2 else \
        entree.with_name(entree.stem + "_livret.pdf")
    n = imposer(entree, sortie)
    print("%s -> %s (%d feuille(s) A4 recto-verso)" % (entree.name, sortie.name, n))


if __name__ == "__main__":
    main()
