-- READ-ONLY catalog inspection for an administrator. No credentials/user rows.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where (schemaname = 'public' and tablename in (
  'admin_users', 'poster_slides', 'music_list', 'site_settings', 'center_poster',
  'information', 'members', 'podcasts', 'program_banners'
)) or (schemaname = 'storage' and tablename = 'objects')
order by schemaname, tablename, policyname;

select n.nspname as schema_name, c.relname as table_name, c.relrowsecurity,
       c.relforcerowsecurity, pg_get_userbyid(c.relowner) as owner
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in (
  'admin_users', 'poster_slides', 'music_list', 'site_settings', 'center_poster',
  'information', 'members', 'podcasts', 'program_banners'
);

select table_schema, table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')
order by table_name, grantee, privilege_type;

select n.nspname, p.proname, p.prosecdef as security_definer, p.proconfig,
       pg_get_userbyid(p.proowner) as owner
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'rpd_private' and p.proname = 'is_cms_admin';
