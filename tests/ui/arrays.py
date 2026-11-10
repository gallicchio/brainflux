#!/usr/bin/env python3
"""Drive the antenna-array demo: every experiment, dragging, the address; check the physics
read-outs as it goes; the pointers to the radio-interferometer demo, and the redirect of the old
aperture-synthesis addresses to it; screenshots in build/."""
import json, math, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

# Where the words and number slots of some readouts are, to check that they keep still: each word
# (not the numbers) by its readout, the readout's words and its place among them; each number slot
# likewise.  Layouts are compared word by word where the wording is the same.
LAYOUT = r"""((sel) => { const out = {};
  for (const e of document.querySelectorAll(sel)) {
    if (!e.getClientRects().length) continue;       // (not shown)
    const walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT), words = []; let n;
    while ((n = walk.nextNode())) {
      if (n.parentElement.closest('.fixnum')) continue;
      for (const m of n.textContent.matchAll(/[^\s\d.,:;()−+-]+/g)) {
        const g = document.createRange(); g.setStart(n, m.index); g.setEnd(n, m.index + m[0].length);
        const r = g.getBoundingClientRect(); words.push([m[0], r.left, r.top]);
      }
    }
    const shape = (e.id || e.tagName) + '|' + words.map((w) => w[0]).join(' ');
    words.forEach(([w, x, y], k) => { out[`${shape}|${k}`] = [x, y]; });
    e.querySelectorAll('.fixnum').forEach((s, i) => { const r = s.getBoundingClientRect(); out[`${shape}|slot${i}`] = [r.left, r.top, r.width]; });
  }
  return out; })"""
def track(base, now, tol=0.5):
    """What in the layout now moved by more than tol px from where it was first seen (in base)."""
    moved = [(k.split('|')[0], k.split('|')[-1], round(max(abs(x - y) for x, y in zip(base[k], p)), 1)) for k, p in now.items()
             if k in base and max(abs(x - y) for x, y in zip(base[k], p)) > tol]
    for k, p in now.items(): base.setdefault(k, p)
    return moved

INFO = """(() => { const i = __app.arrays.info, d = 180 / Math.PI;
    return { beam: i.beam === null ? null : i.beam * d, hpbw: i.hpbw === null ? null : i.hpbw * d, sll: i.sll,
             sllAngle: i.sllAngle === null ? null : i.sllAngle * d, D: __app.arrays.D, omni: i.omni }; })()"""
# Type a value into the slider whose label starts with `name`, as a student would.
SET = """((name, v) => { const shown = [...document.querySelectorAll('.slider')].filter((e) => !e.closest('[hidden]'));
    const s = shown.find((e) => e.querySelector('label').textContent.startsWith(name)) || shown.find((e) => e.querySelector('label').textContent.includes(name));
    const box = s.querySelector('input[type=number]'); box.value = v; box.dispatchEvent(new Event('change')); return true; })"""
def setslider(b, name, v):
    b.eval(f'{SET}({json.dumps(name)}, {v})'); b.sleep(0.25)
def click(b, text, within='body'):
    b.eval(f"""[...document.querySelectorAll({json.dumps(within + ' button')})].find((x) => x.textContent.trim() === {json.dumps(text)} && !x.closest('[hidden]')).click()""")
    b.sleep(0.25)
def setup(b, name, wait=0.6):
    b.eval(f'__app.setups[{json.dumps(name)}]()'); b.sleep(wait)
def load(b, page):
    """A fresh page (going to the same address with a new hash would not reload it)."""
    b.call('Page.navigate', url='about:blank'); b.sleep(0.3)
    b.goto(page); b.wait('window.__app && __app.ready'); b.sleep(1)
def errors(b):
    return [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]

# The first screen: the hint (lib/style.css .hint, with its arrow) right under the main picture and
# inside the first screen without scrolling, in both themes; the drawer's "Start here" block.
HINT = """((sel, pics) => { const e = document.querySelector(sel); if (!e || !e.getClientRects().length) return null;
    const r = e.getBoundingClientRect(), gap = Math.min(...pics.map((p) => r.top - document.querySelector(p).getBoundingClientRect().bottom));
    return { text: e.textContent.trim(), cls: e.className, arrow: getComputedStyle(e, '::before').content, gap, top: r.top, bottom: r.bottom, h: innerHeight }; })"""
