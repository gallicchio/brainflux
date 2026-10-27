#!/usr/bin/env python3
"""Drive the dispersion demo: every experiment, the handles, drawing for Kramers-Kronig, pulses,
the address, speed, and a phone-sized screen."""
import json, math, os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

def run(b, name, wait=0.8):
    b.eval(f'__app.setups[{json.dumps(name)}]()'); b.sleep(wait)

# The words of a read-out with its numbers taken out: it may move when these change, not when
# only the numbers do.
def phrase(text):
    return re.sub(r'[−+-]?\d[\d.]*(?:e[−+-]?\d+)?', '#', text)

def keeps_still(b, sel, steps, settle=0.25):
    """Run steps (callables that change the numbers shown) and compare the boxes of the elements
    matching sel, after every step, with those first seen with the same words.  Returns (the
    largest shift in px, the steps compared, the distinct texts seen)."""
    texts = f"[...document.querySelectorAll({json.dumps(sel)})].map((e) => e.textContent).join(' | ')"
    t0 = b.eval(texts)
    first = {phrase(t0): b.rects(sel)}
    worst, compared, seen = 0.0, 0, {t0}
    for step in steps:
        step(); b.sleep(settle)
        r, t = b.rects(sel), b.eval(texts)
        seen.add(t)
        r0 = first.setdefault(phrase(t), r)
        if r0 is r or len(r) != len(r0):
            continue
        compared += 1
        worst = max([worst] + [abs(x - y) for a, c in zip(r0, r) for x, y in zip(a, c)])
    return worst, compared, seen

