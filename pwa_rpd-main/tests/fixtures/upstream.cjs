// Synthetic content and the existing local icon; no live services/user data.
const homepage = `<!doctype html>
<div data-id="09766a8"><h2 class="elementor-heading-title">Fixture tagline</h2></div>
<div data-id="8d7ed90"><h2 class="elementor-heading-title">- Oktober 2026 -</h2></div>
<div data-id="bd1e03e"><h2 class="elementor-heading-title">Fixture Announcer - Indonesia</h2></div>
<div data-id="4e43c38"><img src="https://radioppidunia.org/fixture.png"></div>
<div class="eael-image-accordion-item" style="background-image:url('https://radioppidunia.org/fixture.png')">
 <div class="overlay-inner"><b>Fixture song</b><p>Fixture artist</p></div>
</div>
<div data-id="ba48b9a"><div class="n2-ss-slide-background-image"><img src="https://radioppidunia.org/fixture.png"></div></div>
<div data-id="30480b7"><div class="n2-ss-slide-background-image"><img src="https://radioppidunia.org/fixture.png"></div></div>`;
const team = { Announcer: { members: [{ name: 'Fixture Member', position: 'Announcer', image: 'https://radioppidunia.org/fixture.png', bio: 'Fixture biography', instagram: 'https://instagram.com/radioppidunia' }] } };
const about = `<section data-settings="{&quot;background_slideshow_gallery&quot;:[{&quot;url&quot;:&quot;https://radioppidunia.org/fixture.png&quot;}]}" ></section><script type="application/json" id="rpd-team-data">${JSON.stringify(team)}</script>`;
const podcast = `<div class="swp_music_player_entry" data-mediafile="https://radioppidunia.org/fixture.wav"><span class="player_song_name" data-albumname="Siaran Spesial 2025">Fixture Podcast</span></div>`;
const schedule = ',,,,,,,\nFixture Schedule,,,,,,,\nTANGGAL,12/10/2026,13/10/2026,14/10/2026,15/10/2026,16/10/2026,17/10/2026,18/10/2026\nWIB,SENIN,SELASA,RABU,KAMIS,JUMAT,SABTU,MINGGU\n10:00,Fixture show,,,,,,\n';
const png = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../public/rpd-icon-192.png'));
const wav = Buffer.alloc(44 + 16000);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
module.exports = { homepage, about, podcast, schedule, png, wav };
