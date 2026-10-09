// Serve the public build with its generated CSP for local verification.
import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const csp = readFileSync(path.join(root, '_headers'), 'utf8').split('Content-Security-Policy: ')[1].trim();
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css' };
http.createServer((req,res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type':types[path.extname(file)] || 'text/plain', 'Content-Security-Policy':csp, 'X-Content-Type-Options':'nosniff' });
  res.end(readFileSync(file));
}).listen(Number(process.env.PORT || 8769), '127.0.0.1');
