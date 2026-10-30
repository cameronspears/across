# Relay throughput on fast machines

Goal: make hidden ("Hide my IP address") transfers over the internet 2 to 3 times faster, at no cost and with privacy unchanged. This file covers the measurement half: what limits relayed throughput when both ends are fast, and which change, if any, raises it.

## Verdict

**Inconclusive. No change to `public/index.html` is recommended.**

- The live app's hidden mode ran at 14.3 MB/s (median of 5, range 14.0 to 16.2) in the first window. Forty-five minutes later the same app on the same path ran at 24.6 MB/s (median of 3, range 15.3 to 29.2). The relay's speed drifts by about 2x over time on its own, which is as large as the target gain.
- Striping over two relay connections (each its own TURN allocation) gave 26.7 to 35.3 MB/s in the micro-benchmark. In those same rounds most single connections were far slower, because they stalled. Run through the real app flow, a patched copy with two connections came out at 14.7 MB/s (median of 3, range 7.8 to 15.1). Plain live runs interleaved with it got 24.6 MB/s. Two connections lost there: they wait about 2.5 s for the second link, and they still stall.
- About 30 to 35 MB/s per tab looks like a hard ceiling. The busiest Chrome threads reach 60 to 90% of a core at that rate. Direct (unhidden) transfers top out at 31 to 32 MB/s with `WebRTC_W_and_N` at 91%. At best, relayed transfers have about 2x of headroom, and only in the slow windows.
- For real users, the relay is not what limits them. Even in its slowest steady window the relay carried 14 MB/s, which is about 112 Mbit/s. A sender's upload is slower than that on most home connections (the user's laptop manages 1.1 MB/s). For those users hidden mode already runs at their upload speed, and no relay-side change can make it 2 to 3x faster.

The one fault that repeats is multi-second stalls (below). Fixing them would make hidden transfers more even. No experiment here found a lever that does that.

## Setup

- There are two persistent Vercel Sandboxes, `ftbench-a` (sender) and `ftbench-b` (receiver), each 4 vCPU / 8 GB in `iad1`. Each peer has its own CPU and network. Both run Chrome for Testing 156.0.8078.73 (stable), headless, with `--no-sandbox` via puppeteer-core 24.
- The harness is `node run.mjs setup | speed | app | bench | plan | stop`, in `test/cloud/`. It writes `runs.jsonl`, `capacity.jsonl` and `usage.jsonl`. The scripts that run inside the sandboxes are in `remote/`.
  - `remote/setup.sh` installs Chrome and its deps (`@puppeteer/browsers --install-deps`). It mints one TURN credential per sandbox from the live `/api/ice` and saves it to `ice.json`. Three more credentials (`ice1..3.json`) were minted later for the per-credential test. That makes 4 per sandbox in total, under the limit of 12 per hour per IP.
  - `remote/app.mjs` drives the real app on `https://file-transfer-tan-alpha.vercel.app`. CDP `Fetch` answers `/api/ice` from the saved credential, so the rate limit is never hit. Given `page.json`, it also answers the document with a patched copy and that copy's own CSP. It records the selected candidate pair, relayProtocol, RTT, CPU per Chrome process and thread (from `/proc`), kernel UDP/TCP counters, and a 0.5 s receive timeline. The receiver checks the downloaded file's sha256 against the sender's.
  - `remote/bench.mjs` is a raw WebRTC micro-benchmark. Both ends are relay-only, and connections, channels, message size, watermarks, transport and credentials are configurable. Signaling goes over the live `/api/signal`. Bytes are generated in the page, not read from a file. The receiver sends nothing once the channels open. It checks byte counts and a per-message sequence byte, and records the timeline and candidate-pair switches.
  - `summary.py` prints a table for each label, `sessions.mjs` prints usage, and `patch-app.mjs` builds the patched copy.
- `public/index.html` changed while this work ran (a compression feature, not deployed). The live page has no `CompressionStream`. So the patched copy is built from the deployed page, saved as `patched/live-base.html`, not from `public/`. Nothing in `public/` was written.

## Raw capacity (sandbox to Cloudflare)

These numbers come from `speed.sh` against speed.cloudflare.com: 50 MB down and 25 MB up, with 1 and then 4 streams, two passes per sandbox. The transfers are short, so they are noisy and set a floor, not a precise figure.

