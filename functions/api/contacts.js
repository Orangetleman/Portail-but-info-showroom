/* ==========================================================================
   /api/contacts — mes contacts, mes demandes reçues et envoyées
   ==========================================================================

   GET     → { contacts: [ { id, membre, pseudo, depuis } ],
               recues:   [ { id, membre, pseudo, cree_le } ],
               envoyees: [ { id, membre, pseudo, cree_le, etat } ] }
   POST    { pseudo } → { ok, etat: "en_attente" | "accepte", pseudo }
             (une demande ; si l'autre m'avait déjà demandé, c'est accepté)
   PATCH   { id, accepte: true | false } → { ok, etat }
   DELETE  ?id=<uuid> → { ok }   (retirer un contact, ou une demande)

   Décision 4 de la feuille de route : un contact n'existe qu'après une
   demande acceptée. Tout passe par la table `contacts` et ses règles
   d'accès (supabase/2026_contacts.sql) avec le jeton de la personne :
   la route n'a aucun pouvoir propre. Le pseudo visé se résout dans
   `profiles` (le pseudo est public). Chaque écriture est relue.

   Une seule ligne par paire, quel que soit le sens. D'où les cas d'un POST
   quand une ligne existe déjà :
     - acceptée                → « déjà en contact » (400) ;
     - en attente, de moi      → « déjà demandé » (400) ;
     - en attente, vers moi    → j'accepte (les deux voulaient) ;
     - refusée, de moi         → « refusée » (400) : c'est à l'autre de faire
                                  le premier pas, pas à moi d'insister ;
     - refusée, vers moi       → j'avais refusé, je demande maintenant :
                                  la ligne est remplacée.
   ========================================================================== */

import { json, identifier, commeElle, messageDe } from "../_emploi.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLS = "id,de,vers,etat,cree_le,repondu_le,"
  + "de_profil:profiles!contacts_de_profil_fkey(pseudo),vers_profil:profiles!contacts_vers_profil_fkey(pseudo)";

function tableAbsente() {
  return json({ erreur: "Les contacts ne sont pas encore ouverts sur ce site (supabase/2026_contacts.sql).",
                indisponible: true }, 503);
}

function pseudoDe(l, cote) {
  const p = l[cote + "_profil"];
  return (p && p.pseudo) || "compte supprimé";
}


export async function onRequestGet(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const moi = qui.verdict.id;

  const r = await commeElle(qui.jeton, env,
    "/rest/v1/contacts?select=" + COLS + "&or=(de.eq." + moi + ",vers.eq." + moi + ")&order=cree_le.desc&limit=1000");
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: "La base n'a pas répondu : " + ((await messageDe(r)) || r.status) }, 502);
  const lignes = await r.json();
  const contacts = [], recues = [], envoyees = [];
  for (const l of lignes) {
    const autre = l.de === moi ? "vers" : "de";
    if (l.etat === "accepte") {
      contacts.push({ id: l.id, membre: l[autre], pseudo: pseudoDe(l, autre), depuis: l.repondu_le || l.cree_le });
    } else if (l.de === moi) {
      envoyees.push({ id: l.id, membre: l.vers, pseudo: pseudoDe(l, "vers"), cree_le: l.cree_le, etat: l.etat });
    } else if (l.etat === "en_attente") {
      recues.push({ id: l.id, membre: l.de, pseudo: pseudoDe(l, "de"), cree_le: l.cree_le });
    }
    /* une demande que J'AI refusée n'est plus montrée : elle ne demande rien */
  }
  contacts.sort((a, b) => a.pseudo.localeCompare(b.pseudo, "fr"));
  return json({ contacts, recues, envoyees });
}


