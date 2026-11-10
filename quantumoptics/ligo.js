// LIGO's noise budget in formulas, with squeezed light, and a binary's chirp to detect in it.
// SI units; spectral densities are one-sided, strain amplitude spectral densities in 1/√Hz.
//
// The interferometer: a Michelson with Fabry–Pérot arms of length L and half-bandwidth
// γ = 2π f_c, mirrors of mass M, circulating power P in each arm, light of frequency ω0.  Its
// quantum noise, referred to the strain h = ΔL/L (Kimble, Levin, Matsko, Thorne and
// Vyatchanin 2001, for the conventional interferometer reading its phase quadrature):
//
//     S_h(Ω) = (h_SQL²/2) [ V2/K − 2 C12 + K V1 ],
//     h_SQL² = 8ħ/(M Ω² L²),   K = 16 ω0 γ P / (M L c Ω² (γ² + Ω²)),
//
// where V1, V2 and C12 are the variances of the amplitude and phase quadratures of the field
// entering the dark port, and their covariance, in units of the vacuum's (V1 = V2 = 1, C12 = 0
// for the vacuum, which gives (h_SQL²/2)(1/K + K): shot noise ∝ 1/√P, flat below f_c and
// rising above it, and radiation-pressure noise ∝ √P, falling as 1/f²; their product is
// h_SQL⁴/4 whatever P, so the standard quantum limit h_SQL is their envelope).  A squeezed
// vacuum injected at the dark port, squeezed by r along the angle λ from the amplitude
// quadrature (λ = 90°: phase-squeezed), has V1 = e^{−2r} cos²λ + e^{2r} sin²λ, V2 the same with
// the sine and cosine swapped, and C12 = (e^{−2r} − e^{2r}) sin λ cos λ; loss (1 − η) on the
// way in and out mixes the vacuum back in.  The readout's combination a2 − K a1 is the
// quadrature at the angle χ = 90° + arctan K from the amplitude one, so a squeezer that sets
// λ = χ(Ω) at every frequency (a filter cavity does that) lowers the whole curve by e^{−2r}.

export const C = 299792458, HBAR = 1.054571817e-34, G = 6.6743e-11, MSUN = 1.98847e30, MPC = 3.0856776e22;

/** Advanced-LIGO-like numbers. */
export const DEFAULTS = {
  L: 4000,          // arm length, m
  M: 40,            // mirror mass, kg
  lambda: 1064e-9,  // the laser's wavelength, m
  P: 4e5,           // circulating power in each arm, W
  fc: 400,          // the arms' bandwidth (widened by the signal-recycling mirror), Hz
};

/** The squeezer at the dark port: on/off, decibels of squeezing, its angle (degrees from the amplitude quadrature), loss η, and whether a filter cavity makes the angle follow the frequency. */
export const NO_SQUEEZE = { on: false, dB: 0, angle: 90, eta: 1, fd: false };

/** The variances of the amplitude and phase quadratures of the injected field, and their covariance, in vacuum units. */
export function injectedCovariance(sq, lambdaDeg) {
  if (!sq.on || !(sq.dB > 0)) return { V1: 1, V2: 1, C12: 0 };
  const r = (sq.dB * Math.LN10) / 20, lam = (lambdaDeg * Math.PI) / 180, c = Math.cos(lam), s = Math.sin(lam);
  const a = Math.exp(-2 * r), b = Math.exp(2 * r), eta = sq.eta ?? 1;
  return { V1: eta * (a * c * c + b * s * s) + 1 - eta, V2: eta * (a * s * s + b * c * c) + 1 - eta, C12: eta * (a - b) * s * c };
}

/**
 * The quantum noise at frequency f (Hz): {shot, rp, cross, quantum, sql} as power spectral
 * densities of h (1/Hz), plus K and the readout angle chi (degrees).  shot and rp are the
 * phase- and amplitude-quadrature terms; quantum is their sum with the cross term.
 */
export function quantumNoise(f, p = DEFAULTS, sq = NO_SQUEEZE) {
  const Om = 2 * Math.PI * f, gam = 2 * Math.PI * p.fc, w0 = (2 * Math.PI * C) / p.lambda;
  const K = (16 * w0 * gam * p.P) / (p.M * p.L * C * Om * Om * (gam * gam + Om * Om));
  const hSQL2 = (8 * HBAR) / (p.M * Om * Om * p.L * p.L);
  const chi = 90 + (Math.atan(K) * 180) / Math.PI;
  const lam = sq.fd ? chi : sq.angle;
  const { V1, V2, C12 } = injectedCovariance(sq, lam);
  const shot = (hSQL2 / 2) * (V2 / K), rp = (hSQL2 / 2) * K * V1, cross = -hSQL2 * C12;
  return { shot, rp, cross, quantum: shot + rp + cross, sql: hSQL2, K, chi, lambda: lam };
}

