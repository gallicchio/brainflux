#!/usr/bin/env python3
"""Drive the 2D scattering demo: run collisions to the end and check the scattering theory.

Each collision is finished by __app.runUntil(), which takes the animation's own steps at once:
the checks don't wait on the clock, so a slow or loaded computer only makes them take longer."""
import json, os, sys, time, traceback
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

def section(name, fn, b):
    """Run one group of checks; an error in it is a failure with a message, not the end."""
    try:
        fn(b)
    except Exception as e:
        check(False, f'{name}: {type(e).__name__}: {e}')
        traceback.print_exc(limit=2)

def finish(b, what):
    """Run the current collision to its end; False (and a failure) if it didn't get there."""
    t0 = time.time()
    b.eval('__app.runUntil()')
    done = b.eval('__app.finished')
    print(f"note  {what}: t = {b.eval('__app.sim.t'):.1f}, {time.time() - t0:.1f} s of wall time")
    check(done, f'{what}: the collision ran to its end')
    return done

def setup(b, name):
    b.eval(f'__app.setups[{json.dumps(name)}]()')

def window(b, centre, half, which='Psc'):
    """Probability through the detector within centre +- half degrees (the packet holds 1)."""
    return b.eval(f"""(() => {{ const d = __app.detector, P = d[{json.dumps(which)}], dth = 2 * Math.PI / d.M; let s = 0;
      for (let j = 0; j < d.M; j++) {{ const a = ((d.theta[j] * 180 / Math.PI - {centre}) % 360 + 540) % 360 - 180; if (Math.abs(a) <= {half}) s += P[j] * dth; }}
      return s; }})()""")

def readouts(b):
    """The live readouts don't move while their numbers change: fixed slots, fixed decimals."""
    setup(b, 'disk')
    # The left edges of the readouts, and the top edges of the table's rows (which are all there
    # from the start, the values still to come shown as such).
    where = ("[...[...document.querySelectorAll('#readouts .ro')].map(e => e.getBoundingClientRect().left),"
             " ...[...document.querySelectorAll('#sigmas tr')].map(e => e.getBoundingClientRect().top)].map(v => Math.round(v * 10) / 10)")
    seen, ts = [], []
    # Through t = 10 (a digit more), to the end (the box empties, "done" appears), and over a
    # few animation frames of the next run.
    for t in (1, 9.9, 10.1, 20, None):
        b.eval(f'__app.runUntil({"" if t is None else t})')
        seen.append(b.eval(where)); ts.append(b.eval('__app.sim.t'))
    setup(b, 'disk'); b.eval('__app.state.speed = 8')
    for _ in range(6):
        b.sleep(0.25)
        seen.append(b.eval(where)); ts.append(b.eval('__app.sim.t'))
    moved = [i for i in range(1, len(seen)) if seen[i] != seen[0]]
    check(len(seen[0]) >= 7 and not moved, f"readouts stay put over t = {', '.join(f'{t:.1f}' for t in ts)}"
          + ('' if not moved else f': moved at t = {ts[moved[0]]:.2f}, {seen[0]} -> {seen[moved[0]]}'))

def disk(b):
    # The default hard disk: the optical theorem, and three totals that agree.
    setup(b, 'disk')
    if not finish(b, 'hard disk'): return
    tot = b.eval('__app.detector.totals()'); pw = b.eval('__app.pw && {sigma: __app.pw.sigma, optical: __app.pw.optical}')
    check(bool(pw), 'hard disk: partial waves once the packet has gone')
    if pw:
        check(abs(pw['optical'] / pw['sigma'] - 1) < 0.03, f"optical theorem: {pw['optical']:.4f} vs partial waves {pw['sigma']:.4f}")
        check(abs(tot['scattered'] / pw['sigma'] - 1) < 0.06, f"flux {tot['scattered']:.4f} vs partial waves {pw['sigma']:.4f}")
    check(abs(tot['shadow'] / tot['scattered'] - 1) < 0.02, f"shadow {tot['shadow']:.4f} = scattered {tot['scattered']:.4f}")
    b.screenshot('build/s2d-disk-done.png')

def swave(b):
    # A slow packet (the s-wave experiment) in its bigger box: four ways to the total cross section.
    setup(b, 'swave')
    if not finish(b, 'slow packet'): return
    tot = b.eval('__app.detector.totals()'); pw = b.eval('__app.pw && {sigma: __app.pw.sigma, optical: __app.pw.optical}')
    exact = b.eval("(() => { const rows = [...document.querySelectorAll('#sigmas tr')].map(r => r.textContent); return rows.find(r => r.startsWith('exact')); })()")
    ev = float(exact.split(':')[-1].replace('the radial equation', '').strip()) if exact else None
    if not (pw and ev):
        check(False, f'slow packet: partial waves ({bool(pw)}) and the exact row ({exact!r}) once the packet has gone')
        return
    print(f"note  slow packet: flux {tot['scattered']:.4f}, partial waves {pw['sigma']:.4f}, optical {pw['optical']:.4f}, exact {ev}")
    check(abs(pw['optical'] / pw['sigma'] - 1) < 0.05 and abs(tot['scattered'] / pw['sigma'] - 1) < 0.1 and abs(ev / pw['sigma'] - 1) < 0.05,
          'slow packet: flux, partial waves, optical theorem and the radial equation agree')

