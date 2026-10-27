#!/usr/bin/env python3
"""Drive the least-action demo: drag knots, roll downhill, every system and experiment."""
import json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

P = '#path'
with Browser('action/index.html', size=(1400, 950)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(0.5)
    b.screenshot('build/act-start.png')
    S0 = b.eval('__app.current.S'); h0 = b.eval('__app.history.length')
    # Drag the middle knot of the gravity path (5 knots: the middle is at s = 1, fraction 0.5).
    b.drag(P, (0.5, 0.3), (0.5, 0.25), steps=10)
    b.sleep(0.2)
    S1 = b.eval('__app.current.S'); h1 = b.eval('__app.history.length')
    check(S1 != S0 and h1 > h0 + 3, f'dragging a knot changes S ({S0:.3f} -> {S1:.3f}) and records it ({h0} -> {h1} points)')
    # Rolling downhill on gravity ends on the true path.
    b.eval("__app.setups.hints()"); b.sleep(0.3)
    b.eval("__app.setRolling(true)"); b.sleep(4)
    S = b.eval('__app.current.S'); St = b.eval('__app.truths[0].S')
    check(abs(S - St) < 0.02 * abs(St), f'rolling downhill finds the true path (S {S:.4f}, true {St:.4f})')
    b.screenshot('build/act-rolled.png')
    # At a saddle (oscillator, T = 4) rolling downhill goes below the true action.
    b.eval("__app.setups.saddle()"); b.sleep(0.3)
    b.eval("__app.setRolling(true)"); b.sleep(3)
    S = b.eval('__app.current.S'); St = b.eval('__app.truths[0].S'); idx = b.eval('__app.truths[0].index')
    check(idx == 1 and S < St, f'beyond half a period the true path is a saddle (index {idx}) and rolling goes below it ({S:.3f} < {St:.3f})')
    b.eval("__app.setRolling(false)")
    b.screenshot('build/act-saddle.png')
    for name in b.eval('Object.keys(__app.setups)'):
        b.eval(f'__app.setups[{json.dumps(name)}]()'); b.sleep(0.4)
        n = b.eval('__app.truths.length')
        b.screenshot(f'build/act-exp-{name}.png')
        check(n >= 1, f'{name}: {n} true path(s) found, S = {b.eval("__app.current && __app.current.S")}')
    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
