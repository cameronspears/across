import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

export const SITE = 'https://file-transfer-tan-alpha.vercel.app';
export const HOME = '/vercel/sandbox';

export const launch = (args = []) => puppeteer.launch({
  executablePath: fs.readFileSync(`${HOME}/chrome-path.txt`, 'utf8').trim(),
  headless: true,
  protocolTimeout: 300_000,
  args: ['--no-sandbox', '--disable-dev-shm-usage', ...args],
});

// the credential minted once for this sandbox by setup.sh
export const iceBody = (k = 0) => fs.readFileSync(`${HOME}/ice${k || ''}.json`, 'utf8');

// The app's own filter (turn: and turns: URLs, none on port 53), narrowed to one transport if asked.
const PICK = {
  app: () => true,
  udp: (u) => /^turn:/.test(u) && /transport=udp/.test(u),
  tcp: (u) => /^turn:/.test(u) && /transport=tcp/.test(u),
  tls: (u) => /^turns:/.test(u),
  tls443: (u) => /^turns:[^?]*:443\b/.test(u),
  // one URL each, so each side has exactly one relay candidate and ICE has one pair to pick
  udp3478: (u) => /^turn:[^?]*:3478\?transport=udp/.test(u),
  tcp3478: (u) => /^turn:[^?]*:3478\?transport=tcp/.test(u),
  udp443: (u) => /^turn:[^?]*:443\b/.test(u) && /transport=udp/.test(u),
};
export function iceServers(transport = 'app', k = 0) {
  return JSON.parse(iceBody(k)).iceServers.flatMap((s) => {
    const urls = [s.urls].flat().filter((u) => /^turns?:/.test(u) && !/:53(\?|$)/.test(u) && PICK[transport](u));
    return urls.length ? [{ urls, username: s.username, credential: s.credential }] : [];
  });
}
