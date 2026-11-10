#!/usr/bin/env python3
"""Drive the radio interferometry demo: the first screen (running, the hint, Start here first,
the theory last), all four views and all 26 experiments, the numbers the help quotes measured in
the page, dragging everything that can be dragged, the menu of ways to make the image and its
strip, the readouts keeping still, the address (and the old antenna-arrays demo's synthesis
set-ups, which now lead here), both themes and a phone.

Nothing here waits on the clock except one check that the page opens running: the page's time
is held and stepped from here (__app.hold, __app.step), one chunk of the correlator a frame.  The
time a frame takes is printed, not checked (the machine is shared)."""
import json, math, os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from cdp import Browser

failures = []
def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond: failures.append(msg)

SETUPS = ['noise', 'lag', 'white', 'envelope', 'independent', 'fringe', 'twosources', 'young', 'delay',
          'stripes', 'uv', 'picture', 'sketch', 'nearfield', 'coherent', 'hbt', 'hbtsketch',
          'line', 'array', 'rotation', 'resolution', 'eht', 'dirty', 'clean', 'mem', 'compare']
VIEW = {**{n: 'one' for n in SETUPS[:5]}, **{n: 'two' for n in SETUPS[5:9]}, **{n: 'uv' for n in SETUPS[9:17]}, **{n: 'array' for n in SETUPS[17:]}}
# The old antenna-arrays demo's synthesis set-ups, and the view each should open here.
ALIASES = {'fringe': 'two', 'six': 'array', 'rotation': 'array', 'ellipses': 'array', 'equator': 'array',
           'resolution': 'array', 'shortspacing': 'array', 'eht': 'array', 'clean': 'array'}
HINT_OF = {'one': '#hint-one', 'two': '#hint-two', 'uv': '#hint-uv', 'array': '#hint-uv'}
MAIN_OF = {'one': '#stream1', 'two': '#scene', 'uv': '#uv', 'array': '#uv'}

def setup(b, name, frames=0):
    b.eval(f'__app.runSetup({json.dumps(name)})')
    b.eval(f'__app.step({frames})' if frames else '__app.draw()')

def norm(s):
    """Text with its minus signs, spaces and thin spaces made plain, for matching numbers."""
    s = s.translate(str.maketrans('₀₁₂₃₄₅₆₇₈₉', '0123456789'))   # (rendered MathML writes ν₀ as ν0)
    return re.sub(r'[\s\u2009\u202f\u00a0]+', ' ', s.replace('−', '-'))
def help_text(b, name):
    return norm(b.eval(f"document.querySelector('.exp[data-setup={json.dumps(name)}]').textContent"))
def quoted(v, text):
    """v rounds to the number quoted as text (to as many decimals as it has)."""
    t = text.replace(',', '').replace('−', '-')
    digits = len(t.split('.')[1]) if '.' in t else 0
    return round(v + 0.0, digits) == round(float(t), digits)
def says(b, name, *phrases):
    t = help_text(b, name)
    missing = [p for p in phrases if norm(p) not in t]
    return not missing, missing
def visible_hints(b):
    return b.eval("[...document.querySelectorAll('.hint')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().height > 0).map((e) => [e.id, e.textContent.trim(), e.getBoundingClientRect().bottom])")
def errors(b):
    return [c for c in b.console if 'EXCEPTION' in c or c.startswith('error')]
CONTRAST = r"""((sel, bgSel) => { const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g).map(Number);
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  const fg = getComputedStyle(document.querySelector(sel)).color, bg = getComputedStyle(document.querySelector(bgSel)).backgroundColor;
  const a = lum(fg), c = lum(bg); return Math.round(((Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05)) * 10) / 10; })"""

