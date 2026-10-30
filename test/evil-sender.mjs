// node evil-sender.mjs <dir> <baseUrl>: a sender that knows the secret but lies about the file.
// The real receiver page must clean the name and refuse sizes, counts, and shapes that don't add up.
import { browser, sleep } from './lib.mjs';

const base = process.argv[3];
const cases = [
  { name: 'bidi name', meta: { t: 'meta', name: ' invoice‮fdp.exe/..\\x\u0007⁦ ', size: 3 }, bytes: 3,
    want: { name: 'invoicefdp.exe_.._x', msg: 'Saved.' } },
  { name: 'empty name', meta: { t: 'meta', name: '‮\u0000 ', size: 0 }, bytes: 0, want: { name: 'file', msg: 'Saved.' } },
  { name: 'more bytes than size', meta: { t: 'meta', name: 'a.txt', size: 10 }, bytes: 20,
    want: { msg: 'The sender sent more than the file size.' } },
  { name: 'fewer bytes than size', meta: { t: 'meta', name: 'a.txt', size: 20 }, bytes: 10,
    want: { msg: 'The transfer stopped at 10\u00a0B of 20\u00a0B.' } },
  { name: 'negative size', meta: { t: 'meta', name: 'a.txt', size: -1 }, want: { msg: 'The sender sent something unexpected.' } },
  { name: 'fractional size', meta: { t: 'meta', name: 'a.txt', size: 1.5 }, want: { msg: 'The sender sent something unexpected.' } },
  { name: 'name not a string', meta: { t: 'meta', name: 7, size: 1 }, want: { msg: 'The sender sent something unexpected.' } },
  { name: 'unknown message', meta: { t: 'run', code: 'alert(1)' }, want: { msg: 'The sender sent something unexpected.' } },
];
const A = await browser(), B = await browser();
let failures = 0;
for (const c of cases) {
  const evil = await A.newPage(), recv = await B.newPage();
  await evil.goto(base);
  const secret = await evil.evaluate(() => rid(20));
  await evil.evaluate(async (secret, c) => {
    const sig = signaling(await roomOf(secret), 's', async (m) => {
      if (m.t === 'answer') return window.__pc.setRemoteDescription(m.sdp);
      if (m.t !== 'hello' || window.__pc) return;
      const pc = (window.__pc = new RTCPeerConnection(await rtcConfig(false)));
      const dc = pc.createDataChannel('f');
      dc.onopen = async () => dc.send(JSON.stringify({ t: 'hi', p: await proof(secret, 's', pc, 's') }));
      dc.onmessage = (e) => {
        const t = JSON.parse(e.data).t;
        if (t === 'hi') dc.send(JSON.stringify(c.meta));
        if (t === 'start') { if (c.bytes) dc.send(new Uint8Array(c.bytes)); dc.send(JSON.stringify({ t: 'done' })); }
      };
      sig.post(m.from, { t: 'offer', sdp: await describe(pc) });
    });
  }, secret, c);
  await recv.goto(`${base}?sink=mem#${secret}`);
  const shown = await recv.waitForFunction(() => !document.querySelector('#go').hidden || document.querySelector('#msg').textContent, { timeout: 20_000 }).then(() => true, () => false);
  if (shown && !(await recv.$eval('#go', (b) => b.hidden))) await recv.click('#go');
  await recv.waitForFunction(() => /Saved|Done|sender|transfer/.test(document.querySelector('#msg').textContent), { timeout: 10_000 }).catch(() => {});
  await sleep(200);
  const got = {
    name: await recv.$eval('#r-name', (e) => e.textContent),
    title: await recv.evaluate(() => document.title),
    msg: await recv.$eval('#msg', (e) => e.textContent.replace(/^Done\. Save file$/, 'Saved.')),
  };
  const ok = got.msg === c.want.msg && (!c.want.name || (got.name === c.want.name && got.title === c.want.name));
  failures += !ok;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name}: ${JSON.stringify(got)}`);
  await evil.close();
  await recv.close();
}
process.exit(failures ? 1 : 0);
