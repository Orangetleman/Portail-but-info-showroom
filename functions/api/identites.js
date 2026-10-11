/* ==========================================================================
   /api/identites — les services reliés à un même compte
   ==========================================================================

   Un compte, plusieurs portes d'entrée. Se connecter par Google, par GitHub
   ou par mot de passe mène au même compte dès lors que l'adresse est la
   même : Supabase rattache l'identité à l'utilisateur existant. C'est déjà
   ce qui se passe aujourd'hui, mais sans que rien ne le montre — on est
   ramené à son compte sans savoir POURQUOI, ni ce qui est relié à quoi.

   Cette page rend l'invisible visible, et surtout révocable.

     GET     la liste des services reliés, et de ceux qui ne le sont pas
     POST    { fournisseur } → l'adresse où envoyer la personne pour relier
     DELETE  { identite }    → détacher un service

   ---------------------------------------------------------------------------
   Pourquoi passer par le serveur
   ---------------------------------------------------------------------------
   Le jeton vit dans un cookie HttpOnly : la page ne peut pas le lire, c'est
   ce qui le rend involable. Or les trois opérations ci-dessus l'exigent. Le
   serveur est donc le seul à pouvoir parler à Supabase au nom de la personne.

   Aucune clé de service ici : tout se fait avec le jeton de l'utilisateur.
   Supabase n'autorise donc que ce que CETTE personne a le droit de faire sur
   SON compte, et le serveur n'a aucun pouvoir particulier.

   ---------------------------------------------------------------------------
   Le garde-fou qui compte
   ---------------------------------------------------------------------------
   Détacher son dernier moyen de connexion, c'est se verrouiller dehors. Le
   cas n'est pas théorique : quelqu'un entré par Google, qui n'a jamais posé
   de mot de passe, n'a QUE cette identité. Supabase refuse déjà de retirer la
   dernière — mais son message est en anglais et parle d'« identity ». On
   refuse donc AVANT, avec une phrase qui dit quoi faire.
   ========================================================================== */

import { verifierJeton } from "../_verifier.js";
import { lireCookie, COOKIE } from "../_acces.js";
import { FOURNISSEURS } from "../_fournisseurs.js";

/* FOURNISSEURS est GÉNÉRÉ par build_site.py depuis auth.config.json, et non
   recopié ici. La première version portait la liste en dur, Facebook compris,
   alors que le registre le déclare désactivé : la page aurait proposé de
   relier un service qui n'existe pas.

   Elle reste une liste FERMÉE, et c'est ce qui compte pour la sécurité : le
   nom du fournisseur arrive du navigateur et part dans une adresse. */

/* « email » est une identité comme les autres pour Supabase : c'est celle du
   mot de passe et des liens par courriel. On l'affiche, on ne la propose pas
   à relier — on ne « relie » pas une adresse, on s'en sert pour s'inscrire. */
const NOMS = {
  email: "Adresse et mot de passe",
  google: "Google",
  github: "GitHub",
  discord: "Discord",
  facebook: "Facebook",
};


function json(donnees, code) {
  return new Response(JSON.stringify(donnees), {
    status: code || 200,
    headers: { "content-type": "application/json", "Cache-Control": "private, no-store" },
  });
}


/** Le jeton de la personne, ou null. */
async function jetonDe(request, env) {
  const jeton = lireCookie(request, COOKIE);
  const verdict = await verifierJeton(jeton, env);
  return verdict.ok ? jeton : null;
}


/** Ce que Supabase sait du compte, jeton en main. */
async function lireUtilisateur(jeton, env) {
  const r = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
    headers: {
      "Authorization": "Bearer " + jeton,
      "apikey": env.SUPABASE_ANON_KEY || "",
    },
  });
  if (!r.ok) return null;
  try { return await r.json(); } catch (err) { return null; }
}


/* ---------------------------------------------------------------- GET ---- */

