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

    # The origin is the centre pixel on both sides: every real image has F(-k) = F(k)*, and one
    # that a half turn leaves unchanged has a real transform, with a real positive DC at the centre.
    SYMMETRY = """(() => { const {k} = __app.sides, n = __app.state.n; let fm = 0, fi = 0, he = 0;
        for (let a = 0; a < n * n; a++) fm = Math.max(fm, Math.hypot(k.re[a], k.im[a]));
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * n + i, b = ((n - j) % n) * n + (n - i) % n;
          fi = Math.max(fi, Math.abs(k.im[a])); he = Math.max(he, Math.hypot(k.re[b] - k.re[a], k.im[b] + k.im[a])); }
        const c = (n / 2) * n + n / 2;
        return [fi / fm, he / fm, k.re[c] / fm, k.im[c] / fm]; })()"""
    for p, even in [('gaussian', True), ('box', True), ('disk', True), ('ring', True), ('double', True),
                    ('lattice', True), ('hexagonal', True), ('portrait', False), ('text', False), ('bricks', False)]:
        b.eval(f"__app.loadPreset('{p}')"); b.sleep(0.3)
        imag, herm, dc, dci = b.eval(SYMMETRY)
        check(herm < 1e-12 and dc > 0 and abs(dci) < 1e-12, f'{p}: F(-k) = F(k)* to {herm:.1e}, real positive DC at the centre')
        if even: check(imag < 1e-12, f'{p}: symmetric, so its transform is real (max |Im F| / max |F| = {imag:.1e})')

    # The paint can be typed in either form, and 0 is a button.
    def typed(field, v):
        b.eval(f"(() => {{ const e = document.getElementById('value-{field}'); e.focus(); e.value = '{v}'; e.dispatchEvent(new Event('input')); e.blur(); e.dispatchEvent(new Event('change')); }})()")
        return b.eval("[__app.state.value.mag, __app.state.value.phase, ...['re', 'im', 'mag', 'deg'].map((k) => +document.getElementById('value-' + k).value)]")
    typed('re', 0); mag, ph, re, im, m, deg = typed('im', -2)
    check(abs(mag - 2) < 1e-12 and abs(ph + 1.5707963) < 1e-6 and abs(m - 2) < 1e-9 and abs(deg + 90) < 1e-9, f'typing Re 0, Im -2 gives 2 at -90 degrees ({mag:.3g}, {deg:.3g})')
    typed('mag', 1); mag, ph, re, im, m, deg = typed('deg', 180)
    check(abs(re + 1) < 1e-9 and im == 0, f'typing |w| 1 at 180 degrees gives Re -1, Im 0 ({re}, {im})')
    b.eval("[...document.querySelectorAll('#quick-values button')].find((e) => e.textContent === '0').click()")
    check(b.eval("__app.state.value.mag") == 0, 'the 0 button paints zero')
    b.eval("[...document.querySelectorAll('#quick-values button')].find((e) => e.textContent === '1').click()")

    # The disk is round even at 128: its edge is anti-aliased, so its area is pi R^2 to a pixel or so.
    b.eval("__app.setResolution(128)"); b.sleep(0.4); b.eval("__app.loadPreset('disk')"); b.sleep(0.3)
    area = b.eval("__app.sides.x.re.reduce((a, v) => a + v, 0) / Math.max(...__app.sides.x.re)")
    R = 0.1 * 128
    check(abs(area - 3.14159265 * R * R) < 2, f'the disk at 128 has area pi R^2 ({area:.1f} vs {3.14159265 * R * R:.1f})')
    b.eval("__app.setResolution(256)"); b.sleep(0.4)

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
    # The values under the pointer keep still as it moves (coordinates of either sign, magnitudes
    # from tiny to large, any phase): every number in a slot of its own, the select beside them put.
    b.eval("__app.loadPreset('portrait')"); b.sleep(0.5)
    for sel, name in ((X, 'image'), (K, 'transform')):
        x, y, w, h = b.box(sel)
        side = sel.split()[0]
        def hover(fx, fy):
            b.mouse('mouseMoved', x + fx * w, y + fy * h)
            b.sleep(0.15)
        words = [', y', '|f|', '∠'] if name == 'image' else [', ky', '|F|', '∠', 'λ', ' px']
        hover(0.1, 0.1)
        at = [b.text_x(f'{side} .readout', words)]
        def step(p):
            hover(*p)
            at.append(b.text_x(f'{side} .readout', words))
        pts = [(0.9, 0.9), (0.56, 0.5), (0.52, 0.47), (0.03, 0.6), (0.7, 0.2), (0.45, 0.55), (0.98, 0.02)]
        moves, texts = b.steady(f'{side} .foot-row select, {side} .readout, {side} .readout .fixnum', [lambda p=p: step(p) for p in pts])
        b.mouse('mouseMoved', 2, 2)
        shifts = [max(abs(a[i][0] - at[0][i][0]) for a in at) if all(a[i] for a in at) else None for i in range(len(words))]
        check(not moves and len(texts) >= 5 and None not in shifts and max(shifts) <= 0.5,
              f'{name}: the values under the pointer keep still as it moves (words {words} shift by {shifts} px; {moves[:3] or "no box moved"})')
    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions or console errors' + ('' if not errors else ': ' + '; '.join(errors[:3])))

print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
