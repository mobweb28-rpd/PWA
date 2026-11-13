import { NextResponse } from 'next/server';
import { PublicDataUnavailable } from '@/lib/upstream-reliability';

// Prevent browser/CDN error caching or an additional response cache extending
// the maximum age enforced by Data Cache snapshots. Payload shapes are unchanged.
export function publicJson(value: unknown, headers: Record<string, string> = {}) {
  return NextResponse.json(value, { headers: { 'Cache-Control': 'no-store', ...headers } });
}

export function publicFailure(error: unknown, value: unknown) {
  const unavailable = error instanceof PublicDataUnavailable;
  return NextResponse.json(value, {
    status: unavailable ? 503 : 500,
    headers: {
      'Cache-Control': 'no-store',
      'Retry-After': String(unavailable ? error.retryAfterSeconds : 15),
    },
  });
}
