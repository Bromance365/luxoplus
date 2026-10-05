// Parcours réel de l'écran TV dans Chromium : vrai schéma SQL (faux Supabase) + mode démo.   npm run e2e
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const exe = process.env.CHROMIUM || '/opt/pw-browsers/chromium';
const MOCK = 8766, DEMO = 8767;
mkdirSync('shots', { recursive: true });
const procs = [
  spawn('node', ['mock-supabase.mjs'], { env: { ...process.env, PORT: String(MOCK) }, stdio: 'ignore' }),
  spawn('python3', ['-m', 'http.server', String(DEMO), '-d', '..'], { stdio: 'ignore' }),
];
const stop = () => procs.forEach((p) => p.kill());
process.on('exit', stop);
const up = async (port) => { for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/tv.html`)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 500)); } throw new Error('serveur ' + port); };
await up(MOCK); await up(DEMO);

const results = [];
const ok = (name, cond, note = '') => results.push([cond ? 'PASS' : 'FAIL', name, note]);
const base = `http://localhost:${MOCK}`;
const rpc = async (fn, args = {}, token) => {
  const r = await fetch(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'x', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(args) });
  const j = await r.json().catch(() => null); if (!r.ok) throw new Error(fn + ': ' + JSON.stringify(j)); return j;
};
const join = (name, svc, phone) => rpc('join_queue', { p_name: name, p_car: 'Honda Civic', p_service: svc, p_size: 'sedan', p_phone: phone, p_lang: 'fr' });
const { access_token: tok } = await (await fetch(`${base}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@test.local', password: 'test1234' }) })).json();

await join('Jean Tremblay', 'express', '438-555-0101');
await join('Marie Roy', 'signature', '438-555-0102');
await join('Luc Côté', 'express', '438-555-0103');
await join('Ana Diaz', 'express', '438-555-0104');
await rpc('call_next', {}, tok); await rpc('call_next', {}, tok);   // 1 et 2 en service, 3 et 4 en attente

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const errors = [];
const supaJs = readFileSync('node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'utf8');
async function open(port, vp, tag) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'fr-CA' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_|fonts\.g/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
  await page.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: supaJs }));
  await page.route('**/fonts.g*/**', (r) => r.abort());
  await page.goto(`http://localhost:${port}/tv.html`);
  return page;
}

// --- Base réelle (schéma SQL)
const tv = await open(MOCK, { width: 1920, height: 1080 }, 'tv');
await tv.waitForSelector('.bay:not(.free)', { timeout: 10000 });
const text = await tv.evaluate(() => document.body.innerText);
ok('TV : 2 baies occupées avec les numéros 1 et 2', (await tv.locator('.bay:not(.free) .num').allTextContents()).join() === '1,2');
ok('TV : prénoms seulement (Jean, Marie)', /Jean/.test(text) && /Marie/.test(text) && !/Tremblay|Roy\b/.test(text));
ok('TV : prochains 3 et 4 listés', (await tv.locator('.next .n').allTextContents()).join() === '3,4');
ok('TV : aucun téléphone ni véhicule affiché', !/555-|Civic/.test(text));
ok('TV : QR affiché', (await tv.locator('#qr svg').count()) === 1);
ok('TV : pas de scroll à 1920×1080', await tv.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1));
await tv.screenshot({ path: 'shots/tv-1920.png' });

// Nouveau numéro en service → halo « arrivée » (le son est activé par le clic)
await tv.click('#btn-sound');
await rpc('finish_client', { p_id: 1 }, tok); await rpc('call_next', {}, tok);
await tv.waitForSelector('.bay.fresh', { timeout: 12000 });
ok('TV : le nouveau numéro en service est mis en évidence', (await tv.locator('.bay.fresh .num').textContent()) === '3');
await tv.screenshot({ path: 'shots/tv-fresh.png' });

// Fermeture des inscriptions → bandeau
await rpc('set_accepting', { p_on: false }, tok);
await tv.waitForSelector('#closed:not([hidden])', { timeout: 12000 });
ok('TV : bandeau « inscriptions fermées » et QR masqué', await tv.locator('#join').isHidden());
await rpc('set_accepting', { p_on: true }, tok);

// Téléphone / portrait
const phone = await open(MOCK, { width: 390, height: 844 }, 'phone');
await phone.waitForSelector('.bay:not(.free)');
ok('Portrait 390 px : pas de défilement horizontal', await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await phone.screenshot({ path: 'shots/tv-phone.png', fullPage: true });

// --- Mode démo (sans Supabase)
const demo = await open(DEMO, { width: 1280, height: 720 }, 'demo');
await demo.waitForSelector('.bay:not(.free)', { timeout: 10000 });
ok('Démo : l\'écran TV affiche les lavages en cours', (await demo.locator('.bay:not(.free)').count()) >= 1);
await demo.screenshot({ path: 'shots/tv-demo.png' });

// --- Sécurité : la fonction publique ne donne rien de plus
const board = await rpc('get_board');
ok('API publique : get_board sans champ sensible', !/phone|price|car"|token|Tremblay|Roy/.test(JSON.stringify(board)));
const direct = await fetch(`${base}/rest/v1/queue`, { headers: { apikey: 'x' } });
ok('API publique : table queue inaccessible', !direct.ok);

ok('Console : aucune erreur', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); stop();
for (const r of results) console.log(r.join(' | '));
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
