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

`~/mudd/brainflux` is a git repository (26 commits so far, all as you, with the attribution
lines), not pushed: create `github.com/gallicchio/brainflux` (or tell me another name), push,
and turn on Pages for `main` / root; it will be at `gallicchio.github.io/brainflux/`.  To try it
now: `cd ~/mudd/brainflux && python3 -m http.server` and open <http://localhost:8000/>.
`tools/test_all.sh` runs every test.

| demo | from | experiments |
|---|---|---|
| `fft2d/` 2D Fourier transform | FFT2D applet | 13 |
| `schrodinger1d/` Schrödinger in 1D | Schrodinger1D applet | 18 |
| `action/` the principle of least action | your idea, new | 14 |
| `schrodinger2d/` scattering in 2D | your idea, new | 12 |
| `planewave/` plane waves | PlaneWave applet | 10 |
| `diffraction/` diffraction | LightPropagation (unfinished) | 9 |
| `fourier/` Fourier series you can hear | SoundFourier (unfinished) | 6 |

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

## Prompt 2

> I'm confused when you said, "In a real image's transform, yellow-green faces violet, not red
> facing cyan." A real symmetrical image should be all red and transform into a real symmetrical
> 2DFFT, which should also be all red. Why is there any pure imaginary yellow-green and violet
> around? How sure are you that you are properly centering on zero frequency and doing the
> correct fftshift stuff?
>
> 1. If each app is very independent, I'd make one repo per demo. But if they all work together
> or rely on a lot of shared code, yes, let's make that address the remote head. I haven't set it
> up yet on github, so I'll need to do that and test the code. You should write a very brief
> overall readme that says that these things were initially developed in 2000 and 2001, left to
> stagnate due to lack of time, and revived now in 2026 with the help of Claude.
>
> 2. My photo can be under that license.
>
> 3. I don't know if bricks is taken from my photo or not. I like it more than a drawn wall
> because it's a real photo. I can try to take my own photo of bricks for you to crop similarly.
>
> 4. I don't know what sounds you're talking about.
>
> 5. Nothing in particular that I can think of. We use Townsend. Others use Griffiths. Keeping
> this independent from particular books is not a bad thing.

### Response 2 (2026-10-27)

**The colours.**  You're right about symmetric images, and the demo agrees.  My sentence was
about real images in general, and it was too terse.

- A real image has $F(-\vec k)=F(\vec k)^*$: opposite points have equal magnitude and opposite
  phase.  Red faces red and cyan faces cyan, but $+i$ (yellow-green) faces $-i$ (violet).  The
  old help text said a colour faces its complement (red facing cyan), which would be
  $F(-\vec k)=-F(\vec k)$.  That was the error I fixed.
- A real image that is also even, $f(-\vec r)=f(\vec r)$, has a real transform: red, and cyan
  where it is negative.  The square's sinc lobes and the disk's Airy rings alternate red and
  cyan.  Only a transform that is positive everywhere, like the Gaussian's, is all red.
- Fourier's portrait isn't symmetric.  Its antisymmetric part gives the imaginary part of the
  transform, which is where the yellow-green and violet come from.

**The centring.**  On both sides the origin is the pixel $(N/2, N/2)$, counting from 0; the faint
cross marks it.  The centred transform multiplies by $(-1)^{x+y}$ before and after an ordinary
FFT, which is exactly fftshift for $N$ a multiple of 4.  I measured it in the running app for
every built-in pattern:

| pattern | max $\lvert\mathrm{Im}\,F\rvert$ / max $\lvert F\rvert$ | max $\lvert F(-\vec k)-F(\vec k)^*\rvert$ / max $\lvert F\rvert$ |
|---|---|---|
| Gaussian, square, disk, ring, double slit, lattice, hexagonal (all even) | $\le 8\times10^{-16}$ | $\le 10^{-15}$ |
| portrait, text, bricks (not symmetric) | 0.06 to 0.26 | $\le 5\times10^{-16}$ |

The DC term is real, positive and at the centre in every case.  Hermitian symmetry also covers
the unpaired Nyquist row and column ($-N/2$ is its own partner).  The classic fftshift mistake
is putting the origin half a pixel off, between the four centre pixels.  That gives an even
image a phase ramp $e^{\pm i\pi k/N}$, which would show as colour drifting from red at the centre
to yellow-green and violet at the edges.  These numbers rule it out.  They are now a regression
test in `tests/ui/fft2d.py`.

