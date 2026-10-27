// Time evolution on the drum's grid, and the spectroscopist's tools: a recorded signal, its
// windowed Fourier transform, and the eigenmode filter.  No DOM.
//
// Both physical readings share the 5-point Laplacian of the mask (A = −∇², zero on the walls):
//
//   the drum           u_tt = −c² A u                 leapfrog:  u⁺ = 2u − u⁻ − (c dt)² A u
//   the billiard       i ψ_t = ½ A ψ   (ħ = m = 1)    Visscher:  R += dt·½A I,  I −= dt·½A R
//
// with R = Re ψ at whole steps and I = Im ψ half a step later.  Each scheme is explicit, second
// order, and stable below a step size it states; each conserves a discrete energy (norm)
// exactly, which the tests check.  For an eigenmode Aφ = λφ they turn at exactly known rates,
//
//   leapfrog:   sin(Ω dt/2) = (c dt/2) √λ        Visscher:   sin(Ω dt/2) = (dt/2) λ/2,
//
// so a measured frequency Ω converts back to λ with no time-step error at all (trueOmega below):
// the only error left is the grid's own (A against the continuum −∇²).

/**
 * The grid of a drum.  mask: Uint8Array(n*n) with 1 for free points (the outer ring is forced to
 * be a wall).  Coordinates: x_i = −1/2 + i h, y_j = −1/2 + j h, h = 1/(n − 1).
 */
export class Grid {
  constructor(n, mask) {
    this.n = n;
    this.h = 1 / (n - 1);
    this.mask = mask;
    for (let i = 0; i < n; i++) { mask[i] = 0; mask[(n - 1) * n + i] = 0; mask[i * n] = 0; mask[i * n + n - 1] = 0; }
    const inner = [], runs = [];
    for (let g = 0; g < n * n; g++) {
      if (!mask[g]) continue;
      inner.push(g);
      if (!mask[g - 1]) runs.push(g, g + 1); else runs[runs.length - 1] = g + 1;
    }
    this.inner = Int32Array.from(inner);
    // The free points as runs [start, end) along the rows: the steppers sweep these, so the
    // loops read memory in order with no indirection.
    this.runs = Int32Array.from(runs);
    this.N = inner.length;
    this.area = this.N * this.h * this.h;
  }
  x(i) { return -0.5 + i * this.h; }
  /** Grid point nearest to (x, y), or −1 outside the grid. */
  nearest(x, y) {
    const i = Math.round((x + 0.5) / this.h), j = Math.round((y + 0.5) / this.h);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }
  /** Σ a·b h² over the free points (b may be null: Σ a² h²). */
  dot(a, b = a) {
    let s = 0;
    for (const g of this.inner) s += a[g] * b[g];
    return s * this.h * this.h;
  }
}

/** out = −∇²u (5-point, zero on the walls) at the free points. */
export function minusLaplacian(grid, u, out) {
  const { n, inner } = grid, s = 1 / (grid.h * grid.h);
  for (let k = 0; k < inner.length; k++) {
    const g = inner[k];
    out[g] = (4 * u[g] - u[g - 1] - u[g + 1] - u[g - n] - u[g + n]) * s;
  }
  return out;
}

/** A Gaussian bump exp(−r²/2w²) centred on (x0, y0), zero on the walls. */
export function bump(grid, x0, y0, w, out = new Float64Array(grid.n * grid.n)) {
  out.fill(0);
  const { n, h } = grid, k = 1 / (2 * w * w);
  for (const g of grid.inner) {
    const x = -0.5 + (g % n) * h - x0, y = -0.5 + Math.floor(g / n) * h - y0;
    out[g] = Math.exp(-(x * x + y * y) * k);
  }
  return out;
}

// --------------------------------------------------------------------- the drum

