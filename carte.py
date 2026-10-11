# -*- coding: utf-8 -*-
"""La carte du projet : la structure vient du code, les mots viennent d'un fichier.

Deux façons de tenir une carte d'architecture, et chacune a son défaut :

  - **tout écrire à la main** donne les bons mots, mais dérive en silence. Le
    jour où une fonction est renommée, la carte ment, et rien ne le dit.
  - **tout générer** ne dérive jamais, mais ne dit que des noms. Une liste de
    fonctions n'explique rien à qui découvre le projet.

Ici les deux sont séparés. **La structure est extraite du code** — les
fonctions de chaque script, les routes de l'API, les tables et les règles des
migrations, les pages produites, les clés retenues dans le navigateur — donc
elle ne peut pas être périmée : elle est relue à chaque construction. **Les
mots sont écrits à la main**, dans `docs/carte/textes.json`, et rattachés à un
identifiant. Quand le code perd un symbole, le texte qui le décrivait devient
orphelin, et `verifier_corpus.py` (question 11) le dit.

Un cadeau de ce dépôt : les fonctions Python y sont documentées à 78 %. La
**première ligne de la docstring** fait le texte « Technique » sans que
personne ne l'écrive deux fois. Ne reste à écrire que le texte
« Découverte » — celui qui parle à qui n'a pas lu le code.

Ce module ne dépend pas de build_site.py : c'est lui qui l'appelle.
"""
import ast
import datetime
import io
import json
import os
import re
import subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))

#: Ce qu'un nœud est, dans le code. Sert de légende et de filtre sur la page.
GENRES = {
    "domaine": u"domaine",
    "module":  u"module",
    "fn":      u"fonction",
    "route":   u"route",
    "table":   u"table",
    "sqlfn":   u"fonction SQL",
    "regle":   u"règle d'accès",
    "page":    u"page",
    "cle":     u"clé locale",
    "dossier": u"dossier",
}


def _lire(chemin: str) -> str:
    return io.open(os.path.join(ROOT, chemin), encoding="utf-8").read()


def charger_textes() -> dict:
    """Lit docs/carte/textes.json : les domaines, les modules, et les mots.

    Absent, la carte se construit quand même — sans domaine ni texte. Le site
    doit rester constructible ; c'est le vérificateur qui réclame, pas le
    générateur.
    """
    chemin = os.path.join(ROOT, "docs", "carte", "textes.json")
    if not os.path.exists(chemin):
        return {"domaines": [], "modules": [], "textes": {}}
    d = json.load(io.open(chemin, encoding="utf-8"))
    return {k: v for k, v in d.items() if not k.startswith("_")}


# ───────────────────────────── les extracteurs ──────────────────────────────

def fonctions_python(fichier: str) -> list:
    """Les fonctions de premier niveau d'un script : (nom, ligne, résumé).

    Le résumé est la **première ligne** de la docstring, sans le point final :
    c'est elle qui, par convention, dit ce que la fonction fait. Les fonctions
    dont le nom commence par « _ » sont des rouages internes, et n'encombrent
    pas la carte.
    """
    arbre = ast.parse(_lire(fichier))
    sortie = []
    for n in arbre.body:
        if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if n.name.startswith("_"):
            continue
        doc = ast.get_docstring(n) or ""
        resume = doc.strip().split("\n")[0].strip().rstrip(".")
        sortie.append((n.name, n.lineno, resume))
    return sortie


def _titre_entete(src: str, marque: str) -> str:
    """La première ligne parlante de l'en-tête d'un fichier.

    Les routes et les migrations de ce dépôt s'ouvrent toutes sur un cartouche
    qui dit, en une ligne, ce que le fichier fait. Cette ligne est déjà écrite,
    relue, et vieillit avec le code : la recopier dans la carte serait la
    faire vieillir deux fois. On la lit.
    """
    for ligne in src.split("\n")[:14]:
        l = ligne.strip()
        if marque == "js":
            # retirer les marques du commentaire, pas le premier « / » d'une
            # adresse : « /api/moi — … » doit rester « /api/moi — … »
            if l.startswith("/*"):
                l = l[2:]
            elif l.startswith("*"):
                l = l[1:]
            l = l.strip()
        else:
            if not l.startswith("--"):
                continue
            l = l.lstrip("-").strip()
        l = l.strip("=- \t*")
        if len(re.sub(r"[^\w]", "", l)) >= 8:
            return l
    return ""


