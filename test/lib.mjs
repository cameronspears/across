import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

export const exe = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const WANT = process.env.WANT ?? '2ef994d41b6d3072';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);

// A test killed outright (SIGKILL, a session ending) can't close its browsers, and they pile up:
// once about 1,300 processes and 11 GB. A browser whose test is gone has been reparented to launchd
// (ppid 1), so every test run kills those before launching its own.
const PROFILE = /puppeteer_dev_(chrome|firefox)_profile/;
for (const line of execSync('ps -axo pid=,ppid=,command=', { encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n')) {
  const [, pid, ppid, cmd] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/) ?? [];
  if (ppid === '1' && PROFILE.test(cmd)) try { process.kill(Number(pid), 'SIGKILL'); } catch {}
}

// every browser a test opens; puppeteer closes them on a normal exit, this covers crashes and Ctrl-C
const live = new Set();
process.on('exit', () => live.forEach((b) => b.process()?.kill('SIGKILL')));
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));
process.on('uncaughtException', (err) => (console.error(err), process.exit(1)));
process.on('unhandledRejection', (err) => (console.error(err), process.exit(1)));

export async function launch(engine = 'chrome', args = []) {
  const b = await puppeteer.launch(engine === 'firefox'
    ? { browser: 'firefox', executablePath: '/Applications/Firefox.app/Contents/MacOS/firefox', headless: true,
      // the local test relay is on 127.0.0.1, and Firefox skips loopback addresses unless told otherwise
      extraPrefsFirefox: { 'media.peerconnection.ice.loopback': true } }
    : { executablePath: exe, headless: true, args });
  live.add(b);
  b.on('disconnected', () => live.delete(b));
  return b;
}

export async function browser(downloadDir, args = []) {
  const b = await launch('chrome', args);
  if (downloadDir) {
    fs.mkdirSync(downloadDir, { recursive: true });
    const cdp = await b.target().createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true });
  }
  return b;
}

// Records console errors/warnings, page errors, CSP violations, and signaling POST sizes.
export async function watch(page, name, log) {
  await page.evaluateOnNewDocument(() => {
    addEventListener('securitypolicyviolation', (e) =>
      console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI || '(inline)'}`));
  });
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warn') && log.push(`[${name} console.${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => log.push(`[${name} pageerror] ${e.message}`));
  // a download frame reports ERR_ABORTED when Chrome hands its response to the downloads folder
  page.on('requestfailed', (r) => !r.url().includes('/api/signal') && !r.url().includes('/dl/') && log.push(`[${name} requestfailed] ${r.url()} ${r.failure()?.errorText}`));
  page.posts = [];
  // Firefox's driver can't read request bodies, so its pages record none
  const body = (r) => { try { return JSON.parse(r.postData() || 'null'); } catch { return null; } };
  page.on('request', (r) => r.method() === 'POST' && r.url().includes('/api/signal') && page.posts.push(body(r)));
}

export async function startSender(page, base, file) {
  await page.goto(base);
  await (await page.$('#file')).uploadFile(file);
  await page.waitForFunction(() => (document.querySelector('#link').value || document.querySelector('#link').href || '').includes('#'));
  return page.$eval('#link', (e) => e.value || e.href); // href: pages before the link box
}

// Clicks Download and waits for the receiver to finish; returns timing and the final message.
export async function download(recv, bytes, timeoutMs = 300_000) {
  const t1 = Date.now();
  let maxGap = 0, last = '', lastT = Date.now();
  await recv.click('#go');
  for (;;) {
    await sleep(250);
    const rx = await recv.$eval('#r-xfer p > span', (e) => e.textContent).catch(() => '');
    if (rx !== last) {
      if (process.env.TIMELINE) console.log(`  ${Date.now() - t1}ms ${rx}`);
      maxGap = Math.max(maxGap, Date.now() - lastT); last = rx; lastT = Date.now();
    }
    const msg = await recv.$eval('#msg', (e) => e.textContent);
    if (rx.includes('done') || msg || Date.now() - t1 > timeoutMs) {
      const secs = (Date.now() - t1) / 1000;
      return { secs, mbps: bytes / 1e6 / secs, maxGap, msg, rx };
    }
  }
}

export async function waitFile(file, bytes, ms = 10_000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) {
    if (fs.existsSync(file) && fs.statSync(file).size === bytes) return true;
  }
  return false;
}
