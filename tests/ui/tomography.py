#!/usr/bin/env python3
"""Drive the tomography demo: every experiment, the scanner's physics, pointing and painting."""
import json, os, sys, time
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
# The x of the words drawn on a canvas around live numbers (fillText calls without digits).
CANVAS_WORDS = r"""(() => { if (window.__words) return; window.__words = [];
  const orig = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, x, y, m) {
    const s = String(t);
    if (/°/.test(s) && !/\d/.test(s)) __words.push([this.canvas.id, s, Math.round((this.getTransform().e + x * this.getTransform().a) * 10) / 10]);
    return orig.call(this, t, x, y, m); }; })()"""

# Finish the scan, wait for any rescan in the workers, and for two frames to be drawn.
SETTLE = """(async () => { __app.finishScan();
  for (let i = 0; i < 2000 && !__app.idle; i++) await new Promise(r => setTimeout(r, 5));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return __app.idle; })()"""
def settle(b):
    check(b.eval(SETTLE), 'the scan settles')

def setup(b, name):
    b.eval(f'__app.setups[{json.dumps(name)}]()')
    settle(b)

# The azimuthal average of a picture round (x0, y0) at radius r (bilinear).
RING = """((arr, x0, y0, r) => { const N = 256, h = 2 / N; let s = 0;
  for (let q = 0; q < 256; q++) { const x = x0 + r * Math.cos(q * Math.PI / 128), y = y0 + r * Math.sin(q * Math.PI / 128);
    const i = x / h + N / 2, j = N / 2 - y / h, i0 = Math.floor(i), j0 = Math.floor(j), a = i - i0, c = j - j0;
    s += (arr[j0 * N + i0] * (1 - a) + arr[j0 * N + i0 + 1] * a) * (1 - c) + (arr[(j0 + 1) * N + i0] * (1 - a) + arr[(j0 + 1) * N + i0 + 1] * a) * c; }
  return s / 256; })"""

