// node lan-proto.mjs [MB]: two Chromes, peer connections with no ICE servers whose SDPs keep only
// .local host candidates. Reports the candidates each side offered, the selected pair, and throughput.
import { browser, sleep } from './lib.mjs';

const MB = Number(process.argv[2] || 200);
const keepLocal = (sdp) => sdp.split('\r\n').filter((l) => !l.startsWith('a=candidate:') || / \S+\.local \d+ typ host/.test(l)).join('\r\n');
const pages = [];
for (let i = 0; i < 2; i++) { const p = await (await browser()).newPage(); await p.goto('http://127.0.0.1:8090/'); pages.push(p); }
const [a, b] = pages;
const setup = () => {
  window.pc = new RTCPeerConnection({ iceServers: [] });
  window.gather = async () => {
    await pc.setLocalDescription();
    await new Promise((ok) => (pc.iceGatheringState === 'complete' ? ok() : pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && ok())));
    return pc.localDescription.sdp;
  };
};
await a.evaluate(setup); await b.evaluate(setup);
await a.evaluate(() => { window.dc = pc.createDataChannel('f'); dc.binaryType = 'arraybuffer'; });
await b.evaluate(() => { pc.ondatachannel = (e) => { window.dc = e.channel; dc.binaryType = 'arraybuffer'; window.got = 0; dc.onmessage = (m) => (got += m.data.byteLength || 0); }; });
const offer = await a.evaluate(() => gather());
const cands = (s) => s.split('\r\n').filter((l) => l.startsWith('a=candidate:')).map((l) => l.split(' ').slice(4, 8).join(' '));
console.log('offer candidates:', cands(offer));
await b.evaluate((sdp) => pc.setRemoteDescription({ type: 'offer', sdp }), keepLocal(offer));
const answer = await b.evaluate(() => gather());
console.log('answer candidates:', cands(answer));
await a.evaluate((sdp) => pc.setRemoteDescription({ type: 'answer', sdp }), keepLocal(answer));
const t0 = Date.now();
await a.waitForFunction(() => dc.readyState === 'open', { timeout: 15000 }).catch(() => {});
const open = await a.evaluate(() => dc.readyState);
console.log(`channel ${open} after ${Date.now() - t0}ms`);
if (open !== 'open') process.exit(1);
console.log('pair:', await a.evaluate(async () => {
  const s = await pc.getStats(); let pair;
  s.forEach((r) => r.type === 'transport' && (pair = s.get(r.selectedCandidatePairId)));
  const l = s.get(pair.localCandidateId), r = s.get(pair.remoteCandidateId);
  return `${l.candidateType} ${l.address} -> ${r.candidateType} ${r.address}`;
}));
const t1 = Date.now();
await a.evaluate(async (total) => {
  const buf = new Uint8Array(256 << 10);
  dc.bufferedAmountLowThreshold = 1 << 20;
  for (let sent = 0; sent < total; sent += buf.length) {
    if (dc.bufferedAmount > 4 << 20) await new Promise((ok) => (dc.onbufferedamountlow = ok));
    dc.send(buf);
  }
}, MB * 1e6);
await b.waitForFunction((total) => got >= total, { timeout: 300000, polling: 100 }, Math.ceil(MB * 1e6 / (256 << 10)) * (256 << 10));
const s = (Date.now() - t1) / 1000;
console.log(`${MB}MB in ${s.toFixed(1)}s = ${(MB / s).toFixed(1)}MB/s`);
process.exit(0);
