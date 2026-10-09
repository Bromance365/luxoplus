// Build only the public app. Fail closed when production credentials are missing.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const configSource = readFileSync(path.join(root, 'config.js'), 'utf8');
const context = { window: {} }; vm.runInNewContext(configSource, context);
const config = context.window.APP_CONFIG;
if (process.env.LUX_DEMO !== undefined) {
  if (!['true', 'false'].includes(process.env.LUX_DEMO)) throw new Error('LUX_DEMO must be true or false');
  config.demo = process.env.LUX_DEMO === 'true';
}
if (!config.demo) {
  const url = process.env.LUX_SUPABASE_URL;
  const key = process.env.LUX_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url)) throw new Error('Set LUX_SUPABASE_URL to the dedicated Luxoplus project URL');
  if (!key || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key) || key.includes('REMPLACER')) throw new Error('Set a public LUX_SUPABASE_PUBLISHABLE_KEY (never a secret/service-role key)');
  config.supabaseUrl = url; config.supabaseKey = key;
}
rmSync(dist, { recursive: true, force: true }); mkdirSync(dist);
for (const file of ['index.html','admin.html','tv.html','privacy.html','brand.css','config.js','demo-backend.js','qr.js','vendor']) {
  cpSync(path.join(root, file), path.join(dist, file), { recursive: true });
}
writeFileSync(path.join(dist, 'config.js'), configSource + '\nwindow.APP_CONFIG = ' + JSON.stringify(config, null, 2) + ';\n');
// Inline scripts are static: allow their hashes rather than all injected scripts.
const hashes = new Set();
for (const name of ['index.html','admin.html','tv.html','privacy.html']) {
  const html = readFileSync(path.join(dist, name), 'utf8');
  for (const [, script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (script.trim()) hashes.add("'sha256-" + createHash('sha256').update(script).digest('base64') + "'");
  }
}
const policy = `default-src 'self'; script-src 'self' ${[...hashes].join(' ')}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`;
writeFileSync(path.join(dist, '_headers'), `/*\n  Content-Security-Policy: ${policy}\n`);
console.log(`Built Luxoplus (${config.demo ? 'DEMO — local browser data only' : 'PRODUCTION'})`);
