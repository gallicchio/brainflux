#!/usr/bin/env python3
"""Drive the antenna-array and aperture-synthesis demo: every experiment, dragging, the address,
CLEAN, the Earth turning; check the physics read-outs as it goes; screenshots in build/."""
import json, math, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

INFO = """(() => { const i = __app.arrays.info, d = 180 / Math.PI;
    return { beam: i.beam === null ? null : i.beam * d, hpbw: i.hpbw === null ? null : i.hpbw * d, sll: i.sll,
             sllAngle: i.sllAngle === null ? null : i.sllAngle * d, D: __app.arrays.D, omni: i.omni }; })()"""
# Type a value into the slider whose label starts with `name`, as a student would.
SET = """((name, v) => { const s = [...document.querySelectorAll('.slider')].find((e) => !e.closest('[hidden]') && e.querySelector('label').textContent.startsWith(name));
    const box = s.querySelector('input[type=number]'); box.value = v; box.dispatchEvent(new Event('change')); return true; })"""
def setslider(b, name, v):
    b.eval(f'{SET}({json.dumps(name)}, {v})'); b.sleep(0.25)
def click(b, text, within='body'):
    b.eval(f"""[...document.querySelectorAll({json.dumps(within + ' button')})].find((x) => x.textContent.trim() === {json.dumps(text)} && !x.closest('[hidden]')).click()""")
    b.sleep(0.25)
def setup(b, name, wait=0.6):
    b.eval(f'__app.setups[{json.dumps(name)}]()'); b.sleep(wait)
def load(b, page):
    """A fresh page (going to the same address with a new hash would not reload it)."""
    b.call('Page.navigate', url='about:blank'); b.sleep(0.3)
    b.goto(page); b.wait('window.__app && __app.ready'); b.sleep(1)
def errors(b):
    return [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]

def uniform_line(n, d, t0=0):
    """Half-power width and first sidelobe of n equal elements d apart, steered to t0 (degrees)."""
    g = lambda psi: (math.sin(n * psi / 2) / (n * math.sin(psi / 2))) ** 2 if abs(math.sin(psi / 2)) > 1e-12 else 1.0
    lo, hi = 1e-9, 2 * math.pi / n
    for _ in range(80):
        m = (lo + hi) / 2
        if g(m) > 0.5: lo = m
        else: hi = m
    s0, k = math.sin(math.radians(t0)), 2 * math.pi
    th = lambda psi: math.degrees(math.asin(max(-1, min(1, s0 + psi / (k * d)))))
    sl = max(g(2 * math.pi / n + i * 1e-5) for i in range(int(2 * math.pi / n / 1e-5)))
    return th(lo) - th(-lo), 10 * math.log10(sl)

