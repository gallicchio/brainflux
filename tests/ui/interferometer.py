#!/usr/bin/env python3
"""Drive the interferometer demo: the mirror, the spectrum, the spectrometer, the stellar
interferometer, every experiment, the address, and the phone layout."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

def frac(p, pt):
    return (pt[0] / p['w'], pt[1] / p['h'])

with Browser('interferometer/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1.5)
    b.screenshot('build/ifm-start.png')
    # It opens doing something: the motor moves the mirror and fringes pass the detector.
    D0 = b.eval('__app.D()'); b.sleep(1.5); D1 = b.eval('__app.D()')
    check(D1 > D0, f'the motor runs at the start (Δ {D0:.4f} -> {D1:.4f} μm)')
    fps = b.eval("""new Promise((res) => { let n = 0; const t0 = performance.now();
      const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); };
      requestAnimationFrame(f); })""")
    print(f'      {fps:.0f} frames per second while the motor runs (headless, no GPU)')

    # The fringe counter: 10 μm of mirror travel with the laser is 2 x 10 / 0.6328 = 31.6 fringes.
    b.eval('__app.setups.count()')
    n = b.eval("""(() => { const M = __app.M, d0 = M.state.dc + M.state.df;
      while (M.state.dc + M.state.df - d0 < 10) M.tick(0.01); return __app.counter().count; })()""")
    check(n in (31, 32), f'the counter: {n} fringes for 10 μm of mirror travel (2d/λ = 31.6)')

    # Drag the mirror's body, its fine knob and its tilt handle.
    b.eval('__app.setups.tilt()'); b.sleep(0.3)
    p = b.eval('__app.M.schemPoints()')
    d0 = b.eval('__app.M.state.dc + __app.M.state.df')
    b.drag('#schematic', frac(p, p['body']), frac(p, [p['body'][0] + 25, p['body'][1]]), steps=8); b.sleep(0.2)
    d1 = b.eval('__app.M.state.dc + __app.M.state.df')
    check(d1 > d0 + 0.5, f'dragging M2 moves it ({d0:.3f} -> {d1:.3f} μm)')
    p = b.eval('__app.M.schemPoints()')
    f0 = b.eval('__app.M.state.dc + __app.M.state.df')
    b.drag('#schematic', frac(p, p['knob']), frac(p, [p['knob'][0], p['knob'][1] - 50]), steps=10); b.sleep(0.2)
    f1 = b.eval('__app.M.state.dc + __app.M.state.df')
    check(abs((f1 - f0) - 0.2) < 0.03, f'the fine knob: 50 px up moves the mirror {1000 * (f1 - f0):.1f} nm (4 nm per px)')
    p = b.eval('__app.M.schemPoints()')
    t0 = b.eval('__app.M.state.tilt')
    b.drag('#schematic', frac(p, p['top']), frac(p, [p['top'][0] + 30, p['top'][1] + 5]), steps=6); b.sleep(0.2)
    t1 = b.eval('__app.M.state.tilt')
    check(t1 > t0 + 50, f'dragging the top of M2 tilts it ({t0:.0f} -> {t1:.0f} μrad)')

    # Click on the interferogram: the mirror goes there, and the detector records the sweep.
    b.eval('__app.setups.white()'); b.eval('__app.M.setMotor("stop")'); b.sleep(0.3)
    # White light: visible fringes only within a few μm of zero path; the screen is coloured.
    b.eval('__app.M.setPath(0.3, false)'); b.sleep(0.4)
    colours = b.eval("""(() => { const c = document.getElementById('screen'), x = c.getContext('2d');
      const d = x.getImageData(0, c.height / 2, c.width, 1).data, set = new Set();
      for (let i = 0; i < d.length; i += 16) set.add(((d[i] >> 5) << 6) | ((d[i + 1] >> 5) << 3) | (d[i + 2] >> 5)); return set.size; })()""")
    check(colours > 12, f'white-light fringes are coloured ({colours} distinct colours across the screen)')
    b.click('#trace', (0.9, 0.5)); b.sleep(0.3)
    Dc = b.eval('__app.D()'); rec = b.eval('__app.record()')
    check(2.5 < Dc < 4 and rec and rec[-1][1] >= Dc - 1e-9, f'clicking the interferogram moves the mirror to Δ = {Dc:.3f} μm and records the way')
    v = b.eval('[__app.visibilityAt(0.5), __app.visibilityAt(3)]')
    check(v[0] > 0.4 and v[1] < 0.1, f'white light: visibility {v[0]:.2f} at 0.5 μm, {v[1]:.3f} at 3 μm')

    # The sodium doublet: beats of period λ²/Δλ; equalising the lines makes the fringes vanish.
    b.eval('__app.setups.sodium()'); b.eval('__app.M.setMotor("stop")'); b.sleep(0.4)
    vmin = b.eval('__app.visibilityAt(290.85)')
    check(abs(vmin - 1 / 3) < 2e-3, f'sodium: visibility {vmin:.4f} at Δ = 290.85 μm (lines 2 : 1 give 1/3)')
    h = b.eval('__app.M.lineHandlePoints()')
    weak = max(h['handles'], key=lambda q: q[1])   # the lower dot (larger y) is the weaker line
    strong = min(h['handles'], key=lambda q: q[1])
    b.drag('#spectrum', frac(h, weak[:2]), frac(h, [weak[0], strong[1]]), steps=8); b.sleep(0.3)
    A = b.eval('__app.spectrum().lines.map((l) => l.A)')
    vmin2 = b.eval('__app.visibilityAt(290.85)')
    check(abs(A[0] / A[1] - 1) < 0.08 and vmin2 < 0.05, f'dragging the weak line up to the strong one: strengths {A[0]:.3f}, {A[1]:.3f}; visibility at the minimum {vmin2:.3f}')

    # Draw a spectrum: the interferogram follows.
    b.eval('__app.setups.draws()'); b.sleep(0.3)
    I0 = b.eval('__app.spectrum().I0')
    b.drag('#spectrum', (0.2, 0.3), (0.35, 0.3), steps=12); b.sleep(0.3)
    I1 = b.eval('__app.spectrum().I0'); src = b.eval('__app.state.michelson.source')
    check(I1 > I0 and src == 'drawn', f'drawing on the spectrum adds light (∫S: {I0:.4f} -> {I1:.4f})')
    g = b.eval("""(() => { const s = __app.spectrum(); let q = 0; const h = 0.0005;
      for (let x = 1.1; x < 2.9; x += h) q += s.density(x) * Math.cos(2 * Math.PI * x * 3.7) * h; return [s.gamma(3.7)[0], q]; })()""")
    check(abs(g[0] - g[1]) < 1e-3 * I1, f'the drawn spectrum\'s interferogram is its transform (Γ(3.7 μm) = {g[0]:.5f}, quadrature {g[1]:.5f})')

    # Fourier-transform spectroscopy: aliasing, then the right step.
    b.eval('__app.setups.aliasing()'); b.sleep(0.5)
    peak = b.eval("""(() => { const r = __app.recovered(1e-3); let m = 1; for (let i = 1; i < r.v.length; i++) if (r.v[i] > r.v[m]) m = i; return m * r.ds; })()""")
    check(abs(peak - 0.9197) < 0.01, f'aliasing: with δ = 0.4 μm the HeNe line shows at σ = {peak:.4f} μm⁻¹ (expected 0.920)')
    b.eval("""(() => { const box = [...document.querySelectorAll('#fts-box input[type=number]')][1]; box.value = 0.2; box.dispatchEvent(new Event('change')); })()"""); b.sleep(0.4)
    peak = b.eval("""(() => { const r = __app.recovered(1e-3); let m = 1; for (let i = 1; i < r.v.length; i++) if (r.v[i] > r.v[m]) m = i; return m * r.ds; })()""")
    check(abs(peak - 1.5803) < 0.01, f'typing a step of 0.2 μm puts it back at σ = {peak:.4f} μm⁻¹ (1/632.8 nm = 1.580)')
    b.screenshot('build/ifm-aliasing-fixed.png')

    # The sodium scan resolves the doublet once it is over.
    b.eval('__app.setups.resolution()'); b.sleep(5)
    pk = b.eval("""(() => { const r = __app.recovered(2e-5), out = [];
      for (let m = 1; m + 1 < r.v.length; m++) { const s = m * r.ds; if (s < 1.694 || s > 1.7) continue;
        if (r.v[m] > r.v[m - 1] && r.v[m] >= r.v[m + 1]) out.push([s, r.v[m]]); }
      const top = Math.max(...out.map((q) => q[1])); return out.filter((q) => q[1] > 0.3 * top).map((q) => q[0]); })()""")
    check(len(pk) == 2 and abs(pk[0] - 1000 / 589.592) < 1e-4 and abs(pk[1] - 1000 / 588.995) < 1e-4,
          f'a 1.2 mm scan resolves the sodium doublet: lines at {", ".join(f"{p:.5f}" for p in pk)} μm⁻¹')
    b.screenshot('build/ifm-resolution-done.png')

    # Draw on the spectrometer's samples: the spectrum follows; undo restores the source.
    b.eval('__app.setups.drawi()'); b.sleep(0.4)
    b.drag('#trace', (0.5, 0.5), (0.95, 0.5), steps=15); b.sleep(0.4)
    drawn = b.eval('__app.fts().drawn')
    width = b.eval("""(() => { const r = __app.recovered(1e-3); let m = 1; for (let i = 1; i < r.v.length; i++) if (r.v[i] > r.v[m]) m = i;
      let a = m, c = m; while (a > 0 && r.v[a] > r.v[m] / 2) a--; while (c < r.v.length - 1 && r.v[c] > r.v[m] / 2) c++; return (c - a) * r.ds; })()""")
    check(drawn and width > 0.08, f'flattening the far half of the samples widens the line (half width {width:.3f} μm⁻¹; 1/(2 x 5 μm) = 0.1)')
    b.screenshot('build/ifm-drawn-interferogram.png')
    b.click('#undraw'); b.sleep(0.3)
    check(not b.eval('__app.fts().drawn') and b.eval('__app.state.michelson.source') == 'hene', 'Undo drawing brings back the laser')

    # The stellar interferometer.
    b.eval('__app.setups.betelgeuse()'); b.sleep(0.5)
    B0 = b.eval('__app.firstNull()')
    check(abs(B0 - 3.078) < 0.005, f'Betelgeuse: 47 mas at 575 nm, first null at B = {B0:.3f} m (1.22 λ/θ = 3.078)')
    p = b.eval('__app.S.handlePoints()')
    Bb = b.eval('__app.state.stellar.B')
    hx, hy = p['handles'][1]
    b.drag('#st-schematic', frac(p, [hx, hy]), frac(p, [hx + 40, hy]), steps=8); b.sleep(0.3)
    Ba = b.eval('__app.state.stellar.B')
    check(Ba > Bb + 0.3 and not b.eval('__app.state.stellar.sweeping'), f'dragging an outer mirror widens the baseline ({Bb:.2f} -> {Ba:.2f} m) and stops the sweep')
    b.click('#visibility', (0.5, 0.5)); b.sleep(0.3)
    B2 = b.eval('__app.state.stellar.B'); V2 = b.eval('__app.bandV()'); Ve = b.eval('__app.starV(__app.state.stellar.B)')
    check(abs(V2 - Ve) < 1e-9 and B2 > 0, f'clicking the visibility plot sets B = {B2:.2f} m; the fringes show V = {V2:.3f}')
    prof = b.eval('Array.from(__app.S.profile())')
    check(max(prof) > 0, 'the fringes at the focus are drawn')
    b.eval('__app.setups.binary()'); b.sleep(0.4)
    vm = b.eval('__app.starV(550e-9 / (2 * 50 * Math.PI / 648e6))')
    check(abs(vm - 0.1 / 1.9) < 0.005, f'binary: visibility {vm:.4f} at the first beat minimum ((1 - r)/(1 + r) = {0.1 / 1.9:.4f})')

    # The readouts keep still: every number in a slot of its own, so that no label, number or
    # button moves (by more than 0.5 px) as the numbers change sign, size and number of figures.
    def frame_passed():
        b.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(0))))')
    def typed(sel, i, v):
        return lambda: (b.eval(f"(() => {{ const box = [...document.querySelectorAll('{sel} input[type=number]')][{i}]; box.value = {v}; box.dispatchEvent(new Event('change')); }})()"), frame_passed())
    def still(name, sel, steps, want_texts):
        moves, texts = b.steady(sel, steps)
        check(not moves and len(texts) >= want_texts,
              f'{name}: the readouts keep still through {len(texts)} different readings' + (f'; moved: {moves[:4]}' if moves else ''))
    # The mirror, the counter and the screen, the mirror on either side of equal paths and the count
    # up and down (the counter driven by the motor's own steps, so it never loses count).
    def place(d, motor, until):
        return lambda: (b.eval(f"""(() => {{ const M = __app.M; M.setMotor('stop'); M.placeMirror({d}); M.state.speed = 2; M.setMotor('{motor}');
            for (let i = 0; i < 20000 && !({until}); i++) M.tick(0.01); M.setMotor('stop'); }})()"""), frame_passed())
    b.eval('__app.setups.count()')
    place(250, 'fwd', '__app.counter().count >= 5')()
    still('Michelson', '#mirror-readout, #mirror-readout .fixnum, #counter-readout, #counter-readout .fixnum, #counter-reset, #screen-note .fixnum, #screen',
          [place(-3.2, 'back', '__app.counter().count <= -12'), place(-480, 'fwd', '__app.counter().count >= 40'),
           place(9.87, 'back', '__app.counter().count <= -7'), place(123.4, 'fwd', '__app.counter().count >= 400')], 5)
    # Through equal paths, where the units change (nm, μm) and the count is one fringe: the
    # monospaced readouts keep their width, and the Reset button its place.
    place(250, 'fwd', '__app.counter().count >= 5')()
    still('Michelson, through equal paths', '#mirror-readout, #mirror-readout .fixnum, #counter-readout, #counter-readout .fixnum, #counter-reset',
          [place(0.2, 'fwd', '__app.counter().count >= 1'), place(-0.1, 'back', '__app.counter().count <= -1'), place(-700, 'back', '__app.counter().count <= -3')], 4)
    b.eval("__app.M.setMotor('fwd')"); frame_passed()
    still('the motor', '#motor-note, #motor-note .fixnum', [typed('#speed-box', 0, v) for v in (0.01, 3.7, 999, 42)], 5)
    # The spectrometer's readouts as the scan's length and step change.
    b.eval('__app.setups.aliasing()'); typed('#fts-box', 1, 0.3)()
    still('the spectrometer', '#trace-note .fixnum, #plot-box button, #fts-readout > div, #fts-readout .fixnum',
          [typed('#fts-box', 0, 99), typed('#fts-box', 1, 0.05), typed('#fts-box', 0, 640), typed('#fts-box', 1, 0.123), typed('#fts-box', 0, 10)], 6)
    still('Scan, Scanning...', '#scan, #apod-box button', [lambda: (b.eval('__app.M.startScan()'), frame_passed())], 2)
    # The stellar interferometer: the star's size, the baseline, the band.
    b.eval('__app.setups.star(); __app.S.setSweep(false)'); typed('#light-box', 1, 5)()
    def baseline(B):
        return lambda: (b.eval(f'__app.S.setB({B})'), frame_passed())
    still('stellar', '#sky-note .fixnum, #fringe-note .fixnum, #st-readout > div, #st-readout .fixnum, #st-play, #seeing-box button',
          [baseline(0.01), typed('#star-box', 0, 0.5), baseline(9.99), typed('#light-box', 1, 150), typed('#star-box', 0, 199.9), baseline(3.7)], 7)
    # While the baseline sweeps (the first line of the readout is always there), and the button's
    # new words don't move the one after it.
    b.eval('__app.setups.star()'); b.sleep(0.3)
    still('stellar, sweeping', '#sky-note .fixnum, #fringe-note .fixnum, #st-readout > div:first-child .fixnum, #st-play, #seeing-box button',
          [lambda: b.sleep(0.4) for _ in range(6)] + [lambda: (b.click('#st-play'), frame_passed())], 3)

    # Every experiment.
    for name in b.eval('Object.keys(__app.setups)'):
        b.eval(f'__app.setups[{json.dumps(name)}]()'); b.sleep(2.5 if name in ('fts', 'resolution') else 1.2)
        b.screenshot(f'build/ifm-exp-{name}.png')
    n_exp = b.eval("document.querySelectorAll('#help .exp[data-setup]').length")
    check(n_exp == len(b.eval('Object.keys(__app.setups)')) and 8 <= n_exp <= 14, f'{n_exp} experiments in the drawer, one set-up each')
    missing = b.eval("[...document.querySelectorAll('#help .exp[data-setup]')].map((a) => a.dataset.setup).filter((n) => !__app.setups[n])")
    check(not missing, f'no experiment without a set-up {missing}')

    # The address keeps the set-up.
    b.eval('__app.setups.coherence()'); b.sleep(0.8)
    url = b.eval('location.hash')
    b.call('Page.navigate', url='about:blank'); b.sleep(0.3)
    b.goto('interferometer/index.html' + url); b.wait('window.__app && __app.ready'); b.sleep(0.5)
    st = b.eval('__app.state.michelson')
    check(st['source'] == 'gauss' and abs(st['params']['gauss']['fwhm'] - 10) < 1e-9 and st['motor'] == 'sweep', f'the address restores the set-up ({url[:60]}...)')
    b.call('Page.navigate', url='about:blank'); b.sleep(0.3)
    b.goto('interferometer/index.html#setup=binary'); b.wait('window.__app && __app.ready'); b.sleep(0.5)
    check(b.eval('__app.mode') == 'stellar' and b.eval('__app.state.stellar.kind') == 'binary', '#setup=binary opens the binary star')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

# The phone layout: everything stacks under the stage.
with Browser('interferometer/index.html', size=(400, 850)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1.2)
    b.screenshot('build/ifm-phone.png')
    over = b.eval('document.documentElement.scrollWidth > window.innerWidth + 1')
    check(not over, 'phone width: no sideways scrolling')
    b.eval('__app.setups.star()'); b.sleep(1)
    b.screenshot('build/ifm-phone-star.png')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'phone: no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