/** The classical noises as power spectral densities: a seismic wall below 10 Hz and the thermal noise of the suspensions and mirror coatings. */
export function classicalNoise(f) {
  const seismic = (3e-24 * (10 / f) ** 10) ** 2;
  const suspension = (1e-22 * (10 / f) ** 2.5) ** 2;
  const coating = (1.2e-24 * Math.sqrt(100 / f)) ** 2;
  return { seismic, thermal: suspension + coating };
}

/** Everything at f: the pieces and the total, as power spectral densities. */
export function noiseBudget(f, p = DEFAULTS, sq = NO_SQUEEZE) {
  const q = quantumNoise(f, p, sq), c = classicalNoise(f);
  return { ...q, ...c, total: q.quantum + c.seismic + c.thermal };
}

/**
 * The total noise noiseBudget(f).total at many frequencies at once (fs[i] in Hz, into out), the
 * same numbers by the same formulas with everything that does not depend on f worked out once:
 * the injected covariance (unless the squeezing follows the frequency, when the angle
 * λ = 90° + arctan K gives cos λ = −K/√(1 + K²) and sin λ = 1/√(1 + K²), no trigonometry), and
 * the classical power laws as products.  For the detector's 16 000 frequency bins.
 */
export function totalNoise(fs, p = DEFAULTS, sq = NO_SQUEEZE, out = new Float64Array(fs.length)) {
  const gam = 2 * Math.PI * p.fc, w0 = (2 * Math.PI * C) / p.lambda;
  const kNum = (16 * w0 * gam * p.P) / (p.M * p.L * C), hNum = (8 * HBAR) / (p.M * p.L * p.L);
  const on = sq.on && sq.dB > 0, fd = on && sq.fd;
  let V1 = 1, V2 = 1, C12 = 0, a = 1, b = 1, eta = 1;
  if (on) {
    const r = (sq.dB * Math.LN10) / 20;
    a = Math.exp(-2 * r); b = Math.exp(2 * r); eta = sq.eta ?? 1;
    if (!fd) ({ V1, V2, C12 } = injectedCovariance(sq, sq.angle));
  }
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i], Om = 2 * Math.PI * f, Om2 = Om * Om;
    const K = kNum / (Om2 * (gam * gam + Om2)), hSQL2 = hNum / Om2;
    if (fd) {
      const n = 1 / Math.sqrt(1 + K * K), c = -K * n, s = n;
      V1 = eta * (a * c * c + b * s * s) + 1 - eta; V2 = eta * (a * s * s + b * c * c) + 1 - eta; C12 = eta * (a - b) * s * c;
    }
    const x = 10 / f, x2 = x * x, x4 = x2 * x2, x5 = x4 * x, x10 = x5 * x5;
    const seismic = 9e-48 * x10 * x10, thermal = 1e-44 * x5 + 1.44e-48 * (100 / f);
    out[i] = (hSQL2 / 2) * (V2 / K) + (hSQL2 / 2) * K * V1 - hSQL2 * C12 + seismic + thermal;
  }
  return out;
}

