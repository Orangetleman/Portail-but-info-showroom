/* ==========================================================================
   Fiches BUT — comportements de la page
   Sans dépendance : le site doit marcher hors ligne et en double-clic.
   ========================================================================== */

(function () {
  "use strict";

  var racine = document.documentElement.getAttribute("data-racine") || "";
  /* l'empreinte des ressources, pour demander un fichier charge a la
     demande avec la meme adresse versionnee que les autres */
  var versionSite = document.documentElement.getAttribute("data-version") || "";

  /* ---------- choisir une fiche ----------
     Une seance, une tache : on y attache une fiche. L'identifiant
     (S1-R104-06) est une adresse de machine ; personne ne devrait avoir a
     le retenir. brancherSelecteurFiche(input) cache le champ texte et met a
     sa place ce qu'on a choisi — « R104 · 06 — Flux standards… » — avec un
     bouton qui ouvre une fenetre : les modules, leurs fiches, une
     recherche. Le champ texte reste la valeur que le formulaire lit.

     La liste vient du catalogue (acces etendu) ; sans lui, des fiches de
     demonstration seulement, et la fenetre le dit. */
  var catalogueFiches = null;      /* promesse, chargee une fois */
  function listeFiches() {
    if (catalogueFiches) return catalogueFiches;
    catalogueFiches = fetch("/fiches/catalogue.json", { headers: { "Accept": "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (c) {
        var modules = [];
        (c.semestres || []).forEach(function (sem) {
          (sem.modules || []).forEach(function (m) {
            modules.push({ code: m.code, intitule: m.intitule, themes: m.themes || [], fiches: (m.fiches || []).map(function (f) {
              return { chapitre: f.chapitre, numero: f.numero, titre: f.titre, page: "/" + f.page };
            }) });
          });
        });
        return { modules: modules, demo: false };
      })
      .catch(function () {
        return fetch("/quiz/demo.json", { headers: { "Accept": "application/json" } })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            return { demo: true, modules: (d.modules || []).map(function (m) {
              return { code: m.code, intitule: m.intitule, themes: m.themes || [], fiches: m.fiches.map(function (f) {
                return { chapitre: f.chapitre, numero: f.numero, titre: f.titre, page: null };
              }) };
            }) };
          })
          .catch(function () { return { demo: true, modules: [] }; });
      });
    return catalogueFiches;
  }
  function ficheParChapitre(cat, chapitre) {
    var id = String(chapitre || "").split("#")[0];
    for (var i = 0; i < cat.modules.length; i++) {
      var m = cat.modules[i];
      for (var j = 0; j < m.fiches.length; j++) {
        if (m.fiches[j].chapitre === id) return { module: m, fiche: m.fiches[j] };
      }
    }
    return null;
  }

  var dialogueFiche = null, surChoix = null;
  function ouvrirSelecteurFiche(auChoix) {
    surChoix = auChoix;
    if (!dialogueFiche) {
      dialogueFiche = document.createElement("dialog");
      dialogueFiche.className = "edt-dialogue sf-dialogue";
      dialogueFiche.innerHTML =
        '<div class="sf-tete"><h2>Choisir une fiche</h2>' +
        '<button type="button" class="btn btn-icone sf-fermer" aria-label="Fermer">×</button></div>' +
        '<input type="search" class="sf-recherche" placeholder="Chercher un titre, un module…" autocomplete="off">' +
        '<p class="c-note sf-demo" hidden>Sans l’accès étendu, seules les fiches de démonstration sont listées.</p>' +
        '<div class="sf-liste"></div>';
      document.body.appendChild(dialogueFiche);
      dialogueFiche.querySelector(".sf-fermer").addEventListener("click", function () { dialogueFiche.close(); });
      dialogueFiche.querySelector(".sf-recherche").addEventListener("input", function () { peindreListeFiches(this.value); });
      dialogueFiche.addEventListener("click", function (e) {
        var b = e.target.closest("[data-chapitre]");
        if (!b) return;
        if (surChoix) surChoix(b.getAttribute("data-chapitre"));
        dialogueFiche.close();
      });
    }
    dialogueFiche.querySelector(".sf-recherche").value = "";
    peindreListeFiches("");
    if (typeof dialogueFiche.showModal === "function") dialogueFiche.showModal(); else dialogueFiche.setAttribute("open", "");
    dialogueFiche.querySelector(".sf-recherche").focus();
  }
  function normaliserSf(t) {
    return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  function peindreListeFiches(filtre) {
    var zone = dialogueFiche.querySelector(".sf-liste");
    zone.textContent = "";
    var q = normaliserSf(filtre).trim();
    listeFiches().then(function (cat) {
      dialogueFiche.querySelector(".sf-demo").hidden = !cat.demo;
      var rien = true;
      cat.modules.forEach(function (m) {
        var fiches = m.fiches.filter(function (f) {
          return !q || normaliserSf(m.code + " " + m.intitule + " " + f.numero + " " + f.titre).indexOf(q) !== -1;
        });
        if (!fiches.length) return;
        rien = false;
        var bloc = document.createElement("section");
        bloc.className = "sf-module"; bloc.setAttribute("data-module", m.code);
        var h = document.createElement("h3");
        var code = document.createElement("span"); code.className = "grp-pastille"; code.textContent = m.code;
        h.appendChild(code); h.appendChild(document.createTextNode(" " + m.intitule));
        bloc.appendChild(h);
        /* les fiches sous leur theme, quand le module en declare ;
           celles hors theme sous « Autres » */
        var restantes = fiches.slice();
        (m.themes || []).forEach(function (t) {
          var siennes = fiches.filter(function (f) { return t.chapitres.indexOf(f.chapitre) !== -1; });
          if (!siennes.length) return;
          var st = document.createElement("div"); st.className = "sf-theme"; st.textContent = t.nom; bloc.appendChild(st);
          siennes.forEach(function (f) { bloc.appendChild(boutonFiche(f)); });
          restantes = restantes.filter(function (f) { return siennes.indexOf(f) === -1; });
        });
        if (restantes.length) {
          if (restantes.length !== fiches.length) { var sa = document.createElement("div"); sa.className = "sf-theme"; sa.textContent = "Autres"; bloc.appendChild(sa); }
          restantes.forEach(function (f) { bloc.appendChild(boutonFiche(f)); });
        }
        zone.appendChild(bloc);
      });
      if (rien) {
        var p = document.createElement("p"); p.className = "c-note";
        p.textContent = cat.modules.length ? "Aucune fiche ne correspond." : "Les fiches ne sont pas disponibles pour le moment.";
        zone.appendChild(p);
      }
    });
  }

  function boutonFiche(f) {
    var b = document.createElement("button"); b.type = "button"; b.className = "sf-fiche";
    b.setAttribute("data-chapitre", f.chapitre);
    var n = document.createElement("span"); n.className = "sf-num"; n.textContent = String(f.numero).padStart(2, "0");
    b.appendChild(n); b.appendChild(document.createTextNode(" " + f.titre));
    return b;
  }

  /* La meme fenetre, en version « plusieurs » : des cases, un module qui
     coche tout son contenu d'un clic, Valider. Sert aux references d'un
     message ; le quiz a la sienne, qui connait en plus les questions.

     Les modules sont REPLIES : une ligne par module (coche, nom, compte),
     une fleche a droite qui deplie ses fiches. Le module se coche entier
     sans le deplier ; la recherche deplie ce qui correspond. Le compte de
     la ligne dit « cochees / total » quand une partie est cochee. */
  var dialogueFiches = null, surChoixMulti = null, brouillonFiches = {}, depliesFiches = {};
  function ligneModule(m, chapitres, cochees, deplie, surCoche, surDeplie) {
    var ligne = document.createElement("div"); ligne.className = "sf-ligne-module";
    var h = document.createElement("button"); h.type = "button"; h.className = "sf-groupe sf-groupe-module";
    var n = chapitres.filter(function (ch) { return cochees[ch]; }).length;
    h.setAttribute("data-etat", n === 0 ? "aucune" : (n === chapitres.length ? "toutes" : "partie"));
    var coche = document.createElement("span"); coche.className = "sf-coche"; h.appendChild(coche);
    var code = document.createElement("span"); code.className = "grp-pastille"; code.textContent = m.code;
    h.appendChild(code); h.appendChild(document.createTextNode(" " + m.intitule + " "));
    var compte = document.createElement("span"); compte.className = "grp-pastille grp-pastille-neutre sf-compte-module";
    compte.textContent = (n && n !== chapitres.length ? n + "/" : "") + chapitres.length + " fiche" + (chapitres.length > 1 ? "s" : "");
    h.appendChild(compte);
    h.addEventListener("click", surCoche);
    ligne.appendChild(h);
    var fl = document.createElement("button"); fl.type = "button"; fl.className = "sf-deplier";
    fl.setAttribute("aria-expanded", deplie ? "true" : "false");
    fl.setAttribute("aria-label", (deplie ? "Replier " : "Déplier ") + m.code);
    fl.title = deplie ? "Replier" : "Déplier";
    fl.addEventListener("click", surDeplie);
    ligne.appendChild(fl);
    return ligne;
  }
  function ouvrirSelecteurFiches(dejaChoisies, auChoix) {
    surChoixMulti = auChoix;
    brouillonFiches = {}; depliesFiches = {};
    (dejaChoisies || []).forEach(function (ch) { brouillonFiches[ch] = true; });
    if (!dialogueFiches) {
      dialogueFiches = document.createElement("dialog");
      dialogueFiches.className = "edt-dialogue sf-dialogue";
      dialogueFiches.innerHTML =
        '<div class="sf-tete"><h2>Choisir des fiches</h2>' +
        '<button type="button" class="btn btn-icone sf-fermer" aria-label="Fermer">×</button></div>' +
        '<input type="search" class="sf-recherche" placeholder="Chercher un titre, un module…" autocomplete="off">' +
        '<p class="c-note sf-demo" hidden>Sans l’accès étendu, seules les fiches de démonstration sont listées.</p>' +
        '<div class="sf-liste sf-multi"></div>' +
        '<div class="sf-pied"><span class="sf-compte"></span>' +
        '<span class="sf-actions"><button type="button" class="btn sf-annuler">Annuler</button>' +
        '<button type="button" class="btn btn-accent sf-valider">Valider</button></span></div>';
      document.body.appendChild(dialogueFiches);
      dialogueFiches.querySelector(".sf-fermer").addEventListener("click", function () { dialogueFiches.close(); });
      dialogueFiches.querySelector(".sf-annuler").addEventListener("click", function () { dialogueFiches.close(); });
      dialogueFiches.querySelector(".sf-recherche").addEventListener("input", function () { peindreListeFichesMulti(this.value); });
      dialogueFiches.querySelector(".sf-valider").addEventListener("click", function () {
        var choisies = Object.keys(brouillonFiches).filter(function (ch) { return brouillonFiches[ch]; });
        dialogueFiches.close();
        if (surChoixMulti) surChoixMulti(choisies);
      });
    }
    dialogueFiches.querySelector(".sf-recherche").value = "";
    peindreListeFichesMulti("");
    if (typeof dialogueFiches.showModal === "function") dialogueFiches.showModal(); else dialogueFiches.setAttribute("open", "");
  }
  function peindreListeFichesMulti(filtre) {
    var zone = dialogueFiches.querySelector(".sf-liste");
    zone.textContent = "";
    var q = normaliserSf(filtre).trim();
    listeFiches().then(function (cat) {
      dialogueFiches.querySelector(".sf-demo").hidden = !cat.demo;
      cat.modules.forEach(function (m) {
        var fiches = m.fiches.filter(function (f) {
          return !q || normaliserSf(m.code + " " + m.intitule + " " + f.numero + " " + f.titre).indexOf(q) !== -1;
        });
        if (!fiches.length) return;
        var chapitres = fiches.map(function (f) { return f.chapitre; });
        var bloc = document.createElement("section");
        bloc.className = "sf-module"; bloc.setAttribute("data-module", m.code);
        /* replie par defaut ; deplie a la demande, ou par la recherche */
        var deplie = !!q || !!depliesFiches[m.code];
        bloc.setAttribute("data-deplie", deplie ? "oui" : "non");
        bloc.appendChild(ligneModule(m, chapitres, brouillonFiches, deplie, function () {
          var tous = chapitres.every(function (ch) { return brouillonFiches[ch]; });
          chapitres.forEach(function (ch) { if (tous) delete brouillonFiches[ch]; else brouillonFiches[ch] = true; });
          peindreListeFichesMulti(filtre);
        }, function () {
          depliesFiches[m.code] = !deplie;
          peindreListeFichesMulti(filtre);
        }));
        if (deplie) fiches.forEach(function (f) {
          var lab = document.createElement("label"); lab.className = "sf-fiche sf-fiche-case";
          var c = document.createElement("input"); c.type = "checkbox"; c.checked = !!brouillonFiches[f.chapitre];
          c.addEventListener("change", function () {
            if (c.checked) brouillonFiches[f.chapitre] = true; else delete brouillonFiches[f.chapitre];
            peindreListeFichesMulti(filtre);
          });
          lab.appendChild(c);
          var num = document.createElement("span"); num.className = "sf-num"; num.textContent = String(f.numero).padStart(2, "0");
          lab.appendChild(num); lab.appendChild(document.createTextNode(" " + f.titre));
          bloc.appendChild(lab);
        });
        zone.appendChild(bloc);
      });
      var total = Object.keys(brouillonFiches).length;
      dialogueFiches.querySelector(".sf-compte").textContent = total ? total + " fiche" + (total > 1 ? "s" : "") : "Aucune fiche";
    });
  }
  /* Le titre d'une fiche pour l'afficher, si le catalogue est la ;
     sinon son code, lisible quand meme (« R104 · 06 »). */
  function nomDeFiche(chapitre, rappeler) {
    var id = String(chapitre || "").split("#")[0];
    var court = id.slice(3, 7) + " · " + id.slice(8, 10);
    listeFiches().then(function (cat) {
      var t = ficheParChapitre(cat, id);
      if (t) rappeler(t.module.code + " · " + String(t.fiche.numero).padStart(2, "0") + " — " + t.fiche.titre);
    });
    return court;
  }

  /** Remplace visuellement un champ « identifiant de fiche » par le choix. */
  function brancherSelecteurFiche(input) {
    if (!input || input._selecteur) return;
    input._selecteur = true;
    input.hidden = true;
    var boite = document.createElement("div"); boite.className = "sf-champ";
    var lu = document.createElement("span"); lu.className = "sf-lu";
    var choisir = document.createElement("button"); choisir.type = "button"; choisir.className = "btn btn-petit";
    var retirer = document.createElement("button"); retirer.type = "button"; retirer.className = "btn btn-petit btn-icone"; retirer.textContent = "×"; retirer.title = "Retirer la fiche";
    boite.appendChild(lu); boite.appendChild(choisir); boite.appendChild(retirer);
    input.parentNode.insertBefore(boite, input.nextSibling);

    function peindre() {
      var v = input.value.trim();
      retirer.hidden = !v;
      choisir.textContent = v ? "Changer" : "Choisir une fiche…";
      if (!v) { lu.textContent = "Aucune fiche"; lu.className = "sf-lu sf-vide"; return; }
      lu.className = "sf-lu"; lu.textContent = v;
      listeFiches().then(function (cat) {
        var t = ficheParChapitre(cat, v);
        if (t) lu.textContent = t.module.code + " · " + String(t.fiche.numero).padStart(2, "0") + " — " + t.fiche.titre;
      });
    }
    choisir.addEventListener("click", function () {
      ouvrirSelecteurFiche(function (chapitre) { input.value = chapitre; peindre(); input.dispatchEvent(new Event("input")); });
    });
    retirer.addEventListener("click", function () { input.value = ""; peindre(); });
    input.addEventListener("change", peindre);
    peindre();
  }

  /* ---------- un code QR, sans dependance ----------
     matriceQR(texte) renvoie la grille (tableau de lignes de 0/1) d'un
     code QR en mode octets, niveau de correction M, versions 1 a 10
     (jusqu'a 213 octets : largement assez pour un lien d'invitation).
     C'est l'algorithme de la norme ISO 18004, ecrit ici en une centaine
     de lignes : donnees → mots de code → Reed-Solomon → placement en
     zigzag → masque (le meilleur des huit) → informations de format.
     svgQR(texte, taille) le dessine en SVG (net a toute taille).
     Verifie par un decodeur independant (jsQR) sur des liens reels. */
  var QR_VERSIONS = [
    /* [octets de correction par bloc, [nb blocs, octets de donnees]...] — niveau M */
    null,
    [10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]],
    [16, [4, 27]], [18, [4, 31]], [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]]
  ];
  var QR_ALIGNEMENTS = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  var QR_EXP = [], QR_LOG = [];
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { QR_EXP[i] = x; QR_LOG[x] = i; x <<= 1; if (x & 256) x ^= 285; }
    for (var j = 255; j < 512; j++) QR_EXP[j] = QR_EXP[j - 255];
  })();
  function qrMul(a, b) { return (a && b) ? QR_EXP[QR_LOG[a] + QR_LOG[b]] : 0; }
  function qrGenerateur(n) {
    var g = [1];
    for (var i = 0; i < n; i++) {
      var s = new Array(g.length + 1).fill(0);
      for (var j = 0; j < g.length; j++) { s[j] ^= g[j]; s[j + 1] ^= qrMul(g[j], QR_EXP[i]); }
      g = s;
    }
    return g;
  }
  function qrReedSolomon(donnees, n) {
    var g = qrGenerateur(n), reste = donnees.concat(new Array(n).fill(0));
    for (var i = 0; i < donnees.length; i++) {
      var c = reste[i];
      if (!c) continue;
      for (var j = 0; j < g.length; j++) reste[i + j] ^= qrMul(g[j], c);
    }
    return reste.slice(donnees.length);
  }
  function qrOctets(texte) {
    var s = unescape(encodeURIComponent(String(texte))), o = [];
    for (var i = 0; i < s.length; i++) o.push(s.charCodeAt(i));
    return o;
  }
  /* le reste de la division polynomiale (BCH) : sert aux informations de
     format (generateur 0x537) et de version (0x1F25) */
  function qrBch(valeur, generateur) {
    var degre = Math.floor(Math.log2(generateur));
    var v = valeur << degre;
    for (var i = Math.floor(Math.log2(v)); i >= degre; i--) if (v & (1 << i)) v ^= generateur << (i - degre);
    return v;
  }
  function matriceQR(texte) {
    var donnees = qrOctets(texte), version = 0, capacite = 0;
    for (var v = 1; v <= 10; v++) {
      var cap = 0, spec = QR_VERSIONS[v];
      for (var b = 1; b < spec.length; b++) cap += spec[b][0] * spec[b][1];
      if (donnees.length <= cap - 2 - (v >= 10 ? 1 : 0)) { version = v; capacite = cap; break; }
    }
    if (!version) return null;
    /* les bits : mode octets (0100), longueur (8 bits jusqu'a la v9, 16 des la v10), les octets, terminateur, remplissage */
    var bits = [];
    function pousser(val, n) { for (var i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); }
    pousser(4, 4); pousser(donnees.length, version >= 10 ? 16 : 8);
    donnees.forEach(function (o) { pousser(o, 8); });
    pousser(0, Math.min(4, capacite * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    var mots = [];
    for (var i = 0; i < bits.length; i += 8) { var m = 0; for (var j = 0; j < 8; j++) m = (m << 1) | bits[i + j]; mots.push(m); }
    for (var k = 0; mots.length < capacite; k++) mots.push(k % 2 ? 17 : 236);
    /* blocs et correction */
    var spec = QR_VERSIONS[version], nEc = spec[0], blocs = [], ecs = [], pos = 0;
    for (var g = 1; g < spec.length; g++) for (var q = 0; q < spec[g][0]; q++) {
      var bloc = mots.slice(pos, pos + spec[g][1]); pos += spec[g][1];
      blocs.push(bloc); ecs.push(qrReedSolomon(bloc, nEc));
    }
    var suite = [], maxLen = Math.max.apply(null, blocs.map(function (b) { return b.length; }));
    for (var c = 0; c < maxLen; c++) blocs.forEach(function (b) { if (c < b.length) suite.push(b[c]); });
    for (var e = 0; e < nEc; e++) ecs.forEach(function (b) { suite.push(b[e]); });
    /* la grille : motifs fixes d'abord, marques comme « reserves » */
    var taille = version * 4 + 17, grille = [], reserve = [];
    for (var y = 0; y < taille; y++) { grille.push(new Array(taille).fill(0)); reserve.push(new Array(taille).fill(false)); }
    function poser(x, y, val) { grille[y][x] = val; reserve[y][x] = true; }
    function viseur(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= taille || y >= taille) continue;
        var d = Math.max(Math.abs(dx), Math.abs(dy));
        poser(x, y, (d === 4 || d === 2) ? 0 : 1);
      }
    }
    viseur(3, 3); viseur(taille - 4, 3); viseur(3, taille - 4);
    var al = QR_ALIGNEMENTS[version];
    al.forEach(function (cy) { al.forEach(function (cx) {
      if (reserve[cy][cx]) return;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) poser(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) === 1 ? 0 : 1);
    }); });
    for (var t = 8; t < taille - 8; t++) { poser(t, 6, t % 2 === 0 ? 1 : 0); poser(6, t, t % 2 === 0 ? 1 : 0); }
    poser(8, taille - 8, 1);
    /* reserver les zones de format (et de version des la v7) */
    for (var f = 0; f < 9; f++) { if (f !== 6) { reserve[8][f] = true; reserve[f][8] = true; } }
    for (var f2 = 0; f2 < 8; f2++) { reserve[8][taille - 1 - f2] = true; reserve[taille - 1 - f2][8] = true; }
    if (version >= 7) for (var a = 0; a < 6; a++) for (var b2 = 0; b2 < 3; b2++) { reserve[a][taille - 11 + b2] = true; reserve[taille - 11 + b2][a] = true; }
    /* placement en zigzag, de droite a gauche, colonnes par deux (la 6 sautee) */
    var bitsSuite = [];
    suite.forEach(function (m) { for (var i = 7; i >= 0; i--) bitsSuite.push((m >> i) & 1); });
    var idx = 0, montee = true;
    for (var col = taille - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (var r = 0; r < taille; r++) {
        var y2 = montee ? taille - 1 - r : r;
        for (var dx2 = 0; dx2 < 2; dx2++) {
          var x2 = col - dx2;
          if (reserve[y2][x2]) continue;
          grille[y2][x2] = idx < bitsSuite.length ? bitsSuite[idx] : 0;
          idx++;
        }
      }
      montee = !montee;
    }
    /* le masque : on essaie les huit, on garde celui de moindre penalite */
    var MASQUES = [
      function (x, y) { return (x + y) % 2 === 0; }, function (x, y) { return y % 2 === 0; },
      function (x, y) { return x % 3 === 0; }, function (x, y) { return (x + y) % 3 === 0; },
      function (x, y) { return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0; },
      function (x, y) { return (x * y) % 2 + (x * y) % 3 === 0; },
      function (x, y) { return ((x * y) % 2 + (x * y) % 3) % 2 === 0; },
      function (x, y) { return ((x + y) % 2 + (x * y) % 3) % 2 === 0; }
    ];
    function appliquer(masque) {
      var g2 = grille.map(function (l) { return l.slice(); });
      for (var y = 0; y < taille; y++) for (var x = 0; x < taille; x++) if (!reserve[y][x] && MASQUES[masque](x, y)) g2[y][x] ^= 1;
      /* informations de format : niveau M (00) + masque, BCH(15,5), xor 0x5412 */
      var info = (0 << 3) | masque, fmt = ((info << 10) | qrBch(info, 0x537)) ^ 0x5412;
      for (var i = 0; i < 15; i++) {
        var bit = (fmt >> i) & 1;
        var yA = i < 6 ? i : (i < 8 ? i + 1 : 8), xA = i < 8 ? 8 : (i < 9 ? 7 : 14 - i);
        g2[yA][xA] = bit;
        if (i < 8) g2[8][taille - 1 - i] = bit; else g2[taille - 15 + i][8] = bit;
      }
      if (version >= 7) {
        var vi = (version << 12) | qrBch(version, 0x1F25);
        for (var j = 0; j < 18; j++) {
          var b = (vi >> j) & 1, xv = Math.floor(j / 3), yv = taille - 11 + (j % 3);
          g2[yv][xv] = b; g2[xv][yv] = b;
        }
      }
      return g2;
    }
    function penalite(g2) {
      var p = 0, n = taille;
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
        /* suites de 5+ modules identiques, en ligne et en colonne */
        if (x + 4 < n) { var run = 1; while (x + run < n && g2[y][x + run] === g2[y][x]) run++; if (run >= 5 && (x === 0 || g2[y][x - 1] !== g2[y][x])) p += run - 2; }
        if (y + 4 < n) { var run2 = 1; while (y + run2 < n && g2[y + run2][x] === g2[y][x]) run2++; if (run2 >= 5 && (y === 0 || g2[y - 1][x] !== g2[y][x])) p += run2 - 2; }
        /* blocs 2x2 */
        if (x + 1 < n && y + 1 < n && g2[y][x] === g2[y][x + 1] && g2[y][x] === g2[y + 1][x] && g2[y][x] === g2[y + 1][x + 1]) p += 3;
      }
      /* motif 1011101 borde de 4 blancs */
      var motif = [1, 0, 1, 1, 1, 0, 1];
      for (var y3 = 0; y3 < n; y3++) for (var x3 = 0; x3 + 6 < n; x3++) {
        var okH = true, okV = true;
        for (var k = 0; k < 7; k++) { if (g2[y3][x3 + k] !== motif[k]) okH = false; if (g2[x3 + k] && g2[x3 + k][y3] !== motif[k]) okV = false; }
        if (okH && ((x3 >= 4 && g2[y3].slice(x3 - 4, x3).every(function (v) { return !v; })) || (x3 + 11 <= n && g2[y3].slice(x3 + 7, x3 + 11).every(function (v) { return !v; })))) p += 40;
        if (okV) {
          var avant = true, apres = true;
          for (var k2 = 1; k2 <= 4; k2++) { if (x3 - k2 < 0 || g2[x3 - k2][y3]) avant = false; if (x3 + 6 + k2 >= n || g2[x3 + 6 + k2][y3]) apres = false; }
          if (avant || apres) p += 40;
        }
      }
      var noirs = 0;
      for (var y4 = 0; y4 < n; y4++) for (var x4 = 0; x4 < n; x4++) noirs += g2[y4][x4];
      p += Math.floor(Math.abs(noirs * 100 / (n * n) - 50) / 5) * 10;
      return p;
    }
    var meilleur = null, min = Infinity;
    for (var mq = 0; mq < 8; mq++) { var cand = appliquer(mq), pen = penalite(cand); if (pen < min) { min = pen; meilleur = cand; } }
    return meilleur;
  }
  function svgQR(texte, taille) {
    var g = matriceQR(texte);
    if (!g) return null;
    var n = g.length, marge = 4, dim = n + 2 * marge, chemins = [];
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (g[y][x]) chemins.push("M" + (x + marge) + " " + (y + marge) + "h1v1h-1z");
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 " + dim + " " + dim);
    svg.setAttribute("width", String(taille || 200)); svg.setAttribute("height", String(taille || 200));
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Code QR du lien d'invitation");
    var fond = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    fond.setAttribute("width", String(dim)); fond.setAttribute("height", String(dim)); fond.setAttribute("fill", "#fff");
    svg.appendChild(fond);
    var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", chemins.join("")); p.setAttribute("fill", "#000");
    svg.appendChild(p);
    return svg;
  }

  /* ---------- un menu flottant ----------
     Un seul element, pose sur le corps de la page en position fixe : il
     flotte au-dessus de tout et ne deforme pas ce qui l'entoure. Sert au
     « ⋯ » d'un message et a celui d'une carte de groupe. Il s'ouvre sous
     le bouton, a gauche si l'ecran finit a droite, au-dessus s'il finit en
     bas ; se ferme au clic ailleurs, a Echap, et quand on le redemande
     depuis le meme bouton. Entrees : [{ libelle, action, danger? }]. */
  var menuFlottant = (function () {
    var boite = null, bouton = null;
    function fermer() {
      if (boite) { boite.hidden = true; boite.textContent = ""; }
      bouton = null;
    }
    function ouvrir(depuis, entrees) {
      if (bouton === depuis) { fermer(); return; }
      if (!boite) {
        boite = document.createElement("div");
        boite.className = "grp-menu grp-menu-flottant";
        boite.setAttribute("role", "menu");
        boite.hidden = true;
        boite.addEventListener("click", function (ev) { ev.stopPropagation(); });
        document.body.appendChild(boite);
      }
      boite.textContent = "";
      entrees.forEach(function (e) {
        var b = document.createElement("button"); b.type = "button"; b.textContent = e.libelle; b.setAttribute("role", "menuitem");
        if (e.danger) b.className = "est-danger";
        b.addEventListener("click", function () { fermer(); e.action(); });
        boite.appendChild(b);
      });
      bouton = depuis;
      boite.hidden = false;
      var r = depuis.getBoundingClientRect ? depuis.getBoundingClientRect() : { left: 0, right: 0, top: 0, bottom: 0 };
      var largeur = boite.offsetWidth || 160, hauteur = boite.offsetHeight || 120;
      var largeurEcran = window.innerWidth || 1000, hauteurEcran = window.innerHeight || 800;
      var gauche = r.left, haut = r.bottom + 4;
      if (gauche + largeur > largeurEcran - 8) gauche = Math.max(8, r.right - largeur);
      if (haut + hauteur > hauteurEcran - 8) haut = Math.max(8, r.top - hauteur - 4);
      boite.style.left = Math.round(gauche) + "px";
      boite.style.top = Math.round(haut) + "px";
      var premier = boite.querySelector("button");
      if (premier && premier.focus) premier.focus();
    }
    document.addEventListener("click", fermer);
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") fermer(); });
    return { ouvrir: ouvrir, fermer: fermer, ouvert: function () { return !!bouton; } };
  })();

  /** Le meme remplacement, en version « plusieurs » : le champ porte les
      identifiants separes par des virgules ; a la place, une etiquette par
      fiche (son titre, retirable d'un « × ») et « Choisir des fiches… »
      qui ouvre la fenetre a cases. Le formulaire lit toujours le champ. */
  function brancherSelecteurFiches(input) {
    if (!input || input._selecteur) return;
    input._selecteur = true;
    input.hidden = true;
    var boite = document.createElement("div"); boite.className = "sf-champ sf-champ-multi";
    var liste = document.createElement("span"); liste.className = "sf-lu sf-etiquettes";
    var choisir = document.createElement("button"); choisir.type = "button"; choisir.className = "btn btn-petit";
    boite.appendChild(liste); boite.appendChild(choisir);
    input.parentNode.insertBefore(boite, input.nextSibling);
    function valeurs() { return input.value.split(",").map(function (v) { return v.trim(); }).filter(Boolean); }
    function poser(vs) { input.value = vs.join(","); peindre(); input.dispatchEvent(new Event("input")); }
    function peindre() {
      var vs = valeurs();
      liste.textContent = "";
      choisir.textContent = vs.length ? "Changer" : "Choisir des fiches…";
      if (!vs.length) { var v = document.createElement("span"); v.className = "sf-vide"; v.textContent = "Aucune fiche"; liste.appendChild(v); return; }
      vs.forEach(function (ch) {
        var e = document.createElement("span"); e.className = "sf-etiquette";
        var t = document.createElement("span"); t.textContent = ch; e.appendChild(t);
        var x = document.createElement("button"); x.type = "button"; x.className = "sf-etiquette-x"; x.textContent = "×"; x.title = "Retirer " + ch;
        x.setAttribute("aria-label", "Retirer " + ch);
        x.addEventListener("click", function () { poser(valeurs().filter(function (v) { return v !== ch; })); });
        e.appendChild(x);
        liste.appendChild(e);
        listeFiches().then(function (cat) {
          var f = ficheParChapitre(cat, ch);
          if (f) t.textContent = f.module.code + " · " + String(f.fiche.numero).padStart(2, "0") + " — " + f.fiche.titre;
        });
      });
    }
    choisir.addEventListener("click", function () {
      if (input.disabled) return;
      ouvrirSelecteurFiches(valeurs().map(function (v) { return v.split("#")[0]; }), function (choisies) {
        /* on garde une section (#…) deja posee sur une fiche toujours choisie */
        var avant = valeurs();
        poser(choisies.map(function (ch) {
          var deja = avant.filter(function (v) { return v.split("#")[0] === ch; })[0];
          return deja || ch;
        }));
      });
    });
    input.addEventListener("change", peindre);
    peindre();
  }

  /* ---------- un lien vers un element y mene, et le montre ----------
     Regle commune a tout le site : une adresse avec « #ancre » — a
     l'arrivee sur la page, au changement de « # », ou au clic sur un lien
     de la meme page — fait defiler jusqu'a l'element et le met en lumiere
     un instant. Les <details> fermes qui le contiennent s'ouvrent. Vaut
     pour « Relire la section » du quiz, les references d'un message, les
     sommaires de fiche, les citations, et tout lien futur. */
  var minuterieLumiere = null;
  function mettreEnLumiere(el) {
    if (!el) return;
    var d = el.parentElement;
    while (d) { if (d.tagName === "DETAILS") d.open = true; d = d.parentElement; }
    if (el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "smooth" });
    document.querySelectorAll(".lumiere").forEach(function (x) { x.classList.remove("lumiere"); });
    /* retirer puis remettre : l'animation repart meme sur le meme element */
    void el.offsetWidth;
    el.classList.add("lumiere");
    if (minuterieLumiere) clearTimeout(minuterieLumiere);
    minuterieLumiere = setTimeout(function () { el.classList.remove("lumiere"); }, 1800);
  }
  /* ---------- le mot cherche, surligne a l'arrivee (lot I) ----------
     La recherche depose dans sessionStorage la section visee et les mots
     tapes ; a l'arrivee sur « #section » — nouvelle page ou la meme —,
     on surligne la premiere occurrence de chaque mot dans la section (le
     titre, puis ses freres jusqu'au titre suivant) et on defile jusqu'au
     premier. Sans depot, ou pour une autre ancre : la mise en lumiere
     ordinaire suffit. Le depot ne sert qu'une fois : recharger la page
     ne resurligne pas. Les accents ne comptent pas, ni la casse : on
     cherche dans une copie sans accents, en gardant pour chaque
     caractere sa place dans l'original. */
  // Le résultat de recherche cliqué, le temps d'arriver sur la fiche : quelle section, quels mots surligner.
  var CLE_CIBLE = "fiches-recherche-cible";
  function normaliserAvecCarte(s) {
    var texte = "", carte = [];
    for (var i = 0; i < s.length; i++) {
      var c = sansAccent(s.charAt(i));
      for (var j = 0; j < c.length; j++) { texte += c.charAt(j); carte.push(i); }
    }
    return { texte: texte, carte: carte };
  }
  function marquerTexte(t, mot) {
    var p = t.parentNode;
    if (!p || /^(SCRIPT|STYLE|MARK)$/.test(p.nodeName)) return null;
    var n = normaliserAvecCarte(t.data), pos = n.texte.indexOf(mot);
    if (pos < 0) return null;
    var debut = n.carte[pos], fin = n.carte[pos + mot.length - 1] + 1;
    var milieu = t.splitText(debut); milieu.splitText(fin - debut);
    var m = document.createElement("mark"); m.className = "mot-cherche";
    p.insertBefore(m, milieu); m.appendChild(milieu);
    return m;
  }
  function marquerDans(noeud, mot) {
    if (noeud.nodeType === 3) return marquerTexte(noeud, mot);
    if (noeud.nodeType !== 1) return null;
    var marcheur = document.createTreeWalker(noeud, 4 /* SHOW_TEXT */, null, false), t, m;
    while ((t = marcheur.nextNode())) { m = marquerTexte(t, mot); if (m) return m; }
    return null;
  }
  function marquerMotsCherches(el) {
    var demande = null;
    try {
      demande = JSON.parse(sessionStorage.getItem(CLE_CIBLE) || "null");
      sessionStorage.removeItem(CLE_CIBLE);
    } catch (e) { demande = null; }
    if (!demande || !el || !el.id || demande.ancre !== el.id || !demande.mots || !demande.mots.length) return;
    var noeuds = [el], n = el.nextSibling;
    while (n && !(n.nodeType === 1 && /^H[12]$/.test(n.tagName))) { noeuds.push(n); n = n.nextSibling; }
    var marques = [];
    demande.mots.forEach(function (mot) {
      mot = sansAccent(String(mot || ""));
      if (!mot) return;
      for (var i = 0; i < noeuds.length; i++) { var m = marquerDans(noeuds[i], mot); if (m) { marques.push(m); return; } }
    });
    if (marques.length && marques[0].scrollIntoView) marques[0].scrollIntoView({ block: "center", behavior: "smooth" });
  }
  function cibleDuHash(hash) {
    if (!hash || hash.length < 2) return null;
    var id;
    try { id = decodeURIComponent(hash.slice(1)); } catch (e) { id = hash.slice(1); }
    if (!id) return null;
    var el = document.getElementById(id);
    if (!el) { try { el = document.querySelector('a[name="' + id.replace(/"/g, '\\"') + '"]'); } catch (e) { el = null; } }
    return el;
  }
  function eclairerLeHash() { var el = cibleDuHash(location.hash); mettreEnLumiere(el); marquerMotsCherches(el); }
  if (location.hash) setTimeout(eclairerLeHash, 60);
  if (window.addEventListener) window.addEventListener("hashchange", eclairerLeHash);
  document.addEventListener("click", function (ev) {
    var a = ev.target.closest ? ev.target.closest("a[href]") : null;
    if (!a || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey) return;
    var href = a.getAttribute("href") || "";
    var i = href.indexOf("#");
    if (i === -1) return;
    /* la meme page ? (href relatif « #x », ou meme chemin + « #x ») */
    var avant = href.slice(0, i);
    var memePage = !avant || avant === location.pathname || a.pathname === location.pathname;
    if (!memePage) return;
    var el = cibleDuHash(href.slice(i));
    if (!el) return;
    ev.preventDefault();
    if (history.pushState) history.pushState(null, "", href.slice(i)); else location.hash = href.slice(i);
    mettreEnLumiere(el);
    marquerMotsCherches(el);
  });

  /* ---------- qui est la : une seule question par page ----------
     Plusieurs morceaux de ce script veulent savoir qui est connecte (la
     barre, les cartes verrouillees, les raccourcis caches par role…). Ils
     posaient chacun la question a /api/moi : jusqu'a quatre appels pour une
     page d'accueil. Chaque appel est une execution de fonction Cloudflare,
     et le plan gratuit les compte. On ne demande qu'une fois ; la promesse
     est partagee. En cas d'echec, on oublie, pour qu'un prochain morceau
     puisse retenter. */
  var promesseMoi = null;
  function lireMoi() {
    if (!promesseMoi) {
      promesseMoi = fetch("/api/moi", { headers: { "Accept": "application/json" } })
        .then(function (r) { return r.json(); })
        .catch(function (e) { promesseMoi = null; throw e; });
    }
    return promesseMoi;
  }

  /* ---------- « ← » : revenir en arrière, sur toutes les pages ----------
     Un bouton dans l'en-tête, toujours au même endroit. Il revient à la
     page précédente si elle est du site (l'historique a une entrée, et
     le referrer est de la même origine — sinon « retour » quitterait le
     site) ; à défaut, il remonte à l'accueil. Caché sur l'accueil
     lui-même : il n'y a rien avant. */
  var boutonRetour = document.getElementById("retour");
  if (boutonRetour) {
    var racineSite = document.documentElement.getAttribute("data-racine") || "";
    var estAccueil = racineSite === "" && /(^|\/)(index\.html)?$/.test(location.pathname);
    boutonRetour.hidden = estAccueil;
    boutonRetour.addEventListener("click", function () {
      var interne = false;
      try { interne = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch (e) {}
      if (interne && window.history.length > 1) window.history.back();
      else location.href = racineSite + "index.html";
    });
  }

  /* ---------- thème clair / sombre ----------
     Par défaut on suit le réglage du système ; un clic force un thème et le
     mémorise sur cet appareil. */

  // Le thème clair ou sombre choisi sur cet appareil ; sans choix, on suit le système.
  var CLE_THEME = "fiches-theme";
  try {
    var memorise = localStorage.getItem(CLE_THEME);
    if (memorise) document.documentElement.setAttribute("data-theme", memorise);
  } catch (err) { /* navigation privée : on reste sur le réglage système */ }

  var boutonTheme = document.getElementById("theme");
  if (boutonTheme) {
    boutonTheme.addEventListener("click", function () {
      var actuel = document.documentElement.getAttribute("data-theme");
      var sombreSysteme = window.matchMedia("(prefers-color-scheme: dark)").matches;
      var suivant = actuel ? (actuel === "dark" ? "light" : "dark")
                           : (sombreSysteme ? "light" : "dark");
      document.documentElement.setAttribute("data-theme", suivant);
      try { localStorage.setItem(CLE_THEME, suivant); } catch (err) {}
    });
  }

  /* ---------- petit message passager ---------- */

  var bulle = document.getElementById("bulle");
  var minuteurBulle;
  function dire(texte) {
    if (!bulle) return;
    bulle.textContent = texte;
    bulle.hidden = false;
    clearTimeout(minuteurBulle);
    minuteurBulle = setTimeout(function () { bulle.hidden = true; }, 2600);
  }

  /* ---------- recherche ----------
     Filtre l'index embarqué (window.FICHES) sur le code du module, le titre,
     le sous-titre et les intitulés de sections. */

  var champ = document.getElementById("q");
  var boite = document.getElementById("resultats");

  function sansAccent(s) {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  /* ---------- chercher aussi dans le texte des fiches ----------

     On se souvient d'un mot d'une leçon sans se souvenir de son titre : sans
     cette option, un tel mot ne trouve rien, l'index ordinaire ne portant que
     les titres et les intitulés de section.

     Le texte des fiches pèse une vingtaine de fois l'index ordinaire. Il vit
     donc dans un second fichier, chargé À LA DEMANDE : sans cela, chaque
     visite paierait le prix d'une recherche que peu de gens font. Le choix est
     retenu d'une fois sur l'autre — le recocher à chaque page serait une
     option qu'on n'utiliserait jamais deux fois. */

  // « Chercher aussi dans le texte des fiches » reste coché d'une visite à l'autre.
  var CLE_CONTENU = "fiches-recherche-contenu";
  var dansLeTexte = false;
  try { dansLeTexte = localStorage.getItem(CLE_CONTENU) === "1"; } catch (err) { }

  var contenuPret = false;
  var contenuDemande = null;

  function chargerContenu() {
    if (contenuPret) return Promise.resolve(true);
    if (contenuDemande) return contenuDemande;
    contenuDemande = new Promise(function (resoudre) {
      var b = document.createElement("script");
      b.src = racine + "fiches/recherche-contenu.js" + (versionSite ? "?v=" + versionSite : "");
      b.onload = function () { contenuPret = true; resoudre(true); };
      /* Un refus d'accès ou une coupure : on le dira dans la liste plutôt que
         de laisser croire que la fiche cherchée n'existe pas. */
      b.onerror = function () { contenuDemande = null; resoudre(false); };
      document.head.appendChild(b);
    });
    return contenuDemande;
  }

  /** Un morceau de texte autour du premier mot trouvé. */
  function extrait(texte, mot) {
    var sansAcc = sansAccent(texte);
    var pos = sansAcc.indexOf(mot);
    if (pos < 0) return "";
    var debut = Math.max(0, pos - 40);
    var bout = texte.slice(debut, pos + mot.length + 60).trim();
    return (debut > 0 ? "…" : "") + bout + "…";
  }

  function echapper(t) {
    return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---------- ou, dans la fiche, le mot a ete trouve (lot I) ----------
     Un resultat ne dit pas seulement « cette fiche » : il mene a la
     SECTION ou le mot est, et la page d'arrivee l'y attend
     (marquerMotsCherches). Un mot trouve dans le code, le module, le
     titre ou le sous-titre vaut pour la fiche entiere ; les autres
     designent une section par son intitule — celle qui les porte tous,
     sinon celle du premier. Dans le texte, c'est la position du premier
     mot qui dit la section, grace aux bornes que le generateur publie a
     cote du texte (FICHES_SECTIONS). */
  var motsCourants = [];
  function ancreDe(id) { var s = String(id || ""), i = s.indexOf("#"); return i < 0 ? "" : s.slice(i + 1); }
  function sectionParTitre(f, mots) {
    var niveau = sansAccent([f.c, f.m, f.t, f.st].join(" "));
    var reste = mots.filter(function (m) { return niveau.indexOf(m) < 0; });
    if (!reste.length || !f.se || !f.se.length) return null;
    var sections = f.se.map(function (x) { return { a: ancreDe(x.i), t: x.t, n: sansAccent(x.t) }; });
    var toutes = sections.filter(function (x) { return reste.every(function (m) { return x.n.indexOf(m) >= 0; }); });
    var s = toutes[0] || sections.filter(function (x) { return x.n.indexOf(reste[0]) >= 0; })[0];
    return s && s.a ? { a: s.a, t: s.t } : null;
  }
  function sectionParPosition(f, cle, pos) {
    var bornes = (window.FICHES_SECTIONS || {})[cle];
    if (!bornes || !bornes.length) return null;
    var i = -1;
    while (i + 1 < bornes.length && bornes[i + 1][0] <= pos) i++;
    if (i < 0 || !bornes[i][1]) return null;
    var se = (f.se || [])[i];
    return { a: bornes[i][1], t: se && ancreDe(se.i) === bornes[i][1] ? se.t : "" };
  }

  function chercher(termes) {
    var fiches = window.FICHES || [];
    var textes = (dansLeTexte && contenuPret && window.FICHES_CONTENU) || null;
    var mots = termes.filter(Boolean);
    motsCourants = mots;
    var trouves = [];
    for (var i = 0; i < fiches.length; i++) {
      var f = fiches[i];
      var foin = sansAccent([f.c, f.m, f.t, f.st, f.so.join(" ")].join(" "));
      var ok = true, score = 0;
      for (var j = 0; j < mots.length; j++) {
        var pos = foin.indexOf(mots[j]);
        if (pos < 0) { ok = false; break; }
        score += pos;                       /* plus c'est tôt, mieux c'est */
      }
      if (ok) { trouves.push({ f: f, score: score, ou: "", sec: sectionParTitre(f, mots) }); continue; }

      /* Pas dans le titre. Le texte, alors — si on l'a demandé. Ces
         résultats passent APRÈS tous les autres : un mot dans un titre dit
         de quoi parle la fiche, un mot perdu dans le corps ne le dit pas. */
      if (!textes) continue;
      var cle = f.c + "-" + (f.n < 10 ? "0" + f.n : f.n);
      var texte = textes[cle];
      if (!texte) continue;
      var paille = sansAccent(texte);
      var tout = true, rang = 0;
      for (var k = 0; k < mots.length; k++) {
        var p2 = paille.indexOf(mots[k]);
        if (p2 < 0) { tout = false; break; }
        rang += p2;
      }
      if (tout) {
        trouves.push({ f: f, score: 100000 + rang, ou: extrait(texte, mots[0]),
                       sec: sectionParPosition(f, cle, paille.indexOf(mots[0])) });
      }
    }
    trouves.sort(function (a, b) { return a.score - b.score; });
    return trouves.slice(0, 12);
  }

  /** La ligne d'option, en tête de la liste. */
  function ligneOption(etat) {
    return '<label class="r-option">'
         + '<input type="checkbox" id="q-contenu"' + (dansLeTexte ? " checked" : "") + ">"
         + "<span>Chercher aussi dans le texte des fiches</span>"
         + (etat ? '<em class="r-etat">' + etat + "</em>" : "")
         + "</label>";
  }

  function afficher(resultats, etat) {
    var corps = resultats.length
      ? resultats.map(function (x) {
          var f = x.f, sec = x.sec;
          /* la section visee dans l'adresse, les mots tapes sur le lien :
             la page d'arrivee met la section en lumiere et surligne le mot */
          var cible = racine + f.u + (sec ? "#" + sec.a : "");
          return '<a href="' + echapper(cible) + '"' +
                 (sec ? ' data-mots="' + echapper(motsCourants.join(" ")) + '"' : "") + ">" +
                 '<div class="r-code">' + f.c + " · Partie " +
                 (f.n < 10 ? "0" + f.n : f.n) + "</div>" +
                 '<div class="r-titre">' + f.t + "</div>" +
                 (sec && sec.t
                   ? '<div class="r-ou r-section">§ ' + echapper(sec.t) + "</div>"
                   : '<div class="r-ou">' + f.m + " · " + f.p + " pages</div>") +
                 (x.ou ? '<div class="r-extrait">' + echapper(x.ou) + "</div>" : "") +
                 "</a>";
        }).join("")
      : '<div class="vide">Aucune fiche ne correspond.</div>';
    boite.innerHTML = ligneOption(etat) + corps;
    boite.hidden = false;
  }

  function relancer(etat) {
    var v = sansAccent(champ.value.trim());
    if (v.length < 2) { boite.hidden = true; return; }
    afficher(chercher(v.split(/\s+/)), etat);
  }

  if (champ && boite) {
    /* La case vit DANS la liste, réécrite à chaque frappe : on écoute donc la
       boîte, et non la case, qui n'est jamais deux fois le même élément. */
    boite.addEventListener("change", function (ev) {
      if (!ev.target || ev.target.id !== "q-contenu") return;
      dansLeTexte = ev.target.checked;
      try { localStorage.setItem(CLE_CONTENU, dansLeTexte ? "1" : "0"); } catch (err) { }
      if (!dansLeTexte) { relancer(""); return; }
      relancer("chargement…");
      chargerContenu().then(function (ok) {
        relancer(ok ? "" : "texte indisponible");
      });
    });

    /* Les mots tapes voyagent avec le clic (sessionStorage : cet onglet,
       cette fois) : la page d'arrivee les surligne dans la section visee. */
    boite.addEventListener("click", function (ev) {
      var a = ev.target.closest ? ev.target.closest("a[data-mots]") : null;
      if (!a) return;
      var href = a.getAttribute("href") || "", i = href.indexOf("#");
      if (i < 0) return;
      try {
        sessionStorage.setItem(CLE_CIBLE, JSON.stringify({ ancre: href.slice(i + 1), mots: a.getAttribute("data-mots").split(" ") }));
      } catch (e) { /* sans stockage : la section, sans le mot */ }
    });

    champ.addEventListener("input", function () {
      var v = sansAccent(champ.value.trim());
      if (v.length < 2) { boite.hidden = true; return; }
      /* Option déjà cochée d'une visite précédente : on charge au premier
         mot tapé, pas au chargement de la page. */
      if (dansLeTexte && !contenuPret) {
        relancer("chargement…");
        chargerContenu().then(function (ok) {
          relancer(ok ? "" : "texte indisponible");
        });
        return;
      }
      relancer("");
    });
    champ.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") { boite.hidden = true; champ.blur(); }
      if (ev.key === "Enter") {
        var premier = boite.querySelector("a");
        if (premier) premier.click();
      }
    });
    document.addEventListener("click", function (ev) {
      if (!ev.target.closest(".recherche")) boite.hidden = true;
    });
    /* « / » met le curseur dans la recherche, comme sur beaucoup de docs */
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "/" && document.activeElement !== champ) {
        ev.preventDefault();
        champ.focus();
      }
    });
  }

  /* ---------- déconnexion ----------
     On demande au serveur d'effacer le cookie : la page ne peut pas le faire
     elle-même, il est HttpOnly. On vide aussi la session Supabase gardée par
     le navigateur, sinon la page de connexion nous reconnecterait aussitôt. */

  var boutonDeconnexion = document.getElementById("deconnexion");
  if (boutonDeconnexion) {
    boutonDeconnexion.addEventListener("click", function (ev) {
      /* K3 : des cles SANS sauvegarde sont sur cet appareil. La deconnexion
         va les effacer (c'est voulu : un poste partage ne doit pas les
         garder) — mais alors elles sont perdues, et les messages chiffres
         avec. On le dit AVANT, et on propose d'aller les proteger. */
      var sansSauvegarde = false;
      // Des clés de chiffrement sans aucune sauvegarde sont sur cet appareil : la déconnexion prévient avant de les effacer.
      try { sansSauvegarde = localStorage.getItem("fiches-cles-sans-sauvegarde") === "1"; } catch (e) { }
      if (sansSauvegarde && !boutonDeconnexion.getAttribute("data-confirme")) {
        var partir = window.confirm("Tes messages privés chiffrés ne sont sauvegardés nulle part.\n\n"
          + "Te déconnecter efface tes clés de cet appareil : tu perdrais ces messages pour de bon.\n\n"
          + "OK : me déconnecter quand même.\nAnnuler : aller les protéger d\u2019abord (passkey ou phrase).");
        if (!partir) {
          ev.preventDefault();
          location.href = "/parametres.html#carte-chiffrement";
          return;
        }
      }
      try {
        for (var i = localStorage.length - 1; i >= 0; i--) {
          var cle = localStorage.key(i);
          if (cle && cle.indexOf("sb-") === 0) localStorage.removeItem(cle);
        }
      } catch (err) { /* stockage indisponible : tant pis, le cookie suffit */ }

      /* les cles du chiffrement de bout en bout (lot H) ne survivent pas a
         une deconnexion explicite : poste partage. Sans le module (page qui
         ne le charge pas), on efface la base IndexedDB par son nom. */
      try {
        if (window.Chiffrement) Chiffrement.stockage.effacerTout();
        // La base où cet appareil garde ses clés de chiffrement, vidée à la déconnexion (poste partagé).
        else if (window.indexedDB) indexedDB.deleteDatabase("fiches-but-cles");
      } catch (err) { /* pas d'IndexedDB : rien a effacer */ }

      fetch("/api/session", { method: "DELETE" })
        .then(function () { location.href = "/connexion.html"; })
        .catch(function () { location.href = "/connexion.html"; });
    });
  }

  /* ---------- panneau d'impression ---------- */

  var voile = document.getElementById("voile-impression");
  var boutonImprimer = document.getElementById("imprimer");

  if (boutonImprimer && voile) {
    boutonImprimer.addEventListener("click", function () { voile.hidden = false; });
    voile.addEventListener("click", function (ev) {
      if (ev.target === voile || ev.target.hasAttribute("data-fermer")) {
        voile.hidden = true;
      }
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") voile.hidden = true;
    });
  }

  /* ---------- partage ----------
     On partage l'adresse de la PAGE, jamais le fichier PDF : le destinataire
     arrive sur la fiche consultable, avec ses boutons. */

  var boutonPartager = document.getElementById("partager");
  if (boutonPartager) {
    boutonPartager.addEventListener("click", function () {
      var lien = window.location.href.split("#")[0];
      var titre = document.title;

      if (navigator.share) {
        navigator.share({ title: titre, url: lien }).catch(function () {});
        return;
      }
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(lien).then(
          function () { dire("Lien copié"); },
          function () { dire(lien); }
        );
        return;
      }
      /* repli : sélectionner le lien pour que l'utilisateur fasse Ctrl+C */
      var zone = document.createElement("textarea");
      zone.value = lien;
      zone.setAttribute("readonly", "");
      zone.style.position = "fixed";
      zone.style.opacity = "0";
      document.body.appendChild(zone);
      zone.select();
      try {
        document.execCommand("copy");
        dire("Lien copié");
      } catch (err) {
        dire("Copie impossible — le lien est dans la barre d'adresse");
      }
      document.body.removeChild(zone);
    });
  }

  /* ---------- proposer (lot G, refondu au lot L) ----------
     Un ⚑ par zone, posé à la génération (build_site.py : zone(),
     poser_drapeaux). Le bouton porte sa cible complète — « /quiz/#filtres »,
     « S1-R104-06#la-chaine-de-compilation » — et l'intitulé en clair de ce
     qu'il désigne. Le script n'a donc rien à deviner de la page où il est.

     Ce qu'il fait, lui :
       - il REMET les ⚑ que le rendu efface. Une zone repeinte par le script
         (les statistiques du quiz, une grille) perd le bouton posé dans son
         HTML ; un observateur le replace. Sans cela, les zones les plus
         vivantes du site seraient les seules à ne pas être proposables ;
       - il adapte la fenêtre à ce qui est visé : corriger et ajouter ne
         s'offrent que sur du contenu (une fiche, un module), et les
         libellés disent « cette section », « cette fiche » ou « ce module »
         selon le cas ;
       - il permet de CHANGER de cible sans quitter la fenêtre, en cherchant
         dans l'inventaire des zones (zones.json). C'est ce qui remplace la
         liste de pages écrite à la main : elle ne peut plus être périmée,
         puisqu'elle est écrite à chaque génération. */
  var dialogueProp = document.getElementById("prop-dialogue");

  /* Le ⚑ des zones repeintes. On ne recrée jamais un bouton là où il en
     reste un : l'observateur se déclenche sur sa propre insertion, et ce
     test est ce qui arrête la boucle. */
  var modeleDrapeau = document.getElementById("prop-drapeau-modele");
  if (modeleDrapeau && dialogueProp) {
    var racineCible = document.documentElement.getAttribute("data-cible") || "";
    var replaceEnCours = false;
    function replacerDrapeaux() {
      if (replaceEnCours || !racineCible) return;
      replaceEnCours = true;
      try {
        var zones = document.querySelectorAll("[data-zone]");
        for (var i = 0; i < zones.length; i++) {
          var z = zones[i];
          if (z.querySelector(":scope > .prop-drapeau")) continue;
          var id = z.getAttribute("data-zone");
          var titre = z.getAttribute("data-zone-titre") || id;
          var b = modeleDrapeau.content.firstElementChild.cloneNode(true);
          b.setAttribute("data-cible", racineCible + "#" + id);
          b.setAttribute("data-cible-titre", titre);
          b.setAttribute("data-proposer", racineCible.charAt(0) === "/" ? "technique" : "correction");
          b.setAttribute("title", "Proposer : " + titre);
          b.setAttribute("aria-label", "Proposer quelque chose sur : " + titre);
          /* Dans un titre, le ⚑ flotte à droite du texte ; ailleurs il se
             cale dans le coin. C'est la seule différence. */
          if (/^H[1-6]$/.test(z.tagName)) { b.classList.remove("prop-drapeau-bloc"); z.appendChild(b); }
          else z.insertBefore(b, z.firstChild);
        }
      } finally { replaceEnCours = false; }
    }
    var attenteDrapeaux = 0;
    new MutationObserver(function () {
      if (attenteDrapeaux) return;
      attenteDrapeaux = requestAnimationFrame(function () {
        attenteDrapeaux = 0; replacerDrapeaux();
      });
    }).observe(document.body, { childList: true, subtree: true });
    replacerDrapeaux();
  }

  if (dialogueProp) {
    var formProp = document.getElementById("prop-form");
    var champCibleProp = document.getElementById("prop-cible");
    var texteCibleProp = document.getElementById("prop-cible-texte");
    var ouCibleProp = document.getElementById("prop-cible-ou");
    var texteProp = document.getElementById("prop-texte");
    var motivationProp = document.getElementById("prop-motivation");
    var compteProp = document.getElementById("prop-compte");
    var etatProp = document.getElementById("prop-etat");
    var envoyerProp = document.getElementById("prop-envoyer");
    var changerProp = document.getElementById("prop-changer");
    var choisirProp = document.getElementById("prop-choisir");
    var rechercheProp = document.getElementById("prop-recherche");
    var listeZonesProp = document.getElementById("prop-zones");
    var etatZonesProp = document.getElementById("prop-zones-etat");

    /* La cible courante, telle que la fenêtre la connaît : la racine
       (« /quiz/ », « S1-R104-06 »), l'ancre de la zone s'il y en a une, et
       les deux intitulés à montrer. */
    var vise = { racine: "", ancre: "", titreRacine: "", titreZone: "" };
    var inventaire = null;   /* [ {cible, titre, contenu, zones:[…]} ] */

    var LIBELLES_PROP = {
      correction: "Corriger", ajout: "Ajouter",
      technique: "Signaler un problème technique",
      fonctionnalite: "Proposer une fonctionnalité"
    };

    function estContenu(racine) { return !!racine && racine.charAt(0) !== "/"; }
    function estModule(racine) { return /^S\d-[A-Z]\d{3}$/.test(racine); }

    function direProp(texte, type) {
      etatProp.textContent = texte || "";
      etatProp.className = "etat" + (type ? " etat-" + type : "");
      etatProp.hidden = !texte;
    }
    function typeProp() {
      var coche = formProp.querySelector('input[name="prop-type"]:checked');
      return coche ? coche.value : "";
    }

    /* Ce que « corriger » veut dire dépend de ce qu'on vise : une section,
       une fiche entière, un module. Le dire aide plus qu'un mot unique. */
    function libelleCorriger() {
      if (vise.ancre) return estModule(vise.racine) ? "Corriger cette partie" : "Corriger cette section";
      return estModule(vise.racine) ? "Corriger ce module" : "Corriger cette fiche";
    }
    function libelleAjouter() {
      return estModule(vise.racine) ? "Ajouter à ce module" : "Ajouter à cette fiche";
    }

    /* La fenêtre, refaite à chaque changement de type ou de cible. */
    function peindreProp() {
      var t = typeProp();
      var contenu = estContenu(vise.racine);

      formProp.querySelectorAll("#prop-types label").forEach(function (l) {
        var lt = l.getAttribute("data-type");
        /* Corriger et ajouter ne visent que du contenu : sur une page du
           site, la base les refuse — autant ne pas les offrir. */
        l.hidden = (lt === "correction" || lt === "ajout") && !contenu;
        var mot = l.querySelector("span");
        if (mot) mot.textContent = lt === "correction" ? libelleCorriger()
                : lt === "ajout" ? libelleAjouter() : LIBELLES_PROP[lt];
      });
      if (!contenu && (t === "correction" || t === "ajout")) {
        var repli = formProp.querySelector('input[name="prop-type"][value="technique"]');
        if (repli) { repli.checked = true; t = "technique"; }
      }

      /* « Ajouter » vise la fiche entière, pas la section : on retire
         l'ancre. Tout le reste garde la zone exacte. */
      champCibleProp.value = (t === "ajout" ? vise.racine : vise.racine + (vise.ancre ? "#" + vise.ancre : ""));
      texteCibleProp.textContent = (t === "ajout" || !vise.titreZone)
        ? (vise.titreRacine || vise.racine) : vise.titreZone;
      ouCibleProp.textContent = (t !== "ajout" && vise.titreZone && vise.titreRacine)
        ? "dans « " + vise.titreRacine + " »" : "";

      document.getElementById("prop-titre").textContent =
        t === "correction" ? libelleCorriger() : t === "ajout" ? libelleAjouter()
        : (LIBELLES_PROP[t] || "Proposer");
      document.getElementById("prop-texte-label").textContent =
        t === "technique" ? "Ce qui ne marche pas"
        : t === "fonctionnalite" ? "Ce que tu proposes" : "Ta proposition";
      compterProp();
    }

    function compterProp() {
      var m = motivationProp.value.trim().length, t = texteProp.value.trim().length;
      compteProp.textContent = (t < 10 ? "Ta proposition : " + (10 - t) + " caractère" + (10 - t > 1 ? "s" : "") + " de plus. " : "")
        + (m < 40 ? "Pourquoi : encore " + (40 - m) + " caractère" + (40 - m > 1 ? "s" : "") + "." : "");
      envoyerProp.disabled = !(t >= 10 && m >= 40);
    }
    formProp.addEventListener("change", peindreProp);
    texteProp.addEventListener("input", compterProp);
    motivationProp.addEventListener("input", compterProp);

    /* ----- l'inventaire des zones -----
       Deux fichiers : le public, et celui des fiches (réservé — il décrit
       le corpus). Le second peut répondre 401 ou 302 : c'est normal, on
       s'en passe et on ne propose alors que les pages. */
    function chargerInventaire() {
      if (inventaire) return Promise.resolve(inventaire);
      var racine = document.documentElement.getAttribute("data-racine") || "";
      function lire(url) {
        return fetch(url, { headers: { "Accept": "application/json" } })
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; });
      }
      return Promise.all([lire(racine + "zones.json"), lire(racine + "fiches/zones.json")])
        .then(function (deux) {
          var tout = [];
          deux.forEach(function (d) {
            if (d && Array.isArray(d.racines)) tout = tout.concat(d.racines);
          });
          inventaire = tout;
          return tout;
        });
    }

    /* Une ligne par zone, plus une par racine (« la page entière »). Au plus
       60 affichées : la liste sert à choisir, pas à tout parcourir. */
    function peindreZones() {
      var q = (rechercheProp.value || "").trim().toLowerCase();
      var lignes = [];
      (inventaire || []).forEach(function (r) {
        var candidats = [{ ancre: "", titre: r.titre, entier: true }];
        (r.zones || []).forEach(function (z) { candidats.push({ ancre: z.id, titre: z.titre }); });
        candidats.forEach(function (c) {
          var texte = (r.titre + " " + c.titre).toLowerCase();
          if (q && texte.indexOf(q) < 0) return;
          lignes.push({ racine: r.cible, titreRacine: r.titre, ancre: c.ancre,
                        titreZone: c.entier ? "" : c.titre, entier: !!c.entier });
        });
      });
      listeZonesProp.textContent = "";
      lignes.slice(0, 60).forEach(function (l) {
        var li = document.createElement("li");
        var b = document.createElement("button");
        b.type = "button";
        b.className = "prop-zone";
        var fort = document.createElement("strong");
        fort.textContent = l.entier ? l.titreRacine : l.titreZone;
        var note = document.createElement("span");
        note.className = "c-note";
        note.textContent = l.entier ? "la page entière" : "dans « " + l.titreRacine + " »";
        b.appendChild(fort); b.appendChild(note);
        b.addEventListener("click", function () {
          vise = { racine: l.racine, ancre: l.ancre,
                   titreRacine: l.titreRacine, titreZone: l.titreZone };
          choisirProp.hidden = true;
          peindreProp();
        });
        li.appendChild(b);
        listeZonesProp.appendChild(li);
      });
      etatZonesProp.textContent = !lignes.length
        ? (inventaire && inventaire.length ? "Rien de tel sur le site." : "Inventaire indisponible.")
        : (lignes.length > 60 ? lignes.length + " zones : précise ta recherche." : "");
    }

    changerProp.addEventListener("click", function () {
      if (!choisirProp.hidden) { choisirProp.hidden = true; return; }
      choisirProp.hidden = false;
      etatZonesProp.textContent = "Lecture de l'inventaire…";
      chargerInventaire().then(function () { peindreZones(); rechercheProp.focus(); });
    });
    rechercheProp.addEventListener("input", peindreZones);

    function ouvrirProp(bouton) {
      var cible = bouton.getAttribute("data-cible") || "/";
      var titre = bouton.getAttribute("data-cible-titre") || "";
      var coupe = cible.indexOf("#");
      vise = {
        racine: coupe < 0 ? cible : cible.slice(0, coupe),
        ancre: coupe < 0 ? "" : cible.slice(coupe + 1),
        /* Le titre du bouton décrit la ZONE quand il y a une ancre, la
           racine sinon. Le nom de la page complète l'affichage. */
        titreRacine: coupe < 0 ? titre : (document.title || "").split(" — ")[0],
        titreZone: coupe < 0 ? "" : titre
      };
      var radio = formProp.querySelector('input[name="prop-type"][value="'
        + (bouton.getAttribute("data-proposer") || "technique") + '"]');
      if (radio) radio.checked = true;
      texteProp.value = ""; motivationProp.value = "";
      choisirProp.hidden = true; rechercheProp.value = "";
      direProp("");
      envoyerProp.disabled = true;
      peindreProp();
      if (typeof dialogueProp.showModal === "function") dialogueProp.showModal(); else dialogueProp.setAttribute("open", "");
      texteProp.focus();
    }
    function fermerProp() { if (dialogueProp.open) dialogueProp.close(); else dialogueProp.removeAttribute("open"); }
    document.getElementById("prop-annuler").addEventListener("click", fermerProp);

    document.addEventListener("click", function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-proposer]");
      if (!b) return;
      ev.preventDefault();
      lireMoi().then(function (moi) {
        if (!moi || !moi.connecte) {
          location.href = "/connexion?suite=" + encodeURIComponent(location.pathname + location.search + location.hash);
          return;
        }
        ouvrirProp(b);
      }).catch(function () { dire("Service indisponible."); });
    });

    formProp.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var t = typeProp();
      var corps = {
        type: t, cible: champCibleProp.value,
        /* Le nom lisible part avec la proposition : trois mois plus tard,
           la zone peut avoir disparu — le texte doit rester compréhensible
           (supabase/2026_propositions_2.sql). */
        cible_titre: (t === "ajout" || !vise.titreZone) ? (vise.titreRacine || "") : vise.titreZone,
        texte: texteProp.value.trim(), motivation: motivationProp.value.trim()
      };
      if (corps.texte.length < 10 || corps.motivation.length < 40) { compterProp(); return; }
      envoyerProp.disabled = true;
      direProp("Envoi…", "info");
      fetch("/api/propositions", {
        method: "POST", headers: { "content-type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(corps)
      })
        .then(function (r) { return r.json().then(function (d) { return { r: r, d: d }; }); })
        .then(function (x) {
          if (!x.r.ok) { envoyerProp.disabled = false; direProp(x.d.erreur || "Échec.", "erreur"); return; }
          fermerProp();
          dire(x.d.note || "Proposition envoyée.");
        })
        .catch(function () { envoyerProp.disabled = false; direProp("Service indisponible.", "erreur"); });
    });
  }

  /* ---------- la carte du site (lot G) : filtrer ----------
     Un mot tapé : les lignes des tableaux et les blocs de migration qui ne
     le portent pas se cachent. Rien d'autre — la carte est un document. */
  var filtreCarte = document.getElementById("carte-filtre");
  if (filtreCarte) {
    var lignesCarte = document.querySelectorAll(".carte-table tbody tr, .carte-migration");
    filtreCarte.addEventListener("input", function () {
      var q = filtreCarte.value.trim().toLowerCase();
      lignesCarte.forEach(function (l) {
        l.hidden = !!q && l.textContent.toLowerCase().indexOf(q) < 0;
      });
    });
  }

  /* ---------- ressources des outils voisins ----------

     Une fiche ne sait rien des exercices, et l'agenda ne sait rien des
     fiches. Ce qu'ils partagent, ce sont des étiquettes : un code de module
     (R106) et un numéro de fiche. Chaque outil publie un index de ce qu'il
     a, tagué ainsi ; chacun lit celui de l'autre et affiche ce qui concerne
     la page courante.

     Le lien se fait ici, à l'affichage, et non à la génération du site : un
     exercice ajouté ce soir apparaît dans la fiche sans qu'on régénère quoi
     que ce soit. Et si l'outil voisin est en panne, le bloc ne s'affiche pas
     — la fiche reste entière. C'est le principe : jamais un outil ne doit
     pouvoir en casser un autre.

     ATTENTION en modifiant ce qui suit : le contenu de l'index vient d'un
     AUTRE site. On ne le pose donc jamais en HTML — uniquement en
     textContent — et on n'ouvre que des adresses https. Un index compromis
     ne doit pas pouvoir exécuter du code dans les pages des fiches. */

  var zoneLiees = document.getElementById("liees");
  var listeLiees = document.getElementById("liees-liste");
  var moduleCourant = document.documentElement.getAttribute("data-module");
  var ficheCourante = parseInt(
    document.documentElement.getAttribute("data-fiche") || "0", 10);

  var LIBELLES = {
    exercice: "Exercice",
    td: "TD",
    tp: "TP",
    correction: "Correction",
    seance: "Séance",
    cours: "Cours",
    ressource: "Ressource",
    podcast: "Audio"
  };

  function outilsAvecIndex() {
    var apps = (window.APPS && window.APPS.apps) || [];
    return apps.filter(function (a) { return a.actif && a.index; });
  }

  /* Un index par outil, gardé cinq minutes le temps de la visite : on ne
     rappelle pas le même fichier à chaque fiche ouverte. */
  function lireIndex(app) {
    var cle = "fb-index-" + app.id;
    try {
      var garde = JSON.parse(sessionStorage.getItem(cle) || "null");
      if (garde && Date.now() - garde.t < 300000) {
        return Promise.resolve(garde.d);
      }
    } catch (err) { /* stockage indisponible : on ira le chercher */ }

    var arret = new AbortController();
    var minuteur = setTimeout(function () { arret.abort(); }, 4000);

    return fetch(app.index, { credentials: "include", signal: arret.signal })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (donnees) {
        clearTimeout(minuteur);
        try {
          sessionStorage.setItem(cle, JSON.stringify({ t: Date.now(), d: donnees }));
        } catch (err) {}
        return donnees;
      })
      .catch(function () { clearTimeout(minuteur); return null; });
  }

  function concerne(r) {
    if (!r || r.module !== moduleCourant) return false;
    if (!ficheCourante) return true;              /* page de module : tout */
    if (!r.fiches || !r.fiches.length) return true;  /* rattaché au module */
    return r.fiches.indexOf(ficheCourante) >= 0;
  }

  function carte(r, app) {
    var lien = document.createElement("a");
    lien.className = "carte lien-outil";

    var adresse = typeof r.url === "string" ? r.url : "";
    if (/^https:\/\//.test(adresse)) {
      lien.href = adresse;
      lien.rel = "noopener";
    } else {
      lien.className += " sans-lien";           /* rien de cliquable */
    }

    /* « Exercice · Exercices » se lit mal. Quand le type et le nom de l'outil
       disent la même chose, on n'en garde qu'un. */
    var type = LIBELLES[r.type] || "Ressource";
    var a1 = sansAccent(type), a2 = sansAccent(app.nom);
    var redondant = a1.indexOf(a2) >= 0 || a2.indexOf(a1) >= 0;

    var haut = document.createElement("div");
    haut.className = "c-code";
    haut.textContent = redondant ? app.nom : type + " · " + app.nom;

    var titre = document.createElement("div");
    titre.className = "c-nom";
    titre.textContent = r.titre || "Sans titre";

    lien.appendChild(haut);
    lien.appendChild(titre);

    var bas = [];
    if (r.date) bas.push(r.date);
    if (r.fiches && r.fiches.length && !ficheCourante) {
      bas.push("fiche" + (r.fiches.length > 1 ? "s " : " ") + r.fiches.join(", "));
    }
    if (bas.length) {
      var meta = document.createElement("div");
      meta.className = "c-meta";
      meta.textContent = bas.join(" · ");
      lien.appendChild(meta);
    }
    return lien;
  }

  if (zoneLiees && listeLiees && moduleCourant) {
    var outils = outilsAvecIndex();
    if (outils.length) {
      Promise.all(outils.map(function (app) {
        return lireIndex(app).then(function (d) { return { app: app, d: d }; });
      })).then(function (reponses) {
        var trouvees = [];
        reponses.forEach(function (x) {
          var liste = (x.d && x.d.ressources) || [];
          if (!Array.isArray(liste)) return;
          liste.filter(concerne).forEach(function (r) {
            trouvees.push(carte(r, x.app));
          });
        });
        if (!trouvees.length) return;            /* rien : on n'affiche rien */
        trouvees.forEach(function (n) { listeLiees.appendChild(n); });
        zoneLiees.hidden = false;
      });
    }
  }

  /* ---------- connecté ou non : ce que la barre annonce ----------

     Le bouton dit « Se connecter » par defaut, ce qui est le bon etat
     quand on ne sait pas encore : un visiteur voit une invitation, et
     quelqu'un de connecte la voit se changer en « Mon compte ». L'inverse
     ferait clignoter une proposition de connexion a qui est deja
     connecte. */

  var lienCompte = document.getElementById("lien-compte");
  var bandeaux = document.querySelectorAll("[data-anonyme]");

  if (lienCompte || bandeaux.length) {
    lireMoi()
      .then(function (moi) {
        var connecte = moi && moi.connecte;

        /* Le pseudo est une condition PERMANENTE, verifiee a chaque page,
           et non une etape franchie une fois a la connexion. Une etape se
           rate : il suffit de fermer l'onglet devant le formulaire, et c'est
           exactement ainsi que des comptes sont restes sans pseudo. Une
           condition se represente tant qu'elle n'est pas remplie. */
        if (connecte && !moi.pseudo) {
          demanderPseudo();
        }
        /* Meme regle pour la notice de donnees : tant que la version
           acceptee n'est pas celle du site, la fenetre se represente. */
        if (connecte && moi.pseudo && moi.notice && moi.notice.a_accepter) {
          demanderNotice(moi.notice);
        }

        if (lienCompte && connecte) {
          lienCompte.textContent = moi.pseudo ? moi.pseudo : "Mon compte";
          lienCompte.href = racine + "compte.html";
          lienCompte.classList.remove("btn-accent");
          brancherMenuMoi(moi);
        }
        if (!connecte) {
          bandeaux.forEach(function (n) { n.removeAttribute("data-anonyme"); });
        }
      })
      .catch(function () {
        /* On n'a pas pu demander. Le doute profite a l'invitation : mieux
           vaut proposer un compte a quelqu'un qui en a deja un que de ne
           rien proposer a un visiteur. */
        bandeaux.forEach(function (n) { n.removeAttribute("data-anonyme"); });
      });
  }

  /* ---------- ce que le role demande ----------

     Ces cartes etaient cachees tant que le role n'etait pas connu. C'etait
     une erreur : un visiteur non connecte voyait un portail presque vide,
     donc rien qui lui donne envie de creer un compte, alors que c'est
     exactement ce qu'on lui demande de faire.

     Elles restent donc visibles, et disent ce qu'elles demandent. La pastille
     distingue les deux refus possibles, qui n'appellent pas la meme action :
     « compte requis » se resout en une minute, « acces sur demande » demande
     d'ecrire a quelqu'un.

     Repetons-le : ceci ne protege rien. La zone est gardee par le middleware,
     et cliquer une carte verrouillee mene a une page qui l'explique. */

  /* Page de demonstration : un compte connecte sans l'acces voit
     « Demander l'acces » a la place de « Creer un compte ». */
  var demoDemander = document.getElementById("demo-demander");
  if (demoDemander) {
    lireMoi()
      .then(function (moi) {
        if (moi && moi.connecte && moi.role === "user") {
          demoDemander.hidden = false;
          var creer = document.getElementById("demo-creer");
          if (creer) creer.hidden = true;
        }
      })
      .catch(function () { /* hors ligne : rien ne change */ });
  }

  var RANG_ROLE = { user: 0, reader_user: 1, super_user: 2 };
  var aRole = document.querySelectorAll("[data-role]");

  /* Deux besoins, deux attributs, et il a fallu s'y bruler pour le voir.

     Une CARTE du portail se montre toujours : cachee, elle n'apprend rien a
     personne. Un RACCOURCI de la barre du haut, lui, doit rester invisible
     tant qu'il ne mene nulle part - un bouclier d'administration offert a
     tous les regards annonce une porte sans rien en dire de vrai.

     Quand les deux partageaient l'attribut « data-role », rendre les cartes
     visibles a rendu le bouclier visible avec elles. */
  var aCacher = document.querySelectorAll("[data-role-cache]");

  function marquerAcces(carte, texte) {
    var pastille = carte.querySelector("[data-acces]");
    if (!pastille) return;
    if (!texte) {
      pastille.remove();
      carte.classList.remove("a-verrouille");
      return;
    }
    pastille.textContent = texte;
    carte.classList.add("a-verrouille");
  }

  /* Le fil d'une fiche de demonstration (lot M) : la page en porte deux,
     on efface celui qui ne correspond pas au rang. Le fil « demo » part
     quand l'acces etendu est confirme ; l'autre est decouvert par le meme
     mecanisme que les boutons (data-role-cache). */
  var filsDemo = document.querySelectorAll("[data-fil-demo]");
  if (filsDemo.length) {
    lireMoi()
      .then(function (moi) {
        var mien = moi && moi.connecte ? (RANG_ROLE[moi.role] || 0) : -1;
        if (mien >= RANG_ROLE.reader_user) filsDemo.forEach(function (n) { n.remove(); });
      })
      .catch(function () { /* hors ligne : le fil de la demonstration reste, et il est ouvert */ });
  }

  if (aCacher.length) {
    lireMoi()
      .then(function (moi) {
        var mien = moi && moi.connecte ? (RANG_ROLE[moi.role] || 0) : -1;
        aCacher.forEach(function (n) {
          var exige = RANG_ROLE[n.getAttribute("data-role-cache")];
          if (exige !== undefined && mien >= exige) {
            n.removeAttribute("data-role-cache");
          }
        });
      })
      .catch(function () { /* hors ligne : le raccourci reste cache */ });
  }

  /* « Messages » dans l'en-tete : pour qui a un compte, avec le nombre de
     non-lus que /api/moi rapporte (non_lus_total(), une question de plus
     a la base dans la meme execution). Absent : pas de pastille. */
  var lienMessages = document.getElementById("lien-messages");
  if (lienMessages) {
    lireMoi().then(function (moi) {
      if (!moi || !moi.connecte) return;
      lienMessages.removeAttribute("data-connecte-cache");
      /* seulement si la base a repondu : sur la messagerie, c'est la liste
         qui pose le compte, et un « inconnu » ne doit pas l'effacer */
      if (typeof moi.non_lus === "number") poserPastilleEnTete(moi.non_lus);
    }).catch(function () {});
  }
  function poserPastilleEnTete(n) {
    var p = document.getElementById("messages-pastille");
    if (!p) return;
    n = Number(n) || 0;
    p.hidden = !n;
    p.textContent = n ? libelleNonLus(n) : "";
    var l = document.getElementById("lien-messages");
    if (l) l.title = n ? "Messages · " + n + " discussion" + (n > 1 ? "s" : "") + " à lire" : "Messages";
  }

  /* ---------- sans actualiser (20 septembre) ----------
     Le service worker envoie « push » a chaque onglet ouvert quand une
     notification arrive ; et un onglet qui redevient visible a pu rater
     des messages pendant qu'il dormait. Dans les deux cas : une seule
     question, /api/moi, puis la pastille de l'en-tete, le titre, et ce que
     chaque page a demande a savoir (surNonLus : la carte du portail, la
     liste des conversations). Jamais deux demandes en meme temps. */
  var ecouteursNonLus = [];
  function surNonLus(f) { ecouteursNonLus.push(f); }
  var demandeNonLus = null;
  function rafraichirNonLus() {
    if (demandeNonLus) return demandeNonLus;
    demandeNonLus = fetch("/api/moi", { headers: { "Accept": "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (moi) {
        demandeNonLus = null;
        if (!moi || !moi.connecte || typeof moi.non_lus !== "number") return;
        promesseMoi = Promise.resolve(moi);
        poserPastilleEnTete(moi.non_lus);
        ecouteursNonLus.forEach(function (f) { try { f(moi.non_lus); } catch (e) { /* une page qui a change */ } });
      })
      .catch(function () { demandeNonLus = null; });
    return demandeNonLus;
  }
  if ("serviceWorker" in navigator && navigator.serviceWorker && typeof navigator.serviceWorker.addEventListener === "function") {
    navigator.serviceWorker.addEventListener("message", function (e) {
      if (e.data && e.data.type === "push") rafraichirNonLus();
    });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden || !lienMessages || lienMessages.hasAttribute("data-connecte-cache")) return;
    rafraichirNonLus();
  });

  if (aRole.length) {
    aRole.forEach(function (n) { n.classList.add("a-verrouille"); });

    lireMoi()
      .then(function (moi) {
        var connecte = moi && moi.connecte;
        /* Non connecte : aucun rang, pas meme celui de « user ». Sans quoi
           un visiteur anonyme lirait « acces sur demande » et croirait devoir
           ecrire, alors qu'il lui suffit de creer un compte. */
        var mien = connecte ? (RANG_ROLE[moi.role] || 0) : -1;
        aRole.forEach(function (n) {
          var exige = RANG_ROLE[n.getAttribute("data-role")];
          if (exige === undefined || mien >= exige) { marquerAcces(n, ""); return; }
          /* Un outil qui a de quoi se montrer sans compte n'annonce pas un
             obstacle : il annonce ce qu'on peut voir. La carte mène alors à
             la démonstration, et le cadenas ne s'affiche pas — il n'y a rien
             de verrouillé sur ce chemin-là. */
          if (!connecte && n.getAttribute("data-demo")) {
            marquerAcces(n, "démo");
            n.classList.remove("a-verrouille");
            n.setAttribute("href", n.getAttribute("data-demo"));
            return;
          }
          marquerAcces(n, connecte ? "accès sur demande" : "compte requis");
        });
      })
      .catch(function () { /* hors ligne : la pastille par defaut reste juste */ });
  }

  /* ---------- le menu « moi » (U1, docs/interface.md) ----------
     Avant : le bouton du pseudo menait a /compte, et « Parametres »,
     « Nouveautes » et « Donnees personnelles » n'avaient qu'un seul chemin —
     le pied de page. Or un pied n'est pas un menu : c'est une reserve ou
     l'on va chercher ce qu'on sait y etre. Mesure du 23 septembre : trois
     destinations sur quatre n'etaient atteignables que par lui.

     Le panneau ne coute AUCUN appel de plus : il se remplit de ce que
     `lireMoi()` a deja rapporte. Sans script, le bouton reste le lien vers
     /compte qu'il a toujours ete — rien ne se perd. Sans compte, il n'y a
     pas de menu du tout, seulement « Se connecter ».

     Sur telephone, une feuille qui monte du bas (un panneau ancre a droite
     deborde sous 380 px) ; sur ordinateur, un panneau sous le bouton. C'est
     un <dialog>, comme les autres fenetres du site : on herite du voile, de
     la touche Echap et du piege a tabulation.

     La deconnexion est le DERNIER element et se voit : un clic de trop y
     coute cher. Elle delegue au bouton de l'en-tete, qui sait deja effacer
     la session Supabase et les cles du chiffrement (lot H). */
  var LIBELLES_RANG = { user: "compte simple", reader_user: "accès aux fiches", super_user: "administrateur" };

  /* Combien de reponses ont ete rendues depuis la derniere visite de « Mes
     demandes » sur CET appareil ? /api/moi rend « suivi » (U3) ; la date vue
     est retenue en local, comme le « plus tard » des notifications. Zero =
     pas de pastille : on ne pastille pas ce qui attend encore. */
  function neufDansLeSuivi(moi) {
    var s = moi && moi.suivi;
    if (!s || !s.repondu) return 0;
    // La date de la dernière réponse vue dans « Mes demandes » : au-delà, la pastille du menu s'allume.
    var vu = lireLocal("fiches-suivi-vu");
    if (vu && s.dernier && !apresInstant(s.dernier, vu)) return 0;
    return s.repondu;
  }
  /* a strictement apres b ? Par l'instant, pas par la chaine : deux routes
     peuvent ecrire le meme instant « …+00:00 » ou « ….000Z », et « + » se
     classe avant « . » — la pastille ne s'eteignait alors jamais. */
  function apresInstant(a, b) {
    var ta = Date.parse(a), tb = Date.parse(b);
    if (isNaN(ta) || isNaN(tb)) return String(a) > String(b);
    return ta > tb;
  }
  /* l'adresse d'une page, sans « .html » ni « index » : Cloudflare sert
     /mes-demandes.html sous /mes-demandes */
  function cheminPage(chemin) {
    return String(chemin || "/").replace(/\.html$/, "").replace(/\/index$/, "/");
  }

  function brancherMenuMoi(moi) {
    if (!lienCompte || lienCompte.getAttribute("data-menu") === "1") return;
    lienCompte.setAttribute("data-menu", "1");
    lienCompte.setAttribute("aria-haspopup", "menu");
    lienCompte.setAttribute("aria-expanded", "false");
    lienCompte.classList.add("moi-declencheur");
    var chevron = document.createElement("span");
    chevron.className = "moi-chevron"; chevron.setAttribute("aria-hidden", "true");
    lienCompte.appendChild(chevron);
    /* Le bouton de deconnexion de l'en-tete devient redondant : il est dans
       le menu. On ne le retire QUE maintenant — c'est-a-dire seulement quand
       le menu existe vraiment. */
    var sortie = document.getElementById("deconnexion");
    if (sortie) sortie.hidden = true;

    lienCompte.addEventListener("click", function (ev) {
      ev.preventDefault();
      ouvrirMenuMoi(moi);
    });
  }

  function entreeMenu(libelle, adresse, classe) {
    var a = document.createElement("a");
    a.className = "moi-entree" + (classe ? " " + classe : "");
    a.href = adresse; a.textContent = libelle;
    a.setAttribute("role", "menuitem");
    return a;
  }

  function ouvrirMenuMoi(moi) {
    var deja = document.getElementById("moi-panneau");
    if (deja) { fermerMenuMoi(deja); return; }

    var d = document.createElement("dialog");
    d.className = "moi-panneau"; d.id = "moi-panneau";
    d.setAttribute("aria-label", "Mon espace");

    var tete = document.createElement("div"); tete.className = "moi-tete";
    var nom = document.createElement("strong"); nom.textContent = moi.pseudo || "Mon compte";
    var rang = document.createElement("span"); rang.className = "moi-rang";
    rang.textContent = LIBELLES_RANG[moi.role] || "compte";
    tete.appendChild(nom); tete.appendChild(rang);
    d.appendChild(tete);

    var liste = document.createElement("nav");
    liste.className = "moi-liste"; liste.setAttribute("role", "menu");
    liste.appendChild(entreeMenu("Mon compte", racine + "compte.html"));
    /* U3 : « Mes demandes », avec sa pastille quand une reponse est arrivee
       depuis la derniere fois qu'on a regarde cette page. */
    var mes = entreeMenu("Mes demandes", racine + "mes-demandes.html");
    var n = neufDansLeSuivi(moi);
    if (n) {
      var past = document.createElement("span");
      past.className = "nl-pastille moi-pastille";
      past.textContent = String(n);
      mes.appendChild(past);
    }
    liste.appendChild(mes);
    liste.appendChild(entreeMenu("Paramètres", racine + "parametres.html"));
    liste.appendChild(entreeMenu("Nouveautés", racine + "nouveautes.html"));
    liste.appendChild(entreeMenu("Données personnelles", racine + "donnees.html", "moi-entree-douce"));
    d.appendChild(liste);
    /* La page ou l'on est se marque (aria-current), et c'est ELLE qui prend
       le focus. Avant, le focus allait toujours a la premiere entree, et
       « :focus » la surlignait : ouvert depuis n'importe quelle page, le
       menu avait l'air de dire « tu es sur Mon compte » (proposition 3 du
       24 septembre). Le surlignage du focus ne vaut plus qu'au clavier
       (:focus-visible, voir le CSS). */
    var ici = null;
    liste.querySelectorAll("a.moi-entree").forEach(function (a) {
      if (cheminPage(a.pathname) === cheminPage(location.pathname)) { a.setAttribute("aria-current", "page"); ici = a; }
    });

    var sortie = document.createElement("div"); sortie.className = "moi-sortie";
    var partir = document.createElement("button");
    partir.type = "button"; partir.className = "moi-entree moi-partir";
    partir.textContent = "Se déconnecter"; partir.setAttribute("role", "menuitem");
    partir.addEventListener("click", function () {
      var b = document.getElementById("deconnexion");
      fermerMenuMoi(d);
      if (b) b.click(); else location.href = "/connexion.html";
    });
    sortie.appendChild(partir);
    d.appendChild(sortie);

    document.body.appendChild(d);
    /* sous le bouton, aligne sur son bord droit (voir le CSS) */
    var ou = lienCompte.getBoundingClientRect();
    d.style.setProperty("--moi-haut", Math.round(ou.bottom + 8) + "px");
    d.style.setProperty("--moi-droite", Math.max(8, Math.round(window.innerWidth - ou.right)) + "px");
    lienCompte.setAttribute("aria-expanded", "true");
    /* le voile : cliquer a cote ferme, comme les autres fenetres du site */
    d.addEventListener("click", function (ev) { if (ev.target === d) fermerMenuMoi(d); });
    d.addEventListener("close", function () { fermerMenuMoi(d); });
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
    var premiere = ici || d.querySelector(".moi-entree");
    if (premiere && premiere.focus) premiere.focus();
    return d;
  }

  function fermerMenuMoi(d) {
    if (!d || !d.parentNode) return;
    if (lienCompte) lienCompte.setAttribute("aria-expanded", "false");
    if (d.open && typeof d.close === "function") d.close();
    d.remove();
    if (lienCompte && lienCompte.focus) lienCompte.focus();
  }

  /* ---------- la pastille des non-lus sur le portail (lot F) ----------
     La carte « Groupes » porte le nombre de messages non lus dans tous
     mes groupes, et le titre de l'onglet le repete. Une seule question de
     plus, /api/groupes, et seulement pour une personne connectee : un
     visiteur n'a rien a lire. Hors ligne ou table absente : pas de
     pastille, plutot qu'une fausse. */
  /* U3 : la ligne du portail. Elle ne coute rien de plus — c'est le meme
     `lireMoi()` que tout le reste de la page. */
  var ligneSuivi = document.getElementById("portail-suivi");
  if (ligneSuivi) {
    lireMoi().then(function (moi) {
      var n = neufDansLeSuivi(moi);
      if (!n) return;
      document.getElementById("portail-suivi-nombre").textContent = String(n);
      document.getElementById("portail-suivi-texte").textContent =
        n > 1 ? "réponses t\u2019attendent sur tes demandes" : "réponse t\u2019attend sur tes demandes";
      ligneSuivi.hidden = false;
    }).catch(function () { /* hors ligne : pas de ligne, plutot qu'une fausse */ });
  }

  var carteGroupesPortail = document.querySelector('.carte.app[data-app="groupes"]');
  if (carteGroupesPortail) {
    lireMoi().then(function (moi) {
      if (!moi || !moi.connecte) return null;
      return appelGrp("GET", "/api/groupes");
    }).then(function (x) {
      if (!x || !x.ok) return;
      peindreNonLusPortail(conversationsNonLues(x.d));
      surNonLus(peindreNonLusPortail);
    }).catch(function () { /* hors ligne : rien */ });
  }
  function peindreNonLusPortail(total) {
    var nom = carteGroupesPortail.querySelector(".a-nom");
    if (!nom) return;
    var ancienne = nom.querySelector(".nl-pastille");
    if (ancienne) ancienne.remove();
    var nl = pastilleNonLus(total, "— discussion" + (total > 1 ? "s" : "") + " à lire");
    if (nl) nom.appendChild(nl);
    titreAvecNonLus(total);
    poserPastilleEnTete(total);
  }

  /* ---------- les notifications (lot F) ----------
     Web Push : le navigateur donne un abonnement (une adresse chez SON
     service de push, deux cles), le site l'enregistre a mon nom, et
     l'expediteur (functions/api/push/envoyer.js) chiffre chaque
     notification pour ce navigateur. Le service worker (/sw.js) l'affiche.

     Ici : savoir si ce navigateur sait faire, s'abonner (une seule
     fonction, du clic a la ligne en base), se desabonner, et entretenir
     l'abonnement au chargement des pages. Deux marques locales : « cet
     appareil est abonne » (pour ne pas redemander), « plus tard » (pour
     ne pas harceler : 14 jours). Rien de tout cela ne protege quoi que ce
     soit : la base ne garde que ce que la personne connectee lui donne. */
  // Cet appareil est abonné aux notifications : on ne lui repropose pas de l'être.
  var CLE_PUSH = "fiches-push";
  // La personne a répondu « plus tard » : on ne lui redemande pas avant 14 jours.
  var CLE_PUSH_PLUS_TARD = "fiches-push-plus-tard";
  // Le dernier jour où cet appareil abonné s'est représenté au site : une fois par jour suffit.
  var CLE_PUSH_COMPTE = "fiches-push-compte";
  var UN_JOUR = 24 * 3600 * 1000;
  function lireLocal(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function ecrireLocal(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  /* la cle VAPID publique, base64url → octets, pour applicationServerKey */
  function octetsDeBase64Url(t) {
    var b = (t + "===".slice((t.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/");
    var bin = atob(b), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function base64UrlDeTampon(buf) {
    var bin = "", oct = new Uint8Array(buf);
    for (var i = 0; i < oct.length; i++) bin += String.fromCharCode(oct[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  var notifs = {
    supporte: function () {
      return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    },
    /* iOS n'offre le push qu'a un site ajoute a l'ecran d'accueil */
    iosSansEcranAccueil: function () {
      return /iPhone|iPad|iPod/.test(navigator.userAgent) && window.navigator.standalone === false;
    },
    permission: function () { return "Notification" in window ? Notification.permission : "denied"; },
    marque: function () { return lireLocal(CLE_PUSH) === "1"; },
    plusTardRecent: function () {
      var t = Number(lireLocal(CLE_PUSH_PLUS_TARD) || 0);
      return t > 0 && Date.now() - t < 14 * UN_JOUR;
    },
    plusTard: function () { ecrireLocal(CLE_PUSH_PLUS_TARD, String(Date.now())); },
    /* « Chrome sur Windows » : de quoi reconnaitre l'appareil dans la liste */
    navigateur: function () {
      var ua = navigator.userAgent || "";
      var nav = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
              : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navigateur";
      var os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows"
             : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
      return nav + (os ? " sur " + os : "");
    },
    enregistrement: function () {
      return navigator.serviceWorker.register("/sw.js").then(function () { return navigator.serviceWorker.ready; });
    },
    abonnementLocal: function () {
      if (!notifs.supporte()) return Promise.resolve(null);
      return navigator.serviceWorker.getRegistration("/").then(function (r) {
        return r ? r.pushManager.getSubscription() : null;
      }).catch(function () { return null; });
    },
    /* du clic a la ligne en base ; repond { ok, raison, appareils } */
    activer: function () {
      if (!notifs.supporte()) return Promise.resolve({ ok: false, raison: "non_supporte" });
      var cle = null;
      return appelGrp("GET", "/api/push/abonnement").then(function (x) {
        if (!x.ok) return { ok: false, raison: x.d.indisponible ? "indisponible" : (x.statut === 401 ? "non_connecte" : "erreur"), message: x.d.erreur };
        if (!x.d.configure) return { ok: false, raison: "non_configure" };
        cle = x.d.cle_publique;
        return notifs.enregistrement().then(function (reg) {
          return Notification.requestPermission().then(function (perm) {
            if (perm !== "granted") return { ok: false, raison: perm === "denied" ? "refuse" : "plus_tard" };
            return reg.pushManager.getSubscription().then(function (sub) {
              /* un abonnement fait pour une autre cle (rotation) ne sert plus */
              var cleSub = sub && sub.options && sub.options.applicationServerKey ? base64UrlDeTampon(sub.options.applicationServerKey) : null;
              if (sub && cleSub && cleSub !== cle) return sub.unsubscribe().then(function () { return null; });
              return sub;
            }).then(function (sub) {
              return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: octetsDeBase64Url(cle) });
            }).then(function (sub) {
              var j = sub.toJSON();
              return appelGrp("POST", "/api/push/abonnement", { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, navigateur: notifs.navigateur() })
                .then(function (x) {
                  if (!x.ok) return { ok: false, raison: "erreur", message: x.d.erreur };
                  ecrireLocal(CLE_PUSH, "1"); ecrireLocal(CLE_PUSH_PLUS_TARD, null); ecrireLocal(CLE_PUSH_COMPTE, String(Date.now()));
                  return { ok: true, appareils: x.d.appareils };
                });
            });
          });
        });
      }).catch(function (e) { return { ok: false, raison: "erreur", message: e && e.message }; });
    },
    couper: function () {
      return notifs.abonnementLocal().then(function (sub) {
        var fin = function (x) { ecrireLocal(CLE_PUSH, null); return { ok: true, appareils: x && x.ok ? x.d.appareils : undefined }; };
        if (!sub) return appelGrp("GET", "/api/push/abonnement").then(fin, fin);
        return appelGrp("DELETE", "/api/push/abonnement?endpoint=" + encodeURIComponent(sub.endpoint))
          .then(function (x) { return sub.unsubscribe().then(function () { return fin(x); }); }, function () { return sub.unsubscribe().then(function () { return fin(null); }); });
      });
    },
    /* au chargement : un appareil marque abonne se represente au site une
       fois par jour (vu_le, et le navigateur devant lequel on est) ; un
       abonnement disparu (navigateur reinitialise) efface la marque */
    entretenir: function () {
      if (!notifs.marque() || !notifs.supporte()) return;
      var dernier = Number(lireLocal(CLE_PUSH_COMPTE) || 0);
      if (Date.now() - dernier < UN_JOUR) return;
      notifs.abonnementLocal().then(function (sub) {
        if (!sub) { ecrireLocal(CLE_PUSH, null); return; }
        var j = sub.toJSON();
        return appelGrp("POST", "/api/push/abonnement", { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, navigateur: notifs.navigateur() })
          .then(function (x) { if (x.ok) ecrireLocal(CLE_PUSH_COMPTE, String(Date.now())); });
      }).catch(function () {});
    },
    /* le mot qui va avec chaque raison de refus */
    explication: function (r) {
      return {
        non_supporte: "Ce navigateur ne sait pas recevoir de notifications.",
        non_configure: "Les notifications ne sont pas encore configurées sur ce site.",
        indisponible: "Les notifications ne sont pas encore ouvertes sur ce site.",
        non_connecte: "Il faut être connecté.",
        refuse: "Le navigateur a refusé : à changer dans ses réglages du site (l'icône à gauche de l'adresse).",
        plus_tard: "Pas maintenant, d'accord.",
        erreur: "Échec : " + ((r && r.message) || "service indisponible") + ".",
      }[(r && r.raison) || "erreur"];
    },
  };
  notifs.entretenir();

  /* le bandeau qui propose d'activer : sur la liste des groupes et dans
     un groupe (membre accepte). Seulement si le navigateur n'a pas encore
     repondu (permission « default »), que cet appareil n'est pas abonne,
     et qu'on n'a pas dit « plus tard » depuis 14 jours. Le bouton EST le
     geste : les navigateurs n'acceptent la demande qu'apres un clic. */
  function proposerNotifs(avant) {
    if (!avant || !avant.parentNode || document.getElementById("notif-bandeau")) return;
    if (!notifs.supporte() || notifs.permission() !== "default" || notifs.marque() || notifs.plusTardRecent()) return;
    if (notifs.iosSansEcranAccueil()) return;
    var b = document.createElement("div"); b.className = "grp-banniere notif-bandeau"; b.id = "notif-bandeau";
    var t = document.createElement("p");
    t.innerHTML = "<strong>Être prévenu des nouveaux messages ?</strong> Une notification par message dans tes groupes, même le site fermé. Tu choisis ce que tu reçois dans <a href=\"/parametres.html\">tes paramètres</a>.";
    b.appendChild(t);
    var actions = document.createElement("p");
    var oui = document.createElement("button"); oui.type = "button"; oui.className = "btn btn-accent btn-mini"; oui.textContent = "Activer les notifications";
    var non = document.createElement("button"); non.type = "button"; non.className = "btn btn-mini"; non.textContent = "Plus tard";
    var etat = document.createElement("span"); etat.className = "c-note notif-bandeau-etat";
    actions.appendChild(oui); actions.appendChild(document.createTextNode(" ")); actions.appendChild(non); actions.appendChild(document.createTextNode(" ")); actions.appendChild(etat);
    b.appendChild(actions);
    oui.addEventListener("click", function () {
      oui.disabled = true; etat.textContent = "Un instant…";
      notifs.activer().then(function (r) {
        if (r.ok) { etat.textContent = "C'est fait : cet appareil recevra les notifications."; non.textContent = "Fermer"; oui.hidden = true; }
        else { etat.textContent = notifs.explication(r); oui.disabled = false; if (r.raison === "refuse" || r.raison === "non_supporte" || r.raison === "non_configure" || r.raison === "indisponible") { oui.hidden = true; notifs.plusTard(); } }
      });
    });
    non.addEventListener("click", function () { notifs.plusTard(); b.remove(); });
    avant.parentNode.insertBefore(b, avant);
  }

  /* ---------- les nouveautes, a l'arrivee (lot J, puis chantier n° 6) ----------
     Une fenetre par version livree, pour qui revient : jamais a la
     premiere visite (on retient la version courante sans rien dire), une
     seule fois (la version vue est retenue sur l'appareil, comme le
     « plus tard » des notifications), et jamais par-dessus une autre
     fenetre — la notice a accepter, par exemple : la prochaine page
     suffira. Les entrees « pour : comptes » ne sont montrees qu'a qui est
     connecte ; un visiteur qui n'aurait rien a voir n'a pas de fenetre,
     et la version est retenue quand meme. Hors ligne ou en double-clic,
     le fichier ne vient pas : on redemandera. La page des nouveautes
     elle-meme vaut pour vue.

     Chantier n° 6 : chaque nouveaute est une ligne avec l'icone de sa
     famille et un bouton « Essayer » (la table des familles vient de
     nouveautes.json, ecrite par build_site.py, et nulle part ailleurs). Et
     la fenetre sait se rouvrir : qui clique « Essayer » puis revient par
     le bouton Retour la retrouve, ce qu'il a deja ouvert coche, tant qu'il
     ne l'a pas fermee. C'est l'onglet qui s'en souvient (sessionStorage),
     et seulement pour un retour (navigation « back_forward ») : revenir sur
     la page par un lien ne la rouvre pas. */
  // La dernière version des nouveautés montrée sur cet appareil : on ne la remontre pas.
  var CLE_NOUV = "fiches-nouveautes-vue";
  // La fenêtre des nouveautés quittée par « Essayer » : la page où la rouvrir au retour, la version vue avant, ce qui a été ouvert.
  var CLE_NOUV_REPRISE = "fiches-nouveautes-reprise";
  var versionNouv = document.documentElement.getAttribute("data-nouveautes") || "";
  var pageIci = location.pathname + location.search;
  function nouveautesVues() { ecrireLocal(CLE_NOUV, versionNouv); }
  function lireReprise() {
    try { return JSON.parse(sessionStorage.getItem(CLE_NOUV_REPRISE) || "null"); } catch (e) { return null; }
  }
  function ecrireReprise(r) {
    try { if (r) sessionStorage.setItem(CLE_NOUV_REPRISE, JSON.stringify(r)); else sessionStorage.removeItem(CLE_NOUV_REPRISE); } catch (e) {}
  }
  function arriveParRetour() {
    try {
      var nav = performance.getEntriesByType("navigation")[0];
      return !!nav && nav.type === "back_forward";
    } catch (e) { return false; }
  }
  function dateFr(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return iso || "";
    var mois = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
    return (Number(m[3]) === 1 ? "1er" : Number(m[3])) + " " + mois[Number(m[2]) - 1] + " " + m[1];
  }
  function montrerNouveautes(versions, familles, vue, ouvertes) {
    var d = document.createElement("dialog"); d.className = "edt-dialogue nv-dialogue"; d.id = "nouv-dialogue";
    /* trois versions au plus : qui revient apres des mois lit le reste sur
       la page, pas dans une fenetre qui n'en finirait pas */
    var montrees = versions.slice(0, 3), reste = versions.length - montrees.length;
    var lignes = "", n = 0;
    montrees.forEach(function (v) {
      v.changements.forEach(function (c) {
        var f = familles[c.famille] || familles.neuf || {};
        var couleur = /^#[0-9a-f]{6}$/i.test(f.couleur || "") ? f.couleur : "#444444";
        var deja = ouvertes.indexOf(n) >= 0;
        /* « Fiches » distingue une entree du corpus d'une entree du site ;
           la date, au survol, dit de quelle livraison elle vient */
        lignes += '<li class="nv-d-item' + (deja ? " nv-ouverte" : "") + '" style="--nv:' + couleur + '" title="' + echapper(dateFr(v.date)) + '">' +
          '<span class="nv-icone">' + (f.icone || "") + "</span>" +
          '<div class="nv-d-texte"><strong>' + echapper(c.titre || "") + "</strong>" +
          (v.journal === "fiches" ? ' <span class="nouv-tag nouv-tag-fiches">Fiches</span>' : "") +
          "<p>" + echapper(c.texte || "") + "</p></div>" +
          (c.lien ? '<a class="nv-essayer" data-n="' + n + '" href="' + echapper(racine + c.lien) + '">' + (v.journal === "fiches" ? "Lire" : "Essayer") + "</a>" : "") +
          "</li>";
        n += 1;
      });
    });
    var h = '<div class="nv-d-tete"><div><p class="nv-quand">Depuis ta dernière visite</p>' +
            "<h2>" + (n > 1 ? n + " nouveautés à essayer" : "Une nouveauté à essayer") + "</h2></div>" +
            '<button type="button" class="nv-x" id="nouv-x" aria-label="Fermer">×</button></div>' +
            '<ul class="nv-d-liste">' + lignes + "</ul>";
    if (reste) h += '<p class="c-note nv-d-reste">Et ' + reste + " version" + (reste > 1 ? "s" : "") + " plus ancienne" + (reste > 1 ? "s" : "") + ", sur la page des nouveautés.</p>";
    h += '<div class="edt-boutons"><button type="button" class="btn btn-accent" id="nouv-fermer">Compris</button>' +
         '<a class="btn" href="' + echapper(racine + "nouveautes.html") + '">Toutes les nouveautés</a></div>';
    d.innerHTML = h;
    document.body.appendChild(d);
    var ferme = false;
    function fermer() { if (ferme) return; ferme = true; nouveautesVues(); ecrireReprise(null); if (d.open && typeof d.close === "function") d.close(); d.remove(); }
    d.querySelector("#nouv-fermer").addEventListener("click", fermer);
    d.querySelector("#nouv-x").addEventListener("click", fermer);
    d.addEventListener("close", fermer);                                   /* Echap */
    d.addEventListener("click", function (ev) {
      if (ev.target === d) { fermer(); return; }                           /* le voile */
      var a = ev.target.closest && ev.target.closest("a[href]");
      if (!a) return;
      nouveautesVues();
      var i = a.getAttribute("data-n");
      if (i === null) { ecrireReprise(null); return; }                     /* « Toutes les nouveautés » */
      /* « Essayer » : la fenetre reste ouverte derriere le lien. Si la page
         revient du cache (bfcache), elle y est encore ; sinon, le retour la
         reconstruit depuis la reprise. */
      if (ouvertes.indexOf(Number(i)) < 0) ouvertes.push(Number(i));
      a.parentNode.classList.add("nv-ouverte");
      ecrireReprise({ page: pageIci, vue: vue, ouvertes: ouvertes });
    });
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
  }
  function annoncerNouveautes(vue, ouvertes) {
    fetch(racine + "nouveautes.json?v=" + encodeURIComponent(versionNouv), { headers: { "Accept": "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) return;
        /* les deux journaux dans une seule fenetre, du plus recent au plus
           ancien ; l'etiquette dit lequel */
        function marquer(liste, journal) {
          return (liste || []).map(function (v) {
            return { date: v.date, titre: v.titre, journal: journal, changements: v.changements || [] };
          });
        }
        var tout = marquer(j.versions, "site").concat(marquer(j.fiches, "fiches"));
        if (!tout.length) return;
        tout.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
        return lireMoi().catch(function () { return null; }).then(function (moi) {
          var connecte = !!(moi && moi.connecte);
          var versions = tout.filter(function (v) { return v && v.date > vue; }).map(function (v) {
            return { date: v.date, titre: v.titre, journal: v.journal,
                     changements: (v.changements || []).filter(function (c) { return connecte || c.pour !== "comptes"; }) };
          }).filter(function (v) { return v.changements.length; });
          if (!versions.length) { nouveautesVues(); ecrireReprise(null); return; }
          if (document.querySelector("dialog[open], .voile:not([hidden])")) return;   /* une autre fenetre d'abord */
          montrerNouveautes(versions, j.familles || {}, vue, ouvertes || []);
        });
      })
      .catch(function () { /* hors ligne, double-clic : on redemandera */ });
  }
  if (versionNouv) {
    var vueNouv = lireLocal(CLE_NOUV), reprise = lireReprise();
    var surLaPage = document.body.classList.contains("page-nouveautes");
    if (reprise && reprise.page === pageIci && !surLaPage && arriveParRetour() && typeof reprise.vue === "string") {
      /* le retour d'un « Essayer » : la fenetre telle qu'on l'a laissee */
      annoncerNouveautes(reprise.vue, Array.isArray(reprise.ouvertes) ? reprise.ouvertes : []);
    } else {
      if (reprise && reprise.page === pageIci) ecrireReprise(null);       /* revenu par un lien : on n'y revient plus */
      if (!vueNouv || surLaPage) nouveautesVues();
      else if (vueNouv < versionNouv) annoncerNouveautes(vueNouv, []);
    }
  }

  /* ---------- la carte du projet : onglets, lecture, filtres ---------- */
  var arbreCarte = document.getElementById("ca-arbre");
  if (arbreCarte) {
    var vues = document.querySelectorAll(".ca-vue");
    var ongCarte = document.getElementById("carte-onglets");
    ongCarte.querySelectorAll(".admin-onglet").forEach(function (b) {
      b.addEventListener("click", function () {
        var quel = b.getAttribute("data-onglet");
        ongCarte.querySelectorAll(".admin-onglet").forEach(function (x) {
          x.classList.toggle("est-actif", x === b);
        });
        vues.forEach(function (v) { v.hidden = v.getAttribute("data-carte") !== quel; });
      });
    });

    /* Decouverte / Technique : une classe sur l'arbre, le CSS cache l'autre.
       Rien n'est retire du document — qui imprime ou cherche voit tout. */
    document.querySelectorAll(".ca-mode").forEach(function (b) {
      b.addEventListener("click", function () {
        document.querySelectorAll(".ca-mode").forEach(function (x) { x.classList.toggle("est-actif", x === b); });
        arbreCarte.classList.toggle("mode-ingenieur", b.getAttribute("data-mode") === "ingenieur");
      });
    });

    /* un clic sur une reference ne doit pas plier le noeud qui la porte */
    arbreCarte.addEventListener("click", function (ev) {
      if (ev.target.closest && ev.target.closest("a.carte-ref")) ev.stopPropagation();
    });

    var boutonsDom = document.querySelectorAll("#ca-domaines .ca-dom");
    var caches = {};
    /* Les deux dessins lisent le meme arbre : des qu'un filtre, la recherche
       ou un depliage l'a change, il suffit de redessiner. */
    function redessinerCarte(recadrer) {
      if (window.CarteVues) window.CarteVues.redessiner(recadrer);
    }
    function appliquerDomaines() {
      arbreCarte.querySelectorAll("[data-domaine]").forEach(function (n) {
        n.classList.toggle("ca-hors", !!caches[n.getAttribute("data-domaine")]);
      });
      redessinerCarte(true);
    }
    boutonsDom.forEach(function (b) {
      b.addEventListener("click", function () {
        var d = b.getAttribute("data-dom");
        caches[d] = !caches[d];
        b.classList.toggle("est-actif", !caches[d]);
        appliquerDomaines();
      });
    });

    /* La recherche ouvre les branches qui portent un resultat et masque les
       autres. Sans l'ouverture, on chercherait dans des noeuds replies : le
       resultat serait la, invisible. */
    var champCarte = document.getElementById("ca-chercher");
    var rienCarte = document.getElementById("ca-rien");
    var ouverts = null;
    function chercherCarte() {
      var q = (champCarte.value || "").trim().toLowerCase();
      var noeuds = arbreCarte.querySelectorAll(".ca-n");
      if (!q) {
        if (ouverts) {
          noeuds.forEach(function (n) {
            n.classList.remove("ca-filtre-hors");
            if (n.tagName === "DETAILS") n.open = ouverts.indexOf(n) !== -1;
          });
          ouverts = null;
        }
        rienCarte.hidden = true;
        redessinerCarte(true);
        return;
      }
      if (!ouverts) {
        ouverts = [];
        noeuds.forEach(function (n) { if (n.tagName === "DETAILS" && n.open) ouverts.push(n); });
      }
      var trouves = 0;
      noeuds.forEach(function (n) {
        var texte = (n.getAttribute("data-id") + " " + n.textContent).toLowerCase();
        var vu = texte.indexOf(q) !== -1;
        n.classList.toggle("ca-filtre-hors", !vu);
        if (vu) {
          trouves++;
          var p = n.parentElement;
          while (p && p !== arbreCarte) {
            if (p.classList && p.classList.contains("ca-n")) {
              p.classList.remove("ca-filtre-hors");
              if (p.tagName === "DETAILS") p.open = true;
            }
            p = p.parentElement;
          }
        }
      });
      rienCarte.hidden = trouves > 0;
      redessinerCarte(true);
    }
    champCarte.addEventListener("input", chercherCarte);

    document.getElementById("ca-deplier").addEventListener("click", function () {
      arbreCarte.querySelectorAll("details.ca-n").forEach(function (d) { d.open = true; });
      redessinerCarte(true);
    });
    document.getElementById("ca-replier").addEventListener("click", function () {
      arbreCarte.querySelectorAll("details.ca-n").forEach(function (d) { d.open = d.getAttribute("data-niveau") === "0"; });
      redessinerCarte(true);
    });
  }

  /* ---------- la page Nouveautes : deux journaux, deux onglets ---------- */
  var ongNouv = document.getElementById("nouv-onglets");
  if (ongNouv) {
    var boutonsNouv = ongNouv.querySelectorAll(".admin-onglet");
    var journaux = document.querySelectorAll(".nouv-journal");
    function montrerJournal(quel) {
      boutonsNouv.forEach(function (b) {
        b.classList.toggle("est-actif", b.getAttribute("data-onglet") === quel);
      });
      journaux.forEach(function (d) { d.hidden = d.getAttribute("data-journal") !== quel; });
      try { history.replaceState(null, "", "#" + quel); } catch (e) { /* file:// */ }
    }
    boutonsNouv.forEach(function (b) {
      b.addEventListener("click", function () { montrerJournal(b.getAttribute("data-onglet")); });
    });
    if (location.hash === "#fiches") montrerJournal("fiches");
    /* une version visee (#24-septembre-2026-…, la cible d'une proposition) :
       les anciennes sont repliees depuis le chantier n° 6 — on montre son
       onglet et on la deplie, sans toucher a l'adresse */
    var viseeNouv = /^#[a-z0-9-]{1,120}$/.test(location.hash) && document.getElementById(location.hash.slice(1));
    var journalVise = viseeNouv && viseeNouv.closest && viseeNouv.closest(".nouv-journal");
    if (journalVise) {
      var quelVise = journalVise.getAttribute("data-journal");
      boutonsNouv.forEach(function (b) { b.classList.toggle("est-actif", b.getAttribute("data-onglet") === quelVise); });
      journaux.forEach(function (d) { d.hidden = d !== journalVise; });
      var plieVise = viseeNouv.querySelector("details");
      if (plieVise) plieVise.open = true;
      viseeNouv.scrollIntoView();
    }
  }

  /* ---------- la page Parametres ---------- */
  var blocNotif = document.getElementById("notif-bloc");
  if (blocNotif) {
    var nEtat = document.getElementById("notif-etat"), nActiver = document.getElementById("notif-activer"), nCouper = document.getElementById("notif-couper");
    var nChoix = document.getElementById("notif-choix"), nAppareils = document.getElementById("notif-appareils"), nToutCouper = document.getElementById("notif-tout-couper");
    function direParam(t, type) { var z = document.getElementById("etat"); z.textContent = t; z.className = "etat" + (type ? " etat-" + type : ""); z.hidden = !t; }
    function peindreAppareils(n, navigateurs) {
      nAppareils.textContent = !n ? "Aucun appareil abonné pour l'instant."
        : n + " appareil" + (n > 1 ? "s" : "") + " abonné" + (n > 1 ? "s" : "") + (navigateurs && navigateurs.length ? " : " + navigateurs.join(", ") : "") + ".";
      nToutCouper.hidden = !n;
    }
    function peindreEtatNotif() {
      document.getElementById("notif-ios").hidden = !notifs.iosSansEcranAccueil();
      document.getElementById("notif-refuse").hidden = notifs.permission() !== "denied";
      if (!notifs.supporte()) { nEtat.textContent = "Ce navigateur ne sait pas recevoir de notifications."; nActiver.hidden = true; nCouper.hidden = true; return Promise.resolve(); }
      return notifs.abonnementLocal().then(function (sub) {
        return appelGrp("GET", "/api/push/abonnement" + (sub ? "?endpoint=" + encodeURIComponent(sub.endpoint) : "")).then(function (x) {
          if (!x.ok) {
            nEtat.textContent = x.d.erreur || "Service indisponible."; nActiver.hidden = true; nCouper.hidden = true;
            if (!x.d.indisponible) direParam(x.d.erreur || "Service indisponible.", "erreur");
            return;
          }
          peindreAppareils(x.d.appareils, x.d.navigateurs);
          if (!x.d.configure) { nEtat.textContent = "Les notifications ne sont pas encore configurées sur ce site (clés VAPID absentes)."; nActiver.hidden = true; nCouper.hidden = true; return; }
          var abonne = !!(sub && x.d.abonne);
          if (abonne) { nEtat.textContent = "Abonné : les notifications arrivent ici (" + notifs.navigateur() + ")."; ecrireLocal(CLE_PUSH, "1"); }
          else if (notifs.permission() === "denied") nEtat.textContent = "Refusées par le navigateur.";
          else if (sub) nEtat.textContent = "Ce navigateur a un abonnement que le site ne connaît pas (autre compte ?) : active pour le reprendre.";
          else nEtat.textContent = "Pas abonné (" + notifs.navigateur() + ").";
          nActiver.hidden = abonne || notifs.permission() === "denied";
          nCouper.hidden = !sub;
        });
      });
    }
    nActiver.addEventListener("click", function () {
      nActiver.disabled = true; direParam("Un instant…", "info");
      notifs.activer().then(function (r) {
        nActiver.disabled = false;
        direParam(r.ok ? "C'est fait : cet appareil recevra les notifications." : notifs.explication(r), r.ok ? "succes" : "erreur");
        peindreEtatNotif();
      });
    });
    nCouper.addEventListener("click", function () {
      nCouper.disabled = true;
      notifs.couper().then(function () { nCouper.disabled = false; direParam("Cet appareil ne recevra plus de notifications.", "info"); peindreEtatNotif(); });
    });
    nToutCouper.addEventListener("click", function () {
      if (!window.confirm("Retirer tous tes appareils ? Aucun ne recevra plus de notifications tant que tu ne les réactives pas.")) return;
      appelGrp("DELETE", "/api/push/abonnement?tous=1").then(function (x) {
        if (!x.ok) { direParam(x.d.erreur || "Échec.", "erreur"); return; }
        return notifs.abonnementLocal().then(function (sub) { return sub ? sub.unsubscribe() : null; }).then(function () {
          ecrireLocal(CLE_PUSH, null); direParam("Tous tes appareils sont retirés.", "info"); peindreEtatNotif();
        });
      }).catch(function () { direParam("Service indisponible.", "erreur"); });
    });
    /* les deux choix par personne */
    appelGrp("GET", "/api/push/parametres").then(function (x) {
      if (!x.ok) { if (!x.d.indisponible) direParam(x.d.erreur || "Service indisponible.", "erreur"); return; }
      document.getElementById("notif-messages").checked = !!x.d.parametres.messages;
      document.getElementById("notif-rappels").checked = !!x.d.parametres.rappels;
      nChoix.disabled = false;
    }).catch(function () {});
    ["messages", "rappels"].forEach(function (k) {
      var case_ = document.getElementById("notif-" + k);
      case_.addEventListener("change", function () {
        var corps = {}; corps[k] = case_.checked;
        nChoix.disabled = true;
        appelGrp("PUT", "/api/push/parametres", corps).then(function (x) {
          nChoix.disabled = false;
          if (!x.ok) { case_.checked = !case_.checked; direParam(x.d.erreur || "Échec.", "erreur"); return; }
          case_.checked = !!x.d.parametres[k];
          direParam("Enregistré.", "succes");
        }).catch(function () { nChoix.disabled = false; case_.checked = !case_.checked; direParam("Service indisponible.", "erreur"); });
      });
    });
    peindreEtatNotif();
    /* le theme : la meme cle que le bouton de l'en-tete. L'etat monte en
       tete de la carte (U2) : on lit une ligne, pas trois boutons. */
    var LIBELLE_THEME = { "": "celui de ton système", light: "clair", dark: "sombre" };
    function direTheme() {
      var z = document.getElementById("theme-etat");
      if (!z) return;
      var v = lireLocal(CLE_THEME) || "";
      var systeme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "sombre" : "clair";
      z.textContent = "Réglé sur " + (LIBELLE_THEME[v] || "celui de ton système")
        + (v ? "" : " — " + systeme + " en ce moment") + ".";
    }
    var themeActuel = lireLocal(CLE_THEME) || "";
    document.querySelectorAll('input[name="theme"]').forEach(function (r) {
      r.checked = r.value === themeActuel;
      r.addEventListener("change", function () {
        if (r.value) { document.documentElement.setAttribute("data-theme", r.value); ecrireLocal(CLE_THEME, r.value); }
        else { document.documentElement.removeAttribute("data-theme"); ecrireLocal(CLE_THEME, null); }
        direTheme();
      });
    });
    direTheme();
  }

  /* ---------- une demande acceptee, puis l'acces retire ----------
     /api/demande renvoie le role LU EN BASE (lireProfilBase) ; il ne prend
     celui du jeton que si la base n'a pas repondu (etatAffiche). Or
     traiter_demande() donne le role reader_user DANS la transaction qui
     marque la demande « acceptee » : en base, les deux ne divergent jamais.
     « acceptee » + « user » n'a donc que deux explications :
       - la base n'a pas repondu et le role vient d'un jeton emis avant
         l'acceptation. Un jeton vit une heure au plus (le middleware le
         reconduit ensuite, avec le role a jour) : passe une heure apres
         traite_le, ce n'est plus possible ;
       - le role a ete change APRES (attribuer_role, depuis
         l'administration) : l'acces a ete retire, et la demande, elle, est
         restee « acceptee ».
     Le seuil : l'heure du jeton, plus une heure de marge pour l'horloge de
     l'appareil (traite_le est l'heure du serveur, Date.now() celle de la
     personne). Au-dela, dire « reconnecte-toi » menait a une impasse : ni
     les fiches, ni de quoi redemander (constate le 1er octobre 2026). Une
     acceptation sans date ne vient pas de traiter_demande : on la tient
     pour ancienne, plutot que d'enfermer la personne. */
  var DELAI_ROLE_MS = 2 * 3600 * 1000;
  function accesRetire(role, d) {
    if (!d || d.statut !== "acceptee" || role === "reader_user" || role === "super_user") return false;
    var t = d.traite_le ? new Date(d.traite_le).getTime() : NaN;
    return isNaN(t) || Date.now() - t > DELAI_ROLE_MS;
  }

  /* ---------- « Mes demandes » (U3) ----------
     Deux listes, deux appels — ceux que les pages faisaient deja chacune de
     son cote. En sortant, on retient la date de la derniere reponse vue :
     c'est ce qui eteint la pastille du menu, par appareil (localStorage),
     comme le « plus tard » des notifications. */
  var CLE_SUIVI_VU = "fiches-suivi-vu";
  function appelSimple(adresse) {
    return fetch(adresse, { headers: { "Accept": "application/json" } })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); });
  }
  var zoneAcces = document.getElementById("dem-acces");
  if (zoneAcces) {
    var zonePropDem = document.getElementById("dem-propositions");
    var ETATS_PROP_D = { en_attente: "en attente", acceptee: "acceptée, à intégrer", refusee: "refusée", integree: "intégrée" };
    var TYPES_PROP_D = { correction: "correction", ajout: "ajout", technique: "problème technique", fonctionnalite: "fonctionnalité" };
    var ETATS_DEM_D = { en_attente: "en attente", acceptee: "acceptée", refusee: "refusée" };
    var plusRecent = null;
    function retenirDate(iso) { if (iso && (!plusRecent || apresInstant(iso, plusRecent))) plusRecent = iso; }
    function jourDe(iso) { if (!iso) return ""; var d = new Date(iso); return isNaN(d) ? iso : d.toLocaleDateString("fr-FR"); }
    function noteDem(zone, texte) {
      zone.textContent = "";
      var p = document.createElement("p"); p.className = "c-note"; p.textContent = texte; zone.appendChild(p);
    }
    function carteSuivi(tete, corps, reponse, traitee) {
      var c = document.createElement("article");
      c.className = "demande-carte" + (traitee ? " demande-traitee" : "");
      var t = document.createElement("div"); t.className = "demande-tete"; t.textContent = tete; c.appendChild(t);
      if (corps) { var b = document.createElement("blockquote"); b.className = "demande-motif"; b.textContent = corps; c.appendChild(b); }
      if (reponse) { var r = document.createElement("p"); r.className = "c-note"; r.textContent = reponse; c.appendChild(r); }
      return c;
    }
    function boutonsAcces(zone, etat) {
      var p = document.createElement("p"); p.className = "dem-actions";
      var liens = etat === "ouvert" ? [["Lire les fiches", "/fiches/", true]]
                : etat === "aucune" ? [["Demander l\u2019accès", "/demande-acces.html", true], ["Voir la démonstration", "/demo.html", false]]
                : [["Voir le détail", "/demande-acces.html", false], ["Voir la démonstration", "/demo.html", false]];
      liens.forEach(function (l) {
        var a = document.createElement("a"); a.className = "btn" + (l[2] ? " btn-accent" : "");
        a.href = l[1]; a.textContent = l[0]; p.appendChild(a); p.appendChild(document.createTextNode(" "));
      });
      zone.appendChild(p);
    }

    var lectureAcces = appelSimple("/api/demande").then(function (x) {
      zoneAcces.textContent = "";
      if (!x.ok || x.d.indisponible) { noteDem(zoneAcces, (x.d && (x.d.erreur || x.d.note)) || "Pas encore ouvert."); return; }
      if (x.d.role === "reader_user" || x.d.role === "super_user") {
        zoneAcces.appendChild(carteSuivi("C\u2019est ouvert : tu as accès aux fiches", "", "Les fiches, leurs PDF, la recherche dans le texte et le catalogue te sont ouverts.", true));
        boutonsAcces(zoneAcces, "ouvert");
        return;
      }
      var d = (x.d.demandes || [])[0];
      if (!d) {
        noteDem(zoneAcces, "Tu n\u2019as pas encore demandé l\u2019accès aux fiches.");
        boutonsAcces(zoneAcces, "aucune");
        return;
      }
      var traitee = d.statut !== "en_attente";
      var retire = accesRetire(x.d.role, d);
      if (traitee) retenirDate(d.traite_le || d.cree_le);
      zoneAcces.appendChild(carteSuivi(
        "Demande " + (retire ? "acceptée, puis accès retiré" : (ETATS_DEM_D[d.statut] || d.statut))
          + " · envoyée le " + jourDe(d.cree_le)
          + (traitee && d.traite_le ? " · répondue le " + jourDe(d.traite_le) : ""),
        d.justification || "",
        retire ? "L’accès t’a été retiré depuis. Tu peux le redemander."
          : d.motif ? "Motif : " + d.motif : (traitee ? "" : "Elle sera lue par une personne, en général sous une semaine."),
        traitee));
      boutonsAcces(zoneAcces, retire ? "aucune" : d.statut === "acceptee" ? "ouvert" : "autre");
    }).catch(function () { noteDem(zoneAcces, "Service indisponible."); });

    var lecturePropositions = appelSimple("/api/propositions").then(function (x) {
      zonePropDem.textContent = "";
      if (!x.ok || x.d.indisponible) { noteDem(zonePropDem, (x.d && (x.d.erreur || x.d.note)) || "Pas encore ouvert."); return; }
      var liste = x.d.propositions || [];
      if (!liste.length) { noteDem(zonePropDem, "Aucune proposition pour l\u2019instant."); return; }
      liste.forEach(function (p) {
        var traitee = p.etat !== "en_attente";
        if (traitee) retenirDate(p.traite_le);
        zonePropDem.appendChild(carteSuivi(
          (TYPES_PROP_D[p.type] || p.type) + " · " + (p.cible_titre || p.cible) + " · " + jourDe(p.cree_le)
            + " · " + (ETATS_PROP_D[p.etat] || p.etat),
          p.texte, p.note ? "Réponse : " + p.note : "", traitee));
      });
    }).catch(function () { noteDem(zonePropDem, "Service indisponible."); });

    /* On a vu ce qui etait la : la pastille s'eteint. Au chargement suivant,
       seule une reponse PLUS RECENTE la rallumera.
       Proposition 3 du 24 septembre : elle ne s'eteignait pas. Deux raisons.
       (a) On retenait la date au bout de 1,2 s, lectures finies ou non : une
       fonction Cloudflare a froid met plus que cela, et rien n'etait ecrit.
       On attend maintenant que les deux cartes soient peintes. (b) La page
       et la pastille ne comptaient pas la meme chose : la pastille (/api/moi)
       compte la demande d'acces acceptee, mais la carte « C'est ouvert » d'un
       compte qui a deja l'acces ne relevait pas sa date — pour toute
       personne dont l'acces avait ete accorde, la pastille restait allumee
       pour toujours. On retient donc aussi la date meme que la pastille
       compare (moi.suivi.dernier) : ce que la pastille annonce, la page
       l'a montre. Puis on eteint celle du menu, s'il est ouvert. */
    Promise.all([
      lectureAcces.catch(function () {}),
      lecturePropositions.catch(function () {}),
      lireMoi().catch(function () { return null; }),
    ]).then(function (r) {
      var moi = r[2];
      if (moi && moi.suivi) retenirDate(moi.suivi.dernier);
      if (!plusRecent) return;
      var vu = lireLocal(CLE_SUIVI_VU);
      if (!vu || apresInstant(plusRecent, vu)) ecrireLocal(CLE_SUIVI_VU, plusRecent);
      document.querySelectorAll(".moi-pastille").forEach(function (n) { n.remove(); });
    });
  }

  /* ---------- la fenetre du pseudo ----------

     Elle remplace une page dediee. La difference n'est pas cosmetique : une
     page se quitte - onglet ferme, retour arriere, clic sur le logo - et
     plus rien ne ramene. Une fenetre se represente a chaque page tant que le
     pseudo manque.

     Elle ne se ferme pas, et c'est voulu : sans pseudo, on ne peut rien
     signer sans devenir anonyme par accident. Mais elle n'enferme personne -
     elle porte la notice de donnees et la deconnexion. On peut toujours
     partir ; on ne peut simplement pas rester sans nom. */

  var fenetrePseudo = null;

  /* ---------- la notice de donnees a change : la faire accepter ----------
     Une nouvelle donnee ou une nouvelle finalite (docs/donnees-personnelles.md) : la version
     de la notice change, et le consentement donne pour l'ancienne ne vaut
     pas pour la nouvelle. Un compte venu par Google, GitHub ou Discord n'a
     jamais coche de case : meme fenetre, une fois. Trois pages y echappent,
     pour qu'on puisse LIRE la notice, revenir a son compte (le supprimer) et
     se deconnecter sans avoir accepte : /donnees, /compte, /connexion —
     comme pour le pseudo, sur le chemin entier. Le jeton retarde jusqu'a une
     heure sur l'acceptation : la page retient la version acceptee sur cet
     appareil (localStorage) pour ne pas redemander dans l'intervalle. */
  var CLE_NOTICE = "notice-acceptee";
  function demanderNotice(notice) {
    var chemin = location.pathname.replace(/\.html$/, "").replace(/\/+$/, "") || "/";
    if (chemin === "/donnees" || chemin === "/compte" || chemin === "/connexion") return;
    if (lireLocal(CLE_NOTICE) === notice.version) return;
    if (document.getElementById("voile-notice")) return;

    var voile = document.createElement("div");
    voile.className = "voile";
    voile.id = "voile-notice";
    voile.innerHTML =
      '<div class="panneau panneau-pseudo" role="dialog" aria-modal="true" aria-labelledby="titre-notice">'
    + '<h2 id="titre-notice">' + (notice.acceptee ? "La notice de données a changé" : "Tes données : la notice") + '</h2>'
    + '<p class="e-st">' + (notice.acceptee
        ? "Tu avais accepté la version du " + echapperTexte(notice.acceptee) + ". Celle du "
          + echapperTexte(notice.version) + " dit une donnée ou un usage de plus : lis-la, puis accepte pour continuer."
        : "Ton compte est venu par un service externe, sans case à cocher. Le site enregistre des données"
          + " à ton sujet : lis ce qu'il en fait, puis accepte pour continuer.") + '</p>'
    + '<p><a class="btn" href="/donnees.html" target="_blank" rel="noopener">Lire la notice (version du '
    + echapperTexte(notice.version) + ')</a></p>'
    + '<p class="c-note" id="etat-notice"></p>'
    + '<div class="pied">'
    + '<button class="btn btn-accent" type="button" id="notice-accepter">J\'accepte</button>'
    + '</div>'
    + '<p class="c-note pseudo-issues">'
    + '<a href="/compte.html">Mon compte (supprimer)</a> · '
    + '<button type="button" class="lien-bouton" id="notice-partir">Se déconnecter</button></p>'
    + '</div>';
    document.body.appendChild(voile);

    var etat = voile.querySelector("#etat-notice");
    var bouton = voile.querySelector("#notice-accepter");
    bouton.addEventListener("click", function () {
      bouton.disabled = true;
      etat.textContent = "Enregistrement…";
      fetch("/api/consentement", {
        method: "POST",
        headers: { "content-type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ version: notice.version })
      })
        .then(function (r) { return r.json().then(function (d) { return { r: r, d: d }; }); })
        .then(function (x) {
          if (!x.r.ok || !x.d.ok) { bouton.disabled = false; etat.textContent = x.d.erreur || "Échec."; return; }
          ecrireLocal(CLE_NOTICE, x.d.version);
          voile.hidden = true;
        })
        .catch(function () { bouton.disabled = false; etat.textContent = "Service indisponible."; });
    });
    voile.querySelector("#notice-partir").addEventListener("click", function () {
      var b = document.getElementById("deconnexion");
      if (b) b.click(); else location.href = "/connexion";
    });
  }
  function echapperTexte(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function demanderPseudo() {
    if (fenetrePseudo) { fenetrePseudo.hidden = false; return; }

    fenetrePseudo = document.createElement("div");
    fenetrePseudo.className = "voile";
    fenetrePseudo.id = "voile-pseudo";
    fenetrePseudo.innerHTML =
      '<div class="panneau panneau-pseudo" role="dialog" aria-modal="true"'
    + '     aria-labelledby="titre-pseudo">'
    + '<h2 id="titre-pseudo">Choisis ton pseudo</h2>'
    + '<p class="e-st">C\'est le nom que les autres verront. Ton adresse de '
    + 'courriel, elle, n\'est jamais affichée.</p>'
    + '<form id="form-pseudo">'
    + '<label for="pseudo-fenetre">Pseudo</label>'
    + '<input type="text" id="pseudo-fenetre" autocomplete="nickname"'
    + '       spellcheck="false" autocapitalize="off" minlength="3"'
    + '       maxlength="20" required>'
    + '<p class="c-note" id="etat-pseudo-fenetre">3 à 20 caractères : '
    + 'lettres, chiffres, tiret et souligné.</p>'
    + '<div class="pied">'
    + '<button class="btn btn-accent" type="submit">Enregistrer</button>'
    + '</div></form>'
    + '<p class="c-note pseudo-issues">'
    + '<a href="/donnees.html">Ce qui est fait de mes données</a>'
    + ' · '
    + '<button type="button" class="lien-bouton" id="pseudo-partir">'
    + 'Se déconnecter</button></p>'
    + '</div>';
    document.body.appendChild(fenetrePseudo);

    var champ = fenetrePseudo.querySelector("#pseudo-fenetre");
    var etat = fenetrePseudo.querySelector("#etat-pseudo-fenetre");
    var form = fenetrePseudo.querySelector("#form-pseudo");

    function direP(t, type) {
      etat.textContent = t;
      etat.className = "c-note" + (type ? " etat-" + type : "");
    }

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var valeur = champ.value.trim();
      if (!/^[A-Za-z0-9_-]{3,20}$/.test(valeur)) {
        direP("3 à 20 caractères : lettres, chiffres, tiret et souligné.",
              "erreur");
        return;
      }
      direP("Enregistrement…", "info");
      fetch("/api/pseudo", {
        method: "POST",
        headers: { "content-type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ pseudo: valeur })
      })
        .then(function (r) {
          return r.json().then(function (d) { return { r: r, d: d }; });
        })
        .then(function (x) {
          if (!x.r.ok) {
            direP(x.d.erreur || "Impossible d\'enregistrer ce pseudo.", "erreur");
            return;
          }
          /* Enregistre. On retire la fenetre et on met le nom dans l'en-tete
             sans recharger : le jeton, lui, ne portera le pseudo qu'au
             prochain renouvellement, et attendre une heure pour voir son nom
             s'afficher donnerait l'impression que rien n'a marche. */
          fenetrePseudo.hidden = true;
          if (lienCompte) {
            lienCompte.textContent = valeur;
            lienCompte.href = "/compte.html";
            lienCompte.classList.remove("btn-accent");
          }
        })
        .catch(function () { direP("Service indisponible.", "erreur"); });
    });

    var partir = fenetrePseudo.querySelector("#pseudo-partir");
    partir.addEventListener("click", function () {
      try {
        for (var i = localStorage.length - 1; i >= 0; i--) {
          var cle = localStorage.key(i);
          if (cle && cle.indexOf("sb-") === 0) localStorage.removeItem(cle);
        }
      } catch (err) { /* stockage indisponible : le cookie suffit */ }
      fetch("/api/session", { method: "DELETE" })
        .then(function () { location.href = "/connexion.html"; })
        .catch(function () { location.href = "/connexion.html"; });
    });

    champ.focus();
  }

  /* ---------- acces refuse (page /acces-reserve.html) ----------

     Dire OU l'on voulait aller : sans cela, la page explique un refus sans
     que le lecteur sache ce qui a ete refuse. */

  var ouTuAllais = document.getElementById("ou-tu-allais");
  var versDemande = "";
  if (ouTuAllais) {
    var vers = new URLSearchParams(location.search).get("vers") || "";
    /* Le parametre vient de l'adresse, donc de l'exterieur : on ne le reprend
       que s'il designe un chemin de CE site. Sinon un lien fabrique pourrait
       renvoyer ailleurs quelqu'un qui vient de se reconnecter. */
    if (vers.indexOf("/") === 0 && vers.indexOf("//") !== 0) {
      versDemande = vers;
      ouTuAllais.textContent = "Page demandée : " + vers;
      ouTuAllais.hidden = false;
    }
    /* Le refus vient presque toujours des fiches : proposer la demonstration
       donne quelque chose a faire tout de suite, au lieu d'un mur. On ne la
       propose pas si la page refusee etait ailleurs (l'administration, par
       exemple) : la demo n'y repondrait a rien. */
    var cartesAcces = document.getElementById("acces-cartes");
    if (cartesAcces && (!versDemande || versDemande.indexOf("/fiches") === 0
                        || versDemande.indexOf("/pdf") === 0)) {
      /* Le tunnel : demander vaut mieux que contempler un mur. Les deux
         cartes ne valent que pour les fiches ; refuse sur l'administration,
         elles ne repondraient a rien. */
      cartesAcces.hidden = false;
    }
  }

  /* Rouvrir la session.

     Le nom du bouton dit ce qu'il fait, et pas plus : il REFAIT une session,
     il ne rafraichit pas celle en cours. La nuance n'est pas cosmetique. Le
     cookie ne contient que le jeton d'acces, jamais le jeton de renouvellement
     - c'est un choix : un jeton de renouvellement vit longtemps, et ne pas le
     conserver reduit ce qu'un vol de cookie permettrait. Sans lui, le serveur
     n'a aucun moyen de fabriquer un jeton neuf tout seul.

     On efface donc la session, puis on repasse par la connexion en gardant la
     destination. Avec Google, GitHub ou Discord, qui gardent leur propre
     session, cela ne coute qu'un clic. */
  var boutonRenouveler = document.getElementById("renouveler");
  if (boutonRenouveler) {
    boutonRenouveler.addEventListener("click", function () {
      boutonRenouveler.disabled = true;
      var zone = document.getElementById("etat");
      if (zone) {
        zone.textContent = "Fermeture de la session…";
        zone.className = "etat etat-info";
        zone.hidden = false;
      }
      var suite = versDemande || "/";
      fetch("/api/session", { method: "DELETE", headers: { "Accept": "application/json" } })
        .catch(function () { /* meme sans reponse, la connexion la remplacera */ })
        .then(function () {
          location.href = "/connexion?suite=" + encodeURIComponent(suite);
        });
    });
  }

  /* ---------- espace personnel (page /compte.html) ----------

     Le RGPD demande que les droits soient exercables, pas seulement annonces.
     Cette page les rend disponibles : voir, emporter, effacer. Tout vient de
     /api/compte, donc du serveur apres verification de la session - la page
     elle-meme ne sait rien et ne stocke rien. */

  var tableCompte = document.getElementById("compte-table");
  if (tableCompte) {
    var etatCompte = document.getElementById("etat");
    var mesDonnees = null;

    function direCompte(texte, type) {
      if (!etatCompte) return;
      etatCompte.textContent = texte;
      etatCompte.className = "etat" + (type ? " etat-" + type : "");
      etatCompte.hidden = !texte;
    }

    function quand(iso) {
      if (!iso) return "—";
      var d = new Date(iso);
      return isNaN(d) ? iso : d.toLocaleString("fr-FR");
    }

    var LIBELLE_ROLE = {
      user: "Compte simple",
      reader_user: "Accès étendu",
      super_user: "Administration"
    };

    function remplir(d) {
      mesDonnees = d;
      document.getElementById("compte-pseudo").textContent =
        d.pseudo || "à choisir";
      /* Le role affiche vient de la base, le role actif du jeton. Le sens de
         l'ecart change ce qu'il faut dire : une PROMOTION prend effet tout de
         suite, parce que le middleware consulte la base quand le jeton refuse.
         Un RETRAIT, lui, met jusqu'a une heure, parce qu'un jeton qui accepte
         n'amene jamais a interroger la base. Annoncer « reconnecte-toi » dans
         les deux cas serait faux une fois sur deux. */
      var RANG_R = { user: 0, reader_user: 1, super_user: 2 };
      var texteRole = LIBELLE_ROLE[d.role] || d.role || "—";
      if (d.role_actif && d.role_actif !== d.role
          && RANG_R[d.role_actif] > RANG_R[d.role]) {
        texteRole += " — des acces plus larges restent ouverts "
                   + "jusqu'a ta prochaine connexion";
      }
      document.getElementById("compte-role").textContent = texteRole;
      document.getElementById("compte-fournisseur").textContent =
        d.fournisseur || "adresse et mot de passe";
      var champ = document.getElementById("nouveau-pseudo");
      if (champ && d.pseudo) champ.value = d.pseudo;
      document.getElementById("compte-adresse").textContent = d.adresse || "—";
      document.getElementById("compte-cree").textContent = quand(d.compte_cree_le);
      document.getElementById("compte-vue").textContent = quand(d.derniere_connexion);
      /* Notee par le site, au jour pres, au plus une fois par jour : c'est
         elle qui compte pour la suppression apres douze mois d'absence. */
      document.getElementById("compte-visite").textContent = quand(d.derniere_visite);
      var c = d.consentement || {};
      /* Un tiret ne dit pas si le consentement manque ou s'il n'a jamais ete
         demande. Les comptes crees avant la notice sont dans le second cas :
         autant l'ecrire, c'est aussi une information exigible. */
      document.getElementById("compte-consentement").textContent =
        c.donne_le
          ? quand(c.donne_le) + " (notice du " + (c.version_notice || "?") + ")"
          : "Non enregistre (compte anterieur a la notice)";
      tableCompte.hidden = false;
    }

    fetch("/api/compte", { headers: { "Accept": "application/json" } })
      .then(function (r) { return r.json().then(function (d) { return { r: r, d: d }; }); })
      .then(function (x) {
        if (x.r.ok) { remplir(x.d); return; }
        /* 501 : les comptes ne sont pas actives (porte par mot de passe).
           Le dire clairement vaut mieux qu'une page vide. */
        direCompte(x.d.erreur || "Impossible de lire tes donnees.",
                   x.r.status === 501 ? "info" : "erreur");
      })
      .catch(function () { direCompte("Service indisponible.", "erreur"); });

    /* Changer de pseudo. Le formulaire passe par /api/pseudo, parce que
       le jeton vit dans un cookie HttpOnly que la page ne peut pas lire :
       c'est le serveur qui parle a la base au nom de la personne. */
    var formPseudo = document.getElementById("form-pseudo-compte");
    if (formPseudo) {
      formPseudo.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var valeur = document.getElementById("nouveau-pseudo").value.trim();
        direCompte("Enregistrement…", "info");
        fetch("/api/pseudo", {
          method: "POST",
          headers: { "content-type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ pseudo: valeur })
        })
          .then(function (r) {
            return r.json().then(function (d) { return { r: r, d: d }; });
          })
          .then(function (x) {
            if (!x.r.ok) {
              var m = x.d.erreur || "Échec.";
              if (x.d.cause === "profil_absent") {
                m += " C'est un compte cree avant les tables : lance "
                   + "supabase/rattraper_profils.sql, puis reessaie.";
              }
              direCompte(m, "erreur");
              return;
            }
            document.getElementById("compte-pseudo").textContent = valeur;
            direCompte("Pseudo enregistré. " + (x.d.note || ""), "succes");
          })
          .catch(function () { direCompte("Service indisponible.", "erreur"); });
      });
    }

    /* ---------- mes propositions (lot G) ----------
       Ce que j'ai proposé, l'état, et la note de l'administrateur — c'est
       ici qu'on lit la réponse (pas de courriel : décision 6). */
    var zoneMesProp = document.getElementById("mes-propositions");
    if (zoneMesProp) {
      var ETATS_PROP = { en_attente: "en attente", acceptee: "acceptée, à intégrer", refusee: "refusée", integree: "intégrée" };
      var TYPES_PROP = { correction: "correction", ajout: "ajout", technique: "problème technique", fonctionnalite: "fonctionnalité" };
      fetch("/api/propositions", { headers: { "Accept": "application/json" } })
        .then(function (r) { return r.json().then(function (d) { return { r: r, d: d }; }); })
        .then(function (x) {
          zoneMesProp.textContent = "";
          var note = document.createElement("p"); note.className = "c-note";
          if (!x.r.ok) { note.textContent = x.d.erreur || "Accès refusé."; zoneMesProp.appendChild(note); return; }
          if (x.d.indisponible) { note.textContent = x.d.note || "Pas encore ouvert."; zoneMesProp.appendChild(note); return; }
          if (!(x.d.propositions || []).length) { note.textContent = "Aucune proposition pour l'instant."; zoneMesProp.appendChild(note); return; }
          x.d.propositions.forEach(function (p) {
            var carte = document.createElement("article");
            carte.className = "demande-carte" + (p.etat === "en_attente" ? "" : " demande-traitee");
            carte.setAttribute("data-proposition", p.id);
            var tete = document.createElement("div"); tete.className = "demande-tete";
            /* Ce que j'ai visé, avec mes mots plutôt qu'un identifiant
               (lot L) ; les propositions d'avant n'ont que la cible. */
            tete.textContent = (TYPES_PROP[p.type] || p.type) + " · " + (p.cible_titre || p.cible)
              + " · " + quand(p.cree_le) + " · " + (ETATS_PROP[p.etat] || p.etat);
            tete.title = p.cible;
            carte.appendChild(tete);
            var t = document.createElement("blockquote"); t.className = "demande-motif"; t.textContent = p.texte; carte.appendChild(t);
            if (p.note) { var n = document.createElement("p"); n.className = "c-note"; n.textContent = "Réponse : " + p.note; carte.appendChild(n); }
            zoneMesProp.appendChild(carte);
          });
        })
        .catch(function () { zoneMesProp.textContent = "Service indisponible."; });
    }

    /* L'etat de sa demande d'acces, ici aussi (lot M) : « Mon compte » est
       l'endroit ou l'on vient voir ou l'on en est, et c'est deja la que
       vivent « Mes propositions ». */
    var celluleDemande = document.getElementById("compte-demande");
    if (celluleDemande) {
      var ETATS_DEM = { en_attente: "en attente", acceptee: "acceptée", refusee: "refusée" };
      fetch("/api/demande", { headers: { "Accept": "application/json" } })
        .then(function (r) { return r.json().then(function (d) { return { r: r, d: d }; }); })
        .then(function (x) {
          celluleDemande.textContent = "";
          if (!x.r.ok || x.d.indisponible) { celluleDemande.textContent = "—"; return; }
          if (x.d.role === "reader_user" || x.d.role === "super_user") {
            celluleDemande.textContent = "sans objet : l\u2019accès aux fiches est ouvert";
            return;
          }
          var derniere = (x.d.demandes || [])[0];
          if (!derniere) {
            celluleDemande.appendChild(document.createTextNode("aucune — "));
            var a = document.createElement("a"); a.href = "/demande-acces.html"; a.textContent = "demander l\u2019accès aux fiches";
            celluleDemande.appendChild(a);
            return;
          }
          var retire = accesRetire(x.d.role, derniere);
          celluleDemande.appendChild(document.createTextNode(
            (retire ? "acceptée, puis accès retiré" : (ETATS_DEM[derniere.statut] || derniere.statut))
            + " — envoyée le " + new Date(derniere.cree_le).toLocaleDateString("fr-FR") + " · "));
          var lien = document.createElement("a"); lien.href = "/demande-acces.html";
          lien.textContent = retire ? "redemander l’accès" : "voir le détail";
          celluleDemande.appendChild(lien);
        })
        .catch(function () { celluleDemande.textContent = "—"; });
    }

    var boutonExporter = document.getElementById("exporter");
    if (boutonExporter) {
      boutonExporter.addEventListener("click", function () {
        if (!mesDonnees) { direCompte("Rien a exporter pour l'instant.", "info"); return; }
        var blob = new Blob([JSON.stringify(mesDonnees, null, 2)],
                            { type: "application/json" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "mes-donnees-fiches-but.json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      });
    }

  /* ---------- services relies (page /compte.html) ----------

     Tout passe par /api/identites : le jeton vit dans un cookie HttpOnly, que
     la page ne peut pas lire. Relier demande une redirection vers le
     fournisseur, et l'adresse ou aller ne s'obtient qu'avec le jeton — c'est
     le serveur qui la demande et nous la rend. */

  var boiteIdentites = document.getElementById("identites");
  var etatIdentites = document.getElementById("etat-identites");

  function direIdentites(t, type) {
    if (!etatIdentites) return;
    etatIdentites.textContent = t;
    etatIdentites.className = "etat" + (type ? " etat-" + type : "");
    etatIdentites.hidden = !t;
  }

  function dateCourte(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString("fr-FR",
      { day: "numeric", month: "long", year: "numeric" });
  }

  function rendreIdentites(d) {
    var lignes = d.reliees.map(function (i) {
      var depuis = dateCourte(i.depuis);
      /* Le bouton de detachement disparait quand il ne reste qu'un service :
         proposer un geste qui sera refuse est une fausse promesse. On dit
         pourquoi a la place. */
      var action = d.detachable
        ? '<button class="btn btn-petit" type="button" data-detacher="'
          + i.id + '">Détacher</button>'
        : '<span class="c-note">seul moyen de connexion</span>';
      return '<li class="id-ligne id-reliee">'
           + '<span class="id-nom">' + i.nom + "</span>"
           + '<span class="id-etat">relié'
           + (depuis ? " depuis le " + depuis : "") + "</span>"
           + action + "</li>";
    });

    var libres = d.proposables.map(function (i) {
      return '<li class="id-ligne">'
           + '<span class="id-nom">' + i.nom + "</span>"
           + '<span class="id-etat c-note">non relié</span>'
           + '<button class="btn btn-petit" type="button" data-relier="'
           + i.fournisseur + '">Relier</button></li>';
    });

    boiteIdentites.innerHTML = '<ul class="id-liste">'
                             + lignes.join("") + libres.join("") + "</ul>";
  }

  function chargerIdentites() {
    if (!boiteIdentites) return;
    fetch("/api/identites", { headers: { "Accept": "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.erreur) {
          boiteIdentites.innerHTML = '<p class="c-note">' + d.erreur + "</p>";
          return;
        }
        rendreIdentites(d);
      })
      .catch(function () {
        boiteIdentites.innerHTML = '<p class="c-note">Liste indisponible.</p>';
      });
  }

  if (boiteIdentites) {
    chargerIdentites();

    /* La liste est reecrite a chaque fois : on ecoute le conteneur, jamais
       les boutons, qui ne sont jamais deux fois les memes elements. */
    boiteIdentites.addEventListener("click", function (ev) {
      var relier = ev.target.closest("[data-relier]");
      var detacher = ev.target.closest("[data-detacher]");

      if (relier) {
        direIdentites("Ouverture du service…", "info");
        fetch("/api/identites", {
          method: "POST",
          headers: { "content-type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ fournisseur: relier.getAttribute("data-relier") })
        })
          .then(function (r) { return r.json().then(function (d) { return { r: r, d: d }; }); })
          .then(function (x) {
            if (!x.r.ok || !x.d.url) {
              direIdentites((x.d.erreur || "Impossible de relier ce service.")
                            + (x.d.piste ? " " + x.d.piste : ""), "erreur");
              return;
            }
            location.href = x.d.url;
          })
          .catch(function () { direIdentites("Service indisponible.", "erreur"); });
        return;
      }

      if (detacher) {
        var nom = detacher.closest(".id-ligne").querySelector(".id-nom").textContent;
        if (!window.confirm("Détacher " + nom + " de ce compte ? Tu ne pourras "
                            + "plus t'en servir pour te connecter.")) return;
        direIdentites("Détachement…", "info");
        fetch("/api/identites", {
          method: "DELETE",
          headers: { "content-type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ identite: detacher.getAttribute("data-detacher") })
        })
          .then(function (r) { return r.json().then(function (d) { return { r: r, d: d }; }); })
          .then(function (x) {
            if (!x.r.ok) {
              direIdentites(x.d.erreur || "Le détachement a échoué.", "erreur");
              return;
            }
            direIdentites((x.d.detache || "Service") + " détaché.", "succes");
            chargerIdentites();
          })
          .catch(function () { direIdentites("Service indisponible.", "erreur"); });
      }
    });
  }

    var boutonSupprimer = document.getElementById("supprimer");
    if (boutonSupprimer) {
      boutonSupprimer.addEventListener("click", function () {
        /* Une suppression definitive se confirme. Pas de fioriture : la
           question dit exactement ce qui va se passer. */
        if (!window.confirm("Supprimer definitivement ton compte et ton "
                            + "adresse ? Cette action est irreversible.")) return;

        boutonSupprimer.disabled = true;
        direCompte("Suppression en cours…", "info");

        fetch("/api/compte", {
          method: "DELETE",
          headers: { "Accept": "application/json" },
        })
          .then(function (r) { return r.json().then(function (d) { return { r: r, d: d }; }); })
          .then(function (x) {
            if (x.r.ok) {
              direCompte("Compte supprime. Au revoir.", "succes");
              setTimeout(function () { location.href = "/connexion"; }, 1500);
              return;
            }
            boutonSupprimer.disabled = false;
            direCompte((x.d.erreur || "La suppression a echoue.")
                       + (x.d.marche_a_suivre ? " " + x.d.marche_a_suivre : ""),
                       "erreur");
          })
          .catch(function () {
            boutonSupprimer.disabled = false;
            direCompte("Service indisponible.", "erreur");
          });
      });
    }
  }
  /* ---------- administration (page /admin.html) ----------

     Frere de l'espace personnel, et non enfant : les deux pages n'ont aucun
     element en commun, et un bloc garde par la presence d'une table de
     l'autre page ne s'executerait jamais. */

  function direAdmin(texte, type) {
    var z = document.getElementById("etat");
    if (!z) return;
    z.textContent = texte;
    z.className = "etat" + (type ? " etat-" + type : "");
    z.hidden = !texte;
  }

  function quandAdmin(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString("fr-FR");
  }


  /* ------------------------------------------------------------------
     La demande d'acces (page /demande-acces.html)
     ------------------------------------------------------------------
     Quatre etats, un seul endroit pour les peindre. Le formulaire n'est
     montre que si demander a un sens : pas de demande en attente, pas
     deja l'acces. Un refus montre le motif, et laisse redemander.
  ------------------------------------------------------------------ */
  var formDemande = document.getElementById("form-demande");
  if (formDemande) {
    var etatDemande = document.getElementById("demande-etat");
    var titreDemande = document.getElementById("demande-etat-titre");
    var texteDemande = document.getElementById("demande-etat-texte");
    var suiteDemande = document.getElementById("demande-etat-suite");
    var motifDemande = document.getElementById("demande-motif");
    var zoneActions = document.getElementById("demande-etat-actions");

    function direDemande(texte, type) {
      var z = document.getElementById("etat");
      if (!z) return;
      z.textContent = texte;
      z.className = "etat" + (type ? " etat-" + type : "");
      z.hidden = !texte;
    }

    function quandDemande(iso) {
      if (!iso) return "";
      var d = new Date(iso);
      return isNaN(d) ? iso : d.toLocaleDateString("fr-FR");
    }

    /* `actions` : [[libelle, adresse, accent]] — une demande acceptee doit
       MENER quelque part (lot M). Sans cela, la page annonce une bonne
       nouvelle et laisse la personne la chercher. */
    function peindreEtat(titre, texte, motif, suite, montrerFormulaire, actions) {
      titreDemande.textContent = titre;
      texteDemande.textContent = texte;
      motifDemande.textContent = motif || "";
      motifDemande.hidden = !motif;
      suiteDemande.textContent = suite || "";
      zoneActions.textContent = "";
      (actions || []).forEach(function (a) {
        var lien = document.createElement("a");
        lien.className = "btn" + (a[2] ? " btn-accent" : "");
        lien.href = a[1]; lien.textContent = a[0];
        zoneActions.appendChild(lien);
        zoneActions.appendChild(document.createTextNode(" "));
      });
      zoneActions.hidden = !(actions || []).length;
      etatDemande.hidden = false;
      etatDemande.setAttribute("data-etat", titre ? "1" : "");
      formDemande.hidden = !montrerFormulaire;
    }

    function situer(d) {
      if (d.indisponible) {
        peindreEtat("Pas encore ouvert", d.note || "Les demandes ne sont pas encore ouvertes.",
                    "", "", false);
        return;
      }
      if (d.role === "reader_user" || d.role === "super_user") {
        peindreEtat("C\u2019est ouvert : tu as accès aux fiches",
                    "Rien à demander. Les fiches, leurs PDF, la recherche dans le texte et le "
                    + "catalogue te sont ouverts.",
                    "", "", false,
                    [["Lire les fiches", "/fiches/", true], ["Mon compte", "/compte.html", false]]);
        return;
      }
      if (!d.pseudo) {
        peindreEtat("Il te faut d'abord un pseudo",
                    "C'est lui qui sera lu par la personne qui décide. La fenêtre du site "
                    + "te le demande ; reviens ici ensuite.", "", "", false);
        return;
      }
      var derniere = (d.demandes || [])[0];
      if (derniere && derniere.statut === "en_attente") {
        peindreEtat("Ta demande est en attente",
                    "Envoyée le " + quandDemande(derniere.cree_le) + ". Elle sera lue par "
                    + "une personne, en général sous une semaine. Rien d'autre à faire : "
                    + "la réponse s'affichera ici, et « Mon compte » la rappelle aussi.",
                    derniere.justification, "", false,
                    [["Voir la démonstration", "/demo.html", false], ["Mon compte", "/compte.html", false]]);
        return;
      }
      if (derniere && derniere.statut === "refusee") {
        peindreEtat("Ta demande du " + quandDemande(derniere.cree_le) + " n'a pas été acceptée",
                    "Voici le motif, tel qu'il a été écrit :",
                    derniere.motif || "(aucun motif enregistré)",
                    "Tu peux redemander ci-dessous, en tenant compte de ce motif.", true,
                    [["Voir la démonstration", "/demo.html", false]]);
        return;
      }
      if (accesRetire(d.role, derniere)) {
        /* Acceptee il y a longtemps, et la base dit « user » : ce n'est plus
           un retard de jeton, l'acces a ete retire depuis (voir
           accesRetire). « Reconnecte-toi » n'y changerait rien : on le dit,
           et on laisse redemander — la base l'accepte (deposer_demande ne
           regarde que le role et une demande en attente). */
        peindreEtat("Ton accès aux fiches a été retiré",
                    "Ta demande du " + quandDemande(derniere.cree_le) + " avait été acceptée"
                    + (derniere.traite_le ? " le " + quandDemande(derniere.traite_le) : "")
                    + ", mais l'accès t'a été retiré depuis.",
                    "", "Si tu en as encore besoin, tu peux le redemander ci-dessous.", true,
                    [["Voir la démonstration", "/demo.html", false]]);
        return;
      }
      if (derniere && derniere.statut === "acceptee") {
        /* Acceptee il y a peu (moins de DELAI_ROLE_MS) mais le role n'a pas
           suivi : la base n'a pas repondu et le jeton date d'avant. On le
           dit, plutot que de proposer de redemander — et on MENE aux
           fiches : c'est ce qu'on vient chercher. */
        peindreEtat("Ta demande a été acceptée",
                    "L'accès prend effet à ta prochaine connexion, ou au plus tard dans une "
                    + "heure. Si les fiches refusent encore, déconnecte-toi et reconnecte-toi : "
                    + "c'est immédiat.",
                    derniere.motif || "", "", false,
                    [["Lire les fiches", "/fiches/", true], ["Mon compte", "/compte.html", false]]);
        return;
      }
      etatDemande.hidden = true;
      formDemande.hidden = false;
    }

    function chargerDemande() {
      fetch("/api/demande", { headers: { "Accept": "application/json" } })
        .then(function (r) {
          return r.json().then(function (d) { return { r: r, d: d }; });
        })
        .then(function (x) {
          if (!x.r.ok) { direDemande(x.d.erreur || "Accès refusé.", "erreur"); return; }
          situer(x.d);
        })
        .catch(function () { direDemande("Service indisponible.", "erreur"); });
    }

    formDemande.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var texte = document.getElementById("justification").value.trim();
      if (texte.length < 30) {
        direDemande("Écris au moins quelques lignes : c'est ce texte qui est lu.", "erreur");
        return;
      }
      var bouton = document.getElementById("envoyer-demande");
      bouton.disabled = true;
      direDemande("Envoi…", "info");
      fetch("/api/demande", {
        method: "POST",
        headers: { "content-type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ justification: texte })
      })
        .then(function (r) {
          return r.json().then(function (d) { return { r: r, d: d }; });
        })
        .then(function (x) {
          bouton.disabled = false;
          if (!x.r.ok) { direDemande(x.d.erreur || "La demande n'a pas pu être envoyée.", "erreur"); return; }
          direDemande("Demande envoyée. Elle sera lue par une personne.", "succes");
          document.getElementById("justification").value = "";
          /* On repeint l'etat, puis on y AMENE : sur cette page longue, une
             ligne verte en haut passe inapercue quand on est au milieu du
             formulaire (lot M). */
          chargerDemande();
          setTimeout(function () {
            if (etatDemande.scrollIntoView) etatDemande.scrollIntoView({ block: "center", behavior: "smooth" });
          }, 400);
        })
        .catch(function () { bouton.disabled = false; direDemande("Service indisponible.", "erreur"); });
    });

    chargerDemande();
  }


  /* ------------------------------------------------------------------
     L'emploi du temps (page /emploi/)
     ------------------------------------------------------------------
     Le REGISTRE des types d'evenement, d'abord. C'est lui qui rend la
     grille extensible : un type = un libelle, une couleur, des champs
     propres (ranges dans « details »), et une classe qui sait ce que ce
     type fait de particulier. Ajouter un type, c'est ajouter une entree.
     La base et les routes n'en savent rien : elles ne verifient que la
     forme du mot.
  ------------------------------------------------------------------ */
  var grilleEdt = document.getElementById("edt-grille");
  if (grilleEdt) {

    /* La classe de base : ce que tout evenement sait faire. */
    function Evenement(ligne) { this.l = ligne; }
    Evenement.prototype.debut = function () { return new Date(this.l.debut); };
    Evenement.prototype.fin = function () { return this.l.fin ? new Date(this.l.fin) : null; };
    Evenement.prototype.dureeMin = function () {
      var f = this.fin();
      return f ? Math.max(15, Math.round((f - this.debut()) / 60000)) : 60;
    };
    Evenement.prototype.def = function () { return TYPES_EVENEMENT[this.l.type] || TYPES_EVENEMENT.perso; };
    Evenement.prototype.couleur = function () { return this.def().couleur; };
    Evenement.prototype.libelle = function () { return this.l.titre; };
    Evenement.prototype.sousTitre = function () {
      var d = this.l.details || {};
      return d.lieu || d.module || d.groupe || "";
    };
    Evenement.prototype.estFaite = function () { return false; };
    Evenement.prototype.importe = function () { return this.l.source === "ics"; };

    /* Une tache : une echeance, un etat, et une case a cocher. */
    function Tache(ligne) { Evenement.call(this, ligne); }
    Tache.prototype = Object.create(Evenement.prototype);
    Tache.prototype.constructor = Tache;
    Tache.prototype.estFaite = function () { return this.l.fait === true; };
    Tache.prototype.dureeMin = function () { return 30; };
    Tache.prototype.libelle = function () { return (this.estFaite() ? "✓ " : "") + this.l.titre; };

    var TYPES_EVENEMENT = {
      cours:  { libelle: "Cours",   couleur: "#0f4d3f", classe: Evenement,
                champs: [{ cle: "lieu", libelle: "Salle" }, { cle: "module", libelle: "Module (ex. R104)" }] },
      seance: { libelle: "Séance de révision", couleur: "#6e4a0c", classe: Evenement,
                champs: [{ cle: "lieu", libelle: "Lieu" }, { cle: "groupe", libelle: "Avec qui" },
                         { cle: "fiche", libelle: "Fiches à travailler", multi: true }] },
      tache:  { libelle: "Tâche",   couleur: "#3d1152", classe: Tache,
                champs: [{ cle: "fiche", libelle: "Fiche liée" }] },
      examen: { libelle: "Évaluation", couleur: "#a63a2b", classe: Evenement,
                champs: [{ cle: "module", libelle: "Module" }, { cle: "lieu", libelle: "Salle" }] },
      perso:  { libelle: "Personnel", couleur: "#0e3c5c", classe: Evenement, champs: [] }
    };

    function fabriquer(ligne) {
      var def = TYPES_EVENEMENT[ligne.type] || TYPES_EVENEMENT.perso;
      return new def.classe(ligne);
    }

    /* ---------- outils de date (heure locale du navigateur) ---------- */
    function lundiDe(d) {
      var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      var j = (x.getDay() + 6) % 7;               /* lundi = 0 */
      x.setDate(x.getDate() - j);
      return x;
    }
    function plusJours(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
    function cleJour(d) {
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }
    function hhmm(d) { return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
    var JOURS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
    var H_DEBUT = 6, H_FIN = 22;                  /* la grille va de 6 h a 22 h */
    /* 1.f : sur telephone, un seul jour a la fois, et on glisse pour changer
       de jour. jourVisible = 0 (lundi) a 6 ; null = la semaine entiere. */
    var vueJour = window.matchMedia && window.matchMedia("(max-width: 700px)").matches;
    var jourVisible = vueJour ? (new Date().getDay() + 6) % 7 : null;

    function direEdt(texte, type) {
      var z = document.getElementById("etat");
      if (!z) return;
      z.textContent = texte;
      z.className = "etat" + (type ? " etat-" + type : "");
      z.hidden = !texte;
    }

    function appel(methode, chemin, corps, brut) {
      var options = { method: methode, headers: { "Accept": "application/json" } };
      if (corps !== undefined) {
        options.headers["content-type"] = brut ? "text/calendar" : "application/json";
        options.body = brut ? corps : JSON.stringify(corps);
      }
      return fetch(chemin, options).then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, statut: r.status, d: d }; });
      });
    }

    /* ---------- etat ---------- */
    var lundi = lundiDe(new Date());
    var evenements = [];                          /* les objets de la semaine */
    var enRetard = [];
    var enEdition = null;                         /* la ligne ouverte dans le dialogue */

    /* ---------- la grille ---------- */
    function peindreSemaine() {
      var dimanche = plusJours(lundi, 6);
      var titre = document.getElementById("edt-titre");
      if (vueJour) {
        var j = plusJours(lundi, jourVisible);
        titre.textContent = j.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
      } else {
        titre.textContent = lundi.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
          + " → " + dimanche.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
      }
      document.getElementById("edt-aller").value = cleJour(vueJour ? plusJours(lundi, jourVisible) : lundi);
      grilleEdt.classList.toggle("edt-vue-jour", vueJour);

      grilleEdt.textContent = "";
      var auj = cleJour(new Date());

      /* colonne des heures */
      var colH = document.createElement("div");
      colH.className = "edt-heures";
      colH.appendChild(document.createElement("div")).className = "edt-entete";
      colH.appendChild(document.createElement("div")).className = "edt-journee";
      var corpsH = document.createElement("div");
      corpsH.className = "edt-corps";
      for (var h = H_DEBUT; h < H_FIN; h++) {
        var t = document.createElement("div");
        t.className = "edt-h";
        t.textContent = h + " h";
        corpsH.appendChild(t);
      }
      colH.appendChild(corpsH);
      grilleEdt.appendChild(colH);

      for (var j = 0; j < 7; j++) {
        var jour = plusJours(lundi, j);
        var cle = cleJour(jour);
        var col = document.createElement("div");
        col.className = "edt-jour" + (cle === auj ? " edt-aujourdhui" : "") + (vueJour && j !== jourVisible ? " edt-jour-cache" : "");
        var tete = document.createElement("div");
        tete.className = "edt-entete";
        tete.textContent = JOURS[j] + " " + jour.getDate();
        col.appendChild(tete);
        var zoneJournee = document.createElement("div");
        zoneJournee.className = "edt-journee";
        col.appendChild(zoneJournee);
        var corps = document.createElement("div");
        corps.className = "edt-corps";
        corps.setAttribute("data-jour", cle);
        for (var k = H_DEBUT; k < H_FIN; k++) corps.appendChild(document.createElement("div")).className = "edt-h";
        col.appendChild(corps);

        evenements.forEach(function (ev) {
          if (cleJour(ev.debut()) !== cle) return;
          var bloc = document.createElement("button");
          bloc.type = "button";
          bloc.className = "edt-ev" + (ev.estFaite() ? " edt-fait" : "") + (ev.importe() ? " edt-importe" : "");
          bloc.style.background = ev.couleur();
          bloc.textContent = ev.libelle();
          var st = ev.sousTitre();
          if (st) {
            var s = document.createElement("small");
            s.textContent = st;
            bloc.appendChild(document.createElement("br"));
            bloc.appendChild(s);
          }
          bloc.title = ev.l.titre + (st ? " — " + st : "");
          bloc.addEventListener("click", function () { ouvrirDialogue(ev.l); });
          if (ev.l.journee) { zoneJournee.appendChild(bloc); return; }
          var d = ev.debut();
          var minutes = (d.getHours() - H_DEBUT) * 60 + d.getMinutes();
          var total = (H_FIN - H_DEBUT) * 60;
          if (minutes < 0 || minutes >= total) { zoneJournee.appendChild(bloc); return; }
          bloc.style.top = (minutes / total * 100) + "%";
          bloc.style.height = (Math.min(ev.dureeMin(), total - minutes) / total * 100) + "%";
          bloc.classList.add("edt-place");
          corps.appendChild(bloc);
        });

        /* cliquer dans le vide cree un evenement a cette heure-la */
        corps.addEventListener("click", function (e) {
          if (e.target !== this) return;
          var rect = this.getBoundingClientRect();
          var frac = (e.clientY - rect.top) / rect.height;
          var mins = Math.floor(frac * (H_FIN - H_DEBUT) * 60 / 30) * 30;
          var quand = new Date(this.getAttribute("data-jour") + "T00:00:00");
          quand.setMinutes(H_DEBUT * 60 + mins);
          ouvrirDialogue(null, quand);
        });
        grilleEdt.appendChild(col);
      }
    }

    function peindreTaches() {
      var ul = document.getElementById("edt-taches");
      var note = document.getElementById("edt-taches-note");
      ul.textContent = "";
      var liste = enRetard.map(fabriquer).concat(evenements.filter(function (e) { return e instanceof Tache; }));
      if (!liste.length) { note.textContent = "Rien à faire cette semaine. Ajoute une tâche avec le bouton + Ajouter."; return; }
      note.textContent = enRetard.length ? enRetard.length + " en retard." : "";
      liste.forEach(function (t) {
        var li = document.createElement("li");
        var case_ = document.createElement("input");
        case_.type = "checkbox";
        case_.checked = t.estFaite();
        case_.addEventListener("change", function () {
          appel("PATCH", "/api/emploi/" + t.l.id, { fait: case_.checked }).then(function (x) {
            if (!x.ok) { direEdt(x.d.erreur || "Échec.", "erreur"); case_.checked = !case_.checked; return; }
            charger();
          });
        });
        li.appendChild(case_);
        var lab = document.createElement("span");
        lab.textContent = " " + t.l.titre + " — " + t.debut().toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
        if (t.debut() < new Date() && !t.estFaite()) lab.className = "edt-retard";
        li.appendChild(lab);
        var ed = document.createElement("button");
        ed.type = "button"; ed.className = "lien-bouton"; ed.textContent = "modifier";
        ed.addEventListener("click", function () { ouvrirDialogue(t.l); });
        li.appendChild(ed);
        ul.appendChild(li);
      });
    }

    function charger() {
      var du = lundi.toISOString();
      var au = plusJours(lundi, 7).toISOString();
      appel("GET", "/api/emploi?du=" + encodeURIComponent(du) + "&au=" + encodeURIComponent(au)).then(function (x) {
        if (!x.ok) {
          direEdt(x.d.erreur || "Accès refusé.", x.d.indisponible ? "info" : "erreur");
          evenements = []; enRetard = [];
        } else {
          evenements = (x.d.evenements || []).map(fabriquer);
          enRetard = x.d.en_retard || [];
        }
        peindreSemaine();
        peindreTaches();
      }).catch(function () { direEdt("Service indisponible.", "erreur"); });
    }

    function allerA(date) {
      var nouveauLundi = lundiDe(date);
      var memeSemaine = nouveauLundi.getTime() === lundi.getTime();
      lundi = nouveauLundi;
      jourVisible = vueJour ? (date.getDay() + 6) % 7 : null;
      if (memeSemaine) peindreSemaine(); else charger();
    }
    function decaler(n) {
      if (vueJour) allerA(plusJours(plusJours(lundi, jourVisible), n));
      else { lundi = plusJours(lundi, 7 * n); charger(); }
    }
    document.getElementById("edt-prec").addEventListener("click", function () { decaler(-1); });
    document.getElementById("edt-suiv").addEventListener("click", function () { decaler(1); });
    document.getElementById("edt-auj").addEventListener("click", function () { allerA(new Date()); });
    document.getElementById("edt-aller").addEventListener("change", function () {
      if (this.value) allerA(new Date(this.value + "T12:00:00"));
    });
    document.getElementById("edt-ouvrir-import").addEventListener("click", function () {
      var d = document.getElementById("edt-sources");
      d.open = true;
      d.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    /* Le geste : glisser vers la gauche = jour suivant, vers la droite =
       precedent. Un vrai glisse (60 px), pas un tremblement de doigt. */
    var toucheX = null;
    grilleEdt.addEventListener("touchstart", function (e) { toucheX = e.touches[0].clientX; }, { passive: true });
    grilleEdt.addEventListener("touchend", function (e) {
      if (toucheX === null || !vueJour) return;
      var dx = e.changedTouches[0].clientX - toucheX;
      toucheX = null;
      if (Math.abs(dx) > 60) decaler(dx < 0 ? 1 : -1);
    }, { passive: true });
    if (window.matchMedia) {
      window.matchMedia("(max-width: 700px)").addEventListener("change", function (m) {
        vueJour = m.matches;
        jourVisible = vueJour ? Math.max(0, Math.min(6, (new Date().getDay() + 6) % 7)) : null;
        peindreSemaine();
      });
    }

    /* ---------- le dialogue ---------- */
    var dialogue = document.getElementById("edt-dialogue");
    var selType = document.getElementById("edt-type");
    Object.keys(TYPES_EVENEMENT).forEach(function (k) {
      var o = document.createElement("option");
      o.value = k; o.textContent = TYPES_EVENEMENT[k].libelle;
      selType.appendChild(o);
    });

    function peindreChampsType(type, details) {
      var zone = document.getElementById("edt-champs-type");
      zone.textContent = "";
      (TYPES_EVENEMENT[type] || TYPES_EVENEMENT.perso).champs.forEach(function (c) {
        var lab = document.createElement("label");
        lab.textContent = c.libelle;
        lab.setAttribute("for", "edt-d-" + c.cle);
        var inp = document.createElement("input");
        inp.type = "text"; inp.id = "edt-d-" + c.cle; inp.maxLength = 200;
        inp.setAttribute("data-cle", c.cle);
        if (c.cle === "groupe") inp.setAttribute("list", "edt-liste-camarades");
        inp.value = (details && details[c.cle]) || "";
        zone.appendChild(lab); zone.appendChild(inp);
        /* la fiche se choisit dans une fenetre, pas en tapant son code ;
           une seance en cite plusieurs (virgules dans le champ) */
        if (c.cle === "fiche") { inp.maxLength = 900; if (c.multi) brancherSelecteurFiches(inp); else brancherSelecteurFiche(inp); }
      });
    }
    function peindreType() {
      var def = TYPES_EVENEMENT[selType.value] || TYPES_EVENEMENT.perso;
      document.getElementById("edt-pastille-type").style.background = def.couleur;
      dialogue.style.setProperty("--couleur-type", def.couleur);
      document.getElementById("edt-bloc-groupe").hidden = selType.value !== "seance";
    }
    selType.addEventListener("change", function () {
      peindreChampsType(selType.value, enEdition ? enEdition.details : null);
      peindreType();
    });

    /* 1.e : mes groupes, pour rattacher une seance. Charges une fois ; la
       liste vide laisse « sans groupe ». Un « user » y a acces aussi. */
    var selGroupe = document.getElementById("edt-groupe");
    /* Et mes camarades — les membres de mes groupes — pour completer
       « Avec qui » sans le figer : on peut toujours ecrire un nom qui
       n'est pas sur le site. Meme reponse, pas une requete de plus. */
    var listeCamarades = document.createElement("datalist");
    listeCamarades.id = "edt-liste-camarades";
    document.body.appendChild(listeCamarades);
    appel("GET", "/api/groupes").then(function (x) {
      if (!x.ok || !x.d.groupes) return;
      x.d.groupes.forEach(function (g) {
        var o = document.createElement("option"); o.value = g.id; o.textContent = g.nom;
        selGroupe.appendChild(o);
      });
      (x.d.camarades || []).forEach(function (p) {
        var o = document.createElement("option"); o.value = p;
        listeCamarades.appendChild(o);
      });
    }).catch(function () {});


    function ouvrirDialogue(ligne, quand) {
      enEdition = ligne;
      document.getElementById("edt-dialogue-titre").textContent = ligne ? "Modifier" : "Nouvel événement";
      var d = ligne ? new Date(ligne.debut) : (quand || new Date());
      selType.value = ligne ? (TYPES_EVENEMENT[ligne.type] ? ligne.type : "perso") : "perso";
      document.getElementById("edt-titre-champ").value = ligne ? ligne.titre : "";
      document.getElementById("edt-date").value = cleJour(d);
      document.getElementById("edt-heure").value = (ligne && ligne.journee) ? "" : hhmm(d);
      var f = ligne && ligne.fin ? new Date(ligne.fin) : (ligne ? null : new Date(d.getTime() + 3600000));
      document.getElementById("edt-heure-fin").value = (f && !(ligne && ligne.journee)) ? hhmm(f) : "";
      document.getElementById("edt-journee").checked = !!(ligne && ligne.journee);
      peindreChampsType(selType.value, ligne ? ligne.details : null);
      peindreType();
      poserRappels(document.getElementById("edt-rappels"), ligne ? ligne.rappels : []);
      selGroupe.value = "";
      selGroupe.disabled = !!ligne;            /* on ne deplace pas un evenement existant vers un groupe */
      var origine = document.getElementById("edt-origine");
      var duGroupe = !!(ligne && ligne.source === "groupe");
      if (duGroupe) {
        /* Une seance de groupe se lit ici et se modifie la-bas : la grille
           n'en est pas proprietaire. Le dialogue devient une fiche de
           lecture, avec le chemin vers le groupe. */
        origine.textContent = "";
        var lien = document.createElement("a");
        lien.href = "../groupes/groupe.html?id=" + encodeURIComponent(ligne.groupe_id || "");
        lien.textContent = "Séance du groupe « " + ((ligne.details || {}).groupe || "?") + " »";
        origine.appendChild(lien);
        origine.appendChild(document.createTextNode(" — elle se modifie dans le groupe."
          + ((ligne.details || {}).propose_par ? " Proposée par " + ligne.details.propose_par + "." : "")));
        origine.hidden = false;
      } else if (ligne && ligne.source === "ics") {
        origine.textContent = "Importé d'un calendrier : une resynchronisation écrasera tes modifications.";
        origine.hidden = false;
      } else if (ligne && ligne.source === "invitation") {
        origine.textContent = "Proposé par " + ((ligne.details || {}).propose_par || "un contact") + ", accepté : cet événement est à toi, le modifier ne change rien chez l'autre.";
        origine.hidden = false;
      } else { origine.hidden = true; }
      document.getElementById("edt-enregistrer").hidden = duGroupe;
      document.getElementById("edt-supprimer").hidden = !ligne || duGroupe;
      /* proposer a des contacts : pour ce qui est a moi (pas une seance de
         groupe) ; la liste des destinataires repart vide a chaque ouverture */
      document.getElementById("edt-contacts").value = "";
      peindreContactsChoisis();
      document.getElementById("edt-bloc-contacts").hidden = duGroupe;
      /* une seance de groupe porte ses rappels dans le groupe */
      document.getElementById("edt-rappels").hidden = duGroupe;
      ["edt-type", "edt-titre-champ", "edt-date", "edt-heure", "edt-heure-fin", "edt-journee"].forEach(function (k) {
        document.getElementById(k).disabled = duGroupe;
      });
      document.querySelectorAll("#edt-champs-type input").forEach(function (i) { i.disabled = duGroupe; });
      if (typeof dialogue.showModal === "function") dialogue.showModal(); else dialogue.setAttribute("open", "");
    }
    function fermerDialogue() { if (dialogue.open) dialogue.close(); enEdition = null; }

    document.getElementById("edt-ajouter").addEventListener("click", function () { ouvrirDialogue(null); });
    document.getElementById("edt-annuler").addEventListener("click", fermerDialogue);

    document.getElementById("edt-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var date = document.getElementById("edt-date").value;
      var journee = document.getElementById("edt-journee").checked;
      var h1 = document.getElementById("edt-heure").value;
      var h2 = document.getElementById("edt-heure-fin").value;
      if (!date) { direEdt("Il faut une date.", "erreur"); return; }
      var debut = new Date(date + "T" + (journee || !h1 ? "00:00" : h1) + ":00");
      var fin = (!journee && h2) ? new Date(date + "T" + h2 + ":00") : null;
      if (fin && fin < debut) { direEdt("La fin est avant le début.", "erreur"); return; }
      var details = {};
      document.querySelectorAll("#edt-champs-type input[data-cle]").forEach(function (i) {
        if (i.value.trim()) details[i.getAttribute("data-cle")] = i.value.trim();
      });
      var corps = {
        type: selType.value,
        titre: document.getElementById("edt-titre-champ").value.trim(),
        debut: debut.toISOString(),
        fin: fin ? fin.toISOString() : null,
        journee: journee,
        details: details,
        rappels: lireRappels(document.getElementById("edt-rappels"))
      };
      var destinataires = document.getElementById("edt-contacts").value.split(",").filter(Boolean);
      var promesse, dansGroupe = !enEdition && selType.value === "seance" && selGroupe.value;
      if (dansGroupe) {
        /* La reciprocite : une seance rattachee a un groupe se cree dans le
           groupe, et la grille de chaque membre la lit (mes_seances). */
        promesse = appel("POST", "/api/groupes/" + selGroupe.value + "/seances", {
          titre: corps.titre, debut: corps.debut, fin: corps.fin,
          lieu: details.lieu || "", fiches: (details.fiche || "").split(",").map(function (v) { return v.trim(); }).filter(Boolean),
          note: details.groupe ? "Avec : " + details.groupe : "",
          rappels: corps.rappels
        });
      } else {
        promesse = enEdition
          ? appel("PATCH", "/api/emploi/" + enEdition.id, corps)
          : appel("POST", "/api/emploi", corps);
      }
      promesse.then(function (x) {
        if (!x.ok) { direEdt(x.d.erreur || "Échec.", "erreur"); return; }
        direEdt(dansGroupe ? "Séance proposée au groupe : chaque membre la voit." : (enEdition ? "Modifié." : "Ajouté."), "succes");
        fermerDialogue();
        charger();
        /* puis les invitations : l'evenement est ecrit, on le propose */
        var idEv = !dansGroupe && x.d.evenement && x.d.evenement.id;
        if (idEv && destinataires.length) proposerA(idEv, destinataires);
      }).catch(function () { direEdt("Service indisponible.", "erreur"); });
    });

    /* ---------- proposer un evenement a des contacts (decision 4) ----------
       Les destinataires sont dans le champ cache #edt-contacts (identifiants
       separes par des virgules), montres en etiquettes. Apres l'ecriture de
       l'evenement, POST /api/emploi/invitations ; la route dit ce qui n'est
       pas parti (la base refuse un non-contact). */
    function peindreContactsChoisis() {
      var ids = document.getElementById("edt-contacts").value.split(",").filter(Boolean);
      var zone = document.getElementById("edt-contacts-liste");
      zone.textContent = "";
      document.getElementById("edt-choisir-contacts").textContent = ids.length ? "Changer" : "Choisir des contacts…";
      if (!ids.length) { var v = document.createElement("span"); v.className = "sf-vide"; v.textContent = "Personne"; zone.appendChild(v); return; }
      listeContacts().then(function (c) {
        zone.textContent = "";
        ids.forEach(function (id) {
          var k = c.contacts.filter(function (x) { return x.membre === id; })[0];
          var e = document.createElement("span"); e.className = "sf-etiquette";
          var t = document.createElement("span"); t.textContent = k ? k.pseudo : "?"; e.appendChild(t);
          var x = document.createElement("button"); x.type = "button"; x.className = "sf-etiquette-x"; x.textContent = "×"; x.setAttribute("aria-label", "Retirer");
          x.addEventListener("click", function () {
            document.getElementById("edt-contacts").value = ids.filter(function (i) { return i !== id; }).join(",");
            peindreContactsChoisis();
          });
          e.appendChild(x); zone.appendChild(e);
        });
      });
    }
    document.getElementById("edt-choisir-contacts").addEventListener("click", function () {
      ouvrirSelecteurContacts(document.getElementById("edt-contacts").value.split(",").filter(Boolean), function (choisis) {
        document.getElementById("edt-contacts").value = choisis.join(",");
        peindreContactsChoisis();
      });
    });
    function proposerA(idEv, vers) {
      appel("POST", "/api/emploi/invitations", { evenement: idEv, vers: vers }).then(function (x) {
        if (!x.ok) { direEdt(x.d.erreur || "L'événement est enregistré, mais n'a pas pu être proposé.", "erreur"); return; }
        var n = x.d.envoyees || 0, r = (x.d.refusees || []).length;
        direEdt("Enregistré, et proposé à " + n + " contact" + (n > 1 ? "s" : "") + (r ? " (" + r + " refusé" + (r > 1 ? "s" : "") + " par la base : pas un contact ?)" : "") + ".", r ? "info" : "succes");
      }).catch(function () {});
    }
    /* les invitations recues : un bandeau au-dessus de la grille, Accepter
       copie l'evenement chez moi (la grille se recharge), Refuser la ferme */
    function chargerInvitations() {
      appel("GET", "/api/emploi/invitations").then(function (x) {
        var zone = document.getElementById("edt-invitations"), ul = document.getElementById("edt-liste-invitations");
        ul.textContent = "";
        var attente = x.ok ? (x.d.recues || []).filter(function (i) { return i.etat === "en_attente"; }) : [];
        zone.hidden = !attente.length;
        attente.forEach(function (i) {
          var li = document.createElement("li");
          li.setAttribute("data-invitation", i.id);
          var t = document.createElement("div"); t.className = "grp-membre-texte";
          var n = document.createElement("div"); n.className = "grp-carte-titre"; n.textContent = i.titre; t.appendChild(n);
          var d = new Date(i.debut);
          var s = document.createElement("div"); s.className = "c-note";
          s.textContent = (TYPES_EVENEMENT[i.type] ? TYPES_EVENEMENT[i.type].libelle : i.type) + " · "
            + d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })
            + (i.journee ? "" : " " + hhmm(d) + (i.fin ? " → " + hhmm(new Date(i.fin)) : ""))
            + " · proposé par " + (i.de_pseudo || "?");
          t.appendChild(s);
          li.appendChild(t);
          var actions = document.createElement("span"); actions.className = "grp-membre-actions";
          var ok = document.createElement("button"); ok.type = "button"; ok.className = "btn btn-mini btn-accent"; ok.textContent = "Accepter";
          var non = document.createElement("button"); non.type = "button"; non.className = "btn btn-mini"; non.textContent = "Refuser";
          ok.addEventListener("click", function () { repondreInvitation(i.id, true); });
          non.addEventListener("click", function () { repondreInvitation(i.id, false); });
          actions.appendChild(ok); actions.appendChild(non);
          li.appendChild(actions);
          ul.appendChild(li);
        });
      }).catch(function () {});
    }
    function repondreInvitation(id, accepte) {
      appel("PATCH", "/api/emploi/invitations", { id: id, accepte: accepte }).then(function (x) {
        if (!x.ok) { direEdt(x.d.erreur || "Échec.", "erreur"); return; }
        direEdt(accepte ? "C'est dans ta grille." : "Invitation refusée.", accepte ? "succes" : "info");
        chargerInvitations();
        if (accepte) charger();
      }).catch(function () { direEdt("Service indisponible.", "erreur"); });
    }
    chargerInvitations();

    document.getElementById("edt-supprimer").addEventListener("click", function () {
      if (!enEdition) return;
      appel("DELETE", "/api/emploi/" + enEdition.id).then(function (x) {
        if (!x.ok) { direEdt(x.d.erreur || "Échec.", "erreur"); return; }
        direEdt("Supprimé.", "succes");
        fermerDialogue();
        charger();
      });
    });

    /* ---------- fichier .ics ---------- */
    document.getElementById("edt-importer").addEventListener("click", function () {
      var f = document.getElementById("edt-fichier").files[0];
      if (!f) { direEdt("Choisis d'abord un fichier .ics.", "erreur"); return; }
      direEdt("Lecture du fichier…", "info");
      f.text().then(function (texte) {
        return appel("POST", "/api/emploi/import", texte, true);
      }).then(function (x) {
        if (!x.ok) { direEdt(x.d.erreur || "L'import a échoué.", "erreur"); return; }
        direEdt(x.d.ecrits + " événement" + (x.d.ecrits > 1 ? "s" : "") + " importé"
                + (x.d.ecrits > 1 ? "s" : "") + (x.d.ignores ? " (" + x.d.ignores + " illisible" + (x.d.ignores > 1 ? "s" : "") + ")" : "") + ".", "succes");
        charger();
      }).catch(function () { direEdt("Fichier illisible.", "erreur"); });
    });

    /* ---------- liens suivis ---------- */
    function peindreCals(cals) {
      var ul = document.getElementById("edt-cals");
      ul.textContent = "";
      if (!cals.length) { ul.textContent = "Aucun lien suivi."; return; }
      cals.forEach(function (c) {
        var li = document.createElement("li");
        var nom = document.createElement("strong");
        nom.textContent = c.nom;
        li.appendChild(nom);
        var etat = document.createElement("span");
        etat.className = "c-note";
        etat.textContent = " — " + (c.dernier_etat || "jamais synchronisé")
          + (c.derniere_synchro ? " (" + new Date(c.derniere_synchro).toLocaleString("fr-FR") + ")" : "");
        li.appendChild(etat);
        var sync = document.createElement("button");
        sync.type = "button"; sync.className = "lien-bouton"; sync.textContent = "resynchroniser";
        sync.addEventListener("click", function () { synchroniser(c.id); });
        li.appendChild(sync);
        var ret = document.createElement("button");
        ret.type = "button"; ret.className = "lien-bouton"; ret.textContent = "retirer";
        ret.addEventListener("click", function () {
          appel("DELETE", "/api/emploi/calendriers?id=" + c.id).then(function (x) {
            if (!x.ok) { direEdt(x.d.erreur || "Échec.", "erreur"); return; }
            direEdt("Lien retiré, et ce qu'il avait apporté avec lui.", "succes");
            chargerCals(); charger();
          });
        });
        li.appendChild(ret);
        ul.appendChild(li);
      });
    }

    var calsConnus = [];
    function chargerCals() {
      appel("GET", "/api/emploi/calendriers").then(function (x) {
        if (!x.ok) return;
        calsConnus = x.d.calendriers || [];
        peindreCals(calsConnus);
        /* a l'ouverture : resynchroniser ce qui date de plus de six heures */
        var vieux = calsConnus.filter(function (c) {
          return !c.derniere_synchro || Date.now() - new Date(c.derniere_synchro) > 6 * 3600000;
        });
        if (vieux.length) synchroniser(null);
      });
    }

    function synchroniser(id) {
      direEdt("Synchronisation…", "info");
      appel("POST", "/api/emploi/synchro", id ? { id: id } : {}).then(function (x) {
        if (!x.ok) { direEdt(x.d.erreur || "Échec.", "erreur"); return; }
        var b = x.d.bilans || [];
        var rates = b.filter(function (y) { return !y.ok; });
        direEdt(rates.length
          ? "Synchronisation : " + rates.map(function (y) { return y.nom + " — " + y.erreur; }).join(" ; ")
          : "Synchronisé : " + b.map(function (y) { return y.nom + " (" + y.etat + ")"; }).join(", "),
          rates.length ? "erreur" : "succes");
        chargerCals(); charger();
      }).catch(function () { direEdt("Service indisponible.", "erreur"); });
    }

    document.getElementById("edt-form-lien").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var url = document.getElementById("edt-lien-url").value.trim();
      var nom = document.getElementById("edt-lien-nom").value.trim();
      direEdt("Vérification du lien…", "info");
      appel("POST", "/api/emploi/calendriers", { url: url, nom: nom || undefined }).then(function (x) {
        if (!x.ok) { direEdt(x.d.erreur || "Échec.", "erreur"); return; }
        var s = x.d.synchro || {};
        direEdt(s.ok ? "Lien suivi : " + s.etat + "." : "Lien enregistré, mais " + (s.erreur || "la synchronisation a échoué") + ".",
                s.ok ? "succes" : "erreur");
        document.getElementById("edt-lien-url").value = "";
        document.getElementById("edt-lien-nom").value = "";
        chargerCals(); charger();
      }).catch(function () { direEdt("Service indisponible.", "erreur"); });
    });

    charger();
    chargerCals();
  }


  /* ------------------------------------------------------------------
     Les groupes de revision (pages /groupes/)
     ------------------------------------------------------------------
     Deux pages, un seul bloc. Rien n'est protege ici : la base decide de
     ce que chaque personne voit, la page ne fait que le peindre — en
     cartes, en fil de discussion, en avatars : ce qu'on attend d'une app,
     pas d'une page de formulaire.
  ------------------------------------------------------------------ */
  function direGrp(texte, type) {
    var z = document.getElementById("etat");
    if (!z) return;
    z.textContent = texte;
    z.className = "etat" + (type ? " etat-" + type : "");
    z.hidden = !texte;
  }
  function appelGrp(methode, chemin, corps) {
    var options = { method: methode, headers: { "Accept": "application/json" } };
    if (corps !== undefined) {
      options.headers["content-type"] = "application/json";
      options.body = JSON.stringify(corps);
    }
    return fetch(chemin, options).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, statut: r.status, d: d }; });
    });
  }
  /* ---------- les non-lus (lot F) ----------
     Une pastille avec le nombre de messages pas encore lus (la route les
     compte depuis « lectures », plafonne a 100 : au-dela, « 99+ »), et le
     titre de l'onglet prefixe du meme nombre — « (3) Groupes » — pour que
     l'onglet le dise depuis la barre du navigateur. Rien n'est stocke : le
     nombre vient de la base a chaque lecture. */
  var TITRE_SANS_COMPTE = null;
  function libelleNonLus(n) { return n >= 100 ? "99+" : String(n); }
  /* Ce que disent l'en-tete, le titre de l'onglet et la carte du portail :
     le nombre de CONVERSATIONS ou il reste a lire — une par discussion,
     quel que soit le nombre de messages (comme Beeper). Le nombre de
     messages, lui, ne se lit que sur la ligne de chaque discussion. */
  function conversationsNonLues(d) {
    if (typeof d.conversations_non_lues === "number") return d.conversations_non_lues;
    return (d.groupes || []).filter(function (g) { return (Number(g.non_lus) || 0) > 0; }).length;
  }
  function pastilleNonLus(n, libelle) {
    if (!n) return null;
    var p = document.createElement("span");
    p.className = "nl-pastille";
    p.textContent = libelleNonLus(n);
    p.title = n + " message" + (n > 1 ? "s" : "") + " non lu" + (n > 1 ? "s" : "") + (libelle ? " " + libelle : "");
    p.setAttribute("aria-label", p.title);
    return p;
  }
  /* ---------- ecrire en prive (lot H) ----------
     Une conversation privee est un groupe a deux, sans nom (groupes.prive,
     supabase/2026_messagerie_privee.sql) : la meme page, le meme fil, le
     meme direct. ecrireA() ouvre — ou retrouve — la conversation avec un
     CONTACT (POST /api/groupes/prive : la base refuse qui n'en est pas un)
     et y va. ouvrirChoixContactPourEcrire() : la fenetre qui liste mes
     contacts, un clic = ecrireA. `dire` : ou afficher l'etat (direGrp par
     defaut). */
  function ecrireA(membre, pseudo, dire) {
    var d = dire || direGrp;
    d("Ouverture de la conversation avec " + (pseudo || "ce contact") + "…", "info");
    return appelGrp("POST", "/api/groupes/prive", { avec: membre }).then(function (x) {
      if (!x.ok) { d(x.d.erreur || "Échec.", x.d.indisponible ? "info" : "erreur"); return null; }
      location.href = "/groupes/groupe.html?id=" + encodeURIComponent(x.d.id);
      return x.d.id;
    }).catch(function () { d("Service indisponible.", "erreur"); return null; });
  }
  /* ---------- le chiffrement de bout en bout (lot H, session 2) ----------
     assets/chiffrement.js (window.Chiffrement) porte la cryptographie ;
     ici, le TROUSSEAU : mes cles (la publique en base, la privee non
     extractable dans IndexedDB, sa copie chiffree par la phrase en base),
     et les fenetres — la premiere fois (la phrase, montree une fois, trois
     mots a retaper), un autre appareil (entrer la phrase), changer de
     phrase, regenerer (phrase perdue), les empreintes. Tout est promesses
     et fonctions ES5 : ce script doit rester lisible des vieux navigateurs,
     seul chiffrement.js est moderne — et s'il manque, tout se dit
     « indisponible » au lieu de casser. Conception : docs/chiffrement.md. */
  var Ch = window.Chiffrement || null;
  function chiffrementDisponible() { return !!(Ch && Ch.disponible()); }
  /* K3 : « des cles sans aucune sauvegarde sont sur cet appareil ». Posee
     par le trousseau quand il le constate ; la DECONNEXION la lit, parce
     qu'elle efface les cles locales (lot H, pour les postes partages) — et
     sans sauvegarde, les effacer, c'est les perdre. */
  var CLE_SANS_SAUVEGARDE = "fiches-cles-sans-sauvegarde";

  /* ---------- WebAuthn : la passkey qui deverrouille (lot K2) ----------
     Le seul morceau qui parle au navigateur ; la cryptographie est dans
     chiffrement.js (scellerParPasskey / ouvrirParPasskey), testable en node
     avec un faux authentificateur. Ici : fabriquer une passkey, et lui
     demander le secret « prf ».

     « prf » est une extension de WebAuthn : l'authentificateur calcule
     HMAC(son secret, notre sel) et rend 32 octets AU NAVIGATEUR — jamais au
     serveur. Tous les authentificateurs ne la savent pas faire : on le
     verifie (`prf.enabled`) et on ne publie RIEN si elle manque, plutot que
     d'enregistrer une passkey qui n'ouvrirait jamais rien.

     Le defi (`challenge`) est tire au hasard mais n'est pas verifie par le
     serveur, et c'est normal : cette passkey ne sert pas a dire qui on est
     (le cookie de session le dit deja), elle sert a DECHIFFRER. */
  var Passkeys = {
    supporte: function () {
      return !!(window.PublicKeyCredential && navigator.credentials
                && typeof navigator.credentials.create === "function" && Ch);
    },
    octetsDe: function (uuid) {
      var hex = String(uuid || "").replace(/-/g, ""), o = new Uint8Array(16);
      for (var i = 0; i < 16; i++) o[i] = parseInt(hex.substr(2 * i, 2), 16) || 0;
      return o;
    },
    creer: function (moi, nom) {
      var options = {
        challenge: Ch.aleatoire(32),
        rp: { name: "Fiches BUT", id: location.hostname },
        user: { id: Passkeys.octetsDe(moi.id), name: moi.pseudo || "compte", displayName: moi.pseudo || "compte" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
        timeout: 120000,
        extensions: { prf: {} },
      };
      return navigator.credentials.create({ publicKey: options }).then(function (cred) {
        if (!cred) throw new Error("Aucune passkey créée.");
        var ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
        if (!ext.prf || ext.prf.enabled !== true) {
          throw new Error("Cet appareil sait faire des passkeys, mais pas en dériver une clé (extension « prf » absente). Rien n\u2019a été enregistré.");
        }
        return { id: Ch.b64u(new Uint8Array(cred.rawId)) };
      }, function (e) {
        throw new Error(/NotAllowed/.test(e.name || "") ? "Geste annulé." : (e.message || "La passkey n\u2019a pas pu être créée."));
      });
    },
    /* `liste` : [{ credential_id, sel }]. Une seule passkey → « eval » ;
       plusieurs → « evalByCredential », qui donne A CHACUNE son sel (elles
       n'ont pas le meme, et c'est voulu). */
    secret: function (liste) {
      var permis = [], parCred = {};
      liste.forEach(function (p) {
        permis.push({ type: "public-key", id: Ch.deB64u(p.credential_id) });
        parCred[p.credential_id] = { first: Ch.deB64u(p.sel) };
      });
      var prf = liste.length === 1 ? { eval: parCred[liste[0].credential_id] } : { evalByCredential: parCred };
      return navigator.credentials.get({ publicKey: {
        challenge: Ch.aleatoire(32), allowCredentials: permis, userVerification: "required",
        timeout: 120000, rpId: location.hostname, extensions: { prf: prf },
      } }).then(function (cred) {
        if (!cred) throw new Error("Geste annulé.");
        var ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
        var res = ext.prf && ext.prf.results && ext.prf.results.first;
        if (!res) throw new Error("Cet appareil n\u2019a pas rendu de clé pour cette passkey (extension « prf » absente).");
        /* K3 : les donnees de l'authentificateur portent un octet de
           drapeaux (le 33e) ; le bit 0x10, « backup state », dit si la
           passkey est SYNCHRONISEE (trousseau iCloud, gestionnaire Google).
           Une passkey liee a l'appareil meurt avec lui : ce n'est pas une
           sauvegarde. Illisible → null, « on ne sait pas ». */
        var sync = null;
        try {
          var ad = cred.response && cred.response.authenticatorData;
          if (ad && ad.byteLength > 32) sync = (new Uint8Array(ad)[32] & 0x10) !== 0;
        } catch (e) { sync = null; }
        return { credential_id: Ch.b64u(new Uint8Array(cred.rawId)), secret: new Uint8Array(res), synchronisee: sync };
      }, function (e) {
        throw new Error(/NotAllowed/.test(e.name || "") ? "Geste annulé." : (e.message || "La passkey n\u2019a pas répondu."));
      });
    },
  };
  var trousseau = {
    promesse: null, moi: null, statut: "inconnu",   /* indisponible | aucune | verrouillee | ok */
    identite: null,   /* { version, privee (CryptoKey), publiqueJwk, empreinte } quand statut = ok */
    publique: null, copie: null, anciennes: [],
    /* lit /api/cles et IndexedDB, pose le statut ; une seule fois par page
       sauf `force` (apres une creation, un deverrouillage) */
    charger: function (force) {
      if (trousseau.promesse && !force) return trousseau.promesse;
      trousseau.promesse = lireMoi().then(function (moi) {
        trousseau.moi = moi && moi.connecte ? { id: moi.id || null, pseudo: moi.pseudo } : null;
        if (!chiffrementDisponible() || !trousseau.moi) { trousseau.statut = "indisponible"; return trousseau; }
        return appelGrp("GET", "/api/cles").then(function (x) {
          if (!x.ok) { trousseau.statut = "indisponible"; trousseau.raison = x.d.erreur || ""; return trousseau; }
          trousseau.publique = x.d.publique; trousseau.copie = x.d.privee; trousseau.anciennes = x.d.anciennes || [];
          if (!trousseau.moi.id) trousseau.moi.id = x.d.moi || null;
          if (!x.d.publique) { trousseau.statut = "aucune"; trousseau.identite = null; trousseau.passkeys = []; return trousseau; }
          trousseau.chargerPasskeys();   /* en parallele : la peinture s'en sert, personne ne l'attend */
          return Ch.stockage.lireIdentite(trousseau.moi.id).then(function (locale) {
            if (locale && locale.version === x.d.publique.version && locale.privee) {
              /* `pkcs8` : les octets de la cle privee, gardes en plus de la
                 CryptoKey pour pouvoir OUVRIR UN AUTRE APPAREIL sans la
                 phrase (lot K1). Absent sur un appareil range avant ce lot :
                 la fenetre demandera la phrase une fois, puis les gardera. */
              trousseau.identite = { version: locale.version, privee: locale.privee, publiqueJwk: x.d.publique.cle, empreinte: x.d.publique.empreinte, pkcs8: locale.pkcs8 || null };
              trousseau.statut = "ok";
            } else {
              trousseau.identite = null; trousseau.statut = "verrouillee";
            }
            return trousseau;
          });
        });
      }).catch(function () { trousseau.statut = "indisponible"; return trousseau; });
      /* quand l'etat change (cles creees, deverrouillees, retirees), les
         autres morceaux de la page — la liste des conversations, ses
         apercus — se remettent a jour */
      if (force) trousseau.promesse.then(function () {
        try { document.dispatchEvent(new CustomEvent("cles-changees")); } catch (e) { /* vieux navigateur : sans */ }
      });
      return trousseau.promesse;
    },
    /* etape 1 : une identite et une phrase, EN MEMOIRE — rien n'est
       publie avant les trois mots retapes (publier) */
    brouillon: function () {
      return Ch.genererIdentite().then(function (id) {
        var ph = Ch.genererPhrase();
        return { identite: id, mots: ph.mots, phrase: ph.phrase };
      });
    },
    /* etape 2 : la copie chiffree par la phrase, PUT, la privee importee
       non extractable et rangee */
    publier: function (b) {
      var moi = trousseau.moi;
      /* la version entre dans l'AAD de la copie : on relit la courante juste
         avant, pour qu'elle soit celle que la base va donner (max + 1) */
      return trousseau.charger(true).then(function () {
        var version = (trousseau.publique ? trousseau.publique.version : 0) + 1;
        return Ch.envelopperPrivee(b.identite.priveePkcs8, b.phrase, moi.id, version).then(function (copie) {
          return appelGrp("PUT", "/api/cles", { publique: { algo: "ecdh-p256", cle: b.identite.publiqueJwk, empreinte: b.identite.empreinte }, privee: copie })
            .then(function (x) { if (x.ok && x.d.version !== version) throw new Error("La version des clés a changé entre-temps : recommence."); return x; });
        });
      }).then(function (x) {
        if (!x.ok) throw new Error(x.d.erreur || "Les clés n'ont pas été publiées.");
        return Ch.importerPriveeNonExtractable(b.identite.priveePkcs8).then(function (privee) {
          return Ch.stockage.ecrireIdentite(moi.id, x.d.version, privee, b.identite.publiqueJwk, b.identite.priveePkcs8).catch(function () {}).then(function () {
            b.identite.priveePkcs8 = null;
            return trousseau.charger(true);
          });
        });
      });
    },
    /* un autre appareil : la phrase ouvre la copie */
    deverrouiller: function (phrase) {
      var moi = trousseau.moi;
      if (!trousseau.copie) return Promise.reject(new Error("Aucune copie de clé à déverrouiller."));
      return Ch.ouvrirPrivee(trousseau.copie, phrase, moi.id).then(function (pkcs8) {
        return Ch.importerPriveeNonExtractable(pkcs8).then(function (privee) {
          return Ch.stockage.ecrireIdentite(moi.id, trousseau.copie.version, privee, trousseau.publique.cle, pkcs8).catch(function () {}).then(function () {
            return trousseau.charger(true);
          });
        });
      });
    },
    /* ---------- lier un appareil (lot K1) ----------
       Les octets de ma cle privee, pour les transmettre a un autre de mes
       appareils. Cet appareil les a s'il a range ses cles depuis le lot K1 ;
       sinon la phrase les rend — et les range, pour la fois d'apres. Rejette
       avec « phrase requise » quand il n'y a ni l'un ni l'autre. */
    octetsPrives: function (phrase) {
      var moi = trousseau.moi;
      if (trousseau.identite && trousseau.identite.pkcs8) return Promise.resolve(trousseau.identite.pkcs8);
      /* lot K2 : un geste vaut mieux qu'une phrase. Si une passkey est
         enregistree et que cet appareil sait la lire, elle rend les octets
         sans rien demander a taper. */
      if (!phrase && Passkeys.supporte() && trousseau.passkeys.length) {
        var moiId = moi.id;
        return Passkeys.secret(trousseau.passkeys).then(function (r) {
          var ligne = trousseau.passkeys.filter(function (p) { return p.credential_id === r.credential_id; })[0] || trousseau.passkeys[0];
          return Ch.ouvrirParPasskey({ sel: ligne.sel, enveloppe: ligne.enveloppe }, r.secret,
                                     { membre: moiId, credential: ligne.credential_id, version: ligne.version });
        });
      }
      if (!phrase) return Promise.reject(new Error("phrase requise"));
      if (!trousseau.copie) return Promise.reject(new Error("Aucune copie de clé sur ce compte."));
      return Ch.ouvrirPrivee(trousseau.copie, phrase, moi.id).then(function (pkcs8) {
        return Ch.importerPriveeNonExtractable(pkcs8).then(function (privee) {
          return Ch.stockage.ecrireIdentite(moi.id, trousseau.copie.version, privee, trousseau.publique.cle, pkcs8)
            .catch(function () {}).then(function () { if (trousseau.identite) trousseau.identite.pkcs8 = pkcs8; return pkcs8; });
        });
      });
    },
    /* ---------- K3 : des cles sans phrase ----------
       Une identite, une cle publique, et c'est tout : aucune copie par
       phrase en base. La personne choisira ensuite sa sauvegarde. Rejette
       avec « indisponible » si la migration K3 manque : l'appelant revient
       alors a l'ancien chemin (la phrase d'abord). */
    creerSansPhrase: function () {
      var moi = trousseau.moi;
      return Ch.genererIdentite().then(function (id) {
        return appelGrp("PUT", "/api/cles", { publique: { algo: "ecdh-p256", cle: id.publiqueJwk, empreinte: id.empreinte } })
          .then(function (x) {
            if (!x.ok) { var err = new Error(x.d.erreur || "Les clés n\u2019ont pas été créées."); if (x.d.indisponible) err.indisponible = true; throw err; }
            return Ch.importerPriveeNonExtractable(id.priveePkcs8).then(function (privee) {
              return Ch.stockage.ecrireIdentite(moi.id, x.d.version, privee, id.publiqueJwk, id.priveePkcs8)
                .catch(function () {}).then(function () { return trousseau.charger(true); });
            });
          });
      });
    },
    /* Ce qui protege la cle. Une PHRASE (sa copie a la version courante) et
       les passkeys SYNCHRONISEES sont des sauvegardes : elles survivent a la
       perte de l'appareil. Une passkey liee a l'appareil, ou dont on ne sait
       pas, n'en est pas une — on le dit, on ne la compte pas.
       Un second appareil ouvert (K1) n'est pas compte non plus : la base
       n'en garde aucune trace, et le vol d'un sac emporte souvent les deux. */
    sauvegardes: function () {
      var pub = trousseau.publique;
      if (!pub) return { phrase: null, passkeys: [], sures: 0 };
      var phrase = trousseau.copie && Number(trousseau.copie.version) === Number(pub.version) ? trousseau.copie : null;
      var pks = (trousseau.passkeys || []).filter(function (p) { return Number(p.version) === Number(pub.version); });
      var sures = (phrase ? 1 : 0) + pks.filter(function (p) { return p.synchronisee === true; }).length;
      return { phrase: phrase, passkeys: pks, sures: sures };
    },
    /* la meme chose, apres avoir relu les passkeys ; et la marque locale
       que la deconnexion consulte (voir « sansSauvegarde ») */
    etatSauvegardes: function () {
      return trousseau.chargerPasskeys().then(function () {
        var s = trousseau.sauvegardes();
        if (trousseau.statut === "ok" && !s.sures) ecrireLocal(CLE_SANS_SAUVEGARDE, "1");
        else ecrireLocal(CLE_SANS_SAUVEGARDE, null);
        return s;
      });
    },
    /* Noter (ou changer) sa phrase depuis un appareil ouvert : les octets de
       la cle viennent de cet appareil, ou d'une passkey — l'ancienne phrase
       n'est plus necessaire. Rend le brouillon a montrer. */
    brouillonNouvellePhrase: function () {
      return trousseau.octetsPrives(null).then(function (pkcs8) {
        var ph = Ch.genererPhrase();
        return { pkcs8: pkcs8, mots: ph.mots, phrase: ph.phrase };
      });
    },
    deposerPhrase: function (b) {
      var moi = trousseau.moi, version = trousseau.publique.version;
      return Ch.envelopperPrivee(b.pkcs8, b.phrase, moi.id, version).then(function (copie) {
        return appelGrp("PUT", "/api/cles", { privee: copie });
      }).then(function (x) {
        if (!x.ok) throw new Error(x.d.erreur || "La phrase n\u2019a pas été enregistrée.");
        b.pkcs8 = null;
        return trousseau.charger(true);
      });
    },

    /* ---------- les passkeys (lot K2) ----------
       `liste` est relue avec les cles : la page en a besoin pour proposer
       les bonnes au navigateur, et pour ouvrir l'enveloppe apres le geste. */
    passkeys: [],
    chargerPasskeys: function () {
      /* relue MEME si ce navigateur ne sait pas faire de passkey (K3) : une
         passkey synchronisee enregistree ailleurs reste une sauvegarde, et
         la compter de travers ferait crier la deconnexion pour rien. Ce qui
         appelle le navigateur (Passkeys.secret) verifie supporte() lui-meme. */
      return appelGrp("GET", "/api/cles/passkeys").then(function (x) {
        trousseau.passkeys = (x.ok && x.d.passkeys) ? x.d.passkeys : [];
        return trousseau.passkeys;
      }).catch(function () { trousseau.passkeys = []; return []; });
    },
    /* Enregistrer : le geste fabrique la passkey, un second geste donne le
       secret « prf », et c'est lui qui scelle la cle privee. Rien n'est
       publie si l'authentificateur ne sait pas faire « prf ». */
    enregistrerPasskey: function (nom) {
      var moi = trousseau.moi, version = trousseau.publique ? trousseau.publique.version : 0;
      return trousseau.octetsPrives(null).then(function (pkcs8) {
        return Passkeys.creer(moi, nom).then(function (cred) {
          var sel = Ch.selPasskey();
          return Passkeys.secret([{ credential_id: cred.id, sel: Ch.b64u(sel) }]).then(function (r) {
            return Ch.scellerParPasskey(pkcs8, r.secret, sel, { membre: moi.id, credential: cred.id, version: version })
              .then(function (copie) {
                return appelGrp("POST", "/api/cles/passkeys", { credential_id: cred.id, version: version, sel: copie.sel, enveloppe: copie.enveloppe, nom: nom || null,
                                                                synchronisee: typeof r.synchronisee === "boolean" ? r.synchronisee : null });
              });
          });
        });
      }).then(function (x) {
        if (!x.ok) throw new Error(x.d.erreur || "La passkey n\u2019a pas été enregistrée.");
        /* Ce que la passkey repare (docs/chiffrement.md, § 17) : les octets
           de la cle privee n'ont plus besoin de vivre en clair sur cet
           appareil — la CryptoKey non extractable suffit a lire et a
           ecrire, et le geste les rend quand il faut en ouvrir un autre. */
        return Ch.stockage.ecrireIdentite(trousseau.moi.id, trousseau.publique.version, trousseau.identite.privee, trousseau.publique.cle, null)
          .catch(function () {})
          .then(function () { if (trousseau.identite) trousseau.identite.pkcs8 = null; return trousseau.chargerPasskeys(); })
          .then(function () { return trousseau.charger(true); });
      });
    },
    /* Un geste, et la cle privee revient : c'est le chemin ordinaire sur un
       appareil ou la passkey est disponible (la meme, ou celle que le
       trousseau du systeme a synchronisee). */
    ouvrirParPasskey: function () {
      var moi = trousseau.moi;
      return trousseau.chargerPasskeys().then(function (liste) {
        if (!liste.length) throw new Error("Aucune passkey enregistrée sur ce compte.");
        return Passkeys.secret(liste).then(function (r) {
          var ligne = liste.filter(function (p) { return p.credential_id === r.credential_id; })[0] || liste[0];
          return Ch.ouvrirParPasskey({ sel: ligne.sel, enveloppe: ligne.enveloppe }, r.secret,
                                     { membre: moi.id, credential: ligne.credential_id, version: ligne.version })
            .then(function (pkcs8) {
              return Ch.correspond(pkcs8, trousseau.publique.cle).then(function (bon) {
                if (!bon) throw new Error("La clé ouverte par cette passkey ne correspond pas à celle que la base publie.");
                return Ch.importerPriveeNonExtractable(pkcs8).then(function (privee) {
                  appelGrp("PATCH", "/api/cles/passkeys", { credential_id: ligne.credential_id,
                                                            synchronisee: typeof r.synchronisee === "boolean" ? r.synchronisee : null }).catch(function () {});
                  return Ch.stockage.ecrireIdentite(moi.id, ligne.version, privee, trousseau.publique.cle, null)
                    .catch(function () {}).then(function () { return trousseau.charger(true); });
                });
              });
            });
        });
      });
    },
    retirerPasskey: function (id) {
      return appelGrp("DELETE", "/api/cles/passkeys?credential_id=" + encodeURIComponent(id))
        .then(function () { return trousseau.chargerPasskeys(); });
    },
    /* Le nouvel appareil : l'enveloppe recue, ouverte avec la privee
       ephemere, VERIFIEE contre la publique que la base publie, puis
       rangee. Sans la verification, un serveur pourrait faire ranger
       n'importe quoi — et les messages deviendraient illisibles sans
       qu'on sache pourquoi. */
    recevoir: function (t, ephemere) {
      var moi = trousseau.moi;
      return Ch.ouvrirTransfert({ sel: t.sel, enveloppe: t.enveloppe }, ephemere.privee, trousseau.publique.cle,
                                { transfert: t.id, membre: moi.id, version: t.version })
        .then(function (pkcs8) {
          return Ch.correspond(pkcs8, trousseau.publique.cle).then(function (bon) {
            if (!bon) throw new Error("La clé reçue ne correspond pas à celle que la base publie.");
            return Ch.importerPriveeNonExtractable(pkcs8).then(function (privee) {
              return Ch.stockage.ecrireIdentite(moi.id, trousseau.publique.version, privee, trousseau.publique.cle, pkcs8)
                .catch(function () {}).then(function () { return trousseau.charger(true); });
            });
          });
        });
    },
    /* changer de phrase : l'ancienne ouvre la copie, une neuve la
       reenveloppe ; rend le brouillon { mots, phrase, pkcs8 } a montrer */
    brouillonPhrase: function (ancienne) {
      var moi = trousseau.moi;
      return Ch.ouvrirPrivee(trousseau.copie, ancienne, moi.id).then(function (pkcs8) {
        var ph = Ch.genererPhrase();
        return { pkcs8: pkcs8, mots: ph.mots, phrase: ph.phrase };
      });
    },
    publierPhrase: function (b) {
      var moi = trousseau.moi;
      return Ch.envelopperPrivee(b.pkcs8, b.phrase, moi.id, trousseau.copie.version).then(function (copie) {
        return appelGrp("PUT", "/api/cles", { privee: copie });
      }).then(function (x) {
        if (!x.ok) throw new Error(x.d.erreur || "La phrase n'a pas été changée.");
        b.pkcs8 = null;
        return trousseau.charger(true);
      });
    },
    retirer: function () { return Ch.stockage.effacerTout().then(function () { return trousseau.charger(true); }); },
  };

  /* ---------- les fenetres du trousseau ---------- */
  function dialogueCommun(classe, html) {
    var d = document.createElement("dialog"); d.className = "edt-dialogue sf-dialogue " + classe; d.innerHTML = html;
    document.body.appendChild(d);
    return d;
  }
  function telechargerTexte(nom, contenu) {
    try {
      var blob = new Blob([contenu], { type: "text/plain;charset=utf-8" });
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nom;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      return true;
    } catch (e) { return false; }
  }
  /* La phrase : montree une fois, a copier ou a telecharger (.txt), puis
     trois mots a retaper avant que `surConfirme` ne soit appele — c'est lui
     qui publie. `intro` dit pourquoi (premiere fois / nouvelle phrase). */
  function dialoguePhrase(o) {
    var d = dialogueCommun("cles-dialogue",
      '<div class="sf-tete"><h2>' + (o.titre || "Ta phrase de récupération") + '</h2></div>' +
      '<p class="c-note">' + (o.intro || "") + '</p>' +
      '<ol class="cles-mots"></ol>' +
      '<p class="cles-actions"><button type="button" class="btn btn-mini cles-copier">Copier</button> ' +
      '<button type="button" class="btn btn-mini cles-telecharger">Télécharger (.txt)</button> ' +
      '<span class="c-note cles-etat"></span></p>' +
      '<p class="c-note"><strong>Sans elle, les messages chiffrés seront perdus</strong> pour toi si tu changes d\u2019appareil ou de navigateur. Le site ne la connaît pas et ne pourra pas te la remontrer.</p>' +
      '<div class="cles-verif" hidden><p>Pour être sûr que tu l\u2019as notée, retape les mots n° <span class="cles-verif-nums"></span> :</p>' +
      '<div class="cles-verif-champs"></div><p class="etat etat-erreur cles-verif-erreur" hidden></p></div>' +
      '<div class="edt-boutons"><button type="button" class="btn btn-accent cles-suite">J\u2019ai noté ma phrase</button>' +
      '<button type="button" class="btn cles-annuler">' + (o.annuler || "Annuler") + '</button></div>');
    var q = function (s) { return d.querySelector(s); };
    var ol = q(".cles-mots"); o.mots.forEach(function (m) { var li = document.createElement("li"); li.textContent = m; ol.appendChild(li); });
    var etat = q(".cles-etat");
    q(".cles-copier").addEventListener("click", function () {
      var fini = function () { etat.textContent = "Copiée."; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(o.phrase).then(fini, fini); else fini();
    });
    q(".cles-telecharger").addEventListener("click", function () {
      var pseudo = trousseau.moi ? trousseau.moi.pseudo : "";
      etat.textContent = telechargerTexte("fiches-but-phrase-de-recuperation.txt", Ch.fichierPhrase(o.mots, pseudo)) ? "Fichier téléchargé : garde-le hors d\u2019un poste partagé." : "Téléchargement impossible ici.";
    });
    /* trois positions au hasard, distinctes */
    var positions = [];
    while (positions.length < 3) { var p = Math.floor(Math.random() * 12); if (positions.indexOf(p) < 0) positions.push(p); }
    positions.sort(function (a, b) { return a - b; });
    var champs = q(".cles-verif-champs");
    positions.forEach(function (p) {
      var lab = document.createElement("label"); lab.textContent = "Mot n° " + (p + 1) + " ";
      var inp = document.createElement("input"); inp.type = "text"; inp.autocomplete = "off"; inp.setAttribute("data-position", String(p)); inp.className = "cles-verif-mot";
      lab.appendChild(inp); champs.appendChild(lab);
    });
    q(".cles-verif-nums").textContent = positions.map(function (p) { return p + 1; }).join(", ");
    var etape = 1;
    q(".cles-suite").addEventListener("click", function () {
      if (etape === 1) {
        etape = 2; q(".cles-mots").hidden = true; q(".cles-actions").hidden = true; q(".cles-verif").hidden = false;
        q(".cles-suite").textContent = "Vérifier"; champs.querySelector("input").focus();
        return;
      }
      var bons = positions.every(function (p) {
        var inp = champs.querySelector('input[data-position="' + p + '"]');
        return Ch.normaliser(inp.value) === Ch.normaliser(o.mots[p]);
      });
      var err = q(".cles-verif-erreur");
      if (!bons) { err.textContent = "Ce n\u2019est pas ça : relis ta phrase, mot par mot."; err.hidden = false; return; }
      err.hidden = true;
      q(".cles-suite").disabled = true; q(".cles-suite").textContent = "Un instant…";
      Promise.resolve(o.surConfirme()).then(function () { fermerDialogueGrp(d); d.remove(); if (o.surFini) o.surFini(); }, function (e) {
        q(".cles-suite").disabled = false; q(".cles-suite").textContent = "Vérifier";
        err.textContent = (e && e.message) || "Échec."; err.hidden = false;
      });
    });
    q(".cles-annuler").addEventListener("click", function () { fermerDialogueGrp(d); d.remove(); if (o.surAnnule) o.surAnnule(); });
    ouvrirDialogueGrp(d);
    return d;
  }
  /* Entrer sa phrase (un autre appareil). `surRegenerer` : la phrase est
     perdue, on repart avec de nouvelles cles. */
  function dialogueDeverrouiller(o) {
    /* K3 : des cles creees sans phrase n'ont pas de copie en base. Demander
       une phrase qu'on n'a jamais eue serait absurde : on montre les
       chemins qui existent vraiment. */
    if (trousseau.publique && !trousseau.copie) return dialogueSansCopie(o);
    var d = dialogueCommun("cles-dialogue",
      '<div class="sf-tete"><h2>Retrouve tes messages privés sur cet appareil</h2></div>' +
      '<p class="c-note">Entre ta phrase de récupération — les douze mots, dans l\u2019ordre, avec ou sans accents.</p>' +
      '<textarea class="cles-phrase" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="douze mots"></textarea>' +
      '<p class="etat etat-erreur cles-erreur" hidden></p>' +
      '<div class="edt-boutons"><button type="button" class="btn btn-accent cles-ok">Déverrouiller</button>' +
      '<button type="button" class="btn cles-annuler">' + (o.annuler || "Plus tard") + '</button></div>' +
      '<p class="c-note cles-plutot-passkey-ligne" hidden>Tu as enregistré une passkey ? <button type="button" class="lien-bouton cles-plutot-passkey">Déverrouille par un geste</button> — Face ID, empreinte, Windows Hello.</p>' +
      '<p class="c-note">Tu as un appareil où ils sont déjà ouverts ? <button type="button" class="lien-bouton cles-plutot-lier">Reçois tes clés depuis lui</button> — rien à taper.</p>' +
      '<p class="c-note">Tu l\u2019as perdue ? <button type="button" class="lien-bouton cles-regenerer">Régénérer mes clés</button> — tu perdras les messages chiffrés jusqu\u2019ici, sauf ceux qu\u2019un contact te rendra.</p>');
    var q = function (s) { return d.querySelector(s); };
    q(".cles-ok").addEventListener("click", function () {
      var a = Ch.analyserPhrase(q(".cles-phrase").value), err = q(".cles-erreur");
      if (!a.ok) { err.textContent = a.nombre !== 12 ? "Il faut douze mots (" + a.nombre + " lus)." : "Mot(s) inconnu(s) : " + a.inconnus.join(", ") + "."; err.hidden = false; return; }
      err.hidden = true; q(".cles-ok").disabled = true; q(".cles-ok").textContent = "Un instant…";
      trousseau.deverrouiller(a.canonique).then(function () { fermerDialogueGrp(d); d.remove(); if (o.surOk) o.surOk(); }, function (e) {
        q(".cles-ok").disabled = false; q(".cles-ok").textContent = "Déverrouiller";
        err.textContent = /phrase incorrecte/.test(e.message) ? "Phrase incorrecte." : (e.message || "Échec."); err.hidden = false;
      });
    });
    q(".cles-annuler").addEventListener("click", function () { fermerDialogueGrp(d); d.remove(); if (o.surAnnule) o.surAnnule(); });
    q(".cles-plutot-lier").addEventListener("click", function () {
      fermerDialogueGrp(d); d.remove();
      dialogueRecevoir({ surOk: o.surOk, surPhrase: function () { dialogueDeverrouiller(o); } });
    });
    /* la passkey, si le compte en a une et que cet appareil sait faire */
    if (Passkeys.supporte()) trousseau.chargerPasskeys().then(function (liste) {
      if (!liste.length || !d.isConnected) return;
      q(".cles-plutot-passkey-ligne").hidden = false;
    });
    q(".cles-plutot-passkey").addEventListener("click", function () {
      var err = q(".cles-erreur");
      err.hidden = true; q(".cles-ok").disabled = true;
      trousseau.ouvrirParPasskey().then(function () {
        fermerDialogueGrp(d); d.remove(); if (o.surOk) o.surOk();
      }, function (e) {
        q(".cles-ok").disabled = false;
        err.textContent = e.message || "La passkey n\u2019a pas ouvert la clé."; err.hidden = false;
      });
    });
    q(".cles-regenerer").addEventListener("click", function () {
      if (!confirm("Régénérer tes clés ? Les messages chiffrés jusqu\u2019ici ne seront plus lisibles pour toi, sauf ceux qu\u2019un contact te rendra. Tu pourras écrire tout de suite.")) return;
      fermerDialogueGrp(d); d.remove();
      if (o.surRegenerer) o.surRegenerer();
    });
    ouvrirDialogueGrp(d);
    return d;
  }
  /* ---------- lier un appareil depuis un autre (lot K1) ----------
     Deux fenetres, une de chaque cote. Le NOUVEL appareil (dialogueRecevoir)
     fabrique une paire ephemere, ouvre un transfert, montre le carre, le
     code et SON empreinte, puis attend. L'appareil DEJA OUVERT
     (dialogueDonner) retrouve le transfert par son code — ou par le lien du
     carre, « /parametres#lier=… » —, montre LA MEME empreinte, et
     n'enveloppe la cle qu'apres « c'est bien lui ».

     L'empreinte est tout ce qui separe ce parcours d'une porte ouverte :
     c'est elle qui dit que la publique ephemere vient bien de l'autre
     appareil, et non d'un serveur qui se la serait glissee. Les deux
     fenetres la montrent donc en grand, et le texte demande de comparer.
     Conception : docs/messagerie-accessible.md, § K1. */
  function blocEmpreinte(emp) {
    return '<p class="c-note">Les deux appareils doivent montrer <strong>exactement</strong> ces chiffres :</p>'
         + '<p class="grp-empreinte cles-empreinte">' + echapper(emp) + "</p>";
  }
  function dialogueRecevoir(o) {
    var d = dialogueCommun("cles-dialogue cles-lier",
      '<div class="sf-tete"><h2>Recevoir mes clés ici</h2></div>' +
      '<p>Sur un appareil où tes messages privés sont déjà ouverts : <strong>Paramètres → Ouvrir un autre appareil</strong>, ' +
      'puis entre le code ci-dessous — ou vise ce carré avec son appareil photo.</p>' +
      '<div class="cles-qr"></div>' +
      '<p class="cles-code">Code : <strong class="cles-code-chiffres">……</strong></p>' +
      '<div class="cles-empreinte-bloc"></div>' +
      '<p class="etat cles-etat-lier">Préparation…</p>' +
      '<div class="edt-boutons"><button type="button" class="btn cles-annuler">Annuler</button>' +
      '<button type="button" class="lien-bouton cles-plutot-phrase">Entrer ma phrase plutôt</button></div>');
    var q = function (s) { return d.querySelector(s); };
    var etat = q(".cles-etat-lier"), vivant = true, minuteur = null, transfert = null, ephemere = null;
    function fini() {
      vivant = false; if (minuteur) clearTimeout(minuteur);
      /* la ligne ne sert plus a rien : on ne la laisse pas trainer */
      if (transfert) appelGrp("DELETE", "/api/cles/transfert?id=" + encodeURIComponent(transfert.id)).catch(function () {});
      fermerDialogueGrp(d); d.remove();
    }
    q(".cles-annuler").addEventListener("click", function () { fini(); if (o.surAnnule) o.surAnnule(); });
    q(".cles-plutot-phrase").addEventListener("click", function () { fini(); if (o.surPhrase) o.surPhrase(); });

    Ch.genererEphemere().then(function (e) {
      ephemere = e;
      q(".cles-empreinte-bloc").innerHTML = blocEmpreinte(e.empreinte);
      return appelGrp("POST", "/api/cles/transfert", { publique: e.publiqueJwk, empreinte: e.empreinte });
    }).then(function (x) {
      if (!vivant) return;
      if (!x.ok) { etat.textContent = x.d.erreur || "Impossible d’ouvrir un transfert."; etat.className = "etat etat-erreur cles-etat-lier"; return; }
      transfert = x.d;
      q(".cles-code-chiffres").textContent = String(x.d.code).replace(/(\d{3})(\d{3})/, "$1 $2");
      var svg = svgQR(location.origin + "/parametres#lier=" + x.d.id, 190);
      if (svg) { q(".cles-qr").appendChild(svg); } else { q(".cles-qr").remove(); }
      etat.textContent = "En attente de l’autre appareil…";
      attendre(0);
    }).catch(function () { if (vivant) { etat.textContent = "Service indisponible."; etat.className = "etat etat-erreur cles-etat-lier"; } });

    /* On redemande la ligne jusqu'a ce que l'enveloppe y soit. Doucement :
       chaque appel est une execution de fonction, et le plan gratuit les
       compte (conception § 12) — toutes les 2,5 s la premiere minute, puis
       toutes les 8 s, et on s'arrete au bout de dix minutes, comme la
       ligne en base. */
    function attendre(tour) {
      if (!vivant || !transfert) return;
      if (tour > 24 + 68) { etat.textContent = "Le transfert a expiré. Ferme et recommence."; return; }
      minuteur = setTimeout(function () {
        if (!vivant) return;
        appelGrp("GET", "/api/cles/transfert?id=" + encodeURIComponent(transfert.id)).then(function (x) {
          if (!vivant) return;
          var t = x.ok && x.d.transferts && x.d.transferts[0];
          if (!t) { etat.textContent = "Le transfert a expiré. Ferme et recommence."; return; }
          if (!t.enveloppe) { attendre(tour + 1); return; }
          etat.textContent = "Réception…";
          trousseau.recevoir(t, ephemere).then(function () {
            etat.textContent = "C’est ouvert sur cet appareil.";
            fini(); if (o.surOk) o.surOk();
          }, function (e) {
            etat.textContent = e.message || "La clé reçue n’a pas pu être ouverte.";
            etat.className = "etat etat-erreur cles-etat-lier";
            vivant = false;
          });
        }).catch(function () { attendre(tour + 1); });
      }, tour < 24 ? 2500 : 8000);
    }
    ouvrirDialogueGrp(d);
    return d;
  }

  function dialogueDonner(o) {
    var d = dialogueCommun("cles-dialogue cles-lier",
      '<div class="sf-tete"><h2>Ouvrir un autre appareil</h2></div>' +
      '<div class="cles-donner-code">' +
      '<p>Sur l’autre appareil, ouvre <strong>Recevoir mes clés ici</strong> : il affiche un code de six chiffres.</p>' +
      '<label>Le code<input type="text" class="cles-code-champ" inputmode="numeric" autocomplete="off" maxlength="7" placeholder="000 000"></label>' +
      '</div>' +
      '<div class="cles-donner-verif" hidden>' +
      '<p>Un appareil demande à lire tes messages privés chiffrés.</p>' +
      '<div class="cles-empreinte-bloc"></div>' +
      '<p class="c-note">Si elles diffèrent, <strong>n’accepte pas</strong> : ce n’est pas l’appareil que tu crois.</p>' +
      '<div class="cles-donner-phrase" hidden><p class="c-note">Cet appareil a rangé ta clé sans pouvoir la transmettre (il l’a rangée avant cette version du site). Entre ta phrase une fois : il pourra ensuite ouvrir les suivants sans elle.</p>' +
      '<textarea class="cles-phrase" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="douze mots"></textarea></div>' +
      '</div>' +
      '<p class="etat cles-etat-lier" hidden></p>' +
      '<div class="edt-boutons"><button type="button" class="btn btn-accent cles-ok">Chercher</button>' +
      '<button type="button" class="btn cles-annuler">Annuler</button></div>');
    var q = function (s) { return d.querySelector(s); };
    var etat = q(".cles-etat-lier"), bouton = q(".cles-ok"), transfert = null;
    function dire(t, type) { etat.textContent = t; etat.className = "etat cles-etat-lier" + (type ? " etat-" + type : ""); etat.hidden = !t; }
    function fermer() { fermerDialogueGrp(d); d.remove(); }
    q(".cles-annuler").addEventListener("click", function () { fermer(); if (o.surAnnule) o.surAnnule(); });

    function montrer(t) {
      transfert = t;
      q(".cles-donner-code").hidden = true;
      q(".cles-donner-verif").hidden = false;
      q(".cles-empreinte-bloc").innerHTML = blocEmpreinte(t.empreinte);
      bouton.textContent = "C’est bien lui";
      dire("");
      trousseau.charger().then(function (tr) {
        /* la phrase n'est demandee QUE si cet appareil n'a ni les octets de
           la cle (ranges avant le lot K2) ni une passkey pour les rendre */
        var aLaCle = !!(tr.identite && tr.identite.pkcs8);
        var aUnePasskey = Passkeys.supporte() && tr.passkeys.length > 0;
        q(".cles-donner-phrase").hidden = aLaCle || aUnePasskey;
      });
    }
    function chercher(quoi) {
      dire("Recherche…", "info");
      var par = /^[0-9a-f-]{36}$/i.test(quoi) ? "id=" : "code=";
      appelGrp("GET", "/api/cles/transfert?" + par + encodeURIComponent(quoi)).then(function (x) {
        if (!x.ok) { dire(x.d.erreur || "Échec.", "erreur"); return; }
        var t = (x.d.transferts || []).filter(function (l) { return !l.enveloppe; })[0];
        if (!t) { dire("Aucune demande en cours avec ce code. Vérifie-le, ou rouvre la fenêtre sur l’autre appareil.", "erreur"); return; }
        montrer(t);
      }).catch(function () { dire("Service indisponible.", "erreur"); });
    }
    function donner() {
      var phrase = q(".cles-phrase") ? q(".cles-phrase").value : "";
      bouton.disabled = true; dire("Un instant…", "info");
      trousseau.octetsPrives(phrase && Ch.analyserPhrase(phrase).ok ? Ch.analyserPhrase(phrase).canonique : null)
        .then(function (pkcs8) {
          return Ch.envelopperIdentite(pkcs8, trousseau.identite.privee, transfert.publique_ephemere,
                                       { transfert: transfert.id, membre: trousseau.moi.id, version: trousseau.publique.version })
            .then(function (paquet) {
              return appelGrp("PATCH", "/api/cles/transfert", { id: transfert.id, version: trousseau.publique.version, sel: paquet.sel, enveloppe: paquet.enveloppe });
            });
        })
        .then(function (x) {
          bouton.disabled = false;
          if (!x.ok) { dire(x.d.erreur || "La base a refusé.", "erreur"); return; }
          dire("C’est envoyé : l’autre appareil s’ouvre.", "succes");
          bouton.hidden = true; q(".cles-annuler").textContent = "Fermer";
          if (o.surOk) o.surOk();
        })
        .catch(function (e) {
          bouton.disabled = false;
          if (/phrase requise/.test(e.message)) { dire("Entre ta phrase pour transmettre la clé.", "erreur"); q(".cles-donner-phrase").hidden = false; return; }
          dire(/phrase incorrecte/.test(e.message) ? "Phrase incorrecte." : (e.message || "Échec."), "erreur");
        });
    }
    bouton.addEventListener("click", function () {
      if (!transfert) {
        var v = (q(".cles-code-champ").value || "").replace(/\s+/g, "");
        if (!/^[0-9]{6}$/.test(v)) { dire("Un code a six chiffres.", "erreur"); return; }
        chercher(v);
      } else donner();
    });
    ouvrirDialogueGrp(d);
    if (o.id) chercher(o.id); else setTimeout(function () { var c = q(".cles-code-champ"); if (c) c.focus(); }, 30);
    return d;
  }

  /* K3 : un nouvel appareil, des cles SANS phrase. Il reste : une passkey
     (s'il y en a une), recevoir ses cles d'un appareil ouvert, ou
     regenerer — et on dit franchement ce que ce dernier coute. */
  function dialogueSansCopie(o) {
    var d = dialogueCommun("cles-dialogue",
      '<div class="sf-tete"><h2>Tes clés ne sont pas sur cet appareil</h2></div>' +
      '<p>Tu n\u2019as pas de phrase de récupération : tes clés vivent sur l\u2019appareil où tu les as créées' +
      '<span class="cles-sc-pk" hidden>, et dans ta passkey</span>.</p>' +
      '<div class="edt-boutons cles-sc-choix">' +
      '<button type="button" class="btn btn-accent cles-sc-passkey" hidden>Déverrouiller par un geste</button>' +
      '<button type="button" class="btn cles-sc-recevoir">Recevoir mes clés ici</button>' +
      '</div>' +
      '<p class="etat etat-erreur cles-erreur" hidden></p>' +
      '<p class="c-note">Plus aucun de ces appareils ? <button type="button" class="lien-bouton cles-regenerer">Régénérer mes clés</button> — tes messages chiffrés jusqu\u2019ici seront perdus pour toi, sauf ce qu\u2019un contact te rendra.</p>' +
      '<div class="edt-boutons"><button type="button" class="btn cles-annuler">' + (o.annuler || "Plus tard") + '</button></div>');
    var q = function (s) { return d.querySelector(s); };
    if (Passkeys.supporte()) trousseau.chargerPasskeys().then(function (l) {
      if (l.length && d.isConnected) { q(".cles-sc-passkey").hidden = false; q(".cles-sc-pk").hidden = false; }
    });
    q(".cles-sc-passkey").addEventListener("click", function () {
      var err = q(".cles-erreur"); err.hidden = true;
      trousseau.ouvrirParPasskey().then(function () { fermerDialogueGrp(d); d.remove(); if (o.surOk) o.surOk(); },
        function (e) { err.textContent = e.message || "Échec."; err.hidden = false; });
    });
    q(".cles-sc-recevoir").addEventListener("click", function () {
      fermerDialogueGrp(d); d.remove();
      dialogueRecevoir({ surOk: o.surOk, surPhrase: function () { dialogueSansCopie(o); } });
    });
    q(".cles-annuler").addEventListener("click", function () { fermerDialogueGrp(d); d.remove(); if (o.surAnnule) o.surAnnule(); });
    q(".cles-regenerer").addEventListener("click", function () {
      if (!confirm("Régénérer tes clés ? Les messages chiffrés jusqu\u2019ici ne seront plus lisibles pour toi, sauf ceux qu\u2019un contact te rendra.")) return;
      fermerDialogueGrp(d); d.remove();
      if (o.surRegenerer) o.surRegenerer();
    });
    ouvrirDialogueGrp(d);
    return d;
  }

  /* K3 : regenerer SANS phrase — de nouvelles cles, rien a noter, et la
     sauvegarde se propose ensuite comme a la premiere fois. Sans la
     migration K3, l'ancien chemin (une nouvelle phrase d'abord). */
  function regenererSansPhrase(surFini) {
    trousseau.creerSansPhrase().then(function () { if (surFini) surFini(); }, function (e) {
      if (e && e.indisponible) { regenererCles(surFini); return; }
      direGrp((e && e.message) || "Impossible de créer des clés.", "erreur");
    });
  }

  /* K3 : noter (ou changer) sa phrase sans l'ancienne. Les octets de la cle
     viennent de cet appareil ou d'une passkey ; s'il n'y a ni l'un ni
     l'autre, on revient a l'ancien chemin (l'ancienne phrase d'abord). */
  function noterPhrase(surFini) {
    var changer = !!(trousseau.copie && trousseau.publique && Number(trousseau.copie.version) === Number(trousseau.publique.version));
    trousseau.brouillonNouvellePhrase().then(function (b) {
      dialoguePhrase({ titre: changer ? "Ta nouvelle phrase" : "Ta phrase de récupération", mots: b.mots, phrase: b.phrase,
                       intro: changer ? "La même clé, une nouvelle phrase : l\u2019ancienne ne vaudra plus rien."
                                      : "Douze mots qui rouvrent tes messages privés sur n\u2019importe quel appareil, même si tu perds tous les autres. Note-les hors ligne, ou télécharge-les — puis on te demandera trois mots.",
                       surConfirme: function () { return trousseau.deposerPhrase(b); }, surFini: surFini });
    }, function (e) {
      if (e && /phrase requise/.test(e.message) && changer) { changerPhrase(surFini); return; }
      direGrp((e && e.message) || "Impossible de préparer une phrase ici.", "erreur");
    });
  }

  /* La premiere fois : ce que ca change, puis la phrase. `surFini` apres
     publication ; `surPlusTard` si la personne ne veut pas maintenant. */
  function dialoguePremiereFois(o) {
    var d = dialogueCommun("cles-dialogue",
      '<div class="sf-tete"><h2>Tes messages privés vont être chiffrés de bout en bout</h2></div>' +
      '<p>Ils ne seront lisibles que sur tes appareils et ceux de ton contact : ni le site, ni la base, ni l\u2019administrateur ne pourront les lire. ' +
      'Pour les retrouver sur un autre appareil, ou si tu changes de navigateur, il te faudra une <strong>phrase de récupération</strong> : douze mots, à noter maintenant, qu\u2019on ne te remontrera pas. ' +
      '<strong>Sans elle, les messages chiffrés seront perdus</strong> pour toi.</p>' +
      '<p class="c-note">Ce qui change : la recherche et l\u2019aperçu se font dans ton navigateur ; une notification ne montre plus le texte ; signaler un message transmet à l\u2019administrateur ce que tu déchiffres. <a href="/donnees.html#chiffrement">Le détail</a>.</p>' +
      '<div class="edt-boutons"><button type="button" class="btn btn-accent cles-creer">Créer mes clés</button>' +
      '<button type="button" class="btn cles-annuler">' + (o.annuler || "Plus tard") + '</button></div>');
    var q = function (s) { return d.querySelector(s); };
    q(".cles-creer").addEventListener("click", function () {
      q(".cles-creer").disabled = true;
      trousseau.brouillon().then(function (b) {
        fermerDialogueGrp(d); d.remove();
        dialoguePhrase({ mots: b.mots, phrase: b.phrase, intro: "Voici ta phrase. Note-la sur un papier, copie-la dans un gestionnaire de mots de passe, ou télécharge-la — puis on te demandera trois mots.",
                         surConfirme: function () { return trousseau.publier(b); }, surFini: o.surFini, surAnnule: o.surPlusTard });
      }, function () { q(".cles-creer").disabled = false; direGrp("Impossible de créer des clés sur ce navigateur.", "erreur"); });
    });
    q(".cles-annuler").addEventListener("click", function () { fermerDialogueGrp(d); d.remove(); if (o.surPlusTard) o.surPlusTard(); });
    ouvrirDialogueGrp(d);
    return d;
  }
  /* Regenerer (phrase perdue) : comme la premiere fois, sans le discours. */
  function regenererCles(surFini) {
    trousseau.brouillon().then(function (b) {
      dialoguePhrase({ titre: "Ta nouvelle phrase de récupération", mots: b.mots, phrase: b.phrase,
                       intro: "De nouvelles clés, et une nouvelle phrase. Tes contacts verront que tes clés ont changé et pourront te rendre l\u2019historique après t\u2019avoir vérifié.",
                       surConfirme: function () { return trousseau.publier(b); }, surFini: surFini });
    }, function () { direGrp("Impossible de créer des clés sur ce navigateur.", "erreur"); });
  }
  /* Changer de phrase : l'ancienne d'abord. */
  function changerPhrase(surFini) {
    var d = dialogueCommun("cles-dialogue",
      '<div class="sf-tete"><h2>Changer ma phrase</h2></div>' +
      '<p class="c-note">Entre d\u2019abord ta phrase actuelle : elle seule ouvre la copie de ta clé.</p>' +
      '<textarea class="cles-phrase" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>' +
      '<p class="etat etat-erreur cles-erreur" hidden></p>' +
      '<div class="edt-boutons"><button type="button" class="btn btn-accent cles-ok">Continuer</button><button type="button" class="btn cles-annuler">Annuler</button></div>');
    var q = function (s) { return d.querySelector(s); };
    q(".cles-annuler").addEventListener("click", function () { fermerDialogueGrp(d); d.remove(); });
    q(".cles-ok").addEventListener("click", function () {
      var a = Ch.analyserPhrase(q(".cles-phrase").value), err = q(".cles-erreur");
      if (!a.ok) { err.textContent = "Douze mots de la liste, s\u2019il te plaît."; err.hidden = false; return; }
      q(".cles-ok").disabled = true;
      trousseau.brouillonPhrase(a.canonique).then(function (b) {
        fermerDialogueGrp(d); d.remove();
        dialoguePhrase({ titre: "Ta nouvelle phrase", mots: b.mots, phrase: b.phrase, intro: "La même clé, une nouvelle phrase : l\u2019ancienne ne vaudra plus rien.",
                         surConfirme: function () { return trousseau.publierPhrase(b); }, surFini: surFini });
      }, function (e) { q(".cles-ok").disabled = false; err.textContent = /incorrecte/.test(e.message) ? "Phrase incorrecte." : e.message; err.hidden = false; });
    });
    ouvrirDialogueGrp(d);
  }
  /* Les empreintes, a comparer par un autre moyen. */
  function dialogueEmpreintes(lignes) {
    var d = dialogueCommun("cles-dialogue",
      '<div class="sf-tete"><h2>Vérifier les clés</h2><button type="button" class="btn btn-icone sf-fermer" aria-label="Fermer">×</button></div>' +
      '<p class="c-note">Chaque clé a une empreinte. Comparez-les de vive voix, ou par un autre moyen : si elles sont les mêmes des deux côtés, personne ne s\u2019est mis entre vous.</p>' +
      '<div class="cles-empreintes"></div>');
    var z = d.querySelector(".cles-empreintes");
    lignes.forEach(function (l) {
      var h = document.createElement("h3"); h.textContent = l.qui; z.appendChild(h);
      var p = document.createElement("p"); p.className = "grp-empreinte"; p.textContent = l.empreinte || "pas de clé"; z.appendChild(p);
      if (l.note) { var n = document.createElement("p"); n.className = "c-note"; n.textContent = l.note; z.appendChild(n); }
    });
    d.querySelector(".sf-fermer").addEventListener("click", function () { fermerDialogueGrp(d); d.remove(); });
    fermerAuVoile(d, function () { fermerDialogueGrp(d); d.remove(); });
    ouvrirDialogueGrp(d);
  }

  var dialogueEcrireA = null;
  function ouvrirChoixContactPourEcrire(dire) {
    if (!dialogueEcrireA) {
      dialogueEcrireA = document.createElement("dialog");
      dialogueEcrireA.className = "edt-dialogue sf-dialogue";
      dialogueEcrireA.innerHTML =
        '<div class="sf-tete"><h2>Écrire à un contact</h2>' +
        '<button type="button" class="btn btn-icone sf-fermer" aria-label="Fermer">×</button></div>' +
        '<p class="c-note sf-vide-contacts" hidden>Tu n’as pas encore de contact. <a href="/contacts/">Demander quelqu’un</a>.</p>' +
        '<div class="sf-liste"></div>';
      document.body.appendChild(dialogueEcrireA);
      dialogueEcrireA.querySelector(".sf-fermer").addEventListener("click", function () { fermerDialogueGrp(dialogueEcrireA); });
      fermerAuVoile(dialogueEcrireA);
    }
    var zone = dialogueEcrireA.querySelector(".sf-liste");
    zone.textContent = "";
    listeContacts().then(function (c) {
      dialogueEcrireA.querySelector(".sf-vide-contacts").hidden = c.contacts.length > 0;
      c.contacts.forEach(function (k) {
        var b = document.createElement("button"); b.type = "button"; b.className = "sf-fiche sf-contact";
        b.setAttribute("data-membre", k.membre);
        b.appendChild(avatarGrp(k.pseudo, true)); b.appendChild(document.createTextNode(" " + k.pseudo));
        b.addEventListener("click", function () { fermerDialogueGrp(dialogueEcrireA); ecrireA(k.membre, k.pseudo, dire); });
        zone.appendChild(b);
      });
    });
    ouvrirDialogueGrp(dialogueEcrireA);
  }
  function titreAvecNonLus(n) {
    if (TITRE_SANS_COMPTE === null) TITRE_SANS_COMPTE = document.title.replace(/^\(\d+\+?\) /, "");
    document.title = (n ? "(" + libelleNonLus(n) + ") " : "") + TITRE_SANS_COMPTE;
  }
  /* ---------- les rappels d'une seance ou d'un evenement (lot F) ----------
     Des cases (15 min, 1 h, la veille) ; la valeur envoyee est la liste
     des minutes avant le debut, [60] = une heure avant. La seance dit
     QUAND ; chaque personne dit SI, dans ses parametres. */
  function lireRappels(conteneur) {
    if (!conteneur) return [];
    return Array.prototype.map.call(conteneur.querySelectorAll("input:checked"), function (i) { return Number(i.value); });
  }
  function poserRappels(conteneur, liste) {
    if (!conteneur) return;
    var l = Array.isArray(liste) ? liste.map(Number) : [];
    conteneur.querySelectorAll("input").forEach(function (i) { i.checked = l.indexOf(Number(i.value)) >= 0; });
  }
  function libelleRappel(minutes) {
    var m = Number(minutes);
    if (m <= 0) return "au début";
    if (m < 60) return m + " min avant";
    if (m < 1440) return (m % 60 ? Math.round(m / 6) / 10 : m / 60) + " h avant";
    if (m === 1440) return "la veille";
    return Math.round(m / 1440) + " jours avant";
  }
  function quandGrp(iso, avecHeure) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return avecHeure
      ? d.toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  }
  /* Un avatar : les initiales du pseudo sur une couleur qui lui est propre
     (derivee du nom, donc la meme partout, pour tout le monde). */
  function avatarGrp(pseudo, petit) {
    var a = document.createElement("span");
    a.className = "grp-avatar" + (petit ? " grp-avatar-petit" : "");
    var nom = pseudo || "?";
    var h = 0;
    for (var i = 0; i < nom.length; i++) h = (h * 31 + nom.charCodeAt(i)) % 360;
    a.style.background = "hsl(" + h + " 45% 42%)";
    a.textContent = nom.slice(0, 2).toUpperCase();
    a.title = nom;
    return a;
  }
  function ouvrirDialogueGrp(d) { if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", ""); }
  function fermerDialogueGrp(d) { if (d.open) d.close(); else d.removeAttribute("open"); }
  /* Quitter une fenetre des groupes : sa croix, Echap (le navigateur), et
     un clic sur le voile gris — comme le menu « moi » (U1). Proposition 4
     du 24 septembre : les parametres du groupe n'avaient ni croix ni voile
     qui ferme, seulement un « Annuler » perdu au milieu, sous lequel le
     fondateur voit encore toute la section « Fondation ».
     Le voile ne ferme que si le clic y a COMMENCE : un glisser parti du
     champ (pour selectionner du texte) et relache dehors se termine sur la
     fenetre elle-meme, et ne doit pas jeter ce qu'on tapait. Une fenetre qui
     ne doit pas se quitter ainsi (la phrase de recuperation, le pseudo)
     n'appelle simplement pas ceci. `fermer` : si la fenetre a sa facon a
     elle de se fermer (sinon fermerDialogueGrp). */
  function fermerAuVoile(d, fermer) {
    if (!d || d._voile) return;
    d._voile = true;
    var depuisVoile = false;
    function surVoile(ev) {
      if (ev.target !== d) return false;
      var r = d.getBoundingClientRect();
      return ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom;
    }
    d.addEventListener("pointerdown", function (ev) { depuisVoile = surVoile(ev); });
    d.addEventListener("click", function (ev) {
      var oui = depuisVoile && surVoile(ev);
      depuisVoile = false;
      if (oui) (fermer || fermerDialogueGrp)(d);
    });
  }
  /* les fenetres ecrites dans la page : la croix et le voile */
  ["grp-dialogue-creer", "grp-dialogue-seance", "grp-dialogue-signaler", "grp-dialogue-parametres"].forEach(function (id) {
    var d = document.getElementById(id);
    if (!d) return;
    var croix = d.querySelector(".sf-fermer");
    if (croix) croix.addEventListener("click", function () { fermerDialogueGrp(d); });
    fermerAuVoile(d);
  });

  /* ---------- la fenetre d'invitation (commune aux deux pages) ----------
     Ouverte depuis le « ⋯ » d'une carte (liste) ou « Inviter… » de l'onglet
     Membres (page du groupe). MON lien d'invitation (GET /api/groupes/:id/
     lien ; « Creer un lien » s'il n'y en a pas), a copier ; son code QR,
     dessine ici (svgQR) ; « Partager » quand le navigateur sait le faire
     (navigator.share : telephones, surtout) ; et, en repli, inviter par
     PSEUDO. Un administrateur voit aussi les liens des autres membres, et
     peut les revoquer. Depuis le lot D, tout membre invite si le groupe le
     permet (parametres.inviter = membres) : la base tranche, la fenetre
     dit son refus. `g` = { id, nom, apres? } — `apres` est rappele quand une
     invitation par pseudo a reussi (la page du groupe se relit). */
  var dialogueInvitation = null, groupeInvite = null;
  function ouvrirInvitation(g) {
    groupeInvite = g;
    if (!dialogueInvitation) {
      dialogueInvitation = document.createElement("dialog");
      dialogueInvitation.className = "edt-dialogue sf-dialogue grp-dialogue-invitation";
      dialogueInvitation.innerHTML =
        '<div class="sf-tete"><h2 class="inv-titre">Inviter</h2>' +
        '<button type="button" class="btn btn-icone sf-fermer" aria-label="Fermer">×</button></div>' +
        '<p class="c-note">Un lien à envoyer n’importe où — ou à faire scanner. Qui l’ouvre crée un compte s’il le faut, et rejoint le groupe d’un clic. Valable 7 jours, 50 usages. Le lien est à ton nom : la page d’invitation dit que c’est toi qui invites.</p>' +
        '<div class="etat inv-etat" hidden></div>' +
        '<div class="inv-sans" hidden><p><button type="button" class="btn btn-accent inv-creer">Créer mon lien</button></p></div>' +
        '<div class="inv-avec" hidden>' +
        '<div class="inv-qr"></div>' +
        '<div class="grp-lien-actif"><input type="text" class="inv-url" readonly aria-label="Lien d’invitation">' +
        '<button type="button" class="btn btn-petit inv-copier">Copier</button>' +
        '<button type="button" class="btn btn-petit btn-accent inv-partager" hidden>Partager</button></div>' +
        '<p class="c-note inv-detail"></p>' +
        '<p><button type="button" class="btn btn-mini inv-nouveau">Nouveau lien</button> ' +
        '<button type="button" class="btn btn-mini inv-revoquer">Révoquer</button></p>' +
        '</div>' +
        '<div class="inv-autres" hidden><h3>Liens des autres membres</h3><ul class="inv-autres-liste"></ul></div>' +
        '<form class="inv-pseudo"><label for="inv-pseudo-champ">Ou inviter par son pseudo</label>' +
        '<div class="grp-lien-actif"><input type="text" id="inv-pseudo-champ" class="inv-pseudo-champ" maxlength="20" required autocapitalize="off" spellcheck="false" placeholder="pseudo">' +
        '<button type="submit" class="btn btn-petit btn-accent">Inviter</button></div>' +
        '<p class="c-note">La personne accepte depuis sa page Groupes.</p></form>';
      document.body.appendChild(dialogueInvitation);
      var q = function (sel) { return dialogueInvitation.querySelector(sel); };
      q(".sf-fermer").addEventListener("click", function () { fermerDialogueGrp(dialogueInvitation); });
      fermerAuVoile(dialogueInvitation);
      q(".inv-creer").addEventListener("click", creerLienInvitation);
      q(".inv-nouveau").addEventListener("click", creerLienInvitation);
      q(".inv-revoquer").addEventListener("click", function () {
        appelGrp("DELETE", "/api/groupes/" + encodeURIComponent(groupeInvite.id) + "/lien").then(function (x) {
          if (!x.ok) { direInv(x.d.erreur || "Échec.", "erreur"); return; }
          peindreInvitation(null); direInv("Lien révoqué : il ne mène plus nulle part.", "info");
        }).catch(function () { direInv("Service indisponible.", "erreur"); });
      });
      q(".inv-copier").addEventListener("click", function () {
        var url = q(".inv-url").value, fini = function () { direInv("Lien copié.", "succes"); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(fini, fini);
        else { q(".inv-url").select(); try { document.execCommand("copy"); } catch (e) {} fini(); }
      });
      q(".inv-partager").addEventListener("click", function () {
        var url = q(".inv-url").value;
        if (!navigator.share) return;
        navigator.share({ title: "Rejoindre « " + groupeInvite.nom + " »", text: "Rejoins mon groupe de révision « " + groupeInvite.nom + " » :", url: url }).catch(function () {});
      });
      q(".inv-pseudo").addEventListener("submit", function (ev) {
        ev.preventDefault();
        var champ = q(".inv-pseudo-champ"), pseudo = champ.value.trim();
        if (!pseudo) return;
        appelGrp("POST", "/api/groupes/" + encodeURIComponent(groupeInvite.id) + "/membres", { pseudo: pseudo }).then(function (x) {
          if (!x.ok) { direInv(x.d.erreur || "Échec.", "erreur"); return; }
          champ.value = "";
          direInv(x.d.note || "Invité.", "succes");
          if (typeof groupeInvite.apres === "function") groupeInvite.apres();
        }).catch(function () { direInv("Service indisponible.", "erreur"); });
      });
    }
    dialogueInvitation.querySelector(".inv-titre").textContent = "Inviter dans « " + g.nom + " »";
    dialogueInvitation.querySelector(".inv-sans").hidden = true;
    dialogueInvitation.querySelector(".inv-avec").hidden = true;
    dialogueInvitation.querySelector(".inv-autres").hidden = true;
    direInv("", "");
    ouvrirDialogueGrp(dialogueInvitation);
    chargerLienInvitation();
  }
  function chargerLienInvitation() {
    appelGrp("GET", "/api/groupes/" + encodeURIComponent(groupeInvite.id) + "/lien").then(function (x) {
      if (!x.ok) { direInv(x.d.erreur || "Service indisponible.", x.d.indisponible ? "info" : "erreur"); return; }
      peindreInvitation(x.d.lien);
      peindreAutresLiens(x.d.autres || []);
    }).catch(function () { direInv("Service indisponible.", "erreur"); });
  }
  function direInv(texte, type) {
    var z = dialogueInvitation.querySelector(".inv-etat");
    z.textContent = texte; z.className = "etat inv-etat" + (type ? " etat-" + type : ""); z.hidden = !texte;
  }
  function creerLienInvitation() {
    appelGrp("POST", "/api/groupes/" + encodeURIComponent(groupeInvite.id) + "/lien").then(function (x) {
      if (!x.ok) { direInv(x.d.erreur || "Échec.", "erreur"); return; }
      direInv("", ""); peindreInvitation(x.d.lien);
    }).catch(function () { direInv("Service indisponible.", "erreur"); });
  }
  function detailLien(l) {
    var exp = l.expire_le ? new Date(l.expire_le) : null;
    return (exp ? "jusqu'au " + exp.toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) + " · " : "")
      + l.usages + "/" + l.usages_max + " usage" + (l.usages_max > 1 ? "s" : "");
  }
  function peindreInvitation(l) {
    var q = function (sel) { return dialogueInvitation.querySelector(sel); };
    q(".inv-sans").hidden = !!l;
    q(".inv-avec").hidden = !l;
    if (!l) return;
    q(".inv-url").value = l.url;
    q(".inv-detail").textContent = detailLien(l);
    q(".inv-partager").hidden = !(navigator.share);
    var zoneQr = q(".inv-qr"); zoneQr.textContent = "";
    var svg = svgQR(l.url, 200);
    if (svg) zoneQr.appendChild(svg);
  }
  /* les liens des autres membres : la base ne les rend qu'a un administrateur */
  function peindreAutresLiens(autres) {
    var zone = dialogueInvitation.querySelector(".inv-autres");
    var ul = zone.querySelector(".inv-autres-liste");
    ul.textContent = "";
    zone.hidden = !autres.length;
    autres.forEach(function (l) {
      var li = document.createElement("li");
      var t = document.createElement("span");
      t.textContent = (l.pseudo || "compte supprimé") + " · " + detailLien(l);
      li.appendChild(t);
      var b = document.createElement("button"); b.type = "button"; b.className = "lien-bouton inv-revoquer-autre"; b.textContent = "révoquer";
      b.setAttribute("data-code", l.code);
      b.addEventListener("click", function () {
        appelGrp("DELETE", "/api/groupes/" + encodeURIComponent(groupeInvite.id) + "/lien?code=" + encodeURIComponent(l.code)).then(function (x) {
          if (!x.ok) { direInv(x.d.erreur || "Échec.", "erreur"); return; }
          direInv("Lien de " + (l.pseudo || "ce membre") + " révoqué.", "info"); chargerLienInvitation();
        }).catch(function () { direInv("Service indisponible.", "erreur"); });
      });
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  /* ---------- la liste ---------- */
  var listeGrp = document.getElementById("grp-liste");
  if (listeGrp) {
    var dialogueCreer = document.getElementById("grp-dialogue-creer");

    /* ---------- le « ⋯ » d'une carte, la selection, l'invitation ----------
       Chaque carte porte un « ⋯ » : Inviter (administrateurs : la fenetre
       d'invitation — lien a copier, code QR, Partager), Selectionner,
       Quitter, Supprimer (administrateurs). « Selectionner » ouvre le
       mode selection, comme dans la discussion : une case par carte, la
       carte entiere la bascule, une barre au-dessus (« 2 selectionnes ·
       Retirer · Annuler »), Echap pour sortir. « Retirer » supprime les
       groupes dont on est administrateur et quitte les autres — la
       confirmation le dit en clair. */
    var selectionGrp = null;   /* null, ou { ids: {id: true} } */
    var groupesConnus = [];    /* la derniere liste peinte */
    function commencerSelection(id) {
      selectionGrp = { ids: {} };
      if (id) selectionGrp.ids[id] = true;
      peindreGroupes({ groupes: groupesConnus, invitations: invitationsConnues });
    }
    function quitterSelectionGrp() {
      if (!selectionGrp) return;
      selectionGrp = null;
      peindreGroupes({ groupes: groupesConnus, invitations: invitationsConnues });
    }
    function peindreBarreSelection() {
      var n = selectionGrp ? Object.keys(selectionGrp.ids).length : 0;
      document.getElementById("grp-selection").hidden = !selectionGrp;
      document.getElementById("grp-selection-compte").textContent = n + " sélectionné" + (n > 1 ? "s" : "");
      document.getElementById("grp-selection-retirer").disabled = !n;
    }
    document.getElementById("grp-selection-annuler").addEventListener("click", quitterSelectionGrp);
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") quitterSelectionGrp(); });
    document.getElementById("grp-selection-retirer").addEventListener("click", function () {
      if (!selectionGrp) return;
      var choisis = groupesConnus.filter(function (g) { return selectionGrp.ids[g.id]; });
      if (!choisis.length) return;
      /* supprimer : les groupes dont je suis FONDATEUR (seul lui peut, lot
         D) ; quitter : les autres — un administrateur non fondateur quitte */
      var aSupprimer = choisis.filter(function (g) { return estFondateur(g); });
      var aQuitter = choisis.filter(function (g) { return !estFondateur(g); });
      var phrases = [];
      if (aSupprimer.length) phrases.push("supprimer " + aSupprimer.length + " groupe" + (aSupprimer.length > 1 ? "s" : "") + " dont tu es fondateur (" + aSupprimer.map(function (g) { return g.nom; }).join(", ") + ") — pour tous ses membres, sans retour");
      if (aQuitter.length) phrases.push("quitter " + aQuitter.length + " groupe" + (aQuitter.length > 1 ? "s" : "") + " (" + aQuitter.map(function (g) { return g.nom; }).join(", ") + ")");
      if (!window.confirm("Tu vas " + phrases.join(", et ") + ". Continuer ?")) return;
      retirerGroupes(aSupprimer, aQuitter);
    });
    /* supprime les uns, quitte les autres ; un seul rechargement a la fin,
       et chaque refus est dit (le dernier administrateur ne peut pas partir) */
    function retirerGroupes(aSupprimer, aQuitter) {
      var appels = aSupprimer.map(function (g) {
        return appelGrp("DELETE", "/api/groupes/" + encodeURIComponent(g.id)).then(function (x) { return { g: g, x: x }; });
      }).concat(aQuitter.map(function (g) {
        return appelGrp("DELETE", "/api/groupes/" + encodeURIComponent(g.id) + "/membres").then(function (x) { return { g: g, x: x }; });
      }));
      direGrp("Un instant…", "info");
      Promise.all(appels).then(function (res) {
        var refus = res.filter(function (r) { return !r.x.ok; });
        selectionGrp = null;
        if (refus.length) direGrp(refus.map(function (r) { return r.g.nom + " : " + (r.x.d.erreur || "échec"); }).join(" · "), "erreur");
        else direGrp(res.length > 1 ? "C'est fait." : (aSupprimer.length ? "Groupe supprimé." : (aQuitter[0] && aQuitter[0].prive ? "Tu as quitté la conversation." : "Tu as quitté le groupe.")), "succes");
        chargerGroupes();
      }).catch(function () { direGrp("Service indisponible.", "erreur"); });
    }
    /* le nom qu'on affiche : celui du groupe, ou — conversation privee —
       le pseudo de l'autre */
    function nomDe(g) { return g.prive ? (g.avec ? g.avec.pseudo : "Conversation privée") : g.nom; }
    function quitterGroupe(g) {
      if (g.prive) {
        if (!window.confirm("Quitter la conversation avec " + nomDe(g) + " ? Elle disparaît pour toi ; ce que tu y as écrit reste lisible de l'autre.")) return;
      } else if (!window.confirm("Quitter « " + g.nom + " » ? Tu ne verras plus sa discussion ni ses séances.")) return;
      retirerGroupes([], [g]);
    }
    function supprimerGroupe(g) {
      if (!window.confirm("Supprimer « " + g.nom + " » pour tous ses membres ? Discussion et séances disparaissent, sans retour.")) return;
      retirerGroupes([g], []);
    }
    /* « fondateur » vient de la route (lot D) ; une reponse d'avant la
       migration n'en a pas : on se rabat sur « administrateur » */
    function estFondateur(g) { return g.fondateur === undefined ? g.mon_role === "admin" : !!g.fondateur; }
    function peutInviter(g) { return g.peut_inviter === undefined ? g.mon_role === "admin" : !!g.peut_inviter; }
    function menuCarte(bouton, g) {
      var entrees = [];
      /* une conversation privee : on la quitte, c'est tout (pas
         d'invitation, pas de suppression pour l'autre — la base le tient) */
      if (g.prive) {
        entrees.push({ libelle: "Quitter la conversation", danger: true, action: function () { quitterGroupe(g); } });
        menuFlottant.ouvrir(bouton, entrees);
        return;
      }
      if (peutInviter(g)) entrees.push({ libelle: "Inviter…", action: function () { ouvrirInvitation(g); } });
      entrees.push({ libelle: "Sélectionner", action: function () { commencerSelection(g.id); } });
      if (!estFondateur(g)) entrees.push({ libelle: "Quitter le groupe", action: function () { quitterGroupe(g); } });
      if (estFondateur(g)) entrees.push({ libelle: "Supprimer le groupe", danger: true, action: function () { supprimerGroupe(g); } });
      menuFlottant.ouvrir(bouton, entrees);
    }

    /* la conversation ouverte sur cette page (groupe.html?id=…), pour la
       marquer dans la liste ; rien sur la liste seule */
    var idCourant = document.getElementById("grp-titre") ? (new URLSearchParams(location.search).get("id") || "") : "";

    /* « 14:02 » aujourd'hui, « hier », « lun. » cette semaine, « 12 sept. » */
    function heureCourte(iso) {
      if (!iso) return "";
      var d = new Date(iso), now = new Date();
      if (isNaN(d)) return "";
      if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      var hier = new Date(now); hier.setDate(now.getDate() - 1);
      if (d.toDateString() === hier.toDateString()) return "hier";
      if (now - d < 6 * 86400000) return d.toLocaleDateString("fr-FR", { weekday: "short" });
      return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    }
    /* l'avatar d'un groupe : les initiales de ses deux premiers mots */
    function avatarGroupe(nom) {
      var mots = String(nom || "?").split(/\s+/).filter(Boolean);
      var a = avatarGrp(nom);
      a.textContent = (mots.length > 1 ? mots[0][0] + mots[1][0] : String(nom || "?").slice(0, 2)).toUpperCase();
      a.classList.add("grp-avatar-groupe");
      return a;
    }
    /* une ligne : avatar | nom + apercu | heure + non-lus + ⋯ */
    function ligneBase(classe, avatar, nom, apercu, fin) {
      var l = document.createElement("div"); l.className = "msg-ligne " + classe;
      l.appendChild(avatar);
      var corps = document.createElement("div"); corps.className = "msg-ligne-corps";
      var h1 = document.createElement("div"); h1.className = "msg-ligne-haut";
      var n = document.createElement("span"); n.className = "msg-ligne-nom"; n.textContent = nom; h1.appendChild(n);
      if (fin && fin.heure) { var h = document.createElement("span"); h.className = "msg-ligne-heure"; h.textContent = fin.heure; h1.appendChild(h); }
      corps.appendChild(h1);
      var h2 = document.createElement("div"); h2.className = "msg-ligne-bas";
      var ap = document.createElement("span"); ap.className = "msg-ligne-apercu"; ap.textContent = apercu || ""; h2.appendChild(ap);
      if (fin && fin.droite) fin.droite.forEach(function (x) { if (x) h2.appendChild(x); });
      corps.appendChild(h2);
      l.appendChild(corps);
      l.setAttribute("data-recherche", (nom + " " + (apercu || "")).toLowerCase());
      return l;
    }
    function carteGroupe(g) {
      var prive = !!g.prive, nom = nomDe(g);
      /* l'apercu : « pseudo : texte » dans un groupe ; en prive, l'autre
         est le seul a ecrire a part moi — « toi : » sur les miens, rien
         sur les siens ; chiffre (lot H, session 2) : « 🔒 message chiffré »
         tant que la page ne l'a pas dechiffre (dechiffrerApercus) */
      var dernierTexte = g.dernier ? (g.dernier.chiffre ? (g.dernier.clair || "🔒 message chiffré") : g.dernier.texte) : "";
      var apercu = g.dernier && dernierTexte
        ? (prive ? (g.dernier.mien ? "toi : " : "") : (g.dernier.pseudo ? g.dernier.pseudo + " : " : "")) + dernierTexte.replace(/\s+/g, " ")
        : (prive ? (g.avec ? "Conversation privée" : "L’autre personne a quitté la conversation")
                 : (g.description || g.membres + " membre" + (g.membres > 1 ? "s" : "")));
      var nl = pastilleNonLus(Number(g.non_lus) || 0, "dans " + nom);
      var menu = null;
      if (!selectionGrp) {
        menu = document.createElement("button"); menu.type = "button"; menu.className = "msg-ligne-menu";
        menu.textContent = "⋯"; menu.setAttribute("aria-label", "Actions sur " + nom); menu.title = "Actions";
        menu.addEventListener("click", function (ev) { ev.preventDefault(); ev.stopPropagation(); menuCarte(menu, g); });
      }
      var l = ligneBase("msg-ligne-groupe" + (prive ? " msg-ligne-privee" : "") + (g.non_lus ? " msg-ligne-non-lue" : "") + (g.id === idCourant ? " est-active" : ""),
        prive ? avatarGrp(nom) : avatarGroupe(g.nom), nom, apercu, { heure: heureCourte(g.dernier_message || (g.dernier && g.dernier.le)), droite: [nl, menu] });
      l.setAttribute("data-groupe", g.id);
      if (prive) l.setAttribute("data-prive", "");
      if (g.mon_role === "admin") l.setAttribute("data-role-groupe", estFondateur(g) ? "fondateur" : "admin");
      /* la selection ne vaut que pour les groupes (son volet) */
      if (selectionGrp && !prive) {
        l.classList.add("msg-ligne-selectionnable");
        if (selectionGrp.ids[g.id]) l.classList.add("est-selectionnee");
        var case_ = document.createElement("input"); case_.type = "checkbox"; case_.className = "grp-carte-case msg-ligne-case";
        case_.checked = !!selectionGrp.ids[g.id]; case_.setAttribute("aria-label", "Sélectionner " + g.nom);
        l.insertBefore(case_, l.firstChild);
        l.addEventListener("click", function () {
          if (selectionGrp.ids[g.id]) delete selectionGrp.ids[g.id]; else selectionGrp.ids[g.id] = true;
          l.classList.toggle("est-selectionnee", !!selectionGrp.ids[g.id]);
          case_.checked = !!selectionGrp.ids[g.id];
          peindreBarreSelection();
        });
        case_.addEventListener("click", function (ev) { ev.stopPropagation(); l.click(); });
        return l;
      }
      /* toute la ligne mene a la conversation (un lien pour le clavier et
         l'ouverture dans un onglet) */
      var a = document.createElement("a"); a.className = "msg-ligne-lien"; a.href = "groupe.html?id=" + encodeURIComponent(g.id);
      a.setAttribute("aria-label", "Ouvrir " + g.nom);
      l.insertBefore(a, l.firstChild);
      return l;
    }
    function carteInvitation(g) {
      var ok = document.createElement("button"); ok.type = "button"; ok.className = "btn btn-mini btn-accent"; ok.textContent = "Accepter";
      var non = document.createElement("button"); non.type = "button"; non.className = "btn btn-mini"; non.textContent = "Décliner";
      ok.addEventListener("click", function () { repondre(g.id, true); });
      non.addEventListener("click", function () { repondre(g.id, false); });
      var l = ligneBase("msg-ligne-invitation", avatarGroupe(g.nom), g.nom,
        (g.invite_par ? g.invite_par + " t'invite" : "Tu es invité") + (g.description ? " · " + g.description : ""), { droite: [] });
      var actions = document.createElement("div"); actions.className = "msg-ligne-actions";
      actions.appendChild(ok); actions.appendChild(non);
      l.querySelector(".msg-ligne-corps").appendChild(actions);
      return l;
    }
    /* la pastille d'un volet : le nombre de conversations de ce volet ou
       il reste a lire */
    function pastilleVolet(id, liste) {
      var p = document.getElementById(id);
      if (!p) return;
      var n = liste.filter(function (g) { return (Number(g.non_lus) || 0) > 0; }).length;
      p.hidden = !n; p.textContent = n ? String(n) : "";
      p.title = n ? n + " conversation" + (n > 1 ? "s" : "") + " avec des messages non lus" : "";
    }
    var voletChoisi = false;   /* la personne a cliqué un volet : on ne le change plus pour elle */
    function peindreGroupes(d) {
      var note = document.getElementById("grp-note"), notePrives = document.getElementById("msg-prives-note");
      var listePrives = document.getElementById("msg-liste-prives");
      listeGrp.textContent = "";
      if (listePrives) listePrives.textContent = "";
      var inv = document.getElementById("grp-invitations");
      var li_ = document.getElementById("grp-liste-invitations");
      li_.textContent = "";
      if (d.indisponible) {
        note.textContent = d.erreur || "Pas encore ouvert.";
        if (notePrives) notePrives.textContent = d.erreur || "Pas encore ouvert.";
        inv.hidden = true; return;
      }
      groupesConnus = d.groupes || []; invitationsConnues = d.invitations || [];
      /* les groupes d'un cote, les conversations privees (lot H) de l'autre */
      var groupes = groupesConnus.filter(function (g) { return !g.prive; });
      var prives = groupesConnus.filter(function (g) { return !!g.prive; });
      /* le titre de l'onglet et la pastille de l'en-tete : depuis la liste
         seule — la page d'un groupe a son propre titre */
      if (!idCourant) titreListeGrp(d);
      poserPastilleEnTete(conversationsNonLues(d));
      pastilleVolet("msg-groupes-pastille", groupes);
      pastilleVolet("msg-prives-pastille", prives);
      (d.invitations || []).forEach(function (g) { li_.appendChild(carteInvitation(g)); });
      inv.hidden = !(d.invitations || []).length;
      /* une selection qui ne vise plus rien (groupes partis) se ferme */
      if (selectionGrp) Object.keys(selectionGrp.ids).forEach(function (id) { if (!groupes.some(function (g) { return g.id === id; })) delete selectionGrp.ids[id]; });
      if (selectionGrp && !groupes.length) selectionGrp = null;
      peindreBarreSelection();
      note.textContent = groupes.length ? "" : "Aucun groupe pour l'instant.";
      groupes.forEach(function (g) { listeGrp.appendChild(carteGroupe(g)); });
      if (listePrives) {
        notePrives.textContent = prives.length ? "" : "Aucune conversation privée. Écris à un contact : le bouton ci-dessus, ou ⋯ → Écrire dans le volet Contacts.";
        prives.forEach(function (g) { listePrives.appendChild(carteGroupe(g)); });
        dechiffrerApercus(d, prives);
        /* la conversation ouverte est privee : son volet, pour qu'on la
           voie marquee dans la liste — une fois, et pas contre un choix */
        if (idCourant && !voletChoisi && prives.some(function (g) { return g.id === idCourant; })) ouvrirVolet("prives");
      }
      filtrerListes();
      if (!idCourant) proposerNotifs(document.getElementById("grp-note"));
    }
    /* ---------- les apercus chiffres (lot H, session 2) ----------
       Le dernier message d'une conversation chiffree arrive chiffre : on
       ouvre mon enveloppe (avec ma privee et la publique de qui l'a faite),
       on dechiffre, on remplace « 🔒 message chiffré » dans la ligne. Sans
       ma privee sur cet appareil, une note propose d'entrer la phrase. */
    var clesConvListe = {};   /* groupe → { version → CryptoKey } */
    function dechiffrerApercus(d, prives) {
      var aDechiffrer = prives.filter(function (g) { return g.dernier && g.dernier.chiffre; });
      var noteCles = document.getElementById("msg-prives-cles");
      if (!aDechiffrer.length) { if (noteCles) noteCles.hidden = true; return; }
      if (!chiffrementDisponible()) return;
      trousseau.charger().then(function (tr) {
        if (noteCles) noteCles.hidden = tr.statut !== "verrouillee";
        /* K3 : la ligne « aucune sauvegarde » du volet Prives */
        if (tr.statut === "ok") trousseau.etatSauvegardes().then(function (s) {
          var z = document.getElementById("msg-prives-sauvegarde");
          if (z) z.hidden = !!s.sures;
        }).catch(function () {});
        if (tr.statut !== "ok") return;
        aDechiffrer.forEach(function (g) {
          var env = (g.enveloppes || []).filter(function (e) { return Number(e.version) === Number(g.dernier.cle_version); })[0];
          if (!env) return;
          var promesseCle;
          if (clesConvListe[g.id] && clesConvListe[g.id][env.version]) promesseCle = Promise.resolve(clesConvListe[g.id][env.version]);
          else {
            var jwkPar = ((d.cles || {})[env.par] || []).filter(function (c) { return Number(c.version) === Number(env.par_version); })[0];
            if (!jwkPar) return;
            promesseCle = Ch.ouvrirEnveloppe(env, tr.identite.privee, jwkPar.cle, { groupe: g.id, version: env.version, membre: tr.moi.id, membre_version: env.membre_version, par: env.par, par_version: env.par_version })
              .then(function (brut) { return Ch.importerCleConversation(brut); })
              .then(function (cle) { clesConvListe[g.id] = clesConvListe[g.id] || {}; clesConvListe[g.id][env.version] = cle; return cle; });
          }
          promesseCle.then(function (cle) {
            return Ch.dechiffrerMessage(cle, g.dernier.chiffre, { groupe: g.id, auteur: g.dernier.auteur, cle_version: g.dernier.cle_version });
          }).then(function (clair) {
            g.dernier.clair = clair.t;
            var ligne = document.querySelector('#msg-liste-prives .msg-ligne[data-groupe="' + g.id + '"]');
            if (!ligne) return;
            var ap = ligne.querySelector(".msg-ligne-apercu");
            ap.textContent = (g.dernier.mien ? "toi : " : "") + clair.t.replace(/\s+/g, " ");
            ligne.setAttribute("data-recherche", (nomDe(g) + " " + clair.t).toLowerCase());
          }).catch(function () { /* cle absente, enveloppe illisible : « 🔒 » reste */ });
        });
      });
    }
    document.addEventListener("cles-changees", function () { chargerGroupes(); });
    var boutonPasskeyListe = document.getElementById("msg-prives-passkey");
    if (boutonPasskeyListe) {
      if (Passkeys.supporte()) trousseau.chargerPasskeys().then(function (liste) { if (liste.length) boutonPasskeyListe.hidden = false; });
      boutonPasskeyListe.addEventListener("click", function () {
        direGrp("Un instant\u2026", "info");
        trousseau.ouvrirParPasskey().then(function () { direGrp("", ""); chargerGroupes(); },
                                         function (e) { direGrp(e.message || "Échec.", "erreur"); });
      });
    }
    var boutonLierListe = document.getElementById("msg-prives-lier");
    if (boutonLierListe) boutonLierListe.addEventListener("click", function () {
      dialogueRecevoir({ surOk: function () { chargerGroupes(); },
                         surPhrase: function () { dialogueDeverrouiller({ surOk: function () { chargerGroupes(); }, surRegenerer: function () { regenererCles(function () { chargerGroupes(); }); } }); } });
    });
    var boutonDeverrouillerListe = document.getElementById("msg-prives-deverrouiller");
    if (boutonDeverrouillerListe) boutonDeverrouillerListe.addEventListener("click", function () {
      dialogueDeverrouiller({ surOk: function () { chargerGroupes(); }, surRegenerer: function () { regenererCles(function () { chargerGroupes(); }); } });
    });

    /* la recherche : filtre les lignes des deux volets sur nom + apercu */
    var champRecherche = document.getElementById("msg-recherche");
    function filtrerListes() {
      var q = champRecherche ? champRecherche.value.trim().toLowerCase() : "";
      document.querySelectorAll("#msg-cote .msg-ligne").forEach(function (l) {
        l.hidden = !!q && (l.getAttribute("data-recherche") || "").indexOf(q) < 0;
      });
    }
    if (champRecherche) champRecherche.addEventListener("input", filtrerListes);
    /* les volets : Groupes / Contacts */
    var boutonsVolets = document.querySelectorAll(".msg-volet-bouton");
    function ouvrirVolet(nom) {
      boutonsVolets.forEach(function (b) { b.classList.toggle("est-actif", b.getAttribute("data-volet") === nom); });
      document.querySelectorAll(".msg-volet").forEach(function (v) { v.hidden = v.getAttribute("data-volet") !== nom; });
      if (nom === "contacts") chargerContactsCote();
    }
    boutonsVolets.forEach(function (b) { b.addEventListener("click", function () { voletChoisi = true; ouvrirVolet(b.getAttribute("data-volet")); }); });
    if (location.hash === "#contacts") { voletChoisi = true; ouvrirVolet("contacts"); }
    if (location.hash === "#prives") { voletChoisi = true; ouvrirVolet("prives"); }
    var boutonEcrireA = document.getElementById("msg-ecrire-a");
    if (boutonEcrireA) boutonEcrireA.addEventListener("click", function () { ouvrirChoixContactPourEcrire(); });
    var videCreer = document.getElementById("msg-vide-creer");
    if (videCreer) videCreer.addEventListener("click", function () { ouvrirDialogueGrp(dialogueCreer); document.getElementById("grp-nom").focus(); });

    /* ---------- le volet Contacts ----------
       Les demandes recues (Accepter / Refuser), mes contacts, les demandes
       envoyees ; une demande par pseudo. Le compte des demandes recues
       sur l'onglet. C'est la meme route que la page /contacts/, qui reste
       pour « tout gerer ». */
    var contactsCotePeints = false;
    function ligneContactCote(k, sous, actions) {
      var l = ligneBase("msg-ligne-contact", avatarGrp(k.pseudo), k.pseudo, sous, { droite: [] });
      if (actions && actions.length) {
        var zone = document.createElement("div"); zone.className = "msg-ligne-actions";
        actions.forEach(function (a) {
          var b = document.createElement("button"); b.type = "button"; b.className = a.accent ? "btn btn-mini btn-accent" : "btn btn-mini";
          b.textContent = a.libelle; b.addEventListener("click", a.action); zone.appendChild(b);
        });
        l.querySelector(".msg-ligne-corps").appendChild(zone);
      }
      return l;
    }
    function chargerContactsCote() {
      contactsCharges = null;   /* les fenetres de choix reliront aussi */
      appelGrp("GET", "/api/contacts").then(function (x) {
        var lr = document.getElementById("msg-liste-recues"), lc = document.getElementById("msg-liste-contacts"), le = document.getElementById("msg-liste-envoyees");
        var note = document.getElementById("msg-contacts-note"), pastille = document.getElementById("msg-contacts-pastille");
        if (!lr) return;
        lr.textContent = ""; lc.textContent = ""; le.textContent = "";
        if (!x.ok) { note.textContent = x.d.indisponible ? (x.d.erreur || "Pas encore ouvert.") : (x.d.erreur || "Service indisponible."); return; }
        var d = x.d;
        (d.recues || []).forEach(function (k) {
          lr.appendChild(ligneContactCote(k, "te demande · " + quandGrp(k.cree_le), [
            { libelle: "Accepter", accent: true, action: function () { repondreContactCote(k.id, true); } },
            { libelle: "Refuser", action: function () { repondreContactCote(k.id, false); } }]));
        });
        document.getElementById("msg-contacts-recues").hidden = !(d.recues || []).length;
        pastille.hidden = !(d.recues || []).length; pastille.textContent = (d.recues || []).length ? String((d.recues || []).length) : "";
        (d.contacts || []).forEach(function (k) {
          var l = ligneContactCote(k, "contact depuis le " + quandGrp(k.depuis), []);
          var menu = document.createElement("button"); menu.type = "button"; menu.className = "msg-ligne-menu"; menu.textContent = "⋯"; menu.title = "Actions"; menu.setAttribute("aria-label", "Actions sur " + k.pseudo);
          menu.addEventListener("click", function (ev) {
            ev.stopPropagation();
            menuFlottant.ouvrir(menu, [
              { libelle: "Écrire", action: function () { ecrireA(k.membre, k.pseudo); } },
              { libelle: "Retirer des contacts", danger: true, action: function () {
                if (!window.confirm("Retirer " + k.pseudo + " de tes contacts ?")) return;
                appelGrp("DELETE", "/api/contacts?id=" + encodeURIComponent(k.id)).then(chargerContactsCote);
              } }]);
          });
          l.querySelector(".msg-ligne-bas").appendChild(menu);
          lc.appendChild(l);
        });
        note.textContent = (d.contacts || []).length ? "" : "Aucun contact. Demande quelqu'un par son pseudo, ou depuis les membres d'un groupe.";
        (d.envoyees || []).forEach(function (k) {
          le.appendChild(ligneContactCote(k, (k.etat === "refuse" ? "a refusé" : "en attente") + " · " + quandGrp(k.cree_le), [
            { libelle: "Annuler", action: function () { appelGrp("DELETE", "/api/contacts?id=" + encodeURIComponent(k.id)).then(chargerContactsCote); } }]));
        });
        document.getElementById("msg-contacts-envoyees").hidden = !(d.envoyees || []).length;
        contactsCotePeints = true;
        filtrerListes();
      }).catch(function () {});
    }
    function repondreContactCote(id, accepte) {
      appelGrp("PATCH", "/api/contacts", { id: id, accepte: accepte }).then(function (x) {
        if (!x.ok) { direGrp(x.d.erreur || "Échec.", "erreur"); return; }
        direGrp(accepte ? "C'est un contact, maintenant." : "Demande refusée.", accepte ? "succes" : "info");
        chargerContactsCote();
      }).catch(function () { direGrp("Service indisponible.", "erreur"); });
    }
    var formContactCote = document.getElementById("msg-form-contact");
    if (formContactCote) {
      formContactCote.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var champ = document.getElementById("msg-contact-pseudo"), pseudo = champ.value.trim();
        if (pseudo.length < 3) { direGrp("Un pseudo fait 3 caractères au moins.", "erreur"); return; }
        appelGrp("POST", "/api/contacts", { pseudo: pseudo }).then(function (x) {
          if (!x.ok) { direGrp(x.d.erreur || "Échec.", "erreur"); return; }
          champ.value = "";
          direGrp(x.d.etat === "accepte" ? pseudo + " est maintenant un contact." : "Demande envoyée à " + pseudo + ".", "succes");
          chargerContactsCote();
        }).catch(function () { direGrp("Service indisponible.", "erreur"); });
      });
      /* le compte des demandes recues sur l'onglet, des l'arrivee */
      appelGrp("GET", "/api/contacts").then(function (x) {
        var pastille = document.getElementById("msg-contacts-pastille");
        if (x.ok && pastille) { var n = (x.d.recues || []).length; pastille.hidden = !n; pastille.textContent = n ? String(n) : ""; }
      }).catch(function () {});
    }
    /* le titre de l'onglet compte les non-lus de tous mes groupes ; la
       route donne le total, on le recalcule sinon */
    function titreListeGrp(d) { titreAvecNonLus(conversationsNonLues(d)); }
    var invitationsConnues = [];
    function chargerGroupes() {
      appelGrp("GET", "/api/groupes").then(function (x) {
        if (!x.ok && !x.d.indisponible) { direGrp(x.d.erreur || "Accès refusé.", "erreur"); return; }
        peindreGroupes(x.d);
      }).catch(function () { direGrp("Service indisponible.", "erreur"); });
    }
    /* une notification arrive, l'onglet revient : la liste se recharge
       (nouveau dernier message, non-lus), sans rien effacer si ca echoue */
    surNonLus(function () {
      appelGrp("GET", "/api/groupes").then(function (x) { if (x.ok) peindreGroupes(x.d); }).catch(function () {});
    });
    function repondre(id, accepte) {
      appelGrp("POST", "/api/groupes/invitations", { groupe: id, accepte: accepte }).then(function (x) {
        if (!x.ok) { direGrp(x.d.erreur || "Échec.", "erreur"); return; }
        direGrp(accepte ? "Bienvenue dans le groupe." : "Invitation déclinée.", "succes");
        chargerGroupes();
      });
    }
    document.getElementById("grp-ouvrir-creer").addEventListener("click", function () {
      ouvrirDialogueGrp(dialogueCreer);
      document.getElementById("grp-nom").focus();
    });
    if (location.hash === "#nouveau") { ouvrirDialogueGrp(dialogueCreer); document.getElementById("grp-nom").focus(); }
    document.getElementById("grp-annuler-creer").addEventListener("click", function () { fermerDialogueGrp(dialogueCreer); });
    document.getElementById("grp-form-creer").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var nom = document.getElementById("grp-nom").value.trim();
      var description = document.getElementById("grp-description").value.trim();
      direGrp("Création…", "info");
      appelGrp("POST", "/api/groupes", { nom: nom, description: description }).then(function (x) {
        if (!x.ok) { direGrp(x.d.erreur || "Échec.", "erreur"); return; }
        location.href = "groupe.html?id=" + encodeURIComponent(x.d.id);
      }).catch(function () { direGrp("Service indisponible.", "erreur"); });
    });
    chargerGroupes();
  }

  /* ---------- les contacts (lot C-12) ----------
     listeContacts() : mes contacts (promesse, chargee une fois par page,
     503 = pas encore ouvert → liste vide). ouvrirSelecteurContacts(deja,
     auChoix) : la fenetre a cases pour en choisir plusieurs — sert a
     « Proposer aussi a » d'un evenement. */
  var contactsCharges = null;
  function listeContacts() {
    if (contactsCharges) return contactsCharges;
    contactsCharges = appelGrp("GET", "/api/contacts").then(function (x) {
      return { ok: x.ok, indisponible: !x.ok && !!x.d.indisponible, contacts: x.ok ? (x.d.contacts || []) : [],
               envoyees: x.ok ? (x.d.envoyees || []) : [], recues: x.ok ? (x.d.recues || []) : [] };
    }).catch(function () { return { ok: false, indisponible: false, contacts: [], envoyees: [], recues: [] }; });
    return contactsCharges;
  }
  var dialogueContacts = null, surChoixContacts = null, brouillonContacts = {};
  function ouvrirSelecteurContacts(dejaChoisis, auChoix) {
    surChoixContacts = auChoix;
    brouillonContacts = {};
    (dejaChoisis || []).forEach(function (id) { brouillonContacts[id] = true; });
    if (!dialogueContacts) {
      dialogueContacts = document.createElement("dialog");
      dialogueContacts.className = "edt-dialogue sf-dialogue";
      dialogueContacts.innerHTML =
        '<div class="sf-tete"><h2>Choisir des contacts</h2>' +
        '<button type="button" class="btn btn-icone sf-fermer" aria-label="Fermer">×</button></div>' +
        '<p class="c-note sf-vide-contacts" hidden>Tu n’as pas encore de contact. <a href="/contacts/">Demander quelqu’un</a>.</p>' +
        '<div class="sf-liste sf-multi"></div>' +
        '<div class="sf-pied"><span class="sf-compte"></span>' +
        '<span class="sf-actions"><button type="button" class="btn sf-annuler">Annuler</button>' +
        '<button type="button" class="btn btn-accent sf-valider">Valider</button></span></div>';
      document.body.appendChild(dialogueContacts);
      dialogueContacts.querySelector(".sf-fermer").addEventListener("click", function () { dialogueContacts.close(); });
      fermerAuVoile(dialogueContacts);
      dialogueContacts.querySelector(".sf-annuler").addEventListener("click", function () { dialogueContacts.close(); });
      dialogueContacts.querySelector(".sf-valider").addEventListener("click", function () {
        var choisis = Object.keys(brouillonContacts).filter(function (id) { return brouillonContacts[id]; });
        dialogueContacts.close();
        if (surChoixContacts) surChoixContacts(choisis);
      });
    }
    var zone = dialogueContacts.querySelector(".sf-liste");
    zone.textContent = "";
    listeContacts().then(function (c) {
      dialogueContacts.querySelector(".sf-vide-contacts").hidden = c.contacts.length > 0;
      c.contacts.forEach(function (k) {
        var lab = document.createElement("label"); lab.className = "sf-fiche sf-fiche-case sf-contact";
        var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!brouillonContacts[k.membre]; cb.value = k.membre;
        cb.addEventListener("change", function () {
          if (cb.checked) brouillonContacts[k.membre] = true; else delete brouillonContacts[k.membre];
          var n = Object.keys(brouillonContacts).length;
          dialogueContacts.querySelector(".sf-compte").textContent = n ? n + " contact" + (n > 1 ? "s" : "") : "Aucun contact";
        });
        lab.appendChild(cb); lab.appendChild(avatarGrp(k.pseudo, true)); lab.appendChild(document.createTextNode(" " + k.pseudo));
        zone.appendChild(lab);
      });
      var n = Object.keys(brouillonContacts).length;
      dialogueContacts.querySelector(".sf-compte").textContent = n ? n + " contact" + (n > 1 ? "s" : "") : "Aucun contact";
    });
    if (typeof dialogueContacts.showModal === "function") dialogueContacts.showModal(); else dialogueContacts.setAttribute("open", "");
  }

  var formContacts = document.getElementById("ct-form");
  if (formContacts) {
    function direCt(t, type) { var z = document.getElementById("etat"); z.textContent = t; z.className = "etat" + (type ? " etat-" + type : ""); z.hidden = !t; }
    function ligneContact(k, actions) {
      var li = document.createElement("li");
      li.setAttribute("data-id", k.id);
      li.appendChild(avatarGrp(k.pseudo));
      var t = document.createElement("div"); t.className = "grp-membre-texte";
      var n = document.createElement("div"); n.className = "grp-carte-titre"; n.textContent = k.pseudo; t.appendChild(n);
      var d = document.createElement("div"); d.className = "c-note"; d.textContent = k.sous; t.appendChild(d);
      li.appendChild(t);
      var zone = document.createElement("span"); zone.className = "grp-membre-actions";
      actions.forEach(function (a) {
        var b = document.createElement("button"); b.type = "button"; b.className = a.accent ? "btn btn-mini btn-accent" : (a.lien ? "lien-bouton" : "btn btn-mini");
        b.textContent = a.libelle; b.addEventListener("click", a.action); zone.appendChild(b);
      });
      li.appendChild(zone);
      return li;
    }
    function repondreCt(id, accepte) {
      appelGrp("PATCH", "/api/contacts", { id: id, accepte: accepte }).then(function (x) {
        if (!x.ok) { direCt(x.d.erreur || "Échec.", "erreur"); return; }
        direCt(accepte ? "C'est un contact, maintenant." : "Demande refusée.", accepte ? "succes" : "info");
        chargerContacts();
      }).catch(function () { direCt("Service indisponible.", "erreur"); });
    }
    function retirerCt(id, phrase) {
      if (phrase && !window.confirm(phrase)) return;
      appelGrp("DELETE", "/api/contacts?id=" + encodeURIComponent(id)).then(function (x) {
        if (!x.ok) { direCt(x.d.erreur || "Échec.", "erreur"); return; }
        chargerContacts();
      }).catch(function () { direCt("Service indisponible.", "erreur"); });
    }
    function peindreContacts(d) {
      var lr = document.getElementById("ct-liste-recues"), lc = document.getElementById("ct-liste-contacts"), le = document.getElementById("ct-liste-envoyees");
      lr.textContent = ""; lc.textContent = ""; le.textContent = "";
      (d.recues || []).forEach(function (k) {
        lr.appendChild(ligneContact({ id: k.id, pseudo: k.pseudo, sous: "te demande, le " + quandGrp(k.cree_le) }, [
          { libelle: "Accepter", accent: true, action: function () { repondreCt(k.id, true); } },
          { libelle: "Refuser", action: function () { repondreCt(k.id, false); } }
        ]));
      });
      document.getElementById("ct-recues").hidden = !(d.recues || []).length;
      (d.contacts || []).forEach(function (k) {
        lc.appendChild(ligneContact({ id: k.id, pseudo: k.pseudo, sous: "contact depuis le " + quandGrp(k.depuis) }, [
          { libelle: "écrire", lien: true, action: function () { ecrireA(k.membre, k.pseudo, direCt); } },
          { libelle: "retirer", lien: true, action: function () { retirerCt(k.id, "Retirer " + k.pseudo + " de tes contacts ? Il faudra une nouvelle demande pour le remettre (et vous ne pourrez plus vous écrire en privé d'ici là)."); } }
        ]));
      });
      document.getElementById("ct-note").textContent = (d.contacts || []).length ? "" : "Aucun contact pour l'instant. Demande quelqu'un par son pseudo, ou depuis la liste des membres d'un groupe.";
      (d.envoyees || []).forEach(function (k) {
        le.appendChild(ligneContact({ id: k.id, pseudo: k.pseudo, sous: (k.etat === "refuse" ? "a refusé" : "en attente de réponse") + " · demandé le " + quandGrp(k.cree_le) }, [
          { libelle: k.etat === "refuse" ? "effacer" : "retirer la demande", lien: true, action: function () { retirerCt(k.id); } }
        ]));
      });
      document.getElementById("ct-envoyees").hidden = !(d.envoyees || []).length;
    }
    function chargerContacts() {
      contactsCharges = null;
      appelGrp("GET", "/api/contacts").then(function (x) {
        if (!x.ok) { direCt(x.d.erreur || "Accès refusé.", x.d.indisponible ? "info" : "erreur"); return; }
        peindreContacts(x.d);
      }).catch(function () { direCt("Service indisponible.", "erreur"); });
    }
    formContacts.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var pseudo = document.getElementById("ct-pseudo").value.trim();
      if (!pseudo) return;
      appelGrp("POST", "/api/contacts", { pseudo: pseudo }).then(function (x) {
        if (!x.ok) { direCt(x.d.erreur || "Échec.", "erreur"); return; }
        document.getElementById("ct-pseudo").value = "";
        direCt(x.d.etat === "accepte" ? x.d.pseudo + " te demandait aussi : vous êtes en contact." : "Demande envoyée à " + x.d.pseudo + ".", "succes");
        chargerContacts();
      }).catch(function () { direCt("Service indisponible.", "erreur"); });
    });
    chargerContacts();
  }

  /* ---------- rejoindre par un lien ---------- */
  var rjCarte = document.getElementById("rj-carte");
  if (rjCarte) {
    var codeRj = new URLSearchParams(location.search).get("code") || "";
    var sousTitre = document.getElementById("rj-sous-titre");
    function direRj(t, type) { var z = document.getElementById("etat"); z.textContent = t; z.className = "etat etat-" + (type || "info"); z.hidden = false; }
    if (!codeRj) {
      sousTitre.textContent = "Ce lien est incomplet.";
    } else {
      appelGrp("GET", "/api/groupes/rejoindre?code=" + encodeURIComponent(codeRj)).then(function (x) {
        if (!x.ok) { sousTitre.textContent = ""; direRj(x.d.erreur || "Service indisponible.", x.d.indisponible ? "info" : "erreur"); return; }
        var d = x.d;
        if (!d.groupe) { sousTitre.textContent = "Ce lien ne mène nulle part : il a peut-être été mal copié."; return; }
        document.getElementById("rj-nom").textContent = d.groupe.nom;
        document.getElementById("rj-desc").textContent = d.groupe.description || "";
        document.getElementById("rj-membres").textContent = d.groupe.membres + " membre" + (d.groupe.membres > 1 ? "s" : "");
        sousTitre.textContent = (d.invite_par ? d.invite_par + " t'invite" : "Tu es invité·e") + " à rejoindre ce groupe.";
        rjCarte.hidden = false;
        var btn = document.getElementById("rj-rejoindre"), ouvrir = document.getElementById("rj-ouvrir");
        ouvrir.href = "groupe.html?id=" + encodeURIComponent(d.groupe.id);
        if (d.deja === "accepte") {
          sousTitre.textContent = "Tu es déjà dans ce groupe.";
          btn.hidden = true; ouvrir.hidden = false; return;
        }
        if (!d.valide) {
          var raisons = { revoque: "Ce lien a été révoqué par un administrateur du groupe.", expire: "Ce lien a expiré.", epuise: "Ce lien a été utilisé trop de fois." };
          direRj(raisons[d.raison] || "Ce lien n'est plus valable.", "erreur");
          btn.hidden = true; return;
        }
        btn.addEventListener("click", function () {
          btn.disabled = true;
          appelGrp("POST", "/api/groupes/rejoindre", { code: codeRj }).then(function (y) {
            if (!y.ok) { direRj(y.d.erreur || "Échec.", "erreur"); btn.disabled = false; return; }
            location.href = "groupe.html?id=" + encodeURIComponent(y.d.id);
          }).catch(function () { direRj("Service indisponible.", "erreur"); btn.disabled = false; });
        });
      }).catch(function () { sousTitre.textContent = ""; direRj("Service indisponible.", "erreur"); });
    }
  }

  /* ---------- un groupe ---------- */
  var titreGrp = document.getElementById("grp-titre");
  if (titreGrp) {
    var idGrp = new URLSearchParams(location.search).get("id") || "";
    var etatGrp = null;
    var nouveauxMessages = false;   /* pose par chargerGroupe le temps d'une peinture */
    var pseudoMoi = null;
    var dialogueSeance = document.getElementById("grp-dialogue-seance");
    brancherSelecteurFiches(document.getElementById("grp-s-fiche"));
    var dialogueParametres = document.getElementById("grp-dialogue-parametres");

    /* ---------- lecture de signalement (lot E) ----------
       « &signalement=n » dans l'adresse : l'administrateur du site lit la
       discussion par la porte qu'un signalement a ouverte. Le detail du
       signalement vient de /api/admin/signalements?id=n — qui inscrit
       l'ouverture au journal — ; les messages, de /api/groupes/:id comme
       pour tout le monde : c'est la regle d'acces de la base qui ne laisse
       passer que la fenetre (le message signale et ceux qui le precedent).
       Pas de direct, pas de sondage, pas de composeur : une lecture, un
       verdict, et la porte se referme. */
    var sigMode = new URLSearchParams(location.search).get("signalement") || "";
    if (!/^\d{1,12}$/.test(sigMode)) sigMode = "";

    /* ---------- le chiffrement de la conversation (lot H, session 2) ----------
       etatChiffre : ce que /api/groupes/:id/cles a dit (chiffre_depuis, mes
       enveloppes, celles que j'ai faites, les cles publiques des deux), les
       cles de conversation ouvertes (par version), les octets bruts de
       celles que je tiens (pour les rendre a l'autre), l'autre (sa cle
       courante, les versions que j'ai acceptees), et l'alerte quand sa cle
       a change. Les messages recoivent m.clair = { ok, t, refs, raison }. */
    var etatChiffre = { conv: null, cles: {}, brutes: {}, autre: null, acceptees: [], alerte: null, pret: false, dialogue: false };
    var clairs = {};   /* id|modifie_le|debut du chiffre → { ok, t, refs, raison } */
    function chargerClesConv() {
      return appelGrp("GET", "/api/groupes/" + encodeURIComponent(idGrp) + "/cles").then(function (x) {
        if (!x.ok) { etatChiffre.conv = x.d.indisponible ? { indisponible: true } : null; return etatChiffre.conv; }
        etatChiffre.conv = x.d;
        return x.d;
      }).catch(function () { etatChiffre.conv = null; return null; });
    }
    function cleCourante(membre) {
      var l = (etatChiffre.conv && etatChiffre.conv.cles && etatChiffre.conv.cles[membre]) || [];
      return l.filter(function (c) { return !c.remplacee_le; })[0] || null;
    }
    function cleVersion(membre, version) {
      var l = (etatChiffre.conv && etatChiffre.conv.cles && etatChiffre.conv.cles[membre]) || [];
      return l.filter(function (c) { return Number(c.version) === Number(version); })[0] || null;
    }
    /* Ouvre mes enveloppes avec ma privee ; celles que l'autre a faites
       avec une version de sa cle que je n'ai pas acceptee attendent. */
    function ouvrirMesEnveloppes(tr) {
      var conv = etatChiffre.conv, autre = etatChiffre.autre;
      if (!conv || !conv.enveloppes || tr.statut !== "ok") return Promise.resolve();
      return Promise.all(conv.enveloppes.map(function (e) {
        if (etatChiffre.cles[e.version]) return null;
        if (autre && e.par === autre.id && etatChiffre.acceptees.indexOf(Number(e.par_version)) < 0) return null;
        var jwk = cleVersion(e.par, e.par_version);
        if (!jwk) return null;
        return Ch.ouvrirEnveloppe(e, tr.identite.privee, jwk.cle, { groupe: idGrp, version: e.version, membre: tr.moi.id, membre_version: e.membre_version, par: e.par, par_version: e.par_version })
          .then(function (brut) {
            etatChiffre.brutes[e.version] = brut;
            return Ch.importerCleConversation(brut).then(function (cle) { etatChiffre.cles[e.version] = cle; Ch.stockage.ecrireCleConversation(tr.moi.id, idGrp, e.version, cle).catch(function () {}); });
          }).catch(function () { /* illisible avec mes cles actuelles : l'autre pourra me la rendre */ });
      }));
    }
    /* Ce que je sais de l'autre : sa cle courante, les versions que j'ai
       acceptees — par confiance au premier usage s'il n'y en a aucune, par
       une enveloppe que j'ai faite pour elle, ou par le geste de l'alerte. */
    function situerLAutre(tr, d) {
      var autre = d.avec ? { id: d.avec.id, pseudo: d.avec.pseudo, courante: cleCourante(d.avec.id) } : null;
      etatChiffre.autre = autre;
      if (!autre || tr.statut !== "ok") return Promise.resolve();
      return Ch.stockage.lireAcceptees(tr.moi.id, autre.id).then(function (locales) {
        var acceptees = locales.slice();
        (etatChiffre.conv.faites || []).forEach(function (e) { if (e.membre === autre.id && acceptees.indexOf(Number(e.membre_version)) < 0) acceptees.push(Number(e.membre_version)); });
        if (!acceptees.length) {
          /* premier usage : on fait confiance a la cle qui a REELLEMENT fait
             mes enveloppes (la plus ancienne), pas a la courante — sinon une
             cle changee entre-temps passerait sans alerte ; sans enveloppe,
             la courante, et on s'en souvient */
          var premieres = (etatChiffre.conv.enveloppes || []).filter(function (e) { return e.par === autre.id; }).map(function (e) { return Number(e.par_version); });
          var v0 = premieres.length ? Math.min.apply(null, premieres) : (autre.courante ? Number(autre.courante.version) : null);
          if (v0) { acceptees.push(v0); Ch.stockage.ecrireAcceptees(tr.moi.id, autre.id, acceptees).catch(function () {}); }
        }
        etatChiffre.acceptees = acceptees;
        etatChiffre.alerte = (autre.courante && acceptees.indexOf(Number(autre.courante.version)) < 0) ? { version: autre.courante.version, empreinte: autre.courante.empreinte, quand: autre.courante.cree_le } : null;
      });
    }
    function dechiffrerUn(m) {
      if (!m.chiffre) return Promise.resolve();
      var k = m.id + "|" + (m.modifie_le || "") + "|" + String(m.chiffre).slice(0, 24);
      if (clairs[k]) { m.clair = clairs[k]; return Promise.resolve(); }
      if (sigMode) { m.clair = clairDuSignalement(m); return Promise.resolve(); }
      var cle = etatChiffre.cles[m.cle_version];
      if (!cle) { m.clair = { ok: false, raison: etatChiffre.alerte ? "clés à confirmer" : (trousseau.statut === "ok" ? "clé de conversation absente" : "clé absente sur cet appareil") }; return Promise.resolve(); }
      return Ch.dechiffrerMessage(cle, m.chiffre, { groupe: idGrp, auteur: m.auteur, cle_version: m.cle_version })
        .then(function (c) { m.clair = clairs[k] = { ok: true, t: c.t, refs: c.refs || [] }; })
        .catch(function () { m.clair = clairs[k] = { ok: false, raison: "message altéré ou clé fausse" }; });
    }
    /* En lecture de signalement, le clair vient de ce que la personne qui
       a signale a transmis (contenu), pas de la base. */
    function clairDuSignalement(m) {
      var c = (signalementLu && signalementLu.contenu || []).filter(function (e) { return String(e.id) === String(m.id); })[0];
      return c ? { ok: true, t: c.texte, refs: [] } : { ok: false, raison: "non transmis par la personne qui a signalé" };
    }
    function texteDe(m) {
      if (!m.chiffre) return m.texte;
      return m.clair && m.clair.ok ? m.clair.t : "⚠ message illisible (" + ((m.clair && m.clair.raison) || "en attente") + ")";
    }
    function refsDe(m) { return m.chiffre ? ((m.clair && m.clair.ok && m.clair.refs) || []) : (m.refs || []); }
    /* Tout ce qu'il faut avant de peindre : le trousseau, les cles de la
       conversation, l'autre, les enveloppes ouvertes, les messages
       dechiffres. Sans module ou sans migration : rien ne change. */
    function preparerChiffre(d, silencieux) {
      var g = d.groupe;
      if (!g.prive || sigMode) {
        if (sigMode && signalementLu && signalementLu.chiffre) return Promise.all(d.messages.map(dechiffrerUn));
        return Promise.resolve();
      }
      if (!chiffrementDisponible()) { d.messages.forEach(function (m) { if (m.chiffre) m.clair = { ok: false, raison: "ce navigateur ne sait pas chiffrer" }; }); etatChiffre.pret = true; return Promise.resolve(); }
      return trousseau.charger().then(function (tr) {
        if (tr.statut === "indisponible") { etatChiffre.pret = true; return; }
        return (etatChiffre.conv && silencieux ? Promise.resolve(etatChiffre.conv) : chargerClesConv()).then(function () {
          return situerLAutre(tr, d);
        }).then(function () { return ouvrirMesEnveloppes(tr); })
          .then(function () { return Promise.all(d.messages.map(dechiffrerUn)); })
          .then(function () {
            /* une cle de conversation manque (l'autre en a fait une, ou m'a
               rendu l'historique depuis) : on relit les cles, une fois */
            var manque = silencieux && tr.statut === "ok" && d.messages.some(function (m) { return m.chiffre && m.clair && !m.clair.ok && /absente/.test(m.clair.raison); });
            if (!manque) return;
            return chargerClesConv().then(function () { return situerLAutre(tr, d); }).then(function () { return ouvrirMesEnveloppes(tr); })
              .then(function () { clairs = {}; return Promise.all(d.messages.map(dechiffrerUn)); });
          })
          .then(function () { etatChiffre.pret = true; });
      });
    }
    /* La cle de conversation qui sert a ecrire : la version courante si je
       la tiens ; sinon (jamais chiffree, ou mes enveloppes illisibles depuis
       mes nouvelles cles), une version neuve, enveloppee pour les deux. */
    function assurerCleDEcriture() {
      var tr = trousseau, conv = etatChiffre.conv, autre = etatChiffre.autre;
      var courante = conv ? Number(conv.version_courante) || 0 : 0;
      if (courante && etatChiffre.cles[courante]) return Promise.resolve(courante);
      if (!autre || !autre.courante) return Promise.reject(new Error("L\u2019autre n\u2019a pas encore de clés."));
      if (etatChiffre.alerte) return Promise.reject(new Error("Confirme d\u2019abord les clés de " + autre.pseudo + "."));
      var version = courante + 1, brut = Ch.genererCleConversation();
      var champs = function (membre, membre_version) { return { groupe: idGrp, version: version, membre: membre, membre_version: membre_version, par: tr.moi.id, par_version: tr.identite.version }; };
      return Promise.all([
        Ch.envelopper(brut, tr.identite.privee, tr.identite.publiqueJwk, champs(tr.moi.id, tr.identite.version)),
        Ch.envelopper(brut, tr.identite.privee, autre.courante.cle, champs(autre.id, autre.courante.version)),
      ]).then(function (envs) {
        return appelGrp("POST", "/api/groupes/" + encodeURIComponent(idGrp) + "/cles", { version: version, enveloppes: [
          { membre: tr.moi.id, membre_version: tr.identite.version, sel: envs[0].sel, enveloppe: envs[0].enveloppe },
          { membre: autre.id, membre_version: autre.courante.version, sel: envs[1].sel, enveloppe: envs[1].enveloppe }] });
      }).then(function (x) {
        if (!x.ok) throw new Error(x.d.erreur || "Les enveloppes n\u2019ont pas été déposées.");
        etatChiffre.brutes[version] = brut;
        return Ch.importerCleConversation(brut).then(function (cle) {
          etatChiffre.cles[version] = cle;
          Ch.stockage.ecrireCleConversation(tr.moi.id, idGrp, version, cle).catch(function () {});
          if (etatChiffre.conv) { etatChiffre.conv.version_courante = version; etatChiffre.conv.chiffre_depuis = x.d.chiffre_depuis || etatChiffre.conv.chiffre_depuis; }
          if (etatGrp) etatGrp.groupe.chiffre_depuis = etatGrp.groupe.chiffre_depuis || x.d.chiffre_depuis;
          return version;
        });
      });
    }
    /* « C'est bien elle » : on retient sa version, on lui rend chaque
       cle de conversation qu'on tient, on rouvre ce qui attendait. */
    function accepterClesDeLAutre() {
      var tr = trousseau, autre = etatChiffre.autre;
      if (!autre || !autre.courante || tr.statut !== "ok") return Promise.resolve();
      var v = Number(autre.courante.version);
      if (etatChiffre.acceptees.indexOf(v) < 0) etatChiffre.acceptees.push(v);
      Ch.stockage.ecrireAcceptees(tr.moi.id, autre.id, etatChiffre.acceptees).catch(function () {});
      etatChiffre.alerte = null;
      var versions = Object.keys(etatChiffre.brutes);
      return Promise.all(versions.map(function (ver) {
        var brut = etatChiffre.brutes[ver];
        return Ch.envelopper(brut, tr.identite.privee, autre.courante.cle, { groupe: idGrp, version: Number(ver), membre: autre.id, membre_version: v, par: tr.moi.id, par_version: tr.identite.version })
          .then(function (env) { return appelGrp("POST", "/api/groupes/" + encodeURIComponent(idGrp) + "/cles", { version: Number(ver), enveloppes: [{ membre: autre.id, membre_version: v, sel: env.sel, enveloppe: env.enveloppe }] }); })
          .then(function (x) { return x.ok ? 1 : 0; }).catch(function () { return 0; });
      })).then(function (rendues) {
        var n = rendues.reduce(function (s, x) { return s + x; }, 0);
        return chargerClesConv().then(function () { return ouvrirMesEnveloppes(tr); }).then(function () {
          clairs = {};
          return Promise.all((etatGrp ? etatGrp.messages : []).map(dechiffrerUn));
        }).then(function () { return n; });
      });
    }
    var signalementLu = null;      /* la ligne de signalements, une fois lue */
    var sigDefile = false;         /* on ne saute au message signale qu'une fois */
    var ancreVisee = false;        /* idem pour le #m<id> d'une notification */
    var dialogueSignaler = document.getElementById("grp-dialogue-signaler");
    var MOTIFS_SIG = { illicite: "contenu illicite", harcelement: "harcèlement", spam: "spam", autre: "autre" };
    var VERDICTS_SIG = { retire: "message retiré", sans_suite: "sans suite", avertissement: "avertissement à l'auteur" };

    var boutonsGrp = document.querySelectorAll("#grp-onglets .admin-onglet");
    function ongletGrp(nom) {
      document.querySelectorAll(".admin-section").forEach(function (s) { s.hidden = s.getAttribute("data-section") !== nom; });
      boutonsGrp.forEach(function (b) { b.classList.toggle("est-actif", b.getAttribute("data-onglet") === nom); });
    }
    boutonsGrp.forEach(function (b) { b.addEventListener("click", function () { ongletGrp(b.getAttribute("data-onglet")); }); });
    if (location.hash === "#seances") ongletGrp("seances");   /* un rappel mene ici */

    function fichesDeSeance(s) {
      if (Array.isArray(s.fiches) && s.fiches.length) return s.fiches;
      return s.fiche ? [s.fiche] : [];
    }
    function lienFiche(fiche) {
      var a = document.createElement("a");
      a.className = "grp-chip";
      a.href = "../fiches/s1/" + fiche.slice(3, 7) + "/" + fiche.slice(8, 10) + ".html"
             + (fiche.indexOf("#") > 0 ? fiche.slice(fiche.indexOf("#")) : "");
      a.textContent = "fiche " + fiche.split("#")[0];
      return a;
    }

    /* ---------- mise en forme des messages ----------
       Un petit Markdown, celui qu'on tape sans y penser : **gras**,
       *italique* ou _italique_, `code`, ~~barre~~, ```bloc de code```,
       > citation, listes « - » ou « * » ou « 1. », et les adresses
       http(s) deviennent des liens. Rien d'autre : pas de HTML (tout est
       echappe d'abord), pas d'images, pas de titres.

       L'ordre compte : on echappe, on met les blocs de code a l'abri (leur
       contenu ne se met pas en forme), puis on traite ligne par ligne. */
    function echapper(t) {
      return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function enLigne(t) {
      var abris = [];
      t = t.replace(/`([^`\n]+)`/g, function (_, c) { abris.push("<code>" + c + "</code>"); return "\u0000" + (abris.length - 1) + "\u0000"; });
      t = t.replace(/(https?:\/\/[^\s<>"')\]]+[^\s<>"'.,;:!?)\]])/g, function (u) {
        abris.push('<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + "</a>");
        return "\u0000" + (abris.length - 1) + "\u0000";
      });
      t = t.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
           .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
           .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
           /* l'italique ne commence ni ne finit par une espace : « 2 * 3 * 4 » reste un calcul */
           .replace(/(^|[^*\w])\*([^*\n\s](?:[^*\n]*[^*\n\s])?)\*(?!\w)/g, "$1<em>$2</em>")
           .replace(/(^|[^_\w])_([^_\n\s](?:[^_\n]*[^_\n\s])?)_(?!\w)/g, "$1<em>$2</em>");
      return t.replace(/\u0000(\d+)\u0000/g, function (_, i) { return abris[Number(i)]; });
    }
    function rendreMarkdown(texte) {
      var t = echapper(texte || "");
      var blocs = [];
      t = t.replace(/```([^\n]*)\n([\s\S]*?)```/g, function (_, lang, code) {
        blocs.push("<pre><code>" + code.replace(/\n$/, "") + "</code></pre>");
        return "" + (blocs.length - 1) + "";
      });
      /* sortie : une suite de morceaux { html, bloc }. Deux lignes simples
         qui se suivent sont separees par un retour ; un bloc (liste, code,
         citation) se pose sans retour autour. */
      var lignes = t.split("\n"), sortie = [], liste = null;
      function fermerListe() { if (liste) { sortie.push({ html: "</" + liste + ">", bloc: true }); liste = null; } }
      lignes.forEach(function (l) {
        var bloc = l.match(/^(\d+)$/);
        if (bloc) { fermerListe(); sortie.push({ html: blocs[Number(bloc[1])], bloc: true }); return; }
        var puce = l.match(/^\s*[-*]\s+(.*)$/), num = l.match(/^\s*\d+[.)]\s+(.*)$/), cit = l.match(/^\s*&gt;\s?(.*)$/);
        if (puce || num) {
          var type = puce ? "ul" : "ol";
          if (liste !== type) { fermerListe(); sortie.push({ html: "<" + type + ">", bloc: true }); liste = type; }
          sortie.push({ html: "<li>" + enLigne((puce || num)[1]) + "</li>", bloc: true });
          return;
        }
        fermerListe();
        if (cit) { sortie.push({ html: "<blockquote>" + enLigne(cit[1]) + "</blockquote>", bloc: true }); return; }
        sortie.push({ html: enLigne(l), bloc: false });
      });
      fermerListe();
      var html = "";
      sortie.forEach(function (x, i) {
        if (i > 0 && !x.bloc && !sortie[i - 1].bloc) html += "<br>";
        html += x.html;
      });
      return html;
    }

    /* ---------- « vu par » ----------
       lectures : par membre, le numero du dernier message lu. Un message
       est vu par les membres acceptes (autres que son auteur) dont ce
       numero atteint le sien. */
    function vuPar(d, m) {
      var lectures = d.lectures || [];
      return d.membres.filter(function (x) {
        if (x.statut !== "accepte" || x.id === m.auteur) return false;
        var l = lectures.filter(function (y) { return y.membre === x.id; })[0];
        return l && Number(l.dernier_lu) >= Number(m.id);
      }).map(function (x) { return x.pseudo; });
    }
    function listerNoms(noms) {
      if (noms.length <= 1) return noms.join("");
      return noms.slice(0, -1).join(", ") + " et " + noms[noms.length - 1];
    }
    var monId = null;
    function idDeMoi(d) {
      if (monId) return monId;
      var m = d.membres.filter(function (x) { return pseudoMoi && x.pseudo === pseudoMoi; })[0];
      if (m) monId = m.id;
      return monId;
    }

    /* Une reference citee par un message : une petite carte cliquable.
       Fiche : le titre si le catalogue est accessible, le code sinon ;
       seance : celle du groupe, ou « seance supprimee ». */
    function carteRef(r) {
      var a = document.createElement("a"); a.className = "grp-ref";
      if (r.type === "fiche") {
        a.href = "../fiches/s1/" + r.id.slice(3, 7) + "/" + r.id.slice(8, 10) + ".html"
               + (r.id.indexOf("#") > 0 ? r.id.slice(r.id.indexOf("#")) : "");
        a.setAttribute("data-module", r.id.slice(3, 7));
        var ic = document.createElement("span"); ic.className = "grp-ref-type"; ic.textContent = "fiche"; a.appendChild(ic);
        var t = document.createElement("span");
        t.textContent = nomDeFiche(r.id, function (nom) { t.textContent = nom; });
        a.appendChild(t);
        return a;
      }
      if (r.type === "seance") {
        var sce = (etatGrp && etatGrp.seances || []).filter(function (x) { return x.id === r.id; })[0];
        var ic2 = document.createElement("span"); ic2.className = "grp-ref-type"; ic2.textContent = "séance"; a.appendChild(ic2);
        var t2 = document.createElement("span");
        if (sce) {
          var dd = new Date(sce.debut);
          t2.textContent = sce.titre + " — " + dd.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })
                         + " " + dd.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
          a.href = "#seances";
          a.addEventListener("click", function (ev) { ev.preventDefault(); ongletGrp("seances"); });
        } else {
          t2.textContent = "séance supprimée"; a.className += " grp-ref-morte";
        }
        a.appendChild(t2);
        return a;
      }
      a.textContent = r.id; return a;
    }

    /* ---------- le menu ⋯ ----------
       UN seul menu, pose sur le corps de la page en position fixe : il
       flotte au-dessus de tout, et ne deforme jamais le fil qui defile
       (un menu pose dans la bulle elargissait la boite, ou se faisait
       couper). Il s'ouvre sous le bouton, a gauche si la fenetre finit a
       droite, au-dessus si elle finit en bas. Il se ferme au clic
       ailleurs, a Echap, et quand le fil defile. */
    /* Le menu lui-meme est commun a tout le site (menuFlottant, plus
       haut) ; ici on y ajoute la fermeture quand le fil defile. */
    function fermerMenusMsg() { menuFlottant.fermer(); }
    function ouvrirMenuMsg(bouton, entrees) { menuFlottant.ouvrir(bouton, entrees); }
    document.getElementById("grp-messages").addEventListener("scroll", fermerMenusMsg);

    /* ---------- ce qu'on peut faire d'un message ----------
       UNE liste, trois portes : le « ⋯ » de la bulle, le clic droit
       (ordinateur) et l'appui long (telephone) — proposition 5 du
       24 septembre, « comme sur WhatsApp ». « principale » : ce qui monte
       dans la barre de l'appui long ; le reste passe sous son « ⋯ ». */
    function estMien(d, m) {
      var moi = idDeMoi(d), qui = (m.qui && m.qui.pseudo) || "compte supprimé";
      return !!((moi && m.auteur === moi) || (pseudoMoi && qui === pseudoMoi));
    }
    function lisible(m) { return !m.chiffre || !!(m.clair && m.clair.ok); }
    function entreesMsg(m) {
      var d = etatGrp, mien = estMien(d, m), effacable = d.mon_role === "admin" || mien;
      var e = [{ libelle: "Répondre", icone: "repondre", principale: true, action: function () { repondreA(m); } }];
      /* un message chiffre illisible ici (cle absente) ne se modifie pas :
         on reecrirait « ⚠ message illisible » par-dessus */
      if (mien && lisible(m)) e.push({ libelle: "Modifier", icone: "modifier", principale: true, action: function () { editerMessage(m); } });
      if (lisible(m)) e.push({ libelle: "Copier", icone: "copier", principale: true, action: function () { copierMessage(m); } });
      if (effacable) {
        e.push({ libelle: "Effacer", icone: "effacer", principale: true, danger: true, action: function () { effacerMessage(m); } });
        e.push({ libelle: "Sélectionner", action: function () { entrerSelection(m.id); } });
      }
      if (!mien) e.push({ libelle: "Signaler", action: function () { ouvrirSignaler(m); } });
      return e;
    }
    function effacerMessage(m) {
      appelGrp("DELETE", "/api/groupes/" + idGrp + "/messages?id=" + m.id).then(function (x) {
        if (!x.ok) { direGrp(x.d.erreur || "Échec.", "erreur"); return; }
        retirerMessageDirect(m.id);
        if (!direct.actif) chargerGroupe(true);
      });
    }
    /* Copier : le presse-papiers quand le navigateur le permet (https), le
       vieux execCommand sinon. Au telephone, c'est le seul moyen : l'appui
       long ne selectionne plus le texte des bulles (voir le CSS). */
    function copierMessage(m) {
      var t = texteDe(m);
      function repli() {
        var z = document.createElement("textarea");
        z.value = t; z.setAttribute("readonly", "");
        z.style.position = "fixed"; z.style.opacity = "0";
        document.body.appendChild(z); z.select();
        var ok = false;
        try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
        z.remove();
        direGrp(ok ? "Message copié." : "La copie n'est pas permise ici.", ok ? "succes" : "erreur");
      }
      if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
        navigator.clipboard.writeText(t).then(function () { direGrp("Message copié.", "succes"); }, repli);
      } else repli();
    }

    /* ---------- modifier son message ----------
       Proposition 5 du 24 septembre : « l'interface de modification est
       completement ecrasee ». Le texte se modifiait DANS la bulle : un champ
       de deux lignes, large comme la bulle — un long message s'y retrouvait
       tasse, a faire defiler ligne a ligne —, et « Enregistrer », couleur
       d'accent sur une bulle couleur d'accent, ne se voyait pas. Pire : la
       relecture du groupe (toutes les 15 s sans le direct) repeignait le fil
       et emportait le champ ; « Modifier » ne repondait plus ensuite, jusqu'a
       ce qu'on recharge la page.
       Maintenant, comme WhatsApp : le message remonte dans le composeur, qui
       a toute la largeur et grandit avec le texte ; un bandeau au-dessus dit
       ce qu'on modifie (× ou Echap : annuler ; un clic : y aller) ; ✓
       enregistre. Le composeur n'est pas dans le fil : aucune repeinture ne
       l'emporte. Ce qu'on etait en train d'ecrire est mis de cote, et
       revient apres. Les references ne se modifient pas ici (elles
       restent) : le « + » se cache le temps de la modification. */
    var edition = null;   /* { m, brouillon } pendant une modification */
    function editerMessage(m) {
      if (edition) finirEdition();
      annulerReponse();
      fermerBarreMsg();
      edition = { m: m, brouillon: champTexte.value };
      champTexte.value = texteDe(m);
      document.getElementById("grp-edition-texte").textContent = extrait(texteDe(m));
      document.getElementById("grp-edition").hidden = false;
      document.getElementById("grp-discussion").classList.add("grp-en-edition");
      boutonEnvoi.textContent = "✓";
      boutonEnvoi.title = "Enregistrer la modification";
      boutonEnvoi.setAttribute("aria-label", "Enregistrer la modification");
      marquerLignes();
      ajusterChamp();
      champTexte.focus();
      var n = champTexte.value.length;
      if (champTexte.setSelectionRange) champTexte.setSelectionRange(n, n);
    }
    function finirEdition() {
      if (!edition) return;
      champTexte.value = edition.brouillon || "";
      edition = null;
      document.getElementById("grp-edition").hidden = true;
      document.getElementById("grp-discussion").classList.remove("grp-en-edition");
      boutonEnvoi.textContent = "➤";
      boutonEnvoi.title = "Envoyer";
      boutonEnvoi.removeAttribute("aria-label");
      marquerLignes();
      ajusterChamp();
    }
    function enregistrerEdition() {
      var m = edition.m;
      var texte = champTexte.value.trim();
      if (texte === String(texteDe(m)).trim()) { finirEdition(); return; }
      if (!texte) { direGrp("Un message ne peut pas être vide : pour le retirer, « Effacer ».", "info"); return; }
      /* un message chiffre se rechiffre (nonce neuf), avec ses references */
      if (m.chiffre && !etatChiffre.cles[m.cle_version]) { direGrp("Clé absente : impossible de modifier ce message ici.", "erreur"); return; }
      boutonEnvoi.disabled = true;
      var corps = m.chiffre
        ? Ch.chiffrerMessage(etatChiffre.cles[m.cle_version], { t: texte, refs: refsDe(m) }, { groupe: idGrp, auteur: m.auteur, cle_version: m.cle_version })
            .then(function (chiffre) { return { id: m.id, chiffre: chiffre, cle_version: m.cle_version }; })
        : Promise.resolve({ id: m.id, texte: texte, refs: m.refs || [] });
      corps.then(function (c) { return appelGrp("PATCH", "/api/groupes/" + idGrp + "/messages", c); }).then(function (x) {
        boutonEnvoi.disabled = false;
        if (!x.ok) { direGrp(x.d.erreur || "Échec.", "erreur"); return; }
        poserMessage(x.d.message);
        finirEdition();
        return dechiffrerUn(etatGrp.messages.filter(function (y) { return String(y.id) === String(m.id); })[0] || {}).then(function () {
          peindreDiscussion(etatGrp, etatGrp.mon_role === "admin");
        });
      }).catch(function (e) { boutonEnvoi.disabled = false; direGrp((e && e.message) || "Service indisponible.", "erreur"); });
    }
    document.getElementById("grp-edition-annuler").addEventListener("click", function (ev) { ev.stopPropagation(); finirEdition(); champTexte.focus(); });
    document.getElementById("grp-edition").addEventListener("click", function () { if (edition) allerAuMessage(edition.m.id); });

    /* Les lignes marquees : celle qu'on modifie, celle que l'appui long
       tient. Reposees apres chaque peinture du fil. */
    function marquerLignes() {
      var zone = document.getElementById("grp-messages");
      zone.querySelectorAll(".grp-ligne-edition, .grp-ligne-tenue").forEach(function (l) {
        l.classList.remove("grp-ligne-edition"); l.classList.remove("grp-ligne-tenue");
      });
      var l;
      if (edition && (l = zone.querySelector('[data-id="' + edition.m.id + '"]'))) l.classList.add("grp-ligne-edition");
      if (barreMsg && (l = zone.querySelector('[data-id="' + barreMsg.m.id + '"]'))) l.classList.add("grp-ligne-tenue");
    }

    /* ---------- l'appui long, le clic droit ----------
       Clic droit (souris) : le menu du « ⋯ », la ou l'on a clique. Sauf sur
       un lien (le menu du navigateur : ouvrir dans un onglet…) et quand du
       texte est selectionne (le menu du navigateur : copier ce bout-la).
       Appui long (doigt, stylet) : le message se marque, et une barre prend
       la place de l'en-tete, en haut de l'ecran, avec les actions principales — icone et
       mot —, le reste sous « ⋯ ». Android signale l'appui long par un
       « contextmenu » ; iOS ne le fait pas, d'ou la minuterie : 500 ms sans
       bouger de plus de 12 px. Les deux menent au meme endroit, une fois. */
    var ICONES_MSG = {
      repondre: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5V20"/>',
      modifier: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
      copier: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4.5A.5.5 0 0 1 4 14.5V5a1 1 0 0 1 1-1h9.5a.5.5 0 0 1 .5.5V5"/>',
      effacer: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>'
    };
    function boutonBarre(icone, libelle, danger) {
      var b = document.createElement("button"); b.type = "button";
      b.className = "grp-barre-bouton" + (danger ? " est-danger" : "");
      b.innerHTML = icone ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONES_MSG[icone] + "</svg>"
                          : '<span class="grp-barre-points" aria-hidden="true">⋯</span>';
      var l = document.createElement("span"); l.textContent = libelle; b.appendChild(l);
      return b;
    }
    var barreMsg = null;   /* { m, depuis } quand la barre est ouverte */
    function ouvrirBarreMsg(m) {
      if (selection || sigMode) return;
      if (barreMsg && String(barreMsg.m.id) === String(m.id)) return;
      menuFlottant.fermer();
      barreMsg = { m: m, depuis: Date.now() };
      var zone = document.getElementById("grp-barre-msg-actions");
      zone.textContent = "";
      var entrees = entreesMsg(m);
      entrees.filter(function (e) { return e.principale; }).forEach(function (e) {
        var b = boutonBarre(e.icone, e.libelle, e.danger);
        b.addEventListener("click", function () { fermerBarreMsg(); e.action(); });
        zone.appendChild(b);
      });
      var autres = entrees.filter(function (e) { return !e.principale; });
      if (autres.length) {
        var plus = boutonBarre(null, "Plus");
        plus.setAttribute("aria-haspopup", "menu");
        plus.addEventListener("click", function (ev) {
          ev.stopPropagation();
          ouvrirMenuMsg(plus, autres.map(function (e) {
            return { libelle: e.libelle, danger: e.danger, action: function () { fermerBarreMsg(); e.action(); } };
          }));
        });
        zone.appendChild(plus);
      }
      document.getElementById("grp-barre-msg").hidden = false;
      marquerLignes();
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { /* rien */ } }
    }
    function fermerBarreMsg() {
      if (!barreMsg) return;
      barreMsg = null;
      document.getElementById("grp-barre-msg").hidden = true;
      menuFlottant.fermer();
      marquerLignes();
    }
    document.getElementById("grp-barre-fermer").addEventListener("click", fermerBarreMsg);
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") fermerBarreMsg(); });

    var zoneFil = document.getElementById("grp-messages");
    var pointeur = "mouse", appui = null;
    /* le message sous le doigt (ou la souris), s'il y a une bulle */
    function messageSous(cible) {
      var bulle = cible && cible.closest ? cible.closest(".grp-bulle") : null;
      var ligne = bulle && bulle.closest(".grp-ligne");
      if (!ligne || !etatGrp) return null;
      var id = ligne.getAttribute("data-id");
      return etatGrp.messages.filter(function (x) { return String(x.id) === id; })[0] || null;
    }
    function annulerAppui() { if (appui) { clearTimeout(appui.minuterie); appui = null; } }
    zoneFil.addEventListener("pointerdown", function (ev) {
      pointeur = ev.pointerType || "mouse";
      annulerAppui();
      if (pointeur === "mouse" || selection || sigMode) return;
      if (ev.target.closest("a, button, textarea, input")) return;
      var m = messageSous(ev.target);
      if (!m) return;
      appui = { x: ev.clientX, y: ev.clientY, minuterie: setTimeout(function () { appui = null; ouvrirBarreMsg(m); }, 500) };
    });
    zoneFil.addEventListener("pointermove", function (ev) {
      if (appui && Math.abs(ev.clientX - appui.x) + Math.abs(ev.clientY - appui.y) > 12) annulerAppui();
    });
    ["pointerup", "pointercancel", "scroll"].forEach(function (t) { zoneFil.addEventListener(t, annulerAppui); });
    zoneFil.addEventListener("contextmenu", function (ev) {
      if (selection || sigMode) return;
      if (ev.target.closest("a, textarea, input")) return;
      var m = messageSous(ev.target);
      if (!m) return;
      if (pointeur !== "mouse") { ev.preventDefault(); annulerAppui(); ouvrirBarreMsg(m); return; }
      if (window.getSelection && String(window.getSelection())) return;
      ev.preventDefault();
      /* au clavier (touche Menu), pas de coordonnees : sous la bulle */
      var x = ev.clientX, y = ev.clientY;
      var ancre = (x || y) ? { getBoundingClientRect: function () { return { left: x, right: x, top: y, bottom: y }; } }
                           : ev.target.closest(".grp-bulle");
      ouvrirMenuMsg(ancre, entreesMsg(m));
    });
    /* toucher ailleurs dans le fil lache le message (mais pas le
       relachement de l'appui qui vient de l'ouvrir) */
    zoneFil.addEventListener("click", function (ev) {
      if (!barreMsg || Date.now() - barreMsg.depuis < 600) return;
      var m = messageSous(ev.target);
      if (!m || String(m.id) !== String(barreMsg.m.id)) fermerBarreMsg();
    });

    /* Un message relu (modifie, ou recu par le direct) remplace le sien. */
    function poserMessage(m) {
      if (!etatGrp) return;
      var i = -1;
      etatGrp.messages.forEach(function (x, k) { if (String(x.id) === String(m.id)) i = k; });
      var membre = etatGrp.membres.filter(function (x) { return x.id === m.auteur; })[0];
      var propre = { id: m.id, texte: m.texte, cree_le: m.cree_le, modifie_le: m.modifie_le || null, refs: m.refs || [],
                     reponse_a: m.reponse_a || null, auteur: m.auteur,
                     chiffre: m.chiffre || null, cle_version: m.cle_version || null,
                     qui: m.qui || { pseudo: membre ? membre.pseudo : "?" } };
      if (i === -1) etatGrp.messages.push(propre); else etatGrp.messages[i] = propre;
      empreinteGrp = empreinte(etatGrp);
    }

    /* Descendre en bas du fil — maintenant, puis apres la mise en page
       (les hauteurs ne sont sures qu'une fois le navigateur passe). */
    function descendreFil(zone) {
      zone.scrollTop = zone.scrollHeight;
      if (window.requestAnimationFrame) requestAnimationFrame(function () { zone.scrollTop = zone.scrollHeight; });
      setTimeout(function () { zone.scrollTop = zone.scrollHeight; }, 250);
    }
    /* forcerBas : un message vient d'arriver (ou de partir), ou c'est la
       premiere peinture — on descend, quoi qu'il arrive. Sans lui (un
       « vu », une modification, un sondage), on ne descend que si on y
       etait deja : qui est remonte relire n'est pas ramene en bas. */
    function peindreDiscussion(d, admin, forcerBas) {
      var zone = document.getElementById("grp-messages");
      /* le message qu'on modifie (ou qu'on tient) a ete efface entre-temps */
      var existe = function (m) { return d.messages.some(function (x) { return String(x.id) === String(m.id); }); };
      if (edition && !existe(edition.m)) { finirEdition(); direGrp("Ce message a été effacé pendant que tu le modifiais.", "info"); }
      if (barreMsg && !existe(barreMsg.m)) fermerBarreMsg();
      var enBas = zone.children.length ? (zone.scrollHeight - zone.scrollTop - zone.clientHeight < 40) : null;
      if (forcerBas) enBas = true;
      zone.textContent = "";
      if (!d.messages.length) {
        var v = document.createElement("p"); v.className = "c-note grp-vide";
        v.textContent = "Personne n'a encore écrit. À toi.";
        zone.appendChild(v);
      }
      var dernierJour = "";
      var moi = idDeMoi(d);
      var precedentEnClair = false;
      d.messages.forEach(function (m) {
        var jour = m.cree_le ? new Date(m.cree_le).toDateString() : "";
        if (jour !== dernierJour) {
          var sep = document.createElement("div"); sep.className = "grp-jour";
          sep.textContent = new Date(m.cree_le).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
          zone.appendChild(sep);
          dernierJour = jour;
        }
        /* le trait entre l'avant et l'apres : les messages d'avant restent
           en clair, ceux d'apres sont chiffres (lot H, session 2) */
        if (m.chiffre && precedentEnClair) {
          var trait = document.createElement("div"); trait.className = "grp-jour grp-trait-chiffre"; trait.textContent = "🔒 chiffré de bout en bout à partir d\u2019ici — au-dessus, l\u2019avant";
          zone.appendChild(trait);
        }
        precedentEnClair = !m.chiffre;
        var qui = (m.qui && m.qui.pseudo) || "compte supprimé";
        var mien = (moi && m.auteur === moi) || (pseudoMoi && qui === pseudoMoi);
        var effacable = admin || mien;
        var signale = !!(sigMode && signalementLu && String(m.id) === String(signalementLu.message));
        var ligne = document.createElement("div");
        ligne.className = "grp-ligne" + (mien ? " grp-ligne-moi" : "") + (selection ? " grp-ligne-choix" : "") + (signale ? " grp-ligne-signalee" : "");
        ligne.setAttribute("data-id", m.id);
        ligne.id = "m" + m.id;   /* l'ancre qu'une notification vise (#m12) */
        /* en mode selection : une case devant chaque message qu'on peut
           effacer, et toute la ligne bascule la case */
        if (selection) {
          var caseSel = document.createElement("input"); caseSel.type = "checkbox"; caseSel.className = "grp-case";
          caseSel.checked = selection[m.id] === true; caseSel.disabled = !effacable;
          caseSel.title = effacable ? "" : "Pas à toi";
          caseSel.addEventListener("change", function () { basculerSelection(m.id, caseSel.checked); });
          ligne.appendChild(caseSel);
          if (effacable) ligne.addEventListener("click", function (ev) {
            if (ev.target === caseSel || ev.target.closest("a, button, textarea")) return;
            caseSel.checked = !caseSel.checked; basculerSelection(m.id, caseSel.checked);
          });
        }
        if (!mien) ligne.appendChild(avatarGrp(qui, true));
        var bulle = document.createElement("div"); bulle.className = "grp-bulle";
        if (!mien) { var nom = document.createElement("div"); nom.className = "grp-bulle-nom"; nom.textContent = qui; bulle.appendChild(nom); }
        /* la citation, si ce message repond a un autre */
        if (m.reponse_a) bulle.appendChild(citationDe(d, m.reponse_a));
        var p = document.createElement("p"); p.className = "grp-texte" + (m.chiffre && !(m.clair && m.clair.ok) ? " grp-texte-illisible" : ""); p.innerHTML = rendreMarkdown(texteDe(m)); bulle.appendChild(p);
        var refsM = refsDe(m);
        if (refsM.length) {
          var refs = document.createElement("div"); refs.className = "grp-refs";
          refsM.forEach(function (r) { refs.appendChild(carteRef(r)); });
          bulle.appendChild(refs);
        }
        var meta = document.createElement("div"); meta.className = "grp-bulle-meta";
        meta.textContent = m.cree_le ? new Date(m.cree_le).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";
        if (m.modifie_le) {
          var mod = document.createElement("span"); mod.className = "grp-modifie"; mod.textContent = " · modifié";
          mod.title = "Modifié le " + new Date(m.modifie_le).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
          meta.appendChild(mod);
        }
        /* « ⋯ » : repondre (tous), modifier (le sien), copier, effacer (le
           sien, ou tout pour un admin), selectionner, signaler (les messages
           des autres) — entreesMsg(). Un seul menu ouvert. Rien en lecture
           de signalement : l'administrateur du site n'ecrit pas dans le
           groupe. Le clic droit et l'appui long ouvrent la meme liste. */
        if (!selection && !sigMode) {
          var ouvrir = document.createElement("button"); ouvrir.type = "button"; ouvrir.className = "grp-points";
          ouvrir.textContent = "⋯"; ouvrir.title = "Plus"; ouvrir.setAttribute("aria-label", "Plus d'actions");
          ouvrir.addEventListener("click", function (ev) { ev.stopPropagation(); ouvrirMenuMsg(ouvrir, entreesMsg(m)); });
          meta.appendChild(document.createTextNode(" "));
          meta.appendChild(ouvrir);
        }
        /* « vu » : sur mes messages, un mot ; les noms au survol (title),
           et au toucher, ou l'on n'a pas de souris. */
        if (mien) {
          var vus = vuPar(d, m);
          var vu = document.createElement("span"); vu.className = "grp-vu";
          vu.textContent = vus.length ? " · vu" : " · envoyé";
          vu.title = vus.length ? "Vu par " + listerNoms(vus) : "Envoyé, pas encore vu";
          vu.setAttribute("data-vus", vus.join(","));
          vu.addEventListener("click", function () { direGrp(vu.title, "info"); });
          meta.appendChild(vu);
        }
        bulle.appendChild(meta);
        ligne.appendChild(bulle);
        zone.appendChild(ligne);
      });
      /* En lecture de signalement : on va au message signale (une fois), et
         s'il n'est plus la, on le dit — les precedents restent lisibles. */
      if (sigMode) {
        if (signalementLu && zone.querySelector('[data-id="' + signalementLu.message + '"]')) {
          if (!sigDefile) { sigDefile = true; allerAuMessage(signalementLu.message); }
        } else {
          var absent = document.createElement("p"); absent.className = "c-note grp-vide";
          absent.textContent = d.messages.length
            ? "Le message signalé n'existe plus (effacé par son auteur, ou par un administrateur du groupe). Ceux qui le précédaient restent lisibles."
            : "Rien à lire : la porte est fermée (verdict rendu), ou la fenêtre est vide.";
          zone.appendChild(absent);
          descendreFil(zone);
        }
        return;
      }
      /* On descend en bas seulement si on y etait deja (ou presque) : qui
         est remonte relire un vieux message ne doit pas etre ramene en bas
         par un rafraichissement. */
      if (enBas === null || enBas) descendreFil(zone);
      marquerLignes();
      /* arrive par une notification (#m12) : on va au message, une fois */
      if (!ancreVisee && /^#m\d+$/.test(location.hash)) {
        ancreVisee = true;
        if (zone.querySelector('[data-id="' + location.hash.slice(2) + '"]')) allerAuMessage(location.hash.slice(2));
      }
      marquerLu();
    }

    /* ---------- repondre a un message ----------
       « Repondre » dans le menu : le message vise s'affiche au-dessus du
       champ (qui, et le debut du texte), retirable ; il part avec le
       message (reponse_a). Dans la bulle, la citation rappelle qui et
       quoi ; cliquer remonte au message d'origine, mis en lumiere un
       instant. Origine effacee : « message supprime ». */
    var reponseEnCours = null;
    function extrait(t) { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > 90 ? t.slice(0, 88) + "…" : t; }
    function citationDe(d, idOrigine) {
      var o = d.messages.filter(function (x) { return String(x.id) === String(idOrigine); })[0];
      var c = document.createElement("button"); c.type = "button"; c.className = "grp-citation";
      var q = document.createElement("span"); q.className = "grp-citation-qui";
      var t = document.createElement("span"); t.className = "grp-citation-texte";
      if (o) {
        q.textContent = (o.qui && o.qui.pseudo) || "compte supprimé";
        t.textContent = extrait(texteDe(o));
        c.addEventListener("click", function () { allerAuMessage(o.id); });
      } else {
        q.textContent = ""; t.textContent = "message supprimé"; c.className += " grp-citation-morte"; c.disabled = true;
      }
      c.appendChild(q); c.appendChild(t);
      return c;
    }
    function allerAuMessage(id) {
      var zone = document.getElementById("grp-messages");
      var ligne = zone.querySelector('[data-id="' + id + '"]');
      if (!ligne) return;
      if (ligne.scrollIntoView) ligne.scrollIntoView({ block: "center", behavior: "smooth" });
      ligne.classList.add("grp-ligne-lumiere");
      setTimeout(function () { ligne.classList.remove("grp-ligne-lumiere"); }, 1600);
    }
    function repondreA(m) {
      if (edition) finirEdition();
      reponseEnCours = m;
      document.getElementById("grp-reponse-qui").textContent = (m.qui && m.qui.pseudo) || "compte supprimé";
      document.getElementById("grp-reponse-texte").textContent = extrait(m.texte);
      document.getElementById("grp-reponse").hidden = false;
      champTexte.focus();
    }
    function annulerReponse() {
      reponseEnCours = null;
      document.getElementById("grp-reponse").hidden = true;
    }
    document.getElementById("grp-reponse-retirer").addEventListener("click", annulerReponse);
    document.getElementById("grp-reponse").addEventListener("click", function (ev) {
      if (reponseEnCours && ev.target.id !== "grp-reponse-retirer") allerAuMessage(reponseEnCours.id);
    });

    /* ---------- selectionner plusieurs messages ----------
       « Selectionner » dans le menu : une case devant chaque message
       qu'on peut effacer, une barre au-dessus du fil avec le compte,
       Effacer, Annuler. On efface d'un seul appel ; la base trie ligne par
       ligne et repond lesquels sont partis. Echap sort du mode. */
    var selection = null;     /* null hors du mode ; sinon { id: true } */
    function entrerSelection(id) {
      selection = {}; if (id) selection[id] = true;
      peindreSelectionMsg();
      peindreDiscussion(etatGrp, etatGrp.mon_role === "admin");
    }
    function quitterSelection() {
      if (!selection) return;
      selection = null;
      document.getElementById("grp-selection").hidden = true;
      peindreDiscussion(etatGrp, etatGrp.mon_role === "admin");
    }
    function basculerSelection(id, oui) {
      if (!selection) return;
      if (oui) selection[id] = true; else delete selection[id];
      peindreSelectionMsg();
    }
    function idsSelectionnes() { return Object.keys(selection || {}); }
    function peindreSelectionMsg() {
      var n = idsSelectionnes().length;
      document.getElementById("grp-selection").hidden = !selection;
      document.getElementById("grp-selection-compte").textContent = n + " sélectionné" + (n > 1 ? "s" : "");
      document.getElementById("grp-selection-effacer").disabled = !n;
    }
    document.getElementById("grp-selection-annuler").addEventListener("click", quitterSelection);
    document.getElementById("grp-selection-effacer").addEventListener("click", function () {
      var ids = idsSelectionnes();
      if (!ids.length) return;
      if (typeof confirm === "function" && !confirm("Effacer " + ids.length + " message" + (ids.length > 1 ? "s" : "") + " ? C'est définitif.")) return;
      appelGrp("DELETE", "/api/groupes/" + idGrp + "/messages?ids=" + ids.join(",")).then(function (x) {
        if (!x.ok) { direGrp(x.d.erreur || "Échec.", "erreur"); return; }
        selection = null;
        document.getElementById("grp-selection").hidden = true;
        (x.d.effaces || []).forEach(function (id) {
          etatGrp.messages = etatGrp.messages.filter(function (y) { return String(y.id) !== String(id); });
        });
        empreinteGrp = empreinte(etatGrp);
        peindreDiscussion(etatGrp, etatGrp.mon_role === "admin");
        if (!direct.actif) chargerGroupe(true);
      }).catch(function () { direGrp("Service indisponible.", "erreur"); });
    });
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") quitterSelection(); });

    /* ---------- j'ai lu jusqu'ici ----------
       Quand la discussion est sous les yeux (onglet visible) et qu'un
       message plus recent que ma derniere marque est affiche, on le note
       — une fois, apres une seconde de calme. Pas quand l'onglet est
       cache : « vu » veut dire vu. */
    var lectureNotee = 0, minuterieLu = null;
    function maLecture() {
      var moi = etatGrp && idDeMoi(etatGrp);
      var l = moi && (etatGrp.lectures || []).filter(function (y) { return y.membre === moi; })[0];
      return Math.max(lectureNotee, l ? Number(l.dernier_lu) : 0);
    }
    function marquerLu() {
      titreGroupe();
      if (document.hidden || !etatGrp || etatGrp.mon_statut !== "accepte" || !etatGrp.messages.length) return;
      var dernier = 0;
      etatGrp.messages.forEach(function (m) { dernier = Math.max(dernier, Number(m.id) || 0); });
      if (dernier <= maLecture()) return;
      lectureNotee = dernier;
      titreGroupe();
      if (minuterieLu) clearTimeout(minuterieLu);
      minuterieLu = setTimeout(function () {
        appelGrp("POST", "/api/groupes/" + idGrp + "/lecture", { dernier_lu: dernier }).then(function (x) {
          if (!x.ok) return;
          poserLecture(idDeMoi(etatGrp), Number(x.d.dernier_lu) || dernier);
          /* la lecture est notee : la pastille de l'en-tete et la ligne de
             cette discussion dans la liste doivent tomber maintenant, pas a
             la prochaine actualisation */
          rafraichirNonLus();
        }).catch(function () {});
      }, 1000);
    }
    /* Une lecture (la mienne relue, ou celle d'un autre, par le direct). */
    function poserLecture(membre, dernier) {
      if (!etatGrp || !membre) return;
      etatGrp.lectures = etatGrp.lectures || [];
      var l = etatGrp.lectures.filter(function (y) { return y.membre === membre; })[0];
      if (l) { if (Number(l.dernier_lu) >= dernier) return; l.dernier_lu = dernier; }
      else etatGrp.lectures.push({ membre: membre, dernier_lu: dernier });
      empreinteGrp = empreinte(etatGrp);
      if (membre !== idDeMoi(etatGrp)) peindreDiscussion(etatGrp, etatGrp.mon_role === "admin");
    }
    if (window.addEventListener) window.addEventListener("focus", marquerLu);

    function carteSeance(s, admin) {
      var c = document.createElement("div");
      var debut = new Date(s.debut);
      var passee = new Date(s.fin || s.debut) < new Date();
      c.className = "grp-seance" + (passee ? " grp-passee" : "");
      var date = document.createElement("div"); date.className = "grp-date";
      var j = document.createElement("strong"); j.textContent = String(debut.getDate());
      var mo = document.createElement("span"); mo.textContent = debut.toLocaleDateString("fr-FR", { month: "short" });
      date.appendChild(j); date.appendChild(mo);
      c.appendChild(date);
      var corps = document.createElement("div"); corps.className = "grp-seance-corps";
      var t = document.createElement("div"); t.className = "grp-carte-titre"; t.textContent = s.titre; corps.appendChild(t);
      var h = document.createElement("div"); h.className = "c-note";
      h.textContent = debut.toLocaleDateString("fr-FR", { weekday: "long" }) + " "
        + debut.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
        + (s.fin ? " → " + new Date(s.fin).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "")
        + (s.lieu ? " · " + s.lieu : "");
      corps.appendChild(h);
      if (s.note) { var n = document.createElement("p"); n.className = "grp-carte-desc"; n.textContent = s.note; corps.appendChild(n); }
      var pied = document.createElement("div"); pied.className = "grp-carte-pied";
      /* toutes les fiches de la seance (« fiches » ; a defaut l'ancienne « fiche ») */
      fichesDeSeance(s).forEach(function (f) { pied.appendChild(lienFiche(f)); });
      if (Array.isArray(s.rappels) && s.rappels.length) {
        var rp = document.createElement("span"); rp.className = "c-note grp-rappels";
        rp.textContent = "🔔 " + s.rappels.map(libelleRappel).join(", ");
        rp.title = "Rappel " + s.rappels.map(libelleRappel).join(", ") + " — pour qui a activé les rappels";
        pied.appendChild(rp);
      }
      if (s.auteur && s.auteur.pseudo) {
        var par = document.createElement("span"); par.className = "c-note";
        par.appendChild(avatarGrp(s.auteur.pseudo, true));
        par.appendChild(document.createTextNode(" " + s.auteur.pseudo));
        pied.appendChild(par);
      }
      if (admin || (s.auteur && s.auteur.pseudo === pseudoMoi)) {
        var mod = document.createElement("button"); mod.type = "button"; mod.className = "lien-bouton"; mod.textContent = "modifier";
        mod.addEventListener("click", function () { editerSeance(s); });
        pied.appendChild(mod);
        var ret = document.createElement("button"); ret.type = "button"; ret.className = "lien-bouton"; ret.textContent = "retirer";
        ret.addEventListener("click", function () {
          appelGrp("DELETE", "/api/groupes/" + idGrp + "/seances?id=" + s.id).then(function (x) {
            if (!x.ok) { direGrp(x.d.erreur || "Échec.", "erreur"); return; }
            direGrp("Séance retirée.", "succes"); chargerGroupe();
          });
        });
        pied.appendChild(ret);
      }
      corps.appendChild(pied);
      c.appendChild(corps);
      return c;
    }

    /* ---------- la chaine de confiance, cote page ----------
       Miroir de peut_agir_sur() (supabase/2026_roles_groupe.sql), pour
       montrer ou cacher les boutons : le fondateur ne se touche pas et
       peut tout ; un simple membre ou un invite se retire par tout admin ;
       un administrateur, seulement par ceux de sa chaine (promu_par, puis
       le promu_par de celui-la…) — ou par lui-meme. C'est la base qui
       refuse pour de vrai : ici on evite juste de proposer un bouton qui
       menerait a un refus. */
    function peutAgirSur(d, cible) {
      if (d.mon_role !== "admin" || d.mon_statut !== "accepte") return false;
      if (cible.id === d.fondateur) return false;
      if (d.mon_id === d.fondateur) return true;
      if (cible.role !== "admin") return true;
      if (cible.id === d.mon_id) return true;
      var parId = {};
      d.membres.forEach(function (m) { parId[m.id] = m; });
      var p = cible.promu_par, n = 0;
      while (p && n < 100) {
        if (p === d.mon_id) return true;
        p = parId[p] ? parId[p].promu_par : null;
        n++;
      }
      return false;
    }

    function ligneMembre(m, d) {
      var admin = d.mon_role === "admin";
      var li = document.createElement("li");
      li.setAttribute("data-membre", m.id);
      li.appendChild(avatarGrp(m.pseudo));
      var t = document.createElement("div"); t.className = "grp-membre-texte";
      var n = document.createElement("div"); n.className = "grp-carte-titre"; n.textContent = m.pseudo;
      if (m.pseudo === pseudoMoi) n.textContent += " (toi)";
      t.appendChild(n);
      var s = document.createElement("div"); s.className = "c-note";
      s.textContent = "depuis le " + quandGrp(m.depuis);
      /* qui l'a nomme : le maillon de la chaine, lisible par tous */
      if (m.role === "admin" && m.statut === "accepte" && !m.fondateur && m.promu_par) {
        var parQui = d.membres.filter(function (x) { return x.id === m.promu_par; })[0];
        if (parQui) s.textContent += " · nommé par " + parQui.pseudo;
      }
      t.appendChild(s);
      li.appendChild(t);
      var p = document.createElement("span");
      p.className = "grp-pastille" + (m.statut === "invite" ? " grp-pastille-attente" : (m.role === "admin" ? (m.fondateur ? " grp-pastille-fondateur" : "") : " grp-pastille-neutre"));
      p.textContent = m.statut === "invite" ? "invité" : (m.fondateur ? "fondateur" : (m.role === "admin" ? "admin" : "membre"));
      li.appendChild(p);
      /* demander cette personne en contact (decision 4 : le groupe ne fait
         pas le contact, la demande si). Proposition 6 du 24 septembre : le
         bouton disait « + contact » quoi qu'il en soit, et il fallait cliquer
         pour apprendre qu'on avait deja demande. Il dit maintenant OU l'on
         en est avec cette personne — /api/contacts servait deja les demandes
         envoyees et recues, la page ne les lisait pas :
           contact             → « écrire » (lot H)
           demande envoyee     → « demande envoyée » (pas un bouton : il n'y a
                                  rien a faire, c'est a l'autre de repondre)
           refusee             → « demande refusée » (idem)
           l'autre m'a demande → « accepter sa demande » (le POST accepte)
           rien                → « + contact »
         Le bouton attend de savoir avant de se montrer : un « + contact »
         qui devient « demande envoyée » une demi-seconde plus tard, c'est le
         defaut meme. Liste illisible (hors ligne, table absente) : on
         retombe sur « + contact », et la route dit le reste. */
      if (!sigMode && !d.groupe.prive && m.pseudo !== pseudoMoi && m.statut === "accepte" && m.pseudo !== "compte supprimé") {
        var ct = document.createElement("button"); ct.type = "button"; ct.hidden = true;
        var etatCt = "aucun";
        var peindreCt = function (etat, depuis) {
          etatCt = etat;
          var bouton = etat === "aucun" || etat === "recue" || etat === "contact";
          ct.disabled = !bouton;
          ct.className = "lien-bouton " + (etat === "contact" ? "grp-ecrire-a" : bouton ? "grp-demander-contact" : "grp-contact-etat");
          ct.textContent = { contact: "écrire", envoyee: "demande envoyée", refusee: "demande refusée",
                             recue: "accepter sa demande", aucun: "+ contact" }[etat];
          ct.title = etat === "contact" ? "Écrire à " + m.pseudo + " en privé"
                   : etat === "envoyee" ? "Tu as demandé " + m.pseudo + " en contact" + (depuis ? " le " + quandGrp(depuis) : "") + " : c'est à cette personne de répondre."
                   : etat === "refusee" ? m.pseudo + " a refusé ta demande de contact."
                   : etat === "recue" ? m.pseudo + " te demande en contact : accepter"
                   : "Demander " + m.pseudo + " en contact";
          ct.hidden = false;
        };
        ct.addEventListener("click", function () {
          if (etatCt === "contact") { ecrireA(m.id, m.pseudo); return; }
          if (etatCt !== "aucun" && etatCt !== "recue") return;
          ct.disabled = true;
          appelGrp("POST", "/api/contacts", { pseudo: m.pseudo }).then(function (x) {
            contactsCharges = null;   /* la liste a change : la relire la prochaine fois */
            if (!x.ok) { ct.disabled = false; direGrp(x.d.erreur || "Échec.", x.d.indisponible ? "info" : "erreur"); return; }
            direGrp(x.d.etat === "accepte" ? m.pseudo + " te demandait aussi : vous êtes en contact." : "Demande envoyée à " + m.pseudo + ".", "succes");
            peindreCt(x.d.etat === "accepte" ? "contact" : "envoyee", new Date().toISOString());
          }).catch(function () { ct.disabled = false; direGrp("Service indisponible.", "erreur"); });
        });
        li.appendChild(ct);
        listeContacts().then(function (c) {
          var avec = function (liste) { return (liste || []).filter(function (k) { return k.membre === m.id; })[0]; };
          var k;
          if (avec(c.contacts)) peindreCt("contact");
          else if ((k = avec(c.envoyees))) peindreCt(k.etat === "refuse" ? "refusee" : "envoyee", k.cree_le);
          else if (avec(c.recues)) peindreCt("recue");
          else peindreCt("aucun");
        });
      }
      if (admin && m.id !== d.mon_id) {
        var actions = document.createElement("span"); actions.className = "grp-membre-actions";
        /* nommer : tout administrateur, sur un membre accepte */
        if (m.statut === "accepte" && m.role !== "admin") {
          var nommer = document.createElement("button"); nommer.type = "button"; nommer.className = "lien-bouton grp-nommer";
          nommer.textContent = "nommer admin";
          nommer.addEventListener("click", function () {
            appelGrp("PATCH", "/api/groupes/" + idGrp + "/membres", { membre: m.id, role: "admin" }).then(function (x) {
              if (!x.ok) { direGrp(x.d.erreur || "Échec.", x.d.indisponible ? "info" : "erreur"); return; }
              chargerGroupe();
            });
          });
          actions.appendChild(nommer);
        }
        /* retirer l'administration, retirer du groupe : la chaine decide */
        if (peutAgirSur(d, m)) {
          if (m.statut === "accepte" && m.role === "admin") {
            var retro = document.createElement("button"); retro.type = "button"; retro.className = "lien-bouton grp-retrograder";
            retro.textContent = "retirer l'administration";
            retro.addEventListener("click", function () {
              appelGrp("PATCH", "/api/groupes/" + idGrp + "/membres", { membre: m.id, role: "membre" }).then(function (x) {
                if (!x.ok) { direGrp(x.d.erreur || "Échec.", x.d.indisponible ? "info" : "erreur"); return; }
                chargerGroupe();
              });
            });
            actions.appendChild(retro);
          }
          var ret = document.createElement("button"); ret.type = "button"; ret.className = "lien-bouton grp-retirer"; ret.textContent = "retirer";
          ret.addEventListener("click", function () {
            if (!confirm("Retirer " + m.pseudo + " du groupe ?")) return;
            appelGrp("DELETE", "/api/groupes/" + idGrp + "/membres?membre=" + m.id).then(function (x) {
              if (!x.ok) { direGrp(x.d.erreur || "Échec.", x.d.indisponible ? "info" : "erreur"); return; }
              chargerGroupe();
            });
          });
          actions.appendChild(ret);
        }
        if (actions.childNodes.length) li.appendChild(actions);
      }
      return li;
    }

    /* le titre de l'onglet : « (2) nom — groupe » tant que des messages
       depassent ma marque de lecture — donc surtout quand l'onglet est
       cache et que le direct en apporte ; visible, marquerLu() note la
       lecture et le compte retombe a 0 */
    function titreGroupe() {
      if (!etatGrp || sigMode) return;
      var marque = maLecture(), n = 0;
      (etatGrp.messages || []).forEach(function (m) { if ((Number(m.id) || 0) > marque) n++; });
      titreAvecNonLus(n);
    }
    function peindreGroupe(d) {
      etatGrp = d;
      var g = d.groupe;
      /* une conversation privee (lot H) : le pseudo de l'autre en titre,
         son avatar, pas d'onglets, un « ⋯ » pour quitter ; fermee (plus en
         contact, ou l'autre parti) : plus de composeur, une banniere */
      var prive = !!g.prive;
      var app = document.getElementById("msg-app");
      if (app) app.classList.toggle("msg-privee", prive);
      var nomConv = prive ? (d.avec ? d.avec.pseudo : "Conversation privée") : g.nom;
      titreGrp.textContent = nomConv;
      document.title = prive ? nomConv + " — message privé" : g.nom + " — groupe";
      TITRE_SANS_COMPTE = document.title;
      titreGroupe();
      document.getElementById("grp-desc").textContent = prive
        ? (d.avec ? "Conversation privée" : "L’autre personne a quitté la conversation")
        : (g.description || "");
      var avatars = document.getElementById("grp-avatars");
      avatars.textContent = "";
      if (prive) { if (d.avec) avatars.appendChild(avatarGrp(d.avec.pseudo)); }
      else d.membres.filter(function (m) { return m.statut === "accepte"; }).slice(0, 6).forEach(function (m) { avatars.appendChild(avatarGrp(m.pseudo)); });
      document.getElementById("grp-tete-menu").hidden = !prive || !!sigMode;
      var fermee = prive && !d.ouverte;
      var noteP = document.getElementById("grp-prive-note");
      noteP.hidden = !fermee;
      if (fermee) noteP.querySelector("p").textContent = d.avec
        ? "Vous n’êtes plus en contact. La conversation reste lisible, mais on ne peut plus y écrire — jusqu’à ce que l’un de vous redemande l’autre en contact, et que l’autre accepte."
        : "L’autre personne a quitté la conversation. Ce qui a été écrit reste lisible ; personne ne peut plus y écrire.";
      if (!sigMode) document.getElementById("grp-form-message").hidden = fermee;
      document.getElementById("grp-texte").placeholder = prive ? "Écrire à " + nomConv + "…" : "Écrire au groupe…";
      peindreEtatChiffre(d, prive, fermee);
      document.getElementById("grp-ref-seance").hidden = prive;
      document.getElementById("grp-messages").classList.toggle("grp-fil-prive", prive);
      if (prive) ongletGrp("discussion");
      var invite = d.mon_statut === "invite";
      document.getElementById("grp-invite-banniere").hidden = !invite;
      document.getElementById("grp-onglets").hidden = invite || prive;
      if (d.mon_statut === "accepte" && !sigMode) proposerNotifs(document.getElementById("grp-onglets"));
      document.querySelectorAll(".admin-section").forEach(function (s) { if (invite) s.hidden = true; });
      if (invite) return;
      var admin = d.mon_role === "admin";

      peindreDiscussion(d, admin, nouveauxMessages);

      var zs = document.getElementById("grp-seances");
      zs.textContent = "";
      var aVenir = d.seances.filter(function (s) { return new Date(s.fin || s.debut) >= new Date(); });
      var badge = document.getElementById("grp-badge-seances");
      badge.textContent = String(aVenir.length); badge.hidden = !aVenir.length;
      if (!d.seances.length) { var v2 = document.createElement("p"); v2.className = "c-note grp-vide"; v2.textContent = "Aucune séance proposée."; zs.appendChild(v2); }
      d.seances.slice().sort(function (a, b) { return new Date(b.debut) - new Date(a.debut); })
        .sort(function (a, b) {
          var pa = new Date(a.fin || a.debut) < new Date(), pb = new Date(b.fin || b.debut) < new Date();
          return pa === pb ? 0 : (pa ? 1 : -1);
        })
        .forEach(function (s) { zs.appendChild(carteSeance(s, admin)); });

      var um = document.getElementById("grp-membres");
      um.textContent = "";
      var acceptes = d.membres.filter(function (m) { return m.statut === "accepte"; }).length;
      var bm = document.getElementById("grp-badge-membres");
      bm.textContent = String(acceptes); bm.hidden = !acceptes;
      document.getElementById("grp-membres-note").textContent = acceptes + " membre" + (acceptes > 1 ? "s" : "")
        + (d.membres.length - acceptes ? ", " + (d.membres.length - acceptes) + " invitation" + (d.membres.length - acceptes > 1 ? "s" : "") + " en attente" : "");
      d.membres.forEach(function (m) { um.appendChild(ligneMembre(m, d)); });
      /* inviter : qui en a le droit (administrateur, ou membre si le groupe
         le permet) ; parametres : les administrateurs ; fondation et
         suppression : le fondateur (dans Parametres) */
      var peutInv = d.peut_inviter === undefined ? admin : !!d.peut_inviter;
      document.getElementById("grp-ouvrir-inviter").hidden = !peutInv;
      peindreMesSignalements(d);
      document.getElementById("grp-parametres").hidden = !admin;
      document.getElementById("grp-chaine-note").hidden = !admin;
      document.getElementById("grp-p-fondation").hidden = d.mon_id !== d.fondateur;
    }

    /* ---------- l'etat du chiffrement, a l'ecran ----------
       Sous le titre : chiffre depuis quand, pas encore chiffre et pourquoi,
       cle absente sur cet appareil. Les fenetres du trousseau s'ouvrent
       d'elles-memes dans une conversation privee : creer ses cles (une
       fois), ou entrer sa phrase — « Plus tard » ramene a la liste. */
    function peindreEtatChiffre(d, prive, fermee) {
      var ligne = document.getElementById("grp-chiffre-etat"), alerte = document.getElementById("grp-cles-alerte");
      var form = document.getElementById("grp-form-message");
      var g = d.groupe;
      ligne.hidden = true; alerte.hidden = true;
      if (!prive || sigMode) {
        if (sigMode && signalementLu && signalementLu.chiffre) { ligne.hidden = false; ligne.textContent = "🔒 Conversation chiffrée : tu lis ce que la personne qui a signalé a déchiffré et transmis."; }
        return;
      }
      ligne.hidden = false;
      if (!chiffrementDisponible()) {
        ligne.textContent = g.chiffre_depuis ? "🔒 Conversation chiffrée — ce navigateur ne sait pas la déchiffrer (WebCrypto absent)." : "🔓 Pas encore chiffrée — ce navigateur ne sait pas chiffrer.";
        if (g.chiffre_depuis) form.hidden = true;
        return;
      }
      var tr = trousseau, autre = etatChiffre.autre;
      if (tr.statut === "indisponible") {
        ligne.textContent = g.chiffre_depuis ? "🔒 Conversation chiffrée — le chiffrement n\u2019est pas ouvert sur ce site : illisible." : "🔓 Pas encore chiffrée (le chiffrement n\u2019est pas encore ouvert sur ce site).";
        if (g.chiffre_depuis) form.hidden = true;
        return;
      }
      if (tr.statut === "aucune") {
        /* K3 : on ne demande RIEN. Les cles se creent en silence, la
           conversation s'ouvre, et la sauvegarde se propose ensuite (sous le
           titre, et dans les parametres). Sans la migration K3, l'ancien
           chemin revient : la phrase d'abord. */
        ligne.textContent = "🔒 Création de tes clés de chiffrement…";
        form.hidden = true;
        if (!etatChiffre.creation && !fermee) {
          etatChiffre.creation = true;
          trousseau.creerSansPhrase().then(function () { chargerGroupe(); }, function (e) {
            if (e && e.indisponible) {
              etatChiffre.dialogue = true;
              dialoguePremiereFois({ surFini: function () { etatChiffre.dialogue = false; chargerGroupe(); }, surPlusTard: function () { location.href = "index.html#prives"; } });
              return;
            }
            ligne.textContent = "🔓 Impossible de créer tes clés ici : " + ((e && e.message) || "échec") + ".";
          });
        }
        return;
      }
      if (tr.statut === "verrouillee") {
        /* « entre ta phrase » etait faux depuis K2 (une passkey, un autre
           appareil) et l'est encore plus depuis K3 (on peut n'avoir AUCUNE
           phrase) : la fenetre sait quels chemins existent. */
        ligne.textContent = "🔑 Tes clés ne sont pas sur cet appareil.";
        var b = document.createElement("button"); b.type = "button"; b.className = "lien-bouton"; b.textContent = "Déverrouiller";
        b.addEventListener("click", function () { ouvrirDeverrouillage(); });
        ligne.appendChild(document.createTextNode(" ")); ligne.appendChild(b);
        form.hidden = true;
        if (!etatChiffre.dialogue && !fermee) { etatChiffre.dialogue = true; ouvrirDeverrouillage(); }
        return;
      }
      /* statut ok */
      if (etatChiffre.alerte && autre) {
        alerte.hidden = false;
        document.getElementById("grp-cles-alerte-qui").textContent = autre.pseudo;
        document.getElementById("grp-cles-alerte-quand").textContent = etatChiffre.alerte.quand ? "(le " + quandGrp(etatChiffre.alerte.quand) + ")" : "";
        document.getElementById("grp-cles-alerte-empreinte").textContent = etatChiffre.alerte.empreinte;
        form.hidden = true;
        ligne.textContent = "⚠ Les clés de " + autre.pseudo + " ont changé : à confirmer avant de lire ses nouveaux messages ou de lui écrire.";
        return;
      }
      /* K3 : aucune sauvegarde → on le dit sous le titre, discretement, a
         chaque fois (un rappel qu'on peut ignorer, pas une fenetre). */
      trousseau.etatSauvegardes().then(function (s) {
        var z = document.getElementById("grp-sauvegarde");
        if (!z) return;
        z.hidden = !!s.sures;
      }).catch(function () {});
      if (g.chiffre_depuis) {
        ligne.textContent = "🔒 Chiffré de bout en bout depuis le " + quandGrp(g.chiffre_depuis) + ".";
        if (etatChiffre.conv && Number(etatChiffre.conv.version_courante) && !etatChiffre.cles[etatChiffre.conv.version_courante] && !Object.keys(etatChiffre.cles).length) {
          ligne.textContent += " Historique en attente : " + (autre ? autre.pseudo : "l\u2019autre") + " doit te le rendre (tes clés ont changé).";
        }
      } else if (autre && autre.courante) {
        ligne.textContent = "🔓 Pas encore chiffrée : ton prochain message la chiffrera de bout en bout.";
      } else if (autre) {
        ligne.textContent = "🔓 Pas encore chiffrée : " + autre.pseudo + " n\u2019a pas activé le chiffrement — tes messages partent en clair.";
      }
    }
    function ouvrirDeverrouillage() {
      dialogueDeverrouiller({
        surOk: function () { etatChiffre.dialogue = false; etatChiffre.cles = {}; etatChiffre.brutes = {}; clairs = {}; chargerGroupe(); },
        surAnnule: function () { etatChiffre.dialogue = true; /* on ne le redemande pas tant que la page vit */ },
        surRegenerer: function () { regenererCles(function () { etatChiffre.dialogue = false; etatChiffre.cles = {}; etatChiffre.brutes = {}; clairs = {}; chargerGroupe(); }); },
      });
    }
    document.getElementById("grp-cles-accepter").addEventListener("click", function () {
      var b = document.getElementById("grp-cles-accepter"); b.disabled = true;
      accepterClesDeLAutre().then(function (n) {
        b.disabled = false;
        direGrp(n ? "Clés acceptées ; " + n + " clé" + (n > 1 ? "s" : "") + " de conversation rendue" + (n > 1 ? "s" : "") + "." : "Clés acceptées.", "succes");
        chargerGroupe();
      }).catch(function () { b.disabled = false; direGrp("Échec.", "erreur"); });
    });
    document.getElementById("grp-cles-plus-tard").addEventListener("click", function () { document.getElementById("grp-cles-alerte").hidden = true; });

    /* « silencieux » : le rafraichissement periodique. Il ne repeint que si
       la reponse a change (empreinte des messages, seances, membres), pour
       ne pas faire sauter la page sous les yeux de qui lit ou ecrit ; et il
       ne dit rien en cas de panne passagere — le prochain tour reessaiera. */
    var empreinteGrp = "";
    function empreinte(d) {
      return JSON.stringify([
        d.messages.map(function (m) { return [m.id, m.modifie_le || ""]; }),
        (d.lectures || []).map(function (l) { return [l.membre, l.dernier_lu]; }),
        d.seances.map(function (s) { return [s.id, s.titre, s.debut, s.fin, s.lieu]; }),
        d.membres.map(function (m) { return [m.id, m.role, m.statut, m.promu_par || ""]; }),
        d.groupe.nom, d.groupe.description, JSON.stringify(d.groupe.parametres || null),
        d.mon_role, d.mon_statut, d.fondateur || "", d.peut_inviter,
        !!d.groupe.prive, d.ouverte, d.avec ? d.avec.id + d.avec.pseudo : "", d.groupe.chiffre_depuis || "",
        (d.mes_signalements || []).map(function (x) { return [x.id, x.verdict || ""]; })
      ]);
    }
    function chargerGroupe(silencieux) {
      if (!idGrp) { direGrp("Aucun groupe demandé.", "erreur"); return; }
      appelGrp("GET", "/api/groupes/" + encodeURIComponent(idGrp) + (sigMode ? "?fenetre=1" : "")).then(function (x) {
        if (!x.ok) {
          /* en lecture de signalement, un 404 est la porte fermee (verdict
             rendu, ou groupe disparu) : on le dit ainsi, pas « tu n'en fais
             pas partie » — c'est vrai, mais ce n'est pas la question */
          if (sigMode && x.statut === 404) { direGrp("Porte fermée : la discussion n'est plus lisible (verdict rendu, ou groupe supprimé).", "info"); return; }
          if (!silencieux) direGrp(x.d.erreur || "Accès refusé.", x.d.indisponible ? "info" : "erreur");
          return;
        }
        var e = empreinte(x.d);
        if (silencieux && e === empreinteGrp) return;
        empreinteGrp = e;
        nouveauxMessages = !etatGrp || x.d.messages.length > etatGrp.messages.length;
        /* le chiffrement d'abord (cles, enveloppes, messages dechiffres),
           la peinture ensuite */
        preparerChiffre(x.d, silencieux).then(function () {
          peindreGroupe(x.d);
          nouveauxMessages = false;
        });
      }).catch(function () { if (!silencieux) direGrp("Service indisponible.", "erreur"); });
    }
    /* Toutes les 15 s, seulement quand l'onglet est visible : une page
       ouverte dans un coin ne doit pas interroger la base toute la nuit —
       et chaque relecture est une execution de fonction, que le plan
       gratuit compte. Au retour sur l'onglet, on relit tout de suite. */
    /* l'etat de la connexion directe (voir « en direct », plus bas) — declare
       ici parce que le rythme du sondage en depend des le depart */
    var direct = { ws: null, actif: false, coeur: null, ref: 0, refJonction: null, jeton: null, replie: false,
                   tentative: 0, minuterieRetour: null, derniereFrappe: 0, minuterieFrappe: null };
    var PERIODE_GRP = 15000;          /* sans le direct */
    var PERIODE_GRP_DIRECT = 90000;   /* avec : un filet, au cas ou */
    var minuterieGrp = null;
    function armerRafraichissement() {
      if (minuterieGrp) clearInterval(minuterieGrp);
      minuterieGrp = null;
      if (document.hidden || sigMode) return;
      minuterieGrp = setInterval(function () { chargerGroupe(true); }, direct.actif ? PERIODE_GRP_DIRECT : PERIODE_GRP);
    }
    document.addEventListener("visibilitychange", function () {
      if (sigMode) return;   /* une lecture, pas un suivi : rien a relire */
      if (!document.hidden) { chargerGroupe(true); connecterDirect(); marquerLu(); }
      else fermerDirect();
      armerRafraichissement();
    });
    armerRafraichissement();

    /* ---------- en direct ----------
       Plutot que de relire la base toutes les 15 s — une execution de
       fonction a chaque fois —, la page ouvre une connexion directe a
       Supabase (Realtime, WebSocket) et recoit ce qui change : un message
       insere, une seance modifiee, un membre qui arrive. Le canal est
       prive : la base n'y admet que les membres du groupe
       (supabase/2026_temps_reel.sql). Elle sert aussi a dire « untel est
       en train d'ecrire », sans rien ecrire en base.

       Le protocole est celui de Phoenix, en JSON : rejoindre un sujet,
       un battement de coeur toutes les 30 s, des evenements. Une centaine
       de lignes suffisent ; on ne charge aucune bibliotheque.

       Quand le direct tombe (jeton expire, reseau), le sondage reprend
       son rythme de 15 s, et on retente avec un delai croissant. Onglet
       cache : on coupe, pour ne pas tenir une connexion pour rien. */
    function sujetDirect() { return "realtime:groupe:" + idGrp; }
    function envoyerDirect(m) {
      if (!direct.ws || direct.ws.readyState !== 1) return null;
      m.ref = String(++direct.ref);
      direct.ws.send(JSON.stringify(m));
      return m.ref;
    }
    function connecterDirect() {
      if (!idGrp || document.hidden || direct.ws || sigMode) return;
      if (!window.CONFIG || !CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey || !window.WebSocket) {
        if (window.console && console.log) console.log("[direct] pas de réglages Supabase sur cette page : sondage seulement");
        return;
      }
      appelGrp("GET", "/api/groupes/temps-reel").then(function (x) {
        if (!x.ok || !x.d.jeton) {               /* pas de compte : le sondage suffit */
          if (window.console && console.log) console.log("[direct] pas de jeton (" + x.statut + ") : sondage seulement");
          return;
        }
        direct.jeton = x.d.jeton;
        ouvrirDirect();
      }).catch(function () {});
    }
    function ouvrirDirect() {
      if (direct.ws) return;
      var url = CONFIG.supabaseUrl.replace(/^http/, "ws") + "/realtime/v1/websocket?apikey="
              + encodeURIComponent(CONFIG.supabaseAnonKey) + "&vsn=1.0.0";
      var ws;
      try { ws = new WebSocket(url); } catch (e) { return; }
      direct.ws = ws;
      ws.onopen = function () {
        rejoindreDirect();
        direct.coeur = setInterval(function () { envoyerDirect({ topic: "phoenix", event: "heartbeat", payload: {} }); }, 30000);
      };
      ws.onmessage = function (e) {
        var m; try { m = JSON.parse(e.data); } catch (err) { return; }
        recevoirDirect(m);
      };
      ws.onclose = function () { perdreDirect(true); };
      ws.onerror = function () { /* onclose suit */ };
    }
    /* La jonction. Une table absente de la publication (migration pas
       encore passee : lectures, par exemple) fait echouer TOUTE la
       jonction. On demande d'abord tout ; refuse, on redemande sans les
       tables optionnelles (« replie ») avant de conclure a un vrai refus. */
    function rejoindreDirect() {
      var filtre = "groupe=eq." + idGrp;
      var tables = [
        { event: "INSERT", schema: "public", table: "messages", filter: filtre },
        { event: "UPDATE", schema: "public", table: "messages", filter: filtre },
        { event: "DELETE", schema: "public", table: "messages", filter: filtre },
        { event: "*", schema: "public", table: "seances", filter: filtre },
        { event: "*", schema: "public", table: "membres", filter: filtre }];
      if (!direct.replie) tables.push({ event: "*", schema: "public", table: "lectures", filter: filtre });
      direct.refJonction = envoyerDirect({ topic: sujetDirect(), event: "phx_join", payload: {
        access_token: direct.jeton,
        config: { broadcast: { self: false }, presence: { key: "" }, private: true, postgres_changes: tables } } });
    }
    function fermerDirect() {
      var ws = direct.ws;
      direct.ws = null;
      if (direct.coeur) clearInterval(direct.coeur);
      direct.coeur = null;
      if (direct.minuterieRetour) clearTimeout(direct.minuterieRetour);
      direct.minuterieRetour = null;
      direct.actif = false;
      document.getElementById("grp-direct").hidden = true;
      if (ws) { ws.onclose = null; try { ws.close(); } catch (e) {} }
    }
    function perdreDirect(retenter) {
      var etaitActif = direct.actif;
      fermerDirect();
      if (etaitActif) armerRafraichissement();       /* le sondage reprend a 15 s */
      if (!retenter || document.hidden) return;
      direct.tentative++;
      var delai = Math.min(300000, 2000 * Math.pow(3, direct.tentative - 1));   /* 2 s, 6 s, 18 s… 5 min */
      direct.minuterieRetour = setTimeout(connecterDirect, delai);
    }
    function recevoirDirect(m) {
      if (m.event === "phx_reply" && m.ref === direct.refJonction) {
        if (m.payload && m.payload.status === "ok") {
          if (window.console && console.log) console.log("[direct] canal rejoint" + (direct.replie ? " (sans lectures)" : ""));
          direct.actif = true; direct.tentative = 0;
          document.getElementById("grp-direct").hidden = false;
          armerRafraichissement();                    /* rythme lent */
          chargerGroupe(true);                        /* ce qui a pu passer entre-temps */
        } else if (!direct.replie) {
          /* premier refus : on reessaie sans les tables optionnelles */
          direct.replie = true;
          if (window.console && console.log) console.log("[direct] jonction refusée, on réessaie sans lectures :", JSON.stringify(m.payload));
          rejoindreDirect();
        } else {
          /* refuse deux fois : pas membre, jeton mort, migration absente.
             On n'insiste pas tout de suite. */
          if (window.console && console.log) console.log("[direct] jonction refusée :", JSON.stringify(m.payload));
          direct.tentative = Math.max(direct.tentative, 3);
          perdreDirect(true);
        }
        return;
      }
      if (m.event === "phx_error" || m.event === "phx_close") { perdreDirect(true); return; }
      if (m.event === "system" && m.payload && m.payload.status === "error") { perdreDirect(true); return; }
      if (m.event === "postgres_changes" && m.payload && m.payload.data) {
        var d = m.payload.data;
        if (d.table === "messages" && d.type === "INSERT" && d.record) { ajouterMessageDirect(d.record); return; }
        if (d.table === "messages" && d.type === "UPDATE" && d.record) { modifierMessageDirect(d.record); return; }
        if (d.table === "messages" && d.type === "DELETE" && d.old_record) { retirerMessageDirect(d.old_record.id); return; }
        if (d.table === "lectures" && d.record) { poserLecture(d.record.membre, Number(d.record.dernier_lu) || 0); return; }
        chargerGroupe(true);                          /* seances, membres : on relit */
        return;
      }
      if (m.event === "broadcast" && window.console && console.log) console.log("[direct] diffusion reçue :", JSON.stringify(m.payload));
      if (m.event === "broadcast" && m.payload && m.payload.event === "frappe") {
        var qui = m.payload.payload && m.payload.payload.pseudo;
        if (window.console && console.log) console.log("[direct] frappe reçue de", qui);
        if (qui && qui !== pseudoMoi) montrerFrappe(qui);
      }
    }
    /* Un message recu : on le pose dans l'etat courant et on repeint la
       discussion — sans demander quoi que ce soit au serveur. Le pseudo
       vient de la liste des membres deja chargee. */
    function ajouterMessageDirect(r) {
      if (!etatGrp || String(r.groupe) !== String(idGrp)) return;
      if (etatGrp.messages.some(function (x) { return String(x.id) === String(r.id); })) return;
      poserMessage(r);
      var m = etatGrp.messages[etatGrp.messages.length - 1];
      /* un chiffre avec une version de cle que je n'ai pas : l'autre vient
         peut-etre de la creer (ses cles ont change) — on relit les cles */
      var pret = (m.chiffre && !etatChiffre.cles[m.cle_version] && trousseau.statut === "ok")
        ? chargerClesConv().then(function () { return situerLAutre(trousseau, etatGrp); }).then(function () { return ouvrirMesEnveloppes(trousseau); }).then(function () { return dechiffrerUn(m); })
        : dechiffrerUn(m);
      pret.then(function () {
        peindreDiscussion(etatGrp, etatGrp.mon_role === "admin", true);
        if (etatChiffre.alerte) peindreEtatChiffre(etatGrp, true, false);
      });
      cacherFrappe();
    }
    function modifierMessageDirect(r) {
      if (!etatGrp || String(r.groupe) !== String(idGrp)) return;
      poserMessage(r);
      var m = etatGrp.messages.filter(function (x) { return String(x.id) === String(r.id); })[0];
      dechiffrerUn(m || {}).then(function () { peindreDiscussion(etatGrp, etatGrp.mon_role === "admin"); });
    }
    function retirerMessageDirect(id) {
      if (!etatGrp) return;
      var avant = etatGrp.messages.length;
      etatGrp.messages = etatGrp.messages.filter(function (x) { return String(x.id) !== String(id); });
      if (etatGrp.messages.length === avant) return;
      empreinteGrp = empreinte(etatGrp);
      peindreDiscussion(etatGrp, etatGrp.mon_role === "admin");
    }
    /* « untel est en train d'ecrire » : un signal toutes les 3 s au plus
       pendant la frappe, affiche 4 s de l'autre cote. */
    function signalerFrappe() {
      if (!direct.actif || !pseudoMoi || edition) return;   /* modifier n'est pas ecrire */
      var maintenant = Date.now();
      if (maintenant - direct.derniereFrappe < 2000) return;
      direct.derniereFrappe = maintenant;
      var parti = envoyerDirect({ topic: sujetDirect(), event: "broadcast",
                                  payload: { type: "broadcast", event: "frappe", payload: { pseudo: pseudoMoi } } });
      if (window.console && console.log) console.log("[direct] frappe envoyée", parti ? "(ref " + parti + ")" : "(socket fermé)");
    }
    function montrerFrappe(qui) {
      var z = document.getElementById("grp-frappe");
      z.textContent = qui + " est en train d'écrire…";
      z.hidden = false;
      if (direct.minuterieFrappe) clearTimeout(direct.minuterieFrappe);
      direct.minuterieFrappe = setTimeout(cacherFrappe, 3500);
    }
    function cacherFrappe() {
      var z = document.getElementById("grp-frappe");
      z.hidden = true; z.textContent = "";
    }
    connecterDirect();

    /* ---------- signaler un message ----------
       ⋯ → Signaler, sur un message d'un autre : motif, explication,
       contexte (les N messages precedents ouverts avec lui, 50 par defaut,
       500 au plus — c'est la personne qui signale qui choisit, decision 2).
       La fenetre PREVIENT de ce que le signalement ouvre. La base verifie
       tout une seconde fois (fonction signaler). */
    var messageASignaler = null;
    var champContexte = document.getElementById("grp-sig-contexte");
    function contexteChoisi() {
      var n = parseInt(champContexte.value, 10);
      if (isNaN(n) || n < 0) n = 0;
      if (n > 500) n = 500;
      return n;
    }
    champContexte.addEventListener("input", function () { document.getElementById("grp-sig-n").textContent = String(contexteChoisi()); });
    function ouvrirSignaler(m) {
      messageASignaler = m;
      document.getElementById("grp-sig-cite").textContent = ((m.qui && m.qui.pseudo) || "compte supprimé") + " : " + extrait(texteDe(m));
      document.getElementById("grp-form-signaler").reset();
      document.querySelector('input[name="grp-sig-motif"][value="autre"]').checked = true;
      champContexte.value = "50";
      document.getElementById("grp-sig-n").textContent = "50";
      /* l'avertissement dit la verite du chiffre : c'est toi qui transmets */
      var avert = document.querySelector("#grp-dialogue-signaler .grp-sig-avertissement");
      if (avert) {
        var chiffree = !!(etatGrp && etatGrp.groupe.chiffre_depuis);
        avert.innerHTML = chiffree
          ? "Cette conversation est chiffrée : l\u2019administrateur ne peut pas la lire. En signalant, <strong>tu lui transmets le texte déchiffré</strong> de ce message et des <span id=\"grp-sig-n\">50</span> qui le précèdent, tels que tu les lis. Ils seront effacés avec le signalement, six mois après le verdict."
          : "Ton signalement ouvre à l\'administrateur du site <strong>ce message et les <span id=\"grp-sig-n\">50</span> qui le précèdent</strong>, le temps du verdict ; la porte se referme ensuite. Tu verras le verdict ici.";
        document.getElementById("grp-sig-n").textContent = String(contexteChoisi());
      }
      ouvrirDialogueGrp(dialogueSignaler);
    }
    document.getElementById("grp-sig-annuler").addEventListener("click", function () { fermerDialogueGrp(dialogueSignaler); });
    document.getElementById("grp-form-signaler").addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!messageASignaler) return;
      var coche = document.querySelector('input[name="grp-sig-motif"]:checked');
      var corps = { message: messageASignaler.id, motif: coche ? coche.value : "autre",
                    texte: document.getElementById("grp-sig-explication").value.trim(),
                    contexte: contexteChoisi() };
      /* conversation chiffree : on transmet ce qu'on lit — le message et
         les N precedents, tels que cette page les a dechiffres */
      if (etatGrp && etatGrp.groupe.chiffre_depuis) {
        var fenetre = etatGrp.messages.filter(function (m) { return Number(m.id) <= Number(messageASignaler.id); })
          .sort(function (a, b) { return Number(a.id) - Number(b.id); }).slice(-(corps.contexte + 1));
        corps.contenu = fenetre.map(function (m) { return { id: m.id, auteur: (m.qui && m.qui.pseudo) || "compte supprimé", le: m.cree_le || "", texte: texteDe(m) }; });
      }
      var bouton = document.querySelector("#grp-form-signaler button[type=submit]");
      bouton.disabled = true;
      appelGrp("POST", "/api/groupes/" + idGrp + "/signalements", corps).then(function (x) {
        bouton.disabled = false;
        if (!x.ok) { direGrp(x.d.erreur || "Échec.", x.d.indisponible ? "info" : "erreur"); return; }
        fermerDialogueGrp(dialogueSignaler);
        messageASignaler = null;
        direGrp(x.d.note || "Signalement envoyé.", "succes");
        chargerGroupe(true);   /* mes signalements, mis a jour */
      }).catch(function () { bouton.disabled = false; direGrp("Service indisponible.", "erreur"); });
    });
    /* Mes signalements sur ce groupe : en attente, ou le verdict et sa
       note — c'est la seule facon, pour l'instant, d'apprendre ce qu'il en
       est (une notification viendra avec le lot F). */
    function peindreMesSignalements(d) {
      var zone = document.getElementById("grp-mes-signalements");
      var liste = d.mes_signalements || [];
      zone.textContent = "";
      zone.hidden = !liste.length || !!sigMode;
      if (zone.hidden) return;
      var t = document.createElement("p"); t.className = "c-note"; t.textContent = "Tes signalements dans ce groupe :"; zone.appendChild(t);
      var ul = document.createElement("ul");
      liste.forEach(function (x) {
        var li = document.createElement("li");
        li.setAttribute("data-signalement", x.id);
        var quand = x.cree_le ? new Date(x.cree_le).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "";
        var texte = "message n° " + x.message + " · " + (MOTIFS_SIG[x.motif] || x.motif) + " · " + quand + " — ";
        if (x.verdict) {
          texte += "verdict : " + (VERDICTS_SIG[x.verdict] || x.verdict);
          if (x.verdict_note) texte += " · « " + x.verdict_note + " »";
        } else {
          texte += "en attente du verdict (l'administrateur du site peut lire ce message et les " + x.contexte + " précédents)";
        }
        li.textContent = texte;
        ul.appendChild(li);
      });
      zone.appendChild(ul);
    }

    /* ---------- lecture de signalement : le bandeau et le verdict ---------- */
    function peindreBandeauSignalement() {
      var sg = signalementLu;
      var b = document.getElementById("grp-signalement");
      b.hidden = false;
      document.getElementById("grp-sig-num").textContent = "n° " + sg.id;
      var quand = sg.cree_le ? new Date(sg.cree_le).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "";
      document.getElementById("grp-sig-detail").textContent =
        "Motif : " + (MOTIFS_SIG[sg.motif] || sg.motif) + " · par " + (sg.par || "compte supprimé") + " · " + quand
        + " · message n° " + sg.message + (sg.message_existe === false ? " (effacé depuis)" : "");
      var tx = document.getElementById("grp-sig-texte");
      tx.textContent = sg.texte || ""; tx.hidden = !sg.texte;
      var porte = document.getElementById("grp-sig-porte");
      var rendu = document.getElementById("grp-sig-rendu");
      var zone = document.getElementById("grp-sig-verdict-zone");
      if (sg.clos_le) {
        porte.textContent = "Porte fermée : la règle d'accès ne montre plus rien de cette discussion.";
        rendu.hidden = false;
        rendu.textContent = "Verdict : " + (VERDICTS_SIG[sg.verdict] || sg.verdict)
          + (sg.verdict_par ? " — par " + sg.verdict_par : "")
          + (sg.verdict_le ? ", le " + new Date(sg.verdict_le).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "")
          + (sg.verdict_note ? " · « " + sg.verdict_note + " »" : "");
        zone.hidden = true;
      } else {
        porte.textContent = "Tu vois ce message et les " + sg.contexte + " qui le précèdent (n° " + sg.depuis + " à " + sg.message
          + "), le temps du verdict ; rien d'autre de ce groupe. Cette ouverture est inscrite au journal des consultations.";
        rendu.hidden = true;
        zone.hidden = false;
      }
    }
    function juger(verdict) {
      if (!signalementLu || signalementLu.clos_le) return;
      if (verdict === "retire" && !confirm("Retirer le message signalé ? Il est effacé pour tout le groupe, définitivement.")) return;
      var boutons = document.querySelectorAll("#grp-sig-verdict-zone button");
      boutons.forEach(function (b) { b.disabled = true; });
      appelGrp("POST", "/api/admin/signalements", { id: signalementLu.id, verdict: verdict,
                                                     note: document.getElementById("grp-sig-note").value.trim() }).then(function (x) {
        boutons.forEach(function (b) { b.disabled = false; });
        if (!x.ok) { direGrp(x.d.erreur || "Échec.", x.d.indisponible ? "info" : "erreur"); return; }
        signalementLu.verdict = verdict;
        signalementLu.verdict_note = document.getElementById("grp-sig-note").value.trim() || null;
        signalementLu.verdict_le = new Date().toISOString();
        signalementLu.clos_le = signalementLu.verdict_le;
        signalementLu.verdict_par = pseudoMoi || null;
        if (x.d.message_efface) retirerMessageDirect(signalementLu.message);
        peindreBandeauSignalement();
        direGrp(x.d.note || "Verdict enregistré.", "succes");
      }).catch(function () { boutons.forEach(function (b) { b.disabled = false; }); direGrp("Service indisponible.", "erreur"); });
    }
    document.getElementById("grp-sig-retirer").addEventListener("click", function () { juger("retire"); });
    document.getElementById("grp-sig-avertir").addEventListener("click", function () { juger("avertissement"); });
    document.getElementById("grp-sig-sans-suite").addEventListener("click", function () { juger("sans_suite"); });
    function ouvrirLectureSignalement() {
      /* ce que la page ne montre pas dans ce mode : ecrire, les seances,
         quitter, le direct — l'administrateur du site n'est pas membre */
      document.getElementById("grp-form-message").hidden = true;
      document.getElementById("grp-direct").hidden = true;
      document.getElementById("grp-quitter").hidden = true;
      document.querySelector('#grp-onglets [data-onglet="seances"]').hidden = true;
      document.getElementById("grp-membres-note").textContent = "";
      appelGrp("GET", "/api/admin/signalements?id=" + encodeURIComponent(sigMode)).then(function (x) {
        if (!x.ok) { direGrp(x.d.erreur || "Accès refusé.", x.d.indisponible ? "info" : "erreur"); return; }
        signalementLu = x.d.signalement;
        peindreBandeauSignalement();
        chargerGroupe();
      }).catch(function () { direGrp("Service indisponible.", "erreur"); });
    }

    if (sigMode) {
      lireMoi().then(function (moi) { pseudoMoi = moi && moi.pseudo; }).catch(function () {})
        .then(ouvrirLectureSignalement);
    } else {
      lireMoi()
        .then(function (moi) { pseudoMoi = moi && moi.pseudo; chargerGroupe(); })
        .catch(function () { chargerGroupe(); });
    }

    document.getElementById("grp-accepter").addEventListener("click", function () {
      appelGrp("POST", "/api/groupes/invitations", { groupe: idGrp, accepte: true }).then(function (x) {
        if (!x.ok) { direGrp(x.d.erreur || "Échec.", "erreur"); return; }
        direGrp("Bienvenue dans le groupe.", "succes"); chargerGroupe();
      });
    });
    document.getElementById("grp-decliner").addEventListener("click", function () {
      appelGrp("POST", "/api/groupes/invitations", { groupe: idGrp, accepte: false }).then(function (x) {
        if (!x.ok) { direGrp(x.d.erreur || "Échec.", "erreur"); return; }
        location.href = "index.html";
      });
    });

    /* Le composeur : Entree envoie, Maj+Entree passe a la ligne — la
       convention des messageries. */
    var champTexte = document.getElementById("grp-texte");
    var boutonEnvoi = document.querySelector("#grp-form-message button[type=submit]");
    champTexte.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); document.getElementById("grp-form-message").requestSubmit(); }
      if (ev.key === "Escape" && edition) { ev.preventDefault(); finirEdition(); }
    });
    /* Le champ grandit avec le texte, jusqu'a 40 % de l'ecran : un long
       message (a ecrire, ou a modifier) se lit en entier. */
    function ajusterChamp() {
      champTexte.style.height = "";
      if (!champTexte.value) return;
      var max = Math.max(120, Math.round((window.innerHeight || 800) * 0.4));
      champTexte.style.height = Math.min(champTexte.scrollHeight + 2, max) + "px";
    }
    champTexte.addEventListener("input", ajusterChamp);
    /* Faut-il chiffrer ce que j'envoie ? Oui si la conversation l'est
       deja, ou si elle est privee et que les deux ont des cles (le premier
       message la fait passer au chiffre — decision 8). */
    function doitChiffrer() {
      if (!etatGrp || !etatGrp.groupe.prive || sigMode || !chiffrementDisponible() || trousseau.statut !== "ok") return false;
      if (etatGrp.groupe.chiffre_depuis || (etatChiffre.conv && etatChiffre.conv.chiffre_depuis)) return true;
      return !!(etatChiffre.autre && etatChiffre.autre.courante);
    }
    document.getElementById("grp-form-message").addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (edition) { enregistrerEdition(); return; }
      var texte = champTexte.value.trim();
      if (!texte) return;
      var bouton = document.querySelector("#grp-form-message button[type=submit]");
      var corpsP;
      if (doitChiffrer()) {
        bouton.disabled = true;
        corpsP = assurerCleDEcriture().then(function (version) {
          return Ch.chiffrerMessage(etatChiffre.cles[version], { t: texte, refs: refsEnCours }, { groupe: idGrp, auteur: trousseau.moi.id, cle_version: version })
            .then(function (chiffre) { var c = { chiffre: chiffre, cle_version: version }; if (reponseEnCours) c.reponse_a = reponseEnCours.id; return c; });
        });
      } else {
        var corps = { texte: texte, refs: refsEnCours };
        if (reponseEnCours) corps.reponse_a = reponseEnCours.id;
        corpsP = Promise.resolve(corps);
      }
      corpsP.then(function (corps) { return appelGrp("POST", "/api/groupes/" + idGrp + "/messages", corps); }).then(function (x) {
        bouton.disabled = false;
        if (!x.ok) {
          direGrp(x.d.erreur || "Échec.", "erreur");
          if (x.statut === 409) { etatChiffre.conv = null; chargerGroupe(); }   /* le regime a change sous nos pieds : on relit */
          return;
        }
        champTexte.value = ""; ajusterChamp(); refsEnCours = []; peindreRefsChoisies(); annulerReponse();
        /* le message relu se pose tout de suite ; le direct ne le
           reposera pas (meme identifiant) ; sans direct on relit */
        if (x.d.message) {
          poserMessage(x.d.message);
          var m = etatGrp.messages.filter(function (y) { return String(y.id) === String(x.d.message.id); })[0];
          dechiffrerUn(m || {}).then(function () {
            peindreDiscussion(etatGrp, etatGrp.mon_role === "admin", true);
            /* le premier message chiffre a fait passer la conversation au
               chiffre : l'etat sous le titre le dit tout de suite */
            if (m && m.chiffre) { etatGrp.groupe.chiffre_depuis = etatGrp.groupe.chiffre_depuis || new Date().toISOString(); peindreEtatChiffre(etatGrp, true, false); }
          });
        }
        if (!direct.actif) chargerGroupe(true);
      }).catch(function (e) { bouton.disabled = false; direGrp((e && e.message) || "Service indisponible.", "erreur"); });
    });
    champTexte.addEventListener("input", signalerFrappe);
    champTexte.addEventListener("keydown", signalerFrappe);

    /* ---------- le « + » : joindre des references ----------
       Une ou plusieurs fiches (la fenetre commune, en cases), ou une
       seance du groupe. Elles s'affichent en etiquettes au-dessus du
       champ, retirables, et partent avec le message. */
    var refsEnCours = [];
    var menuPlus = document.getElementById("grp-menu-plus");
    document.getElementById("grp-plus").addEventListener("click", function (ev) {
      ev.stopPropagation();
      menuPlus.hidden = !menuPlus.hidden;
    });
    document.addEventListener("click", function () { menuPlus.hidden = true; });
    menuPlus.addEventListener("click", function (ev) { ev.stopPropagation(); });
    document.getElementById("grp-ref-fiches").addEventListener("click", function () {
      menuPlus.hidden = true;
      var deja = refsEnCours.filter(function (r) { return r.type === "fiche"; }).map(function (r) { return r.id; });
      ouvrirSelecteurFiches(deja, function (choisies) {
        refsEnCours = refsEnCours.filter(function (r) { return r.type !== "fiche"; })
          .concat(choisies.map(function (ch) { return { type: "fiche", id: ch }; })).slice(0, 10);
        peindreRefsChoisies();
        champTexte.focus();
      });
    });
    var dialogueRefSeance = null, listeRefSeance = null;
    document.getElementById("grp-ref-seance").addEventListener("click", function () {
      menuPlus.hidden = true;
      if (!dialogueRefSeance) {
        dialogueRefSeance = document.createElement("dialog");
        dialogueRefSeance.className = "edt-dialogue sf-dialogue";
        var tete = document.createElement("div"); tete.className = "sf-tete";
        var h2 = document.createElement("h2"); h2.textContent = "Citer une séance"; tete.appendChild(h2);
        var fermer = document.createElement("button"); fermer.type = "button"; fermer.className = "btn btn-icone sf-fermer";
        fermer.setAttribute("aria-label", "Fermer"); fermer.textContent = "×";
        fermer.addEventListener("click", function () { dialogueRefSeance.close(); });
        tete.appendChild(fermer);
        dialogueRefSeance.appendChild(tete);
        listeRefSeance = document.createElement("div"); listeRefSeance.className = "sf-liste";
        dialogueRefSeance.appendChild(listeRefSeance);
        document.body.appendChild(dialogueRefSeance);
        fermerAuVoile(dialogueRefSeance);
      }
      var liste = listeRefSeance;
      liste.textContent = "";
      var seances = (etatGrp && etatGrp.seances || []).slice().sort(function (a, b) { return new Date(b.debut) - new Date(a.debut); });
      if (!seances.length) { var v = document.createElement("p"); v.className = "c-note"; v.textContent = "Aucune séance dans ce groupe pour l'instant."; liste.appendChild(v); }
      seances.forEach(function (sce) {
        var b = document.createElement("button"); b.type = "button"; b.className = "sf-fiche";
        var dd = new Date(sce.debut);
        var num = document.createElement("span"); num.className = "sf-num";
        num.textContent = dd.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
        b.appendChild(num); b.appendChild(document.createTextNode(" " + sce.titre + (sce.lieu ? " · " + sce.lieu : "")));
        b.addEventListener("click", function () {
          if (!refsEnCours.some(function (r) { return r.type === "seance" && r.id === sce.id; })) {
            refsEnCours = refsEnCours.concat([{ type: "seance", id: sce.id }]).slice(0, 10);
          }
          peindreRefsChoisies();
          dialogueRefSeance.close();
          champTexte.focus();
        });
        liste.appendChild(b);
      });
      if (typeof dialogueRefSeance.showModal === "function") dialogueRefSeance.showModal(); else dialogueRefSeance.setAttribute("open", "");
    });
    function peindreRefsChoisies() {
      var zone = document.getElementById("grp-refs");
      zone.textContent = "";
      zone.hidden = !refsEnCours.length;
      refsEnCours.forEach(function (r, i) {
        var chip = document.createElement("span"); chip.className = "grp-ref-chip";
        chip.appendChild(carteRef(r));
        var x = document.createElement("button"); x.type = "button"; x.className = "grp-ref-retirer"; x.textContent = "×"; x.title = "Retirer";
        x.addEventListener("click", function () { refsEnCours.splice(i, 1); peindreRefsChoisies(); });
        chip.appendChild(x);
        zone.appendChild(chip);
      });
    }

    function editerSeance(s) {
      document.getElementById("grp-s-titre-dialogue").textContent = "Modifier la séance";
      document.getElementById("grp-s-id").value = s.id;
      document.getElementById("grp-s-titre").value = s.titre;
      var d = new Date(s.debut);
      document.getElementById("grp-s-date").value = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      document.getElementById("grp-s-heure").value = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
      var f = s.fin ? new Date(s.fin) : null;
      document.getElementById("grp-s-fin").value = f ? String(f.getHours()).padStart(2, "0") + ":" + String(f.getMinutes()).padStart(2, "0") : "";
      document.getElementById("grp-s-lieu").value = s.lieu || "";
      document.getElementById("grp-s-fiche").value = fichesDeSeance(s).join(",");
      document.getElementById("grp-s-fiche").dispatchEvent(new Event("change"));
      document.getElementById("grp-s-note").value = s.note || "";
      poserRappels(document.getElementById("grp-s-rappels"), s.rappels);
      document.getElementById("grp-s-enregistrer").textContent = "Enregistrer";
      ouvrirDialogueGrp(dialogueSeance);
    }
    function nouvelleSeance() {
      document.getElementById("grp-form-seance").reset();
      document.getElementById("grp-s-fiche").dispatchEvent(new Event("change"));
      document.getElementById("grp-s-id").value = "";
      document.getElementById("grp-s-titre-dialogue").textContent = "Proposer une séance";
      document.getElementById("grp-s-enregistrer").textContent = "Proposer";
      ouvrirDialogueGrp(dialogueSeance);
    }
    document.getElementById("grp-ouvrir-seance").addEventListener("click", nouvelleSeance);
    document.getElementById("grp-s-annuler").addEventListener("click", function () { fermerDialogueGrp(dialogueSeance); });
    document.getElementById("grp-form-seance").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var date = document.getElementById("grp-s-date").value;
      var h1 = document.getElementById("grp-s-heure").value;
      var h2 = document.getElementById("grp-s-fin").value;
      if (!date || !h1) { direGrp("Il faut une date et une heure.", "erreur"); return; }
      var debut = new Date(date + "T" + h1 + ":00");
      var fin = h2 ? new Date(date + "T" + h2 + ":00") : null;
      if (fin && fin < debut) { direGrp("La fin est avant le début.", "erreur"); return; }
      var corps = {
        titre: document.getElementById("grp-s-titre").value.trim(),
        debut: debut.toISOString(), fin: fin ? fin.toISOString() : null,
        lieu: document.getElementById("grp-s-lieu").value.trim(),
        fiches: document.getElementById("grp-s-fiche").value.split(",").map(function (v) { return v.trim(); }).filter(Boolean),
        note: document.getElementById("grp-s-note").value.trim(),
        rappels: lireRappels(document.getElementById("grp-s-rappels"))
      };
      var sid = document.getElementById("grp-s-id").value;
      var promesse = sid
        ? appelGrp("PATCH", "/api/groupes/" + idGrp + "/seances", Object.assign({ id: sid }, corps))
        : appelGrp("POST", "/api/groupes/" + idGrp + "/seances", corps);
      promesse.then(function (x) {
        if (!x.ok) { direGrp(x.d.erreur || "Échec.", "erreur"); return; }
        direGrp(sid ? "Séance modifiée." : "Séance proposée : elle est dans l'emploi du temps de chaque membre.", "succes");
        fermerDialogueGrp(dialogueSeance); chargerGroupe();
      }).catch(function () { direGrp("Service indisponible.", "erreur"); });
    });

    document.getElementById("grp-ouvrir-inviter").addEventListener("click", function () {
      if (!etatGrp) return;
      ouvrirInvitation({ id: idGrp, nom: etatGrp.groupe.nom, apres: function () { chargerGroupe(); } });
    });

    /* ---------- Parametres (administrateurs) ----------
       Nom, description, qui peut inviter ; et, pour le fondateur seul,
       transferer la fondation et supprimer le groupe. Le formulaire est
       pre-rempli depuis l'etat courant a chaque ouverture. */
    document.getElementById("grp-parametres").addEventListener("click", function () {
      if (!etatGrp) return;
      var g = etatGrp.groupe;
      document.getElementById("grp-p-nom").value = g.nom || "";
      document.getElementById("grp-p-description").value = g.description || "";
      var inviter = (g.parametres && g.parametres.inviter) || "membres";
      document.querySelectorAll('input[name="grp-p-inviter"]').forEach(function (r) { r.checked = r.value === inviter; });
      var sel = document.getElementById("grp-p-nouveau-fondateur");
      sel.textContent = "";
      etatGrp.membres.filter(function (m) { return m.statut === "accepte" && m.id !== etatGrp.mon_id; }).forEach(function (m) {
        var o = document.createElement("option"); o.value = m.id; o.textContent = m.pseudo + (m.role === "admin" ? " (admin)" : ""); sel.appendChild(o);
      });
      document.getElementById("grp-p-transferer").disabled = !sel.options.length;
      ouvrirDialogueGrp(dialogueParametres);
    });
    document.getElementById("grp-p-annuler").addEventListener("click", function () { fermerDialogueGrp(dialogueParametres); });
    document.getElementById("grp-form-parametres").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var coche = document.querySelector('input[name="grp-p-inviter"]:checked');
      var corps = { nom: document.getElementById("grp-p-nom").value.trim(),
                    description: document.getElementById("grp-p-description").value.trim() };
      if (coche) corps.parametres = { inviter: coche.value };
      appelGrp("PATCH", "/api/groupes/" + idGrp, corps).then(function (x) {
        if (!x.ok) { direGrp(x.d.erreur || "Échec.", x.d.indisponible ? "info" : "erreur"); return; }
        fermerDialogueGrp(dialogueParametres);
        direGrp("Paramètres enregistrés.", "succes");
        chargerGroupe();
      }).catch(function () { direGrp("Service indisponible.", "erreur"); });
    });
    document.getElementById("grp-p-transferer").addEventListener("click", function () {
      var sel = document.getElementById("grp-p-nouveau-fondateur");
      var cible = sel.value, nom = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : "";
      if (!cible) return;
      if (!confirm("Transférer la fondation à " + nom + " ? Tu resteras administrateur, mais c'est " + nom + " qui pourra désormais te retirer l'administration, et supprimer le groupe.")) return;
      appelGrp("POST", "/api/groupes/" + idGrp + "/fondation", { membre: cible }).then(function (x) {
        if (!x.ok) { direGrp(x.d.erreur || "Échec.", x.d.indisponible ? "info" : "erreur"); return; }
        fermerDialogueGrp(dialogueParametres);
        direGrp(x.d.pseudo + " est maintenant fondateur du groupe.", "succes");
        chargerGroupe();
      }).catch(function () { direGrp("Service indisponible.", "erreur"); });
    });
    document.getElementById("grp-supprimer").addEventListener("click", function () {
      if (!confirm("Supprimer le groupe, sa discussion et ses séances ? C'est définitif.")) return;
      appelGrp("DELETE", "/api/groupes/" + idGrp).then(function (x) {
        if (!x.ok) { direGrp(x.d.erreur || "Échec.", "erreur"); fermerDialogueGrp(dialogueParametres); return; }
        location.href = "index.html";
      });
    });
    document.getElementById("grp-quitter").addEventListener("click", function () {
      if (!confirm("Quitter ce groupe ?")) return;
      appelGrp("DELETE", "/api/groupes/" + idGrp + "/membres").then(function (x) {
        if (!x.ok) { direGrp(x.d.erreur || "Échec.", "erreur"); return; }
        location.href = "index.html";
      });
    });
    /* conversation privee (lot H) : le « ⋯ » de l'en-tete — la quitter.
       Elle disparait pour moi ; l'autre garde ce que j'ai ecrit (regle du
       § 5) ; quand le dernier part, la base l'efface. */
    var menuTete = document.getElementById("grp-tete-menu");
    menuTete.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (!etatGrp) return;
      var nom = etatGrp.avec ? etatGrp.avec.pseudo : "cette personne";
      var entrees = [];
      if (chiffrementDisponible() && trousseau.statut === "ok") entrees.push({ libelle: "Vérifier les clés", action: function () {
        var autre = etatChiffre.autre;
        dialogueEmpreintes([
          { qui: "toi (" + (trousseau.moi ? trousseau.moi.pseudo : "") + ")", empreinte: trousseau.identite.empreinte },
          { qui: nom, empreinte: autre && autre.courante ? autre.courante.empreinte : null, note: autre && autre.courante ? (etatChiffre.acceptees.indexOf(Number(autre.courante.version)) >= 0 ? "clé acceptée (version " + autre.courante.version + ")" : "clé pas encore confirmée") : "pas de clés : ses messages partent en clair" },
        ]);
      } });
      menuFlottant.ouvrir(menuTete, entrees.concat([
        { libelle: "Quitter la conversation", danger: true, action: function () {
          if (!confirm("Quitter la conversation avec " + nom + " ? Elle disparaît pour toi ; ce que tu y as écrit reste lisible de l'autre.")) return;
          appelGrp("DELETE", "/api/groupes/" + idGrp + "/membres").then(function (x) {
            if (!x.ok) { direGrp(x.d.erreur || "Échec.", "erreur"); return; }
            location.href = "index.html#prives";
          }).catch(function () { direGrp("Service indisponible.", "erreur"); });
        } }]));
    });
  }

  /* ---------- les parametres : messages prives chiffres (lot H, s. 2) ---------- */
  var zoneParChiffre = document.getElementById("par-chiffre");
  if (zoneParChiffre) {
    var direParChiffre = function (t, type) { var z = document.getElementById("par-chiffre-etat"); z.textContent = t; z.className = "etat" + (type ? " etat-" + type : ""); z.hidden = !t; };
    var boutonsPar = { creer: "par-chiffre-creer", deverrouiller: "par-chiffre-deverrouiller", recevoir: "par-chiffre-recevoir", passkeyOuvrir: "par-chiffre-passkey-ouvrir", lier: "par-chiffre-lier", passkey: "par-chiffre-passkey", changer: "par-chiffre-changer", regenerer: "par-chiffre-regenerer", retirer: "par-chiffre-retirer" };
    function peindreParChiffre() {
      var cles = document.getElementById("par-chiffre-cles"), app = document.getElementById("par-chiffre-appareil");
      Object.keys(boutonsPar).forEach(function (k) { document.getElementById(boutonsPar[k]).hidden = true; });
      if (!chiffrementDisponible()) { cles.textContent = "ce navigateur ne sait pas chiffrer (WebCrypto absent)"; app.textContent = "—"; return; }
      trousseau.charger(true).then(function (tr) {
        if (tr.statut === "indisponible") { cles.textContent = tr.raison || "le chiffrement n\u2019est pas encore ouvert sur ce site"; app.textContent = "—"; return; }
        if (tr.statut === "aucune") { cles.textContent = "pas encore créées — elles le seront à ta première conversation privée, ou maintenant"; app.textContent = "—"; document.getElementById(boutonsPar.creer).hidden = false; return; }
        cles.textContent = "créées le " + quandGrp(tr.publique.cree_le) + " (version " + tr.publique.version + ") — empreinte " + tr.publique.empreinte;
        if (tr.statut === "ok") {
          app.textContent = "déverrouillé : tu peux lire et écrire tes messages chiffrés ici";
          document.getElementById(boutonsPar.retirer).hidden = false;
          document.getElementById(boutonsPar.lier).hidden = false;
          if (Passkeys.supporte()) document.getElementById(boutonsPar.passkey).hidden = false;
        } else {
          app.textContent = "pas déverrouillé : par une passkey, en recevant tes clés d\u2019un appareil déjà ouvert, ou avec ta phrase";
          document.getElementById(boutonsPar.recevoir).hidden = false;
          document.getElementById(boutonsPar.deverrouiller).hidden = false;
        }
        peindrePasskeys(tr);
        peindreSauvegardes(tr);
        document.getElementById(boutonsPar.regenerer).hidden = false;
      });
    }
    /* K3 : ce qui protege la cle, en une ligne. Le bouton de la phrase dit
       « noter » quand il n'y en a pas, « changer » quand il y en a une ; il
       n'apparait que sur un appareil ouvert (il faut la cle pour
       l'envelopper). */
    function peindreSauvegardes(tr) {
      var z = document.getElementById("par-chiffre-sauvegardes"), bPhrase = document.getElementById(boutonsPar.changer);
      if (!z) return;
      trousseau.etatSauvegardes().then(function (s) {
        var morceaux = [];
        if (s.phrase) morceaux.push("phrase notée le " + quandGrp(s.phrase.modifie_le || s.phrase.cree_le));
        s.passkeys.forEach(function (p) {
          var nom = "passkey « " + (p.nom || "sans nom") + " »";
          if (p.synchronisee === true) morceaux.push(nom + " (synchronisée)");
          else if (p.synchronisee === false) morceaux.push(nom + " — liée à un seul appareil : ce n\u2019est pas une sauvegarde");
          else morceaux.push(nom + " — on ne sait pas si elle est synchronisée");
        });
        z.textContent = "";
        if (!s.sures) {
          var fort = document.createElement("strong"); fort.className = "cles-alerte-texte";
          fort.textContent = "aucune — si tu perds cet appareil, tes messages chiffrés sont perdus";
          z.appendChild(fort);
          if (morceaux.length) z.appendChild(document.createTextNode(" (" + morceaux.join(" · ") + ")"));
        } else {
          z.textContent = morceaux.join(" · ");
        }
        bPhrase.textContent = s.phrase ? "Changer ma phrase" : "Noter une phrase de récupération";
        bPhrase.hidden = tr.statut !== "ok";
      }).catch(function () { z.textContent = "—"; });
    }
    /* K3 : creer ses cles ne demande rien ; la sauvegarde se choisit apres */
    document.getElementById(boutonsPar.creer).addEventListener("click", function () {
      direParChiffre("Création…", "info");
      trousseau.creerSansPhrase().then(function () {
        direParChiffre("Clés créées. Protège-les maintenant : une passkey, ou une phrase.", "succes"); peindreParChiffre();
      }, function (e) {
        if (e && e.indisponible) { dialoguePremiereFois({ annuler: "Annuler", surFini: function () { direParChiffre("Clés créées.", "succes"); peindreParChiffre(); } }); return; }
        direParChiffre((e && e.message) || "Échec.", "erreur");
      });
    });
    document.getElementById(boutonsPar.deverrouiller).addEventListener("click", function () { dialogueDeverrouiller({ annuler: "Annuler", surOk: function () { direParChiffre("Déverrouillé sur cet appareil.", "succes"); peindreParChiffre(); }, surRegenerer: function () { regenererCles(function () { peindreParChiffre(); }); } }); });
    /* lot K1 : recevoir la cle d'un autre appareil, ou la lui donner */
    document.getElementById(boutonsPar.recevoir).addEventListener("click", function () {
      dialogueRecevoir({ surOk: function () { direParChiffre("C\u2019est ouvert sur cet appareil.", "succes"); peindreParChiffre(); },
                         surPhrase: function () { document.getElementById(boutonsPar.deverrouiller).click(); } });
    });
    document.getElementById(boutonsPar.lier).addEventListener("click", function () { dialogueDonner({}); });
    /* ---------- lot K2 : les passkeys ---------- */
    function peindrePasskeys(tr) {
      var zone = document.getElementById("par-chiffre-passkeys");
      if (!zone) return;
      if (!Passkeys.supporte()) { zone.textContent = "ce navigateur ne sait pas faire de passkey"; return; }
      if (tr.statut === "aucune" || tr.statut === "indisponible") { zone.textContent = "—"; return; }
      trousseau.chargerPasskeys().then(function (liste) {
        zone.textContent = "";
        if (!liste.length) {
          zone.textContent = "aucune — « Protéger avec cet appareil » évite d\u2019avoir à taper ta phrase";
          return;
        }
        if (tr.statut !== "ok") document.getElementById(boutonsPar.passkeyOuvrir).hidden = false;
        liste.forEach(function (p, i) {
          if (i) zone.appendChild(document.createTextNode(" · "));
          var nom = document.createElement("span");
          nom.textContent = (p.nom || "sans nom") + " (" + quandGrp(p.cree_le) + ")";
          zone.appendChild(nom);
          var b = document.createElement("button");
          b.type = "button"; b.className = "lien-bouton"; b.textContent = "retirer";
          b.addEventListener("click", function () {
            if (!confirm("Retirer cette passkey ? Il te restera ta phrase, et tes autres appareils.")) return;
            trousseau.retirerPasskey(p.credential_id).then(function () { direParChiffre("Passkey retirée.", "info"); peindreParChiffre(); });
          });
          zone.appendChild(document.createTextNode(" "));
          zone.appendChild(b);
        });
      });
    }
    document.getElementById(boutonsPar.passkey).addEventListener("click", function () {
      var nom = prompt("Un nom pour cette passkey (pour t\u2019y retrouver) :", "cet appareil");
      if (nom === null) return;
      direParChiffre("Suis les instructions de ton appareil\u2026", "info");
      trousseau.enregistrerPasskey((nom || "").slice(0, 60)).then(function () {
        direParChiffre("C\u2019est fait : un geste suffira désormais, ici et sur les appareils où cette passkey est disponible.", "succes");
        peindreParChiffre();
      }, function (e) { direParChiffre(e.message || "Échec.", "erreur"); });
    });
    document.getElementById(boutonsPar.passkeyOuvrir).addEventListener("click", function () {
      direParChiffre("Suis les instructions de ton appareil\u2026", "info");
      trousseau.ouvrirParPasskey().then(function () {
        direParChiffre("Déverrouillé par ta passkey.", "succes"); peindreParChiffre();
      }, function (e) { direParChiffre(e.message || "Échec.", "erreur"); });
    });
    /* Le carre scanne mene ici : « /parametres#lier=<id> ». On enleve le
       « # » aussitot pour qu'un rechargement ne rouvre pas la fenetre. */
    if (/^#lier=/.test(location.hash)) {
      var idLien = location.hash.slice(6);
      if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);
      trousseau.charger().then(function (tr) {
        if (tr.statut === "ok") dialogueDonner({ id: idLien });
        else direParChiffre("Déverrouille d\u2019abord tes clés sur cet appareil pour en ouvrir un autre.", "info");
      });
    }
    document.getElementById(boutonsPar.changer).addEventListener("click", function () { noterPhrase(function () { direParChiffre("Phrase enregistrée.", "succes"); peindreParChiffre(); }); });
    document.getElementById(boutonsPar.regenerer).addEventListener("click", function () {
      if (!confirm("Régénérer tes clés ? Les messages chiffrés jusqu\u2019ici ne seront plus lisibles pour toi, sauf ceux qu\u2019un contact te rendra après t\u2019avoir vérifié.")) return;
      regenererSansPhrase(function () { direParChiffre("Nouvelles clés publiées. Protège-les : une passkey, ou une phrase.", "succes"); peindreParChiffre(); });
    });
    document.getElementById(boutonsPar.retirer).addEventListener("click", function () {
      var sans = !trousseau.sauvegardes().sures;
      if (!confirm(sans
          ? "Tes clés ne sont sauvegardées NULLE PART. Les retirer de cet appareil, c\u2019est perdre tes messages chiffrés pour de bon. Retirer quand même ?"
          : "Retirer tes clés de cet appareil ? Tu pourras les rouvrir ici par ta passkey, ta phrase, ou un autre appareil.")) return;
      trousseau.retirer().then(function () { direParChiffre("Clés retirées de cet appareil.", "info"); peindreParChiffre(); });
    });
    peindreParChiffre();
  }


  /* ------------------------------------------------------------------
     Le quiz (page /quiz/)
     ------------------------------------------------------------------
     Le REGISTRE des formats, d'abord. Chaque format sait trois choses :
     se dessiner (rendre), lire la reponse donnee (lire), et dire si elle
     est juste (corriger). Ajouter un format = une entree ici, et des
     questions qui le portent ; ni la banque ni la base ne changent.
  ------------------------------------------------------------------ */
  var choixQuiz = document.getElementById("quiz-choix");
  if (choixQuiz) {

    function normaliser(t) {
      return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/\s+/g, " ").replace(/[\s.;,:!?]+$/g, "").trim();
    }
    function bouton(texte, classe) {
      var b = document.createElement("button"); b.type = "button"; b.className = classe || "quiz-choix"; b.textContent = texte; return b;
    }

    var TYPES_QUESTION = {
      qcm: {
        rendre: function (q, zone) {
          var etat = { valeur: null };
          q.choix.forEach(function (c, i) {
            var b = bouton(c);
            b.addEventListener("click", function () {
              zone.querySelectorAll(".quiz-choix").forEach(function (x) { x.classList.remove("est-choisi"); });
              b.classList.add("est-choisi"); etat.valeur = i;
            });
            zone.appendChild(b);
          });
          return etat;
        },
        lire: function (etat) { return etat.valeur; },
        corriger: function (q, r) { return r === q.reponse; },
        montrer: function (q, zone, r) {
          zone.querySelectorAll(".quiz-choix").forEach(function (x, i) {
            x.disabled = true;
            if (i === q.reponse) x.classList.add("est-juste");
            else if (i === r) x.classList.add("est-faux");
          });
        }
      },
      qcm_multi: {
        rendre: function (q, zone) {
          var etat = { valeur: [] };
          var note = document.createElement("p"); note.className = "c-note"; note.textContent = "Plusieurs réponses possibles."; zone.appendChild(note);
          q.choix.forEach(function (c, i) {
            var b = bouton(c);
            b.addEventListener("click", function () {
              b.classList.toggle("est-choisi");
              var k = etat.valeur.indexOf(i);
              if (k >= 0) etat.valeur.splice(k, 1); else etat.valeur.push(i);
            });
            zone.appendChild(b);
          });
          return etat;
        },
        lire: function (etat) { return etat.valeur.length ? etat.valeur.slice().sort() : null; },
        corriger: function (q, r) { return JSON.stringify(r) === JSON.stringify(q.reponse.slice().sort()); },
        montrer: function (q, zone, r) {
          zone.querySelectorAll(".quiz-choix").forEach(function (x, i) {
            x.disabled = true;
            if (q.reponse.indexOf(i) >= 0) x.classList.add("est-juste");
            else if (r && r.indexOf(i) >= 0) x.classList.add("est-faux");
          });
        }
      },
      vrai_faux: {
        rendre: function (q, zone) {
          var etat = { valeur: null };
          [["Vrai", true], ["Faux", false]].forEach(function (c) {
            var b = bouton(c[0]);
            b.addEventListener("click", function () {
              zone.querySelectorAll(".quiz-choix").forEach(function (x) { x.classList.remove("est-choisi"); });
              b.classList.add("est-choisi"); etat.valeur = c[1];
            });
            zone.appendChild(b);
          });
          return etat;
        },
        lire: function (etat) { return etat.valeur; },
        corriger: function (q, r) { return r === q.reponse; },
        montrer: function (q, zone, r) {
          zone.querySelectorAll(".quiz-choix").forEach(function (x, i) {
            x.disabled = true;
            var val = i === 0;
            if (val === q.reponse) x.classList.add("est-juste");
            else if (val === r) x.classList.add("est-faux");
          });
        }
      },
      saisie: {
        rendre: function (q, zone) {
          var inp = document.createElement("input");
          inp.type = "text"; inp.className = "quiz-saisie"; inp.autocomplete = "off"; inp.spellcheck = false;
          inp.placeholder = "Ta réponse…";
          inp.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); document.getElementById(document.getElementById("quiz-valider").hidden ? "quiz-suivant" : "quiz-valider").click(); } });
          zone.appendChild(inp);
          setTimeout(function () { inp.focus(); }, 50);
          return { champ: inp };
        },
        lire: function (etat) { var v = etat.champ.value.trim(); return v ? v : null; },
        corriger: function (q, r) { var n = normaliser(r); return q.reponses.some(function (x) { return normaliser(x) === n; }); },
        montrer: function (q, zone, r, juste) {
          var inp = zone.querySelector(".quiz-saisie");
          inp.disabled = true; inp.classList.add(juste ? "est-juste" : "est-faux");
          if (!juste) {
            var p = document.createElement("p"); p.className = "quiz-attendu";
            p.textContent = "Réponse attendue : " + q.reponses[0];
            zone.appendChild(p);
          }
        }
      }
    };

    /* ---------- etat ---------- */
    var banque = null;            /* { modules, questions, demo? } */
    var progression = {};         /* id -> { boite, prochaine, vues, reussies } */
    var enDemo = false;
    var session = null;           /* { questions, index, resultats:[{q, ok}], choix } */
    var etatReponse = null;
    var enPause = null;           /* l'etat d'une session en pause, lu au chargement, ou null */

    function direQuiz(texte, type) {
      var z = document.getElementById("etat");
      z.textContent = texte; z.className = "etat" + (type ? " etat-" + type : ""); z.hidden = !texte;
    }
    function montrerVue(nom) {
      ["quiz-choix", "quiz-session", "quiz-fin"].forEach(function (id) { document.getElementById(id).hidden = id !== nom; });
    }
    function lienFicheQuiz(cible) {
      var fiche = cible.split("#")[0], ancre = cible.indexOf("#") > 0 ? cible.slice(cible.indexOf("#")) : "";
      return "../fiches/s1/" + fiche.slice(3, 7) + "/" + fiche.slice(8, 10) + ".html" + ancre;
    }
    function titreFiche(chapitre) {
      for (var i = 0; i < banque.modules.length; i++) {
        var f = banque.modules[i].fiches.filter(function (x) { return x.chapitre === chapitre; })[0];
        if (f) return f.titre;
      }
      return chapitre;
    }

    /* ---------- chargement ---------- */
    function charger() {
      /* La banque d'abord, avec Accept: json — le middleware repond 401 en
         JSON a qui n'a pas l'acces, au lieu d'une page de connexion. */
      fetch("../fiches/quiz-banque.json", { headers: { "Accept": "application/json" } })
        .then(function (r) {
          if (r.ok) return r.json().then(function (b) { return { banque: b, demo: false }; });
          return fetch("demo.json").then(function (r2) { return r2.json(); }).then(function (b) { return { banque: b, demo: true }; });
        })
        .then(function (x) {
          banque = x.banque; enDemo = x.demo;
          document.getElementById("quiz-demo-banniere").hidden = !enDemo;
          if (enDemo) {
            var t = banque.total || {};
            document.getElementById("quiz-demo-total").textContent =
              "Un compte avec l'accès étendu ouvre " + (t.questions || 0) + " questions sur " + (t.fiches || 0) + " fiches.";
            lireMoi()
              .then(function (moi) {
                if (moi && moi.connecte) {
                  document.getElementById("quiz-demo-creer").hidden = true;
                  document.getElementById("quiz-demo-demander").hidden = false;
                }
              }).catch(function () {});
            /* Sans memoire, « lesquelles » n'a pas de sens : tout est nouveau. */
            document.getElementById("quiz-mode").parentElement.hidden = true;
            peindreChoix();
            peindreReprise(lireSessionEnPause());
            return;
          }
          return fetch("/api/quiz/progression", { headers: { "Accept": "application/json" } })
            .then(function (r) { return r.json(); })
            .then(function (d) { progression = (d && d.progression) || {}; peindreChoix(); })
            .catch(function () { peindreChoix(); })
            .then(function () { return lireSessionEnPause(); })
            .then(peindreReprise)
            .catch(function () { /* pas de reprise possible : la page joue sans */ });
        })
        .catch(function () { direQuiz("Les questions ne sont pas disponibles.", "erreur"); });
    }

    /* ---------- choisir ----------
       Les fiches se choisissent dans la fenetre commune (celle des
       seances), en version « plusieurs » : cliquer un module coche tout
       son contenu, cliquer un theme coche le sien, une fiche se coche
       seule ; on confirme. Aucun code de fiche n'est montre. La page ne
       garde que le resume du choix — une pastille par module — et le
       compte des questions. */
    var fichesCochees = {};           /* chapitre -> true */
    var brouillon = {};               /* la meme chose, dans la fenetre ouverte */
    var dialogueFiches = null;
    var deplies = {};                 /* module -> true : deplie dans la fenetre */
    var filtreQuiz = "";              /* la recherche de la fenetre */

    function maitrise(chapitre) {
      var qs = banque.questions.filter(function (q) { return q.fiche === chapitre; });
      if (!qs.length) return null;
      var m = 0, dues = 0, neuves = 0, maintenant = Date.now();
      qs.forEach(function (q) {
        var p = progression[q.id];
        if (!p) { neuves++; return; }
        if (p.boite >= 4) m++;
        if (new Date(p.prochaine).getTime() <= maintenant) dues++;
      });
      return { total: qs.length, maitrisees: m, dues: dues, neuves: neuves };
    }

    function fichesUtiles(m) { return m.fiches.filter(function (f) { return f.questions > 0; }); }
    function modulesUtiles() { return banque.modules.filter(function (m) { return m.questions > 0; }); }

    /* Le premier choix : le premier module entier, comme avant. */
    function peindreChoix() {
      fichesCochees = {};
      var premier = modulesUtiles()[0];
      if (premier) fichesUtiles(premier).forEach(function (f) { fichesCochees[f.chapitre] = true; });
      peindreSelection();
      peindreStats();
    }

    function peindreSelection() {
      var zone = document.getElementById("quiz-choisies");
      zone.textContent = "";
      var rien = true;
      modulesUtiles().forEach(function (m) {
        var utiles = fichesUtiles(m);
        var n = utiles.filter(function (f) { return fichesCochees[f.chapitre]; }).length;
        if (!n) return;
        rien = false;
        var puce = document.createElement("span"); puce.className = "quiz-puce-module";
        puce.setAttribute("data-module", m.code);
        var code = document.createElement("span"); code.className = "grp-pastille"; code.textContent = m.code;
        puce.appendChild(code);
        puce.appendChild(document.createTextNode(" " + (n === utiles.length ? "tout" : n + "/" + utiles.length) + " · " + n + " fiche" + (n > 1 ? "s" : "")));
        zone.appendChild(puce);
      });
      if (rien) { var v = document.createElement("span"); v.className = "sf-vide"; v.textContent = "Aucune fiche choisie"; zone.appendChild(v); }
      compter();
    }

    /* ---------- la fenetre ---------- */
    function ouvrirChoixFiches() {
      brouillon = {}; deplies = {}; filtreQuiz = "";
      Object.keys(fichesCochees).forEach(function (ch) { if (fichesCochees[ch]) brouillon[ch] = true; });
      if (!dialogueFiches) {
        dialogueFiches = document.createElement("dialog");
        dialogueFiches.className = "edt-dialogue sf-dialogue";
        dialogueFiches.innerHTML =
          '<div class="sf-tete"><h2>Choisir les fiches</h2>' +
          '<button type="button" class="btn btn-icone sf-fermer" aria-label="Fermer">×</button></div>' +
          '<input type="search" class="sf-recherche" placeholder="Chercher un titre, un module…" autocomplete="off">' +
          '<p class="c-note">Un module se coche d’un clic sans l’ouvrir ; la flèche ouvre ses thèmes et ses fiches.</p>' +
          '<div class="sf-liste sf-multi"></div>' +
          '<div class="sf-pied"><span class="sf-compte"></span>' +
          '<span class="sf-actions"><button type="button" class="btn sf-annuler">Annuler</button>' +
          '<button type="button" class="btn btn-accent sf-valider">Valider</button></span></div>';
        document.body.appendChild(dialogueFiches);
        dialogueFiches.querySelector(".sf-fermer").addEventListener("click", function () { dialogueFiches.close(); });
        dialogueFiches.querySelector(".sf-annuler").addEventListener("click", function () { dialogueFiches.close(); });
        dialogueFiches.querySelector(".sf-recherche").addEventListener("input", function () { filtreQuiz = this.value; peindreListeChoix(); });
        dialogueFiches.querySelector(".sf-valider").addEventListener("click", function () {
          fichesCochees = brouillon; brouillon = {};
          dialogueFiches.close();
          peindreSelection();
        });
      }
      dialogueFiches.querySelector(".sf-recherche").value = "";
      peindreListeChoix();
      if (typeof dialogueFiches.showModal === "function") dialogueFiches.showModal(); else dialogueFiches.setAttribute("open", "");
    }
    document.getElementById("quiz-ouvrir-fiches").addEventListener("click", ouvrirChoixFiches);

    function basculer(chapitres) {
      /* tout coche -> on decoche tout ; sinon on coche tout */
      var tous = chapitres.every(function (ch) { return brouillon[ch]; });
      chapitres.forEach(function (ch) { if (tous) delete brouillon[ch]; else brouillon[ch] = true; });
      peindreListeChoix();
    }
    function etatDe(chapitres) {
      var n = chapitres.filter(function (ch) { return brouillon[ch]; }).length;
      return n === 0 ? "aucune" : (n === chapitres.length ? "toutes" : "partie");
    }

    /* Les modules sont replies : une ligne par module (coche, nom, compte
       des fiches, questions), une fleche a droite qui ouvre ses themes et
       ses fiches. Cocher le module ne l'ouvre pas. La recherche (titre,
       code, theme) ne garde que ce qui correspond, et l'ouvre. Cocher
       un module ou un theme coche TOUTES ses fiches, filtrees ou non ;
       seule la liste affichee est filtree. */
    function peindreListeChoix() {
      var zone = dialogueFiches.querySelector(".sf-liste");
      zone.textContent = "";
      var q = normaliser(filtreQuiz);
      var rien = true;
      modulesUtiles().forEach(function (m) {
        var utiles = fichesUtiles(m);
        var chapitres = utiles.map(function (f) { return f.chapitre; });
        var themesDe = {};
        (m.themes || []).forEach(function (t) { t.chapitres.forEach(function (ch) { themesDe[ch] = t.nom; }); });
        var visibles = !q ? utiles : utiles.filter(function (f) {
          return normaliser(m.code + " " + m.intitule + " " + f.numero + " " + f.titre + " " + (themesDe[f.chapitre] || "")).indexOf(q) !== -1;
        });
        if (q && !visibles.length) return;
        rien = false;
        var bloc = document.createElement("section");
        bloc.className = "sf-module"; bloc.setAttribute("data-module", m.code);
        var deplie = !!q || !!deplies[m.code];
        bloc.setAttribute("data-deplie", deplie ? "oui" : "non");

        /* le module : une ligne qui coche tout, et la fleche qui deplie */
        var ligne = document.createElement("div"); ligne.className = "sf-ligne-module";
        var h = document.createElement("button"); h.type = "button"; h.className = "sf-groupe sf-groupe-module";
        h.setAttribute("data-etat", etatDe(chapitres));
        var coche = document.createElement("span"); coche.className = "sf-coche"; h.appendChild(coche);
        var code = document.createElement("span"); code.className = "grp-pastille"; code.textContent = m.code;
        h.appendChild(code); h.appendChild(document.createTextNode(" " + m.intitule + " "));
        var nc = chapitres.filter(function (ch) { return brouillon[ch]; }).length;
        var nf = document.createElement("span"); nf.className = "grp-pastille grp-pastille-neutre sf-compte-module";
        nf.textContent = (nc && nc !== chapitres.length ? nc + "/" : "") + chapitres.length + " fiche" + (chapitres.length > 1 ? "s" : "");
        h.appendChild(nf);
        var nq = document.createElement("span"); nq.className = "grp-pastille grp-pastille-neutre"; nq.textContent = m.questions + " q.";
        h.appendChild(nq);
        h.addEventListener("click", function () { basculer(chapitres); });
        ligne.appendChild(h);
        var fl = document.createElement("button"); fl.type = "button"; fl.className = "sf-deplier";
        fl.setAttribute("aria-expanded", deplie ? "true" : "false");
        fl.setAttribute("aria-label", (deplie ? "Replier " : "Déplier ") + m.code);
        fl.title = deplie ? "Replier" : "Déplier";
        fl.addEventListener("click", function () { deplies[m.code] = !deplie; peindreListeChoix(); });
        ligne.appendChild(fl);
        bloc.appendChild(ligne);
        if (!deplie) { zone.appendChild(bloc); return; }

        /* les themes, puis les fiches hors theme (parmi les visibles) */
        utiles = visibles;
        var themes = (m.themes || []).map(function (t) {
          return { nom: t.nom, chapitres: t.chapitres.filter(function (ch) { return chapitres.indexOf(ch) !== -1; }) };
        }).filter(function (t) { return t.chapitres.some(function (ch) { return utiles.some(function (f) { return f.chapitre === ch; }); }); });
        var placees = {};
        var groupes = themes.map(function (t) {
          t.chapitres.forEach(function (ch) { placees[ch] = true; });
          return { nom: t.nom, fiches: utiles.filter(function (f) { return t.chapitres.indexOf(f.chapitre) !== -1; }) };
        });
        var reste = utiles.filter(function (f) { return !placees[f.chapitre]; });
        if (reste.length) groupes.push({ nom: themes.length ? "Autres" : null, fiches: reste });

        groupes.forEach(function (g) {
          if (g.nom) {
            /* le theme coche toutes ses fiches (pas seulement les visibles) */
            var gch = g.nom === "Autres" ? g.fiches.map(function (f) { return f.chapitre; })
              : themes.filter(function (t) { return t.nom === g.nom; })[0].chapitres;
            var t = document.createElement("button"); t.type = "button"; t.className = "sf-groupe sf-groupe-theme";
            t.setAttribute("data-etat", etatDe(gch));
            var c2 = document.createElement("span"); c2.className = "sf-coche"; t.appendChild(c2);
            t.appendChild(document.createTextNode(g.nom));
            t.addEventListener("click", function () { basculer(gch); });
            bloc.appendChild(t);
          }
          g.fiches.forEach(function (f) { bloc.appendChild(ligneFiche(f)); });
        });
        zone.appendChild(bloc);
      });
      if (rien) { var p = document.createElement("p"); p.className = "c-note"; p.textContent = "Aucune fiche ne correspond."; zone.appendChild(p); }
      var n = banque.questions.filter(function (q) { return brouillon[q.fiche]; }).length;
      dialogueFiches.querySelector(".sf-compte").textContent = n ? n + " question" + (n > 1 ? "s" : "") : "Aucune fiche";
      dialogueFiches.querySelector(".sf-valider").disabled = !n;
    }

    function ligneFiche(f) {
      var lab = document.createElement("label"); lab.className = "sf-fiche sf-fiche-case";
      var c = document.createElement("input"); c.type = "checkbox"; c.checked = !!brouillon[f.chapitre];
      c.addEventListener("change", function () { if (c.checked) brouillon[f.chapitre] = true; else delete brouillon[f.chapitre]; peindreListeChoix(); });
      lab.appendChild(c);
      var n = document.createElement("span"); n.className = "sf-num"; n.textContent = String(f.numero).padStart(2, "0");
      lab.appendChild(n);
      lab.appendChild(document.createTextNode(" " + f.titre + " "));
      var q = document.createElement("span"); q.className = "grp-pastille grp-pastille-neutre"; q.textContent = f.questions + " q.";
      lab.appendChild(q);
      var mt = maitrise(f.chapitre);
      if (!enDemo && mt) {
        var jauge = document.createElement("span"); jauge.className = "quiz-maitrise"; jauge.title = mt.maitrisees + " mémorisée(s) sur " + mt.total;
        var rempli = document.createElement("span"); rempli.style.width = Math.round(100 * mt.maitrisees / mt.total) + "%";
        jauge.appendChild(rempli); lab.appendChild(jauge);
        var etiquettes = [];
        if (mt.dues) etiquettes.push(mt.dues + " à revoir");
        if (mt.neuves) etiquettes.push(mt.neuves + " nouvelle" + (mt.neuves > 1 ? "s" : ""));
        if (etiquettes.length) { var d = document.createElement("span"); d.className = "c-note"; d.textContent = " " + etiquettes.join(", "); lab.appendChild(d); }
      }
      return lab;
    }

    function questionsChoisies() {
      return banque.questions.filter(function (q) { return fichesCochees[q.fiche]; });
    }
    function compter() {
      var n = questionsChoisies().length;
      document.getElementById("quiz-compte").textContent = n ? n + " question" + (n > 1 ? "s" : "") + " dans la sélection" : "Choisis au moins une fiche.";
      document.getElementById("quiz-commencer").disabled = !n;
    }
    function peindreStats() {
      var z = document.getElementById("quiz-stats");
      if (enDemo) { z.hidden = true; return; }
      var total = banque.questions.length, m = 0, dues = 0, vues = 0, maintenant = Date.now();
      banque.questions.forEach(function (q) {
        var p = progression[q.id];
        if (p) { vues++; if (p.boite >= 4) m++; if (new Date(p.prochaine).getTime() <= maintenant) dues++; }
      });
      z.textContent = "";
      [["questions", total], ["vues", vues], ["mémorisées", m], ["à revoir aujourd'hui", dues]].forEach(function (x) {
        var c = document.createElement("div"); c.className = "quiz-stat";
        var v = document.createElement("strong"); v.textContent = String(x[1]); c.appendChild(v);
        var l = document.createElement("span"); l.textContent = x[0]; c.appendChild(l);
        z.appendChild(c);
      });
      z.hidden = false;
    }


    /* ---------- composer une session ----------
       « a revoir d'abord » : les questions dues (echeance passee), les
       boites les plus basses en premier, puis les jamais vues, puis le
       reste par echeance. « au hasard » : melange. « ratees » : celles
       en boite 1 apres au moins une vue. */
    function melanger(t) { for (var i = t.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = t[i]; t[i] = t[j]; t[j] = x; } return t; }
    function composer(mode, n) {
      var pool = questionsChoisies().slice();
      var maintenant = Date.now();
      var liste;
      if (mode === "melange" || enDemo) {
        liste = melanger(pool);
      } else if (mode === "ratees") {
        liste = melanger(pool.filter(function (q) { var p = progression[q.id]; return p && p.vues > 0 && p.boite === 1; }));
      } else {
        var dues = [], neuves = [], reste = [];
        pool.forEach(function (q) {
          var p = progression[q.id];
          if (!p) neuves.push(q);
          else if (new Date(p.prochaine).getTime() <= maintenant) dues.push(q);
          else reste.push(q);
        });
        dues.sort(function (a, b) { return progression[a.id].boite - progression[b.id].boite; });
        reste.sort(function (a, b) { return new Date(progression[a.id].prochaine) - new Date(progression[b.id].prochaine); });
        liste = melanger(dues).concat(melanger(neuves), reste);
      }
      return n ? liste.slice(0, n) : liste;
    }

    document.getElementById("quiz-commencer").addEventListener("click", function () {
      var n = parseInt(document.getElementById("quiz-nombre").value, 10);
      var mode = document.getElementById("quiz-mode").value;
      var liste = composer(mode, n);
      if (!liste.length) { direQuiz("Rien à réviser avec ces réglages : tu n'as rien raté dans ces fiches.", "info"); return; }
      direQuiz("", "");
      demarrer(liste, { fiches: Object.keys(fichesCochees).filter(function (ch) { return fichesCochees[ch]; }), nombre: n, mode: mode });
    });

    /* ---------- repondre ----------
       `choix` (fiches, nombre, mode) est garde avec la session pour que la
       reprise remette la page dans le meme etat ; « refaire les ratees »
       reprend le choix de la session qu'il prolonge. */
    function demarrer(liste, choix) {
      session = { questions: liste, index: 0, resultats: [], choix: choix || (session && session.choix) || { fiches: [], nombre: 0, mode: "revoir" } };
      /* Une session qui demarre remplace celle en pause : on n'en garde
         qu'une. Elle sera ecrite a la premiere reponse. */
      enPause = null; document.getElementById("quiz-reprise").hidden = true;
      montrerVue("quiz-session");
      poser();
    }
    function poser() {
      var q = session.questions[session.index];
      var zone = document.getElementById("quiz-reponse");
      zone.textContent = "";
      document.getElementById("quiz-position").textContent = (session.index + 1) + " / " + session.questions.length;
      document.getElementById("quiz-jauge").style.width = Math.round(100 * session.index / session.questions.length) + "%";
      var lf = document.getElementById("quiz-lien-fiche");
      lf.textContent = q.fiche + " · " + titreFiche(q.fiche);
      lf.href = lienFicheQuiz(q.fiche);
      var niv = document.getElementById("quiz-niveau");
      niv.textContent = ["", "se souvenir", "appliquer", "raisonner"][q.niveau || 1];
      var code = document.getElementById("quiz-code");
      code.textContent = q.code || ""; code.hidden = !q.code;
      document.getElementById("quiz-enonce").textContent = q.enonce;
      document.getElementById("quiz-verdict").hidden = true;
      document.getElementById("quiz-valider").hidden = false;
      document.getElementById("quiz-suivant").hidden = true;
      var def = TYPES_QUESTION[q.type];
      if (!def) { zone.textContent = "Format de question inconnu : " + q.type; etatReponse = null; return; }
      etatReponse = def.rendre(q, zone);
    }
    document.getElementById("quiz-valider").addEventListener("click", function () {
      var q = session.questions[session.index];
      var def = TYPES_QUESTION[q.type];
      if (!def || !etatReponse) return;
      var r = def.lire(etatReponse);
      if (r === null || r === undefined) { direQuiz("Choisis une réponse.", "info"); return; }
      direQuiz("", "");
      var juste = def.corriger(q, r);
      def.montrer(q, document.getElementById("quiz-reponse"), r, juste);
      session.resultats.push({ q: q, ok: juste });
      var v = document.getElementById("quiz-verdict");
      document.getElementById("quiz-verdict-titre").textContent = juste ? "✓ Juste" : "✗ Pas tout à fait";
      v.className = "quiz-verdict " + (juste ? "quiz-juste" : "quiz-faux");
      document.getElementById("quiz-explication").textContent = q.explication;
      document.getElementById("quiz-lien-section").href = lienFicheQuiz(q.cible);
      v.hidden = false;
      document.getElementById("quiz-valider").hidden = true;
      document.getElementById("quiz-suivant").hidden = false;
      document.getElementById("quiz-suivant").focus();
      enregistrer([{ question: q.id, ok: juste }]);
      garderSession();
    });
    document.getElementById("quiz-suivant").addEventListener("click", function () {
      session.index++;
      if (session.index >= session.questions.length) terminer(); else poser();
    });
    document.getElementById("quiz-quitter").addEventListener("click", function () {
      if (session.resultats.length) terminer(); else { session = null; effacerSession(); montrerVue("quiz-choix"); }
    });
    /* Mettre en pause : la session est deja gardee a chaque reponse ; on
       s'assure qu'elle l'est (une session sans reponse n'a rien ecrit
       encore), et on revient au choix avec le bandeau de reprise. */
    document.getElementById("quiz-pause").addEventListener("click", function () {
      if (!session) return;
      if (!session.resultats.length) { session = null; effacerSession(); montrerVue("quiz-choix"); return; }
      var etat = etatDeSession();
      garderSession();
      session = null;
      montrerVue("quiz-choix");
      peindreReprise(etat);
    });

    /* ---------- la pause ----------
       Une session se garde a chaque reponse : les identifiants des
       questions tirees, les reponses deja donnees, le choix. La position
       n'est pas gardee, c'est le nombre de reponses. Avec un compte, elle
       est en base (/api/quiz/session, une par personne) et se reprend
       depuis n'importe quel appareil ; en demo, dans sessionStorage — elle
       ne survit qu'a l'onglet, et la banniere de demo le dit deja. Une
       session qui se termine (bilan) ou qu'on abandonne est effacee. */
    var CLE_PAUSE = "quiz-session";
    function etatDeSession() {
      return {
        ids: session.questions.map(function (q) { return q.id; }),
        resultats: session.resultats.map(function (r) { return { q: r.q.id, ok: r.ok }; }),
        choix: session.choix
      };
    }
    function garderSession() {
      if (!session) return;
      var etat = etatDeSession();
      if (enDemo) {
        try { sessionStorage.setItem(CLE_PAUSE, JSON.stringify(etat)); } catch (e) {}
        return;
      }
      fetch("/api/quiz/session", {
        method: "PUT", headers: { "content-type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ etat: etat })
      }).catch(function () { /* hors ligne : la prochaine reponse retentera */ });
    }
    function effacerSession() {
      enPause = null;
      document.getElementById("quiz-reprise").hidden = true;
      if (enDemo) { try { sessionStorage.removeItem(CLE_PAUSE); } catch (e) {} return; }
      fetch("/api/quiz/session", { method: "DELETE", headers: { "Accept": "application/json" } }).catch(function () {});
    }
    /* Ce qui est en pause, ou null. En demo c'est synchrone ; avec un
       compte, une promesse (une reponse 503 — migration pas passee — ou
       une panne valent « rien en pause » : la page joue sans). */
    function lireSessionEnPause() {
      if (enDemo) {
        try { return JSON.parse(sessionStorage.getItem(CLE_PAUSE) || "null"); } catch (e) { return null; }
      }
      return fetch("/api/quiz/session", { headers: { "Accept": "application/json" } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { return (d && d.session) || null; });
    }
    /* Les questions d'une session en pause, retrouvees dans la banque par
       leur identifiant ; celles qui ont disparu du depot sont sautees. */
    function questionsDe(etat) {
      var parId = {};
      banque.questions.forEach(function (q) { parId[q.id] = q; });
      return etat.ids.map(function (id) { return parId[id]; }).filter(Boolean);
    }
    function peindreReprise(etat) {
      var z = document.getElementById("quiz-reprise");
      if (!etat || !etat.ids || !etat.ids.length || !questionsDe(etat).length) { enPause = null; z.hidden = true; return; }
      enPause = etat;
      var faites = (etat.resultats || []).length, total = questionsDe(etat).length;
      document.getElementById("quiz-reprise-detail").textContent =
        faites + " / " + total + " question" + (total > 1 ? "s" : "") + " répondue" + (faites > 1 ? "s" : "") + ".";
      z.hidden = false;
    }
    document.getElementById("quiz-reprendre").addEventListener("click", function () {
      if (!enPause) return;
      var etat = enPause;
      var questions = questionsDe(etat);
      var parId = {};
      questions.forEach(function (q) { parId[q.id] = q; });
      var resultats = (etat.resultats || []).filter(function (r) { return parId[r.q]; })
        .map(function (r) { return { q: parId[r.q], ok: r.ok === true }; });
      var choix = etat.choix || {};
      /* Le choix d'origine, remis en place pour la suite (bilan, refaire). */
      fichesCochees = {};
      (choix.fiches || []).forEach(function (ch) { fichesCochees[ch] = true; });
      peindreSelection();
      var selN = document.getElementById("quiz-nombre"), selM = document.getElementById("quiz-mode");
      if (choix.nombre !== undefined) selN.value = String(choix.nombre);
      if (choix.mode) selM.value = choix.mode;
      direQuiz("", "");
      session = { questions: questions, index: resultats.length, resultats: resultats, choix: { fiches: choix.fiches || [], nombre: choix.nombre || 0, mode: choix.mode || "revoir" } };
      enPause = null; document.getElementById("quiz-reprise").hidden = true;
      if (session.index >= session.questions.length) { terminer(); return; }
      montrerVue("quiz-session");
      poser();
    });
    document.getElementById("quiz-recommencer").addEventListener("click", function () { effacerSession(); });

    /* ---------- la memoire ----------
       Une reponse = un envoi ; le serveur calcule la boite et l'echeance
       (functions/api/quiz/progression.js) et renvoie l'etat, qu'on garde
       pour les statistiques sans recharger. En demo, rien ne part. */
    function enregistrer(resultats) {
      if (enDemo) return;
      fetch("/api/quiz/progression", {
        method: "POST", headers: { "content-type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ resultats: resultats })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.etat) d.etat.forEach(function (l) { progression[l.question] = l; });
      }).catch(function () { /* hors ligne : la prochaine reponse retentera */ });
    }

    /* ---------- le bilan ---------- */
    function terminer() {
      var ok = session.resultats.filter(function (r) { return r.ok; }).length;
      var total = session.resultats.length;
      document.getElementById("quiz-jauge").style.width = "100%";
      document.getElementById("quiz-score").textContent = ok + " / " + total + (ok === total ? " — sans faute." : (ok >= total * 0.7 ? " — bien." : " — à retravailler : les sections ci-dessous."));
      var ul = document.getElementById("quiz-ratees");
      ul.textContent = "";
      var ratees = session.resultats.filter(function (r) { return !r.ok; });
      ratees.forEach(function (r) {
        var li = document.createElement("li");
        var a = document.createElement("a"); a.href = lienFicheQuiz(r.q.cible); a.textContent = r.q.enonce; li.appendChild(a);
        var s = document.createElement("span"); s.className = "c-note"; s.textContent = " — " + r.q.fiche; li.appendChild(s);
        ul.appendChild(li);
      });
      document.getElementById("quiz-refaire").hidden = !ratees.length;
      montrerVue("quiz-fin");
      effacerSession();
      if (!enDemo) { peindreStats(); peindreSelection(); }
    }
    document.getElementById("quiz-refaire").addEventListener("click", function () {
      var ratees = session.resultats.filter(function (r) { return !r.ok; }).map(function (r) { return r.q; });
      demarrer(melanger(ratees));
    });
    document.getElementById("quiz-retour").addEventListener("click", function () { session = null; montrerVue("quiz-choix"); });

    charger();
  }

/* ------------------------------------------------------------------
     L'administration
     ------------------------------------------------------------------
     La page ne protege rien : c'est le middleware qui garde /admin, et la
     base qui refuse « attribuer_role » a qui n'est pas super_user. Ce code
     ne fait qu'afficher et transmettre. Quelqu'un qui le contournerait
     n'obtiendrait que des refus.
  ------------------------------------------------------------------ */
  var formRole = document.getElementById("form-role");
  if (formRole) {
    var corpsComptes = document.querySelector("#table-comptes tbody");
    var corpsJournal = document.querySelector("#table-journal tbody");
    var resume = document.getElementById("admin-resume");
    var champPseudo = document.getElementById("role-pseudo");
    var tableauComptes = document.getElementById("table-comptes");
    var conteneurFiltresRoles = document.getElementById("filtres-roles-boutons");

    var donnees = null;
    var triActuel = { colonne: "pseudo", direction: "asc" };
    var filtres = { pseudo: "", role: "" };

    function ligne(cellules) {
      var tr = document.createElement("tr");
      cellules.forEach(function (c) {
        var td = document.createElement("td");
        if (c && c.nodeType) { td.appendChild(c); } else { td.textContent = c; }
        tr.appendChild(td);
      });
      return tr;
    }

    function boutonsRole(pseudo, actuel) {
      var zone = document.createElement("div");
      zone.className = "admin-roles";
      ["user", "reader_user", "super_user"].forEach(function (r) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "btn btn-mini" + (r === actuel ? " est-actuel" : "");
        b.textContent = r;
        b.disabled = r === actuel || !pseudo;
        b.addEventListener("click", function () { attribuer(pseudo, r); });
        zone.appendChild(b);
      });
      return zone;
    }

    function comparerValeurs(a, b, colonne) {
      if (colonne === "cree_le" || colonne === "derniere_connexion") {
        var dateA = new Date(a[colonne] || 0);
        var dateB = new Date(b[colonne] || 0);
        return dateA.getTime() - dateB.getTime();
      } else if (colonne === "pseudo" || colonne === "role") {
        var strA = String(a[colonne] || "").toLowerCase();
        var strB = String(b[colonne] || "").toLowerCase();
        return strA.localeCompare(strB, "fr");
      }
      return 0;
    }

    function obtenirDonneesFiltrees() {
      if (!donnees || !donnees.comptes) return [];

      var comptes = donnees.comptes.filter(function (c) {
        if (c.supprime) return false;
        if (filtres.pseudo) {
          var pseudoNorm = (c.pseudo || "").toLowerCase();
          var searchNorm = filtres.pseudo.toLowerCase();
          if (pseudoNorm.indexOf(searchNorm) === -1) return false;
        }
        if (filtres.role && c.role !== filtres.role) return false;
        return true;
      });

      comptes.sort(function (a, b) {
        var resultat = comparerValeurs(a, b, triActuel.colonne);
        return triActuel.direction === "desc" ? -resultat : resultat;
      });

      return comptes;
    }

    function creerBoutonsFiltrageRole() {
      conteneurFiltresRoles.textContent = "";
      ["user", "reader_user", "super_user"].forEach(function (role) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "btn-filtre-role" + (filtres.role === role ? " est-actif" : "");
        b.textContent = role;
        b.addEventListener("click", function () {
          filtres.role = filtres.role === role ? "" : role;
          creerBoutonsFiltrageRole();
          peindre(donnees);
        });
        conteneurFiltresRoles.appendChild(b);
      });
    }

    function mettreAJourIndicateursTri() {
      var entetes = tableauComptes.querySelectorAll("th.tri-colonne");
      entetes.forEach(function (th) {
        th.classList.remove("tri-asc", "tri-desc");
        if (th.getAttribute("data-colonne") === triActuel.colonne) {
          th.classList.add("tri-" + triActuel.direction);
        }
      });
    }

    function peindre(d) {
      donnees = d;
      corpsComptes.textContent = "";

      var vivants = 0, parRole = { user: 0, reader_user: 0, super_user: 0 };

      var suggestions = document.getElementById("liste-pseudos");
      if (suggestions) suggestions.textContent = "";

      (d.comptes || []).forEach(function (c) {
        if (c.supprime) return;
        vivants += 1;
        if (parRole[c.role] !== undefined) parRole[c.role] += 1;
        if (suggestions && c.pseudo) {
          var opt = document.createElement("option");
          opt.value = c.pseudo;
          opt.label = c.pseudo + " — " + c.role;
          suggestions.appendChild(opt);
        }
      });

      var comptesFiltres = obtenirDonneesFiltrees();
      if (!comptesFiltres.length) {
        var vide = ligne(["", "", "", "", ""]);
        vide.className = "ligne-vide";
        vide.firstChild.textContent = vivants
          ? "Aucun compte ne correspond à ce filtre."
          : "Aucun compte.";
        vide.firstChild.colSpan = 5;
        while (vide.childNodes.length > 1) vide.removeChild(vide.lastChild);
        corpsComptes.appendChild(vide);
      }
      comptesFiltres.forEach(function (c) {
        var nom = c.pseudo || "(pseudo pas encore choisi)";
        corpsComptes.appendChild(ligne([
          nom,
          c.role,
          quandAdmin(c.cree_le),
          quandAdmin(c.derniere_connexion),
          boutonsRole(c.pseudo, c.role)
        ]));
      });

      resume.textContent = vivants + " compte" + (vivants > 1 ? "s" : "")
        + " : " + parRole.user + " simple" + (parRole.user > 1 ? "s" : "")
        + ", " + parRole.reader_user + " en accès étendu"
        + ", " + parRole.super_user + " en administration."
        + (d.note ? " " + d.note : "");

      corpsJournal.textContent = "";
      if (!(d.journal || []).length) {
        corpsJournal.appendChild(ligne(["", "", "", "Aucune attribution pour l'instant."]));
      }
      (d.journal || []).forEach(function (j) {
        corpsJournal.appendChild(ligne([
          quandAdmin(j.quand), j.par, j.cible,
          (j.ancien_role || "?") + " " + String.fromCharCode(8594) + " " + j.nouveau_role
        ]));
      });

      mettreAJourIndicateursTri();
      creerBoutonsFiltrageRole();
    }

    function charger() {
      fetch("/api/admin/roles", { headers: { "Accept": "application/json" } })
        .then(function (r) {
          return r.json().then(function (d) { return { r: r, d: d }; });
        })
        .then(function (x) {
          if (!x.r.ok) { direAdmin(x.d.erreur || "Acces refuse.", "erreur"); return; }
          peindre(x.d);
        })
        .catch(function () { direAdmin("Service indisponible.", "erreur"); });
    }

    function attribuer(pseudo, role) {
      direAdmin("Attribution…", "info");
      fetch("/api/admin/roles", {
        method: "POST",
        headers: { "content-type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ pseudo: pseudo, role: role })
      })
        .then(function (r) {
          return r.json().then(function (d) { return { r: r, d: d }; });
        })
        .then(function (x) {
          if (!x.r.ok) { direAdmin(x.d.erreur || "Echec.", "erreur"); return; }
          direAdmin(pseudo + " : " + x.d.ancien_role + " "
                     + String.fromCharCode(8594) + " " + x.d.nouveau_role
                     + ". " + (x.d.note || ""), "succes");
          charger();
        })
        .catch(function () { direAdmin("Service indisponible.", "erreur"); });
    }

    champPseudo.addEventListener("input", function () {
      filtres.pseudo = this.value;
      peindre(donnees);
    });

    var entetes = tableauComptes.querySelectorAll("th.tri-colonne");
    entetes.forEach(function (th) {
      th.addEventListener("click", function () {
        var colonne = this.getAttribute("data-colonne");
        if (triActuel.colonne === colonne) {
          triActuel.direction = triActuel.direction === "asc" ? "desc" : "asc";
        } else {
          triActuel.colonne = colonne;
          triActuel.direction = "asc";
        }
        peindre(donnees);
      });
    });

    formRole.addEventListener("submit", function (ev) {
      ev.preventDefault();
      attribuer(document.getElementById("role-pseudo").value.trim(),
                document.getElementById("role-valeur").value);
    });

    /* ---------- les demandes d'acces ----------

       Une carte par demande en attente : le pseudo, la date, le texte, un
       champ de motif et deux boutons. Refuser sans motif est refuse ici ET
       par la base ; accepter passe par attribuer_role, donc par le journal
       des roles qui se recharge dans la foulee. Les demandes traitees
       restent listees en dessous, repliees : une decision se relit. */
    /* ---------- les onglets ----------
       Un seul ecran a la fois. Le choix est retenu dans localStorage :
       qui vient trier les demandes revient sur les demandes. */
    var boutonsOnglets = document.querySelectorAll("#admin-onglets .admin-onglet");
    function montrerOnglet(nom) {
      document.querySelectorAll(".admin-section").forEach(function (s) {
        s.hidden = s.getAttribute("data-section") !== nom;
      });
      boutonsOnglets.forEach(function (b) {
        b.classList.toggle("est-actif", b.getAttribute("data-onglet") === nom);
      });
      try { localStorage.setItem("admin-onglet", nom); } catch (e) { /* sans memoire */ }
    }
    boutonsOnglets.forEach(function (b) {
      b.addEventListener("click", function () { montrerOnglet(b.getAttribute("data-onglet")); });
    });
    var ongletRetenu = null;
    try { ongletRetenu = localStorage.getItem("admin-onglet"); } catch (e) { /* idem */ }
    if (ongletRetenu && document.querySelector('.admin-section[data-section="' + ongletRetenu + '"]')) {
      montrerOnglet(ongletRetenu);
    }


    /* ---------- les groupes, vus par l'administration ----------
       La liste et les effectifs, rien de plus ; et la base inscrit chaque
       lecture au journal des consultations. La note de la route le
       rappelle, pour que celui qui clique le sache. */
    /* ---------- les signalements (lot E) ----------
       Ouverts d'abord (une carte, « Ouvrir » mene a la page du groupe en
       lecture de signalement), les juges replies en dessous. Le compteur
       des ouverts est sur l'onglet, et chaque groupe de la table porte le
       sien. La liste est lue a l'ouverture de la page (pour le compteur) et
       a chaque ouverture de l'onglet. */
    var MOTIFS_SIG = { illicite: "contenu illicite", harcelement: "harcèlement", spam: "spam", autre: "autre" };
    var VERDICTS_SIG = { retire: "message retiré", sans_suite: "sans suite", avertissement: "avertissement" };
    var comptesSignalements = {};      /* groupe → nombre d'ouverts */
    function carteSignalement(x) {
      var carte = document.createElement("article");
      carte.className = "demande-carte" + (x.clos_le ? " demande-traitee" : "");
      carte.setAttribute("data-signalement", x.id);
      var tete = document.createElement("div"); tete.className = "demande-tete";
      tete.textContent = "n° " + x.id + " · " + (x.groupe_nom || "groupe disparu") + " · " + (MOTIFS_SIG[x.motif] || x.motif)
        + " · par " + (x.par || "compte supprimé") + " · " + quandAdmin(x.cree_le)
        + " · message n° " + x.message + " + " + x.contexte + " précédent" + (x.contexte > 1 ? "s" : "")
        + (x.clos_le ? " · verdict : " + (VERDICTS_SIG[x.verdict] || x.verdict) + (x.verdict_par ? " par " + x.verdict_par : "") + (x.verdict_le ? " le " + quandAdmin(x.verdict_le) : "") : "");
      carte.appendChild(tete);
      if (x.texte) { var t = document.createElement("blockquote"); t.className = "demande-motif"; t.textContent = x.texte; carte.appendChild(t); }
      if (x.clos_le && x.verdict_note) { var n = document.createElement("p"); n.className = "c-note"; n.textContent = "Note : " + x.verdict_note; carte.appendChild(n); }
      if (!x.clos_le && x.message_existe === false) { var a = document.createElement("p"); a.className = "c-note"; a.textContent = "Le message signalé a été effacé depuis (par son auteur, ou par un administrateur du groupe) ; les précédents restent lisibles."; carte.appendChild(a); }
      var p = document.createElement("p"); p.className = "admin-roles";
      var lien = document.createElement("a"); lien.className = "btn btn-mini" + (x.clos_le ? "" : " btn-accent");
      lien.href = "/groupes/groupe.html?id=" + encodeURIComponent(x.groupe) + "&signalement=" + x.id;
      lien.textContent = x.clos_le ? "Relire le signalement" : "Ouvrir la discussion →";
      p.appendChild(lien); carte.appendChild(p);
      return carte;
    }
    function chargerSignalementsAdmin() {
      var zone = document.getElementById("liste-signalements");
      if (!zone) return Promise.resolve();
      var zoneClos = document.getElementById("liste-signalements-clos");
      var note = document.getElementById("signalements-note");
      var badge = document.getElementById("badge-signalements");
      return fetch("/api/admin/signalements", { headers: { "Accept": "application/json" } })
        .then(function (r) { return r.json().then(function (d) { return { r: r, d: d }; }); })
        .then(function (x) {
          zone.textContent = ""; zoneClos.textContent = ""; comptesSignalements = {};
          if (!x.r.ok) { note.textContent = x.d.erreur || "Accès refusé."; return; }
          if (x.d.indisponible) { note.textContent = x.d.note || ""; badge.hidden = true; return; }
          var ouverts = 0, clos = 0;
          (x.d.signalements || []).forEach(function (sg) {
            if (sg.clos_le) { clos += 1; zoneClos.appendChild(carteSignalement(sg)); }
            else { ouverts += 1; zone.appendChild(carteSignalement(sg)); comptesSignalements[sg.groupe] = (comptesSignalements[sg.groupe] || 0) + 1; }
          });
          badge.textContent = String(ouverts); badge.hidden = !ouverts;
          note.textContent = ouverts ? ouverts + " signalement" + (ouverts > 1 ? "s" : "") + " en attente de verdict." : "Aucun signalement en attente.";
          if (!clos) { var v = document.createElement("p"); v.className = "c-note"; v.textContent = "Aucun verdict rendu."; zoneClos.appendChild(v); }
        })
        .catch(function () { note.textContent = "Service indisponible."; });
    }

    var zoneGroupesAdmin = document.getElementById("liste-groupes-admin");
    function chargerGroupesAdmin() {
      if (!zoneGroupesAdmin) return;
      var note = document.getElementById("groupes-admin-note");
      Promise.all([
        fetch("/api/admin/groupes", { headers: { "Accept": "application/json" } })
          .then(function (r) { return r.json().then(function (d) { return { r: r, d: d }; }); }),
        chargerSignalementsAdmin()
      ])
        .then(function (res) {
          var x = res[0];
          zoneGroupesAdmin.textContent = "";
          if (!x.r.ok) { note.textContent = x.d.erreur || "Accès refusé."; return; }
          note.textContent = x.d.note || "";
          if (!(x.d.groupes || []).length) { note.textContent = (x.d.note ? x.d.note + " " : "") + "Aucun groupe."; return; }
          x.d.groupes.forEach(function (g) {
            var n = comptesSignalements[g.id] || 0;
            var tr = ligne([
              g.nom + (g.description ? " — " + g.description : ""),
              g.createur || "?",
              quandAdmin(g.cree_le),
              g.membres + (g.invites ? " (+" + g.invites + " invité" + (g.invites > 1 ? "s" : "") + ")" : ""),
              String(g.seances),
              String(g.messages),
              n ? String(n) + " ouvert" + (n > 1 ? "s" : "") : "—"
            ]);
            if (n) tr.className = "admin-ligne-signalee";
            zoneGroupesAdmin.appendChild(tr);
          });
        })
        .catch(function () { note.textContent = "Service indisponible."; });
    }
    var boutonGroupesAdmin = document.querySelector('#admin-onglets [data-onglet="groupes"]');
    if (boutonGroupesAdmin) boutonGroupesAdmin.addEventListener("click", chargerGroupesAdmin);
    if (ongletRetenu === "groupes") chargerGroupesAdmin(); else chargerSignalementsAdmin();

    /* ---------- les propositions (lot G, complété au lot L) ----------
       En attente d'abord (une carte : type, ce qui est visé — en toutes
       lettres, avec un lien qui y mène —, pseudo, date, le texte, la
       motivation, une note et les boutons), puis les acceptées ; les
       refusées et intégrées repliées. Le compteur des en attente est sur
       l'onglet, lu à l'ouverture de la page. L'export : un .txt groupé par
       cible, à coller dans une session Claude — l'idée de l'agrégateur de
       la philo, ici sans base locale.

       Lot L : une proposition peut viser une zone qui n'existe PLUS (le
       site a bougé depuis). On croise donc chaque cible avec l'inventaire
       des zones (zones.json, réécrit à chaque génération) :
         - la zone existe → son intitulé d'aujourd'hui, et « Ouvrir » ;
         - elle a disparu → on le dit, et on garde l'intitulé enregistré au
           moment de l'envoi (cible_titre), sans quoi il ne resterait qu'un
           identifiant qui ne désigne plus rien.
       Une proposition d'avant le lot L n'a pas de cible_titre : on affiche
       alors la cible telle quelle, comme avant. */
    var ETATS_PROP = { en_attente: "en attente", acceptee: "acceptée", refusee: "refusée", integree: "intégrée" };
    var TYPES_PROP = { correction: "correction", ajout: "ajout", technique: "problème technique", fonctionnalite: "fonctionnalité" };
    var propositionsLues = [];
    /* S1-R104-06#ancre → /fiches/s1/R104/06.html#ancre ; S1-R104 → le module ;
       une page reste une page (elle porte déjà son chemin). */
    function lienCible(cible) {
      var m = /^S(\d)-([A-Z]\d{3})(?:-(\d{2}))?(#.*)?$/.exec(cible);
      if (!m) return cible;
      return "/fiches/s" + m[1] + "/" + m[2] + "/"
           + (m[3] ? m[3] + ".html" : "") + (m[4] || "");
    }

    /* L'inventaire des zones, vu par l'administration : { cible → intitulé }.
       Deux fichiers (le public, celui des fiches) ; un super_user lit les
       deux. S'il manque, on ne prétend rien : aucune cible n'est dite
       disparue sur la foi d'un inventaire qu'on n'a pas pu lire. */
    var zonesConnues = null;
    function chargerZonesAdmin() {
      if (zonesConnues) return Promise.resolve(zonesConnues);
      function lire(u) {
        return fetch(u, { headers: { "Accept": "application/json" } })
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; });
      }
      return Promise.all([lire("/zones.json"), lire("/fiches/zones.json")])
        .then(function (deux) {
          if (!deux[0] && !deux[1]) return null;
          var connues = {};
          deux.forEach(function (d) {
            ((d && d.racines) || []).forEach(function (r) {
              connues[r.cible] = r.titre;
              (r.zones || []).forEach(function (z) {
                connues[r.cible + "#" + z.id] = z.titre;
              });
            });
          });
          zonesConnues = connues;
          return connues;
        });
    }
    function carteProposition(p) {
      var carte = document.createElement("article");
      carte.className = "demande-carte" + (p.etat === "en_attente" ? "" : " demande-traitee");
      carte.setAttribute("data-proposition", p.id);
      var tete = document.createElement("div"); tete.className = "demande-tete";
      tete.appendChild(document.createTextNode("n° " + p.id + " · " + (TYPES_PROP[p.type] || p.type) + " · "));
      /* Ce qui est visé, en toutes lettres. L'intitulé d'aujourd'hui s'il
         existe encore, sinon celui enregistré à l'envoi, sinon la cible. */
      var vivante = zonesConnues ? zonesConnues[p.cible] : undefined;
      var a = document.createElement("a");
      a.href = lienCible(p.cible);
      a.textContent = vivante || p.cible_titre || p.cible;
      a.title = p.cible;
      tete.appendChild(a);
      if (zonesConnues && vivante === undefined) {
        var perdue = document.createElement("span");
        perdue.className = "grp-pastille grp-pastille-neutre";
        perdue.textContent = "zone disparue";
        perdue.title = "Cette cible (" + p.cible + ") n'existe plus dans le site tel qu'il est publié.";
        tete.appendChild(document.createTextNode(" "));
        tete.appendChild(perdue);
      }
      tete.appendChild(document.createTextNode(" · " + (p.par || "compte supprimé") + " · " + quandAdmin(p.cree_le)
        + (p.etat === "en_attente" ? "" : " · " + (ETATS_PROP[p.etat] || p.etat) + (p.traite_par ? " par " + p.traite_par : "") + (p.traite_le ? " le " + quandAdmin(p.traite_le) : ""))));
      carte.appendChild(tete);
      var t = document.createElement("blockquote"); t.className = "demande-motif"; t.textContent = p.texte; carte.appendChild(t);
      var m = document.createElement("p"); m.className = "c-note"; m.textContent = "Pourquoi : " + p.motivation; carte.appendChild(m);
      if (p.note) { var n = document.createElement("p"); n.className = "c-note"; n.textContent = "Note : " + p.note; carte.appendChild(n); }
      var champ = document.createElement("textarea");
      champ.rows = 2; champ.maxLength = 2000;
      champ.placeholder = "Note — obligatoire pour un refus ; l'auteur la lira.";
      carte.appendChild(champ);
      var actions = document.createElement("div"); actions.className = "admin-roles";
      var boutons = [];
      function bouton(libelle, etat, accent) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "btn btn-mini" + (accent ? " btn-accent" : ""); b.textContent = libelle;
        b.addEventListener("click", function () { trierProposition(p.id, etat, champ.value, boutons); });
        boutons.push(b); actions.appendChild(b);
      }
      if (p.etat === "en_attente") { bouton("Accepter", "acceptee", true); bouton("Refuser", "refusee"); bouton("Intégrée", "integree"); }
      else if (p.etat === "acceptee") { bouton("Intégrée", "integree", true); bouton("Refuser", "refusee"); bouton("Remettre en attente", "en_attente"); }
      else { bouton("Remettre en attente", "en_attente"); }
      carte.appendChild(actions);
      return carte;
    }
    function chargerPropositionsAdmin() {
      var zone = document.getElementById("liste-propositions");
      if (!zone) return Promise.resolve();
      var zoneTriees = document.getElementById("liste-propositions-triees");
      var note = document.getElementById("propositions-note");
      var badge = document.getElementById("badge-propositions");
      return chargerZonesAdmin()
        .then(function () { return fetch("/api/admin/propositions", { headers: { "Accept": "application/json" } }); })
        .then(function (r) { return r.json().then(function (d) { return { r: r, d: d }; }); })
        .then(function (x) {
          zone.textContent = ""; zoneTriees.textContent = ""; propositionsLues = [];
          if (!x.r.ok) { note.textContent = x.d.erreur || "Accès refusé."; return; }
          if (x.d.indisponible) { note.textContent = x.d.note || ""; badge.hidden = true; return; }
          propositionsLues = x.d.propositions || [];
          var attente = 0, triees = 0;
          propositionsLues.forEach(function (p) {
            if (p.etat === "en_attente" || p.etat === "acceptee") { if (p.etat === "en_attente") attente += 1; zone.appendChild(carteProposition(p)); }
            else { triees += 1; zoneTriees.appendChild(carteProposition(p)); }
          });
          badge.textContent = String(attente); badge.hidden = !attente;
          note.textContent = attente ? attente + " proposition" + (attente > 1 ? "s" : "") + " en attente." : "Aucune proposition en attente.";
          if (!triees) { var v = document.createElement("p"); v.className = "c-note"; v.textContent = "Rien de trié pour l'instant."; zoneTriees.appendChild(v); }
        })
        .catch(function () { note.textContent = "Service indisponible."; });
    }
    function trierProposition(id, etat, note, boutons) {
      if (etat === "refusee" && note.trim().length < 10) { direAdmin("Un refus se motive : écris au moins une phrase.", "erreur"); return; }
      boutons.forEach(function (b) { b.disabled = true; });
      direAdmin("Enregistrement…", "info");
      fetch("/api/admin/propositions", {
        method: "POST", headers: { "content-type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ id: id, etat: etat, note: note.trim() })
      })
        .then(function (r) { return r.json().then(function (d) { return { r: r, d: d }; }); })
        .then(function (x) {
          if (!x.r.ok) { boutons.forEach(function (b) { b.disabled = false; }); direAdmin(x.d.erreur || "Échec.", "erreur"); return; }
          direAdmin("Proposition " + (ETATS_PROP[x.d.etat] || x.d.etat) + ".", "succes");
          chargerPropositionsAdmin();
        })
        .catch(function () { boutons.forEach(function (b) { b.disabled = false; }); direAdmin("Service indisponible.", "erreur"); });
    }
    /* Le texte de l'export : un en-tête qui dit à Claude quoi en faire, puis
       une section par cible (fiche ou page), dans l'ordre des identifiants ;
       chaque proposition porte son numéro [PROPOSITION n] pour qu'on
       retrouve, après la reprise, quoi marquer « intégrée ». */
    function texteExportPropositions(liste, quand) {
      var parCible = {};
      liste.forEach(function (p) { (parCible[p.cible.split("#")[0]] = parCible[p.cible.split("#")[0]] || []).push(p); });
      var cibles = Object.keys(parCible).sort();
      var out = ["PROPOSITIONS — exemple.fr — " + quand,
                 liste.length + " proposition" + (liste.length > 1 ? "s" : "") + ", " + cibles.length + " cible" + (cibles.length > 1 ? "s" : "") + ".",
                 "",
                 "Consigne : pour chaque proposition, dire si elle est fondée (vérifier contre une",
                 "source publique), puis l'intégrer dans content/<MODULE>/<NN>.html à la section",
                 "visée, ou l'écarter en disant pourquoi. Les identifiants S1-R104-06#ancre",
                 "désignent modules/R104.json → partie 06 → l'ancre du <h2>. Répondre avec la",
                 "liste des numéros [PROPOSITION n] intégrés, pour les marquer dans l'administration.",
                 ""];
      cibles.forEach(function (c) {
        out.push("=".repeat(72)); out.push(c.charAt(0) === "/" ? "PAGE " + c : "FICHE " + c); out.push("=".repeat(72));
        parCible[c].forEach(function (p) {
          out.push("");
          var dit = (zonesConnues && zonesConnues[p.cible]) || p.cible_titre || "";
          out.push("[PROPOSITION " + p.id + "] " + (TYPES_PROP[p.type] || p.type) + " · " + p.cible
            + (dit ? " (" + dit + ")" : "")
            + (zonesConnues && zonesConnues[p.cible] === undefined ? " [ZONE DISPARUE]" : "")
            + " · " + (p.par || "compte supprimé") + " · " + (p.cree_le || "").slice(0, 10) + " · " + (ETATS_PROP[p.etat] || p.etat));
          out.push("Proposition : " + p.texte);
          out.push("Pourquoi : " + p.motivation);
          if (p.note) out.push("Note de l'administrateur : " + p.note);
        });
        out.push("");
      });
      return out.join("\n") + "\n";
    }
    var boutonExportProp = document.getElementById("propositions-exporter");
    if (boutonExportProp) {
      boutonExportProp.addEventListener("click", function () {
        var acceptees = document.getElementById("propositions-export-acceptees").checked;
        var attente = document.getElementById("propositions-export-attente").checked;
        var liste = propositionsLues.filter(function (p) { return (p.etat === "acceptee" && acceptees) || (p.etat === "en_attente" && attente); });
        if (!liste.length) { direAdmin("Rien à exporter avec ce choix.", "info"); return; }
        var jour = new Date().toISOString().slice(0, 10);
        var blob = new Blob([texteExportPropositions(liste, jour)], { type: "text/plain;charset=utf-8" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "propositions_" + jour + ".txt";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        direAdmin(liste.length + " proposition" + (liste.length > 1 ? "s" : "") + " exportée" + (liste.length > 1 ? "s" : "") + ".", "succes");
      });
    }
    chargerPropositionsAdmin();

    var zoneDemandes = document.getElementById("liste-demandes");
    var zoneTraitees = document.getElementById("liste-demandes-traitees");
    var resumeDemandes = document.getElementById("demandes-resume");

    function carteDemande(d, active) {
      var carte = document.createElement("article");
      carte.className = "demande-carte" + (active ? "" : " demande-traitee");
      var tete = document.createElement("div");
      tete.className = "demande-tete";
      tete.textContent = d.pseudo + " · " + quandAdmin(d.cree_le)
        + (active ? "" : " · " + (d.statut === "acceptee" ? "acceptée" : "refusée")
                         + (d.traite_par ? " par " + d.traite_par : "")
                         + (d.traite_le ? " le " + quandAdmin(d.traite_le) : ""));
      carte.appendChild(tete);
      var texte = document.createElement("blockquote");
      texte.className = "demande-motif";
      texte.textContent = d.justification;
      carte.appendChild(texte);
      if (!active && d.motif) {
        var rep = document.createElement("p");
        rep.className = "c-note";
        rep.textContent = "Motif : " + d.motif;
        carte.appendChild(rep);
      }
      if (active) {
        var champ = document.createElement("textarea");
        champ.rows = 3;
        champ.maxLength = 2000;
        champ.placeholder = "Motif — obligatoire pour un refus, utile pour une acceptation.";
        carte.appendChild(champ);
        var actions = document.createElement("div");
        actions.className = "admin-roles";
        var ok = document.createElement("button");
        ok.type = "button"; ok.className = "btn btn-mini btn-accent"; ok.textContent = "Accepter";
        ok.addEventListener("click", function () { trancher(d.id, "acceptee", champ.value, ok, non); });
        var non = document.createElement("button");
        non.type = "button"; non.className = "btn btn-mini"; non.textContent = "Refuser";
        non.addEventListener("click", function () { trancher(d.id, "refusee", champ.value, ok, non); });
        actions.appendChild(ok); actions.appendChild(non);
        carte.appendChild(actions);
      }
      return carte;
    }

    function peindreDemandes(d) {
      zoneDemandes.textContent = "";
      zoneTraitees.textContent = "";
      if (d.indisponible) { resumeDemandes.textContent = d.note || ""; return; }
      var attente = 0, traitees = 0;
      (d.demandes || []).forEach(function (x) {
        if (x.statut === "en_attente") { attente += 1; zoneDemandes.appendChild(carteDemande(x, true)); }
        else { traitees += 1; zoneTraitees.appendChild(carteDemande(x, false)); }
      });
      resumeDemandes.textContent = attente
        ? attente + " demande" + (attente > 1 ? "s" : "") + " en attente."
        : "Aucune demande en attente.";
      /* Le badge de l'onglet : visible des qu'il y a quelque chose a lire. */
      var badge = document.getElementById("badge-demandes");
      if (badge) { badge.textContent = String(attente); badge.hidden = !attente; }
      if (!traitees) zoneTraitees.textContent = "Aucune décision pour l'instant.";
    }

    function chargerDemandes() {
      if (!zoneDemandes) return;
      fetch("/api/admin/demandes", { headers: { "Accept": "application/json" } })
        .then(function (r) {
          return r.json().then(function (d) { return { r: r, d: d }; });
        })
        .then(function (x) {
          if (!x.r.ok) { resumeDemandes.textContent = x.d.erreur || "Accès refusé."; return; }
          peindreDemandes(x.d);
        })
        .catch(function () { resumeDemandes.textContent = "Service indisponible."; });
    }

    function trancher(id, decision, motif, b1, b2) {
      if (decision === "refusee" && motif.trim().length < 10) {
        direAdmin("Un refus se motive : écris au moins une phrase.", "erreur");
        return;
      }
      b1.disabled = true; b2.disabled = true;
      direAdmin("Enregistrement…", "info");
      fetch("/api/admin/demandes", {
        method: "POST",
        headers: { "content-type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ id: id, decision: decision, motif: motif.trim() })
      })
        .then(function (r) {
          return r.json().then(function (d) { return { r: r, d: d }; });
        })
        .then(function (x) {
          if (!x.r.ok) { b1.disabled = false; b2.disabled = false; direAdmin(x.d.erreur || "Échec.", "erreur"); return; }
          direAdmin(x.d.note || "Enregistré.", "succes");
          chargerDemandes();
          /* Une acceptation est une attribution : la table des comptes et
             le journal doivent le montrer sans recharger la page. */
          if (decision === "acceptee") charger();
        })
        .catch(function () { b1.disabled = false; b2.disabled = false; direAdmin("Service indisponible.", "erreur"); });
    }

    chargerDemandes();

    charger();
  }
})();