with Browser('tomography/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready', timeout=30); b.sleep(1.2)
    check(b.eval('__app.state.playing') and 0 < b.eval('__app.sc.count') < 180, f"it opens scanning ({b.eval('__app.sc.count')} of 180 angles after a second)")
    b.screenshot('build/tomo-start.png')
    settle(b)
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
    b.eval('__app.reconfigure({ nA: 90 })'); settle(b)
    d = b.eval("""(() => { const a = __app.sc, t = new __app.Scanner(256); t.setShapes(a.shapes); t.configure({ ...a.opts }); t.pass = a.pass; t.measureAll();
        let w = 0, m = 0; for (let i = 0; i < t.fbp.length; i++) { w = Math.max(w, Math.abs(t.fbp[i] - a.fbp[i]), Math.abs(t.bp[i] - a.bp[i]) / 10); m = Math.max(m, Math.abs(t.fbp[i])); }
        return [a.nA, a.count, w / m, __app.workers]; })()""")
    check(d[0] == 90 and d[1] == 90 and d[2] < 1e-12, f'rescanning in {d[3]} workers: {d[1]} of {d[0]} angles, the same pictures as one thread (to {d[2]:.0e})')

    for name in b.eval('Object.keys(__app.setups)'):
        setup(b, name)
        b.screenshot(f'build/tomo-exp-{name}.png')
        st = b.eval('({ na: __app.sc.nA, M: __app.sc.M, rms: __app.rms, direct: __app.rmsDirect, obj: __app.state.obj })')
        print(f"note  {name}: {st['obj']}, {st['na']} angles x {st['M']} bins, RMS {st['rms']:.4f}")
        if name == 'sinusoid':
            w = b.eval("""(() => { const sc = __app.sc, M = sc.M, { px, py } = __app.state; let worst = 0;
                for (let j = 0; j < sc.nA; j++) { let m = 0, ms = 0; for (let k = 0; k < M; k++) { const p = sc.meas[j * M + k]; m += p; ms += p * (k - M / 2) * sc.ds; }
                  const t = sc.angle(j); worst = Math.max(worst, Math.abs(ms / m - (px * Math.cos(t) + py * Math.sin(t)))); } return worst; })()""")
            check(w < 1e-6, f'the point traces s = x0 cos(theta) + y0 sin(theta) (centroids within {w:.0e})')
        if name == 'smear':
            v = b.eval("""(() => { const sc = __app.sc, N = 256; let worst = 0; for (const i of [64, 100, 128, 150, 190]) { const col = [];
                for (let j = 0; j < N; j++) { const x = (i - N / 2) * 2 / N, y = (N / 2 - j) * 2 / N; if (x * x + y * y < 0.95) col.push(sc.bp[j * N + i]); }
                const m = col.reduce((a, b) => a + b) / col.length; worst = Math.max(worst, Math.max(...col.map((c) => Math.abs(c - m))) / (Math.abs(m) + 1e-12)); } return worst; })()""")
            check(v < 1e-9, f'one angle (theta = 0): the back-projection is the same all along each vertical ray (to {v:.0e})')
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
            check(st['direct'] == st['direct'] and st['direct'] > 0, f"direct Fourier reconstruction from 12 slices: RMS {st['direct']:.3f}")
        if name == 'streaks':
            check(st['rms'] > 2.5 * rms, f"24 angles leave streaks: RMS {st['rms']:.3f} against {rms:.4f} with 180")
        if name == 'wedge':
            check(st['rms'] > 1.5 * rms, f"a 110-degree range: RMS {st['rms']:.3f}")
        if name == 'noise':
            # The difference away from edges: noise, on top of what is there without it.
            r0 = b.eval('__app.rmsSmooth')
            b.eval("__app.reconfigure({ I0: 1e6 })"); settle(b); r1 = b.eval('__app.rmsSmooth')
            b.eval("__app.reconfigure({ noise: false })"); settle(b); z = b.eval('__app.rmsSmooth')
            b.eval("__app.reconfigure({ noise: true, I0: 1e5, filter: 'hann' })"); settle(b); r2 = b.eval('__app.rmsSmooth')
            b.eval("__app.reconfigure({ noise: false })"); settle(b); z2 = b.eval('__app.rmsSmooth')
            b.eval("__app.reconfigure({ noise: true })"); settle(b)
            b.screenshot('build/tomo-exp-noise-hann.png')
            n0, n1, n2 = (r0 ** 2 - z ** 2) ** 0.5, (r1 ** 2 - z ** 2) ** 0.5, (r2 ** 2 - z2 ** 2) ** 0.5
            print(f'note  away from edges: {r0:.4f} at I0 = 1e5, {r1:.4f} at 1e6, {z:.4f} without noise; Hann {r2:.4f} at 1e5, {z2:.4f} without noise')
            check(abs(n0 / n1 - 10 ** 0.5) < 0.3, f'the noise itself: {n0:.4f} at I0 = 1e5, {n1:.4f} at 1e6 (ratio {n0 / n1:.2f}; sqrt 10 = 3.16)')
            check(0.3 < r2 / r0 < 0.45, f'the Hann window: {r2:.4f} away from edges, {100 * r2 / r0:.0f}% of Ram-Lak ({100 * n2 / n0:.0f}% of the noise itself)')
        if name == 'aliasing':
            # Beyond r = 0.5 the zone plate's rings are finer than 64 bins can sample: whatever
            # pattern the reconstruction shows there (its spread about the mean) is aliasing.
            ANNULUS = "(() => { const f = __app.sc.fbp, N = 256; let s = 0, s2 = 0, n = 0; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const r = Math.hypot((i - N / 2) * 2 / N, (N / 2 - j) * 2 / N); if (r > 0.6 && r < 0.85) { const v = f[j * N + i]; s += v; s2 += v * v; n++; } } return Math.sqrt(s2 / n - (s / n) ** 2); })()"
            a0 = b.eval(ANNULUS)
            b.eval("__app.reconfigure({ aperture: 1 })"); settle(b)
            a1 = b.eval(ANNULUS)
            b.screenshot('build/tomo-exp-aliasing-wide.png')
            b.eval("__app.reconfigure({ M: 256 })"); settle(b)
            a2 = b.eval(ANNULUS)
            b.screenshot('build/tomo-exp-aliasing-256.png')
            check(a1 < 0.6 * a0, f'zone plate beyond Nyquist (64 bins): false rings of spread {a0:.3f} with narrow detectors, {a1:.3f} side by side; {a2:.3f} with 256 bins, where the rings are real (spread 0.35)')
        if name == 'metal':
            # The brain on the line between the pins: its mean and spread.
            PATCH = "(() => { const sc = __app.sc, N = 256; let s = 0, s2 = 0, n = 0; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = (i - N / 2) * 2 / N, y = (N / 2 - j) * 2 / N; if (Math.abs(x) < 0.2 && Math.abs(y + 0.28) < 0.012) { const v = sc.fbp[j * N + i]; s += v; s2 += v * v; n++; } } return [s / n, Math.sqrt(s2 / n - (s / n) ** 2), __app.rmsSmooth]; })()"
            a = b.eval(PATCH)
            b.eval("__app.reconfigure({ noise: false })"); settle(b); bb = b.eval(PATCH)
            b.screenshot('build/tomo-exp-metal-hardening.png')
            b.eval("__app.reconfigure({ poly: false, noise: true })"); settle(b); cc = b.eval(PATCH)
            b.screenshot('build/tomo-exp-metal-starved.png')
            b.eval("__app.reconfigure({ noise: false })"); settle(b); c = b.eval(PATCH)
            b.screenshot('build/tomo-exp-metal-ideal.png')
            print(f'note  between the pins: {a[0]:.3f} +- {a[1]:.3f} (noise, two energies), {bb[0]:.3f} +- {bb[1]:.3f} (two energies), {cc[0]:.3f} +- {cc[1]:.3f} (noise), {c[0]:.3f} +- {c[1]:.3f} (ideal; brain 1.02)')
            check(abs(c[0] - 1.02) < 0.02 and c[1] < 0.03, f'an ideal scanner gets the brain between the pins right ({c[0]:.3f} +- {c[1]:.3f})')
            check(bb[0] < c[0] - 0.1, f'beam hardening darkens the band between the pins ({bb[0]:.3f} against {c[0]:.3f})')
            check(cc[2] > 1.5 * c[2], f'photon starvation streaks the brain: RMS away from edges {cc[2]:.3f} against {c[2]:.3f}')
        if name == 'picture':
            check(st['obj'] == 'portrait' and st['rms'] < 0.1, f"Fourier's portrait: RMS {st['rms']:.4f}")

    # Pointing: the sinogram picks a ray; the object shows a point's sinusoid.
    b.eval("__app.setups.ramp()"); settle(b)
    b.click('#sinogram', (0.55, 0.4)); b.sleep(0.3)
    pick = b.eval('__app.state.pick')
    check(pick is not None and 0 <= pick['j'] < 180, f'clicking the sinogram picks a ray ({pick})')
    b.click('#scanner', (0.6, 0.4)); b.sleep(0.3)
    pt = b.eval('__app.state.point')
    check(pt is not None and pt['pinned'], f'clicking the object pins a point ({pt})')
    b.screenshot('build/tomo-pick.png')
    b.eval("__app.setView('projection')"); b.sleep(0.3)
    b.screenshot('build/tomo-projection.png')
    b.eval("__app.setView('profile')")

    # Dragging on a reconstruction moves the profile.
    b.drag('#fbp', (0.5, 0.5), (0.5, 0.3), steps=5); b.sleep(0.2)
    y = b.eval('__app.state.py0')
    check(abs(y - 0.4) < 0.03, f'dragging on the reconstruction moves the profile to y = {y:.3f}')

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
    # the words after it move, while the scanner turns and as the pointer moves over the pictures.
    READOUTS = f"{LAYOUT}('#scan-readout, #sino-readout, #sino-note, #k-readout, #bp-readout, #fbp-readout, #fbp-note, #extra-readout')"
    b.eval(CANVAS_WORDS)
    b.mouse('mouseMoved', 2, 2)                     # (the pointer off the pictures: no hover readouts)
    b.eval("__app.setView('projection'); __app.state.speed = 25; __app.restartScan()"); b.sleep(0.3)
    base, moved, seen = {}, [], set()
    b.eval('__words.length = 0')
    t0 = time.time()
    while time.time() - t0 < 40 and len(seen) < 8 and b.eval('__app.state.playing'):   # (a loaded machine draws few frames)
        b.sleep(0.2)
        seen.add(b.eval("document.querySelector('#scan-readout').textContent"))
        moved += track(base, b.eval(READOUTS))
    words = b.eval('__words')
    check(len(seen) >= 3 and not moved, f'the readouts keep still while the scanner turns ({len(seen)} readings, e.g. {sorted(seen)[:2]})' + (f'; moved {moved[:3]}' if moved else ''))
    xs = {(c, t): {x for c2, t2, x in words if (c2, t2) == (c, t)} for c, t, _ in words}
    check(len(words) >= 6 and all(len(v) == 1 for v in xs.values()), f"the angles drawn on the scanner and the projection keep their places ({ {f'{c} {t!r}': sorted(v) for (c, t), v in xs.items()} })")
    settle(b)
    b.eval("__app.setView('direct')"); b.sleep(0.5)
    base, moved, texts = {}, [], set()
    for cv in ('#scanner', '#sinogram', '#kspace', '#bp', '#fbp', '#extra'):
        for fx, fy in ((0.15, 0.2), (0.85, 0.8), (0.5, 0.5), (0.3, 0.72), (0.71, 0.33), (0.52, 0.47), (0.08, 0.6)):
            x, y = b.point(cv, (fx, fy))
            b.mouse('mouseMoved', x, y); b.sleep(0.25)
            texts.add(b.eval("[...document.querySelectorAll('.readout')].map((e) => e.textContent).join(' | ')"))
            moved += track(base, b.eval(READOUTS))
        b.mouse('mouseMoved', 2, 2); b.sleep(0.2)
    check(len(texts) >= 20 and not moved, f'the readouts keep still as the pointer moves over each picture ({len(texts)} readings)' + (f'; moved {moved[:3]}' if moved else ''))
    for label, v in (('Angles', 7), ('Angles', 360), ('Angles', 180), ('Cutoff', 0.35), ('Cutoff', 0.9), ('Profile at y', -0.62), ('Profile at y', 0.05)):
        if label == 'Profile at y': b.eval("__app.setView('profile')")
        b.eval(f"""(() => {{ const s = [...document.querySelectorAll('.slider')].find((s) => s.querySelector('label').textContent === {json.dumps(label)});
            const box = s.querySelector('input[type=number]'); box.value = {v}; box.dispatchEvent(new Event('change')); }})()""")
        settle(b)
        moved += track(base, b.eval(READOUTS))
    check(not moved, 'the readouts keep still as the number of angles, the cutoff and the profile move' + (f'; moved {moved[:3]}' if moved else ''))
    b.eval("__app.setView('direct')"); settle(b)

    # The formula: its parameters are sliders.
    b.eval("__app.setObject('formula')"); settle(b)
    b.eval("document.querySelector('.formula-presets button').click()"); settle(b)
    check(b.eval("document.querySelectorAll('#object-options .params .slider').length") == 2, 'the stripes formula has sliders for k and a')

    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions or console errors' + ('' if not errors else ': ' + '; '.join(errors[:3])))

# A link with settings in it, and a link to an experiment.
with Browser('tomography/index.html#na=24&nd=128&filter=hann&obj=disk', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready', timeout=30); settle(b)
    o = b.eval('({ nA: __app.sc.nA, M: __app.sc.M, f: __app.sc.opts.filter, obj: __app.state.obj })')
    check(o == {'nA': 24, 'M': 128, 'f': 'hann', 'obj': 'disk'}, f'settings in the address are restored ({o})')
with Browser('tomography/index.html#setup=streaks', size=(400, 850)) as b:
    b.wait('window.__app && __app.ready', timeout=30); settle(b)
    check(b.eval('__app.sc.nA') == 24 and b.eval("document.querySelector('#help').classList.contains('open')"), '#setup=streaks sets up the experiment and opens the drawer')
    b.eval("document.querySelector('#help').classList.remove('open')"); b.sleep(0.3)
    wide = b.eval('document.documentElement.scrollWidth')
    check(wide <= 400, f'at phone width nothing sticks out sideways (page {wide} px wide)')
    b.screenshot('build/tomo-phone.png')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no errors at phone width' + ('' if not errors else ': ' + '; '.join(errors[:3])))

print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
