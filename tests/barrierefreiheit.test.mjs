// Barrierefreiheit der Seiten, statisch geprüft (Plan skills-nutzen-abschluss 4.3 bis 4.5). Aufruf: node --test tests/
// Sprunglink (WCAG 2.4.1), Textalternativen (1.1.1, leeres alt nur für bewusst dekorative Bilder), Untertitel des
// Demo-Videos (1.2.2, alle Sprechsätze).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const lesen = (f) => readFileSync(join(root, f), 'utf8');
// Die Präsentation (praesentation/) beginnt mit <main> und hat keine Navigation davor; ein Sprunglink hätte nichts zu überspringen.
const SEITEN = readdirSync(root).filter((f) => f.endsWith('.html'));

test('Jede Seite beginnt mit dem Sprunglink auf <main id="main">', () => {
  assert.ok(SEITEN.length >= 9, `nur ${SEITEN.length} Seiten gefunden`);
  for (const f of SEITEN) {
    const html = lesen(f);
    const body = html.slice(html.indexOf('<body'));
    const erstesElement = body.slice(body.indexOf('>') + 1).trimStart();
    assert.match(erstesElement, /^<a class="skip" href="#main">Zum Inhalt<\/a>/, `${f}: Sprunglink fehlt oder steht nicht am Anfang`);
    assert.match(html, /<main id="main"[\s>]/, `${f}: <main id="main"> fehlt`);
  }
});

/** Leeres alt nur, wo das Bild nichts Eigenes sagt: Logo neben dem Text im Markenlink, Platzhalter der Lightbox
 * (alt kommt per Skript aus der Galerie), Logo neben dem Namen im Abspann der Präsentation. */
function dekorativ(tag, kontext) {
  if (/data-lb-img/.test(tag)) return true;
  if (/logo\.svg/.test(tag) && /SovereignMind/.test(kontext)) return true;
  return false;
}

test('Jedes Bild hat ein alt; leer nur bei dekorativen Bildern', () => {
  for (const f of [...SEITEN, 'praesentation/index.html']) {
    const html = lesen(f);
    for (const m of html.matchAll(/<img\b[^>]*>/g)) {
      const tag = m[0];
      assert.match(tag, /\balt="/, `${f}: <img> ohne alt: ${tag}`);
      if (/\balt=""/.test(tag)) {
        const kontext = html.slice(m.index - 120, m.index + tag.length + 120);
        assert.ok(dekorativ(tag, kontext), `${f}: leeres alt bei einem Bild mit Inhalt: ${tag}`);
      }
    }
  }
});

test('Hell- und Dunkelvariante der Architekturgrafik haben dieselbe Beschreibung', () => {
  const html = lesen('on-premise-ki.html');
  const hell = html.match(/architektur-hell\.svg" alt="([^"]+)"/)?.[1];
  const dunkel = html.match(/architektur-dunkel\.svg" alt="([^"]+)"/)?.[1];
  assert.ok(hell, 'helle Variante ohne alt');
  assert.equal(dunkel, hell);
});

test('Demo-Video: deutsche Untertitel mit allen Sprechsätzen', () => {
  const html = lesen('index.html');
  assert.match(html, /<track kind="subtitles" src="assets\/video\/sovereignmind-demo\.de\.vtt" srclang="de" label="Deutsch" default>/);
  const vtt = lesen('assets/video/sovereignmind-demo.de.vtt');
  assert.match(vtt, /^WEBVTT\n/);
  const cues = [...vtt.matchAll(/(\d\d):(\d\d):(\d\d)\.(\d{3}) --> (\d\d):(\d\d):(\d\d)\.(\d{3})\n(.+)/g)];
  // Das Video hat gesprochene Erklärungen (104 Sätze); 10 Kernsätze allein wären zu wenig (Stand vor 2026-11-16).
  assert.ok(cues.length >= 100, `nur ${cues.length} Untertitel`);
  const sek = (h, m, s, ms) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
  let ende = 0;
  for (const c of cues) {
    const von = sek(c[1], c[2], c[3], c[4]);
    const bis = sek(c[5], c[6], c[7], c[8]);
    assert.ok(bis > von, `Untertitel endet vor dem Anfang: ${c[0]}`);
    assert.ok(von >= ende - 0.001, `Untertitel überlappen: ${c[0]}`);
    assert.ok(c[9].trim().length > 0, 'leerer Untertitel');
    ende = bis;
  }
  assert.ok(ende < 11 * 60, 'Untertitel reichen über das Video hinaus (rund 11 Minuten)');
});
