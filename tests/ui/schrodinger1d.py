#!/usr/bin/env python3
"""Drive the 1D Schrödinger demo: every potential, every experiment, the measurements, the
numbers the help quotes, and the first screen (hint, Start here) in both themes and on a phone."""
import json, math, os, sys, time
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
LEVELS = '__app.levels.map(l => l.E)'
# The probability that has passed x = 0 to the right, counting what the absorber took there.
PASSED = '1 - __app.sim.probabilityLeftOf(0) - __app.sim.absorbedLeft'

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
    b.eval(f"(() => {{ const s = __app.sim; for (let i = 0; i < 200000 && s.t < {t} - 1e-9; i++) __app.advance(Math.min(1, {t} - s.t)); }})()")

def pause(b):
    b.eval("__app.state.running && document.querySelector('#play').click()")

def choose(b, pot):
    b.eval(f"__app.choosePotential(__app.byId({json.dumps(pot)}), {{ keepRunning: false }})")

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

# The contrast ratio (WCAG) between the text colour of sel and the background colour of bgSel.
CONTRAST = r'''((sel, bgSel) => { const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g).map(Number);
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  const fg = getComputedStyle(document.querySelector(sel)).color, bg = getComputedStyle(document.querySelector(bgSel)).backgroundColor;
  const [x, y] = [lum(fg), lum(bg)].sort((u, v) => v - u); return (x + 0.05) / (y + 0.05); })'''

