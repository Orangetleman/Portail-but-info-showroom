/* ==========================================================================
   /api/demande — demander l'accès aux fiches, et savoir où en est sa demande
   ==========================================================================

   GET   { role, demandes: [ { id, statut, justification, motif, cree_le,
           traite_le } ] } — les demandes de la personne connectée, la plus
           récente en premier. Vide si elle n'a jamais demandé.
   POST  { justification } → dépose une demande. Refus lisibles, venus de la
           base : déjà l'accès, déjà une demande en attente, pas de pseudo,
           texte trop court.

   Comme /api/admin/roles, cette fonction n'a aucun pouvoir propre : elle
   transmet le jeton de la personne, et c'est la base qui lit (règle d'accès
   « mes_demandes ») ou écrit (fonction « deposer_demande »), en vérifiant
   elle-même qui appelle. Le middleware garde déjà /api/demande derrière
   « connecté » ; la base recommence, et c'est voulu.
   ========================================================================== */

import { verifierJeton } from "../_verifier.js";
import { lireCookie, COOKIE } from "../_acces.js";
import { lireProfilBase, etatAffiche } from "../_profil.js";


function json(donnees, code) {
  return new Response(JSON.stringify(donnees), {
    status: code || 200,
    headers: { "content-type": "application/json", "Cache-Control": "private, no-store" },
  });
}


async function identifier(request, env) {
  if (!env.SUPABASE_URL) {
    return { ok: false, code: 501, message: "Les comptes ne sont pas activés sur ce site." };
  }
  const jeton = lireCookie(request, COOKIE);
  const verdict = await verifierJeton(jeton, env);
  if (!verdict.ok) return { ok: false, code: 401, message: "Il faut être connecté." };
  return { ok: true, jeton, verdict };
}


function commeElle(jeton, env, chemin, options) {
  const o = options || {};
  return fetch(env.SUPABASE_URL + chemin, {
    method: o.method || "GET",
    headers: {
      "Authorization": "Bearer " + jeton,
      "apikey": env.SUPABASE_ANON_KEY || "",
      "content-type": "application/json",
      "Accept": "application/json",
    },
    body: o.body,
  });
}


/** Le message de PostgREST, écrit pour être lu, plutôt qu'un code. */
async function messageDe(r) {
  try {
    const err = await r.json();
    return err.message || err.hint || "";
  } catch (e) {
    return "";
  }
}


export async function onRequestGet(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  const [profil, r] = await Promise.all([
    lireProfilBase(qui.jeton, env, qui.verdict.id),
    commeElle(qui.jeton, env,
      "/rest/v1/demandes_acces?select=id,statut,justification,motif,cree_le,traite_le"
      + "&order=cree_le.desc&limit=10"),
  ]);
  const vu = etatAffiche(qui.verdict, profil);

  /* 404 : la table n'existe pas encore (2026_demandes_acces.sql). La page
     doit le dire plutôt que d'afficher un formulaire qui échouera. */
  if (r.status === 404) {
    return json({ role: vu.role, pseudo: vu.pseudo, demandes: [], indisponible: true,
                  note: "Les demandes ne sont pas encore ouvertes sur ce site." });
  }
  if (!r.ok) return json({ erreur: "La base n'a pas répondu." }, 502);

  const demandes = await r.json();
  return json({ role: vu.role, pseudo: vu.pseudo, demandes: Array.isArray(demandes) ? demandes : [] });
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

  const texte = String((corps && corps.justification) || "").trim();
  if (texte.length < 30) {
    return json({ erreur: "Écris au moins quelques lignes : c'est ce texte qui est lu." }, 400);
  }
  if (texte.length > 2000) {
    return json({ erreur: "2000 caractères au plus." }, 400);
  }

  const r = await commeElle(qui.jeton, env, "/rest/v1/rpc/deposer_demande", {
    method: "POST",
    body: JSON.stringify({ texte }),
  });

  if (r.status === 404) {
    return json({ erreur: "Les demandes ne sont pas encore ouvertes sur ce site." }, 503);
  }
  if (!r.ok) {
    const detail = await messageDe(r);
    return json({ erreur: detail || "La demande n'a pas pu être enregistrée." }, 400);
  }

  /* La fonction renvoie l'identifiant créé : c'est la preuve que la ligne
     existe. Une réponse vide serait un « ça a marché » sans rien derrière. */
  const id = await r.json();
  if (!id) return json({ erreur: "La base n'a rien enregistré." }, 502);

  return json({ ok: true, id });
}
