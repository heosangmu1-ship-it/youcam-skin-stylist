import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGuard } from '../src/units.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const want = join(ROOT, 'var', 'units.json');

test('default ledger path is repo-root based, not cwd based', () => {
  const { LEDGER_PATH, ...env } = process.env;
  const cwd = process.cwd();
  process.env = env;
  process.chdir(tmpdir());
  try { assert.equal(createGuard().path, want); }
  finally { process.chdir(cwd); if (LEDGER_PATH !== undefined) process.env.LEDGER_PATH = LEDGER_PATH; }
});

test('LEDGER_PATH still overrides', () => {
  assert.equal(createGuard({ path: '/x/y.json' }).path, '/x/y.json');
});

test('server started from another cwd uses <repo>/var/units.json', async () => {
  const { LEDGER_PATH, YOUCAM_API_KEY, YOUCAM_BASE, ...env } = process.env;
  const p = spawn(process.execPath, [join(ROOT, 'src', 'server.js')], { cwd: tmpdir(), env: { ...env, PORT: '0' } });
  try {
    const line = await new Promise((ok, no) => {
      let buf = '';
      p.stdout.on('data', (d) => { buf += d; if (buf.includes('\n')) ok(buf); });
      p.on('error', no); p.on('exit', () => no(new Error('server exited: ' + buf)));
    });
    assert.ok(line.includes(`ledger=${want}`), line);
  } finally { p.kill(); }
});
