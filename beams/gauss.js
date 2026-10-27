// Gaussian beams: the complex beam parameter q and ray-transfer (ABCD) matrices.
//
// Units: every length is in millimetres, the wavelength too (633 nm = 6.33e-4 mm).
//
// A Gaussian beam with its waist w0 at z = 0 has, at distance z past the waist,
//
//     q = z + i zR,   zR = pi w0^2 / lambda,   so   1/q = 1/R - i lambda / (pi w^2),
//
// with w(z) = w0 sqrt(1 + z^2/zR^2) (the radius where the intensity is 1/e^2 of the peak),
// R(z) = z (1 + zR^2/z^2) the radius of curvature of the wavefronts, and the Gouy phase
// psi(z) = atan(z / zR).  A paraxial optical system with ray matrix [[A, B], [C, D]] (acting on
// rays (x, theta)) changes q by the same rule as a Moebius map:
//
//     q' = (A q + B) / (C q + D).
//
// In a medium of index n the reduced parameter q^ = q / n obeys this law with "reduced" matrices
// (free space of length d is d / n; a plane interface is the identity), and then
// 1/q^ = n/R - i lambda0 / (pi w^2) with lambda0 the vacuum wavelength.  Everything here uses q^.
//
// The field (physicists' convention, exp(i(kz - wt))) of the beam and of the Hermite-Gauss
// mode HG_m0 in the plane y = 0 is
//
//     E = (w0/w) H_m(sqrt2 x/w) exp(-x^2/w^2) exp(i [k z + k x^2/(2R) - (m+1) psi(z)])
//
// (for a round beam, the amplitude goes as 1/w).  Through a thin lens the field is continuous:
// q jumps, but psi does not, so a beam's Gouy phase is accumulated segment by segment.

/** A complex number { re, im }. */
export const cx = (re, im = 0) => ({ re, im });
export const cdiv = (a, b) => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
export const cinv = (a) => cdiv({ re: 1, im: 0 }, a);

// ----------------------------------------------------------------------- ray matrices
// A matrix is [A, B, C, D].

/** Free space of length d in a medium of index n (reduced). */
export const free = (d, n = 1) => [1, d / n, 0, 1];
/** A thin lens of focal length f (f > 0 converging). */
export const lens = (f) => [1, 0, -1 / f, 1];
/** A curved mirror of radius R, unfolded (R > 0 concave, focusing; R = Infinity flat). */
export const mirror = (R) => [1, 0, -2 / R, 1];

/** The product M1 M2 ... (the last one acts first). */
export function mul(...Ms) {
  let [A, B, C, D] = [1, 0, 0, 1];
  for (const [a, b, c, d] of Ms) [A, B, C, D] = [A * a + B * c, A * b + B * d, C * a + D * c, C * b + D * d];
  return [A, B, C, D];
}

/** q' = (A q + B) / (C q + D). */
export function applyABCD([A, B, C, D], q) {
  return cdiv({ re: A * q.re + B, im: A * q.im }, { re: C * q.re + D, im: C * q.im });
}

/** A ray (x, theta) through a matrix. */
export const applyRay = ([A, B, C, D], [x, t]) => [A * x + B * t, C * x + D * t];

// ----------------------------------------------------------------------- one beam

/** The reduced q^ of a beam of waist w0 at (actual) distance dz past its waist, in index n. */
export function qOfWaist(w0, dz, lambda, n = 1) {
  return { re: dz / n, im: (Math.PI * w0 * w0) / lambda };
}

/**
 * Everything about a beam from its reduced q^ (in a medium of index n):
 *   w (spot size), R (wavefront radius, Infinity at a waist), w0 (its waist), zR (Rayleigh
 *   range), dz (actual distance past the waist: the waist is at -dz), gouy = atan(dz / zR),
 *   theta = lambda0 / (pi n w0), the far-field half-angle divergence.
 */