One honest caveat: a shape you paint by hand is symmetric about the cross only if you centre it
on that pixel.  Half a pixel off makes the slow colour drift above; a few pixels off makes
stripes of colour (the shift theorem).

I rewrote experiment 9's help to say all this: symmetric gives real (red and cyan), Hermitian
pairs colours across the real axis, and the portrait has every colour because it isn't
symmetric.

**1. One repository.**  The demos share a lot: `lib/` holds the FFT, the expression parser with
its MathML previews, the complex colouring, the plots and the controls, and the diffraction demo
paints with the FFT demo's tools.  Splitting them would mean copying that code seven times.  So
it's one repository, and `origin` is now `git@github.com:gallicchio/brainflux.git`; nothing is
pushed.  To publish:

1. Create `gallicchio/brainflux` on GitHub, empty: no README, licence or .gitignore, since the
   repository has its own.
2. `git push -u origin main`
3. Settings → Pages → Deploy from a branch → `main`, `/ (root)`.

The site will be <https://gallicchio.github.io/brainflux/>.

The README is now a few lines: your history in your words, links to the seven demos, how to run
it, the licences.  The developer material moved to `DEVELOPING.md`.  I had dated the old
applets 2001 to 2004 from file dates in the archive.  Those dates are copies, not origins, so
the pages now give no years except yours: 2000 and 2001.

**2. Your photo** stays under CC BY 4.0, as `LICENSE-CONTENT.md` already says.

**3. Bricks.**  The old `Bricks.jpg` (400×300) was taken with a Sony Cyber-shot and saved with
QuickTime 6.3 on 1 October 2003.  No other image in the archive came from that camera, so its
origin stays unknown, and the drawn wall stays until your photo arrives.  For a photo that
works well here:

- Stand square to the wall, so the mortar lines are level and parallel with no perspective.
- Use even light, overcast or shade, rather than sun raking across the bricks.
- Get 10 to 20 bricks across, in an ordinary running bond with the rows offset by half a brick.
  The offset is what removes some of the reciprocal-lattice spots.
- Send it at full resolution.

I'll straighten it, crop it square and turn it grey.

**4. The sounds.**  The old site's `java/Resources/sound/` folder holds four recordings from the
University of Iowa Electronic Music Studios: alto sax, bassoon, flute and horn, saved in 2005.
They sit beside two unfinished `fourier.java` files and a note pointing to
theremin.music.uiowa.edu.  The new Fourier-series demo synthesises its sounds, so it doesn't
need them.  I've dropped the question.

**5. Courses.**  Agreed: the presets stay independent of any textbook.

## Prompt 3

> If you were to come up with 10 to 20 more of these in this spirit for especially for optics,
> quantum, and electromagnetic waves, what would be good to write?

### Response 3 (2026-10-27)

Twenty ideas, grouped by subject.  Each has something to drag or type, and each turns one
hard-to-picture idea into something you can watch.  Several reuse code we already have.

**Electromagnetic waves**

1. **Maxwell's equations in 2D.**  Paint glass, metal and absorber with the FFT demo's brushes
   and place sources.  A finite-difference time-domain solver shows the field and the energy
   flow in real time.  Experiments: total internal reflection, and its frustrated version
   (tunnelling for light); a leaky fibre bend; waveguide cutoff; a photonic-crystal band gap; a
   cavity ringing down; Cherenkov radiation.  Many of the ideas below could become guided tours
   of this sandbox.
2. **Radiation from a moving charge.**  Drag a charge with the mouse and see its field lines,
   computed from the retarded (Liénard–Wiechert) fields.  Stop it suddenly and a kink runs
   outward at $c$: J. J. Thomson's picture of radiation.  Shake it for the $\sin^2\theta$ dipole
   pattern, swing it in a fast circle for synchrotron beaming, or push it past $c/n$ for
   Cherenkov light.
3. **Antenna arrays and aperture synthesis.**  Place antennas and set their phases: the far-field
   pattern is the Fourier transform of the layout.  Steer a phased array, and grating lobes
   appear once the antennas are too far apart for the steering angle.  Then the radio-astronomy
   version: place dishes, let the Earth's rotation sweep them through the $uv$ plane, and watch
   the image of a source (a black-hole shadow, say) sharpen.
