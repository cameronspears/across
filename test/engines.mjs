// node engines.mjs <baseUrl> <chrome|firefox sender> <chrome|firefox receiver> <file> [hide 1|0]
// One transfer between two browser engines. The receiver keeps the file in memory (?sink=mem) so
// both engines save the same way; the page hands the finished Blob to this script to hash.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { launch, watch, startSender, sleep } from './lib.mjs';

const [base, from, to, file, hide = '1'] = process.argv.slice(2);
const want = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const log = [], pages = {}, browsers = [];
for (const [side, engine] of [['send', from], ['recv', to]]) {
  const b = await launch(engine);
  browsers.push(b);
  const page = await b.newPage();
  await watch(page, `${side} ${engine}`, log);
  page.on('dialog', (d) => d.accept());
  await page.evaluateOnNewDocument((hide) => {
    try { localStorage.setItem('hide-ip', hide); } catch {} // refused on Firefox's first blank page
    const make = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      window.__blob = blob;
      return make(blob);
    };
  }, hide);
  pages[side] = page;
}

const link = await startSender(pages.send, base, file);
const t0 = Date.now();
await pages.recv.goto(link.replace('#', '?sink=mem#'));
await pages.recv.waitForSelector('#go:not([hidden])', { timeout: 30_000 }).catch(async (err) => {
  const state = async (p) => p.evaluate(() => ({ msg: $('#msg').textContent, name: $('#r-name')?.textContent, rows: $('#xfers')?.textContent }));
  console.log('stuck', JSON.stringify({ recv: await state(pages.recv), send: await state(pages.send), log }));
  throw err;
});
const ready = Date.now() - t0;
await pages.recv.click('#go');
let msg = '';
for (const end = Date.now() + 300_000; Date.now() < end && !msg; await sleep(250)) msg = await pages.recv.$eval('#msg', (e) => e.textContent);
const secs = (Date.now() - t0 - ready) / 1000;
const got = await pages.recv.evaluate(async () =>
  window.__blob ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await __blob.arrayBuffer())), (x) => x.toString(16).padStart(2, '0')).join('') : 'none');
const sent = await pages.send.$eval('#xfers', (e) => e.textContent);

const fails = [];
if (got !== want) fails.push(`sha ${got.slice(0, 16)}, want ${want.slice(0, 16)}`);
if (!sent.includes('Received')) fails.push(`sender says "${sent}"`);
// Firefox warns about the relay's six addresses; connecting still takes about a second, so it isn't a failure
const errors = log.filter((l) => !l.includes('five or more STUN/TURN servers'));
if (errors.length) fails.push(`console: ${errors.join(' | ')}`);
console.log(`${from} -> ${to} hide=${hide} | ready ${ready}ms | ${(fs.statSync(file).size / 1e6).toFixed(1)}MB in ${secs.toFixed(1)}s | msg="${msg}"`);
console.log(fails.length ? `FAIL\n  ${fails.join('\n  ')}` : 'PASS');
for (const b of browsers) await b.close();
process.exit(fails.length ? 1 : 0);
