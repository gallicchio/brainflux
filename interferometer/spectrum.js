// Light sources and the interferograms they make in a Michelson interferometer.
//
// Units: the wavenumber σ = 1/λ is in μm⁻¹ (632.8 nm is σ = 1.580 μm⁻¹); path differences Δ are in
// μm.  A spectrum S(σ) is power per unit wavenumber, the sum of
//   - lines: Gaussians of area A, centre s and standard deviation w (lasers, lamps, bands), and
//   - a continuum: values v_i at σ_i = s0 + i ds joined by straight lines, i.e. a sum of
//     triangles v_i Λ((σ - σ_i)/ds) (what is drawn with the mouse).
// With path difference Δ the two beams of a Michelson add to
//     I(Δ) = ∫ S(σ) [1 + cos 2πσΔ] dσ = I0 + Re Γ(Δ),     Γ(Δ) = ∫ S(σ) e^{2πiσΔ} dσ,
// I0 = ∫ S dσ, and both kinds of piece have closed forms:
//     a Gaussian line:  A e^{2πisΔ} e^{-2π²w²Δ²},
//     a triangle:       v_i ds sinc²(π ds Δ) e^{2πiσ_iΔ}      (sinc x = sin x / x),
// so I(Δ) is exact at any Δ, from nanometres to centimetres.  |Γ(Δ)| / I0 is the fringe
// visibility, the modulus of the complex degree of coherence.

export const TWO_PI = 2 * Math.PI;
export const nmToSigma = (nm) => 1000 / nm;
export const sigmaToNm = (s) => 1000 / s;

/** The grid of drawn spectra: σ = 1.2 ... 2.8 μm⁻¹ (833 ... 357 nm) in steps of 0.003125. */
export const GRID = { s0: 1.2, ds: 0.003125, n: 513 };
export const GRID_HI = GRID.s0 + GRID.ds * (GRID.n - 1);
/** Lines wider than this (σ standard deviation, μm⁻¹) are drawn into the grid for colours. */
export const BROAD_W = 2 * GRID.ds;
const FWHM_PER_SD = 2 * Math.sqrt(2 * Math.LN2);

export function sinc(x) { return Math.abs(x) < 1e-4 ? 1 - (x * x) / 6 : Math.sin(x) / x; }
export function sinc2(x) { const s = sinc(x); return s * s; }

/** The error function (Abramowitz and Stegun 7.1.26, |error| < 1.5e-7: enough for drawing). */
export function erf(x) {
  const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-a * a);
  return s * y;
}
export const normalCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

/** A Gaussian line at a wavelength (nm) with a full width at half maximum (nm) and an area. */
export function gaussianLine(nm, fwhmNm, A = 1) {
  const s = nmToSigma(nm), fwhmSigma = (1000 * fwhmNm) / (nm * nm);
  return { s, w: fwhmSigma / FWHM_PER_SD, A, nm };
}

/** The smooth edges of the band that the broad sources fill: 357 to 833 nm, flat from 377 to 741. */
export function band(s) {
  const a = 1.2, b = 1.35, c = 2.65, d = 2.8;
  if (s <= a || s >= d) return 0;
  if (s < b) return 0.5 - 0.5 * Math.cos((Math.PI * (s - a)) / (b - a));
  if (s > c) return 0.5 - 0.5 * Math.cos((Math.PI * (d - s)) / (d - c));
  return 1;
}

export class Spectrum {
  constructor(lines = [], cont = null) {
    this.lines = lines.map((l) => ({ ...l }));
    this.cont = cont ? { s0: cont.s0, ds: cont.ds, v: Float64Array.from(cont.v) } : null;
    this.update();
  }

  clone() { return new Spectrum(this.lines, this.cont); }

  /** Recompute the cached sums after changing lines or cont. */
  update() {
    let I0 = 0;
    for (const l of this.lines) I0 += l.A;
    this.i0 = 0; this.i1 = -1;
    if (this.cont) {
      const v = this.cont.v, n = v.length;
      let a = 0; while (a < n && v[a] === 0) a++;
      let b = n - 1; while (b >= a && v[b] === 0) b--;
      this.i0 = a; this.i1 = b;
      const cum = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + v[i];
      this.cum = cum;
      I0 += cum[n] * this.cont.ds;
    }
    this.I0 = I0;
    return this;
  }

  /** Multiply everything by a factor (the shape stays). */
  scale(f) {
    for (const l of this.lines) l.A *= f;
    if (this.cont) for (let i = 0; i < this.cont.v.length; i++) this.cont.v[i] *= f;
    return this.update();
  }

  /** Scale so that I0 = 1 (if there is any light). */
  normalize() { return this.I0 > 0 ? this.scale(1 / this.I0) : this; }

