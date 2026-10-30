// [ZIP=0] [OLD=send|recv] [BUSY=send|recv|both] node link.mjs <baseUrl> <senderHides 1|0> <receiverHides 1|0> <file> [expect lan|main|any|none] [noMdns 1|0]
// SPLIT=1 puts the two sides on different networks as far as .local names go.
// BUSY makes that side's /api/ice answer 429, as when its network used up its relay passes. expect none: the
// transfer must fail with the message for that, still sending no address.
// One transfer with each side's "Hide my IP address" as given. Passes when the file arrives intact,
// the expected link carried it, and no hidden side sent the server anything carrying an address of
// this machine: its main description holds only relay candidates, its local one only .local names.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { browser, watch, startSender, download, waitFile, sha } from './lib.mjs';

const [base, sHide, rHide, file, expect = 'lan', noMdns] = process.argv.slice(2);
// a browser that offers its real local addresses instead of .local names
const args = noMdns === '1' ? ['--disable-features=WebRtcHideLocalIpsWithMdns'] : [];
const hides = { send: sHide === '1', recv: rHide === '1' };
const bytes = fs.statSync(file).size, want = sha(file), out = path.join(os.tmpdir(), `dl-link-${process.pid}`);
const mine = Object.values(os.networkInterfaces()).flat().filter((i) => !i.internal).map((i) => i.address.split('%')[0]);
const pub = (await (await fetch('https://1.1.1.1/cdn-cgi/trace')).text()).match(/^ip=(.+)$/m)?.[1];
if (pub) mine.push(pub);

