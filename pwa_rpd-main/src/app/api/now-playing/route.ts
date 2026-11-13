import { publicJson } from '@/lib/public-api-response';
import { getPublicData } from '@/lib/public-sources/now-playing';
import { PUBLIC_MAX_AGES } from '@/lib/upstream-cache';

export async function GET() {
  try {
    const { value, validatedAt } = await getPublicData.snapshot();
    return publicJson(value, {
      'X-RPD-Valid-Until': String(validatedAt + PUBLIC_MAX_AGES['now-playing'] * 1000),
    });
  } catch {
    console.error('now-playing upstream request failed');
    // A neutral station label is an unavailable state, never invented song data.
    // Retain the public { displayTitle } contract and existing HTTP 200 fallback.
    return publicJson({ displayTitle: 'Radio PPI Dunia Mengudara' }, { 'X-RPD-Valid-Until': '0' });
  }
}
