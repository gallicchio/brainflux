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

export const PACKET = 'exp(-(x-x0)^2/(4 sigma^2) + i k0 x)';

export const POTENTIALS = [
  {
    id: 'free', label: 'Free', noLevels: true,
    V: '0', domain: [-50, 50], n: 2048, boundary: 'absorbing', erange: [0, 5], prange: 5, speed: 4,
    states: [
      { label: 'Moving packet', kind: 'packet', params: { x0: -25, sigma: 2, k0: 2 } },
      { label: 'Narrow, at rest', kind: 'packet', params: { x0: 0, sigma: 0.4, k0: 0 } },
      { label: 'Two packets meet', kind: 'typed', psi: 'exp(-(x+d)^2/(4 sigma^2) + i k0 x) + exp(-(x-d)^2/(4 sigma^2) - i k0 x)', params: { d: 15, sigma: 2, k0: 2 } },
    ],
  },
  {
    id: 'box', label: 'Infinite well', nOffset: 1,
    V: '0', domain: [0, 10], n: 1024, boundary: 'walls', erange: [0, 16], prange: 9, speed: 2,
    states: [
      { label: 'Packet', kind: 'packet', params: { x0: 3, sigma: 0.6, k0: 5 } },
      { label: 'n = 1', kind: 'eigen', n: 0 },
      { label: 'n = 2', kind: 'eigen', n: 1 },
      { label: '1 + 2', kind: 'two', n: 0, m: 1 },
    ],
  },
  {
    id: 'harmonic', label: 'Harmonic',
    V: 'omega^2 x^2/2', params: { omega: 1 }, domain: [-10, 10], n: 1024, boundary: 'walls', erange: [0, 10], prange: 5, speed: 1,
    states: [
      { label: 'Coherent', kind: 'packet', params: { x0: 3, sigma: 0.7071, k0: 0 } },
      { label: 'Ground', kind: 'eigen', n: 0 },
      { label: 'n = 1', kind: 'eigen', n: 1 },
      { label: '0 + 1', kind: 'two', n: 0, m: 1 },
      { label: 'Squeezed', kind: 'packet', params: { x0: 2, sigma: 0.3, k0: 0 } },
    ],
  },
  {
    id: 'step', label: 'Step', noLevels: true,
    V: 'V0 step(x)', params: { V0: 2 }, domain: [-60, 60], n: 4096, boundary: 'absorbing', erange: [0, 4], prange: 3.5, speed: 5,
    barrier: 0,
    states: [
      { label: 'Below the step', kind: 'packet', params: { x0: -25, sigma: 4, k0: 1.8 } },
      { label: 'Above the step', kind: 'packet', params: { x0: -25, sigma: 4, k0: 2.4 } },
    ],
  },
  {
    id: 'barrier', label: 'Barrier', noLevels: true,
    V: 'V0 (abs(x) < a/2)', params: { V0: 2, a: 1 }, domain: [-60, 60], n: 4096, boundary: 'absorbing', erange: [0, 4], prange: 3.5, speed: 5,
    barrier: 0,
    states: [
      { label: 'Tunnelling', kind: 'packet', params: { x0: -25, sigma: 4, k0: 1.8 } },
      { label: 'Above the barrier', kind: 'packet', params: { x0: -25, sigma: 4, k0: 2.4 } },
    ],
  },
  {
    id: 'well', label: 'Finite well',
    V: '-V0 (abs(x) < a)', params: { V0: 5, a: 1 }, domain: [-30, 30], n: 2048, boundary: 'absorbing', erange: [-6, 3], prange: 5, speed: 1,
    states: [
      { label: 'Ground', kind: 'eigen', n: 0 },
      { label: 'n = 1', kind: 'eigen', n: 1 },
      { label: 'n = 2', kind: 'eigen', n: 2 },
      { label: '0 + 1', kind: 'two', n: 0, m: 1 },
      { label: 'Packet passing', kind: 'packet', params: { x0: -15, sigma: 2, k0: 1.5 } },
    ],
  },
  {
    id: 'double', label: 'Double well',
    V: 'V0 ((x/a)^2 - 1)^2', params: { V0: 3, a: 1.5 }, domain: [-6, 6], n: 1024, boundary: 'walls', erange: [0, 6], prange: 5, speed: 3,
    states: [
      { label: 'Left well', kind: 'two', n: 0, m: 1 },
      { label: 'Ground', kind: 'eigen', n: 0 },
      { label: 'First excited', kind: 'eigen', n: 1 },
      { label: 'Packet on the left', kind: 'packet', params: { x0: -1.5, sigma: 0.4, k0: 0 } },
    ],
  },
  {
    id: 'delta', label: 'Delta', kc: 40,
    V: '-alpha exp(-x^2/(2 w^2))/(sqrt(2 pi) w)', params: { alpha: 1, w: 0.03 }, domain: [-30, 30], n: 2048, boundary: 'absorbing', erange: [-1, 2], prange: 3, speed: 3,
    barrier: 0,
    states: [
      { label: 'Bound state', kind: 'eigen', n: 0 },
      { label: 'Packet', kind: 'packet', params: { x0: -15, sigma: 3, k0: 1 } },
    ],
  },
  {
    id: 'bouncer', label: 'Bouncer', nOffset: 1,
    V: 'g x', params: { g: 1 }, domain: [0, 40], n: 2048, boundary: 'walls', erange: [0, 16], prange: 6, speed: 3,
    states: [
      { label: 'Dropped', kind: 'packet', params: { x0: 10, sigma: 1, k0: 0 } },
      { label: 'n = 1', kind: 'eigen', n: 0 },
      { label: 'n = 3', kind: 'eigen', n: 2 },
    ],
  },
  {
    id: 'vee', label: 'V-shaped',
    V: 'F abs(x)', params: { F: 1 }, domain: [-20, 20], n: 2048, boundary: 'walls', erange: [0, 10], prange: 5, speed: 2,
    states: [
      { label: 'Released', kind: 'packet', params: { x0: 6, sigma: 1, k0: 0 } },
      { label: 'Ground', kind: 'eigen', n: 0 },
      { label: 'n = 1', kind: 'eigen', n: 1 },
    ],
  },
  {
    id: 'lattice', label: 'Lattice',
    V: 'V0 cos(2 pi x/a) + F x', params: { V0: 2, a: 1, F: 0.25 }, domain: [-40, 40], n: 4096, boundary: 'walls', erange: [-5, 8], prange: 8, speed: 6,
    noLevels: true,
    states: [
      { label: 'Wide packet', kind: 'packet', params: { x0: 0, sigma: 4, k0: 0 } },
    ],
  },
  {
    id: 'driven', label: 'Driven',
    V: 'x^2/2 - F x cos(w t)', params: { F: 0.2, w: 1 }, domain: [-15, 15], n: 1024, boundary: 'walls', erange: [0, 12], prange: 6, speed: 3,
    states: [
      { label: 'Ground', kind: 'eigen', n: 0 },
    ],
  },
  {
    id: 'custom', label: 'Typed',
    V: 'x^4/4 - 2 x^2', domain: [-6, 6], n: 1024, boundary: 'walls', erange: null, prange: 6, speed: 2,
    states: [
      { label: 'Packet', kind: 'packet', params: { x0: -2, sigma: 0.4, k0: 0 } },
      { label: 'Ground', kind: 'eigen', n: 0 },
    ],
  },
];
