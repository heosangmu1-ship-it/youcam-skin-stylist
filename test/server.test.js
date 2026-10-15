import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp, post, consent } from './helpers.js';
import { startMock } from './mock-youcam.js';
import { createSessions } from '../src/sessions.js';

const png = readFileSync(new URL('../public/samples/sample-1.png', import.meta.url));
const live = async (t, opts = {}) => {
  const mock = await startMock();
  const app = await startApp({ mock, ...opts });
  t.after(() => { app.close(); mock.close(); });
  return { mock, app };
};
const demo = async (t) => { const app = await startApp(); t.after(app.close); return app; };

test('demo config: mode, samples, garments', async (t) => {
  const app = await demo(t);
  const c = await (await fetch(app.url + '/api/config')).json();
  assert.equal(c.mode, 'demo');
  assert.equal(c.unitCap, 800);
  assert.ok(c.samples.length >= 2 && c.garments.length >= 3);
  assert.equal((await fetch(app.url + c.samples[0].url)).status, 200);
  assert.equal((await fetch(app.url + c.garments[0].url)).status, 200);
});

test('skin requires consent', async (t) => {
  const app = await demo(t);
  const r = await post(app.url, '/api/skin?sample=sample-1');
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /[Cc]onsent/);
});

test('demo fixture round trip: skin, tryon, result, delete', async (t) => {
  const app = await demo(t);
  const s = await (await post(app.url, '/api/skin?sample=sample-1', { headers: consent })).json();
  assert.equal(s.concerns.length, 4);
  assert.equal(s.concerns[0].key, 'radiance');
  assert.equal(s.ranked.length, 7);
  const t1 = await (await post(app.url, '/api/tryon', { json: { sessionId: s.sessionId, garmentIds: ['sage-cardigan', 'ivory-knit'] } })).json();
  assert.equal(t1.looks.length, 2);
  const img = await fetch(app.url + t1.looks[0].imageUrl);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await img.arrayBuffer()).byteLength > 0, true);
  assert.equal((await fetch(app.url + t1.looks[1].imageUrl)).status, 200); // no fixture: falls back to sample photo
  assert.equal(app.ledger.spent, 0);
  assert.equal((await fetch(app.url + '/api/session/' + s.sessionId, { method: 'DELETE' })).status, 204);
  assert.equal((await fetch(app.url + t1.looks[0].imageUrl)).status, 404);
});

test('demo mode refuses uploads and unknown samples', async (t) => {
  const app = await demo(t);
  assert.equal((await post(app.url, '/api/skin', { headers: consent, body: png })).status, 400);
  assert.equal((await post(app.url, '/api/skin?sample=nope', { headers: consent })).status, 404);
  assert.equal((await post(app.url, '/api/skin?sample=sample-2', { headers: consent })).status, 404); // no fixture recorded
});

test('live: upload -> skin -> 3 try-ons; ledger 15', async (t) => {
  const { mock, app } = await live(t);
  const s = await (await post(app.url, '/api/skin', { headers: consent, body: png })).json();
  assert.equal(app.ledger.spent, 9);
  assert.equal(s.concerns.find((c) => c.key === 'redness').verdict, 'needs care');
  const ids = s.ranked.slice(0, 3).map((r) => r.id);
  const t1 = await (await post(app.url, '/api/tryon', { json: { sessionId: s.sessionId, garmentIds: ids } })).json();
  assert.equal(t1.looks.filter((l) => l.imageUrl).length, 3);
  assert.equal(app.ledger.spent, 15);
  assert.equal(mock.counters.tryon, 3);
  for (const l of t1.looks) assert.equal((await fetch(app.url + l.imageUrl)).status, 200);
});

test('live: non-image upload rejected, oversize rejected, no spend', async (t) => {
  const { mock, app } = await live(t);
  assert.equal((await post(app.url, '/api/skin', { headers: consent, body: Buffer.from('hello') })).status, 415);
  assert.equal((await post(app.url, '/api/skin', { headers: consent, body: Buffer.alloc(8 * 1024 * 1024 + 1) })).status, 413);
  assert.equal(app.ledger.spent, 0);
  assert.equal(mock.counters.file, 0);
});

test('cap: second analysis gets 429, ledger unchanged, mock sees no extra call', async (t) => {
  const { mock, app } = await live(t, { cap: 15 });
  assert.equal((await post(app.url, '/api/skin', { headers: consent, body: png })).status, 200);
  assert.equal((await post(app.url, '/api/skin', { headers: consent, body: png })).status, 429);
  const r = await post(app.url, '/api/skin', { headers: consent, body: png });
  assert.equal(r.status, 429);
  assert.match((await r.json()).error, /cap/i);
  assert.equal(app.ledger.spent, 9);
  assert.deepEqual([mock.counters.file, mock.counters.skin], [1, 1]);
});

