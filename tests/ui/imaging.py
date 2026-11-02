#!/usr/bin/env python3
"""Drive the imaging demo: every experiment, with the physics checked as it goes and every number
the help quotes measured; the sketch of the microscope against the pupil; painting; the address;
screenshots at desktop and phone sizes, light and dark."""
import json, os, re, sys
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
# The small-phase formula 1 - 2(phi - <phi>) along the profile's row.
ZERNIKE_ROW = """(() => { const a = __app, N = a.N, t = a.t, r = a.state.row; let mr = 0, mi = 0;
  for (let o = 0; o < N * N; o++) { mr += t.re[o]; mi += t.im[o]; } const m = Math.atan2(mi, mr), out = [];
  for (let i = 0; i < N; i++) out.push(1 - 2 * (Math.atan2(t.im[r * N + i], t.re[r * N + i]) - m)); return out; })()"""
# For the Siemens star: the correlation, round a circle of radius r (um), between the image and
# the object's transmission, for a list of radii.
STAR_CORR = """((radii) => { const a = __app, N = a.N, dx = a.DX, t = a.t; return radii.map((r) => {
  const M = 720, I = [], T = []; for (let k = 0; k < M; k++) { const th = 2 * Math.PI * k / M;
    const i = Math.round(N / 2 + r * Math.cos(th) / dx), j = Math.round(N / 2 - r * Math.sin(th) / dx), o = j * N + i;
    I.push(a.I[o]); T.push(t.re[o] ** 2 + t.im[o] ** 2); }
  const m = (v) => v.reduce((x, y) => x + y, 0) / v.length, mi = m(I), mt = m(T);
  let ab = 0, aa = 0, bb = 0; for (let k = 0; k < M; k++) { ab += (I[k] - mi) * (T[k] - mt); aa += (I[k] - mi) ** 2; bb += (T[k] - mt) ** 2; }
  return ab / Math.sqrt(aa * bb + 1e-30); }); })"""
# For the bar target: how much of each group's modulation at its own bar frequency survives in
# the image (a lock-in over two periods of its vertical bars, the image's over the object's).
BAR_GROUPS = """(() => { const a = __app, N = a.N, dx = a.DX, t = a.t, P = [0,1,2,3,4,5,6,7].map((k) => +(2 * 2 ** (-k / 3)).toFixed(3));
  const m = (f, j, i0, i1, p) => { let s = 0, c = 0, d = 0; for (let i = i0; i <= i1; i++) { const x = (i - N / 2) * dx, v = f(j * N + i); s += v; c += v * Math.cos(2 * Math.PI * x / p); d += v * Math.sin(2 * Math.PI * x / p); } return 2 * Math.hypot(c, d) / s; };
  return P.map((p, k) => { const col = k % 4, row = Math.floor(k / 4), gx = -12.8 + 6.4 * (col + 0.5), gy = 12.8 - 12.8 * (row + 0.5);
    const j = Math.round(N / 2 - (gy + 1.75 * p) / dx), i0 = Math.round(N / 2 + (gx - p) / dx), i1 = Math.round(N / 2 + (gx + p) / dx) - 1;
    return m((o) => a.I[o], j, i0, i1, p) / m((o) => t.re[o] ** 2 + t.im[o] ** 2, j, i0, i1, p); }); })()"""
# The sketch's cut through the Fourier plane: the pupil at direction sin(theta) = s (along the cut).
SIDE_PASS = "((s) => { const a = __app, k = a.N * a.DX / a.state.lambda, b = Math.round(s * k) + a.N / 2; return a.side.amp[b] > 1e-6; })"

def settle(b, s=0.4):
    b.sleep(s); b.wait('__app.partialDone', timeout=60); b.sleep(0.25)

def setup(b, name):
    b.eval(f'__app.setups[{json.dumps(name)}]()'); settle(b, 0.6)

def put(b, **values):
    b.eval(f'__app.set({json.dumps(values)})'); settle(b)

def stats(b):
    return b.eval('__app.stats()')

def near(x, quoted, places):
    """x rounds to the number quoted in the help, to its places of decimals."""
    return abs(x - quoted) <= 0.5 * 10 ** -places + 1e-12

def help_text(b, setup):
    return b.eval(f"document.querySelector('.exp[data-setup={json.dumps(setup)}]').textContent.replace(/\\s+/g, ' ')")

