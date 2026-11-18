// Plan website-stil-animationen, Phase 3: Kontrast der Farbmarken, aria-current in der Navigation (auch en/),
// Fokus sichtbar, Verhalten von theme.js/app.js im Schein-DOM (Kopfzeile, Zähler, "Bewegung reduzieren"). Aufruf: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const lesen = (f) => readFileSync(join(root, f), 'utf8');
const css = lesen('assets/style.css');

// ---- Kontrast (WCAG 1.4.3, 4,5:1 für normalen Text) ----
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const kontrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const tokens = (block) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2]]));
const hell = tokens(css.slice(css.indexOf(':root {'), css.indexOf(':root[data-theme="light"]')));
const dunkel = tokens(css.slice(css.indexOf(':root[data-theme="dark"]'), css.indexOf('@media (prefers-color-scheme: dark)')));
const farben = tokens(css.slice(0, css.indexOf('}', css.indexOf('--teal-300'))));

test('Kontrast: Text, Links und Hauptknopf erreichen 4,5:1 in Hell und Dunkel', () => {
  for (const [name, t] of [['hell', { ...farben, ...hell }], ['dunkel', { ...farben, ...dunkel }]]) {
    for (const [fg, bg] of [['text', 'bg'], ['text', 'surface'], ['muted', 'bg'], ['muted', 'surface'], ['accent-hi', 'bg'], ['accent-text', 'primary']]) {
      assert.ok(t[fg] && t[bg], `${name}: Token ${fg}/${bg} fehlt`);
      assert.ok(kontrast(t[fg], t[bg]) >= 4.5, `${name}: ${fg} auf ${bg} nur ${kontrast(t[fg], t[bg]).toFixed(2)}:1`);
    }
  }
});

test('Kontrast: Kopfzeile (immer dunkel) und gefüllte Pillen-Navigation', () => {
  const t = farben;
  assert.ok(kontrast('#e6ebf2', t['ink-900']) >= 4.5, 'Kopfzeilentext auf Tinte');
  assert.ok(kontrast(t['ink-950'], t['teal-400']) >= 4.5, 'aktiver/Hover-Link der Pille');
  assert.ok(kontrast(t['ink-950'], t['teal-300']) >= 4.5, 'Download-Knopf der Pille');
  assert.ok(kontrast('#ffffff', t['ink-900']) >= 4.5, 'aktiver Link im mobilen Menü');
});

// ---- aria-current und Fokus ----
const SEITEN = [
  ...readdirSync(root).filter((f) => f.endsWith('.html')),
  ...(existsSync(join(root, 'en')) ? readdirSync(join(root, 'en')).filter((f) => f.endsWith('.html')).map((f) => 'en/' + f) : []),
].filter((f) => !/404\.html$/.test(f));

test('Navigation: höchstens ein aria-current="page" je Seite, gesetzte Seite verweist auf sich selbst (auch en/)', () => {
  assert.ok(SEITEN.some((f) => f.startsWith('en/')), 'keine englischen Seiten gefunden');
  for (const f of SEITEN) {
    const nav = lesen(f).match(/<nav class="main"[\s\S]*?<\/nav>/);
    assert.ok(nav, `${f}: keine Navigation`);
    const aktiv = [...nav[0].matchAll(/<a\b[^>]*aria-current="page"[^>]*>/g)].map((m) => m[0]);
    assert.ok(aktiv.length <= 1, `${f}: ${aktiv.length} Einträge mit aria-current="page"`);
    const datei = f.split('/').pop();
    for (const a of aktiv) {
      const href = a.match(/href="([^"]*)"/)[1].replace(/^\.\//, '');
      assert.ok(href === datei || (datei === 'index.html' && /^(|\.\/|index\.html|\/)$/.test(href)), `${f}: aktiver Link zeigt auf ${href}`);
    }
  }
});

test('Fokus bleibt sichtbar: kein outline:none ohne Ersatz, :focus-visible im Stil', () => {
  assert.match(css, /:focus-visible/);
  for (const m of css.matchAll(/([^{}]+)\{[^{}]*outline:\s*(none|0)\b[^{}]*\}/g)) {
    assert.match(m[0], /box-shadow|border|outline-offset|:focus:not\(:focus-visible\)/, `outline entfernt ohne Ersatz: ${m[1].trim()}`);
  }
});

