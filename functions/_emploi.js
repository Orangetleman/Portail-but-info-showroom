/* ==========================================================================
   L'emploi du temps — ce que partagent ses routes
   ==========================================================================

   Les routes de /api/emploi n'ont aucun pouvoir propre, comme les autres :
   elles transmettent le jeton de la personne à PostgREST, et la règle
   d'accès « mes_evenements » (supabase/2026_emploi_du_temps.sql) fait le
   tri. Ce fichier porte ce qu'elles ont en commun : reconnaître la personne,
   parler à la base en son nom, valider un événement avant de l'écrire, et
   lire ce que la base a répondu — jamais supposer qu'elle a écrit.

   ─── Le modèle, côté site ───

   Un événement est une ligne de `evenements`. Les champs communs sont des
   colonnes ; « details » (JSON) porte ce qui dépend du type. Le serveur ne
   connaît PAS la liste des types : elle vit dans le registre du navigateur
   (TYPES_EVENEMENT, build_site.py), pour qu'ajouter un type ne touche ni la
   base ni ces routes. Le serveur vérifie la FORME (un mot en minuscules) et
   la base la contraint de la même façon.
   ========================================================================== */

import { verifierJeton } from "./_verifier.js";
import { lireCookie, COOKIE } from "./_acces.js";


export function json(donnees, code) {
  return new Response(JSON.stringify(donnees), {
    status: code || 200,
    headers: { "content-type": "application/json", "Cache-Control": "private, no-store" },
  });
}


export async function identifier(request, env) {
  if (!env.SUPABASE_URL) {
    return { ok: false, code: 501, message: "Les comptes ne sont pas activés sur ce site." };
  }
  const jeton = lireCookie(request, COOKIE);
  const verdict = await verifierJeton(jeton, env);
  if (!verdict.ok) return { ok: false, code: 401, message: "Il faut être connecté." };
  return { ok: true, jeton, verdict };
}


/** Appel à PostgREST au nom de la personne. `prefer` : l'en-tête Prefer
    (« return=representation » pour relire ce qui a été écrit). */
export function commeElle(jeton, env, chemin, options) {
  const o = options || {};
  const entetes = {
    "Authorization": "Bearer " + jeton,
    "apikey": env.SUPABASE_ANON_KEY || "",
    "content-type": "application/json",
    "Accept": "application/json",
  };
  if (o.prefer) entetes["Prefer"] = o.prefer;
  return fetch(env.SUPABASE_URL + chemin, { method: o.method || "GET", headers: entetes, body: o.body });
}


export async function messageDe(r) {
  try {
    const err = await r.json();
    /* Le code PostgREST (PGRST201, 42501…) dit la famille de la faute ; le
       message dit le reste. On les garde ensemble : c'est ce qu'on lit dans
       la console du navigateur quand une route répond 400. */
    const texte = err.message || err.hint || err.details || "";
    return err.code ? texte + " [" + err.code + "]" : texte;
  } catch (e) {
    return "";
  }
}


/** La réponse à une table absente : la migration n'est pas passée. On le
    dit au lieu de laisser la page tenter des écritures qui échoueront. */
export function tableAbsente() {
  return json({ erreur: "L'emploi du temps n'est pas encore ouvert sur ce site "
                      + "(supabase/2026_emploi_du_temps.sql).", indisponible: true }, 503);
}


const TYPE = /^[a-z_]{2,30}$/;

function dateValide(v) {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  if (isNaN(d)) return null;
  return d.toISOString();
}


/** Valide un événement venu du navigateur.

    `partiel` : une modification (PATCH) n'envoie que ce qui change ; une
    création exige titre et début. Renvoie { ok, ligne } ou { ok:false,
    erreur }. Ce qui n'est pas listé ici n'est pas transmis : le navigateur ne
    choisit ni « proprietaire », ni « source », ni « calendrier ». */
