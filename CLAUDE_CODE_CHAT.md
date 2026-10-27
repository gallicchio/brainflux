# Claude Code Chat Log: BrainFlux, interactive physics demos reborn from 25-year-old Java applets

Every prompt, verbatim (minor typos fixed), followed by the response as it was given.  The old
site (brainflux.org, offline since the 2010s) is archived at
`/home/jason/mnt/local4TB/2TBext4/frank/brainflux`; its Java sources are under `java/src/brainflux/`.
Model: Claude Opus 5.5.

## Prompt 1

> Over 25 years ago, I wrote two Java applets that I'd like you to update to be interactive
> JavaScript hosted on GitHub as open source projects. It should run on all major modern browsers
> and be future proof by keeping things simple and standards compliant without relying on many (or
> perhaps any) frameworks whose maintenance I'll be tied to and forced to track. The entire content
> for my old site (now offline) is in /home/jason/mnt/local4TB/2TBext4/frank/brainflux.
>
> One applet is a 2D FFT demo, where you can do stuff on one side of a 2D FFT pair and have it show
> up on the other side. For example, you can load a picture of Fourier and low-pass filter it by
> erasing (zeroing) all of the high frequency pixels in the FFT. As you do this, you see the low
> pass filtering happening in real time. There are other examples of things you can do in the web
> pages and code. The new version shouldn't be a one-to-one port, but instead should keep the
> real-time, educational, interactive spirit.
>
> The second one that I'd like to see is a 1D Schrödinger equation simulator. You can choose a
> potential from some options or type one in, choose an initial wave function from options that are
> appropriate for that potential or type one in, and then hit "play". It will do a numerical
> forward time evolution. Again, the port does not need to be one-to-one. In particular, the method
> of forward evolution was chosen for its simplicity and speed rather than its stability and
> accuracy. Whatever you implement should still show up as a very smooth animation whose speed can
> be increased or decreased for educational and illustrative purposes.
>
> For either of these, feel free to fix any bugs or add any features that would be educational and
> would not overwhelm the user with choices and options.
>
> Start one or more git projects that will eventually be pushed to GitHub. I'd like there no
> server-side component to these so that they can be hosted directly from GitHub. Make the license
> a permissive MIT license and/or permissive creative commons with attribution where appropriate.
>
> Feel free to look through the code and other documents for other ideas of abandoned applet ideas
> from over 25 years ago and implement those too.
>
> One idea that I may or may not have mentioned is a theoretical Lagrangian mechanics demo, where
> students can "draw" paths in phase space (probably by tweaking spline or Bezier curve control
> points rather than free hand). There would be a "live plot" of the action for that path through
> phase space. As you drag, the live plot gets additional points added to the right and scrolls
> over such that the user would have a record of how well they were minimizing (or maximizing or
> otherwise extremizing) the action. They should be able to find the phase space path of least
> action when they "draw" the correct path, and other paths should lead to less minimal action. The
> pedagogically difficult thing here is to choose interesting and illustrative examples that can be
> solved with the solutions they learn in class or in the homework, while allowing enough freedom
> to type in interesting new potentials and draw paths that can minimize those.
>
> Another applet I wanted to write was a 2D version of the Schrödinger time evolution. The most
> common set of examples would be Gaussian wave packets scattering off of different potentials. It
> should be flexible enough to illustrate (in the limit of plane-wave like packets) partial wave
> scattering and the Born Approximation and the optical theorem and other things that students
> encounter in their first exposure to scattering theory.
>
> I expect you to work for many days, if not weeks on this, so take your time and do it right. The
> target audience is physics majors who are sophomores through seniors.
>
> Record this as a prompt in a CLAUDE_CODE_CHAT.md file and reply to it there and in the chat. This
> is similar to how I've had you record such prompts and responses in my work with you in `~/pcbs`.

Added while I worked, after I mentioned the photo in the old FFT2D screenshot:

> That is a photo of me. That doesn't need to be the first photo. I liked the drawing of Fourier
> because low-pass filtering the stripes on his shirt were a good illustration of the technique.

> Oh yeah, add that plane-wave demo to the list of things you'll make.

### Response 1 (2026-10-26, 21:40 onward; this entry is kept up to date as the work goes on)

**Reading the old site (21:40-21:55).**  The two applets are `java/src/brainflux/fft2d` and
`schrodinger1d`; a subagent swept the rest of the 16,600 files for abandoned ideas.  There is no
code or note anywhere for the Lagrangian demo, 2D Schrödinger or scattering (all new).  Found:
the PlaneWave applet (four sign conventions of exp(i(±k.x∓wt))), a LightPropagation applet
(painted aperture, propagated), SoundFourier/InstrumentFourier (Fourier series you hear, U. Iowa
instrument samples), RLC and spherical-harmonics stubs, a delta-function potential that only
survives in `java_old.tar.bz2`, a Mathematica notebook for the V = a|x| well, planned E(x),
B(x), A(x) panels for the 1D applet, and `About/Philosophy.xml`, whose rules ("Easy Startup",
"Interesting Presets", "Sliders, not Text Boxes") are now the design rules in `PLAN.md`.
Bugs in the old code, not carried over: the |.|^2 display never worked (`type != MAG2 ||
type != MAG2_PHASE` is always true), the probability current used a backwards, half-size
derivative and filled every other point, and the kinetic energy was p^2/m.  The old solver was
Crank-Nicolson (unitary), not forward Euler.

