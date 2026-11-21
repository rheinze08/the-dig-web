#!/usr/bin/env node
// Checks the generated site in docs/ before it is published. Exits 1 on any problem.
//   node test/check.mjs
import {readdir, readFile} from 'node:fs/promises';

const docs = new URL('../docs/', import.meta.url);
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

  // Every internal link, script, style and image must resolve to a generated file.
  for (const tag of html.match(/<(?:a|link|script|img)\b[^>]*>/g) ?? []) {
    const target = attribute(tag, 'href') ?? attribute(tag, 'src');
    if (!target) continue;
    const link = unescape(target);
    if (/^(mailto:|#)/.test(link)) continue;
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
for (const city of summary.cities) {
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
    if (!html.includes('id="map"') || !html.includes('id="map-data"')) fail(`/${file}: no map`);
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
if (saleFiles.length !== summary.salePages) fail(`Found ${saleFiles.length} sale pages, expected ${summary.salePages}`);
for (const file of saleFiles) {
  const event = events.get(file);
  const html = await read(file);
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
  if (!card.includes('How to cite')) fail(`${name} does not say how to cite The Dig`);
  if (!card.includes(summary.listingEmail)) fail(`${name} has no contact note`);
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

for (const file of ['404.html', '.nojekyll', 'assets/site.css', 'assets/map.js', 'assets/og.png', 'assets/icon.svg']) {
  if (!all.has(file)) fail(`${file} is missing`);
}

if (problems.length) {
  console.error(`Site check FAILED (${problems.length}):`);
  for (const problem of problems.slice(0, 40)) console.error('  ' + problem);
  process.exit(1);
}
console.log(`Site check passed: ${htmlFiles.length} pages, ${saleFiles.length} sale pages with Event data, ${listed.length} sitemap URLs.`);
