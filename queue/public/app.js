import { STR } from './i18n.js';

/* ------------------------------------------------------------------ helpers */
const $ = (sel, el = document) => el.querySelector(sel);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

let lang = store.get('lp.lang') || ((navigator.language || 'fr').toLowerCase().startsWith('en') ? 'en' : 'fr');
const t = (k, ...a) => { const v = STR[lang][k] ?? STR.fr[k] ?? k; return typeof v === 'function' ? v(...a) : v; };

/** Tiny DOM builder. Text is always set via textContent: no HTML is ever parsed. */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

const fmtTime = (ts) => new Intl.DateTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Montreal' }).format(ts);
const svcName = (state, id) => { const s = state?.services?.find((x) => x.id === id); return s ? s[lang] : id; };

let skew = 0; // server time minus device time, so countdowns are right on a wrong clock
const nowMs = () => Date.now() + skew;

async function api(path, { method = 'GET', body, token } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method, cache: 'no-store',
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw { code: 'network' }; }
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw { code: data?.error || 'generic', status: res.status };
  return data;
}
const errText = (e) => t(`err_${e?.code}`) !== `err_${e?.code}` ? t(`err_${e.code}`) : (e?.code === 'paused' ? t('paused') : e?.code === 'full' ? t('full') : t('err_generic'));

/** Poll loop: fast while visible, slow when hidden, resilient to network errors. */
function poller(fn, { fast, slow = 20000 }) {
  let stop = false, timer;
  const run = async () => {
    if (stop) return;
    try { await fn(); setOffline(false); } catch (e) { if (e?.code === 'network' || e?.status >= 500) setOffline(true); }
    timer = setTimeout(run, document.hidden ? slow : fast);
  };
  const vis = () => { if (!document.hidden) { clearTimeout(timer); run(); } };
  document.addEventListener('visibilitychange', vis);
  run();
  return () => { stop = true; clearTimeout(timer); document.removeEventListener('visibilitychange', vis); };
}
let offlineEl;
function setOffline(on) {
  if (on && !offlineEl) { offlineEl = h('div', { class: 'banner', role: 'status', text: t('offline') }); document.body.prepend(offlineEl); }
  if (!on && offlineEl) { offlineEl.remove(); offlineEl = null; }
}

/* ------------------------------------------------------------------ sound */
let audio;
function chime() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const t0 = audio.currentTime;
    [659.25, 880, 1318.5].forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.16);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.16 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.16 + 0.7);
      o.connect(g).connect(audio.destination); o.start(t0 + i * 0.16); o.stop(t0 + i * 0.16 + 0.75);
    });
  } catch { /* no audio */ }
}
function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === 'fr' ? 'fr-CA' : 'en-CA'; u.rate = 0.95;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch { /* no speech */ }
}

/* ------------------------------------------------------------------ chrome */
const root = $('#app');
function langSwitch(rerender) {
  const b = (code, label) => h('button', { type: 'button', 'aria-pressed': String(lang === code), lang: code, onclick: () => { lang = code; store.set('lp.lang', code); document.documentElement.lang = code; rerender(); } }, label);
  return h('div', { class: 'lang', role: 'group', 'aria-label': 'Langue / Language' }, b('fr', 'FR'), b('en', 'EN'));
}
const logo = () => h('div', { class: 'logo' }, h('b', null, 'LUXO'), 'PLUS');

const route = location.pathname.replace(/\/+$/, '') || '/';
document.documentElement.lang = lang;
if (route === '/tv') tvScreen(); else if (route === '/staff') staffScreen(); else customerScreen();