export async function onRequestGet(context) {
  const { request, env } = context;
  const jeton = await jetonDe(request, env);
  if (!jeton) return json({ erreur: "il faut être connecté" }, 401);

  const u = await lireUtilisateur(jeton, env);
  if (!u) return json({ erreur: "compte introuvable" }, 404);

  const brutes = Array.isArray(u.identities) ? u.identities : [];
  const reliees = brutes.map((i) => ({
    id: i.identity_id || i.id,
    fournisseur: i.provider,
    nom: NOMS[i.provider] || i.provider,
    depuis: i.created_at || null,
  }));

  /* Ceux qu'on pourrait encore relier : la liste fermée, moins ce qui l'est
     déjà. On ne propose pas « email » — voir plus haut. */
  const deja = reliees.map((i) => i.fournisseur);
  const proposables = FOURNISSEURS
    .filter((f) => deja.indexOf(f) === -1)
    .map((f) => ({ fournisseur: f, nom: NOMS[f] }));

  return json({
    reliees: reliees,
    proposables: proposables,
    /* Sous ce seuil, détacher enfermerait dehors. Le calcul est ici et non
       dans la page : une règle de sécurité affichée n'est pas une règle
       appliquée. */
    detachable: reliees.length > 1,
  });
}


/* --------------------------------------------------------------- POST ---- */
/* Relier un service. On ne redirige pas depuis ici : Supabase exige le jeton
   dans un en-tête, ce qu'une navigation de navigateur ne sait pas faire. On
   lui demande donc l'adresse (« skip_http_redirect ») et on la renvoie à la
   page, qui s'y rendra. */

export async function onRequestPost(context) {
  const { request, env } = context;
  const jeton = await jetonDe(request, env);
  if (!jeton) return json({ erreur: "il faut être connecté" }, 401);

  let corps;
  try { corps = await request.json(); } catch (err) {
    return json({ erreur: "requête illisible" }, 400);
  }

  const fournisseur = String((corps && corps.fournisseur) || "");
  if (FOURNISSEURS.indexOf(fournisseur) === -1) {
    return json({ erreur: "service inconnu" }, 400);
  }

  const retour = new URL(request.url).origin + "/connexion?suite="
               + encodeURIComponent("/compte.html");

  const adresse = env.SUPABASE_URL
    + "/auth/v1/user/identities/authorize?provider=" + encodeURIComponent(fournisseur)
    + "&redirect_to=" + encodeURIComponent(retour)
    + "&skip_http_redirect=true";

  const r = await fetch(adresse, {
    headers: {
      "Authorization": "Bearer " + jeton,
      "apikey": env.SUPABASE_ANON_KEY || "",
    },
  });

  let d = null;
  try { d = await r.json(); } catch (err) { /* corps vide */ }

  if (!r.ok || !d || !d.url) {
    /* Le rattachement manuel est une option du projet Supabase, désactivée
       par défaut. Sans elle, cette requête échoue toujours — et le dire vaut
       mieux que de laisser croire à une panne passagère. */
    return json({
      erreur: "Impossible de relier ce service pour l'instant.",
      piste: "Si cela échoue pour tous les services, le rattachement manuel "
           + "est peut-être désactivé dans Supabase (Authentication → "
           + "« Allow manual linking »).",
      code_supabase: r.status,
    }, 502);
  }

  return json({ ok: true, url: d.url });
}


/* ------------------------------------------------------------- DELETE ---- */

export async function onRequestDelete(context) {
  const { request, env } = context;
  const jeton = await jetonDe(request, env);
  if (!jeton) return json({ erreur: "il faut être connecté" }, 401);

  let corps;
  try { corps = await request.json(); } catch (err) {
    return json({ erreur: "requête illisible" }, 400);
  }
  const identite = String((corps && corps.identite) || "");
  if (!identite) return json({ erreur: "identité non précisée" }, 400);

  /* On relit la liste avant d'agir. Deux raisons : vérifier que cette
     identité appartient bien à cette personne, et compter ce qui reste. */
  const u = await lireUtilisateur(jeton, env);
  const brutes = (u && Array.isArray(u.identities)) ? u.identities : [];

  const visee = brutes.find((i) => (i.identity_id || i.id) === identite);
  if (!visee) return json({ erreur: "identité introuvable" }, 404);

  if (brutes.length <= 1) {
    return json({
      erreur: "C'est ton seul moyen de te connecter : le détacher te "
            + "fermerait la porte. Relie d'abord un autre service, ou "
            + "donne-toi un mot de passe.",
    }, 409);
  }

  const r = await fetch(
    env.SUPABASE_URL + "/auth/v1/user/identities/" + encodeURIComponent(identite),
    {
      method: "DELETE",
      headers: {
        "Authorization": "Bearer " + jeton,
        "apikey": env.SUPABASE_ANON_KEY || "",
      },
    });

  if (!r.ok) {
    return json({
      erreur: "Le détachement a échoué.",
      code_supabase: r.status,
    }, 502);
  }

  return json({ ok: true, detache: NOMS[visee.provider] || visee.provider });
}