| | A (sender) | B (receiver) |
|---|---|---|
| upload, 1 stream | 57 to 64 MB/s | 46 to 62 MB/s |
| upload, 4 streams | 157 to 161 MB/s | 32 to 82 MB/s |
| download, 1 stream | 147 to 214 MB/s | 133 to 257 MB/s |
| TCP connect to turn.cloudflare.com (min/median/max of 10) | 1.1 / 1.4 to 1.8 / 15 ms | 1.3 / 2.0 to 2.2 / 10 ms |

turn.cloudflare.com resolves to 141.101.90.1, colo IAD. Relay pairs reported an RTT of 4 to 13 ms. On a single stream the network can carry 3 to 4 times the best relayed rate, so it is not the limiter.

## Baseline: the live app, 200 MB of random data

Runs alternated between hidden and direct.

| mode | runs | median | range | candidate pair (receiver) | busiest sender thread |
|---|---|---|---|---|---|
| hidden (both relay-only) | 5 | **14.3 MB/s** | 14.0 to 16.2 | relay/udp 3478 or 443; one run tcp:80 on the receiver leg | NetworkService `Chrome_ChildIOT` 36 to 46%, `WebRTC_W_and_N` 30 to 44% |
| direct (both unticked) | 3 | **31.4 MB/s** | 24.5 to 32.2 | srflx/udp to srflx/udp | `WebRTC_W_and_N` 73 to 91%, NetworkService 56 to 81% |

- **Errors and correctness.** Every sha256 matched. There were no console errors. The sender put 1.13 to 1.17 bytes on the wire per file byte (TURN, DTLS, SCTP and IP overhead).
- **Why not double, hidden.** No thread was above 46% of a core and the machine was at 96 to 120% of 400%, so it is not CPU. It is not the network (above). The receiver kernel dropped 14 to 456 UDP datagrams per run (`RcvbufErrors`), which is 0.01 to 0.25% of about 183k, and SCTP reacts to that loss. The relay's documented limits for each allocation are ">50-100 Mbps" and ">5-10 kpps", with "Hitting these limits will result in packet drops" ([Cloudflare TURN limits](https://developers.cloudflare.com/realtime/turn/)). 14 MB/s is about 112 Mbit/s and about 13k packets/s, right at that limit. Later runs went far past it (below), so the limit is soft, or it varies.
- **Why not double, direct.** `WebRTC_W_and_N`, the one thread that runs SCTP and DTLS for every connection in the tab, reached 91% on the sender. That is the per-tab CPU ceiling on these vCPUs.
- I wanted 5 direct runs and ran 3, to keep data in the budget.

## Hypotheses (micro-benchmark, relay-only on both ends)

Sizes were 30 to 100 MB. Variants alternated run by run within each round. "Stall" means 0.5 s timeline samples under 1 MB/s after the first sample. A failed run is one that did not finish within 100 to 180 s, which is a stall that never recovered.

**Run-to-run noise is huge and it is driven by stalls.** A typical slow run looks like this: about 1 s at 4 to 15 MB/s, then 5 to 6 s at 0 to 0.5 MB/s (a trickle, the shape of SCTP retransmission timeouts backing off), then recovery to 15 to 35 MB/s. The receiver kernel shows no drops during these stalls, and both CPUs sit idle. So the packets are lost between the hosts, which here means at or between the relays. With all six TURN URLs offered, many stalls lined up with ICE switching the selected pair 4.7 s after it first chose one (`selectedcandidatepairchange` on both ends). With only one URL there is only one pair, and stalls still happened, so pair switching is a second cause, not the only one. These stalls showed up far more often in the micro-benchmark, which sends 0.5 s after the channel opens, than in the live app's first window. I could not fully explain that difference.

### (a) bufferedAmount HIGH

| variant | runs | median | range | limiter |
|---|---|---|---|---|
| HIGH 4 MB (control, tls443) | 3 | 9.1 | 7.8 to 13.9 | relay stalls / soft relay limit |
| HIGH 15 MB, LOW 4 MB (tls443) | 3 | 4.5 | 4.0 to 16.9 | same. 2 of 3 runs stalled 3.5 to 6 s |
| HIGH 16 MB / 32 MB | 2 | failed | | Chrome throws `RTCDataChannel send queue is full`. The send queue is capped at 16 MiB, so HIGH must stay below 16 MiB minus one chunk |

