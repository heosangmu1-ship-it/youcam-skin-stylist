// Unit guard: every paid YouCam call must go through reserve/commit/release.
// Ledger lives in a file, re-read on every op (sync I/O = serialized in-process,
// and a second process such as a script sees the same numbers). Reserved units
// stay on disk until settled, so a crash mid-call is counted as spent next run.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const COSTS = { skin: 9, tryon: 2 }; // skin: <= 4 SD concerns; tryon: v4 assumed 2 until measured

export class UnitCapError extends Error {
  constructor(msg) { super(msg); this.name = 'UnitCapError'; this.status = 429; }
}

export function createGuard({ path = process.env.LEDGER_PATH || 'var/units.json', cap = Number(process.env.UNIT_CAP) } = {}) {
  if (!(cap > 0)) cap = 800;
  const load = () => {
    try { return JSON.parse(readFileSync(path, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return { spent: 0, reserved: 0 }; throw e; } // corrupt ledger: fail closed
  };
  const save = (s) => {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(s));
    renameSync(tmp, path);
  };
  const guard = {
    cap,
    get spent() { return load().spent; },
    reserve(cost) {
      const s = load();
      if (s.spent + s.reserved + cost > cap) throw new UnitCapError(`Free-unit cap reached (${s.spent} of ${cap} used). Demo mode still works.`);
      s.reserved += cost;
      save(s);
      let done = false;
      const settle = (commit) => {
        if (done) return;
        done = true;
        const t = load();
        t.reserved = Math.max(0, t.reserved - cost);
        if (commit) t.spent += cost;
        save(t);
      };
      return { commit: () => settle(true), release: () => settle(false) };
    },
    async run(cost, fn) {
      const r = guard.reserve(cost);
      try { const v = await fn(); r.commit(); return v; }
      catch (e) { r.release(); throw e; }
    },
  };
  return guard;
}
