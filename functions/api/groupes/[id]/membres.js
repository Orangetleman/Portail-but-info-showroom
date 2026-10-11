/* ==========================================================================
   /api/groupes/:id/membres — inviter, retirer, changer un rôle interne
   ==========================================================================

   POST    { pseudo }                → invite (qui a le droit d'inviter :
                                       administrateurs, ou tout membre si
                                       le groupe le permet — la base tranche)
   PATCH   { membre, role }          → « admin » : promouvoir (administrateurs)
                                       « membre » : retrograder — jamais le
                                       fondateur, et seulement dans sa chaîne
                                       de confiance (supabase/2026_roles_groupe.sql)
   DELETE  ?membre=<uuid>            → retire quelqu'un (chaîne de confiance),
                                       ou soi-même sans paramètre (toujours
                                       possible — sauf au fondateur tant qu'il
                                       reste quelqu'un : il transfère d'abord)

   Tout passe par des fonctions SQL qui vérifient elles-mêmes qui appelle :
   la route ne fait que transmettre et relire. Le message d'erreur de la
   base est celui qu'on affiche — c'est lui qui dit pourquoi (« Le fondateur
   du groupe ne peut pas être rétrogradé. »).
   ========================================================================== */

import { json, identifier, commeElle, messageDe } from "../../../_emploi.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Une fonction SQL absente (404 de PostgREST) : la migration des rôles
    n'est pas passée. On le dit, plutôt qu'un « échec » muet. */
function fonctionAbsente() {
  return json({ erreur: "Les rôles de groupe ne sont pas encore ouverts sur ce site "
                      + "(supabase/2026_roles_groupe.sql).", indisponible: true }, 503);
}


export async function onRequestPost(context) {
  const { request, env, params } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const id = String(params.id || "");
  if (!UUID.test(id)) return json({ erreur: "Groupe inconnu." }, 400);

  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  const pseudo = String((corps && corps.pseudo) || "").trim();
  if (!pseudo) return json({ erreur: "Il faut un pseudo." }, 400);

  const r = await commeElle(qui.jeton, env, "/rest/v1/rpc/inviter", {
    method: "POST", body: JSON.stringify({ g: id, pseudo_cible: pseudo }),
  });
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "L'invitation a échoué." }, 400);
  const nom = await r.json();
  return json({ ok: true, pseudo: nom, note: nom + " verra l'invitation sur sa page Groupes." });
}


export async function onRequestPatch(context) {
  const { request, env, params } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const id = String(params.id || "");
  if (!UUID.test(id)) return json({ erreur: "Groupe inconnu." }, 400);

  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  const membre = String((corps && corps.membre) || "");
  const role = String((corps && corps.role) || "");
  if (!UUID.test(membre)) return json({ erreur: "Membre inconnu." }, 400);
  if (!["admin", "membre"].includes(role)) return json({ erreur: "Rôle inconnu." }, 400);

  /* deux fonctions distinctes, parce que les deux gestes n'ont pas les
     mêmes conditions : nommer, tout administrateur ; retirer, la chaîne */
  let r = await commeElle(qui.jeton, env, "/rest/v1/rpc/" + (role === "admin" ? "promouvoir" : "retrograder"), {
    method: "POST", body: JSON.stringify({ g: id, cible: membre }),
  });
  if (r.status === 404) {
    /* la migration des rôles n'est pas passée : l'ancienne fonction (tout
       administrateur, jamais le dernier) tient lieu — le site ne doit pas
       casser entre le déploiement et la migration */
    r = await commeElle(qui.jeton, env, "/rest/v1/rpc/changer_role_groupe", {
      method: "POST", body: JSON.stringify({ g: id, cible: membre, nouveau: role }),
    });
    if (r.status === 404) return fonctionAbsente();
  }
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "Le changement a échoué." }, 400);
  return json({ ok: true, role: await r.json() });
}


export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const id = String(params.id || "");
  const membre = new URL(request.url).searchParams.get("membre") || qui.verdict.id;
  if (!UUID.test(id) || !UUID.test(membre)) return json({ erreur: "Groupe ou membre inconnu." }, 400);

  /* retirer() décide : soi-même (le fondateur excepté, s'il reste
     quelqu'un), ou quelqu'un que l'on a le droit de retirer. Elle renvoie
     vrai si une ligne est partie — on ne dit « fait » que sur ce vrai. */
  const r = await commeElle(qui.jeton, env, "/rest/v1/rpc/retirer", {
    method: "POST", body: JSON.stringify({ g: id, cible: membre }),
  });
  if (r.status === 404) return retirerSansMigration(qui, env, id, membre);
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "Le retrait a échoué." }, 400);
  const parti = await r.json();
  if (parti !== true) {
    return json({ erreur: "Cette personne n'est pas dans le groupe, ou tu ne peux pas la retirer." }, 404);
  }
  return json({ ok: true });
}


/** Tant que 2026_roles_groupe.sql n'est pas passée : l'ancien chemin, un
    DELETE direct que la règle « membres_sortie » d'alors autorise (soi-même,
    ou un administrateur). On garde le garde-fou d'avant : le dernier
    administrateur ne part pas s'il reste quelqu'un. Ce code disparaîtra
    avec la migration : retirer() fait tout cela, et la chaîne en plus. */
async function retirerSansMigration(qui, env, id, membre) {
  if (membre === qui.verdict.id) {
    const rA = await commeElle(qui.jeton, env,
      "/rest/v1/membres?select=membre,role_groupe&groupe=eq." + id + "&statut=eq.accepte&role_groupe=eq.admin");
    if (rA.ok) {
      const admins = await rA.json();
      if (admins.length === 1 && admins[0].membre === membre) {
        const rT = await commeElle(qui.jeton, env,
          "/rest/v1/membres?select=membre&groupe=eq." + id + "&statut=eq.accepte");
        const tous = rT.ok ? await rT.json() : [];
        if (tous.length > 1) {
          return json({ erreur: "Tu es le seul administrateur : nomme quelqu'un d'autre avant de partir, "
                              + "ou supprime le groupe." }, 400);
        }
      }
    }
  }
  const r = await commeElle(qui.jeton, env,
    "/rest/v1/membres?groupe=eq." + id + "&membre=eq." + membre + "&select=membre", {
      method: "DELETE", prefer: "return=representation",
    });
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "Le retrait a échoué." }, 400);
  const lignes = await r.json();
  if (!Array.isArray(lignes) || lignes.length !== 1) {
    return json({ erreur: "Cette personne n'est pas dans le groupe, ou tu ne peux pas la retirer." }, 404);
  }
  return json({ ok: true });
}
