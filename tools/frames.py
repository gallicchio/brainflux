#!/usr/bin/env python3
"""Make the still pictures of the experiments: one frames/<setup>.webp per guided experiment.

    tools/frames.py thinfilms              # every experiment of a demo
    tools/frames.py thinfilms soap glass   # just these
    tools/frames.py --check                # every demo: each data-frame has its picture, and back

The 2004 design rule: "Every Animation has Key Frames saved as Pictures."  Each experiment in a
demo's drawer (<article class="exp" data-setup="name">) gets a picture of what it looks like
when it is working, which lib/ui.js's drawer() shows under its "Set it up" button.  This tool
opens the demo at #setup=<name> in headless Chromium, runs the demo's own JavaScript to bring it
to the moment worth seeing, crops the pictures that show it, and writes <demo>/frames/<name>.webp,
then marks the article data-frame="WxH" in <demo>/index.html.

Each demo says how, in <demo>/frames.json:

    {
      "select": ["#stage"],          default region: the union of these elements' boxes
      "wait": 2,                     default seconds to let it run after the set-up (and js)
      "js": "",                      default JavaScript run once the page is ready (may be async)
      "size": [1400, 900],           the window
      "width": 720,                  the picture's width, at most (it is never enlarged)
      "setups": {
        "<name>": {"select": [...], "wait": 0.5, "js": "...", "address": "#setup=<name>&t=8"},
        "<name>": false              no picture for this one
      }
    }

Needs Pillow (with WebP).  Deterministic set-ups are best: step the simulation in "js" through
the demo's window.__app hooks (hold, step, runUntil...) rather than waiting on the clock.
"""
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from cdp import Browser, ROOT  # noqa: E402

EXP = re.compile(r'<article class="exp" data-setup="([^"]+)"([^>]*)>')


def experiments(html):
    return [m.group(1) for m in EXP.finditer(html)]


def mark(html, name, size):
    """Set (or clear, with size None) data-frame on the experiment's article."""
    def repl(m):
        if m.group(1) != name:
            return m.group(0)
        rest = re.sub(r'\s*data-frame="[^"]*"', '', m.group(2))
        return f'<article class="exp" data-setup="{name}"' + (f' data-frame="{size[0]}x{size[1]}"' if size else '') + rest + '>'
    return EXP.sub(repl, html)


def union_box(b, selectors):
    return b.eval(f'''(() => {{ let l = Infinity, t = Infinity, r = -Infinity, bo = -Infinity;
      for (const s of {json.dumps(selectors)}) for (const e of document.querySelectorAll(s)) {{
        const q = e.getBoundingClientRect(); if (!q.width || !q.height) continue;
        l = Math.min(l, q.left + scrollX); t = Math.min(t, q.top + scrollY); r = Math.max(r, q.right + scrollX); bo = Math.max(bo, q.bottom + scrollY); }}
      return isFinite(l) ? [l, t, r - l, bo - t] : null; }})()''')


def capture(b, demo, name, cfg, out_width):
    """Open the set-up afresh, bring it to its moment, and return a PIL image of the region."""
    from PIL import Image
    import base64
    import io
    address = cfg.get('address', f'#setup={name}')
    b.goto('about:blank')
    b.goto(f'{demo}/index.html{address}')
    b.wait("document.readyState === 'complete'", timeout=60)
    b.wait('!window.__app || window.__app.ready !== false', timeout=60)
    b.sleep(0.3)
    if cfg.get('js'):
        b.eval(cfg['js'])
    b.sleep(cfg.get('wait', 2))
    box = union_box(b, cfg['select'])
    if not box:
        raise RuntimeError(f'{demo}/{name}: nothing visible matches {cfg["select"]}')
    pad = cfg.get('pad', 0)
    x, y, w, h = box[0] - pad, box[1] - pad, box[2] + 2 * pad, box[3] + 2 * pad
    # Capture what is on the screen, not beyond it: Chrome's captureBeyondViewport resizes the
    # viewport for a moment, which clears every canvas that follows its size before it redraws.
    # Nor scroll (headless Chromium may capture before it paints the scroll).  The page stays at
    # the top, and the window is made taller (and the page given a second to redraw) only when
    # the region reaches below it.  The clip is in document coordinates.
    b.eval('window.scrollTo(0, 0)')
    tall = y + h > b.size[1]
    if tall:
        b.call('Emulation.setDeviceMetricsOverride', width=b.size[0], height=int(y + h + 2), deviceScaleFactor=1, mobile=False)
        b.sleep(1.0)
        x, y, w, h = [v + d for v, d in zip(union_box(b, cfg['select']), (-pad, -pad, 2 * pad, 2 * pad))]
    clip = {'x': max(0, x), 'y': max(0, y), 'width': w, 'height': h, 'scale': 1}
    data = b.call('Page.captureScreenshot', format='png', clip=clip)['data']
    if tall:
        b.call('Emulation.setDeviceMetricsOverride', width=b.size[0], height=b.size[1], deviceScaleFactor=1, mobile=False)
    im = Image.open(io.BytesIO(base64.b64decode(data))).convert('RGB')
    if im.width > out_width:
        im = im.resize((out_width, round(im.height * out_width / im.width)), Image.LANCZOS)
    return im


