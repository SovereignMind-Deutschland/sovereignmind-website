#!/usr/bin/env node
// Erzeugt die englischen Seiten unter en/ aus den deutschen Quellseiten und i18n/en.json (Plan website-stil-animationen, Phase 2).
// Ohne Abhängigkeiten. Die deutschen Seiten sind die Quelle; en/ wird eingecheckt (die Seite bleibt "ohne Build" auslieferbar).
//
//   node scripts/build-i18n.mjs            erzeugt en/*.html, pflegt Sprachumschalter und hreflang in den deutschen Seiten
//   node scripts/build-i18n.mjs --check    schreibt nichts; Exit 1, wenn en/ oder die deutschen Seiten nicht zum Stand passen
//   node scripts/build-i18n.mjs --missing  listet deutsche Texte ohne englische Übersetzung (Exit 1, wenn welche fehlen)
//
// i18n/en.txt: Paare aus deutschem und englischem Text, siehe ladeMap. Der Schlüssel ist der deutsche Text selbst,
// so bleibt die deutsche Seite unverändert lesbar und ein geänderter deutscher Text fällt als Lücke auf (nie ein Schlüsselname im Ergebnis).
// Inline-Markup (<a>, <em>) bleibt erhalten; Texte zwischen den Tags werden einzeln übersetzt.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export const BASE = 'https://sovereignmind-deutschland.github.io/sovereignmind-website/';
/** Seiten mit englischer Fassung. */
export const EN_PAGES = ['index.html', 'download.html', 'vergleich.html', 'on-premise-ki.html', 'api.html'];
/** Deutsche Seiten mit Umschalter (die ohne englische Fassung verweisen auf die englische Startseite). */
export const SWITCH_PAGES = [...EN_PAGES, 'wissenspakete.html', 'impressum.html', 'datenschutz.html'];
const TRANSLATE_ATTRS = new Set(['alt', 'title', 'aria-label', 'label', 'placeholder', 'content']);
const META_OK = /^(description|og:title|og:description|og:image:alt|twitter:title|twitter:description)$/;
const SKIP_TEXT_IN = new Set(['pre', 'code', 'kbd', 'samp', 'textarea']);
/** Texte, die in beiden Sprachen gleich bleiben (Zahlen, Zeichen, Namen). */
const SAME = /^(DE|EN|Benjamin Richter|Aurora|Corporate|Echo|Lumen|Mono|Obsidian|Karlsson|Thorsten|[‹›×]|[\d\s.,:;|/–—·•×+%€$()[\]<>=#&-]*|SovereignMind|Windows|Linux|API|JSON|MB|GB|SHA-256|curl|C#|Python|JavaScript|OpenAPI|Admin|Member)$/;

const lesen = (f) => readFileSync(join(root, f), 'utf8');
const norm = (s) => s.replace(/\s+/g, ' ').trim();

export function seiteUrl(page, lang) {
  const p = page === 'index.html' ? '' : page;
  return BASE + (lang === 'en' ? 'en/' : '') + p;
}

/** Markup des Umschalters; `lang` ist die Sprache der Seite, auf der er steht. */
export function switcher(page, lang) {
  const hrefDe = lang === 'de' ? page : '../' + page;
  const hrefEn = lang === 'en' ? page : (EN_PAGES.includes(page) ? 'en/' + page : null);
  const label = lang === 'de' ? 'Sprache' : 'Language';
  const a = (code, name, href, full) =>
    `<a lang="${code}" hreflang="${code}" href="${href}"${code === lang ? ' aria-current="true"' : ''} title="${full}">${name}</a>`;
  // Seite ohne englische Fassung: EN ausgegraut, kein Link (kein stiller Sprung auf eine andere Seite)
  const en = hrefEn ? a('en', 'EN', hrefEn, 'English')
    : '<span lang="en" class="lang-off" aria-disabled="true" title="Only available in German">EN</span>';
  return `<!--lang-switch--><div class="lang-switch" role="group" aria-label="${label}">${a('de', 'DE', hrefDe, 'Deutsch')}${en}</div><!--/lang-switch-->`;
}

function alternates(page) {
  if (!EN_PAGES.includes(page)) return '';
  return [
    `<link rel="alternate" hreflang="de" href="${seiteUrl(page, 'de')}">`,
    `<link rel="alternate" hreflang="en" href="${seiteUrl(page, 'en')}">`,
    `<link rel="alternate" hreflang="x-default" href="${seiteUrl(page, 'de')}">`
  ].join('\n  ');
}

const SW_RE = /<!--lang-switch-->[\s\S]*?<!--\/lang-switch-->/;
const ALT_RE = /\n  <link rel="alternate" hreflang="[^"]+" href="[^"]+">/g;

/** Deutsche Quellseite: Umschalter und hreflang aktuell halten (idempotent). */
export function pflegeDeutsch(page, html) {
  let out = html;
  const sw = switcher(page, 'de');
  if (SW_RE.test(out)) out = out.replace(SW_RE, () => sw);
  else out = out.replace(/(\n\s*)(<a class="btn" href="download\.html"[^>]*>)/, (m, ws, a) => `${ws}${sw}${ws}${a}`);
  out = out.replace(ALT_RE, '');
  const alt = alternates(page);
  if (alt) out = out.replace(/(<link rel="canonical" href="[^"]+">)/, (m) => `${m}\n  ${alt}`);
  return out;
}

/** Zerlegt HTML in Tags/Kommentare/Skripte und Text. */
const TOKEN = /(<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<[^>]+>)/;

const VOID = new Set(['br', 'img', 'link', 'meta', 'input', 'source', 'track', 'hr', 'col', 'wbr', 'area', 'base']);
/** Elemente, die selbst Absätze/Blöcke sind: enthält ein Element eines davon, wird in die Kinder abgestiegen. */
const BLOCKISH = new Set(['p', 'ul', 'ol', 'li', 'div', 'section', 'article', 'aside', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'caption', 'figure', 'figcaption', 'dl', 'dt', 'dd', 'details', 'summary', 'header', 'footer', 'nav', 'main', 'form', 'fieldset', 'pre', 'select', 'option', 'video',
  'svg', 'canvas', 'dialog', 'button', 'label', 'blockquote', 'body', 'head', 'html', 'title', 'noscript']);

/** Übersetzt Attribute eines Start-Tags. */
function attrs(t, name, tr) {
  return t.replace(/\s([a-zA-Z:-]+)="([^"]*)"/g, (m, attr, val) => {
    const a = attr.toLowerCase();
    if (!TRANSLATE_ATTRS.has(a)) return m;
    if (a === 'content') {
      const nm = /(?:name|property)="([^"]+)"/.exec(t)?.[1] ?? '';
      if (!META_OK.test(nm)) return m;
    }
    if (a === 'title' && name === 'a' && /\shreflang=/.test(t)) return m;
    const neu = tr(val);
    return neu === val ? m : ` ${attr}="${neu.replace(/"/g, '&quot;')}"`;
  });
}