4. **Interfaces and thin films.**  Stack layers of any thickness and complex index, and plot the
   reflectance against wavelength and angle for s and p, with the standing field drawn inside
   the stack.  Experiments:
   - Brewster's angle, and the evanescent wave beyond the critical angle.
   - Soap-bubble colours, rendered as the eye sees them.
   - Antireflection coatings, Bragg mirrors and a Fabry–Pérot.
   - A surface-plasmon dip.

   Its 2×2 transfer matrices are the same as those of 1D quantum transmission.
5. **Dispersion and Kramers–Kronig.**  Drag Lorentz-oscillator resonances to build $\epsilon(\omega)$,
   then read off the index and the absorption.  Edit the absorption and watch the index follow
   (a Hilbert transform), in FFT2D's edit-either-side spirit.  Then send a pulse through, for:
   - group delay;
   - the "faster than light" peak in anomalous dispersion;
   - precursors;
   - a plasma frequency, which is why metals shine and the ionosphere reflects AM radio.
6. **Waveguides and optical fibres.**  Type an index profile $n(x)$.  Its guided modes are the
   bound states of a Schrödinger equation, so the 1D eigensolver finds them.  A slab guide is a
   finite square well, and a graded-index fibre a harmonic oscillator.  Experiments: cutoff, the
   single-mode condition, modal dispersion, and the TE and TM modes of a metal waveguide.

**Optics**

7. **Polarization and the Poincaré sphere.**  Stack polarizers, wave plates and rotators at any
   angle.  Watch the tip of $\vec E$ trace its ellipse while the state moves on the Poincaré
   sphere.  Experiments: Malus's law, the three-polarizer surprise, quarter-wave plates making
   circular light, and the geometric (Pancharatnam) phase of a loop on the sphere.
8. **Interferometers and coherence.**  Move a Michelson mirror and watch the fringes.  Draw the
   source's spectrum: the interferogram is its Fourier transform, and either side can be edited.
   This is how a Fourier-transform spectrometer works.  Experiments: coherence length;
   white-light fringes, which appear only near zero path difference; the beats of the sodium
   doublet; and Michelson's stellar interferometer, where fringe visibility against baseline
   measures a star's diameter.
9. **Imaging: Abbe and phase contrast.**  A 4f system (object, lens, Fourier plane, lens, image)
   in which you can paint the pupil.  It shows Abbe's resolution limit, dark field and
   schlieren.  A transparent "phase object", like a living cell, is invisible in the image until
   a quarter-wave dot at the centre of the Fourier plane reveals it.  That is Zernike's phase
   contrast: a Nobel prize in one brush stroke.
10. **Holography.**  Interfere an object wave with a reference beam and record the fringes; zoom
    in to see them.  Light the hologram again to reconstruct the virtual image and the twin
    image, and see why tilting the reference separates the two.  Cut the hologram in half and
    the whole picture survives, at lower resolution.  This reuses the diffraction propagator.
11. **The rainbow: rays to waves.**  First the ray picture: trace rays through a drop.
    Minimum deviation piles them up at 42°.  The second bow, at 51°, has its colours reversed,
    and Alexander's dark band lies between the two.  Then the wave theory: Airy's integral near
    the caustic produces supernumerary bows that no ray can explain, and they change with drop
    size.
12. **Tomography** (on your old FFT2D to-do list).  Take projections of a picture, or the camera,
    at many angles to make a sinogram, then reconstruct.  Plain back-projection is blurred;
    filtered back-projection is sharp.  The projection-slice theorem shows each projection's 1D
    transform filling in a line of the 2D transform.  This is how CT scanners work, and why too
    few angles leave streaks.
13. **Gaussian beams and laser cavities.**  Put lenses and mirrors on a bench and watch the beam's
    waist, Rayleigh range and Gouy phase.  Then the cavity stability diagram, the mode a cavity
    selects, and the Hermite–Gauss and Laguerre–Gauss modes, which have the same shapes as the
    2D harmonic oscillator's eigenstates.

**Quantum mechanics**

