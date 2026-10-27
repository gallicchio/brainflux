// The time-dependent Schrödinger equation in one dimension,
//
//     i hbar dpsi/dt = -(hbar^2 / 2m) d^2psi/dx^2 + V(x, t) psi,      with hbar = 1,
//
// solved by the split-operator (Strang) method.  One step of length h is
//
//     psi -> exp(-i V h/2) . F^-1 exp(-i k^2 h / 2m) F . exp(-i V h/2) psi
//
// where F is the Fourier transform: the potential is applied where it is diagonal (position
// space) and the kinetic energy where it is diagonal (momentum space).  Every factor is a pure
// phase, so the norm is conserved to round-off whatever h is; the kinetic step is exact (no
// finite-difference dispersion: a packet with momentum k moves at k/m), and the error per step
// is O(h^3), from the commutator of T and V.
//
// Boundaries:
//   'walls'      psi = 0 at both ends (an infinite square well around the domain).  Done by
//                running on the odd extension of psi to twice the length, which the periodic
//                Fourier transform keeps odd: the same as a sine transform.
//   'periodic'   the ends are joined (a particle on a ring).
//   'absorbing'  periodic, plus a smooth absorbing layer near each end that removes whatever
//                reaches it, so scattered packets leave cleanly.

import { fft, ifft, wavenumbers } from '../lib/fft.js';

export class Sim1D {
  /**
   * n points on [xmin, xmax] (n a power of two), particle mass m, boundary as above.
   */
  constructor({ n = 1024, xmin = -10, xmax = 10, mass = 1, boundary = 'walls' } = {}) {
    this.n = n;
    this.xmin = xmin;
    this.xmax = xmax;
    this.mass = mass;
    this.boundary = boundary;
    this.L = xmax - xmin;
    this.dx = this.L / n;
    // Grid points.  With walls, x[0] = xmin is the wall (psi = 0) and the other wall at xmax is
    // the point x[n] of the extension.
    this.x = new Float64Array(n);
    for (let j = 0; j < n; j++) this.x[j] = xmin + j * this.dx;
    this.M = boundary === 'walls' ? 2 * n : n;     // length of the working arrays
    this.re = new Float64Array(this.M);
    this.im = new Float64Array(this.M);
    this.V = new Float64Array(n);
    this.k = wavenumbers(this.M, this.dx);
    this.t = 0;
    this.absorbed = 0;                              // probability removed by the absorbing layer
    this.absorbedLeft = 0;                          // ... of which at the left end
    this.h = 0;                                     // the step the phase tables were made for
    this._mask = null;
    this.absorbSpeed = 4;                           // the fastest speed the absorber must stop
    // Scratch for observables.
    this._pr = new Float64Array(this.M);
    this._pi = new Float64Array(this.M);
  }

  // ------------------------------------------------------------------- the state

  /** Set psi from arrays of length n (not normalised here). */
  setPsi(re, im) {
    const n = this.n;
    for (let j = 0; j < n; j++) { this.re[j] = re[j]; this.im[j] = im ? im[j] : 0; }
    if (this.boundary === 'walls') {
      this.re[0] = 0; this.im[0] = 0;
      this.re[n] = 0; this.im[n] = 0;
      for (let j = 1; j < n; j++) { this.re[2 * n - j] = -this.re[j]; this.im[2 * n - j] = -this.im[j]; }
    }
    this.t = 0;
    this.absorbed = 0;
    this.absorbedLeft = 0;
  }

  /** Probability in the domain: sum |psi|^2 dx. */
  norm() {
    let s = 0;
    for (let j = 0; j < this.n; j++) s += this.re[j] ** 2 + this.im[j] ** 2;
    return s * this.dx;
  }

  normalize() {
    const s = Math.sqrt(this.norm());
    if (!(s > 0)) return false;
    for (let j = 0; j < this.M; j++) { this.re[j] /= s; this.im[j] /= s; }
    this.absorbed = 0;
    this.absorbedLeft = 0;
    return true;
  }

  /**
   * Set V(x).  A potential prepared by prepareSharpPotential says how short a time step its
   * sharpest features need (found by experiment: at 1.7 times that, energy drifts upwards).
   */
  setPotential(V) {
    this.V.set(V);
    this.sharpStep = V.jumps ? this.mass * V.step : Infinity;
    this.h = 0; // phase tables are stale
  }

  // --------------------------------------------------------------- time stepping