/* ================================================================== CUSTOMER */
function customerScreen() {
  const qk = new URLSearchParams(location.search).get('k');
  if (qk && /^[0-9a-f]{8}$/.test(qk)) { store.set('lp.k', qk); history.replaceState(null, '', '/'); }
  let state = null, mine = null, err = '', busy = false, confirmLeave = false, notifyOn = false;
  let prevStatus = null, prevAhead = null, ended = null;
  const saved = () => { try { return JSON.parse(store.get('lp.ticket') || 'null'); } catch { return null; } };
  let ticket = saved();

  function notify(title, body) {
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
    chime();
    if (notifyOn && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try { new Notification(title, { body, tag: 'lp-turn', icon: '/icon.svg' }); } catch { /* ignore */ }
    }
  }

  async function refresh() {
    state = await api(`/api/state${ticket ? `?t=${ticket.id}` : ''}`);
    skew = state.now - Date.now();
    mine = ticket ? state.tickets.find((x) => x.id === ticket.id) || null : null;
    if (ticket && !mine) {
      const st = state.mine?.status || 'left';
      ended = st; store.del('lp.ticket'); ticket = null; prevStatus = null;
      if (st === 'done') notify(t('ended_done'), t('ended_done_body'));
    }
    if (mine) {
      if (mine.status === 'called' && prevStatus !== 'called') notify(t('called_title'), t('called_body'));
      else if (mine.status === 'waiting' && mine.ahead === 0 && prevAhead !== null && prevAhead > 0) notify(t('ahead_0'), t('keep_open'));
      prevStatus = mine.status; prevAhead = mine.ahead;
    }
    draw();
  }

  async function join(ev) {
    ev.preventDefault();
    const name = $('#name').value, service = $('#service').value;
    busy = true; err = ''; draw();
    try {
      const r = await api('/api/join', { method: 'POST', body: { name, service, k: store.get('lp.k') || '' } });
      ticket = { id: r.id, token: r.token, no: r.no };
      store.set('lp.ticket', JSON.stringify(ticket)); ended = null; prevStatus = null; prevAhead = null;
      chime(); // unlocks audio on iOS: the tap is a user gesture
      await refresh();
    } catch (e) { err = errText(e); }
    busy = false; draw();
  }
  async function leave() {
    if (!confirmLeave) { confirmLeave = true; draw(); return; }
    try { await api('/api/leave', { method: 'POST', body: { id: ticket.id, token: ticket.token } }); } catch { /* the poll shows the truth */ }
    confirmLeave = false; await refresh();
  }
  async function enableNotify() {
    if (!('Notification' in window)) { notifyOn = false; err = t('notify_denied'); draw(); return; }
    const p = await Notification.requestPermission();
    notifyOn = p === 'granted'; err = notifyOn ? '' : t('notify_denied'); draw();
  }

  function steps() {
    const order = ['waiting', 'called', 'serving'];
    const idx = order.indexOf(mine.status);
    return h('ol', { class: 'steps', 'aria-label': t(`st_${mine.status}`) },
      ...order.map((s, i) => h('li', { class: i < idx ? 'past' : i === idx ? 'on' : '', 'aria-current': i === idx ? 'step' : null }, t(`st_${s}`))),
      h('li', null, t('st_done')));
  }

  function summary() {
    const open = state.newWaitMin <= 0;
    return h('section', { class: 'card', 'aria-label': t('wait_now') },
      h('div', { class: 'row spread' },
        h('span', { class: 'eyebrow' }, t('wait_now')),
        h('span', { class: 'pill ok' }, h('span', { class: 'dot live' }), t('live'))),
      h('p', { class: 'big-eta', style: 'margin:10px 0 0' }, open ? t('free_now') : `~ ${state.newWaitMin} ${t('min')}`),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', null, String(state.waiting)), h('span', null, t('waiting'))),
        h('div', { class: 'stat' }, h('b', null, String(state.busy)), h('span', null, t('in_service'))),
        h('div', { class: 'stat' }, h('b', null, String(Math.max(0, state.bays - state.busy))), h('span', null, t('bays_free')))));
  }

  function ticketCard() {
    const called = mine.status === 'called';
    const serving = mine.status === 'serving';
    return h('section', { class: `card ticket ${called ? 'called-now' : ''}`, 'aria-live': 'polite' },
      called && h('div', { class: 'called-banner', role: 'alert' }, t('called_title'), h('small', null, mine.late ? t('called_late') : t('called_body'))),
      h('div', { class: 'eyebrow' }, t('your_number')),
      h('div', { class: 'no', 'aria-label': `${t('your_number')} ${mine.no}` }, String(mine.no)),
      h('div', { class: 'who' }, mine.name, h('span', { class: 'muted' }, ' · ', svcName(state, mine.service))),
      h('hr', { class: 'sep' }),
      serving
        ? h('p', { class: 'big-eta', style: 'font-size:28px' }, t('serving_body'))
        : called
          ? null
          : h('div', null,
            h('p', { class: 'big-eta' }, mine.ahead === 0 ? t('ahead_0') : t('cars_ahead', mine.ahead)),
            h('p', { class: 'muted', style: 'margin:6px 0 0' }, `${t('est_start')} ${fmtTime(mine.startAt)} · ${t('est_ready')} ${fmtTime(mine.readyAt)}`)),
      serving && h('p', { class: 'muted', style: 'margin:6px 0 0' }, `${t('est_ready')} ${fmtTime(mine.readyAt)}`),
      steps());
  }

  function joinForm() {
    const closed = state.paused;
    const hasKey = !!store.get('lp.k');
    if (!hasKey) {
      return h('section', { class: 'card' }, h('h2', { style: 'font-size:24px' }, t('scan_title')), h('p', { class: 'muted' }, t('scan_body')));
    }
    return h('form', { class: 'card', onsubmit: join, novalidate: true },
      closed && h('p', { class: 'err', role: 'alert' }, t('paused')),
      h('label', { class: 'f' }, h('span', null, t('first_name')),
        h('input', { id: 'name', type: 'text', maxlength: '24', autocomplete: 'given-name', autocapitalize: 'words', enterkeyhint: 'go', required: true, disabled: closed })),
      h('p', { class: 'hint' }, t('first_name_hint')),
      h('label', { class: 'f' }, h('span', null, t('service')),
        h('select', { id: 'service', disabled: closed }, ...state.services.map((s) => h('option', { value: s.id }, s[lang])))),
      err && h('p', { class: 'err', role: 'alert' }, err),
      h('div', { style: 'margin-top:20px' }, h('button', { class: 'btn gold block', type: 'submit', disabled: busy || closed }, t('take_ticket'))));
  }

  function endedCard() {
    const done = ended === 'done';
    return h('section', { class: 'card', style: 'text-align:center' },
      h('h2', { style: 'font-size:28px' }, done ? t('ended_done') : ended === 'noshow' ? t('ended_noshow') : t('ended_left')),
      h('p', { class: 'muted' }, done ? t('ended_done_body') : t('ended_body')),
      h('button', { class: 'btn', type: 'button', onclick: () => { ended = null; draw(); } }, t('new_ticket')));
  }

  function draw() {
    const keep = document.activeElement?.id;
    const ph = $('#name')?.value;
    root.replaceChildren(
      h('main', { class: 'wrap' },
        h('header', { class: 'brand' }, logo(), langSwitch(draw)),
        h('div', { class: 'hero' }, h('div', { class: 'eyebrow' }, `${t('brand')} · Montréal`), h('h1', null, mine ? t('h1_join') : state && !store.get('lp.k') ? t('h1_scan') : t('h1_join'))),
        !state ? h('p', { class: 'muted' }, '…') : [
          mine ? ticketCard() : ended ? endedCard() : joinForm(),
          mine && h('div', { style: 'margin-top:14px' },
            !notifyOn && 'Notification' in window && Notification.permission !== 'denied' && h('button', { class: 'btn block', type: 'button', onclick: enableNotify }, t('notify_on')),
            notifyOn && h('p', { class: 'pill ok' }, t('notify_ok')),
            err && h('p', { class: 'err', role: 'alert' }, err),
            h('p', { class: 'hint' }, t('keep_open')),
            h('button', { class: `btn block ${confirmLeave ? 'danger' : ''}`, style: 'margin-top:10px', type: 'button', onclick: leave }, confirmLeave ? t('leave_confirm') : t('leave'))),
          h('div', { style: 'margin-top:14px' }, summary()),
        ]));
    if (ph && $('#name')) $('#name').value = ph;
    if (keep && $(`#${keep}`)) $(`#${keep}`).focus();
  }

  draw();
  poller(refresh, { fast: 5000 });
}

