/* ==========================================================================
   Lire un calendrier iCalendar (.ics) — RFC 5545
   ==========================================================================

   Le format est public et stable : c'est celui que le portail de l'IUT
   fournit pour Google Agenda ou Outlook, et celui de tous les calendriers.
   On n'en lit que ce dont l'emploi du temps a besoin : les VEVENT, avec
   leur identifiant (UID), leur début, leur fin, leur titre, leur lieu, leur
   description, et leur date de dernière modification.

   Ce module est PUR : pas de réseau, pas de base. Il prend un texte et rend
   des objets — c'est ce qui permet de le tester à part, avec des fichiers
   fabriqués, y compris cassés (scratchpad/test_ics.mjs de la session).

   Trois points du format qui piègent, et qui sont traités :

     - le PLIAGE : une ligne de plus de 75 octets est coupée, et la suite
       commence par une espace ou une tabulation. Il faut recoller avant de
       lire quoi que ce soit ;
     - les DATES : « 20260915T080000Z » est en UTC ; « 20260915T080000 » avec
       « TZID=Europe/Paris » est une heure murale de Paris, à convertir ; une
       « VALUE=DATE » (« 20260915 ») est une journée entière, sans heure ;
     - les TEXTES : « \n », « \, » et « \; » sont des séquences d'échappement,
       à défaire.

   Ce qui n'est PAS traité : les règles de récurrence (RRULE). Les exports
   d'emploi du temps déroulent les occurrences une par une, et c'est ce
   qu'on lit ; un événement qui porte une RRULE est marqué « recurrent » et
   importé une fois, à sa première date — le lecteur le voit, et sait.
   ========================================================================== */


/** Recolle les lignes pliées et normalise les fins de ligne. */
export function deplier(texte) {
  return String(texte || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
}


/** « DTSTART;TZID=Europe/Paris:20260915T080000 » →
    { nom: "DTSTART", params: { TZID: "Europe/Paris" }, valeur: "2026…" } */
export function lireLigne(ligne) {
  const deuxPoints = indexDuDeuxPoints(ligne);
  if (deuxPoints < 0) return null;
  const gauche = ligne.slice(0, deuxPoints);
  const valeur = ligne.slice(deuxPoints + 1);
  const morceaux = gauche.split(";");
  const nom = morceaux[0].toUpperCase();
  const params = {};
  for (const p of morceaux.slice(1)) {
    const egal = p.indexOf("=");
    if (egal > 0) {
      params[p.slice(0, egal).toUpperCase()] = p.slice(egal + 1).replace(/^"|"$/g, "");
    }
  }
  return { nom, params, valeur };
}


/* Le premier « : » qui n'est pas entre guillemets : un paramètre peut en
   contenir (TZID="Europe/Paris:oui"). */
function indexDuDeuxPoints(ligne) {
  let entreGuillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (c === '"') entreGuillemets = !entreGuillemets;
    else if (c === ":" && !entreGuillemets) return i;
  }
  return -1;
}


/** Défait les échappements d'un texte iCalendar. */
export function detexter(valeur) {
  return String(valeur || "")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}


/** Le décalage (en minutes) d'un fuseau IANA à un instant donné. Sans
    bibliothèque : on demande à Intl l'heure murale de cet instant dans le
    fuseau, et on la compare à l'heure UTC. */
function decalageMinutes(instantUtcMs, tzid) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tzid, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = {};
  for (const x of f.formatToParts(new Date(instantUtcMs))) p[x.type] = x.value;
  const mural = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((mural - instantUtcMs) / 60000);
}


/** Une heure murale « 20260915T080000 » dans un fuseau → ISO UTC.
    Deux passes : on suppose d'abord UTC, on lit le décalage à cet instant,
    on corrige — puis on relit le décalage à l'instant corrigé (autour d'un
    changement d'heure, la première lecture peut être fausse d'une heure). */
export function versUtc(mural, tzid) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/.exec(mural);
  if (!m) return null;
  const naif = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (!tzid) return new Date(naif).toISOString();       // heure « flottante » : on la prend telle quelle
  let decalage;
  try {
    decalage = decalageMinutes(naif, tzid);
    const essai = naif - decalage * 60000;
    decalage = decalageMinutes(essai, tzid);
  } catch (err) {
    return null;                                          // fuseau inconnu
  }
  return new Date(naif - decalage * 60000).toISOString();
}


