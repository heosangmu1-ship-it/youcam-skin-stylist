import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
import { createClient } from '../src/youcam.js';
import { createGuard } from '../src/units.js';
import { createSessions } from '../src/sessions.js';

export const catalog = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url), 'utf8'));
export const tmpLedger = () => join(mkdtempSync(join(tmpdir(), 'ycl-')), 'units.json');

// Temp publicDir: samples and garments copied from test/img, so tests never read the shipped public/ assets.
const IMG = new URL('./img/', import.meta.url);
export function tmpPublic() {
  const dir = mkdtempSync(join(tmpdir(), 'pub-'));
  mkdirSync(join(dir, 'samples')); mkdirSync(join(dir, 'garments'));
  for (const f of readdirSync(IMG).filter((f) => f.startsWith('sample-'))) copyFileSync(new URL(f, IMG), join(dir, 'samples', f));
  for (const g of catalog) copyFileSync(new URL('sage-cardigan.png', IMG), join(dir, 'garments', g.file));
  return dir;
}

// mock: null = demo mode; otherwise live against the mock.
// Temp fixtures dir with a minimal sample-1 (skin + one try-on), so demo tests never read the recorded fixtures/.
export function tmpFixtures() {
  const dir = mkdtempSync(join(tmpdir(), 'fx-'));
  const skin = [['radiance', 30], ['redness', 40], ['dark_circle_v2', 50], ['moisture', 60]].map(([type, ui_score]) => ({ type, ui_score }));
  writeFileSync(join(dir, 'sample-1.json'), JSON.stringify({ skin, tryon: { 'sage-cardigan': readFileSync(new URL('sage-cardigan.png', IMG)).toString('base64') } }));
  return dir;
}

export async function startApp({ mock = null, cap = 800, sessions = createSessions(), publicDir = tmpPublic(), fixturesDir = tmpFixtures() } = {}) {
  const ledger = createGuard({ path: tmpLedger(), cap });
  const client = mock ? createClient({ base: mock.url, key: 'test-key', guard: ledger, pollMs: 1, timeoutMs: 2000 }) : null;
  const server = createApp({ client, ledger, sessions, catalog, publicDir, fixturesDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, ledger, sessions, close: () => { server.closeAllConnections(); server.close(); } };
}

export const post = (url, path, { body, headers = {}, json } = {}) =>
  fetch(url + path, { method: 'POST', headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: json ? JSON.stringify(json) : body });
export const consent = { 'X-Consent': 'yes' };
