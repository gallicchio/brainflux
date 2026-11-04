// Pulse sequences: the presets (FID, spin echo, inversion recovery, Carr–Purcell–Meiboom–Gill),
// and silent runs of a sequence with a varying delay for the plots of amplitude against the
// delay, with the time constant fitted; and the board's amplitude against the polarizing time.
// No DOM.

import { pulseDuration, polarized, switchOff, T2star } from './bloch.js';
import { Engine } from './engine.js';
import { fitShape } from './signal.js';

const DEG = Math.PI / 180;

/**
 * The presets.  Pulses are {t, angle, phase}: t the time of the pulse's centre in seconds (a hard
 * pulse acts as if all at once at its centre, so a π pulse centred at τ makes the echo at 2τ),
 * angle and phase in degrees.  τ and n are the sliders.
 */
export const PRESETS = {
  fid: {
    label: 'FID', title: 'One π/2 pulse, then listen: the free induction decay',
    pulses: () => [{ t: 0, angle: 90, phase: 0 }],
    span: (tau, n, T2s) => 6 * T2s,
  },
  echo: {
    label: 'Spin echo', title: 'π/2, then π at τ: the spread refocuses into an echo at 2τ (Hahn)',
    pulses: (tau) => [{ t: 0, angle: 90, phase: 0 }, { t: tau, angle: 180, phase: 0 }],
    span: (tau, n, T2s) => 2 * tau + Math.max(tau, 4 * T2s),
    echoes: (tau) => [2 * tau],
  },
  ir: {
    label: 'Inversion recovery', title: 'π, then π/2 at τ: how much of M has come back to ẑ in τ (T₁)',
    pulses: (tau) => [{ t: 0, angle: 180, phase: 0 }, { t: tau, angle: 90, phase: 0 }],
    span: (tau, n, T2s) => tau + 5 * T2s,
  },
  cpmg: {
    label: 'CPMG', title: 'π/2 about x, then π about y at τ, 3τ, 5τ…: a train of echoes decaying with T₂ (Carr–Purcell–Meiboom–Gill)',
    pulses: (tau, n) => [{ t: 0, angle: 90, phase: 0 }, ...Array.from({ length: n }, (_, k) => ({ t: (2 * k + 1) * tau, angle: 180, phase: 90 }))],
    span: (tau, n) => (2 * n + 1) * tau,
    echoes: (tau, n) => Array.from({ length: n }, (_, k) => 2 * (k + 1) * tau),
  },
  cp: {
    label: 'Carr–Purcell', title: 'As CPMG, but the π pulses about x′, the axis of the π/2: an error in the π pulses adds up from echo to echo',
    pulses: (tau, n) => [{ t: 0, angle: 90, phase: 0 }, ...Array.from({ length: n }, (_, k) => ({ t: (2 * k + 1) * tau, angle: 180, phase: 0 }))],
    span: (tau, n) => (2 * n + 1) * tau,
    echoes: (tau, n) => Array.from({ length: n }, (_, k) => 2 * (k + 1) * tau),
  },
};

/** A sequence from a preset: its pulses, the time it spans and where its echoes fall. */
export function buildSequence(name, tau, n, T2s) {
  const P = PRESETS[name];
  return { name, pulses: P.pulses(tau, n), span: P.span(tau, n, T2s), echoes: P.echoes ? P.echoes(tau, n) : [] };
}

/**
 * Run a sequence silently (no page): a fresh engine with these parameters, every spin along ẑ
 * at t = 0, the pulses at their times.  The record is sampled every dt, from 0 to span, or only
 * inside the windows [[t0, t1], ...] if they are given (much cheaper for a long sequence read
 * in a few places).  Returns the engine; its record holds the signal with its unit noise.
 */
export function runSequence(params, pulses, span, dt, seed = 11, windows = null) {
  const e = new Engine(params);
  e.noiseSeed = seed >>> 0;
  e.setSampling(windows ? Infinity : dt);
  const B1 = params.B1 ?? e.p.B1, starts = pulses.map((q) => q.t - pulseDuration(q.angle * DEG, B1) / 2);
  e.reset([0, 0, 1], Math.min(0, ...starts));
  e.tEnd = span;
  pulses.forEach((q, i) => e.schedule(starts[i], q.angle, q.phase, B1));
  if (!windows) { e.advance(span); return e; }
  for (const [a, b] of windows) {
    if (a > e.t) e.advance(a - e.t);
    e.setSampling(dt);
    e.advance(b - e.t);
    e.setSampling(Infinity);
  }
  return e;
}

