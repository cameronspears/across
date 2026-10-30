# Security review: "Twitter nerds" pass (2026-10-29)

Assumed attacker: curious, scripted, a few VPSes and IPv6 ranges, wants to break the site, run up bills, or get something free. Not a nation state.

Live snapshot when reviewed: `GET /api/guard` → `{"state":"open","usedGB":4.45,"budgetGB":900,"live":28}`.

## 1. HIGH (fixed, not deployed): `/api/signal` has no rate limit, so one script can take signaling down for everyone

- `POST` accepts any random 32-hex room. Each message (up to 16 KB) is stored in Upstash for 10 min, 32 per key, unlimited keys.
  At 100 req/s that is ~1.6 MB/s of Redis memory and 100 commands/s, so the Upstash data size or command quota runs out within minutes.
- `GET` long-polls 25 s and **opens a new Redis connection per poll** (`lib/mailbox.js` `take`). A few hundred parallel `curl`s exhaust Upstash's connection limit and burn Vercel function time.
- Result: every transfer fails to connect; on Hobby, Vercel can pause the project once usage limits are hit; a pay-as-you-go Upstash plan bills for it.
- Checked locally (`dev.mjs`): 300 of 300 posts to random rooms with 15 KB bodies accepted; 200 parallel polls held open. Not run against production.

Done: 180 posts and 180 polls a minute per IP or /64 (`lib/limit.js`), then 429. Max message 16 → 8 KB (real ones are ~1.1 KB), mailbox TTL 10 → 2 min. One address now holds at most ~75 polls and ~3 MB.
Still open: an attacker with many addresses. Add a Vercel Firewall rate-limit rule on `/api/*` and check the Upstash plan's limits.

## 2. HIGH (fixed, not deployed): `/api/ice` is a free Cloudflare TURN credential dispenser

- 60 credentials an hour per IP, each valid 8 h, so about 480 live credentials per IP, and more with several IPs. They work outside the site as a general relay.
- **Kill switch:** relaying ~900 GB through them trips the guard, which revokes everything and turns hidden mode off **for every user for up to 31 days**. One person with a few servers can do this in hours.
- **Overshoot:** Cloudflare analytics lag and the once-a-minute check mean the true total can pass 1,000 GB before revocation. Above that it's $0.05/GB if the account has billing.

Done: a daily budget (`RELAY_DAILY_GB`, default 60) next to the 31-day one, so an attack costs one day of the relay, not a month. Mint default 60 → 20 an hour per client.
Skipped: tying passes to an active room. An attacker plays both sides, so it adds one request per pass and no real protection.
Still open: check the Cloudflare account has no card on file, or has a spending cap.

## 3. MEDIUM: a link posted publicly can be griefed

Links are passwords by design, but people will tweet them. Anyone holding one can:
- Spam `hello` with fresh receiver IDs. The sender allows 8 unproven peers for 20 s each, so a loop keeps the slots full and the real receiver never gets an offer.
- `GET ?me=s` for that room to drain the sender's mailbox.
- With Hide IP off, get the sender's IP (expected, but worth saying near the share button).

Fix: per-room `hello` limit on the server; one line on the send screen: "Anyone with this link can download the file."

## 4. LOW: `/api/guard` is public

It reveals live usage and the credential count (an attacker can watch the budget attack progress), and each call runs Redis work and can start a revoke sweep. Fix: have the Cloudflare worker send a secret header; public callers get 404 or `{state}` only.

## 5. INFO: URL parameters `?sink=mem` and `?zip=0`

A crafted link can force in-memory saving, so a large file crashes the receiver's tab. Only the sender makes the link, and they could do worse, so this is low. Either drop the params in production or ignore them unless on localhost.

## Held up well

- Strict hash-based CSP, no `innerHTML`, `frame-ancestors 'none'`, HSTS, nosniff.
- The server only sees `hash(secret)`. Proofs are bound to the DTLS fingerprints, so the server or a log reader can't MITM or read a file.
- Untrusted-peer handling: file names stripped of bidi/control characters and slashes, size checks, a decompression-bomb cap (16 MB per block, stop on overflow), and strict parsing of control messages.
- No private files served (`.env`, `package.json`, `lib/`, `test/`, `decisions.tsv` all 404 live).
- Downloads go out as `application/octet-stream` attachments, so nothing a sender sends renders on the origin.
