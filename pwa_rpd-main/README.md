# Radio PPI Dunia PWA

Next.js app for the official RPD website. WordPress is the chosen content source.
The existing Supabase admin CMS and public Storage assets are retained in Phase 1.

## PWA release changes

See `docs/release-pwa.md` for background audio, update behavior, verification,
and the remaining Vercel/Supabase dashboard actions. Production admin routes are
closed unless `RPD_ADMIN_ENABLED=true`; enable only after live RLS verification.

## Local setup

Use a current patched **Node.js 22.x** release and **npm 10 or 11**. The lockfile
was produced with npm 10.9.2. `package-lock.json` is the only active lockfile.
The former Bun lock resolved different versions; the previous Orchids Bun startup
command was switched to npm. Its original hash and usage are recorded in
`reports/phase1/baseline.json`. Do not recreate an independent Bun lock.

If local configuration does not exist, create it from `.env.example` and supply
only the public Supabase URL and anon/publishable key needed by the retained CMS.
Do not overwrite an existing `.env.local`. A service-role key is NOT required by
this application. All secret-bearing local environment files are ignored by Git.
The optional `VOSCAST_STATS_KEY` is a server-only metadata display identifier.
The unused WordPress helper expects `WP_BASE_URL`; `NEXT_PUBLIC_WP_API_URL` is not
connected to the current scraping routes. No WordPress architecture was changed.

```sh
npm ci
npm run dev
```

## Validation

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm audit
npm run audit:prod
npm run check:secrets
npm run test:smoke
```

`npm run build` checks environment configuration and ESLint first. Next.js then
validates TypeScript during the build; no error bypasses are enabled.
`npm run verify` executes every check and writes machine-readable results under
`reports/phase1`. It returns a non-zero exit code if ANY check fails, including the
full dependency audit. Known development audit findings are not hidden or waived.
Run `npm ci` before verification when checking reproducibility.

Smoke tests start a local production server with synthetic upstream fixtures.
They block live Auth/database requests and substitute all external browser
resources. Browser interactions use the matching Playwright Chromium. Install it once with
`npx playwright install chromium`. `RPD_TEST_BROWSER_CHANNEL` can select another
installed channel; Chromium is the verified default.
No live service is used for stress tests. Real radio playback, real Chatango,
external asset availability, iOS/Android devices and live admin CRUD still need
separate manual verification. Service worker execution is blocked in smoke tests;
manifest, icons and worker file availability are checked without changing them.

SQL tests run the proposed RLS remediation twice in an isolated in-memory PGlite
PostgreSQL instance. They never connect to Supabase or execute a live migration.

## Security operations

Read `supabase/PHASE1-MANUAL-ACTIONS.txt` before any administrator action.
`supabase/phase1_security_remediation.sql` is a prepared, transactional manual
script; it is not automatically applied. `phase1_security_verification.sql`
contains read-only catalog checks. Keep a policy/grant/schema export for rollback.
The handed-over service-role key needs provider-side rotation by an administrator.
Do not run the CLBK seed script as a security fix: it replaces existing chart rows.

Next.js and its lint config are aligned at 16.4.2. ESLint is pinned to the latest
compatible 9.39.5 because current upstream React/import/a11y plugins do not declare
ESLint 10 support. The resulting ESLint EOL warning is an unresolved tooling risk.
There is also an unpatched development-only `braces` advisory through Next's lint
plugin. See the full audit report; downgrading Next's lint config is not a safe fix.

Native image previews/branding are intentionally retained in three existing files
with documented, file-local performance-rule exceptions. React correctness and
other lint checks remain enabled. Public Supabase images have not been migrated.

Phase 1 does not install rate limiting, redesign caching/PWA, decommission admin,
change streaming providers, migrate assets or deploy to Vercel. A passing build
is not a production-readiness certificate.
