import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../netlify/functions/handler.mts';
import { DEFAULT_CONFIG, apply, cleanName, computeEtas, emptyDay, montrealDay, validateConfigPatch } from '../netlify/functions/core.mts';
import { memoryStore } from './memory-store.mts';

const T0 = Date.parse('2026-10-05T15:00:00Z');
let ids = 0;
const nid = () => `00000000-0000-0000-0000-${String(++ids).padStart(12, '0')}`;
const join = (d, name, service = 'express', at = T0) => apply(d, DEFAULT_CONFIG, { type: 'join', name, service, source: 'staff' }, at, nid).day;

test('cleanName strips markup and limits length', () => {
  assert.equal(cleanName('<img src=x onerror=1>Marie'), 'img srcx onerror1Marie'.slice(0, 24));
  assert.equal(cleanName('  Éloïse  D\'Amour '), "Éloïse D'Amour");
  assert.equal(cleanName('x'.repeat(100)).length, 24);
  assert.equal(cleanName('<>'), '');
});

test('ETA: two bays, express cars start in parallel then queue', () => {
  let d = emptyDay(T0);
  for (const n of ['A', 'B', 'C', 'D']) d = join(d, n, 'express', T0);
  const { etas, newWaitMin } = computeEtas(d, DEFAULT_CONFIG, T0);
  const e = d.tickets.map((t) => etas.get(t.id));
  assert.equal(e[0].start, T0); assert.equal(e[1].start, T0);
  assert.equal(e[2].start, T0 + 30 * 60_000); assert.equal(e[3].start, T0 + 30 * 60_000);
  assert.equal(e[3].pos, 4); assert.equal(e[3].ahead, 3);
  assert.equal(newWaitMin, 60);
});

test('ETA: an overrunning wash is assumed to end soon, never in the past', () => {
  let d = join(emptyDay(T0), 'A');
  d = apply(d, DEFAULT_CONFIG, { type: 'start', id: d.tickets[0].id }, T0, nid).day;
  const later = T0 + 90 * 60_000;
  const { etas } = computeEtas(d, DEFAULT_CONFIG, later);
  assert.ok(etas.get(d.tickets[0].id).ready >= later + 2 * 60_000);
});

test('state machine rules', () => {
  let d = join(join(emptyDay(T0), 'A'), 'B');
  const [a, b] = d.tickets;
  assert.throws(() => apply(d, DEFAULT_CONFIG, { type: 'done', id: a.id }, T0, nid), /bad_state/);
  d = apply(d, DEFAULT_CONFIG, { type: 'call' }, T0, nid).day;
  assert.equal(d.tickets[0].status, 'called'); // first come, first called
  d = apply(d, DEFAULT_CONFIG, { type: 'requeue', id: a.id }, T0, nid).day;
  assert.equal(d.tickets[0].status, 'waiting');
  d = apply(d, DEFAULT_CONFIG, { type: 'start', id: b.id }, T0, nid).day;
  d = apply(d, DEFAULT_CONFIG, { type: 'done', id: b.id }, T0, nid).day;
  assert.equal(d.tickets[1].status, 'done');
  assert.throws(() => apply(d, DEFAULT_CONFIG, { type: 'leave', id: b.id }, T0, nid), /bad_state/);
});

test('queue full and paused', () => {
  let d = emptyDay(T0);
  const cfg = { ...DEFAULT_CONFIG, maxQueue: 2 };
  d = apply(d, cfg, { type: 'join', name: 'A', service: 'express', source: 'self' }, T0, nid).day;
  d = apply(d, cfg, { type: 'join', name: 'B', service: 'express', source: 'self' }, T0, nid).day;
  assert.throws(() => apply(d, cfg, { type: 'join', name: 'C', service: 'express', source: 'self' }, T0, nid), /full/);
  assert.throws(() => apply(d, { ...cfg, paused: true, maxQueue: 9 }, { type: 'join', name: 'C', service: 'express', source: 'self' }, T0, nid), /paused/);
  assert.throws(() => apply(d, DEFAULT_CONFIG, { type: 'join', name: 'C', service: 'nope', source: 'self' }, T0, nid), /bad_service/);
});

test('config validation rejects bad input', () => {
  assert.throws(() => validateConfigPatch({ bays: 0 }));
  assert.throws(() => validateConfigPatch({ bays: 99 }));
  assert.throws(() => validateConfigPatch({ services: [{ id: 'Bad Id', min: 30 }] }));
  assert.throws(() => validateConfigPatch({ services: [{ id: 'ok', min: 1 }] }));
  assert.deepEqual(validateConfigPatch({ bays: 3, paused: true }), { bays: 3, paused: true });
});

test('Montreal day rolls at local midnight', () => {
  assert.equal(montrealDay(Date.parse('2026-10-06T03:30:00Z')), '2026-10-05'); // 23:30 EDT
  assert.equal(montrealDay(Date.parse('2026-10-06T04:30:00Z')), '2026-10-06');
});

