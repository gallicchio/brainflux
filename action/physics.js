// The principle of stationary action, numerically.
//
// A system is a Lagrangian L(q, v, s): q the coordinate, v = dq/ds its rate of change, s the
// "time" (in Fermat's principle s is a distance and the action an optical path).  All the
// functions here work on whole arrays at once:
//
//     L(q, v, s) -> Float64Array          the Lagrangian at many points
//     accel(q, v, s) -> Float64Array      optional: d^2q/ds^2 from the Euler-Lagrange equation
//
// A path is drawn through "knots", events (s_k, q_k) in increasing s, and is either a cubic
// spline through them or straight segments.  Its action S = integral of L ds is computed by
// Gauss-Legendre quadrature within each knot interval.  The true paths (where S is stationary)
// are found by shooting: integrate the Euler-Lagrange equation from the first end point with
// many initial slopes and keep the ones that land on the other end point.  Whether a true path
// is a minimum or a saddle of S is decided by the Jacobi equation (counting conjugate points:
// the Morse index).

// ---------------------------------------------------------------------- splines

/** Solve A x = b for a small dense A (rows), by Gaussian elimination with partial pivoting. */
function solve(A, b) {
  const n = b.length, a = A.map((r) => Float64Array.from(r)), x = Float64Array.from(b);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]]; [x[c], x[p]] = [x[p], x[c]];
    for (let r = c + 1; r < n; r++) {
      const f = a[r][c] / a[c][c];
      if (!f) continue;
      for (let k = c; k < n; k++) a[r][k] -= f * a[c][k];
      x[r] -= f * x[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let sum = x[r];
    for (let k = r + 1; k < n; k++) sum -= a[r][k] * x[k];
    x[r] = sum / a[r][r];
  }
  return x;
}

/**
 * The second derivatives M at the knots of the cubic spline through (s[i], q[i]), s increasing
 * but not necessarily evenly.  The ends are "not-a-knot" (the third derivative is continuous at
 * the second and the last-but-one knot, so that a cubic, and a parabola in particular, comes
 * out exactly: the true path of a thrown ball), or periodic (q[n-1] = q[0], and the slope and
 * curvature match across the ends too: a closed loop in phase space).  Three knots and not
 * periodic: the parabola through them.
 */
function splineMoments(s, q, periodic) {
  const n = q.length, M = new Float64Array(n);
  if (n < 3) return M;
  const h = [], d = [];
  for (let i = 0; i < n - 1; i++) { h.push(s[i + 1] - s[i]); d.push((q[i + 1] - q[i]) / h[i]); }
  // Continuity of the slope at knot i: h[i-1] M[i-1] + 2 (h[i-1] + h[i]) M[i] + h[i] M[i+1] = 6 (d[i] - d[i-1]).
  if (periodic) {
    const m = n - 1, A = Array.from({ length: m }, () => new Float64Array(m)), b = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const im = (i - 1 + m) % m, ip = (i + 1) % m;
      A[i][im] += h[im]; A[i][i] += 2 * (h[im] + h[i]); A[i][ip] += h[i];
      b[i] = 6 * (d[i] - d[im]);
    }
    const x = solve(A, b);
    for (let i = 0; i < m; i++) M[i] = x[i];
    M[n - 1] = M[0];
    return M;
  }
  if (n === 3) { M.fill((2 * (d[1] - d[0])) / (h[0] + h[1])); return M; }
  // Not-a-knot: M[0] = M[1] + (M[1] - M[2]) h[0]/h[1], and the same at the far end, put into
  // the first and last rows.
  const m = n - 2, A = Array.from({ length: m }, () => new Float64Array(m)), b = new Float64Array(m);
  for (let r = 0; r < m; r++) {
    const i = r + 1;
    if (r > 0) A[r][r - 1] = h[i - 1];
    A[r][r] = 2 * (h[i - 1] + h[i]);
    if (r < m - 1) A[r][r + 1] = h[i];
    b[r] = 6 * (d[i] - d[i - 1]);
  }
  const h0 = h[0], h1 = h[1], ha = h[n - 2], hb = h[n - 3];
  A[0][0] += h0 * (1 + h0 / h1); A[0][1] -= (h0 * h0) / h1;
  A[m - 1][m - 1] += ha * (1 + ha / hb); A[m - 1][m - 2] -= (ha * ha) / hb;
  const x = solve(A, b);
  for (let r = 0; r < m; r++) M[r + 1] = x[r];
  M[0] = M[1] + ((M[1] - M[2]) * h0) / h1;
  M[n - 1] = M[n - 2] + ((M[n - 2] - M[n - 3]) * ha) / hb;
  return M;
}

