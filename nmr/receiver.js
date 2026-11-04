// The Earth's-field board's receiver: the tank (the coil and the capacitor bank that tunes it to
// the protons), the preamplifier's filters and gain, the noise at the tank, and OUT synthesized
// at an audio rate for the headphones and the scope.  The numbers are the board's design values
// (sim/design.json of github.com/gallicchio/earth-nmr-pcb).  No DOM.
//
// The tank.  The protons' EMF is induced in the coil itself, in series with its inductance L and
// its resistance R; the capacitor bank C is across the coil, and the preamplifier reads the
// voltage on C.  So the tank multiplies the EMF by
//     H(f) = 1 / (1 − ω²LC + iωRC),
// which peaks at the resonance f_T = 1/(2π√(LC)): there |H| = Q = ω_T L/R (37 for the board's
// coil) and the phase is −90°.  Below it H → 1, above it H → 0 and the phase goes to −180°.  |H|²
// is f_T/Q = R/(2πL) wide at half height, 52.6 Hz whatever C is.  The tank answers in 2Q/ω_T =
// 6 ms, far quicker than the FID changes, so the FID at the tank is the EMF times H at the Larmor
// frequency, moment by moment.
//
// The bank.  The clamp across the tank (0.39 nF) and eight DIP switches, each adding a C0G
// capacitance when ON: 3.3, 6.8, 13.3, 26.8, 53.8, 106.8, 210, 420 nF, binary-weighted in 3.3 nF
// steps up to 841 nF.  The switch code is the binary number with switch 1 as its lowest bit.
//
// The noise at the tank, per √Hz.  (1) The coil's resistance's thermal noise √(4kTR), in series
// with the EMF and so multiplied by H just as the FID is: its square integrated over all
// frequencies is exactly kT/C (equipartition, ½C⟨V²⟩ = ½kT), whatever R and L are.  (2) The bias
// resistors' current noise through the tank's impedance Z = (R + iωL) H: the same shape, 0.6% of
// the power.  (3) The preamplifier's own voltage noise (its op-amps and resistors), flat:
// 9.8 nV/√Hz.
//
// The receiver.  The tank's voltage ×101 (the instrumentation amplifier), a fourth-order
// high-pass at 0.7 kHz and a second-order low-pass at 4.1 kHz (Sallen–Key sections), then ×201
// (GAIN at HIGH) or ×21 (LOW): ×20 301 or ×2121 from the tank to OUT in the band.

import { gauss2 } from './signal.js';

export const K_B = 1.380649e-23;

/** The board's coil (916 turns of AWG 20 on a 3.5-inch former, 200 mm long) and its bank. */
export const TANK = {
  L: 0.02678504489698124,     // H
  R: 8.855191079966954,       // Ω
  Cclamp: 3.9e-10,            // F: the bidirectional clamp across the tank
  switches: [3.3e-9, 6.8e-9, 13.3e-9, 26.8e-9, 53.8e-9, 106.8e-9, 210e-9, 420e-9],
  T: 293,                     // K
};

/** The receiver's filter sections, gains and noise. */
export const RECEIVER = {
  gain: { high: 20301, low: 2121 },
  sections: [
    { kind: 'hp', f0: 726.439603915684, Q: 0.5477225575051661 },
    { kind: 'hp', f0: 670.044413689595, Q: 1.3051040967281895 },
    { kind: 'lp', f0: 4097.272539089707, Q: 0.7177405625652734 },
  ],
  // The preamplifier's voltage noise, V/√Hz: two OPA197 inputs, the 1 kΩ series resistors, the
  // 200 Ω gain resistor.
  enAmp: Math.hypot(7.778174593052023e-9, 5.688797110110362e-9, 1.7989556014532432e-9),
  // The bias resistors' (two 1 MΩ) current noise, A/√Hz, as the design takes it: √(4kT/1 MΩ)/√2.
  inBias: Math.sqrt((4 * K_B * 293) / 1e6) / Math.SQRT2,
};

// ---------------------------------------------------------------------------- the bank

/** The capacitance across the coil for a switch code (switch 1 the lowest bit), the clamp's included. */
export function bankC(code, tank = TANK) {
  let C = tank.Cclamp;
  for (let i = 0; i < tank.switches.length; i++) if ((code >> i) & 1) C += tank.switches[i];
  return C;
}

/** The switches that are ON in a code: [1, 2, 4, 7]. */
export function switchesOn(code) {
  const out = [];
  for (let i = 0; i < 8; i++) if ((code >> i) & 1) out.push(i + 1);
  return out;
}

