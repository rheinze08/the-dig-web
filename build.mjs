#!/usr/bin/env node
// Generates The Dig website. Every run reads the live public feeds and rewrites
// the whole site into docs/. Nothing about any sale is stored in this repo's source.
import {cp, mkdir, readdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// ── Settings ────────────────────────────────────────────────────────────────
// PLACEHOLDER ADDRESS. /list-your-sale/ cannot take listings until this is a
// real mailbox. This is the only place the address is set.
const LISTING_EMAIL = 'listings@thedig.example';

// Public address of the site. Change this one value when a domain is chosen.
const SITE_URL = (process.env.SITE_URL || 'https://rheinze08.github.io/the-dig-web').replace(/\/+$/, '');

// Where the public feeds live.
const DATA_REPO = 'rheinze08/the-dig-data';
const DATA_BASE = (process.env.DIG_DATA_BASE || `https://raw.githubusercontent.com/${DATA_REPO}/main`).replace(/\/+$/, '');

// Used only until the-dig-data publishes cities.json.
const DEFAULT_CITY = {slug: 'houston', name: 'Houston'};

// Used only when GitHub cannot say which app release is the latest.
const APK_FALLBACK = {
  tag: 'v0.1.1',
  url: `https://github.com/${DATA_REPO}/releases/download/v0.1.1/The-Dig-v0.1.1.apk`,
  page: `https://github.com/${DATA_REPO}/releases/tag/v0.1.1`,
};

const LEAFLET = {
  css: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  cssHash: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=',
  js: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  jsHash: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=',
};

const TAGLINE = 'The Dig pools estate sales from the public listing boards into one map per city. '
  + 'Facts shown, always linked back to the source listing.';

// The category chips on /search/, in the order shown. When the-dig-data
// publishes search.json, a sale's categories come from there and "aliases" map
// its labels onto these chips. Until then, and for any sale search.json leaves
// out, a sale gets a category when its title, company or excerpt contains one
// of "words" as whole words (a plural s is allowed).
const CATEGORIES = [
  {id: 'tools', label: 'Tools', aliases: ['tool'],
    words: ['tool', 'toolbox', 'workshop', 'woodworking', 'machinist', 'lathe', 'table saw', 'welder', 'compressor', 'mower', 'dewalt', 'makita', 'snap on']},
  {id: 'furniture', label: 'Furniture', aliases: [],
    words: ['furniture', 'furnishing', 'sofa', 'couch', 'sectional', 'loveseat', 'recliner', 'dresser', 'armoire', 'hutch', 'credenza', 'sideboard', 'bookcase', 'nightstand', 'ottoman', 'dining table', 'dining set', 'bedroom set', 'china cabinet', 'mid century', 'midcentury', 'mcm']},
  {id: 'vinyl-records', label: 'Vinyl & records', aliases: ['vinyl', 'records', 'record', 'vinyl records'],
    words: ['vinyl', 'record', 'lp', 'turntable', '45s', '78s']},
  {id: 'jewelry', label: 'Jewelry', aliases: ['jewellery'],
    words: ['jewelry', 'jewellery', 'jewel', 'diamond', 'sterling', 'necklace', 'bracelet', 'earring', 'gemstone', 'pearl', 'wristwatch', 'pocket watch', 'rolex', '14k', '18k']},
  {id: 'collectibles', label: 'Collectibles', aliases: ['collectables', 'collectible', 'collectable'],
    words: ['collectible', 'collectable', 'collector', 'memorabilia', 'antique', 'vintage', 'coin', 'stamp', 'figurine', 'hummel', 'lladro', 'comic', 'baseball card', 'sports card', 'trading card', 'militaria', 'depression glass', 'carnival glass', 'star wars']},
  {id: 'vehicles', label: 'Vehicles', aliases: ['vehicle', 'cars', 'autos'],
    words: ['vehicle', 'car', 'truck', 'pickup', 'automobile', 'motorcycle', 'boat', 'trailer', 'rv', 'camper', 'golf cart', 'tractor', 'atv', 'harley', 'corvette', 'jeep']},
  {id: 'kitchen', label: 'Kitchen', aliases: ['kitchenware'],
    words: ['kitchen', 'kitchenware', 'cookware', 'bakeware', 'glassware', 'dish', 'flatware', 'silverware', 'fine china', 'cast iron', 'small appliance', 'pyrex', 'corningware', 'corning ware', 'le creuset', 'kitchenaid']},
  {id: 'clothing', label: 'Clothing', aliases: ['clothes', 'apparel'],
    words: ['clothing', 'clothes', 'apparel', 'shoe', 'boot', 'handbag', 'purse', 'fur', 'dress', 'jacket', 'hat', 'western wear']},
  {id: 'books', label: 'Books', aliases: ['book'],
    words: ['book', 'cookbook', 'library', 'first edition', 'novel', 'bible', 'encyclopedia']},
  {id: 'art', label: 'Art', aliases: ['artwork', 'fine art'],
    words: ['art', 'artwork', 'painting', 'sculpture', 'watercolor', 'lithograph', 'etching', 'bronze', 'pottery', 'artist']},
  {id: 'electronics', label: 'Electronics', aliases: ['electronic'],
    words: ['electronic', 'tv', 'television', 'stereo', 'speaker', 'audio', 'amplifier', 'receiver', 'computer', 'laptop', 'camera', 'radio', 'hifi', 'hi fi']},
  {id: 'toys-games', label: 'Toys & games', aliases: ['toys', 'games', 'toy', 'game', 'toys games'],
    words: ['toy', 'game', 'lego', 'doll', 'dollhouse', 'barbie', 'puzzle', 'hot wheels', 'matchbox', 'board game', 'video game', 'model train', 'train set', 'action figure', 'teddy bear', 'nintendo', 'playstation', 'xbox']},
];
// ────────────────────────────────────────────────────────────────────────────

const root = new URL('./', import.meta.url);
// DIG_OUT sends a test build somewhere other than docs/.
const outDir = process.env.DIG_OUT ? pathToFileURL(resolve(process.env.DIG_OUT) + '/') : new URL('docs/', root);
const tmpDir = new URL(outDir.href.replace(/\/$/, '.tmp/'));
const site = new URL(SITE_URL + '/');
const BASE = site.pathname.replace(/\/+$/, '');
const now = process.env.DIG_NOW ? new Date(process.env.DIG_NOW) : new Date();
const offline = process.env.DIG_OFFLINE === '1';
const placeholderEmail = /\.example$/i.test(LISTING_EMAIL);
const reservedSlugs = new Set(['sale', 'list-your-sale', 'assets', 'this-weekend', 'regions', 'search']);
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// A failed build leaves docs/ exactly as it was.
process.on('uncaughtException', error => {
  console.error('Build failed: ' + error.message);
  process.exit(1);
});
if (Number.isNaN(now.getTime())) throw Error('DIG_NOW is not a date');

// ── Small helpers ───────────────────────────────────────────────────────────
const href = path => BASE + path;
const abs = path => site.origin + BASE + path;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const esc = value => String(value ?? '').replace(/[&<>"']/g,
  ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
// JSON placed inside a <script> element must not be able to close it.
const unsafeInScript = new RegExp('[<' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
const scriptJson = value => JSON.stringify(value).replace(unsafeInScript,
  ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
const clean = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
const plural = (count, one, many = one + 's') => `${count} ${count === 1 ? one : many}`;
// Lower case, no accents or apostrophes, single spaces. static/assets/search.js folds text the same way.
const fold = value => String(value ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/['‘’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function clip(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:–-]+$/, '') + '…';
}

function check(condition, message) {
  if (!condition) throw Error(message);
}

async function get(url, headers = {}) {
  if (url.startsWith('file:')) {
    try {
      return {status: 200, text: await readFile(new URL(url), 'utf8')};
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') return {status: 404, text: ''};
      throw error;
    }
  }
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {'user-agent': 'the-dig-web-build', ...headers},
        signal: AbortSignal.timeout(30000),
      });
      if (response.status >= 500 && attempt < 3) {
        await sleep(1500 * attempt);
        continue;
      }
      return {status: response.status, text: await response.text()};
    } catch (error) {
      if (attempt >= 3) throw Error(`Could not reach ${url}: ${error.message}`);
      await sleep(1500 * attempt);
    }
  }
}

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  return {accept: 'application/vnd.github+json', ...(token ? {authorization: `Bearer ${token}`} : {})};
}

// ── Dates. Feed dates are plain local calendar days ("2026-11-21"). ─────────
const dayMs = 86400000;
const asDate = day => new Date(day + 'T00:00:00Z');
const addDays = (day, count) => new Date(asDate(day).getTime() + count * dayMs).toISOString().slice(0, 10);
const formatDay = (day, options) => new Intl.DateTimeFormat('en-US', {timeZone: 'UTC', ...options}).format(asDate(day));
const shortDay = day => formatDay(day, {weekday: 'short', month: 'short', day: 'numeric'});
const longDay = day => formatDay(day, {weekday: 'long', month: 'long', day: 'numeric'});
const monthDay = day => formatDay(day, {month: 'short', day: 'numeric'});

function dayRange(first, last, one = shortDay) {
  return first === last ? one(first) : `${one(first)} – ${one(last)}`;
}

// "Nov 21–22" or "Nov 28 – Dec 1" for page titles.
function compactRange(first, last) {
  if (first === last) return monthDay(first);
  if (first.slice(0, 7) === last.slice(0, 7)) return `${monthDay(first)}–${Number(last.slice(8))}`;
  return `${monthDay(first)} – ${monthDay(last)}`;
}

function todayIn(timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'})
    .formatToParts(now);
  const pick = type => parts.find(part => part.type === type).value;
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

// The coming weekend: Friday to Sunday. On a Friday, Saturday or Sunday it is
// the weekend already under way, from today on.
function weekendFor(today) {
  const weekday = asDate(today).getUTCDay();
  const friday = [5, 6, 0].includes(weekday) ? addDays(today, -((weekday + 2) % 7)) : addDays(today, 5 - weekday);
  const days = [0, 1, 2].map(offset => addDays(friday, offset)).filter(day => day >= today);
  return {friday, sunday: addDays(friday, 2), days, first: days[0], last: days.at(-1)};
}

function clock(time) {
  const [hour, minute] = time.split(':').map(Number);
  return `${hour % 12 || 12}${minute ? ':' + String(minute).padStart(2, '0') : ''} ${hour < 12 ? 'AM' : 'PM'}`;
}

function hours(session) {
  if (session.start && session.end) return `${clock(session.start)} – ${clock(session.end)}`;
  if (session.start) return `Opens ${clock(session.start)}`;
  if (session.end) return `Until ${clock(session.end)}`;
  return 'Hours not listed';
}

// The UTC offset ("-06:00") of a local date and time in a time zone.
function utcOffset(day, time, timeZone) {
  const [year, month, date] = day.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, date, hour, minute);
  const format = new Intl.DateTimeFormat('en-US', {timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit'});
  const offsetAt = instant => {
    const parts = Object.fromEntries(format.formatToParts(new Date(instant)).map(part => [part.type, Number(part.value)]));
    return (Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - instant) / 60000;
  };
  // The second pass settles times next to a daylight-saving change.
  const minutes = offsetAt(wall - offsetAt(wall) * 60000);
  const size = Math.abs(minutes);
  return `${minutes < 0 ? '-' : '+'}${String(Math.floor(size / 60)).padStart(2, '0')}:${String(size % 60).padStart(2, '0')}`;
}

const isoMoment = (day, time, timeZone) => time ? `${day}T${time}:00${utcOffset(day, time, timeZone)}` : day;

function zoneName(timeZone) {
  try {
    const part = new Intl.DateTimeFormat('en-US', {timeZone, timeZoneName: 'longGeneric'}).formatToParts(now)
      .find(piece => piece.type === 'timeZoneName');
    return part ? part.value : timeZone;
  } catch {
    return timeZone;
  }
}

function collectedLabel(iso, timeZone) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return null;
  return {
    day: new Intl.DateTimeFormat('en-US', {timeZone, month: 'short', day: 'numeric', year: 'numeric'}).format(date),
    full: new Intl.DateTimeFormat('en-US', {timeZone, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric',
      minute: '2-digit', timeZoneName: 'short'}).format(date),
    iso: date.toISOString(),
  };
}

// ── Reading the feeds ───────────────────────────────────────────────────────
function checkSlug(slug) {
  check(typeof slug === 'string' && slugPattern.test(slug), 'Invalid city slug ' + JSON.stringify(slug));
  check(!reservedSlugs.has(slug), `City slug "${slug}" collides with a site page`);
}

function nameFromSlug(slug) {
  return slug.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
}

// cities.json is the authority once the-dig-data publishes it. For each city it names:
//   live     the index says status "live" or, in an index without statuses,
//            "enabled": true. Its feed must be readable or the build stops.
//   proving  the index says status "proving", or names the city without marking
//            it live. It gets preview pages on the first build that finds its
//            feed. Until then it is not on the site: no feed, no count, no page.
function citiesFromIndex(index) {
  check(Array.isArray(index.cities), 'cities.json has no city list');
  const entries = [];
  const offSite = [];
  const seen = new Set();
  for (const city of index.cities) {
    if (!city || typeof city !== 'object') continue;
    checkSlug(city.slug);
    check(!seen.has(city.slug), `cities.json names ${city.slug} twice`);
    seen.add(city.slug);
    const name = clean(city.name) || nameFromSlug(city.slug);
    const stated = typeof city.status === 'string' ? city.status.trim().toLowerCase() : '';
    const status = stated === 'live' || (!stated && city.enabled === true) ? 'live'
      : !stated || stated === 'proving' || stated === 'preview' ? 'proving' : null;
    if (!status) {
      offSite.push({slug: city.slug, name, reason: `index status "${clean(city.status)}" is neither live nor proving`});
      continue;
    }
    const feedUrl = [city.feedUrl, city.feed].find(value => typeof value === 'string' && value)
      ?? `${DATA_BASE}/cities/${city.slug}/sales.json`;
    check(/^(https:|file:)/.test(feedUrl), `${city.slug}: feedUrl must be HTTPS`);
    entries.push({slug: city.slug, name, status, timeZone: city.timeZone, feedUrl, center: city.center,
      radiusMiles: city.radiusMiles, required: status === 'live',
      indexCount: [city.count, city.sales].find(Number.isInteger) ?? null,
      cleanRuns: Number.isInteger(city.cleanRuns) && city.cleanRuns >= 0 ? city.cleanRuns : null});
  }
  const live = entries.filter(entry => entry.status === 'live');
  check(live.length, 'cities.json names no live city');
  const first = live.find(city => city.slug === index.defaultCity) ?? live[0];
  // The home page city first, then the other live cities, then the proving ones.
  return {entries: [first, ...live.filter(city => city !== first), ...entries.filter(entry => entry.status === 'proving')], offSite};
}

async function cityFolders() {
  if (DATA_BASE.startsWith('file:')) {
    try {
      return (await readdir(new URL(DATA_BASE + '/cities/'), {withFileTypes: true}))
        .filter(entry => entry.isDirectory()).map(entry => entry.name);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }
  const listing = await get(`https://api.github.com/repos/${DATA_REPO}/contents/cities?ref=main`, githubHeaders());
  if (listing.status === 404) return [];
  // Any other failure stops the build so a city is never dropped by accident.
  check(listing.status === 200, `GitHub could not list the city feeds (HTTP ${listing.status})`);
  return JSON.parse(listing.text).filter(entry => entry.type === 'dir').map(entry => entry.name);
}

// Without an index: Houston live from the root feed, plus every cities/<slug>/sales.json
// that exists. With no index to call those live, they are shown as previews.
async function citiesFromFeeds() {
  const cities = [{...DEFAULT_CITY, status: 'live', feedUrl: `${DATA_BASE}/sales.json`, required: true}];
  for (const slug of (await cityFolders()).sort()) {
    if (slug === DEFAULT_CITY.slug || !slugPattern.test(slug) || reservedSlugs.has(slug)) continue;
    cities.push({slug, name: nameFromSlug(slug), status: 'proving', feedUrl: `${DATA_BASE}/cities/${slug}/sales.json`, required: false});
  }
  return cities;
}

function readSale(raw, where) {
  check(raw && typeof raw === 'object', `${where}: a sale is not an object`);
  check(typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.id), `${where}: invalid sale id ${JSON.stringify(raw.id)}`);
  check(Array.isArray(raw.sessions), `${where}: sale ${raw.id} has no session list`);
  const sessions = raw.sessions.map(session => {
    check(session && /^\d{4}-\d{2}-\d{2}$/.test(session.date ?? '') && !Number.isNaN(asDate(session.date).getTime()),
      `${where}: sale ${raw.id} has an invalid session date`);
    const time = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
    return {date: session.date, start: time(session.start), end: time(session.end)};
  }).sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? '').localeCompare(b.start ?? ''));
  check(sessions.length, `${where}: sale ${raw.id} has no sessions`);
  const sources = (Array.isArray(raw.sources) ? raw.sources : [])
    .filter(source => source && /^https?:\/\/\S+$/i.test(source.url ?? ''))
    .map(source => ({name: clean(source.name) || new URL(source.url).hostname.replace(/^www\./, ''), url: source.url}));
  const located = Number.isFinite(raw.lat) && Number.isFinite(raw.lng) && Math.abs(raw.lat) <= 90 && Math.abs(raw.lng) <= 180;
  const street = raw.addressHidden ? '' : clean(raw.streetAddress);
  const excerpt = clean(typeof raw.excerpt === 'string' ? raw.excerpt : typeof raw.description === 'string' ? raw.description : '');
  return {
    id: raw.id,
    title: clean(raw.title) || 'Estate sale',
    company: clean(raw.company),
    street,
    addressHidden: !street,
    town: clean(raw.city),
    state: clean(raw.state),
    zip: clean(raw.zip),
    sessions,
    sources,
    lat: located ? raw.lat : null,
    lng: located ? raw.lng : null,
    approximate: raw.approximate !== false || !street,
    excerpt: excerpt ? clip(excerpt, 320) : '',
    first: sessions[0].date,
    last: sessions.at(-1).date,
  };
}