times = {}
with Browser('radiointerferometer/index.html', size=(1400, 900)) as b:
    b.wait('window.__app && __app.ready', timeout=90)
    # ---------------------------------------------------------------- the first screen
    # It opens running: noise flowing, the correlator averaging (the one check on the clock).
    b.wait('__app.sim.chunks > 3 && __app.anim.t > 200', timeout=60)
    b.eval('__app.hold(true)')
    s = b.eval('({ view: __app.state.view, band: __app.state.band, lag: __app.state.lag, chunks: __app.sim.chunks })')
    check(s['view'] == 'one' and s['band'] == 0.05 and s['lag'] == 0, f"it opens on view 1, one source's noise at a 5% band, already running ({s['chunks']} chunks averaged)")
    b.eval('__app.draw()')
    hints = visible_hints(b)
    check(len(hints) == 1 and hints[0][0] == 'hint-one' and hints[0][1].startswith('Drag the lag τ') and hints[0][2] <= 900,
          f'one hint, under the noise, says what to drag, on the first screen ({hints[0][1][:40]}…, bottom at {hints[0][2]:.0f} px)')
    check('→' in b.eval("getComputedStyle(document.querySelector('#hint-one'), '::before').content"), 'the hint has its arrow')
    dr = b.eval("""(() => { const d = document.querySelector('#help'), kids = [...d.children], first = kids[1];
        return { first: first.className + ':' + (first.querySelector('h3') || {}).textContent, math: first.querySelectorAll('math').length,
          paras: first.querySelectorAll('p').length, words: first.textContent.split(/\\s+/).length,
          theoryLast: kids.findIndex((e) => e.classList.contains('theory')) > kids.findLastIndex((e) => e.classList.contains('exp')),
          exps: [...d.querySelectorAll('.exp[data-setup]')].map((e) => e.dataset.setup),
          buttons: d.querySelectorAll('.exp .setup').length }; })()""")
    check(dr['first'] == 'start:Start here' and dr['math'] == 0 and 3 <= dr['paras'] <= 5, f"the drawer opens with Start here, in {dr['paras']} paragraphs ({dr['words']} words) and no equations")
    check(dr['theoryLast'], 'the theory comes last, under How it works')
    check(dr['exps'] == SETUPS and dr['buttons'] == len(SETUPS), f"{len(SETUPS)} experiments, in order, each with a Set it up button")
    check(set(SETUPS) <= set(b.eval('Object.keys(__app.setups)')), 'every experiment’s name is a set-up (#setup= links)')
    b.screenshot('build/rif-start.png')

    # ---------------------------------------------------------------- every set-up opens
    for name in SETUPS:
        b.console.clear()
        setup(b, name, 60)
        t = b.eval('(() => { const t0 = performance.now(); for (let i = 0; i < 20; i++) __app.step(1); return (performance.now() - t0) / 20; })()')
        times.setdefault(VIEW[name], []).append(t)
        v = b.eval('__app.state.view')
        e = errors(b)
        hints = visible_hints(b)
        check(v == VIEW[name] and not e and len(hints) == 1 and hints[0][0] == HINT_OF[v][1:], f'{name}: view {v}, its hint, no errors ({t:.1f} ms a frame)' + (f' {e[:2]}; hints {[h[0] for h in hints]}' if e or len(hints) != 1 else ''))
    # (The machine is shared, so single set-ups' times jump about: the typical one is checked.)
    for v, ts in times.items():
        med = sorted(ts)[len(ts) // 2]
        print(f'info  view {v}: a frame (one chunk, everything drawn) takes {med:.1f} ms for the typical set-up, {max(ts):.1f} at most')

    # ---------------------------------------------------------------- 1 · one source
    setup(b, 'noise', 30)
    bw = b.eval('__app.bandwidth()')
    ok, miss = says(b, 'noise', '5% as wide', 'Δν = 45 MHz', '20 cycles', '(22 ns)', '100 cycles')
    check(ok and quoted(bw * 915, '45') and quoted(1 / bw, '20') and quoted(1 / bw / 0.915, '22'),
          f'noise: the band made is {bw * 100:.2f}% = {bw * 915:.1f} MHz; the coherence time 1/Δν = {1 / bw:.1f} cycles = {1 / bw / 0.915:.1f} ns (help: 45 MHz, 20 cycles, 22 ns)' + (f' missing {miss}' if miss else ''))
    b.eval('__app.setBand(0.01)'); b.eval('__app.step(1)')
    c = b.eval('1 / __app.bandwidth()')
    check(abs(c - 100) < 5, f'noise: at 1% the lumps last {c:.1f} cycles (help: 100)')
    # The time stream: the noise, an envelope, lumps; and the copy τ later sits on it at τ = 0.
    setup(b, 'lag', 400)
    r = b.eval('__app.view1()')
    ok, miss = says(b, 'lag', 'half a cycle', 'R=-0.999', '20 cycles')
    # What it should be: cos(π) times the band's coherence half a cycle out.
    R_true = b.eval('-__app.sim.coherence(0.5)')
    # A running average of noise: it scatters about that by ~1/sqrt(N), N ~ 25 independent
    # stretches per chunk x ~60 chunks in the IIR: 0.026.  Allow 4 sigma.
    check(ok and quoted(R_true, '-0.999') and abs(r['longRun'] - R_true) < 0.1, f"lag: at τ = ½ cycle R = {R_true:.4f} (help: −0.999); the correlator's average {r['longRun']:.3f}, within its scatter of ~0.03; this stretch's own average {r['mean']:.2f}" + (f' missing {miss}' if miss else ''))
    z = b.eval('(() => { const B = __app.bandwidth(); return [__app.sim.coherence(1 / B), __app.sim.coherence(0.9 / B)]; })()')
    check(abs(z[0]) < 1e-9 and z[1] > 0.05, f'lag: the envelope first reaches zero at exactly τ = 1/Δν (coherence {z[0]:.1e} there, {z[1]:.2f} at 0.9/Δν)')
    # Dragging the lag along the autocorrelation; the dot follows the curve.
    b.drag('#lag1', (0.5, 0.5), (0.58, 0.5)); b.eval('__app.step(1)')
    lag = b.eval('__app.state.lag')
    check(lag > 5, f'dragging on the autocorrelation sets the lag (τ = {lag:.2f} cycles)')
    b.drag('#spec1', (0.8, 0.3), (0.83, 0.3)); b.eval('__app.step(1)')
    band = b.eval('__app.state.band')
    check(abs(band - 0.05) > 0.01, f"dragging the band's edge on the spectrum sets the band ({band:.3f})")
    setup(b, 'white', 60)
    bw = b.eval('__app.bandwidth()')
    b.eval('__app.setBand(0.2)'); b.eval('__app.step(1)')
    c20 = b.eval('1 / __app.bandwidth()')
    ok, miss = says(b, 'white', '0 to 2ν₀', 'half a cycle', '20%', '5 cycles')
    check(ok and bw > 1.99 and abs(1 / bw - 0.5) < 0.01 and abs(c20 - 5) < 0.25, f'white: the band is {bw:.3f} ν₀ wide, its autocorrelation a spike {1 / bw:.2f} cycle wide; at 20% the lumps last {c20:.2f} cycles' + (f' missing {miss}' if miss else ''))
    setup(b, 'envelope', 60)
    check(b.eval("__app.state.display") == 'complex', 'envelope: the complex envelope (I and Q) is shown')
    setup(b, 'independent', 600)
    r = b.eval('__app.view1()')
    cross = b.eval('(() => { __app.sim.lags(60, 241); let m = 0, a = 0; for (let p = 0; p < 241; p++) { m = Math.max(m, Math.hypot(__app.sim.lagAB[0][p], __app.sim.lagAB[1][p])); a = Math.max(a, __app.sim.lagAA[0][p]); } return [m, a]; })()')
    check(abs(r['longRun']) < 0.1 and cross[0] < 0.15 and cross[1] > 0.85, f"independent: two independent noises' product averages to {r['longRun']:.3f}, their correlation at most {cross[0]:.3f} at any lag (each one's own: {cross[1]:.2f})")

    # ---------------------------------------------------------------- 2 · two sources, two antennas
    setup(b, 'fringe', 300)
    f = b.eval("""(() => { const s = __app.sim, st = __app.state, L = __app.lambda(), id = s.ideal(...s.baseline()); let lo = 1e9, hi = -1e9;
      for (let i = 0; i <= 160; i++) { const p = s.powerAt({ u: (-4 + i / 20) / L, v: 0 }, 1); lo = Math.min(lo, p); hi = Math.max(hi, p); }
      return { D: st.scene.xB - st.scene.xA, L, early: s.delay(0, 0)[0] - s.delay(1, 0)[0], ph: Math.atan2(id[1], id[0]) * 180 / Math.PI,
        turn: L / Math.sin(10 * Math.PI / 180), mag: Math.hypot(...s.avg), mph: Math.atan2(s.avg[1], s.avg[0]) * 180 / Math.PI, spread: hi - lo, pB: s.powerB }; })()""")
    ok, miss = says(b, 'fringe', '10°', '20 cm apart', '32.8 cm', '0.106 wavelengths', '0.106 cycles before A', '−38°', '1.89 m')
    check(ok and quoted(f['D'] * 100, '20') and quoted(f['L'] * 100, '32.8') and quoted(f['early'], '0.106') and quoted(f['ph'], '-38') and quoted(f['turn'], '1.89'),
          f"fringe: D = {f['D']:.2f} m, B nearer the source by {f['early']:.3f} wavelengths, V's phase {f['ph']:.1f}°, a turn every {f['turn']:.3f} m" + (f' missing {miss}' if miss else ''))
    check(abs(f['mag'] - 1) < 0.12 and abs(f['mph'] - f['ph']) < 10, f"fringe: the dot settles at {f['mag']:.2f}, {f['mph']:.0f}° (V: 1, {f['ph']:.0f}°)")
    check(f['spread'] < 1e-9 and abs(f['pB'] - 1.3) < 0.1, f"fringe: the power at B is the same everywhere ({f['spread']:.1e} between the largest and the smallest; measured {f['pB']:.2f}, 1 + the noise 0.3)")
    foot = b.eval("document.querySelector('#fringe-foot').textContent")
    check('0.106 cycles before A' in norm(foot), f'fringe: the read-out says when B hears it ({norm(foot)[-40:]})')
    # Left from right: at −10° the real part is the same and the phase is +38°.
    lr = b.eval("""(() => { const s = __app.sim, a = s.ideal(...s.baseline()); __app.state.scene.sources[0].theta = -10; __app.moveScene(); const z = s.ideal(...s.baseline());
      __app.state.scene.sources[0].theta = 10; __app.moveScene(); return [a[0], z[0], Math.atan2(z[1], z[0]) * 180 / Math.PI]; })()""")
    ok, miss = says(b, 'fringe', 'to −10°', 'at +38°', 'quarter cycle')
    check(ok and abs(lr[0] - lr[1]) < 1e-12 and quoted(lr[2], '38'), f"fringe: a source at −10° gives the same real part ({lr[0]:.4f}, {lr[1]:.4f}) and the phase {lr[2]:+.1f}°" + (f' missing {miss}' if miss else ''))
    # Dragging B along the ground winds the phase; dragging on the fringe plot moves B too.
    before = b.eval('__app.state.scene.xB')
    x, y, w, h = b.box('#scene')
    sx = b.eval('__app.sceneX(__app.state.scene.xB)'); gy = b.eval('__app.scene().groundY')
    b.mouse('mouseMoved', x + sx, y + gy - 14); b.mouse('mousePressed', x + sx, y + gy - 14, 1, 'left')
    for k in range(1, 9): b.mouse('mouseMoved', x + sx + 15 * k, y + gy - 14, 1, 'left')
    b.mouse('mouseReleased', x + sx + 120, y + gy - 14, 0, 'left')
    b.eval('__app.step(1)')
    after = b.eval('__app.state.scene.xB')
    check(after - before > 0.5, f'dragging antenna B along the ground moves it ({before:.2f} → {after:.2f} m)')
    b.drag('#fringe', (0.3, 0.5), (0.2, 0.5)); b.eval('__app.step(1)')
    check(b.eval('__app.state.scene.xB') < after - 0.5, 'dragging on the fringe plot moves B')
    th = b.eval('__app.state.scene.sources[0].theta')
    sp = b.eval('__app.sourcePoint(__app.state.scene.sources[0].theta)')
    b.mouse('mouseMoved', x + sp[0], y + sp[1]); b.mouse('mousePressed', x + sp[0], y + sp[1], 1, 'left')
    for k in range(1, 7): b.mouse('mouseMoved', x + sp[0] + 12 * k, y + sp[1] + 3 * k, 1, 'left')
    b.mouse('mouseReleased', x + sp[0] + 72, y + sp[1] + 18, 0, 'left'); b.eval('__app.step(1)')
    check(b.eval('__app.state.scene.sources[0].theta') > th + 5, 'dragging the source along the sky changes its angle')
    setup(b, 'twosources', 500)
    t2 = b.eval("""(() => { const s = __app.sim, e = s.expected(); let sx = 0, sy = 0; for (let k = 0; k < 2; k++) { sx += s.avgSelfK[2 * k]; sy += s.avgSelfK[2 * k + 1]; }
      return { src2: __app.state.scene.sources[1], cross: Math.hypot(...s.avgCross), selfErr: Math.hypot(sx - e[0], sy - e[1]), sigma: s.chunkScatter() }; })()""")
    ok, miss = says(b, 'twosources', 'half as bright, at −25°')
    check(ok and t2['src2']['theta'] == -25 and t2['src2']['I'] == 0.5, 'twosources: the second source, half as bright, at −25°' + (f' missing {miss}' if miss else ''))
    check(t2['cross'] < 0.1 and t2['selfErr'] < 0.15, f"twosources: the cross terms average away ({t2['cross']:.3f}; one chunk scatters {t2['sigma']:.2f}), each source's own terms add up to V (off by {t2['selfErr']:.3f})")
    setup(b, 'young', 300)
    y8 = b.eval("""(() => { const s = __app.sim, L = __app.lambda(); let lo = 1e9, hi = -1e9;
      for (let i = 0; i <= 800; i++) { const p = s.powerAt({ u: (-4 + i / 100) / L, v: 0 }, 1); lo = Math.min(lo, p); hi = Math.max(hi, p); }
      const A = s.receivers[0], B = s.receivers[1], d = 0.7 / L, e1 = s.expectedAt(A, B), e2 = s.expectedAt({ u: A.u + d, v: 0 }, { u: B.u + d, v: 0 });
      return { lo, hi, fringe: L / (Math.sin(10 * Math.PI / 180) - Math.sin(-25 * Math.PI / 180)), moved: Math.hypot(e1[0] - e2[0], e1[1] - e2[1]), pB: s.powerB, pBexp: s.powerAt(B, 1) }; })()""")
    ok, miss = says(b, 'young', 'from 0.4 to 3.2', '55 cm')
    check(ok and quoted(y8['lo'], '0.4') and quoted(y8['hi'], '3.2') and quoted(y8['fringe'] * 100, '55'),
          f"young: coherent sources make fringes in the power at one antenna, from {y8['lo']:.2f} to {y8['hi']:.2f}, {y8['fringe'] * 100:.1f} cm apart" + (f' missing {miss}' if miss else ''))
    check(abs(y8['pB'] - y8['pBexp']) < 0.25 and y8['moved'] > 0.3, f"young: the measured power at B {y8['pB']:.2f} (expected {y8['pBexp']:.2f}); moving the pair 0.7 m together changes the correlation by {y8['moved']:.2f}")
    setup(b, 'delay', 300)
    d9 = b.eval('(() => { const s = __app.sim; return { early: s.delay(0, 0)[0] - s.delay(1, 0)[0], exp: Math.hypot(...s.expected()), avg: Math.hypot(...s.avg), bw: __app.bandwidth() }; })()')
    ok, miss = says(b, 'delay', '30°', '40%', '2.5 cycles', '3 m', '4.6 cycles', '(0.09)')
    check(ok and quoted(d9['early'], '4.6') and quoted(d9['exp'], '0.09') and abs(d9['avg'] - d9['exp']) < 0.06 and quoted(1 / d9['bw'], '2.5'),
          f"delay: without tracking B hears it {d9['early']:.2f} cycles before A, and the correlation is {d9['avg']:.3f} (expected {d9['exp']:.3f})" + (f' missing {miss}' if miss else ''))
    check(b.eval("document.querySelector('#cap-vA2').textContent") == 'Antenna A hears', 'delay: without tracking the streams are what the antennas hear')
    b.eval("document.querySelector('#pair-row button').click()"); b.eval('__app.step(300)')
    d9b = b.eval('({ avg: Math.hypot(...__app.sim.avg), ph: Math.atan2(__app.sim.avg[1], __app.sim.avg[0]) * 180 / Math.PI, track: __app.state.tracking, cap: document.querySelector("#cap-vB2").textContent })')
    check(d9b['track'] and d9b['avg'] > 0.9 and abs(d9b['ph']) < 8 and 'electronic delay' in d9b['cap'],
          f"delay: with delay tracking the dot comes back to {d9b['avg']:.2f} at {d9b['ph']:.0f}°, and the streams are labelled as after the electronic delay")

    # ---------------------------------------------------------------- 3 · the uv plane
    setup(b, 'stripes', 400)
    st = b.eval("""(() => { const s = __app.sim, [u, v] = s.baseline(), m = __app.skyModel().sources[0], a = -2 * Math.PI * (u * m.l + v * m.m), id = __app.idealAt(u, v);
      return { stripe: Math.atan2(Math.sin(a), Math.cos(a)) * 180 / Math.PI, ideal: Math.atan2(id[1], id[0]) * 180 / Math.PI, avg: Math.atan2(s.avg[1], s.avg[0]) * 180 / Math.PI, mag: Math.hypot(...s.avg) }; })()""")
    dd = (st['avg'] - st['ideal'] + 540) % 360 - 180
    check(abs(st['stripe'] - st['ideal']) < 1e-6 and abs(dd) < 12 and abs(st['mag'] - 1) < 0.15,
          f"stripes: the source sits on the stripe of phase {st['stripe']:.1f}°, V's phase; the dot settles at {st['avg']:.0f}°, size {st['mag']:.2f}")
    setup(b, 'uv', 400)
    u3 = b.eval("""(() => { const s = __app.sim, [u, v] = s.baseline(), id = __app.idealAt(u, v), e = s.expected();
      return { err: Math.hypot(s.avg[0] - e[0], s.avg[1] - e[1]), smear: Math.hypot(e[0] - id[0], e[1] - id[1]), sigma: s.chunkScatter(), avgN: __app.state.avg, n: __app.skyModel().sources.length }; })()""")
    tol = 4 * u3['sigma'] / math.sqrt(2 * u3['avgN'] - 1)
    check(u3['n'] == 5 and u3['err'] < tol and u3['smear'] < 0.05, f"uv: the pentagon; the dot is {u3['err']:.3f} from what the correlator converges to (4σ of its average: {tol:.3f}), which is {u3['smear']:.3f} from V")
    # Dragging the ● (and the ○, which moves the pair the other way) and a source.
    b0 = b.eval('__app.baseline()')
    pt = b.eval('(() => { const g = __app.area().uv, [u, v] = __app.baseline(), U = __app.uvMax(); return [g.x + (0.5 + u / (2 * U)) * g.s, g.y + (0.5 - v / (2 * U)) * g.s]; })()')
    x, y, w, h = b.box('#uv')
    b.mouse('mouseMoved', x + pt[0], y + pt[1]); b.mouse('mousePressed', x + pt[0], y + pt[1], 1, 'left')
    for k in range(1, 7): b.mouse('mouseMoved', x + pt[0] + 6 * k, y + pt[1] - 4 * k, 1, 'left')
    b.mouse('mouseReleased', x + pt[0] + 36, y + pt[1] - 24, 0, 'left'); b.eval('__app.step(1)')
    b1 = b.eval('__app.baseline()')
    check(b1[0] > b0[0] + 1 and b1[1] > b0[1] + 0.5, f'dragging the ● sets the baseline (u, v): ({b0[0]:.1f}, {b0[1]:.1f}) → ({b1[0]:.1f}, {b1[1]:.1f})')
    mirror = b.eval('(() => { const g = __app.area().uv, [u, v] = __app.baseline(), U = __app.uvMax(); return [g.x + (0.5 - u / (2 * U)) * g.s, g.y + (0.5 + v / (2 * U)) * g.s]; })()')
    b.mouse('mouseMoved', x + mirror[0], y + mirror[1]); b.mouse('mousePressed', x + mirror[0], y + mirror[1], 1, 'left')
    b.mouse('mouseMoved', x + mirror[0] - 20, y + mirror[1], 1, 'left'); b.mouse('mouseReleased', x + mirror[0] - 20, y + mirror[1], 0, 'left'); b.eval('__app.step(1)')
    b2 = b.eval('__app.baseline()')
    check(b2[0] > b1[0] + 0.5, f'dragging the mirror ○ moves the pair the opposite way (u {b1[0]:.1f} → {b2[0]:.1f})')
    s0 = b.eval('__app.skyModel().sources[0].l')
    sp = b.eval('(() => { const g = __app.area().sky, q = __app.skyModel().sources[0], F = __app.fov(); return [g.x + (0.5 + q.l / F) * g.s, g.y + (0.5 - q.m / F) * g.s]; })()')
    x, y, w, h = b.box('#sky')
    b.mouse('mouseMoved', x + sp[0], y + sp[1]); b.mouse('mousePressed', x + sp[0], y + sp[1], 1, 'left')
    b.mouse('mouseMoved', x + sp[0] + 25, y + sp[1], 1, 'left'); b.mouse('mouseReleased', x + sp[0] + 25, y + sp[1], 0, 'left'); b.eval('__app.step(1)')
    check(b.eval('__app.skyModel().sources[0].l') > s0 + 0.03 and b.eval('__app.sim.sources[0].l') == b.eval('__app.skyModel().sources[0].l'), 'dragging a source on the sky moves it, in the correlator too')
    # Sliding the pair keeps its separation: incoherent and far, the correlation stays (exactly).
    flat = b.eval("""(() => { const s = __app.sim, L = __app.lambda(), p = __app.state.pair, z = []; for (const c of [-2, 0, 2]) z.push(s.expectedAt({ u: (c - p.bx / 2) / L, v: -p.by / 2 / L }, { u: (c + p.bx / 2) / L, v: p.by / 2 / L })); return Math.max(...z.map((q) => Math.hypot(q[0] - z[1][0], q[1] - z[1][1]))); })()""")
    check(flat < 1e-9, f'uv: sliding the pair, its separation kept, changes nothing for far incoherent sources ({flat:.1e})')
    cx0 = b.eval('__app.state.pair.cx')
    b.drag('#slide3', (0.5, 0.5), (0.75, 0.5)); b.eval('__app.step(1)')
    check(b.eval('__app.state.pair.cx') > cx0 + 0.5, 'dragging on the slide plot slides the pair')
    gp = b.eval('__app.state.pair')
    b.eval('__app.runSetup("uv")')
    setup(b, 'picture', 300)
    pc = b.eval("""(() => { let prev = 1e9, first = null; for (let i = 0; i <= 1200; i++) { const u = i * 0.01, m = Math.hypot(...__app.idealAt(u, 0)); if (first === null && m > prev) first = u - 0.01; prev = m; }
      const sky = __app.skyModel().sky, n = 128; let area = 0, top = 0; for (const q of sky) top = Math.max(top, q); for (const q of sky) area += q / top; const r = Math.sqrt(area / Math.PI);
      return { first, metres: first * __app.lambda(), D: 2 * Math.asin(r / n) * 180 / Math.PI, Dl: 2 * r / n }; })()""")
    ok, miss = says(b, 'picture', '9.2°', '7.6 wavelengths', '2.5 m')
    check(ok and abs(pc['D'] - 9.2) < 0.15 and quoted(pc['first'], '7.6') and quoted(pc['metres'], '2.5') and abs(pc['first'] - 1.22 / pc['Dl']) < 0.15,
          f"picture: a disk {pc['D']:.2f}° across; the first dark ring at {pc['first']:.2f} wavelengths = {pc['metres']:.2f} m (1.22/D = {1.22 / pc['Dl']:.2f})" + (f' missing {miss}' if miss else ''))
    check(b.eval('__app.sim.sources.length') == 200, 'picture: the correlator uses 200 points drawn from the picture')
    setup(b, 'sketch', 5)
    b.eval("[...document.querySelectorAll('#sketch-row button')].find((e) => e.textContent === 'Autopilot').click()")
    for _ in range(31): b.eval('__app.step(100)')
    sk = b.eval("""(() => { const img = __app.paintedImage(), N = 256, o = 64, F = __app.fov(), pix = F / 128, src = __app.skyModel().sources;
      let mx = 0, at = 0; for (let j = o; j < o + 128; j++) for (let i = o; i < o + 128; i++) if (img[j * N + i] > mx) { mx = img[j * N + i]; at = j * N + i; }
      const near = src.map((q) => { const ci = o + 64 + q.l / pix, cj = o + 64 - q.m / pix; let m = -1e9; for (let j = Math.round(cj) - 2; j <= Math.round(cj) + 2; j++) for (let i = Math.round(ci) - 2; i <= Math.round(ci) + 2; i++) m = Math.max(m, img[j * N + i]); return m / mx; });
      return { cells: __app.paint().cells, autopilot: __app.state.autopilot, near }; })()""")
    check(sk['cells'] > 2000 and not sk['autopilot'] and min(sk['near']) > 0.75, f"sketch: the autopilot paints {sk['cells']} cells, and the image from them is brightest at the triangle's three sources ({', '.join(f'{v:.2f}' for v in sk['near'])} of its peak)")
    setup(b, 'nearfield', 60)
    nf = b.eval("""(() => { const s = __app.sim, e = s.expected(), [u, v] = s.baseline(), V = __app.idealAt(u, v), p = __app.state.pair, L = __app.lambda(); let lo = 1e9, hi = -1e9;
      for (let i = 0; i <= 200; i++) { const c = -1 + i / 100, z = s.expectedAt({ u: (c - p.bx / 2) / L, v: 0 }, { u: (c + p.bx / 2) / L, v: 0 }); lo = Math.min(lo, z[0]); hi = Math.max(hi, z[0]); }
      return { e: Math.hypot(...e), V: Math.hypot(...V), lo, hi, D2L: p.bx ** 2 / L, z: __app.skyModel().sources[0].z }; })()""")
    ok, miss = says(b, 'nearfield', '5 m above', '12 m', '(4.13)', '2.72', '−2.3 and 2.7')
    check(ok and nf['z'] == 5 and quoted(nf['D2L'], '12') and quoted(nf['V'], '4.13') and quoted(nf['e'], '2.72') and quoted(nf['lo'], '-2.3') and quoted(nf['hi'], '2.7'),
          f"nearfield: D²/λ = {nf['D2L']:.1f} m; the far-field V {nf['V']:.2f}, the exact distances give {nf['e']:.2f}; sliding a metre either way, the real part goes from {nf['lo']:.2f} to {nf['hi']:.2f}" + (f' missing {miss}' if miss else ''))
    setup(b, 'coherent', 300)
    co = b.eval("""(() => { const s = __app.sim, e = s.expected(), [u, v] = s.baseline(), V = __app.idealAt(u, v), p = __app.state.pair, L = __app.lambda(); let lo = 1e9, hi = -1e9;
      for (let i = 0; i <= 120; i++) { const c = -3 + i / 20, z = s.expectedAt({ u: (c - p.bx / 2) / L, v: -p.by / 2 / L }, { u: (c + p.bx / 2) / L, v: p.by / 2 / L }); lo = Math.min(lo, z[0]); hi = Math.max(hi, z[0]); }
      return { off: Math.hypot(e[0] - V[0], e[1] - V[1]), err: Math.hypot(s.avg[0] - e[0], s.avg[1] - e[1]), range: hi - lo, phase: __app.state.cohPhase }; })()""")
    check(co['phase'] == 90 and co['off'] > 1 and co['err'] < 0.6 and co['range'] > 3, f"coherent: a quarter turn between neighbours; the dot settles {co['off']:.2f} away from V (on the ×, {co['err']:.2f} off), and sliding the pair changes it by up to {co['range']:.1f}")
    setup(b, 'hbt', 600)
    hb = b.eval("""(() => { const s = __app.sim, [u, v] = s.baseline(), V = __app.idealAt(u, v); return { m: s.avgHbt, V2: V[0] ** 2 + V[1] ** 2, mode: __app.state.mode, im: Math.max(...s.history.map((h) => Math.abs(h[1]))) }; })()""")
    check(abs(hb['m'] - hb['V2']) < 0.12 * max(1, hb['V2']) + 0.3 and hb['im'] == 0 and hb['mode'] == 'intensity', f"hbt: the intensity correlation {hb['m']:.2f} against |V|² = {hb['V2']:.2f}, every chunk on the real axis, the uv plane in |V|²")
    tri = b.eval("""(async () => { const pts = [[1.3, 0.4], [-2.1, 3.3], [4.4, -1.7]], out = [];
      for (const p of ['triangle', 'triangleDown']) { document.querySelector(`#point-presets button[title^="${p === 'triangle' ? 'An equilateral' : 'The same triangle'}"]`).click(); out.push(pts.map(([u, v]) => __app.idealAt(u, v))); }
      return out.map((zs) => zs.map((z) => [z[0] ** 2 + z[1] ** 2, Math.atan2(z[1], z[0])])); })()""")
    same = max(abs(a[0] - c[0]) for a, c in zip(tri[0], tri[1]))
    diff = max(abs(math.remainder(a[1] + c[1], 2 * math.pi)) for a, c in zip(tri[0], tri[1]))
    check(same < 1e-9 and diff < 1e-9 and max(abs(a[1]) for a in tri[0]) > 0.3, f'hbt: the triangle and the triangle turned by 180° have the same |V|² ({same:.1e} apart) and opposite phases')

    # The Etch-a-Sketch with intensities: the sky's autocorrelation.
    PEAKS = r"""((pts) => { const img = __app.paintedImage(), N = 256, h = 128, pix = __app.fov() / 128;
      const at = ([l, m]) => { const ci = h + l / pix, cj = h - m / pix; let best = -1e9; for (let j = Math.round(cj) - 2; j <= Math.round(cj) + 2; j++) for (let i = Math.round(ci) - 2; i <= Math.round(ci) + 2; i++) best = Math.max(best, img[j * N + i]); return best; };
      const c = at([0, 0]); return pts.map((p) => at(p) / c); })"""
    setup(b, 'hbtsketch', 1)
    cap = b.eval("[document.querySelector('#recon-title').textContent, document.querySelector('#recon-note').textContent, document.querySelector('#flow-caption').textContent, document.querySelector('#sketch-hbt-note').getClientRects().length, __app.state.autopilot, __app.state.hbt]")
    check(cap[0] == 'The sky’s autocorrelation' and '|V|²' in cap[1] and 'autocorrelation' in cap[2] and cap[3] > 0 and cap[4] and cap[5],
          f'hbtsketch: HBT and the autopilot on; the image is captioned as the sky’s autocorrelation (“{cap[1]}”), and the panel says why')
    for _ in range(31): b.eval('__app.step(100)')
    src = b.eval('__app.skyModel().sources.map((s) => [s.l, s.m, s.I])')
    d = [src[1][0] - src[0][0], src[1][1] - src[0][1]]
    r = b.eval(f'{PEAKS}({json.dumps([d, [-d[0], -d[1]], [d[0] / 2, d[1] / 2]])})')
    sep = math.degrees(math.asin(math.hypot(*d)))
    ok, miss = says(b, 'hbtsketch', '(1 and 0.6, 8.6° apart)', '1.36', '0.44 of the centre', '0.41 in the picture')
    # (The painted values are averages of noise: the ratio wanders by about 0.01 from run to run.)
    check(ok and quoted(sep, '8.6') and quoted(src[0][2] * src[1][2] / (src[0][2] ** 2 + src[1][2] ** 2), '0.44') and abs(r[0] - 0.41) < 0.025 and abs(r[1] - 0.41) < 0.025 and abs(r[2]) < 0.2,
          f"hbtsketch: the binary's autocorrelation is three points, the side ones {sep:.1f}° out at {r[0]:.3f} and {r[1]:.3f} of the centre (0.6/1.36 = 0.44 less the brush's taper), little between them ({r[2]:.2f})" + (f' missing {miss}' if miss else ''))
    b.eval("""(() => { document.querySelector('#point-presets button[title^="An equilateral"]').click(); __app.clearPaint();
      [...document.querySelectorAll('#sketch-row button')].find((e) => e.textContent === 'Autopilot').click(); })()""")
    for _ in range(31): b.eval('__app.step(100)')
    src = b.eval('__app.skyModel().sources.map((s) => [s.l, s.m, s.I])')
    diffs = [[src[j][0] - src[k][0], src[j][1] - src[k][1]] for j in range(3) for k in range(3) if j != k]
    hexa = b.eval(f'{PEAKS}({json.dumps(diffs)})')
    angles = sorted(math.degrees(math.atan2(q[1], q[0])) % 360 for q in diffs)
    gaps = [round((angles[(k + 1) % 6] - angles[k]) % 360) for k in range(6)]
    check(all(0.2 < v < 0.34 for v in hexa) and gaps == [60] * 6 and len({round(math.hypot(*q), 9) for q in diffs}) == 1,
          f"hbtsketch: the triangle's autocorrelation is six points on a hexagon (60° apart, all as far out), each {min(hexa):.2f}–{max(hexa):.2f} of the centre (1/3, less the brush's taper)")
    b.eval("""(() => { document.querySelector('#point-presets button[title^="The same triangle"]').click(); __app.clearPaint();
      [...document.querySelectorAll('#sketch-row button')].find((e) => e.textContent === 'Autopilot').click(); })()""")
    for _ in range(31): b.eval('__app.step(100)')
    hexb = b.eval(f'{PEAKS}({json.dumps(diffs)})')
    check(max(abs(a - c) for a, c in zip(hexa, hexb)) < 0.06, f"hbtsketch: the triangle turned by 180° gives the same hexagon ({', '.join(f'{v:.2f}' for v in hexb)})")
    check('fourier-etch-a-sketch/blob/main/docs/lab-handout.md#part-5-the-phase-problem' in b.eval("document.querySelector('.exp[data-setup=hbt]').innerHTML"),
          'hbt: the help links the Fourier Etch-a-Sketch’s Part 5, the phase problem')
    check(b.eval("document.querySelectorAll('.exp[data-setup=hbtsketch] svg circle').length") == 15, 'hbtsketch: the help draws the binary’s three points and the triangle’s hexagon')

    # ---------------------------------------------------------------- 4 · many baselines
    setup(b, 'line', 1)
    ln = b.eval("""(() => { const a = __app.array(), x = a.dishes.map((d) => d[0]).sort((p, q) => p - q), unit = (x[1] - x[0]) / 8, s = new Set();
      for (let i = 0; i < x.length; i++) for (let j = i + 1; j < x.length; j++) s.add(Math.round((x[j] - x[i]) / unit)); return { n: x.length, pairs: a.tr.nb, spacings: [...s].sort((p, q) => p - q) }; })()""")
    ok, miss = says(b, 'line', '8, 10, 1, 3, 2, 7 and 8', '28 pairs', 'from 1 to 24')
    check(ok and ln['n'] == 8 and ln['pairs'] == 28 and all(k in ln['spacings'] for k in range(1, 25)), f"line: eight dishes, {ln['pairs']} pairs, spacings {ln['spacings'][:3]}…{ln['spacings'][-4:]} units: every one from 1 to 24" + (f' missing {miss}' if miss else ''))
    check(b.eval("getComputedStyle(document.querySelector('#flow-arrow')).display") != 'none' and b.eval("getComputedStyle(document.querySelector('#recon-cell')).display") != 'none',
          'line: the second row (the image, the arrow from the sampled plane, the beam) is shown')
    ar = b.eval("""(() => { const r = document.querySelector('#recon-cell').getBoundingClientRect(), s = document.querySelector('#sampled-cell').getBoundingClientRect(), a = document.querySelector('#flow-arrow').getBoundingClientRect();
      return [r.right, s.left, a.left, a.right, a.top > s.top && a.bottom < s.bottom]; })()""")
    check(ar[2] < ar[1] + 30 and ar[3] > ar[0] - 30 and ar[4], 'line: the arrow sits between the sampled plane and the image, pointing to the image')
    setup(b, 'array', 1)
    ay = b.eval('(() => { const a = __app.array(); return { n: a.dishes.length, pairs: a.tr.nb, foot: document.querySelector("#uv-foot").textContent }; })()')
    ok, miss = says(b, 'array', '351 pairs', '702 points')
    check(ok and ay['n'] == 27 and ay['pairs'] == 351 and '702' in ay['foot'], f"array: 27 dishes, {ay['pairs']} pairs, 702 points ({norm(ay['foot'])[:50]})" + (f' missing {miss}' if miss else ''))
    d0 = b.eval('__app.array().dishes[5].slice()')
    pt = b.eval('(() => { const g = __app.area().ground, d = __app.array().dishes; let r = 0; for (const [e, n] of d) r = Math.max(r, Math.abs(e), Math.abs(n)); r = Math.max(r * 1.15, 0); const [e, n] = d[5]; return [g.x + (0.5 + e / (2 * r)) * g.s, g.y + (0.5 - n / (2 * r)) * g.s]; })()')
    x, y, w, h = b.box('#ground')
    b.mouse('mouseMoved', x + pt[0], y + pt[1]); b.mouse('mousePressed', x + pt[0], y + pt[1], 1, 'left')
    b.mouse('mouseMoved', x + pt[0] + 20, y + pt[1] + 10, 1, 'left'); b.mouse('mouseReleased', x + pt[0] + 20, y + pt[1] + 10, 0, 'left'); b.eval('__app.draw()')
    check(b.eval('__app.array().dishes[5][0]') != d0[0], 'array: dragging a dish on the ground moves it')
    setup(b, 'rotation', 1)
    ro = b.eval('(() => { const a = __app.array(); return { s: a.sampled.samples, hours: __app.state.hours, dec: __app.state.dec }; })()')
    b.eval("document.querySelector('#earth-row button').click()"); b.eval('__app.draw()')
    snap = b.eval('__app.array().sampled.samples')
    ok, miss = says(b, 'rotation', '8 hours', 'declination 40°')
    check(ok and ro['hours'] == 8 and ro['dec'] == 40 and ro['s'] > 20 * snap, f"rotation: 8 hours at δ = 40° sample {ro['s']} points of the uv plane, a snapshot {snap}" + (f' missing {miss}' if miss else ''))
    # At δ = 5° the Y's beam stays round; an east-west line's becomes a north-south streak.
    beams = {}
    for lay in ('y', 'line'):
        setup(b, 'rotation', 0)
        b.eval(f"(() => {{ __app.state.dec = 5; __app.state.layout = '{lay}'; return __app.setView('array'); }})()"); b.eval('__app.draw()')
        beams[lay] = b.eval('(() => { const f = __app.imaging().fit; return [f.major, f.minor, f.angle * 180 / Math.PI]; })()')
    ok, miss = says(b, 'rotation', 'to 85°', '5°', 'the beam stays round', 'Line of 8', '16 times longer than it is wide')
    ry, rl = beams['y'][0] / beams['y'][1], beams['line'][0] / beams['line'][1]
    check(ok and ry < 1.2 and quoted(rl, '16') and abs(abs(beams['line'][2] % 180) - 90) < 5, f"rotation: at δ = 5° the Y's clean beam is {beams['y'][0]:.2f} × {beams['y'][1]:.2f} pixels, the line's {beams['line'][0]:.2f} × {beams['line'][1]:.2f}, {rl:.1f} times longer, north-south" + (f' missing {miss}' if miss else ''))
    res = []
    for arm in (0.065, 0.1, 0.2):
        setup(b, 'resolution', 0)
        b.eval(f'(() => {{ __app.state.arm = {arm}; return __app.setView("array"); }})()'); b.eval('__app.draw()')
        res.append(b.eval("""(() => { const a = __app.array(), L = __app.lambda(), N = 256, row = 128 * N, img = a.dirtyImg; let far = 0;
          for (let i = 0; i < a.dishes.length; i++) for (let j = i + 1; j < a.dishes.length; j++) far = Math.max(far, Math.hypot(a.dishes[i][0] - a.dishes[j][0], a.dishes[i][1] - a.dishes[j][1]));
          const pix = __app.fov() / 128, sep = 2.5 / 3600 * Math.PI / 180 / pix, i1 = Math.round(128 - sep), i2 = Math.round(128 + sep);
          let p1 = -1e9, p2 = -1e9, dip = 1e9; for (let i = i1 - 2; i <= i1 + 2; i++) p1 = Math.max(p1, img[row + i]); for (let i = i2 - 2; i <= i2 + 2; i++) p2 = Math.max(p2, img[row + i]);
          for (let i = i1 + 2; i <= i2 - 2; i++) dip = Math.min(dip, img[row + i]);
          return { km: far / 1000, arcsec: L / far * 206265, dip: dip / Math.min(p1, p2) }; })()"""))
    ok, miss = says(b, 'resolution', '5″ apart', '1.8 km', '6.8″', 'spread of 0.1 (2.8 km', '4.4″', '0.2 (5.6 km', '2.2″')
    check(ok and quoted(res[0]['km'], '1.8') and quoted(res[0]['arcsec'], '6.8') and quoted(res[1]['km'], '2.8') and quoted(res[1]['arcsec'], '4.4') and quoted(res[2]['km'], '5.6') and quoted(res[2]['arcsec'], '2.2'),
          'resolution: the longest baselines ' + ', '.join(f"{r['km']:.2f} km (λ/B = {r['arcsec']:.2f}″)" for r in res) + (f' missing {miss}' if miss else ''))
    check(res[0]['dip'] > 0.9 and res[1]['dip'] < 0.5 and res[2]['dip'] < 0.25, 'resolution: one blob, then a dip between the two, then two apart (the dip ' + ', '.join(f"{r['dip']:.2f}" for r in res) + ' of the fainter peak)')
    setup(b, 'eht', 1)
    eh = b.eval("""(() => { const a = __app.array(), L = __app.lambda(), sky = __app.skyModel().sky, n = 128; let far = 0, r = 0, best = 0;
      const foot = document.querySelector('#recon-foot').textContent;
      for (let i = 64; i < n; i++) if (sky[64 * n + i] > best) { best = sky[64 * n + i]; r = i + 0.5 - 64; }
      return { foot, ring: 2 * r / n * __app.fov() / (Math.PI / 180 / 3.6e9), n: a.dishes.length, lam: L }; })()""")
    m = re.search(r'Longest baseline\s*([\d\s ]+) km.*?=\s*([\d.]+)', eh['foot'].replace(' ', ' '))
    km, uas = (float(m.group(1).replace(' ', '')), float(m.group(2))) if m else (0, 0)
    ok, miss = says(b, 'eht', 'nine sites', '1.3 mm', '42 µas', '12,700 km', '21 µas', '20 µas for 1 mm and 10,000 km')
    check(ok and eh['n'] == 9 and abs(eh['ring'] - 42) < 2 and abs(km - 12700) < 100 and quoted(uas, '21') and quoted(1e-3 / 1e7 * 206265e6, '20.6') ,
          f"eht: {eh['n']} sites, a ring {eh['ring']:.1f} µas across, the longest baseline {km:.0f} km: λ/B = {uas} µas (and 1 mm over 10,000 km is 20.6 µas)" + (f' missing {miss}' if miss else ''))
    # ---------------------------------------------------------------- making the image: the menu and its strip
    IMG = """(() => { const m = __app.imaging(); let sum = 0; for (const v of __app.array().dirtyImg) sum += v;
      return { imager: m.imager, err: m.error, steps: m.cs.iterations, comps: m.cs.components, done: m.cs.done, its: m.ms ? m.ms.iterations : 0,
        memdone: m.ms ? m.ms.done : false, sum: sum / m.dirtyPeak, playing: m.playing, title: document.querySelector('#method-title').textContent,
        errText: document.querySelector('#recon-err').textContent, b: !document.querySelector('#eq-b').hidden,
        tiles: [...document.querySelectorAll('#method-cell .tile')].filter((e) => e.getClientRects().length).length }; })()"""
    menu = b.eval("[...document.querySelectorAll('#imager-menu button')].map((e) => [e.dataset.imager, e.querySelector('b').textContent, e.querySelector('span').textContent.length])")
    check([m[0] for m in menu] == ['dirty', 'clean', 'mem'] and all(m[2] > 40 for m in menu), f"the menu of ways to make the image: {', '.join(m[1] for m in menu)}, each with a gloss")
    setup(b, 'dirty', 2)
    d23 = b.eval(IMG)
    ok, miss = says(b, 'dirty', '8 hours', 'add up the dirty image and you get 0.000', '4.4%')
    check(ok and d23['imager'] == 'dirty' and abs(d23['sum']) < 5e-4 and quoted(100 * d23['err'], '4.4') and d23['tiles'] == 4 and not d23['b'] and 'dirty beam' in d23['title'],
          f"dirty: the strip shows the sky ⊛ the beam = the dirty image and its uv plane (4 tiles); the dirty image adds up to {d23['sum']:.1e} of its peak; {100 * d23['err']:.2f}% off the true sky" + (f' missing {miss}' if miss else ''))
    # The dirty image's uv plane is the sampled plane: zero in the middle (no zero spacing).
    z0 = b.eval('(() => { const S = __app.array().sampled.S; return S[128 * 256 + 128]; })()')
    check(z0 == 0, 'dirty: no pair measures the zero spacing (the sampled plane is zero at u = v = 0)')
    setup(b, 'clean', 1)
    c0 = b.eval(IMG)
    b.eval("[...document.querySelectorAll('#clean-row button')].find((e) => e.textContent === 'Step').click()"); b.eval('__app.draw()')
    first = b.eval('(() => { const cs = __app.array().cs; return [cs.iterations, cs.log[1], document.querySelectorAll("#comp-list li").length]; })()')
    check(c0['steps'] == 0 and not c0['playing'] and c0['b'] and c0['tiles'] == 8 and first[0] == 1 and first[2] == 1,
          f"clean: it starts from the dirty image (0 steps, not running); Step takes one ({first[1]:.4f}) and the list of steps grows to {first[2]}; the strip has its two rows (8 pictures)")
    for _ in range(5): b.eval("[...document.querySelectorAll('#clean-row button')].find((e) => e.textContent === 'Step').click()")
    b.eval('__app.draw()')
    hop = b.eval('(() => { const log = __app.array().cs.log, at = []; for (let k = 0; k < log.length; k += 2) at.push(log[k]); return [new Set(at).size, document.querySelectorAll("#comp-list li").length]; })()')
    check(hop[0] == 2 and hop[1] == 6, f'clean: in 6 steps the ✚ visits both sources ({hop[0]} pixels), and the list shows the latest {hop[1]}')
    b.eval("[...document.querySelectorAll('#clean-row button')].find((e) => e.textContent === 'Reset').click()")
    b.eval("[...document.querySelectorAll('#clean-row button')].find((e) => e.textContent === 'Watch').click()")
    watching = b.eval('[__app.imaging().playing, document.querySelector("#clean-row button:nth-child(2)").textContent]')
    b.eval('__app.step(1)')
    one = b.eval('__app.array().cs.iterations')
    for _ in range(40): b.eval('__app.step(10)')
    c24 = b.eval(IMG)
    ok, miss = says(b, 'clean', '0.0997', 'After 84 steps', 'with 2 points', '0.03% off', '2.5% for the dirty image')
    check(ok and watching == [True, 'Pause'] and one == 1 and quoted(first[1], '0.0997') and c24['done'] and c24['steps'] == 84 and c24['comps'] == 2 and not c24['playing']
          and quoted(100 * c24['err'], '0.03') and quoted(100 * c0['err'], '2.5'),
          f"clean: Watch runs it a step a frame at first ({one} after one frame), and it stops by itself after {c24['steps']} steps with {c24['comps']} points; {100 * c24['err']:.3f}% off the true sky against {100 * c0['err']:.2f}% for the dirty image" + (f' missing {miss}' if miss else ''))
    b.eval('__app.state.gain = 1'); b.eval("[...document.querySelectorAll('#clean-row button')].find((e) => e.textContent === 'Watch').click()")
    for _ in range(5): b.eval('__app.step(2)')
    g1 = b.eval(IMG)
    ok, miss = says(b, 'clean', 'loop gain to 1', '2 steps, a whole source each')
    check(ok and g1['done'] and g1['steps'] == 2 and g1['comps'] == 2, f"clean: with a loop gain of 1, Watch starts again and takes {g1['steps']} steps" + (f' missing {miss}' if miss else ''))
    setup(b, 'mem', 1)
    m1 = b.eval(IMG)
    for _ in range(10): b.eval('__app.step(10)')
    m25 = b.eval(IMG)
    flat = b.eval('(() => { __app.startImager(); const m = __app.imaging().ms; let lo = Infinity, hi = -Infinity; for (let k = 0; k < m.idx.length; k++) { const v = m.model[m.idx[k]]; lo = Math.min(lo, v); hi = Math.max(hi, v); } return [lo, hi, m.flux]; })()')
    for _ in range(10): b.eval('__app.step(10)')
    ok, miss = says(b, 'mem', 'in 40 iterations', '0.61% off')
    check(ok and m1['playing'] and m25['memdone'] and m25['its'] == 40 and quoted(100 * m25['err'], '0.61') and flat[0] == flat[1] and abs(flat[2] - 1) < 1e-9 and m25['err'] < 0.2 * d23['err'],
          f"mem: it starts flat (every pixel {flat[0]:.2e}, the total flux {flat[2]:.3f} spread evenly) and runs by itself; done after {m25['its']} iterations, {100 * m25['err']:.2f}% off the true sky (the dirty image {100 * d23['err']:.2f}%)" + (f' missing {miss}' if miss else ''))
    ok, miss = says(b, 'mem', 'to 0.1: done in 10 iterations', '2.1% off', 'to 0.003: 77 iterations, 0.57% off')
    al = {}
    for a in (0.1, 0.003):
        b.eval(f'__app.state.alpha = {a}; __app.startImager(); __app.runMem(300)')
        al[a] = b.eval('(() => { const m = __app.imaging(); return [m.ms.iterations, m.error, m.ms.done]; })()')
    check(ok and al[0.1][0] == 10 and quoted(100 * al[0.1][1], '2.1') and al[0.003][0] == 77 and quoted(100 * al[0.003][1], '0.57') and al[0.1][2] and al[0.003][2],
          f"mem: α = 0.1 is done in {al[0.1][0]} iterations, {100 * al[0.1][1]:.2f}% off; α = 0.003 in {al[0.003][0]}, {100 * al[0.003][1]:.2f}% off" + (f' missing {miss}' if miss else ''))
    b.eval('__app.state.alpha = 0.01; __app.startImager(); __app.runMem(300)')
    rule = b.eval('(() => { const m = __app.imaging().ms; let worst = 0; for (const o of m.idx) { const t = m.default[o] * Math.exp(m.residual[o] / m.alpha); if (m.model[o] > 1e-3 * m.default[o]) worst = Math.max(worst, Math.abs(m.model[o] - t) / t); } return worst; })()')
    check(rule < 0.01, f'mem: at the end every pixel is M e^(R/α), to {100 * rule:.2f}%')
    setup(b, 'compare', 2)
    k1 = b.eval(IMG)
    b.eval("document.querySelector('#imager-menu button[data-imager=mem]').click()")
    for _ in range(15): b.eval('__app.step(10)')
    k2 = b.eval(IMG)
    b.eval("document.querySelector('#picture-presets button[title^=\"A bulge\"]').click()"); b.sleep(0.5)
    for _ in range(15): b.eval('__app.step(10)')
    k3 = b.eval(IMG)
    b.eval("document.querySelector('#imager-menu button[data-imager=clean]').click()"); b.eval('__app.state.cleanAuto = true; __app.startImager()'); b.eval('__app.draw()')
    k4 = b.eval(IMG)
    ok, miss = says(b, 'compare', 'allowed 1000 steps', 'in 83 steps', '0.01% off', '32 iterations, 0.11% off', '40 iterations and is 0.61% off', '1000 steps have put down 402 points', '2.9% off')
    check(ok and k1['imager'] == 'clean' and k1['steps'] == 83 and k1['comps'] == 2 and quoted(100 * k1['err'], '0.01') and k2['its'] == 32 and quoted(100 * k2['err'], '0.11')
          and k3['its'] == 40 and quoted(100 * k3['err'], '0.61') and k4['steps'] == 1000 and k4['comps'] == 402 and quoted(100 * k4['err'], '2.9'),
          f"compare: the binary, CLEAN {k1['steps']} steps, {k1['comps']} points, {100 * k1['err']:.3f}%; maximum entropy {k2['its']} iterations, {100 * k2['err']:.2f}%; the galaxy, maximum entropy {k3['its']}, {100 * k3['err']:.2f}%, CLEAN {k4['steps']} steps, {k4['comps']} points, {100 * k4['err']:.2f}%" + (f' missing {miss}' if miss else ''))
    check(k1['err'] < k2['err'] and k3['err'] < 0.5 * k4['err'], 'compare: CLEAN wins on points, maximum entropy on the smooth galaxy')
    b.eval("document.querySelector('#imager-menu button[data-imager=dirty]').click()"); b.eval('__app.draw()')
    check(b.eval('__app.state.imager') == 'dirty' and b.eval("document.querySelector('#clean-row').hidden") and b.eval("document.querySelector('#imager-menu button[data-imager=dirty]').getAttribute('aria-checked')") == 'true',
          'the menu chooses the dirty image again (its buttons hidden: nothing to step)')
    setup(b, 'mem', 1)
    b.eval('__app.state.alpha = 0.003; __app.writeAddress()'); h2 = b.eval('location.hash')
    check('img=mem' in h2 and 'alpha=0.003' in h2, f'the address keeps the method and its α ({h2[-40:]})')

    # ---------------------------------------------------------------- readouts keep still
    for name, sels in [('lag', '#spec1-foot .fixnum, #lag1-foot .fixnum, #product1-foot .fixnum'), ('twosources', '#fringe-foot .fixnum, #plane2-foot .fixnum'),
                       ('uv', '#uv-foot .fixnum, #plane3-foot .fixnum, #slide3-foot .fixnum'), ('array', '#uv-foot .fixnum, #recon-foot .fixnum, #beam-foot .fixnum'),
                       ('mem', '#method-foot .fixnum, #recon-err .fixnum'), ('clean', '#method-foot .fixnum, #recon-err .fixnum')]:
        setup(b, name, 30 if name != 'mem' else 1)
        if name == 'clean': b.eval("[...document.querySelectorAll('#clean-row button')].find((e) => e.textContent === 'Watch').click()")
        moves, texts = b.steady(sels, [lambda: b.eval('__app.step(5)') for _ in range(6)])
        check(not moves and len(texts) > (1 if name != 'array' else 0), f'{name}: the numbers under the pictures keep still as they change ({len(texts)} different readings)' + (f' moved: {moves[:3]}' if moves else ''))
    # Everything fits: no caption or readout wider than its box.
    for v in ('one', 'two', 'uv', 'array', 'array with CLEAN', 'array with maximum entropy'):
        setup(b, {'one': 'noise', 'two': 'twosources', 'uv': 'uv', 'array': 'rotation', 'array with CLEAN': 'compare', 'array with maximum entropy': 'mem'}[v], 5)
        cut = b.eval("[...document.querySelectorAll('figcaption, .foot, .cell-head')].filter((e) => e.getClientRects().length && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.slice(0, 40))")
        check(not cut, f'view {v}: every caption and readout fits its box' + (f': {cut[:3]}' if cut else ''))

    # ---------------------------------------------------------------- the address
    setup(b, 'twosources', 5)
    b.eval('__app.state.scene.xB = 1.37; __app.moveScene(); __app.writeAddress()')
    h = b.eval('location.hash')
    b.goto(f'radiointerferometer/index.html?again{h}'); b.wait('window.__app && __app.ready', timeout=60); b.eval('__app.hold(true)'); b.eval('__app.draw()')
    r = b.eval('({ v: __app.state.view, xB: __app.state.scene.xB, n: __app.state.scene.sources.length, th2: __app.state.scene.sources[1].theta })')
    check(r == {'v': 'two', 'xB': 1.37, 'n': 2, 'th2': -25}, f'the address keeps the set-up ({h[:60]}…)')
    for name, v in ALIASES.items():
        b.console.clear()
        # (A fresh load each time: a change of the hash alone would be handled while we look.)
        b.goto(f'radiointerferometer/index.html?{name}#setup={name}'); b.wait('window.__app && __app.ready', timeout=60); b.eval('__app.hold(true)'); b.eval('__app.draw()')
        got = b.eval('__app.state.view')
        check(got == v and not errors(b), f"#setup={name} (from the antenna-arrays demo) opens view {got}")
    b.goto('radiointerferometer/index.html?equator2#setup=equator'); b.wait('window.__app && __app.ready', timeout=60); b.eval('__app.hold(true)')
    check(b.eval('__app.state.dec') == 5 and b.eval('__app.state.earth'), '#setup=equator: the Y near the celestial equator (δ = 5°), the Earth turning')
    b.console.clear()
    b.goto('radiointerferometer/index.html?old#hours=6&dec=50&sky=double&lat=34&weird=1'); b.wait('window.__app && __app.ready', timeout=60); b.eval('__app.hold(true)'); b.eval('__app.draw()')
    r = b.eval('({ v: __app.state.view, earth: __app.state.earth, hours: __app.state.hours, dec: __app.state.dec, src: __app.state.sky.preset })')
    check(r == {'v': 'array', 'earth': True, 'hours': 6, 'dec': 50, 'src': 'binary'} and not errors(b), f"an old saved synthesis state opens view 4 with its hours, declination and sky, and an unknown key is ignored ({r})")

    # ---------------------------------------------------------------- dark
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
    for name in ('noise', 'twosources', 'uv', 'rotation'):
        setup(b, name, 30)
        b.screenshot(f'build/rif-dark-{name}.png')
    check(b.eval("getComputedStyle(document.body).backgroundColor") != 'rgb(244, 243, 239)', 'dark: the page follows the dark colour scheme')
    setup(b, 'noise', 5)
    hc, sc_ = b.eval(f"{CONTRAST}('#hint-one', 'body')"), b.eval(f"{CONTRAST}('#help .start p', '#help .start')")
    check(hc >= 4.5 and sc_ >= 4.5, f'dark: the hint ({hc}:1) and Start here ({sc_}:1) read')
    b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'light'}])
    hc = b.eval(f"{CONTRAST}('#hint-one', 'body')")
    check(hc >= 4.5, f'light: the hint reads ({hc}:1)')

