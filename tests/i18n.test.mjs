// Sprachumschalter und englische Seiten (Plan website-stil-animationen, Phase 2). Aufruf: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, EN_PAGES, SWITCH_PAGES, erzeugeEn, ladeMap, pflegeDeutsch, seiteUrl, sitemap } from '../scripts/build-i18n.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const lesen = (f) => readFileSync(join(root, f), 'utf8');
const map = ladeMap(lesen('i18n/en.txt'));

test('en/ ist aktuell: erzeugt aus den deutschen Seiten und i18n/en.txt, keine Lücken (node scripts/build-i18n.mjs)', () => {
  const fehlend = new Set();
  for (const page of EN_PAGES) {
    const de = pflegeDeutsch(page, lesen(page));
    assert.equal(lesen(page), de, `${page}: Umschalter/hreflang nicht aktuell`);
    assert.equal(lesen('en/' + page), erzeugeEn(page, de, map, fehlend), `en/${page} nicht aktuell`);
  }
  assert.deepEqual([...fehlend], [], 'deutsche Texte ohne Übersetzung in i18n/en.txt');
  assert.equal(lesen('sitemap.xml'), sitemap(), 'sitemap.xml nicht aktuell');
  assert.deepEqual(readdirSync(join(root, 'en')).sort(), [...EN_PAGES].sort(), 'en/ enthält fremde Dateien');
});

test('Jede englische Seite: lang, Canonical, hreflang in beide Richtungen, og:locale, Sprunglink', () => {
  for (const page of EN_PAGES) {
    const en = lesen('en/' + page), de = lesen(page);
    assert.match(en, /<html lang="en" data-root="\.\.\/">/, page);
    assert.match(de, /<html lang="de">/, page);
    assert.ok(en.includes(`<link rel="canonical" href="${seiteUrl(page, 'en')}">`), `${page}: Canonical en`);
    assert.ok(de.includes(`<link rel="canonical" href="${seiteUrl(page, 'de')}">`), `${page}: Canonical de`);
    for (const html of [en, de]) {
      assert.ok(html.includes(`<link rel="alternate" hreflang="de" href="${seiteUrl(page, 'de')}">`), `${page}: hreflang de`);
      assert.ok(html.includes(`<link rel="alternate" hreflang="en" href="${seiteUrl(page, 'en')}">`), `${page}: hreflang en`);
      assert.ok(html.includes(`<link rel="alternate" hreflang="x-default" href="${seiteUrl(page, 'de')}">`), `${page}: x-default`);
    }
    assert.match(en, /property="og:locale" content="en_US"/, page);
    assert.match(en, new RegExp(`property="og:url" content="${seiteUrl(page, 'en')}"`), page);
    assert.match(en, /<body>\s*<a class="skip" href="#main">Skip to content<\/a>/, page);
    assert.match(en, /<main id="main"/, page);
    // Titel und Beschreibung sind übersetzt und eigenständig
    if (page !== 'api.html') assert.notEqual(en.match(/<title>(.*?)<\/title>/)[1], de.match(/<title>(.*?)<\/title>/)[1], `${page}: Titel nicht übersetzt`);
    assert.match(en, /"inLanguage": "en"|<script type="application\/ld\+json">[\s\S]*"BreadcrumbList"/, page);
  }
});

