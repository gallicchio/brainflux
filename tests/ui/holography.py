#!/usr/bin/env python3
"""Drive the holography demo like a student: the opening view, dragging and clicking, every
experiment, and every number its help quotes, measured in the running page.  Nothing here waits on
the clock: sweeps are stepped with __app.advance(t) and frames drawn with __app.redraw()."""
import json, math, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

# Where the words and number slots of some readouts are, to check that they keep still: each word
# (not the numbers) by its readout, the readout's words and its place among them; each number slot
# likewise.  Two layouts are compared word by word where the wording is the same.
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
def layout_moves(a, b, tol=0.5):
    """What moved by more than tol px between two LAYOUT records (where the wording is the same)."""
    return [(k.split('|')[0], k.split('|')[-1], round(max(abs(x - y) for x, y in zip(p, b[k])), 1)) for k, p in a.items()
            if k in b and max(abs(x - y) for x, y in zip(p, b[k])) > tol]

LAM, P, N = 0.633, 5, 256
L = N * P                                # the plate, um
DU = LAM / (N * P)                       # one display pixel of the view, radians
H = N // 2

# JavaScript helpers, defined once in the page.
HELPERS = """
window.T = {
  // the brightest pixel of the view within r pixels of (i, j), and the centroid round it
  spot(i, j, r = 3) {
    const I = __app.W.view, n = 256; let best = -1, bi = i, bj = j;
    for (let b = Math.round(j) - r; b <= Math.round(j) + r; b++) for (let a = Math.round(i) - r; a <= Math.round(i) + r; a++) if (I[b * n + a] > best) { best = I[b * n + a]; bi = a; bj = b; }
    let s = 0, si = 0, sj = 0;
    for (let b = bj - 2; b <= bj + 2; b++) for (let a = bi - 2; a <= bi + 2; a++) { const v = I[b * n + a]; s += v; si += v * a; sj += v * b; }
    return [si / s, sj / s, best];
  },
  // correlation of the view with a brightness map over a box [i0, j0, i1, j1], after averaging
  // over (2w+1)^2 pixels (to smooth speckle)
  corr(B, box, w = 0) {
    const I = __app.W.view, n = 256, [i0, j0, i1, j1] = box;
    const sm = (A, i, j) => { let s = 0; for (let b = -w; b <= w; b++) for (let a = -w; a <= w; a++) s += A[(j + b) * n + i + a]; return s; };
    const xs = [], ys = [];
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { xs.push(sm(I, i, j)); ys.push(B[j * n + i]); }
    const m = (a) => a.reduce((p, q) => p + q, 0) / a.length, mx = m(xs), my = m(ys);
    let xy = 0, xx = 0, yy = 0;
    for (let k = 0; k < xs.length; k++) { xy += (xs[k] - mx) * (ys[k] - my); xx += (xs[k] - mx) ** 2; yy += (ys[k] - my) ** 2; }
    return xy / Math.sqrt(xx * yy);
  },
  centroid(box) {
    const I = __app.W.view, n = 256, [i0, j0, i1, j1] = box; let s = 0, si = 0, sj = 0;
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { const v = I[j * n + i]; s += v; si += v * i; sj += v * j; }
    return [si / s, sj / s];
  },
  // the view along row j (or column i), averaged over 2w+1 rows (columns)
  row(j, w = 2) { const I = __app.W.view, n = 256, out = []; for (let i = 0; i < n; i++) { let s = 0; for (let b = -w; b <= w; b++) s += I[(j + b) * n + i]; out.push(s / (2 * w + 1)); } return out; },
  col(i, w = 2) { const I = __app.W.view, n = 256, out = []; for (let j = 0; j < n; j++) { let s = 0; for (let a = -w; a <= w; a++) s += I[j * n + i + a]; out.push(s / (2 * w + 1)); } return out; },
  slider(label, value, within = '') {
    const box = [...document.querySelectorAll(`${within} .slider`)].filter((s) => s.offsetParent !== null).find((s) => s.querySelector('label').textContent === label).querySelector('input[type=number]');
    box.value = value; box.dispatchEvent(new Event('change'));
  },
  button(text) { [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null).find((b) => b.textContent === text).click(); },
  text(sel) { return document.querySelector(sel).textContent.replace(/\\s+/g, ' '); },
};
true
"""

def theme_colors(b):
    """The luminance (0 black, 1 white) of the page's background, the first hint's text, and the
    Start-here block's text and background, with the drawer open."""
    b.eval("document.querySelector('#help').classList.add('open')")
    out = b.eval("""(() => { const cs = (e) => getComputedStyle(e), h = document.querySelector('#rec-hint'), s = document.querySelector('#help .start');
      const lum = (c) => { const m = c.match(/\\d+(\\.\\d+)?/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
      return { page: lum(cs(document.body).backgroundColor), hint: lum(cs(h).color), start: lum(cs(s).color), start_bg: lum(cs(s).backgroundColor) }; })()""")
    b.eval("document.querySelector('#help').classList.remove('open')")
    return out

