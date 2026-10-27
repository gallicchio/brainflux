# BrainFlux

Interactive physics demonstrations for undergraduates, in any modern web browser:
**https://gallicchio.github.io/brainflux/**

Jason Gallicchio wrote the first BrainFlux Java applets, a two-dimensional Fourier transform you
could paint on and a one-dimensional Schrödinger equation solver, in 2000 and 2001.  For lack of
time they were left to stagnate, and browsers eventually stopped running Java applets at all.
In 2026 they were revived, rewritten and extended with the help of Claude.  The ones marked
beta are new and still being checked.

- [2D Fourier transform](https://gallicchio.github.io/brainflux/fft2d/)
- [Schrödinger equation in 1D](https://gallicchio.github.io/brainflux/schrodinger1d/)
- [Scattering in 2D](https://gallicchio.github.io/brainflux/schrodinger2d/)
- [Plane waves](https://gallicchio.github.io/brainflux/planewave/)
- [Diffraction](https://gallicchio.github.io/brainflux/diffraction/)
- [Fourier series you can hear](https://gallicchio.github.io/brainflux/fourier/)
- [Maxwell's equations in 2D](https://gallicchio.github.io/brainflux/maxwell2d/) (beta)
- [Radiation from a moving charge](https://gallicchio.github.io/brainflux/radiation/) (beta)
- [Antenna arrays and aperture synthesis](https://gallicchio.github.io/brainflux/arrays/) (beta)
- [Interfaces and thin films](https://gallicchio.github.io/brainflux/thinfilms/) (beta)
- [Dispersion and Kramers–Kronig](https://gallicchio.github.io/brainflux/dispersion/) (beta)
- [Interferometers and coherence](https://gallicchio.github.io/brainflux/interferometer/) (beta)
- [Imaging: Abbe and phase contrast](https://gallicchio.github.io/brainflux/imaging/) (beta)
- [Holography](https://gallicchio.github.io/brainflux/holography/) (beta)
- [Tomography](https://gallicchio.github.io/brainflux/tomography/) (beta)
- [Gaussian beams and laser cavities](https://gallicchio.github.io/brainflux/beams/) (beta)
- [Drums and billiards](https://gallicchio.github.io/brainflux/drums/) (beta)
- [Quantum phase space](https://gallicchio.github.io/brainflux/phasespace/) (beta)
- [The principle of least action](https://gallicchio.github.io/brainflux/action/) (beta)

They are static pages with no frameworks, no build step and no server code: serve this folder
with any web server (`python3 -m http.server`) and open it.  `DEVELOPING.md` explains the
structure and the tests; `CLAUDE_CODE_CHAT.md` records the conversation the rebuild came from.

Code: MIT.  Text and images: CC BY 4.0, except as listed in `LICENSE-CONTENT.md`.
