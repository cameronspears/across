#!/bin/sh
# sh test/matrix.sh <baseUrl> <file>: every hide combination, plus browsers without .local names.
T=$(cd "$(dirname "$0")" && pwd); B=$1; F=$2
run() { echo "== hide send=$1 recv=$2, expect $3, no .local names=$4"; node "$T/link.mjs" "$B" "$1" "$2" "$F" "$3" "$4" 2>&1 | tail -5; }
run 1 1 lan 0
run 1 0 lan 0
run 0 1 lan 0
run 0 0 any 0
run 1 1 main 1
run 0 1 main 1
