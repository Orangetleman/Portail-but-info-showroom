/* ==========================================================================
   Lire le profil dans la base, et non dans le jeton
   ==========================================================================

   Le jeton d'accès porte le pseudo et le rôle, inscrits par le crochet
   « jeton_avec_role » AU MOMENT où Supabase le fabrique. C'est ce qui permet
   au middleware de garder les zones réservées sans interroger la base à
   chaque page — une signature à vérifier, et rien d'autre.

   Mais un jeton ne change plus une fois émis. Quelqu'un qui choisit son
   pseudo continue donc, pendant une heure, à porter un jeton qui dit qu'il
   n'en a pas. La page le renvoyait alors indéfiniment choisir un pseudo qu'il
   venait de choisir.

   D'où le partage des rôles entre les deux sources :

     - pour PROTÉGER, le jeton décide d'abord. Il est signé, il se vérifie
       sans réseau, et c'est ce qui permet de garder des centaines de fichiers
       sans les ralentir. S'il REFUSE, et seulement alors, le middleware
       consulte la base : une promotion prend ainsi effet tout de suite, sans
       coûter un aller et retour aux requêtes qui aboutissent.
     - pour AFFICHER, la base fait foi. Elle est à jour, et se tromper ne
       coûte qu'un lien montré à tort — lequel n'ouvre rien.

   Ces deux vérités peuvent diverger un moment. Plutôt que de le cacher, on
   renvoie les deux : l'interface peut alors dire « ton rôle a changé,
   reconnecte-toi pour qu'il prenne effet », ce qui est la seule chose vraie.
   ========================================================================== */


/** Le profil enregistré de la personne dont on donne l'identifiant.

    L'identifiant est OBLIGATOIRE, et il vient de la signature du jeton, jamais
    d'un paramètre de requête.

    Ne pas le passer a déjà coûté cher : la table des profils est lisible par
    tous — c'est voulu, le pseudo est public et sert à afficher l'auteur d'un
    contenu. Une requête sans filtre ne provoque donc aucune erreur : elle
    renvoie tranquillement la première ligne venue, celle de quelqu'un d'autre.
    Une règle d'accès permissive ne pardonne pas les requêtes approximatives ;
    elle les sert.

    Renvoie null si la base est injoignable ou si la ligne n'existe pas — les
    deux cas se distinguent par le champ « absent ». */
export async function lireProfilBase(jeton, env, id) {
  if (!env.SUPABASE_URL || !jeton || !id) return null;

  try {
    const entetes = {
      "Authorization": "Bearer " + jeton,
      "apikey": env.SUPABASE_ANON_KEY || "",
      "Accept": "application/json",
    };
    /* Des colonnes publiques SEULEMENT. Depuis 2026_profils_colonnes.sql, la
       lecture est accordée colonne par colonne : demander une colonne non
       accordée (vu_le, par exemple) fait refuser TOUTE la requête — 403, pas
       400 — et le pseudo et le rôle disparaîtraient avec elle. La date de
       visite se lit à part, par ma_derniere_visite() (voir derniereVisite). */
    const r = await fetch(env.SUPABASE_URL + "/rest/v1/profiles?id=eq."
                          + encodeURIComponent(id) + "&limit=1&select=id,pseudo,role,supprime_le",
                          { headers: entetes });
    if (!r.ok) return null;

    const lignes = await r.json();
    if (!Array.isArray(lignes)) return null;

    /* Aucune ligne n'est un cas distinct d'une base injoignable : c'est un
       compte créé avant la table des profils. Le dire permet de proposer le
       rattrapage au lieu d'afficher un vide inexplicable. */
    if (lignes.length === 0) return { absent: true, pseudo: null, role: null };

    const p = lignes[0];

    /* Ceinture et bretelles : on a demandé une ligne précise, on vérifie que
       c'est bien elle. Renvoyer le profil de quelqu'un d'autre coûte plus cher
       que de n'en renvoyer aucun. */
    if (p.id !== id) return null;

    return { absent: false, pseudo: p.pseudo || null, role: p.role || "user" };
  } catch (err) {
    return null;
  }
}


/** La dernière visite notée par le site (profiles.vu_le), pour la personne
    du jeton et elle seule — c'est la base qui le garantit : la colonne n'est
    lisible par personne, ma_derniere_visite() rend celle de auth.uid().

    Tant que 2026_profils_colonnes.sql n'est pas passé, la fonction n'existe
    pas (404) et la colonne est encore lisible : on la lit sur SA ligne. Ce
    repli disparaît de lui-même une fois la migration passée. null si la
    base ne répond pas, ou si la personne n'a jamais été vue. */
export async function derniereVisite(jeton, env, id) {
  if (!env.SUPABASE_URL || !jeton || !id) return null;
  const entetes = {
    "Authorization": "Bearer " + jeton,
    "apikey": env.SUPABASE_ANON_KEY || "",
    "Accept": "application/json",
  };
  try {
    const r = await fetch(env.SUPABASE_URL + "/rest/v1/rpc/ma_derniere_visite", {
      method: "POST", headers: { ...entetes, "content-type": "application/json" }, body: "{}",
    });
    if (r.ok) return (await r.json()) || null;
    if (r.status !== 404) return null;

    const ancien = await fetch(env.SUPABASE_URL + "/rest/v1/profiles?id=eq."
                               + encodeURIComponent(id) + "&limit=1&select=id,vu_le",
                               { headers: entetes });
    if (!ancien.ok) return null;
    const lignes = await ancien.json();
    return Array.isArray(lignes) && lignes[0] && lignes[0].id === id ? lignes[0].vu_le || null : null;
  } catch (err) {
    return null;
  }
}


/** Ce que l'interface doit afficher, à partir du jeton et de la base.

    Le jeton sert de repli : si la base ne répond pas, mieux vaut un état
    légèrement périmé qu'une page qui prétend que personne n'est connecté. */
export function etatAffiche(verdict, profil) {
  const roleJeton = verdict.role || "user";
  return {
    pseudo: profil && !profil.absent ? profil.pseudo : (verdict.pseudo || null),
    role: profil && !profil.absent ? profil.role : roleJeton,
    role_actif: roleJeton,
    profil_absent: !!(profil && profil.absent),
  };
}