export class Membrane {
  /** c: wave speed; courant: c dt / h (stable below 1/√2). */
  constructor(grid, { c = 1, courant = 0.5 } = {}) {
    this.grid = grid;
    this.c = c;
    this.dt = (courant * grid.h) / c;
    const N = grid.n * grid.n;
    this.u = new Float64Array(N);      // u at step n
    this.uOld = new Float64Array(N);   // u at step n − 1
    this.t = 0;
  }
  /** Struck: u = 0, velocity v0 (a grid array).  Centred start: u⁻ = −dt v0. */
  strike(v0) {
    this.u.fill(0);
    for (const g of this.grid.inner) this.uOld[g] = -this.dt * v0[g];
    this.t = 0;
  }
  /** Released from rest in the shape f. */
  release(f) {
    const lap = minusLaplacian(this.grid, f, new Float64Array(f.length));
    const k = 0.5 * (this.c * this.dt) ** 2;
    this.u.fill(0); this.uOld.fill(0);
    for (const g of this.grid.inner) { this.u[g] = f[g]; this.uOld[g] = f[g] - k * lap[g]; }
    this.t = 0;
  }
  step() {
    const { n, runs } = this.grid, u = this.u, o = this.uOld;
    const k = (this.c * this.dt / this.grid.h) ** 2, k4 = 2 - 4 * k;
    for (let r = 0; r < runs.length; r += 2) {
      for (let g = runs[r], end = runs[r + 1]; g < end; g++) {
        o[g] = k4 * u[g] - o[g] + k * (u[g - 1] + u[g + 1] + u[g - n] + u[g + n]);
      }
    }
    this.uOld = u; this.u = o;
    this.t += this.dt;
  }
  /** The velocity at the half step, (u − u⁻)/dt. */
  velocity(out = new Float64Array(this.u.length)) {
    for (const g of this.grid.inner) out[g] = (this.u[g] - this.uOld[g]) / this.dt;
    return out;
  }
  /** The leapfrog's exactly conserved energy: ½|(u − u⁻)/dt|² + ½c²⟨u, A u⁻⟩. */
  energy() {
    const { grid } = this;
    const v = this.velocity();
    const Au = minusLaplacian(grid, this.uOld, new Float64Array(this.u.length));
    return 0.5 * grid.dot(v) + 0.5 * this.c * this.c * grid.dot(this.u, Au);
  }
  /** The true ω of a mode whose numerical angular frequency is Ω (see the top of the file). */
  trueOmega(Omega) { return (2 / this.dt) * Math.sin(Math.min(Math.PI / 2, (Omega * this.dt) / 2)); }
  numericalOmega(omega) { return (2 / this.dt) * Math.asin(Math.min(1, (omega * this.dt) / 2)); }
}

// --------------------------------------------------------------------- the billiard

export class Billiard {
  /** dt in units of h² (stable below 1/2). */
  constructor(grid, { step = 0.45 } = {}) {
    this.grid = grid;
    this.dt = step * grid.h * grid.h;
    const N = grid.n * grid.n;
    this.re = new Float64Array(N);     // Re ψ at step n
    this.im = new Float64Array(N);     // Im ψ at step n + 1/2
    this.imOld = new Float64Array(N);  // Im ψ at step n − 1/2
    this.t = 0;
  }
  /** Start from ψ = re + i im (grid arrays), at t = 0. */
  set(re, im) {
    const { grid } = this;
    const H = minusLaplacian(grid, re, new Float64Array(re.length));
    this.re.fill(0); this.im.fill(0); this.imOld.fill(0);
    // Im ψ(±dt/2) = Im ψ(0) ∓ (dt/2) H Re ψ(0), with H = A/2.
    for (const g of grid.inner) {
      this.re[g] = re[g];
      this.im[g] = im[g] - 0.25 * this.dt * H[g];
      this.imOld[g] = im[g] + 0.25 * this.dt * H[g];
    }
    this.t = 0;
  }
  step() {
    const { n, runs } = this.grid, R = this.re, I = this.im, O = this.imOld;
    const k = (0.5 * this.dt) / (this.grid.h * this.grid.h), k4 = 4 * k;
    for (let r = 0; r < runs.length; r += 2) {
      for (let g = runs[r], end = runs[r + 1]; g < end; g++) R[g] += k4 * I[g] - k * (I[g - 1] + I[g + 1] + I[g - n] + I[g + n]);
    }
    for (let r = 0; r < runs.length; r += 2) {
      for (let g = runs[r], end = runs[r + 1]; g < end; g++) {
        const v = I[g];
        O[g] = v;
        I[g] = v - k4 * R[g] + k * (R[g - 1] + R[g + 1] + R[g - n] + R[g + n]);
      }
    }
    this.t += this.dt;
  }
  /** Im ψ at the whole step (the mean of the two half steps). */
  imNow(g) { return 0.5 * (this.im[g] + this.imOld[g]); }
  /** Visscher's exactly conserved norm: Σ R² + I⁺ I⁻. */
  norm() {
    let s = 0;
    for (const g of this.grid.inner) s += this.re[g] * this.re[g] + this.im[g] * this.imOld[g];
    return s * this.grid.h * this.grid.h;
  }
  /** The true energy E = λ/2 of a mode turning at the numerical rate Ω. */
  trueOmega(Omega) { return (2 / this.dt) * Math.sin(Math.min(Math.PI / 2, (Omega * this.dt) / 2)); }
  numericalOmega(E) { return (2 / this.dt) * Math.asin(Math.min(1, (E * this.dt) / 2)); }
}

