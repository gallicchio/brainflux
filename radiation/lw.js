// The exact field of a moving point charge (Liénard–Wiechert), for a charge moving in the
// plane z = 0.  No DOM: the tests import this.
//
// Gaussian units with q = 1 (for SI multiply E by q/4πε₀ and B by q/4πε₀c):
//
//   E = (n − β)(1 − β²) / (κ³R²)  +  n × ((n − β) × a) / (c²κ³R),        B = n × E,
//       \___ velocity field ___/     \____ acceleration field ____/
//
// all evaluated at the retarded time t_r, the moment whose light reaches r at time t:
// |r − w(t_r)| = c (t − t_r).  R = |r − w(t_r)|, n = (r − w(t_r))/R, β = v(t_r)/c, κ = 1 − n·β.
// The Poynting vector is S = (c/4π) E × B, and the charge radiates Liénard's power
// P = (2/3) γ⁶ (a² − |β × a|²) / c³ (Larmor's (2/3) a²/c³ when β → 0).

/** The fastest the charge may go, as a fraction of c. */
export const BETA_MAX = 0.98;

/**
 * The charge's path, sampled every h seconds (position, velocity, acceleration) in a ring of
 * `capacity` samples.  Between samples the path is the quintic that matches all three at both
 * ends, so the velocity and acceleration are exactly the derivatives of the position (which
 * keeps Gauss's law exact).  Before the oldest sample the charge moves uniformly with that
 * sample's velocity: it was at rest, or coasting, forever.  After the newest it coasts too.
 *
 * at(t) sets this.wx, wy (position), vx, vy (velocity) and, unless acc is false, ax, ay.
 */
export class Trajectory {
  constructor(h = 1 / 240, capacity = 16384) {
    this.h = h;
    this.cap = capacity;
    this.X = new Float64Array(capacity); this.Y = new Float64Array(capacity);
    this.VX = new Float64Array(capacity); this.VY = new Float64Array(capacity);
    this.AX = new Float64Array(capacity); this.AY = new Float64Array(capacity);
    this.wx = 0; this.wy = 0; this.vx = 0; this.vy = 0; this.ax = 0; this.ay = 0;
    // Per block of BLOCK samples: the largest |a| and the largest change of a from one sample
    // to the next, so that "is the charge accelerating around time t?" is cheap to ask.
    this.nb = Math.ceil(capacity / BLOCK) + 1;
    this.blkA = new Float64Array(this.nb); this.blkJ = new Float64Array(this.nb);
    this.reset(0, 0, 0);
  }

  /** Forget the past: one sample at time t, and uniform motion with velocity (vx, vy) before it. */
  reset(t, x, y, vx = 0, vy = 0, ax = 0, ay = 0) {
    this.t0 = t;
    this.n = 0;
    this.push(x, y, vx, vy, ax, ay);
  }

  /** Append the sample at time tEnd + h. */
  push(x, y, vx, vy, ax, ay) {
    const k = this.n, i = k % this.cap, b = Math.floor(k / BLOCK) % this.nb;
    if (k % BLOCK === 0) { this.blkA[b] = 0; this.blkJ[b] = 0; }
    const a = Math.abs(ax) + Math.abs(ay);
    if (a > this.blkA[b]) this.blkA[b] = a;
    if (k > 0) {
      const p = (k - 1) % this.cap, da = Math.abs(ax - this.AX[p]) + Math.abs(ay - this.AY[p]);
      if (da > this.blkJ[b]) this.blkJ[b] = da;
    }
    this.X[i] = x; this.Y[i] = y; this.VX[i] = vx; this.VY[i] = vy; this.AX[i] = ax; this.AY[i] = ay;
    this.n++;
  }

  get kStart() { return this.n > this.cap ? this.n - this.cap : 0; }
  get tStart() { return this.t0 + this.kStart * this.h; }
  get tEnd() { return this.t0 + (this.n - 1) * this.h; }
  /** Time of sample k (counted from the last reset). */
  time(k) { return this.t0 + k * this.h; }
  /** Sample k as [x, y, vx, vy, ax, ay]. */
  sample(k) {
    const i = k % this.cap;
    return [this.X[i], this.Y[i], this.VX[i], this.VY[i], this.AX[i], this.AY[i]];
  }