export function beamOf(q, lambda, n = 1) {
  const z = q.re, zr = q.im, m2 = z * z + zr * zr;
  const w0 = Math.sqrt((lambda * zr) / Math.PI);
  return {
    w: Math.sqrt(((lambda / Math.PI) * m2) / zr),
    R: z === 0 ? Infinity : (n * m2) / z,
    w0,
    zR: n * zr,
    dz: n * z,
    gouy: Math.atan2(z, zr),
    theta: lambda / (Math.PI * n * w0),
  };
}

/** w(z) and R(z) of a beam of waist w0 at distance z past the waist, by the closed forms. */
export function analytic(w0, z, lambda, n = 1) {
  const zR = (Math.PI * w0 * w0 * n) / lambda;
  return { zR, w: w0 * Math.sqrt(1 + (z / zR) ** 2), R: z === 0 ? Infinity : z * (1 + (zR / z) ** 2), gouy: Math.atan(z / zR) };
}

// ----------------------------------------------------------------------- a bench of elements

/**
 * Follow a beam along a bench.
 *   beam      { lambda, w0, z0 }: the waist w0 at z0, in air (if no element were in the way)
 *   elements  [{ type: 'lens', z, f } | { type: 'mirror', z, R } | { type: 'slab', z, t, n }]
 *             Mirrors are unfolded: the reflected beam is drawn going on to the right.
 *   za, zb    the stretch of the axis wanted (extended to take in every element)
 * Returns { lambda, segments }, each segment { za, zb, n, q, gouy, opl, after } with q (reduced),
 * the accumulated Gouy phase and optical path length at its start za, and `after` the element
 * (or null) it follows.
 */
export function traceBench(beam, elements, za, zb) {
  const { lambda, w0, z0 } = beam;
  const events = [];
  for (const e of elements) {
    if (e.type === 'lens') events.push({ z: e.z, M: lens(e.f), el: e });
    else if (e.type === 'mirror') events.push({ z: e.z, M: mirror(e.R), el: e });
    else if (e.type === 'slab') {
      events.push({ z: e.z, M: null, el: e });
      events.push({ z: e.z + e.t, M: null, el: e });
    }
  }
  events.sort((a, b) => a.z - b.z);
  const lo = Math.min(za, events.length ? events[0].z : za);
  const hi = Math.max(zb, events.length ? events[events.length - 1].z : zb);
  const indexAt = (z) => {
    let n = 1, start = -Infinity;
    for (const e of elements) if (e.type === 'slab' && z > e.z && z < e.z + e.t && e.z >= start) { n = e.n; start = e.z; }
    return n;
  };
  const bounds = [lo, ...events.map((e) => e.z), hi];
  let q = qOfWaist(w0, lo - z0, lambda, 1);
  let gouy = Math.atan2(q.re, q.im), opl = lo;
  const segments = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i], b = bounds[i + 1], n = indexAt((a + b) / 2);
    segments.push({ za: a, zb: b, n, q, gouy, opl, after: i > 0 ? events[i - 1].el : null });
    const q2 = { re: q.re + (b - a) / n, im: q.im };
    gouy += Math.atan2(q2.re, q2.im) - Math.atan2(q.re, q.im);
    opl += n * (b - a);
    q = i < events.length && events[i].M ? applyABCD(events[i].M, q2) : q2;
  }
  return { lambda, segments, lo, hi };
}

/** The segment of a trace that holds z (the one after an element sitting exactly at z). */
export function segmentAt(trace, z) {
  const s = trace.segments;
  let lo = 0, hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid].za <= z) lo = mid; else hi = mid - 1;
  }
  return s[lo];
}

/**
 * The beam at z: { q, n, w, R, w0, zR, zw (actual waist position of this segment), gouy
 * (accumulated), opl, curv = Re(1/q^) (so the wavefront phase is k0 x^2 curv / 2), seg }.
 */
