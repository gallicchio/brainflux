#!/usr/bin/env python3
"""Drive the least-action demo like a student: every set-up starts on its true path; a drag moves a
knot one way only (Shift: both), and only a knot within reach; the score and the record of S, which
hold still; the wrong paths; rolling downhill onto a minimum and away from a saddle; closed orbits;
Feynman's arrows; every number the experiments quote; a phone, by touch.  It waits on the page's
own idle flag, never on the clock."""
import json, math, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

P = '#path'
# The largest distance (in q) a free knot would move on its own to make S stationary: zero on a true path.
NEWTON = '''(() => { const a = __app, d = a.downhill(a.path(), false); let w = 0;
  for (const k of d.free) if (d.cq[k] > 0) w = Math.max(w, Math.abs(d.gq[k]) / d.cq[k]);
  return w / (a.state.sys.qrange[1] - a.state.sys.qrange[0]); })()'''
SCORE = '''(() => { const a = __app, c = a.current, t = a.ref;
  return { S: c.S, K: c.kinetic, St: t && t.S, note: document.querySelector('#score .note').textContent, on: a.state.onTrue }; })()'''
# The contrast ratio (WCAG) of an element's text against the first opaque background behind it:
# the hint and the Start-here block must read in both themes.
CONTRAST = '''((sel) => { const e = document.querySelector(sel); if (!e) return null;
  const lum = (c) => { const m = c.match(/\\d+(\\.\\d+)?/g).map(Number);
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  let bg = null;
  for (let p = e; p && !bg; p = p.parentElement) { const c = getComputedStyle(p).backgroundColor; if (c && c !== 'transparent' && !/^rgba\\(.*, 0\\)$/.test(c)) bg = c; }
  const a = lum(getComputedStyle(e).color), b = lum(bg || 'rgb(255, 255, 255)');
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); })'''


def first_screen(b, where):
    """The hint under the path plot and the Start-here block exist and read (contrast >= 3)."""
    hint = b.eval("document.querySelector('#path-hint').textContent")
    ch, cs = b.eval(CONTRAST + '("#path-hint")'), b.eval(CONTRAST + '("#help .start p")')
    check(hint.startswith('Drag a knot ○ up or down') and ch >= 3 and cs >= 3,
          f"{where}: the hint under the path plot ('{hint}') and the Start here block read (contrast {ch:.1f}, {cs:.1f})")


def settle(b):
    b.wait('__app.idle', timeout=120)
    b.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))')


def run(b, js):
    r = b.eval(js)
    settle(b)
    return r


def near(a, b_, tol):
    return a is not None and b_ is not None and abs(a - b_) <= tol


def knot_px(b, k):
    x, y, w, h = b.box(P)
    px, py = b.eval(f'__app.toPx(__app.state.times[{k}], __app.state.knots[{k}])')
    return x + px, y + py


def drag(b, x0, y0, path, modifiers=0, release=True):
    """Press at (x0, y0), move through the offsets in path, release at the last."""
    b.mouse('mouseMoved', x0, y0)
    b.call('Input.dispatchMouseEvent', type='mousePressed', x=x0, y=y0, buttons=1, button='left', clickCount=1, modifiers=modifiers)
    for dx, dy in path:
        b.call('Input.dispatchMouseEvent', type='mouseMoved', x=x0 + dx, y=y0 + dy, buttons=1, button='left', modifiers=modifiers)
        b.eval('new Promise((r) => requestAnimationFrame(r))')
    if release:
        dx, dy = path[-1]
        b.call('Input.dispatchMouseEvent', type='mouseReleased', x=x0 + dx, y=y0 + dy, buttons=0, button='left', clickCount=1, modifiers=modifiers)
        settle(b)


def drag_knot(b, k, dx, dy, steps=10, modifiers=0, wobble=0, release=True):
    """Drag knot k by (dx, dy), wobbling sideways on the way; returns where the pointer ends."""
    x0, y0 = knot_px(b, k)
    path = [(dx * i / steps + (wobble if i % 2 else -wobble), dy * i / steps) for i in range(1, steps + 1)]
    path[-1] = (dx, dy)
    drag(b, x0, y0, path, modifiers, release)
    return x0 + dx, y0 + dy


def release(b, x, y):
    b.call('Input.dispatchMouseEvent', type='mouseReleased', x=x, y=y, buttons=0, button='left', clickCount=1)
    settle(b)


def errors(b):
    return [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]