  _tables(h) {
    const M = this.M, n = this.n;
    if (!this._kc || this._kc.length !== M) {
      this._kc = new Float64Array(M); this._ks = new Float64Array(M);
      this._vc = new Float64Array(M); this._vs = new Float64Array(M);
    }
    for (let i = 0; i < M; i++) {
      const a = (-this.k[i] * this.k[i] * h) / (2 * this.mass);
      this._kc[i] = Math.cos(a); this._ks[i] = Math.sin(a);
    }
    this._potentialTables(h);
    if (this.boundary === 'absorbing') {
      // A layer 1/8 of the domain wide at each end, absorbing at a rate gamma(d) = A d^3 at
      // depth d (0 to 1) into it.  A wave of speed v crossing in and back out is attenuated by
      // exp(-2 A W / 4v) for a layer of width W: A = 24 v / W makes that e^-12.  The rate rises
      // gently from zero, so slower waves are not reflected by the layer's edge.
      const width = Math.max(8, Math.round(n / 8)), W = width * this.dx;
      const A = (24 * this.absorbSpeed) / W;
      this._mask = new Float64Array(n);
      for (let j = 0; j < n; j++) {
        const d = Math.max(0, width - j, j - (n - 1 - width)) / width;
        this._mask[j] = Math.exp(-A * d * d * d * Math.abs(h));
      }
    } else this._mask = null;
    this.h = h;
  }

  _potentialTables(h) {
    const M = this.M, n = this.n, V = this.V;
    for (let i = 0; i < M; i++) {
      // The walls' extension mirrors the potential: V(2n - j) = V(j).
      const v = i < n ? V[i] : V[2 * n - i] ?? 0;
      const a = (-v * h) / 2;
      this._vc[i] = Math.cos(a); this._vs[i] = Math.sin(a);
    }
  }

  _applyV(times = 1) {
    // times = 1: exp(-i V h/2); times = 2: exp(-i V h).
    const { re, im, _vc: c, _vs: s } = this;
    if (times === 1) {
      for (let i = 0; i < this.M; i++) {
        const r = re[i] * c[i] - im[i] * s[i];
        im[i] = re[i] * s[i] + im[i] * c[i]; re[i] = r;
      }
    } else {
      for (let i = 0; i < this.M; i++) {
        const c2 = c[i] * c[i] - s[i] * s[i], s2 = 2 * c[i] * s[i];
        const r = re[i] * c2 - im[i] * s2;
        im[i] = re[i] * s2 + im[i] * c2; re[i] = r;
      }
    }
  }

  _applyT() {
    const { re, im, _kc: c, _ks: s } = this;
    fft(re, im);
    for (let i = 0; i < this.M; i++) {
      const r = re[i] * c[i] - im[i] * s[i];
      im[i] = re[i] * s[i] + im[i] * c[i]; re[i] = r;
    }
    ifft(re, im);
  }

  /**
   * The largest step (dt0, dt0/2, dt0/4, ...) that conserves energy over a short trial run, to
   * `tol` of the kinetic energy.  The trial runs on a copy of the state, with the absorbing
   * layer off, and the state is put back afterwards.  Splitting T and V is accurate when the
   * step resolves the kinetic energy of the shortest waves the potential's sharpest features
   * excite (dt of order 2 m delta^2 for a feature of width delta); rather than guess the
   * features of a typed potential, measure.
   */
  calibrateStep(dt0, { steps = 60, tol = 0.01 } = {}) {
    const keep = { re: this.re.slice(), im: this.im.slice(), t: this.t, a: this.absorbed, al: this.absorbedLeft };
    const restore = () => {
      this.re.set(keep.re); this.im.set(keep.im);
      this.t = keep.t; this.absorbed = keep.a; this.absorbedLeft = keep.al;
    };
    const o = this.observables();
    if (!(o.norm > 1e-6)) return dt0;
    const E0 = o.E, scale = Math.max(0.25, o.T);
    const boundary = this.boundary;
    if (boundary === 'absorbing') this.boundary = 'periodic';
    let dt = dt0;
    for (let attempt = 0; attempt < 10; attempt++) {
      this.h = 0;
      this.step(dt, steps);
      const drift = Math.abs(this.observables().E - E0);
      restore();
      if (drift < tol * scale) break;
      dt /= 2;
    }
    this.boundary = boundary;
    this.h = 0;
    return dt;
  }

