import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { createApp, installCacheBackend, withRequest } from './helpers/app-loader.mjs';
const require = createRequire(import.meta.url);
const fixtures = require('./fixtures/upstream.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixtureApp() {
  const counts = {};
  let invalid = false;
  const app = createApp(async (input, init) => {
    assert.ok(init.signal);
    const url = new URL(input);
    const name = url.hostname === 'docs.google.com' ? 'schedule'
      : url.hostname === 'cdn.voscast.com' ? 'now-playing'
      : url.pathname === '/' ? 'homepage'
      : url.pathname === '/about-us/' ? 'about' : 'podcast';
    counts[name] = (counts[name] || 0) + 1;
    return new Response(invalid ? '<html>Upstream unavailable</html>'
      : name === 'now-playing' ? "document.write('Fixture title');" : fixtures[name]);
  });
  return { ...app, counts, invalidate() { invalid = true; } };
}

test('mock request-count comparison: uncached baseline versus shared Data Cache', async () => {
  async function replay(enabled) {
    installCacheBackend({ enabled });
    const app = fixtureApp();
    for (let pass = 0; pass < 2; pass++) {
      for (const name of ['homepage', 'program', 'about', 'podcast', 'schedule', 'now-playing']) {
        assert.equal((await app.route(name).GET()).status, 200);
      }
    }
    return app.counts;
  }
  const before = await replay(false);
  const after = await replay(true);
  assert.deepEqual(before, { homepage: 4, about: 2, podcast: 2, schedule: 2, 'now-playing': 4 });
  assert.deepEqual(after, { homepage: 1, about: 1, podcast: 1, schedule: 1, 'now-playing': 2 });
  const reportDir = new URL('../reports/phase3a/', import.meta.url);
  await mkdir(reportDir, { recursive: true });
  await writeFile(new URL('request-counts.json', reportDir), JSON.stringify({
    scenario: 'Two sequential passes over all six APIs within TTL; mocked upstreams',
    baselineMethod: 'Replay with cache backend disabled to reproduce previous uncached request behavior',
    cacheMethod: 'Installed Next unstable_cache with a deterministic mock storage backend',
    before, after, beforeTotal: 14, afterTotal: 6,
    programInitialScheduleRequests: { before: 2, after: 1, afterVerifiedBy: 'Production browser smoke test' },
  }, null, 2) + '\n');
});

for (const [name, ttl, calls] of [
  ['homepage', 300, 1], ['about', 900, 1], ['podcast', 900, 1],
  ['schedule', 60, 1], ['now-playing', 15, 2],
]) {
  test(`${name}: real Next cache cold/warm and ${ttl}s revalidation boundary`, async () => {
    const backend = installCacheBackend();
    const app = fixtureApp();
    const route = app.route(name);
    const first = await route.GET();
    assert.equal(first.status, 200);
    const original = await first.json();
    assert.equal(app.counts[name], calls);
    backend.advance(ttl * 1000 - 1);
    assert.deepEqual(await (await route.GET()).json(), original);
    assert.equal(app.counts[name], calls);
    backend.advance(2);
    assert.equal((await route.GET()).status, 200);
    assert.equal(app.counts[name], calls * 2);
    assert.equal([...backend.entries.values()][0].value.revalidate, ttl);
  });
}

test('homepage/program share one upstream cache across route module instances', async () => {
  installCacheBackend();
  const app = fixtureApp();
  const homepage = await (await app.route('homepage').GET()).json();
  const program = await (await app.route('program').GET()).json();
  assert.equal(app.counts.homepage, 1);
  assert.equal(program.what_is_on_tagline, homepage.settings.what_is_on_tagline);
  assert.equal(program.regularBanners[0].image_url, homepage.banners[0].image_url);
  // A fresh module graph, like a second server instance, uses the same backend.
  const second = createApp(async () => { throw new Error('Cache was not shared'); });
  assert.equal((await second.route('program').GET()).status, 200);
});

test('simultaneous cold homepage/program calls coalesce upstream work', async () => {
  installCacheBackend();
  const app = fixtureApp();
  const [home, program] = await Promise.all([app.route('homepage').GET(), app.route('program').GET()]);
  assert.equal(home.status, 200);
  assert.equal(program.status, 200);
  assert.equal(app.counts.homepage, 1);
});

test('App Router stale revalidation retains validated data when upstream becomes invalid', async t => {
  t.mock.method(console, 'error', () => {});
  const backend = installCacheBackend();
  const app = fixtureApp();
  const route = app.route('homepage');
  const original = await (await withRequest(() => route.GET())).json();
  backend.advance(300001);
  app.invalidate();
  const stale = await withRequest(() => route.GET());
  assert.equal(stale.status, 200);
  assert.deepEqual(await stale.json(), original);
  assert.equal(app.counts.homepage, 2);
  assert.equal(backend.entries.size, 1);
  assert.deepEqual(await (await withRequest(() => route.GET())).json(), original);
  assert.equal(app.counts.homepage, 3); // failed refresh is retried, never cached
});