No gain. With a 4 to 13 ms RTT, 4 MB already covers far more than one round trip at 30 MB/s (about 0.4 MB), so the buffer never empties. Why not double: the buffer is not what limits the rate.

### (b) Message size

| variant | runs | median | range | limiter |
|---|---|---|---|---|
| 256 KB (= `sctp.maxMessageSize`, control) | 3 | 9.1 | 7.8 to 13.9 | relay stalls |
| 64 KB (tls443) | 3 | 4.2 | 3.6 to 8.7 | relay stalls, 1 to 5.5 s |

No gain. Chrome to Chrome, `maxMessageSize` is exactly 262144, so "maxMessageSize" and 256 KB are the same variant. SCTP still sends about 1.2 KB packets whatever the message size, so message size cannot change the per-packet costs that bound both the relay and the CPU.

### (c) Several data channels in one connection

| variant | runs | median | range | limiter |
|---|---|---|---|---|
| 2 channels (tls443) | 3 | 11.5 | 11.5 to 13.9 | one SCTP association, so one congestion window and one relay allocation |
| 2 channels (udp, single URL) | 1 | failed | | stall |
| 2 / 4 channels (all URLs, round 1) | 1 + 1 | 3.4 / 8.1 | | stalls |

No measurable gain over one channel. Channels share one SCTP association and one 5-tuple through the relay.

### (d) Parallel RTCPeerConnections, striped, each with its own relay allocation

| variant | runs | median | range | limiter |
|---|---|---|---|---|
| 2 connections, two credentials, udp 3478 | 5 (4 ok) | **32.7** | 26.7 to 35.3 (plus 29.6 earlier, all URLs) | sender CPU. NetworkService `Chrome_ChildIOT` 72 to 83%, `WebRTC_W_and_N` 69 to 71%. No stalls in any finished run |
| 2 connections, one credential, udp 3478 | 4 (2 ok) | 21.9 | 5.4 to 38.4 | stalls in 3 of 4 runs. The 38.4 run shows that two allocations under one TURN user can carry more than 30 MB/s |
| 2 connections, two credentials, tls443 | 3 | 11.7 | 10.5 to 11.9 | stalls of 1.5 s in 2 of 3 runs. TLS gave no gain |
| 4 connections, four credentials | 2 (1 ok) | 11.5 | | stalls, plus one run that never finished |
| 2 / 4 connections, one credential, all URLs (round 1) | 1 + 1 | 13.9 / 13.1 | | stalls and pair switches |

These are the micro-benchmark's best numbers. They come from a short window, though, and the single connections they beat were mostly stalled runs, not steady ones. Why not double again: two lanes at about 33 MB/s put the sender's network-service I/O thread at about 80%, so a third or fourth connection has no CPU left to use. The 4-connection runs mostly stalled.

### (e) TURN transport

| variant (single URL per side) | runs | median | range | limiter |
|---|---|---|---|---|
| UDP 3478 | 4 (1 ok) | 4.6 | | stalls. 3 of 4 never finished |
| TCP 3478 | 1 | 15.9 | | relay |
| TLS 443 | 6 | 13.8 | 7.8 to 15.8 | relay. Shorter stalls than UDP, not none |
| all URLs (app default) | 1 | 2.0 | | stall at the 4.7 s pair switch |

A TCP or TLS leg to the relay stalled less often than UDP on one URL, but it was never faster than the live app's UDP baseline. I took UDP as the comparison point because the live app picks UDP itself when it is offered.

## Through the real app: patched copy vs live

`patch-app.mjs` builds a patched copy (`patched/index.html`, diff in `patched/diff.txt`) from the deployed page:

