import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createApp, installCacheBackend, withRequest } from './helpers/app-loader.mjs';
import { mockFirewall } from './helpers/mock-vercel-firewall.mjs';

const fixtures = createRequire(import.meta.url)('./fixtures/upstream.cjs');
const policy = JSON.parse(readFileSync(new URL('../config/vercel-firewall-policy.json', import.meta.url)));
const tick = () => new Promise(resolve => setImmediate(resolve));
const request = (path = '/api/now-playing') => new Request('https://rpd.test' + path);
const good = name => new Response(name === 'now-playing' ? "document.write('Fixture title');" : fixtures[name]);
const quietNext = t => t.mock.method(console, 'error', () => {});

test('WAF policy model permits 60 reads, then returns mock 429/Retry-After and resets', () => {
  let now = 0;
  const firewall = mockFirewall(policy, () => now);
  for (let i = 0; i < 60; i++) assert.equal(firewall(request(), { ip: '192.0.2.1' }), null);
  const blocked = firewall(request('/api/homepage?t=123'), { ip: '192.0.2.1' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '60');
  now = 59001;
  assert.equal(firewall(request(), { ip: '192.0.2.1' }).headers.get('retry-after'), '1');
  now = 60000;
  assert.equal(firewall(request(), { ip: '192.0.2.1' }), null);
  assert.equal(policy.status, 'NOT_APPLIED_DASHBOARD_CONFIGURATION_REQUIRED');
});

test('Hobby policy shares IP allowance across users, paths, and simulated instances; regions are separate', () => {
  const sharedFirewall = mockFirewall(policy, () => 0);
  const instanceA = (req, ip, region) => sharedFirewall(req, { ip, region });
  const instanceB = (req, ip, region) => sharedFirewall(req, { ip, region });
  for (let i = 0; i < 30; i++) {
    assert.equal(instanceA(request('/api/now-playing'), '192.0.2.1', 'region-a'), null);
    assert.equal(instanceB(request('/program'), '192.0.2.1', 'region-a'), null);
  }
  assert.equal(instanceB(request('/api/schedule'), '192.0.2.1', 'region-a').status, 429);
  assert.equal(instanceA(request(), '192.0.2.2', 'region-a'), null);
  assert.equal(instanceA(request(), '192.0.2.1', 'region-b'), null);
});

test('WAF policy covers public HTML/read APIs and excludes audio, admin and assets', () => {
  for (const path of ['/', '/about', '/program', '/podcast', '/api/homepage', '/api/program', '/api/about', '/api/podcast', '/api/schedule', '/api/now-playing/']) {
    const firewall = mockFirewall(policy, () => 0);
    for (let i = 0; i < 60; i++) firewall(request(path), { ip: '192.0.2.1' });
    assert.equal(firewall(request(path), { ip: '192.0.2.1' }).status, 429, path);
  }
  const firewall = mockFirewall(policy, () => 0);
  for (const path of ['/api/stream', '/api/stream?x=1', '/admin/login', '/_next/static/main.js', '/sw.js', '/manifest.json', '/faq']) {
    for (let i = 0; i < 80; i++) assert.equal(firewall(request(path), { ip: '192.0.2.1' }), null, path);
  }
});

test('80 concurrent cold homepage/program reads perform one source load in an instance', async () => {
  installCacheBackend();
  let calls = 0;
  const app = createApp(async () => { calls++; await tick(); return good('homepage'); });
  const responses = await Promise.all(Array.from({ length: 80 }, (_, i) => app.route(i % 2 ? 'program' : 'homepage').GET()));
  assert.ok(responses.every(response => response.status === 200));
  assert.equal(calls, 1);
});

test('independent cold module graphs can duplicate work: no distributed-lock claim', async () => {
  installCacheBackend();
  let calls = 0;
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const fetch = async () => { calls++; await waiting; return good('homepage'); };
  const a = createApp(fetch).route('homepage').GET();
  const b = createApp(fetch).route('program').GET();
  await tick();
  assert.equal(calls, 2);
  release();
  assert.equal((await a).status, 200);
  assert.equal((await b).status, 200);
});

test('separate route bundles in one process share the refresh registry', async () => {
  installCacheBackend();
  const shared = new Map();
  let calls = 0;
  const fetch = async () => { calls++; await tick(); return good('homepage'); };
  const a = createApp(fetch, { __rpdRefreshStates: shared });
  const b = createApp(fetch, { __rpdRefreshStates: shared });
  const responses = await Promise.all([a.route('homepage').GET(), b.route('program').GET()]);
  assert.ok(responses.every(r => r.status === 200));
  assert.equal(calls, 1);
});

test('concurrent background stale refreshes share the loader, not just the cached read', async () => {
  const backend = installCacheBackend();
  let calls = 0;
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const app = createApp(async () => { calls++; if (calls > 1) await waiting; return good('homepage'); });
  await withRequest(() => app.route('homepage').GET());
  backend.advance(300001);
  const first = withRequest(() => app.route('homepage').GET());
  await tick();
  const others = Array.from({ length: 40 }, () => withRequest(() => app.route('program').GET()));
  await tick();
  assert.equal(calls, 2);
  release();
  await Promise.all([first, ...others]);
});

for (const status of [429, 500, 503]) {
  test(`transient upstream HTTP ${status} retries once within the original budget and recovers`, async () => {
    const backend = installCacheBackend();
    let calls = 0;
    const timeouts = [];
    const app = createApp(async () => ++calls === 1 ? new Response('private', { status }) : good('schedule'), {
      setTimeout(fn, ms) { backend.advance(ms); queueMicrotask(fn); return 0; },
      AbortSignal: { timeout(ms) { timeouts.push(ms); return AbortSignal.timeout(ms); } },
    });
    const response = await app.route('schedule').GET();
    assert.equal(response.status, 200);
    assert.equal((await response.json())[1][0], 'Fixture Schedule');
    assert.equal(calls, 2);
    assert.ok(timeouts[1] < timeouts[0]);
    assert.ok(timeouts[0] <= 8000);
  });
}

test('non-transient HTTP 404 and malformed HTTP 200 responses are not retried or cached', async () => {
  for (const response of [() => new Response('private', { status: 404 }), () => new Response('<html>challenge</html>')]) {
    const backend = installCacheBackend();
    let calls = 0;
    const app = createApp(async () => { calls++; return response(); });
    assert.equal((await app.route('homepage').GET()).status, 500);
    assert.equal(calls, 1);
    assert.equal(backend.entries.size, 0);
  }
});

test('timeout consumes the total request budget, aborts work, and does not retry beyond it', async () => {
  const backend = installCacheBackend();
  let calls = 0;
  const app = createApp((_url, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  }, {
    AbortSignal: { timeout(ms) {
      const c = new AbortController();
      setImmediate(() => { backend.advance(ms); c.abort(new DOMException('Fixture timeout', 'TimeoutError')); });
      return c.signal;
    } },
  });
  const response = await app.route('schedule').GET();
  assert.equal(response.status, 500);
  assert.equal(calls, 1);
  assert.equal(backend.entries.size, 0);
});

for (const status of [429, 503]) {
  test(`upstream ${status} Retry-After triggers immediate instance cooldown and later recovery`, async () => {
    const backend = installCacheBackend();
    let calls = 0;
    let healthy = false;
    const app = createApp(async () => {
      calls++;
      return healthy ? good('schedule') : new Response('private', { status, headers: { 'Retry-After': '120' } });
    });
    assert.equal((await app.route('schedule').GET()).status, 500);
    const cooldown = await app.route('schedule').GET();
    assert.equal(cooldown.status, 503);
    assert.equal(cooldown.headers.get('retry-after'), '120');
    assert.equal(cooldown.headers.get('cache-control'), 'no-store');
    assert.equal(calls, 1);
    healthy = true;
    backend.advance(120001);
    assert.equal((await app.route('schedule').GET()).status, 200);
    assert.equal(calls, 2);
  });
}

test('three invalid refreshes open a 30s circuit; recovery admits only one concurrent probe', async () => {
  const backend = installCacheBackend();
  let calls = 0;
  let healthy = false;
  const app = createApp(async () => { calls++; return healthy ? good('schedule') : new Response('not csv'); });
  for (let i = 0; i < 3; i++) assert.equal((await app.route('schedule').GET()).status, 500);
  assert.equal(calls, 3);
  const blocked = await app.route('schedule').GET();
  assert.equal(blocked.status, 503);
  assert.equal(blocked.headers.get('retry-after'), '30');
  backend.advance(29999);
  assert.equal((await app.route('schedule').GET()).headers.get('retry-after'), '1');
  assert.equal(calls, 3);
  backend.advance(2);
  healthy = true;
  const results = await Promise.all(Array.from({ length: 40 }, () => app.route('schedule').GET()));
  assert.ok(results.every(r => r.status === 200));
  assert.equal(calls, 4);
});

for (const [name, ttl, maxAge] of [['homepage', 300, 3600], ['about', 900, 86400], ['podcast', 900, 86400], ['schedule', 60, 300], ['now-playing', 15, 60]]) {
  test(`${name}: stale LKG is bounded to total ${maxAge}s, invalid refresh cannot replace it, recovery works`, async t => {
    quietNext(t);
    const backend = installCacheBackend();
    let healthy = true;
    const app = createApp(async () => healthy ? good(name) : new Response('malformed'));
    const route = app.route(name);
    const original = await (await withRequest(() => route.GET())).json();
    const originalEntry = [...backend.entries.values()][0].value.data.body;
    healthy = false;
    backend.advance(ttl * 1000 + 1);
    const stale = await withRequest(() => route.GET());
    assert.equal(stale.status, 200);
    assert.deepEqual(await stale.json(), original);
    assert.equal([...backend.entries.values()][0].value.data.body, originalEntry);
    backend.advance((maxAge - ttl) * 1000);
    const expired = await withRequest(() => route.GET());
    assert.equal(expired.status, name === 'now-playing' ? 200 : 503);
    assert.equal(expired.headers.get('cache-control'), 'no-store');
    if (name === 'now-playing') {
      assert.equal(expired.headers.get('x-rpd-valid-until'), '0');
      assert.deepEqual(await expired.json(), { displayTitle: 'Radio PPI Dunia Mengudara' });
    } else assert.equal(expired.headers.get('retry-after'), '15');
    assert.equal([...backend.entries.values()][0].value.data.body, originalEntry);
    healthy = true;
    await withRequest(() => route.GET()); // expired entry revalidates in background
    const recovered = await withRequest(() => route.GET());
    assert.equal(recovered.status, 200);
    assert.notEqual([...backend.entries.values()][0].value.data.body, originalEntry);
  });
}

test('evicted cache plus upstream failure is unavailable; no durable storage is implied', async () => {
  const backend = installCacheBackend();
  let healthy = true;
  const app = createApp(async () => healthy ? good('schedule') : new Response('malformed'));
  await app.route('schedule').GET();
  backend.entries.clear();
  healthy = false;
  assert.equal((await app.route('schedule').GET()).status, 500);
  assert.equal(backend.entries.size, 0);
});

test('now-playing exposes origin expiry; client expires a song while requests fail or tab is hidden', async () => {
  const backend = installCacheBackend();
  const origin = createApp(async () => good('now-playing'));
  const response = await origin.route('now-playing').GET();
  assert.equal(Number(response.headers.get('x-rpd-valid-until')), backend.now() + 60000);
  const document = new EventTarget();
  document.hidden = false;
  let calls = 0;
  const timers = new Map();
  let id = 0;
  const titles = [];
  const client = createApp(async () => {
    calls++;
    if (calls > 1) throw new TypeError('Fixture network failure');
    return new Response('{"displayTitle":"Fixture song"}', { headers: { 'X-RPD-Valid-Until': String(backend.now() + 5000) } });
  }, {
    document,
    setTimeout(fn, ms) { timers.set(++id, { fn, at: backend.now() + ms }); return id; },
    clearTimeout(key) { timers.delete(key); },
  });
  const stop = client.load('src/lib/now-playing-polling').startNowPlayingPolling(title => titles.push(title));
  await tick();
  assert.deepEqual(titles, ['Fixture song']);
  document.hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  backend.advance(6000); // no timer fires, as in a throttled hidden tab
  document.hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  await tick();
  assert.equal(titles.at(-1), 'Info siaran belum tersedia');
  stop();
  assert.equal(timers.size, 0);
});

test('client title watchdog expires metadata even if all subsequent network calls fail', async () => {
  const backend = installCacheBackend();
  const document = new EventTarget();
  document.hidden = false;
  const timers = new Map();
  let id = 0;
  let calls = 0;
  const titles = [];
  const app = createApp(async () => {
    if (++calls > 1) return new Response('unavailable', { status: 429 });
    return new Response('{"displayTitle":"Fixture song"}');
  }, {
    document,
    setTimeout(fn, ms) { timers.set(++id, { fn, at: backend.now() + ms }); return id; },
    clearTimeout(key) { timers.delete(key); },
  });
  const stop = app.load('src/lib/now-playing-polling').startNowPlayingPolling(title => titles.push(title));
  await tick();
  backend.advance(15001);
  const poll = [...timers].find(([, value]) => value.at <= backend.now());
  timers.delete(poll[0]); await poll[1].fn();
  assert.equal(titles.at(-1), 'Fixture song');
  backend.advance(45000);
  const expiry = [...timers].find(([, value]) => value.at <= backend.now());
  timers.delete(expiry[0]); expiry[1].fn();
  assert.equal(titles.at(-1), 'Info siaran belum tersedia');
  stop();
});

test('Retry-After parsing accepts dates, clamps extremes, rejects malformed values', () => {
  const backend = installCacheBackend();
  const { retryAfterMs } = createApp(async () => good('schedule')).load('src/lib/upstream-reliability');
  assert.equal(retryAfterMs('2'), 2000);
  assert.equal(retryAfterMs(new Date(backend.now() + 120000).toUTCString()) > 119000, true);
  assert.equal(retryAfterMs('999999999999'), 300000);
  assert.equal(retryAfterMs('malformed'), 0);
  assert.equal(retryAfterMs(null), 0);
});

test('initial client HTTP or malformed-data failure displays an unavailable state', async () => {
  installCacheBackend();
  for (const response of [() => new Response('{}'), () => new Response('null'), () => new Response('private', { status: 503 })]) {
    const document = new EventTarget();
    document.hidden = false;
    const titles = [];
    const app = createApp(async () => response(), { document, setTimeout: () => 0, clearTimeout() {} });
    const stop = app.load('src/lib/now-playing-polling').startNowPlayingPolling(title => titles.push(title));
    await tick();
    assert.deepEqual(titles, ['Info siaran belum tersedia']);
    stop();
  }
});
