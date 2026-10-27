#!/usr/bin/env python3
"""Drive the Fourier series demo: presets, drawing, the series against the known coefficients."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

with Browser('fourier/index.html', size=(1300, 900)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(0.5)
    b.screenshot('build/fs-start.png')
    # The analysis inverts the synthesis: the square wave's samples give back b_n = 4/(pi n).
    err = b.eval("""(() => { const s = __app.state, keepA = s.a.slice(), keepB = s.b.slice();
        __app.analyse(__app.waveform(48)); let e = 0; for (let n = 1; n <= 48; n++) e = Math.max(e, Math.abs(s.a[n] - keepA[n]), Math.abs(s.b[n] - keepB[n])); return e; })()""")
    check(err < 1e-12, f'analysing the synthesised wave gives back its coefficients ({err:.1e})')
    # Gibbs: with many terms the square wave overshoots by about 9% of the jump (jump 2: peak 1.179).
    b.eval("__app.state.terms = 47")
    peak = b.eval("Math.max(...__app.waveform())")
    check(abs(peak - 1.179) < 0.01, f'the Gibbs overshoot of the square wave (peak {peak:.4f}, theory 1.1790)')
    # Draw on the wave.
    b.drag('#wave', (0.2, 0.3), (0.6, 0.7), steps=10); b.sleep(0.3)
    check(b.eval("__app.state.drawn !== null"), 'drawing on the wave replaces it')
    for name in b.eval('Object.keys(__app.setups)'):
        b.eval(f'__app.setups[{json.dumps(name)}]()'); b.sleep(0.4)
        b.screenshot(f'build/fs-exp-{name}.png')
    b.click('#play'); b.sleep(0.5)
    b.click('#scramble'); b.sleep(0.2)
    b.click('#play'); b.sleep(0.2)
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions (including starting and stopping the sound)' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
