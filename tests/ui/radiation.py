#!/usr/bin/env python3
"""Drive the radiation demo: drag the charge, run every experiment, check the physics read-outs.

The machine running this may be busy: the demo's clock follows the wall clock only while it
keeps up (a frame advances it by 0.1 s at most), so waits are measured on the demo's own clock
and polled, with generous caps.  A section that fails says why and the others still run.
"""
import json, math, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

class Slow(Exception):
    pass

def section(name, fn, *args):
    """Run one part of the test; an exception becomes a failed check with a message."""
    try:
        fn(*args)
    except Exception as e:
        lines = str(e).strip().splitlines()
        check(False, f'{name}: {type(e).__name__}: {lines[0] if lines else ""}')

def charge(b):
    return b.eval('__app.charge()')

def gamma(beta):
    return 1 / math.sqrt(1 - beta * beta)

def ready(b, cap=180):
    b.wait('window.__app && __app.ready && !window.__old', timeout=cap)

def run_for(b, seconds, cap=240):
    """Let the demo run `seconds` of its own time (polling, up to `cap` seconds of wall time)."""
    t0, w0 = b.eval('__app.traj.tEnd'), time.time()
    while True:
        t = b.eval('__app.traj.tEnd')
        if t - t0 >= seconds:
            return
        if time.time() - w0 > cap:
            raise Slow(f'the demo ran only {t - t0:.2f} of {seconds} s in {cap} s (machine too busy?)')
        b.sleep(0.1)

# The read-outs must not jiggle: over many frames, with the numbers changing, every label and
# every number's slot stays where it was (the HTML read-outs and the labels drawn on canvases).
STEADY = """new Promise((res) => {
  const out = [];
  const grab = () => {
    const els = [...document.querySelectorAll('#readout .lab, #readout .num')].filter((e) => e.offsetParent);
    out.push({ pos: els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left * 100) / 100, Math.round(r.top * 100) / 100, Math.round(r.width * 100) / 100]; }),
               text: [...document.querySelectorAll('#readout .num')].map((e) => e.textContent).join('|'),
               canvas: JSON.stringify(__app.canvasLabels) });
    if (out.length < FRAMES) requestAnimationFrame(grab); else res(out);
  };
  requestAnimationFrame(grab);
})"""

def steady_readouts(b, where, frames=20):
    out = b.eval(STEADY.replace('FRAMES', str(frames)))
    pos = {json.dumps(o['pos']) for o in out}
    canvas = {o['canvas'] for o in out}
    texts = {o['text'] for o in out}
    n = len(out[0]['pos'])
    check(len(pos) == 1 and len(canvas) == 1 and len(texts) > 3 and n >= 8,
          f'{where}: {n} read-out labels and slots stay put over {frames} frames while {len(texts)} different sets of numbers show'
          + ('' if len(pos) == 1 else ' (the HTML read-outs moved)') + ('' if len(canvas) == 1 else ' (the canvas labels moved)'))

# The contrast ratio (WCAG) of an element's text against the first opaque background behind it:
# the hint and the Start-here block must read in both themes.
CONTRAST = '''((sel) => { const e = document.querySelector(sel); if (!e) return null;
  const lum = (c) => { const m = c.match(/\\d+(\\.\\d+)?/g).map(Number);
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  let bg = null;
  for (let p = e; p && !bg; p = p.parentElement) { const c = getComputedStyle(p).backgroundColor; if (c && c !== 'transparent' && !/^rgba\\(.*, 0\\)$/.test(c)) bg = c; }
  const a = lum(getComputedStyle(e).color), b = lum(bg || 'rgb(255, 255, 255)');
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); })'''

