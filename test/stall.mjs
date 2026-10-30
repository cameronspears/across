// node stall.mjs <dir> <baseUrl> <runs>: where does a progress stall come from?
// Samples inside each page every 100ms: receiver data-channel bytesReceived (transport), how late the
// sampler itself fired (main thread), sender bufferedAmount; plus the UI-text stall run8 measures.
import fs from 'node:fs';
import { browser, startSender, download, sleep } from './lib.mjs';

const [dir, base, runs = '3'] = process.argv.slice(2);
const file = `${dir}/xbox.zip`, bytes = fs.statSync(file).size;
const probe = () => {
  const Native = RTCPeerConnection;
  window.__samples = [];
  window.RTCPeerConnection = function (...args) {
    const pc = new Native(...args);
    let last = performance.now();
    setInterval(async () => {
      const now = performance.now(), late = now - last - 100;
      last = now;
      let rx = 0;
      (await pc.getStats()).forEach((s) => s.type === 'data-channel' && (rx += s.bytesReceived));
      const dc = pc.__dc;
      __samples.push([Math.round(now), rx, Math.round(late), dc ? dc.bufferedAmount : -1]);
    }, 100);
    const create = pc.createDataChannel.bind(pc);
    pc.createDataChannel = (...a) => (pc.__dc = create(...a));
    return pc;
  };
};
const gaps = (samples, col) => {
  let max = 0, at = 0, since = samples[0]?.[0], value = samples[0]?.[col];
  for (const s of samples) {
    if (s[col] === value) continue;
    if (s[0] - since > max) { max = s[0] - since; at = since; }
    since = s[0];
    value = s[col];
  }
  return { max, at };
};
for (let i = 0; i < Number(runs); i++) {
  const A = await browser(), B = await browser(`${dir}/dl-stall`);
  const send = await A.newPage(), recv = await B.newPage();
  await send.evaluateOnNewDocument(probe);
  await recv.evaluateOnNewDocument(probe);
  const link = await startSender(send, base, file);
  await recv.goto(link);
  await recv.waitForSelector('#go:not([hidden])', { timeout: 30_000 });
  await sleep(300);
  const r = await download(recv, bytes);
  const rs = (await recv.evaluate(() => __samples)).filter((s) => s[1] > 0 && s[1] < bytes);
  const ss = await send.evaluate(() => __samples);
  const transport = gaps(rs, 1);
  const lateRecv = Math.max(...rs.map((s) => s[2])), lateSend = Math.max(...ss.map((s) => s[2]));
  const bufAtStall = ss.filter((s) => s[0] >= transport.at - 200 && s[0] <= transport.at + transport.max).map((s) => s[3]);
  console.log(`run ${i + 1}: ${r.mbps.toFixed(1)}MB/s | UI stall ${r.maxGap}ms | transport stall ${transport.max}ms | ` +
    `latest sampler tick recv ${lateRecv}ms send ${lateSend}ms | sender bufferedAmount during the transport stall ${bufAtStall.length ? `${Math.min(...bufAtStall)}..${Math.max(...bufAtStall)}` : 'n/a'}`);
  await A.close();
  await B.close();
}
process.exit(0);
