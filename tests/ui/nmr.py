#!/usr/bin/env python3
"""Drive the Bloch sphere and NMR demo: the opening, every view and experiment and the numbers
their help quotes, the pulses, dragging the arrow's tip and the timeline's pulses, the scans and
their fits, the Earth's-field board's cycle and its sound, the fixed readouts, the address, the
dark theme and a phone.  The page's clock is held and stepped from here (__app.hold, __app.step,
__app.runTo), so nothing depends on how fast the machine is."""
import json, math, os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

def near(a, b, tol): return a is not None and abs(a - b) <= tol

def run(b, name):
    b.eval(f'__app.setups[{json.dumps(name)}](); __app.step(0, 1)')

def phrase(text):
    return re.sub(r'[−+-]?\d[\d.,]*(?:e[−+-]?\d+)?', '#', text)

def keeps_still(b, sel, steps):
    """Run steps (callables that change the numbers shown) and compare the boxes of the elements
    matching sel with those first seen with the same words: (largest shift, compared, texts)."""
    texts = f"[...document.querySelectorAll({json.dumps(sel)})].map((e) => e.textContent).join(' | ')"
    t0 = b.eval(texts)
    first = {phrase(t0): b.rects(sel)}
    worst, compared, seen = 0.0, 0, {t0}
    for step in steps:
        step()
        r, t = b.rects(sel), b.eval(texts)
        seen.add(t)
        r0 = first.setdefault(phrase(t), r)
        if r0 is r or len(r) != len(r0): continue
        compared += 1
        worst = max([worst] + [abs(x - y) for a, c in zip(r0, r) for x, y in zip(a, c)])
    return worst, compared, seen

def visible_hints(b):
    return b.eval("[...document.querySelectorAll('.hint')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map((e) => e.textContent.trim())")

def reload(b):
    """Reload the page and wait for the new one (the old page's __app can linger a moment)."""
    b.eval('window.__stale = true; location.reload()')
    b.wait('!window.__stale && window.__app && __app.ready', timeout=60)

def text_of(b, sel): return b.eval(f"document.querySelector({json.dumps(sel)}).textContent")

def help_text(b, name): return b.eval(f"document.querySelector('#help [data-setup=\"{name}\"]').textContent.replace(/\\s+/g, ' ')")

def quotes(b, name, *needles):
    t = help_text(b, name)
    return all(n in t for n in needles)

