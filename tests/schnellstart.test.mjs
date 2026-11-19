// Schnellstart-Seite (Plan openrag-ideen, Phase 2). Aufruf: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const lesen = (f) => readFileSync(join(root, f), 'utf8');
const SEITEN = { de: 'schnellstart.html', en: 'en/schnellstart.html' };
const IDS = ['voraussetzungen', 'installieren', 'einrichten', 'dokumente', 'frage', 'anpassen', 'weiter'];

test('Schnellstart: Schritte 1–7 in Reihenfolge, je Schritt ein Navigationsanker', () => {
  for (const [lang, f] of Object.entries(SEITEN)) {
    const html = lesen(f);
    const gefunden = [...html.matchAll(/<section class="qs-step" id="([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(gefunden, IDS, `${f}: Schritte`);
    for (const id of IDS) assert.ok(html.includes(`<a href="#${id}">`), `${f}: Anker ${id} fehlt in der Fortschrittsanzeige`);
    assert.match(html, new RegExp(`<html lang="${lang}"`), f);
  }
});

test('Schnellstart: Befehle mit Kopier-Knopf, Version, kein Skript außer eigenem', () => {
  for (const f of Object.values(SEITEN)) {
    const html = lesen(f);
    for (const os of ['windows', 'linux']) {
      assert.ok(html.includes(`data-cmd="${os}"`), `${f}: Befehl ${os}`);
      assert.ok(html.includes(`data-copy="${os}"`), `${f}: Kopier-Knopf ${os}`);
    }
    assert.ok(html.includes('data-version'), `${f}: Versionsanzeige`);
    assert.ok(/<script src="(\.\.\/)?assets\/app\.js" defer>/.test(html), `${f}: app.js`);
  }
});

test('Schnellstart: lokale Links und Bilder lösen sich auf, Bilder haben alt und feste Maße', () => {
  for (const f of Object.values(SEITEN)) {
    const html = lesen(f);
    const dir = dirname(f);
    for (const m of html.matchAll(/(?:href|src)="([^"#:]+)(?:#([^"]*))?"/g)) {
      if (/^(https?|mailto):/.test(m[1])) continue;
      const ziel = normalize(join(dir, m[1]));
      assert.ok(existsSync(join(root, ziel)), `${f}: ${m[1]} nicht gefunden`);
      if (m[2] && ziel.endsWith('.html')) assert.ok(lesen(ziel).includes(`id="${m[2]}"`), `${f}: Anker ${m[1]}#${m[2]}`);
    }
    for (const img of html.matchAll(/<img\b(?![^>]*logo\.svg)[^>]*>/g)) {
      assert.match(img[0], /\salt="[^"]+"/, `${f}: Bild ohne alt: ${img[0]}`);
      assert.match(img[0], /\swidth="\d+"/);
      assert.match(img[0], /\sheight="\d+"/);
    }
  }
});

test('Schnellstart: ohne Lizenzweg, ohne Vergleich mit anderen Produkten, englische Fassung ohne deutschen Fließtext', () => {
  for (const f of Object.values(SEITEN)) assert.ok(!/openrag/i.test(lesen(f)), `${f}: nennt OpenRAG`);
  const en = lesen(SEITEN.en);
  assert.ok(!/Voraussetzungen|Installieren|Kopieren|Schritt/.test(en.replace(/<script[\s\S]*?<\/script>/g, '')), 'englische Seite enthält deutsche Wörter');
  assert.match(en, /"@type": "HowTo"/);
  assert.match(lesen(SEITEN.de), /"@type": "HowTo"/);
});

test('Schnellstart: in Navigation aller Seiten zwischen Produkt und Wissenspakete, Startseite verweist darauf, llms.txt und Sitemap', () => {
  for (const f of ['index.html', 'download.html', 'wissenspakete.html', 'vergleich.html', 'api.html', 'on-premise-ki.html', 'impressum.html', 'datenschutz.html', 'schnellstart.html', 'en/index.html', 'en/download.html', 'en/schnellstart.html']) {
    assert.match(lesen(f), /Produkt<\/a>\s*<a href="schnellstart\.html"[^>]*>Schnellstart<\/a>\s*<a href="wissenspakete\.html"|Product<\/a>\s*<a href="schnellstart\.html"[^>]*>Quickstart<\/a>\s*<a href="\.\.\/wissenspakete\.html"/, `${f}: Navigation`);
  }
  assert.match(lesen('index.html'), /class="btn ghost" href="schnellstart\.html"/);
  assert.ok(lesen('llms.txt').includes('/schnellstart.html'));
  assert.ok(lesen('sitemap.xml').includes('/en/schnellstart.html'));
});
