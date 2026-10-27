#!/bin/sh
# Every test: the unit tests in headless Chromium (and Firefox, if installed), then a scripted
# run of every demo.  Prints one line per suite and exits non-zero if any failed.
cd "$(dirname "$0")/.."
status=0
run() {
  name=$1; shift
  if out=$("$@" 2>&1); then echo "pass  $name"; else echo "FAIL  $name"; echo "$out" | grep -E 'FAIL|Error|SUMMARY' | head -20; status=1; fi
}
run "unit tests (Chromium)" python3 tools/run_page.py tests/index.html
command -v firefox >/dev/null && run "unit tests (Firefox)" env BROWSER=firefox python3 tools/run_page.py tests/index.html
for t in tests/ui/*.py; do run "$t" python3 "$t"; done
exit $status
