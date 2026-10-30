// node patch-app.mjs -> patched/page.json, a COPY of the live page (patched/live-base.html, fetched
// from the site) with nothing in public/ written, with a second
// relay-only connection for hidden transfers. The second connection uses its own TURN credential
// (api/ice?n=2), is negotiated over the first, already-proven data channel (so its fingerprints are
// authenticated by that channel), and carries every other chunk. The receiver reorders by strict
// alternation. Only the copy's response headers are rebuilt, with the app's own headerRules.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { headerRules } from '../../lib/headers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// the deployed page the baseline measured (public/index.html is being changed separately)
let html = fs.readFileSync(`${HERE}/patched/live-base.html`, 'utf8');
const edit = (from, to) => {
  const n = html.split(from).length - 1;
  if (n !== 1) throw new Error(`expected one match, found ${n}: ${from.slice(0, 80)}`);
  html = html.replace(from, () => to);
};

// a second credential, fetched once per page
edit(`// Hidden: relay candidates only,`, `let relay2;
const relayServers2 = () => (relay2 ??= fetch('api/ice?n=2', { cache: 'no-store' })
  .then((r) => (r.ok ? r.json() : null))
  .then((body) => turnServers(body?.iceServers), () => []));

// Hidden: relay candidates only,`);

const desc = `(m) => m.sdp?.type && typeof m.sdp.sdp === 'string' && { t: m.t, sdp: { type: m.sdp.type, sdp: m.sdp.sdp } }`;
edit(`  got: () => ({ t: 'got' }),`, `  got: () => ({ t: 'got' }),
  offer2: ${desc},
  answer2: ${desc},
  lanes: (m) => (m.n === 1 || m.n === 2) && { t: 'lanes', n: m.n },`);

// ---- sender ----
edit(`const m = parseControl(e.data, ['hi', 'start', 'cancel', 'got']);`, `const m = parseControl(e.data, ['hi', 'start', 'cancel', 'got', 'answer2']);`);
edit(`    p.pc?.close();
    if (peers.get(p.id) === p) peers.delete(p.id);`, `    p.pc?.close();
    p.pc2?.close();
    if (peers.get(p.id) === p) peers.delete(p.id);`);
edit(`        dc.send(JSON.stringify({ t: 'meta', name: file.name, size: file.size }));
      } else if (m.t === 'start' && !started) {`, `        dc.send(JSON.stringify({ t: 'meta', name: file.name, size: file.size }));
        if (hide) second();
        else p.second = Promise.resolve(false);
      } else if (m.t === 'answer2' && p.pc2 && !p.dc2) {
        p.pc2.setRemoteDescription(m.sdp).catch(() => {});
      } else if (m.t === 'start' && !started) {`);
edit(`    describe(pc).then((offer) => {`, `
    // resolves when the second link opens, or false
    function second() {
      p.second = (async () => {
        const turn = await relayServers2();
        if (!turn.length || p.state === 'closed') return false;
        const pc2 = (p.pc2 = new RTCPeerConnection({ iceTransportPolicy: 'relay', iceServers: turn }));
        const ch = pc2.createDataChannel('f2');
        ch.binaryType = 'arraybuffer';
        ch.bufferedAmountLowThreshold = LOW;
        const open = new Promise((ok) => { ch.onopen = () => ok(true); ch.onclose = () => ok(false); });
        dc.send(JSON.stringify({ t: 'offer2', sdp: await describe(pc2) }));
        if (await open) p.dc2 = ch;
        return !!p.dc2;
      })().catch(() => false);
    }

    describe(pc).then((offer) => {`);
// the transfer waits up to 6 s for the second link; answer2 is handled meanwhile, since this does not block the queue
edit(`row.set(Math.max(0, sent.n - dc.bufferedAmount), file.size), 300);
        pump(dc, file, Math.min(CHUNK, pc.sctp?.maxMessageSize || CHUNK), sent)`, `row.set(Math.max(0, sent.n - dc.bufferedAmount - (p.dc2?.bufferedAmount ?? 0)), file.size), 300);
        Promise.race([p.second, sleep(6000)])
          .then(() => pump(p.dc2 ? [dc, p.dc2] : [dc], file, Math.min(CHUNK, pc.sctp?.maxMessageSize || CHUNK), sent))`);
