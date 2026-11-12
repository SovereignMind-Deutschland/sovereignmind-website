// Download-Seite: Einzeiler für Windows und Linux, die Skripte unter stabilen Adressen, downloads.json, Links der Seite.
// Aufruf: node --test tests/   (Node 20+, keine Abhängigkeiten, kein Netz)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const lesen = (f) => readFileSync(join(root, f), 'utf8');
const BASE = 'https://sovereignmind-deutschland.github.io/sovereignmind-website/';
const html = lesen('download.html');

// app.js mit Schein-DOM ausführen: liefert den Text, den renderCommands() je data-cmd setzt
function befehle() {
  const felder = {};
  const element = (key) => (felder[key] ??= { textContent: '' });
  const document = {
    querySelector: (sel) => {
      const m = sel.match(/^\[data-cmd="([^"]+)"\]$/);
      return m ? element(m[1]) : null;
    },
    querySelectorAll: () => [],
    documentElement: { getAttribute: () => null },
  };
  const window = { addEventListener() {}, matchMedia: () => ({ matches: false }) };
  const ctx = { document, window, navigator: { userAgent: 'Test' }, location: { hash: '' }, history: {}, setTimeout, console };
  vm.runInNewContext(lesen('assets/app.js'), ctx);
  const out = {};
  for (const m of html.matchAll(/data-cmd="([^"]+)"/g)) out[m[1]] = element(m[1]).textContent;
  return out;
}