  _absorb() {
    const m = this._mask, { re, im } = this, half = this.n / 2;
    let lost = 0, lostLeft = 0;
    for (let j = 0; j < this.n; j++) {
      if (m[j] === 1) continue;
      const before = re[j] * re[j] + im[j] * im[j];
      re[j] *= m[j]; im[j] *= m[j];
      const d = before - (re[j] * re[j] + im[j] * im[j]);
      lost += d;
      if (j < half) lostLeft += d;
    }
    this.absorbed += lost * this.dx;
    this.absorbedLeft += lostLeft * this.dx;
  }

  /**
   * Advance by `steps` steps of length h (h < 0 runs backwards in time).  potentialAt(t), if
   * given, returns V(x, t) as an array for a time-dependent potential.
   */
  step(h, steps = 1, potentialAt = null) {
    if (steps < 1) return;
    if (potentialAt) {
      // V changes: no merging of half steps.  V is sampled at the middle of each step.
      if (h !== this.h) this._tables(h);
      for (let s = 0; s < steps; s++) {
        this.V.set(potentialAt(this.t + h / 2));
        this._potentialTables(h);
        this._applyV(1);
        this._applyT();
        this._applyV(1);
        if (this._mask) this._absorb();
        this.t += h;
      }
      return;
    }
    if (h !== this.h) this._tables(h);
    if (this._mask) {
      // The absorber sits between whole steps, so the half steps can't be merged.
      for (let s = 0; s < steps; s++) {
        this._applyV(1); this._applyT(); this._applyV(1); this._absorb();
        this.t += h;
      }
      return;
    }
    // V/2, then (T, V) repeated with the two halves of V merged, ending with V/2.
    this._applyV(1);
    for (let s = 0; s < steps; s++) {
      this._applyT();
      this._applyV(s === steps - 1 ? 1 : 2);
    }
    this.t += h * steps;
  }

  // ----------------------------------------------------------------- observables

  /**
   * <x>, <x^2>, <p>, <p^2>, <T>, <V>, norm.  Momenta from the Fourier transform: for walls,
   * the kinetic energy uses the odd extension (the box's own kinetic operator) and the momentum
   * distribution uses psi padded with zeros (the particle is nowhere outside the box).
   */
  observables() {
    const n = this.n, dx = this.dx, x = this.x, V = this.V;
    let N = 0, X = 0, X2 = 0, Vm = 0;
    for (let j = 0; j < n; j++) {
      const p = this.re[j] ** 2 + this.im[j] ** 2;
      N += p; X += p * x[j]; X2 += p * x[j] * x[j]; Vm += p * V[j];
    }
    N *= dx; X *= dx; X2 *= dx; Vm *= dx;
    // <T> = sum (k^2/2m) |F_k|^2 / sum |F_k|^2 over the working arrays (odd extension for walls).
    const pr = this._pr, pi = this._pi;
    pr.set(this.re); pi.set(this.im);
    fft(pr, pi);
    let S = 0, K = 0;
    for (let i = 0; i < this.M; i++) {
      const w = pr[i] ** 2 + pi[i] ** 2;
      S += w; K += w * this.k[i] * this.k[i];
    }
    const T = S > 0 ? K / S / (2 * this.mass) : 0;
    const { P, P2 } = this.momentumMoments();
    const Vavg = N > 0 ? Vm / N : 0;
    return {
      norm: N,
      x: N > 0 ? X / N : 0,
      sx: N > 0 ? Math.sqrt(Math.max(0, X2 / N - (X / N) ** 2)) : 0,
      p: P,
      sp: Math.sqrt(Math.max(0, P2 - P * P)),
      T, V: Vavg, E: T + Vavg,
    };
  }

