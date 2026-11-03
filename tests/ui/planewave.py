#!/usr/bin/env python3
"""Drive the plane-wave demo: the first screen and its hint, the drawer (Start here, the
experiments, How it works), the four sign conventions on the picture and the phasor, standing
waves, fringes and beats measured on the canvas, every packet moving at its group velocity, every
number the help quotes, the readouts keeping still, the phone and the dark theme."""
import json, math, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

def near(x, quoted, places):
    """x rounds to the number quoted in the help, to its places of decimals."""
    return abs(x - quoted) <= 0.5 * 10 ** -places + 1e-12

def help_text(b, setup):
    return b.eval(f"document.querySelector('.exp[data-setup={json.dumps(setup)}]').textContent.replace(/\\s+/g, ' ')")

def quoted(b, setup, *numbers):
    """The help for setup quotes each of these numbers (as written)."""
    text = help_text(b, setup)
    missing = [n for n in numbers if n not in text]
    check(not missing, f'experiment {setup}: the help quotes {", ".join(numbers)}' + (f' (missing: {missing})' if missing else ''))

# The brightness of the wave picture along the line through (ox, oy) in direction (ux, uy), in the
# picture's units (-8..8), sampled every `step` from -L to L: [[r, brightness]].
PROFILE = """((ux, uy, ox, oy, L, step) => { const cv = document.querySelector('#wave'), ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, X = 8, out = [], img = ctx.getImageData(0, 0, W, H).data;
  for (let r = -L; r <= L; r += step) {
    const x = ox + r * ux, y = oy + r * uy;
    const px = Math.round((x + X) / (2 * X) * W), py = Math.round((X - y) / (2 * X) * H);
    if (px < 0 || px >= W || py < 0 || py >= H) continue;
    const o = 4 * (py * W + px);
    out.push([r, (img[o] + img[o + 1] + img[o + 2]) / 3]);
  }
  return out; })"""

def dark_bands(prof, window=25):
    """The positions of the dark bands: nearly black points that are the darkest within
    `window` samples either side (a flat black band counts once, at its middle)."""
    out = []
    for i, (r, v) in enumerate(prof):
        if v < 60 and all(v <= prof[j][1] for j in range(max(0, i - window), min(len(prof), i + window + 1))):
            if out and r - out[-1][-1] < 0.5: out[-1].append(r)
            else: out.append([r])
    return [sum(run) / len(run) for run in out]

def spacings(bands):
    return [round(bands[i + 1] - bands[i], 2) for i in range(len(bands) - 1)]

def pause(b):
    b.eval('__app.state.running = false'); b.sleep(0.2)

