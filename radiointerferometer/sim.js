// The correlator's simulation, underneath every view: sources of noise, two receivers, a
// correlator.
//
// Every source k emits its own complex Gaussian noise s_k(t), independent of every other
// source (incoherent), band-limited to a width Δν around the carrier ν₀.  We work at baseband,
// with the complex envelope: the real voltage is x(t) = √2 Re[s(t) e^{2πiν₀t}] (the √2 makes
// ⟨x²⟩ = ⟨|s|²⟩, the source's brightness I, as the handout's I = V²/2 for a sine of amplitude V),
// and a delay τ of the real signal is the envelope shifted by τ times the phase e^{−2πiν₀τ}.
// Receiver j gets v_j(t) = Σ_k a_jk s_k(t − τ_jk) + n_j(t), with the geometric delay τ_jk and its
// own noise n_j.  The correlator forms, per chunk of M samples,
//
//     c = ⟨v_A v_B*⟩     (receiver A times the conjugate of B, at zero lag)
//
// and with the baseline (u, v) = (r_B − r_A)/λ pointing from A to B this converges to
// V(u, v) = Σ_k I_k e^{−2πi(u l_k + v m_k)}: the sky's Fourier transform with the textbook sign.
// Its real part is ⟨x_A x_B⟩, the average of the product of the two real voltages (the
// handout's correlation); its imaginary part is the same with B a quarter cycle later.  (The lab
// notebook conjugates A instead and gets e^{+2πi...}; nothing physical changes.)
//
// Units inside: times in carrier cycles, positions in wavelengths (u = x/λ), directions as
// direction cosines (l, m).  The envelope is sampled twice per cycle (dt = 1/2ν₀), so a chunk
// of M = 1024 samples is 512 cycles, and its frequency bins are 1/512 cycles⁻¹ apart across
// −ν₀..ν₀: "white" fills them, and the real signal then has a flat spectrum from 0 to 2ν₀.
// Bandwidths are fractions β = Δν/ν₀; the band is the 2h + 1 bins nearest the carrier, so
// that it is symmetric and the autocorrelation is real.
//
// Everything is made in the frequency domain: a white Gaussian process has white Gaussian
// Fourier coefficients, so each source is a vector of Gaussian bins inside its band, a delay is
// a phase ramp e^{−2πi(ν₀ + f)τ} across the bins (an honest shift of the envelope, so that with
// a wide band and a long baseline the envelopes stop overlapping and the correlation really
// dies), and the spectra, the cross-spectrum and the correlations against lag come out of the
// same bins.  The time streams the page shows are made by display.js, slowed down.

import { ifft } from '../lib/fft.js';

export const M = 1024;           // samples per chunk
export const CYCLES = M / 2;     // cycles per chunk
export const HISTORY = 100;      // chunk correlations kept for the complex-plane scatter
const TWO_PI = 2 * Math.PI;

/** sin(πx)/(πx): the coherence envelope of a flat band (its autocorrelation, for wide bands). */
export function sinc(x) { return x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x); }

/** Standard normal pairs by Box–Muller, with a replaceable uniform source (the tests seed it). */
export function gaussianPair(random) {
  let u1 = random();
  while (u1 <= 1e-300) u1 = random();
  const r = Math.sqrt(-2 * Math.log(u1)), t = TWO_PI * random();
  return [r * Math.cos(t), r * Math.sin(t)];
}

// A few hundred sources at a white band need 600,000 Gaussians a chunk, more than Box–Muller
// gives in a frame.  So the Gaussians come from a table of 65,536 of them, picked at random
// (independent draws from the table's empirical distribution), with 2,048 fresh ones written
// into it every chunk.
const TABLE = 1 << 16;
class Gaussians {
  constructor(random) {
    this.random = random;
    this.table = new Float64Array(TABLE);
    for (let i = 0; i < TABLE; i += 2) { const [a, b] = gaussianPair(random); this.table[i] = a; this.table[i + 1] = b; }
    this.next = 0;
  }
  refresh(count = 2048) {
    for (let i = 0; i < count; i += 2) { const [a, b] = gaussianPair(this.random); this.table[this.next] = a; this.table[(this.next + 1) % TABLE] = b; this.next = (this.next + 2) % TABLE; }
  }
  draw() { return this.table[(this.random() * TABLE) | 0]; }
}

