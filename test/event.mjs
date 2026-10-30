// node event.mjs: /api/event passes only listed, well-formed fields to PostHog, and nothing that could name a file or person.
process.env.POSTHOG_KEY = 'phc_test';
const { POST, clean, device } = await import('../api/event.js');

let failures = 0;
const check = (name, ok, detail = '') => { failures += !ok; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail && ` (${detail})`}`); };
const S = '0192f3a4-5b6c-7d8e-9f01-23456789abcd';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const ev = (e, p = {}) => ({ e, p: { s: S, page: '/', ...p } });
let ip = 0;
async function post(body, headers = {}) {
  const sent = [];
  const send = async (url, init) => (sent.push({ url, body: JSON.parse(init.body) }), new Response(null, { status: 200 }));
  const request = new Request('https://acrossfile.com/api/event', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'user-agent': UA, 'sec-fetch-site': 'same-origin', 'x-real-ip': `203.0.113.${++ip % 250}`, 'x-vercel-ip-country': 'NZ', ...headers },
  });
  const r = await POST(request, send);
  return { status: r.status, sent };
}

// accepted
const ok = await post(ev('transfer_completed', { role: 'sender', via: 'code', route: 'relay', size: 3_412_876_544, ms: 81234.5, mbps: 336.1 }));
const out = ok.sent[0]?.body;
check('a well-formed event is forwarded', ok.status === 204 && ok.sent.length === 1, ok.status);
check('to the PostHog capture endpoint', ok.sent[0]?.url === 'https://us.i.posthog.com/i/v0/e/');
check('size is rounded to two figures', out?.properties.size === 3_400_000_000, out?.properties.size);
check('ms is rounded', out?.properties.ms === 81235);
check('no person profile, no geoip from our address, no ip', out?.properties.$process_person_profile === false && out.properties.$geoip_disable === true && out.properties.$ip === null);
check('country comes from the edge header', out?.properties.$geoip_country_code === 'NZ');
check('session id passes through', out?.properties.$session_id === S);
check('distinct_id is a 32-hex hash, not an address', /^[0-9a-f]{32}$/.test(out?.distinct_id ?? '') && !JSON.stringify(out).includes('203.0.113'));
check('raw user agent is not stored', !JSON.stringify(out).includes('Mozilla'));
check('coarse device', JSON.stringify(device(UA)) === JSON.stringify({ $browser: 'Chrome', $os: 'Mac OS X', $device_type: 'Desktop' }));
check('same visitor, same day, same hash', (await post(ev('link_shared'), { 'x-real-ip': '198.51.100.7' })).sent[0].body.distinct_id
  === (await post(ev('link_shared'), { 'x-real-ip': '198.51.100.7' })).sent[0].body.distinct_id);
const pv = (await post(ev('$pageview', { entry: 'link', ref: 'news.ycombinator.com', utm_source: 'hn', lang: 'en-NZ', vw: 1440 }))).sent[0]?.body.properties;
check('page view has the url without any # part', pv?.$current_url === 'https://acrossfile.com/' && pv.$referring_domain === 'news.ycombinator.com');

// refused: anything that could carry a name, link, code or address
const bad = {
  'unknown event': ev('file_name', {}),
  'unknown property': ev('file_picked', { size: 1, name: 'tax return.pdf' }),
  'file name smuggled in ext': ev('file_picked', { ext: 'tax return' }),
  'link in ref': ev('$pageview', { ref: 'acrossfile.com/#abcdefghij0123456789' }),
  'code in reason': ev('transfer_failed', { reason: 'PZK MFS' }),
  'string where number': ev('file_picked', { size: '12' }),
  'negative number': ev('file_picked', { size: -1 }),
  'bad role': ev('connected', { role: 'admin' }),
  'no session id': { e: 'link_shared', p: { page: '/' } },
  'bad page': ev('link_shared', { page: '/#secret' }),
  'array props': { e: 'link_shared', p: [] },
  'multi-line error': ev('js_error', { msg: 'a\nb', line: 1 }),
};
for (const [name, body] of Object.entries(bad)) {
  const r = await post(body);
  check(`refuses ${name}`, r.status === 400 && r.sent.length === 0, r.status);
}
check('refuses non-JSON', (await post('{')).status === 400);
check('refuses oversized body', (await post('x'.repeat(3000))).status === 413);
for (const [name, headers] of Object.entries({
  'Global Privacy Control': { 'sec-gpc': '1' }, 'Do Not Track': { dnt: '1' }, bots: { 'user-agent': 'Googlebot/2.1' },
})) {
  const r = await post(ev('link_shared'), headers);
  check(`records nothing with ${name}`, r.status === 204 && r.sent.length === 0);
}
check('refuses cross-site', (await post(ev('link_shared'), { 'sec-fetch-site': 'cross-site' })).status === 403);
check('clean keeps nothing unlisted', clean({ e: 'code_offered', p: { s: S, page: '/', __proto__: { x: 1 } } })?.props.x === undefined);
process.exit(failures ? 1 : 0);
