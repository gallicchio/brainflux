// One mode of the light field as a Gaussian state in the quadrature plane, and its photon
// statistics.  No DOM here, so that the tests can exercise it.
//
// Conventions, kept everywhere in this demo.  The quadratures of the mode's ladder operator a
// are X1 = (a + a†)/2 and X2 = (a − a†)/2i, the cosine and sine parts of the field,
// E(t) ∝ X1 cos ωt + X2 sin ωt, with [X1, X2] = i/2 and so ΔX1 ΔX2 ≥ 1/4.  The vacuum has
// ΔX1 = ΔX2 = 1/2.  The quadrature at angle θ is X_θ = X1 cos θ + X2 sin θ.
//
// The phase-space demo's (x, p) with ħ = m = ω = 1 is the same plane scaled by √2:
// x = √2 X1, p = √2 X2, and its Wigner function W(x, p) = W(X1, X2)/2.
//
// A state here is Gaussian, so it is its mean (x1, x2) = (Re α, Im α) and its covariance matrix
// Σ = [[s11, s12], [s12, s22]].  Pure states: Σ = R(ψ) diag(e^{−2r}/4, e^{2r}/4) R(ψ)ᵀ, the
// cloud squeezed to ΔX = e^{−r}/2 along the angle ψ and stretched to e^{r}/2 across it
// (r = 0: a coherent state, the vacuum's round cloud displaced to α).  In operator terms the
// state is D(α) S(ξ) |0⟩ with ξ = r e^{2iψ} and S(ξ) = exp[(ξ* a² − ξ a†²)/2].  Loss, a beam
// splitter of transmission η with the vacuum at its other port: Σ → η Σ + (1 − η)/4 · I and
// the mean → √η · mean.

/** The covariance matrix of the pure state squeezed by r along the angle ψ (radians). */
export function covariance(r, psi) {
  const a = Math.exp(-2 * r) / 4, b = Math.exp(2 * r) / 4, c = Math.cos(psi), s = Math.sin(psi);
  return { s11: a * c * c + b * s * s, s12: (a - b) * s * c, s22: a * s * s + b * c * c };
}

/**
 * The Gaussian state with mean α = (x1, x2), squeezing r along ψ, after loss η (1 = none).
 * Returns {x1, x2, s11, s12, s22} plus the parameters it was made from.
 */
export function gaussianState({ x1 = 0, x2 = 0, r = 0, psi = 0, eta = 1 } = {}) {
  const { s11, s12, s22 } = covariance(r, psi);
  const q = Math.sqrt(eta), v = (1 - eta) / 4;
  return { x1: q * x1, x2: q * x2, s11: eta * s11 + v, s12: eta * s12, s22: eta * s22 + v, r, psi, eta };
}

/** The state turned by the angle φ (counterclockwise in the (X1, X2) plane): a → a e^{iφ}. */
export function rotated(st, phi) {
  const c = Math.cos(phi), s = Math.sin(phi);
  const { s11, s12, s22 } = st;
  return {
    ...st,
    x1: c * st.x1 - s * st.x2, x2: s * st.x1 + c * st.x2,
    s11: c * c * s11 - 2 * c * s * s12 + s * s * s22,
    s12: c * s * (s11 - s22) + (c * c - s * s) * s12,
    s22: s * s * s11 + 2 * c * s * s12 + c * c * s22,
    psi: st.psi + phi,
  };
}

/** The mean of the quadrature at angle θ, ⟨X_θ⟩ = x1 cos θ + x2 sin θ. */
export function quadratureMean(st, theta) {
  return st.x1 * Math.cos(theta) + st.x2 * Math.sin(theta);
}

/** The variance of the quadrature at angle θ: (cos θ, sin θ) Σ (cos θ, sin θ)ᵀ. */
export function quadratureVariance(st, theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return st.s11 * c * c + 2 * st.s12 * s * c + st.s22 * s * s;
}

