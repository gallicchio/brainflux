// The light source of the OCT system: a Gaussian spectrum of centre λ₀ and full width at half
// maximum Δλ, and what it does in a Michelson: its coherence function.  No DOM.
//
// Units: lengths in micrometres; wavenumbers k = 2π/λ in radians per micrometre.  Path
// differences Δ are round-trip (the light goes to a mirror and back): a reference mirror moved by
// d changes Δ by 2d, and a reflector at depth z in a medium of index n sits at Δ = 2nz.
//
// A spectrum S(k) (unit area) gives a Michelson the detector signal, per unit reflecting
// amplitude, 1 + Re γ(Δ) with
//     γ(Δ) = ∫ S(k) e^{ikΔ} dk,
// the complex degree of coherence: the Fourier transform of the spectrum (as in the
// interferometer demo, where it is written with σ = 1/λ and 2πσΔ).  For a Gaussian spectrum of
// standard deviation σ_k, γ(Δ) = e^{ik₀Δ} e^{−σ_k²Δ²/2}: fringes at the centre wavelength under a
// Gaussian envelope.  The envelope falls to half at Δ = ±ℓ_c, and the convention used here (the
// one OCT uses) is that the coherence length
//     ℓ_c = (2 ln 2 / π) λ₀² / Δλ
// is the full width at half maximum of the fringe burst against the *mirror's position* d = Δ/2,
// i.e. the burst reaches half its height when the mirror is ℓ_c/2 either side of the match, and
// two reflectors are told apart when their optical depths n z differ by more than ℓ_c.

export const TWO_PI = 2 * Math.PI;
export const FWHM_PER_SD = 2 * Math.sqrt(2 * Math.LN2);   // 2.3548
export const LC_FACTOR = (2 * Math.LN2) / Math.PI;        // 0.4413

/** Presets: centre wavelength (nm) and bandwidth (nm) of common OCT sources. */
export const SOURCES = {
  sld840: { label: '840 nm', title: 'A superluminescent diode at 840 nm, as retinal OCT uses', lam: 840, fwhm: 50 },
  sld1300: { label: '1300 nm', title: 'A 1300 nm source: deeper into scattering tissue, coarser axially for the same Δλ', lam: 1300, fwhm: 50 },
};

export class Source {
  /** lamNm: centre wavelength (nm); fwhmNm: full width at half maximum of the spectrum (nm). */
  constructor(lamNm = 840, fwhmNm = 50) { this.set(lamNm, fwhmNm); }

  set(lamNm, fwhmNm) {
    this.lamNm = lamNm; this.fwhmNm = fwhmNm;
    this.lam0 = lamNm / 1000;                       // μm
    this.k0 = TWO_PI / this.lam0;                   // rad/μm
    // |dk/dλ| Δλ: the width in wavenumber (the spectrum is Gaussian in k here; for Δλ ≪ λ₀ the
    // difference from a Gaussian in λ is small).
    this.dk = (TWO_PI * (fwhmNm / 1000)) / (this.lam0 * this.lam0);
    this.sigk = this.dk / FWHM_PER_SD;
    this.lc = (LC_FACTOR * this.lam0 * this.lam0) / (fwhmNm / 1000);
    return this;
  }

  /** The spectrum S(k), normalised to unit area in k. */
  spectrum(k) {
    const z = (k - this.k0) / this.sigk;
    return Math.exp(-0.5 * z * z) / (this.sigk * Math.sqrt(TWO_PI));
  }

  /** |γ(Δ)|: the envelope of the fringes at round-trip path difference Δ (1 at 0, 1/2 at ±ℓ_c). */
  envelope(D) { const u = this.sigk * D; return Math.exp(-0.5 * u * u); }

  /** γ(Δ) = ∫ S(k) e^{ikΔ} dk as [re, im]. */
  gamma(D, out = [0, 0]) {
    const e = this.envelope(D), ph = this.k0 * D;
    out[0] = e * Math.cos(ph); out[1] = e * Math.sin(ph);
    return out;
  }

  /** The reach of the envelope: beyond |Δ| = reach it is below 10⁻⁶ (for compact sums). */
  get reach() { return 5.3 / this.sigk; }
}

/** The same spectrum, Gaussian in k: its value against wavelength (nm), per nm, for plots. */
export function spectrumPerNm(src, nm) {
  const k = TWO_PI / (nm / 1000);
  return src.spectrum(k) * (k / (nm / 1000)) / 1000;   // |dk/dλ| = k/λ, per μm → per nm
}
