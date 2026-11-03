#!/usr/bin/env python3
"""Drive the Maxwell 2D demo like a student: read the hint under the picture and follow it (drag
the source, aim the beam, paint), press the Set-ups buttons, open the drawer (Start here first,
the theory last), run every experiment, and check the read-outs against the numbers its help
quotes (and against theory), that the read-outs hold still while the numbers change, the dark
theme, and the layout on a phone.  Simulations are stepped through __app, never the clock."""
import json, os, re, sys, time
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

def text(b, sel):
    return b.eval(f"(document.querySelector({json.dumps(sel)}) || {{}}).textContent || ''")

def hint(b):
    return text(b, '#hint')

def press(b, label):
    """Press the Set-ups button with this label."""
    b.eval(f"[...document.querySelectorAll('#shapes button')].find((e) => e.textContent === {json.dumps(label)}).click(); __app.state.running = false")

def pressed(b):
    return b.eval("[...document.querySelectorAll('#shapes button')].filter((e) => e.getAttribute('aria-pressed') === 'true').map((e) => e.textContent)")

def source_point(b):
    """Where the source is drawn, as a fraction of the picture."""
    return b.eval('(() => { const s = __app.state, sc = __app.scene; return [(s.src.x + sc.W / 2) / sc.W, (sc.H / 2 - s.src.y) / sc.H]; })()')

def lum(css):
    """The relative luminance of a CSS rgb() colour."""
    r, g, b = [int(v) / 255 for v in re.findall(r'\d+', css)[:3]]
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)

