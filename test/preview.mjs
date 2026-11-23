#!/usr/bin/env node
// Proves the preview-city and search.json paths with made-up feeds, so they are
// tested before a real proving city exists. Builds into a temporary folder.
// docs/ is never touched.
//   node test/preview.mjs            run the tests
//   node test/preview.mjs --keep     also print the folder of the first build and leave it there
import {execFileSync} from 'node:child_process';
import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtures = fileURLToPath(new URL('./fixtures/data/', import.meta.url));
const keep = process.argv.includes('--keep');
const work = await mkdtemp(join(tmpdir(), 'dig-preview-'));
const problems = [];
const expect = (condition, message) => {
  if (!condition) problems.push(message);
};

// Builds the site from a folder of feeds and runs the full site check on it.
async function build(name, change) {
  const data = join(work, name + '-data');
  const out = join(work, name + '-site');
  await cp(fixtures, data, {recursive: true});
  if (change) await change(data);
  const env = {...process.env, DIG_DATA_BASE: pathToFileURL(data).href, DIG_OUT: out, DIG_OFFLINE: '1',
    DIG_NOW: '2026-11-20T18:00:00Z', SITE_URL: 'https://example.test/dig'};
  const log = execFileSync('node', ['build.mjs'], {cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  execFileSync('node', ['test/check.mjs'], {cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  const read = file => readFile(join(out, file), 'utf8');
  const holder = {exports: {}};
  new Function('module', await read('assets/search.js'))(holder);
  const data_ = JSON.parse(await read('search/data.json'));
  const search = holder.exports;
  const prepared = search.prepare(data_);
  return {out, log, read, search, summary: JSON.parse(await read('build.json')), data: data_,
    find: (query, categories = [], favorites = null, filters) => search.find(prepared, query, categories, favorites, filters).map(sale => sale.id)};
}

const banner = 'Preview — still proving itself';
try {
  // 1. An index with statuses, a proving city with a feed, and search.json published.
  const site = await build('statuses');
  const {summary, data} = site;
  expect(summary.cities.map(city => `${city.slug}:${city.status}`).join() === 'rivertown:live,lakeside:proving',
    'Expected Rivertown live and Lakeside proving, in that order');
  expect(summary.defaultCity === 'rivertown', 'The home page city should be the live default city');
  const off = Object.fromEntries(summary.offSite.map(city => [city.slug, city.reason]));
  expect(off.hilltop === 'no feed yet', 'A proving city without a feed should be left off the site');
  expect(/does not read cleanly/.test(off.brokenville ?? ''), 'A proving city with a broken feed should be left off the site, not stop the build');
  expect(/neither live nor proving/.test(off.oldport ?? ''), 'A city with an unknown status should be left off the site');

  const cityPage = await site.read('lakeside/index.html');
  expect(cityPage.includes(banner) && cityPage.includes('id="map"') && cityPage.includes('id="sale-count"'),
    'The preview city page should be a full city page with the banner');
  expect((await site.read('lakeside/this-weekend/index.html')).includes(banner), 'The preview weekend page should carry the banner');
  expect((await site.read('sale/bbbb000000000001/index.html')).includes(banner), 'A proving-city sale page should carry the banner');
  expect(!(await site.read('rivertown/index.html')).includes(banner), 'A live city page must not carry the banner');
  const shared = await site.read('sale/aaaa0000000000ff/index.html');
  expect(!shared.includes(banner) && shared.includes('/dig/rivertown/'), 'A sale a live and a proving city share belongs to the live city');
  expect(!existsSync(join(site.out, 'hilltop')) && !existsSync(join(site.out, 'brokenville')) && !existsSync(join(site.out, 'oldport')),
    'Cities left off the site must have no pages');

  const map = JSON.parse((await site.read('map/index.html')).match(/id="map-data">([^<]*)<\/script>/)[1]);
  const mapCity = slug => map.cities.find(city => city.slug === slug);
  expect(mapCity('lakeside').total === 2 && mapCity('lakeside').pins.length === 1,
    'A missing longitude should leave the sale in the city total without generating a pin');
  expect(mapCity('rivertown').pins.some(pin => pin.rating === 'Unrated' && pin.approx),
    'An unrated, approximately located sale should keep both attributes on its pin');
  expect(mapCity('hilltop')?.total === null && mapCity('brokenville')?.total === null && !mapCity('oldport'),
    'The switcher should retain indexed Preview cities with unavailable feeds and omit retired cities');

  const regions = await site.read('regions/index.html');
  expect(/data-region="lakeside" data-status="proving" data-count="2"/.test(regions), 'Regions should list Lakeside as proving with 2 sales');
  expect(regions.includes('2 clean collection runs so far'), 'Regions should show the clean runs the index states');
  expect(!regions.includes('id="no-preview"'), 'Regions should not say there is no preview city');
  expect(!/Hilltop|Brokenville|Oldport/.test(regions), 'Regions must not name a city that has no pages');
  expect(/data-region="lakeside" data-status="proving" data-count="2"/.test(await site.read('index.html')), 'The home strip should list Lakeside as proving');

  expect(data.sales.length === 4 && summary.salePages === 4, 'Expected four sale pages and four search records');
  const record = id => data.sales.find(sale => sale.id === id);
  expect(record('bbbb000000000001')?.city === 'lakeside', 'The Lakeside sale should be searchable under Lakeside');
  expect(record('aaaa000000000001')?.categories.join() === 'tools,vinyl-records,toys-games', 'search.json labels should map onto the chips');
  expect(record('bbbb000000000001')?.categories.join() === 'collectibles' && record('bbbb000000000001')?.tags?.join() === 'Clocks',
    'A search.json label that is not a chip should be kept as a plain label');
  expect(record('aaaa0000000000ff')?.categories.length === 0, 'An empty category list in search.json should be respected');
  expect(record('aaaa000000000002')?.categories.length === 0, 'A sale search.json leaves out falls back to its title');
  expect(!record('dddd000000000009'), 'A search.json sale with no page must not become a search result');
  expect(summary.search.combinedFeedPublished === true && summary.search.categoriesFromCombinedFeed === 3 && summary.search.categoriesFromTitles === 1,
    'build.json should say which categories came from search.json');
  expect(site.find('fishing').join() === 'bbbb000000000001', 'A keyword should find the proving-city sale');
  expect(site.find('clocks').join() === 'bbbb000000000001', 'A keyword should match a category label');
  expect(site.find('fixture').length === 4, 'A keyword should match companies across cities');
  expect(site.find('', ['tools']).join() === 'aaaa000000000001', 'A chip should return the sales in that category');
  expect(site.find('border', ['tools']).length === 0, 'A keyword and a chip must both match');
  const search = await site.read('search/index.html');
  expect(/<section class="search-group"[^>]*data-city="lakeside" data-status="proving"[\s\S]*?tag-preview/.test(search), 'Search should label the Lakeside group Preview');
  expect(search.includes('combined search feed'), 'Search should say categories come from the combined feed');

  // Include the weekend already in progress. Roll forward at Chicago midnight on Monday.
  const weekend = ['2026-11-21', '2026-11-22'];
  for (const instant of ['2026-11-20T12:00:00Z', '2026-11-21T20:00:00Z', '2026-11-23T05:59:59Z']) {
    expect(site.search.chicagoWeekend(new Date(instant)).join() === weekend.join(), 'Wrong Chicago weekend at ' + instant);
  }
  expect(site.search.chicagoWeekend(new Date('2026-11-23T06:00:00Z')).join() === '2026-11-28,2026-11-29',
    'The weekend should roll forward at midnight Monday in Chicago');
  expect(site.search.chicagoWeekend(new Date('2026-03-09T04:59:59Z')).join() === '2026-03-07,2026-03-08',
    'The Sunday of the daylight-saving change should stay in the current weekend');
  const ratings = ['Deep Dig', 'Slim Pickings'];
  expect(site.find('', [], null, {ratings}).length === 2, 'A sale with either selected rating should match');
  expect(site.find('fixture', ['tools'], null, {city: 'rivertown', ratings, weekend, hasPhotos: true}).join() === 'aaaa000000000001',
    'City, ratings, photos and weekend should combine with keyword and category');
  expect(site.find('', [], null, {city: 'lakeside', ratings, weekend}).join() === 'bbbb000000000001',
    'The preview sale should match the rating from the combined search feed');
  expect(site.find('', [], null, {city: 'lakeside', hasPhotos: true}).length === 0,
    'An explicit photoCount of zero in the combined feed should exclude the sale');
  const gap = site.search.prepare({sales: [{id: 'gap', first: '2026-11-20', last: '2026-11-23', dates: ['2026-11-20', '2026-11-23']}]});
  expect(site.search.find(gap, '', [], null, {weekend}).length === 0,
    'A sale that skips both weekend days should not match even when its date range spans the weekend');

  // Phase 9 per-sale features: fully enriched, partly enriched, and plain sales.
  const enriched = await site.read('sale/aaaa000000000001/index.html');
  expect(enriched.includes('id="dig-rating"') && enriched.includes('Deep Dig') && enriched.includes('38 photos') && enriched.includes('runs 2 days'),
    'The enriched sale page should show the rating badge with its reasons');
  expect(enriched.includes('Porcelain figurines, workshop tools and vinyl records.') && enriched.includes('class="keyword">figurines<'),
    'The enriched sale page should show the contents line and keyword chips');
  expect(enriched.includes('38 photos at the source') && enriched.includes('https://example.com/listing/1') && !/<img[^>]*example\.com/.test(enriched),
    'The photo count should link to the source without republishing photos');
  expect(enriched.includes('href="tel:+15550101234"') && enriched.includes('Call Test Fixture Sales Co') && enriched.includes('https://example.com/company/test-fixture'),
    'Call and Company page buttons should appear when the feed carries contact fields');
  expect(enriched.includes('google.com/maps/dir/?api=1') && enriched.includes('1%20Example%20Street'),
    'Directions should use the full street address when the feed has it');
  expect(enriched.includes('data-fav="aaaa000000000001"'), 'The sale page should carry a favorite heart');
  const dayOne = await site.read('sale/aaaa000000000001/2026-11-21.ics');
  const unfoldedDay = dayOne.replace(/\r\n /g, '');
  expect(unfoldedDay.includes('BEGIN:VEVENT') && unfoldedDay.includes('DTSTART:20261121T150000Z') && unfoldedDay.includes('DTEND:20261121T210000Z'),
    'The calendar file should carry the session hours for that day (9 AM–3 PM Central)');
  expect(unfoldedDay.includes('1 Example Street') && unfoldedDay.includes('https://example.com/listing/1') && unfoldedDay.includes('Porcelain figurines'),
    'The calendar file should carry the address, the source link and the contents line');
  expect(existsSync(join(site.out, 'sale/aaaa000000000001/2026-11-22.ics')), 'Each sale day gets its own calendar file');

  const partial = await site.read('sale/bbbb000000000001/index.html');
  expect(partial.includes('Worth a Look') && partial.includes('Antique clocks and fishing gear.') && partial.includes('12 photos at the source'),
    'A partly enriched sale should show the fields it has');
  expect(!partial.includes('id="contact-company"'), 'Contact buttons stay hidden when the feed has no contact fields');

  const plainSale = await site.read('sale/aaaa000000000002/index.html');
  expect(!plainSale.includes('id="dig-rating"') && !plainSale.includes('id="whats-there"') && !plainSale.includes('id="contact-company"'),
    'A sale without the new fields should render none of the new sections');
  expect(plainSale.includes('Address releases Thursday 9:00 AM') && plainSale.includes('Rivertown, TX 70002'),
    'A held address should show city + ZIP and the weekday it releases (day before Friday Nov 27)');
  expect(plainSale.includes('google.com/maps/dir/?api=1') && !plainSale.includes('Example%20Street'),
    'Directions for a held address go to the published city and ZIP, not a guessed street');
  expect(record('aaaa000000000001')?.keywords?.join() === 'figurines,brass lamps,vinyl records' && record('aaaa000000000001')?.digRating === 'Deep Dig',
    'Search data should carry keywords and the rating when the feed has them');
  expect(record('aaaa000000000002')?.keywords === undefined && record('aaaa000000000002')?.contentsLine === undefined,
    'Search data should omit the new fields when the feed does not have them');
  expect(site.find('brass').join() === 'aaaa000000000001', 'A word only in photoKeywords should find the sale');
  expect(site.find('porcelain').join() === 'aaaa000000000001', 'A word only in the contents line should find the sale');
  expect(site.find('', [], ['bbbb000000000001']).join() === 'bbbb000000000001', 'The favorites filter should return only favorites');
  expect(site.find('', [], []).length === 0, 'The favorites filter with no favorites returns nothing');
  expect(summary.enriched.withRating === 2 && summary.enriched.withKeywords === 2 && summary.enriched.withContact === 1 && summary.enriched.withPhotoCount === 2,
    'build.json should count the sales carrying each new field');
  expect(summary.enriched.calendarFiles === 5, 'build.json should count one calendar file per sale day (2 + 1 + 1 + 1)');
  expect(search.includes('id="fav-only"'), 'Search should offer the Favorites-only filter');
  expect((await site.read('rivertown/index.html')).includes('data-fav="aaaa000000000001"'), 'City cards should carry favorite hearts');

  const card = await site.read('agents.txt');
  expect(/### Proving \(preview\)\n- Lakeside \(preview, still proving itself\)/.test(card), 'agents.txt should list Lakeside as proving');
  expect(card.includes('search.json\n  Published.'), 'agents.txt should say search.json is published');
  expect(card.includes('The index names 3 more cities'), 'agents.txt should count the cities left off the site');
  expect(card === await site.read('llms.txt'), 'agents.txt and llms.txt should match');

  // 2. No search.json: categories come from the listing titles.
  const plain = await build('no-search', data => rm(join(data, 'search.json')));
  expect(plain.summary.search.combinedFeedPublished === false && plain.summary.search.categoriesFromTitles === 4, 'Without search.json every category comes from titles');
  expect(plain.data.sales.find(sale => sale.id === 'aaaa000000000001')?.categories.join() === 'tools,vinyl-records', 'Title words should give tools and vinyl-records');
  expect(plain.data.sales.find(sale => sale.id === 'bbbb000000000001')?.categories.join() === 'collectibles', 'Title words should give collectibles');
  expect((await plain.read('agents.txt')).includes('Not published when this site was built'), 'agents.txt should say search.json is not published');
  expect(plain.find('', ['vinyl-records']).join() === 'aaaa000000000001', 'A chip should work on title-derived categories');

  // 3. A search.json that does not parse must not stop the build.
  const broken = await build('bad-search', data => writeFile(join(data, 'search.json'), '{"sales": "soon"}'));
  expect(broken.summary.search.combinedFeedProblem && broken.summary.search.categoriesFromTitles === 4, 'A bad search.json should fall back to titles');

  // 4. Today's index shape: no status field, "enabled" true or false, "sales" for the count.
  const today = await build('enabled-only', data => writeFile(join(data, 'cities.json'), JSON.stringify({version: 1, defaultCity: 'rivertown', cities: [
    {slug: 'rivertown', name: 'Rivertown', timeZone: 'America/Chicago', enabled: true, feedUrl: pathToFileURL(join(data, 'cities/rivertown/sales.json')).href, sales: 3},
    {slug: 'lakeside', name: 'Lakeside', timeZone: 'America/Chicago', enabled: false, feedUrl: null, sales: null},
    {slug: 'hilltop', name: 'Hilltop', timeZone: 'America/Chicago', enabled: false, feedUrl: null, sales: null},
  ]})));
  expect(today.summary.cities.map(city => `${city.slug}:${city.status}`).join() === 'rivertown:live,lakeside:proving',
    'A city the index does not enable becomes a preview once its feed exists');
  expect(today.summary.offSite.map(city => city.slug).join() === 'hilltop', 'A city the index does not enable and that has no feed stays off the site');
  expect(today.summary.cities[0].indexCount === 3, 'The index count should be read from "sales" when there is no "count"');

  // 5. No proving feed at all: the regions page says so and nothing carries a banner.
  const alone = await build('live-only', async data => {
    await rm(join(data, 'cities/lakeside'), {recursive: true});
    await rm(join(data, 'cities/brokenville'), {recursive: true});
  });
  expect(alone.summary.cities.length === 1 && alone.summary.offSite.length === 4, 'With no proving feed only the live city has pages');
  expect((await alone.read('regions/index.html')).includes('id="no-preview"'), 'Regions should say no city is in preview');
  expect((await alone.read('agents.txt')).includes('### Proving (preview)\nNone at this build.'), 'agents.txt should say no city is proving');

  if (keep) console.log('First build kept at ' + site.out);
} catch (error) {
  problems.push((error.stderr || error.stdout || error.message).toString().trim());
}

if (!keep) await rm(work, {recursive: true, force: true});
if (problems.length) {
  console.error(`Preview test FAILED (${problems.length}):`);
  for (const problem of problems) console.error('  ' + problem);
  process.exit(1);
}
console.log('Preview test passed: proving city pages with the banner, cities without a feed left off, search across both cities, search.json switch-over, today\'s index shape.');
