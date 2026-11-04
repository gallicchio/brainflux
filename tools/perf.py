#!/usr/bin/env python3
"""How responsive is each demo on a slow laptop?  Times every experiment of every demo.

    tools/perf.py                          every demo, CPU slowed 4x, results in build/perf/
    tools/perf.py nmr oct                  just these
    tools/perf.py nmr --setups echo,cpmg   just these experiments
    tools/perf.py --rate 1 --dpr 2         unslowed, at a high-DPI screen's resolution
    tools/perf.py --query '?scope=fast'    with something in the address (here: the old traces)
    tools/perf.py --profile nmr echo       where the time goes in one experiment: self time per
                                           function while it runs and while a slider is dragged

For each experiment it opens the demo, presses the experiment's "Set it up" button, lets it
settle, then for two seconds records every animation frame's interval (requestAnimationFrame)
and the main thread's busy time (DevTools Performance.getMetrics TaskDuration), and counts the
page's own animation-frame callbacks (a loop started twice runs two a frame), and then drags
up to two of the visible sliders in steps, timing each step from the input event to the end of
the frame that shows the change (the next animation frame, its style, layout and paint).  The CPU is slowed with DevTools'
Emulation.setCPUThrottlingRate, which stands in for an older laptop.

Caveats: headless Chromium here draws canvases in software (--disable-gpu), so canvas-heavy
drawing may cost more, or less, than on a laptop with a GPU; and other programs on this machine
add noise.  The numbers rank the demos; they are not a promise about any one laptop.

Results: build/perf/<label>.json (everything) and build/perf/<label>.md (the ranking).
"""
import argparse
import collections
import json
import os
import re
import statistics
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import Browser, ROOT  # noqa: E402

SKIP = {'tests', 'build', 'tools', 'lib', 'docs', '.claude', '.git'}

# Before any page script: count the page's own animation-frame callbacks, so a demo that has
# started a second copy of its loop (two callbacks a frame where it means one) shows up.
COUNT_RAF = r"""
(() => {
  const orig = window.requestAnimationFrame.bind(window);
  window.__origRAF = orig; window.__rafCount = 0;
  window.requestAnimationFrame = (cb) => orig((t) => { window.__rafCount++; cb(t); });
})();
"""

# Injected into each page: a requestAnimationFrame clock (on the real one), and the slider drag.
HELPERS = r"""
window.__perf = {
  frames: [], on: false,
  start() { const raf = window.__origRAF || requestAnimationFrame; this.frames = []; this.on = true; this.c0 = window.__rafCount || 0;
    const tick = (t) => { if (!this.on) return; this.frames.push(t); raf(tick); }; raf(tick); },
  callbacks() { return (window.__rafCount || 0) - this.c0; },
  stop() { this.on = false; const f = this.frames, d = []; for (let i = 1; i < f.length; i++) d.push(f[i] - f[i - 1]); return d; },
  sliders() {
    const all = [...document.querySelectorAll('input[type=range]')].filter((e) => {
      if (e.disabled) return false;
      const r = e.getBoundingClientRect();
      return r.width > 20 && r.height > 0 && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden';
    });
    return all.slice(0, 2);
  },
  sliderNames() {
    return this.sliders().map((s) => {
      const w = s.closest('.slider, label, .row, div');
      const l = (s.id && document.querySelector(`label[for="${s.id}"]`)) || w?.querySelector('label');
      return (l?.textContent || s.title || s.id || '?').trim().replace(/\s+/g, ' ').slice(0, 40);
    });
  },
  async drag(steps = 8) {
    const out = [];
    const frame = () => new Promise((r) => (window.__origRAF || requestAnimationFrame)(r));
    for (const s of this.sliders()) {
      const min = +s.min || 0, max = +s.max || 100, v0 = +s.value, span = max - min;
      const dir = v0 - min > span / 2 ? -1 : 1;
      for (let k = 1; k <= steps; k++) {
        await frame();
        const t0 = performance.now();
        s.value = String(v0 + dir * k * span * 0.04);
        s.dispatchEvent(new Event('input', { bubbles: true }));
        await frame(); await new Promise((r) => setTimeout(r, 0));     // the frame drawn, painted
        out.push(performance.now() - t0);
      }
      s.value = String(v0); s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true }));
      await frame(); await frame();
    }
    return out;
  },
};
true
"""


def demos():
    out = []
    for d in sorted(os.listdir(ROOT)):
        if d in SKIP or d.startswith('.') or not os.path.isfile(os.path.join(ROOT, d, 'index.html')):
            continue
        out.append(d)
    return out


def experiments(demo):
    html = open(os.path.join(ROOT, demo, 'index.html'), encoding='utf-8').read()
    return re.findall(r'class="exp"[^>]*data-setup="([^"]+)"', html) or re.findall(r'data-setup="([^"]+)"', html)


def metric(b, name):
    m = {x['name']: x['value'] for x in b.call('Performance.getMetrics')['metrics']}
    return m.get(name, 0.0)


def pct(xs, p):
    if not xs:
        return None
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p * (len(xs) - 1))))]


