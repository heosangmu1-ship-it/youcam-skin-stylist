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
  assert.ok(isWeak(79) && !isWeak(80));
  assert.equal(severity(30), 70);
});

test('low radiance prefers mid-tone over very dark', () => {
  const r = rank(only('radiance', 20), catalog);
  assert.ok(pos(r, 'sage-cardigan') < pos(r, 'navy-blazer'));
  assert.match(r[0].why, /radiance score is 20/i);
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

test('real demo scores: top 3 differ across faces and each reason quotes its own score', () => {
  const faces = {
    1: { radiance: 80, redness: 68, dark_circle_v2: 77, moisture: 75 },
    2: { redness: 99, radiance: 79, dark_circle_v2: 58, moisture: 65 },
    3: { redness: 99, radiance: 93, dark_circle_v2: 72, moisture: 73 },
  };
  const tops = Object.values(faces).map((f) => rank(Object.entries(f).map(([key, score]) => ({ key, score })), catalog).slice(0, 3));
  const sets = tops.map((r) => ids(r).sort().join());
  assert.ok(new Set(sets).size > 1);
  tops.forEach((top, i) => {
    const f = Object.values(faces)[i];
    for (const x of top) {
      const nums = [...x.why.matchAll(/score is (\d+)/g)].map((m) => Number(m[1]));
      assert.ok(nums.length && nums.every((n) => Object.values(f).includes(n)), x.why);
    }
  });
  assert.match(tops[1][0].why, /score is (99|79|58|65)/);
});

test('concerns at 80 or above are not flagged', () => {
  assert.match(rank([{ key: 'redness', score: 80 }], catalog)[0].why, /balanced pick/);
});

test('garment-specific reasons: top 3 differ pairwise and cite score plus a garment attribute', () => {
  const faces = [
    { radiance: 80, redness: 68, dark_circle_v2: 77, moisture: 75 },
    { redness: 99, radiance: 79, dark_circle_v2: 58, moisture: 65 },
    { redness: 99, radiance: 93, dark_circle_v2: 72, moisture: 73 },
  ];
  for (const f of faces) {
    const top = rank(Object.entries(f).map(([key, score]) => ({ key, score })), catalog).slice(0, 3);
    assert.equal(new Set(top.map((x) => x.why)).size, 3, top.map((x) => x.why).join('\n'));
    for (const x of top) {
      const clauses = x.why.split(/\. /);
      assert.ok(clauses.length <= 2);
      for (const c of clauses) {
        assert.match(c, /score is \d+/);
        assert.ok(c.includes(`brightness ${x.traits.brightness}/100`) || c.includes(x.traits.fabric) || c.includes(`${x.name}'s ${x.traits.tone} tone`), c);
      }
      assert.deepEqual(Object.keys(x.traits), ['color', 'tone', 'brightness', 'fabric']);
    }
  }
});
