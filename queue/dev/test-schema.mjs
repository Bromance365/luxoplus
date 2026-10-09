// Tests du schéma SQL dans PGlite (Postgres en WebAssembly).   npm test
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';

const db = new PGlite();
const ADMIN = '11111111-1111-1111-1111-111111111111', OTHER = '22222222-2222-2222-2222-222222222222';
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  grant usage on schema public to anon, authenticated;
  create schema auth; grant usage on schema auth to anon, authenticated;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated;
  insert into auth.users values ('${ADMIN}'), ('${OTHER}');
`);
await db.exec(fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
await db.exec(`insert into admins values ('${ADMIN}');
  update settings set open_days='{1,2,3,4,5,6,7}', open_time='00:00', close_time='23:59:59', bays=2;`);

let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); if (!c) fails++; };
const as = async (role, uid, sql, params = [], ip = '1.2.3.4') => {
  await db.exec(`reset role; select set_config('test.uid','${uid || ''}',false);
    select set_config('request.headers','{"x-forwarded-for":"${ip}, 10.0.0.1"}',false); set role ${role};`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
};
const err = async (...a) => { try { await as(...a); return null; } catch (e) { return e.message; } };
const rpc1 = async (...a) => Object.values((await as(...a))[0])[0];
const JOIN = 'select join_queue($1,$2,$3,$4,$5,$6)';
let phoneSeq = 1000;
const nextPhone = () => '514-555-' + (++phoneSeq);
const join = (name, service = 'express', size = 'sedan', phone = '', ip) =>
  rpc1('anon', null, JOIN, [name, 'Civic', service, size, phone || nextPhone(), 'fr'], ip);
const adm = (sql, p) => rpc1('authenticated', ADMIN, sql, p);
const ticket = (t) => rpc1('anon', null, 'select get_ticket($1)', [t.token]);
const idOf = async (num) => (await as('postgres', null, 'select id from queue where num=$1 and service_day=local_today()', [num]))[0].id;

// --- Accès direct interdit
ok((await err('anon', null, 'select * from queue'))?.includes('permission denied'), 'anon ne peut pas lire queue');
ok((await err('anon', null, 'select * from services'))?.includes('permission denied'), 'anon ne peut pas lire services directement');
ok((await err('anon', null, 'delete from queue'))?.includes('permission denied'), 'anon ne peut pas vider queue');
ok((await err('anon', null, 'update services set price_sedan=0'))?.includes('permission denied'), 'anon ne peut pas changer les prix');
ok((await err('anon', null, 'select call_next()'))?.includes('permission denied'), 'anon ne peut pas appeler call_next');
ok((await err('authenticated', OTHER, 'select call_next()'))?.includes('ACCES_REFUSE'), 'connecté non-admin refusé');
ok((await as('authenticated', OTHER, 'select * from queue')).length === 0, 'connecté non-admin ne voit aucune ligne');

// --- Statut public et forfaits
let st = await rpc1('anon', null, 'select get_queue_status()');
ok(st.services.map((s) => s.code).join() === 'express,signature,absolux', 'forfaits publiés dans l\'ordre');
ok(Number(st.services[1].prices.suv) === 84.99 && st.services[2].minutes === 300, 'prix et durées des forfaits');
ok(st.bays === 2 && st.wait_minutes === 0, '2 baies, aucune attente');

// --- Inscriptions et validations
const a = await join('Jean Tremblay', 'express', 'sedan', '438 555-0101');     // 30 min
const b = await join('Marie Roy', 'signature', 'suv', '');                    // 120 min
const c = await join('Luc Côté', 'express', 'truck', '1-438-555-0103');       // 30 min
const d = await join('Ana Diaz', 'absolux', 'sedan', '');                     // 300 min
ok([a, b, c, d].map((x) => x.num).join() === '1,2,3,4', 'numéros séquentiels 1..4');
ok((await err('anon', null, JOIN, ['X Y', 'Civic', 'lavage', 'sedan', '', 'fr']))?.includes('FORFAIT_INVALIDE'), 'forfait inconnu refusé');
ok((await err('anon', null, JOIN, ['X Y', 'Civic', 'express', 'moto', '', 'fr']))?.includes('TAILLE_INVALIDE'), 'taille inconnue refusée');
ok((await err('anon', null, JOIN, ['X Y', 'Civic', 'express', 'sedan', '438-555-0101', 'fr']))?.includes('DEJA_INSCRIT'), 'même téléphone refusé');
ok((await err('anon', null, JOIN, ['X Y', 'Civic', 'express', 'sedan', '123', 'fr']))?.includes('TELEPHONE_INVALIDE'), 'téléphone invalide refusé');
ok((await err('anon', null, JOIN, ['X Y', 'Civic', 'express', 'sedan', '', 'fr']))?.includes('TELEPHONE_REQUIS'), 'téléphone obligatoire');
ok((await err('anon', null, JOIN, ['X Y', ' ', 'express', 'sedan', '514-555-9999', 'fr']))?.includes('VEHICULE_REQUIS'), 'véhicule obligatoire');
ok((await err('anon', null, JOIN, [' ', 'Civic', 'express', 'sedan', '', 'fr']))?.includes('NOM_INVALIDE'), 'nom vide refusé');
const row = (await as('authenticated', ADMIN, 'select phone, price from queue where num=3'))[0];
ok(row.phone === '438-555-0103' && Number(row.price) === 49.99, 'téléphone normalisé et prix camion figé (49.99)');
const col = await rpc1('anon', null, 'select join_queue($1,$2,$3,$4,$5,$6,$7)', ['Coul Eur', 'Kia Soul', 'express', 'sedan', nextPhone(), 'fr', '  Rouge  ']);
ok((await as('postgres', null, 'select color from queue where token=$1', [col.token]))[0].color === 'Rouge', 'couleur facultative enregistrée');
await as('postgres', null, 'delete from queue where token=$1', [col.token]);

// --- Estimations avec 2 baies, personne en service
// #1 et #2 entrent tout de suite ; #3 attend la fin de l'Express (#1, 30 min) ; #4 attend la fin de #3 (60 min)
let t = await ticket(c);
ok(t.ahead === 2 && t.eta_minutes === 30 && !('phone' in t), `#3 : 2 devant (#1, #2 prendront les 2 baies) → attend l'Express de #1, 30 min (${t.eta_minutes})`);
ok((await ticket(a)).eta_minutes === 0, '#1 : baie libre → 0 min');
await adm('select call_next()'); await adm('select call_next()');
ok((await adm('select call_next()')).num === null, '3e appel refusé : les 2 baies sont occupées');
t = await ticket(c);
ok(t.ahead === 0 && t.eta_minutes >= 29 && t.eta_minutes <= 30, `#3 attend l'Express de #1 (~30 min : ${t.eta_minutes})`);
t = await ticket(d);
ok(t.eta_minutes >= 59 && t.eta_minutes <= 60, `#4 attend après #3 (~60 min : ${t.eta_minutes})`);
let t1 = await ticket(a);
ok(t1.status === 'serving' && t1.bay === 1, '#1 en baie 1');
ok((await ticket(b)).bay === 2, '#2 en baie 2');

