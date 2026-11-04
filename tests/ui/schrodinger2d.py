#!/usr/bin/env python3
"""Drive the 2D scattering demo: run collisions to the end and check the scattering theory, the
numbers the help quotes, and the first screen (the hint, the worded readouts, the drawer's shape).

Each collision is finished by __app.runUntil(), which takes the animation's own steps at once:
the checks don't wait on the clock, so a slow or loaded computer only makes them take longer."""
import json, os, re, sys, time, traceback
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

def section(name, fn, b):
    """Run one group of checks; an error in it is a failure with a message, not the end."""
    try:
        fn(b)
    except Exception as e:
        check(False, f'{name}: {type(e).__name__}: {e}')
        traceback.print_exc(limit=2)

def finish(b, what):
    """Run the current collision to its end; False (and a failure) if it didn't get there."""
    t0 = time.time()
    b.eval('__app.runUntil()')
    done = b.eval('__app.finished')
    print(f"note  {what}: t = {b.eval('__app.sim.t'):.1f} (nominal end {b.eval('__app.tEnd'):.1f}), {time.time() - t0:.1f} s of wall time")
    check(done, f'{what}: the collision ran to its end')
    return done

def setup(b, name):
    b.eval(f'__app.setups[{json.dumps(name)}]()')

def set_potential(b, source, params):
    """Type a potential and its parameters into the target's field, and let the demo restart."""
    b.eval(f"document.querySelector('#v-field .expr').set({json.dumps(source)}, {json.dumps(params)})")
    b.sleep(0.4)

def window(b, centre, half, which='Psc'):
    """Probability through the detector within centre +- half degrees (the packet holds 1)."""
    return b.eval(f"""(() => {{ const d = __app.detector, P = d[{json.dumps(which)}], dth = 2 * Math.PI / d.M; let s = 0;
      for (let j = 0; j < d.M; j++) {{ const a = ((d.theta[j] * 180 / Math.PI - {centre}) % 360 + 540) % 360 - 180; if (Math.abs(a) <= {half}) s += P[j] * dth; }}
      return s; }})()""")

def totals(b):
    """The table's totals: flux, shadow, partial waves, optical theorem, Born, exact."""
    return b.eval("""(() => { const d = __app.detector, tot = d.totals(), pw = __app.pw, dth = 2 * Math.PI / d.M;
      return { flux: tot.scattered, shadow: tot.shadow, pw: pw && pw.sigma, optical: pw && pw.optical,
        born: __app.born && __app.born.reduce((s, v) => s + v * dth, 0), exact: __app.exact && __app.exact.pw.sigma }; })()""")

def sin2(b, m, which='waves'):
    """sin^2 delta_m from the movie's partial waves ('waves') or the radial equation ('exact')."""
    return b.eval(f"""(() => {{ const w = {'__app.waves' if which == 'waves' else '__app.exact && __app.exact.waves'}; if (!w) return null;
      const x = w.find((q) => q.m === {m}); return ((x.Sre - 1) ** 2 + x.Sim ** 2) / 4; }})()""")

def absS(b, m):
    return b.eval(f"(() => {{ const x = __app.waves.find((q) => q.m === {m}); return Math.hypot(x.Sre, x.Sim); }})()")

def text(b, sel):
    return b.eval(f"(document.querySelector({sel!r}) || {{textContent: ''}}).textContent.trim()")

def rgb(s):
    return [float(v) for v in re.findall(r'[\d.]+', s)[:3]]

def contrast(b, sel):
    """How far the text colour of the first element matching sel is from the page's background
    (the sum over the channels, 0..765): a readable hint or block is well above 150."""
    fg, bg = b.eval(f"""(() => {{ const e = document.querySelector({sel!r});
        return [getComputedStyle(e).color, getComputedStyle(document.body).backgroundColor]; }})()""")
    return sum(abs(x - y) for x, y in zip(rgb(fg), rgb(bg)))

def readouts(b):
    """The live readouts don't move while their numbers change: fixed slots, fixed decimals."""
    setup(b, 'disk')
    # The left edges of the readouts, and the top edges of the table's rows (which are all there
    # from the start, the values still to come shown as such).
    where = ("[...[...document.querySelectorAll('#readouts .ro')].map(e => e.getBoundingClientRect().left),"
             " ...[...document.querySelectorAll('#sigmas tr')].map(e => e.getBoundingClientRect().top),"
             " ...[...document.querySelectorAll('#q-readout .fixnum')].flatMap(e => [e.getBoundingClientRect().left, e.getBoundingClientRect().top])].map(v => Math.round(v * 10) / 10)")
    seen, ts = [], []
    # Through t = 10 (a digit more), to the end (the box empties, "done" appears), and over a
    # few animation frames of the next run.
    for t in (1, 9.9, 10.1, 20, None):
        b.eval(f'__app.runUntil({"" if t is None else t})')
        seen.append(b.eval(where)); ts.append(b.eval('__app.sim.t'))
    setup(b, 'disk'); b.eval('__app.state.speed = 8')
    for _ in range(6):
        b.sleep(0.25)
        seen.append(b.eval(where)); ts.append(b.eval('__app.sim.t'))
    moved = [i for i in range(1, len(seen)) if seen[i] != seen[0]]
    check(len(seen[0]) >= 16 and not moved, f"readouts stay put over t = {', '.join(f'{t:.1f}' for t in ts)}"
          + ('' if not moved else f': moved at t = {ts[moved[0]]:.2f}, {seen[0]} -> {seen[moved[0]]}'))

