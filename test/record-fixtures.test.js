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
import { catalog, tmpLedger, post, consent } from './helpers.js';

const setup = async (t, cap = 800) => {
  const mock = await startMock();
  t.after(() => mock.close());
  const ledger = createGuard({ path: tmpLedger(), cap });
  const client = createClient({ base: mock.url, key: 'test-key', guard: ledger, pollMs: 1, timeoutMs: 2000 });
  const fixturesDir = mkdtempSync(join(tmpdir(), 'fx-'));
  const lines = [];
  return { mock, ledger, client, fixturesDir, lines, args: { client, ledger, catalog, fixturesDir, log: (...a) => lines.push(a.join(' ')) } };
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

test('record resumes: existing fixtures are skipped, no units spent', async (t) => {
  const s = await setup(t);
  writeFileSync(join(s.fixturesDir, 'sample-1.json'), '{"skin":[]}');
  assert.deepEqual(await record(s.args), ['sample-2']);
  assert.equal(s.ledger.spent, 15);
  assert.deepEqual(await record(s.args), []);
  assert.equal(s.ledger.spent, 15);
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
  const server = createApp({ client: null, ledger, catalog, fixturesDir: s.fixturesDir });
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