def hint_check(b, sel, pics, starts, where):
    h = b.eval(f'{HINT}({json.dumps(sel)}, {json.dumps(pics)})')
    check(bool(h) and h['cls'].split()[0] == 'hint' and '→' in h['arrow'] and h['text'].startswith(starts) and 0 <= h['gap'] < 40 and h['bottom'] <= h['h'],
          f'{where}: the hint is in the shared style, {h["gap"]:.0f} px under the picture and inside the first screen ({h["bottom"]:.0f} of {h["h"]} px): "{h["text"][:48]}..."' if h else f'{where}: no hint {sel}')
    return h
# The contrast of an element's text against the background behind it (WCAG ratio).
CONTRAST = """((sel) => { const e = document.querySelector(sel);
    const lum = (c) => { const [r, g, b] = c.match(/[\\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    let bg = 'rgba(0, 0, 0, 0)', p = e; while (p && /rgba\\(0, 0, 0, 0\\)|transparent/.test(bg)) { bg = getComputedStyle(p).backgroundColor; p = p.parentElement; }
    const a = lum(getComputedStyle(e).color), c = lum(bg); return { ratio: (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05), dark: c < 0.2 }; })"""
def contrast_check(b, sel, theme, what):
    r = b.eval(f'{CONTRAST}({json.dumps(sel)})')
    check(r['ratio'] >= 4 and r['dark'] == (theme == 'dark'), f'{theme} theme: {what} reads (contrast {r["ratio"]:.1f}, {"dark" if r["dark"] else "light"} background)')

def uniform_line(n, d, t0=0):
    """Half-power width and first sidelobe of n equal elements d apart, steered to t0 (degrees)."""
    g = lambda psi: (math.sin(n * psi / 2) / (n * math.sin(psi / 2))) ** 2 if abs(math.sin(psi / 2)) > 1e-12 else 1.0
    lo, hi = 1e-9, 2 * math.pi / n
    for _ in range(80):
        m = (lo + hi) / 2
        if g(m) > 0.5: lo = m
        else: hi = m
    s0, k = math.sin(math.radians(t0)), 2 * math.pi
    th = lambda psi: math.degrees(math.asin(max(-1, min(1, s0 + psi / (k * d)))))
    sl = max(g(2 * math.pi / n + i * 1e-5) for i in range(int(2 * math.pi / n / 1e-5)))
    return th(lo) - th(-lo), 10 * math.log10(sl)