export function normaliserEvenement(corps, partiel) {
  const c = corps && typeof corps === "object" ? corps : {};
  const ligne = {};

  if ("type" in c || !partiel) {
    const t = String(c.type || "perso").trim();
    if (!TYPE.test(t)) return { ok: false, erreur: "Type d'événement mal formé." };
    ligne.type = t;
  }
  if ("titre" in c || !partiel) {
    const titre = String(c.titre || "").trim();
    if (!titre || titre.length > 200) return { ok: false, erreur: "Il faut un titre (200 caractères au plus)." };
    ligne.titre = titre;
  }
  if ("debut" in c || !partiel) {
    const d = dateValide(c.debut);
    if (!d) return { ok: false, erreur: "Il faut une date de début." };
    ligne.debut = d;
  }
  if ("fin" in c) {
    if (c.fin === null || c.fin === "") ligne.fin = null;
    else {
      const f = dateValide(c.fin);
      if (!f) return { ok: false, erreur: "Date de fin illisible." };
      ligne.fin = f;
    }
  }
  if (ligne.debut && ligne.fin && ligne.fin < ligne.debut) {
    return { ok: false, erreur: "La fin est avant le début." };
  }
  if ("journee" in c) ligne.journee = !!c.journee;
  if ("fait" in c) ligne.fait = c.fait === null ? null : !!c.fait;
  if ("details" in c) {
    if (c.details !== null && typeof c.details !== "object") {
      return { ok: false, erreur: "« details » doit être un objet." };
    }
    const texte = JSON.stringify(c.details || {});
    if (texte.length > 8000) return { ok: false, erreur: "Détails trop longs." };
    ligne.details = c.details || {};
  }
  if (!partiel && !("details" in ligne)) ligne.details = {};
  if ("rappels" in c) {
    const r = rappelsValides(c.rappels === null ? [] : c.rappels);
    if (!r) return { ok: false, erreur: "« rappels » : des minutes avant le début, entières, une semaine au plus, cinq au plus." };
    ligne.rappels = r;
  }

  if (partiel && Object.keys(ligne).length === 0) {
    return { ok: false, erreur: "Rien à modifier." };
  }
  return { ok: true, ligne };
}


/** Les colonnes qu'on renvoie au navigateur — jamais « proprietaire ».
    « rappels » (lot F) n'existe que si supabase/2026_notifications.sql est
    passée : sur un 400 qui la nomme, les routes relisent sans elle. */
export const COLONNES = "id,type,titre,debut,fin,journee,fait,details,rappels,source,source_id,calendrier,cree_le,modifie_le";
export const COLONNES_SANS_RAPPELS = COLONNES.replace(",rappels", "");


/** La base ne connaît pas encore une colonne (migration pas passée) :
    PostgREST répond 400 en la nommant. Renvoie son nom, ou null. */
export function colonneInconnue(code, message) {
  if (code !== 400 || !/column|colonne|schema cache/i.test(message || "")) return null;
  const m = /\b(rappels|fiches)\b/.exec(message || "");
  return m ? m[1] : null;
}


/** La liste des rappels (minutes avant le début) telle qu'on accepte de
    l'écrire : des entiers, 0 à 10080 (une semaine), cinq au plus, sans
    doublon, triés. null si la forme n'y est pas. */
export function rappelsValides(v) {
  if (!Array.isArray(v) || v.length > 5) return null;
  const propres = [];
  for (const x of v) {
    const n = Number(x);
    if (!Number.isInteger(n) || n < 0 || n > 10080) return null;
    if (!propres.includes(n)) propres.push(n);
  }
  return propres.sort((a, b) => a - b);
}


/* ==========================================================================
   Verser un calendrier lu (_ics.js) dans la table
   ==========================================================================

   Même chemin pour un fichier déposé et pour un lien suivi. Chaque VEVENT
   devient une ligne source = ics, source_id = UID ; l'index unique fait
   qu'une réimportation met à jour au lieu de dupliquer (« merge-duplicates »
   : PostgREST écrit ON CONFLICT DO UPDATE sur les colonnes envoyées).

   Pour un lien suivi (`calendrier` fourni), on retire aussi ce que le
   calendrier ne contient plus : un cours annulé doit disparaître. Pour un
   fichier, non : un fichier est une photo à un instant, pas la vérité du
   moment — on ajoute et on met à jour, on ne retire rien.

   Tout est relu dans la réponse de la base : le nombre renvoyé est celui
   des lignes écrites, pas celui des lignes envoyées.

   Le 15 septembre 2026 : l'upsert n'avait JAMAIS marché. L'index unique
   (evenements_source_unique) était partiel — « where source_id is not
   null » — et Postgres n'infère un index partiel pour ON CONFLICT que si
   la requête répète sa clause WHERE, ce que PostgREST n'écrit pas : 42P10
   à la planification, même sans conflit. supabase/2026_ics_upsert.sql
   remplace l'index. Tant qu'il n'est pas passé, on se rabat sur « effacer
   les lignes de ce calendrier, puis insérer » — même résultat visible,
   mais les identifiants changent (un fichier déposé, sans calendrier,
   retire alors ses propres UID avant de les réécrire).
   ========================================================================== */

