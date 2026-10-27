// Initial wave functions with simple phase-space pictures, and the potentials (hbar = m = 1).
//
// Gaussian states.  A pure Gaussian psi(x) = exp(-alpha (x - x0)^2 + i p0 (x - x0/2)), with
// complex alpha = a + i b, has the Gaussian Wigner function
//     W = (1/pi hbar) exp(-2a u^2 - (q + 2b u)^2 / 2a),   u = x - x0, q = p - p0,
// an ellipse of area pi hbar / 2 (one standard deviation): sigma_x^2 = 1/4a and the
// covariance <u q> = -2b sigma_x^2.  A coherent state of an oscillator of frequency omega is
// the round one in the oscillator's own units (x sqrt(m omega), p / sqrt(m omega)): a = omega/2,
// b = 0.  Squeezing by r along a direction theta shrinks the ellipse by e^-r along theta and
// stretches it by e^r across.  The phase factor exp(-i p0 x0 / 2) is the usual one for
// |alpha> = D(alpha)|0>, so that |alpha> + |-alpha> is the even cat.

/** The covariance (sxx, sxp, spp) of a Gaussian squeezed by r along angle theta (oscillator units). */
export function gaussianCovariance(r, theta, omega = 1) {
  const a = Math.exp(-2 * r) / 2, b = Math.exp(2 * r) / 2, c = Math.cos(theta), s = Math.sin(theta);
  const XX = a * c * c + b * s * s, XP = (a - b) * s * c, PP = a * s * s + b * c * c;
  return { sxx: XX / omega, sxp: XP, spp: PP * omega };
}

/** Add the Gaussian state (x0, p0, r, theta) times the complex weight (wr, wi) to (re, im). */
export function addGaussian(x, re, im, { x0 = 0, p0 = 0, r = 0, theta = 0, omega = 1 }, wr = 1, wi = 0) {
  const { sxx, sxp } = gaussianCovariance(r, theta, omega);
  const a = 1 / (4 * sxx), b = -sxp / (2 * sxx), norm = (2 * a / Math.PI) ** 0.25;
  for (let j = 0; j < x.length; j++) {
    const u = x[j] - x0;
    const mag = norm * Math.exp(-a * u * u);
    if (mag < 1e-300) continue;
    const ph = -b * u * u + p0 * (x[j] - x0 / 2);
    const cr = mag * Math.cos(ph), ci = mag * Math.sin(ph);
    re[j] += wr * cr - wi * ci; im[j] += wr * ci + wi * cr;
  }
}

/** The Wigner function of the Gaussian state at (x, p), exactly. */
export function gaussianWigner(x, p, { x0 = 0, p0 = 0, r = 0, theta = 0, omega = 1 }) {
  const { sxx, sxp, spp } = gaussianCovariance(r, theta, omega);
  const u = x - x0, q = p - p0, det = sxx * spp - sxp * sxp;
  return Math.exp(-(spp * u * u - 2 * sxp * u * q + sxx * q * q) / (2 * det)) / (2 * Math.PI * Math.sqrt(det));
}

/**
 * A cat state: the coherent states at (x0, p0) and (-x0, -p0), added with relative phase phi.
 * Not normalised (the two overlap a little when close).
 */
export function catState(x, { x0, p0, phi = 0, omega = 1 }) {
  const re = new Float64Array(x.length), im = new Float64Array(x.length);
  addGaussian(x, re, im, { x0, p0, omega });
  addGaussian(x, re, im, { x0: -x0, p0: -p0, omega }, Math.cos(phi), Math.sin(phi));
  return { re, im };
}

/** The oscillator's stationary state |n> (normalised Hermite function), by the stable recurrence. */
export function hermiteFunction(x, n, omega = 1) {
  const out = new Float64Array(x.length), s = Math.sqrt(omega);
  for (let j = 0; j < x.length; j++) {
    const xi = x[j] * s;
    let h0 = Math.PI ** -0.25 * Math.exp(-xi * xi / 2), h1 = Math.SQRT2 * xi * h0;
    if (n === 0) { out[j] = h0 * Math.sqrt(s); continue; }
    for (let k = 2; k <= n; k++) {
      const h2 = Math.sqrt(2 / k) * xi * h1 - Math.sqrt((k - 1) / k) * h0;
      h0 = h1; h1 = h2;
    }
    out[j] = h1 * Math.sqrt(s);
  }
  return out;
}

/** Normalise (re, im) on a grid of spacing dx; false if it is zero. */
export function normalize(re, im, dx) {
  let s = 0;
  for (let j = 0; j < re.length; j++) s += re[j] * re[j] + im[j] * im[j];
  s = Math.sqrt(s * dx);
  if (!(s > 0) || !Number.isFinite(s)) return false;
  for (let j = 0; j < re.length; j++) { re[j] /= s; im[j] /= s; }
  return true;
}

// ---------------------------------------------------------------------------- potentials
//
// Each: the formula and its parameters, the computing domain (bigger than the window, so the
// walls are never felt, but not so big that V is enormous at them, which would only shorten
// the time step), the window of phase space shown (meant to fill a square), the frequency of
// small oscillations at the bottom (the coherent states are the round ones there), and the
// simulated time per second.

export const POTENTIALS = [
  {
    id: 'harmonic', label: 'Harmonic',
    V: 'omega^2 x^2/2', params: { omega: 1 }, omegaOf: (p) => p.omega,
    domain: [-12, 12], n: 1024, boundary: 'walls', window: { x: [-5.5, 5.5], p: [-5.5, 5.5] }, speed: 1.5,
  },
  {
    id: 'free', label: 'Free', noLevels: true,
    V: '0', params: {}, omegaOf: () => 1,
    domain: [-48, 48], n: 2048, boundary: 'absorbing', window: { x: [-10, 10], p: [-3.5, 3.5] }, speed: 1,
  },
  {
    id: 'quartic', label: 'Quartic',
    V: 'x^2/2 + lambda x^4', params: { lambda: 0.05 }, omegaOf: () => 1,
    domain: [-7.5, 7.5], n: 1024, boundary: 'walls', window: { x: [-5, 5], p: [-6, 6] }, speed: 2,
  },
  {
    id: 'morse', label: 'Morse',
    V: 'D (1 - exp(-a x))^2', params: { D: 8, a: 0.5 }, omegaOf: (p) => p.a * Math.sqrt(2 * p.D),
    domain: [-4.5, 27.5], n: 1024, boundary: 'walls', window: { x: [-2.5, 7.5], p: [-4.5, 4.5] }, speed: 2,
  },
  {
    id: 'double', label: 'Double well',
    V: 'V0 ((x/a)^2 - 1)^2', params: { V0: 3, a: 1.5 }, omegaOf: (p) => Math.sqrt(8 * p.V0) / p.a,
    domain: [-5.5, 5.5], n: 1024, boundary: 'walls', window: { x: [-3.5, 3.5], p: [-4, 4] }, speed: 4,
  },
  {
    id: 'typed', label: 'Typed',
    V: 'x^4/4 - 2 x^2 + x', params: {}, omegaOf: null,
    domain: [-8, 8], n: 1024, boundary: 'walls', window: { x: [-4, 4], p: [-5, 5] }, speed: 2,
  },
];
