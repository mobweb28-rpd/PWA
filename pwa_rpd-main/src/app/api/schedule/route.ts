import { publicFailure, publicJson } from '@/lib/public-api-response';
import { getPublicData } from '@/lib/public-sources/schedule';

export async function GET() {
  try {
    return publicJson(await getPublicData());
  } catch (error) {
    console.error('schedule upstream request failed');
    return publicFailure(error, []);
  }
}
