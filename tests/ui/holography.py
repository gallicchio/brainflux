#!/usr/bin/env python3
"""Drive the holography demo: dragging, the tools, every experiment, and the physics read-outs."""
import json, math, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

LAM, P, N = 0.633, 5, 256
DU = LAM / (N * P)                       # one display pixel of the view, radians
H = N // 2

# JavaScript helpers, defined once in the page.
HELPERS = """
window.T = {
  // the brightest pixel of the view within r pixels of (i, j), and the centroid round it
  spot(i, j, r = 3) {
    const I = __app.W.view, n = 256; let best = -1, bi = i, bj = j;
    for (let b = Math.round(j) - r; b <= Math.round(j) + r; b++) for (let a = Math.round(i) - r; a <= Math.round(i) + r; a++) if (I[b * n + a] > best) { best = I[b * n + a]; bi = a; bj = b; }
    let s = 0, si = 0, sj = 0;
    for (let b = bj - 2; b <= bj + 2; b++) for (let a = bi - 2; a <= bi + 2; a++) { const v = I[b * n + a]; s += v; si += v * a; sj += v * b; }
    return [si / s, sj / s, best];
  },
  // correlation of the view with a brightness map over a box [i0, j0, i1, j1], after averaging
  // over (2w+1)^2 pixels (to smooth speckle)
  corr(B, box, w = 0) {
    const I = __app.W.view, n = 256, [i0, j0, i1, j1] = box;
    const sm = (A, i, j) => { let s = 0; for (let b = -w; b <= w; b++) for (let a = -w; a <= w; a++) s += A[(j + b) * n + i + a]; return s; };
    const xs = [], ys = [];
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { xs.push(sm(I, i, j)); ys.push(B[j * n + i]); }
    const m = (a) => a.reduce((p, q) => p + q, 0) / a.length, mx = m(xs), my = m(ys);
    let xy = 0, xx = 0, yy = 0;
    for (let k = 0; k < xs.length; k++) { xy += (xs[k] - mx) * (ys[k] - my); xx += (xs[k] - mx) ** 2; yy += (ys[k] - my) ** 2; }
    return xy / Math.sqrt(xx * yy);
  },
  centroid(box) {
    const I = __app.W.view, n = 256, [i0, j0, i1, j1] = box; let s = 0, si = 0, sj = 0;
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { const v = I[j * n + i]; s += v; si += v * i; sj += v * j; }
    return [si / s, sj / s];
  },
  slider(label, value, within = '') {
    const box = [...document.querySelectorAll(`${within} .slider`)].filter((s) => s.offsetParent !== null).find((s) => s.querySelector('label').textContent === label).querySelector('input[type=number]');
    box.value = value; box.dispatchEvent(new Event('change'));
  },
  button(text) { [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null).find((b) => b.textContent === text).click(); },
};
true
"""

