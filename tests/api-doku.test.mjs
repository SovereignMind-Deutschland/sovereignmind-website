// Tests des Renderers (assets/api-doku.js) ohne Browser: kleines Schein-DOM, Aufruf: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

class Node_ {
  constructor(tag) { this.tag = tag; this.children = []; this.className = ''; this.attrs = {}; this.hidden = false; }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = v; }
  get textContent() { return this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
  set textContent(v) { this.children = [String(v)]; }
}
const text = (t) => ({ get textContent() { return t; } });
const document = {
  createElement: (tag) => new Node_(tag),
  createTextNode: text,
  createDocumentFragment: () => new Node_('#frag'),
  getElementById: () => null,
  addEventListener() {},
};
const window = { SMApiDokuManual: true, addEventListener() {}, document };
vm.runInNewContext(readFileSync(new URL('../assets/api-doku.js', import.meta.url), 'utf8'), {
  window, document, fetch: () => Promise.reject(new Error('kein Netz')), console, JSON, Date, Promise, encodeURIComponent,
});
const { deref, resolveRef, internals } = window.SMApiDoku;

const walk = (n, fn) => { fn(n); (n.children || []).forEach((c) => typeof c !== 'string' && walk(c, fn)); };
const tags = (n) => { const t = []; walk(n, (x) => x.tag && t.push(x.tag)); return t; };

test('Markdown: HTML wird als Text ausgegeben, nie als Element', () => {
  const box = internals.markdown('<script>alert(1)</script> und <img src=x onerror=alert(1)>');
  assert.equal(tags(box).filter((t) => t !== 'div' && t !== 'p').length, 0);
  assert.match(box.textContent, /<script>alert\(1\)<\/script>/);
});

test('Markdown: Links nur http(s), sonst nur der Text', () => {
  const box = internals.markdown('[ok](https://example.org/a) [bös](javascript:alert(1)) [rel](/pfad) [data](data:text/html,x)');
  const links = [];
  walk(box, (x) => x.tag === 'a' && links.push(x));
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'https://example.org/a');
  assert.equal(links[0].rel, 'noopener noreferrer');
  assert.match(box.textContent, /bös/);
  assert.doesNotMatch(box.textContent, /javascript:/);
});

test('Markdown: Absatz, Liste, Code, Fett, Überschrift', () => {
  const box = internals.markdown('# Titel\n\nText **fett** und `code`.\n\n- eins\n- zwei\n  weiter\n\n```\nx < y\n```');
  const t = tags(box);
  for (const want of ['h4', 'p', 'strong', 'code', 'ul', 'li', 'pre']) assert.ok(t.includes(want), want);
  assert.match(box.textContent, /zwei weiter/);
  assert.match(box.textContent, /x < y/);
});

const spec = {
  openapi: '3.0.1',
  info: { title: 'T', version: '1' },
  tags: [{ name: 'A' }],
  paths: {
    '/api/x/{id}': {
      get: { tags: ['A'], summary: 's', security: [{ b: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'q', in: 'query', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'ok' } } },
      post: { tags: ['A'], security: [{ b: [] }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Req' } } } }, responses: { 200: { description: 'ok' } } },
    },
    '/api/stream': { get: { responses: { 200: { description: 'ok', content: { 'text/event-stream': { schema: { type: 'string' } } } } } } },
    '/api/up': { post: { security: [{ b: [] }], requestBody: { content: { 'multipart/form-data': { schema: { type: 'object' } } } }, responses: { 200: { description: 'ok' } } } },
  },
  components: {
    schemas: {
      Req: { type: 'object', properties: { email: { type: 'string' }, n: { type: 'integer' }, kids: { type: 'array', items: { $ref: '#/components/schemas/Req' } }, mode: { type: 'string', enum: ['a', 'b'] } } },
      A: { $ref: '#/components/schemas/B' },
      B: { $ref: '#/components/schemas/A' },
    },
  },
};

test('$ref: Auflösung, unbekannte Ziele, Zyklus ohne Endlosschleife', () => {
  internals.load(spec);
  assert.equal(resolveRef('#/components/schemas/Req').type, 'object');
  assert.equal(resolveRef('#/components/schemas/Gibtsnicht'), null);
  assert.equal(resolveRef('http://extern/x'), null);
  assert.equal(deref({ $ref: '#/components/schemas/Req' }).type, 'object');
  assert.ok(deref({ $ref: '#/components/schemas/A' }).circular);
});

test('Beispiel-Generator: Typen, Enum, rekursive Schemas enden', () => {
  internals.load(spec);
  const v = internals.sample({ $ref: '#/components/schemas/Req' });
  assert.equal(v.email, 'nutzer@kanzlei.example');
  assert.equal(v.n, 0);
  assert.equal(v.mode, 'a');
  assert.ok(Array.isArray(v.kids));
  assert.equal(internals.sample({ $ref: '#/components/schemas/A' }), null);
  assert.equal(internals.sample({ type: 'string', format: 'uuid' }), '00000000-0000-0000-0000-000000000000');
});

test('Snippets: curl, C#, Python, JavaScript', () => {
  const items = internals.load(spec);
  const get = internals.callOf(items.find((i) => i.method === 'get' && i.path.includes('{id}')));
  assert.equal(get.path, '/api/x/<id>');
  assert.equal(JSON.stringify(get.query), '[["q","0"]]');
  const curl = internals.genCode('curl', get);
  assert.match(curl, /curl -s -X GET 'http:\/\/localhost:5043\/api\/x\/<id>\?q=0'/);
  assert.match(curl, /Authorization: Bearer <Token>/);

  const post = internals.callOf(items.find((i) => i.method === 'post' && i.path.includes('{id}')));
  assert.match(internals.genCode('curl', post), /Content-Type: application\/json/);
  assert.match(internals.genCode('csharp', post), /PostAsync/);
  assert.match(internals.genCode('python', post), /requests\.post\(/);
  assert.match(internals.genCode('javascript', post), /fetch\(/);

  const stream = internals.callOf(items.find((i) => i.path === '/api/stream'));
  assert.equal(stream.auth, false);
  assert.match(internals.genCode('curl', stream), /curl -N/);
  assert.doesNotMatch(internals.genCode('python', stream), /headers/);

  const up = internals.callOf(items.find((i) => i.path === '/api/up'));
  assert.match(internals.genCode('curl', up), /-F 'file=@Dokument.pdf'/);
});

test('Gesamte Beschreibung: alle Endpunkte ergeben Snippets in allen Sprachen', () => {
  const real = JSON.parse(readFileSync(new URL('../assets/api/openapi.json', import.meta.url), 'utf8'));
  const items = internals.load(real);
  assert.ok(items.length >= 121, `nur ${items.length} Endpunkte`);
  assert.equal(new Set(items.map((i) => i.id)).size, items.length, 'IDs eindeutig');
  for (const it of items) {
    const call = internals.callOf(it);
    for (const lang of ['curl', 'csharp', 'python', 'javascript']) {
      const code = internals.genCode(lang, call);
      assert.ok(code && code.length > 10, `${it.method} ${it.path} ${lang}`);
      assert.doesNotMatch(code, /undefined|\[object/, `${it.method} ${it.path} ${lang}`);
    }
  }
});
