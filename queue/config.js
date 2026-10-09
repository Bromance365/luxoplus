// Configuration partagée par index.html (clients) et admin.html (personnel).
// La clé "publishable" est publique par conception : la sécurité repose sur
// les règles RLS et les fonctions de supabase/schema.sql.
//
// Prix et durées des forfaits : table public.services (font foi).
// Ici : seulement les textes affichés.
window.APP_CONFIG = {
  // true = démo autonome dans le navigateur (demo-backend.js), sans Supabase.
  // Passer à false une fois Supabase configuré (voir README).
  demo: true,

  supabaseUrl: 'https://VOTRE-PROJET.supabase.co',
  supabaseKey: 'sb_publishable_REMPLACER',

  business: {
    name: 'Lave Auto Luxoplus',
    address: '5300 Av. Van Horne, Montréal, QC H3X 4A9',
    phone: '(438) 529-9750',
    email: 'luxoplusmtl@gmail.com',
    website: 'https://theluxoplus.com',
    instagram: 'https://www.instagram.com/laveauto_luxoplus',
  },

  services: {
    express: {
      name: 'Express.',
      tag: { fr: 'Le rafraîchissement rapide.', en: 'The quick refresh.' },
      features: {
        fr: ['Lavage extérieur complet', 'Rinçage et séchage rapide', 'Aspiration intérieure légère', 'Rinçage des roues et pneus'],
        en: ['Full exterior wash', 'Rinse & quick dry', 'Light interior vacuum', 'Wheel & tire rinse'],
      },
    },
    signature: {
      name: 'Signature+',
      featured: true,
      tag: { fr: 'Intérieur et extérieur — le luxe au quotidien.', en: 'Inside & out — the everyday luxury.' },
      features: {
        fr: ['Lavage extérieur complet', 'Aspiration intérieure complète', 'Nettoyage intérieur en profondeur', 'Tableau de bord et surfaces', 'Vitres, intérieur et extérieur', 'Mini-esthétique côté conducteur'],
        en: ['Full exterior wash', 'Complete interior vacuum', 'Deep interior cleaning', 'Dashboard & surfaces', 'Windows, inside & out', 'Mini driver-side detail'],
      },
    },
    absolux: {
      name: 'ABSOLUX.',
      tag: { fr: 'La transformation complète.', en: 'The full transformation.' },
      features: {
        fr: ['Nettoyage intérieur en profondeur', 'Lavage extérieur détaillé', 'Décontamination des surfaces', 'Sièges et endroits difficiles d’accès', 'Restauration des plastiques et finis', 'Traitement esthétique complet'],
        en: ['Deep interior cleaning', 'Detailed exterior wash', 'Surface decontamination', 'Seats & hard-to-reach areas', 'Plastics & finish restoration', 'Complete aesthetic treatment'],
      },
    },
  },

  sizes: {
    sedan: { fr: 'Berline', en: 'Sedan', hint: { fr: 'ou à hayon', en: 'or hatchback' } },
    suv:   { fr: 'VUS', en: 'SUV', hint: { fr: 'ou multisegment', en: 'or crossover' } },
    truck: { fr: 'Camion', en: 'Truck', hint: { fr: 'ou grand VUS', en: 'or large SUV' } },
  },

  // Alerte « presque votre tour » quand le début estimé est dans ≤ N minutes
  alertMinutes: 15,
};

// ---------- Utilitaires communs ----------
window.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

window.fmtPrice = (n, lang = 'fr') => {
  const v = Number(n);
  return lang === 'en'
    ? '$' + v.toFixed(2)
    : v.toFixed(2).replace('.', ',') + ' $';
};

window.fmtDuration = (min, lang = 'fr') => {
  min = Math.max(0, Math.round(min));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
};

// All estimates use Montreal time, even on a travelling customer's device.
window.businessTimeZone = 'America/Toronto';
window.fmtTime = (date, lang = 'fr') => new Intl.DateTimeFormat(lang === 'en' ? 'en-CA' : 'fr-CA', {
  hour: 'numeric', minute: '2-digit', timeZone: window.businessTimeZone,
}).format(date);
window.fmtClock = (minFromNow, lang = 'fr', baseTime = Date.now()) => window.fmtTime(
  new Date(Math.round((baseTime + minFromNow * 60000) / 300000) * 300000), lang,
);
window.businessDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: window.businessTimeZone,
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (name) => parts.find((p) => p.type === name).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};

window.formatHours = (st, lang = 'fr') => {
  if (!st || !st.open_days) return '';
  const names = lang === 'en'
    ? ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    : ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const days = [...st.open_days].sort((a, b) => a - b);
  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  const dayTxt = days.length === 7 ? (lang === 'en' ? 'Every day' : 'Tous les jours')
    : contiguous && days.length > 2 ? `${names[days[0]]}–${names[days[days.length - 1]]}`
    : days.map((d) => names[d]).join(', ');
  const h = (t) => {
    if (lang !== 'en') return t.replace(':00', ' h').replace(':', ' h ');
    let [hh, mm] = t.split(':').map(Number);
    const ap = hh >= 12 ? 'p' : 'a';
    hh = hh % 12 || 12;
    return `${hh}${mm ? ':' + String(mm).padStart(2, '0') : ''}${ap}`;
  };
  return `${dayTxt} · ${h(st.open_time)}–${h(st.close_time)}`;
};

// Emblème « bulles » de la marque (SVG inline ; id de dégradé unique à chaque appel)
let luxEmblemCount = 0;
window.luxEmblem = (id = 'lux-bg-' + (++luxEmblemCount)) => `<svg class="emblem" viewBox="0 0 100 100" aria-hidden="true">
  <defs><radialGradient id="${id}" cx="0.35" cy="0.3" r="0.7">
    <stop offset="0%" stop-color="#b8ddff"/><stop offset="50%" stop-color="#4a9eff"/><stop offset="100%" stop-color="#0d47a1"/>
  </radialGradient></defs>
  <circle cx="50" cy="50" r="32" fill="url(#${id})"/><circle cx="80" cy="24" r="9" fill="url(#${id})"/>
  <circle cx="22" cy="22" r="6" fill="url(#${id})"/><circle cx="82" cy="76" r="7" fill="url(#${id})"/>
  <circle cx="18" cy="74" r="5" fill="url(#${id})"/>
  <ellipse cx="40" cy="40" rx="7" ry="5" fill="rgba(255,255,255,0.6)" transform="rotate(-30 40 40)"/>
  <path d="M50 32 L52 44 L64 46 L52 48 L50 60 L48 48 L36 46 L48 44 Z" fill="rgba(255,255,255,0.85)"/>
</svg>`;
