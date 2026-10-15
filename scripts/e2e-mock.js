// Scripted run: mock YouCam + app, sample -> skin -> 3 try-ons -> delete. Prints transcript.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMock } from '../test/mock-youcam.js';
import { createApp } from '../src/server.js';
import { createClient } from '../src/youcam.js';
import { createGuard } from '../src/units.js';

const mock = await startMock();
const ledger = createGuard({ path: join(mkdtempSync(join(tmpdir(), 'e2e-')), 'units.json'), cap: 800 });
const client = createClient({ base: mock.url, key: 'test-key', guard: ledger, pollMs: 5 });
const catalog = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url), 'utf8'));
const app = createApp({ client, ledger, catalog });
await new Promise((r) => app.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${app.address().port}`;
const log = (...a) => console.log(...a);

const cfg = await (await fetch(`${url}/api/config`)).json();
log('GET /api/config ->', cfg.mode, `units ${cfg.unitsSpent}/${cfg.unitCap}`, `samples=${cfg.samples.length}`);
const skinRes = await fetch(`${url}/api/skin?sample=${cfg.samples[0].id}`, { method: 'POST', headers: { 'X-Consent': 'yes' } });
const skin = await skinRes.json();
log(`POST /api/skin?sample=${cfg.samples[0].id} ->`, skinRes.status, skin.concerns.map((c) => `${c.key}=${c.score}(${c.verdict})`).join(' '));
log('ranked top 3:', skin.ranked.slice(0, 3).map((r) => r.id).join(', '));
const ids = skin.ranked.slice(0, 3).map((r) => r.id);
const t = await (await fetch(`${url}/api/tryon`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: skin.sessionId, garmentIds: ids }) })).json();
for (const l of t.looks) {
  const img = await fetch(url + l.imageUrl);
  const n = (await img.arrayBuffer()).byteLength;
  log(`GET ${l.imageUrl.replace(skin.sessionId, '<sid>')} -> ${img.status} ${img.headers.get('content-type')} ${n}B | ${l.why}`);
  assert.equal(img.status, 200); assert.ok(n > 0);
}
assert.equal(t.looks.length, 3);
log('ledger spent:', ledger.spent);
assert.equal(ledger.spent, 9 + 3 * 2);
assert.deepEqual([mock.counters.skin, mock.counters.tryon], [1, 3]);
const del = await fetch(`${url}/api/session/${skin.sessionId}`, { method: 'DELETE' });
const after = await fetch(url + t.looks[0].imageUrl);
log('DELETE session ->', del.status, '; GET result after delete ->', after.status);
assert.equal(after.status, 404);
log('E2E OK');
app.closeAllConnections(); app.close(); mock.close();
