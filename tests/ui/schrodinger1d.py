#!/usr/bin/env python3
"""Drive the 1D Schrödinger demo: every potential, every experiment, the measurements."""
import json, math, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

STARTS = "[...document.querySelectorAll('#starts button')]"
# The initial-state buttons lit, and whether each is on screen.
LIT = f"{STARTS}.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => [b.textContent, b.offsetParent !== null])"
OBS = '(() => { const o = __app.sim.observables(); return {x: o.x, sx: o.sx, p: o.p, sp: o.sp, E: o.E, norm: o.norm}; })()'

def click_start(b, label):
    b.eval(f"{STARTS}.find(b => b.textContent === {json.dumps(label)}).click()")

def lit(b):
    return b.eval(LIT)

def set_slider(b, name, value):
    """Type a value into the number box of the initial state's slider called name (as shown)."""
    b.eval(f"""(() => {{ const s = [...document.querySelectorAll('#state-box .slider')].find(s => s.querySelector('label').textContent === {json.dumps(name)});
        const box = s.querySelector('input[type=number]'); box.value = {json.dumps(str(value))}; box.dispatchEvent(new Event('change')); }})()""")

def run_to(b, t):
    """Advance the paused simulation to time t, straight away."""
    b.eval(f"(() => {{ const s = __app.sim; for (let i = 0; i < 100000 && s.t < {t} - 1e-9; i++) __app.advance(Math.min(1, {t} - s.t)); }})()")

def pause(b):
    b.eval("__app.state.running && document.querySelector('#play').click()")

def packet_T(V0, a, k0, sigma):
    """A square well's transmission, averaged over a Gaussian packet's spread in k."""
    def T(k):
        E = k * k / 2; q = math.sqrt(2 * (E + V0))
        return 1 / (1 + V0 * V0 * math.sin(2 * a * q) ** 2 / (4 * E * (E + V0)))
    sk, num, den = 1 / (2 * sigma), 0, 0
    for i in range(-3000, 3001):
        k = k0 + 6 * sk * i / 3000
        w = math.exp(-((k - k0) ** 2) / (2 * sk * sk)); num += w * T(abs(k) + 1e-12); den += w
    return num / den

