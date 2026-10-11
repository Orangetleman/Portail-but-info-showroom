/* ==========================================================================
   /api/consentement — accepter la notice de données, quand elle a changé
   ==========================================================================

   POST { version } → { ok, version, date }

   La preuve du consentement vit dans les métadonnées du compte
   (consentement_date, consentement_version), posées à l'inscription par
   adresse et mot de passe (assets/auth.js). Deux cas la rendent insuffisante :
   la notice a changé de version (une nouvelle donnée, une nouvelle finalité :
   docs/donnees-personnelles.md, « Si la notice change »), ou le compte est venu par Google,
   GitHub ou Discord, où aucune case n'a jamais été cochée. Dans les deux cas
   le site représente la notice (fenêtre du script commun, demanderNotice)
   tant qu'elle n'est pas acceptée — une condition, pas une étape (conception
   § 7 bis, quatrième piège).

   La version acceptée doit être CELLE du site (functions/_notice.js, généré
   par build_site.py depuis auth.config.json) : accepter une version
   ancienne, ou inventée, n'est pas accepter. L'écriture passe par Supabase
   avec le jeton de la personne (PUT /auth/v1/user, qui fusionne « data »
   dans ses métadonnées) : la route n'a aucun pouvoir, et on relit ce que
   Supabase a écrit avant de dire « accepté ».
   ========================================================================== */

import { json, identifier } from "../_emploi.js";
import { VERSION_NOTICE } from "../_notice.js";


export async function onRequestPost(context) {
  const { request, env } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);

  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  const version = String((corps && corps.version) || "").trim();
  if (version !== VERSION_NOTICE) {
    return json({ erreur: "La version acceptée n'est pas celle de la notice (" + VERSION_NOTICE + ") : recharge la page.",
                  version_attendue: VERSION_NOTICE }, 400);
  }

  const date = new Date().toISOString();
  const r = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
    method: "PUT",
    headers: {
      "Authorization": "Bearer " + qui.jeton,
      "apikey": env.SUPABASE_ANON_KEY || "",
      "content-type": "application/json",
    },
    body: JSON.stringify({ data: { consentement_date: date, consentement_version: version } }),
  });
  if (!r.ok) return json({ erreur: "Supabase n'a pas enregistré le consentement (" + r.status + ")." }, 502);

  /* Ce que Supabase a écrit, pas ce qu'on lui a envoyé. */
  let profil;
  try { profil = await r.json(); } catch (err) { profil = null; }
  const meta = (profil && profil.user_metadata) || {};
  if (meta.consentement_version !== version) {
    return json({ erreur: "Supabase a répondu sans la version attendue." }, 502);
  }
  return json({ ok: true, version, date: meta.consentement_date || date });
}