14. **Spin ½: Stern–Gerlach to the Bloch sphere.**  Chain Stern–Gerlach analysers along any axes,
    with atoms clicking into counters one at a time.  Then add fields, for:
    - Larmor precession on the Bloch sphere;
    - Rabi oscillation and detuning;
    - π/2 pulses, Ramsey fringes and spin echo;
    - $T_1$ and $T_2$, the language of NMR and qubits.

    Spin is where Townsend starts, and BrainFlux has nothing on it yet.
15. **Bell's inequality.**  Send entangled photon pairs to two polarizers, choose the angles, and
    accumulate coincidences into the CHSH sum $S$ as they arrive.  Then switch on a local
    hidden-variable model, or type your own, and try to beat 2.
16. **One photon at a time.**  Build a Mach–Zehnder interferometer from beam splitters, mirrors
    and phase shifters.  Photons arrive one by one, and the fringes build up from clicks.
    Experiments: block a path; mark the paths with polarization, then erase the mark (the
    quantum eraser); test bombs without setting them off (Elitzur–Vaidman).
17. **Bands.**  Type $V(x)$ for one cell of a crystal and see the band structure $E(k)$ computed
    live; click a point for its Bloch wave.  Gaps open at $k=\pi/a$: the same Bragg condition as
    the thin-film mirror (4) and the photonic crystal (1).  Add a field for Bloch oscillations
    and Zener tunnelling, or disorder for Anderson localization.
18. **Drums and billiards.**  Draw a shape and find its modes the way a spectroscopist would:
    - let a wave packet bounce around inside it;
    - Fourier-transform its motion in time, so that each peak is an energy;
    - filter at a peak to see that energy's eigenstate.

    Experiments: circle against stadium (chaos and scars), Weyl's law, and two different drums
    with identical spectra ("Can one hear the shape of a drum?"), played as sound.
19. **Phase space.**  The Wigner function $W(x,p)$ of the 1D demo's $\psi$, live: a coherent
    state circling in the oscillator, a squeezed state, a cat state whose interference fringes go
    negative, free spreading as a shear.  This might work better as a new view in the 1D demo
    than as a page of its own.
20. **Hydrogen.**  Orbitals as 3D clouds coloured by phase.  A superposition of 1s and 2p sloshes
    back and forth: an oscillating dipole that radiates at the transition frequency, which
    connects back to number 2.  Selection rules, and the Stark and Zeeman effects as mixing of
    states.

**Where I'd start**

- **Maxwell in 2D:** one solver gives you many experiments.
- **Spin ½:** it fills the biggest gap.
- **Radiation from a moving charge:** it is the hardest thing in electromagnetism to picture.
- **Thin films:** they pair with the 1D tunnelling demo.
- **Tomography:** it was your own idea, and it is mostly made of code we already have.

**Recurring ideas.**  The same idea turns up in several places:
- the Bragg gap in 1, 4 and 17;
- tunnelling in 1 and the 1D demo;
- the Fourier transform as a measuring instrument in 3, 8, 10 and 12;
- the Poincaré sphere (7), which is the Bloch sphere (14).

The help texts can point these out, so each demo reinforces the others.

All of these run in the browser with no server.  The 2D Maxwell solver and the 3D orbitals
would be faster in WebGL, which is a web standard and needs no framework; the rest would use
plain canvas, as the current demos do.

## Prompt 4

> Build 1, 2, 3, 4, 5, 8, 9, 10, 12, 13, 18, 19. Do these in parallel to the extent possible.

### Response 4 (2026-10-27)

Twelve agents are building them at once, one demo each, each in its own git worktree and branch.
Every agent got the same brief:

- the conventions of the existing demos;
- physics checked by unit tests against exact results;
- a scripted UI test of every experiment;
- screenshots looked at and improved;

plus a page of physics specific to its demo.  Each may touch only its own folder and test
files.  I merge the branches and do the shared parts: the landing page, thumbnails, README and
test lists.

| idea | folder |
|---|---|
| 1 Maxwell's equations in 2D | `maxwell2d/` |
| 2 Radiation from a moving charge | `radiation/` |
| 3 Antenna arrays and aperture synthesis | `arrays/` |
| 4 Interfaces and thin films | `thinfilms/` |
| 5 Dispersion and Kramers–Kronig | `dispersion/` |
| 8 Interferometers and coherence | `interferometer/` |
| 9 Imaging: Abbe and phase contrast | `imaging/` |
| 10 Holography | `holography/` |
| 12 Tomography | `tomography/` |
| 13 Gaussian beams and laser cavities | `beams/` |
| 18 Drums and billiards | `drums/` |
| 19 Quantum phase space | `phasespace/` |

