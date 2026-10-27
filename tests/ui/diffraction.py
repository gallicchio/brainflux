#!/usr/bin/env python3
"""Drive the diffraction demo: every experiment, painting, the far field."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

with Browser('diffraction/index.html', size=(1300, 1000)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1)
    b.screenshot('build/dif-start.png')
    before = b.eval('__app.ap.re.reduce((a, v) => a + v, 0)')
    b.drag('#aperture', (0.2, 0.2), (0.3, 0.3), steps=6); b.sleep(0.5)
    after = b.eval('__app.ap.re.reduce((a, v) => a + v, 0)')
    check(after > before, f'painting opens the aperture ({before:.0f} -> {after:.0f})')
    for name in b.eval('Object.keys(__app.setups)'):
        b.eval(f'__app.setups[{json.dumps(name)}]()'); b.sleep(1.2)
        b.screenshot(f'build/dif-exp-{name}.png')
    # The Arago spot: the centre of the disk's shadow is bright.
    b.eval("__app.setups.arago()"); b.sleep(0.5)
    # The disk's radius is 250 um: 160 um off centre is still in its shadow.
    c = b.eval("(() => { const f = __app.fields[0], N = 512, o = 256 * N + 256, I = (o) => f.re[o] ** 2 + f.im[o] ** 2; return [I(o), I(o + 20)]; })()")
    check(c[0] > 0.8 and c[0] > 3 * c[1], f'the Arago spot: as bright as the unobstructed light in the middle of the shadow ({c[0]:.3g}), dark around it (160 um off: {c[1]:.3g})')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
