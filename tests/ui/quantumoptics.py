#!/usr/bin/env python3
"""Drive the quantum optics demo: the opening view, every experiment, the drags, the motor
scan, the numbers the help quotes (measured on the page), the address, the readouts keeping
still, both themes and a phone-sized screen.  The page's clocks are held and stepped from here
(__app.hold, __app.step), so nothing depends on how fast the machine is."""
import json, math, os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

def run(b, name, seconds=0.0):
    b.eval(f'__app.setups[{json.dumps(name)}](); __app.hold(true); __app.step(1/30, {max(1, int(seconds * 30))})')

def phrase(text):
    return re.sub(r'[−+-]?\d[\d.]*(?:e[−+-]?\d+)?', '#', text)

def keeps_still(b, sel, steps):
    """Run steps (callables that change the numbers shown) and compare the boxes of the elements
    matching sel with those first seen with the same words.  Returns (largest shift, compared, texts)."""
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

def visible_hints(b):
    return b.eval("[...document.querySelectorAll('.hint')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map((e) => e.textContent.trim())")

def first_screen(b, where):
    hints = visible_hints(b)
    check(len(hints) == 1 and hints[0].startswith('Drag the dot') and 'noise band' in hints[0], f'{where}: one hint under the pictures says what to drag ({hints})')
    ro = b.eval("document.querySelector('#readout').innerText")
    check(ro.startswith('Mean field') and 'photons' in ro and 'Noise' in ro and 'the limit is' in ro, f'{where}: the read-out has words ({ro[:60]}...)')

RO = '#readout > div, #readout .fixnum'

