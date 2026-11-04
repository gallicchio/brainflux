#!/usr/bin/env python3
"""Drive the dispersion demo: the opening view, the charge and the wave at the light's frequency,
every experiment, the handles, drawing for Kramers-Kronig and the sliver, pulses in space and at
the detector, the address, speed, and a phone-sized screen.  The page's clocks are held and
stepped from here (__app.hold, __app.step), so nothing depends on how fast the machine is."""
import json, math, os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

def run(b, name):
    b.eval(f'__app.setups[{json.dumps(name)}](); __app.step(0, 1)')

# The words of a read-out with its numbers taken out: it may move when these change, not when
# only the numbers do.
def phrase(text):
    return re.sub(r'[−+-]?\d[\d.]*(?:e[−+-]?\d+)?', '#', text)

def keeps_still(b, sel, steps):
    """Run steps (callables that change the numbers shown) and compare the boxes of the elements
    matching sel, after every step, with those first seen with the same words.  Returns (the
    largest shift in px, the steps compared, the distinct texts seen)."""
    texts = f"[...document.querySelectorAll({json.dumps(sel)})].map((e) => e.textContent).join(' | ')"
    t0 = b.eval(texts)
    first = {phrase(t0): b.rects(sel)}
    worst, compared, seen = 0.0, 0, {t0}
    for step in steps:
        step()
        r, t = b.rects(sel), b.eval(texts)
        seen.add(t)
        r0 = first.setdefault(phrase(t), r)
        if r0 is r or len(r) != len(r0):
            continue
        compared += 1
        worst = max([worst] + [abs(x - y) for a, c in zip(r0, r) for x, y in zip(a, c)])
    return worst, compared, seen

def set_slider(b, box, label, value):
    """Type a value into the number box of the slider labelled label (its first characters)."""
    b.eval(f"""(() => {{ const s = [...document.querySelectorAll('{box} .slider')].find((e) => e.querySelector('label').textContent.trim().startsWith({json.dumps(label)}));
      const i = s.querySelector('input[type=number]'); i.value = {value}; i.dispatchEvent(new Event('change')); __app.step(0, 1); }})()""")

def press(b, sel, fx, fy=0.5):
    """Press and release the mouse at a fraction of an element (a tap on a plot)."""
    x, y = b.point(sel, (fx, fy))
    b.mouse('mouseMoved', x, y); b.mouse('mousePressed', x, y, 1, 'left'); b.mouse('mouseReleased', x, y, 0, 'left')
    b.eval('__app.step(0, 1)')

def visible_hints(b):
    """The hint lines on or under the pictures that are shown, with their text."""
    return b.eval("[...document.querySelectorAll('.hint')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map((e) => e.textContent.trim())")

def first_screen(b, where):
    """What a cold reader needs on the first screen: a hint under the top plot saying what to
    drag, the two small pictures captioned in words, the read-out in words."""
    hints = visible_hints(b)
    check(len(hints) == 1 and hints[0].startswith('Drag the square handle') and 'line' in hints[0], f'{where}: one hint under the top plot says what to drag ({hints})')
    ro = b.eval("document.querySelector('#readout').innerText")
    check(ro.startswith('The light at') and 'n =' in ro and 'κ =' in ro, f'{where}: the read-out has words ({ro[:50]}...)')

