#!/bin/bash
# Idempotent: installs Chrome stable with its Linux deps and puppeteer-core, and mints one TURN credential.
set -euo pipefail
cd /vercel/sandbox
if [ ! -s chrome-path.txt ]; then
  apt-get update -qq >/dev/null
  npm init -y >/dev/null
  npm i --no-audit --no-fund --silent puppeteer-core@24 @puppeteer/browsers@2
  npx @puppeteer/browsers install chrome@stable --install-deps --path /vercel/sandbox/browsers > install.log 2>&1 || { tail -30 install.log; exit 1; }
  awk '{print $2}' install.log | grep '/chrome$' | tail -1 > chrome-path.txt
  chown -R "$(stat -c %U /vercel/sandbox)" /vercel/sandbox || true
fi
# the credential lasts 8 hours; mint again after 7
if [ ! -s ice.json ] || [ $(( $(date +%s) - $(stat -c %Y ice.json) )) -gt 25200 ]; then
  curl -fsS https://file-transfer-tan-alpha.vercel.app/api/ice -o ice.json.new && mv ice.json.new ice.json
  date -u +%FT%TZ >> mints.log
fi
echo "chrome $(cat chrome-path.txt)"
echo "mints $(wc -l < mints.log)"
node -e 'const j=require("./ice.json");console.log("urls", j.iceServers.flatMap(s=>[s.urls].flat()).join(" "))'
nproc; free -m | sed -n 2p