/** The frequency where shot noise and radiation pressure are equal (K = 1), where the curve touches the SQL, by bisection. */
export function sqlFrequency(p = DEFAULTS) {
  let lo = 1, hi = 1e4;
  for (let i = 0; i < 60; i++) {
    const mid = Math.sqrt(lo * hi);
    if (quantumNoise(mid, p).K > 1) lo = mid; else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

/** The phase the dark port sees for a strain h: the arms' lengths differ by hL, so the round-trip phases by 4π hL/λ. */
export const darkPortPhase = (h, p = DEFAULTS) => (4 * Math.PI * h * p.L) / p.lambda;

/** The shot-noise-limited phase sensitivity of a power P at the beam splitter, √(ħω/2P) rad/√Hz. */
export const shotNoisePhase = (P, lambda = DEFAULTS.lambda) => Math.sqrt((HBAR * ((2 * Math.PI * C) / lambda)) / (2 * P));

// ------------------------------------------------------------------------- the chirp

/** The chirp mass of two masses (solar masses in, solar masses out). */
export const chirpMass = (m1, m2) => (m1 * m2) ** 0.6 / (m1 + m2) ** 0.2;

/** The frequency of the innermost stable circular orbit, the end of the inspiral: c³/(6^{3/2} π G M). */
export const iscoFrequency = (m1, m2) => C ** 3 / (6 ** 1.5 * Math.PI * G * (m1 + m2) * MSUN);

/** The time before merger at which the Newtonian chirp passes f: τ = (5/256) (π f)^{−8/3} (G Mc/c³)^{−5/3}. */
export function timeToMerger(f, mcSun) {
  const tm = (G * mcSun * MSUN) / C ** 3;
  return (5 / 256) * (Math.PI * f) ** (-8 / 3) * tm ** (-5 / 3);
}

/** The Newtonian chirp's frequency at time τ before merger. */
export function chirpFrequency(tau, mcSun) {
  const tm = (G * mcSun * MSUN) / C ** 3;
  return (1 / Math.PI) * (5 / (256 * tau)) ** (3 / 8) * tm ** (-5 / 8);
}

/** Its amplitude at frequency f, at a distance d (metres), for a binary seen face on overhead: (4/d)(G Mc/c³)^{5/3} (π f)^{2/3} c. */
export function chirpAmplitude(f, mcSun, d) {
  const tm = (G * mcSun * MSUN) / C ** 3;
  return (4 * C / d) * tm ** (5 / 3) * (Math.PI * f) ** (2 / 3);
}

/** The stationary-phase amplitude spectrum |h̃(f)| = (c/d) √(5/24) π^{−2/3} (G Mc/c³)^{5/6} f^{−7/6}, in 1/Hz. */
export function chirpSpectrum(f, mcSun, d) {
  const tm = (G * mcSun * MSUN) / C ** 3;
  return (C / d) * Math.sqrt(5 / 24) * Math.PI ** (-2 / 3) * tm ** (5 / 6) * f ** (-7 / 6);
}

/**
 * The chirp h(t) sampled at rate fs from frequency fmin up to fmax (the ISCO, say), merging at
 * the end: {t, h, f, dt, tc} with t = 0 at the start, tc the merger time, f(t) the frequency.
 * The phase is Φ(τ) = −2 (5 G Mc/c³)^{−5/8} τ^{5/8}, whose rate is 2π f(τ).
 */
export function chirpSignal(mcSun, d, fmin, fmax, fs = 4096) {
  const tm = (G * mcSun * MSUN) / C ** 3;
  const tc = timeToMerger(fmin, mcSun), tEnd = timeToMerger(fmax, mcSun);
  const n = Math.max(2, Math.floor((tc - tEnd) * fs));
  const dt = 1 / fs, t = new Float64Array(n), h = new Float64Array(n), f = new Float64Array(n);
  const k = -2 * (5 * tm) ** (-5 / 8);
  for (let i = 0; i < n; i++) {
    const ti = i * dt, tau = Math.max(tc - ti, 1e-9);
    t[i] = ti;
    f[i] = chirpFrequency(tau, mcSun);
    h[i] = chirpAmplitude(f[i], mcSun, d) * Math.cos(k * tau ** (5 / 8));
  }
  return { t, h, f, dt, tc, n, fs };
}

/**
 * The signal-to-noise ratio of a signal h (sampled at dt) in noise of one-sided power spectral
 * density Sn(f): ρ² = 4 ∫ |h̃(f)|² / Sn(f) df, with h̃ from an FFT (the signal zero-padded to a
 * power of two).  spectrum: {f, mag} of |h̃(f)| for the plot, kept in the result.
 */
export function matchedFilterSnr(h, dt, Sn, fftFn, { fmin = 0, fmax = Infinity, spectrum = null } = {}) {
  if (!spectrum) spectrum = amplitudeSpectrum(h, dt, fftFn);
  let s = 0;
  const df = spectrum.df;
  for (let i = 1; i < spectrum.f.length; i++) {
    const f = spectrum.f[i];
    if (f < fmin || f > fmax) continue;
    s += (spectrum.mag[i] * spectrum.mag[i]) / Sn(f);
  }
  return { snr: Math.sqrt(4 * s * df), spectrum };
}

/** |h̃(f)| = |Σ h(t) e^{−2πift} dt| on the FFT's positive frequencies: {f, mag, df}. */
export function amplitudeSpectrum(h, dt, fftFn) {
  let N = 1;
  while (N < h.length) N *= 2;
  const re = new Float64Array(N), im = new Float64Array(N);
  re.set(h);
  fftFn(re, im);
  const half = N / 2, f = new Float64Array(half), mag = new Float64Array(half), df = 1 / (N * dt);
  for (let i = 0; i < half; i++) { f[i] = i * df; mag[i] = Math.hypot(re[i], im[i]) * dt; }
  return { f, mag, df };
}

/** The stationary-phase SNR, by quadrature of the closed form: ρ² = 4 ∫ |h̃_SPA|²/Sn df from fmin to fmax. */
export function spaSnr(mcSun, d, Sn, fmin, fmax, steps = 4000) {
  let s = 0;
  const la = Math.log(fmin), lb = Math.log(fmax), dl = (lb - la) / steps;
  for (let i = 0; i < steps; i++) {
    const f = Math.exp(la + (i + 0.5) * dl), a = chirpSpectrum(f, mcSun, d);
    s += ((a * a) / Sn(f)) * f * dl;
  }
  return Math.sqrt(4 * s);
}
