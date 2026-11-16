// Startseite: Einblenden ohne JS, Entwickler-Bild, Anker. Aufruf: node --test tests/*.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const lesen = (f) => readFileSync(join(root, f), 'utf8');
const index = lesen('index.html');
const css = lesen('assets/style.css');
const js = lesen('assets/app.js');

test('.reveal wird nur per JS gesetzt, nicht im HTML (ohne JS bleibt alles sichtbar)', () => {
  assert.ok(!/class="[^"]*\breveal\b/.test(index), 'index.html enthält .reveal im Markup');
  assert.match(js, /classList\.add\('reveal'\)/);
  assert.match(js, /'IntersectionObserver' in window/);
});

test('Bei "Bewegung reduzieren" ist .reveal sichtbar und Animationen sind aus', () => {
  const bloecke = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
  assert.ok(bloecke, 'Media-Query fehlt');
  assert.match(bloecke, /\.reveal \{ opacity: 1; transform: none; \}/);
  assert.match(bloecke, /\.hero-copy > \* \{ animation: none; \}/);
  assert.match(js, /prefers-reduced-motion: reduce/);
});

test('Entwickler-Bild hat alt, width, height und lokalen Pfad', () => {
  const sec = index.match(/<section[^>]*id="entwickler"[\s\S]*?<\/section>/);
  assert.ok(sec, 'Abschnitt #entwickler fehlt');
  const img = sec[0].match(/<img [^>]*>/);
  assert.ok(img, 'kein <img>');
  const tag = img[0];
  assert.match(tag, /\balt="[^"]{5,}"/);
  assert.match(tag, /\bwidth="\d+"/);
  assert.match(tag, /\bheight="\d+"/);
  const src = tag.match(/\bsrc="([^"]+)"/)[1];
  assert.ok(!/^(https?:)?\/\//.test(src), 'Bild nicht lokal');
  assert.ok(existsSync(join(root, src)), `Datei fehlt: ${src}`);
  for (const s of (tag.match(/srcset="([^"]+)"/)?.[1] || '').split(',').map((x) => x.trim().split(' ')[0]).filter(Boolean)) {
    assert.ok(existsSync(join(root, s)), `srcset-Datei fehlt: ${s}`);
  }
});

test('Keine toten Anker auf der Startseite', () => {
  const ids = new Set([...index.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const tot = [...index.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]).filter((a) => !ids.has(a));
  assert.deepEqual(tot, [], `tote Anker: ${tot.join(', ')}`);
});

test('Versionszeile und Statushinweis springen nicht (CLS, Entscheidung E24)', () => {
  // Der Statushinweis steht statisch im HTML, nicht per JS eingefügt.
  for (const seite of ['index.html', 'download.html', 'api.html']) {
    assert.match(lesen(seite), /<div class="note warn" data-status-note><strong>Entwurf:<\/strong>/, `${seite}: Statushinweis fehlt im HTML`);
  }
  assert.ok(!/data-status-note/.test(js), 'app.js fasst den Statushinweis an');
  // Die Versionszeile füllt app.js nach dem Laden von downloads.json; ihr Platz ist vorab reserviert.
  assert.match(index, /<p class="version" data-version hidden><\/p>/);
  assert.match(css, /\[data-version\] \{ min-height: 1lh; \}/);
  assert.match(css, /\[data-version\]\[hidden\] \{ display: block !important; visibility: hidden; \}/);
});