Phase space became a page of its own rather than a view in the 1D demo.  That way it can show a
classical ensemble flowing beside the Wigner function without crowding the 1D demo.



**Result.**  All twelve are built, merged into `main` and on the landing page, marked *beta*
(Prompt 9).  Each has its physics in modules that don't touch the page, unit tests against
exact results (in Chromium and Firefox), a scripted UI run of every experiment, and help text
whose every quoted number was measured in the running demo.

| folder | demo | experiments | unit tests |
|---|---|---|---|
| `maxwell2d/` | Maxwell's equations in 2D (FDTD, PML, beams, meters) | 14 | 17 |
| `radiation/` | Radiation from a moving charge (Liénard–Wiechert) | 14 | 16 |
| `arrays/` | Antenna arrays and aperture synthesis | 13 | 17 |
| `thinfilms/` | Interfaces and thin films (transfer matrices, true colour) | 13 | 24 |
| `dispersion/` | Dispersion and Kramers–Kronig | 14 | 16 |
| `interferometer/` | Interferometers and coherence | 14 | 19 |
| `imaging/` | Imaging: Abbe and phase contrast | 14 | 17 |
| `holography/` | Holography | 13 | 14 |
| `tomography/` | Tomography | 13 | 16 |
| `beams/` | Gaussian beams and laser cavities | 14 | 12 |
| `drums/` | Drums and billiards | 14 | 17 |
| `phasespace/` | Quantum phase space (Wigner, Husimi) | 13 | 17 |

What the agents asked of the shared code, and what I did at the merges:

- The formula translator: `\sin^2` made invalid MathML (the power now goes on the name);
  `\text{...}` lost its spaces; `\%` was an error; a script after `\right]` stopped the
  brackets stretching.  All fixed, with tests.
- The 2D scattering UI test waited on the clock and failed when sixteen agents loaded the
  machine; it now steps the simulation itself (`__app.runUntil`).  `tools/cdp.py` waits up to a
  minute for Chromium to start.
- `tools/thumbs.py` makes each card's picture from the running demo.
- Code shared between demos: imaging, tomography and holography reuse the 2D FFT's brushes and
  pictures; holography's and beams' tests check themselves against the diffraction demo's
  propagator; phase space uses the 1D Schrödinger solver.  Two near-duplicates are left to
  merge later: the CIE colour fit (thin films and interferometers) and the wavelength colour
  (diffraction and holography).

## Prompt 5

> Set the remote to https://github.com/gallicchio/brainflux and I'll push and test the site.
>
> The origin should be through ssh: git@github.com:gallicchio/brainflux.git

### Response 5 (2026-10-27)

`origin` is `git@github.com:gallicchio/brainflux.git`.  Push `main` only; the agents' branches
are unfinished demos.

## Prompt 6

