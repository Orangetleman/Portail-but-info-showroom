/* ==========================================================================
   /api/pseudo — choisir ou changer son pseudo
   ==========================================================================

   Pourquoi passer par le serveur alors que la base accepterait la demande
   directement depuis le navigateur ?

   Parce que le jeton est dans un cookie HttpOnly, donc invisible du
   JavaScript de la page — c'est ce qui le rend involable. Pour parler à
   Supabase au nom de la personne, il faut donc quelqu'un qui puisse lire ce
   cookie : le serveur.

   L'alternative aurait été de garder le jeton en clair dans la page. On aurait
   troqué une protection réelle contre une ligne de code en moins.

   La règle d'accès de la base fait le reste : elle n'autorise la modification
   que de sa propre ligne, et seulement de la colonne « pseudo ». Même si
   cette fonction se trompait, personne ne pourrait renommer autrui ni se
   donner un rôle.
   ========================================================================== */

import { verifierJeton } from "../_verifier.js";
import { lireCookie, COOKIE } from "../_acces.js";

const FORME = /^[A-Za-z0-9_-]{3,20}$/;


function json(donnees, code) {
  return new Response(JSON.stringify(donnees), {
    status: code || 200,
    headers: { "content-type": "application/json", "Cache-Control": "private, no-store" },
  });
}


export async function onRequestPost(context) {
  const { request, env } = context;

  const jeton = lireCookie(request, COOKIE);
  const verdict = await verifierJeton(jeton, env);
  if (!verdict.ok) return json({ erreur: "il faut être connecté" }, 401);

  let corps;
  try {
    corps = await request.json();
  } catch (err) {
    return json({ erreur: "requête illisible" }, 400);
  }

  const pseudo = String((corps && corps.pseudo) || "").trim();
  if (!FORME.test(pseudo)) {
    return json({
      erreur: "Un pseudo fait 3 à 20 caractères : lettres, chiffres, tiret et souligné.",
    }, 400);
  }

  /* On écrit avec le jeton de la personne, jamais avec une clé de service :
     c'est la base qui vérifie que la ligne lui appartient. Le serveur n'a donc
     aucun pouvoir particulier ici, et c'est très bien ainsi.

     « select=id,pseudo » : la ligne renvoyée ne contient que des colonnes
     lisibles. Sans lui, PostgREST les renverrait toutes, vu_le comprise, que
     la personne n'a plus le droit de lire (2026_profils_colonnes.sql) : le
     PATCH entier serait refusé. */
  const reponse = await fetch(
    env.SUPABASE_URL + "/rest/v1/profiles?id=eq." + encodeURIComponent(verdict.id) + "&select=id,pseudo",
    {
      method: "PATCH",
      headers: {
        "Authorization": "Bearer " + jeton,
        "apikey": env.SUPABASE_ANON_KEY || "",
        "content-type": "application/json",
        "Prefer": "return=representation",
      },
      body: JSON.stringify({ pseudo }),
    },
  );

  if (reponse.status === 409) {
    return json({ erreur: "Ce pseudo est déjà pris." }, 409);
  }
  if (!reponse.ok) {
    console.log("pseudo refusé :", reponse.status);
    return json({ erreur: "Impossible d'enregistrer ce pseudo." }, 502);
  }

  /* Un PATCH qui ne trouve aucune ligne réussit : il a fait ce qu'on lui
     demandait, c'est-à-dire rien. Sans ce contrôle, la page annonçait un
     enregistrement qui n'avait pas eu lieu, et le pseudo redevenait « à
     choisir » à l'actualisation suivante.

     Le cas se produit pour les comptes créés avant la table des profils : le
     déclencheur ne vaut que pour les inscriptions à venir. */
  let ecrites = null;
  try { ecrites = await reponse.json(); } catch (err) { /* corps vide */ }

  if (Array.isArray(ecrites) && ecrites.length === 0) {
    return json({
      erreur: "Ton compte n'a pas encore de fiche de profil, "
            + "le pseudo n'a donc pas pu être enregistré.",
      cause: "profil_absent",
    }, 409);
  }

  /* Le pseudo voyage dans le jeton, posé au moment où Supabase le fabrique.
     Celui qu'on a en main date d'avant : il ne le contient pas encore. On le
     dit franchement plutôt que de laisser croire à un bogue quand la page
     affiche encore l'ancien état. */
  return json({
    ok: true,
    pseudo,
    note: "Le pseudo apparaîtra partout au prochain renouvellement de session.",
  });
}
