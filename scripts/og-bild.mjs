// Erzeugt assets/og-image.png (1200x630, Vorschaubild für Open Graph und Twitter-Karte) aus dem Logo, ohne externe Quellen.
// Aufruf: node scripts/og-bild.mjs
// `sharp` kommt wie bei png-zu-webp.mjs aus dem App-Repo oder aus dem lokalen node_modules.
import { readFileSync } from 'node:fs';
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
for (const dir of kandidaten) {
  try { sharp = createRequire(join(dir, 'package.json'))('sharp'); break; } catch { /* nächster Kandidat */ }
}
if (!sharp) { console.error('sharp nicht gefunden (npm install im Admin- oder Kunden-Frontend).'); process.exit(1); }

const logo = Buffer.from(readFileSync(join(root, 'assets/logo.svg'))).toString('base64');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0b1320"/>
  <rect x="0" y="618" width="1200" height="12" fill="#2dd4bf"/>
  <image x="90" y="150" width="150" height="150" href="data:image/svg+xml;base64,${logo}"/>
  <text x="270" y="250" font-family="Segoe UI, Arial, sans-serif" font-size="68" font-weight="700" fill="#eaf0f8">SovereignMind</text>
  <text x="90" y="400" font-family="Segoe UI, Arial, sans-serif" font-size="46" font-weight="600" fill="#eaf0f8">Der KI-Assistent, der Ihre Daten</text>
  <text x="90" y="460" font-family="Segoe UI, Arial, sans-serif" font-size="46" font-weight="600" fill="#2dd4bf">nie verlässt.</text>
  <text x="90" y="550" font-family="Segoe UI, Arial, sans-serif" font-size="30" fill="#9fb0c6">On-Premise für den DACH-Mittelstand · Demo zum Ausprobieren</text>
</svg>`;
await sharp(Buffer.from(svg)).png().toFile(join(root, 'assets/og-image.png'));
console.log('assets/og-image.png geschrieben');
