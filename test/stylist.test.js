import test from 'node:test';
import assert from 'node:assert/strict';
import { rank, verdict, isWeak, severity, RULES } from '../src/stylist.js';
import { catalog } from './helpers.js';

const only = (key, score) => [{ key, score }];
const ids = (r) => r.map((x) => x.id);
const pos = (r, id) => ids(r).indexOf(id);

test('verdict thresholds and weakness', () => {
  assert.equal(verdict(80), 'healthy');
  assert.equal(verdict(55), 'okay');
  assert.equal(verdict(30), 'needs care');
  assert.ok(isWeak(49) && !isWeak(50));
  assert.equal(severity(30), 70);
});

test('low radiance prefers mid-tone over very dark', () => {
  const r = rank(only('radiance', 20), catalog);
  assert.ok(pos(r, 'sage-cardigan') < pos(r, 'navy-blazer'));
  assert.match(r[0].why, /radiance is low/i);
});

test('high redness avoids saturated red/pink, prefers cool', () => {
  const r = rank(only('redness', 20), catalog);
  assert.ok(pos(r, 'dusty-blue-linen') < pos(r, 'rose-silk'));
  assert.ok(pos(r, 'sage-cardigan') < pos(r, 'coral-satin'));
  assert.equal(ids(r).at(-1) === 'rose-silk' || ids(r).at(-1) === 'coral-satin', true);
});

test('dark circles avoid very dark collars', () => {
  const r = rank(only('dark_circle_v2', 20), catalog);
  assert.equal(ids(r).at(-1), 'navy-blazer');
});

test('low moisture prefers matte knits over shiny fabric', () => {
  const r = rank(only('moisture', 20), catalog);
  assert.ok(pos(r, 'camel-sweater') < pos(r, 'coral-satin'));
  assert.ok(pos(r, 'ivory-knit') < pos(r, 'rose-silk'));
});

test('healthy skin: catalog order and balanced reason', () => {
  const r = rank([{ key: 'radiance', score: 90 }, { key: 'moisture', score: 85 }], catalog);
  assert.deepEqual(ids(r), catalog.map((g) => g.id));
  assert.match(r[0].why, /balanced pick/);
});

test('ordering is deterministic and input order independent', () => {
  const c = [{ key: 'radiance', score: 30 }, { key: 'redness', score: 20 }, { key: 'moisture', score: 40 }];
  assert.deepEqual(rank(c, catalog), rank([...c].reverse(), catalog));
  assert.deepEqual(rank(c, catalog), rank(c, catalog));
});

test('every ranked item has a one-sentence reason; all garments returned', () => {
  const r = rank([{ key: 'radiance', score: 30 }, { key: 'redness', score: 20 }], catalog);
  assert.equal(r.length, catalog.length);
  for (const x of r) assert.match(x.why, /^[A-Z].*\.$/);
});

test('unknown concern keys are ignored', () => {
  assert.equal(rank([{ key: 'wrinkles', score: 1 }], catalog).length, catalog.length);
  assert.ok(RULES.radiance && RULES.moisture);
});
