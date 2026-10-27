// The time-dependent Schrödinger equation in two dimensions (hbar = m = 1), for wave packets
// scattering off a potential, and the measurements that turn the movie into scattering theory.
//
// Evolution: split-operator, as in 1D: exp(-iV dt/2) F^-1 exp(-i k^2 dt/2) F exp(-iV dt/2), on an
// n x n periodic grid with an absorbing border (a layer a tenth of the box wide, where psi is
// multiplied by a smooth exp(-gamma dt) each step), so that what leaves never comes back.
//
// The incident packet is a Gaussian, exp(-(x-x0)^2/4sx^2 - (y-y0)^2/4sy^2 + i k0 x), whose free
// evolution is known exactly; so the scattered wave psi_sc = psi - psi_inc is known everywhere.
//
// On a circle of radius R around the target, every step:
//   - the outward flux of psi_sc and of the interference between psi_inc and psi_sc, added up
//     over the whole collision: dP/dtheta.  Divided by the incident fluence (probability per
//     unit length across the beam at the target), that is the differential cross section;
//   - the outward flux of psi itself, which is what a wall with openings lets through: behind
//     a wall there is no incident wave to subtract;
//   - the time Fourier transforms of psi_sc(R, theta, t) and psi_inc(0, 0, t) at one energy
//     E0 = k0^2/2: the steady-state scattered wave at that energy, from which the S-matrix
//     elements S_m = exp(2 i delta_m) of each partial wave follow.

import { fft2, wavenumbers } from '../lib/fft.js';
import { besselJ, besselY } from '../lib/bessel.js';

export class Sim2D {
  constructor({ n = 256, L = 64, mass = 1, absorb = true } = {}) {
    this.n = n; this.L = L; this.mass = mass;
    this.dx = L / n;
    // Grid point (i, j) is x = (i - n/2) dx, y = (j - n/2) dx: the origin is a grid point.
    this.coord = Float64Array.from({ length: n }, (_, i) => (i - n / 2) * this.dx);
    this.re = new Float64Array(n * n);
    this.im = new Float64Array(n * n);
    this.V = new Float64Array(n * n);
    this.k = wavenumbers(n, this.dx);
    this.absorb = absorb;
    this.layer = Math.round(n / 10);        // absorbing layer width, in points
    this.absorbSpeed = 3;
    this.t = 0;
    this.h = 0;
  }

  /** Points inside the absorbing layer don't count as "in the box". */
  get inner() { return (this.n / 2 - this.layer) * this.dx; }

  setPotential(V) { this.V.set(V); this.h = 0; }

  setPsi(re, im) { this.re.set(re); this.im.set(im); this.t = 0; }

  norm() {
    let s = 0;
    for (let i = 0; i < this.re.length; i++) s += this.re[i] * this.re[i] + this.im[i] * this.im[i];
    return s * this.dx * this.dx;
  }

  // ------------------------------------------------------------------- stepping

  _tables(h) {
    const n = this.n, N = n * n, m = this.mass;
    if (!this._kc) {
      this._kc = new Float64Array(N); this._ks = new Float64Array(N);
      this._wc = new Float64Array(N); this._ws = new Float64Array(N);   // full V step and mask
      this._hc = new Float64Array(N); this._hs = new Float64Array(N);   // half V step
    }
    for (let j = 0; j < n; j++) {
      const ky2 = this.k[j] * this.k[j];
      for (let i = 0; i < n; i++) {
        const a = (-(this.k[i] * this.k[i] + ky2) * h) / (2 * m);
        this._kc[j * n + i] = Math.cos(a); this._ks[j * n + i] = Math.sin(a);
      }
    }
    // The absorbing mask: exp(-A d^3 |h|) at depth d (0..1) into the layer, A = 24 v / W.
    const W = this.layer * this.dx, A = (24 * this.absorbSpeed) / W, lay = this.layer;
    const depth = (i) => Math.max(0, lay - i, i - (n - 1 - lay)) / lay;
    for (let j = 0; j < n; j++) {
      const dj = depth(j);
      for (let i = 0; i < n; i++) {
        const d = this.absorb ? Math.max(dj, depth(i)) : 0;
        const mask = d > 0 ? Math.exp(-A * d * d * d * Math.abs(h)) : 1;
        const v = this.V[j * n + i];
        this._wc[j * n + i] = mask * Math.cos(-v * h); this._ws[j * n + i] = mask * Math.sin(-v * h);
        this._hc[j * n + i] = Math.cos((-v * h) / 2); this._hs[j * n + i] = Math.sin((-v * h) / 2);
      }
    }
    this.h = h;
  }

