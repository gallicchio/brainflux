#!/usr/bin/env python3
"""Drive the MRI demo like a student: the opening, every view and every experiment, the numbers
the help quotes (measured in the running page), the drags and clicks the hints promise, the
readouts that keep still, the drawer (Start here first, How it works last), both themes, the
address, and a phone's screen.

Nothing here waits on the clock: the page's clock is held (__app.hold) and moved on from here
(__app.step), or the views are put at a moment directly."""
import json, math, os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

SETUPS = ['axis', 'drag', 'stronger', 'winding', 'resolution', 'slice', 'moveslice', 'thin', 'rephase',
          'encode', 'fill', 'centre', 'spinecho', 'motion', 'contrast', 'wrap', 'lines', 'noise', 'fat', 'lauterbur']
VIEWS = {'axis': '#v1-main', 'slice': '#v2-main', 'kspace': '#v3-main', 'contrast': '#v4-main'}
GB = 0.042577

def setup(b, name):
    b.eval(f'__app.setups[{json.dumps(name)}](); __app.hold(true); __app.draw(); 0')

def near(a, b, tol): return abs(a - b) <= tol
def reload(b):
    """Reload the page and wait for the new one (a mark on the old window tells them apart)."""
    b.eval('window.__old = 1; location.reload()')
    b.wait('!window.__old && window.__app && __app.ready', timeout=60)
    b.eval('__app.hold(true)')
def quoted(v, text):
    """v rounds to the number quoted in the help, written as text."""
    digits = len(text.split('.')[1]) if '.' in text else 0
    return round(v + 0.0, digits) == float(text)

def visible_hints(b):
    return b.eval("[...document.querySelectorAll('.hint')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map((e) => e.textContent.trim())")

def readout(b, view):
    return b.eval(f"document.querySelector('#v{['axis', 'slice', 'kspace', 'contrast'].index(view) + 1}-readout').innerText")

# Where the words and number slots of a readout are: each word (not the numbers) by its place
# among the readout's words, and each slot, keyed by the readout's words, so that layouts with the
# same wording can be compared.
LAYOUT = r"""((sel) => { const out = {};
  for (const e of document.querySelectorAll(sel)) {
    if (!e.getClientRects().length) continue;
    const walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT), words = []; let n;
    while ((n = walk.nextNode())) {
      if (n.parentElement.closest('.fixnum')) continue;
      for (const m of n.textContent.matchAll(/[^\s\d.,:;()−+-]+/g)) {
        const g = document.createRange(); g.setStart(n, m.index); g.setEnd(n, m.index + m[0].length);
        const r = g.getBoundingClientRect(); words.push([m[0], r.left, r.top]);
      }
    }
    const shape = e.textContent.replace(/[\d.,−+-]+/g, '#');
    words.forEach(([w, x, y], k) => { out[`${shape}|${k}`] = [x, y]; });
    e.querySelectorAll('.fixnum').forEach((s, i) => { const r = s.getBoundingClientRect(); out[`${shape}|slot${i}`] = [r.left, r.top, r.width]; });
  }
  return out; })"""
def keeps_still(b, sel, steps):
    """Run steps (callables that change the numbers) and compare every word and slot with where it
    was first seen with the same wording.  Returns (largest shift in px, comparisons, readings)."""
    base, worst, compared, seen = {}, 0.0, 0, set()
    for step in [lambda: None] + steps:
        step()
        now = b.eval(f'{LAYOUT}({json.dumps(sel)})')
        seen.add(b.eval(f"[...document.querySelectorAll({json.dumps(sel)})].map((e) => e.textContent).join(' | ')"))
        for k, p in now.items():
            if k in base:
                compared += 1
                worst = max([worst] + [abs(x - y) for x, y in zip(base[k], p)])
            else: base[k] = p
    return worst, compared, seen

CONTRAST = r"""((sel, bgSel, pseudo) => { const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g).map(Number);
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  const e = document.querySelector(sel), fg = getComputedStyle(e, pseudo || null).color, bg = getComputedStyle(document.querySelector(bgSel)).backgroundColor;
  const a = lum(fg), b = lum(bg); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 10) / 10; })"""

