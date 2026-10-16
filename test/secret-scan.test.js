import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(fileURLToPath(import.meta.url), '..', '..', 'scripts', 'secret-scan.sh');
const FAKE = 'sk-' + 'a1B2'.repeat(8); // built at runtime so this file itself stays clean
const git = (cwd, ...a) => { const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd }); assert.equal(r.status, 0, String(r.stderr)); };
const repo = () => { const d = mkdtempSync(join(tmpdir(), 'scan-')); git(d, 'init', '-q'); return d; };
const commit = (d, files) => { for (const [f, c] of Object.entries(files)) writeFileSync(join(d, f), c); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'c'); };
const scan = (d) => spawnSync('sh', [SCRIPT], { cwd: d, encoding: 'utf8' });

test('clean repo with documented placeholders passes', () => {
  const d = repo();
  commit(d, { 'README.md': 'YOUCAM_API_KEY=your-key-here\nAuthorization: Bearer test-key\n' });
  assert.equal(scan(d).status, 0);
});

test('planted key fails, location printed, value hidden', () => {
  const d = repo();
  commit(d, { 'a.txt': `x\nkey = ${FAKE}\n` });
  const r = scan(d);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /a\.txt:2/);
  assert.ok(!r.stderr.includes(FAKE) && !r.stdout.includes(FAKE));
});

test('key deleted in a later commit is still caught in history', () => {
  const d = repo();
  commit(d, { 'a.txt': FAKE + '\n' });
  commit(d, { 'a.txt': 'clean\n' });
  assert.equal(scan(d).status, 1);
});

test('other patterns fail: bearer, api key assignment, private key, token prefix', () => {
  for (const line of ['Bearer ' + 'abcDEF123.'.repeat(3), 'YOUCAM_API_KEY=' + 'Z9'.repeat(8), '-----BEGIN RSA PRIV' + 'ATE KEY-----', 'ghp_' + 'A1'.repeat(10)]) {
    const d = repo();
    commit(d, { 'f.txt': line + '\n' });
    assert.equal(scan(d).status, 1, line.slice(0, 8));
  }
});

test('tracked .env.local fails', () => {
  const d = repo();
  commit(d, { '.env.local': 'FOO=1\n' });
  assert.equal(scan(d).status, 1);
});
