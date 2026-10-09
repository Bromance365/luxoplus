-- Read-only installation checks; run as project administrator.
select tablename, rowsecurity from pg_tables
 where schemaname='public' and tablename in ('queue','settings','services','admins','lookup_attempts');
select t as table_name,
  has_table_privilege('anon', 'public.' || t, 'SELECT') as anonymous_direct_read,
  has_table_privilege('authenticated', 'public.' || t, 'INSERT,UPDATE,DELETE') as authenticated_direct_write
 from unnest(array['queue','settings','services','admins','lookup_attempts']) t;
select f as function_name, has_function_privilege('anon', f, 'EXECUTE') as anonymous_execute
 from unnest(array['public.get_board()','public.get_queue_status()',
  'public._promote_next()','public.purge_personal_data(integer)',
  'public.call_next()','public.reset_today()']) f;
select policyname, roles, cmd, qual from pg_policies where schemaname='public';
select public.get_board(); -- first_name must be an empty string on every serving ticket.
select count(*) as authorized_staff_count from public.admins;
-- After retention.sql, verify cron.job and cron.job_run_details in Supabase.
-- No customer data, production test tickets or password changes are made by this script.
