#!/usr/bin/env python3
"""Drive the interferometer demo: the mirror on both sides of equal paths, the spectrum, the
spectrometer's two-sided scan, the stellar interferometer, every experiment, the address, and the
phone layout.  The motor and the scans are stepped through __app.M.tick, so that no check depends
on how fast the machine is."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

def frac(p, pt):
    return (pt[0] / p['w'], pt[1] / p['h'])

def theme_colors(b):
    """The luminance (0 black, 1 white) of the page's background, the hint's text, and the
    Start-here block's text and background, with the drawer open."""
    b.eval("document.querySelector('#help').classList.add('open')")
    out = b.eval("""(() => { const cs = (e) => getComputedStyle(e), h = document.querySelector('#schem-hint'), s = document.querySelector('#help .start');
      const lum = (c) => { const m = c.match(/\\d+(\\.\\d+)?/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
      return { page: lum(cs(document.body).backgroundColor), hint: lum(cs(h).color), start: lum(cs(s).color), start_bg: lum(cs(s).backgroundColor) }; })()""")
    b.eval("document.querySelector('#help').classList.remove('open')")
    return out

# Run a scan to its end, 0.05 s at a time.
FINISH_SCAN = '(() => { let i = 0; while (__app.fts().scanning && i < 100000) { __app.M.tick(0.05); i++; } return i; })()'
# The recovered spectrum at a wavenumber (between the bins), and its peaks in a range.
REC_AT = '((s) => { const r = __app.recovered(1e-4), u = s / r.ds, p = Math.floor(u), t = u - p; return r.v[p] * (1 - t) + r.v[p + 1] * t; })'
PEAKS = """((lo, hi, cw) => { const r = __app.recovered(cw), out = [];
  for (let m = 1; m + 1 < r.v.length; m++) { const s = m * r.ds; if (s < lo || s > hi) continue;
    if (r.v[m] > r.v[m - 1] && r.v[m] >= r.v[m + 1]) out.push([s, r.v[m]]); }
  const top = Math.max(...out.map((q) => q[1])); return out.filter((q) => q[1] > 0.3 * top).map((q) => q[0]); })"""

