import { cachePublic, upstreamText } from '@/lib/upstream-cache';
import * as cheerio from 'cheerio';
import { publicHttpUrl } from '@/lib/public-url';

export const getPublicData = cachePublic('homepage', async () => {
    // 1. Fetch live HTML using a real browser User-Agent to bypass security/bot blocks
    const html = await upstreamText('https://radioppidunia.org/');
    const $ = cheerio.load(html);

    // 2. Extract Tagline & Date
    const rawTagline = $('[data-id="09766a8"] .elementor-heading-title').text().trim();
    const rawDate = $('[data-id="8d7ed90"] .elementor-heading-title').text().trim().replace(/-/g, '').trim();

    if (!rawTagline || !rawDate) throw new Error('Missing homepage markers');

    // 3. Extract Sobat Siar
    const rawSsName = $('[data-id="bd1e03e"] .elementor-heading-title').text().trim();
    const nameParts = rawSsName.split('-');
    const featuredMember = {
      name: nameParts[0] ? nameParts[0].trim() : 'Sobat Siar',
      country: nameParts[1] ? nameParts[1].trim() : '',
      quote: "",
      image_url: publicHttpUrl($('[data-id="4e43c38"] img').attr('src'), 'https://radioppidunia.org/')
    };

    // 4. Extract Music Chart (With Modified Artist Parser)
    const musicList = $('.eael-image-accordion-item').map((i, el) => {
      const bgStyle = $(el).attr('style') || '';
      const bgMatch = bgStyle.match(/url\(['"]?(.*?)['"]?\)/);
      const imageUrl = bgMatch ? publicHttpUrl(bgMatch[1], 'https://radioppidunia.org/') || null : null;

      const title = $(el).find('b').text().trim();
      
      // Fine-tuned target for the flattened nested paragraphs containing the artist
      let artist = '';
      $(el).find('.overlay-inner p').each((_, pEl) => {
        const text = $(pEl).text().trim();
        // If the paragraph has text, doesn't contain the bold title, and isn't the title itself
        if (text && $(pEl).find('b').length === 0 && text !== title) {
          artist = text;
        }
      });

      return {
        id: i + 1,
        title: title || "Unknown Title",
        artist: artist || "Unknown Artist",
        image_url: imageUrl,
        spotify_url: null 
      };
    }).get();

    // 5. Extract Banners from the Live DOM
    // Siaran Reguler (data-id="ba48b9a")
    const regularBanners = $('[data-id="ba48b9a"] .n2-ss-slide-background-image img').map((_, el) => {
      const src = publicHttpUrl($(el).attr('src'), 'https://radioppidunia.org/');
      return { image_url: src, section: 'regular' };
    }).get();

    // Siaran Spesial (data-id="30480b7")
    const specialBanners = $('[data-id="30480b7"] .n2-ss-slide-background-image img').map((_, el) => {
      const src = publicHttpUrl($(el).attr('src'), 'https://radioppidunia.org/');
      return { image_url: src, section: 'special' };
    }).get();

    const banners = [...regularBanners, ...specialBanners];

    // 6. Send structural payload to the frontend
    return ({
      settings: {
        hero_title_1: "Suara Anak Bangsa",
        hero_title_2: "Satu Cinta",
        hero_title_3: "Satu Indonesia",
        description_24h: "24 jam mengudara dengan berbagai program menarik, inovatif, dan informatif",
        what_is_on_tagline: rawTagline,
        what_is_on_date: rawDate
      },
      featuredMember,
      musicList,
      banners 
    });

});