  _mul(c, s) {
    const { re, im } = this;
    for (let i = 0; i < re.length; i++) {
      const r = re[i] * c[i] - im[i] * s[i];
      im[i] = re[i] * s[i] + im[i] * c[i]; re[i] = r;
    }
  }

  _kinetic() {
    const n = this.n;
    fft2(this.re, this.im, n, n, -1);
    this._mul(this._kc, this._ks);
    fft2(this.re, this.im, n, n, +1);
    const s = 1 / (n * n);
    for (let i = 0; i < this.re.length; i++) { this.re[i] *= s; this.im[i] *= s; }
  }

  /**
   * One step of length h.  (The half steps of V are not merged across steps, so that the
   * measurement after each step sees psi at a whole time step.)  The mask and V are both
   * diagonal in position and commute, so V/2, mask, V/2 is one multiplication by mask exp(-iVh).
   */
  step(h) {
    if (h !== this.h) this._tables(h);
    this._mul(this._hc, this._hs);
    this._kinetic();
    // The second half of V, with the absorber: mask exp(-iVh) times exp(+iVh/2) = mask exp(-iVh/2).
    const { re, im, _wc: wc, _ws: ws, _hc: hc, _hs: hs } = this;
    for (let i = 0; i < re.length; i++) {
      // (wc + i ws) (hc - i hs)
      const c = wc[i] * hc[i] + ws[i] * hs[i], s = ws[i] * hc[i] - wc[i] * hs[i];
      const r = re[i] * c - im[i] * s;
      im[i] = re[i] * s + im[i] * c; re[i] = r;
    }
    this.t += h;
  }
}

// ------------------------------------------------------------------ the packet

/**
 * A Gaussian packet exp(-(x-x0)^2/(4 sx^2) - (y-y0)^2/(4 sy^2) + i k0 x), moving along +x,
 * and its exact free evolution (hbar = m = 1):
 *   X(x, t) = (1 + i t / 2sx^2)^-1/2 exp(-(x - x0 - k0 t)^2 / (4 sx^2 (1 + i t/2sx^2)) + i k0 x - i k0^2 t/2)
 *   Y(y, t) = (1 + i t / 2sy^2)^-1/2 exp(-(y - y0)^2 / (4 sy^2 (1 + i t/2sy^2)))
 * times a constant c that normalises the whole.
 */
export class Packet {
  constructor({ x0 = -16, y0 = 0, sx = 2.5, sy = 6, k0 = 2, mass = 1 } = {}) {
    Object.assign(this, { x0, y0, sx, sy, k0, mass });
    // Normalisation of |psi|^2 = exp(-(x-x0)^2/2sx^2 - (y-y0)^2/2sy^2): integral 2 pi sx sy.
    this.c = 1 / Math.sqrt(2 * Math.PI * this.sx * this.sy);
  }

  get energy() { return (this.k0 * this.k0) / (2 * this.mass); }

  // Complex helpers on [re, im] pairs.
  static _factor(u, t, s, mass, out) {
    // (1 + i a)^-1/2 exp(-u^2 / (4 s^2 (1 + i a))), a = t / (2 m s^2)  (with m: hbar t / 2 m s^2)
    const a = t / (2 * mass * s * s);
    const d = 1 + a * a;
    // 1/(1+ia) = (1 - i a)/d
    const er = (-(u * u) / (4 * s * s)) / d, ei = ((u * u) / (4 * s * s)) * a / d;
    // (1 + i a)^-1/2 = r^-1/2 exp(-i phi/2), r = sqrt(d), phi = atan(a)
    const r = Math.pow(d, -0.25), ph = -0.5 * Math.atan(a);
    const m = r * Math.exp(er);
    out[0] = m * Math.cos(ei + ph); out[1] = m * Math.sin(ei + ph);
    return out;
  }

