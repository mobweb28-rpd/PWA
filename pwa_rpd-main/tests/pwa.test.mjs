import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function worker(fetch) {
  const handlers = {}, deleted = [];
  const offline = new Response('offline');
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    self: { location: { origin: 'https://rpd.test' }, addEventListener: (name, handler) => { handlers[name] = handler; }, clients: { claim() {} } },
    caches: { keys: async () => ['rpd-mobile-v1', 'rpd-mobile-v2', 'unrelated'], delete: async key => deleted.push(key), match: async () => offline },
    fetch, URL, Response,
  });
  return { handlers, deleted, offline };
}
test('PWA removes old owned caches, preserves unrelated caches and reads fresh navigation', async () => {
  const fresh = new Response('new deployment');
  const app = worker(async () => fresh);
  let work;
  app.handlers.activate({ waitUntil: promise => { work = promise; } });
  await work;
  assert.deepEqual(app.deleted, ['rpd-mobile-v1']);
  app.handlers.fetch({ request: { url: 'https://rpd.test/', method: 'GET', mode: 'navigate' }, respondWith: promise => { work = promise; } });
  assert.equal(await work, fresh);
});
test('Offline navigation gets fallback; audio, APIs, RSC and cross-origin requests bypass worker', async () => {
  const app = worker(async () => { throw new Error('offline'); });
  let work;
  app.handlers.fetch({ request: { url: 'https://rpd.test/podcast', method: 'GET', mode: 'navigate' }, respondWith: promise => { work = promise; } });
  assert.equal(await work, app.offline);
  for (const url of ['https://rpd.test/api/stream', 'https://rpd.test/api/now-playing', 'https://rpd.test/?_rsc=123', 'https://rpd.test/_next/a.js', 'https://external.test/stream']) {
    app.handlers.fetch({ request: { url, method: 'GET', mode: 'cors' }, respondWith() { assert.fail('request must bypass worker'); } });
  }
});
test('Production admin gate fails closed until explicitly enabled', () => {
  const source = readFileSync(new URL('../src/proxy.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  for (const [env, expected] of [[{ NODE_ENV: 'production' }, 503], [{ NODE_ENV: 'production', RPD_ADMIN_ENABLED: 'true' }, 200], [{ NODE_ENV: 'development' }, 200]]) {
    const exports = {};
    vm.runInNewContext(js, { exports, process: { env }, require: id => { assert.equal(id, 'next/server'); return require(id); } });
    assert.equal(exports.proxy({}).status, expected);
  }
});
