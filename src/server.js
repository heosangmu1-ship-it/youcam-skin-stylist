import http from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rank, verdict, LABELS } from './stylist.js';
import { createSessions } from './sessions.js';
import { createClient, DEFAULT_BASE, SKIN_CONCERNS } from './youcam.js';
import { createGuard, UnitCapError } from './units.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_IMAGE = 8 * 1024 * 1024;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.json': 'application/json', '.svg': 'image/svg+xml' };

const fail = (status, message) => Object.assign(new Error(message), { status });
const sniff = (b) => (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg' : null);

function readBody(req, max) {
  return new Promise((ok, no) => {
    if (Number(req.headers['content-length']) > max) return no(fail(413, 'Request too large.'));
    const chunks = []; let n = 0, over = false;
    req.on('data', (d) => { if (over) return; n += d.length; if (n > max) { over = true; no(fail(413, 'Request too large (image max 8 MB).')); } else chunks.push(d); });
    req.on('end', () => !over && ok(Buffer.concat(chunks)));
    req.on('error', no);
  });
}

export function createApp({ client = null, ledger, sessions = createSessions(), catalog, publicDir = join(ROOT, 'public'), fixturesDir = join(ROOT, 'fixtures') }) {
  publicDir = resolve(publicDir);
  const samples = readdirSync(join(publicDir, 'samples')).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort()
    .map((file) => ({ id: file.replace(/\.[^.]+$/, ''), file, url: `/samples/${file}` }));
  const fixture = (id) => { try { return JSON.parse(readFileSync(join(fixturesDir, `${id}.json`), 'utf8')); } catch { return null; } };
  const send = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

  async function skin(req, res, url) {
    if (req.headers['x-consent'] !== 'yes') throw fail(400, 'Consent is required before a photo is used.');
    const sampleId = url.searchParams.get('sample');
    let output, fileId;
    if (sampleId) {
      const s = samples.find((x) => x.id === sampleId);
      if (!s) throw fail(404, 'Unknown sample.');
      if (client) {
        const bytes = readFileSync(join(publicDir, 'samples', s.file));
        ({ fileId, output } = await client.analyze(bytes, sniff(bytes)));
      } else {
        const f = fixture(sampleId);
        if (!f) throw fail(404, 'No recorded demo data for this sample.');
        output = f.skin;
      }
    } else {
      if (!client) throw fail(400, 'Demo mode: choose a sample face, or set YOUCAM_API_KEY to analyze your own photo.');
      const bytes = await readBody(req, MAX_IMAGE);
      const type = sniff(bytes);
      if (!type) throw fail(415, 'Only JPEG or PNG photos are supported.');
      ({ fileId, output } = await client.analyze(bytes, type));
    }
    const concerns = SKIN_CONCERNS.flatMap((key) => {
      const o = output.find((x) => x.type === key);
      return o ? [{ key, label: LABELS[key], score: Math.round(o.ui_score), verdict: verdict(o.ui_score) }] : [];
    });
    const ranked = rank(concerns, catalog);
    const s = sessions.create({ fileId, sample: sampleId, ranked });
    send(res, 200, { sessionId: s.id, concerns, ranked });
  }

  async function tryon(req, res) {
    let body;
    try { body = JSON.parse(await readBody(req, 10_000)); } catch (e) { throw e.status ? e : fail(400, 'Invalid JSON.'); }
    const s = sessions.get(body.sessionId);
    if (!s) throw fail(404, 'Session not found or expired.');
    const ids = body.garmentIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 3 || !ids.every((id) => catalog.some((g) => g.id === id))) throw fail(400, 'Pick 1 to 3 garments from the catalog.');
    const settled = await Promise.allSettled(ids.map(async (id) => {
      const g = catalog.find((x) => x.id === id);
      const bytes = readFileSync(join(publicDir, 'garments', g.file));
      let img;
      if (client) img = await client.tryOnGarment(s.fileId, bytes, sniff(bytes));
      else {
        const b64 = fixture(s.sample)?.tryon?.[id];
        img = b64 ? { bytes: Buffer.from(b64, 'base64'), type: 'image/png' } : { bytes: readFileSync(join(publicDir, 'samples', samples.find((x) => x.id === s.sample).file)), type: 'image/png' };
      }
      const n = s.images.push(img) - 1;
      return { garmentId: id, imageUrl: `/result/${s.id}/${n}`, why: s.ranked.find((r) => r.id === id).why };
    }));
    const looks = settled.map((r, i) => (r.status === 'fulfilled' ? r.value : { garmentId: ids[i], error: r.reason instanceof Error && r.reason.status ? r.reason.message : 'Try-on failed.' }));
    const cap = settled.find((r) => r.reason instanceof UnitCapError);
    if (cap && settled.every((r) => r.status === 'rejected')) throw cap.reason;
    send(res, 200, { looks });
  }

  function serveStatic(res, pathname) {
    let p;
    try { p = decodeURIComponent(pathname); } catch { throw fail(400, 'Bad path.'); }
    if (p.includes('\0')) throw fail(400, 'Bad path.');
    if (p.endsWith('/')) p += 'index.html';
    const f = resolve(publicDir, '.' + p);
    if (!f.startsWith(publicDir + sep)) throw fail(404, 'Not found.');
    let data;
    try { data = readFileSync(f); } catch { throw fail(404, 'Not found.'); }
    res.writeHead(200, { 'Content-Type': TYPES[extname(f)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:" });
    res.end(data);
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const { pathname } = url;
      let m;
      if (req.method === 'GET' && pathname === '/api/config') {
        return send(res, 200, { mode: client ? 'live' : 'demo', unitsSpent: ledger.spent, unitCap: ledger.cap, samples: samples.map(({ id, url }) => ({ id, url })), garments: catalog.map((g) => ({ id: g.id, name: g.name, url: `/garments/${g.file}` })) });
      }
      if (req.method === 'POST' && pathname === '/api/skin') return await skin(req, res, url);
      if (req.method === 'POST' && pathname === '/api/tryon') return await tryon(req, res);
      if (req.method === 'DELETE' && (m = pathname.match(/^\/api\/session\/([\w-]+)$/))) { sessions.delete(m[1]); res.writeHead(204); return res.end(); }
      if (req.method === 'GET' && (m = pathname.match(/^\/result\/([\w-]+)\/(\d+)$/))) {
        const img = sessions.get(m[1])?.images[Number(m[2])];
        if (!img) throw fail(404, 'Result not found or expired.');
        res.writeHead(200, { 'Content-Type': img.type, 'Cache-Control': 'no-store' });
        return res.end(img.bytes);
      }
      if (req.method === 'GET') return serveStatic(res, pathname);
      throw fail(405, 'Method not allowed.');
    } catch (e) {
      const status = e.status ?? 500;
      if (status === 500) console.error('internal error:', e.name);
      send(res, status, { error: status === 500 ? 'Internal error.' : e.message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile('.env.local'); } catch { /* no env file: demo mode */ }
  const key = process.env.YOUCAM_API_KEY;
  const ledger = createGuard();
  const client = key ? createClient({ base: process.env.YOUCAM_BASE || DEFAULT_BASE, key, guard: ledger }) : null;
  const sessions = createSessions();
  setInterval(() => sessions.sweep(), 30_000).unref();
  const catalog = JSON.parse(readFileSync(join(ROOT, 'catalog.json'), 'utf8'));
  const server = createApp({ client, ledger, sessions, catalog });
  server.listen(process.env.PORT === undefined ? 8787 : Number(process.env.PORT), () => console.log(`listening on http://localhost:${server.address().port} mode=${client ? 'live' : 'demo'}`));
}
