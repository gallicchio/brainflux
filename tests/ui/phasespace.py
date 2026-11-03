#!/usr/bin/env python3
"""Drive the quantum phase-space demo: every experiment, dragging a state, the physics readouts,
links that carry a set-up, a phone-sized window and the dark theme."""
import json, math, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

PI = math.pi
# Back to t = 0, paused (the experiments start running).
RESTART = '(() => { __app.state.running = false; __app.restart(); return __app.sim.t; })()'
# Run the clock to time t at once (not limited by the frame budget), and recompute W there.
RUN_TO = '''((t) => { const a = __app; a.state.running = false;
  while (a.sim.t < t - 1e-9) a.advance(Math.min(0.05, t - a.sim.t));
  a.computePhase(); a.draw(); return a.sim.t; })'''
INFO = '''(() => { const a = __app, o = a.sim.observables(), s = a.ens.N ? a.ens.stats(a.table) : null;
  return { t: a.sim.t, norm: a.sim.norm() + a.sim.absorbed, E: o.E, sxsp: o.sx * o.sp, sx: o.sx, sp: o.sp,
    minW: a.Wstats.min * Math.PI, neg: a.Wstats.negative, total: a.Wstats.total, dots: a.ens.N, from: a.dotsFrom,
    Ecl: s ? s.E : null, W00: a.grid.at(a.grid.W, 0, 0) * Math.PI, left: a.sim.probabilityLeftOf(0),
    clRight: a.ens.N ? Array.from(a.ens.x).filter((x) => x > 0).length / a.ens.N : null,
    levels: a.levels.map((l) => l.E) }; })()'''

def local_maxima(values, floor):
    return sum(1 for i in range(1, len(values) - 1) if values[i] > values[i - 1] and values[i] >= values[i + 1] and values[i] > floor)

# Read-outs that keep still: the boxes of the read-outs' parts (each quantity, its number's slot,
# the colour bar, the values under the pointer, the numerics note) are recorded over frames and
# steps that change the numbers; snapshots that show the same words (numbers taken out) must
# have every box in the same place, to 0.5 px.
NUMS = r"/[−+-]?\d[\d.,]*(?:e[−+-]?\d+)?/g"
def snapshot(b, sel, text_sel):
    return b.eval(f"""(() => {{
        const texts = [...document.querySelectorAll({json.dumps(text_sel)})].map((e) => e.textContent).join(' | ');
        const boxes = [...document.querySelectorAll({json.dumps(sel)})].map((e) => e.getBoundingClientRect())
          .map((r) => [r.left + scrollX, r.top + scrollY, r.width, r.height].map((v) => Math.round(v * 10) / 10));
        return [texts.replace({NUMS}, '#'), boxes, texts];
    }})()""")

def still(b, name, sel, text_sel, steps, min_compared=3):
    base, moved, texts, compared = {}, [], set(), 0
    for step in [None] + steps:
        if step: step()
        words, boxes, text = snapshot(b, sel, text_sel)
        texts.add(text)
        if words not in base: base[words] = boxes; continue
        compared += 1
        first = base[words]
        if len(first) != len(boxes): moved.append(f'{len(first)} -> {len(boxes)} boxes'); continue
        for k, (a, c) in enumerate(zip(first, boxes)):
            d = [round(y - x, 1) for x, y in zip(a, c)]
            if max(abs(v) for v in d) > 0.5: moved.append(f'box {k} by {d} at "{text[:90]}"'); break
    check(not moved and compared >= min_compared and len(texts) > compared // 2,
          f'{name}: the read-outs keep still while their numbers change ({len(texts)} different texts, {compared} compared with the same words, '
          f'{len(base)} wordings)' + (f'; moved: {moved[:2]}' if moved else ''))

READOUTS = ('#readouts > span, #readouts .k, #readouts .fixnum, #hint, .legend .cbar, #cb-lo, #cb-hi, #colorbar, #neg, #neg .fixnum, '
            '#dots-note, #dots-note .fixnum, #hover, #hover .fixnum')

