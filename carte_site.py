# -*- coding: utf-8 -*-
"""La carte du site : relit le dépôt (middleware, routes, migrations, pages) et en tire la structure.

Le même genre de travail que carte.py, sur un autre objet : carte.py dessine
le projet (ses fichiers et ses fonctions), celui-ci le site (ses zones
gardées, ses routes, sa base, ses pages). La page qui la montre (page_carte)
reste dans build_site.py. Les pages sont lues dans build_site.py PAR SON
NOM : une fonction page_* qui en sortirait disparaîtrait de la carte.

Sorti de build_site.py le 1er octobre 2026 (conception § 45).
"""
import datetime
import re
from pathlib import Path

ROOT = Path(__file__).parent

from documents import est_archive, resume_doc


# --------------------------------------------------------------------------
# La carte du site, générée depuis le code (lot G)
# --------------------------------------------------------------------------
#
# L'équivalent de docs/carte du site de philosophie — mais GÉNÉRÉ à chaque
# construction, donc jamais périmé, là où la leur est tenue à la main et
# vérifiée par un script anti-dérive. On lit le code lui-même :
#   - les zones gardées, dans functions/_middleware.js ;
#   - les routes, dans functions/api/ (chemin → adresse, méthodes exportées,
#     la ligne de titre de leur en-tête, les fonctions SQL et tables qu'elles
#     appellent) ;
#   - la base, dans supabase/*.sql (tables, colonnes ajoutées, fonctions,
#     règles d'accès, déclencheurs, et la ligne de titre de chaque migration) ;
#   - les pages, dans ce fichier (les fonctions page_*, leur docstring).
# Chaque nœud dit son fichier et sa ligne ; verifier_corpus.py (question 9)
# relit site/admin/carte.json et vérifie que chaque fichier existe encore.
# Les liens croisés (route → fonction SQL → migration ; zone → routes) sont
# calculés, pas écrits.

FONCTIONS = ROOT / "functions"
SUPABASE = ROOT / "supabase"


def _titre_entete(texte: str) -> str:
    """La ligne de titre d'un en-tête « /* ==== \n   /api/x — ce que c'est »
    ou « -- ==== \n -- Titre » : la première ligne non décorative."""
    for l in texte.split("\n")[:6]:
        l = l.strip().lstrip("/*-").strip()
        if l and not set(l) <= set("=-*/ "):
            return l
    return ""


def carte_zones() -> list:
    """Les zones gardées du site, lues dans le middleware : quel préfixe exige quel rôle."""
    src = (FONCTIONS / "_middleware.js").read_text(encoding="utf-8")
    zones = []
    for i, l in enumerate(src.split("\n"), 1):
        m = re.search(r'\{\s*prefixe:\s*"([^"]+)",\s*exige:\s*"([^"]+)"', l)
        if m:
            zones.append({"prefixe": m.group(1), "exige": m.group(2),
                          "fichier": "functions/_middleware.js", "ligne": i})
    return zones


def carte_routes() -> list:
    """Les routes de l'API : adresse, méthodes, et ce qu'elles appellent dans la base."""
    routes = []
    for f in sorted(FONCTIONS.glob("api/**/*.js")):
        rel = f.relative_to(ROOT).as_posix()
        chemin = "/" + f.relative_to(FONCTIONS).as_posix()[:-3]
        if chemin.endswith("/index"):
            chemin = chemin[:-6]
        adresse = re.sub(r"\[([a-z]+)\]", r":\1", chemin)   # [id] → :id, [membre] → :membre
        src = f.read_text(encoding="utf-8")
        methodes = re.findall(r"export\s+async\s+function\s+onRequest([A-Z][a-z]+)?\b", src)
        methodes = sorted({(m or "Toutes").upper() for m in methodes})
        titre = _titre_entete(src)
        if " — " in titre:
            titre = titre.split(" — ", 1)[1]
        rpc = sorted(set(re.findall(r"/rest/v1/rpc/([a-z_]+)", src)))
        tables = sorted(set(re.findall(r"/rest/v1/(?!rpc\b)([a-z_]+)", src)))
        aides = sorted(set(re.findall(r'from\s+"(?:\.\./)*(_[a-z_]+)\.js"', src)))
        routes.append({"adresse": adresse, "methodes": methodes, "titre": titre,
                       "fichier": rel, "ligne": 1, "rpc": rpc, "tables": tables, "aides": aides})
    return routes