def first_screen(b):
    """The first screen: a hint under the picture, readouts in words, legends that name the curves."""
    setup(b, 'disk')
    hint = text(b, '#view-hint')
    check(hint.startswith('Watch the packet') and 'Target' in hint and 'Scattered only' in hint and 'detector' in hint
          and b.eval("document.getElementById('view-hint').classList.contains('hint')"), f'a hint under the picture says what to do: "{hint[:70]}…"')
    g = b.eval("""(() => { const v = document.querySelector('.view-wrap').getBoundingClientRect(), h = document.getElementById('view-hint').getBoundingClientRect();
        return { below: h.top >= v.bottom - 1 && h.top < v.bottom + 30, visible: h.height > 0 && h.bottom <= innerHeight }; })()""")
    check(g['below'] and g['visible'], 'the hint sits directly under the picture, on screen')
    check(contrast(b, '#view-hint') > 150, f"the hint reads against the light background (contrast {contrast(b, '#view-hint'):.0f})")
    ro = text(b, '#readouts')
    check(all(w in ro for w in ('time t', 'momentum k₀', 'wavelength λ', 'energy E', 'probability in the box', 'time step')),
          f'the readouts carry words beside their symbols: "{ro[:90]}…"')
    legend = text(b, '#xs-legend')
    check(all(w in legend for w in ('measured', 'partial waves at k₀', 'Born', 'exact at k₀', 'classical')), f'the cross-section legend names its curves: "{legend}"')
    pwl = b.eval("document.querySelector('.pw-wrap').parentElement.querySelector('.panel-head .muted').textContent")
    check('green ticks: exact' in pwl and 'must be 1' in pwl, f'the partial-wave legend names the ticks and the dots: "{pwl}"')
    glosses = b.eval("[...document.querySelectorAll('.panel-gloss')].map((e) => e.textContent)")
    check(len(glosses) == 3 and all(w in glosses[0] for w in ('measured (blue)', "Born's |Ṽ(k − k₀)|²", 'point at the circle', 'momentum transfer q = k − k₀'))
          and glosses[1].startswith('dσ/dθ') and 'phase shift' in glosses[2], f'the momentum, cross-section and partial-wave panels carry a gloss: {glosses}')
    q = text(b, '#q-readout')
    check(all(w in q for w in ('angle θ', '60°', 'momentum transfer q = 2k₀ sin(θ/2) =', '2.000', 'dσ/dθ there: measured', 'Born')),
          f'under the momentum picture, the angle, q and dσ/dθ there, in words: "{q}"')
    check(text(b, '#mom-note').startswith('the wave sorted by momentum'), f'the momentum panel says what it shows: "{text(b, "#mom-note")}"')
    # In the dark theme too.
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
    b.sleep(0.3)
    dark = contrast(b, '#view-hint')
    b.click('#help-button'); b.sleep(0.4)
    dark_start = contrast(b, '.drawer .start p')
    b.key('Escape')
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'light'}])
    b.sleep(0.3)
    check(dark > 150 and dark_start > 150, f'the hint and the Start-here block read in the dark theme too (contrasts {dark:.0f}, {dark_start:.0f})')