def theme_check(b, which):
    """The hint under the picture and the Start-here block read against their backgrounds."""
    c = b.eval("""(() => { const cs = (s) => getComputedStyle(document.querySelector(s));
      return { bg: cs('body').backgroundColor, hint: cs('#hint').color, startBg: cs('.drawer .start').backgroundColor, startInk: cs('.drawer .start p').color, drawerBg: cs('.drawer').backgroundColor }; })()""")
    dark = lum(c['bg']) < 0.2
    check(dark == (which == 'dark'), f'{which} theme: the page background is {c["bg"]}')
    check(abs(lum(c['hint']) - lum(c['bg'])) > 0.25, f'{which}: the hint ({c["hint"]}) reads on the page ({c["bg"]})')
    check(abs(lum(c['startInk']) - lum(c['startBg'])) > 0.5 and abs(lum(c['startBg']) - lum(c['drawerBg'])) > 0.005,
          f'{which}: the Start-here block ({c["startInk"]} on {c["startBg"]}) reads in the drawer ({c["drawerBg"]})')

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

    # ---------------------------------------------------------------- the first screen
    # The prism it opens on: the central ray by Snell's law, in the notes.
    note = text(b, '#notes')
    check('38.0°' in note and '39.3°' in note and '37.2°' in note, f'the prism: the central ray meets it at 38.0° and is turned 39.3° (least 37.2°): "{note[:120]}"')
    check(b.eval('__app.state.ppw') == 24 and b.eval('__app.state.speed') == 2, f"the opening grid is {b.eval('__app.state.ppw')} cells per λ at {b.eval('__app.state.speed')} periods per second")
    # A hint directly under the picture says what to drag, before the drawer is opened.
    h = hint(b)
    vb, hb = b.box('#view'), b.box('#hint')
    check("Drag the beam's white dot" in h and 'aim' in h and 'paint glass' in h, f'the hint under the picture says what to drag and that dragging paints: "{h}"')
    check(hb[3] > 0 and 0 <= hb[1] - (vb[1] + vb[3]) < 30, f'... directly under the picture ({hb[1] - (vb[1] + vb[3]):.0f} px below it)')
    check('Prism' in pressed(b) and len(pressed(b)) == 1, f'the Prism set-up button is lit at opening ({pressed(b)})')
    check(not b.eval("document.querySelector('#more-panel').open") and b.eval("!!document.querySelector('#more-panel #show-pol') && !!document.querySelector('#more-panel #grid-box')"),
          'polarisation, meters, probe and the grid are folded under More at opening')
    ro = text(b, '#readouts')
    check('time' in ro and 'periods' in ro and 'point at the picture' in ro, f'the read-out line names the time and asks to point at the picture: "{ro[:80]}"')
    # Pointing at the source names it and offers a grab cursor; pointing at the picture reads the field.
    sx, sy = source_point(b)
    x, y = b.point('#view', (sx, sy)); b.mouse('mouseMoved', x, y); b.sleep(0.1)
    hs, cls = hint(b), b.eval("document.querySelector('#view').className")
    x, y = b.point('#view', (0.7, 0.25)); b.mouse('mouseMoved', x, y); b.sleep(0.1)
    ro = text(b, '#readouts')
    check(hs.startswith("The beam's source: drag it") and 'grab' in cls, f'pointing at the source: the hint names it ("{hs[:40]}"), cursor "{cls}"')
    check('under the pointer' in ro and re.search(r'x\s+3\.\d\d\s*y\s+2\.\d\d', ro) and 'n 1.000' in ro and 'Ez' in ro, f'pointing at the picture reads x, y, n and Ez there: "{ro[:90]}"')
    check(hint(b).startswith("Drag the beam's white dot"), 'the hint goes back to the general one off the handles')
    # Dragging the ring at the arrow's tip aims the beam, and the notes follow Snell's law.
    ax, ay = b.eval("(() => { const s = __app.state, sc = __app.scene, d = Math.PI / 180, len = Math.max(1.2, 46 / (document.querySelector('#view').clientWidth / sc.W)); return [(s.src.x + len * Math.cos(s.src.angle * d) + sc.W / 2) / sc.W, (sc.H / 2 - s.src.y - len * Math.sin(s.src.angle * d)) / sc.H]; })()")
    b.drag('#view', (ax, ay), (ax, ay + 0.035), steps=6)
    a1 = b.eval('__app.state.src.angle')
    b.eval('__app.run(0.2)')
    hits = b.eval('__app.predictions().prism.hits.map((h) => [h.theta1 * 180 / Math.PI, h.theta2])')
    check(-12 < a1 < -3 and 'totally reflected' in text(b, '#notes') and len(hits) == 3 and hits[1][1] is None and hits[1][0] > 60 and hits[2][1] is not None,
          f'dragging the ring down turns the beam ({a1}°): the ray inside meets the base at {hits[1][0]:.1f}°, is totally reflected there and leaves by the third face, as the help says')
    x, y = b.point('#view', (0.7, 0.25)); b.mouse('mouseMoved', x, y); b.sleep(0.1)
    check(hint(b).startswith("Drag the beam's white dot"), 'off the ring, the hint is the general one again')

    # ---------------------------------------------------------------- the Set-ups buttons
    press(b, 'Gap'); b.eval('__app.run(1)')
    x, y = b.point('#view', (0.5, 0.08)); b.mouse('mouseMoved', x, y); b.sleep(0.1)
    s = b.eval('({ shape: __app.state.shape, src: __app.state.src.type, ang: __app.state.src.angle, m: __app.state.meters.length })')
    check(s == {'shape': 'gap', 'src': 'beam', 'ang': 40, 'm': 2} and pressed(b) == ['Gap'], f'the Gap button sets up frustrated TIR, beam aimed and meters placed ({s})')
    check('green lines are power meters' in hint(b) and 'drag their ends' in hint(b), f'... and the hint says what the green lines are: "{hint(b)[-70:]}"')
    labels = b.eval("[...document.querySelectorAll('#shapes button')].map((e) => [e.textContent, e.title])")
    check(len(labels) == 14 and all(len(t) > 20 for _, t in labels) and any('tunnels' in t for _, t in labels), f'{len(labels)} Set-ups buttons, each with a tooltip saying what it shows')
    drawer_setups = b.eval("[...document.querySelectorAll('.drawer .exp[data-setup]')].map((e) => e.dataset.setup)")
    buttons = b.eval("Object.keys(__app.setups)")
    check(all(n in buttons for n in drawer_setups) and len(drawer_setups) == 15 and drawer_setups[0] == 'prism', f'every experiment in the drawer has a set-up, the first being the opening state ({drawer_setups[:3]}...)')
    press(b, 'Empty box')
    check(b.eval('__app.state.shape') is None and b.eval('__app.state.src.type') == 'beam' and pressed(b) == ['Empty box'], 'Empty box takes the shape away and keeps the source')
    press(b, 'Cherenkov'); b.eval('__app.run(1)')
    check(b.eval('__app.state.src.type') == 'moving' and hint(b).startswith('Drag the white square'), f'Cherenkov: a moving source, and the hint says what its square and ring are: "{hint(b)[:60]}"')
    # The drawer's own "Set it up" lights the matching button (Brewster shares the surface with Snell).
    setup(b, 'brewster', 1)
    check(pressed(b) == ['Surface'], f'the Brewster experiment lights the Surface button ({pressed(b)})')

    # ---------------------------------------------------------------- the drawer
    d = b.eval("""(() => { const dr = document.querySelector('.drawer'), kids = [...dr.children].filter((e) => e.tagName !== 'HEADER');
      const start = dr.querySelector('.start'), theory = dr.querySelector('.theory');
      return { first: kids[0].className, h3: start && start.querySelector('h3').textContent, text: start && start.textContent, math: start ? start.querySelectorAll('math').length : -1,
        startPs: start ? start.querySelectorAll('p').length : 0, theoryAfter: theory && kids.indexOf(theory) > kids.indexOf(dr.querySelectorAll('.exp')[14]), theoryH3: theory && [...theory.querySelectorAll('h3')].map((h) => h.textContent) }; })()""")
    check(d['first'] == 'start' and d['h3'] == 'Start here' and d['math'] == 0 and 3 <= d['startPs'] <= 5, f'the drawer opens with a Start-here block of {d["startPs"]} paragraphs and no equations')
    check('Drag the beam' in d['text'] and 'Snell' in d['text'] and 'Set-ups' in d['text'], 'Start here says what to drag and what to look for')
    check(d['theoryAfter'] and d['theoryH3'] == ['How it works', 'How it is computed'], f'the theory (polarisations, units, the absorbing layer, the method) comes after the experiments ({d["theoryH3"]})')
    b.eval("document.querySelector('#help-button').click()"); b.sleep(0.4)
    b.screenshot('build/mx-help.png')
    b.eval("document.querySelector('#help-button').click()"); b.sleep(0.2)

    # ---------------------------------------------------------------- painting
    b.eval("__app.setups.circles(); __app.state.running = false")
    check(hint(b).startswith('Drag the white dot (the source)'), f'a point source: the hint says to drag the dot: "{hint(b)[:50]}"')
    before = b.eval('__app.scene.materialAt(3, 2).n')
    b.drag('#view', (0.62, 0.3), (0.82, 0.3), steps=10)
    after = b.eval('__app.scene.materialAt(4, 2).n')
    check(before == 1 and after is not None and abs(after - 1.5) < 1e-9, f'dragging paints glass (n at (4, 2): {before} -> {after})')
    check(b.eval('__app.state.paint.length') == 1 and len(b.eval('__app.state.paint[0].pts')) > 4, 'the stroke is kept as one path')
    # Metal: Ez is zero inside it.
    b.eval("document.querySelectorAll('#materials button')[3].click()")
    check('paint metal' in hint(b), f'choosing the metal brush changes the hint: "{hint(b)[-60:]}"')
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
    probe = """(() => ({ x: [...document.querySelectorAll('#readouts .lab, #readouts .unit, #readouts .slot, #notes .slot, #hint')].map((e) => Math.round(e.getBoundingClientRect().left * 10) / 10),
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
    # The meters' labels on the picture say what they are.
    b.eval('__app.run(24)')
    check('meter' in hint(b).lower() and b.eval("__app.meters.length") == 2, f'two meters on the picture, named in the hint ("{hint(b)[-60:]}")')

    # Every experiment, with the numbers the help quotes.
    for name in b.eval('Object.keys(__app.setups)'):
        setup(b, name, 20)
        b.screenshot(f'build/mx-exp-{name}.png')
    notes = lambda: text(b, '#notes')

    setup(b, 'snell', 4)
    check('refracted at 19.5°' in notes() and '5.78%' in notes(), 'Snell: 19.5°, Fresnel 5.78% in the notes')

    setup(b, 'tir', 25)
    A = meters(b)[0]
    check('0.22 λ' in notes() and '41.8°' in notes() and '0.24%' in notes() and 0.0015 < A < 0.003,
          f'TIR at 55°: critical angle 41.8°, decay length 0.22 λ; meter A above the surface {100 * A:.3f}% (this beam\'s spread of angles: 0.24%)')
    b.eval("__app.state.src.width = 0.6; __app.build(); __app.restart(); __app.state.running = false"); b.eval('__app.run(30)')
    check(0.055 < meters(b)[0] < 0.075, f'TIR with a beam 0.6 λ wide: {100 * meters(b)[0]:.2f}% gets out')

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
    check(' 2 guided modes' in notes(), 'a core 0.5 λ wide of n = 1.5 holds two modes, as the help says (V = 1.76 > π/2)')
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
    check('yellow cross is the probe' in hint(b), 'the hint names the probe')
    b.screenshot('build/mx-cavity-done.png')
    shape_param(b, 0); b.eval('__app.restart(); __app.state.running = false'); b.eval('__app.run(40)')
    fit = b.eval('__app.fit')
    check(bool(fit) and bool(fit['bound']) and abs(fit['f'] - 0.9995) < 5e-4, f"closed cavity: {fit and {k: fit[k] for k in ('f', 'bound')}}")

    setup(b, 'cherenkov', 12)
    check('θ = 42.2°' in notes() and '47.8°' in notes(), 'Cherenkov: the light at 42.2° to the motion, the wavefronts\' V at 47.8° to the path, in the notes')
    # The crests 1 and 4 wavelengths from a wire: the amplitude falls as 1/sqrt(r).
    setup(b, 'circles', 1)
    r = b.eval("""(() => { const s = __app.sim, x = __app.state.src.x; s.trackIntensity(true, 1, true); __app.run(14);
      const a = (dx, dy) => Math.sqrt(2 * s.sample(x + dx, dy, s.intensity)); return a(0, 1) / a(0, 4); })()""")
    check(abs(r - 2) < 0.05, f'circular waves: the amplitude 1 λ from the wire is {r:.3f} times that 4 λ away (1/√r: 2)')

    # ---------------------------------------------------------------- the dark theme
    setup(b, 'prism', 10)
    theme_check(b, 'light')
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
    b.sleep(0.4); b.eval('__app.run(0.1)')
    theme_check(b, 'dark')
    b.screenshot('build/mx-dark.png')
    b.eval("document.querySelector('#help-button').click()"); b.sleep(0.4)
    b.screenshot('build/mx-dark-help.png')
    b.eval("document.querySelector('#help-button').click()"); b.sleep(0.2)
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'light'}])

    # ---------------------------------------------------------------- the address keeps the set-up
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
    check(pressed(b) == ['Gap'], f'... with the Gap button lit ({pressed(b)})')
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
    # A shape with no button of its own (a slab, from an address) still loads, with no button lit.
    reload('#shape=slab&p=2&src=beam&sx=-5&sy=0&ang=30&w=1')
    check(b.eval('__app.state.shape') == 'slab' and pressed(b) == [] and b.eval("document.querySelector('#shape-box label').textContent") == 'thickness (λ)',
          f'#shape=slab (no button) loads with its own slider ({pressed(b)})')


def phone(b):
    b.eval('__app.state.running = false; __app.run(10)'); b.sleep(0.3)
    b.screenshot('build/mx-phone.png')
    w = b.eval("document.querySelector('#view').getBoundingClientRect().width")
    check(w > 340 and b.eval('document.documentElement.scrollWidth') <= 390, f'phone: the picture is {w:.0f} px wide and nothing overflows')
    vb, hb, cb = b.box('#view'), b.box('#hint'), b.box('.controls')
    check(hb[3] > 0 and hb[1] + hb[3] < 844 and hb[1] >= vb[1] + vb[3] and hb[1] < cb[1],
          f'phone: the hint is under the picture and above the controls, within the first screen (top {hb[1]:.0f}, bottom {hb[1] + hb[3]:.0f})')
    check('Drag the white square' in hint(b), f'phone: the Cherenkov hint: "{hint(b)[:50]}"')
    order = b.eval("[...document.querySelectorAll('.controls .panel > .label, .controls summary')].map((e) => e.textContent.trim().split(':')[0])")
    check(order == ['Set-ups', 'Source', 'Paint', 'Show', 'More'], f'phone: the panels come in a sensible order ({order})')
    b.eval('window.scrollTo(0, 700)'); b.sleep(0.3)
    b.screenshot('build/mx-phone-controls.png')
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
    b.sleep(0.4); b.eval('window.scrollTo(0, 0); __app.run(0.1)')
    theme_check(b, 'dark')
    b.screenshot('build/mx-phone-dark.png')


session('maxwell2d/index.html', (1400, 900), 'desktop', desktop)
session('maxwell2d/index.html#setup=cherenkov', (390, 844), 'phone', phone)
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