def routes_api() -> list:
    """Les routes de l'API : (adresse, fichier, ligne du premier export).

    Cloudflare Pages Functions fait de l'arborescence l'adresse : un fichier
    `functions/api/groupes/[id]/index.js` répond à `/api/groupes/:id`. On lit
    donc les chemins, pas le contenu — et « [id] » devient « :id », comme dans
    la carte du site.
    """
    base = os.path.join(ROOT, "functions", "api")
    sortie = []
    for dossier, _, fichiers in os.walk(base):
        for f in sorted(fichiers):
            if not f.endswith(".js"):
                continue
            chemin = os.path.join(dossier, f)
            rel = os.path.relpath(chemin, ROOT).replace(os.sep, "/")
            adresse = "/" + rel[len("functions/"):]
            adresse = re.sub(r"/index\.js$", "", adresse)
            adresse = re.sub(r"\.js$", "", adresse)
            adresse = re.sub(r"\[(\w+)\]", r":\1", adresse)
            src = io.open(chemin, encoding="utf-8").read()
            m = re.search(r"export\s+(?:async\s+)?function\s+\w+", src)
            ligne = src[:m.start()].count("\n") + 1 if m else 1
            sortie.append((adresse or "/api", rel, ligne, _titre_entete(src, "js")))
    return sorted(sortie)


def _commentaire_au_dessus(lignes: list, ligne_objet: int, marque: str = "--") -> str:
    """Ce qui est écrit juste au-dessus d'un « create » : sa première phrase.

    Les migrations de ce dépôt expliquent chaque objet avant de le créer. On
    remonte le bloc de commentaires qui le précède — en sautant le « drop … if
    exists » qui s'intercale — et on garde sa PREMIÈRE ligne parlante : dans un
    bloc, c'est elle qui annonce, les suivantes développent.

    Les titres de section (« 1. Les tables ») sont écartés : ils reviendraient
    à l'identique sur tous les objets du fichier, et ne diraient rien.

    La marque est celle du commentaire d'une ligne dans le langage lu :
    « -- » en SQL, « // » dans le script des pages, « # » en Python.
    """
    bloc, i = [], ligne_objet - 2                       # -1 pour l'index, -1 pour remonter
    while i >= 0:
        l = lignes[i].strip()
        if not l or l.lower().startswith("drop "):
            i -= 1
            continue
        if not l.startswith(marque):
            break
        bloc.append(l.lstrip(marque[0]).strip())
        i -= 1
    for l in reversed(bloc):
        l = l.strip("=- \t")
        if re.match(r"^\d+[.)]\s", l) or len(re.sub(r"[^\w]", "", l)) < 12:
            continue
        return l
    return ""


def objets_sql() -> list:
    """Ce que chaque migration crée : (migration, genre, nom, fichier, ligne, texte).

    Trois genres seulement, ceux qu'on cherche quand on lit une migration :
    les tables, les fonctions, et les règles d'accès (`create policy`). Le
    reste — index, contraintes, droits — se lit dans le fichier.

    Renvoie aussi le titre de chaque migration, lu dans son cartouche.
    """
    base = os.path.join(ROOT, "supabase")
    sortie, titres = [], {}
    for f in sorted(os.listdir(base)):
        if not f.endswith(".sql"):
            continue
        rel = "supabase/" + f
        src = io.open(os.path.join(base, f), encoding="utf-8").read()
        lignes = src.split("\n")
        titres[f[:-4]] = _titre_entete(src, "sql")
        for motif, genre in ((r"create table if not exists public\.(\w+)", "table"),
                             (r"create or replace function public\.(\w+)\s*\(", "sqlfn"),
                             (r"create policy\s+\"?([\w -]+)\"?\s+on\s+public\.\w+", "regle")):
            for m in re.finditer(motif, src, re.I | re.S):
                ligne = src[:m.start()].count("\n") + 1
                sortie.append((f[:-4], genre, m.group(1).strip(), rel, ligne,
                               _commentaire_au_dessus(lignes, ligne)))
    return sortie, titres