with Browser('nmr/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready', timeout=90)
    b.eval('__app.hold(true)')
    b.screenshot('build/nmr-start.png')

    # ---- the first screen: one spin precessing in the lab frame, the hint, the drawer's order
    s = b.eval('__app.state')
    check(s['view'] == 'one' and s['frame'] == 'lab' and s['inst'] == 'teachspin' and not s['ensemble'], 'opens on one spin in the lab frame, with the TeachSpin\'s numbers')
    hints = visible_hints(b)
    check(len(hints) == 1 and hints[0].startswith("Drag the arrow's tip") and 'pulse button' in hints[0], f'one hint under the sphere says what to drag and press ({hints})')
    hb, sb = b.box('#sphere-hint'), b.box('#sphere-wrap')
    check(hb[1] >= sb[1] + sb[3] - 1 and hb[1] - (sb[1] + sb[3]) < 12, 'the hint sits directly under the sphere')
    order = b.eval("[...document.querySelectorAll('#help > section, #help > article')].map((e) => e.className)")
    start = b.eval("document.querySelector('#help .start').innerText")
    check(order[0] == 'start' and order[-1] == 'theory' and 'math' not in b.eval("document.querySelector('#help .start').innerHTML")
          and "Drag the arrow's tip" in start and 'pulse button' in start and len(start) < 1600, f'the drawer opens with Start here, plain words, and ends with How it works ({len(order) - 2} experiments)')
    check(b.eval("document.querySelectorAll('#help merror').length") == 0, 'every formula in the help is understood')
    names = b.eval('Object.keys(__app.setups)')
    arts = b.eval("[...document.querySelectorAll('#help .exp')].map((e) => e.dataset.setup)")
    check(arts == names and len(names) == 20, f'one experiment per set-up, in order ({len(names)})')
    ph = [b.eval('(() => { const m = __app.sum("lab"); return Math.atan2(m[1], m[0]); })()')]
    b.eval('__app.step(0.25, 1)')
    ph.append(b.eval('(() => { const m = __app.sum("lab"); return Math.atan2(m[1], m[0]); })()'))
    d = ((ph[0] - ph[1]) * 180 / math.pi) % 360
    check(near(d, 90, 1e-4), f'it precesses clockwise seen from +z, a quarter turn in a quarter second at time ×2×10⁻⁷ ({d:.5f}°)')
    ro = b.eval("document.querySelector('#readout').innerText")
    check('Larmor frequency' in ro and '5.000000' in ro and 'what the coil sees' in ro and 'one second here is' in ro, 'the read-out says the field, the Larmor frequency and the slow motion in words')
    sh = b.eval("document.querySelector('#spin-half').innerText")
    check('0.924' in sh and '0.383' in sh and '0.854' in sh and 'θ' in sh, f"the spin-½ box: cos 22.5° = 0.924, sin 22.5° = 0.383, P(↑) = 0.854")

    # ---- 1. Larmor: f0 = γB0/2π; twice the field, twice the rate; dragging the tip
    run(b, 'larmor')
    f0 = b.eval('__app.eng.f0')
    check(near(f0, 5e6, 1e-3) and near(b.eval('__app.state.B0') * 1e3, 117.434, 0.001) and quotes(b, 'larmor', '5.000 MHz', '117.4 mT', '234.9 mT'),
          f'1: f0 = {f0:.3f} Hz at {b.eval("__app.state.B0") * 1e3:.3f} mT; the help says 5.000 MHz in 117.4 mT')
    b.eval("(() => { const s = [...document.querySelectorAll('#more-box .slider')].find((e) => e.querySelector('label').textContent.startsWith('field B')); const i = s.querySelector('input[type=number]'); i.value = 234.87; i.dispatchEvent(new Event('change')); })()")
    check(near(b.eval('__app.eng.f0'), 1e7, 2e2), f"1: at 234.87 mT the Larmor frequency is {b.eval('__app.eng.f0') / 1e6:.4f} MHz: twice")
    run(b, 'larmor')
    th0 = b.eval('(() => { const m = __app.sum("rot"); return Math.acos(m[2]) * 180 / Math.PI; })()')
    tip = b.eval('__app.tip()'); box = b.box('#sphere')
    b.drag('#sphere', (tip[0] / box[2], tip[1] / box[3]), ((tip[0] + 25) / box[2], (tip[1] + 70) / box[3]), steps=8)
    b.eval('__app.step(0, 1)')
    th1 = b.eval('(() => { const m = __app.sum("rot"); return Math.acos(m[2]) * 180 / Math.PI; })()')
    check(th1 > th0 + 15, f'dragging the arrow\'s tip down tips it further from B0 (θ {th0:.1f}° -> {th1:.1f}°)')
    az0 = b.eval('__app.view.az')
    b.drag('#sphere', (0.1, 0.8), (0.3, 0.8), steps=6)
    check(abs(b.eval('__app.view.az') - az0) > 0.2, 'dragging elsewhere turns the sphere')

    # ---- the pulse buttons
    b.eval("__app.startFree([0, 0, 1]); __app.state.frame = 'rot'")
    b.eval("[...document.querySelectorAll('.pulse-buttons button')][0].click()")
    b.eval('__app.runTo(__app.eng.t + 3e-6)')
    m = b.eval('__app.sum("rot")')
    check(near(m[1], 1, 1e-9) and near(m[2], 0, 1e-9), f'the button "π/2 about x′" takes the spin from z to +y′ ({m[1]:.6f}, {m[2]:.1e})')
    b.eval("[...document.querySelectorAll('.pulse-buttons button')][1].click(); __app.runTo(__app.eng.t + 6e-6)")
    m = b.eval('__app.sum("rot")')
    check(near(m[1], -1, 1e-9), f'"π about x′" then takes +y′ to −y′ ({m[1]:.6f})')

    # ---- 2. the π/2 pulse in the lab frame
    run(b, 'pulse90')
    b.eval('__app.runTo(12e-6)')
    m = b.eval('__app.sum("rot")'); r = b.eval('__app.state.B0 / __app.state.B1')
    raw = b.eval('(() => { const R = __app.eng.record; let mx = 0; for (let t = 6e-6; t < 7e-6; t += 1e-9) { const p = R.at(t); mx = Math.max(mx, p[0] * Math.sin(__app.eng.omegaRef * t) - p[1] * Math.cos(__app.eng.omegaRef * t)); } return mx; })()')
    check(near(m[1], 1, 1e-9) and near(r, 50, 1e-9) and near(raw, 1, 1e-3) and quotes(b, 'pulse90', '2.50 μs', '2.35 mT', '50 times', 'twelve and a half'),
          f'2: after the π/2 M = +y′ and the coil rings at full size ({raw:.4f}); B0/B1 = {r:.2f}; {f0 * 2.5e-6:.1f} turns during the 2.50 μs pulse')
    b.screenshot('build/nmr-pulse90.png')

    # ---- 3. the rotating frame: π/2 about y′ goes to −x′
    run(b, 'rotating')
    b.eval("__app.runTo(8e-6); __app.eng.setVector([0, 0, 1], 'rot'); __app.sendPulse(90, 90); __app.runTo(__app.eng.t + 4e-6)")
    m = b.eval('__app.sum("rot")')
    check(near(m[0], -1, 1e-9), f'3: π/2 about y′ from z gives −x′ ({m[0]:.6f})')

    # ---- 4. off resonance
    run(b, 'offres')
    b.eval('__app.runTo(4.5e-6)')
    mz = b.eval('__app.sum("rot")[2]')
    xs = b.eval('[6e-6, 11e-6, 16e-6, 21e-6].map((t) => { __app.runTo(t); const m = __app.sum("rot"); return [m[0], m[1], Math.hypot(m[0], m[1])]; })')
    check(near(mz, 0.053, 5e-4) and quotes(b, 'offres', '0.053', '0.197', '50 kHz'), f'4: 50 kHz off the "π/2" leaves Mz = {mz:.4f} (the help: 0.053)')
    check(xs[0][0] * xs[2][0] < 0 and max(r_[2] for r_ in xs) - min(r_[2] for r_ in xs) < 1e-9, f'4: the mixer\'s outputs beat (Mx′ {xs[0][0]:+.2f} at 6 μs, {xs[2][0]:+.2f} at 16 μs) while the envelope holds ({xs[0][2]:.6f})')
    b.screenshot('build/nmr-offres.png')

    # ---- 5. many spins: the FID dies with T2* = 1/(πΔf), no spin shrinks; the line is Δf wide
    run(b, 'spread')
    t2s = 1 / (math.pi * 500)
    b.eval(f'__app.runTo({t2s} + 1.25e-6)')
    mm = b.eval('Math.hypot(...__app.sum("rot"))')
    lens = b.eval('__app.eng.vectors("rot", 64).map((v) => Math.hypot(...v))')
    check(near(mm, math.exp(-1), 0.01) and max(abs(l - 1) for l in lens) < 1e-9 and quotes(b, 'spread', '0.64 ms', '500 Hz'),
          f'5: after T2* = {t2s * 1e3:.3f} ms the sum is {mm:.4f} long (e⁻¹ = 0.368); every spin is still 1 long')
    b.eval('__app.runTo(4e-3)')
    sp5 = b.eval('__app.spec')
    check(near(sp5['fwhm'], 500, 5) and near(sp5['peak']['f'], 0, 2), f"5: the spectrum's line is {sp5['fwhm']:.1f} Hz wide at half power, at {sp5['peak']['f']:+.2f} Hz from f0 (Δf = 500 Hz = 1/(πT2*))")
    b.screenshot('build/nmr-spread.png')

    # ---- 6. the echo
    run(b, 'echo')
    b.eval('__app.runTo(5e-3)')
    e6 = b.eval('__app.eng.record.envelopeMax(2.9e-3, 3.1e-3)')
    mz5 = b.eval('__app.sum("rot")[2]')
    check(near(e6['t'], 3e-3, 2e-6) and near(e6['max'], 0.86, 0.005) and near(mz5, 0.08, 0.005) and quotes(b, 'echo', '1.5 ms', '0.86', '0.08 by 5 ms'),
          f"6: the echo at {e6['t'] * 1e3:.3f} ms is {e6['max']:.4f} of the FID's start (e^(−2τ/T2) = {math.exp(-0.15):.4f}); Mz = {mz5:.3f} at 5 ms")
    b.screenshot('build/nmr-echo.png')

    # ---- 7. three clocks: T2*, T2 and T1 on one log-time plot, the ring on the sphere, CPMG beside
    run(b, 'threeclocks')
    s7 = b.eval('__app.state')
    shown = b.eval("['#clocks-wrap', '#signal-wrap', '#raw-wrap', '#spec-wrap', '#clocks-panel', '#noise-panel'].map((q) => { const r = document.querySelector(q).getBoundingClientRect(); return r.width > 0 && r.height > 0; })")
    t2s7 = 1 / (1 / s7['T2'] + math.pi * s7['spreadHz'])
    check(s7['view'] == 'many' and s7['frame'] == 'rot' and s7['ensemble'] and b.eval('__app.clocks.on') and near(s7['T1'], 0.1, 1e-12) and near(s7['T2'], 0.01, 1e-12)
          and near(s7['spreadHz'], 900 / math.pi, 1e-9) and near(t2s7, 1e-3, 1e-12) and s7['sample'] is None and shown == [True, False, False, False, True, False],
          f"7: view 2 with T1 = 100 ms, T2 = 10 ms and a {s7['spreadHz']:.2f} Hz spread (T2* = {t2s7 * 1e3:.4f} ms); the clocks' plot and panel in place of the signal's plots and the noise ({shown})")
    # The clock speeds up as it goes: a decade every 3 s on screen, the whole run in about 12 s.
    n_end = b.eval('(() => { let n = 0; for (; n < 2e4 && !__app.eng.done; n++) __app.step(1 / 60); return n; })()')
    check(10.5 < n_end / 60 < 13 and b.eval('__app.run && __app.run.clocks && __app.eng.done') and near(b.eval('__app.eng.t'), 0.3, 1e-9),
          f'7: the log clock takes {n_end / 60:.1f} s on screen from the pulse to 300 ms (1.3 s to 0.1 ms, then 3 s a decade), and holds at the end')
    f7c = b.eval('__app.clockFits()'); e7 = b.eval('__app.clockEchoes()')
    tr = b.eval('(() => { const T = __app.clocks.trace, at = (t) => T.t.findIndex((x) => x >= t); const i = at(1e-3); let over = -1; T.t.forEach((t, k) => { over = Math.max(over, T.sig[k] - T.perp[k]); }); return { t1: T.t[i], sig: T.sig[i], perp: T.perp[i], over, n: T.t.length }; })()')
    k10 = min(range(len(e7['t'])), key=lambda k: abs(e7['t'][k] - 0.01))
    ro7 = text_of(b, '#readout')
    check(near(f7c['T2s']['tau'], 1e-3, 3e-6) and near(f7c['T2']['tau'], 0.01, 1e-8) and near(f7c['T1']['tau'], 0.1, 1e-7) and near(e7['fit']['T2'], 0.01, 1e-4) and len(e7['t']) == 12
          and 'T₂* = 1.00 ms' in ro7 and 'T₂ = 10.0 ms' in ro7 and 'T₁ = 100 ms' in ro7 and 'T₂* ≤ T₂ ≤ 2T₁' in ro7
          and quotes(b, 'threeclocks', '1.00, 10.0 and 100 ms', '286.5 Hz', 'every 5 ms', 'gives 10.0 ms'),
          f"7: fitted T2* = {f7c['T2s']['tau'] * 1e3:.4f} ms, T2 = {f7c['T2']['tau'] * 1e3:.4f} ms, T1 = {f7c['T1']['tau'] * 1e3:.3f} ms; the CPMG run's {len(e7['t'])} echoes give T2 = {e7['fit']['T2'] * 1e3:.3f} ms; the read-out says so")
    check(near(tr['sig'], 0.37, 0.005) and near(tr['perp'], 0.90, 0.005) and tr['over'] <= 1e-12 and near(e7['amp'][k10], math.exp(-1), 0.003) and near(e7['t'][k10], 0.01, 1e-9)
          and quotes(b, 'threeclocks', 'down to 0.37', '0.90 long', 'the second, at 10 ms'),
          f"7: at {tr['t1'] * 1e3:.3f} ms the sum is {tr['sig']:.3f} long, each spin's own part {tr['perp']:.3f}; over {tr['n']} samples the sum never passes the spins' mean ({tr['over']:.1e}); the echo at 10 ms is {e7['amp'][k10]:.4f} (1/e = 0.3679)")
    ring = b.eval('[__app.eng.meanTransverse(), __app.sum("rot")[2]]')
    b.screenshot('build/nmr-threeclocks.png')
    # A clock is read once it has run: at 5 ms T2* is there, T2 and T1 are not.
    run(b, 'threeclocks'); b.eval('__app.runTo(5e-3)')
    f5 = b.eval('__app.clockFits()'); ro5 = text_of(b, '#readout')
    check(f5['T2s'] is not None and f5['T2'] is None and f5['T1'] is None and 'T₂ = –' in ro5 and near(ring[0], math.exp(-30) * 0.9994, 1e-12) and near(ring[1], 1 - math.exp(-3), 1e-3),
          f"7: at 5 ms only T2* is read (T2 '–' in the read-out); at 300 ms the ring's radius is {ring[0]:.1e} at height {ring[1]:.4f}")
    # A slider starts it again with the new times; pushing T2 past 2T1 brings T1 along.
    def set_slider(panel, label, v):
        b.eval(f"(() => {{ const s = [...document.querySelectorAll('{panel} .slider')].find((e) => e.querySelector('label').textContent.startsWith({json.dumps(label)})); const i = s.querySelector('input[type=number]'); i.value = {v}; i.dispatchEvent(new Event('change')); }})()")
    set_slider('#settle-panel', 'T₂', 20); b.eval('__app.step(1 / 60, 1)')
    restarted = b.eval('__app.eng.t') < 1e-4
    b.eval('__app.runTo(0.3)')
    f20 = b.eval('__app.clockFits()')
    check(restarted and near(f20['T2']['tau'], 0.02, 1e-7) and near(f20['T2s']['tau'], 1 / (50 + 900), 4e-6) and near(f20['T1']['tau'], 0.1, 1e-6),
          f"7: T2 slid to 20 ms starts it again: T2 = {f20['T2']['tau'] * 1e3:.3f} ms, T2* = {f20['T2s']['tau'] * 1e3:.4f} ms (1/(1/T2 + πΔf) = {1e3 / 950:.4f}), T1 = {f20['T1']['tau'] * 1e3:.2f} ms")
    set_slider('#settle-panel', 'T₂', 300); b.eval('__app.step(1 / 60, 1)')
    s7b = b.eval('__app.state'); rng = b.eval('[__app.clocks.lo, __app.clocks.hi]')
    check(near(s7b['T2'], 0.3, 1e-12) and near(s7b['T1'], 0.15, 1e-12) and near(rng[1], 1.0, 1e-9),
          f"7: T2 pushed to 300 ms takes T1 to {s7b['T1'] * 1e3:.0f} ms (T2 ≤ 2T1 kept); the axis runs to {rng[1]:g} s")
    # One spin: no fan, so T2* = T2.
    run(b, 'threeclocks')
    b.eval("[...document.querySelectorAll('#spins-panel label.check input')][0].click(); __app.runTo(0.3)")
    f1 = b.eval('__app.clockFits()')
    check(not b.eval('__app.state.ensemble') and b.eval('__app.clocks.on') and near(f1['T2s']['tau'], 0.01, 1e-8) and near(f1['T2']['tau'], 0.01, 1e-8),
          f"7: unticking Many spins leaves one spin: T2* = {f1['T2s']['tau'] * 1e3:.4f} ms = T2")
    # An echo by hand: π about y′ at 3 ms brings the sum back up to the spins' own mean at 6 ms, no further.
    run(b, 'threeclocks'); b.eval('__app.runTo(3e-3)')
    b.eval("[...document.querySelectorAll('.pulse-buttons button')][3].click()")
    tp = b.eval('__app.clocks.manual')
    b.eval('__app.runTo(0.012)')
    eh = b.eval('(() => { const T = __app.clocks.trace; let best = { sig: 0 }; T.t.forEach((t, k) => { if (t > 4.5e-3 && t < 7.5e-3 && T.sig[k] > best.sig) best = { t, sig: T.sig[k], perp: T.perp[k] }; }); return best; })()')
    fm = b.eval('__app.clockFits()')
    check(b.eval('__app.clocks.on') and near(tp, 3e-3, 1e-4) and near(eh['t'], 2 * tp, 1.5e-4) and eh['sig'] > 0.95 * eh['perp'] and eh['sig'] <= eh['perp'] + 1e-12
          and fm['T2s'] is not None and fm['T2'] is None and 'the fits stop at your pulse' in text_of(b, '#readout'),
          f"7: π about y′ at {tp * 1e3:.2f} ms: the sum comes back to {eh['sig']:.3f} at {eh['t'] * 1e3:.2f} ms, the spins' own mean there {eh['perp']:.3f}; the fits stop at the pulse")
    # Dragging the tip, or another set-up, leaves the clocks.
    run(b, 'threeclocks'); b.eval('__app.runTo(2e-3)')
    tip = b.eval('__app.tip()'); box = b.box('#sphere')
    b.drag('#sphere', (tip[0] / box[2], tip[1] / box[3]), ((tip[0] + 20) / box[2], (tip[1] - 40) / box[3]), steps=6)
    left = [b.eval('__app.clocks.on'), b.eval('!!__app.run'), b.eval("document.querySelector('#clocks-wrap').getBoundingClientRect().height")]
    run(b, 'threeclocks'); b.eval('__app.runTo(1e-3)'); run(b, 'spread')
    check(left == [False, False, 0] and not b.eval('__app.clocks.on') and b.eval("document.querySelector('#signal-wrap').getBoundingClientRect().height") > 0,
          f'7: dragging the arrow\'s tip leaves the clocks for a free run ({left}); so does another set-up')

    # ---- 8, 9. echo trains: CPMG, and Carr–Purcell with pulses 10% long
    run(b, 'cpmg')
    b.eval('__app.runTo(0.0659)')
    f7 = b.eval('__app.trainEchoes()')
    check(len(f7['t']) == 16 and near(f7['fit']['T2'], 0.0202, 0.0003) and quotes(b, 'cpmg', '20.2 ms', '64 ms', 'sixteen'),
          f"8: 16 echoes out to 64 ms; the fit gives T2 = {f7['fit']['T2'] * 1e3:.2f} ms (the help: 20.2)")
    b.screenshot('build/nmr-cpmg.png')
    run(b, 'mg')
    b.eval('__app.runTo(0.0659)')
    cp = b.eval('__app.trainEchoes().fit.T2')
    ys = b.eval('[4e-3, 8e-3].map((t) => __app.eng.record.at(t)[1])')
    b.eval("__app.setPreset('cpmg'); __app.seq.error = 0.1; __app.runSeq(); __app.runTo(0.0659)")
    mg = b.eval('__app.trainEchoes().fit.T2')
    check(near(cp, 0.0106, 0.0002) and near(mg, 0.0203, 0.0003) and ys[0] * ys[1] < 0 and quotes(b, 'mg', '10.6 ms', '20.3 ms', '198°'),
          f'9: π pulses 10% long: Carr–Purcell T2 = {cp * 1e3:.2f} ms, its echoes alternating ({ys[0]:+.2f}, {ys[1]:+.2f}); CPMG {mg * 1e3:.2f} ms')

    # ---- the timeline: choose a pulse, drag it
    run(b, 'cpmg')
    b.eval("__app.setPreset('echo')")
    tl = b.box('#timeline'); f = b.eval('(() => { __app.step(0, 1); return null; })()')
    px = b.eval('(() => { const q = __app.seq.pulses[1]; const r = document.querySelector("#timeline").getBoundingClientRect(); return [48 + (q.t - (__app.run ? __app.run.t0 : 0)) / (__app.seq.span - (__app.run ? __app.run.t0 : 0)) * (r.width - 60), r.height - 40]; })()')
    t_before = b.eval('__app.seq.pulses[1].t')
    b.drag('#timeline', (px[0] / tl[2], px[1] / tl[3]), ((px[0] + 60) / tl[2], px[1] / tl[3]), steps=6)
    b.eval('__app.step(0, 1)')
    t_after = b.eval('__app.seq.pulses[1].t')
    sel = b.eval("[__app.seq.sel, !document.querySelector('#seq-panel .stack').hidden, __app.seq.edited, __app.run.pulses[1].t]")
    check(t_after > t_before * 1.1 and sel[0] == 1 and sel[1] and sel[2] and near(sel[3], t_after, 1e-12),
          f'dragging the π pulse along the timeline moves it ({t_before * 1e3:.2f} -> {t_after * 1e3:.2f} ms), chooses it, and the run uses it')

    # ---- 10. inversion recovery
    run(b, 'ir')
    f9 = b.eval('__app.finishScan().fit')
    check(near(f9['tau'], 0.025, 0.0001) and near(f9['null'], 0.0173, 0.0001) and quotes(b, 'ir', '25.0 ms', '17.3 ms', 'fifteen'),
          f"10: T1 = {f9['tau'] * 1e3:.2f} ms from the scan, the null at {f9['null'] * 1e3:.2f} ms = T1 ln 2")
    b.screenshot('build/nmr-ir.png')
    # Clicking the plot at the null runs the sequence there: the π/2 then finds nothing to tip.
    cb = b.box('#curve'); fx = (48 + f9['null'] / (0.04 * 0.025 * 100 * 1.05) * (cb[2] - 60)) / cb[2]
    b.click('#curve', (fx, 0.5)); b.eval('__app.step(0, 1)')
    tau_c = b.eval('__app.seq.tau')
    b.eval('__app.runTo(__app.seq.span)')
    fidc = b.eval('Math.abs(__app.eng.record.meanY(__app.seq.acq[0], __app.seq.acq[0] + 3e-5))')
    check(abs(tau_c / f9['null'] - 1) < 0.05 and fidc < 0.05 and b.eval('__app.seq.scan') is not None,
          f"clicking the plot at the null runs the sequence at τ = {tau_c * 1e3:.2f} ms: the FID's start is {fidc:.3f} (the scan's points stay)")
    run(b, 'echo'); b.eval("__app.setView('seq'); __app.setups.cpmg(); __app.setPreset('echo'); __app.startScan()")
    f6 = b.eval('__app.finishScan().fit')
    check(near(f6['tau'], 0.02, 0.0005), f"the echo scanned over τ gives T2 = {f6['tau'] * 1e3:.2f} ms (oil's 20 ms)")

    # ---- 11. noise and averaging
    rows = []
    for av in (1, 16, 256):
        b.eval(f'__app.setups.noise(); __app.state.averages = {av}; __app.eng.configure({{averages: {av}}}); __app.runSeq(); __app.runTo(__app.seq.span)')
        rms = b.eval('(() => { const R = __app.eng.record; let s = 0, n = 0; for (let i = 0; i < R.length; i++) { s += R.nx[i] ** 2 + R.ny[i] ** 2; n += 2; } return __app.sigma() * Math.sqrt(s / n); })()')
        rows.append((av, rms, b.eval('__app.fidFit().tau')))
    check(near(rows[0][1], 0.2, 0.01) and near(rows[1][1], 0.05, 0.003) and near(rows[2][1], 0.0125, 0.001)
          and near(rows[0][2], 0.545e-3, 0.5e-6) and near(rows[1][2], 0.606e-3, 0.5e-6) and near(rows[2][2], 0.618e-3, 0.5e-6)
          and quotes(b, 'noise', '0.20', '0.050', '0.012', '0.25', '0.545 ms', '0.606', '0.618'),
          '11: the noise, r.m.s. ' + ', '.join(f'{r_[1]:.4f} after {r_[0]}' for r_ in rows) + '; T2* fitted ' + ', '.join(f'{r_[2] * 1e3:.3f}' for r_ in rows) + ' ms (0.617)')
    b.screenshot('build/nmr-noise.png')

    # ---- 12-16. the Earth's-field board
    run(b, 'board')
    check(b.eval('__app.state.view') == 'earth' and b.eval('__app.state.inst') == 'earth' and visible_hints(b)[0].startswith('Press Polarize and listen'), "12: the board's view, with its own hint")
    notes = []
    for t in (1.0, 3.0002, 3.01, 3.5):
        b.eval(f'(() => {{ for (let i = 0; i < 2e4 && __app.eng.t < {t}; i++) __app.step(1 / 60); }})()')
        notes.append(text_of(b, '#sphere-note').split('.')[0].split(':')[0])
    check(notes == ['Polarizing', 'Switching off', 'The receiver is off for 19 ms while the relay hands the coil over; M goes round the Earth\'s field', 'Listening'],
          f'the note on the sphere says what the cycle is doing: {[n[:24] for n in notes]}')
    run(b, 'board')
    sp = [b.eval('__app.boardSpeed()')]
    b.eval('(() => { for (let i = 0; i < 1e4 && __app.eng.t < 3.0001; i++) __app.step(1 / 60); })()'); sp.append(b.eval('__app.boardSpeed()'))
    # (Through the switch-off the clock slows as the field turns, so that its swing takes 2 s.)
    t_end = b.eval('(() => { let n = 0; for (; n < 1e5 && __app.eng.t < 3.0004; n++) __app.step(1 / 60); return n / 60; })()')
    check(sp[0] == 1 and sp[1] < 0.4e-3 / 0.6 + 1e-12 and 2.0 < t_end < 3.2, f'Auto: real time while it polarizes; the 0.4 ms switch-off takes {t_end:.2f} s on screen, slowing as the field turns')
    b.screenshot('build/nmr-board-ramp.png')
    b.eval('__app.runBoard()')
    # On the board the cycle sets the spins: a drag from the arrow's tip turns the sphere instead.
    b.eval('(() => { for (let i = 0; i < 2e4 && __app.eng.t < 1.0; i++) __app.step(1 / 60); })()')
    m0, az0 = b.eval('__app.sum("lab")'), b.eval('__app.view.az')
    tip = b.eval('__app.tip()'); box = b.box('#sphere')
    b.drag('#sphere', (tip[0] / box[2], tip[1] / box[3]), ((tip[0] + 40) / box[2], (tip[1] + 40) / box[3]), steps=6)
    m1 = b.eval('__app.sum("lab")')
    check(max(abs(a - c) for a, c in zip(m0, m1)) < 1e-9 and abs(b.eval('__app.view.az') - az0) > 0.1, "on the board a drag from the arrow's tip turns the sphere and leaves M alone")
    b.eval('__app.hold(false)'); playing0 = b.eval('__app.state.playing')
    b.key(' ', 'Space'); playing1 = b.eval('__app.state.playing')
    b.key(' ', 'Space'); playing2 = b.eval('__app.state.playing')
    b.eval('__app.hold(true)')
    check(playing0 and not playing1 and playing2 and text_of(b, '#earth-panel').count('Pause') == 1, 'the space bar pauses and plays, and the board has its own Pause button')
    b.eval('__app.runBoard()')
    ar = b.eval('__app.board.afterRamp'); fs = b.eval('__app.fidStart() * 1.199e-6 * 1e6 * 46.03 / 46.028')
    t11 = b.eval('__app.tank'); out11 = b.eval('__app.fidStart() * __app.outPerM()'); tank11 = b.eval('__app.fidStart() * __app.Vfull() * __app.tank.gain * 1e6')
    check(near(ar['across'], 0.989, 0.001) and near(ar['size'], 0.699, 0.001) and near(fs, 0.78, 0.005) and quotes(b, 'board', '0.699', '98.9%', '0.78 μV', '0.86 s', '7.84 mT', '170'),
          f"12: M = {ar['size']:.3f} after 3 s, {ar['across'] * 100:.1f}% of it across BE after the 0.4 ms switch-off; the FID starts at {fs:.3f} μV")
    check(t11['code'] == 75 and near(t11['gain'], 36.6, 0.05) and near(tank11, 28.6, 0.1) and near(out11, 0.56, 0.006) and near(out11 / t11['outNoise'], 45, 0.6)
          and quotes(b, 'board', '36.6', '28.6 μV', '0.56 V', '45 times'),
          f"12: the tank (switches {t11['switches']}) gives ×{t11['gain']:.2f}: {tank11:.2f} μV on it, {out11:.3f} V at OUT, {out11 / t11['outNoise']:.1f} times the receiver's {t11['outNoise'] * 1e3:.2f} mV of noise")
    b.screenshot('build/nmr-board.png')
    b.eval('__app.hearIt()')
    heard = b.eval('__app.board.heard')
    check(heard and abs(heard['n'] / heard['rate'] - 1.981) < 0.01 and 0.05 < heard['peak'] < 1 and 0.5 < heard['outPeak'] < 0.7,
          f"Hear it: {heard['n'] / heard['rate']:.2f} s of OUT at {heard['rate']} Hz, {heard['outPeak']:.3f} V at its peak (peak {heard['peak']:.2f} of full scale)")
    rows = []
    for ramp in (0.4e-3, 13.8e-3, 0.3):
        b.eval(f'__app.setups.adiabatic(); __app.board.ramp = {ramp}; __app.startBoard(); __app.runBoard()')
        rows.append((ramp, b.eval('__app.board.afterRamp.across'), b.eval('__app.fidStart(__app.eng.record, 0) * 1.199e-6 * 1e6'), b.eval('__app.fidStart(__app.eng.record, 0) * __app.outPerM()'), b.eval('__app.tank.outNoise')))
    A = b.eval('(() => { const g = 2 * Math.PI * 42.577e6; return g * 46.03e-6 ** 2 * 0.3 / (5.2249e-3 * 1.5); })()')
    check(near(rows[0][1], 0.989, 0.001) and near(rows[1][1], 0.689, 0.005) and near(rows[2][1], 0.045, 0.001) and near(rows[2][2], 0.034, 0.0005) and near(rows[2][3], 0.025, 0.001)
          and near(rows[2][3] / rows[2][4], 2, 0.1) and near(A, 21.7, 0.1)
          and quotes(b, 'adiabatic', '4.5%', '0.034 μV', '25 mV', 'twice', '0.029', '13.8 ms', '69%', '22', '4.9'),
          '13: left across after ' + ', '.join(f'{r_[0] * 1e3:g} ms: {r_[1] * 100:.1f}% (FID {r_[2]:.4f} μV)' for r_ in rows) + f'; at 300 ms {rows[2][3] * 1e3:.1f} mV at OUT, {rows[2][3] / rows[2][4]:.2f} times the noise; A = {A:.1f}')
    run(b, 'adiabatic'); b.eval('__app.runBoard()')
    b.screenshot('build/nmr-adiabatic.png')

    # ---- 14. the coil's angle: sin² α
    out_ = lambda: b.eval('__app.fidStart() * __app.outPerM()')
    orient = lambda i: b.eval(f"[...document.querySelectorAll('#earth-panel .orient button')][{i}].click(); __app.runBoard()")
    run(b, 'angle'); b.eval('__app.runBoard()')
    a13, acr13, ang13 = out_(), b.eval('__app.board.afterRamp.across'), b.eval('__app.board.angle')
    orient(2); up13, ang_up = out_(), b.eval('__app.board.angle')
    orient(0); e13, ang_e = out_(), b.eval('__app.board.angle')
    b.eval('__app.setAngle(84.2); __app.runBoard()'); g13 = out_()
    s2 = math.sin(58.89 * math.pi / 180) ** 2
    check(near(ang13, 58.89, 1e-9) and near(a13, 0.384, 0.003) and near(acr13, 0.785, 0.002) and near(math.sin(58.89 * math.pi / 180), 0.856, 0.0005)
          and near(ang_up, 31.11, 0.01) and near(up13, 0.133, 0.003) and near(ang_e, 90, 0) and near(e13, 0.56, 0.006) and near(a13 / e13, 0.68, 0.01) and a13 / e13 < s2
          and 0.965 < g13 / e13 < 0.982 and near(s2, 0.733, 0.0005) and near(math.sin(84.2 * math.pi / 180) ** 2, 0.99, 0.001)
          and quotes(b, 'angle', '58.9°', '0.733', '0.384 V', '0.56 V', '0.68', '78.5%', '85.6%', '0.133 V', '84.2°', '2 to 3%', '1% by'),
          f'14: the FID at OUT with the coil north–south (58.89°) {a13:.3f} V, upright {up13:.3f} V, east–west {e13:.3f} V: {a13 / e13:.3f} and {up13 / e13:.3f} of it (sin² {s2:.3f}, {math.cos(58.89 * math.pi / 180) ** 2:.3f}); {acr13 * 100:.1f}% left across; at 84.2° {g13 / e13:.3f}')
    # Dragging the coil's end along the field: nothing to ring.
    end, top = b.eval('__app.view.coilEnds([1, 0, 0])[0]'), b.eval('__app.view.P([0, 0, 1.3])')
    box = b.box('#sphere')
    b.drag('#sphere', (end[0] / box[2], end[1] / box[3]), (top[0] / box[2], top[1] / box[3]), steps=10)
    ang_d = b.eval('__app.board.angle'); b.eval('__app.runBoard()'); d13 = out_(); n13 = b.eval('__app.tank.outNoise')
    check(ang_d < 8 and d13 < 2 * n13, f"dragging the coil's end up to B_E turns it to {ang_d:.1f}°: the FID at OUT {d13 * 1e3:.1f} mV, the receiver's noise {n13 * 1e3:.1f} mV")
    b.screenshot('build/nmr-angle.png')

    # ---- 15. tuning the tank: the handbook's recipe, the switches, the drag
    run(b, 'tune'); b.eval('__app.runBoard()')
    t14, out14 = b.eval('__app.tank'), out_()
    rc = t14['recipe']
    check(t14['code'] == 0 and near(t14['fT'], 49243, 1) and near(t14['gain'], 1.00, 0.005) and near(out14, 0.017, 0.0007) and near(out14 / t14['outNoise'], 1.3, 0.06)
          and near(rc['f'], 1959.8, 0.05) and near(rc['C'] * 1e9, 246.2, 0.05) and rc['switches'] == [1, 2, 4, 7] and near(rc['Cset'] * 1e9, 247.29, 0.005) and near(rc['fT'], 1955.6, 0.05)
          and near(rc['f'] - rc['fT'], 4.3, 0.05) and near(t14['width'], 52.6, 0.05)
          and quotes(b, 'tune', '52.6 Hz', '0.39 nF', '49 kHz', '×1.00', '17 mV', '1.3 times', '1959.8 Hz', '26.8 mH', '246.2 nF', '1 2 4 7', '247.29 nF', '1955.6 Hz', '4.3 Hz'),
          f"15: all off, the tank at {t14['fT']:.0f} Hz: ×{t14['gain']:.3f}, {out14 * 1e3:.1f} mV at OUT ({out14 / t14['outNoise']:.2f} × the noise); the recipe: {rc['f']:.2f} Hz, {rc['C'] * 1e9:.2f} nF, switches {rc['switches']} = {rc['Cset'] * 1e9:.2f} nF, {rc['fT']:.2f} Hz")
    for i in (0, 1, 3, 6): b.eval(f"document.querySelectorAll('#tank-panel .dip button')[{i}].click()")
    b.eval('__app.step(0, 1)')
    t14b, out14b = b.eval('__app.tank'), out_()
    pressed = b.eval("[...document.querySelectorAll('#tank-panel .dip button')].map((e) => e.getAttribute('aria-pressed') === 'true')")
    steps = b.eval('[74, 76].map((c) => { __app.setCode(c); const t = __app.tank; return [t.gain, t.fT, t.switches]; })')
    check(t14b['code'] == 75 and pressed == [True, True, False, True, False, False, True, False] and near(t14b['gain'], 36.6, 0.05) and near(out14b, 0.56, 0.006)
          and near(steps[0][0], 35.6, 0.05) and steps[0][2] == [2, 4, 7] and near(steps[1][0], 30.9, 0.05) and steps[1][2] == [3, 4, 7]
          and 12 < abs(steps[0][1] - t14b['fT']) < 14 and 12 < abs(steps[1][1] - t14b['fT']) < 14
          and quotes(b, 'tune', '×36.6', '0.56 V', '×35.6', '2 4 7', '×30.9', '3 4 7', '13 Hz'),
          f"15: switches 1 2 4 7 clicked: ×{t14b['gain']:.2f}, {out14b:.3f} V at OUT; a step either side ×{steps[0][0]:.2f}, ×{steps[1][0]:.2f}, the tank moving {steps[0][1] - t14b['fT']:+.1f} and {steps[1][1] - t14b['fT']:+.1f} Hz")
    b.eval('__app.setCode(0)'); b.eval("document.querySelector('#tank-panel button.primary').click()")
    tuned = b.eval('__app.tank.code')
    b.eval('__app.step(0, 1)')
    tf = b.eval('__app.tankFrame'); tb = b.box('#tank')
    X = lambda f: (tf['left'] + (f - tf['f0']) / (tf['f1'] - tf['f0']) * (tf['right'] - tf['left'])) / tb[2]
    yy = (tf['top'] + 0.5 * (tf['bottom'] - tf['top'])) / tb[3]
    b.drag('#tank', (X(1955.6), yy), (X(2000), yy), steps=8)
    fT_d = b.eval('__app.tank.fT')
    check(tuned == 75 and abs(fT_d - 2000) < 8 and visible_hints(b)[1].startswith("Drag the tank's peak"),
          f"Tune to the protons sets switches 1 2 4 7 (code {tuned}); dragging the tank's peak to 2000 Hz retunes it to {fT_d:.1f} Hz; the plot's hint says so")
    b.screenshot('build/nmr-tune.png')

    # ---- 16. another place: the protons off the tank, and retuned
    run(b, 'elsewhere'); b.eval('__app.runBoard()')
    t15, out15, uv15 = b.eval('__app.tank'), out_(), b.eval('__app.fidStart() * __app.Vfull() * 1e6')
    rc = t15['recipe']
    b.eval("document.querySelector('#tank-panel button.primary').click(); __app.step(0, 1)")
    t15b, out15b = b.eval('__app.tank'), out_()
    check(near(t15['fL'], 2128.85, 0.01) and near(t15['fL'] - t15['fT'], 173, 0.5) and (t15['fL'] - t15['fT']) / t15['width'] > 3 and near(t15['gain'], 5.34, 0.005) and near(out15, 0.090, 0.0015) and near(uv15, 0.86, 0.005)
          and near(rc['C'] * 1e9, 208.7, 0.05) and rc['switches'] == [2, 3, 4, 5, 6] and near(rc['Cset'] * 1e9, 207.89, 0.005) and near(rc['fT'], 2132.8, 0.05)
          and t15b['code'] == rc['code'] and near(t15b['gain'], 40.2, 0.05) and near(out15b, 0.67, 0.006) and near(t15['width'] / 42.577e-3, 1240, 5)
          and quotes(b, 'elsewhere', '50.0 μT', '2129 Hz', '173 Hz', '×5.34', '×36.6', '0.090 V', '0.56', '0.86 μV', '208.7 nF', '2 3 4 5 6', '207.89 nF', '2132.8 Hz', '×40.2', '0.67 V', '52.6 Hz', '1240 nT'),
          f"16: at 50 μT the protons at {t15['fL']:.2f} Hz, {t15['fL'] - t15['fT']:.1f} Hz above the tank: ×{t15['gain']:.3f}, {out15:.4f} V at OUT ({uv15:.3f} μV in the coil); retuned to {t15b['fT']:.1f} Hz: ×{t15b['gain']:.2f}, {out15b:.3f} V")
    b.screenshot('build/nmr-elsewhere.png')

    # ---- 17. the noise band
    run(b, 'tanknoise'); b.eval('__app.runBoard()')
    t16, out16 = b.eval('__app.tank'), out_()
    kT4R = math.sqrt(4 * 1.380649e-23 * 293 * 8.855191079966954)
    b.eval("document.querySelector('#tank-panel button.primary').click(); __app.step(0, 1)")
    t16b, out16b = b.eval('__app.tank'), out_()
    d = t16b['density']; nf = 20 * math.log10(d['total'] / math.hypot(d['coil'], d['bias']))
    b.eval('__app.setCode(0); __app.step(0, 1)')
    sp16 = b.eval('__app.board.spec'); B16 = b.eval('(__app.eng.f0 + __app.board.spec.peak.f) / 42.577e6 * 1e9')
    b.eval('__app.hearIt()'); heard0 = b.eval('__app.board.heard'); n0 = b.eval('__app.tank.outNoise')
    check(t16['code'] == 79 and t16['switches'] == [1, 2, 3, 4, 7] and near(t16['fL'] - t16['fT'], 55, 0.5) and near(kT4R * 1e9, 0.38, 0.005) and near(t16['Q'] * kT4R * 1e9, 14, 0.5)
          and near(t16['coilNoise'] * 1e6, 0.125, 0.0005) and near(t16['C'] * 1e9, 260.6, 0.05) and near(t16['density']['amp'] * 1e9, 9.8, 0.05) and near(t16['outNoise'] * 1e3, 12.6, 0.05)
          and near(t16['gain'], 15.4, 0.05) and near(out16, 0.24, 0.005) and near(out16 / t16['outNoise'], 19, 0.5)
          and near(t16b['gain'], 36.6, 0.05) and near(out16b / t16b['outNoise'], 45, 0.6) and abs(t16b['outNoise'] - t16['outNoise']) < 1e-4 and near(nf, 1.7, 0.08)
          and near(B16, 46030.0, 0.5) and near(sp16['fwhm'], 0.5, 0.05) and near(heard0['tailRms'], n0, 0.1 * n0) and heard0['outPeak'] < 0.1
          and quotes(b, 'tanknoise', '55 Hz', '1 2 3 4 7', '0.38 nV/√Hz', '14', '0.125 μV', '260.6 nF', '9.8 nV/√Hz', '12.6 mV', '×15.4', '0.24 V', '19 times', '×36.6', '45 times', '1.7 dB', '0.5 Hz'),
          f"17: 55 Hz off the tank ×{t16['gain']:.2f}, {out16:.3f} V at OUT, {out16 / t16['outNoise']:.1f} × the noise ({t16['outNoise'] * 1e3:.2f} mV); √(kT/C) = {t16['coilNoise'] * 1e6:.4f} μV; tuned ×{t16b['gain']:.2f}, {out16b / t16b['outNoise']:.1f} ×, the receiver adds {nf:.2f} dB; all off, the spectrum's peak still gives {B16:.1f} nT, {sp16['fwhm']:.2f} Hz wide; OUT's last 0.2 s {heard0['tailRms'] * 1e3:.2f} mV r.m.s. (the noise {n0 * 1e3:.2f})")
    b.screenshot('build/nmr-tanknoise.png')

    run(b, 't1board')
    f13 = b.eval('__app.finishBoardScan()')
    check(near(f13['T1'], 2.49, 0.005) and quotes(b, 't1board', '2.49 s', '0.3 s'), f"18: T1 = {f13['T1']:.3f} s from twelve polarizing times (tap water's 2.5)")
    run(b, 'field'); b.eval('__app.runBoard()')
    B14 = b.eval('(__app.eng.f0 + __app.board.spec.peak.f) / 42.577e6 * 1e9'); w14 = b.eval('__app.board.spec.fwhm'); fp = b.eval('__app.eng.f0 + __app.board.spec.peak.f')
    b.eval('__app.board.BE = 50e-6; __app.startBoard(); __app.runBoard()')
    B50, g50 = b.eval('(__app.eng.f0 + __app.board.spec.peak.f) / 42.577e6 * 1e9'), b.eval('__app.tank.gain')
    check(near(B14, 46030.0, 0.05) and near(w14, 0.37, 0.01) and near(fp, 1959.82, 0.005) and near(B50, 49999.8, 0.05) and near(g50, 5.3, 0.05)
          and quotes(b, 'field', '0.37 Hz', '1959.82 Hz', '46 030.0 nT', '49 999.8 nT', '×5.3', '0.043 Hz'),
          f'19: the peak at {fp:.3f} Hz gives B = {B14:.2f} nT (set 46 030); the line {w14:.3f} Hz wide; at 50 μT, {B50:.2f} nT (the tank ×{g50:.2f})')
    b.screenshot('build/nmr-field.png')
    run(b, 'steel'); b.eval('__app.runBoard()')
    w15 = b.eval('__app.board.spec.fwhm'); df = b.eval('__app.state.spreadHz')
    check(near(df, 4.26, 0.005) and near(w15, 4.4, 0.05) and near(1 / (1 / 2 + math.pi * df), 0.072, 0.0005) and quotes(b, 'steel', '4.26 Hz', '75 ms', '72 ms', '4.4 Hz'),
          f'20: 100 nT across the bottle spreads the line over {df:.2f} Hz; T2* = {1 / (1 / 2 + math.pi * df) * 1e3:.1f} ms; the line {w15:.2f} Hz wide')

    # ---- every experiment's read-out is numbers; the read-outs keep still
    bad = []
    for name in names:
        run(b, name); b.eval('__app.step(1 / 60, 90)')
        t = text_of(b, '#readout')
        if any(x in t for x in ('NaN', 'undefined', 'Infinity')): bad.append(f'{name}: {t[:100]}')
        b.screenshot(f'build/nmr-exp-{name}.png')
    check(not bad, 'every experiment\'s read-out is made of numbers' + ('' if not bad else ': ' + ' | '.join(bad)))
    RO = '#readout > div, #readout .fixnum'
    for name, n in (('larmor', 10), ('spread', 10), ('threeclocks', 10), ('cpmg', 10), ('board', 10)):
        run(b, name)
        worst, compared, seen = keeps_still(b, RO, [lambda: b.eval('__app.step(0.3, 1)')] * n)
        check(worst <= 0.5 and compared >= n - 4 and len(seen) >= n // 2, f'{name}: the read-out keeps still while its numbers change (largest shift {worst:.1f} px over {compared} of {n}, {len(seen)} readings)')
    run(b, 'larmor')
    worst, compared, seen = keeps_still(b, '#amps .fixnum, #p-up, #p-down', [lambda: b.eval('__app.step(0.1, 1)')] * 8)
    check(worst <= 0.5 and compared >= 4, f'the spin-½ amplitudes keep still as they change (largest shift {worst:.1f} px)')

    # ---- an animation frame (the clock moved on, everything drawn) is cheap in every view
    ms = b.eval("""(() => { const out = {}; for (const n of ['larmor', 'spread', 'threeclocks', 'cpmg', 'ir', 'board']) { __app.setups[n](); __app.step(1 / 60, 60); if (n === 'threeclocks') __app.runTo(0.05);
      let best = 1e9; for (let r = 0; r < 3; r++) { const t0 = performance.now(); for (let k = 0; k < 10; k++) __app.step(1 / 60, 1); best = Math.min(best, (performance.now() - t0) / 10); }
      out[n] = best; } return out; })()""")
    check(max(ms.values()) < 20, 'a frame takes ' + ', '.join(f'{v:.1f} ms ({k})' for k, v in ms.items()) + ' (needs < 16 for 60 fps; 20 allowed on a loaded machine)')

    # ---- the address
    run(b, 'echo')
    b.eval("__app.state.arrows = 64; document.querySelector('#noise-panel input[type=checkbox]').click()")
    b.wait("location.hash.includes('v=many') && location.hash.includes('nz=')", timeout=20)
    h = b.eval('location.hash')
    reload(b); b.eval('__app.hold(true)')
    s = b.eval('__app.state')
    check(s['view'] == 'many' and s['ensemble'] and s['noiseOn'] and s['frame'] == 'rot' and s['T2on'], f'reloading the address keeps the view, the ensemble, the noise and the frame ({h[:60]}...)')
    b.eval("location.hash = '#setup=ir'"); b.wait("__app.state.view === 'seq' && __app.seq.preset === 'ir'", timeout=20)
    check(b.eval('__app.seq.preset') == 'ir', 'typing #setup=ir into the address opens that experiment')
    b.eval("__app.setups.threeclocks()"); b.wait("location.hash.includes('ck=1')", timeout=20)
    reload(b); b.eval('__app.hold(true)')
    s = b.eval('__app.state')
    check(b.eval('__app.clocks.on') and s['view'] == 'many' and near(s['T2'], 0.01, 1e-9) and near(s['T1'], 0.1, 1e-9) and near(s['spreadHz'], 286.48, 0.05) and b.eval('__app.run && __app.run.clocks'),
          f"reloading the three clocks' address runs them again, with their times and spread ({s['spreadHz']} Hz: the address keeps four figures)")
    b.eval("__app.setups.adiabatic()"); b.wait("location.hash.includes('ramp=0.3')", timeout=20)
    reload(b)
    check(b.eval('__app.state.view') == 'earth' and near(b.eval('__app.board.ramp'), 0.3, 1e-9), 'and the board\'s switch-off time is kept in the address')

    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

# Dark, and a phone.
with Browser('nmr/index.html', size=(1400, 900)) as b:
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
    b.wait('window.__app && __app.ready', timeout=90); b.eval('__app.hold(true)')
    for name in ('larmor', 'echo', 'threeclocks', 'ir', 'board'):
        run(b, name); b.eval('__app.step(1 / 60, 200)'); b.screenshot(f'build/nmr-dark-{name}.png')
    check(b.eval("getComputedStyle(document.body).backgroundColor") != 'rgb(244, 243, 239)', 'dark: the page follows the dark colour scheme')
    run(b, 'larmor')
    lum = lambda css: sum(int(v) for v in re.findall(r'\d+', css)[:3]) / 3
    hi, bg = b.eval("[getComputedStyle(document.getElementById('sphere-hint')).color, getComputedStyle(document.body).backgroundColor]")
    si, sbg = b.eval("(() => { const s = document.querySelector('#help .start'); const c = getComputedStyle(s); return [c.color, c.backgroundColor]; })()")
    check(lum(hi) - lum(bg) > 80 and lum(si) - lum(sbg) > 80, f'dark: the hint ({hi} on {bg}) and the Start-here block ({si} on {sbg}) read')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'dark: no exceptions')