# The contrast ratio (WCAG) between the text colour of sel and the background colour of bgSel.
CONTRAST = r'''((sel, bgSel) => { const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g).map(Number);
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  const fg = getComputedStyle(document.querySelector(sel)).color, bg = getComputedStyle(document.querySelector(bgSel)).backgroundColor;
  const [x, y] = [lum(fg), lum(bg)].sort((u, v) => v - u); return (x + 0.05) / (y + 0.05); })'''

def first_screen(b, where):
    """What a cold reader meets: a hint under the picture saying what to drag, on screen without
    scrolling; a word beside every readout; and in the drawer a Start-here block first (plain
    words, no equations) and the theory last.  Readable in this theme."""
    h = b.eval('''(() => { const h = document.getElementById('hint'), r = h.getBoundingClientRect(), p = document.getElementById('plot').getBoundingClientRect();
      return { text: h.textContent, top: r.top, bottom: r.bottom, h: r.height, plotBottom: p.bottom, inner: innerHeight }; })()''')
    check(h['text'].startswith('Drag the blob') and h['h'] > 10 and 0 <= h['top'] - h['plotBottom'] < 16 and h['bottom'] <= h['inner'],
          f"{where}: the hint \"{h['text'][:34]}...\" sits right under the plot, on screen without scrolling (bottom {h['bottom']:.0f} of {h['inner']})")
    keys = b.eval("[...document.querySelectorAll('#readouts .g .k')].map((e) => e.textContent)")
    check(keys == ['time', 'centre', 'uncertainty', 'energy'], f"{where}: every readout group has a word for it: {keys}")
    d = b.eval('''(() => { const d = document.getElementById('help'), kids = [...d.children].map((e) => (e.tagName + '.' + e.className).toLowerCase());
      const start = d.querySelector('section.start'), h3 = start && start.querySelector('h3');
      return { kids, text: start ? start.textContent.replace(/\\s+/g, ' ').trim() : '', h3: h3 ? h3.textContent : '', eqs: start ? start.querySelectorAll('math').length : -1 }; })()''')
    exps = [i for i, k in enumerate(d['kids']) if k == 'article.exp']
    theory = [i for i, k in enumerate(d['kids']) if k == 'section.theory']
    check(d['kids'][1] == 'section.start' and d['h3'] == 'Start here' and d['eqs'] == 0 and 'Drag the blob' in d['text'] and 300 < len(d['text']) < 1200,
          f"{where}: the drawer opens with a Start-here block in plain words, no equations ({len(d['text'])} characters)")
    check(len(exps) == 13 and exps[0] == 2 and theory and theory[0] > exps[-1],
          f"{where}: {len(exps)} experiments after it, and the theory ('How it works') last")
    c1, c2 = b.eval(CONTRAST + "('#hint', 'body')"), b.eval(CONTRAST + "('.drawer .start p', '.drawer .start')")
    check(c1 >= 4.5 and c2 >= 4.5, f"{where}: the hint and the Start-here block read (contrast {c1:.1f} and {c2:.1f} to 1)")

