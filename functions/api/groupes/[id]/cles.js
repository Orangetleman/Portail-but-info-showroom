/* ==========================================================================
   /api/groupes/:id/cles — les clés d'une conversation privée (lot H, s. 2)
   ==========================================================================

   GET   → { prive, chiffre_depuis, version_courante,
             enveloppes: [ { version, membre, membre_version, par, par_version, sel, enveloppe, cree_le } ],
             faites: [ celles que j'ai faites pour l'autre ],
             cles: { <membre>: [ { version, algo, cle, empreinte, cree_le, remplacee_le } ] },
             membres: [ <uuid des membres acceptés> ] }
           Mes enveloppes (celles qui me sont adressées — la règle d'accès
           rend aussi celles que j'ai faites), et TOUTES les versions des
           clés publiques des deux membres : une enveloppe se vérifie avec
           la clé de « par » à l'époque où elle a été faite, et un changement
           de clé chez l'autre se voit à la version courante.
   POST  { version, enveloppes: [ { membre, membre_version, sel, enveloppe } ] }
           → deposer_enveloppes → { ok, version, chiffre_depuis, enveloppes }
           Une version neuve (max + 1) chiffre la conversation pour toujours
           et exige une enveloppe pour chacun des deux ; une version existante
           REND une enveloppe à un membre dont la clé a changé. La base
           vérifie tout cela ; la route ne vérifie que la forme.
   ========================================================================== */

import { json, identifier, commeElle, messageDe } from "../../../_emploi.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B64U = /^[A-Za-z0-9_-]+$/;

function tableAbsente() {
  return json({ erreur: "Le chiffrement des messages privés n'est pas encore ouvert sur ce site "
                      + "(supabase/2026_chiffrement.sql).", indisponible: true }, 503);
}


export async function onRequestGet(context) {
  const { request, env, params } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const id = String(params.id || "");
  if (!UUID.test(id)) return json({ erreur: "Groupe inconnu." }, 400);

  const [rG, rM, rE] = await Promise.all([
    commeElle(qui.jeton, env, "/rest/v1/groupes?select=id,prive,chiffre_depuis&id=eq." + id),
    commeElle(qui.jeton, env, "/rest/v1/membres?select=membre,statut&groupe=eq." + id),
    commeElle(qui.jeton, env, "/rest/v1/cles_conversation?select=version,membre,membre_version,par,par_version,sel,enveloppe,cree_le&groupe=eq." + id + "&order=version.asc"),
  ]);
  if (rG.status === 400 || rE.status === 404) return tableAbsente();   /* colonne chiffre_depuis ou table absente */
  if (!rG.ok) return json({ erreur: "La base n'a pas répondu : " + ((await messageDe(rG)) || rG.status) }, 502);
  const groupes = await rG.json();
  if (!Array.isArray(groupes) || groupes.length !== 1) return json({ erreur: "Ce groupe n'existe pas, ou tu n'en fais pas partie." }, 404);
  const g = groupes[0];
  const membres = (rM.ok ? await rM.json() : []).filter((m) => m.statut === "accepte").map((m) => m.membre);
  const enveloppes = rE.ok ? await rE.json() : [];
  const cles = {};
  if (membres.length) {
    const rC = await commeElle(qui.jeton, env, "/rest/v1/cles_publiques?select=membre,version,algo,cle,empreinte,cree_le,remplacee_le&membre=in.("
      + membres.map(encodeURIComponent).join(",") + ")&order=version.asc");
    if (rC.ok) for (const c of await rC.json()) { (cles[c.membre] = cles[c.membre] || []).push(c); }
  }
  const moi = qui.verdict.id;
  return json({
    prive: g.prive === true,
    chiffre_depuis: g.chiffre_depuis || null,
    version_courante: enveloppes.reduce((v, e) => Math.max(v, Number(e.version) || 0), 0),
    /* les miennes seules : la règle rend aussi celles que j'ai faites pour
       l'autre, qui ne me servent à rien et que je ne dois pas confondre */
    enveloppes: enveloppes.filter((e) => e.membre === moi),
    /* celles que J'AI faites pour l'autre : c'est ainsi que la page sait
       quelles versions de sa clé j'ai déjà acceptées */
    faites: enveloppes.filter((e) => e.membre !== moi && e.par === moi),
    cles, membres,
  });
}


export async function onRequestPost(context) {
  const { request, env, params } = context;
  const qui = await identifier(request, env);
  if (!qui.ok) return json({ erreur: qui.message }, qui.code);
  const id = String(params.id || "");
  if (!UUID.test(id)) return json({ erreur: "Groupe inconnu." }, 400);

  let corps;
  try { corps = await request.json(); } catch (err) { return json({ erreur: "requête illisible" }, 400); }
  corps = corps && typeof corps === "object" ? corps : {};
  const version = Number(corps.version);
  if (!Number.isInteger(version) || version < 1 || version > 1000000) return json({ erreur: "Version de clé invalide." }, 400);
  if (!Array.isArray(corps.enveloppes) || corps.enveloppes.length < 1 || corps.enveloppes.length > 2) return json({ erreur: "Il faut une ou deux enveloppes." }, 400);
  const enveloppes = [];
  for (const e of corps.enveloppes) {
    if (!e || typeof e !== "object" || !UUID.test(String(e.membre || ""))) return json({ erreur: "Enveloppe mal formée." }, 400);
    const mv = Number(e.membre_version);
    if (!Number.isInteger(mv) || mv < 1) return json({ erreur: "Enveloppe mal formée (version du destinataire)." }, 400);
    if (typeof e.sel !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(e.sel)) return json({ erreur: "Enveloppe mal formée (sel)." }, 400);
    if (typeof e.enveloppe !== "string" || !B64U.test(e.enveloppe) || e.enveloppe.length < 40 || e.enveloppe.length > 512) return json({ erreur: "Enveloppe mal formée." }, 400);
    enveloppes.push({ membre: String(e.membre).toLowerCase(), membre_version: mv, sel: e.sel, enveloppe: e.enveloppe });
  }
  const r = await commeElle(qui.jeton, env, "/rest/v1/rpc/deposer_enveloppes", {
    method: "POST", body: JSON.stringify({ g: id, version_donnee: version, enveloppes }),
  });
  if (r.status === 404) return tableAbsente();
  if (!r.ok) return json({ erreur: (await messageDe(r)) || "La base a refusé les enveloppes." }, 400);
  const rendu = await r.json();
  if (!rendu || Number(rendu.version) !== version) return json({ erreur: "La base n'a rien écrit." }, 502);
  return json({ ok: true, version, chiffre_depuis: rendu.chiffre_depuis || null, enveloppes: Number(rendu.enveloppes) || 0 });
}
