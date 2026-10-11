# Brancher un outil sur le portail

Ce document décrit comment ajouter un outil au portail `exemple.fr` :
ce que tu obtiens, ce que tu dois fournir, et le format des deux fichiers qui
font parler les outils entre eux.

Il s'adresse à quelqu'un qui développe un outil de son côté et veut qu'il
apparaisse dans le portail sans renoncer à son autonomie.

---

## Le principe en trois phrases

Chaque outil est hébergé par la personne qui l'écrit, sur son propre dépôt et
son propre déploiement. Le portail leur prête une adresse commune, une
connexion commune, et une page d'accueil qui les présente sans distinction.
Les outils se répondent en publiant chacun un index de ce qu'il contient.

Ce qui reste séparé : le code, le dépôt, le déploiement, le rythme de travail.
Ce qui est partagé : le domaine, la session, et un vocabulaire.

Conséquence pratique : tu peux tout réécrire chez toi sans jamais rien casser
chez les autres, et tu déploies quand tu veux sans attendre la validation de
personne.

---

## Ce que tu reçois

### 1. Un sous-domaine

`outils.exemple.fr` (ou un autre nom) pointe vers ton projet
Cloudflare Pages. Tu n'as pas de nom de domaine à acheter.

Ce qu'il faut me donner pour que je le crée :

- le nom de ton projet Cloudflare Pages (celui qui donne `xxx.pages.dev`) ;
- le sous-domaine que tu veux.

Côté Cloudflare, l'opération se fait en deux temps : j'ajoute l'enregistrement
DNS sur mon domaine, tu ajoutes le domaine personnalisé dans ton projet Pages
(*Custom domains* → *Set up a custom domain*). Les deux sont nécessaires.

### 2. La session partagée

Le cookie de connexion est posé sur `.exemple.fr` — avec le point,
c'est-à-dire pour le domaine **et tous ses sous-domaines**. Quelqu'un se
connecte une fois sur le portail, et ton outil le reconnaît sans rien lui
redemander.

Tu n'as pas à le lire toi-même. Il est marqué `HttpOnly` : aucun script ne
peut y accéder, ce qui est précisément ce qui le rend sûr. Tu poses la
question au portail, qui te répond.

### 3. Une carte sur la page d'accueil

Elle est identique aux autres : même taille, même style, aucune mention
« externe ». Ton nom apparaît en signature, comme le mien.

---

## Savoir qui est connecté : `/api/moi`

Une seule adresse, aucun secret à conserver.

```js
const r = await fetch("https://exemple.fr/api/moi", {
  credentials: "include",          // sans ceci, le cookie n'est pas envoyé
});
const moi = await r.json();
// { "connecte": true, "adresse": "prenom.nom@universite-paris-saclay.fr",
//   "mode": "compte" }
```

| Champ | Ce qu'il vaut |
|---|---|
| `connecte` | `true` si la personne a une session valide |
| `adresse` | son adresse universitaire, ou `null` (voir ci-dessous) |
| `mode` | `compte`, `mot_de_passe` ou `ouvert` |

**Pourquoi `adresse` peut valoir `null`.** La porte d'entrée actuelle est un
mot de passe commun à la promo : on sait que la personne est entrée, mais pas
qui elle est. Quand la connexion par compte universitaire sera rétablie,
l'adresse sera renseignée sans que tu aies une ligne à changer — c'est tout
l'intérêt de passer par cette adresse plutôt que de décoder le cookie
toi-même.

Si tu construis quelque chose qui a besoin d'identifier les gens (une
progression, un suivi), prévois dès maintenant le cas `adresse: null`.

Cette adresse ne renvoie jamais d'erreur d'authentification : un visiteur non
connecté reçoit `connecte: false`. C'est une réponse, pas un refus.

---

## Le vocabulaire commun

Pour qu'un exercice puisse pointer vers une fiche, il faut que les deux
désignent la même chose. Le vocabulaire existe déjà et il est officiel : **le
code du module**, tel qu'il figure sur ton emploi du temps.

```
R101  R102  R104  R106  ...
```

Deux niveaux de finesse :

| Niveau | Exemple | Quand l'employer |
|---|---|---|
| Module | `R106` | la ressource concerne tout le module |
| Module + fiche | `R106`, fiches `[2]` | elle concerne une fiche précise |

Les numéros de fiche sont stables : ils ne changent pas quand j'en ajoute une.
La liste complète est dans `catalogue.json` (voir plus bas).

---

## L'index que tu publies

Un fichier JSON, servi par ton outil, qui liste ce que tu as. C'est lui qui
permet à une fiche d'afficher « À travailler avec ».

```json
{
  "schema": "outils-but/v1",
  "ressources": [
    {
      "type": "td",
      "titre": "TD 3 — Tables de vérité",
      "module": "R106",
      "fiches": [2],
      "url": "https://outils.exemple.fr/exos/r106-td3"
    },
    {
      "type": "seance",
      "titre": "CM — Logique propositionnelle",
      "module": "R106",
      "fiches": [1, 2],
      "date": "2026-09-14",
      "url": "https://outils.exemple.fr/agenda/2026-09-14"
    },
    {
      "type": "exercice",
      "titre": "Révisions de fin de module",
      "module": "R106",
      "url": "https://outils.exemple.fr/exos/r106-revisions"
    }
  ]
}
```

