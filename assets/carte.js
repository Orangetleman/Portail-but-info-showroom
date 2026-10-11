/* ===========================================================================
   La carte du projet — le graphe et le radial
   ===========================================================================

   L'arbre de /admin/carte.html est du HTML : un <details> par nœud, écrit par
   build_site.py depuis carte.py. Ces deux vues-ci ne reçoivent AUCUNE donnée
   à part. Elles lisent l'arbre déjà posé dans la page, et le redessinent.

   C'est le point qui tient tout le reste :

   - il n'y a pas de seconde copie des nœuds, donc rien qui puisse dériver
     de l'arbre — ce que carte.py extrait du code arrive ici sans intermédiaire ;
   - l'état de pliage est celui des <details>. Replier une branche dans le
     graphe la replie dans l'arbre, et réciproquement : il n'y a qu'un état ;
   - les filtres par domaine et la recherche marquent les nœuds avec
     `ca-hors` et `ca-filtre-hors`. Les deux vues n'ont donc rien à savoir de
     la recherche : elles ne dessinent que ce qui n'est pas marqué.

   Ce fichier est chargé par la seule page qui en a besoin, avant site.js ;
   il expose window.CarteVues, que site.js rappelle quand un filtre bouge.
   Sans lui, l'arbre fonctionne exactement comme avant.
   =========================================================================== */