def open_demo(b, demo, query, rate):
    b.call('Emulation.setCPUThrottlingRate', rate=1)
    b.eval('window.__app = undefined')
    b.goto(f'{demo}/index.html{query}')
    deadline = time.time() + 30
    while time.time() < deadline:
        if b.eval("document.readyState === 'complete' && (window.__app === undefined ? performance.now() > 2500 : !!__app.ready)"):
            break
        time.sleep(0.1)
    time.sleep(0.5)
    b.eval(HELPERS)
    b.call('Emulation.setCPUThrottlingRate', rate=rate)


def setup(b, name):
    ok = b.eval(f"""(() => {{ const b = document.querySelector('.exp[data-setup="{name}"] button.setup');
        if (!b) return false; b.click(); return true; }})()""")
    return bool(ok)


def measure(b, settle=0.8, run=2.0, steps=8):
    time.sleep(settle)
    t0, w0 = metric(b, 'TaskDuration'), metric(b, 'Timestamp')
    s0 = metric(b, 'ScriptDuration')
    b.eval('__perf.start()')
    time.sleep(run)
    cb = b.eval('__perf.callbacks()') or 0
    d = b.eval('__perf.stop()') or []
    t1, w1 = metric(b, 'TaskDuration'), metric(b, 'Timestamp')
    s1 = metric(b, 'ScriptDuration')
    busy = (t1 - t0) / max(1e-6, (w1 - w0))
    lat = b.eval(f'__perf.drag({steps})') or []
    return {
        'frames': len(d), 'median_ms': pct(d, 0.5), 'p90_ms': pct(d, 0.9), 'max_ms': max(d) if d else None,
        'busy': busy, 'script': (s1 - s0) / max(1e-6, (w1 - w0)), 'callbacks_per_frame': cb / max(1, len(d)),
        'slider_ms': pct(lat, 0.5), 'slider_max_ms': max(lat) if lat else None, 'slider_steps': len(lat),
    }


def score(m):
    """The experiment's sluggishness: the worse of a typical frame and a typical slider step, ms."""
    vals = [v for v in (m.get('p90_ms'), m.get('slider_ms')) if v is not None]
    return max(vals) if vals else 0.0


def run_all(args):
    names = args.demos or demos()
    label = args.label or f"rate{args.rate:g}-dpr{args.dpr:g}{('-' + re.sub(r'[^a-z0-9]+', '', args.query)) if args.query else ''}"
    os.makedirs(os.path.join(ROOT, 'build', 'perf'), exist_ok=True)
    results = {}
    with Browser('index.html', size=(args.width, args.height)) as b:
        b.call('Performance.enable')
        b.call('Page.addScriptToEvaluateOnNewDocument', source=COUNT_RAF)
        b.call('Emulation.setDeviceMetricsOverride', width=args.width, height=args.height, deviceScaleFactor=args.dpr, mobile=False)
        for demo in names:
            exps = experiments(demo)
            if args.setups:
                exps = [e for e in exps if e in args.setups.split(',')]
            res = {}
            t_demo = time.time()
            try:
                open_demo(b, demo, args.query, args.rate)
                res['(as opened)'] = measure(b, settle=0.3, run=args.run, steps=args.steps)
                for e in exps:
                    if not setup(b, e):
                        res[e] = {'error': 'no Set it up button'}
                        continue
                    res[e] = measure(b, run=args.run, steps=args.steps)
            except Exception as ex:      # one demo's failure shouldn't end the survey
                res['error'] = {'error': str(ex)}
            errs = [c for c in b.console if c.startswith('EXCEPTION')]
            b.console.clear()
            results[demo] = {'experiments': res, 'exceptions': errs[:5], 'seconds': time.time() - t_demo}
            loops = max((v.get('callbacks_per_frame', 0) for v in res.values() if 'error' not in v), default=0)
            results[demo]['callbacks_per_frame'] = loops
            worst = max(((k, score(v)) for k, v in res.items() if 'error' not in v), key=lambda kv: kv[1], default=('-', 0))
            print(f'{demo:20s} {len(exps):3d} experiments, worst {worst[1]:6.1f} ms ({worst[0]}), most animation callbacks a frame {loops:.1f}, {time.time() - t_demo:5.1f} s', flush=True)
            json.dump({'rate': args.rate, 'dpr': args.dpr, 'query': args.query, 'size': [args.width, args.height], 'results': results},
                      open(os.path.join(ROOT, 'build', 'perf', label + '.json'), 'w'), indent=1)
    write_md(results, args, label)