// ---- Schein-DOM ----
function element(extra = {}) {
  const cls = new Set();
  const attrs = {};
  const el = {
    style: {}, children: [], dataset: {}, textContent: '', ...extra,
    classList: { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), contains: (c) => cls.has(c), toggle: (c, f) => (f === undefined ? !cls.has(c) : f) ? (cls.add(c), true) : (cls.delete(c), false) },
    getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); }, hasAttribute: (k) => k in attrs,
    removeAttribute: (k) => { delete attrs[k]; }, toggleAttribute(k, f) { if (f === undefined ? !(k in attrs) : f) attrs[k] = ''; else delete attrs[k]; },
    addEventListener() {}, removeEventListener() {}, appendChild(c) { el.children.push(c); return c; }, insertBefore(c) { el.children.unshift(c); return c; },
    querySelector: () => null, querySelectorAll: () => [], closest: () => null, focus() {}, getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0 }),
    attrs, cls,
  };
  return el;
}

function umgebung({ reduziert, extra = {} }) {
  const beobachter = [];
  const doc = {
    documentElement: element(), body: element(), listeners: {},
    createElement: () => element(),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    fonts: { ready: Promise.resolve() }, ...extra,
  };
  const win = {
    matchMedia: (q) => ({ matches: reduziert && /reduce/.test(q), addEventListener() {}, addListener() {} }),
    IntersectionObserver: class { constructor(cb) { this.cb = cb; beobachter.push(this); } observe() {} unobserve() {} disconnect() {} },
    addEventListener() {}, requestAnimationFrame: () => 0, location: { hash: '', pathname: '/' }, scrollTo() {},
    localStorage: { getItem: () => null, setItem() {} }, navigator: { clipboard: {} }, innerHeight: 800, getComputedStyle: () => ({}),
  };
  win.window = win; win.document = doc; win.IntersectionObserver.prototype.constructor = win.IntersectionObserver;
  const ctx = vm.createContext({ ...win, window: win, document: doc, localStorage: win.localStorage, navigator: win.navigator, matchMedia: win.matchMedia, IntersectionObserver: win.IntersectionObserver, console, setTimeout, clearTimeout, requestAnimationFrame: win.requestAnimationFrame, location: win.location, getComputedStyle: win.getComputedStyle });
  ctx.window = ctx; // window und globaler Namensraum sind dasselbe Objekt (SM wird als globale Variable gelesen)
  return { ctx, doc, beobachter, win };
}

test('theme.js im Schein-DOM: Kopfzeile bekommt data-scrolled, sobald der Wächter aus dem Bild ist', () => {
  const kopf = element();
  const nav = element({ querySelector: () => null });
  const { ctx, doc, beobachter } = umgebung({ reduziert: false, extra: { querySelector: (s) => (s === 'header.site' ? kopf : s === 'nav.main' ? nav : null) } });
  vm.runInContext(lesen('assets/theme.js'), ctx);
  doc.listeners.DOMContentLoaded.forEach((f) => f());
  assert.equal(beobachter.length, 1, 'ein Beobachter für den Wächter');
  beobachter[0].cb([{ isIntersecting: false }]);
  assert.ok(kopf.hasAttribute('data-scrolled'), 'gescrollt: data-scrolled fehlt');
  beobachter[0].cb([{ isIntersecting: true }]);
  assert.ok(!kopf.hasAttribute('data-scrolled'), 'oben: data-scrolled bleibt');
});

test('theme.js im Schein-DOM: window.SM kennt Sprache und Wurzelpfad (de und en)', () => {
  for (const [lang, root_, en] of [['de', '', false], ['en', '../', true]]) {
    const { ctx, doc } = umgebung({ reduziert: false });
    doc.documentElement.setAttribute('lang', lang); if (root_) doc.documentElement.setAttribute('data-root', root_);
    vm.runInContext(lesen('assets/theme.js'), ctx);
    const SM = ctx.window.SM;
    assert.equal(SM.en, en); assert.equal(SM.root, root_); assert.equal(SM.t('Hallo', 'Hello'), en ? 'Hello' : 'Hallo');
  }
});

test('app.js bei "Bewegung reduzieren": nichts wird versteckt, kein Beobachter für Einblenden/Zähler', () => {
  const zaehler = element({ textContent: '12' }); zaehler.setAttribute('data-count', '12');
  const abschnitt = element();
  const { ctx, doc, beobachter } = umgebung({ reduziert: true, extra: { querySelectorAll: (s) => (/data-count/.test(s) ? [zaehler] : /section|reveal|card/.test(s) ? [abschnitt] : []) } });
  doc.documentElement.setAttribute('lang', 'de');
  vm.runInContext(lesen('assets/theme.js'), ctx);
  vm.runInContext(lesen('assets/app.js'), ctx);
  (doc.listeners.DOMContentLoaded || []).forEach((f) => f());
  assert.ok(!abschnitt.classList.contains('reveal'), 'Abschnitt wurde trotz reduzierter Bewegung versteckt');
  assert.equal(zaehler.textContent, '12', 'Zähler darf bei reduzierter Bewegung nicht zählen');
  assert.equal(beobachter.length, 0, 'bei reduzierter Bewegung darf kein Einblend-/Zähler-Beobachter laufen');
});
