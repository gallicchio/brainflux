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
  lesson), Gaussian, box (sinc), disk (Airy), ring, slits, gratings, lattices, the author's
  photograph of a brick wall, points, text you
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
    the Born prediction |V~(k - k0)|^2 and the measured dsigma/dtheta drawn round it and the
    momentum transfer q = k - k0 as an arrow (drawn 2026-11-04);
  - dsigma/dtheta measured from the flux through a circle, against the Born approximation and,
    for the disk, the classical cross section (r/2)|sin(theta/2)|, sigma = 2r (2026-11-04);
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

### `quantumoptics/`: squeezed light and LIGO (built 2026-11-04; the plan as written)

Continuous-variable quantum optics, worked up to LIGO's use of squeezed states.  The story:
one mode of the field has two quadratures, X and P, with ΔX ΔP ≥ ½; a coherent state is the
classical limit, a circle of noise in the quadrature plane (the same picture as the
phase-space demo's Wigner function, which it should reuse) turning at the optical frequency;
a squeezed state is the ellipse, narrower in one quadrature and wider in the other, the
product kept; homodyne detection beats the field against a local oscillator and the
oscillator's phase chooses which quadrature is read, so the measured noise shrinks and grows
as the phase turns; a measurement of a phase with each kind of state, with its
signal-to-noise and the standard quantum limit; then LIGO: an interferometer's arm length
read as a phase at the dark port, the shot noise of the coherent light, the squeezed vacuum
injected at the dark port (the 2019 result, about 3 dB of improvement), the trade against
radiation-pressure noise at low frequency, and the frequency-dependent squeezing of 2023.
Live pictures: the quadrature plane with the state's noise cloud and the homodyne axis;
the photocurrent's noise against the local oscillator's phase; the interferometer's
strain sensitivity curve with and without squeezing.  A placeholder card is on the landing
page.

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

## Status, 2026-10-27 (evening)

Twelve more demos, from the list of ideas in `CLAUDE_CODE_CHAT.md` (Response 3), built in
parallel by agents in git worktrees and merged: `maxwell2d/`, `radiation/`, `arrays/`,
`thinfilms/`, `dispersion/`, `interferometer/`, `imaging/`, `holography/`, `tomography/`,
`beams/`, `drums/`, `phasespace/`.  They are on the landing page marked *beta* until the author
has tried them, as is `action/`, reworked (knots that move in time, true paths at the start,
periodic orbits).  The 1D Schrödinger, 2D scattering and diffraction demos were revised after
the author's first look (Response 6), and every live readout now keeps its numbers in
fixed-width slots (Response 8).

Left for later:

- Merge the near-duplicates: the CIE colour fit (`thinfilms/`, `interferometer/colour.js`) and
  the wavelength colour (`diffraction/`, `holography/`) into `lib/`.
- `lib/mathml.js`: matrices.  `lib/ui.js`: `guessRange` makes `n` a 0-10 integer (wrong for a
  refractive index); log sliders ignore `step`.  `lib/plot.js`: a log y axis.
- `fft2d/presets.js` finds its images relative to the page; `import.meta.url` would let other
  demos load them without the `../fft2d/` prefix.

## Status, 2026-11-02

After the author's first look at the beta demos (Prompt 13 in `CLAUDE_CODE_CHAT.md`), seven
were revised for a junior's understanding and ease of use, and all thirteen audited for their
physics (every equation, sign, number and sentence of help, the numbers measured in the
running pages):

- `dispersion/` starts from the driven oscillator: a charge on a spring and the wave meeting
  the medium, live at the frequency you choose; Kramers–Kronig one sliver of absorption at a
  time; the pulse drawn inside the medium, its crests at $c/n$ and its peak at $c/n_g$.
- `interferometer/` scans both sides of equal paths (motor, spectrometer, transform).
- `imaging/` has a live side view of the microscope, controls in light-path order, one set of
  pupil tools.
- `holography/` opens on one point and tells it as record, then relight, with the three beams.
- `tomography/` ties the panels together by colour, steps one angle at a time, and points from
  any panel to the others.
- `beams/` has defaults that show a waist, a Rayleigh range and a refocus on the bench, and a
  cavity whose spectrum shows its modes order by order.
- `action/` drags one way at a time, scores your path against the true one, and offers wrong
  paths in one click.

Physics errors found and fixed in nine of the thirteen (see the log); none in `radiation/`,
`arrays/`, `drums/`, `phasespace/` beyond wording.

Left for later, besides the list above:

- Still pictures for each experiment ("Every Animation has Key Frames saved as Pictures").
- `lib/plot.js`: the y label sits at x = 12 whatever the tick labels' width.  `lib/mathml.js`:
  no space after a function name before a number (`\cos 2\pi` reads "cos2π").  `lib/` sets
  `touch-action: none` on every canvas, so a swipe over a plot doesn't scroll a phone's page.
- Imaging: a hollow-cone condenser with a matching phase ring (the real phase-contrast
  microscope).  Interferometer: dispersion in an uncompensated arm.

## Status, 2026-11-03

The author's second look (Prompt 14): "from the moment the apps are opened, someone who has a
little exposure to the concepts understands how to play with them".  One standard for all
thirteen beta demos, in `CLAUDE_CODE_CHAT.md` (Response 14) and in two shared styles:

- `.hint`: a one-line hint on or directly under the main picture saying what to drag or click,
  visible on opening, at phone width too.
- `.drawer .start`: the drawer opens with "Start here", in plain words and without equations;
  the theory and the conventions go at the end under "How it works".
- Readouts carry words, not bare symbols; the opening is the simplest instance of the idea and
  is experiment 1; jargon gets a gloss under its control; the obscure controls fold under
  "More".

Openings changed: imaging (Abbe's grating in bright field), phase space (the coherent state
circling in the harmonic well), tomography (three disks, three panels), drums (a struck drum).
The cards keep the pictures that look best, by `#setup=` addresses in `tools/thumbs.py`.

Left for later, besides the lists above:

- `lib/style.css` gives every canvas `touch-action: none`.  On a phone a finger can't scroll
  the page from over a picture that fills the width.  Some demos set `pan-y` on canvases that
  take no drag; the rest would need `none` only while a drag is in progress.
- The six finished demos (FFT, 1D and 2D Schrödinger, plane waves, diffraction, Fourier
  series) haven't had the same first-minute pass; their drawers still open with the theory.

## Status, 2026-11-03 (afternoon): paused

The six finished demos were reviewed conservatively (Prompt 15): three errors in the code
fixed (the 1D demo's cell at x = 0, the diffraction lens's chromatics, the 2D scattering
radial solver's start and runs that ended with probability still in the box), many help
claims corrected after measuring, a hint and a Start-here block on each, nothing added or
removed.  `arrays/` lost its aperture-synthesis view (on a branch, merged with the new app).

Four new demos were being built when the session's credits ran out.  Their work is pushed
to GitHub on `wip/` branches, unmerged, each from `main` at b0928ed:

- `wip/radiointerferometer`: the physics modules with 14 passing unit tests (registered in
  `tests/index.html`), and the whole page: four views, 17 experiments, every set-up loading
  without errors.  Left: the UI test, layout fixes listed in the agent's report (titles cut
  off, the arrow overlapping a title, the uv axis labels), the quoted numbers checked, the
  thumbnail (`#setup=uv`), the card.
- `wip/arrays-phased-only`: `arrays/` without its synthesis view, redirecting the old
  synthesis addresses to `../radiointerferometer/`.  Merge it together with the radio demo.
- `wip/mri`: `mri/phantom.js`, `bloch.js`, `scan.js` and `tests/mri.test.js` (12 of 17
  pass; the five failures are test-side, listed in the agent's report).  No page yet.
- `wip/oct`: `oct/source.js`, `sample.js`, `tdoct.js`, `fdoct.js`, `scan.js`, `pictures.js`,
  verified in Node against closed forms.  No page, no tests yet.
- `wip/nmr`: the physics modules and unit tests, not yet run.  No page yet.

The briefs are in the chat log (Prompts 15–17) and in the agents' final reports there.  To
resume each: continue the branch (the page, the UI test, the thumbnail), register the test
file in `tests/index.html`'s list, add the card to the landing page and the line to
`README.md` and `tools/thumbs.py`, run `tools/test_all.sh`, merge.  Then the quantum-optics
demo (the TODO above).

## Status, 2026-11-04

The four paused demos are finished and merged, marked beta on the landing page:
`radiointerferometer/` (one source's noise and its autocorrelation; two antennas and two
sources with live streams, the fringe and the cross terms dying; the uv plane with the
correlator's dot settling on the colour under the pair, the Etch-a-Sketch and HBT; a whole
array and Earth rotation with the dirty image, the dirty beam and CLEAN), `nmr/` (one spin,
many spins, pulse sequences, the Earth's-field board), `mri/` (one axis, a slice, the second
axis filling k-space, contrast and artefacts, Lauterbur) and `oct/` (fringes from a layer,
the A-scan, the B-scan and a 3D volume, Fourier-domain OCT).  `arrays/` is the phased array
alone and forwards its old synthesis links.  The `wip/` branches are superseded by `main`.

Left for later, besides the lists above:

## Status, 2026-11-04 (evening)

The 2004 rule "Every Animation has Key Frames saved as Pictures" is met: every guided
experiment in every demo (more than 330 of them) shows a still picture of itself working, under
its "Set it up" button, made by `tools/frames.py` from each demo's `frames.json` and checked by
`tools/frames.py --check` in `tools/test_all.sh`.  The natural follow-ups of the new demos are
done (Response 22 in the chat log): the chirp buried in noise and its matched filter (quantum
optics); the board's tank tuning and the coil's angle (NMR); Born on the momentum circle and
the classical cross section (2D scattering); B-scan averaging, a flattened en-face slab and a
scan worker (OCT); the dirty image, CLEAN and maximum entropy shown at work, and HBT's
autocorrelation (radio); the Earth's field and 5 MHz magnets and the decay during the readout
(MRI).

Left for later:

- NMR: the receiver's noise shaped by the tank across the record's band; GAIN LOW/HIGH and the
  CAL IN sweep; the bank tunes down only to 1061 Hz (24.9 µT).
- MRI: the gradient's sideways field drawn, not only stated, at 46 µT; noise scaling with field
  at the scanner fields; partial volume across the slice.
- OCT: finding the layer in the image (segmentation); OCT angiography (speckle changing between
  repeats where blood flows).
- Radio: a tapered default for maximum entropy (its uv tile shows a faint cross); multiscale
  CLEAN and compressed sensing (named only).
- Quantum optics: the matched filter over both phases (LIGO's); the template's wrap-around.
- `lib/plot.js`: a log axis; `tickLabel`'s four significant figures can repeat labels near a
  large value.
