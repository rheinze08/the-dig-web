#!/usr/bin/env node
// Proves the live site matches the build in docs/. Fetches without any login.
//   node test/live.mjs                  check once
//   node test/live.mjs --wait 240       keep checking for up to 240 seconds (after a push)
//   node test/live.mjs --feed           also compare the live counts with the live feeds and the city index
//   node test/live.mjs --keyword word   the word to search for (default: a word from the first sale's title)
import {readFile} from 'node:fs/promises';

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const wait = Number(option('--wait')) || 0;
const withFeed = args.includes('--feed');
const docs = new URL('../docs/', import.meta.url);
const local = await readFile(new URL('build.json', docs), 'utf8');
const build = JSON.parse(local);
const home = build.cities[0];
const base = new URL(build.site + '/').pathname.replace(/\/+$/, '');

// The same search code the browser runs.
const holder = {exports: {}};
const searchScript = await readFile(new URL('assets/search.js', docs), 'utf8');
new Function('module', searchScript)(holder);
const {fold, prepare, find} = holder.exports;

async function fetchText(url) {
  // A fresh query string skips the CDN's cached copy.
  const fresh = url + (url.includes('?') ? '&' : '?') + 'check=' + Date.now();
  const response = await fetch(fresh, {redirect: 'follow', signal: AbortSignal.timeout(30000)});
  return {status: response.status, text: await response.text()};
}

const regionCards = html => [...html.matchAll(/<li[^>]*data-region="([^"]+)" data-status="([^"]+)" data-count="(\d+)"/g)]
  .map(match => ({slug: match[1], status: match[2], count: Number(match[3])}));