  at(t, acc = true) {
    const h = this.h, u = (t - this.t0) / h, kS = this.kStart, kE = this.n - 1;
    if (!(u > kS && u < kE)) {
      // Outside the stored samples (or exactly at an end): uniform motion from the end sample.
      const k = u <= kS ? kS : kE, i = k % this.cap, dt = t - (this.t0 + k * h);
      this.vx = this.VX[i]; this.vy = this.VY[i];
      this.wx = this.X[i] + this.vx * dt; this.wy = this.Y[i] + this.vy * dt;
      const exact = Math.abs(dt) <= 1e-9 * h;
      this.ax = exact ? this.AX[i] : 0; this.ay = exact ? this.AY[i] : 0;
      return;
    }
    const k = Math.floor(u), s = u - k, cap = this.cap, i = k % cap, j = (k + 1) % cap;
    const X = this.X, Y = this.Y, VX = this.VX, VY = this.VY, AX = this.AX, AY = this.AY;
    const s2 = s * s, s3 = s2 * s, s4 = s3 * s, s5 = s4 * s, hh = h * h;
    // Quintic Hermite basis: values at 0 (x, v, a) and at 1 (x, v, a).
    const h0 = 1 - 10 * s3 + 15 * s4 - 6 * s5, h5 = 1 - h0;
    const h1 = (s - 6 * s3 + 8 * s4 - 3 * s5) * h, h4 = (-4 * s3 + 7 * s4 - 3 * s5) * h;
    const h2 = 0.5 * (s2 - 3 * s3 + 3 * s4 - s5) * hh, h3 = 0.5 * (s3 - 2 * s4 + s5) * hh;
    const dX = X[i] - X[j], dY = Y[i] - Y[j];
    this.wx = X[j] + h0 * dX + h1 * VX[i] + h4 * VX[j] + h2 * AX[i] + h3 * AX[j];
    this.wy = Y[j] + h0 * dY + h1 * VY[i] + h4 * VY[j] + h2 * AY[i] + h3 * AY[j];
    const d0 = (-30 * s2 + 60 * s3 - 30 * s4) / h;
    const d1 = 1 - 18 * s2 + 32 * s3 - 15 * s4, d4 = -12 * s2 + 28 * s3 - 15 * s4;
    const d2 = 0.5 * (2 * s - 9 * s2 + 12 * s3 - 5 * s4) * h, d3 = 0.5 * (3 * s2 - 8 * s3 + 5 * s4) * h;
    this.vx = d0 * dX + d1 * VX[i] + d4 * VX[j] + d2 * AX[i] + d3 * AX[j];
    this.vy = d0 * dY + d1 * VY[i] + d4 * VY[j] + d2 * AY[i] + d3 * AY[j];
    if (!acc) return;
    const e0 = (-60 * s + 180 * s2 - 120 * s3) / hh;
    const e1 = (-36 * s + 96 * s2 - 60 * s3) / h, e4 = (-24 * s + 84 * s2 - 60 * s3) / h;
    const e2 = 0.5 * (2 - 18 * s + 36 * s2 - 20 * s3), e3 = 0.5 * (6 * s - 24 * s2 + 20 * s3);
    this.ax = e0 * dX + e1 * VX[i] + e4 * VX[j] + e2 * AX[i] + e3 * AX[j];
    this.ay = e0 * dY + e1 * VY[i] + e4 * VY[j] + e2 * AY[i] + e3 * AY[j];
  }

  /** For the times in [t1, t2] (to within a block of samples): the largest |a| (as |ax| + |ay|)
   *  and the largest change of a from one sample to the next.  Outside the stored samples the
   *  charge coasts: [0, 0]. */
  activity(t1, t2) {
    const h = this.h, kS = this.kStart, kE = this.n - 1;
    let k0 = Math.floor((t1 - this.t0) / h), k1 = Math.ceil((t2 - this.t0) / h);
    if (k1 < kS || k0 > kE) return ACT0;
    k0 = Math.max(k0, kS); k1 = Math.min(k1, kE);
    let amax = 0, jmax = 0;
    for (let b = Math.floor(k0 / BLOCK), b1 = Math.floor(k1 / BLOCK); b <= b1; b++) {
      const i = b % this.nb;
      if (this.blkA[i] > amax) amax = this.blkA[i];
      if (this.blkJ[i] > jmax) jmax = this.blkJ[i];
    }
    ACT[0] = amax; ACT[1] = jmax;
    return ACT;
  }

