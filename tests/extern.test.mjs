// Keine externe Schrift-, Stil- oder Skript-URL in HTML und CSS: Das Produkt wirbt mit "keine Verbindungen nach außen",
// die Website lädt deshalb nichts von fremden Servern nach (Schriften liegen in assets/fonts/). Aufruf: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['.git', 'node_modules', 'packages', 'screenshots']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(html|css)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(root);
const EXTERN = /^(https?:)?\/\//i;

test('Es gibt HTML- und CSS-Dateien zu prüfen', () => {
  assert.ok(files.some((f) => f.endsWith('index.html')));
  assert.ok(files.some((f) => f.endsWith('style.css')));
});

test('HTML: kein <script src>, <link href> oder <img/source src> auf fremde Server', () => {
  for (const f of files.filter((x) => x.endsWith('.html'))) {
    const html = readFileSync(f, 'utf8');
    for (const m of html.matchAll(/<(script|link|source|img|iframe)\b[^>]*\b(?:src|href|srcset)\s*=\s*["']([^"']+)["']/gi)) {
      assert.ok(!EXTERN.test(m[2].trim()), `${f}: externe URL in <${m[1]}>: ${m[2]}`);
    }
  }
});

test('CSS: kein @import und kein url() auf fremde Server', () => {
  for (const f of files.filter((x) => x.endsWith('.css'))) {
    const css = readFileSync(f, 'utf8');
    assert.ok(!/@import\s+(url\()?\s*["']?(https?:)?\/\//i.test(css), `${f}: @import auf fremde URL`);
    for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
      assert.ok(!EXTERN.test(m[1].trim()), `${f}: externe URL: ${m[1]}`);
    }
  }
});

test('Schriften liegen lokal und sind per @font-face eingebunden', () => {
  const css = readFileSync(join(root, 'assets/style.css'), 'utf8');
  assert.match(css, /@font-face[^}]*fonts\/FamiljenGrotesk-latin\.woff2/);
  assert.match(css, /@font-face[^}]*fonts\/PublicSans-latin\.woff2/);
});