  /** psi_inc at (x, y) and time t into out = [re, im]; also its gradient if grad is given. */
  at(x, y, t, out = [0, 0], grad = null) {
    const fx = [0, 0], fy = [0, 0], m = this.mass;
    const u = x - this.x0 - (this.k0 / m) * t;
    Packet._factor(u, t, this.sx, m, fx);
    Packet._factor(y - this.y0, t, this.sy, m, fy);
    // The plane-wave factor exp(i (k0 x - k0^2 t / 2m)).
    const ph = this.k0 * x - (this.k0 * this.k0 * t) / (2 * m);
    const pr = Math.cos(ph), pi = Math.sin(ph);
    const ar = fx[0] * fy[0] - fx[1] * fy[1], ai = fx[0] * fy[1] + fx[1] * fy[0];
    out[0] = this.c * (ar * pr - ai * pi); out[1] = this.c * (ar * pi + ai * pr);
    if (grad) {
      // d/dx: psi * (-u / (2 sx^2 (1 + i ax)) + i k0);  d/dy: psi * (-(y-y0) / (2 sy^2 (1 + i ay)))
      const ax = t / (2 * m * this.sx * this.sx), ay = t / (2 * m * this.sy * this.sy);
      const dx = 1 + ax * ax, dy = 1 + ay * ay;
      const gxr = (-u / (2 * this.sx * this.sx)) / dx, gxi = ((u / (2 * this.sx * this.sx)) * ax) / dx + this.k0;
      const v = y - this.y0;
      const gyr = (-v / (2 * this.sy * this.sy)) / dy, gyi = ((v / (2 * this.sy * this.sy)) * ay) / dy;
      grad[0] = out[0] * gxr - out[1] * gxi; grad[1] = out[0] * gxi + out[1] * gxr;
      grad[2] = out[0] * gyr - out[1] * gyi; grad[3] = out[0] * gyi + out[1] * gyr;
    }
    return out;
  }

  /**
   * The beam's weight in each partial wave at wavenumber k, relative to m = 0: G_m / G_0 with
   * G_m = integral g(phi) e^{-i m phi} dphi and g(phi) the packet's momentum amplitude at
   * k (cos phi, sin phi):  g = exp(-k^2 (cos phi - 1)^2 sx^2 - k^2 sin^2 phi sy^2)
   *                            * exp(i k (1 - cos phi) x0 - i k sin phi y0)   (k0 = k here).
   * Returns a Map m -> [re, im].
   */
  beamWeights(k, mmax) {
    const key = `${k},${mmax}`;
    if (this._beam?.key === key) return this._beam.out;
    const P = 2048, gr = new Float64Array(P), gi = new Float64Array(P);
    for (let a = 0; a < P; a++) {
      const ph = (2 * Math.PI * a) / P, c = Math.cos(ph), s = Math.sin(ph);
      const mag = Math.exp(-((k * (c - 1) * this.sx) ** 2) - (k * s * this.sy) ** 2);
      const arg = k * (1 - c) * this.x0 - k * s * this.y0;
      gr[a] = mag * Math.cos(arg); gi[a] = mag * Math.sin(arg);
    }
    const coef = (m) => {
      let r = 0, i = 0;
      for (let a = 0; a < P; a++) {
        const ph = (-m * 2 * Math.PI * a) / P, c = Math.cos(ph), s = Math.sin(ph);
        r += gr[a] * c - gi[a] * s; i += gr[a] * s + gi[a] * c;
      }
      return [r, i];
    };
    const [g0r, g0i] = coef(0), g02 = g0r * g0r + g0i * g0i, out = new Map();
    for (let m = -mmax; m <= mmax; m++) {
      const [r, i] = coef(m);
      out.set(m, [(r * g0r + i * g0i) / g02, (i * g0r - r * g0i) / g02]);
    }
    this._beam = { key, out };
    return out;
  }

  /** psi_inc on the whole grid at time t (it is a product X(x) Y(y)). */
  grid(sim, t, re, im) {
    const n = sim.n;
    const Xr = new Float64Array(n), Xi = new Float64Array(n), Yr = new Float64Array(n), Yi = new Float64Array(n);
    this.factors(sim, t, Xr, Xi, Yr, Yi);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        re[j * n + i] = Xr[i] * Yr[j] - Xi[i] * Yi[j];
        im[j * n + i] = Xr[i] * Yi[j] + Xi[i] * Yr[j];
      }
    }
  }

  /** The factors X(x_i, t) (with the normalisation) and Y(y_j, t) of psi_inc on the grid. */
  factors(sim, t, Xr, Xi, Yr, Yi) {
    const n = sim.n, xs = sim.coord;
    const f = [0, 0], m = this.mass;
    const ph0 = -(this.k0 * this.k0 * t) / (2 * m);
    for (let i = 0; i < n; i++) {
      Packet._factor(xs[i] - this.x0 - (this.k0 / m) * t, t, this.sx, m, f);
      const ph = this.k0 * xs[i] + ph0, c = Math.cos(ph), s = Math.sin(ph);
      Xr[i] = this.c * (f[0] * c - f[1] * s); Xi[i] = this.c * (f[0] * s + f[1] * c);
      Packet._factor(xs[i] - this.y0, t, this.sy, m, f);
      Yr[i] = f[0]; Yi[i] = f[1];
    }
  }
}

