#!/usr/bin/env python3
"""Drive the radiation demo: drag the charge, run every experiment, check the physics read-outs."""
import json, math, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

def charge(b):
    return b.eval('__app.charge()')

def gamma(beta):
    return 1 / math.sqrt(1 - beta * beta)

with Browser('radiation/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1.5)
    b.screenshot('build/rad-start.png')
    n = len(b.eval('__app.lines'))
    check(b.eval('__app.state.preset') == 'shuttle' and n == 24, f'it opens on the start-and-stop motion with {n} field lines')

    # Dragging: from rest at the centre, a fast drag to the right.  Far away, nothing has
    # heard yet: the field there is still Coulomb's, centred where the charge was.
    b.eval('__app.setups.coulomb()'); b.sleep(0.5)
    t0 = b.eval('__app.charge().t')
    b.drag('#field', (0.5, 0.5), (0.8, 0.35), steps=12, pause=0.01)
    b.sleep(0.15)
    c0 = charge(b)
    check(b.eval('__app.mode') == 'hand', 'grabbing the charge hands it to the pointer')
    bmax = b.eval(f'(() => {{ const T = __app.traj; let m = 0; for (let t = {t0}; t <= T.tEnd; t += 0.002) {{ T.at(t); m = Math.max(m, Math.hypot(T.vx, T.vy)); }} return m / __app.state.c; }})()')
    check(0.3 < bmax <= 0.98, f'a quick drag is relativistic but stays below c: β max {bmax:.3f}')
    # A point farther than c (t - t0) from the start: Coulomb from the origin.
    dt = c0['t'] - t0
    far = [-9.5, -9.5] if c0['c'] * dt < 13 else None
    if far:
        f = b.eval(f'__app.field({far[0]}, {far[1]})')
        r = math.hypot(*far)
        check(abs(f['ex'] - far[0] / r**3) < 1e-9 and abs(f['ey'] - far[1] / r**3) < 1e-9,
              f'{r:.1f} units away, {dt:.2f} s after the drag began, the field is still Coulomb\'s from where the charge was')
    b.sleep(1.5)
    c1 = charge(b)
    sp = math.hypot(c1['vx'], c1['vy'])
    check(sp < 0.05 * c1['c'], f'let go, it comes to rest (β = {sp / c1["c"]:.4f}) at ({c1["x"]:.2f}, {c1["y"]:.2f})')
    b.screenshot('build/rad-drag.png')

    times = {}
    for name in b.eval('Object.keys(__app.setups)'):
        b.eval(f'__app.setups[{json.dumps(name)}]()'); b.sleep(2.0)
        b.screenshot(f'build/rad-exp-{name}.png')
        times[name] = b.eval('__app.frameMs')
    print('      frame times (ms, headless, no GPU): ' + ', '.join(f'{k} {v:.0f}' for k, v in times.items()))

    # Coulomb: |E| r² = 1.
    b.eval('__app.setups.coulomb()'); b.sleep(0.3)
    f = b.eval('__app.field(5, 3)')
    check(abs(math.hypot(f['ex'], f['ey']) * 34 - 1) < 1e-9, 'at rest: Coulomb, |E| r² = q/4πε₀ = 1')

    # Uniform motion: the field points from the present position; γ³ between across and along.
    b.eval('__app.setups.heaviside()'); b.sleep(0.5)
    # (All in one call: the charge moves on between calls.)
    fa, fp = b.eval('(() => { const q = __app.charge(); return [__app.field(q.x + 3, q.y), __app.field(q.x, q.y + 3)]; })()')
    ratio = math.hypot(fp['ex'], fp['ey']) / math.hypot(fa['ex'], fa['ey'])
    check(abs(fa['ey']) < 1e-9 * abs(fa['ex']) and abs(fp['ex']) < 1e-9 * abs(fp['ey']) and abs(ratio - gamma(0.8)**3) < 1e-6,
          f'uniform motion at β = 0.8: E points from the present position; across/along = {ratio:.4f} = γ³')

    # Dipole: Larmor, and nothing along the axis.
    b.eval('__app.setups.dipole()'); b.sleep(0.6)
    q = charge(b)
    from_axis = b.eval('__app.dPdOmega(Math.PI / 2)') / max(b.eval('__app.dPdOmega(0)'), 1e-300)
    log = b.eval('__app.powerLog.slice(-40)')
    worst = max(abs(P / L - 1) for _, P, L in log if L > 1e-9)
    check(from_axis < 1e-20 and worst <= gamma(0.1)**6 - 1 + 1e-9, f'slow dipole (β ≤ 0.1): no power along the axis (ratio {from_axis:.1e}); Liénard within {worst * 100:.1f}% of Larmor (γ⁶ − 1 ≤ 3.1%)')
    b.eval('__app.setups.axis()'); b.sleep(1.2)
    pr = b.eval('__app.probe')
    check(pr['ea'] == 0 and pr['ev'] > 0, f'a probe on the axis: |E_acc| = {pr["ea"]}, |E_vel| = {pr["ev"]:.4f}')

    # Fast dipole: Liénard/Larmor = γ⁶ (motion along a line).
    b.eval('__app.setups.fastdipole()'); b.sleep(0.7)
    q, (P, L) = b.eval('[__app.charge(), __app.powerLog.at(-1).slice(1)]')
    be = math.hypot(q['vx'], q['vy']) / q['c']
    check(abs(P / L / gamma(be)**6 - 1) < 1e-6, f'fast dipole at β = {be:.3f}: P/P_Larmor = {P / L:.4f} = γ⁶')

    # Circles: γ⁴; the 1/γ beam.
    for name, beta in (('power', 0.7), ('synchrotron', 0.9)):
        b.eval(f'__app.setups.{name}()'); b.sleep(0.5)
        P, L = b.eval('__app.powerLog.at(-1).slice(1)')
        check(abs(P / L / gamma(beta)**4 - 1) < 1e-6, f'circle at β = {beta}: P/P_Larmor = {P / L:.4f} = γ⁴ = {gamma(beta)**4:.4f}')
    q = charge(b)
    phv = math.atan2(q['vy'], q['vx'])
    half = b.eval(f'(() => {{ const m = __app.dPdOmega({phv}); let d = 0; while (__app.dPdOmega({phv} + d) > m / 2) d += 1e-4; return d; }})()')
    check(0.2 / gamma(0.9) < half < 1 / gamma(0.9), f'synchrotron beam: half power {half:.3f} rad either side of v (1/γ = {1 / gamma(0.9):.3f})')

    # Constant proper acceleration: constant Liénard power (2/3) g²/c³ while it lasts.
    b.eval('__app.setups.hyperbolic()'); b.sleep(3.5)
    c = b.eval('__app.state.c'); g = 1.0 * c
    Ps = [P for _, P, L in b.eval('__app.powerLog') if P > 0]
    flat = sorted(Ps)[len(Ps) // 2] if Ps else 0
    expect = (2 / 3) * g * g / c**3
    check(abs(flat / expect - 1) < 1e-6 and len(Ps) > 20, f'uniform acceleration: P = {flat:.5f} = (2/3)g²/c³ = {expect:.5f} throughout ({len(Ps)} frames)')

    # The far-field experiment: the probe's peak radiation field at 8 and at 4 units.
    peaks = {}
    for y in (8, 4):
        b.eval('__app.setups.far()'); b.eval(f'__app.setProbe(0, {y})'); b.sleep(4.2 if y == 8 else 3.6)
        pr = b.eval('__app.probe')
        peaks[y] = (pr['peak'], pr['ev'])
    p8, e8 = peaks[8]; p4, e4 = peaks[4]
    print(f'      far: peak |E_acc| {p8:.3f} at 8 units ({p8 / e8:.1f} times |E_vel| {e8:.4f}); {p4:.3f} at 4 ({p4 / e4:.1f} times {e4:.4f})')
    check(1.8 < p4 / p8 < 2.2 and 3.8 < e4 / e8 < 4.2, f'the radiation field falls as 1/R ({p4 / p8:.2f}x from 8 to 4 units), Coulomb\'s as 1/R² ({e4 / e8:.2f}x)')

    # A typed path, and one too fast to follow exactly.
    b.eval("__app.startMotion('typed')"); b.sleep(0.5)
    check(b.eval('__app.mode') == 'preset', 'a typed figure eight is followed exactly')
    b.eval("""(() => { const f = document.querySelector('#typed input'); f.value = '10 cos(3 t)'; f.dispatchEvent(new Event('change')); })()""")
    b.sleep(1.0)
    note = b.eval("document.querySelector('#motion-note').textContent")
    q = charge(b)
    check(b.eval('__app.mode') == 'chase' and 'too fast' in note and math.hypot(q['vx'], q['vy']) < 0.98 * q['c'],
          f'a typed path at β = 3.75 is chased instead ("{note[:40]}...")')
    b.screenshot('build/rad-typed.png')

    # The speed of light.
    b.eval('__app.setups.power()'); b.sleep(0.3)
    b.eval("""(() => { const box = [...document.querySelectorAll('#c-box input[type=number]')][0]; box.value = 4; box.dispatchEvent(new Event('change')); })()""")
    b.sleep(0.4)
    q = charge(b)
    check(b.eval('__app.state.c') == 4 and abs(math.hypot(q['vx'], q['vy']) / 4 - 0.7) < 1e-9, 'typing c = 4 keeps the circle at β = 0.7')

    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

# A link to a set-up, and the help drawer, at phone width.
with Browser('radiation/index.html#m=circle&c=6&p_beta=0.5&p_radius=1.5&map=flux&n=12&probe=3.00,4.00', size=(400, 850)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1.5)
    s = b.eval('__app.state')
    check(s['preset'] == 'circle' and s['c'] == 6 and s['map'] == 'flux' and s['count'] == 12 and s['probe'] and b.eval('__app.values.circle.beta') == 0.5,
          'the address bar carries the motion, its parameters and the display')
    b.screenshot('build/rad-phone.png')
    wide = b.eval('document.documentElement.scrollWidth')
    check(wide <= 400, f'nothing sticks out sideways at phone width ({wide} px)')
    b.eval('window.scrollTo(0, 700)'); b.sleep(0.3)
    b.screenshot('build/rad-phone-controls.png')
    b.eval('window.scrollTo(0, 0)')
    b.eval("location.hash = 'setup=synchrotron'; location.reload()"); b.sleep(0.5)
    b.wait('window.__app && __app.ready'); b.sleep(1.5)
    check(b.eval('__app.state.preset') == 'circle' and b.eval('__app.values.circle.beta') == 0.9, '#setup=synchrotron opens that experiment')
    b.click('#help-button'); b.sleep(0.5)
    b.screenshot('build/rad-phone-help.png')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions at phone width' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
