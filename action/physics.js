// The principle of stationary action, numerically.
//
// A system is a Lagrangian L(q, v, s): q the coordinate, v = dq/ds its rate of change, s the
// "time" (in Fermat's principle s is a distance and the action an optical path).  All the
// functions here work on whole arrays at once:
//
//     L(q, v, s) -> Float64Array          the Lagrangian at many points
//     accel(q, v, s) -> Float64Array      optional: d^2q/ds^2 from the Euler-Lagrange equation
//
// A path is drawn through "knots" at equally spaced s, and is either a natural cubic spline
// through them or straight segments.  Its action S = integral of L ds is computed from samples.
// The true paths (where S is stationary) are found by shooting: integrate the Euler-Lagrange
// equation from the first end point with many initial slopes and keep the ones that land on
// the other end point.  Whether a true path is a minimum or a saddle of S is decided by the
// Jacobi equation (counting conjugate points: the Morse index).

// ---------------------------------------------------------------------- splines

/**
 * The natural cubic spline through (s[0], q[0]) ... (s[n-1], q[n-1]) with equally spaced s.
 * Returns the second derivatives at the knots (zero at the ends).
 */
function splineMoments(q, h) {
  const n = q.length, M = new Float64Array(n);
  if (n < 3) return M;
  // Tridiagonal system h M[i-1] + 4h M[i] + h M[i+1] = 6 (q[i+1] - 2 q[i] + q[i-1]) / h.
  const m = n - 2, c = new Float64Array(m), d = new Float64Array(m);
  for (let i = 0; i < m; i++) d[i] = (6 * (q[i + 2] - 2 * q[i + 1] + q[i])) / (h * h);
  // Thomas algorithm for diag 4, off-diagonal 1.
  const cp = new Float64Array(m), dp = new Float64Array(m);
  cp[0] = 1 / 4; dp[0] = d[0] / 4;
  for (let i = 1; i < m; i++) {
    const w = 4 - cp[i - 1];
    cp[i] = 1 / w;
    dp[i] = (d[i] - dp[i - 1]) / w;
  }
  c[m - 1] = dp[m - 1];
  for (let i = m - 2; i >= 0; i--) c[i] = dp[i] - cp[i] * c[i + 1];
  for (let i = 0; i < m; i++) M[i + 1] = c[i];
  return M;
}

/**
 * A path through knots q[0..n-1] at s = s0 + i h.  mode 'spline' or 'segments'.
 * sample(ss) returns {q, v, a}: position, slope and second derivative at each ss.
 */
export class Path {
  constructor(s0, s1, knots, mode = 'spline') {
    this.s0 = s0; this.s1 = s1;
    this.q = Float64Array.from(knots);
    this.mode = mode;
    this.h = (s1 - s0) / (knots.length - 1);
    this.M = mode === 'spline' ? splineMoments(this.q, this.h) : null;
  }
  get knotS() { return Array.from(this.q, (_, i) => this.s0 + i * this.h); }

  sample(ss) {
    const n = this.q.length, h = this.h, q = this.q, M = this.M;
    const outQ = new Float64Array(ss.length), outV = new Float64Array(ss.length), outA = new Float64Array(ss.length);
    for (let k = 0; k < ss.length; k++) {
      let u = (ss[k] - this.s0) / h;
      let i = Math.floor(u);
      if (i < 0) i = 0; if (i > n - 2) i = n - 2;
      const t = u - i;
      if (!M) {
        outQ[k] = q[i] + (q[i + 1] - q[i]) * t;
        outV[k] = (q[i + 1] - q[i]) / h;
        outA[k] = 0;
        continue;
      }
      const a = 1 - t, b = t;
      outQ[k] = a * q[i] + b * q[i + 1] + ((a * a * a - a) * M[i] + (b * b * b - b) * M[i + 1]) * (h * h) / 6;
      outV[k] = (q[i + 1] - q[i]) / h + ((-(3 * a * a - 1)) * M[i] + (3 * b * b - 1) * M[i + 1]) * h / 6;
      outA[k] = a * M[i] + b * M[i + 1];
    }
    return { q: outQ, v: outV, a: outA };
  }
}

// --------------------------------------------------------------------- the action

/**
 * Sample points for the integral: the midpoints of `count` equal steps in u, with s = s0 +
 * (s1 - s0) u^2 when the integrand is singular like 1/sqrt(s - s0) at the start (the
 * brachistochrone), which this change of variable makes finite.  Returns {s, w}: points and
 * weights (ds).
 */
