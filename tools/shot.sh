#!/bin/sh
# Screenshot a page with headless Chromium and print its console errors.
#   tools/shot.sh fft2d/index.html build/fft2d.png [1400x900] [extra chromium flags...]
cd "$(dirname "$0")/.."
PAGE=$1; OUT=$2; SIZE=${3:-1400x900}; shift 3 2>/dev/null
PORT=${PORT:-8750}
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 0.4
timeout 120 chromium-browser --headless --disable-gpu --hide-scrollbars \
  --window-size="$(echo "$SIZE" | tr x ,)" --virtual-time-budget="${BUDGET:-4000}" \
  --enable-logging=stderr --v=0 "$@" \
  --screenshot="$PWD/$OUT" "http://127.0.0.1:$PORT/$PAGE" 2>&1 \
  | grep -E 'CONSOLE|Uncaught|Error' | grep -v -E 'dbus|Fontconfig|gcm|GPU|viz|ALSA|sandbox' | head -20
ls -la "$OUT" 2>/dev/null | awk '{print $5, $9}'