def first_screen(b, where):
    """The hint sits directly under the picture, and it and the Start-here block read (contrast >= 3)."""
    hint = b.eval("document.querySelector('#hint').textContent")
    gap = b.eval("(() => { const h = document.querySelector('#hint').getBoundingClientRect(), f = document.querySelector('#field').getBoundingClientRect(); return h.top - f.bottom; })()")
    ch, cs = b.eval(CONTRAST + '("#hint")'), b.eval(CONTRAST + '("#help .start p")')
    check(hint.startswith('Drag anywhere on the picture') and 0 <= gap < 12 and ch >= 3 and cs >= 3,
          f"{where}: the hint under the picture ('{hint[:40]}...', {gap:.0f} px below it) and the Start here block read (contrast {ch:.1f}, {cs:.1f})")

def desktop(b):
    ready(b); run_for(b, 1.5)
    b.screenshot('build/rad-start.png')
    n = len(b.eval('__app.lines'))
    check(b.eval('__app.state.preset') == 'shuttle' and n == 24, f'it opens on the start-and-stop motion with {n} field lines')
    # The first screen: a hint under the picture, words beside every number, glosses on the
    # controls, and a drawer that starts with "Start here" and ends with the formula.
    first_screen(b, 'light theme')
    labs = b.eval("[...document.querySelectorAll('#readout .lab')].filter((e) => e.offsetParent).map((e) => e.textContent)")
    words = ['speed β = v/c', 'Lorentz factor γ', 'acceleration |a|', 'radiated power P/PLarmor']
    check(len(labs) == 6 and all(any(l.startswith(w) for l in labs) for w in words) and 'units/s²' in labs, f'every number in the read-out has words beside it: {labs}')
    glosses = b.eval("[...document.querySelectorAll('.controls .small.muted')].map((e) => e.textContent)")
    check(any(g.startswith('Velocity part:') for g in glosses) and any('Energy flux:' in g for g in glosses) and any(g.startswith('Probe:') for g in glosses),
          f'the Show panel glosses Velocity part, Energy flux and Probe ({len(glosses)} notes)')
    first = b.eval("document.querySelector('#help header + *').className")
    h3 = b.eval("[...document.querySelectorAll('#help h3')].map((e) => e.textContent)")
    check(first == 'start' and h3[0] == 'Start here' and not b.eval("document.querySelector('#help .start math')"), 'the drawer opens with a Start here block, without equations')
    check(h3[1].startswith('1. Start and stop') and h3[-1] == 'How it works' and b.eval("!!document.querySelector('#help .theory math[display=block]')"),
          f'experiment 1 is the opening set-up and the Liénard–Wiechert formula comes last ({h3[1]!r} ... {h3[-1]!r})')
    b.eval('__app.setups.kink()'); k = b.eval('__app.state.preset')
    b.eval('__app.setups.stop()'); s = b.eval('__app.state.preset')
    check(k == 'shuttle' and s == 'stop', f'#setup=kink is the opening motion ({k}); #setup=stop one stop at a time ({s})')
    ta = b.eval("['#polar', '#power'].map((s) => getComputedStyle(document.querySelector(s)).touchAction)")
    check(ta == ['pan-y', 'pan-y'], f'a finger over the plots scrolls the page (touch-action {ta})')