async function loadCity(entry) {
  const response = await get(entry.feedUrl);
  if (response.status === 404 && !entry.required) return null;
  check(response.status === 200, `${entry.slug}: feed ${entry.feedUrl} answered HTTP ${response.status}`);
  try {
    return readCity(entry, response.text);
  } catch (error) {
    if (entry.required) throw error;
    // A proving feed that does not read cleanly keeps that city off the site.
    // It never stops the live cities from rebuilding.
    console.warn(`${entry.slug}: preview feed left off the site (${error.message})`);
    entry.problem = error.message;
    return null;
  }
}

function readCity(entry, text) {
  const feed = JSON.parse(text);
  check(Array.isArray(feed.sales), `${entry.slug}: feed has no sales list`);
  const timeZone = entry.timeZone || feed.window?.timeZone || 'America/Chicago';
  try {
    new Intl.DateTimeFormat('en-US', {timeZone});
  } catch {
    throw Error(`${entry.slug}: unknown time zone ${JSON.stringify(timeZone)}`);
  }
  const today = todayIn(timeZone);
  const seen = new Set();
  const sales = feed.sales.map(raw => readSale(raw, entry.slug));
  for (const sale of sales) {
    check(!seen.has(sale.id), `${entry.slug}: sale id ${sale.id} appears twice`);
    seen.add(sale.id);
    sale.ended = sale.last < today;
    sale.today = sale.sessions.find(session => session.date === today) ?? null;
    sale.next = sale.sessions.find(session => session.date >= today) ?? null;
  }
  // Sales still to come first, soonest first. Ended sales go last.
  sales.sort((a, b) => Number(a.ended) - Number(b.ended)
    || (a.next?.date ?? a.last).localeCompare(b.next?.date ?? b.last)
    || a.first.localeCompare(b.first) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  sales.forEach((sale, index) => { sale.number = index + 1; });
  const center = [entry.center, feed.area].find(point => Number.isFinite(point?.lat) && Number.isFinite(point?.lng));
  const weekend = weekendFor(today);
  const sourceCounts = Object.entries(feed.coverage && typeof feed.coverage === 'object' ? feed.coverage : {})
    .filter(([, info]) => Number.isInteger(info?.included) && info.included > 0)
    .map(([name, info]) => ({name: clean(name), included: info.included}));
  return {
    slug: entry.slug,
    name: entry.name,
    status: entry.status,
    preview: entry.status !== 'live',
    indexCount: entry.indexCount ?? null,
    cleanRuns: entry.cleanRuns ?? null,
    timeZone,
    zone: zoneName(timeZone),
    feedUrl: entry.feedUrl,
    center: center ? {lat: center.lat, lng: center.lng} : null,
    centerLabel: clean(entry.center?.label),
    radiusMiles: Number.isFinite(entry.radiusMiles) ? entry.radiusMiles : Number.isFinite(feed.area?.radiusMiles) ? feed.area.radiusMiles : null,
    collectedAt: typeof feed.collectedAt === 'string' ? feed.collectedAt : null,
    collected: collectedLabel(feed.collectedAt, timeZone),
    listings: Number.isInteger(feed.counts?.listings) ? feed.counts.listings : null,
    sourceCounts,
    today,
    weekend,
    sales,
    weekendSales: sales.filter(sale => sale.sessions.some(session => weekend.days.includes(session.date))),
  };
}

async function loadCities() {
  const index = await get(`${DATA_BASE}/cities.json`);
  check(index.status === 200 || index.status === 404, `cities.json answered HTTP ${index.status}`);
  const fromIndex = index.status === 200;
  const {entries, offSite} = fromIndex ? citiesFromIndex(JSON.parse(index.text)) : {entries: await citiesFromFeeds(), offSite: []};
  const loaded = await Promise.all(entries.map(loadCity));
  entries.forEach((entry, position) => {
    if (!loaded[position]) offSite.push({slug: entry.slug, name: entry.name, reason: entry.problem ? `its feed does not read cleanly: ${entry.problem}` : 'no feed yet'});
  });
  const cities = loaded.filter(Boolean);
  check(cities.some(city => !city.preview), 'No live city feed could be read');
  // offSite: cities the index names that have no pages in this build, and why.
  return {cities, offSite, cityIndex: fromIndex ? `${DATA_BASE}/cities.json` : null};
}

// search.json is the combined feed of every sale in the live and proving cities.
// The site takes each sale's categories from it. Until the-dig-data publishes it,
// and for any sale it leaves out, categories are read from the listing text here.
async function loadSearchFeed() {
  const url = `${DATA_BASE}/search.json`;
  const response = await get(url);
  if (response.status === 404) return {url, published: false, problem: null, sales: new Map()};
  check(response.status === 200, `search.json answered HTTP ${response.status}`);
  try {
    const data = JSON.parse(response.text);
    const list = Array.isArray(data) ? data : [data.sales, data.results, data.items, data.entries].find(Array.isArray);
    check(list, 'it has no sale list');
    const sales = new Map();
    for (const raw of list) {
      if (!raw || typeof raw.id !== 'string' || !Array.isArray(raw.categories)) continue;
      sales.set(raw.id, raw.categories
        .map(item => clean(typeof item === 'string' ? item : item?.label ?? item?.name ?? item?.id)).filter(Boolean));
    }
    return {url, published: true, problem: null, sales};
  } catch (error) {
    console.warn(`search.json could not be used (${error.message}). Categories are read from listing titles instead.`);
    return {url, published: true, problem: error.message, sales: new Map()};
  }
}

const squash = value => fold(value).replace(/\band\b/g, ' ').replace(/ /g, '');
const categoryAlias = new Map(CATEGORIES.flatMap(category =>
  [category.id, category.label, ...category.aliases].map(name => [squash(name), category.id])));
const categoryWords = CATEGORIES.map(category => ({id: category.id,
  pattern: new RegExp(`(?:^| )(?:${category.words.map(fold).join('|')})(?:s|es)?(?= |$)`)}));

// One sale's categories: chip ids in chip order, plus any search.json labels that are not chips.
function categorize(sale, listed) {
  if (listed) {
    const ids = new Set();
    const tags = [];
    for (const label of listed) {
      const id = categoryAlias.get(squash(label));
      if (id) ids.add(id);
      else if (!tags.includes(clip(label, 40))) tags.push(clip(label, 40));
    }
    return {cats: CATEGORIES.filter(category => ids.has(category.id)).map(category => category.id), tags: tags.slice(0, 8)};
  }
  const text = fold([sale.title, sale.company, sale.excerpt].join(' '));
  return {cats: categoryWords.filter(category => category.pattern.test(text)).map(category => category.id), tags: []};
}

async function latestApk() {
  if (offline) return APK_FALLBACK;
  try {
    const response = await get(`https://api.github.com/repos/${DATA_REPO}/releases/latest`, githubHeaders());
    if (response.status === 200) {
      const release = JSON.parse(response.text);
      const asset = (release.assets ?? []).find(file => /\.apk$/i.test(file.name ?? ''));
      const ours = `https://github.com/${DATA_REPO}/releases/`;
      if (asset && String(asset.browser_download_url).startsWith(ours) && String(release.html_url).startsWith(ours)
        && /^v?\d[\w.-]*$/.test(release.tag_name ?? '')) {
        return {tag: release.tag_name, url: asset.browser_download_url, page: release.html_url};
      }
    }
    console.warn(`Could not read the latest app release (HTTP ${response.status}). Linking ${APK_FALLBACK.tag}.`);
  } catch (error) {
    console.warn(`Could not read the latest app release (${error.message}). Linking ${APK_FALLBACK.tag}.`);
  }
  return APK_FALLBACK;
}

// ── Page pieces ─────────────────────────────────────────────────────────────
const pages = [];   // {path, lastmod} for the sitemap
const files = new Map();

function put(path, content) {
  check(!files.has(path), 'Two pages want the path ' + path);
  files.set(path, content);
}

const salePath = sale => `/sale/${sale.id}/`;
const placeOf = sale => [sale.town && sale.state ? `${sale.town}, ${sale.state}` : sale.town || sale.state, sale.zip]
  .filter(Boolean).join(' ');

const symbols = `<svg class="symbols" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
  <symbol id="i-pin" viewBox="0 0 24 24"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.3"/></symbol>
  <symbol id="i-calendar" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M7.5 3v4m9-4v4m-13 3.5h17"/></symbol>
  <symbol id="i-arrow" viewBox="0 0 24 24"><path d="M7 17 17 7m-8 0h8v8"/></symbol>
  <symbol id="i-download" viewBox="0 0 24 24"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14"/></symbol>
  <symbol id="i-mail" viewBox="0 0 24 24"><rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m4 7.5 8 6 8-6"/></symbol>
  <symbol id="i-search" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></symbol>
</svg>`;
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const brandMark = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="m7 26 13-13 7 7-13 13-9 2z"/><path d="m22 15 7-7m-3-2 3-3 8 8-3 3zM9 30l10-10"/></svg>';

function layout({path, title, description, body, cities, apk, jsonLd = [], map = null, city = null, index = true, search = false}) {
  const home = cities[0];
  // Live cities get their own link while there are few. Every city is on /regions/.
  const live = cities.filter(item => !item.preview);
  const cityLinks = live.length <= 2
    ? live.map(item => `<a href="${href(`/${item.slug}/`)}">${esc(item.name)}</a>`).join('')
    : '';
  const here = target => path === target ? ' aria-current="page"' : '';
  const weekendCity = city ?? home;
  const footerCities = cities.map(item => `<li><a href="${href(`/${item.slug}/`)}">Estate sales in ${esc(item.name)}</a>${item.preview ? ' (preview)' : ''}</li>`).join('\n          ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${index ? `<link rel="canonical" href="${esc(abs(path))}">` : '<meta name="robots" content="noindex">'}
<meta name="theme-color" content="#233e30">
<meta property="og:site_name" content="The Dig">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title.replace(/ \| The Dig$/, ''))}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(abs(path))}">
<meta property="og:image" content="${esc(abs('/assets/og.png'))}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="The Dig. Estate sales on one map.">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${href('/assets/icon.svg')}" type="image/svg+xml">
<link rel="apple-touch-icon" href="${href('/assets/icon-180.png')}">
<link rel="preload" href="${href('/assets/fonts/dm-sans.woff2')}" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${href('/assets/fonts/dm-serif-text.woff2')}" as="font" type="font/woff2" crossorigin>
${map ? `<link rel="stylesheet" href="${LEAFLET.css}" integrity="${LEAFLET.cssHash}" crossorigin="">\n` : ''}<link rel="stylesheet" href="${href('/assets/site.css')}">
${city ? `<link rel="alternate" type="application/json" title="${esc(city.name)} estate sales (JSON feed)" href="${esc(city.feedUrl)}">\n` : ''}${jsonLd.map(item => `<script type="application/ld+json">${scriptJson(item)}</script>`).join('\n')}
</head>
<body${city ? ` data-time-zone="${esc(city.timeZone)}" data-built-for="${city.today}"` : ''}>
${symbols}
<a class="skip" href="#main">Skip to content</a>
<header class="mast">
  <div class="frame mast-inner">
    <a class="brand" href="${href('/')}" aria-label="The Dig home">${brandMark}The Dig<span>.</span></a>
    <nav aria-label="Site">
      ${cityLinks}<a href="${href(`/${weekendCity.slug}/this-weekend/`)}">This weekend</a><a href="${href('/regions/')}"${here('/regions/')}>Regions</a><a href="${href('/search/')}"${here('/search/')}>Search</a><a href="${href('/list-your-sale/')}"${here('/list-your-sale/')}>List your sale</a>
    </nav>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="foot">
  <div class="frame foot-inner">
    <div class="foot-about">
      <p class="foot-brand">The Dig<span>.</span></p>
      <p>${esc(TAGLINE)}</p>
      <p>The Dig does not run these sales. Check the original listing before you travel.</p>
    </div>
    <div>
      <h2>Regions</h2>
      <ul>
          ${footerCities}
          <li><a href="${href('/regions/')}">All regions</a></li>
      </ul>
    </div>
    <div>
      <h2>The Dig</h2>
      <ul>
        <li><a href="${href('/search/')}">Search every city</a></li>
        <li><a href="${esc(apk.url)}">Android app (${esc(apk.tag)})</a></li>
        <li><a href="${href('/list-your-sale/')}">List your sale</a></li>
        <li><a href="${href('/llms.txt')}">For AI agents</a></li>
        <li><a href="${esc(home.feedUrl)}">Public JSON feed</a></li>
      </ul>
    </div>
  </div>
  <div class="frame foot-legal">Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>. Sale details belong to their original listings.</div>