def drawer(b):
    """The drawer opens with Start here in plain words, then the experiments, then the theory with
    its equations; the terms are glossed where they first appear."""
    d = b.eval("""(() => { const dr = document.getElementById('help'), kids = [...dr.children].filter((e) => e.tagName !== 'HEADER');
      const exps = [...dr.querySelectorAll('.exp')], start = dr.querySelector('section.start'), theory = dr.querySelector('section.theory');
      return { first: kids[0] === start, h3: start && start.querySelector('h3').textContent, math: start ? start.querySelectorAll('math').length : -1,
        words: start ? start.textContent.trim().split(/\\s+/).length : 0,
        firstExp: exps[0] && exps[0].dataset.setup, n: exps.length, buttons: exps.filter((e) => e.querySelector('button.setup')).length,
        theoryLast: kids[kids.length - 1] === theory, theoryAfter: theory && exps.every((e) => e.compareDocumentPosition(theory) & Node.DOCUMENT_POSITION_FOLLOWING),
        setups: exps.map((e) => e.dataset.setup).filter((s) => !window.__app.setups[s]), equations: theory ? theory.querySelectorAll('math').length : 0,
        glossed: [...dr.querySelectorAll('.exp em')].map((e) => e.textContent.trim()) }; })()""")
    check(d['first'] and d['h3'] == 'Start here' and d['math'] == 0 and 60 < d['words'] < 220, f"the drawer opens with a Start-here block in plain words ({d['words']} words, no equations)")
    check(d['firstExp'] == 'disk' and d['n'] == 14 and d['buttons'] == 14 and not d['setups'], f"{d['n']} experiments, the first the opening state, each with a Set-it-up button and a set-up ({d['firstExp']})")
    check(d['theoryLast'] and d['theoryAfter'] and d['equations'] >= 10, f"the theory comes last, with its equations kept ({d['equations']} pieces of mathematics)")
    terms = ['differential cross section', 'optical theorem', 'first Born approximation', 'momentum transfer', 'partial wave', 'phase shift', 'S-matrix',
             'unitarity', 'reciprocal lattice', "Ewald's construction", "Fraunhofer's", 'impact parameter', 'extinction paradox']
    missing = [t for t in terms if not any(g.startswith(t) for g in d['glossed'])]
    check(not missing, 'the terms are glossed on first use' + ('' if not missing else f': missing {missing}'))
    b.click('#help-button'); b.sleep(0.5)
    b.screenshot('build/s2d-help.png')
    check(b.eval("document.getElementById('help').classList.contains('open')") and contrast(b, '.drawer .start p') > 150, 'the drawer opens and its Start-here block is readable')
    b.key('Escape')

def disk(b):
    # The default hard disk: the optical theorem, and three totals that agree; the numbers the help quotes.
    setup(b, 'disk')
    if not finish(b, 'hard disk'): return
    tot = totals(b)
    check(bool(tot['pw']), 'hard disk: partial waves once the packet has gone')
    if tot['pw']:
        check(abs(tot['optical'] / tot['pw'] - 1) < 0.03, f"optical theorem: {tot['optical']:.4f} vs partial waves {tot['pw']:.4f}")
        check(abs(tot['flux'] / tot['pw'] - 1) < 0.06, f"flux {tot['flux']:.4f} vs partial waves {tot['pw']:.4f}")
        check(abs(tot['exact'] / tot['pw'] - 1) < 0.03, f"the radial equation {tot['exact']:.4f} vs partial waves {tot['pw']:.4f}")
    check(abs(tot['shadow'] / tot['flux'] - 1) < 0.02, f"shadow {tot['shadow']:.4f} = scattered {tot['flux']:.4f}")
    # Help: sigma = 8.3, more than half of it within 40 degrees of forward (4.4); Born's 294 is 35 times too big.
    fwd = window(b, 0, 40) / b.eval('__app.detector.fluence')
    check(8.1 < tot['flux'] < 8.5 and 0.5 < fwd / tot['flux'] < 0.58, f"help: sigma = 8.3 ({tot['flux']:.2f}), 4.4 of it within 40 degrees of forward ({fwd:.2f})")
    check(30 < tot['born'] / tot['flux'] < 40, f"help: Born's total {tot['born']:.0f} is 35 times the measured ({tot['born'] / tot['flux']:.1f})")
    worst = max(abs(absS(b, m) - 1) for m in range(-6, 7))
    check(worst < 0.01, f'|S_m| = 1 to {worst:.4f} for |m| <= 6')
    # Classical particles bounce off where V = E: r = a + w ln(V0/E - 1) = 1.77, a hard disk 2r wide.
    c = b.eval("""(() => { const c = __app.classical, d = __app.detector, M = d.M, row = [...document.querySelectorAll('#sigmas tr')].find((r) => r.textContent.startsWith('classical'));
      return c && { r: c.r, back: c.dsdt[M / 2], at90: c.dsdt[M / 4], fwd: c.dsdt[0], row: row && row.textContent, meas180: d.crossSection()[M / 2] }; })()""")
    if not c:
        check(False, 'the hard disk has a classical curve')
    else:
        r = 1.5 + 0.25 * __import__('math').log(8 / 2 - 1)
        check(abs(c['r'] - r) < 1e-9 and abs(c['back'] - r / 2) < 1e-9 and abs(c['at90'] - r / 2 * 0.5 ** 0.5) < 1e-9 and c['fwd'] == 0,
              f"classical: r = a + w ln(V0/E - 1) = {c['r']:.3f}, (r/2)|sin(θ/2)|: {c['fwd']:.3f} forward, {c['at90']:.3f} at 90°, {c['back']:.3f} back")
        check(c['row'] and c['row'].endswith('3.549'), f"the table's classical line is 2r = 3.549: \"{c['row']}\"")
        check(abs(tot['flux'] / (2 * c['r']) - 2.34) < 0.05 and abs(c['meas180'] - 0.73) < 0.015,
              f"help: σ is 2.3 times the classical 3.55 ({tot['flux'] / (2 * c['r']):.2f}); straight back the wave sends 0.73 ({c['meas180']:.3f})")
    b.screenshot('build/s2d-disk-done.png')

