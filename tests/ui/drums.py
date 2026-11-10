#!/usr/bin/env python3
"""Drive the drums demo as a student would: the opening (a struck circular drum, with its hints,
worded readouts and the mode box's promise), a peak clicked with the mouse, every experiment, the
spectroscopist's peaks against the direct solver, the filtered modes, Weyl's law, level
statistics, the isospectral pair, a revival, drawing, the drawer's shape (Start here first, the
theory last), the dark theme, the phone layout, and readouts that hold still while their numbers
change.

The machine running this may be heavily loaded: every wait polls with a generous cap, and a step
that times out or meets a page that is not ready fails with a message rather than a traceback."""
import math, os, re, sys, time, traceback
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg, flush=True)
    if not cond: failures.append(msg)

def wait_for(b, expr, timeout=300):
    """Poll until expr is true in the page; False after `timeout` seconds."""
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            if b.eval(f'!!({expr})'): return True
        except RuntimeError:
            pass
        b.sleep(0.5)
    return False

class step:
    """A named part of the test: an exception inside it (a page not ready, a timeout) becomes a
    failure with a message, and the test goes on with the next part."""
    def __init__(self, name): self.name = name
    def __enter__(self): return self
    def __exit__(self, kind, err, tb):
        if err is not None:
            where = traceback.extract_tb(tb)[-1]
            check(False, f'{self.name}: {kind.__name__}: {str(err)[:300]} (line {where.lineno})')
        return True

def started(b, timeout=180):
    return wait_for(b, 'window.__app && __app.ready', timeout)

def no_exceptions(b, what):
    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, f'{what}: no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

def text(b, sel):
    return b.eval(f'document.querySelector({sel!r}).textContent')

def rgb(s):
    m = re.findall(r'[0-9.]+', s)
    return [float(v) for v in m[:3]] if m else [0, 0, 0]

def contrast(b, sel):
    """How far the text colour of the first element matching sel is from the page's background
    (the sum over the channels, 0..765): a readable hint or block is well above 150."""
    fg, bg = b.eval(f"""(() => {{ const e = document.querySelector({sel!r});
        return [getComputedStyle(e).color, getComputedStyle(document.body).backgroundColor]; }})()""")
    return sum(abs(x - y) for x, y in zip(rgb(fg), rgb(bg)))

# The drum's time in milliseconds (a 30 cm box, the wave speed c), from the simulation's time.
MS = '(__app.signal.T * 0.3 / __app.state.c * 1000)'

# Live readouts must hold still: every label and every number's slot keeps its place on screen
# while the numbers in them change.
PLACES = """[...document.querySelectorAll('#readouts .k, #readouts .slot, #spec-note .slot, #mode-info .slot, #solve-note .slot')]
  .map((e) => { const r = e.getBoundingClientRect(), label = e.closest('.ro')?.querySelector('.k')?.textContent || e.parentElement.id;
    return [e.className + ':' + label, r.left, r.right, r.top, e.textContent]; })"""

def steady(b, what, samples=10, gap=0.3):
    seen = []
    for _ in range(samples):
        seen.append(b.eval(PLACES))
        b.sleep(gap)
    counts = {len(s) for s in seen}
    if len(counts) != 1 or not seen[0]:
        check(False, f'{what}: the readouts changed their make-up while running ({sorted(counts)} items)')
        return
    first = seen[0]
    moved = max(max(abs(s[i][1] - first[i][1]), abs(s[i][2] - first[i][2]), abs(s[i][3] - first[i][3])) for s in seen for i in range(len(first)))
    changed = sum(1 for i in range(len(first)) if len({s[i][4] for s in seen}) > 1)
    check(moved < 0.5 and changed >= 2,
          f'{what}: {len(first)} labels and numbers stay put over {samples} samples (moved at most {moved:.2f} px) while {changed} numbers changed')
    # A number too big for its slot falls back to exponent form; only the drifts are meant to be.
    over = sorted({s[i][4].strip() + ' (' + s[i][0] + ')' for s in seen for i in range(len(first))
                   if s[i][0].startswith('slot') and 'drift' not in s[i][0] and re.search(r'\de[+−-]', s[i][4])})
    check(not over, f'{what}: every number fits its slot' + ('' if not over else ': ' + ', '.join(over[:4])))

