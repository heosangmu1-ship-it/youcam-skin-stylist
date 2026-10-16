import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { record } from '../scripts/record-fixtures.js';
import { startMock } from './mock-youcam.js';
import { createClient } from '../src/youcam.js';
import { createGuard, UnitCapError } from '../src/units.js';
import { createApp } from '../src/server.js';
import { rank, concernsFrom } from '../src/stylist.js';
import { SKIN_CONCERNS } from '../src/youcam.js';
import { catalog, tmpLedger, tmpPublic, post, consent } from './helpers.js';

const setup = async (t, cap = 800) => {
  const mock = await startMock();
  t.after(() => mock.close());
  const ledger = createGuard({ path: tmpLedger(), cap });
  const client = createClient({ base: mock.url, key: 'test-key', guard: ledger, pollMs: 1, timeoutMs: 2000 });
  const fixturesDir = mkdtempSync(join(tmpdir(), 'fx-'));
  const pub = tmpPublic();
  const lines = [];
  return { mock, ledger, client, fixturesDir, pub, lines, args: { client, ledger, catalog, fixturesDir, samplesDir: join(pub, 'samples'), garmentsDir: join(pub, 'garments'), log: (...a) => lines.push(a.join(' ')) } };
};

test('record writes {skin, tryon x3, recordedAt} per sample and prices the run first', async (t) => {
  const s = await setup(t);
  const done = await record(s.args);
  assert.deepEqual(done, ['sample-1', 'sample-2']);
  assert.match(s.lines[0], /estimated cost 30 units/);
  assert.equal(s.ledger.spent, 30);
  const f = JSON.parse(readFileSync(join(s.fixturesDir, 'sample-1.json'), 'utf8'));
  assert.ok(Array.isArray(f.skin) && f.skin.some((o) => o.type === 'radiance'));
  assert.equal(Object.keys(f.tryon).length, 3);
  assert.ok(Object.values(f.tryon).every((b) => Buffer.from(b, 'base64').length > 0));
  assert.ok(!Number.isNaN(Date.parse(f.recordedAt)));
});

test('record resumes at try-on level: stored skin kept, no analyze, stale pruned, ledger = 2 x missing', async (t) => {
  const s = await setup(t);
  const skin = [{ type: 'redness', ui_score: 60 }, { type: 'radiance', ui_score: 90 }, { type: 'dark_circle_v2', ui_score: 90 }, { type: 'moisture', ui_score: 90 }];
  const top = rank(concernsFrom(skin, SKIN_CONCERNS), catalog).slice(0, 3).map((r) => r.id);
  const stale = catalog.map((g) => g.id).find((id) => !top.includes(id));
  writeFileSync(join(s.fixturesDir, 'sample-1.json'), JSON.stringify({ skin, tryon: { [top[0]]: 'QUJD', [stale]: 'WFla' }, recordedAt: '2026-01-01T00:00:00.000Z' }));
  assert.deepEqual(await record(s.args), ['sample-1', 'sample-2']);
  assert.equal(s.mock.counters.skin, 1); // sample-2 only
  assert.equal(s.mock.counters.tryon, 2 + 3);
  assert.equal(s.ledger.spent, 2 * 2 + 15);
  const f = JSON.parse(readFileSync(join(s.fixturesDir, 'sample-1.json'), 'utf8'));
  assert.deepEqual(f.skin, skin);
  assert.deepEqual(Object.keys(f.tryon).sort(), [...top].sort());
  assert.equal(f.tryon[top[0]], 'QUJD'); // kept, not re-run
  assert.ok(!(stale in f.tryon));
  const spent = s.ledger.spent;
  assert.deepEqual(await record(s.args), []);
  assert.equal(s.ledger.spent, spent);
});

test('record aborts before any network call when the cap would refuse', async (t) => {
  const s = await setup(t, 20);
  await assert.rejects(record(s.args), UnitCapError);
  assert.equal(s.mock.counters.file, 0);
  assert.equal(s.ledger.spent, 0);
  assert.ok(!existsSync(join(s.fixturesDir, 'sample-1.json')));
});

test('demo mode serves recorded fixture: skin + try-on images, ledger stays 0', async (t) => {
  const s = await setup(t);
  await record(s.args);
  const ledger = createGuard({ path: tmpLedger(), cap: 800 });
  const server = createApp({ client: null, ledger, catalog, fixturesDir: s.fixturesDir, publicDir: s.pub });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const skin = await (await post(url, '/api/skin?sample=sample-1', { headers: consent })).json();
  assert.equal(skin.concerns.length, 4);
  const ids = skin.ranked.slice(0, 3).map((r) => r.id);
  const { looks } = await (await post(url, '/api/tryon', { json: { sessionId: skin.sessionId, garmentIds: ids } })).json();
  const recorded = JSON.parse(readFileSync(join(s.fixturesDir, 'sample-1.json'), 'utf8')).tryon;
  for (const l of looks) {
    const img = Buffer.from(await (await fetch(url + l.imageUrl)).arrayBuffer());
    assert.equal(img.toString('base64'), recorded[l.garmentId]);
  }
  assert.equal(ledger.spent, 0);
});