def swave(b):
    # A slow packet (the s-wave experiment) in its bigger box: four ways to the total cross section,
    # and the help's partial-wave numbers.
    setup(b, 'swave')
    check(b.eval('__app.state.speed') == 6, 'the slow packet plays faster, since it runs on until its tail has gone')
    if not finish(b, 'slow packet'): return
    tot = totals(b)
    exact = b.eval("(() => { const rows = [...document.querySelectorAll('#sigmas tr')].map(r => r.textContent); return rows.find(r => r.startsWith('exact')); })()")
    ev = float(exact.split(':')[-1].replace('the radial equation', '').strip()) if exact else None
    if not (tot['pw'] and ev):
        check(False, f"slow packet: partial waves ({bool(tot['pw'])}) and the exact row ({exact!r}) once the packet has gone")
        return
    print(f"note  slow packet: flux {tot['flux']:.4f}, partial waves {tot['pw']:.4f}, optical {tot['optical']:.4f}, exact {ev}")
    check(abs(tot['optical'] / tot['pw'] - 1) < 0.05 and abs(tot['flux'] / tot['pw'] - 1) < 0.1 and abs(ev / tot['pw'] - 1) < 0.05,
          'slow packet: flux, partial waves, optical theorem and the radial equation agree')
    s0, s1, s2 = sin2(b, 0), sin2(b, 1), sin2(b, 2)
    check(s0 > 0.99 and 0.1 < s1 < 0.2 and s2 < 0.01, f'help: sin^2 delta_0 = 0.998 ({s0:.3f}), delta_1 0.16 ({s1:.3f}), m = 2 nothing ({s2:.4f})')
    r = b.eval('(() => { const s = __app.detector.crossSection(); return s[0] / s[__app.detector.M / 2]; })()')
    check(2 < r < 4, f'help: forward only three times backward ({r:.2f})')
    # Sped up to k0 = 2: m = +-1 the strongest, near its unitarity limit, and forward seven times backward.
    b.eval('__app.state.k0 = 2; __app.restart(); __app.runUntil()')
    s1, r = sin2(b, 1), b.eval('(() => { const s = __app.detector.crossSection(); return s[0] / s[__app.detector.M / 2]; })()')
    check(s1 > 0.93 and 5 < r < 9, f'help, k0 = 2: sin^2 delta_1 = 0.96 ({s1:.3f}), forward seven times backward ({r:.2f})')

def bump(b):
    # The bump of the Born experiment: a sixth of the packet scattered, Born 7% above the exact
    # answer; and the help's V0 = 2 and V0 = -1 numbers.
    setup(b, 'born')
    if not finish(b, 'bump'): return
    p = window(b, 0, 180); p60 = window(b, 0, 60); tot = totals(b)
    check(0.15 < p < 0.21, f'bump: {p:.3f} of the packet scattered (V0 = {b.eval("__app.state.target.params.V0")})')
    check(p60 / p > 0.93, f'bump: {p60 / p:.3f} of the scattering within 60 degrees of forward')
    check(1.04 < tot['born'] / tot['exact'] < 1.09, f"bump: Born's total {tot['born']:.3f} is 6% above the exact {tot['exact']:.3f}")
    check(abs(tot['flux'] / tot['exact'] - 1) < 0.04, f"bump: measured {tot['flux']:.3f} against exact {tot['exact']:.3f}")
    e1 = tot['exact']
    b.screenshot('build/s2d-bump-done.png')
    set_potential(b, 'V0 exp(-r^2/(2 a^2))', {'V0': 2, 'a': 1}); b.eval('__app.runUntil()')
    tot = totals(b)
    check(1.55 < tot['born'] / tot['exact'] < 1.75 and 2.4 < tot['exact'] / e1 < 2.8,
          f"V0 = 2: the cross section grows 2.6 times ({tot['exact'] / e1:.2f}), Born 65% too high ({tot['born'] / tot['exact']:.2f})")
    set_potential(b, 'V0 exp(-r^2/(2 a^2))', {'V0': -1, 'a': 1}); b.eval('__app.runUntil()')
    tot = totals(b)
    check(2.44 < tot['exact'] < 2.52 and 2.63 < e1 < 2.71, f"help, V0 = -1: exact 2.48 ({tot['exact']:.2f}) against 2.67 ({e1:.2f}) for V0 = 1")

