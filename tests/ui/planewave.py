#!/usr/bin/env python3
"""Drive the plane-wave demo; check that packets move at the group velocity."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

with Browser('planewave/index.html', size=(1300, 950)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(0.8)
    b.screenshot('build/pw-start.png')
    # Drag the arrow tip to a new k.
    k_before = b.eval('__app.state.k1')
    b.drag('#wave', (0.5 + 1.2 / 3.2 / 2, 0.5 - 0.5 / 3.2 / 2), (0.5, 0.2), steps=8)
    k_after = b.eval('__app.state.k1')
    check(abs(k_after[0]) < 0.1 and k_after[1] > 1.5, f'dragging the arrow sets k ({k_before} -> {[round(v, 2) for v in k_after]})')
    for name in b.eval('Object.keys(__app.setups)'):
        b.eval(f'__app.setups[{json.dumps(name)}]()'); b.sleep(1.2)
        b.screenshot(f'build/pw-exp-{name}.png')
        if b.eval('__app.state.mode') == 'packet':
            v = b.eval('__app.velocities()')
            x1, x2 = b.eval('__app.centroid(5)'), b.eval('__app.centroid(15)')
            check(abs((x2 - x1) / 10 - v['vg']) < 0.01 * abs(v['vg']) + 1e-3, f"{name}: the packet moves at dω/dk = {v['vg']:.4f} (measured {(x2 - x1) / 10:.4f}); crests at ω/k = {v['vp']:.4f}")
    # A wide spread of wavenumbers, including negative ones: still moves at d omega/dk.
    b.eval("__app.setups.schrodinger()"); b.sleep(0.2)
    b.eval("""(() => { const [k0, dk] = document.querySelectorAll('#packet-box input[type=number]');
        k0.value = 0.3; k0.dispatchEvent(new Event('change')); dk.value = 0.8; dk.dispatchEvent(new Event('change')); })()""")
    check(abs(b.eval('__app.state.k0') - 0.3) < 1e-9, 'typed k0 = 0.3')
    x1, x2 = b.eval('__app.centroid(5)'), b.eval('__app.centroid(15)')
    check(abs((x2 - x1) / 10) < 0.5, f'a packet with k < 0 components does not run away to the right (centroid speed {(x2 - x1) / 10:.3f})')
    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
