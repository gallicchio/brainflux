#!/usr/bin/env python3
"""Drive the tomography demo: the first screen (three panels, hints in words, the others folded
away), the drawer (Start here first, the theory last), every experiment and the numbers its help
quotes, the scanner's physics, stepping, the colours that tie the panels together, pointing in
each direction, painting, readouts that keep still and fit, both themes, and the phone layout.

Nothing here waits on the clock: the scan is stepped (__app.stepScan) or finished at once, and
pictures are read after __app.draw() or two animation frames."""
import json, os, sys
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
    const shape = e.id + '|' + words.map((w) => w[0]).join(' ');
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
READOUTS = f"{LAYOUT}('#scan-readout, #sino-readout, #k-readout, #bp-readout, #fbp-readout, #fbp-note, #extra-readout')"
# Readouts cut short (text-overflow: ellipsis): [id, text] of each wider than its box.
CUT = "[...document.querySelectorAll('.readout, .cell-head .note, .more-panels > summary')].filter((e) => e.getClientRects().length && e.scrollWidth > e.clientWidth + 1).map((e) => [e.id, e.textContent])"
# The x of the words drawn on the scanner and the last panel around live numbers (fillText calls
# without digits): they must not move as the numbers change.
CANVAS_WORDS = r"""(() => { if (window.__words) return; window.__words = [];
  const orig = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, x, y, m) {
    const s = String(t), id = this.canvas.id;
    if ((id === 'scanner' || id === 'extra') && /^(θ = |°|angle | of )$/.test(s)) __words.push([id, s, Math.round((this.getTransform().e + x * this.getTransform().a) * 10) / 10]);
    return orig.call(this, t, x, y, m); }; })()"""
# The contrast ratio (WCAG) between an element's text and a background colour.
CONTRAST = r"""((sel, bgSel, pseudo) => { const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g).map(Number);
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  const e = document.querySelector(sel), fg = getComputedStyle(e, pseudo || null).color, bg = getComputedStyle(document.querySelector(bgSel)).backgroundColor;
  const a = lum(fg), b = lum(bg); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 10) / 10; })"""

# Finish the scan, wait for any rescan in the workers (up to a minute: the machine may be busy),
# and for two frames to be drawn.
SETTLE = """(async () => { __app.finishScan();
  for (let i = 0; i < 12000 && !__app.idle; i++) await new Promise(r => setTimeout(r, 5));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); __app.draw(); return __app.idle; })()"""
FRAMES = "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))"
def settle(b):
    check(b.eval(SETTLE), 'the scan settles')
def frames(b):
    b.eval(FRAMES); b.eval('__app.draw()')
def setup(b, name, finish=True):
    b.eval(f'__app.setups[{json.dumps(name)}]()')
    if finish: settle(b)
    else: frames(b)
def rc(b, changes):
    b.eval(f'__app.reconfigure({json.dumps(changes)})'); settle(b)

# The azimuthal average of a picture round (x0, y0) at radius r (bilinear).
RING = """((arr, x0, y0, r) => { const N = 256, h = 2 / N; let s = 0;
  for (let q = 0; q < 256; q++) { const x = x0 + r * Math.cos(q * Math.PI / 128), y = y0 + r * Math.sin(q * Math.PI / 128);
    const i = x / h + N / 2, j = N / 2 - y / h, i0 = Math.floor(i), j0 = Math.floor(j), a = i - i0, c = j - j0;
    s += (arr[j0 * N + i0] * (1 - a) + arr[j0 * N + i0 + 1] * a) * (1 - c) + (arr[(j0 + 1) * N + i0] * (1 - a) + arr[(j0 + 1) * N + i0 + 1] * a) * c; }
  return s / 256; })"""
# Pixels of a canvas near a colour (within tol in each channel).
COLOUR = """((sel, rgb, tol) => { const c = document.querySelector(sel), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - rgb[0]) <= tol && Math.abs(d[i + 1] - rgb[1]) <= tol && Math.abs(d[i + 2] - rgb[2]) <= tol) n++; return n; })"""
CYAN, MAGENTA, YELLOW = [127, 211, 255], [255, 95, 210], [255, 225, 77]
def colour(b, sel, rgb, tol=30):
    return b.eval(f'{COLOUR}({json.dumps(sel)}, {rgb}, {tol})')
# Pixels of a back-projection tinted blue (a grey picture has b = r).
TINT = """((sel) => { const c = document.querySelector(sel), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 2] - d[i] > 25) n++; return n; })"""
# The mean of (blue - red) along the slice of angle j in Fourier space, out to 0.9 of the edge.
SLICE_BLUE = """((j) => { const c = document.querySelector('#kspace'), w = c.width, d = c.getContext('2d').getImageData(0, 0, w, w).data, t = __app.sc.angle(j); let s = 0, n = 0;
  for (let q = -90; q <= 90; q++) { if (Math.abs(q) < 8) continue; const r = (q / 100) * w / 2, x = Math.round(w / 2 + r * Math.cos(t)), y = Math.round(w / 2 - r * Math.sin(t));
    const o = (y * w + x) * 4; s += d[o + 2] - d[o]; n++; } return s / n; })"""
# The spots at the bottom of the 1974 phantom: their contrast against the brain round them, and
# the spread of the brain there (the grain).
SPOTS = """(() => { const sc = __app.sc, N = 256, h = 2 / N, f = sc.fbp, t = sc.truth; let a = 0, na = 0, b = 0, b2 = 0, nb = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = (i - N / 2) * h, y = (N / 2 - j) * h;
    if (Math.abs(y + 0.605) > 0.12 || Math.abs(x) > 0.25) continue;
    const v = f[j * N + i];
    if (Math.abs(t[j * N + i] - 1.03) < 1e-9) { a += v; na++; } else if (Math.abs(t[j * N + i] - 1.02) < 1e-9) { b += v; b2 += v * v; nb++; } }
  const mb = b / nb; return [a / na - mb, Math.sqrt(b2 / nb - mb * mb)]; })()"""