**Decisions (`PLAN.md`).**  One repository, `brainflux` (github.com/gallicchio/brainflux, so
gallicchio.github.io/brainflux/), one folder per demo and a shared `lib/`.  Plain HTML, CSS and
ES modules: no frameworks, no build, no CDN.  Equations as MathML (native in every browser
since 2023) from a small TeX translator of our own.  Code MIT, text and pictures CC BY 4.0.

**2D Fourier transform (`fft2d/`, committed 22:25).**  Paint on either side, the other follows
every frame (256^2 FFT in 2 ms, 512^2 in 12 ms).  Hand, brush, eraser, and a mask that is
scrubbed live (a low-pass or high-pass filter as you drag), mirror painting (keeps the other
side real), lattice repeats, zoom, undo, operations (keep magnitude/phase/Re/Im, graft the phase
of a remembered transform), a gallery led by the Boilly engraving of Fourier and his jacket at
1:1 (your photo is in it, last), your own picture by file, drop or paste, and the camera.
Photos are drawn in grey until an edit makes them complex.  Thirteen guided experiments.

**1D Schrödinger equation (`schrodinger1d/`, committed 23:55).**  Split-operator evolution.
Twelve potentials including the old delta and V = F|x| and new ones (bouncer, tilted lattice
for Bloch oscillations, driven oscillator), typed V(x, t) and psi0 with automatic sliders,
stationary states with the state's weights |c_n|^2, measurement of x and E, a classical
particle, momentum space, a space-time carpet, play backwards (stops at t = 0), eighteen
experiments.  The hard part was sharp potentials: a step makes the split-operator method heat a
bound state tenfold.  Fixed by measuring, not guessing: steps are band-limited (reflection
stays that of the sharp step: R = 0.0941 against 0.0943), walls taller than 30 are rounded,
static potentials are cell-averaged so an edge sits where it was typed, and the time step
follows the potential where the wave function is.  33 unit tests and a scripted run of every
experiment pass.

