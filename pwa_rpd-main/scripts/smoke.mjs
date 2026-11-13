import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, writeFile, readFile, readdir, unlink, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const fixtures = require('../tests/fixtures/upstream.cjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const reportDir = new URL(process.env.RPD_TEST_REPORT_DIR || '../reports/phase1/', import.meta.url);
const temp = await mkdtemp(join(tmpdir(), 'rpd-phase3a-'));
const requestLog = join(temp, 'requests.txt');
await writeFile(requestLog, '');
const fetchCacheDir = join(root, '.next', 'cache', 'fetch-cache');
const cacheBefore = new Set(await readdir(fetchCacheDir).catch(() => []));
const counts = async () => (await readFile(requestLog, 'utf8')).trim().split('\n').filter(Boolean)
  .reduce((result, name) => { result[name] = (result[name] || 0) + 1; return result; }, {});
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [
  '--require', fileURLToPath(new URL('../tests/fixtures/mock-upstream.cjs', import.meta.url)),
  fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)),
  'start', '--hostname', '127.0.0.1', '-p', String(port),
], { cwd: root, env: { ...process.env, RPD_SMOKE_TEST: '1', RPD_FIXTURE_REQUEST_LOG: requestLog, RPD_FIXTURE_DELAY_MS: '50', NEXT_TELEMETRY_DISABLED: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
child.stdout.on('data', (data) => { logs += data; });
child.stderr.on('data', (data) => { logs += data; });
const results = [];
let browser;
async function check(name, run) {
  try { await run(); results.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) {
    results.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`);
  }
}
try {
  const deadline = Date.now() + 30000;
  for (;;) {
    if (child.exitCode !== null) throw new Error('Smoke-test server exited before startup');
    try { if ((await fetch(`${base}/manifest.json`)).ok) break; } catch { /* wait for local server */ }
    if (Date.now() > deadline) throw new Error('Smoke-test server startup timed out');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  for (const path of ['/', '/about', '/program', '/podcast', '/faq', '/hut-rpd', '/admin/login', '/admin/dashboard']) {
    await check(`HTTP ${path}`, async () => {
      const res = await fetch(base + path);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(!html.includes('orchids-browser-logs.js'));
      assert.ok(!html.includes('route-messenger.js'));
      assert.equal(res.headers.get('x-powered-by'), null);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    });
  }
  const validators = {
    '/api/homepage': (d) => { assert.equal(d.musicList[0].title, 'Fixture song'); assert.equal(d.banners.length, 2); },
    '/api/about': (d) => { assert.equal(d.members[0].name, 'Fixture Member'); assert.equal(d.aboutBackgrounds.length, 1); },
    '/api/program': (d) => { assert.equal(d.regularBanners.length, 1); assert.equal(d.specialBanners.length, 1); },
    '/api/podcast': (d) => { assert.equal(d[0].title, 'Fixture Podcast'); assert.equal(d[0].audio_url, 'https://radioppidunia.org/fixture.wav'); },
    '/api/schedule': (d) => { assert.equal(d[1][0], 'Fixture Schedule'); assert.equal(d[4][1], 'Fixture show'); },
    '/api/now-playing': (d) => assert.equal(d.displayTitle, 'Fixture Song - Fixture Artist'),
  };
  await check('Production concurrent cold homepage/program reads share refresh work', async () => {
    const responses = await Promise.all(Array.from({ length: 40 }, (_, i) => fetch(base + (i % 2 ? '/api/homepage' : '/api/program'))));
    assert.ok(responses.every(response => response.status === 200));
    await Promise.all(responses.map(response => response.arrayBuffer()));
    assert.equal((await counts()).homepage, 1);
  });
  for (const [path, validate] of Object.entries(validators)) {
    await check(`API contract ${path}`, async () => {
      const response = await fetch(base + path);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      if (path === '/api/now-playing') assert.ok(Number(response.headers.get('x-rpd-valid-until')) > Date.now());
      validate(await response.json());
    });
  }
  await check('Production Data Cache shares homepage/program and avoids warm upstream calls', async () => {
    const cold = await counts();
    assert.deepEqual(cold, { homepage: 1, about: 1, podcast: 1, schedule: 1, 'now-playing': 2 });
    for (const [path, validate] of Object.entries(validators)) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200);
      validate(await response.json());
    }
    assert.deepEqual(await counts(), cold);
  });
  await check('A second production server reads the persistent homepage cache', async () => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    const second = spawn(process.execPath, [...child.spawnargs.slice(1, -1), String(port)], {
      cwd: root, windowsHide: true, stdio: 'ignore',
      env: { ...process.env, RPD_SMOKE_TEST: '1', RPD_FIXTURE_REQUEST_LOG: requestLog, NEXT_TELEMETRY_DISABLED: '1' },
    });
    try {
      const deadline = Date.now() + 30000;
      for (;;) {
        try { if ((await fetch(`http://127.0.0.1:${port}/manifest.json`)).ok) break; } catch { /* starting */ }
        if (second.exitCode !== null || Date.now() > deadline) throw new Error('Second server failed to start');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const before = (await counts()).homepage;
      const response = await fetch(`http://127.0.0.1:${port}/api/program`);
      assert.equal(response.status, 200);
      validators['/api/program'](await response.json());
      assert.equal((await counts()).homepage, before);
    } finally {
      second.kill();
      if (second.exitCode === null) await once(second, 'exit');
    }
  });
  await check('Stream route returns fixture audio', async () => {
    const r = await fetch(`${base}/api/stream`);
    assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /audio/);
    assert.ok((await r.arrayBuffer()).byteLength > 0);
  });
  for (const path of [...Object.keys(validators), '/api/stream', '/api/scrape']) {
    await check(`Reject POST ${path}`, async () => assert.equal((await fetch(base + path, { method: 'POST' })).status, 405));
  }
  await check('Disabled scraper remains 405', async () => assert.equal((await fetch(`${base}/api/scrape`)).status, 405));
  await check('Image optimizer rejects unapproved origins and localhost', async () => {
    for (const url of ['https://unapproved.invalid/image.png', 'http://127.0.0.1/private']) {
      const r = await fetch(`${base}/_next/image?url=${encodeURIComponent(url)}&w=640&q=75`);
      assert.equal(r.status, 400);
    }
  });
  await check('Approved public image origin still renders through Next optimizer', async () => {
    const url = encodeURIComponent('https://radioppidunia.org/fixture.png');
    const response = await fetch(`${base}/_next/image?url=${url}&w=640&q=75`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^image\//);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  });
  await check('PWA manifest and local icons', async () => {
    const r = await fetch(`${base}/manifest.json`); assert.equal(r.status, 200);
    const manifest = await r.json(); assert.equal(manifest.name, 'Radio PPI Dunia');
    for (const icon of manifest.icons) assert.equal((await fetch(base + icon.src)).status, 200);
    assert.equal((await fetch(`${base}/sw.js`)).status, 200);
  });

  const channel = process.env.RPD_TEST_BROWSER_CHANNEL || 'chromium';
  browser = await chromium.launch({ channel, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const pageErrors = [];
  const externalRequests = [];
  const interceptedRequests = new WeakSet();
  context.on('request', (request) => {
    if (new URL(request.url()).origin !== base) externalRequests.push(request);
  });
  context.on('page', (page) => page.on('pageerror', (error) => pageErrors.push(error.message)));
  await context.addInitScript(() => {
    // Opaque srcdoc frames can start requests before their browser target is
    // attached to Playwright. Substitute the third-party widget before React
    // assigns srcdoc, while testing the real container and sandbox attributes.
    const fixtureDoc = (value) => {
      if (typeof value !== 'string' || !value.includes('"handle":"radioppiduniachat"')) return value;
      window.__fixtureChatProviderConfigured = value.includes('https://st.chatango.com/js/gz/emb.js');
      return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,
        '<script>var widget = document.createElement("iframe"); widget.srcdoc = "<!doctype html><body>Fixture chat widget</body>"; document.body.appendChild(widget);<\/script>');
    };
    const srcdoc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc');
    Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
      ...srcdoc,
      set(value) { srcdoc.set.call(this, fixtureDoc(value)); },
    });
    const setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      return setAttribute.call(this, name, this instanceof HTMLIFrameElement && name.toLowerCase() === 'srcdoc' ? fixtureDoc(value) : value);
    };
    window.__fixtureAudio = [];
    const OriginalAudio = window.Audio;
    window.Audio = function (...args) { const audio = new OriginalAudio(...args); window.__fixtureAudio.push(audio); return audio; };
    window.Audio.prototype = OriginalAudio.prototype;
    HTMLMediaElement.prototype.play = function () { window.__fixtureAudio.push(this); this.dispatchEvent(new Event('play')); return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function () { this.dispatchEvent(new Event('pause')); };
  });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    interceptedRequests.add(route.request());
    if (url.hostname.endsWith('.supabase.co') && !url.pathname.includes('/storage/')) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"External Auth intentionally blocked in smoke tests"}' });
    }
    if (url.hostname === 'st.chatango.com') {
      if (url.pathname.endsWith('/emb.js')) return route.fulfill({ contentType: 'text/javascript', body: "const frame = document.createElement('iframe'); frame.src = 'https://st.chatango.com/fixture.html'; document.body.appendChild(frame); document.body.dataset.fixtureChatReady = 'true';" });
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body data-fixture-chat-ready="true">Fixture chat widget</body>' });
    }
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });
    if (route.request().resourceType() === 'image') return route.fulfill({ contentType: 'image/png', body: fixtures.png });
    if (/fixture\.wav|workers\.dev/.test(url.href)) return route.fulfill({ contentType: 'audio/wav', body: fixtures.wav });
    return route.fulfill({ status: 204, body: '' });
  });
  const page = await context.newPage();
  await check('Browser homepage hydration, chart and radio initialization', async () => {
    await page.goto(base);
    await page.getByRole('heading', { name: 'Fixture Announcer - Indonesia', exact: true }).waitFor({ state: 'attached' });
    await page.getByText('Fixture song', { exact: true }).first().waitFor({ state: 'attached' });
    await page.getByRole('button', { name: 'Listen Now', exact: true }).click();
    await page.locator('button[aria-label="Play/Pause"]:visible').click();
    await page.waitForFunction(() => window.__fixtureAudio.some((audio) => audio.src.includes('rpd-radio-proxy.mobileweb-rpd.workers.dev')));
    await page.getByText('Fixture Song - Fixture Artist', { exact: true }).waitFor();
  });
  await check('Chatango iframe initializes with isolated origin', async () => {
    await page.getByRole('button', { name: 'CHATBOX', exact: true }).click();
    const frame = page.frameLocator('iframe[title="Radio PPI Dunia Chat"]');
    await frame.locator('iframe').waitFor({ state: 'attached', timeout: 10000 });
    const handle = await page.locator('iframe[title="Radio PPI Dunia Chat"]').elementHandle();
    const childFrame = await handle.contentFrame();
    assert.equal(await childFrame.evaluate(() => { try { return !!parent.document; } catch { return false; } }), false);
    assert.equal(await page.evaluate(() => window.__fixtureChatProviderConfigured), true);
  });
  await check('Browser About and member popup', async () => {
    await page.goto(base + '/about');
    await page.locator('button[title="Sobat Siar"]:visible').click();
    await page.getByText('Fixture Member', { exact: true }).filter({ visible: true }).first().waitFor({ state: 'visible' });
  });
  await check('Browser Program and schedule', async () => {
    let scheduleRequests = 0;
    const countSchedule = request => { if (new URL(request.url()).pathname === '/api/schedule') scheduleRequests++; };
    page.on('request', countSchedule);
    await page.goto(base + '/program');
    await page.getByText('Fixture Schedule', { exact: true }).waitFor();
    await page.getByText('Fixture show', { exact: true }).first().waitFor();
    assert.equal(scheduleRequests, 1);
    page.off('request', countSchedule);
  });
  await check('Browser polling pauses hidden, resumes and stops on admin routes', async () => {
    const pollPage = await context.newPage();
    await pollPage.clock.install();
    await Promise.all([
      pollPage.waitForResponse(response => response.url().endsWith('/api/now-playing')),
      pollPage.goto(base + '/faq'),
    ]);
    await pollPage.evaluate(() => 0);
    let polls = 0;
    const countPoll = request => { if (new URL(request.url()).pathname === '/api/now-playing') polls++; };
    pollPage.on('request', countPoll);
    await pollPage.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await pollPage.clock.runFor(45000);
    assert.equal(polls, 0);
    const resumed = pollPage.waitForResponse(response => response.url().endsWith('/api/now-playing'));
    await pollPage.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await resumed;
    assert.equal(polls, 1, 'Resume starts exactly one request');
    await pollPage.evaluate(() => { delete document.hidden; });
    await pollPage.goto(base + '/admin/login');
    const before = polls;
    await pollPage.clock.runFor(45000);
    assert.equal(polls, before, 'Admin route does not poll');
    pollPage.off('request', countPoll);
    await pollPage.close();
  });
  await check('Browser expires old song information during metadata failures', async () => {
    const expiryPage = await context.newPage();
    try {
      await expiryPage.clock.install();
      let calls = 0;
      await expiryPage.route('**/api/now-playing', async route => {
        if (++calls > 1) return route.fulfill({ status: 503, body: 'Fixture unavailable', headers: { 'Retry-After': '30' } });
        const until = await expiryPage.evaluate(() => Date.now() + 30000);
        return route.fulfill({
          status: 200, contentType: 'application/json',
          headers: { 'X-RPD-Valid-Until': String(until) },
          body: JSON.stringify({ displayTitle: 'Fixture short-lived song' }),
        });
      });
      await expiryPage.goto(base + '/faq');
      await expiryPage.getByRole('button', { name: 'Listen Now', exact: true }).click();
      await expiryPage.getByText('Fixture short-lived song', { exact: true }).waitFor();
      const failed = expiryPage.waitForResponse(response => response.url().endsWith('/api/now-playing') && response.status() === 503);
      await expiryPage.clock.runFor(16000);
      await failed;
      await expiryPage.getByText('Fixture short-lived song', { exact: true }).waitFor();
      await expiryPage.clock.runFor(15000);
      await expiryPage.getByText('Info siaran belum tersedia', { exact: true }).waitFor();
    } finally {
      await expiryPage.close();
    }
  });
  await check('Browser podcast catalog and play control', async () => {
    await page.goto(base + '/podcast');
    await page.getByText('Fixture Podcast', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Play podcast', exact: true }).first().click();
    await page.getByRole('button', { name: 'Pause podcast', exact: true }).first().waitFor();
  });
  await check('Browser FAQ and navbar navigation', async () => {
    await page.goto(base + '/faq');
    await page.getByText('What is Radio PPI Dunia?', { exact: true }).waitFor();
    await page.locator('header nav a[href="/program"]').click();
    await page.waitForURL(base + '/program');
  });
  await check('Admin redirects without authenticated session', async () => {
    await page.goto(base + '/admin/dashboard');
    await page.waitForURL(base + '/admin/login');
    await page.getByRole('button', { name: 'Sign In', exact: true }).waitFor();
  });
  await check('No browser runtime exceptions', async () => assert.deepEqual(pageErrors, []));
  await check('Every external browser request was intercepted', async () => {
    assert.deepEqual(externalRequests.filter((request) => !interceptedRequests.has(request)).map((request) => new URL(request.url()).hostname), []);
  });
  await context.close();
} finally {
  if (browser) await browser.close();
  child.kill();
  if (child.exitCode === null) await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 5000))]);
  await mkdir(reportDir, { recursive: true });
  await writeFile(new URL('smoke-results.json', reportDir), JSON.stringify({ mockedExternalServices: true, actualAudioPlaybackTested: false, liveAdminOperationsTested: false, browser: process.env.RPD_TEST_BROWSER_CHANNEL || 'chromium', upstreamCalls: await counts(), results }, null, 2) + '\n');
  // Do not leave mock content in the application's persistent Data Cache.
  for (const file of await readdir(fetchCacheDir).catch(() => [])) {
    if (!cacheBefore.has(file)) await unlink(join(fetchCacheDir, file));
  }
  await rm(temp, { recursive: true, force: true });
}
if (results.some((r) => r.status !== 'passed')) process.exitCode = 1;