with Browser('interferometer/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1.0)
    b.screenshot('build/ifm-start.png')
    def frame_passed():
        b.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(0))))')

    # It opens doing something: white light, the motor sweeping M2 through equal paths, and the
    # detector's record of both sides of zero path already drawn.
    st = b.eval('__app.state.michelson')
    D0 = b.eval('__app.D()')
    b.wait(f'__app.D() !== {D0}')
    check(st['source'] == 'white' and st['motor'] == 'sweep' and st['win'][0] < 0 < st['win'][1],
          f"it opens with white light, the motor sweeping through equal paths (window {st['win'][0]:.0f} to {st['win'][1]:.0f} μm)")
    fps = b.eval("""new Promise((res) => { let n = 0; const t0 = performance.now();
      const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); };
      requestAnimationFrame(f); })""")
    print(f'      {fps:.0f} frames per second while the motor runs (headless, no GPU)')
    tc = b.eval('__app.M.traceColumns()')
    P = len(tc['hi']); mirror = [P - 1 - k for k in range(P)]
    sym = max(max(abs(tc['hi'][k] - tc['hi'][mirror[k]]), abs(tc['lo'][k] - tc['lo'][mirror[k]])) for k in range(P))
    check(all(tc['has']) and sym < 1e-6 and max(tc['hi']) > 0.99,
          f'the detector\'s record of white light is the same on both sides of zero path (columns differ by {sym:.1e} from their mirror images; peak {max(tc["hi"]):.3f})')
    sm = b.eval('Math.max(...[0.13, 0.5, 1.07, 2.2, 3.9, 47.3].map((D) => Math.abs(__app.intensity(D) - __app.intensity(-D))))')
    check(sm < 1e-12, f'I(Δ) = I(−Δ) for white light (largest difference {sm:.1e})')

    # The first screen: a hint under the schematic says what to drag; the readouts say in words
    # what their numbers are; the spectrometer's panel is folded away until something needs it.
    hint = b.eval("(() => { const h = document.querySelector('#schem-hint'), r = h.getBoundingClientRect(); return [h.className, h.textContent, r.width > 0 && r.height > 0, r.top, document.querySelector('#schematic').getBoundingClientRect().bottom]; })()")
    check(hint[0] == 'hint' and hint[1].startswith('Drag the mirror M2') and hint[2] and abs(hint[3] - hint[4]) < 12,
          f'a hint directly under the schematic says what to drag: {hint[1][:44]!r}')
    words = b.eval("['#mirror-readout', '#counter-readout', '#screen-note'].map((s) => document.querySelector(s).textContent).join(' | ')")
    check('from equal paths' in words and 'path difference' in words and 'Fringes counted' in words and 'fringe contrast (visibility)' in words,
          f'the readouts say what their numbers are: {words[:90]!r}...')
    check(not b.eval("document.querySelector('#fts-panel').open"), "the spectrometer's panel is folded away at opening")
    n_vis = b.eval("[...document.querySelectorAll('#m-controls input[type=range], #m-controls button')].filter((e) => e.getClientRects().length).length")
    print(f'      {n_vis} sliders and buttons visible at opening')
    b.click('#plot-box button:nth-child(2)'); frame_passed()
    check(b.eval("document.querySelector('#fts-panel').open") and b.eval('__app.state.michelson.plot') == 'fts', 'pressing Spectrometer above the interferogram unfolds it')
    hint_cols = theme_colors(b)
    check(hint_cols['page'] > 0.8 and hint_cols['hint'] < 0.5 and hint_cols['start'] < 0.3 and hint_cols['start_bg'] > 0.8,
          f"light theme: the hint and the Start-here block read (luminances: page {hint_cols['page']:.2f}, hint {hint_cols['hint']:.2f}, block {hint_cols['start']:.2f} on {hint_cols['start_bg']:.2f})")

    # The fringe counter: 10 μm of mirror travel with the laser is 2 x 10 / 0.6328 = 31.6 fringes,
    # on one side of equal paths or straddling them.
    b.eval('__app.setups.count()')
    n = b.eval("""(() => { const M = __app.M, d0 = M.state.dc + M.state.df;
      while (M.state.dc + M.state.df - d0 < 10) M.tick(0.01); return __app.counter().count; })()""")
    check(n in (31, 32), f'the counter: {n} fringes for 10 μm of mirror travel (2d/λ = 31.6)')
    n = b.eval("""(() => { const M = __app.M; M.setMotor('stop'); M.placeMirror(-5); M.setMotor('fwd');
      while (M.state.dc + M.state.df < 5) M.tick(0.01); M.setMotor('stop'); return __app.counter().count; })()""")
    check(n in (31, 32), f'the counter through equal paths, d from −5 to +5 μm: {n} fringes')
    n = b.eval("""(() => { const M = __app.M; M.placeMirror(5); M.setMotor('back');
      while (M.state.dc + M.state.df > -5) M.tick(0.01); M.setMotor('stop'); return __app.counter().count; })()""")
    check(n in (-31, -32), f'and back from +5 to −5 μm: {n} fringes (counting down)')

    # Drag the mirror's body, its fine knob and its tilt handle; and M2 on the other side.
    b.eval('__app.setups.tilt()'); b.sleep(0.3)
    p = b.eval('__app.M.schemPoints()')
    d0 = b.eval('__app.M.state.dc + __app.M.state.df')
    b.drag('#schematic', frac(p, p['body']), frac(p, [p['body'][0] + 25, p['body'][1]]), steps=8); b.sleep(0.2)
    d1 = b.eval('__app.M.state.dc + __app.M.state.df')
    check(d1 > d0 + 0.5, f'dragging M2 moves it ({d0:.3f} -> {d1:.3f} μm)')
    p = b.eval('__app.M.schemPoints()')
    b.drag('#schematic', frac(p, p['body']), frac(p, [p['body'][0] - 50, p['body'][1]]), steps=8); b.sleep(0.2)
    d2 = b.eval('__app.M.state.dc + __app.M.state.df'); p = b.eval('__app.M.schemPoints()')
    check(d2 < -0.5 and p['mirror'] < p['eq'], f'dragging it back past equal paths gives d = {d2:.3f} μm, drawn nearer the beam splitter')
    f0 = b.eval('__app.M.state.dc + __app.M.state.df')
    b.drag('#schematic', frac(p, p['knob']), frac(p, [p['knob'][0], p['knob'][1] - 50]), steps=10); b.sleep(0.2)
    f1 = b.eval('__app.M.state.dc + __app.M.state.df')
    check(abs((f1 - f0) - 0.2) < 0.03, f'the fine knob at d < 0: 50 px up moves the mirror {1000 * (f1 - f0):.1f} nm (4 nm per px)')
    p = b.eval('__app.M.schemPoints()')
    t0 = b.eval('__app.M.state.tilt')
    b.drag('#schematic', frac(p, p['top']), frac(p, [p['top'][0] + 30, p['top'][1] + 5]), steps=6); b.sleep(0.2)
    t1 = b.eval('__app.M.state.tilt')
    check(t1 > t0 + 50, f'dragging the top of M2 tilts it ({t0:.0f} -> {t1:.0f} μrad)')
    b.eval("""(() => { const box = document.querySelector('#mirror-box input[type=number]'); box.value = -1.5; box.dispatchEvent(new Event('change')); })()"""); frame_passed()
    dd = b.eval('__app.M.state.dc + __app.M.state.df'); p = b.eval('__app.M.schemPoints()')
    check(abs(dd + 1500) < 1 and p['mirror'] < p['eq'] and abs(b.eval('__app.D()') + 3000) < 2, f'typing d = −1.5 mm puts M2 at {dd:.1f} μm, Δ = {b.eval("__app.D()"):.1f} μm')

    # White light: the central fringe, reached from either side; the screen on one side is the
    # screen on the other, mirrored.
    b.eval('__app.setups.white()'); b.eval('__app.M.setMotor("stop")'); frame_passed()
    def sweep(a, z, motor):
        return b.eval(f"""(() => {{ const M = __app.M; M.setPath({a}, false); M.state.speed = 0.25; M.setMotor('{motor}');
          let best = -1, at = 0; for (let i = 0; i < 100000; i++) {{ M.tick(0.01); const D = __app.D(), I = __app.intensity(D) / 2;
            if (I > best) {{ best = I; at = D; }} if ({'D > ' + str(z) if motor == 'fwd' else 'D < ' + str(z)}) break; }}
          M.setMotor('stop'); return [best, at]; }})()""")
    up, down = sweep(-3, 3, 'fwd'), sweep(3, -3, 'back')
    check(up[0] > 0.999 and down[0] > 0.999 and abs(up[1]) < 0.01 and abs(down[1]) < 0.01,
          f'white light: the motor reaches the central fringe from below (I/I(0) = {up[0]:.4f} at Δ = {up[1]:+.4f} μm) and from above ({down[0]:.4f} at {down[1]:+.4f} μm)')
    def screen_row(D):
        b.eval(f'__app.M.setPath({D}, false)'); frame_passed()
        return b.eval("""(() => { const c = document.getElementById('screen'), x = c.getContext('2d');
          return Array.from(x.getImageData(0, Math.floor(c.height / 2) + 20, c.width, 1).data); })()""")
    rp, rn = screen_row(0.9), screen_row(-0.9)
    W = len(rp) // 4
    diff = max(abs(rp[4 * i + c] - rn[4 * (W - 1 - i) + c]) for i in range(W) for c in range(3))
    check(diff <= 3, f'the screen at Δ = −0.9 μm is the screen at +0.9 μm mirrored (colours within {diff} of 255)')
    b.eval('__app.M.setPath(0.3, false)'); frame_passed()
    colours = b.eval("""(() => { const c = document.getElementById('screen'), x = c.getContext('2d');
      const d = x.getImageData(0, c.height / 2, c.width, 1).data, set = new Set();
      for (let i = 0; i < d.length; i += 16) set.add(((d[i] >> 5) << 6) | ((d[i + 1] >> 5) << 3) | (d[i + 2] >> 5)); return set.size; })()""")
    check(colours > 12, f'white-light fringes are coloured ({colours} distinct colours across the screen)')
    b.eval('__app.M.clearRecord()')
    b.click('#trace', (0.9, 0.5)); frame_passed()
    Dc = b.eval('__app.D()'); rec = b.eval('__app.record()')
    b.click('#trace', (0.1, 0.5)); frame_passed()
    Dn = b.eval('__app.D()'); rec2 = b.eval('__app.record()')
    check(2.5 < Dc < 4 and -4 < Dn < -2.5 and rec2 and rec2[0][0] <= Dn + 1e-9 and rec2[-1][1] >= Dc - 1e-9,
          f'clicking the interferogram moves the mirror to Δ = {Dc:.3f} μm, then to {Dn:.3f} μm, recording the way through zero path')
    v = b.eval('[__app.visibilityAt(0.5), __app.visibilityAt(-0.5), __app.visibilityAt(3)]')
    check(v[0] > 0.4 and abs(v[0] - v[1]) < 1e-12 and v[2] < 0.1, f'white light: visibility {v[0]:.2f} at ±0.5 μm, {v[2]:.3f} at 3 μm')

    # The sodium doublet: beats of period λ²/Δλ on both sides; equalising the lines makes the fringes vanish.
    b.eval('__app.setups.sodium()')
    span = b.eval("""(() => { const M = __app.M; for (let i = 0; i < 4000 && __app.D() < 1150; i++) M.tick(0.02);
      M.setMotor('stop'); const r = __app.record(); return [r[0][0], r[r.length - 1][1]]; })()""")
    check(span[0] < -1150 and span[1] > 1150, f'sodium: the motor sweeps through equal paths, the detector recording Δ from {span[0]:.0f} to {span[1]:.0f} μm')
    vmin = b.eval('[__app.visibilityAt(290.85), __app.visibilityAt(-290.85)]')
    check(abs(vmin[0] - 1 / 3) < 2e-3 and abs(vmin[1] - vmin[0]) < 1e-12, f'sodium: visibility {vmin[0]:.4f} at Δ = ±290.85 μm (lines 2 : 1 give 1/3)')
    frame_passed()
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

    # Fourier-transform spectroscopy: the scan runs from −Δmax through zero path to +Δmax.
    b.eval('__app.setups.fts()')
    early = b.eval("""(() => { for (let i = 0; i < 10; i++) __app.M.tick(0.05); return [__app.M.state.dc + __app.M.state.df, __app.recovered(1e-3) === null, __app.fts().last]; })()""")
    check(early[0] < -10 and early[1], f'the scan starts on the far side, at d = {early[0]:.1f} μm, and recovers nothing until it reaches zero path')
    b.eval(FINISH_SCAN)
    sc = b.eval('(() => { const f = __app.fts(), s = f.samples, z = f.z; let odd = 0; for (let q = 1; q <= z; q++) odd = Math.max(odd, Math.abs(s[z + q] - s[z - q])); return [f.n, z, odd, __app.record()[0][0], __app.record().at(-1)[1]]; })()')
    check(sc[0] == 2 * sc[1] + 1 and sc[2] < 1e-12 and sc[3] <= -59.99 and sc[4] >= 59.99,
          f'mercury: {sc[0]} samples from Δ = {sc[3]:.1f} to {sc[4]:.1f} μm, the two sides mirror images (differ by {sc[2]:.1e})')
    pk = b.eval(PEAKS + '(1.72, 1.74, 2e-5)')
    check(len(pk) == 1, f'with Δmax = 60 μm the yellow pair is one bump ({len(pk)} peak)')
    b.eval("""(() => { const box = [...document.querySelectorAll('#fts-box input[type=number]')][0]; box.value = 120; box.dispatchEvent(new Event('change')); })()""")
    b.eval('__app.M.startScan()'); b.eval(FINISH_SCAN)
    pk = b.eval(PEAKS + '(1.72, 1.74, 2e-5)')
    # (each line's sinc pulls the other's peak by up to a fifth of the resolution 1/(2Δmax) = 0.0042 μm⁻¹)
    check(len(pk) == 2 and abs(pk[0] - 1000 / 579.066) < 1e-3 and abs(pk[1] - 1000 / 576.96) < 1e-3,
          f'with Δmax = 120 μm it is two: {", ".join(f"{x:.4f}" for x in pk)} μm⁻¹ (579.07 and 576.96 nm)')

    # Both sides, or one: the same spectrum when the zero is right; with a zero error, only both sides are right.
    b.eval('__app.setups.sides()'); b.eval(FINISH_SCAN)
    green = 1000 / 546.074
    two_eps = b.eval(REC_AT + f'({green})')
    b.click('#sides-box button:nth-child(2)'); b.eval('__app.M.startScan()'); b.eval(FINISH_SCAN)
    one_eps = b.eval(REC_AT + f'({green})')
    check(b.eval('__app.state.michelson.fts.sides') == 1 and abs(one_eps) < 0.05 * two_eps,
          f'zero error ε = 0.137 μm: the green line is {two_eps:.1f} from both sides, {one_eps:+.2f} from one side (cos 2πσε = {__import__("math").cos(2 * __import__("math").pi * green * 0.137):+.3f})')
    b.eval("""(() => { const box = [...document.querySelectorAll('#fts-box input[type=number]')][2]; box.value = 0; box.dispatchEvent(new Event('change')); })()""")
    b.eval('__app.M.startScan()'); b.eval(FINISH_SCAN)
    one = b.eval('Array.from(__app.recovered(1e-3).v)')
    b.click('#sides-box button:nth-child(1)'); b.eval('__app.M.startScan()'); b.eval(FINISH_SCAN)
    two = b.eval('Array.from(__app.recovered(1e-3).v)')
    top = max(two); dmax = max(abs(x - y) for x, y in zip(one, two)) if len(one) == len(two) else 1
    check(len(one) == len(two) and dmax < 1e-9 * top, f'with no zero error, one side and both sides give the same spectrum (differ by {dmax / top:.1e} of the peak)')
    check(abs(b.eval(REC_AT + f'({green})') - two_eps) < 0.01 * two_eps, 'and both sides gave the right green line with the zero error too')

    # Aliasing, then the right step.
    b.eval('__app.setups.aliasing()'); b.sleep(0.3)
    peak = b.eval("""(() => { const r = __app.recovered(1e-3); let m = 1; for (let i = 1; i < r.v.length; i++) if (r.v[i] > r.v[m]) m = i; return m * r.ds; })()""")
    check(abs(peak - 0.9197) < 0.01, f'aliasing: with δ = 0.4 μm the HeNe line shows at σ = {peak:.4f} μm⁻¹ (expected 0.920)')
    b.eval("""(() => { const box = [...document.querySelectorAll('#fts-box input[type=number]')][1]; box.value = 0.2; box.dispatchEvent(new Event('change')); })()"""); b.sleep(0.3)
    peak = b.eval("""(() => { const r = __app.recovered(1e-3); let m = 1; for (let i = 1; i < r.v.length; i++) if (r.v[i] > r.v[m]) m = i; return m * r.ds; })()""")
    check(abs(peak - 1.5803) < 0.01, f'typing a step of 0.2 μm puts it back at σ = {peak:.4f} μm⁻¹ (1/632.8 nm = 1.580)')
    b.screenshot('build/ifm-aliasing-fixed.png')

    # The sodium scan resolves the doublet once it is over.
    b.eval('__app.setups.resolution()'); b.eval(FINISH_SCAN)
    pk = b.eval(PEAKS + '(1.694, 1.7, 2e-5)')
    check(len(pk) == 2 and abs(pk[0] - 1000 / 589.592) < 1e-4 and abs(pk[1] - 1000 / 588.995) < 1e-4,
          f'a ±1.2 mm scan resolves the sodium doublet: lines at {", ".join(f"{p:.5f}" for p in pk)} μm⁻¹')
    frame_passed(); b.screenshot('build/ifm-resolution-done.png')

    # Draw on the spectrometer's samples (mirrored on the other side): the spectrum follows; undo restores the source.
    b.eval('__app.setups.drawi()'); b.sleep(0.4)
    b.drag('#trace', (0.75, 0.5), (0.985, 0.5), steps=15); b.sleep(0.4)
    drawn = b.eval('__app.fts().drawn')
    odd = b.eval('(() => { const f = __app.fts(), s = f.samples, z = f.z; let odd = 0; for (let q = 1; q <= z; q++) odd = Math.max(odd, Math.abs(s[z + q] - s[z - q])); return odd; })()')
    width = b.eval("""(() => { const r = __app.recovered(1e-3); let m = 1; for (let i = 1; i < r.v.length; i++) if (r.v[i] > r.v[m]) m = i;
      let a = m, c = m; while (a > 0 && r.v[a] > r.v[m] / 2) a--; while (c < r.v.length - 1 && r.v[c] > r.v[m] / 2) c++; return (c - a) * r.ds; })()""")
    check(drawn and odd < 1e-12 and width > 0.08, f'flattening the outer samples on one side flattens the other too; the line widens (width {width:.3f} μm⁻¹; 1/(2 x 5 μm) = 0.1)')
    b.screenshot('build/ifm-drawn-interferogram.png')
    b.click('#undraw'); b.sleep(0.3)
    check(not b.eval('__app.fts().drawn') and b.eval('__app.state.michelson.source') == 'hene', 'Undo drawing brings back the laser')

    # The stellar interferometer.
    b.eval('__app.setups.betelgeuse()'); b.sleep(0.5)
    sth = b.eval("(() => { const h = document.querySelector('#st-hint'), r = h.getBoundingClientRect(); return [h.className, h.textContent, r.height > 0, r.top, document.querySelector('#st-schematic').getBoundingClientRect().bottom]; })()")
    check(sth[0] == 'hint' and sth[1].startswith('Drag an outer mirror') and sth[2] and abs(sth[3] - sth[4]) < 12, 'the stellar view has its own hint, under its schematic')
    st_words = b.eval("document.querySelector('#st-readout').textContent + ' | ' + document.querySelector('#fringe-note').textContent")
    check('fringe contrast |V|' in st_words and 'first vanish at' in st_words and 'contrast (visibility)' in st_words, f'the stellar readouts say what their numbers are: {st_words[:70]!r}...')
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
    # The spectrometer's readouts as the scan's reach, step and zero error change, both sides and one.
    b.eval('__app.setups.aliasing()'); typed('#fts-box', 1, 0.3)()
    ftsSel = '#trace-note .fixnum, #plot-box button, #fts-readout > div, #fts-readout .fixnum, #sides-box button, #scan'
    still('the spectrometer', ftsSel,
          [typed('#fts-box', 0, 99), typed('#fts-box', 1, 0.05), typed('#fts-box', 0, 640), typed('#fts-box', 1, 0.123), typed('#fts-box', 0, 10)], 6)
    b.click('#sides-box button:nth-child(2)'); typed('#fts-box', 2, 0.1)()
    still('the spectrometer, one side with a zero error', ftsSel,
          [typed('#fts-box', 2, -0.3), typed('#fts-box', 0, 1500), typed('#fts-box', 2, 0.25), typed('#fts-box', 1, 0.07)], 3)
    b.click('#sides-box button:nth-child(1)'); frame_passed()
    still('Scan, Scanning...', '#scan, #apod-box button', [lambda: (b.eval('__app.M.startScan()'), frame_passed())], 2)
    # The stellar interferometer: the star's size, the baseline, the band.
    b.eval('__app.setups.star(); __app.S.setSweep(false)'); typed('#light-box', 1, 5)()
    def baseline(B):
        return lambda: (b.eval(f'__app.S.setB({B})'), frame_passed())
    still('stellar', '#sky-note .fixnum, #fringe-note .fixnum, #st-readout > div, #st-readout .fixnum, #st-play, #seeing-box button',
          [baseline(0.01), typed('#star-box', 0, 0.5), baseline(9.99), typed('#light-box', 1, 150), typed('#star-box', 0, 199.9), baseline(3.7)], 7)
    # While the baseline sweeps (the first line of the readout is always there), and the button's
    # new words don't move the one after it.
    b.eval('__app.setups.star()'); frame_passed()
    def sweep_on(s):
        return lambda: (b.eval(f'__app.S.tick({s})'), frame_passed())
    still('stellar, sweeping', '#sky-note .fixnum, #fringe-note .fixnum, #st-readout > div:first-child .fixnum, #st-play, #seeing-box button',
          [sweep_on(0.1 * (k + 1)) for k in range(6)] + [lambda: (b.click('#st-play'), frame_passed())], 3)

    # Every experiment (pictures to look at; the motor and scans left running a moment).
    for name in b.eval('Object.keys(__app.setups)'):
        b.eval(f'__app.setups[{json.dumps(name)}]()'); b.sleep(2.5 if name in ('fts', 'sides', 'resolution') else 1.2)
        b.screenshot(f'build/ifm-exp-{name}.png')
    first = b.eval("(() => { const s = [...document.querySelector('#help').children].filter((e) => e.tagName !== 'HEADER')[0]; return [s.className, s.querySelector('h3')?.textContent, !!s.querySelector('math'), s.textContent.length]; })()")
    check(first[0] == 'start' and first[1] == 'Start here' and not first[2] and 300 < first[3] < 1600, f'the drawer starts with a "Start here" block in plain words ({first[3]} characters, no equations)')
    order = b.eval("[...document.querySelector('#help').children].map((e) => e.tagName + (e.id ? '#' + e.id : '') + (e.dataset.setup ? '=' + e.dataset.setup : ''))")
    last_exp = max(i for i, x in enumerate(order) if '=' in x)
    check(order.index('SECTION#how') > last_exp and order[2] == 'ARTICLE=white', f'the theory ("How it works") comes after the experiments, and the opening state is experiment 1 ({order[2]})')
    hows = b.eval("document.querySelectorAll('#how math').length")
    check(hows >= 6, f'"How it works" keeps the equations ({hows} formulas)')
    n_exp = b.eval("document.querySelectorAll('#help .exp[data-setup]').length")
    check(n_exp == len(b.eval('Object.keys(__app.setups)')) and 8 <= n_exp <= 16, f'{n_exp} experiments in the drawer, one set-up each')
    missing = b.eval("[...document.querySelectorAll('#help .exp[data-setup]')].map((a) => a.dataset.setup).filter((n) => !__app.setups[n])")
    check(not missing, f'no experiment without a set-up {missing}')

    # The address keeps the set-up.
    b.eval('__app.setups.coherence()'); b.sleep(0.8)
    url = b.eval('location.hash')
    b.call('Page.navigate', url='about:blank'); b.sleep(0.3)
    b.goto('interferometer/index.html' + url); b.wait('window.__app && __app.ready'); b.sleep(0.5)
    st = b.eval('__app.state.michelson')
    check(st['source'] == 'gauss' and abs(st['params']['gauss']['fwhm'] - 10) < 1e-9 and st['motor'] == 'sweep', f'the address restores the set-up ({url[:60]}...)')
    b.eval('__app.setups.sides(); __app.M.setPlot("fts")'); b.eval("document.querySelector('#sides-box button:nth-child(2)').click()"); b.sleep(0.8)
    url = b.eval('location.hash')
    b.call('Page.navigate', url='about:blank'); b.sleep(0.3)
    b.goto('interferometer/index.html' + url); b.wait('window.__app && __app.ready'); b.sleep(0.5)
    st = b.eval('__app.state.michelson.fts')
    check(st['sides'] == 1 and abs(st['zero'] - 0.137) < 1e-9, f'... and the spectrometer\'s side and zero error ({url[:70]}...)')
    for setup, test in (('binary', "__app.mode === 'stellar' && __app.state.stellar.kind === 'binary'"),
                        ('white', "__app.state.michelson.source === 'white' && __app.state.michelson.motor === 'sweep'")):
        b.call('Page.navigate', url='about:blank'); b.sleep(0.3)
        b.goto(f'interferometer/index.html#setup={setup}'); b.wait('window.__app && __app.ready'); b.sleep(0.5)
        check(b.eval(test), f'#setup={setup} opens it')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