// ---------------------------------------------------------------- measurement

/**
 * The measurement circle: radius R, M angles from the +x axis (the incident direction).
 * Call record(sim, packet, dt) after every step.
 */
export class Detector {
  constructor(R, M = 256) {
    this.R = R; this.M = M;
    this.theta = Float64Array.from({ length: M }, (_, j) => (2 * Math.PI * j) / M);
    this.reset(0);
  }

  reset(E0) {
    const M = this.M;
    this.E0 = E0;
    this.Psc = new Float64Array(M);     // integral of the scattered flux, per radian
    this.Pint = new Float64Array(M);    // integral of the interference flux, per radian
    this.Ptot = new Float64Array(M);    // integral of the flux of psi itself, per radian
    this.Are = new Float64Array(M);     // time Fourier transform of psi_sc(R, theta, t) at E0
    this.Aim = new Float64Array(M);
    this.Ainc = [0, 0];                 // ... of psi_inc(0, 0, t)
    this.fluence = 0;                   // integral of the incident current through the origin
    this.time = 0;
    this.stencil = null;
  }

  /**
   * The interpolation stencils, worked out once: for each angle and each of the radii R - d,
   * R, R + d, sixteen grid points and their bicubic (Catmull-Rom) weights, the weights already
   * multiplied by exp(-i k0 r) at each point.  The scattered wave is mostly outgoing,
   * exp(i k0 r), so what is interpolated, the envelope A = psi_sc exp(-i k0 r), is smooth.
   */
  _build(sim, k0) {
    const n = sim.n, dx = sim.dx, d = dx / 2, M = this.M;
    const idx = new Int32Array(3 * M * 16), wr = new Float64Array(3 * M * 16), wi = new Float64Array(3 * M * 16);
    const cr = (s) => [((-s + 2) * s - 1) * s / 2, ((3 * s - 5) * s * s + 2) / 2, ((-3 * s + 4) * s + 1) * s / 2, ((s - 1) * s * s) / 2];
    let o = 0;
    for (let j = 0; j < M; j++) {
      const c = Math.cos(this.theta[j]), s = Math.sin(this.theta[j]);
      for (const r of [this.R - d, this.R, this.R + d]) {
        const fx = (r * c) / dx + n / 2, fy = (r * s) / dx + n / 2;
        const i0 = Math.floor(fx), j0 = Math.floor(fy), wx = cr(fx - i0), wy = cr(fy - j0);
        for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++, o++) {
          const ii = i0 - 1 + a, jj = j0 - 1 + b;
          idx[o] = jj * n + ii;
          const ph = -k0 * Math.hypot((ii - n / 2) * dx, (jj - n / 2) * dx), w = wx[a] * wy[b];
          wr[o] = w * Math.cos(ph); wi[o] = w * Math.sin(ph);
        }
      }
    }
    this.stencil = { idx, wr, wi, k0, n, Xr: new Float64Array(n), Xi: new Float64Array(n), Yr: new Float64Array(n), Yi: new Float64Array(n) };
  }

  record(sim, packet, dt) {
    if (!this.stencil || this.stencil.k0 !== packet.k0 || this.stencil.n !== sim.n) this._build(sim, packet.k0);
    const { R, M, theta } = this, t = sim.t, m = packet.mass, d = sim.dx / 2, k0 = packet.k0;
    const st = this.stencil, n = sim.n;
    // psi_inc = X(x) Y(y) on this step's grid.
    packet.factors(sim, t, st.Xr, st.Xi, st.Yr, st.Yi);
    const env = (base, out) => {
      // A = sum_taps w exp(-i k0 r) (psi - psi_inc), and the same for psi alone in out[2, 3].
      let ar = 0, ai = 0, br = 0, bi = 0;
      for (let q = base; q < base + 16; q++) {
        const g = st.idx[q], i = g % n, jj = (g - i) / n;
        const ir = st.Xr[i] * st.Yr[jj] - st.Xi[i] * st.Yi[jj], ii = st.Xr[i] * st.Yi[jj] + st.Xi[i] * st.Yr[jj];
        const sr = sim.re[g] - ir, si = sim.im[g] - ii;
        ar += st.wr[q] * sr - st.wi[q] * si; ai += st.wr[q] * si + st.wi[q] * sr;
        br += st.wr[q] * sim.re[g] - st.wi[q] * sim.im[g]; bi += st.wr[q] * sim.im[g] + st.wi[q] * sim.re[g];
      }
      out[0] = ar; out[1] = ai; out[2] = br; out[3] = bi;
    };
    const lo = [0, 0, 0, 0], mid = [0, 0, 0, 0], hi = [0, 0, 0, 0], inc = [0, 0], g = [0, 0, 0, 0];
    const cE = Math.cos(this.E0 * t), sE = Math.sin(this.E0 * t), eR = [Math.cos(k0 * R), Math.sin(k0 * R)];
    for (let j = 0; j < M; j++) {
      const base = j * 48;
      env(base, lo); env(base + 16, mid); env(base + 32, hi);
      // psi_sc = A e^{i k0 R} and dpsi_sc/dr = (A' + i k0 A) e^{i k0 R}, A' by a central
      // difference of the smooth envelope (differencing psi itself would read k0 2% low).
      const Ar = mid[0], Ai = mid[1];
      const Apr = (hi[0] - lo[0]) / (2 * d) - k0 * Ai, Api = (hi[1] - lo[1]) / (2 * d) + k0 * Ar;
      const pr = Ar * eR[0] - Ai * eR[1], pi = Ar * eR[1] + Ai * eR[0];
      const dr = Apr * eR[0] - Api * eR[1], di = Apr * eR[1] + Api * eR[0];
      // Scattered flux j_r = (1/m) Im(psi_sc* dpsi_sc/dr).
      const jsc = (pr * di - pi * dr) / m;
      // Interference flux (1/m) Im(psi_inc* dpsi_sc/dr + psi_sc* dpsi_inc/dr).
      const c = Math.cos(theta[j]), s = Math.sin(theta[j]);
      packet.at(R * c, R * s, t, inc, g);
      const gr = c * g[0] + s * g[2], gi = c * g[1] + s * g[3];
      const jint = (inc[0] * di - inc[1] * dr + pr * gi - pi * gr) / m;
      this.Psc[j] += jsc * R * dt;
      this.Pint[j] += jint * R * dt;
      // The flux of psi itself, from its own envelope (smooth where psi is outgoing: behind a
      // wall, not in front of it, where the incident and reflected waves beat).
      const Br = mid[2], Bi = mid[3];
      const Bpr = (hi[2] - lo[2]) / (2 * d) - k0 * Bi, Bpi = (hi[3] - lo[3]) / (2 * d) + k0 * Br;
      this.Ptot[j] += ((Br * Bpi - Bi * Bpr) / m) * R * dt;
      // psi_sc exp(i E0 t) dt
      this.Are[j] += (pr * cE - pi * sE) * dt;
      this.Aim[j] += (pr * sE + pi * cE) * dt;
    }
    packet.at(0, 0, t, inc, g);
    this.Ainc[0] += (inc[0] * cE - inc[1] * sE) * dt;
    this.Ainc[1] += (inc[0] * sE + inc[1] * cE) * dt;
    // The incident current through the origin, (1/m) Im(psi* dpsi/dx): probability per unit
    // length across the beam, per unit time.
    this.fluence += ((inc[0] * g[1] - inc[1] * g[0]) / m) * dt;
    this.time += dt;
  }

  /** dsigma/dtheta from the flux (an average over the packet's energies): {theta, dsdt}. */
  crossSection() {
    const out = new Float64Array(this.M);
    if (this.fluence > 0) for (let j = 0; j < this.M; j++) out[j] = this.Psc[j] / this.fluence;
    return out;
  }

  /** Total cross section from the scattered flux, and the shadow (minus the interference flux). */
  totals() {
    const dth = (2 * Math.PI) / this.M;
    let sc = 0, it = 0;
    for (let j = 0; j < this.M; j++) { sc += this.Psc[j] * dth; it += this.Pint[j] * dth; }
    return { scattered: this.fluence > 0 ? sc / this.fluence : 0, shadow: this.fluence > 0 ? -it / this.fluence : 0 };
  }

  /**
   * The partial waves at k = k0 from the energy-resolved amplitudes.  At energy E0 the incident
   * wave is sum_m beta_m J_m(kr) e^{im theta} and the scattered wave sum_m beta_m (S_m - 1)/2
   * H_m(kr) e^{im theta}, with H = J + iY; a Fourier transform over theta gives each term.  For
   * a plane wave beta_m = Ainc i^m.  The packet is a beam, not a plane wave: its directions
   * spread a little, and it holds less of the higher m.  Its own beta_m come from its momentum
   * amplitudes on the energy shell, packet.beamWeights(k, mmax): beta_m = Ainc i^m G_m / G_0.
   * Returns [{m, Sre, Sim}] for m = -mmax ... mmax.
   */
  partialWaves(k, mmax = 30, packet = null) {
    const G = packet ? packet.beamWeights(k, mmax) : null;
    const M = this.M, kR = k * this.R;
    const J = besselJ(mmax, kR), Y = besselY(mmax, kR);
    const [ir, ii] = this.Ainc, i2 = ir * ir + ii * ii;
    if (!(i2 > 0)) return null;
    const waves = [];
    for (let m = -mmax; m <= mmax; m++) {
      // a_m = (1/M) sum_theta A(theta) e^{-i m theta}
      let ar = 0, ai = 0;
      for (let j = 0; j < M; j++) {
        const ph = -m * this.theta[j], c = Math.cos(ph), s = Math.sin(ph);
        ar += this.Are[j] * c - this.Aim[j] * s; ai += this.Are[j] * s + this.Aim[j] * c;
      }
      ar /= M; ai /= M;
      // Divide by Ainc, by i^m, by G_m/G_0, and by H_m(kR) = J + iY (H_{-m} = (-1)^m H_m).
      const am = Math.abs(m), sg = m < 0 && am % 2 ? -1 : 1;
      let hr = sg * J[am], hi = sg * Y[am];
      if (G) {
        const [gr, gi] = G.get(m);
        const t = hr * gr - hi * gi; hi = hr * gi + hi * gr; hr = t;
      }
      // x = a / (Ainc * H):  a * conj(Ainc * H) / |Ainc H|^2
      const dr = ir * hr - ii * hi, di = ir * hi + ii * hr, d2 = dr * dr + di * di;
      let xr = (ar * dr + ai * di) / d2, xi = (ai * dr - ar * di) / d2;
      // divide by i^m: multiply by (-i)^m
      for (let r = 0; r < ((am % 4) + 4) % 4; r++) {
        if (m > 0) { const t = xr; xr = xi; xi = -t; } else { const t = xr; xr = -xi; xi = t; }
      }
      // S_m = 1 + 2 x
      waves.push({ m, Sre: 1 + 2 * xr, Sim: 2 * xi });
    }
    return waves;
  }
}