with Browser('phasespace/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready')
    try: b.wait('__app.sim.t > 0.2', timeout=15)
    except TimeoutError: pass
    info = b.eval(INFO)
    opening = b.eval('({ pot: __app.state.pot.id, kind: __app.state.init.kind, first: Object.keys(__app.setups)[0], second: Object.keys(__app.setups)[1] })')
    check(info['t'] > 0.2 and opening['pot'] == 'harmonic' and opening['kind'] == 'coherent' and opening['first'] == 'coherent' and opening['second'] == 'anharmonic',
          f"it opens running (t = {info['t']:.2f}) on experiment 1, a coherent state in the harmonic well; the quartic well is experiment 2")
    first_screen(b, 'desktop, light')
    t0, f0 = time.time(), b.eval('__app.frames()')
    b.sleep(2)
    fps = (b.eval('__app.frames()') - f0) / (time.time() - t0)
    work, quality = b.eval('[__app.work, __app.quality]')
    print(f'note  {fps:.0f} frames per second in headless Chromium (software rendering); the page works {work:.1f} ms a frame (W grid at {quality:.2f} of full resolution)')
    b.screenshot('build/ps-start.png')

    # The physics checks below at full resolution, whatever the load on this machine.
    b.eval('__app.fixQuality(1)')
    names = b.eval('Object.keys(__app.setups)')
    check(len(names) >= 8, f'{len(names)} experiments')
    for name in names:
        b.eval(f'__app.setups[{json.dumps(name)}]()')
        b.sleep(1.5)
        b.screenshot(f'build/ps-exp-{name}.png')
        i = b.eval(INFO)
        check(abs(i['norm'] - 1) < 1e-6, f"{name}: probability accounted for ({i['norm']:.9f}), t = {i['t']:.2f}")
        check(i['minW'] >= -1 - 1e-9, f"{name}: W never below -1/pi hbar (min pi W = {i['minW']:.4f})")
        check(i['sxsp'] >= 0.5 - 1e-6, f"{name}: sigma_x sigma_p = {i['sxsp']:.4f} >= hbar/2")

    # 1. A coherent state in the oscillator: W stays positive, the points come from W, minimum uncertainty.
    b.eval('__app.setups.coherent()'); b.eval(RUN_TO + '(4)')
    i = b.eval(INFO)
    check(i['minW'] > -1e-9 and i['from'] == 'W', f"coherent: W >= 0 (min pi W = {i['minW']:.1e}), points drawn from W")
    check(abs(i['sxsp'] - 0.5) < 1e-4, f"coherent: sigma_x sigma_p stays hbar/2 ({i['sxsp']:.6f})")
    check(abs(i['E'] - 5.0) < 1e-3 and abs(i['Ecl'] - i['E']) < 0.1, f"coherent: <E> = {i['E']:.4f} (exact 5), classical points {i['Ecl']:.4f}")
    b.sleep(0.3)
    ro = b.eval("[...document.querySelectorAll('#readouts .g')].map((e) => e.textContent.replace(/\\s+/g, ' ').trim())")
    neg = b.eval("document.getElementById('neg').textContent.replace(/\\s+/g, ' ')")
    check(any(r.startswith('uncertainty') and '0.500 (limit ħ/2 = 0.5)' in r for r in ro) and any(r.startswith('energy') and '5.000' in r and 'classical points' in r for r in ro),
          f'coherent: the readouts say what they are: {ro}')
    check(neg.startswith('Blue is W < 0') and 'least W 0.000/πħ' in neg and 'volume 0.000' in neg, f'coherent: the legend says W is nowhere negative: "{neg}"')
    # 2. A squeezed state breathes: sigma_x oscillates at twice the frequency, W stays positive.
    b.eval('__app.setups.squeezed()'); b.eval(RESTART)
    sx = []
    for t in [0, PI / 4, PI / 2, 3 * PI / 4, PI]:
        b.eval(RUN_TO + f'({t})'); sx.append(b.eval(INFO)['sx'])
    # Squeezed by r = 0.8 along x: sigma_x = e^-r / sqrt 2 at t = 0 and pi, e^r / sqrt 2 at pi/2.
    lo, hi = math.exp(-0.8) / math.sqrt(2), math.exp(0.8) / math.sqrt(2)
    check(abs(sx[0] - lo) < 1e-3 and abs(sx[4] - lo) < 1e-3 and abs(sx[2] - hi) < 1e-3 and abs(sx[1] - sx[3]) < 1e-3,
          f"squeezed: sigma_x at t = 0, pi/4, pi/2, 3pi/4, pi: {', '.join(f'{v:.4f}' for v in sx)} ({lo:.4f} and {hi:.4f} expected: period pi)")
    check(b.eval(INFO)['minW'] > -1e-6, 'squeezed: W >= 0')
    # 10. Tilted (r = 1.2 at 30 deg): sigma_x sigma_p is 2.42, but the ellipse's area over pi,
    # sqrt(sigma_x^2 sigma_p^2 - cov^2), is hbar/2: the moments of W itself, over a window
    # zoomed out so that it holds the whole ellipse (the preset's would cut its tails at 2.7 sigma).
    b.eval('__app.setups.uncertainty()'); b.eval(RESTART)
    sxsp0 = b.eval(INFO)['sxsp']
    b.eval("__app.go('harmonic', { init: { kind: 'squeezed', x0: 0, p0: 0, r: 1.2, theta: 30 }, zoom: 2, run: false })")
    u = b.eval('''(() => { const g = __app.grid, W = g.W; let s = 0, x = 0, p = 0, xx = 0, pp = 0, xp = 0;
      for (let c = 0; c < g.cols; c++) for (let r = 0; r < g.rows; r++) { const w = W[c * g.rows + r], X = g.x[c], P = g.p[r];
        s += w; x += w * X; p += w * P; xx += w * X * X; pp += w * P * P; xp += w * X * P; }
      x /= s; p /= s; const vx = xx / s - x * x, vp = pp / s - p * p, cv = xp / s - x * p;
      const o = __app.sim.observables(); return { sxsp: o.sx * o.sp, det: Math.sqrt(vx * vp - cv * cv), total: s * g.cell }; })()''')
    check(round(sxsp0, 2) == 2.42 and abs(u['sxsp'] - sxsp0) < 1e-9 and abs(u['det'] - 0.5) < 2e-3,
          f"uncertainty: sigma_x sigma_p = {sxsp0:.4f} (help: 2.42), sqrt(sigma_x^2 sigma_p^2 - cov^2) from W = {u['det']:.4f} (hbar/2), W integrates to {u['total']:.4f}")
    # 3. |1>: W(0,0) = -1/pi hbar, and it stays.
    b.eval('__app.setups.number()'); b.eval(RUN_TO + '(2)')
    i = b.eval(INFO)
    check(abs(i['W00'] + 1) < 1e-3 and abs(i['minW'] + 1) < 1e-3, f"|1>: pi W(0,0) = {i['W00']:.5f}, min pi W = {i['minW']:.5f} (exact -1)")
    b.sleep(0.3)
    neg = b.eval("document.getElementById('neg').textContent.replace(/\\s+/g, ' ')")
    check('least W −1.000/πħ' in neg, f'|1>: the legend says so: "{neg}"')
    check(i['from'] == 'Q', f"|1>: W < 0, so the points come from the Husimi Q ({i['from']}), classical <E> {i['Ecl']:.3f} vs {i['E']:.3f} + 1/2")
    b.eval('document.querySelectorAll("#state-box input[type=number]")[5].value = 4; document.querySelectorAll("#state-box input[type=number]")[5].dispatchEvent(new Event("change"))')
    b.sleep(0.3)
    i = b.eval(INFO)
    check(abs(i['W00'] - 1) < 1e-3 and abs(i['E'] - 4.5) < 1e-3, f"|4> (typed into the n box): pi W(0,0) = {i['W00']:.5f} (exact +1), <E> = {i['E']:.4f}")
    # 4. Even and odd cats: W(0,0) = parity / pi hbar.
    b.eval('__app.setups.cat()'); b.eval(RUN_TO + '(1)')
    i = b.eval(INFO)
    check(abs(i['W00'] - 1) < 1e-3, f"even cat: pi W(0,0) = {i['W00']:.5f} at t = 1 (exact +1, the parity)")
    b.eval("__app.go('harmonic', { init: { kind: 'cat', x0: 3, p0: 0, phi: 180 }, run: false })")
    i = b.eval(INFO)
    check(abs(i['W00'] + 1) < 1e-3, f"odd cat: pi W(0,0) = {i['W00']:.5f} (exact -1)")
    # 5. The marginals: blobs at +-p0 make fringes in |psi(x)|^2 (a standing wave), none in |phi(p)|^2.
    b.eval('__app.setups.marginals()')
    fr = b.eval('''(() => { const a = __app, g = a.grid, xm = Array.from(g.xMarginal()), pm = Array.from(g.pMarginal());
      return { xm, pm, px: Math.max(...xm), pp: Math.max(...pm) }; })()''')
    # |psi(x)|^2 = e^{-x^2} cos^2(3x) / norm: fringes at 0, +-pi/3, +-2pi/3 (heights 1, 0.33, 0.012).
    nx, np_ = local_maxima(fr['xm'], 0.005 * fr['px']), local_maxima(fr['pm'], 0.005 * fr['pp'])
    check(nx == 5 and np_ == 2, f"marginals: |psi(x)|^2 has {nx} fringes, |phi(p)|^2 has {np_} peaks")
    # 6. Free motion: sigma_p does not change, sigma_x grows as the shear predicts, W stays positive.
    b.eval('__app.setups.free()'); b.eval(RESTART)
    i0 = b.eval(INFO); b.eval(RUN_TO + '(4)'); i1 = b.eval(INFO)
    # For a Gaussian, sigma_x(t)^2 = sigma_x^2 + 2 t cov(x,p) + t^2 sigma_p^2 (cov = 0 here).
    pred = math.sqrt(i0['sx'] ** 2 + 16 * i0['sp'] ** 2)
    check(abs(i1['sp'] - i0['sp']) < 1e-6 and abs(i1['sx'] - pred) < 1e-4 and i1['minW'] > -1e-6,
          f"free: sigma_p {i0['sp']:.5f} -> {i1['sp']:.5f}, sigma_x {i0['sx']:.4f} -> {i1['sx']:.4f} (predicted {pred:.4f}), W >= 0")
    # The help: a larger p0 travels faster but shears just the same; a harder squeeze shears faster.
    b.eval("__app.go('free', { init: { kind: 'squeezed', x0: -5, p0: 3, r: 0.3, theta: 0 }, run: false })"); b.eval(RUN_TO + '(4)'); i3 = b.eval(INFO)
    b.eval("__app.go('free', { init: { kind: 'squeezed', x0: -5, p0: 1, r: 0.8, theta: 0 }, run: false })"); b.eval(RUN_TO + '(4)'); i8 = b.eval(INFO)
    check(abs(i3['sx'] - i1['sx']) < 1e-4 and i8['sx'] > 1.5 * i1['sx'],
          f"free: at t = 4 sigma_x is {i1['sx']:.3f} for p0 = 1 and {i3['sx']:.3f} for p0 = 3 (the same shear), {i8['sx']:.3f} when squeezed harder (r = 0.8)")
    # 7. The anharmonic well: the classical points conserve energy while W grows negative regions.
    b.eval('__app.setups.anharmonic()'); b.eval(RESTART)
    i0 = b.eval(INFO); b.eval(RUN_TO + '(10)'); i1 = b.eval(INFO)
    check(i0['neg'] < 1e-4 and abs(i1['neg'] - 0.9) < 0.05, f"anharmonic: negative volume of W {i0['neg']:.1e} at t = 0, {i1['neg']:.2f} at t = 10 (help: 0.9)")
    b.sleep(0.3)
    neg = b.eval("document.getElementById('neg').textContent.replace(/\\s+/g, ' ')")
    check(f"volume {i1['neg']:.3f}" in neg and f"least W {i1['minW']:.3f}".replace('-', '−') in neg, f'anharmonic: the legend under the plot says how negative: "{neg}"')
    check(abs(i1['Ecl'] - i0['Ecl']) < 1e-3 * abs(i0['Ecl']) and abs(i1['E'] - i0['E']) < 1e-4 * i0['E'],
          f"anharmonic: classical <E> {i0['Ecl']:.5f} -> {i1['Ecl']:.5f}, quantum {i0['E']:.6f} -> {i1['E']:.6f}")
    b.screenshot('build/ps-anharmonic-t10.png')
    # 8. Morse n = 4: <E> is the level E_4.
    b.eval('__app.setups.orbits()')
    i = b.eval(INFO)
    check(abs(i['E'] - i['levels'][4]) < 1e-3, f"Morse |4>: <E> = {i['E']:.5f}, E_4 = {i['levels'][4]:.5f}")
    # 9. Tunnelling: across in half the period 2 pi / (E1 - E0); the classical points stay left.
    b.eval('__app.setups.tunnel()'); b.eval(RESTART)
    i = b.eval(INFO)
    T = 2 * PI / (i['levels'][1] - i['levels'][0])
    b.eval(RUN_TO + f'({T / 2})'); i = b.eval(INFO)
    check(i['left'] < 0.02 and i['clRight'] < 0.1, f"tunnelling: P(x < 0) = {i['left']:.4f} at t = T/2 = {T / 2:.2f}; classical points on the right: {i['clRight']:.3f}")
    check(abs(i['Ecl'] - i['E']) < 0.03, f"tunnelling: points from |psi|^2 |phi|^2 have the quantum mean energy ({i['Ecl']:.4f} vs {i['E']:.4f})")
    b.screenshot('build/ps-tunnel-half.png')
    b.eval(RUN_TO + f'({T})')
    check(b.eval(INFO)['left'] > 0.98, f"tunnelling: back on the left after T = {T:.2f}")
    # 11. Husimi Q is never negative.
    b.eval('__app.setups.husimi()')
    q = b.eval('(() => { const g = __app.grid; let m = Infinity; for (const v of g.Q) m = Math.min(m, v); return m; })()')
    check(q > -1e-12, f'husimi: min Q = {q:.1e}')
    # 12. Tomography: in the oscillator the x marginal at time t is the shadow of W(0) at theta = t.
    b.eval('__app.setups.tomography()'); b.eval(RESTART)
    sh = b.eval('''(() => { const a = __app, g = a.grid, th = 0.9, nb = 120;
      const P = Array.from(g.quadrature(g.W, th, 1, -6, 6, nb));
      a.state.running = false; while (a.sim.t < th - 1e-9) a.advance(Math.min(0.01, th - a.sim.t)); a.computePhase();
      const X = Array.from(g.quadrature(g.W, 0, 1, -6, 6, nb));
      return Math.max(...P.map((v, i) => Math.abs(v - X[i]))) / Math.max(...X); })()''')
    check(sh < 0.005, f'tomography: |psi(x, t)|^2 against the shadow of W(0) at theta = t: largest difference {sh:.4f} of the peak')

    # What the hint says to drag: the handle lights up under the pointer, with a "grab" cursor
    # there and a crosshair (press to place the blob) elsewhere.
    b.eval('__app.setups.coherent()'); b.eval('__app.state.running = false')
    b.sleep(0.3)
    hx, hy = b.eval('''(() => { const f = __app.frame(), r = document.getElementById("plot").getBoundingClientRect(), it = __app.state.init;
      return [r.left + f.X(it.x0), r.top + f.Y(it.p0)]; })()''')
    b.mouse('mouseMoved', hx + 4, hy - 3); b.sleep(0.3)
    on = b.eval('[__app.hot, document.getElementById("plot").style.cursor]')
    b.mouse('mouseMoved', hx + 90, hy + 70); b.sleep(0.3)
    off = b.eval('[__app.hot, document.getElementById("plot").style.cursor]')
    check(on == [True, 'grab'] and off == [False, 'crosshair'], f'the handle lights up under the pointer, with a grab cursor ({on}); elsewhere {off}')
    # Dragging a coherent state moves it.  The handle is at (3, 0); drag it to (-2, 1.5).
    pts = b.eval('''(() => { const f = __app.frame(); const r = document.getElementById("plot").getBoundingClientRect();
      return [(f.X(3)) / r.width, (f.Y(0)) / r.height, f.X(-2) / r.width, f.Y(1.5) / r.height]; })()''')
    b.drag('#plot', (pts[0], pts[1]), (pts[2], pts[3]), steps=10)
    b.sleep(0.5)
    st = b.eval('__app.state.init')
    i = b.eval(INFO)
    check(abs(st['x0'] + 2) < 0.1 and abs(st['p0'] - 1.5) < 0.1 and abs(i['E'] - (4 + 2.25 + 1) / 2) < 0.15,
          f"dragging moves the coherent state to ({st['x0']:.2f}, {st['p0']:.2f}), <E> = {i['E']:.3f}")

    # The arrow keys move it too, straight after the drag (the press focused the plot).
    focused = b.eval('document.activeElement && document.activeElement.id')
    x0 = b.eval('__app.state.init.x0')
    b.key('ArrowRight', 'ArrowRight'); b.sleep(0.3)
    check(focused == 'plot' and b.eval('__app.state.init.x0') > x0 + 0.1, f"the right arrow key moves the state straight after a drag ({x0:.2f} -> {b.eval('__app.state.init.x0'):.2f}; focus on '{focused}')")
    # Hovering reads W off the plot.
    hx, hy = b.point('#plot', (0.5, 0.55))
    b.mouse('mouseMoved', hx, hy); b.sleep(0.3)
    hov = b.eval('document.getElementById("hover").textContent')
    check('W =' in hov and '/πħ' in hov, f'hovering shows W: "{hov}"')

    # The read-outs keep still: while the state runs round (<x>, <p> change sign), with the
    # colour scale on Auto, under the moving pointer, and in the numerics note as the window changes.
    b.eval('__app.setups.coherent()'); b.sleep(0.5)
    b.eval("[...document.querySelectorAll('button')].find((x) => x.textContent === 'Auto').click()")
    b.eval('__app.state.running = true'); b.sleep(0.5)
    xs = set()
    def frame():
        # Wait for the clock to move on by 0.6 (a tenth of a period), however slow the machine.
        t, t0 = b.eval('__app.sim.t'), time.time()
        while time.time() - t0 < 10 and b.eval('__app.sim.t') < t + 0.6: time.sleep(0.1)
        time.sleep(0.15); xs.add(b.eval('Math.sign(__app.sim.observables().x)'))
    still(b, 'while it runs', READOUTS, '#readouts, .legend', [frame] * 12)
    check(len(xs) == 2, f'(and <x> took both signs while it ran: {sorted(xs)})')
    b.eval('__app.state.running = false'); b.sleep(0.3)
    def hover_at(fx, fy):
        def go():
            x, y = b.point('#plot', (fx, fy)); b.mouse('mouseMoved', x, y); time.sleep(0.3)
        return go
    still(b, 'under the pointer', READOUTS, '#readouts, .legend', [hover_at(fx, fy) for fx, fy in ((0.3, 0.3), (0.62, 0.71), (0.45, 0.5), (0.8, 0.2), (0.2, 0.85), (0.55, 0.4))])
    b.mouse('mouseMoved', 2, 2)
    b.eval("document.getElementById('numerics').open = true")
    def window(v):
        def go():
            b.eval(f'''(() => {{ const box = [...document.querySelectorAll("#numerics-box .slider")].find((d) => d.textContent.includes("window")).querySelector("input[type=number]");
              box.value = {v}; box.dispatchEvent(new Event("change")); }})()''')
            t0 = time.time()
            while time.time() - t0 < 10 and abs(b.eval('__app.state.zoom') - v) > 1e-9: time.sleep(0.2)
            time.sleep(1.3)    # the note is written once a second
        return go
    still(b, 'the numerics note as the window changes', '#numerics-box .note, #numerics-box .note .fixnum', '#numerics-box', [window(v) for v in (1.3, 0.7, 2.2, 1.05, 1.6)], min_compared=2)
    b.eval("document.getElementById('numerics').open = false")
    b.eval("[...document.querySelectorAll('button')].find((x) => x.textContent.startsWith('Colours to')).click()")

    # Typed wave functions, the help's examples.
    b.eval('__app.setups.typed()'); b.eval('__app.state.running = false')
    for src, w00 in [('exp(-x^2/2) (1 + x)', None), ('exp(-(x-2)^2) + exp(-(x+2)^2)', 1), ('exp(-x^2/2) cos(k x)', 1), ('x exp(-x^2/2)', -1)]:
        b.eval(f'(() => {{ const i = document.querySelector("#state-box .expr input"); i.value = {json.dumps(src)}; i.dispatchEvent(new Event("change")); }})()')
        b.sleep(0.4)
        b.eval('__app.restart()')
        i = b.eval(INFO)
        ok = not b.eval('__app.error') and abs(i['norm'] - 1) < 1e-9 and (w00 is None or abs(i['W00'] - w00) < 1e-3)
        check(ok, f"typed psi0 = {src}: normalised, pi W(0,0) = {i['W00']:.4f}" + ('' if w00 is None else f' (the parity, {w00:+d})'))

    # A wider window: more levels fit, and the points start again with the state.
    b.eval('__app.setups.number()'); b.sleep(0.3)
    before = b.eval('[__app.levels.length, __app.grid.x1]')
    b.eval('''(() => { const box = [...document.querySelectorAll("#numerics-box .slider")].find((d) => d.textContent.includes("window")).querySelector("input[type=number]");
      box.value = 2; box.dispatchEvent(new Event("change")); })()''')
    b.sleep(0.6)
    after = b.eval('[__app.levels.length, __app.grid.x1, __app.ens.N, __app.state.zoom]')
    check(after[0] > before[0] and after[1] > 1.5 * before[1] and after[2] > 0, f'zooming out: {before[0]} -> {after[0]} levels in the window, x up to {before[1]:.1f} -> {after[1]:.1f}, {after[2]} points')

    # A link carries the set-up.
    b.eval("__app.go('morse', { init: { kind: 'squeezed', x0: 1, p0: 1, r: 0.4, theta: 20 }, view: 'Q', show: { dots: false, quadrature: true }, quad: 45, run: false })")
    b.sleep(0.3)
    h = b.eval('location.hash')
    b.call('Page.navigate', url='about:blank'); time.sleep(0.3)
    b.goto('phasespace/index.html' + h)
    b.wait('window.__app && __app.ready'); b.sleep(0.5)
    st = b.eval('({ pot: __app.state.pot.id, init: __app.state.init, view: __app.state.view, show: __app.state.show, quad: __app.state.quad })')
    check(st['pot'] == 'morse' and st['init']['kind'] == 'squeezed' and abs(st['init']['r'] - 0.4) < 1e-9 and st['view'] == 'Q'
          and not st['show']['dots'] and st['show']['quadrature'] and st['quad'] == 45, f'the address carries the set-up ({h[:60]}...)')
    b.call('Page.navigate', url='about:blank'); time.sleep(0.3)
    b.goto('phasespace/index.html#setup=cat')
    b.wait('window.__app && __app.ready'); b.sleep(0.5)
    check(b.eval('__app.state.init.kind') == 'cat', '#setup=cat opens the cat experiment')
    b.call('Page.navigate', url='about:blank'); time.sleep(0.3)
    b.goto('phasespace/index.html#setup=tunnel&t=28.09')
    b.wait('window.__app && __app.ready'); b.sleep(0.3)
    i = b.eval('({ t: __app.sim.t, left: __app.sim.probabilityLeftOf(0) })')
    check(abs(i['t'] - 28.09) < 1e-6 and i['left'] < 0.02, f"#setup=tunnel&t=28.09 opens it paused at t = {i['t']:.2f}, tunnelled (P(x < 0) = {i['left']:.4f})")

    # A state with no centre: the hint says so, and what to choose instead.
    b.eval('__app.setups.number()'); b.sleep(0.3)
    hint = b.eval("document.getElementById('hint').textContent")
    check(hint.startswith('This kind of state has no centre to drag') and 'Coherent' in hint, f'|1>: the hint says there is nothing to drag: "{hint[:60]}..."')

    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

