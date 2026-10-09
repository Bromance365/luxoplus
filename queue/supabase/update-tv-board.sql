-- À exécuter UNE fois dans Supabase › SQL Editor si la base existe déjà (ajoute l'écran TV).
-- Les nouvelles installations l'ont déjà dans schema.sql.

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

revoke execute on function public.get_board() from public, anon, authenticated;
grant  execute on function public.get_board() to anon, authenticated;