def make(demo, only=()):
    path = os.path.join(ROOT, demo, 'index.html')
    html = open(path, encoding='utf-8').read()
    conf_path = os.path.join(ROOT, demo, 'frames.json')
    conf = json.load(open(conf_path)) if os.path.exists(conf_path) else {}
    base = {'select': conf.get('select', ['main']), 'wait': conf.get('wait', 2), 'js': conf.get('js', '')}
    size = tuple(conf.get('size', [1400, 900]))
    out_width = conf.get('width', 720)
    names = [n for n in experiments(html) if not only or n in only]
    os.makedirs(os.path.join(ROOT, demo, 'frames'), exist_ok=True)
    made = []
    with Browser(f'{demo}/index.html', size=size) as b:
        for name in names:
            own = conf.get('setups', {}).get(name, {})
            if own is False:
                html = mark(html, name, None)
                print(f'skip  {demo}/{name}')
                continue
            cfg = {**base, **own}
            t0 = time.time()
            im = capture(b, demo, name, cfg, out_width)
            out = os.path.join(ROOT, demo, 'frames', f'{name}.webp')
            im.save(out, 'WEBP', quality=conf.get('quality', 80), method=6)
            html = mark(html, name, im.size)
            made.append(name)
            print(f'ok    {demo}/{name}: {im.width}x{im.height}, {os.path.getsize(out) // 1024} kB ({time.time() - t0:.1f} s)', flush=True)
        errors = [c for c in b.console if 'EXCEPTION' in c]
    open(path, 'w', encoding='utf-8').write(html)
    if errors:
        print('console:', *errors[:5], sep='\n  ')
    return made


def check():
    """Every data-frame has its picture of that size, and every picture belongs to an experiment."""
    from PIL import Image
    bad, n = [], 0
    for demo in sorted(os.listdir(ROOT)):
        path = os.path.join(ROOT, demo, 'index.html')
        if demo in ('tests', 'tools', 'lib', 'docs') or not os.path.isfile(path):
            continue
        html = open(path, encoding='utf-8').read()
        names = set(experiments(html))
        for m in re.finditer(r'<article class="exp" data-setup="([^"]+)"[^>]*data-frame="(\d+)x(\d+)"', html):
            n += 1
            f = os.path.join(ROOT, demo, 'frames', m.group(1) + '.webp')
            if not os.path.exists(f):
                bad.append(f'{demo}/{m.group(1)}: data-frame but no frames/{m.group(1)}.webp')
            elif Image.open(f).size != (int(m.group(2)), int(m.group(3))):
                bad.append(f'{demo}/{m.group(1)}: data-frame {m.group(2)}x{m.group(3)}, picture {Image.open(f).size}')
        fdir = os.path.join(ROOT, demo, 'frames')
        if os.path.isdir(fdir):
            for f in os.listdir(fdir):
                if f.endswith('.webp') and f[:-5] not in names:
                    bad.append(f'{demo}/frames/{f}: no experiment of that name')
    for b in bad:
        print('FAIL ', b)
    print(f'{n} experiment pictures checked; {len(bad)} problems')
    return not bad


if __name__ == '__main__':
    args = sys.argv[1:]
    if args == ['--check']:
        sys.exit(0 if check() else 1)
    if not args:
        sys.exit(__doc__)
    make(args[0], set(args[1:]))