// ---- HTTP layer ----------------------------------------------------------
function api(opts = {}) {
  let t = T0;
  const store = memoryStore();
  const env = { SESSION_SECRET: 's'.repeat(40), STAFF_PIN: '4321', ...opts.env };
  const h = createHandler({ store, env: (k) => env[k], now: () => t });
  const call = async (method, path, { body, token, headers } = {}) => {
    const r = await h(new Request(`https://q.test${path}`, {
      method, headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': opts.ip ?? '1.1.1.1', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }));
    return { status: r.status, body: await r.json() };
  };
  return { call, tick: (ms) => { t += ms; }, setIp: (ip) => { opts.ip = ip; } };
}
async function login(a, role = 'staff') {
  const r = await a.call('POST', '/api/login', { body: { pin: '4321', role } });
  assert.equal(r.status, 200);
  return r.body.token;
}

test('join requires the in-store daily key; staff do not', async () => {
  const a = api();
  const body = { name: 'Marie', service: 'express' };
  assert.equal((await a.call('POST', '/api/join', { body })).body.error, 'bad_key');
  assert.equal((await a.call('POST', '/api/join', { body: { ...body, k: 'deadbeef' } })).status, 403);
  const tv = await login(a, 'tv');
  const { key } = (await a.call('GET', '/api/key', { token: tv })).body;
  const ok = await a.call('POST', '/api/join', { body: { ...body, k: key } });
  assert.equal(ok.status, 201); assert.ok(ok.body.token);
  const staff = await login(a);
  const w = await a.call('POST', '/api/join', { body: { name: 'Walk', service: 'express' }, token: staff });
  assert.equal(w.status, 201); assert.equal(w.body.token, undefined);
});

test('state never leaks tokens or hashes; mine reflects own ticket', async () => {
  const a = api();
  const staff = await login(a);
  const r = await a.call('POST', '/api/join', { body: { name: 'Lou', service: 'express' }, token: staff });
  const s = await a.call('GET', `/api/state?t=${r.body.id}`);
  assert.equal(s.body.tickets.length, 1);
  assert.equal(s.body.mine.status, 'waiting');
  assert.ok(!JSON.stringify(s.body).includes('tokenHash'));
});

test('only the ticket owner can leave', async () => {
  const a = api();
  const tv = await login(a, 'tv');
  const { key } = (await a.call('GET', '/api/key', { token: tv })).body;
  const j = (await a.call('POST', '/api/join', { body: { name: 'Zed', service: 'express', k: key } })).body;
  assert.equal((await a.call('POST', '/api/leave', { body: { id: j.id, token: 'wrong' } })).status, 403);
  assert.equal((await a.call('POST', '/api/leave', { body: { id: j.id, token: j.token } })).status, 200);
  assert.equal((await a.call('GET', `/api/state?t=${j.id}`)).body.mine.status, 'left');
});

test('staff endpoints refuse anonymous, tv and forged tokens', async () => {
  const a = api();
  assert.equal((await a.call('POST', '/api/staff/act', { body: { type: 'call' } })).status, 401);
  const tv = await login(a, 'tv');
  assert.equal((await a.call('POST', '/api/staff/act', { body: { type: 'call' }, token: tv })).status, 401);
  assert.equal((await a.call('POST', '/api/staff/config', { body: { paused: true }, token: 'x.y' })).status, 401);
  const staff = await login(a);
  const forged = staff.split('.')[0] + '.AAAA';
  assert.equal((await a.call('POST', '/api/staff/act', { body: { type: 'call' }, token: forged })).status, 401);
  assert.equal((await a.call('GET', '/api/key')).status, 401);
});

test('session expires', async () => {
  const a = api();
  const staff = await login(a);
  a.tick(13 * 3600_000);
  assert.equal((await a.call('POST', '/api/staff/act', { body: { type: 'call' }, token: staff })).status, 401);
});

test('login is rate limited and rejects bad pins', async () => {
  const a = api();
  for (let i = 0; i < 6; i++) assert.equal((await a.call('POST', '/api/login', { body: { pin: '0000' } })).status, 401);
  assert.equal((await a.call('POST', '/api/login', { body: { pin: '4321' } })).status, 429);
  a.setIp('9.9.9.9');
  assert.equal((await a.call('POST', '/api/login', { body: { pin: '4321' } })).status, 200);
});

test('fails closed when secrets are missing', async () => {
  const a = api({ env: { SESSION_SECRET: '', STAFF_PIN: '' } });
  assert.equal((await a.call('POST', '/api/login', { body: { pin: '' } })).status, 503);
  assert.equal((await a.call('POST', '/api/join', { body: { name: 'x', service: 'express', k: '' } })).status, 503);
});

test('cross-origin POST and non-JSON bodies are rejected', async () => {
  const a = api();
  assert.equal((await a.call('POST', '/api/login', { body: { pin: '4321' }, headers: { origin: 'https://evil.test' } })).status, 403);
  assert.equal((await a.call('POST', '/api/login', { body: { pin: '4321' }, headers: { 'content-type': 'text/plain' } })).status, 415);
});

test('concurrent joins never lose a ticket or duplicate a number', async () => {
  const a = api();
  const staff = await login(a);
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => a.call('POST', '/api/join', { body: { name: `C${i}`, service: 'express' }, token: staff })));
  const ok = rs.filter((r) => r.status === 201);
  const s = (await a.call('GET', '/api/state')).body;
  assert.equal(s.tickets.length, ok.length);
  assert.equal(new Set(s.tickets.map((t) => t.no)).size, ok.length);
});

test('a new Montreal day starts with an empty line (old tickets are not kept)', async () => {
  const a = api();
  const staff = await login(a);
  await a.call('POST', '/api/join', { body: { name: 'Old', service: 'express' }, token: staff });
  a.tick(24 * 3600_000);
  assert.equal((await a.call('GET', '/api/state')).body.tickets.length, 0);
});
