// Pure queue logic: no I/O, so it can be unit-tested and reused by the dev server.

export type Status = 'waiting' | 'called' | 'serving' | 'done' | 'noshow' | 'left';

export interface Service { id: string; fr: string; en: string; min: number }
export interface Ticket {
  id: string;
  no: number;
  name: string;
  service: string;
  status: Status;
  source: 'self' | 'staff';
  joinedAt: number;
  calledAt?: number;
  startedAt?: number;
  doneAt?: number;
  tokenHash?: string; // SHA-256 of the customer's secret; never sent to clients
}
export interface Config { bays: number; paused: boolean; services: Service[]; maxQueue: number }
export interface Day { day: string; nextNo: number; tickets: Ticket[] }

export const DEFAULT_CONFIG: Config = {
  bays: 2, // TODO(LUXOPLUS): confirm the number of bays; staff can change it in the console
  paused: false,
  maxQueue: 40,
  // Durations come from the app catalogue; the office can edit them in the console.
  services: [
    { id: 'express', fr: 'Express', en: 'Express', min: 30 },
    { id: 'signature_plus', fr: 'Signature+', en: 'Signature+', min: 120 },
    { id: 'absolux', fr: 'ABSOLUX', en: 'ABSOLUX', min: 300 },
  ],
};

export const CALL_GRACE_MIN = 10; // a called customer has this long to show up
export const MIN_REMAINING_MIN = 2; // an overrunning wash is assumed to end in 2 min
const MIN = 60_000;

export const ACTIVE: Status[] = ['waiting', 'called', 'serving'];

export function montrealDay(ts: number): string {
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montreal' }).format(new Date(ts));
}

export function emptyDay(ts: number): Day {
  return { day: montrealDay(ts), nextNo: 1, tickets: [] };
}

export function cleanName(raw: unknown): string {
  const s = String(raw ?? '')
    .normalize('NFKC')
    // keep letters, marks, digits, space, apostrophe, hyphen, period
    .replace(/[^\p{L}\p{M}\p{N} '’.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.slice(0, 24);
}

export function serviceMin(cfg: Config, id: string): number {
  return cfg.services.find((s) => s.id === id)?.min ?? 30;
}

export interface Eta { pos: number; ahead: number; start: number; ready: number }

/**
 * Same idea as the in-app Atelier line: each bay frees up when its job ends; waiting
 * cars are served in order of arrival on the first bay to free up. Called cars hold
 * a bay while they walk in. Returns an ETA per active ticket plus the wait for a new arrival.
 */
export function computeEtas(day: Day, cfg: Config, now: number): { etas: Map<string, Eta>; newWaitMin: number; busy: number; waiting: number } {
  const bays = Math.max(1, cfg.bays);
  const free: number[] = Array(bays).fill(now);
  const take = (): number => {
    let b = 0;
    for (let i = 1; i < free.length; i++) if (free[i] < free[b]) b = i;
    return b;
  };
  const etas = new Map<string, Eta>();
  let busy = 0;
  const serving = day.tickets.filter((t) => t.status === 'serving').sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  for (const t of serving) {
    const end = Math.max(now + MIN_REMAINING_MIN * MIN, (t.startedAt ?? now) + serviceMin(cfg, t.service) * MIN);
    const b = take();
    free[b] = Math.max(free[b], end);
    etas.set(t.id, { pos: 0, ahead: 0, start: t.startedAt ?? now, ready: end });
    busy++;
  }
  const called = day.tickets.filter((t) => t.status === 'called').sort((a, b) => (a.calledAt ?? 0) - (b.calledAt ?? 0));
  for (const t of called) {
    const start = Math.max(now, (t.calledAt ?? now) + 2 * MIN);
    const end = start + serviceMin(cfg, t.service) * MIN;
    const b = take();
    free[b] = Math.max(free[b], end);
    etas.set(t.id, { pos: 0, ahead: 0, start, ready: end });
    busy++;
  }
  const waiting = day.tickets.filter((t) => t.status === 'waiting').sort((a, b) => a.joinedAt - b.joinedAt || a.no - b.no);
  let pos = 0;
  for (const t of waiting) {
    const b = take();
    const start = Math.max(now, free[b]);
    const end = start + serviceMin(cfg, t.service) * MIN;
    free[b] = end;
    pos++;
    etas.set(t.id, { pos, ahead: pos - 1, start, ready: end });
  }
  const earliest = Math.min(...free);
  return { etas, newWaitMin: Math.max(0, Math.ceil((earliest - now) / MIN)), busy: Math.min(busy, bays), waiting: waiting.length };
}

export type Act =
  | { type: 'join'; name: string; service: string; source: 'self' | 'staff'; tokenHash?: string }
  | { type: 'leave'; id: string }
  | { type: 'call'; id?: string }
  | { type: 'start'; id: string }
  | { type: 'done'; id: string }
  | { type: 'noshow'; id: string }
  | { type: 'requeue'; id: string }
  | { type: 'remove'; id: string };

export class QueueError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) { super(code); this.code = code; this.status = status; }
}

