// HTTP layer, independent from Netlify so the dev server and tests can run it with an in-memory store.
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  type Act, type Config, type Day, DEFAULT_CONFIG, QueueError, apply, emptyDay, montrealDay,
  publicView, sweep, validateConfigPatch,
} from './core.mts';

export interface Stored<T> { data: T; etag: string }
export interface Store {
  get<T>(key: string): Promise<Stored<T> | null>;
  /** Returns false when the conditional write lost a race. */
  set(key: string, value: unknown, cond: { onlyIfMatch?: string; onlyIfNew?: boolean }): Promise<boolean>;
  del(key: string): Promise<void>;
}
export interface Deps {
  store: Store;
  env: (k: string) => string | undefined;
  now: () => number;
}

const H = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: H });
const fail = (code: string, status = 400, extra: Record<string, unknown> = {}) => json({ error: code, ...extra }, status);

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const safeEq = (a: string, b: string) => {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
};
const b64u = (b: Buffer) => b.toString('base64url');

export function createHandler(deps: Deps) {
  const { store, env, now } = deps;

  const secret = () => env('SESSION_SECRET') ?? '';
  const sign = (payload: string) => b64u(createHmac('sha256', secret()).update(payload).digest());

  // ---- sessions (staff console 12 h, TV board 14 days) -------------------
  function issue(role: 'staff' | 'tv'): { token: string; exp: number } {
    const exp = now() + (role === 'staff' ? 12 * 3600_000 : 14 * 86_400_000);
    const p = b64u(Buffer.from(JSON.stringify({ r: role, exp })));
    return { token: `${p}.${sign(p)}`, exp };
  }
  function session(req: Request): 'staff' | 'tv' | null {
    if (!secret()) return null;
    const m = /^Bearer ([\w-]+\.[\w-]+)$/.exec(req.headers.get('authorization') ?? '');
    if (!m) return null;
    const [p, sig] = m[1].split('.');
    if (!safeEq(sig, sign(p))) return null;
    try {
      const o = JSON.parse(Buffer.from(p, 'base64url').toString());
      if (typeof o.exp !== 'number' || o.exp < now()) return null;
      return o.r === 'staff' || o.r === 'tv' ? o.r : null;
    } catch { return null; }
  }
  /** Daily code carried by the in-store QR so a link shared online is of little use. */
  const dayKey = (day: string) => createHmac('sha256', secret()).update(`join:${day}`).digest('hex').slice(0, 8);

  // ---- storage helpers ---------------------------------------------------
  async function loadConfig(): Promise<Stored<Config> | null> {
    return store.get<Config>('config');
  }
  const cfgOf = (s: Stored<Config> | null): Config => ({ ...DEFAULT_CONFIG, ...(s?.data ?? {}) });

  async function mutateDay<T>(fn: (day: Day, cfg: Config) => { day: Day; out: T }): Promise<T> {
    for (let i = 0; i < 6; i++) {
      const t = now();
      const cfg = cfgOf(await loadConfig());
      const cur = await store.get<Day>('day');
      let day = cur && cur.data.day === montrealDay(t) ? cur.data : emptyDay(t);
      day = sweep(day, t);
      const r = fn(day, cfg);
      const ok = await store.set('day', r.day, cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
      if (ok) return r.out;
    }
    throw new QueueError('busy', 503);
  }
  async function readDay(): Promise<{ day: Day; cfg: Config }> {
    const t = now();
    const cfg = cfgOf(await loadConfig());
    const cur = await store.get<Day>('day');
    const day = cur && cur.data.day === montrealDay(t) ? cur.data : emptyDay(t);
    return { day: sweep(day, t), cfg };
  }

  // ---- best-effort rate limiting (per IP) --------------------------------
  async function limited(kind: string, ip: string, max: number, windowMs: number): Promise<boolean> {
    const key = `rl:${kind}:${sha(ip).slice(0, 16)}`;
    const t = now();
    const cur = await store.get<{ n: number; from: number }>(key);
    const rec = cur && t - cur.data.from < windowMs ? cur.data : { n: 0, from: t };
    if (rec.n >= max) return true;
    await store.set(key, { n: rec.n + 1, from: rec.from }, cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
    return false;
  }
  const clientIp = (req: Request) => req.headers.get('x-nf-client-connection-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';

  async function body(req: Request): Promise<Record<string, unknown>> {
    if (!(req.headers.get('content-type') ?? '').includes('application/json')) throw new QueueError('bad_type', 415);
    const txt = await req.text();
    if (txt.length > 4096) throw new QueueError('too_large', 413);
    try {
      const o = JSON.parse(txt);
      if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, unknown>;
    } catch { /* fallthrough */ }
    throw new QueueError('bad_json');
  }

  function sameOrigin(req: Request): boolean {
    const o = req.headers.get('origin');
    if (!o) return true; // non-browser clients; browsers always send Origin on POST
    try { return new URL(o).host === new URL(req.url).host; } catch { return false; }
  }

  // ---- routes ------------------------------------------------------------
  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '');
    try {
      if (req.method === 'POST' && !sameOrigin(req)) return fail('bad_origin', 403);

      if (req.method === 'GET' && path === '/api/state') {
        const { day, cfg } = await readDay();
        const view = publicView(day, cfg, now());
        const id = url.searchParams.get('t');
        let mine: { id: string; no: number; status: string } | null = null;
        if (id && /^[0-9a-f-]{36}$/.test(id)) {
          const t = day.tickets.find((x) => x.id === id);
          if (t) mine = { id: t.id, no: t.no, status: t.status };
        }
        return json({ ...view, mine });
      }

      if (req.method === 'GET' && path === '/api/key') {
        if (!session(req)) return fail('unauthorized', 401);
        return json({ key: dayKey(montrealDay(now())) });
      }

      if (req.method === 'POST' && path === '/api/login') {
        if (!secret() || !env('STAFF_PIN')) return fail('not_configured', 503);
        const ip = clientIp(req);
        if (await limited('login', ip, 6, 10 * 60_000)) return fail('rate_limited', 429);
        const b = await body(req);
        const role = b.role === 'tv' ? 'tv' : 'staff';
        if (typeof b.pin !== 'string' || !safeEq(b.pin, env('STAFF_PIN')!)) return fail('bad_pin', 401);
        const s = issue(role);
        return json({ token: s.token, exp: s.exp, role });
      }

      if (req.method === 'POST' && path === '/api/join') {
        if (!secret()) return fail('not_configured', 503);
        const b = await body(req);
        const staff = session(req) === 'staff';
        if (!staff) {
          if (await limited('join', clientIp(req), 4, 10 * 60_000)) return fail('rate_limited', 429);
          const k = typeof b.k === 'string' ? b.k : '';
          if (!safeEq(k, dayKey(montrealDay(now())))) return fail('bad_key', 403);
        }
        const token = randomBytes(24).toString('base64url');
        const r = await mutateDay((day, cfg) => {
          const x = apply(day, cfg, {
            type: 'join', name: String(b.name ?? ''), service: String(b.service ?? ''),
            source: staff ? 'staff' : 'self', tokenHash: sha(token),
          }, now(), randomUUID);
          return { day: x.day, out: x.ticket! };
        });
        return json({ id: r.id, no: r.no, token: staff ? undefined : token }, 201);
      }

      if (req.method === 'POST' && path === '/api/leave') {
        const b = await body(req);
        await mutateDay((day, cfg) => {
          const t = day.tickets.find((x) => x.id === b.id);
          if (!t || !t.tokenHash || typeof b.token !== 'string' || !safeEq(sha(b.token), t.tokenHash)) throw new QueueError('forbidden', 403);
          return { day: apply(day, cfg, { type: 'leave', id: t.id }, now(), randomUUID).day, out: null };
        });
        return json({ ok: true });
      }

      if (path.startsWith('/api/staff/')) {
        if (session(req) !== 'staff') return fail('unauthorized', 401);

        if (req.method === 'POST' && path === '/api/staff/act') {
          const b = await body(req);
          const type = String(b.type ?? '');
          const allowed = ['call', 'start', 'done', 'noshow', 'requeue', 'remove'];
          if (!allowed.includes(type)) throw new QueueError('bad_action');
          const act = { type, id: typeof b.id === 'string' ? b.id : undefined } as Act;
          const out = await mutateDay((day, cfg) => {
            const x = apply(day, cfg, act, now(), randomUUID);
            return { day: x.day, out: x.ticket ? { id: x.ticket.id, no: x.ticket.no, status: x.ticket.status } : null };
          });
          return json({ ok: true, ticket: out });
        }

        if (req.method === 'POST' && path === '/api/staff/config') {
          const patch = validateConfigPatch(await body(req));
          for (let i = 0; i < 6; i++) {
            const cur = await loadConfig();
            const next = { ...cfgOf(cur), ...patch };
            if (await store.set('config', next, cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true })) return json({ ok: true, config: next });
          }
          throw new QueueError('busy', 503);
        }

        if (req.method === 'GET' && path === '/api/staff/key') return json({ key: dayKey(montrealDay(now())) });
      }

      return fail('not_found', 404);
    } catch (e) {
      if (e instanceof QueueError) return fail(e.code, e.status);
      console.error('queue api error', e instanceof Error ? e.message : 'unknown'); // never log request bodies (names)
      return fail('server_error', 500);
    }
  };
}
