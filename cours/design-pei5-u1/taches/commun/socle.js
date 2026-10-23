// =====================================================================
// socle.js · enregistrement commun des pages d'activités (tous les cours)
//
// Dans une page :
//   <body data-activite="fiche-3">            identifiant de l'activité (lettres, chiffres, - et _)
//   <div id="socle-connexion"></div>          (facultatif) où placer la ligne « Mon code élève »
//   <textarea data-save="idees"></textarea>   tout champ avec data-save est enregistré
//   <textarea data-save="finale" data-finale></textarea>   la version finale
//   <script>window.SOCLE_CONFIG = { url: "https://xxxx.supabase.co", cle: "clé anon", cours: "maths-pei3" };</script>
//   <script src="socle.js"></script>          à la fin de la page
//
// Sans url ni clé, tout reste dans le navigateur (localStorage), comme avant.
// Pour un QCM ou un exercice calculé par la page :
//   SOCLE.resultat("qcm", score, nombreDeReponses, nombreDeQuestions)
//   SOCLE.ecrireExtra("nom", objet)   et   SOCLE.lireExtra("nom")
// =====================================================================
(function () {
  var CFG = window.SOCLE_CONFIG || {};
  var ACT = document.body.getAttribute('data-activite') || '';
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(ACT)) {
    console.error('socle.js : ajoutez data-activite="..." sur <body> (lettres, chiffres, - et _).');
    return;
  }
  var EN_LIGNE = false;
  if (CFG.url && CFG.cle && CFG.cours) {
    EN_LIGNE = true;
  }
  var COURS = CFG.cours || 'local';

  // Le code élève est commun à tous les cours ; il est oublié à la fermeture du navigateur.
  var CODE = null;
  try { CODE = sessionStorage.getItem('pei5-code'); } catch (x) {}

  function petitHash(t) {
    var h = 0;
    for (var i = 0; i < t.length; i = i + 1) {
      h = (h * 31 + t.charCodeAt(i)) % 1000000007;
    }
    return String(h);
  }
  // Préfixe des données locales : un cours, un élève
  var PREFIXE = 'socle-' + COURS + '-';
  if (CODE) {
    PREFIXE = 'socle-' + COURS + '-u' + petitHash(CODE) + '-';
  }
  var BASE = PREFIXE + ACT + '-';

  function lire(k) {
    try { return localStorage.getItem(BASE + k); } catch (x) { return null; }
  }
  function ecrireLocal(k, v) {
    try { localStorage.setItem(BASE + k, v); } catch (x) {}
  }
  function ecrire(k, v) {
    ecrireLocal(k, v);
    planifier();
  }

  // ---------- champs data-save ----------
  var champs = document.querySelectorAll('[data-save]');
  for (var i = 0; i < champs.length; i = i + 1) {
    preparerChamp(champs[i]);
  }
  function preparerChamp(el) {
    var cle = 'champ-' + el.getAttribute('data-save');
    var v = lire(cle);
    if (el.type === 'checkbox' || el.type === 'radio') {
      if (v === '1') { el.checked = true; }
      el.addEventListener('change', function () {
        // un bouton radio coché décoche les autres du groupe : on les enregistre tous
        var groupe = [el];
        if (el.type === 'radio' && el.name) {
          groupe = document.querySelectorAll('input[type="radio"][name="' + el.name + '"]');
        }
        for (var g = 0; g < groupe.length; g = g + 1) {
          if (groupe[g].hasAttribute('data-save')) {
            var valeur = '0';
            if (groupe[g].checked) { valeur = '1'; }
            ecrireLocal('champ-' + groupe[g].getAttribute('data-save'), valeur);
          }
        }
        planifier();
      });
    } else {
      if (v !== null) { el.value = v; }
      el.addEventListener('input', function () { ecrire(cle, el.value); });
      el.addEventListener('change', function () { ecrire(cle, el.value); });
    }
  }

  // ---------- données calculées par la page (QCM, tri…) ----------
  function listeExtras() {
    var l = lire('extras');
    if (!l) { return []; }
    return l.split(',');
  }
  function lireExtra(nom) {
    var v = lire('extra-' + nom);
    if (v === null) { return null; }
    try { return JSON.parse(v); } catch (x) { return null; }
  }
  function ecrireExtraLocal(nom, objet) {
    ecrireLocal('extra-' + nom, JSON.stringify(objet));
    var l = listeExtras();
    if (l.indexOf(nom) < 0) {
      l.push(nom);
      ecrireLocal('extras', l.join(','));
    }
  }
  function ecrireExtra(nom, objet) {
    if (!/^[a-z0-9_-]{1,30}$/.test(nom)) {
      console.error('socle.js : nom invalide pour ecrireExtra : ' + nom);
      return;
    }
    ecrireExtraLocal(nom, objet);
    planifier();
  }
  function resultat(type, score, repondu, sur, detail) {
    var r = { type: String(type), score: Number(score), repondu: Number(repondu), sur: Number(sur) };
    if (detail !== undefined) { r.detail = detail; }
    ecrire('resultat', JSON.stringify(r));
  }
  function lireResultat() {
    var v = lire('resultat');
    if (!v) { return {}; }
    try { return JSON.parse(v); } catch (x) { return {}; }
  }

  window.SOCLE = {
    activite: ACT,
    cours: COURS,
    enLigne: EN_LIGNE,
    lireExtra: lireExtra,
    ecrireExtra: ecrireExtra,
    resultat: resultat,
    lireResultat: lireResultat
  };

  // ---------- enregistrement en ligne (Supabase) ----------
  var PRET = false;
  var minuterie = null;

  function attente() {
    try { return localStorage.getItem(BASE + 'attente') === '1'; } catch (x) { return false; }
  }
  function planifier() {
    if (!EN_LIGNE || !CODE || !PRET) { return; }
    try { localStorage.setItem(BASE + 'attente', '1'); } catch (x) {}
    if (minuterie) { clearTimeout(minuterie); }
    minuterie = setTimeout(envoyer, 1500);
  }
  // Mode discret : rien n'est affiché quand tout va bien, seulement les problèmes de connexion du code.
  function message(t) {
    var z = document.getElementById('socle-etat');
    if (z) { z.textContent = t; }
  }

  function donneesPage() {
    var d = { champs: {}, etat: {}, resultat: lireResultat(), extra: {} };
    var t = document.querySelectorAll('[data-save]');
    for (var i = 0; i < t.length; i = i + 1) {
      var el = t[i];
      var k = el.getAttribute('data-save');
      if (el.type === 'checkbox' || el.type === 'radio') {
        if (el.checked) { d.champs[k] = '1'; } else { d.champs[k] = '0'; }
      } else {
        d.champs[k] = el.value;
      }
    }
    var noms = listeExtras();
    for (var j = 0; j < noms.length; j = j + 1) {
      d.extra[noms[j]] = lireExtra(noms[j]);
    }
    return d;
  }
  // Clé « anon » (ancienne, commence par eyJ) : envoyée aussi en Authorization ;
  // clé « publishable » (sb_publishable_…) : en apikey seulement.
  function entetes() {
    var h = { 'apikey': CFG.cle, 'Content-Type': 'application/json' };
    if (CFG.cle.indexOf('eyJ') === 0) { h['Authorization'] = 'Bearer ' + CFG.cle; }
    return h;
  }
  function appel(fn, corps) {
    return fetch(CFG.url.replace(/\/$/, '') + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: entetes(),
      body: JSON.stringify(corps)
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) { var e = new Error(t); e.serveur = true; throw e; });
      }
      return r.json();
    });
  }
  function envoyer() {
    if (!PRET || !CODE) { return; }
    var finale = '';
    var f = document.querySelector('[data-finale]');
    if (f) { finale = f.value; }
    var choix = null;
    var c = document.querySelector('[data-choix]');
    if (c && c.value) { choix = c.value; }
    appel('eleve_enregistrer', { p_code: CODE, p_cours: COURS, p_activite: ACT, p_donnees: donneesPage(), p_finale: finale, p_choix: choix })
      .then(function () {
        try { localStorage.removeItem(BASE + 'attente'); } catch (x) {}
      }, function () {
        // hors ligne : on réessaiera au retour du réseau
      });
  }
  function chargerDepuisServeur() {
    return appel('eleve_lire', { p_code: CODE, p_cours: COURS, p_activite: ACT }).then(function (r) {
      if (!r || !r.donnees) { return false; }
      var d = r.donnees;
      var ch = d.champs || {};
      for (var k in ch) {
        if (Object.prototype.hasOwnProperty.call(ch, k)) { ecrireLocal('champ-' + k, ch[k]); }
      }
      if (d.resultat && d.resultat.type) { ecrireLocal('resultat', JSON.stringify(d.resultat)); }
      var ex = d.extra || {};
      for (var n in ex) {
        if (Object.prototype.hasOwnProperty.call(ex, n)) { ecrireExtraLocal(n, ex[n]); }
      }
      return true;
    });
  }

  function barreConnexion() {
    if (!EN_LIGNE) { return; }
    var z = document.getElementById('socle-connexion');
    if (!z) {
      z = document.createElement('div');
      document.body.insertBefore(z, document.body.firstChild);
    }
    z.className = z.className + ' socle-connexion';
    z.style.fontSize = '0.9em';
    z.style.margin = '0.5em 0';
    if (!CODE) {
      z.innerHTML = '<label>Mon code élève : <input id="socle-code" type="text" size="12" autocomplete="off" placeholder="E-XXXXXX"></label> '
        + '<button type="button" id="socle-entrer">Me connecter</button> '
        + '<span id="socle-etat">Avec ton code, tu retrouves ton travail sur n’importe quel ordinateur.</span>';
      var entrer = function () {
        var c = document.getElementById('socle-code').value.trim().toUpperCase();
        if (!c) { return; }
        message('Vérification du code…');
        appel('eleve_connexion', { p_code: c, p_cours: COURS }).then(function (r) {
          if (!r) { message('Code inconnu, ou tu n’es pas inscrit(e) à ce cours.'); return; }
          try {
            sessionStorage.setItem('pei5-code', c);
            sessionStorage.setItem('pei5-classe', r.classe || '');
          } catch (x) {}
          location.reload();
        }, function (err) {
          if (err.serveur) {
            message('Erreur du serveur : préviens ton enseignant(e).');
          } else {
            message('Pas de connexion Internet : réessaie plus tard. Tu peux travailler sans code en attendant.');
          }
        });
      };
      document.getElementById('socle-entrer').addEventListener('click', entrer);
      document.getElementById('socle-code').addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { entrer(); }
      });
      return;
    }
    var classe = '';
    try { classe = sessionStorage.getItem('pei5-classe') || ''; } catch (x) {}
    var texte = 'Mon code : …' + CODE.slice(-2);
    if (classe) { texte = texte + ' · classe ' + classe; }
    z.innerHTML = texte + ' <button type="button" id="socle-sortir">Changer de code</button> <span id="socle-etat"></span>';
    document.getElementById('socle-sortir').addEventListener('click', function () {
      if (attente() && !confirm('Ton travail n’est pas encore à jour sur ton code (pas de connexion Internet). Si tu changes de code maintenant, tes dernières modifications seront perdues sur ce poste. Continuer ?')) {
        return;
      }
      try {
        var asup = [];
        for (var i = 0; i < localStorage.length; i = i + 1) {
          var k = localStorage.key(i);
          if (k && k.indexOf(PREFIXE) === 0) { asup.push(k); }
        }
        for (var j = 0; j < asup.length; j = j + 1) { localStorage.removeItem(asup[j]); }
        sessionStorage.removeItem('pei5-code');
        sessionStorage.removeItem('pei5-classe');
      } catch (x) {}
      location.reload();
    });
  }

  barreConnexion();
  if (EN_LIGNE && CODE) {
    var dejaCharge = false;
    try { dejaCharge = sessionStorage.getItem('socle-charge-' + COURS + '-' + ACT) === '1'; } catch (x) {}
    if (attente() || dejaCharge) {
      PRET = true;
      if (attente()) { envoyer(); }
    } else {
      chargerDepuisServeur().then(function (trouve) {
        try { sessionStorage.setItem('socle-charge-' + COURS + '-' + ACT, '1'); } catch (x) {}
        if (trouve) {
          location.reload();
        } else {
          PRET = true;
        }
      }, function () {
        PRET = true;
      });
    }
    window.addEventListener('online', function () {
      if (attente()) { envoyer(); }
    });
    setInterval(function () {
      if (attente() && PRET) { envoyer(); }
    }, 30000);
  }
})();
