import { createHash, randomBytes } from 'node:crypto';
import { storeFromEnv } from '../lib/guard.js';
import { limiter, clientIp, clientOf, crossSite } from '../lib/limit.js';

// POST {e, p}: one usage event from the page, checked against a fixed list and passed on to PostHog.
// The page's own words are never trusted: every property must be on its event's list, with the right
// type and range, or the whole event is dropped. So nothing the page could hold by mistake (a file
// name, a link, a code, an address) can get through, even from a changed page.
// See public/privacy.html for what this means to the people using Across.

const store = storeFromEnv();
const over = limiter(store);
const EVENTS_PER_MIN = Number(process.env.EVENTS_PER_MIN) || 120;
const HOST = (process.env.POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/$/, '');
const DAY_MS = 86_400_000;

const n = (max = 1e15) => (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : undefined);
const b = (v) => (typeof v === 'boolean' ? v : undefined);
const one = (...xs) => (v) => (xs.includes(v) ? v : undefined);
const re = (pattern) => (v) => (typeof v === 'string' && pattern.test(v) ? v : undefined);
// two significant figures: enough to see what people send, too coarse to pick out one file
const sig2 = (v) => (v === undefined || v < 100 ? v : Number(v.toPrecision(2)));
const rounded = (max) => (v) => sig2(n(max)(v));

const role = one('sender', 'receiver');
const via = one('link', 'code');
const route = one('lan', 'direct', 'relay', 'unknown');
const kind = one('image', 'video', 'audio', 'document', 'archive', 'code', 'app', 'other');
const ext = re(/^[a-z0-9]{1,8}$/);
const bytes = rounded(1e15);
const ms = (v) => (n(1e9)(v) === undefined ? undefined : Math.round(v));
const slug = re(/^[\w.-]{1,40}$/);

const EVENTS = {
  $pageview: { entry: one('home', 'link', 'code', 'bad'), ref: re(/^[a-z0-9.-]{1,80}$/), utm_source: slug, utm_medium: slug, utm_campaign: slug, lang: re(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/), vw: rounded(10000) },
  file_picked: { size: bytes, kind, ext, how: one('button', 'drop'), hide_ip: b },
  file_refused: { reason: one('several', 'folder') },
  code_offered: {},
  code_entered: { valid: b },
  link_copied: { ok: b },
  link_shared: {},
  connected: { role, via, route, ms, hide_ip: b },
  transfer_started: { role, size: bytes, kind, ext, sink: one('sw', 'fs', 'mem'), zip: b },
  transfer_completed: { role, via, route, size: bytes, ms, mbps: rounded(1e5), saved: one('download', 'disk') },
  transfer_failed: { role, stage: re(/^[a-z]{1,12}$/), reason: re(/^[a-z_]{1,24}$/), at: bytes, size: bytes },
  code_rejected: { reason: one('wrong', 'unknown', 'too_many', 'old_browser') },
  relay_unavailable: { role },
  js_error: { msg: re(/^[^\n]{1,160}$/), line: n(1e6) },
};
const COMMON = { s: re(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/), page: one('/', '/how', '/privacy') };

// {event, props} with only listed, well-formed properties, or null
export function clean(body) {
  if (!body || typeof body !== 'object' || !Object.hasOwn(EVENTS, body.e)) return null;
  const p = body.p ?? {};
  if (typeof p !== 'object' || Array.isArray(p)) return null;
  const allowed = { ...COMMON, ...EVENTS[body.e] };
  const props = {};
  for (const [key, value] of Object.entries(p)) {
    if (!Object.hasOwn(allowed, key)) return null;
    const ok = allowed[key](value);
    if (ok === undefined) return null;
    props[key] = ok;
  }
  return props.s && props.page ? { event: body.e, props } : null;
}

// Coarse names only; the full user agent string is never stored.
export function device(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /CrOS/.test(ua) ? 'ChromeOS'
    : /Mac OS X/.test(ua) ? 'Mac OS X' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Other';
  const type = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? 'Tablet' : /Mobi|iPhone/.test(ua) ? 'Mobile' : 'Desktop';
  return { $browser: browser, $os: os, $device_type: type };
}

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|curl|wget|python|node-fetch|undici/i;

// A visitor is a hash of their network and browser with a salt that changes daily and is never kept:
// the same person counts once a day, and nobody (us included) can link days together or get back an address.
let salt; // [day, secret]
async function visitor(ip, ua) {
  const today = new Date().toISOString().slice(0, 10);
  if (salt?.[0] !== today) {
    await store.put(`stats:salt:${today}`, randomBytes(32).toString('hex'), 2 * DAY_MS, true);
    salt = [today, await store.get(`stats:salt:${today}`)];
  }
  return createHash('sha256').update(`${salt[1]}|${clientOf(ip)}|${ua}`).digest('hex').slice(0, 32);
}

const reply = (status) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request, send = fetch) {
  if (crossSite(request)) return reply(403);
  // Global Privacy Control: the browser asked not to be tracked, so nothing is recorded
  if (request.headers.get('sec-gpc') === '1' || request.headers.get('dnt') === '1') return reply(204);
  const ua = request.headers.get('user-agent') ?? '';
  if (BOT.test(ua)) return reply(204);
  const text = await request.text().catch(() => '');
  if (text.length > 2048) return reply(413);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400);
  }
  const ok = clean(body);
  if (!ok) return reply(400);
  const ip = clientIp(request);
  if (await over(ip, 'event', EVENTS_PER_MIN, 60)) return reply(429);
  const key = process.env.POSTHOG_KEY;
  if (!key) return reply(204); // stats are off, as on a local machine

  const { s, page, ref, ...rest } = ok.props;
  const host = new URL(request.url).host;
  const country = request.headers.get('x-vercel-ip-country');
  const properties = {
    ...rest,
    ...device(ua),
    distinct_id: await visitor(ip, ua),
    $session_id: s,
    $process_person_profile: false,
    $geoip_disable: true,
    $ip: null,
    ...(/^[A-Z]{2}$/.test(country ?? '') && { $geoip_country_code: country }),
    $host: host,
    $pathname: page,
    $current_url: `https://${host}${page}`,
    ...(ref && { $referring_domain: ref, $referrer: `https://${ref}/` }),
    $lib: 'across',
  };
  const r = await send(`${HOST}/i/v0/e/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key, event: ok.event, distinct_id: properties.distinct_id, properties, timestamp: new Date().toISOString() }),
    signal: AbortSignal.timeout(3000),
  }).catch((err) => console.error('posthog', err.message));
  if (r && !r.ok) console.error('posthog', r.status);
  return reply(204);
}
