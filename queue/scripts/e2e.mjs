// End-to-end check in real Chromium: staff, TV and a customer phone, with screenshots.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { start } from './dev-server.mjs';

const exe = process.env.CHROMIUM || '/opt/pw-browsers/chromium';
const server = await start(0);
const base = `http://localhost:${server.address().port}`;
mkdirSync('shots', { recursive: true });
const results = []; const ok = (name, cond, note = '') => { results.push([cond ? 'PASS' : 'FAIL', name, note]); };
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const errors = [];
const watch = (page, tag) => {
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/status of 401/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
};

// --- staff
const staffCtx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const staff = await staffCtx.newPage(); watch(staff, 'staff');
await staff.goto(`${base}/staff`);
await staff.fill('#pin', '0000'); await staff.click('button[type=submit]');
await staff.waitForSelector('#msg:not(:empty)'); ok('staff: wrong PIN rejected', /NIP|PIN/.test(await staff.textContent('#msg')));
await staff.fill('#pin', '4321'); await staff.click('button[type=submit]');
await staff.waitForSelector('.s-top'); ok('staff: login with PIN', true);

// --- TV
const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const tv = await tvCtx.newPage(); watch(tv, 'tv');
await tv.goto(`${base}/tv`);
await tv.fill('#pin', '4321'); await tv.click('button[type=submit]');
await tv.waitForSelector('.tv-grid .qr svg'); ok('tv: login + QR displayed', true);
const qrUrl = await tv.evaluate(async () => { const t = localStorage.getItem('lp.tv'); const r = await fetch('/api/key', { headers: { authorization: `Bearer ${t}` } }); return `${location.origin}/?k=${(await r.json()).key}`; });

// --- customer without key
const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-CA' });
const phone = await phoneCtx.newPage(); watch(phone, 'phone');
await phone.goto(base);
await phone.waitForSelector('.hero');
ok('customer: no key -> scan instructions, no form', (await phone.locator('#name').count()) === 0 && /QR/.test(await phone.textContent('main')));
await phone.screenshot({ path: 'shots/01-phone-scan.png' });

// --- customer with key joins
await phone.goto(qrUrl);
await phone.waitForSelector('#name');
ok('customer: key stripped from URL', new URL(phone.url()).search === '');
await phone.fill('#name', '<b>Marie</b>');
await phone.selectOption('#service', 'express');
await phone.screenshot({ path: 'shots/02-phone-join.png' });
await phone.click('button[type=submit]');
await phone.waitForSelector('.ticket');
ok('customer: ticket shown, name sanitised', (await phone.textContent('.who')).startsWith('bMarieb'), await phone.textContent('.who'));
ok('customer: ticket persists after reload', await (async () => { await phone.reload(); await phone.waitForSelector('.ticket'); return true; })());
await phone.screenshot({ path: 'shots/03-phone-ticket.png' });

// --- staff walk-ins + call
for (const n of ['Alex', 'Sam', 'Jo']) { await staff.fill('#wname', n); await staff.click('form button[type=submit]'); await staff.waitForTimeout(150); }
await staff.waitForFunction(() => document.querySelectorAll('.s-item').length === 4);
ok('staff: sees 4 tickets incl. customer', true);
await staff.screenshot({ path: 'shots/04-staff.png' });
await staff.click('.s-top .btn.gold'); // call next = Marie (first in)
await phone.waitForSelector('.called-banner', { timeout: 9000 });
ok('customer: sees "called" within one poll', true);
await phone.screenshot({ path: 'shots/05-phone-called.png' });
await tv.waitForSelector('.tile.called', { timeout: 9000 });
ok('tv: shows called tile', /Marie|bMarieb/.test(await tv.textContent('.tile.called')));
await tv.screenshot({ path: 'shots/06-tv.png' });

// start / done lifecycle
await staff.locator('.s-item.called .btn.gold').click(); // Commencer
await phone.waitForFunction(() => /lavage|washed/i.test(document.querySelector('.ticket')?.textContent || ''), null, { timeout: 9000 });
ok('customer: sees "serving"', true);
await staff.locator('.s-item.serving .btn.gold').click(); // Terminé
await phone.waitForSelector('text=Merci de votre visite', { timeout: 9000 });
ok('customer: sees thank-you at the end', true);

// --- English toggle + other roles refused
await phone.click('.lang button[lang=en]');
ok('customer: EN toggle', /Car wash/.test(await phone.textContent('.eyebrow')));
const anon = await phone.evaluate(async () => (await fetch('/api/staff/act', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"type":"call"}' })).status);
ok('api: anonymous staff action refused', anon === 401);

// --- horizontal overflow on phone
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth);
ok('customer: no horizontal scroll at 390px', !overflow);

ok('console: no errors or warnings', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); server.close();
for (const r of results) console.log(r.join(' | '));
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
