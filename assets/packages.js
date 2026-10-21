(function () {
  'use strict';

  var INDEX_URL = 'packages/index.json';

  var q = document.getElementById('pkg-q');
  var catSel = document.getElementById('pkg-cat');
  var sortSel = document.getElementById('pkg-sort');
  var list = document.getElementById('pkg-list');
  var count = document.getElementById('pkg-count');
  var errBox = document.getElementById('pkg-error');
  var empty = document.getElementById('pkg-empty');
  var reset = document.getElementById('pkg-reset');
  if (!list) return;

  var groups = []; // je Slug: { current, older[] }

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/ß/g, 'ss').replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u')
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function parseVersion(v) {
    return String(v || '').split(/[.\-+]/).map(function (p) { var n = parseInt(p, 10); return isNaN(n) ? 0 : n; });
  }
  function cmpVersion(a, b) {
    var x = parseVersion(a), y = parseVersion(b), n = Math.max(x.length, y.length);
    for (var i = 0; i < n; i++) {
      var d = (x[i] || 0) - (y[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  function mb(bytes) {
    var n = Number(bytes);
    if (!isFinite(n) || n <= 0) return '–';
    return (n / 1048576).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' MB';
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function safeUrl(u) {
    try {
      var p = new URL(u, location.href);
      return p.protocol === 'https:' ? p.href : null;
    } catch (e) { return null; }
  }

  function buildGroups(entries) {
    var bySlug = {};
    entries.forEach(function (e) {
      if (!e || typeof e !== 'object' || !e.slug || e.withdrawn === true) return;
      (bySlug[e.slug] = bySlug[e.slug] || []).push(e);
    });
    return Object.keys(bySlug).map(function (slug) {
      var all = bySlug[slug].sort(function (a, b) { return cmpVersion(b.version, a.version); });
      return { current: all[0], older: all.slice(1) };
    });
  }

  function haystack(e) {
    return norm([e.name, e.category, e.description, e.slug].concat(Array.isArray(e.documents) ? e.documents : []).join(' '));
  }

  function copyHash(btn, hash) {
    function done(ok) {
      btn.textContent = ok ? 'Kopiert' : 'Nicht möglich';
      setTimeout(function () { btn.textContent = 'Kopieren'; }, 1800);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(hash).then(function () { done(true); }, function () { done(false); });
    } else {
      done(false);
    }
  }

  function downloadLink(e, label) {
    var href = safeUrl(e.url);
    if (!href) return el('span', 'muted', 'Kein Download-Link');
    var a = el('a', 'btn', label);
    a.href = href;
    a.rel = 'noopener';
    return a;
  }

  function hashBlock(e) {
    var d = el('details', 'pkg-hash');
    d.appendChild(el('summary', null, 'SHA-256-Prüfsumme'));
    var row = el('div', 'cmd');
    var pre = el('pre');
    pre.appendChild(el('code', null, e.sha256 || '–'));
    row.appendChild(pre);
    if (e.sha256) {
      var b = el('button', null, 'Kopieren');
      b.type = 'button';
      b.setAttribute('aria-label', 'Prüfsumme kopieren');
      b.addEventListener('click', function () { copyHash(b, e.sha256); });
      row.appendChild(b);
    }
    d.appendChild(row);
    return d;
  }

  var DESC_MAX = 90;

  function description(text) {
    var p = el('p', 'pkg-desc');
    if (text.length <= DESC_MAX) {
      p.textContent = text;
      return p;
    }
    var short = text.slice(0, DESC_MAX).replace(/\s+\S*$/, '') + ' …';
    var open = false;
    function paint() {
      p.textContent = open ? text : short;
      p.setAttribute('aria-expanded', String(open));
      p.title = open ? 'Zum Einklappen klicken' : 'Zum Ausklappen klicken';
    }
    p.classList.add('pkg-desc-toggle');
    p.tabIndex = 0;
    p.setAttribute('role', 'button');
    p.addEventListener('click', function () { open = !open; paint(); });
    p.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open = !open; paint(); }
    });
    paint();
    return p;
  }

  // Quelle ist nur eine URL (auch ohne Schema, z. B. gesetze-im-internet.de); nur https wird verlinkt.
  function sourceLine(e) {
    var p = el('p', 'pkg-facts');
    var parts = [];
    if (e.source) {
      var raw = String(e.source).trim();
      var href = safeUrl(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw);
      var label = raw.replace(/^https?:\/\//i, '').replace(/\/$/, '');
      var span = el('span', null, 'Quelle: ');
      if (href) {
        var a = el('a', null, label);
        a.href = href;
        a.rel = 'noopener noreferrer';
        a.target = '_blank';
        span.appendChild(a);
      } else {
        span.appendChild(document.createTextNode(label));
      }
      parts.push(span);
    }
    if (e.license) parts.push(el('span', null, 'Lizenz: ' + e.license));
    parts.forEach(function (s, i) {
      if (i) p.appendChild(document.createTextNode(' · '));
      p.appendChild(s);
    });
    return parts.length ? p : null;
  }

  // Sammelpakete: "enthält N Gesetze" mit aufklappbarer Liste (index.json: documentCount, documents[]).
  function contents(e) {
    var names = Array.isArray(e.documents) ? e.documents.filter(function (n) { return typeof n === 'string' && n; }) : [];
    var n = Number(e.documentCount) || names.length;
    if (n < 2) return null;
    var d = el('details', 'pkg-contents');
    d.appendChild(el('summary', null, 'Enthält ' + n + ' Dokumente'));
    if (names.length) {
      var ul = el('ul', 'pkg-older-list');
      names.forEach(function (name) { ul.appendChild(el('li', null, name)); });
      d.appendChild(ul);
    }
    return d;
  }

  function card(g) {
    var e = g.current;
    var c = el('article', 'card pkg');
    var head = el('div', 'pkg-head');
    head.appendChild(el('h2', 'pkg-name', e.name || e.slug));
    head.appendChild(el('span', 'pkg-badge', e.category || 'Ohne Kategorie'));
    c.appendChild(head);

    c.appendChild(el('p', 'pkg-meta', 'Version ' + (e.version || '–') + ' · ' + mb(e.sizeBytes) + (e.priceText ? ' · ' + e.priceText : '')));
    if (e.description) c.appendChild(description(e.description));
    var inside = contents(e);
    if (inside) c.appendChild(inside);
    var facts = sourceLine(e);
    if (facts) c.appendChild(facts);
    if (e.requiredFeature) c.appendChild(el('div', 'note', 'Benötigt das Lizenz-Feature „' + e.requiredFeature + '“.'));

    var actions = el('p', 'pkg-actions');
    actions.appendChild(downloadLink(e, 'Herunterladen'));
    c.appendChild(actions);
    c.appendChild(hashBlock(e));

    if (g.older.length) {
      var d = el('details', 'pkg-older');
      d.appendChild(el('summary', null, 'Weitere Versionen (' + g.older.length + ')'));
      var ul = el('ul', 'pkg-older-list');
      g.older.forEach(function (o) {
        var li = el('li');
        li.appendChild(el('span', null, 'Version ' + (o.version || '–') + ' · ' + mb(o.sizeBytes) + ' '));
        var href = safeUrl(o.url);
        if (href) {
          var a = el('a', null, 'Herunterladen');
          a.href = href;
          a.rel = 'noopener';
          li.appendChild(a);
        }
        ul.appendChild(li);
      });
      d.appendChild(ul);
      c.appendChild(d);
    }
    return c;
  }

  function render() {
    var term = norm(q.value).trim();
    var cat = catSel.value;
    var sort = sortSel.value;

    var shown = groups.filter(function (g) {
      if (cat && g.current.category !== cat) return false;
      return !term || haystack(g.current).indexOf(term) !== -1;
    });
    shown.sort(function (a, b) {
      if (sort === 'version') return cmpVersion(b.current.version, a.current.version) || norm(a.current.name).localeCompare(norm(b.current.name));
      if (sort === 'size') return (Number(b.current.sizeBytes) || 0) - (Number(a.current.sizeBytes) || 0);
      return norm(a.current.name).localeCompare(norm(b.current.name), 'de');
    });

    list.textContent = '';
    shown.forEach(function (g) { list.appendChild(card(g)); });
    empty.hidden = shown.length > 0;
    count.textContent = shown.length + ' von ' + groups.length + ' Paketen';
  }

  function fillCategories() {
    var cats = {};
    groups.forEach(function (g) { if (g.current.category) cats[g.current.category] = true; });
    Object.keys(cats).sort(function (a, b) { return a.localeCompare(b, 'de'); }).forEach(function (c) {
      var o = el('option', null, c);
      o.value = c;
      catSel.appendChild(o);
    });
  }

  q.addEventListener('input', render);
  catSel.addEventListener('change', render);
  sortSel.addEventListener('change', render);
  reset.addEventListener('click', function () {
    q.value = '';
    catSel.value = '';
    sortSel.value = 'name';
    render();
    q.focus();
  });

  count.textContent = 'Katalog wird geladen …';
  fetch(INDEX_URL, { cache: 'no-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      var entries = Array.isArray(data) ? data : (data && Array.isArray(data.packages) ? data.packages : null);
      if (!entries) throw new Error('Unerwartetes Format');
      groups = buildGroups(entries);
      fillCategories();
      render();
    })
    .catch(function () {
      count.textContent = '';
      errBox.hidden = false;
    });
})();
