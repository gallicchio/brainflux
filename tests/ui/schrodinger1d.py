#!/usr/bin/env python3
"""Drive the 1D Schrödinger demo: every potential, every experiment, the measurements."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

with Browser('schrodinger1d/index.html', size=(1400, 950)) as b:
    b.wait('window.__app && __app.ready')
    b.sleep(1.5)
    check(b.eval('__app.sim.t') > 0.5, f"it starts running (t = {b.eval('__app.sim.t'):.2f})")
    check(abs(b.eval('__app.sim.norm()') - 1) < 1e-9, 'the norm stays 1')
    b.screenshot('build/s1d-start.png')
    for name in b.eval('Object.keys(__app.setups)'):
        b.eval(f'__app.setups[{json.dumps(name)}]()')
        b.eval('__app.slow')
        b.sleep(2.0)
        slow, frames = b.eval('__app.slow')
        if slow: print(f'note  {name}: {slow} of {frames} frames could not keep up with the requested speed (dt {b.eval("__app.sim.h"):.5f})')
        b.screenshot(f'build/s1d-exp-{name}.png')
        n = b.eval('__app.sim.norm() + __app.sim.absorbed')
        check(abs(n - 1) < 1e-6 or name == 'measure', f'{name}: probability accounted for ({n:.9f}), t = {b.eval("__app.sim.t"):.2f}')
    # Measurements on the box ground state packet.
    b.eval("__app.setups.measure()"); b.sleep(0.3)
    b.click('#measure-e'); b.sleep(0.3)
    e1 = b.eval('__app.sim.observables().E')
    b.click('#measure-e'); b.sleep(0.3)
    e2 = b.eval('__app.sim.observables().E')
    check(abs(e1 - e2) < 1e-6, f'measuring the energy twice gives the same answer ({e1:.5f}, {e2:.5f})')
    b.click('#measure-x'); b.sleep(0.3)
    check(b.eval('__app.sim.observables().sx') < 0.2, 'measuring the position localises the particle')
    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
