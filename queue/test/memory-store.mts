import type { Store } from '../netlify/functions/handler.mts';

export function memoryStore(): Store {
  const m = new Map<string, { v: string; etag: string }>();
  let n = 0;
  return {
    async get(key) {
      const r = m.get(key);
      return r ? { data: JSON.parse(r.v), etag: r.etag } : null;
    },
    async set(key, value, cond) {
      const cur = m.get(key);
      if (cond.onlyIfNew && cur) return false;
      if (cond.onlyIfMatch && cur?.etag !== cond.onlyIfMatch) return false;
      m.set(key, { v: JSON.stringify(value), etag: String(++n) });
      return true;
    },
    async del(key) { m.delete(key); },
  };
}
