// Faux Supabase local pour développer/tester sans toucher au vrai projet.
// Exécute le vrai supabase/schema.sql dans PGlite (Postgres en WebAssembly)
// et imite les routes utilisées par supabase-js : /rest/v1/rpc/* et /auth/v1/token.
//
//   cd dev && npm install && npm run mock     →  http://localhost:8765
//   Personnel : admin@test.local / test1234
import { PGlite } from '@electric-sql/pglite';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8765);
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const ADMIN = { id: '11111111-1111-1111-1111-111111111111', email: 'admin@test.local', password: 'test1234' };

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  grant usage on schema public to anon, authenticated;
  create schema auth; grant usage on schema auth to anon, authenticated;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated;
  insert into auth.users values ('${ADMIN.id}');
`);
await db.exec(fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8'));
await db.exec(`insert into admins values ('${ADMIN.id}');`);
if (!process.env.REAL_HOURS) {
  await db.exec(`update settings set open_days='{1,2,3,4,5,6,7}', open_time='00:00', close_time='23:59:59';`);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = (sub) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const uidFromAuth = (h) => {
  try { const p = JSON.parse(Buffer.from(h.split(' ')[1].split('.')[1], 'base64url')); return p.sub || null; } catch { return null; }
};

let chain = Promise.resolve();          // PGlite = une connexion : on sérialise
const run = (fn) => (chain = chain.then(fn, fn));

async function callRpc(fn, args, uid, ip) {
  if (!/^[a-z_]+$/.test(fn)) throw Object.assign(new Error('bad fn'), { status: 404 });
  const keys = Object.keys(args || {});
  if (keys.some((k) => !/^[a-z_]+$/.test(k))) throw new Error('bad arg');
  const sql = `select ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
  return run(async () => {
    await db.exec(`reset role;
      select set_config('test.uid', '${uid || ''}', false);
      select set_config('request.headers', '${JSON.stringify({ 'x-forwarded-for': ip }).replace(/'/g, "''")}', false);
      set role ${uid ? 'authenticated' : 'anon'};`);
    try { return (await db.query(sql, keys.map((k) => args[k]))).rows[0]?.r ?? null; }
    finally { await db.exec('reset role'); }
  });
}

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain');
  let body = '';
  for await (const c of req) body += c;

  try {
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const uid = uidFromAuth(req.headers.authorization || '');
      const r = await callRpc(url.pathname.split('/').pop(), body ? JSON.parse(body) : {}, uid, req.socket.remoteAddress);
      return send(res, 200, r);
    }
    if (url.pathname === '/auth/v1/token') {
      const { email, password } = JSON.parse(body || '{}');
      if (email !== ADMIN.email || password !== ADMIN.password) {
        return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      }
      const now = Math.floor(Date.now() / 1000);
      return send(res, 200, { access_token: fakeJwt(ADMIN.id), token_type: 'bearer', expires_in: 3600,
        expires_at: now + 3600, refresh_token: 'fake', user: { id: ADMIN.id, email, aud: 'authenticated', role: 'authenticated' } });
    }
    if (url.pathname === '/auth/v1/recover') return send(res, 200, {});
    if (url.pathname === '/auth/v1/logout') return send(res, 204, '', 'text/plain');
    if (url.pathname.startsWith('/auth/v1/user')) {
      return send(res, 200, { id: ADMIN.id, email: ADMIN.email, aud: 'authenticated', role: 'authenticated' });
    }
    if (url.pathname.startsWith('/realtime/')) return send(res, 404, {});

    // Fichiers statiques ; config.js pointe vers ce faux serveur
    const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
    let content = fs.readFileSync(file, 'utf8');
    if (url.pathname === '/config.js') {
      content = content.replace(/supabaseUrl: '[^']*'/, `supabaseUrl: 'http://localhost:${PORT}'`)
        .replace(/demo: true/, 'demo: false');
    }
    return send(res, 200, content, MIME[path.extname(file)] || 'text/plain');
  } catch (e) {
    return send(res, e.status || 400, { message: e.message, code: e.code || 'P0001' });
  }
}).listen(PORT, () => console.log(`Faux Supabase prêt : http://localhost:${PORT}  (admin: ${ADMIN.email} / ${ADMIN.password})`));