/** The code whose capacitance is nearest C (the lowest such code). */
export function codeFor(C, tank = TANK) {
  let best = 0, err = Infinity;
  for (let k = 0; k < 1 << tank.switches.length; k++) {
    const e = Math.abs(bankC(k, tank) - C);
    if (e < err - 1e-18) { err = e; best = k; }
  }
  return best;
}

/** The tank's resonance, 1/(2π√(LC)), in Hz. */
export function resonance(C, L = TANK.L) { return 1 / (2 * Math.PI * Math.sqrt(L * C)); }

/** The capacitance that tunes the coil to f: 1/(4π²f²L). */
export function capacitanceFor(f, L = TANK.L) { return 1 / ((2 * Math.PI * f) ** 2 * L); }

/** The coil's quality factor at f: ωL/R. */
export function quality(f, L = TANK.L, R = TANK.R) { return (2 * Math.PI * f * L) / R; }

/** The tank's width, f_T/Q = R/(2πL): its full width at half power, in Hz. */
export function tankWidth(L = TANK.L, R = TANK.R) { return R / (2 * Math.PI * L); }

/**
 * The handbook's procedure for a field B (tesla): the protons' frequency f = γ̄B, the
 * capacitance that tunes the coil to it, the switch code nearest that, and where the tank then
 * resonates.  Returns {f, C, code, switches, Cset, fT}.
 */
export function tuneFor(B, gammaHz = 42.577e6, tank = TANK) {
  const f = gammaHz * B, C = capacitanceFor(f, tank.L), code = codeFor(C, tank), Cset = bankC(code, tank);
  return { f, C, code, switches: switchesOn(code), Cset, fT: resonance(Cset, tank.L) };
}

// ------------------------------------------------------------------- the tank's response

/** H(f) = 1/(1 − ω²LC + iωRC): the voltage on the tank per volt of EMF in the coil.
 *  Returns {re, im, mag, phase} (phase in radians: −π/2 at the resonance). */
export function tankH(f, C, L = TANK.L, R = TANK.R) {
  const w = 2 * Math.PI * f, a = 1 - w * w * L * C, b = w * R * C, d = a * a + b * b;
  return { re: a / d, im: -b / d, mag: 1 / Math.sqrt(d), phase: Math.atan2(-b, a) };
}

/** The receiver's filters (the two high-pass sections and the low-pass) at f: {re, im, mag, phase}. */
export function filterH(f, rx = RECEIVER) {
  let re = 1, im = 0;
  for (const s of rx.sections) {
    // (s/ω0)² + (s/ω0)/Q + 1 with s = 2πif: (1 − x²) + i x/Q; the high-pass's numerator (ix)² = −x².
    const x = f / s.f0, dr = 1 - x * x, di = x / s.Q, nr = s.kind === 'hp' ? -x * x : 1;
    const d = dr * dr + di * di, qr = (nr * dr) / d, qi = (-nr * di) / d;
    const r = re * qr - im * qi;
    im = re * qi + im * qr; re = r;
  }
  return { re, im, mag: Math.hypot(re, im), phase: Math.atan2(im, re) };
}

// ----------------------------------------------------------------------------- the noise

/** The noise at the tank per √Hz at f (V/√Hz): {coil, bias, amp, total}. */
export function noiseDensity(f, C, tank = TANK, rx = RECEIVER) {
  const h = tankH(f, C, tank.L, tank.R).mag, w = 2 * Math.PI * f;
  const coil = Math.sqrt(4 * K_B * tank.T * tank.R) * h;
  const bias = rx.inBias * Math.hypot(tank.R, w * tank.L) * h;
  const amp = rx.enAmp;
  return { coil, bias, amp, total: Math.sqrt(coil * coil + bias * bias + amp * amp) };
}

/** √(kT/C): the r.m.s. thermal noise voltage on a capacitor C at the temperature T. */
export function kTC(C, T = TANK.T) { return Math.sqrt((K_B * T) / C); }

/**
 * The r.m.s. noise at the tank (V), the square of each density integrated over frequency, through
 * the receiver's filters (as it reaches OUT, divided by the gain) or, with filters: false, as it
 * is on the tank (the coil's part is then √(kT/C)).  Integrated by the trapezoid rule on a
 * logarithmic grid with a fine linear one through the resonance.  Returns {coil, bias, amp, total}.
 */