with Browser('holography/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1)
    b.eval(HELPERS)
    b.screenshot('build/holo-start.png')
    check(b.eval('__app.state.sweepFocus'), 'the opening view sweeps the focus')
    b.eval('__app.apply({})'); b.sleep(0.3)
    check('Three separate islands' in b.eval('__app.verdict()'), f"the opening view is off axis and clean: {b.eval('__app.verdict()')!r}")

    # Every experiment in the drawer has a set-up, and the other way round.
    arts = b.eval("[...document.querySelectorAll('#help .exp')].map((a) => a.dataset.setup)")
    keys = b.eval('Object.keys(__app.setups)')
    check(sorted(arts) == sorted(keys) and len(arts) >= 8, f'{len(arts)} experiments, each with its set-up')

    # Dragging a point in the side view changes its depth and height, and the hologram.
    fx, fy = b.eval('__app.sidePoint(1)')
    before = b.eval('[__app.state.points[1].z, __app.state.points[1].y, __app.W.H.reduce((a, v, o) => a + v * (o % 97), 0)]')
    b.drag('#side', (fx, fy), (fx + 0.08, fy - 0.12), steps=8); b.sleep(0.4)
    after = b.eval('[__app.state.points[1].z, __app.state.points[1].y, __app.W.H.reduce((a, v, o) => a + v * (o % 97), 0)]')
    check(after[0] < before[0] and after[1] > before[1] and abs(after[2] - before[2]) > 1e-6 * abs(before[2]),
          f'dragging point 2 in the side view: depth {before[0]/1000:.1f} -> {after[0]/1000:.1f} mm, height {before[1]:.0f} -> {after[1]:.0f} um, and the hologram changes')
    fx, fy = b.eval('__app.frontPoint(0)')
    x0 = b.eval('__app.state.points[0].x')
    b.drag('#front', (fx, fy), (fx + 0.1, fy), steps=6); b.sleep(0.4)
    x1 = b.eval('__app.state.points[0].x')
    check(x1 > x0 + 50, f'dragging point 1 in the front view moves it sideways ({x0:.0f} -> {x1:.0f} um)')

    # Speed: a point moved and everything recomputed and redrawn, twenty times.
    ms = b.eval('(() => { const t = []; for (let k = 0; k < 20; k++) { __app.state.points[0].x += 7; t.push(__app.redraw()); } t.sort((a, b) => a - b); return t[10]; })()')
    msf = b.eval('(() => { const t = []; for (let k = 0; k < 20; k++) { __app.state.focus += 300; t.push(__app.redraw()); } t.sort((a, b) => a - b); return t[10]; })()')
    print(f'      (median {ms:.1f} ms per frame while dragging a point, {msf:.1f} ms while focusing)')
    check(ms < 60 and msf < 40, f'fast enough to drag: {1000/ms:.0f} frames/s for a point, {1000/msf:.0f} for the focus')

    # The view is unitary: all the light leaving the plate, somewhere.
    e = b.eval("""(() => { const { H, C, L, view } = __app.W; let a = 0, s = 0;
        for (let o = 0; o < H.length; o++) a += H[o] * H[o] * (C.re[o] ** 2 + C.im[o] ** 2) * (L.re[o] ** 2 + L.im[o] ** 2);
        for (let o = 0; o < view.length; o++) s += view[o]; return [a, s]; })()""")
    check(abs(e[1] / e[0] - 1) < 1e-6, f'the view holds all the light leaving the plate ({e[0]:.6g} vs {e[1]:.6g})')

    # 'Focus on the image' finds the selected point, and the point is drawn at x/z, y/z.
    b.eval('__app.apply({}); __app.state.sel = 1'); b.sleep(0.3)
    b.eval("T.button('Focus on the image')"); b.sleep(0.4); b.eval('__app.redraw()')
    pt = b.eval('__app.state.points[1]')
    check(abs(b.eval('__app.state.focus') - pt['z']) < 1, f"'Focus on the image' focuses at the point's depth ({b.eval('__app.state.focus')/1000:.2f} mm)")
    wi, wj = H + pt['x'] / pt['z'] / DU, H - pt['y'] / pt['z'] / DU
    ci, cj, _ = b.eval(f'T.spot({wi}, {wj})')
    check(math.hypot(ci - wi, cj - wj) < 0.5, f'the point is drawn at its direction: ({ci:.2f}, {cj:.2f}), expected ({wi:.2f}, {wj:.2f})')

    # The window tool moves the window; the eraser covers the plate; a piece is kept.
    b.drag('#holo', (0.5, 0.5), (0.3, 0.6), steps=6); b.sleep(0.3)
    w = b.eval('[__app.state.window, __app.state.win.x, __app.state.win.y]')
    check(w[0] and abs(w[1] + 128) < 6 and abs(w[2] + 64) < 6, f'dragging on the hologram moves the window to ({w[1]:.0f}, {w[2]:.0f}) um')
    b.eval("T.button('Erase')")
    b.drag('#holo', (0.2, 0.2), (0.8, 0.3), steps=10); b.sleep(0.3)
    covered = b.eval('__app.W.mask.reduce((a, v) => a + (v === 0), 0)')
    check(covered > 1000, f'the eraser covers part of the plate ({covered} pixels)')
    b.eval("T.button('Uncover all')"); b.eval("T.button('Keep a piece')")
    b.drag('#holo', (0.5, 0.5), (0.6, 0.6), steps=6); b.sleep(0.3)
    kept = b.eval('__app.W.mask.reduce((a, v) => a + v, 0)')
    check(abs(math.sqrt(kept) - (2 * 13 + 1)) < 2.5, f'keeping a piece: a square of {math.sqrt(kept):.1f} pixels remains')
    check(b.eval('location.hash').find('cut=piece') > 0 or b.sleep(0.5) or b.eval('location.hash').find('cut=piece') > 0, 'the piece is kept in the URL')

    # 1. The zone plate: rings at sqrt(n lambda z).
    b.eval('__app.setups.zone()'); b.sleep(0.5)
    rings = b.eval("""(() => { const H = __app.W.H, n = 256, row = H.subarray(128 * n, 129 * n), r = [];
        for (let i = 129; i < n - 1; i++) { const [l, c, q] = [row[i - 1], row[i], row[i + 1]];
          if ((c > l && c >= q) || (c < l && c <= q)) r.push(((i - 128) + 0.5 * (l - q) / (l - 2 * c + q)) * 5); }
        return r; })()""")
    worst = max(abs(r - math.sqrt((k + 1) * LAM * 30000)) for k, r in enumerate(rings))
    check(len(rings) == 21 and worst < 0.5, f'zone plate: {len(rings)} rings out to the edge, at sqrt(n lambda z) to {worst:.2f} um')
    v = b.eval('__app.redraw(); T.spot(128, 128, 2)')
    b.eval("T.button('on the twin')"); b.sleep(0.4); b.eval('__app.redraw()')
    check(abs(b.eval('__app.state.focus') + 30000) < 1, f"'on the twin' focuses on the real image, 30 mm in front ({b.eval('__app.state.focus')/1000:.1f} mm)")
    r = b.eval('T.spot(128, 128, 2)')
    check(abs(r[0] - 128) < 0.3 and abs(r[1] - 128) < 0.3 and r[2] > 0.5 * v[2], f'the real image is as sharp as the virtual one (peaks {r[2]:.4g}, {v[2]:.4g})')

    # The off-axis sideband sits at sin(theta)/lambda.
    b.eval('__app.apply({ points: [{ x: 0, y: 0, z: 80000, b: 1 }], sel: 0, theta: 2 * Math.PI / 180 })'); b.sleep(0.3); b.eval('__app.redraw()')
    row = b.eval("""(() => { const { re, im } = __app.W.S, n = 256; let w = 0, wj = 0;
        for (let j = 160; j < n; j++) for (let i = 0; i < n; i++) { const v = re[j * n + i] ** 2 + im[j * n + i] ** 2; w += v; wj += v * j; } return wj / w; })()""")
    want = H + math.sin(2 * math.pi / 180) / LAM * N * P
    check(abs(row - want) < 0.3, f'the image island is centred {row - H:.2f} bins below the middle; sin(theta)/lambda = {want - H:.2f} bins')

    # 3. Tilting the reference: twin, haze, clean, aliased, at the angles the help gives.
    b.eval('__app.setups.offaxis()'); b.sleep(0.4)
    seen = {}
    for deg in (0.5, 0.75, 0.85, 1.7, 1.8, 2.8, 2.9):
        b.eval(f"T.slider('angle (°)', {deg})"); b.eval('__app.redraw()')
        seen[deg] = b.eval('__app.verdict()')
    kinds = {d: ('twin' if 'twin islands overlap' in t else 'haze' if 'middle one' in t else 'clean' if 'Three separate' in t else 'alias' if 'past the edge' in t else '?') for d, t in seen.items()}
    check([kinds[d] for d in (0.5, 0.75, 0.85, 1.7, 1.8, 2.8, 2.9)] == ['twin', 'twin', 'haze', 'haze', 'clean', 'clean', 'alias'],
          f'tilting the reference: {kinds} (help: twin clear at 0.8, haze clear at 1.75, aliasing above 2.85 degrees)')
    # ... and the F comes out clean: the view correlates with the picture.
    b.eval("T.slider('angle (°)', 2.2)"); b.eval('__app.redraw()')
    c = b.eval('T.corr(__app.W.picB, [93, 93, 163, 163])')
    b.eval("T.slider('angle (°)', 0)"); b.eval('__app.redraw()')
    c0 = b.eval('T.corr(__app.W.picB, [93, 93, 163, 163])')
    check(c > 0.9 and c0 < 0.5, f'the F through the plate: correlation {c:.3f} off axis, {c0:.3f} in line')

    # 5. Cutting the hologram: the whole F survives.
    b.eval('__app.setups.cut()'); b.sleep(0.4); b.eval('__app.redraw()')
    box = '[90, 90, 166, 166]'
    full = b.eval(f'T.corr(__app.W.picB, {box})')
    b.eval("T.button('Cover half')"); b.sleep(0.3); b.eval('__app.redraw()')
    half = b.eval(f'T.corr(__app.W.picB, {box}, 2)')
    b.eval('__app.uncover(); (() => { const m = __app.W.mask; for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) if (!(i >= 96 && i < 160 && j >= 96 && j < 160)) m[j * 256 + i] = 0; })(); __app.maskChanged()'); b.sleep(0.3); b.eval('__app.redraw()')
    piece = b.eval(f'T.corr(__app.W.picB, {box}, 3)')
    b.screenshot('build/holo-cut-piece.png')
    check(full > 0.95 and half > 0.7 and piece > 0.5, f'the F from the whole plate {full:.3f}, from half {half:.3f}, from a sixteenth {piece:.3f} (correlation, speckle averaged)')

    # 6. Parallax: the near and far points move opposite ways as the window moves.
    b.eval('__app.setups.parallax()'); b.sleep(0.4)
    def spots(yw):
        b.eval(f"T.slider('y (mm)', {yw}, '#tool-options')"); b.eval('__app.redraw()')
        check(not b.eval('__app.state.sweepWindow'), 'moving the window by hand stops the sweep') if yw < 0 else None
        out = []
        for z in (40000, 60000, 100000):
            v = yw * 1000 / 60000 - yw * 1000 / z
            out.append(H - b.eval(f'T.spot(128, {H - v / DU}, 2)')[1])
        return out
    left, right = spots(-0.45), spots(0.45)
    moves = [r - l for l, r in zip(left, right)]
    pred = [900 * (1 / 60000 - 1 / z) / DU for z in (40000, 60000, 100000)]
    check(all(abs(m - p) < 1.5 for m, p in zip(moves, pred)), f'parallax: moving the window 0.9 mm up moves the points {moves[0]:.1f}, {moves[1]:.1f}, {moves[2]:.1f} pixels (predicted {pred[0]:.1f}, {pred[1]:.1f}, {pred[2]:.1f})')

    # 8. Another colour: the image moves to z lambda/lambda2, shrinks and moves down.
    b.eval('__app.setups.wavelength()'); b.sleep(0.4)
    b.eval("T.button('Focus on the image')"); b.sleep(0.3); b.eval('__app.redraw()')
    f = b.eval('__app.state.focus')
    check(abs(f - 150000 * 633 / 532) < 10, f'relit in green, the image is at {f/1000:.1f} mm (150 x 633/532 = {150*633/532:.1f})')
    box = '[96, 96, 160, 168]'
    c532 = b.eval(f'T.centroid({box})')
    b.eval("T.slider('λ (nm)', 633)"); b.eval("T.button('Focus on the image')"); b.eval('__app.redraw()')
    c633 = b.eval(f'T.centroid({box})')
    mu, s = 532 / 633, math.sin(2 * math.pi / 180)
    pred = [H + mu * (c633[0] - H), H + mu * (c633[1] - H) + (1 - mu) * s / DU]
    check(math.hypot(c532[0] - pred[0], c532[1] - pred[1]) < 1.5,
          f'in green the F is {mu:.2f} as big and lower: centre ({c532[0]-H:.1f}, {H-c532[1]:.1f}) px, predicted ({pred[0]-H:.1f}, {H-pred[1]:.1f}); in red ({c633[0]-H:.1f}, {H-c633[1]:.1f})')

    # 9. The conjugate beam: a real image in front.
    b.eval('__app.setups.conjugate()'); b.sleep(0.4); b.eval('__app.redraw()')
    pt = b.eval('__app.state.points[0]')
    wi, wj = H + pt['x'] / pt['z'] / DU, H - pt['y'] / pt['z'] / DU
    ci, cj, _ = b.eval(f'T.spot({wi}, {wj})')
    check(b.eval('__app.state.focus') == -50000 and math.hypot(ci - wi, cj - wj) < 0.5, f'lit by the conjugate, the real image 50 mm in front is at ({ci:.2f}, {cj:.2f}), expected ({wi:.2f}, {wj:.2f})')

    # 10. Binary.
    b.eval('__app.setups.binary()'); b.sleep(0.4); b.eval('__app.redraw()')
    only01 = b.eval('__app.W.H.every((v) => v === 0 || v === 1)')
    cb = b.eval('T.corr(__app.W.picB, [93, 93, 163, 163])')
    check(only01 and cb > 0.8, f'the binary hologram is black and white, and its F correlates {cb:.3f} with the picture')
    b.eval("document.querySelector('#camera-panel').open = true"); b.sleep(0.2)
    b.eval("T.slider('bits', 4)"); b.eval('__app.redraw()')
    c4 = b.eval('T.corr(__app.W.picB, [93, 93, 163, 163])')
    check(c4 > 0.97, f'with 4 bits the F correlates {c4:.3f} (the help: all but perfect)')

    # 13. The steepest reference: fringes of two pixels, and the warning.
    b.eval('__app.setups.steep()'); b.sleep(0.4); b.eval('__app.redraw()')
    note = b.eval("document.querySelector('#ref-note').textContent")
    check('= 2 pixels' in note and 'past the edge' in b.eval('__app.verdict()'), f'the steepest reference: {note!r}; {b.eval("__app.verdict()")!r}')

    # The URL keeps the state.
    b.eval('__app.setups.fourier()'); b.sleep(0.4)
    b.eval("T.slider('depth (mm)', 140)"); b.sleep(0.6)
    hsh = b.eval('location.hash')
    want = b.eval('JSON.stringify([__app.state.object, __app.state.picture, __app.state.ref, __app.state.refSrc, __app.state.focus, __app.state.picZ])')
    b.goto('holography/index.html' + hsh); b.wait('window.__app && __app.ready'); b.sleep(0.6)
    got = b.eval('JSON.stringify([__app.state.object, __app.state.picture, __app.state.ref, __app.state.refSrc, __app.state.focus, __app.state.picZ])')
    check(got == want, f'the URL keeps the set-up ({hsh[:60]}...)')

    # Every experiment, with a picture.
    b.goto('holography/index.html'); b.wait('window.__app && __app.ready'); b.sleep(0.5)
    for name in keys:
        b.eval(f'__app.setups[{json.dumps(name)}]()'); b.sleep(1.0)
        b.screenshot(f'build/holo-exp-{name}.png')
    b.goto('holography/index.html#setup=portrait'); b.wait('window.__app && __app.ready'); b.sleep(1.2)
    check(b.eval('__app.state.picture') == 'fourier', '#setup=portrait opens the portrait')
    b.screenshot('build/holo-thumb-portrait.png')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

# Dark theme, and a phone.
with Browser('holography/index.html#setup=islands', size=(1400, 900)) as b:
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
    b.wait('window.__app && __app.ready'); b.sleep(1.2)
    b.screenshot('build/holo-dark.png')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'dark theme: no exceptions')
with Browser('holography/index.html', size=(400, 850)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1.0)
    wide = b.eval('document.documentElement.scrollWidth')
    check(wide <= 400, f'at phone width nothing sticks out sideways (page {wide} px wide)')
    b.screenshot('build/holo-phone.png')
    b.eval("document.querySelector('#pane-recon').scrollIntoView()"); b.sleep(0.5)
    b.screenshot('build/holo-phone-view.png')

print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
