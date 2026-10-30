// node zip-evil.mjs <baseUrl>: a sender that knows the secret but abuses compressed blocks. The real
// receiver page must refuse bombs, bad data and sizes that don't add up, and save good blocks exactly.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { browser, sleep, waitFile } from './lib.mjs';

const base = process.argv[2];
// each step is [kind, arg]: 'z' sends a header {n, raw}, 'deflate' sends deflate-raw(of N bytes of 'a'),
// 'bytes' sends N raw bytes of 'a', 'junk' sends N random bytes, 'start-z' sends a header before start
const cases = [
  { name: 'good compressed block', size: 300000, steps: [['zfor', 300000], ['deflate', 300000]], want: 'Saved.', check: 300000 },
  { name: 'compressed then raw', size: 300100, steps: [['zfor', 300000], ['deflate', 300000], ['bytes', 100]], want: 'Saved.', check: 300100 },
  { name: 'bomb: tiny block inflating past its claim', size: 1000, steps: [['zclaim', 1000, 10_000_000], ['deflate', 10_000_000]], want: 'The sender sent something unexpected.' },
  { name: 'inflates short of its claim', size: 2000, steps: [['zclaim', 2000, 1000], ['deflate', 1000]], want: 'The sender sent something unexpected.' },
  { name: 'corrupt data', size: 1000, steps: [['z', 64, 1000], ['junk', 64]], want: 'The sender sent something unexpected.' },
  { name: 'claims more than the file', size: 1000, steps: [['z', 10, 2000]], want: 'The sender sent more than the file size.' },
  { name: 'stops inside a block', size: 1000, steps: [['z', 100, 1000], ['junk', 50]], want: 'The transfer stopped at 0\u00a0B of 1.0\u00a0KB.' },
  { name: 'header too large', size: 1000, steps: [['z', 10, 64 << 20]], want: 'The sender sent something unexpected.' },
];

const out = path.join(os.tmpdir(), `dl-zip-evil-${process.pid}`);
const A = await browser(), B = await browser(out);
let failures = 0;
for (const c of cases) {
  const evil = await A.newPage(), recv = await B.newPage();
  // both connect directly; the receiver's privacy isn't what this tests
  await recv.evaluateOnNewDocument(() => localStorage.setItem('hide-ip', '0'));
  await evil.goto(base);
  const secret = await evil.evaluate(() => rid(20));
  await evil.evaluate(async (secret, c) => {
    const a = (n) => new Uint8Array(n).fill(97);
    const sig = signaling(await roomOf(secret), 's', async (m) => {
      if (m.t === 'answer') return window.__pc.setRemoteDescription(m.sdp);
      if (m.t !== 'hello' || window.__pc) return;
      const pc = (window.__pc = new RTCPeerConnection(await rtcConfig(false)));
      const dc = pc.createDataChannel('f');
      dc.binaryType = 'arraybuffer';
      dc.onopen = async () => dc.send(JSON.stringify({ t: 'hi', p: await proof(secret, 's', pc, 's') }));
      dc.onmessage = async (e) => {
        const t = JSON.parse(e.data).t;
        if (t === 'hi') dc.send(JSON.stringify({ t: 'meta', name: 'a.bin', size: c.size }));
        if (t !== 'start') return;
        for (const [kind, x, y] of c.steps) {
          if (kind === 'z') dc.send(JSON.stringify({ t: 'z', n: x, raw: y }));
          if (kind === 'zfor' || kind === 'zclaim') {
            const n = (await deflate(a(kind === 'zfor' ? x : y))).length;
            dc.send(JSON.stringify({ t: 'z', n, raw: x }));
          }
          if (kind === 'deflate') dc.send(await deflate(a(x)));
          if (kind === 'bytes') dc.send(a(x));
          if (kind === 'junk') dc.send(crypto.getRandomValues(new Uint8Array(x)));
        }
        dc.send(JSON.stringify({ t: 'done' }));
      };
      sig.post(m.from, { t: 'offer', sdp: await describe(pc) });
    });
  }, secret, c);
  await recv.goto(`${base}?sink=mem#${secret}`);
  await recv.waitForSelector('#go:not([hidden])', { timeout: 30_000 }).catch(() => {});
  if (!(await recv.$eval('#go', (b) => b.hidden))) await recv.click('#go');
  await recv.waitForFunction(() => /Saved|Done|sender|transfer/.test(document.querySelector('#msg').textContent), { timeout: 30_000 }).catch(() => {});
  await sleep(300);
  const msg = await recv.$eval('#msg', (e) => e.textContent.replace(/^Done\. Save file$/, 'Saved.'));
  let ok = msg === c.want;
  if (ok && c.check) {
    const file = path.join(out, 'a.bin');
    const saved = await waitFile(file, c.check);
    const b = saved ? fs.readFileSync(file) : Buffer.alloc(0);
    const bytes = { n: b.length, allA: b.every((x) => x === 97) };
    fs.rmSync(file, { force: true });
    ok = saved && bytes.allA;
    if (!ok) console.log('   saved', JSON.stringify(bytes));
  }
  failures += !ok;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name}: "${msg}"`);
  await evil.close();
  await recv.close();
}
fs.rmSync(out, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
