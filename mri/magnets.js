// The magnets: four fields, from the Earth's to a 3 T scanner, and what changes between them.
// No DOM: the tests import this.
//
//   46 µT    the Earth's field where the NMR demo's board is (Claremont), protons at 1959.8 Hz;
//            no magnet to polarize them, so a coil does (7.84 mT for a few seconds), and then
//            they are listened to in the Earth's field (the board's numbers: ../nmr/, and the
//            author's earth-nmr-pcb design)
//   0.117 T  the TeachSpin's magnet, protons at 5.000 MHz (the NMR demo's other instrument);
//            low-field scanners (0.05 to 0.1 T) image heads at about this field
//   1.5 T    63.87 MHz, the commonest scanner
//   3 T      127.7 MHz
//
// What changes with the field: the frequencies (f0 = GB B0, and the gradients must stay small
// next to B0, so at 46 µT they are µT/m, not mT/m); the signal (the protons' magnetization grows
// with the field that polarizes them, Curie's law, and the voltage it induces with the frequency
// it turns at, so per proton the signal goes as B_pol B0); the relaxation times (tissue T1 is
// shorter at low field, T2 hardly changes, T2* is longer because the field's unevenness, in
// tesla, shrinks with the field); and the chemical shift (3.4 ppm of f0: 217 Hz at 1.5 T,
// 6.7 mHz at 46 µT).  Units as in bloch.js where they meet it: mm, ms, mT/m, kHz.

import { GB } from './bloch.js';

export const GBAR = 42.577e6;                 // Hz per tesla, gamma / 2 pi for protons
export const GAMMA = 2 * Math.PI * GBAR;      // rad/s/T
export const HBAR = 1.054571817e-34, KB = 1.380649e-23;

/** The Earth's-field board (the NMR demo's BOARD, from the author's earth-nmr-pcb design):
 *  a litre of water fully polarized by 7.84 mT (1.5 A in its coil) precessing in 46.03 µT at
 *  1959.8 Hz induces 1.199 µV in the coil; the receiver's noise, in its 82.65 Hz noise
 *  bandwidth, is 285 times smaller.  So the noise at the coil is 1.199 µV / (285 sqrt(82.65 Hz))
 *  = 0.463 nV per root hertz: the coil's own 8.9 ohms (0.38 nV/√Hz) and the preamplifier. */
export const BOARD = { emf: 1.199e-6, litres: 1, Bp: 7.84e-3, BE: 46.03e-6, snr: 285, nbw: 82.65, tp: [200, 4700] };
export const BOARD_NOISE = BOARD.emf / (BOARD.snr * Math.sqrt(BOARD.nbw));   // V/√Hz at the coil

/**
 * The four magnets.  For view 4 each carries its scanner's settings: the readout gradient
 * (default and range, mT/m), the unit it is shown in, the RF pulses' and the phase-encoding
 * lobe's lengths (ms: at 46 µT a pulse at 2 kHz lasts milliseconds and the lobes must be long,
 * since the gradients are weak), the field's unevenness T2' (ms), the echo times the decay
 * curve shows, and the objects it can image.  For view 1, `scale`: how much weaker its
 * gradients are (the page's picture is the same, with frequencies `scale` times lower and
 * times `scale` times longer).
 */
export const MAGNETS = {
  earth: {
    id: 'earth', B0: BOARD.BE, label: '46 µT', name: "the Earth's field", short: "the Earth's 46 µT",
    title: "The Earth's field (46.0 µT in Claremont, as the NMR demo's board): protons at 1960 Hz.  A coil polarizes them first (7.84 mT), since 46 µT would give 170 times less",
    Bp: BOARD.Bp, gUnit: 'µT/m', gMul: 1000, Gx: 0.1, GxRange: [0.01, 0.3], Trf: 5, Tpe: 30, T2p: 1500, TEmax: 1500, Tmax2: 1000,
    objects: ['tubes'], scale: 20,
  },
  ts: {
    id: 'ts', B0: 5 / 42.577, label: '0.117 T', name: 'a 0.117 T magnet', short: '0.117 T',
    title: 'A 0.117 T magnet, the TeachSpin\'s (the NMR demo\'s other instrument): protons at 5.000 MHz.  Low-field scanners image heads at 0.05 to 0.1 T',
    gUnit: 'mT/m', gMul: 1, Gx: 4, GxRange: [0.3, 8], Trf: 2, Tpe: 1, T2p: 60 * 1.5 / (5 / 42.577), TEmax: 250, Tmax2: 300,
    objects: ['head', 'disks', 'tubes'], scale: 1,
  },
  '1.5': {
    id: '1.5', B0: 1.5, label: '1.5 T', name: 'a 1.5 T scanner', short: '1.5 T', title: 'A 1.5 T scanner: protons at 63.87 MHz',
    gUnit: 'mT/m', gMul: 1, Gx: 4, GxRange: [0.3, 8], Trf: 2, Tpe: 1, T2p: 60, TEmax: 250, Tmax2: 300, objects: ['head', 'disks', 'tubes'], scale: 1,
  },
  '3': {
    id: '3', B0: 3, label: '3 T', name: 'a 3 T scanner', short: '3 T', title: 'A 3 T scanner: protons at 127.7 MHz',
    gUnit: 'mT/m', gMul: 1, Gx: 4, GxRange: [0.3, 8], Trf: 2, Tpe: 1, T2p: 30, TEmax: 250, Tmax2: 300, objects: ['head', 'disks', 'tubes'], scale: 1,
  },
};
export const MAGNET_IDS = ['earth', 'ts', '1.5', '3'];

