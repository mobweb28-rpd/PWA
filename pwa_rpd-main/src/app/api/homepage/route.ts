import { publicFailure, publicJson } from '@/lib/public-api-response';
import { getPublicData } from '@/lib/public-sources/homepage';

export async function GET() {
  try {
    return publicJson(await getPublicData());
  } catch (error) {
    console.error('homepage upstream request failed');
    return publicFailure(error, { error: "Failed to retrieve homepage data" });
  }
}
