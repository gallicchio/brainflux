# BrainFlux

Interactive physics demonstrations for undergraduates, in any modern web browser:
**https://gallicchio.github.io/brainflux/**

Jason Gallicchio wrote the first BrainFlux Java applets, a two-dimensional Fourier transform you
could paint on and a one-dimensional Schrödinger equation solver, in 2000 and 2001.  For lack of
time they were left to stagnate, and browsers eventually stopped running Java applets at all.
In 2026 they were revived, rewritten and extended with the help of Claude:

- [2D Fourier transform](https://gallicchio.github.io/brainflux/fft2d/)
- [Schrödinger equation in 1D](https://gallicchio.github.io/brainflux/schrodinger1d/)
- [Least action](https://gallicchio.github.io/brainflux/action/)
- [Scattering in 2D](https://gallicchio.github.io/brainflux/schrodinger2d/)
- [Plane waves](https://gallicchio.github.io/brainflux/planewave/)
- [Diffraction](https://gallicchio.github.io/brainflux/diffraction/)
- [Fourier series you can hear](https://gallicchio.github.io/brainflux/fourier/)

They are static pages with no frameworks, no build step and no server code: serve this folder
with any web server (`python3 -m http.server`) and open it.  `DEVELOPING.md` explains the
structure and the tests; `CLAUDE_CODE_CHAT.md` records the conversation the rebuild came from.

Code: MIT.  Text and images: CC BY 4.0, except as listed in `LICENSE-CONTENT.md`.
