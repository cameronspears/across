// node imposter2.mjs <dir> <baseUrl>: a peer that knows the room (as the server does) but not the secret
// completes the WebRTC handshake, then must get nothing: no meta, no name, no bytes.
import { browser, watch, startSender } from './lib.mjs';

const dir = process.argv[2], base = process.argv[3];
const log = [];
const send = await (await browser()).newPage();
await watch(send, 'send', log);
const link = await startSender(send, base, `${dir}/xbox.zip`);
const secret = link.split('#')[1];
const before = { rows: await send.$eval('#xfers', (e) => e.textContent), msg: await send.$eval('#msg', (e) => e.textContent) };

const evil = await (await browser()).newPage();
await evil.goto(base);
const room = await evil.evaluate((s) => roomOf(s), secret);
const seen = await evil.evaluate((room) => new Promise((done) => {
  const fake = 'aaaaaaaaaaaaaaaaaaaa', seen = [];
  let pc;
  const sig = signaling(room, rid(16), async (m) => {
    if (m.t !== 'offer' || pc) return;
    seen.push('offer');
    // answers both links, the main one and the local one
    pc = new RTCPeerConnection(await rtcConfig(false));
    const lan = new RTCPeerConnection(LAN);
    for (const conn of [pc, lan]) {
      conn.ondatachannel = ({ channel }) => {
        channel.binaryType = 'arraybuffer';
        channel.onopen = async () => { seen.push('channel open'); channel.send(JSON.stringify({ t: 'hi', p: await proof(fake, 'r', conn, 'r') })); };
        channel.onmessage = (e) => seen.push(typeof e.data === 'string' ? `text: ${e.data.slice(0, 30)}` : `bytes: ${e.data.byteLength}`);
        channel.onclose = () => seen.push('channel closed by sender');
      };
    }
    await pc.setRemoteDescription(m.sdp);
    await lan.setRemoteDescription({ type: 'offer', sdp: localOnly(m.lan.sdp) });
    sig.post('s', { t: 'answer', sdp: await describe(pc), lan: await describeLan(lan) });
  });
  sig.post('s', { t: 'hello' });
  setTimeout(() => done(seen), 6000);
}), room);

const after = { rows: await send.$eval('#xfers', (e) => e.textContent), msg: await send.$eval('#msg', (e) => e.textContent) };
const leaked = seen.filter((s) => s.startsWith('bytes') || /meta|xbox/.test(s));
console.log('imposter saw:', JSON.stringify(seen));
console.log('sender UI before:', JSON.stringify(before), 'after:', JSON.stringify(after));
const pass = seen.includes('channel open') && seen.includes('channel closed by sender') && !leaked.length &&
  JSON.stringify(before) === JSON.stringify(after);
console.log(pass ? 'PASS: handshake completed, proof rejected, nothing leaked, sender UI unchanged' : 'FAIL', log);
process.exit(pass ? 0 : 1);