  /**
   * The momentum-space wave function phi(p), centred (p = 0 in the middle), on a grid of
   * spacing dp, scaled so that sum |phi|^2 dp = sum |psi|^2 dx.  Returns {re, im, p, dp}.
   */
  momentum() {
    // Padded with zeros to at least 8 times the length: finer steps in p (sinc interpolation)
    // for drawing.
    const n = this.n, P = Math.max(this.boundary === 'walls' ? 2 * n : n, Math.min(32768, 8 * n));
    const re = new Float64Array(P), im = new Float64Array(P);
    for (let j = 0; j < n; j++) { re[j] = this.re[j]; im[j] = this.im[j]; }
    // The phase convention: psi(x) = sum phi(p) exp(i p x); shifting the origin to x[0] = xmin
    // only multiplies phi by a phase exp(-i p xmin), applied below so phases are meaningful.
    fft(re, im);
    const dp = (2 * Math.PI) / (P * this.dx);
    const outRe = new Float64Array(P), outIm = new Float64Array(P), p = new Float64Array(P);
    // phi(p) = (2 pi)^-1/2 integral psi(x) exp(-i p x) dx = dx (2 pi)^-1/2 exp(-i p xmin) F[psi],
    // which makes sum |phi|^2 dp = sum |psi|^2 dx.
    const s = this.dx / Math.sqrt(2 * Math.PI);
    for (let i = 0; i < P; i++) {
      const src = (i + P / 2) % P;
      const pv = (i - P / 2) * dp;
      const a = -pv * this.xmin, c = Math.cos(a), sn = Math.sin(a);
      outRe[i] = s * (re[src] * c - im[src] * sn);
      outIm[i] = s * (re[src] * sn + im[src] * c);
      p[i] = pv;
    }
    return { re: outRe, im: outIm, p, dp };
  }

  momentumMoments() {
    const { re, im, p } = this.momentum();
    let S = 0, P1 = 0, P2 = 0;
    for (let i = 0; i < p.length; i++) {
      const w = re[i] ** 2 + im[i] ** 2;
      S += w; P1 += w * p[i]; P2 += w * p[i] * p[i];
    }
    return S > 0 ? { P: P1 / S, P2: P2 / S } : { P: 0, P2: 0 };
  }

  /** Probability current j(x) = (hbar/m) Im(psi* dpsi/dx), by central differences. */
  current(out = new Float64Array(this.n)) {
    const n = this.n, { re, im } = this, inv = 1 / (2 * this.dx * this.mass);
    const wrapEnds = this.boundary !== 'walls';
    for (let j = 0; j < n; j++) {
      const a = j === 0 ? (wrapEnds ? n - 1 : -1) : j - 1;
      const b = j === n - 1 ? (wrapEnds ? 0 : -1) : j + 1;
      const dre = (b >= 0 ? re[b] : 0) - (a >= 0 ? re[a] : 0);
      const dim = (b >= 0 ? im[b] : 0) - (a >= 0 ? im[a] : 0);
      out[j] = (re[j] * dim - im[j] * dre) * inv;
    }
    return out;
  }

  /**
   * A time step for the potential where the wave function actually is.  The splitting error
   * comes from V - E acting where psi is not small (a constant in V only turns the global
   * phase), so walls a thousand units high where psi is zero cost nothing.  The step keeps
   * |V - <E>| dt below a third of a radian wherever |psi|^2 exceeds 1e-9 of its peak.
   */
  suggestedStep(E) {
    const { re, im, V, n } = this;
    let peak = 0;
    for (let j = 0; j < n; j++) peak = Math.max(peak, re[j] * re[j] + im[j] * im[j]);
    const thr = peak * 1e-9;
    let scale = 0.5;
    for (let j = 0; j < n; j++) if (re[j] * re[j] + im[j] * im[j] > thr) scale = Math.max(scale, Math.abs(V[j] - E));
    return Math.min(0.02, 0.33 / scale, this.sharpStep ?? Infinity);
  }

  /** Probability to the left of x0 (and the rest is to the right). */
  probabilityLeftOf(x0) {
    let s = 0;
    for (let j = 0; j < this.n && this.x[j] < x0; j++) s += this.re[j] ** 2 + this.im[j] ** 2;
    return s * this.dx;
  }
}

/**
 * Make a potential with jumps fit for the split-operator method.  A perfectly sharp step
 * couples the wave function to waves of every wavenumber, and the method, unless its step is
 * tiny, turns that into a spurious heating (measured: a bound state's energy climbing tenfold).
 * Two remedies, by the size of the jump:
 *
 *  - Moderate jumps (steps, barriers, wells): the potential's Fourier components above kc are
 *    cut off, with a gentle taper from 0.6 kc, on the mirror-extended potential so that the
 *    two ends don't count as a jump.  A step reflects a wave of wavenumber k through V's
 *    Fourier components at 2k, untouched while 2k < 0.6 kc, so reflection and tunnelling are
 *    those of the sharp step; and the step can now only reach wavenumbers up to about kc,
 *    which a time step dt <= 1.2 m / kc^2 resolves.  The cut-off rings by a per cent or two
 *    of the jump (Gibbs), harmless for a jump of a few units.
 *  - Walls taller than TALL: a ripple of a per cent of 500 would dig dips that bind states of
 *    their own, so these are rounded instead, by a Gaussian of width delta (no ripple), with
 *    dt <= 1.2 m delta^2.  The wave hardly enters such a wall, so the exact shape of its
 *    edge hardly matters.
 *
 * Sharp features are found as what the band limit changes (narrow spikes as well as steps).
 * Smooth potentials (wells, lattices) are returned unchanged, exactly as typed.  The result
 * carries .jumps and .step (the largest time step it allows, divided by the mass).
 */