async function check() {
  const report = [];
  const live = await fetchText(`${build.site}/build.json`);
  if (live.status !== 200) return {ok: false, report: [`build.json answered HTTP ${live.status}`]};
  if (live.text !== local) return {ok: false, report: ['The live site is an older build than docs/.']};
  const page = await fetchText(`${build.site}/`);
  const shown = Number(page.text.match(/id="sale-count"[^>]*data-sale-count="(\d+)"/)?.[1]);
  report.push(`GET ${build.site}/ -> HTTP ${page.status}`);
  report.push(`Home page shows ${shown} ${home.name} sales; this build read ${home.sales} from the feed.`);
  let ok = page.status === 200 && shown === home.sales;
  for (const path of ['/agents.txt', '/llms.txt', '/robots.txt', '/sitemap.xml', `/${home.slug}/`, `/${home.slug}/this-weekend/`, '/list-your-sale/']) {
    const response = await fetchText(build.site + path);
    report.push(`GET ${path} -> HTTP ${response.status}`);
    ok &&= response.status === 200;
  }
  let feedSales = null;
  if (withFeed) {
    const feed = await fetchText(home.feedUrl);
    feedSales = feed.status === 200 ? JSON.parse(feed.text).sales : null;
    report.push(`Live feed ${home.feedUrl} -> HTTP ${feed.status}, ${feedSales?.length ?? 'no'} sales.`);
    ok &&= feedSales?.length === shown;
  }

  // Regions: every city the build has pages for, with the count the build read.
  const regions = await fetchText(`${build.site}/regions/`);
  const cards = regionCards(regions.text);
  report.push(`GET /regions/ -> HTTP ${regions.status}, ${cards.length} ${cards.length === 1 ? 'city' : 'cities'} listed.`);
  ok &&= regions.status === 200 && cards.length === build.cities.length;
  for (const city of build.cities) {
    const card = cards.find(item => item.slug === city.slug);
    report.push(`Regions page: ${city.name} is ${card?.status ?? 'missing'} with ${card?.count ?? 'no'} sales; this build read ${city.sales} (${city.status}).`);
    ok &&= card?.count === city.sales && card?.status === city.status;
  }
  if (withFeed && build.cityIndex) {
    const index = await fetchText(build.cityIndex);
    const entries = index.status === 200 ? JSON.parse(index.text).cities : [];
    report.push(`City index ${build.cityIndex} -> HTTP ${index.status}, ${entries.length} cities named.`);
    ok &&= index.status === 200;
    for (const card of cards) {
      const entry = entries.find(item => item?.slug === card.slug);
      const count = [entry?.count, entry?.sales].find(Number.isInteger);
      const stated = entry?.status ?? (entry?.enabled === true ? 'enabled (live)' : 'not marked live');
      report.push(`City index: ${card.slug} is ${stated} with ${count ?? 'no stated count of'} sales; the regions page shows ${card.count}.`);
      // A proving city may not carry a count in the index. Its feed is checked below instead.
      ok &&= Boolean(entry) && (count === undefined ? card.status !== 'live' : count === card.count);
    }
    const unlisted = entries.filter(item => item && !cards.some(card => card.slug === item.slug)).map(item => item.slug);
    if (unlisted.length) report.push(`City index names ${unlisted.length} more with no pages on the site: ${unlisted.join(', ')}.`);
  }

  // Preview pages: one per proving city, each with the banner.
  const proving = build.cities.filter(city => city.status !== 'live');
  if (!proving.length) report.push('No proving city has a feed in this build, so there is no preview page to fetch.');
  for (const city of proving) {
    const preview = await fetchText(`${build.site}/${city.slug}/`);
    const banner = preview.text.includes('id="preview-banner"') && preview.text.includes('Preview — still proving itself');
    const count = Number(preview.text.match(/id="sale-count"[^>]*data-sale-count="(\d+)"/)?.[1]);
    report.push(`GET /${city.slug}/ (preview) -> HTTP ${preview.status}, banner ${banner ? 'shown' : 'MISSING'}, ${count} sales; this build read ${city.sales}.`);
    ok &&= preview.status === 200 && banner && count === city.sales;
    if (withFeed) {
      const feed = await fetchText(city.feedUrl);
      const sales = feed.status === 200 ? JSON.parse(feed.text).sales.length : null;
      report.push(`Live feed ${city.feedUrl} -> HTTP ${feed.status}, ${sales ?? 'no'} sales.`);
      ok &&= sales === count;
    }
  }

  // Search: the page, its data file and its script are live, and a real word finds its sale.
  const searchPage = await fetchText(`${build.site}/search/`);
  const data = await fetchText(build.search.dataFile);
  const script = await fetchText(`${build.site}/assets/search.js`);
  const localData = await readFile(new URL('search/data.json', docs), 'utf8');
  const total = Number(searchPage.text.match(/id="result-count"[^>]*data-total="(\d+)"/)?.[1]);
  report.push(`GET /search/ -> HTTP ${searchPage.status}, ${total} results on the page.`);
  report.push(`GET /search/data.json -> HTTP ${data.status}, ${data.text === localData ? 'same as' : 'DIFFERENT from'} this build.`);
  report.push(`GET /assets/search.js -> HTTP ${script.status}, ${script.text === searchScript ? 'same as' : 'DIFFERENT from'} this build.`);
  ok &&= searchPage.status === 200 && data.status === 200 && script.status === 200 && data.text === localData && script.text === searchScript;
  if (data.status === 200) {
    const records = JSON.parse(data.text);
    ok &&= records.sales.length === total && total === build.search.records;
    const first = records.sales.find(sale => sale.city === home.slug);
    const keyword = option('--keyword') ?? fold(first?.title).split(' ').sort((a, b) => b.length - a.length)[0] ?? '';
    const found = find(prepare(records), keyword, []);
    report.push(`Search for "${keyword}" in the live data file -> ${found.length} ${found.length === 1 ? 'result' : 'results'}.`);
    for (const sale of found.slice(0, 5)) {
      const salePage = await fetchText(sale.url);
      report.push(`  ${sale.title} | ${sale.company || 'no company listed'} | ${sale.city} | ${sale.first} to ${sale.last} | ${sale.url} -> HTTP ${salePage.status}`);
      ok &&= salePage.status === 200 && searchPage.text.includes(`href="${base}/sale/${sale.id}/"`);
    }
    ok &&= found.length > 0 && found.some(sale => sale.city === home.slug);
    if (feedSales) {
      // The word must come from a real title in the live feed, and search must return that sale.
      const starts = text => fold(text).split(' ').some(word => word.startsWith(fold(keyword)));
      const titled = feedSales.filter(sale => starts(sale.title));
      const missing = titled.filter(sale => !found.some(item => item.id === sale.id));
      report.push(`Live ${home.name} feed: ${titled.length} ${titled.length === 1 ? 'title has' : 'titles have'} "${keyword}"${titled.length ? ` (${titled.map(sale => sale.id).join(', ')})` : ''}; search returned ${titled.length - missing.length} of them.`);
      ok &&= titled.length > 0 && missing.length === 0;
    }
  }
  return {ok, report};
}

const deadline = Date.now() + wait * 1000;
for (;;) {
  let result;
  try {
    result = await check();
  } catch (error) {
    result = {ok: false, report: [error.message]};
  }
  if (result.ok || Date.now() >= deadline) {
    console.log(result.report.join('\n'));
    console.log(result.ok ? 'Live site matches the build.' : 'Live site does NOT match the build.');
    process.exit(result.ok ? 0 : 1);
  }
  await new Promise(resolve => setTimeout(resolve, 10000));
}
