(function () {
  'use strict';

  var DATA_URL = 'assets/kosten.json';
  var cfg = null;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function eur(n) {
    return Math.round(n).toLocaleString('de-DE') + ' €';
  }

  function span(lo, hi) {
    return Math.round(lo) === Math.round(hi) ? eur(lo) : eur(lo) + ' bis ' + eur(hi);
  }

  function hardware(n, faktor) {
    var h = cfg.hardware;
    for (var i = 0; i < h.length; i++) if (n <= h[i].bis_nutzer) return h[i].euro * faktor;
    var last = h[h.length - 1];
    return (last.euro / last.bis_nutzer) * n * faktor;
  }

  // Gleiche Formel wie Support/docs/vergleich/kostenmodell.py (rechne); test-vergleich.mjs vergleicht beide.
  function rechne(n, o) {
    o = o || {};
    var nutzung = o.nutzung == null ? 1 : o.nutzung;
    var hw = o.hardware == null ? 1 : o.hardware;
    var lizenz = o.lizenz == null ? cfg.sovereignmind.lizenz_nutzer_monat : o.lizenz;
    var m = o.monate || cfg.zeitraeume[0], sm = cfg.sovereignmind, az = cfg.azure_selbstbau, rate = cfg.stundensatz;
    var basis = hardware(n, hw) + sm.strom_jahr * m / 12 + lizenz * n * m;
    var eg = sm.eigenbetrieb, dl = sm.dienstleister, vl = cfg.verwaltung_lizenz;
    var rows = [];
    var zeitEigen = (eg.einrichtung_stunden + eg.betrieb_stunden_monat * m) * rate;
    var eigen = basis + zeitEigen;
    rows.push({ name: 'SovereignMind, Eigenbetrieb', lo: eigen, hi: eigen, zeit: zeitEigen, sm: true });
    rows.push({
      name: 'SovereignMind, mit Dienstleister',
      lo: basis + dl.einrichtung[0] + dl.wartung_monat[0] * m,
      hi: basis + dl.einrichtung[1] + dl.wartung_monat[1] * m,
      zeit: 0,
      sm: true
    });
    var zeitLizenz = (vl.einrichtung_stunden + vl.betrieb_stunden_monat * m) * rate;
    cfg.anbieter.forEach(function (a) {
      rows.push({ name: a.typ, lo: a.preis_nutzer_monat[0] * n * m + zeitLizenz, hi: a.preis_nutzer_monat[1] * n * m + zeitLizenz, zeit: zeitLizenz, quelle: a.quelle });
    });
    var nu = cfg.nutzung, tok = az.token_usd_je_million;
    var fragenJahr = n * nu.fragen_pro_tag * nu.arbeitstage_jahr * nutzung;
    var token = fragenJahr * (nu.tokens_ein * tok.ein + nu.tokens_aus * tok.aus) / 1e6 * cfg.usd_eur * m / 12;
    var aufwand = (az.einrichtung_stunden + az.betrieb_stunden_monat * m) * rate;
    function azure(i) { return token + (az.suche_monat_usd[i] * cfg.usd_eur + az.hosting_monat_eur[i]) * m + aufwand; }
    rows.push({ name: az.typ, lo: azure(0), hi: azure(1), zeit: aufwand, quelle: az.quelle });
    return rows;
  }

  function renderTable(host, m) {
    var wrap = el('div', 'table-scroll');
    wrap.setAttribute('tabindex', '0');
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', 'Kostenbeispiel, horizontal scrollbar');
    var t = el('table');
    var cap = el('caption', null, (m === 12 ? 'Erstes Jahr (12 Monate) inkl. Einmalkosten' : 'Gesamtkosten über ' + m + ' Monate inkl. Einmalkosten') + ', netto');
    t.appendChild(cap);
    var head = el('tr');
    head.appendChild(el('th', null, 'Variante'));
    cfg.szenarien.forEach(function (n) {
      var th = el('th', null, n + ' Nutzer');
      th.setAttribute('scope', 'col');
      head.appendChild(th);
    });
    var thead = el('thead'); thead.appendChild(head); t.appendChild(thead);
    var byScenario = cfg.szenarien.map(function (n) { return rechne(n, { monate: m }); });
    var tbody = el('tbody');
    byScenario[0].forEach(function (row, i) {
      var tr = el('tr', row.sm ? 'sm' : null);
      var th = el('th', null, row.name + (row.quelle ? ' (' + row.quelle + ')' : ''));
      th.setAttribute('scope', 'row');
      tr.appendChild(th);
      byScenario.forEach(function (rows) {
        var td = el('td', null, span(rows[i].lo, rows[i].hi));
        if (rows[i].zeit > 0) td.appendChild(el('small', 'zeit', 'davon Arbeitszeit ' + eur(rows[i].zeit)));
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    t.appendChild(tbody);
    wrap.appendChild(t);
    var h = el('h3', 'sub', m === 12 ? 'Erstes Jahr' : m + ' Monate');
    host.appendChild(h);
    host.appendChild(wrap);
  }

  function renderCalc() {
    var form = document.getElementById('calc-form');
    var out = document.getElementById('calc-out');
    if (!form || !out) return;
    var fN = document.getElementById('calc-n'), fQ = document.getElementById('calc-q'), fL = document.getElementById('calc-l');
    function num(input, min, max, dflt) {
      var v = parseFloat(String(input.value).replace(',', '.'));
      if (!isFinite(v)) return dflt;
      return Math.min(max, Math.max(min, v));
    }
    function update() {
      var n = Math.round(num(fN, 1, 5000, 10));
      var q = num(fQ, 0, 500, cfg.nutzung.fragen_pro_tag);
      var l = num(fL, 0, 500, 0);
      out.textContent = '';
      cfg.zeitraeume.forEach(function (m) {
        var rows = rechne(n, { nutzung: q / cfg.nutzung.fragen_pro_tag, lizenz: l, monate: m });
        out.appendChild(el('h4', null, m === 12 ? 'Erstes Jahr' : m + ' Monate'));
        var ul = el('ul', 'calc-list');
        rows.forEach(function (r) {
          var li = el('li');
          li.appendChild(el('span', null, r.name));
          var strong = el('strong', null, span(r.lo, r.hi));
          li.appendChild(strong);
          if (r.zeit > 0) li.appendChild(el('small', 'zeit', 'davon Arbeitszeit ' + eur(r.zeit)));
          ul.appendChild(li);
        });
        out.appendChild(ul);
      });
    }
    form.addEventListener('input', update);
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    update();
  }

  function fill(sel, text) {
    var n = document.querySelectorAll(sel);
    for (var i = 0; i < n.length; i++) n[i].textContent = text;
  }

  function renderSources() {
    var host = document.getElementById('quellen-liste');
    if (!host) return;
    cfg.quellen.forEach(function (q) {
      var li = el('li');
      li.appendChild(el('strong', null, q.id + ': '));
      li.appendChild(document.createTextNode(q.text + ' '));
      li.appendChild(el('em', null, q.belegt === 'ja' ? '(Anbieterseite gelesen)' : '(nur Drittquellen, vor Veröffentlichung prüfen)'));
      host.appendChild(li);
    });
  }

  function init() {
    var host = document.getElementById('kosten-tabelle');
    if (!host) return;
    fetch(DATA_URL, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      cfg = data;
      var d = new Date(cfg.stand + 'T00:00:00');
      fill('[data-stand]', isNaN(d) ? cfg.stand : d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }));
      cfg.zeitraeume.forEach(function (m) { renderTable(host, m); });
      renderCalc();
      renderSources();
    }).catch(function () {
      host.appendChild(el('div', 'note warn', 'Die Kostendaten konnten nicht geladen werden. Bitte Seite neu laden.'));
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { setConfig: function (c) { cfg = c; }, rechne: rechne };
  } else {
    init();
  }
})();
