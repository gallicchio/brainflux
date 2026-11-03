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

# What the screen shows, from the canvas: the brightest pixel within 5 um of the middle, and the
# 99th percentile and the brightest beyond 30 um (leaving out the scale bar at the bottom).
SPOT = """(() => {
  const cv = document.querySelector('#field'), w = cv.width, h = cv.height, d = cv.getContext('2d').getImageData(0, 0, w, h).data;
  const px = w / (256 * __app.screenPitch() / __app.state.zoom);   // canvas pixels per um
  let peak = 0; const out = [];
  for (let y = 0; y < h - 30; y++) for (let x = 0; x < w; x++) {
    const o = 4 * (y * w + x), v = Math.max(d[o], d[o + 1], d[o + 2]), r = Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) / px;
    if (r < 5) peak = Math.max(peak, v); else if (r > 30) out.push(v);
  }
  out.sort((a, b) => a - b);
  return [peak, out[Math.floor(0.99 * out.length)], out[out.length - 1]];
})()"""

# The middle row of the field as drawn: [intensity], pitch (um), from __app.fields[0].
ROW = "(() => { const f = __app.fields[0], N = 512, r = []; for (let i = 128; i < 384; i++) { const o = 256 * N + i; r.push(f.re[o] ** 2 + f.im[o] ** 2); } return [r, f.pitch]; })()"