/**
 * A path through knots q[0..n-1] at s[0..n-1] (by default equally spaced from s0 to s1).
 * mode 'spline' or 'segments'; periodic: the last knot is the first one again.
 * sample(ss) returns {q, v, a}: position, slope and second derivative at each ss.
 */
export class Path {
  constructor(s0, s1, knots, mode = 'spline', { s = null, periodic = false } = {}) {
    this.s0 = s0; this.s1 = s1;
    this.q = Float64Array.from(knots);
    const n = this.q.length;
    this.s = s ? Float64Array.from(s) : Float64Array.from({ length: n }, (_, i) => s0 + ((s1 - s0) * i) / (n - 1));
    this.mode = mode;
    this.periodic = periodic;
    if (periodic) this.q[n - 1] = this.q[0];
    this.M = mode === 'spline' ? splineMoments(this.s, this.q, periodic) : null;
  }
  get knotS() { return Array.from(this.s); }
  withKnots(q) { return new Path(this.s0, this.s1, q, this.mode, { s: this.s, periodic: this.periodic }); }
  withTimes(s) { return new Path(this.s0, this.s1, this.q, this.mode, { s, periodic: this.periodic }); }

  /** The knot interval holding x: the last i with s[i] <= x, from 0 to n-2. */
  interval(x) {
    const s = this.s;
    let lo = 0, hi = s.length - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid] <= x) lo = mid; else hi = mid - 1; }
    return lo;
  }

  /** [position, slope, second derivative] at x, using the piece on interval i. */
  at(i, x) {
    const q = this.q, M = this.M, h = this.s[i + 1] - this.s[i], t = (x - this.s[i]) / h;
    if (!M) return [q[i] + (q[i + 1] - q[i]) * t, (q[i + 1] - q[i]) / h, 0];
    const a = 1 - t, b = t;
    return [
      a * q[i] + b * q[i + 1] + ((a * a * a - a) * M[i] + (b * b * b - b) * M[i + 1]) * (h * h) / 6,
      (q[i + 1] - q[i]) / h + (-(3 * a * a - 1) * M[i] + (3 * b * b - 1) * M[i + 1]) * h / 6,
      a * M[i] + b * M[i + 1],
    ];
  }

  sample(ss) {
    const outQ = new Float64Array(ss.length), outV = new Float64Array(ss.length), outA = new Float64Array(ss.length);
    for (let k = 0; k < ss.length; k++) {
      const r = this.at(this.interval(ss[k]), ss[k]);
      outQ[k] = r[0]; outV[k] = r[1]; outA[k] = r[2];
    }
    return { q: outQ, v: outV, a: outA };
  }

  /**
   * Samples for drawing: `per` steps across every knot interval with both ends included, so
   * that the corner of a path of straight segments shows as a jump in its slope.
   */
  trace(per = 24) {
    const n = this.q.length, N = (n - 1) * (per + 1);
    const s = new Float64Array(N), q = new Float64Array(N), v = new Float64Array(N);
    let j = 0;
    for (let i = 0; i < n - 1; i++) {
      for (let u = 0; u <= per; u++) {
        const x = this.s[i] + ((this.s[i + 1] - this.s[i]) * u) / per, r = this.at(i, x);
        s[j] = x; q[j] = r[0]; v[j] = r[1]; j++;
      }
    }
    return { s, q, v };
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

const GX = [-Math.sqrt(0.6), 0, Math.sqrt(0.6)], GW = [5 / 9, 8 / 9, 5 / 9];

/**
 * Sample points for the action of a path with knots at ss (in increasing order, not
 * necessarily evenly spaced): three-point Gauss-Legendre on equal cells inside each knot
 * interval, about `count` points in all.  Every interval gets the same number of cells, so the
 * corners of a path of straight segments fall on cell edges, and the action changes smoothly
 * as a knot moves in time.  singularStart: s = s[0] + h u^2 in the first interval (see
 * quadrature).  Returns {s, w}.
 */
export function knotQuadrature(ss, count = 600, singularStart = false) {
  const n = ss.length, cells = Math.max(2, Math.ceil(count / (3 * (n - 1))));
  const N = 3 * cells * (n - 1), s = new Float64Array(N), w = new Float64Array(N);
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    const a = ss[i], h = ss[i + 1] - a;
    for (let c = 0; c < cells; c++) {
      for (let g = 0; g < 3; g++) {
        const u = (c + 0.5 + 0.5 * GX[g]) / cells, du = (0.5 * GW[g]) / cells;
        if (singularStart && i === 0) { s[j] = a + h * u * u; w[j] = 2 * h * u * du; }
        else { s[j] = a + h * u; w[j] = h * du; }
        j++;
      }
    }
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

// ----------------------------------------------------------- derivatives of L

const EPS = 1e-5, EPS2 = 1e-4;

function shifted(arr, d) { const out = new Float64Array(arr.length); for (let i = 0; i < arr.length; i++) out[i] = arr[i] + d * (1 + Math.abs(arr[i])); return out; }
function step(arr, eps = EPS) { const out = new Float64Array(arr.length); for (let i = 0; i < arr.length; i++) out[i] = eps * (1 + Math.abs(arr[i])); return out; }

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

/**
 * L_q, L_v and the second derivatives L_qq, L_qv, L_vv at many points, by central differences
 * (unless the system gives them: the brachistochrone's L is singular at its start).
 */
function lagrangianDerivatives(system, q, v, s) {
  if (system.derivatives) return system.derivatives(q, v, s);
  const n = q.length, L = system.L;
  const add = (arr, d, sgn) => { const o = new Float64Array(n); for (let i = 0; i < n; i++) o[i] = arr[i] + sgn * d[i]; return o; };
  const dq = step(q), dv = step(v), Dq = step(q, EPS2), Dv = step(v, EPS2);
  const a = L(add(q, dq, 1), v, s), b = L(add(q, dq, -1), v, s), c = L(q, add(v, dv, 1), s), d = L(q, add(v, dv, -1), s);
  const qp = add(q, Dq, 1), qm = add(q, Dq, -1), vp = add(v, Dv, 1), vm = add(v, Dv, -1);
  const L0 = L(q, v, s), Lqp = L(qp, v, s), Lqm = L(qm, v, s), Lvp = L(q, vp, s), Lvm = L(q, vm, s);
  const Lpp = L(qp, vp, s), Lpm = L(qp, vm, s), Lmp = L(qm, vp, s), Lmm = L(qm, vm, s);
  const out = { Lq: new Float64Array(n), Lv: new Float64Array(n), Lqq: new Float64Array(n), Lqv: new Float64Array(n), Lvv: new Float64Array(n) };
  for (let i = 0; i < n; i++) {
    out.Lq[i] = (a[i] - b[i]) / (2 * dq[i]);
    out.Lv[i] = (c[i] - d[i]) / (2 * dv[i]);
    out.Lqq[i] = (Lqp[i] - 2 * L0[i] + Lqm[i]) / (Dq[i] * Dq[i]);
    out.Lvv[i] = (Lvp[i] - 2 * L0[i] + Lvm[i]) / (Dv[i] * Dv[i]);
    out.Lqv[i] = (Lpp[i] - Lpm[i] - Lmp[i] + Lmm[i]) / (4 * Dq[i] * Dv[i]);
  }
  return out;
}

// --------------------------------------------------------------- true paths

/**
 * Integrate the Euler-Lagrange equation from (s0, q0) with initial slopes v0[] (all at once),
 * by RK4 in `steps` steps; q0 is one number or one per slope.  Returns {q: Float64Array[] per
 * step, v: ...} as arrays over the slopes, or just the end values when record is false.
 */
function shootAll(system, s0, s1, q0, v0, steps, record = false) {
  const n = v0.length, h = (s1 - s0) / steps;
  let q = typeof q0 === 'number' ? new Float64Array(n).fill(q0) : Float64Array.from(q0), v = Float64Array.from(v0);
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
 * The closed orbits of period s1 - s0 (or a fraction of it) in a potential well: paths with
 * q(s1) = q(s0) and the same momentum at both ends, closed loops in phase space.  For L that
 * does not depend on s and is quadratic in v.  Found by shooting from rest at a turning point
 * A: the motion is at rest again after half the trip exactly when that is a whole number of
 * half periods, so the roots in A of v(s0 + T/2) are the orbits.  Each is then started at q0,
 * both ways, if its swing reaches q0, and otherwise at its turning point nearest q0.  Staying
 * at rest (at the bottom or the top) is not counted.  Returns [{s, q, v, S, v0, closed, swing}],
 * sorted by action, moving forwards first.
 */
export function closedOrbits(system, s0, q0, s1, { qrange = [-4, 4], scan = 241, steps = 400 } = {}) {
  steps += steps % 2;
  const T = s1 - s0, [lo, hi] = qrange;
  const A = Float64Array.from({ length: scan }, (_, i) => lo + ((hi - lo) * i) / (scan - 1));
  const half = (a, n = steps >> 1, record = false) => shootAll(system, s0, s0 + T / 2, a, new Float64Array(a.length), n, record);
  const end = half(A, steps >> 2).v;
  const roots = [];
  for (let i = 0; i + 1 < scan; i++) {
    const a = end[i], b = end[i + 1];
    if (!Number.isFinite(a) || !Number.isFinite(b) || !(a * b < 0)) continue;
    let l = A[i], h = A[i + 1], fl = a;
    for (let it = 0; it < 50; it++) {
      const mid = (l + h) / 2, f = half([mid]).v[0];
      if (!Number.isFinite(f)) break;
      if ((f < 0) === (fl < 0)) { l = mid; fl = f; } else h = mid;
    }
    roots.push((l + h) / 2);
  }
  const at = (q, v) => system.L(Float64Array.of(q), Float64Array.of(v), Float64Array.of(s0))[0];
  const out = [];
  for (const a of roots) {
    // The swing: from a to the other turning point and back.
    const tr = half([a], steps, true), xs = tr.qs.map((x) => x[0]);
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    if (!(xmax - xmin > 1e-6)) continue;
    // Its energy, and the speed it has at q0: E = -L(a, 0) = m v^2/2 - L(q0, 0).
    const E = -at(a, 0), m = at(q0, 1) + at(q0, -1) - 2 * at(q0, 0);
    const inside = q0 > xmin && q0 < xmax, speed = inside ? Math.sqrt(Math.max(0, (2 * (E + at(q0, 0))) / m)) : 0;
    const starts = inside ? [[q0, speed], [q0, -speed]] : [[Math.abs(q0 - xmax) < Math.abs(q0 - xmin) ? xmax : xmin, 0]];
    for (const [x0, v0] of starts) {
      const run = shootAll(system, s0, s1, x0, [v0], steps, true);
      const q = Float64Array.from(run.qs, (x) => x[0]), v = Float64Array.from(run.vs, (x) => x[0]);
      const span = xmax - xmin, n = q.length - 1;
      if (!(Math.abs(q[n] - x0) < 1e-4 * span && Math.abs(v[n] - v0) < 1e-3 * (span + Math.abs(v0)))) continue;
      const s = Float64Array.from(q, (_, j) => s0 + (T * j) / steps), L = system.L(q, v, s), h = T / steps;
      let S = L[0] + L[steps];
      for (let j = 1; j < steps; j++) S += (j % 2 ? 4 : 2) * L[j];
      S *= h / 3;
      if (out.some((o) => Math.abs(o.v0 - v0) < 1e-6 * (1 + Math.abs(v0)) && Math.abs(o.q[0] - x0) < 1e-9 && Math.abs(o.S - S) < 1e-6 * (1 + Math.abs(S)))) continue;
      out.push({ v0, s, q, v, S, closed: true, swing: [xmin, xmax], through: inside || Math.abs(q0 - x0) < 1e-9 });
    }
  }
  return out.sort((a, b) => (Math.abs(a.S - b.S) > 1e-6 * (1 + Math.abs(a.S)) ? a.S - b.S : b.v0 - a.v0));
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

/** A true path's position at the points ss: cubic Hermite between its samples (which carry slopes). */
export function truthAt(t, ss) {
  const out = new Float64Array(ss.length), n = t.s.length;
  for (let k = 0; k < ss.length; k++) {
    const x = ss[k];
    let lo = 0, hi = n - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (t.s[mid] <= x) lo = mid; else hi = mid - 1; }
    const h = t.s[lo + 1] - t.s[lo], u = (x - t.s[lo]) / h, q0 = t.q[lo], q1 = t.q[lo + 1], v0 = t.v[lo], v1 = t.v[lo + 1];
    if (!Number.isFinite(v0) || !Number.isFinite(v1)) { out[k] = q0 + (q1 - q0) * u; continue; }
    const u2 = u * u, u3 = u2 * u;
    out[k] = (2 * u3 - 3 * u2 + 1) * q0 + (u3 - 2 * u2 + u) * h * v0 + (3 * u2 - 2 * u3) * q1 + (u3 - u2) * h * v1;
  }
  return out;
}

// ------------------------------------------------- the action as a function of the knots

/** The knots whose values vary: the interior ones, and the shared end of a periodic path. */
export function freeKnots(path) {
  const n = path.q.length, out = path.periodic ? [0] : [];
  for (let k = 1; k < n - 1; k++) out.push(k);
  return out;
}

/**
 * The gradient of the action with respect to the knot values (at fixed knot times), and its
 * Hessian.  A path is linear in its knot values, q(s) = sum_k B_k(s) q_k (a spline as much as
 * straight segments), so with L_q, L_v, ... at the quadrature points,
 *     dS/dq_k = sum_j w_j (L_q B_k + L_v B_k'),
 *     d2S/dq_k dq_l = sum_j w_j (L_qq B_k B_l + L_qv (B_k B_l' + B_k' B_l) + L_vv B_k' B_l').
 * free: the knots that vary (index 0 of a periodic path moves both ends).
 * Returns {g, H, free} with g and H over the free knots.
 */
export function knotDerivatives(system, path, quad, free = freeKnots(path), hessian = true) {
  const n = path.q.length, m = free.length, N = quad.s.length, w = quad.w;
  const smp = path.sample(quad.s);
  const D = lagrangianDerivatives(system, smp.q, smp.v, quad.s);
  const B = free.map((k) => {
    const e = new Float64Array(n); e[k] = 1;
    return path.withKnots(e).sample(quad.s);
  });
  const g = new Float64Array(m);
  for (let a = 0; a < m; a++) {
    let sum = 0;
    for (let j = 0; j < N; j++) sum += w[j] * (D.Lq[j] * B[a].q[j] + D.Lv[j] * B[a].v[j]);
    g[a] = sum;
  }
  let H = null;
  if (hessian) {
    H = Array.from({ length: m }, () => new Float64Array(m));
    for (let a = 0; a < m; a++) {
      for (let b = a; b < m; b++) {
        const Ba = B[a], Bb = B[b];
        let sum = 0;
        for (let j = 0; j < N; j++) {
          sum += w[j] * (D.Lqq[j] * Ba.q[j] * Bb.q[j] + D.Lqv[j] * (Ba.q[j] * Bb.v[j] + Ba.v[j] * Bb.q[j]) + D.Lvv[j] * Ba.v[j] * Bb.v[j]);
        }
        H[a][b] = H[b][a] = sum;
      }
    }
  }
  return { g, H, free };
}

/**
 * dS/dq_k for every knot: which way to move each knot up or down to lower the action
 * fastest.  Zero at fixed ends; a periodic path's shared end gets its value at both ends.
 */
export function knotGradient(system, path, quad) {
  const n = path.q.length, out = new Float64Array(n), d = knotDerivatives(system, path, quad, freeKnots(path), false);
  d.free.forEach((k, a) => { out[k] = d.g[a]; if (path.periodic && k === 0) out[n - 1] = d.g[a]; });
  return out;
}

/**
 * The derivative and curvature of the action with respect to the time (s) of each interior
 * knot: what reaching knot k earlier or later does, the knot staying at the same height.  By
 * central differences, the quadrature moving with the knots.  For straight segments and
 * L = T - V it is the jump in energy at the knot, E(after) - E(before) (with V averaged over
 * each segment): moving a knot in time trades speed before it for speed after it, and S is
 * stationary in the knot times when the energy does not jump.  Returns {g, c} (zero at the ends).
 */
export function knotTimeDerivatives(system, path, { count = 600, singularStart = false } = {}) {
  const n = path.q.length, g = new Float64Array(n), c = new Float64Array(n);
  const S = (ss) => action(system, path.withTimes(ss), knotQuadrature(ss, count, singularStart)).S;
  const S0 = S(path.s);
  for (let k = 1; k < n - 1; k++) {
    const e = 1e-4 * Math.min(path.s[k] - path.s[k - 1], path.s[k + 1] - path.s[k]);
    const up = Float64Array.from(path.s), dn = Float64Array.from(path.s);
    up[k] += e; dn[k] -= e;
    const Sp = S(up), Sm = S(dn);
    g[k] = (Sp - Sm) / (2 * e);
    c[k] = (Sp - 2 * S0 + Sm) / (e * e);
  }
  return { g, c };
}

/** Eigenvalues and eigenvectors of a small symmetric matrix (rows), by Jacobi rotations. */
export function symmetricEigen(A) {
  const n = A.length, a = A.map((r) => Float64Array.from(r));
  const V = Array.from({ length: n }, (_, i) => { const r = new Float64Array(n); r[i] = 1; return r; });
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0, diag = 0;
    for (let i = 0; i < n; i++) { diag += a[i][i] * a[i][i]; for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j]; }
    if (!(off > 1e-26 * diag)) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p][q];
        if (apq === 0) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * apq);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
        for (let k = 0; k < n; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
        for (let k = 0; k < n; k++) { const x = V[k][p], y = V[k][q]; V[k][p] = c * x - s * y; V[k][q] = s * x + c * y; }
      }
    }
  }
  return { values: Array.from(a, (r, i) => r[i]), vectors: Array.from({ length: n }, (_, i) => Float64Array.from(V, (r) => r[i])) };
}

