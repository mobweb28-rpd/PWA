import { publicFailure, publicJson } from '@/lib/public-api-response';
import { getPublicData } from '@/lib/public-sources/about';

export async function GET() {
  try {
    return publicJson(await getPublicData());
  } catch (error) {
    console.error('about upstream request failed');
    return publicFailure(error, { members: [], aboutBackgrounds: [] });
  }
}
