#!/usr/bin/env node
// Local preview of docs/ at the same path the live site uses.
//   node serve.mjs [port]      then open the address it prints
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';

const docs = new URL('./docs/', import.meta.url);
const summary = JSON.parse(await readFile(new URL('build.json', docs), 'utf8'));
const base = new URL(summary.site + '/').pathname.replace(/\/+$/, '');
const port = Number(process.argv[2]) || 4173;
const types = {html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript', json: 'application/json',
  svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2', txt: 'text/plain; charset=utf-8', xml: 'application/xml'};

createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  let local = path.startsWith(base + '/') ? path.slice(base.length + 1) : null;
  if (local !== null && (local === '' || local.endsWith('/'))) local += 'index.html';
  try {
    if (local === null || local.includes('..')) throw Error('outside the site');
    const body = await readFile(new URL(local, docs));
    response.writeHead(200, {'content-type': types[local.split('.').pop()] ?? 'application/octet-stream'});
    response.end(body);
  } catch {
    response.writeHead(404, {'content-type': types.html});
    response.end(await readFile(new URL('404.html', docs)));
  }
}).listen(port, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${port}${base}/`));
