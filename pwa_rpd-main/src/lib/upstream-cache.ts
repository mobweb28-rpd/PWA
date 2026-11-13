import { unstable_cache } from 'next/cache';
import { guardRefresh, MAX_UPSTREAM_ATTEMPTS, PublicDataUnavailable, retryAfterMs, UpstreamFailure } from '@/lib/upstream-reliability';

// Cache validated public data, never error fallbacks or request-specific data.
// Data Cache is backed by Vercel rather than a process-local Map. No route/CDN
// cache is added on top, so these are the sole freshness intervals (seconds).
export const PUBLIC_TTLS = {
  homepage: 300, about: 900, podcast: 900, schedule: 60, 'now-playing': 15,
} as const;

// Maximum TOTAL age since successful validation, including the fresh TTL.
// Data Cache may evict entries: this is bounded cache-backed LKG, not a durable
// archival store. Never turn a cache read into a new validation timestamp.
export const PUBLIC_MAX_AGES = {
  homepage: 3600, about: 86400, podcast: 86400, schedule: 300, 'now-playing': 60,
} as const;

type Snapshot<T> = { value: T; validatedAt: number };

export function cachePublic<T>(source: keyof typeof PUBLIC_TTLS, load: () => Promise<T>) {
  // Guard the loader itself, so concurrent background revalidations are also
  // coalesced after the outer cached read has already returned stale content.
  const refresh = guardRefresh(async (): Promise<Snapshot<T>> => ({
    value: await load(), validatedAt: Date.now(),
  }), `rpd-public-v3b-1:${source}`);
  const cached = unstable_cache(refresh, ['rpd-public-v3b-1', source], {
    revalidate: PUBLIC_TTLS[source],
  });
  // Coalesce simultaneous callers in this module, including a cold miss.
  // Persistence/sharing still comes from Data Cache, not this short-lived promise.
  let pending: Promise<Snapshot<T>> | undefined;
  const snapshot = () => {
    pending ??= cached().then(result => {
      const age = Date.now() - result.validatedAt;
      if (!Number.isFinite(age) || age < 0 || age >= PUBLIC_MAX_AGES[source] * 1000) {
        throw new PublicDataUnavailable();
      }
      return result;
    }).finally(() => { pending = undefined; });
    return pending;
  };
  return Object.assign(async () => (await snapshot()).value, { snapshot });
}

export async function upstreamText(url: string, timeoutMs = 8000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 0; attempt < MAX_UPSTREAM_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new UpstreamFailure(true);
    try {
      const response = await fetch(url, {
        // Cache only validated results, not HTTP 200 bot/error pages.
        cache: 'no-store',
        signal: AbortSignal.timeout(remaining),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      });
      if (!response.ok) {
        const transient = [408, 429, 500, 502, 503, 504].includes(response.status);
        const delay = transient ? retryAfterMs(response.headers.get('retry-after')) : 0;
        await response.body?.cancel();
        throw new UpstreamFailure(transient, delay);
      }
      const text = await response.text();
      if (!text.trim()) throw new UpstreamFailure(false);
      return text;
    } catch (error) {
      const retryable = error instanceof UpstreamFailure ? error.retryable
        : error instanceof TypeError || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name));
      const providerDelay = error instanceof UpstreamFailure ? error.retryAfterMs : 0;
      const delay = Math.max(providerDelay, 200 + Math.floor(Math.random() * 100));
      if (!retryable || attempt + 1 >= MAX_UPSTREAM_ATTEMPTS || Date.now() + delay >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new UpstreamFailure(true);
}
