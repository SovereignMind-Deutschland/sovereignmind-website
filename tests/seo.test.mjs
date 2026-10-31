// SEO-Grundlage: Canonical, Open Graph, Twitter-Karte, JSON-LD, Sitemap und robots.txt. Aufruf: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const BASE = 'https://sovereignmind-deutschland.github.io/sovereignmind-website/';
const INDEXIERBAR = { 'index.html': '', 'download.html': 'download.html', 'wissenspakete.html': 'wissenspakete.html', 'vergleich.html': 'vergleich.html', 'on-premise-ki.html': 'on-premise-ki.html', 'api.html': 'api.html' };
const NOINDEX = ['impressum.html', 'datenschutz.html', '404.html'];
const lesen = (f) => readFileSync(join(root, f), 'utf8');
const meta = (html, attr, name) => (html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`)) || [])[1];

test('Jede indexierbare Seite hat Titel, Description, Canonical, Open Graph und Twitter-Karte', () => {
  const titel = new Set();
  for (const [f, pfad] of Object.entries(INDEXIERBAR)) {
    const html = lesen(f);
    const t = html.match(/<title>(.*?)<\/title>/)[1];
    assert.ok(!titel.has(t), `${f}: Titel doppelt`);
    titel.add(t);
    assert.ok(t.length <= 60, `${f}: Titel länger als 60 Zeichen`);
    const d = meta(html, 'name', 'description');
    assert.ok(d && d.length >= 70 && d.length <= 160, `${f}: Description fehlt oder Länge ${d?.length}`);
    assert.ok(html.includes(`<link rel="canonical" href="${BASE}${pfad}">`), `${f}: Canonical`);
    assert.equal(meta(html, 'property', 'og:url'), BASE + pfad, `${f}: og:url`);
    assert.equal(meta(html, 'property', 'og:title'), t, `${f}: og:title`);
    assert.equal(meta(html, 'property', 'og:description'), d, `${f}: og:description`);
    assert.equal(meta(html, 'property', 'og:locale'), 'de_DE', `${f}: og:locale`);
    assert.equal(meta(html, 'property', 'og:image'), BASE + 'assets/og-image.png', `${f}: og:image`);
    assert.equal(meta(html, 'name', 'twitter:card'), 'summary_large_image', `${f}: twitter:card`);
    assert.ok(meta(html, 'name', 'twitter:image'), `${f}: twitter:image`);
    assert.ok(!/noindex/.test(html), `${f}: darf nicht noindex sein`);
  }
});

test('Impressum, Datenschutz und 404 sind noindex', () => {
  for (const f of NOINDEX) assert.match(lesen(f), /<meta name="robots" content="noindex">/, f);
});

test('Präsentation ist noindex und nicht in der Sitemap', () => {
  assert.match(lesen('praesentation/index.html'), /<meta name="robots" content="noindex">/);
  assert.ok(!/praesentation/.test(lesen('sitemap.xml')), 'Sitemap darf die Präsentation nicht nennen');
});

test('Vorschaubild liegt vor (PNG, 1200x630)', () => {
  const png = readFileSync(join(root, 'assets/og-image.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

function jsonLd(f) {
  // Platzhalter des Deploys durch Text ersetzen, damit das JSON prüfbar ist
  return [...lesen(f).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => JSON.parse(m[1].replace(/\{\{[A-Z_]+\}\}/g, 'Test')));
}

test('JSON-LD ist gültig: Startseite mit Organization, WebSite, SoftwareApplication; Unterseiten mit BreadcrumbList', () => {
  const typen = jsonLd('index.html').map((o) => o['@type']);
  assert.deepEqual(typen, ['Organization', 'WebSite', 'SoftwareApplication']);
  for (const f of Object.keys(INDEXIERBAR).filter((x) => x !== 'index.html')) {
    const blöcke = jsonLd(f);
    assert.equal(blöcke.length, 1, f);
    assert.equal(blöcke[0]['@type'], 'BreadcrumbList', f);
    assert.equal(blöcke[0].itemListElement[1].item, BASE + INDEXIERBAR[f], f);
  }
});

test('JSON-LD enthält weder Preis noch Bewertung; Anbietername bleibt Platzhalter', () => {
  const roh = lesen('index.html');
  for (const f of Object.keys(INDEXIERBAR)) {
    const bloecke = [...lesen(f).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
    assert.ok(!/offers|price|aggregateRating|review/i.test(bloecke), `${f}: Preis oder Bewertung im JSON-LD`);
  }
  assert.match(roh, /"name": "\{\{PROVIDER_NAME\}\}"/);
});

test('Sitemap listet genau die indexierbaren Seiten; robots.txt verweist darauf und sperrt nichts', () => {
  const sitemap = lesen('sitemap.xml');
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
  assert.deepEqual(urls, Object.values(INDEXIERBAR).map((p) => BASE + p).sort());
  const robots = lesen('robots.txt');
  assert.match(robots, new RegExp(`^Sitemap: ${BASE}sitemap\.xml$`, 'm'));
  assert.ok(!/^Disallow:\s*\S/m.test(robots), 'noindex-Seiten dürfen nicht gesperrt sein, sonst wird das noindex nicht gelesen');
});

test('Alle Bilder im HTML haben ein alt-Attribut', () => {
  for (const f of [...Object.keys(INDEXIERBAR), ...NOINDEX]) {
    for (const m of lesen(f).matchAll(/<img\b[^>]*>/g)) assert.match(m[0], /\balt=/, `${f}: ${m[0]}`);
  }
});

test('llms.txt verweist nur auf vorhandene Seiten und nennt den Demo-Status', () => {
  const txt = lesen('llms.txt');
  assert.match(txt, /^# SovereignMind/m);
  assert.match(txt, /nur als Demo/);
  const ziele = [...txt.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((m) => m[1]);
  assert.ok(ziele.length >= 5);
  for (const url of ziele) {
    assert.ok(url.startsWith(BASE), url);
    const pfad = url.slice(BASE.length) || 'index.html';
    assert.ok(existsSync(join(root, pfad)), `llms.txt: ${pfad} fehlt`);
  }
});

test('Vergleich: jede Quelle in kosten.json hat ein Datum, jede verwendete Quelle existiert', () => {
  const k = JSON.parse(lesen('assets/kosten.json'));
  for (const q of k.quellen) assert.match(q.text, /(Oktober|\d{1,2}\.\d{1,2}\.)\s*2026/, `${q.id}: Datum fehlt`);
  const ids = new Set(k.quellen.map((q) => q.id));
  for (const a of k.anbieter) assert.ok(ids.has(a.quelle), a.id);
  assert.ok(ids.has(k.azure_selbstbau.quelle));
});
