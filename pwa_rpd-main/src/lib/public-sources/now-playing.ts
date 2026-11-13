import { cachePublic, upstreamText } from '@/lib/upstream-cache';

export const getPublicData = cachePublic('now-playing', async () => {
    // Public VosCast display identifier (not an administrator credential).
    // A server-only override supports a future provider identifier change.
    const VOSCAST_KEY = process.env.VOSCAST_STATS_KEY || "31b8dac67aae02545f7e5a44e2f8ec7c";
    
    // Fetch both the Server Title (Live DJs) and the Song Title (AutoDJ)
    const [serverResult, songResult] = await Promise.allSettled([
      upstreamText(`https://cdn.voscast.com/stats/display.js?key=${VOSCAST_KEY}&stats=servertitle`, 3000),
      upstreamText(`https://cdn.voscast.com/stats/display.js?key=${VOSCAST_KEY}&stats=songtitle`, 3000)
    ]);
    // Both bounded reads settle before the refresh finishes or fails. A faster
    // failing endpoint must not leave its sibling retry running after cooldown.
    if (serverResult.status === 'rejected') throw serverResult.reason;
    if (songResult.status === 'rejected') throw songResult.reason;
    const serverJs = serverResult.value;
    const songJs = songResult.value;

    const extractText = (jsString: string) => {
      const match = jsString.match(/document\.write\('(.*?)'\);/);
      if (!match) throw new Error("Invalid VosCast response");
      return match[1].trim();
    };

    const serverTitle = extractText(serverJs);
    const songTitle = extractText(songJs);
    if (!serverTitle && !songTitle) throw new Error('Empty VosCast metadata');

    let displayTitle = "Radio PPI Dunia Mengudara";

    if (serverTitle && (serverTitle.includes("SS ") || serverTitle.includes("SK ") || serverTitle.includes("||"))) {
      displayTitle = serverTitle;
    } else if (songTitle && songTitle.length > 0) {
      displayTitle = songTitle;
    } else if (serverTitle && serverTitle !== "Unnamed Server") {
      displayTitle = serverTitle;
    }

    // THE CLEANUP PHASE
    displayTitle = displayTitle
      // 1. Unescape HTML entities
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      // 2. THIS IS THE MAGIC LINE: Strip out ANY HTML tags (like <div id="..."> or </div>)
      .replace(/<[^>]+>/g, '')
      .trim();

    if (!displayTitle) throw new Error("Empty VosCast title");
    return ({ displayTitle });

});