/** Applies one action to a copy of the day. Throws QueueError for rule violations. */
export function apply(day: Day, cfg: Config, act: Act, now: number, newId: () => string): { day: Day; ticket?: Ticket } {
  const d: Day = { ...day, tickets: day.tickets.map((t) => ({ ...t })) };
  const find = (id: string) => {
    const t = d.tickets.find((x) => x.id === id);
    if (!t) throw new QueueError('not_found', 404);
    return t;
  };
  const must = (t: Ticket, ...from: Status[]) => {
    if (!from.includes(t.status)) throw new QueueError('bad_state', 409);
  };
  switch (act.type) {
    case 'join': {
      if (cfg.paused && act.source === 'self') throw new QueueError('paused', 423);
      if (!cfg.services.some((s) => s.id === act.service)) throw new QueueError('bad_service');
      const name = cleanName(act.name);
      if (!name) throw new QueueError('bad_name');
      if (d.tickets.filter((t) => ACTIVE.includes(t.status)).length >= cfg.maxQueue) throw new QueueError('full', 409);
      const t: Ticket = { id: newId(), no: d.nextNo++, name, service: act.service, status: 'waiting', source: act.source, joinedAt: now, tokenHash: act.tokenHash };
      d.tickets.push(t);
      return { day: d, ticket: t };
    }
    case 'leave': {
      const t = find(act.id);
      must(t, 'waiting', 'called');
      t.status = 'left'; t.doneAt = now;
      return { day: d, ticket: t };
    }
    case 'call': {
      // Call a specific waiting ticket or the next in line.
      const next = act.id ? find(act.id) : d.tickets.filter((t) => t.status === 'waiting').sort((a, b) => a.joinedAt - b.joinedAt || a.no - b.no)[0];
      if (!next) throw new QueueError('empty', 409);
      must(next, 'waiting');
      next.status = 'called'; next.calledAt = now;
      return { day: d, ticket: next };
    }
    case 'start': {
      const t = find(act.id);
      must(t, 'called', 'waiting');
      t.status = 'serving'; t.startedAt = now;
      return { day: d, ticket: t };
    }
    case 'done': {
      const t = find(act.id);
      must(t, 'serving');
      t.status = 'done'; t.doneAt = now;
      return { day: d, ticket: t };
    }
    case 'noshow': {
      const t = find(act.id);
      must(t, 'called', 'waiting');
      t.status = 'noshow'; t.doneAt = now;
      return { day: d, ticket: t };
    }
    case 'requeue': {
      // A called customer who did not show up yet goes back to the line, keeping their place.
      const t = find(act.id);
      must(t, 'called');
      t.status = 'waiting'; delete t.calledAt;
      return { day: d, ticket: t };
    }
    case 'remove': {
      const t = find(act.id);
      must(t, 'waiting', 'called', 'serving');
      t.status = 'left'; t.doneAt = now;
      return { day: d, ticket: t };
    }
  }
}

/** Closes tickets left open overnight or by mistake so a stale state can never block the line. */
export function sweep(day: Day, now: number): Day {
  let changed = false;
  const tickets = day.tickets.map((t) => {
    if (t.status === 'serving' && t.startedAt && now - t.startedAt > 12 * 60 * MIN) {
      changed = true; return { ...t, status: 'done' as Status, doneAt: now };
    }
    return t;
  });
  return changed ? { ...day, tickets } : day;
}

export interface PublicTicket {
  id: string; no: number; name: string; service: string; status: Status;
  pos: number; ahead: number; startAt: number | null; readyAt: number | null; late: boolean;
}

export function publicView(day: Day, cfg: Config, now: number) {
  const { etas, newWaitMin, busy, waiting } = computeEtas(day, cfg, now);
  const active: PublicTicket[] = day.tickets
    .filter((t) => ACTIVE.includes(t.status))
    .map((t) => {
      const e = etas.get(t.id);
      return {
        id: t.id, no: t.no, name: t.name, service: t.service, status: t.status,
        pos: e?.pos ?? 0, ahead: e?.ahead ?? 0, startAt: e?.start ?? null, readyAt: e?.ready ?? null,
        late: t.status === 'called' && !!t.calledAt && now - t.calledAt > CALL_GRACE_MIN * MIN,
      };
    })
    .sort((a, b) => rank(a) - rank(b) || a.no - b.no);
  return {
    now, day: day.day,
    bays: cfg.bays, busy, waiting, paused: cfg.paused, newWaitMin,
    services: cfg.services, tickets: active,
    served: day.tickets.filter((t) => t.status === 'done').length,
  };
}
const rank = (t: { status: Status }) => (t.status === 'serving' ? 0 : t.status === 'called' ? 1 : 2);

export function validateConfigPatch(p: unknown): Partial<Config> {
  const o = (p ?? {}) as Record<string, unknown>;
  const out: Partial<Config> = {};
  if (o.bays !== undefined) {
    const n = Number(o.bays);
    if (!Number.isInteger(n) || n < 1 || n > 12) throw new QueueError('bad_bays');
    out.bays = n;
  }
  if (o.paused !== undefined) out.paused = o.paused === true;
  if (o.maxQueue !== undefined) {
    const n = Number(o.maxQueue);
    if (!Number.isInteger(n) || n < 1 || n > 200) throw new QueueError('bad_max');
    out.maxQueue = n;
  }
  if (o.services !== undefined) {
    if (!Array.isArray(o.services) || o.services.length < 1 || o.services.length > 12) throw new QueueError('bad_services');
    out.services = o.services.map((s) => {
      const r = s as Record<string, unknown>;
      const id = String(r.id ?? '');
      const min = Number(r.min);
      if (!/^[a-z0-9_]{1,24}$/.test(id) || !Number.isInteger(min) || min < 5 || min > 600) throw new QueueError('bad_services');
      return { id, fr: cleanName(r.fr) || id, en: cleanName(r.en) || cleanName(r.fr) || id, min };
    });
  }
  return out;
}