test('Sprachumschalter: auf jeder Seite DE | EN, aktive Sprache mit aria-current, Ziel ist dieselbe Seite oder EN ausgegraut', () => {
  for (const page of SWITCH_PAGES) {
    const de = lesen(page);
    const sw = de.match(/<!--lang-switch-->(<div class="lang-switch"[\s\S]*?<\/div>)<!--\/lang-switch-->/)?.[1];
    assert.ok(sw, `${page}: Umschalter fehlt`);
    assert.match(sw, /<a lang="de" hreflang="de" href="[^"]+" aria-current="true" title="Deutsch">DE<\/a>/, page);
    if (EN_PAGES.includes(page)) {
      const ziel = sw.match(/<a lang="en" hreflang="en" href="([^"]+)"/)[1];
      assert.equal(ziel, 'en/' + page, `${page}: Ziel EN`);
      assert.ok(existsSync(join(root, ziel)), `${page}: ${ziel} fehlt`);
    } else {
      assert.match(sw, /<span lang="en" class="lang-off" aria-disabled="true" title="Only available in German">EN<\/span>/, `${page}: EN nicht ausgegraut`);
      assert.ok(!/<a lang="en"/.test(sw), `${page}: EN darf kein Link sein`);
    }
    // innerhalb der Navigation, nicht im Footer
    assert.ok(/<nav class="main"[\s\S]*lang-switch[\s\S]*<\/nav>/.test(de), `${page}: Umschalter nicht in der Navigation`);
  }
  for (const page of EN_PAGES) {
    const en = lesen('en/' + page);
    assert.match(en, /<a lang="en" hreflang="en" href="[^"]+" aria-current="true" title="English">EN<\/a>/, page);
    assert.ok(en.includes(`<a lang="de" hreflang="de" href="../${page}" title="Deutsch">DE</a>`), `${page}: Ziel DE`);
    assert.match(en, /role="group" aria-label="Language"/, page);
  }
});

test('Keine Zwangsumleitung, keine Cookies, keine Browsersprach-Abfrage', () => {
  for (const f of ['assets/theme.js', 'assets/app.js', 'assets/demo.js', 'assets/vergleich.js']) {
    const js = lesen(f);
    assert.ok(!/navigator\.language|navigator\.languages|document\.cookie|location\.(replace|assign)|location\.href\s*=/.test(js), `${f}: Umleitung/Cookie/Sprachabfrage`);
  }
});

/** Löst href/src/srcset einer englischen Seite relativ zu en/ auf und prüft, ob das Ziel existiert. */
function ziele(html) {
  const out = [];
  for (const m of html.matchAll(/\s(?:href|src|poster)="([^"]*)"/g)) out.push(m[1]);
  for (const m of html.matchAll(/\ssrcset="([^"]*)"/g)) for (const s of m[1].split(',')) out.push(s.trim().split(/\s+/)[0]);
  return out;
}