  /** Γ(Δ) = ∫ S(σ) e^{2πiσΔ} dσ, as [re, im] (written into out). */
  gamma(D, out = [0, 0]) {
    let re = 0, im = 0;
    const lines = this.lines;
    for (let j = 0; j < lines.length; j++) {
      const l = lines[j], e = l.A * Math.exp(-2 * Math.PI * Math.PI * l.w * l.w * D * D), ph = TWO_PI * l.s * D;
      re += e * Math.cos(ph); im += e * Math.sin(ph);
    }
    this.contGamma(D, out);
    out[0] += re; out[1] += im;
    return out;
  }

  /** The continuum's part of Γ(Δ). */
  contGamma(D, out = [0, 0]) {
    out[0] = 0; out[1] = 0;
    if (this.i1 < this.i0) return out;
    const { s0, ds, v } = this.cont, i1 = this.i1;
    // e^{2πiσ_iΔ} for successive i by rotation: one complex multiplication per term.
    const a = TWO_PI * (s0 + this.i0 * ds) * D, st = TWO_PI * ds * D;
    let c = Math.cos(a), s = Math.sin(a);
    const cs = Math.cos(st), ss = Math.sin(st);
    let ar = 0, ai = 0;
    for (let i = this.i0; i <= i1; i++) {
      const vi = v[i];
      ar += vi * c; ai += vi * s;
      const t = c * cs - s * ss; s = c * ss + s * cs; c = t;
    }
    const env = ds * sinc2(Math.PI * ds * D);
    out[0] = ar * env; out[1] = ai * env;
    return out;
  }

  /** The detector's signal I(Δ) = I0 + Re Γ(Δ). */
  intensity(D) { return this.I0 + this.gamma(D, scratch)[0]; }

  /** The fringe visibility |Γ(Δ)| / I0. */
  visibility(D) { const g = this.gamma(D, scratch); return this.I0 > 0 ? Math.hypot(g[0], g[1]) / this.I0 : 0; }

  /** [lo, hi]: the wavenumbers where there is light (lines to ±4 standard deviations). */
  range() {
    let lo = Infinity, hi = -Infinity;
    for (const l of this.lines) if (l.A !== 0) { lo = Math.min(lo, l.s - 4 * l.w); hi = Math.max(hi, l.s + 4 * l.w); }
    if (this.i1 >= this.i0) {
      const { s0, ds } = this.cont;
      lo = Math.min(lo, s0 + (this.i0 - 1) * ds); hi = Math.max(hi, s0 + (this.i1 + 1) * ds);
    }
    return lo <= hi ? [lo, hi] : [GRID.s0, GRID_HI];
  }

  /** ∫_{-∞}^{x} of the continuum. */
  contCdf(x) {
    if (!this.cont) return 0;
    const { s0, ds, v } = this.cont, n = v.length, u = (x - s0) / ds;
    if (u <= -1) return 0;
    if (u >= n) return this.cum[n] * ds;
    const j = Math.floor(u), f = u - j;
    const P = this.cum[Math.max(0, Math.min(n, j))];
    const vj = j >= 0 && j < n ? v[j] : 0, vj1 = j + 1 >= 0 && j + 1 < n ? v[j + 1] : 0;
    return ds * (P + vj * (1 - ((1 - f) * (1 - f)) / 2) + (vj1 * f * f) / 2);
  }

  /** The power between sa and sb.  which: 'all', 'narrow' (lines narrower than BROAD_W), 'smooth' (the rest). */
  power(sa, sb, which = 'all') {
    let p = 0;
    for (const l of this.lines) {
      const narrow = l.w < BROAD_W;
      if ((which === 'narrow' && !narrow) || (which === 'smooth' && narrow)) continue;
      p += l.A * (l.w > 0 ? normalCdf((sb - l.s) / l.w) - normalCdf((sa - l.s) / l.w) : +(l.s >= sa && l.s < sb));
    }
    if (which !== 'narrow' && this.cont) p += this.contCdf(sb) - this.contCdf(sa);
    return p;
  }

  /** The spectral density at σ. */
  density(s) {
    let d = this.contDensity(s);
    for (const l of this.lines) if (l.w > 0) { const z = (s - l.s) / l.w; d += (l.A * Math.exp(-0.5 * z * z)) / (l.w * Math.sqrt(TWO_PI)); }
    return d;
  }

  /** The continuum's density at σ (straight lines between the grid values). */
  contDensity(s) {
    if (!this.cont) return 0;
    const { s0, ds, v } = this.cont, u = (s - s0) / ds, j = Math.floor(u), f = u - j;
    const a = j >= 0 && j < v.length ? v[j] : 0, b = j + 1 >= 0 && j + 1 < v.length ? v[j + 1] : 0;
    return a * (1 - f) + b * f;
  }