/** The half-width h of a band of fractional width β on a grid of `cycles` cycles: the band is
 *  the 2h + 1 bins |q| ≤ h, 1/cycles apart, so its width is (2h + 1)/cycles. */
export function bandHalf(band, cycles) { return Math.max(1, Math.min(cycles - 1, Math.round((band * cycles - 1) / 2))); }

/** Bins of a chunk as baseband frequencies (ν − ν₀)/ν₀, from FFT index b. */
export function binFrequency(b) { return (b < M / 2 ? b : b - M) / CYCLES; }

export class Simulation {
  constructor() {
    this.random = Math.random;
    this.band = 0.1;            // Δν/ν₀ asked for (the band made is bandwidth(), the nearest odd number of bins)
    this.noise = 0.5;           // each receiver's own noise power (a source of brightness 1 has power 1)
    this.alpha = 0.05;          // the running average: avg += α (chunk − avg)
    this.tracking = true;       // the electronic delay towards the phase centre (and fringe stopping)
    this.coherent = false;      // every source fed the same noise, with a phase step between them
    this.coherentPhase = 0;     // radians between successive sources
    this.hbt = false;           // correlate intensities instead of voltages
    this.nearField = false;     // exact distances (sources at z) instead of plane waves
    this.lambda = 1;            // metres (only the near field needs it)
    this.pointing = { l: 0, m: 0 };      // the phase centre's direction cosines from the zenith
    this.sources = [{ l: 0, m: 0, I: 1 }];   // {l, m, I} far field; {x, y, z, I} (metres) near field
    this.receivers = [{ u: -2, v: 0 }, { u: 2, v: 0 }];   // positions in wavelengths
    this.gains = null;          // optional [[A's gain for each source], [B's]]: amplitudes (1 if absent)
    this.chunks = 0;
    this.alloc();
    this.reset();
  }

  alloc() {
    const n = M;
    this.VA = [new Float64Array(n), new Float64Array(n)];   // receivers' spectra (FFT order), this chunk
    this.VB = [new Float64Array(n), new Float64Array(n)];
    this.tA = [new Float64Array(n), new Float64Array(n)];   // and time samples (for the intensities)
    this.tB = [new Float64Array(n), new Float64Array(n)];
    this.partA = []; this.partB = [];                        // each source's own term at each receiver
    for (let k = 0; k < 8; k++) { this.partA.push([new Float64Array(n), new Float64Array(n)]); this.partB.push([new Float64Array(n), new Float64Array(n)]); }
    this.gRe = new Float64Array(n); this.gIm = new Float64Array(n); this.hRe = new Float64Array(n); this.hIm = new Float64Array(n);
    this.specAA = new Float64Array(n);                      // averaged auto-spectra (FFT order)
    this.specBB = new Float64Array(n);
    this.specAB = [new Float64Array(n), new Float64Array(n)];   // averaged cross-spectrum A·B*
    this.lagAA = null; this.lagBB = null; this.lagAB = null;  // correlations against lag, on the grid asked for
    this.history = [];                                      // the last HISTORY chunk correlations [re, im]
    this.bins = new Int32Array(n);
  }

  /** Forget the averages (after the band or the sources change). */
  reset() {
    this.avg = [0, 0];                 // the running average of the zero-lag correlation
    this.avgHbt = 0;                   // and of the intensity correlation
    this.avgSelf = [0, 0];             // the sum of each source's own term, averaged
    this.avgCross = [0, 0];            // the cross terms between different sources, averaged
    if (this.avgSelfK) this.avgSelfK.fill(0);
    this.powerA = 0; this.powerB = 0;  // averaged powers ⟨|v|²⟩
    this.specAA.fill(0); this.specBB.fill(0); this.specAB[0].fill(0); this.specAB[1].fill(0);
    this.history.length = 0;
    this.settled = 0;                  // chunks since the reset (the averages warm up over 1/α)
    this.lagsStale = true;
  }

  /** The chunk's frequency bins inside the band, |q| ≤ h, into this.bins (FFT index order).
   *  Returns the count, 2h + 1. */
  bandBins() {
    const h = bandHalf(this.band, CYCLES);
    let n = 0;
    for (let q = -h; q <= h; q++) this.bins[n++] = q < 0 ? q + M : q;
    return n;
  }

