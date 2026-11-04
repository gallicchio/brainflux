#!/usr/bin/env python3
"""Drive the OCT demo: the first screen, each view's pictures and hints, every experiment and
the numbers its help quotes, the drags and clicks the hints promise, the readouts keeping
still, the address, the dark theme and a phone.  The page's clock is held and stepped from here
(__app.hold, __app.step), so nothing depends on how fast the machine is."""
import json, math, os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

def run(b, name, seconds=0):
    b.eval(f'__app.setups[{json.dumps(name)}](); __app.hold(true); __app.step(0, 1)')
    if seconds: b.eval(f'__app.step(0.05, {int(seconds / 0.05)})')

def set_num(b, box, label, value):
    """Type a value into the number box of the slider in box whose label starts with label."""
    b.eval(f"""(() => {{ const s = [...document.querySelectorAll('{box} .slider')].find((e) => e.querySelector('label').textContent.trim().startsWith({json.dumps(label)}));
      const i = s.querySelector('input[type=number]'); i.value = {value}; i.dispatchEvent(new Event('change')); __app.step(0, 1); }})()""")

def press_button(b, box, text):
    b.eval(f"""(() => {{ const e = [...document.querySelectorAll('{box} button')].find((x) => x.textContent.trim().startsWith({json.dumps(text)})); e.click(); __app.step(0, 1); }})()""")

def visible_hints(b):
    return b.eval("[...document.querySelectorAll('.hint')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map((e) => e.textContent.trim())")

def phrase(text):
    return re.sub(r'[−+-]?\d[\d.,]*(?:e[−+-]?\d+)?', '#', text)

def keeps_still(b, sel, steps):
    """Run steps (callables that change the numbers) and compare the boxes of sel's elements
    with those first seen with the same words.  Returns (largest shift px, compared, texts)."""
    texts = f"[...document.querySelectorAll({json.dumps(sel)})].map((e) => e.textContent).join(' | ')"
    first = {phrase(b.eval(texts)): b.rects(sel)}
    worst, compared, seen = 0.0, 0, set()
    for step in steps:
        step()
        r, t = b.rects(sel), b.eval(texts)
        seen.add(t)
        r0 = first.setdefault(phrase(t), r)
        if r0 is r or len(r) != len(r0): continue
        compared += 1
        worst = max([worst] + [abs(x - y) for a, c in zip(r0, r) for x, y in zip(a, c)])
    return worst, compared, seen

def lum(css):
    m = [float(v) for v in re.findall(r'[\d.]+', css)[:3]]
    return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255

