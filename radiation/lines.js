// Field lines: curves that follow the direction of a field, traced with the Dormand–Prince
// 5(4) Runge–Kutta method and step-size control.  No DOM.

import { seedDirection, BETA_MAX } from './lw.js';

// The Dormand–Prince tableau (the fifth-order solution is propagated; the fourth-order one
// estimates the error; the last stage is the first of the next step).
// (The field does not depend on s, so the nodes c_i are not needed.)
const A21 = 1 / 5;
const A31 = 3 / 40, A32 = 9 / 40;
const A41 = 44 / 45, A42 = -56 / 15, A43 = 32 / 9;
const A51 = 19372 / 6561, A52 = -25360 / 2187, A53 = 64448 / 6561, A54 = -212 / 729;
const A61 = 9017 / 3168, A62 = -355 / 33, A63 = 46732 / 5247, A64 = 49 / 176, A65 = -5103 / 18656;
const B1 = 35 / 384, B3 = 500 / 1113, B4 = 125 / 192, B5 = -2187 / 6784, B6 = 11 / 84;
const E1 = 71 / 57600, E3 = -71 / 16695, E4 = 71 / 1920, E5 = -17253 / 339200, E6 = 22 / 525, E7 = -1 / 40;

/**
 * Trace a curve dr/ds = d(r), where dir(x, y, out) puts the unit direction d in out[0], out[1]
 * and returns false where it is undefined (a zero of the field).  s is the arc length.
 *   opts.tol      the largest position error allowed per step
 *   opts.h0, opts.hmin, opts.hmax   first, smallest and largest steps
 *   opts.limit()  called after each accepted step (the last dir() call was at the new point):
 *                 a further limit on the next step, or Infinity
 *   opts.keep(x, y)  false ends the curve (it has left the view, say)
 *   opts.maxLength, opts.maxPoints
 * The points go into out (x0, y0, x1, y1, ...); returns how many there are.
 */
export function traceCurve(dir, x0, y0, opts, out) {
  const tol = opts.tol ?? 1e-3, hmin = opts.hmin ?? 1e-5, hmax = opts.hmax ?? 1;
  const maxLength = opts.maxLength ?? 100, maxPoints = Math.min(opts.maxPoints ?? 4000, out.length >> 1);
  const d = SCRATCH;
  let x = x0, y = y0, h = opts.h0 ?? 0.01, len = 0, n = 0;
  out[0] = x; out[1] = y; n = 1;
  if (!dir(x, y, d)) return n;
  let k1x = d[0], k1y = d[1], lim = opts.limit ? opts.limit() : Infinity;
  while (n < maxPoints && len < maxLength) {
    h = Math.min(h, hmax, lim);
    let ok = true, k2x, k2y, k3x, k3y, k4x, k4y, k5x, k5y, k6x, k6y, k7x = 0, k7y = 0, xn = 0, yn = 0;
    if ((ok = dir(x + h * A21 * k1x, y + h * A21 * k1y, d))) {
      k2x = d[0]; k2y = d[1];
      ok = dir(x + h * (A31 * k1x + A32 * k2x), y + h * (A31 * k1y + A32 * k2y), d);
    }
    if (ok) {
      k3x = d[0]; k3y = d[1];
      ok = dir(x + h * (A41 * k1x + A42 * k2x + A43 * k3x), y + h * (A41 * k1y + A42 * k2y + A43 * k3y), d);
    }
    if (ok) {
      k4x = d[0]; k4y = d[1];
      ok = dir(x + h * (A51 * k1x + A52 * k2x + A53 * k3x + A54 * k4x), y + h * (A51 * k1y + A52 * k2y + A53 * k3y + A54 * k4y), d);
    }
    if (ok) {
      k5x = d[0]; k5y = d[1];
      ok = dir(x + h * (A61 * k1x + A62 * k2x + A63 * k3x + A64 * k4x + A65 * k5x), y + h * (A61 * k1y + A62 * k2y + A63 * k3y + A64 * k4y + A65 * k5y), d);
    }
    if (ok) {
      k6x = d[0]; k6y = d[1];
      xn = x + h * (B1 * k1x + B3 * k3x + B4 * k4x + B5 * k5x + B6 * k6x);
      yn = y + h * (B1 * k1y + B3 * k3y + B4 * k4y + B5 * k5y + B6 * k6y);
      ok = dir(xn, yn, d);
      k7x = d[0]; k7y = d[1];
    }
    if (!ok) {
      // A zero of the field inside the step: try a smaller one, or stop.
      if (h <= hmin) break;
      h = Math.max(hmin, h * 0.25);
      continue;
    }
    const ex = h * (E1 * k1x + E3 * k3x + E4 * k4x + E5 * k5x + E6 * k6x + E7 * k7x);
    const ey = h * (E1 * k1y + E3 * k3y + E4 * k4y + E5 * k5y + E6 * k6y + E7 * k7y);
    const err = Math.sqrt(ex * ex + ey * ey);
    if (err <= tol || h <= hmin) {
      x = xn; y = yn; len += h;
      out[2 * n] = x; out[2 * n + 1] = y; n++;
      k1x = k7x; k1y = k7y;
      lim = opts.limit ? opts.limit() : Infinity;
      if (opts.keep && !opts.keep(x, y)) break;
      h *= err > 0 ? Math.min(4, Math.max(0.2, 0.9 * Math.pow(tol / err, 0.2))) : 4;
    } else {
      h = Math.max(hmin, h * Math.max(0.1, 0.9 * Math.pow(tol / err, 0.25)));
    }
  }
  return n;
}
const SCRATCH = new Float64Array(2);

