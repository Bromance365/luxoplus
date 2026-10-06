// Parcours sur l'URL déployée (mode démo : client, personnel et TV partagent le stockage du navigateur).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const base = process.argv[2]; if (!base) throw new Error('usage: node live-check.mjs https://site');
mkdirSync('shots', { recursive: true });
const res = []; const ok = (n, c, note = '') => res.push([c ? 'PASS' : 'FAIL', n, note]);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox', ...(process.env.TRUST_SPKI ? ['--ignore-certificate-errors-spki-list=' + process.env.TRUST_SPKI] : [])] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-CA', isMobile: true });
const errors = [];
const mk = async () => { const p = await ctx.newPage(); p.on('console', (m) => { if (m.type() === 'error' && !/ERR_|fonts\.g|Failed to load resource/.test(m.text())) errors.push(m.text()); }); p.on('pageerror', (e) => errors.push('pageerror ' + e.message)); return p; };

const tv = await mk(); await tv.setViewportSize({ width: 1920, height: 1080 });
await tv.goto(`${base}/tv.html`); await tv.waitForSelector('.bay', { timeout: 15000 });
ok('TV : charge, baies affichées', (await tv.locator('.bay').count()) >= 1);
ok('TV : QR affiché', (await tv.locator('#qr svg').count()) === 1);
await tv.click('#btn-sound');

const cli = await mk();
await cli.goto(base); await cli.waitForSelector('#sizes > *', { timeout: 15000 });
await cli.locator('#sizes > *').first().click();
await cli.fill('#f-car', 'Honda Civic');
await cli.locator('#pkgs > *').first().click();
await cli.fill('#f-name', 'Test Client');
await cli.fill('#f-phone', '438-555-0199');
await cli.screenshot({ path: 'shots/live-client-form.png', fullPage: true });
await cli.click('#btn-reg');
await cli.waitForSelector('#view-ticket:not([hidden])', { timeout: 15000 });
const num = (await cli.textContent('#t-num')).trim();
ok('Client : inscription → billet affiché', /\d/.test(num), 'billet « ' + num + ' »');
await cli.screenshot({ path: 'shots/live-client-ticket.png', fullPage: true });

await tv.waitForFunction((n) => [...document.querySelectorAll('.next .n, .bay .num')].some((e) => Number(e.textContent.trim()) === n), Number(num.replace(/\D/g, '')), { timeout: 20000 });
ok('TV : le nouveau billet apparaît (prochains ou baie)', true);

const adm = await mk(); await adm.setViewportSize({ width: 1100, height: 900 });
await adm.goto(`${base}/admin.html`);
await adm.waitForSelector('#login-form, #dash', { timeout: 15000 });
if (await adm.locator('#login-form').isVisible()) { await adm.fill('#login-email', 'demo@demo.test'); await adm.fill('#login-pwd', 'demo'); await adm.click('#btn-login'); }
await adm.waitForSelector('#dash:not([hidden])', { timeout: 15000 });
ok('Admin : tableau de bord (démo)', true);
ok('Admin : lien vers l\'écran TV', (await adm.locator('#link-tv').getAttribute('href')) === 'tv.html');
await adm.screenshot({ path: 'shots/live-admin.png' });

// Appeler jusqu'à ce que le billet du client entre en baie
for (let i = 0; i < 6; i++) {
  if (await cli.locator('#view-turn:not([hidden])').count()) break;
  const done = adm.locator('button:has-text("Terminé")').first();
  if (await adm.locator('#btn-call, button:has-text("Appeler")').count()) await adm.locator('#btn-call, button:has-text("Appeler")').first().click().catch(() => {});
  await adm.waitForTimeout(700);
  if (await done.count() && !(await cli.locator('#view-turn:not([hidden])').count())) await done.click().catch(() => {});
  await adm.waitForTimeout(500);
}
await cli.waitForSelector('#view-turn:not([hidden])', { timeout: 20000 });
ok('Client : « c\'est votre tour » reçu', true);
await tv.waitForSelector('.bay.fresh', { timeout: 15000 }).catch(() => {});
ok('TV : le numéro appelé est en baie', await tv.locator('.bay:not(.free) .num', { hasText: String(Number(num.replace(/\D/g, ''))) }).count() >= 1);
await tv.screenshot({ path: 'shots/live-tv.png' });
await cli.screenshot({ path: 'shots/live-client-turn.png', fullPage: true });

ok('Console : aucune erreur applicative', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
for (const r of res) console.log(r.join(' | '));
process.exit(res.some((r) => r[0] === 'FAIL') ? 1 : 0);
