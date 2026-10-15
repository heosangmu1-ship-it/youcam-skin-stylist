import { randomUUID } from 'node:crypto';

// In-memory only. Sessions die ttlMs after creation (privacy bound, not idle timeout).
export function createSessions({ ttlMs = 10 * 60 * 1000, now = Date.now } = {}) {
  const m = new Map();
  const alive = (s) => s && now() - s.createdAt < ttlMs;
  return {
    create(data) { const s = { ...data, id: randomUUID(), createdAt: now(), images: [] }; m.set(s.id, s); return s; },
    get(id) { const s = m.get(id); if (alive(s)) return s; m.delete(id); return undefined; },
    delete(id) { return m.delete(id); },
    sweep() { for (const [id, s] of m) if (!alive(s)) m.delete(id); },
    get size() { return m.size; },
  };
}