with Browser('nmr/index.html', size=(390, 844)) as b:
    b.wait('window.__app && __app.ready', timeout=90); b.eval('__app.hold(true)')
    b.screenshot('build/nmr-phone-start.png')
    hint, sph = b.box('#sphere-hint'), b.box('#sphere-wrap')
    check(hint[1] >= sph[1] + sph[3] - 1 and hint[1] + hint[3] <= 844, f'on a phone the hint sits under the sphere, on the first screen (bottom at {hint[1] + hint[3]:.0f} px)')
    # The spin-½ box comes between the sphere and the plots on a phone: folded to one line there.
    sh_open, sh, ro, plot = b.eval("document.querySelector('#spin-half').open"), b.box('#spin-half'), b.box('#readout'), b.box('#raw-wrap')
    b.eval("document.querySelector('#spin-half > summary').click()")
    opened, sh2 = b.eval("document.querySelector('#spin-half').open"), b.box('#spin-half')
    check(not sh_open and sh[3] < 40 and ro[1] - (hint[1] + hint[3]) < 60 and plot[1] < 844 and opened and sh2[3] > 150 and '0.924' in text_of(b, '#spin-half'),
          f'on a phone the spin-½ box starts folded ({sh[3]:.0f} px tall), so the plots begin at {plot[1]:.0f} px, on the first screen; a tap opens it ({sh2[3]:.0f} px)')
    b.eval("document.querySelector('#spin-half > summary').click()")
    wide = []
    for name in ('larmor', 'spread', 'threeclocks', 'cpmg', 'ir', 'board', 'tune', 'field'):
        run(b, name); b.eval('__app.step(1 / 60, 60)')
        b.screenshot(f'build/nmr-phone-{name}.png')
        wide.append(b.eval('document.documentElement.scrollWidth'))
        hs = visible_hints(b)
        if not hs: wide.append(9999)
    check(max(wide) <= 390, f'no sideways scrolling on a phone, and a hint in every view (pages {max(wide)} px wide at most)')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'phone: no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
