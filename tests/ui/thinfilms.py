#!/usr/bin/env python3
"""Drive the thin-films demo like a student: every experiment, checking its physics read-outs
against closed forms; dragging a layer's edge, the plots and the film; links that keep the
set-up; the time each update takes; the phone layout and the dark theme."""
import json, math, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

def point(b):
    return b.eval("(() => { const v = __app.point(); return { Rs: v.s.R, Rp: v.p.R, Ts: v.s.T, Tp: v.p.T, As: v.s.A, Ap: v.p.A, n0: v.st.n0, ns: v.st.ns, nr: [...v.st.nr], d: [...v.st.d] }; })()")

def setup(b, name, wait=0.6):
    b.eval(f'__app.setups[{json.dumps(name)}]()'); b.sleep(wait)

def typed_number(b, selector, value):
    """Type a value into a slider's number box, as a student would."""
    b.eval(f"(() => {{ const e = document.querySelector({json.dumps(selector)}); e.value = {value}; e.dispatchEvent(new Event('change')); }})()")

deg = math.pi / 180

with Browser('thinfilms/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1.0)
    # It opens on a draining soap film: the film thins by itself.
    d0 = b.eval('__app.state.layers[0].d'); h0 = b.eval('__app.state.film.hBottom')
    frames0 = b.eval('(() => { window.__frames = 0; const f = () => { window.__frames++; requestAnimationFrame(f); }; requestAnimationFrame(f); return 0; })()')
    b.sleep(2.0)
    d1 = b.eval('__app.state.layers[0].d'); h1 = b.eval('__app.state.film.hBottom'); fps = b.eval('window.__frames') / 2.0
    check(h1 < h0 and d1 < d0, f'the soap film drains by itself (bottom {h0:.0f} -> {h1:.0f} nm, probe {d0:.0f} -> {d1:.0f} nm), {fps:.0f} frames/s')
    b.screenshot('build/tf-start.png')
    # Later in its life (the bottom 150 nm thick): black at the top, colours below.
    typed_number(b, '#film-box .slider input[type=number]', 150); b.sleep(0.4)
    top = b.eval('__app.comp.filmRGB[0]'); mid = b.eval('__app.comp.filmRGB[90]')
    # (0.2 in gamma-encoded sRGB is about 3% of white.)
    check(b.eval('__app.state.film.hBottom') == 150 and max(top) < 0.2 and max(mid) > 0.6, f'a thinner film: black at the top ({[round(v, 3) for v in top]}), coloured lower down ({[round(v, 2) for v in mid]})')

    # Every experiment, with a screenshot.
    for name in b.eval('Object.keys(__app.setups)'):
        setup(b, name, 0.8)
        b.screenshot(f'build/tf-exp-{name}.png')
        print('      ', name, '|', b.eval("document.getElementById('readouts').innerText").replace('\n', '  '))

    # 1-3. Fresnel and Brewster.
    setup(b, 'fresnel'); p = point(b); n = p['ns'][0]
    check(abs(p['Rs'] - ((n - 1) / (n + 1)) ** 2) < 1e-12 and abs(p['Rs'] - p['Rp']) < 1e-14, f"glass at normal incidence: R = ((n-1)/(n+1))^2 = {p['Rs']:.5f}")
    setup(b, 'brewster'); p = point(b)
    check(p['Rp'] < 1e-8 and abs(b.eval('__app.state.theta') - math.atan(n) / deg) < 0.01, f"Brewster: R_p = {p['Rp']:.1e} at {b.eval('__app.state.theta')} deg")

    # 4. Total internal reflection and the evanescent decay length.
    setup(b, 'tir'); p = point(b)
    th = b.eval('__app.state.theta'); beta = p['n0'] * math.sin(th * deg)
    want = 550 / (2 * math.pi * math.sqrt(beta ** 2 - 1))
    shown = float(b.eval("document.getElementById('readouts').innerText").split('1/e in ')[1].split(' nm')[0])
    check(abs(p['Rs'] - 1) < 1e-12 and abs(p['Rp'] - 1) < 1e-12 and abs(shown - want) < 0.6, f'TIR: R = 1, decay length {shown} nm (formula {want:.1f})')
    # The field in the air decays at that rate.
    E2 = b.eval('(() => { const f = __app.comp.field; return [...f.E2]; })()')
    zr = b.eval('__app.state.layers.length')
    check(zr == 0, 'TIR has no layers')
    # Drag the angle on the angle plot to 70 deg: the decay length shortens.
    b.drag('#ang', (0.5, 0.5), (0.08 + 0.89 * 70 / 90, 0.5), steps=8); b.sleep(0.3)
    th2 = b.eval('__app.state.theta')
    check(60 < th2 < 80, f'dragging across the angle plot sets the angle ({th2})')

    # 5. Frustrated TIR against the barrier formula.
    setup(b, 'ftir'); p = point(b)
    n1 = p['n0']; beta = n1 * math.sin(45 * deg); q1 = math.sqrt(n1 ** 2 - beta ** 2); kap = math.sqrt(beta ** 2 - 1); k0 = 2 * math.pi / 550
    Tw = 1 / (1 + 0.25 * (q1 / kap + kap / q1) ** 2 * math.sinh(k0 * kap * 200) ** 2)
    check(abs(p['Ts'] - Tw) < 1e-12, f"FTIR: T_s = {p['Ts']:.6f} through 200 nm of air (barrier formula {Tw:.6f})")
    # Drag the gap's right edge on the drawing of the stack: it widens, and T falls.
    x, y, w, h = b.box('#stack')
    zl, zh, left, right = b.eval('(() => { const r = __app.zRange(); return [r[0], r[1], 46, document.getElementById("stack").getBoundingClientRect().width - 12]; })()')
    X = lambda z: x + left + (z - zl) / (zh - zl) * (right - left)
    b.mouse('mouseMoved', X(200), y + 31); b.mouse('mousePressed', X(200), y + 31, 1, 'left')
    for i in range(1, 9): b.mouse('mouseMoved', X(200 + 15 * i), y + 31 + i, 1, 'left')
    b.mouse('mouseReleased', X(320), y + 39, 0, 'left'); b.sleep(0.3)
    d = b.eval('__app.state.layers[0].d'); p2 = point(b)
    check(300 < d < 340 and p2['Ts'] < p['Ts'] / 2, f"dragging the gap's edge widens it to {d} nm; T_s falls from {p['Ts']:.4f} to {p2['Ts']:.4f}")

    # 7. The antireflection coating.
    setup(b, 'ar'); p = point(b)
    n0, n1v, n2 = 1, p['nr'][0], p['ns'][0]
    Rw = ((n0 * n2 - n1v ** 2) / (n0 * n2 + n1v ** 2)) ** 2
    check(abs(p['Rs'] - Rw) < 1e-6, f"AR coating: R = {p['Rs'] * 100:.3f}% (quarter-wave formula {Rw * 100:.3f}%)")
    sw = b.eval('__app.comp.swatch.R')
    check(sw[0] > sw[1] and sw[2] > sw[1], f'its reflection is purple: {[round(v, 2) for v in sw]}')

    # 8. The Bragg mirror's peak reflectance; more pairs, more reflection.
    setup(b, 'bragg'); p = point(b)
    nH, nL, ns = p['nr'][0], p['nr'][1], p['ns'][0]
    # (HL)^5 H on the substrate: Y = nH^2 (nL/nH)^(2*5) / ns ... computed by the quarter-wave rule.
    Y = ns
    for nj in reversed(p['nr']): Y = nj ** 2 / Y
    Rw = ((1 - Y) / (1 + Y)) ** 2
    check(abs(p['Rs'] - Rw) < 1e-6, f"Bragg mirror (HL)^5 H: R = {p['Rs']:.6f} (quarter-wave rule {Rw:.6f})")
    typed_number(b, '#design-sliders .slider:nth-child(2) input[type=number]', 8); b.sleep(0.4)
    p8 = point(b)
    check(b.eval('__app.state.layers.length') == 17 and p8['Rs'] > p['Rs'], f"N = 8 pairs: 17 layers, R = {p8['Rs']:.7f}")

    # 9-10. Filter and etalon readouts.
    setup(b, 'filter'); F = b.eval('__app.comp.finesse')
    check(F is not None and abs(F['peak'] - 550) < 1 and F['Tmax'] > 0.9, f"the filter's line: {F and round(F['peak'], 2)} nm, T = {F and round(F['Tmax'], 3)}, {F and round(F['fwhm'], 2)} nm wide")
    setup(b, 'etalon'); F = b.eval('__app.comp.finesse')
    check(F is not None and F.get('F') and 0.85 < F['spacing'] / (550 ** 2 / 4000) < 1.05, f"the etalon: peaks every {F and round(F['spacing'], 1)} nm (lambda^2/2d = {550 ** 2 / 4000:.1f}), finesse {F and round(F.get('F', 0), 1)}")

    # 11-12. Metals.
    setup(b, 'silver'); p = point(b); sw = b.eval('__app.comp.swatch.R')
    check(p['Rs'] > 0.94 and max(sw) - min(sw) < 0.06, f"silver: R = {p['Rs']:.3f}, a neutral colour {[round(v, 2) for v in sw]}")
    setup(b, 'gold'); swR = b.eval('__app.comp.swatch.R'); swT = b.eval('__app.comp.swatch.T')
    check(swR[0] > swR[1] > swR[2] and swT[1] > swT[0], f'gold reflects yellow {[round(v, 2) for v in swR]} and lets through green-blue {[round(v, 2) for v in swT]}')

    # 13. The plasmon dip, and how it moves with the water's index.
    setup(b, 'spr'); m1 = b.eval('__app.comp.rpMin')
    typed_number(b, '#typed-box .params input[type=number]', 1.343); b.sleep(0.5)
    m2 = b.eval('__app.comp.rpMin')
    check(abs(m1['theta'] - 74.81) < 0.05 and abs(m2['theta'] - 76.53) < 0.05, f"plasmon dip at {m1['theta']:.2f} deg for n = 1.333, {m2['theta']:.2f} for 1.343 (Python: 74.81, 76.53)")
    # Its field: piled up on the gold's far side, many times the incoming wave.
    setup(b, 'spr'); b.sleep(0.3)
    peak = b.eval('Math.max(...__app.comp.field.E2)')
    check(peak > 5, f'at the dip the field at the gold-water surface is {peak:.1f} times the incoming |E|^2')
    # The address keeps the set-up: change n, reload from the address alone.
    typed_number(b, '#typed-box .params input[type=number]', 1.343); b.sleep(1.0)
    url = b.eval('location.hash')
    b.goto('thinfilms/index.html' + url); b.wait('window.__app && __app.ready'); b.sleep(0.6)
    m3 = b.eval('__app.comp.rpMin')
    check(m3 and abs(m3['theta'] - m2['theta']) < 1e-6, f'a link to the set-up restores it (dip at {m3 and round(m3["theta"], 2)} deg)')

    # The spectrum plot: drag to choose the wavelength.
    b.drag('#spec', (0.5, 0.5), (0.2, 0.5), steps=6); b.sleep(0.3)
    lam = b.eval('__app.state.lambda')
    check(450 < lam < 600, f'dragging across the spectrum sets the wavelength ({lam} nm)')

    # Clicking the film picture chooses a thickness there.
    setup(b, 'oil'); b.click('#film', (0.4, 0.5)); b.sleep(0.3)
    d = b.eval('__app.state.layers[0].d')
    check(500 < d < 700, f'clicking half-way down the oil wedge (0 to 1200 nm) gives {d} nm')

    # The computing time of one update while dragging a thickness, the wavelength or the angle
    # (each part is kept until something it depends on changes).  Drawing comes on top; this
    # headless browser draws without a GPU, so its frame rate says little about a laptop's.
    drag_js = ("(kind) => { const s = __app.state; let total = 0;"
               " for (let i = 0; i < 12; i++) {"
               "  if (kind === 'd') s.layers[s.sel >= 0 && s.sel < s.layers.length ? s.sel : 0].d += 0.37;"
               "  if (kind === 'lambda') s.lambda += 0.37;"
               "  if (kind === 'theta') s.theta += 0.11;"
               "  const t0 = performance.now(); __app.compute(); total += performance.now() - t0; }"
               " return total / 12; }")
    times = {}
    for name in ['soap', 'bragg', 'filter', 'etalon', 'spr']:
        setup(b, name, 0.3)
        for kind in ['d', 'lambda', 'theta']:
            times[f'{name}/{kind}'] = b.eval(f'({drag_js})({json.dumps(kind)})')
    worst = max(times.values())
    check(worst < 30, f'an update takes at most {worst:.1f} ms: ' + ', '.join(f'{k} {v:.1f}' for k, v in times.items()))

    # A Bragg mirror of 41 layers: drag an edge on the drawing.
    setup(b, 'bragg'); typed_number(b, '#design-sliders .slider:nth-child(2) input[type=number]', 20); b.sleep(0.4)
    check(b.eval('__app.state.layers.length') == 41, 'N = 20: 41 layers')
    b.drag('#stack', (0.5, 0.06), (0.52, 0.06), steps=30, pause=0.03)
    b.sleep(0.2)

    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

# The phone layout, and the dark theme.
with Browser('thinfilms/index.html#setup=soap', size=(400, 850)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1.0)
    b.screenshot('build/tf-phone.png')
    wide = b.eval('document.documentElement.scrollWidth')
    check(wide <= 400, f'no sideways scrolling on a phone (page {wide} px wide)')
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
    b.goto('thinfilms/index.html#setup=bragg'); b.wait('window.__app && __app.ready'); b.sleep(0.8)
    b.screenshot('build/tf-phone-dark.png')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions on the phone' + ('' if not errors else ': ' + '; '.join(errors[:3])))

print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
