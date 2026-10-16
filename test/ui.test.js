import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const pub = new URL('../public/', import.meta.url);

test('photo tips are present in the page', () => {
  const html = readFileSync(new URL('index.html', pub), 'utf8');
  assert.match(html, /id="tips"/);
  assert.match(html, /60-80%/);
  assert.match(html, /id="photo-note"[^>]*aria-live="polite"/);
});

test('all public JS parses', () => {
  for (const f of readdirSync(pub).filter((n) => n.endsWith('.js'))) {
    const r = spawnSync(process.execPath, ['--check', new URL(f, pub).pathname]);
    assert.equal(r.status, 0, f + String(r.stderr));
  }
});
