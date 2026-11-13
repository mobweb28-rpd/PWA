// app/api/schedule/route.ts
import { cachePublic, upstreamText } from '@/lib/upstream-cache';

const CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vTxKSa--ORUHF-9kdX9FvpsHz1khW3CVwufT7DQnm8gLUFWYfiYVRJ_Y1Wme26Na6wiGQx5IBfngpfq/pub?gid=807863960&single=true&output=csv';

export const getPublicData = cachePublic('schedule', async () => {
    const csv = await upstreamText(CSV_URL);

    // Split into rows and clean cells
    const rows = csv
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line =>
        line.split(',').map(cell => cell.trim().replace(/^"(.*)"$/, '$1'))
      );

    // Ensure we have at least one header row
    if (rows.length < 4 || rows[3].length < 2 || !rows[3][0].includes('WIB') || /<\/?(?:html|body|script)/i.test(csv)) throw new Error('Invalid schedule data');

    return (rows);
});
