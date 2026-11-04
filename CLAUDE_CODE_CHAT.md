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

## Prompt 10

> Commit and push whatever needs it.

### Response 10 (2026-10-27)

Committed the chat log and the plan.  The push failed from this session (`Permission denied
(publickey)`: no SSH agent here, and the only key offered was refused), so that one commit was
left for you to push.  The full test run then passed: the unit tests in Chromium and Firefox,
and the UI test of all 19 demos.

## Prompt 11

> I have pushed. I took a photo of bricks for the 2dfft app. It's at
> `brainflux/fft2d/images/20261027_174313_bricks.jpg`. Crop and rotate and make this black and
> white and do whatever you need to do for the 2dfft app. Then delete this original photo so that
> it doesn't get committed. This photo, like the others that I took, can now be under the same
> license.

### Response 11 (2026-10-27)

*Bricks* in the gallery is now your photo, `fft2d/images/bricks.png` (512 × 512, grey), in
place of the drawn wall.  The original is deleted.  `LICENSE-CONTENT.md` lists the photo under
CC BY 4.0 like your portrait.

**Straightening.**  More than a rotation was needed.  I followed the bed joints (the horizontal
mortar lines) across 40 strips of the 4000 × 3000 photo:
- the courses were about 9% taller at the bottom than at the top (the camera was tipped 6.4°
  up at the wall), tilted 0.5°, and bowed by up to 12 px near the top and bottom edges (a
  slight pincushion in the lens).
- A camera model fitted to the joints, with radial distortion plus a rotation of roll, pitch and
  yaw, takes them from 15.6 px rms off level, evenly spaced lines to 2.6 px.  What is left is
  the wall itself: courses that differ by a couple of millimetres.
- The head joints (the vertical ones) weren't used in the fit, so they are an independent
  check.  After correction the bricks are 693 px wide at the top and at the bottom, and the
  joints line up from course to course to 6 px rms.

**Your wall isn't laid in half bond.**  Alternate courses are offset by a third of a brick
(0.339 of the 693 px brick).  The pattern repeats every two courses, with two bricks in each
repeat.  The spot at $(4m, 9n)$ has the structure factor $1+e^{2\pi i(m/3+n/2)}$, which is
zero for $n$ odd and $m$ a multiple of 3: in every other row of spots, every third is missing.
The transform shows exactly that.  Those spots are about ten times fainter than their
neighbours.  I rewrote the brick sentence of experiment 8 and the preset's tooltip to say so.

**The crop.**  A square photo of this wall holds four bricks across, so the crop is exactly 4
brick lengths by 18 course heights (2772 × 2792 px, squeezed 0.7% to a square).  A whole number
of periods means the picture tiles without a seam, so the spots are single pixels rather than
smeared.  The lighting fell off by about 20% toward the edges.  I divided it out using the mean
over one repeat of the pattern, which contains no lattice, smoothed by a polynomial.  Then I
stretched the greys to the full range with a gamma of 1.6 so the brick faces sit nearer
mid-grey.  The thin dark line under each brick is real: the shadow of its edge on the recessed
mortar.  The grain of the brick faces gives a faint haze over all of k.  The help now compares
it to disorder in a crystal.

## Prompt 12