with Browser('quantumoptics/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready', timeout=90)
    b.eval('__app.hold(true)')
    s = b.eval('__app.state')
    check(s['view'] == 'mode' and s['kind'] == 'vacuum' and s['running'], 'opens on view 1 with the vacuum, the clock running')
    first_screen(b, 'opening')
    b.screenshot('build/qo-start.png')
    # Each view has its own hint.
    hints = {}
    for v in ('squeeze', 'homodyne', 'ligo'):
        b.eval(f"__app.setView('{v}')"); hints[v] = visible_hints(b)
    b.eval("__app.setView('mode')")
    check(all(len(h) == 1 for h in hints.values()) and 'squeezing' in hints['squeeze'][0] and 'yellow axis' in hints['homodyne'][0] and 'Squeezed light' in hints['ligo'][0],
          'the squeezing, homodyne and LIGO views each have one hint saying what to drag')
    # Plain words: the view tabs, the state buttons, the presets have tooltips; the sliders have words.
    titles = b.eval("[...document.querySelectorAll('#view-row button, #kind-row button, #sq-presets button, #source-row button')].map((e) => e.title)")
    check(all(len(t) > 20 for t in titles), f'every view tab, state button, squeezing preset and source has a tooltip ({len(titles)})')
    labels = b.eval("[...document.querySelectorAll('.controls .slider label')].map((e) => e.textContent.trim())")
    check(any(l.startswith('mean field') for l in labels) and any(l.startswith('squeezing') for l in labels) and any(l.startswith('LO phase') for l in labels) and any(l.startswith('arm power') for l in labels),
          f'the sliders say what their symbols are ({len(labels)} sliders)')
    # The drawer: Start here first, in plain words and no equations; the theory last.
    order = b.eval("[...document.querySelectorAll('#help > section, #help > article')].map((e) => e.className)")
    start = b.eval("document.querySelector('#help .start').innerText")
    check(order[0] == 'start' and order[-1] == 'theory' and 'math' not in b.eval("document.querySelector('#help .start').innerHTML") and 'Drag' in start and 'LIGO' in start and len(start) < 1800,
          f'the drawer opens with Start here and ends with How it works ({len(order)} parts, {order.count("exp")} experiments)')
    check(order.count('exp') == 14, '14 experiments')
    names = b.eval('Object.keys(__app.setups)')
    check(names == ['vacuum', 'coherent', 'phase', 'squeezevac', 'phasesq', 'loss', 'quadrature', 'scan', 'phaseshift', 'darkport', 'inject', 'radiation', 'fdsqz', 'chirp'], f'the set-ups are in the drawer\'s order ({names})')

    # ---- 1 · One mode: the vacuum's noise, the coherent state, the phase
    run(b, 'vacuum', 2)
    st = b.eval('__app.base()')
    check(abs(st['x1']) < 1e-12 and abs(st['x2']) < 1e-12 and abs(math.sqrt(st['s11']) - 0.5) < 1e-12 and abs(math.sqrt(st['s22']) - 0.5) < 1e-12, 'the vacuum: zero mean field, ΔX1 = ΔX2 = 1/2')
    ph = b.eval('__app.photons()')
    check(abs(ph['P'][0] - 1) < 1e-12 and ph['mean'] == 0, 'no photons in the vacuum: P(0) = 1')
    tr = b.eval('__app.trace()')
    inside = sum(1 for t, E in tr if abs(E) <= 0.5) / len(tr)
    check(len(tr) > 100 and 0.4 < inside < 0.95 and max(abs(E) for t, E in tr) > 0.3, f'the field of the vacuum is noise in the band ±1/2 ({100 * inside:.0f}% of {len(tr)} points inside; largest {max(abs(E) for t, E in tr):.2f})')
    # The point drawn from the cloud stays for a period: E(t) is a clean sinusoid within each period.
    run(b, 'coherent', 2)
    tr = b.eval('__app.trace()'); samp = b.eval('__app.anim.sample'); k = b.eval('__app.anim.samplePeriod')
    amp = math.hypot(*samp); phs = math.atan2(samp[1], samp[0])
    err = max(abs(E - amp * math.cos(2 * math.pi * t - phs)) for t, E in tr if math.floor(t) == k)
    check(err < 1e-9 and 2 < amp < 4, f'the field this period is the point\'s shadow as it turns: amplitude {amp:.3f}, error {err:.1e}')
    st = b.eval('__app.base()'); ph = b.eval('__app.photons()')
    check(abs(st['x1'] - 3) < 1e-12 and abs(ph['mean'] - 9) < 1e-6 and abs(ph['sd'] - 3) < 1e-6, f"the coherent state |α| = 3: ⟨n⟩ = {ph['mean']:.2f}, Δn = {ph['sd']:.2f} (Poisson)")
    ro = b.eval("document.querySelector('#readout').innerText")
    check('9.00 photons' in ro and 'Δn = 3.00' in ro and '0.167 rad' in ro and '9.5°' in ro, f'the read-out quotes ⟨n⟩ = 9.00, Δn = 3.00, Δφ = 0.167 rad = 9.5° ({ro[:90]}...)')
    # The cloud turns clockwise: the mean's angle goes down with time.
    a0 = b.eval('(() => { const t = __app.turned(); return Math.atan2(t.x2, t.x1); })()')
    b.eval('__app.step(0.2, 1)')
    a1 = b.eval('(() => { const t = __app.turned(); return Math.atan2(t.x2, t.x1); })()')
    d = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
    check(abs(d + 2 * math.pi * 0.2 / 4) < 1e-9, f'the cloud turns clockwise, a period in 4 s ({d:.4f} rad in 0.2 s)')
    # Dragging the dot sets α; dragging to the centre gives the vacuum.
    b.eval('__app.state.running = false; __app.anim.t = Math.round(__app.anim.t); __app.step(0, 1)')   # at a whole period the cloud is unturned
    box = b.box('#plane')
    b.eval("__app.state.kind = 'laser'; __app.state.alpha = 3; __app.state.phase = 0; __app.step(0, 1)")
    # Press at the mean's pixel and drag up-left.
    m = b.eval('(() => { const t = __app.turned(); return __app.pixelOf(t.x1, t.x2); })()')
    b.drag('#plane', (m[0] / box[2], m[1] / box[3]), ((m[0] + 40) / box[2], (m[1] - 40) / box[3]), steps=6)
    b.eval('__app.step(0, 1)')
    s = b.eval('__app.state')
    check(s['kind'] == 'laser' and 5 < s['phase'] < 40 and s['alpha'] > 3.5, f"dragging the dot up and out moves α: |α| = {s['alpha']:.2f} at {s['phase']}°")
    m = b.eval('(() => { const t = __app.turned(); return __app.pixelOf(t.x1, t.x2); })()')
    o = b.eval('__app.pixelOf(0, 0)')
    b.drag('#plane', (m[0] / box[2], m[1] / box[3]), (o[0] / box[2], o[1] / box[3]), steps=6); b.eval('__app.step(0, 1)')
    check(b.eval('__app.state.kind') == 'vacuum', 'dragging the dot to the centre gives the vacuum')
    # Experiment 3: more photons, the same noise, a sharper phase.
    run(b, 'phase', 0.1)
    out = []
    for a in (1, 2, 4):
        set_slider(b, '#state-box', 'mean field', a)
        out.append(b.eval("(() => { const t = document.querySelector('#readout').innerText; const m = /Δφ ≈ ΔX\\/\\|α\\| = ([0-9.]+) rad = ([0-9.]+)°/.exec(t); return m ? [+m[1], +m[2]] : null; })()"))
    check(out[0] and abs(out[0][0] - 0.5) < 1e-3 and abs(out[0][1] - 28.6) < 0.1 and abs(out[1][0] - 0.25) < 1e-3 and abs(out[2][0] - 0.125) < 1e-3,
          f'Δφ = 1/(2|α|): {out[0][0]:.3f} rad ({out[0][1]}°), {out[1][0]:.3f}, {out[2][0]:.3f} at |α| = 1, 2, 4')
    check(b.eval('__app.state.show.wedge'), 'the phase wedge is shown')
    b.screenshot('build/qo-phase.png')

    # ---- 2 · Squeezing
    run(b, 'squeezevac', 1)
    st = b.eval('__app.base()'); ph = b.eval('__app.photons()')
    check(abs(math.sqrt(st['s11']) - 0.25) < 1e-9 and abs(math.sqrt(st['s22']) - 1) < 1e-9, f"the squeezed vacuum: ΔX1 = {math.sqrt(st['s11']):.3f}, ΔX2 = {math.sqrt(st['s22']):.3f}")
    odd = sum(ph['P'][1::2])
    check(odd < 1e-12 and abs(ph['mean'] - math.sinh(math.log(2)) ** 2) < 1e-4, f"photons in pairs only (odd total {odd:.1e}), ⟨n⟩ = sinh²r = {ph['mean']:.3f}")
    ro = b.eval("document.querySelector('#readout').innerText")
    check('6.0 dB' in ro and '0.250' in ro and '1.000' in ro and 'product 0.250' in ro, f'the read-out: 6.0 dB, ΔX 0.250 and 1.000, product 0.250')
    # The band breathes: the variance of the field at θ = 0 and 90° differ by e^{4r}.
    v = b.eval('(() => { const s = __app.base(); return [s.s11, s.s22]; })()')
    check(abs(v[1] / v[0] - 16) < 1e-9, 'the noise band is 16 times wider in power a quarter period on (e^{4r} = 16)')
    run(b, 'phasesq', 1)
    ph = b.eval('__app.photons()'); ro = b.eval("document.querySelector('#readout').innerText")
    check(abs(ph['mean'] - 9.5625) < 1e-4 and abs(ph['sd'] - math.sqrt(36 + 0.5 * math.sinh(2 * math.log(2)) ** 2)) < 1e-3 and ph['sd'] > math.sqrt(ph['mean']),
          f"phase-squeezed |α| = 3: ⟨n⟩ = {ph['mean']:.3f}, Δn = {ph['sd']:.2f} > Poisson's {math.sqrt(ph['mean']):.2f}")
    check('0.083 rad' in ro, f'the phase noise reads 0.083 rad ({ro[-200:]})')
    set_slider(b, '#sq-box', 'angle', 0)
    ph2 = b.eval('__app.photons()')
    check(abs(ph2['sd'] - math.sqrt(9 * 0.25 + 0.5 * math.sinh(2 * math.log(2)) ** 2)) < 1e-3 and ph2['sd'] < math.sqrt(ph2['mean']), f"amplitude-squeezed: Δn = {ph2['sd']:.2f}, sub-Poissonian")
    check(abs(ph['sd'] - 6.1) < 0.06 and abs(ph2['sd'] - 2.0) < 0.06 and abs(math.sqrt(ph['mean']) - 3.1) < 0.05, 'the help\'s 6.1, 2.0 and 3.1')
    run(b, 'loss', 1)
    ro = b.eval("document.querySelector('#readout').innerText"); ph = b.eval('__app.photons()')
    check('10.0 dB' in ro and '0.550' in ro and '2.6 dB' in ro and ph['P'][1] > 0.05, f'10 dB through 50% loss: V = 0.550, 2.6 dB; odd numbers appear (P(1) = {ph["P"][1]:.3f})')
    set_slider(b, '#sq-box', 'squeezing', 1.5)
    ro = b.eval("document.querySelector('#readout').innerText")
    check('2.8 dB' in ro, 'r = 1.5 through 50% loss: still 2.8 dB')
    st = b.eval('__app.base()')
    check(abs(4 * st['s11'] - (0.5 * math.exp(-3) + 0.5)) < 1e-12, 'V = η e^{−2r} + 1 − η')
    b.screenshot('build/qo-loss.png')

    # ---- 3 · Homodyne
    run(b, 'quadrature', 1)
    r = b.eval('__app.reading()')
    check(abs(r['mean'] - 2) < 1e-12 and abs(r['variance'] - 0.25) < 1e-12 and abs(r['db']) < 1e-9, 'θ = 0 reads X1: mean 2, variance 1/4, 0 dB')
    rec = b.eval('__app.record()')
    bin0 = next(x for x in rec if x['theta'] < 0.1)
    check(bin0['n'] > 1000 and abs(bin0['mean'] - 2) < 0.05 and abs(bin0['variance'] - 0.25) < 0.03, f"measured at θ = 0: {bin0['n']} samples, mean {bin0['mean']:.3f}, variance {bin0['variance']:.4f}")
    b.eval('__app.setTheta(90); __app.step(1/30, 30)')
    r = b.eval('__app.reading()')
    check(abs(r['mean']) < 1e-12 and abs(r['variance'] - 0.25) < 1e-12, 'θ = 90° reads X2: mean 0, the same noise')
    h = b.eval('__app.histogram()')
    check(h['max'] > 100 and abs(h['centers'][h['counts'].index(h['max'])]) < 0.3, 'the histogram along the axis peaks at the mean')
    # Drag the axis in the plane.
    box = b.box('#plane'); o = b.eval('__app.pixelOf(0, 0)'); q = b.eval('__app.pixelOf(3, 3)')
    b.drag('#plane', (o[0] / box[2], o[1] / box[3]), (q[0] / box[2], q[1] / box[3]), steps=5); b.eval('__app.step(0, 1)')
    check(abs(b.eval('__app.state.theta') - 45) < 1.5, f"dragging in the plane turns the LO's axis to the pointer ({b.eval('__app.state.theta'):.1f}°)")
    # Click on the noise plot sets θ too.
    vb = b.box('#variance'); b.click('#variance', (0.5, 0.5)); b.eval('__app.step(0, 1)')
    check(150 < b.eval('__app.state.theta') < 210, f"a click on the noise plot sets θ ({b.eval('__app.state.theta'):.0f}°)")
    run(b, 'scan', 0.1)
    check(b.eval('__app.state.motor') == 'scan', 'the motor is on')
    th0 = b.eval('__app.state.theta'); b.eval('__app.step(0.1, 10)'); th1 = b.eval('__app.state.theta')
    check(abs(th1 - th0 - 30) < 1e-6, f'the motor turns the LO 30° per second ({th0:.1f} -> {th1:.1f} in 1 s)')
    b.eval('__app.step(1/30, 12 * 30)')     # a full turn
    rec = b.eval('__app.record()')
    def near(t): return [x for x in rec if abs(x['theta'] - t) < 0.06]
    lo = min(10 * math.log10(4 * x['variance']) for x in near(0) + near(math.pi)); hi = max(10 * math.log10(4 * x['variance']) for x in near(math.pi / 2) + near(3 * math.pi / 2))
    check(len(rec) >= 170 and -7.5 < lo < -4.5 and 4.5 < hi < 7.5, f'the scan finds the squeezing: {lo:.1f} dB at 0°/180°, {hi:.1f} dB at 90°/270° ({len(rec)} bins)')
    th = b.eval('(() => { const out = []; for (let t = 0; t < 360; t += 5) { __app.state.theta = t; out.push(__app.reading().db); } return out; })()')
    check(abs(min(th) + 6.02) < 0.01 and abs(max(th) - 6.02) < 0.01, f'the theory curve runs from {min(th):.2f} to {max(th):.2f} dB')
    b.screenshot('build/qo-scan.png')
    set_slider(b, '#sq-box', 'loss', 50)
    b.eval('__app.state.theta = 0; __app.step(0, 1)')
    check(abs(b.eval('__app.reading()')['db'] + 2.04) < 0.02, f"with 50% loss the dip fills in to {b.eval('__app.reading()')['db']:.2f} dB")
    run(b, 'phaseshift', 1)
    pm = b.eval('__app.phase()')
    check(abs(pm['shift'] - 3 * math.sin(0.1)) < 1e-12 and abs(pm['noise'] - 0.5) < 1e-12 and abs(pm['snr'] - 0.599) < 2e-3 and abs(pm['minimum'] - 1 / 6) < 1e-12,
          f"a shift of 0.1 rad on |α| = 3: the mean moves {pm['shift']:.3f}, noise {pm['noise']:.3f}, SNR {pm['snr']:.2f}, Δφ_min = {pm['minimum']:.3f} rad (the SQL)")
    rec = b.eval('__app.record()'); b90 = next(x for x in rec if abs(x['theta'] - math.pi / 2) < 0.06)
    check(abs(b90['mean'] - 0.2995) < 0.03, f"measured mean at 90°: {b90['mean']:.3f}")
    b.eval("[...document.querySelectorAll('#sq-presets button')].find((x) => x.textContent === 'Across it').click(); __app.step(1/30, 30)")
    pm = b.eval('__app.phase()'); s = b.eval('__app.state')
    check(abs(s['r'] - math.log(2)) < 1e-9 and s['psi'] == 90 and abs(pm['noise'] - 0.268) < 1e-3 and abs(pm['snr'] - 1.12) < 0.01 and abs(pm['minimum'] - 0.0833) < 1e-3,
          f"phase-squeezed by 6 dB: noise {pm['noise']:.3f}, SNR {pm['snr']:.2f}, Δφ_min = {pm['minimum']:.4f} rad: below the SQL")
    b.eval('__app.setTheta(0); __app.step(0, 1)')
    check(abs(b.eval('__app.reading()')['db'] - 6.0) < 0.1, f"the price: at θ = 0 the noise is {b.eval('__app.reading()')['db']:.1f} dB above the vacuum's")
    b.screenshot('build/qo-phaseshift.png')

    # ---- 4 · LIGO
    run(b, 'darkport')
    n = b.eval('__app.noise(100)'); fs = b.eval('__app.sqlFrequency()')
    check(abs(math.sqrt(n['shot']) - 2.73e-24) < 0.01e-24 and abs(math.sqrt(n['total']) - 3.06e-24) < 0.01e-24 and abs(fs - 48) < 0.6,
          f"400 kW: shot noise {math.sqrt(n['shot']):.3e}, total {math.sqrt(n['total']):.3e} /√Hz at 100 Hz; the SQL touched at {fs:.1f} Hz")
    check(abs(math.sqrt(n['shot'] * n['rp']) - n['sql'] / 2) < 1e-6 * n['sql'], 'shot × radiation pressure = (h_SQL²/2)²')
    ro = b.eval("document.querySelector('#readout').innerText")
    check('2.73' in ro and '3.06' in ro and '48 Hz' in ro and '4.0 × 10⁻¹⁸ m' in ro and '4.7 × 10⁻¹¹ rad' in ro, 'the read-out quotes 2.73, 3.06, 48 Hz, 4.0e−18 m and 4.7e−11 rad')
    b.eval("document.querySelector('#more-ligo').open = true")
    set_slider(b, '#ifo-box', 'arm power', 1600)
    n4 = b.eval('__app.noise(100)')
    check(abs(n4['shot'] / n['shot'] - 0.25) < 1e-9 and abs(n4['rp'] / n['rp'] - 4) < 1e-9, '4 times the power: shot noise power down 4, radiation pressure up 4')
    run(b, 'inject')
    n1k = b.eval('__app.noise(1000)')
    gain = -10 * math.log10(n1k['shot'] / n1k['vacuum']['shot'])
    check(abs(gain - 2.9) < 0.05, f'6 dB through 35% loss: shot noise down {gain:.2f} dB at 1 kHz')
    ro = b.eval("document.querySelector('#readout').innerText")
    check('2.9 dB' in ro, 'the read-out says 2.9 dB')
    run(b, 'radiation')
    n10 = b.eval('__app.noise(10)'); n1k = b.eval('__app.noise(1000)'); fs = b.eval('__app.sqlFrequency()')
    check(abs(10 * math.log10(n10['rp'] / n10['vacuum']['rp']) - 10) < 1e-6 and abs(10 * math.log10(n1k['shot'] / n1k['vacuum']['shot']) + 10) < 1e-6,
          '10 dB phase-squeezed: radiation pressure up 10 dB at 10 Hz, shot noise down 10 dB at 1 kHz')
    low = b.eval(f'__app.noise({fs / 3})'); high = b.eval(f'__app.noise({fs * 3})')
    check(low['quantum'] > low['vacuum']['quantum'] and high['quantum'] < high['vacuum']['quantum'], f'worse below {fs:.0f} Hz, better above it')
    set_slider(b, '#ligo-box', 'angle', 0)
    n10b = b.eval('__app.noise(10)')
    check(n10b['rp'] < n10['vacuum']['rp'] and b.eval('__app.noise(1000)')['shot'] > n1k['vacuum']['shot'], 'amplitude squeezing: the opposite trade')
    run(b, 'fdsqz')
    ratios = [b.eval(f'(() => {{ const n = __app.noise({f}); return n.quantum / n.vacuum.quantum; }})()') for f in (8, 30, 48, 100, 1000)]
    check(all(abs(x - 0.1) < 1e-6 for x in ratios), 'frequency-dependent 10 dB: the quantum noise is a tenth at every frequency')
    check(b.eval('__app.state.sq.fd') and b.eval("document.querySelector('#fd-row button').getAttribute('aria-pressed')") == 'true', 'the filter cavity is on')
    set_slider(b, '#ligo-box', 'loss', 20)
    g = -10 * math.log10(b.eval('(() => { const n = __app.noise(2000); return n.shot / n.vacuum.shot; })()'))
    check(abs(g - 5.5) < 0.05, f'with 20% loss the gain is {g:.2f} dB at high frequency')
    run(b, 'chirp')
    ch = b.eval('__app.chirp()'); r = b.eval('__app.snr()')
    check(abs(ch['mc'] - 1.2188) < 1e-3 and abs(ch['fisco'] - 1570) < 5 and abs(ch['tc'] - 5.6) < 0.05 and ch['fmin'] == 70, f"two neutron stars at 40 Mpc: {ch['tc']:.2f} s from 70 Hz to the ISCO at {ch['fisco']:.0f} Hz")
    check(abs(r['without'] - 72) < 1 and abs(r['with'] - 104) < 1.5 and abs(r['ratio'] - 1.44) < 0.01 and abs(r['ratio'] ** 3 - 3.0) < 0.05,
          f"ρ = {r['without']:.1f} without squeezing, {r['with']:.1f} with 6 dB frequency-dependent through 20% loss: {r['ratio']:.2f} times as far, {r['ratio'] ** 3:.1f} times the volume")
    check(abs(r['rangeWithout'] - 360) < 5 and abs(r['rangeWith'] - 520) < 5, f"reach at ρ = 8: {r['rangeWithout']:.0f} Mpc without, {r['rangeWith']:.0f} with")
    ro = b.eval("document.querySelector('#readout').innerText")
    check('72.3' in ro and '104.' in ro and '1.44' in ro and '3.00' in ro, 'the read-out quotes ρ = 72.3 and 104, 1.44 times, 3.00 times the volume')
    # The SNR by the page's binned spectrum against the closed form (the unit tests check the FFT).
    set_slider(b, '#chirp-box', 'distance', 360)
    r2 = b.eval('__app.snr()')
    check(abs(r2['without'] - 72.3 * 40 / 360) < 0.2, f"at 360 Mpc ρ = {r2['without']:.2f}: the signal falls as 1/d")
    b.eval("[...document.querySelectorAll('#source-row button')].find((x) => x.textContent.startsWith('Two black')).click(); __app.step(0, 1)")
    ch = b.eval('__app.chirp()'); r3 = b.eval('__app.snr()')
    check(abs(ch['tc'] - 6) < 0.3 and abs(ch['fisco'] - 220) < 2 and b.eval('__app.state.distance') == 500 and r3['without'] > 20, f"two black holes at 500 Mpc: {ch['tc']:.1f} s from 20 Hz to {ch['fisco']:.0f} Hz, ρ = {r3['without']:.0f}")
    b.screenshot('build/qo-chirp.png')

    # ---- every experiment's read-out is made of numbers
    bad = []
    for name in names:
        run(b, name, 0.5)
        b.screenshot(f'build/qo-exp-{name}.png')
        text = b.eval("document.querySelector('#readout').textContent")
        slots = b.eval("[...document.querySelectorAll('#readout .fixnum')].map((e) => e.textContent)")
        if 'NaN' in text or 'Infinity' in text or 'undefined' in text or any(t in ('–', '∞', '−∞') for t in slots): bad.append(f'{name}: {text[:120]}')
    check(not bad, 'every experiment\'s read-out is made of numbers' + ('' if not bad else ': ' + ' | '.join(bad)))

    # ---- the read-outs keep still while their numbers change
    alpha = lambda v: (lambda: set_slider(b, '#state-box', 'mean field', v))
    sq = lambda v: (lambda: set_slider(b, '#sq-box', 'squeezing', v))
    theta = lambda v: (lambda: b.eval(f'__app.setTheta({v}); __app.step(1/30, 3)'))
    db = lambda v: (lambda: set_slider(b, '#ligo-box', 'squeezing', v))
    for name, steps in (('coherent', [alpha(v) for v in (0.5, 1.2, 2.7, 3.9, 0.08, 1, 2, 4)] + [lambda: b.eval('__app.step(0.3, 1)')] * 3),
                        ('phasesq', [sq(v) for v in (0.1, 0.4, 0.9, 1.3)]),
                        ('scan', [theta(v) for v in (10, 45, 90, 135, 200, 300)]),
                        ('chirp', [db(v) for v in (1, 3.5, 8, 12, 15)])):
        run(b, name, 0.3)
        worst, compared, seen = keeps_still(b, RO, steps)
        check(worst <= 0.5 and compared >= len(steps) - 3 and len(seen) >= len(steps) // 2,
              f'{name}: the read-out keeps still while its numbers change (largest shift {worst:.1f} px over {compared} of {len(steps)} changes, {len(seen)} readings)')

    # ---- speed: a frame of each animated view
    for name in ('coherent', 'phasesq', 'scan'):
        run(b, name, 0.2)
        ms = b.eval('__app.bench()')
        check(ms < 33, f'{name}: {ms:.1f} ms an animation frame (needs < 33)')

    # ---- the address keeps a set-up
    run(b, 'phasesq', 0.2)
    set_slider(b, '#sq-box', 'angle', 37)
    b.wait("location.hash.includes('psi=37') && location.hash.includes('v=squeeze')", timeout=20)
    b.eval('location.reload()'); b.wait('window.__app && __app.ready', timeout=60)
    s = b.eval('__app.state')
    check(s['view'] == 'squeeze' and s['psi'] == 37 and abs(s['r'] - math.log(2)) < 1e-4 and s['alpha'] == 3, f'reloading the address brings back the view, α and the squeezing ({b.eval("location.hash")[:60]})')
    b.eval("location.hash = '#setup=fdsqz'"); b.wait("__app.state.view === 'ligo' && __app.state.sq.fd", timeout=20)
    check(b.eval('__app.state.sq.dB') == 10, 'typing #setup=fdsqz into the address opens that experiment')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