/** The magnet nearest a field B0 (T), by ratio. */
export function magnetOf(B0) {
  let best = '1.5', d = Infinity;
  for (const id of MAGNET_IDS) { const e = Math.abs(Math.log(B0 / MAGNETS[id].B0)); if (e < d) { d = e; best = id; } }
  return MAGNETS[best];
}

/** The Larmor frequency of protons (Hz) in the field B (T). */
export const larmorHz = (B) => GBAR * B;

/** The protons' polarization in a field B (T) at the temperature T (K): the excess of spins
 *  along the field over all of them, tanh(gamma hbar B / 2 k T); a few parts per million at
 *  1.5 T, and proportional to B at every field here (Curie's law). */
export const polarization = (B, T = 293.15) => Math.tanh((GAMMA * HBAR * B) / (2 * KB * T));

/** The signal per proton, as a fraction of a 1.5 T scanner's: the magnetization (from the field
 *  that polarizes them, B_pol) times the rate it turns at (B0), so B_pol B0 / (1.5 T)^2. */
export function signalPerProton(m, polarize = true) {
  const Bpol = m.Bp && polarize ? m.Bp : m.B0;
  return (Bpol * m.B0) / (1.5 * 1.5);
}

/** Fat's (or oil's) chemical shift: ppm parts per million of f0, in Hz. */
export const chemicalShiftHz = (B0, ppm = 3.4) => ppm * 1e-6 * larmorHz(B0);

/** How much a gradient G (mT/m) changes the field across a length L (mm), as a fraction of B0:
 *  it must stay small, or the field is no longer along z (Maxwell: a field that changes along x
 *  must also turn), and the frequency is no longer GB (B0 + G x). */
export const gradientSpan = (G, L, B0) => (G * 1e-3 * L * 1e-3) / B0;

/** The gradient's own sideways field: a field whose z part rises along x by G must also have an
 *  x part rising along z by G (curl B = 0), so at height z the field is
 *  sqrt((B0 + G x)^2 + (G z)^2) ~ B0 + G x + G^2 z^2 / 2 B0, and the spins there are read as if
 *  G z^2 / 2 B0 further along x.  In mm, for G in mT/m, z in mm, B0 in T: negligible in a
 *  scanner, most of a pixel in the Earth's field. */
export const concomitantShift = (G, z, B0) => ((G * 1e-3 * (z * 1e-3) ** 2) / (2 * B0)) * 1e3;

/**
 * The signal-to-noise ratio of one pixel of water, fully polarized by the board's coil, in a
 * 2D picture made in the Earth's field with the board's coil and receiver: a pixel dx by dx
 * (mm) seen through the whole height h (mm) of the sample (no slice: a projection), Ny lines
 * each read out for Tro (ms), averaged nsa times.  The pixel's water induces
 * emf * (its volume / 1 litre), and the noise in it falls as the square root of the time spent
 * listening, Ny Tro nsa:  SNR = (emf V / 1 L) sqrt(Ny Tro nsa) / (noise at the coil per √Hz).
 * (To within factors of order one: the receiver's filters and the sampling are idealized.)
 */
export function boardPixelSNR({ dx, h, Ny, Tro, nsa = 1 }) {
  const V = (dx * dx * h) / 1e6;                       // litres
  return ((BOARD.emf * V) / BOARD.litres) * Math.sqrt(Ny * (Tro / 1000) * nsa) / BOARD_NOISE;
}

/** The readout's length (ms) for N samples across a field of view fov (mm) under Gx (mT/m). */
export const readoutTime = (N, fov, Gx) => N / (fov * GB * Gx);