def quoted(v, text):
    """v rounds to the number quoted in the help as text."""
    digits = len(text.split('.')[1]) if '.' in text else 0
    return round(v, digits) == float(text)

SETUPS = ['shadows', 'sinusoid', 'smear', 'blur', 'ramp', 'slice', 'density', 'streaks', 'wedge', 'noise', 'aliasing', 'metal', 'faint', 'picture']
# The experiments about back-projection and Fourier space unfold the second row of panels.
UNFOLDED = {'smear', 'blur', 'ramp', 'slice', 'density', 'streaks', 'wedge'}
# (A closed <details> keeps its content laid out in Chromium, so checkVisibility, not the boxes.)
HIDDEN = "['#kspace', '#bp', '#extra'].map((s) => document.querySelector(s).checkVisibility() ? 1 : 0)"
HINTS = """['#scan-readout', '#sino-readout'].map((s) => { const e = document.querySelector(s);
  return [e.classList.contains('hint'), e.textContent.trim(), getComputedStyle(e, '::before').content]; })"""

with Browser('tomography/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready && __app.sc.count > 0', timeout=60)
    # (Paused at once, in the same breath: the scan goes on at its own pace meanwhile.)
    st = b.eval('(() => { const r = { playing: __app.state.playing, count: __app.sc.count, obj: __app.state.obj, panels: __app.state.panels, open: document.querySelector("#more-panels").open }; __app.state.playing = false; return r; })()')
    check(st['playing'] and 0 < st['count'] < 180 and st['obj'] == 'disks' and st['panels'] == 'basic' and not st['open'],
          f"it opens scanning three disks, with the scanner, the sinogram and the reconstruction ({st['count']} of 180 angles so far) and the other panels folded")
    frames(b)
    hints = b.eval(HINTS)
    check(all(h[0] and '→' in h[2] for h in hints) and hints[0][1].startswith('Point at the object') and hints[1][1].startswith('Point at a row'),
          f'hints under the scanner and the sinogram say what to point at ({hints[0][1]!r}; {hints[1][1]!r})')
    check(b.eval(HIDDEN) == [0, 0, 0], 'Fourier space, the plain back-projection and the profile are folded away')
    heads = b.eval("[...document.querySelectorAll('.cell-head')].map((e) => [e.querySelector('h2, select') ? 1 : 0, e.querySelector('.note').textContent.trim()])")
    check(len(heads) == 6 and all(h[0] and len(h[1]) > 15 for h in heads), f'every panel has a name and a line of words saying what it is ({[h[1] for h in heads[:3]]})')
    b.screenshot('build/tomo-start.png')
    check(b.eval('Object.keys(__app.setups).join()') == ','.join(SETUPS), 'the fourteen set-ups keep their names (#setup= links)')
    # The drawer: Start here first, in plain words, the theory last.
    dr = b.eval("""(() => { const d = document.querySelector('#help'), kids = [...d.children], first = kids[1];
        return { first: first.className + ':' + (first.querySelector('h3') || {}).textContent, math: first.querySelectorAll('math').length,
          sentences: (first.textContent.match(/[.!?](\\s|$)/g) || []).length,
          theoryLast: kids.findIndex((e) => e.classList.contains('theory')) > kids.findLastIndex((e) => e.classList.contains('exp')),
          theoryHead: d.querySelector('.theory h3')?.textContent, exps: d.querySelectorAll('.exp').length }; })()""")
    check(dr['first'] == 'start:Start here' and dr['math'] == 0 and 3 <= dr['sentences'] <= 8 and dr['theoryLast'] and dr['theoryHead'] == 'How it works' and dr['exps'] == 14,
          f"the drawer starts with 'Start here' ({dr['sentences']} sentences, no equations) and ends with 'How it works' after the {dr['exps']} experiments")
    # Unfolding the second row: a click on the summary; the address keeps it.
    b.click('#more-panels > summary'); frames(b)
    b.wait("location.hash.includes('panels=all')", timeout=5)
    shown = b.eval(f"[__app.state.panels, ...{HIDDEN}]")
    check(shown == ['all', 1, 1, 1], f'More panels unfolds the other three, and the address says so ({shown})')

    settle(b)
    rms_disks = b.eval('__app.rms')
    check(rms_disks < 0.04, f'three disks, 180 angles x 256 bins: RMS difference {rms_disks:.4f}')

    # The angle just measured is cyan in every panel while the scan goes on, and nowhere once it
    # is over (the scanner then still shows the last projection).  The head, stepped to angle 60.
    b.eval("(() => { __app.setObject('phantom'); __app.state.playing = false; while (__app.sc.count < 60) __app.stepScan(); })()"); frames(b)
    j = b.eval('__app.nowIndex')
    mid = {'sino': colour(b, '#sinogram', CYAN), 'k': b.eval(f'{SLICE_BLUE}({j})'), 'bp': b.eval(f"{TINT}('#bp')"), 'fbp': b.eval(f"{TINT}('#fbp')"), 'det': colour(b, '#scanner', CYAN)}
    settle(b)
    end = {'sino': colour(b, '#sinogram', CYAN), 'k': b.eval(f'{SLICE_BLUE}({j})'), 'bp': b.eval(f"{TINT}('#bp')"), 'fbp': b.eval(f"{TINT}('#fbp')"), 'det': colour(b, '#scanner', CYAN)}
    check(j == 59 and mid['sino'] > 300 and end['sino'] < 20, f"the angle just measured (angle {j + 1}) is outlined in cyan in the sinogram ({mid['sino']} cyan pixels; {end['sino']} once the scan is over)")
    check(mid['k'] > end['k'] + 40, f"its slice of Fourier space is cyan (blue - red along it {mid['k']:.0f}, against {end['k']:.0f} once the scan is over)")
    check(mid['bp'] > 2000 and mid['fbp'] > 2000 and end['bp'] == 0 and end['fbp'] == 0, f"its smear tints both back-projections ({mid['bp']} and {mid['fbp']} pixels; none once the scan is over)")
    check(mid['det'] > 200 and end['det'] > 200, f"the detector is cyan, with the projection it measured ({mid['det']}, {end['det']} pixels)")
    check(b.eval('__app.nowIndex') == -1 and b.eval("document.querySelector('#play').textContent") == 'Play', 'once the scan is over no angle is current, and Play starts another')
    rms = b.eval('__app.rms')
    check(rms < 0.03, f'the head phantom, 180 angles x 256 bins: RMS difference {rms:.4f}')
    b.screenshot('build/tomo-done.png')

    # Every projection of the exact phantom holds the same mass (the integral of f).
    r = b.eval("""(() => { const sc = __app.sc, M = sc.M, h = 2 / 256; let mass = 0; for (const v of sc.truth) mass += v * h * h;
        let worst = 0; for (let j = 0; j < sc.nA; j++) { let s = 0; for (let k = 0; k < M; k++) s += sc.meas[j * M + k] * sc.ds; worst = Math.max(worst, Math.abs(s / mass - 1)); }
        return [mass, worst]; })()""")
    check(r[1] < 3e-3, f'every projection integrates to the mass {r[0]:.5f} (worst {r[1]:.1e}; the picture is sampled 4 x 4 per pixel)')

    # Changing a setting after the scan measures everything again in the workers: the same
    # numbers as measuring on one thread.
    rc(b, {'nA': 90})
    d = b.eval("""(() => { const a = __app.sc, t = new __app.Scanner(256); t.setShapes(a.shapes); t.configure({ ...a.opts }); t.pass = a.pass; t.measureAll();
        let w = 0, m = 0; for (let i = 0; i < t.fbp.length; i++) { w = Math.max(w, Math.abs(t.fbp[i] - a.fbp[i]), Math.abs(t.bp[i] - a.bp[i]) / 10); m = Math.max(m, Math.abs(t.fbp[i])); }
        return [a.nA, a.count, w / m, __app.workers]; })()""")
    check(d[0] == 90 and d[1] == 90 and d[2] < 1e-12, f'rescanning in {d[3]} workers: {d[1]} of {d[0]} angles, the same pictures as one thread (to {d[2]:.0e})')

    # Step: after a finished scan it starts a new one at the first angle; the button and the
    # right arrow measure one angle each and stop.
    b.click('#step'); frames(b)
    s1 = b.eval('[__app.sc.count, __app.state.playing, __app.nowIndex, document.querySelector("#play").textContent]')
    for _ in range(3): b.key('ArrowRight', 'ArrowRight')
    frames(b)
    s2 = b.eval('[__app.sc.count, __app.state.playing, __app.nowIndex]')
    check(s1 == [1, False, 0, 'Go on'] and s2 == [4, False, 3], f'Step starts a new scan and measures one angle ({s1}); the → key three more ({s2})')
    check(colour(b, '#sinogram', CYAN) > 100 and b.eval(f"{TINT}('#bp')") > 2000, 'while stepping, the current angle is cyan in the sinogram and the back-projection')
    b.screenshot('build/tomo-step.png')

    folds = {}
    for name in SETUPS:
        setup(b, name, finish=name != 'smear')
        st = b.eval('({ na: __app.sc.nA, M: __app.sc.M, rms: __app.rms, smooth: __app.rmsSmooth, direct: __app.rmsDirect, obj: __app.state.obj, panels: __app.state.panels, hidden: ' + HIDDEN + ' })')
        folds[name] = st['panels'] == 'all' and st['hidden'] == [1, 1, 1] if name in UNFOLDED else st['panels'] == 'basic' and st['hidden'] == [0, 0, 0]
        if name != 'smear': b.screenshot(f'build/tomo-exp-{name}.png')
        print(f"note  {name}: {st['obj']}, {st['na']} angles x {st['M']} bins, RMS {st['rms'] if st['rms'] is None else round(st['rms'], 4)}, panels {st['panels']}")
        if name == 'shadows':
            check(st['obj'] == 'disks' and st['na'] == 180 and st['M'] == 256 and b.eval(HINTS)[0][0], 'experiment 1 is the page as it opens: three disks, 180 angles, the hints showing')
        if name == 'sinusoid':
            w = b.eval("""(() => { const sc = __app.sc, M = sc.M, { px, py } = __app.state; let worst = 0;
                for (let j = 0; j < sc.nA; j++) { let m = 0, ms = 0; for (let k = 0; k < M; k++) { const p = sc.meas[j * M + k]; m += p; ms += p * (k - M / 2) * sc.ds; }
                  const t = sc.angle(j); worst = Math.max(worst, Math.abs(ms / m - (px * Math.cos(t) + py * Math.sin(t)))); } return worst; })()""")
            check(w < 1e-6, f'the point traces s = x0 cos(theta) + y0 sin(theta) (centroids within {w:.0e})')
        if name == 'smear':
            s0 = b.eval('[__app.state.obj, __app.sc.nA, __app.sc.count, __app.state.playing]')
            check(s0 == ['disks', 12, 0, False], f'experiment 3: three disks, 12 angles, waiting before the first ({s0})')
            b.click('#step'); frames(b)
            v = b.eval("""(() => { const sc = __app.sc, N = 256; let worst = 0; for (const i of [64, 100, 128, 150, 190]) { const col = [];
                for (let j = 0; j < N; j++) { const x = (i - N / 2) * 2 / N, y = (N / 2 - j) * 2 / N; if (x * x + y * y < 0.95) col.push(sc.bp[j * N + i]); }
                const m = col.reduce((a, b) => a + b) / col.length; worst = Math.max(worst, Math.max(...col.map((c) => Math.abs(c - m))) / (Math.abs(m) + 1e-12)); } return worst; })()""")
            check(b.eval('__app.sc.count') == 1 and v < 1e-9, f'one Step (theta = 0): the back-projection is the same all along each vertical ray (to {v:.0e})')
            b.screenshot('build/tomo-exp-smear-1.png')
            for _ in range(11): b.eval('__app.stepScan()')
            frames(b)
            check(b.eval('[__app.sc.count, __app.state.done]') == [12, True], 'eleven more Steps finish the twelve angles')
            b.screenshot('build/tomo-exp-smear.png')
        if name == 'blur':
            vals = b.eval(f"""(() => {{ const {{ px, py }} = __app.state, sh = __app.sc.shapes[0], m = 2 * Math.PI * sh.sigma ** 2 * sh.rho, ring = {RING};
                return [0.05, 0.1, 0.2, 0.4].map((r) => ring(__app.sc.bp, px, py, r) * r / m); }})()""")
            check(all(abs(v - 1) < 0.02 for v in vals), 'back-projection of a point: b r / m = ' + ', '.join(f'{v:.4f}' for v in vals) + ' at r = 0.05, 0.1, 0.2, 0.4')
        if name == 'ramp':
            q = b.eval("(() => { const sc = __app.sc, M = sc.M, j = 0; const p = sc.meas.subarray(j * M, (j + 1) * M), q = sc.filt.subarray(j * M, (j + 1) * M); return [Math.min(...p), Math.min(...q), Math.max(...q)]; })()")
            check(q[0] >= -1e-12 and q[1] < -0.1 * q[2], f'the filtered projection goes negative beside the edges (min {q[1]:.3g}, max {q[2]:.3g}); the projection does not')
        if name == 'slice':
            k = b.eval("""(() => { const sc = __app.sc, L = sc.L, dk = 2 * Math.PI / (L * sc.ds), a = __app.state.fp.a, kk = __app.state.fp.k;
                let jbest = 0; for (let j = 0; j < sc.nA; j++) if (Math.abs(sc.angle(j) - a) < Math.abs(sc.angle(jbest) - a)) jbest = j;
                const mag = (j, m) => Math.hypot(sc.spec.re[j * L + m], sc.spec.im[j * L + m]);
                let best = 0, mb = 0; for (let m = L / 2 + Math.round(15 / dk); m < L / 2 + Math.round(100 / dk); m++) if (mag(jbest, m) > best) { best = mag(jbest, m); mb = m; }
                const at0 = mag(0, L / 2 + Math.round(kk / dk));
                return [(mb - L / 2) * dk, sc.angle(jbest) * 180 / Math.PI, best, at0]; })()""")
            check(abs(k[0] - 40) < 2 and k[2] > 10 * k[3], f'the stripes show on the slice at {k[1]:.0f} degrees, at |k| = {k[0]:.1f} (k = 40), {k[2] / k[3]:.0f} times brighter than on the slice at 0')
        if name == 'density':
            check(quoted(st['direct'], '0.12') and quoted(st['rms'], '0.26'), f"12 slices: direct Fourier RMS {st['direct']:.4f} (help: 0.12), filtered back-projection {st['rms']:.4f} (0.26)")
            rc(b, {'nA': 180}); frames(b)
            e = b.eval('[__app.rmsDirect, __app.rms]')
            check(quoted(e[0], '0.034') and quoted(e[1], '0.023'), f'180 slices: direct Fourier {e[0]:.4f} (help: 0.034), filtered back-projection {e[1]:.4f} (0.023)')
        if name == 'streaks':
            check(st['rms'] > 2.5 * rms, f"24 angles leave streaks: RMS {st['rms']:.3f} against {rms:.4f} with 180")
            got = [st['smooth']]
            for na in (48, 96, 180, 402):
                rc(b, {'nA': na}); got.append(b.eval('__app.rmsSmooth'))
            want = ['0.15', '0.067', '0.023', '0.009', '0.008']
            check(all(quoted(g, w) for g, w in zip(got, want)), 'away from edges, 24, 48, 96, 180 and 402 angles: ' + ', '.join(f'{g:.4f}' for g in got) + f" (help: {', '.join(want)})")
        if name == 'wedge':
            check(st['rms'] > 1.5 * rms, f"a 110-degree range: RMS {st['rms']:.3f}")
        if name == 'noise':
            check(b.eval("document.querySelector('#show').open"), 'a set-up with a narrow grey scale unfolds the Show controls')
            # The difference away from edges: noise, on top of what is there without it.
            r0 = b.eval('__app.rmsSmooth')
            rc(b, {'I0': 1e6}); r1 = b.eval('__app.rmsSmooth')
            rc(b, {'noise': False}); z = b.eval('__app.rmsSmooth')
            rc(b, {'noise': True, 'I0': 1e5, 'filter': 'hann'}); r2 = b.eval('__app.rmsSmooth')
            rc(b, {'noise': False}); z2 = b.eval('__app.rmsSmooth')
            rc(b, {'noise': True})
            b.screenshot('build/tomo-exp-noise-hann.png')
            n0, n1, n2 = (r0 ** 2 - z ** 2) ** 0.5, (r1 ** 2 - z ** 2) ** 0.5, (r2 ** 2 - z2 ** 2) ** 0.5
            check(quoted(r0, '0.043') and quoted(r2, '0.015') and quoted(r1, '0.020') and quoted(z, '0.016'),
                  f'away from edges: {r0:.4f} at I0 = 1e5, {r1:.4f} at 1e6, {z:.4f} without noise; Hann {r2:.4f} (help: 0.043, 0.020, 0.016; 0.015)')
            check(abs(n0 / n1 - 10 ** 0.5) < 0.3, f'the noise itself: {n0:.4f} at I0 = 1e5, {n1:.4f} at 1e6 (ratio {n0 / n1:.2f}; sqrt 10 = 3.16)')
            check(0.3 < r2 / r0 < 0.45, f'the Hann window: {r2:.4f} away from edges, {100 * r2 / r0:.0f}% of Ram-Lak, about a third ({100 * n2 / n0:.0f}% of the noise itself)')
        if name == 'aliasing':
            check(b.eval("document.querySelector('#more').open"), 'the set-up with narrow detector bins unfolds the More controls of the scanner')
            # Beyond r = 0.5 the zone plate's rings are finer than 64 bins can sample: whatever
            # pattern the reconstruction shows there (its spread about the mean) is aliasing.
            ANNULUS = "(() => { const f = __app.sc.fbp, N = 256; let s = 0, s2 = 0, n = 0; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const r = Math.hypot((i - N / 2) * 2 / N, (N / 2 - j) * 2 / N); if (r > 0.6 && r < 0.85) { const v = f[j * N + i]; s += v; s2 += v * v; n++; } } return Math.sqrt(s2 / n - (s / n) ** 2); })()"
            a0 = b.eval(ANNULUS)
            rc(b, {'aperture': 1}); a1 = b.eval(ANNULUS)
            b.screenshot('build/tomo-exp-aliasing-wide.png')
            rc(b, {'M': 256}); a2 = b.eval(ANNULUS)
            b.screenshot('build/tomo-exp-aliasing-256.png')
            check(a1 < 0.6 * a0, f'zone plate beyond Nyquist (64 bins): false rings of spread {a0:.3f} with narrow detectors, {a1:.3f} side by side; {a2:.3f} with 256 bins, where the rings are real (spread 0.35)')
        if name == 'metal':
            # The brain on the line between the pins: its mean and spread.
            PATCH = "(() => { const sc = __app.sc, N = 256; let s = 0, s2 = 0, n = 0; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = (i - N / 2) * 2 / N, y = (N / 2 - j) * 2 / N; if (Math.abs(x) < 0.2 && Math.abs(y + 0.28) < 0.012) { const v = sc.fbp[j * N + i]; s += v; s2 += v * v; n++; } } return [s / n, Math.sqrt(s2 / n - (s / n) ** 2), __app.rmsSmooth]; })()"
            a = b.eval(PATCH)
            rc(b, {'noise': False}); bb = b.eval(PATCH)
            b.screenshot('build/tomo-exp-metal-hardening.png')
            rc(b, {'poly': False, 'noise': True}); cc = b.eval(PATCH)
            b.screenshot('build/tomo-exp-metal-starved.png')
            rc(b, {'noise': False}); c = b.eval(PATCH)
            b.screenshot('build/tomo-exp-metal-ideal.png')
            print(f'note  between the pins: {a[0]:.3f} +- {a[1]:.3f} (noise, two energies), {bb[0]:.3f} +- {bb[1]:.3f} (two energies), {cc[0]:.3f} +- {cc[1]:.3f} (noise), {c[0]:.3f} +- {c[1]:.3f} (ideal; brain 1.02)')
            check(abs(c[0] - 1.02) < 0.02 and c[1] < 0.03, f'an ideal scanner gets the brain between the pins right ({c[0]:.3f} +- {c[1]:.3f})')
            check(bb[0] < c[0] - 0.1 and quoted(a[0], '0.87') and quoted(bb[0], '0.87'), f'beam hardening darkens the band between the pins ({a[0]:.3f} with noise, {bb[0]:.3f} without, against {c[0]:.3f}; help: about 0.87)')
            check(cc[2] > 1.5 * c[2], f'photon starvation streaks the brain: RMS away from edges {cc[2]:.3f} against {c[2]:.3f}')
        if name == 'faint':
            sp = b.eval(SPOTS)
            check(b.eval('__app.sc.opts.I0') == 1e6 and not b.eval('__app.sc.opts.noise') and quoted(sp[0], '0.01'), f'experiment 13 waits with 1e6 photons ready and the noise off; the spots stand {sp[0]:.4f} above the brain')
            b.eval("document.querySelector('#noise-box button').click()"); settle(b); g0 = b.eval(SPOTS)
            rc(b, {'filter': 'hann'}); g1 = b.eval(SPOTS)
            rc(b, {'filter': 'ramlak', 'I0': 1e7}); g2 = b.eval(SPOTS)
            check(quoted(g0[1], '0.014') and quoted(g1[1], '0.005') and quoted(g2[1], '0.004') and g0[1] > g0[0] > 1.5 * g1[1],
                  f'the grain round the spots: {g0[1]:.4f} with Ram-Lak at 1e6 (larger than the spots, {g0[0]:.4f}), {g1[1]:.4f} with Hann, {g2[1]:.4f} with 1e7 photons (help: 0.014, 0.005, 0.004)')
        if name == 'picture':
            check(st['obj'] == 'portrait' and st['rms'] < 0.1 and b.eval("document.querySelector('#gallery').value") == 'portrait', f"Fourier's portrait, chosen in the list of pictures: RMS {st['rms']:.4f}")
    bad = [n for n, ok in folds.items() if not ok]
    check(not bad, 'the experiments about back-projection and Fourier space unfold the second row of panels, the others fold it' + (f' (wrong: {bad})' if bad else ''))

    # Pointing at the sinogram: the scanner turns to that row's angle and draws its ray in
    # magenta; a click pins it.  Pointing at a back-projection shows that point's sinusoid.
    b.eval("__app.setups.ramp()"); settle(b)
    b.mouse('mouseMoved', 2, 2); frames(b)
    check(colour(b, '#scanner', MAGENTA) < 5 and colour(b, '#sinogram', YELLOW) < 5, 'nothing is pointed at: no magenta ray, no yellow sinusoid')
    x, y = b.point('#sinogram', (0.55, 0.5))
    b.mouse('mouseMoved', x, y); frames(b)
    hv = b.eval('[__app.hardwareIndex, __app.state.pick, document.querySelector("#sino-readout").textContent, document.querySelector("#sino-readout").classList.contains("hint")]')
    mag = {k: colour(b, f'#{k}', MAGENTA, 60) for k in ('scanner', 'sinogram', 'kspace', 'bp', 'fbp')}   # (the slice is drawn over the data, 80% opaque)
    check(85 <= hv[0] <= 95 and hv[1] is None and hv[2].startswith('angle') and not hv[3], f'pointing at the middle row of the sinogram turns the scanner to angle {hv[0] + 1}; the hint gives way to the readout ({hv[2]!r})')
    check(all(v > 40 for v in mag.values()), f'its ray, row, slice and smears are drawn in magenta ({mag})')
    b.screenshot('build/tomo-point-sinogram.png')
    b.mouse('mouseMoved', 2, 2); frames(b)
    check(b.eval('__app.hardwareIndex') == 179 and colour(b, '#scanner', MAGENTA) < 5 and b.eval(HINTS)[1][0], 'moving off the sinogram turns the scanner back, and the hint returns')
    # Fourier space: the slice through the place pointed at, here in the direction 60 degrees.
    x, y = b.point('#kspace', (0.5 + 0.3 * 0.5, 0.5 - 0.3 * 0.866))
    b.mouse('mouseMoved', x, y); frames(b)
    hk = b.eval('[__app.hardwareIndex, document.querySelector("#sino-readout").textContent]')
    check(hk[0] == 60 and colour(b, '#sinogram', MAGENTA) > 40 and colour(b, '#scanner', MAGENTA) > 40, f'pointing at Fourier space in the direction 60° picks the slice at angle {hk[0]}: its row and its projection in magenta ({hk[1]!r})')
    b.mouse('mouseMoved', 2, 2); frames(b)
    b.click('#sinogram', (0.55, 0.4)); b.mouse('mouseMoved', 2, 2); frames(b)
    pick = b.eval('__app.state.pick')
    check(pick is not None and 0 <= pick['j'] < 180 and b.eval('__app.hardwareIndex') == pick['j'], f'clicking the sinogram pins a ray ({pick})')
    b.click('#sinogram', (0.5, 0.995)); frames(b)
    check(b.eval('__app.state.pick') is None, 'clicking below the rows lets it go')
    x, y = b.point('#bp', (0.7, 0.35))
    b.mouse('mouseMoved', x, y); frames(b)
    pt = b.eval('__app.state.point')
    check(pt is not None and not pt['pinned'] and abs(pt['x'] - 0.4) < 0.02 and abs(pt['y'] - 0.3) < 0.02 and colour(b, '#sinogram', YELLOW) > 60,
          f"pointing at the back-projection shows that point's sinusoid in the sinogram ({colour(b, '#sinogram', YELLOW)} yellow pixels)")
    b.mouse('mouseMoved', 2, 2); frames(b)
    check(b.eval('__app.state.point') is None, 'and moving off it takes the sinusoid away')
    b.click('#scanner', (0.6, 0.4)); b.mouse('mouseMoved', 2, 2); frames(b)
    pt = b.eval('__app.state.point')
    check(pt is not None and pt['pinned'] and colour(b, '#sinogram', YELLOW) > 60 and colour(b, '#scanner', YELLOW) > 20, f'clicking the object pins a point, its sinusoid and the ray through it ({pt})')
    b.screenshot('build/tomo-pick.png')
    b.eval("__app.setView('projection')"); frames(b)
    b.screenshot('build/tomo-projection.png')
    b.eval("__app.setView('profile')")

    # Dragging on a reconstruction moves the profile, while the profile is shown.
    b.drag('#fbp', (0.5, 0.5), (0.5, 0.3), steps=5); frames(b)
    y = b.eval('__app.state.py0')
    check(abs(y - 0.4) < 0.03, f'dragging on the reconstruction moves the profile to y = {y:.3f}')
    b.eval("__app.setPanels('basic')"); frames(b)
    b.drag('#fbp', (0.5, 0.5), (0.5, 0.7), steps=5); frames(b)
    check(abs(b.eval('__app.state.py0') - y) < 1e-9, 'with the profile folded away, a drag on the reconstruction leaves it alone')
    b.eval("__app.setPanels('all')"); frames(b)

    # Painting: the object becomes a picture, and the scan (already over) is measured again.
    before = b.eval('__app.sc.truth.reduce((a, v) => a + v, 0)')
    b.eval("__app.setTool('brush')")
    b.drag('#scanner', (0.4, 0.62), (0.6, 0.62), steps=12); settle(b)
    after = b.eval('__app.sc.truth.reduce((a, v) => a + v, 0)')
    m = b.eval("""(() => { const sc = __app.sc, M = sc.M, h = 2 / 256; let mass = 0; for (const v of sc.truth) mass += v * h * h;
        let s = 0; for (let k = 0; k < M; k++) s += sc.meas[k] * sc.ds; return [mass, s, __app.state.obj]; })()""")
    check(after > before and m[2] == 'painted', f'painting adds to the object ({before:.0f} -> {after:.0f})')
    check(abs(m[1] / m[0] - 1) < 3e-3, f'and the sinogram follows: a projection holds {m[1]:.5f} of the mass {m[0]:.5f}')
    b.screenshot('build/tomo-painted.png')
    b.eval("__app.setTool('look')")

    # The readouts keep still: every number in a slot of its own, so that neither its digits nor
    # the words after it move, while the scanner turns (stepped, angle by angle) and as the
    # pointer moves over the pictures.
    b.eval(CANVAS_WORDS)
    b.eval("__app.setObject('phantom')"); settle(b)
    b.mouse('mouseMoved', 2, 2)                     # (the pointer off the pictures: no hover readouts)
    b.eval("__app.setView('projection')")
    base, moved, seen = {}, [], set()
    b.eval('__words.length = 0')
    for i in range(14):
        b.eval('__app.stepScan()'); frames(b)
        if i == 0: b.eval('__words.length = 0')     # (from the second angle on: the first has no count yet)
        seen.add(b.eval("document.querySelector('#extra-readout').textContent"))
        moved += track(base, b.eval(READOUTS))
    words = b.eval('__words')
    check(len(seen) >= 10 and not moved, f'the readouts keep still while the scanner turns ({len(seen)} readings, e.g. {sorted(seen)[:2]})' + (f'; moved {moved[:3]}' if moved else ''))
    xs = {(c, t): {x for c2, t2, x in words if (c2, t2) == (c, t)} for c, t, _ in words}
    check(len(xs) >= 6 and all(len(v) == 1 for v in xs.values()), f"the angles drawn on the scanner and the projection keep their places ({ {f'{c} {t!r}': sorted(v) for (c, t), v in xs.items()} })")
    settle(b)
    b.eval("__app.setView('direct')"); frames(b)
    base, moved, texts, cut = {}, [], set(), []
    for cv in ('#scanner', '#sinogram', '#kspace', '#bp', '#fbp', '#extra'):
        for fx, fy in ((0.15, 0.2), (0.85, 0.8), (0.5, 0.5), (0.3, 0.72), (0.71, 0.33), (0.52, 0.47), (0.08, 0.6)):
            x, y = b.point(cv, (fx, fy))
            b.mouse('mouseMoved', x, y); frames(b)
            texts.add(b.eval("[...document.querySelectorAll('.readout')].map((e) => e.textContent).join(' | ')"))
            moved += track(base, b.eval(READOUTS))
            cut += b.eval(CUT)
        b.mouse('mouseMoved', 2, 2); frames(b)
        cut += b.eval(CUT)
    check(len(texts) >= 20 and not moved, f'the readouts keep still as the pointer moves over each picture ({len(texts)} readings)' + (f'; moved {moved[:3]}' if moved else ''))
    for label, v in (('Angles', 7), ('Angles', 360), ('Angles', 180), ('Cutoff', 0.35), ('Cutoff', 0.9), ('Profile at y', -0.62), ('Profile at y', 0.05)):
        if label == 'Profile at y': b.eval("__app.setView('profile')")
        b.eval(f"""(() => {{ const s = [...document.querySelectorAll('.slider')].find((s) => s.querySelector('label').textContent === {json.dumps(label)});
            const box = s.querySelector('input[type=number]'); box.value = {v}; box.dispatchEvent(new Event('change')); }})()""")
        settle(b)
        moved += track(base, b.eval(READOUTS))
        cut += b.eval(CUT)
    check(not moved, 'the readouts keep still as the number of angles, the cutoff and the profile move' + (f'; moved {moved[:3]}' if moved else ''))
    b.eval("__app.setView('projection')"); frames(b); cut += b.eval(CUT)
    check(not cut, 'every readout, note and hint fits its panel at 1400 x 900' + (f': {cut[:3]}' if cut else ''))

    # The formula: its parameters are sliders.
    b.eval("__app.setObject('formula')"); settle(b)
    b.eval("document.querySelector('.formula-presets button').click()"); settle(b)
    check(b.eval("document.querySelectorAll('#object-options .params .slider').length") == 2, 'the stripes formula has sliders for k and a')
    # While k's slider moves, the object is the formula sampled once a pixel; when it stops, 2 x 2
    # (its edge antialiased): the scan circle's edge pixels then take fractional values.
    fine0 = b.eval('__app.sc.truth.slice()')
    b.eval("""(() => { const r = document.querySelectorAll('#object-options .params .slider')[1].querySelector('input[type=range]'); r.value = String(+r.value + 15); r.dispatchEvent(new Event('input')); })()""")
    coarse = b.eval('[__app.idle, __app.state.fp.k]')
    settle(b)
    fine = b.eval('[__app.idle, __app.state.fp.k, __app.sc.truth.length]')
    check(not coarse[0] and fine[0] and coarse[1] == fine[1] != 40, f'moving k ({coarse[1]}): a coarse object while it moves, the fine one 200 ms after')
    # Values that would overflow the line integrals are cut off, and the pictures stay numbers.
    b.eval("""(() => { const f = document.querySelector('#object-options .expr input'); f.value = 'exp(1000 r)'; f.dispatchEvent(new Event('change')); f.dispatchEvent(new Event('input')); })()""")
    b.eval('__app.finishScan()'); settle(b)
    fin = b.eval('[__app.sc.meas.every(Number.isFinite), __app.sc.fbp.every(Number.isFinite), Math.max(...__app.sc.truth)]')
    check(fin[0] and fin[1] and fin[2] <= 1e4, f'a formula that overflows (exp(1000 r)) is cut off at 1e4: the sinogram and the reconstruction stay finite ({fin})')
    b.eval("document.querySelector('.formula-presets button').click()"); settle(b)

    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions or console errors' + ('' if not errors else ': ' + '; '.join(errors[:3])))

