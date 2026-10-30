// node app.mjs send <hide 1|0> <bytes> [page.json]   prints LINK when ready, RESULT when the receiver confirms
// node app.mjs recv <hide 1|0> <link> [page.json]
// The real app on the live origin. /api/ice is answered from this sandbox's one minted credential.
// With page.json ({ html, headers }), the document itself is answered with that copy instead.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SITE, HOME, launch, iceBody } from './common.mjs';
import { snap, diff } from './procs.mjs';

const [role, hideArg, arg, pageFile] = process.argv.slice(2);
const hide = hideArg === '1';
const copy = pageFile ? JSON.parse(fs.readFileSync(pageFile, 'utf8')) : null;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const out = `${HOME}/dl`;
const log = [];

const browser = await launch();
let result;
try {
  const page = await browser.newPage();
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warn') && log.push(`console.${m.type()} ${m.text()}`));
  page.on('pageerror', (e) => log.push(`pageerror ${e.message}`));
  const cdp = await page.createCDPSession();
  const patterns = [{ urlPattern: `${SITE}/api/ice*` }];
  if (copy) patterns.push({ urlPattern: `${SITE}/`, resourceType: 'Document' });
  await cdp.send('Fetch.enable', { patterns });
  const b64 = (s) => Buffer.from(s).toString('base64');
  cdp.on('Fetch.requestPaused', ({ requestId, request }) => {
    const ice = request.url.startsWith(`${SITE}/api/ice`);
    // the copy's second link asks api/ice?n=2 and gets this sandbox's second credential
    const body = ice ? iceBody(/[?&]n=2\b/.test(request.url) ? 1 : 0) : copy.html;
    const headers = ice ? [{ name: 'Content-Type', value: 'application/json' }, { name: 'Cache-Control', value: 'no-store' }]
      : [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }, ...copy.headers];
    cdp.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: headers, body: b64(body) }).catch(() => {});
  });
  await page.evaluateOnNewDocument((hide) => {
    localStorage.setItem('hide-ip', hide ? '1' : '0');
    const Real = RTCPeerConnection;
    window.__pcs = [];
    window.RTCPeerConnection = function (config) {
      const pc = new Real(config);
      __pcs.push({ pc, config });
      return pc;
    };
    window.RTCPeerConnection.prototype = Real.prototype;
  }, hide);
  const linkStats = () => page.evaluate(async () => Promise.all(__pcs.filter((x) => x.pc.connectionState === 'connected').map(async ({ pc, config }) => {
    const stats = await pc.getStats();
    let pair;
    stats.forEach((s) => s.type === 'transport' && (pair = stats.get(s.selectedCandidatePairId)));
    const l = stats.get(pair.localCandidateId), r = stats.get(pair.remoteCandidateId);
    return {
      policy: config?.iceTransportPolicy ?? 'all', servers: config?.iceServers?.length ?? 0,
      local: `${l.candidateType}/${l.protocol}/${l.relayProtocol ?? '-'}/${l.url ?? ''}`, remote: `${r.candidateType}/${r.protocol}`,
      rttMs: pair.currentRoundTripTime * 1000, sent: pair.bytesSent, received: pair.bytesReceived,
      maxMessageSize: pc.sctp?.maxMessageSize,
    };
  })));

  if (role === 'send') {
    const bytes = Number(arg), file = `${HOME}/f-${bytes}.bin`;
    if (!fs.existsSync(file) || fs.statSync(file).size !== bytes) execFileSync('head', ['-c', String(bytes), '/dev/urandom'], { stdio: ['ignore', fs.openSync(file, 'w'), 'inherit'] });
    const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    await page.goto(`${SITE}/`);
    await (await page.$('#file')).uploadFile(file);
    await page.waitForFunction(() => document.querySelector('#link').href.includes('#'));
    console.log('LINK ' + await page.$eval('#link', (e) => e.href));
    await page.waitForFunction(() => document.querySelector('#xfers small')?.textContent === 'Sending', { timeout: 120_000, polling: 50 });
    const a = snap();
    await page.waitForFunction(() => /Received|Stopped|Disconnected|Cancelled/.test(document.querySelector('#xfers small')?.textContent), { timeout: 600_000, polling: 100 });
    const b = snap();
    const label = await page.$eval('#xfers small', (e) => e.textContent);
    result = { bytes, sha, label, links: await linkStats(), cpu: diff(a, b) };
  } else {
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    const bcdp = await browser.target().createCDPSession();
    await bcdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: out, eventsEnabled: true });
    await page.goto(arg);
    await page.waitForSelector('#go:not([hidden])', { timeout: 60_000 });
    const links = await linkStats();
    // MB/s per 0.5 s, from the transport bytes of every connected link (the copy may have two)
    await page.evaluate(() => {
      window.__tl = [];
      let last = 0;
      setInterval(async () => {
        let n = 0;
        for (const { pc } of __pcs) {
          if (pc.connectionState !== 'connected') continue;
          (await pc.getStats()).forEach((s) => s.type === 'transport' && (n += s.bytesReceived));
        }
        __tl.push(+((n - last) / 0.5e6).toFixed(1));
        last = n;
      }, 500);
    });
    const a = snap(), t0 = Date.now();
    await page.click('#go');
    await page.waitForFunction(() => /done/.test(document.querySelector('#r-xfer p > span')?.textContent) || document.querySelector('#msg').textContent,
      { timeout: 600_000, polling: 50 });
    const secs = (Date.now() - t0) / 1000;
    const b = snap();
    const msg = await page.$eval('#msg', (e) => e.textContent);
    let file;
    for (const end = Date.now() + 30_000; Date.now() < end; await sleep(200)) {
      file = fs.readdirSync(out).find((f) => !f.endsWith('.crdownload'));
      if (file) break;
    }
    const sha = file ? crypto.createHash('sha256').update(fs.readFileSync(`${out}/${file}`)).digest('hex') : null;
    const bytes = file ? fs.statSync(`${out}/${file}`).size : 0;
    fs.rmSync(out, { recursive: true, force: true });
    const timeline = await page.evaluate(() => __tl.slice(1));
    const linksAfter = await linkStats();
    result = { secs, MBps: bytes / 1e6 / secs, bytes, sha, msg, links, linksAfter, timeline, cpu: diff(a, b) };
  }
  result.chrome = await browser.version();
} catch (err) {
  result = { error: String(err?.stack || err) };
} finally {
  await browser.close();
}
const line = 'RESULT ' + JSON.stringify({ role, hide, copy: !!copy, ...result, log });
fs.writeFileSync(`${HOME}/result-${role}.txt`, line);
console.log(line);