  /** How far (in time) from t to the nearest block of samples, within [t − span, t + span],
   *  where |a| (as |ax| + |ay|) exceeds aQuiet: 0 inside one, Infinity if there is none. */
  quietFor(t, span, aQuiet) {
    const h = this.h, kS = this.kStart, kE = this.n - 1, nb = this.nb;
    const b0 = Math.floor((t - this.t0) / h / BLOCK);
    const bS = Math.floor(kS / BLOCK), bE = Math.floor(kE / BLOCK), reach = Math.ceil(span / (h * BLOCK)) + 1;
    for (let d = 0; d <= reach; d++) {
      for (let side = d ? -1 : 1; side <= 1; side += 2) {
        const b = b0 + side * d;
        if (b < bS || b > bE || this.blkA[b % nb] <= aQuiet) continue;
        if (d === 0) return 0;
        // The gap from t to the near edge of block b.
        const edge = b < b0 ? this.t0 + (b + 1) * BLOCK * h : this.t0 + b * BLOCK * h;
        return Math.max(0, Math.abs(edge - t) - h);
      }
    }
    return Infinity;
  }
}

const BLOCK = 16;
const ACT = new Float64Array(2), ACT0 = new Float64Array(2);

/**
 * A path given by a function: f(t, out) fills out = [x, y, vx, vy, ax, ay].  Same interface as
 * Trajectory.at(), for tests and for exact paths.
 */
export class AnalyticPath {
  constructor(f) { this.f = f; this.o = new Float64Array(6); this.wx = this.wy = this.vx = this.vy = this.ax = this.ay = 0; }
  at(t) {
    const o = this.o;
    this.f(t, o);
    this.wx = o[0]; this.wy = o[1]; this.vx = o[2]; this.vy = o[3]; this.ax = o[4]; this.ay = o[5];
  }
}

/**
 * The field of a charge moving along `path` (a Trajectory or AnalyticPath) with light speed c.
 * field(x, y, z, t) leaves its results in the object:
 *   ex, ey, ez        the electric field
 *   evx, evy, evz     its velocity part (1/R²)
 *   eax, eay, eaz     its acceleration part (1/R), perpendicular to n
 *   tr, R, nx, ny, nz, kappa, and the charge's retarded state px, py, bx, by (β), ax, ay
 * B = n × E (Gaussian units); bfield() computes it.
 */
export class LW {
  constructor(path, c) {
    this.path = path;
    this.c = c;
    this.tol = 1e-13;     // relative tolerance on the retarded time
    this.atol = 0;        // and an absolute one (seconds), for pictures that need less
    this.iterations = 0;  // Newton iterations of the last solve (for the tests)
    this.tr = 0;
    this.last = 0;        // the time at which the path was last evaluated
  }

  /**
   * The retarded time: the unique t_r < t with |r − w(t_r)| = c (t − t_r).  The function
   * g(t_r) = c (t − t_r) − |r − w(t_r)| falls monotonically, with a slope between −c(1 + β) and
   * −c(1 − β), β ≤ BETA_MAX, so every evaluation brackets the root, and Newton's method kept
   * inside the bracket always converges; `guess` (a neighbour's t_r) makes it take two or three
   * steps.  The path is left evaluated (with its acceleration) at this.last, within the
   * tolerance of the returned time.
   */
  retarded(x, y, z, t, guess = NaN) {
    const P = this.path, c = this.c;
    const b = BETA_MAX + 0.005, sFast = c * (1 + b), sSlow = c * (1 - b);
    let tr = guess;
    if (!(guess < t)) {
      // No guess: the time light from the present position would take.
      P.at(t, false);
      const dx = x - P.wx, dy = y - P.wy;
      tr = t - Math.sqrt(dx * dx + dy * dy + z * z) / c;
    }
    let lo = -Infinity, hi = t, step = 0, it = 0;
    const tol = Math.max(this.tol * (1 + Math.abs(t)), this.atol);
    for (; it < 60; it++) {
      P.at(tr, true);
      this.last = tr;
      const dx = x - P.wx, dy = y - P.wy;
      const R = Math.sqrt(dx * dx + dy * dy + z * z), g = c * (t - tr) - R;
      if (g > 0) { lo = Math.max(lo, tr + g / sFast); hi = Math.min(hi, tr + g / sSlow); }
      else { hi = Math.min(hi, tr + g / sFast); lo = Math.max(lo, tr + g / sSlow); }
      const gp = R > 0 ? -c + (dx * P.vx + dy * P.vy) / R : -c;
      step = -g / gp;
      if (Math.abs(step) <= tol) break;
      let next = tr + step;
      if (!(next >= lo && next <= hi)) next = 0.5 * (lo + hi);
      step = next - tr;
      if (hi - lo <= tol) break;
      tr = next;
    }
    this.iterations = it + 1;
    return tr + step;
  }