/**
 * From the S-matrix elements: f(theta), the total cross section (sum over partial waves), and
 * the optical theorem's sigma = -sqrt(8 pi / k) Re[e^{i pi/4} f(0)].  (Conventions:
 * psi -> e^{ikx} + f(theta) e^{ikr}/sqrt(r), dsigma/dtheta = |f|^2,
 * f(theta) = (2 pi k)^-1/2 e^{-i pi/4} sum_m (S_m - 1) e^{i m theta}.)
 */
export function fromPartialWaves(waves, k, thetas) {
  const pref = 1 / Math.sqrt(2 * Math.PI * k), c4 = Math.cos(-Math.PI / 4), s4 = Math.sin(-Math.PI / 4);
  const f = thetas.map((th) => {
    let ar = 0, ai = 0;
    for (const w of waves) {
      const c = Math.cos(w.m * th), s = Math.sin(w.m * th), xr = w.Sre - 1, xi = w.Sim;
      ar += xr * c - xi * s; ai += xr * s + xi * c;
    }
    return [pref * (ar * c4 - ai * s4), pref * (ar * s4 + ai * c4)];
  });
  let sigma = 0;
  for (const w of waves) sigma += (w.Sre - 1) ** 2 + w.Sim ** 2;
  sigma /= k;
  // f(0) and the optical theorem.
  let ar = 0, ai = 0;
  for (const w of waves) { ar += w.Sre - 1; ai += w.Sim; }
  const f0 = [pref * (ar * c4 - ai * s4), pref * (ar * s4 + ai * c4)];
  const rot = f0[0] * Math.cos(Math.PI / 4) - f0[1] * Math.sin(Math.PI / 4); // Re[e^{i pi/4} f0]
  const optical = -Math.sqrt((8 * Math.PI) / k) * rot;
  return { f, sigma, optical };
}

