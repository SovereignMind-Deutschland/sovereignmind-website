(function () {
  'use strict';

  var DEFAULT_SPEC_URL = 'assets/api/openapi.json';
  var DEFAULT_DOWNLOADS_URL = 'assets/downloads.json';
  var METHODS = ['get', 'post', 'put', 'patch', 'delete'];
  var spec = null;
  var items = [];      // { id, method, path, op, tag, el, navEl, hay }
  var groups = [];     // { name, description, items, navDetails, section }
  var byId = {};
  var activeMethods = {};
  var listeners = [];  // { target, type, fn } auf document/window, beim Abbau entfernt

  function listen(target, type, fn) {
    target.addEventListener(type, fn);
    listeners.push({ target: target, type: type, fn: fn });
  }

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ---------- $ref-Aufloesung (fuer Phase 3 bereitgestellt) ---------- */

  function resolveRef(ref) {
    if (typeof ref !== 'string' || ref.indexOf('#/') !== 0) return null;
    var node = spec;
    var parts = ref.slice(2).split('/');
    for (var i = 0; i < parts.length; i++) {
      if (node == null) return null;
      node = node[parts[i].replace(/~1/g, '/').replace(/~0/g, '~')];
    }
    return node == null ? null : node;
  }

  // Loest ein Objekt mit "$ref" auf; Tiefengrenze und Zyklenschutz ueber "seen".
  function deref(obj, seen, depth) {
    seen = seen || [];
    depth = depth || 0;
    while (obj && obj.$ref) {
      if (depth > 12 || seen.indexOf(obj.$ref) >= 0) return { circular: obj.$ref };
      seen = seen.concat(obj.$ref);
      obj = resolveRef(obj.$ref);
      depth++;
    }
    return obj;
  }
  window.SMApiDoku = { deref: deref, resolveRef: resolveRef };

  /* ---------- Markdown-Teilsatz (ohne HTML-Durchlass) ---------- */

  function inline(parent, text) {
    var re = /(`[^`]+`)|(\*\*[^*]+\*\*)|\[([^\]]+)\]\(([^)\s]+)\)/g;
    var last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[1]) {
        parent.appendChild(el('code', null, m[1].slice(1, -1)));
      } else if (m[2]) {
        parent.appendChild(el('strong', null, m[2].slice(2, -2)));
      } else if (/^https?:\/\//i.test(m[4])) {
        var a = el('a', null, m[3]);
        a.href = m[4];
        a.rel = 'noopener noreferrer';
        parent.appendChild(a);
      } else {
        parent.appendChild(document.createTextNode(m[3]));
      }
      last = re.lastIndex;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  function markdown(text) {
    var box = el('div', 'md');
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var para = [], list = null, i = 0;
    function flushPara() {
      if (para.length) { var p = el('p'); inline(p, para.join(' ')); box.appendChild(p); para = []; }
    }
    function flushList() { if (list) { box.appendChild(list); list = null; } }
    while (i < lines.length) {
      var line = lines[i];
      if (/^```/.test(line)) {
        flushPara(); flushList();
        var code = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
        i++;
        var pre = el('pre'), c = el('code', null, code.join('\n'));
        pre.tabIndex = 0;
        pre.appendChild(c);
        box.appendChild(pre);
        continue;
      }
      var h = /^(#{1,6})\s+(.*)$/.exec(line);
      var li = /^\s*[-*]\s+(.*)$/.exec(line);
      if (h) {
        flushPara(); flushList();
        var hh = el('h' + Math.min(6, h[1].length + 3));
        inline(hh, h[2]);
        box.appendChild(hh);
      } else if (li) {
        flushPara();
        if (!list) list = el('ul');
        var item = el('li');
        var txt = li[1];
        // Fortsetzungszeilen (eingerueckt) gehoeren zum Listenpunkt
        while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*[-*]\s+/.test(lines[i + 1])) txt += ' ' + lines[++i].trim();
        inline(item, txt);
        list.appendChild(item);
      } else if (!line.trim()) {
        flushPara(); flushList();
      } else {
        flushList();
        para.push(line.trim());
      }
      i++;
    }
    flushPara(); flushList();
    return box;
  }


  /* ---------- Schema-Hilfen ---------- */

  function refName(ref) { return String(ref).replace(/^#\/components\/schemas\//, ''); }

  function typeText(sc) {
    if (!sc) return 'unbekannt';
    if (sc.$ref) return refName(sc.$ref);
    if (sc.enum) return (sc.type || 'string') + ' (Aufzählung)';
    if (sc.type === 'array') return 'Liste von ' + typeText(sc.items);
    var alt = sc.oneOf || sc.anyOf || sc.allOf;
    if (alt) return (sc.oneOf ? 'eines von' : sc.anyOf ? 'beliebig aus' : 'kombiniert aus') + ' ' + alt.map(typeText).join(' | ');
    var t = sc.type || (sc.properties ? 'object' : 'any');
    return sc.format ? t + ' (' + sc.format + ')' : t;
  }

  // Typ als Text oder, bei $ref, als Link auf den Datentyp-Abschnitt.
  function typeNode(sc, noLink) {
    if (noLink) return el('span', 'api-typelink', typeText(sc));
    if (sc && sc.$ref) {
      var a = el('a', 'api-typelink', refName(sc.$ref));
      a.href = '#typ-' + refName(sc.$ref);
      return a;
    }
    if (sc && sc.type === 'array' && sc.items && sc.items.$ref) {
      var s = el('span');
      s.appendChild(document.createTextNode('Liste von '));
      s.appendChild(typeNode(sc.items));
      return s;
    }
    return el('span', null, typeText(sc));
  }

  // Zerlegt in Eigenschaften (inkl. allOf) und liefert die Kinder fuer die Baumansicht.
  function childrenOf(sc, seen) {
    var node = deref(sc, seen);
    if (!node || node.circular) return null;
    var props = {}, req = (node.required || []).slice(), has = false;
    (node.allOf || []).forEach(function (part) {
      var d = deref(part, seen);
      if (d && d.properties) { has = true; Object.keys(d.properties).forEach(function (k) { props[k] = d.properties[k]; }); req = req.concat(d.required || []); }
    });
    if (node.properties) { has = true; Object.keys(node.properties).forEach(function (k) { props[k] = node.properties[k]; }); }
    if (has) return { props: props, req: req };
    if (node.type === 'array' && node.items) {
      var inner = deref(node.items, seen);
      if (inner && inner.properties) return { props: inner.properties, req: inner.required || [], list: true };
    }
    return null;
  }

  function schemaTree(sc, seen, depth) {
    seen = seen || [];
    depth = depth || 0;
    var box = el('div', 'api-tree');
    var node = deref(sc, seen);
    if (!node) { box.appendChild(el('p', 'muted', 'Schema nicht gefunden.')); return box; }
    if (node.circular) { box.appendChild(el('p', 'muted', 'Verweist rekursiv auf ' + refName(node.circular) + '.')); return box; }
    var nextSeen = sc && sc.$ref ? seen.concat(sc.$ref) : seen;
    var variants = node.oneOf || node.anyOf;
    if (variants) {
      box.appendChild(el('p', 'muted', node.oneOf ? 'Genau eine der Varianten:' : 'Mindestens eine der Varianten:'));
      variants.forEach(function (v, i) {
        var d = el('details', 'api-prop');
        var sm = el('summary');
        sm.appendChild(el('span', 'api-pn', 'Variante ' + (i + 1)));
        sm.appendChild(typeNode(v, true));
        d.appendChild(sm);
        lazy(d, function () { return schemaTree(v, nextSeen, depth + 1); });
        box.appendChild(d);
      });
      return box;
    }
    if (node.enum) {
      box.appendChild(el('p', null, 'Erlaubte Werte: ' + node.enum.join(', ')));
      return box;
    }
    var ch = childrenOf(sc, seen);
    if (!ch) {
      var line = el('p');
      line.appendChild(typeNode(node));
      if (node.nullable) line.appendChild(el('span', 'api-flag', 'nullable'));
      if (node.description) line.appendChild(document.createTextNode(' – ' + node.description));
      box.appendChild(line);
      return box;
    }
    if (ch.list) box.appendChild(el('p', 'muted', 'Liste; jedes Element hat:'));
    var names = Object.keys(ch.props);
    if (!names.length) box.appendChild(el('p', 'muted', 'Keine festen Felder.'));
    names.forEach(function (name) {
      var ps = ch.props[name];
      var pd = deref(ps, nextSeen) || {};
      var sub = pd.circular ? null : childrenOf(ps, nextSeen);
      var arrSub = !sub && pd.type === 'array' && pd.items ? childrenOf(pd.items, nextSeen) : null;
      var expandable = !!(sub || arrSub) || !!(pd.oneOf || pd.anyOf);
      var row = el(expandable ? 'details' : 'div', 'api-prop');
      var head = el(expandable ? 'summary' : 'div', 'api-prophead');
      head.appendChild(el('code', 'api-pn', name));
      head.appendChild(typeNode(ps, expandable));
      if (ch.req.indexOf(name) >= 0) head.appendChild(el('span', 'api-flag api-req', 'Pflicht'));
      if (pd.nullable || (ps && ps.nullable)) head.appendChild(el('span', 'api-flag', 'nullable'));
      if (pd.enum) head.appendChild(el('span', 'api-enum', 'Werte: ' + pd.enum.join(', ')));
      if (pd.default !== undefined) head.appendChild(el('span', 'api-enum', 'Standard: ' + JSON.stringify(pd.default)));
      if (pd.description || (ps && ps.description)) head.appendChild(el('span', 'muted', pd.description || ps.description));
      row.appendChild(head);
      if (expandable) lazy(row, function () { return schemaTree(arrSub ? pd.items : ps, nextSeen, depth + 1); });
      box.appendChild(row);
    });
    return box;
  }

  // Inhalt erst beim ersten Aufklappen erzeugen (Leistung).
  function lazy(details, make) {
    var done = false;
    function fill() {
      if (done || !details.open) return;
      done = true;
      details.appendChild(make());
    }
    details.addEventListener('toggle', fill);
    fill();
  }

  /* ---------- Beispiele ---------- */

  var SAMPLE_STR = { email: 'nutzer@kanzlei.example', uuid: '00000000-0000-0000-0000-000000000000', 'date-time': '2026-01-01T12:00:00Z', date: '2026-01-01', uri: 'https://kanzlei.example', binary: '(Dateiinhalt)', byte: 'U29tZSBkYXRh' };

  function sample(sc, seen, depth, name) {
    seen = seen || [];
    depth = depth || 0;
    if (!sc) return null;
    if (sc.example !== undefined) return sc.example;
    var node = deref(sc, seen);
    if (!node || node.circular || depth > 6) return null;
    if (node.example !== undefined) return node.example;
    if (node.default !== undefined && !node.properties) return node.default;
    var nextSeen = sc.$ref ? seen.concat(sc.$ref) : seen;
    if (node.enum) return node.enum[0];
    var alt = node.oneOf || node.anyOf;
    if (alt) return sample(alt[0], nextSeen, depth + 1, name);
    var ch = childrenOf(sc, seen);
    if (ch && !ch.list) {
      var o = {};
      Object.keys(ch.props).forEach(function (k) { o[k] = sample(ch.props[k], nextSeen, depth + 1, k); });
      return o;
    }
    switch (node.type) {
      case 'array': return [sample(node.items, nextSeen, depth + 1, name)];
      case 'integer': case 'number': return 0;
      case 'boolean': return false;
      case 'object': return {};
      case 'string':
        if (node.format && SAMPLE_STR[node.format]) return SAMPLE_STR[node.format];
        if (name && /mail/i.test(name)) return SAMPLE_STR.email;
        return 'string';
      default: return null;
    }
  }

  function pickJson(content) {
    var types = Object.keys(content || {});
    if (!types.length) return null;
    var t = types.indexOf('application/json') >= 0 ? 'application/json' : types[0];
    return { type: t, others: types.filter(function (x) { return x !== t; }), media: content[t] };
  }

  function exampleOf(media) {
    if (media.example !== undefined) return media.example;
    if (media.examples) { var k = Object.keys(media.examples)[0]; if (k) return media.examples[k].value; }
    return sample(media.schema);
  }

  function copyButton(getText) {
    var b = el('button', 'btn secondary api-copy', 'Kopieren');
    b.type = 'button';
    b.addEventListener('click', function () {
      var text = getText();
      function done(ok) {
        b.textContent = ok ? 'Kopiert' : 'Kopieren nicht möglich';
        setTimeout(function () { b.textContent = 'Kopieren'; }, 2000);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallbackCopy(text)); });
      } else {
        done(fallbackCopy(text));
      }
    });
    return b;
  }

  function fallbackCopy(text) {
    var ta = el('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function exampleBlock(label, value, isText) {
    var wrap = el('div', 'api-example');
    var bar = el('div', 'api-example-bar');
    bar.appendChild(el('strong', null, label));
    var text = isText ? String(value) : JSON.stringify(value, null, 2);
    bar.appendChild(copyButton(function () { return text; }));
    wrap.appendChild(bar);
    var pre = el('pre');
    pre.tabIndex = 0;
    pre.appendChild(el('code', null, text));
    wrap.appendChild(pre);
    return wrap;
  }


  /* ---------- Codebeispiele (curl, C#, Python, JavaScript) ---------- */

  var LANGS = [['curl', 'curl'], ['csharp', 'C#'], ['python', 'Python'], ['js', 'JavaScript']];
  var DEFAULT_BASE = 'http://localhost:5043';
  var exampleViews = [];   // { update() }
  var state = { lang: 'curl', base: DEFAULT_BASE };

  function store(key, val) { try { localStorage.setItem(key, val); } catch (e) { /* ohne Speicher weiter */ } }
  function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

  function baseUrl() { return (state.base || DEFAULT_BASE).replace(/\/+$/, ''); }

  // Beschreibt einen Aufruf: Methode, Pfad mit Platzhaltern, Query, Header, Body.
  function callOf(it) {
    var op = it.op;
    var params = (op.parameters || []).map(function (p) { return deref(p) || p; });
    var path = it.path.replace(/\{([^}]+)\}/g, function (m, n) { return '<' + n + '>'; });
    var query = params.filter(function (p) { return p.in === 'query' && p.required; })
      .map(function (p) { var v = sample(p.schema, null, 0, p.name); return [p.name, v == null ? '' : String(v)]; });
    var call = { method: it.method.toUpperCase(), path: path, query: query, auth: !it.open, json: null, form: false, accept: null };
    var rb = op.requestBody && deref(op.requestBody);
    if (rb && rb.content) {
      var pj = pickJson(rb.content);
      if (pj && pj.type === 'multipart/form-data') call.form = true;
      else if (pj && pj.type === 'application/json') { var ex = exampleOf(pj.media); if (ex != null) call.json = ex; }
    }
    var ok = Object.keys(op.responses || {}).filter(function (c) { return c.charAt(0) === '2'; })[0];
    var r = ok && deref(op.responses[ok]);
    if (r && r.content && r.content['text/event-stream']) call.stream = true;
    return call;
  }

  function q(s) { return JSON.stringify(s); }

  function genCode(lang, c) {
    var base = baseUrl();
    var qs = c.query.length ? '?' + c.query.map(function (p) { return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]); }).join('&') : '';
    var url = base + c.path + qs;
    var body = c.json != null ? JSON.stringify(c.json) : null;
    var pretty = c.json != null ? JSON.stringify(c.json, null, 2) : null;
    var L = [];
    if (lang === 'curl') {
      L.push('curl' + (c.stream ? ' -N' : '') + ' -s -X ' + c.method + " '" + url + "'" + (c.auth || body || c.form ? ' \\' : ''));
      var parts = [];
      if (c.auth) parts.push("-H 'Authorization: Bearer <Token>'");
      if (body) { parts.push("-H 'Content-Type: application/json'"); parts.push("-d '" + body.replace(/'/g, "'\\''") + "'"); }
      if (c.form) parts.push("-F 'file=@Dokument.pdf'");
      parts.forEach(function (p, i) { L.push('  ' + p + (i < parts.length - 1 ? ' \\' : '')); });
    } else if (lang === 'csharp') {
      L.push('using var http = new HttpClient();');
      if (c.auth) L.push('http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "<Token>");');
      var verb = { GET: 'Get', POST: 'Post', PUT: 'Put', PATCH: 'Patch', DELETE: 'Delete' }[c.method];
      if (c.form) {
        L.push('using var form = new MultipartFormDataContent();');
        L.push('form.Add(new ByteArrayContent(File.ReadAllBytes("Dokument.pdf")), "file", "Dokument.pdf");');
      } else if (body) {
        L.push('var json = new StringContent(' + q(body) + ', Encoding.UTF8, "application/json");');
      }
      var arg = c.form ? ', form' : body ? ', json' : '';
      if (verb === 'Patch') L.push('var response = await http.PatchAsync(' + q(url) + (arg || ', null') + ');');
      else if (verb === 'Get' && c.stream) L.push('var response = await http.GetAsync(' + q(url) + ', HttpCompletionOption.ResponseHeadersRead);');
      else if (verb === 'Delete' || verb === 'Get') L.push('var response = await http.' + verb + 'Async(' + q(url) + ');');
      else L.push('var response = await http.' + verb + 'Async(' + q(url) + (arg || ', null') + ');');
      L.push('response.EnsureSuccessStatusCode();');
      L.push(c.stream ? 'using var reader = new StreamReader(await response.Content.ReadAsStreamAsync());\nwhile (await reader.ReadLineAsync() is { } line)\n    Console.WriteLine(line);' : 'Console.WriteLine(await response.Content.ReadAsStringAsync());');
    } else if (lang === 'python') {
      L.push('import requests');
      L.push('');
      if (c.auth) L.push('headers = {"Authorization": "Bearer <Token>"}');
      var args = [q(url)];
      if (c.auth) args.push('headers=headers');
      if (c.json != null) args.push('json=' + toPy(c.json));
      if (c.form) { L.push('with open("Dokument.pdf", "rb") as f:'); }
      if (c.form) args.push('files={"file": f}');
      if (c.stream) args.push('stream=True');
      var ind = c.form ? '    ' : '';
      L.push(ind + 'r = requests.' + c.method.toLowerCase() + '(' + args.join(', ') + ')');
      L.push(ind + 'r.raise_for_status()');
      L.push(ind + (c.stream ? 'for line in r.iter_lines(decode_unicode=True):\n' + ind + '    print(line)' : 'print(r.text)'));
    } else {
      if (c.form) L.push('const form = new FormData();\nform.append("file", fileInput.files[0]);');
      var opts = ['method: ' + q(c.method)];
      var hd = [];
      if (c.auth) hd.push('Authorization: "Bearer <Token>"');
      if (body) hd.push('"Content-Type": "application/json"');
      if (hd.length) opts.push('headers: { ' + hd.join(', ') + ' }');
      if (body) opts.push('body: JSON.stringify(' + pretty.replace(/\n/g, '\n  ') + ')');
      if (c.form) opts.push('body: form');
      L.push('const response = await fetch(' + q(url) + ', {\n  ' + opts.join(',\n  ') + '\n});');
      L.push('if (!response.ok) throw new Error(`HTTP ${response.status}`);');
      L.push(c.stream ? 'const reader = response.body.getReader();\nconst decoder = new TextDecoder();\nfor (;;) {\n  const { done, value } = await reader.read();\n  if (done) break;\n  console.log(decoder.decode(value));\n}' : 'console.log(await response.text());');
    }
    return L.join('\n');
  }

  function toPy(v) {
    return JSON.stringify(v, null, 4).replace(/: true/g, ': True').replace(/: false/g, ': False').replace(/: null/g, ': None');
  }

  // Einfaerbung ohne Bibliothek: Zeichenketten, Kommentare, Schluesselwoerter; Farben nur ueber Variablen.
  var KEYWORDS = /^(await|async|const|var|new|using|import|from|for|while|with|if|in|is|as|break|throw|return|true|false|null|True|False|None|curl)$/;
  function highlight(code) {
    var frag = document.createDocumentFragment();
    var re = /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\/\/[^\n]*|#[^\n]*)|([A-Za-z_][A-Za-z0-9_]*)|(\s+|.)/g;
    var m;
    while ((m = re.exec(code))) {
      var t = m[0];
      if (m[1]) frag.appendChild(el('span', 'tk-s', t));
      else if (m[2]) frag.appendChild(el('span', 'tk-c', t));
      else if (m[3] && KEYWORDS.test(t)) frag.appendChild(el('span', 'tk-k', t));
      else frag.appendChild(document.createTextNode(t));
    }
    return frag;
  }

  function codeExamples(it) {
    var c = callOf(it);
    var box = el('div', 'api-code-examples');
    var tabs = el('div', 'api-langs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Programmiersprache');
    var panel = el('div');
    panel.setAttribute('role', 'tabpanel');
    var pre = el('pre');
    pre.tabIndex = 0;
    var codeEl = el('code');
    pre.appendChild(codeEl);
    var current = '';
    var bar = el('div', 'api-example-bar');
    bar.appendChild(el('strong', null, 'Aufruf'));
    bar.appendChild(copyButton(function () { return current; }));
    var buttons = {};
    LANGS.forEach(function (l) {
      var b = el('button', 'api-lang', l[1]);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.addEventListener('click', function () { setLang(l[0]); b.focus(); });
      b.addEventListener('keydown', function (e) {
        var i = LANGS.map(function (x) { return x[0]; }).indexOf(l[0]), n = null;
        if (e.key === 'ArrowRight') n = (i + 1) % LANGS.length;
        else if (e.key === 'ArrowLeft') n = (i + LANGS.length - 1) % LANGS.length;
        if (n != null) { e.preventDefault(); setLang(LANGS[n][0]); buttons[LANGS[n][0]].focus(); }
      });
      buttons[l[0]] = b;
      tabs.appendChild(b);
    });
    function update() {
      LANGS.forEach(function (l) {
        var sel = state.lang === l[0];
        buttons[l[0]].setAttribute('aria-selected', sel ? 'true' : 'false');
        buttons[l[0]].tabIndex = sel ? 0 : -1;
      });
      current = genCode(state.lang, c);
      codeEl.textContent = '';
      codeEl.appendChild(highlight(current));
    }
    exampleViews.push({ update: update, root: box });
    panel.appendChild(pre);
    box.appendChild(bar);
    box.appendChild(tabs);
    box.appendChild(panel);
    update();
    if (c.auth) box.appendChild(el('p', 'muted', '<Token> ist das Zugriffstoken (JWT) oder ein API-Token sm_…, siehe Einleitung.'));
    if (c.path.indexOf('<') >= 0) box.appendChild(el('p', 'muted', 'Teile in <…> im Pfad sind Platzhalter für Ihre Werte.'));
    return box;
  }

  function setLang(l) {
    state.lang = l;
    store('sm-api-lang', l);
    refreshExamples();
  }

  function refreshExamples() {
    exampleViews = exampleViews.filter(function (v) { return document.body.contains(v.root); });
    exampleViews.forEach(function (v) { v.update(); });
  }

  /* ---------- Endpunkt-Detail ---------- */

  function section(title) {
    var s = el('section', 'api-block');
    s.appendChild(el('h4', null, title));
    return s;
  }

  function paramTable(list) {
    var scroll = el('div', 'table-scroll');
    scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region');
    var t = el('table');
    var thead = el('thead'), hr = el('tr');
    ['Name', 'Typ', 'Pflicht', 'Beschreibung'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
    thead.appendChild(hr);
    t.appendChild(thead);
    var tb = el('tbody');
    list.forEach(function (p) {
      var sc = deref(p.schema) || {};
      var tr = el('tr');
      tr.appendChild(el('td')).appendChild(el('code', null, p.name));
      var tt = el('td');
      tt.appendChild(typeNode(p.schema));
      tr.appendChild(tt);
      tr.appendChild(el('td', null, p.required ? 'Ja' : 'Nein'));
      var d = el('td');
      var extra = [];
      if (sc.enum) extra.push('Werte: ' + sc.enum.join(', '));
      if (sc.default !== undefined) extra.push('Standard: ' + JSON.stringify(sc.default));
      if (sc.nullable) extra.push('nullable');
      if (p.description) d.appendChild(document.createTextNode(p.description + (extra.length ? ' ' : '')));
      if (extra.length) d.appendChild(el('span', 'muted', extra.join(' · ')));
      tr.appendChild(d);
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    scroll.appendChild(t);
    return scroll;
  }

  function bodyBlock(media, mediaType, others) {
    var box = el('div');
    var info = el('p', 'muted', 'Inhaltstyp: ' + mediaType + (others.length ? ' (auch ' + others.join(', ') + ')' : ''));
    box.appendChild(info);
    if (mediaType === 'multipart/form-data') {
      box.appendChild(el('div', 'note', 'Dateiupload als multipart/form-data: Felder des Formulars, keine JSON-Nutzlast.'));
    }
    if (mediaType === 'text/event-stream') {
      box.appendChild(el('div', 'note', 'Server-Sent Events: Die Antwort bleibt offen. Jedes Ereignis ist eine Zeile data: {json}, gefolgt von einer Leerzeile; das JSON entspricht dem Schema unten.'));
    }
    if (media.schema) box.appendChild(schemaTree(media.schema));
    var ex = exampleOf(media);
    if (ex !== undefined && ex !== null && mediaType !== 'multipart/form-data') {
      box.appendChild(exampleBlock('Beispiel', ex));
    }
    return box;
  }

  function accessBadges(it) {
    var out = [];
    var d = it.op.description || '';
    var role = /Rolle:?\s*`?([A-Za-zÄÖÜäöü]+(?: oder [A-Za-zÄÖÜäöü]+)?)/.exec(d);
    if (role) out.push('Rolle: ' + role[1]);
    if (/auch bei ungültiger Lizenz/.test(d)) out.push('Auch ohne gültige Lizenz');
    else if (/Lizenz/.test(JSON.stringify(it.op.responses || {}))) out.push('Gültige Lizenz nötig');
    return out;
  }

  function buildDetail(it) {
    var op = it.op, box = el('div');
    var params = (op.parameters || []).map(function (p) { return deref(p) || p; });
    [['path', 'Pfad-Parameter'], ['query', 'Query-Parameter'], ['header', 'Header-Parameter']].forEach(function (g) {
      var list = params.filter(function (p) { return p.in === g[0]; });
      if (!list.length) return;
      var s = section(g[1]);
      s.appendChild(paramTable(list));
      box.appendChild(s);
    });
    if (op.requestBody) {
      var rb = deref(op.requestBody) || {};
      var s2 = section('Request-Body' + (rb.required ? ' (Pflicht)' : ''));
      var types = Object.keys(rb.content || {});
      var primary = types.indexOf('application/json') >= 0 ? 'application/json' : types[0];
      if (primary) {
        s2.appendChild(bodyBlock(rb.content[primary], primary, types.filter(function (x) { return x !== primary; })));
      }
      if (rb.description) s2.insertBefore(el('p', null, rb.description), s2.children[1]);
      box.appendChild(s2);
    }
    var s3 = section('Antworten');
    var codes = Object.keys(op.responses || {}).sort();
    codes.forEach(function (code) {
      var r = deref(op.responses[code]) || {};
      var card = el('div', 'api-resp api-resp-' + code.charAt(0));
      var h = el('div', 'api-resp-head');
      h.appendChild(el('strong', 'api-code', code));
      var rd = el('span');
      inline(rd, r.description || '');
      h.appendChild(rd);
      card.appendChild(h);
      var pj = pickJson(r.content);
      if (pj) card.appendChild(bodyBlock(pj.media, pj.type, pj.others));
      else card.appendChild(el('p', 'muted', 'Kein Inhalt.'));
      s3.appendChild(card);
    });
    box.appendChild(s3);
    var s4 = section('Codebeispiel');
    s4.appendChild(codeExamples(it));
    box.appendChild(s4);
    return box;
  }

  function buildDatatypes(host, before) {
    var names = Object.keys((spec.components && spec.components.schemas) || {});
    if (!names.length) return;
    var sec = el('section', 'api-sec');
    sec.id = 'datentypen';
    sec.appendChild(el('h2', null, 'Datentypen'));
    sec.appendChild(el('p', 'muted', names.length + ' Datentypen, aus den Endpunkten verlinkt.'));
    names.forEach(function (n) {
      var art = el('article', 'api-ep card api-type');
      art.id = 'typ-' + n;
      var h = el('div', 'api-ep-head');
      h.appendChild(el('code', 'api-path', n));
      var back = el('a', 'api-back', '← Zurück');
      back.href = '#';
      back.addEventListener('click', function (e) {
        e.preventDefault();
        if (lastEndpoint) location.hash = '#' + lastEndpoint; else history.back();
      });
      h.appendChild(back);
      art.appendChild(h);
      var d = el('details');
      d.appendChild(el('summary', null, 'Felder anzeigen'));
      lazy(d, function () {
        var wrap = el('div');
        wrap.appendChild(schemaTree({ $ref: '#/components/schemas/' + n }));
        wrap.appendChild(exampleBlock('Beispiel', sample({ $ref: '#/components/schemas/' + n })));
        return wrap;
      });
      art.appendChild(d);
      sec.appendChild(art);
    });
    host.insertBefore(sec, before);
  }

  var lastEndpoint = null;

  /* ---------- Modell ---------- */

  function slug(method, path) {
    return method + '-' + path.toLowerCase().replace(/[{}]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function build() {
    var tagOrder = (spec.tags || []).map(function (t) { return t.name; });
    var tagInfo = {};
    (spec.tags || []).forEach(function (t) { tagInfo[t.name] = t; });
    var map = {};
    Object.keys(spec.paths || {}).forEach(function (path) {
      var pi = spec.paths[path];
      METHODS.forEach(function (method) {
        var op = pi[method];
        if (!op) return;
        var tag = (op.tags && op.tags[0]) || 'Weitere';
        if (tagOrder.indexOf(tag) < 0) tagOrder.push(tag);
        var id = slug(method, path), n = 2, base = id;
        while (byId[id]) id = base + '-' + n++;
        var it = {
          id: id, method: method, path: path, op: op, tag: tag,
          open: !op.security,
          hay: (path + ' ' + (op.summary || '') + ' ' + (op.description || '') + ' ' + tag).toLowerCase()
        };
        byId[id] = it;
        items.push(it);
        (map[tag] = map[tag] || []).push(it);
      });
    });
    groups = tagOrder.filter(function (t) { return map[t]; }).map(function (t) {
      return { name: t, description: (tagInfo[t] && tagInfo[t].description) || '', items: map[t] };
    });
  }

  /* ---------- Darstellung ---------- */

  function badge(method) {
    return el('span', 'api-m api-m-' + method, method.toUpperCase());
  }

  function renderNav() {
    var nav = $('api-nav');
    groups.forEach(function (g) {
      var d = el('details', 'api-grp');
      d.open = true;
      var s = el('summary');
      s.appendChild(el('span', null, g.name));
      g.count = el('small', 'muted', '');
      s.appendChild(g.count);
      d.appendChild(s);
      var ul = el('ul');
      g.items.forEach(function (it) {
        var li = el('li');
        var a = el('a');
        a.href = '#' + it.id;
        a.appendChild(badge(it.method));
        a.appendChild(el('span', 'api-p', it.path.replace(/^\/api\//, '/')));
        li.appendChild(a);
        ul.appendChild(li);
        it.navEl = li;
        it.navLink = a;
      });
      d.appendChild(ul);
      nav.appendChild(d);
      g.navDetails = d;
    });
    var tl = el('a', 'api-typesnav', 'Datentypen');
    tl.href = '#datentypen';
    nav.appendChild(tl);
  }

  function renderContent() {
    var host = $('api-content');
    groups.forEach(function (g) {
      var sec = el('section', 'api-sec');
      sec.id = 'bereich-' + g.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      sec.appendChild(el('h2', null, g.name));
      if (g.description) sec.appendChild(markdown(g.description));
      g.items.forEach(function (it) {
        var art = el('article', 'api-ep card');
        art.id = it.id;
        var head = el('div', 'api-ep-head');
        head.appendChild(badge(it.method));
        head.appendChild(el('code', 'api-path', it.path));
        if (it.open) head.appendChild(el('span', 'pkg-badge', 'Ohne Anmeldung'));
        else head.appendChild(el('span', 'pkg-badge', '\uD83D\uDD12 Bearer'));
        accessBadges(it).forEach(function (t) { head.appendChild(el('span', 'pkg-badge', t)); });
        if (it.op.deprecated) head.appendChild(el('span', 'pkg-badge', 'Veraltet'));
        art.appendChild(head);
        if (it.op.summary) art.appendChild(el('h3', 'api-sum', it.op.summary));
        if (it.op.description) art.appendChild(markdown(it.op.description));
        var more = el('details', 'api-more');
        more.appendChild(el('summary', null, 'Parameter, Antworten und Beispiele'));
        lazy(more, function () { return buildDetail(it); });
        art.appendChild(more);
        it.el = art;
        it.more = more;
        sec.appendChild(art);
      });
      host.insertBefore(sec, $('api-empty'));
      g.section = sec;
    });
    buildDatatypes(host, $('api-empty'));
  }


  /* ---------- Einleitung ---------- */

  function renderIntro(downloads, modified) {
    var info = spec.info || {};
    var desc = String(info.description || '').replace(/\n*Den vollständigen Ablauf[^\n]*$/, '');
    var host = $('api-intro-desc');
    host.appendChild(markdown(desc));
    var more = el('p');
    more.appendChild(document.createTextNode('Den vollständigen Ablauf zeigt der Abschnitt '));
    var a = el('a', null, 'Ablauf: von der Registrierung bis zur Antwort mit Quellen');
    a.href = '#ablauf';
    more.appendChild(a);
    more.appendChild(document.createTextNode('.'));
    host.appendChild(more);
    var parts = [];
    if (downloads && downloads.version) parts.push('Aktuelle Version der Software: ' + downloads.version);
    if (info.version) parts.push('API-Version: ' + info.version);
    if (modified && !isNaN(modified.getTime())) parts.push('Stand der Beschreibung: ' + modified.toLocaleDateString('de-DE'));
    $('api-stand').textContent = parts.join(' · ');
  }

  function showIntro(scroll) {
    var t = $('einleitung');
    if (scroll && t) t.scrollIntoView({ block: 'start' });
  }

  /* ---------- Filter und Auswahl ---------- */

  function applyFilter() {
    var terms = $('api-q').value.toLowerCase().split(/\s+/).filter(Boolean);
    var onlyOpen = $('api-open').checked;
    var anyMethod = METHODS.some(function (m) { return activeMethods[m]; });
    var shown = 0;
    groups.forEach(function (g) {
      var n = 0;
      g.items.forEach(function (it) {
        var ok = terms.every(function (t) { return it.hay.indexOf(t) >= 0; }) &&
          (!onlyOpen || it.open) && (!anyMethod || activeMethods[it.method]);
        it.visible = ok;
        it.el.hidden = !ok;
        it.navEl.hidden = !ok;
        if (ok) n++;
      });
      shown += n;
      g.count.textContent = n + '/' + g.items.length;
      g.section.hidden = n === 0;
      g.navDetails.hidden = n === 0;
      if (terms.length || onlyOpen || anyMethod) g.navDetails.open = n > 0;
    });
    $('api-count').textContent = shown + ' von ' + items.length + ' Endpunkten';
    $('api-empty').hidden = shown !== 0;
  }

  var current = null;
  function select(scroll) {
    var id = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (current) { current.el.classList.remove('is-current'); current.navLink.removeAttribute('aria-current'); }
    var it = byId[id];
    current = it || null;
    if (!it) {
      var tgt = id && document.getElementById(id);
      if (tgt && (id === 'einleitung' || id === 'ablauf')) { if (scroll) tgt.scrollIntoView({ block: 'start' }); return; }
      if (tgt && (id === 'datentypen' || id.indexOf('typ-') === 0)) {
        var dd = tgt.querySelector && tgt.querySelector('details');
        if (dd) dd.open = true;
        if (scroll) tgt.scrollIntoView({ block: 'start' });
      }
      return;
    }
    lastEndpoint = it.id;
    it.more.open = true;
    if (!it.visible) {   // Direktlink auf ausgeblendeten Endpunkt: Filter zuruecksetzen
      $('api-q').value = '';
      $('api-open').checked = false;
      activeMethods = {};
      syncMethodButtons();
      applyFilter();
    }
    it.el.classList.add('is-current');
    it.navLink.setAttribute('aria-current', 'true');
    groups.forEach(function (g) { if (g.items.indexOf(it) >= 0) g.navDetails.open = true; });
    if (scroll) it.el.scrollIntoView({ block: 'start' });
  }

  function syncMethodButtons() {
    var b = $('api-methods').children;
    for (var i = 0; i < b.length; i++) b[i].setAttribute('aria-pressed', activeMethods[b[i].dataset.m] ? 'true' : 'false');
  }

  function initControls() {
    var box = $('api-methods');
    METHODS.forEach(function (m) {
      var b = el('button', null, m.toUpperCase());
      b.type = 'button';
      b.dataset.m = m;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () {
        activeMethods[m] = !activeMethods[m];
        syncMethodButtons();
        applyFilter();
      });
      box.appendChild(b);
    });
    var bi = $('api-base');
    var savedBase = load('sm-api-base');
    if (savedBase && /^https?:\/\//i.test(savedBase)) { state.base = savedBase; bi.value = savedBase; }
    bi.addEventListener('input', function () {
      var v = bi.value.trim();
      state.base = /^https?:\/\/\S+$/i.test(v) ? v : DEFAULT_BASE;
      if (state.base !== DEFAULT_BASE || v === DEFAULT_BASE) store('sm-api-base', state.base);
      refreshExamples();
    });
    $('api-q').addEventListener('input', applyFilter);
    $('api-open').addEventListener('change', applyFilter);
    listen(document, 'keydown', function (e) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target && e.target.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
      e.preventDefault();
      $('api-side').classList.add('open');
      $('api-toggle').setAttribute('aria-expanded', 'true');
      $('api-q').focus();
    });
    var tg = $('api-toggle');
    tg.addEventListener('click', function () {
      var open = $('api-side').classList.toggle('open');
      tg.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    $('api-nav').addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('a')) {
        $('api-side').classList.remove('open');
        tg.setAttribute('aria-expanded', 'false');
      }
    });
    listen(window, 'hashchange', function () { select(true); });
  }

  /* ---------- Start ---------- */

  function fail() {
    $('api-meta').textContent = '';
    $('api-error').hidden = false;
  }

  function reset() {
    spec = null; items = []; groups = []; byId = {}; activeMethods = {};
    exampleViews = []; lastEndpoint = null; current = null; modified = null;
  }

  var modified = null;

  // Haengt den Renderer an das vorhandene Geruest (api-layout, api-nav, api-content ...).
  // opts.specUrl: OpenAPI-Datei; opts.baseUrl: Vorgabe der Basis-URL in den Codebeispielen; opts.onError(err): bei Ladefehler (err.message 'HTTP 404' u. a.); opts.downloadsUrl: optional, liefert "version" der Software (null = keine).
  // Gibt { destroy } zurueck; destroy entfernt die Listener auf document/window.
  function mount(opts) {
    opts = opts || {};
    var specUrl = opts.specUrl || DEFAULT_SPEC_URL;
    var downloadsUrl = opts.downloadsUrl === undefined ? DEFAULT_DOWNLOADS_URL : opts.downloadsUrl;
    var destroyed = false;
    reset();
    DEFAULT_BASE = opts.baseUrl || 'http://localhost:5043';
    state.base = DEFAULT_BASE;
    var savedLang = load('sm-api-lang');
    if (savedLang && LANGS.some(function (l) { return l[0] === savedLang; })) state.lang = savedLang;

    var downloadsReq = downloadsUrl
      ? fetch(downloadsUrl, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      : Promise.resolve(null);

    fetch(specUrl, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var lm = r.headers.get('Last-Modified');
        if (lm) modified = new Date(lm);
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.paths) throw new Error('Format');
        spec = data;
        return downloadsReq;
      })
      .then(function (downloads) {
        if (destroyed) return;
        build();
        renderNav();
        renderContent();
        initControls();
        applyFilter();
        renderIntro(downloads, modified);
        var info = spec.info || {};
        $('api-meta').textContent = (info.title || 'API') + (info.version ? ' · Version ' + info.version : '') +
          ' · ' + items.length + ' Endpunkte in ' + groups.length + ' Bereichen';
        $('api-layout').hidden = false;
        select(true);
      })
      .catch(function (err) { if (!destroyed) { fail(); if (opts.onError) opts.onError(err); } });

    return {
      destroy: function () {
        destroyed = true;
        listeners.forEach(function (l) { l.target.removeEventListener(l.type, l.fn); });
        listeners = [];
      }
    };
  }

  window.SMApiDoku.mount = mount;
  // Fuer die Node-Tests (tests/api-doku.test.mjs); die Seiten selbst nutzen nur mount().
  window.SMApiDoku.internals = {
    markdown: markdown, sample: sample, callOf: callOf, genCode: genCode, slug: slug,
    load: function (data) { reset(); spec = data; build(); return items; }
  };
  // Die Webseite startet selbst; die App setzt SMApiDokuManual und ruft mount() nach dem Rendern des Geruests.
  if (!window.SMApiDokuManual) mount();
})();