export function uebersetze(page, html, map, fehlend) {
  const tr = (text) => {
    const key = norm(text);
    const plain = norm(key.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' '));
    if (!key || SAME.test(plain) || /^<(code|kbd|samp)\b[^>]*>[^<]*<\/\1>$/.test(key)) return text;
    if (!Object.hasOwn(map, key)) { fehlend.add(`${page}: ${key}`); return text; }
    return text.match(/^\s*/)[0] + map[key] + text.match(/\s*$/)[0];
  };
  const tok = html.split(TOKEN); // gerade Indizes: Text, ungerade: Tags/Kommentare/Skripte

  /** Index des passenden schließenden Tags zu tok[i] (öffnendes Tag) oder -1. */
  const schliesse = (i, name) => {
    let depth = 0;
    for (let j = i; j < tok.length; j++) {
      if (j % 2 === 0) continue;
      const t = tok[j];
      if (t.startsWith('<!--') || /^<(script|style)\b/i.test(t)) continue;
      const o = /^<([a-zA-Z0-9-]+)/.exec(t);
      const c = /^<\/([a-zA-Z0-9-]+)/.exec(t);
      if (o && o[1].toLowerCase() === name && !/\/>$/.test(t)) depth++;
      else if (c && c[1].toLowerCase() === name && --depth === 0) return j;
    }
    return -1;
  };

  const out = [];
  const run = (from, to) => {
    for (let i = from; i < to; i++) {
      const t = tok[i];
      if (i % 2 === 0) { out.push(t.trim() ? tr(t) : t); continue; }
      if (t.startsWith('<!--') || /^<style\b/i.test(t)) { out.push(t); continue; }
      if (/^<script\b/i.test(t)) { out.push(/type="application\/ld\+json"/.test(t) ? ldJson(t, page, map, fehlend) : t); continue; }
      const o = /^<([a-zA-Z0-9-]+)/.exec(t);
      if (!o) { out.push(t); continue; } // schließendes Tag ohne Gegenstück (z. B. von einem übersprungenen Element)
      const name = o[1].toLowerCase();
      if (/class="lang-switch"/.test(t)) { const e = schliesse(i, name); out.push(tok.slice(i, e + 1).join('')); i = e; continue; }
      if (VOID.has(name) || /\/>$/.test(t)) { out.push(attrs(t, name, tr)); continue; }
      const end = schliesse(i, name);
      if (end < 0) { out.push(attrs(t, name, tr)); continue; }
      out.push(attrs(t, name, tr));
      if (name === 'pre' || name === 'textarea') { out.push(tok.slice(i + 1, end + 1).join('')); i = end; continue; }
      let block = false;
      for (let j = i + 2; j < end && !block; j += 2) {
        const c = /^<([a-zA-Z0-9-]+)/.exec(tok[j]);
        if (c && BLOCKISH.has(c[1].toLowerCase())) block = true;
        if (/^<script\b/i.test(tok[j])) block = true;
      }
      if (block) { run(i + 1, end + 1); i = end; continue; }
      // Einheit: Inhalt bis zum schließenden Tag als Ganzes übersetzen (Inline-Markup bleibt im Text)
      out.push(tr(tok.slice(i + 1, end).join('')));
      out.push(tok[end]);
      i = end;
    }
  };
  run(0, tok.length);
  return out.join('');
}

