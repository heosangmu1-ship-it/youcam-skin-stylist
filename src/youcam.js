import { COSTS } from './units.js';

export const DEFAULT_BASE = 'https://yce-api-01.makeupar.com';
// SD concern names only; never mix with HD names. 4 concerns = 9 units.
export const SKIN_CONCERNS = ['radiance', 'redness', 'dark_circle_v2', 'moisture'];
export const GARMENT_CATEGORY = 'full_body';

const FRIENDLY = {
  error_below_min_image_size: 'The photo is too small. Use a larger, sharper photo.',
  error_src_face_too_small: 'The face is too small in the photo. Use a close head-and-shoulders portrait where the face fills about 60-80% of the width.',
  error_src_face_out_of_bound: 'The face is cut off. Keep the whole face inside the frame.',
  error_lighting_dark: 'The photo is too dark. Use even, bright lighting.',
  error_pose: 'The pose could not be used. Face the camera with the upper body visible.',
  error_invalid_ref: 'The garment image was rejected by the try-on service.',
  error_apply_region_mismatch: 'This garment does not fit the body region in the photo.',
  error_multi_person: 'More than one person found. Use a photo with one person.',
  error_nsfw_content_detected: 'The photo was rejected by the content filter.',
  error_download_image: 'The service could not fetch the image. Try again.',
  rate_limited: 'YouCam rate limit reached. Wait a minute and retry.',
  timeout: 'YouCam took too long to answer. Try again.',
  upload_failed: 'Uploading the photo to YouCam failed.',
};
const USER_FIXABLE = new Set(Object.keys(FRIENDLY).filter((k) => k.startsWith('error_') && k !== 'error_download_image'));

export class YoucamError extends Error {
  constructor(code) {
    super(FRIENDLY[code] ?? 'YouCam could not complete the request.');
    this.name = 'YoucamError';
    this.code = String(code);
    this.userFixable = USER_FIXABLE.has(code);
    this.status = USER_FIXABLE.has(code) ? 422 : 502;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createClient({ base = DEFAULT_BASE, key, guard, fetchFn = fetch, pollMs = 2000, timeoutMs = 90000 }) {
  // Error messages never carry URLs or the key.
  async function call(method, path, body) {
    const res = await fetchFn(base + path, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body && JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new YoucamError(res.status === 429 ? 'rate_limited' : (j.error ?? j.data?.error ?? j.error_code ?? `http_${res.status}`));
    return j.data;
  }

  async function poll(path) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const d = await call('GET', path);
      if (d.task_status === 'success') return d;
      if (d.task_status === 'error') throw new YoucamError(d.error ?? d.error_code ?? 'unknown_internal_error');
      if (Date.now() >= end) throw new YoucamError('timeout');
      await sleep(pollMs);
    }
  }

  async function upload(bytes, type) {
    const d = await call('POST', '/s2s/v2.0/file', { files: [{ content_type: type, file_name: `photo.${type === 'image/png' ? 'png' : 'jpg'}`, file_size: bytes.length }] });
    const f = d.files[0];
    const rq = f.requests[0];
    // fetch sets Content-Length itself; the signed URL takes no Authorization.
    const headers = Object.fromEntries(Object.entries(rq.headers ?? {}).filter(([k]) => k.toLowerCase() !== 'content-length'));
    const put = await fetchFn(rq.url, { method: rq.method ?? 'PUT', headers, body: bytes });
    if (!put.ok) throw new YoucamError('upload_failed');
    return f.file_id;
  }

  async function skinRaw(fileId) {
    const c = await call('POST', '/s2s/v2.0/task/skin-analysis', { src_file_id: fileId, dst_actions: SKIN_CONCERNS, format: 'json' });
    return (await poll(`/s2s/v2.0/task/skin-analysis/${c.task_id}`)).results.output;
  }

  async function tryonRaw(srcId, refId) {
    const c = await call('POST', '/s2s/v2.0/task/cloth-v4', { src_file_id: srcId, ref_file_id: refId, garment_category: GARMENT_CATEGORY });
    const d = await poll(`/s2s/v2.0/task/cloth-v4/${c.task_id}`);
    const img = await fetchFn(d.results.url); // short-lived signed URL: fetch at once, no auth header
    if (!img.ok) throw new YoucamError('error_download_image');
    return { bytes: Buffer.from(await img.arrayBuffer()), type: img.headers.get('content-type') || 'image/png' };
  }

  return {
    upload,
    skin: (fileId) => guard.run(COSTS.skin, () => skinRaw(fileId)),
    tryon: (srcId, refId) => guard.run(COSTS.tryon, () => tryonRaw(srcId, refId)),
    // Reserve first so a refused call makes zero network requests (uploads included).
    analyze: (bytes, type) => guard.run(COSTS.skin, async () => { const fileId = await upload(bytes, type); return { fileId, output: await skinRaw(fileId) }; }),
    tryOnGarment: (srcId, bytes, type) => guard.run(COSTS.tryon, async () => tryonRaw(srcId, await upload(bytes, type))),
  };
}