edit(`async function pump(dc, file, chunk, sent) {
  const read = (at) => file.slice(at, at + BLOCK).arrayBuffer();
  let off = 0, next = read(0);`, `async function pump(lanes, file, chunk, sent) {
  const read = (at) => file.slice(at, at + BLOCK).arrayBuffer();
  let off = 0, next = read(0), k = 0;
  lanes[0].send(JSON.stringify({ t: 'lanes', n: lanes.length }));`);
edit(`    for (let i = 0; i < buf.length; i += chunk) {
      if (dc.bufferedAmount > HIGH) await drained(dc);`, `    for (let i = 0; i < buf.length; i += chunk) {
      const dc = lanes[k++ % lanes.length];
      if (dc.bufferedAmount > HIGH) await drained(dc);`);
edit(`    off = end;
  }
  dc.send(JSON.stringify({ t: 'done' }));`, `    off = end;
  }
  lanes[0].send(JSON.stringify({ t: 'done' }));`);

// ---- receiver ----
edit(`let phase, config, sig, hello, pc, dc, offer,`, `let pc2, nLanes = 1, turn = 0;
  const queues = [[], []];
  let phase, config, sig, hello, pc, dc, offer,`);
edit(`      if (typeof e.data !== 'string') return onBytes(e.data);
      const m = parseControl(e.data, ['hi', 'meta', 'done']);`, `      if (typeof e.data !== 'string') return onBytes(e.data, 0);
      // before any chunk on this channel, and handled at once: chunks are handled synchronously too
      if (e.data.includes('"lanes"')) return (nLanes = parseControl(e.data, ['lanes'])?.n ?? nLanes);
      const m = parseControl(e.data, ['hi', 'meta', 'done', 'offer2']);`);
edit(`  function onBytes(ab) {
    if (phase !== 'receiving') return; // chunks still in flight after a cancel
    got += ab.byteLength; // before write: the sw sink detaches the buffer
    if (got > meta.size) return reject('The sender sent more than the file size.');
    sink.write(ab);
  }`, `  function onBytes(ab, lane) {
    if (phase !== 'receiving') return; // chunks still in flight after a cancel
    queues[lane].push(ab);
    while (queues[turn].length) {
      const next = queues[turn].shift();
      turn = (turn + 1) % nLanes;
      got += next.byteLength; // before write: the sw sink detaches the buffer
      if (got > meta.size) return reject('The sender sent more than the file size.');
      sink.write(next);
    }
  }

  async function second(sdp) {
    const turnServers2 = hide ? await relayServers2() : [];
    if (!turnServers2.length || pc2) return;
    pc2 = new RTCPeerConnection({ iceTransportPolicy: 'relay', iceServers: turnServers2 });
    pc2.ondatachannel = ({ channel }) => {
      channel.binaryType = 'arraybuffer';
      channel.onmessage = (e) => typeof e.data !== 'string' && onBytes(e.data, 1);
    };
    await pc2.setRemoteDescription(sdp);
    const answer2 = await describe(pc2);
    // the sender waits for this link before sending any chunk, so this is not traffic against a transfer
    if (phase !== 'failed' && phase !== 'done' && !got) dc.send(JSON.stringify({ t: 'answer2', sdp: answer2 }));
  }`);
edit(`    } else if (m?.t === 'done' && phase === 'receiving') {
      clearInterval(timer);`, `    } else if (m?.t === 'offer2') {
      if (!pc2 && !got) second(m.sdp).catch(() => {});
    } else if (m?.t === 'done' && phase === 'receiving') {
      // the other lane's last chunks may still be arriving
      for (let i = 0; got < meta.size && i < 200; i++) await sleep(50);
      clearInterval(timer);`);

const rules = headerRules(html);
const headers = rules[0].headers.map(({ key, value }) => ({ name: key, value }));
fs.mkdirSync(`${HERE}/patched`, { recursive: true });
fs.writeFileSync(`${HERE}/patched/index.html`, html);
fs.writeFileSync(`${HERE}/patched/page.json`, JSON.stringify({ html, headers }));
console.log(`patched copy written, ${html.length} bytes`);