test('Englische Seiten: jeder relative Link und jedes Bild/Skript/Stil zeigt auf eine vorhandene Datei', () => {
  for (const page of EN_PAGES) {
    for (const z of ziele(lesen('en/' + page))) {
      if (!z || /^(#|[a-z][a-z0-9+.-]*:|\/\/|\{\{)/i.test(z)) continue;
      const pfad = z.split('#')[0].split('?')[0];
      if (!pfad) continue;
      const abs = normalize(join(root, 'en', pfad));
      assert.ok(abs.startsWith(root), `en/${page}: ${z} verlässt die Seite`);
      assert.ok(existsSync(abs), `en/${page}: ${z} existiert nicht`);
    }
  }
});

test('Englische Seiten: Verweise auf Seiten mit englischer Fassung bleiben in en/, sonst geht es zur deutschen Seite', () => {
  for (const page of EN_PAGES) {
    const html = lesen('en/' + page);
    for (const z of ziele(html)) {
      const m = /^(?:\.\.\/)?([a-z-]+\.html)(?:#.*)?$/.exec(z);
      if (!m || z.startsWith('http')) continue;
      if (/hreflang|lang-switch/.test(z)) continue;
      const hatEn = EN_PAGES.includes(m[1]);
      if (['impressum.html', 'datenschutz.html', 'wissenspakete.html'].includes(m[1])) assert.ok(z.startsWith('../'), `en/${page}: ${z} muss zur deutschen Seite führen`);
      else if (hatEn && !z.startsWith('../')) continue;
    }
  }
  // Rechtstexte sind als deutsch gekennzeichnet
  const idx = lesen('en/index.html');
  assert.match(idx, /<a href="\.\.\/impressum\.html" hreflang="de" lang="de">Legal notice \(German\)<\/a>/);
  assert.match(idx, /<a href="\.\.\/datenschutz\.html" hreflang="de" lang="de">Privacy \(German\)<\/a>/);
});

test('Englische Seiten enthalten keinen deutschen Fließtext (außer als lang="de" gekennzeichnet) und behalten die Platzhalter', () => {
  const DEUTSCH = /\b(und|nicht|für|oder|werden|wird|Sie|Ihre|Ihr|der|das|ist|mit|auf|eine|einen|wenn)\b/;
  for (const page of EN_PAGES) {
    const html = lesen('en/' + page);
    const text = html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>|<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]*\blang="de"[^>]*>[\s\S]*?<\/\w+>/g, ' ')
      .replace(/<[^>]+>/g, ' ');
    const treffer = text.match(new RegExp(`.{0,30}${DEUTSCH.source}.{0,30}`, 'g')) || [];
    // Englische Wörter, die zufällig gleich lauten ("die" kommt nicht vor; "Sie"/"Ihre" sind eindeutig deutsch)
    assert.deepEqual(treffer.filter((t) => /\b(und|nicht|für|oder|werden|wird|Sie|Ihre|Ihr|eine|einen|wenn|der|das)\b/.test(t)), [], `en/${page}: deutscher Text`);
  }
  assert.match(lesen('en/index.html'), /\{\{PROVIDER_EMAIL\}\}/);
  assert.match(lesen('en/index.html'), /"name": "\{\{PROVIDER_NAME\}\}"/);
});

test('Übersetzungstabelle: keine leeren Einträge, Platzhalter und Links bleiben erhalten', () => {
  for (const [de, en] of Object.entries(map)) {
    assert.ok(en.length > 0, `leer: ${de.slice(0, 50)}`);
    for (const p of de.match(/\{\{[A-Z_]+\}\}/g) || []) assert.ok(en.includes(p), `Platzhalter ${p} fehlt: ${en.slice(0, 50)}`);
    const hrefDe = (de.match(/href="[^"]*"/g) || []).sort();
    const hrefEn = (en.match(/href="[^"]*"/g) || []).sort();
    assert.deepEqual(hrefEn, hrefDe, `Links weichen ab: ${de.slice(0, 60)}`);
    const tagsDe = (de.match(/<\/?(a|em|strong|code|span|input|source|track|b)\b/g) || []).sort();
    const tagsEn = (en.match(/<\/?(a|em|strong|code|span|input|source|track|b)\b/g) || []).sort();
    assert.deepEqual(tagsEn, tagsDe, `Markup weicht ab: ${de.slice(0, 60)}`);
  }
});

test('Skripte: Wurzelpfad und Sprache kommen aus theme.js (window.SM), englische Texte sind vorhanden', () => {
  const theme = lesen('assets/theme.js');
  assert.match(theme, /window\.SM = \{[\s\S]*root: root\.getAttribute\('data-root'\)/);
  for (const f of ['assets/app.js', 'assets/demo.js', 'assets/vergleich.js', 'assets/api-doku.js']) assert.match(lesen(f), /SM\.root|SM\.t\(|SM\.en|window\.SM/, f);
  const k = JSON.parse(lesen('assets/kosten.json'));
  for (const a of [...k.anbieter, k.azure_selbstbau]) assert.ok(a.typ_en, `kosten.json: typ_en fehlt bei ${a.typ}`);
  for (const q of k.quellen) assert.ok(q.text_en, `kosten.json: text_en fehlt bei ${q.id}`);
  assert.match(lesen('assets/demo.js'), /var DATA = SM\.en \? DATA_EN : DATA_DE;/);
});

test('Sitemap nennt beide Sprachen mit hreflang-Alternativen; llms.txt hat einen englischen Abschnitt', () => {
  const sm = lesen('sitemap.xml');
  for (const p of EN_PAGES) {
    assert.ok(sm.includes(`<loc>${seiteUrl(p, 'en')}</loc>`), `Sitemap: ${p} en`);
    assert.ok(sm.includes(`<xhtml:link rel="alternate" hreflang="en" href="${seiteUrl(p, 'en')}"/>`), `Sitemap: Alternative ${p}`);
  }
  assert.ok(!sm.includes(BASE + 'en/wissenspakete.html'));
  assert.match(lesen('llms.txt'), /^## English$/m);
});

test('pages.yml: en/ wird veröffentlicht, i18n/ nicht, Platzhalter von en/index.html werden eingesetzt', () => {
  const wf = lesen('.github/workflows/pages.yml');
  assert.match(wf, /--exclude=\.\/i18n/);
  assert.match(wf, /_site\/en\/index\.html/);
  assert.ok(!/--exclude=\.\/en\b/.test(wf));
});
