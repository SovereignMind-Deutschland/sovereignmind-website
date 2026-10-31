// Wandelt alle PNG unter assets/screenshots/ in WebP um und löscht die PNG danach.
// Aufruf: node scripts/png-zu-webp.mjs [Qualität=82]
// `sharp` kommt aus dem App-Repo (Admin- oder Kunden-Frontend, node_modules) oder aus dem lokalen node_modules.
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const kandidaten = [
  root,
  resolve(root, '..', 'sovereignmind', 'Admin', 'SovereignMind.Admin.Frontend'),
  resolve(root, '..', 'sovereignmind', 'Customer', 'SovereignMind.Customer.Frontend'),
];
let sharp;
for (const basis of kandidaten) {
  try { sharp = createRequire(join(basis, 'package.json'))('sharp'); break; } catch { /* nächster Kandidat */ }
}
if (!sharp) { console.error('sharp nicht gefunden (npm install im Admin-Frontend ausführen).'); process.exit(1); }

const qualitaet = Number(process.argv[2] ?? 82);
const dir = join(root, 'assets', 'screenshots');
const pngs = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? pngs(join(d, e.name)) : e.name.endsWith('.png') ? [join(d, e.name)] : []);

if (!existsSync(dir)) process.exit(0);
let vorher = 0, nachher = 0;
for (const datei of pngs(dir)) {
  const ziel = datei.replace(/\.png$/, '.webp');
  vorher += statSync(datei).size;
  await sharp(datei).webp({ quality: qualitaet, effort: 6 }).toFile(ziel);
  nachher += statSync(ziel).size;
  unlinkSync(datei);
}
console.log(`WebP: ${(vorher / 1024).toFixed(0)} KiB -> ${(nachher / 1024).toFixed(0)} KiB`);