/** The number of directions in which S curves down: negative eigenvalues of a knot Hessian. */
export function negativeDirections(H, rel = 1e-6) {
  if (!H.length) return 0;
  const { values } = symmetricEigen(H), big = Math.max(...values.map(Math.abs));
  return values.filter((x) => x < -rel * big).length;
}

/**
 * Move the knot values (at fixed knot times) to where the action of the path, as drawn through
 * them, is stationary: Newton's method from a path close by (the true path's own values at the
 * knots).  It finds saddles as readily as minima.  Directions in which S is flat are left
 * alone.  free: the knots that may move (default: all but fixed ends).  Returns {path, index,
 * gradient}: the new path, the number of directions in which S decreases from it, and |dS/dq|.
 */
export function stationaryKnots(system, path, { count = 600, singularStart = false, free = freeKnots(path), iterations = 10 } = {}) {
  const quad = knotQuadrature(path.s, count, singularStart);
  let p = path, cur = knotDerivatives(system, p, quad, free);
  const norm = (g) => Math.sqrt(g.reduce((a, x) => a + x * x, 0));
  let size = norm(cur.g);
  for (let it = 0; it < iterations && free.length && size > 1e-12; it++) {
    const { values, vectors } = symmetricEigen(cur.H), big = Math.max(...values.map(Math.abs));
    const dq = new Float64Array(free.length);
    values.forEach((lam, i) => {
      if (!(Math.abs(lam) > 1e-8 * big)) return;
      let dot = 0;
      for (let a = 0; a < free.length; a++) dot += vectors[i][a] * cur.g[a];
      for (let a = 0; a < free.length; a++) dq[a] -= (dot / lam) * vectors[i][a];
    });
    let accepted = false;
    for (let alpha = 1; alpha > 1e-3; alpha /= 2) {
      const q = Float64Array.from(p.q);
      free.forEach((k, a) => { q[k] += alpha * dq[a]; });
      const trial = p.withKnots(q), d = knotDerivatives(system, trial, quad, free), ns = norm(d.g);
      if (Number.isFinite(ns) && ns < size) { p = trial; cur = d; size = ns; accepted = true; break; }
    }
    if (!accepted) break;
  }
  return { path: p, index: Number.isFinite(size) && free.length ? negativeDirections(cur.H) : 0, gradient: size };
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
