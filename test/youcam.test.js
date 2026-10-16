import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, YoucamError, SKIN_CONCERNS } from '../src/youcam.js';
import { createGuard, UnitCapError } from '../src/units.js';
import { startMock } from './mock-youcam.js';
import { tmpLedger } from './helpers.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
async function setup(cap = 800, key = 'test-key') {
  const mock = await startMock();
  const guard = createGuard({ path: tmpLedger(), cap });
  const client = createClient({ base: mock.url, key, guard, pollMs: 1, timeoutMs: 300 });
  return { mock, guard, client };
}

test('upload does file request then PUT', async (t) => {
  const { mock, client } = await setup(); t.after(mock.close);
  assert.equal(await client.upload(png, 'image/png'), 'f1');
  assert.deepEqual([mock.counters.file, mock.counters.put], [1, 1]);
});

test('skin polls until success, returns output, commits 9', async (t) => {
  const { mock, guard, client } = await setup(); t.after(mock.close);
  const id = await client.upload(png, 'image/png');
  const out = await client.skin(id);
  assert.deepEqual(out.map((o) => o.type), [...SKIN_CONCERNS, 'all', 'skin_age', 'resize_image']); // raw output keeps extras
  assert.ok(mock.counters.polls >= 2);
  assert.equal(guard.spent, 9);
});

test('tryon downloads result bytes, commits 2', async (t) => {
  const { mock, guard, client } = await setup(); t.after(mock.close);
  const [a, b] = [await client.upload(png, 'image/png'), await client.upload(png, 'image/png')];
  const img = await client.tryon(a, b);
  assert.equal(img.type, 'image/png');
  assert.equal(img.bytes[0], 0x89);
  assert.equal(guard.spent, 2);
});

test('task error is mapped to a friendly message and releases units', async (t) => {
  const { mock, guard, client } = await setup(); t.after(mock.close);
  mock.fail.skin = 'error_src_face_too_small';
  const id = await client.upload(png, 'image/png');
  await assert.rejects(client.skin(id), (e) => e instanceof YoucamError && e.code === 'error_src_face_too_small' && e.status === 422 && /too small/.test(e.message));
  assert.equal(guard.spent, 0);
});

test('unknown error code gets generic message with 502', async (t) => {
  const { mock, client } = await setup(); t.after(mock.close);
  mock.fail.tryon = 'unknown_internal_error';
  const [a, b] = [await client.upload(png, 'image/png'), await client.upload(png, 'image/png')];
  await assert.rejects(client.tryon(a, b), (e) => e.status === 502);
});

test('poll timeout', async (t) => {
  const { mock, client } = await setup(); t.after(mock.close);
  mock.runningPolls = 1e9;
  const id = await client.upload(png, 'image/png');
  await assert.rejects(client.skin(id), (e) => e.code === 'timeout');
});

test('cap refusal makes zero network calls (analyze)', async (t) => {
  const { mock, client } = await setup(5); t.after(mock.close);
  await assert.rejects(client.analyze(png, 'image/png'), UnitCapError);
  assert.deepEqual(mock.counters, { file: 0, put: 0, skin: 0, tryon: 0, polls: 0, unauthorized: 0 });
});

test('wrong key: error message does not leak key or URL', async (t) => {
  const { mock, client } = await setup(800, 'leaky-key-123'); t.after(mock.close);
  await assert.rejects(client.upload(png, 'image/png'), (e) => !/leaky-key|127\.0\.0\.1/.test(e.message + e.stack.split('\n')[0]) && e instanceof YoucamError);
  assert.equal(mock.counters.unauthorized, 1);
});