def bump(b):
    # The bump of the Born experiment scatters a share of the packet one can see, and the
    # Born approximation is still close.
    setup(b, 'born')
    if not finish(b, 'bump'): return
    p = window(b, 0, 180); tot = b.eval('__app.detector.totals()')
    sb = b.eval('__app.born.reduce((s, v) => s + v * 2 * Math.PI / __app.born.length, 0)')
    check(p > 0.12, f'bump: {p:.3f} of the packet scattered (V0 = {b.eval("__app.state.target.params.V0")})')
    check(abs(tot['scattered'] / sb - 1) < 0.1, f"bump: flux sigma {tot['scattered']:.3f} within 10% of Born's {sb:.3f}")
    b.screenshot('build/s2d-bump-done.png')

def slits(b):
    # The double slit: Fraunhofer's prediction over the whole far half circle, -90 to 90 degrees,
    # with the measured fringes where it puts them.
    setup(b, 'slits')
    if not finish(b, 'double slit'): return
    r = b.eval("""(() => { const d = __app.detector, s = __app.slit.dsdt, deg = (j) => ((d.theta[j] * 180 / Math.PI + 180) % 360) - 180;
      const on = [...s.keys()].filter((j) => s[j] > 0).map(deg), meas = [...d.Ptot].map((v, j) => Math.abs(deg(j)) < 90 ? v / d.fluence : 0);
      // The bright fringes: local maxima of each curve between 10 and 80 degrees.
      const peaks = (f) => [...f.keys()].filter((j) => Math.abs(deg(j)) > 10 && Math.abs(deg(j)) < 80 && f[j] > f[(j + 1) % d.M] && f[j] > f[(j + d.M - 1) % d.M] && f[j] > 0.05 * Math.max(...f)).map(deg);
      return { lo: Math.min(...on), hi: Math.max(...on), at89: s[Math.round(89 / 360 * d.M)], pp: peaks([...s]), pm: peaks(meas),
        blind: __app.slit.blind.filter(Boolean).length }; })()""")
    print(f"note  double slit: prediction from {r['lo']:.1f} to {r['hi']:.1f} degrees; fringes predicted {[round(x, 1) for x in r['pp']]}, "
          f"measured {[round(x, 1) for x in r['pm']]}; {r['blind']} detector angles inside the wall")
    check(r['lo'] < -88 and r['hi'] > 88 and r['at89'] > 0, 'double slit: the prediction spans -90 to 90 degrees')
    check(len(r['pp']) == len(r['pm']) == 2 and all(abs(p - q) < 4 for p, q in zip(sorted(r['pp']), sorted(r['pm']))),
          'double slit: the measured fringes are where Fraunhofer puts them')
    b.screenshot('build/s2d-slits-done.png')

def crystal(b):
    # The crystal: at the Bragg angle a reflected beam at twice it; turned away from it, hardly any.
    frac = {}
    for name in ('crystal', 'offbragg'):
        setup(b, name)
        if not finish(b, name): return
        a = b.eval('__app.state.turn')
        frac[name] = window(b, 2 * a, 15)
        print(f"note  {name}: turned {a} degrees, {frac[name]:.3f} of the packet within 15 degrees of {2 * a} degrees")
        b.screenshot(f'build/s2d-{name}-done.png')
    check(frac['crystal'] > 0.2 and frac['crystal'] > 4 * frac['offbragg'],
          f"Bragg: {frac['crystal']:.3f} reflected at the Bragg angle, {frac['offbragg']:.3f} off it")

def experiments(b):
    # Every experiment, half way through its collision.
    for name in b.eval('Object.keys(__app.setups)'):
        setup(b, name)
        b.eval('__app.runUntil(0.55 * __app.tEnd)')
        b.screenshot(f'build/s2d-exp-{name}.png')
        print(f"note  {name}: t = {b.eval('__app.sim.t'):.1f}")

with Browser('schrodinger2d/index.html', size=(1500, 1000)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1)
    b.screenshot('build/s2d-start.png')
    for name, fn in [('readouts', readouts), ('hard disk', disk), ('slow packet', swave), ('bump', bump),
                     ('double slit', slits), ('crystal', crystal), ('experiments', experiments)]:
        section(name, fn, b)
    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