/** The principal spreads of the cloud: {min, max, angle} (ΔX along the narrow axis, across it, and the narrow axis's angle). */
export function principalSpreads(st) {
  const { s11, s12, s22 } = st, m = (s11 + s22) / 2, d = Math.hypot((s11 - s22) / 2, s12);
  const lo = Math.max(0, m - d), hi = m + d;
  const angle = 0.5 * Math.atan2(-2 * s12, s22 - s11);   // the direction of the smallest variance
  return { min: Math.sqrt(lo), max: Math.sqrt(hi), angle };
}

/** The Wigner function at (X1, X2): a Gaussian with the state's mean and covariance, ∫W = 1. */
export function wigner(st, X1, X2) {
  const u = X1 - st.x1, v = X2 - st.x2, det = st.s11 * st.s22 - st.s12 * st.s12;
  return Math.exp(-(st.s22 * u * u - 2 * st.s12 * u * v + st.s11 * v * v) / (2 * det)) / (2 * Math.PI * Math.sqrt(det));
}

/** The largest value the Wigner function of a pure state takes, 2/π (at its mean). */
export const W_MAX = 2 / Math.PI;

/**
 * W sampled on an n × n grid over [−extent, extent]², row j = X2 from −extent (row 0) up, column i
 * = X1 from −extent.  Written into out (a Float32Array of n·n) and returned.
 */
export function wignerGrid(st, n, extent, out = new Float32Array(n * n)) {
  const det = st.s11 * st.s22 - st.s12 * st.s12, norm = 1 / (2 * Math.PI * Math.sqrt(det));
  const A = st.s22 / (2 * det), B = st.s12 / det, C = st.s11 / (2 * det);
  const step = (2 * extent) / (n - 1);
  for (let j = 0; j < n; j++) {
    const v = -extent + j * step - st.x2;
    for (let i = 0; i < n; i++) {
      const u = -extent + i * step - st.x1;
      const e = A * u * u - B * u * v + C * v * v;
      out[j * n + i] = e > 40 ? 0 : norm * Math.exp(-e);
    }
  }
  return out;
}

/** A point drawn from the cloud, [X1, X2], with g() a standard normal deviate. */
export function samplePoint(st, g) {
  const l11 = Math.sqrt(st.s11), l21 = st.s12 / l11, l22 = Math.sqrt(Math.max(0, st.s22 - l21 * l21));
  const a = g(), b = g();
  return [st.x1 + l11 * a, st.x2 + l21 * a + l22 * b];
}

/** The mean photon number ⟨a†a⟩ = ⟨X1⟩² + ⟨X2⟩² + s11 + s22 − 1/2 (η(|α|² + sinh²r) for our states). */
export function meanPhotons(st) {
  return st.x1 * st.x1 + st.x2 * st.x2 + st.s11 + st.s22 - 0.5;
}

/** The squeezing in decibels below the vacuum's noise: 10 log10(e^{2r}) (10 dB is r = 1.151). */
export const squeezeDb = (r) => (20 * r) / Math.LN10;
export const rFromDb = (dB) => (dB * Math.LN10) / 20;

/** The measured variance of the squeezed quadrature after loss η, in units of the vacuum's: η e^{−2r} + 1 − η. */
export const lossyVariance = (r, eta) => eta * Math.exp(-2 * r) + 1 - eta;

/**
 * The photon-number distribution P(n), n = 0 … nmax, of the state D(α) S(ξ) |0⟩ with
 * α = x1 + i x2 and ξ = r e^{2iψ}, after loss η.
 *
 * The pure state is annihilated by (a − α) cosh r + (a† − α*) e^{iφ} sinh r (φ = 2ψ), which gives
 * its number-state amplitudes c_n by the three-term recurrence
 *     √(n+1) cosh r · c_{n+1} = (α cosh r + α* e^{iφ} sinh r) c_n − √n e^{iφ} sinh r · c_{n−1},
 * normalised at the end.  For α = 0 only the even n survive: the squeezed vacuum is made of
 * photon pairs.  Loss is a beam splitter, which turns n photons into m with binomial
 * probability C(n, m) η^m (1 − η)^{n−m}.
 */