/**
 * The field lines of the charge at time t, in the plane z = 0.
 *   lw: an LW (lw.js) on a Trajectory; part: 'total' or 'velocity' (the 1/R² part alone)
 *   count: lines leaving the charge, equally spaced in angle in its rest frame (so that, as in
 *          three dimensions, the density of lines shows the strength of the field)
 *   box: [xmin, xmax, ymin, ymax], the region to trace in
 *   opts: tol, hmax, maxLength, maxPoints (per line), angle0 (offset of the first line)
 * Returns { lines: [Float64Array of x, y pairs], evaluations }.
 */
export function fieldLines(lw, t, part, count, box, opts = {}) {
  const traj = lw.path, c = lw.c, h = traj.h ?? 1 / 240;
  traj.at(t, true);
  const qx = traj.wx, qy = traj.wy, vx = traj.vx, vy = traj.vy;
  const [x0, x1, y0, y1] = box;
  const hmax = opts.hmax ?? 0.8, tol = opts.tol ?? 2e-3;
  const diag = Math.hypot(x1 - x0, y1 - y0);
  const maxLength = opts.maxLength ?? 3 * diag, maxPoints = opts.maxPoints ?? 3000;
  const eps = opts.start ?? 0.02;
  // Where the charge accelerates more weakly than this, its field is quiet: no step limit.
  const aQuiet = opts.aQuiet ?? 1e-6 * c * c;
  let guess = NaN, evaluations = 0;
  const velocityOnly = part === 'velocity';
  const dir = (x, y, out) => {
    lw.field(x, y, 0, t, guess);
    evaluations++;
    guess = lw.tr;
    const ex = velocityOnly ? lw.evx : lw.ex, ey = velocityOnly ? lw.evy : lw.ey;
    const m = Math.sqrt(ex * ex + ey * ey);
    if (!(m > 0) || !Number.isFinite(m)) return false;
    out[0] = ex / m; out[1] = ey / m;
    return true;
  };
  // A step of length s moves the retarded time by up to s/(cκ).  If the charge accelerated at
  // all in that span of its history, keep steps short enough to see how fast it changed, so
  // that no step jumps over a thin shell of radiation.
  const limit = () => {
    if (velocityOnly || !traj.activity) return Infinity;
    const b = Math.hypot(lw.bx, lw.by), kmin = Math.max(1 - b, 1 - BETA_MAX) * 0.5;
    const span = hmax / (c * kmin);
    const [amax, jmax] = traj.activity(lw.tr - span, lw.tr + span);
    if (amax <= aQuiet) return Infinity;
    const tau = Math.max(2 * h, jmax > 0 ? (h * amax) / jmax : Infinity);
    return Math.max(0.01, 0.5 * c * Math.max(lw.kappa, 1 - BETA_MAX) * tau);
  };
  const margin = 0.05 * diag;
  const keep = (x, y) => x > x0 - margin && x < x1 + margin && y > y0 - margin && y < y1 + margin;
  const lines = [];
  const buf = new Float64Array(2 * maxPoints);
  for (let k = 0; k < count; k++) {
    const th0 = (opts.angle0 ?? 0) + (2 * Math.PI * (k + 0.5)) / count;
    const [dx, dy] = seedDirection(th0, vx, vy, c);
    guess = NaN;
    const n = traceCurve(dir, qx + eps * dx, qy + eps * dy, { tol, hmax, h0: eps, maxLength, maxPoints, limit, keep }, buf);
    lines.push(buf.slice(0, 2 * n));
  }
  return { lines, evaluations };
}
