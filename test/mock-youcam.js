// Local fake of the YouCam endpoints used by the app. Counters + error switch.
import http from 'node:http';
import { readFileSync } from 'node:fs';

const PNG = Buffer.from(readFileSync(new URL('../public/garments/sage-cardigan.png', import.meta.url)));

export async function startMock({ key = 'test-key' } = {}) {
  const counters = { file: 0, put: 0, skin: 0, tryon: 0, polls: 0, unauthorized: 0 };
  const mock = { counters, fail: { skin: null, tryon: null }, runningPolls: 1 };
  const files = new Set(); const tasks = new Map();
  let base;
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const path = req.url;
      if (req.method === 'PUT' && path.startsWith('/upload/')) { counters.put++; files.add(path.slice(8)); res.writeHead(200); return res.end(); }
      if (path === '/result.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
      if (req.headers.authorization !== `Bearer ${key}`) { counters.unauthorized++; return json(res, 401, { status: 401, error: 'unauthorized' }); }
      const b = body.length ? JSON.parse(body) : {};
      if (req.method === 'POST' && path === '/s2s/v2.0/file') {
        counters.file++;
        const id = `f${counters.file}`;
        return json(res, 200, { status: 200, data: { files: [{ file_id: id, requests: [{ method: 'PUT', url: `${base}/upload/${id}`, headers: { 'Content-Type': b.files[0].content_type, 'Content-Length': String(b.files[0].file_size) } }] }] } });
      }
      const kind = path.includes('skin-analysis') ? 'skin' : path.includes('cloth-v4') ? 'tryon' : null;
      if (kind && req.method === 'POST') {
        counters[kind]++;
        if (!files.has(b.src_file_id) || (kind === 'tryon' && !files.has(b.ref_file_id))) return json(res, 404, { status: 404, error: 'file_not_found' });
        const id = `t${counters.skin + counters.tryon}`;
        tasks.set(id, { kind, polls: 0 });
        return json(res, 200, { status: 200, data: { task_id: id } });
      }
      if (kind && req.method === 'GET') {
        counters.polls++;
        const t = tasks.get(path.split('/').pop());
        if (!t) return json(res, 404, { status: 404, error: 'task_not_found' });
        if (t.polls++ < mock.runningPolls) return json(res, 200, { status: 200, data: { task_status: 'running' } });
        if (mock.fail[kind]) return json(res, 200, { status: 200, data: { task_status: 'error', error: mock.fail[kind] } });
        const results = kind === 'skin'
          ? { output: [['radiance', 40], ['redness', 30], ['dark_circle_v2', 60], ['moisture', 75]].map(([type, s]) => ({ type, ui_score: s, raw_score: s, mask_urls: [] })).concat([{ type: 'all', score: 55 }, { type: 'skin_age', score: 31 }, { type: 'resize_image', url: 'x' }]) }
          : { url: `${base}/result.png` };
        return json(res, 200, { status: 200, data: { task_status: 'success', results } });
      }
      json(res, 404, { status: 404, error: 'not_found' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return Object.assign(mock, { url: base, close: () => server.close() });
}
