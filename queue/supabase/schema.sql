-- =====================================================================
--  LUX·O·PLUS — File d'attente du garage (schéma Supabase)
--  À exécuter UNE fois dans Supabase › SQL Editor (projet neuf de préférence).
--
--  Principes :
--   • Le public (clé "publishable"/anon) n'a AUCUN accès direct aux tables.
--     Il passe uniquement par des fonctions RPC qui ne renvoient que le strict
--     nécessaire (jamais les téléphones des autres clients).
--   • Les actions du personnel exigent une connexion Supabase Auth ET une
--     entrée dans la table public.admins.
--   • Les numéros sont attribués par la base, par journée (service_day).
--   • Plusieurs baies travaillent en parallèle (settings.bays) ; l'attente est
--     estimée à partir de la durée de chaque forfait.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Tables
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id                  int primary key default 1 check (id = 1),
  business_tz         text    not null default 'America/Toronto',   -- heure de Montréal
  bays                int     not null default 2 check (bays between 1 and 20),
  open_days           int[]   not null default '{1,2,3,4,5,6}',      -- ISO : 1 = lundi … 7 = dimanche
  open_time           time    not null default '08:00',
  close_time          time    not null default '18:00',
  close_grace_minutes int     not null default 30,                   -- un service peut finir au plus 30 min après la fermeture
  accepting           boolean not null default true,                 -- interrupteur manuel du personnel
  max_waiting         int     not null default 40,
  max_active_per_ip   int     not null default 10                    -- anti-abus (wifi partagé → pas trop bas)
);
insert into public.settings (id) values (1) on conflict do nothing;

-- Forfaits : prix et durées font foi ici (les textes descriptifs sont dans config.js)
create table if not exists public.services (
  code         text primary key,
  minutes      int          not null check (minutes > 0),
  price_sedan  numeric(8,2) not null,
  price_suv    numeric(8,2) not null,
  price_truck  numeric(8,2) not null,
  sort         int          not null default 0,
  active       boolean      not null default true
);
insert into public.services (code, minutes, price_sedan, price_suv, price_truck, sort) values
  ('express',   30,  29.99,  39.99,  49.99, 1),
  ('signature', 120, 74.99,  84.99,  94.99, 2),
  ('absolux',   300, 234.99, 254.99, 279.99, 3)
on conflict (code) do nothing;

create table if not exists public.queue (
  id            bigint generated always as identity primary key,
  service_day   date         not null,
  num           int          not null,
  token         uuid         not null default gen_random_uuid() unique,
  name          text         not null check (char_length(name) between 1 and 80),
  car           text         check (char_length(car) <= 80),
  color         text         check (char_length(color) <= 40),
  service_code  text         not null references public.services (code),
  vehicle_size  text         not null check (vehicle_size in ('sedan', 'suv', 'truck')),
  price         numeric(8,2) not null,
  phone         text         check (char_length(phone) <= 20),
  lang          text         not null default 'fr' check (lang in ('fr', 'en')),
  ip_hash       text,
  status        text         not null default 'waiting'
                             check (status in ('waiting', 'serving', 'done', 'cancelled')),
  bay           int,
  cancelled_by  text         check (cancelled_by in ('client', 'staff', 'system')),
  created_at    timestamptz  not null default now(),
  called_at     timestamptz,
  finished_at   timestamptz,
  unique (service_day, num)
);
create index if not exists queue_day_status_num on public.queue (service_day, status, num);

-- Tentatives de « Retrouver ma place » (anti-devinette)
create table if not exists public.lookup_attempts (
  ip_hash text        not null,
  at      timestamptz not null default now()
);
create index if not exists lookup_attempts_ip_at on public.lookup_attempts (ip_hash, at);

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- ---------------------------------------------------------------------
--  Sécurité des tables : RLS partout, aucun accès direct pour anon
-- ---------------------------------------------------------------------
alter table public.settings enable row level security;
alter table public.services enable row level security;
alter table public.queue    enable row level security;
alter table public.admins   enable row level security;
alter table public.lookup_attempts enable row level security;

revoke all on public.settings, public.services, public.queue, public.admins, public.lookup_attempts from anon, authenticated;
-- Lecture de la file par le personnel uniquement (sert au temps réel du tableau de bord)
grant select on public.queue to authenticated;

-- ---------------------------------------------------------------------
--  Fonctions utilitaires (internes)
-- ---------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

drop policy if exists queue_admin_read on public.queue;
create policy queue_admin_read on public.queue for select to authenticated using (public.is_admin());