// --- Terminer libère la baie ; appeler la remplit
await adm('select finish_client($1)', [await idOf(1)]);
ok((await ticket(a)).status === 'done', '#1 terminé');
let r = await adm('select call_next()');
ok(r.num === 3 && r.bay === 1, '#3 entre dans la baie 1 libérée');

// --- Client in service cannot cancel; staff may release and reassign the bay
// --- Client en service qui part → baie réattribuée automatiquement
ok(await rpc1('anon', null, 'select leave_queue($1)', [b.token]) === false, 'client cannot cancel an in-service ticket');
await adm('select remove_client($1)', [await idOf(2)]);
t = await ticket(d);
ok(t.status === 'serving' && t.bay === 2, '#4 promu automatiquement en baie 2');
ok(await rpc1('anon', null, 'select leave_queue($1)', [b.token]) === false, 'repeated cancellation ignored');

const departing = await join('Waiting Departure');
ok(await rpc1('anon', null, 'select leave_queue($1)', [departing.token]) === true, 'waiting customer can leave');

// --- Retrouver ma place (téléphone + numéro)
const FIND = 'select find_ticket($1, $2)';
ok(await rpc1('anon', null, FIND, ['(438) 555-0103', 3], '7.7.7.7') === c.token, 'retrouver ma place : bon téléphone + numéro → même billet');
ok(await rpc1('anon', null, 'select find_ticket($1)', ['1 438 555 0103'], '7.7.7.7') === null, 'phone alone cannot recover a ticket');
ok(await rpc1('anon', null, FIND, ['438-555-0103', 4], '7.7.7.7') === null, 'mauvais numéro → introuvable (null)');
ok(await rpc1('anon', null, FIND, ['438-555-0000', 3], '7.7.7.7') === null, 'mauvais téléphone → introuvable (null)');
for (let i = 0; i < 6; i++) await rpc1('anon', null, FIND, ['438-555-0000', 3], '7.7.7.7');
ok((await err('anon', null, FIND, ['438-555-0103', 3], '7.7.7.7'))?.includes('TROP_DE_DEMANDES'), 'plus de 10 essais en 10 min → bloqué');
ok(await rpc1('anon', null, FIND, ['438-555-0103', 3], '8.8.8.8') === c.token, 'autre connexion non bloquée');
ok((await err('anon', null, 'select * from lookup_attempts'))?.includes('permission denied'), 'anon ne peut pas lire les tentatives');

