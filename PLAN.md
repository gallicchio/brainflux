# BrainFlux reborn: the plan

Interactive physics demos for sophomore-to-senior physics majors, rebuilt from the BrainFlux Java
applets (begun in 2000 and 2001) as plain web pages.  This file holds the decisions and the reasons for them;
`CLAUDE_CODE_CHAT.md` holds the conversation.

## Design rules, from the old site's `About/Philosophy.xml` (2004)

> **Easy Startup**: When applets load, they should already be set to a state that does something
> interesting, not ask the user for a thousand parameters before it starts.
> **Interesting Presets**: If there's an option to type in a function, provide several as
> interesting examples accessible by buttons.
> **Sliders, not Text Boxes**: ... Nobody wants to type in numbers, but they should always have
> the ability of using an exact value if they want.
> **Every Animation has Key Frames saved as Pictures.**  **Good Looking = Effective.**
> **Don't keep People Guessing.**

So: every demo opens already running something worth watching; every text box has preset
buttons beside it; every number is a slider with an editable value; every free symbol typed into
an expression becomes a slider; each guided experiment has a still picture in its write-up.

## Ground rules

- **No frameworks, no build step, no server.**  Each demo is a static HTML page, its CSS, and
  plain JavaScript ES modules (`<script type="module">`).  Everything a browser needs is in this
  repository; nothing is fetched from a CDN.  GitHub Pages serves the repository as it is.
- **Standards only**: HTML, CSS, ES2020 JavaScript, Canvas 2D, Pointer Events, MathML Core (for
  equations: every major browser renders it natively since 2023, so no MathJax/KaTeX), and
  optionally `getUserMedia` (webcam) and Web Audio.  No WebGL/WebGPU unless a demo cannot be made
  smooth without it; the CPU is fast enough for 256 x 256 split-step FFTs at animation rates.
- **Runs locally** with any static file server (`python3 -m http.server` in the repository
  root).  Browsers refuse ES modules from `file://`, which is the one cost of modules; the gain is
  code that students can read file by file.
- **Shared code lives in `lib/`** and each demo imports only what it uses.  Small enough to read.
- **Physics in plain modules with no DOM** (`*/sim.js`, `lib/fft.js`, ...) so the tests can
  exercise them in a headless browser (`tests/`).
- **Units**: hbar = 1 and m = 1 by default in the quantum demos (the mass is adjustable in 1D);
  the equations are always shown with hbar and m so students see where they go.
- **Licences**: code MIT; the written explanations, figures and screenshots CC BY 4.0.
  Third-party content: only public-domain images (the Boilly/Geille engraving of Fourier).

## The demos

### 1. `fft2d/`: the 2D Fourier transform, live in both directions

Two complex images, f(x, y) and F(kx, ky), each editable; editing one recomputes the other every
animation frame.  Complex values are drawn with domain colouring (phase -> hue, magnitude ->
lightness, black at 0, white at infinity), with a brightness control that compresses many orders of
magnitude with arctan, as the old applet did.

- Tools: hand (shift: the other side gets a phase ramp), brush (round / square / soft) with a
  complex value picker and an eraser (paint zero), shape masks (drag a disk, box or ring; "zero
  outside" makes a low-pass filter in one drag, "zero inside" a high-pass), cross-section line,
  probe readout.  Repeat-on-a-lattice painting (convolution with a comb) from the old applet.
- "Keep the image real": painting at k also paints the conjugate at -k (Hermitian symmetry).
- Display modes per side: magnitude+phase, |.|, |.|^2 (the old |.|^2 never worked: a `||` that
  was always true), phase, Re, Im, log.  Operations that change data: keep magnitude only, keep
  phase only, keep Re, keep Im; remember one transform and graft its phase onto another (the
  phase-versus-magnitude experiment).
- Gallery: Fourier's portrait (the default), the stripes of his jacket (the low-pass filter
  lesson), Gaussian, box (sinc), disk (Airy), ring, slits, gratings, lattices, points, text you
  type, your own picture (file, drag-and-drop, paste) and the webcam; the author's photo too, not
  first.  Resolutions 64 to 512.
- Click one pixel of k-space and see its plane wave: the bridge to the plane-wave demo.
- Undo.  Guided experiments from the old tutorial page, each with a "set it up" button.

### 2. `schrodinger1d/`: the 1D time-dependent Schrödinger equation

