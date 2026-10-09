// =====================================================================
//  MODE DÉMO — remplace Supabase par un faux serveur dans le navigateur.
//  Actif seulement si APP_CONFIG.demo === true. Mêmes fonctions RPC et mêmes
//  règles que supabase/schema.sql, données gardées dans le localStorage
//  (partagées entre les onglets d'un même navigateur, pas entre appareils).
// =====================================================================
(() => {
  const C = window.APP_CONFIG;
  if (!C || !C.demo) return;

  const KEY = 'lux_demo_state_v3';   // v3 : couleur du véhicule
  const SESSION_KEY = 'lux_demo_session';
  const MIN = 60000;
  const today = () => window.businessDate();
  const nowIso = (minAgo = 0) => new Date(Date.now() - minAgo * MIN).toISOString();
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  }));

  const SERVICES = [
    { code: 'express',   minutes: 30,  prices: { sedan: 29.99,  suv: 39.99,  truck: 49.99 } },
    { code: 'signature', minutes: 120, prices: { sedan: 74.99,  suv: 84.99,  truck: 94.99 } },
    { code: 'absolux',   minutes: 300, prices: { sedan: 234.99, suv: 254.99, truck: 279.99 } },
  ];
  const svc = (code) => SERVICES.find((s) => s.code === code);

  // ---------- Données de départ ----------
  function seed() {
    const day = today();
    let id = 0, num = 0;
    const row = (name, car, code, size, status, extra = {}) => ({
      id: ++id, num: ++num, service_day: day, token: uuid(), name, car, service_code: code, vehicle_size: size,
      price: svc(code).prices[size], phone: `514-555-01${String(num).padStart(2, '0')}`, lang: 'fr', status, bay: null, cancelled_by: null,
      created_at: nowIso(200 - num * 10), called_at: null, finished_at: null, ...extra,
    });
    const queue = [
      row('Marc-André Lavoie', 'Honda Civic', 'express', 'sedan', 'done', { called_at: nowIso(190), finished_at: nowIso(160) }),
      row('Julie Bergeron', 'Toyota RAV4', 'signature', 'suv', 'done', { called_at: nowIso(175), finished_at: nowIso(58) }),
      row('Kevin Nguyen', 'Ford F-150', 'express', 'truck', 'done', { called_at: nowIso(155), finished_at: nowIso(122) }),
      row('Sarah Cohen', 'Mazda CX-5', 'express', 'suv', 'cancelled', { cancelled_by: 'client', finished_at: nowIso(100) }),
      row('Isabelle Roy', 'Audi Q5', 'signature', 'suv', 'serving', { bay: 1, called_at: nowIso(55), color: 'Blanc' }),
      row('Daniel Kim', 'Tesla Model 3', 'express', 'sedan', 'serving', { bay: 2, called_at: nowIso(12) }),
      row('Amélie Fortin', 'Subaru Outback', 'express', 'suv', 'waiting'),
      row('Ahmed Benali', 'Dodge Ram', 'signature', 'truck', 'waiting', { color: 'Noir' }),
      row('Priya Shah', 'BMW X3', 'absolux', 'suv', 'waiting', { lang: 'en' }),
    ];
    return {
      day, nextId: id + 1, queue,
      settings: { bays: 2, accepting: true, open_days: [1, 2, 3, 4, 5, 6], open_time: '08:00', close_time: '18:00', close_grace_minutes: 30, max_waiting: 40 },
    };
  }

  function load() {
    let s;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch {}
    if (!s || !s.settings || s.day !== today()) { s = seed(); save(s, false); }   // nouvelle journée → nouvelle démo
    return s;
  }
  function save(s, notify = true) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
    if (notify) listeners.forEach((fn) => { try { fn(); } catch {} });
  }

  // ---------- Règles (copie de schema.sql) ----------
  const fail = (code) => { const e = new Error(code); e.code = 'P0001'; throw e; };
  const elapsedMin = (iso) => (Date.now() - new Date(iso)) / MIN;
  const isOpen = (s) => s.settings.accepting;          // démo : ouverte à toute heure pour pouvoir la montrer
  // Règle de fermeture : fin prévue au plus 30 min après la fermeture.
  // En démo, elle ne s'applique que si « Fin de journée » est activé dans le bandeau
  // (fermeture simulée 1 h plus tard), sinon la démo serait inutilisable l'après-midi.
  const simulatedClose = (s) => {
    if (!s.settings.simulateCloseAt) return null;
    return new Date(s.settings.simulateCloseAt);
  };
  function fitsToday(s, minutes, wait) {
    const close = simulatedClose(s);
    if (!close) return true;
    return Date.now() + (wait + minutes) * MIN <= close.getTime() + (s.settings.close_grace_minutes ?? 30) * MIN;
  }
  const hhmm = (d) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: window.businessTimeZone }).format(d);

  function estimateWait(s, beforeNum) {
    const free = s.queue.filter((q) => q.status === 'serving')
      .map((q) => Math.max(5, svc(q.service_code).minutes - elapsedMin(q.called_at)));
    while (free.length < s.settings.bays) free.push(0);
    s.queue.filter((q) => q.service_day === s.day && q.status === 'waiting' && (beforeNum == null || q.num < beforeNum))
      .sort((a, b) => a.num - b.num)
      .forEach((q) => {
        let best = 0;
        free.forEach((v, i) => { if (v < free[best]) best = i; });
        free[best] += svc(q.service_code).minutes;
      });
    return Math.ceil(Math.min(...free));
  }

  function promoteNext(s) {
    const used = s.queue.filter((q) => q.status === 'serving').map((q) => q.bay);
    let bay = null;
    for (let b = 1; b <= s.settings.bays; b++) if (!used.includes(b)) { bay = b; break; }
    if (!bay) return null;
    const next = s.queue.filter((q) => q.service_day === s.day && q.status === 'waiting').sort((a, b) => a.num - b.num)[0];
    if (!next) return null;
    Object.assign(next, { status: 'serving', called_at: nowIso(), bay });
    return { num: next.num, name: next.name, bay };
  }

  const servingNums = (s) => s.queue.filter((q) => q.status === 'serving' && q.service_day === s.day)
    .sort((a, b) => a.bay - b.bay).map((q) => q.num);
  const pick = (q, keys) => Object.fromEntries(keys.map((k) => [k, q[k]]));
  const requireAdmin = () => { if (!getSession()) fail('ACCES_REFUSE'); };

  const RPC = {
    get_queue_status(s) {
      const wait = estimateWait(s, null);
      return {
        serving_nums: servingNums(s),
        waiting_count: s.queue.filter((q) => q.service_day === s.day && q.status === 'waiting').length,
        wait_minutes: wait, bays: s.settings.bays, is_open: isOpen(s), accepting: s.settings.accepting,
        open_days: s.settings.open_days, open_time: s.settings.open_time,
        close_time: simulatedClose(s) ? hhmm(simulatedClose(s)) : s.settings.close_time,
        close_grace_minutes: s.settings.close_grace_minutes ?? 30,
        services: SERVICES.map((x) => ({ ...x, fits_today: fitsToday(s, x.minutes, wait) })),
      };
    },
    get_board(s) {
      const svcMin = (code) => (svc(code) || {}).minutes || 30;
      return {
        server_time: nowIso(), bays: s.settings.bays, is_open: isOpen(s), accepting: s.settings.accepting,
        wait_minutes: estimateWait(s, null),
        waiting_count: s.queue.filter((q) => q.service_day === s.day && q.status === 'waiting').length,
        serving: s.queue.filter((q) => q.status === 'serving' && q.service_day === s.day).sort((a, b) => a.bay - b.bay)
          .map((q) => ({ num: q.num, bay: q.bay, service_code: q.service_code, total_minutes: svcMin(q.service_code), first_name: '',
            minutes_left: Math.max(0, Math.ceil(svcMin(q.service_code) - (Date.now() - Date.parse(q.called_at)) / MIN)) })),
        next: s.queue.filter((q) => q.service_day === s.day && q.status === 'waiting').sort((a, b) => a.num - b.num).slice(0, 8)
          .map((q) => ({ num: q.num, service_code: q.service_code, wait_minutes: estimateWait(s, q.num) })),
      };
    },
    join_queue(s, { p_name, p_car, p_service, p_size, p_phone, p_lang, p_color }) {
      const name = String(p_name || '').trim();
      if (name.length < 2 || name.length > 80) fail('NOM_INVALIDE');
      const car = String(p_car || '').trim();
      if (car.length < 2) fail('VEHICULE_REQUIS');
      const color = String(p_color || '').trim() || null;
      if (car.length > 80 || (color && color.length > 40)) fail('CHAMP_TROP_LONG');
      const service = svc(p_service);
      if (!service) fail('FORFAIT_INVALIDE');
      if (!service.prices[p_size]) fail('TAILLE_INVALIDE');
      let digits = String(p_phone || '').replace(/\D/g, '');
      if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
      if (!digits) fail('TELEPHONE_REQUIS');
      if (digits.length !== 10) fail('TELEPHONE_INVALIDE');
      const phone = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
      if (!isOpen(s)) fail('FERME');
      if (!fitsToday(s, service.minutes, estimateWait(s, null))) fail('TROP_TARD');
      const active = s.queue.filter((q) => q.service_day === s.day);
      if (active.filter((q) => q.status === 'waiting').length >= s.settings.max_waiting) fail('FILE_PLEINE');
      if (active.some((q) => q.phone === phone && ['waiting', 'serving'].includes(q.status))) fail('DEJA_INSCRIT');
      const num = Math.max(0, ...active.map((q) => q.num)) + 1;
      const row = {
        id: s.nextId++, num, service_day: s.day, token: uuid(), name, car, color,
        service_code: service.code, vehicle_size: p_size, price: service.prices[p_size], phone,
        lang: p_lang === 'en' ? 'en' : 'fr', status: 'waiting', bay: null, cancelled_by: null,
        created_at: nowIso(), called_at: null, finished_at: null,
      };
      s.queue.push(row);
      return { num, token: row.token };
    },
    get_ticket(s, { p_token }) {
      const v = s.queue.find((q) => q.token === p_token);
      if (!v) return null;
      const sameDay = s.queue.filter((q) => q.service_day === v.service_day);
      return {
        ...pick(v, ['num', 'name', 'service_code', 'vehicle_size', 'color', 'price', 'status', 'bay', 'cancelled_by']),
        minutes: svc(v.service_code).minutes,
        is_today: v.service_day === s.day,
        serving_nums: servingNums(s),
        ahead: v.status === 'waiting' ? sameDay.filter((q) => q.status === 'waiting' && q.num < v.num).length : 0,
        passed: sameDay.filter((q) => q.num < v.num && ['serving', 'done', 'cancelled'].includes(q.status)).length,
        eta_minutes: v.status === 'waiting' ? estimateWait(s, v.num) : 0,
      };
    },
    find_ticket(s, { p_phone, p_num }) {
      let digits = String(p_phone || '').replace(/\D/g, '');
      if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
      s.lookupAttempts = (s.lookupAttempts || []).filter((at) => at > Date.now() - 600000);
      if (s.lookupAttempts.length >= 10) fail('TROP_DE_DEMANDES');
      s.lookupAttempts.push(Date.now()); save(s, false);
      if (digits.length !== 10 || !Number.isInteger(p_num) || p_num < 1) return null;
      const phone = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
      const hit = s.queue
        .filter((q) => q.service_day === s.day && q.phone === phone && q.num === p_num
          && ['waiting', 'serving', 'done'].includes(q.status))
        .sort((a, b) => (a.status === 'done') - (b.status === 'done') || b.num - a.num)[0];
      return hit ? hit.token : null;
    },
    leave_queue(s, { p_token }) {
      const v = s.queue.find((q) => q.token === p_token && q.status === 'waiting');
      if (!v) return false;
      Object.assign(v, { status: 'cancelled', cancelled_by: 'client', finished_at: nowIso() });
      return true;
    },
    get_admin_dashboard(s) {
      requireAdmin();
      const day = s.queue.filter((q) => q.service_day === s.day);
      return {
        today: s.day, is_open: isOpen(s), accepting: s.settings.accepting, bays: s.settings.bays,
        wait_minutes: estimateWait(s, null),
        serving: s.queue.filter((q) => q.status === 'serving').sort((a, b) => a.bay - b.bay)
          .map((q) => ({ ...pick(q, ['id', 'num', 'name', 'car', 'color', 'service_code', 'vehicle_size', 'price', 'phone', 'called_at', 'bay']), minutes: svc(q.service_code).minutes })),
        waiting: day.filter((q) => q.status === 'waiting').sort((a, b) => a.num - b.num)
          .map((q) => pick(q, ['id', 'num', 'name', 'car', 'color', 'service_code', 'vehicle_size', 'price', 'phone', 'created_at'])),
        history: day.filter((q) => ['done', 'cancelled'].includes(q.status)).sort((a, b) => b.num - a.num).slice(0, 60)
          .map((q) => pick(q, ['id', 'num', 'name', 'service_code', 'vehicle_size', 'price', 'status', 'cancelled_by', 'called_at', 'finished_at'])),
        done_count: day.filter((q) => q.status === 'done').length,
        revenue: Math.round(day.filter((q) => q.status === 'done').reduce((t, q) => t + q.price, 0) * 100) / 100,
      };
    },
    call_next(s) { requireAdmin(); return promoteNext(s) || { num: null }; },
    finish_client(s, { p_id }) {
      requireAdmin();
      const v = s.queue.find((q) => q.id === p_id && q.status === 'serving');
      if (v) Object.assign(v, { status: 'done', finished_at: nowIso() });
    },
    remove_client(s, { p_id }) {
      requireAdmin();
      const v = s.queue.find((q) => q.id === p_id && ['waiting', 'serving'].includes(q.status));
      if (!v) return;
      Object.assign(v, { status: 'cancelled', cancelled_by: 'staff', finished_at: nowIso() });
      if (v.called_at) promoteNext(s);
    },
    set_accepting(s, { p_on }) { requireAdmin(); s.settings.accepting = !!p_on; },
    set_bays(s, { p_bays }) {
      requireAdmin();
      if (!Number.isInteger(p_bays) || p_bays < 1 || p_bays > 20) fail('BAIES_INVALIDE');
      if (s.queue.some((q) => q.status === 'serving' && q.bay > p_bays)) fail('BAIE_OCCUPEE');
      s.settings.bays = p_bays;
    },
    reset_today(s) {
      requireAdmin();
      s.queue.filter((q) => q.service_day === s.day && ['waiting', 'serving'].includes(q.status))
        .forEach((q) => Object.assign(q, { status: 'cancelled', cancelled_by: 'staff', finished_at: nowIso() }));
    },
  };
  const READ_ONLY = ['get_queue_status', 'get_board', 'get_ticket', 'get_admin_dashboard', 'find_ticket'];

  // ---------- Faux client supabase-js ----------
  const listeners = new Set();
  window.addEventListener('storage', (e) => { if (e.key === KEY) listeners.forEach((fn) => { try { fn(); } catch {} }); });

  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
  }
  const delay = () => new Promise((r) => setTimeout(r, 120 + Math.random() * 120));   // petite latence réaliste

  const client = {
    async rpc(fn, args = {}) {
      await delay();
      const s = load();
      try {
        if (!RPC[fn]) fail('fonction inconnue : ' + fn);
        const data = RPC[fn](s, args) ?? null;
        if (!READ_ONLY.includes(fn)) save(s);
        return { data: data === undefined ? null : JSON.parse(JSON.stringify(data)), error: null };
      } catch (e) {
        return { data: null, error: { message: e.message, code: e.code || 'P0001' } };
      }
    },
    auth: {
      async signInWithPassword({ email, password }) {
        await delay();
        const session = { access_token: 'demo', user: { email: email || 'demo' } };   // démo : tout est accepté
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        return { data: { session }, error: null };
      },
      async signOut() { localStorage.removeItem(SESSION_KEY); return { error: null }; },
      async getSession() { return { data: { session: getSession() } }; },
    },
    channel() {
      const ch = {
        on(_type, _filter, cb) { ch.cb = cb; return ch; },
        subscribe() { if (ch.cb) listeners.add(ch.cb); return ch; },
      };
      return ch;
    },
    removeChannel(ch) { if (ch && ch.cb) listeners.delete(ch.cb); },
  };
  window.supabase = { createClient: () => client };

  // ---------- Bandeau « mode démo » ----------
  window.LUX_DEMO = {
    reset() { localStorage.setItem(KEY, JSON.stringify(seed())); localStorage.removeItem('lux_ticket_v1'); location.reload(); },
    toggleEndOfDay() {
      const s = load();
      if (s.settings.simulateCloseAt) {
        delete s.settings.simulateCloseAt;
      } else {
        // Fermeture simulée juste assez tard pour qu'un Express passe encore, mais pas les forfaits longs
        const d = new Date(Date.now() + (estimateWait(s, null) + 15) * MIN);
        d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
        s.settings.simulateCloseAt = d.toISOString();
      }
      save(s);
      return !!s.settings.simulateCloseAt;
    },
    isEndOfDay() { return !!load().settings.simulateCloseAt; },
    addFakeClient() {
      const s = load();
      const names = ['Olivier Gagnon', 'Chloé Tremblay', 'Lucas Martin', 'Emma Pelletier', 'Noah Côté', 'Léa Morin', 'James Wilson', 'Sofia Rossi'];
      const cars = ['Hyundai Elantra', 'Kia Sorento', 'Chevrolet Silverado', 'VW Golf', 'Jeep Wrangler', 'Nissan Rogue'];
      const sizes = ['sedan', 'suv', 'truck'];
      const r = (a) => a[Math.floor(Math.random() * a.length)];
      const phone = '438-555-' + String(1000 + Math.floor(Math.random() * 9000));
      RPC.join_queue(s, { p_name: r(names), p_car: r(cars), p_service: r(['express', 'express', 'signature', 'absolux']), p_size: r(sizes), p_phone: phone, p_lang: 'fr' });
      save(s);
    },
  };

  document.addEventListener('DOMContentLoaded', () => {
    const isAdmin = /admin\.html$/.test(location.pathname);
    const bar = document.createElement('div');
    bar.className = 'demo-bar';
    bar.innerHTML = `
      <span class="demo-tag">Démo</span>
      <a href="index.html" class="${isAdmin ? '' : 'on'}">Client</a>
      <a href="admin.html" class="${isAdmin ? 'on' : ''}">Personnel</a>
      ${isAdmin ? '<button type="button" data-demo="add" title="Ajouter un client fictif">+ Client</button>'
        : `<button type="button" data-demo="eod" title="Simuler la fin de journée (fermeture imminente)" class="${window.LUX_DEMO.isEndOfDay() ? 'on' : ''}">Fermeture</button>`}
      <button type="button" data-demo="reset" title="Remettre la démo à son état de départ">↺</button>`;
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-demo]');
      if (!b) return;
      if (b.dataset.demo === 'add') window.LUX_DEMO.addFakeClient();
      if (b.dataset.demo === 'eod') {
        b.classList.toggle('on', window.LUX_DEMO.toggleEndOfDay());
        window.dispatchEvent(new Event('online'));   // la page client se rafraîchit tout de suite
      }
      if (b.dataset.demo === 'reset' && confirm('Remettre la démo à son état de départ ?')) window.LUX_DEMO.reset();
    });
    const css = document.createElement('style');
    css.textContent = `
      .demo-bar { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 100; display: flex; align-items: center; gap: 4px;
        padding: 5px; border-radius: 100px; background: rgba(5,11,29,0.92); border: 1px solid rgba(74,158,255,0.4);
        box-shadow: 0 10px 30px rgba(0,0,0,0.5), 0 0 24px rgba(74,158,255,0.15); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; }
      .demo-bar .demo-tag { color: #ffc94d; padding: 0 8px 0 10px; }
      .demo-bar a, .demo-bar button { color: #c5d1e8; text-decoration: none; background: none; border: none; cursor: pointer;
        padding: 8px 12px; border-radius: 100px; font: inherit; letter-spacing: inherit; text-transform: inherit; }
      .demo-bar button.on { background: rgba(255,201,77,0.18); color: #ffc94d; }
      .demo-bar a.on { background: linear-gradient(135deg, #1e88e5, #1565c0); color: #fff; }
      .demo-bar button:hover, .demo-bar a:not(.on):hover { background: rgba(255,255,255,0.08); }
      body { padding-bottom: 70px; }
      @media (max-width: 420px) {
        .demo-bar { gap: 2px; font-size: 10px; letter-spacing: 0.04em; }
        .demo-bar a, .demo-bar button { padding: 8px 9px; }
        .demo-bar .demo-tag { padding: 0 4px 0 8px; }
      }`;
    document.head.appendChild(css);
    document.body.appendChild(bar);

    // Connexion du personnel pré-remplie
    const email = document.getElementById('login-email');
    const pwd = document.getElementById('login-pwd');
    if (email && pwd) {
      email.value = 'demo@theluxoplus.com';
      pwd.value = 'demo';
      const p = document.querySelector('.login-card p');
      if (p) p.textContent = 'Mode démo : cliquez simplement sur « Entrer ».';
    }
  });
})();
