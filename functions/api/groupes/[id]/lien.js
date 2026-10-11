/* ==========================================================================
   /api/groupes/:id/lien — MON lien d'invitation dans ce groupe (et, pour un
   administrateur, ceux des autres)
   ==========================================================================

   GET     → { lien: { code, url, expire_le, usages, usages_max } | null,
               autres: [ { code, url, expire_le, usages, usages_max, pseudo } ] }
             mon lien actif ; « autres » = les liens actifs des autres
             membres — la base ne les montre qu'aux administrateurs (règle
             liens_visibles), un membre reçoit une liste vide
   POST    → { ok, lien }   m'en fabrique un neuf (mon précédent est révoqué)
   DELETE  ?code=<code>     révoque ce lien (le mien, ou n'importe lequel si
                            je suis administrateur) ; sans code : les miens

   Depuis le lot D (supabase/2026_roles_groupe.sql), chaque membre crée SON
   lien, si le groupe le permet (parametres.inviter = « membres », le
   défaut) ou s'il est administrateur. La page « rejoindre » dit qui invite.
   Le code est tiré ici, au hasard (16 octets) : la base ne le devine pas.
   Les règles d'accès de la table font le tri : pour qui n'a pas le droit,
   la base n'écrit rien — et la route le dit.
   ========================================================================== */

import { json, identifier, commeElle, messageDe } from "../../../_emploi.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Za-z0-9_-]{8,64}$/;
const COLONNES = "code,expire_le,usages,usages_max,revoque_le,cree_par,auteur:profiles!liens_invitation_cree_par_fkey(pseudo)";

function tableAbsente() {
  return json({ erreur: "Les liens d'invitation ne sont pas encore ouverts (supabase/2026_liens_invitation.sql).", indisponible: true }, 503);
}

function presenter(l, origine) {
  return { code: l.code, url: origine + "/groupes/rejoindre.html?code=" + encodeURIComponent(l.code),
           expire_le: l.expire_le, usages: l.usages, usages_max: l.usages_max,
           pseudo: (l.auteur && l.auteur.pseudo) || null };
}

/** Les liens actifs du groupe que la base me laisse voir : les miens, et
    tous si je suis administrateur. */
async function liensActifs(jeton, env, id) {
  const r = await commeElle(jeton, env,
    "/rest/v1/liens_invitation?select=" + COLONNES + "&groupe=eq." + id + "&revoque_le=is.null"
    + "&expire_le=gt." + encodeURIComponent(new Date().toISOString()) + "&order=cree_le.desc");
  if (r.status === 404) return { absente: true };
  if (!r.ok) return { erreur: (await messageDe(r)) || r.status };
  const lignes = await r.json();
  return { liens: Array.isArray(lignes) ? lignes : [] };
}

function codeNeuf() {
  const octets = new Uint8Array(16);
  crypto.getRandomValues(octets);
  let s = "";
  octets.forEach((o) => { s += String.fromCharCode(o); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const id = String(params.id || "");
  if (!UUID.test(id)) return json({ erreur: "Groupe inconnu." }, 400);
  const a = await liensActifs(qui.jeton, env, id);
  if (a.absente) return tableAbsente();
  if (a.erreur) return json({ erreur: "La base n'a pas répondu : " + a.erreur }, 502);
  const origine = new URL(request.url).origin;
  const miens = a.liens.filter((l) => l.cree_par === qui.verdict.id);
  const autres = a.liens.filter((l) => l.cree_par !== qui.verdict.id);
  return json({ lien: miens[0] ? presenter(miens[0], origine) : null,
                autres: autres.map((l) => presenter(l, origine)) });
}

export async function onRequestPost(context) {
  const { request, env, params } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const id = String(params.id || "");
  if (!UUID.test(id)) return json({ erreur: "Groupe inconnu." }, 400);

  /* un seul lien actif PAR PERSONNE : je révoque le mien, s'il existe —
     jamais ceux des autres (filtre cree_par = moi, en plus de la règle) */
  const r0 = await commeElle(qui.jeton, env,
    "/rest/v1/liens_invitation?groupe=eq." + id + "&cree_par=eq." + qui.verdict.id + "&revoque_le=is.null&select=code", {
      method: "PATCH", prefer: "return=minimal",
      body: JSON.stringify({ revoque_le: new Date().toISOString() }),
    });
  if (r0.status === 404) return tableAbsente();

  const r = await commeElle(qui.jeton, env, "/rest/v1/liens_invitation?select=" + COLONNES, {
    method: "POST", prefer: "return=representation",
    body: JSON.stringify({ code: codeNeuf(), groupe: id, cree_par: qui.verdict.id }),
  });
  if (!r.ok) {
    const m = await messageDe(r);
    /* la règle d'accès refuse : pas le droit d'inviter dans ce groupe */
    return json({ erreur: /policy|permission/i.test(m || "")
      ? "Tu ne peux pas inviter dans ce groupe : ses administrateurs se le réservent."
      : (m || "Le lien n'a pas été créé.") }, 403);
  }
  const lignes = await r.json();
  if (!Array.isArray(lignes) || lignes.length !== 1) return json({ erreur: "La base n'a rien écrit." }, 502);
  return json({ ok: true, lien: presenter(lignes[0], new URL(request.url).origin) }, 201);
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const id = String(params.id || "");
  if (!UUID.test(id)) return json({ erreur: "Groupe inconnu." }, 400);
  const code = new URL(request.url).searchParams.get("code") || "";
  if (code && !CODE.test(code)) return json({ erreur: "Lien inconnu." }, 400);

  /* avec un code : ce lien-là (la règle décide si j'y ai droit — le mien,
     ou administrateur) ; sans : les miens */
  const cible = code ? "&code=eq." + encodeURIComponent(code) : "&cree_par=eq." + qui.verdict.id;
  const r = await commeElle(qui.jeton, env,
    "/rest/v1/liens_invitation?groupe=eq." + id + cible + "&revoque_le=is.null&select=code", {
      method: "PATCH", prefer: "return=representation",
      body: JSON.stringify({ revoque_le: new Date().toISOString() }),
    });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "La révocation a échoué." }, 400);
  const lignes = await r.json();
  /* 0 ligne = rien à révoquer, ou pas le droit : on ne dit pas « fait » */
  if (code && (!Array.isArray(lignes) || !lignes.length)) {
    return json({ erreur: "Ce lien n'existe plus, ou tu ne peux pas le révoquer." }, 404);
  }
  return json({ ok: true, revoques: Array.isArray(lignes) ? lignes.length : 0 });
}