def momentum_circle(b):
    """Born's dσ/dθ and the measured one round the momentum circle; q = k − k0 at the chosen angle."""
    setup(b, 'ring')
    if not finish(b, 'bump, scattered view'): return
    rd = lambda a: b.eval(f'__app.setAngle({a})')
    # The bump's closed form: m^2 |V~(q)|^2 / (2 pi k), V~ = 2 pi a^2 V0 exp(-q^2 a^2 / 2), a = V0 = 1, k = 2.
    import math
    born = lambda t: 2 * math.pi * math.exp(-(4 * math.sin(math.radians(t) / 2)) ** 2) / 2
    worst = max(abs(rd(t)['born'] / born(t) - 1) for t in (0, 15, 30, 45, 60, -60))
    check(worst < 0.01, f"the readout's Born dσ/dθ is the bump's transform at q = 2k₀ sin(θ/2), to {worst:.4f}")
    r30, r60 = rd(30), rd(60)
    check(abs(r60['q'] - 2) < 1e-9 and abs(rd(90)['q'] - 2 * 2 ** 0.5) < 1e-9 and abs(rd(180)['q'] - 4) < 1e-9, 'q = 2k₀ sin(θ/2): k₀ at 60°, 2k₀ straight back')
    check(abs(r30['measured'] - 1.07) < 0.03 and abs(r30['born'] - 1.08) < 0.01 and abs(r60['measured'] - 0.171) < 0.006 and abs(r60['born'] - 0.058) < 0.001,
          f"help: at 30° measured 1.07 and Born 1.08 ({r30['measured']:.3f}, {r30['born']:.3f}); at 60°, 0.171 and 0.058 ({r60['measured']:.3f}, {r60['born']:.4f})")
    rd(60); txt = text(b, '#q-readout')
    check('60°' in txt and '2.000' in txt and '0.171' in txt and '0.058' in txt, f'the readout shows them: "{txt}"')
    cur = b.eval('(() => { const c = __app.momentumCurves(); return { top: c.top, born: Math.max(...c.born), meas: Math.max(...c.measured) }; })()')
    check(abs(cur['top'] - max(cur['born'], cur['meas'])) < 1e-12 and cur['born'] / cur['meas'] < 1.3, f"both curves on one scale, the larger's peak at the top ({cur})")
    # The pointer turns k: a point straight up from the centre is 90 degrees.
    box = b.box('#momentum')
    b.mouse('mouseMoved', box[0] + box[2] / 2, box[1] + box[3] * 0.2)
    b.sleep(0.2)
    a = b.eval('__app.state.qAngle')
    check(a == 90 and '2.828' in text(b, '#q-readout'), f"the pointer above the centre sets θ = 90° ({a}) and q = 2.828: \"{text(b, '#q-readout')}\"")
    b.mouse('mouseMoved', box[0] + box[2] * 0.52, box[1] + box[3] * 0.51)   # near the centre: no change
    b.sleep(0.2)
    check(b.eval('__app.state.qAngle') == 90, 'near the centre the pointer leaves k alone')
    b.screenshot('build/s2d-momentum.png', '.analysis .panel')
    # Where Born fails: twice too high at V0 = 2, fifty times for the hard disk, and nothing behind it.
    set_potential(b, 'V0 exp(-r^2/(2 a^2))', {'V0': 2, 'a': 1}); b.eval('__app.runUntil()')
    r0 = rd(0)
    check(abs(r0['born'] - 4 * math.pi) < 0.01 and abs(r0['measured'] - 5.53) < 0.1, f"help, V0 = 2: Born 12.6 straight ahead against 5.53 ({r0['born']:.2f}, {r0['measured']:.2f})")
    b.eval("document.querySelector('#targets button').click()"); b.sleep(0.2); b.eval('__app.state.view = "scattered"; __app.runUntil()')
    r0, r180 = rd(0), rd(180)
    check(abs(r0['born'] - 303) < 3 and abs(r0['measured'] - 5.66) < 0.1 and 45 < r0['born'] / r0['measured'] < 60,
          f"help, the hard disk: Born's lobe fifty times the measured, 303 against 5.66 ({r0['born']:.1f}, {r0['measured']:.2f})")
    check(abs(r180['born'] - 0.136) < 0.005 and abs(r180['measured'] - 0.73) < 0.015, f"help: straight back Born 0.14 against 0.73 ({r180['born']:.3f}, {r180['measured']:.3f})")
    b.eval('__app.setAngle(60)')
    b.screenshot('build/s2d-momentum-disk.png', '.analysis .panel')


