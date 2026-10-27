#!/usr/bin/env python3
"""Drive the Maxwell 2D demo: every experiment, painting, dragging, and the physics read-outs."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

with Browser('maxwell2d/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(2)
    b.screenshot('build/mx-start.png')
    for name in b.eval('Object.keys(__app.setups)'):
        b.eval(f'__app.setups[{json.dumps(name)}]()'); b.sleep(0.3)
        b.eval('__app.run(14)'); b.sleep(0.5)
        b.screenshot(f'build/mx-exp-{name}.png')
        print(f"note  {name}: t = {b.eval('__app.sim.t'):.1f}, notes: {b.eval('document.querySelector(\"#notes\").textContent')[:200]}")
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