with Browser('oct/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready', timeout=90)
    b.eval('__app.hold(true)')
    b.screenshot('build/oct-start.png')

    # ---------------------------------------------------------------- the first screen
    st = b.eval('({ view: __app.view, motor: __app.F.state.motor, lam: __app.src.lamNm, bw: __app.src.fwhmNm, z: __app.F.state.z })')
    check(st == {'view': 'fringes', 'motor': 'sweep', 'lam': 840, 'bw': 50, 'z': 50}, f'opens on view 1, one surface at 50 μm, the motor sweeping, 840/50 nm light ({st})')
    d0 = b.eval('__app.F.state.d'); b.eval('__app.step(0.05, 40)'); d1 = b.eval('__app.F.state.d')
    check(abs(d1 - d0) > 5, f'the motor moves the mirror by itself ({d0:.2f} → {d1:.2f} μm in 2 s of the page\'s clock)')
    hints = visible_hints(b)
    check(len(hints) == 1 and hints[0].startswith('Drag the reference mirror') and 'fringes appear only' in hints[0], f'one hint, under the interferometer, says what to drag ({hints})')
    hb, sb = b.box('#f-hint'), b.box('#f-schem')
    check(hb[1] >= sb[1] + sb[3] - 1 and hb[1] + hb[3] <= 900, f'the hint is directly under the drawing, on the first screen (at {hb[1]:.0f}–{hb[1] + hb[3]:.0f} px)')
    order = b.eval("[...document.querySelectorAll('#help > section, #help > article')].map((e) => e.className || e.id)")
    start_html = b.eval("document.querySelector('#help .start').innerHTML")
    start = b.eval("document.querySelector('#help .start').innerText")
    check(order[0] == 'start' and order[-1] == 'how' and 'math' not in start_html and '$' not in start and 'Drag the' in start and 'interferometer demo' in start,
          f'the drawer opens with Start here (plain words, no equations), and ends with How it works ({len(order)} parts)')
    names = b.eval('Object.keys(__app.setups)')
    arts = b.eval("[...document.querySelectorAll('#help .exp')].map((e) => e.dataset.setup)")
    check(arts == names and len(names) == 18, f'every experiment has a set-up and every set-up an experiment ({len(names)})')
    check(b.eval("document.querySelectorAll('#help merror').length") == 0, 'every equation in the help renders (no unknown TeX)')
    labels = b.eval("[...document.querySelectorAll('.controls .slider label')].map((e) => e.textContent.trim())")
    bare = [l for l in labels if not re.search(r'[a-z]{3,}', l)]
    check(not bare, f'every slider says in words what it sets ({len(labels)} sliders)' + (f': not {bare}' if bare else ''))

    # ---------------------------------------------------------------- 1. one surface
    run(b, 'start')
    lc, w = b.eval('[__app.src.lc, __app.F.burstWidth(0)]')
    check(abs(lc - 6.23) < 0.005 and abs(w - lc) < 1e-6, f'exp 1: ℓ_c = 0.44 λ₀²/Δλ = {lc:.3f} μm, the burst {w:.3f} μm wide at half height (help: 6.23)')
    check(abs(lc / 0.42 - 14.8) < 0.1, f'exp 1: {lc / 0.42:.1f} fringes of λ₀/2 = 420 nm within the burst\'s half height (help: about 15)')
    # Drag the mirror on the drawing: it moves and the motor stops.
    m = b.eval('(() => { const r = document.querySelector("#f-schem").getBoundingClientRect(); return r; })()')
    hits = b.eval('(() => { __app.step(0, 1); const c = document.querySelector("#f-schem"); return null; })()')
    pos = b.eval("""(() => { const h = __app.F.peek(); return null; })()""")
    d0 = b.eval('__app.F.state.d')
    # Find the mirror's grip: scan the drawing for where a press grabs it.
    grip = b.eval("""(() => { const c = document.querySelector('#f-schem'), r = c.getBoundingClientRect();
      for (let y = 0.2; y < 0.5; y += 0.01) for (let x = 0.5; x < 0.95; x += 0.005) {
        const ev = new PointerEvent('pointermove', { clientX: r.left + x * r.width, clientY: r.top + y * r.height, bubbles: true }); c.dispatchEvent(ev);
        if (c.style.cursor === 'ew-resize') return [x, y]; }
      return null; })()""")
    if grip:
        b.drag('#f-schem', tuple(grip), (grip[0] + 0.06, grip[1]), steps=8); b.eval('__app.step(0, 1)')
    d1, motor = b.eval('[__app.F.state.d, __app.F.state.motor]')
    check(grip is not None and d1 > d0 + 2 and motor == 'stop', f'dragging the reference mirror moves it ({d0:.2f} → {d1:.2f} μm) and stops the motor')
    b.click('#f-trace', (0.5, 0.5)); b.eval('__app.step(0, 1)')
    win = b.eval('__app.F.state.win'); dc = b.eval('__app.F.state.d')
    check(abs(dc - (win[0] + 0.5 * (win[1] - win[0]))) < 0.05 * (win[1] - win[0]), f'a click on the trace puts the mirror there ({dc:.2f} μm, window {win[0]:.0f}–{win[1]:.0f})')
    # Drag a ◇ on the spectrum: the bandwidth follows.
    spec = b.box('#f-spec')
    hx = b.eval("""(() => { const c = document.querySelector('#f-spec'), r = c.getBoundingClientRect();
      for (let x = 0.5; x < 1; x += 0.002) for (let y = 0.3; y < 0.8; y += 0.02) { c.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + x * r.width, clientY: r.top + y * r.height, bubbles: true })); if (c.style.cursor === 'ew-resize') return [x, y]; }
      return null; })()""")
    if hx: b.drag('#f-spec', tuple(hx), (hx[0] + 0.08, hx[1]), steps=6); b.eval('__app.step(0, 1)')
    bw = b.eval('__app.src.fwhmNm')
    check(hx is not None and bw > 60, f'dragging a ◇ on the spectrum widens the light (Δλ 50 → {bw:.1f} nm)')
    b.screenshot('build/oct-dragged.png')

    # ---------------------------------------------------------------- 2. bandwidth
    run(b, 'bandwidth')
    got = []
    for nm, want in ((10, 31.14), (25, 12.45), (50, 6.23), (100, 3.11), (150, 2.08)):
        set_num(b, '#bw-box', 'bandwidth', nm)
        got.append((nm, b.eval('__app.F.burstWidth(0)'), want))
    check(all(abs(g - want) < 0.006 for _, g, want in got), 'exp 2: burst widths ' + ', '.join(f'{nm} nm → {g:.2f} μm' for nm, g, _ in got) + ' (help: 31.1, 12.45, 6.23, 3.11, 2.08)')
    set_num(b, '#bw-box', 'bandwidth', 0.05)
    laser = b.eval('__app.src.lc')
    press_button(b, '#lam-box', '1300'); set_num(b, '#bw-box', 'bandwidth', 50)
    l1300 = b.eval('__app.F.burstWidth(0)')
    press_button(b, '#lam-box', '840')
    check(abs(laser - 6227) < 1 and abs(l1300 - 14.91) < 0.01, f'exp 2: a laser\'s 0.05 nm gives {laser / 1000:.2f} mm; 1300/50 nm gives {l1300:.2f} μm (help: 6.2 mm, 14.9 μm)')

    # ---------------------------------------------------------------- 3. two surfaces
    run(b, 'two')
    sep, front, back = b.eval('[__app.F.burstCentre(1) - __app.F.burstCentre(0), __app.F.signal(40), __app.F.signal(190)]')
    check(abs(sep - 150) < 1e-3 and abs(front - 1.48) < 0.005 and abs(back - 0.69) < 0.005, f'exp 3: bursts {sep:.3f} μm apart (n t = 150); the front face\'s centre a bright fringe ({front:.3f}), the back face\'s dark ({back:.3f})')
    set_num(b, '#f-plate-box', 'index', 1.33)
    sep2 = b.eval('__app.F.burstCentre(1) - __app.F.burstCentre(0)')
    check(abs(sep2 - 133) < 1e-3, f'exp 3: at n = 1.33 the bursts are {sep2:.2f} μm apart')

    # ---------------------------------------------------------------- 4. dispersion
    run(b, 'dispersion')
    w150 = b.eval('__app.F.burstWidth(0)')
    set_num(b, '#bw-box', 'bandwidth', 50); w50 = b.eval('__app.F.burstWidth(0)')
    press_button(b, '#lam-box', '1300'); w13 = b.eval('[__app.F.burstWidth(0), __app.src.lc]')
    press_button(b, '#lam-box', '840')
    check(abs(w150 - 10.06) < 0.01 and abs(w50 - 7.04) < 0.01 and abs(w13[0] - 14.92) < 0.01 and abs(w13[1] - 14.91) < 0.01,
          f'exp 4: 2 mm of BK7 spreads the burst to {w150:.2f} μm at 150 nm, {w50:.2f} at 50 nm, {w13[0]:.2f} at 1300 nm (ℓ_c {w13[1]:.2f}) (help: 10.06, 7.04, 14.92)')
    b.screenshot('build/oct-dispersion.png')

    # ---------------------------------------------------------------- 2 · the A-scan
    run(b, 'ascan')
    hints = visible_hints(b)
    check(len(hints) == 1 and hints[0].startswith('The motor scans the reference mirror'), f'view 2: one hint under the sample ({hints[0][:40]}...)')
    d0 = b.eval('__app.A.state.d'); b.eval('__app.step(0.05, 40)'); d1 = b.eval('__app.A.state.d')
    check(d1 > d0 + 50, f'view 2 opens with the motor scanning ({d0:.0f} → {d1:.0f} μm in 2 s)')
    b.eval('__app.A.wholeScan(); __app.step(0, 1)')
    pk = b.eval('__app.A.foundPeaks()')
    check(len(pk) == 2 and abs(pk[0]['d'] - 20) < 0.02 and abs(pk[1]['d'] - 278.4) < 0.03 and abs(pk[0]['a'] - 0.206) < 0.001 and abs(pk[1]['a'] - 0.199) < 0.001,
          f"exp 5: the cover slip's peaks at {pk[0]['d']:.2f} and {pk[1]['d']:.2f} μm, {pk[0]['a']:.3f} and {pk[1]['a']:.3f} high (help: 20.00, 278.39; 0.206, 0.199)")
    b.click('#a-scan', (0.5, 0.5)); b.eval('__app.step(0, 1)')
    r = b.eval('__app.A.peek().range'); dn = b.eval('__app.A.state.d')
    check(abs(dn - 0.5 * (r[0] + r[1])) < 0.08 * (r[1] - r[0]) and b.eval('__app.A.state.motor') == 'stop', f'a click on the A-scan puts the mirror there ({dn:.0f} μm) and stops the motor')
    b.screenshot('build/oct-ascan.png')

    run(b, 'resolution')
    def peaks_at(g):
        set_num(b, '#a-gap-box', 'gap', g); b.eval('__app.A.wholeScan()')
        return b.eval('__app.A.foundPeaks().map((p) => p.d)')
    p8, p4, p42, p5 = peaks_at(8), peaks_at(4), peaks_at(4.2), peaks_at(5)
    check(len(p8) == 2 and len(p4) == 2 and abs(p4[0] - 19.11) < 0.02 and abs(p4[1] - 24.94) < 0.02 and len(p42) == 1 and len(p5) == 1,
          f'exp 6: two peaks at 8 μm; at 4.00 μm two, at {p4[0]:.2f} and {p4[1]:.2f}; one at 4.2 and at 5.0 μm (help: 19.11, 24.94)')
    always = all(len(peaks_at(5.5 + 0.1 * k)) == 2 for k in range(16))
    windows = [g for g in [round(3.0 + 0.05 * k, 2) for k in range(49)] if len(peaks_at(g)) == 2]
    starts = [g for g in windows if round(g - 0.05, 2) not in windows]
    gaps = [round(b2 - a2, 2) for a2, b2 in zip(starts, starts[1:])]
    check(always and len(starts) >= 4 and all(abs(x - 0.42) < 0.06 for x in gaps), f'exp 6: always two peaks from 5.5 μm up; below, two-peak windows starting at {starts} μm, every {gaps} μm (help: every 0.42 μm, λ₀/2)')
    b.screenshot('build/oct-resolution.png')

    run(b, 'retina'); b.eval('__app.A.wholeScan()')
    counts = {}
    for nz in (-60, -45, -40, -35):
        set_num(b, '#a-noise-box', 'noise floor', nz); b.eval('__app.A.wholeScan()')
        counts[nz] = b.eval('__app.A.foundPeaks().length')
    dbs = b.eval('__app.A.peek().bursts.map((q) => 20 * Math.log10(Math.abs(q.a)))')
    check(counts == {-60: 9, -45: 5, -40: 2, -35: 1} and abs(max(dbs) + 23.1) < 0.1 and abs(min(dbs) + 36.5) < 0.1,
          f'exp 7: layers from {max(dbs):.1f} to {min(dbs):.1f} dB; peaks clear of the noise at −60, −45, −40, −35 dB: {list(counts.values())} (help: 9, 5, 2, 1)')

    # ---------------------------------------------------------------- 3 · B-scan and volume
    run(b, 'bscan')
    hints = visible_hints(b)
    check(len(hints) == 1 and 'Step' in hints[0] and 'Go on' in hints[0], f'view 3: one hint under the B-scan ({hints[0][:40]}...)')
    n0 = b.eval('__app.B.peek().next'); b.eval('__app.step(0.05, 20)'); n1 = b.eval('__app.B.peek().next')
    check(n1 >= n0 + 100, f'view 3 opens with the beam stepping across ({n0} → {n1} columns in 1 s at 128 a second)')
    b.click('#s-step'); n2 = b.eval('__app.B.peek().next'); b.click('#s-step'); n3 = b.eval('__app.B.peek().next')
    check(n3 == n2 + 1 and not b.eval('__app.B.state.playing'), f'Step measures one column and stops ({n2} → {n3})')
    b.click('#s-finish'); b.eval('__app.step(0.05, 40)')
    bs = b.eval('(() => { const p = __app.B.peek(); return { nx: p.bs.nx, count: p.bs.count, pitch: p.bs.pitch, w0: p.beam.w0, zR: p.beam.zR, lcn: __app.src.lc / p.scene.nView }; })()')
    check(bs['count'] == 512 and abs(bs['pitch'] - 5.86) < 0.01 and abs(bs['w0'] - 8.9) < 0.05 and abs(2 * bs['zR'] - 820) < 1 and abs(bs['lcn'] - 4.5) < 0.02,
          f"exp 8: Finish measures all {bs['count']} columns, {bs['pitch']:.1f} μm apart; w₀ = {bs['w0']:.1f} μm, 2z_R = {2 * bs['zR']:.0f} μm, ℓ_c/n = {bs['lcn']:.2f} μm (help: 512, 5.9, 8.9, 820, 4.5)")
    b.click('#s-bscan', (0.3, 0.6)); b.eval('__app.step(0, 1)')
    probe = b.eval('__app.B.state.probe')
    check(probe is not None and abs(probe - 0.3 * 512) < 30, f'a click on the B-scan picks that column ({probe})')
    # Pointing names what is there.
    b.eval("""(() => { const c = document.querySelector('#s-bscan'), r = c.getBoundingClientRect(); c.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + 0.2 * r.width, clientY: r.top + 0.62 * r.height, bubbles: true })); __app.step(0, 1); })()""")
    said = b.eval("document.querySelector('#s-readout-3').textContent")
    check(said.startswith('At x =') and any(w in said for w in ('photoreceptors', 'pigment', 'nuclear', 'plexiform', 'choroid')), f'pointing at the B-scan names the layer there ({said})')
    b.screenshot('build/oct-bscan.png')

    run(b, 'speckle')
    sp = b.eval("""(() => { const p = __app.B.peek(), bs = p.bs, sc = p.scene; const img = bs.img.slice(); return { nz: bs.nz }; })()""")
    contrast = b.eval("""(() => { const p = __app.B.peek(), bs = p.bs, sc = p.scene, nz = bs.nz, speck = bs.img.slice();
      document.querySelector('#s-toggles button:nth-child(2)').click(); __app.B.finishNow();
      const mean = bs.img; let s = 0, s2 = 0, n = 0;
      for (let ix = 0; ix < bs.nx; ix += 2) { const prof = sc.profile(bs.x(ix), 0);
        for (let m = 0; m < nz; m++) { const d = m * bs.hd; if (!((d > prof.dtops[5] + 8 && d < prof.dtops[6] - 8) || (d > prof.dtops[8] + 15 && d < prof.dtops[8] + 200))) continue;
          if (sc.inLesion(bs.x(ix), 0, d / 1.38)) continue; const r = (speck[ix * nz + m] / mean[ix * nz + m]) ** 2; s += r; s2 += r * r; n++; } }
      const mu = s / n; document.querySelector('#s-toggles button:nth-child(2)').click(); __app.B.finishNow(); return [mu, Math.sqrt(s2 / n - mu * mu) / mu, n]; })()""")
    check(abs(contrast[0] - 1) < 0.08 and 1.1 < contrast[1] < 1.45, f'exp 9: speckle averages to the speckle-free picture ({contrast[0]:.3f}) with a contrast of {contrast[1]:.2f} (help: about 1.3)')
    run(b, 'speckle')
    c1, said = b.eval("[__app.B.peek().chist[0], document.querySelector('#s-readout-4').textContent]")
    check(abs(c1 - 1.31) < 0.005 and '1.31' in said and 'fully developed speckle: 1' in said, f'exp 9: the readout measures the speckle contrast, {c1:.3f} ({said}) (help: 1.31)')
    before = b.eval('Array.from(__app.B.peek().bs.img.subarray(300 * 384, 300 * 384 + 200))')
    b.click('#s-reseed'); b.eval('__app.B.finishNow()')
    after = b.eval('Array.from(__app.B.peek().bs.img.subarray(300 * 384, 300 * 384 + 200))')
    check(sum(abs(x - y) for x, y in zip(before, after)) > 0.01, 'New speckle moves the grains')

    # ---------------------------------------------------------------- 10. averaging B-scans
    run(b, 'average')
    hints = visible_hints(b)
    st = b.eval('[__app.B.state.avg, __app.B.state.rate, __app.B.peek().bs.N, __app.B.state.how]')
    check(st == [16, 1024, 16, 'tissue'] and len(hints) == 1, f'exp 10: sixteen B-scans of the tissue at 1024 A-scans a second, one hint ({st})')
    b.eval('__app.step(0.05, 12)')
    n1 = b.eval('__app.B.peek().next')
    check(n1 > 0 and b.eval('__app.B.state.playing'), f'exp 10 opens scanning ({n1} columns of the repeats measured in 0.6 s of the page\'s clock)')
    b.eval('__app.B.finishNow(); __app.step(0, 1)')
    ch = b.eval('__app.B.peek().chist')
    exp = b.eval('(() => { const p = __app.B.peek(); return [2, 4, 8, 16].map((k) => p.chist[0] * p.expectedFactor(k)); })()')
    want = {1: 1.31, 2: 0.93, 4: 0.66, 8: 0.47, 16: 0.33}
    check(len(ch) == 16 and all(abs(ch[k - 1] - v) < 0.0051 for k, v in want.items()) and all(abs(e - v) < 0.0051 for e, v in zip(exp, (0.92, 0.65, 0.46, 0.33))),
          'exp 10: the contrast after 1, 2, 4, 8, 16 B-scans: ' + ', '.join(f'{ch[k - 1]:.3f}' for k in want) + '; C₁/√N: ' + ', '.join(f'{e:.3f}' for e in exp) + ' (help: 1.31, 0.93, 0.66, 0.47, 0.33; 0.92, 0.65, 0.46, 0.33)')
    check(all(ch[k] < ch[k - 1] for k in range(1, 16)), 'exp 10: every B-scan averaged in lowers the contrast')
    said = b.eval("document.querySelector('#s-readout-4').textContent")
    check('one B-scan 1.31' in said and 'average of 16: 0.33' in said and '√16 = 0.33' in said, f'exp 10: the readout says it ({said})')
    # The layers stay: the averaged picture's brightness against the speckle-free one's, and the layers' order unchanged.
    mean = b.eval("""(() => { const p = __app.B.peek(), bs = p.bs, nz = bs.nz; let s = 0, n = 0;
      for (const ix of p.refCols) for (let m = 0; m < nz; m++) { const r = p.ref[ix * nz + m]; if (r > 1e-3) { s += (bs.img[ix * nz + m] / r) ** 2; n++; } } return s / n; })()""")
    check(abs(mean - 1) < 0.05, f'exp 10: the averaged picture is as bright as the speckle-free one ({mean:.3f})')
    plot = b.box('#s-cplot')
    check(plot[2] > 200 and plot[3] > 80 and b.eval("document.querySelector('#s-foot').classList.contains('with-plot')"), f'exp 10: the contrast against N is drawn beside the readout ({plot[2]:.0f} × {plot[3]:.0f} px)')
    b.screenshot('build/oct-average.png')
    # The beam moves instead: by 0, half the waist, the waist, twice it.
    b.eval("document.querySelector('#s-avg-more').open = true")
    press_button(b, '#s-how-box', 'The beam')
    got = {}
    for step in (0, 4.5, 9, 18):
        set_num(b, '#s-how-box', 'beam step', step); b.eval('__app.B.finishNow(); __app.step(0, 1)')
        got[step] = b.eval('(() => { const p = __app.B.peek(); return [p.chist[15], p.chist[0] * p.expectedFactor(16), p.bs.how, p.bs.step]; })()')
    check(all(g[2] == 'beam' and g[3] == s for s, g in got.items()) and abs(got[0][0] - 1.30) < 0.0051 and abs(got[4.5][0] - 0.53) < 0.0051 and abs(got[9][0] - 0.38) < 0.0051 and abs(got[18][0] - 0.33) < 0.0051
          and all(abs(g[0] - g[1]) < 0.012 for g in got.values()),
          'exp 10: the beam stepped by 0, 4.5, 9, 18 μm: ' + ', '.join(f'{g[0]:.3f} (expected {g[1]:.3f})' for g in got.values()) + ' after 16 (help: 1.30, 0.53, 0.38, 0.33)')
    w0 = b.eval('__app.B.peek().beam.w0')
    check(abs(w0 - 8.9) < 0.05, f'exp 10: the waist w₀ = {w0:.2f} μm (help: 8.9)')
    press_button(b, '#s-avg-box', '1')
    check(b.eval('__app.B.peek().bs.N') == 1 and not b.eval("document.querySelector('#s-foot').classList.contains('with-plot')"), 'one B-scan again: no averaging, no plot')

    run(b, 'lateral')
    def beads(NA):
        set_num(b, '#s-beam-box', 'aperture NA', NA); b.eval('__app.B.finishNow()')
        return b.eval("""(() => { const p = __app.B.peek(), bs = p.bs, sc = p.scene, out = [];
          const width = (A, j, h) => { const half = A[j] / 2; let lo = j, hi = j; while (lo > 0 && A[lo] > half) lo--; while (hi + 1 < A.length && A[hi] > half) hi++;
            return (hi - 1 + (A[hi - 1] - half) / (A[hi - 1] - A[hi]) - (lo + 1 - (A[lo + 1] - half) / (A[lo + 1] - A[lo]))) * h; };
          for (const z of [100, 200, 300, 600]) { const d = sc.zToD(sc.profile(0, 0), z), m0 = Math.round(d / bs.hd), ic = Math.round(300 / bs.pitch - 0.5);
            let best = 0, mb = m0, jb = ic; for (let q = m0 - 3; q <= m0 + 3; q++) for (let j = ic - 3; j <= ic + 3; j++) { const v = bs.img[j * bs.nz + q]; if (v > best) { best = v; mb = q; jb = j; } }
            const row = new Float64Array(bs.nx); for (let ix = 0; ix < bs.nx; ix++) row[ix] = bs.img[ix * bs.nz + mb];
            out.push([z, width(row, jb, bs.pitch), width(bs.img.subarray(jb * bs.nz, (jb + 1) * bs.nz), mb, bs.hd) / sc.nView]); }
          return { w0: p.beam.w0, zR: p.beam.zR, beads: out }; })()""")
    r1 = beads(0.1)
    wz = {z: (a, d) for z, a, d in r1['beads']}
    check(abs(r1['w0'] - 2.67) < 0.01 and abs(2 * r1['zR'] - 71) < 0.5 and abs(wz[300][0] - 3.3) < 0.15 and abs(wz[200][0] - 9.5) < 0.15 and abs(wz[600][0] - 26.8) < 0.2,
          f"exp 11: NA 0.1: w₀ = {r1['w0']:.2f} μm, 2z_R = {2 * r1['zR']:.0f} μm; a bead {wz[300][0]:.1f} μm wide at the focus, {wz[200][0]:.1f} at 100 μm from it, {wz[600][0]:.1f} at 300 μm (help: 2.7, 71, 3.3, 9.5, 26.8)")
    check(all(abs(d - 4.7) < 0.06 for a, d in wz.values()), 'exp 11: every bead ' + ', '.join(f'{d:.2f}' for a, d in wz.values()) + ' μm deep, ℓ_c/n = 4.68 (help: 4.7)')
    r2 = beads(0.02)
    check(abs(r2['w0'] - 13.4) < 0.05 and abs(2 * r2['zR'] - 1778) < 2 and all(15.5 < a < 17 and abs(d - 4.7) < 0.06 for z, a, d in r2['beads']),
          f"exp 11: NA 0.02: w₀ = {r2['w0']:.1f} μm, depth of focus {2 * r2['zR'] / 1000:.2f} mm, beads " + ', '.join(f'{a:.1f}' for z, a, d in r2['beads']) + ' μm wide (help: 13.4, 1.78 mm, 16)')
    b.screenshot('build/oct-beads.png')

    run(b, 'tilt')
    t = b.eval("""(() => { const p = __app.B.peek(), bs = p.bs, sc = p.scene, pts = [];
      for (let ix = 0; ix < bs.nx; ix++) { let best = 0, bm = 0; const z0 = sc.zTop(bs.x(ix), 0); for (let m = 0; m < bs.nz; m++) { const d = m * bs.hd; if (Math.abs(d - z0) > 20) continue; const v = bs.img[ix * bs.nz + m]; if (v > best) { best = v; bm = m; } } pts.push([bs.x(ix), bm * bs.hd]); }
      let sx = 0, sd = 0, sxx = 0, sxd = 0; for (const [x, d] of pts) { sx += x; sd += d; sxx += x * x; sxd += x * d; } const n = pts.length, sl = (n * sxd - sx * sd) / (n * sxx - sx * sx);
      const prof = sc.profile(0, 0); return [Math.atan(sl) * 180 / Math.PI, prof.dtops[1] - prof.dtops[0], prof.tops[1] - prof.tops[0]]; })()""")
    check(abs(t[0] - 5) < 0.01 and abs(t[1] - 300) < 1e-6 and abs(t[2] - 200) < 1e-6, f'exp 12: the front face comes out at {t[0]:.3f}°; the paint {t[1]:.0f} μm below it in the image, {t[2]:.0f} μm in the glass (help: 5.00°, 300, 200)')

    run(b, 'volume')
    hints = visible_hints(b)
    check(len(hints) == 1 and hints[0].startswith('Click or drag on any slice'), f'the volume has its own hint ({hints[0][:40]}...)')
    b.eval('__app.B.finishNow(); __app.step(0, 1)')
    v = b.eval("""(() => { const p = __app.B.peek(), v = p.vol, s = __app.B.state; return { nx: v.nx, ny: v.ny, nz: v.nz, count: v.count, depth: (s.m + 0.5) * v.hd / p.scene.nView,
      x: v.x(s.ix), y: v.y(s.iy), inCyst: p.scene.inLesion(v.x(s.ix), v.y(s.iy), p.scene.zSurf(v.x(s.ix), v.y(s.iy)) + p.scene.lesion.dz) }; })()""")
    check(v['nx'] * v['ny'] * v['nz'] == 1048576 and v['count'] == 64 and abs(v['depth'] - 212) < 1 and v['inCyst'],
          f"exp 13: 64 B-scans of 64 A-scans of 256 depths; the en-face plane at {v['depth']:.0f} μm, the slices crossing in the cyst (help: 212 μm)")
    # The cyst is dark in the en-face plane, the tissue around it bright; the pit's centre dark too.
    en = b.eval("""(() => { const p = __app.B.peek(), v = p.vol, s = __app.B.state, xy = v.sliceXY(s.m - 2, s.m + 2), at = (x, y) => { const ix = Math.round((x + 1500) / v.pitch - 0.5), iy = Math.round((y + 1500) / v.pitchY - 0.5); return xy[iy * v.nx + ix]; };
      const ring = []; for (let a = 0; a < 6.28; a += 0.5) ring.push(at(680 + 330 * Math.cos(a), 60 + 330 * Math.sin(a)));
      ring.sort((p, q) => p - q); return [at(680, 60), ring[Math.floor(ring.length / 2)], at(0, 0)]; })()""")
    check(en[0] < 0.2 * en[1] and en[2] < 0.2 * en[1], f'exp 13: in the en-face plane the cyst ({en[0]:.4f}) and the pit\'s centre ({en[2]:.4f}) are dark against the tissue around ({en[1]:.4f})')
    layers = lambda: b.eval('(() => { const st = __app.B.peek().slabLayers(); return { layers: st.layers, counts: Object.fromEntries([...st.counts].map(([k, v]) => [k, 100 * v / st.total])) }; })()')
    L13 = layers()
    check(L13['layers'] == 6 and abs(L13['counts']['inner plexiform'] - 50) < 0.5, f"exp 13: the flat plane lies in {L13['layers']} layers, the inner plexiform under {L13['counts']['inner plexiform']:.1f}% of the A-scans (help: six, half)")
    b.click('#s-xy', (0.25, 0.75)); b.eval('__app.step(0, 1)')
    s2 = b.eval('[__app.B.state.ix, __app.B.state.iy]')
    check(s2[0] < 32 and s2[1] > 32, f'a click on the en-face plane moves the other two slices there (ix, iy = {s2})')
    b.screenshot('build/oct-volume.png')

    # ---------------------------------------------------------------- 14. a flattened slab
    run(b, 'flatten')
    b.eval('__app.B.finishNow(); __app.step(0, 1)')
    st = b.eval('[__app.B.state.mode, __app.B.state.follow, __app.B.state.layer, __app.B.state.below, __app.B.state.slab]')
    note = b.eval("document.querySelector('#s-xy-note').textContent")
    L = layers()
    check(st == ['volume', True, 7, 11, 12] and L['counts'] == {'pigment epithelium': 100} and 'following the pigment epithelium' in note,
          f'exp 14: the slab follows the pigment epithelium 11 μm below its top, 12 μm thick, and lies in it under all 4096 A-scans ({L}; "{note}")')
    rows = b.eval('(() => { const p = __app.B.peek(), v = p.vol, out = []; for (let ix = 0; ix < 64; ix++) out.push(v.followRow(p.layerD[32 * 64 + ix], 11)); return out; })()')
    rise = b.eval('(() => { const p = __app.B.peek(), v = p.vol, sc = p.scene, d = (ix, iy) => sc.profile(v.x(ix), v.y(iy)).dtops[7] / sc.nView; return [d(32, 32) - d(0, 32), d(32, 32) - d(0, 0)]; })()')
    check(max(rows) - min(rows) > 10 and abs(rise[0] - 48) < 0.5 and abs(rise[1] - 101) < 0.5,
          f'exp 14: the slab curves with the layer ({max(rows) - min(rows):.1f} samples across the B-scan); in the picture the layer rises {rise[0]:.1f} μm from the middle to an edge, {rise[1]:.1f} to a corner (help: 48, 101)')
    xs = b.eval('(() => { const r = document.querySelector("#s-xy").getBoundingClientRect(); return [r.width, r.height]; })()')
    press_button(b, '#s-follow-box', 'Flat plane')
    st = b.eval('(() => { const s = __app.B.state, p = __app.B.peek(); return [s.follow, (s.m + 0.5) * p.vol.hd / p.scene.nView]; })()')
    L = layers()
    c = L['counts']
    check(not st[0] and abs(st[1] - 400) < 1 and L['layers'] == 3 and abs(c['photoreceptors'] - 38) < 0.5 and abs(c['pigment epithelium'] - 32) < 0.5 and abs(c['choroid'] - 30) < 0.6,
          f"exp 14: Flat plane goes to the slab's mean depth, {st[1]:.0f} μm, in {L['layers']} layers: photoreceptors {c['photoreceptors']:.1f}%, pigment epithelium {c['pigment epithelium']:.1f}%, choroid {c['choroid']:.1f}% (help: 400, three, 38, 32, the rest)")
    said = b.eval("document.querySelector('#s-readout-4').textContent")
    check('a flat plane' in said and re.search(r'\b3 layers', said) and re.search(r'photoreceptors, under\s*38%', said), f'exp 14: the readout names them ({said})')
    press_button(b, '#s-follow-box', 'Follow a layer'); set_num(b, '#s-follow-box', 'below the layer', -18)
    L18 = layers()
    press_button(b, '#s-follow-box', 'Flat plane')
    L18f = layers()
    check(L18['counts'] == {'photoreceptors': 100} and L18f['layers'] == 4, f"exp 14: 18 μm above the pigment epithelium: {L18['counts']}; the flat plane at the same mean depth: {L18f['layers']} layers (help: every A-scan, four)")
    press_button(b, '#s-follow-box', 'Follow a layer'); press_button(b, '#s-follow-box', 'the surface'); set_num(b, '#s-follow-box', 'below the layer', 95)
    L95 = layers()
    oval = b.eval("""(() => { const p = __app.B.peek(), v = p.vol, sc = p.scene, L = sc.lesion; let n = 0;
      for (let iy = 0; iy < 64; iy++) for (let ix = 0; ix < 64; ix++) { const x = v.x(ix), y = v.y(iy); if (((x - L.x) / L.rx) ** 2 + ((y - L.y) / L.ry) ** 2 < 1) n++; } return [n, L.rx, L.ry]; })()""")
    check(abs(L95['counts'].get('the cyst', 0) * 40.96 - oval[0]) <= 2 and L95['counts']['ganglion cells'] > 75 and oval[1:] == [200, 170],
          f"exp 14: 95 μm below the surface the slab crosses the cyst under all {oval[0]} A-scans of its 0.40 × 0.34 mm oval, and is mostly the ganglion cells ({L95['counts']['ganglion cells']:.0f}%)")
    # A click on a cross-section, following a layer, sets the depth below it.
    b.click('#s-xz', (0.5, 0.5)); b.eval('__app.step(0, 1)')
    below = b.eval('__app.B.state.below')
    check(below != 95 and b.eval('__app.B.state.follow'), f'a click on the B-scan slice moves the following slab to that depth below the layer ({below} μm)')
    b.screenshot('build/oct-flatten.png')

    # ---------------------------------------------------------------- 4 · Fourier domain
    run(b, 'fourier')
    hints = visible_hints(b)
    check(len(hints) == 1 and 'stage motor' in hints[0], f'view 4: one hint under the A-scan ({hints[0][:40]}...)')
    o0 = b.eval('__app.Q.state.offset'); b.eval('__app.step(0.05, 20)'); o1 = b.eval('__app.Q.state.offset')
    check(abs(o1 - o0) > 5, f'view 4 opens with the stage motor moving the sample ({o0:.1f} → {o1:.1f} μm)')
    fr = []
    for off in (25, 50, 100):
        b.eval(f'__app.Q.configure({{ ...__app.Q.state, offset: {off}, motor: false }}); __app.step(0, 1)')
        p = b.eval('(() => { const q = __app.Q.peek(); return [__app.Q.foundPeaks(), (q.spec.kHi - q.spec.kLo) * 2 * __app.Q.state.offset / (2 * Math.PI)]; })()')
        fr.append((off, p[1], p[0]))
    p50 = fr[1][2][0]
    check([round(f, 1) for _, f, _ in fr] == [10.6, 21.2, 42.5] and abs(p50['d'] - 50) < 0.01 and abs(p50['a'] - 0.1995) < 0.0005,
          f"exp 15: fringes across the camera at 25, 50, 100 μm: {[round(f, 1) for _, f, _ in fr]}; the peak at {p50['d']:.2f} μm, {p50['a']:.4f} high (help: 10.6, 21.2, 42.5; 50.00, 0.1995)")
    b.eval('__app.Q.configure({ ...__app.Q.state, sample: "slide", offset: 60, motor: false, pick: 1 }); __app.step(0, 1)')
    pk = b.eval('__app.Q.foundPeaks().map((p) => p.d)')
    check(len(pk) == 3 and abs(pk[1] - 258.4) < 0.05, f'exp 15: the cover slip shows its faces and their light interfering, at {pk[1]:.2f} μm (help: 258.4)')
    picked = b.eval('__app.Q.state.pick')
    f = b.eval('(() => { const r = document.querySelector("#q-scan").getBoundingClientRect(); return [r.width, r.height]; })()')
    b.click('#q-scan', ((52 + (60 / 1204.2) * (f[0] - 66)) / f[0], 0.5)); b.eval('__app.step(0, 1)')
    check(b.eval('__app.Q.state.pick') == 0 and picked == 1, f'clicking the front face\'s marker picks it (pick {picked} → {b.eval("__app.Q.state.pick")})')
    b.screenshot('build/oct-fourier.png')

    run(b, 'conjugate')
    pk = b.eval('__app.Q.foundPeaks().map((p) => +p.d.toFixed(2))')
    lay = b.eval('__app.Q.peek().bursts.map((q) => q.D / 2)')
    check(lay == [-60, -15, 75, 142.5] and all(any(abs(p - want) < 0.05 for p in pk) for want in (15, 60, 75, 142.5)), f'exp 16: layers at {lay} μm appear at 15, 60, 75 and 142.5 μm (peaks {pk})')
    b.screenshot('build/oct-conjugate.png')

    run(b, 'range')
    res = {}
    for N in (256, 512, 1024):
        press_button(b, '#q-n-box', str(N))
        res[N] = (b.eval('__app.Q.peek().dMax'), b.eval('__app.Q.foundPeaks().map((p) => [p.d, p.a])'))
    dm, p256 = res[256]
    back256 = max(p256, key=lambda q: q[0]); back512 = max(res[512][1], key=lambda q: q[0]); back1024 = max(res[1024][1], key=lambda q: q[0])
    check(abs(dm - 301.1) < 0.1 and abs(back256[0] - 283.7) < 0.1 and abs(20 * math.log10(back256[1]) + 27.3) < 0.2,
          f'exp 17: 256 pixels: range {dm:.1f} μm, the back face folded to {back256[0]:.1f} μm at {20 * math.log10(back256[1]):.1f} dB (help: 301, 283.7, −27)')
    check(abs(res[512][0] - 602.1) < 0.1 and abs(back512[0] - 318.4) < 0.05 and abs(back512[1] / 0.1976 - 0.69) < 0.01 and abs(back1024[1] / 0.1976 - 0.91) < 0.01,
          f'exp 17: 512 pixels: range {res[512][0]:.0f} μm, the face at {back512[0]:.1f} μm, {back512[1] / 0.1976:.2f} of its height ({20 * math.log10(back512[1]):.1f} dB); 1024: {back1024[1] / 0.1976:.2f} (help: 602, 318.4, 69%, −17 dB, 91%)')

    run(b, 'fdbscan')
    hints = visible_hints(b)
    check(len(hints) == 1 and 'zero path' in hints[0], f'the Fourier-domain B-scan has its own hint ({hints[0][:40]}...)')
    q = b.eval('(() => { const p = __app.Q.peek(); return [p.bscan.nx, p.dMax]; })()')
    check(q[0] == 256 and abs(q[0] / 70000 * 1000 - 3.7) < 0.05 and abs(70000 / q[0] - 273) < 1 and abs(q[1] - 1204.2) < 0.1, f'exp 18: {q[0]} A-scans: {q[0] / 70:.1f} ms a B-scan at 70,000 a second, {70000 / q[0]:.0f} a second; range {q[1]:.0f} μm (help: 3.7 ms, 270, 1204)')
    s0 = b.eval('__app.Q.state.shift'); b.eval('__app.step(0.05, 400)'); lo = b.eval('__app.Q.state.shift'); b.eval('__app.step(0.05, 400)')
    seen = b.eval('__app.Q.state.shift')
    b.eval('__app.Q.configure({ ...__app.Q.state, mode: "bscan", shift: -380, motor: false }); __app.step(0, 1)')
    b.screenshot('build/oct-fd-mirror.png')
    check(s0 != lo, f'the stage motor moves the sample ({s0:.0f} → {lo:.0f} → {seen:.0f} μm)')

    # ---------------------------------------------------------------- readouts keep still
    for name, sel, steps in (
        ('start', '#f-readout > div, #f-readout .fixnum', [lambda: b.eval('__app.step(0.1, 3)')] * 12),
        ('ascan', '#a-readout > div, #a-readout .fixnum', [lambda: b.eval('__app.step(0.1, 3)')] * 12),
        ('bscan', '#s-readout > div, #s-readout .fixnum', [lambda: b.eval('__app.step(0.1, 2)')] * 10),
        ('fourier', '#q-readout > div, #q-readout .fixnum', [lambda: b.eval('__app.step(0.1, 3)')] * 12),
    ):
        run(b, name)
        worst, compared, seen = keeps_still(b, sel, steps)
        check(worst <= 0.5 and compared >= len(steps) - 4 and len(seen) >= 3, f'{name}: the readout keeps still while its numbers change (largest shift {worst:.1f} px over {compared} changes, {len(seen)} readings)')

    # ---------------------------------------------------------------- every set-up, cleanly
    bad = []
    for name in names:
        run(b, name, 1)
        text = b.eval("[...document.querySelectorAll('.readout')].filter((e) => e.offsetParent).map((e) => e.textContent).join(' ')")
        if 'NaN' in text or 'Infinity' in text or 'undefined' in text: bad.append(f'{name}: {text[:100]}')
        b.screenshot(f'build/oct-exp-{name}.png')
    check(not bad, f'every set-up\'s readouts are numbers ({len(names)} set-ups)' + ('' if not bad else ': ' + ' | '.join(bad)))

    # ---------------------------------------------------------------- the address
    run(b, 'start')
    b.eval("__app.setView('scan')"); press_button(b, '#s-scene-box', 'Onion'); set_num(b, '#s-beam-box', 'aperture NA', 0.06)
    b.wait("location.hash.includes('scene=onion') && location.hash.includes('NA=0.06')", timeout=20)
    b.eval('__app.ready = false; location.reload()'); b.wait('window.__app && __app.ready', timeout=60); b.eval('__app.hold(true)')
    check(b.eval('__app.view') == 'scan' and b.eval('__app.B.state.scene') == 'onion' and abs(b.eval('__app.B.state.NA') - 0.06) < 1e-9, 'the address keeps view 3, the onion and NA 0.06 through a reload')
    b.eval("location.hash = '#setup=range'"); b.wait("__app.view === 'fourier' && __app.Q.state.N === 256", timeout=20)
    check(True, '#setup=range in the address opens experiment 17')
    b.eval("location.hash = '#view=fringes&lam=1300&bw=80&z=70&two=1&t=50&n=1.4'"); b.eval('__app.ready = false; location.reload()'); b.wait('window.__app && __app.ready', timeout=60)
    st = b.eval('[__app.view, __app.src.lamNm, __app.src.fwhmNm, __app.F.state.z, __app.F.state.two, __app.F.state.t, __app.F.state.n]')
    check(st == ['fringes', 1300, 80, 70, True, 50, 1.4], f'an address with the light and a plate opens them ({st})')
    # Averaging and the flattened slab are kept in the address too.
    b.eval('__app.hold(true)'); run(b, 'average'); b.eval("document.querySelector('#s-avg-more').open = true"); press_button(b, '#s-how-box', 'The beam'); set_num(b, '#s-how-box', 'beam step', 4.5)
    b.wait("location.hash.includes('avg=16') && location.hash.includes('how=beam') && location.hash.includes('step=4.5')", timeout=20)
    b.eval('__app.ready = false; location.reload()'); b.wait('window.__app && __app.ready', timeout=60); b.eval('__app.hold(true)')
    st = b.eval('[__app.view, __app.B.state.avg, __app.B.state.how, __app.B.state.step, __app.B.peek().bs.N]')
    check(st == ['scan', 16, 'beam', 4.5, 16], f'the address keeps sixteen B-scans with the beam stepped 4.5 μm through a reload ({st})')
    run(b, 'flatten'); press_button(b, '#s-follow-box', 'the surface'); set_num(b, '#s-follow-box', 'below the layer', 95)
    b.wait("location.hash.includes('follow=1') && location.hash.includes('layer=0') && location.hash.includes('below=95')", timeout=20)
    b.eval('__app.ready = false; location.reload()'); b.wait('window.__app && __app.ready', timeout=60); b.eval('__app.hold(true)')
    st = b.eval('[__app.B.state.mode, __app.B.state.follow, __app.B.state.layer, __app.B.state.below]')
    check(st == ['volume', True, 0, 95], f'the address keeps the slab following the surface 95 μm down through a reload ({st})')

    # ---------------------------------------------------------------- the worker
    # With the clock running, view 3's A-scans come from its worker; they must be the very numbers
    # the page computes itself with the clock held.  (Waits for the worker to finish, however long
    # that takes on a busy machine; nothing here depends on how fast it is.)
    sums = """(() => { const p = __app.B.peek(), a = __app.B.state.mode === 'bscan' ? p.bs.img : p.vol.data; let s = 0, s2 = 0;
      for (let i = 0; i < a.length; i++) { s += a[i]; s2 += a[i] * a[i] * ((i % 7) + 1); } return [s, s2, p.chist]; })()"""
    got = {}
    for name, extra in (('average', "__app.B.setAverage(2)"), ('volume', '')):
        b.eval(f'__app.setups.{name}(); {extra}; __app.hold(false); document.querySelector("#s-finish").click()')
        b.wait("__app.B.state.mode === 'bscan' ? __app.B.peek().next >= __app.B.peek().bs.tasks : __app.B.peek().vnext >= 4096", timeout=300)
        live = b.eval(sums)
        b.eval(f'__app.hold(true); __app.setups.{name}(); {extra}; __app.B.finishNow()')
        held = b.eval(sums)
        got[name] = (live, held)
    check(all(abs(l[0] - h[0]) <= 1e-9 * abs(h[0]) and abs(l[1] - h[1]) <= 1e-9 * abs(h[1]) and l[2] == h[2] for l, h in got.values()),
          'the worker computes the same A-scans as the page: ' + '; '.join(f'{n}: Σ {l[0]:.6g} and {h[0]:.6g}' for n, (l, h) in got.items()) + f"; contrasts {got['average'][0][2]} and {got['average'][1][2]}")

    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

