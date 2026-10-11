/* ==========================================================================
   /api/moi — « qui est connecté, et avec quel rôle ? »
   ==========================================================================

   Un seul point d'entrée, aucun secret à conserver. Le navigateur porte déjà
   le cookie de session ; la page — ou un outil voisin hébergé sur un
   sous-domaine — pose la question et reçoit la réponse.

     fetch("/api/moi").then(r => r.json())
       → { "connecte": true, "pseudo": "orange", "role": "reader_user",
           "non_lus": 3 }

   « non_lus » : le nombre de CONVERSATIONS où il me reste à lire (20
   septembre : comme Beeper, une pastille par discussion dans l'en-tête ;
   le nombre de messages ne se lit que dans la liste des discussions), via
   apercu_groupes() (supabase/2026_messagerie.sql) ; « messages_non_lus »
   le total des messages. Si seule non_lus_total() existe, « non_lus » est
   ce total-là (dégradé). Une question de plus à la base dans la même
   exécution, pas une exécution de plus. Absent tant que la migration n'est
   pas passée, ou hors connexion.

   Deux usages, à ne pas confondre.

   Côté affichage, la réponse sert à montrer ou non un lien vers une zone
   réservée. C'est du confort : un lien affiché à tort ne donne accès à rien,
   puisque la zone elle-même est gardée par le middleware.

   Côté protection, cette adresse ne sert à rien. C'est le middleware qui
   décide, à partir du jeton signé, et lui seul. Une page qui se contenterait
   d'appeler /api/moi pour se protéger ne protégerait rien : il suffirait de
   répondre « oui » à la place du serveur.
   ========================================================================== */

import { origineAutorisee, avecCors, reponsePrealable } from "../_cors.js";
import { lireProfilBase, etatAffiche } from "../_profil.js";
import { sessionDe, marquerVu, avecCookies } from "../_session.js";
import { VERSION_NOTICE } from "../_notice.js";


export async function onRequestOptions(context) {
  const origine = origineAutorisee(context.request, context.env);
  if (!origine) return new Response(null, { status: 403 });
  return reponsePrealable(origine);
}


export async function onRequestGet(context) {
  const { request, env } = context;
  const origine = origineAutorisee(request, env);
  /* Chaque page appelle cette route : c'est ici que la session se reconduit
     pour les pages publiques (le middleware ne vérifie que les zones
     protégées), et ici que la visite du jour est notée. */
  const session = await sessionDe(request, env);
  const { verdict, jeton } = session;
  const cookies = session.cookies.slice();

  /* Un visiteur non connecté reçoit une réponse, pas un refus : « connecte:
     false » est une information, et le rôle par défaut est le plus faible. */
  let etat = { connecte: false, adresse: null, pseudo: null, role: "user" };

  if (verdict.ok) {
    /* Le pseudo vient de la base, pas du jeton. Le jeton dure une heure ;
       quelqu'un qui vient de choisir son pseudo serait sinon renvoyé le
       choisir encore, en boucle, jusqu'à expiration. */
    const vu = etatAffiche(verdict, await lireProfilBase(jeton, env, verdict.id));
    etat = {
      connecte: true,
      adresse: verdict.email || null,
      pseudo: vu.pseudo,
      role: vu.role,
      role_actif: vu.role_actif,
      profil_absent: vu.profil_absent,
      /* La notice de données : la version du site, celle que la personne a
         acceptée (null : jamais — compte venu par un fournisseur), et s'il
         faut la représenter. Lu dans le jeton : aucune question de plus. */
      notice: {
        version: VERSION_NOTICE,
        acceptee: verdict.consentement_version || null,
        a_accepter: verdict.consentement_version !== VERSION_NOTICE,
      },
    };

    /* La visite du jour : une écriture par jour et par compte, pas une par
       page (voir marquerVu). Le cookie fb_vu revient seulement si la base a
       répondu ; sinon la page suivante réessaiera. */
    const marque = await marquerVu(request, jeton, env);
    if (marque) cookies.push(marque);

    /* les non-lus : une fonction SQL, 404 = pas encore là.
       Et, depuis U3, « mon suivi » : de quoi poser la pastille de « Mes
       demandes » sans que la page ait à demander quoi que ce soit. Les deux
       lectures partent EN PARALLÈLE des non-lus : la latence ajoutée est
       ~0, et le quota Cloudflare compte l'exécution, pas les requêtes à
       PostgREST. Les règles d'accès font le tri (chacun les siennes) : il
       n'y a rien à filtrer ici. */
    try {
      const entetes = { "Authorization": "Bearer " + jeton, "apikey": env.SUPABASE_ANON_KEY || "", "content-type": "application/json", "Accept": "application/json" };
      const lire = (chemin) => fetch(env.SUPABASE_URL + chemin, { headers: entetes })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const promesseSuivi = Promise.all([
        lire("/rest/v1/demandes_acces?select=statut,cree_le,traite_le&order=cree_le.desc&limit=1"),
        lire("/rest/v1/propositions?select=etat,traite_le&order=cree_le.desc&limit=20"),
      ]).then(([demandes, propositions]) => {
        const suivi = { demande: null, en_attente: 0, repondu: 0, dernier: null };
        const retenir = (iso) => { if (iso && (!suivi.dernier || iso > suivi.dernier)) suivi.dernier = iso; };
        const d = Array.isArray(demandes) ? demandes[0] : null;
        if (d) {
          suivi.demande = d.statut || null;
          if (d.statut === "en_attente") suivi.en_attente++;
          else { suivi.repondu++; retenir(d.traite_le || d.cree_le); }
        }
        for (const p of (Array.isArray(propositions) ? propositions : [])) {
          if (p.etat === "en_attente") suivi.en_attente++;
          else { suivi.repondu++; retenir(p.traite_le); }
        }
        return suivi;
      }).catch(() => null);

      const rA = await fetch(env.SUPABASE_URL + "/rest/v1/rpc/apercu_groupes", { method: "POST", headers: entetes, body: "{}" });
      const suivi = await promesseSuivi;
      if (suivi) etat.suivi = suivi;
      if (rA.ok) {
        const lignes = await rA.json();
        if (Array.isArray(lignes)) {
          let conversations = 0, messages = 0;
          for (const l of lignes) { const n = Number(l && l.non_lus) || 0; messages += n; if (n > 0) conversations++; }
          etat.non_lus = conversations;
          etat.messages_non_lus = messages;
        }
      } else {
        const rN = await fetch(env.SUPABASE_URL + "/rest/v1/rpc/non_lus_total", { method: "POST", headers: entetes, body: "{}" });
        if (rN.ok) { const n = await rN.json(); if (Number.isInteger(n)) etat.non_lus = n; }
      }
    } catch (e) { /* hors ligne côté base : pas de pastille */ }
  }

  const reponse = new Response(JSON.stringify(etat), {
    status: 200,
    headers: {
      "content-type": "application/json",
      /* Une réponse personnelle : aucun cache ne doit la resservir. */
      "Cache-Control": "private, no-store",
    },
  });
  return avecCors(avecCookies(reponse, cookies), origine);
}
