import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp, installCacheBackend } from './helpers/app-loader.mjs';
async function loadRoute(name, fetch) {
  installCacheBackend();
  return createApp(fetch).route(name);
}

test('homepage error responses never expose upstream exception details', async () => {
  const route = await loadRoute('homepage', async () => { throw new Error('private-upstream-diagnostic'); });
  const response = await route.GET();
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'Failed to retrieve homepage data');
});

test('upstream member links cannot inject executable URLs', async () => {
  const html = '<script type="application/json" id="rpd-team-data">{"Announcer":{"members":[{"name":"Safe name","image":"data:image/svg+xml,bad","instagram":"javascript:alert(1)"}]}}</script>';
  const route = await loadRoute('about', async () => new Response(html));
  const { members } = await (await route.GET()).json();
  assert.equal(members.length, 1);
  assert.equal(members[0].instagram_url, '');
  assert.equal(members[0].photo_url, '');
});

test('podcast scraper rejects executable media URLs while retaining valid audio', async () => {
  const html = '<div class="swp_music_player_entry" data-mediafile="javascript:alert(1)"></div><div class="swp_music_player_entry" data-mediafile="/valid.mp3"><span class="player_song_name">Safe episode</span></div>';
  const route = await loadRoute('podcast', async () => new Response(html));
  const data = await (await route.GET()).json();
  assert.equal(data.length, 1);
  assert.equal(data[0].audio_url, 'https://radioppidunia.org/valid.mp3');
});
