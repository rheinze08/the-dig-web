#!/usr/bin/env node
// Checks the generated site in docs/ before it is published. Exits 1 on any problem.
//   node test/check.mjs
//   DIG_OUT=/some/folder node test/check.mjs    check a test build instead
import {readdir, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const docs = process.env.DIG_OUT ? pathToFileURL(resolve(process.env.DIG_OUT) + '/') : new URL('../docs/', import.meta.url);
const problems = [];
const fail = message => problems.push(message);

async function walk(dir, found = []) {
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) await walk(url, found);
    else found.push(url.href.slice(docs.href.length));
  }
  return found;
}

const summary = JSON.parse(await readFile(new URL('build.json', docs), 'utf8'));
const siteUrl = new URL(summary.site + '/');
const base = siteUrl.pathname.replace(/\/+$/, '');
const all = new Set(await walk(docs));
const htmlFiles = [...all].filter(file => file.endsWith('.html'));
const read = file => readFile(new URL(file, docs), 'utf8');

// A site path ("/the-dig-web/houston/") to the file that serves it.
function fileFor(path) {
  if (!path.startsWith(base + '/') && path !== base) return null;
  const local = decodeURIComponent(path.slice(base.length + 1).split(/[?#]/)[0]);
  return local === '' || local.endsWith('/') ? local + 'index.html' : local;
}

const attribute = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;
const unescape = text => text.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const pagesWithCanonical = new Map();
const events = new Map();

for (const file of htmlFiles) {
  const html = await read(file);
  const where = '/' + file;
  if (/\bundefined\b|\bNaN\b|\[object Object\]|Invalid Date/.test(html.replace(/<script[\s\S]*?<\/script>/g, ''))) {
    fail(`${where}: page text contains a leaked value (undefined, NaN, [object Object] or Invalid Date)`);
  }
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
  const description = attribute(html.match(/<meta name="description"[^>]*>/)?.[0] ?? '', 'content') ?? '';
  if (title.length < 15 || !title.includes('The Dig')) fail(`${where}: weak or missing <title>`);
  if (description.length < 50) fail(`${where}: weak or missing meta description`);
  for (const property of ['og:title', 'og:description', 'og:url', 'og:image', 'og:site_name', 'og:type']) {
    if (!html.includes(`<meta property="${property}" content="`)) fail(`${where}: missing ${property}`);
  }
  if ((html.match(/<h1[\s>]/g) ?? []).length !== 1) fail(`${where}: expected exactly one <h1>`);
  const canonical = attribute(html.match(/<link rel="canonical"[^>]*>/)?.[0] ?? '', 'href');
  if (canonical) pagesWithCanonical.set(canonical, file);
  else if (file !== '404.html') fail(`${where}: no canonical link`);

  // Every page links to the main browsing tools.
  for (const [name, part] of [['header', html.match(/<header class="mast">[\s\S]*?<\/header>/)?.[0] ?? ''], ['footer', html.match(/<footer class="foot">[\s\S]*?<\/footer>/)?.[0] ?? '']]) {
    for (const target of ['/regions/', '/map/', '/search/']) {
      if (!part.includes(`href="${base}${target}"`)) fail(`${where}: the ${name} does not link ${target}`);
    }
  }

  // Every internal link, script, style and image must resolve to a generated file.
  for (const tag of html.match(/<(?:a|link|script|img)\b[^>]*>/g) ?? []) {
    const target = attribute(tag, 'href') ?? attribute(tag, 'src');
    if (!target) continue;
    const link = unescape(target);
    if (/^(mailto:|tel:|#)/.test(link)) continue;
    // Feed links are file: addresses only when a test points the build at local feeds.
    if (link.startsWith('file:') && summary.cities.some(city => city.feedUrl.startsWith('file:'))) continue;
    if (/^https?:\/\//.test(link)) {
      if (!link.startsWith(siteUrl.origin + base + '/')) continue;
      const local = fileFor(new URL(link).pathname);
      if (!local || !all.has(local)) fail(`${where}: link to missing page ${link}`);
      continue;
    }
    if (!link.startsWith('/')) {
      fail(`${where}: relative link ${link} (links must start with the site path)`);
      continue;
    }
    const local = fileFor(link);
    if (!local) fail(`${where}: link ${link} leaves the site path ${base || '/'}`);
    else if (!all.has(local)) fail(`${where}: link to missing file ${link}`);
  }

  for (const block of html.match(/<script type="application\/(?:ld\+)?json"[^>]*>[\s\S]*?<\/script>/g) ?? []) {
    try {
      const data = JSON.parse(block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''));
      if (data['@type'] === 'Event') events.set(file, data);
    } catch (error) {
      fail(`${where}: embedded JSON does not parse (${error.message})`);
    }
  }
}

// City pages: the count shown must equal the feed count and the cards listed.
const cardCount = html => (html.match(/<li class="sale[ "]/g) ?? []).length;
const mapData = html => JSON.parse(html.match(/<script type="application\/json" id="map-data">([^<]*)<\/script>/)?.[1] ?? 'null');
const atlas = all.has('map/index.html') && mapData(await read('map/index.html'));
const expectedDefault = atlas?.cities?.some(city => city.slug === 'houston') ? 'houston' : summary.defaultCity;
if (atlas?.defaultCity !== expectedDefault) fail(`/map/: expected default city ${expectedDefault}`);
for (const city of summary.cities) {
  const mapped = atlas?.cities?.find(item => item.slug === city.slug);
  if (mapped?.total !== city.sales || mapped?.preview !== (city.status !== 'live')) fail(`/map/: wrong count or status for ${city.name}`);
  for (const file of [`${city.slug}/index.html`, ...(city.slug === summary.defaultCity ? ['index.html'] : [])]) {
    if (!all.has(file)) {
      fail(`/${file}: missing`);
      continue;
    }
    const html = await read(file);
    const shown = Number(html.match(/id="sale-count"[^>]*data-sale-count="(\d+)"/)?.[1]);
    const visible = Number(html.match(/id="sale-count"[^>]*><strong>(\d+)<\/strong>/)?.[1]);
    if (shown !== city.sales || visible !== city.sales) fail(`/${file}: shows ${visible} sales, the feed has ${city.sales}`);
    if (cardCount(html) !== city.sales) fail(`/${file}: lists ${cardCount(html)} sale cards, the feed has ${city.sales}`);
    if ((html.match(/data-fav="/g) ?? []).length !== city.sales) fail(`/${file}: every sale card needs a favorite heart`);
    if ((html.match(/google\.com\/maps\/dir\//g) ?? []).length !== city.sales) fail(`/${file}: every sale card needs a Directions link`);
    if (!html.includes('id="map"') || !html.includes('id="map-data"')) fail(`/${file}: no map`);
    if (!html.includes(`href="${base}/map/?city=${city.slug}"`)) fail(`/${file}: missing the link to this city's map`);
    if (mapped && file === `${city.slug}/index.html`) {
      const cityPins = new Map(mapData(html).pins.map(pin => [pin.id, pin]));
      for (const pin of mapped.pins) {
        const local = cityPins.get(pin.id);
        if (!local || local.lat !== pin.lat || local.lng !== pin.lng || local.approx !== pin.approx
          || !pin.rating || !pin.when || !pin.title || pin.url !== `${base}/sale/${pin.id}/` || !all.has(fileFor(pin.url))) {
          fail(`/map/: ${city.name} pin ${pin.id} has invalid coordinates, label or sale link`);
        }
        cityPins.delete(pin.id);
      }
      if (cityPins.size) fail(`/map/: missing ${cityPins.size} pins from the ${city.name} city page`);
    }
  }
  const weekendFile = `${city.slug}/this-weekend/index.html`;
  if (!all.has(weekendFile)) fail(`/${weekendFile}: missing`);
  else {
    const html = await read(weekendFile);
    const shown = Number(html.match(/data-weekend-count="(\d+)"/)?.[1]);
    if (shown !== city.weekendSales || cardCount(html) !== city.weekendSales) {
      fail(`/${weekendFile}: shows ${shown} and lists ${cardCount(html)} sales, expected ${city.weekendSales}`);
    }
  }
}

// Sale pages: one per sale, each with Event data that carries real dates.
const saleFiles = htmlFiles.filter(file => file.startsWith('sale/'));
const sessionDaysByPage = new Map();
let ratedSalePages = 0;
if (saleFiles.length !== summary.salePages) fail(`Found ${saleFiles.length} sale pages, expected ${summary.salePages}`);
for (const file of saleFiles) {
  const event = events.get(file);
  const html = await read(file);
  if (html.includes('id="dig-rating"')) ratedSalePages++;
  if (!event) {
    fail(`/${file}: no Event structured data`);
    continue;
  }
  const dated = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:00[+-]\d{2}:\d{2})?$/.test(value)
    && !Number.isNaN(new Date(value).getTime());
  if (!dated(event.startDate) || !dated(event.endDate)) fail(`/${file}: Event dates are not valid (${event.startDate}, ${event.endDate})`);
  else if (new Date(event.endDate) < new Date(event.startDate.slice(0, 10))) fail(`/${file}: Event ends before it starts`);
  if (!event.name || !event.location?.address) fail(`/${file}: Event lacks a name or a location`);
  for (const part of event.subEvent ?? []) {
    if (!dated(part.startDate) || !dated(part.endDate)) fail(`/${file}: a session in the Event data has invalid dates`);
  }
  if (!/<table class="sessions">/.test(html)) fail(`/${file}: no session table`);
  if (!/class="address/.test(html)) fail(`/${file}: no address line`);
  if (!/rel="noopener external"/.test(html) && !html.includes('does not carry a source link')) fail(`/${file}: no link to the source listing`);
  if (!html.includes('google.com/maps/dir/?api=1&destination=') && !html.includes('google.com/maps/dir/?api=1&amp;destination=')) fail(`/${file}: no Directions link`);
  if (!/data-fav="/.test(html)) fail(`/${file}: no favorite heart`);
  if (html.includes('address-hidden') && !/Address releases (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) 9:00 AM/.test(html)) {
    fail(`/${file}: a held address must say which weekday it releases at 9:00 AM`);
  }
  // One calendar file per session row, each a readable VEVENT for that day.
  const table = html.match(/<table class="sessions">[\s\S]*?<\/table>/)?.[0] ?? '';
  const rows = [...table.matchAll(/data-day="(\d{4}-\d{2}-\d{2})"/g)].map(match => match[1]);
  sessionDaysByPage.set(file, [...new Set(rows)]);
  const icsLinks = [...html.matchAll(new RegExp(`href="${base}/sale/[^"]+/(\\d{4}-\\d{2}-\\d{2})\\.ics"`, 'g'))].map(match => match[1]);
  if (icsLinks.length !== rows.length || rows.some(day => !icsLinks.includes(day))) fail(`/${file}: calendar downloads do not match the session days`);
  for (const day of new Set(icsLinks)) {
    const icsFile = file.replace('index.html', `${day}.ics`);
    if (!all.has(icsFile)) {
      fail(`/${file}: missing calendar file ${icsFile}`);
      continue;
    }
    const ics = await read(icsFile);
    const unfolded = ics.replace(/\r\n /g, '');
    const dtstart = unfolded.match(/DTSTART(?:;VALUE=DATE)?:(\d{8})(?:T\d{6}Z)?/)?.[1];
    const allDay = /DTSTART;VALUE=DATE:/.test(unfolded);
    if (!unfolded.startsWith('BEGIN:VCALENDAR') || !unfolded.includes('BEGIN:VEVENT') || !unfolded.includes('SUMMARY:')
      || !unfolded.includes('LOCATION:') || !unfolded.includes('DESCRIPTION:') || !dtstart
      || (allDay && dtstart !== day.replace(/-/g, ''))
      || !unfolded.includes('/sale/')) fail(`/${icsFile}: not a complete calendar event for ${day}`);
    if (ics.split('\r\n').some(line => new TextEncoder().encode(line).length > 75)) fail(`/${icsFile}: a folded line is longer than 75 octets`);
  }
}

// Regions: every city with pages is listed once, in the right section, with the count the feed gave.
const regionCards = html => [...html.matchAll(/<li[^>]*data-region="([^"]+)" data-status="([^"]+)" data-count="(\d+)"[^>]*>([\s\S]*?)<\/li>/g)]
  .map(match => ({slug: match[1], status: match[2], count: Number(match[3]), html: match[4]}));
const proving = summary.cities.filter(city => city.status !== 'live');
if (!summary.cities.some(city => city.status === 'live')) fail('build.json has no live city');
if (summary.cities[0].status !== 'live') fail('The home page city is not a live city');

if (!all.has('regions/index.html')) fail('/regions/: missing');
else {
  const html = await read('regions/index.html');
  const cards = regionCards(html);
  const liveSection = html.match(/<section class="region-block" id="live"[\s\S]*?<\/section>/)?.[0] ?? '';
  const previewSection = html.match(/<section class="region-block" id="preview"[\s\S]*?<\/section>/)?.[0] ?? '';
  const statesSection = html.match(/<section class="region-block" id="more-states"[\s\S]*?<\/section>/)?.[0] ?? '';
  if (cards.length !== summary.cities.length) fail(`/regions/: lists ${cards.length} cities, the build has pages for ${summary.cities.length}`);
  for (const city of summary.cities) {
    const card = cards.find(item => item.slug === city.slug);
    if (!card) {
      fail(`/regions/: ${city.name} is not listed`);
      continue;
    }
    if (card.count !== city.sales || !card.html.includes(`<b>${city.sales}</b>`)) fail(`/regions/: ${city.name} shows ${card.count} sales, its feed has ${city.sales}`);
    if (card.status !== city.status) fail(`/regions/: ${city.name} is marked ${card.status}, the build read ${city.status}`);
    if (!card.html.includes(`href="${base}/${city.slug}/"`)) fail(`/regions/: ${city.name} does not link its city page`);
    if (card.html.includes('tag-preview') !== (city.status !== 'live')) fail(`/regions/: ${city.name} has the wrong Preview label`);
    if (!(city.status === 'live' ? liveSection : previewSection).includes(`data-region="${city.slug}"`)) fail(`/regions/: ${city.name} is in the wrong section`);
    if (city.status !== 'live' && city.collectedAt && !card.html.includes('collected <time')) fail(`/regions/: ${city.name} does not show when it was collected`);
  }
  if (!proving.length && !previewSection.includes('id="no-preview"')) fail('/regions/: no preview city, but the page does not say so');
  if (!/Texas is first/.test(statesSection) || !/more states are being scouted/.test(statesSection)) fail('/regions/: the "More states coming" statement is missing');
  if (/\d/.test(statesSection.replace(/<[^>]*>/g, ''))) fail('/regions/: "More states coming" must not carry a number');
  // A city with no feed has nothing real to show, so it is not named.
  for (const city of summary.offSite ?? []) {
    if (html.replace(/<head>[\s\S]*?<\/head>/, '').includes(city.name)) fail(`/regions/: names ${city.name}, which has no pages in this build`);
  }
}

// Home page: the regions strip shows the same cities and counts and links /regions/.
{
  const strip = (await read('index.html')).match(/<section class="regions-strip"[\s\S]*?<\/section>/)?.[0] ?? '';
  const cards = regionCards(strip);
  if (!strip.includes(`href="${base}/regions/"`)) fail('/: the regions strip does not link /regions/');
  if (cards.length !== summary.cities.length) fail(`/: the regions strip lists ${cards.length} cities, expected ${summary.cities.length}`);
  for (const city of summary.cities) {
    const card = cards.find(item => item.slug === city.slug);
    if (!card || card.count !== city.sales || card.status !== city.status) fail(`/: the regions strip is wrong for ${city.name}`);
    else if (card.html.includes('tag-preview') !== (city.status !== 'live')) fail(`/: the regions strip has the wrong Preview label for ${city.name}`);
  }
}

// Search: the page, the data file and the sale pages all describe the same sales.
const categoryIds = ['tools', 'furniture', 'vinyl-records', 'jewelry', 'collectibles', 'vehicles', 'kitchen', 'clothing', 'books', 'art', 'electronics', 'toys-games'];
let searchData = {sales: [], cities: [], categories: []};
if (!all.has('search/index.html') || !all.has('search/data.json') || !all.has('assets/search.js')) fail('/search/: the page, its data file or assets/search.js is missing');
else {
  const html = await read('search/index.html');
  searchData = JSON.parse(await read('search/data.json'));
  const records = searchData.sales;
  const cityStatus = new Map(summary.cities.map(city => [city.slug, city.status]));
  if (records.length !== summary.salePages) fail(`search/data.json has ${records.length} records, the site has ${summary.salePages} sale pages`);
  if (new Set(records.map(record => record.id)).size !== records.length) fail('search/data.json lists a sale twice');
  if (searchData.categories.map(category => category.id).join() !== categoryIds.join()) fail('search/data.json does not carry the twelve categories');
  for (const record of records) {
    if (!all.has(`sale/${record.id}/index.html`)) fail(`search/data.json: ${record.id} has no sale page`);
    if (record.url !== `${summary.site}/sale/${record.id}/`) fail(`search/data.json: ${record.id} has the wrong page address`);
    if (!cityStatus.has(record.city)) fail(`search/data.json: ${record.id} is in ${record.city}, which has no pages`);
    if (!record.title || typeof record.company !== 'string') fail(`search/data.json: ${record.id} lacks a title or company field`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record.first) || !/^\d{4}-\d{2}-\d{2}$/.test(record.last) || record.last < record.first) fail(`search/data.json: ${record.id} has invalid dates`);
    if (!Array.isArray(record.categories) || record.categories.some(id => !categoryIds.includes(id))) fail(`search/data.json: ${record.id} has an unknown category`);
  }

  if (!/<input type="search" id="q" name="q"/.test(html)) fail('/search/: no search box');
  if (!html.includes('id="fav-only"') || !html.includes('id="fav-count"')) fail('/search/: no Favorites-only filter');
  const photoSearchSales = records.filter(record => record.keywords?.length || record.contentsLine).length;
  if (summary.search.photoSearchSales !== photoSearchSales) fail(`build.json says ${summary.search.photoSearchSales} photo-searchable sales, the data has ${photoSearchSales}`);
  if (photoSearchSales ? !html.includes('photo keywords and contents line') : !html.includes('Search covers listing titles and companies in this build')) {
    fail('/search/: the line about what search covers does not match this build');
  }
  for (const record of records) {
    if (record.keywords !== undefined && (!Array.isArray(record.keywords) || record.keywords.some(word => typeof word !== 'string' || !word))) fail(`search/data.json: ${record.id} has malformed keywords`);
    if (record.contentsLine !== undefined && typeof record.contentsLine !== 'string') fail(`search/data.json: ${record.id} has a malformed contentsLine`);
    if (record.digRating !== undefined && typeof record.digRating !== 'string') fail(`search/data.json: ${record.id} has a malformed digRating`);
    if (!Number.isInteger(record.photoCount) || record.photoCount < 0) fail(`search/data.json: ${record.id} has an invalid photoCount`);
    const saleHtml = await read(`sale/${record.id}/index.html`);
    const sessionDates = sessionDaysByPage.get(`sale/${record.id}/index.html`);
    if (JSON.stringify(record.dates) !== JSON.stringify(sessionDates)) fail(`search/data.json: ${record.id} has the wrong session dates`);
    if (Boolean(record.keywords?.length || record.contentsLine) && !saleHtml.includes('id="whats-there"')) fail(`/sale/${record.id}/: has keywords or a contents line but no What's there section`);
    if (!record.keywords?.length && !record.contentsLine && saleHtml.includes('class="contents-line"')) fail(`/sale/${record.id}/: shows a contents line the data does not have`);
  }
  const enriched = summary.enriched ?? {};
  if (enriched.withRating !== ratedSalePages) fail('build.json enriched.withRating does not match the sale pages');
  if (enriched.withKeywords !== records.filter(record => record.keywords?.length).length) fail('build.json enriched.withKeywords does not match the search data');
  if (enriched.withContentsLine !== records.filter(record => record.contentsLine).length) fail('build.json enriched.withContentsLine does not match the search data');
  if (enriched.calendarFiles !== [...all].filter(file => file.endsWith('.ics')).length) fail('build.json enriched.calendarFiles does not match the calendar files written');
  if (!html.includes(`data-source="${base}/search/data.json"`) || !html.includes(`src="${base}/assets/search.js"`)) fail('/search/: the page does not load its data file and script');
  const total = Number(html.match(/id="result-count"[^>]*data-total="(\d+)"/)?.[1]);
  if (total !== records.length || !html.includes(`id="result-count"`) || !new RegExp(`data-total="${records.length}"[^>]*><strong>${records.length}</strong>`).test(html)) fail(`/search/: shows ${total} results, expected ${records.length}`);
  const chips = [...html.matchAll(/<button type="button" class="chip" data-cat="([^"]+)" aria-pressed="false"( disabled)?>[^<]*<span>(\d+)<\/span>/g)];
  if (chips.map(chip => chip[1]).join() !== categoryIds.join()) fail('/search/: the twelve category chips are not all there, in order');
  for (const [, id, disabled, count] of chips) {
    const real = records.filter(record => record.categories.includes(id)).length;
    if (Number(count) !== real || Boolean(disabled) !== (real === 0)) fail(`/search/: the ${id} chip says ${count}, the data has ${real}`);
  }
  const groups = [...html.matchAll(/<section class="search-group"[^>]*data-city="([^"]+)" data-status="([^"]+)" data-total="(\d+)"[^>]*>([\s\S]*?)<\/section>/g)];
  const shown = new Set();
  for (const [, slug, status, groupTotal, inner] of groups) {
    const expected = records.filter(record => record.city === slug);
    const heading = inner.match(/<h2[\s\S]*?<\/h2>/)?.[0] ?? '';
    const hits = [...inner.matchAll(/<li class="sale hit[^"]*" data-id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)];
    if (status !== cityStatus.get(slug)) fail(`/search/: ${slug} is marked ${status}`);
    if (Number(groupTotal) !== expected.length || hits.length !== expected.length) fail(`/search/: ${slug} lists ${hits.length} results, the data has ${expected.length}`);
    if (heading.includes('tag-preview') !== (status !== 'live')) fail(`/search/: ${slug} heading has the wrong Preview label`);
    for (const [, id, body] of hits) {
      const record = expected.find(item => item.id === id);
      shown.add(id);
      if (!record) {
        fail(`/search/: result ${id} is not in ${slug} in the data file`);
        continue;
      }
      if (!body.includes(`href="${base}/sale/${id}/"`)) fail(`/search/: result ${id} does not link its sale page`);
      if (!body.includes('class="sale-title"') || !body.includes('class="dates"') || !body.includes('class="place"')) fail(`/search/: result ${id} lacks a title, dates or city`);
      if (Boolean(record.company) !== body.includes('class="company"')) fail(`/search/: result ${id} shows the wrong company line`);
      const badge = body.match(/<span class="rating-badge [^"]+">([^<]*)<\/span>/)?.[1] ?? '';
      if (unescape(badge) !== (record.digRating ?? '')) fail(`/search/: result ${id} shows the wrong rating`);
      if (body.includes('tag-preview') !== (status !== 'live')) fail(`/search/: result ${id} has the wrong Preview label`);
      if ((body.match(/class="cat"/g) ?? []).length !== record.categories.length + (record.tags ?? []).length) fail(`/search/: result ${id} does not show its categories`);
    }
  }
  if (shown.size !== records.length) fail(`/search/: ${shown.size} results on the page, ${records.length} in the data file`);

  // The same code the browser runs: every sale can be found by its own title and by its company.
  const holder = {exports: {}};
  new Function('module', await read('assets/search.js'))(holder);
  const prepared = holder.exports.prepare(searchData);
  for (const record of records) {
    if (!holder.exports.find(prepared, record.title, []).some(item => item.id === record.id)) fail(`Search does not find ${record.id} by its title`);
    if (record.company && !holder.exports.find(prepared, record.company, []).some(item => item.id === record.id)) fail(`Search does not find ${record.id} by its company`);
  }
  for (const id of categoryIds) {
    const real = records.filter(record => record.categories.includes(id)).length;
    if (holder.exports.find(prepared, '', [id]).length !== real) fail(`Search returns the wrong sales for the ${id} chip`);
  }
  if (holder.exports.find(prepared, 'zzqqxxnotaword', []).length) fail('Search returns sales for a word no sale has');
  for (const record of records) {
    for (const keyword of record.keywords ?? []) {
      const word = holder.exports.fold(keyword).split(' ')[0];
      if (word && !holder.exports.find(prepared, word, []).some(item => item.id === record.id)) fail(`Search does not find ${record.id} by its photo keyword "${keyword}"`);
    }
    if (record.contentsLine) {
      const word = holder.exports.fold(record.contentsLine).split(' ').sort((a, b) => b.length - a.length)[0];
      if (word && !holder.exports.find(prepared, word, []).some(item => item.id === record.id)) fail(`Search does not find ${record.id} by its contents line`);
    }
  }
  if (records.length) {
    const only = holder.exports.find(prepared, '', [], [records[0].id]);
    if (only.length !== 1 || only[0].id !== records[0].id) fail('Search favorites filter does not narrow to the favorite sale');
    if (holder.exports.find(prepared, '', [], []).length !== 0) fail('Search favorites filter with no favorites must return nothing');
  }
}

// Preview cities: the banner is on every page of a proving city and on no other page.
const previewPages = new Set(proving.flatMap(city => [`${city.slug}/index.html`, `${city.slug}/this-weekend/index.html`]));
for (const record of searchData.sales) {
  if (proving.some(city => city.slug === record.city)) previewPages.add(`sale/${record.id}/index.html`);
}
for (const file of htmlFiles) {
  const html = await read(file);
  const banner = html.includes('id="preview-banner"') && html.includes('Preview — still proving itself');
  if (banner !== previewPages.has(file)) fail(`/${file}: ${banner ? 'has a preview banner but is not a preview page' : 'is a preview page without the "Preview — still proving itself" banner'}`);
}

// Sitemap: every listed URL exists, and every indexable page is listed.
const sitemap = await read('sitemap.xml');
const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => unescape(match[1]));
for (const url of listed) {
  const local = fileFor(new URL(url).pathname);
  if (!local || !all.has(local)) fail(`sitemap.xml lists a missing page: ${url}`);
}
for (const [canonical, file] of pagesWithCanonical) {
  if (!listed.includes(canonical)) fail(`/${file} is not in sitemap.xml`);
}
if (new Set(listed).size !== listed.length) fail('sitemap.xml lists a URL twice');

// Root text files.
const robots = await read('robots.txt');
if (!robots.includes(`Sitemap: ${summary.site}/sitemap.xml`)) fail('robots.txt does not name the sitemap');
for (const name of ['agents.txt', 'llms.txt']) {
  if (!all.has(name)) {
    fail(`${name} is missing`);
    continue;
  }
  const card = await read(name);
  for (const city of summary.cities) {
    if (!card.includes(city.feedUrl)) fail(`${name} does not give the ${city.name} feed address`);
    if (!card.includes(`${summary.site}/${city.slug}/`)) fail(`${name} does not link the ${city.name} page`);
  }
  // Live and proving cities sit under their own headings, as the index stated them.
  const liveAt = card.indexOf('### Live');
  const provingAt = card.indexOf('### Proving (preview)');
  if (liveAt < 0 || provingAt < liveAt) fail(`${name} does not list live and proving cities separately`);
  for (const city of summary.cities) {
    const at = card.indexOf(`${summary.site}/${city.slug}/`);
    if (liveAt >= 0 && provingAt >= 0 && (city.status === 'live') !== (at > liveAt && at < provingAt)) fail(`${name} lists ${city.name} under the wrong heading`);
  }
  if (!proving.length && !card.slice(provingAt).startsWith('### Proving (preview)\nNone at this build.')) fail(`${name} does not say that no city is proving`);
  for (const address of [`${summary.site}/regions/`, `${summary.site}/search/`, summary.search.dataFile, summary.search.combinedFeed]) {
    if (!card.includes(address)) fail(`${name} does not give ${address}`);
  }
  if (!card.includes('How to cite')) fail(`${name} does not say how to cite The Dig`);
  if (!card.includes(summary.listingEmail)) fail(`${name} has no contact note`);
  for (const feature of ['Dig rating', 'Directions link', 'Add to calendar', 'favorites', 'photo keywords']) {
    if (!card.includes(feature)) fail(`${name} does not mention the per-sale feature "${feature}"`);
  }
}

// The listing page: one mailto button, addressed to the configured address.
const listing = await read('list-your-sale/index.html');
const mailto = unescape(attribute(listing.match(/<a class="button button-primary" id="list-button"[^>]*>/)?.[0] ?? '', 'href') ?? '');
if (!mailto.startsWith(`mailto:${summary.listingEmail}?subject=${encodeURIComponent('List my sale on The Dig')}&body=`)) {
  fail('/list-your-sale/: the button does not open a prefilled "List my sale on The Dig" email');
}
if (summary.listingEmailIsPlaceholder && !listing.includes('id="email-notice"')) {
  fail('/list-your-sale/: the address is a placeholder but the page does not say so');
}

for (const file of ['404.html', '.nojekyll', 'assets/site.css', 'assets/map.js', 'assets/search.js', 'assets/favorites.js', 'assets/og.png', 'assets/icon.svg']) {
  if (!all.has(file)) fail(`${file} is missing`);
}

if (problems.length) {
  console.error(`Site check FAILED (${problems.length}):`);
  for (const problem of problems.slice(0, 40)) console.error('  ' + problem);
  process.exit(1);
}
console.log(`Site check passed: ${htmlFiles.length} pages, ${saleFiles.length} sale pages with Event data, ${listed.length} sitemap URLs, `
  + `${summary.cities.length - proving.length} live and ${proving.length} preview ${summary.cities.length === 1 ? 'city' : 'cities'}, ${searchData.sales.length} search records.`);
