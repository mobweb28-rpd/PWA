// These guards protect refresh work, not incoming clients. Their state is
// instance-local; distributed client limiting belongs to the Vercel Firewall.
export class PublicDataUnavailable extends Error {
  constructor(public readonly retryAfterSeconds = 15) {
    super('Public content is temporarily unavailable');
  }
}

export class UpstreamFailure extends Error {
  constructor(
    public readonly retryable: boolean,
    public readonly retryAfterMs = 0,
  ) {
    super('Upstream request failed');
  }
}

export const REFRESH_FAILURE_THRESHOLD = 3;
export const REFRESH_COOLDOWN_MS = 30_000;
export const MAX_UPSTREAM_RETRY_AFTER_MS = 300_000;
export const MAX_UPSTREAM_ATTEMPTS = 2;

type RefreshState = { pending?: Promise<unknown>; failures: number; cooldownUntil: number };
// Route bundles may load separate copies of this module in the same process.
// Share only transient refresh state by source, never IP/client information.
const runtime = globalThis as typeof globalThis & { __rpdRefreshStates?: Map<string, RefreshState> };
const refreshStates = runtime.__rpdRefreshStates ??= new Map<string, RefreshState>();

export function retryAfterMs(value: string | null): number {
  if (!value) return 0;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value) * 1000
    : Date.parse(value) - Date.now();
  return Number.isFinite(seconds)
    ? Math.min(MAX_UPSTREAM_RETRY_AFTER_MS, Math.max(0, seconds)) : 0;
}

export function guardRefresh<T>(load: () => Promise<T>, sourceKey: string) {
  const state = refreshStates.get(sourceKey) ?? { failures: 0, cooldownUntil: 0 };
  refreshStates.set(sourceKey, state);
  return () => {
    if (state.pending) return state.pending as Promise<T>;
    if (Date.now() < state.cooldownUntil) {
      return Promise.reject(new PublicDataUnavailable(Math.ceil((state.cooldownUntil - Date.now()) / 1000)));
    }
    const pending = Promise.resolve().then(load).then(value => {
      state.failures = 0;
      state.cooldownUntil = 0;
      return value;
    }, error => {
      state.failures++;
      const providerDelay = error instanceof UpstreamFailure ? error.retryAfterMs : 0;
      if (state.failures >= REFRESH_FAILURE_THRESHOLD || providerDelay > 0) {
        state.cooldownUntil = Date.now() + Math.max(REFRESH_COOLDOWN_MS, providerDelay);
      }
      throw error;
    }).finally(() => { state.pending = undefined; });
    state.pending = pending;
    return pending;
  };
}
