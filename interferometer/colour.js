// Colours of light: the CIE 1931 colour matching functions and the sRGB colours of a screen.
//
// The colour matching functions x̄(λ), ȳ(λ), z̄(λ) of the 1931 standard observer are given by the
// multi-lobe fit of Wyman, Sloan and Shirley ("Simple analytic approximations to the CIE XYZ
// colour matching functions", JCGT 2, 2013): sums of Gaussians whose width is different on the
// two sides of the peak.  The fit is as close to the tabulated functions as different observers
// are to each other.  A spectrum S(λ) has tristimulus values X = ∫ S x̄ dλ (and Y, Z alike), and
// a fixed matrix turns X, Y, Z into the linear red, green and blue of an sRGB screen (D65 white).
// Monochromatic light lies outside what a screen can show (one of r, g, b comes out negative);
// the negative part is cut to zero, which keeps the colour close to what the eye expects.

function lobe(x, mu, s1, s2) {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
}

/** [x̄, ȳ, z̄] at a wavelength in nanometres. */
export function cmf(nm) {
  return [
    1.056 * lobe(nm, 599.8, 37.9, 31.0) + 0.362 * lobe(nm, 442.0, 16.0, 26.7) - 0.065 * lobe(nm, 501.1, 20.4, 26.2),
    0.821 * lobe(nm, 568.8, 46.9, 40.5) + 0.286 * lobe(nm, 530.9, 16.3, 31.1),
    1.217 * lobe(nm, 437.0, 11.8, 36.0) + 0.681 * lobe(nm, 459.0, 26.0, 13.8),
  ];
}

/** The colour matching functions at a wavenumber σ in μm⁻¹ (σ = 1000 / λ in nm). */
export function cmfSigma(sigma) {
  return sigma > 0 ? cmf(1000 / sigma) : [0, 0, 0];
}

/** X, Y, Z to linear sRGB (IEC 61966-2-1, D65 white). */
export function xyzToLinear(X, Y, Z) {
  return [
    3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
    -0.969266 * X + 1.8760108 * Y + 0.041556 * Z,
    0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
  ];
}

/** Bring a linear colour inside the sRGB gamut (from below) by cutting negative channels to zero. */
export function gamutFix(rgb) {
  return [Math.max(0, rgb[0]), Math.max(0, rgb[1]), Math.max(0, rgb[2])];
}

/** The sRGB transfer function: linear 0..1 to encoded 0..1. */
export function encode(c) {
  if (c <= 0) return 0;
  if (c >= 1) return 1;
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// encode() through a table, for whole images: index = round(c * (ENC_N - 1)).
const ENC_N = 4096;
export const ENCODE_TABLE = new Uint8ClampedArray(ENC_N);
for (let i = 0; i < ENC_N; i++) ENCODE_TABLE[i] = Math.round(255 * encode(i / (ENC_N - 1)));
export const ENCODE_SCALE = ENC_N - 1;

/** A display colour [r, g, b] (0..255) for linear sRGB values, clipped. */
export function toBytes(rgb) {
  return rgb.map((c) => ENCODE_TABLE[Math.round(Math.max(0, Math.min(1, c)) * ENCODE_SCALE)]);
}

/**
 * The colour of a single wavelength, for drawing spectra: full brightness through the middle of
 * the visible, fading towards its ends (where the eye is least sensitive), black outside.
 * Returns linear [r, g, b] in 0..1.
 */
export function wavelengthColour(nm) {
  const [x, y, z] = cmf(nm), s = x + y + z;
  if (s < 1e-4) return [0, 0, 0];
  const c = gamutFix(xyzToLinear(x, y, z)), m = Math.max(...c);
  const fade = Math.min(1, Math.sqrt(s / 0.3));
  return c.map((v) => (fade * v) / m);
}

/** Chromaticity (x, y) of tristimulus values. */
export function chromaticity(X, Y, Z) {
  const s = X + Y + Z;
  return [X / s, Y / s];
}

/**
 * A colour for filling a spectrum plot at a wavelength: the hue at full brightness, greyed
 * towards the ends of the visible (where the eye hardly sees) and grey outside.  Linear rgb.
 */
export function spectralFill(nm, grey = 0.45) {
  const [x, y, z] = cmf(nm), s = x + y + z;
  const v = Math.min(1, Math.sqrt(s / 0.3));
  if (v < 1e-3) return [grey, grey, grey];
  const c = gamutFix(xyzToLinear(x, y, z)), m = Math.max(...c);
  return c.map((q) => v * (q / m) + (1 - v) * grey);
}