function ldJson(t, page, map, fehlend) {
  const m = /^(<script[^>]*>)([\s\S]*?)(<\/script>)$/.exec(t);
  let obj;
  try { obj = JSON.parse(m[2].replace(/\{\{([A-Z_]+)\}\}/g, '\u0001$1\u0002')); } catch { return t; }
  const walk = (o) => {
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'string') {
        if (k === 'inLanguage') o[k] = 'en';
        else if (k === 'url' || k === 'item') o[k] = v.startsWith(BASE) ? enUrl(v) : v;
        else if (k === 'description' || (k === 'name' && !/\u0001/.test(v))) {
          const key = norm(v);
          if (Object.hasOwn(map, key)) o[k] = map[key];
          else if (!SAME.test(key)) fehlend.add(`${page}: ${key}`);
        }
      } else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(obj);
  const text = JSON.stringify(obj, null, 2).replace(/\n/g, '\n  ').replace(/\u0001([A-Z_]+)\u0002/g, '{{$1}}');
  return `${m[1]}\n  ${text}\n  ${m[3]}`;
}

/** Deutsche absolute Seiten-URL → englische, soweit es die Seite auf Englisch gibt. */
function enUrl(u) {
  const p = u.slice(BASE.length) || 'index.html';
  if (!EN_PAGES.includes(p.split('#')[0])) return u;
  return BASE + 'en/' + (p === 'index.html' ? '' : p);
}

