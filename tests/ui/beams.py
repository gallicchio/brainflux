#!/usr/bin/env python3
"""Drive the Gaussian-beam demo like a student: every experiment, dragging a lens, the input
waist and the stability diagram, and the physics read-outs on the way (focus size, the Gouy
shift in the drawn crests, the Gaussian lens law, mode matching, the cavity mode, rays, the FFT
check).  Screenshots go to build/.  SIZE=400x850 TAG=-phone for a phone-sized run."""
import json, math, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

SIZE = tuple(int(v) for v in os.environ.get('SIZE', '1400x900').split('x'))
TAG = os.environ.get('TAG', '')
LAM = 633e-6

def waists(b):
    return b.eval("import('/beams/gauss.js').then(g => g.waists(__app.bench.trace).map(w => ({ z: w.z, w0: w.w0, zR: w.zR, real: w.real })))")

with Browser('beams/index.html', size=SIZE) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1)
    b.screenshot(f'build/beams{TAG}-start.png')
    full = SIZE[0] >= 1000

    # ---------------------------------------------------------------- the bench, by hand
    ws = waists(b)
    focus0 = ws[1]['z']
    # Drag the lens (at z = 100 of -20..420) 60 mm to the right: the focus follows it.
    F = b.eval('(() => { const f = __app.bench.frame; return [f.left, f.w, f.top, f.h, f.x0, f.x1]; })()')
    box = b.box('#bench')
    fx = lambda z: (F[0] + (z - F[4]) / (F[5] - F[4]) * F[1]) / box[2]
    fy = (F[2] + 0.3 * F[3]) / box[3]
    b.drag('#bench', (fx(100), fy), (fx(160), fy), steps=10); b.sleep(0.3)
    zl = b.eval('__app.state.bench.elements[0].z')
    ws = waists(b)
    check(abs(zl - 160) < 2 and abs((ws[1]['z'] - focus0) - (zl - 100)) < 1, f'dragging the lens to z = {zl:.1f} mm moves the focus with it ({focus0:.1f} -> {ws[1]["z"]:.1f} mm)')
    # Drag the input waist's handle down: a smaller waist.
    w_before = b.eval('__app.state.bench.w0')
    hy = lambda x: (F[2] + F[3] / 2 - x * b.eval('__app.state.bench.E') * F[1] / (F[5] - F[4])) / box[3]
    b.drag('#bench', (fx(0), hy(w_before)), (fx(0), hy(w_before / 2)), steps=8); b.sleep(0.3)
    w_after = b.eval('__app.state.bench.w0')
    check(abs(w_after - w_before / 2) < 0.03 * w_before, f'dragging the handle sets the input waist ({1000 * w_before:.0f} -> {1000 * w_after:.0f} um)')
    # Add a slab and a mirror, remove the mirror.
    n0 = b.eval('__app.state.bench.elements.length')
    b.eval("[...document.querySelectorAll('#add-box button')].find(x => x.textContent.includes('Slab')).click()")
    b.eval("[...document.querySelectorAll('#add-box button')].find(x => x.textContent.includes('Mirror')).click()")
    n1 = b.eval('__app.state.bench.elements.length')
    b.eval("[...document.querySelectorAll('#el-editor .sign-seg button')].find(x => x.textContent === 'flat').click()"); b.sleep(0.2)
    flat = b.eval('[__app.state.bench.sel.R, document.querySelector(".lens-plot-wrap").hidden, document.querySelector("#el-info").textContent]')
    check(flat[0] is None and flat[1], f'a flat mirror: R = infinity (JSON null), no lens-law plot; "{flat[2][:60]}"')
    b.eval("document.querySelector('#el-editor .remove').click()")
    n2 = b.eval('__app.state.bench.elements.length')
    check(n1 == n0 + 2 and n2 == n0 + 1, f'adding a slab and a mirror, removing the mirror ({n0} -> {n1} -> {n2} elements)')
    b.screenshot(f'build/beams{TAG}-edited.png')
    # Pan and zoom.
    v0 = b.eval('[__app.state.bench.vz0, __app.state.bench.vz1]')
    b.drag('#bench', (fx(380), 0.92 * F[3] / box[3]), (fx(300), 0.92 * F[3] / box[3]), steps=6)
    v1 = b.eval('[__app.state.bench.vz0, __app.state.bench.vz1]')
    check(v1[0] > v0[0] + 10 and abs((v1[1] - v1[0]) - (v0[1] - v0[0])) < 1e-6, f'dragging the background pans ({v0[0]:.0f}..{v0[1]:.0f} -> {v1[0]:.0f}..{v1[1]:.0f} mm)')

    # ---------------------------------------------------------------- the experiments
    for name in b.eval('Object.keys(__app.setups)'):
        b.eval(f'__app.setups[{json.dumps(name)}]()'); b.sleep(1.0)
        b.screenshot(f'build/beams{TAG}-exp-{name}.png')

    b.eval('__app.setups.waist()'); b.sleep(0.2)
    ws = waists(b)
    zR = math.pi * 0.2 ** 2 / LAM
    check(abs(ws[0]['zR'] - zR) < 1e-6 * zR and abs(zR - 198.5) < 0.1, f'waist: z_R = pi w0^2/lambda = {ws[0]["zR"]:.1f} mm')

    b.eval('__app.setups.focus()'); b.sleep(0.2)
    ws = waists(b)
    est = LAM * 100 / (math.pi * 1.0)
    check(abs(ws[1]['w0'] - est) < 1e-3 * est, f'focus: w0\' = {1000 * ws[1]["w0"]:.2f} um against lambda f / pi w = {1000 * est:.2f} um')
    info = b.eval("document.querySelector('#el-info').textContent")
    check('20.1 µm' in info, f'the lens panel quotes the focus: "{info[:120]}..."')
    b.eval("(() => { const n = document.querySelectorAll('#laser-box input[type=number]')[1]; n.value = 2000; n.dispatchEvent(new Event('change')); })()"); b.sleep(0.2)
    ws = waists(b)
    check(abs(1000 * ws[1]['w0'] - 10.07) < 0.01, f'focus: typing w0 = 2000 um halves the spot, to {1000 * ws[1]["w0"]:.2f} um')

    # The Gouy phase in the drawn crests: on the axis, the field's phase across the zoomed view
    # is the carrier minus the Gouy phase, and the Gouy phase changes by 2 atan 4.
    b.eval('__app.setups.gouy()'); b.sleep(0.3)
    r = b.eval("""(() => { const f = __app.bench.computeField(), pw = f.pw, row = Math.floor(f.ph / 2);
        const ph = (i) => Math.atan2(f.im[row * pw + i], f.re[row * pw + i]);
        let acc = 0;   // unwrap the phase minus the carrier along the axis
        for (let i = 1; i < pw; i++) { let d = (ph(i) - ph(i - 1)) - (f.cref[i] - f.cref[i - 1]); d -= 2 * Math.PI * Math.round(d / (2 * Math.PI)); acc += d; }
        const t = __app.bench.trace, s = __app.state.bench;
        return { acc, pw }; })()""")
    g = b.eval("import('/beams/gauss.js').then(g => { const s = __app.state.bench, t = __app.bench.trace, f = __app.bench.field, dz = (s.vz1 - s.vz0) / f.pw; return g.beamAt(t, s.vz1 - dz / 2).gouy - g.beamAt(t, s.vz0 + dz / 2).gouy; })")
    check(abs(-r['acc'] - g) < 0.01 and abs(g - 2 * math.atan(4)) < 0.01, f'gouy: along the axis the drawn field lags the plane wave by {-r["acc"] / math.pi:.3f} pi, its crests ahead: the Gouy phase {g / math.pi:.3f} pi (2 atan 4 = {2 * math.atan(4) / math.pi:.3f} pi)')

    b.eval('__app.setups.telescope()'); b.sleep(0.2)
    ws = waists(b)
    check(abs(ws[2]['w0'] / 0.5 - 4) < 0.004, f'telescope: the beam comes out {ws[2]["w0"] / 0.5:.4f} times wider (f2/f1 = 4)')

    b.eval('__app.setups.imaging()'); b.sleep(0.2)
    ws = waists(b)
    s, f, zr = 100, 50, math.pi * 0.1 ** 2 / LAM
    s2 = f + f * f * (s - f) / ((s - f) ** 2 + zr ** 2)
    check(abs((ws[1]['z'] - 100) - s2) < 1e-6 and abs(s2 - 75.19) < 0.01, f'imaging: the waist lands {ws[1]["z"] - 100:.2f} mm after the lens (Self: {s2:.2f}; rays: 100)')

    b.eval('__app.setups.slab()'); b.sleep(0.2)
    ws = waists(b)
    b.eval("__app.bench.removeElement(__app.state.bench.elements[1])"); b.sleep(0.1)
    ws0 = waists(b)
    check(abs((ws[-1]['z'] - ws0[-1]['z']) - 40 * (1 - 1 / 1.5)) < 1e-6, f'slab: the focus moves {ws[-1]["z"] - ws0[-1]["z"]:.3f} mm (t(1 - 1/n) = 13.333)')

    b.eval('__app.setups.waveguide()'); b.sleep(0.2)
    ws = waists(b)
    spread = max(w['w0'] for w in ws) / min(w['w0'] for w in ws) - 1
    check(spread < 1e-9 and len(ws) == 7, f'lens row: the cavity mode repeats after every lens ({len(ws)} waists equal to {spread:.1e})')
    b.eval("(() => { const n = document.querySelectorAll('#laser-box input[type=number]')[1]; n.value = 300; n.dispatchEvent(new Event('change')); })()"); b.sleep(0.2)
    wr = b.eval("""import('/beams/gauss.js').then(g => { const t = __app.bench.trace, out = [];
        for (const [a, b] of [[0, 450], [450, 900]]) { let lo = Infinity, hi = 0; for (let z = a; z <= b; z += 0.5) { const w = g.beamAt(t, z).w; lo = Math.min(lo, w); hi = Math.max(hi, w); } out.push([lo, hi]); }
        return out; })""")
    check(abs(wr[1][1] / wr[0][1] - 1) < 0.05 and abs(wr[1][0] / wr[0][0] - 1) < 0.05,
          f'lens row: a 300 um beam breathes between {1000 * wr[0][0]:.0f} and {1000 * wr[0][1]:.0f} um in the first half of the row, {1000 * wr[1][0]:.0f} and {1000 * wr[1][1]:.0f} um in the second: bounded')

    b.eval('__app.setups.matching()'); b.sleep(0.2)
    eta0 = b.eval('__app.bench.matching().eta')
    b.eval("(() => { const e = __app.state.bench.elements[0]; e.z = 324; e.f = 254; __app.bench.select(e); })()")
    b.eval("__app.bench.refreshTarget()")
    eta1 = b.eval('__app.bench.matching().eta')
    check(abs(eta0 - 0.690) < 0.001 and eta1 > 0.9999, f'mode matching: eta = {100 * eta0:.1f}% at first, {100 * eta1:.3f}% with f = 254 mm at z = 324 mm')
    b.eval('__app.setups.matching()'); b.sleep(0.5)
    b.screenshot(f'build/beams{TAG}-matching.png')

    # ---------------------------------------------------------------- the cavity
    b.eval('__app.setups.stability()'); b.sleep(0.3)
    m = b.eval("import('/beams/cavity.js').then(c => { const s = __app.state.cavity, [g1, g2] = c.gParams(s.L, s.R1, s.R2), m = __app.cavity.mode, cf = c.closedForms(s.L, g1, g2, 633e-6); return { g1, g2, w0: m.w0, cw0: cf.w0, gouy: m.gouy, cg: cf.gouy }; })")
    check(abs(m['w0'] - m['cw0']) < 1e-9 and abs(m['gouy'] - m['cg']) < 1e-9, f'stability: g1 = {m["g1"]}, g2 = {m["g2"]}; mode w0 = {1000 * m["w0"]:.1f} um and psi1 = {m["gouy"] / math.pi:.4f} pi as in the textbook')
    # Drag the point on the stability diagram, first to (-0.5, -1.4), stable (g1 g2 = 0.7),
    # then to (-0.5, 1.4), unstable (g1 g2 < 0).
    sf = b.eval("(() => { const c = document.querySelector('#stability'), r = c.getBoundingClientRect(); return [r.width, r.height]; })()")
    size = min(sf[0] - 50, sf[1] - 44); left = (sf[0] - (size + 50)) / 2 + 40; top = 14   # as in cavity-view.js
    X = lambda g: (left + (g + 2.2) / 4.4 * size) / sf[0]
    Y = lambda g: (top + (2.2 - g) / 4.4 * size) / sf[1]
    for (t1, t2, stable) in [(-0.5, -1.4, True), (-0.5, 1.4, False)]:
        st = b.eval('__app.state.cavity')
        g1, g2 = 1 - st['L'] / st['R1'], 1 - st['L'] / st['R2']
        b.drag('#stability', (X(g1), Y(g2)), (X(t1), Y(t2)), steps=8); b.sleep(0.3)
        st = b.eval('__app.state.cavity')
        g1, g2 = 1 - st['L'] / st['R1'], 1 - st['L'] / st['R2']
        has = b.eval('!!__app.cavity.mode')
        check(abs(g1 - t1) < 0.05 and abs(g2 - t2) < 0.05 and has == stable,
              f'dragging the point to (g1, g2) = ({g1:.2f}, {g2:.2f}): R1 = {st["R1"]:.0f}, R2 = {st["R2"]:.0f} mm, g1 g2 = {g1 * g2:.2f}, {"a mode" if has else "no mode"}')
    b.screenshot(f'build/beams{TAG}-cav-dragged.png')
    # The keyboard: arrows move the point.
    b.eval('__app.setups.stability()'); b.sleep(0.2)
    b.eval("document.querySelector('#stability').focus()")
    b.key('ArrowLeft'); b.key('ArrowLeft'); b.key('ArrowUp')
    st = b.eval('__app.state.cavity')
    g1, g2 = 1 - st['L'] / st['R1'], 1 - st['L'] / st['R2']
    check(abs(g1 - 0.71) < 1e-3 and abs(g2 - 0.52) < 1e-3, f'arrow keys move the point: (0.75, 0.5) -> ({g1:.3f}, {g2:.3f})')
    b.eval("document.querySelector('#bench')?.blur()")
    b.eval('__app.setups.rays()'); b.sleep(0.2)
    b.eval('__app.state.cavity.play = false; __app.cavity.launch(); for (let k = 0; k < 400; k++) __app.cavity.step();')
    rr = b.eval("(() => { const s = __app.state.cavity, L = s.L, sc = Math.sqrt(633e-6 * L / Math.PI); return __app.cavity.rays.map(r => ({ lost: r.lost, big: Math.max(...r.hits.map(Math.abs)) / sc })); })()")
    check(all(not x['lost'] and x['big'] < 1.5 for x in rr), f'rays in the stable cavity stay near the axis for 200 round trips (largest {max(x["big"] for x in rr):.2f} sqrt(lambda L/pi))')
    # The hits on mirror 1 go round an ellipse by 2 psi1 per round trip.  In the normal
    # coordinates of the mode at mirror 1 (q1 = z + i zR: u = x, v = zR theta - z (theta - x/...)),
    # simplest: the ellipse is invariant, x^2 / w^2-like; measure the angle with the mode's q:
    # u = x, v = q1.re * theta - x ... we use the exact invariant form below.
    rot = b.eval("""import('/beams/cavity.js').then(c => {
        const s = __app.state.cavity, md = c.eigenmode(s.L, s.R1, s.R2, 633e-6), z = md.q1.re, zR = md.q1.im;
        // For q = z + i zR, the ray (x, t) has the phase-space angle atan2(zR t, x - z t):
        // the round trip turns it by -2 psi1 (mod 2 pi).
        const ang = ([x, t]) => Math.atan2(zR * t, x - z * t);
        const ph = __app.cavity.rays[0].phase, d = [];
        for (let k = 1; k < ph.length; k++) { let a = ang(ph[k]) - ang(ph[k - 1]); a -= 2 * Math.PI * Math.round(a / (2 * Math.PI)); d.push(Math.abs(a)); }
        const [A, , , D] = c.roundTrip(s.L, s.R1, s.R2);
        return { cos: (A + D) / 2, psi: md.gouy, step: d.reduce((p, q) => p + q, 0) / d.length, spread: Math.max(...d) - Math.min(...d) }; })""")
    expect = min(2 * rot['psi'], 2 * math.pi - 2 * rot['psi'])
    check(abs(rot['cos'] - math.cos(2 * rot['psi'])) < 1e-9 and abs(rot['step'] - expect) < 1e-9 and rot['spread'] < 1e-9,
          f'rays: each round trip turns a ray round its ellipse by {rot["step"] / math.pi:.4f} pi = 2 psi1 (cos 2 psi1 = (A+D)/2 = {rot["cos"]:.4f})')
    b.eval("[...document.querySelectorAll('#cav-presets button')].find(x => x.textContent === 'Unstable').click()"); b.sleep(0.1)
    b.eval('__app.state.cavity.play = false; __app.cavity.launch(); for (let k = 0; k < 60; k++) __app.cavity.step();')
    lost = b.eval('__app.cavity.rays.map(r => r.lost)')
    check(all(x > 0 for x in lost), f'rays in the unstable cavity (R = 100 mm, L = 250 mm) are lost after {lost} round trips')
    b.eval("(() => { const p = [...document.querySelectorAll('#ray-box button')].find(x => x.textContent === 'Play'); if (p) p.click(); __app.cavity.launch(); })()"); b.sleep(0.25)
    b.screenshot(f'build/beams{TAG}-cav-unstable.png')
    b.eval('__app.setups.confocal()'); b.sleep(0.2)
    g = b.eval('__app.cavity.mode.gouy')
    spec = b.eval('[...document.querySelectorAll("#cav-numbers dd")].map(d => d.textContent).join(" | ")')
    check(abs(g - math.pi / 2) < 1e-12 and '300 MHz' in spec and '600 MHz' in spec, f'confocal: psi1 = pi/2, transverse spacing half the FSR ({spec})')
    b.eval('__app.cavity.set({ R1: 280, R2: 280 })'); b.sleep(0.1)
    g = b.eval('__app.cavity.mode && __app.cavity.mode.gouy')
    check(g and abs(g / math.pi - 0.4659) < 1e-3, f'R1 = R2 = 280 mm: psi1 = {g / math.pi:.4f} pi, the orders split by {0.5 - g / math.pi:.3f} FSR per order')
    for (r1, r2, want) in [(250, 260, False), (260, 240, False)]:
        b.eval(f'__app.cavity.set({{ R1: {r1}, R2: {r2} }})'); b.sleep(0.1)
        check(b.eval('!!__app.cavity.mode') == want, f'R1 = {r1}, R2 = {r2} mm: {"a mode" if want else "no mode (on the edge, or unstable)"}')

    # ---------------------------------------------------------------- the modes
    b.eval('__app.setups.donut()'); b.sleep(0.3)
    c = b.eval("(() => { const cv = document.querySelector('#cross'), ctx = cv.getContext('2d'); const d = (x, y) => Array.from(ctx.getImageData(Math.round(cv.width * x), Math.round(cv.height * y), 1, 1).data.slice(0, 3)); return [d(0.5, 0.5), d(0.5 + 0.13, 0.5)]; })()")
    check(sum(c[0]) < 60 and sum(c[1]) > 200, f'the donut is dark in the middle {c[0]} and bright on its ring {c[1]}')
    b.eval('__app.setups.fft()'); b.sleep(0.5)
    fftr = b.eval('(() => { const f = __app.modes.computeFFT(); return { err: f.err, mag: f.mag, ph: f.ph }; })()')
    check(fftr['err'] < 0.003 and abs(fftr['mag'] - 1) < 1e-4 and abs(fftr['ph']) < 2e-3, f'FFT check: HG31 at 1.5 zR differs from the formula by {100 * fftr["err"]:.3f}% of the peak; Gouy phase off by {fftr["ph"]:.1e} rad')
    note = b.eval("document.querySelector('#fft-note').textContent")
    check('1.564π' in note, f'the panel quotes the measured Gouy phase: "{note[:160]}"')
    b.eval("(() => { __app.state.modes.travel = true; })()"); b.eval('__app.setView("modes")'); b.sleep(1.0)
    b.screenshot(f'build/beams{TAG}-modes-travel.png')

    # ---------------------------------------------------------------- the address
    def load(page):
        b.call('Page.navigate', url='about:blank'); time.sleep(0.3)
        b.goto(page); b.wait('window.__app && __app.ready'); b.sleep(0.5)
    b.eval('__app.setups.telescope()'); b.sleep(0.5)
    b.eval("(() => { const e = __app.state.bench.elements[1]; e.z = 312.5; __app.bench.select(e); __app.state.bench.bright = 0.5; })()")
    b.eval('__app.state.cavity.R2 = 777; __app.state.modes.l = 3; __app.hashSoon()'); b.sleep(0.6)
    url = b.eval('location.href')
    load('beams/index.html' + url[url.index('#'):])
    els = b.eval('__app.state.bench.elements.map(e => [e.type, e.z, e.f])')
    same = (els == [['lens', 50, 50], ['lens', 312.5, 200]] and b.eval('__app.state.bench.field') == 'intensity'
            and b.eval('__app.state.cavity.R2') == 777 and b.eval('__app.state.bench.sel === __app.state.bench.elements[1]'))
    check(same, f'a reload from the address keeps the set-up: {els}, R2 = {b.eval("__app.state.cavity.R2")}')
    load('beams/index.html#setup=confocal')
    check(b.eval('__app.state.view') == 'cavity' and b.eval('__app.state.cavity.R1') == 250, '#setup=confocal opens the confocal cavity')
    load('beams/index.html#v=modes&fam=lg&i=1,-2&z=0.7')
    check(b.eval('[__app.state.view, __app.state.modes.p, __app.state.modes.l, __app.state.modes.zeta]') == ['modes', 1, -2, 0.7], 'an address opens a Laguerre-Gauss mode at 0.7 zR')

    # ---------------------------------------------------------------- speed
    b.goto('beams/index.html'); b.wait('window.__app && __app.ready'); b.sleep(0.5)
    t = b.eval("""(() => { const s = __app.state.bench, e = s.elements[0]; let t0 = performance.now();
        for (let k = 0; k < 20; k++) { e.z = 100 + k; __app.bench.computeField(); __app.bench.drawBench(); }
        const drag = (performance.now() - t0) / 20; t0 = performance.now();
        for (let k = 0; k < 40; k++) __app.bench.drawBench();
        return { drag, frame: (performance.now() - t0) / 40 }; })()""")
    check(t['drag'] < 33 and t['frame'] < 16, f'speed: a drag step redraws in {t["drag"]:.1f} ms, an animation frame in {t["frame"]:.1f} ms')

    # ---------------------------------------------------------------- dark
    if full:
        b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
        for name in ['start', 'stability', 'hermite']:
            b.eval(f'__app.setups[{json.dumps(name)}]()'); b.sleep(0.8)
            b.screenshot(f'build/beams-dark-{name}.png')
        b.eval("document.querySelector('#help-button').click()"); b.sleep(0.5)
        b.screenshot('build/beams-dark-help.png')

    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
