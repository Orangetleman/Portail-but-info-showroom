/* ==========================================================================
   /api/cles/:membre — la clé publique d'un CONTACT (lot H, session 2)
   ==========================================================================

   GET  → { membre, pseudo, courante: { version, algo, cle, empreinte, cree_le } | null,
            versions: [ { version, algo, cle, empreinte, cree_le, remplacee_le } ] }

   La base laisse lire toute clé publique (une clé publique est publique) ;
   la route exige d'être EN CONTACT avec la personne (sont_contacts, la
   fonction de 2026_contacts.sql) pour ne pas offrir un annuaire des clés
   — savoir qui a activé le chiffrement est déjà un renseignement. Toutes
   les versions sont rendues : une enveloppe ancienne se vérifie avec la
   clé de l'époque.
   ========================================================================== */

import { json, identifier, commeElle, messageDe } from "../../_emploi.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


export async function onRequestGet(context) {
  const { request, env, params } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const membre = String(params.membre || "").toLowerCase();
  if (!UUID.test(membre)) return json({ erreur: "Compte inconnu." }, 400);

  if (membre !== String(qui.verdict.id).toLowerCase()) {
    const rC = await commeElle(qui.jeton, env, "/rest/v1/rpc/sont_contacts", {
      method: "POST", body: JSON.stringify({ a: qui.verdict.id, b: membre }),
    });
    if (rC.status === 404) return json({ erreur: "Les contacts ne sont pas encore ouverts sur ce site (supabase/2026_contacts.sql).", indisponible: true }, 503);
    if (!rC.ok || (await rC.json()) !== true) return json({ erreur: "On ne lit les clés que d'un contact." }, 403);
  }
  const [rP, rN] = await Promise.all([
    commeElle(qui.jeton, env, "/rest/v1/cles_publiques?select=version,algo,cle,empreinte,cree_le,remplacee_le&membre=eq." + membre + "&order=version.asc"),
    commeElle(qui.jeton, env, "/rest/v1/profiles?select=pseudo&id=eq." + membre),
  ]);
  if (rP.status === 404) return json({ erreur: "Le chiffrement des messages privés n'est pas encore ouvert sur ce site (supabase/2026_chiffrement.sql).", indisponible: true }, 503);
  if (!rP.ok) return json({ erreur: "La base n'a pas répondu : " + ((await messageDe(rP)) || rP.status) }, 502);
  const versions = await rP.json();
  const profils = rN.ok ? await rN.json() : [];
  const courante = (Array.isArray(versions) ? versions : []).find((v) => !v.remplacee_le) || null;
  return json({ membre, pseudo: profils[0] && profils[0].pseudo || null,
                courante: courante ? { version: courante.version, algo: courante.algo, cle: courante.cle, empreinte: courante.empreinte, cree_le: courante.cree_le } : null,
                versions: Array.isArray(versions) ? versions : [] });
}