def drag(b):
    # From rest at the centre, a fast drag to the right.  Far away, nothing has heard yet: the
    # field there is still Coulomb's, centred where the charge was.
    b.eval('__app.setups.coulomb()'); run_for(b, 0.5)
    t0 = b.eval('__app.charge().t')
    b.drag('#field', (0.5, 0.5), (0.8, 0.35), steps=12, pause=0.01)
    b.sleep(0.15)
    c0 = charge(b)
    check(b.eval('__app.mode') == 'hand', 'grabbing the charge hands it to the pointer')
    bmax = b.eval(f'(() => {{ const T = __app.traj; let m = 0; for (let t = {t0}; t <= T.tEnd; t += 0.002) {{ T.at(t); m = Math.max(m, Math.hypot(T.vx, T.vy)); }} return m / __app.state.c; }})()')
    check(0.3 < bmax <= 0.98, f'a quick drag is relativistic but stays below c: β max {bmax:.3f}')
    dt = c0['t'] - t0
    if c0['c'] * dt < 13:   # (a point farther than c (t − t0) from the start)
        far = [-9.5, -9.5]
        f = b.eval(f'__app.field({far[0]}, {far[1]})')
        r = math.hypot(*far)
        check(abs(f['ex'] - far[0] / r**3) < 1e-9 and abs(f['ey'] - far[1] / r**3) < 1e-9,
              f'{r:.1f} units away, {dt:.2f} s after the drag began, the field is still Coulomb\'s from where the charge was')
    run_for(b, 1.5)
    c1 = charge(b)
    sp = math.hypot(c1['vx'], c1['vy'])
    check(sp < 0.05 * c1['c'], f'let go, it comes to rest (β = {sp / c1["c"]:.4f}) at ({c1["x"]:.2f}, {c1["y"]:.2f})')
    b.screenshot('build/rad-drag.png')

def every_setup(b):
    times = {}
    for name in b.eval('Object.keys(__app.setups)'):
        b.eval(f'__app.setups[{json.dumps(name)}]()'); run_for(b, 2.0)
        b.screenshot(f'build/rad-exp-{name}.png')
        times[name] = b.eval('__app.frameMs')
    print('      frame times (ms, headless, no GPU): ' + ', '.join(f'{k} {v:.0f}' for k, v in times.items()))

def readouts(b):
    # Everything changing at once: a fast oscillation (β, γ, |a| and P/P_Larmor all vary, and a
    # passes through zero) with the probe on.
    b.eval('__app.setups.fastdipole()')
    pos0 = b.rects('#readout .lab, #readout .num')
    b.eval("[...document.querySelectorAll('#extras button')].find((e) => e.textContent === 'Probe').click()")
    b.eval('__app.setProbe(-6, 4)')
    run_for(b, 0.5)
    pos1 = b.rects('#readout .lab, #readout .num')
    hint = b.eval("document.querySelector('#hint').textContent")
    labs = b.eval("[...document.querySelectorAll('#readout .lab')].filter((e) => e.offsetParent).map((e) => e.textContent)")
    check(b.eval('__app.state.probe') and 'yellow dot' in hint and any(l.startswith('at the probe') for l in labs) and pos1[:len(pos0)] == pos0,
          f"the Probe button shows the probe's read-outs ({len(labs)} labels) and the hint says to drag the yellow dot; the other read-outs stay put")
    steady_readouts(b, 'fast dipole with the probe')
    # Dragging the probe where the hint says: from where it is drawn (the view is centred on the
    # origin for this motion) 60 px right and 40 px down.
    x, y, w, h = b.box('#field')
    s = min(w, h) / 20
    px, py = b.eval('__app.state.probeAt')
    fx, fy = (w / 2 + px * s) / w, (h / 2 - py * s) / h
    b.drag('#field', (fx, fy), (fx + 60 / w, fy + 40 / h), steps=8)
    qx, qy = b.eval('__app.state.probeAt')
    check(abs(qx - (px + 60 / s)) < 0.15 and abs(qy - (py - 40 / s)) < 0.15 and b.eval('__app.mode') == 'preset',
          f'dragging the yellow dot moves the probe ({px:.2f}, {py:.2f}) -> ({qx:.2f}, {qy:.2f}) and leaves the charge on its motion')

