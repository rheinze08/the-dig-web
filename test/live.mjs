#!/usr/bin/env node
// Proves the live site matches the build in docs/. Fetches without any login.
//   node test/live.mjs               check once
//   node test/live.mjs --wait 240    keep checking for up to 240 seconds (after a push)
//   node test/live.mjs --feed        also compare the home page count with the live feed
import {readFile} from 'node:fs/promises';

const args = process.argv.slice(2);
const wait = args.includes('--wait') ? Number(args[args.indexOf('--wait') + 1]) : 0;
const withFeed = args.includes('--feed');
const local = await readFile(new URL('../docs/build.json', import.meta.url), 'utf8');
const build = JSON.parse(local);
const home = build.cities[0];

async function fetchText(url) {
  // A fresh query string skips the CDN's cached copy.
  const fresh = url + (url.includes('?') ? '&' : '?') + 'check=' + Date.now();
  const response = await fetch(fresh, {redirect: 'follow', signal: AbortSignal.timeout(30000)});
  return {status: response.status, text: await response.text()};
}

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
  if (withFeed) {
    const feed = await fetchText(home.feedUrl);
    const count = feed.status === 200 ? JSON.parse(feed.text).sales.length : null;
    report.push(`Live feed ${home.feedUrl} -> HTTP ${feed.status}, ${count} sales.`);
    ok &&= count === shown;
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
