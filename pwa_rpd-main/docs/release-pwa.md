# PWA release handoff

Build uses the supported Next.js Webpack compiler (`npm run build`); Turbopack
failed to start its CSS worker on this Windows/Node 26 host. Deployment remains
pinned to Node 22.x.

Code changes: network-only navigation with offline fallback, removal of old RPD
caches, no automatic page reload during listening, one persistent HTML audio
element for radio/podcasts, Media Session controls and consistent Apple icon.
The new worker replaces v1 without reloading an open page. Existing v1 clients
may need one manual reload/close and reopen to receive the new React UI.

Audio starts from a user gesture. It persists across Next.js navigation and is
not paused when the document is hidden. Lock-screen controls are progressive
enhancement; OS/browser power management, calls, connection loss and force-closing
the app can interrupt playback. This is streaming, not offline podcast download.
Backup VOSCast iframe playback has provider-controlled background behavior.

## Required dashboard actions (not performed)

1. Deploy a Preview with Node 22.x and the public Supabase variables from
   `.env.example`. Production CMS routes default to HTTP 503 until
   `RPD_ADMIN_ENABLED=true` is explicitly configured. This closes the UI only;
   it does NOT protect direct Supabase access or replace RLS.
2. Export live Supabase grants/policies/schema. Review and apply
   `supabase/phase1_security_remediation.sql` in staging; run
   `phase1_security_verification.sql`. Test signed-out, ordinary, active-admin
   and revoked-admin access, including Storage writes. Only after verification,
   apply to production and enable the CMS. See PHASE1-MANUAL-ACTIONS.txt for
   rollback. Do not run the CLBK seed file: it replaces chart data.
3. Rotate the previously handed-over Supabase service-role key in the provider
   dashboard after checking other consumers. This app does not need that key;
   do not add it to Vercel. This action needs the account owner.
4. Activate and verify the Vercel rate-limit policy using
   `config/vercel-firewall-policy.json` and `docs/phase3b-operations.txt`.
   The JSON is a handoff, not an automatically applied Vercel configuration.
   Review the 60/min shared-IP threshold and existing rule slot before publishing.
   Do not enable paid usage/upgrade a plan without the owner's decision.

## Device acceptance before public release

- Install Preview on Android Chrome and iPhone Safari; confirm RPD home icon.
- Start a podcast, navigate to Program, switch apps and lock screen for 10 minutes.
  Confirm continued audio and lock-screen play/pause/seek. Pause/resume preserves position.
- Switch podcast to radio and back; only one source should play. Test headphones,
  incoming call and Wi-Fi/mobile reconnection. Retry failed playback using Play.
- Deploy an update while listening: no forced reload/audio interruption; after
  reload confirm updated content. Disconnect internet and check offline message.
- Confirm production admin returns 503 with the flag unset; after verified RLS,
  enable explicitly and verify admin access without granting ordinary users writes.

No dashboard state, production database policy, physical-device playback or paid
service activation is certified by local tests.
