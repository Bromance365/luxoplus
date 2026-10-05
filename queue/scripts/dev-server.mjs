// Local dev server: static files + the real API handler on an in-memory store. No Netlify needed.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler } from '../netlify/functions/handler.mts';
import { memoryStore } from '../test/memory-store.mts';

const root = join(fileURLToPath(new URL('..', import.meta.url)), 'public');
const env = { SESSION_SECRET: 'dev-secret-dev-secret-dev-secret-0000', STAFF_PIN: process.env.STAFF_PIN || '4321' };
const handle = createHandler({ store: memoryStore(), env: (k) => env[k], now: () => Date.now() });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

export function start(port = Number(process.env.PORT) || 8888) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const r = await handle(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }));
      res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
    }
    const p = url.pathname === '/tv' || url.pathname === '/staff' || url.pathname === '/' ? '/index.html' : normalize(url.pathname);
    try {
      const f = join(root, p);
      if (!f.startsWith(root)) throw new Error('nope');
      res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' }); res.end(await readFile(f));
    } catch { res.writeHead(404); res.end('not found'); }
  });
  return new Promise((ok) => server.listen(port, () => ok(server)));
}
if (import.meta.url === `file://${process.argv[1]}`) start().then((s) => console.log(`http://localhost:${s.address().port}`));
