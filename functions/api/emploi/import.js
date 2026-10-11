/* ==========================================================================
   /api/emploi/import — déposer un fichier .ics
   ==========================================================================

   POST  le contenu du fichier, tel quel (text/calendar) → { ok, ecrits,
         ignores, nom }.

   L'autre porte, pour qui ne veut pas confier un lien : télécharger son
   calendrier une fois et le déposer. Même analyseur, même table, même
   identifiant (l'UID du VEVENT) : déposer deux fois le même fichier — ou
   déposer le fichier puis suivre le lien — ne double rien.

   Un fichier est une photo à un instant : on ajoute et on met à jour, on
   ne retire rien (voir verserCalendrier). Ce qu'il faut retirer se retire
   à la main, ou en suivant le lien, qui lui sait ce qui a disparu.
   ========================================================================== */

import { json, identifier, verserCalendrier, tableAbsente } from "../../_emploi.js";
import { lireCalendrier } from "../../_ics.js";

const TAILLE_MAX = 3 * 1024 * 1024;


export async function onRequestPost(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  const longueur = Number(request.headers.get("content-length") || 0);
  if (longueur > TAILLE_MAX) return json({ erreur: "Fichier trop gros (3 Mo au plus)." }, 413);

  let texte = "";
  try { texte = await request.text(); } catch (err) { return json({ erreur: "fichier illisible" }, 400); }
  if (texte.length > TAILLE_MAX) return json({ erreur: "Fichier trop gros (3 Mo au plus)." }, 413);
  if (!/BEGIN:VCALENDAR/i.test(texte)) {
    return json({ erreur: "Ce fichier n'est pas un calendrier (.ics) : il ne commence pas par BEGIN:VCALENDAR." }, 400);
  }

  const lu = lireCalendrier(texte, "Europe/Paris");
  if (!lu.evenements.length) {
    return json({ erreur: "Aucun événement lisible dans ce fichier"
                        + (lu.ignores ? " (" + lu.ignores + " sans identifiant ou sans date)." : ".") }, 400);
  }

  const v = await verserCalendrier(qui.jeton, env, lu.evenements, null);
  if (!v.ok) return v.indisponible ? tableAbsente() : json({ erreur: v.erreur }, 400);

  return json({ ok: true, ecrits: v.ecrits, ignores: lu.ignores, nom: lu.nom || "" });
}