  /** The fields at (x, y, z) at time t; see the class comment for what is set. */
  field(x, y, z, t, guess = NaN) {
    const tr = this.retarded(x, y, z, t, guess);
    const P = this.path, c = this.c;
    // The path was evaluated at this.last, a hair's breadth from tr: carry it on by Taylor.
    const s = tr - this.last, ax = P.ax, ay = P.ay;
    const vx = P.vx + ax * s, vy = P.vy + ay * s;
    const wx = P.wx + (P.vx + 0.5 * ax * s) * s, wy = P.wy + (P.vy + 0.5 * ay * s) * s;
    const dx = x - wx, dy = y - wy, R = Math.sqrt(dx * dx + dy * dy + z * z);
    const nx = dx / R, ny = dy / R, nz = z / R;
    const bx = vx / c, by = vy / c;
    const kappa = 1 - nx * bx - ny * by, k3 = kappa * kappa * kappa;
    const ux = nx - bx, uy = ny - by, uz = nz;
    const fv = (1 - bx * bx - by * by) / (k3 * R * R);
    this.evx = ux * fv; this.evy = uy * fv; this.evz = uz * fv;
    // n × (u × a) = u (n·a) − a (n·u), and n·u = κ.
    const na = nx * ax + ny * ay, fa = 1 / (c * c * k3 * R);
    this.eax = (ux * na - ax * kappa) * fa; this.eay = (uy * na - ay * kappa) * fa; this.eaz = uz * na * fa;
    this.ex = this.evx + this.eax; this.ey = this.evy + this.eay; this.ez = this.evz + this.eaz;
    this.tr = tr; this.R = R; this.nx = nx; this.ny = ny; this.nz = nz; this.kappa = kappa;
    this.px = wx; this.py = wy; this.bx = bx; this.by = by; this.ax = ax; this.ay = ay;
    return this;
  }

  /** B = n × E after field(): [bx, by, bz]. */
  bfield() {
    const { nx, ny, nz, ex, ey, ez } = this;
    return [ny * ez - nz * ey, nz * ex - nx * ez, nx * ey - ny * ex];
  }
}

/** Liénard's power: P = (2/3) γ⁶ (a² − |β × a|²)/c³ (Gaussian, q = 1). */
export function lienardPower(vx, vy, ax, ay, c) {
  const bx = vx / c, by = vy / c, g2 = 1 / (1 - bx * bx - by * by), cross = bx * ay - by * ax;
  return (2 / 3) * g2 * g2 * g2 * (ax * ax + ay * ay - cross * cross) / (c * c * c);
}

/** Larmor's power, (2/3) a²/c³: right only when v ≪ c. */
export function larmorPower(ax, ay, c) { return (2 / 3) * (ax * ax + ay * ay) / (c * c * c); }

/**
 * The power radiated into the direction n (a unit 3-vector) per unit solid angle, per unit
 * time of the charge (the rate at which it loses energy):
 *   dP/dΩ = |n × ((n − β) × a)|² / (4π c³ κ⁵).
 */
export function dPdOmega(nx, ny, nz, vx, vy, ax, ay, c) {
  const bx = vx / c, by = vy / c, kappa = 1 - nx * bx - ny * by;
  const ux = nx - bx, uy = ny - by, uz = nz, na = nx * ax + ny * ay;
  const px = ux * na - ax * kappa, py = uy * na - ay * kappa, pz = uz * na;
  const k2 = kappa * kappa;
  return (px * px + py * py + pz * pz) / (4 * Math.PI * c * c * c * k2 * k2 * kappa);
}

/**
 * The direction (in the plane) of the field line that leaves the charge at angle th0 in its
 * rest frame, when it moves with velocity (vx, vy): the Coulomb lines, Lorentz contracted
 * along the velocity (tan θ = γ tan θ₀ measured from the velocity).  Returns [dx, dy], unit.
 */
export function seedDirection(th0, vx, vy, c) {
  let dx = Math.cos(th0), dy = Math.sin(th0);
  const v = Math.hypot(vx, vy);
  if (v === 0) return [dx, dy];
  const ux = vx / v, uy = vy / v, b = v / c, gamma = 1 / Math.sqrt(1 - b * b);
  const par = dx * ux + dy * uy;
  dx -= par * ux * (1 - 1 / gamma); dy -= par * uy * (1 - 1 / gamma);
  const m = Math.hypot(dx, dy);
  return [dx / m, dy / m];
}