/**
 * A Gaussian packet ψ = exp(−|r − r0|²/4σ² + i k·r), zero on the walls, normalised (Σ|ψ|²h² = 1).
 * σ is the spread of |ψ|² in each direction.  Given the shape's signed distance sdf, the packet
 * is brought smoothly to zero within 2σ of the wall (a packet cut off sharply by a wall would
 * have a kink there, and with it a long tail of high energies).
 */
export function packet(grid, x0, y0, kx, ky, sigma, sdf = null) {
  const { n, h } = grid, N = n * n, re = new Float64Array(N), im = new Float64Array(N);
  const a = 1 / (4 * sigma * sigma), w = 2 * sigma;
  for (const g of grid.inner) {
    const x = -0.5 + (g % n) * h, y = -0.5 + Math.floor(g / n) * h;
    const dx = x - x0, dy = y - y0, ph = kx * dx + ky * dy;
    let env = Math.exp(-(dx * dx + dy * dy) * a);
    if (sdf && env > 1e-8) { const d = sdf(x, y) + 0.5 * h; env *= d <= 0 ? 0 : d >= w ? 1 : Math.sin((0.5 * Math.PI * d) / w) ** 2; }
    re[g] = env * Math.cos(ph); im[g] = env * Math.sin(ph);
  }
  normalise(grid, re, im);
  return [re, im];
}

/**
 * A random state, smoothed to wavelengths longer than about 2π/kmax, normalised.  Given the
 * shape's signed distance, it is brought smoothly to zero near the walls (over 1.5/kmax), so it
 * has no kink there and no long tail of high energies.
 */
export function randomState(grid, kmax, seed = 1, complex = true, sdf = null) {
  const { n, h } = grid, N = n * n;
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 - 0.5; };
  const out = [new Float64Array(N), complex ? new Float64Array(N) : null];
  // Smooth white noise with a separable Gaussian of width 1/kmax.
  const w = Math.max(0.6, 1 / (kmax * h)), reach = Math.ceil(3 * w), ker = [];
  for (let d = -reach; d <= reach; d++) ker.push(Math.exp(-(d * d) / (2 * w * w)));
  for (const f of out) {
    if (!f) continue;
    const tmp = new Float64Array(N);
    for (const g of grid.inner) f[g] = rnd();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      let v = 0;
      for (let d = -reach; d <= reach; d++) { const ii = i + d; if (ii >= 0 && ii < n) v += ker[d + reach] * f[j * n + ii]; }
      tmp[j * n + i] = v;
    }
    f.fill(0);
    for (const g of grid.inner) {
      const i = g % n, j = (g - i) / n;
      let v = 0;
      for (let d = -reach; d <= reach; d++) { const jj = j + d; if (jj >= 0 && jj < n) v += ker[d + reach] * tmp[jj * n + i]; }
      f[g] = v;
    }
  }
  if (sdf) {
    const wt = 1.5 / kmax;
    for (const g of grid.inner) {
      const d = sdf(-0.5 + (g % n) * h, -0.5 + Math.floor(g / n) * h);
      const t = d <= 0 ? 0 : d >= wt ? 1 : Math.sin((0.5 * Math.PI * d) / wt) ** 2;
      out[0][g] *= t; if (out[1]) out[1][g] *= t;
    }
  }
  normalise(grid, out[0], out[1]);
  return out;
}

export function normalise(grid, re, im) {
  const s = Math.sqrt(grid.dot(re) + (im ? grid.dot(im) : 0));
  if (s > 0) for (const g of grid.inner) { re[g] /= s; if (im) im[g] /= s; }
}