(function () {
  "use strict";

  var arbre = document.getElementById("ca-arbre");
  var toile = document.getElementById("ca-toile");
  var svg = document.getElementById("ca-svg");
  var detail = document.getElementById("ca-detail");
  if (!arbre || !toile || !svg) return;

  var NS = "http://www.w3.org/2000/svg";
  var HAUT = 34;                 // hauteur d'une boîte, dans le graphe
  var LARG = 200;                // largeur d'une boîte, dans le graphe
  var ECART_X = 76, ECART_Y = 12;
  var RAYON0 = 230;              // la couronne des domaines, dans le radial
  var TOUR = 2 * Math.PI;

  var vue = "arbre";             // arbre | graphe | radial
  var vus = [];                  // les nœuds dessinés au dernier rendu
  var choisi = null;
  var vb = { x: 0, y: 0, w: 1200, h: 800 };

  /* ────────────── le modèle, lu dans l'arbre de la page ────────────── */

  var racines = [];

  function texteDe(el, sel) {
    var p = el.querySelector(sel);
    return p ? p.textContent.trim() : "";
  }

  function lire(el, parent) {
    var tete = el.querySelector(":scope > .ca-t");
    var pastille = tete.querySelector(".ca-pastille");
    var genre = tete.querySelector(".ca-genre");
    var ref = tete.querySelector("a.carte-ref");
    var n = {
      id: el.getAttribute("data-id") || "",
      niveau: +el.getAttribute("data-niveau") || 0,
      label: tete.querySelector(".ca-label").textContent.trim(),
      genre: genre ? genre.textContent.trim() : "",
      couleur: (pastille && pastille.style.background) || "#888",
      novice: texteDe(el, ":scope > .ca-novice"),
      ingenieur: texteDe(el, ":scope > .ca-ing"),
      ref: ref ? ref.textContent.trim() : "",
      lien: ref ? ref.getAttribute("href") : "",
      el: el,
      parent: parent,
      fils: []
    };
    var sac = el.querySelector(":scope > .ca-fils");
    if (sac) {
      var enfants = sac.children;
      for (var i = 0; i < enfants.length; i++) {
        if (enfants[i].classList.contains("ca-n")) n.fils.push(lire(enfants[i], n));
      }
    }
    return n;
  }

  var hauts = arbre.children;
  for (var i = 0; i < hauts.length; i++) {
    if (hauts[i].classList && hauts[i].classList.contains("ca-n")) racines.push(lire(hauts[i], null));
  }
  if (!racines.length) return;

  /* Un nœud est dessiné s'il n'est marqué ni par un filtre de domaine
     (`ca-hors`) ni par la recherche (`ca-filtre-hors`) — exactement ce que
     le CSS cache dans l'arbre. */
  function visible(n) {
    return !n.el.classList.contains("ca-hors") && !n.el.classList.contains("ca-filtre-hors");
  }
  function ouvert(n) {
    return n.el.tagName === "DETAILS" && n.el.open;
  }
  function filsVisibles(n) {
    if (!ouvert(n)) return [];
    return n.fils.filter(visible);
  }
  function couper(s, max) {
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }
  function marque(n) {
    return n.fils.length ? (ouvert(n) ? "▾ " : "▸ ") : "";
  }

  /* ────────────── disposition 1 : le graphe ──────────────

     De gauche à droite, un niveau par colonne. Les feuilles se suivent sur
     une seule file verticale ; un parent se pose au milieu de ses enfants.
     C'est la disposition la plus lisible quand les étiquettes sont longues —
     ici, des noms de fichiers et de fonctions. */
  function disposerGraphe() {
    vus = [];
    var curseur = 0;
    function placer(n) {
      vus.push(n);
      n._x = n.niveau * (LARG + ECART_X);
      var k = filsVisibles(n);
      if (!k.length) {
        n._y = curseur;
        curseur += HAUT + ECART_Y;
      } else {
        k.forEach(placer);
        n._y = (k[0]._y + k[k.length - 1]._y) / 2;
      }
      n._cx = n._x + LARG / 2;
      n._cy = n._y + HAUT / 2;
    }
    racines.filter(visible).forEach(function (r) {
      placer(r);
      curseur += HAUT;                       // une respiration entre domaines
    });
  }

  /* ────────────── disposition 2 : le radial ──────────────

     Un moyeu au centre, les domaines en couronnes. Chaque sous-arbre reçoit
     un secteur proportionnel à son nombre de feuilles visibles : sans cela,
     un domaine à trois nœuds occuperait autant de tour qu'un domaine à deux
     cents, et la vue mentirait sur les proportions — qui sont précisément ce
     qu'on vient y chercher.

     Deux choix viennent d'un essai raté. Des boîtes horizontales, comme dans
     le graphe, se chevauchent en haut et en bas du cercle dès qu'il y a plus
     d'une centaine de feuilles : deux voisines y sont côte à côte, et une
     boîte est six fois plus large que haute. D'où :

     - le rayon extérieur est CALCULÉ pour que la circonférence donne à chaque
       feuille la place d'une ligne de texte. Il grandit donc avec l'arbre, au
       lieu d'être un réglage fixe qu'on retouche à chaque fois ;
     - l'étiquette suit le rayon. Deux voisines ne se croisent plus, puisque
       ce qui les sépare est justement la direction où elles ne s'étendent pas.

     Reste le cas des secteurs minces : un domaine replié, seul contre deux
     cents nœuds dépliés, reçoit un centième de tour, et à 230 pixels du
     centre cela ne fait pas la hauteur d'une ligne — les sept domaines se
     chevauchaient. La règle qui répare, et qui vaut à tous les niveaux : un
     nœud S'ÉLOIGNE jusqu'à ce que son propre secteur ait la largeur d'une
     ligne. Un enfant a toujours un secteur plus mince que son parent, donc il
     reste toujours au-delà de lui : l'arbre ne se retourne pas. La couronne
     des domaines cesse d'être un cercle parfait ; en échange, plus rien ne se
     recouvre, à aucun état de pliage. */
  var cacheFeuilles = null;
  function feuilles(n) {
    if (cacheFeuilles[n.id] !== undefined) return cacheFeuilles[n.id];
    var k = filsVisibles(n), s = 0;
    if (!k.length) s = 1;
    else k.forEach(function (c) { s += feuilles(c); });
    cacheFeuilles[n.id] = s;
    return s;
  }
  function profondeur(n) {
    var k = filsVisibles(n), p = n.niveau;
    k.forEach(function (c) { p = Math.max(p, profondeur(c)); });
    return p;
  }

  function disposerRadial() {
    vus = [];
    cacheFeuilles = {};
    var rs = racines.filter(visible), total = 0, prof = 0;
    rs.forEach(function (r) { total += feuilles(r); prof = Math.max(prof, profondeur(r)); });
    if (!total) total = 1;

    // De la place pour une ligne de texte par feuille, sur la couronne externe.
    var rMax = Math.max(RAYON0 + 220, total * 22 / TOUR);
    var pas = prof > 0 ? (rMax - RAYON0) / prof : 0;

    function placer(n, a0, a1) {
      vus.push(n);
      var a = (a0 + a1) / 2;
      var r = Math.max(RAYON0 + n.niveau * pas, 19 / Math.max(a1 - a0, 1e-6));
      n._a = a;
      n._cx = r * Math.cos(a);
      n._cy = r * Math.sin(a);
      var k = filsVisibles(n);
      if (!k.length) return;
      var t = 0;
      k.forEach(function (c) { t += feuilles(c); });
      var cur = a0;
      k.forEach(function (c) {
        var part = (a1 - a0) * feuilles(c) / (t || 1);
        placer(c, cur, cur + part);
        cur += part;
      });
    }
    var ang = -Math.PI / 2;
    rs.forEach(function (r) {
      var part = TOUR * feuilles(r) / total;
      placer(r, ang, ang + part);
      ang += part;
    });
  }

  /* ────────────── le dessin ────────────── */

  function svgEl(nom, attrs) {
    var el = document.createElementNS(NS, nom);
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) el.setAttribute(k, attrs[k]);
    }
    return el;
  }

  function groupeNoeud(n) {
    var classe = "ca-g-n ca-g-l" + Math.min(n.niveau, 3);
    if (n === choisi) classe += " est-choisi";
    var g = svgEl("g", {
      "class": classe,
      tabindex: "0",
      role: "button",
      "aria-label": n.label + (n.genre ? ", " + n.genre : "")
                  + (n.fils.length ? (ouvert(n) ? ", déplié" : ", replié") : "")
    });
    var titre = svgEl("title", {});
    titre.textContent = n.label + (n.genre ? " — " + n.genre : "")
                      + (n.fils.length ? " (" + n.fils.length + ")" : "");
    g.appendChild(titre);
    g.addEventListener("click", function (ev) { ev.stopPropagation(); activer(n); });
    g.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); activer(n); }
    });
    return g;
  }

  function boiteNoeud(n) {
    var g = groupeNoeud(n);
    g.setAttribute("transform", "translate(" + n._x + "," + n._y + ")");
    g.appendChild(svgEl("rect", { "class": "ca-g-boite", width: LARG, height: HAUT, rx: 7 }));
    g.appendChild(svgEl("rect", { "class": "ca-g-bande", width: 4, height: HAUT,
                                  rx: 2, fill: n.couleur }));
    var t = svgEl("text", { "class": "ca-g-label", x: 13, y: HAUT / 2 + 4 });
    t.textContent = marque(n) + couper(n.label, 24);
    g.appendChild(t);
    return g;
  }

  function pointNoeud(n) {
    var g = groupeNoeud(n);
    // La rotation retourne l'étiquette sur la moitié gauche du cercle : sans
    // cela, la moitié du tour se lirait la tête en bas.
    var deg = n._a * 180 / Math.PI;
    var retourne = Math.cos(n._a) < 0;
    g.setAttribute("transform", "translate(" + n._cx + "," + n._cy + ") rotate(" + deg + ")"
                                + (retourne ? " rotate(180)" : ""));
    g.appendChild(svgEl("circle", { "class": "ca-g-cible", r: 13 }));
    g.appendChild(svgEl("circle", { "class": "ca-g-point", r: n.niveau <= 1 ? 6 : 4,
                                    fill: n.couleur }));
    var t = svgEl("text", {
      "class": "ca-g-rlabel", y: 4,
      x: retourne ? -11 : 11,
      "text-anchor": retourne ? "end" : "start"
    });
    t.textContent = marque(n) + couper(n.label, 26);
    g.appendChild(t);
    return g;
  }

  function dessiner() {
    if (vue === "radial") disposerRadial(); else disposerGraphe();
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var gLiens = svgEl("g", { "class": "ca-g-liens" });
    var gNoeuds = svgEl("g", { "class": "ca-g-noeuds" });
    svg.appendChild(gLiens);
    svg.appendChild(gNoeuds);

    if (vue === "radial") {
      vus.forEach(function (n) {
        if (n.niveau === 0) {
          gLiens.appendChild(svgEl("line", { x1: 0, y1: 0, x2: n._cx, y2: n._cy,
                                             "class": "ca-g-lien ca-g-moyeu" }));
        }
        filsVisibles(n).forEach(function (c) {
          gLiens.appendChild(svgEl("line", { x1: n._cx, y1: n._cy, x2: c._cx, y2: c._cy,
                                             "class": "ca-g-lien" }));
        });
      });
      gLiens.appendChild(svgEl("circle", { cx: 0, cy: 0, r: 9, "class": "ca-g-coeur" }));
      vus.forEach(function (n) { gNoeuds.appendChild(pointNoeud(n)); });
    } else {
      vus.forEach(function (n) {
        filsVisibles(n).forEach(function (c) {
          var x1 = n._x + LARG, y1 = n._cy, x2 = c._x, y2 = c._cy, mx = (x1 + x2) / 2;
          gLiens.appendChild(svgEl("path", {
            d: "M" + x1 + "," + y1 + " C" + mx + "," + y1 + " " + mx + "," + y2 + " " + x2 + "," + y2,
            "class": "ca-g-lien"
          }));
        });
      });
      vus.forEach(function (n) { gNoeuds.appendChild(boiteNoeud(n)); });
    }
  }

  /* Un clic fait les deux choses qu'on attend de lui : il ouvre la branche
     s'il y en a une, et il affiche les mots du nœud. Rien à viser. */
  function activer(n) {
    choisi = n;
    if (n.fils.length && n.el.tagName === "DETAILS") n.el.open = !n.el.open;
    dessiner();
    montrer(n);
  }

  /* ────────────── le panneau du nœud choisi ────────────── */

  function montrer(n) {
    if (!detail) return;
    while (detail.firstChild) detail.removeChild(detail.firstChild);
    detail.hidden = false;

    var tete = document.createElement("p");
    tete.className = "ca-d-tete";
    var pastille = document.createElement("span");
    pastille.className = "ca-pastille";
    pastille.style.background = n.couleur;
    var nom = document.createElement("strong");
    nom.textContent = n.label;
    tete.appendChild(pastille);
    tete.appendChild(nom);
    if (n.genre) {
      var g = document.createElement("span");
      g.className = "ca-genre";
      g.textContent = n.genre;
      tete.appendChild(g);
    }
    if (n.lien) {
      var a = document.createElement("a");
      a.className = "carte-ref";
      a.href = n.lien;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = n.ref;
      tete.appendChild(a);
    }
    detail.appendChild(tete);

    /* Les deux lectures ensemble : ici on a la place, et c'est le moment où
       la comparaison sert — « Découverte » dit à quoi ça sert, « Technique »
       dit ce que c'est. */
    if (n.novice) {
      var p = document.createElement("p");
      p.className = "ca-novice";
      p.textContent = n.novice;
      detail.appendChild(p);
    }
    if (n.ingenieur) {
      var q = document.createElement("p");
      q.className = "ca-ing";
      q.textContent = n.ingenieur;
      detail.appendChild(q);
    }
    if (!n.novice && !n.ingenieur) {
      var m = document.createElement("p");
      m.className = "ca-manque";
      m.textContent = "Pas encore décrit.";
      detail.appendChild(m);
    }

    var pied = document.createElement("p");
    pied.className = "ca-d-pied";
    var vers = document.createElement("button");
    vers.type = "button";
    vers.className = "btn btn-mince";
    vers.textContent = "Voir dans l'arbre";
    vers.addEventListener("click", function () {
      var p = n.parent;
      while (p) { if (p.el.tagName === "DETAILS") p.el.open = true; p = p.parent; }
      basculer("arbre");
      n.el.scrollIntoView({ block: "center" });
      n.el.classList.add("ca-vise");
      setTimeout(function () { n.el.classList.remove("ca-vise"); }, 1800);
    });
    pied.appendChild(vers);
    detail.appendChild(pied);
  }

  /* ────────────── cadrage, déplacement, zoom ────────────── */

  function appliquer() {
    svg.setAttribute("viewBox", vb.x + " " + vb.y + " " + vb.w + " " + vb.h);
  }

  /* Le viewBox est mis au format de la boîte : sans cela « meet » ajoute des
     marges invisibles, et tout le calcul écran → dessin (zoom au pointeur,
     pincement) se décale d'autant. */
  function ajusterFormat() {
    var r = svg.getBoundingClientRect();
    if (!r.width || !r.height || !vb.w || !vb.h) return;
    var voulu = r.width / r.height, actuel = vb.w / vb.h;
    if (actuel < voulu) {
      var nw = vb.h * voulu;
      vb.x -= (nw - vb.w) / 2;
      vb.w = nw;
    } else {
      var nh = vb.w / voulu;
      vb.y -= (nh - vb.h) / 2;
      vb.h = nh;
    }
  }

  function cadrer() {
    if (!vus.length) {
      vb = { x: -600, y: -400, w: 1200, h: 800 };
    } else {
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      if (vue === "radial") {
        // Le point, et le bout de son étiquette : elle part vers l'extérieur,
        // donc c'est elle qui fixe le cadre.
        x0 = y0 = -40; x1 = y1 = 40;
        vus.forEach(function (n) {
          var l = 16 + 6.6 * Math.min(n.label.length + 2, 28);
          [0, l].forEach(function (d) {
            var px = n._cx + Math.cos(n._a) * d, py = n._cy + Math.sin(n._a) * d;
            x0 = Math.min(x0, px); y0 = Math.min(y0, py);
            x1 = Math.max(x1, px); y1 = Math.max(y1, py);
          });
        });
      } else {
        vus.forEach(function (n) {
          x0 = Math.min(x0, n._x); y0 = Math.min(y0, n._y);
          x1 = Math.max(x1, n._x + LARG); y1 = Math.max(y1, n._y + HAUT);
        });
      }
      var m = 50;
      vb = { x: x0 - m, y: y0 - m,
             w: Math.max(400, x1 - x0 + m * 2), h: Math.max(300, y1 - y0 + m * 2) };
    }
    ajusterFormat();
    appliquer();
  }

  function zoomer(f, px, py) {
    var nw = Math.min(90000, Math.max(220, vb.w * f));
    var k = nw / vb.w;
    vb.x = px - (px - vb.x) * k;
    vb.y = py - (py - vb.y) * k;
    vb.w = nw;
    vb.h = vb.h * k;
    appliquer();
  }
  function versDessin(cx, cy) {
    var r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return { x: vb.x + vb.w / 2, y: vb.y + vb.h / 2 };
    return { x: vb.x + (cx - r.left) / r.width * vb.w,
             y: vb.y + (cy - r.top) / r.height * vb.h };
  }

  svg.addEventListener("wheel", function (ev) {
    ev.preventDefault();
    var p = versDessin(ev.clientX, ev.clientY);
    zoomer(ev.deltaY > 0 ? 1.15 : 1 / 1.15, p.x, p.y);
  }, { passive: false });

  /* Un doigt (ou la souris) déplace ; deux doigts pincent. Les deux passent
     par les mêmes événements « pointer » : le même code sert donc à la
     souris, au stylet et au tactile. */
  var pointeurs = {}, glisse = null, pince = null, aBouge = false;

  svg.addEventListener("pointerdown", function (ev) {
    pointeurs[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    var ids = Object.keys(pointeurs);
    aBouge = false;
    if (ids.length === 1) {
      try { svg.setPointerCapture(ev.pointerId); } catch (e) { /* refusée : le glissé marche quand même */ }
      glisse = { ex: ev.clientX, ey: ev.clientY, vx: vb.x, vy: vb.y };
      pince = null;
    } else if (ids.length === 2) {
      glisse = null;
      var a = pointeurs[ids[0]], b = pointeurs[ids[1]];
      var p = versDessin((a.x + b.x) / 2, (a.y + b.y) / 2);
      pince = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, w: vb.w, h: vb.h, px: p.x, py: p.y };
    }
  });

  svg.addEventListener("pointermove", function (ev) {
    if (!pointeurs[ev.pointerId]) return;
    pointeurs[ev.pointerId].x = ev.clientX;
    pointeurs[ev.pointerId].y = ev.clientY;
    var r = svg.getBoundingClientRect(), ids = Object.keys(pointeurs);
    if (!r.width || !r.height) return;
    if (ids.length === 1 && glisse) {
      if (Math.abs(ev.clientX - glisse.ex) + Math.abs(ev.clientY - glisse.ey) > 3) aBouge = true;
      vb.x = glisse.vx - (ev.clientX - glisse.ex) / r.width * vb.w;
      vb.y = glisse.vy - (ev.clientY - glisse.ey) / r.height * vb.h;
      appliquer();
    } else if (ids.length === 2 && pince) {
      aBouge = true;
      var a = pointeurs[ids[0]], b = pointeurs[ids[1]];
      var d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      var k = Math.min(20, Math.max(0.05, pince.d / d));
      vb.w = pince.w * k;
      vb.h = pince.h * k;
      var mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
      vb.x = pince.px - mx / r.width * vb.w;
      vb.y = pince.py - my / r.height * vb.h;
      appliquer();
    }
  });

  function relacher(ev) {
    delete pointeurs[ev.pointerId];
    if (!Object.keys(pointeurs).length) { glisse = null; pince = null; }
  }
  svg.addEventListener("pointerup", relacher);
  svg.addEventListener("pointercancel", relacher);
  svg.addEventListener("pointerleave", relacher);

  /* Un glissé qui finit sur un nœud ne doit pas l'ouvrir : on déplaçait. */
  svg.addEventListener("click", function (ev) {
    if (aBouge) { ev.stopPropagation(); ev.preventDefault(); }
  }, true);

  window.addEventListener("resize", function () {
    if (vue === "arbre") return;
    ajusterFormat();
    appliquer();
  });

  /* ────────────── la bascule entre les trois vues ────────────── */

  function basculer(quelle) {
    vue = quelle;
    document.querySelectorAll("#ca-dispo .ca-vueb").forEach(function (b) {
      var sien = b.getAttribute("data-vue") === quelle;
      b.classList.toggle("est-actif", sien);
      b.setAttribute("aria-pressed", sien ? "true" : "false");
    });
    arbre.hidden = quelle !== "arbre";
    toile.hidden = quelle === "arbre";
    if (detail) detail.hidden = quelle === "arbre" || !choisi;
    if (quelle !== "arbre") { dessiner(); cadrer(); }
  }

  document.querySelectorAll("#ca-dispo .ca-vueb").forEach(function (b) {
    b.addEventListener("click", function () { basculer(b.getAttribute("data-vue")); });
  });

  var zp = document.getElementById("ca-zplus");
  var zm = document.getElementById("ca-zmoins");
  var zc = document.getElementById("ca-cadrer");
  if (zp) zp.addEventListener("click", function () { zoomer(1 / 1.3, vb.x + vb.w / 2, vb.y + vb.h / 2); });
  if (zm) zm.addEventListener("click", function () { zoomer(1.3, vb.x + vb.w / 2, vb.y + vb.h / 2); });
  if (zc) zc.addEventListener("click", cadrer);

  /* site.js rappelle ceci quand un filtre, la recherche ou « tout déplier »
     a changé l'arbre : les deux vues repartent de l'arbre, donc un simple
     redessin suffit — il n'y a rien à synchroniser. */
  window.CarteVues = {
    redessiner: function (recadrer) {
      if (vue === "arbre") return;
      dessiner();
      if (recadrer) cadrer();
    },
    vue: function () { return vue; }
  };
})();