export async function onRequestPost(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const moi = qui.verdict.id;

  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  const pseudo = String((corps && corps.pseudo) || "").trim();
  if (!pseudo || pseudo.length > 40) return json({ erreur: "Il faut un pseudo." }, 400);

  /* Qui est-ce ? Le pseudo est public : on le cherche avec mon jeton. */
  const rP = await commeElle(qui.jeton, env,
    "/rest/v1/profiles?select=id,pseudo&pseudo=ilike." + encodeURIComponent(pseudo.replace(/[%*]/g, "")) + "&supprime_le=is.null&limit=2");
  if (!rP.ok) return json({ erreur: "La base n'a pas répondu." }, 502);
  const profils = await rP.json();
  /* ilike sans joker = égalité sans la casse ; « _ » y est un joker d'un
     caractère, donc on relit le pseudo rendu pour exiger l'égalité vraie */
  const cible = (Array.isArray(profils) ? profils : []).find((p) => String(p.pseudo || "").toLowerCase() === pseudo.toLowerCase());
  if (!cible) return json({ erreur: "Aucun compte avec le pseudo « " + pseudo + " »." }, 404);
  if (cible.id === moi) return json({ erreur: "C'est toi." }, 400);

  /* Une ligne existe-t-elle déjà pour cette paire ? */
  const rE = await commeElle(qui.jeton, env,
    "/rest/v1/contacts?select=" + COLS + "&or=(and(de.eq." + moi + ",vers.eq." + cible.id + "),and(de.eq." + cible.id + ",vers.eq." + moi + "))&limit=1");
  if (rE.status === 404) return tableAbsente();
  if (!rE.ok) return json({ erreur: "La base n'a pas répondu." }, 502);
  const existantes = await rE.json();
  const l = Array.isArray(existantes) && existantes[0];
  if (l) {
    if (l.etat === "accepte") return json({ erreur: cible.pseudo + " est déjà dans tes contacts." }, 400);
    if (l.etat === "en_attente" && l.de === moi) return json({ erreur: "Tu as déjà demandé " + cible.pseudo + " : c'est à cette personne de répondre." }, 400);
    if (l.etat === "en_attente" && l.vers === moi) {
      /* l'autre m'avait demandé : nous voulons tous les deux, c'est accepté */
      const ok = await repondre(qui, env, l.id, true);
      if (ok.erreur) return json({ erreur: ok.erreur }, ok.code || 400);
      return json({ ok: true, etat: "accepte", pseudo: cible.pseudo });
    }
    if (l.etat === "refuse" && l.de === moi) return json({ erreur: cible.pseudo + " a refusé ta demande." }, 400);
    /* refusée par moi : je change d'avis, la ligne est remplacée */
    const rD = await commeElle(qui.jeton, env, "/rest/v1/contacts?id=eq." + l.id + "&select=id", { method: "DELETE", prefer: "return=representation" });
    if (!rD.ok || (await rD.json()).length !== 1) return json({ erreur: "L'ancienne demande n'a pas pu être retirée." }, 502);
  }

  const r = await commeElle(qui.jeton, env, "/rest/v1/contacts?select=id,etat", {
    method: "POST", prefer: "return=representation", body: JSON.stringify({ de: moi, vers: cible.id }),
  });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "La demande n'a pas été enregistrée." }, 400);
  const ecrit = await r.json();
  if (!Array.isArray(ecrit) || ecrit.length !== 1) return json({ erreur: "La base n'a rien écrit." }, 502);
  return json({ ok: true, etat: "en_attente", pseudo: cible.pseudo }, 201);
}


/** Marque la réponse ; la règle d'accès ne laisse passer que la personne
    visée, sur une demande en attente : 0 ligne = refus, dit comme tel. */
async function repondre(qui, env, id, accepte) {
  const r = await commeElle(qui.jeton, env, "/rest/v1/contacts?id=eq." + id + "&select=id,etat", {
    method: "PATCH", prefer: "return=representation",
    body: JSON.stringify({ etat: accepte ? "accepte" : "refuse", repondu_le: new Date().toISOString() }),
  });
  if (r.status === 404) return { erreur: "Les contacts ne sont pas encore ouverts.", code: 503 };
  if (!r.ok) return { erreur: (await messageDe(r)) || "La réponse n'a pas été enregistrée." };
  const lignes = await r.json();
  if (!Array.isArray(lignes) || lignes.length !== 1) {
    return { erreur: "Cette demande n'existe pas, ne t'est pas adressée, ou a déjà reçu une réponse.", code: 404 };
  }
  return { etat: lignes[0].etat };
}


export async function onRequestPatch(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  const id = String((corps && corps.id) || "");
  if (!UUID.test(id)) return json({ erreur: "Demande inconnue." }, 400);
  const ok = await repondre(qui, env, id, corps.accepte === true);
  if (ok.erreur) return json({ erreur: ok.erreur }, ok.code || 400);
  return json({ ok: true, etat: ok.etat });
}


export async function onRequestDelete(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!UUID.test(id)) return json({ erreur: "Contact inconnu." }, 400);
  const r = await commeElle(qui.jeton, env, "/rest/v1/contacts?id=eq." + id + "&select=id", {
    method: "DELETE", prefer: "return=representation",
  });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "Le retrait a échoué." }, 400);
  const lignes = await r.json();
  if (!Array.isArray(lignes) || lignes.length !== 1) return json({ erreur: "Ce contact n'existe pas, ou n'est pas le tien." }, 404);
  return json({ ok: true });
}