def classical(b):
    """The bigger, harder disk at a shorter wave: classical at large angles, the forward peak, twice 2r."""
    setup(b, 'classical')
    if not finish(b, 'classical'): return
    c = b.eval("""(() => { const d = __app.detector, M = d.M, s = d.crossSection(), cl = __app.classical, dth = 2 * Math.PI / M, f = d.fluence;
      const deg = (j) => Math.abs(((d.theta[j] * 180 / Math.PI + 180) % 360) - 180);
      const win = (lo, hi, g) => { let a = 0; for (let j = 0; j < M; j++) if (deg(j) >= lo && deg(j) <= hi) a += g[j] * dth; return a; };
      return { r: cl.r, flux: d.totals().scattered, k: __app.state.k0, fwd: win(0, 30, s), rest: win(30, 180, s), b90: win(90, 180, s), c90: win(90, 180, cl.dsdt),
        c30: win(0, 30, cl.dsdt), exact: __app.exact.pw.sigma, optical: __app.pw.optical }; })()""")
    r = 2.5 + 0.15 * __import__('math').log(15 / 4.5 - 1)
    print(f"note  classical: r {c['r']:.3f}, sigma {c['flux']:.3f} (exact {c['exact']:.3f}, optical {c['optical']:.3f}), 2r {2 * c['r']:.3f}; within 30 deg {c['fwd']:.3f}, beyond {c['rest']:.3f}; beyond 90: {c['b90']:.3f} against {c['c90']:.3f}")
    check(abs(c['r'] - r) < 1e-9 and abs(c['r'] - 2.63) < 0.005 and abs(2 * c['r'] - 5.25) < 0.01 and abs(c['k'] * c['r'] - 8) < 0.15,
          f"help: r = 2.63 where V = E, 2r = 5.25, kr ≈ 8 ({c['r']:.3f}, {2 * c['r']:.3f}, {c['k'] * c['r']:.2f})")
    check(abs(c['b90'] - 3.71) < 0.05 and abs(c['c90'] - 3.74) < 0.01, f"help: beyond 90° the wave and the particles hold 3.71 and 3.74 ({c['b90']:.3f}, {c['c90']:.3f})")
    check(abs(c['fwd'] - 5.7) < 0.1 and abs(c['fwd'] / c['rest'] - 1) < 0.05 and abs(c['c30'] - 0.18) < 0.005,
          f"help: within ±30° a peak of 5.7, as much as everywhere else ({c['fwd']:.2f}, {c['rest']:.2f}), where the particles send 0.18 ({c['c30']:.3f})")
    check(abs(c['flux'] - 11.4) < 0.1 and abs(c['flux'] / (2 * c['r']) - 2.2) < 0.05 and abs(c['exact'] / c['flux'] - 1) < 0.03,
          f"help: σ = 11.4, 2.2 times 2r ({c['flux']:.2f}, {c['flux'] / (2 * c['r']):.2f}; exact {c['exact']:.2f})")
    b.screenshot('build/s2d-classical-done.png')
    # Over the top of the wall no classical curve: V0 below E.
    set_potential(b, 'V0/(1 + exp((r - a)/w))', {'V0': 4, 'a': 2.5, 'w': 0.15})
    check(b.eval('__app.classical') is None and 'classical' not in text(b, '#xs-legend'), 'no classical curve when the packet can go over the wall (V0 < E)')


def resonance(b):
    # The attractive well: the m = +-3 wave through pi/2 just below k0; the run goes on until the
    # well has emptied, so that |S_3| is 1.
    setup(b, 'resonance')
    if not finish(b, 'resonance'): return
    t, tEnd = b.eval('__app.sim.t'), b.eval('__app.tEnd')
    check(1.1 * tEnd < t < 1.5 * tEnd, f'the run goes on past the nominal end until the well has emptied ({t / tEnd:.2f} of it)')
    s3, e3, S3 = sin2(b, 3), sin2(b, 3, 'exact'), absS(b, 3)
    check(0.8 < e3 < 0.9 and abs(s3 - e3) < 0.03 and S3 > 0.99, f'help: sin^2 delta_3 = 0.85 at k0 ({e3:.3f}; movie {s3:.3f}), |S_3| = 1 ({S3:.3f})')
    cross = b.eval("""(async () => { const m = await import('./sim.js'); const ex = __app.parse(__app.state.target.V), p = __app.state.target.params;
      const Vr = (r) => ex.evaluate({ r, x: r, y: new Float64Array(r.length), theta: new Float64Array(r.length), ...p }, r.length).re;
      const s2 = (k) => { const w = m.radialWaves(Vr, k, 4).find((q) => q.m === 3); return ((w.Sre - 1) ** 2 + w.Sim ** 2) / 4; };
      let best = 0, at = 0; for (let k = 0.8; k <= 1.2; k += 0.01) { const v = s2(k); if (v > best) { best = v; at = k; } }
      return { at, best, low: s2(0.8) }; })()""")
    check(0.95 < cross['at'] < 1.1 and cross['best'] > 0.99 and cross['low'] < 0.15,
          f"help: the m = 3 phase shift passes pi/2 at k = 1.0 (sin^2 = 1 at k = {cross['at']:.2f}, {cross['low']:.2f} at 0.8)")