create or replace function public.local_now() returns timestamp
language sql stable security definer set search_path = public as $$
  select now() at time zone (select business_tz from settings where id = 1);
$$;

create or replace function public.local_today() returns date
language sql stable security definer set search_path = public as $$
  select local_now()::date;
$$;

create or replace function public.is_open_now() returns boolean
language sql stable security definer set search_path = public as $$
  select s.accepting
     and extract(isodow from local_now())::int = any (s.open_days)
     and local_now()::time >= s.open_time
     and local_now()::time <  s.close_time
  from settings s where s.id = 1;
$$;

create or replace function public.assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'ACCES_REFUSE'; end if;
end $$;

-- Minutes avant qu'une baie se libère pour le client qui suit les clients en
-- attente de numéro < p_before_num (null = tous). Simulation baie par baie :
-- chaque voiture prend la première baie libre, pour la durée de son forfait.
create or replace function public._estimate_wait(p_day date, p_before_num int) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  v_bays int := (select bays from settings where id = 1);
  v_free numeric[] := '{}';
  r      record;
  i      int;
  best   int;
begin
  for r in
    select greatest(5, s.minutes - extract(epoch from now() - q.called_at) / 60) as rem
      from queue q join services s on s.code = q.service_code
     where q.status = 'serving'
  loop
    v_free := v_free || r.rem;
  end loop;
  while coalesce(array_length(v_free, 1), 0) < v_bays loop
    v_free := v_free || 0::numeric;
  end loop;

  for r in
    select s.minutes from queue q join services s on s.code = q.service_code
     where q.service_day = p_day and q.status = 'waiting'
       and (p_before_num is null or q.num < p_before_num)
     order by q.num
  loop
    best := 1;
    for i in 2 .. array_length(v_free, 1) loop
      if v_free[i] < v_free[best] then best := i; end if;
    end loop;
    v_free[best] := v_free[best] + r.minutes;
  end loop;

  return ceil((select min(x) from unnest(v_free) x));
end $$;

-- Le forfait peut-il être terminé à temps si on s'inscrit maintenant ?
-- Fin prévue (attente + durée) au plus close_grace_minutes après la fermeture.
create or replace function public._fits_today(p_minutes int, p_wait int) returns boolean
language sql stable security definer set search_path = public as $$
  select (local_now() + make_interval(mins => p_wait + p_minutes))
           <= (local_today() + s.close_time + make_interval(mins => s.close_grace_minutes))
  from settings s where s.id = 1;
$$;

