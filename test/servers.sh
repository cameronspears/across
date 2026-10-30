#!/bin/sh
# sh test/servers.sh: (re)starts the local relay and two dev servers.
#   3478 coturn    8090 relay on, memory store    8092 no relay, so hidden mode is local-only
#   3479 coturn capped at 1 MB/s per session, like a home upload    8093 relay on, through it
T=$(cd "$(dirname "$0")" && pwd); P=$(dirname "$T")
for port in 3478 3479 8090 8092 8093; do lsof -ti tcp:$port -sTCP:LISTEN | xargs kill 2>/dev/null; done
sleep 0.5
turnserver -c "$T/turnserver.conf" > "$T/coturn.log" 2>&1 &
turnserver -c "$T/turnserver-slow.conf" > "$T/coturn-slow.log" 2>&1 &
cd "$P"
SIGNAL_POSTS_PER_MIN=100000 SIGNAL_POLLS_PER_MIN=100000 CODE_CLAIMS_PER_MIN=100000 CODE_FINDS_PER_MIN=100000 RELAY=coturn TURN_SECRET=local-test-only TURN_URL='turn:127.0.0.1:3478?transport=udp' RELAY_MINTS_PER_HOUR=100000 PORT=8090 node dev.mjs > "$T/dev8090.log" 2>&1 &
SIGNAL_POSTS_PER_MIN=100000 SIGNAL_POLLS_PER_MIN=100000 CODE_CLAIMS_PER_MIN=100000 CODE_FINDS_PER_MIN=100000 PORT=8092 node dev.mjs > "$T/dev8092.log" 2>&1 &
SIGNAL_POSTS_PER_MIN=100000 SIGNAL_POLLS_PER_MIN=100000 CODE_CLAIMS_PER_MIN=100000 CODE_FINDS_PER_MIN=100000 RELAY=coturn TURN_SECRET=local-test-only TURN_URL='turn:127.0.0.1:3479?transport=udp' RELAY_MINTS_PER_HOUR=100000 PORT=8093 node dev.mjs > "$T/dev8093.log" 2>&1 &
sleep 1.5
for port in 3478 3479 8090 8092 8093; do lsof -ti tcp:$port -sTCP:LISTEN >/dev/null && echo "up $port" || echo "DOWN $port"; done