  /** The band actually made, as a fraction of ν₀: (2h + 1)/512. */
  bandwidth() { return (2 * bandHalf(this.band, CYCLES) + 1) / CYCLES; }

  /** The coherence of the band at a delay of d cycles: ⟨s(t) s*(t + d)⟩/⟨|s|²⟩, the Dirichlet
   *  kernel of the band's bins (≈ sinc(Δν d)).  Delays beyond half a chunk get fresh noise. */
  coherence(d) {
    if (Math.abs(d) > CYCLES / 2) return 0;
    const nb = 2 * bandHalf(this.band, CYCLES) + 1, x = (Math.PI * d) / CYCLES;
    const s = Math.sin(x);
    return Math.abs(s) < 1e-12 ? 1 : Math.sin(nb * x) / (nb * s);
  }

  /** The delay of source k's wavefront at a receiver at r = {u, v} (wavelengths), in carrier
   *  cycles (positive: later), and the amplitude factor.  Far field: τ = −(u l_k + v m_k) (the
   *  receiver nearer the source hears it first).  Near field: the exact distance, less the
   *  source's height, and the amplitude z/R, as in the lab notebook. */
  delayAt(r, k) {
    const s = this.sources[k];
    if (this.nearField && s.z !== undefined) {
      const L = this.lambda, x = r.u * L, y = r.v * L;
      const R = Math.hypot(x - s.x, y - s.y, s.z);
      return [(R - s.z) / L, s.z / R];
    }
    const [l, m] = this.direction(k);
    return [-(r.u * l + r.v * m), 1];
  }
  delay(j, k) { return this.delayAt(this.receivers[j], k); }

  /** The delay the correlator takes out of a receiver at r: towards the phase centre. */
  trackAt(r) {
    if (!this.tracking) return 0;
    const p = this.pointing;
    return -(r.u * p.l + r.v * p.m);
  }
  trackDelay(j) { return this.trackAt(this.receivers[j]); }

  gain(j, k) { return this.gains ? (this.gains[j][k] ?? 1) : 1; }

  /** Direction cosines of source k (near-field sources from where they are). */
  direction(k) {
    const s = this.sources[k];
    if (s.z !== undefined && s.l === undefined) { const R = Math.hypot(s.x, s.y, s.z); return [s.x / R, s.y / R]; }
    return [s.l, s.m];
  }

  /** The closed-form visibility of the sources at (u, v): V = Σ I_k e^{−2πi(u l_k + v m_k)}. */
  ideal(u, v) {
    let re = 0, im = 0;
    this.sources.forEach((s, k) => {
      const [l, m] = this.direction(k), ph = -TWO_PI * (u * l + v * m);
      re += s.I * Math.cos(ph); im += s.I * Math.sin(ph);
    });
    return [re, im];
  }

  /**
   * What the correlator converges to for receivers at rA and rB (receiver indices jA, jB for the
   * gains), with this band, delay tracking, geometry and coherence:
   *     Σ_k I_k a_Ak a_Bk γ(Δτ_k) e^{−2πi(τ'_Ak − τ'_Bk)}        (incoherent sources)
   * where τ' is the delay left after the electronic delay, Δτ = τ'_Ak − τ'_Bk and γ the band's
   * coherence; for coherent sources the double sum over pairs of sources, which depends on where
   * the pair sits and not only on its separation.  With rA = rB it is the power the receiver
   * gets from the sources (add the receiver's noise for its total power).  only ≥ 0: that one
   * source's share alone.
   */
  expectedAt(rA, rB, jA = 0, jB = 1, only = -1) {
    const K = this.sources.length, tA = this.trackAt(rA), tB = this.trackAt(rB);
    const dA = [], dB = [];
    for (let k = 0; k < K; k++) { dA.push(this.delayAt(rA, k)); dB.push(this.delayAt(rB, k)); }
    let re = 0, im = 0;
    const term = (k, kk) => {
      const a = dA[k][0] - tA, b = dB[kk][0] - tB;
      const amp = Math.sqrt(this.sources[k].I * this.sources[kk].I) * dA[k][1] * dB[kk][1] * this.gain(jA, k) * this.gain(jB, kk) * this.coherence(a - b);
      let ph = -TWO_PI * (a - b);
      if (this.coherent) ph += this.coherentPhase * (k - kk);
      re += amp * Math.cos(ph); im += amp * Math.sin(ph);
    };
    for (let k = 0; k < K; k++) {
      if (only >= 0 && k !== only) continue;
      if (this.coherent && only < 0) for (let kk = 0; kk < K; kk++) term(k, kk);
      else term(k, k);
    }
    return [re, im];
  }
  expected() { return this.expectedAt(this.receivers[0], this.receivers[1]); }
  /** The power a receiver at r (index j) gets: the sources' share and its own noise. */
  powerAt(r, j = 0) { return this.expectedAt(r, r, j, j)[0] + this.noise; }