| Champ | Obligatoire | Détail |
|---|---|---|
| `type` | oui | `td`, `tp`, `exercice`, `correction`, `seance`, `cours`, `ressource`, `podcast` |
| `titre` | oui | une ligne, pas un paragraphe |
| `module` | oui | le code exact : `R106`, pas `r106` ni `R 106` |
| `fiches` | non | tableau de numéros. Absent = rattaché au module entier |
| `url` | non | **https obligatoire.** Sans elle, la carte s'affiche sans être cliquable |
| `date` | non | `AAAA-MM-JJ`, affichée telle quelle |

Un type inconnu s'affiche « Ressource » : rien ne casse, mais autant rester
dans la liste.

### Le piège à connaître : l'autorisation d'origine

Ton index est lu par une page servie depuis `exemple.fr`, c'est-à-dire
**une autre origine** que la tienne. Par défaut, le navigateur reçoit ta
réponse mais interdit au script de la lire. Ton serveur doit donc l'autoriser
explicitement :

```
Access-Control-Allow-Origin: https://exemple.fr
Access-Control-Allow-Credentials: true
Vary: Origin
```

Trois points qui coûtent une soirée quand on ne les connaît pas :

- `Access-Control-Allow-Origin: *` **ne marche pas** ici. L'étoile est
  incompatible avec l'envoi du cookie : il faut l'origine exacte.
- Sans `Allow-Credentials`, la réponse est rejetée elle aussi.
- `Vary: Origin` évite qu'un cache serve à quelqu'un une réponse destinée à
  une autre origine.

Sur Cloudflare Pages, le plus simple est un fichier `_headers` :

```
/index.json
  Access-Control-Allow-Origin: https://exemple.fr
  Access-Control-Allow-Credentials: true
  Vary: Origin
```

### Comment ton index est consommé

Il est lu **au chargement de la page**, pas à la génération du site. Tu
ajoutes un exercice, il apparaît dans la fiche correspondante sans que je
régénère quoi que ce soit.

Deux garde-fous, à connaître parce qu'ils dictent la façon de déboguer :

- **Délai de 4 secondes**, puis abandon silencieux. Si ton service est lent ou
  en panne, la fiche s'affiche sans le bloc — jamais d'erreur à l'écran.
- **Mise en cache de 5 minutes** par visite (dans `sessionStorage`). Si tu ne
  vois pas ta modification, c'est probablement ça : ouvre un onglet privé.

Enfin, une contrainte de sécurité que je ne lèverai pas : le contenu de ton
index n'est **jamais** inséré en HTML, uniquement en texte, et seules les
adresses en `https://` deviennent cliquables. Un `<b>` dans un titre
s'affichera littéralement. Ce n'est pas de la méfiance envers toi — c'est que
ton index devient une porte d'entrée dans mes pages, et une porte se ferme
même quand on connaît les gens.

---

## L'index que tu peux lire

Le catalogue des fiches est publié dans le même esprit :

```js
const r = await fetch("https://exemple.fr/catalogue.json", {
  credentials: "include",
});
const cat = await r.json();
```

```json
{
  "schema": "fiches-but/v1",
  "semestres": [
    { "numero": 1,
      "modules": [
        { "code": "R106", "intitule": "Mathématiques discrètes",
          "page": "fiches/s1/R106/index.html",
          "fiches": [
            { "numero": 2, "titre": "Vocabulaire ensembliste",
              "sommaire": ["…"], "pages": 6,
              "page": "fiches/s1/R106/02.html",
              "pdf": "pdf/Fiche_R106_02_….pdf",
              "pdf_livret": "pdf/livret/Fiche_R106_02_…_livret.pdf" } ] } ] }
  ]
}
```

Les chemins sont **relatifs à la racine du site** : préfixe-les par
`https://exemple.fr/`. L'autorisation d'origine est déjà en place de
mon côté pour les sous-domaines du portail.

C'est ce fichier qui te permet, dans ton agenda, d'afficher « les fiches de ce
module » avec leurs vrais titres.

Le registre des outils se lit de la même façon sur
`https://exemple.fr/apps.json`.

---

## Apparaître sur la page d'accueil

Le portail se construit à partir d'un seul fichier, `apps.json`, à la racine
du dépôt des fiches. Une entrée par outil :

```json
{
  "id": "agenda",
  "nom": "Agenda",
  "nom_court": "Agenda",
  "meta": "Séances à venir",
  "auteur": "Exemple nom",
  "icone": "agenda",
  "url": "https://outils.exemple.fr/agenda/",
  "index": "https://outils.exemple.fr/index.json",
  "liens": [{ "vers": "fiches", "sens": "vers" }],
  "actif": true
}
```

| Champ | À quoi il sert |
|---|---|
| `meta` | **trois ou quatre mots**, pas une phrase. La carte doit se saisir d'un coup d'œil |
| `nom_court` | le nom employé dans les pastilles de lien, où la place manque |
| `icone` | `fiches`, `agenda`, `exos`, `ressources` ou `outil` |
| `liens` | ce que ton outil relie, montré par une flèche : `sens` vaut `vers` (→), `depuis` (←) ou `double` (⇄) |
| `actif` | `false` affiche la carte en grisé avec la mention « bientôt » — utile pour annoncer un outil avant qu'il ne soit prêt |

Une règle de rédaction, sur le portail : **on montre, on n'explique pas.**
Une carte porte un pictogramme, un nom, une indication de trois mots et des
flèches. Ce qui se comprend d'un coup d'œil n'a pas à être lu — et une page
d'accueil qui se raconte est une page d'accueil qu'on ne lit pas.

Envoie-moi l'entrée, ou propose-la directement sur le dépôt.

---