/**
 * The first Born approximation: dsigma/dtheta = |V~(q)|^2 / (2 pi k) (hbar = m = 1, in 2D),
 * V~(q) = integral V(r) e^{-i q.r} d^2r, q = k (cos theta - 1, sin theta).  Summed directly over
 * the grid points where V is not zero.
 */
export function bornCrossSection(sim, k, thetas, mass = 1) {
  const n = sim.n, dA = sim.dx * sim.dx, pts = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = sim.V[j * n + i];
    if (v !== 0) pts.push(sim.coord[i], sim.coord[j], v);
  }
  return thetas.map((th) => {
    const qx = k * (Math.cos(th) - 1), qy = k * Math.sin(th);
    let ar = 0, ai = 0;
    for (let p = 0; p < pts.length; p += 3) {
      const ph = -(qx * pts[p] + qy * pts[p + 1]);
      ar += pts[p + 2] * Math.cos(ph); ai += pts[p + 2] * Math.sin(ph);
    }
    ar *= dA; ai *= dA;
    // (2m/hbar^2)^2 |V~|^2 / (8 pi k) = m^2 |V~|^2 / (2 pi k)
    return (mass * mass * (ar * ar + ai * ai)) / (2 * Math.PI * k);
  });
}

/**
 * Fraunhofer diffraction by openings in a thin wall along the y axis.  If psi(0, y) = A(y) in
 * the openings (Kirchhoff: the incident wave, undisturbed) and 0 on the wall, the wave behind
 * it is the sum of plane waves exp(i(q y + sqrt(k^2 - q^2) x)) A~(q) dq/2pi, with
 * A~(q) = integral A(y) e^{-iqy} dy, and far away, by stationary phase in q,
 *     psi -> sqrt(k / 2 pi r) e^{i(kr - pi/4)} cos(theta) A~(k sin theta),   |theta| < 90 deg:
 * every direction of the half circle, k_y = k sin(theta) running over -k ... k.  With A relative
 * to the incident wave at the origin (current k per unit length across the beam),
 *     dsigma/dtheta = (k / 2 pi) cos^2(theta) |A~(k sin theta)|^2,
 * a length per radian like any 2D cross section; its integral is at most the open width.
 * ys: the open sample points, dy apart; Are, Aim: A there.  0 behind the wall (|theta| >= 90).
 */