test('Die Skripte liegen im Wurzelordner der Seite', () => {
  const sh = lesen('install.sh');
  const ps1 = lesen('install.ps1');
  assert.match(sh, /^#!\/bin\/sh\n/, 'install.sh: Shebang');
  assert.match(sh, /^main "\$@"$/m, 'install.sh: main in der letzten Zeile (schützt vor abgeschnittenem Download)');
  assert.match(ps1, /Install-SovereignMind/, 'install.ps1: Funktion');
  assert.ok(ps1.trimEnd().split('\n').pop().includes('Install-SovereignMind'), 'install.ps1: Aufruf in der letzten Zeile');
  for (const [f, text] of [['install.sh', sh], ['install.ps1', ps1]]) {
    assert.ok(!/docs\/pläne|Support\//.test(text), `${f}: Verweis auf das Hauptrepo`);
    assert.ok(!text.includes('\r') || f === 'install.ps1', `${f}: Windows-Zeilenenden`);
    assert.ok(!text.startsWith('﻿'), `${f}: BOM`);
  }
});

test('Die Skripte gleichen den Quellen im Hauptprojekt (falls daneben ausgecheckt)', (t) => {
  for (const f of ['install.sh', 'install.ps1']) {
    const quelle = join(root, '..', 'sovereignmind', 'Support', 'installer', 'online', f);
    if (!existsSync(quelle)) return t.skip('Hauptprojekt nicht neben der Seite ausgecheckt');
    const erwartet = readFileSync(quelle, 'utf8').split('\n').filter((z) => !z.includes('docs/pläne/')).join('\n');
    assert.equal(lesen(f), erwartet, `${f} ist veraltet: Support/scripts/sync-website-install.sh ausführen`);
  }
});

test('Einzeiler: Windows irm | iex, Linux curl | sh, mit Adresse der Skripte', () => {
  const b = befehle();
  assert.equal(b.windows, `irm ${BASE}install.ps1 | iex`);
  assert.equal(b.linux, `curl -fsSL ${BASE}install.sh | sh`);
  assert.equal(b['windows-lesen'], `irm ${BASE}install.ps1`);
  assert.equal(b['linux-lesen'], `curl -fsSL ${BASE}install.sh`);
  assert.match(b['windows-eigenes-frontend'], /SM_SETUP_ARGS[\s\S]*install\.ps1 \| iex/);
  assert.match(b['linux-eigenes-frontend'], /\| SM_BUNDLE_ARGS="[^"]+" sh$/);
});

test('Jede data-cmd-Stelle und jeder Kopieren-Knopf hat einen Befehl', () => {
  const b = befehle();
  const copy = [...html.matchAll(/data-copy="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(copy.length >= 8, 'zu wenige Kopieren-Knöpfe');
  for (const k of Object.keys(b)) assert.ok(b[k].trim(), `data-cmd="${k}" bleibt leer`);
  for (const k of copy) assert.ok(k in b, `data-copy="${k}" ohne data-cmd`);
});

test('Im Windows- und im Linux-Reiter steht der Einzeiler vor allen anderen Befehlen', () => {
  for (const os of ['windows', 'linux']) {
    const panel = html.match(new RegExp(`<div class="panel"[^>]*id="panel-${os}"[\\s\\S]*?(?=<!-- |<h2 id="demo")`))[0];
    const erster = panel.match(/data-cmd="([^"]+)"/)[1];
    assert.equal(erster, os, `${os}: erster Befehl ist ${erster}`);
    assert.match(panel, /Skript vorab lesen/, `${os}: Hinweis, dass sich das Skript lesen lässt`);
    assert.match(panel, /Ohne Skript: Dateien aus dem Release/, `${os}: manuelle Variante`);
    assert.match(panel, /<details>[\s\S]*?Ohne Skript/, `${os}: manuelle Variante eingeklappt`);
  }
});

test('Der Drive-Link ist für das volle Paket benannt, alte Attribute sind weg', () => {
  assert.ok(!/data-release(?![-\w])/.test(html), 'altes Attribut data-release');
  assert.ok(!/data-download-missing/.test(html), 'altes Attribut data-download-missing');
  const drive = [...html.matchAll(/<a [^>]*data-drive[^>]*>([^<]*)<\/a>/g)];
  assert.ok(drive.length >= 3, 'Drive-Links fehlen');
  for (const m of drive) assert.match(m[1], /Volle[rs]? (Paket|Installer|Bundle)/, `Drive-Link nicht als volles Paket benannt: ${m[1]}`);
  assert.ok(!/<a [^>]*data-drive[^>]*>(?![^<]*Volle)/.test(html), 'Drive-Link ohne "Volle…"');
  assert.match(html, /data-drive-missing/);
  assert.match(html, /data-release-url/);
});

test('downloads.json: Felder version, releaseTag, releaseUrl, driveFolderUrl; Links nur https', () => {
  const d = JSON.parse(lesen('assets/downloads.json'));
  for (const k of ['version', 'releaseTag', 'releaseUrl', 'driveFolderUrl']) assert.equal(typeof d[k], 'string', `${k} fehlt`);
  for (const k of ['releaseUrl', 'driveFolderUrl']) assert.ok(d[k] === '' || /^https:\/\//.test(d[k]), `${k} muss mit https:// beginnen`);
  if (d.releaseTag) assert.equal(d.releaseTag, 'v' + d.version, 'releaseTag passt nicht zu version');
  if (d.releaseUrl) assert.match(d.releaseUrl, /github\.com\/sovereignmind-deutschland\/sovereignmind-installer\/releases/i);
});

test('Links der Download-Seite sind gültig: Anker, lokale Dateien, Skripte', () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/<a [^>]*\bhref="([^"]*)"/g)) {
    const h = m[1];
    if (h === '#' || /^(https?:|mailto:)/.test(h)) continue;
    const [datei, anker] = h.split('#');
    if (!datei) assert.ok(ids.has(anker), `Anker #${anker} existiert nicht`);
    else {
      assert.ok(existsSync(join(root, datei)), `Datei ${datei} fehlt`);
      if (anker && datei.endsWith('.html')) assert.ok(new RegExp(`id="${anker}"`).test(lesen(datei)), `${datei}#${anker} existiert nicht`);
    }
  }
  // Doppelte IDs
  const alle = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(alle.length, ids.size, 'doppelte id');
});

test('Metadaten und llms.txt nennen den Einzeiler; Titel und Beschreibung stimmen überein', () => {
  const meta = (attr, name) => html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`))[1];
  const d = meta('name', 'description');
  assert.match(d, /ein Befehl/);
  assert.equal(meta('property', 'og:description'), d);
  assert.equal(meta('name', 'twitter:description'), d);
  const llms = lesen('llms.txt');
  assert.match(llms, /install\.ps1/);
  assert.match(llms, /install\.sh/);
});

test('Die Seite kündigt nichts an, was die Skripte nicht tun: keine Zustimmung zur EULA, Prüfsumme genannt', () => {
  assert.match(html, /stimmt nie für Sie zu/);
  assert.match(html, /SHA256SUMS\.txt/);
  assert.ok(!/[–—]/.test(html.replace(/<title>.*?<\/title>/, '').replace(/<meta [^>]*>/g, '').replace(/"name": "[^"]*"/g, '')), 'Gedankenstrich im Text');
});

test('Deploy: pages.yml schließt die Skripte nicht aus', () => {
  const y = lesen('.github/workflows/pages.yml');
  assert.ok(!/--exclude=\.\/install/.test(y), 'install.* wird vom Deploy ausgeschlossen');
});
