/* ==========================================================================
   /api/emploi/calendriers — les liens ICS suivis
   ==========================================================================

   GET     { calendriers: [ { id, nom, url, derniere_synchro, dernier_etat } ] }
   POST    { nom?, url } → ajoute un lien, puis le synchronise une première
           fois dans la foulée : on ne pose pas un lien sans vérifier qu'il
           répond et qu'il contient un calendrier.
   DELETE  ?id=… → retire le lien ET ce qu'il avait apporté (cascade en base).

   Le lien est un moyen d'accès personnel (conception § 9 bis). Il
   n'est lisible que par son propriétaire — règle d'accès « mes_calendriers »
   — et n'est jamais montré à l'administration. Ce que le serveur en fait :
   le lire, à la demande, avec le jeton de la personne, et rien conserver.
   ========================================================================== */

import { json, identifier, commeElle, messageDe, tableAbsente } from "../../_emploi.js";
import { synchroniser } from "./synchro.js";

const COLS = "id,nom,url,derniere_synchro,dernier_etat,cree_le";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


/** Un lien acceptable : http(s), sans identifiant dans l'adresse (« user:mdp@ »
    est un moyen d'accès qu'on ne veut pas voir transiter), et pas vers nous. */
function urlAcceptable(texte) {
  let u;
  try { u = new URL(String(texte || "").trim()); } catch (err) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  if (u.username || u.password) return null;
  if (/^(localhost|127\.|10\.|192\.168\.|\[::1\])/.test(u.hostname)) return null;
  if (u.href.length > 2000) return null;
  return u.href;
}


export async function onRequestGet(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  const r = await commeElle(qui.jeton, env, "/rest/v1/calendriers?select=" + COLS + "&order=cree_le.asc");
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: "La base n'a pas répondu." }, 502);
  return json({ calendriers: await r.json() });
}


export async function onRequestPost(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  let corps;
  try {
    corps = await request.json();
  } catch (err) {
    return json({ erreur: "requête illisible" }, 400);
  }
  const url = urlAcceptable(corps && corps.url);
  if (!url) return json({ erreur: "Il faut une adresse en https://… (celle que le portail donne pour Google Agenda ou Outlook)." }, 400);
  const nom = String((corps && corps.nom) || "Emploi du temps").trim().slice(0, 80) || "Emploi du temps";

  const r = await commeElle(qui.jeton, env, "/rest/v1/calendriers?select=" + COLS, {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify({ nom, url }),
  });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "Le lien n'a pas été enregistré." }, 400);
  const lignes = await r.json();
  if (!Array.isArray(lignes) || lignes.length !== 1) return json({ erreur: "La base n'a rien écrit." }, 502);
  const cal = lignes[0];

  /* Première synchronisation tout de suite : c'est elle qui dit si le lien
     vaut quelque chose. Un lien mort reste enregistré avec son état, pour
     que la personne voie pourquoi et corrige. */
  const bilan = await synchroniser(qui.jeton, env, cal);
  return json({ ok: true, calendrier: bilan.calendrier || cal, synchro: bilan }, 201);
}


export async function onRequestDelete(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  const id = new URL(request.url).searchParams.get("id") || "";
  if (!UUID.test(id)) return json({ erreur: "Calendrier inconnu." }, 400);

  const r = await commeElle(qui.jeton, env, "/rest/v1/calendriers?id=eq." + id + "&select=id", {
    method: "DELETE",
    prefer: "return=representation",
  });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: "La suppression a échoué." }, 400);
  const lignes = await r.json();
  if (!Array.isArray(lignes) || lignes.length !== 1) {
    return json({ erreur: "Ce calendrier n'existe pas, ou n'est pas à toi." }, 404);
  }
  return json({ ok: true });
}
