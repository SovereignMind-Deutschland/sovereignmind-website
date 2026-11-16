// .well-known/security.txt (RFC 9116, CRA Art. 14): Pflichtfelder, Ablaufdatum, Platzhalter für die Adresse.
// Aufruf: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const text = readFileSync(join(root, '.well-known/security.txt'), 'utf8');
const fields = Object.fromEntries(
  text.split('\n').filter((line) => line && !line.startsWith('#')).map((line) => {
    const at = line.indexOf(':');
    return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
  }),
);
const workflow = readFileSync(join(root, '.github/workflows/pages.yml'), 'utf8');

test('Contact nutzt den Platzhalter der Anbieterdaten, pages.yml setzt ihn ein', () => {
  assert.equal(fields.Contact, 'mailto:{{PROVIDER_EMAIL}}');
  assert.match(workflow, /render-provider\.py [^\n]*_site\/\.well-known\/security\.txt/);
});

test('Expires liegt in der Zukunft und höchstens ein Jahr voraus (RFC 9116, 2.5.5)', () => {
  const expires = Date.parse(fields.Expires);
  assert.ok(!Number.isNaN(expires), 'Expires ist kein gültiges Datum');
  const now = Date.now();
  assert.ok(expires > now, `security.txt ist abgelaufen (${fields.Expires}): Datum erneuern`);
  assert.ok(expires - now <= 366 * 24 * 3600 * 1000, 'Expires liegt mehr als ein Jahr in der Zukunft');
});

test('Preferred-Languages und Canonical sind gesetzt, Canonical zeigt auf die veröffentlichte Datei', () => {
  assert.equal(fields['Preferred-Languages'], 'de, en');
  assert.match(fields.Canonical, /^https:\/\/sovereignmind-deutschland\.github\.io\/sovereignmind-website\/\.well-known\/security\.txt$/);
});

test('SECURITY.md nennt dieselbe Meldeadresse ohne Platzhalter und wird nicht veröffentlicht', () => {
  const security = readFileSync(join(root, 'SECURITY.md'), 'utf8');
  assert.doesNotMatch(security, /\{\{/);
  assert.match(security, /mailto:|@/);
  assert.match(workflow, /--exclude=\.\/SECURITY\.md/);
});
