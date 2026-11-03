#!/usr/bin/env python3
"""Drive the Fourier series demo: the first screen and its hints, the drawer (Start here, the
experiments, How it works), every preset against its closed form, the Gibbs overshoot, the bars'
colours, a drawn period and its analysis, the missing fundamental, the sound through the Web
Audio graph (the harmonics played, the gain, no clipping), the readouts keeping still, the dark
theme and a phone."""
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
    text = help_text(b, setup)
    missing = [n for n in numbers if n not in text]
    check(not missing, f'experiment {setup}: the help quotes {", ".join(numbers)}' + (f' (missing: {missing})' if missing else ''))

def coefficients(b):
    return b.eval('[Array.from(__app.state.a), Array.from(__app.state.b)]')

def press(b, label):
    b.eval(f"[...document.querySelectorAll('#presets button')].find((e) => e.textContent === {json.dumps(label)}).click()"); b.sleep(0.2)

# The closed forms of the presets (n = 1 .. 48): [a_n, b_n].
pi = math.pi
FORMS = {
    'Sine': lambda n: (0, 1 if n == 1 else 0),
    'Square': lambda n: (0, 4 / (pi * n) if n % 2 else 0),
    'Sawtooth': lambda n: (0, (-1) ** (n + 1) * 2 / (pi * n)),
    'Triangle': lambda n: (0, (-1) ** ((n - 1) // 2) * 8 / (pi * pi * n * n) if n % 2 else 0),
    'Pulses': lambda n: (2 * 2.5 / (pi * n) * math.sin(pi * n * 0.08), 0),
    'No fundamental': lambda n: (0.5 if 2 <= n <= 6 else 0, 0),
}

with Browser('fourier/index.html', size=(1300, 900)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(0.5)
    b.screenshot('build/fs-start.png')
    # The first screen: the square wave with 15 harmonics, silent, and a hint over each picture.
    HINTS = """[...document.querySelectorAll('.hint')].map((e) => { const r = e.getBoundingClientRect(), c = e.closest('.panel-head').nextElementSibling.querySelector('canvas').getBoundingClientRect();
        return { text: e.textContent, visible: r.height > 0 && r.bottom <= innerHeight, over: r.bottom <= c.top + 2 && r.bottom > c.top - 30 }; })"""
    h = b.eval(HINTS)
    check(b.eval('[__app.state.preset, __app.state.terms, __app.audio()]') == ['square', 15, None] and len(h) == 2 and all(x['visible'] and x['over'] for x in h)
          and h[0]['text'].startswith('Draw one period on it') and '15 harmonics' in h[0]['text'] and h[1]['text'].startswith('Drag a bar up or down'),
          f"opens on the square wave with 15 harmonics, a hint over each picture: {[x['text'] for x in h]}")
    # The drawer: Start here first, in plain words without equations; the experiments; the theory last.
    kinds = b.eval("[...document.querySelectorAll('#help > *')].map((e) => e.tagName.toLowerCase() + (e.className ? '.' + e.className.split(' ')[0] : ''))")
    start = b.eval("""(() => { const s = document.querySelector('#help section.start'); return { h: s?.querySelector('h3')?.textContent,
        math: s?.querySelectorAll('math').length, sentences: (s?.textContent.match(/[.!?](\\s|$)/g) || []).length, acts: /Draw on the top plot/.test(s?.textContent) && /drag a bar/.test(s?.textContent) }; })()""")
    check(kinds[:2] == ['header', 'section.start'] and start['h'] == 'Start here' and start['math'] == 0 and 3 <= start['sentences'] <= 7 and start['acts'],
          f"the drawer begins with a Start here block ({start['sentences']} sentences, no equations, says what to draw and drag)")
    exps = [i for i, k in enumerate(kinds) if k == 'article.exp']
    theory = kinds.index('section.theory') if 'section.theory' in kinds else -1
    how = b.eval("document.querySelector('#help section.theory h3')?.textContent")
    heads = b.eval("[...document.querySelectorAll('#help section.theory b')].map((e) => e.textContent)")
    check(len(exps) == 6 and theory > exps[-1] and how == 'How it works' and len(heads) == 3 and b.eval("document.querySelectorAll('#help section.theory math').length") > 5,
          f'then {len(exps)} experiments, then the theory under "{how}" ({heads})')
    gloss = b.eval("document.querySelector('#harmonics-gloss').textContent")
    check(all(w in gloss for w in ('Harmonic n', 'amplitude', 'phase', 'fundamental', 'pitch', 'spectrum')), 'harmonic, amplitude, phase, fundamental and spectrum are glossed under the Harmonics controls')

    # Every preset has the coefficients of its closed form.
    for label, form in FORMS.items():
        press(b, label)
        a, bb = coefficients(b)
        err = max(max(abs(a[n] - form(n)[0]), abs(bb[n] - form(n)[1])) for n in range(1, 49))
        check(err < 1e-12 and b.eval('__app.state.a[0] === 0 && __app.state.b[0] === 0'), f'{label}: the coefficients are the closed form (to {err:.1e}), no constant term')
    # The analysis inverts the synthesis: the square wave's samples give back b_n = 4/(pi n).
    press(b, 'Square')
    err = b.eval("""(() => { const s = __app.state, keepA = s.a.slice(), keepB = s.b.slice();
        __app.analyse(__app.waveform(48)); let e = 0; for (let n = 1; n <= 48; n++) e = Math.max(e, Math.abs(s.a[n] - keepA[n]), Math.abs(s.b[n] - keepB[n])); return e; })()""")
    check(err < 1e-12, f'analysing the synthesised wave gives back its coefficients ({err:.1e})')
    # Gibbs: the square wave overshoots by about 9% of its jump (2) however many terms are summed.
    over = {}
    for terms in (5, 15, 47):
        b.eval(f"__app.state.terms = {terms}")
        over[terms] = 100 * (b.eval("Math.max(...__app.waveform())") - 1) / 2
    check(all(8.5 < v < 9.5 for v in over.values()) and near(over[5], 9.4, 1) and near(over[15], 9.0, 1),
          'the Gibbs overshoot is ' + ', '.join(f'{v:.2f}% with {k} terms' for k, v in over.items()) + ' (2/pi Si(pi) - 1 = 8.95% of the jump)')
    quoted(b, 'square', '9%', '9.4%', '9.0%')
    quoted(b, 'saw', '2/πn', '8/π')
    # The bars' colour is the harmonic's phase: a sine (a = 0, b > 0) is the colour of +i, yellow-green.
    b.eval("__app.setups.square()"); b.sleep(0.3)
    pix = b.eval("""(async () => { const cv = document.querySelector('#spectrum'), r = cv.getBoundingClientRect(), shown = Math.max(16, Math.min(48, __app.state.terms + 8));
        const w = r.width - 46 - 12, x = Math.round(46 + 0.5 / shown * w), y = Math.round(r.height - 34 - 10);
        const d = cv.getContext('2d').getImageData(x * devicePixelRatio, y * devicePixelRatio, 1, 1).data;
        const c = (await import('../lib/complexcolor.js')).colorOf(0, 4 / Math.PI, 4 / Math.PI);
        return { d: [...d].slice(0, 3), c, yellowGreen: d[1] > 180 && d[2] < 80 && d[0] < d[1] }; })()""")
    check(pix['yellowGreen'] and max(abs(x - y) for x, y in zip(pix['d'], pix['c'])) <= 8, f"the square wave's bars are yellow-green, the colour of +i (a sine): pixel {pix['d']}, colour of 4/pi i {pix['c']}")
    b.click('#zero-phase'); b.sleep(0.2)
    a, bb = coefficients(b)
    check(all(bb[n] == 0 for n in range(1, 49)) and near(a[1], 4 / pi, 9), 'Align phases makes every harmonic a cosine (b_n = 0) and keeps the amplitudes')

    # Draw on the wave: the drawn samples are kept, analysed, and their average is dropped.
    b.drag('#wave', (0.2, 0.3), (0.6, 0.7), steps=10); b.sleep(0.3)
    d = b.eval("(() => { const s = __app.state, w = __app.waveform(48); const mean = (v) => v.reduce((x, y) => x + y, 0) / v.length; return { drawn: s.drawn !== null, preset: s.preset, meanDrawn: mean(Array.from(s.drawn)), meanWave: mean(Array.from(w)) }; })()")
    check(d['drawn'] and d['preset'] == 'drawn' and abs(d['meanDrawn']) > 0.05 and abs(d['meanWave']) < 1e-12,
          f"drawing on the wave replaces it (drawn mean {d['meanDrawn']:.3f}; the series has no constant term: mean {d['meanWave']:.1e})")

    # Nothing moves as the numbers change: the count of harmonics in the hint (its slot and the words
    # after it), and the period in the wave's axis label (the words after it, drawn on the canvas).
    SET = """((label, v) => { const s = [...document.querySelectorAll('.slider')].find((e) => e.querySelector('label').textContent.trim().startsWith(label));
        const box = s.querySelector('input[type=number]'); box.value = v; box.dispatchEvent(new Event('change')); })"""
    b.eval("""(() => { const c = document.querySelector('#wave').getContext('2d'), fill = c.fillText.bind(c);
        window.__msAt = []; c.fillText = (t, x, y) => { if (t === ' ms)') __msAt.push(Math.round(x * 10) / 10); fill(t, x, y); }; })()""")
    moves, texts = b.steady('#wave-note, #wave-note .fixnum', [lambda n=n: b.eval(f"{SET}('terms', {n})") for n in (2, 9, 10, 47, 48, 3)])
    check(not moves and len(texts) >= 6, f'the hint keeps still as the count of harmonics goes 2 ... 48 ({moves[:3] or "none moved"})')
    at = []
    for f1 in (55, 80, 99.9, 100.1, 220, 600, 880):
        b.eval(f"__msAt.length = 0; {SET}('f₁', {f1})")
        for _ in range(100):
            if b.eval('__msAt.length'): break
            b.sleep(0.1)
        at.append(b.eval('__msAt[0] ?? null'))
    check(None not in at and max(at) - min(at) <= 0.5, f"the axis label's words keep still as the period runs 18.18 ... 1.14 ms (' ms)' at x = {sorted(set(at), key=str)})")
    period = b.eval("__app.state.f1")
    check(near(1000 / 220, 4.55, 2) and period == 880, 'T = 1/f1 = 4.55 ms at 220 Hz')

    for name in b.eval('Object.keys(__app.setups)'):
        b.eval(f'__app.setups[{json.dumps(name)}]()'); b.sleep(0.4)
        b.screenshot(f'build/fs-exp-{name}.png')
    # 5. Pulses: the sinc envelope first vanishes near n = 1/d = 12.5.
    b.eval("__app.setups.pulse()"); b.sleep(0.2)
    a, bb = coefficients(b)
    check(a[12] > 0 > a[13] and all(abs(a[n]) > 0.3 for n in range(1, 6)) and a[25] < 0 < a[26], f'pulses: the bars are nearly equal up to n = 5, change sign between 12 and 13 (a_12 = {a[12]:.3f}, a_13 = {a[13]:.3f}) and again at 25')
    quoted(b, 'pulse', '0.08', '12.5')
    # 6. The missing fundamental: harmonics 2 to 6 of 150 Hz, nothing at 150 Hz itself.
    b.eval("__app.setups.missing()"); b.sleep(0.2)
    a, bb = coefficients(b); f1 = b.eval('__app.state.f1')
    freqs = [n * f1 for n in range(1, 10) if a[n] or bb[n]]
    check(f1 == 150 and freqs == [300, 450, 600, 750, 900] and b.eval('__app.state.terms') == 6, f'no fundamental: f1 = {f1} Hz, tones at {freqs} Hz, with a common difference of 150')
    quoted(b, 'missing', '150', '300', '450', '600', '750', '900')

    # The sound, through the Web Audio graph: the harmonics handed to the oscillator are the a_n and
    # b_n of the first `terms` harmonics, the frequency is f1, the gain sets the r.m.s. to 0.25 x
    # volume whatever the phases, and no preset clips even at full volume.
    b.eval("""(() => { const P = AudioContext.prototype, orig = P.createPeriodicWave; window.__pw = [];
        P.createPeriodicWave = function (re, im, o) { __pw.push({ re: Array.from(re), im: Array.from(im), o }); return orig.call(this, re, im, o); }; })()""")
    b.eval("__app.setups.phases()"); b.sleep(0.2)
    b.click('#play'); b.sleep(0.6)
    s = b.eval("""(() => { const au = __app.audio(), s = __app.state, N = s.terms, pw = __pw[__pw.length - 1]; let p = 0, e = 0;
        for (let n = 1; n <= N; n++) { p += (s.a[n] ** 2 + s.b[n] ** 2) / 2; e = Math.max(e, Math.abs(pw.re[n] - s.a[n]), Math.abs(pw.im[n] - s.b[n])); }
        return { state: au.ctx.state, f: au.osc.frequency.value, gain: au.gain.gain.value, want: 0.25 * s.volume / Math.sqrt(p), N, len: pw.re.length, err: e, norm: pw.o.disableNormalization,
          button: document.querySelector('#play').textContent, pressed: document.querySelector('#play').getAttribute('aria-pressed') }; })()""")
    check(s['state'] == 'running' and s['f'] == 220 and s['len'] == s['N'] + 1 and s['err'] < 1e-6 and s['norm'] and abs(s['gain'] - s['want']) < 1e-4 and s['button'] == 'Stop sound' and s['pressed'] == 'true',
          f"Play sound: the oscillator plays the first {s['N']} harmonics (as typed, to {s['err']:.1e}) at {s['f']} Hz with gain {s['gain']:.4f} = 0.25 x volume / r.m.s.")
    gain0, amps0 = s['gain'], b.eval('[...Array(49).keys()].map((n) => Math.hypot(__app.state.a[n], __app.state.b[n]))')
    b.click('#scramble'); b.sleep(0.5)
    g1, amps1, shape = b.eval('__app.audio().gain.gain.value'), b.eval('[...Array(49).keys()].map((n) => Math.hypot(__app.state.a[n], __app.state.b[n]))'), b.eval('Math.max(...__app.waveform())')
    check(abs(g1 - gain0) < 1e-6 and max(abs(x - y) for x, y in zip(amps0, amps1)) < 1e-12 and abs(shape - 1.13) > 0.02,
          f'Scramble phases keeps every amplitude and the gain ({g1:.4f}); the wave changes shape (peak {shape:.3f} instead of 1.131)')
    b.eval(f"{SET}('f₁', 330)"); b.sleep(0.4)
    check(abs(b.eval('__app.audio().osc.frequency.value') - 330) < 0.01 and b.eval('__pw.length') >= 2, 'moving f1 retunes the oscillator (330 Hz)')
    b.eval(f"{SET}('terms', 7)"); b.sleep(0.3)
    check(b.eval('__pw[__pw.length - 1].re.length') == 8, 'lowering the terms re-makes the periodic wave with 7 harmonics')
    worst = []
    for name in ('square', 'phases', 'saw', 'draw', 'pulse', 'missing'):
        b.eval(f'__app.setups.{name}()'); b.sleep(0.2)
        worst.append((name, b.eval("(() => { const s = __app.state; let p = 0; for (let n = 1; n <= s.terms; n++) p += (s.a[n] ** 2 + s.b[n] ** 2) / 2; let pk = 0; for (const v of __app.waveform()) pk = Math.max(pk, Math.abs(v)); return pk * 0.25 / Math.sqrt(p); })()")))
    check(all(v <= 1 for _, v in worst), 'no preset clips at full volume: peak x gain = ' + ', '.join(f'{v:.2f} ({n})' for n, v in worst))
    b.click('#play'); b.sleep(0.3)
    check(b.eval('__app.audio()') is None and b.eval("document.querySelector('#play').textContent") == 'Play sound', 'Stop sound stops it')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions (including starting and stopping the sound)' + ('' if not errors else ': ' + '; '.join(errors[:3])))
    # Links: #setup= opens an experiment, #preset= a preset.
    b.goto('fourier/index.html?reload#setup=missing'); b.wait('window.__app && __app.ready'); b.sleep(0.4)
    check(b.eval('[__app.state.preset, __app.state.f1, __app.state.terms]') == ['missing', 150, 6], '#setup=missing opens the missing fundamental at 150 Hz')
    b.goto('fourier/index.html?reload2#preset=triangle'); b.wait('window.__app && __app.ready'); b.sleep(0.4)
    check(b.eval('__app.state.preset') == 'triangle', '#preset=triangle opens the triangle wave')

    # The hints and the Start-here text stand out from their backgrounds, light and dark.
    CONTRAST = """((sel) => { const e = document.querySelector(sel);
        const lum = (c) => { const [r, g, b] = c.match(/\\d+/g).map((v) => { v = v / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        let bg = 'rgba(0, 0, 0, 0)', p = e; while (p && /rgba\\(0, 0, 0, 0\\)|transparent/.test(bg)) { bg = getComputedStyle(p).backgroundColor; p = p.parentElement; }
        const a = lum(getComputedStyle(e).color), c = lum(bg); return (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05); })"""
    for theme in ('light', 'dark'):
        b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': theme}]); b.sleep(0.4)
        ratios = [b.eval(f'{CONTRAST}({json.dumps(s)})') for s in ('#wave-note', '#spectrum-note', '#help section.start p')]
        check(all(r > 4.5 for r in ratios), f'{theme} theme: the hints and the Start-here text stand out from their backgrounds (contrast {[round(r, 1) for r in ratios]})')
        if theme == 'dark': b.screenshot('build/fs-dark.png')
    # A phone: both pictures and their hints are on the first screen.
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'light'}])
    b.call('Emulation.setDeviceMetricsOverride', width=420, height=800, deviceScaleFactor=1, mobile=True)
    b.goto('fourier/index.html?phone'); b.wait('window.__app && __app.ready'); b.sleep(0.6)
    h = b.eval(HINTS)
    spec = b.eval("document.querySelector('#spectrum').getBoundingClientRect().top")
    check(len(h) == 2 and all(x['visible'] and x['over'] for x in h) and spec < 800, f'phone: both hints are on the first screen, over their pictures (the spectrum starts at {spec:.0f} px)')
    b.screenshot('build/fs-phone.png')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'phone and dark: no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