> I have look at the first ones.
>
> On the 2D FFT app, you have buttons to select "1" "-1" "i" and "-1" but selecting exactly
> zero is the most useful. Even though that's the same as the eraser, it would be a good
> button to have. You should make the magnitude and angle not a display, but something you can
> input. You should also have real and imaginary text inputs. The "Disk" preset at 128 pixel
> resolution looks more like an octagon. Maybe it needs to be bigger.
>
> On the 1D Scrhrodinger, For the Harmonic potential, change Ground to "n=0". The Swueezed
> initial state is both squeezed and displaced. Make it only squeezed (set k0 and x0 to zero
> when the button is pressed). The momentum-space plot should have text on the top left that
> says "Momentum" and should be labeled as phi(p) not psi(p). When I click "Infinite Well" it
> goes too fast -- make k0 2 rather than 5. Also, it would be nice to see the gray bands on
> the sides of the plot to visually see the difference between "Free" and "Infinite well".
> Maybe change the range of the plot to go from -1 to 11 or something. The "(x>-1)(x<1)" as an
> initial typed state doesn't make much sense, since it goes nuts quickly. Pick a more
> reasonable "Typed" state to start with for each potential. The red dot and red dotted line
> don't make much sense. (What even is that?) Oh, i see, it's "Classical". Start with the
> Classical button turned off. Presumably the black triangle is the expectation value, but
> maybe showing that with +-1sigma bars would be good. The initial wave function buttons are a
> bit confusing. For the Harmonic potential, for example, if I click "Coherent", why isn't the
> Coherent button highlighted? The default initial wave function for each potential should
> look like it was selected, and I should be able to select others. The distinction between
> the preset options and the buttons like "Packet", "Stationary", "Two states", and "Typed" is
> a bit confusing. The section called "Measure" Should be called "Make a Measurement" because
> otherwise it just sounds like you're asking the interface to add a measurement to the plot
> rather than to do a quantum mechanical measurement. For the Finite well, it might be nice to
> show a version of "Packet passing" that resonates with the well and one that does not.
>
> Put the "Scattering in two dimensions" as the 3rd one, on the top right of the app selection
> page. The Weak bump is so weak that its affect is not that different from having no bump at
> all.  Maybe make V0=1 unless there is a compelling reason to make it less. For the Double
> slit, why can't the prediction go at least to +- 90? For the Crystal, I was expecting some
> interesting Bragg stuff. Maybe make the initial parameters show interesting scattering.
> Maybe you need another parameter for the incoming position and momentum angle or something.
>
> "The principle of least action" one is not ready for prime time. List that one later in the
> page of apps. On the x vs t plot, how do you set the velocity?  If the idea was that the
> dots were equally spaced in time, you should be able to drag them left and right too, such
> that you reach those dots eariler or later. Initially, you should have all plots come up at
> their classical solution for the given boundary conditions, and dragging should only make
> things worse. For things like the pendulum or harmonic oscillator, how do are we supposed to
> indicate a closed path in phase space?
>
> For the Diffraction, the "z (mm)" slider should slide far enough out that you can see
> basically the same pattern as you see when you press "Far field". In fact, pressing "Far
> Field" should just move the slider to the end of the range. As i change the slider, things
> don't always make sense in the plots. I don't know if this is a resolution effect or what,
> but deeply investigate this. Often you get really crazy looking patterns for large z that
> are not anything like the Far field. The "Zone plate" does not look great, again probably
> because of a resolution issue.

### Response 6 (2026-10-27)

The 2D FFT changes and the landing page order are done here.  Four agents are revising the 1D
Schrödinger, 2D scattering, least action and diffraction demos, each in its own worktree, with
your notes verbatim in its brief.

**2D FFT.**  A `0` button.  Under the wheel, the paint is now four boxes you can type in:
Re and Im, and magnitude and angle in degrees; typing in one pair updates the other.  The disk
was a pixelated circle of radius 9 pixels at 128.  It is now sampled 4 × 4 times per pixel, so
its edge is a ramp of greys, and its radius is 0.1 of the image (13 pixels at 128).  The disk
and its Airy rings are now round.  A test checks its area against $\pi R^2$.

**Landing page.**  Scattering in 2D is third, at the top right; Least Action is last.

The four revisions, merged:

**1D Schrödinger.**  Every point is done.
- The initial states are one row per kind (Packet · Coherent · Squeezed, Stationary · n = 0 ·
  n = 1, ...), with exactly one button lit: the potential's default when it loads, the kind's
  own button when a slider takes you away from a named state.
- "Ground" is "n = 0".  Squeezed starts at $x_0=k_0=0$.  The plots are labelled Position and
  Momentum, and the momentum one says $\phi(p)$.
