# Across

Send a file from one browser to another. There is no account. Files of any size go through on the same network or over a direct connection. Transfers through the relay share a daily and monthly allowance of relay traffic (see [Set up the relay](#set-up-the-relay)), so a very large hidden transfer can stop partway when it runs out. The file, its name, and the secret in the link never reach the server. By default, neither person learns the other's IP address.

Live at https://acrossfile.com. A plain-language explanation for users is at https://acrossfile.com/how (`public/how.html`). MIT licensed; see `LICENSE`. To report a security problem, see `SECURITY.md`.

## How it works

- The file travels over an encrypted WebRTC data channel between the two browsers.
- The server passes three short handshake messages between them and nothing else. Each browser long-polls its own mailbox at `/api/signal`, which is a Redis list that expires after 2 minutes.
- Before it connects, each browser asks `/api/ice` for short-lived credentials for Cloudflare's TURN relay.
- The secret after `#` in the link stays in the browser. The server sees only a hash of it, which names the room.
- Both browsers prove they know the secret with an HMAC bound to the certificates of their own encrypted connection. A server that relays two separate connections sees different certificates on each side, so it can't produce a valid proof. The worst a dishonest server can do is refuse to connect you.
- The receiver treats the sender as untrusted. It strips control and text-direction characters from the file name, and it stops if the bytes don't add up to the announced size.
- Chrome, Edge, and Firefox write to disk as bytes arrive. Safari and iOS hold the file in memory until it finishes, so the receiver warns before downloading a file over 1 GB there.

## Getting the link across

- The sender also gets a six-letter code, like `PZK MFS`, to type on the home page of the other device. Saying six letters across a room beats passing a link between two devices. Codes use only consonants, so they never spell a word.
- A short code can't stand in for the link's secret: a server could try every code in seconds. So the first two letters only name the sender's room, held at `/api/code` for 10 minutes and renewed while the page is open. The other four never leave the two browsers. Both sides run CPace (draft-irtf-cfrg-cpace) on X25519: each turns the code and the connection's certificate fingerprints into the same curve point and does a Diffie-Hellman exchange from it, then proves itself with the key they agree on. Anyone without the code, the server included, gets one guess per connection (1 in 130,321), and watching an exchange doesn't let them test guesses afterwards.
- After three wrong codes the sender stops offering it and says to send the link instead. That keeps a stranger's chance below 1 in 43,000. Someone typing wrong codes on purpose can kill a code that way, but can't get the file. The link still works.
- Codes need X25519 in WebCrypto (Chrome 133, Firefox 130, Safari 17). A browser without it shows only the link. `test/code.mjs` covers a right code, a wrong one, an unknown one and a retired one; `SENDER=firefox` runs it with Firefox sending.
- The sender sees the link in a box with a Copy button, a Share button where the device has a share sheet (phones, Safari, Edge), and a QR code to scan from a phone. The QR encoder is in the page, because the CSP allows no outside scripts. `test/ui.mjs` scans its output back with Chrome's barcode reader at every size it supports.
- Some browsers and embedded views refuse clipboard access. Copy then tries the older copy command, and if that fails too it leaves the link selected and says how to copy it by hand. Before this, a refused copy did nothing, so pasting gave whatever link was copied last.
- Both sides hold a screen wake lock while it matters: the sender from the moment it picks a file until a receiver has it, the receiver from Download until the end. A phone that locks its screen pauses the page and the transfer with it.
- A receiver that holds files in memory (iPhone, iPad, Safari) gets **Save to Photos** for a photo or video, next to **Save file**. It opens the share sheet, whose Save Image or Save Video puts it in Photos; a download can only go to Files. The page names the file's type from its extension, from a fixed list of image and video types. `test/photos.mjs` checks this with the share sheet stubbed.
- The page sends one file at a time. Dropping several files or a folder says so instead of sending the first one.
- A receiver in an app's built-in browser (Facebook, Instagram, LinkedIn, Snapchat, Line, TikTok, WeChat, KakaoTalk, Pinterest, X, or any Android web view) is told to open the link in a real browser, since those views often drop downloads.

## Why it's fast

- Most transfers are limited by the sender's upload, so the page sends fewer bytes when it can. It reads the file in 8 MB blocks and deflates a block when a 64 KB sample of it shrinks by at least 10% and the link isn't faster than the compressor. The next block is read and compressed while the current one sends. Through a relay capped at 1 MB/s, the median of 3 runs went from 0.8 to 3.8 MB/s for JSON, 0.8 to 3.5 for CSV, 1.0 to 3.0 for a source archive, 0.9 to 1.3 for an uncompressed photo, and 1.0 to 37 for logs. Zip files, video, and other compressed data go out unchanged at the same speed.
- The receiver asks for compressed blocks in its `start` message, so pages from before this change still work. A browser without `deflate-raw` streams (Safari before 16.4, Firefox before 113) neither asks for them nor sends them. `OLD=send` or `OLD=recv` in `test/link.mjs` plays such a browser. Each compressed block comes after a `z` message giving its compressed and original sizes, at most 16 MB each. The receiver stops inflating as soon as the output passes the announced size, so a dishonest sender can't use it to fill memory. `test/zip-evil.mjs` covers this.
- On the same network, a second connection carries the file over that network instead of out to the relay and back. See below.
- Each side sends its handshake 250 ms after its last new candidate, once it has a relay candidate and, if it may connect directly, a server-reflexive one. Browsers rarely report that gathering is complete, because some relay addresses never answer. Waiting for that used to add about 1.3 seconds on each side.
- The receiver sends nothing while the file flows, and the sender shows progress from its own buffer. Messages going the other way mid-transfer made Chrome's data channel stall for about 20 seconds.

## Who sees your IP address

Each person has a **Hide my IP address** switch. It starts on, and the browser remembers the choice in `localStorage`.

- With the switch on, your browser connects only through the relay. The handshake that reaches the other person lists the relay's address and no address of yours. Before it posts the handshake, the page checks that every candidate address in it is a relay address. If any isn't, the page sends nothing.
- With the switch off, your browser offers a direct connection, which shows the other person your IP address. It also offers the relay, for networks where a direct connection fails.
- Each person's box controls only their own address. If one person hides and the other doesn't, traffic goes from the hiding person's relay to the other person's address.
- Alongside that connection, both browsers always try a second one over the local network, with no servers. Browsers name their own addresses in it with random `.local` names that only resolve on the same network, so it connects only when both people share one. That makes hidden transfers on one network run at local speed instead of going out to the relay and back. Both pages keep only those names in what they send and in what they accept. A peer that slipped a real address into it would otherwise get this connection to send to that address directly. A browser that offers real addresses instead of `.local` names gets no local connection. If both connect, the sender waits up to a second for the local one before it uses the relay.
- If the switch is on and the relay is unavailable (switched off, out of budget, or this network's hourly limit used up), the page falls back to the local connection alone. Its handshake then carries only `.local` names, and it accepts only those, so it still reveals no address and connects only on the same network. A receiver that gets such a handshake answers the same way, even if its own relay works. If nothing connects within 15 seconds, the page says the relay is unavailable, how many minutes are left if it's the hourly limit, and that turning the switch off connects from anywhere. `BUSY` and `SPLIT` in `test/link.mjs` cover this on one network and on two.
- You can change the switch until you press **Download**. The page then starts its handshake again. A sender who changes it affects only the people who haven't connected yet.

Three parties see more than the other person does:

- Cloudflare's relay sees both IP addresses and the encrypted bytes. It can't read the file, because the two browsers encrypt it end to end and check each other's certificates with the HMAC above.
- Vercel sees each browser's IP address, because every web request carries it. It also sees the room hash and the handshake messages. With the switch on, those messages carry relay addresses only.
- Redis stores no IP address. The rate limit counts requests under a SHA-256 hash of the IP address and a random salt. For IPv6, it hashes the address's /64 network, since one client can use any address in it. The salt changes every day and expires after two days.

## Files

- `public/index.html` is the whole app: markup, style, and script.
- `public/how.html` explains to users how it works and who sees what. It has no script. The CSP allows the inline blocks of both pages.
- `public/sw.js` is a service worker that turns the incoming bytes into a normal browser download.
- `api/code.js` holds a code's first two letters for the sender's room, with `lib/codes.js`.
- `api/signal.js` passes handshake messages. It validates every message (at most 8 KB) and stores it with `lib/mailbox.js`. Each client (an IPv4 address or IPv6 /64) gets `SIGNAL_POSTS_PER_MIN` posts and `SIGNAL_POLLS_PER_MIN` polls a minute, then `429` with `Retry-After`, so one address can't fill Redis or hold its connections. `lib/limit.js` keeps these counters, and the relay's, under a salted hash of the address.
- `api/ice.js` hands out relay credentials. `lib/guard.js` decides whether to hand them out, and `lib/relay.js` talks to the relay provider.
- `api/guard.js` runs the same budget check without handing out a credential, and revokes credentials at the budget.
- `lib/redis.js` opens Redis connections for the functions.
- `lib/headers.js` builds the security headers, including the CSP hashes of the page's inline script and style.
- `vercel.ts` is the Vercel config. `dev.mjs` is the local server.
- `worker/` is a Cloudflare Worker that calls `/api/guard` every minute. `.vercelignore` keeps it out of the Vercel deployment.
- `test/` holds the browser tests, which drive the installed Chrome. `sh test/servers.sh` starts a local coturn relay and the dev servers, and `sh test/matrix.sh http://127.0.0.1:8090 <file>` runs a transfer for each combination of the two boxes. `sh test/zipbench.sh http://127.0.0.1:8093 <runs> <file>...` compares compression off and on through a relay capped at 1 MB/s. `test/link.mjs` refuses to run against a local server that serves an older page than the one on disk, since `dev.mjs` reads the page once at startup. `.vercelignore` keeps `test/` out of the deployment too. `node test/cf-stub.mjs` stands in for Cloudflare's APIs for `budget.mjs`, `limits.mjs` and `daily.mjs`; `signal-limits.mjs` checks the signaling limits.

## Run it locally

You need Node 20 or later.

```
npm install
npm run dev
```

Open http://localhost:8080, choose a file, and open the link in another browser or profile. Set `PORT` to use another port.

Without a Redis URL, `dev.mjs` keeps mailboxes and relay state in memory. To run against a real Redis instead:

```
REDIS_URL=redis://localhost:6379 npm run dev
```

Without relay variables, `/api/ice` answers `503 {"relay":"off"}`, so with the switch on it connects to no one. Turn it off to test direct connections. To test the relay, run coturn with a shared secret and point the app at it:

```
turnserver --listening-ip=127.0.0.1 --relay-ip=127.0.0.1 --use-auth-secret --static-auth-secret=dev-secret \
	--realm=dev --allow-loopback-peers --denied-peer-ip=0.0.0.0-126.255.255.255 --denied-peer-ip=128.0.0.0-255.255.255.255 \
	--no-tls --no-dtls
RELAY=coturn TURN_SECRET=dev-secret TURN_URL='turn:127.0.0.1:3478?transport=udp' npm run dev
```

The two `--denied-peer-ip` ranges limit coturn to loopback peers. Without them, coturn tries to reach the public address that STUN reports for a browser with the switch off, fails from its loopback socket, and closes the allocation.

`dev.mjs` sends the same headers as production, because both get them from `lib/headers.js`.

## Deploy to Vercel

1. Link this folder to a Vercel project with `vercel link`.
2. Add Upstash Redis with `vercel integration add upstash`. Choose the `us-east-1` region, which sits next to the functions' default region, `iad1`.
3. Run `vercel env ls` and check that the project now has `REDIS_URL` or `KV_URL`.
4. Set up the relay, as the next section describes.
5. Deploy with `vercel deploy --prod`.
6. Deploy the worker that runs the budget check every minute, as [Run the budget check every minute](#run-the-budget-check-every-minute) describes.

If neither `REDIS_URL` nor `KV_URL` is set, every request to any function fails and the function log says why. In-memory state would lose messages at random, because Vercel runs several function instances that don't share memory.

`vercel.ts` serves only `public/`, gives `api/signal.js` a 30 second limit and `api/ice.js` and `api/guard.js` a 10 second limit each, and adds the security headers to every response. The CSP allows the page's own inline script and style by hash and nothing else. The hashes come from `public/index.html` at build time, so an edit to the page needs no manual hash update.

## Set up the relay

The relay is Cloudflare Realtime TURN. You need a Cloudflare account.

1. In the Cloudflare dashboard, open **Realtime**, then **TURN Server**, and create a TURN key. Copy the key ID and its API token.
2. Under **My Profile**, then **API Tokens**, create a custom token with the permission **Account**, **Account Analytics**, **Read**, limited to your account. The cost guard uses it to read how much the relay has sent.
3. Copy your account ID from the account's overview page in the dashboard.
4. Add each variable to every environment. `vercel env add` asks for the value:

	```
	for name in TURN_KEY_ID TURN_KEY_API_TOKEN CF_ACCOUNT_ID CF_ANALYTICS_TOKEN; do
		for target in production preview development; do vercel env add "$name" "$target"; done
	done
	```

5. Check that the analytics token can read TURN usage. The answer must have `"errors":null` and an `accounts` list with one entry:

	```
	curl -s https://api.cloudflare.com/client/v4/graphql \
		-H "Authorization: Bearer $CF_ANALYTICS_TOKEN" -H 'Content-Type: application/json' \
		-d '{"query":"query($a: string!, $f: Date!, $t: Date!) { viewer { accounts(filter: {accountTag: $a}) { callsTurnUsageAdaptiveGroups(filter: {date_geq: $f, date_leq: $t}, limit: 1) { sum { egressBytes } } } } }","variables":{"a":"'"$CF_ACCOUNT_ID"'","f":"'"$(date -u -v-30d +%F)"'","t":"'"$(date -u +%F)"'"}}'
	```

	On Linux, use `date -u -d '30 days ago' +%F` instead of `date -u -v-30d +%F`.

6. Deploy again so the functions read the new variables.

If `TURN_KEY_ID` is set and another of these variables is missing, `/api/ice` and `/api/guard` answer `503 {"relay":"off"}` and the function log names the missing ones.

## Run the budget check every minute

Without this step, the guard runs only when someone asks `/api/ice` for a credential. A credential lasts 8 hours, so if usage passes the budget and nobody loads the page afterwards, the credentials already handed out keep relaying. The worker in `worker/` calls `/api/guard` once a minute, so the guard revokes them at the budget whether or not anyone visits.

The worker runs on the Cloudflare Workers free plan and holds no secret.

1. Find the production domain that people open, under **Domains** in the project's settings on Vercel. Use that domain, not a deployment URL. Vercel can put a login page in front of deployment URLs, and the worker would get that page instead of the guard's answer.
2. Check that the domain answers with the guard's JSON:

	```
	curl -s https://YOUR-DOMAIN/api/guard
	```

3. In `worker/wrangler.toml`, set `APP_URL` under `[vars]` to that origin, such as `APP_URL = "https://YOUR-DOMAIN"`.
4. Log in to Cloudflare and deploy the worker:

	```
	cd worker
	npx wrangler login
	npx wrangler deploy
	```

5. Watch it run:

	```
	npx wrangler tail
	```

	Within a minute, each run logs one line, such as `guard 200 {"state":"open","usedGB":12.5,"budgetGB":900,"todayGB":0.4,"dailyGB":60,"live":2,"revoked":0}`.

If `/api/guard` answers anything other than 200, or `APP_URL` is empty, the run throws, and the Cloudflare dashboard lists that cron run as failed.

To run the worker's scheduled handler locally against `npm run dev`, start it with `npx wrangler dev --test-scheduled --var APP_URL:http://localhost:8080` from `worker/`, then open `http://localhost:8787/__scheduled?cron=*+*+*+*+*`.

## How the cost guard works

Cloudflare charges $0.05 per GB that the relay sends to browsers, after the first 1,000 GB each month. The allowance is per account, and Cloudflare's SFU service shares it. Traffic that browsers send to the relay is free.

`/api/ice` runs these checks in order before it hands out a credential:

1. A relay provider is configured. If not, it answers `503 {"relay":"off"}`.
2. This client has asked for fewer than `RELAY_MINTS_PER_HOUR` credentials this hour. If not, it answers `429 {"relay":"busy","retry":<seconds until the next hour>}`.
3. A usage reading from the last minute says the account's TURN traffic over the last 31 days is under `RELAY_BUDGET_GB` and today's (UTC) is under `RELAY_DAILY_GB`. If not, it answers `503 {"relay":"budget"}`.
4. Cloudflare mints the credential. If that call fails, it answers `502 {"relay":"error"}`.

The budget counts the last 31 days, not the calendar month. Cloudflare's docs say "each month" without saying whether that means the calendar month or the billing cycle. Every month of either kind fits inside some 31-day window, so a 31-day budget holds for both.

The guard asks Cloudflare for usage at most once a minute. A request that finds no reading from the last minute takes a lease in Redis and queries Cloudflare. Requests that arrive during that query wait up to 3 seconds for its reading, and a request that waits longer is refused. They never fall back to the older reading they saw before they waited, so no credential is minted unless a reading from the last minute says usage is under the budget. A failed query is stored as a reading too, so nobody queries again until the minute is over.

The budget state comes from the latest reading:

- **open**. The reading is less than a minute old and under the budget. The guard mints.
- **closed**. The reading is less than a minute old and at or over the budget. The guard refuses and revokes every live credential.
- **unknown**. There is no reading from the last minute, or its query failed. The guard refuses. Once queries have failed for 5 minutes in a row, it also revokes every live credential.

The unknown state waits 5 minutes before it revokes because one failed query is usually a passing error in Cloudflare's analytics API, and revoking on it would cut every relayed transfer in progress. A run of failed queries is different. The guard can't see usage, and the credentials it already handed out could relay for up to 8 hours. With the worker calling every minute, the guard revokes them about 5 minutes after the first failed query. New credentials stop at the first failed query either way.

At the budget, the guard stops handing out credentials and revokes every unexpired one it handed out. It records each credential in a Redis sorted set scored by expiry, so expired ones drop out by score. Before a revoke, the guard claims the credential in Redis for 10 seconds, so two sweeps never revoke the same one at once. The credential leaves the set only after Cloudflare confirms the revoke. If a revoke fails, or its function stops before Cloudflare answers, the credential stays in the set, and the first sweep after the claim lapses tries again. Running the sweep again once nothing is live does nothing.

`GET /api/guard` runs the same check as `/api/ice`, against the same reading and lease, without minting. At the budget it runs the same sweep. It answers `503 {"relay":"off"}` without a relay provider, and otherwise `200` with this JSON:

| Field | Meaning |
| --- | --- |
| `state` | `open`, `closed`, or `unknown`. |
| `usedGB` | TURN traffic over the last 31 days in the reading, in GB of 10^9 bytes. `null` when the state is `unknown`. |
| `budgetGB` | `RELAY_BUDGET_GB`. |
| `todayGB` | TURN traffic so far this UTC day in the reading. `null` when the state is `unknown`. |
| `dailyGB` | `RELAY_DAILY_GB`. |
| `live` | Credentials the guard handed out that have neither expired nor been revoked. |
| `revoked` | Credentials this call revoked. |

`/api/guard` needs no secret. A caller can only make it run the check that the next visitor would run anyway. Under the budget, with a reading from the last minute, a call costs 2 Redis commands and no Cloudflare call.

The guard can't stop everything:

- Without the worker, it runs only when someone asks `/api/ice` for a credential.
- Cloudflare's usage numbers arrive with some delay, and the guard reads them once a minute. The default budget of 900 GB leaves 100 GB for that delay and for the 5 minutes the unknown state waits.
- It counts TURN traffic only. If the same Cloudflare account uses the SFU, lower `RELAY_BUDGET_GB` by that amount, or use a separate account for this app.

## Usage stats

The page counts how it is used: page views, files picked, connections, and transfers started, finished or failed, with sizes rounded to two figures, the file's kind, how it connected (same network, direct or relay), how long it took and why it failed. It never sends a file name, link, code or address. `public/privacy.html` lists everything for the people using it.

- The page posts each event to `/api/event` with `navigator.sendBeacon`. No third-party script loads, so the CSP is unchanged: the browser only ever talks to this site.
- `api/event.js` checks every field against a fixed list per event, with types and ranges, and drops the whole event if anything is off. A changed page still can't send a name or a link through it.
- It adds country (from Vercel's `x-vercel-ip-country`), coarse browser, OS and device type, and a visitor id: a hash of the client's network and user agent with a salt that changes daily, kept in Redis for two days. That counts people per day without cookies and can't link days. Each page load also makes a random session id, kept only in memory.
- It forwards to PostHog as personless events (`$process_person_profile: false`) with GeoIP off, so PostHog never sees the visitor's address. Bots, Global Privacy Control and Do Not Track send nothing. The privacy page has a switch that turns stats off for that browser.
- Without `POSTHOG_KEY` the endpoint accepts and drops events, as on a local machine. `test/event.mjs` checks the filter; `test/stats-e2e.mjs` runs a transfer against a capture stub and checks every event arrives and none carries the name or link.

## Configuration

| Variable | Read by | Meaning |
| --- | --- | --- |
| `REDIS_URL` | every function | Redis connection URL, such as `rediss://default:token@host:6379`. Read first. |
| `KV_URL` | every function | Read when `REDIS_URL` is not set. |
| `TURN_KEY_ID` | `api/ice.js`, `api/guard.js` | Cloudflare TURN key ID. Setting it selects the Cloudflare relay. |
| `TURN_KEY_API_TOKEN` | `api/ice.js`, `api/guard.js` | API token of that TURN key. Mints and revokes credentials. |
| `CF_ACCOUNT_ID` | `api/ice.js`, `api/guard.js` | Cloudflare account ID, for the usage query. |
| `CF_ANALYTICS_TOKEN` | `api/ice.js`, `api/guard.js` | API token with Account Analytics Read, for the usage query. |
| `RELAY_BUDGET_GB` | `api/ice.js`, `api/guard.js` | Relay traffic over the last 31 days, in GB of 10^9 bytes, at which the guard stops. The default is 900, and the most it accepts is 1000, the free allowance. `0` keeps the relay closed. A value above 1000, or one that isn't a number of at least 0, logs an error and uses 900. |
| `RELAY_DAILY_GB` | `api/ice.js`, `api/guard.js` | Relay traffic in one UTC day at which the guard stops until the next day, so someone burning traffic on purpose costs a day of the relay, not the month. The default is 60, the most it accepts is 1000. |
| `RELAY_MINTS_PER_HOUR` | `api/ice.js` | Credentials one client can get per hour. The default is 20. A value that isn't a number of at least 0 logs an error and uses 20. |
| `POSTHOG_KEY` | `api/event.js` | PostHog project API key (`phc_…`). Unset turns usage stats off. |
| `POSTHOG_HOST` | `api/event.js` | PostHog ingestion host. The default is `https://us.i.posthog.com`. |
| `EVENTS_PER_MIN` | `api/event.js` | Usage events one client can send a minute. The default is 120. |
| `SIGNAL_POSTS_PER_MIN`, `SIGNAL_POLLS_PER_MIN` | `api/signal.js` | Handshake posts and polls one client can make per minute. The defaults are 180 each. `test/servers.sh` raises them, since every local test comes from one address. |
| `RELAY` | `api/ice.js`, `api/guard.js` | `cloudflare`, `coturn`, or `none`. Without it, the relay is `cloudflare` when `TURN_KEY_ID` is set and `none` otherwise. |
| `TURN_SECRET`, `TURN_URL` | `api/ice.js` | With `RELAY=coturn`, the coturn shared secret and a comma-separated list of TURN URLs. coturn credentials can't be revoked and have no budget. |
| `CF_RTC_BASE`, `CF_API_BASE` | `api/ice.js`, `api/guard.js` | Base URLs of Cloudflare's TURN and GraphQL APIs. Tests point them at a local stub. |
| `PORT` | `dev.mjs` | Local port. The default is 8080. |
| `APP_URL` | `worker/worker.js` | Set in `worker/wrangler.toml`. The app's production origin, whose `/api/guard` the worker calls. |

## What it costs

Vercel Hobby doesn't bill for overage. Past a limit, the service stops until the monthly allowance resets. Upstash on pay-as-you-go bills per command, so set a monthly budget cap in the Upstash console.

These counts come from a local Redis, measured with `INFO commandstats`:

| Activity | Function invocations | Redis commands |
| --- | --- | --- |
| A sender tab left open, per hour | 144 | 288 |
| One transfer handshake | about 7 | about 25 |
| One relay credential, for each page load | 1 | 11, counting `MULTI` and `EXEC` |
| The worker's budget check, per hour | 60 | up to 240 |

A receiver whose sender has gone retries for 2 minutes and then stops. That costs about 20 invocations and 85 commands, worked out from the same counts.

Under the budget, a check costs 4 Redis commands when it queries Cloudflare and 2 when another request already did this minute. At the budget, listing the credentials to revoke adds 2, and each revoke adds 2. A function instance's first Redis command of its life adds one `HELLO`. Over a 30-day month, the worker adds 43,200 invocations and up to 172,800 Redis commands. One sender tab left open all month costs 207,360.

The worker leaves about 956,800 of Vercel's 1,000,000 monthly invocations, which cover about 6,600 hours of open sender tabs. Vercel's 360 GB-hours of provisioned memory cover about 180 hours during which any tab is waiting. Each function instance holds 2 GB, and a waiting long-poll keeps its instance alive. One instance serves many waiting tabs at once, so this budget counts hours with at least one tab waiting, not tabs. If each of the worker's checks keeps an instance busy for one second, the worker uses 24 of those GB-hours a month.

The memory figures are estimates from Vercel's published pricing, not measurements. It is likely the first limit a site with steady traffic reaches. Check **Usage** in the Vercel dashboard after the first few days.

## Limits

- The sender's tab must stay open until the download finishes. On a phone it must also stay on screen, since phones pause pages in the background.
- Desktop Safari and iOS are not covered by the automated tests. `test/engines.mjs` runs transfers between Chrome and Firefox.
- Through Cloudflare's relay, expect lower speeds than a direct connection. Cloudflare says it may drop packets from one TURN client that sends faster than 50 to 100 Mbit/s, which is 6 to 12 MB/s.
- A relayed transfer stops when its credential expires. The page reuses a credential for up to an hour, so a relayed transfer has at least 7 hours.
- If both people turn the switch off and both networks block direct connections, the relay still connects them.
- One IPv4 address, or one IPv6 /64 network, can get 60 relay credentials an hour. A sender asks for one only when someone opens its link. Past the limit, hidden mode falls back to the local network only, so it still works on the same Wi-Fi, and the page says how many minutes are left.
- Vercel Hobby allows non-commercial use only.