/** ⟨H⟩ and ⟨H²⟩ − ⟨H⟩² of a state for H = A/2 (or ⟨A⟩, var A with scale 1). */
export function energyStats(grid, re, im, scale = 0.5) {
  const N = re.length, a = minusLaplacian(grid, re, new Float64Array(N)), b = im ? minusLaplacian(grid, im, new Float64Array(N)) : null;
  const nrm = grid.dot(re) + (im ? grid.dot(im) : 0);
  const mean = (grid.dot(re, a) + (im ? grid.dot(im, b) : 0)) / nrm;
  const sq = (grid.dot(a) + (im ? grid.dot(b) : 0)) / nrm;
  return { mean: scale * mean, spread: scale * Math.sqrt(Math.max(0, sq - mean * mean)) };
}

// --------------------------------------------------------------------- the spectroscopist

/**
 * The window w(x) = 16 x²(1 − x)² on 0 ≤ x ≤ 1: like Hann's (its transform's side lobes fall off
 * as 1/ω³), but a polynomial in t, so that a windowed time integral over [0, T] can be updated
 * as T grows from a few running moments (see ModeFilter).  ∫w dx = 8/15.
 */
export const window = (x) => (x <= 0 || x >= 1 ? 0 : 16 * x * x * (1 - x) * (1 - x));
export const WINDOW_MEAN = 8 / 15;
/** Full width at half maximum of |ŵ(ω)| for a window of length T is WINDOW_FWHM / T. */
export const WINDOW_FWHM = 2 * Math.PI * 1.904;

/**
 * A signal recorded every dtSample: complex (re, im) or real.  spectrum() is its windowed
 * Fourier transform S(Ω) = |Σ s(t) e^{iΩt} w(t/T) Δt| / ∫w dt, for Ω ≥ 0 — a sum of peaks of
 * height |c_k| at the frequencies present in the signal.
 */
export class Signal {
  constructor(dtSample, complex = true, capacity = 1 << 14) {
    this.dts = dtSample; this.complex = complex;
    this.re = new Float64Array(capacity); this.im = complex ? new Float64Array(capacity) : null;
    this.length = 0;
  }
  push(re, im = 0) {
    if (this.length === this.re.length) {
      const grow = (a) => { const b = new Float64Array(a.length * 2); b.set(a); return b; };
      this.re = grow(this.re); if (this.im) this.im = grow(this.im);
    }
    this.re[this.length] = re; if (this.im) this.im[this.length] = im;
    this.length++;
  }
  get T() { return this.length * this.dts; }
  /**
   * The windowed transform on [0, Ωmax], zero-padded so that the bins are at most dΩ apart.
   * Returns { omega: Float64Array, amp: Float64Array } (bins 0 .. Ωmax).
   */
  spectrum(fft, OmegaMax, dOmega) {
    const K = this.length;
    if (K < 8) return { omega: new Float64Array(0), amp: new Float64Array(0) };
    let P = 1;
    while (P < 4 * K || (2 * Math.PI) / (P * this.dts) > dOmega) P *= 2;
    const re = new Float64Array(P), im = new Float64Array(P);
    for (let k = 0; k < K; k++) {
      const w = window((k + 0.5) / K);
      // e^{+iΩt} is the inverse transform: conjugate the input of the forward one.
      re[k] = this.re[k] * w; im[k] = this.im ? -this.im[k] * w : 0;
    }
    fft(re, im);
    const dO = (2 * Math.PI) / (P * this.dts), bins = Math.min(P / 2, Math.ceil(OmegaMax / dO) + 1);
    const omega = new Float64Array(bins), amp = new Float64Array(bins);
    const norm = 1 / (K * WINDOW_MEAN);
    for (let j = 0; j < bins; j++) { omega[j] = j * dO; amp[j] = Math.hypot(re[j], im[j]) * norm; }
    return { omega, amp };
  }
}

/**
 * Peaks of a spectrum: local maxima above `floor` × the largest, at sub-bin positions
 * (a parabola through the logarithms of the three highest bins; exact for a Gaussian peak).
 */
export function findPeaks(omega, amp, floor = 0.03) {
  let top = 0;
  for (let j = 1; j < amp.length; j++) top = Math.max(top, amp[j]);
  const out = [];
  for (let j = 2; j < amp.length - 1; j++) {
    if (!(amp[j] > amp[j - 1] && amp[j] >= amp[j + 1] && amp[j] > floor * top)) continue;
    const a = Math.log(amp[j - 1] + 1e-300), b = Math.log(amp[j]), c = Math.log(amp[j + 1] + 1e-300);
    const d = a - 2 * b + c, off = d < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)) : 0;
    const dO = omega[1] - omega[0];
    out.push({ omega: omega[j] + off * dO, amp: Math.exp(b - 0.25 * (a - c) * off), bin: j });
  }
  return out;
}

