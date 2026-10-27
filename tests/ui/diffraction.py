#!/usr/bin/env python3
"""Drive the diffraction demo: every experiment, painting, the screen from 0.1 mm to 10 m."""
import json, math, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

def set_z(b, mm):
    b.eval(f"(() => {{ const box = document.querySelector('#z-box input[type=number]'); box.value = {mm}; box.dispatchEvent(new Event('change')); }})()")
    b.sleep(0.4)

# The middle row of the field as drawn: [intensity], pitch (um), from __app.fields[0].
ROW = "(() => { const f = __app.fields[0], N = 512, r = []; for (let i = 128; i < 384; i++) { const o = 256 * N + i; r.push(f.re[o] ** 2 + f.im[o] ** 2); } return [r, f.pitch]; })()"

with Browser('diffraction/index.html', size=(1300, 1000)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1)
    b.screenshot('build/dif-start.png')
    before = b.eval('__app.ap.re.reduce((a, v) => a + v, 0)')
    b.drag('#aperture', (0.2, 0.2), (0.3, 0.3), steps=6); b.sleep(0.5)
    after = b.eval('__app.ap.re.reduce((a, v) => a + v, 0)')
    check(after > before, f'painting opens the aperture ({before:.0f} -> {after:.0f})')
    for name in b.eval('Object.keys(__app.setups)'):
        b.eval(f'__app.setups[{json.dumps(name)}]()'); b.sleep(1.2)
        b.screenshot(f'build/dif-exp-{name}.png')

    # The Arago spot: the centre of the disk's shadow is bright.
    b.eval("__app.setups.arago()"); b.sleep(0.5)
    # The disk's radius is 250 um: 160 um off centre is still in its shadow.
    c = b.eval("(() => { const f = __app.fields[0], N = 512, o = 256 * N + 256, d = Math.round(160 / f.pitch), I = (o) => f.re[o] ** 2 + f.im[o] ** 2; return [I(o), I(o + d)]; })()")
    check(c[0] > 0.8 and c[0] > 3 * c[1], f'the Arago spot: as bright as the unobstructed light in the middle of the shadow ({c[0]:.3g}), dark around it (160 um off: {c[1]:.3g})')

    # Far field: the button moves the slider to the end of its range, and the screen shows the
    # Fraunhofer pattern of the slit, sinc^2(a theta / lambda) across, zeros at theta = lambda / a.
    b.eval("__app.setups.slit()"); b.sleep(0.5)
    b.click('#far-box button'); b.sleep(1)
    z, pos = b.eval("[__app.state.z, +document.querySelector('#z-box input[type=range]').value]")
    check(z == b.eval('__app.ZMAX') and pos == 1000, f'Far field puts the screen at the end of the slider (z = {z / 1e6:g} m, slider at {pos}/1000)')
    row, p = b.eval(ROW)
    lam, a = 0.55, 200
    sinc = lambda t: 1 if t == 0 else math.sin(math.pi * t) / (math.pi * t)
    peak = row[128]
    fr = [peak * sinc(a * ((i - 128) * p / z) / lam) ** 2 for i in range(256)]
    err = math.sqrt(sum((u - v) ** 2 for u, v in zip(row, fr)) / sum(v * v for v in fr))
    zero = row[128 + round(lam * z / a / p)] / peak
    check(err < 0.02 and zero < 0.01, f'at 10 m the slit pattern is sinc^2 to {100 * err:.2f}% (first zero at lambda z / a = {lam * z / a / 1000:.1f} mm: {zero:.4f} of the peak)')
    b.screenshot('build/dif-far-slit.png')

    # No jump where the method changes, at z_c = 59.58 mm: a step of 0.2 mm across it changes the
    # middle row no more than the same step just before it (beyond z_c the row is interpolated
    # back to the same points, the pixel having grown).
    b.eval("__app.setups.zone()"); b.sleep(0.5)
    rows = []
    for zz in (59.2, 59.4, 59.6):
        set_z(b, zz); rows.append(b.eval(ROW))
    def at(row, p, x):
        u = x / p + 128; i = math.floor(u); return row[i] + (u - i) * (row[i + 1] - row[i])
    same = [[at(r, p, (i - 128) * 8) for i in range(8, 248)] for r, p in rows]
    change = lambda A, B: math.sqrt(sum((u - v) ** 2 for u, v in zip(A, B)) / sum(v * v for v in A))
    within, across = change(same[0], same[1]), change(same[1], same[2])
    check(rows[1][1] == 8 and rows[2][1] > 8 and across < 1.5 * within, f'across z_c the pixel grows ({rows[1][1]} -> {rows[2][1]:.3f} um) and the zone plate pattern changes by {100 * across:.2f}% per 0.2 mm, as it does before ({100 * within:.2f}%)')

    # The zone plate focuses at f = 50 mm: the brightest point on the screen is the middle, and
    # along the axis it is brighter there than 3% either side; likewise at f/3 and f/5.
    centre = "(() => { const f = __app.fields[0], o = 256 * 512 + 256; return f.re[o] ** 2 + f.im[o] ** 2; })()"
    for m in (1, 3, 5):
        I = []
        for s in (0.97, 1, 1.03):
            set_z(b, 50 / m * s); I.append(b.eval(centre))
        check(I[1] > I[0] and I[1] > I[2], f'zone plate focus at f/{m} = {50 / m:.3g} mm: centre {I[1]:.0f}, 3% nearer {I[0]:.0f}, 3% farther {I[2]:.0f}')
    set_z(b, 50)
    top = b.eval("(() => { const f = __app.fields[0], N = 512; let m = 0, at = 0; for (let j = 128; j < 384; j++) for (let i = 128; i < 384; i++) { const o = j * N + i, I = f.re[o] ** 2 + f.im[o] ** 2; if (I > m) { m = I; at = [i, j]; } } return at; })()")
    check(top == [256, 256], f'at z = f the brightest point is the focus, in the middle ({top})')

    # Fast enough to drag: one wavelength's field, near and far.
    ms = b.eval("""(async () => {
      const o = await import('/diffraction/optics.js'), a = __app.ap, t = [];
      for (const z of [3e4, 3e5]) { const t0 = performance.now(); for (let r = 0; r < 3; r++) o.diffract(a.re, a.im, 512, 8, 0.55, z); t.push((performance.now() - t0) / 3); }
      return t; })()""")
    check(max(ms) < 300, f'one field takes {ms[0]:.0f} ms near, {ms[1]:.0f} ms far (with the spectrum kept between frames, less near)')

    # A sweep of the screen for the slit, the zone plate and the hole, for looking at.
    for setup, zs in (('slit', (1, 10, 60, 200, 1000, 10000)), ('zone', (10, 16.7, 50, 300, 2000, 10000)), ('double', (5, 80, 300, 10000))):
        b.eval(f'__app.setups.{setup}()'); b.sleep(0.5)
        for zz in zs:
            set_z(b, zz); b.sleep(0.8)
            b.screenshot(f'build/dif-sweep-{setup}-{zz:g}mm.png', selector='main')

    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
