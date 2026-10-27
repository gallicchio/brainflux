#!/usr/bin/env python3
"""Drive the Gaussian-beam demo: every experiment, dragging on the bench and the stability
diagram, the physics read-outs (focus size, mode matching, cavity mode, FFT check)."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

SIZE = tuple(int(v) for v in os.environ.get('SIZE', '1400x900').split('x'))
TAG = os.environ.get('TAG', '')

with Browser('beams/index.html', size=SIZE) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1)
    b.screenshot(f'build/beams{TAG}-start.png')
    for name in b.eval('Object.keys(__app.setups)'):
        b.eval(f'__app.setups[{json.dumps(name)}]()'); b.sleep(1.0)
        b.screenshot(f'build/beams{TAG}-exp-{name}.png')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