test('success response field names remain compatible across all six routes', async () => {
  installCacheBackend();
  const app = fixtureApp();
  for (const [name, keys] of Object.entries({
    homepage: ['settings', 'featuredMember', 'musicList', 'banners'],
    program: ['what_is_on_tagline', 'what_is_on_date', 'regularBanners', 'specialBanners'],
    about: ['members', 'aboutBackgrounds'], 'now-playing': ['displayTitle'],
  })) assert.deepEqual(Object.keys(await (await app.route(name).GET()).json()), keys);
  const [podcast] = await (await app.route('podcast').GET()).json();
  assert.deepEqual(Object.keys(podcast), ['id', 'title', 'subtitle', 'audio_url', 'category', 'duration', 'image_url', 'created_at']);
  assert.ok(Array.isArray((await (await app.route('schedule').GET()).json())[0]));
});

test('a stalled upstream is aborted and cannot populate the cache', async () => {
  const backend = installCacheBackend();
  const app = createApp((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason));
  }), {
    AbortSignal: { timeout() { const c = new AbortController(); setImmediate(() => c.abort()); return c.signal; } },
  });
  assert.equal((await app.route('schedule').GET()).status, 500);
  assert.equal(backend.entries.size, 0);
});

test('invalid upstream responses never become successful cached empty content', async () => {
  for (const name of ['homepage', 'about', 'podcast', 'schedule', 'now-playing']) {
    const backend = installCacheBackend();
    const app = fixtureApp();
    app.invalidate();
    for (let i = 0; i < 2; i++) {
      const result = await app.route(name).GET();
      assert.equal(result.status, name === 'now-playing' ? 200 : 500);
    }
    assert.equal(backend.entries.size, 0);
    assert.equal(app.counts[name], name === 'now-playing' ? 4 : 2);
  }
});

test('HTTP failures are generic, uncached, and source requests have bounded timeouts', async () => {
  installCacheBackend();
  const deadlines = [];
  const app = createApp(async () => new Response('private upstream message', { status: 503 }), {
    AbortSignal: { timeout(ms) { deadlines.push(ms); return AbortSignal.timeout(ms); } },
  });
  const response = await app.route('homepage').GET();
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'Failed to retrieve homepage data');
  await app.route('now-playing').GET();
  // Phase 3B permits one bounded retry inside the original total timeout budget.
  assert.equal(deadlines.length, 6);
  assert.ok(deadlines.slice(0, 2).every(ms => ms > 0 && ms <= 8000));
  assert.ok(deadlines.slice(2).every(ms => ms > 0 && ms <= 3000));
});

test('polling pauses hidden, resumes once, aborts pending work and cleans up', async () => {
  const document = new EventTarget();
  document.hidden = false;
  let requests = 0;
  let pendingSignal;
  let resolvePending;
  const timers = new Map();
  let timerId = 0;
  const titles = [];
  const app = createApp(async (_url, { signal }) => {
    requests++;
    pendingSignal = signal;
    if (requests === 1) return new Response('{"displayTitle":"First"}');
    return new Promise(resolve => { resolvePending = resolve; });
  }, {
    document,
    setTimeout(fn, delay) {
      assert.ok([5000, 15000, 60000].includes(delay));
      if (delay === 15000) timers.set(++timerId, fn);
      return delay === 15000 ? timerId : 'deadline';
    },
    clearTimeout(id) { timers.delete(id); },
  });
  const stop = app.load('src/lib/now-playing-polling').startNowPlayingPolling(title => titles.push(title));
  await tick();
  assert.deepEqual(titles, ['First']);
  assert.equal(timers.size, 1);
  document.hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(timers.size, 0);
  assert.equal(requests, 1);
  document.hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  await tick();
  assert.equal(requests, 2);
  assert.equal(timers.size, 0); // no loop while request is pending
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(requests, 2); // duplicate visible notifications do not restart work
  stop();
  assert.ok(pendingSignal.aborted);
  resolvePending(new Response('{"displayTitle":"Late"}'));
  await tick();
  assert.deepEqual(titles, ['First']);
  assert.equal(timers.size, 0);
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(requests, 2);
});

test('an initially hidden tab does not fetch; interval is configurable', async () => {
  const document = new EventTarget();
  document.hidden = true;
  let requests = 0;
  const app = createApp(async () => { requests++; return new Response('{"displayTitle":"Title"}'); }, {
    document, setTimeout(_fn, delay) { assert.ok([5000, 25000, 60000].includes(delay)); return 1; }, clearTimeout() {},
  });
  const stop = app.load('src/lib/now-playing-polling').startNowPlayingPolling(() => {}, 25000);
  assert.equal(requests, 0);
  document.hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  await tick();
  assert.equal(requests, 1);
  stop();
});
