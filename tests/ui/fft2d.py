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
    im_max = b.eval("__app.sides.x.im.reduce((a, v) => Math.max(a, Math.abs(v)), 0)")
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
    im_max = b.eval("__app.sides.x.im.reduce((a, v) => Math.max(a, Math.abs(v)), 0)")
    check(im_max < 1e-6, f'undo restores the real image (max |Im f| = {im_max:.2e})')

    # 6. Every experiment sets up without errors, and gets a picture.
    for name in b.eval("Object.keys(__app.setups)"):
        b.eval(f"__app.setups[{json.dumps(name)}]()"); b.sleep(0.5)
        b.screenshot(f'build/fft2d-exp-{name}.png')
        if name == 'comb':
            check(b.eval("Math.max(...__app.sides.x.re)") > 0, 'the comb experiment starts with a mark painted')
    # Review fixes.
    # Mirror painting with an even hard brush at 128 and 512 keeps the image real.
    for n in (128, 512):
        b.eval(f"__app.setResolution({n})"); b.sleep(0.4)
        b.eval("__app.setups.jacket()"); b.sleep(0.6)
        b.drag(K, (0.62, 0.30), (0.75, 0.45), steps=15); b.sleep(0.3)
        b.drag(K, (0.49, 0.47), (0.53, 0.52), steps=6); b.sleep(0.3)   # across the origin
        im_max = b.eval("__app.sides.x.im.reduce((a, v) => Math.max(a, Math.abs(v)), 0)")
        check(im_max < 1e-9, f'n={n}: mirror erasing with brush size {b.eval("__app.state.brush.size")} keeps the image real ({im_max:.1e})')
    b.eval("__app.setResolution(256)"); b.sleep(0.4)
    # Changing tool by key in the middle of a drag.
    b.eval("__app.setups.hermitian()"); b.sleep(0.5)
    x0, y0 = b.point(K, (0.6, 0.4)); x1, y1 = b.point(K, (0.7, 0.45))
    b.mouse('mouseMoved', x0, y0); b.mouse('mousePressed', x0, y0, 1, 'left')
    b.mouse('mouseMoved', (x0 + x1) / 2, (y0 + y1) / 2, 1, 'left')
    b.key('m'); b.key('h')
    b.mouse('mouseMoved', x1, y1, 1, 'left'); b.mouse('mouseReleased', x1, y1, 0, 'left'); b.sleep(0.3)
    finite = b.eval("__app.sides.x.re.every(Number.isFinite) && __app.sides.k.re.some((v) => v !== 0)")
    check(finite, 'switching tools by key mid-drag leaves the data sound')
    # Keep only the phase keeps the total power.
    b.eval("__app.setups.lowpass()"); b.sleep(0.5)
    b.drag(K, (0.5, 0.5), (0.6, 0.5), steps=6); b.sleep(0.3)
    P0 = b.eval("__app.sides.k.re.reduce((a, v, i) => a + v * v + __app.sides.k.im[i] ** 2, 0)")
    b.eval("__app.runOperation(__app.sides.k, 'phase')"); b.sleep(0.2)
    P1 = b.eval("__app.sides.k.re.reduce((a, v, i) => a + v * v + __app.sides.k.im[i] ** 2, 0)")
    check(abs(P1 / P0 - 1) < 1e-9, f'keeping only the phase keeps the power ({P0:.4g} -> {P1:.4g})')
    # Undo restores what the picture was made from.
    b.eval("__app.loadPreset('portrait')"); b.sleep(0.4); b.eval("__app.loadPreset('gaussian')"); b.sleep(0.4)
    b.eval("__app.undo()"); b.sleep(0.3)
    check(b.eval("__app.state.preset") == 'portrait', f"undo restores the preset ({b.eval('__app.state.preset')})")
    # 7. Resolutions.
    for n in (64, 512, 256):
        b.eval(f"__app.setResolution({n})"); b.sleep(0.6)
        check(b.eval("__app.sides.k.re.length") == n * n, f'resolution {n}')
    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions or console errors' + ('' if not errors else ': ' + '; '.join(errors[:3])))

print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