with Browser('planewave/index.html', size=(1300, 950)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(0.8)
    b.screenshot('build/pw-start.png')
    # The first screen: one wave running, and a hint right under the picture saying what to drag.
    hint = b.eval("""(() => { const h = document.querySelector('#hint'), r = h.getBoundingClientRect(), c = document.querySelector('#wave-wrap').getBoundingClientRect();
        return { text: h.textContent, visible: r.height > 0 && r.bottom <= innerHeight, under: r.top >= c.bottom - 1 && r.top < c.bottom + 16 }; })()""")
    check(b.eval('__app.state.mode') == 'one' and b.eval('__app.state.running') and hint['visible'] and hint['under'] and hint['text'].startswith('Drag the arrow') and 'wavevector k' in hint['text'],
          f"opens on one running wave with a hint right under it: \"{hint['text']}\"")
    # Drag the arrow tip to a new k.
    k_before = b.eval('__app.state.k1')
    b.drag('#wave', (0.5 + 1.2 / 3.2 / 2, 0.5 - 0.5 / 3.2 / 2), (0.5, 0.2), steps=8)
    k_after = b.eval('__app.state.k1')
    check(abs(k_after[0]) < 0.1 and k_after[1] > 1.5, f'dragging the arrow sets k ({k_before} -> {[round(v, 2) for v in k_after]})')
    # Or click anywhere, as the hint says.
    b.click('#wave', (0.25, 0.5))
    k = b.eval('__app.state.k1')
    check(near(k[0], -1.6, 1) and abs(k[1]) < 0.05, f'a click sets k where you click ({[round(v, 2) for v in k]})')
    # The hint follows the mode.
    hints = {}
    for m in ('two', 'packet', 'one'):
        b.eval(f'__app.setMode({json.dumps(m)})'); hints[m] = b.eval("document.querySelector('#hint').textContent")
    check('either arrow' in hints['two'] and 'red dot' in hints['packet'] and 'dispersion relation' in hints['packet'] and hints['one'].startswith('Drag the arrow'),
          f'the hint follows the mode: {[h[:40] for h in hints.values()]}')

    # The drawer: Start here first, in plain words without equations; the ten experiments; the theory last.
    kinds = b.eval("[...document.querySelectorAll('#help > *')].map((e) => e.tagName.toLowerCase() + (e.className ? '.' + e.className.split(' ')[0] : ''))")
    start = b.eval("""(() => { const s = document.querySelector('#help section.start'); return { h: s?.querySelector('h3')?.textContent,
        math: s?.querySelectorAll('math').length, sentences: (s?.textContent.match(/[.!?](\\s|$)/g) || []).length, drag: /drag its tip/i.test(s?.textContent) }; })()""")
    check(kinds[:2] == ['header', 'section.start'] and start['h'] == 'Start here' and start['math'] == 0 and 3 <= start['sentences'] <= 7 and start['drag'],
          f"the drawer begins with a Start here block ({start['sentences']} sentences, no equations, says what to drag)")
    exps = [i for i, k in enumerate(kinds) if k == 'article.exp']
    theory = kinds.index('section.theory') if 'section.theory' in kinds else -1
    how = b.eval("document.querySelector('#help section.theory h3')?.textContent")
    heads = b.eval("[...document.querySelectorAll('#help section.theory b')].map((e) => e.textContent)")
    check(len(exps) == 10 and theory > exps[-1] and how == 'How it works' and any('group velocity' in h for h in heads),
          f'then {len(exps)} experiments, then the theory under "{how}" ({heads})')
    gloss = b.eval("document.querySelector('#dispersion-gloss').textContent")
    check('phase velocity' in gloss and 'group velocity' in gloss and 'dispersive' in gloss, 'phase velocity, group velocity and dispersion are glossed under the Dispersion controls')
    conv_titles = b.eval("[...document.querySelectorAll('#convention button')].map((e) => e.title)")
    check(conv_titles == ['travels along k (physics)', 'travels against k', 'travels along k (engineering, j = −i)', 'travels against k'], f'each of the four forms says which way it goes: {conv_titles}')

    # 1. The four sign conventions, in the model that draws the picture and on the picture itself.
    b.eval('__app.setups.direction()'); pause(b)
    k = b.eval('__app.state.k1'); kk = math.hypot(*k); omega = b.eval('__app.state.omega')
    ux, uy = k[0] / kk, k[1] / kk
    colorOf = "(await import('../lib/complexcolor.js')).colorOf"
    for i in range(4):
        b.eval(f'__app.state.conv = {i}; __app.draw(0.3)')
        cv = b.eval(f'__app.conventions[{i}]')
        vp = (-cv['w'] / cv['s']) * omega / kk      # the crest's velocity along k-hat, from the form
        along = vp > 0
        # A crest at the origin at t = 0 is at vp dt along k-hat at t = dt: the same psi there.
        dt = 0.37
        p0, p1 = b.eval('__app.psiAt(0, 0, 0)'), b.eval(f'__app.psiAt({vp * dt * ux}, {vp * dt * uy}, {dt})')
        same = math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 1e-9
        # The phasor at the origin: clockwise (its argument falling) for e^{-i omega t}.
        a0, a1 = (math.atan2(*reversed(b.eval(f'__app.psiAt(0, 0, {t})'))) for t in (0, 0.1))
        turn = ((a1 - a0 + math.pi) % (2 * math.pi)) - math.pi
        clockwise = turn < 0
        # The picture agrees with the model: a pixel away from the arrow has the colour of psi there.
        x, y = -3 * uy + 2 * ux, 3 * ux + 2 * uy
        pix = b.eval(f"""(async () => {{ const cv = document.querySelector('#wave'), W = cv.width, X = 8;
            const px = Math.round(({x} + X) / (2 * X) * W), py = Math.round((X - {y}) / (2 * X) * cv.height);
            const d = cv.getContext('2d').getImageData(px, py, 1, 1).data, [re, im] = __app.psiAt({x}, {y}, 0.3);
            const c = {colorOf}(re, im, 1); return Math.max(Math.abs(d[0] - c[0]), Math.abs(d[1] - c[1]), Math.abs(d[2] - c[2])); }})()""")
        expect_along = i in (0, 2)
        expect_cw = cv['w'] < 0
        check(same and along == expect_along and clockwise == expect_cw and pix <= 12,
              f"form {i + 1} ({cv['note']}): the crest moves {'along' if along else 'against'} k at {abs(vp):.3f}, the phasor turns {'clockwise' if clockwise else 'anticlockwise'}, the picture matches the model to {pix} of 255")
    quoted(b, 'direction', 'j')
    # The formula line says the crest speed, which is omega / |k|.
    text = b.eval("document.querySelector('#formula').textContent")
    check(f'{omega / kk:.2f}' in text and 'crests move at' in text, f'the line under the picture: "{text.strip()[:90]}"')

    # 4. Standing waves: dark nodes lambda/2 apart along k (measured on a line off the arrows).
    b.eval('__app.setups.standing()'); pause(b); b.eval('__app.draw(0.3)')
    k = b.eval('__app.state.k1'); kk = math.hypot(*k)
    bands = dark_bands(b.eval(f'{PROFILE}(1, 0, 0, 2.5, 7.9, 0.02)'))
    sp = spacings(bands)
    check(b.eval('__app.state.k2') == [-k[0], -k[1]] and len(bands) >= 6 and all(abs(s - math.pi / kk) < 0.06 for s in sp),
          f'standing wave: k2 = -k1, nodes {sp} apart on the picture, lambda/2 = {math.pi / kk:.3f}')
    b.eval('__app.draw(1.1)')
    bands2 = dark_bands(b.eval(f'{PROFILE}(1, 0, 0, 2.5, 7.9, 0.02)'))
    check(len(bands2) == len(bands) and all(abs(a - c) < 0.05 for a, c in zip(bands, bands2)), 'the nodes stay put as time goes on')
    quoted(b, 'standing', '2.09')
    check(near(math.pi / kk, 2.09, 2), f'lambda/2 = {math.pi / kk:.3f} rounds to 2.09')

    # 5. Crossed beams: fringes 2 pi / |k1 - k2| apart along k1 - k2, here 60 degrees, as far apart as the crests.
    b.eval('__app.setups.crossed()'); pause(b); b.eval('__app.draw(0.2)')
    k1, k2 = b.eval('[__app.state.k1, __app.state.k2]')
    d = [k1[0] - k2[0], k1[1] - k2[1]]; dn = math.hypot(*d); u = [d[0] / dn, d[1] / dn]
    angle = math.degrees(math.acos((k1[0] * k2[0] + k1[1] * k2[1]) / (math.hypot(*k1) * math.hypot(*k2))))
    # Along k1 - k2 through a point off the arrows: the perpendicular (k1 + k2) direction, 3 units out.
    s = [k1[0] + k2[0], k1[1] + k2[1]]; sn = math.hypot(*s)
    bands = dark_bands(b.eval(f'{PROFILE}({u[0]}, {u[1]}, {4 * s[0] / sn}, {4 * s[1] / sn}, 7.9, 0.02)'))
    sp = spacings(bands)
    lam = 2 * math.pi / math.hypot(*k1)
    check(near(angle, 60, 6) and len(bands) >= 2 and all(abs(x - 2 * math.pi / dn) < 0.1 for x in sp) and near(2 * math.pi / dn, 4.05, 2) and near(lam, 4.05, 2),
          f'crossed at {angle:.1f} degrees: fringes {sp} apart on the picture, 2 pi / |k1 - k2| = {2 * math.pi / dn:.3f}, lambda = {lam:.3f}')
    quoted(b, 'crossed', '60°', '4.05')

    # 6. Beats: dark bands 2 pi / dk apart, and the whole pattern sliding at c (both waves have omega = c|k|).
    b.eval('__app.setups.beats()'); pause(b); b.eval('__app.draw(0)')
    k1, k2 = b.eval('[__app.state.k1, __app.state.k2]'); c = b.eval('__app.state.c')
    dk = k2[0] - k1[0]
    b0 = dark_bands(b.eval(f'{PROFILE}(1, 0, 0, 2.5, 7.9, 0.02)'))
    b.eval('__app.draw(2)')
    b2 = dark_bands(b.eval(f'{PROFILE}(1, 0, 0, 2.5, 7.9, 0.02)'))
    # Each dark band has moved 2c along in 2 time units (those still in view).
    shift = [min(abs(x - (y + 2 * c)) for x in b2) for y in b0 if y + 2 * c < 7.9] if b2 else [9]
    check(k1[1] == 0 and k2[1] == 0 and len(b0) == 2 and near(b0[1] - b0[0], 2 * math.pi / dk, 1) and near(2 * math.pi / dk, 11.6, 1) and shift and max(shift) < 0.1,
          f'beats: |k| {k1[0]:.2f} and {k2[0]:.2f}, dark bands at {[round(x, 2) for x in b0]} ({2 * math.pi / dk:.2f} apart), and after 2 time units at {[round(x, 2) for x in b2]}: the envelope moves at c = {c}')
    quoted(b, 'beats', '1.20', '1.74', '11.6')

    # The packets: each moves at d omega / dk, the crests at omega / k, in the ratios the help gives.
    ratios = {'schrodinger': 2, 'water': 0.5, 'light': 1}
    for name in b.eval('Object.keys(__app.setups)'):
        b.eval(f'__app.setups[{json.dumps(name)}]()'); b.sleep(1.2)
        b.screenshot(f'build/pw-exp-{name}.png')
        if b.eval('__app.state.mode') == 'packet':
            v = b.eval('__app.velocities()')
            x1, x2 = b.eval('__app.centroid(5)'), b.eval('__app.centroid(15)')
            check(abs((x2 - x1) / 10 - v['vg']) < 0.01 * abs(v['vg']) + 1e-3, f"{name}: the packet moves at dω/dk = {v['vg']:.4f} (measured {(x2 - x1) / 10:.4f}); crests at ω/k = {v['vp']:.4f}")
            if name in ratios:
                check(abs(v['vg'] / v['vp'] - ratios[name]) < 1e-6, f"{name}: group velocity / phase velocity = {v['vg'] / v['vp']:.4f}")
            else:
                check(abs(v['vg'] * v['vp'] - 1) < 1e-6 and v['vp'] > 1 > v['vg'], f"{name}: phase velocity {v['vp']:.4f} > c = 1 > group velocity {v['vg']:.4f}, product {v['vg'] * v['vp']:.4f} = c^2")
            text = b.eval("document.querySelector('#formula').textContent")
            check('a crest, moving at' in text and 'the packet, moving at' in text and f"{v['vp']:.3f}" in text and f"{v['vg']:.3f}" in text, f'{name}: the line under the plots says what moves at what: "{text.strip()[-80:]}"')
    for name, nums in {'schrodinger': ('0.75', '1.5'), 'water': ('0.82', '1.63'), 'light': ('1.000',), 'relativistic': ('1.41', '0.71')}.items():
        b.eval(f'__app.setups[{json.dumps(name)}]()')
        v = b.eval('__app.velocities()')
        quoted(b, name, *nums)
        check(all(near(x, float(n), len(n.split('.')[1])) for x, n in zip(sorted([v['vp'], v['vg']]) if len(nums) == 2 else [v['vp']], sorted(nums, key=float))),
              f'{name}: the quoted velocities are the measured {v["vp"]:.4f} and {v["vg"]:.4f}')
    # A wide spread of wavenumbers, including negative ones, for the Schrödinger relation: every
    # component k runs at its own d omega / dk = k, so the centroid moves at exactly k0.
    b.eval("__app.setups.schrodinger()"); b.sleep(0.2)
    b.eval("""(() => { const [k0, dk] = document.querySelectorAll('#packet-box input[type=number]');
        k0.value = 0.3; k0.dispatchEvent(new Event('change')); dk.value = 0.8; dk.dispatchEvent(new Event('change')); })()""")
    check(abs(b.eval('__app.state.k0') - 0.3) < 1e-9, 'typed k0 = 0.3')
    x1, x2 = b.eval('__app.centroid(5)'), b.eval('__app.centroid(15)')
    check(abs((x2 - x1) / 10 - 0.3) < 0.005, f'a wide packet (Δk = 0.8 about k0 = 0.3, with k < 0 components) moves at dω/dk = k0 = 0.3 (centroid speed {(x2 - x1) / 10:.3f})')

    # The line under the waves keeps still as its numbers change (|k| from 0.05 to 3, so lambda
    # from 126 to 2; omega from 0 to 5): the formula, the words and every number's slot.
    def changed(before, cap=30):
        for _ in range(int(cap / 0.1)):
            now = b.eval("document.querySelector('#formula').textContent")
            if now != before: return now
            b.sleep(0.1)
        return None
    def put(js):
        before = b.eval("document.querySelector('#formula').textContent")
        b.eval(js)
        if changed(before) is None: failures.append(f'the formula line did not update after {js}')
    b.eval("__app.setups.direction()"); b.sleep(0.5)
    steps = [lambda js=js: put(js) for js in (
        "__app.state.k1 = [0.05, 0]", "__app.state.k1 = [-2.4, 1.8]", "__app.state.k1 = [0.3, -0.1]", "__app.state.k1 = [1, 0]",
        "(() => { const s = [...document.querySelectorAll('.slider')].find((e) => e.textContent.trim().startsWith('ω')); const box = s.querySelector('input[type=number]'); box.value = 0; box.dispatchEvent(new Event('change')); })()",
        "(() => { const s = [...document.querySelectorAll('.slider')].find((e) => e.textContent.trim().startsWith('ω')); const box = s.querySelector('input[type=number]'); box.value = 4.75; box.dispatchEvent(new Event('change')); })()")]
    moves, texts = b.steady('#formula > span, #formula .fixnum', steps)
    check(not moves and len(texts) >= 6, f'the formula line keeps still as |k|, λ and ω change ({moves[:3] or "none moved"})')
    # A packet: the line's numbers, and the velocities on the dispersion plot, keep their places.
    b.eval("__app.setups.relativistic()"); b.sleep(0.5)
    b.eval("""(() => { const c = document.querySelector('#dispersion').getContext('2d'), fill = c.fillText.bind(c);
        let last = ''; window.__vAt = new Set();
        c.fillText = (t, x, y) => { if (/velocity/.test(last)) __vAt.add(Math.round(x * 10) / 10 + ',' + Math.round(y)); last = t; fill(t, x, y); }; })()""")
    k0 = "(() => { const box = document.querySelectorAll('#packet-box input[type=number]')[0]; box.value = %s; box.dispatchEvent(new Event('change')); })()"
    moves, texts = b.steady('#formula > span, #formula .fixnum', [lambda v=v: put(k0 % v) for v in (0.3, 4, 0.9, 2.5)])
    at = b.eval('[...__vAt]')
    check(not moves and len(texts) >= 4 and len(at) == 2, f'a packet: the line and the velocities on the plot keep still as k0 runs 0.3 ... 4 ({moves[:3] or "none moved"}; numbers drawn at {at})')
    # Links: #setup= opens an experiment.
    b.goto('planewave/index.html?reload#setup=water'); b.wait('window.__app && __app.ready'); b.sleep(0.5)
    check(b.eval('__app.state.mode') == 'packet' and b.eval('__app.state.disp') == 'water', '#setup=water opens the deep-water packet')
    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

    # The hint and the Start-here text stand out from their backgrounds, light and dark.
    CONTRAST = """((sel) => { const e = document.querySelector(sel);
        const lum = (c) => { const [r, g, b] = c.match(/\\d+/g).map((v) => { v = v / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        let bg = 'rgba(0, 0, 0, 0)', p = e; while (p && /rgba\\(0, 0, 0, 0\\)|transparent/.test(bg)) { bg = getComputedStyle(p).backgroundColor; p = p.parentElement; }
        const a = lum(getComputedStyle(e).color), c = lum(bg); return (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05); })"""
    b.goto('planewave/index.html'); b.wait('window.__app && __app.ready'); b.sleep(0.5)
    for theme in ('light', 'dark'):
        b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': theme}]); b.sleep(0.4)
        ratios = [b.eval(f'{CONTRAST}({json.dumps(s)})') for s in ('#hint', '#help section.start p')]
        check(all(r > 4.5 for r in ratios), f'{theme} theme: the hint and the Start-here text stand out from their backgrounds (contrast {[round(r, 1) for r in ratios]})')
        if theme == 'dark':
            b.screenshot('build/pw-dark.png')
            b.eval('__app.setups.schrodinger()'); b.sleep(0.6); b.screenshot('build/pw-dark-packet.png')
    # A phone: the picture and its hint are on the first screen.
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'light'}])
    b.call('Emulation.setDeviceMetricsOverride', width=420, height=800, deviceScaleFactor=1, mobile=True)
    b.goto('planewave/index.html'); b.wait('window.__app && __app.ready'); b.sleep(0.6)
    r = b.eval("(() => { const r = document.querySelector('#hint').getBoundingClientRect(), c = document.querySelector('#wave').getBoundingClientRect(); return [r.top, r.bottom, c.width, c.height, innerHeight, innerWidth]; })()")
    check(r[1] <= r[4] and r[0] > 0 and abs(r[2] - r[3]) < 2 and r[2] <= r[5] and r[2] > 300, f'phone: the square picture ({r[2]:.0f} px) and its hint (bottom at {r[1]:.0f} of {r[4]} px) fit the first screen')
    b.screenshot('build/pw-phone.png')
    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'phone and dark: no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