with Browser('dispersion/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready', timeout=90)
    b.eval('__app.hold(true)')
    b.screenshot('build/dsp-start.png')
    s = b.eval('__app.state')
    check(s['view'] == 'medium' and s['sweep'] and s['medium'] == 'one', f"opens on the medium view, the light's frequency sweeping (ω = {s['probe']:.3f})")
    first_screen(b, 'opening')
    # Each view has its own hint where the eye is.
    b.eval("__app.setView('kk')"); hk = visible_hints(b)
    b.eval("__app.setView('pulse')"); hp = visible_hints(b)
    b.eval("__app.setView('medium')")
    check(len(hk) == 1 and hk[0].startswith('Draw on this plot') and len(hp) == 1 and 'carrier' in hp[0] and 'detector' in hp[0],
          f'the Kramers–Kronig view says to draw, the pulse view what to drag ({hk[0][:30]}... | {hp[0][:30]}...)')
    # Plain words on the side panel: every medium preset has a tooltip, so do the chips and buttons.
    titles = b.eval("[...document.querySelectorAll('#media button')].map((e) => e.title)")
    check(all(len(t) > 30 for t in titles) and any('metal' in t for t in titles) and any('AM radio' in t for t in titles), f'every medium preset has a tooltip in plain words ({len(titles)})')
    chips = b.eval("[...document.querySelectorAll('#osc-chips button')].map((e) => [e.textContent.trim(), e.title])")
    check(any(t == '+ free' and 'no spring' in title and 'metal' in title for t, title in chips) and any(t == '1' and 'spring' in title for t, title in chips)
          and 'no spring' in b.eval("document.getElementById('osc-note').textContent"),
          'the chips say what a line and free electrons are ("free: no spring, as in a metal")')
    labels = b.eval("[...document.querySelectorAll('#osc-sliders .slider label, #light-box .slider label')].map((e) => e.textContent.trim())")
    check(any(l.startswith('resonance') for l in labels) and any(l.startswith('width') for l in labels) and any(l.startswith('strength') for l in labels) and any(l.startswith('frequency') for l in labels),
          f'the sliders say what their symbols are {labels}')
    # The drawer: Start here first, in plain words without equations; the theory at the end.
    order = b.eval("[...document.querySelectorAll('#help > section, #help > article')].map((e) => e.className)")
    start = b.eval("document.querySelector('#help .start').innerText")
    check(order[0] == 'start' and order[-1] == 'theory' and 'math' not in b.eval("document.querySelector('#help .start').innerHTML")
          and 'Drag' in start and 'Kramers–Kronig' in start and len(start) < 1500, f'the drawer opens with Start here and ends with How it works ({len(order)} parts)')
    # The small pictures: captioned in words, with the charge's lag and swing in words.
    b.eval('__app.step(0, 1)')
    titles = b.eval("[...document.querySelectorAll('#pics canvas')].map((c) => c.getAttribute('aria-label'))")
    check(len(titles) == 2 and 'spring' in titles[0] and 'wave' in titles[1], 'the two small pictures say what they are')
    w0 = b.eval('__app.state.probe')
    for _ in range(20): b.eval('__app.step(0.25, 1)')
    w1 = b.eval('__app.state.probe')
    check(abs(w1 - w0) > 0.1, f"the sweep moves the light's frequency ({w0:.3f} -> {w1:.3f} in 5 s of the page's clock)")

    # ---- the charge on its spring, against the driven oscillator's resonance curve
    run(b, 'one')
    exact = lambda w: (4 / math.hypot(4 - w * w, 0.2 * w), math.degrees(math.atan2(0.2 * w, 4 - w * w)))
    rows = []
    for w in (0.5, 1.6, 2.0, 2.5):
        c = b.eval(f'__app.charge({w})'); A, d = exact(w); rows.append((w, c, A, d))
    check(all(abs(c['amp'] - A) < 1e-9 * A and abs(c['lag'] - d) < 1e-9 for w, c, A, d in rows),
          'the charge: ' + ', '.join(f"ω = {w}: A = {c['amp']:.3f}, δ = {c['lag']:.1f}°" for w, c, A, d in rows) + ' (ω0²/√((ω0² − ω²)² + γ²ω²) and atan2(γω, ω0² − ω²))')
    o = b.eval('[__app.optics(1.6), __app.optics(2.0), __app.optics(2.5)]')
    check(o[0]['n'] > 1 and o[2]['n'] < 1 and o[1]['k'] > 10 * o[0]['k'],
          f"in step below the line n = {o[0]['n']:.3f} > 1; against E above it n = {o[2]['n']:.3f} < 1; a quarter period late on it κ = {o[1]['k']:.2f}")
    km = b.eval('(() => { let best = [0, 0]; for (let w = 1.8; w < 2.3; w += 0.0005) { const k = __app.optics(w).k; if (k > best[1]) best = [w, k]; } return best; })()')
    check(abs(km[0] - 2.04) < 0.005 and abs(km[1] - 0.99) < 0.005, f"κ is largest just above the line, {km[1]:.3f} at ω = {km[0]:.3f}, where n has fallen (the help says 0.99 at 2.04)")
    # Dragging the light's handle takes over from the sweep.
    hs = b.eval('__app.handles()'); pr = next(h for h in hs if h['type'] == 'probe')
    box = b.box('#resp'); wa = b.eval('__app.state.probe')
    b.drag('#resp', (pr['x'] / box[2], pr['y'] / box[3]), ((pr['x'] + 80) / box[2], pr['y'] / box[3]), steps=6); b.eval('__app.step(0, 1)')
    s = b.eval('__app.state')
    check(not s['sweep'] and s['probe'] > wa + 0.1, f"dragging the light's handle moves it ({wa:.3f} -> {s['probe']:.3f}) and stops the sweep")
    press(b, '#resp', 0.25)
    wp = b.eval('__app.state.probe')
    press(b, '#refl', 0.75)
    wr = b.eval('__app.state.probe')
    check(0.7 < wp < 1.3 and 2.7 < wr < 3.3, f"a tap on either plot moves the light there (ω = {wp:.2f} at a quarter of the plot, {wr:.2f} at three quarters)")

    # ---- the wave meeting the medium
    run(b, 'wave')
    o = b.eval('__app.optics(1.6)')
    n, k = o['n'], o['k']
    R = ((n - 1) ** 2 + k ** 2) / ((n + 1) ** 2 + k ** 2)
    check(abs(o['R'] - R) < 1e-12 and abs(n - 1.290) < 5e-4 and abs(1 / (2 * math.pi * k) - 2.79) < 0.01,
          f"the wave at ω = 1.6: n = {n:.3f}, λ0/n = {1 / n:.3f} λ0, 1/e in c/κω = {1 / (2 * math.pi * k):.2f} λ0, R = {100 * o['R']:.2f}%")
    b.screenshot('build/dsp-wave.png')

    bad = []
    for name in b.eval('Object.keys(__app.setups)'):
        run(b, name)
        b.eval('(() => { const [a, c] = __app.run(); __app.anim.t = a + 0.55 * (c - a); __app.step(0, 1); })()')
        b.screenshot(f'build/dsp-exp-{name}.png')
        text = b.eval("document.querySelector('#readout').textContent")
        slots = b.eval("[...document.querySelectorAll('#readout .fixnum')].map((e) => e.textContent)")
        if 'NaN' in text or 'Infinity' in text or 'undefined' in text or any(t in ('–', '∞', '−∞') for t in slots): bad.append(f'{name}: {text[:120]}')
    check(not bad, 'every experiment\'s read-out is made of numbers' + ('' if not bad else ': ' + ' | '.join(bad)))

    # ---- the read-out keeps still: while the light sweeps, a tap moves it, or the detector moves,
    # every line, number and the words after them keep their places (as long as the words stay the
    # same); Play and Pause leave the button beside them where it was.
    RO = '#readout > div, #readout .fixnum'
    tap = lambda sel, fx: (lambda: press(b, sel, fx))
    depth = lambda v: (lambda: set_slider(b, '#pulse-box', 'detector z', v))
    for name, steps in (('one', [lambda: b.eval('__app.step(0.4, 1)')] * 12),
                        ('glass', [tap('#resp', f) for f in (0.08, 0.15, 0.4, 0.75, 0.97)]),
                        ('wave', [tap('#refl', f) for f in (0.12, 0.3, 0.47, 0.5, 0.53, 0.7, 0.93)]),
                        ('delay', [depth(v) for v in (20, 45, 80, 100, 135, 160, 200)]),
                        ('superluminal', [depth(v) for v in (2, 4.5, 7, 9, 12, 15)]),
                        ('precursors', [depth(v) for v in (3, 6, 8.5, 12, 14)])):
        run(b, name)
        worst, compared, seen = keeps_still(b, RO, steps)
        check(worst <= 0.5 and compared >= len(steps) - 4 and len(seen) >= len(steps) // 2,
              f'{name}: the read-out keeps still while its numbers change (largest shift {worst:.1f} px over {compared} of {len(steps)} changes, {len(seen)} different readings)')
    run(b, 'delay')
    fit0 = b.box('#fit'); b.click('#play'); fit1 = b.box('#fit'); b.click('#play'); fit2 = b.box('#fit')
    check(max(abs(a - c) for a, c in zip(fit0, fit1)) <= 0.5 and max(abs(a - c) for a, c in zip(fit0, fit2)) <= 0.5,
          f'Play and Pause leave the "Fit time axis" button in its place ({fit0[0]:.1f}, {fit1[0]:.1f}, {fit2[0]:.1f})')

    # ---- the handles: drag a line sideways (strength kept), up (stronger), its width (area kept)
    run(b, 'sumrule')
    hs = b.eval('__app.handles()')
    peak = next(h for h in hs if h['type'] == 'peak')
    box = b.box('#resp')
    def frac(x, y): return ((x) / box[2], (y) / box[3])
    o0 = b.eval('__app.state.oscs[0]')
    b.drag('#resp', frac(peak['x'], peak['y']), frac(peak['x'] + 60, peak['y']), steps=8); b.eval('__app.step(0, 1)')
    o1 = b.eval('__app.state.oscs[0]')
    check(o1['w0'] > o0['w0'] + 0.1 and abs(o1['wp'] - o0['wp']) < 1e-12, f"dragging the line sideways moves it ({o0['w0']:.3f} -> {o1['w0']:.3f}) and keeps its strength")
    hs = b.eval('__app.handles()'); peak = next(h for h in hs if h['type'] == 'peak')
    b.drag('#resp', frac(peak['x'], peak['y']), frac(peak['x'], peak['y'] - 60), steps=8); b.eval('__app.step(0, 1)')
    o2 = b.eval('__app.state.oscs[0]')
    check(o2['wp'] > o1['wp'] * 1.05, f"dragging it up makes it stronger (ω_p {o1['wp']:.3f} -> {o2['wp']:.3f})")
    sr0 = b.eval('__app.sumRule()')
    hs = b.eval('__app.handles()'); wr = next(h for h in hs if h['type'] == 'wr')
    b.drag('#resp', frac(wr['x'], wr['y']), frac(wr['x'] + 40, wr['y']), steps=8); b.eval('__app.step(0, 1)')
    o3 = b.eval('__app.state.oscs[0]'); sr1 = b.eval('__app.sumRule()')
    wp2 = o3['wp'] ** 2
    check(o3['g'] > o2['g'] * 1.5 and abs(sr1['integral'] / (math.pi / 2) - wp2) < 1e-4 * wp2 and abs(sr1['integral'] - sr0['integral']) < 1e-4 * sr0['integral'],
          f"widening the line (γ {o2['g']:.3f} -> {o3['g']:.3f}) keeps ∫ω ε'' dω = (π/2) ω_p²: {sr0['integral']:.5f} -> {sr1['integral']:.5f} (ω_p² = {wp2:.5f})")
    b.screenshot('build/dsp-dragged.png')

    # ---- metals and crystals reflect where ε' < 0
    run(b, 'reststrahlen')
    o = b.eval('__app.optics(6.2)')
    check(o['R'] > 0.9, f"rock salt reflects {o['R'] * 100:.0f}% at 6.2 THz, between ω_TO and ω_LO")
    set_slider(b, '#osc-sliders', 'width γ', 0.5)
    o = b.eval('__app.optics(6.2)')
    check(abs(o['R'] - 0.75) < 0.01, f"with γ = 0.5 THz it reflects {o['R'] * 100:.1f}% there")
    run(b, 'metal')
    lo, hi = b.eval('[__app.optics(3).R, __app.optics(8).R]')
    c = b.eval('__app.charge(3)')
    cg = b.eval('__app.charge(0.02)')
    check(lo > 0.98 and hi < 0.05 and c['free'] and c['lag'] > 179 and abs(cg['lag'] - 135) < 1e-6,
          f"sodium: R = {lo:.3f} at 3 eV (visible), {hi:.3f} at 8 eV (ultraviolet); the free electron lags E by {c['lag']:.1f}° (by {cg['lag']:.1f}° at ω = γ)")
    run(b, 'glass')
    o = b.eval('[__app.optics(1.8892).n, __app.optics(2.5506).n]')
    check(abs(o[0] - 1.4564) < 2e-4 and abs(o[1] - 1.4632) < 2e-4, f"fused silica: n(656 nm) = {o[0]:.4f}, n(486 nm) = {o[1]:.4f} (Malitson 1.4564, 1.4632)")

    # ---- Kramers-Kronig: draw a line on Im χ; Re χ follows and χ(t) stays causal
    run(b, 'draw')
    re0 = b.eval('__app.drawn().re[Math.round(1.0 / __app.drawn().grid.dw)]')
    b.drag('#kkim', (0.1, 0.5), (0.25, 0.3), steps=20); b.eval('__app.step(0, 1)')
    re1 = b.eval('__app.drawn().re[Math.round(1.0 / __app.drawn().grid.dw)]')
    a = b.eval('__app.acausal()')
    check(abs(re1 - re0) > 0.02 and a['before'] < 1e-3 * a['after'], f"drawing absorption changes Re χ(1) ({re0:.4f} -> {re1:.4f}); χ(t) stays causal (before/after {a['before'] / a['after']:.1e})")
    b.screenshot('build/dsp-kk-drawn.png')
    b.click('#kk-row button')            # break causality
    check(b.eval('__app.state.broken'), 'Break causality is on')
    b.drag('#kkre', (0.5, 0.2), (0.7, 0.2), steps=12); b.eval('__app.step(0, 1)')
    a = b.eval('__app.acausal()')
    check(a['before'] > 0.05 * a['after'], f"drawing Re χ alone makes χ(t) leak into t < 0 ({a['before'] / a['after'] * 100:.1f}% of its size after t = 0)")
    b.screenshot('build/dsp-kk-broken.png')
    b.click('#kk-row button')            # mend it
    a = b.eval('__app.acausal()')
    check(not b.eval('__app.state.broken') and a['before'] < 1e-3 * a['after'], f"turning causality back on recomputes Im χ: causal again ({a['before'] / a['after']:.1e})")
    run(b, 'acausal')
    a = b.eval('__app.acausal()')
    check(abs(a['before'] / a['after'] - 1) < 0.02, f"absorption with no dispersion: χ(t) as big before the kick as after ({a['before'] / a['after']:.3f})")

    # ---- one sliver: its share of Re χ is + below it and − above; its ring starts at the kick
    run(b, 'sliver')
    sl = b.eval('__app.sliver()')
    sh = b.eval(f"__app.sliverShare([{sl['w'] - 0.5}, {sl['w'] + 0.5}], [-5, -1, 1, 5])")
    check(sh['re'][0] > 0 and sh['re'][1] < 0 and sh['t'][0] == 0 and sh['t'][1] == 0 and sh['t'][2] != 0,
          f"the sliver at ω' = {sl['w']:.2f}: its share of Re χ is {sh['re'][0]:+.3f} below and {sh['re'][1]:+.3f} above; its ring is zero before the kick")
    # (The handle sits above the plot: the frame's left edge is at 50 px, its right 14 px in, its top 36 px down.)
    kb = b.box('#kkim'); hx = (50 + sl['w'] / 4 * (kb[2] - 64)) / kb[2]; hy = 28 / kb[3]
    b.drag('#kkim', (hx, hy), (0.75, hy), steps=8); b.eval('__app.step(0, 1)')
    sl2 = b.eval('__app.sliver()')
    check(sl2['w'] > sl['w'] + 0.5 and b.eval('__app.state.source') == 'osc', f"dragging the sliver's handle moves it ({sl['w']:.2f} -> {sl2['w']:.2f}) without drawing")
    b.click('#kk-row button')            # break causality
    sh = b.eval("__app.sliverShare([1], [-5, 5])")
    check(abs(sh['t'][0] + sh['t'][1]) < 1e-12 and sh['t'][1] != 0, f"with causality broken the sliver alone rings before the kick as after ({sh['t'][0]:.4f}, {sh['t'][1]:.4f})")
    b.screenshot('build/dsp-sliver-broken.png')

    # ---- typed χ: the Lorentzian is causal; the wrong sign of i is not
    run(b, 'typed')
    a = b.eval('__app.acausal()')
    check(a['before'] < 1e-3 * a['after'], f"typed Lorentzian: causal ({a['before'] / a['after']:.1e})")
    b.eval("[...document.querySelectorAll('#typed-presets button')].find(x => x.textContent.startsWith('+i')).click(); __app.step(0, 1)")
    a = b.eval('__app.acausal()')
    check(a['before'] > 10 * a['after'], f"typed with +iγω: χ(t) lives before the kick ({a['before'] / max(a['after'], 1e-300):.1e} times)")

    # ---- pulses: in space, the envelope goes at c/n_g; at the detector, z(n_g − 1)/c late
    run(b, 'delay')
    m = b.eval('__app.pulseAt(__app.state.pulse.z)')
    check(abs(m['peakVac'] - m['predictedVac']) < 0.03 * m['predictedVac'],
          f"delay at z = 120: predicted z(n_g - 1) = {m['predictedVac']:.2f}, peak at {m['peakVac']:.2f}")
    p1, p2 = b.eval('[__app.snapshotPeak(60), __app.snapshotPeak(110)]')
    v = (p2['z'] - p1['z']) / 50
    check(abs(v - 1 / m['ng']) < 0.02, f"in the picture in space the peak goes {p2['z'] - p1['z']:.1f} in 50: {v:.3f} c (c/n_g = {1 / m['ng']:.3f} c)")
    w0 = b.eval('__app.state.pulse.w0')
    hs = b.eval('__app.handles()'); cr = next(h for h in hs if h['type'] == 'carrier'); box = b.box('#resp')
    b.drag('#resp', (cr['x'] / box[2], cr['y'] / box[3]), ((cr['x'] + 60) / box[2], cr['y'] / box[3]), steps=6); b.eval('__app.step(0, 1)')
    check(b.eval('__app.state.pulse.w0') > w0 + 0.1, f"dragging the carrier moves it ({w0:.3f} -> {b.eval('__app.state.pulse.w0'):.3f})")
    t0, t1 = b.eval('__app.run()')
    b.eval('__app.hold(true)'); b.eval('__app.state.playing = true')
    ts = [b.eval('__app.step(0.5, 1)')['t'] for _ in range(3)]
    check(abs((ts[1] - ts[0]) - (t1 - t0) * 0.5 / 7) < 1e-6, f"the pulse's clock runs across [{t0:.0f}, {t1:.0f}] in 7 s of the page's time")
    run(b, 'superluminal')
    p5, p10 = b.eval('__app.pulseAt(5)'), b.eval('__app.pulseAt(10)')
    check(p5['ng'] < 0 and p5['peakVac'] < -5 and p10['peakVac'] < p5['peakVac'] and p10['height'] < 0.3,
          f"n_g = {p5['ng']:.3f}: the peak leaves {-p5['peakVac']:.1f} early at z = 5 ({p5['height'] * 100:.0f}% high), {-p10['peakVac']:.1f} early at z = 10 ({p10['height'] * 100:.0f}%)")
    run(b, 'front')
    p = b.eval('__app.pulseAt(10)')
    check(p['before'] < 1e-8, f"cut front: largest field before it arrives {p['before']:.1e} of the peak; the peak at {p['peakVac']:.1f} (the front at {p['front']:.0f})")
    b.eval("__app.state.pulse.log = true; __app.setView('pulse'); __app.step(0, 1)")
    b.screenshot('build/dsp-front-log.png')
    run(b, 'precursors')
    p = b.eval('__app.pulseAt(10)')
    check(p['before'] < 1e-6 and abs(p['brillouin'] - 5) < 0.01, f"switched-on carrier: field before z/c {p['before']:.1e} of the peak; Brillouin's swing near n(0)z/c, {p['brillouin']:.2f} after z/c")
    b.screenshot('build/dsp-precursors.png')
    ms = b.eval('__app.bench()')
    check(ms < 33, f"precursors: {ms:.1f} ms an animation frame (needs < 33 for 30 fps)")
    run(b, 'spread')
    ms = b.eval('__app.bench()')
    check(ms < 33, f"spreading in glass: {ms:.1f} ms an animation frame")
    st = b.eval('[1, 1.732, 5].map((mm) => __app.pulseAt(mm / 1.97327e-4).stretch)')
    check(abs(st[0] - 2 ** 0.5) < 0.02 and abs(st[1] - 2) < 0.02 and abs(st[2] - 26 ** 0.5) < 0.05,
          f"a 10 fs pulse in fused silica grows {st[0]:.3f}, {st[1]:.3f}, {st[2]:.3f} times in 1, 1.73, 5 mm (√(1 + (z/L)²) with L = 1.0 mm: 1.414, 2.000, 5.099)")
    vac = b.eval('[0, 0.5, 1, 1.7, 2.3, 3.1, 3.9, 4.6, 5].map((mm) => __app.vacuumInView(mm / 1.97327e-4))')
    check(vac[0] > 0.99 and max(vac[2:]) < 1e-12, f"moving with the pulse, the vacuum pulse is in view at z = 0 ({vac[0]:.3f}) and gone, not wrapped round, beyond 1 mm (largest {max(vac[2:]):.1e})")
    sp = b.eval('(() => { const [a, c] = __app.run(); return [__app.snapshotPeak(a + 0.4 * (c - a)), __app.snapshotPeak(a + 0.8 * (c - a))]; })()')
    check(all(w[0] <= p_['z'] <= w[1] for p_ in sp for w in [p_['window']]), f"moving with the pulse, the picture in space keeps it in view (at {sp[0]['z'] * 1.97327e-4:.2f} and {sp[1]['z'] * 1.97327e-4:.2f} mm)")

    # ---- switching medium in the pulse view carries the pulse over to the new frequency scale
    run(b, 'delay')
    b.eval("[...document.querySelectorAll('#media button')].find(x => x.textContent === 'Ionosphere').click(); __app.step(0, 1)")
    st = b.eval('__app.state')
    check(st['units'] == 'MHz' and abs(st['pulse']['w0'] / st['wmax'] - 0.25) < 1e-9, f"switching to the ionosphere keeps the carrier at a quarter of the range ({st['pulse']['w0']:.2f} MHz)")
    b.screenshot('build/dsp-switched.png')

    # ---- the address keeps a set-up, and every old set-up name still opens
    old = ['one', 'delay', 'spread', 'glass', 'metal', 'ionosphere', 'reststrahlen', 'draw', 'acausal', 'sumrule', 'superluminal', 'front', 'precursors', 'typed']
    names = b.eval('Object.keys(__app.setups)')
    check(all(n in names for n in old), f"every set-up name of the first version still opens ({len(names)} set-ups)")
    run(b, 'one')
    b.eval("__app.state.oscs.push({ w0: 3.1, g: 0.3, wp: 0.7 }); __app.setView('medium')")
    b.eval("document.querySelector('#osc-chips button').click()")  # any change writes the hash
    press(b, '#resp', 0.3)
    b.wait("location.hash.includes('3.1_0.3_0.7') && location.hash.includes('v=medium') && location.hash.includes('w=' + __app.state.probe.toPrecision(4).replace(/0+$/, '').replace(/[.]$/, ''))", timeout=20)
    h = b.eval('location.hash')
    wbefore = b.eval('__app.state.probe')
    b.eval('window.__app = undefined; location.reload()'); b.wait('window.__app && __app.ready', timeout=60)   # (cleared first: else the old page's __app satisfies the wait mid-reload)
    oscs = b.eval('__app.state.oscs')
    check(len(oscs) == 2 and abs(oscs[1]['w0'] - 3.1) < 1e-9 and b.eval('__app.state.view') == 'medium' and abs(b.eval('__app.state.probe') - wbefore) < 1e-3 * wbefore,
          f'reloading the address brings back two oscillators, the view and the light\'s frequency ({h[:70]}...)')
    b.eval("location.hash = '#setup=precursors'")
    b.wait("__app.state.pulse.shape === 'step'", timeout=20)
    check(b.eval('__app.state.pulse.shape') == 'step', 'typing #setup=precursors into the address opens that experiment')
    b.eval("location.reload()"); b.wait('window.__app && __app.ready', timeout=60)
    check(b.eval('__app.state.pulse.shape') == 'step' and b.eval('__app.state.medium') == 'brillouin', 'and so does loading it')

    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