/** The time a pulse ends (q.t is its centre). */
export function pulseEnd(q, B1) { return q.t + pulseDuration(q.angle * DEG, B1) / 2; }

/**
 * Inversion recovery for each delay: the signed amplitude just after the π/2 pulse (the mean of
 * M_y′ over a short window after it, noise included), and the fit M0 (1 − 2 e^{−τ/T1}).
 */
export function recoveryCurve(params, taus, sigma = 0, { window = null, seed = 11 } = {}) {
  const T2s = T2star(params.T2, params.spreadHz), win = window ?? Math.min(0.05 * T2s, 1e-3);
  const amp = taus.map((tau, i) => {
    const seq = buildSequence('ir', tau, 1, T2s);
    const q = seq.pulses[1], t0 = pulseEnd(q, params.B1), t1 = t0 + win;
    const e = runSequence(params, seq.pulses, t1, win / 20, seed + i, [[t0, t1]]);
    return e.record.meanY(t0, t1, sigma);
  });
  const fit = fitShape(taus, amp, 'recovery');
  return { tau: taus, amp, window: win, fit: { M0: fit.A, T1: fit.tau, nullAt: fit.tau * Math.LN2, rms: fit.rms } };
}

/** The echoes of a record: the largest envelope within ±w of each expected time, and the fit A e^{−t/T2}. */
export function echoAmplitudes(record, echoTimes, w, sigma = 0) {
  const t = [], amp = [];
  for (const te of echoTimes) { const m = record.envelopeMax(te - w, te + w, sigma); t.push(m.t); amp.push(m.max); }
  const fit = t.length >= 2 ? fitShape(t, amp, 'decay') : null;
  return { t, amp, fit: fit ? { A: fit.A, T2: fit.tau, rms: fit.rms } : null };
}

/**
 * The spin echo for each delay τ: the echo's height at 2τ (noise included) and the fit
 * A e^{−2τ/T2}.
 */
export function echoCurve(params, taus, sigma = 0, { seed = 11 } = {}) {
  const T2s = T2star(params.T2, params.spreadHz);
  const t = [], amp = [];
  taus.forEach((tau, i) => {
    const seq = buildSequence('echo', tau, 1, T2s), w = Math.min(T2s, tau / 2);
    const e = runSequence(params, seq.pulses, 2 * tau + w, w / 40, seed + i, [[2 * tau - w, 2 * tau + w]]);
    const m = e.record.envelopeMax(2 * tau - w, 2 * tau + w, sigma);
    t.push(2 * tau); amp.push(m.max);
  });
  const fit = fitShape(t, amp, 'decay');
  return { t, amp, fit: { A: fit.A, T2: fit.tau, rms: fit.rms } };
}

/**
 * The board: the FID's starting amplitude against the polarizing time, each point from the
 * polarization built in tp (1 − e^{−tp/T1}), what the switch-off leaves across the Earth's field,
 * and a reading of the noisy record over the first `win` of listening; and the fit
 * A (1 − e^{−tp/T1}).  earth: {Bp, BE, ramp, tOpen}; params: the engine's.
 */
export function polarizeCurve(params, earth, tps, sigma = 0, { win = 0.05, seed = 11 } = {}) {
  const amp = tps.map((tp, i) => {
    const e = new Engine(params);
    e.noiseSeed = (seed + i) >>> 0;
    e.setSampling(Infinity);
    e.startEarth({ ...earth, tp, tl: earth.tOpen + win });
    const t0 = tp + earth.ramp + earth.tOpen;
    e.advance(t0 - e.t);
    e.setSampling(win / 25);
    e.advance(e.tEnd - e.t);
    return e.record.envelopeMax(t0, t0 + win, sigma).max;
  });
  const fit = fitShape(tps, amp, 'rise');
  return { tp: tps, amp, fit: { A: fit.A, T1: fit.tau, rms: fit.rms } };
}

/** What a switch-off in `ramp` leaves across the Earth's field, starting from M along the coil. */
export function leftAcross(Bp, BE, ramp, M = 1) {
  const v = switchOff([M, 0, 0], Bp, BE, ramp);
  return { across: Math.hypot(v[0], v[1]), along: v[2] };
}

export { polarized };