- Once the first relay link is proven, a hidden sender opens a second relay-only `RTCPeerConnection`. It uses a second TURN credential from `api/ice?n=2` (the harness serves the sandbox's second credential).
- The offer and answer travel over the first, already-proven data channel. That channel's DTLS authenticates the second link's fingerprints, so no server change is needed.
- Before any chunk is sent, the sender waits up to 6 s for the second link. It then alternates chunks across the two links, and the receiver reorders them by strict alternation.
- Both links stay relay-only (`iceTransportPolicy: 'relay'` plus the app's own `describe()`/`relayOnly()`).
- The receiver sends only `answer2`, before the first byte. During the transfer it sends nothing.

Runs used 100 MB of random data, both sides hidden, in the order patched, live, live, patched, live, patched.

| page | runs | median | range | sha256 ok | notes |
|---|---|---|---|---|---|
| live | 3 | **24.6 MB/s** | 15.3 to 29.2 | 3/3 | one link, 23 to 40 MB/s per 0.5 s. One run stalled 2.5 s at the end |
| patched (2 links) | 3 | **14.7 MB/s** | 7.8 to 15.1 | 3/3 | both links carried about half the bytes (for example 48.7 MB and 57.4 MB). The first 2.5 s are spent setting up the second link, then 23 to 45 MB/s. One run stalled 5.5 s |

The patch works end to end, but it made the app slower in this window. It costs about 2.5 s up front. Its steady rate was no higher than a single link's in the same window, because both hit the per-tab CPU ceiling (sender machine at 107 to 200% of 400% and NetworkService at 39 to 73% on the live runs). So the micro-benchmark gain did not carry over to the app. The one time it might help is a window when single links are slow, like the first baseline window. I could not show that window and the patch in the same run.

## Recommendation

- **Do not change `public/index.html` for throughput.** Neither the watermarks (16 MiB is a hard cap anyway), the message size, extra channels, nor TURN TCP or TLS gave a repeatable gain. Two allocations doubled throughput in the micro-benchmark but lost through the app.
- If you want to try again, the candidate is the two-link patch in `test/cloud/patch-app.mjs`. Before shipping it, it needs two things.
  - Evidence across several hours of relay conditions, so that slow windows and fast windows both show up.
  - A way to mint the second credential without halving the 12-per-hour budget, for example one `/api/ice` response carrying two credentials.
  - Expected gain: at most about 2x, and only when the relay is slow and the sender's upload exceeds about 15 MB/s (120 Mbit/s). Otherwise none, and about 2.5 s lost at the start.
- The stalls are worth a separate investigation: 5 to 6 s at a trickle after an initial burst, plus stalls when ICE switches pairs mid-transfer. They cost more than any knob tested here. Two cheap things to try first are starting the transfer only after the selected pair has been stable for a few seconds, and pacing the first second.

## Inconclusive or unexplained

- I could not explain why the micro-benchmark stalled far more often than the live app in the first window. The candidates are its 0.5 s start after the channel opens versus the app's proof and meta round trip, and gathering differences (the benchmark waits for gathering to complete, up to 8 s, while the app sends at 1.5 s). The app runs had no timeline in that window, so a short stall there would only show up as a lower average.
- Whether the relay's soft limit applies per allocation or per TURN user is not settled. One run with two allocations under one credential reached 38 MB/s, and the others stalled.
- Most hypothesis variants have 3 runs or fewer, not the 5 I wanted, and run-to-run spread (2 to 17 MB/s for single connections) is larger than any effect except the two-link result. That result did not hold in the app.

## Resource usage

| resource | used | budget |
|---|---|---|
| sandbox egress (outbound) | **6.02 GB (6,017,556,876 bytes = 5.60 GiB)**. At the 6 GB cap in decimal units, about 0.4% over | under 6 GB |
| sandbox ingress (free) | 7.03 GB | |
| active CPU | **0.473 h** (sum of `activeCpuDurationMs` over all sessions) | under 1.5 h |
| through Cloudflare's relay | **about 4.29 GB** (the app's `/api/guard` usedGB went from 0.142 to 4.433) | under 15 GB |
| sandboxes / sessions | 2 sandboxes, 6 sessions (two of them 3 to 6 s, opened by the final `stop`) | 5,000 creations/month |
| TURN credentials minted | 8 (4 per sandbox) | 12/h/IP |

Both sandboxes are stopped. Each is persistent and keeps one filesystem snapshot (Chrome and puppeteer installed), so `node run.mjs ...` can rerun without reinstalling. Delete them with `(await Sandbox.get({ name })).delete()` when no longer needed. I did not delete them, because that is irreversible. `node sessions.mjs` reprints the usage.