- Split-operator (Strang) evolution: exp(-iV dt/2) exp(-iT dt) exp(-iV dt/2) with the kinetic
  step exact in momentum space.  Unitary to round-off, spectral in space, second order in time,
  unconditionally stable, and cheap enough (N = 1024..4096) to take many substeps per frame, so
  the animation is smooth at any speed.  (The old applet used Crank-Nicolson, which is also
  unitary, but its finite-difference dispersion makes fast packets travel at the wrong speed.)
- Boundaries: hard walls (sine transform), periodic (a ring) or absorbing (a smooth complex
  absorbing layer, for scattering).
- Potentials: free, infinite well, harmonic, step, barrier, finite well, double well, linear
  ("quantum bouncer"), periodic lattice, or typed in, V(x, t) with time allowed (driven
  oscillator, sudden expansion).  Any free symbol in a typed expression becomes a slider.
- Initial states: Gaussian packet (x0, sigma, p0), eigenstate n (click a level), superposition of
  two levels, coherent and squeezed states, two colliding packets, or typed in.
- Views: |psi|^2 (or |psi|) filled with phase colour over V(x) with the energy levels and <E>;
  Re/Im; probability current; momentum space; a space-time "carpet" (the old
  TimeProgressivePlot) for revivals and tunnelling.
- Readouts: <x>, sigma_x, <p>, sigma_p, sigma_x sigma_p vs hbar/2, <E>, norm, the probability
  left/right of a barrier (reflection and transmission).
- Educational extras: play backwards (time reversal), a classical particle started at <x>, <p>
  (Ehrenfest), measure position or energy (collapse with the Born-rule probabilities), the energy
  spectrum |c_n|^2 of the state.
- Bugs of the old applet not carried over: the probability current used a backwards, half-size
  derivative and skipped every other point; the kinetic term was p^2/m instead of p^2/2m.

### 3. `action/`: the principle of (least) action

- Draw a path q(t) between fixed end points by dragging knots of a smooth spline (or straight
  segments); the action S = integral of L dt updates live, and a strip chart scrolls to record S
  for every change, so students see themselves descend towards the minimum.
