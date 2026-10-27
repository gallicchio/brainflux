#!/usr/bin/env python3
"""Drive the drums demo: every experiment, the spectroscopist's peaks against the direct solver,
the filtered modes, Weyl's law, level statistics, the isospectral pair, a revival, drawing."""
import json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

def wait_for(b, expr, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if b.eval(f'!!({expr})'): return True
        b.sleep(0.25)
    return False

# Peaks of the spectrum against the exact eigenvalues: every isolated level (3 peak widths from
# its neighbours, inside the range shown) should have a peak within a tenth of a width.
PEAKS = """(() => { const a = __app, s = a.computeSpectrum(); if (!s) return null;
  const vals = Array.from(a.modes.values), T = a.signal.T;
  const xs = vals.map(a.xOf), top = s.x[s.x.length - 1];
  const fw = Math.abs(a.xOf(a.lambdaOfOmega(a.sim.numericalOmega ? 0 : 0)));
  const peaks = s.peaks.map((p) => a.xOf(p.lambda));
  return { xs, peaks, top, T, amp: s.peaks.map((p) => p.amp) }; })()"""

with Browser('drums/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready')
    check(wait_for(b, '__app.modes', 60), 'the direct solver delivers the exact modes for the default stadium')
    b.sleep(2)
    b.screenshot('build/drums-start.png')
    st = b.eval('({ n: __app.modes.values.length, norm: __app.sim.norm() / __app.norm0, t: __app.sim.t, bounces: __app.ray && __app.ray.bounces })')
    check(st['n'] == 80, f"80 exact modes ({st['n']})")
    check(abs(st['norm'] - 1) < 1e-10, f"the billiard keeps its norm (drift {st['norm'] - 1:.1e} at t = {st['t']:.3f})")
    check(st['bounces'] and st['bounces'] > 0, f"the classical particle bounces ({st['bounces']})")

    # 1. The spectroscopist: a random state in the stadium, run fast; peaks on the exact levels.
    b.eval('__app.setups.spectroscopy()')
    wait_for(b, '__app.modes && __app.signal && __app.signal.T > 2.5', 120)
    b.screenshot('build/drums-exp-spectroscopy.png')
    # The weight of each exact mode in the start, |c_k|² = |⟨φ_k|ψ(0)⟩|², is the height its peak
    # should have: every isolated level with a sizeable weight must have a peak there, that high.
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
    b.eval('__app.setups.filter()')
    wait_for(b, '__app.filter && __app.filter.T > 1.6', 120)
    b.sleep(0.5)
    info = b.eval("document.getElementById('mode-info').innerText")
    b.screenshot('build/drums-exp-filter.png')
    import re
    m = re.search(r'([0-9.]+)% of it is exact mode', info)
    check(m and float(m.group(1)) > 95, f'the filtered mode is the exact mode: "{info}"')

    # 4. The square: grid eigenvalues are the exact products of sines; (1,2) and (2,1) degenerate.
    b.eval('__app.setups.square()')
    wait_for(b, '__app.modes && __app.state.shape === "square"', 60)
    b.sleep(1)
    r = b.eval("""(() => { const a = __app, d = a.geo.discrete(40), v = a.modes.values;
      let w = 0; for (let k = 0; k < 40; k++) w = Math.max(w, Math.abs(v[k] / d[k] - 1)); return { w, l2: v[1], l3: v[2] }; })()""")
    check(r['w'] < 1e-9, f"square: the 40 lowest eigenvalues are the grid's products of sines to {r['w']:.1e}")
    check(abs(r['l2'] / r['l3'] - 1) < 1e-9, f"square: modes 2 and 3 are degenerate ({r['l2']:.6f}, {r['l3']:.6f})")
    b.screenshot('build/drums-exp-square.png')

    # 5. The circle against the Bessel zeros.
    b.eval('__app.setups.circle()')
    wait_for(b, '__app.modes && __app.state.shape === "circle"', 60)
    b.sleep(1)
    r = b.eval("""(() => { const a = __app, ex = a.geo.exact(a.modes.values[20] * 1.3), v = a.modes.values;
      let w = 0; for (let k = 0; k < 20; k++) w = Math.max(w, Math.abs(v[k] / ex[k].lambda - 1)); return { w, j01: Math.sqrt(v[0]) * 0.48 }; })()""")
    check(r['w'] < 0.006, f"circle: the 20 lowest eigenvalues match (j_mk/R)² to {100 * r['w']:.2f}% (staircase edge); √λ₁R = {r['j01']:.4f} (j₀₁ = 2.4048)")
    b.screenshot('build/drums-exp-circle.png')

    # 6. Struck in the middle: only the m = 0 modes ring.
    b.eval('__app.setups.strike()')
    wait_for(b, '__app.modes && __app.state.shape === "circle" && __app.signal && __app.signal.T > 40', 90)
    r = b.eval("""(() => { const a = __app, s = a.computeSpectrum(), R = 0.48;
      const j0 = a.geo.exact(a.state.specMax * 1.2).filter((e) => e.label.startsWith('(0,')).map((e) => a.xOf(e.lambda));
      const strong = s.peaks.filter((p) => p.amp > 0.05 * Math.max(...s.peaks.map((q) => q.amp))).map((p) => a.xOf(p.lambda));
      const off = strong.map((x) => Math.min(...j0.map((y) => Math.abs(x / y - 1))));
      return { n: strong.length, worst: Math.max(...off), strong }; })()""")
    check(r['n'] >= 2 and r['worst'] < 0.01, f"struck in the middle, the circle's strong peaks are all m = 0 modes (j₀ₖ): {r['n']} peaks, worst {100 * r['worst']:.2f}% off")
    b.screenshot('build/drums-exp-strike.png')

    # 8-10. Counting: Weyl's law, Poisson, Wigner.
    for name, shape in (('weyl', 'sinai8'), ('poisson', 'rectangle'), ('wigner', 'qstadium')):
        b.eval(f'__app.setups.{name}()')
        ok = wait_for(b, f'__app.counted && __app.state.shape === "{shape}"', 180)
        b.sleep(0.5)
        note = b.eval("document.getElementById('count-note').textContent")
        b.screenshot(f'build/drums-exp-{name}.png')
        if name == 'weyl':
            m = re.search(r'area ([0-9.]+) \(true ([0-9.]+)\), perimeter ([0-9.]+) \(true ([0-9.]+)\)', note)
            check(ok and m and abs(float(m.group(1)) / float(m.group(2)) - 1) < 0.01 and abs(float(m.group(3)) / float(m.group(4)) - 1) < 0.05, f'Weyl: "{note.split("Heard")[-1].strip()}"')
        else:
            m = re.search(r'below ¼: ([0-9.]+)%', note)
            frac = float(m.group(1)) if m else None
            want = (lambda f: f > 13) if name == 'poisson' else (lambda f: f < 9)
            check(ok and frac is not None and want(frac), f'{name}: {frac}% of spacings below 1/4 (Poisson 22%, Wigner 4.8%)')

    # 12. The isospectral pair.
    b.eval('__app.setups.gww()')
    ok = wait_for(b, '__app.pinned && __app.modes && __app.state.shape === "gww2"', 120)
    r = b.eval("""(() => { const a = __app.pinned.values, b = __app.modes.values; let w = 0;
      for (let k = 0; k < Math.min(a.length, b.length); k++) w = Math.max(w, Math.abs(a[k] / b[k] - 1)); return { w, n: Math.min(a.length, b.length) }; })()""")
    check(ok and r['w'] < 1e-9, f"GWW: the two drums' {r['n']} lowest eigenvalues agree to {r['w']:.1e}")
    b.sleep(1)
    b.screenshot('build/drums-exp-gww.png')

    # 11. Scars: the packet along the stadium's axis; the autocorrelation comes back.
    b.eval('__app.setups.scars()')
    wait_for(b, '__app.modes && __app.state.shape === "stadium" && __app.signal && __app.signal.T > 0.6', 120)
    b.sleep(0.5)
    b.screenshot('build/drums-exp-scars.png')
    # The modes this packet excites most are concentrated along the axis: the share of |φ|² within
    # 0.04 of it, for the twelve heaviest modes, against the average mode of the same symmetry.
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
    b.eval('__app.setups.revival(); __app.state.fast = true')
    wait_for(b, '__app.sim && __app.sim.t > 1.32', 240)
    r = b.eval("""(() => { const s = __app.signal; let best = 0, at = 0, low = 1;
      for (let k = 0; k < s.length; k++) { const t = k * s.dts, c = Math.hypot(s.re[k], s.im[k]);
        if (t > 1.2 && t < 1.35 && c > best) { best = c; at = t; } if (t > 0.3 && t < 1.1) low = Math.min(low, c); }
      return { best, at, low }; })()""")
    check(r['best'] > 0.8 and abs(r['at'] - 1.28) < 0.02, f"revival: |⟨ψ(0)|ψ(t)⟩| returns to {r['best']:.3f} at t = {r['at']:.4f} (T_rev = 4/π = 1.2732)")
    b.screenshot('build/drums-exp-revival.png')

    # The other set-ups, for their pictures.
    for name in ('sharpen', 'chladni', 'draw'):
        b.eval(f'__app.setups.{name}()')
        b.sleep(4)
        b.screenshot(f'build/drums-exp-{name}.png')

    # Drawing: paint a blob; the shape becomes "drawn" and its modes are recomputed.
    b.eval("__app.setups.draw()")
    b.sleep(0.5)
    before = b.eval('__app.grid.N')
    b.drag('#stage', (0.1, 0.1), (0.3, 0.2), steps=8)
    b.sleep(0.3)
    after = b.eval('__app.grid.N')
    check(after > before and b.eval('__app.state.shape') == 'drawn', f'drawing adds membrane ({before} -> {after} free points)')
    check(wait_for(b, '__app.modes && __app.modes.values.length === 80', 60), 'the drawn drum gets its exact modes')

    # Striking the drum and launching a packet with the pointer.
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
    # The address keeps the set-up.
    h = b.eval('location.hash')
    check('shape=circle' in h and 'mode=quantum' in h, f'the address keeps the set-up ({h[:60]}...)')

    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

# Phone width.
with Browser('drums/index.html#setup=circle', size=(400, 850)) as b:
    b.wait('window.__app && __app.ready')
    b.sleep(4)
    b.screenshot('build/drums-phone.png')
    wide = b.eval('document.documentElement.scrollWidth')
    check(wide <= 402, f'nothing wider than a phone screen ({wide} px)')
    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'phone: no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