const TALL = 30;
export function prepareSharpPotential(V, dx, { kc = 16, delta = 0.05 } = {}) {
  const n = V.length, out = Float64Array.from(V);
  out.jumps = false;
  out.step = Infinity;
  // The band-limited potential, on the mirror-extended domain (so the ends don't count).
  const N = 2 * n, re = new Float64Array(N), im = new Float64Array(N);
  for (let j = 0; j < n; j++) { re[j] = V[j]; re[N - 1 - j] = V[j]; }
  fft(re, im);
  const k = wavenumbers(N, dx);
  for (let i = 0; i < N; i++) {
    const q = Math.abs(k[i]) / kc;
    const f = q <= 0.6 ? 1 : q >= 1 ? 0 : 0.5 * (1 + Math.cos((Math.PI * (q - 0.6)) / 0.4));
    re[i] *= f; im[i] *= f;
  }
  ifft(re, im);
  // Sharp features are what the band limit changes.  Away from the ends (where the mirror
  // extension has a kink of its own), a smooth potential is hardly touched.
  let vmin = Infinity, vmax = -Infinity;
  for (let j = 0; j < n; j++) { vmin = Math.min(vmin, V[j]); vmax = Math.max(vmax, V[j]); }
  const edge = Math.ceil(6 / (kc * dx));
  let worst = 0, at = -1;
  for (let j = edge; j < n - edge; j++) {
    const d = Math.abs(re[j] - V[j]);
    if (d > worst) { worst = d; at = j; }
  }
  if (!(worst > 2e-3 * (vmax - vmin) + 1e-9)) return out;
  out.jumps = true;
  // How tall is the sharp feature?  The range of V within a few wavelengths of the worst spot.
  const w = Math.ceil(6 / (kc * dx));
  let lo = Infinity, hi = -Infinity;
  for (let j = Math.max(0, at - w); j <= Math.min(n - 1, at + w); j++) { lo = Math.min(lo, V[j]); hi = Math.max(hi, V[j]); }
  if (hi - lo > TALL) {
    const g = Math.max(1.5 * dx, delta), r = Math.ceil((3 * g) / dx);
    const wt = new Float64Array(2 * r + 1);
    let s = 0;
    for (let i = -r; i <= r; i++) { wt[i + r] = Math.exp(-((i * dx) ** 2) / (2 * g * g)); s += wt[i + r]; }
    for (let j = 0; j < n; j++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += wt[i + r] * V[Math.min(n - 1, Math.max(0, j + i))];
      out[j] = a / s;
    }
    out.step = 1.2 * g * g;
    return out;
  }
  for (let j = 0; j < n; j++) out[j] = re[j];
  out.step = 1.2 / (kc * kc);
  return out;
}

// ---------------------------------------------------------------------- eigenstates
//
// The stationary states of the finite-difference Hamiltonian
//     H psi_j = -(psi_{j+1} - 2 psi_j + psi_{j-1}) / (2 m dx^2) + V_j psi_j
// with psi = 0 just beyond the ends: a symmetric tridiagonal matrix.  Its eigenvalues are
// found one at a time by bisection, counting how many lie below a trial energy with a Sturm
// sequence; each eigenvector by inverse iteration.  The finite-difference energies differ from
// the true ones by about (k dx)^2/12 relative; the same calculation on a grid twice as coarse
// has four times the error, so (4 E_fine - E_coarse)/3 (Richardson's extrapolation) leaves an
// error of order dx^4.  The eigenvectors keep their small O(dx^2) error: evolved with the exact
// kinetic energy, |psi|^2 of a stationary state then changes by about 1e-4 of its size.

