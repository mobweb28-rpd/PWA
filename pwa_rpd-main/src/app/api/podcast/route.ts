import { publicFailure, publicJson } from '@/lib/public-api-response';
import { getPublicData } from '@/lib/public-sources/podcast';

export async function GET() {
  try {
    return publicJson(await getPublicData());
  } catch (error) {
    console.error('podcast upstream request failed');
    return publicFailure(error, []);
  }
}
