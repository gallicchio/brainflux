// A classical ensemble flowing through phase space under H(x, p) = p^2 / 2m + V(x): each point
// follows Hamilton's equations, dx/dt = p/m, dp/dt = -V'(x), integrated by the leapfrog
// (Stormer-Verlet) method.  Leapfrog is symplectic: it keeps phase-space areas exactly, and
// its energy error stays bounded (of order (omega h)^2) instead of drifting, however long it
// runs.  It is also time-reversible and second-order accurate.
//
// The force comes from a table of V'(x), made once from the typed potential on a fine grid and
// interpolated linearly: thousands of points cost a few table lookups each per step.

/**
 * V(x) and its force -V'(x) tabulated on [xmin, xmax] (M points).  Vfun(xs) evaluates V on a
 * Float64Array.  The derivative is a central difference of V itself (step 1e-4 of the span).
 */
export class PotentialTable {
  constructor(Vfun, xmin, xmax, M = 8192) {
    this.xmin = xmin; this.xmax = xmax; this.M = M;
    this.dx = (xmax - xmin) / (M - 1);
    const xs = new Float64Array(M), xp = new Float64Array(M), xm = new Float64Array(M);
    const d = 1e-4 * Math.max(1e-3, Math.min(1, xmax - xmin));
    for (let i = 0; i < M; i++) { xs[i] = xmin + i * this.dx; xp[i] = xs[i] + d; xm[i] = xs[i] - d; }
    const clean = (v) => (Number.isFinite(v) ? Math.max(-1e6, Math.min(1e6, v)) : Number.isNaN(v) ? 0 : Math.sign(v) * 1e6);
    const V = Vfun(xs), Vp = Vfun(xp), Vm = Vfun(xm);
    this.V = new Float64Array(M); this.F = new Float64Array(M);
    for (let i = 0; i < M; i++) {
      this.V[i] = clean(V[i]);
      const f = -(clean(Vp[i]) - clean(Vm[i])) / (2 * d);
      this.F[i] = Number.isFinite(f) ? Math.max(-1e7, Math.min(1e7, f)) : 0;
    }
  }

  /** -V'(x), interpolated (zero beyond the table: free motion there). */
  force(x) {
    const f = (x - this.xmin) / this.dx, i = Math.floor(f);
    if (i < 0 || i >= this.M - 1) return 0;
    const t = f - i;
    return this.F[i] + t * (this.F[i + 1] - this.F[i]);
  }

  /** V(x) by cubic Hermite interpolation (with V' = -F at the nodes). */
  potential(x) {
    let f = (x - this.xmin) / this.dx, i = Math.floor(f);
    if (i < 0) { i = 0; f = 0; }
    if (i >= this.M - 1) { i = this.M - 2; f = this.M - 1; }
    const t = f - i, t2 = t * t, t3 = t2 * t, h = this.dx;
    return (2 * t3 - 3 * t2 + 1) * this.V[i] + (t3 - 2 * t2 + t) * h * -this.F[i]
      + (-2 * t3 + 3 * t2) * this.V[i + 1] + (t3 - t2) * h * -this.F[i + 1];
  }
}

export class Ensemble {
  constructor(N = 0) { this.resize(N); }

  resize(N) {
    this.N = N;
    this.x = new Float64Array(N); this.p = new Float64Array(N);
    this.f = new Float64Array(N);       // the force at x, kept between steps
    this.fresh = false;
  }

  /** Put the points at (xs[i], ps[i]). */
  set(xs, ps) {
    if (xs.length !== this.N) this.resize(xs.length);
    this.x.set(xs); this.p.set(ps);
    this.fresh = false;
  }

  /**
   * Advance every point by `steps` leapfrog steps of length h (h < 0 runs backwards):
   *     p += F(x) h/2;  x += (p/m) h;  p += F(x) h/2.
   * walls: [lo, hi] reflect points elastically (the box the wave function lives in), or null.
   */
  step(table, h, steps = 1, mass = 1, walls = null) {
    const { x, p, f, N } = this, half = h / 2, hm = h / mass;
    if (!this.fresh) { for (let i = 0; i < N; i++) f[i] = table.force(x[i]); this.fresh = true; }
    const lo = walls ? walls[0] : -Infinity, hi = walls ? walls[1] : Infinity;
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < N; i++) {
        let pi = p[i] + f[i] * half, xi = x[i] + pi * hm;
        if (xi < lo) { xi = 2 * lo - xi; pi = -pi; } else if (xi > hi) { xi = 2 * hi - xi; pi = -pi; }
        const fi = table.force(xi);
        p[i] = pi + fi * half; x[i] = xi; f[i] = fi;
      }
    }
  }

  /** Means, standard deviations and the mean energy of the points. */
  stats(table, mass = 1) {
    const { x, p, N } = this;
    let sx = 0, sp = 0, sxx = 0, spp = 0, sxp = 0, se = 0;
    for (let i = 0; i < N; i++) {
      sx += x[i]; sp += p[i]; sxx += x[i] * x[i]; spp += p[i] * p[i]; sxp += x[i] * p[i];
      se += (p[i] * p[i]) / (2 * mass) + table.potential(x[i]);
    }
    const mx = sx / N, mp = sp / N;
    return {
      x: mx, p: mp,
      sx: Math.sqrt(Math.max(0, sxx / N - mx * mx)), sp: Math.sqrt(Math.max(0, spp / N - mp * mp)),
      cxp: sxp / N - mx * mp, E: se / N,
    };
  }
}

/**
 * N samples of a 1D density given at u_i = u0 + i du (any normalisation), each uniform within
 * its cell.  rng() is uniform on [0, 1).  Used to draw x from |psi(x)|^2 and p from |phi(p)|^2
 * independently: a positive stand-in for W with exactly the right marginals (and so exactly
 * the right mean energy, H being a function of x plus a function of p), but none of W's
 * correlations between x and p.
 */
export function sampleDensity(density, u0, du, N, rng, out = new Float64Array(N)) {
  const n = density.length, cdf = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += Math.max(0, density[i]); cdf[i] = acc; }
  if (!(acc > 0)) return null;
  for (let s = 0; s < N; s++) {
    const u = rng() * acc;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < u) lo = mid + 1; else hi = mid; }
    out[s] = u0 + (lo + rng() - 0.5) * du;
  }
  return out;
}