with Browser('drums/index.html', size=(1400, 900)) as b:
    # ------------------------------------------------------------ the first screen
    with step('start'):
        check(started(b), 'the page starts')
        st = b.eval('({ mode: __app.state.mode, shape: __app.state.shape, speed: __app.state.speed.drum, tool: __app.state.tool })')
        check(st['mode'] == 'drum' and st['shape'] == 'circle' and st['tool'] == 'act',
              f"it opens on a drum, the circle, struck (slowed down {0.3 / 100 / st['speed'] and round(1 / (0.3 / 100 * st['speed']))} times)")
        check(wait_for(b, '__app.modes', 300), 'the direct solver delivers the exact modes for the circle')
        b.sleep(2)
        b.screenshot('build/drums-start.png')
        st = b.eval('({ n: __app.modes.values.length, drift: __app.sim.energy() / __app.norm0 - 1, t: __app.sim.t })')
        check(st['n'] == 80, f"80 exact modes ({st['n']})")
        check(abs(st['drift']) < 1e-10, f"the drum keeps its energy (drift {st['drift']:.1e} at t = {st['t']:.3f})")
        # The hint under the picture, where the eye is, and the spectrum's own hint.
        hint = text(b, '#stage-hint')
        check('Click the drum' in hint and 'click a peak' in hint, f'a hint under the picture says what to click: "{hint}"')
        g = b.eval("""(() => { const s = document.getElementById('stage').getBoundingClientRect(), h = document.getElementById('stage-hint').getBoundingClientRect();
            return { below: h.top >= s.bottom - 1 && h.top < s.bottom + 30, visible: h.height > 0 && h.bottom <= innerHeight, contrast: 0 }; })()""")
        check(g['below'] and g['visible'], 'the hint sits directly under the picture, on screen')
        check(contrast(b, '#stage-hint') > 150, f"the hint reads against the light background (contrast {contrast(b, '#stage-hint'):.0f})")
        sh = text(b, '#spec-hint')
        check(sh.startswith('Click a peak') and b.eval("document.getElementById('spec-hint').classList.contains('hint')"), f'the spectrum carries its own hint: "{sh}"')
        mi = text(b, '#mode-info')
        check('appears here' in mi, f'the Mode box says what it will show before anything is clicked: "{mi[:70]}…"')
        # Every number has words beside it.
        ro = b.eval("document.getElementById('readouts').innerText")
        check(all(w in ro for w in ('time', 'slowed down', 'times', 'energy drift (a check)', 'points inside the shape')), f'the readouts have words: "{ro}"')
        note = text(b, '#solve-note')
        check(re.match(r'80 exact modes found in [0-9.]+ s', note or ''), f'the stage head says in words what was computed: "{note}"')
        bare = b.eval("[...document.querySelectorAll('#presets button')].filter((e) => !e.title).map((e) => e.textContent)")
        check(not bare, 'every shape button has a tooltip' + ('' if not bare else ': none on ' + ', '.join(bare)))
        glosses = []
        for tab in ('list', 'weyl', 'spacing'):
            b.eval(f"document.querySelectorAll('#count-tabs button')[{['list', 'weyl', 'spacing'].index(tab)}].click()")
            glosses.append(text(b, '#tab-note'))
        b.eval("document.querySelectorAll('#count-tabs button')[0].click()")
        check(all(len(g) > 30 for g in glosses), f'each tab under the Mode box has a gloss ({[g[:28] for g in glosses]})')
        shown = b.eval("[...document.querySelectorAll('.controls details')].map((d) => [d.id || d.querySelector('summary').textContent, d.open])")
        check(all(not o for _, o in shown), f'the drawing tools and the extra sound tools are folded away at opening ({shown})')
        steady(b, 'drum readouts')

    # ------------------------------------------------------------ 1. the opening experiment
    with step('exp1'):
        # The two lowest peaks: the fundamental near 266 Hz, then the (±1, 1) pair near 424 Hz.
        check(wait_for(b, f'__app.signal && {MS} > 40', 600), 'the run reaches 40 ms')
        b.eval('__app.state.running = false')
        b.sleep(0.6)
        r = b.eval(f"""(() => {{ const a = __app, s = a.computeSpectrum();
          const big = Math.max(...s.peaks.map((q) => q.amp)), p = s.peaks.filter((q) => q.amp > 0.1 * big).map((q) => a.xOf(q.lambda)).sort((u, v) => u - v);
          return {{ p: p.slice(0, 2), ms: {MS}, width: a.peakWidth }}; }})()""")
        check(len(r['p']) == 2 and abs(r['p'][0] - 266) < 8 and abs(r['p'][1] - 424) < 10,
              f"the lowest peaks are at {[round(v) for v in r['p']]} Hz (help: near 266 and 424 Hz; exact 265.8 and 423.5)")
        # The width drawn over the spectrum is 1.9/T (73 Hz after 26 ms, as experiment 6 says).
        prod = r['width'] * r['ms'] / 1000
        check(abs(prod - 1.904) < 0.04 and abs(1.904 / 0.026 - 73) < 0.5, f"the peak width drawn is {r['width']:.1f} Hz at {r['ms']:.1f} ms: Δf·T = {prod:.3f} (1.904; so 73 Hz at 26 ms)")
        # Click the lowest peak with the mouse: its mode is built from the motion.
        fx = b.eval("(() => { const a = __app, f = a.specFrame, s = a.computeSpectrum(); const big = Math.max(...s.peaks.map((q) => q.amp)); const p = s.peaks.filter((q) => q.amp > 0.1 * big).sort((u, v) => u.lambda - v.lambda)[0]; return f.X(a.xOf(p.lambda)) / document.getElementById('spectrum').getBoundingClientRect().width; })()")
        b.click('#spectrum', (fx, 0.5))
        b.sleep(0.3)
        sel = b.eval('__app.selected && __app.selected.kind')
        check(sel == 'peak' and b.eval('__app.state.running'), f'a click on the peak picks it and the run goes on (selected: {sel})')
        b.eval('__app.state.fast = true')
        check(wait_for(b, '__app.filter && __app.filter.T > 15', 600), 'the mode builds over 45 ms of the drum')
        b.sleep(0.5)
        info = b.eval("document.getElementById('mode-info').innerText")
        m = re.search(r'([0-9.]+)% of it is exact mode 1\b', info)
        check(m and float(m.group(1)) > 95, f'the mode built from the lowest peak is the fundamental: "{info}"')
        b.screenshot('build/drums-exp1-mode.png')
        # Pointing at the spectrum shows the frequency there; leaving it brings the hint back.
        b.mouse('mouseMoved', *b.point('#spectrum', (0.5, 0.5)))
        b.sleep(0.2)
        hover = text(b, '#spec-hint')
        b.mouse('mouseMoved', *b.point('#stage', (0.5, 0.5)))
        b.sleep(0.2)
        check(re.search(r'f = +[0-9.]+ Hz', hover) and text(b, '#spec-hint').startswith('Click a peak'), f'pointing at the spectrum reads the frequency ("{hover[:40]}…") and the hint returns')
        b.eval('__app.state.fast = false')

    # ------------------------------------------------------------ the quantum tab
    with step('quantum'):
        b.eval("__app.setMode('quantum')")
        b.sleep(0.3)
        hint = text(b, '#stage-hint')
        check(hint.startswith('Drag on the shape'), f'the hint changes with the tab: "{hint}"')
        check(text(b, '#restart') == 'Restart' and b.eval("document.getElementById('quantum-controls').hidden === false && document.getElementById('drum-controls').hidden === true"),
              'the Restart button and the packet panel come with the quantum tab')
        check(wait_for(b, '__app.ray && __app.ray.bounces > 0', 120), 'the classical particle bounces')
        st = b.eval('({ norm: __app.sim.norm() / __app.norm0, t: __app.sim.t, bounces: __app.ray.bounces })')
        check(abs(st['norm'] - 1) < 1e-10, f"the billiard keeps its norm (drift {st['norm'] - 1:.1e} at t = {st['t']:.3f})")
        ro = b.eval("document.getElementById('readouts').innerText")
        check(all(w in ro for w in ('time t', 'energy ⟨E⟩ ± spread', "the particle's bounces", 'norm drift (a check)')), f'the billiard readouts have words: "{ro}"')
        steady(b, 'billiard readouts')
        b.eval("__app.setMode('drum')")
        b.sleep(0.2)
        check(text(b, '#restart') == 'Strike again', 'back on the drum, Restart reads "Strike again"')

    # ------------------------------------------------------------ the experiments
    # 7. The spectroscopist: a random state in the stadium, run fast; peaks on the exact levels.
    with step('spectroscopy'):
        b.eval('__app.setups.spectroscopy()')
        check(wait_for(b, '__app.modes && __app.signal && __app.signal.T > 2.5', 600), 'spectroscopy: the run reaches t = 2.5')
        b.screenshot('build/drums-exp-spectroscopy.png')
        # The weight of each exact mode in the start, |c_k|² = |⟨φ_k|ψ(0)⟩|², is the height its
        # peak should have: every isolated level with a sizeable weight must have a peak there.
        r = b.eval("""(() => { const a = __app, s = a.computeSpectrum(), T = a.signal.T, M = a.modes, h2 = a.grid.h ** 2;
          const [r0, i0] = a.psi0, lev = Array.from(M.values, (l) => l / 2), peaks = s.peaks;
          const w = lev.map((_, k) => { let x = 0, y = 0; for (let p = 0; p < M.N; p++) { const v = M.vectors[k * M.N + p], g = M.pts[p]; x += v * r0[g]; y += v * i0[g]; } return (x * x + y * y) * h2 * h2; });
          const fw = 2 * Math.PI * 1.904 / T, big = Math.max(...w);
          let iso = 0, found = 0, worst = 0, amp = 0;
          for (let k = 1; k + 1 < lev.length; k++) {
            if (Math.min(lev[k] - lev[k - 1], lev[k + 1] - lev[k]) < 3 * fw || w[k] < 0.1 * big) continue;
            iso++;
            let best = null;
            for (const p of peaks) if (!best || Math.abs(p.lambda / 2 - lev[k]) < Math.abs(best.lambda / 2 - lev[k])) best = p;
            const d = best ? Math.abs(best.lambda / 2 - lev[k]) : Infinity;
            if (d < 0.5 * fw) { found++; worst = Math.max(worst, d / fw); amp = Math.max(amp, Math.abs(best.amp / w[k] - 1)); }
          }
          return { T, iso, found, worst, fw, amp }; })()""")
        check(r['iso'] >= 5 and r['found'] == r['iso'] and r['worst'] < 0.03 and r['amp'] < 0.1,
              f"spectroscopy: all {r['found']} of {r['iso']} isolated, well-populated levels have a peak, within {100 * r['worst']:.1f}% of a width (T = {r['T']:.2f}, width ΔE = {r['fw']:.2f}), as high as |⟨φ_k|ψ(0)⟩|² to {100 * r['amp']:.1f}%")

    # 8. Build a mode from the motion: the overlap with the exact mode climbs.
    with step('filter'):
        b.eval('__app.setups.filter()')
        check(wait_for(b, '__app.filter && __app.filter.T > 0.3', 600), 'filter: the mode starts to build')
        steady(b, 'the mode panel and readouts while a mode builds')
        check(wait_for(b, '__app.filter && __app.filter.T > 1.6', 600), 'filter: the mode is built over t = 1.6')
        steady(b, 'the mode panel as the overlap nears 100%')
        b.sleep(0.5)
        info = b.eval("document.getElementById('mode-info').innerText")
        b.screenshot('build/drums-exp-filter.png')
        m = re.search(r'([0-9.]+)% of it is exact mode', info)
        check(m and float(m.group(1)) > 95, f'the filtered mode is the exact mode: "{info}"')

    # 3. The square: grid eigenvalues are the exact products of sines; (1,2) and (2,1) degenerate.
    with step('square'):
        b.eval('__app.setups.square()')
        check(wait_for(b, '__app.modes && __app.state.shape === "square"', 300), 'square: exact modes arrive')
        b.sleep(1)
        r = b.eval("""(() => { const a = __app, d = a.geo.discrete(40), v = a.modes.values;
          let w = 0; for (let k = 0; k < 40; k++) w = Math.max(w, Math.abs(v[k] / d[k] - 1)); return { w, l2: v[1], l3: v[2] }; })()""")
        check(r['w'] < 1e-9, f"square: the 40 lowest eigenvalues are the grid's products of sines to {r['w']:.1e}")
        check(abs(r['l2'] / r['l3'] - 1) < 1e-9, f"square: modes 2 and 3 are degenerate ({r['l2']:.6f}, {r['l3']:.6f})")
        b.screenshot('build/drums-exp-square.png')

    # 4. The circle against the Bessel zeros.
    with step('circle'):
        b.eval('__app.setups.circle()')
        check(wait_for(b, '__app.modes && __app.state.shape === "circle"', 300), 'circle: exact modes arrive')
        b.sleep(1)
        r = b.eval("""(() => { const a = __app, ex = a.geo.exact(a.modes.values[20] * 1.3), v = a.modes.values;
          let w = 0; for (let k = 0; k < 20; k++) w = Math.max(w, Math.abs(v[k] / ex[k].lambda - 1)); return { w, j01: Math.sqrt(v[0]) * 0.48 }; })()""")
        check(r['w'] < 0.006, f"circle: the 20 lowest eigenvalues match (j_mk/R)² to {100 * r['w']:.2f}% (staircase edge); √λ₁R = {r['j01']:.4f} (j₀₁ = 2.4048)")
        b.screenshot('build/drums-exp-circle.png')
        steady(b, 'drum readouts with a mode shown')

    # 2. Struck in the middle: only the m = 0 modes ring.
    with step('strike'):
        b.eval('__app.setups.strike()')
        check(wait_for(b, '__app.modes && __app.state.shape === "circle" && __app.signal && __app.signal.T > 40', 600), 'strike: the run reaches t = 40')
        r = b.eval("""(() => { const a = __app, s = a.computeSpectrum();
          const j0 = a.geo.exact(a.state.specMax * 1.2).filter((e) => e.label.startsWith('(0,')).map((e) => a.xOf(e.lambda));
          const strong = s.peaks.filter((p) => p.amp > 0.05 * Math.max(...s.peaks.map((q) => q.amp))).map((p) => a.xOf(p.lambda));
          const off = strong.map((x) => Math.min(...j0.map((y) => Math.abs(x / y - 1))));
          return { n: strong.length, worst: Math.max(...off) }; })()""")
        check(r['n'] >= 2 and r['worst'] < 0.01, f"struck in the middle, the circle's strong peaks are all m = 0 modes (j₀ₖ): {r['n']} peaks, worst {100 * r['worst']:.2f}% off")
        b.screenshot('build/drums-exp-strike.png')
        # The help: struck on the nodal circle of mode 6, (0, 2), its peak near 611 Hz drops out;
        # struck on the nodal line of mode 2, (1, 1), the peak near 424 Hz stays (its twin, mode 3, rings).
        GRIDMODE = """((k) => { const a = __app, m = a.modes, N = m.N, f = new Float64Array(a.grid.n * a.grid.n);
            for (let p = 0; p < N; p++) f[m.pts[p]] = m.vectors[k * N + p]; return f; })"""
        PEAK = """((f) => { const s = __app.computeSpectrum(); let best = 0, top = 0;
            for (let j = 0; j < s.x.length; j++) { top = Math.max(top, s.amp[j]); if (Math.abs(s.x[j] - f) < 6) best = Math.max(best, s.amp[j]); } return best / top; })"""
        geo = b.eval(f"""(() => {{ const a = __app, n = a.grid.n, h = a.grid.h, f6 = {GRIDMODE}(5), f2 = {GRIDMODE}(1), j = Math.round(0.5 / h);
            let r0 = null, prev = null;
            for (let i = j; i < n && r0 === null; i++) {{ const v = f6[j * n + i]; if (prev !== null && prev * v < 0) r0 = -0.5 + (i - 1 + prev / (prev - v)) * h; prev = v; }}
            let sx = 0, sy = 0; for (const g of a.grid.inner) {{ const i = g % n, jj = (g - i) / n; sx += f2[g] * (-0.5 + i * h); sy += f2[g] * (-0.5 + jj * h); }}
            return {{ r0, line: Math.atan2(sy, sx) + Math.PI / 2, f6: a.xOf(a.modes.values[5]), f2: a.xOf(a.modes.values[1]) }}; }})()""")
        b.eval('__app.state.fast = true')
        res = []
        for x, y, f in ((geo['r0'], 0, geo['f6']), (0.25 * math.cos(geo['line']), 0.25 * math.sin(geo['line']), geo['f2'])):
            b.eval(f'__app.state.strike = {{ x: {x}, y: {y} }}; __app.state.start = "strike"; __app.restart()')
            check(wait_for(b, '__app.signal && __app.signal.T > 60', 600), 'strike: the run reaches t = 60')
            res.append(b.eval(f'{PEAK}({f})'))
        b.eval('__app.state.fast = false')
        check(abs(geo['r0'] / 0.48 - 0.4356) < 0.01 and abs(geo['f6'] - 611) < 2 and res[0] < 0.01 and res[1] > 0.5,
              f"struck on mode 6's nodal circle (r = {geo['r0'] / 0.48:.3f} R; help: 0.44) its peak at {geo['f6']:.1f} Hz falls to {100 * res[0]:.2f}% of the tallest; "
              f"struck on mode 2's nodal line, the peak at {geo['f2']:.1f} Hz is still {100 * res[1]:.0f}% of the tallest (help: near 611 and 424 Hz)")

    # 9, 11, 12. Counting: Weyl's law, Poisson, Wigner.
    for name, shape in (('weyl', 'sinai8'), ('poisson', 'rectangle'), ('wigner', 'qstadium')):
        with step(name):
            b.eval(f'__app.setups.{name}()')
            ok = wait_for(b, f'__app.counted && __app.state.shape === "{shape}"', 900)
            check(ok, f'{name}: {shape} counted')
            b.sleep(0.5)
            note = b.eval("document.getElementById('count-note').textContent")
            b.screenshot(f'build/drums-exp-{name}.png')
            if name == 'weyl':
                m = re.search(r'area ([0-9.]+) \(true ([0-9.]+)\), perimeter ([0-9.]+) \(true ([0-9.]+)\)', note)
                check(m and abs(float(m.group(1)) / float(m.group(2)) - 1) < 0.01 and abs(float(m.group(3)) / float(m.group(4)) - 1) < 0.05, f'Weyl: "{note.split("Heard")[-1].strip()}"')
            else:
                m = re.search(r'below ¼: ([0-9.]+)%', note)
                frac = float(m.group(1)) if m else None
                want = (lambda f: f > 13) if name == 'poisson' else (lambda f: f < 9)
                check(frac is not None and want(frac), f'{name}: {frac}% of spacings below 1/4 (Poisson 22%, Wigner 4.8%)')
            if name == 'wigner':
                # The help: the whole stadium, four symmetry classes mixed, has about 14% of its
                # spacings below 1/4, twice as many as the quarter.
                # (The stadium's modes are in the cache by now: the count button must still say
                # that this shape is not counted yet, not keep the quarter stadium's "counted".)
                b.eval('__app.setShape("stadium")')
                ok = wait_for(b, '__app.modes && __app.state.shape === "stadium"', 600)
                btn = b.eval("(() => { const e = document.getElementById('count-more'); return [e.disabled, e.textContent]; })()")
                check(ok and not btn[0] and btn[1].startswith('Count'), f'a new shape whose modes come from the cache can be counted (the button: "{btn[1]}", disabled {btn[0]})')
                ok = ok and not btn[0]
                if ok:
                    # The button is below the fold at 1400 x 900: scroll to it, as a student would.
                    b.eval("document.getElementById('count-more').scrollIntoView({ block: 'center' })")
                    b.click('#count-more')
                    b.eval('scrollTo(0, 0)')
                    ok = wait_for(b, '__app.counted && __app.state.shape === "stadium"', 900)
                b.sleep(0.5)
                m = re.search(r'below ¼: ([0-9.]+)%', b.eval("document.getElementById('count-note').textContent"))
                whole = float(m.group(1)) if m else None
                check(ok and whole is not None and 13.5 < whole < 15.5 and whole > 1.8 * frac,
                      f'the whole stadium: {whole}% of spacings below 1/4, against {frac}% for the quarter (help: about 14%, twice as many)')

    # 10. The isospectral pair.
    with step('gww'):
        b.eval('__app.setups.gww()')
        check(wait_for(b, '__app.pinned && __app.modes && __app.state.shape === "gww2"', 600), 'GWW: both drums solved')
        r = b.eval("""(() => { const a = __app.pinned.values, b = __app.modes.values; let w = 0;
          for (let k = 0; k < Math.min(a.length, b.length); k++) w = Math.max(w, Math.abs(a[k] / b[k] - 1)); return { w, n: Math.min(a.length, b.length) }; })()""")
        check(r['w'] < 1e-9, f"GWW: the two drums' {r['n']} lowest eigenvalues agree to {r['w']:.1e}")
        check(b.eval("document.getElementById('drum-more').open"), 'the experiment opens the "More" panel that holds the pinned drum\'s buttons')
        b.sleep(1)
        b.screenshot('build/drums-exp-gww.png')

    # 14. Scars: the modes this packet excites most are concentrated along the axis: the share
    # of |φ|² within 0.04 of it, for the twelve heaviest modes, against the typical mode of the
    # same symmetry.
    with step('scars'):
        b.eval('__app.setups.scars()')
        check(wait_for(b, '__app.modes && __app.state.shape === "stadium" && __app.signal && __app.signal.T > 0.6', 600), 'scars: the run reaches t = 0.6')
        b.sleep(0.5)
        b.screenshot('build/drums-exp-scars.png')
        r = b.eval("""(() => { const a = __app, M = a.modes, n = a.grid.n, h = a.grid.h, [r0, i0] = a.psi0;
          let area = 0; for (const g of a.grid.inner) if (Math.abs(-0.5 + Math.floor(g / n) * h) < 0.04) area++;
          const rows = [];
          for (let k = 0; k < M.nvec; k++) { let x = 0, y = 0, s = 0, t = 0;
            for (let p = 0; p < M.N; p++) { const v = M.vectors[k * M.N + p], g = M.pts[p]; x += v * r0[g]; y += v * i0[g]; t += v * v; if (Math.abs(-0.5 + Math.floor(g / n) * h) < 0.04) s += v * v; }
            rows.push({ w: (x * x + y * y) * h ** 4, band: s / t }); }
          const sym = rows.filter((r) => r.w > 1e-6), top = [...sym].sort((p, q) => q.w - p.w).slice(0, 12);
          const mean = (xs) => xs.reduce((p, q) => p + q.band, 0) / xs.length;
          return { area: area / a.grid.N, top: mean(top), typical: mean(sym), weight: rows.reduce((p, q) => p + q.w, 0) }; })()""")
        check(r['top'] > 0.3 and r['typical'] < 0.28 and 0.17 < r['area'] < 0.22,
              f"scars: the 12 modes the packet excites most hold {100 * r['top']:.0f}% of |φ|² within 0.04 of the axis ({100 * r['area']:.0f}% of the area); a typical mode of that symmetry {100 * r['typical']:.0f}% (the 80 modes hold {100 * r['weight']:.0f}% of the packet)")

    # 13. The revival in the square.
    with step('revival'):
        b.eval('__app.setups.revival(); __app.state.fast = true')
        check(wait_for(b, '__app.sim && __app.state.shape === "square" && __app.sim.t > 1.32', 900), 'revival: the run reaches t = 1.32')
        r = b.eval("""(() => { const s = __app.signal; let best = 0, at = 0;
          for (let k = 0; k < s.length; k++) { const t = k * s.dts, c = Math.hypot(s.re[k], s.im[k]);
            if (t > 1.2 && t < 1.35 && c > best) { best = c; at = t; } }
          return { best, at }; })()""")
        check(r['best'] > 0.8 and abs(r['at'] - 1.28) < 0.02, f"revival: |⟨ψ(0)|ψ(t)⟩| returns to {r['best']:.3f} at t = {r['at']:.4f} (T_rev = 4/π = 1.2732)")
        b.screenshot('build/drums-exp-revival.png')

    # The other set-ups, for their pictures.
    with step('pictures'):
        for name in ('drum', 'sharpen', 'chladni', 'draw'):
            b.eval(f'__app.setups.{name}()')
            b.sleep(4)
            b.screenshot(f'build/drums-exp-{name}.png')

    # 15. Drawing: paint a blob; the shape becomes "drawn" and its modes are recomputed.
    with step('drawing'):
        b.eval("__app.setups.draw()")
        b.sleep(0.5)
        hint = text(b, '#stage-hint')
        check(hint.startswith('Paint on the picture') and b.eval("document.getElementById('draw-panel').open"), f'the pen opens its panel and the hint says to paint: "{hint}"')
        before = b.eval('__app.grid.N')
        b.drag('#stage', (0.1, 0.1), (0.3, 0.2), steps=8)
        b.sleep(0.3)
        after = b.eval('__app.grid.N')
        check(after > before and b.eval('__app.state.shape') == 'drawn', f'drawing adds membrane ({before} -> {after} free points)')
        check(wait_for(b, '__app.modes && __app.modes.values.length === 80', 300), 'the drawn drum gets its exact modes')

    # Striking the drum and launching a packet with the pointer; the address keeps the set-up.
    with step('pointer'):
        b.eval("__app.setups.circle()")
        b.sleep(0.5)
        b.click('#stage', (0.62, 0.45))
        b.sleep(0.3)
        check(b.eval('__app.state.strike.x > 0.05'), 'a click strikes the drum where it lands')
        b.eval("__app.setMode('quantum')")
        b.drag('#stage', (0.4, 0.5), (0.55, 0.42), steps=6)
        b.sleep(0.3)
        k = b.eval('__app.state.k')
        check(20 < k < 40 and b.eval('__app.state.angle > 0'), f'dragging launches a packet with the momentum dragged (|k| = {k})')
        h = b.eval('location.hash')
        check('shape=circle' in h and 'mode=quantum' in h, f'the address keeps the set-up ({h[:60]}...)')

    # A typed shape: the default ellipse x²/a² + y²/b² < 1, a = 0.45, b = 0.3.
    with step('typed'):
        b.eval("document.querySelector('#presets button:last-child').click()")
        ok = wait_for(b, '__app.state.shape === "typed" && __app.modes', 300)
        area = b.eval('__app.grid.N * __app.grid.h ** 2')
        check(ok and abs(area / (3.14159265 * 0.45 * 0.3) - 1) < 0.03, f'typed: the ellipse x²/a² + y²/b² < 1 has area {area:.4f} (πab = {3.14159265 * 0.45 * 0.3:.4f}) and gets its modes')
        b.screenshot('build/drums-typed.png')

    # A coarser grid, and a tiny drawn drum (fewer free points than modes asked for).
    with step('grid'):
        b.eval("document.querySelector('#grid-box button').click()")
        ok = wait_for(b, '__app.grid.n === 96 && __app.modes', 300)
        check(ok, f"the 96² grid works ({b.eval('__app.grid.N')} free points, {b.eval('__app.modes && __app.modes.values.length')} modes)")
        b.eval("document.getElementById('clear').click()")
        b.sleep(0.3)
        check(text(b, '#stage-hint').startswith('Paint a shape'), 'with nothing drawn yet, the hint says to paint a shape')
        b.drag('#stage', (0.48, 0.48), (0.53, 0.52), steps=4)
        ok = wait_for(b, '__app.state.shape === "drawn" && __app.modes', 300)
        r = b.eval('({ N: __app.grid.N, m: __app.modes && __app.modes.values.length })')
        check(ok and r['m'] and r['m'] <= r['N'], f"a tiny drawing ({r['N']} free points) gets {r['m']} modes and runs")

    # ------------------------------------------------------------ the drawer
    with step('drawer'):
        d = b.eval("""(() => { const dr = document.getElementById('help'), kids = [...dr.children].filter((e) => e.tagName !== 'HEADER');
          const exps = [...dr.querySelectorAll('.exp')], start = dr.querySelector('section.start'), theory = dr.querySelector('section.theory');
          return { first: kids[0] === start, h3: start && start.querySelector('h3').textContent, math: start ? start.querySelectorAll('math').length : -1,
            words: start ? start.textContent.trim().split(/\\s+/).length : 0,
            firstExp: exps[0] && exps[0].dataset.setup, n: exps.length, buttons: exps.filter((e) => e.querySelector('button.setup')).length,
            theoryLast: kids[kids.length - 1] === theory, theoryAfter: theory && exps.every((e) => e.compareDocumentPosition(theory) & Node.DOCUMENT_POSITION_FOLLOWING),
            setups: exps.map((e) => e.dataset.setup).filter((s) => !window.__app.setups[s]), equations: theory ? theory.querySelectorAll('math').length : 0 }; })()""")
        check(d['first'] and d['h3'] == 'Start here' and d['math'] == 0 and 60 < d['words'] < 200, f"the drawer opens with a Start-here block in plain words ({d['words']} words, no equations)")
        check(d['firstExp'] == 'drum' and d['n'] == 15 and d['buttons'] == 15 and not d['setups'], f"{d['n']} experiments, the first the opening state, each with a Set-it-up button and a set-up ({d['firstExp']})")
        check(d['theoryLast'] and d['theoryAfter'] and d['equations'] >= 3, f"the theory comes last, with its equations kept ({d['equations']} displayed)")
        b.click('#help-button')
        b.sleep(0.5)
        b.screenshot('build/drums-help.png')
        check(b.eval("document.getElementById('help').classList.contains('open')") and contrast(b, '.drawer .start p') > 150, 'the drawer opens and its Start-here block is readable')
        b.key('Escape')

    no_exceptions(b, 'the experiments')