with Browser('arrays/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1.2)
    b.screenshot('build/arrays-start.png')
    i = b.eval(INFO)
    check(abs(i['beam'] - 20) < 0.01 and abs(i['D'] - 8) < 1e-6, f"opens steered to 20 degrees with D = N = 8 ({i['beam']:.3f}, {i['D']:.6f})")
    t1 = b.eval('__app.A.t'); b.sleep(0.5); t2 = b.eval('__app.A.t')
    check(t2 > t1, f'the waves are moving (t {t1:.2f} -> {t2:.2f})')

    # ---------------------------------------------------------------- the arrays experiments
    setup(b, 'two'); i = b.eval(INFO)
    check(abs(i['hpbw'] - 60) < 0.01 and abs(i['D'] - 2) < 1e-9, f"two elements lambda/2 apart: 60 degrees wide ({i['hpbw']:.3f}), D = 2 ({i['D']:.6f})")
    setup(b, 'endfire'); i = b.eval(INFO)
    check(abs(abs(i['beam']) - 90) < 0.01 and abs(i['hpbw'] - 120) < 0.05, f"end-fire: beam along the line ({i['beam']:.2f}), 120 degrees wide ({i['hpbw']:.2f})")
    setup(b, 'cardioid'); i = b.eval(INFO)
    back = b.eval("(() => { const P = __app.arrays.pattern.total; return P[900] / Math.max(...P); })()")   # theta = -90
    check(abs(i['beam'] - 90) < 0.01 and i['sll'] is None and back < 1e-12, f"the cardioid: one beam at 90 ({i['beam']:.2f}), nothing at -90 ({back:.1e}), 180 degrees wide ({i['hpbw']:.2f})")
    for n in (8, 16):
        setup(b, 'line'); setslider(b, 'N', n); i = b.eval(INFO)
        w, sl = uniform_line(n, 0.5)
        check(abs(i['hpbw'] - w) < 0.02 and abs(i['sll'] - sl) < 0.02 and abs(i['D'] - n) < 1e-6,
              f"N = {n} at lambda/2: width {i['hpbw']:.3f} (closed form {w:.3f}), sidelobe {i['sll']:.3f} dB ({sl:.3f}), D = {i['D']:.4f}")
    setup(b, 'steer')
    for t0 in (30, 60):
        setslider(b, 'θ₀', t0); i = b.eval(INFO); w, _ = uniform_line(16, 0.5, t0)
        check(abs(i['beam'] - t0) < 0.02 and abs(i['hpbw'] - w) < 0.05, f"steered to {t0}: beam {i['beam']:.3f}, width {i['hpbw']:.3f} (closed form {w:.3f})")
    setup(b, 'sweep', 1.0)
    a1 = b.eval('__app.A.theta0'); b.sleep(0.6); a2 = b.eval('__app.A.theta0')
    check(a1 != a2, f'the sweep swings the beam ({a1} -> {a2})')
    setup(b, 'grating'); i = b.eval(INFO)
    check(i['sll'] < -12, f"0.8 lambda, broadside: no grating lobe (highest sidelobe {i['sll']:.2f} dB)")
    setslider(b, 'θ₀', 30); i = b.eval(INFO)
    g = math.degrees(math.asin(0.5 - 1 / 0.8))
    check(i['sll'] > -0.01 and abs(i['sllAngle'] - g) < 0.15, f"steered to 30: a grating lobe at {i['sllAngle']:.2f} (sin theta = sin theta0 - lambda/d: {g:.2f}), {i['sll']:.4f} dB")
    check('grating lobe' in b.eval("document.querySelector('#readouts').textContent"), 'the read-out calls it a grating lobe')
    setslider(b, 'spacing', 0.64); i = b.eval(INFO)
    check(i['sll'] < -3, f"d = 0.64 < lambda / (1 + sin 30) = 0.667: the lobe is gone ({i['sll']:.2f} dB)")
    b.screenshot('build/arrays-grating-30.png')
    setup(b, 'taper')
    sl = {}
    for t in ('Uniform', 'Binomial', 'Hann', 'Taylor', 'Chebyshev'):
        click(b, t, '#tapers'); sl[t] = b.eval(INFO)
    check(abs(sl['Chebyshev']['sll'] + 30) < 0.02 and abs(sl['Taylor']['sll'] + 30) < 0.5 and sl['Hann']['sll'] < -30 and sl['Binomial']['sll'] is None,
          'tapers: ' + ', '.join(f"{t} {v['sll'] if v['sll'] is None else round(v['sll'], 2)} dB / {v['hpbw']:.2f} deg" for t, v in sl.items()))
    check(sl['Uniform']['hpbw'] < sl['Chebyshev']['hpbw'] < sl['Taylor']['hpbw'] < sl['Hann']['hpbw'] < sl['Binomial']['hpbw'], 'lower sidelobes cost a wider beam; Chebyshev is the narrowest at -30 dB')
    b.screenshot('build/arrays-taper-chebyshev.png')
    setup(b, 'dipoles'); i0 = b.eval(INFO)
    fac = b.eval("(() => { const p = __app.arrays.pattern; let w = 0; for (let k = 0; k < p.total.length; k++) w = Math.max(w, Math.abs(p.total[k] - p.af[k] * p.ef[k])); return w; })()")
    check(fac < 1e-12 and abs(i0['beam']) < 0.01, f'dipoles: the pattern is the element pattern times the array factor (to {fac:.1e}), beam straight up')
    setslider(b, 'dipole axis', 90); i = b.eval(INFO)
    check(abs(abs(i['beam']) - 50.1) < 0.3 and i['D'] < 1, f"dipoles across the line: lobes at {i['beam']:.1f} and {i['sllAngle']:.1f}, directivity in the plane {i['D']:.3f}")
    setup(b, 'random'); i = b.eval(INFO)
    floor = b.eval("""(() => { const P = __app.arrays.pattern.total, m = P.length, pmax = Math.max(...P), i = __app.arrays.info;
        let s = 0, c = 0; for (let k = 0; k < m; k++) { const t = -Math.PI + 2 * Math.PI * k / m; if (Math.abs(t - i.beam) < 3 * i.hpbw) continue; s += P[k]; c++; }
        return 10 * Math.log10(s / c / pmax); })()""")
    check(abs(floor - 10 * math.log10(1 / 24)) < 2, f'random sparse array: mean sidelobe {floor:.2f} dB, near 1/N = {10 * math.log10(1 / 24):.2f} dB; width {i["hpbw"]:.2f}')
    setup(b, 'focus', 1.0)
    f = b.eval("""(async () => { const m = await import('./antenna.js'); const els = __app.A.els, [fx, fy] = __app.A.focus;
        const [a, c] = m.fieldAt(els, { kind: 'iso' }, fx, fy); const inStep = els.reduce((s, e) => s + e.amp / (m.K * Math.hypot(fx - e.x, fy - e.y)), 0);
        return [Math.hypot(a, c), inStep]; })()""")
    check(abs(f[0] - f[1]) < 1e-12 * f[1], f'focus: every wave arrives in step ({f[0]:.6f} = {f[1]:.6f})')
    b.drag('#field', (0.5, 0.5), (0.65, 0.4), steps=8); b.sleep(0.4)
    fx, fy = b.eval('__app.A.focus')
    check(abs(fx - 3) < 0.3 and abs(fy - 2) < 0.3, f'dragging the cross moves the focus to ({fx:.2f}, {fy:.2f})')
    b.screenshot('build/arrays-focus-dragged.png')

    # Every experiment gets a picture, with no errors.
    for name in ['two', 'endfire', 'cardioid', 'line', 'steer', 'grating', 'grating2', 'taper', 'dipoles', 'random', 'focus']:
        setup(b, name, 0.8)
        b.screenshot(f'build/arrays-exp-{name}.png')

    # Dragging an element, adding one, the address.
    setup(b, 'line')
    x0 = b.eval('__app.A.els[0].x')
    b.drag('#field', ((x0 + 8) / 16, 0.5), ((x0 + 8) / 16, 0.3), steps=6); b.sleep(0.4)
    y = b.eval('__app.A.els[0].y')
    check(abs(y - 3.2) < 0.2 and b.eval('__app.A.layout') == 'custom', f'dragging an element moves it (y = {y:.2f}) and the layout becomes custom')
    x, yy = b.point('#field', (0.8, 0.8))
    for k in ('mousePressed', 'mouseReleased', 'mousePressed', 'mouseReleased'):
        b.call('Input.dispatchMouseEvent', type=k, x=x, y=yy, button='left', buttons=1 if k == 'mousePressed' else 0, clickCount=2 if k == 'mouseReleased' or True else 1)
    b.sleep(0.4)
    check(b.eval('__app.A.els.length') == 9, f"double-click adds an element ({b.eval('__app.A.els.length')})")
    click(b, 'By hand', '#phase-mode'); b.sleep(0.2)
    b.eval("__app.A.selected = 2"); b.eval("__app.arraysChanged()"); b.sleep(0.3)
    setslider(b, 'phase', 135)
    b.sleep(0.5)
    h = b.eval('location.hash')
    want = b.eval('JSON.stringify(__app.A.els.map((e) => [e.x, e.y, +e.amp.toFixed(3), +(e.phase * 180 / Math.PI).toFixed(1)]))')
    load(b, 'arrays/index.html' + h)
    got = b.eval('JSON.stringify(__app.A.els.map((e) => [e.x, e.y, +e.amp.toFixed(3), +(e.phase * 180 / Math.PI).toFixed(1)]))')
    check(got == want and b.eval('__app.A.phaseMode') == 'manual', 'the address keeps a dragged layout and a hand-set phase')
    b.eval("location.hash = 'setup=cardioid'"); b.sleep(0.8)
    check(abs(b.eval(INFO)['beam'] - 90) < 0.01, 'typing #setup=cardioid into the address sets up the cardioid')
    load(b, 'arrays/index.html#setup=focus')
    check(b.eval('__app.A.phaseMode') == 'focus', 'opening the page at #setup=focus sets up the focusing experiment')

    # ---------------------------------------------------------------- synthesis
    load(b, 'arrays/index.html')
    click(b, 'Aperture synthesis', '#mode-row'); b.sleep(2)
    b.screenshot('build/arrays-synth-start.png')
    check(b.eval('__app.state.mode') == 'synth' and b.eval('__app.S.dishes.length') == 27, 'the synthesis mode opens on a Y of 27 dishes')

    # Two dishes: the dirty image of a point at the centre is the dirty beam, a single cosine.
    setup(b, 'fringe', 1.5)
    d = b.eval("(() => { const D = __app.synth.dirty, B = __app.synth.beam; let w = 0, lo = 1; for (let i = 0; i < D.length; i++) { w = Math.max(w, Math.abs(D[i] - B[i])); lo = Math.min(lo, B[i]); } return [w, lo]; })()")
    check(d[0] < 1e-12 and abs(d[1] + 1) < 0.02, f'two dishes: dirty image = dirty beam (to {d[0]:.1e}), a cosine from +1 to {d[1]:.3f}')
    # Drag a dish: the baseline turns.
    u1 = b.eval('[__app.synth.tracks.u[0], __app.synth.tracks.v[0]]')
    b.drag('#map', (0.9, 0.35), (0.9, 0.1), steps=6); b.sleep(0.8)
    u2 = b.eval('[__app.synth.tracks.u[0], __app.synth.tracks.v[0]]')
    check(abs(u2[1] - u1[1]) > 50, f'dragging a dish north changes the baseline (v {u1[1]:.0f} -> {u2[1]:.0f} m)')
    setup(b, 'six', 1.5)
    check(b.eval('__app.synth.tracks.nb') == 15, 'six dishes: 15 baselines')

    # East-west line: circles at the pole, ellipses of axis ratio sin(dec) elsewhere.
    for name, dec in (('ellipses', 90), ('equator', 5)):
        setup(b, name, 1.5)
        r = b.eval("""(() => { const t = __app.synth.tracks; let worst = 0, sd = Math.sin(__app.S.dec * Math.PI / 180);
            for (let p = 0; p < t.nb; p++) { let B = 0; for (let k = 0; k < t.nt; k++) B = Math.max(B, Math.abs(t.u[p * t.nt + k]));
              for (let k = 0; k < t.nt; k++) { const u = t.u[p * t.nt + k], v = t.v[p * t.nt + k]; worst = Math.max(worst, Math.abs(Math.hypot(u, v / sd) - B) / B); } }
            return worst; })()""")
        # (Not exactly: on the curved Earth an east-west line of dishes isn't quite level, which
        # shifts the ellipses by about E^2 / 2R; at low declination that is 1e-3 of the minor axis.)
        check(r < 2e-3, f'east-west line at declination {dec}: every track is an ellipse of axis ratio sin(dec) (worst {r:.1e})')
        b.screenshot(f'build/arrays-synth-{name}.png')
    fit = b.eval('[__app.synth.fit.major, __app.synth.fit.minor]')
    check(fit[0] > 5 * fit[1], f'near the equator the beam is a streak ({fit[0]:.1f} x {fit[1]:.1f} pixels)')

    # Resolution: the double separates as the longest baseline grows.
    setup(b, 'resolution', 1.5)
    DIP = """(() => { const d = __app.synth.dirty, n = 256, sky = __app.synth.sky; const pts = []; for (let i = 0; i < sky.length; i++) if (sky[i] > 0) pts.push([i % n, Math.floor(i / n)]);
        const [a, c] = pts; let lo = 1e9; for (let t = 0.2; t <= 0.8; t += 0.02) lo = Math.min(lo, d[Math.round(a[1] + t * (c[1] - a[1])) * n + Math.round(a[0] + t * (c[0] - a[0]))]);
        return lo / Math.min(d[a[1] * n + a[0]], d[c[1] * n + c[0]]); })()"""
    r1 = b.eval(DIP)
    setslider(b, 'longest', 1.4); b.sleep(1)
    r2 = b.eval(DIP)
    check(r1 > 1 and r2 < 0.45, f'the double: one blob at 1.04 km (ratio {r1:.2f}), separated at 1.4 km (dip {r2:.2f} of the fainter peak)')
    b.screenshot('build/arrays-synth-resolved.png')

    # Short spacings: nothing measures u = v = 0, so the dirty image adds up to zero.
    setup(b, 'shortspacing', 1.5)
    s = b.eval('[__app.synth.dirty.reduce((a, v) => a + v, 0), Math.min(...__app.synth.dirty)]')
    s = b.eval('[__app.synth.dirty.reduce((a, v) => a + v, 0), Math.min(...__app.synth.dirty) / Math.max(...__app.synth.dirty)]')
    check(abs(s[0]) < 1e-9 and s[1] < -0.1, f'short spacings missing: the dirty image adds up to {s[0]:.1e}, and its negative bowl goes down to {s[1]:.2f} of its peak')

    # CLEAN finds the double's fluxes at the right pixels.
    setup(b, 'clean', 1.5)
    click(b, 'Step', '#clean-box'); click(b, 'Step', '#clean-box')
    check(b.eval('__app.synth.cs.iterations') == 2, 'Step takes one CLEAN step')
    click(b, 'Run', '#clean-box')
    b.wait('!__app.S.running', timeout=120); b.sleep(0.5)
    c = b.eval("""(() => { const cs = __app.synth.cs, sky = __app.synth.sky, out = []; for (let i = 0; i < sky.length; i++) if (sky[i] > 0) out.push([sky[i], cs.model[i]]);
        return { pairs: out, total: cs.model.reduce((a, v) => a + v, 0), comps: cs.components, it: cs.iterations }; })()""")
    check(c['comps'] == 2 and all(abs(m - t) < 0.01 for t, m in c['pairs']), f"CLEAN: {c['comps']} components in {c['it']} steps, fluxes {[(round(t, 3), round(m, 4)) for t, m in c['pairs']]} (true, found)")
    for show in ('Residual', 'Components', 'Restored'):
        click(b, show, '#clean-show')
    b.screenshot('build/arrays-synth-clean.png')

    # The Event Horizon Telescope: Earth-sized baselines.
    setup(b, 'eht', 2)
    lb = b.eval("document.querySelector('#obs-note').textContent").replace('\u00a0', ' ')
    check('12700 km' in lb and '21.2 µas' in lb, 'the EHT: longest baseline 12,700 km, lambda/B = 21 microarcseconds')
    broken = b.eval("(() => { const t = __app.synth.tracks; let n = 0; for (let i = 1; i < t.ok.length; i++) if (t.ok[i] !== t.ok[i - 1] && i % t.nt) n++; return n; })()")
    check(broken > 10, f'its tracks break where the source sets for a station ({broken} breaks)')
    b.screenshot('build/arrays-synth-eht.png')

    # The Earth turns: the observation replays and finishes.
    setup(b, 'rotation', 1.5)
    snap = b.eval('__app.synth.tracks.nt')
    click(b, 'Turn the Earth', '#earth-box'); b.sleep(4)
    mid = b.eval('[__app.S.playing, __app.S.tNow]')
    b.screenshot('build/arrays-synth-turning.png')
    b.wait('!__app.S.playing', timeout=60); b.sleep(0.5)
    check(snap == 1 and mid[0] and 0 < mid[1] < 1 and b.eval('__app.S.tNow') == 1 and b.eval('__app.S.hours') == 12,
          f'Turn the Earth: from a snapshot to 12 hours (halfway at {mid[1]:.2f})')
    b.screenshot('build/arrays-synth-rotation-12h.png')
    h = b.eval('location.hash')
    check('mode=synth' in h and 'hours=12' in h, f'the address keeps the observation ({h[:60]}...)')

    # A typed sky: its parameters are sliders, and it is kept in the address.
    click(b, 'Typed', '#skies'); b.sleep(1)
    m1 = b.eval("(() => { const s = __app.synth.sky, n = 256; let m = 0; for (let i = 0; i < s.length; i++) m += s[i] * Math.abs((i % n) - n / 2); return m; })()")
    setslider(b, 'a', 4); b.sleep(1)
    m2 = b.eval("(() => { const s = __app.synth.sky, n = 256; let m = 0; for (let i = 0; i < s.length; i++) m += s[i] * Math.abs((i % n) - n / 2); return m; })()")
    check(m2 > 1.5 * m1 and abs(b.eval('__app.synth.sky.reduce((a, v) => a + v, 0)') - 1) < 1e-9, f'typed sky: sliding a moves the lobes out (mean |x| {m1:.1f} -> {m2:.1f} pixels), total flux 1')
    check('Ip=a%3A4' in b.eval('location.hash'), 'the typed sky and its parameters are in the address')
    b.screenshot('build/arrays-synth-typed.png')

    for name in ['fringe', 'six', 'rotation', 'ellipses', 'equator', 'resolution', 'shortspacing', 'eht', 'clean']:
        setup(b, name, 1.5)
        b.screenshot(f'build/arrays-exp-{name}.png')
    e = errors(b)
    check(not e, 'no exceptions or console errors' + ('' if not e else ': ' + '; '.join(e[:3])))

# Phone width: the controls go under the pictures.
with Browser('arrays/index.html', size=(400, 850)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1)
    b.screenshot('build/arrays-phone.png')
    w = b.eval('[document.documentElement.scrollWidth, innerWidth]')
    check(w[0] <= w[1], f'no sideways scrolling at phone width ({w[0]} <= {w[1]})')
    top = b.eval("[document.querySelector('#arrays-controls').getBoundingClientRect().top, document.querySelector('#polar').getBoundingClientRect().bottom]")
    check(top[0] > top[1], 'the controls stack under the pictures')
    b.eval("__app.setups.eht()"); b.sleep(2)
    b.screenshot('build/arrays-phone-synth.png')
    w = b.eval('[document.documentElement.scrollWidth, innerWidth]')
    check(w[0] <= w[1], f'synthesis: no sideways scrolling at phone width ({w[0]} <= {w[1]})')
    e = errors(b)
    check(not e, 'no errors at phone width' + ('' if not e else ': ' + '; '.join(e[:3])))

print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