- The infinite well starts at $k_0=2$, and the view runs from −1 to 11 with grey walls.
- Classical starts off.  $\langle x\rangle\pm\sigma_x$ and $\langle p\rangle\pm\sigma_p$ are bars.
- "Make a measurement".  Each potential has its own smooth typed $\psi_0$.
- Finite well: "On resonance" passes 98.5% ($2ak'=3\pi$), "Off resonance" 31%.  The well had to
  be deepened from $V_0=5$ to 7: at 5, no energy transmits less than about 77%.
- Found on the way, by the phase-space agent: the smooth double well was being treated as if
  it had jumps and softened, which moved $E_0$ from 1.44057 to 1.44942 and the tunnelling period
  from 56.2 to 55.2.  Jumps are now found in the fine samples, and smooth potentials are used
  exactly as typed.

**2D scattering.**
- Weak bump: $V_0=1$ (18% of the packet scatters; Born is 7% high).
- Double slit: the prediction never reached ±90° because none was drawn; the panel switched
  itself off for any wall.  It now measures the flux of $\psi$ through the far half of the
  detector circle against Fraunhofer's pattern over the whole −90° to 90°; they agree to ±88°.
- Crystal: a *turn* slider sets the incoming direction.  At the Bragg angle ($2c\sin\alpha=
  \lambda$, $\alpha=30°$) 26% of the packet reflects to 60°; at 20°, 4.5%.  Momentum space shows
  the reciprocal lattice and the energy circle (Ewald's construction).

**Least action.**
- Knots move in time as well as space: up and down sets where, sideways sets when.  The slope is
  the velocity: point at the path to read it.
- Every set-up starts on its true path, so dragging makes $S$ worse, except where the true path
  is a saddle, which experiment 6 is about.  *Back to true path*, *Bend it*, *Straight line*.
- Closed paths: a *Periodic* end condition for the oscillator and pendulum.  With two fixed
  ends at two times, the true path covers only an arc of an energy contour; it closes only if
  it returns to the same point with the same momentum after a whole period.  In Periodic mode
  the two ends are one free knot, stationarity there gives $p(T)=p(0)$, and the true orbit is a
  closed loop.  For the oscillator every amplitude has period $2\pi/\omega$; for the pendulum
  the period grows with the swing, so $T$ picks the amplitude.
- Still marked beta until you have looked again.

**Diffraction.**  The large-$z$ patterns were wrong, and why:
- The field lived on a fixed 4.1 mm grid that wraps round.  Beyond $z_c=N\Delta x^2/\lambda=60$
  mm the steepest light left one side and came back on the other.  The view was always the
  middle 2 mm, so the pattern also outgrew it.  "Far field" was a separate calculation in other
  units.  Against an exact Fresnel integral the slit was 11% wrong at 0.5 m and 212% at 3 m.
- Now: the angular spectrum up to $z_c$, then a Fresnel transform whose grid grows with $z$, the
  view zooming out with it.  The slider is logarithmic from 0.1 mm to 10 m, and *Far field*
  moves it to the end, where the picture matches Fraunhofer to about 1%.  The slit is within
  0.15% of the exact integral from 0.2 m to 10 m.
- The zone plate's rings were narrower than two pixels and aliased.  Apertures are now
  area-sampled, rings are at least 2.5 pixels wide, and the zone plate and lens open at the
  focus on a linear intensity scale, zoomed 4×: a bright spot on a dark screen, 305 times the
  incident intensity (324 in theory).

## Prompt 7

> Keep going. Did the 1D Schrodinger fixes get committed to main? The Squeezed state still seems
> to start offset and the Infinite well starts too fast. I would guess that the fixes aren't in
> yet.

### Response 7 (2026-10-27)

Right: they weren't merged yet.  The agent was still working, with sixteen agents loading the
machine.  They are now (see Response 6).

## Prompt 8

> Keep going. One slightly annoying quirk of the "Schrödinger equation in one dimension" is the
> text display at the top. As the significant figures change in things like <x> or <p>,
> everything moves around. These text items should be fixed in position and not depend on the
> actual numbers displayed, especially not on the number of significant figures and whether or
> not there is a minus sign or a decimal point.

### Response 8 (2026-10-27)

Made a rule for every demo.  Each live number now has a slot of fixed width, with fixed
decimals, a place kept for the sign (a true minus, and a figure space for plus), and right
alignment; it goes to powers of ten only if it would overflow.  The 1D Schrödinger, 2D
scattering and least-action agents, and the three still building new demos, applied it
themselves; another agent swept the other thirteen.  Every one of them had numbers that moved
something: up to 700 px in the dispersion demo's pulse readout, where the line rewrapped.
`lib/ui.js` has `fixedNum`, `setSlots` and `setGroups`, and `lib/plot.js` has `fillSlots` for
text drawn on canvases.  Every UI test now checks that labels and numbers stay within 0.5 px
while the numbers change.

## Prompt 9

> As you make the new demos, make sure that they are included on the main page, but mark them as
> being beta.

### Response 9 (2026-10-27)

Every new demo got its card as it was merged, with a red *beta* badge, and the introduction
says what it means.  I marked Least Action beta too, since you said it wasn't ready.  The order
is the six finished demos, then the new ones in the order of the list of ideas, then Least
Action.  The README lists them the same way.
