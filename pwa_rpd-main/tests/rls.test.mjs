import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('manual remediation is idempotent and enforces RLS despite legacy permissive policies', async () => {
  // In-memory PostgreSQL only. No Supabase client, network, URL or credentials.
  const db = new PGlite();
  const admin = '00000000-0000-0000-0000-000000000001';
  const ordinary = '00000000-0000-0000-0000-000000000002';
  const revoked = '00000000-0000-0000-0000-000000000003';
  const tables = ['poster_slides', 'music_list', 'site_settings', 'center_poster', 'information', 'members', 'podcasts', 'program_banners'];
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      grant usage on schema public, auth, storage to anon, authenticated;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant execute on function auth.uid() to anon, authenticated;
      create table public.admin_users (id int primary key, user_id uuid unique not null, is_active boolean not null);
      insert into public.admin_users values (1, '${admin}', true), (2, '${revoked}', false);
      alter table public.admin_users enable row level security;
      create policy legacy_admin_all on public.admin_users for all to anon, authenticated using (true) with check (true);
      create table storage.objects (id int primary key, bucket_id text not null, name text);
      alter table storage.objects enable row level security;
      create policy legacy_storage_all on storage.objects for all to anon, authenticated using (true) with check (true);
      grant all on public.admin_users, storage.objects to anon, authenticated;
      grant all on public.admin_users to public;
    `);
    for (const table of tables) {
      await db.exec(`
        create table public.${table} (id int primary key, title text, is_active boolean not null default true);
        insert into public.${table} values (1, 'published', true), (2, 'draft', false);
        alter table public.${table} enable row level security;
        create policy legacy_public_all on public.${table} for all to anon, authenticated using (true) with check (true);
        grant all on public.${table} to anon, authenticated;
        grant all on public.${table} to public;
      `);
    }
    const migration = await readFile(new URL('../supabase/phase1_security_remediation.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration);

    async function as(role, uid, operation) {
      await db.exec(`set role ${role}; set request.jwt.claim.sub = '${uid}';`);
      try { return await operation(); } finally { await db.exec('reset role;'); }
    }

    for (const [role, uid] of [['anon', ''], ['authenticated', ordinary], ['authenticated', revoked]]) {
      await as(role, uid, async () => {
        for (const table of tables) {
          assert.equal((await db.query(`select * from public.${table}`)).rows.length, 1, `${role}/${uid}: published SELECT only`);
          await assert.rejects(db.query(`insert into public.${table} values (9, 'intrusion', true)`));
          if (role === 'anon') {
            await assert.rejects(db.query(`update public.${table} set title = 'intrusion' where id = 1`));
            await assert.rejects(db.query(`delete from public.${table} where id = 1`));
          } else {
            assert.equal((await db.query(`update public.${table} set title = 'intrusion' where id = 1 returning id`)).rows.length, 0);
            assert.equal((await db.query(`delete from public.${table} where id = 1 returning id`)).rows.length, 0);
          }
        }
        await assert.rejects(db.query(`insert into public.admin_users values (9, '${ordinary}', true)`));
        await assert.rejects(db.query('truncate public.music_list'));
        await assert.rejects(db.query(`insert into storage.objects values (9, 'cms-images', 'intrusion')`));
      });
    }

    await as('authenticated', admin, async () => {
      assert.equal((await db.query('select * from public.admin_users')).rows.length, 1, 'admin sees only own membership');
      for (const table of tables) {
        assert.equal((await db.query(`select * from public.${table}`)).rows.length, 2, 'admin sees drafts');
        await db.query(`insert into public.${table} values (9, 'admin write', true)`);
        assert.equal((await db.query(`update public.${table} set title = 'updated' where id = 9 returning id`)).rows.length, 1);
        assert.equal((await db.query(`delete from public.${table} where id = 9 returning id`)).rows.length, 1);
      }
      await db.query("insert into storage.objects values (1, 'cms-images', 'admin-upload')");
      await assert.rejects(db.query('update public.admin_users set is_active = true where id = 2'));
    });

    await as('authenticated', ordinary, async () => {
      assert.equal((await db.query('select * from public.admin_users')).rows.length, 0);
      assert.equal((await db.query("update storage.objects set name = 'intrusion' where id = 1 returning id")).rows.length, 0);
      assert.equal((await db.query('delete from storage.objects where id = 1 returning id')).rows.length, 0);
      await db.query("insert into storage.objects values (2, 'other-bucket', 'unchanged-legacy-permission')");
      await assert.rejects(db.query("update storage.objects set bucket_id = 'cms-images' where id = 2"));
    });
    await as('authenticated', admin, async () => {
      assert.equal((await db.query("update storage.objects set name = 'updated' where id = 1 returning id")).rows.length, 1);
      assert.equal((await db.query('delete from storage.objects where id = 1 returning id')).rows.length, 1);
    });
  } finally { await db.close(); }
});