# Opening a set-up from the address.
with Browser('drums/index.html#mode=drum&shape=stadium&p=%7B%22r%22%3A0.3%2C%22a%22%3A0.1%7D&x=0.05&y=0.1&w=0.02', size=(1200, 900)) as b:
    with step('address'):
        check(started(b), 'a set-up from the address starts')
        b.sleep(1)
        r = b.eval('({ mode: __app.state.mode, shape: __app.state.shape, r: __app.state.params.r, a: __app.state.params.a, x: __app.state.strike.x, w: __app.state.mallet })')
        check(r['mode'] == 'drum' and r['shape'] == 'stadium' and abs(r['r'] - 0.3) < 1e-9 and abs(r['a'] - 0.1) < 1e-9 and abs(r['x'] - 0.05) < 1e-9 and abs(r['w'] - 0.02) < 1e-9,
              f'the address restores a set-up ({r})')
        no_exceptions(b, 'restored set-up')

# The dark theme: the hints and the Start-here block read on it too.
with Browser('drums/index.html', size=(1400, 900)) as b:
    with step('dark'):
        b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
        check(started(b), 'the dark page starts')
        check(wait_for(b, '__app.modes', 300), 'dark: the modes arrive')
        b.sleep(1)
        bg = rgb(b.eval('getComputedStyle(document.body).backgroundColor'))
        check(sum(bg) < 200, f'dark: the page follows the dark colour scheme (background {bg})')
        c1, c2 = contrast(b, '#stage-hint'), contrast(b, '#spec-hint')
        check(c1 > 150 and c2 > 150, f'dark: both hints read on the dark background (contrast {c1:.0f}, {c2:.0f})')
        b.screenshot('build/drums-dark.png')
        b.click('#help-button')
        b.sleep(0.5)
        check(contrast(b, '.drawer .start p') > 150, f"dark: the Start-here block reads (contrast {contrast(b, '.drawer .start p'):.0f})")
        b.screenshot('build/drums-dark-help.png')
        no_exceptions(b, 'dark')

# Phone width: the hint is on screen with the picture, the panels in order, nothing sideways.
with Browser('drums/index.html', size=(390, 844)) as b:
    with step('phone'):
        check(started(b), 'the phone layout starts')
        b.sleep(4)
        b.screenshot('build/drums-phone.png')
        g = b.eval("""(() => { const r = (id) => document.getElementById(id).getBoundingClientRect();
          return { scrollY, hintBottom: r('stage-hint').bottom, hintH: r('stage-hint').height, stageBottom: r('stage').bottom,
            specTop: document.getElementById('spectrum').getBoundingClientRect().top, wide: document.documentElement.scrollWidth,
            controlsTop: document.querySelector('.controls').getBoundingClientRect().top }; })()""")
        check(g['scrollY'] == 0 and g['hintH'] > 0 and g['hintBottom'] <= 844 and g['hintBottom'] > g['stageBottom'], f"the hint is under the picture and on screen without scrolling (bottom at {g['hintBottom']:.0f} px of 844)")
        check(g['stageBottom'] < g['specTop'] < g['controlsTop'], 'the picture, then the spectrum, then the controls')
        check(g['wide'] <= 392, f"nothing wider than a phone screen ({g['wide']} px)")
        no_exceptions(b, 'phone')

print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
