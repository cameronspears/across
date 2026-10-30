// node filter.mjs <baseUrl>: the page's local-link filter keeps a browser's own .local names and nothing else,
// whatever a malicious peer puts in its description.
import { browser } from './lib.mjs';

const page = await (await browser()).newPage();
await page.goto(process.argv[2]);
const good = 'a=candidate:1 1 udp 2122260223 9a2cab4b-4829-4c3f-9b05-0a8347180d1e.local 52896 typ host generation 0';
const evil = [
  'a=candidate:2 1 udp 2122260223 192.168.1.50 52896 typ host generation 0',
  'a=candidate:3 1 udp 2122260223 203.0.113.9 52896 typ host generation 0',
  'a=candidate:4 1 udp 1686052607 203.0.113.9 61000 typ srflx raddr 0.0.0.0 rport 0',
  'a=candidate:5 1 udp 41885439 9a2cab4b-4829-4c3f-9b05-0a8347180d1e.local 3478 typ relay raddr 0.0.0.0 rport 0',
  'a=candidate:6 1 udp 2122260223 evil.example.local 52896 typ host generation 0',
  'a=candidate:7 1 udp 2122260223 203.0.113.9.9a2cab4b-4829-4c3f-9b05-0a8347180d1e.local 52896 typ host',
  'a=candidate:8 1 tcp 2122260223 9a2cab4b-4829-4c3f-9b05-0a8347180d1e.local 9 typ host tcptype active raddr 203.0.113.9',
];
const sdp = ['v=0', 'o=- 1 2 IN IP4 127.0.0.1', 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 203.0.113.9', good, ...evil, ''].join('\r\n');
const [kept, none] = await page.evaluate((sdp, evil) => [localOnly(sdp), localOnly(evil.join('\r\n'))], sdp, evil);
const cands = kept.split('\r\n').filter((l) => l.startsWith('a=candidate:'));
const fail = [];
if (!cands.includes(good)) fail.push('dropped the genuine .local name');
for (const c of cands) if (c !== good && !c.startsWith('a=candidate:8 ')) fail.push(`kept ${c}`);
if (/203\.0\.113\.9/.test(kept)) fail.push('kept the public address in the connection line');
if (none !== null) fail.push('a description with no genuine .local name should give no local link');
console.log('kept:', cands);
console.log(fail.length ? `FAIL\n  ${fail.join('\n  ')}` : 'PASS');
process.exit(fail.length ? 1 : 0);
