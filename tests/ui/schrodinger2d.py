#!/usr/bin/env python3
"""Drive the 2D scattering demo: run collisions to the end and check the scattering theory."""
import json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

with Browser('schrodinger2d/index.html', size=(1500, 1000)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1)
    b.screenshot('build/s2d-start.png')
    # Run the default (hard disk) to the end, as fast as possible.
    b.eval("__app.state.speed = 1000")
    t0 = time.time()
    while not b.eval('__app.finished') and time.time() - t0 < 120: b.sleep(1)
    b.sleep(0.5)
    t = b.eval('__app.sim.t')
    print(f'note  the hard-disk collision took {time.time() - t0:.1f} s of wall time to t = {t:.1f}')
    tot = b.eval('__app.detector.totals()'); pw = b.eval('__app.pw && {sigma: __app.pw.sigma, optical: __app.pw.optical}')
    check(pw and abs(pw['optical'] / pw['sigma'] - 1) < 0.03, f"optical theorem: {pw and pw['optical']:.4f} vs partial waves {pw and pw['sigma']:.4f}")
    check(abs(tot['shadow'] / tot['scattered'] - 1) < 0.02, f"shadow {tot['shadow']:.4f} = scattered {tot['scattered']:.4f}")
    check(abs(tot['scattered'] / pw['sigma'] - 1) < 0.06, f"flux {tot['scattered']:.4f} vs partial waves {pw['sigma']:.4f}")
    b.screenshot('build/s2d-disk-done.png')
    # A slow packet (the s-wave experiment) in its bigger box: four ways to the total cross section.
    b.eval("__app.setups.swave()"); b.eval("__app.state.speed = 1000")
    t0 = time.time()
    while not b.eval('__app.finished') and time.time() - t0 < 180: b.sleep(1)
    b.sleep(0.5)
    tot = b.eval('__app.detector.totals()'); pw = b.eval('({sigma: __app.pw.sigma, optical: __app.pw.optical})')
    exact = b.eval("(() => { const rows = [...document.querySelectorAll('#sigmas tr')].map(r => r.textContent); return rows.find(r => r.startsWith('exact')); })()")
    ev = float(exact.split(':')[-1].replace('the radial equation', '').strip()) if exact else None
    print(f"note  slow packet: flux {tot['scattered']:.4f}, partial waves {pw['sigma']:.4f}, optical {pw['optical']:.4f}, exact {ev}")
    check(abs(pw['optical'] / pw['sigma'] - 1) < 0.05 and abs(tot['scattered'] / pw['sigma'] - 1) < 0.1 and ev and abs(ev / pw['sigma'] - 1) < 0.05,
          'slow packet: flux, partial waves, optical theorem and the radial equation agree')
    for name in b.eval('Object.keys(__app.setups)'):
        b.eval(f'__app.setups[{json.dumps(name)}]()')
        b.eval("__app.state.speed = 1000")
        b.sleep(5)
        b.screenshot(f'build/s2d-exp-{name}.png')
        print(f"note  {name}: t = {b.eval('__app.sim.t'):.1f}")
    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