export function quadrature(s0, s1, count = 400, singularStart = false) {
  const s = new Float64Array(count), w = new Float64Array(count), T = s1 - s0;
  for (let i = 0; i < count; i++) {
    const u = (i + 0.5) / count;
    if (singularStart) { s[i] = s0 + T * u * u; w[i] = (2 * T * u) / count; }
    else { s[i] = s0 + T * u; w[i] = T / count; }
  }
  return { s, w };
}

/** The action of a path: { S, samples, L } (NaN if the Lagrangian is undefined somewhere). */
export function action(system, path, quad) {
  const smp = path.sample(quad.s);
  const L = system.L(smp.q, smp.v, quad.s);
  let S = 0;
  for (let i = 0; i < L.length; i++) S += L[i] * quad.w[i];
  return { S, samples: smp, L };
}

/** For straight segments, the action is a sum over segments: sample each one finely. */
export function segmentQuadrature(s0, s1, segments, perSegment = 60, singularStart = false) {
  return quadrature(s0, s1, segments * perSegment, singularStart);
}

// ----------------------------------------------------------- derivatives of L

const EPS = 1e-5;

function shifted(arr, d) { const out = new Float64Array(arr.length); for (let i = 0; i < arr.length; i++) out[i] = arr[i] + d * (1 + Math.abs(arr[i])); return out; }
function step(arr) { return Array.from(arr, (x) => EPS * (1 + Math.abs(x))); }

/** dL/dv: the momentum conjugate to q. */
export function momentum(system, q, v, s) {
  if (system.p) return system.p(q, v, s);
  const hp = shifted(v, EPS), hm = shifted(v, -EPS), dv = step(v);
  const a = system.L(q, hp, s), b = system.L(q, hm, s), out = new Float64Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = (a[i] - b[i]) / (2 * dv[i]);
  return out;
}

/** The energy function E = v dL/dv - L (the Hamiltonian along the path). */
export function energy(system, q, v, s) {
  const p = momentum(system, q, v, s), L = system.L(q, v, s), out = new Float64Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = v[i] * p[i] - L[i];
  return out;
}

/**
 * The Euler-Lagrange acceleration q'' = (L_q - L_vs - L_vq v) / L_vv, by central differences,
 * unless the system gives its own.
 */
export function acceleration(system, q, v, s) {
  if (system.accel) return system.accel(q, v, s);
  const n = q.length, L = system.L;
  const dq = step(q), dv = step(v), ds = step(s);
  const add = (arr, d, sgn) => { const o = new Float64Array(n); for (let i = 0; i < n; i++) o[i] = arr[i] + sgn * d[i]; return o; };
  const qp = add(q, dq, 1), qm = add(q, dq, -1), vp = add(v, dv, 1), vm = add(v, dv, -1), sp = add(s, ds, 1), sm = add(s, ds, -1);
  const L0 = L(q, v, s);
  const Lqp = L(qp, v, s), Lqm = L(qm, v, s);
  const Lvp = L(q, vp, s), Lvm = L(q, vm, s);
  const Lvpqp = L(qp, vp, s), Lvpqm = L(qm, vp, s), Lvmqp = L(qp, vm, s), Lvmqm = L(qm, vm, s);
  const Lvpsp = L(q, vp, sp), Lvpsm = L(q, vp, sm), Lvmsp = L(q, vm, sp), Lvmsm = L(q, vm, sm);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const Lq = (Lqp[i] - Lqm[i]) / (2 * dq[i]);
    const Lvv = (Lvp[i] - 2 * L0[i] + Lvm[i]) / (dv[i] * dv[i]);
    const Lvq = (Lvpqp[i] - Lvpqm[i] - Lvmqp[i] + Lvmqm[i]) / (4 * dv[i] * dq[i]);
    const Lvs = (Lvpsp[i] - Lvpsm[i] - Lvmsp[i] + Lvmsm[i]) / (4 * dv[i] * ds[i]);
    out[i] = (Lq - Lvs - Lvq * v[i]) / Lvv;
  }
  return out;
}

// --------------------------------------------------------------- true paths

/**
 * Integrate the Euler-Lagrange equation from (s0, q0) with initial slopes v0[] (all at once),
 * by RK4 in `steps` steps.  Returns {q: Float64Array[] per step, v: ...} as arrays over the
 * slopes, or just the end values when record is false.
 */
