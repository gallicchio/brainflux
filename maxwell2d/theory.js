// The analytic answers the demo compares itself with.  Units: c = 1, vacuum wavelength 1.
//
// Polarisation names: in this demo light travels in the xy plane.  TM (Ez, Hx, Hy) has E
// perpendicular to the plane of incidence: "s" polarisation in optics.  TE (Hz, Ex, Ey) has E in
// the plane of incidence: "p" polarisation, the one with a Brewster angle.

const cx = (re, im = 0) => ({ re, im });
const add = (a, b) => cx(a.re + b.re, a.im + b.im);
const sub = (a, b) => cx(a.re - b.re, a.im - b.im);
const mul = (a, b) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const div = (a, b) => { const d = b.re * b.re + b.im * b.im; return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d); };
const abs2 = (a) => a.re * a.re + a.im * a.im;
const csqrt = (a) => {
  const r = Math.hypot(a.re, a.im), re = Math.sqrt((r + a.re) / 2), im = Math.sqrt(Math.max(0, (r - a.re) / 2));
  return cx(re, a.im < 0 ? -im : im);
};
const cexp = (a) => { const m = Math.exp(a.re); return cx(m * Math.cos(a.im), m * Math.sin(a.im)); };

/** cos of the angle in medium 2, complex beyond the critical angle (with Im >= 0: decaying). */
function cos2(n1, n2, theta1) {
  const s = (n1 / n2) * Math.sin(theta1);
  return csqrt(cx(1 - s * s));
}

/** Fresnel amplitude reflection coefficient from medium n1 into n2 at incidence theta1. */
export function fresnelR(n1, n2, theta1, pol = 'TM') {
  const c1 = cx(Math.cos(theta1)), c2 = cos2(n1, n2, theta1);
  if (pol === 'TM') {   // s
    const a = mul(cx(n1), c1), b = mul(cx(n2), c2);
    return div(sub(a, b), add(a, b));
  }
  const a = mul(cx(n2), c1), b = mul(cx(n1), c2);      // p
  return div(sub(a, b), add(a, b));
}

/** The fraction of the power reflected at one interface. */
export function reflectance(n1, n2, theta1, pol = 'TM') { return abs2(fresnelR(n1, n2, theta1, pol)); }

/** Refraction angle by Snell's law (NaN beyond the critical angle). */
export function snell(n1, n2, theta1) { const s = (n1 / n2) * Math.sin(theta1); return Math.abs(s) <= 1 ? Math.asin(s) : NaN; }

export const criticalAngle = (n1, n2) => (n2 < n1 ? Math.asin(n2 / n1) : NaN);
export const brewsterAngle = (n1, n2) => Math.atan(n2 / n1);

/** The 1/e decay length of the evanescent field (amplitude) beyond total internal reflection. */
export function evanescentDepth(n1, n2, theta1) {
  const q = (n1 * Math.sin(theta1)) ** 2 - n2 * n2;
  return q > 0 ? 1 / (2 * Math.PI * Math.sqrt(q)) : Infinity;
}

/**
 * Transmission of a plane wave through a layer of index n2 and thickness d between two half
 * spaces of index n1, at incidence theta1 (in n1): frustrated total internal reflection when
 * theta1 is beyond the critical angle.  Exact for a plane wave: r = r12 (1 - e^{2i beta}) /
 * (1 - r12^2 e^{2i beta}), beta = 2 pi n2 cos(theta2) d, T = 1 - |r|^2.
 */
export function layerTransmission(n1, n2, d, theta1, pol = 'TM') {
  const r12 = fresnelR(n1, n2, theta1, pol), c2 = cos2(n1, n2, theta1);
  const e = cexp(mul(cx(0, 2 * 2 * Math.PI * n2 * d), c2));     // e^{2 i beta}
  const r = div(mul(r12, sub(cx(1), e)), sub(cx(1), mul(mul(r12, r12), e)));
  return 1 - abs2(r);
}

/**
 * A Gaussian beam of waist half-width w (1/e amplitude) in a medium of index n is a spread of
 * plane waves whose power falls as exp(-(k w dtheta)^2 / 2) with angle, k = 2 pi n: the beam's
 * value of a plane-wave quantity f(theta) (a reflectance, a transmission) is its average.
 */