# Dark, and a phone.
with Browser('dispersion/index.html', size=(1400, 900)) as b:
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
    b.wait('window.__app && __app.ready', timeout=90); b.eval('__app.hold(true)')
    for name in ('one', 'sliver', 'delay'):
        run(b, name); b.screenshot(f'build/dsp-dark-{name}.png')
    check(b.eval("getComputedStyle(document.body).backgroundColor") != 'rgb(244, 243, 239)', 'dark: the page follows the dark colour scheme')
    run(b, 'one'); first_screen(b, 'dark')
    hint_ink, bg = b.eval("[getComputedStyle(document.getElementById('resp-hint')).color, getComputedStyle(document.body).backgroundColor]")
    start_ink, start_bg = b.eval("(() => { const s = document.querySelector('#help .start'); const c = getComputedStyle(s); return [c.color, c.backgroundColor]; })()")
    lum = lambda css: sum(int(v) for v in re.findall(r'\d+', css)[:3]) / 3
    check(lum(hint_ink) - lum(bg) > 80 and lum(start_ink) - lum(start_bg) > 80, f'dark: the hint ({hint_ink} on {bg}) and the Start-here block ({start_ink} on {start_bg}) read')

with Browser('dispersion/index.html', size=(390, 844)) as b:
    b.wait('window.__app && __app.ready', timeout=90); b.eval('__app.hold(true)')
    b.screenshot('build/dsp-phone-start.png')
    first_screen(b, 'phone')
    hint = b.box('#resp-hint'); plot = b.box('#resp-wrap')
    check(hint[1] >= plot[1] + plot[3] - 1 and hint[1] + hint[3] <= 844, f'on a phone the hint sits right under the top plot, in view without scrolling (bottom at {hint[1] + hint[3]:.0f} px)')
    wide = []
    for name in ('one', 'metal', 'sliver', 'delay', 'precursors'):
        run(b, name)
        b.screenshot(f'build/dsp-phone-{name}.png')
        wide.append(b.eval('document.documentElement.scrollWidth'))
    check(max(wide) <= 390, f'no sideways scrolling on a phone (pages {max(wide)} px wide at most)')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'phone: no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
