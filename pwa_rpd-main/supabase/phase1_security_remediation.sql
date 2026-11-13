-- PREPARED FOR MANUAL REVIEW ONLY. This file is never run by build or tests
-- against a live service. Read PHASE1-MANUAL-ACTIONS.txt and export the existing
-- policies, grants and schema before applying in the Supabase SQL Editor.
-- Requires public.admin_users from the existing CMS setup.
begin;

do $$
begin
  if to_regclass('public.admin_users') is null then
    raise exception 'admin_users is missing: review and complete the CMS schema first';
  end if;
end $$;

create schema if not exists rpd_private;
revoke all on schema rpd_private from public;
grant usage on schema rpd_private to anon, authenticated;

-- No user-supplied identity; JWT identity is checked against the allowlist.
-- The trusted SQL administrator owns this function; search_path is fixed.
create or replace function rpd_private.is_cms_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users a
    where a.user_id = (select auth.uid()) and a.is_active = true
  );
$$;
revoke all on function rpd_private.is_cms_admin() from public;
grant execute on function rpd_private.is_cms_admin() to anon, authenticated;

alter table public.admin_users enable row level security;
revoke all on public.admin_users from public;
revoke all on public.admin_users from anon;
revoke insert, update, delete, truncate, references, trigger on public.admin_users from authenticated;
grant select on public.admin_users to authenticated;

drop policy if exists phase1_admin_select_own on public.admin_users;
create policy phase1_admin_select_own on public.admin_users
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists phase1_admin_read_guard on public.admin_users;
create policy phase1_admin_read_guard on public.admin_users as restrictive
  for select to authenticated using (user_id = (select auth.uid()));

-- Guards also defeat old permissive policies or privileges inherited via PUBLIC.
drop policy if exists phase1_admin_insert_guard on public.admin_users;
create policy phase1_admin_insert_guard on public.admin_users as restrictive
  for insert to anon, authenticated with check (false);
drop policy if exists phase1_admin_update_guard on public.admin_users;
create policy phase1_admin_update_guard on public.admin_users as restrictive
  for update to anon, authenticated using (false) with check (false);
drop policy if exists phase1_admin_delete_guard on public.admin_users;
create policy phase1_admin_delete_guard on public.admin_users as restrictive
  for delete to anon, authenticated using (false);

do $$
declare
  t text;
  admin_check text := '(select rpd_private.is_cms_admin())';
begin
  foreach t in array array['poster_slides', 'music_list', 'site_settings',
    'center_poster', 'information', 'members', 'podcasts', 'program_banners']
  loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'Table % absent; no data/table is created or removed', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from public', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon', t);
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    if t = 'music_list' then
      execute 'drop policy if exists music_list_authenticated_write on public.music_list';
    end if;

    execute format('drop policy if exists phase1_cms_admin_access on public.%I', t);
    execute format('create policy phase1_cms_admin_access on public.%I for all to authenticated using (%s) with check (%s)', t, admin_check, admin_check);

    execute format('drop policy if exists phase1_cms_insert_guard on public.%I', t);
    execute format('create policy phase1_cms_insert_guard on public.%I as restrictive for insert to anon, authenticated with check (%s)', t, admin_check);
    execute format('drop policy if exists phase1_cms_update_guard on public.%I', t);
    execute format('create policy phase1_cms_update_guard on public.%I as restrictive for update to anon, authenticated using (%s) with check (%s)', t, admin_check, admin_check);
    execute format('drop policy if exists phase1_cms_delete_guard on public.%I', t);
    execute format('create policy phase1_cms_delete_guard on public.%I as restrictive for delete to anon, authenticated using (%s)', t, admin_check);

    -- Retain existing public SELECT policy, but never expose inactive content
    -- through an old permissive ALL policy. Admins can still see/edit drafts.
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'is_active') then
      execute format('drop policy if exists phase1_cms_read_guard on public.%I', t);
      execute format('create policy phase1_cms_read_guard on public.%I as restrictive for select to anon, authenticated using (is_active = true or %s)', t, admin_check);
    end if;
  end loop;
end $$;

-- cms-images only: other buckets and their permissions are outside this script.
-- Public bucket downloads remain public. No objects or bucket settings change.
alter table storage.objects enable row level security;
drop policy if exists phase1_storage_admin_access on storage.objects;
create policy phase1_storage_admin_access on storage.objects
  for all to authenticated
  using (bucket_id = 'cms-images' and (select rpd_private.is_cms_admin()))
  with check (bucket_id = 'cms-images' and (select rpd_private.is_cms_admin()));

drop policy if exists phase1_storage_insert_guard on storage.objects;
create policy phase1_storage_insert_guard on storage.objects as restrictive
  for insert to anon, authenticated
  with check (bucket_id <> 'cms-images' or (select rpd_private.is_cms_admin()));
drop policy if exists phase1_storage_update_guard on storage.objects;
create policy phase1_storage_update_guard on storage.objects as restrictive
  for update to anon, authenticated
  using (bucket_id <> 'cms-images' or (select rpd_private.is_cms_admin()))
  with check (bucket_id <> 'cms-images' or (select rpd_private.is_cms_admin()));
drop policy if exists phase1_storage_delete_guard on storage.objects;
create policy phase1_storage_delete_guard on storage.objects as restrictive
  for delete to anon, authenticated
  using (bucket_id <> 'cms-images' or (select rpd_private.is_cms_admin()));

commit;