def carte_base() -> list:
    """Les migrations : les tables, fonctions et règles d'accès que chacune crée."""
    migrations = []
    for f in sorted(SUPABASE.glob("*.sql")):
        src = f.read_text(encoding="utf-8")
        rel = f.relative_to(ROOT).as_posix()
        lignes = src.split("\n")
        def ou(motif):
            trouves = []
            for i, l in enumerate(lignes, 1):
                for m in re.finditer(motif, l, re.I):
                    trouves.append((m.group(1), i))
            return trouves
        # « create policy nom » peut être suivi de « on public.table » à la ligne d'après
        regles = []
        for m in re.finditer(r"create policy\s+(\w+)\s+on\s+public\.(\w+)", src, re.I | re.S):
            regles.append((m.group(1), m.group(2), src[:m.start()].count("\n") + 1))
        migrations.append({
            "nom": f.stem, "fichier": rel, "titre": _titre_entete(src),
            "tables": ou(r"create table if not exists public\.(\w+)"),
            "colonnes": [(t + "." + c, i) for (t, i), c in
                         [((m.group(1), i), m.group(2)) for i, l in enumerate(lignes, 1)
                          for m in re.finditer(r"alter table public\.(\w+)\s+add column(?: if not exists)?\s+(\w+)", l, re.I)]],
            "fonctions": ou(r"create or replace function public\.(\w+)\s*\("),
            "regles": regles,
            "declencheurs": ou(r"create (?:or replace )?trigger\s+(\w+)"),
        })
    return migrations


def carte_pages() -> list:
    """Les pages que produit ce script, chacune titrée par la docstring de sa fonction."""
    src = (ROOT / "build_site.py").read_text(encoding="utf-8")
    pages = []
    for m in re.finditer(r'^def (page_\w+)\(.*?\).*?:\n\s+"""(.*?)$', src, re.M):
        pages.append({"fonction": m.group(1), "titre": m.group(2).strip().rstrip("."),
                      "fichier": "build_site.py", "ligne": src[:m.start()].count("\n") + 1})
    return pages


def carte_du_site(docs: list) -> dict:
    """La carte du site entière : zones, routes, base, pages et documents, reliés entre eux."""
    zones, routes, base, pages = carte_zones(), carte_routes(), carte_base(), carte_pages()
    # les liens croisés
    ou_fonction = {fn: m["nom"] for m in base for fn, _ in m["fonctions"]}
    ou_table = {t: m["nom"] for m in base for t, _ in m["tables"]}
    for r in routes:
        r["migrations"] = sorted({ou_fonction[x] for x in r["rpc"] if x in ou_fonction}
                                 | {ou_table[x] for x in r["tables"] if x in ou_table})
        r["inconnus"] = sorted([x for x in r["rpc"] if x not in ou_fonction]
                               + [x for x in r["tables"] if x not in ou_table])
    for z in zones:
        z["routes"] = [r["adresse"] for r in routes
                       if r["adresse"] == z["prefixe"] or r["adresse"].startswith(z["prefixe"] + "/")]
    gardees = {a for z in zones for a in z["routes"]}
    for r in routes:
        r["zone"] = next((z["prefixe"] for z in zones if r["adresse"] in z["routes"]), None)
    return {
        "genere_le": datetime.date.today().isoformat(),
        "zones": zones, "routes": routes, "base": base, "pages": pages,
        "documents": [{"nom": nom,
                       "fichier": ("docs/archives/%s.md" if est_archive(nom) else "docs/%s.md") % nom,
                       "titre": resume_doc(texte)[0],
                       "archive": est_archive(nom)} for nom, texte in docs],
        "publiques": sorted(r["adresse"] for r in routes if r["adresse"] not in gardees),
    }