/** Relative Pfade der deutschen Seite für en/: gibt es das Ziel auf Englisch, bleibt der Name, sonst ../ davor. */
function pfade(html) {
  const fix = (v) => {
    if (!v || /^(#|[a-z][a-z0-9+.-]*:|\/\/|\.\.\/|\{\{)/i.test(v)) return v;
    const [pfad, ...rest] = v.split('#');
    const hash = rest.length ? '#' + rest.join('#') : '';
    if (pfad === '') return v;
    if (pfad === './' || pfad === '.') return './' + hash;
    if (EN_PAGES.includes(pfad.split('?')[0])) return pfad + hash;
    return '../' + pfad + hash;
  };
  return html
    .replace(/(\s(?:href|src|poster)=")([^"]*)(")/g, (m, a, v, c) => a + fix(v) + c)
    .replace(/(\ssrcset=")([^"]*)(")/g, (m, a, v, c) =>
      a + v.split(',').map((s) => { const [u, ...r] = s.trim().split(/\s+/); return [fix(u), ...r].join(' '); }).join(', ') + c);
}

/** Nur englische Zusätze: Seite → [Einfügestelle, Markup]. */
const EN_EXTRA = {
  'api.html': [/<h1 class="api-title">[^<]*<\/h1>/, '\n    <div class="note" lang="en">The introduction is available in English. The endpoint reference below is generated from the OpenAPI description and is currently in German only.</div>']
};

export function erzeugeEn(page, de, map, fehlend) {
  let h = uebersetze(page, de, map, fehlend);
  h = h.replace('<html lang="de">', '<html lang="en" data-root="../">');
  h = h.replace(/(<link rel="canonical" href=")[^"]+(">)/, (m, a, b) => a + seiteUrl(page, 'en') + b);
  h = h.replace(/(<meta property="og:url" content=")[^"]+(">)/, (m, a, b) => a + seiteUrl(page, 'en') + b);
  h = h.replace('content="de_DE"', 'content="en_US"');
  h = h.replace(SW_RE, () => switcher(page, 'en'));
  h = pfade(h);
  if (EN_EXTRA[page]) h = h.replace(EN_EXTRA[page][0], (m) => m + EN_EXTRA[page][1]);
  // Rechtstexte bleiben deutsch: der Link sagt es
  h = h.replace(/(<a href="\.\.\/(?:impressum|datenschutz)\.html")>/g, '$1 hreflang="de" lang="de">');
  return h;
}

/** i18n/en.txt: je Eintrag eine Zeile "> deutsch" und eine Zeile "< englisch"; "#" beginnt einen Kommentar. */
export function ladeMap(text) {
  const map = {};
  let de = null;
  text.split('\n').forEach((z, n) => {
    if (z.startsWith('> ')) { de = norm(z.slice(2)); }
    else if (z.startsWith('< ')) {
      if (de == null) throw new Error(`en.txt:${n + 1}: Übersetzung ohne deutschen Text`);
      if (Object.hasOwn(map, de)) throw new Error(`en.txt:${n + 1}: doppelter Eintrag: ${de.slice(0, 60)}`);
      map[de] = z.slice(2).trim();
      de = null;
    } else if (z.trim() && !z.startsWith('#')) throw new Error(`en.txt:${n + 1}: Zeile muss mit "> ", "< " oder "#" beginnen`);
  });
  if (de != null) throw new Error('en.txt: letzter deutscher Text ohne Übersetzung');
  return map;
}

/** sitemap.xml: deutsche Seiten, englische Seiten, je mit hreflang-Alternativen. */
export function sitemap() {
  const alle = ['index.html', 'download.html', 'wissenspakete.html', 'vergleich.html', 'on-premise-ki.html', 'api.html'];
  const zeilen = [];
  for (const lang of ['de', 'en']) {
    for (const p of alle) {
      if (lang === 'en' && !EN_PAGES.includes(p)) continue;
      const alt = EN_PAGES.includes(p)
        ? `\n    <xhtml:link rel="alternate" hreflang="de" href="${seiteUrl(p, 'de')}"/>\n    <xhtml:link rel="alternate" hreflang="en" href="${seiteUrl(p, 'en')}"/>\n    <xhtml:link rel="alternate" hreflang="x-default" href="${seiteUrl(p, 'de')}"/>\n  `
        : '';
      zeilen.push(`  <url><loc>${seiteUrl(p, lang)}</loc>${alt}</url>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${zeilen.join('\n')}\n</urlset>\n`;
}

function main() {
  const args = process.argv.slice(2);
  const map = ladeMap(lesen('i18n/en.txt'));
  const fehlend = new Set();
  const writes = [];
  const de = {};
  for (const page of SWITCH_PAGES) {
    const alt = lesen(page);
    de[page] = pflegeDeutsch(page, alt);
    if (de[page] !== alt) writes.push([page, de[page]]);
  }
  for (const page of EN_PAGES) {
    const en = erzeugeEn(page, de[page], map, fehlend);
    const ziel = 'en/' + page;
    if (!existsSync(join(root, ziel)) || lesen(ziel) !== en) writes.push([ziel, en]);
  }
  if (!existsSync(join(root, 'sitemap.xml')) || lesen('sitemap.xml') !== sitemap()) writes.push(['sitemap.xml', sitemap()]);
  if (args.includes('--missing')) {
    for (const f of [...fehlend].sort()) console.log(f);
    console.error(`${fehlend.size} Texte ohne Übersetzung`);
    process.exit(fehlend.size ? 1 : 0);
  }
  if (args.includes('--check')) {
    if (writes.length) { console.error('Nicht aktuell: ' + writes.map((w) => w[0]).join(', ') + ' (node scripts/build-i18n.mjs)'); process.exit(1); }
    console.log('en/ ist aktuell');
    return;
  }
  mkdirSync(join(root, 'en'), { recursive: true });
  for (const [f, text] of writes) writeFileSync(join(root, f), text);
  console.log(writes.length ? 'Geschrieben: ' + writes.map((w) => w[0]).join(', ') : 'Nichts zu tun');
  if (fehlend.size) console.error(`Achtung: ${fehlend.size} deutsche Texte ohne Übersetzung bleiben deutsch (--missing zeigt sie)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