def coulomb_heaviside(b):
    b.eval('__app.setups.coulomb()'); run_for(b, 0.3)
    f = b.eval('__app.field(5, 3)')
    check(abs(math.hypot(f['ex'], f['ey']) * 34 - 1) < 1e-9, 'at rest: Coulomb, |E| r² = q/4πε₀ = 1')
    b.eval('__app.setups.heaviside()'); run_for(b, 0.5)
    # (All in one call: the charge moves on between calls.)
    fa, fp = b.eval('(() => { const q = __app.charge(); return [__app.field(q.x + 3, q.y), __app.field(q.x, q.y + 3)]; })()')
    ratio = math.hypot(fp['ex'], fp['ey']) / math.hypot(fa['ex'], fa['ey'])
    check(abs(fa['ey']) < 1e-9 * abs(fa['ex']) and abs(fp['ex']) < 1e-9 * abs(fp['ey']) and abs(ratio - gamma(0.8)**3) < 1e-6,
          f'uniform motion at β = 0.8: E points from the present position; across/along = {ratio:.4f} = γ³')

def dipoles(b):
    b.eval('__app.setups.dipole()'); run_for(b, 0.6)
    from_axis = b.eval('__app.dPdOmega(Math.PI / 2) / Math.max(__app.dPdOmega(0), 1e-300)')
    log = b.eval('__app.powerLog.slice(-40)')
    ratios = [abs(P / L - 1) for _, P, L in log if L > 1e-9]
    worst = max(ratios) if ratios else float('nan')
    check(from_axis < 1e-20 and ratios and worst <= gamma(0.1)**6 - 1 + 1e-9,
          f'slow dipole (β ≤ 0.1): no power along the axis (ratio {from_axis:.1e}); Liénard within {worst * 100:.1f}% of Larmor (γ⁶ − 1 ≤ 3.1%)')
    b.eval('__app.setups.axis()'); run_for(b, 1.2)
    pr = b.eval('__app.probe')
    check(pr['ea'] == 0 and pr['ev'] > 0, f'a probe on the axis: |E_acc| = {pr["ea"]}, |E_vel| = {pr["ev"]:.4f}')
    b.eval('__app.setups.fastdipole()'); run_for(b, 0.7)
    q, (P, L) = b.eval('[__app.charge(), __app.powerLog.at(-1).slice(1)]')
    be = math.hypot(q['vx'], q['vy']) / q['c']
    check(abs(P / L / gamma(be)**6 - 1) < 1e-6, f'fast dipole at β = {be:.3f}: P/P_Larmor = {P / L:.4f} = γ⁶')

def circles(b):
    for name, beta in (('power', 0.7), ('synchrotron', 0.9)):
        b.eval(f'__app.setups.{name}()'); run_for(b, 0.5)
        P, L = b.eval('__app.powerLog.at(-1).slice(1)')
        check(abs(P / L / gamma(beta)**4 - 1) < 1e-6, f'circle at β = {beta}: P/P_Larmor = {P / L:.4f} = γ⁴ = {gamma(beta)**4:.4f}')
    # In the plane, circular motion gives dP/dΩ ∝ (cos θ − β)²/(1 − β cos θ)⁵ (θ from v): half
    # power where that is half its value at θ = 0, and nothing at cos θ = β.
    half, zero = b.eval('''(() => { const q = __app.charge(), p = Math.atan2(q.vy, q.vx), m = __app.dPdOmega(p);
        let d = 0; while (__app.dPdOmega(p + d) > m / 2) d += 1e-5; const h = d;
        while (__app.dPdOmega(p + d + 1e-5) < __app.dPdOmega(p + d)) d += 1e-5; return [h, d]; })()''')
    be = 0.9; f = lambda th: (math.cos(th) - be)**2 / (1 - be * math.cos(th))**5 - 0.5 / (1 - be)**3
    lo, hi = 0.0, math.acos(be)
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if f(mid) > 0 else (lo, mid)
    check(abs(half - lo) < 2e-4 and abs(zero - math.acos(be)) < 2e-4,
          f'synchrotron beam: half power {half:.4f} rad either side of v (exact {lo:.4f}), none at {zero:.4f} = arccos β (1/γ = {1 / gamma(be):.3f})')