def cles_locales() -> list:
    """Les clés retenues dans le navigateur : (clé, fichier, ligne, texte).

    Elles sont la mémoire de l'appareil — le thème, la dernière version des
    nouveautés vue, l'abonnement aux notifications. Les oublier dans une carte,
    c'est oublier pourquoi le site « se souvient » de quelque chose.

    On les cherche dans le script des pages, qui les lit et les écrit, puis
    dans build_site.py, qui produit le reste du JavaScript (service worker,
    configuration). Une clé vue deux fois garde sa première adresse.

    Le texte est le commentaire d'une ligne écrit juste au-dessus de cette
    première adresse — la même convention que pour un « create » de migration.
    """
    vues, sortie = set(), []
    for fichier, marque in (("assets/site.js", "//"), ("build_site.py", "#")):
        src = _lire(fichier)
        lignes = src.split("\n")
        for m in re.finditer(r'"(fiches-[a-z0-9-]+)"', src):
            if m.group(1) in vues:
                continue
            vues.add(m.group(1))
            ligne = src[:m.start()].count("\n") + 1
            sortie.append((m.group(1), fichier, ligne,
                           _commentaire_au_dessus(lignes, ligne, marque)))
    return sorted(sortie)


def corpus() -> list:
    """Le corpus, module par module : (code, intitulé, fiches, questions)."""
    sortie = []
    dossier = os.path.join(ROOT, "modules")
    for f in sorted(os.listdir(dossier)):
        if not f.endswith(".json"):
            continue
        d = json.load(io.open(os.path.join(dossier, f), encoding="utf-8"))
        q = os.path.join(ROOT, "questions", f)
        n = len(json.load(io.open(q, encoding="utf-8")).get("questions", [])) if os.path.exists(q) else 0
        sortie.append((d["code"], d.get("intitule", ""), len(d.get("parties", [])), n))
    return sortie


# ───────────────────────────── la structure ─────────────────────────────────