test('cap: try-on refused with 429 when no units left', async (t) => {
  const { app } = await live(t, { cap: 10 });
  const s = await (await post(app.url, '/api/skin', { headers: consent, body: png })).json();
  const r = await post(app.url, '/api/tryon', { json: { sessionId: s.sessionId, garmentIds: ['ivory-knit', 'sage-cardigan'] } });
  assert.equal(r.status, 429);
  assert.equal(app.ledger.spent, 9);
});

test('try-on partial failure keeps other looks (cap fits only some)', async (t) => {
  const { app } = await live(t, { cap: 12 }); // 9 + one try-on (2) fits, second would be 13
  const s = await (await post(app.url, '/api/skin', { headers: consent, body: png })).json();
  const t1 = await (await post(app.url, '/api/tryon', { json: { sessionId: s.sessionId, garmentIds: ['ivory-knit', 'sage-cardigan', 'navy-blazer'] } })).json();
  assert.equal(t1.looks.filter((l) => l.imageUrl).length, 1);
  assert.equal(t1.looks.filter((l) => l.error).length, 2);
  assert.equal(app.ledger.spent, 11);
});

test('try-on API error is per-look and friendly', async (t) => {
  const { mock, app } = await live(t);
  const s = await (await post(app.url, '/api/skin', { headers: consent, body: png })).json();
  mock.fail.tryon = 'error_pose';
  const t1 = await (await post(app.url, '/api/tryon', { json: { sessionId: s.sessionId, garmentIds: ['ivory-knit'] } })).json();
  assert.match(t1.looks[0].error, /pose/);
  assert.equal(app.ledger.spent, 9);
});

test('skin face error maps to 422 with message', async (t) => {
  const { mock, app } = await live(t);
  mock.fail.skin = 'error_lighting_dark';
  const r = await post(app.url, '/api/skin', { headers: consent, body: png });
  assert.equal(r.status, 422);
  assert.match((await r.json()).error, /dark/);
  assert.equal(app.ledger.spent, 0);
});

test('tryon validates session and garments', async (t) => {
  const app = await demo(t);
  assert.equal((await post(app.url, '/api/tryon', { json: { sessionId: 'x', garmentIds: ['ivory-knit'] } })).status, 404);
  const s = await (await post(app.url, '/api/skin?sample=sample-1', { headers: consent })).json();
  for (const garmentIds of [[], ['nope'], ['a', 'b', 'c', 'd'], 'ivory-knit'])
    assert.equal((await post(app.url, '/api/tryon', { json: { sessionId: s.sessionId, garmentIds } })).status, 400);
  assert.equal((await post(app.url, '/api/tryon', { body: '{bad', headers: {} })).status, 400);
});

test('session expires after ttl (injected clock)', async (t) => {
  let now = 0;
  const sessions = createSessions({ ttlMs: 600000, now: () => now });
  const app = await startApp({ sessions }); t.after(app.close);
  const s = await (await post(app.url, '/api/skin?sample=sample-1', { headers: consent })).json();
  const t1 = await (await post(app.url, '/api/tryon', { json: { sessionId: s.sessionId, garmentIds: ['ivory-knit'] } })).json();
  now = 599999;
  assert.equal((await fetch(app.url + t1.looks[0].imageUrl)).status, 200);
  now = 600001;
  assert.equal((await fetch(app.url + t1.looks[0].imageUrl)).status, 404);
  assert.equal((await post(app.url, '/api/tryon', { json: { sessionId: s.sessionId, garmentIds: ['ivory-knit'] } })).status, 404);
});

test('sweep removes expired sessions', () => {
  let now = 0;
  const ss = createSessions({ ttlMs: 10, now: () => now });
  ss.create({}); ss.create({});
  now = 11; ss.sweep();
  assert.equal(ss.size, 0);
});

test('static: index, content types, traversal blocked', async (t) => {
  const app = await demo(t);
  const idx = await fetch(app.url + '/');
  assert.equal(idx.status, 200);
  assert.match(idx.headers.get('content-type'), /text\/html/);
  assert.match((await fetch(app.url + '/app.js')).headers.get('content-type'), /javascript/);
  assert.match((await fetch(app.url + '/style.css')).headers.get('content-type'), /css/);
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/%2e%2e%2f%2e%2e%2fetc/passwd', '/%00', '/samples/../../package.json'])
    assert.notEqual((await fetch(app.url + p)).status, 200, p);
  const raw = await new Promise((ok) => { // raw socket: fetch normalizes ../
    import('node:net').then(({ connect }) => {
      const sock = connect(new URL(app.url).port, '127.0.0.1', () => sock.write('GET /../package.json HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'));
      let d = ''; sock.on('data', (c) => (d += c)); sock.on('end', () => ok(d));
    });
  });
  assert.match(raw, /^HTTP\/1.1 404/);
});