// --- Retrait par le personnel
const e = await join('Paul Gagnon');
await adm('select remove_client($1)', [await idOf(e.num)]);
t = await ticket(e);
ok(t.status === 'cancelled' && t.cancelled_by === 'staff', 'retrait par le personnel');

// --- Dashboard et revenus
let dash = await adm('select get_admin_dashboard()');
ok(dash.serving.length === 2 && dash.waiting.length === 0 && dash.done_count === 1, 'dashboard : 2 en service, 1 terminé');
ok(Number(dash.revenue) === 29.99, `revenus du jour = prix des terminés (${dash.revenue})`);
ok(dash.history.some((h) => h.cancelled_by === 'client') && dash.history.some((h) => h.cancelled_by === 'staff'), 'historique avec motifs');

// --- Nombre de baies
await adm('select set_bays($1)', [3]);
ok((await rpc1('anon', null, 'select get_queue_status()')).bays === 3, 'nombre de baies modifiable');
ok((await err('authenticated', ADMIN, 'select set_bays(0)'))?.includes('BAIES_INVALIDE'), 'baies invalides refusées');
await adm('select set_bays($1)', [2]);

// --- Forfait trop long pour l'heure de fermeture
const hourNow = (await as('postgres', null, 'select extract(hour from local_now())::int h'))[0].h;
if (hourNow < 20) {
  // fermeture dans 60 min + 30 min de tolérance = fin possible jusqu'à 90 min
  await db.exec(`update settings set close_time = (local_now() + interval '60 minutes')::time`);
  for (const id of (await as('authenticated', ADMIN, "select id from queue where status='serving'")).map((x) => x.id)) {
    await adm('select finish_client($1)', [id]);
  }
  st = await rpc1('anon', null, 'select get_queue_status()');
  const fits = Object.fromEntries(st.services.map((s) => [s.code, s.fits_today]));
  ok(fits.express && !fits.signature && !fits.absolux, 'fermeture dans 60 min (+30 de tolérance) : seul Express est possible');
  await db.exec(`update settings set close_time = (local_now() + interval '95 minutes')::time`);
  st = await rpc1('anon', null, 'select get_queue_status()');
  ok(st.services.find((s) => s.code === 'signature').fits_today && st.close_grace_minutes === 30,
     'fermeture dans 95 min : Signature+ (2 h) finit 25 min après → accepté grâce aux 30 min');
  await db.exec(`update settings set close_time = (local_now() + interval '60 minutes')::time`);
  ok((await err('anon', null, JOIN, ['Zed Late', 'Civic', 'absolux', 'sedan', nextPhone(), 'fr']))?.includes('TROP_TARD'), 'ABSOLUX refusé (trop tard)');
  ok((await join('Zed Ok', 'express')).num > 0, 'Express accepté');
  await db.exec(`update settings set close_time = '23:59:59'`);
} else {
  console.log('SKIP test de fermeture (il est trop tard dans la journée pour le simuler)');
}

// --- Fermeture manuelle
await adm('select set_accepting(false)');
ok((await err('anon', null, JOIN, ['Paul Gagnon', 'Civic', 'express', 'sedan', nextPhone(), 'fr']))?.includes('FERME'), 'inscriptions suspendues');
await adm('select set_accepting(true)');

// --- Limite par IP
await db.exec('update settings set max_active_per_ip=2');
await join('Aa Bb', 'express', 'sedan', '', '9.9.9.9');
await join('Cc Dd', 'express', 'sedan', '', '9.9.9.9');
ok((await err('anon', null, JOIN, ['Ee Ff', 'Civic', 'express', 'sedan', nextPhone(), 'fr'], '9.9.9.9'))?.includes('TROP_DE_DEMANDES'), 'limite par IP');

// --- Concurrence (PGlite = 1 connexion : vérifie surtout l'unicité)
await db.exec('update settings set max_active_per_ip=100');
const nums = await Promise.all(Array.from({ length: 15 }, (_, i) => join('Client ' + i, 'express', 'sedan', '', '5.5.5.' + i).then((x) => x.num)));
ok(new Set(nums).size === 15, 'pas de doublon de numéros');

// --- Remise à zéro
await adm('select reset_today()');
r = await join('Zoe Lee');
ok(r.num > Math.max(...nums), 'clearing active tickets does not reuse numbers');
ok((await ticket(a)).status === 'done', 'clearing the queue preserves completed services');
ok((await adm('select get_admin_dashboard()')).revenue > 0, 'clearing the queue preserves revenue');