export function fraunhofer(k, ys, Are, Aim, dy, thetas) {
  return thetas.map((th) => {
    const c = Math.cos(th);
    if (!(c > 0)) return 0;
    const q = k * Math.sin(th);
    let sr = 0, si = 0;
    for (let p = 0; p < ys.length; p++) {
      const ph = -q * ys[p], cr = Math.cos(ph), ci = Math.sin(ph);
      sr += Are[p] * cr - Aim[p] * ci; si += Are[p] * ci + Aim[p] * cr;
    }
    return (k / (2 * Math.PI)) * c * c * (sr * sr + si * si) * dy * dy;
  });
}

/** Exact partial waves for a hard disk of radius a (psi = 0 on it): tan delta_m = J_m(ka)/Y_m(ka). */
export function hardDiskWaves(k, a, mmax = 30) {
  const J = besselJ(mmax, k * a), Y = besselY(mmax, k * a), out = [];
  for (let m = -mmax; m <= mmax; m++) {
    const am = Math.abs(m), d = Math.atan2(J[am], Y[am]);
    // S = e^{2i delta}, delta = atan(J/Y) (either branch gives the same S)
    out.push({ m, Sre: Math.cos(2 * d), Sim: Math.sin(2 * d) });
  }
  return out;
}

/**
 * Make a potential on the n x n grid fit for the split-operator method (see the 1D
 * prepareSharpPotential for the reasons): if cutting its Fourier components above kc (with a
 * taper from 0.6 kc) changes it, it has sharp features.  Moderate ones are band-limited; walls
 * taller than `tall` are rounded with a Gaussian of width delta instead (no ripple).  Returns
 * {V, step}: the potential to use and a time step its features allow.  (In two dimensions, on
 * this demo's grids, a band-limited potential is followed well at dt = 0.05: tested with the
 * double slit's walls, energy conserved and transmission within 1% of dt = 0.0135; so the demo
 * uses the ordinary step, not this conservative one.)
 */