/* ================================================================== TV */
async function tvScreen() {
  document.body.classList.add('tv');
  let token = store.get('lp.tv'), state = null, joinKey = '', announced = new Set(), soundOn = false, qrSvg = '', qrFor = '';
  try { const e = JSON.parse(token ? atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')) : 'null'); if (!e || e.exp < Date.now()) token = null; } catch { token = null; }

  function login() {
    let msg = '';
    const form = h('form', { class: 'card', onsubmit: async (ev) => {
      ev.preventDefault();
      try {
        const r = await api('/api/login', { method: 'POST', body: { pin: $('#pin').value, role: 'tv' } });
        token = r.token; store.set('lp.tv', token); start();
      } catch (e) { msg = errText(e); $('#msg').textContent = msg; }
    } },
      h('h1', { style: 'font-size:28px' }, t('tv_login')),
      h('label', { class: 'f' }, h('span', null, t('pin')), h('input', { id: 'pin', type: 'password', inputmode: 'numeric', autocomplete: 'current-password', required: true })),
      h('p', { class: 'err', id: 'msg', role: 'alert' }),
      h('div', { style: 'margin-top:18px' }, h('button', { class: 'btn gold block', type: 'submit' }, t('sign_in'))));
    root.replaceChildren(h('main', { class: 'wrap' }, h('header', { class: 'brand' }, logo(), langSwitch(login)), form));
    document.body.classList.remove('tv');
  }

  function qrFrag(url) {
    if (qrFor !== url) {
      const q = window.qrcode(0, 'M'); q.addData(url); q.make();
      qrSvg = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); qrFor = url;
    }
    // qrcode-generator returns a trusted, locally generated SVG string; parsed in an inert template.
    const tpl = document.createElement('template'); tpl.innerHTML = qrSvg;
    const svg = tpl.content.firstElementChild; svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'QR');
    return svg;
  }

  function tile(x, cls) {
    return h('div', { class: `tile ${cls || ''} ${x.late ? 'late' : ''}` }, h('div', { class: 'n' }, String(x.no)), h('div', { class: 'nm' }, x.name), h('div', { class: 'sv' }, svcName(state, x.service)));
  }

  function draw() {
    if (!state) return;
    const called = state.tickets.filter((x) => x.status === 'called');
    const serving = state.tickets.filter((x) => x.status === 'serving');
    const waiting = state.tickets.filter((x) => x.status === 'waiting');
    const url = `${location.origin}/?k=${joinKey}`;
    const wait = state.newWaitMin <= 0 ? t('free_now') : null;
    root.replaceChildren(h('div', { class: 'tv-grid' },
      h('header', { class: 'tv-head' }, logo(), h('div', { class: 'row' }, h('span', { class: 'pill ok' }, h('span', { class: 'dot live' }), t('live')), langSwitch(draw), h('div', { class: 'clock', 'aria-label': 'Heure' }, fmtTime(nowMs())))),
      h('section', { class: 'panel', 'aria-labelledby': 'h-call' },
        h('h2', { id: 'h-call' }, t('tv_calling')),
        called.length ? h('div', { class: 'tiles', 'aria-live': 'assertive' }, called.map((x) => tile(x, 'called'))) : h('p', { class: 'empty' }, '—'),
        h('h2', { style: 'margin-top:clamp(14px,2vw,32px)' }, t('tv_serving')),
        serving.length ? h('div', { class: 'tiles' }, serving.map((x) => tile(x, 'small'))) : h('p', { class: 'empty' }, '—')),
      h('section', { class: 'panel', 'aria-labelledby': 'h-next' },
        h('h2', { id: 'h-next' }, t('tv_next')),
        waiting.length
          ? h('ul', { class: 'queue-list' }, waiting.slice(0, 7).map((x) => h('li', null, h('span', { class: 'n' }, String(x.no)), h('span', { class: 'nm' }, x.name, h('span', { class: 'muted' }, ' · ', svcName(state, x.service))), h('span', { class: 'eta' }, `~ ${fmtTime(x.startAt)}`))))
          : h('p', { class: 'empty' }, t('tv_none')),
        waiting.length > 7 && h('p', { class: 'empty' }, `+ ${waiting.length - 7}`)),
      h('footer', { class: 'tv-foot' },
        h('div', null, h('div', { class: 'eyebrow' }, t('new_wait')), h('div', { class: 'wait-big' }, wait || h('span', null, '~ ', h('em', null, String(state.newWaitMin)), ` ${t('min')}`))),
        state.paused ? h('div', { class: 'pill warn' }, t('paused')) : joinKey && h('div', { class: 'join-cta' }, h('p', null, t('tv_join')), h('div', { class: 'qr' }, qrFrag(url)))),
      !soundOn && h('button', { class: 'btn sound', type: 'button', onclick: () => { soundOn = true; chime(); draw(); } }, t('tv_sound'))));
    // announce newly called tickets once
    for (const x of called) {
      if (!announced.has(x.id)) {
        announced.add(x.id);
        if (soundOn) { chime(); setTimeout(() => speak(t('tv_announce', x.no, x.name)), 900); }
      }
    }
  }

  async function refresh() {
    state = await api('/api/state'); skew = state.now - Date.now();
    if (!joinKey) {
      try { joinKey = (await api('/api/key', { token })).key; } catch (e) { if (e.status === 401) { store.del('lp.tv'); token = null; login(); throw e; } }
    }
    draw();
  }
  function start() {
    document.body.classList.add('tv');
    poller(refresh, { fast: 4000 });
    setInterval(() => { if (state) draw(); }, 30000); // keep the clock and ETAs fresh between polls
    try { navigator.wakeLock?.request('screen').catch(() => {}); } catch { /* optional */ }
  }
  if (!token) login(); else start();
}

