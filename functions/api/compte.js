/* ==========================================================================
   /api/compte — consulter et supprimer ses propres données
   ==========================================================================

   Le RGPD ne demande pas seulement d'informer : il demande que les droits
   soient exerçables. Une adresse de contact suffit légalement, mais un bouton
   qui supprime vraiment vaut mieux — c'est la différence entre un droit
   annoncé et un droit disponible.

   GET     renvoie tout ce qui est enregistré sur la personne connectée.
   DELETE  efface son compte, définitivement.

   Deux principes de conception, valables pour les deux verbes :

   1. On ne fait jamais confiance à ce que le navigateur affirme être. La
      personne n'est identifiée que par la signature de son jeton, vérifiée
      ici. Aucun paramètre d'adresse ou d'identifiant n'est accepté : on ne
      peut donc pas supprimer le compte de quelqu'un d'autre, même en
      trafiquant la requête.

   2. La clé « service_role » de Supabase est indispensable pour supprimer un
      compte : c'est la seule qui en a le droit. Elle vit UNIQUEMENT comme
      secret Cloudflare (Settings > Variables and Secrets, en « Secret »), et
      ne doit JAMAIS être écrite dans le dépôt ni dans auth.config.json — elle
      contourne toutes les règles d'accès de la base.

      Si elle est absente, la suppression n'échoue pas en silence : elle
      renvoie la marche à suivre par courriel. Un droit qui tombe en panne
      doit dire comment l'exercer autrement.
   ========================================================================== */

import { verifierJeton } from "../_verifier.js";
import { lireCookie, COOKIE } from "../_acces.js";
import { cookiesEffaces } from "../_session.js";
import { lireProfilBase, etatAffiche, derniereVisite } from "../_profil.js";


function json(donnees, code) {
  return new Response(JSON.stringify(donnees), {
    status: code || 200,
    headers: {
      "content-type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });
}


/** Identifie la personne par la SIGNATURE de son jeton, jamais par ses dires. */
async function identifier(request, env) {
  if (!env.SUPABASE_URL) {
    return { ok: false, code: 501, message: "Les comptes ne sont pas activés sur ce site." };
  }
  const jeton = lireCookie(request, COOKIE);
  const verdict = await verifierJeton(jeton, env);
  if (!verdict.ok) {
    return { ok: false, code: 401, message: "Il faut être connecté." };
  }
  return { ok: true, jeton, verdict };
}


/** Interroge Supabase avec le jeton de la personne : elle ne voit qu'elle-même. */
async function lireProfil(jeton, env) {
  const r = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
    headers: {
      "Authorization": "Bearer " + jeton,
      "apikey": env.SUPABASE_ANON_KEY || "",
    },
  });
  return r.ok ? r.json() : null;
}


/** GET : tout ce qui est enregistré, dans un format lisible par un humain. */
export async function onRequestGet(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  const profil = await lireProfil(qui.jeton, env);
  const meta = (profil && profil.user_metadata) || {};
  const [base, visite] = await Promise.all([
    lireProfilBase(qui.jeton, env, qui.verdict.id),
    derniereVisite(qui.jeton, env, qui.verdict.id),
  ]);
  const vu = etatAffiche(qui.verdict, base);

  /* On énumère explicitement ce qu'on renvoie plutôt que de recopier la
     réponse de Supabase : la personne doit voir la vérité de ce qui est
     conservé, pas un objet technique où elle ne reconnaîtrait rien. */
  return json({
    adresse: qui.verdict.email || (profil && profil.email) || null,
    pseudo: vu.pseudo,
    role: vu.role,
    role_actif: vu.role_actif,
    profil_absent: vu.profil_absent,
    compte_cree_le: (profil && profil.created_at) || null,
    derniere_connexion: (profil && profil.last_sign_in_at) || null,
    /* La visite notée par le site lui-même, au jour près : c'est une donnée
       enregistrée, donc elle se montre à la personne comme les autres — à
       elle seule (ma_derniere_visite(), 2026_profils_colonnes.sql). */
    derniere_visite: visite,
    fournisseur: (profil && profil.app_metadata && profil.app_metadata.provider) || null,
    consentement: {
      donne_le: meta.consentement_date || null,
      version_notice: meta.consentement_version || null,
    },
  });
}


/** DELETE : effacement définitif du compte de la personne connectée. */
export async function onRequestDelete(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  if (!env.SUPABASE_SERVICE_ROLE) {
    return json({
      erreur: "suppression automatique indisponible",
      marche_a_suivre: "Écris à " + (env.CONTACT_RGPD || "l'adresse indiquée sur la page « Données personnelles »")
                       + " : la suppression sera faite à la main, sous un mois au plus tard.",
    }, 503);
  }

  const profil = await lireProfil(qui.jeton, env);
  if (!profil || !profil.id) {
    return json({ erreur: "compte introuvable" }, 404);
  }

  /* D'abord l'anonymisation, ensuite la suppression.

     L'ordre n'est pas indifférent : ce que la personne a publié dans un groupe
     reste en ligne, détaché d'elle. La ligne de profil doit donc être vidée
     AVANT que la ligne de compte disparaisse, sinon la suppression en cascade
     emporterait le profil et, avec lui, les contenus qui s'y rattachent.

     Si cette étape échoue, on s'arrête : mieux vaut un compte encore présent
     qu'un compte supprimé dont les contenus pendent dans le vide. */
  const anonymisation = await fetch(env.SUPABASE_URL + "/rest/v1/rpc/anonymiser_mon_compte", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + qui.jeton,
      "apikey": env.SUPABASE_ANON_KEY || "",
      "content-type": "application/json",
    },
    body: "{}",
  });

  if (!anonymisation.ok) {
    console.log("anonymisation refusée :", anonymisation.status);
    return json({ erreur: "la suppression a échoué" }, 502);
  }

  /* L'identifiant vient du profil lu AVEC le jeton de la personne : il ne
     peut donc désigner qu'elle. */
  const suppression = await fetch(
    env.SUPABASE_URL + "/auth/v1/admin/users/" + profil.id,
    {
      method: "DELETE",
      headers: {
        "Authorization": "Bearer " + env.SUPABASE_SERVICE_ROLE,
        "apikey": env.SUPABASE_SERVICE_ROLE,
      },
    },
  );

  if (!suppression.ok) {
    console.log("suppression refusée :", suppression.status);
    return json({ erreur: "la suppression a échoué" }, 502);
  }

  /* Le compte n'existe plus : la session non plus. On efface les trois
     cookies dans la foulée — le renouvellement compris, sinon la personne
     resterait « connectée » à un compte supprimé jusqu'à expiration. Rien à
     révoquer chez Supabase : la ligne auth.users est partie avec ses jetons. */
  const entetes = new Headers({
    "content-type": "application/json",
    "Cache-Control": "no-store",
  });
  for (const c of cookiesEffaces(env.DOMAINE_COOKIE)) entetes.append("Set-Cookie", c);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: entetes });
}