with Browser('mri/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready', timeout=90)
    b.eval('__app.hold(true)')
    # ------------------------------------------------------------------ the first screen
    p = b.eval('__app.draw()')
    check(b.eval('__app.view') == 'axis' and p['stage'] == 'record' and 0 < p['t'] < p['T'] and p['G'] == 2,
          f"it opens on view 1 with the spins already turning in a 2 mT/m gradient (t = {p['t']:.2f} of {p['T']:.2f} ms)")
    hints = visible_hints(b)
    check(len(hints) == 1 and hints[0].startswith('Drag a piece') and 'field line' in hints[0], f'one hint under the picture says what to drag ({hints})')
    tabs = b.eval("[...document.querySelectorAll('#view-row button')].map((e) => e.textContent)")
    check(tabs == ['1 · One axis', '2 · A slice', '3 · The second axis', '4 · Contrast and artefacts'], f'four numbered tabs, one per step of the story ({tabs})')
    check(b.eval('Object.keys(__app.setups).join()') == ','.join(SETUPS), f'the twenty set-ups keep their names ({len(SETUPS)})')
    dr = b.eval("""(() => { const d = document.querySelector('#help'), kids = [...d.children], first = kids[1];
        return { first: first.className + ':' + (first.querySelector('h3') || {}).textContent, math: first.querySelectorAll('math').length,
          text: first.textContent, theoryLast: kids.findIndex((e) => e.classList.contains('theory')) > kids.findLastIndex((e) => e.classList.contains('exp')),
          theoryHead: d.querySelector('.theory h3')?.textContent, exps: d.querySelectorAll('.exp').length, buttons: d.querySelectorAll('.exp .setup').length,
          errors: d.querySelectorAll('merror').length }; })()""")
    check(dr['first'] == 'start:Start here' and dr['math'] == 0 and all(f'{i} ·' in dr['text'] for i in (1, 2, 3, 4)) and dr['theoryLast'] and dr['theoryHead'] == 'How it works',
          f"the drawer starts with Start here (no equations, a word on each of the four views) and ends with How it works")
    check(dr['exps'] == 20 and dr['buttons'] == 20 and dr['errors'] == 0, f"{dr['exps']} experiments, each with a Set it up button; the equations all render ({dr['errors']} errors)")
    nums = b.eval("[...document.querySelectorAll('#help .exp h3')].map((h) => parseInt(h.textContent))")
    check(nums == list(range(1, 21)), 'the experiments are numbered 1 to 20 in order')
    b.screenshot('build/mri-start.png')

    # ------------------------------------------------------------------ 1 · One axis
    setup(b, 'axis')
    ro = readout(b, 'axis')
    check('85.2 Hz for each millimetre' in ro and '11.74 mm' in ro, f'at 2 mT/m the readout says 85.2 Hz per mm and 1 kHz is 11.74 mm ({ro.splitlines()[0][:90]})')
    # The end of the record: neighbouring arrows 2 mm apart point opposite ways (k = 0.25 per mm).
    p = b.eval('(() => { const v = __app.views.axis; v.set({ ...v.s, T2s: 1e6 }); v.clock.stage = "hold"; v.clock.t = v.T; return __app.draw(); })()')
    ph = p['phases']
    diffs = [abs((ph[i + 1] - ph[i] + math.pi) % (2 * math.pi) - math.pi) for i in range(9, 13)]   # x = -14 .. -8, inside the 12 mm tube
    check(all(near(d, math.pi, 0.01) for d in diffs) and near(p['T'], 0.25 / (GB * 2), 1e-9), f"at the end of the record (T = {p['T']:.3f} ms) neighbouring arrows point opposite ways ({', '.join(f'{d:.3f}' for d in diffs)} rad)")
    sp = p['spectrum']; fs, sre = sp['fs'], sp['re']
    rho = lambda x: 2 * GB * 2 * sre[min(range(len(fs)), key=lambda i: abs(fs[i] - GB * 2 * x))]
    check(near(rho(-12), 1, 0.1) and near(rho(10), 1, 0.15) and abs(rho(0)) < 0.06 and abs(rho(25)) < 0.06,
          f'the finished spectrum is the profile: ρ = {rho(-12):.2f} at the 12 mm tube, {rho(10):.2f} at the 6 mm one, {rho(0):.2f} between, {rho(25):.2f} outside')
    # Hover the spectrum: it says where a frequency comes from.
    box = b.box('#v1-main'); L = p['lay']
    x = box[0] + b.eval('__app.views.axis.F(0.852 * 2)'); y = box[1] + (L['spec']['y0'] + L['spec']['y1']) / 2
    b.mouse('mouseMoved', x, y); b.eval('__app.draw()')
    ro = readout(b, 'axis')
    check('x = +20.0 mm' in ro.replace('+ 20.0', '+20.0') or re.search(r'x =\s*\+?\s*20\.0 mm', ro) is not None, f'pointing at the spectrum at 1.704 kHz reads x = +20.0 mm ({ro.splitlines()[-1][:80]})')
    b.mouse('mouseMoved', 2, 2)
    # Drag the field line's handle: the gradient follows; drag a tube: it moves.
    setup(b, 'axis'); p = b.eval('__app.draw()'); h = p['handle']
    b.drag('#v1-main', (h['x'] / box[2], h['y'] / box[3]), (h['x'] / box[2], (h['y'] - 20) / box[3]), steps=6)
    G1 = b.eval('__app.views.axis.s.G')
    check(G1 > 2.5, f'dragging the field line\'s handle up steepens the gradient (2 -> {G1:.2f} mT/m)')
    setup(b, 'drag'); p = b.eval('__app.draw()'); L = p['lay']
    x0 = b.eval('__app.views.axis.X(-10)'); y0 = (L['sample']['y0'] + L['sample']['y1']) / 2 + 30
    b.drag('#v1-main', (x0 / box[2], y0 / box[3]), ((x0 + b.eval('__app.views.axis.X(0) - __app.views.axis.X(-10)')) / box[2], y0 / box[3]), steps=8)
    pc = b.eval('__app.views.axis.s.pieces[0]')
    check(near(pc['x'], 0, 0.6) and pc['w'] == 20, f"dragging the tube by its middle moves it (to x = {pc['x']} mm, still {pc['w']} mm wide)")
    # Its band moves 0.852 kHz for every 10 mm.
    cen = []
    for xx in (-10, 0):
        b.eval(f"__app.views.axis.set({{ G: 2, pieces: [{{ x: {xx}, w: 20, rho: 1 }}] }}); (() => {{ const v = __app.views.axis; v.clock.stage = 'hold'; v.clock.t = v.T; }})()")
        q = b.eval('__app.draw()')['spectrum']
        w = sum(max(0, v) for v in q['re']); cen.append(sum(f * max(0, v) for f, v in zip(q['fs'], q['re'])) / w)
    check(near(cen[1] - cen[0], 0.852, 0.01), f'moving the tube 10 mm moves its band {cen[1] - cen[0]:.3f} kHz (help: 0.852)')
    xa = b.eval('(() => { const p = __app.views.axis.s.pieces[0]; return __app.views.axis.X(p.x + p.w / 2); })()'); xb = xa + 25
    b.drag('#v1-main', (xa / box[2], y0 / box[3]), (xb / box[2], y0 / box[3]), steps=5)
    check(b.eval('__app.views.axis.s.pieces[0].w') > 20.5, 'dragging a tube by its side widens it')
    # Stronger: 5 mT/m.
    setup(b, 'stronger'); p = b.eval('__app.draw()'); ro = readout(b, 'axis')
    check('212.9 Hz' in ro and '4.70 mm' in ro and near(p['T'], 1.174, 0.0005), f"at 5 mT/m: 212.9 Hz per mm, 1 kHz is 4.70 mm, the record {p['T']:.3f} ms (2.936 at 2 mT/m)")
    # The winding: one tube 20 mm wide; its signal is zero at 1/(GB G w), and -21.7% at 0.840 ms.
    setup(b, 'winding')
    s0 = b.eval('(() => { const v = __app.views.axis; v.clock.stage = "record"; v.clock.t = 1 / (0.042577 * 2 * 20); return __app.draw().signal; })()')
    s1 = b.eval('(() => { const v = __app.views.axis; v.clock.t = 0.8398; return __app.draw().signal; })()')
    check(math.hypot(*s0) < 1e-3 and quoted(1 / (GB * 2 * 20), '0.587') and quoted(100 * s1[0], '-21.6'),
          f'one 20 mm tube: its signal is {math.hypot(*s0):.1e} at 0.587 ms and {100 * s1[0]:.1f}% at 0.840 ms (help: zero and -21.6%)')
    b.screenshot('build/mri-exp-winding.png')
    # Resolution: three thin tubes merge early in the record and part at its end.
    setup(b, 'resolution')
    def peaks_apart(t_frac):
        q = b.eval(f'(() => {{ const v = __app.views.axis; v.clock.stage = "record"; v.clock.t = {t_frac} * v.T; return __app.draw().spectrum; }})()')
        at = lambda x: q['re'][min(range(len(q['fs'])), key=lambda i: abs(q['fs'][i] - GB * 2 * x))]
        return min(at(-7), at(0), at(7)), max(at(-3.5), at(3.5))
    pk, dip = peaks_apart(1.0); pk0, dip0 = peaks_apart(0.25)
    check(dip < 0.5 * pk and dip0 > 0.8 * pk0, f'three 3 mm tubes 7 mm apart: one blob at a quarter of the record (dip {dip0 / pk0:.2f} of the peaks), three peaks at its end ({dip / pk:.2f})')
    # T2*: with no gradient the signal fades by e every T2*.
    b.eval("__app.views.axis.set({ G: 0, T2s: 2, sample: 'one' })")
    s2 = b.eval('(() => { const v = __app.views.axis; v.clock.stage = "record"; v.clock.t = 2; return __app.draw().signal; })()')
    check(near(math.hypot(*s2), math.exp(-1), 1e-3), f'with T₂* = 2 ms and no gradient the signal is {math.hypot(*s2):.4f} of its start after 2 ms (e⁻¹ = 0.3679)')
    # The readout keeps still while the clock runs and the pointer moves.
    setup(b, 'axis')
    worst, compared, seen = keeps_still(b, '#v1-readout > div', [lambda: b.eval('__app.step(0.13, 1)')] * 14)
    check(worst <= 0.5 and len(seen) >= 8, f'view 1: the readout keeps still while its numbers change (largest shift {worst:.1f} px, {compared} comparisons, {len(seen)} readings)')

    # ------------------------------------------------------------------ 2 · A slice
    setup(b, 'slice')
    hints = visible_hints(b)
    check(len(hints) == 1 and hints[0].startswith("Drag the pulse's band"), f'view 2: its own hint ({hints[0][:50]}...)')
    p = b.eval('__app.draw()'); ro = readout(b, 'slice')
    check(quoted(p['thickness'], '8.81') and quoted(p['measured'], '9.45') and '170.3' in ro, f"Δf = 1.5 kHz at 4 mT/m (170.3 Hz/mm): {p['thickness']:.2f} mm by the rule, {p['measured']:.2f} mm tipped (help: 8.81, 9.45)")
    b.eval('__app.views.slice.set({ ...__app.views.slice.s, flip: 30 })')
    check(quoted(b.eval('__app.views.slice.measured'), '8.86'), f"at 30°: {b.eval('__app.views.slice.measured'):.2f} mm (help: 8.86)")
    setup(b, 'moveslice')
    c = b.eval('__app.views.slice.centre'); eyes = b.eval('__app.views.slice.axial && !__app.views.slice.axial.empty')
    check(quoted(c, '-38.0') and eyes, f'f_c = -6.47 kHz puts the slice at z = {c:.1f} mm, through the eyes')
    check(quoted(6.81 / (GB * 4), '40.0'), 'f_c = +6.81 kHz is z = +40.0 mm')
    b.screenshot('build/mri-exp-moveslice.png')
    setup(b, 'thin')
    t1 = b.eval('[__app.views.slice.thickness, __app.views.slice.measured]')
    b.eval('__app.views.slice.set({ ...__app.views.slice.s, bw: 1.5, Gz: 8 })'); t2 = b.eval('[__app.views.slice.thickness, __app.views.slice.measured]')
    b.eval('__app.views.slice.set({ ...__app.views.slice.s, bw: 0.5, Gz: 4, T: 8 })'); t3 = b.eval('[__app.views.slice.thickness, __app.views.slice.measured]')
    b.eval('__app.views.slice.set({ ...__app.views.slice.s, T: 3 })'); t4 = b.eval('__app.views.slice.measured')
    check(quoted(t1[0], '4.40') and quoted(t1[1], '5.60') and quoted(t2[0], '4.40') and quoted(t2[1], '4.72') and quoted(t3[0], '2.94') and quoted(t3[1], '3.22') and quoted(t4, '4.75'),
          f'thinner: half the band {t1[1]:.2f} mm (rule {t1[0]:.2f}), twice the gradient {t2[1]:.2f}, a 0.5 kHz band over 8 ms {t3[1]:.2f} ({t3[0]:.2f}), over 3 ms {t4:.2f}')
    setup(b, 'rephase')
    c0 = b.eval('__app.views.slice.coherence()')
    b.eval('__app.views.slice.set({ ...__app.views.slice.s, rephase: true })'); c1 = b.eval('__app.views.slice.coherence()')
    check(quoted(100 * c0, '3.0') and quoted(100 * c1, '95.5'), f"the twisted slab's spins add to {100 * c0:.1f}%, the rephased one's to {100 * c1:.1f}% (help: 3.0, 95.5)")
    # Drag the band, click the head, tilt the line.
    setup(b, 'slice'); p = b.eval('__app.draw()'); box = b.box('#v2-main'); hc = p['handles']['centre']
    b.drag('#v2-main', (hc['x'] / box[2], hc['y'] / box[3]), ((hc['x'] + 40) / box[2], hc['y'] / box[3]), steps=6)
    fc = b.eval('__app.views.slice.s.fc')
    check(fc > 2, f'dragging the band to the right raises the pulse\'s frequency (f_c = {fc:.2f} kHz) and the slice with it (z = {b.eval("__app.views.slice.centre"):.1f} mm)')
    sb = b.eval('__app.draw().sideBox')
    b.click('#v2-main', (((sb['x0'] + sb['x1']) / 2) / box[2], (sb['y0'] + 0.3 * (sb['y1'] - sb['y0'])) / box[3]))
    zc = b.eval('__app.views.slice.centre')
    check(near(zc, 125 - 0.3 * 250, 3), f'clicking the head 30% down from its top puts the slice there (z = {zc:.1f} mm)')
    hl = b.eval('__app.draw().handles.line')
    b.drag('#v2-main', (hl['x'] / box[2], hl['y'] / box[3]), ((hl['x'] - 30) / box[2], hl['y'] / box[3]), steps=6)
    check(b.eval('__app.views.slice.s.Gz') < 4, f"dragging the field line's handle tilts it (G_z = {b.eval('__app.views.slice.s.Gz'):.2f} mT/m)")
    # The slab's movie in time: at rest before the pulse, tipped after it.
    setup(b, 'slice')
    st = b.eval('(() => { const v = __app.views.slice, a = v.stateAt(0), z = v.stateAt(v.Tend), k = 250; return [a.mz[k], Math.hypot(z.mx[k], z.my[k]), z.mz[k], z.mz[50]]; })()')
    check(near(st[0], 1, 1e-6) and st[1] > 0.99 and abs(st[2]) < 0.02 and st[3] > 0.99, f'the spins at the slab\'s centre start along B₀ (Mz = {st[0]:.3f}) and end tipped ({st[1]:.3f}); far away they stay (Mz = {st[3]:.3f})')
    worst, compared, seen = keeps_still(b, '#v2-readout > div', [lambda: b.eval('__app.step(0.4, 1)')] * 8 + [lambda: b.eval('__app.views.slice.set({ ...__app.views.slice.s, fc: 1.234 })'), lambda: b.eval('__app.views.slice.set({ ...__app.views.slice.s, fc: -3.5 })')])
    check(worst <= 0.5 and len(seen) >= 5, f'view 2: the readout keeps still while its numbers change (largest shift {worst:.1f} px, {len(seen)} readings)')

    # ------------------------------------------------------------------ 3 · The second axis
    setup(b, 'fill')
    hints = visible_hints(b)
    check(len(hints) == 1 and hints[0].startswith('Watch the stripes'), f'view 3: its own hint ({hints[0][:40]}...)')
    p = b.eval('__app.draw()')
    check(p['q'] == 32 and p['u'] == 0 and p['measured'] == 0 and p['playing'], 'it starts a scan with the middle row of k-space')
    counts = []
    for _ in range(4): counts.append(b.eval('(() => { for (let i = 0; i < 300; i++) __app.step(1 / 60, 1); return __app.views.kspace.acq.measuredCount; })()'))
    total = b.eval('(() => { let t = 20; const v = __app.views.kspace; while (!v.scan.done && t < 120) { __app.step(1 / 60, 1); t += 1 / 60; } return t; })()')
    st = b.eval('__app.views.kspace.imageStats()')
    check(counts[0] == 0 and counts[1] == 1 and counts[3] > 20 and total < 25 and st['rms'] < 1e-9,
          f'the first line takes 9 s, the next faster ({counts} lines after 5, 10, 15, 20 s); all 64 in {total:.1f} s; the picture is then the slice to {st["rms"]:.0e}')
    b.screenshot('build/mri-exp-fill-done.png')
    ro = readout(b, 'kspace')
    check(re.search(r'detail along y down to\s+4\.0 mm', ro) is not None, 'with all 64 lines the detail along y is 4.0 mm')
    # 7 middle lines.
    b.eval('(() => { const v = __app.views.kspace; v.acq.clear(); for (const q of [29, 30, 31, 32, 33, 34, 35]) v.acq.measure(q); v.scan.done = false; v.scan.cur = null; __app.draw(); })()')
    ro = readout(b, 'kspace'); st = b.eval('__app.views.kspace.imageStats()')
    check(re.search(r'detail along y down to\s+36\.6 mm', ro) is not None and st['mean'] > 1.0, f"after 7 middle lines the detail along y is 36.6 mm, and the picture is already as bright (mean {st['mean']:.3f} of the true one)")
    # Click a row of k-space: it is measured, in slow motion.
    setup(b, 'fill'); p = b.eval('__app.draw()'); box = b.box('#v3-main'); k = p['lay']['sq'][1]
    b.click('#v3-main', ((k['x0'] + 40.5 / 64 * k['s']) / box[2], (k['y0'] + 10.5 / 64 * k['s']) / box[3]))
    cur = b.eval('JSON.stringify(__app.views.kspace.scan.cur)')
    b.eval('__app.step(0.5, 20)')
    check('"q":10' in cur and b.eval('__app.views.kspace.acq.mask[10]') == 1, f'clicking row 10 of k-space plays it in slow motion and measures it ({cur})')
    # Point at k-space: the spins show that pixel's plane wave.
    x = box[0] + k['x0'] + 40.5 / 64 * k['s']; y = box[1] + k['y0'] + 20.5 / 64 * k['s']
    b.mouse('mouseMoved', x, y); b.eval('__app.draw()')
    hv = b.eval('__app.views.kspace.hover'); ro = readout(b, 'kspace')
    check(hv == {'p': 40, 'q': 20} and 'Pointed at' in ro and '17.8 mm' in ro, f'pointing at k-space pixel (40, 20) shows its plane wave, a turn every 17.8 mm ({ro.splitlines()[-1][:70]}...)')
    b.mouse('mouseMoved', 2, 2)
    # One phase-encoding step: the stripes of row +10, 25.6 mm apart, wound by 0.459 mT/m.
    setup(b, 'encode')
    b.eval('(() => { const v = __app.views.kspace; v.cue(22, v.seq.preStart - 1e-6); })()')
    p = b.eval('__app.draw()'); per = b.eval('__app.views.kspace.stripePeriod()')
    gy = b.eval('Math.abs(__app.views.kspace.seq.Gy(22))'); ro = readout(b, 'kspace')
    check(near(p['k'][0], 0, 1e-9) and near(p['k'][1], -10 / 256, 1e-6) and near(per, 25.6, 0.15) and quoted(gy, '0.459') and '25.6' in ro and '−0.46 mT/m' in ro,
          f"after row +10's lobe: k = ({p['k'][0]:.4f}, {p['k'][1]:.4f}) per mm (the π pulse will make it +0.0391), G_y = {gy:.3f} mT/m; the stripes in the spins are {per:.2f} mm apart")
    b.screenshot('build/mri-exp-encode.png')
    # The right arrow key plays one more line in slow motion.
    setup(b, 'fill'); b.eval('__app.views.kspace.setPlaying(false)'); n0 = b.eval('__app.views.kspace.acq.measuredCount')
    b.key('ArrowRight', 'ArrowRight'); cur = b.eval('__app.views.kspace.scan.cur')
    check(cur is not None and cur['slow'] and not b.eval('__app.views.kspace.s.playing'), f"the → key plays the next line in slow motion and stops ({n0} lines before; row {cur and cur['q']})")
    # The centre and the edges.
    setup(b, 'centre'); e = b.eval('__app.views.kspace.energyMeasured()'); m1 = b.eval('__app.views.kspace.imageStats().mean')
    b.eval("__app.views.kspace.only('edges')"); m2 = b.eval('__app.views.kspace.imageStats().mean'); e2 = b.eval('__app.views.kspace.energyMeasured()')
    check(quoted(100 * e, '86.7') and quoted(m1, '1.06') and quoted(100 * m2, '31') and quoted(100 * e2, '13'),
          f'the middle 16 rows: {100 * e:.1f}% of the energy, the picture {m1:.3f} as bright; the edges: {100 * e2:.1f}%, {m2:.3f} (help: 86.7%, 1.06; 13%, 31%)')
    b.screenshot('build/mri-exp-edges.png')
    # The spin echo against the gradient echo, in an 8 ms T2' magnet.
    setup(b, 'spinecho')
    se = b.eval('__app.views.kspace.echoAt(32)')
    b.eval("__app.views.kspace.typeSeg.querySelectorAll('button')[1].click()")
    ge = b.eval('__app.views.kspace.echoAt(32)'); te = b.eval('__app.views.kspace.seq.TE')
    check(near(se, 1, 1e-9) and quoted(100 * ge, '7.3') and te == 20, f'T₂′ = 8 ms: the spin echo is {100 * se:.1f}% at TE, the gradient echo (TE 20 ms) {100 * ge:.1f}% (help: 100%, 7.3%; e^(-20/8) = 8.2%)')
    b.eval('__app.views.kspace.cue(32, __app.views.kspace.seq.tEcho)'); b.eval('__app.draw()'); b.screenshot('build/mri-exp-gre-echo.png')
    # Motion: a disk dragged during the scan leaves ghosts.
    setup(b, 'motion')
    b.eval('(() => { for (let i = 0; i < 32 * 12; i++) __app.step(1 / 60, 1); })()')
    mid = b.eval('__app.views.kspace.acq.measuredCount')
    p = b.eval('__app.draw()'); sq0 = p['lay']['sq'][0]; d = b.eval('__app.views.kspace.s.disks[1]')
    px = sq0['x0'] + (d['x'] / 256 + 0.5) * sq0['s']; py = sq0['y0'] + (0.5 - d['y'] / 256) * sq0['s']
    b.drag('#v3-main', (px / box[2], py / box[3]), ((px + 50) / box[2], py / box[3]), steps=6)
    b.eval('__app.views.kspace.finish()'); st = b.eval('__app.views.kspace.imageStats()')
    moved = b.eval('__app.views.kspace.s.disks[1].x') - d['x']
    check(25 <= mid <= 40 and moved > 30 and st['rms'] > 0.08, f'dragging the fat disk {moved:.0f} mm after {mid} of 64 lines (bottom to top) leaves it twice, with ghosts: {st["rms"]:.3f} rms from the disks where they end up')
    b.screenshot('build/mri-exp-motion.png')
    setup(b, 'fill')
    worst, compared, seen = keeps_still(b, '#v3-readout > div', [lambda: b.eval('__app.step(0.35, 1)')] * 16)
    check(worst <= 0.5 and len(seen) >= 8, f'view 3: the readout keeps still while its numbers change (largest shift {worst:.1f} px, {len(seen)} readings)')

    # ------------------------------------------------------------------ 4 · Contrast and artefacts
    setup(b, 'contrast')
    hints = visible_hints(b)
    check(len(hints) == 1 and hints[0].startswith('Drag the TR line'), f'view 4: its own hint ({hints[0][:40]}...)')
    w = b.eval('__app.draw().weights')
    want = {'fat': '0.672', 'water': '0.117', 'white': '0.318', 'grey': '0.282', 'lesion': '0.237'}
    check(all(quoted(w[k], v) for k, v in want.items()), 'T₁-weighted: ' + ', '.join(f'{k} {w[k]:.3f}' for k in want))
    b.eval("__app.views.contrast.setContrast('t2')"); w = b.eval('__app.draw().weights')
    check(quoted(w['water'], '0.502') and quoted(w['lesion'], '0.472') and max(w, key=w.get) == 'water', f"T₂-weighted: CSF {w['water']:.3f}, the lesion {w['lesion']:.3f}, the brightest")
    b.eval("__app.views.contrast.setContrast('pd')"); w = b.eval('__app.draw().weights')
    check(all(quoted(w[k], v) for k, v in {'fat': '0.788', 'grey': '0.659', 'white': '0.587', 'water': '0.524'}.items()), 'proton density: ' + ', '.join(f'{k} {w[k]:.3f}' for k in w))
    b.eval('__app.views.contrast.set({ ...__app.views.contrast.s, TR: 8000, TE: 15 })'); w = b.eval('__app.draw().weights')
    check(quoted(w['water'], '0.858') and max(w, key=w.get) == 'water', f"TR 8 s: CSF {w['water']:.3f}, the brightest")
    # Drag the TR and TE lines.
    setup(b, 'contrast'); p = b.eval('__app.draw()'); box = b.box('#v4-main'); th = p['trHandle']; tg = p['teHandle']
    b.drag('#v4-main', (th['x'] / box[2], (th['y'] + 30) / box[3]), ((th['x'] + 80) / box[2], (th['y'] + 30) / box[3]), steps=6)
    b.drag('#v4-main', (tg['x'] / box[2], (tg['y'] + 30) / box[3]), ((tg['x'] + 80) / box[2], (tg['y'] + 30) / box[3]), steps=6)
    s4 = b.eval('__app.views.contrast.s')
    check(s4['TR'] > 1000 and s4['TE'] > 60, f"dragging the TR and TE lines sets them ({s4['TR']:.0f} ms, {s4['TE']:.0f} ms)")
    # Wrap.
    setup(b, 'wrap'); col = b.eval('__app.views.contrast.columnX0()'); p = b.eval('__app.draw()')
    fold = [y for y, v, t in col if v > 0.5]
    check(p['folded'] and any(69 < y < 77 for y in fold) and any(-77 < y < -69 for y in fold), f"a 180 mm field of view folds the head: fat at x = 0 shows at {', '.join(f'{y:.0f}' for y in fold)} mm")
    b.screenshot('build/mri-exp-wrap.png')
    # Fewer lines.
    setup(b, 'lines'); col = b.eval('__app.views.contrast.columnX0()'); ro = readout(b, 'contrast')
    wv = b.eval('__app.draw().weights.white')
    wm = [v / wv for y, v, t in col if abs(t - wv) < 1e-9 and abs(y) < 60]
    scalp = max(v for y, v, t in col[:20]) / b.eval('__app.draw().weights.fat')
    check(quoted(min(wm), '0.95') and quoted(max(wm), '1.06') and quoted(scalp, '0.74') and '8.00 mm along y' in ro,
          f'32 phase lines: detail 8.00 mm along y; white matter swings {min(wm):.3f} to {max(wm):.3f}; the scalp is {scalp:.2f} of its height')
    b.screenshot('build/mri-exp-lines.png')
    # Noise and averaging.
    setup(b, 'noise'); n1 = b.eval('__app.views.contrast.background()')
    b.eval('__app.views.contrast.set({ ...__app.views.contrast.s, nsa: 4 })'); n4 = b.eval('__app.views.contrast.background()')
    check(near(n1, 0.05, 0.005) and near(n4, 0.025, 0.003), f'noise 5%: the dark around the head varies by {100 * n1:.2f}% of the brightest; with 4 averages {100 * n4:.2f}%')
    # Fat.
    setup(b, 'fat'); p = b.eval('__app.draw()'); te = b.eval('__app.views.contrast.TE')
    b.eval('__app.views.contrast.set({ ...__app.views.contrast.s, Gx: 4 })'); f4 = b.eval('__app.draw().fatShift')
    b.eval('__app.views.contrast.set({ ...__app.views.contrast.s, Gx: 2, B0: 3 })'); f3 = b.eval('__app.draw().fatShift')
    b.eval('__app.views.contrast.set({ ...__app.views.contrast.s, Gx: 2, B0: 1.5 })'); f2 = b.eval('__app.draw().fatShift')
    check(quoted(-p['fatShift'], '10.2') and quoted(-f4, '1.3') and quoted(te, '31.5') and near(f3, 2 * f2, 1e-9) and quoted(3.4 * 63.87, '217'),
          f"fat moves {p['fatShift']:.2f} mm at 0.5 mT/m (TE raised to {te:.1f} ms), {f4:.2f} at 4 mT/m; at 3 T twice as far ({f3:.2f} against {f2:.2f})")
    setup(b, 'fat'); b.screenshot('build/mri-exp-fat.png')
    # Lauterbur.
    setup(b, 'lauterbur')
    hints = visible_hints(b)
    lb0 = b.eval('__app.draw().lb')
    b.eval('(() => { for (let i = 0; i < 10 * 60; i++) __app.step(1 / 60, 1); })()')
    lb1 = b.eval('__app.draw().lb'); playing = b.eval('__app.views.contrast.s.playing')
    check(lb0['j'] == 0 and lb1['j'] == 4 and not playing and hints[0].startswith('Watch the gradient turn'), f'Lauterbur: four angles, measured one by one ({lb0["j"]} -> {lb1["j"]}), with a hint of its own')
    b.screenshot('build/mri-exp-lauterbur.png')
    b.eval("__app.views.contrast.set({ ...__app.views.contrast.s, nA: 60, angles: 60, playing: false })"); b.eval('__app.draw()')
    b.screenshot('build/mri-exp-lauterbur-60.png')
    setup(b, 'noise')
    steps = [lambda v=v: b.eval(f'__app.views.contrast.set({{ ...__app.views.contrast.s, sigma: {v}, nsa: {n} }})') for v, n in ((0.012, 1), (0.083, 3), (0.12, 7), (0.031, 16), (0.19, 2))]
    worst, compared, seen = keeps_still(b, '#v4-readout > div', steps)
    check(worst <= 0.5 and len(seen) >= 4, f'view 4: the readout keeps still while its numbers change (largest shift {worst:.1f} px, {len(seen)} readings)')

    # ------------------------------------------------------------------ every set-up, once
    bad = []
    for name in SETUPS:
        setup(b, name)
        b.eval('__app.step(0.25, 2)')
        txt = b.eval("[...document.querySelectorAll('.readout')].filter((e) => e.getClientRects().length).map((e) => e.textContent).join(' ')")
        if 'NaN' in txt or 'undefined' in txt or 'Infinity' in txt: bad.append(f'{name}: {txt[:100]}')
        b.screenshot(f'build/mri-exp-{name}-start.png')
    check(not bad, 'every experiment\'s readout is made of numbers' + ('' if not bad else ': ' + ' | '.join(bad)))
    # A Set it up button in the drawer works.
    b.eval("document.querySelector('#help-button').click()")
    b.eval("[...document.querySelectorAll('#help .exp')].find((a) => a.dataset.setup === 'wrap').querySelector('.setup').click()")
    check(b.eval('__app.view') == 'contrast' and b.eval('__app.views.contrast.s.fov') == 180, "the drawer's Set it up button for experiment 16 opens view 4 with a 180 mm field of view")
    b.key('Escape')

    # ------------------------------------------------------------------ the address
    setup(b, 'axis')
    b.eval("__app.views.axis.set({ G: 3.25, pieces: [{ x: -9, w: 7, rho: 0.6 }, { x: 14, w: 4, rho: 1 }] })")
    b.wait("location.hash.includes('G=3.25') && location.hash.includes('pc=')", timeout=10)
    reload(b)
    s = b.eval('__app.views.axis.s')
    check(b.eval('__app.view') == 'axis' and s['G'] == 3.25 and len(s['pieces']) == 2 and s['pieces'][0]['rho'] == 0.6, f'view 1 comes back from its address (G = {s["G"]}, {len(s["pieces"])} tubes)')
    for name, view, key in (('rephase', 'slice', 'rp=0'), ('spinecho', 'kspace', 't2p=8'), ('fat', 'contrast', 'fat=1')):
        setup(b, name)
        b.wait(f"location.hash.includes('v={view}') && location.hash.includes({json.dumps(key)})", timeout=10)
        h = b.eval('location.hash')
        reload(b)
        check(b.eval('__app.view') == view and key in b.eval('location.hash'), f'{name}: view {view} comes back from its address ({h[:60]}...)')
    b.eval("location.hash = '#setup=lines'"); b.wait("__app.view === 'contrast' && __app.views.contrast.s.lines === 32", timeout=20)
    check(True, 'typing #setup=lines into the address opens that experiment')

    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