def coulomb(b):
    # The screened Coulomb potential: the partial waves give the forward peak, the flux on the
    # detector circle has not yet formed it (the far field of the long tail begins beyond R);
    # with a shorter screening length it has.
    setup(b, 'coulomb')
    if not finish(b, 'screened Coulomb'): return
    r = b.eval("""(() => { const s = __app.detector.crossSection(), f = __app.pw.f, e = __app.exact.pw.f, M = __app.detector.M;
      return { flux0: s[0], pw0: f[0][0] ** 2 + f[0][1] ** 2, exact0: e[0][0] ** 2 + e[0][1] ** 2, back: s[M / 2], l: __app.state.target.params.l }; })()""")
    check(0.9 < r['pw0'] / r['exact0'] < 1.1, f"the partial waves give the forward peak: {r['pw0']:.1f} against the exact {r['exact0']:.1f}")
    check(r['flux0'] / r['exact0'] < 0.6 and r['flux0'] / r['back'] > 200,
          f"on the detector circle the forward peak is not yet formed ({r['flux0']:.1f}), but hundreds of times the backward ({r['flux0'] / r['back']:.0f})")
    set_potential(b, 'Z exp(-r/l)/sqrt(r^2 + 0.25)', {'Z': 1, 'l': 1}); b.eval('__app.runUntil()')
    r2 = b.eval("""(() => { const s = __app.detector.crossSection(), e = __app.exact.pw.f; return { flux0: s[0], exact0: e[0][0] ** 2 + e[0][1] ** 2 }; })()""")
    check(r2['flux0'] / r2['exact0'] > 0.85, f"help: with the screening length 1 the peak forms inside the circle: {r2['flux0']:.2f} against {r2['exact0']:.2f}")

def two(b):
    # Two disks: fringes every lambda/d = 36 degrees.
    setup(b, 'two')
    if not finish(b, 'two disks'): return
    peaks = b.eval("""(() => { const d = __app.detector, s = Array.from(d.crossSection()), deg = (j) => ((d.theta[j] * 180 / Math.PI + 180) % 360) - 180;
      return [...s.keys()].filter((j) => s[j] > s[(j + 1) % d.M] && s[j] > s[(j + d.M - 1) % d.M] && s[j] > 0.02 * Math.max(...s)).map(deg).sort((a, b) => a - b); })()""")
    want = [-141, -83, -37, 0, 37, 83, 141]
    ok = len(peaks) >= 7 and all(any(abs(p - w) < 4 for p in peaks) for w in want)
    check(ok, f'help: fringes at 0, ±37, ±83, ±141 degrees ({[round(p) for p in peaks]})')

def slits(b):
    # The double slit: Fraunhofer's prediction over the whole far half circle, -90 to 90 degrees,
    # with the measured fringes where it puts them; and more gets through than the openings' width.
    setup(b, 'slits')
    if not finish(b, 'double slit'): return
    r = b.eval("""(() => { const d = __app.detector, s = __app.slit.dsdt, deg = (j) => ((d.theta[j] * 180 / Math.PI + 180) % 360) - 180, dth = 2 * Math.PI / d.M;
      const on = [...s.keys()].filter((j) => s[j] > 0).map(deg), meas = [...d.Ptot].map((v, j) => Math.abs(deg(j)) < 90 ? v / d.fluence : 0);
      // The bright fringes: local maxima of each curve between 10 and 80 degrees.
      const peaks = (f) => [...f.keys()].filter((j) => Math.abs(deg(j)) > 10 && Math.abs(deg(j)) < 80 && f[j] > f[(j + 1) % d.M] && f[j] > f[(j + d.M - 1) % d.M] && f[j] > 0.05 * Math.max(...f)).map(deg);
      const dips = (f) => [...f.keys()].filter((j) => Math.abs(deg(j)) < 30 && f[j] < f[(j + 1) % d.M] && f[j] < f[(j + d.M - 1) % d.M]).map(deg);
      return { lo: Math.min(...on), hi: Math.max(...on), at89: s[Math.round(89 / 360 * d.M)], pp: peaks([...s]), pm: peaks(meas), dm: dips(meas),
        through: meas.reduce((a, v) => a + v * dth, 0), open: __app.slit.open, blind: __app.slit.blind.filter(Boolean).length }; })()""")
    print(f"note  double slit: prediction from {r['lo']:.1f} to {r['hi']:.1f} degrees; fringes predicted {[round(x, 1) for x in r['pp']]}, "
          f"measured {[round(x, 1) for x in r['pm']]}; dark at {[round(x, 1) for x in r['dm']]}; {r['blind']} detector angles inside the wall")
    check(r['lo'] < -88 and r['hi'] > 88 and r['at89'] > 0, 'double slit: the prediction spans -90 to 90 degrees')
    check(len(r['pp']) == len(r['pm']) == 2 and all(abs(p - q) < 4 for p, q in zip(sorted(r['pp']), sorted(r['pm']))),
          'double slit: the measured fringes are where Fraunhofer puts them')
    check(all(abs(abs(x) - 17) < 2 for x in r['dm']) and len(r['dm']) == 2, f"help: dark fringes measured at ±17 degrees ({[round(x, 1) for x in r['dm']]})")
    check(2.8 < r['through'] < 3.2 and abs(r['open'] - 2.4) < 0.02, f"help: 3.0 gets through ({r['through']:.2f}) against the openings' width 2.4 ({r['open']:.2f})")
    b.screenshot('build/s2d-slits-done.png')