# ---------------------------------------------------------------- a phone
with Browser('radiointerferometer/index.html', size=(390, 844)) as b:
    b.wait('window.__app && __app.ready', timeout=90)
    b.eval('__app.hold(true)')
    for name in ('noise', 'fringe', 'uv', 'sketch', 'rotation', 'clean'):
        b.console.clear()
        setup(b, name, 30)
        v = VIEW[name]
        wide = b.eval('document.documentElement.scrollWidth')
        main = b.eval(f"(() => {{ const r = document.querySelector('{MAIN_OF[v]}').getBoundingClientRect(); return [r.top, r.bottom, r.width]; }})()")
        hint = b.eval(f"document.querySelector('{HINT_OF[v]}').getBoundingClientRect().bottom")
        check(wide <= 390 and main[2] > 300 and hint <= 844 and not errors(b), f'phone, {name}: nothing sticks out sideways ({wide} px), the main picture is {main[2]:.0f} px wide and its hint is on the first screen (bottom at {hint:.0f} px)')
        b.screenshot(f'build/rif-phone-{name}.png')
    setup(b, 'sketch', 5)
    order = b.eval("['#uv-cell', '#plane-cell', '#sky-cell', '#recon-cell', '#flow-arrow', '#sampled-cell'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top))")
    check(order == sorted(order), f'phone: the uv plane first, then the measurement, the sky, the image, the arrow up to it and the sampled plane (tops {order})')
    b.eval("document.querySelector('#help-button').click()")
    dw = b.eval("(() => { const d = document.querySelector('#help').getBoundingClientRect(); return [d.left, d.width]; })()")
    check(dw[0] >= -1 and dw[1] <= 391, 'phone: the drawer fits the screen')

print(f"\n{len(failures)} failed" if failures else '\nall passed')
sys.exit(1 if failures else 0)
