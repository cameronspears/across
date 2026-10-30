// node gather-time.mjs <baseUrl> <runs>: when each relay candidate type arrives, and when gathering
// completes, for a relay-only offerer and answerer using the site's own TURN credentials.
import { browser } from './lib.mjs';

const [base, runs = 3] = process.argv.slice(2);
const page = await (await browser()).newPage();
await page.goto(base);
for (let i = 0; i < Number(runs); i++) {
  console.log(await page.evaluate(async () => {
    const config = await rtcConfig(true);
    const watch = (pc) => {
      const t0 = performance.now(), seen = {};
      return new Promise((done) => {
        pc.onicecandidate = (e) => {
          const at = Math.round(performance.now() - t0);
          if (!e.candidate) return done({ ...seen, complete: at });
          const c = e.candidate;
          const key = `${c.type}/${c.relayProtocol ?? c.protocol}`;
          seen[key] ??= at;
        };
        setTimeout(() => done({ ...seen, complete: 'over 10s' }), 10_000);
      });
    };
    const a = new RTCPeerConnection(config), b = new RTCPeerConnection(config);
    a.createDataChannel('f');
    const offerTimes = watch(a);
    await a.setLocalDescription();
    await b.setRemoteDescription(a.localDescription);
    const answerTimes = watch(b);
    await b.setLocalDescription();
    const r = { offer: await offerTimes, answer: await answerTimes };
    a.close(); b.close();
    return JSON.stringify(r);
  }));
}
process.exit(0);
