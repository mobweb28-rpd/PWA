// Test-only model of the dashboard policy. It does NOT emulate or activate the
// real Vercel service. Never import this memory counter into production code.
export function mockFirewall(policy, now) {
  const counters = new Map();
  return (request, { ip, region = 'test-region' }) => {
    const path = new URL(request.url).pathname;
    if (!policy.requestMethods.includes(request.method) || !new RegExp(policy.requestPathRegex, 'i').test(path)) return null;
    const windowMs = policy.windowSeconds * 1000;
    const window = Math.floor(now() / windowMs);
    const key = `${region}:${ip}:${window}`;
    const count = (counters.get(key) || 0) + 1;
    counters.set(key, count);
    return count <= policy.requestLimit ? null : new Response('Mock firewall rate limit', {
      status: 429,
      // A fixture header only. Native Vercel header behavior must be verified
      // separately; the current public docs do not guarantee this header.
      headers: { 'Retry-After': String(Math.max(1, Math.ceil(((window + 1) * windowMs - now()) / 1000))) },
    });
  };
}
