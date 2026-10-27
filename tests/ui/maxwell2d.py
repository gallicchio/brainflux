#!/usr/bin/env python3
"""Drive the Maxwell 2D demo like a student: paint, drag the source, run every experiment, and
check the read-outs against the numbers its help quotes (and against theory), that the read-outs
hold still while the numbers change, and the layout on a phone."""
import json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg, flush=True)
    if not cond: failures.append(msg)

def wait_for(b, expr, what, timeout=180):
    """Poll until expr is true (generous: the machine may be busy); a failed check, not a traceback."""
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            if b.eval(f'!!({expr})'): return True
        except RuntimeError:
            pass
        time.sleep(0.25)
    check(False, f'timed out after {timeout} s waiting for {what}')
    return False

def setup(b, name, periods):
    b.eval(f'__app.setups[{json.dumps(name)}](); __app.state.running = false')
    b.eval(f'__app.run({periods})')

def shape_param(b, value, which=0):
    """Type a value into the shape's parameter (0) or index (1) box, as a student would."""
    b.eval(f"(() => {{ const s = document.querySelectorAll('#shape-box input[type=number]')[{which}]; s.value = {value}; s.dispatchEvent(new Event('change')); }})()")
    b.eval('__app.state.running = false')

def meters(b):
    return b.eval('[0, 1].map((q) => __app.meterValue(q))')

