(function () {
  'use strict';

  // Zentrale Konfiguration: Befehle hier, Version/Release in assets/downloads.json (von Hand pflegen).
  // Die Skripte liegen im Wurzelordner der Seite (install.sh, install.ps1; Kopie aus dem Hauptprojekt, sync-website-install.sh).
  var DOWNLOADS_JSON = 'assets/downloads.json';
  var SITE = 'https://sovereignmind-deutschland.github.io/sovereignmind-website/';
  var PS1 = SITE + 'install.ps1';
  var SH = SITE + 'install.sh';
  var COMMANDS = {
    windows: 'irm ' + PS1 + ' | iex',
    linux: 'curl -fsSL ' + SH + ' | sh'
  };

  // Weitere Befehle ohne eigenen Reiter; sie zählen nicht für die Reiterauswahl (COMMANDS).
  var EXTRA_COMMANDS = {
    'windows-lesen': 'irm ' + PS1,
    'windows-manuell': [
      'Get-FileHash .\\SovereignMind-Setup-Minimal-<Version>.zip.001 -Algorithm SHA256',
      'powershell -ExecutionPolicy Bypass -File .\\install.ps1 -SourceDir .'
    ].join('\n'),
    'windows-eigenes-frontend': [
      '$env:SM_SETUP_ARGS = "/FRONTEND=off /CORS=https://app.example"',
      'irm ' + PS1 + ' | iex'
    ].join('\n'),
    'linux-lesen': 'curl -fsSL ' + SH,
    'linux-eigenes-frontend': 'curl -fsSL ' + SH + ' | SM_BUNDLE_ARGS="--no-frontend --cors https://app.example" sh',
    'linux-manuell-minimal': [
      'cat sovereignmind-installer-minimal_<Version>_amd64.run.part* > sovereignmind-installer-minimal_<Version>_amd64.run',
      'sha256sum -c --ignore-missing SHA256SUMS.txt',
      'sudo bash sovereignmind-installer-minimal_<Version>_amd64.run'
    ].join('\n'),
    'linux-manuell-voll': [
      'cat sovereignmind-installer-full_<Version>_amd64.run.part* > sovereignmind-installer-full_<Version>_amd64.run',
      'sudo bash sovereignmind-installer-full_<Version>_amd64.run'
    ].join('\n')
  };

  // Befehle rendern (<Version> wird ersetzt, sobald downloads.json eine Version nennt)
  function renderCommands(version) {
    [COMMANDS, EXTRA_COMMANDS].forEach(function (commands) {
      Object.keys(commands).forEach(function (key) {
        var code = document.querySelector('[data-cmd="' + key + '"]');
        if (code) code.textContent = version ? commands[key].split('<Version>').join(version) : commands[key];
      });
    });
  }
  renderCommands('');

  // Version und Release-Seite aus downloads.json. Die Einzeiler brauchen die Datei nicht. Fehlt ein Link,
  // bleibt er ausgeblendet (kein toter Link).
  //   data-release-url  Link auf die Release-Seite auf GitHub (releaseUrl)
  function isHttpUrl(u) { return typeof u === 'string' && /^https:\/\//i.test(u); }
  function setLinks(selector, url) {
    document.querySelectorAll(selector).forEach(function (a) {
      if (isHttpUrl(url)) {
        a.href = url;
        a.target = '_blank';
        a.hidden = false;
      }
    });
  }
  // SHA-256 je Datei aus downloads.json (nur als Text eingesetzt). Ohne Einträge bleibt der Verweis auf SHA256SUMS.txt.
  function renderChecksums(sums) {
    var body = document.querySelector('[data-sha256-rows]');
    var box = document.querySelector('[data-sha256-box]');
    if (!body || !box || !sums || typeof sums !== 'object') return;
    var names = Object.keys(sums).filter(function (n) { return /^[0-9a-f]{64}$/i.test(String(sums[n])); }).sort();
    if (!names.length) return;
    names.forEach(function (name) {
      var row = document.createElement('tr');
      var file = document.createElement('td');
      var sum = document.createElement('td');
      var code = document.createElement('code');
      file.textContent = name;
      code.textContent = String(sums[name]).toLowerCase();
      sum.appendChild(code);
      row.appendChild(file);
      row.appendChild(sum);
      body.appendChild(row);
    });
    box.hidden = false;
    document.querySelectorAll('[data-sha256-missing]').forEach(function (el) { el.hidden = true; });
  }
  var hasDownloadUi = document.querySelector('[data-release-url], [data-version]');
  if (hasDownloadUi && window.fetch) {
    fetch(DOWNLOADS_JSON, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (d) {
        d = d || {};
        var version = typeof d.version === 'string' ? d.version.trim() : '';
        if (version) {
          renderCommands(version);
          document.querySelectorAll('[data-version]').forEach(function (el) {
            el.textContent = 'Aktuelle Version: ' + version;
            el.hidden = false;
          });
        }
        renderChecksums(d.sha256);
        setLinks('[data-release-url]', d.releaseUrl);
      })
      .catch(function () { /* ohne downloads.json bleiben die Einzeiler nutzbar */ });
  }

  // Tabs
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  function select(os, focus) {
    tabs.forEach(function (t) {
      var on = t.dataset.os === os;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      var panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
      if (on && focus) t.focus();
    });
  }
  if (tabs.length) {
    var fromHash = location.hash.replace('#', '');
    var detected = /Win/i.test(navigator.userAgent) ? 'windows' : 'linux';
    select(fromHash in COMMANDS ? fromHash : detected, false);
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () {
        select(t.dataset.os, false);
        history.replaceState(null, '', '#' + t.dataset.os);
      });
      t.addEventListener('keydown', function (e) {
        var n = null;
        if (e.key === 'ArrowRight') n = tabs[(i + 1) % tabs.length];
        if (e.key === 'ArrowLeft') n = tabs[(i - 1 + tabs.length) % tabs.length];
        if (n) { e.preventDefault(); select(n.dataset.os, true); }
      });
    });
    window.addEventListener('hashchange', function () {
      var h = location.hash.replace('#', '');
      if (h in COMMANDS) select(h, false);
    });
  }

  // Kopieren-Button mit Fallback auf Textauswahl
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var code = document.querySelector('[data-cmd="' + btn.dataset.copy + '"]');
      if (!code) return;
      function done(ok) {
        var old = btn.textContent;
        btn.textContent = ok ? 'Kopiert' : 'Markiert – Strg+C';
        setTimeout(function () { btn.textContent = old; }, 1800);
      }
      function fallback() {
        var r = document.createRange();
        r.selectNodeContents(code);
        var s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        done(false);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code.textContent).then(function () { done(true); }, fallback);
      } else {
        fallback();
      }
    });
  });

  // Screenshot-Galerie mit Lightbox (ohne JS bleibt die statische Auswahl mit Links auf die Originale)
  var gallery = document.querySelector('[data-gallery]');
  if (gallery) {
    var BASE = 'assets/screenshots/';
    var SHOTS = [
      ['chat', 'Chat mit Quellenbelegen'],
      ['chat-assistenten', 'Assistenten im Chat wählen'],
      ['einstellungen', 'Einstellungen'],
      ['login', 'Anmeldung'],
      ['chat-mobil', 'Chat auf dem Smartphone'],
      ['admin-nutzung', 'Admin: Nutzung'],
      ['admin-profil', 'Admin: Profil'],
      ['admin-nutzer', 'Admin: Nutzer'],
      ['admin-dokumente', 'Admin: Dokumente'],
      ['admin-unternehmen', 'Admin: Unternehmen'],
      ['admin-ki-einstellungen', 'Admin: KI-Einstellungen'],
      ['admin-connectors', 'Admin: Schnittstellen'],
      ['admin-connector-vorlagen', 'Admin: Schnittstellen-Vorlagen'],
      ['admin-dashboard', 'Admin: Dashboard'],
      ['admin-support', 'Admin: Support']
    ];
    var BRANDED = ['chat', 'einstellungen', 'admin-nutzung', 'admin-profil'];
    var state = {
      variant: 'standard',
      theme: document.documentElement.getAttribute('data-theme') ||
        (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    };
    var controls = document.querySelector('[data-gallery-controls]');
    var box = document.querySelector('[data-lightbox]');
    var lbImg = document.querySelector('[data-lb-img]');
    var lbCap = document.querySelector('[data-lb-cap]');
    var current = [];
    var index = 0;

    var src = function (id) { return BASE + state.variant + '/' + state.theme + '/' + id + '.webp'; };

    function syncControls() {
      if (!controls) return;
      controls.querySelectorAll('button').forEach(function (x) {
        var on = x.dataset.variant === state.variant || x.dataset.theme === state.theme;
        x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }

    function show() {
      var s = current[index];
      lbImg.src = src(s[0]);
      lbImg.alt = s[1];
      lbCap.textContent = s[1] + ' (' + (index + 1) + ' / ' + current.length + ')';
    }
    function openBox(i) {
      index = i;
      show();
      if (box.showModal) { if (!box.open) box.showModal(); } else { box.setAttribute('open', ''); }
    }
    function closeBox() {
      if (box.close) box.close(); else box.removeAttribute('open');
    }
    function step(d) { index = (index + d + current.length) % current.length; show(); }

    function render() {
      current = SHOTS.filter(function (s) { return state.variant === 'standard' || BRANDED.indexOf(s[0]) !== -1; });
      if (gallery.dataset.limit) current = current.filter(function (s) { return ['chat', 'admin-nutzung', 'admin-dashboard'].indexOf(s[0]) !== -1; });
      gallery.textContent = '';
      current.forEach(function (s, i) {
        var fig = document.createElement('figure');
        fig.className = 'shot' + (s[0] === 'chat-mobil' ? ' portrait' : '');
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', s[1] + ' vergrößern');
        var img = document.createElement('img');
        img.src = src(s[0]);
        img.alt = s[1];
        img.loading = 'lazy';
        b.appendChild(img);
        b.addEventListener('click', function () { openBox(i); });
        var cap = document.createElement('figcaption');
        cap.textContent = s[1];
        fig.appendChild(b);
        fig.appendChild(cap);
        gallery.appendChild(fig);
      });
    }

    if (controls) {
      controls.hidden = false;
      controls.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.variant) state.variant = b.dataset.variant;
        if (b.dataset.theme) state.theme = b.dataset.theme;
        syncControls();
        render();
      });
    }
    box.addEventListener('click', function (e) {
      var a = e.target.dataset && e.target.dataset.lb;
      if (a === 'prev') step(-1);
      else if (a === 'next') step(1);
      else if (a === 'close' || e.target === box) closeBox();
    });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    });
    syncControls();
    render();
  }
  // Animationen: Einblenden beim Scrollen und Pipeline "So funktioniert es". Ohne JS, ohne IntersectionObserver
  // oder bei "Bewegung reduzieren" wird nichts versteckt (Startzustand setzt nur dieses Skript).
  var calmMotion = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (calmMotion && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { threshold: 0.15 });
    document.querySelectorAll('section.calm .wrap > h2, section.calm .wrap > .lead, section.calm .wrap > .more, .reasons li, .features li, .video, .dev').forEach(function (el, i) {
      var sibling = Array.prototype.indexOf.call(el.parentNode.children, el);
      el.style.transitionDelay = Math.min(sibling, 5) * 80 + 'ms';
      el.classList.add('reveal');
      io.observe(el);
    });
    var flow = document.querySelector('[data-flow]');
    if (flow) {
      Array.prototype.forEach.call(flow.children, function (li, i) { li.style.setProperty('--i', i); });
      flow.classList.add('js-flow');
      var fo = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) { flow.classList.add('run'); fo.disconnect(); }
      }, { threshold: 0.4 });
      fo.observe(flow);
    }
  }
})();