// a local server reads the page once at startup, so a stale one would test old code
if (/^http:\/\/127\.0\.0\.1/.test(base)) {
  const disk = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  if ((await (await fetch(base + '/')).text()) !== disk) throw new Error(`${base} serves an old page; restart it with sh test/servers.sh`);
}
const log = [], pages = {};
for (const side of ['send', 'recv']) {
  const page = await (await browser(side === 'recv' ? out : undefined, args)).newPage();
  await watch(page, side, log);
  // OLD=send or OLD=recv: that side can't compress, like Safari before 16.4 or Firefox before 113
  // SPLIT=1: the receiver's .local names and the sender's never resolve for each other, as on two networks
  if (side === 'recv' && process.env.SPLIT === '1') {
    await page.evaluateOnNewDocument(() => {
      const real = fetch;
      const scramble = (text) => text.replace(/[0-9a-f]{8}-[0-9a-f-]{27}\.local/gi, () => `${crypto.randomUUID()}.local`);
      window.fetch = async (url, opts) => {
        if (!String(url).includes('api/signal')) return real(url, opts);
        const r = await real(url, opts?.body ? { ...opts, body: scramble(opts.body) } : opts);
        return r.status === 200 ? new Response(scramble(await r.text()), { status: 200 }) : r;
      };
    });
  }
  if ([side, 'both'].includes(process.env.BUSY)) {
    await page.evaluateOnNewDocument(() => {
      const real = fetch;
      window.fetch = (url, opts) => String(url).includes('api/ice')
        ? Promise.resolve(new Response(JSON.stringify({ relay: 'busy', retry: 600 }), { status: 429 })) : real(url, opts);
    });
  }
  if (process.env.OLD === side) {
    await page.evaluateOnNewDocument(() => {
      delete window.CompressionStream;
      delete window.DecompressionStream;
    });
  }
  await page.evaluateOnNewDocument((hide) => {
    localStorage.setItem('hide-ip', hide ? '1' : '0');
    const Real = RTCPeerConnection;
    window.__pcs = [];
    window.RTCPeerConnection = function (config) {
      const pc = new Real(config);
      __pcs.push({ pc, lan: !config?.iceServers?.length });
      return pc;
    };
    window.RTCPeerConnection.prototype = Real.prototype;
  }, hides[side]);
  pages[side] = page;
}
const link = await startSender(pages.send, base, file);
const t0 = Date.now();
// ZIP=0 makes the receiver decline compressed blocks
await pages.recv.goto(process.env.ZIP === '0' ? link.replace('#', '?zip=0#') : link);
const failures = [];
const check = (ok, what) => ok || failures.push(what);
let ready = 0, r = { secs: 0, mbps: 0, maxGap: 0, msg: '' };
if (expect === 'none') {
  const text = await pages.recv.waitForFunction(() => document.querySelector('#msg').textContent.includes("Couldn't connect without showing your IP"), { timeout: 60_000 })
    .then(() => pages.recv.$eval('#msg', (e) => e.textContent), () => '');
  check(text, `receiver never said it couldn't connect: "${await pages.recv.$eval('#msg', (e) => e.textContent)}"`);
  r.msg = text;
} else {
  await pages.recv.waitForSelector('#go:not([hidden])', { timeout: 30_000 });
  ready = Date.now() - t0;
  r = await download(pages.recv, bytes, 600_000);
  const saved = await waitFile(path.join(out, path.basename(file)), bytes);
  const got = saved ? sha(path.join(out, path.basename(file))) : 'missing';
  check(got === want, `sha ${got}, want ${want}`);
}
const cands = (sdp) => sdp.split('\r\n').filter((l) => l.startsWith('a=candidate:')).map((l) => l.split(' '));
for (const side of ['send', 'recv']) {
  const posts = pages[side].posts.filter((m) => m?.data?.sdp);
  check(posts.length > 0, `${side} posted no description`);
  for (const m of posts) {
    for (const c of cands(m.data.lan?.sdp ?? '')) check(c[7] === 'host' && /^[0-9a-f-]{36}\.local$/i.test(c[4]), `${side} local link offered ${c.slice(4, 8).join(' ')}`);
    if (!hides[side]) continue;
    // relay addresses, or .local names when there is no relay; never an address of this machine
    for (const c of cands(m.data.sdp.sdp)) check(c[7] === 'relay' || (c[7] === 'host' && /^[0-9a-f-]{36}\.local$/i.test(c[4])), `${side} is hidden but offered ${c.slice(4, 8).join(' ')}`);
    const body = JSON.stringify(m);
    for (const ip of mine) check(!body.includes(ip), `${side} is hidden but sent ${ip}`);
  }
  const used = await pages[side].evaluate(async () => {
    const live = __pcs.filter((x) => x.pc.connectionState === 'connected');
    return Promise.all(live.map(async ({ pc, lan }) => {
      const stats = await pc.getStats();
      let pair;
      stats.forEach((s) => s.type === 'transport' && (pair = stats.get(s.selectedCandidatePairId)));
      const remote = __pcs.find((x) => x.pc === pc).lan ? pc.remoteDescription.sdp : '';
      return { link: lan ? 'lan' : 'main', pair: `${stats.get(pair.localCandidateId).candidateType}->${stats.get(pair.remoteCandidateId).candidateType}`, remote };
    }));
  });
  if (expect === 'none') continue;
  check(used.length === 1, `${side} has ${used.length} connected links`);
  check(expect === 'any' || used[0]?.link === expect, `${side} used the ${used[0]?.link} link, want ${expect}`);
  for (const u of used) for (const c of cands(u.remote)) check(c[7] === 'host' && /\.local$/.test(c[4]), `${side} local link accepted ${c.slice(4, 8).join(' ')}`);
  console.log(`${side} hide=${hides[side]} link=${used.map((u) => `${u.link} ${u.pair}`).join(', ')}`);
}
console.log(`ready ${ready}ms | ${(bytes / 1e6).toFixed(0)}MB in ${r.secs.toFixed(1)}s = ${r.mbps.toFixed(1)}MB/s | max stall ${r.maxGap}ms | msg="${r.msg}"`);
// a relay that is off or busy answers 503 or 429, which the page handles
const errors = log.filter((l) => !/status of (503|429)/.test(l));
check(!errors.length, `console errors, page errors, CSP violations: ${errors.join(' | ')}`);
fs.rmSync(out, { recursive: true, force: true });
console.log(failures.length ? `FAIL\n  ${failures.join('\n  ')}` : 'PASS');
process.exit(failures.length ? 1 : 0);
