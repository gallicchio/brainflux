# Developing BrainFlux

## Running it

There is nothing to build or install.  The pages are static HTML, CSS and JavaScript modules
with no dependencies, served as they are by GitHub Pages.  To run them locally, serve the
repository with any static web server, for example

    python3 -m http.server

and open <http://localhost:8000/>.  (Opening `index.html` straight from the disk does not work:
browsers refuse to load JavaScript modules from `file://` URLs.)

To publish it: push to GitHub and turn on Pages for the `main` branch, root folder
(Settings, Pages).  The empty `.nojekyll` file tells Pages to serve the files as they are.

## How it is made

- **No frameworks, no build step, no CDN.**  HTML, CSS, ES2020 JavaScript, Canvas 2D, Pointer
  Events and MathML: standards every current browser supports and will keep supporting.
- **`lib/`** holds the shared pieces: a radix-2 FFT (`fft.js`), complex numbers drawn as colours
  (`complexcolor.js`), a parser for the expressions students type, with live MathML previews
  and automatic sliders for free parameters (`expr.js`), a small TeX-to-MathML translator for the
  explanations (`mathml.js`), and a few DOM helpers (`ui.js`, `style.css`).
- **Each demo** is a folder with an `index.html` (the page and its experiments), an `app.js`
  (the interface) and the physics in modules that don't touch the page, so they can be tested.
- **Links to set-ups**: the address bar keeps the set-up as you change it (the preset, a typed
  potential and its parameters, the initial state, a path you drew...), so copying the address
  gives students exactly what you see; and `#setup=<name>` opens one of the guided experiments
  (the names are the `setups` in each `app.js`), e.g. `schrodinger1d/#setup=revival`.

## Tests

    tools/test_all.sh                      # everything below, one line per suite
    tools/run_page.py tests/index.html     # the physics and maths modules, in headless Chromium
    python3 tests/ui/fft2d.py              # drive a demo like a student, checking the physics
    python3 tests/ui/schrodinger1d.py
    python3 tests/ui/action.py
    python3 tests/ui/schrodinger2d.py
    python3 tests/ui/planewave.py
    python3 tests/ui/diffraction.py
    python3 tests/ui/fourier.py

`tools/run_page.py` serves the repository and reads back the report the test page posts;
`tools/cdp.py` drives a page through the Chrome DevTools protocol (standard-library Python
only).  Both need Chromium (or Chrome) installed.