with Browser('schrodinger1d/index.html', size=(1400, 950)) as b:
    b.wait('window.__app && __app.ready')
    b.sleep(1.5)
    check(b.eval('__app.sim.t') > 0.5, f"it starts running (t = {b.eval('__app.sim.t'):.2f})")
    check(abs(b.eval('__app.sim.norm()') - 1) < 1e-9, 'the norm stays 1')
    check(lit(b) == [['Coherent', True]], f'the harmonic potential opens with Coherent lit, and only it ({lit(b)})')
    check(b.eval("!__app.state.show.classical && document.querySelector('#key-classical').hidden"),
          'the classical particle is off to begin with')
    check(b.eval("document.querySelector('#mom-wrap .plot-key b').textContent") == 'Momentum'
          and b.eval("document.querySelector('.main-wrap .plot-key b').textContent") == 'Position',
          'the plots are named Position and Momentum in their corners')
    check('Make a measurement' in b.eval("document.querySelector('.controls').textContent"), 'the measurement panel says what it does')
    help_text = b.eval("document.querySelector('#help').innerHTML")
    check('tilde' not in help_text and 'ψ̃' not in help_text, 'the momentum wave function is φ(p) in the help')
    pause(b); b.sleep(0.2)          # (a last frame drawn, which the marks must match)
    o = b.eval(OBS)
    marks = b.eval('__app.marks')
    check(len(marks) == 2 and abs(marks[0]['mean'] - o['x']) < 0.05 and abs(marks[0]['sd'] - o['sx']) < 0.05
          and abs(marks[1]['mean'] - o['p']) < 0.05 and abs(marks[1]['sd'] - o['sp']) < 0.05,
          f"<x> ± sigma_x and <p> ± sigma_p are drawn ({marks})")
    b.screenshot('build/s1d-start.png')

    # Every potential opens with its first named state lit; each named state lights itself, each
    # kind's button lights one button of its row; and the typed starting formula is a tame one.
    pause(b)
    for pot in b.eval('__app.potentials.map(p => ({id: p.id, first: p.states[0].label, labels: p.states.map(s => s.label), erange: p.erange, driven: /\\bt\\b/.test(p.V)}))'):
        b.eval(f"__app.choosePotential(__app.byId({json.dumps(pot['id'])}), {{ keepRunning: false }})")
        check(lit(b) == [[pot['first'], True]], f"{pot['id']}: opens with {pot['first']} lit ({lit(b)})")
        bad = []
        for label in pot['labels']:
            click_start(b, label)
            if lit(b) != [[label, True]]: bad.append((label, lit(b)))
        for kind in b.eval("[...document.querySelectorAll('#starts .kind')].filter(b => b.offsetParent).map(b => b.textContent)"):
            click_start(b, kind)
            row = b.eval(f"[...document.querySelectorAll('#starts .start-row')].find(r => r.firstChild.textContent === {json.dumps(kind)}).textContent")
            if len(lit(b)) != 1 or not lit(b)[0][1] or lit(b)[0][0] not in row: bad.append((kind, lit(b)))
        check(not bad, f"{pot['id']}: one button lit, the one clicked or in its row ({bad or 'all ' + str(len(pot['labels']))})")
        click_start(b, 'Typed')
        o0 = b.eval(OBS)
        run_to(b, 3)
        o1 = b.eval(OBS)
        lo, hi = pot['erange'] or (-1e9, 1e9)
        lost = 1 - b.eval('__app.sim.norm() + __app.sim.absorbed')
        # <E> is kept, unless V changes with time or the fast part of psi has reached the absorbers.
        kept = pot['driven'] or b.eval('__app.sim.absorbed') > 1e-5 or abs(o1['E'] - o0['E']) < 0.01 * max(1, abs(o0['E']))
        check(lo <= o0['E'] <= hi and abs(lost) < 1e-6 and kept,
              f"{pot['id']}: Typed starts from {b.eval('__app.state.init.psi')!r}, <E> = {o0['E']:.3f} on the plot, kept to {o1['E']:.3f}")
    b.screenshot('build/s1d-typed.png')

    # The readouts stay put while the numbers change: a coherent state swings through zero, so
    # <x> and <p> change sign, and t passes 10.
    b.eval("__app.choosePotential(__app.byId('harmonic'), { keepRunning: false })")
    b.eval("__app.state.speed = 5; document.querySelector('#play').click()")
    BOXES = """[...document.querySelectorAll('#readouts .ro')].map(e => { const r = e.getBoundingClientRect(), v = e.querySelector('b').getBoundingClientRect();
        return [Math.round(r.left * 100) / 100, Math.round(r.top * 100) / 100, Math.round(v.left * 100) / 100, Math.round(v.right * 100) / 100]; })"""
    first, moved, seen = b.eval(BOXES), [], {'x': set(), 'p': set(), 't': set()}
    height = b.eval("document.querySelector('#readouts').getBoundingClientRect().height")
    for i in range(30):
        b.sleep(0.1)
        now = b.eval(BOXES)
        o = b.eval(OBS)
        seen['x'].add(o['x'] > 0); seen['p'].add(o['p'] > 0); seen['t'].add(b.eval('__app.sim.t') >= 10)
        if now != first or b.eval("document.querySelector('#readouts').getBoundingClientRect().height") != height:
            moved.append((i, b.eval("document.querySelector('#readouts').textContent")))
    pause(b)
    check(all(len(v) == 2 for v in seen.values()) and len(first) == 7 and not moved,
          f"the readouts' labels and values keep their places while <x>, <p> change sign and t passes 10 ({moved[:2] or 'none moved'})")
    b.screenshot('build/s1d-readouts.png')

    # A slider moved: the highlight goes to the kind, and comes back with the named value.
    b.eval("__app.choosePotential(__app.byId('harmonic'), { keepRunning: false })")
    set_slider(b, 'x0', 2)
    check(lit(b) == [['Packet', True]], f'moving x0 lights Packet, a packet of your own ({lit(b)})')
    set_slider(b, 'x0', 3)
    check(lit(b) == [['Coherent', True]], f'moving it back lights Coherent again ({lit(b)})')
    click_start(b, 'n = 0')
    set_slider(b, 'n', 3)
    check(lit(b) == [['Stationary', True]] and b.eval('__app.state.init.n') == 3, f'n = 3 lights Stationary ({lit(b)})')
    set_slider(b, 'n', 1)
    check(lit(b) == [['n = 1', True]], f'n = 1 lights n = 1 ({lit(b)})')
    click_start(b, 'Packet')
    check(lit(b) == [['Coherent', True]], f'Packet goes back to the last packet, Coherent ({lit(b)})')

    # The squeezed state stays centred and at rest while it breathes.
    click_start(b, 'Squeezed')
    o0 = b.eval(OBS)
    run_to(b, math.pi / 2)
    o1 = b.eval(OBS)
    check(max(abs(o0['x']), abs(o0['p']), abs(o1['x']), abs(o1['p'])) < 1e-6 and abs(o1['sx'] - 1 / (2 * 0.3)) < 0.01,
          f"Squeezed: <x> = <p> = 0 throughout, sigma_x {o0['sx']:.3f} -> {o1['sx']:.3f} at t = pi/2 (1/2 sigma0 = {1 / 0.6:.3f})")

    # The infinite well shows its walls, and a little beyond.
    b.eval("__app.choosePotential(__app.byId('box'), { keepRunning: false })")
    box_view = b.eval('__app.viewRange()')
    check(box_view == [-1, 11] and b.eval('__app.state.init.params.k0') == 2, f'the infinite well is drawn from -1 to 11 ({box_view}), its packet at k0 = 2')
    b.eval("document.querySelector('#play').click()"); b.sleep(1.0); pause(b)
    b.screenshot('build/s1d-box.png')
    b.eval("__app.choosePotential(__app.byId('free'), { keepRunning: false })")
    check(b.eval('__app.viewRange()') == [-37.5, 37.5], 'the free particle is drawn without walls')

    # The finite well: one packet on a transmission resonance, one off it.
    well = b.eval("__app.byId('well')")
    V0, a = well['params']['V0'], well['params']['a']
    b.eval("__app.choosePotential(__app.byId('well'), { keepRunning: false })")
    for label, t_end in [('On resonance', 30), ('Off resonance', 50)]:
        click_start(b, label); pause(b)
        k0, sigma = b.eval('__app.state.init.params.k0'), b.eval('__app.state.init.params.sigma')
        run_to(b, t_end)
        T = b.eval('1 - __app.sim.probabilityLeftOf(0) - __app.sim.absorbedLeft')
        want = packet_T(V0, a, k0, sigma)
        n = 2 * a * math.sqrt(k0 * k0 + 2 * V0) / math.pi
        check(abs(T - want) < 0.01 and (T > 0.97 if label == 'On resonance' else T < 0.4),
              f'{label}: 2ak\'/pi = {n:.3f}, transmitted {T:.4f}, square-well T(E) over the packet {want:.4f}')
        b.eval('__app.restart()'); run_to(b, 12 if label == 'On resonance' else 26)
        b.eval("document.querySelector('#play').click()"); b.sleep(0.1); pause(b)
        b.screenshot(f"build/s1d-well-{label.split()[0].lower()}.png")

    for name in b.eval('Object.keys(__app.setups)'):
        b.eval(f'__app.setups[{json.dumps(name)}]()')
        b.eval('__app.slow')
        b.sleep(2.0)
        slow, frames = b.eval('__app.slow')
        if slow: print(f'note  {name}: {slow} of {frames} frames could not keep up with the requested speed (dt {b.eval("__app.sim.h"):.5f})')
        b.screenshot(f'build/s1d-exp-{name}.png')
        n = b.eval('__app.sim.norm() + __app.sim.absorbed')
        check(abs(n - 1) < 1e-6 or name == 'measure', f'{name}: probability accounted for ({n:.9f}), t = {b.eval("__app.sim.t"):.2f}')
        on = lit(b)
        check(len(on) == 1 and on[0][1], f'{name}: {on} lit')
    # Measurements on the box ground state packet.
    b.eval("__app.setups.measure()"); b.sleep(0.3)
    b.click('#measure-e'); b.sleep(0.3)
    e1 = b.eval('__app.sim.observables().E')
    b.click('#measure-e'); b.sleep(0.3)
    e2 = b.eval('__app.sim.observables().E')
    check(abs(e1 - e2) < 1e-6, f'measuring the energy twice gives the same answer ({e1:.5f}, {e2:.5f})')
    b.click('#measure-x'); b.sleep(0.3)
    check(b.eval('__app.sim.observables().sx') < 0.2, 'measuring the position localises the particle')
    # A link to a set-up lights the named state it holds.
    init = json.dumps({'kind': 'packet', 'params': {'x0': -14, 'sigma': 2.5, 'k0': 1.19}})
    b.eval(f"location.hash = 'pot=well&init=' + encodeURIComponent({json.dumps(init)}); location.reload()")
    b.sleep(1.0); b.wait('window.__app && __app.ready')
    check(lit(b) == [['Off resonance', True]], f'a link to the finite well with that packet lights Off resonance ({lit(b)})')
    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