with Browser('dispersion/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1.5)
    b.screenshot('build/dsp-start.png')
    s = b.eval('__app.state')
    check(s['view'] == 'pulse' and s['playing'] and s['pulse']['z'] > 0, f"opens on pulses, playing (z = {s['pulse']['z']:.1f})")

    # Group delay: the peak arrives when z (n_g - 1)/c says.
    m = b.eval('__app.pulseAt(__app.state.pulse.zmax)')
    check(abs(m['peakVac'] - m['predictedVac']) < 0.03 * m['predictedVac'],
          f"delay at z = zmax: predicted z(n_g - 1) = {m['predictedVac']:.2f}, peak at {m['peakVac']:.2f}")

    bad = []
    for name in b.eval('Object.keys(__app.setups)'):
        run(b, name, 1.2)
        b.screenshot(f'build/dsp-exp-{name}.png')
        text = b.eval("document.querySelector('#readout').textContent")
        slots = b.eval("[...document.querySelectorAll('#readout .fixnum')].map((e) => e.textContent)")
        if 'NaN' in text or 'Infinity' in text or 'undefined' in text or any(t in ('–', '∞', '−∞') for t in slots): bad.append(f'{name}: {text[:120]}')
    check(not bad, 'every experiment\'s read-out is made of numbers' + ('' if not bad else ': ' + ' | '.join(bad)))

    # ---- the read-out keeps still: while the pulse travels, the pointer reads off the medium, or the
    # time axis is refitted, every line, number and the words after them keep their places (as long
    # as the words stay the same); Play and Pause leave the button beside them where it was.
    RO = '#readout > div, #readout .fixnum'
    def hover(fx):
        def go():
            x, y, w, h = b.box('#resp'); b.mouse('mouseMoved', x + fx * w, y + 0.5 * h)
        return go
    for name, steps in (('delay', [lambda: b.sleep(0.35)] * 10),
                        ('precursors', [lambda: b.sleep(0.35)] * 8),
                        ('one', [hover(f) for f in (0.12, 0.3, 0.47, 0.5, 0.53, 0.7, 0.93)]),
                        ('glass', [hover(f) for f in (0.08, 0.15, 0.4, 0.75, 0.97)]),
                        ('superluminal', [lambda: b.sleep(0.35)] * 6 + [hover(f) for f in (0.2, 0.45, 0.5, 0.8)])):
        run(b, name, 1.0)
        b.eval("__app.state.playing = true; document.querySelector('#play').textContent = 'Pause'")
        worst, compared, seen = keeps_still(b, RO, steps)
        check(worst <= 0.5 and compared >= len(steps) - 4 and len(seen) >= len(steps) // 2,
              f'{name}: the read-out keeps still while its numbers change (largest shift {worst:.1f} px over {compared} of {len(steps)} changes, {len(seen)} different readings)')
    b.mouse('mouseMoved', 2, 2)
    run(b, 'delay', 0.6)
    fit0 = b.box('#fit'); b.click('#play'); b.sleep(0.2); fit1 = b.box('#fit'); b.click('#play'); b.sleep(0.2); fit2 = b.box('#fit')
    check(max(abs(a - c) for a, c in zip(fit0, fit1)) <= 0.5 and max(abs(a - c) for a, c in zip(fit0, fit2)) <= 0.5,
          f'Play and Pause leave the "Fit time axis" button in its place ({fit0[0]:.1f}, {fit1[0]:.1f}, {fit2[0]:.1f})')

    # ---- the handles: drag a line sideways (strength kept), up (stronger), its width (area kept)
    run(b, 'sumrule')
    b.eval("__app.state.playing = false")
    hs = b.eval('__app.handles()')
    peak = next(h for h in hs if h['type'] == 'peak')
    box = b.box('#resp')
    def frac(x, y): return ((x) / box[2], (y) / box[3])
    o0 = b.eval('__app.state.oscs[0]')
    b.drag('#resp', frac(peak['x'], peak['y']), frac(peak['x'] + 60, peak['y']), steps=8); b.sleep(0.3)
    o1 = b.eval('__app.state.oscs[0]')
    check(o1['w0'] > o0['w0'] + 0.1 and abs(o1['wp'] - o0['wp']) < 1e-12, f"dragging the line sideways moves it ({o0['w0']:.3f} -> {o1['w0']:.3f}) and keeps its strength")
    hs = b.eval('__app.handles()'); peak = next(h for h in hs if h['type'] == 'peak')
    b.drag('#resp', frac(peak['x'], peak['y']), frac(peak['x'], peak['y'] - 60), steps=8); b.sleep(0.3)
    o2 = b.eval('__app.state.oscs[0]')
    check(o2['wp'] > o1['wp'] * 1.05, f"dragging it up makes it stronger (ω_p {o1['wp']:.3f} -> {o2['wp']:.3f})")
    sr0 = b.eval('__app.sumRule()')
    hs = b.eval('__app.handles()'); wr = next(h for h in hs if h['type'] == 'wr')
    b.drag('#resp', frac(wr['x'], wr['y']), frac(wr['x'] + 40, wr['y']), steps=8); b.sleep(0.3)
    o3 = b.eval('__app.state.oscs[0]'); sr1 = b.eval('__app.sumRule()')
    wp2 = o3['wp'] ** 2
    check(o3['g'] > o2['g'] * 1.5 and abs(sr1['integral'] / (math.pi / 2) - wp2) < 1e-4 * wp2 and abs(sr1['integral'] - sr0['integral']) < 1e-4 * sr0['integral'],
          f"widening the line (γ {o2['g']:.3f} -> {o3['g']:.3f}) keeps ∫ω ε'' dω = (π/2) ω_p²: {sr0['integral']:.5f} -> {sr1['integral']:.5f} (ω_p² = {wp2:.5f})")
    b.screenshot('build/dsp-dragged.png')

    # ---- Kramers-Kronig: draw a line on Im χ; Re χ follows and χ(t) stays causal
    run(b, 'draw')
    re0 = b.eval('__app.drawn().re[Math.round(1.0 / __app.drawn().grid.dw)]')
    b.drag('#kkim', (0.1, 0.5), (0.25, 0.3), steps=20)
    b.sleep(0.3)
    re1 = b.eval('__app.drawn().re[Math.round(1.0 / __app.drawn().grid.dw)]')
    a = b.eval('__app.acausal()')
    check(abs(re1 - re0) > 0.02 and a['before'] < 1e-3 * a['after'], f"drawing absorption changes Re χ(1) ({re0:.4f} -> {re1:.4f}); χ(t) stays causal (before/after {a['before'] / a['after']:.1e})")
    b.screenshot('build/dsp-kk-drawn.png')
    b.click('#kk-row button')            # break causality
    check(b.eval('__app.state.broken'), 'Break causality is on')
    b.drag('#kkre', (0.5, 0.2), (0.7, 0.2), steps=12)
    b.sleep(0.3)
    a = b.eval('__app.acausal()')
    check(a['before'] > 0.05 * a['after'], f"drawing Re χ alone makes χ(t) leak into t < 0 ({a['before'] / a['after'] * 100:.1f}% of its size after t = 0)")
    b.screenshot('build/dsp-kk-broken.png')
    b.click('#kk-row button')            # mend it
    a = b.eval('__app.acausal()')
    check(not b.eval('__app.state.broken') and a['before'] < 1e-3 * a['after'], f"turning causality back on recomputes Im χ: causal again ({a['before'] / a['after']:.1e})")
    run(b, 'acausal')
    a = b.eval('__app.acausal()')
    check(abs(a['before'] / a['after'] - 1) < 0.02, f"absorption with no dispersion: χ(t) as big before the kick as after ({a['before'] / a['after']:.3f})")

    # ---- typed χ: the Lorentzian is causal; the wrong sign of i is not
    run(b, 'typed')
    a = b.eval('__app.acausal()')
    check(a['before'] < 1e-3 * a['after'], f"typed Lorentzian: causal ({a['before'] / a['after']:.1e})")
    b.eval("[...document.querySelectorAll('#typed-presets button')].find(x => x.textContent.startsWith('+i')).click()"); b.sleep(0.5)
    a = b.eval('__app.acausal()')
    check(a['before'] > 10 * a['after'], f"typed with +iγω: χ(t) lives before the kick ({a['before'] / max(a['after'], 1e-300):.1e} times)")

    # ---- pulses
    run(b, 'superluminal')
    p5, p10 = b.eval('__app.pulseAt(5)'), b.eval('__app.pulseAt(10)')
    check(p5['ng'] < 0 and p5['peakVac'] < -5 and p10['peakVac'] < p5['peakVac'] and p10['height'] < 0.3,
          f"n_g = {p5['ng']:.3f}: the peak leaves {-p5['peakVac']:.1f} early at z = 5 ({p5['height'] * 100:.0f}% high), {-p10['peakVac']:.1f} early at z = 10 ({p10['height'] * 100:.0f}%)")
    run(b, 'front')
    p = b.eval('__app.pulseAt(10)')
    check(p['before'] < 1e-8, f"cut front: largest field before it arrives {p['before']:.1e} of the peak; the peak at {p['peakVac']:.1f} (the front at {p['front']:.0f})")
    b.eval("__app.state.pulse.log = true; __app.state.pulse.z = 10; __app.state.playing = false; __app.setView('pulse')"); b.sleep(0.5)
    b.screenshot('build/dsp-front-log.png')
    run(b, 'precursors')
    p = b.eval('__app.pulseAt(10)')
    check(p['before'] < 1e-6, f"switched-on carrier: field before z/c {p['before']:.1e} of the peak")
    b.eval("__app.state.playing = false; __app.state.pulse.z = 10; __app.setView('pulse')"); b.sleep(0.4)
    b.screenshot('build/dsp-precursors-z10.png')
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
    run(b, 'glass')
    o = b.eval('[__app.optics(1.8892).n, __app.optics(2.5506).n]')
    check(abs(o[0] - 1.4564) < 2e-4 and abs(o[1] - 1.4632) < 2e-4, f"fused silica: n(656 nm) = {o[0]:.4f}, n(486 nm) = {o[1]:.4f} (Malitson 1.4564, 1.4632)")
    run(b, 'reststrahlen')
    o = b.eval('__app.optics(6.2)')
    check(o['R'] > 0.9, f"rock salt reflects {o['R'] * 100:.0f}% at 6.2 THz, between ω_TO and ω_LO")
    run(b, 'metal')
    lo, hi = b.eval('[__app.optics(3).R, __app.optics(8).R]')
    check(lo > 0.98 and hi < 0.05, f"sodium: R = {lo:.3f} at 3 eV (visible), {hi:.3f} at 8 eV (ultraviolet)")

    # ---- switching medium in the pulse view carries the pulse over to the new frequency scale
    run(b, 'delay')
    b.eval("[...document.querySelectorAll('#media button')].find(x => x.textContent === 'Ionosphere').click()"); b.sleep(0.8)
    st = b.eval('__app.state')
    check(st['units'] == 'MHz' and abs(st['pulse']['w0'] / st['wmax'] - 0.25) < 1e-9, f"switching to the ionosphere keeps the carrier at a quarter of the range ({st['pulse']['w0']:.2f} MHz)")
    b.screenshot('build/dsp-switched.png')

    # ---- the address keeps a set-up
    run(b, 'one')
    b.eval("__app.state.oscs.push({ w0: 3.1, g: 0.3, wp: 0.7 }); __app.setView('medium')")
    b.eval("document.querySelector('#osc-chips button').click()")  # any change writes the hash
    b.sleep(0.6)
    h = b.eval('location.hash')
    b.eval('location.reload()'); b.sleep(0.5); b.wait('window.__app && __app.ready'); b.sleep(0.6)
    oscs = b.eval('__app.state.oscs')
    check(len(oscs) == 2 and abs(oscs[1]['w0'] - 3.1) < 1e-9 and b.eval('__app.state.view') == 'medium', f'reloading the address brings back two oscillators and the view ({h[:60]}...)')
    b.eval("location.hash = '#setup=precursors'"); b.sleep(0.6)
    check(b.eval('__app.state.pulse.shape') == 'step', 'typing #setup=precursors into the address opens that experiment')
    b.eval("location.reload()"); b.sleep(0.5); b.wait('window.__app && __app.ready'); b.sleep(0.5)
    check(b.eval('__app.state.pulse.shape') == 'step' and b.eval('__app.state.medium') == 'brillouin', 'and so does loading it')

    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

# A phone.
with Browser('dispersion/index.html', size=(400, 850)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1.2)
    b.screenshot('build/dsp-phone-start.png')
    for name in ('one', 'draw', 'precursors'):
        run(b, name, 1.0)
        b.screenshot(f'build/dsp-phone-{name}.png')
    wide = b.eval('document.documentElement.scrollWidth')
    check(wide <= 400, f'no sideways scrolling on a phone (page {wide} px wide)')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'phone: no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