# The dark theme at desktop size: the first screen reads there too.
with Browser('about:blank', size=(1400, 900)) as b:
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
    b.goto('phasespace/index.html')
    b.wait('window.__app && __app.ready'); b.sleep(1.5)
    first_screen(b, 'desktop, dark')
    b.screenshot('build/ps-dark.png')

# A phone-sized window, light and dark: the opening screen, then the cat and the quartic well.
with Browser('phasespace/index.html', size=(390, 844)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1.5)
    w = b.eval('document.documentElement.scrollWidth')
    check(w <= 390, f'phone: no horizontal scrolling (page width {w})')
    first_screen(b, 'phone, light')
    order = b.eval("[...document.querySelectorAll('main > *, main .stage > *')].map((e) => e.id || e.className.split(' ')[0])")
    check(order.index('readouts') < order.index('plot-wrap') < order.index('hint') < order.index('legend') < order.index('controls'),
          f'phone: the readouts, the picture, the hint and the legend come before the controls ({order})')
    # (Through about:blank: a change of hash alone would not reload the page.)
    b.call('Page.navigate', url='about:blank'); time.sleep(0.3)
    b.goto('phasespace/index.html#setup=cat')
    b.wait('window.__app && __app.ready'); b.sleep(1)
    check(b.eval("document.getElementById('hint').textContent").startswith('Drag either blob'), 'phone: the cat state says to drag either blob')
    b.screenshot('build/ps-phone.png')
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
    b.call('Page.navigate', url='about:blank'); time.sleep(0.3)
    b.goto('phasespace/index.html')
    b.wait('window.__app && __app.ready'); b.sleep(1.5)
    first_screen(b, 'phone, dark')
    b.call('Page.navigate', url='about:blank'); time.sleep(0.3)
    b.goto('phasespace/index.html#setup=anharmonic')
    b.wait('window.__app && __app.ready'); b.sleep(2)
    b.screenshot('build/ps-phone-dark.png')
    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'phone and dark: no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
