import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const run = (env) => spawnSync(process.execPath, [new URL('build.mjs', root).pathname], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
assert.equal(run({ LUX_DEMO: 'true' }).status, 0);
assert.deepEqual(readdirSync(new URL('dist', root)).sort(), ['_headers','admin.html','brand.css','config.js','demo-backend.js','index.html','privacy.html','qr.js','tv.html','vendor'].sort());
assert.notEqual(run({ LUX_DEMO: 'false' }).status, 0, 'production build requires credentials');
assert.notEqual(run({ LUX_DEMO: 'false', LUX_SUPABASE_URL: 'https://abc.supabase.co', LUX_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_test' }).status, 0, 'secret key rejected');
assert.equal(run({ LUX_DEMO: 'false', LUX_SUPABASE_URL: 'https://abc.supabase.co', LUX_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' }).status, 0);
const context = { window: {} }; vm.runInNewContext(readFileSync(new URL('dist/config.js', root), 'utf8'), context);
assert.equal(context.window.APP_CONFIG.demo, false);
assert.equal(context.window.APP_CONFIG.supabaseUrl, 'https://abc.supabase.co');
for (const name of ['index','admin','tv','privacy']) {
  const html = readFileSync(new URL(`${name}.html`, root), 'utf8');
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1], { filename: name + '.html' });
  assert.ok(!html.includes('cdn.jsdelivr.net'), 'local locked SDK');
}
assert.ok(!readFileSync(new URL('dist/_headers', root), 'utf8').match(/script-src[^;]*unsafe-inline/), 'inline script hashes required');
// Always leave a usable demo build after the test.
assert.equal(run({ LUX_DEMO: 'true' }).status, 0);
console.log('PASS build: public files only, production credentials required, secret keys rejected, inline scripts parse');
