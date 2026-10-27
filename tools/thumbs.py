#!/usr/bin/env python3
"""Make the landing page's thumbnails, docs/<demo>.jpg, from each demo as it runs.

    tools/thumbs.py                 # every demo listed below
    tools/thumbs.py imaging beams   # just these

Each demo is opened at 1400 x 900 with its address (usually #setup=...), left to run for a
moment, its drawer closed, and the top left of what is below the header (the pictures, mostly
without the controls) saved at 800 x 450: the cards are 16:9.  Needs Pillow.
"""
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from cdp import Browser, ROOT
from PIL import Image

WIDTH = 1040   # of the page, in CSS pixels, that the thumbnail shows

# demo: (address, seconds to let it run[, JavaScript to run first])
DEMOS = {
    'thinfilms': ('#setup=soap', 3),
    'dispersion': ('#setup=spread', 3),
    'interferometer': ('#setup=white', 3),
    'imaging': ('#setup=zernike', 3),
    'holography': ('#setup=portrait', 3),
    'tomography': ('', 3),
    'arrays': ('#setup=steer', 3),
    'beams': ('#setup=waist', 3),
    'phasespace': ('#setup=anharmonic&t=8', 3),
    'schrodinger2d': ('#setup=crystal', 1, '__app.runUntil(0.55 * __app.tEnd)'),
}


def thumb(name, address, wait, js=None):
    with Browser(f'{name}/index.html{address}', size=(1400, 900)) as b:
        b.wait("document.readyState === 'complete'")
        b.sleep(1)
        b.key('Escape')
        if js:
            b.eval(js)
        b.sleep(wait)
        top = b.eval("(() => { const h = document.querySelector('header.bar'); return h ? h.getBoundingClientRect().bottom : 0; })()")
        png = b.screenshot(f'build/thumb-{name}.png')
    im = Image.open(png).convert('RGB')
    top = int(round(top))
    im = im.crop((0, top, WIDTH, top + WIDTH * 9 // 16)).resize((800, 450), Image.LANCZOS)
    out = os.path.join(ROOT, 'docs', f'{name}.jpg')
    im.save(out, quality=85, optimize=True)
    print(out, os.path.getsize(out))


if __name__ == '__main__':
    for name in sys.argv[1:] or DEMOS:
        thumb(name, *DEMOS[name])