def crystal(b):
    # The crystal: at the Bragg angle a reflected beam at twice it; turned away from it, hardly any.
    frac = {}
    for name in ('crystal', 'offbragg'):
        setup(b, name)
        if not finish(b, name): return
        a = b.eval('__app.state.turn')
        frac[name] = window(b, 2 * a, 15)
        print(f"note  {name}: turned {a} degrees, {frac[name]:.3f} of the packet within 15 degrees of {2 * a} degrees")
        b.screenshot(f'build/s2d-{name}-done.png')
        if name == 'crystal':
            # The help: the momentum transfer to the Bragg beam at 60 degrees is G = 2 pi / c, the
            # lattice point (n1, n2) = (0, 1) turned by 30 degrees.
            q = b.eval('__app.setAngle(60)')['q']
            check(abs(q - 3.1416) < 1e-3 and '3.142' in text(b, '#q-readout'), f'help: at 60° the momentum transfer is 2k₀ sin α = 2π/c = 3.142 ({q:.4f})')
    check(frac['crystal'] > 0.2 and frac['crystal'] > 4 * frac['offbragg'],
          f"Bragg: {frac['crystal']:.3f} reflected at the Bragg angle, {frac['offbragg']:.3f} off it")
    check(0.24 < frac['crystal'] < 0.29 and 0.035 < frac['offbragg'] < 0.055, 'help: 26% at the Bragg angle, 4.5% at 20 degrees')
    # Shortening the wavelength until 2c sin(20) = lambda: k0 = 4.6, the beam to 40 degrees.
    b.eval('__app.state.k0 = 4.6; __app.restart(); __app.runUntil()')
    f40 = window(b, 40, 15)
    check(0.15 < f40 < 0.22, f'help: at k0 = 4.6 the crystal at 20 degrees reflects 18% to 40 degrees ({f40:.3f})')

def experiments(b):
    # Every experiment, half way through its collision.
    for name in b.eval('Object.keys(__app.setups)'):
        setup(b, name)
        b.eval('__app.runUntil(0.55 * __app.tEnd)')
        b.screenshot(f'build/s2d-exp-{name}.png')
        print(f"note  {name}: t = {b.eval('__app.sim.t'):.1f}")

def phone(b):
    # On a phone the hint is on the first screen, under the picture.
    b.call('Emulation.setDeviceMetricsOverride', width=400, height=800, deviceScaleFactor=1, mobile=True)
    b.sleep(0.5)
    setup(b, 'disk')
    g = b.eval("""(() => { const v = document.querySelector('.view-wrap').getBoundingClientRect(), h = document.getElementById('view-hint').getBoundingClientRect();
        return { below: h.top >= v.bottom - 1, onScreen: h.bottom <= innerHeight, width: h.width, inner: innerWidth, scroll: document.documentElement.scrollWidth }; })()""")
    check(g['below'] and g['onScreen'] and g['scroll'] <= g['inner'], f"phone: the hint is under the picture on the first screen, no sideways scroll ({g})")
    b.screenshot('build/s2d-phone.png')
    b.call('Emulation.setDeviceMetricsOverride', width=1500, height=1000, deviceScaleFactor=1, mobile=False)

with Browser('schrodinger2d/index.html', size=(1500, 1000)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1)
    b.screenshot('build/s2d-start.png')
    for name, fn in [('first screen', first_screen), ('drawer', drawer), ('readouts', readouts), ('hard disk', disk), ('slow packet', swave),
                     ('bump', bump), ('momentum circle', momentum_circle), ('classical', classical), ('resonance', resonance), ('screened Coulomb', coulomb), ('two disks', two), ('double slit', slits),
                     ('crystal', crystal), ('experiments', experiments), ('phone', phone)]:
        section(name, fn, b)
    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