/**
 * The eigenmode filter: φ_Ω ∝ ∫ ψ(t) e^{iΩt} w((t − t0)/T) dt, updated as T = t − t0 grows.  With
 * w = 16τ²(T − τ)²/T⁴ (τ = t − t0) the integral is (16/T⁴)(T² M₂ − 2T M₃ + M₄) with the running
 * moments M_k = ∫ ψ e^{iΩt} τ^k dt, so the filtered mode can be shown at every moment of the
 * run, sharpening as the window lengthens.  Divided by ∫w = 8T/15, it tends to the projection of
 * ψ onto the eigenmodes with frequency Ω (all others average away, as 1/(T ΔΩ)³).
 */
export class ModeFilter {
  constructor(grid, Omega, t0) {
    this.grid = grid; this.Omega = Omega; this.t0 = t0; this.T = 0;
    const N = grid.n * grid.n;
    this.m = Array.from({ length: 6 }, () => new Float64Array(N)); // M2, M3, M4: re, im
    this.samples = 0;
  }
  /**
   * Add ψ(t) (re, im: grid arrays; im null for a real field) with weight dt.  (The billiard's
   * Im ψ is half a step later than Re ψ: that turns each eigencomponent by a constant phase and
   * leaves a mirror image at −Ω a hundredth as large, which the filter removes anyway.)
   */
  add(t, dt, re, im) {
    const tau = t - this.t0, c = Math.cos(this.Omega * t) * dt, s = Math.sin(this.Omega * t) * dt;
    const t2 = tau * tau, t3 = t2 * tau, t4 = t3 * tau;
    const [m2r, m2i, m3r, m3i, m4r, m4i] = this.m;
    const inner = this.grid.inner;
    for (let k = 0; k < inner.length; k++) {
      const g = inner[k], a = re[g], b = im ? im[g] : 0;
      const zr = a * c - b * s, zi = a * s + b * c;
      m2r[g] += zr * t2; m2i[g] += zi * t2;
      m3r[g] += zr * t3; m3i[g] += zi * t3;
      m4r[g] += zr * t4; m4i[g] += zi * t4;
    }
    this.T = tau;
    this.samples++;
  }
  /** The filtered mode (re, im grid arrays), normalised by ∫w dt. */
  result() {
    const T = Math.max(this.T, 1e-12), N = this.grid.n * this.grid.n;
    const a = 16 / (T * T) / ((8 * T) / 15), b = (-32 / (T * T * T)) / ((8 * T) / 15), c = (16 / (T * T * T * T)) / ((8 * T) / 15);
    const re = new Float64Array(N), im = new Float64Array(N);
    const [m2r, m2i, m3r, m3i, m4r, m4i] = this.m;
    for (const g of this.grid.inner) {
      re[g] = a * m2r[g] + b * m3r[g] + c * m4r[g];
      im[g] = a * m2i[g] + b * m3i[g] + c * m4i[g];
    }
    return [re, im];
  }
}

/**
 * A complex field made as real as possible: multiplied by the phase that maximises Σ (Re)², so a
 * filtered eigenmode (a complex constant times a real function) can be drawn with its nodal
 * lines.  Returns the real part and the fraction of |ψ|² it holds (1 for a single real mode).
 */
export function realPart(grid, re, im) {
  // Σ (Re e^{−iα}ψ)² is largest at α = ½ arg Σ ψ².
  let sr = 0, si = 0, tot = 0;
  for (const g of grid.inner) { sr += re[g] * re[g] - im[g] * im[g]; si += 2 * re[g] * im[g]; tot += re[g] * re[g] + im[g] * im[g]; }
  const al = 0.5 * Math.atan2(si, sr), c = Math.cos(al), s = Math.sin(al);
  const out = new Float64Array(re.length);
  let kept = 0, big = 0;
  for (const g of grid.inner) { out[g] = re[g] * c + im[g] * s; kept += out[g] * out[g]; if (Math.abs(out[g]) > Math.abs(big)) big = out[g]; }
  if (big < 0) for (const g of grid.inner) out[g] = -out[g];
  return { field: out, fraction: tot > 0 ? kept / tot : 0 };
}