def first_screen(b, where):
    """What a cold reader meets: a hint right under the main picture saying what to pick, drag
    and click, on screen without scrolling; words beside the readouts; and the drawer opening
    with a Start-here block in plain words (no equations) before the introduction.  Readable in
    this theme."""
    h = b.eval('''(() => { const h = document.getElementById('hint'), r = h.getBoundingClientRect(), p = document.querySelector('.main-wrap').getBoundingClientRect();
      return { text: h.textContent, top: r.top, bottom: r.bottom, h: r.height, plotBottom: p.bottom, inner: innerHeight }; })()''')
    check(h['text'].startswith('Pick a potential and a starting wave function') and h['h'] > 10 and 0 <= h['top'] - h['plotBottom'] < 16 and h['bottom'] <= h['inner'],
          f"{where}: the hint \"{h['text'][:40]}...\" sits right under the plot, on screen without scrolling (bottom {h['bottom']:.0f} of {h['inner']})")
    ro = b.eval("document.querySelector('#readouts').textContent")
    check(all(w in ro for w in ['mean ⟨x⟩', 'spread σx', 'mean ⟨p⟩', 'σxσp', '≥ ħ/2 = ½', 'energy ⟨E⟩']),
          f"{where}: the readouts carry words beside their symbols ({ro[:60]}...)")
    d = b.eval('''(() => { const d = document.getElementById('help'), kids = [...d.children].map((e) => (e.tagName + '.' + e.className).toLowerCase());
      const start = d.querySelector('section.start'), h3 = start && start.querySelector('h3');
      return { kids, text: start ? start.textContent.replace(/\\s+/g, ' ').trim() : '', h3: h3 ? h3.textContent : '', eqs: start ? start.querySelectorAll('math').length : -1 }; })()''')
    exps = [i for i, k in enumerate(d['kids']) if k == 'article.exp']
    check(d['kids'][1] == 'section.start' and d['h3'] == 'Start here' and d['eqs'] == 0 and 'Pick a' in d['text'] and 'Set it up' in d['text'] and 300 < len(d['text']) < 1200,
          f"{where}: the drawer opens with a Start-here block in plain words, no equations ({len(d['text'])} characters)")
    check(len(exps) == 19 and d['kids'][2] == 'p.' and exps[0] > 2, f"{where}: then the introduction (kept), then the {len(exps)} experiments")
    c1, c2 = b.eval(CONTRAST + "('#hint', 'body')"), b.eval(CONTRAST + "('.drawer .start p', '.drawer .start')")
    check(c1 >= 4.5 and c2 >= 4.5, f"{where}: the hint and the Start-here block read (contrast {c1:.1f} and {c2:.1f} to 1)")

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
    first_screen(b, 'desktop, light')
    check(b.eval("!document.getElementById('hint-levels').hidden") and b.eval("document.getElementById('key-current').hidden"),
          'the hint offers the levels to click (the harmonic well has some); the current view\'s key is not shown')
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
        choose(b, pot['id'])
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
    choose(b, 'harmonic')
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
    check(height < 30, f'the opening readouts fit on one line ({height:.0f} px tall)')
    b.screenshot('build/s1d-readouts.png')

    # A slider moved: the highlight goes to the kind, and comes back with the named value.
    choose(b, 'harmonic')
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
    levels = b.eval(LEVELS)
    check(all(abs(levels[n] - (n + 0.5)) < 1e-4 for n in range(6)), f'the harmonic levels are n + 1/2 ({levels[0]:.4f}, {levels[1]:.4f}, ...)')

    # The squeezed state stays centred and at rest while it breathes.
    click_start(b, 'Squeezed')
    o0 = b.eval(OBS)
    run_to(b, math.pi / 2)
    o1 = b.eval(OBS)
    check(max(abs(o0['x']), abs(o0['p']), abs(o1['x']), abs(o1['p'])) < 1e-6 and abs(o1['sx'] - 1 / (2 * 0.3)) < 0.01,
          f"Squeezed: <x> = <p> = 0 throughout, sigma_x {o0['sx']:.3f} -> {o1['sx']:.3f} at t = pi/2 (1/2 sigma0 = {1 / 0.6:.3f})")

    # The infinite well shows its walls, and a little beyond; its levels are numbered from 1.
    choose(b, 'box')
    box_view = b.eval('__app.viewRange()')
    check(box_view == [-1, 11] and b.eval('__app.state.init.params.k0') == 2, f'the infinite well is drawn from -1 to 11 ({box_view}), its packet at k0 = 2')
    click_start(b, 'n = 1')
    note = b.eval("document.querySelector('#state-box .note').textContent")
    check(note.startswith('19 stationary states (n = 1 to 19)'), f'the note says how the levels are numbered: "{note}"')
    levels = b.eval(LEVELS)
    beat = 2 * math.pi / (levels[1] - levels[0])
    check(abs(levels[0] - math.pi ** 2 / 200) < 1e-6 and abs(beat - 42.4) < 0.2, f'E_1 = pi^2/2L^2 = {levels[0]:.5f}; 1 + 2 sloshes with period 2 pi / (E_2 - E_1) = {beat:.1f} (the help says 42)')
    b.eval("document.querySelector('#play').click()"); b.sleep(1.0); pause(b)
    b.screenshot('build/s1d-box.png')
    choose(b, 'free')
    check(b.eval('__app.viewRange()') == [-37.5, 37.5], 'the free particle is drawn without walls')
    check(b.eval("document.getElementById('hint-levels').hidden"), 'the hint does not offer levels to click where there are none (free)')

    # The finite well: one packet on a transmission resonance, one off it; the symmetric ground
    # state has exactly half its probability on each side of x = 0.
    well = b.eval("__app.byId('well')")
    V0, a = well['params']['V0'], well['params']['a']
    choose(b, 'well')
    ro = b.eval("document.querySelector('#readouts').textContent")
    check('P(x < 0) 0.500' in ro and 'P(x > 0) 0.500' in ro and len(b.eval(LEVELS)) == 3,
          f'the well\'s ground state (one of 3 bound states) reads P(x < 0) = P(x > 0) = 0.500 ({ro[ro.index("P(x"):]})')
    for label, t_end in [('On resonance', 30), ('Off resonance', 50)]:
        click_start(b, label); pause(b)
        k0, sigma = b.eval('__app.state.init.params.k0'), b.eval('__app.state.init.params.sigma')
        run_to(b, t_end)
        T = b.eval(PASSED)
        want = packet_T(V0, a, k0, sigma)
        n = 2 * a * math.sqrt(k0 * k0 + 2 * V0) / math.pi
        check(abs(T - want) < 0.01 and (T > 0.97 if label == 'On resonance' else T < 0.4),
              f'{label}: 2ak\'/pi = {n:.3f}, transmitted {T:.4f}, square-well T(E) over the packet {want:.4f}')
        b.eval('__app.restart()'); run_to(b, 12 if label == 'On resonance' else 26)
        b.eval("document.querySelector('#play').click()"); b.sleep(0.1); pause(b)
        b.screenshot(f"build/s1d-well-{label.split()[0].lower()}.png")

    # The numbers the other experiments quote, as the running page gives them.
    choose(b, 'barrier')
    E = b.eval(OBS)['E']; run_to(b, 40); T = b.eval(PASSED)
    check(E < 2 and abs(T - 0.39) < 0.01, f'tunnelling: <E> = {E:.3f} below the barrier top 2, transmitted {T:.3f} (the help says 0.39)')
    b.eval("document.querySelector('#view').value = 'current'; document.querySelector('#view').dispatchEvent(new Event('change'))"); b.sleep(0.2)
    key = b.eval("(() => { const k = document.getElementById('key-current'); return k.hidden ? '' : k.textContent; })()")
    check('flowing right' in key and 'flowing left' in key, f'the current view\'s key says which colour flows which way ("{key.strip()}")')
    J = b.eval("(() => { const j = __app.sim.current(); let r = 0, l = 0; const s = __app.sim; for (let i = 0; i < s.n; i++) { if (s.x[i] > 0.5) r += j[i]; else if (s.x[i] < -0.5) l += j[i]; } return [r * s.dx, l * s.dx]; })()")
    check(J[0] > 0 and J[1] < 0, f'the current flows right beyond the barrier and left in the reflected packet ({J[0]:.3f}, {J[1]:.3f})')
    b.eval("document.querySelector('#view').value = 'density'; document.querySelector('#view').dispatchEvent(new Event('change'))"); b.sleep(0.2)
    check(b.eval("document.getElementById('key-current').hidden"), 'back in the density view the current key is gone')
    choose(b, 'step'); click_start(b, 'Above the step'); pause(b)
    run_to(b, 40); R = 1 - b.eval(PASSED)
    k0 = b.eval('__app.state.init.params.k0'); kp = math.sqrt(k0 * k0 - 2 * 2)
    check(abs(kp - 1.33) < 0.005 and abs(((k0 - kp) / (k0 + kp)) ** 2 - 0.083) < 0.001 and abs(R - 0.094) < 0.003,
          f"over the step: k' = {kp:.3f}, plane-wave R = {((k0 - kp) / (k0 + kp)) ** 2:.4f}, the packet's P(x < 0) ends at {R:.4f} (the help says 0.083 and 0.094)")
    choose(b, 'double')
    levels = b.eval(LEVELS); dE = levels[1] - levels[0]
    check(abs(dE - 0.112) < 0.001 and abs(2 * math.pi / dE - 56) < 0.5, f'double well: dE = {dE:.4f}, period {2 * math.pi / dE:.1f} (the help says 0.112 and 56)')
    choose(b, 'bouncer')
    levels = b.eval(LEVELS)
    check(abs(levels[0] - 1.856) < 0.001 and abs(levels[0] - 2.33810741 / 2 ** (1 / 3)) < 1e-4, f'bouncer: the lowest level is {levels[0]:.4f} (the first Airy zero gives 1.8558; the help says 1.856)')
    choose(b, 'lattice')
    TB = 2 * math.pi / (0.25 * 1)
    run_to(b, TB / 2); x_half = b.eval(OBS)['x']
    run_to(b, TB); x_full = b.eval(OBS)['x']
    check(x_half < -12 and abs(x_full) < 1.5, f'Bloch: <x> = {x_half:.1f} at half of 2 pi / F a = {TB:.1f}, back to {x_full:.2f} at the whole (the help says 25 and about 16)')
    choose(b, 'delta')
    levels = b.eval(LEVELS)
    check(len(levels) == 1 and abs(levels[0] + 0.465) < 0.002, f'delta: one bound state at {levels[0]:.4f} (the help says -0.465, above -alpha^2/2 = -0.5)')
    click_start(b, 'Moving'); pause(b)
    run_to(b, 40); T = b.eval(PASSED)
    check(abs(T - 0.51) < 0.01, f'delta: the packet at k = alpha = 1 is transmitted {T:.3f} (the help says 0.51; a true delta gives 0.5)')

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
    sx = b.eval('__app.sim.observables().sx')
    check(abs(sx - 0.05) < 0.005, f'measuring the position localises the particle to sigma = {sx:.3f} (the help says 0.05, a two-hundredth of the box)')
    # A link to a set-up lights the named state it holds.
    init = json.dumps({'kind': 'packet', 'params': {'x0': -14, 'sigma': 2.5, 'k0': 1.19}})
    b.eval(f"location.hash = 'pot=well&init=' + encodeURIComponent({json.dumps(init)}); location.reload()")
    b.sleep(1.0); b.wait('window.__app && __app.ready')
    check(lit(b) == [['Off resonance', True]], f'a link to the finite well with that packet lights Off resonance ({lit(b)})')

    # Backwards pauses at t = 0 exactly, on the starting packet; Play again goes on into negative
    # time, the packet's past: further left, and wider (a Gaussian with no chirp is narrowest at 0).
    b.eval('__app.setups.backwards()'); b.sleep(0.3)
    back = b.eval("""(() => { const play = document.querySelector('#play'); if (!__app.state.running) play.click();
        let i = 0; for (; i < 1000 && __app.state.running; i++) __app.advance(-0.5);
        const o = __app.sim.observables(); return { t: __app.sim.t, running: __app.state.running, x: o.x, sx: o.sx, i }; })()""")
    check(back['t'] == 0 and not back['running'] and abs(back['x'] + 25) < 0.05 and abs(back['sx'] - 4) < 0.05,
          f"Backwards pauses at t = 0 exactly, on the starting packet (t = {back['t']}, <x> = {back['x']:.3f}, sigma = {back['sx']:.3f})")
    past = b.eval("""(() => { const play = document.querySelector('#play'); play.click();
        for (let i = 0; i < 1000 && __app.sim.t > -3 + 1e-9; i++) __app.advance(Math.max(-0.5, -3 - __app.sim.t));
        const o = __app.sim.observables(), r = { t: __app.sim.t, running: __app.state.running, x: o.x, sx: o.sx, norm: o.norm };
        play.click(); return r; })()""")
    check(abs(past['t'] + 3) < 1e-9 and past['running'] and abs(past['x'] - (-25 - 1.8 * 3)) < 0.1
          and abs(past['sx'] - 4 * math.sqrt(1 + (3 / 32) ** 2)) < 0.02 and abs(past['norm'] - 1) < 1e-9,
          f"Play goes on into negative time: at t = {past['t']:.2f} the packet is at {past['x']:.2f} (−30.4) and {past['sx']:.4f} wide ({4 * math.sqrt(1 + (3 / 32) ** 2):.4f})")
    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))

