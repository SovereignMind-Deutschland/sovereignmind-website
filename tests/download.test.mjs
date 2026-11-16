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
    let erwartet = readFileSync(quelle, 'utf8').split('\n').filter((z) => !z.includes('docs/pläne/')).join('\n');
    if (f === 'install.ps1') {
      // wie sync-website-install.sh: kein BOM, nur ASCII (Windows PowerShell 5.1 liest "irm | iex" ohne charset als Latin-1)
      erwartet = erwartet.replace(/^﻿/, '').replace('SovereignMind öffnen.url', 'SovereignMind $([char]0xF6)ffnen.url');
      for (const [a, b] of [['ä', 'ae'], ['ö', 'oe'], ['ü', 'ue'], ['Ä', 'Ae'], ['Ö', 'Oe'], ['Ü', 'Ue'], ['ß', 'ss'], ['…', '...'], ['–', '-'], ['—', '-']]) erwartet = erwartet.replaceAll(a, b);
    }
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

test('Kein Drive-Link, kein volles Paket, alte Attribute sind weg', () => {
  assert.ok(!/data-release(?![-w])/.test(html), 'altes Attribut data-release');
  assert.ok(!/data-download-missing/.test(html), 'altes Attribut data-download-missing');
  assert.ok(!/data-drive/.test(html), 'Drive-Link auf der Seite');
  assert.ok(!/drive.google|Google Drive|Setup-Full|installer-full/i.test(html), 'Verweis auf das volle Paket oder Google Drive');
  assert.match(html, /data-release-url/);
});

test('minisign: Schlüssel der Seite gleich dem in install.sh und install.ps1 (leer, solange dort der Platzhalter steht)', () => {
  const seite = (lesen('assets/app.js').match(/var MINISIGN_PUBKEY = '([^']*)';/) || [])[1];
  assert.notEqual(seite, undefined, 'MINISIGN_PUBKEY fehlt in assets/app.js');
  const sh = (lesen('install.sh').match(/^MINISIGN_PUBKEY="\$\{SM_MINISIGN_PUBKEY:-([^}]*)\}"$/m) || [])[1];
  const ps1 = (lesen('install.ps1').match(/\$minisignPubKey = if \(\$env:SM_MINISIGN_PUBKEY\) \{ \$env:SM_MINISIGN_PUBKEY \} else \{ "([^"]*)" \}/) || [])[1];
  assert.ok(sh && ps1, 'Schlüssel in install.sh bzw. install.ps1 nicht gefunden');
  assert.equal(sh, ps1, 'install.sh und install.ps1 haben verschiedene Schlüssel');
  if (sh.startsWith('PLATZHALTER')) assert.equal(seite, '', 'Seite nennt einen Schlüssel, die Skripte noch den Platzhalter');
  else assert.equal(seite, sh, 'Schlüssel der Seite weicht von den Skripten ab');
  assert.ok(/data-minisign-missing/.test(html) && /data-cmd="signatur-linux"/.test(html), 'Abschnitt zur Signatur fehlt');
});