- Why q(t) and not phase space: the Lagrangian action is a functional of the path in
  configuration space-time, and it is the one that is (often) minimal.  The phase-space action
  integral (p dq - H dt), with p varied independently of q, is never minimal: it is a saddle,
  maximal in p for each q(t), which returns the Lagrangian action.  So the path is drawn as
  q(t), and its image in phase space (q, p = dL/dq') is drawn live beside it over the energy
  contours of H: the true path lies on one contour, the drawn one crosses them.
- Systems: free particle, uniform gravity (throw and catch), harmonic oscillator (the action is a
  minimum only while T < half a period: beyond it the true path is a saddle, and students can
  find paths with less action than the real one), pendulum (several true paths), double well,
  relativistic free particle (proper time is maximised: the twin paradox), Fermat's principle
  (light in a graded medium), the brachistochrone, and a typed V(q, t) or L(q, q', t).
- Help that teaches: arrows on the knots showing which way lowers S (the Euler-Lagrange residual
  projected on the knots), a "relax" button (gradient flow that converges to a minimum and runs
  away from a saddle), every true path found by shooting with its action and its Morse index
  (minimum or saddle), E(t) along the drawn path (constant only on the true one), and the
  Feynman phasor exp(iS/hbar) that stops spinning near the classical path.

### 4. `schrodinger2d/`: wave packets scattering in 2D

- Split-operator on a 256 x 256 grid (128 for speed, 512 for detail) with an absorbing border.
- Potentials: hard disk, soft Gaussian bump or well, square well, softened Coulomb, Yukawa,
  single and double slit, grating, lattice of scatterers (Bragg), painted obstacles, typed
  V(x, y).  Gaussian packets from narrow to nearly plane waves.
- Scattering theory made visible:
  - the scattered wave alone, psi - psi_incident (the incident packet is known in closed form),
    showing the outgoing circular wave and the shadow, i.e. the forward interference that is the
    optical theorem;
  - momentum space, where elastic scattering puts the probability on the circle |k| = k0, with
    the Born prediction |V~(k - k0)|^2 drawn on it;
  - dsigma/dtheta measured from the flux through a circle, against the Born approximation and the
    classical cross section;
  - energy-resolved partial waves on that circle: S_m = exp(2i delta_m), unitarity |S_m| = 1, the
    phase shifts against the exact hard-disk ones, and sigma_total three ways (flux, partial
    waves, Im f(0)): the optical theorem as a number.

### 5. `planewave/`: what exp(i(k.x - wt)) means

From the old PlaneWave applet: a plane wave drawn with phase colour, k dragged as an arrow, w and
the complex amplitude A adjustable, the four sign conventions and which way each one travels.
Then superposition (standing waves, fringes) and a 1D packet with a chosen dispersion relation
(light, Schrödinger, deep water) to separate phase and group velocity.

### Later, from the old site, if time allows

- Diffraction (the old LightPropagation applet): paint an aperture, slide z from Fresnel to
  Fraunhofer by the angular spectrum method; the Talbot carpet of a grating.
- Fourier series with sound (the old SoundFourier/InstrumentFourier applets): harmonics on
  sliders, heard through Web Audio.

## Shared library (`lib/`)

| file | contents |
|---|---|
| `fft.js` | radix-2 complex FFT on split re/im arrays (1D, 2D, centred by the checkerboard trick), the sine transform for hard walls |
| `complexcolor.js` | domain colouring by a lookup table (perceptual hue wheel, arctan brightness), the colour legend |
| `expr.js` | expression parser: numbers, x, i, pi, e, functions, comparisons as 0/1, implicit multiplication; evaluated over whole arrays at once (fast without `eval`); free symbols for sliders; MathML of the parsed expression as a live preview |
| `mathml.js` | a small TeX-subset to MathML converter for the explanations |
| `plot.js` | HiDPI canvas helpers, axes and ticks |
| `ui.js` | sliders with typed values, toggle groups, the experiments drawer, state in the URL so an instructor can link a set-up |
| `style.css` | the common look, light and dark |

## Testing

- `tests/index.html` runs every `*.test.js` in a browser; `tools/test.sh` serves the repository
  and runs it in headless Chromium (Firefox for a second opinion): FFT against a direct DFT,
  Parseval, unitarity of the propagators, harmonic and box eigenvalues, Gaussian spreading against
  the closed form, transmission through a barrier against the analytic T(E), the action of the
  true paths against closed forms, the Born amplitude for a weak Gaussian against the numerical
  one, the hard-disk phase shifts.
- Screenshots of every demo by headless Chromium, looked at, kept in `docs/` for the log.

## Status, 2026-10-27

All five demos (and two more from the old site, diffraction and Fourier series with sound) are
built, tested and committed; each has a drawer of guided experiments
(13, 18, 14, 12 and 10), `#setup=<name>` links, light and dark themes, and a layout that
works on a phone.

What the plan said and what happened instead:

- **Sharp potentials (1D).**  The split-operator method, given a step potential, heats a bound
  state (its energy rose tenfold in ten time units at dt = 0.02, worse on finer grids).  Measured,
  not guessed: potentials with jumps are band-limited at k = 16 (k = 40 for the delta), which
  keeps the sharp step's reflection exact for k < 5 (R = 0.0941 against 0.0943), walls taller
  than 30 are rounded over 0.05 instead (band-limiting would ring and bind spurious states),
  static potentials are cell-averaged so an edge sits where it was typed, and the time step is
  1.2 m / kc^2 when there are jumps, and keeps |V - <E>| dt < 1/3 where psi is.  In 2D the same
  band limit is enough on its own (tested with the double slit's walls).
- **The 2D partial waves** needed the beam's own partial-wave content (a Gaussian beam carries
  less of the high m than a plane wave: 4.5% at m = 3 for this beam); with it, |S_m| = 1 to
  0.4% and the optical theorem agrees with the partial-wave sum to 0.05%.
- **Phase space in the action demo** is a view of the drawn q(t), not where it is drawn: the
  Lagrangian action is the one that is minimal; the phase-space action is a saddle.
- **The colour map** keeps the old applet's HSV hues (with its sin 3φ / 5 bend) and adds one
  perceptual correction (each hue reaches full colour at a magnitude leaning towards its own
  lightness); a fully perceptual map was tried and came out muddy.
- **Photographs** in the FFT demo are drawn in grey until an edit makes them complex.

Done since (from "Later"): the diffraction demo (the old LightPropagation applet) and the
Fourier-series-with-sound demo (SoundFourier), both reusing `lib/`.

Testing: 57 unit tests (`tools/run_page.py tests/index.html`, Chromium and Firefox), and a
scripted run of every demo and every experiment (`tests/ui/*.py`) that checks the physics as it
goes (Parseval, unitarity, Born, optical theorem, group velocity...).
