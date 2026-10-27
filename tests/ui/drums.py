#!/usr/bin/env python3
"""Drive the drums demo: every experiment, the spectroscopist's peaks against the direct solver,
the filtered modes, Weyl's law, level statistics, the isospectral pair, a revival, drawing, and
readouts that hold still while their numbers change.

The machine running this may be heavily loaded: every wait polls with a generous cap, and a step
that times out or meets a page that is not ready fails with a message rather than a traceback."""
import os, re, sys, time, traceback
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
    with step('start'):
        check(started(b), 'the page starts')
        check(wait_for(b, '__app.modes', 300), 'the direct solver delivers the exact modes for the default stadium')
        b.sleep(2)
        b.screenshot('build/drums-start.png')
        st = b.eval('({ n: __app.modes.values.length, norm: __app.sim.norm() / __app.norm0, t: __app.sim.t, bounces: __app.ray && __app.ray.bounces })')
        check(st['n'] == 80, f"80 exact modes ({st['n']})")
        check(abs(st['norm'] - 1) < 1e-10, f"the billiard keeps its norm (drift {st['norm'] - 1:.1e} at t = {st['t']:.3f})")
        check(st['bounces'] and st['bounces'] > 0, f"the classical particle bounces ({st['bounces']})")
        steady(b, 'billiard readouts')

    # 1. The spectroscopist: a random state in the stadium, run fast; peaks on the exact levels.
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

    # 3. Build a mode from the motion: the overlap with the exact mode climbs.
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

    # 4. The square: grid eigenvalues are the exact products of sines; (1,2) and (2,1) degenerate.
    with step('square'):
        b.eval('__app.setups.square()')
        check(wait_for(b, '__app.modes && __app.state.shape === "square"', 300), 'square: exact modes arrive')
        b.sleep(1)
        r = b.eval("""(() => { const a = __app, d = a.geo.discrete(40), v = a.modes.values;
          let w = 0; for (let k = 0; k < 40; k++) w = Math.max(w, Math.abs(v[k] / d[k] - 1)); return { w, l2: v[1], l3: v[2] }; })()""")
        check(r['w'] < 1e-9, f"square: the 40 lowest eigenvalues are the grid's products of sines to {r['w']:.1e}")
        check(abs(r['l2'] / r['l3'] - 1) < 1e-9, f"square: modes 2 and 3 are degenerate ({r['l2']:.6f}, {r['l3']:.6f})")
        b.screenshot('build/drums-exp-square.png')

    # 5. The circle against the Bessel zeros.
    with step('circle'):
        b.eval('__app.setups.circle()')
        check(wait_for(b, '__app.modes && __app.state.shape === "circle"', 300), 'circle: exact modes arrive')
        b.sleep(1)
        r = b.eval("""(() => { const a = __app, ex = a.geo.exact(a.modes.values[20] * 1.3), v = a.modes.values;
          let w = 0; for (let k = 0; k < 20; k++) w = Math.max(w, Math.abs(v[k] / ex[k].lambda - 1)); return { w, j01: Math.sqrt(v[0]) * 0.48 }; })()""")
        check(r['w'] < 0.006, f"circle: the 20 lowest eigenvalues match (j_mk/R)² to {100 * r['w']:.2f}% (staircase edge); √λ₁R = {r['j01']:.4f} (j₀₁ = 2.4048)")
        b.screenshot('build/drums-exp-circle.png')
        steady(b, 'drum readouts')

    # 6. Struck in the middle: only the m = 0 modes ring.
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

    # 8-10. Counting: Weyl's law, Poisson, Wigner.
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

    # 12. The isospectral pair.
    with step('gww'):
        b.eval('__app.setups.gww()')
        check(wait_for(b, '__app.pinned && __app.modes && __app.state.shape === "gww2"', 600), 'GWW: both drums solved')
        r = b.eval("""(() => { const a = __app.pinned.values, b = __app.modes.values; let w = 0;
          for (let k = 0; k < Math.min(a.length, b.length); k++) w = Math.max(w, Math.abs(a[k] / b[k] - 1)); return { w, n: Math.min(a.length, b.length) }; })()""")
        check(r['w'] < 1e-9, f"GWW: the two drums' {r['n']} lowest eigenvalues agree to {r['w']:.1e}")
        b.sleep(1)
        b.screenshot('build/drums-exp-gww.png')

    # 11. Scars: the modes this packet excites most are concentrated along the axis: the share
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
        for name in ('sharpen', 'chladni', 'draw'):
            b.eval(f'__app.setups.{name}()')
            b.sleep(4)
            b.screenshot(f'build/drums-exp-{name}.png')

    # Drawing: paint a blob; the shape becomes "drawn" and its modes are recomputed.
    with step('drawing'):
        b.eval("__app.setups.draw()")
        b.sleep(0.5)
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
        b.drag('#stage', (0.48, 0.48), (0.53, 0.52), steps=4)
        ok = wait_for(b, '__app.state.shape === "drawn" && __app.modes', 300)
        r = b.eval('({ N: __app.grid.N, m: __app.modes && __app.modes.values.length })')
        check(ok and r['m'] and r['m'] <= r['N'], f"a tiny drawing ({r['N']} free points) gets {r['m']} modes and runs")

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

# Phone width.
with Browser('drums/index.html#setup=circle', size=(400, 850)) as b:
    with step('phone'):
        check(started(b), 'the phone layout starts')
        b.sleep(4)
        b.screenshot('build/drums-phone.png')
        wide = b.eval('document.documentElement.scrollWidth')
        check(wide <= 402, f'nothing wider than a phone screen ({wide} px)')
        no_exceptions(b, 'phone')

print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
