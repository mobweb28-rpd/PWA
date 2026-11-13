export const NOW_PLAYING_REFRESH_INTERVAL_MS = 15_000;
export const NOW_PLAYING_MAX_AGE_MS = 60_000;
const UNAVAILABLE_TITLE = 'Info siaran belum tersedia';

// One request at a time. Hiding the tab aborts in-flight work; resuming starts
// immediately. Each response belongs to a specific request, so aborted results
// cannot update the player or create a second timer after visibility changes.
export function startNowPlayingPolling(
  onTitle: (title: string) => void,
  intervalMs = NOW_PLAYING_REFRESH_INTERVAL_MS,
) {
  let stopped = false;
  let visible = !document.hidden;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: AbortController | undefined;
  let titleExpiresAt = 0;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const interval = Number.isFinite(intervalMs) && intervalMs > 0
    ? intervalMs : NOW_PLAYING_REFRESH_INTERVAL_MS;

  const expireTitle = () => {
    if (titleExpiresAt && Date.now() >= titleExpiresAt) {
      titleExpiresAt = 0;
      onTitle(UNAVAILABLE_TITLE);
    }
  };
  // One deadline per accepted title, including while requests are failing.
  // A visibility check also catches throttled background timers.

  const poll = async () => {
    expireTitle();
    if (stopped || document.hidden || pending) return;
    const request = new AbortController();
    pending = request;
    // AbortController also works on browsers without AbortSignal.any/timeout.
    const deadline = setTimeout(() => request.abort(), 5000);
    try {
      const response = await fetch('/api/now-playing', {
        signal: request.signal,
      });
      if (!response.ok) throw new Error('Metadata unavailable');
      const data = await response.json();
      if (typeof data?.displayTitle !== 'string' || !data.displayTitle) throw new Error('Invalid metadata');
      if (!stopped && !request.signal.aborted) {
        const header = response.headers.get('X-RPD-Valid-Until');
        const originExpiry = header === null ? NaN : Number(header);
        titleExpiresAt = Number.isFinite(originExpiry) && originExpiry > 0
          ? Math.min(originExpiry, Date.now() + NOW_PLAYING_MAX_AGE_MS)
          : Date.now() + NOW_PLAYING_MAX_AGE_MS;
        if (originExpiry > 0 && titleExpiresAt <= Date.now()) {
          expireTitle();
          return;
        }
        clearTimeout(expiryTimer);
        expiryTimer = setTimeout(expireTitle, titleExpiresAt - Date.now());
        onTitle(data.displayTitle);
      }
    } catch {
      // Preserve only an unexpired title. Initial failure is an unavailable state.
      if (!stopped && pending === request && !titleExpiresAt) onTitle(UNAVAILABLE_TITLE);
    } finally {
      clearTimeout(deadline);
      if (pending === request) {
        pending = undefined;
        if (!stopped && !document.hidden) timer = setTimeout(poll, interval);
      }
    }
  };
  const pause = () => {
    clearTimeout(timer);
    pending?.abort();
    pending = undefined;
  };
  const onVisibility = () => {
    expireTitle();
    const nextVisible = !document.hidden;
    if (nextVisible === visible) return;
    visible = nextVisible;
    pause();
    if (visible) void poll();
  };
  document.addEventListener('visibilitychange', onVisibility);
  void poll();
  return () => {
    stopped = true;
    pause();
    clearTimeout(expiryTimer);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
