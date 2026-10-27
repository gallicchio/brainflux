// The potentials, each with a domain, boundaries, a sensible energy range for the plot, and
// initial states worth starting from.  Units: hbar = m = 1, so energies and times are in the
// same arbitrary units, and a packet exp(i k0 x) moves at speed k0.
//
// An initial state is one of
//   { kind: 'packet', params: { x0, sigma, k0 } }     a Gaussian packet (sigma is the width of |psi|^2)
//   { kind: 'eigen', n }                             the n-th stationary state (0 = the lowest)
//   { kind: 'two', n, m }                            (psi_n + psi_m) / sqrt 2
//   { kind: 'typed', psi, params }                   any expression in x
// Typed expressions are normalised automatically.
//
// states: the named starting points, the first being the one a potential opens with.  The page
// groups them by kind, beside a button for each kind (which keeps a state of that kind once it no
// longer matches a named one).  A state may carry its own speed (else the potential's).
// typed: what Typed starts from: a smooth, normalisable psi0 that suits the potential, with
// slider ranges for its parameters if the usual guesses won't do.

export const PACKET = 'exp(-(x-x0)^2/(4 sigma^2) + i k0 x)';

// Two momenta in one envelope, for the scatterers: the slow half and the fast half part ways.
const TWO_MOMENTA = { psi: 'exp(-(x+25)^2/100) (exp(i k1 x) + exp(i k2 x))', params: { k1: 1.6, k2: 2.6 } };
// A bump in one well and a smaller one in the other: c = 0 is all on the left, c = 1 and -1 are
// close to the two lowest states.
const TWO_BUMPS = (d) => ({ psi: `exp(-(x+${d})^2) + c exp(-(x-${d})^2)`, params: { c: 0.5 }, hints: { c: { min: -1, max: 1, value: 0.5 } } });

