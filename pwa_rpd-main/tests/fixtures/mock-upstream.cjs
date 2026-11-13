// Preload only in the isolated smoke-test child process, never in app code.
if (process.env.RPD_SMOKE_TEST !== '1') throw new Error('Fixture preload is restricted to smoke tests');
const fixtures = require('./upstream.cjs');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const dns = require('node:dns');
const imageHost = (hostname) => hostname === 'radioppidunia.org' || hostname === 'images.unsplash.com' || hostname.endsWith('.supabase.co');

// Next 16's hardened optimizer uses DNS-pinned native http(s), not global fetch.
// Supply a public-IP fixture and a native response stream without opening sockets.
const lookup = dns.lookup;
dns.lookup = (hostname, options, callback) => {
  if (typeof options === 'function') { callback = options; options = {}; }
  if (imageHost(hostname)) {
    queueMicrotask(() => options?.all ? callback(null, [{ address: '93.184.216.34', family: 4 }]) : callback(null, '93.184.216.34', 4));
    return;
  }
  if (hostname === 'localhost' || hostname === '127.0.0.1') return lookup(hostname, options, callback);
  throw new Error('Unexpected external DNS lookup blocked by smoke-test fixture');
};
for (const protocol of ['node:http', 'node:https']) {
  const client = require(protocol);
  const request = client.request;
  client.request = (input, options, callback) => {
    const url = input instanceof URL ? input : typeof input === 'string' ? new URL(input) : { hostname: input.hostname || input.host };
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return request(input, options, callback);
    if (!imageHost(url.hostname)) throw new Error('Unexpected native external request blocked by smoke-test fixture');
    const req = new EventEmitter();
    req.end = () => {
      queueMicrotask(() => {
        const response = Readable.from([fixtures.png]);
        response.statusCode = 200;
        response.headers = { 'content-type': 'image/png', 'cache-control': 'public, max-age=60' };
        callback(response);
      });
    };
    req.destroy = (error) => { if (error) req.emit('error', error); return req; };
    return req;
  };
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async function fixtureFetch(input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return originalFetch(input, init);
  if (process.env.RPD_FIXTURE_REQUEST_LOG) {
    const source = url.hostname === 'docs.google.com' ? 'schedule'
      : url.hostname === 'cdn.voscast.com' && url.pathname === '/stats/display.js' ? 'now-playing'
      : url.hostname === 'radioppidunia.org' && url.pathname === '/' ? 'homepage'
      : url.hostname === 'radioppidunia.org' && url.pathname === '/about-us/' ? 'about'
      : url.hostname === 'radioppidunia.org' && url.pathname === '/rpd-podcast-podcast/' ? 'podcast' : null;
    if (source) {
      require('node:fs').appendFileSync(process.env.RPD_FIXTURE_REQUEST_LOG, source + '\n');
      if (process.env.RPD_FIXTURE_DELAY_MS) await new Promise(resolve => setTimeout(resolve, Number(process.env.RPD_FIXTURE_DELAY_MS)));
    }
  }
  if (url.hostname === 'radioppidunia.org') {
    if (url.pathname === '/') return new Response(fixtures.homepage);
    if (url.pathname === '/about-us/') return new Response(fixtures.about);
    if (url.pathname === '/rpd-podcast-podcast/') return new Response(fixtures.podcast);
    if (url.pathname === '/fixture.wav') return new Response(fixtures.wav, { headers: { 'Content-Type': 'audio/wav' } });
    return new Response(fixtures.png, { headers: { 'Content-Type': 'image/png' } });
  }
  if (url.hostname === 'docs.google.com') return new Response(fixtures.schedule);
  if (url.hostname === 'cdn.voscast.com' && url.pathname === '/stats/display.js') {
    return new Response(`document.write('${url.searchParams.get('stats') === 'songtitle' ? 'Fixture Song - Fixture Artist' : 'Radio PPI Dunia'}');`);
  }
  if (url.hostname === 's1.voscast.com') return new Response(fixtures.wav, { headers: { 'Content-Type': 'audio/mpeg' } });
  if (url.hostname.endsWith('.supabase.co') && url.pathname.includes('/storage/')) return new Response(fixtures.png, { headers: { 'Content-Type': 'image/png' } });
  throw new Error('Unexpected external request blocked by smoke-test fixture');
};
