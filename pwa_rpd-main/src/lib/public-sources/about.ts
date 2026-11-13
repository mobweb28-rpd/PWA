// app/api/about/route.ts
import { cachePublic, upstreamText } from '@/lib/upstream-cache';
import * as cheerio from 'cheerio';
import { publicHttpUrl } from '@/lib/public-url';

const ABOUT_PAGE_URL = 'https://radioppidunia.org/about-us/'; // correct URL

const DIRECTORATE_KEY_MAP: Record<string, string> = {
  bod: 'bod',
  Announcer: 'sobat_siar',
  operational: 'operational',
  production: 'produksi',
  communication: 'komunikasi',
  marketing: 'marketing',
  technology: 'technology',
};

const DIVISION_LABEL_MAP: Record<string, string> = {
  hrd: 'HRD',
  program: 'Program',
  BroadCasting: 'Broadcast',
  visdes: 'Visual Design',
  audio: 'Audio',
  video: 'Video',
  event: 'Event',
  public_relations: 'Public Relation',
  community: 'Community Relations',
  research: 'Research',
  social_media: 'Social Media',
  sales: 'Sales & Partnership',
  mobweb: 'Mobile & Web Development',
  technical: 'Technical Division',
  music: 'Music Division',
};

export const getPublicData = cachePublic('about', async () => {
    const html = await upstreamText(ABOUT_PAGE_URL);
    const $ = cheerio.load(html);

    // 1. Extract hero background images from Elementor slideshow
    const aboutBackgrounds = extractBackgroundImages(html) || [];

    // 2. Extract team members from the JSON block
    const members = extractMembers($);
    if (!members.length) throw new Error('Missing team data');
    if (members.some(member => typeof member.name !== 'string' || !member.name.trim())) {
      throw new Error('Invalid team member');
    }

    return ({ members, aboutBackgrounds });
});


/**
 * Parses the Elementor section's data-settings to retrieve
 * the background_slideshow_gallery image URLs.
 */
function extractBackgroundImages(html: string): string[] | null {
  // Match the section element that contains background_slideshow_gallery in its data-settings
  const regex = /<section[^>]+data-settings="([^"]*background_slideshow_gallery[^"]*)"/;
  const match = html.match(regex);
  if (!match) return null;

  // Decode HTML entities (Elementor escapes quotes)
  const settingsStr = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  try {
    const settings = JSON.parse(settingsStr);
    const gallery = settings.background_slideshow_gallery;
    if (!Array.isArray(gallery)) return null;

    // Extract the url of each slide
    const urls = gallery.map((item: { url?: unknown }) => publicHttpUrl(item.url, ABOUT_PAGE_URL)).filter(Boolean);
    return urls.length ? urls : null;
  } catch (e) {
    console.error('Failed to parse slideshow settings:', e);
    return null;
  }
}

/**
 * Looks for <script type="application/json" id="rpd-team-data"> and
 * parses the JSON inside it to build the members array.
 */
function extractMembers($: cheerio.CheerioAPI): any[] {
  const jsonBlock = $('#rpd-team-data');
  if (jsonBlock.length === 0) {
    console.warn('No #rpd-team-data block found on the page');
    return [];
  }

  const rawJson = (jsonBlock.html() || '').trim();
  if (!rawJson) {
    console.warn('#rpd-team-data block is empty');
    return [];
  }

  try {
    const teamData = JSON.parse(rawJson);
    return mapTeamDataToMembers(teamData);
  } catch (e) {
    console.error('Failed to parse JSON from #rpd-team-data:', e);
    return [];
  }
}

function mapTeamDataToMembers(teamData: any): any[] {
  const members: any[] = [];
  let memberId = 0;

  Object.keys(teamData).forEach((wpDirKey) => {
    const frontendDirKey = DIRECTORATE_KEY_MAP[wpDirKey];
    if (!frontendDirKey) return;

    const directorate = teamData[wpDirKey];

    if (Array.isArray(directorate.members)) {
      directorate.members.forEach((m: any) => {
        members.push({
          id: memberId++,
          name: m.name,
          directorate: frontendDirKey,
          division: null,
          position: m.position,
          bio: m.bio || '',
          photo_url: publicHttpUrl(m.image, ABOUT_PAGE_URL),
          instagram_url: publicHttpUrl(m.instagram),
        });
      });
    }

    if (directorate.divisions) {
      Object.keys(directorate.divisions).forEach((wpDivKey) => {
        const division = directorate.divisions[wpDivKey];
        const frontendDivLabel = DIVISION_LABEL_MAP[wpDivKey];
        if (!frontendDivLabel) return;

        if (Array.isArray(division.members)) {
          division.members.forEach((m: any) => {
            members.push({
              id: memberId++,
              name: m.name,
              directorate: frontendDirKey,
              division: frontendDivLabel,
              position: m.position,
              bio: m.bio || '',
              photo_url: publicHttpUrl(m.image, ABOUT_PAGE_URL),
              instagram_url: publicHttpUrl(m.instagram),
            });
          });
        }
      });
    }
  });

  return members;
}