# The dark theme at desktop size: the first screen reads there too.
with Browser('about:blank', size=(1400, 950)) as b:
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
    b.goto('schrodinger1d/index.html')
    b.wait('window.__app && __app.ready'); b.sleep(1.5)
    first_screen(b, 'desktop, dark')
    b.screenshot('build/s1d-dark.png')

# A phone-sized window: the opening screen, with the pictures and the hint before the controls.
with Browser('schrodinger1d/index.html', size=(390, 844)) as b:
    b.wait('window.__app && __app.ready'); b.sleep(1.5)
    w = b.eval('document.documentElement.scrollWidth')
    check(w <= 390, f'phone: no horizontal scrolling (page width {w})')
    first_screen(b, 'phone, light')
    order = b.eval("[...document.querySelectorAll('main > *, main .plots > *')].map((e) => e.id || e.className.split(' ')[0])")
    check(order.index('readouts') < order.index('plot-wrap') < order.index('hint') < order.index('mom-wrap') < order.index('controls'),
          f'phone: the readouts, the picture, the hint and the momentum plot come before the controls ({order})')
    b.screenshot('build/s1d-phone.png')
    errors = [c for c in b.console if c.startswith(('EXCEPTION', 'error'))]
    check(not errors, 'phone: no exceptions' + ('' if not errors else ': ' + '; '.join(errors[:3])))
print(f"SUMMARY: {'all passed' if not failures else str(len(failures)) + ' failed'}")
sys.exit(1 if failures else 0)