# ---------------------------------------------------------------------- dark, and a phone
with Browser('mri/index.html', size=(1400, 900)) as b:
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
    b.wait('window.__app && __app.ready', timeout=90); b.eval('__app.hold(true)')
    check(b.eval("getComputedStyle(document.body).backgroundColor") != 'rgb(244, 243, 239)', 'dark: the page follows the dark colour scheme')
    for name in ('axis', 'slice', 'fill', 'contrast'):
        setup(b, name); b.eval('__app.step(0.5, 4)'); b.screenshot(f'build/mri-dark-{name}.png')
    b.eval("document.querySelector('#help').classList.add('open')")
    c = b.eval(f"[{CONTRAST}('.drawer .start p', '.drawer .start'), {CONTRAST}('.drawer .start h3', '.drawer .start'), {CONTRAST}('#v4-hint', 'body'), {CONTRAST}('#v4-hint', 'body', '::before')]")
    check(all(v >= 4 for v in c), f'dark: the Start-here block and the hint (with its arrow) read (contrast {c})')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'dark: no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

with Browser('mri/index.html', size=(390, 844)) as b:
    b.wait('window.__app && __app.ready', timeout=90); b.eval('__app.hold(true)')
    b.screenshot('build/mri-phone-start.png')
    wide, firsts = [], []
    for name, view in (('axis', 'axis'), ('slice', 'slice'), ('fill', 'kspace'), ('contrast', 'contrast'), ('lauterbur', 'contrast')):
        setup(b, name); b.eval('__app.step(0.3, 3)'); b.eval('window.scrollTo(0, 0)')
        hint = b.eval("(() => { const h = [...document.querySelectorAll('.hint')].find((e) => e.getClientRects().length); const r = h.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; })()")
        cv = b.box(VIEWS[view])
        firsts.append((name, hint, round(cv[1])))
        wide.append(b.eval('document.documentElement.scrollWidth'))
        b.screenshot(f'build/mri-phone-{name}.png')
    check(all(h[1] <= 844 and h[0] < cv for _, h, cv in firsts), 'on a phone each view\'s hint is on the first screen, above its picture (' + ', '.join(f'{n}: {h[1]} px' for n, h, _ in firsts) + ')')
    check(max(wide) <= 390, f'no sideways scrolling on a phone (pages {max(wide)} px wide at most)')
    for theme in ('light', 'dark'):
        b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': theme}])
        b.eval("document.querySelector('#help').classList.add('open'); document.querySelector('#help').scrollTop = 0")
        b.screenshot(f'build/mri-phone-drawer-{theme}.png')
        c = b.eval(f"[{CONTRAST}('.drawer .start p', '.drawer .start'), {CONTRAST}('.drawer .start h3', '.drawer .start')]")
        check(all(v >= 4 for v in c), f'{theme} theme on a phone: the Start-here block reads (contrast {c})')
    errors = [x for x in b.console if x.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'phone: no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