def write_md(results, args, label):
    rows = []
    for demo, r in results.items():
        ex = {k: v for k, v in r['experiments'].items() if 'error' not in v}
        if not ex:
            continue
        scores = {k: score(v) for k, v in ex.items()}
        worst = max(scores, key=scores.get)
        med = statistics.median(scores.values())
        busiest = max(ex, key=lambda k: ex[k]['busy'])
        rows.append((demo, med, scores[worst], worst, ex[busiest]['busy'], busiest, len(ex), r['exceptions'], r.get('callbacks_per_frame', 0)))
    rows.sort(key=lambda x: (x[2], x[1]))
    out = [f'# Responsiveness: CPU slowed {args.rate:g}x, {args.width}x{args.height} at {args.dpr:g}x{(", " + args.query) if args.query else ""}', '',
           'Per experiment, sluggishness = the worse of its 90th-percentile frame interval (while it runs on its own) and its',
           'median slider step (input event to the end of the frame showing it).  16.7 ms is 60 frames a second.', '',
           'Loops: the most animation-frame callbacks the page ran in a frame (more than one or two means a loop',
           'started twice).', '',
           '| rank | demo | median experiment (ms) | worst experiment (ms) | worst | busiest main thread | experiments | loops |',
           '|---:|---|---:|---:|---|---|---:|---:|']
    for i, (demo, med, w, wn, busy, bn, n, errs, loops) in enumerate(rows, 1):
        out.append(f'| {i} | {demo} | {med:.0f} | {w:.0f} | {wn} | {100 * busy:.0f}% ({bn}) | {n} | {loops:.1f} |' + (f' exceptions: {len(errs)}' if errs else ''))
    open(os.path.join(ROOT, 'build', 'perf', label + '.md'), 'w').write('\n'.join(out) + '\n')
    print('\n'.join(out))


def profile(args):
    demo, name = args.profile
    with Browser('index.html', size=(args.width, args.height)) as b:
        b.call('Performance.enable')
        b.call('Page.addScriptToEvaluateOnNewDocument', source=COUNT_RAF)
        b.call('Emulation.setDeviceMetricsOverride', width=args.width, height=args.height, deviceScaleFactor=args.dpr, mobile=False)
        open_demo(b, demo, args.query, args.rate)
        if name != '-' and not setup(b, name):
            sys.exit(f'{demo}: no experiment {name}')
        time.sleep(0.8)
        for phase in ('run', 'drag'):
            b.call('Profiler.enable')
            b.call('Profiler.setSamplingInterval', interval=200)
            m0 = {x['name']: x['value'] for x in b.call('Performance.getMetrics')['metrics']}
            b.call('Profiler.start')
            if phase == 'run':
                b.eval('__perf.start()'); time.sleep(args.run * 1.5); d = b.eval('__perf.stop()') or []
                extra = f"{len(d)} frames, median {pct(d, 0.5) or 0:.1f} ms, p90 {pct(d, 0.9) or 0:.1f} ms"
            else:
                names = b.eval('__perf.sliderNames()') or []
                lat = b.eval(f'__perf.drag({args.steps})') or []
                extra = f"{len(lat)} slider steps ({', '.join(names) or 'no sliders'}), median {pct(lat, 0.5) or 0:.1f} ms, max {max(lat) if lat else 0:.1f} ms"
            prof = b.call('Profiler.stop')['profile']
            m1 = {x['name']: x['value'] for x in b.call('Performance.getMetrics')['metrics']}
            wall = m1['Timestamp'] - m0['Timestamp']
            cats = {k: (m1.get(k, 0) - m0.get(k, 0)) / wall for k in ('TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration')}
            nodes = {n['id']: n for n in prof['nodes']}
            self_t, files = collections.Counter(), collections.Counter()
            for sid, dt in zip(prof['samples'], prof['timeDeltas']):
                cf = nodes[sid]['callFrame']
                url = cf['url'].split('/')
                f = '/'.join(url[-2:]) if cf['url'] else ''
                self_t[(cf['functionName'] or '(anonymous)', f, cf['lineNumber'] + 1)] += dt
                files[f or cf['functionName']] += dt
            tot = sum(v for k, v in self_t.items() if k[0] != '(idle)') or 1
            print(f'\n## {demo} / {name}: {phase} ({extra})')
            print('main thread: ' + ', '.join(f"{k.replace('Duration', '').lower()} {100 * v:.0f}%" for k, v in cats.items()) + ' of the wall clock')
            print('self time (of the busy time):')
            for (fn, f, line), v in self_t.most_common(args.top + 1):
                if fn == '(idle)':
                    continue
                print(f'  {100 * v / tot:5.1f}%  {fn}  {f}:{line}' if f else f'  {100 * v / tot:5.1f}%  {fn}')
            print('by file:  ' + ', '.join(f'{k} {100 * v / tot:.0f}%' for k, v in files.most_common(8) if k != '(idle)'))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('demos', nargs='*')
    ap.add_argument('--setups', default='')
    ap.add_argument('--rate', type=float, default=4)
    ap.add_argument('--dpr', type=float, default=1)
    ap.add_argument('--width', type=int, default=1280)
    ap.add_argument('--height', type=int, default=800)
    ap.add_argument('--query', default='')
    ap.add_argument('--run', type=float, default=2.0, help='seconds of frames per experiment')
    ap.add_argument('--steps', type=int, default=8, help='slider steps per slider')
    ap.add_argument('--label', default='')
    ap.add_argument('--top', type=int, default=18)
    ap.add_argument('--profile', nargs=2, metavar=('DEMO', 'SETUP'), help="SETUP '-' for the page as opened")
    args = ap.parse_args()
    if args.profile:
        profile(args)
    else:
        run_all(args)


if __name__ == '__main__':
    main()