with Browser('action/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready'); settle(b)
    b.screenshot('build/act-start.png')
    s = b.eval(SCORE)
    check(s['on'] and near(s['S'], -100 * 8 / 24, 1e-9) and near(s['K'], 100 * 8 / 24, 1e-6) and s['note'] == 'on the true path',
          f"opens on the throw's true path: S = {s['S']:.6f} = -mg^2T^3/24, kinetic part {s['K']:.4f}, '{s['note']}'")
    check(b.eval('__app.history.length') == 1, 'the record starts with one point')

    # ---- the first screen: a hint under the picture, words beside the numbers, glosses, and a
    # drawer that starts with "Start here" and ends with the theory
    first_screen(b, 'light theme')
    heads = b.eval("[...document.querySelectorAll('#score .h')].map((e) => e.textContent)")
    check(any('kinetic part' in h for h in heads) and any('potential part' in h for h in heads), f"the score table's headings carry words: {heads}")
    panels = b.eval("[...document.querySelectorAll('.controls .panel .label')].map((e) => e.textContent)")
    check(panels[0] == 'Your path', f"the path's own controls come first in the side panel ({panels})")
    note, tabs = b.eval("document.querySelector('#roll-note').textContent"), b.eval("[...document.querySelectorAll('#view-tabs button')].map((e) => e.textContent)")
    check('less action' in note and any('quantum' in t for t in tabs), f"Roll downhill has a gloss ('{note}') and Feynman's tab says it is the quantum view ({tabs[-1]})")
    first = b.eval("document.querySelector('#help header + *').className")
    h3 = b.eval("[...document.querySelectorAll('#help h3')].map((e) => e.textContent)")
    check(first == 'start' and h3[0] == 'Start here' and not b.eval("document.querySelector('#help .start math')"), 'the drawer opens with a Start here block, without equations')
    check(h3[1].startswith('1. Throw and catch') and h3[-1] == 'How it works' and b.eval("!!document.querySelector('#help .theory math[display=block]')"),
          f'experiment 1 is the opening set-up and the equations come last ({h3[1]!r} ... {h3[-1]!r})')

    # Every set-up starts on its true path (no knot would move on its own), with the action the
    # experiment quotes; and the hint under the plot names what to drag there.
    quoted = {'find': 4, 'throw': -33.333, 'energy': -33.333, 'phase': -0.8359, 'orbit': 6.689, 'saddle': 1.2005,
              'pendulum': -1.924, 'twin': -10, 'light': 13.955, 'mirage': 9.893, 'brach': 3.1416, 'segments': -33.333,
              'feynman': -33.333, 'damped': -1.2748, 'typed': 1.368, 'hints': -33.333}
    hints = {}
    for name in b.eval('Object.keys(__app.setups)'):
        run(b, f'__app.setups[{json.dumps(name)}]()')
        n, on, w, St = b.eval('__app.truths.length'), b.eval('__app.state.onTrue'), b.eval(NEWTON), b.eval('__app.ref.S')
        hints[name] = b.eval("document.querySelector('#path-hint').textContent")
        b.screenshot(f'build/act-exp-{name}.png')
        q = quoted.get(name)
        digits = 10 ** -(len(str(q).split('.')[1]) if '.' in str(q) else 0) / 2 if q is not None else 0
        ok_q = q is None or abs(St - q) <= digits + 1e-9
        if name == 'hints':
            check(not on and w > 1e-3 and ok_q, f'{name}: starts bent, for the arrows (Newton step {w:.2g} of the range); true S {St:.4f}')
        else:
            check(n >= 1 and on and w < 1e-6 and ok_q, f'{name}: {n} true path(s), S_true = {St:.5f} (the help: {q}); starts on it (Newton step {w:.1e})')
    check(hints['throw'].endswith('watch S go up') and 'event' in hints['twin'] and 'optical path' in hints['light'] and 'time' in hints['brach']
          and 'saddle' in hints['saddle'] and 'orbit' in hints['orbit'] and 'saddle' in hints['damped'],
          f"the hint names the knot and what to watch for each system: {hints['twin']!r}, {hints['light']!r}, {hints['saddle']!r}")

    # ---- dragging: one way only, chosen by the start of the drag
    run(b, '__app.setups.throw()')
    t2, q2, S0, h0 = b.eval('__app.state.times[2]'), b.eval('__app.state.knots[2]'), b.eval('__app.current.S'), b.eval('__app.history.length')
    xe, ye = drag_knot(b, 2, 0, -100, steps=20, wobble=4, release=False)
    b.screenshot('build/act-drag-up.png')
    r_mid = b.eval('__app.ranges.record')
    release(b, xe, ye)
    t2b, q2b, S1, h1 = b.eval('__app.state.times[2]'), b.eval('__app.state.knots[2]'), b.eval('__app.current.S'), b.eval('__app.history.length')
    check(t2b == t2 and q2b > q2 + 2, f'a drag up with a 4-pixel wobble moves the knot up ({q2:.3f} -> {q2b:.3f}) and not in time (t stays {t2b})')
    check(S1 > S0 + 5 and h1 > h0 + 15, f'... raises S ({S0:.3f} -> {S1:.3f}) and every frame of it is in the record ({h0} -> {h1} points)')
    check(r_mid['hi'] > S1 and r_mid['lo'] < S0 + 1e-9, f"the record's range held the whole drag ({r_mid['lo']:.2f} to {r_mid['hi']:.2f})")
    run(b, '__app.backToTrue()')
    s = b.eval(SCORE)
    check(near(s['S'], S0, 1e-9) and s['on'], f'Back to the true path returns to S = {s["S"]:.4f}')
    tags = b.eval('__app.history.map((h) => h.tag).filter(Boolean)')
    check('true' in tags, f'... with a tagged point in the record ({tags})')

    t1, q1 = b.eval('__app.state.times[1]'), b.eval('__app.state.knots[1]')
    drag_knot(b, 1, 60, 0, wobble=3)
    t1b, q1b, S2 = b.eval('__app.state.times[1]'), b.eval('__app.state.knots[1]'), b.eval('__app.current.S')
    check(t1b > t1 + 0.1 and q1b == q1, f'a sideways drag moves the knot in time ({t1:.3f} -> {t1b:.3f}) and not in place')
    check(S2 > S0 + 1, f'... and costs action ({S0:.3f} -> {S2:.3f})')
    drag_knot(b, 1, 900, 0)
    ts = b.eval('Array.from(__app.state.times)')
    check(all(ts[i + 1] - ts[i] > 0.19 * (ts[-1] - ts[0]) / (len(ts) - 1) for i in range(len(ts) - 1)) and ts[0] == 0 and ts[-1] == 2,
          f'dragged far past its neighbour, a knot stops short of it; the ends keep their times ({[round(t, 3) for t in ts]})')
    run(b, '__app.backToTrue()')
    # Shift: both ways.
    t2, q2 = b.eval('__app.state.times[2]'), b.eval('__app.state.knots[2]')
    drag_knot(b, 2, 30, -60, modifiers=8)
    check(b.eval('__app.state.times[2]') > t2 + 0.05 and b.eval('__app.state.knots[2]') > q2 + 1, 'with Shift a knot moves both ways at once')
    run(b, '__app.backToTrue()')
    # Away from every knot, a press does nothing.
    before = b.eval('[Array.from(__app.state.knots), Array.from(__app.state.times)]')
    x, y, w, h = b.box(P)
    drag(b, x + 0.3 * w, y + 0.8 * h, [(0, -40), (20, -80)])
    check(b.eval('[Array.from(__app.state.knots), Array.from(__app.state.times)]') == before, 'a press away from the knots moves none of them')
    # An end point moves in place only, the true path follows, and the plot holds still meanwhile.
    f0 = b.eval('[__app.frame.y0, __app.frame.y1]')
    xe, ye = drag_knot(b, 4, -60, -120, release=False)
    b.wait('!__app.truthPending', timeout=60)           # the true path follows while the end is held
    b.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))')
    f1 = b.eval('[__app.frame.y0, __app.frame.y1]')
    release(b, xe, ye)
    q4, t4 = b.eval('__app.state.knots[4]'), b.eval('__app.state.times[4]')
    check(t4 == 2 and q4 > 2 and f1 == f0, f'an end point moves up only ({q4:.3f} at t = {t4}), and the plot keeps its range while it moves')
    S_end = b.eval('__app.ref.S'); q1v = b.eval('__app.state.q1')
    exact = -10 * q1v * 2 / 2 + q1v ** 2 / 4 - 100 * 8 / 24
    check(near(S_end, exact, 1e-6), f'... and the true path follows: S_true = {S_end:.5f}, the formula {exact:.5f}')

    # The velocity under the pointer.
    run(b, '__app.setups.throw()')
    x, y, w, h = b.box(P)
    b.mouse('mouseMoved', x + 0.3 * w, y + 0.5 * h); settle(b)
    hov = b.eval('__app.hover')
    check(hov is not None and 0.4 < hov['s'] < 0.8 and hov['knot'] == -1, f'pointing at the plot picks the time under the pointer ({hov})')
    b.screenshot('build/act-velocity.png')
    kx, ky = knot_px(b, 1)
    b.mouse('mouseMoved', kx + 3, ky - 2); settle(b)
    check(b.eval('__app.hover.knot') == 1 and b.eval("document.querySelector('#path').classList.contains('over')"), 'over a knot, the knot lights and the cursor says it can be grabbed')
    b.mouse('mouseMoved', x - 20, y - 20); settle(b)

    # Keyboard: [ ] choose a knot, arrows move it, R goes back.
    b.eval('document.querySelector("#path").focus()')
    sel = b.eval('__app.state.sel')
    b.key(']'); settle(b)
    check(b.eval('__app.state.sel') == sel + 1, f'] chooses the next knot ({sel} -> {sel + 1})')
    k = sel + 1
    t, q = b.eval(f'__app.state.times[{k}]'), b.eval(f'__app.state.knots[{k}]')
    b.key('ArrowRight'); b.key('ArrowRight'); b.key('ArrowUp'); b.key('ArrowUp'); settle(b)
    t2, q2 = b.eval(f'__app.state.times[{k}]'), b.eval(f'__app.state.knots[{k}]')
    check(t2 > t and q2 > q, f'the arrow keys move the knot later ({t:.3f} -> {t2:.3f}) and up ({q:.3f} -> {q2:.3f})')
    b.key('r'); settle(b)
    check(b.eval('__app.state.onTrue') and near(b.eval('__app.current.S'), -33.3333333, 1e-6), 'R puts the path back on the true path')

    # ---- the wrong paths, with the numbers experiments 1 and 2 quote
    def score_after(setup, js):
        run(b, f'__app.setups.{setup}()')
        h0 = b.eval('__app.history.length')
        run(b, js)
        s = b.eval(SCORE)
        s['points'] = b.eval('__app.history.length') - h0
        return s
    up, down = score_after('throw', '__app.bend(1)'), score_after('throw', '__app.bend(-1)')
    check(near(up['S'], -30.77, 0.005) and near(down['S'], -30.77, 0.005) and abs(up['S'] - down['S']) < 1e-9,
          f"Bend up and Bend down cost the same: S = {up['S']:.4f}, {down['S']:.4f} (the help: -30.77)")
    check(near(up['K'], 54.27, 0.005) and near(up['S'] - up['K'], -85.04, 0.005) and near(down['K'], 17.52, 0.005) and near(down['S'] - down['K'], -48.29, 0.005),
          f"... the parts: up {up['K']:.2f}, {up['S'] - up['K']:.2f}; down {down['K']:.2f}, {down['S'] - down['K']:.2f} (the help: 54.27, -85.04; 17.52, -48.29)")
    check(up['points'] >= 12, f"a button's change is shown as it happens: {up['points']} points in the record")
    st = score_after('throw', '__app.straight()')
    ru = score_after('throw', '__app.rush()')
    check(near(st['S'], 0, 1e-9) and near(ru['S'], -28.82, 0.005), f"Straight line: S = {st['S']:.4f}; Rush, then dawdle: {ru['S']:.4f} (the help: 0, -28.82)")
    free = [score_after('find', js)['S'] for js in ('__app.move(2, 1, 3)', '__app.move(2, 1.3, 2)', '__app.rush()', '__app.move(2, 1.25, 2.5)')]
    check(near(free[0], 8.13, 0.005) and near(free[1], 8.08, 0.005) and near(free[2], 4.32, 0.005) and near(free[3], 4, 1e-9),
          f'free particle: middle knot to x = 3 {free[0]:.3f}, to t = 1.3 {free[1]:.3f}, rush {free[2]:.3f}, along the line {free[3]:.4f} (the help: 8.13, 8.08, 4.32, 4.000)')
    # The closed form beside what the shooting found, where there is one.
    forms = {}
    for name in ('find', 'throw', 'phase', 'saddle', 'twin'):
        run(b, f'__app.setups.{name}()')
        txt = b.eval("document.querySelector('#truth').textContent")
        forms[name] = (txt.split('(')[0].replace('S =', '').strip(), txt.split('gives ')[-1].rstrip('.') if 'The formula' in txt else None)
    check(all(f[1] is not None and f[0] == f[1] for f in forms.values()), f'the true path found by shooting has the closed form\'s action, to 5 figures: {forms}')

    # ---- rolling downhill
    run(b, '__app.setups.hints()')
    b.eval('document.querySelector("#roll").click()'); settle(b)
    s = b.eval(SCORE)
    check(near(s['S'], -100 * 8 / 24, 1e-4), f"Roll downhill from the bent path ends on the true path (S {s['S']:.5f})")
    run(b, '__app.setups.hints()')
    steps = b.eval('__app.rollToEnd()')
    check(steps == 253, f'... in {steps} steps (the help: 253)')
    run(b, '__app.setups.find()')
    run(b, '__app.move(1, 0.15, 0.5)'); run(b, '__app.move(2, 0.6, 3.5)'); run(b, '__app.move(3, 1.1, 2)')
    ts0 = b.eval('Array.from(__app.state.times)')
    b.eval('__app.rollToEnd()'); settle(b)
    S, ts = b.eval('__app.current.S'), b.eval('Array.from(__app.state.times)')
    check(abs(S - 4) < 1e-6 and ts == ts0, f'from knots bunched in time it reaches the straight line too (S {S:.6f}), the knots keeping their times')

    # ---- a saddle: one knot raises S, bending lowers it, rolling runs away
    run(b, '__app.setups.saddle()')
    S0, St, idx = b.eval('__app.current.S'), b.eval('__app.ref.S'), b.eval('__app.ref.index')
    run(b, '__app.move(2, __app.state.times[2], __app.state.knots[2] + 0.5)')
    S1 = b.eval('__app.current.S')
    run(b, '__app.backToTrue()'); run(b, '__app.bend(1)')
    S2 = b.eval('__app.current.S')
    note = b.eval(SCORE)['note']
    check(idx == 1 and near(S1, 1.659, 0.0005) and near(S2, 1.002, 0.0005), f'at the saddle (index {idx}) one knot up 0.5 raises S ({S0:.4f} -> {S1:.4f}) but Bend lowers it ({S2:.4f} < {St:.4f}) (the help: 1.659, 1.002)')
    check('saddle' in note, f"... and the score says so ('{note}')")
    b.screenshot('build/act-saddle.png')
    b.eval('__app.rollToEnd()'); settle(b)
    S3 = b.eval('__app.current.S')
    check(near(S3, -9.47, 0.005), f'rolling downhill from there runs away to the edge of the plot (S {S3:.4f}; the help: -9.47)')
    b.screenshot('build/act-saddle-rolled.png')
    run(b, '__app.setups.saddle()')
    b.eval('''(() => { const box = [...document.querySelectorAll('#params .slider')].pop().querySelector('input[type=number]'); box.value = 3; box.dispatchEvent(new Event('change')); })()''')
    settle(b)
    S4 = b.eval('__app.current.S'); run(b, '__app.bend(1)'); S5 = b.eval('__app.current.S')
    check(b.eval('__app.ref.index') == 0 and near(S4, -7.923, 0.0005) and near(S5, -7.885, 0.0005), f'at T = 3 the true path is a minimum again: bending raises S ({S4:.4f} -> {S5:.4f})')

    # ---- the score and the record hold still while the numbers change, gain digits and change sign
    sel = '#score .num, #score .h, #score .rl, #score .verdict .line'
    for name, steps_ in (('saddle', ['__app.bend(1)', '__app.bend(1)', '__app.bend(1)', '__app.bend(1)', '__app.rollToEnd()', '__app.backToTrue()']),
                         ('throw', ['__app.move(2, 1, 9)', '__app.move(2, 1, -3)', '__app.straight()', '__app.move(1, 0.8, 5)', '__app.backToTrue()'])):
        run(b, f'__app.setups.{name}()')
        vals = [b.eval('__app.current.S')]
        def step(js):
            run(b, js)
            vals.append(b.eval('__app.current.S'))
        moves, texts = b.steady(sel, [lambda js=js: step(js) for js in steps_])
        signs = 'both signs' if min(vals) < 0 < max(vals) else 'one sign'
        check(not moves and len(texts) >= 4, f'{name}: the score keeps every label and number in place as S runs through {[round(v, 3) for v in vals]} ({signs})' + (f'; moved: {moves[:3]}' if moves else ''))

    # ---- energy and straight segments (experiments 4 and 12)
    SEG = '''(() => { const p = __app.path(), s = p.s, q = p.q, E = [];
      for (let i = 0; i + 1 < q.length; i++) { const v = (q[i+1]-q[i])/(s[i+1]-s[i]); E.push(0.5*v*v + 10*(q[i]+q[i+1])/2); } return E; })()'''
    run(b, '__app.setups.energy()')
    run(b, "[...document.querySelectorAll('#mode-box button')].find((x) => x.textContent === 'Straight segments').click()")
    E, Ev = b.eval(SEG), b.eval('__app.segmentEnergies()')
    check(all(near(e, 48.0, 1e-6) for e in E) and all(near(e, 48.0, 1e-6) for e in Ev), f'6 knots, straight segments: every segment has E = 48.0 ({[round(e, 4) for e in E]}), as the Energy view draws them ({[round(e, 4) for e in Ev]})')
    run(b, '__app.move(1, 0.55, __app.state.knots[1])')
    E, g = b.eval(SEG), b.eval('Array.from(__app.downhill(__app.path()).gs)')
    check(near(g[1], E[1] - E[0], 1e-4 * (1 + abs(g[1]))) and abs(g[1]) > 1, f'... a knot moved in time: dS/dt = {g[1]:.4f} = E_after - E_before = {E[1] - E[0]:.4f}')
    run(b, '__app.setups.segments()')
    Ss = [b.eval('__app.current.S')]
    for nk in (5, 9, 16):
        b.eval(f'''(() => {{ const box = document.querySelector('#knot-box input[type=number]'); box.value = {nk}; box.dispatchEvent(new Event('change')); }})()'''); settle(b)
        Ss.append(b.eval('__app.current.S'))
    want = [-100 * 8 / 24 + 100 * 2 * (2 / (n - 1)) ** 2 / 24 for n in (4, 5, 9, 16)]
    check(all(near(a, c, 1e-6) for a, c in zip(Ss, want)), f'straight segments: S = {[round(x, 3) for x in Ss]} = S_true + g^2 T h^2/24 (the help: -29.630, -31.250, -32.813, -33.185)')

    # ---- a closed orbit
    run(b, '__app.setups.orbit()')
    ends = b.eval('(() => { const p = __app.path(), s = p.sample([p.s0, p.s1]); return [s.q[0], s.q[1], s.v[0], s.v[1]]; })()')
    t0 = b.eval('(() => { const t = __app.ref; return [t.q[0], t.q[t.q.length - 1], t.v[0], t.v[t.v.length - 1], !!t.closed, t.v[0]**2/2 - Math.cos(t.q[0]), t.swing[1]]; })()')
    check(abs(ends[0] - ends[1]) < 1e-12 and abs(ends[2] - ends[3]) < 1e-9, f'periodic: the drawn path ends where it starts, with the same velocity ({ends[2]:.6f}, {ends[3]:.6f})')
    check(t0[4] and abs(t0[0] - t0[1]) < 1e-4 and abs(t0[2] - t0[3]) < 1e-3 and near(t0[5], 0.288, 0.0005) and near(t0[6], 1.86, 0.005),
          f'periodic: the true orbit closes in phase space, E = {t0[5]:.4f}, amplitude {t0[6]:.4f} (the help: 0.288, 1.86)')
    S0, St = b.eval('__app.current.S'), b.eval('__app.ref.S')
    check(abs(S0 - St) < 1e-3 and near(St, 6.689, 0.0005), f'periodic: the path starts on the orbit (S {S0:.5f}, orbit {St:.5f})')
    drag_knot(b, 0, 0, 40)
    q0, qn = b.eval('__app.state.knots[0]'), b.eval('__app.state.knots[__app.state.knots.length - 1]')
    check(q0 == qn and q0 < -0.3, f'periodic: dragging the start point drags the end with it ({q0:.3f}, {qn:.3f})')
    run(b, '__app.backToTrue()')
    S1, St1 = b.eval('__app.current.S'), b.eval('__app.ref.S')
    check(abs(St1 - St) < 1e-3 * abs(St) and abs(S1 - St1) < 1e-3, f'... and the orbit through the new start point has the same action ({St1:.5f})')
    b.screenshot('build/act-orbit.png')
    run(b, '__app.setups.orbit()'); run(b, '__app.bend(1)')
    check(near(b.eval('__app.current.S'), 8.358, 0.0005), f"Bend up raises the orbit's S to {b.eval('__app.current.S'):.4f} (the help: 8.358)")
    run(b, '__app.setups.orbit()'); run(b, '__app.move(0, 0, 0.05)')
    b.eval('__app.rollToEnd()'); settle(b)
    S, ks = b.eval('__app.current.S'), b.eval('Array.from(__app.state.knots)')
    check(near(S, -8, 1e-6) and all(abs(abs(x) - math.pi) < 1e-4 for x in ks), f'nudged and rolled, the loop climbs to the top: S = {S:.6f} = -T, every knot at {ks[3]:.5f}')
    # The oscillator's closed orbits all take 2π/ω and have S = 0: bending keeps it so.
    run(b, '__app.setups.phase()')
    run(b, "[...document.querySelectorAll('#mode-box button')].find((x) => x.textContent === 'Periodic').click()")
    T, S0 = b.eval('__app.state.s1 - __app.state.s0'), b.eval('__app.current.S')
    run(b, '__app.bend(1)')
    S1 = b.eval('__app.current.S')
    check(abs(T - 2 * math.pi) < 1e-9 and abs(S0) < 5e-5 and abs(S1) < 5e-5, f'oscillator, periodic: T = 2π ({T:.6f}), S = {S0:.6f}, bent {S1:.6f}: a family of orbits')
    b.screenshot('build/act-oscillator-orbit.png')

    # ---- several true paths
    run(b, '__app.setups.pendulum()')
    tp = b.eval('__app.truths.map((t) => [t.S, t.index])')
    want = [(-1.924, 0), (1.899, 0), (5.115, 1), (8.051, 1), (8.057, 2)]
    check(len(tp) == 5 and all(near(a[0], w[0], 0.0005) and a[1] == w[1] for a, w in zip(tp, want)), f'pendulum: five true paths, {[(round(a, 4), i) for a, i in tp]} (the help: {want})')
    run(b, "document.querySelectorAll('#truth button.path')[2].click()")
    S, St = b.eval('__app.current.S'), b.eval('__app.truths[2].S')
    check(abs(S - St) < 0.002 and b.eval('__app.ref === __app.truths[2]') and b.eval('__app.state.onTrue'), f'clicking a true path in the list puts the path on it (S {S:.4f}, true {St:.4f})')
    run(b, '__app.bend(1)')
    check(near(b.eval('__app.current.S'), 5.081, 0.0005), f"... and on that saddle Bend up lowers S, to {b.eval('__app.current.S'):.4f} (the help: 5.081)")

    # ---- the twin paradox, light, the brachistochrone
    run(b, '__app.setups.twin()'); run(b, '__app.move(2, 5, 1.5)')
    tau = b.eval('-__app.current.S'); s = b.eval(SCORE)
    check(near(tau, 9, 1e-9) and 'less proper time' in s['note'], f"twin: the middle event at x = 1.5 gives tau = {tau:.6f} (the help: 9); '{s['note']}'")
    run(b, '__app.move(2, 5, 2.6)')
    check(b.eval('__app.current.S') is None and 'faster than light' in b.eval(SCORE)['note'], 'twin: past x = 2.5 the legs are faster than light, and have no action')
    run(b, '__app.setups.light()')
    ang = b.eval('''(() => { const t = __app.ref, a = (v) => Math.atan(1 / Math.abs(v)); return [a(t.v[0]), a(t.v[t.v.length - 1])]; })()''')
    check(near(math.degrees(ang[0]), 69.0, 0.05) and near(math.degrees(ang[1]), 38.5, 0.05) and near(math.sin(ang[0]), 1.5 * math.sin(ang[1]), 1e-4),
          f'refraction: theta1 = {math.degrees(ang[0]):.2f}°, theta2 = {math.degrees(ang[1]):.2f}°: n1 sin = {math.sin(ang[0]):.5f}, n2 sin = {1.5 * math.sin(ang[1]):.5f}')
    run(b, '__app.straight()')
    check(near(b.eval('__app.current.S'), 14.577, 0.0005), f"refraction: the straight line's optical path {b.eval('__app.current.S'):.4f} (the help: 14.577)")
    run(b, '__app.setups.mirage()')
    check(near(b.eval('Math.min(...__app.ref.q)'), -0.65, 0.005), f"mirage: the ray dips to {b.eval('Math.min(...__app.ref.q)'):.4f} (the help: -0.65)")
    run(b, '__app.setups.brach()')
    b.drag(P, (0.01, 0.2), (0.3, 0.5), steps=5); settle(b)
    check(abs(b.eval('__app.state.knots[0]')) < 1e-12 and b.eval('__app.state.times[0]') == 0, 'the brachistochrone starts at rest at the top, whatever you drag')
    run(b, '__app.setups.brach()')
    Sb = b.eval('__app.current.S'); run(b, '__app.straight()'); Sl = b.eval('__app.current.S')
    check(near(Sb, 3.156, 0.0005) and near(Sl, math.sqrt(2 * (math.pi ** 2 + 4) / 2), 1e-3), f'brachistochrone: 8 knots draw the cycloid to {Sb:.4f}; the straight incline {Sl:.4f} = sqrt(2 D^2 / g Y)')

    # ---- Feynman's arrows
    run(b, '__app.setups.feynman()')
    S2 = b.eval('__app.downhill(__app.path(), false).cq[2]')
    widths = []
    for hb in (1, 0.1, 0.01):
        run(b, f'__app.state.hbar = {hb}; __app.setView("phasor")')
        z, hs = b.eval('__app.phasor.zone'), b.eval('__app.phasor.hStar')
        widths.append((z[1] - z[0]) / 2)
        check(near(hs, 5, 1e-6) and near(widths[-1], math.sqrt(math.pi * hb / S2), 0.004 * hb ** 0.5 + 0.002),
              f'phasors at hbar = {hb}: the arrows add up within {widths[-1]:.4f} of h* = {hs:.4f}; sqrt(pi hbar / S\'\') = {math.sqrt(math.pi * hb / S2):.4f}')
    check(near(S2, 8.27, 0.005) and [round(w, 2) for w in widths] == [0.62, 0.2, 0.06], f"... S'' = {S2:.4f}; the help quotes 8.27 and 0.62, 0.20, 0.06")
    run(b, '__app.state.hbar = 1; __app.setView("phasor")')
    b.screenshot('build/act-phasors.png')
    run(b, '__app.move(2, 1, 7)')
    z, q2 = b.eval('__app.phasor.zone'), b.eval('__app.state.knots[2]')
    check(z[0] < 5 < z[1] and q2 > z[1], f'a knot dragged away leaves the zone where the arrows add up ({q2:.2f} outside {z[0]:.2f} to {z[1]:.2f})')
    b.screenshot('build/act-phasors-off.png')

    # ---- typed Lagrangians and potentials
    run(b, '__app.setups.damped()')
    check(b.eval('__app.ref.index') == 1, 'damped oscillator over T = 6: a saddle, index 1 (conjugate point at pi/omega_d = 3.18)')
    b.eval("""(() => { const f = document.querySelector('#typed input'); f.value = 'm v^2/2 - m x^2/2'; f.dispatchEvent(new Event('change')); })()""")
    settle(b)
    tp = b.eval('__app.truths.length'); S = b.eval('__app.current && __app.current.S')
    check(tp == 1 and S is not None and b.eval('__app.state.onTrue'), f'a typed L with m in it works, and the path follows its true path (true paths {tp}, S {S})')
    run(b, '__app.setups.typed()')
    tp = b.eval('__app.truths.map((t) => [t.S, t.index])')
    want = [(1.368, 0), (4.360, 1), (4.360, 1), (11.02, 2), (30.40, 2), (67.92, 3)]
    check(len(tp) == 6 and all(near(a[0], w[0], 0.005) and a[1] == w[1] for a, w in zip(tp, want)), f'double well: six true paths {[(round(a, 3), i) for a, i in tp]} (the help: {want})')
    # While a slider moves, the true paths are followed at once (a few trajectories), and the full
    # search comes when it stops: both find the same paths.
    MOVE_M = '''(() => { const r = document.querySelector('#params .slider input[type=range]'); r.value = String(+r.value + 20); r.dispatchEvent(new Event('input')); })()'''
    b.eval(MOVE_M)
    moving = b.eval('[__app.truthPending, __app.truths.map((t) => [t.S, t.index]), __app.state.onTrue, __app.state.params.m]')
    settle(b)
    still = b.eval('__app.truths.map((t) => [t.S, t.index])')
    check(moving[0] and moving[2] and len(moving[1]) == len(still) == 6 and all(near(a[0], c[0], 1e-3 * (1 + abs(c[0]))) and a[1] == c[1] for a, c in zip(moving[1], still)),
          f"m to {moving[3]}: the six true paths follow while the slider moves, and the full search agrees when it stops ({[round(a[0], 4) for a in moving[1]]} -> {[round(c[0], 4) for c in still]})")
    # An L concave in the velocity (V - T): the true path is a maximum, not a minimum.
    run(b, '__app.setups.damped()')
    b.eval('''(() => { const box = [...document.querySelectorAll('#params .slider')].pop().querySelector('input[type=number]'); box.value = 2; box.dispatchEvent(new Event('change')); })()''')
    settle(b)
    b.eval("""(() => { const f = document.querySelector('#typed input'); f.value = '-(v^2/2 - x^2/2)'; f.dispatchEvent(new Event('change')); })()""")
    settle(b)
    kinds = b.eval("[...document.querySelectorAll('#truth button.path')].map((e) => e.textContent)")
    run(b, '__app.bend(1)')
    note = b.eval(SCORE)['note']
    check(len(kinds) == 1 and 'a maximum' in kinds[0] and 'maximum' in note, f"L = -(v^2/2 - x^2/2), T = 2: the true path is listed as a maximum ({kinds}), and a bend lowers S ('{note}')")

    # ---- a link carries the knot times and the view
    run(b, '__app.setups.throw()')
    drag_knot(b, 3, -50, 30)
    run(b, '__app.setView("energy")')
    b.eval('new Promise((r) => setTimeout(r, 400))')   # the address is written a moment after the last change
    url, ts = b.eval('location.href'), b.eval('Array.from(__app.state.times)')
    b.goto('about:blank'); b.goto(url[url.index('action/'):]); b.wait('window.__app && __app.ready'); settle(b)
    ts2 = b.eval('Array.from(__app.state.times)')
    check(all(abs(a - c) < 1e-3 for a, c in zip(ts, ts2)) and not b.eval('__app.state.onTrue') and b.eval('__app.state.view') == 'energy',
          f'a link brings back the knot times ({[round(t, 3) for t in ts2]}) and the view')
    e = errors(b)
    check(not e, 'no exceptions' + ('' if not e else ': ' + '; '.join(e[:3])))