  /**
   * The continuum and the broad lines as values on GRID (box averages over each grid step, or the
   * values themselves when the continuum is already on GRID).
   */
  gridValues() {
    const out = new Float64Array(GRID.n), { s0, ds, n } = GRID;
    const c = this.cont;
    if (c && Math.abs(c.s0 - s0) < 1e-12 && Math.abs(c.ds - ds) < 1e-15 && c.v.length === n) out.set(c.v);
    else if (c) for (let i = 0; i < n; i++) { const s = s0 + i * ds; out[i] = (this.contCdf(s + ds / 2) - this.contCdf(s - ds / 2)) / ds; }
    for (const l of this.lines) {
      if (l.w < BROAD_W) continue;
      for (let i = 0; i < n; i++) {
        const s = s0 + i * ds;
        out[i] += (l.A * (normalCdf((s + ds / 2 - l.s) / l.w) - normalCdf((s - ds / 2 - l.s) / l.w))) / ds;
      }
    }
    return out;
  }

  /** Put the continuum and broad lines on GRID, keeping only narrow lines as lines (for drawing). */
  prepareForDrawing() {
    const g = this.gridValues();
    this.lines = this.lines.filter((l) => l.w < BROAD_W);
    this.cont = { s0: GRID.s0, ds: GRID.ds, v: g };
    return this.update();
  }
}
const scratch = [0, 0];

// --------------------------------------------------------------------------- sources

/** Spectral lines, wavelengths in air (nm) and rough relative strengths. */
export const LINE_DATA = {
  // The red line of the helium-neon laser.
  hene: { lines: [[632.816, 1]], fwhm: 0.002 },
  // The sodium D lines: D2 (588.995 nm) has twice the strength of D1 (589.592 nm), from the
  // statistical weights of their upper levels (4 and 2).
  sodium: { lines: [[588.995, 2], [589.592, 1]], fwhm: 0.005 },
  // Mercury's visible lines: violet, blue, green and the yellow pair.  Strengths approximate.
  mercury: { lines: [[404.656, 0.4], [407.783, 0.04], [435.833, 0.9], [546.074, 1], [576.96, 0.22], [579.066, 0.24]], fwhm: 0.005 },
};

export function lineSpectrum(data) {
  const total = data.lines.reduce((a, [, r]) => a + r, 0);
  return new Spectrum(data.lines.map(([nm, r]) => gaussianLine(nm, data.fwhm, r / total)));
}

/** A continuum on GRID from a function of σ. */
export function gridSpectrum(f) {
  const v = new Float64Array(GRID.n);
  for (let i = 0; i < GRID.n; i++) v[i] = f(GRID.s0 + i * GRID.ds);
  return new Spectrum([], { s0: GRID.s0, ds: GRID.ds, v });
}

/** Planck's law per unit wavenumber at temperature T (K): σ³ / (e^{hcσ/kT} - 1), hc/k = 14388 μm K. */
export function planckSigma(s, T) { return (s * s * s) / Math.expm1((14387.77 * s) / T); }

export const SOURCES = {
  hene: { label: 'HeNe laser', title: 'Helium-neon laser, 632.8 nm', make: () => lineSpectrum(LINE_DATA.hene) },
  sodium: { label: 'Sodium lamp', title: 'The sodium D doublet, 589.0 and 589.6 nm', make: () => lineSpectrum(LINE_DATA.sodium) },
  mercury: { label: 'Mercury lamp', title: 'Mercury: violet, blue, green and two yellow lines', make: () => lineSpectrum(LINE_DATA.mercury) },
  gauss: { label: 'Gaussian line', title: 'One line of adjustable width', params: { lam: 550, fwhm: 10 },
    make: (p) => new Spectrum([gaussianLine(p.lam, p.fwhm, 1)]) },
  led: { label: 'White LED', title: 'A blue LED chip and its yellow phosphor (approximate)',
    make: () => new Spectrum([gaussianLine(450, 20, 0.3), gaussianLine(565, 110, 0.7)]) },
  lamp: { label: 'Hot filament', title: 'Blackbody light, seen through the visible band', params: { T: 3000 },
    make: (p) => gridSpectrum((s) => planckSigma(s, p.T) * band(s)).normalize() },
  white: { label: 'Equal-energy white', title: 'The same power per nanometre at every wavelength (CIE illuminant E)',
    make: () => gridSpectrum((s) => band(s) / (s * s)).normalize() },
  draw: { label: 'Draw your own', title: 'Start from darkness and draw a spectrum', make: () => gridSpectrum(() => 0) },
};
