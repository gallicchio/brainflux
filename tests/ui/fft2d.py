#!/usr/bin/env python3
"""Drive the 2D Fourier demo like a student would, checking the physics as it goes."""
import json, os, sys
import re as regex   # (re is a typed real part below)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

K = '#side-k canvas.view'
X = '#side-x canvas.view'
# The hints under the pictures: their text, whether visible, and whether directly under the picture.
HINTS = """[...document.querySelectorAll('.side .hint')].map((e) => { const r = e.getBoundingClientRect(), c = e.closest('.side').querySelector('canvas').getBoundingClientRect();
    return { text: e.textContent, visible: r.height > 0 && !e.hidden, under: r.top >= c.bottom - 1 && r.top < c.bottom + 12, top: r.top, bottom: r.bottom }; })"""
# The contrast ratio of an element's text against the first opaque background behind it.
CONTRAST = """((sel) => { const e = document.querySelector(sel);
    const lum = (c) => { const [r, g, b] = c.match(/\\d+/g).map((v) => { v = v / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    let bg = 'rgba(0, 0, 0, 0)', p = e; while (p && /rgba\\(0, 0, 0, 0\\)|transparent/.test(bg)) { bg = getComputedStyle(p).backgroundColor; p = p.parentElement; }
    const a = lum(getComputedStyle(e).color), c = lum(bg); return (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05); })"""
# Re F and |F| along +kx from the centre, for the zeros and dips the help quotes.
PROFILE = """(() => { const {k} = __app.sides, n = __app.state.n, c = (n/2)*n + n/2; return Array.from({length: 60}, (_, d) => [k.re[c + d], Math.hypot(k.re[c + d], k.im[c + d])]); })()"""
def crossings(prof):   # the zeros of Re F along +kx, interpolated between pixels
    return [i + prof[i][0] / (prof[i][0] - prof[i + 1][0]) for i in range(1, len(prof) - 1) if prof[i][0] * prof[i + 1][0] < 0]
def minima(prof):      # the dips of |F| along +kx
    return [i for i in range(1, len(prof) - 1) if prof[i][1] < prof[i - 1][1] and prof[i][1] < prof[i + 1][1]]