# ---- dark, at desktop width: every experiment draws without errors
with Browser('action/index.html', size=(1400, 900)) as b:
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
    b.wait('window.__app && __app.ready'); settle(b)
    first_screen(b, 'dark theme')
    b.click('#help-button'); settle(b)
    b.screenshot('build/act-dark-help.png')
    b.key('Escape')
    for name in ('throw', 'orbit', 'twin', 'feynman', 'brach'):
        run(b, f'__app.setups.{name}()')
        b.screenshot(f'build/act-dark-{name}.png')
    e = errors(b)
    check(not e, 'dark: no exceptions' + ('' if not e else ': ' + '; '.join(e[:3])))

# ---- a phone: one column in the order it is used, and a finger moves a knot or scrolls the page
with Browser('action/index.html', size=(390, 844)) as b:
    b.call('Emulation.setDeviceMetricsOverride', width=390, height=844, deviceScaleFactor=1, mobile=True)
    b.call('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=1)
    b.goto('action/index.html'); b.wait('window.__app && __app.ready'); settle(b)
    b.screenshot('build/act-phone.png')
    w = b.eval('[document.documentElement.scrollWidth, innerWidth]')
    check(w[0] <= w[1], f'phone: no sideways scrolling ({w[0]} <= {w[1]})')
    order = b.eval("['#score', '#path-wrap', '.record-wrap', '#panel-path', '.view-wrap', '#panel-system'].map((s) => document.querySelector(s).getBoundingClientRect().top)")
    check(order == sorted(order), f'phone: the score, the path, its record, the path buttons, the view, the systems, top to bottom ({[round(o) for o in order]})')
    first_screen(b, 'phone')
    hb = b.eval("document.querySelector('#path-hint').getBoundingClientRect().bottom")
    check(hb <= 844 and b.eval('scrollY') == 0, f'phone: the hint under the path plot is on the first screen (its bottom at {hb:.0f} px of 844)')
    ta = b.eval("['#record', '#view'].map((s) => getComputedStyle(document.querySelector(s)).touchAction)")
    check(ta == ['pan-y', 'pan-y'], f'phone: a finger over the record or the view scrolls the page (touch-action {ta})')

    def touch(kind, x, y):
        pts = [] if kind == 'touchEnd' else [{'x': x, 'y': y, 'radiusX': 5, 'radiusY': 5, 'force': 1, 'id': 1}]
        b.call('Input.dispatchTouchEvent', type=kind, touchPoints=pts)

    x0, y0 = knot_px(b, 2)
    q2 = b.eval('__app.state.knots[2]')
    touch('touchStart', x0, y0)
    for i in range(1, 9):
        touch('touchMove', x0 + (2 if i % 2 else -2), y0 - 8 * i)
        b.eval('new Promise((r) => requestAnimationFrame(r))')
    touch('touchEnd', 0, 0); settle(b)
    q2b, t2b = b.eval('__app.state.knots[2]'), b.eval('__app.state.times[2]')
    check(q2b > q2 + 0.5 and t2b == 1, f'phone: a finger on a knot drags it up ({q2:.3f} -> {q2b:.3f}), and not in time')
    e = errors(b)
    check(not e, 'phone: no exceptions' + ('' if not e else ': ' + '; '.join(e[:3])))

print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
