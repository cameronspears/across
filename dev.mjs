// Local stand-in for Vercel. Same page, same headers, same /api handlers.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { headerRules } from './lib/headers.js';
import * as signal from './api/signal.js';
import * as ice from './api/ice.js';
import * as guard from './api/guard.js';

const PORT = Number(process.env.PORT) || 8080;
const read = (file) => readFileSync(new URL(file, import.meta.url));
const html = read('./public/index.html');
const pages = {
  '/': { type: 'text/html; charset=utf-8', body: html },
  '/sw.js': { type: 'text/javascript; charset=utf-8', body: read('./public/sw.js') },
};
const functions = { '/api/signal': signal, '/api/ice': ice, '/api/guard': guard };
const rules = headerRules(html.toString('utf8')).map((r) => ({ ...r, match: new RegExp(`^${r.source}$`) }));
const headersFor = (path) => rules.filter((r) => r.match.test(path)).flatMap((r) => r.headers.map((h) => [h.key, h.value]));

async function api(fn, path, req, res) {
  const handler = fn[req.method];
  if (!handler) return res.writeHead(405).end();
  const aborted = new AbortController();
  res.on('close', () => aborted.abort());
  // like Vercel, the client's own x-real-ip is replaced with the address it connected from
  const headers = { ...req.headers, 'x-real-ip': req.socket.remoteAddress };
  const request = new Request(new URL(req.url, `http://${req.headers.host}`), {
    method: req.method,
    headers,
    signal: aborted.signal,
    ...(req.method !== 'GET' && req.method !== 'HEAD' && { body: Readable.toWeb(req), duplex: 'half' }),
  });
  const response = await handler(request).catch((err) => {
    console.error(err);
    return new Response(null, { status: 500 });
  });
  res.writeHead(response.status, [...headersFor(path), ...response.headers].flat());
  res.end(Buffer.from(await response.arrayBuffer()));
}

http.createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (Object.hasOwn(functions, path)) return api(functions[path], path, req, res);
  const page = pages[path];
  if (!page || (req.method !== 'GET' && req.method !== 'HEAD')) return res.writeHead(404, headersFor(path).flat()).end();
  res.writeHead(200, [...headersFor(path), ['Content-Type', page.type], ['Content-Length', page.body.length]].flat());
  res.end(req.method === 'HEAD' ? undefined : page.body);
}).listen(PORT, () => console.log(`Across on http://localhost:${PORT}`));