export function beamAverage(f, theta0, n, w) {
  const sigma = 1 / (2 * Math.PI * n * w), M = 200;
  let s = 0, sw = 0;
  for (let q = -M; q <= M; q++) {
    const d = (5 * sigma * q) / M, wt = Math.exp(-(d * d) / (2 * sigma * sigma));
    s += wt * f(theta0 + d); sw += wt;
  }
  return s / sw;
}

/** Guided modes of a symmetric slab of width w and index n1 in n2 (per polarisation). */
export function slabModeCount(n1, n2, w) { return n1 > n2 ? Math.floor(2 * w * Math.sqrt(n1 * n1 - n2 * n2)) + 1 : 0; }

/**
 * Between parallel metal plates a distance w apart, TM light (E along the plates) has modes
 * sin(m pi y / w) with cutoff width m/2; below cutoff the field decays as exp(-kappa x),
 * kappa = sqrt((pi/w)^2 - (2 pi)^2).  Returns kappa (0 above cutoff).
 */
export function metalGuideDecay(w, n = 1) {
  const q = (Math.PI / w) ** 2 - (2 * Math.PI * n) ** 2;
  return q > 0 ? Math.sqrt(q) : 0;
}

/** TM_mn frequency of a rectangular metal cavity a x b (in units of the source frequency). */
export function cavityFrequency(a, b, m, n) { return 0.5 * Math.hypot(m / a, n / b); }

/** The same mode on the Yee grid (cell dx, step dt), which the solver should reproduce exactly:
 *  sin(w dt/2)/dt = sqrt(sin^2(kx dx/2) + sin^2(ky dx/2))/dx. */
export function cavityFrequencyYee(a, b, m, n, dx, dt) {
  const s = Math.hypot(Math.sin((m * Math.PI * dx) / (2 * a)), Math.sin((n * Math.PI * dx) / (2 * b)));
  return Math.asin((dt / dx) * s) / (Math.PI * dt);
}

/** Cherenkov angle of the radiation to the velocity: cos(theta) = 1/(n beta); NaN below threshold. */
export function cherenkovAngle(n, beta) { const c = 1 / (n * beta); return c <= 1 ? Math.acos(c) : NaN; }

/** Thick-lens focal length (from the lens's centre) of a symmetric biconvex lens. */
export function lensFocal(n, R, thickness) {
  const P = (n - 1) * (2 / R - ((n - 1) * thickness) / (n * R * R));
  return 1 / P;
}

/**
 * Frequency and quality factor of a ringing signal from its peaks: the extrema of v(t) (refined
 * by a parabola through three samples) after time `from`; the frequency from their spacing, the
 * decay from a straight-line fit to ln|peak|.  Q = pi f tau, where the amplitude decays as
 * exp(-t/tau): the energy falls by 1/e in Q/(2 pi) periods.
 */
export function ringdown(t, v, { from = -Infinity, floor = 0 } = {}) {
  const peaks = [];
  for (let q = 1; q < v.length - 1; q++) {
    if (t[q] < from) continue;
    const a = v[q - 1], b = v[q], c = v[q + 1];
    if ((b > a && b >= c && b > 0) || (b < a && b <= c && b < 0)) {
      const den = a - 2 * b + c, d = den !== 0 ? (0.5 * (a - c)) / den : 0;
      const peak = Math.abs(b - 0.25 * (a - c) * d);
      if (peak > floor) peaks.push([t[q] + d * (t[q + 1] - t[q]), peak]);
    }
  }
  if (peaks.length < 8) return null;
  const n = peaks.length;
  const f = (n - 1) / (2 * (peaks[n - 1][0] - peaks[0][0]));
  let st = 0, sl = 0, stt = 0, stl = 0;
  for (const [tp, p] of peaks) { const l = Math.log(p); st += tp; sl += l; stt += tp * tp; stl += tp * l; }
  const slope = (n * stl - st * sl) / (n * stt - st * st), intercept = (sl - slope * st) / n;
  // How straight is the decay?  The rms deviation of ln|peak| from the line.
  let dev = 0;
  for (const [tp, p] of peaks) dev += (Math.log(p) - intercept - slope * tp) ** 2;
  dev = Math.sqrt(dev / n);
  return { f, Q: slope < 0 ? (-Math.PI * f) / slope : Infinity, slope, intercept, peaks: n, dev };
}