/** Le refus 42P10 : l'index unique attendu par l'upsert n'existe pas sous
    la forme voulue. Exporté pour les tests. */
export function indexPartiel(code, message) {
  return code === 400 && /42P10|no unique or exclusion constraint/i.test(message || "");
}

/** Lit tous les UID que la base a déjà pour ce calendrier. Pages de 1000. */
async function idsDuCalendrier(jeton, env, calendrier) {
  const tous = [];
  for (let depuis = 0; ; depuis += 1000) {
    const r = await commeElle(jeton, env,
      "/rest/v1/evenements?select=id,source_id&calendrier=eq." + calendrier
      + "&limit=1000&offset=" + depuis);
    if (!r.ok) return null;
    const page = await r.json();
    tous.push(...page);
    if (page.length < 1000) break;
  }
  return tous;
}


export async function verserCalendrier(jeton, env, evenements, calendrier) {
  const lignes = evenements.map((ev) => ({
    type: "cours",
    titre: ev.titre.slice(0, 200),
    debut: ev.journee ? ev.debut + "T00:00:00Z" : ev.debut,
    fin: ev.journee ? ev.fin + "T00:00:00Z" : ev.fin,
    journee: ev.journee,
    details: { lieu: ev.lieu, description: ev.description.slice(0, 4000), recurrent: ev.recurrent },
    source: "ics",
    source_id: ev.uid.slice(0, 500),
    ...(calendrier ? { calendrier } : {}),
  }));

  let ecrits = 0, repli = false;
  /* Par paquets : un emploi du temps annuel fait des centaines de lignes,
     et une requête d'un mégaoctet finit par échouer sans dire pourquoi. */
  for (let i = 0; i < lignes.length; i += 200) {
    const paquet = lignes.slice(i, i + 200);
    let r = repli ? null : await commeElle(jeton, env,
      "/rest/v1/evenements?on_conflict=proprietaire,source,source_id&select=id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=representation",
        body: JSON.stringify(paquet),
      });
    if (r && r.status === 404) return { ok: false, indisponible: true };
    if (r && !r.ok) {
      const message = await messageDe(r);
      if (!indexPartiel(r.status, message)) return { ok: false, erreur: message || "La base a refusé l'écriture." };
      repli = true;
    }
    if (repli) {
      /* l'index n'est pas encore le bon (2026_ics_upsert.sql) : on efface
         ce que ce paquet va réécrire, puis on insère — par UID pour un
         fichier, et de toute façon par UID (le calendrier est nettoyé plus
         bas de ce qu'il ne contient plus) */
      const uids = paquet.map((l) => '"' + l.source_id.replace(/"/g, "") + '"').join(",");
      const d = await commeElle(jeton, env,
        "/rest/v1/evenements?source=eq.ics&source_id=in.(" + encodeURIComponent(uids) + ")", { method: "DELETE" });
      if (!d.ok && d.status !== 404) return { ok: false, erreur: (await messageDe(d)) || "La base a refusé l'effacement." };
      r = await commeElle(jeton, env, "/rest/v1/evenements?select=id", {
        method: "POST", prefer: "return=representation", body: JSON.stringify(paquet),
      });
      if (!r.ok) return { ok: false, erreur: (await messageDe(r)) || "La base a refusé l'écriture." };
    }
    const ecrit = await r.json();
    ecrits += Array.isArray(ecrit) ? ecrit.length : 0;
  }

  let supprimes = 0;
  if (calendrier) {
    const presents = new Set(lignes.map((l) => l.source_id));
    const existants = await idsDuCalendrier(jeton, env, calendrier);
    if (existants) {
      const partis = existants.filter((x) => !presents.has(x.source_id)).map((x) => x.id);
      for (let i = 0; i < partis.length; i += 100) {
        const r = await commeElle(jeton, env,
          "/rest/v1/evenements?id=in.(" + partis.slice(i, i + 100).join(",") + ")&select=id", {
            method: "DELETE",
            prefer: "return=representation",
          });
        if (r.ok) {
          const d = await r.json();
          supprimes += Array.isArray(d) ? d.length : 0;
        }
      }
    }
  }
  return { ok: true, ecrits, supprimes, repli };
}