def edges(profile, frac=0.25, lo=0, hi=N):
    """The edges of the patch of light in profile[lo:hi], to a fraction of a pixel: where it
    crosses frac of its plateau (the mean over the middle half of where it is above half its
    largest), going outwards.  A quarter: at the geometric edge of a shadow, or of an aperture out
    of focus, Fresnel's straight edge has half the amplitude, so a quarter of the light, of the
    plateau inside.  An edge that is not in [lo, hi) is None."""
    seg = profile[lo:hi]
    top = max(seg)
    on = [k for k, v in enumerate(seg) if v >= 0.5 * top]
    a, b = on[0], on[-1]
    mid = seg[a + (b - a) // 4: b - (b - a) // 4 + 1]
    lev = frac * sum(mid) / len(mid)
    up = next((k for k in range(a, 0, -1) if seg[k - 1] < lev <= seg[k]), None)
    dn = next((k for k in range(b, len(seg)) if seg[k - 1] >= lev > seg[k]), None)
    f = lambda k: None if k is None else lo + k - 1 + (lev - seg[k - 1]) / (seg[k] - seg[k - 1])
    return f(up), f(dn)

with Browser('holography/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1)
    b.eval(HELPERS); b.eval('__app.redraw()')
    b.screenshot('build/holo-start.png')
    S = lambda e: b.eval(e)
    redraw = lambda: b.eval('__app.redraw()')

    # The opening view: one point, the reference tilted, the camera on the image.
    st = S('[__app.state.points.length, __app.state.points[0].z, +(__app.state.theta * 180 / Math.PI).toFixed(6), __app.state.focus, __app.state.sweepFocus]')
    check(st == [1, 60000, 1, 60000, False], f'the page opens on one point 60 mm behind the plate, the reference at 1°, the camera focused at 60 mm, still ({st})')
    check('Three separate islands' in S('__app.verdict()'), f"... off axis and clean: {S('__app.verdict()')!r}")
    note, terms = S("T.text('#recon-note')"), S("T.text('#terms')").replace(' ', ' ')
    check('60.0 mm behind, on the image' in note, f'... and says so: {note!r}')
    check('1.00° up' in terms and 'as if from 60.0 mm behind (virtual)' in terms and 'converging 60.0 mm in front (real)' in terms,
          f'the three terms say where their light goes: {terms!r}')

    # The first screen: hints directly under the Record and Relight views say what to drag and
    # click; the zero order, the twin, the conjugate and the transform are glossed where they appear.
    hints = S("""['#rec-hint', '#play-hint'].map((s, k) => { const h = document.querySelector(s), r = h.getBoundingClientRect();
      return [h.className, h.textContent.slice(0, 32), r.height > 0, r.top - document.querySelector(['#rec', '#play'][k]).getBoundingClientRect().bottom]; })""")
    check(hints[0][0] == 'hint' and hints[0][1].startswith('Drag the point') and hints[0][2] and 0 <= hints[0][3] < 12
          and hints[1][0] == 'hint' and hints[1][1].startswith('Click') and hints[1][2] and 0 <= hints[1][3] < 12,
          f'hints under the Record and Relight views say what to drag and click: {hints[0][1]!r}, {hints[1][1]!r}')
    glosses = S("T.text('#terms') + ' | ' + T.text('#relight-note') + ' | ' + T.text('#spec-note') + ' | ' + T.text('#holo-note')")
    check('lighting beam itself' in glosses and 'curvature reversed' in glosses and 'tilted the other way' in glosses and 'one island per beam' in glosses and 'brightness' in glosses,
          'the zero order, the twin, the conjugate and the transform are glossed where they appear')
    cols = theme_colors(b)
    check(cols['page'] > 0.8 and cols['hint'] < 0.5 and cols['start'] < 0.3 and cols['start_bg'] > 0.8,
          f"light theme: the hint and the Start-here block read (luminances: page {cols['page']:.2f}, hint {cols['hint']:.2f}, block {cols['start']:.2f} on {cols['start_bg']:.2f})")
    first = S("(() => { const s = [...document.querySelector('#help').children].filter((e) => e.tagName !== 'HEADER')[0]; return [s.className, s.querySelector('h3')?.textContent, !!s.querySelector('math'), s.textContent.length]; })()")
    check(first[0] == 'start' and first[1] == 'Start here' and not first[2] and 300 < first[3] < 1600, f'the drawer starts with a "Start here" block in plain words ({first[3]} characters, no equations)')
    order = S("[...document.querySelector('#help').children].map((e) => e.tagName + (e.id ? '#' + e.id : '') + (e.dataset.setup ? '=' + e.dataset.setup : ''))")
    last_exp = max(i for i, x in enumerate(order) if '=' in x)
    check(order.index('SECTION#how') > last_exp and order[2] == 'ARTICLE=zone', f'the theory ("How it works") comes after the experiments ({order[2]} first)')
    hows = S("document.querySelectorAll('#how math').length")
    check(hows >= 10, f'"How it works" keeps the equations ({hows} formulas)')

    # Every experiment in the drawer has a set-up, and the other way round; the old names work.
    arts = S("[...document.querySelectorAll('#help .exp')].map((a) => a.dataset.setup)")
    keys = S('Object.keys(__app.setups)')
    check(sorted(arts) == sorted(keys) and len(arts) >= 10, f'{len(arts)} experiments, each with its set-up')
    aliases = S('__app.aliases')
    check(all(v in keys for v in aliases.values()) and {'gabor', 'islands'} <= set(aliases), f'the old set-up names still open something: {aliases}')

    # Dragging the point in the Record view changes its depth and height, and the hologram.
    fx, fy = S('__app.sidePoint(0)')
    before = S('[__app.state.points[0].z, __app.state.points[0].y, __app.W.H.reduce((a, v, o) => a + v * (o % 97), 0)]')
    b.drag('#rec', (fx, fy), (fx + 0.08, fy - 0.15), steps=8); b.sleep(0.3); redraw()
    after = S('[__app.state.points[0].z, __app.state.points[0].y, __app.W.H.reduce((a, v, o) => a + v * (o % 97), 0)]')
    check(after[0] < before[0] and after[1] > before[1] and abs(after[2] - before[2]) > 1e-6 * abs(before[2]),
          f'dragging the point in the Record view: depth {before[0]/1000:.1f} -> {after[0]/1000:.1f} mm, height {before[1]:.0f} -> {after[1]:.0f} um, and the hologram changes')
    fx, fy = S('__app.frontPoint(0)')
    x0 = S('__app.state.points[0].x')
    b.drag('#front', (fx, fy), (fx + 0.1, fy), steps=6); b.sleep(0.3)
    x1 = S('__app.state.points[0].x')
    check(x1 > x0 + 50, f'dragging the point in the front view moves it sideways ({x0:.0f} -> {x1:.0f} um)')

    # Clicking in the Relight view focuses the camera there; near the twin it snaps onto it.
    S('__app.setups.tilt()'); redraw()
    b.click('#play', (0.25, 0.5)); b.sleep(0.2)
    f1 = S('__app.state.focus')
    fx, fy = S('__app.playMark(2)')
    b.click('#play', (fx + 0.004, fy + 0.02)); b.sleep(0.2); redraw()
    f2 = S('__app.state.focus')
    note = S("T.text('#recon-note')")
    check(f1 > 0 and abs(f2 + 60000) < 1 and 'on the twin' in note, f'clicking in the Relight view focuses there ({f1/1000:.1f} mm), and on the twin it snaps to it ({f2/1000:.1f} mm: {note!r})')

    # Speed (shown, not tested: other programs share the machine).
    ms = S('(() => { const t = []; for (let k = 0; k < 20; k++) { __app.state.points[0].x += 7; t.push(__app.redraw()); } t.sort((a, b) => a - b); return t[10]; })()')
    msf = S('(() => { const t = []; for (let k = 0; k < 20; k++) { __app.state.focus += 300; t.push(__app.redraw()); } t.sort((a, b) => a - b); return t[10]; })()')
    print(f'      (median {ms:.1f} ms per frame while dragging a point, {msf:.1f} ms while focusing)')

    # The view is unitary: all the light leaving the plate, somewhere.
    e = S("""(() => { const { H, C, L, view } = __app.W; let a = 0, s = 0;
        for (let o = 0; o < H.length; o++) a += H[o] * H[o] * (C.re[o] ** 2 + C.im[o] ** 2) * (L.re[o] ** 2 + L.im[o] ** 2);
        for (let o = 0; o < view.length; o++) s += view[o]; return [a, s]; })()""")
    check(abs(e[1] / e[0] - 1) < 1e-6, f'the view holds all the light leaving the plate ({e[0]:.6g} vs {e[1]:.6g})')

    # 'Focus on the image' finds the selected point, and the point is drawn at x/z, y/z.
    S('__app.apply({ points: [{ x: 350, y: -300, z: 90000, b: 1 }], theta: Math.PI / 180 })'); redraw()
    S("T.button('Focus on the image')"); redraw()
    pt = S('__app.state.points[0]')
    check(abs(S('__app.state.focus') - pt['z']) < 1, f"'Focus on the image' focuses at the point's depth ({S('__app.state.focus')/1000:.2f} mm)")
    wi, wj = H + pt['x'] / pt['z'] / DU, H - pt['y'] / pt['z'] / DU
    ci, cj, _ = S(f'T.spot({wi}, {wj})')
    check(math.hypot(ci - wi, cj - wj) < 0.5, f'the point is drawn at its direction: ({ci:.2f}, {cj:.2f}), expected ({wi:.2f}, {wj:.2f})')
    m = S('__app.marks()')
    check(math.hypot(m[1]['i'] - wi, m[1]['j'] - wj) < 0.01, f"... and labelled there ({m[1]['i']:.2f}, {m[1]['j']:.2f})")

    # 1. The zone plate: rings at sqrt(n lambda z); the image and the twin are both sharp.
    S('__app.setups.zone()'); redraw()
    rings = S("""(() => { const H = __app.W.H, n = 256, row = H.subarray(128 * n, 129 * n), r = [];
        for (let i = 129; i < n - 1; i++) { const [l, c, q] = [row[i - 1], row[i], row[i + 1]];
          if ((c > l && c >= q) || (c < l && c <= q)) r.push(((i - 128) + 0.5 * (l - q) / (l - 2 * c + q)) * 5); }
        return r; })()""")
    worst = max(abs(r - math.sqrt((k + 1) * LAM * 60000)) for k, r in enumerate(rings))
    # Bright in the middle, then dark at r_1, bright at r_2, ...
    vals = S(f'[128, {128 + round(rings[0] / P)}, {128 + round(rings[1] / P)}].map((i) => __app.W.H[128 * 256 + i])')
    alternate = vals[0] > vals[1] < vals[2]
    check(len(rings) == 10 and worst < 0.5 and alternate, f'zone plate: {len(rings)} brightest and darkest circles out to the edge, at sqrt(n lambda z) to {worst:.2f} um, bright in the middle and dark at n = 1 ({[round(v, 3) for v in vals]})')
    v = S('T.spot(128, 128, 2)')
    # In line, round the dot: the zero order, the plate out of focus, L/d wide (across a row just
    # off the dot).  The twin's light lies on top and interferes with it at its edges, which
    # blurs them by a few per cent; experiment 2, with the beams apart, measures it cleanly.
    a0, a1 = edges(S('T.row(134, 1)'), 0.25, 60, 196)
    check(abs((a1 - a0) * DU * 1000 - L / 60) < 1.5, f'in line, the zero order round the dot is a square {(a1 - a0) * DU * 1000:.1f} mrad wide (L/d = {L/60:.1f}; the twin on top blurs its edges)')
    S("T.button('on the twin')"); redraw()
    r = S('T.spot(128, 128, 2)')
    check(abs(S('__app.state.focus') + 60000) < 1 and abs(r[0] - 128) < 0.3 and abs(r[1] - 128) < 0.3 and r[2] > 0.5 * v[2],
          f"'on the twin' focuses 60 mm in front, where the twin is as sharp as the image (peaks {r[2]:.4g}, {v[2]:.4g})")

    # 2. Tilt the reference: the rings' centre moves up to z tan(theta); the islands part at 0.61°.
    S('__app.setups.tilt()'); redraw()
    S("T.slider('angle (°)', 0.3, '#ref-options')"); redraw()
    # The rings' centre is their centre of symmetry: the middle column of the hologram, folded
    # about it, matches itself best (in steps of a tenth of a pixel, linear between pixels).
    jc = S("""(() => { const H = __app.W.H, n = 256, at = (y) => { const j = Math.floor(y), t = y - j; return H[j * n + 128] * (1 - t) + H[(j + 1) * n + 128] * t; };
        let m = 0; for (let j = 0; j < n; j++) m += H[j * n + 128] / n;
        let best = -Infinity, arg = 0;
        for (let y = 45; y <= 120; y += 0.1) { let c = 0; for (let k = 1; k <= 40; k++) c += (at(y + k) - m) * (at(y - k) - m); if (c > best) { best = c; arg = y; } }
        return arg; })()""")
    want = 60000 * math.tan(0.3 * math.pi / 180)
    check(abs((H - jc) * P - want) < 3, f'at 0.3° the rings are centred {(H - jc) * P:.1f} um above the middle of the plate; z tan(theta) = {want:.1f} um')
    seen = {}
    for deg in (0.60, 0.62):
        S(f"T.slider('angle (°)', {deg}, '#ref-options')"); redraw()
        seen[deg] = S('__app.verdict()')
    th = math.degrees(math.atan(L / 2 / 60000))
    check('overlap' in seen[0.60] and 'Three separate' in seen[0.62], f'the image and twin islands part between 0.60° and 0.62° (tan theta = L/2z at {th:.3f}°)')
    S("T.slider('angle (°)', 1, '#ref-options')"); redraw()
    # The zero order: the plate out of focus, a square L/d wide, theta below the image; the twin
    # twice as wide, 2 theta below.  (Measured by their edges, where they do not overlap.)
    s1 = math.sin(math.pi / 180)
    jz = round(H + 0.010 / DU)                          # a row 10 mrad below: zero order only
    a0, a1 = edges(S(f'T.row({jz})'))
    jt = round(H + 0.042 / DU)                          # 42 mrad below: twin only
    t0_, t1_ = edges(S(f'T.row({jt})'))
    col = S('T.col(138, 0)')                            # (clear of the image's own faint cross)
    top_zero = edges(col, 0.25, H + 4, H + 24)[0]       # its top edge, below the image
    bot_twin = edges(col, 0.25, H + 70, N)[1]           # the twin's bottom edge
    wz, wt = (a1 - a0) * DU * 1000, (t1_ - t0_) * DU * 1000
    cz, ct = ((top_zero - H) * DU * 1000 + wz / 2), ((bot_twin - H) * DU * 1000 - wt / 2)
    check(abs(wz - L / 60) < 0.6 and abs(wt - 2 * L / 60) < 1, f'focused on the image, the zero order is a square {wz:.1f} mrad wide (L/d = {L/60:.1f}), the twin {wt:.1f} (twice that)')
    check(abs(cz - 1000 * s1) < 0.6 and abs(ct - 2000 * s1) < 1, f'... centred {cz:.1f} and {ct:.1f} mrad below the image (sin theta = {1000*s1:.2f}, 2 sin theta = {2000*s1:.2f})')
    tw = S('__app.terms()[2]')
    check(abs(tw['R'] + 60000) < 1 and abs(tw['y'] - 2 * 60000 * s1) < 1, f"the twin converges {-tw['R']/1000:.1f} mm in front, {tw['y']/1000:.2f} mm up (2 z sin theta)")
    # Past 1.20° the twin reaches the bottom of the view (and comes back at the top): its bottom
    # edge, measured at 1.00° and 1.10°, reaches the edge of the view, 63.3 mrad, at
    bots = []
    for deg in (1.0, 1.1):
        S(f"T.slider('angle (°)', {deg}, '#ref-options')"); redraw()
        bots.append((edges(S('T.col(138, 0)'), 0.25, H + 70, N)[1] - H) * DU)
    reach = 1.0 + 0.1 * (LAM / 10 - bots[0]) / (bots[1] - bots[0])
    check(abs(reach - 1.20) < 0.015, f'the twin reaches the bottom of the view at {reach:.3f}° (its bottom edge {1000*bots[0]:.1f} mrad down at 1.00°, {1000*bots[1]:.1f} at 1.10°; the view ends at {LAM/10*1000:.1f})')

    # 3. A whole object: the twin clears at 0.78°, the haze at 1.74°, aliasing past 2.85°.
    S('__app.setups.offaxis()'); redraw()
    seen = {}
    for deg in (0.77, 0.80, 1.72, 1.76, 2.84, 2.86):
        S(f"T.slider('angle (°)', {deg}, '#ref-options')"); redraw()
        seen[deg] = S('__app.verdict()')
    kinds = {d: ('twin' if 'twin islands overlap' in t else 'haze' if 'middle one' in t else 'clean' if 'Three separate' in t else 'alias' if 'past the edge' in t else '?') for d, t in seen.items()}
    B, Wz = (2000 + L) / 2 / 120000, 2000 / 120000
    check([kinds[d] for d in (0.77, 0.80, 1.72, 1.76, 2.84, 2.86)] == ['twin', 'haze', 'haze', 'clean', 'clean', 'alias'],
          f'tilting the reference: {kinds} (B = {1000*B:.1f} mrad at {math.degrees(math.asin(B)):.2f}°, B + W/z at {math.degrees(math.asin(B + Wz)):.2f}°, the edge at {math.degrees(math.asin(LAM / 10 - B)):.2f}°)')
    S("T.slider('angle (°)', 2.2, '#ref-options')"); redraw()
    c = S('T.corr(__app.W.picB, [93, 93, 163, 163])')
    S("T.slider('angle (°)', 0, '#ref-options')"); redraw()
    c0 = S('T.corr(__app.W.picB, [93, 93, 163, 163])')
    check(c > 0.9 and c0 < 0.5, f'the F through the plate: correlation {c:.3f} off axis, {c0:.3f} in line')

    # 4. Focus through depth: each point sharp at its own depth; the 50 mm point's blur at 80 mm.
    S('__app.setups.depth()')
    seenf = sorted({round(S(f'(__app.advance({t}), __app.state.focus)')) for t in (0, 1, 2, 3, 4)})
    pts = S('__app.state.points')
    check(seenf[0] < 0.85 * 50000 and seenf[-1] > 1.15 * 130000, f'the focus sweeps from {seenf[0]/1000:.1f} to {seenf[-1]/1000:.1f} mm, through all three depths')
    S('(__app.state.sweepFocus = false, __app.setFocus(80000))'); redraw()
    p1 = pts[0]
    i1, j1 = round(H + p1['x'] / p1['z'] / DU), round(H - p1['y'] / p1['z'] / DU)
    a0, a1 = edges(S(f'T.row({j1 - 4}, 1)'), 0.25, i1 - 25, i1 + 25)   # (its upper half, clear of the third point's blur)
    blur = (a1 - a0) * DU * 1000
    check(abs(blur - L * (1 / 50000 - 1 / 80000) * 1000) < 0.5, f'focused at 80 mm, the point at 50 mm is a square {blur:.1f} mrad wide; L|1/d - 1/z| = {L*(1/50000-1/80000)*1000:.1f}')
    for k, p_ in enumerate(pts):
        S(f'(__app.state.sel = {k}, __app.setFocus({p_["z"]}))'); redraw()
        wi, wj = H + p_['x'] / p_['z'] / DU, H - p_['y'] / p_['z'] / DU
        sharp = S(f'T.spot({wi}, {wj})')[2]
        S(f'__app.setFocus({p_["z"] * 0.8})'); redraw()
        soft = S(f'T.spot({wi}, {wj})')[2]
        check(sharp > 3 * soft, f'point {k + 1} ({p_["z"]/1000:.0f} mm) is sharp in focus: peak {sharp:.3g}, {soft:.3g} at 0.8 z')

    # 5. Parallax: the near and far points move opposite ways as the window moves.
    S('__app.setups.parallax()'); redraw()
    def spots(yw):
        S(f"T.slider('height (mm)', {yw}, '#tool-options')"); redraw()
        if yw < 0: check(not S('__app.state.sweepWindow'), 'moving the window by hand stops the sweep')
        out = []
        for z in (40000, 60000, 100000):
            v = yw * 1000 / 60000 - yw * 1000 / z
            out.append(H - S(f'T.spot(128, {H - v / DU}, 2)')[1])
        return out
    left, right = spots(-0.45), spots(0.45)
    moves = [r - l for l, r in zip(left, right)]
    pred = [900 * (1 / 60000 - 1 / z) / DU for z in (40000, 60000, 100000)]
    check(all(abs(m - p) < 1.5 for m, p in zip(moves, pred)), f'parallax: moving the window 0.9 mm up moves the points {moves[0]:.1f}, {moves[1]:.1f}, {moves[2]:.1f} pixels (predicted {pred[0]:.1f}, {pred[1]:.1f}, {pred[2]:.1f})')

    # 6. Cutting the hologram: the whole F survives.
    S('__app.setups.cut()'); redraw()
    check(S("document.querySelector('#tools-panel').open"), 'the cutting tools are open for experiment 6')
    box = '[90, 90, 166, 166]'
    full = S(f'T.corr(__app.W.picB, {box})')
    S("T.button('Cover half')"); redraw()
    half = S(f'T.corr(__app.W.picB, {box}, 2)')
    S('__app.uncover(); (() => { const m = __app.W.mask; for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) if (!(i >= 96 && i < 160 && j >= 96 && j < 160)) m[j * 256 + i] = 0; })(); __app.maskChanged()'); redraw()
    piece = S(f'T.corr(__app.W.picB, {box}, 3)')
    b.screenshot('build/holo-cut-piece.png')
    check(full > 0.95 and half > 0.7 and piece > 0.5, f'the F from the whole plate {full:.3f}, from half {half:.3f}, from a sixteenth {piece:.3f} (correlation, speckle averaged)')
    # The tools: the window, the eraser, a piece kept.
    S('__app.uncover()'); S("T.button('Move window')")
    b.drag('#holo', (0.5, 0.5), (0.3, 0.6), steps=6); b.sleep(0.2)
    w = S('[__app.state.window, __app.state.win.x, __app.state.win.y]')
    check(w[0] and abs(w[1] + 256) < 6 and abs(w[2] + 128) < 6, f'dragging on the hologram moves the window to ({w[1]:.0f}, {w[2]:.0f}) um')
    S("T.button('Erase')")
    b.drag('#holo', (0.2, 0.2), (0.8, 0.3), steps=10); b.sleep(0.2)
    covered = S('__app.W.mask.reduce((a, v) => a + (v === 0), 0)')
    check(covered > 1000, f'the eraser covers part of the plate ({covered} pixels)')
    S("T.button('Uncover all')"); S("T.button('Keep a piece')")
    b.drag('#holo', (0.5, 0.5), (0.6, 0.6), steps=6); b.sleep(0.6)
    kept = S('__app.W.mask.reduce((a, v) => a + v, 0)')
    check(abs(math.sqrt(kept) - (2 * 25.6 + 1)) < 2.5, f'keeping a piece: a square of {math.sqrt(kept):.1f} pixels remains')
    check('cut=piece' in S('location.hash'), 'the piece is kept in the URL')
    # With the tools folded away, the hologram does nothing when dragged.
    S("document.querySelector('#tools-panel').open = false"); b.sleep(0.2)
    m0 = S('__app.W.mask.reduce((a, v) => a + v, 0)')
    b.drag('#holo', (0.3, 0.3), (0.7, 0.7), steps=6); b.sleep(0.2)
    check(S('__app.W.mask.reduce((a, v) => a + v, 0)') == m0 and not S('__app.state.tools'), 'with its tools folded away, dragging on the hologram changes nothing')

    # 7. The conjugate: real images straight in front of the points.
    S('__app.setups.conjugate()'); redraw()
    pts = S('__app.state.points')
    for k, (pt, d) in enumerate(zip(pts, (-50000, -90000))):
        S(f'(__app.state.sel = {k}, __app.setFocus({d}))'); redraw()
        wi, wj = H + pt['x'] / pt['z'] / DU, H - pt['y'] / pt['z'] / DU
        ci, cj, _ = S(f'T.spot({wi}, {wj})')
        im = S('__app.terms()[2]')
        check(math.hypot(ci - wi, cj - wj) < 0.5 and abs(im['R'] + pt['z']) < 1 and abs(im['x'] - pt['x']) < 1 and abs(im['y'] - pt['y']) < 1,
              f"lit by R*, point {k + 1}'s real image is {-im['R']/1000:.0f} mm in front at ({im['x']:.0f}, {im['y']:.0f}) um, straight in front of the point; seen at ({ci:.2f}, {cj:.2f}), expected ({wi:.2f}, {wj:.2f})")
    note = S("T.text('#recon-note')")
    check('on the real image' in note and 'tilted the other way' in S("T.text('#play-note')"), f'... and the notes say so ({note!r})')

    # Relighting in another colour is one button away: it shows the colour's slider.
    S('__app.setups.tilt()'); redraw()
    vis = lambda: S("[...document.querySelectorAll('#lambda2-box .slider')].some((e) => e.offsetParent !== null)")
    hidden = not vis()
    S("T.button('Another colour')"); redraw()
    shown, same = vis(), S('__app.state.sameColour')
    S("T.slider('λ (nm)', 500)"); redraw()
    check(hidden and shown and not same and abs(S('__app.terms()[1].R') - 60000 * 633 / 500) < 1,
          f"'Another colour' shows the colour's slider; at 500 nm the image is {S('__app.terms()[1].R')/1000:.1f} mm behind (60 x 633/500 = {60*633/500:.1f})")

    # 8. Another colour: the image moves to z lambda/lambda2, looks smaller and moves down.
    S('__app.setups.wavelength()'); redraw()
    S("T.button('Focus on the image')"); redraw()
    f = S('__app.state.focus')
    check(abs(f - 150000 * 633 / 532) < 10, f'relit in green, the image is at {f/1000:.1f} mm (150 x 633/532 = {150*633/532:.1f})')
    box = '[96, 96, 160, 168]'
    c532 = S(f'T.centroid({box})')
    S("T.slider('λ (nm)', 633)"); S("T.button('Focus on the image')"); redraw()
    c633 = S(f'T.centroid({box})')
    mu, s = 532 / 633, math.sin(2 * math.pi / 180)
    pred = [H + mu * (c633[0] - H), H + mu * (c633[1] - H) + (1 - mu) * s / DU]
    check(math.hypot(c532[0] - pred[0], c532[1] - pred[1]) < 1.5,
          f'in green the F is {mu:.2f} as big and {(1-mu)*s*1000:.1f} mrad lower: centre ({c532[0]-H:.1f}, {H-c532[1]:.1f}) px, predicted ({pred[0]-H:.1f}, {H-pred[1]:.1f}); in red ({c633[0]-H:.1f}, {H-c633[1]:.1f})')
    S("T.slider('λ (nm)', 532)"); redraw()
    tt = S('__app.terms()')
    # The F's two ends, at y = +-2 mm: their images 4 mm apart still (the F as big as before).
    size = S("""(() => { const a = __app.terms; __app.state.object = 'points'; __app.state.points = [{ x: 0, y: 2000, z: 150000, b: 1 }];
        const t1 = __app.terms()[1]; __app.state.points = [{ x: 0, y: -2000, z: 150000, b: 1 }]; const t2 = __app.terms()[1];
        __app.state.object = 'picture'; return t1.y - t2.y; })()""")
    check(abs(size - 4000) < 1e-6, f'... and as big as before: the images of its ends are {size/1000:.3f} mm apart, as they were')

    # 9. Binary: the F survives; a binary zone plate has a focus at z/3 too.
    S('__app.setups.binary()'); redraw()
    only01 = S('__app.W.H.every((v) => v === 0 || v === 1)')
    cb = S('T.corr(__app.W.picB, [93, 93, 163, 163])')
    check(only01 and cb > 0.8, f'the binary hologram is black and white, and its F correlates {cb:.3f} with the picture')
    S("document.querySelector('#camera-panel').open = true"); b.sleep(0.2)
    S("T.slider('bits', 4)"); redraw()
    c4 = S('T.corr(__app.W.picB, [93, 93, 163, 163])')
    check(c4 > 0.97, f'with 4 bits the F correlates {c4:.3f} (the help: all but perfect)')
    S('__app.setups.zone()'); redraw()
    peak = lambda d: S(f'(__app.setFocus({d}), __app.redraw(), T.spot(128, 128, 1)[2])')
    grey = [peak(d) for d in (17000, 20000, 23000)]
    S('__app.apply({ ...__app.state, points: __app.state.points, bits: 1, zoomS: 2 })'); redraw()
    bin_ = [peak(d) for d in (17000, 20000, 23000)]
    check(bin_[1] > 3 * bin_[0] and bin_[1] > 3 * bin_[2] and bin_[1] > 10 * grey[1],
          f'a binary zone plate has a sharp focus at z/3 = 20 mm (peak {bin_[1]:.3g}; {bin_[0]:.3g} at 17 mm, {bin_[2]:.3g} at 23 mm; the grey one {grey[1]:.3g})')

    # 11. The lensless Fourier hologram: image and twin both in focus; the reference's source too.
    S('__app.setups.fourier()'); redraw()
    note = S("T.text('#recon-note')")
    tt = S('__app.terms()')
    zj = H + 5000 / 150000 / DU
    zs = S(f'T.spot(128, {zj}, 3)')
    check('on the image and the twin' in note and abs(tt[1]['R'] - 150000) < 1 and abs(tt[2]['R'] - 150000) < 1,
          f'Fourier hologram: image and twin both at 150 mm ({note!r})')
    check(abs(zs[1] - zj) < 0.5 and abs(zs[0] - 128) < 0.5, f'... and the zero order is the reference source, a dot {(zs[1]-H)*DU*1000:.1f} mrad below the F (5 mm / 150 mm = 33.3)')
    # Its transform is a picture of the F: upright in the twin island (above), turned half round in
    # the image island (below), 5 mm / (lambda z) = 67 bins from the middle.
    isl = S("""(() => { const { re, im } = __app.W.S, n = 256, B = __app.W.picB, A = (i, j) => re[j * n + i] ** 2 + im[j * n + i] ** 2;
        const c = (f) => { let sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0, m = 0;
          for (let j = 100; j < 156; j++) for (let i = 100; i < 156; i++) { const a = f(i, j), b = B[j * n + i]; sa += a; sb += b; sab += a * b; saa += a * a; sbb += b * b; m++; }
          return (sab - sa * sb / m) / Math.sqrt((saa - sa * sa / m) * (sbb - sb * sb / m)); };
        return [c((i, j) => A(i, j - 67)), c((i, j) => A(256 - i, 323 - j)), c((i, j) => A(256 - i, 61 + 256 - j)), c((i, j) => A(i, j + 67))]; })()""")
    check(isl[0] > 0.7 and isl[1] > 0.7 and isl[2] < 0.4 and isl[3] < 0.4,
          f'... and its transform is the F, upright in the twin island (correlation {isl[0]:.2f}) and turned half round in the image island ({isl[1]:.2f}); the other way round, {isl[2]:.2f} and {isl[3]:.2f}')

    # 12. The steepest reference: fringes of two pixels, and the warning.
    S('__app.setups.steep()'); redraw()
    note = S("T.text('#fringe-note')").replace(' ', ' ')
    th = S('__app.state.theta * 180 / Math.PI')
    check('2.00 pixels' in note and 'past the edge' in S('__app.verdict()') and abs(th - 3.6287) < 0.001,
          f'the steepest reference, {th:.2f}°: {note!r}; {S("__app.verdict()")!r}')

    # ... and the object's light: a point nearer than N p^2 / lambda = 10 mm makes rings finer
    # than two pixels at the edge of the plate.
    zc = N * P * P / LAM
    S('__app.setups.zone()')
    seen = {}
    for z in (0.95 * zc, 1.05 * zc):
        S(f"T.slider('depth (mm)', {z / 1000:.3f}, '#points-box')"); redraw()
        seen[z] = S('__app.verdict()')
    check('past the edge' in seen[0.95 * zc] and 'past the edge' not in seen[1.05 * zc], f'a point nearer than N p^2/lambda = {zc/1000:.2f} mm makes fringes finer than two pixels (at {0.95*zc/1000:.1f} mm: {seen[0.95*zc][:40]!r}; at {1.05*zc/1000:.1f} mm: {seen[1.05*zc][:40]!r})')

    # The notes keep still: every number in a slot of its own, so that neither its digits nor the
    # words after it move as the focus sweeps and the sliders take numbers of other sizes and signs.
    NOTES = f"{LAYOUT}('#recon-note, #holo-note, #spec-note, #play-note, #fringe-note, #ref-note, #terms > div')"
    S('__app.setups.depth()'); redraw()
    first, bad, seen = S(NOTES), [], set()
    for t in [0.3 * k for k in range(14)]:
        S(f'__app.advance({t})')
        seen.add(S("T.text('#recon-note')"))
        bad += layout_moves(first, S(NOTES))
    check(len(seen) >= 6 and not bad, f'the notes keep still as the focus sweeps ({len(seen)} focus readings, e.g. {sorted(seen)[:2]}; moved {bad[:3]})')
    S("__app.state.sweepFocus = false; document.querySelector('#camera-panel').open = true"); b.sleep(0.2)
    first, moved = S(NOTES), []
    for label, v, within in (('focus (mm)', -250, ''), ('focus (mm)', -3.5, ''), ('focus (mm)', 4, ''), ('focus (mm)', 120, ''),
                             ('angle (°)', 0.25, '#ref-options'), ('angle (°)', 3.3, '#ref-options'), ('depth (mm)', 6, '#points-box'),
                             ('depth (mm)', 480, '#points-box'), ('pixel (µm)', 2, ''), ('pixel (µm)', 19.5, ''), ('angle (°)', 1.2, '#ref-options')):
        S(f'T.slider({json.dumps(label)}, {v}, {json.dumps(within)})'); redraw()
        d = layout_moves(first, S(NOTES))
        if d: moved.append((label, v, d[:2]))
    check(not moved, f'the notes keep still as focus, angle, depth and pixel take other sizes and signs' + (f': moved {moved[:2]}' if moved else ''))
    # The depths beside the points in the front view, and the stretch of the side views: numbers
    # in slots that stay put.
    S("""(() => { const orig = CanvasRenderingContext2D.prototype.fillText; window.__texts = [];
        CanvasRenderingContext2D.prototype.fillText = function (t, x, y, m) {
          if (/\\d/.test(t)) __texts.push([this.canvas.id, String(t), Math.round(this.getTransform().e + x * this.getTransform().a), this.textAlign]);
          return orig.call(this, t, x, y, m); }; })()""")
    S("T.slider('pixel (µm)', 5)")
    xs, texts, stretch = set(), set(), set()
    for v in (6, 45, 90.5, 480, 140):
        S(f"T.slider('depth (mm)', {v}, '#points-box')")
        S('__texts.length = 0; __app.redraw()')
        calls = S('__texts')
        texts |= {t for c_, t, _, _ in calls if c_ == 'front'}
        xs.add(tuple(sorted({x for c_, _, x, _ in calls if c_ == 'front'})))
        stretch |= {(t, x) for c_, t, x, _ in calls if c_ == 'rec' and '×' not in t and 'mm' not in t and t not in ('plate',)}
    check(len(xs) == 1 and len(texts) >= 5, f'the depth labels in the front view keep their places ({sorted(texts)[:6]}; x {sorted(xs)[:3]})')
    stretch_x = {x for t, x in stretch}
    check(len({t for t, _ in stretch}) >= 2 and len(stretch_x) == 1, f'the stretch of the Record view ({sorted(t for t, _ in stretch)}) keeps its place')

    # The URL keeps the state.
    S('__app.setups.fourier()'); b.sleep(0.2)
    S("T.slider('depth (mm)', 140, '#ref-options')"); b.sleep(0.6)
    hsh = S('location.hash')
    want = S('JSON.stringify([__app.state.object, __app.state.picture, __app.state.ref, __app.state.refSrc, __app.state.focus, __app.state.picZ])')
    b.goto('holography/index.html' + hsh); b.wait('window.__app && __app.ready'); b.sleep(0.6)
    got = S('JSON.stringify([__app.state.object, __app.state.picture, __app.state.ref, __app.state.refSrc, __app.state.focus, __app.state.picZ])')
    check(got == want, f'the URL keeps the set-up ({hsh[:60]}...)')

    # Every experiment, with a picture; the old names.
    b.goto('holography/index.html'); b.wait('window.__app && __app.ready'); b.sleep(0.5); b.eval(HELPERS)
    for name in keys:
        S(f'__app.setups[{json.dumps(name)}]()'); S('__app.advance(2)'); b.sleep(0.4)
        b.screenshot(f'build/holo-exp-{name}.png')
    for old, new in aliases.items():
        b.goto(f'holography/index.html#setup={old}'); b.wait('window.__app && __app.ready'); b.sleep(0.5)
        st = S('JSON.stringify([__app.state.object, __app.state.points.length, __app.state.theta, __app.state.picZ])')
        S(f'__app.setups.{new}()')
        check(st == S('JSON.stringify([__app.state.object, __app.state.points.length, __app.state.theta, __app.state.picZ])'), f'#setup={old} opens experiment {new}')
    b.goto('holography/index.html#setup=portrait'); b.wait('window.__app && __app.ready'); b.sleep(1.2)
    check(S('__app.state.picture') == 'fourier', '#setup=portrait opens the portrait')
    b.screenshot('build/holo-thumb-portrait.png')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

# Dark theme, and a phone.
with Browser('holography/index.html#setup=offaxis', size=(1400, 900)) as b:
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
    b.wait('window.__app && __app.ready'); b.sleep(1.2)
    b.screenshot('build/holo-dark.png')
    cols = theme_colors(b)
    check(cols['page'] < 0.2 and cols['hint'] > 0.5 and cols['start'] > 0.7 and cols['start_bg'] < 0.3,
          f"dark theme: the hint and the Start-here block read (luminances: page {cols['page']:.2f}, hint {cols['hint']:.2f}, block {cols['start']:.2f} on {cols['start_bg']:.2f})")
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'dark theme: no exceptions')
with Browser('holography/index.html', size=(390, 844)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1.0)
    wide = b.eval('document.documentElement.scrollWidth')
    check(wide <= 390, f'at phone width nothing sticks out sideways (page {wide} px wide)')
    order = b.eval("[...document.querySelectorAll('.stage > .pane')].map((e) => [e.id, Math.round(e.getBoundingClientRect().top)]).sort((a, b) => a[1] - b[1]).map((e) => e[0])")
    check(order[:4] == ['pane-rec', 'pane-front', 'pane-holo', 'pane-play'], f'on a phone the panes come in the order of the story: {order}')
    ph = b.eval("(() => { const r = document.querySelector('#rec-hint').getBoundingClientRect(); return [r.top, r.bottom, innerHeight, scrollY]; })()")
    check(ph[3] == 0 and ph[0] > 0 and ph[1] <= ph[2], f'phone: the hint is on the first screen, under the Record view (its bottom at {ph[1]:.0f} of {ph[2]} px)')
    b.screenshot('build/holo-phone.png')
    b.eval("document.querySelector('#pane-recon').scrollIntoView()"); b.sleep(0.5)
    b.screenshot('build/holo-phone-view.png')

print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