def session(page, size, what, body):
    """Run body(b) on a fresh page; anything that goes wrong is reported as a failure."""
    try:
        with Browser(page, size=size) as b:
            if not wait_for(b, 'window.__app && __app.ready', f'{what}: the page to load'):
                return
            body(b)
            errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
            check(not errors, f'{what}: no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))
    except Exception as e:  # report, don't crash: the summary line must still come out
        check(False, f'{what}: {type(e).__name__}: {e}')


def desktop(b):
    wait_for(b, '__app.sim.t > 0', 'the simulation to start on its own', timeout=120)
    check(b.eval('__app.sim.t') > 0, f"it opens running (t = {b.eval('__app.sim.t'):.2f} periods)")
    b.eval('__app.state.running = false; __app.run(10)'); b.sleep(0.3)
    b.screenshot('build/mx-start.png')

    # Painting: a stroke of glass across empty space.
    b.eval("__app.setups.circles(); __app.state.running = false")
    before = b.eval('__app.scene.materialAt(3, 2).n')
    b.drag('#view', (0.62, 0.3), (0.82, 0.3), steps=10)
    after = b.eval('__app.scene.materialAt(4, 2).n')
    check(before == 1 and after is not None and abs(after - 1.5) < 1e-9, f'dragging paints glass (n at (4, 2): {before} -> {after})')
    check(b.eval('__app.state.paint.length') == 1 and len(b.eval('__app.state.paint[0].pts')) > 4, 'the stroke is kept as one path')
    # Metal: Ez is zero inside it.
    b.eval("document.querySelectorAll('#materials button')[3].click()")
    b.drag('#view', (0.62, 0.7), (0.7, 0.7), steps=5)
    check(b.eval('__app.scene.materialAt(3, -2).pec') is True, 'the metal brush paints a perfect conductor')
    b.eval('__app.run(3)')
    check(b.eval('Math.abs(__app.sim.sample(3, -2.07))') < 1e-6, 'the field is zero inside the metal')
    b.eval("document.querySelectorAll('#materials button')[0].click()")
    # Dragging the source.
    x0 = b.eval('__app.state.src.x')
    b.drag('#view', (0.375, 0.5), (0.25, 0.5), steps=6)
    x1 = b.eval('__app.state.src.x')
    check(x0 == -2 and abs(x1 + 4) < 0.15, f'dragging the source moves it ({x0} -> {x1:.2f})')
    b.screenshot('build/mx-painted.png')

    # The read-outs hold still while the simulation runs and their numbers change (and cross zero).
    setup(b, 'ftir', 6)
    x, y = b.point('#view', (0.36, 0.67))
    b.mouse('mouseMoved', x, y)
    b.eval("document.querySelector('#play').click()")
    probe = """(() => ({ x: [...document.querySelectorAll('#readouts .lab, #readouts .unit, #readouts .slot, #notes .slot')].map((e) => Math.round(e.getBoundingClientRect().left * 10) / 10),
      t: document.querySelector('#readouts [data-k=t]').textContent, f: document.querySelector('#readouts [data-k=f]').textContent }))()"""
    samples = []
    for _ in range(10):
        b.sleep(0.4)
        samples.append(b.eval(probe))
    b.eval("__app.state.running = false")
    xs = [s['x'] for s in samples]
    moved = max(max(abs(a - c) for a, c in zip(xs[0], s)) for s in xs) if all(len(s) == len(xs[0]) for s in xs) else 99
    ts, fs = {s['t'] for s in samples}, {s['f'] for s in samples}
    check(len(ts) > 2 and len(fs) > 2 and moved < 0.5,
          f"read-outs hold still while running: {len(xs[0])} labels and slots moved at most {moved:.1f} px over {len(ts)} times and {len(fs)} field values ({sorted(fs)[:3]}...)")

    # Every experiment, with the numbers the help quotes.
    for name in b.eval('Object.keys(__app.setups)'):
        setup(b, name, 20)
        b.screenshot(f'build/mx-exp-{name}.png')
    notes = lambda: b.eval("document.querySelector('#notes').textContent")

    setup(b, 'snell', 4)
    check('refracted at 19.5°' in notes() and '5.78%' in notes(), 'Snell: 19.5°, Fresnel 5.78% in the notes')

    setup(b, 'tir', 4)
    check('0.28 λ' in notes() and '41.8°' in notes(), 'TIR: critical angle 41.8°, decay length 0.28 λ')

    setup(b, 'ftir', 30)
    A, B = meters(b)
    want = b.eval("__app.theory.beamAverage((t) => __app.theory.layerTransmission(1.5, 1, 0.3, t, 'TM'), 50 * Math.PI / 180, 1.5, 1.2)")
    check(abs(A / want - 1) < 0.02 and 0.6 < B < 0.68, f'frustrated TIR: T = {A:.4f} (theory for this beam {want:.4f}), R = {B:.4f}')
    for g, lo, hi in [(0.1, 0.82, 0.86), (0.5, 0.095, 0.115)]:
        shape_param(b, g); b.eval('__app.restart(); __app.state.running = false'); b.eval('__app.run(30)')
        check(lo < meters(b)[0] < hi, f'frustrated TIR at a gap of {g} λ: T = {meters(b)[0]:.4f}')

    setup(b, 'brewster', 28)
    te = meters(b)[0]
    b.eval("document.querySelector('#show-pol button:first-child').click()"); b.eval('__app.state.running = false; __app.run(28)')
    tm = meters(b)[0]
    check(te > 0.985 and 0.82 < tm < 0.85, f"Brewster: transmitted {te:.4f} in TE (p), {tm:.4f} in TM (s)")
    b.screenshot('build/mx-brewster-tm.png')

    setup(b, 'guide', 40)
    A, B = meters(b)
    check(0.82 < A < 0.86 and 0.72 < B < 0.78, f'waveguide: {A:.3f} in the guide, {B:.3f} round a bend of 2.5 λ')
    shape_param(b, 1); b.eval('__app.restart(); __app.state.running = false'); b.eval('__app.run(40)')
    check(0.37 < meters(b)[1] < 0.43, f'a bend of 1 λ: {meters(b)[1]:.3f}')

    setup(b, 'cutoff', 40)
    A = meters(b)[0]
    check(A < 1e-4, f'metal channel 0.4 λ wide, TM: {A:.2e} gets through')
    shape_param(b, 0.55); b.eval('__app.restart(); __app.state.running = false'); b.eval('__app.run(40)')
    check(0.37 < meters(b)[0] < 0.44, f'0.55 λ wide, TM: {meters(b)[0]:.3f}')
    setup(b, 'cutoff', 2)
    b.eval("document.querySelector('#show-pol button:last-child').click()"); b.eval('__app.state.running = false; __app.run(24)')
    check(0.15 < meters(b)[0] < 0.19, f'0.4 λ wide, TE: {meters(b)[0]:.3f}')

    setup(b, 'lens', 24)
    r = b.eval("""(() => { const s = __app.sim, sc = __app.scene, op = sc.shapeOps[0]; let best = 0, bx = 0, by = 0;
      for (let j = sc.pml; j < s.ny - sc.pml; j++) for (let i = sc.pml; i < s.nx - sc.pml; i++) { const x = s.nodeX(i); if (x < op.x + 1) continue; const v = s.intensity[j * s.nx + i]; if (v > best) { best = v; bx = x; by = s.nodeY(j); } }
      let lo = by, hi = by; while (s.sample(bx, lo, s.intensity) > best / 2) lo -= 0.01; while (s.sample(bx, hi, s.intensity) > best / 2) hi += 0.01;
      return { peak: bx - op.x, focus: __app.predictions().focus[0] - op.x, fwhm: hi - lo }; })()""")
    check(abs(r['focus'] - 5.44) < 0.05 and abs(r['peak'] - 3.6) < 0.3 and 0.6 < r['fwhm'] < 1.4,
          f"lens: paraxial focus {r['focus']:.2f} λ, brightest at {r['peak']:.2f} λ from the centre, {r['fwhm']:.2f} λ wide (FWHM)")

    setup(b, 'crystal', 30)
    check(meters(b)[0] < 0.01, f'photonic crystal at a = 0.37 λ: T = {meters(b)[0]:.2e}')
    for a, lo, hi in [(0.26, 0.38, 0.5), (0.46, 0.33, 0.45)]:
        shape_param(b, a); b.eval('__app.restart(); __app.state.running = false'); b.eval('__app.run(30)')
        check(lo < meters(b)[0] < hi, f'outside the gap, a = {a} λ: T = {meters(b)[0]:.3f}')

    setup(b, 'pcbend', 30)
    up = b.eval('(() => { const s = __app.sim; let m = 0; for (let x = 0.9; x < 1.4; x += 0.02) m = Math.max(m, Math.abs(s.sample(x, 3.2))); return m; })()')
    side = b.eval('(() => { const s = __app.sim; let m = 0; for (let y = -3.2; y < 3.2; y += 0.02) m = Math.max(m, Math.abs(s.sample(4.6, y))); return m; })()')
    check(up > 10 * side, f'crystal bend: the light turns up the channel ({up:.3f} at its top end, {side:.4f} beyond the crystal on the right)')

    setup(b, 'cavity', 60)
    fit = b.eval('__app.fit')
    check(bool(fit) and 70 < fit['Q'] < 100 and 0.92 < fit['f'] < 0.95, f"cavity with a 0.4 λ opening: {fit and {k: fit[k] for k in ('f', 'Q')}}")
    b.screenshot('build/mx-cavity-done.png')
    shape_param(b, 0); b.eval('__app.restart(); __app.state.running = false'); b.eval('__app.run(40)')
    fit = b.eval('__app.fit')
    check(bool(fit) and bool(fit['bound']) and abs(fit['f'] - 0.9995) < 5e-4, f"closed cavity: {fit and {k: fit[k] for k in ('f', 'bound')}}")

    setup(b, 'cherenkov', 12)
    check('θ = 42.2°' in notes(), 'Cherenkov: the cone angle 42.2° in the notes')

    # The address keeps the set-up: reload the page from it.
    def reload(h):
        b.call('Page.navigate', url='about:blank'); time.sleep(0.3)
        b.goto('maxwell2d/index.html' + h)
        wait_for(b, 'window.__app && __app.ready', 'the page to reload')
        b.sleep(0.5)
    setup(b, 'ftir', 1)
    wait_for(b, "location.hash.includes('shape=gap')", 'the address to be written')
    h = b.eval('location.hash')
    check('shape=gap' in h and 'p=0.3' in h and 'meters=' in h, f'the address keeps the set-up ({h[:90]}...)')
    reload(h)
    s = b.eval('({ shape: __app.state.shape, p: __app.state.p, src: __app.state.src.type, ang: __app.state.src.angle, m: __app.state.meters.length, W: __app.state.W })')
    check(s == {'shape': 'gap', 'p': 0.3, 'src': 'beam', 'ang': 40, 'm': 2, 'W': 14}, f'... and opening it restores it ({s})')
    # A painting and a typed background survive the round trip too.
    b.eval("__app.setups.grin(); __app.state.running = false; document.querySelectorAll('#materials button')[0].click()")
    b.sleep(0.5)
    b.drag('#view', (0.62, 0.15), (0.82, 0.15), steps=6)
    painted = b.eval('[__app.state.brush, __app.state.paint.length, __app.scene.materialAt(4, 3.5).n]')
    check(painted[1] == 1 and painted[2] == 1.5, f'painting on the Luneburg background (brush, strokes, n at (4, 3.5): {painted})')
    wait_for(b, "location.hash.includes('paint=')", 'the painting to reach the address')
    h = b.eval('location.hash')
    reload(h)
    n = b.eval('[__app.scene.materialAt(4, 3.5).n, __app.scene.materialAt(0, 0).n, __app.state.bg]')
    check(n[0] is not None and abs(n[0] - 1.5) < 1e-9 and abs(n[1] - 2 ** 0.5) < 1e-3 and 'sqrt' in n[2], f'a painted stroke and the Luneburg background survive the address ({n})')


def phone(b):
    b.eval('__app.state.running = false; __app.run(10)'); b.sleep(0.3)
    b.screenshot('build/mx-phone.png')
    w = b.eval("document.querySelector('#view').getBoundingClientRect().width")
    check(w > 340 and b.eval('document.documentElement.scrollWidth') <= 400, f'phone: the picture is {w:.0f} px wide and nothing overflows')
    b.eval('window.scrollTo(0, 700)'); b.sleep(0.3)
    b.screenshot('build/mx-phone-controls.png')


session('maxwell2d/index.html', (1400, 900), 'desktop', desktop)
session('maxwell2d/index.html#setup=cherenkov', (400, 850), 'phone', phone)
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