# Dark, and a phone.
with Browser('quantumoptics/index.html', size=(1400, 900)) as b:
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
    b.wait('window.__app && __app.ready', timeout=90); b.eval('__app.hold(true)')
    for name in ('coherent', 'squeezevac', 'scan', 'inject'):
        run(b, name, 1); b.screenshot(f'build/qo-dark-{name}.png')
    check(b.eval("getComputedStyle(document.body).backgroundColor") != 'rgb(244, 243, 239)', 'dark: the page follows the dark colour scheme')
    run(b, 'vacuum', 0.5); first_screen(b, 'dark')
    hint_ink, bg = b.eval("[getComputedStyle(document.getElementById('hint-mode')).color, getComputedStyle(document.body).backgroundColor]")
    start_ink, start_bg = b.eval("(() => { const s = document.querySelector('#help .start'); const c = getComputedStyle(s); return [c.color, c.backgroundColor]; })()")
    lum = lambda css: sum(int(v) for v in re.findall(r'\d+', css)[:3]) / 3
    check(lum(hint_ink) - lum(bg) > 80 and lum(start_ink) - lum(start_bg) > 80, f'dark: the hint ({hint_ink} on {bg}) and the Start-here block ({start_ink} on {start_bg}) read')

with Browser('quantumoptics/index.html', size=(390, 844)) as b:
    b.wait('window.__app && __app.ready', timeout=90); b.eval('__app.hold(true); __app.step(1/30, 30)')
    b.screenshot('build/qo-phone-start.png')
    first_screen(b, 'phone')
    plane = b.box('#plane-wrap')
    check(plane[1] + plane[3] <= 844 and plane[2] >= 300, f'on a phone the plane is in view without scrolling (bottom at {plane[1] + plane[3]:.0f} px, {plane[2]:.0f} px wide)')
    wide = []
    for name in ('vacuum', 'phasesq', 'scan', 'chirp'):
        run(b, name, 0.5)
        b.screenshot(f'build/qo-phone-{name}.png')
        wide.append(b.eval('document.documentElement.scrollWidth'))
    check(max(wide) <= 390, f'no sideways scrolling on a phone (pages {max(wide)} px wide at most)')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'phone: no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
