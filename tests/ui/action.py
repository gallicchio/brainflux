#!/usr/bin/env python3
"""Drive the least-action demo: every set-up starts on its true path, knots move in place and in
time, roll downhill, saddles, closed orbits, every system and experiment."""
import json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

P = '#path'
S = '__app.current.S'
ST = '__app.ref.S'
# The largest distance (in q) a free knot would move on its own to make S stationary: zero on a true path.
NEWTON = '''(() => { const a = __app, d = a.downhill(a.path()); let w = 0;
  for (const k of d.free) if (d.cq[k] > 0) w = Math.max(w, Math.abs(d.gq[k]) / d.cq[k]);
  return w / (a.state.sys.qrange[1] - a.state.sys.qrange[0]); })()'''

def knot_px(b, k):
    """The page coordinates of knot k."""
    x, y, w, h = b.box(P)
    px, py = b.eval(f'__app.toPx(__app.state.times[{k}], __app.state.knots[{k}])')
    return x + px, y + py

def drag_knot(b, k, dx, dy, steps=10):
    x0, y0 = knot_px(b, k)
    b.mouse('mouseMoved', x0, y0)
    b.mouse('mousePressed', x0, y0, 1, 'left')
    for i in range(1, steps + 1):
        b.mouse('mouseMoved', x0 + dx * i / steps, y0 + dy * i / steps, 1, 'left')
    b.mouse('mouseReleased', x0 + dx, y0 + dy, 0, 'left')
    b.sleep(0.2)