function shootAll(system, s0, s1, q0, v0, steps, record = false) {
  const n = v0.length, h = (s1 - s0) / steps;
  let q = new Float64Array(n).fill(q0), v = Float64Array.from(v0);
  const qs = record ? [q.slice()] : null, vs = record ? [v.slice()] : null;
  const k = (qq, vv, s) => acceleration(system, qq, vv, s);
  for (let j = 0; j < steps; j++) {
    const s = s0 + j * h;
    const sA = new Float64Array(n).fill(s), sB = new Float64Array(n).fill(s + h / 2), sC = new Float64Array(n).fill(s + h);
    const a1 = k(q, v, sA);
    const q2 = new Float64Array(n), v2 = new Float64Array(n);
    for (let i = 0; i < n; i++) { q2[i] = q[i] + (h / 2) * v[i]; v2[i] = v[i] + (h / 2) * a1[i]; }
    const a2 = k(q2, v2, sB);
    const q3 = new Float64Array(n), v3 = new Float64Array(n);
    for (let i = 0; i < n; i++) { q3[i] = q[i] + (h / 2) * v2[i]; v3[i] = v[i] + (h / 2) * a2[i]; }
    const a3 = k(q3, v3, sB);
    const q4 = new Float64Array(n), v4 = new Float64Array(n);
    for (let i = 0; i < n; i++) { q4[i] = q[i] + h * v3[i]; v4[i] = v[i] + h * a3[i]; }
    const a4 = k(q4, v4, sC);
    const qn = new Float64Array(n), vn = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      qn[i] = q[i] + (h / 6) * (v[i] + 2 * v2[i] + 2 * v3[i] + v4[i]);
      vn[i] = v[i] + (h / 6) * (a1[i] + 2 * a2[i] + 2 * a3[i] + a4[i]);
      if (!Number.isFinite(qn[i]) || !Number.isFinite(vn[i])) { qn[i] = NaN; vn[i] = NaN; }
    }
    q = qn; v = vn;
    if (record) { qs.push(q.slice()); vs.push(v.slice()); }
  }
  return record ? { qs, vs } : { q, v };
}

/**
 * The true paths from (s0, q0) to (s1, q1): every initial slope in [-vmax, vmax] whose
 * trajectory lands on q1.  Returns [{v0, s, q, v, S, index}], sorted by action.
 */
export function truePaths(system, s0, q0, s1, q1, { vmax = 20, scan = 241, steps = 400, max = 6 } = {}) {
  steps += steps % 2;
  const v0 = Float64Array.from({ length: scan }, (_, i) => -vmax + (2 * vmax * i) / (scan - 1));
  const end = shootAll(system, s0, s1, q0, v0, Math.max(100, steps >> 1)).q;
  const roots = [];
  for (let i = 0; i + 1 < scan; i++) {
    const a = end[i] - q1, b = end[i + 1] - q1;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a === 0) { roots.push(v0[i]); continue; }
    if (a * b < 0) {
      // Refine by bisection (robust, and cheap: one trajectory at a time).
      let lo = v0[i], hi = v0[i + 1], flo = a;
      for (let it = 0; it < 50; it++) {
        const mid = (lo + hi) / 2;
        const f = shootAll(system, s0, s1, q0, [mid], steps).q[0] - q1;
        if (!Number.isFinite(f)) break;
        if ((f < 0) === (flo < 0)) { lo = mid; flo = f; } else hi = mid;
      }
      roots.push((lo + hi) / 2);
    }
  }
  const out = [];
  for (const r of roots.slice(0, 3 * max)) {
    const tr = shootAll(system, s0, s1, q0, [r], steps, true);
    const q = Float64Array.from(tr.qs, (a) => a[0]), v = Float64Array.from(tr.vs, (a) => a[0]);
    if (Math.abs(q[q.length - 1] - q1) > 1e-6 * (1 + Math.abs(q1))) continue;
    const s = Float64Array.from(q, (_, j) => s0 + ((s1 - s0) * j) / steps);
    // The action along it, by Simpson's rule on the RK4 samples (steps is even).
    const L = system.L(q, v, s), h = (s1 - s0) / steps;
    let S = L[0] + L[steps];
    for (let j = 1; j < steps; j++) S += (j % 2 ? 4 : 2) * L[j];
    S *= h / 3;
    if (!Number.isFinite(S)) continue;
    out.push({ v0: r, s, q, v, S, index: morseIndex(system, s, q, v) });
  }
  // Drop duplicates (the same path found twice).
  out.sort((a, b) => a.S - b.S);
  const unique = [];
  for (const p of out) if (!unique.some((u) => Math.abs(u.v0 - p.v0) < 1e-6 * (1 + Math.abs(p.v0)))) unique.push(p);
  return unique.slice(0, max);
}

