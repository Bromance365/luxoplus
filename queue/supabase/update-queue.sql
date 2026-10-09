-- Upgrade an existing dedicated Luxoplus queue database. Apply atomically.
-- Preserves records, prices, staff accounts and current settings.
begin;
create index if not exists queue_service_code on public.queue (service_code);
alter table public.lookup_attempts add column if not exists id bigint generated always as identity;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.lookup_attempts'::regclass and contype='p') then
    alter table public.lookup_attempts add primary key (id);
  end if;
end $$;
create unique index if not exists queue_one_serving_per_bay on public.queue (service_day, bay) where status = 'serving';
create unique index if not exists queue_one_active_per_phone on public.queue (service_day, phone) where status in ('waiting', 'serving');

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
     where q.status = 'serving' and q.service_day = p_day
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

create or replace function public._promote_next() returns json
language plpgsql security definer set search_path = public as $$
declare
  v_bays int := (select bays from settings where id = 1);
  v_bay  int;
  v      queue;
begin
  select min(b) into v_bay from generate_series(1, v_bays) b
   where b not in (select bay from queue where status = 'serving' and service_day = local_today() and bay is not null);
  if v_bay is null then return null; end if;

  select * into v from queue
   where service_day = local_today() and status = 'waiting'
   order by num limit 1 for update;
  if not found then return null; end if;

  update queue set status = 'serving', called_at = now(), bay = v_bay where id = v.id;
  return json_build_object('num', v.num, 'name', v.name, 'bay', v_bay);
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
  -- Recheck after the lock: staff may have paused while this request waited.
  select * into s from settings where id = 1;
  if not is_open_now() then raise exception 'FERME'; end if;
  update queue set status = 'cancelled', cancelled_by = 'system', finished_at = now()
   where status in ('waiting', 'serving') and service_day < v_today;

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
  -- Serialize the budget check so parallel requests cannot bypass the limit.
  perform pg_advisory_xact_lock(hashtext('lookup:' || v_hash));
  delete from lookup_attempts where at < now() - interval '1 day';
  if (select count(*) from lookup_attempts where ip_hash = v_hash and at > now() - interval '10 minutes') >= 10 then
    raise exception 'TROP_DE_DEMANDES';
  end if;
  insert into lookup_attempts (ip_hash) values (v_hash);

  if length(v_digits) = 11 and left(v_digits, 1) = '1' then v_digits := substr(v_digits, 2); end if;
  -- Pas d'exception ici : elle annulerait l'enregistrement de la tentative ci-dessus.
  if length(v_digits) <> 10 or p_num is null or p_num < 1 then return null; end if;
  v_phone := substr(v_digits, 1, 3) || '-' || substr(v_digits, 4, 3) || '-' || substr(v_digits, 7, 4);

  select token into v_token from queue
   where service_day = local_today() and phone = v_phone and num = p_num
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
   where token = p_token and status = 'waiting'
  returning * into v;
  if not found then return false; end if;
  return true;
end $$;

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
                       where q.status = 'serving' and q.service_day = v_today) x), '[]'::json),
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

create or replace function public.call_next() returns json
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  perform pg_advisory_xact_lock(hashtext('queue_num'));
  -- Les attentes oubliées des jours précédents expirent
  update queue set status = 'cancelled', cancelled_by = 'system', finished_at = now()
   where status in ('waiting', 'serving') and service_day < local_today();
  return coalesce(_promote_next(), json_build_object('num', null));
end $$;

create or replace function public.finish_client(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  perform pg_advisory_xact_lock(hashtext('queue_num'));
  update queue set status = 'done', finished_at = now() where id = p_id and status = 'serving';
end $$;

create or replace function public.set_accepting(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  if p_on is null then raise exception 'PARAMETRE_INVALIDE'; end if;
  perform pg_advisory_xact_lock(hashtext('queue_num'));
  update settings set accepting = p_on where id = 1;
end $$;

create or replace function public.set_bays(p_bays int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  if p_bays is null or p_bays < 1 or p_bays > 20 then raise exception 'BAIES_INVALIDE'; end if;
  perform pg_advisory_xact_lock(hashtext('queue_num'));
  if exists (select 1 from queue where status = 'serving' and service_day = local_today() and bay > p_bays) then
    raise exception 'BAIE_OCCUPEE';
  end if;
  update settings set bays = p_bays where id = 1;
end $$;

create or replace function public.reset_today() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  perform pg_advisory_xact_lock(hashtext('queue_num'));
  update queue set status = 'cancelled', cancelled_by = 'staff', finished_at = now()
   where service_day = local_today() and status in ('waiting', 'serving');
end $$;

create or replace function public.purge_personal_data(p_days int default 30) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_days is null or p_days < 1 then raise exception 'RETENTION_INVALIDE'; end if;
  delete from lookup_attempts where at < now() - interval '1 day';
  update queue set name = 'Client', car = null, color = null, phone = null, ip_hash = null
   where service_day < local_today() - p_days and (phone is not null or name <> 'Client' or car is not null or color is not null or ip_hash is not null);
  get diagnostics n = row_count;
  return n;
end $$;

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
                               ''::text as first_name, -- Public screens identify tickets by number only.
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

revoke execute on function public._estimate_wait(date, int), public._promote_next(), public.purge_personal_data(int) from public, anon, authenticated;
revoke execute on function public.get_board() from public;
grant execute on function public.get_board() to anon, authenticated;
commit;