export function receiverNoise(C, { tank = TANK, rx = RECEIVER, filters = true, f0 = 0.1, f1 = 4e5, n = 4000 } = {}) {
  const fT = resonance(C, tank.L), w = tankWidth(tank.L, tank.R);
  const fs = [];
  for (let k = 0; k <= n; k++) fs.push(f0 * (f1 / f0) ** (k / n));
  for (let k = -1200; k <= 1200; k++) { const f = fT + (k * w) / 20; if (f > f0 && f < f1) fs.push(f); }
  fs.sort((a, b) => a - b);
  const acc = { coil: 0, bias: 0, amp: 0 };
  let prev = null;
  for (const f of fs) {
    const d = noiseDensity(f, C, tank, rx), g2 = filters ? filterH(f, rx).mag ** 2 : 1;
    const cur = { f, coil: d.coil ** 2 * g2, bias: d.bias ** 2 * g2, amp: d.amp ** 2 * g2 };
    if (prev) for (const k of ['coil', 'bias', 'amp']) acc[k] += 0.5 * (cur[k] + prev[k]) * (f - prev.f);
    prev = cur;
  }
  return { coil: Math.sqrt(acc.coil), bias: Math.sqrt(acc.bias), amp: Math.sqrt(acc.amp), total: Math.sqrt(acc.coil + acc.bias + acc.amp) };
}

// ------------------------------------------------------------------ OUT, at an audio rate

/** A biquad from the analog section 1/(s² + s/Q + 1) ('lp') or s²/(…) ('hp'), s in units of 2πf0,
 *  by the bilinear transform prewarped at f0 (kept exactly).  Direct form II, transposed. */
export function biquad(kind, f0, Q, fs) {
  const K = Math.tan((Math.PI * f0) / fs), K2 = K * K, a0 = 1 + K / Q + K2;
  const b = kind === 'hp' ? [1, -2, 1] : [K2, 2 * K2, K2];
  return { b0: b[0] / a0, b1: b[1] / a0, b2: b[2] / a0, a1: (2 * (K2 - 1)) / a0, a2: (1 - K / Q + K2) / a0, z1: 0, z2: 0 };
}

/** Run one sample through a biquad. */
export function biquadStep(q, x) {
  const y = q.b0 * x + q.z1;
  q.z1 = q.b1 * x - q.a1 * y + q.z2;
  q.z2 = q.b2 * x - q.a2 * y;
  return y;
}

/**
 * OUT as the board's receiver gives it, `n` samples at `fs` a second from the time t0: the FID
 * plus the receiver's noise, times the gain.
 *   emf(t, out) puts into out [a, b], the coil's EMF being a sin ωt − b cos ωt volts (ω = 2π fL):
 *     the FID, which the tank and the filters multiply by their gain at fL (its line is far
 *     narrower than either), with their phase;
 *   noise: the coil's thermal noise (and the bias current's) through the tank, and the
 *     preamplifier's flat noise, both through the filters: white sequences drawn by gauss2(seed, k)
 *     for the absolute sample index k = round(t fs), run through biquads from `warm` seconds
 *     before t0, so that a stretch of OUT is the same whichever stretch it was computed in.
 * Returns a Float32Array of volts at OUT.
 */
export function synthOut({ fs, t0, n, fL, C, emf = null, gain = RECEIVER.gain.high, noise = true, seed = 1, averages = 1, warm = 0.04, tank = TANK, rx = RECEIVER }) {
  const out = new Float32Array(n);
  const H = tankH(fL, C, tank.L, tank.R), G = filterH(fL, rx);
  const K = H.mag * G.mag * gain, phi = H.phase + G.phase, w = 2 * Math.PI * fL;
  if (emf) {
    const m = [0, 0];
    for (let j = 0; j < n; j++) {
      const t = t0 + j / fs, p = w * t + phi;
      emf(t, m);
      out[j] = K * (m[0] * Math.sin(p) - m[1] * Math.cos(p));
    }
  }
  if (!noise) return out;
  // The sources, per sample: a one-sided density e over the band up to fs/2 is e √(fs/2) r.m.s.
  const fT = resonance(C, tank.L), wT = 2 * Math.PI * fT, s = Math.sqrt(fs / 2) / Math.sqrt(Math.max(1, averages));
  const eSrc = Math.sqrt(4 * K_B * tank.T * tank.R + (rx.inBias * Math.hypot(tank.R, wT * tank.L)) ** 2) * s, eAmp = rx.enAmp * s;
  // The tank as a biquad (a low-pass at fT, Q = ωT L/R); one far above the band passes as it is.
  const tq = fT < 0.4 * fs ? biquad('lp', fT, quality(fT, tank.L, tank.R), fs) : null;
  const sections = rx.sections.map((q) => biquad(q.kind, q.f0, q.Q, fs));
  const k0 = Math.round(t0 * fs), nw = Math.round(warm * fs);
  for (let j = -nw; j < n; j++) {
    const g = gauss2(seed, k0 + j);
    let v = (tq ? biquadStep(tq, g[0] * eSrc) : g[0] * eSrc) + g[1] * eAmp;
    for (const q of sections) v = biquadStep(q, v);
    if (j >= 0) out[j] += gain * v;
  }
  return out;
}