def quoted(b, setup, *numbers):
    """The help for setup quotes each of these numbers (as written)."""
    text = help_text(b, setup)
    missing = [n for n in numbers if n not in text]
    check(not missing, f'experiment {setup}: the help quotes {", ".join(numbers)}' + (f' (missing: {missing})' if missing else ''))

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
    st = stats(b)
    check(st['contrast'] > 0.3 and b.eval('__app.state.filter') == 'dot' and b.eval('__app.state.dotPhase') == -90,
          f"opens on cells in positive phase contrast (a -90 degree dot; image contrast {st['contrast']:.2f})")
    note = b.eval("document.querySelector('#filter-note').textContent")
    check('advances' in note and 'dark' in note and 'positive phase contrast' in note, f'the note says what the -90 degree dot does: "{note}"')

    # The sketch lines up with the pictures under it: the object, the Fourier plane and the image.
    xs = b.eval('__app.sketchX()')
    centres = b.eval("""['#object', '#fourier', '#image'].map((id) => { const r = document.querySelector(id).getBoundingClientRect(),
        s = document.querySelector('#sketch').getBoundingClientRect(); return r.left + r.width / 2 - s.left; })""")
    check(all(abs(a - c) < 1 for a, c in zip([xs['xo'], xs['xF'], xs['xI']], centres)),
          f"the sketch's object, Fourier plane and image stand over their pictures ({[round(v) for v in (xs['xo'], xs['xF'], xs['xI'])]} vs {[round(v) for v in centres]})")
    # The side panel follows the light, numbered as in the sketch.
    labels = b.eval("[...document.querySelectorAll('.controls .panel > .label')].map((e) => e.textContent)")
    check([l[0] for l in labels] == ['1', '2', '3', '4'] and 'Light' in labels[0] and 'Object' in labels[1] and 'Objective' in labels[2] and 'Fourier' in labels[3],
          f'the side panel goes along the light: {labels}')

    # A student's first clicks, on the buttons themselves: the four things to put in the Fourier
    # plane, the sign of the dot, the light, an object, the NA slider.
    def click_text(sel, text):
        b.eval(f"[...document.querySelectorAll({json.dumps(sel)})].find((e) => e.textContent.includes({json.dumps(text)})).click()"); settle(b)
    click_text('.filters button', 'Open')
    c, note = b.eval('__app.stats().contrast'), b.eval("document.querySelector('#filter-note').textContent")
    check(b.eval('__app.state.filter') == 'open' and c < 0.01 and 'barely shows' in note, f'Open: the cells all but vanish (contrast {c:.4f}), and the note says why')
    click_text('.filters button', 'Stop')
    tp = b.eval('__app.throughput()')
    check(b.eval('__app.state.filter') == 'stop' and tp < 0.05, f'Stop: the zero order is blocked, {100 * tp:.1f}% of the light gets through')
    click_text('.filters button', 'Knife edge')
    check(b.eval('__app.state.filter') == 'knife' and b.eval('__app.stats().contrast') > 0.1, 'Knife edge: the cells show in relief')
    click_text('.filters button', 'Phase dot')
    click_text('#filter .seg button', '+90°')
    check(b.eval('__app.state.dotPhase') == 90 and b.eval(CORR_PHASE) > 0.9, 'Phase dot, then +90°: the cells turn bright')
    click_text('#filter .seg button', '−90°')
    check(b.eval('__app.state.dotPhase') == -90 and b.eval(CORR_PHASE) < -0.9, '−90°: dark again')
    click_text('#illum .seg button', 'Condenser')
    shown = b.eval("[...document.querySelectorAll('#illum .slider')].some((e) => !e.hidden && e.textContent.includes('condenser'))")
    check(b.eval('__app.state.illum') == 'condenser' and shown, 'Condenser: the light is a cone, and its NA slider appears')
    click_text('#illum .seg button', 'Coherent')
    b.eval("(() => { const r = [...document.querySelectorAll('#objective .slider')].find((e) => e.textContent.startsWith('NA')).querySelector('input[type=range]'); r.value = 500; r.dispatchEvent(new Event('input')); })()"); settle(b)
    na = b.eval('__app.state.NA')
    check(0.7 < na < 0.75, f'the NA slider moves the aperture (NA {na})')
    click_text('#presets button', 'Grating')
    check(b.eval('__app.state.preset') == 'grating' and b.eval('__app.orders()') is not None, 'the Grating button puts a grating under the lens')

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
    st = stats(b)
    check(b.eval('__app.orders()') == [0] and st['contrast'] < 1e-9 and near(st['mean'], 0.250, 3),
          f"NA 0.35 < lambda/d = 0.43: only the zero order passes and the image is an even I = {st['mean']:.3f} (contrast {st['contrast']:.1e})")
    check(b.eval(f'{SIDE_PASS}(0)') and not b.eval(f'{SIDE_PASS}(0.55 / 1.28)') and not b.eval(f'{SIDE_PASS}(-0.55 / 1.28)'),
          'the sketch agrees: the zero order passes, the first orders stop at the aperture')
    put(b, NA=0.45)
    c, period = b.eval('__app.stats().contrast'), b.eval('__app.profilePeriod')
    check(b.eval('__app.orders()') == [-1, 0, 1] and c > 0.9 and abs(period - 1.28) < 1e-9 and b.eval(f'{SIDE_PASS}(0.55 / 1.28)'),
          f'NA 0.45: orders -1, 0, +1 pass (in the sketch too), contrast {c:.3f}, period {period} um')
    put(b, NA=1.3)
    check(b.eval('__app.orders()') == [-3, -1, 0, 1, 3], 'NA 1.3 > 3 lambda/d = 1.289: the third orders pass (no second orders for equal bars)')
    quoted(b, 'abbe', '1.28', '0.35', '0.250', '0.43', '1.29')
    b.screenshot('build/imaging-abbe-1.3.png')

    # 2. Block the zero order: the period halves.
    setup(b, 'zero')
    period = b.eval('__app.profilePeriod')
    check(b.eval('__app.orders()') == [-1, 1] and near(period, 0.640, 3) and b.eval('__app.side.zero.amp') == 0,
          f'zero order blocked (in the sketch too): the image repeats every {period} um = d/2')
    quoted(b, 'zero', '0.6', '0.640')

    # 3. Oblique light: 0 and +1 make fringes of period d where axial light shows nothing.
    setup(b, 'oblique')
    c, period = b.eval('__app.stats().contrast'), b.eval('__app.profilePeriod')
    check(b.eval('__app.orders()') == [0, 1] and near(c, 0.85, 2) and abs(period - 0.8) < 1e-9, f'tilted: orders 0 and +1, contrast {c:.2f}, period {period} um')
    check(b.eval('__app.state.fpTool') == 'tilt', 'the Tilt tool is chosen, ready to drag the light')
    put(b, tiltNA=0)
    check(b.eval('__app.stats().contrast') < 1e-9 and b.eval('__app.orders()') == [0], 'the same grating on axis: nothing')
    put(b, illum='condenser', condNA=0.4)
    c = b.eval('__app.stats().contrast')
    check(near(c, 0.08, 2), f'a condenser as wide as the objective (NA 0.4) resolves it too, with less contrast ({c:.3f})')
    quoted(b, 'oblique', '0.8', '0.69', '0.4', '0.35', '0.08', '0.85')

    # 4. The diatom: its pore lattice's six first orders, at sin theta = lambda / 0.52 um = 1.06.
    setup(b, 'diatom')
    n0 = b.eval('__app.poreOrders()')
    put(b, NA=1.1)
    n1 = b.eval('__app.poreOrders()')
    put(b, NA=0.65, tiltNA=0.53, tiltDir=-65)
    n2 = b.eval('__app.poreOrders()')
    check((n0, n1, n2) == (0, 6, 1), f'diatom pore orders through the pupil: {n0} at NA 0.65, {n1} at NA 1.1, {n2} at NA 0.65 with tilted light')
    quoted(b, 'diatom', '0.52', '1.06', '0.65', '0.53', '−65°')

    # A typed transmission: a phase disk, shown as its phase, made visible by the phase dot.
    b.eval("document.querySelector('#presets button:last-child').click()"); settle(b, 0.6)
    view, c = b.eval('__app.state.objView'), b.eval('__app.stats().contrast')
    check(b.eval('__app.state.preset') == 'formula' and view == 'phase' and c > 0.3, f'the typed phase disk exp(i a (r < R)) is drawn as a phase ({view}) and shows with the dot (contrast {c:.2f})')
    ok = []
    for k in range(b.eval("document.querySelectorAll('.examples button').length")):
        b.eval(f"document.querySelectorAll('.examples button')[{k}].click()"); settle(b, 0.4)
        st = stats(b)
        ok.append(st['max'] > 0 and st['max'] == st['max'] and not b.eval("document.querySelector('.expr .error').textContent"))
    check(all(ok) and len(ok) == 5, f'every example formula parses and makes an image ({ok})')

    # 5. Invisible cells.
    setup(b, 'invisible')
    st = stats(b)
    dev = max(st['max'] - 1, 1 - st['min'])
    check(near(100 * dev, 0.15, 2), f'cells (0.3 rad of phase) at NA 1.4: the image is even to {100 * dev:.2f}%')
    zw = b.eval('__app.side.zero.w')
    check(near(100 * zw, 99.7, 1), f'{100 * zw:.2f}% of their light is in the zero order (the sketch says so)')
    put(b, NA=0.25)
    c2 = b.eval('__app.stats().contrast')
    check(near(c2, 0.006, 3), f'closing the aperture to NA 0.25 shows faint rims (contrast {c2:.4f})')
    quoted(b, 'invisible', '0.3 rad', '1.4', '0.15%', '0.25', '0.006', '99.7%')

    # 6. Defocus: the thickest parts bright beyond focus, dark before it (I ~ 1 - lambda z lap(phi) / 2 pi).
    setup(b, 'defocus')
    plus = b.eval(AT_THICKEST)
    put(b, z=-1)
    minus = b.eval(AT_THICKEST)
    check(near(plus - 1, 0.03, 2) and near(1 - minus, 0.03, 2), f'defocus +1 um: I = {plus:.3f} at the thickest point (3% brighter); -1 um: {minus:.3f} (3% darker)')
    quoted(b, 'defocus', '1 µm', '3% brighter', '3% darker')

    # 7. Dark field: little light, bright edges on black.
    setup(b, 'darkfield')
    tp, st = b.eval('__app.throughput()'), stats(b)
    check(near(100 * tp, 0.73, 2) and st['min'] < 1e-6 and b.eval('__app.side.zero.amp') == 0,
          f"dark field: {100 * tp:.2f}% of the light passes, mean I {st['mean']:.4f}; the sketch's zero order stops at the stop")
    put(b, filter='open', tiltNA=0.6)
    st = stats(b)
    note = b.eval("document.querySelector('#filter-note').textContent")
    check(b.eval('__app.side.zero.amp') == 0 and st['mean'] < 0.01 and st['max'] > 10 * st['mean'] and 'dark field' in note,
          f"light tilted past the NA (0.6 > 0.5): the zero order misses the aperture, and the letters glow (I up to {st['max']:.3f}, mean {st['mean']:.4f}); the note says so")
    quoted(b, 'darkfield', '0.08', '0.73%', '0.6')

    # 8. Zernike: dark contrast with -90 degrees, bright with +90; the formula 1 - 2(phi - mean).
    setup(b, 'zernike')
    cm = b.eval(CORR_PHASE)
    put(b, dotPhase=90)
    cp = b.eval(CORR_PHASE)
    note = b.eval("document.querySelector('#filter-note').textContent")
    check(cm < -0.9 and cp > 0.9, f'phase dot -90 deg: correlation of I with phi {cm:.3f} (thick is dark); +90 deg: {cp:.3f} (thick is bright)')
    check('delays' in note and 'bright' in note and 'negative phase contrast' in note, f'the note says what the +90 degree dot does: "{note}"')
    put(b, dotPhase=-90, NA=1.4, zoom=1)
    row, ref = b.eval(ROW), b.eval(ZERNIKE_ROW)
    err = max(abs(x - y) for x, y in zip(row, ref))
    check(near(err, 0.073, 3), f'at NA 1.4 the image follows I = 1 - 2(phi - mean phi) to {err:.4f} along the profile (phase up to 0.3 rad)')
    setup(b, 'zernike')
    put(b, phi0=0.1)
    c1 = b.eval('__app.stats().contrast')
    put(b, dotAmp=0.5)
    c2 = b.eval('__app.stats().contrast')
    check(near(c1, 0.103, 3) and near(c2, 0.213, 3), f'with 0.1 rad of phase, an absorbing dot (a = 0.5) raises the contrast from {c1:.3f} to {c2:.3f}, about 1/a = 2 times')
    quoted(b, 'zernike', '0.5', '1.4', '0.073', '0.1', '0.103', '0.213')

    # 9. The halo: a bigger dot shifts the low frequencies too, and the cells fade.
    setup(b, 'halo')
    c1 = b.eval('__app.stats().contrast')
    put(b, dotNA=0.2)
    c2 = b.eval('__app.stats().contrast')
    check(near(c1, 0.23, 2) and near(c2, 0.09, 2), f'the halo: a 0.1 NA dot gives contrast {c1:.3f}, a 0.2 NA dot {c2:.3f}')
    quoted(b, 'halo', '0.1 NA', '0.2', '0.23', '0.09')

    # 10. Schlieren: the knife edge keeps the zero order and half the rest, and the image follows
    # the slope of the phase: brighter where it rises to the right (the kept side).
    setup(b, 'schlieren')
    tp, c = b.eval('__app.throughput()'), b.eval('__app.stats().contrast')
    slope = b.eval("""(() => { const a = __app, N = a.N, t = a.t, I = a.I; let s = 0, n = 0, mi = 0;
        for (let o = 0; o < N * N; o++) mi += I[o] / (N * N);
        for (let j = 0; j < N; j++) for (let i = 1; i < N - 1; i++) { const o = j * N + i;
          const g = Math.atan2(t.im[o + 1], t.re[o + 1]) - Math.atan2(t.im[o - 1], t.re[o - 1]); s += g * (I[o] - mi); n += g * g; }
        return s / Math.sqrt(n); })()""")
    check(0.98 < tp < 1 and c > 0.1 and slope > 0, f'knife edge: {100 * tp:.1f}% of the light passes, contrast {c:.2f}, brighter where the phase rises to the right')

    # 11. The hidden portrait.
    setup(b, 'portrait')
    c = b.eval('__app.stats().contrast')
    put(b, filter='dot')
    cm, c2 = b.eval(CORR_PHASE), b.eval('__app.stats().contrast')
    put(b, dotPhase=90)
    cp = b.eval(CORR_PHASE)
    check(near(100 * c, 1.5, 1) and near(c2, 0.32, 2) and cm < -0.6 and cp > 0.6,
          f'the portrait in phase: contrast {100 * c:.2f}% in bright field, {c2:.3f} with the dot (correlation with phi {cm:.2f} at -90 deg, {cp:.2f} at +90)')
    quoted(b, 'portrait', '0.3 rad', '1.5%', '0.32')
    b.screenshot('build/imaging-portrait-revealed.png')

    # 12. Coherent edges overshoot; incoherent images never exceed the brightest part of the object.
    setup(b, 'coherence')
    coh, g = b.eval('__app.stats().max'), b.eval(BAR_GROUPS)
    check(near(coh, 1.664, 3), f'bar target, coherent: I peaks at {coh:.4f}')
    check(near(g[3], 0.44, 2) and near(100 * g[4], 5, 0) and near(100 * g[5], 4, 0),
          f'coherent: the 1 um group keeps {100 * g[3]:.0f}% of its contrast, the 0.79 and 0.63 um groups {100 * g[4]:.1f}% and {100 * g[5]:.1f}%')
    put(b, illum='incoherent', fpView='otf')
    inc, g = b.eval('__app.stats().max'), b.eval(BAR_GROUPS)
    check(near(inc, 0.997, 3) and inc <= 1 + 1e-9, f'incoherent: I peaks at {inc:.4f}, never above 1')
    check(near(100 * g[4], 16.5, 1) and near(100 * g[5], 11.8, 1) and g[6] < 0.03,
          f'incoherent: the 0.79 and 0.63 um groups keep {100 * g[4]:.1f}% and {100 * g[5]:.1f}%, the 0.5 um group {100 * g[6]:.1f}%')
    b.screenshot('build/imaging-coherence-incoherent.png')
    put(b, illum='condenser', fpView='light', condNA=0.25)
    part = b.eval('__app.stats().max')
    check(near(part, 1.27, 2), f'a condenser of NA 0.25: the bar target rings less, to {part:.3f}')
    put(b, preset='edge', illum='coherent', fpView='light', row=128)
    edge = b.eval('__app.stats().max')
    check(near(edge, 1.190, 3), f'a single straight edge in coherent light overshoots to {edge:.3f} (1.187 for a sharp cutoff)')
    put(b, illum='condenser', condNA=0.25)
    part = b.eval('__app.stats().max')
    check(1.0 < part < edge, f'partially coherent (condenser NA 0.25): the edge overshoots less, to {part:.3f}')
    quoted(b, 'coherence', '0.79', '5% and 4%', '44%', '19%', '1.190', '1.664', '0.55', '16.5%', '11.8%', '0.997', '1.27', '0.73')

    # 13. The Siemens star: resolved outside r = 18 lambda / (2 pi NA) only; defocus reverses contrast.
    setup(b, 'star')
    radii = [1.5, 2.5, 4, 6, 9]
    cr = b.eval(f'{STAR_CORR}({json.dumps(radii)})')
    rc = 18 * 0.55 / (2 * 3.141592653589793 * 0.5)
    check(cr[0] < 0.3 and min(cr[2:]) > 0.8 and near(rc, 3.15, 2), f'coherent, cutoff radius {rc:.2f} um: correlation with the star at r = {radii}: {[round(x, 2) for x in cr]}')
    put(b, illum='incoherent', fpView='otf')
    cr = b.eval(f'{STAR_CORR}({json.dumps([2.5, 4, 6, 9])})')
    check(min(cr) > 0.8, f'incoherent, in focus: the spokes are resolved further in, all positive at r = 2.5 to 9 um ({[round(x, 2) for x in cr]})')
    put(b, z=4, exposure='stretch')
    cr = b.eval(f'{STAR_CORR}({json.dumps([3, 4, 5, 6, 8, 9])})')
    check(max(cr[:4]) < -0.8 and min(cr[4:]) > 0.7, f'incoherent, defocused 4 um: reversed between r = 3 and 6 um, right again at 8-9 um ({[round(x, 2) for x in cr]})')
    quoted(b, 'star', '18', '3.15', '4 µm')
    b.screenshot('build/imaging-star-defocus.png')

    # 14. Rayleigh.
    setup(b, 'rayleigh')
    row = b.eval(ROW)
    i1, mid = 128 - 3, 128
    dip = 1 - row[mid] / max(row[i1 - 2:i1 + 3])
    check(near(100 * dip, 26.6, 1), f'two incoherent points at 0.61 lambda/NA = {0.61 * 0.55 / 0.56:.3f} um: the profile dips {100 * dip:.2f}% between them')
    put(b, illum='coherent', fpView='light')
    row = b.eval(ROW)
    check(row[mid] >= max(row[i1 - 2:i1 + 3]) - 1e-12, f'coherent, in phase: one peak in the middle ({row[mid]:.4f} vs {max(row[i1 - 2:i1 + 3]):.4f} at the points)')
    put(b, pphase=180)
    row = b.eval(ROW)
    check(row[mid] < 1e-12 * max(row), 'coherent, opposite phases: dark between them')
    quoted(b, 'rayleigh', '0.6', '0.56', '0.599', '26.6%')

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
    tools = b.eval("[...document.querySelectorAll('#fp-tools .seg button')].map((e) => e.textContent)")
    check(tools == ['Tilt the light', 'Block', 'Pass', '−90°', '+90°', 'Unpaint'] and not set(tools) & set(b.eval("[...document.querySelectorAll('.filters button b')].map((e) => e.textContent)")),
          f'the Fourier-plane tools share no name with what panel 4 puts in the plane: {tools}')
    tp0 = b.eval('__app.throughput()')
    b.drag('#fourier', (0.5, 0.5), (0.58, 0.5), steps=6); settle(b, 0.2)
    tp1 = b.eval('__app.throughput()')
    check(tp1 < tp0 and not b.eval(f'{SIDE_PASS}(0)'),
          f'painting a block over the zero order cuts the light through the pupil ({100 * tp0:.1f}% -> {100 * tp1:.1f}%), in the sketch too')
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
with Browser('imaging/index.html', size=(390, 844)) as b:
    b.wait('window.__app && __app.ready', timeout=30); settle(b)
    full_page(b, 'build/imaging-phone.png')
    w = b.eval('document.documentElement.scrollWidth')
    check(w <= 390, f'no sideways scrolling on a phone (page width {w}px)')
    order = ['.sketch-box', '#side-obj', '#p-light', '#p-object', '#p-objective', '#side-fp', '#p-filter', '#side-img', '.profile-box']
    tops = b.eval(f"{json.dumps(order)}.map((s) => document.querySelector(s).getBoundingClientRect().top)")
    check(all(a < c for a, c in zip(tops, tops[1:])), 'on a phone, each numbered panel comes by the picture it acts on, along the light: ' + ' < '.join(s.lstrip('#.') for s in order))
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
