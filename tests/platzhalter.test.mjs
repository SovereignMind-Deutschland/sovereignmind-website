// Anbieter-Platzhalter ({{PROVIDER_*}}): Das Repo trägt nur Platzhalter, pages.yml setzt sie beim Veröffentlichen ein.
// Der Test baut dieselbe Kopie wie pages.yml (mit Testwerten), setzt ein und prüft, dass in der ganzen Kopie kein "{{" bleibt.
// Aufruf: node --test tests/   (braucht python3 oder python im Pfad)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const workflow = readFileSync(join(root, '.github/workflows/pages.yml'), 'utf8');
const SKIP = new Set(['.git', 'node_modules', '.github', 'scripts', 'tests', 'packages', 'screenshots', 'video']);

function python() {
  for (const cmd of ['python3', 'python']) {
    if (spawnSync(cmd, ['--version']).status === 0) return cmd;
  }
  return null;
}
const PY = python();

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

// Dateien, die pages.yml an render-provider.py übergibt
function renderedFiles() {
  const m = workflow.match(/render-provider\.py\s+([^\n]+)/);
  assert.ok(m, 'pages.yml ruft render-provider.py nicht auf');
  return m[1].trim().split(/\s+/).map((f) => f.replace(/^_site\//, ''));
}

// Veröffentlichte Textdateien (README.md wird in pages.yml ausgeschlossen)
const published = walk(root).filter((f) => /\.(html|css|js|mjs|json|txt|xml|svg|md)$/.test(f) && !f.endsWith('README.md'));
const withPlaceholder = published.filter((f) => readFileSync(f, 'utf8').includes('{{'));

test('Jede Datei mit Platzhalter steht in der render-provider-Liste von pages.yml', () => {
  const listed = new Set(renderedFiles());
  const missing = withPlaceholder.map((f) => relative(root, f).split(sep).join('/')).filter((f) => !listed.has(f));
  assert.deepEqual(missing, [], `Platzhalter ohne Ersetzung in pages.yml: ${missing.join(', ')}`);
});

test('pages.yml prüft die ganze Kopie mit check-platzhalter.py und lässt README.md weg', () => {
  assert.match(workflow, /check-platzhalter\.py --any _site/);
  assert.match(workflow, /--exclude=\.\/README\.md/);
});

test('Nach dem Einsetzen (Testwerte) bleibt in der veröffentlichten Kopie kein "{{" stehen', { skip: !PY && 'kein Python' }, () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sm-site-'));
  try {
    // gleiche Ausschlüsse wie das tar in pages.yml
    const EXCLUDE = new Set(['.git', '.github', 'scripts', 'tests', 'README.md', 'node_modules']);
    const copy = (from, to) => {
      for (const name of readdirSync(from)) {
        if (from === root && EXCLUDE.has(name)) continue;
        const src = join(from, name);
        const dst = join(to, name);
        if (statSync(src).isDirectory()) { mkdirSync(dst, { recursive: true }); copy(src, dst); } else copyFileSync(src, dst);
      }
    };
    copy(root, tmp);
    const files = renderedFiles().map((f) => join(tmp, f));
    const render = spawnSync(PY, [join(root, 'scripts/render-provider.py'), '--test-values', ...files], { encoding: 'utf8' });
    assert.equal(render.status, 0, render.stderr);
    const check = spawnSync(PY, [join(root, 'scripts/check-platzhalter.py'), '--any', tmp], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('Ohne Ersetzung schlägt die Prüfung an (Gegenprobe)', { skip: !PY && 'kein Python' }, () => {
  const check = spawnSync(PY, [join(root, 'scripts/check-platzhalter.py'), '--any', join(root, 'impressum.html')], { encoding: 'utf8' });
  assert.equal(check.status, 1);
});

test('mailto im Kontaktabschnitt der Startseite nutzt den Platzhalter (wird mit ersetzt)', () => {
  assert.match(readFileSync(join(root, 'index.html'), 'utf8'), /mailto:\{\{PROVIDER_EMAIL\}\}/);
  assert.ok(renderedFiles().includes('index.html'));
});