# ------------------------------------------------------------------- dark, and a phone
with Browser('oct/index.html', size=(1400, 900)) as b:
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
    b.wait('window.__app && __app.ready', timeout=90); b.eval('__app.hold(true)')
    for name in ('start', 'retina', 'bscan', 'fourier'):
        run(b, name, 1); b.screenshot(f'build/oct-dark-{name}.png')
    run(b, 'start')
    b.eval("document.querySelector('#help').classList.add('open')")
    cs = b.eval("""(() => { const g = (e, p) => getComputedStyle(e)[p], s = document.querySelector('#help .start');
      return [g(document.body, 'backgroundColor'), g(document.querySelector('#f-hint'), 'color'), g(s, 'color'), g(s, 'backgroundColor')]; })()""")
    check(lum(cs[0]) < 0.15 and lum(cs[1]) - lum(cs[0]) > 0.4 and lum(cs[2]) - lum(cs[3]) > 0.5, f'dark: the page is dark, the hint ({cs[1]}) and Start here ({cs[2]} on {cs[3]}) read on it')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'dark: no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

with Browser('oct/index.html', size=(390, 844)) as b:
    b.wait('window.__app && __app.ready', timeout=90); b.eval('__app.hold(true)')
    b.screenshot('build/oct-phone-start.png')
    hb = b.box('#f-hint')
    check(hb[1] + hb[3] <= 844 and hb[3] > 0, f'phone: the hint is on the first screen (its bottom at {hb[1] + hb[3]:.0f} px)')
    wide = {}
    for name in b.eval('Object.keys(__app.setups)'):
        run(b, name, 0.5)
        wide[name] = b.eval('document.documentElement.scrollWidth')
        if name in ('start', 'ascan', 'bscan', 'volume', 'fourier', 'fdbscan'): b.screenshot(f'build/oct-phone-{name}.png')
    check(max(wide.values()) <= 390, f'phone: no sideways scrolling in any set-up (widest {max(wide.values())} px)')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'phone: no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