  /** The baseline (u, v) = (r_B − r_A)/λ. */
  baseline() { return [this.receivers[1].u - this.receivers[0].u, this.receivers[1].v - this.receivers[0].v]; }

  /** One chunk of time: make the sources' noise, delay it to each receiver, correlate. */
  step() {
    const K = this.sources.length, n = M, nb = this.bandBins(), bins = this.bins;
    const VA = this.VA, VB = this.VB;
    VA[0].fill(0); VA[1].fill(0); VB[0].fill(0); VB[1].fill(0);
    const rA = this.receivers[0], rB = this.receivers[1], tA = this.trackAt(rA), tB = this.trackAt(rB);
    // Each source's own terms at each receiver, for the self/cross decomposition (few sources only).
    const decompose = K <= 8 && !this.coherent;
    if (!this.gauss || this.gauss.random !== this.random) this.gauss = new Gaussians(this.random);
    const G = this.gauss;
    G.refresh();
    // One realisation shared by every source when they are coherent.
    let shared = null;
    if (this.coherent) { shared = [new Float64Array(nb), new Float64Array(nb)]; for (let i = 0; i < nb; i++) { shared[0][i] = G.draw(); shared[1][i] = G.draw(); } }
    const scale = n / Math.sqrt(2 * nb);     // so that ⟨|s|²⟩ = I whatever the band
    const gRe = this.gRe, gIm = this.gIm, hRe = this.hRe, hIm = this.hIm;
    for (let k = 0; k < K; k++) {
      const s = this.sources[k], a = Math.sqrt(s.I) * scale;
      if (shared) {
        const c = Math.cos(this.coherentPhase * k), d = Math.sin(this.coherentPhase * k);
        for (let i = 0; i < nb; i++) { gRe[i] = a * (shared[0][i] * c - shared[1][i] * d); gIm[i] = a * (shared[0][i] * d + shared[1][i] * c); }
      } else {
        for (let i = 0; i < nb; i++) { gRe[i] = a * G.draw(); gIm[i] = a * G.draw(); }
      }
      // Receiver A: the carrier phase of its delay; B: the carrier phase and the envelope shifted
      // by the delay relative to A (only differences matter), less what the correlator tracks out.
      const [dA, aA0] = this.delayAt(rA, k), [dB, aB0] = this.delayAt(rB, k);
      const aA = aA0 * this.gain(0, k), aB = aB0 * this.gain(1, k);
      const rel = (dB - tB) - (dA - tA);
      let src = [gRe, gIm];
      if (Math.abs(rel) > CYCLES / 2) {
        // Further apart than half a chunk: the envelopes share nothing, so B gets fresh noise
        // (a circular shift would wrap round and pretend they overlap again).
        for (let i = 0; i < nb; i++) { hRe[i] = a * G.draw(); hIm[i] = a * G.draw(); }
        src = [hRe, hIm];
      }
      const phA = -TWO_PI * (dA - tA), cA = aA * Math.cos(phA), sA = aA * Math.sin(phA);
      const phB = -TWO_PI * (dB - tB), cB = aB * Math.cos(phB), sB = aB * Math.sin(phB);
      // The envelope shift: e^{−2πi f rel} across the bins (f = q/512 cycles⁻¹), by a running twiddle.
      const dth = (-TWO_PI * rel) / CYCLES, wc = Math.cos(dth), ws = Math.sin(dth);
      const q0 = bins[0] >= n / 2 ? bins[0] - n : bins[0];
      let tr = Math.cos(dth * q0), ti = Math.sin(dth * q0);
      const pa = decompose ? this.partA[k] : null, pb = decompose ? this.partB[k] : null;
      for (let i = 0; i < nb; i++) {
        const b = bins[i], xr = gRe[i], xi = gIm[i];
        const ar = cA * xr - sA * xi, ai = cA * xi + sA * xr;
        VA[0][b] += ar; VA[1][b] += ai;
        // B: (c_B + i s_B) (t_r + i t_i) applied to src.
        const yr = src[0][i], yi = src[1][i];
        const rr = cB * tr - sB * ti, ri = cB * ti + sB * tr;
        const br = rr * yr - ri * yi, bi = rr * yi + ri * yr;
        VB[0][b] += br; VB[1][b] += bi;
        if (decompose) { pa[0][b] = ar; pa[1][b] = ai; pb[0][b] = br; pb[1][b] = bi; }
        const nr = tr * wc - ti * ws; ti = tr * ws + ti * wc; tr = nr;
      }
    }
    // The receivers' own noise, in the same band.
    const sn = Math.sqrt(this.noise) * scale;
    if (this.noise > 0) for (let i = 0; i < nb; i++) {
      const b = bins[i];
      VA[0][b] += sn * G.draw(); VA[1][b] += sn * G.draw();
      VB[0][b] += sn * G.draw(); VB[1][b] += sn * G.draw();
    }
    // The correlator, in the frequency domain: ⟨v_A v_B*⟩ = (1/M²) Σ V_A V_B* (Parseval).
    let cr = 0, ci = 0, pA = 0, pB = 0;
    for (let i = 0; i < nb; i++) {
      const b = bins[i], ar = VA[0][b], ai = VA[1][b], br = VB[0][b], bi = VB[1][b];
      cr += ar * br + ai * bi; ci += ai * br - ar * bi;
      pA += ar * ar + ai * ai; pB += br * br + bi * bi;
    }
    const inv = 1 / (n * n);
    cr *= inv; ci *= inv; pA *= inv; pB *= inv;
    // Each source's own term and the cross terms between different sources.
    let selfR = 0, selfI = 0, crossR = 0, crossI = 0;
    if (!this.chunkSelfK || this.chunkSelfK.length !== 2 * K) { this.chunkSelfK = new Float64Array(2 * K); this.avgSelfK = new Float64Array(2 * K); }
    if (decompose) {
      for (let k = 0; k < K; k++) for (let kk = 0; kk < K; kk++) {
        let xr = 0, xi = 0;
        const A = this.partA[k], B = this.partB[kk];
        for (let i = 0; i < nb; i++) { const b = bins[i]; xr += A[0][b] * B[0][b] + A[1][b] * B[1][b]; xi += A[1][b] * B[0][b] - A[0][b] * B[1][b]; }
        if (k === kk) { selfR += xr * inv; selfI += xi * inv; this.chunkSelfK[2 * k] = xr * inv; this.chunkSelfK[2 * k + 1] = xi * inv; } else { crossR += xr * inv; crossI += xi * inv; }
      }
    }
    // The intensities' correlation, ⟨(|v_A|² − P_A)(|v_B|² − P_B)⟩, from the chunk's time samples.
    let hbt = 0;
    if (this.hbt) {
      const a = this.tA, b = this.tB;
      a[0].set(VA[0]); a[1].set(VA[1]); ifft(a[0], a[1]);
      b[0].set(VB[0]); b[1].set(VB[1]); ifft(b[0], b[1]);
      let mA = 0, mB = 0;
      for (let t = 0; t < n; t++) { mA += a[0][t] * a[0][t] + a[1][t] * a[1][t]; mB += b[0][t] * b[0][t] + b[1][t] * b[1][t]; }
      mA /= n; mB /= n;
      for (let t = 0; t < n; t++) hbt += (a[0][t] * a[0][t] + a[1][t] * a[1][t] - mA) * (b[0][t] * b[0][t] + b[1][t] * b[1][t] - mB);
      hbt /= n;
    }
    // Running averages: a true mean over the first 1/α chunks, then the single-pole filter.
    const al = this.settled < 1 / this.alpha ? Math.max(this.alpha, 1 / (this.settled + 1)) : this.alpha;
    this.settled++;
    this.chunks++;
    this.chunk = [cr, ci]; this.chunkHbt = hbt; this.chunkSelf = [selfR, selfI]; this.chunkCross = [crossR, crossI];
    this.chunkPowerA = pA; this.chunkPowerB = pB;
    this.avg[0] += al * (cr - this.avg[0]); this.avg[1] += al * (ci - this.avg[1]);
    this.avgHbt += al * (hbt - this.avgHbt);
    this.avgSelf[0] += al * (selfR - this.avgSelf[0]); this.avgSelf[1] += al * (selfI - this.avgSelf[1]);
    this.avgCross[0] += al * (crossR - this.avgCross[0]); this.avgCross[1] += al * (crossI - this.avgCross[1]);
    for (let i = 0; i < 2 * K; i++) this.avgSelfK[i] += al * (this.chunkSelfK[i] - this.avgSelfK[i]);
    this.powerA += al * (pA - this.powerA); this.powerB += al * (pB - this.powerB);
    const sAA = this.specAA, sBB = this.specBB, sAB = this.specAB;
    for (let i = 0; i < nb; i++) {
      const b = bins[i], ar = VA[0][b], ai = VA[1][b], br = VB[0][b], bi = VB[1][b];
      sAA[b] += al * ((ar * ar + ai * ai) * inv - sAA[b]);
      sBB[b] += al * ((br * br + bi * bi) * inv - sBB[b]);
      sAB[0][b] += al * ((ar * br + ai * bi) * inv - sAB[0][b]);
      sAB[1][b] += al * ((ai * br - ar * bi) * inv - sAB[1][b]);
    }
    this.history.push(this.hbt ? [hbt, 0] : [cr, ci]);
    if (this.history.length > HISTORY) this.history.shift();
    this.lagsStale = true;
    return this.chunk;
  }