// --- Jour suivant
await db.exec(`reset role; update queue set service_day = service_day - 1`);
const old = await ticket(r);
ok(old.is_today === false, 'ticket d\'hier marqué is_today=false');
ok((await join('Max Roy')).num === 1, 'nouveau jour → numéro 1');
await adm('select call_next()');
ok((await ticket(r)).status === 'cancelled', 'attente d\'hier expirée par call_next');
ok((await rpc1('anon', null, 'select get_ticket($1)', ['00000000-0000-0000-0000-000000000000'])) === null, 'jeton inconnu → null');

// --- Écran TV : get_board (lecture publique minimale)
{
  const board = await rpc1('anon', null, 'select get_board()');
  const rows = await as('postgres', null, 'select name, car, phone, price from queue');
  const dump = JSON.stringify(board);
  ok(Array.isArray(board.serving) && Array.isArray(board.next) && board.bays === 2, 'get_board : forme attendue (serving, next, bays)');
  ok(board.serving.every((x) => x.num && x.bay && x.first_name === '' && x.minutes_left >= 0 && x.total_minutes > 0), 'get_board : ticket number, bay and duration; names hidden');
  ok(board.next.length <= 8 && board.next.every((x, i, a) => i === 0 || a[i - 1].num < x.num), 'get_board : 8 prochains max, dans l\'ordre');
  ok(board.next.every((x) => x.wait_minutes >= 0), 'get_board : attente estimée par numéro');
  const leaks = rows.flatMap((r) => [r.phone, r.car, r.name]).filter((v) => v && dump.includes(v));
  ok(leaks.length === 0, 'get_board : aucun téléphone, véhicule ni nom de famille' + (leaks.length ? ' (fuite : ' + leaks[0] + ')' : ''));
  ok(!/price|phone|car\b|token/.test(dump), 'get_board : aucun champ prix / téléphone / véhicule / jeton');
  ok((await err('anon', null, 'select * from queue'))?.includes('permission denied'), 'get_board n\'ouvre pas la table queue');
}

// --- Purge Loi 25
await db.exec(`update queue set service_day = service_day - 40 where name='Zoe Lee'`);
ok(await rpc1('postgres', null, 'select purge_personal_data(30)') === 1, 'purge des données de plus de 30 jours');

// Regression: an occupied bay cannot be removed; yesterday's jobs do not consume capacity.
const dayTicket = await join('Second Bay');
await adm('select call_next()');
ok((await err('authenticated', ADMIN, 'select set_bays(1)'))?.includes('BAIE_OCCUPEE'), 'occupied bay removal refused');
ok((await err('authenticated', ADMIN, 'select set_bays(null)'))?.includes('BAIES_INVALIDE'), 'null bay count refused');
await db.exec(`update queue set service_day=service_day-10 where status='serving'`);
ok((await adm('select get_admin_dashboard()')).serving.length === 0, 'yesterday serving tickets excluded from dashboard');
ok((await rpc1('anon', null, 'select get_queue_status()')).wait_minutes === 0, 'yesterday serving tickets do not add wait time');
await adm('select call_next()');
ok((await ticket(dayTicket)).status === 'cancelled', 'yesterday serving tickets expire before today is called');

// Regression: all privileged helpers remain inaccessible to the public.
for (const sql of ['select _promote_next()', 'select purge_personal_data(1)', 'select reset_today()']) {
  ok((await err('anon', null, sql))?.includes('permission denied'), 'anonymous helper blocked: ' + sql);
}
ok((await err('postgres', null, 'select purge_personal_data(0)'))?.includes('RETENTION_INVALIDE'), 'invalid retention refused');
// Verify rerunning the upgrade preserves privileges and records.
const beforeUpgrade = (await db.query('select count(*)::int as n from queue')).rows[0].n;
await db.exec(fs.readFileSync(new URL('../supabase/update-queue.sql', import.meta.url), 'utf8'));
ok((await db.query('select count(*)::int as n from queue')).rows[0].n === beforeUpgrade, 'upgrade preserves all queue records');
ok((await err('anon', null, 'select _promote_next()'))?.includes('permission denied'), 'upgrade keeps helper private');
ok((await rpc1('anon', null, 'select get_board()')).serving.every((x) => x.first_name === ''), 'upgrade preserves public board privacy');

const postflight = await db.exec(fs.readFileSync(new URL('../supabase/postflight.sql', import.meta.url), 'utf8'));
ok(postflight[0].rows.length === 5 && postflight[0].rows.every((r) => r.rowsecurity), 'postflight confirms RLS on all five tables');
ok(postflight[1].rows.every((r) => !r.anonymous_direct_read && !r.authenticated_direct_write), 'postflight confirms direct table access stays closed');

console.log(fails ? `\n${fails} ÉCHEC(S)` : '\nTous les tests passent');
process.exit(fails ? 1 : 0);