-- Fait entrer le prochain client dans une baie libre (sans contrôle d'accès : usage interne).
create or replace function public._promote_next() returns json
language plpgsql security definer set search_path = public as $$
declare
  v_bays int := (select bays from settings where id = 1);
  v_bay  int;
  v      queue;
begin
  select min(b) into v_bay from generate_series(1, v_bays) b
   where b not in (select bay from queue where status = 'serving' and bay is not null);
  if v_bay is null then return null; end if;

  select * into v from queue
   where service_day = local_today() and status = 'waiting'
   order by num limit 1 for update;
  if not found then return null; end if;

  update queue set status = 'serving', called_at = now(), bay = v_bay where id = v.id;
  return json_build_object('num', v.num, 'name', v.name, 'bay', v_bay);
end $$;

-- ---------------------------------------------------------------------
--  RPC publiques (clients)
-- ---------------------------------------------------------------------
create or replace function public.get_queue_status() returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_wait int := _estimate_wait(local_today(), null);
  s      settings;
begin
  select * into s from settings where id = 1;
  return json_build_object(
    'serving_nums',  coalesce((select json_agg(num order by bay) from queue
                                where status = 'serving' and service_day = local_today()), '[]'::json),
    'waiting_count', (select count(*) from queue where service_day = local_today() and status = 'waiting'),
    'wait_minutes',  v_wait,
    'bays',          s.bays,
    'is_open',       is_open_now(),
    'accepting',     s.accepting,
    'open_days',     s.open_days,
    'open_time',     to_char(s.open_time,  'HH24:MI'),
    'close_time',    to_char(s.close_time, 'HH24:MI'),
    'close_grace_minutes', s.close_grace_minutes,
    'services',      coalesce((select json_agg(json_build_object(
                        'code', code, 'minutes', minutes,
                        'prices', json_build_object('sedan', price_sedan, 'suv', price_suv, 'truck', price_truck),
                        'fits_today', _fits_today(minutes, v_wait)) order by sort)
                      from services where active), '[]'::json)
  );
end $$;

create or replace function public.join_queue(
  p_name text, p_car text, p_service text, p_size text, p_phone text, p_lang text default 'fr',
  p_color text default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_name   text := btrim(coalesce(p_name, ''));
  v_car    text := nullif(btrim(coalesce(p_car, '')), '');
  v_color  text := nullif(btrim(coalesce(p_color, '')), '');
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_phone  text;
  v_ip     text;
  v_hash   text;
  v_today  date;
  v_num    int;
  v_token  uuid;
  v_price  numeric;
  v_wait   int;
  sv       services;
  s        settings;
begin
  select * into s from settings where id = 1;

  if char_length(v_name) < 2 or char_length(v_name) > 80 then raise exception 'NOM_INVALIDE'; end if;
  if v_car is null or char_length(v_car) < 2 then raise exception 'VEHICULE_REQUIS'; end if;
  if char_length(v_car) > 80 or char_length(coalesce(v_color, '')) > 40 then raise exception 'CHAMP_TROP_LONG'; end if;

  select * into sv from services where code = p_service and active;
  if not found then raise exception 'FORFAIT_INVALIDE'; end if;
  v_price := case p_size when 'sedan' then sv.price_sedan when 'suv' then sv.price_suv
                         when 'truck' then sv.price_truck end;
  if v_price is null then raise exception 'TAILLE_INVALIDE'; end if;

  if length(v_digits) = 11 and left(v_digits, 1) = '1' then v_digits := substr(v_digits, 2); end if;
  if v_digits = '' then
    raise exception 'TELEPHONE_REQUIS';      -- requis pour le texto de rappel
  elsif length(v_digits) = 10 then
    v_phone := substr(v_digits, 1, 3) || '-' || substr(v_digits, 4, 3) || '-' || substr(v_digits, 7, 4);
  else
    raise exception 'TELEPHONE_INVALIDE';
  end if;

  if not is_open_now() then raise exception 'FERME'; end if;

  -- Verrou : une seule inscription à la fois → numéros uniques et séquentiels
  perform pg_advisory_xact_lock(hashtext('queue_num'));
  v_today := local_today();

  if (select count(*) from queue where service_day = v_today and status = 'waiting') >= s.max_waiting then
    raise exception 'FILE_PLEINE';
  end if;

  v_wait := _estimate_wait(v_today, null);
  if not _fits_today(sv.minutes, v_wait) then raise exception 'TROP_TARD'; end if;

  if exists (
       select 1 from queue where service_day = v_today and phone = v_phone and status in ('waiting', 'serving')) then
    raise exception 'DEJA_INSCRIT';
  end if;

  v_ip := btrim(split_part(coalesce(
            nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1));
  if v_ip <> '' then
    v_hash := md5(v_ip);
    if (select count(*) from queue
         where service_day = v_today and ip_hash = v_hash and status in ('waiting', 'serving')) >= s.max_active_per_ip then
      raise exception 'TROP_DE_DEMANDES';
    end if;
  end if;

  select coalesce(max(num), 0) + 1 into v_num from queue where service_day = v_today;

  insert into queue (service_day, num, name, car, color, service_code, vehicle_size, price, phone, lang, ip_hash)
  values (v_today, v_num, v_name, v_car, v_color, sv.code, p_size, v_price, v_phone,
          case when p_lang = 'en' then 'en' else 'fr' end, v_hash)
  returning token into v_token;

  return json_build_object('num', v_num, 'token', v_token);
end $$;

create or replace function public.get_ticket(p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v       queue;
  v_today date := local_today();
  v_ahead int := 0;
  v_pass  int;
  v_wait  int := 0;
begin
  select * into v from queue where token = p_token;
  if not found then return null; end if;

  if v.status = 'waiting' then
    select count(*) into v_ahead from queue
     where service_day = v.service_day and status = 'waiting' and num < v.num;
    v_wait := _estimate_wait(v.service_day, v.num);
  end if;
  select count(*) into v_pass from queue
   where service_day = v.service_day and num < v.num and status in ('serving', 'done', 'cancelled');

  return json_build_object(
    'num',          v.num,
    'name',         v.name,
    'service_code', v.service_code,
    'vehicle_size', v.vehicle_size,
    'color',        v.color,
    'price',        v.price,
    'minutes',      (select minutes from services where code = v.service_code),
    'status',       v.status,
    'bay',          v.bay,
    'cancelled_by', v.cancelled_by,
    'is_today',     v.service_day = v_today,
    'serving_nums', coalesce((select json_agg(num order by bay) from queue
                               where status = 'serving' and service_day = v_today), '[]'::json),
    'ahead',        v_ahead,
    'passed',       v_pass,
    'eta_minutes',  v_wait
  );
end $$;

-- « Retrouver ma place » : téléphone (numéro de billet facultatif) → jeton du billet du jour.
-- Un téléphone n'a qu'un billet actif par jour (voir DEJA_INSCRIT), donc il suffit.
-- Renvoie null si introuvable. Limité à 10 essais par 10 minutes par connexion.
create or replace function public.find_ticket(p_phone text, p_num int default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_phone  text;
  v_ip     text;
  v_hash   text;
  v_token  uuid;
begin
  v_ip := btrim(split_part(coalesce(
            nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1));
  v_hash := md5(coalesce(nullif(v_ip, ''), 'inconnu'));
  delete from lookup_attempts where at < now() - interval '1 day';
  if (select count(*) from lookup_attempts where ip_hash = v_hash and at > now() - interval '10 minutes') >= 10 then
    raise exception 'TROP_DE_DEMANDES';
  end if;
  insert into lookup_attempts (ip_hash) values (v_hash);

  if length(v_digits) = 11 and left(v_digits, 1) = '1' then v_digits := substr(v_digits, 2); end if;
  -- Pas d'exception ici : elle annulerait l'enregistrement de la tentative ci-dessus.
  if length(v_digits) <> 10 then return null; end if;
  v_phone := substr(v_digits, 1, 3) || '-' || substr(v_digits, 4, 3) || '-' || substr(v_digits, 7, 4);

  select token into v_token from queue
   where service_day = local_today() and phone = v_phone and (p_num is null or num = p_num)
     and status in ('waiting', 'serving', 'done')
   order by (status <> 'done') desc, num desc      -- le billet actif d'abord, sinon le plus récent
   limit 1;
  return v_token;   -- null = introuvable
end $$;

create or replace function public.leave_queue(p_token uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v queue;
begin
  perform pg_advisory_xact_lock(hashtext('queue_num'));
  update queue set status = 'cancelled', cancelled_by = 'client', finished_at = now()
   where token = p_token and status in ('waiting', 'serving')
  returning * into v;
  if not found then return false; end if;
  if v.called_at is not null then perform _promote_next(); end if;   -- sa baie se libère
  return true;
end $$;

-- ---------------------------------------------------------------------
--  RPC du personnel (connexion + table admins obligatoires)
-- ---------------------------------------------------------------------
create or replace function public.get_admin_dashboard() returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := local_today();
  v_bays  int  := (select bays from settings where id = 1);
begin
  perform assert_admin();
  return json_build_object(
    'today',       v_today,
    'is_open',     is_open_now(),
    'accepting',   (select accepting from settings where id = 1),
    'bays',        v_bays,
    'wait_minutes', _estimate_wait(v_today, null),
    'serving',     coalesce((select json_agg(x order by x.bay) from (
                      select q.id, q.num, q.name, q.car, q.color, q.service_code, q.vehicle_size, q.price,
                             q.phone, q.called_at, q.bay, s.minutes
                        from queue q join services s on s.code = q.service_code
                       where q.status = 'serving') x), '[]'::json),
    'waiting',     coalesce((select json_agg(x order by x.num) from (
                      select id, num, name, car, color, service_code, vehicle_size, price, phone, created_at
                        from queue where service_day = v_today and status = 'waiting') x), '[]'::json),
    'history',     coalesce((select json_agg(x order by x.num desc) from (
                      select id, num, name, service_code, vehicle_size, price, status, cancelled_by,
                             called_at, finished_at
                        from queue where service_day = v_today and status in ('done', 'cancelled')
                       order by num desc limit 60) x), '[]'::json),
    'done_count',  (select count(*) from queue where service_day = v_today and status = 'done'),
    'revenue',     (select coalesce(sum(price), 0) from queue where service_day = v_today and status = 'done')
  );
end $$;

-- Fait entrer le prochain client dans une baie libre.
create or replace function public.call_next() returns json
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  perform pg_advisory_xact_lock(hashtext('queue_num'));
  -- Les attentes oubliées des jours précédents expirent
  update queue set status = 'cancelled', cancelled_by = 'system', finished_at = now()
   where status = 'waiting' and service_day < local_today();
  return coalesce(_promote_next(), json_build_object('num', null));
end $$;

-- Termine une voiture (libère sa baie).
create or replace function public.finish_client(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  update queue set status = 'done', finished_at = now() where id = p_id and status = 'serving';
end $$;

create or replace function public.remove_client(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v queue;
begin
  perform assert_admin();
  perform pg_advisory_xact_lock(hashtext('queue_num'));
  update queue set status = 'cancelled', cancelled_by = 'staff', finished_at = now()
   where id = p_id and status in ('waiting', 'serving')
  returning * into v;
  if found and v.called_at is not null then perform _promote_next(); end if;
end $$;

create or replace function public.set_accepting(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  update settings set accepting = p_on where id = 1;
end $$;

create or replace function public.set_bays(p_bays int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  if p_bays < 1 or p_bays > 20 then raise exception 'BAIES_INVALIDE'; end if;
  update settings set bays = p_bays where id = 1;
end $$;

-- Remise à zéro manuelle : efface la journée en cours, les numéros repartent à 1.
create or replace function public.reset_today() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  perform pg_advisory_xact_lock(hashtext('queue_num'));
  delete from queue where service_day = local_today() or status in ('waiting', 'serving');
end $$;

-- Loi 25 : on ne garde pas les renseignements personnels plus longtemps que nécessaire.
-- (Les forfaits, prix et dates restent pour les statistiques.)
create or replace function public.purge_personal_data(p_days int default 30) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update queue set name = 'Client', car = null, color = null, phone = null, ip_hash = null
   where service_day < local_today() - p_days and (phone is not null or name <> 'Client' or car is not null);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
--  Écran de la salle d'attente (tv.html) — lecture publique minimale
--  Renvoie : numéros en service (+ prénom, baie, minutes restantes) et les
--  prochains numéros (numéro + forfait + attente estimée). JAMAIS de nom
--  complet, de téléphone, de véhicule ni de prix.
-- ---------------------------------------------------------------------
create or replace function public.get_board() returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := local_today();
  s       settings;
begin
  select * into s from settings where id = 1;
  return json_build_object(
    'server_time',   now(),
    'bays',          s.bays,
    'is_open',       is_open_now(),
    'accepting',     s.accepting,
    'wait_minutes',  _estimate_wait(v_today, null),
    'waiting_count', (select count(*) from queue where service_day = v_today and status = 'waiting'),
    'serving',       coalesce((select json_agg(x order by x.bay) from (
                        select q.num, q.bay, q.service_code, sv.minutes as total_minutes,
                               left(split_part(btrim(q.name), ' ', 1), 20) as first_name,
                               greatest(0, ceil(sv.minutes - extract(epoch from now() - q.called_at) / 60))::int as minutes_left
                          from queue q join services sv on sv.code = q.service_code
                         where q.status = 'serving' and q.service_day = v_today) x), '[]'::json),
    'next',          coalesce((select json_agg(x order by x.num) from (
                        select q.num, q.service_code, _estimate_wait(v_today, q.num) as wait_minutes
                          from queue q
                         where q.service_day = v_today and q.status = 'waiting'
                         order by q.num limit 8) x), '[]'::json)
  );
end $$;

-- ---------------------------------------------------------------------
--  Droits d'exécution : tout fermer, puis ouvrir au cas par cas
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.get_queue_status()                              to anon, authenticated;
grant execute on function public.get_board()                                     to anon, authenticated;
grant execute on function public.join_queue(text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.get_ticket(uuid)                                to anon, authenticated;
grant execute on function public.leave_queue(uuid)                               to anon, authenticated;
grant execute on function public.find_ticket(text, int)                          to anon, authenticated;

grant execute on function public.is_admin()                to authenticated;   -- utilisée par la policy RLS
grant execute on function public.get_admin_dashboard()     to authenticated;
grant execute on function public.call_next()               to authenticated;
grant execute on function public.finish_client(bigint)     to authenticated;
grant execute on function public.remove_client(bigint)     to authenticated;
grant execute on function public.set_accepting(boolean)    to authenticated;
grant execute on function public.set_bays(int)             to authenticated;
grant execute on function public.reset_today()             to authenticated;

-- ---------------------------------------------------------------------
--  Temps réel pour le tableau de bord du personnel
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'queue') then
    alter publication supabase_realtime add table public.queue;
  end if;
end $$;

-- ---------------------------------------------------------------------
--  Optionnel : purge automatique quotidienne (activer l'extension pg_cron
--  dans Database › Extensions, puis exécuter) :
--
--  select cron.schedule('purge-donnees-perso', '0 8 * * *', $$select public.purge_personal_data(30)$$);
-- ---------------------------------------------------------------------