# Links with settings in them, and a link to an experiment.
for address, want in (('#na=24&nd=128&filter=hann&obj=disk', {'nA': 24, 'M': 128, 'f': 'hann', 'obj': 'disk', 'panels': 'basic'}),
                      ('#obj=phantom&panels=all', {'nA': 180, 'M': 256, 'f': 'ramlak', 'obj': 'phantom', 'panels': 'all'}),
                      ('#obj=portrait&na=90', {'nA': 90, 'M': 256, 'f': 'ramlak', 'obj': 'portrait', 'panels': 'basic'})):
    with Browser(f'tomography/index.html{address}', size=(1400, 900)) as b:
        b.wait('window.__app && __app.ready', timeout=60); settle(b)
        o = b.eval('({ nA: __app.sc.nA, M: __app.sc.M, f: __app.sc.opts.filter, obj: __app.state.obj, panels: __app.state.panels })')
        check(o == want, f'{address} is restored ({o})')
        if want['panels'] == 'all':
            check(b.eval(HIDDEN) == [1, 1, 1], 'and the second row of panels is shown')

# A small laptop: the scanner, the sinogram and the reconstruction side by side on the first
# screen, with every readout and note whole (in two lines if need be), nothing sticking out.
with Browser('tomography/index.html#setup=slice', size=(1100, 800)) as b:
    b.wait('window.__app && __app.ready', timeout=60); settle(b)
    b.eval("document.querySelector('#help').classList.remove('open')"); frames(b)
    boxes = b.eval("['#cell-scan', '#cell-sino', '#cell-fbp'].map((s) => { const r = document.querySelector(s + ' .sq').getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), Math.round(r.width)]; })")
    wide = b.eval('document.documentElement.scrollWidth')
    check(len({t for t, _, _ in boxes}) == 1 and all(bt <= 800 and w >= 200 for _, bt, w in boxes) and wide <= 1100,
          f'1100 x 800: the three pictures in one row on the first screen ({boxes}), the page {wide} px wide')
    for js in ('', "__app.setView('direct')", "__app.setView('projection')"):
        if js: b.eval(js); frames(b)
        cut = b.eval(CUT)
    check(not cut, 'every readout and note fits its panel at 1100 x 800' + (f': {cut[:3]}' if cut else ''))

