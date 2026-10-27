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

with Browser('phasespace/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready')
    try: b.wait('__app.sim.t > 0.2', timeout=15)
    except TimeoutError: pass
    info = b.eval(INFO)
    check(info['t'] > 0.2, f"it opens running (t = {info['t']:.2f}): a coherent state in the quartic well")
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
    # 3. |1>: W(0,0) = -1/pi hbar, and it stays.
    b.eval('__app.setups.number()'); b.eval(RUN_TO + '(2)')
    i = b.eval(INFO)
    check(abs(i['W00'] + 1) < 1e-3 and abs(i['minW'] + 1) < 1e-3, f"|1>: pi W(0,0) = {i['W00']:.5f}, min pi W = {i['minW']:.5f} (exact -1)")
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
    # 7. The anharmonic well: the classical points conserve energy while W grows negative regions.
    b.eval('__app.setups.anharmonic()'); b.eval(RESTART)
    i0 = b.eval(INFO); b.eval(RUN_TO + '(10)'); i1 = b.eval(INFO)
    check(i0['neg'] < 1e-4 and i1['neg'] > 0.3, f"anharmonic: negative volume of W {i0['neg']:.1e} at t = 0, {i1['neg']:.2f} at t = 10")
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

    # Dragging a coherent state moves it.
    b.eval('__app.setups.coherent()'); b.eval('__app.state.running = false')
    b.sleep(0.3)
    # The handle is at (3, 0); drag it to (-2, 1.5).
    pts = b.eval('''(() => { const f = __app.frame(); const r = document.getElementById("plot").getBoundingClientRect();
      return [(f.X(3)) / r.width, (f.Y(0)) / r.height, f.X(-2) / r.width, f.Y(1.5) / r.height]; })()''')
    b.drag('#plot', (pts[0], pts[1]), (pts[2], pts[3]), steps=10)
    b.sleep(0.5)
    st = b.eval('__app.state.init')
    i = b.eval(INFO)
    check(abs(st['x0'] + 2) < 0.1 and abs(st['p0'] - 1.5) < 0.1 and abs(i['E'] - (4 + 2.25 + 1) / 2) < 0.15,
          f"dragging moves the coherent state to ({st['x0']:.2f}, {st['p0']:.2f}), <E> = {i['E']:.3f}")

    # The arrow keys move it too.
    b.eval('document.getElementById("plot").focus()')
    x0 = b.eval('__app.state.init.x0')
    b.key('ArrowRight', 'ArrowRight'); b.sleep(0.3)
    check(b.eval('__app.state.init.x0') > x0 + 0.1, f"the right arrow key moves the state ({x0:.2f} -> {b.eval('__app.state.init.x0'):.2f})")
    # Hovering reads W off the plot.
    hx, hy = b.point('#plot', (0.5, 0.55))
    b.mouse('mouseMoved', hx, hy); b.sleep(0.3)
    hov = b.eval('document.getElementById("hover").textContent')
    check('W =' in hov and '/πħ' in hov, f'hovering shows W: "{hov}"')

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

    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

# A phone-sized window, and the dark theme.
with Browser('phasespace/index.html#setup=cat', size=(400, 850)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1.5)
    w = b.eval('document.documentElement.scrollWidth')
    check(w <= 400, f'phone: no horizontal scrolling (page width {w})')
    b.screenshot('build/ps-phone.png')
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
    b.goto('phasespace/index.html#setup=anharmonic')
    b.wait('window.__app && __app.ready'); b.sleep(2)
    b.screenshot('build/ps-phone-dark.png')
    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'phone and dark: no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