/**
 * The number of conjugate points along a true path: zeros in (s0, s1) of the Jacobi field
 * eta, the solution of the linearised Euler-Lagrange equation with eta(s0) = 0, eta'(s0) = 1.
 * Found here by shooting two neighbouring trajectories and following their difference.  Zero
 * means the path is a local minimum of S (with L convex in v); each conjugate point adds one
 * direction in which S decreases: a saddle.
 */
export function morseIndex(system, s, q, v) {
  const n = s.length - 1, s0 = s[0], s1 = s[n];
  const d = 1e-6 * (1 + Math.abs(v[0]));
  const pair = shootAll(system, s0, s1, q[0], [v[0] - d, v[0] + d], n, true);
  let zeros = 0, prev = 0;
  for (let j = 1; j < n; j++) {
    const eta = pair.qs[j][1] - pair.qs[j][0];
    if (j > 2 && prev !== 0 && Math.sign(eta) !== Math.sign(prev)) zeros++;
    if (eta !== 0) prev = eta;
  }
  return zeros;
}

// ---------------------------------------------------------- the knot gradient

/**
 * dS/dq_k for each interior knot, by central differences: which way to move each knot to
 * lower the action fastest.  Returns Float64Array of the knot count (0 at the end points).
 */
export function knotGradient(system, path, quad) {
  const n = path.q.length, g = new Float64Array(n);
  const scale = Math.max(1e-3, ...Array.from(path.q, Math.abs)) * 1e-4;
  for (let k = 1; k < n - 1; k++) {
    const up = Float64Array.from(path.q), dn = Float64Array.from(path.q);
    up[k] += scale; dn[k] -= scale;
    const Sp = action(system, new Path(path.s0, path.s1, up, path.mode), quad).S;
    const Sm = action(system, new Path(path.s0, path.s1, dn, path.mode), quad).S;
    g[k] = (Sp - Sm) / (2 * scale);
  }
  return g;
}

/** The diagonal of the knot Hessian: the curvature of S in each knot. */
export function knotCurvature(system, path, quad) {
  const n = path.q.length, c = new Float64Array(n);
  const S0 = action(system, path, quad).S;
  const scale = Math.max(1e-3, ...Array.from(path.q, Math.abs)) * 1e-3;
  for (let k = 1; k < n - 1; k++) {
    const up = Float64Array.from(path.q), dn = Float64Array.from(path.q);
    up[k] += scale; dn[k] -= scale;
    const Sp = action(system, new Path(path.s0, path.s1, up, path.mode), quad).S;
    const Sm = action(system, new Path(path.s0, path.s1, dn, path.mode), quad).S;
    c[k] = (Sp - 2 * S0 + Sm) / (scale * scale);
  }
  return c;
}

// ----------------------------------------------------------- phase space

/**
 * The Hamiltonian on a grid of (q, p), for systems whose L does not depend on s: solve
 * p = dL/dv for v by Newton's method (vectorised over the grid), then H = p v - L.  Points
 * where no v gives that p (for light, |p| > n) come out NaN.
 */
export function hamiltonianGrid(system, qs, ps, s = 0) {
  const nq = qs.length, np = ps.length, N = nq * np;
  const q = new Float64Array(N), p = new Float64Array(N), sArr = new Float64Array(N).fill(s);
  for (let j = 0; j < np; j++) for (let i = 0; i < nq; i++) { q[j * nq + i] = qs[i]; p[j * nq + i] = ps[j]; }
  let v = new Float64Array(N);
  if (system.vOfP) v = system.vOfP(q, p, sArr);
  else {
    for (let it = 0; it < 40; it++) {
      const P = momentum(system, q, v, sArr);
      const dv = step(v);
      const vp = new Float64Array(N); for (let i = 0; i < N; i++) vp[i] = v[i] + dv[i];
      const Pp = momentum(system, q, vp, sArr);
      let worst = 0;
      for (let i = 0; i < N; i++) {
        const slope = (Pp[i] - P[i]) / dv[i];
        let dvi = (p[i] - P[i]) / slope;
        if (!Number.isFinite(dvi)) { v[i] = NaN; continue; }
        // Damped, so that bounded momenta (light, relativity) don't overshoot.
        dvi = Math.max(-1, Math.min(1, dvi)) * (Math.abs(v[i]) + 1);
        v[i] += dvi;
        worst = Math.max(worst, Math.abs(p[i] - P[i]));
      }
      if (worst < 1e-10) break;
    }
  }
  const P = momentum(system, q, v, sArr), L = system.L(q, v, sArr), H = new Float64Array(N);
  for (let i = 0; i < N; i++) H[i] = Math.abs(P[i] - p[i]) < 1e-6 * (1 + Math.abs(p[i])) ? p[i] * v[i] - L[i] : NaN;
  return H;
}
