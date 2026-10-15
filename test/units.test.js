import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuard, UnitCapError, COSTS } from '../src/units.js';
import { tmpLedger } from './helpers.js';

test('commit adds to spent', () => {
  const g = createGuard({ path: tmpLedger(), cap: 100 });
  g.reserve(COSTS.skin).commit();
  assert.equal(g.spent, 9);
});

test('cap reached refuses and leaves ledger unchanged', () => {
  const g = createGuard({ path: tmpLedger(), cap: 20 });
  g.reserve(9).commit(); g.reserve(9).commit();
  assert.throws(() => g.reserve(9), UnitCapError);
  assert.equal(g.spent, 18);
  g.reserve(2).commit(); // exactly at cap is allowed
  assert.equal(g.spent, 20);
});

test('release frees the reservation', () => {
  const g = createGuard({ path: tmpLedger(), cap: 10 });
  g.reserve(9).release();
  assert.equal(g.spent, 0);
  g.reserve(9).commit();
});

test('restart keeps ledger', () => {
  const path = tmpLedger();
  createGuard({ path, cap: 100 }).reserve(9).commit();
  assert.equal(createGuard({ path, cap: 100 }).spent, 9);
});

test('two parallel reserves cannot both pass at the edge', async () => {
  const g = createGuard({ path: tmpLedger(), cap: 10 });
  const r = await Promise.allSettled([1, 2].map(async () => g.reserve(9)));
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
});

test('run releases on error and commits on success', async () => {
  const g = createGuard({ path: tmpLedger(), cap: 10 });
  await assert.rejects(g.run(9, async () => { throw new Error('x'); }), /x/);
  assert.equal(g.spent, 0);
  assert.equal(await g.run(9, async () => 'ok'), 'ok');
  assert.equal(g.spent, 9);
});

test('reserved units survive a crash as spent-equivalent', () => {
  const path = tmpLedger();
  createGuard({ path, cap: 10 }).reserve(9); // never settled
  assert.throws(() => createGuard({ path, cap: 10 }).reserve(9), UnitCapError);
});

test('corrupt ledger fails closed; bad cap falls back to 800', async () => {
  const { writeFileSync } = await import('node:fs');
  const path = tmpLedger();
  writeFileSync(path, '{nope');
  assert.throws(() => createGuard({ path, cap: 10 }).reserve(1));
  assert.equal(createGuard({ path: tmpLedger(), cap: NaN }).cap, 800);
});