# The phone: the hint under the picture without scrolling, the panels in the order of the story,
# nothing sticking out; the hint and the Start-here block readable in both themes.
with Browser('tomography/index.html#setup=streaks', size=(390, 844)) as b:
    b.wait('window.__app && __app.ready', timeout=60); settle(b)
    check(b.eval('__app.sc.nA') == 24 and b.eval("document.querySelector('#help').classList.contains('open')"), '#setup=streaks sets up the experiment and opens the drawer')
    for theme in ('light', 'dark'):
        b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': theme}]); frames(b)
        b.eval("document.querySelector('#help').scrollTop = 0")
        b.screenshot(f'build/tomo-phone-drawer-{theme}.png')
        c = b.eval(f"[{CONTRAST}('.drawer .start p', '.drawer .start'), {CONTRAST}('.drawer .start h3', '.drawer .start'), {CONTRAST}('#scan-readout', 'body'), {CONTRAST}('#scan-readout', 'body', '::before')]")
        check(all(v >= 4 for v in c), f'{theme} theme: the Start-here block and the hint (with its arrow) read (contrast {c})')
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'light'}])
    b.eval("document.querySelector('#help').classList.remove('open')"); frames(b)
    wide = b.eval('document.documentElement.scrollWidth')
    check(wide <= 390, f'at phone width nothing sticks out sideways (page {wide} px wide)')
    hint = b.eval("(() => { const r = document.querySelector('#scan-readout').getBoundingClientRect(); return [Math.round(r.bottom), document.querySelector('#scan-readout').classList.contains('hint')]; })()")
    check(hint[1] and hint[0] <= 844, f'the hint under the scanner is on the first screen of a phone (bottom at {hint[0]} px)')
    order = b.eval("['#cell-scan', '#scan-panel', '#cell-sino', '#cell-fbp', '#more-panels', '#objects'].map((s) => Math.round(document.querySelector(s).closest('.panel, .cell, details').getBoundingClientRect().top))")
    check(order == sorted(order), f'on a phone the scan buttons come right under the scanner, then the sinogram, the reconstruction, the folded panels and the controls (tops {order})')
    cut = b.eval(CUT)
    check(not cut, 'every readout fits at phone width' + (f': {cut[:3]}' if cut else ''))
    h = b.eval('document.documentElement.scrollHeight')
    b.call('Emulation.setDeviceMetricsOverride', width=390, height=h, deviceScaleFactor=1, mobile=False); frames(b)
    b.screenshot('build/tomo-phone.png')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no errors at phone width' + ('' if not errors else ': ' + '; '.join(errors[:3])))

print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
