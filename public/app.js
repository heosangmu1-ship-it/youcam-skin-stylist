const $ = (id) => document.getElementById(id);
let cfg, session, preview, picked;

const say = (msg, err = false) => { $('status').textContent = msg; $('status').className = err ? 'error' : ''; };
async function api(path, opts) {
  const r = await fetch(path, opts);
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
const units = () => { $('units').textContent = cfg.mode === 'live' ? `Free units used: ${cfg.unitsSpent} of ${cfg.unitCap}` : 'Demo mode: recorded results, no API units used.'; };
const refresh = async () => { cfg = await api('/api/config'); units(); };
const ready = () => ($('analyze').disabled = !($('consent').checked && (picked || $('file').files[0])));

function el(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
}

function reset() {
  session = null;
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
    return el('label', {}, input, el('img', { src: s.url, alt: `Sample face ${s.id}`, width: 88, height: 104 }));
  }));
  $('file').addEventListener('change', () => { picked = null; document.querySelectorAll('[name=sample]').forEach((r) => (r.checked = false)); ready(); });
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
    $('concerns').replaceChildren(...session.concerns.map((c) => el('li', {},
      el('div', { className: 'row' }, el('strong', {}, c.label), el('span', {}, `${c.score}/100, ${c.verdict}`)),
      el('div', { className: 'bar', role: 'img', ariaLabel: `${c.label} ${c.score} out of 100` }, el('span', { style: `width:${c.score}%` })))));
    $('skin').hidden = false; $('delete').hidden = false;
    say('Skin result ready.');
  } catch (e) { say(e.message, true); }
  await refresh().catch(() => {});
  ready();
}

async function tryon() {
  $('tryon').disabled = true;
  say('Rendering looks, this can take a minute...');
  try {
    const garmentIds = session.ranked.slice(0, 3).map((r) => r.id);
    const { looks } = await api('/api/tryon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.sessionId, garmentIds }) });
    const name = (id) => session.ranked.find((r) => r.id === id).name;
    $('grid').replaceChildren(...looks.map((l) => el('article', { className: 'card' },
      el('div', { className: 'pair' },
        el('figure', {}, el('img', { src: preview, alt: 'Your photo' }), el('figcaption', {}, 'Before')),
        l.imageUrl ? el('figure', {}, el('img', { src: l.imageUrl, alt: `You wearing ${name(l.garmentId)}` }), el('figcaption', {}, 'After')) : el('p', { className: 'err' }, l.error)),
      el('h3', {}, name(l.garmentId)),
      l.why ? el('p', {}, l.why) : '')));
    $('looks').hidden = false;
    say(looks.every((l) => l.imageUrl) ? 'Looks ready.' : 'Some looks failed, see the cards.', !looks.every((l) => l.imageUrl));
  } catch (e) { say(e.message, true); }
  await refresh().catch(() => {});
  $('tryon').disabled = false;
}

async function del() {
  try { await api(`/api/session/${session.sessionId}`, { method: 'DELETE' }); } catch (e) { return say(e.message, true); }
  reset();
  say('Session deleted. Your photo is gone from this app.');
}

init().catch((e) => say(e.message, true));
