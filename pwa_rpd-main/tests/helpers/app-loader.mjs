import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { AsyncLocalStorage } from 'node:async_hooks';

const require = createRequire(import.meta.url);
globalThis.AsyncLocalStorage = AsyncLocalStorage;
const dependencies = {
  'next/server': require('next/server'),
  'next/cache': require('next/cache'),
  cheerio: require('cheerio'),
};
let clockDate = Date;

// Executes the real route/source/cache modules with only HTTP and the cache
// storage backend replaced. Next's unstable_cache itself is not mocked.
export function createApp(fetch, extraGlobals = {}) {
  const loaded = new Map();
  function load(path) {
    if (loaded.has(path)) return loaded.get(path);
    const source = readFileSync(new URL(`../../${path}.ts`, import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    loaded.set(path, exports);
    vm.runInNewContext(compiled, {
      exports, fetch, process, URL, Error, TypeError, AbortController, AbortSignal, setTimeout, clearTimeout,
      Date: clockDate, setInterval: () => 0, clearInterval() {},
      console: { error() {}, warn() {} }, ...extraGlobals,
      require(id) {
        if (id.startsWith('@/')) return load('src/' + id.slice(2));
        if (Object.hasOwn(dependencies, id)) return dependencies[id];
        throw new Error('Unexpected test dependency: ' + id);
      },
    }, { timeout: 1000 });
    return exports;
  }
  return { load, route: name => load(`src/app/api/${name}/route`) };
}

export function installCacheBackend({ enabled = true } = {}) {
  let now = Date.now();
  clockDate = class extends Date { static now() { return now; } };
  const entries = new Map();
  globalThis.__incrementalCache = {
    generateSimpleCacheKey: async key => key,
    async get(key, options) {
      if (!enabled) return null;
      const entry = entries.get(key);
      return entry ? { value: entry.value, isStale: now - entry.time >= options.revalidate * 1000 } : null;
    },
    async set(key, value) { if (enabled) entries.set(key, { value, time: now }); },
  };
  return { advance: ms => { now += ms; }, now: () => now, entries };
}

export function withRequest(run) {
  const { workAsyncStorage } = require('next/dist/server/app-render/work-async-storage.external');
  const store = { incrementalCache: globalThis.__incrementalCache, nextFetchId: 1 };
  return workAsyncStorage.run(store, async () => {
    const result = await run();
    await Promise.all(Object.values(store.pendingRevalidates || {}));
    return result;
  });
}