def hyperbolic(b):
    # Constant Liénard power (2/3) g²/c³ while the proper acceleration lasts (t = 2.9 to 5 s).
    b.eval('__app.setups.hyperbolic()'); run_for(b, 4.0)
    c = b.eval('__app.state.c'); g = 1.0 * c
    Ps = [P for _, P, L in b.eval('__app.powerLog') if P > 0]
    flat = sorted(Ps)[len(Ps) // 2] if Ps else 0
    expect = (2 / 3) * g * g / c**3
    check(len(Ps) >= 3 and max(abs(P / expect - 1) for P in Ps) < 1e-6,
          f'uniform acceleration: P = {flat:.5f} = (2/3)g²/c³ = {expect:.5f} in every frame ({len(Ps)} frames)')

def far_field(b):
    # The probe's peak radiation field at 8 and at 4 units above the stop (the shell passes 8
    # units out about 3 s after the set-up, 4 units out about 2.5 s after).
    peaks = {}
    for y, wait in ((8, 4.2), (4, 3.6)):
        b.eval('__app.setups.far()'); b.eval(f'__app.setProbe(0, {y})'); run_for(b, wait)
        pr = b.eval('__app.probe')
        peaks[y] = (pr['peak'], pr['ev'])
    p8, e8 = peaks[8]; p4, e4 = peaks[4]
    print(f'      far: peak |E_acc| {p8:.3f} at 8 units ({p8 / e8:.1f} times |E_vel| {e8:.4f}); {p4:.3f} at 4 ({p4 / e4:.1f} times {e4:.4f})')
    check(1.8 < p4 / p8 < 2.2 and 3.8 < e4 / e8 < 4.2, f'the radiation field falls as 1/R ({p4 / p8:.2f}x from 8 to 4 units), Coulomb\'s as 1/R² ({e4 / e8:.2f}x)')
    # Thomson's estimate, as the help gives it: the smooth stop's largest deceleration is
    # a = 1.5 v/tau = 1.5 (0.5 c)/0.1 s, and E_acc = a/(c^2 R) straight above it.
    c = b.eval('__app.state.c'); thomson = 1.5 * 0.5 * c / 0.1 / (c * c * 8)
    check(abs(p8 / thomson - 1) < 0.03 and abs(p8 - 0.118) < 0.0015 and abs(e8 - 1 / 64) < 2e-4,
          f'8 units above the stop: peak |E_acc| {p8:.4f} (Thomson: a/c²R = {thomson:.4f}; the help: 0.118), |E_vel| {e8:.5f} (1/8² = 0.01563)')

def typed(b):
    b.eval("__app.startMotion('typed')"); run_for(b, 0.5)
    check(b.eval('__app.mode') == 'preset', 'a typed figure eight is followed exactly')
    b.eval("""(() => { const f = document.querySelector('#typed input'); f.value = '10 cos(3 t)'; f.dispatchEvent(new Event('change')); })()""")
    run_for(b, 1.0)
    note = b.eval("document.querySelector('#motion-note').textContent")
    q = charge(b)
    check(b.eval('__app.mode') == 'chase' and 'too fast' in note and math.hypot(q['vx'], q['vy']) < 0.98 * q['c'],
          f'a typed path at β = 3.75 is chased instead ("{note[:40]}...")')
    b.screenshot('build/rad-typed.png')

def controls(b):
    # Dragging a parameter's slider: the same slider keeps going (it is not rebuilt under the pointer).
    b.eval('__app.setups.power()'); run_for(b, 0.3)
    r = b.eval("""(() => { const r = document.querySelector('#params input[type=range]'); r.value = 300; r.dispatchEvent(new Event('input'));
        const v1 = __app.values.circle.beta; r.value = 600; r.dispatchEvent(new Event('input'));
        return [r.isConnected, v1, __app.values.circle.beta, __app.charge()]; })()""")
    check(r[0] and r[1] != r[2] and abs(math.hypot(r[3]['vx'], r[3]['vy']) / r[3]['c'] - r[2]) < 1e-9, f'dragging the β slider changes the motion as it goes (β {r[1]} then {r[2]})')
    # The speed of light.
    b.eval('__app.setups.power()'); run_for(b, 0.3)
    b.eval("""(() => { const box = [...document.querySelectorAll('#c-box input[type=number]')][0]; box.value = 4; box.dispatchEvent(new Event('change')); })()""")
    run_for(b, 0.4)
    q = charge(b)
    check(b.eval('__app.state.c') == 4 and abs(math.hypot(q['vx'], q['vy']) / 4 - 0.7) < 1e-9, 'typing c = 4 keeps the circle at β = 0.7')

def no_errors(b, where):
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, f'no exceptions {where}' + ('' if not errors else ': ' + '; '.join(errors[:3])))

