# BrainFlux: interactive physics

Interactive demonstrations for physics majors (sophomores to seniors), rebuilt from the
BrainFlux Java applets of 2001-2007 as plain web pages.

| demo | what you do |
|---|---|
| [2D Fourier transform](fft2d/) | Paint on a picture or on its Fourier transform; the other side follows as you paint.  Filter, shift, swap phases, find the reciprocal lattice. |
| [Schrödinger equation in 1D](schrodinger1d/) | Choose or type a potential V(x, t) and an initial wave function; watch it evolve, measure it, run it backwards. |
| [Least action](action/) | Drag the knots of a path between two events; its action is recorded as you go.  The true path, saddles, phase space, relativity, light, the brachistochrone. |
| [Scattering in 2D](schrodinger2d/) | Wave packets meet disks, wells, slits, crystals or a typed V(x, y); dσ/dθ measured on a detector circle against Born, partial waves and the optical theorem. |
| [Plane waves](planewave/) | Drag the wavevector of exp(i(k·r − ωt)); the four sign conventions; standing waves, fringes, beats; phase and group velocity for light, Schrödinger, water and relativistic dispersion. |
| [Diffraction](diffraction/) | Paint an aperture; slide the screen from the near field to the far field; Talbot carpets, zone plates, lenses, white light (the old LightPropagation idea, finished). |
| [Fourier series you can hear](fourier/) | Draw a period or drag the harmonics, and listen (Web Audio); Gibbs, phase deafness, the missing fundamental (the old SoundFourier idea, finished). |

Each demo opens already doing something worth watching, has preset buttons beside every text
box, a slider (with a typed value) for every number, and a drawer of guided experiments that set
themselves up with one click.

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

## History

BrainFlux.org (2001-2013) hosted Java applets by Jason Gallicchio: a two-dimensional FFT you
could paint on, a one-dimensional Schrödinger equation solver, a complex plane wave and
others.  Java applets stopped running in browsers years ago; these pages keep their spirit
(real time, interactive, built to teach) with new physics and features.
`CLAUDE_CODE_CHAT.md` records how they were rebuilt, and `PLAN.md` the decisions.

## Licence

Code: MIT.  Text, figures and screenshots: CC BY 4.0.  See `LICENSE` and `LICENSE-CONTENT.md`.
