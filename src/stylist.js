// Rule-based stylist, no LLM. Pure functions.
// Polarity: YouCam ui_score higher = healthier skin (confirmed live).
export const HIGHER_IS_BETTER = true;
const quality = (score) => (HIGHER_IS_BETTER ? score : 100 - score); // 0..100, higher = healthier
export const severity = (score) => 100 - quality(score);
// Below this a concern is flagged as an area to care for (real demo scores sit at 58-99; 50 never fired).
export const WEAK_BELOW = 80;
export const isWeak = (score) => quality(score) < WEAK_BELOW;
export const verdict = (score) => (quality(score) >= WEAK_BELOW ? 'healthy' : quality(score) >= 50 ? 'okay' : 'needs care');

export const LABELS = { radiance: 'Radiance', redness: 'Redness', dark_circle_v2: 'Dark circles', moisture: 'Moisture' };

const MATTE = /matte|knit|wool|cotton|linen/i;
const SHINY = /satin|silk|shiny|sequin|leather|vinyl/i;

function hueSat(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return { h: 0, s: 0 };
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const l = (max + min) / 2;
  return { h: h * 60, s: d / (1 - Math.abs(2 * l - 1)) };
}
const redPink = (hex) => { const { h, s } = hueSat(hex); return (h <= 20 || h >= 330) && s > 0.4; };

// fit: -1..1 how well a garment helps one weak concern; why: clause for the reason line
export const RULES = {
  radiance: {
    fit: (g) => (g.brightness >= 55 && g.brightness <= 80 ? 1 : g.brightness < 35 ? -1 : 0),
    why: (n, g) => `Your radiance score is ${n}, so its mid-tone (brightness ${g.brightness}/100) near the face adds glow`,
  },
  redness: {
    fit: (g) => (g.tone === 'cool' ? 1 : g.tone === 'warm' ? -1 : 0) + (redPink(g.color) ? -1.5 : 0),
    why: (n, g) => `Your redness score is ${n}, so the ${g.name}'s ${g.tone} tone stays away from saturated red or pink`,
  },
  dark_circle_v2: {
    fit: (g) => (g.brightness < 30 ? -1 : g.brightness >= 55 ? 1 : 0),
    why: (n, g) => `Your dark circle score is ${n}, so its lighter color (brightness ${g.brightness}/100) keeps the eye area from looking shadowed`,
  },
  moisture: {
    fit: (g) => (SHINY.test(g.note) ? -1 : MATTE.test(g.note) ? 1 : 0),
    why: (n, g) => `Your moisture score is ${n}, so its ${g.note} looks kinder than a shiny fabric`,
  },
};

const sentence = (parts) => parts.map((p) => `${p}.`).join(' ');

export function rank(concerns, catalog) {
  const weak = concerns.filter((c) => RULES[c.key] && isWeak(c.score));
  return catalog
    .map((g, i) => {
      const parts = weak.map((c) => ({ c, v: (severity(c.score) / 100) * RULES[c.key].fit(g) }));
      const good = parts.filter((p) => p.v > 0).sort((a, b) => b.v - a.v).slice(0, 2);
      return {
        i, id: g.id, name: g.name,
        traits: { color: g.color, tone: g.tone, brightness: g.brightness, fabric: g.note },
        score: parts.reduce((t, p) => t + p.v, 0),
        why: good.length ? sentence(good.map((p) => RULES[p.c.key].why(p.c.score, g)))
          : weak.length ? 'A neutral pick that does not work against your skin result.'
          : 'No weak area in your skin result, so this is a balanced pick.',
      };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ id, name, why, traits }) => ({ id, name, why, traits }));
}

// Skin task output also holds non-concern entries (all, skin_age, resize_image): keep only the asked keys.
export const concernsFrom = (output, keys) => keys.flatMap((key) => {
  const o = output.find((x) => x.type === key);
  return o ? [{ key, label: LABELS[key], score: Math.round(o.ui_score), verdict: verdict(o.ui_score) }] : [];
});