with Browser('action/index.html', size=(1400, 950)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(0.5)
    b.screenshot('build/act-start.png')
    S0, St = b.eval(S), b.eval(ST)
    check(b.eval('__app.state.onTrue') and abs(S0 - St) < 1e-6 * abs(St), f'the page opens on the true path (S {S0:.6f}, true {St:.6f})')

    # Every set-up starts on its true path: no knot would move on its own to change S.
    for name in b.eval('Object.keys(__app.setups)'):
        b.eval(f'__app.setups[{json.dumps(name)}]()'); b.sleep(0.3)
        n, on, w = b.eval('__app.truths.length'), b.eval('__app.state.onTrue'), b.eval(NEWTON)
        b.screenshot(f'build/act-exp-{name}.png')
        if name == 'hints':
            check(not on and w > 1e-3, f'{name}: starts bent, for the arrows (Newton step {w:.2g} of the range)')
        else:
            check(n >= 1 and on and w < 1e-6, f'{name}: {n} true path(s); starts on one (Newton step {w:.1e} of the range), S = {b.eval(S):.5f}')

    # Up-down drags: on a minimum every change raises S, and is recorded.
    b.eval('__app.setups.throw()'); b.sleep(0.3)
    S0, h0 = b.eval(S), b.eval('__app.history.length')
    drag_knot(b, 2, 0, -40)
    S1, h1 = b.eval(S), b.eval('__app.history.length')
    check(S1 > S0 + 1e-3 and h1 > h0 + 3, f'dragging a knot up raises S ({S0:.3f} -> {S1:.3f}) and records it ({h0} -> {h1} points)')
    b.eval('document.querySelector("#reset").click()'); b.sleep(0.2)
    check(abs(b.eval(S) - S0) < 1e-9 and b.eval('__app.state.onTrue'), 'Back to true path returns to the start')

    # Sideways drags move a knot in time, keep the order, and (on a minimum) raise S.
    t1, q1 = b.eval('__app.state.times[1]'), b.eval('__app.state.knots[1]')
    drag_knot(b, 1, 60, 0)
    t1b, q1b, S2 = b.eval('__app.state.times[1]'), b.eval('__app.state.knots[1]'), b.eval(S)
    check(t1b > t1 + 0.05 and abs(q1b - q1) < 0.05, f'a sideways drag moves the knot in time ({t1:.3f} -> {t1b:.3f}), hardly in place')
    check(S2 > S0 + 1e-3, f'... and costs action ({S0:.3f} -> {S2:.3f})')
    drag_knot(b, 1, 900, 0)
    ts = b.eval('Array.from(__app.state.times)')
    check(all(ts[i + 1] - ts[i] > 0.19 * (ts[-1] - ts[0]) / (len(ts) - 1) for i in range(len(ts) - 1)) and ts[0] == 0 and ts[-1] == 2,
          f'dragged far past its neighbour, a knot stops short of it; the ends keep their times ({[round(t, 3) for t in ts]})')
    # Shift keeps a drag to one direction.
    b.eval('document.querySelector("#reset").click()'); b.sleep(0.2)
    t2 = b.eval('__app.state.times[2]')
    x0, y0 = knot_px(b, 2)
    b.mouse('mouseMoved', x0, y0); b.mouse('mousePressed', x0, y0, 1, 'left')
    for i in range(1, 9): b.call('Input.dispatchMouseEvent', type='mouseMoved', x=x0 + 3 * i, y=y0 - 8 * i, buttons=1, button='left', modifiers=8)
    b.mouse('mouseReleased', x0 + 24, y0 - 64, 0, 'left'); b.sleep(0.2)
    check(abs(b.eval('__app.state.times[2]') - t2) < 1e-12 and b.eval('__app.state.knots[2]') > 5.5, 'Shift-drag mostly upwards moves the knot only up')

    # The velocity under the pointer.
    b.eval('document.querySelector("#reset").click()')
    x, y, w, h = b.box(P)
    b.mouse('mouseMoved', x + 0.3 * w, y + 0.5 * h); b.sleep(0.2)
    hov = b.eval('__app.hover')
    check(hov is not None and 0.4 < hov['s'] < 0.8, f'pointing at the plot picks the time under the pointer ({hov})')
    b.screenshot('build/act-velocity.png')
    b.mouse('mouseMoved', x - 20, y - 20); b.sleep(0.1)

    # Keyboard: [ ] choose a knot, arrows move it, up-down and in time.
    b.eval('document.querySelector("#path").focus()')
    sel = b.eval('__app.state.sel')
    b.key(']')
    check(b.eval('__app.state.sel') == sel + 1, f'] chooses the next knot ({sel} -> {sel + 1})')
    k = sel + 1
    t, q = b.eval(f'__app.state.times[{k}]'), b.eval(f'__app.state.knots[{k}]')
    b.key('ArrowRight', 'ArrowRight'); b.key('ArrowUp', 'ArrowUp'); b.sleep(0.2)
    t2, q2 = b.eval(f'__app.state.times[{k}]'), b.eval(f'__app.state.knots[{k}]')
    check(t2 > t and q2 > q, f'the arrow keys move the knot later ({t:.3f} -> {t2:.3f}) and up ({q:.3f} -> {q2:.3f})')

    # Rolling downhill, in place and in time, ends on the true path.
    b.eval('__app.setups.hints()'); b.sleep(0.3)
    b.eval("__app.setRolling(true)"); b.sleep(5)
    S, St = b.eval('__app.current.S'), b.eval('__app.truths[0].S')
    check(abs(S - St) < 2e-3 * abs(St), f'rolling downhill finds the true path (S {S:.4f}, true {St:.4f})')
    b.screenshot('build/act-rolled.png')
    # ... from a path whose knots are unevenly spaced in time, too.
    b.eval('__app.setups.find()'); b.sleep(0.3)
    b.eval('__app.moveKnotTo(1, 0.15, 0.5); __app.moveKnotTo(2, 0.6, 3.5); __app.moveKnotTo(3, 1.1, 2); __app.setRolling(true)'); b.sleep(5)
    S, ts = b.eval('__app.current.S'), b.eval('Array.from(__app.state.times)')
    check(abs(S - 4) < 1e-3 and all(ts[i + 1] > ts[i] for i in range(len(ts) - 1)), f'... and from knots bunched in time (S {S:.5f}, exact 4; times {[round(t, 2) for t in ts]})')

    # A saddle: one knot raises S, bending the whole path lowers it, rolling runs away.
    b.eval("__app.setups.saddle()"); b.sleep(0.3)
    S0, St, idx = b.eval('__app.current.S'), b.eval(ST), b.eval('__app.ref.index')
    drag_knot(b, 2, 0, -25)
    S1 = b.eval('__app.current.S')
    b.eval('document.querySelector("#reset").click()'); b.sleep(0.1)
    b.eval('document.querySelector("#bend").click()'); b.sleep(0.2)
    S2 = b.eval('__app.current.S')
    check(idx == 1 and S1 > S0 and S2 < St - 0.05, f'at a saddle (index {idx}) one knot raises S ({S1:.3f} > {S0:.3f}) but bending lowers it ({S2:.3f} < {St:.3f})')
    b.screenshot('build/act-saddle.png')
    b.eval("__app.setRolling(true)"); b.sleep(2)
    S3 = b.eval('__app.current.S'); b.eval("__app.setRolling(false)")
    check(S3 < S2, f'rolling downhill from there runs away below the true path ({S3:.3f})')

    # The readout holds still: labels, numbers and words keep their places while the numbers
    # change, gain or lose digits, and cross zero.
    pos = "Array.from(document.querySelectorAll('#readout .lab, #readout .num, #readout .note'), (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10]; })"
    for name, moves in (('saddle', ['bend', 'bend', 'bend', 'bend', (2, 0, -30), (1, 20, -90)]),
                        ('throw', [(2, 0, -200), (2, 0, 250), (1, 40, 120), (3, -30, -300)])):
        b.eval(f'__app.setups.{name}()'); b.sleep(0.3)
        p0, values, moved = b.eval(pos), [b.eval('__app.current.S')], []
        for mv in moves:
            if mv == 'bend': b.eval('document.querySelector("#bend").click()'); b.sleep(0.1)
            else: drag_knot(b, *mv)
            values.append(b.eval('__app.current.S'))
            if b.eval(pos) != p0: moved.append(b.eval('document.querySelector("#readout").textContent'))
        signs = 'both signs' if min(values) < 0 < max(values) else 'one sign'
        check(not moved and len(p0) >= 4, f'{name}: the readout does not move as S runs through {[round(v, 3) for v in values]} ({signs})' + (f'; moved at {moved[:2]}' if moved else ''))

    # A closed orbit: the path is a loop in phase space, the true one a closed orbit.
    b.eval("__app.setups.orbit()"); b.sleep(0.3)
    ends = b.eval('(() => { const p = __app.path(), s = p.sample([p.s0, p.s1]); return [s.q[0], s.q[1], s.v[0], s.v[1]]; })()')
    t0 = b.eval('(() => { const t = __app.ref; return [t.q[0], t.q[t.q.length - 1], t.v[0], t.v[t.v.length - 1], !!t.closed]; })()')
    check(abs(ends[0] - ends[1]) < 1e-12 and abs(ends[2] - ends[3]) < 1e-9, f'periodic: the drawn path ends where it starts, with the same velocity ({ends})')
    check(t0[4] and abs(t0[0] - t0[1]) < 1e-4 and abs(t0[2] - t0[3]) < 1e-3, f'periodic: the true orbit closes in phase space ({[round(x, 5) for x in t0[:4]]})')
    S0, St = b.eval('__app.current.S'), b.eval(ST)
    check(abs(S0 - St) < 1e-3, f'periodic: the path starts on the orbit (S {S0:.5f}, orbit {St:.5f})')
    drag_knot(b, 0, 0, 40)
    q0, qn = b.eval('__app.state.knots[0]'), b.eval('__app.state.knots[__app.state.knots.length - 1]')
    check(q0 == qn and q0 < -0.3, f'periodic: dragging the start point drags the end with it ({q0:.3f}, {qn:.3f})')
    b.sleep(1)
    b.eval('document.querySelector("#reset").click()'); b.sleep(0.2)
    S1, St1 = b.eval('__app.current.S'), b.eval(ST)
    check(abs(St1 - St) < 1e-3 * abs(St) and abs(S1 - St1) < 1e-3, f'... and the orbit through the new start point has the same action ({St1:.5f})')
    b.screenshot('build/act-orbit.png')
    # The oscillator's closed orbits all take 2π/ω and have S = 0: bending keeps it so.
    b.eval("document.querySelector('#systems button:nth-child(3)').click()"); b.sleep(0.3)
    b.eval("[...document.querySelectorAll('#mode-box button')].find((x) => x.textContent === 'Periodic').click()"); b.sleep(0.4)
    T, S0 = b.eval('__app.state.s1 - __app.state.s0'), b.eval('__app.current.S')
    b.eval('document.querySelector("#bend").click()'); b.sleep(0.2)
    S1 = b.eval('__app.current.S')
    check(abs(T - 2 * 3.141592653589793) < 1e-9 and abs(S0) < 2e-3 and abs(S1) < 2e-3, f'oscillator, periodic: T = 2π ({T:.6f}), S = {S0:.5f}, bent {S1:.5f}: a family of orbits')
    b.screenshot('build/act-oscillator-orbit.png')

    # Several true paths: clicking one in the list puts the path on it.
    b.eval("__app.setups.pendulum()"); b.sleep(0.3)
    b.eval("document.querySelectorAll('#truth button.path')[2].click()"); b.sleep(0.2)
    S, St = b.eval('__app.current.S'), b.eval('__app.truths[2].S')
    check(abs(S - St) < 0.02 * (1 + abs(St)) and b.eval('__app.ref === __app.truths[2]'), f'clicking a true path in the list puts the path on it (S {S:.4f}, true {St:.4f})')

    # A typed Lagrangian may use m.
    b.eval("__app.setups.damped()"); b.sleep(0.3)
    b.eval("""(() => { const f = document.querySelector('#typed input'); f.value = 'm v^2/2 - m x^2/2'; f.dispatchEvent(new Event('change')); })()""")
    b.sleep(0.5)
    tp = b.eval('__app.truths.length'); S = b.eval('__app.current && __app.current.S')
    check(tp == 1 and S is not None and b.eval('__app.state.onTrue'), f'a typed L with m in it works, and the path follows its true path (true paths {tp}, S {S})')
    # The brachistochrone's start stays put.
    b.eval("__app.setups.brach()"); b.sleep(0.3)
    b.drag(P, (0.01, 0.2), (0.3, 0.5), steps=5); b.sleep(0.3)
    check(abs(b.eval('__app.state.knots[0]')) < 1e-12 and b.eval('__app.state.times[0]') == 0, 'the brachistochrone starts at rest at the top, whatever you drag')
    # A link carries the knot times.
    b.eval('__app.setups.throw()'); b.sleep(0.2)
    drag_knot(b, 3, -50, 30); b.sleep(0.5)
    url, ts = b.eval('location.href'), b.eval('Array.from(__app.state.times)')
    b.goto('about:blank'); b.goto(url[url.index('action/'):]); b.wait('window.__app && __app.ready'); b.sleep(0.4)
    ts2 = b.eval('Array.from(__app.state.times)')
    check(all(abs(a - c) < 1e-3 for a, c in zip(ts, ts2)) and not b.eval('__app.state.onTrue'), f'a link brings back the knot times ({[round(t, 3) for t in ts2]})')
    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
