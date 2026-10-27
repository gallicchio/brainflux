#!/usr/bin/env python3
"""Drive the imaging demo: every experiment, with the physics checked as it goes; painting; the
address; screenshots at desktop and phone sizes, light and dark."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

# Measurements made in the page.
ROW = "(() => { const a = __app, N = a.N, r = a.state.row; return Array.from(a.I.subarray(r * N, r * N + N)); })()"
# The correlation of the image with the object's phase, over the whole field.
CORR_PHASE = """(() => { const a = __app, I = a.I, t = a.t, n = I.length; let mi = 0, mp = 0;
  const p = new Float64Array(n); for (let o = 0; o < n; o++) { p[o] = Math.atan2(t.im[o], t.re[o]); mi += I[o] / n; mp += p[o] / n; }
  let sab = 0, saa = 0, sbb = 0; for (let o = 0; o < n; o++) { const x = I[o] - mi, y = p[o] - mp; sab += x * y; saa += x * x; sbb += y * y; }
  return sab / Math.sqrt(saa * sbb); })()"""
# The image near the thickest point of the object (a nucleus), averaged over 5 x 5 pixels.
AT_THICKEST = """(() => { const a = __app, N = a.N, t = a.t; let best = -1, at = 0;
  for (let o = 0; o < N * N; o++) { const p = Math.atan2(t.im[o], t.re[o]); if (p > best) { best = p; at = o; } }
  const i = at % N, j = (at - i) / N; let s = 0; for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) s += a.I[(j + b) * N + i + c];
  return s / 25; })()"""
# For the Siemens star: the correlation, round a circle of radius r (um), between the image and
# the object's transmission, for a list of radii.
STAR_CORR = """((radii) => { const a = __app, N = a.N, dx = a.DX, t = a.t; return radii.map((r) => {
  const M = 720, I = [], T = []; for (let k = 0; k < M; k++) { const th = 2 * Math.PI * k / M;
    const i = Math.round(N / 2 + r * Math.cos(th) / dx), j = Math.round(N / 2 - r * Math.sin(th) / dx), o = j * N + i;
    I.push(a.I[o]); T.push(t.re[o] ** 2 + t.im[o] ** 2); }
  const m = (v) => v.reduce((x, y) => x + y, 0) / v.length, mi = m(I), mt = m(T);
  let ab = 0, aa = 0, bb = 0; for (let k = 0; k < M; k++) { ab += (I[k] - mi) * (T[k] - mt); aa += (I[k] - mi) ** 2; bb += (T[k] - mt) ** 2; }
  return ab / Math.sqrt(aa * bb + 1e-30); }); })"""

def settle(b, s=0.4):
    b.sleep(s); b.wait('__app.partialDone', timeout=30); b.sleep(0.25)

def setup(b, name):
    b.eval(f'__app.setups[{json.dumps(name)}]()'); settle(b, 0.6)

def put(b, **values):
    b.eval(f'__app.set({json.dumps(values)})'); settle(b)

def full_page(b, path):
    h = b.eval('Math.ceil(document.documentElement.scrollHeight)')
    w = b.eval('document.documentElement.clientWidth')
    import base64
    data = b.call('Page.captureScreenshot', format='png', captureBeyondViewport=True, clip={'x': 0, 'y': 0, 'width': w, 'height': h, 'scale': 1})['data']
    full = os.path.join(os.path.dirname(__file__), '..', '..', path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'wb') as f: f.write(base64.b64decode(data))

with Browser('imaging/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready', timeout=30); settle(b)
    b.screenshot('build/imaging-start.png')
    st = b.eval('__app.stats()')
    check(st['contrast'] > 0.3, f"opens on cells in phase contrast (image contrast {st['contrast']:.2f})")

    # Speed: the work of one frame after a change of the pupil (dragging NA, painting the pupil)
    # and of the object (painting it).  The fastest of 9 measures the code; the median also
    # measures whatever else the computer is doing.
    for what, limit in [('pupil', 33), ('object', 40)]:
        runs = sorted(b.eval(f'__app.frameNow([{json.dumps(what)}]).total') for _ in range(9))
        check(runs[0] < limit, f'a change of the {what} is recomputed and drawn in {runs[0]:.1f} ms (median {runs[4]:.1f} ms)')

    for name in b.eval('Object.keys(__app.setups)'):
        setup(b, name)
        b.screenshot(f'build/imaging-exp-{name}.png')

    # 1. Abbe: nothing but the zero order, no image; the first orders make a sinusoid of period d.
    setup(b, 'abbe')
    check(b.eval('__app.orders()') == [0] and b.eval('__app.stats().contrast') < 1e-9,
          f"NA 0.35 < lambda/d = 0.43: only the zero order passes and the image is uniform (contrast {b.eval('__app.stats().contrast'):.1e})")
    put(b, NA=0.45)
    c, period = b.eval('__app.stats().contrast'), b.eval('__app.profilePeriod')
    check(b.eval('__app.orders()') == [-1, 0, 1] and c > 0.9 and abs(period - 1.28) < 1e-9,
          f'NA 0.45: orders -1, 0, +1 pass, contrast {c:.3f}, period {period} um')
    put(b, NA=1.3)
    check(b.eval('__app.orders()') == [-3, -1, 0, 1, 3], 'NA 1.3 > 3 lambda/d = 1.289: the third orders pass (no second orders for equal bars)')
    b.screenshot('build/imaging-abbe-1.3.png')

    # 2. Block the zero order: the period halves.
    setup(b, 'zero')
    period = b.eval('__app.profilePeriod')
    check(b.eval('__app.orders()') == [-1, 1] and abs(period - 0.64) < 1e-9, f'zero order blocked: the image repeats every {period} um = d/2')

    # 3. Oblique light: 0 and +1 make fringes of period d where axial light shows nothing.
    setup(b, 'oblique')
    c, period = b.eval('__app.stats().contrast'), b.eval('__app.profilePeriod')
    check(b.eval('__app.orders()') == [0, 1] and c > 0.5 and abs(period - 0.8) < 1e-9, f'tilted: orders 0 and +1, contrast {c:.2f}, period {period} um')
    put(b, tiltNA=0)
    check(b.eval('__app.stats().contrast') < 1e-9 and b.eval('__app.orders()') == [0], 'the same grating on axis: nothing')
    put(b, illum='condenser', condNA=0.4)
    c = b.eval('__app.stats().contrast')
    check(c > 0.05, f'a condenser as wide as the objective (NA 0.4) resolves it too, with less contrast ({c:.2f})')

    # 4. The diatom: its pore lattice's six first orders, at sin theta = lambda / 0.52 um = 1.06.
    setup(b, 'diatom')
    n0 = b.eval('__app.poreOrders()')
    put(b, NA=1.1)
    n1 = b.eval('__app.poreOrders()')
    put(b, NA=0.65, tiltNA=0.53, tiltDir=-65)
    n2 = b.eval('__app.poreOrders()')
    check((n0, n1, n2) == (0, 6, 1), f'diatom pore orders through the pupil: {n0} at NA 0.65, {n1} at NA 1.1, {n2} at NA 0.65 with tilted light')

    # A typed transmission: a phase disk, shown as its phase, made visible by the phase dot.
    b.eval("document.querySelector('#presets button:last-child').click()"); settle(b, 0.6)
    view, c = b.eval('__app.state.objView'), b.eval('__app.stats().contrast')
    check(b.eval('__app.state.preset') == 'formula' and view == 'phase' and c > 0.3, f'the typed phase disk exp(i a (r < R)) is drawn as a phase ({view}) and shows with the dot (contrast {c:.2f})')
    ok = []
    for k in range(b.eval("document.querySelectorAll('.examples button').length")):
        b.eval(f"document.querySelectorAll('.examples button')[{k}].click()"); settle(b, 0.4)
        st = b.eval('__app.stats()')
        ok.append(st['max'] > 0 and st['max'] == st['max'] and not b.eval("document.querySelector('.expr .error').textContent"))
    check(all(ok) and len(ok) == 5, f'every example formula parses and makes an image ({ok})')

    # 5. Invisible cells.
    setup(b, 'invisible')
    c = b.eval('__app.stats().contrast')
    check(c < 0.01, f'cells (0.3 rad of phase) at NA 1.4: contrast only {c:.4f}')
    put(b, NA=0.25)
    c2 = b.eval('__app.stats().contrast')
    check(c2 > 3 * c, f'closing the aperture to NA 0.25 shows faint rims (contrast {c2:.3f})')

    # 6. Defocus: the thickest parts bright beyond focus, dark before it (I ~ 1 - lambda z lap(phi) / 2 pi).
    setup(b, 'defocus')
    plus = b.eval(AT_THICKEST); c = b.eval('__app.stats().contrast')
    put(b, z=-1)
    minus = b.eval(AT_THICKEST)
    check(plus > 1.01 and minus < 0.99, f'defocus +1 um: I = {plus:.3f} at the thickest point; -1 um: {minus:.3f} (contrast {c:.3f})')

    # 7. Dark field: little light, bright edges on black.
    setup(b, 'darkfield')
    tp, st = b.eval('__app.throughput()'), b.eval('__app.stats()')
    check(tp < 0.02 and st['mean'] < 0.02 and st['min'] < 1e-6, f"dark field: {100 * tp:.2f}% of the light passes, mean I {st['mean']:.4f}")

    # 8. Zernike: dark contrast with -90 degrees, bright with +90; the formula 1 - 2(phi - mean).
    setup(b, 'zernike')
    cm = b.eval(CORR_PHASE)
    put(b, dotPhase=90)
    cp = b.eval(CORR_PHASE)
    check(cm < -0.9 and cp > 0.9, f'phase dot -90 deg: correlation of I with phi {cm:.3f}; +90 deg: {cp:.3f}')
    put(b, dotPhase=-90, NA=1.4, zoom=1)
    row, ref = b.eval(ROW), b.eval("""(() => { const a = __app, N = a.N, t = a.t, r = a.state.row; let mr = 0, mi = 0;
        for (let o = 0; o < N * N; o++) { mr += t.re[o]; mi += t.im[o]; } const m = Math.atan2(mi, mr), out = [];
        for (let i = 0; i < N; i++) out.push(1 - 2 * (Math.atan2(t.im[r * N + i], t.re[r * N + i]) - m)); return out; })()""")
    err = max(abs(x - y) for x, y in zip(row, ref))
    check(err < 0.12, f'at NA 1.4 the image follows I = 1 - 2(phi - mean phi) to {err:.3f} (phase up to 0.3 rad)')
    put(b, NA=0.5, phi0=0.1)
    c1 = b.eval('__app.stats().contrast')
    put(b, dotAmp=0.5)
    c2 = b.eval('__app.stats().contrast')
    check(1.7 < c2 / c1 < 2.3, f'with 0.1 rad of phase, an absorbing dot (amplitude 0.5) raises the contrast from {c1:.3f} to {c2:.3f}, about 1/a = 2 times')

    # 10. Schlieren: the knife edge keeps the zero order and half the rest.
    setup(b, 'schlieren')
    tp, c = b.eval('__app.throughput()'), b.eval('__app.stats().contrast')
    check(0.98 < tp < 1 and c > 0.1, f'knife edge: {100 * tp:.1f}% of the light passes, contrast {c:.2f}')

    # 11. The hidden portrait.
    setup(b, 'portrait')
    c = b.eval('__app.stats().contrast')
    put(b, filter='dot')
    cm, c2 = b.eval(CORR_PHASE), b.eval('__app.stats().contrast')
    put(b, dotPhase=90)
    cp = b.eval(CORR_PHASE)
    check(c < 0.03 and c2 > 0.3 and cm < -0.6 and cp > 0.6,
          f'the portrait in phase: contrast {c:.3f} in bright field, {c2:.2f} with the dot (correlation with phi {cm:.2f} at -90 deg, {cp:.2f} at +90)')
    b.screenshot('build/imaging-portrait-revealed.png')

    # 12. Coherent edges overshoot; incoherent images never exceed the brightest part of the object.
    setup(b, 'coherence')
    coh = b.eval('__app.stats().max')
    put(b, illum='incoherent', fpView='otf')
    inc = b.eval('__app.stats().max')
    check(coh > 1.15 and inc <= 1 + 1e-9, f'bar target: coherent I peaks at {coh:.3f}, incoherent at {inc:.4f}')
    b.screenshot('build/imaging-coherence-incoherent.png')
    put(b, preset='edge', illum='coherent', fpView='light', row=128)
    edge = b.eval('__app.stats().max')
    check(1.16 < edge < 1.2, f'a single straight edge in coherent light overshoots to {edge:.3f} (1.187 for a sharp cutoff)')
    put(b, illum='condenser', condNA=0.25)
    part = b.eval('__app.stats().max')
    check(1.0 < part < edge, f'partially coherent (condenser NA 0.25): it overshoots less, to {part:.3f}')

    # 13. The Siemens star: resolved outside r = 18 lambda / (2 pi NA) only; defocus reverses contrast.
    setup(b, 'star')
    radii = [1.5, 2.5, 4, 6, 9]
    cr = b.eval(f'{STAR_CORR}({json.dumps(radii)})')
    rc = 18 * 0.55 / (2 * 3.141592653589793 * 0.5)
    check(cr[0] < 0.3 and min(cr[2:]) > 0.8, f'coherent, cutoff radius {rc:.2f} um: correlation with the star at r = {radii}: {[round(x, 2) for x in cr]}')
    put(b, illum='incoherent', fpView='otf')
    cr = b.eval(f'{STAR_CORR}({json.dumps([2.5, 4, 6, 9])})')
    check(min(cr) > 0.8, f'incoherent, in focus: the spokes are resolved further in, all positive at r = 2.5 to 9 um ({[round(x, 2) for x in cr]})')
    put(b, z=4, exposure='stretch')
    cr = b.eval(f'{STAR_CORR}({json.dumps([3, 4, 5, 6, 8, 9])})')
    check(max(cr[:4]) < -0.8 and min(cr[4:]) > 0.7, f'incoherent, defocused 4 um: reversed between r = 3 and 6 um, right again at 8-9 um ({[round(x, 2) for x in cr]})')
    b.screenshot('build/imaging-star-defocus.png')

    # 14. Rayleigh.
    setup(b, 'rayleigh')
    row = b.eval(ROW)
    i1, mid = 128 - 3, 128
    dip = 1 - row[mid] / max(row[i1 - 2:i1 + 3])
    check(0.24 < dip < 0.29, f'two incoherent points at 0.61 lambda/NA: the profile dips {100 * dip:.1f}% between them')
    put(b, illum='coherent', fpView='light')
    row = b.eval(ROW)
    check(row[mid] >= max(row[i1 - 2:i1 + 3]) - 1e-12, f'coherent, in phase: one peak in the middle ({row[mid]:.4f} vs {max(row[i1 - 2:i1 + 3]):.4f} at the points)')
    put(b, pphase=180)
    row = b.eval(ROW)
    check(row[mid] < 1e-12 * max(row), 'coherent, opposite phases: dark between them')

    # The readouts keep still: every number in a slot of its own, so that no word, number, panel
    # or plot below moves (by more than 0.5 px) as the numbers change sign, size and figures.
    def frame_passed():
        b.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(0))))')
    def still(name, sel, steps, want_texts):
        moves, texts = b.steady(sel, steps)
        check(not moves and len(texts) >= want_texts,
              f'{name}: the readouts keep still through {len(texts)} different readings' + (f'; moved: {moves[:4]}' if moves else ''))
    def hover(canvas, fx, fy):
        def go():
            x, y = b.point(canvas, (fx, fy)); b.mouse('mouseMoved', x, y); frame_passed()
        return go
    def changed(**values):
        return lambda: (put(b, **values), frame_passed())
    setup(b, 'invisible')
    notes = '#obj-read, #obj-read .fixnum, #fp-read, #fp-read .fixnum, #img-read, #img-read .fixnum, #limit, #limit .fixnum, #profile'
    still('the notes under the planes', notes, [changed(NA=0.9), changed(z=-2.5), changed(NA=0.13, z=3.75), changed(phi0=2.9), changed(**{'lambda': 0.41}), changed(NA=1.37, z=0, **{'lambda': 0.55})], 7)
    # Under the pointer: x and y either side of the middle; in the pupil, sin theta either way.
    for canvas, sel in (('#object', '#obj-read'), ('#fourier', '#fp-read'), ('#image', '#img-read')):
        hover(canvas, 0.62, 0.41)()
        still(f'hovering over {canvas}', f'{sel}, {sel} .fixnum, #obj-read, #fp-read, #img-read, #profile',
              [hover(canvas, fx, fy) for fx, fy in ((0.38, 0.6), (0.555, 0.47), (0.45, 0.57), (0.97, 0.03), (0.07, 0.93))] if canvas != '#fourier'
              else [hover(canvas, fx, fy) for fx, fy in ((0.38, 0.6), (0.505, 0.49), (0.45, 0.57), (0.6, 0.52))], 5)
    b.mouse('mouseMoved', 5, 5); frame_passed()

    # Painting: ink on the object, a block on the pupil, the light dragged with the Tilt tool.
    setup(b, 'zernike')
    before = b.eval('__app.ink.reduce((a, v) => a + v, 0)')
    b.drag('#object', (0.1, 0.9), (0.3, 0.9), steps=8); settle(b, 0.2)
    after = b.eval('__app.ink.reduce((a, v) => a + v, 0)')
    check(after > before + 50, f'painting adds ink ({before:.0f} -> {after:.0f})')
    tp0 = b.eval('__app.throughput()')
    b.drag('#fourier', (0.5, 0.5), (0.58, 0.5), steps=6); settle(b, 0.2)
    tp1 = b.eval('__app.throughput()')
    check(tp1 < tp0, f'painting a block over the zero order cuts the light through the pupil ({100 * tp0:.1f}% -> {100 * tp1:.1f}%)')
    b.click('#fp-tools .seg button'); b.drag('#fourier', (0.5, 0.5), (0.7, 0.5), steps=6); settle(b, 0.2)
    check(b.eval('__app.state.tiltNA') > 0.1 and abs(b.eval('__app.state.tiltDir')) < 1, f"the Tilt tool tilts the light (sin theta {b.eval('__app.state.tiltNA')})")

    # The address keeps the set-up.
    setup(b, 'oblique'); b.sleep(0.5)
    h = b.eval('location.hash')
    b.goto('imaging/index.html' + h); b.wait('window.__app && __app.ready', timeout=30); settle(b)
    s = b.eval('[__app.state.preset, __app.state.d, __app.state.NA, __app.state.tiltNA, __app.state.tiltDir, __app.orders()]')
    check(s == ['grating', 0.8, 0.4, 0.35, 180, [0, 1]], f'the link {h} restores the set-up: {s}')
    b.goto('imaging/index.html?again#setup=star'); b.wait('window.__app && __app.ready', timeout=30); settle(b)
    check(b.eval('__app.state.preset') == 'star', '#setup=star opens the Siemens star')

    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

# A phone, and the dark theme.
with Browser('imaging/index.html', size=(400, 850)) as b:
    b.wait('window.__app && __app.ready', timeout=30); settle(b)
    full_page(b, 'build/imaging-phone.png')
    w = b.eval('document.documentElement.scrollWidth')
    check(w <= 400, f'no sideways scrolling on a phone (page width {w}px)')
    setup(b, 'abbe')
    full_page(b, 'build/imaging-phone-abbe.png')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'phone: no exceptions')
with Browser('imaging/index.html', size=(1400, 900)) as b:
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
    b.wait('window.__app && __app.ready', timeout=30); settle(b)
    setup(b, 'coherence')
    b.screenshot('build/imaging-dark.png')
    b.eval("document.querySelector('#help-button').click()"); b.sleep(0.5)
    b.screenshot('build/imaging-help.png')

print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