**The principle of least action (`action/`, new).**  Paths are drawn as q(t) through knots you
drag (a smooth spline or straight segments); the action updates live and every change is added
to a strip chart, so the record of your descent is there as you asked.  On "phase space": the
Lagrangian action, a functional of q(t), is the one that is (often) minimal; the phase-space
action with p varied freely is never minimal (for each q(t) it is a maximum over p, which gives
back the Lagrangian action), so the path is drawn in (t, q) and its image in phase space,
(q, dL/dq'), is drawn beside it over the contours of H: the true path follows one contour, a
drawn one crosses them.  True paths are found by shooting, each labelled minimum or saddle by
its Morse index (Jacobi equation).  Systems chosen so the answers are homework answers: free
particle (S = m dx^2/2T), throw and catch (-m g^2 T^3/24), harmonic oscillator (a minimum
only while T < pi/omega: beyond it "Roll downhill" runs away below the true action), pendulum
(five true paths between the same events), twin paradox (S = -m tau: most proper time),
Fermat (mirage, refraction: Snell's law is the conserved H), brachistochrone (the cycloid),
typed V(x, t) or L(x, v, t) (e^{gamma t}(v^2 - x^2)/2 is a damped oscillator).  Also hints
(arrows: where each knot should go), the energy along the path (flat only on the true one), and
Feynman's phasor e^{iS/hbar}.

**Scattering in 2D (`schrodinger2d/`, new).**  Split-operator on 256^2 with an absorbing
border.  The incident Gaussian is known in closed form, so psi_sc = psi - psi_inc is exact; on a
detector circle the outward flux gives dsigma/dtheta, the interference flux gives the shadow,
and time Fourier transforms at the central energy give S_m = e^{2 i delta_m} for every partial
wave (Hankel functions, no far-field approximation; corrected for the beam's own partial-wave
content, which was the last 9%).  Checked: a weak bump against Born to 0.5%, a tall disk with
|S_m| = 1 to 0.4% and the optical theorem to 0.05%, the shadow equal to the scattered flux.
Targets: hard disk (with the exact hard-disk curve), weak bump, attractive well (resonance),
screened Coulomb, two disks, double slit, crystal (Bragg), typed V(x, y).  A collision takes
about four seconds.

**Plane waves (`planewave/`, from your PlaneWave applet).**  Drag k; the four sign conventions
and which way each travels; a crest tracker and the phasor at the origin; two waves (standing,
crossed, beats); and a packet, with phase and group velocity as the chord and tangent of
omega(k) for light, Schrödinger, deep water, relativistic or typed dispersion.

**Two more from the old site.**  *Diffraction* (`diffraction/`, the LightPropagation idea):
paint an aperture, slide the screen from near field to far field by the exact angular
spectrum method, with a side view (the Talbot carpet, the zone plate's focus), the Arago spot,
white light, speckle.  *Fourier series you can hear* (`fourier/`, the SoundFourier idea):
draw a period or drag its harmonics and listen through Web Audio; Gibbs, phases the ear can't
hear, the missing fundamental.  I did not bundle the U. Iowa instrument recordings from
`java/Resources/sound/` (their terms need checking); the sound demo synthesises instead.

**Testing.**  57 unit tests in Chromium and Firefox, and a scripted student for every demo
that runs every experiment and checks physics along the way.  Screenshots were looked at for
every experiment, in light and dark, at desktop and phone widths.

**Links that carry a set-up** (2026-10-27).  The address bar keeps the set-up as you change it:
in the 1D demo the typed potential, its parameters and the initial state; in the action demo the
drawn path itself; in the 2D demo the typed target and the packet.  Copy the address into a
homework and students open exactly that.  `#setup=<name>` opens a guided experiment.  Also a
probability-current view in 1D (blue flowing right, red flowing left: tunnelling made visible).

**An independent review** (a second agent given the code, not my conclusions, 2026-10-27)
found about 30 bugs, 15 of them serious, and I fixed all of them, each with a test where a
test could catch it again.  The ones worth knowing about:

- *Chained comparisons*: `-1 < x < 1` meant `((-1 < x) < 1)`, the complement of the box, while
  the preview showed what you typed.  Now it means what it says, in every demo.
- *Plane-wave packets*: the k < 0 components ran the wrong way (a sign), so wide packets moved
  at twice dω/dk.
- *Slow packets in 2D* reflected off an absorbing border thinner than their wavelength (σ for
  V = 0 came out −0.71).  The border now grows with the wavelength; and the 2D demo now
  computes, for any potential of r alone, the exact phase shifts of the stationary problem from
  the radial equation: the movie's S_m agree with them to 8e-3, σ to 0.1%.
- *The FFT demo's mirror* (keep the picture real) was a pixel off for even brush sizes, and
  switching tools by key in the middle of a drag crashed or zeroed the picture.
- *1D*: the "run it backwards" experiment never reached the barrier (its fast-forward was capped
  by the frame budget); measuring the position reset the clock; the delta's numbers in the help
  were for a different grid (it is now a Gaussian of exact area α, and the help quotes what
  the demo shows: level −0.465, transmission 0.51).
- *Help text*: for Schrödinger waves crests are born at the front of a packet (I had the back),
  a real image's transform pairs yellow-green with violet (not red with cyan), the mirage's ray
  dips.

### Where it stands

`~/mudd/brainflux` is a git repository (23 commits so far, all as you, with the attribution
lines), not pushed: create `github.com/gallicchio/brainflux` (or tell me another name), push,
and turn on Pages for `main` / root; it will be at `gallicchio.github.io/brainflux/`.  To try it
now: `cd ~/mudd/brainflux && python3 -m http.server` and open <http://localhost:8000/>.
`tools/test_all.sh` runs every test.

| demo | from | experiments |
|---|---|---|
| `fft2d/` 2D Fourier transform | FFT2D applet (2001) | 13 |
| `schrodinger1d/` Schrödinger in 1D | Schrodinger1D applet (2004) | 18 |
| `action/` the principle of least action | your idea, new | 14 |
| `schrodinger2d/` scattering in 2D | your idea, new | 12 |
| `planewave/` plane waves | PlaneWave applet (2002) | 10 |
| `diffraction/` diffraction | LightPropagation (2004, unfinished) | 9 |
| `fourier/` Fourier series you can hear | SoundFourier (2002, unfinished) | 6 |

### What I need from you

1. **The repository's name and the push.**  I used `brainflux`; the pages link to
   `github.com/gallicchio/brainflux`.
2. **Your photo** (`fft2d/images/author.jpg`, from the old applet) is in the gallery, last, and
   is the "magnitude donor" in the phase-swap experiment.  It is listed in `LICENSE-CONTENT.md`
   as yours under CC BY 4.0: is that what you want?
3. **`Resources/fft2d/Bricks.jpg`** carries a Sony Cybershot's EXIF: if it is your photo it
   could replace the drawn brick wall.  I left out the baboon (the USC-SIPI mandrill, unclear
   licence), the stone-texture catalogue photos and the Lena image.
4. **The U. Iowa instrument recordings** in `java/Resources/sound/`: the sound demo synthesises
   instead.  If you want recorded instruments, I'll check their current terms.
5. **Your courses**: potentials, paths or targets you assign in homework that should be presets.

Everything is tested by `tools/test_all.sh` (unit tests in Chromium and Firefox, then a
scripted run of every demo and experiment); it passes.

### What I'd do next

Live filtering of the camera in the FFT demo (paint a mask on the transform and see your own
face low-passed as you move), a polar plot option for the cross section, and whatever your
students trip over.
