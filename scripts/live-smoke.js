// Spends REAL units: one skin analysis (9) + one try-on (2) through the unit guard.
// Usage: node --env-file=.env.local scripts/live-smoke.js --yes-spend
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient, DEFAULT_BASE } from '../src/youcam.js';
import { createGuard, COSTS } from '../src/units.js';

if (!process.argv.includes('--yes-spend')) {
  console.error(`Refusing: this spends about ${COSTS.skin + COSTS.tryon} free units. Re-run with --yes-spend.`);
  process.exit(1);
}
if (!process.env.YOUCAM_API_KEY) { console.error('YOUCAM_API_KEY is not set.'); process.exit(1); }
const guard = createGuard();
const client = createClient({ base: process.env.YOUCAM_BASE || DEFAULT_BASE, key: process.env.YOUCAM_API_KEY, guard });
const face = readFileSync(new URL('../public/samples/sample-1.jpg', import.meta.url));
const garment = readFileSync(new URL('../public/garments/sage-cardigan.png', import.meta.url));
console.log('units before:', guard.spent);
const { fileId, output } = await client.analyze(face, 'image/jpeg');
console.log('skin:', output.map((o) => `${o.type}=${o.ui_score}`).join(' '));
const img = await client.tryOnGarment(fileId, garment, 'image/png');
writeFileSync('var/smoke-tryon.png', img.bytes);
console.log('try-on saved to var/smoke-tryon.png', img.bytes.length, 'bytes');
console.log('units after:', guard.spent);