/* ================================================================== STAFF */
function staffScreen() {
  let token = store.get('lp.staff'), state = null, err = '', info = '', qrOpen = false, key = '';
  try { const e = JSON.parse(token ? atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')) : 'null'); if (!e || e.exp < Date.now() || e.r !== 'staff') token = null; } catch { token = null; }
  let stopPoll = null;

  function login() {
    stopPoll?.();
    root.replaceChildren(h('main', { class: 'wrap' }, h('header', { class: 'brand' }, logo(), langSwitch(login)),
      h('form', { class: 'card', onsubmit: async (ev) => {
        ev.preventDefault();
        try {
          const r = await api('/api/login', { method: 'POST', body: { pin: $('#pin').value, role: 'staff' } });
          token = r.token; store.set('lp.staff', token); err = ''; start();
        } catch (e) { $('#msg').textContent = errText(e); }
      } },
        h('h1', { style: 'font-size:28px' }, t('staff_title')),
        h('label', { class: 'f' }, h('span', null, t('pin')), h('input', { id: 'pin', type: 'password', inputmode: 'numeric', autocomplete: 'current-password', required: true })),
        h('p', { class: 'err', id: 'msg', role: 'alert' }),
        h('div', { style: 'margin-top:18px' }, h('button', { class: 'btn gold block', type: 'submit' }, t('sign_in'))))));
  }

  async function act(type, id) {
    err = '';
    try { await api('/api/staff/act', { method: 'POST', token, body: { type, id } }); } catch (e) { if (e.status === 401) return login(); err = errText(e); }
    await refresh(true);
  }

  async function saveConfig(patch) {
    try { await api('/api/staff/config', { method: 'POST', token, body: patch }); info = t('saved'); err = ''; } catch (e) { err = errText(e); }
    await refresh(true);
  }

  function row(x) {
    const b = (type, label, cls = '') => h('button', { class: `btn sm ${cls}`, type: 'button', onclick: () => act(type, x.id) }, label);
    const acts = x.status === 'waiting' ? [b('call', t('act_call'), 'gold'), b('start', t('act_start')), b('noshow', t('act_noshow')), b('remove', t('act_remove'), 'danger')]
      : x.status === 'called' ? [b('start', t('act_start'), 'gold'), b('requeue', t('act_requeue')), b('noshow', t('act_noshow')), b('remove', t('act_remove'), 'danger')]
        : [b('done', t('act_done'), 'gold'), b('remove', t('act_remove'), 'danger')];
    return h('li', { class: `s-item ${x.status}` },
      h('div', { class: 'n' }, String(x.no)),
      h('div', null, h('div', { class: 'meta' }, h('span', { class: 'nm' }, x.name), h('span', { class: 'muted' }, svcName(state, x.service)),
        h('span', { class: `pill ${x.late ? 'warn' : ''}` }, t(`st_${x.status}`), x.late ? ` · ${t('late')}` : '')),
      h('div', { class: 'muted' }, x.status === 'waiting' ? `#${x.pos} · ${fmtTime(x.startAt)} → ${fmtTime(x.readyAt)}` : `→ ${fmtTime(x.readyAt)}`)),
      h('div', { class: 'acts' }, acts));
  }

  function settings() {
    const durs = state.services.map((s) => h('label', { class: 'f' }, h('span', null, `${s[lang]} — ${t('duration')}`), h('input', { type: 'number', min: '5', max: '600', value: String(s.min), 'data-svc': s.id })));
    return h('details', { class: 'card' }, h('summary', null, t('settings')),
      h('label', { class: 'f' }, h('span', null, t('bays')), h('input', { id: 'bays', type: 'number', min: '1', max: '12', value: String(state.bays) })),
      h('label', { class: 'toggle' }, h('span', null, t('paused_label')), h('input', { id: 'paused', type: 'checkbox', checked: state.paused })),
      ...durs,
      h('div', { style: 'margin-top:16px' }, h('button', { class: 'btn gold block', type: 'button', onclick: () => {
        const services = state.services.map((s) => ({ ...s, min: Number($(`[data-svc="${s.id}"]`).value) }));
        saveConfig({ bays: Number($('#bays').value), paused: $('#paused').checked, services });
      } }, t('save'))));
  }

  function draw() {
    if (!state) return;
    const list = state.tickets;
    const hasWaiting = list.some((x) => x.status === 'waiting');
    root.replaceChildren(h('div', null,
      h('div', { class: 's-top' }, h('div', { class: 'wrap wide' }, h('div', { class: 's-bar' },
        h('div', { class: 'row' }, logo(), h('span', { class: 'eyebrow' }, t('staff_title'))),
        h('div', { class: 'row' }, langSwitch(draw), h('button', { class: 'btn sm', type: 'button', onclick: () => { store.del('lp.staff'); token = null; login(); } }, t('sign_out')))),
        h('div', { class: 's-bar', style: 'padding-top:0' },
          h('div', { class: 's-stats' },
            h('span', { class: 'pill' }, `${state.busy}/${state.bays} ${t('in_service')}`),
            h('span', { class: 'pill' }, `${state.waiting} ${t('waiting')}`),
            h('span', { class: 'pill ok' }, `${state.served} ${t('served')}`),
            state.paused && h('span', { class: 'pill warn' }, t('paused_label'))),
          h('button', { class: 'btn gold', type: 'button', disabled: !hasWaiting, onclick: () => act('call') }, t('call_next'))))),
      h('main', { class: 'wrap wide' },
        err && h('p', { class: 'err', role: 'alert' }, err),
        info && h('p', { class: 'pill ok', role: 'status' }, info),
        list.length ? h('ul', { class: 's-list' }, list.map(row)) : h('p', { class: 'muted' }, t('nothing_waiting')),
        h('form', { class: 'card', style: 'margin-top:18px', onsubmit: async (ev) => {
          ev.preventDefault();
          try { await api('/api/join', { method: 'POST', token, body: { name: $('#wname').value, service: $('#wsvc').value } }); $('#wname').value = ''; err = ''; } catch (e) { if (e.status === 401) return login(); err = errText(e); }
          await refresh(true);
        } },
          h('h2', { style: 'font-size:22px' }, t('walkin')),
          h('div', { class: 'grid2' },
            h('label', { class: 'f' }, h('span', null, t('first_name')), h('input', { id: 'wname', type: 'text', maxlength: '24', required: true })),
            h('label', { class: 'f' }, h('span', null, t('service')), h('select', { id: 'wsvc' }, ...state.services.map((s) => h('option', { value: s.id }, s[lang]))))),
          h('div', { style: 'margin-top:16px' }, h('button', { class: 'btn block', type: 'submit' }, t('add')))),
        h('div', { class: 'card' },
          h('button', { class: 'btn block', type: 'button', onclick: async () => { qrOpen = !qrOpen; if (qrOpen && !key) { try { key = (await api('/api/staff/key', { token })).key; } catch { /* ignore */ } } draw(); } }, t('show_qr')),
          qrOpen && key && h('div', { style: 'margin-top:16px;text-align:center' }, (() => {
            const q = window.qrcode(0, 'M'); q.addData(`${location.origin}/?k=${key}`); q.make();
            const tpl = document.createElement('template'); tpl.innerHTML = q.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
            const svg = tpl.content.firstElementChild; svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'QR');
            return h('div', { class: 'qr', style: 'display:inline-block;max-width:260px' }, svg);
          })(), h('p', { class: 'hint' }, t('qr_hint')))),
        settings())));
  }

  async function refresh(force = false) {
    state = await api('/api/state'); skew = state.now - Date.now();
    const keep = document.activeElement?.id; const w = $('#wname')?.value;
    if (force === true || !document.querySelector('details[open]')) draw(); // polls never rebuild the page while settings are being edited
    if (w && $('#wname')) $('#wname').value = w;
    if (keep && $(`#${keep}`)) $(`#${keep}`).focus();
  }
  function start() { stopPoll = poller(refresh, { fast: 4000 }); }
  if (!token) login(); else start();
}