export function preparePotential2D(V, n, dx, { kc = 0.75 * Math.PI / dx, delta = Math.max(1.5 * dx, 0.1), tall = 15 } = {}) {
  const N = n * n, re = Float64Array.from(V), im = new Float64Array(N);
  let vmin = Infinity, vmax = -Infinity;
  for (let i = 0; i < N; i++) { vmin = Math.min(vmin, V[i]); vmax = Math.max(vmax, V[i]); }
  if (vmax - vmin === 0) return { V: Float64Array.from(V), step: Infinity };
  fft2(re, im, n, n, -1);
  const k = wavenumbers(n, dx), gauss = new Float64Array(N);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const q = Math.hypot(k[i], k[j]) / kc;
    const f = q <= 0.6 ? 1 : q >= 1 ? 0 : 0.5 * (1 + Math.cos((Math.PI * (q - 0.6)) / 0.4));
    gauss[j * n + i] = Math.exp(-0.5 * (k[i] * k[i] + k[j] * k[j]) * delta * delta);
    re[j * n + i] *= f; im[j * n + i] *= f;
  }
  fft2(re, im, n, n, +1);
  let worst = 0;
  for (let i = 0; i < N; i++) worst = Math.max(worst, Math.abs(re[i] / N - V[i]));
  if (!(worst > 2e-3 * (vmax - vmin))) return { V: Float64Array.from(V), step: Infinity };
  if (vmax - vmin > tall) {
    // Undo the cut and apply the Gaussian instead: from the unfiltered spectrum.
    const r2 = Float64Array.from(V), i2 = new Float64Array(N);
    fft2(r2, i2, n, n, -1);
    for (let i = 0; i < N; i++) { r2[i] *= gauss[i]; i2[i] *= gauss[i]; }
    fft2(r2, i2, n, n, +1);
    for (let i = 0; i < N; i++) r2[i] /= N;
    return { V: r2, step: 1.2 * delta * delta };
  }
  for (let i = 0; i < N; i++) re[i] /= N;
  return { V: re, step: 1.2 / (kc * kc) };
}

/**
 * Exact partial waves of a radially symmetric potential, from the time-independent radial
 * equation: with psi = R(r) e^{im theta} and u = sqrt(r) R,
 *     u'' = [2m(V(r) - E) + (m^2 - 1/4)/r^2] u      (hbar = mass = 1, E = k^2/2),
 * integrated outwards by Numerov's method from u ~ r^{|m|+1/2}, and matched beyond the
 * potential to sqrt(r) [A J_m(kr) + B Y_m(kr)]: tan delta_m = -B/A.  Returns [{m, Sre, Sim}]
 * for m = -mmax ... mmax (delta_{-m} = delta_m).  V is a function of an array of radii.
 */
export function radialWaves(V, k, mmax = 24, { h = 0.005, rmax } = {}) {
  // Where does the potential end?  Out to where |V| < 1e-8 of its largest value (at most 80).
  if (!rmax) {
    const rs = Float64Array.from({ length: 1600 }, (_, i) => 0.05 + i * 0.05), vs = V(rs);
    let vmax = 0;
    for (const v of vs) vmax = Math.max(vmax, Math.abs(v));
    rmax = 5;
    for (let i = 0; i < rs.length; i++) if (Math.abs(vs[i]) > 1e-8 * vmax) rmax = Math.max(rmax, rs[i] + 1);
    rmax = Math.min(rmax, 80);
  }
  const N = Math.ceil(rmax / h), r = Float64Array.from({ length: N + 1 }, (_, i) => (i + 1) * h);
  const Vr = V(r), out = [], k2 = k * k;
  const r1 = r[N - 8], r2 = r[N];
  const J1 = besselJ(mmax, k * r1), Y1 = besselY(mmax, k * r1), J2 = besselJ(mmax, k * r2), Y2 = besselY(mmax, k * r2);
  for (let m = 0; m <= mmax; m++) {
    const c = m * m - 0.25, f = (i) => 2 * Vr[i] - k2 + c / (r[i] * r[i]), w = (h * h) / 12;
    let u0 = Math.pow(r[0], m + 0.5), u1 = Math.pow(r[1], m + 0.5);
    let f0 = f(0), f1 = f(1), ua = 0;
    for (let i = 1; i < N; i++) {
      const f2 = f(i + 1);
      const u2 = (2 * u1 * (1 + 5 * w * f1) - u0 * (1 - w * f0)) / (1 - w * f2);
      u0 = u1; u1 = u2; f0 = f1; f1 = f2;
      if (i + 1 === N - 8) ua = u2;
      if (Math.abs(u1) > 1e200) { u0 *= 1e-200; u1 *= 1e-200; ua *= 1e-200; }
    }
    // u/sqrt(r) = A J + B Y at r1 and r2.
    const a1 = ua / Math.sqrt(r1), a2 = u1 / Math.sqrt(r2);
    const det = J1[m] * Y2[m] - J2[m] * Y1[m];
    const A = (a1 * Y2[m] - a2 * Y1[m]) / det, B = (J1[m] * a2 - J2[m] * a1) / det;
    const d = Math.atan2(-B, A);
    out[m] = { Sre: Math.cos(2 * d), Sim: Math.sin(2 * d) };
  }
  const waves = [];
  for (let m = -mmax; m <= mmax; m++) waves.push({ m, ...out[Math.abs(m)] });
  return waves;
}
