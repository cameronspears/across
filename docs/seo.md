# Getting Across found

Checked 2026-11-02. A `site:acrossfile.com` search returned nothing, so Google has not indexed the site yet. That, not ranking, is the first problem: no page can rank until it is indexed.

## Do first (needs the owner's sign-in)

1. Google Search Console: add the domain `acrossfile.com` (DNS TXT record at the registrar), then **Sitemaps** → submit `https://acrossfile.com/sitemap.xml`. Then **URL inspection** → **Request indexing** for `/` and each guide.
2. Bing Webmaster Tools: **Import from Google Search Console** (one click once step 1 is done). Bing also feeds DuckDuckGo, Yahoo and ChatGPT search.
3. After a week, check **Pages** in Search Console for anything "Discovered – not indexed" and **Performance** for the queries you show up for.

Indexing usually takes days to a few weeks. Ranking for the searches below takes links from other sites, which is what the launch drafts are for.

## Target searches

Realistic means a small, new site can reach page one with a good page and a handful of links. Head terms ("file transfer", "send files", "wetransfer") belong to WeTransfer, Google, Snapdrop/PairDrop and big review sites; we don't aim at them.

| Search | Page | Chance |
|---|---|---|
| send file browser to browser | `/` | Good |
| peer to peer file transfer in browser | `/`, `/how` | Good |
| encrypted file transfer no account | `/`, `/how` | Good |
| send large file without uploading | `/send-large-files` | Good |
| send large files without upload to cloud | `/send-large-files` | Good |
| file too big to email free | `/send-large-files` | Medium |
| send large video file free no account | `/send-large-files` | Medium |
| send file from phone to pc without app | `/phone-to-computer` | Medium |
| iphone to windows file transfer without app | `/phone-to-computer` | Medium |
| airdrop alternative for windows and iphone | `/phone-to-computer` | Medium |
| android to mac file transfer no app | `/phone-to-computer` | Medium |
| transfer files between devices no account | `/phone-to-computer`, `/` | Medium |
| wetransfer alternative no account | `/wetransfer-alternative` | Medium |
| wetransfer alternative no upload | `/wetransfer-alternative` | Good |
| snapdrop alternative over internet | `/wetransfer-alternative` | Good |
| pairdrop alternative | `/wetransfer-alternative` | Medium |
| does the other person see my ip file transfer | `/faq`, `/how` | Good |
| hide ip address p2p file transfer | `/how`, `/faq` | Good |
| across file transfer / acrossfile | all | Certain once indexed |

Not targeted: "wetransfer alternative no size limit". Relayed transfers share a daily and monthly allowance, so the claim isn't true for every transfer (see decisions.tsv, 2026-10-30).

## Launch drafts (owner posts; nothing has been submitted)

Space them out over two or three weeks. Answer every comment. Don't ask friends to upvote: HN and Reddit penalize it.

### Hacker News (Show HN)

Post Tuesday–Thursday, around 8–10am US Eastern. Link to `https://acrossfile.com`.

Title: `Show HN: Across – send a file browser to browser, end-to-end encrypted, no account`

Text:

> I wanted a way to send a file to someone without uploading it anywhere, making an account, or showing them my IP address. Across streams it over WebRTC straight from my browser to theirs.
>
> A few details people here may like:
> - The secret lives after the # in the link, so the server never sees it, only a hash used as a room name. Before any data moves, both browsers prove they know it with an HMAC bound to the DTLS certificates of their own connection, so a server relaying two separate connections can't pass.
> - There's also a six-letter code for typing on a second device. Only two letters reach the server; the other four are checked with CPace, so a dishonest server gets one guess per try.
> - "Hide my IP address" is on by default: the browser only offers Cloudflare TURN relay candidates, and the page refuses to post a handshake containing anything else. On the same Wi-Fi it also tries a server-free local link using mDNS .local names.
> - Compressible blocks are deflated on the fly, which helps a lot when the sender's upload is the bottleneck.
> - The whole app is one HTML file with a hash-only CSP. You can check the live site runs it: `curl -s https://acrossfile.com/ | shasum -a 256`.
>
> Limits: both people need to be online, one file at a time, and relayed transfers share a daily allowance. Source (MIT): https://github.com/cameronspears/across. Happy to answer anything about the protocol.

### Product Hunt

Needs a maker account and a few days of warm-up activity first. Launch 12:01am Pacific, Tuesday–Thursday.

- Name: Across
- Tagline (60 max): `Send any file browser to browser. Encrypted, no account.`
- Topics: Privacy, Productivity, Open Source, Developer Tools
- Gallery: `og.png`, plus screenshots of send, code entry and receive on a phone.
- Description: `Across sends a file straight from your browser to theirs over an encrypted peer-to-peer connection. Nothing is uploaded or stored, there's no account, and by default the other person never sees your IP address. Works between iPhone, Android, Windows, Mac and Linux with a link, a QR code or a six-letter code. Free and open source.`
- First comment: why you built it, the honest limits (both online, one file, relay allowance), and a link to `/how`.

### AlternativeTo

Add Across as a new app (free, open source, web), then suggest it as an alternative to: WeTransfer, Snapdrop, PairDrop, ShareDrop, AirDrop, Wormhole, Send Anywhere, Firefox Send. Tags: file-sharing, peer-to-peer, end-to-end-encryption, no-registration-required, privacy, webrtc.

Description: `Free, open-source web app that sends a file directly from one browser to another over encrypted WebRTC. No upload, no account, nothing stored on a server, and your IP address is hidden from the other person by default.`

### Reddit

Read each subreddit's self-promotion rules first. Post as yourself ("I made this"), not as an ad.

- r/InternetIsBeautiful: title `Across: send a file straight from your browser to someone else's, no account, nothing uploaded`
- r/SideProject and r/opensource: `I built an open-source, end-to-end encrypted way to send files browser to browser`, with the Show HN text, shortened.
- r/webdev: only in the Showoff Saturday thread.
- r/privacy: comment where someone asks for a WeTransfer alternative, rather than posting. Lead with what the server can't see and link `/how`.
- r/software and r/techsupport: answer existing "how do I send a big file / iPhone to PC" questions with the relevant guide, once, where it actually fits.

### "Awesome" lists and directories

Open a pull request that adds one line in the list's own format:

- `Lissy93/awesome-privacy` (File Sharing section)
- `pluja/awesome-privacy` (File Sharing section)
- `openrtc-io/awesome-webrtc` (Applications)
- Privacy Guides forum: post in its tool-suggestion category; their criteria are strict, so expect questions.

Not a fit: `awesome-selfhosted`, since Across needs Vercel, Upstash and Cloudflare to run.

## What was changed on the site

See decisions.tsv (2026-11-02). In short: four guide pages, a fuller sitemap, a keyword-first home title, FAQ links in every footer, and richer structured data. FAQPage markup no longer gets rich results in Google for most sites (since 2023), but it still helps Bing and AI answers read the page.
