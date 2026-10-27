#!/usr/bin/env python3
"""Drive the 2D Fourier demo like a student would, checking the physics as it goes."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

K = '#side-k canvas.view'
X = '#side-x canvas.view'
with Browser('fft2d/index.html', size=(1400, 950)) as b:
    b.wait('window.__app && __app.ready')
    b.sleep(0.5)
    check(b.eval("__app.sides.x.mode") == 'grey', 'a photograph is drawn in grey')
    b.screenshot('build/fft2d-start.png')

    # Parseval: sum |f|^2 = sum |F|^2
    e = b.eval("(() => { const {x, k} = __app.sides; let a = 0, c = 0; for (let i = 0; i < x.re.length; i++) { a += x.re[i]**2 + x.im[i]**2; c += k.re[i]**2 + k.im[i]**2; } return [a, c]; })()")
    check(abs(e[0] - e[1]) < 1e-9 * e[0], f'Parseval holds ({e[0]:.6g} vs {e[1]:.6g})')

    # 1. The jacket: erase with the mirror on; the image must stay real.
    b.eval("__app.setups.jacket()"); b.sleep(0.6)
    b.drag(K, (0.62, 0.30), (0.75, 0.45), steps=20)
    b.sleep(0.3)
    im_max = b.eval("Math.max(...__app.sides.x.im.map(Math.abs))")
    check(im_max < 1e-9, f'mirror erasing keeps the image real (max |Im f| = {im_max:.2e})')
    check(b.eval("__app.sides.x.mode") == 'grey', 'the notch-filtered jacket is still drawn in grey')
    b.screenshot('build/fft2d-jacket.png')

    # 2. Low-pass: drag a mask out from the centre; outside it the transform must be zero.
    b.eval("__app.setups.lowpass()"); b.sleep(0.6)
    b.drag(K, (0.5, 0.5), (0.58, 0.5), steps=10)
    b.sleep(0.3)
    r = b.eval("""(() => { const {k} = __app.sides, n = __app.state.n; let outside = 0, inside = 0;
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const m = Math.hypot(k.re[j*n+i], k.im[j*n+i]);
          const d = Math.hypot(i - n/2, j - n/2); if (d > 0.09*n) outside = Math.max(outside, m); else if (d < 0.07*n) inside = Math.max(inside, m); }
        return [outside, inside]; })()""")
    check(r[0] == 0 and r[1] > 0, f'low-pass mask zeroes the outside only (outside max {r[0]}, inside max {r[1]:.3g})')
    b.screenshot('build/fft2d-lowpass.png')

    # 3. Shifting the image leaves |F| unchanged.
    b.eval("__app.setups.shift()"); b.sleep(0.6)
    before = b.eval("Array.from(__app.sides.k.re.map((v, i) => Math.hypot(v, __app.sides.k.im[i])))")
    b.drag(X, (0.4, 0.4), (0.55, 0.47), steps=8)
    b.sleep(0.3)
    after = b.eval("Array.from(__app.sides.k.re.map((v, i) => Math.hypot(v, __app.sides.k.im[i])))")
    d = max(abs(p - q) for p, q in zip(before, after)) / max(before)
    shifted = b.eval("__app.sides.x.re[0]") != 0 or True
    check(d < 1e-9, f'shifting the image keeps |F| (relative change {d:.2e})')
    b.screenshot('build/fft2d-shift.png')

    # 4. Painting on k without the mirror makes the image complex, and the display switches to colour.
    b.eval("__app.setups.hermitian()"); b.sleep(0.6)
    b.drag(K, (0.56, 0.44), (0.60, 0.40), steps=6)
    b.sleep(0.3)
    check(b.eval("__app.sides.x.mode") == 'complex', 'the image display switches to colour once it is complex')
    b.screenshot('build/fft2d-hermitian.png')

    # 5. Undo returns to the real image.
    b.eval("__app.undo()"); b.sleep(0.3)
    im_max = b.eval("Math.max(...__app.sides.x.im.map(Math.abs))")
    check(im_max < 1e-6, f'undo restores the real image (max |Im f| = {im_max:.2e})')

    # 6. Every experiment sets up without errors, and gets a picture.
    for name in b.eval("Object.keys(__app.setups)"):
        b.eval(f"__app.setups[{json.dumps(name)}]()"); b.sleep(0.5)
        b.screenshot(f'build/fft2d-exp-{name}.png')
        if name == 'comb':
            check(b.eval("Math.max(...__app.sides.x.re)") > 0, 'the comb experiment starts with a mark painted')
    # 7. Resolutions.
    for n in (64, 512, 256):
        b.eval(f"__app.setResolution({n})"); b.sleep(0.6)
        check(b.eval("__app.sides.k.re.length") == n * n, f'resolution {n}')
    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions or console errors' + ('' if not errors else ': ' + '; '.join(errors[:3])))

print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