def structure() -> dict:
    """La carte entière : domaines déclarés, nœuds extraits, textes rattachés.

    Un nœud porte toujours sa **référence** « fichier:ligne », puisqu'il vient
    du code. Il porte « ingenieur » quand une docstring l'a donné, et
    « novice » quand quelqu'un l'a écrit. La page distingue les deux ; le
    vérificateur réclame ce qui manque au-dessus du niveau 2.
    """
    t = charger_textes()
    textes = t.get("textes") or {}
    noeuds = []

    def ajouter(id, label, niveau, parent, domaine, genre,
                ref=None, ingenieur=None):
        ecrit = textes.get(id) or {}
        noeuds.append({
            "id": id, "label": label, "niveau": niveau, "parent": parent,
            "domaine": domaine, "genre": genre, "ref": ref,
            "novice": ecrit.get("novice", ""),
            "ingenieur": ecrit.get("ingenieur") or ingenieur or "",
            "ecrit": bool(ecrit.get("ingenieur")),
        })

    for d in t.get("domaines") or []:
        ajouter(d["id"], d["label"], 0, None, d["id"], "domaine")

    for m in t.get("modules") or []:
        mid, dom, genre = m["id"], m["domaine"], m.get("type", "")
        ajouter(mid, m["label"], 1, dom, dom, "module", ref=m.get("source"))

        if genre == "python":
            for nom, ligne, resume in fonctions_python(m["source"]):
                ajouter("%s.%s" % (mid, nom), nom, 2, mid, dom, "fn",
                        ref="%s:%d" % (m["source"], ligne), ingenieur=resume)

        elif genre == "routes":
            for adresse, fichier, ligne, titre in routes_api():
                ajouter("%s.%s" % (mid, adresse.strip("/").replace("/", ".")),
                        adresse, 2, mid, dom, "route",
                        ref="%s:%d" % (fichier, ligne), ingenieur=titre)

        elif genre == "sql":
            objets, titres = objets_sql()
            vus = set()
            for migration, g, nom, fichier, ligne, autour in objets:
                sid = "%s.%s" % (mid, migration)
                if sid not in vus:
                    vus.add(sid)
                    ajouter(sid, migration, 2, mid, dom, "module", ref=fichier,
                            ingenieur=titres.get(migration, ""))
                ajouter("%s.%s" % (sid, nom), nom, 3, sid, dom, g,
                        ref="%s:%d" % (fichier, ligne), ingenieur=autour)

        elif genre == "cles":
            for cle, fichier, ligne, texte in cles_locales():
                ajouter("%s.%s" % (mid, cle), cle, 2, mid, dom, "cle",
                        ref="%s:%d" % (fichier, ligne), ingenieur=texte)

        elif genre == "corpus":
            for code, intitule, fiches, questions in corpus():
                ajouter("%s.%s" % (mid, code), code, 2, mid, dom, "dossier",
                        ref="modules/%s.json" % code,
                        ingenieur=u"%s — %d fiches, %d questions" % (intitule, fiches, questions))

    connus = {n["id"] for n in noeuds}
    return {
        "genere_le": datetime.date.today().isoformat(),
        "domaines": t.get("domaines") or [],
        "genres": GENRES,
        "noeuds": noeuds,
        "orphelins": sorted(set(textes) - connus),
        "sans_texte": sorted(n["id"] for n in noeuds
                             if n["niveau"] <= 1 and not n["novice"]),
    }


# ───────────────────────────── la frise ─────────────────────────────────────

def frise(limite: int = 120) -> list:
    """Les derniers commits : (date, titre, empreinte courte).

    Lue depuis git, jamais écrite à la main. Sans git — un déploiement qui ne
    reçoit que les fichiers —, la frise est simplement vide : le site se
    construit quand même.
    """
    try:
        sortie = subprocess.check_output(
            ["git", "log", "--date=short", "--format=%h\t%ad\t%s", "-n", str(limite)],
            cwd=ROOT, stderr=subprocess.DEVNULL).decode("utf-8", "replace")
    except (OSError, subprocess.CalledProcessError):
        return []
    lignes = []
    for l in sortie.strip().split("\n"):
        bouts = l.split("\t")
        if len(bouts) == 3:
            lignes.append({"sha": bouts[0], "date": bouts[1], "titre": bouts[2]})
    return lignes


if __name__ == "__main__":
    c = structure()
    print(u"%d nœuds, %d domaines, %d textes orphelins, %d sans texte"
          % (len(c["noeuds"]), len(c["domaines"]), len(c["orphelins"]), len(c["sans_texte"])))

    # Les nœuds muets, par genre. C'est le compteur du chantier n° 5 de
    # docs/chantiers.md : un nœud muet n'est pas un trou dans la carte, c'est
    # un endroit du code qui ne se présente pas — une fonction sans docstring,
    # un « create policy » sans commentaire au-dessus. On répare LÀ, et le
    # chiffre baisse tout seul. La liste complète sert à savoir où aller.
    muets = [n for n in c["noeuds"] if not n["novice"] and not n["ingenieur"]]
    if muets:
        par_genre = {}
        for n in muets:
            par_genre.setdefault(n["genre"], []).append(n)
        print(u"\n%d nœuds sans un mot :" % len(muets))
        for genre in sorted(par_genre, key=lambda g: -len(par_genre[g])):
            lot = par_genre[genre]
            print(u"  %-14s %3d" % (GENRES.get(genre, genre), len(lot)))
            for n in sorted(lot, key=lambda n: n["id"]):
                print(u"      %-34s %s" % (n["label"][:34], n["ref"] or ""))
