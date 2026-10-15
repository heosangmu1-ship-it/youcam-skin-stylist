import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
import { createClient } from '../src/youcam.js';
import { createGuard } from '../src/units.js';
import { createSessions } from '../src/sessions.js';

export const catalog = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url), 'utf8'));
export const tmpLedger = () => join(mkdtempSync(join(tmpdir(), 'ycl-')), 'units.json');

// mock: null = demo mode; otherwise live against the mock.
export async function startApp({ mock = null, cap = 800, sessions = createSessions() } = {}) {
  const ledger = createGuard({ path: tmpLedger(), cap });
  const client = mock ? createClient({ base: mock.url, key: 'test-key', guard: ledger, pollMs: 1, timeoutMs: 2000 }) : null;
  const server = createApp({ client, ledger, sessions, catalog });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, ledger, sessions, close: () => { server.closeAllConnections(); server.close(); } };
}

export const post = (url, path, { body, headers = {}, json } = {}) =>
  fetch(url + path, { method: 'POST', headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: json ? JSON.stringify(json) : body });
export const consent = { 'X-Consent': 'yes' };