/** Une propriété de date iCalendar → { iso, journee } ou null. */
export function lireDate(prop, tzidDefaut) {
  if (!prop) return null;
  const v = prop.valeur.trim();
  if (prop.params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    if (!m) return null;
    return { iso: `${m[1]}-${m[2]}-${m[3]}`, journee: true };
  }
  if (/Z$/.test(v)) {
    const iso = versUtc(v.slice(0, -1), null);
    return iso ? { iso, journee: false } : null;
  }
  const iso = versUtc(v, prop.params.TZID || tzidDefaut || null);
  return iso ? { iso, journee: false } : null;
}


/** Le calendrier entier → { evenements: [...], ignores: n, nom }.

    Chaque événement : { uid, titre, debut, fin, journee, lieu, description,
    modifie, recurrent }. Un VEVENT sans UID ou sans DTSTART est ignoré et
    compté : on ne fabrique pas d'identifiant à sa place, c'est lui qui rend
    une réimportation idempotente.

    `tzidDefaut` : le fuseau à supposer pour les heures sans TZID ni Z —
    l'emploi du temps d'un établissement français, c'est Europe/Paris. */
export function lireCalendrier(texte, tzidDefaut) {
  const lignes = deplier(texte);
  const evenements = [];
  let ignores = 0;
  let nom = "";
  let courant = null;
  let tzCalendrier = null;

  for (const brut of lignes) {
    if (!brut) continue;
    const l = lireLigne(brut);
    if (!l) continue;

    if (l.nom === "BEGIN" && l.valeur.toUpperCase() === "VEVENT") { courant = {}; continue; }
    if (l.nom === "END" && l.valeur.toUpperCase() === "VEVENT") {
      const ev = terminer(courant, tzCalendrier || tzidDefaut);
      if (ev) evenements.push(ev); else ignores++;
      courant = null;
      continue;
    }
    if (!courant) {
      if (l.nom === "X-WR-CALNAME") nom = detexter(l.valeur);
      if (l.nom === "X-WR-TIMEZONE") tzCalendrier = l.valeur.trim();
      continue;
    }
    /* Dans un VEVENT : on garde la première occurrence de chaque propriété. */
    if (!(l.nom in courant)) courant[l.nom] = l;
  }
  return { evenements, ignores, nom };
}


function terminer(props, tzidDefaut) {
  if (!props) return null;
  const uid = props.UID ? props.UID.valeur.trim() : "";
  const debut = lireDate(props.DTSTART, tzidDefaut);
  if (!uid || !debut) return null;

  let fin = lireDate(props.DTEND, tzidDefaut);
  if (!fin && props.DURATION) fin = plusDuree(debut, props.DURATION.valeur);
  if (!fin) fin = debut.journee ? debut : { iso: debut.iso, journee: false };

  const modifie = props["LAST-MODIFIED"] ? lireDate(props["LAST-MODIFIED"], "UTC") : null;

  return {
    uid,
    titre: detexter(props.SUMMARY ? props.SUMMARY.valeur : "") || "(sans titre)",
    debut: debut.iso,
    fin: fin.iso,
    journee: debut.journee,
    lieu: detexter(props.LOCATION ? props.LOCATION.valeur : ""),
    description: detexter(props.DESCRIPTION ? props.DESCRIPTION.valeur : ""),
    modifie: modifie ? modifie.iso : null,
    recurrent: !!props.RRULE,
  };
}


/* « PT1H30M », « P1D » : ajouté au début. Ce qui n'est pas lu vaut zéro. */
function plusDuree(debut, duree) {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(duree).trim());
  if (!m) return null;
  const ms = ((+m[1] || 0) * 7 * 86400 + (+m[2] || 0) * 86400
            + (+m[3] || 0) * 3600 + (+m[4] || 0) * 60 + (+m[5] || 0)) * 1000;
  if (debut.journee) {
    const d = new Date(debut.iso + "T00:00:00Z");
    return { iso: new Date(d.getTime() + ms).toISOString().slice(0, 10), journee: true };
  }
  return { iso: new Date(new Date(debut.iso).getTime() + ms).toISOString(), journee: false };
}
