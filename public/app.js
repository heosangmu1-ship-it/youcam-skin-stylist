const $ = (id) => document.getElementById(id);
let cfg, session, preview, picked;

const say = (msg, err = false) => { $('status').textContent = msg; $('status').className = err ? 'error' : ''; };
async function api(path, opts) {
  const r = await fetch(path, opts);
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `Request failed (${r.status})`), { code: j.code });
  return j;
}
const units = () => { $('units').textContent = cfg.mode === 'live' ? `Free units used: ${cfg.unitsSpent} of ${cfg.unitCap}` : 'Demo mode: recorded results, no API units used.'; };
const refresh = async () => { cfg = await api('/api/config'); units(); };
const MIN_SIDE = 480, MAX_BYTES = 8 * 1024 * 1024;
// Warn only, never block: the server and YouCam decide.
async function checkPhoto(f) {
  const warns = [];
  if (f.size > MAX_BYTES) warns.push('The file is larger than 8 MB and will be rejected.');
  try {
    const bmp = await createImageBitmap(f);
    if (Math.min(bmp.width, bmp.height) < MIN_SIDE) warns.push(`The short side is ${Math.min(bmp.width, bmp.height)} px; use at least ${MIN_SIDE} px.`);
    bmp.close();
  } catch { warns.push('This image could not be read in the browser.'); }
  $('photo-note').textContent = warns.length ? `${warns.join(' ')} See the photo tips above.` : '';
}
const ready = () => ($('analyze').disabled = !($('consent').checked && (picked || $('file').files[0])));

function el(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
}

const step = (n) => document.querySelectorAll('#steps li').forEach((li, i) => { li.toggleAttribute('aria-current', i === n - 1); li.classList.toggle('done', i < n - 1); if (i === n - 1) li.setAttribute('aria-current', 'step'); });

function reset() {
  session = null;
  step(1);
  for (const id of ['skin', 'looks', 'delete']) $(id).hidden = true;
  $('grid').replaceChildren();
}

async function init() {
  await refresh();
  $('mode').hidden = false;
  $('mode').textContent = cfg.mode === 'live' ? 'Live YouCam API' : 'Demo mode (no API key)';
  $('samples').replaceChildren(...cfg.samples.map((s) => {
    const input = el('input', { type: 'radio', name: 'sample', value: s.id });
    input.addEventListener('change', () => { picked = s; $('file').value = ''; ready(); });
    const name = `Sample ${String.fromCharCode(65 + cfg.samples.indexOf(s))}`;
    return el('label', {}, input, el('img', { src: s.url, alt: name }), el('span', {}, name));
  }));
  $('file').addEventListener('change', () => { picked = null; document.querySelectorAll('[name=sample]').forEach((r) => (r.checked = false)); $('tips').classList.remove('flag'); $('photo-note').textContent = ''; if ($('file').files[0]) checkPhoto($('file').files[0]); ready(); });
  $('consent').addEventListener('change', ready);
  $('analyze').addEventListener('click', analyze);
  $('tryon').addEventListener('click', tryon);
  $('delete').addEventListener('click', del);
}

async function analyze() {
  reset();
  $('analyze').disabled = true;
  say('Analyzing skin...');
  try {
    const f = $('file').files[0];
    preview = picked ? picked.url : URL.createObjectURL(f);
    session = await api(picked ? `/api/skin?sample=${encodeURIComponent(picked.id)}` : '/api/skin', {
      method: 'POST', headers: { 'X-Consent': 'yes', ...(picked ? {} : { 'Content-Type': f.type }) }, body: picked ? undefined : f,
    });
    $('concerns').replaceChildren(...session.concerns.map((c) => el('li', { className: c.score < 80 ? 'flagged' : '' },
      el('div', { className: 'row' }, el('strong', {}, c.label), el('span', { className: 'tag' }, c.score < 80 ? 'Worth styling for' : 'Healthy'), el('span', { className: 'num' }, `${c.score}/100, ${c.verdict}`)),
      el('div', { className: 'bar', role: 'img', ariaLabel: `${c.label} ${c.score} out of 100, marker at 80` }, el('span', { style: `width:${c.score}%` })))));
    $('skin').hidden = false; $('delete').hidden = false;
    step(2);
    say('Skin result ready.');
  } catch (e) {
    say(e.message, true);
    if (e.code) { $('tips').classList.add('flag'); $('photo-note').textContent = `${e.message} Check the photo tips above.`; }
  }
  await refresh().catch(() => {});
  ready();
}

function look(l, featured) {
  const r = session.ranked.find((x) => x.id === l.garmentId);
  const g = cfg.garments.find((x) => x.id === l.garmentId);
  const t = l.traits ?? r.traits;
  const shot = l.imageUrl ? el('figure', { className: 'shot' },
    el('img', { className: 'after', src: l.imageUrl, alt: `You wearing ${r.name}` }),
    el('img', { className: 'before', src: preview, alt: 'Your photo' }),
    el('figcaption', {}, 'After')) : el('p', { className: 'err' }, l.error);
  const whys = (l.why ?? '').split(/(?<=\.) /).filter(Boolean);
  return el('article', { className: featured ? 'look featured' : 'look' }, shot, el('div', {},
    el('p', { className: 'kicker' }, featured ? 'Best match' : 'Also good'),
    el('h3', {}, r.name),
    el('div', { className: 'garment' }, el('img', { src: g.url, alt: `${r.name} garment` }),
      el('p', { className: 'traits' }, el('span', { className: 'swatch', style: `background:${t.color}` }), `${t.tone} tone, brightness ${t.brightness}/100, ${t.fabric}`)),
    el('ul', { className: 'whys' }, ...whys.map((w) => el('li', {}, w)))));
}

async function tryon() {
  $('tryon').disabled = true;
  say('Rendering looks, this can take a minute...');
  $('grid').setAttribute('aria-busy', 'true');
  $('grid').replaceChildren(...[0, 1, 2].map((i) => el('article', { className: i ? 'look sk' : 'look sk featured' }, el('div', { className: 'skel' }), el('div', {}, el('div', { className: 'skel line' }), el('div', { className: 'skel line' })))));
  $('looks').hidden = false;
  try {
    const garmentIds = session.ranked.slice(0, 3).map((r) => r.id);
    const { looks } = await api('/api/tryon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.sessionId, garmentIds }) });
    $('grid').replaceChildren(...looks.map((l, i) => look(l, i === 0)));
    step(3);
    say(looks.every((l) => l.imageUrl) ? 'Looks ready.' : 'Some looks failed, see the cards.', !looks.every((l) => l.imageUrl));
  } catch (e) { $('grid').replaceChildren(); $('looks').hidden = true; say(e.message, true); }
  $('grid').setAttribute('aria-busy', 'false');
  await refresh().catch(() => {});
  $('tryon').disabled = false;
}

async function del() {
  try { await api(`/api/session/${session.sessionId}`, { method: 'DELETE' }); } catch (e) { return say(e.message, true); }
  reset();
  say('Session deleted. Your photo is gone from this app.');
}

init().catch((e) => say(e.message, true));