with Browser('arrays/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1.2)
    b.screenshot('build/arrays-start.png')
    i = b.eval(INFO)
    check(abs(i['beam'] - 20) < 0.01 and abs(i['D'] - 8) < 1e-6, f"opens steered to 20 degrees with D = N = 8 ({i['beam']:.3f}, {i['D']:.6f})")
    t1 = b.eval('__app.A.t'); b.sleep(0.5); t2 = b.eval('__app.A.t')
    check(t2 > t1, f'the waves are moving (t {t1:.2f} -> {t2:.2f})')
    # The first screen: the hint under the waves, the dB rings glossed, every read-out named in words.
    hint_check(b, '#field-hint', ['#field'], 'Drag an element', 'arrays')
    contrast_check(b, '#field-hint', 'light', 'the hint')
    words = b.eval("document.querySelector('#polar-note').textContent + ' | ' + document.querySelector('#readouts').textContent").replace('\xa0', ' ')
    check('−10 dB is a tenth' in words and 'the line from the centre' in words and 'the red dot' in words and 'isotropic antenna' in words and '13.6° between the half-power' in words,
          f'the dB rings, the beam line, the sidelobe dot and the directivity are explained in words: "{words[:100]}..."')
    # The drawer: "Start here" first (plain words, no equations), experiment 1 the opening state, the theory last.
    d = b.eval("""(() => { const h = document.querySelector('#help'), start = h.querySelector('section.start');
        const order = [...h.querySelectorAll('.exp, #how')].map((e) => e.id || e.dataset.setup);
        return { first: h.querySelector('header').nextElementSibling === start, h3: start && start.querySelector('h3').textContent, math: start ? start.querySelectorAll('math').length : -1,
                 sentences: start ? start.textContent.split(/[.!?]\\s/).length : 0, firstExp: order[0], last: order[order.length - 1], howH3: document.querySelector('#how h3')?.textContent }; })()""")
    check(d['first'] and d['h3'] == 'Start here' and d['math'] == 0 and 3 <= d['sentences'] <= 9 and d['firstExp'] == 'start' and d['last'] == 'how' and d['howH3'] == 'How it works',
          f'the drawer opens with "Start here" ({d["sentences"]} sentences, no equations), experiment 1 is the opening state, and "{d["howH3"]}" comes last')
    b.eval("document.querySelector('#help-button').click()"); b.sleep(0.4)
    contrast_check(b, '#help .start p', 'light', 'the Start-here block')
    contrast_check(b, '#see-also', 'light', 'the See-also line')
    b.key('Escape'); b.sleep(0.3)

    # ---------------------------------------------------------------- the arrays experiments
    setup(b, 'two'); i = b.eval(INFO)
    check(abs(i['hpbw'] - 60) < 0.01 and abs(i['D'] - 2) < 1e-9, f"two elements lambda/2 apart: 60 degrees wide ({i['hpbw']:.3f}), D = 2 ({i['D']:.6f})")
    setup(b, 'endfire'); i = b.eval(INFO)
    check(abs(abs(i['beam']) - 90) < 0.01 and abs(i['hpbw'] - 120) < 0.05, f"end-fire: beam along the line ({i['beam']:.2f}), 120 degrees wide ({i['hpbw']:.2f})")
    setup(b, 'cardioid'); i = b.eval(INFO)
    back = b.eval("(() => { const P = __app.arrays.pattern.total; return P[900] / Math.max(...P); })()")   # theta = -90
    check(abs(i['beam'] - 90) < 0.01 and i['sll'] is None and back < 1e-12, f"the cardioid: one beam at 90 ({i['beam']:.2f}), nothing at -90 ({back:.1e}), 180 degrees wide ({i['hpbw']:.2f})")
    for n in (8, 16):
        setup(b, 'line'); setslider(b, 'N', n); i = b.eval(INFO)
        w, sl = uniform_line(n, 0.5)
        check(abs(i['hpbw'] - w) < 0.02 and abs(i['sll'] - sl) < 0.02 and abs(i['D'] - n) < 1e-6,
              f"N = {n} at lambda/2: width {i['hpbw']:.3f} (closed form {w:.3f}), sidelobe {i['sll']:.3f} dB ({sl:.3f}), D = {i['D']:.4f}")
    setup(b, 'steer')
    for t0 in (30, 60):
        setslider(b, 'θ₀', t0); i = b.eval(INFO); w, _ = uniform_line(16, 0.5, t0)
        check(abs(i['beam'] - t0) < 0.02 and abs(i['hpbw'] - w) < 0.05, f"steered to {t0}: beam {i['beam']:.3f}, width {i['hpbw']:.3f} (closed form {w:.3f})")
    setup(b, 'sweep', 1.0)
    a1 = b.eval('__app.A.theta0'); b.sleep(0.6); a2 = b.eval('__app.A.theta0')
    check(a1 != a2, f'the sweep swings the beam ({a1} -> {a2})')
    # The read-outs keep still: every number in a slot of its own, so that neither its digits nor the
    # words after it move as the beam sweeps, the sliders take numbers of other sizes and signs, and
    # the focus is moved.
    READ = f"{LAYOUT}('#readouts, #selected-label')"         # (the read-outs as a whole: rows of other names may be laid out otherwise)
    setup(b, 'sweep', 0.5)
    base, moved, seen = {}, [], set()
    t0 = time.time()
    while time.time() - t0 < 30 and len(seen) < 8:      # (a loaded machine draws few frames)
        b.sleep(0.2)
        seen.add(b.eval("document.querySelector('#readouts').textContent"))
        moved += track(base, b.eval(READ))
    check(len(seen) >= 4 and not moved, f'the read-outs keep still as the beam sweeps ({len(seen)} readings)' + (f'; moved {moved[:3]}' if moved else ''))
    setup(b, 'steer')
    base, moved = {}, []
    for name, v in (('θ₀', -55), ('θ₀', -4.5), ('θ₀', 0), ('θ₀', 7), ('θ₀', 63), ('N', 4), ('N', 24), ('spacing', 0.31), ('spacing', 0.97), ('θ₀', 30)):
        setslider(b, name, v)
        moved += track(base, b.eval(READ))
    b.eval('__app.A.selected = 3; __app.arraysChanged()'); b.sleep(0.3)
    for x, y in ((-3.25, 0.5), (0.125, -2.75), (2, 0), (-0.5, -0.25)):
        b.eval(f'__app.A.els[3].x = {x}; __app.A.els[3].y = {y}; __app.arraysChanged()'); b.sleep(0.25)
        moved += track(base, b.eval(READ))
    setup(b, 'focus')
    for f in ((0, 0), (-4.5, 3.25), (6, -1), (0.5, 7.5)):
        b.eval(f'__app.A.focus = [{f[0]}, {f[1]}]; __app.arraysChanged()'); b.sleep(0.25)
        moved += track(base, b.eval(READ))
    check(not moved, 'the read-outs keep still as the steering, the number of elements, the spacing, an element and the focus move' + (f'; moved {moved[:3]}' if moved else ''))
    setup(b, 'grating'); i = b.eval(INFO)
    check(i['sll'] < -12, f"0.8 lambda, broadside: no grating lobe (highest sidelobe {i['sll']:.2f} dB)")
    setslider(b, 'θ₀', 30); i = b.eval(INFO)
    g = math.degrees(math.asin(0.5 - 1 / 0.8))
    check(i['sll'] > -0.01 and abs(i['sllAngle'] - g) < 0.15, f"steered to 30: a grating lobe at {i['sllAngle']:.2f} (sin theta = sin theta0 - lambda/d: {g:.2f}), {i['sll']:.4f} dB")
    check('grating lobe' in b.eval("document.querySelector('#readouts').textContent"), 'the read-out calls it a grating lobe')
    setslider(b, 'spacing', 0.64); i = b.eval(INFO)
    check(i['sll'] < -3, f"d = 0.64 < lambda / (1 + sin 30) = 0.667: the lobe is gone ({i['sll']:.2f} dB)")
    b.screenshot('build/arrays-grating-30.png')
    setup(b, 'taper')
    sl = {}
    for t in ('Uniform', 'Binomial', 'Hann', 'Taylor', 'Chebyshev'):
        click(b, t, '#tapers'); sl[t] = b.eval(INFO)
    check(abs(sl['Chebyshev']['sll'] + 30) < 0.02 and abs(sl['Taylor']['sll'] + 30) < 0.5 and sl['Hann']['sll'] < -30 and sl['Binomial']['sll'] is None,
          'tapers: ' + ', '.join(f"{t} {v['sll'] if v['sll'] is None else round(v['sll'], 2)} dB / {v['hpbw']:.2f} deg" for t, v in sl.items()))
    check(sl['Uniform']['hpbw'] < sl['Chebyshev']['hpbw'] < sl['Taylor']['hpbw'] < sl['Hann']['hpbw'] < sl['Binomial']['hpbw'], 'lower sidelobes cost a wider beam; Chebyshev is the narrowest at -30 dB')
    b.screenshot('build/arrays-taper-chebyshev.png')
    setup(b, 'dipoles'); i0 = b.eval(INFO)
    fac = b.eval("(() => { const p = __app.arrays.pattern; let w = 0; for (let k = 0; k < p.total.length; k++) w = Math.max(w, Math.abs(p.total[k] - p.af[k] * p.ef[k])); return w; })()")
    check(fac < 1e-12 and abs(i0['beam']) < 0.01, f'dipoles: the pattern is the element pattern times the array factor (to {fac:.1e}), beam straight up')
    setslider(b, 'dipole axis', 90); i = b.eval(INFO)
    check(abs(abs(i['beam']) - 50.1) < 0.3 and i['D'] < 1, f"dipoles across the line: lobes at {i['beam']:.1f} and {i['sllAngle']:.1f}, directivity in the plane {i['D']:.3f}")
    setup(b, 'random'); i = b.eval(INFO)
    floor = b.eval("""(() => { const P = __app.arrays.pattern.total, m = P.length, pmax = Math.max(...P), i = __app.arrays.info;
        let s = 0, c = 0; for (let k = 0; k < m; k++) { const t = -Math.PI + 2 * Math.PI * k / m; if (Math.abs(t - i.beam) < 3 * i.hpbw) continue; s += P[k]; c++; }
        return 10 * Math.log10(s / c / pmax); })()""")
    check(abs(floor - 10 * math.log10(1 / 24)) < 2, f'random sparse array: mean sidelobe {floor:.2f} dB, near 1/N = {10 * math.log10(1 / 24):.2f} dB; width {i["hpbw"]:.2f}')
    setup(b, 'focus', 1.0)
    f = b.eval("""(async () => { const m = await import('./antenna.js'); const els = __app.A.els, [fx, fy] = __app.A.focus;
        const [a, c] = m.fieldAt(els, { kind: 'iso' }, fx, fy); const inStep = els.reduce((s, e) => s + e.amp / (m.K * Math.hypot(fx - e.x, fy - e.y)), 0);
        return [Math.hypot(a, c), inStep]; })()""")
    check(abs(f[0] - f[1]) < 1e-12 * f[1], f'focus: every wave arrives in step ({f[0]:.6f} = {f[1]:.6f})')
    # The spot and the focal shift the help quotes, measured by the read-outs from the field.
    def focus_rows():
        rows = b.eval("Object.fromEntries([...document.querySelectorAll('#readouts dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent.replace(/\\s+/g, ' ')]))")
        num = lambda k: float(rows[k].replace('−', '-').split('λ')[0].split()[-1]) if k in rows else None
        return rows, num('Spot'), num('Brightest')
    rows, dark, shift = focus_rows()
    helptext = b.eval("document.querySelector('.exp[data-setup=focus]').textContent.replace(/\\s+/g, ' ')")
    check(dark is not None and round(dark, 2) == 0.70 and '0.79 λ' in rows['Spot'] and round(shift, 2) == 0.50 and 'nearer the array' in rows['Brightest']
          and '0.70λ here' in helptext and 'formula’s 0.79λ' in helptext.replace("'", '’') and '33λ for these 24' in helptext,
          f"focus: the spot's dark points {dark} λ either side (formula {rows.get('Spot', '')[-12:]}), the brightest point {shift} λ nearer the array (help: 0.70λ, 0.79λ, half a wavelength; L²/4λ = {11.5 ** 2 / 4:.1f}λ)")
    setslider(b, 'N', 12); b.sleep(0.3)
    rows, dark, shift = focus_rows()
    check(shift is not None and round(shift, 1) == 2.6 and '7.6λ' in helptext and '2.6λ short' in helptext, f"focus with 12 elements: the brightest point is {shift} λ short of the cross (help: 2.6λ; L²/4λ = {5.5 ** 2 / 4:.2f}λ)")
    setup(b, 'focus', 1.0)
    b.drag('#field', (0.5, 0.5), (0.65, 0.4), steps=8); b.sleep(0.4)
    fx, fy = b.eval('__app.A.focus')
    check(abs(fx - 3) < 0.3 and abs(fy - 2) < 0.3, f'dragging the cross moves the focus to ({fx:.2f}, {fy:.2f})')
    b.screenshot('build/arrays-focus-dragged.png')

    # Every experiment gets a picture, with no errors.
    for name in ['two', 'endfire', 'cardioid', 'line', 'steer', 'grating', 'grating2', 'taper', 'dipoles', 'random', 'focus']:
        setup(b, name, 0.8)
        b.screenshot(f'build/arrays-exp-{name}.png')

    # Dragging an element, adding one, the address.
    setup(b, 'line')
    x0 = b.eval('__app.A.els[0].x')
    b.drag('#field', ((x0 + 8) / 16, 0.5), ((x0 + 8) / 16, 0.3), steps=6); b.sleep(0.4)
    y = b.eval('__app.A.els[0].y')
    check(abs(y - 3.2) < 0.2 and b.eval('__app.A.layout') == 'custom', f'dragging an element moves it (y = {y:.2f}) and the layout becomes custom')
    x, yy = b.point('#field', (0.8, 0.8))
    for k in ('mousePressed', 'mouseReleased', 'mousePressed', 'mouseReleased'):
        b.call('Input.dispatchMouseEvent', type=k, x=x, y=yy, button='left', buttons=1 if k == 'mousePressed' else 0, clickCount=2 if k == 'mouseReleased' or True else 1)
    b.sleep(0.4)
    check(b.eval('__app.A.els.length') == 9, f"double-click adds an element ({b.eval('__app.A.els.length')})")
    click(b, 'By hand', '#phase-mode'); b.sleep(0.2)
    b.eval("__app.A.selected = 2"); b.eval("__app.arraysChanged()"); b.sleep(0.3)
    setslider(b, 'phase', 135)
    b.sleep(0.5)
    h = b.eval('location.hash')
    want = b.eval('JSON.stringify(__app.A.els.map((e) => [e.x, e.y, +e.amp.toFixed(3), +(e.phase * 180 / Math.PI).toFixed(1)]))')
    load(b, 'arrays/index.html' + h)
    got = b.eval('JSON.stringify(__app.A.els.map((e) => [e.x, e.y, +e.amp.toFixed(3), +(e.phase * 180 / Math.PI).toFixed(1)]))')
    check(got == want and b.eval('__app.A.phaseMode') == 'manual', 'the address keeps a dragged layout and a hand-set phase')
    b.eval("location.hash = 'setup=cardioid'"); b.sleep(0.8)
    check(abs(b.eval(INFO)['beam'] - 90) < 0.01, 'typing #setup=cardioid into the address sets up the cardioid')
    load(b, 'arrays/index.html#setup=focus')
    check(b.eval('__app.A.phaseMode') == 'focus', 'opening the page at #setup=focus sets up the focusing experiment')
    load(b, 'arrays/index.html#setup=start')
    check(b.eval('[__app.A.n, __app.A.d, __app.A.theta0, __app.A.layout]') == [8, 0.5, 20, 'line'], '#setup=start is the opening view: eight in a line, steered to 20 degrees')

    # ---------------------------------------------------------------- the radio-interferometer demo
    # Aperture synthesis is a demo of its own now: no tab, stage or controls for it here, and the
    # page is "Antenna arrays".
    load(b, 'arrays/index.html')
    v = b.eval("""(() => ({ modeRow: !!document.querySelector('#mode-row'), stage: !!document.querySelector('#synth-stage, #synth-controls, #map, #uv, #clean'),
        tabs: [...document.querySelectorAll('button')].filter((x) => /synthesis/i.test(x.textContent)).length,
        title: document.title, h1: document.querySelector('h1').textContent, desc: document.querySelector('meta[name=description]').content,
        word: /synthesis/i.test(document.body.textContent) }))()""")
    check(not v['modeRow'] and not v['stage'] and v['tabs'] == 0 and not v['word'] and v['h1'] == 'Antenna arrays' and v['title'] == 'Antenna Arrays · BrainFlux' and 'synthesis' not in v['desc'],
          f'no synthesis tab, stage or controls, and the word is gone: the page is "{v["h1"]}" ({v["title"]})')
    # The drawer ends its experiments with a short section on radio interferometers, before "How it
    # works", linking to the new demo; and the pattern has a one-line See also.
    r = b.eval("""(() => { const h = document.querySelector('#help'), s = h.querySelector('#radio'), kids = [...h.children], i = kids.indexOf(s);
        const see = document.querySelector('#see-also');
        return { h3: s && s.querySelector('h3').textContent, link: !!(s && s.querySelector('a[href="../radiointerferometer/"]')), paras: s ? s.querySelectorAll('p').length : 0,
                 text: s ? s.textContent : '', afterLast: i > 0 && kids[i - 1].matches('.exp[data-setup="focus"]'), beforeHow: !!(kids[i + 1] && kids[i + 1].id === 'how'),
                 see: !!(see && see.querySelector('a[href="../radiointerferometer/"]') && see.getClientRects().length), seeText: see ? see.textContent : '' }; })()""")
    check(r['h3'] == 'Radio interferometers' and r['link'] and r['paras'] == 1 and 'run backwards' in r['text'] and 'Fourier transform of the sky' in r['text'] and r['afterLast'] and r['beforeHow'],
          f'after the last experiment, "{r["h3"]}": one paragraph linking to ../radiointerferometer/, before "How it works"')
    check(r['see'] and r['seeText'].startswith('See also'), f'under the pattern, a See-also link to the new demo: "{r["seeText"][:60]}"')
    b.eval("document.querySelector('#help-button').click()"); b.sleep(0.4)
    b.eval("document.querySelector('#radio').scrollIntoView()"); b.sleep(0.3)
    b.screenshot('build/arrays-radio-section.png')
    b.key('Escape'); b.sleep(0.3)
    # A synthesis address typed into the address bar while the page is open goes to the new demo too.
    b.eval("location.hash = 'setup=rotation'")
    b.wait("location.pathname.endsWith('/radiointerferometer/')", timeout=20)
    check(b.eval('location.hash') == '#setup=rotation', 'typing #setup=rotation into the address sends the page to ../radiointerferometer/#setup=rotation')
    load(b, 'arrays/index.html#setup=start')

    # Dark theme: the hints and the Start-here block read.
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
    setup(b, 'start', 1.0)
    contrast_check(b, '#see-also', 'dark', 'the See-also line')
    contrast_check(b, '#field-hint', 'dark', 'the arrays hint')
    b.eval("document.querySelector('#help-button').click()"); b.sleep(0.4)
    contrast_check(b, '#help .start p', 'dark', 'the Start-here block')
    b.screenshot('build/arrays-dark-help.png')
    e = errors(b)
    check(not e, 'no exceptions or console errors' + ('' if not e else ': ' + '; '.join(e[:3])))

# Phone width: the controls go under the pictures, and the hint sits right under the main picture,
# inside the first screen.
with Browser('arrays/index.html', size=(390, 844)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1)
    b.screenshot('build/arrays-phone.png')
    w = b.eval('[document.documentElement.scrollWidth, innerWidth]')
    check(w[0] <= w[1], f'no sideways scrolling at phone width ({w[0]} <= {w[1]})')
    top = b.eval("[document.querySelector('#arrays-controls').getBoundingClientRect().top, document.querySelector('#polar').getBoundingClientRect().bottom]")
    check(top[0] > top[1], 'the controls stack under the pictures')
    hint_check(b, '#field-hint', ['#field'], 'Drag an element', 'phone, arrays')
    e = errors(b)
    check(not e, 'no errors at phone width' + ('' if not e else ': ' + '; '.join(e[:3])))

# The old addresses of the aperture-synthesis view, opened cold: each leaves for the new demo
# before the page starts, keeping its #setup= name (or the saved state, for that demo to honour or
# ignore), and replaces itself in the history, so that Back still works.  (The new demo is a folder
# of its own; whether it exists here does not matter, only where the address goes.)
with Browser('about:blank', size=(1400, 900)) as b:
    # (The address each page arrived at, kept before its own scripts run: the new demo soon
    # writes its state into the address, and a busy machine can read it after that.)
    b.call('Page.addScriptToEvaluateOnNewDocument', source='window.__arrived = location.pathname + location.hash;')
    for h, want in (('#setup=eht', '#setup=eht'), ('#setup=rotation', '#setup=rotation'), ('#setup=resolution', '#setup=resolution'), ('#setup=clean', '#setup=clean'),
                    ('#mode=synth&hours=12&dec=50&sky=double', '#hours=12&dec=50&sky=double'), ('#view=synthesis', '')):
        b.call('Page.navigate', url='about:blank'); b.sleep(0.3)
        n0 = b.eval('history.length')
        b.goto('arrays/index.html' + h)
        try:
            b.wait("location.pathname.endsWith('/radiointerferometer/')", timeout=20); gone = True
        except TimeoutError:
            gone = False
        loc, n1 = b.eval('window.__arrived || location.pathname + location.hash'), b.eval('history.length')
        check(gone and loc.endswith('/radiointerferometer/' + want) and n1 == n0 + 1,
              f'arrays/index.html{h} goes to {loc} ({"replacing itself in the history" if n1 == n0 + 1 else f"history {n0} -> {n1}"})')
    # And a phased-array address stays, with no detour.
    b.call('Page.navigate', url='about:blank'); b.sleep(0.3)
    b.goto('arrays/index.html#setup=steer'); b.wait('window.__app && __app.ready'); b.sleep(0.5)
    loc = b.eval('location.pathname + location.hash')
    check('/arrays/index.html#' in loc and 'th=30' in loc and b.eval('__app.A.n') == 16, f'arrays/index.html#setup=steer stays here, as its state ({loc})')
    e = errors(b)
    check(not e, 'no errors on the way' + ('' if not e else ': ' + '; '.join(e[:3])))

print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
