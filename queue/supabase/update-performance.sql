-- Non-destructive improvements identified by hosted Supabase advisors.
begin;
create index if not exists queue_service_code on public.queue (service_code);
alter table public.lookup_attempts add column if not exists id bigint generated always as identity;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.lookup_attempts'::regclass and contype='p') then
    alter table public.lookup_attempts add primary key (id);
  end if;
end $$;
commit;
