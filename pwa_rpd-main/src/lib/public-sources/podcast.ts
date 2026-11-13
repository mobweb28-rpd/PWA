// app/api/podcast/route.ts
import { cachePublic, upstreamText } from '@/lib/upstream-cache';
import * as cheerio from 'cheerio';
import { publicHttpUrl } from '@/lib/public-url';

const PODCAST_PAGE_URL = 'https://radioppidunia.org/rpd-podcast-podcast/';

export const getPublicData = cachePublic('podcast', async () => {
    const html = await upstreamText(PODCAST_PAGE_URL);
    const $ = cheerio.load(html);

    const podcasts: any[] = [];
    const entries = $('.swp_music_player_entry');

    entries.each((i, el) => {
      const audioUrl = publicHttpUrl($(el).attr('data-mediafile'), PODCAST_PAGE_URL);
      if (!audioUrl) return; // skip if no audio

      const title = $(el).find('.player_song_name').text().trim();
      const album = $(el).find('.player_song_name').attr('data-albumname')?.trim() || 'Siaran Spesial 2025';

      podcasts.push({
        id: `podcast-${i + 1}`,
        title: title || 'Untitled',
        subtitle: album,
        audio_url: audioUrl,
        category: 'Siaran Spesial 2025', // matches frontend filter
        duration: null, // can be calculated later if needed
        image_url: null, // none available in the player
        created_at: new Date().toISOString(),
      });
    });

    if (!podcasts.length) throw new Error('Missing podcast data');
    return (podcasts);
});