> commit what needs committing and push if you can (otherwise I'll push).

### Response 12 (2026-10-28)

Committed the brick photo, its help text, the licence entry, the plan and this log.  The push
failed again from this session (`Permission denied (publickey)`), so it is yours to push.

## Prompt 13

> These demos are good, but could be improved, especially the ones marked "beta" that you made.
> Go through these and check that the physics is all correct and that it makes sense to a
> Junior physics major. In particular, the "Dispersion and Kramers-Kronig" was not intuitive.
> The "Interferometers and coherence" was good, but should show scanning the Michelson on both
> sides of equal path length (even though the information is the same). The "Abbe and phase
> contrast" was hard to use. The Holography was not intuitive. The Tomography was good, but
> could be made more intuitive to use. The "Gaussian beams and laser cavities" was good, but was
> hard to use, with some default parameters that might be better chosen. "The principle of
> least action" was also hard to use.

### Response 13 (2026-11-02)

Nine agents, each in its own worktree: one for each of the seven you named, with your note
verbatim, a physics audit of every equation, number and sentence, and the instruction to use
the page as a student would (driving it in Chromium and looking at the screenshots); and two
that audited the other six beta demos without redesigning them.  I merged them one by one,
checked their physics claims by hand, looked at each demo myself, and fixed what I found at
the merges.

**Dispersion and Kramers–Kronig** now starts from what a junior already knows, the driven,
damped oscillator.
- It opens on the medium with the light's frequency sweeping slowly across one line, and two
  live pictures at that frequency: a charge on a spring with its lag behind E (in step below the
  line, so $n>1$; a quarter period late on it, so E does work and the light is absorbed; against
  E above it, so $n<1$), and the wave meeting the medium (its wavelength $\lambda_0/n$ inside,
  the $1/e$ point of its decay, the reflected standing wave outside).
- Kramers–Kronig: drag one sliver of absorption and see its share of $\mathrm{Re}\,\chi$ (+ below
  it, − above it, falling as $1/(\omega'-\omega)$) and its ring in $\chi(t)$, which starts at the
  kick only together with that share.  "Break causality" makes it ring before the kick.
- Pulses: a picture of the pulse inside the medium at one moment, a dot riding a crest at $c/n$
  and a triangle riding the peak at $c/n_g$, above the detector's record.
- Physics fixed: the help said $\varepsilon'$ rises towards the line from both sides (above it,
  it rises away from the line, back to 1); that the area of $\varepsilon''$ is fixed (it is
  $\int\omega\varepsilon''\,d\omega$); that a typed $\chi$ with $+i\gamma\omega$ in place of
  $-i\gamma\omega$ is gain (it is the ring run backwards in time, acausal; a real amplifier, with
  inverted atoms, is $-\chi$ and still causal); the ionosphere's angle was never said to be from
  the vertical; the carrier and the resonance were both $\omega_0$.

**Interferometers and coherence.**  The Michelson now scans both sides of equal paths.  The
mirror goes to negative $d$ (the schematic marks $d<0$ and $d>0$), the motor sweeps through
zero, the spectrometer samples $-\Delta_\mathrm{max}\ldots+\Delta_\mathrm{max}$ and transforms
both sides (with Mertz phase correction), and the page opens on white light sweeping through
zero path with both sides of its interferogram drawn.  A new experiment, "Both sides, or
one?": the sides carry the same information, $I(-\Delta)=I(\Delta)$; but with the zero off by
$\lambda/4$ a one-sided scan turns a green line into a wiggle, while two sides stay right.
The spectrometer had only scanned $0\ldots\Delta_\mathrm{max}$, although its own formula summed
both sides, and took its mean level from the first sample; ten quoted numbers were re-measured
and corrected (white-light fringes visible to 2.45 μm, the sodium split at 0.41 mm, Betelgeuse
on a 6.1 m beam as in 1920...).

**Imaging: Abbe and phase contrast.**  The hard part was that nothing showed the microscope.
- A live sketch of it from the side now sits over the three pictures: light, object,
  objective, Fourier plane (the back focal plane, drawn as a strip with its aperture, stop, dot
  or knife), tube lens, image.  The light that goes straight through is drawn converging to a
  point in the Fourier plane, each diffraction order as a ray as bright as its share; grating
  orders are numbered, and red where the pupil blocks them.
- The controls are numbered 1 to 4 in the order the light meets them, and the two overlapping
  sets of Fourier-plane tools became one: four presets that name the technique (Open: bright
  field; Stop: dark field; Phase dot: phase contrast; Knife edge: schlieren), and brushes
  Block / Pass / −90° / +90°.
- Physics: the signs in the code were right, the explanation of Zernike's dot was not.  With
  waves $e^{i(kz-\omega t)}$ (so $\varphi>0$ is a delay) and the zero order times $e^{i\alpha}$,
  $I\approx 1+2\varphi\sin\alpha$: the −90° dot (an advance) makes thick parts dark, positive
  phase contrast.  The help had the bar target's 1 μm group "a grey block" in coherent light (it
  keeps 44% contrast), the Siemens star with 36 spokes (18), and an oblique-light comparison
  that left the light tilted.

**Holography** now tells the story in two steps.
- It opens on one point 60 mm behind the plate and a reference at 1°: the hologram is an
  off-centre zone plate, which is a lens.
- ① Record (side view): the object's light $O$ and the reference $R$ meet on the plate, which
  keeps only $|O+R|^2$.  ② Relight: $R$ alone, and the three beams the plate sends on, each in
  its colour with its terms beside it: the zero order straight on, the image $|R|^2O$ (dashed
  rays back to where the object was: virtual), and the twin $R^2O^*$ converging in front of
  the plate (real).  Click there to focus the camera; "Looking through it" is a camera held
  against the plate, with rings where each image lands.
- The window, cutting and colour tools are folded away for the experiments that use them.
- Physics: relighting with "the conjugate" was described as a reversed beam making real images
  in front of the plate.  A truly reversed beam makes its real image where the object was; what
  the demo does (and now says) is light the plate from behind with the reference tilted the
  other way.  Relit in green, the picture is not 0.84 times smaller: it is as big, 633/532
  times as far away, and so looks 0.84 times as big.

**Tomography.**  One colour per thing pointed at, in every panel: cyan for the angle just
measured (the detector, its sinogram row, its slice of Fourier space, its smear in both
back-projections); magenta for a sinogram row you point at (the scanner turns there); yellow for
a point you point at in the object (its sinusoid, its ray, where its shadow falls).  A Step
button and the → key measure one angle at a time, and a new "Disks" object (one centred, two
not) opens the first experiments: a straight band and two sinusoids.  Physics: the ramp
filter's transform is $|k|/2\pi$ with this demo's normalisation, not $|k|$; the circle in
Fourier space is $\pi/(R\Delta\theta)$, not $\pi/\Delta\theta$; the sinogram rows were drawn
half a row off their angles.

**Gaussian beams and laser cavities.**  New defaults:
- Bench: a 200 μm waist ($z_R=199$ mm, so it spreads visibly) and a 200 mm lens two Rayleigh
  ranges on, which makes a 142 μm waist 301 mm after the lens (ray optics would say 400 mm;
  the help says why).  Each waist labelled $w_0$, $z_R$, $\theta$, its Rayleigh range dashed and
  its far-field cone dotted; Intensity shown first; the "drawn 144× wider" paragraph is one line.
- Cavity: $R_1=R_2=1$ m at $L=250$ mm.  With $R=2L$ the one-way Gouy phase was $\pi/3$ and the
  orders $N$ and $N+3$ fell on top of each other.  The spectrum is now drawn in absolute
  frequency above $q_0\,c/2L$, with the plain comb in grey, so it is plain why TEM₀₀ sits
  $\psi_1/\pi$ off it.
- The optics are a list with a ✕ on each row, the input waist a large yellow ring, and a hint
  line says what the pointer can drag where it is.
- Physics: a real focus just past the view was called virtual; and the help said the
  exaggerated wavelength was needed for the Gouy shift (only the curvature needs it).

**The principle of least action.**  Driving it showed what made it hard: a vertical drag with
a 4 px wobble also moved the knot in time, a press anywhere grabbed the nearest knot, and the
record of S rescaled every frame.
- A drag now moves one way only, decided by its first 5 px (Shift for both), with a guide line
  and a "where" or "when" label; only a knot within 16 px is grabbed.
- A score table compares your path with the true one: S, $\int\frac12 m\dot x^2\,dt$ and
  $-\int V\,dt$, ΔS and a verdict.  The record of S is full size beside the path, holds its
  range during a drag, and shows the true S as a labelled line.
- "Try a wrong path": Bend ↑, Bend ↓, Straight line, Rush then dawdle (the same places at the
  wrong times); each animates, so the record shows a ramp.  "Back to the true path" is the
  main button.
- Phase space, energy and Feynman's arrows share one panel in tabs; the phasor dial became the
  sum over every height of one knot, a Cornu spiral, with a band on the path of width
  $\sqrt{\pi\hbar/S''}$ where the arrows add up.
- Physics: for typed Lagrangians, typed potentials and light, second derivatives taken with a
  1e-5 step put noise into the shooting equal to its landing tolerance, so 12 of 82 true paths
  were missed and the damped oscillator was called a saddle before its conjugate point.
  "Roll downhill" crawled at a saddle (knots bunching in time); it now rolls them up and down
  only.  Experiment 2 said lowering the top knot saves kinetic energy; measured, it costs some.

**The audit of the other six.**
- Maxwell 2D: the 0.5λ guide holds two modes, not one ($V=1.76>\pi/2$); the dashed V of
  Cherenkov light is its wavefronts at 47.8° to the path, the light goes at 42.2°
  ($\cos\theta=1/n\beta$); "total" internal reflection leaked 5.4% of a 1λ beam through the
  part of its angular spread below the critical angle (the set-up now hits at 55°, and a meter
  shows the 0.2% left); at β = 0.9 there are no waves ahead of the source to crowd.
- Thin films: the Fabry–Pérot finesse divided the gap to the next peak in λ by the width, but
  the peaks are evenly spaced in $1/\lambda$, not λ (16.4 now, against $\pi\sqrt R/(1-R)=16.43$);
  silver's UV dip is at 309 nm, 7%; the 71° angle is the pseudo-Brewster angle, not the
  principal angle (73.9°).
- Radiation, antenna arrays, drums, phase space: no physics errors.  Clarity fixes, a power
  chart's labels that ran off the canvas, and in drums a "Count 200 modes" button that stayed
  disabled after switching shapes.

**Shared code.**  `lib/plot.js` put an x label too wide for a small right margin off the canvas;
it now goes inside the frame (no opening view hit it; a unit test keeps it so).  The beams
cavity test drew random cavities and sometimes asked rays just outside the stable range to walk
off faster than physics lets them; it is seeded now and asks only where the eigenvalue says
they can.  Thumbnails and the landing-page cards are remade from the new openings.

**Tests.**  `tools/test_all.sh` passes: 315 unit tests in Chromium (293 before), and the
scripted run of all 19 demos, which now checks every number the revised help texts quote.
(Firefox isn't installed in this session, so the second unit-test run was skipped.)  The UI
tests of the revised demos step their simulations through `__app` instead of waiting on the
clock, so they pass on a loaded machine.

**Still to do.**  Still pictures for each experiment (the old "key frames" rule; no demo has
them yet); a hollow-cone condenser with a phase ring in the imaging demo (the physics module
supports it; it would add controls); dispersion in an uncompensated Michelson arm; the
interferometer's Betelgeuse range is not kept in the address.  Still marked beta until you
have tried them again.

## Prompt 14

> Keep working on main. Do a top to bottom review of the "Beta" apps, making sure that from the
> moment the apps are opened, someone who has a little exposure to the concepts understands how
> to play with them and explore the physics. Fix anything that comes up. Commit it to main.

### Response 14 (2026-11-03)

I opened all thirteen cold and looked at the first screen and the drawer of each as a student
with a lecture's worth of the idea would.  The same things got in the way almost everywhere:
nothing on the picture said what to drag (the hints were small grey text in the side panels);
the readouts were rows of symbols (`β = 0.094  γ = 1.004  |a| = 36.00  P/P_Larmor = 1.027`);
some pages opened on the hardest case they could show (a chaotic stadium billiard, a quartic
well with the Wigner function already sheared negative, six tomography panels at once); and
every drawer began with the theory, equations first, before a word about what to do.

So one standard, applied to all thirteen by nine agents in worktrees (one per demo, or a pair
of related ones), with two shared styles in `lib/style.css`:

- **The first screen.**  Something is already happening; a one-line hint on or directly under
  the main picture (`.hint`, with an arrow) says what to drag or click; every number has words
  beside it, in the fixed slots as before; the opening is the simplest instance of the idea,
  which is experiment 1; headings, buttons and sliders are plain words, with a gloss under the
  control for anything a student might not know (NA, taper, Ram-Lak, Husimi, ¼ wave, dB);
  the useful controls are near the top and the obscure ones fold under "More".
- **The drawer.**  It opens with a "Start here" block (`.drawer .start`): what the page shows,
  what to drag, what to look for, in three to five plain sentences and no equations.  Then the
  experiments, each with a heading that says what you will see, "Set it up", what to do, what
  to look for, why.  The theory and conventions, every equation kept, moved to the end under
  "How it works".
- **The interactions.**  Each agent did what its hints say, in headless Chromium, at desktop
  and phone widths and in both themes, and fixed what didn't respond; the UI tests now check
  the hint is on the first screen, the Start-here block comes first and has no equations, and
  the contrast of both in the dark theme.

What changed in each, beyond the standard:

- **Imaging** opens on Abbe's grating in bright field, its orders ringed and numbered in the
  Fourier plane (the phase-contrast cells are experiment 8 and the card).  "Paint on the
  Fourier plane: Block an order and watch the image."  The brush size, mirror and brightness
  fold under "More".
- **Interferometer**: the whole Fourier-transform-spectrometer panel folds away until an
  experiment needs it; "fringe contrast (visibility)" and "path difference Δ = 2d" in words.
  **Holography**: hints under both side views; the zero order, the twin and R* glossed where
  they are named.  It keeps opening on the tilted reference (experiment 2) because in line the
  three beams overlap and the first screen would show nothing apart.
- **Least action**: the hint under the path; "kinetic part / − potential part" over the score;
  "Your path" above the list of systems; throw and catch is experiment 1.  **Radiation**:
  "speed β = v/c, Lorentz factor γ, acceleration, radiated power (1 for a slow charge)"; the
  probe is a yellow dot you drag, and the page says so; the probe's lines hide rather than
  leave blanks.
- **Phase space** opens on the coherent state circling in the harmonic well with the classical
  points (the quartic shear is experiment 2); the readout line is four groups with a word each;
  the ⊕ handle lights up under the pointer and a press focuses the plot so the arrow keys work.
- **Thin films** opens as "A soap film"; each layer's edge has a grip tab that lights up, with
  the cursor to match; "Of the light at 550 nm: reflected R 5.63%, transmitted T 94.37%";
  the plots say "Reflected fraction R against wavelength"; every stack preset has a tooltip.
  **Dispersion**: hints in all three views, sliders named ("resonance ω₀, width γ,
  strength ω_p"), presets and chips glossed ("free: charges with no spring, as in a metal").
- **Tomography** opens on three disks with three panels (scanner, sinogram, reconstruction);
  Fourier space, the unfiltered back-projection and the profile fold under "More panels" and
  unfold for the experiments about them; every panel head says in words what it is.
- **Beams**: hints in the Cavity and Modes views too; "g₁g₂ = 0.563 is between 0 and 1"; the
  Numbers panel in words; the higher-order mode, the stretch, the exposure and mode matching
  fold away.  **Arrays**: "−10 dB is a tenth of the beam's"; "Directivity: 8.0× an isotropic
  antenna's power towards the beam"; the synthesis view's panels titled in words ("What is
  measured", "The true sky", "Dirty image"); clicking an element is how "By hand" is found.
- **Drums** opens on the Drum tab: a circle struck a little off centre, slowed 167 times so the
  ripple can be watched and the spectrum separates its peaks in a few seconds, with the sound
  on.  "Click the drum to strike it there (you hear it too); click a peak of the spectrum to
  see that mode."  The mode box says what will appear in it; "80 exact modes found in 1.6 s"
  instead of "shift-invert Lanczos"; the drawing pen, the ring time and the pinned drum fold
  away; every shape button has a tooltip (GWW drums: "two different drums that sound the
  same").  The chaotic stadium is experiment 7.
- **Maxwell 2D**: the hint under the picture follows the state (the beam's dot and its aiming
  ring; the brush chosen; "the green lines are power meters: drag their ends"); the colour bar
  says "Ez, the electric field out of the screen"; the fifteen shape buttons are now set-ups
  that also aim the source (before, "Gap" from the opening left the beam inside the glass),
  each with a tooltip saying what it shows; polarisation, meters, the probe and the grid fold
  under "More"; the grid is 24 cells per wavelength instead of 30, which halves the work.

No physics changed; the quoted numbers were re-measured by the tests as before.  Two small
things on the way: `tools/cdp.py` crashed in a fresh checkout (no `build/` folder), and the
beams cavity test is now seeded.

**Tests.**  `tools/test_all.sh` passes on the merged `main`: the 315 unit tests in Chromium and
the scripted run of all 19 demos.  The thirteen beta demos' UI tests now make 1,032 checks
between them (the agents' counts; about 300 of them new), for the hints, the Start-here
blocks, the glosses, the folded panels, both themes and the phone's first screen.  (Firefox
isn't installed here, so that second unit-test run was skipped.)

**Left.**  `lib/style.css` gives every canvas `touch-action: none`, so on a phone a finger can't
scroll the page from over a picture that fills the width; several demos set `pan-y` on the
canvases that take no drag, and the rest would need it only while dragging.  Still pictures
per experiment.

## Prompt 15

> Keep going with the six finished demos. Make sure the physics is correct and understandable.
> Be a bit more conservative in your user interface changes with these. The original versions
> of the 1D Schrodinger and 2DFFT were quite popular and I'd hate to mess them up by either
> adding too many features or dumbing them down to make them less interesting to use. The 2D
> Schrodinger is newer and its "Born Approximation" and "Partial Wave" physics and pedagogy
> should be checked for correctness and understandability.
>
> The phased array demo is good, but the radio interferometer tab is not an obvious mode, and
> it's much less obvious what's going on once you're in that mode.
>
> The radio interferometer should be broken out to its own app. Check out how I currently
> teach it at https://github.com/HMC-AdLab/radio_interferometer_lab for some inspiration (if
> this is not public, you should have access through my github login). More scaffolding
> should be used to build up intuition in steps:
> * one incoherent point source's correlation (with various amounts of band limiting on a
>   slider, which you show in time and in frequency before you do anything spatial).
> * Two incoherent point sources, where you can drag the sources around and a pair of
>   detectors around and watch the "live" simulated timestreams and live spectra of the
>   sources and detectors, watch live time streams of the auto correlation and self
>   correlation and auto spectra and self spectra of the pair of detectors. The students need
>   to think about complex magnitude and phase and what negative frequencies mean if you show
>   that.
> * Then have a few incoherent point sources that you can drag around along with a pair of
>   detectors that you can drag around on a 2D UV plane (labeled in both distance between
>   antennas in meters and in some understandable version of u and v units, given the central
>   wavelength). Here (like the 2DFFT demo) have an image plane on the left with a few (say
>   1-6) incoherent point sources arranged in as tips of a Pentagon or whatever, but with
>   sliders to change various things. On the right is the uv plane, shown in the same way as
>   in the 2DFFT app: default to showing magnitude as lightness and phase as hue with a pull
>   down menu for other options. There would be two draggable dots on the uv plane
>   representing two receivers. I think it's cleaner if dragging one also drags the other
>   symmetrically around the origin. As you drag, you see the live time and frequency plots
>   from both receivers and their correlation. It should be obvious to the students from the
>   "live" time-varying 1D plots, that the time average correlation's magnitude and phase
>   becomes the magnitude and phase of the point on the uv plane where you are dragging the
>   receivers. (Maybe show a complex plane inset, with the hue-value color scheme, under a
>   live-updating scatter plot of the last hundred or so time-averaged correlations. As you
>   drag sources or detectors around, everything updates live.)
> * Eventually when students understand what's going on with a few point sources, they can
>   move to sources like a disk and a galaxy-looking thing and the drawing of Fourier, all
>   initially with just a pair of antennas that can be dragged around to map out the 2D uv
>   plane. (Or at least they'd drag them around on an already mapped out 2D uv plane to see
>   how such a uv plane could be populated with enough pairs at enough different separations
>   and angles.)
> * The step after that is either to turn on earth rotation for the pair or to turn on a whole
>   array (eventually turning on both). If you turn on a whole array of antennas (with
>   arrangements you can select, like the Y-shape or a random array), their O(n^2) points in
>   the uv plane would show up. Independently, you can turn on earth rotation to show whole
>   paths of antenna pairs as the earth rotates. Once you're in the "earth rotation" or "lots
>   of pairs" mode, it would turn on a second row of 2D plots. Under the "ideal" or "expected"
>   uv plane would be the "measured" or "sampled" uv plane of wherever the antenna pairs
>   actually (and probably sparsely) measure (instantaneously or where they sweep as the earth
>   rotates). Then to the left of that and under the 2D plot of the sources themselves is the
>   reconstruction. (Make sure there is an arrow that points left toward this, so that the
>   flow of information or flow of processing steps is obvious to the students.) Then there
>   can be a checkbox to turn CLEAN on and off or a menu of different such algorithms. I've
>   thought less about how to demonstrate this.
>
> I want students to understand how incoherent sources still give rise to things that look
> like interference fringes because you're looking at the *correlation* between two
> receivers. Where the "fringes" come from. Intuitively, why are the 2D set of correlations
> the 2D fourier transform of the source? Even though this is all about correlations and
> fringes, why does this work for incoherent sources, but would fail (or have to be modified)
> if the sources were coherent. (This last one is a very stretch goal.) I don't know if the
> following should be its own app or if some ideas should be incorporated into the radio
> interferometry lab, but check out this idea that I want to build in our Junior-level optics
> lab: https://github.com/gallicchio/fourier-etch-a-sketch

Then, while the work ran: the lab repository was moved to
`github.com/gallicchio/radio_interferometer_lab` so this session could read it, and "keep
going on all of this until 2pm or until you run out of credits for this week."

### Response 15 (2026-11-03)

**The lab materials.**  I read the handout (the delay τ = D sin θ / c, multiply and average,
⟨v₁v₂⟩ = I cos 2πθδ with δ = D/λ: a fringe in the *separation*), the 54 slides (one dish sums
the wave across its aperture; two dishes; the correlations of two sources add, with the
"to the board!" caveat that fields add but the square-and-average does not; the electronic
delay to a reference direction; few antennas, many baselines; the Y and Earth rotation; then
white noise, a bandpass, narrow-band noise whose amplitude holds for 1/Δf, auto- and
cross-correlation, "spatially incoherent sources make coherent fields far away"), the
notebook (complex Gaussian noise per source, receivers moved symmetrically about the origin,
correlation = mean(A* B), phase as hue and magnitude as brightness, the 2D FFT back to the
image, and the near-field plots against ΔX and the mean X), the GNU Radio flowgraph
(multiply-conjugate, a single-pole IIR, a constellation sink) and the Fourier Etch-a-Sketch
(intensity correlations give |V|², the phase problem; the live display paints the uv plane as
the knobs move a collector, and the inverse transform of what has been painted so far).

**The six finished demos**, reviewed conservatively (no features added, nothing removed; a
hint on the picture, a Start-here block, words beside symbols, and the physics checked claim
by claim against the running page):

- **Plane waves**: the code was right (every form's direction, the phasor's sense, the
  crest tracker, the standing wave's λ/2, the fringes of crossed beams, the beats, the
  packet's group velocity for all four dispersion relations, the k < 0 fix of Response 1).
  The help was not: "engineers write j = −i" (they write e^{j(ωt − k·r)}); "the complex wave
  carries the direction in its phase alone" (only once the sign convention is agreed); the
  beats' envelope "drifts" (for light it moves at c with the crests, so the pattern slides
  whole).  Every experiment now quotes the demo's numbers.
- **Fourier series**: the code was right (every preset's coefficients, the Gibbs overshoot
  9.4% with 5 terms and 9.0% with 15, the Web Audio graph's harmonics and gain, no preset
  clips).  "It shrinks in width but stays 9% high" became "overshoots by about 9% of the jump
  however many terms you add"; the drawn period's analysis (512 samples, 48 harmonics, the
  average dropped) is now said.
- **1D Schrödinger**: one error in the code.  The P(x<0) / P(x>0) readout counted the grid
  point at x = 0 wholly on the right, so the finite well's symmetric ground state read 0.489
  / 0.511; a cut cell now counts by its fraction (0.500 / 0.500), with a unit test.
  Everything else was measured and holds: the box levels n²π²/2L² (numbered from 1), the
  harmonic n + ½ (from 0), the delta's −0.4650 and T = 0.513, the step's 0.0941 (the
  plane-wave R at k₀ = 2.4 is 0.083; the packet's spread raises it, now said), the barrier's
  0.388 against 0.39, the resonances 0.985 / 0.312, the double well's period 56.2 (the log's
  55.2 was the pre-fix softened value), the bouncer's Airy zeros, the Bloch period 25.13, the
  revival at 127.3, σxσp = 0.500 for every Gaussian, ∫j dx = ⟨p⟩/m.  Readouts got words
  ("mean ⟨x⟩", "spread σx", "energy ⟨E⟩") in the same slots; the stationary-state note states
  the numbering; a hint under the plot; Start here, with the intro kept after it.
- **2D Fourier transform**: no errors in the physics (the centring, Hermitian symmetry,
  the colours of ±1 and ±i, the shift theorem's sign, the plane wave's direction, σ_k =
  N/2πσ_x, the sinc, Airy and J₀ zeros, the fringes, the brick wall's missing spots, Parseval,
  the phase graft).  Four sentences were wrong: "equal colours mean equal values on both
  sides" (each side has its own brightness); the readout's "(the average)" at k = 0 (it is
  N × the average); "the symmetric part of an image makes the real part of its transform"
  (only for a real image); the low-pass experiment's "drag back out and it sharpens" (the
  drag starts where everything is zeroed).  The Stripes preset had a non-integer wavevector
  (10, 7.5), so its two "points" were smears; it is (8, 6) now, three exact pixels.  A hint
  under each picture that follows the tool; units in tooltips; Start here, the intro with
  the colour wheel kept after it.
- **Diffraction**: one error in the code.  The lens was a phase fixed in radians, so in white
  light it focused red at 42 mm and blue at 61 mm, a zone plate's chromatics and the
  opposite of glass; the aperture now carries its unwrapped phase as a thickness, scaled by
  λ₀/λ for the other colours, and the lens focuses all three at 49.5 mm while the zone plate
  (an amplitude mask) stays chromatic, 42 / 50 / 61 mm.  Help claims corrected after
  measuring: the straight edge's fringes are not "√(λz) apart" but at 0.86√(λz) and then
  closer and closer, and the edge sits at exactly ¼ of the open beam; the Talbot carpet of
  the sinusoidal grating has no "finer and finer patterns", only the half-period image at
  z_T/4; "far field" now means N_F < 0.1 (within 1% of the transform; at 0.3 the slit is
  5.5% off); the disk's readout speaks of its shadow filling in, not of a transform; the
  white-light experiment opened where the grating's orders still overlapped and now opens at
  1 m; the far-field scale bar read "5e−1 mrad".  Eight new unit tests, one of which shows
  why scaling the wrapped phase would not have worked.
- **Scattering in 2D**, the one the author singled out.  Every 2D formula was re-derived in
  the demo's convention ψ → e^{ikx} + f(θ)e^{ikr}/√r and found right in the code and the
  help: the Born amplitude with its e^{+iπ/4} and Ṽ(q), dσ/dθ = m²|Ṽ(q)|²/(2πħ⁴k), f from
  S_m, σ = (4/k)Σ sin²δ_m, the optical theorem's phase factor, the hard disk's tan δ_m, the
  Hankel extraction and the beam's partial-wave content; two unit tests now pin Born and the
  optical theorem to closed forms.  Two errors in the code: the "exact" radial solver, started
  from r^{m+½} at the first grid point, seeded an h-independent √r ln r admixture that gave
  δ₀ = +0.005 for no potential at all (a weak bump's δ₀/V₀ wandered from −0.64 to +0.19 as V₀
  shrank, against Born's −0.650; it is −0.651 now, after RK4 for the first steps); and a run
  ended at its nominal time with probability still in the box, cutting the time transforms
  short (the resonance's |S₃| read 0.95; it waits for the packet to leave now and reads
  1.00).  Numbers re-measured: Born 6% high at V₀ = 1 (not 7%), 65% at V₀ = 2 (not 60%); the
  slow packet's m = ±1 add a quarter (not "only m = 0"); the double slit's ±70° dark fringe
  does not exist in either curve and is no longer promised; the Coulomb forward peak's
  shortfall is the potential's tail still in the near field at the detector, now said.
  The drawer tells it in the order a junior needs: what is incident, what scatters, what
  dσ/dθ counts, then Born as the transform at the momentum transfer (with the validity
  parameter V₀a/ħv), then partial waves as each angular momentum's own phase shift; every
  term glossed on first use; the theory last, in three parts (what is measured, what is
  computed from it, why they should agree).  Not built, suggested: Born's |Ṽ(k − k₀)|² drawn
  on the momentum circle and the classical dσ/dθ on the cross-section plot, which PLAN.md
  promised and the demo never drew.

**Antenna arrays** is the phased array alone now: the "Aperture synthesis" tab, its six
panels, its five experiments and its three modules are gone from `arrays/`.  The old
addresses (`#setup=rotation`, `eht`, `clean`, ... and saved `mode=synth` states) redirect to
the new app with their hash kept, so links in old homework still work.  The drawer ends with
"Radio interferometers": a radio telescope array is this demo run backwards, and a link.

**Radio interferometry** (`radiointerferometer/`): being built by its agent from a brief in
four numbered views (one source's noise, its band-limited time stream, spectrum and
autocorrelation; two sources and two antennas with live time streams, spectra and the running
complex correlation; the uv plane with 1–6 draggable sources or a picture on the left and the
ideal V(u, v) in the FFT demo's colours on the right, two receiver dots moved symmetrically,
the complex-plane inset where the running average lands on the colour under the dots, and the
Etch-a-Sketch painting of what has been measured; a whole array and Earth rotation turning on
the second row: the sampled uv plane and, under the sky with an arrow pointing left to it, the
reconstruction, with CLEAN), plus the stretch experiments (coherent sources breaking it;
intensity correlations losing the phase).  **Paused before it was finished**: the session's
credits ran out with the physics modules committed and the views in progress.  The
`arrays/` branch (the phased array alone, with redirects to this app) is merged only when
this app lands, so no link on the live site breaks in between.

**Tests.**  Each merged branch passed the 315–323 unit tests and its demo's UI test before
merging (the UI tests of the six finished demos grew from about 192 to 379 checks between
them); the full `tools/test_all.sh` run on the merged `main` is still to do after the new apps
land.

## Prompt 16

> More tasks to start: I want an Block Sphere and NMR app, where you can send in the various
> pulses and watch what happens to a single spin and (with a checkbox) and ensemble of spins.
> The user should have control over the pulses. You should be able to turn on and off (or
> slide with a slider) effects like thermal noise and "settling". I am building an Earth-field
> NMR as a printed circuit board (https://github.com/gallicchio/earth-nmr-pcb) and we have the
> Teach Spin NMR demo that works around 5 MHz, so the app should be applicable to at least
> those two things. It should help the students visualize and ultimately understand the
> effects that they see in these experiments.
>
> Then, I want you to make an MRI demo app. Show, among other things, how a gradient gives
> you information along one axis. Show how you get the information for the other axes. By the
> end of exploring this one, a student who has a sense for the NMR concepts like pi pulses and
> pi/2 pulses should understand how these can be used to form an image.

## Prompt 17

> I also want you to start an optical coherence tomography app. It can draw on the background
> knowledge from some of the other apps, but should be relatively self contained. For someone
> who understands the coherence app, this should be "how do you start there and use it to
> form a 3D image of something".

### Response 16 and 17 (2026-11-03)

Three agents, one app each, from briefs the lead wrote (`nmr/`, `mri/`, `oct/`); the NMR
brief carries the Earth's-field board's numbers from its README and handbook (46.0 µT and
1960 Hz in Claremont; 1.5 A for 0.2–4.7 s, off in 0.4 ms against a 0.51 ms Larmor period; a
microvolt for a second or two; T₁ by the polarizing time, T₂* by the envelope) and the
TeachSpin's pulsed sequences at 5 MHz.

**NMR** (`nmr/`), **MRI** (`mri/`) and **OCT** (`oct/`): being built by their agents from
briefs (NMR: one spin on the Bloch sphere in the lab and rotating frames, pulses of any angle
and phase, the ensemble with T₁, T₂ and the field spread, noise and averaging, pulse
sequences, and the Earth's-field board's polarize–switch-off–listen with sudden against
adiabatic switch-off and the FID heard; MRI: one axis by frequency encoding, the slice by a
shaped pulse under G_z, the second axis by phase encoding filling k-space line by line with
the image forming, then contrast, aliasing, and Lauterbur's projections; OCT: fringes from a
layer within the coherence length, the A-scan by scanning the mirror, the B-scan and the
volume by scanning the beam, and Fourier-domain OCT from the spectrum).  **Paused before they
were finished**: the session's credits ran out.


## Prompt 18

> Also add a placeholder and a TODO item (but don't start writing it) for a continuous quantum
> optics demo that covers Homodyne detection, coherent states, squeezed states, making
> measurements with these.... ultimately working the students up to a visualization and
> demonstration of how LIGO can get more accurate measurements by using squeezed states.

### Response 18 (2026-11-03)

A placeholder card on the landing page ("Quantum optics: squeezed light and LIGO", marked
*planned*, no link) and a TODO in `PLAN.md` under "The demos" with the story the author
gave: the quadratures of one mode of the field, coherent states as the classical limit
(the circle of noise in phase space, the same picture as the phase-space demo's), squeezed
states (the ellipse; the uncertainty product kept), homodyne detection (beat the field
against a local oscillator, choose the quadrature by the oscillator's phase, see the noise
shrink and grow as the phase turns), a measurement with each (the signal-to-noise of a
phase measurement; the standard quantum limit), and LIGO: an interferometer's arm length
read out as a phase, the shot noise of a coherent state, the squeezed vacuum fed into the
dark port and the noise falling below the shot-noise limit (the 2019 result, ~3 dB), with
the trade against radiation-pressure noise and the frequency-dependent squeezing of 2023.

## Prompt 19

> Make sure everyone finishes up and pauses.

### Response 19 (2026-11-03)

Every agent had committed and stopped; every worktree was clean, and `main` and the five
`wip/` branches on GitHub matched their local commits.

## Prompt 20

> Resume all of the work that you were doing this morning. Take as long as you need to make
> these apps amazingly interesting and educational. I'll play with them and give you feedback
> once they are pushed to main and I can look at them on the github pages.

### Response 20 (2026-11-04)

The four agents were resumed from their own transcripts, so each kept what it knew of its
code, with no deadline and the same briefs.

**Radio interferometry** (`radiointerferometer/`), four numbered views and 22 experiments.
- *1 · One source*: band-limited noise, a copy a lag τ later, their product (blue above zero,
  red below) and its average landing on the autocorrelation curve, whose envelope is the
  Fourier transform of the band (Wiener–Khinchin); a two-sided spectrum with a draggable band
  edge, real voltage or complex envelope (I and Q), and "multiply by an independent noise"
  for a product that averages to nothing.
- *2 · Two sources, two antennas*: the noise drawn as waves crossing the ground; drag the
  antennas and the sources; the antennas' signals are rebuilt every frame from their own
  delays out of a slowed-down recording, so B visibly hears A's noise a moment later.  The
  fringe plot shows the correlation against B's position next to the power B receives: flat
  for incoherent sources, Young's fringes for coherent ones.  The complex plane shows each
  source's share as an arrow and the cross terms between the sources as a grey diamond that
  dies away.  The cross-spectrum is coloured by phase; delay tracking to a reference
  direction (the electronic delay).
- *3 · The uv plane*: the sky (1–6 draggable points in presets, a disk, a ring, a galaxy,
  Fourier, your own picture) beside the ideal V(u, v) in the FFT demo's colours with its
  display menu, labelled Δx, Δy in metres and u, v in wavelengths; the pair's two dots move
  symmetrically; the pair's fringe stripes are drawn on the sky and each source is ringed in
  the colour of the stripe it sits on; the live correlator's dot settles on the colour under
  the pair.  "Slide the pair, same separation" shows the correlation flat only for far,
  incoherent sources: why coherent sources and the near field break the uv plane.  The
  Fourier Etch-a-Sketch: "keep what you measure" paints each average into the sampled plane
  and shows its inverse transform; intensity correlations (HBT) give |V|² and lose the phase.
- *4 · Many baselines*: two dishes, the slides' line of eight with every spacing from 1 to 24,
  the VLA's Y, a ring, a random array, the EHT; Earth rotation; under the sky the dirty image,
  with an arrow pointing left to it from the sampled plane, and the dirty beam; Högbom CLEAN;
  natural or uniform weighting.
At the merge, the lead added the caption "grey above zero, blue below" to the image and a
paragraph on why a picture goes negative there (no pair measures the zero spacing, so the
dirty image has no average), and widened one test that compared a running average of noise
with −0.99 to 0.03, about one σ of its radiometer scatter, to four σ.  `arrays/` is now the
phased array alone; its old synthesis links open this demo.

**Bloch sphere and NMR** (`nmr/`), four views and 15 experiments, with "TeachSpin (5 MHz)"
and "Earth's field (board)" at the top.
- *1 · One spin*: drag the arrow on the Bloch sphere; lab or rotating frame; π/2 and π about
  x′ and y′ or any pulse of your own (angle, phase, and B₁, which sets the duration); RF
  offset (the tilted effective field); T₁ and T₂ that can be switched off; noise and
  averaging; the coil's voltage as a scope shows it, the mixer's outputs and envelope; the
  spin-½ state cos(θ/2)|↑⟩ + e^{iφ}sin(θ/2)|↓⟩ beside the sphere.
- *2 · Many spins*: 4096 spins with a Lorentzian spread, a few dozen drawn; the sum arrow; the
  FID's power spectrum with its width beside 1/(πT₂*); a π pulse closing the fan into an echo.
- *3 · Pulse sequences*: an editable timeline (drag pulses, set their angle and axis, drag
  the acquisition window); FID, spin echo, inversion recovery, CPMG, Carr–Purcell; a pulse
  error; a τ scan that adds one point a frame with a live fit, and a click on the plot runs
  that delay so the spins can be watched at the null.
- *4 · The Earth's field*: the board's polarize, switch-off and listen with its design numbers
  (46.03 µT, 1959.8 Hz, 7.84 mT, 0.4 ms); the clock slows through the switch-off so the
  field's swing takes 2 s on screen; at 0.4 ms M is left across the field, at 300 ms it
  follows it round; the FID in µV, the spectrum giving B in nT, T₁ from the polarizing time,
  a steel tool; "Hear it" plays the FID.  The adiabaticity measure is γB_E²τ/B_p (the field
  turns only in the ramp's last 1/170), so the switch-off slider runs to 1 s: at 10 ms 68%
  of M is still left across.

**MRI: from spins to an image** (`mri/`), four views and 20 experiments.
- *1 · One axis*: tubes of water you drag and resize under a field line you tilt; 33 spins as
  compasses with a phase strip in the FFT demo's colours; the signal as an arrow and a record
  against t and k = γ̄Gt; the spectrum of the record so far sharpening into the profile, with
  lines from each tube to its frequencies.
- *2 · A slice*: a 3D head; the sinc pulse and G_z, the pulse's band dropped onto f = γ̄G_z z
  and carried across to the head seen from the side; 501 spins through the pulse by the Bloch
  equations; the rephasing lobe (95.5% of the slab in step with it, 3.0% without).
- *3 · The second axis*: 128 × 128 spins as a phase map, k-space filling row by row with k(t)
  traced, the picture from the rows so far, the whole sequence diagram (π/2, π, G_z, the G_y
  ladder, G_x, the ADC, the echo) with time slowed through the lobes; step, play, finish,
  click a row, point at k-space to see its plane wave, "only the centre", "only the edges";
  spin echo against gradient echo; drag a disk mid-scan for motion ghosts.
- *4 · Contrast and artefacts*: drag TR and TE on the recovery and decay curves; tissue bars;
  wrap-around, few lines, noise and averaging, fat's chemical shift, 1.5 or 3 T; and
  Lauterbur's 1973 projections with back-projection.

**Optical coherence tomography** (`oct/`), four views and 16 experiments, opening where the
interferometer demo leaves off.
- *1 · Fringes from a layer*: the Michelson with a reflecting surface in the sample arm; drag
  the mirror and a burst of fringes appears only where the paths match; drag the spectrum's
  width (ℓ_c = 0.44 λ₀²/Δλ = 6.2 µm at 840/50 nm); a glass plate's two faces; glass in one arm
  only (dispersion).
- *2 · The A-scan*: a cover slip, a three-layer film, a retina-like stack, two surfaces; the
  motor scans the mirror; the detector's trace, the demodulated envelope as reflectivity
  against depth (linear or dB) and the grey strip that is one column of a B-scan.  Two
  surfaces closer than ℓ_c merge, except in windows every λ₀/2 of gap where their fringes are
  out of step and cancel between them, putting two peaks in the wrong places: explained.
- *3 · B-scan and volume*: a retina (pit, cyst), an onion, beads in gel, a tilted plate, drawn
  from the side with the beam to scale above the B-scan building column by column; speckle;
  the NA against the depth of focus; then a 64 × 64 × 256 volume as three slices in a cube and
  an en-face plane, each clickable to move the others.
- *4 · Fourier domain*: the mirror still, a grating and line camera, one FFT for the whole
  A-scan with the time-domain one overlaid; pixels, the depth range z_max = π/(2nδk), the
  fall-off, the mirror image, folding; a whole retina B-scan refolded live as the sample
  moves.

**Tests.**  `tools/test_all.sh` passes on the merged `main`: 372 unit tests in Chromium (315
before: 18 radio, 18 NMR, 23 MRI, 13 OCT, with the arrays' 7 synthesis tests gone) and the
scripted run of all 23 demos, the four new ones making 110, 57, 74 and 66 checks.  Firefox
isn't installed here.

## Prompt 21

> Start the quantum optics squeezed light and LIGO demo.

### Response 21 (2026-11-04)

Built by one agent from a brief that tells the story in the order a student can follow it
(the container restarted once and killed the first attempt before it had committed anything;
the second was told to commit each view as it worked).  `quantumoptics/`, four views and 14
experiments, the placeholder card replaced:

- *1 · One mode*: the quadrature plane (X₁, X₂) with the state's Wigner function drawn in
  closed form in the phase-space demo's red and blue, turning at ω slowed; the mean field α
  on a stick you drag; one point of the cloud drawn each period and its shadow on X₁ traced
  beside it as E(t) over the mean ± ΔX band; the photon-number distribution.  The vacuum's
  noise is real; a laser's coherent state is the classical field plus that noise; more
  photons give the same absolute noise and a sharper phase, Δφ = 1/(2|α|).
- *2 · Squeezing*: the vacuum or a laser's field through a χ⁽²⁾ crystal pumped at 2ω, r
  and its dB, the angle, a loss beam splitter with "vacuum in" rounding the ellipse out
  (V = η e^{−2r} + 1 − η: 10 dB through 50% loss is 2.6 dB); the squeezed vacuum's even photon
  numbers with ⟨n⟩ = sinh²r; amplitude- against phase-squeezed, sub- against
  super-Poissonian Δn.
- *3 · Homodyne*: the apparatus (signal, a strong local oscillator with a phase shifter, the
  50:50 beam splitter, two photodiodes, the subtractor); the plane in the LO's frame with
  the yellow X_θ axis you drag and the samples' histogram projected on it; the photocurrent
  sample by sample; the noise against θ in dB re ¼ with the measured record over theory and a
  motor that scans θ, so the student finds the ±6 dB of a squeezed state; a small phase shift
  on a coherent state read at the standard quantum limit (SNR 0.60, Δφ_min = 0.167 rad at
  |α| = 3) and below it with 6 dB of phase squeezing (SNR 1.12, 0.083 rad).
- *4 · LIGO*: the interferometer sketch (laser, power recycling, the 4 km arm cavities at
  400 kW, the dark port, the isolator, the photodiode; "the vacuum enters here" when
  squeezing is off, the OPO and the filter cavity when on); the strain sensitivity on log
  axes (shot noise, radiation pressure, the standard quantum limit touched at 48 Hz, the
  seismic wall, thermal noise, the total, with the unsqueezed total ghosted behind) from
  Kimble et al. 2001, injected squeezing of any angle and loss, and frequency-dependent
  squeezing turning the angle with frequency; a binary's Newtonian chirp (two neutron stars
  at 40 Mpc, two black holes at 500 Mpc) drawn as a band over the curve and as h(t), with
  "Hear it"; its matched-filter signal-to-noise ratio.  The payoff as a number: 6 dB of
  frequency-dependent squeezing through 20% loss takes ρ from 72.3 to 104.2, 1.44 times as
  far, 3.0 times the volume, the reach at ρ = 8 from 361 to 521 Mpc.

Physics in DOM-free modules checked against closed forms: the Wigner function against the
phase-space demo's to 3e-17, the photon statistics (Poisson; even-only for the squeezed
vacuum; ⟨n⟩ and Δn² of a displaced squeezed state) to 1e-5, the homodyne variance against
θ, the loss formula, the SQL envelope over all powers to 1e-5, frequency-dependent squeezing
giving e^{−2r} at every frequency, the matched-filter SNR by FFT against the stationary-phase
quadrature within 4%.  Departures from the brief, said in the help: the shot noise is flat
below the arm bandwidth and rises ∝ f above it (the Fabry–Pérot result), not ∝ √f; 6 dB
rather than 10 in the phase-shift experiment, because at 10 dB the turned ellipse's wide
side leaks into the reading.  Left: a whitened detector trace with the chirp buried in
simulated noise, the visual twin of the SNR number.

**Tests.**  15 unit tests and an 86-check UI test (desktop, dark, phone), both passing on the
merged `main` with the whole unit-test page at 410 passed; one wait in the UI test could throw
if it ran while the page was still loading, and is guarded now.

## Prompt 22

> Do the natural followups.

### Response 22 (2026-11-04)

**Still pictures of every experiment.**  The 2004 rule "Every Animation has Key Frames saved as
Pictures" had never been met.  Now each experiment in a drawer shows a picture of what it looks
like when it is working, under its "Set it up" button (clicking the picture sets it up too).
`tools/frames.py <demo>` makes them: it opens each `#setup=`, runs the JavaScript the demo's
`frames.json` gives (stepping the simulation through `window.__app` to the moment the text
describes), crops the panels that carry the idea, and writes `<demo>/frames/<name>.webp` and
`data-frame="WxH"` on the experiment.  `tools/frames.py --check`, now part of
`tools/test_all.sh`, keeps pictures and experiments in step.  Two things about headless
Chromium had to be found the hard way: `captureBeyondViewport` resizes the viewport for an
instant, which clears every canvas that follows its size, so the plots came out blank; and a
scroll may not be painted before the capture, so crops came out shifted.  The tool now stays
at the top of the page and makes the window taller only for a region that reaches below it.
Thin films went first (13 pictures, 7 to 25 kB each).

Then three agents made the pictures of the 17 demos with no other follow-up, one commit per
demo, looking at every picture and at the drawer: 225 more, each moment reached through the
demo's own `__app` hooks (the revival at T_rev, the tunnelling split at t = 40, the beam
through the prism after 30 periods, the kink running out, a scan finished, a sweep stopped at
the line); where a demo had no step hook (radiation, the 1D carpet), the capture stands in a
`requestAnimationFrame` whose clock moves exactly 1/60 s a frame, so the pictures come out the
same on any machine.  The six feature agents made their own demos' pictures last.  Two bugs
came to light making them, both fixed: radiation's experiment 1 set itself up without the
colour map its text describes ("the ring of orange and blue"); and tomography's
`#setup=picture` and `#obj=portrait` links threw while the portrait loaded (the scan measured
a scanner with no object yet), which the UI test had missed by setting up on a page already
running.

**Quantum optics**: the chirp buried in the noise.  Under the sensitivity curve, 8 s of
simulated detector output at 4096 Hz: seeded noise drawn from the current noise curve, the
chirp added at the chosen distance, whitened (or raw), with the template drawn over it, and
under that the matched filter's output z(t), unit-variance noise with a peak of height ρ where
the template lines up.  Squeezing rescales the same noise realisation, so the chirp's peak
grows from 72 to 104 with nothing else changing; drag the distance out to 361 Mpc and the peak
(ρ = 8) stands just above the noise's largest excursion (4.0); at 1000 Mpc the tallest peak is
the noise's.  Checked: the noise's periodogram against S_h within 2%, the whitened variance
0.999, the filter's peak height σ to 1e-9 at the merger sample, 24 realisations giving the
filter noise a variance of 0.994.  Also the homodyne view's Pause button, moved up from below
the fold.

**Radio interferometry**: making the image as a menu that teaches, as the author asked
("a checkbox to turn CLEAN on and off or a menu of different such algorithms; I've thought
less about how to demonstrate this").  A strip under view 4, laid out as equations, shows the
chosen method at work: the *dirty image* as the sky ⊛ the dirty beam beside its uv plane,
black wherever no pair measured; *CLEAN* one step at a time (the residual with a cross on its
brightest pixel, minus gain × peak × the beam there, equals what is left; then the points ⊛
the clean beam + the residual = the image), with Step, Watch and Run; and *maximum entropy*
(new, `imaging.js`), the smoothest positive sky that fits the data, I = M e^{R/α} at every
pixel, solved by preconditioned conjugate gradients, with its own strip.  Each method's uv
tile shows its guess at the spacings no pair measured, and the image's error against the
true sky is a number.  On a Y of 27 dishes for 8 hours, CLEAN finds the binary in 2 components
(0.01% off, MEM 0.11%) and MEM wins on the galaxy (0.61% in 40 iterations, CLEAN 2.9% after
1000 steps).  With intensity correlations (HBT) the Etch-a-Sketch's image is captioned as the
sky's autocorrelation (a binary becomes three points, a triangle a hexagon), with a link to the
optics lab's phase-problem part.  A sampled-plane display bug that could skip a row of samples
was fixed on the way.

**Scattering in 2D**, the two pieces the plan had promised and the demo never drew.  Outside
the momentum circle, Born's dσ/dθ (grey dashes) and the measured one (blue) on one scale, and
a pink arrow q = k − k₀ from k₀'s tip to the circle that follows the pointer, with
q = 2k₀ sin(θ/2) and both cross sections there in the readout; at the crystal's Bragg angle
the arrow ends on the reflected beam at q = 2π/c.  For the disk, the classical cross section
(r/2)|sin(θ/2)|, σ = 2r (tested against 200 000 rays), so the wave's forward peak and its
total, 2.2 to 2.3 times the classical, stand out; a new experiment, "Twice the classical cross
section".

**MRI**: four magnets, 46 µT (the Earth's field), 0.117 T (the TeachSpin's 5 MHz), 1.5 and
3 T, in a DOM-free `magnets.js`: the Larmor frequency, the polarization tanh(γħB/2kT), the
signal per proton ∝ B_pol·B₀ (1.6 × 10⁻⁷ of 1.5 T's at 46 µT with the board's 7.84 mT coil,
9.4 × 10⁻¹⁰ without it), the chemical shift (217 Hz at 1.5 T, 6.7 mHz at 46 µT), the gradient's
sideways field misplacing spins by Gz²/2B₀ (2.7 mm at 46 µT, said but not drawn), and the
pixel SNR from the board's own measured noise, 0.463 nV/√Hz.  A new phantom of tubes (tap
water, copper sulphate, oil), the only honest sample at 46 µT: a pixel of water has an SNR of
5.7 per average; with the polarizing coil off making that up would take 258 days.  The brief
was wrong in one place and the agent corrected it: tissue T₁ is *shorter* at low field, not
longer (T₂ hardly changes, T₂* lengthens, pure water doesn't change); the low-field values are
fitted through head measurements at 50 mT (O'Reilly and Webb 2022), and at 0.117 T grey and
white matter look alike on T₁-weighting.  And the decay during the readout as a toggle: the
uneven field smears each pixel along x by T_ro/(πT₂′) pixels (4.02 measured against 4), with
an experiment on why T₂ itself barely smears (a T₂ short enough to blur a pixel has already
faded the tissue to 21%).

**Bloch sphere and NMR**, the board as built.  The tank (`receiver.js`): H(f) for the coil's
26.8 mH and 8.86 Ω with the eight DIP switches' capacitance, drawn as a Bode plot with the
protons' frequency on it, its gain curve also the coil's own thermal noise; drag the peak to
retune, or press "Tune to the protons" for the handbook's recipe at the field set.  The FID is
now shown at OUT on a fixed scale, the noise is the receiver's own (12.6 mV r.m.s. at OUT),
and "Hear it" plays what comes out of the receiver.  Every number checked against the board's
`sim/design.json`: switches 1 2 4 7 give 247.29 nF and 1955.56 Hz, Q = 37.25, 0.8806 V at OUT,
17.21 nV/√Hz.  At 50 µT the protons sit 173 Hz up the tank's tail (×5.34 instead of ×36.6);
the tank also sets how much of the coil's noise gets through.  The coil's angle α to the
Earth's field, with the sin²α law derived (one sin α for the part of M left precessing, one
for what the coil picks up) and confirmed to 3e-3; north–south gives 0.68 of east–west here,
a little under sin²α because the real 0.4 ms switch-off lets M follow the field by a few
degrees.  The spin-½ box folds away on phones; and a bug fixed on the way: the T₁ plot had
only ever recorded the first cycle's point.

**Optical coherence tomography**: averaging B-scans against speckle (the help had mentioned it,
the page didn't offer it): 1 to 16 repeats, each with a fresh speckle pattern (the tissue
moving a fraction of a wavelength, or the beam stepped), the contrast falling 1.31, 0.93,
0.66, 0.47, 0.33 against C₁/√N, the layers staying.  An en-face slab that follows a layer:
11 µm under the pigment epithelium it lies in that one layer under all 4096 A-scans, where a
flat plane at the same mean depth cuts three (38%, 32%, 30%).  The scans moved into a Web
Worker: 16 averaged B-scans at 1024 A-scans a second went from 9% of frames over 33 ms to
none.

**Tests.**  `tools/test_all.sh` on the merged `main`: the unit tests (421 and more, each
follow-up adding its own), the picture check (354 pictures, no problems) and 23 of the 24
demos' UI runs passed.  The quantum-optics run failed on a race in the test, not the page:
right after `location.reload()` the old page's `__app` was still there for a moment, so the
wait for the new page could pass at once and the next call land mid-navigation.  It is fixed
by clearing `__app` before the reload (the dispersion test had the same race, fixed too; the
OCT test already did it), and both tests pass on their own after the fix.  Firefox isn't
installed here.

## Prompt 23

> Do the visualizations make it very clear what the difference between T₁, T₂, and T* are?

### Response 23 (2026-11-04)

Not yet.  T₂* was clear, T₂ only weakly shown, and nothing put the three side by side as three
different clocks.  What worked: in "Many spins" the arrows fan out while each stays full length,
their sum (what the coil sees) dies in about 1.4 ms ("the signal dies, though no spin does"),
the spectrum's width matches 1/(πT₂*), and the echo closes the fan, so that decay can be undone.
T₁ had two good plots, inversion recovery with its null at T₁ ln 2 and, on the board, the FID's
start against polarizing time.  What didn't: T₂ showed only as the echo coming back at 0.85 of
the FID's start (the arrows lose 14% of their length, which you can't see) and as a fitted CPMG
number; every sample has T₁ and T₂ nearly equal (oil 25/20 ms, copper-sulphate water 12/10 ms,
water 2.5/2 s), which is right for those liquids but hides the difference; the echo window (6 ms)
is too short for T₁ and T₂ to act; no experiment shows a single spin relaxing; and the plots show
only the sum, never each spin's own transverse length, the curve that separates T₂ from T₂*.
Proposed: a "Three clocks" experiment with T₂* = 1 ms, T₂ = 10 ms, T₁ = 100 ms on one log time
axis (the sum's |M⊥|, the mean spin's own |M⊥|, M_z, each against its exponential), a ring on the
sphere at the mean spin length, an echo train climbing the T₂ curve, and T₂* ≤ T₂ ≤ 2T₁.

## Prompt 24

> The Teach Spin uses mineral oil for most of the initial demos. Is that one of your materials for NMR?

### Response 24 (2026-11-04)

Yes: mineral oil is the default sample for the TeachSpin instrument and every TeachSpin experiment
opens on it, with T₁ = 25 ms, T₂ = 20 ms and a 500 Hz spread from the magnet's unevenness
(T₂* about 0.6 ms); the page measures CPMG T₂ = 20.2 ms and inversion-recovery T₁ = 25.0 ms with
the null at 17.3 ms.  Two caveats: these are typical values, not checked against TeachSpin's
manual or a class's data (T₁ in oil depends on its grade and temperature, T₂* on the shim; send
the numbers your students measure and the oil will be set to them), and oil already separates
T₂* from T₂ by a factor of 30, but its T₁ and T₂ are close, so the T₁-against-T₂ part needs a
slider-set sample or a more viscous liquid such as glycerol.

## Prompt 25

> In any of the demos, when you show an oscilloscope plot with features about the size of a pixel, did you do proper anti-aliasing or have a proper alpha value, such that it looks like a real professional digital oscilloscope rather than a simple "all or nothing" plot?  In the Quantum Optics demo, "The signal" plot that you happened to screenshot looked like it had some aliasing-looking features.

### Response 25 (2026-11-04)

No.  Dense traces were drawn as each pixel column's lowest-to-highest sample, a solid stroke
(the quantum-optics chirp and detector strips, the NMR coil and receiver voltages, the OCT
detector trace, the interferometer's record, the dispersion pulse), or as plain polylines (the
radio time streams).  Nothing at partial brightness, nothing weighted by time.  The chirp aliases
because at 70 Hz one cycle spans about 2.5 pixel columns, so each column's height depends on where
in the cycle it falls (the diamond pattern), and near the merger there are only about 2.6 samples
per cycle, so straight lines between samples misdraw the peaks.  Doing it properly, as a digital
phosphor scope does: intensity grading by the time spent in each pixel with soft edges and a
gamma, continuity between columns, sin(x)/x interpolation where samples are sparse, and an
ordinary anti-aliased line where there's less than a sample per pixel, in one shared `lib/scope.js`.

## Prompt 26

> Yes to both. If it ends up being too slow on a student's weak or old laptop, maybe we can go back to the old way. I honestly have no idea what will be the speed-limiting part of any of these demos. After you make these changes, do some UI tests and rank them from most responsive to least responsive. For the least responsive ones, figure out where all the time is going.

### Response 26 (2026-11-04)

**Oscilloscope traces.**  `lib/scope.js` draws a dense trace the way a digital phosphor scope
does: each straight piece between two samples deposits its time over the pixels it crosses,
split at column boundaries and across rows by overlap (anti-aliased both ways), shared between
the two nearest columns; a pixel's brightness is its relative density (time in the pixel against
the column's height of trace) through a gamma, never below a floor wherever the trace passed, so
a brief spike (the matched filter's peak) still shows.  A (1, 2, 1)/4 filter across columns,
weighted by how often the trace turns in each column, takes out the beating with the pixel grid
for bands without blurring cycles that stand apart; thickness is a spread down each column
(widening each piece left beads and contour lines where pieces meet); band-limited (Lanczos)
interpolation for sparse oscillations; a picture cache keyed on what the samples depend on;
sparse traces are plain canvas lines.  `?scope=fast` in the address (or localStorage
`brainflux.scope` = `fast`) brings back the old per-column min/max for a slow machine.  The
chirp's diamond pattern and white notches are gone, and its merger peak is no longer cut off.  The detector's noise is a scope's
noise band; the OCT, Michelson and dispersion carriers are graded bands under their exact
envelopes; NMR's 5 MHz FID is a band whose edges are the envelope, with Earth's-field audio
cycles resolved; the radio streams and the drum's signal likewise.  Agents converted the demos
and each found a weakness of the library on the way, now fixed: smoothing that ran resolvable
fringes together, beads on thick traces, contour lines on 1-2 px traces, a slow interpolator,
the fast mode's false diagonals across gaps, its miter spikes.  MRI's plots were all sparse;
14 other demos have no dense traces.

**Three clocks** (NMR experiment 7): a made-up sample, T₂* = 1 ms (a Lorentzian spread of
286.5 Hz, so the sum decays exactly exponentially), T₂ = 10 ms, T₁ = 100 ms.  On one log time axis from 0.1 to
300 ms: the sum |ΣM⊥|/N that the coil sees, the mean of each spin's own |M⊥ᵢ|, and M_z, each
against its exponential, with dots at the fitted 1/e times (0.9999 ms, 10.000 ms, 100.00 ms);
a separate CPMG run's echoes land on the T₂ curve and never above it; on the sphere a ring at
height M_z with radius mean |M⊥ᵢ|, so the fan (T₂*), the shrinking ring (T₂) and the climb (T₁)
are three different motions; a bar from T₂* to 2T₁ holds T₂'s mark.  At 1 ms the sum is 0.367
while each spin is still 0.904 long.

**Responsiveness.**  `tools/perf.py` opens every demo, presses every experiment's "Set it up",
records two seconds of animation frames and the main thread's busy time, then drags up to two
sliders in steps and times each from the input event to the end of the frame that shows it,
all with the CPU slowed 4x by DevTools (an older laptop's stand-in; headless Chromium draws
canvases in software here, so the numbers rank the demos rather than promise a laptop's).  The
worst experiment of each, most responsive first: fourier and imaging 17 ms (a full 60 frames a
second), fft2d 33, planewave 42, holography 57, arrays, nmr, radiation and thinfilms about 70,
drums 74, dispersion 103, phasespace 111, schrodinger2d 122, quantumoptics 137, beams 179,
interferometer 186, mri 238, tomography 367, diffraction 384, radiointerferometer 473,
schrodinger1d 830, oct 1037, maxwell2d 1848, action 3131.

The new traces are not the limit anywhere: with `?scope=fast` the seven converted demos rank
the same within the noise.  The survey's first run found a real bug instead: in ten demos the
animation loop started a second copy of itself whenever something inside a frame asked for a
redraw, and NMR's three clocks do that on every slider move, so nine loops ended up running and
every later NMR experiment fell to 5-6 frames a second.  Fixed in all ten, and the tool now
counts loops (one each, everywhere).

Where the time goes in the slowest (profiles of self time per function): action's mass slider
with a typed potential, 3-4 s a step, is the integrator's force (45%) evaluating the typed
expression node by node (35%) while every true path is shot again; maxwell2d's prism tilt,
2.3 s, is the material grid rebuilt by a point-in-polygon test per cell (53%, and 18% garbage
collection); OCT's bandwidth in the Fourier-domain B-scan, 1.0-1.2 s, is the speckle made again
from all its scatterers (70%); Schrödinger 1D's potential sliders, 0.8-0.9 s, are the
eigenstates found again (50-65%) and FFTs; the radio's maximum entropy runs at 5-6 frames a
second on its 2D FFTs; diffraction's white light is a 2D propagation per wavelength.  All are
full-quality recomputations on the page's one thread; the cures (a coarse version while
dragging, caching what the slider doesn't touch, a worker) are listed in PLAN.md.

**Tests.**  `tools/test_all.sh`: the unit tests, 355 pictures with no problems, and all 24
demos' UI runs pass; the ten loop-fixed demos' UI runs pass again after the fix.
