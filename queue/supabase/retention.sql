-- Install on the approved dedicated Luxoplus Supabase project after schema.sql.
-- This job anonymizes personal details, not service history.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('luxoplus-personal-data-retention', '0 8 * * *',
  $job$select public.purge_personal_data(30);$job$);
-- 08:00 UTC each day. Verify job_run_details after first run.
select jobid, jobname, schedule, active from cron.job
 where jobname = 'luxoplus-personal-data-retention';