def phone(b):
    # A link to a set-up, the read-outs, the controls and the help drawer at phone width.
    ready(b); run_for(b, 1.5)
    s = b.eval('__app.state')
    check(s['preset'] == 'circle' and s['c'] == 6 and s['map'] == 'flux' and s['count'] == 12 and s['probe'] and b.eval('__app.values.circle.beta') == 0.5,
          'the address bar carries the motion, its parameters and the display')
    b.screenshot('build/rad-phone.png')
    wide = b.eval('document.documentElement.scrollWidth')
    check(wide <= 400, f'nothing sticks out sideways at phone width ({wide} px)')
    hb = b.eval("document.querySelector('#hint').getBoundingClientRect().bottom")
    check(hb <= 850 and b.eval('scrollY') == 0 and b.eval("document.querySelector('#hint').textContent").startswith('Drag the yellow dot'),
          f'the hint is on the first screen (its bottom at {hb:.0f} px of 850), and with the probe on it says how to place it')
    steady_readouts(b, 'at phone width, a circle with the probe')
    b.eval('window.scrollTo(0, 700)'); b.sleep(0.3)
    b.screenshot('build/rad-phone-controls.png')
    b.eval('window.scrollTo(0, 0)')
    b.eval("window.__old = true; location.hash = 'setup=synchrotron'; location.reload()")
    ready(b); run_for(b, 1.5)
    check(b.eval('__app.state.preset') == 'circle' and b.eval('__app.values.circle.beta') == 0.9, '#setup=synchrotron opens that experiment')
    first_screen(b, 'phone')
    b.click('#help-button'); b.sleep(0.5)
    b.screenshot('build/rad-phone-help.png')

def dark(b):
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
    ready(b); run_for(b, 1.0)
    first_screen(b, 'dark theme')
    b.screenshot('build/rad-dark.png')
    b.click('#help-button'); b.sleep(0.5)
    b.screenshot('build/rad-dark-help.png')

try:
    with Browser('radiation/index.html', size=(1400, 900)) as b:
        section('opening', desktop, b)
        section('dragging', drag, b)
        section('every experiment', every_setup, b)
        section('read-outs', readouts, b)
        section('Coulomb and Heaviside', coulomb_heaviside, b)
        section('dipoles', dipoles, b)
        section('circles', circles, b)
        section('uniform acceleration', hyperbolic, b)
        section('far field', far_field, b)
        section('typed paths', typed, b)
        section('controls', controls, b)
        no_errors(b, 'at 1400 x 900')
except Exception as e:
    check(False, f'the desktop browser: {type(e).__name__}: {e}')
try:
    with Browser('radiation/index.html', size=(1400, 900)) as b:
        section('dark theme', dark, b)
        no_errors(b, 'in the dark theme')
except Exception as e:
    check(False, f'the dark-theme browser: {type(e).__name__}: {e}')
try:
    with Browser('radiation/index.html#m=circle&c=6&p_beta=0.5&p_radius=1.5&map=flux&n=12&probe=3.00,4.00', size=(400, 850)) as b:
        section('phone width', phone, b)
        no_errors(b, 'at phone width')
except Exception as e:
    check(False, f'the phone-width browser: {type(e).__name__}: {e}')
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