export const POTENTIALS = [
  {
    id: 'free', label: 'Free', noLevels: true,
    V: '0', domain: [-50, 50], n: 2048, boundary: 'absorbing', erange: [0, 5], prange: 5, speed: 4,
    states: [
      { label: 'Moving', kind: 'packet', params: { x0: -25, sigma: 2, k0: 2 } },
      { label: 'Narrow, at rest', kind: 'packet', params: { x0: 0, sigma: 0.4, k0: 0 } },
      { label: 'Two packets meet', kind: 'typed', psi: 'exp(-(x+d)^2/(4 sigma^2) + i k0 x) + exp(-(x-d)^2/(4 sigma^2) - i k0 x)', params: { d: 15, sigma: 2, k0: 2 } },
    ],
    // At rest but made of +k0 and -k0: it splits in two.
    typed: { psi: 'exp(-x^2/(4 sigma^2)) cos(k0 x)', params: { sigma: 2, k0: 2 } },
  },
  {
    // The well is the domain, between walls; the plot shows a little beyond them.
    id: 'box', label: 'Infinite well', nOffset: 1,
    V: '0', domain: [0, 10], n: 1024, boundary: 'walls', erange: [0, 6], prange: 6, speed: 2,
    states: [
      { label: 'Bouncing', kind: 'packet', params: { x0: 3, sigma: 0.6, k0: 2 } },
      { label: 'n = 1', kind: 'eigen', n: 0 },
      { label: 'n = 2', kind: 'eigen', n: 1 },
      { label: '1 + 2', kind: 'two', n: 0, m: 1 },
    ],
    // Griffiths' example: 99.9% the ground state.
    typed: { psi: 'x (10 - x)', params: {} },
  },
  {
    id: 'harmonic', label: 'Harmonic',
    V: 'omega^2 x^2/2', params: { omega: 1 }, domain: [-10, 10], n: 1024, boundary: 'walls', erange: [0, 10], prange: 5, speed: 1,
    states: [
      { label: 'Coherent', kind: 'packet', params: { x0: 3, sigma: 0.7071, k0: 0 } },
      { label: 'Squeezed', kind: 'packet', params: { x0: 0, sigma: 0.3, k0: 0 } },
      { label: 'n = 0', kind: 'eigen', n: 0 },
      { label: 'n = 1', kind: 'eigen', n: 1 },
      { label: '0 + 1', kind: 'two', n: 0, m: 1 },
    ],
    // A "cat": two coherent states on opposite sides, which meet in the middle and interfere.
    typed: { psi: 'exp(-(x-d)^2/2) + exp(-(x+d)^2/2)', params: { d: 3 } },
  },
  {
    id: 'step', label: 'Step', noLevels: true,
    V: 'V0 step(x)', params: { V0: 2 }, domain: [-60, 60], n: 4096, boundary: 'absorbing', erange: [0, 4], prange: 3.5, speed: 5,
    barrier: 0,
    states: [
      { label: 'Below the step', kind: 'packet', params: { x0: -25, sigma: 4, k0: 1.8 } },
      { label: 'Above the step', kind: 'packet', params: { x0: -25, sigma: 4, k0: 2.4 } },
    ],
    typed: TWO_MOMENTA,
  },
  {
    id: 'barrier', label: 'Barrier', noLevels: true,
    V: 'V0 (abs(x) < a/2)', params: { V0: 2, a: 1 }, domain: [-60, 60], n: 4096, boundary: 'absorbing', erange: [0, 4], prange: 3.5, speed: 5,
    barrier: 0,
    states: [
      { label: 'Tunnelling', kind: 'packet', params: { x0: -25, sigma: 4, k0: 1.8 } },
      { label: 'Above the barrier', kind: 'packet', params: { x0: -25, sigma: 4, k0: 2.4 } },
    ],
    typed: TWO_MOMENTA,
  },
  {
    // V0 = 7 and a = 1: three bound states, a transmission resonance at 2a k' = 3 pi (k' the
    // wavenumber inside, sqrt(k^2 + 2 V0)), k = 2.865, and halfway to the one below it,
    // 2a k' = 2.5 pi, strong reflection, k = 1.19.  Averaged over the packets' spread in k
    // (1/2 sigma = 0.2), T = 0.98 and 0.31.
    id: 'well', label: 'Finite well',
    V: '-V0 (abs(x) < a)', params: { V0: 7, a: 1 }, domain: [-30, 30], n: 2048, boundary: 'absorbing', erange: [-7.5, 5], prange: 6, speed: 1,
    barrier: 0,
    states: [
      { label: 'n = 0', kind: 'eigen', n: 0 },
      { label: 'n = 1', kind: 'eigen', n: 1 },
      { label: 'n = 2', kind: 'eigen', n: 2 },
      { label: '0 + 1', kind: 'two', n: 0, m: 1 },
      { label: 'On resonance', kind: 'packet', params: { x0: -14, sigma: 2.5, k0: 2.865 }, speed: 2 },
      { label: 'Off resonance', kind: 'packet', params: { x0: -14, sigma: 2.5, k0: 1.19 }, speed: 3 },
    ],
    // Narrower than the ground state: partly bound, and the rest escapes.
    typed: { psi: 'exp(-x^2/(4 sigma^2))', params: { sigma: 0.3 } },
  },
  {
    id: 'double', label: 'Double well',
    V: 'V0 ((x/a)^2 - 1)^2', params: { V0: 3, a: 1.5 }, domain: [-6, 6], n: 1024, boundary: 'walls', erange: [0, 6], prange: 5, speed: 3,
    states: [
      { label: 'Left well', kind: 'two', n: 0, m: 1 },
      { label: 'n = 0', kind: 'eigen', n: 0 },
      { label: 'n = 1', kind: 'eigen', n: 1 },
      { label: 'On the left', kind: 'packet', params: { x0: -1.5, sigma: 0.4, k0: 0 } },
    ],
    typed: TWO_BUMPS(1.5),
  },
  {
    id: 'delta', label: 'Delta', kc: 40,
    V: '-alpha exp(-x^2/(2 w^2))/(sqrt(2 pi) w)', params: { alpha: 1, w: 0.03 }, domain: [-30, 30], n: 2048, boundary: 'absorbing', erange: [-1, 2], prange: 3, speed: 3,
    barrier: 0,
    states: [
      { label: 'Bound state', kind: 'eigen', n: 0 },
      { label: 'Moving', kind: 'packet', params: { x0: -15, sigma: 3, k0: 1 } },
    ],
    // Smooth, with the tails e^-|x| of a true delta's bound state (alpha = 1) but no cusp: 96% of
    // it is bound, and the rest leaves.
    typed: { psi: 'sech(x)', params: {} },
  },
  {
    id: 'bouncer', label: 'Bouncer', nOffset: 1,
    V: 'g x', params: { g: 1 }, domain: [0, 40], n: 2048, boundary: 'walls', erange: [0, 16], prange: 6, speed: 3,
    states: [
      { label: 'Dropped', kind: 'packet', params: { x0: 10, sigma: 1, k0: 0 } },
      { label: 'n = 1', kind: 'eigen', n: 0 },
      { label: 'n = 3', kind: 'eigen', n: 2 },
    ],
    // The variational guess: <E> = b^2/2 + 3g/2b, least (1.966) at b = 1.145.
    typed: { psi: 'x exp(-b x)', params: { b: 1 }, hints: { b: { min: 0.2, max: 4, value: 1 } } },
  },
  {
    id: 'vee', label: 'V-shaped',
    V: 'F abs(x)', params: { F: 1 }, domain: [-20, 20], n: 2048, boundary: 'walls', erange: [0, 10], prange: 5, speed: 2,
    states: [
      { label: 'Released', kind: 'packet', params: { x0: 6, sigma: 1, k0: 0 } },
      { label: 'n = 0', kind: 'eigen', n: 0 },
      { label: 'n = 1', kind: 'eigen', n: 1 },
    ],
    typed: { psi: 'exp(-(x-d)^2/2) + exp(-(x+d)^2/2)', params: { d: 6 } },
  },
  {
    id: 'lattice', label: 'Lattice',
    V: 'V0 cos(2 pi x/a) + F x', params: { V0: 2, a: 1, F: 0.25 }, domain: [-40, 40], n: 4096, boundary: 'walls', erange: [-5, 8], prange: 8, speed: 6,
    noLevels: true,
    states: [
      { label: 'Wide', kind: 'packet', params: { x0: 0, sigma: 4, k0: 0 } },
    ],
    // The same envelope at the edge of the Brillouin zone, k = pi/a: the top of the lowest band,
    // with its density in the wells (x = 1/2, 3/2, ...).  The force carries it across the zone.
    typed: { psi: 'exp(-x^2/(4 sigma^2)) sin(pi x)', params: { sigma: 4 } },
  },
  {
    id: 'driven', label: 'Driven',
    V: 'x^2/2 - F x cos(w t)', params: { F: 0.2, w: 1 }, domain: [-15, 15], n: 1024, boundary: 'walls', erange: [0, 12], prange: 6, speed: 3,
    states: [
      { label: 'n = 0', kind: 'eigen', n: 0 },
    ],
    // Mostly n = 0, some n = 1.
    typed: { psi: '(1 + c x) exp(-x^2/2)', params: { c: 0.5 }, hints: { c: { min: -3, max: 3, value: 0.5 } } },
  },
  {
    id: 'custom', label: 'Typed',
    V: 'x^4/4 - 2 x^2', domain: [-6, 6], n: 1024, boundary: 'walls', erange: null, prange: 6, speed: 2,
    states: [
      { label: 'On the left', kind: 'packet', params: { x0: -2, sigma: 0.4, k0: 0 } },
      { label: 'n = 0', kind: 'eigen', n: 0 },
    ],
    typed: TWO_BUMPS(2),
  },
];