# The dark theme: the hint and the Start-here block read.
with Browser('interferometer/index.html', size=(1400, 900)) as b:
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
    b.wait('window.__app && __app.ready'); b.sleep(1)
    cols = theme_colors(b)
    check(cols['page'] < 0.2 and cols['hint'] > 0.5 and cols['start'] > 0.7 and cols['start_bg'] < 0.3,
          f"dark theme: the hint and the Start-here block read (luminances: page {cols['page']:.2f}, hint {cols['hint']:.2f}, block {cols['start']:.2f} on {cols['start_bg']:.2f})")
    b.screenshot('build/ifm-dark.png')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'dark theme: no exceptions')

# Desktop and laptop windows: nothing runs out of its column (the readouts wrap between their
# numbers; the spectrometer's lines once ran 45 px out of the window at 1400 px, the mirror's
# 30 px out of its column at 1100).
for size in ((1400, 900), (1100, 800)):
    with Browser('interferometer/index.html', size=size) as b:
        b.wait('window.__app && __app.ready'); b.sleep(0.5)
        for setup in ('white', 'resolution', 'sides'):
            b.eval(f'__app.setups.{setup}()'); b.sleep(0.6)
            over = b.eval('document.documentElement.scrollWidth > window.innerWidth + 1')
            cut = b.eval("""[...document.querySelectorAll('#mirror-readout .nobr, #counter-readout .nobr, #fts-readout .nobr, #screen-note .nobr')]
              .filter((e) => { const r = e.getBoundingClientRect(), p = e.closest('.cell, .panel').getBoundingClientRect();
                return r.width > 0 && (r.right > p.right + 1 || r.left < p.left - 1); }).map((e) => e.textContent)""")
            check(not over and not cut, f'{size[0]} x {size[1]}, {setup}: no sideways scrolling, every readout inside its box' + (f' (cut: {cut[:2]})' if cut else ''))

# The phone layout: everything stacks under the stage, the hint on the first screen.
with Browser('interferometer/index.html', size=(390, 844)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1.2)
    b.screenshot('build/ifm-phone.png')
    over = b.eval('document.documentElement.scrollWidth > window.innerWidth + 1')
    check(not over, 'phone width: no sideways scrolling')
    ph = b.eval("(() => { const r = document.querySelector('#schem-hint').getBoundingClientRect(); return [r.top, r.bottom, innerHeight, scrollY]; })()")
    check(ph[3] == 0 and ph[0] > 0 and ph[1] <= ph[2], f'phone: the hint is on the first screen, under the schematic (its bottom at {ph[1]:.0f} of {ph[2]} px)')
    b.eval('__app.setups.sides()'); b.sleep(0.5)
    over = b.eval('document.documentElement.scrollWidth > window.innerWidth + 1')
    check(not over, 'phone width, the spectrometer: no sideways scrolling')
    b.eval('__app.setups.star()'); b.sleep(1)
    b.screenshot('build/ifm-phone-star.png')
    check(b.eval("document.querySelector('#st-hint').getBoundingClientRect().height > 0"), 'phone, stellar: its hint is shown')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'phone: no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