with Browser('diffraction/index.html', size=(1300, 1000)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1)
    b.screenshot('build/dif-start.png')
    # The first screen: a hint on the aperture, in plain words, visible without scrolling; the three
    # pictures headed by what they show.
    hint = b.eval("(() => { const e = document.querySelector('#ap-note'), r = e.getBoundingClientRect(); return { text: e.textContent, hint: e.classList.contains('hint'), visible: r.width > 0 && r.bottom < innerHeight }; })()")
    check(hint['hint'] and hint['visible'] and hint['text'].startswith('drag on it to paint it open'), f"the aperture's hint is on the first screen: {hint['text']!r}")
    heads = b.eval("[...document.querySelectorAll('.side-head h2')].map((e) => e.textContent)")
    check(heads == ['Aperture', 'On the screen at distance z', 'From the side'], f'the three pictures are headed in plain words: {heads}')
    # The drawer: Start here first (plain words, no equations), then the experiments, then the theory
    # under How it works; the terms glossed where they are first used.
    kinds = b.eval("[...document.querySelector('#help').children].map((e) => e.tagName.toLowerCase() + (e.className ? '.' + e.className.split(' ')[0] : ''))")
    start = b.eval("""(() => { const s = document.querySelector('#help section.start'); return { h: s?.querySelector('h3')?.textContent,
        math: s?.querySelectorAll('math').length, sentences: (s?.textContent.match(/[.!?](\\s|$)/g) || []).length }; })()""")
    h3s = b.eval("[...document.querySelectorAll('#help > h3')].map((e) => e.textContent)")
    check(kinds[:2] == ['header', 'section.start'] and start['h'] == 'Start here' and start['math'] == 0 and 3 <= start['sentences'] <= 7 and h3s[0] == 'How it works',
          f"the drawer begins with a Start here block ({start['sentences']} sentences, no equations); the theory comes after the experiments ({h3s})")
    text = ' '.join(b.eval("document.querySelector('#help').textContent").split())
    glosses = ('Fresnel diffraction: the near field', 'Fraunhofer diffraction: the far field', 'the angular spectrum, the light sorted by direction', 'Talbot length', 'Fresnel number')
    check(all(g in text for g in glosses), 'Fresnel, Fraunhofer, the Fresnel number, the angular spectrum and the Talbot length are glossed where they are first used')
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

    # The scale bar in the far field reads as a round angle and its length at this distance, at
    # every zoom: at 16x the angle is under a milliradian and goes in microradians, never "5e−1".
    bars = {}
    for k, zm in enumerate((1, 4, 16)):
        b.eval(f"""(() => {{ window.__bar = []; const c = document.getElementById('field').getContext('2d'), fill = c.fillText.bind(c);
            c.fillText = (t, x, y) => {{ __bar.push(t); fill(t, x, y); }};
            document.querySelectorAll('#scale-box .seg')[1].querySelectorAll('button')[{k}].click(); c.fillText = fill; }})()""")
        bars[zm] = ''.join(b.eval('__bar'))
    check(bars[1] == '5 mrad = 50.00\xa0mm' and bars[4] == '2 mrad = 20.00\xa0mm' and bars[16] == '500 µrad = 5.00\xa0mm', f'the far-field scale bar at 10 m, zoomed 1, 4 and 16 times: {bars}')
    b.eval("document.querySelectorAll('#scale-box .seg')[1].querySelector('button').click()"); b.sleep(0.3)

    # The readout under the slider names the regime, with its boundaries where the unit tests put
    # them: within 5% of the Fourier transform at N_F = 0.3, within 1% at 0.1.  For the opaque
    # disk it follows the shadow instead.
    words = {}
    for zz in (3, 10, 100, 200):
        set_z(b, zz); words[zz] = b.eval("document.querySelector('#fresnel').textContent")
    check('near field' in words[3] and 'in between' in words[10] and 'nearly the far field' in words[100] and 'far field: the pattern is the Fourier transform (to 1%)' in words[200],
          f'the slit (a = 100 µm): near field at 3 mm, in between at 10, nearly the far field at 100, the far field at 200: {words}')
    b.eval("__app.setups.arago()"); b.sleep(0.5)
    for zz in (20, 150, 2000):
        set_z(b, zz); words[zz] = b.eval("document.querySelector('#fresnel').textContent")
    check('with the spot in it' in words[20] and 'the shadow is filling in' in words[150] and 'hardly any shadow is left' in words[2000],
          f'the disk (a = 250 µm): a sharp shadow with the spot at 20 mm, filling in at 150, gone at 2 m: {words[20]!r}, {words[150]!r}, {words[2000]!r}')
    b.eval("__app.setups.edge()"); b.sleep(0.5)
    t = b.eval("document.querySelector('#fresnel').textContent")
    check('0.86' in t and '90.2' in t and '1.37×' in t, f"the edge's readout gives the first fringe's place and height: {t!r}")

    # In white light a phase on the aperture is a thickness of glass, so the lens (its phase in
    # proportion to k) keeps its focus for every colour, while the zone plate (an amplitude mask)
    # has f ∝ 1/λ: red at 50 × 550/650 = 42.3 mm, blue at 50 × 550/450 = 61.1 mm.
    FOCI = """(() => { const s = __app.sideData, N = 512, NZ = 96; return s.rows.map(({ I, lam }) => { let best = 4; for (let a = 4; a < NZ; a++) if (I[a * N + 256] > I[best * N + 256]) best = a; return [lam, (best + 0.5) / NZ * 2 * s.z / 1000]; }); })()"""
    def foci(setup):
        b.eval(f"__app.setups.{setup}()"); b.sleep(0.6)
        b.click('#light-box button')   # White light
        for _ in range(100):
            b.sleep(0.1)
            if b.eval("!!(__app.sideData && __app.sideData.rows.length === 3)"): break
        return dict(b.eval(FOCI))
    lens, zone = foci('lens'), foci('zone')
    check(all(abs(f - 50) < 1.5 for f in lens.values()), f'white light through the lens: red, green and blue focus together at f = 50 mm ({lens})')
    check(abs(zone[0.65] - 42.3) < 1.5 and abs(zone[0.55] - 50) < 1.5 and abs(zone[0.45] - 61.1) < 1.5, f'white light through the zone plate: f ∝ 1/λ, red at 42.3 mm, blue at 61.1 mm ({zone})')

    # The white-light experiment opens at 1 m, where the grating's orders have come apart: in each
    # colour the light beyond 5 mrad is the first order, centred at λ/d (13.5, 11.5, 9.4 mrad).
    # (At 1 m the 1.5 mm grating is still in its own near field, so each order has Fresnel
    # ripples: its centroid, not its brightest pixel.)
    b.eval("__app.setups.white()"); b.sleep(1.2)
    z = b.eval('__app.state.z')
    orders = b.eval("""(() => __app.fields.map((f) => { const N = 512, z = __app.state.z; let s = 0, m = 0;
        for (let i = 256; i < 512; i++) { const o = 256 * N + i, I = f.re[o] ** 2 + f.im[o] ** 2, th = (i - 256) * f.pitch / z * 1000; if (th > 5 && th < 25) { s += I * th; m += I; } }
        return [f.lam, s / m]; }))()""")
    check(z == 1e6 and all(abs(th - lam / 48 * 1000) < 0.15 for lam, th in orders), f'white light opens at 1 m with the first orders centred at λ/d: {[(lam, round(th, 2)) for lam, th in orders]} mrad')

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
    # As set up (z = f, linear scale, zoomed 4x) the focus is a bright spot on a dark screen;
    # so for the lens; and at f/3 and f/5 the middle is still much the brightest.
    b.eval("__app.setups.zone()"); b.sleep(0.8)
    pk, p99, mx = b.eval(SPOT)
    check(pk > 200 and mx < pk / 20, f'zone plate as set up, z = f: the focus {pk}/255, nothing beyond 30 um brighter than {mx}/255')
    for zz, factor in ((50 / 3, 20), (10, 5)):
        set_z(b, zz); pk, p99, mx = b.eval(SPOT)
        check(pk > 200 and mx < pk / factor, f'z = {zz:.3g} mm: the focus {pk}/255, beyond 30 um at most {mx}/255')
    b.eval("__app.setups.lens()"); b.sleep(0.8)
    pk, p99, mx = b.eval(SPOT)
    check(pk > 200 and mx < pk / 20, f'lens as set up, z = f: the focus {pk}/255, nothing beyond 30 um brighter than {mx}/255')
    b.eval("__app.setups.zone()"); b.sleep(0.8)
    set_z(b, 50)
    top = b.eval("(() => { const f = __app.fields[0], N = 512; let m = 0, at = 0; for (let j = 128; j < 384; j++) for (let i = 128; i < 384; i++) { const o = j * N + i, I = f.re[o] ** 2 + f.im[o] ** 2; if (I > m) { m = I; at = [i, j]; } } return at; })()")
    check(top == [256, 256], f'at z = f the brightest point is the focus, in the middle ({top})')

    # The notes and the labels on the pictures keep still as the screen moves (within one phrasing:
    # near field, or far field in mm): every number in a slot of its own.
    b.eval("__app.setups.slit()"); b.sleep(0.5)
    b.eval("""(() => { window.__words = {}; for (const id of ['field', 'side']) { const c = document.getElementById(id).getContext('2d'), fill = c.fillText.bind(c);
        c.fillText = (t, x, y) => { if (!/^[−\\d.e\\s]+$/.test(t)) { const k = id + '|' + t + '|' + Math.round(y); (__words[k] ||= new Set()).add(Math.round(x * 10) / 10); } fill(t, x, y); }; } })()""")
    NOTES = '#field-note, #field-note .fixnum, #side-note, #side-note .fixnum, #fresnel, #fresnel .fixnum, #field, #side'
    def move_to(mm):
        # The notes follow the screen a frame later (longer on a loaded machine): wait for them.
        before = b.eval("document.querySelector('#field-note').textContent")
        set_z(b, mm)
        for _ in range(300):
            if b.eval("document.querySelector('#field-note').textContent") != before: break
            b.sleep(0.1)
        b.sleep(0.3)
    # (The far field's phrasing begins at N_F = 0.1, 182 mm for this slit; the near field's ends at N_F = 3, 6.1 mm.)
    for label, zs in (('near field', (1.2, 2.5, 4, 5.9)), ('far field', (200, 300, 450, 999))):
        move_to(zs[0])
        b.eval('__words = {}')
        moves, texts = b.steady(NOTES, [lambda zz=zz: move_to(zz) for zz in zs[1:]])
        words = b.eval('Object.fromEntries(Object.entries(__words).map(([k, v]) => [k, [...v]]))')
        drift = {k: v for k, v in words.items() if max(v) - min(v) > 0.5}
        check(not moves and len(texts) == len(zs) and not drift,
              f'{label}: the notes and the words on the pictures keep still as z runs {zs[0]} ... {zs[-1]} mm ({moves[:3] or "none moved"}; words drawn in more than one place: {list(drift.items())[:3] or "none"})')

    # Fast enough to drag: one wavelength's field, near and far.
    ms = b.eval("""(async () => {
      const o = await import('/diffraction/optics.js'), a = __app.ap, t = [];
      for (const z of [3e4, 3e5]) { const t0 = performance.now(); for (let r = 0; r < 3; r++) o.diffract(a.re, a.im, 512, 8, 0.55, z); t.push((performance.now() - t0) / 3); }
      return t; })()""")
    check(max(ms) < 300, f'one field takes {ms[0]:.0f} ms near, {ms[1]:.0f} ms far (with the spectrum kept between frames, less near)')

    # A sweep of the screen for the slit, the zone plate and the hole, for looking at.
    for setup, zs in (('slit', (1, 10, 60, 200, 1000, 10000)), ('zone', (10, 16.7, 50, 300, 2000, 10000)), ('double', (5, 80, 300, 10000))):
        b.eval(f'__app.setups.{setup}()'); b.sleep(0.5)
        # The whole screen, on the compressed scale.
        b.eval("document.querySelectorAll('#scale-box .seg').forEach((s) => s.querySelector('button').click())"); b.sleep(0.3)
        for zz in zs:
            set_z(b, zz); b.sleep(0.8)
            b.screenshot(f'build/dif-sweep-{setup}-{zz:g}mm.png', selector='main')

    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
