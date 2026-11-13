import { publicFailure, publicJson } from '@/lib/public-api-response';
import { getPublicData } from '@/lib/public-sources/homepage';

export async function GET() {
  try {
    const { settings, banners } = await getPublicData();
    return publicJson({
      what_is_on_tagline: settings.what_is_on_tagline,
      what_is_on_date: settings.what_is_on_date,
      regularBanners: banners.filter(b => b.section === 'regular').map(b => ({ image_url: b.image_url, alt: 'Siaran Reguler' })),
      specialBanners: banners.filter(b => b.section === 'special').map(b => ({ image_url: b.image_url, alt: 'Siaran Spesial' })),
    });
  } catch (error) {
    console.error('Program upstream request failed');
    return publicFailure(error, { what_is_on_tagline: '', what_is_on_date: '', regularBanners: [], specialBanners: [] });
  }
}
