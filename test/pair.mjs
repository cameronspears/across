// node pair.mjs <dir> <baseUrl>: which ICE candidate pair the connection uses, and what each SDP carried.
import { browser, startSender } from './lib.mjs';

const dir = process.argv[2], base = process.argv[3];
const A = await browser(), B = await browser();
const send = await A.newPage(), recv = await B.newPage();
const capture = () => {
  const Native = RTCPeerConnection;
  window.__pcs = [];
  window.RTCPeerConnection = function (...args) { const pc = new Native(...args); __pcs.push(pc); return pc; };
};
await send.evaluateOnNewDocument(capture);
await recv.evaluateOnNewDocument(capture);
const link = await startSender(send, base, `${dir}/xbox.zip`);
await recv.goto(link);
await recv.waitForSelector('#go:not([hidden])', { timeout: 30_000 });
const pair = (page) => page.evaluate(async () => {
  const pc = __pcs.at(-1);
  const stats = await pc.getStats();
  const out = { candidates: pc.localDescription.sdp.match(/^a=candidate:.*$/gm).map((c) => c.split(' ').slice(2, 8).join(' ')) };
  stats.forEach((s) => {
    if (s.type === 'transport' && s.selectedCandidatePairId) {
      const p = stats.get(s.selectedCandidatePairId), l = stats.get(p.localCandidateId), r = stats.get(p.remoteCandidateId);
      out.selected = `${l.candidateType}/${l.protocol} ${l.address}:${l.port} -> ${r.candidateType} ${r.address}:${r.port}`;
    }
  });
  return out;
});
console.log('sender', JSON.stringify(await pair(send), null, 1));
console.log('receiver', JSON.stringify(await pair(recv), null, 1));
process.exit(0);