export function beamAt(trace, z, seg = segmentAt(trace, z)) {
  const d = (z - seg.za) / seg.n;
  const q = { re: seg.q.re + d, im: seg.q.im };
  const b = beamOf(q, trace.lambda, seg.n);
  const gouy = seg.gouy + Math.atan2(q.re, q.im) - Math.atan2(seg.q.re, seg.q.im);
  return {
    q, n: seg.n, w: b.w, R: b.R, w0: b.w0, zR: b.zR, theta: b.theta, zw: z - b.dz, gouy,
    opl: seg.opl + seg.n * (z - seg.za), curv: q.re / (q.re * q.re + q.im * q.im), seg,
  };
}

/** The waists of a trace: one per segment, { z, w0, zR, theta, real (inside its segment), seg }. */
export function waists(trace) {
  return trace.segments.map((seg) => {
    const b = beamOf(seg.q, trace.lambda, seg.n), z = seg.za - b.dz;
    return { z, w0: b.w0, zR: b.zR, theta: b.theta, real: z >= seg.za - 1e-9 && z <= seg.zb + 1e-9, seg };
  });
}

// ----------------------------------------------------------------------- the field

/** Physicists' Hermite polynomial H_m(u) by the recurrence H_{k+1} = 2u H_k - 2k H_{k-1}. */
export function hermite(m, u) {
  if (m === 0) return 1;
  let h0 = 1, h1 = 2 * u;
  for (let k = 1; k < m; k++) { const h2 = 2 * u * h1 - 2 * k * h0; h0 = h1; h1 = h2; }
  return h1;
}

/**
 * The complex envelope of HG_m0 (y = 0) at z, without the carrier exp(i k0 opl): returns
 * [re, im] of (w_in / w) H_m(sqrt2 x/w) exp(-x^2/w^2) exp(i [k0 x^2 curv/2 - (m+1) gouy]) / sqrt(2^m m!),
 * where w_in is the input waist.  The full field is this times exp(i k0 opl).
 */
export function envelope(trace, b, x, m = 0, w_in = 1) {
  const k0 = (2 * Math.PI) / trace.lambda, u = (Math.SQRT2 * x) / b.w;
  let norm = 1;
  for (let k = 1; k <= m; k++) norm *= 2 * k;
  const a = ((w_in / b.w) * hermite(m, u) * Math.exp(-(x * x) / (b.w * b.w))) / Math.sqrt(norm);
  const ph = 0.5 * k0 * x * x * b.curv - (m + 1) * b.gouy;
  return [a * Math.cos(ph), a * Math.sin(ph)];
}

// ----------------------------------------------------------------------- lenses and matching

/**
 * Where a thin lens of focal length f puts the waist: the input waist (Rayleigh range zR) a
 * distance s before the lens.  Self's Gaussian lens law
 *     1 / (s + zR^2 / (s - f)) + 1 / s2 = 1 / f,
 * the magnification m = w0' / w0, and the geometric (zR -> 0) image distance f s / (s - f).
 */
export function lensLaw(s, zR, f) {
  const d = s - f, den = d * d + zR * zR;
  return { s2: f + (f * f * d) / den, m: Math.abs(f) / Math.sqrt(den), geometric: (f * s) / (s - f) };
}

/**
 * The fraction of the power of a beam q1 that couples into the (fundamental) mode q2, both on
 * the same axis, at the same plane, in the same medium:
 *     eta = 4 Im q1 Im q2 / |q1 - conj(q2)|^2
 * (equal to 1 only when q1 = q2; unchanged by propagating both).
 */
export function coupling(q1, q2) {
  const dr = q1.re - q2.re, di = q1.im + q2.im;
  return (4 * q1.im * q2.im) / (dr * dr + di * di);
}

/**
 * The Gouy phase a round beam gains through an ABCD system, -arg(A + B/q_in), modulo 2 pi.
 * (The field on the axis is divided by A + B/q_in: Collins' integral.)
 */
export function gouyThrough([A, B], qin) {
  const b = cdiv({ re: B, im: 0 }, qin);
  return -Math.atan2(b.im, A + b.re);
}