</footer>
${map ? `<script type="application/json" id="map-data">${scriptJson(map)}</script>
<script defer src="${LEAFLET.js}" integrity="${LEAFLET.jsHash}" crossorigin=""></script>
<script defer src="${href('/assets/map.js')}"></script>
` : ''}${city ? `<script defer src="${href('/assets/site.js')}"></script>\n` : ''}${search ? `<script defer src="${href('/assets/search.js')}"></script>\n` : ''}</body>
</html>
`;
}

function statusTag(sale) {
  if (sale.ended) return '<span class="tag tag-ended">Ended</span>';
  if (sale.today) return `<span class="tag tag-open" data-day="${sale.today.date}">Open today · ${esc(hours(sale.today))}</span>`;
  return '';
}

function saleCard(sale, city, note = null) {
  const place = placeOf(sale);
  const where = sale.addressHidden
    ? `${esc(place || city.name)} · address releases closer to the sale`
    : esc([sale.street, place].filter(Boolean).join(', '));
  return `<li class="sale${sale.ended ? ' is-ended' : ''}" id="sale-${sale.id}" data-last="${sale.last}">
        <a href="${href(salePath(sale))}">
          <span class="sale-number">${sale.number}</span>
          <span class="sale-text">
            <span class="dates">${esc(note ?? dayRange(sale.first, sale.last))} ${statusTag(sale)}</span>
            <span class="sale-title">${esc(sale.title)}</span>
            <span class="place">${where}</span>
            ${sale.company ? `<span class="company">${esc(sale.company)}</span>` : ''}
          </span>
        </a>
      </li>`;
}

function mapData(city, sales) {
  return {
    center: city.center ? [city.center.lat, city.center.lng] : null,
    pins: sales.filter(sale => sale.lat !== null).map(sale => ({
      n: sale.number, id: sale.id, title: sale.title, when: dayRange(sale.first, sale.last),
      where: placeOf(sale) || city.name, lat: sale.lat, lng: sale.lng,
      approx: sale.approximate, ended: sale.ended, url: href(salePath(sale)),
    })),
  };
}

// The map beside the list. Used by the home page, city pages and weekend pages.
function results(city, sales, {weekend = false} = {}) {
  const empty = weekend
    ? `<p class="empty">No ${esc(city.name)} sale in the feed is open ${esc(dayRange(city.weekend.first, city.weekend.last, longDay))}. <a href="${href(`/${city.slug}/`)}">See every upcoming sale</a>.</p>`
    : `<p class="empty">The ${esc(city.name)} feed has no sales right now. It is rebuilt every day, so check back soon.</p>`;
  const cards = sales.map(sale => {
    if (!weekend) return saleCard(sale, city);
    const open = sale.sessions.filter(session => city.weekend.days.includes(session.date));
    return saleCard(sale, city, open.map(session => `${formatDay(session.date, {weekday: 'short'})} ${hours(session)}`).join(' · '));
  });
  return `<div class="results">
    <section class="map-pane" aria-labelledby="map-heading">
      <div class="pane-head"><h2 id="map-heading">Sale map</h2><div class="legend"><span><i class="legend-exact"></i>Street address</span><span><i class="legend-area"></i>Approximate area</span></div></div>
      <div id="map" class="map" role="region" aria-label="Map of ${esc(city.name)} estate sales"></div>
      <p id="map-status" class="note" hidden>The street map could not load. Every sale is still in the list.</p>
      <noscript><p class="note">The map needs JavaScript. Every sale is in the list.</p></noscript>
    </section>
    <section class="list-pane" aria-labelledby="list-heading">
      <div class="pane-head"><h2 id="list-heading">Sale list</h2></div>
      ${sales.length ? `<ol class="sale-list" id="sale-list">
      ${cards.join('\n      ')}
      </ol>` : empty}
    </section>
  </div>`;
}

const previewTag = '<span class="tag tag-preview">Preview</span>';

// Shown at the top of every page of a proving city: its map, its weekend page and its sale pages.
function previewBanner(city) {
  if (!city.preview) return '';
  return `<p class="preview-banner" id="preview-banner"><strong>Preview — still proving itself.</strong> ${esc(city.name)} is new on The Dig. Its sales are collected the same way as a live city's, but the feed is still being checked day by day, so a sale can be missing. Confirm every sale on its original listing.</p>
  `;
}

// The short "where The Dig works" row on the home page.
function regionsStrip(cities) {
  const item = city => `<li data-region="${city.slug}" data-status="${city.status}" data-count="${city.sales.length}"><a href="${href(`/${city.slug}/`)}"><strong>${esc(city.name)}</strong>${city.preview ? ' ' + previewTag : ''}<span>${plural(city.sales.length, 'sale')}</span></a></li>`;
  return `<section class="regions-strip" id="regions-strip" aria-labelledby="regions-strip-heading">
    <h2 id="regions-strip-heading">Where The Dig works</h2>
    <ul>
      ${cities.map(item).join('\n      ')}
    </ul>
    <a class="text-link" href="${href('/regions/')}">All regions</a>
  </section>`;
}

function countLine(city) {
  const ended = city.sales.filter(sale => sale.ended).length;
  const split = ended ? ` <span class="count-split">${city.sales.length - ended} still to come, ${ended} ended</span>` : '';
  return `<p class="count" id="sale-count" data-city="${city.slug}" data-sale-count="${city.sales.length}"><strong>${city.sales.length}</strong> ${city.sales.length === 1 ? 'estate sale' : 'estate sales'} in the ${esc(city.name)} feed.${split}</p>`;
}

function freshness(city) {
  const collected = city.collected
    ? `Feed collected <time datetime="${city.collected.iso}">${esc(city.collected.full)}</time>.`
    : '';
  return `<p class="fresh">${collected} Open and ended labels are for <time datetime="${city.today}" id="built-for">${esc(longDay(city.today))}</time>, ${esc(city.zone)}.</p>`;
}

function sourcesNote(city) {
  if (!city.sourceCounts.length) return '';
  const list = city.sourceCounts.map(source => `${esc(source.name)} (${source.included})`).join(', ');
  const pooled = city.listings && city.listings !== city.sales.length
    ? ` ${plural(city.listings, 'listing')} pooled into ${plural(city.sales.length, 'sale')}. A sale posted on more than one board appears once and keeps every source link.`
    : '';
  return `<p class="sources-note">Pooled from ${list}.${pooled}</p>`;
}

function areaLine(city) {
  if (city.radiusMiles && city.centerLabel) return `Within ${city.radiusMiles} miles of ${esc(city.centerLabel)}`;
  if (city.radiusMiles) return `Within ${city.radiusMiles} miles of the ${esc(city.name)} area center`;
  return `The ${esc(city.name)} area`;
}

function tabs(city, current) {
  const tab = (key, path, label) => `<a href="${href(path)}"${current === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="tabs" aria-label="${esc(city.name)} sales">
    ${tab('all', `/${city.slug}/`, `All sales <span>${city.sales.length}</span>`)}
    ${tab('weekend', `/${city.slug}/this-weekend/`, `This weekend <span>${city.weekendSales.length}</span>`)}
  </nav>`;
}

function itemList(name, sales) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: sales.length,
    itemListElement: sales.map((sale, index) => ({'@type': 'ListItem', position: index + 1, name: sale.title, url: abs(salePath(sale))})),
  };
}

// ── Pages ───────────────────────────────────────────────────────────────────
function homePage(context) {
  const {cities, apk} = context;
  const city = cities[0];
  const title = `Estate sales near me: ${city.name} estate sale map | The Dig`;
  const description = clip(`Find estate sales near you. The Dig pools ${plural(city.sales.length, 'estate sale')} in ${city.name} from the public listing boards onto one map, with dates, hours and a link back to every original listing.`, 300);
  const body = `<div class="frame">
  <section class="hero">
    <div class="hero-text">
      <h1>Every estate sale near you, on one map.</h1>
      <p class="lede">${esc(TAGLINE)}</p>
      <div class="actions">
        <a class="button button-primary" href="${esc(apk.url)}">${icon('download')}Get the Android app</a>
        <a class="button" href="${href(`/${city.slug}/this-weekend/`)}">${icon('calendar')}${esc(city.name)} this weekend</a>
      </div>
      <p class="fine">Free Android app, ${esc(apk.tag)}. A direct APK download from GitHub, not the Play Store. <a href="${esc(apk.page)}">Release notes</a></p>
    </div>
    <dl class="facts">
      <div><dt>${esc(city.name)} sales in the feed</dt><dd>${city.sales.length}</dd></div>
      <div><dt>Open this weekend</dt><dd>${city.weekendSales.length}</dd></div>
      <div><dt>Feed collected</dt><dd class="facts-text">${city.collected ? esc(city.collected.day) : 'Not stated'}</dd></div>
    </dl>
  </section>
  ${regionsStrip(cities)}
  <section aria-labelledby="city-heading">
    <div class="section-intro">
      <div>
        <h2 class="city-heading" id="city-heading">Estate sales in ${esc(city.name)}</h2>
        <p class="area">${icon('pin')}${areaLine(city)}</p>
      </div>
      ${tabs(city, 'all')}
    </div>
    ${countLine(city)}
    ${freshness(city)}
    ${results(city, city.sales)}
    ${sourcesNote(city)}
  </section>
  <section class="how" aria-labelledby="how-heading">
    <h2 id="how-heading">How The Dig works</h2>
    <div class="how-grid">
      <div><h3>One map per city</h3><p>Estate sales are scattered across several listing boards. The Dig reads the public ones and puts every sale it finds on one map and one list.</p></div>
      <div><h3>Facts shown</h3><p>You see what the listing published: the title, the company, the dates and hours, and the address once the company releases it. Nothing is added or guessed.</p></div>
      <div><h3>Always linked back</h3><p>Every sale links to its original listing for photos, terms and the latest changes. The listing is the authority. Check it before you travel.</p></div>
    </div>
  </section>
  <section class="split" aria-labelledby="find-heading">
    <div>
      <h2 id="find-heading">Search every city</h2>
      <p>Look for a word in a sale's title or company across ${cities.length === 1 ? esc(city.name) : `all ${cities.length} cities`}, or pick a category such as tools, furniture or vinyl.</p>
      <form class="search-box" role="search" action="${href('/search/')}" method="get">
        <input type="search" name="q" aria-label="Search sale titles and companies" placeholder="Search sales" autocomplete="off" enterkeyhint="search">
        <button class="button button-primary" type="submit">${icon('search')}Search</button>
      </form>
    </div>
    <div>
      <h2>Run estate sales?</h2>
      <p>Companies will soon be able to list a sale on The Dig directly, for free.</p>
      <p><a class="button" href="${href('/list-your-sale/')}">How listing will work</a></p>
    </div>
  </section>
</div>`;
  put('/', layout({...context, path: '/', title, description, body, city, map: mapData(city, city.sales),
    jsonLd: [{'@context': 'https://schema.org', '@type': 'WebSite', name: 'The Dig', url: abs('/'), description: TAGLINE,
      potentialAction: {'@type': 'SearchAction', target: abs('/search/') + '?q={search_term_string}', 'query-input': 'required name=search_term_string'}},
      itemList(`Estate sales in ${city.name}`, city.sales)]}));
  pages.push({path: '/', lastmod: city.collectedAt});
}

function cityPage(context, city) {
  const path = `/${city.slug}/`;
  const title = `Estate sales in ${city.name}${city.preview ? ' (preview)' : ''}: map, dates and hours | The Dig`;
  const description = clip(`${city.preview ? 'Preview: ' : ''}${plural(city.sales.length, 'estate sale')} in ${city.name} on one map. See what is open this weekend, with dates, hours and a link back to each original listing. Find estate sales near you${city.collected ? `, updated ${city.collected.day}` : ''}.`, 300);
  const body = `<div class="frame">
  ${previewBanner(city)}<div class="page-head">
    <div>
      <h1>Estate sales in ${esc(city.name)}</h1>
      <p class="area">${icon('pin')}${areaLine(city)}</p>
    </div>
    ${tabs(city, 'all')}
  </div>
  ${countLine(city)}
  ${freshness(city)}
  ${results(city, city.sales)}
  ${sourcesNote(city)}
  <p class="feed-link">The same sales as data: <a href="${esc(city.feedUrl)}">${esc(city.name)} JSON feed</a>.</p>
</div>`;
  put(path, layout({...context, path, title, description, body, city, map: mapData(city, city.sales),
    jsonLd: [itemList(`Estate sales in ${city.name}`, city.sales)]}));
  pages.push({path, lastmod: city.collectedAt});
}

function weekendPage(context, city) {
  const path = `/${city.slug}/this-weekend/`;
  const {weekend, weekendSales} = city;
  const span = dayRange(weekend.first, weekend.last, longDay);
  const title = `Estate sales in ${city.name} this weekend (${compactRange(weekend.first, weekend.last)})${city.preview ? ', preview' : ''} | The Dig`;
  const description = clip(`${city.preview ? 'Preview: ' : ''}${plural(weekendSales.length, 'estate sale')} in ${city.name} open this weekend, ${span}. One map with hours and a link back to each original listing. Find estate sales near you.`, 300);
  const body = `<div class="frame">
  ${previewBanner(city)}<div class="page-head">
    <div>
      <h1>Estate sales in ${esc(city.name)} this weekend</h1>
      <p class="area">${icon('calendar')}${esc(span)}</p>
    </div>
    ${tabs(city, 'weekend')}
  </div>
  <p class="count" id="weekend-count" data-city="${city.slug}" data-weekend-count="${weekendSales.length}"><strong>${weekendSales.length}</strong> of ${plural(city.sales.length, `${esc(city.name)} sale`)} ${weekendSales.length === 1 ? 'is' : 'are'} open ${esc(dayRange(weekend.first, weekend.last))}.</p>
  ${freshness(city)}
  ${results(city, weekendSales, {weekend: true})}
  ${sourcesNote(city)}
</div>`;
  put(path, layout({...context, path, title, description, body, city, map: mapData(city, weekendSales),
    jsonLd: [itemList(`Estate sales in ${city.name} this weekend`, weekendSales)]}));
  pages.push({path, lastmod: city.collectedAt});
}

function eventData(sale, city) {
  const place = {
    '@type': 'Place',
    name: sale.addressHidden ? `${placeOf(sale) || city.name} (address releases closer to the sale)` : sale.street,
    address: {
      '@type': 'PostalAddress',
      ...(sale.addressHidden ? {} : {streetAddress: sale.street}),
      ...(sale.town ? {addressLocality: sale.town} : {}),
      ...(sale.state ? {addressRegion: sale.state} : {}),
      ...(sale.zip ? {postalCode: sale.zip} : {}),
      addressCountry: 'US',
    },
    ...(sale.lat !== null && !sale.approximate ? {geo: {'@type': 'GeoCoordinates', latitude: sale.lat, longitude: sale.lng}} : {}),
  };
  const start = session => isoMoment(session.date, session.start, city.timeZone);
  const end = session => isoMoment(session.date, session.end, city.timeZone);
  const first = sale.sessions[0];
  const last = sale.sessions.at(-1);
  const source = sale.sources[0];
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: sale.title,
    description: sale.excerpt || `Estate sale${sale.company ? ` by ${sale.company}` : ''} in ${placeOf(sale) || city.name}. Open ${dayRange(sale.first, sale.last)}.${source ? ` Details from the original listing on ${source.name}.` : ''}`,
    startDate: start(first),
    endDate: end(last),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: place,
    ...(sale.company ? {organizer: {'@type': 'Organization', name: sale.company}} : {}),
    url: abs(salePath(sale)),
    ...(sale.sources.length ? {sameAs: sale.sources.map(item => item.url)} : {}),
    ...(sale.sessions.length > 1 ? {subEvent: sale.sessions.map(session => ({
      '@type': 'Event', name: `${sale.title} (${shortDay(session.date)})`, startDate: start(session), endDate: end(session), location: place,
    }))} : {}),
  };
}

function salePage(context, sale, city) {
  const path = salePath(sale);
  const place = placeOf(sale);
  const span = dayRange(sale.first, sale.last);
  const town = sale.town || city.name;
  const title = `${clip(sale.title, 58)}: ${town} estate sale, ${compactRange(sale.first, sale.last)} | The Dig`;
  const source = sale.sources[0];
  const description = clip(`Estate sale${sale.company ? ` by ${sale.company}` : ''} in ${place || city.name}, open ${span}. `
    + (sale.addressHidden ? 'The address releases closer to the sale. ' : `${sale.street}. `)
    + `Session hours and a link to the original listing${source ? ` on ${source.name}` : ''}.`, 300);
  const where = sale.addressHidden
    ? `<p class="address address-hidden">Address releases closer to the sale</p>
        <p>${esc(place || city.name)}${place ? ' area' : ''}. The company has not published the street address yet. It usually appears on the original listing shortly before the sale opens.</p>`
    : `<p class="address">${esc(sale.street)}${place ? `<br>${esc(place)}` : ''}</p>
        <p class="note">Confirm the address on the original listing before you travel.</p>`;
  const rows = sale.sessions.map(session => {
    const state = session.date < city.today ? ' class="past"' : session.date === city.today ? ' class="is-today"' : '';
    return `<tr${state} data-day="${session.date}"><th scope="row"><time datetime="${session.date}">${esc(longDay(session.date))}</time></th><td>${esc(hours(session))}</td></tr>`;
  }).join('\n          ');
  const links = sale.sources.map((item, index) => `<a class="button${index ? '' : ' button-primary'}" href="${esc(item.url)}" rel="noopener external">View the ${index ? 'listing' : 'original listing'} on ${esc(item.name)}${icon('arrow')}</a>`).join('\n          ');
  const mapNote = sale.lat === null ? ''
    : sale.approximate ? '<p class="note">The circle marks the general area, not the house.</p>'
    : '<p class="note">Pin placed from the listed street address.</p>';
  const body = `<div class="frame">
  ${previewBanner(city)}<article class="sale-page">
    <p class="crumbs"><a href="${href(`/${city.slug}/`)}">Estate sales in ${esc(city.name)}</a></p>
    <p class="dates dates-large">${esc(span)} ${statusTag(sale)}</p>
    <h1>${esc(sale.title)}</h1>
    ${sale.company ? `<p class="by">Run by ${esc(sale.company)}</p>` : ''}
    <div class="sale-grid">
      <div class="sale-facts">
        <section>
          <h2>Where</h2>
          ${where}
        </section>
        <section>
          <h2>When</h2>
          <table class="sessions">
          <tbody>
          ${rows}
          </tbody>
          </table>
          <p class="note">Times are local to ${esc(city.name)}, ${esc(city.zone)}.</p>
        </section>
        ${sale.excerpt ? `<section>
          <h2>From the listing</h2>
          <p class="excerpt">${esc(sale.excerpt)}</p>
        </section>` : ''}
        <section class="source">
          <h2>Original listing</h2>
          ${sale.sources.length ? `<p>The Dig shows the facts. Photos, terms and any last-minute changes are on the original listing.</p>
          <div class="actions">
          ${links}
          </div>` : '<p>The feed does not carry a source link for this sale.</p>'}
        </section>
      </div>
      ${sale.lat === null ? '' : `<div class="sale-map">
        <div id="map" class="map map-small" role="region" aria-label="Map of this sale"></div>
        <p id="map-status" class="note" hidden>The street map could not load.</p>
        ${mapNote}
      </div>`}
    </div>
    <p class="more"><a class="text-link" href="${href(`/${city.slug}/`)}">All estate sales in ${esc(city.name)}</a> · <a class="text-link" href="${href(`/${city.slug}/this-weekend/`)}">${esc(city.name)} this weekend</a></p>
  </article>
</div>`;
  put(path, layout({...context, path, title, description, body, city, jsonLd: [eventData(sale, city)],
    map: sale.lat === null ? null : {...mapData(city, [sale]), single: true}}));
  pages.push({path, lastmod: city.collectedAt});
}

function regionCard(city) {
  const meta = [
    `${city.weekendSales.length} open this weekend`,
    city.collected ? `collected <time datetime="${city.collected.iso}">${esc(city.collected.day)}</time>` : 'collection time not stated',
    ...(city.preview && city.cleanRuns !== null ? [`${plural(city.cleanRuns, 'clean collection run')} so far`] : []),
  ];
  return `<li class="region${city.preview ? ' is-preview' : ''}" data-region="${city.slug}" data-status="${city.status}" data-count="${city.sales.length}">
        <a href="${href(`/${city.slug}/`)}">
          <span class="region-name"><strong>${esc(city.name)}</strong>${city.preview ? ' ' + previewTag : ''}</span>
          <span class="region-count"><b>${city.sales.length}</b> ${city.sales.length === 1 ? 'estate sale' : 'estate sales'} in the feed</span>
          <span class="region-meta">${meta.join(' · ')}</span>
          <span class="region-go">${city.preview ? `Preview ${esc(city.name)}` : `See ${esc(city.name)} sales`}${icon('arrow')}</span>
        </a>
      </li>`;
}

// /regions/: where The Dig works. Every city and count on it comes from the index and the feeds.
function regionsPage(context) {
  const {cities, cityIndex} = context;
  const path = '/regions/';
  const live = cities.filter(city => !city.preview);
  const proving = cities.filter(city => city.preview);
  const names = list => list.map(city => city.name).join(', ');
  const title = 'Regions: where The Dig maps estate sales | The Dig';
  const description = clip(`The Dig is live in ${names(live)} with ${plural(live.reduce((sum, city) => sum + city.sales.length, 0), 'estate sale')} on the map`
    + (proving.length ? `, and in preview in ${names(proving)}` : '')
    + '. See every live city, the cities on the way, and what comes next. Texas is first.', 300);
  const body = `<div class="frame">
  <div class="regions-head">
    <h1>Where The Dig works</h1>
    <p class="lede">The Dig covers one metro area at a time, and Texas is first. Every count on this page is read from that city's public feed each time the site is rebuilt.</p>
  </div>
  <section class="region-block" id="live" aria-labelledby="live-heading">
    <h2 id="live-heading">Live now</h2>
    <p class="region-intro">Collected every day, with a map, a weekend page and a page for every sale.</p>
    <ul class="region-list" id="live-list">
      ${live.map(regionCard).join('\n      ')}
    </ul>
  </section>
  <section class="region-block" id="preview" aria-labelledby="preview-heading">
    <h2 id="preview-heading">On the way ${previewTag}</h2>
    <p class="region-intro">A preview city is collected the same way as a live one, but it is still proving itself. Its count is real and current, and a sale can be missing. It moves up to Live now once its daily collection has held up.</p>
    ${proving.length ? `<ul class="region-list" id="preview-list">
      ${proving.map(regionCard).join('\n      ')}
    </ul>` : '<p class="empty" id="no-preview">No city is in preview today. A city appears here, with its real count, on the first daily rebuild after its feed is published.</p>'}
  </section>
  <section class="region-block" id="more-states" aria-labelledby="states-heading">
    <h2 id="states-heading">More states coming</h2>
    <p>Texas is first, and more states are being scouted. No place is named here and no count is shown until a real feed stands behind it.</p>
  </section>
  <p class="feed-link">Looking for one thing? <a href="${href('/search/')}">Search every city at once</a>.${cityIndex ? ` The same list as data: <a href="${esc(cityIndex)}">city index</a>.` : ''}</p>
</div>`;
  put(path, layout({...context, path, title, description, body, jsonLd: [{
    '@context': 'https://schema.org', '@type': 'ItemList', name: 'Cities on The Dig', numberOfItems: cities.length,
    itemListElement: cities.map((city, position) => ({'@type': 'ListItem', position: position + 1,
      name: `Estate sales in ${city.name}${city.preview ? ' (preview)' : ''}`, url: abs(`/${city.slug}/`)})),
  }]}));
  pages.push({path, lastmod: latestCollected(cities)});
}

const latestCollected = cities => cities.map(city => city.collectedAt).filter(Boolean).sort().at(-1) ?? null;
const categoryLabel = new Map(CATEGORIES.map(category => [category.id, category.label]));

function searchHit({sale, city, cats, tags}) {
  const town = sale.town && fold(sale.town) !== fold(city.name) ? ` · ${esc(sale.town)}` : '';
  const labels = [...cats.map(id => categoryLabel.get(id)), ...tags];
  return `<li class="sale hit${sale.ended ? ' is-ended' : ''}" data-id="${sale.id}" data-last="${sale.last}">
        <a href="${href(salePath(sale))}">
          <span class="sale-text">
            <span class="dates">${esc(dayRange(sale.first, sale.last))}${sale.ended ? ' <span class="tag tag-ended">Ended</span>' : ''}</span>
            <span class="sale-title">${esc(sale.title)}</span>
            ${sale.company ? `<span class="company">${esc(sale.company)}</span>` : ''}
            <span class="place">${esc(city.name)}${city.preview ? ' ' + previewTag : ''}${town}</span>
            ${labels.length ? `<span class="cats">${labels.map(label => `<span class="cat">${esc(label)}</span>`).join('')}</span>` : ''}
          </span>
        </a>
      </li>`;
}

// /search/: every sale page, grouped by city. The page holds every result;
// assets/search.js hides the ones that do not match, using /search/data.json.
function searchPage(context) {
  const {cities, hits, searchFeed} = context;
  const path = '/search/';
  const groups = cities.map(city => ({city, hits: hits.filter(hit => hit.city === city)})).filter(group => group.hits.length);
  const where = groups.length === 1 ? groups[0].city.name : `${groups.length} cities`;
  const title = 'Search estate sales across every city | The Dig';
  const description = clip(`Search ${plural(hits.length, 'estate sale')} across ${where} by keyword or category: tools, furniture, vinyl and records, jewelry, collectibles and more. Every result links to its sale page.`, 300);
  const chips = CATEGORIES.map(category => {
    const count = hits.filter(hit => hit.cats.includes(category.id)).length;
    return `<button type="button" class="chip" data-cat="${category.id}" aria-pressed="false"${count ? '' : ' disabled'}>${esc(category.label)} <span>${count}</span></button>`;
  });
  const fromFeed = hits.filter(hit => hit.fromFeed).length;
  const categoryNote = !fromFeed
    ? 'Categories are read from each listing’s title, so a sale can be missing from a category it belongs in.'
    : 'Categories come from The Dig’s combined search feed.'
      + (fromFeed < hits.length ? ` For ${plural(hits.length - fromFeed, 'sale')} it does not list yet, they are read from the listing’s title.` : '');
  const body = `<div class="frame">
  <div class="search-head">
    <h1>Search every city</h1>
    <p class="lede">${groups.length === 1 ? `One search across every city on The Dig. Today that is ${esc(where)}.` : `One search across all ${esc(where)} on The Dig, live and preview.`} Type a word, pick a category, or both.</p>
  </div>
  <form class="search-form" id="search-form" role="search" action="${href(path)}" method="get">
    <label for="q">Search sale titles and companies</label>
    <div class="search-box">
      <input type="search" id="q" name="q" placeholder="A word from a title or a company name" autocomplete="off" spellcheck="false" enterkeyhint="search">
      <button class="button button-primary" type="submit">${icon('search')}Search</button>
    </div>
    <div class="chips" id="chips" role="group" aria-label="Categories">
      ${chips.join('\n      ')}
      <button type="button" class="chip chip-clear" id="clear-filters" hidden>Clear</button>
    </div>
  </form>
  <p class="count" id="result-count" role="status" data-total="${hits.length}" data-cities="${groups.length}"><strong>${hits.length}</strong> ${hits.length === 1 ? 'sale' : 'sales'} across ${plural(groups.length, 'city', 'cities')}.</p>
  <p class="fresh" id="search-scope">Search covers listing titles and companies today — searching inside photos is coming later. ${categoryNote}</p>
  <p class="note" id="search-status" hidden>Search could not load its data. Every sale is still listed below.</p>
  <noscript><p class="note">Filtering needs JavaScript. Every sale is listed below, grouped by city.</p></noscript>
  <p class="empty" id="no-results" hidden>No sale matches. Try a shorter word, or clear a category.</p>
  <div id="results" data-source="${href('/search/data.json')}">
    ${groups.length ? '' : '<p class="empty">No feed has a sale right now. The site is rebuilt every day, so check back soon.</p>'}${groups.map(group => `<section class="search-group" id="results-${group.city.slug}" data-city="${group.city.slug}" data-status="${group.city.status}" data-total="${group.hits.length}" data-time-zone="${esc(group.city.timeZone)}" data-built-for="${group.city.today}" aria-labelledby="group-${group.city.slug}">
      <h2 id="group-${group.city.slug}"><a href="${href(`/${group.city.slug}/`)}">${esc(group.city.name)}</a>${group.city.preview ? ' ' + previewTag : ''} <span class="group-count">${plural(group.hits.length, 'sale')}</span></h2>
      <ol class="hit-list">
      ${group.hits.map(searchHit).join('\n      ')}
      </ol>
    </section>`).join('\n    ')}
  </div>
</div>`;
  put(path, layout({...context, path, title, description, body, search: true}));
  pages.push({path, lastmod: latestCollected(cities)});
  put('/search/data.json', JSON.stringify(searchData(context), null, 1) + '\n');
}

// The file the search box reads. One record per sale page, so a result can never link to a missing page.
function searchData({cities, hits, searchFeed}) {
  const fromFeed = hits.filter(hit => hit.fromFeed).length;
  return {
    about: 'Every sale page on The Dig, for the search box on /search/. Rebuilt with the site. A keyword matches the start of any word in a sale\'s title, company or categories.',
    site: SITE_URL,
    categoriesFrom: !fromFeed ? 'listing titles' : fromFeed === hits.length ? searchFeed.url
      : `${searchFeed.url} for ${plural(fromFeed, 'sale')}, listing titles for ${hits.length - fromFeed}`,
    categories: CATEGORIES.map(({id, label}) => ({id, label})),
    cities: cities.map(city => ({slug: city.slug, name: city.name, status: city.status, timeZone: city.timeZone,
      results: hits.filter(hit => hit.city === city).length, url: abs(`/${city.slug}/`)})),
    sales: hits.map(({sale, city, cats, tags}) => ({id: sale.id, city: city.slug, title: sale.title, company: sale.company,
      categories: cats, ...(tags.length ? {tags} : {}), first: sale.first, last: sale.last, lat: sale.lat, lng: sale.lng,
      url: abs(salePath(sale)), source: sale.sources[0]?.url ?? null})),
  };
}

function listingPage(context) {
  const path = '/list-your-sale/';
  const subject = 'List my sale on The Dig';
  const message = ['Hello,', '', 'Please list my sale on The Dig.', '', 'Company name:', 'Sale title:',
    'Street address (say if it should stay hidden until closer to the sale):', 'City and ZIP:', 'Dates and hours:',
    'Link to the full listing or photos:', 'Contact name and phone:', '', 'Thank you.'].join('\r\n');
  const mailto = `mailto:${LISTING_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
  const cities = context.cities;
  const cityList = cities.map(city => `<a href="${href(`/${city.slug}/`)}">${esc(city.name)}</a>`).join(', ');
  const title = 'List your estate sale for free | The Dig';
  const description = 'Estate sale companies will soon list sales on The Dig directly, for free. See how listing will work and send the details of your sale by email.';
  const body = `<div class="frame"><div class="prose">
  <h1>List your estate sale on The Dig</h1>
  <p class="lede">Estate sale companies will soon be able to list a sale on The Dig directly, for free. Direct listing is not open yet.</p>
  <h2>What it will be</h2>
  <ul>
    <li><strong>Free.</strong> No listing fee and no commission.</li>
    <li><strong>On the map.</strong> Your sale appears on your city's map and list with its dates and hours.</li>
    <li><strong>Your address, your timing.</strong> Keep the street address hidden until closer to the sale. Shoppers see the area until you release it.</li>
    <li><strong>Linked to you.</strong> Every sale on The Dig links back to its own listing, so shoppers reach your photos and terms.</li>
  </ul>
  <h2>You may already be on the map</h2>
  <p>The Dig already pools sales from the public listing boards. If your sale is posted on one of them in a city The Dig covers, look for it here: ${cityList}.</p>
  <h2>Tell us about your sale</h2>
  <p>The button opens your own email app with a message already started. Fill in the blanks and send.</p>
  <p><a class="button button-primary" id="list-button" href="${esc(mailto)}">${icon('mail')}Email my sale to The Dig</a></p>
  ${placeholderEmail ? `<p class="notice" id="email-notice"><strong>Not live yet.</strong> The address behind this button, ${esc(LISTING_EMAIL)}, is a placeholder. Mail sent to it will not be delivered. This note goes away when the listing inbox opens.</p>` : `<p class="note">Or write to <a href="${esc(mailto)}">${esc(LISTING_EMAIL)}</a>.</p>`}
  <h2>What the message asks for</h2>
  <ul>
    <li>Company name and the sale title</li>
    <li>Street address, and whether to hold it until closer to the sale</li>
    <li>City and ZIP</li>
    <li>Dates and hours for each day</li>
    <li>A link to your full listing or photos</li>
    <li>A contact name and phone number</li>
  </ul>
</div></div>`;
  put(path, layout({...context, path, title, description, body}));
  pages.push({path, lastmod: null});
}

function notFoundPage(context) {
  const body = `<div class="frame"><div class="prose">
  <h1>That page is not here</h1>
  <p class="lede">Sale pages come down when a sale leaves the feed, usually after it ends.</p>
  <ul>
    ${context.cities.map(city => `<li><a href="${href(`/${city.slug}/`)}">Estate sales in ${esc(city.name)}</a></li>`).join('\n    ')}
    <li><a href="${href('/')}">The Dig home</a></li>
  </ul>
</div></div>`;
  files.set('/404.html', layout({...context, path: '/404.html', title: 'Page not found | The Dig',
    description: 'This page is not on The Dig. Sale pages come down when a sale leaves the feed.', body, index: false}));
}

// The plain-text card served as both /agents.txt and /llms.txt. Rebuilt from the index every time.
function agentCard({cities, offSite, cityIndex, searchFeed, hits}) {
  const cityLine = city => `- ${city.name}${city.preview ? ' (preview, still proving itself)' : ''}: ${abs(`/${city.slug}/`)}
  This weekend: ${abs(`/${city.slug}/this-weekend/`)}
  JSON feed: ${city.feedUrl}
  ${plural(city.sales.length, 'sale')} in the feed${city.collectedAt ? `, collected ${city.collectedAt}` : ''}. Times are ${city.timeZone}.`;
  const live = cities.filter(city => !city.preview);
  const proving = cities.filter(city => city.preview);
  const waiting = offSite.length
    ? `\nThe index names ${plural(offSite.length, 'more city', 'more cities')} with no pages on this site yet (${[...new Set(offSite.map(city => city.reason.split(':')[0]))].join('; ')}).`
    : '';
  const combined = searchFeed.problem ? `Published, but this build could not read it (${searchFeed.problem}), so categories were read from listing titles.`
    : searchFeed.published ? 'Published. This site takes each sale\'s categories from it.'
    : 'Not published when this site was built (HTTP 404). Until it is, use the search data file above.';
  return `# The Dig

> ${TAGLINE}

## What it is
- A free map and list of estate sales, one page per city, rebuilt once a day from public JSON feeds.
- Each sale shows what its source listing published: title, company, dates, hours, and the street address once the company releases it.
- The Dig does not run or verify sales. The source listing is the authority.

## Cities
Live and proving are what the city index said when this site was built. Texas is first. More states are being scouted and none is named until it has a real feed.

### Live
${live.map(cityLine).join('\n')}

### Proving (preview)
${proving.length ? `${proving.map(cityLine).join('\n')}
A proving city's pages carry a "Preview — still proving itself" banner. Its counts are real, and a sale can be missing.`
    : `None at this build. A proving city appears here on the first rebuild after its feed is published at ${DATA_BASE}/cities/<slug>/sales.json`}${waiting}

## Regions and search
- Regions page (live cities, preview cities, what comes next): ${abs('/regions/')}
- Search page, across every live and proving city: ${abs('/search/')}
  Link straight to a search: ${abs('/search/')}?q=<words>&cat=<category-id>[,<category-id>]
- Search data the page filters in the browser: ${abs('/search/data.json')}
  ${plural(hits.length, 'record')}, one per sale page: id, city, title, company, categories, first and last day, lat, lng, sale page URL, source listing URL.
- Category ids: ${CATEGORIES.map(category => category.id).join(', ')}
- A keyword matches the start of any word in a sale's title, company or categories. Search does not look inside photos yet.

## Public data
- ${cityIndex ? `City index: ${cityIndex}` : `City index: not published yet. It will be ${DATA_BASE}/cities.json`}
- Combined search feed, every sale from the live and proving cities in one file: ${searchFeed.url}
  ${combined}
- Per-city feeds follow the pattern ${DATA_BASE}/cities/<slug>/sales.json
- In a feed, "addressHidden": true means no street address has been released and the map point is approximate.

## Pages
- One page per sale: ${abs('/sale/<sale-id>/')} where <sale-id> is the sale's "id" in the feed. Each has schema.org Event data.
- Sale pages are removed when a sale leaves the feed.
- Sitemap: ${abs('/sitemap.xml')}

## How to cite
Link the sale's page on The Dig and the source listing that page names. Example:
"Estate sale listed on The Dig (${abs('/sale/<sale-id>/')}), original listing: <source listing URL>."
Do not present The Dig as the organizer of a sale.

## Contact
${placeholderEmail
    ? `No contact address is live yet. ${LISTING_EMAIL} is a placeholder and does not receive mail.`
    : `${LISTING_EMAIL}`}
`;
}

function sitemap() {
  const rows = pages.map(page => {
    const date = page.lastmod && !Number.isNaN(new Date(page.lastmod).getTime()) ? new Date(page.lastmod).toISOString().slice(0, 10) : null;
    return `  <url><loc>${esc(abs(page.path))}</loc>${date ? `<lastmod>${date}</lastmod>` : ''}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`;
}

// ── Build ───────────────────────────────────────────────────────────────────
const [{cities, offSite, cityIndex}, apk, searchFeed] = await Promise.all([loadCities(), latestApk(), loadSearchFeed()]);

// One page and one search result per sale. A sale two cities share belongs to
// the first city that lists it, and live cities come before proving ones.
const hits = [];
const placed = new Map();
for (const city of cities) {
  for (const sale of city.sales) {
    if (placed.has(sale.id)) continue;
    placed.set(sale.id, city.slug);
    const listed = searchFeed.sales.get(sale.id);
    hits.push({sale, city, fromFeed: Boolean(listed), ...categorize(sale, listed)});
  }
}
const context = {cities, offSite, cityIndex, apk, searchFeed, hits};

homePage(context);
regionsPage(context);
searchPage(context);
for (const city of cities) {
  cityPage(context, city);
  weekendPage(context, city);
}
for (const hit of hits) salePage(context, hit.sale, hit.city);
listingPage(context);
notFoundPage(context);

const card = agentCard(context);
const fromFeed = hits.filter(hit => hit.fromFeed).length;
const summary = {
  site: SITE_URL,
  cityIndex,
  defaultCity: cities[0].slug,
  cities: cities.map(city => ({slug: city.slug, name: city.name, status: city.status, timeZone: city.timeZone, feedUrl: city.feedUrl,
    collectedAt: city.collectedAt, sales: city.sales.length, indexCount: city.indexCount, cleanRuns: city.cleanRuns,
    weekendSales: city.weekendSales.length, salePages: hits.filter(hit => hit.city === city).length,
    builtFor: city.today, weekend: [city.weekend.first, city.weekend.last]})),
  // Cities the index names that have no pages in this build, and why.
  offSite,
  salePages: placed.size,
  search: {
    page: abs('/search/'),
    dataFile: abs('/search/data.json'),
    records: hits.length,
    combinedFeed: searchFeed.url,
    combinedFeedPublished: searchFeed.published,
    combinedFeedProblem: searchFeed.problem,
    categoriesFromCombinedFeed: fromFeed,
    categoriesFromTitles: hits.length - fromFeed,
  },
  app: apk,
  listingEmail: LISTING_EMAIL,
  listingEmailIsPlaceholder: placeholderEmail,
};

await rm(tmpDir, {recursive: true, force: true});
await mkdir(tmpDir, {recursive: true});
await cp(new URL('static/', root), tmpDir, {recursive: true});
for (const [path, content] of files) {
  const target = new URL('.' + (path.endsWith('/') ? path + 'index.html' : path), tmpDir);
  await mkdir(new URL('./', target), {recursive: true});
  await writeFile(target, content);
}
await writeFile(new URL('sitemap.xml', tmpDir), sitemap());
await writeFile(new URL('robots.txt', tmpDir), `User-agent: *\nAllow: /\n\nSitemap: ${abs('/sitemap.xml')}\n`);
await writeFile(new URL('agents.txt', tmpDir), card);
await writeFile(new URL('llms.txt', tmpDir), card);
await writeFile(new URL('build.json', tmpDir), JSON.stringify(summary, null, 2) + '\n');
await writeFile(new URL('.nojekyll', tmpDir), '');
// Swap the finished site in only after every file was written.
await rm(outDir, {recursive: true, force: true});
await rename(tmpDir, outDir);

for (const city of cities) {
  console.log(`${city.slug} (${city.status}): ${plural(city.sales.length, 'sale')}, ${city.weekendSales.length} this weekend, feed collected ${city.collectedAt ?? 'unknown'}, built for ${city.today}`);
  if (city.indexCount !== null && city.indexCount !== city.sales.length) {
    console.warn(`NOTE: ${city.slug}: the index says ${city.indexCount} sales, its feed has ${city.sales.length}. The site shows the feed.`);
  }
}
for (const city of offSite) console.log(`${city.slug}: not on the site (${city.reason})`);
console.log(`Search: ${plural(hits.length, 'record')}; categories from search.json for ${fromFeed}, from listing titles for ${hits.length - fromFeed}`
  + ` (search.json ${searchFeed.problem ? 'unreadable' : searchFeed.published ? 'published' : 'not published yet'}).`);
console.log(`Wrote ${files.size} files to ${process.env.DIG_OUT ? outDir.pathname : 'docs/'} (${cityIndex ? 'city index' : 'no city index yet, Houston root feed'}; app ${apk.tag}).`);
if (placeholderEmail) console.log(`NOTE: the listing address is still the placeholder ${LISTING_EMAIL}.`);