export function photonDistribution({ x1 = 0, x2 = 0, r = 0, psi = 0, eta = 1 } = {}, nmax = 80) {
  const N = nmax + 1, cr = new Float64Array(N), ci = new Float64Array(N);
  const ch = Math.cosh(r), sh = Math.sinh(r), ephr = Math.cos(2 * psi), ephi = Math.sin(2 * psi);
  // A = α cosh r + α* e^{iφ} sinh r;  B = e^{iφ} sinh r
  const Ar = x1 * ch + sh * (x1 * ephr + x2 * ephi), Ai = x2 * ch + sh * (x1 * ephi - x2 * ephr);
  const Br = ephr * sh, Bi = ephi * sh;
  cr[0] = 1; ci[0] = 0;
  for (let n = 0; n < nmax; n++) {
    const pr = n ? cr[n - 1] : 0, pi = n ? ci[n - 1] : 0, sq = Math.sqrt(n);
    const tr = Ar * cr[n] - Ai * ci[n] - sq * (Br * pr - Bi * pi);
    const ti = Ar * ci[n] + Ai * cr[n] - sq * (Br * pi + Bi * pr);
    const d = Math.sqrt(n + 1) * ch;
    cr[n + 1] = tr / d; ci[n + 1] = ti / d;
  }
  let P = new Float64Array(N), sum = 0;
  for (let n = 0; n < N; n++) { P[n] = cr[n] * cr[n] + ci[n] * ci[n]; sum += P[n]; }
  for (let n = 0; n < N; n++) P[n] /= sum;
  if (eta < 1) P = binomialLoss(P, eta);
  return P;
}

/** P(n) after a beam splitter of transmission η: P'(m) = Σ_n P(n) C(n, m) η^m (1 − η)^{n − m}. */
export function binomialLoss(P, eta) {
  const N = P.length, out = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    if (P[n] < 1e-300) continue;
    // C(n, m) η^m (1−η)^{n−m} for m = 0 … n, by the ratio from m to m + 1.
    let b = Math.pow(1 - eta, n);
    for (let m = 0; m <= n; m++) {
      out[m] += P[n] * b;
      b *= ((n - m) / (m + 1)) * (eta / (1 - eta));
    }
  }
  return out;
}

/** Poisson P(n) with mean nbar, for the coherent state's photons. */
export function poisson(nbar, nmax = 80) {
  const P = new Float64Array(nmax + 1);
  let p = Math.exp(-nbar);
  for (let n = 0; n <= nmax; n++) { P[n] = p; p *= nbar / (n + 1); }
  return P;
}

/** The squeezed vacuum's P(n) in closed form: P(2m) = (2m)!/(4^m m!²) tanh^{2m} r / cosh r, P(odd) = 0. */
export function squeezedVacuumPhotons(r, nmax = 80) {
  const P = new Float64Array(nmax + 1), t2 = Math.tanh(r) ** 2;
  let p = 1 / Math.cosh(r);
  for (let m = 0; 2 * m <= nmax; m++) { P[2 * m] = p; p *= ((2 * m + 1) / (2 * m + 2)) * t2; }
  return P;
}

/** Mean and standard deviation of a distribution P(n). */
export function photonMoments(P) {
  let m = 0, m2 = 0;
  for (let n = 0; n < P.length; n++) { m += n * P[n]; m2 += n * n * P[n]; }
  return { mean: m, sd: Math.sqrt(Math.max(0, m2 - m * m)) };
}

/**
 * The smallest phase shift a homodyne measurement of the phase quadrature can tell from zero at
 * signal-to-noise 1, for the state |α⟩ squeezed by r in phase: Δφ = e^{−r}/(2|α|).  r = 0 is the
 * standard quantum limit 1/(2|α|) = 1/(2√N).
 */
export const phaseResolution = (alpha, r = 0) => Math.exp(-r) / (2 * Math.abs(alpha));
