#!/usr/bin/env python3
"""Drive the holography demo: every experiment, dragging, the tools, and the physics read-outs."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

with Browser('holography/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1)
    b.screenshot('build/holo-start.png')
    for name in b.eval('Object.keys(__app.setups)'):
        b.eval(f'__app.setups[{json.dumps(name)}]()'); b.sleep(1.2)
        b.screenshot(f'build/holo-exp-{name}.png')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