with Browser('fft2d/index.html', size=(1400, 950)) as b:
    b.wait('window.__app && __app.ready')
    b.sleep(0.5)
    check(b.eval("__app.sides.x.mode") == 'grey', 'a photograph is drawn in grey')
    b.screenshot('build/fft2d-start.png')

    # The first screen: a hint directly under each picture saying what the tool does there; under
    # the pointer the value there takes its place, and nothing else on the page moves.
    h = b.eval(HINTS)
    check(len(h) == 2 and all(x['visible'] and x['under'] for x in h) and h[0]['text'].startswith('Paint on the picture') and 'one dot of k' in h[1]['text'],
          f"a hint directly under each picture on opening: {[x['text'] for x in h]}")
    gallery_top = b.box('.gallery')[1]
    x, y, w, hh = b.box(X)
    b.mouse('mouseMoved', x + 0.3 * w, y + 0.3 * hh); b.sleep(0.2)
    shown = b.eval("[document.querySelector('#side-x .hint').hidden, document.querySelector('#side-x .readout').hidden, document.querySelector('#side-x .readout').textContent]")
    check(shown[0] and not shown[1] and shown[2].startswith('x ') and abs(b.box('.gallery')[1] - gallery_top) < 0.5,
          f"under the pointer the readout takes the hint's place and nothing below moves ({shown[2]!r})")
    b.mouse('mouseMoved', 2, 2); b.sleep(0.2)
    check(not b.eval("document.querySelector('#side-x .hint').hidden"), 'the hint comes back when the pointer leaves the picture')
    for tool, words in (('hand', ('Drag to shift the picture', 'phase ramp')), ('mask', ('outside the circle', 'picture blurs')),
                        ('eraser', ('Erase', 'loses the waves')), ('brush', ('Paint', 'one wave'))):
        b.eval(f"__app.setTool('{tool}')")
        t = [x['text'] for x in b.eval(HINTS)]
        check(words[0] in t[0] and words[1] in t[1], f'{tool}: the hints say what it does on each side: {t}')
    b.eval("__app.setTool('mask'); [...document.querySelectorAll('#tool-options .seg button')].find((e) => e.textContent === 'Keep outside').click()")
    t = [x['text'] for x in b.eval(HINTS)]
    check('inside the circle' in t[0] and 'only edges stay' in t[1], f'mask, keep outside: {t}')
    b.eval("[...document.querySelectorAll('#tool-options .seg button')].find((e) => e.textContent === 'Keep inside').click(); __app.setTool('brush')")
    # The drawer: Start here first, in plain words without equations; then the transform and the
    # colour wheel (kept from before); then the thirteen experiments; then Things to know.
    b.eval("document.querySelector('#help-button').click()"); b.sleep(0.3)
    kinds = b.eval("[...document.querySelectorAll('#help > *')].map((e) => e.tagName.toLowerCase() + (e.className ? '.' + e.className.split(' ')[0] : ''))")
    start = b.eval("""(() => { const s = document.querySelector('#help section.start'); return { h: s?.querySelector('h3')?.textContent,
        math: s?.querySelectorAll('math').length, sentences: (s?.textContent.match(/[.!?](\\s|$)/g) || []).length }; })()""")
    check(kinds[:2] == ['header', 'section.start'] and start['h'] == 'Start here' and start['math'] == 0 and 3 <= start['sentences'] <= 7,
          f"the drawer begins with a Start here block ({start['sentences']} sentences, no equations)")
    exps = [i for i, k in enumerate(kinds) if k == 'article.exp']
    check(len(exps) == 13 and kinds[2] == 'p' and 'figure.wheel-figure' in kinds[:exps[0]] and kinds[exps[-1] + 1] == 'h3',
          f'then the transform and the colour wheel, then {len(exps)} experiments, then Things to know')
    ratios = [b.eval(f'{CONTRAST}({json.dumps(s)})') for s in ('#hint-x', '#hint-k', '#help section.start p')]
    check(all(r > 4.5 for r in ratios), f'light theme: the hints and the Start-here text stand out from their backgrounds (contrast {[round(r, 1) for r in ratios]})')
    b.screenshot('build/fft2d-help.png')
    b.key('Escape'); b.sleep(0.2)

    # Parseval: sum |f|^2 = sum |F|^2
    e = b.eval("(() => { const {x, k} = __app.sides; let a = 0, c = 0; for (let i = 0; i < x.re.length; i++) { a += x.re[i]**2 + x.im[i]**2; c += k.re[i]**2 + k.im[i]**2; } return [a, c]; })()")
    check(abs(e[0] - e[1]) < 1e-9 * e[0], f'Parseval holds ({e[0]:.6g} vs {e[1]:.6g})')

    # The origin is the centre pixel on both sides: every real image has F(-k) = F(k)*, and one
    # that a half turn leaves unchanged has a real transform, with a real positive DC at the centre.
    SYMMETRY = """(() => { const {k} = __app.sides, n = __app.state.n; let fm = 0, fi = 0, he = 0;
        for (let a = 0; a < n * n; a++) fm = Math.max(fm, Math.hypot(k.re[a], k.im[a]));
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * n + i, b = ((n - j) % n) * n + (n - i) % n;
          fi = Math.max(fi, Math.abs(k.im[a])); he = Math.max(he, Math.hypot(k.re[b] - k.re[a], k.im[b] + k.im[a])); }
        const c = (n / 2) * n + n / 2;
        return [fi / fm, he / fm, k.re[c] / fm, k.im[c] / fm]; })()"""
    for p, even in [('gaussian', True), ('box', True), ('disk', True), ('ring', True), ('double', True),
                    ('lattice', True), ('hexagonal', True), ('portrait', False), ('text', False), ('bricks', False)]:
        b.eval(f"__app.loadPreset('{p}')"); b.sleep(0.3)
        imag, herm, dc, dci = b.eval(SYMMETRY)
        check(herm < 1e-12 and dc > 0 and abs(dci) < 1e-12, f'{p}: F(-k) = F(k)* to {herm:.1e}, real positive DC at the centre')
        if even: check(imag < 1e-12, f'{p}: symmetric, so its transform is real (max |Im F| / max |F| = {imag:.1e})')

    # The paint can be typed in either form, and 0 is a button.
    def typed(field, v):
        b.eval(f"(() => {{ const e = document.getElementById('value-{field}'); e.focus(); e.value = '{v}'; e.dispatchEvent(new Event('input')); e.blur(); e.dispatchEvent(new Event('change')); }})()")
        return b.eval("[__app.state.value.mag, __app.state.value.phase, ...['re', 'im', 'mag', 'deg'].map((k) => +document.getElementById('value-' + k).value)]")
    typed('re', 0); mag, ph, re, im, m, deg = typed('im', -2)
    check(abs(mag - 2) < 1e-12 and abs(ph + 1.5707963) < 1e-6 and abs(m - 2) < 1e-9 and abs(deg + 90) < 1e-9, f'typing Re 0, Im -2 gives 2 at -90 degrees ({mag:.3g}, {deg:.3g})')
    typed('mag', 1); mag, ph, re, im, m, deg = typed('deg', 180)
    check(abs(re + 1) < 1e-9 and im == 0, f'typing |w| 1 at 180 degrees gives Re -1, Im 0 ({re}, {im})')
    b.eval("[...document.querySelectorAll('#quick-values button')].find((e) => e.textContent === '0').click()")
    check(b.eval("__app.state.value.mag") == 0, 'the 0 button paints zero')
    b.eval("[...document.querySelectorAll('#quick-values button')].find((e) => e.textContent === '1').click()")

    # The disk is round even at 128: its edge is anti-aliased, so its area is pi R^2 to a pixel or so.
    b.eval("__app.setResolution(128)"); b.sleep(0.4); b.eval("__app.loadPreset('disk')"); b.sleep(0.3)
    area = b.eval("__app.sides.x.re.reduce((a, v) => a + v, 0) / Math.max(...__app.sides.x.re)")
    R = 0.1 * 128
    check(abs(area - 3.14159265 * R * R) < 2, f'the disk at 128 has area pi R^2 ({area:.1f} vs {3.14159265 * R * R:.1f})')
    b.eval("__app.setResolution(256)"); b.sleep(0.4)

    # 1. The jacket: erase with the mirror on; the image must stay real.
    b.eval("__app.setups.jacket()"); b.sleep(0.6)
    b.drag(K, (0.62, 0.30), (0.75, 0.45), steps=20)
    b.sleep(0.3)
    im_max = b.eval("__app.sides.x.im.reduce((a, v) => Math.max(a, Math.abs(v)), 0)")
    check(im_max < 1e-9, f'mirror erasing keeps the image real (max |Im f| = {im_max:.2e})')
    check(b.eval("__app.sides.x.mode") == 'grey', 'the notch-filtered jacket is still drawn in grey')
    b.screenshot('build/fft2d-jacket.png')

    # 2. Low-pass: drag a mask out from the centre; outside it the transform must be zero.
    b.eval("__app.setups.lowpass()"); b.sleep(0.6)
    b.drag(K, (0.5, 0.5), (0.58, 0.5), steps=10)
    b.sleep(0.3)
    r = b.eval("""(() => { const {k} = __app.sides, n = __app.state.n; let outside = 0, inside = 0;
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const m = Math.hypot(k.re[j*n+i], k.im[j*n+i]);
          const d = Math.hypot(i - n/2, j - n/2); if (d > 0.09*n) outside = Math.max(outside, m); else if (d < 0.07*n) inside = Math.max(inside, m); }
        return [outside, inside]; })()""")
    check(r[0] == 0 and r[1] > 0, f'low-pass mask zeroes the outside only (outside max {r[0]}, inside max {r[1]:.3g})')
    b.screenshot('build/fft2d-lowpass.png')

    # 3. Shifting the image leaves |F| unchanged.
    b.eval("__app.setups.shift()"); b.sleep(0.6)
    before = b.eval("Array.from(__app.sides.k.re.map((v, i) => Math.hypot(v, __app.sides.k.im[i])))")
    b.drag(X, (0.4, 0.4), (0.55, 0.47), steps=8)
    b.sleep(0.3)
    after = b.eval("Array.from(__app.sides.k.re.map((v, i) => Math.hypot(v, __app.sides.k.im[i])))")
    d = max(abs(p - q) for p, q in zip(before, after)) / max(before)
    shifted = b.eval("__app.sides.x.re[0]") != 0 or True
    check(d < 1e-9, f'shifting the image keeps |F| (relative change {d:.2e})')
    b.screenshot('build/fft2d-shift.png')
    # Experiment 5's sign: dragging the picture a pixels to the right multiplies F by exp(-2 pi i kx a / N).
    b.eval("__app.setups.shift()"); b.sleep(0.6)
    PHASES = "(() => { const {k} = __app.sides, n = __app.state.n; return [1, 5, 20].map((kx) => { const i = (n/2) * n + n/2 + kx; return Math.atan2(k.im[i], k.re[i]) * 180 / Math.PI; }); })()"
    before = b.eval(PHASES)
    x, y, w, hh = b.box(X); px = w / 256
    b.mouse('mouseMoved', x + 100, y + 100); b.mouse('mousePressed', x + 100, y + 100, 1, 'left')
    b.mouse('mouseMoved', x + 100 + 10 * px, y + 100, 1, 'left'); b.mouse('mouseReleased', x + 100 + 10 * px, y + 100, 0, 'left'); b.sleep(0.3)
    after = b.eval(PHASES)
    off = max(abs(((q - p) + 360 * kx * 10 / 256 + 180) % 360 - 180) for p, q, kx in zip(before, after, (1, 5, 20)))
    check(off < 1e-6, f'experiment 5: a shift of 10 pixels to the right turns the phase of F(kx, 0) by -2 pi kx 10/N (off by {off:.1e} degrees)')

    # 4. Painting on k without the mirror makes the image complex, and the display switches to colour.
    b.eval("__app.setups.hermitian()"); b.sleep(0.6)
    b.drag(K, (0.56, 0.44), (0.60, 0.40), steps=6)
    b.sleep(0.3)
    check(b.eval("__app.sides.x.mode") == 'complex', 'the image display switches to colour once it is complex')
    b.screenshot('build/fft2d-hermitian.png')

    # 5. Undo returns to the real image.
    b.eval("__app.undo()"); b.sleep(0.3)
    im_max = b.eval("__app.sides.x.im.reduce((a, v) => Math.max(a, Math.abs(v)), 0)")
    check(im_max < 1e-6, f'undo restores the real image (max |Im f| = {im_max:.2e})')

    # 6. Every experiment sets up without errors, and gets a picture.
    for name in b.eval("Object.keys(__app.setups)"):
        b.eval(f"__app.setups[{json.dumps(name)}]()"); b.sleep(0.5)
        b.screenshot(f'build/fft2d-exp-{name}.png')
        if name in ('lowpass', 'highpass'):   # the mask's hint follows the set-up's keep-inside/outside
            t = b.eval("document.querySelector('#hint-k').textContent")
            check(('picture blurs' if name == 'lowpass' else 'only edges stay') in t, f'{name}: the hint under the transform says what this mask does ({t!r})')
        if name == 'comb':
            check(b.eval("Math.max(...__app.sides.x.re)") > 0, 'the comb experiment starts with a mark painted')
            on, off = b.eval("""(() => { const {k} = __app.sides, n = __app.state.n; let on = 0, off = 0; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
                const m = Math.hypot(k.re[j*n+i], k.im[j*n+i]); if ((i - n/2) % 4 === 0 && (n/2 - j) % 4 === 0) on = Math.max(on, m); else off = Math.max(off, m); } return [on, off]; })()""")
            check(on > 0 and off == 0, f'the comb: the transform is zero except at every fourth frequency (max |F| on the lattice {on:.3g}, off it {off})')

    # The numbers the help quotes, measured in the running demo (at 256).
    b.eval("__app.loadPreset('gaussian')"); b.sleep(0.4)
    sk = b.eval("(() => { const {k} = __app.sides, n = __app.state.n, c = (n/2)*n + n/2; return 3 / Math.sqrt(-2 * Math.log(k.re[c + 3] / k.re[c])); })()")
    check(abs(sk - 3.98) < 0.02, f"experiment 4: the Gaussian's transform has width {sk:.2f} pixels (the help: 1/(2 pi 0.04) = 4.0)")
    b.eval("__app.loadPreset('box')"); b.sleep(0.4)
    z = crossings(b.eval(PROFILE))
    check(abs(z[0] - 8.26) < 0.1 and abs(z[1] - 16.5) < 0.1, f"experiment 6: the square's sinc has zeros at {z[0]:.2f}, {z[1]:.2f} (the help: every N/w = 8.3 for w = 31)")
    b.eval("__app.loadPreset('disk')"); b.sleep(0.4)
    z = crossings(b.eval(PROFILE))
    check(abs(z[0] - 6.1) < 0.1, f"experiment 6: the disk's Airy pattern has its first zero at k = {z[0]:.2f} (the help: 0.61 N/R = 6.1)")
    b.eval("__app.loadPreset('double')"); b.sleep(0.4)
    m = minima(b.eval(PROFILE))
    spacing = (m[3] - m[0]) / 3
    check(abs(spacing - 12.2) < 0.3 and m[0] == 6, f"experiment 7: the double slit's fringes are {spacing:.1f} apart (the help: N/d = 12.2 for d = 21)")
    b.eval("__app.loadPreset('stripes')"); b.sleep(0.4)
    spots = b.eval("""(() => { const {k} = __app.sides, n = __app.state.n; const out = []; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const a = Math.hypot(k.re[j*n+i], k.im[j*n+i]); if (a > 1e-6) out.push([i - n/2, n/2 - j]); } return out; })()""")
    check(sorted(spots) == [[-8, -6], [0, 0], [8, 6]], f'the stripes transform into three single pixels, the centre and +-(8, 6): {spots}')
    # Experiment 8: the brick wall's spots lie on the grid (4m, 9q), and in the odd rows every third
    # one is missing (the structure factor 1 + exp(2 pi i (m/3 + q/2)) vanishes there).
    b.eval("__app.loadPreset('bricks')"); b.sleep(0.6)
    br = b.eval("""(() => { const {k} = __app.sides, n = __app.state.n; const at = (kx, ky) => { const i = n/2 + kx, j = n/2 - ky; return Math.hypot(k.re[j*n+i], k.im[j*n+i]); };
        const haze = []; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const kx = i - n/2, ky = n/2 - j, r = Math.hypot(kx, ky); if (r > 20 && r < 40 && (kx % 4 || ky % 9)) haze.push(at(kx, ky)); }
        haze.sort((a, b) => a - b);
        const row = (q) => Object.fromEntries([...Array(19).keys()].map((i) => i - 9).map((m) => [m, at(4 * m, 9 * q)]));
        return { haze: haze[haze.length >> 1], rows: { '-1': row(-1), '0': row(0), '1': row(1), '2': row(2) } }; })()""")
    even, odd = br['rows']['0'], (br['rows']['1'], br['rows']['-1'])
    on_grid = min(even[str(m)] for m in (1, 2, 3, 4, 6)) / br['haze']
    present = min(r[str(m)] for r in odd for m in (-2, -1, 1, 2)) / br['haze']
    missing = max(r[str(m)] / ((r[str(m - 1)] + r[str(m + 1)]) / 2) for r in odd for m in (-6, -3, 3, 6))
    check(on_grid > 5 and present > 5 and missing < 1 / 3 and br['rows']['2']['0'] > 5 * br['rows']['1']['0'],
          f"experiment 8: the brick wall's spots at (4m, 9q) stand {on_grid:.0f}x above the haze, and in the odd rows every third one is missing (at most {missing:.2f} of its neighbours)")
    # Experiment 12: the pixel at k = (5, 3) is the wave exp(+2 pi i k.r/N); the brush is one pixel.
    b.eval("__app.setups.wave()"); b.sleep(0.6)
    wv = b.eval("""(() => { const {x} = __app.sides, n = __app.state.n, at = (X, Y) => { const i = n/2 + X, j = n/2 - Y; return Math.atan2(x.im[j*n+i], x.re[j*n+i]) * 180 / Math.PI; };
        return [at(1, 0) - at(0, 0), at(0, 1) - at(0, 0), __app.state.brush.size, __app.sides.k.zoom]; })()""")
    check(abs(wv[0] - 360 * 5 / 256) < 1e-6 and abs(wv[1] - 360 * 3 / 256) < 1e-6 and wv[2] == 1 and wv[3] == 8,
          f'experiment 12: k = (5, 3) is the wave exp(+2 pi i k.r/N) (phase per pixel {wv[0]:.2f} degrees in x, {wv[1]:.2f} in y), the brush one pixel, the transform zoomed 8x')
    b.eval("__app.sides.k.zoom = 1; __app.sides.k.zoomSelect.value = 1"); b.sleep(0.2)
    x, y, w, hh = b.box(K)
    b.mouse('mouseMoved', x + (128 + 5.5) * w / 256, y + (128 - 2.5) * hh / 256); b.sleep(0.2)
    txt = b.eval("document.querySelector('#side-k .readout').textContent")
    check(regex.search(r'kx\s*5,\s*ky\s*3', txt) and '43.9 px' in txt and '31°' in txt, f'the readout at that pixel gives its wavelength N/|k| = 43.9 px and direction 31 degrees ({txt!r})')
    b.mouse('mouseMoved', 2, 2); b.sleep(0.2)
    # Review fixes.
    # Mirror painting with an even hard brush at 128 and 512 keeps the image real.
    for n in (128, 512):
        b.eval(f"__app.setResolution({n})"); b.sleep(0.4)
        b.eval("__app.setups.jacket()"); b.sleep(0.6)
        b.drag(K, (0.62, 0.30), (0.75, 0.45), steps=15); b.sleep(0.3)
        b.drag(K, (0.49, 0.47), (0.53, 0.52), steps=6); b.sleep(0.3)   # across the origin
        im_max = b.eval("__app.sides.x.im.reduce((a, v) => Math.max(a, Math.abs(v)), 0)")
        check(im_max < 1e-9, f'n={n}: mirror erasing with brush size {b.eval("__app.state.brush.size")} keeps the image real ({im_max:.1e})')
    b.eval("__app.setResolution(256)"); b.sleep(0.4)
    # Changing tool by key in the middle of a drag.
    b.eval("__app.setups.hermitian()"); b.sleep(0.5)
    x0, y0 = b.point(K, (0.6, 0.4)); x1, y1 = b.point(K, (0.7, 0.45))
    b.mouse('mouseMoved', x0, y0); b.mouse('mousePressed', x0, y0, 1, 'left')
    b.mouse('mouseMoved', (x0 + x1) / 2, (y0 + y1) / 2, 1, 'left')
    b.key('m'); b.key('h')
    b.mouse('mouseMoved', x1, y1, 1, 'left'); b.mouse('mouseReleased', x1, y1, 0, 'left'); b.sleep(0.3)
    finite = b.eval("__app.sides.x.re.every(Number.isFinite) && __app.sides.k.re.some((v) => v !== 0)")
    check(finite, 'switching tools by key mid-drag leaves the data sound')
    # Keep only the phase keeps the total power.
    b.eval("__app.setups.lowpass()"); b.sleep(0.5)
    b.drag(K, (0.5, 0.5), (0.6, 0.5), steps=6); b.sleep(0.3)
    P0 = b.eval("__app.sides.k.re.reduce((a, v, i) => a + v * v + __app.sides.k.im[i] ** 2, 0)")
    b.eval("__app.runOperation(__app.sides.k, 'phase')"); b.sleep(0.2)
    P1 = b.eval("__app.sides.k.re.reduce((a, v, i) => a + v * v + __app.sides.k.im[i] ** 2, 0)")
    check(abs(P1 / P0 - 1) < 1e-9, f'keeping only the phase keeps the power ({P0:.4g} -> {P1:.4g})')
    # Undo restores what the picture was made from.
    b.eval("__app.loadPreset('portrait')"); b.sleep(0.4); b.eval("__app.loadPreset('gaussian')"); b.sleep(0.4)
    b.eval("__app.undo()"); b.sleep(0.3)
    check(b.eval("__app.state.preset") == 'portrait', f"undo restores the preset ({b.eval('__app.state.preset')})")
    # 7. Resolutions.
    for n in (64, 512, 256):
        b.eval(f"__app.setResolution({n})"); b.sleep(0.6)
        check(b.eval("__app.sides.k.re.length") == n * n, f'resolution {n}')
    # The values under the pointer keep still as it moves (coordinates of either sign, magnitudes
    # from tiny to large, any phase): every number in a slot of its own, the select beside them put.
    b.eval("__app.loadPreset('portrait')"); b.sleep(0.5)
    # At the centre of the transform the readout says what the DC term is, and it is that.
    x, y, w, hh = b.box(K)
    b.mouse('mouseMoved', x + 128.5 * w / 256, y + 128.5 * hh / 256); b.sleep(0.2)
    txt = b.eval("document.querySelector('#side-k .readout').textContent")
    dc = b.eval("(() => { const {x, k} = __app.sides, n = __app.state.n; let s = 0; for (let i = 0; i < n*n; i++) s += x.re[i]; return [k.re[(n/2)*n + n/2], s / n]; })()")
    check('the average × N' in txt and abs(dc[0] - dc[1]) < 1e-9 * dc[1], f'at k = 0 the readout says the value is the average times N, and it is ({dc[0]:.4g} = 256 × {dc[1] / 256:.4g})')
    b.mouse('mouseMoved', 2, 2); b.sleep(0.2)
    for sel, name in ((X, 'image'), (K, 'transform')):
        x, y, w, h = b.box(sel)
        side = sel.split()[0]
        def hover(fx, fy):
            b.mouse('mouseMoved', x + fx * w, y + fy * h)
            b.sleep(0.15)
        words = [' y', '|f|', '∠'] if name == 'image' else [' ky', '|F|', '∠', 'λ', ' px']
        hover(0.1, 0.1)
        at = [b.text_x(f'{side} .readout', words)]
        def step(p):
            hover(*p)
            at.append(b.text_x(f'{side} .readout', words))
        pts = [(0.9, 0.9), (0.56, 0.5), (0.52, 0.47), (0.03, 0.6), (0.7, 0.2), (0.45, 0.55), (0.98, 0.02)]
        moves, texts = b.steady(f'{side} .foot-row select, {side} .readout, {side} .readout .fixnum', [lambda p=p: step(p) for p in pts])
        b.mouse('mouseMoved', 2, 2)
        shifts = [max(abs(a[i][0] - at[0][i][0]) for a in at) if all(a[i] for a in at) else None for i in range(len(words))]
        check(not moves and len(texts) >= 5 and None not in shifts and max(shifts) <= 0.5,
              f'{name}: the values under the pointer keep still as it moves (words {words} shift by {shifts} px; {moves[:3] or "no box moved"})')
    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions or console errors' + ('' if not errors else ': ' + '; '.join(errors[:3])))

# A phone, and the dark theme.
with Browser('fft2d/index.html', size=(390, 844)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(0.5)
    b.screenshot('build/fft2d-phone.png')
    w = b.eval('document.documentElement.scrollWidth')
    h = b.eval(HINTS)
    check(w <= 390 and len(h) == 2 and all(x['visible'] and x['under'] for x in h) and h[0]['bottom'] <= 844,
          f"on a phone the page does not scroll sideways ({w} px) and the hint is under the picture, inside the first screen (its bottom at {h[0]['bottom']:.0f} px of 844)")
    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'phone: no exceptions')
with Browser('fft2d/index.html', size=(1400, 950)) as b:
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
    b.wait('window.__app && __app.ready'); b.sleep(0.5)
    b.eval("document.querySelector('#help-button').click()"); b.sleep(0.3)
    ratios = [b.eval(f'{CONTRAST}({json.dumps(s)})') for s in ('#hint-x', '#hint-k', '#help section.start p')]
    check(all(r > 4.5 for r in ratios), f'dark theme: the hints and the Start-here text stand out from their backgrounds (contrast {[round(r, 1) for r in ratios]})')
    b.screenshot('build/fft2d-dark-help.png')

print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