/** Number of eigenvalues of the tridiagonal matrix (diagonal d, off-diagonal e) below E. */
function sturmCount(d, e2, E) {
  let count = 0, q = d[0] - E;
  if (q < 0) count++;
  for (let i = 1; i < d.length; i++) {
    q = d[i] - E - e2 / (q === 0 ? 1e-300 : q);
    if (q < 0) count++;
  }
  return count;
}

// The k-th (0-based) eigenvalue, by bisection.
function bisect(d, e2, k, lo, hi) {
  let a = lo, b = hi;
  for (let it = 0; it < 200 && b - a > 1e-13 * Math.max(1, Math.abs(a) + Math.abs(b)); it++) {
    const mid = (a + b) / 2;
    if (sturmCount(d, e2, mid) > k) b = mid; else a = mid;
  }
  return (a + b) / 2;
}

/** Solve (T - E) y = b in place for the tridiagonal T (constant off-diagonal e). */
function tridiagSolve(d, e, E, b) {
  const n = d.length, c = new Float64Array(n);
  let w = d[0] - E;
  if (w === 0) w = 1e-300;
  b[0] /= w;
  for (let i = 1; i < n; i++) {
    c[i] = e / w;
    w = d[i] - E - e * c[i];
    if (w === 0) w = 1e-300;
    b[i] = (b[i] - e * b[i - 1]) / w;
  }
  for (let i = n - 2; i >= 0; i--) b[i] -= c[i + 1] * b[i + 1];
}

/**
 * The lowest `count` eigenstates of the finite-difference Hamiltonian for potential V on a grid
 * of spacing dx, with psi = 0 beyond the ends.  first/last: the index range of the grid to use
 * (for walls, the interior points 1..n-1).  Returns [{E, psi: Float64Array(n)}] normalised so
 * that sum psi^2 dx = 1, real, with a positive slope at the left.
 */
export function eigenstates(V, dx, mass, count, { first = 0, last = V.length - 1, maxE = Infinity } = {}) {
  const m = last - first + 1;
  const d = new Float64Array(m);
  const t = 1 / (2 * mass * dx * dx);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < m; i++) {
    d[i] = 2 * t + V[first + i];
    lo = Math.min(lo, V[first + i]); hi = Math.max(hi, d[i] + 2 * t);
  }
  const e = -t, e2 = t * t;
  // The same matrix on every other point, for the extrapolation.  With walls (first = 1,
  // last = n - 1, n even) the coarse points 2, 4, ..., n - 2 keep the walls where they were.
  const start = first % 2 === 1 ? first + 1 : first;
  const mc = Math.floor((last - start) / 2) + 1, tc = t / 4;
  const dc = new Float64Array(mc);
  for (let i = 0; i < mc; i++) dc[i] = 2 * tc + V[start + 2 * i];
  const out = [];
  const total = Math.min(count, m, mc);
  for (let k = 0; k < total; k++) {
    const Efine = bisect(d, e2, k, lo - 1, hi + 1);
    if (Efine > maxE) break;
    const Ecoarse = bisect(dc, tc * tc, k, lo - 1, hi + 1);
    const E = (4 * Efine - Ecoarse) / 3;
    // Inverse iteration from a generic start; shifting slightly off E keeps it well posed.
    let y = new Float64Array(m);
    for (let i = 0; i < m; i++) y[i] = 1 + 0.1 * Math.sin(1.7 * i + k);
    const shift = Efine + 1e-10 * Math.max(1, Math.abs(Efine));
    for (let it = 0; it < 3; it++) {
      tridiagSolve(d, e, shift, y);
      let s = 0;
      for (let i = 0; i < m; i++) s += y[i] * y[i];
      s = Math.sqrt(s);
      for (let i = 0; i < m; i++) y[i] /= s;
    }
    const psi = new Float64Array(V.length);
    let s = 0;
    for (let i = 0; i < m; i++) { psi[first + i] = y[i]; s += y[i] * y[i]; }
    s = Math.sqrt(s * dx);
    // Sign convention: the first sizeable lobe from the left is positive.
    let sign = 1, peak = 0;
    for (let i = 0; i < m; i++) peak = Math.max(peak, Math.abs(y[i]));
    for (let i = 0; i < m; i++) if (Math.abs(y[i]) > 0.1 * peak) { sign = Math.sign(y[i]); break; }
    for (let i = 0; i < V.length; i++) psi[i] *= sign / s;
    out.push({ E, psi });
  }
  return out;
}