  /**
   * The averaged correlations against lag on a grid of `points` lags from −tauMax to tauMax
   * (cycles), all as R_XY(τ) = ⟨v_X(t) v_Y*(t + τ)⟩ = Σ_b S_XY(b) e^{−2πi f_b τ}: R_AA and R_BB,
   * and R_AB, which peaks at the lag by which B's copy of a source arrives after A's.  The real
   * voltages' correlation is Re[R(τ) e^{−2πiν₀τ}].  Summed directly over the band's bins (the
   * band-limited interpolation of the chunk's periodic correlation).  Kept until the next chunk.
   */
  lags(tauMax, points) {
    if (!this.lagsStale && this.lagAA && this.lagAA.tauMax === tauMax && this.lagAA[0].length === points) return;
    this.lagsStale = false;
    const nb = this.bandBins(), bins = this.bins, n = M;
    const mk = (old) => (old && old[0].length === points ? old : [new Float64Array(points), new Float64Array(points)]);
    const AA = this.lagAA = mk(this.lagAA), BB = this.lagBB = mk(this.lagBB), AB = this.lagAB = mk(this.lagAB);
    AA.tauMax = BB.tauMax = AB.tauMax = tauMax;
    for (const X of [AA, BB, AB]) { X[0].fill(0); X[1].fill(0); }
    const sAA = this.specAA, sBB = this.specBB, sAB = this.specAB;
    for (let i = 0; i < nb; i++) {
      const b = bins[i], f = (b < n / 2 ? b : b - n) / CYCLES;    // cycles⁻¹
      const a = sAA[b], bb = sBB[b], cr = sAB[0][b], ci = sAB[1][b];
      // e^{−2πi f τ} at τ = −tauMax + p·step, by a running twiddle.
      const dth = (-TWO_PI * f * 2 * tauMax) / (points - 1), wc = Math.cos(dth), ws = Math.sin(dth);
      let tr = Math.cos(TWO_PI * f * tauMax), ti = Math.sin(TWO_PI * f * tauMax);
      for (let p = 0; p < points; p++) {
        AA[0][p] += a * tr; AA[1][p] += a * ti;
        BB[0][p] += bb * tr; BB[1][p] += bb * ti;
        AB[0][p] += cr * tr - ci * ti; AB[1][p] += cr * ti + ci * tr;
        const nr = tr * wc - ti * ws; ti = tr * ws + ti * wc; tr = nr;
      }
    }
  }

  /** The radiometer scatter of one chunk's correlation: with N = Δν T = (2h + 1) independent
   *  samples per chunk, each of Re and Im of the chunk's average has σ² = P_A P_B / 2N. */
  chunkScatter() {
    const N = 2 * bandHalf(this.band, CYCLES) + 1;
    return Math.sqrt((this.powerA * this.powerB) / (2 * N));
  }
}
