// Records demo fixtures from the REAL API: skin + top 3 try-ons per sample in public/samples/.
// Spends units (9 + 3*2 per sample) through the unit guard.
// Usage: node --env-file=.env.local scripts/record-fixtures.js --yes-spend
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rank, concernsFrom } from '../src/stylist.js';
import { createClient, DEFAULT_BASE, SKIN_CONCERNS } from '../src/youcam.js';
import { createGuard, COSTS } from '../src/units.js';
import { sniff } from '../src/server.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const PER_SAMPLE = COSTS.skin + 3 * COSTS.tryon;

export async function record({ client, ledger, catalog, samplesDir = join(ROOT, 'public', 'samples'), garmentsDir = join(ROOT, 'public', 'garments'), fixturesDir = join(ROOT, 'fixtures'), log = console.log }) {
  const todo = readdirSync(samplesDir).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort()
    .map((file) => ({ file, id: file.replace(/\.[^.]+$/, '') }))
    .filter((s) => !existsSync(join(fixturesDir, `${s.id}.json`)));
  const cost = todo.length * PER_SAMPLE;
  log(`to record: ${todo.map((s) => s.id).join(', ') || 'nothing'}; estimated cost ${cost} units (${PER_SAMPLE} per sample)`);
  if (!todo.length) return [];
  ledger.reserve(cost).release(); // throws UnitCapError when the cap would be exceeded: abort before any network call
  mkdirSync(fixturesDir, { recursive: true });
  log('units before:', ledger.spent);
  for (const s of todo) {
    const bytes = readFileSync(join(samplesDir, s.file));
    const { fileId, output } = await client.analyze(bytes, sniff(bytes));
    const ranked = rank(concernsFrom(output, SKIN_CONCERNS), catalog);
    const tryon = {};
    for (const { id } of ranked.slice(0, 3)) {
      const g = readFileSync(join(garmentsDir, catalog.find((x) => x.id === id).file));
      tryon[id] = (await client.tryOnGarment(fileId, g, sniff(g))).bytes.toString('base64');
    }
    const out = join(fixturesDir, `${s.id}.json`);
    writeFileSync(`${out}.tmp`, JSON.stringify({ skin: output, tryon, recordedAt: new Date().toISOString() }));
    renameSync(`${out}.tmp`, out);
    log(`saved ${s.id}: garments ${Object.keys(tryon).join(', ')}; units spent so far ${ledger.spent}`);
  }
  log('units after:', ledger.spent);
  return todo.map((s) => s.id);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--yes-spend')) { console.error('Refusing: this spends real units. Re-run with --yes-spend.'); process.exit(1); }
  if (!process.env.YOUCAM_API_KEY) { console.error('YOUCAM_API_KEY is not set.'); process.exit(1); }
  const ledger = createGuard();
  const client = createClient({ base: process.env.YOUCAM_BASE || DEFAULT_BASE, key: process.env.YOUCAM_API_KEY, guard: ledger });
  const catalog = JSON.parse(readFileSync(join(ROOT, 'catalog.json'), 'utf8'));
  try { await record({ client, ledger, catalog }); } catch (e) { console.error('stopped:', e.name === 'UnitCapError' || e.name === 'YoucamError' ? e.message : e.name); process.exit(1); }
}
