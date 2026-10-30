// node two.mjs <dir> <baseUrl>: two receivers open the same link at the same moment; both must get the exact file.
import fs from 'node:fs';
import { browser, watch, startSender, download, waitFile, sha } from './lib.mjs';

const dir = process.argv[2], base = process.argv[3];
const file = `${dir}/xbox.zip`, bytes = fs.statSync(file).size, WANT = sha(file);
const outs = [`${dir}/dl-two-a`, `${dir}/dl-two-b`];
for (const o of outs) fs.rmSync(o, { recursive: true, force: true });
const log = [];
const send = await (await browser()).newPage();
await watch(send, 'send', log);
const recvs = await Promise.all(outs.map(async (o, i) => {
  const page = await (await browser(o)).newPage();
  await watch(page, `recv${i}`, log);
  return page;
}));
const link = await startSender(send, base, file);
const t0 = Date.now();
await Promise.all(recvs.map((r) => r.goto(link)));
await Promise.all(recvs.map((r) => r.waitForSelector('#go:not([hidden])', { timeout: 30_000 })));
console.log(`both ready after ${Date.now() - t0}ms`);
const results = await Promise.all(recvs.map((r) => download(r, bytes, 400_000)));
results.forEach((r, i) => console.log(`recv${i}: ${r.secs.toFixed(1)}s ${r.mbps.toFixed(1)}MB/s max stall ${r.maxGap}ms msg="${r.msg}"`));
let ok = true;
for (const [i, o] of outs.entries()) {
  const saved = await waitFile(`${o}/xbox.zip`, bytes);
  const got = saved ? sha(`${o}/xbox.zip`) : 'missing';
  ok &&= got === WANT;
  console.log(`recv${i} sha ${got} (want ${WANT})`);
}
console.log('sender rows:', JSON.stringify(await send.$$eval('#xfers p', (ps) => ps.map((p) => p.textContent))));
console.log(`console errors, page errors, CSP violations: ${log.length}`, log);
process.exit(ok && !log.length ? 0 : 1);
