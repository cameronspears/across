// [AWAY_S=150] node background.mjs <baseUrl> <file>
// The sender sends the link from a phone and switches apps: its page goes hidden and frozen, and the
// signaling poll it left open never answers, as when iOS cuts a suspended page's sockets. The receiver
// opens the link meanwhile. Passes when, AWAY_S seconds later, the sender comes back on screen and the
// file arrives intact within 20 s.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { browser, watch, startSender, download, waitFile, sha, sleep } from './lib.mjs';

const [base, file] = process.argv.slice(2);
const away = Number(process.env.AWAY_S ?? 150) * 1000;
const bytes = fs.statSync(file).size, out = path.join(os.tmpdir(), `dl-bg-${process.pid}`);
const log = [], browsers = [];
const page = async (side) => {
  const b = await browser(side === 'recv' ? out : undefined);
  browsers.push(b);
  const p = await b.newPage();
  await watch(p, side, log);
  return p;
};
const send = await page('send'), recv = await page('recv');
await send.evaluateOnNewDocument(() => {
  let hidden = false;
  Object.defineProperty(Document.prototype, 'visibilityState', { get: () => (hidden ? 'hidden' : 'visible') });
  Object.defineProperty(Document.prototype, 'hidden', { get: () => hidden });
  window.__show = (on) => {
    hidden = !on;
    document.dispatchEvent(new Event('visibilitychange'));
  };
  // a poll open while hidden never answers, unless the page aborts it
  const real = fetch;
  window.fetch = (url, opts) => {
    if (!String(url).includes('api/signal?')) return real(url, opts);
    const r = real(url, opts);
    return new Promise((ok, no) => {
      opts?.signal?.addEventListener('abort', () => no(new DOMException('aborted', 'AbortError')));
      r.then((v) => !hidden && ok(v), (e) => !hidden && no(e));
    });
  };
});

const link = await startSender(send, base, file);
const cdp = await send.createCDPSession();
await send.evaluate(() => window.__show(false));
await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
await recv.goto(link);
await sleep(away);
const waiting = await recv.$eval('#msg', (e) => e.textContent);
await cdp.send('Page.setWebLifecycleState', { state: 'active' });
await send.evaluate(() => window.__show(true));

const failures = [];
const ready = await recv.waitForSelector('#go:not([hidden])', { timeout: 20_000 }).then(() => true, () => false);
if (!ready) failures.push(`receiver never connected; it says "${await recv.$eval('#msg', (e) => e.textContent)}"`);
else {
  const r = await download(recv, bytes, 60_000);
  const saved = path.join(out, path.basename(file));
  const got = (await waitFile(saved, bytes)) ? sha(saved) : 'missing';
  if (got !== sha(file)) failures.push(`sha ${got}, want ${sha(file)} (${r.msg})`);
}
console.log(`while away the receiver said: "${waiting}"`);
for (const l of log) console.log(l);
for (const b of browsers) await b.close();
fs.rmSync(out, { recursive: true, force: true });
console.log(failures.length ? `FAIL\n${failures.join('\n')}` : 'PASS');
process.exit(failures.length ? 1 : 0);
