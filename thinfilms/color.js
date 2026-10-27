// The colour of a spectrum as the eye sees it, on an sRGB screen.
//
// A reflectance (or transmittance) spectrum S(lambda) under an illuminant I(lambda) gives the
// tristimulus values X = k sum S I xbar, Y = k sum S I ybar, Z = k sum S I zbar, with k chosen
// so that a perfect reflector has Y = 1.  The CIE 1931 2-degree colour-matching functions are
// the analytic multi-lobe Gaussian fit of
//
//   C. Wyman, P.-P. Sloan and P. Shirley, "Simple analytic approximations to the CIE XYZ color
//   matching functions," Journal of Computer Graphics Techniques 2(2), 1-11 (2013), eq. 2,
//
// which follows the tabulated functions to within a few per cent of their peaks.  XYZ goes to
// linear sRGB by the standard matrix (IEC 61966-2-1), after a Bradford chromatic adaptation
// from the illuminant's white (as computed with these functions) to the screen's D65 white, so
// that a perfect reflector is exactly white (1, 1, 1) whichever illuminant is chosen: the eye
// adapts to the light it is in.

// Piecewise Gaussian: a different width on each side of the peak.
function g(x, mu, s1, s2) { const t = (x - mu) / (x < mu ? s1 : s2); return Math.exp(-0.5 * t * t); }

/** CIE 1931 colour-matching functions at wavelength nm (Wyman, Sloan & Shirley 2013). */
export function cmf(nm) {
  return [
    1.056 * g(nm, 599.8, 37.9, 31.0) + 0.362 * g(nm, 442.0, 16.0, 26.7) - 0.065 * g(nm, 501.1, 20.4, 26.2),
    0.821 * g(nm, 568.8, 46.9, 40.5) + 0.286 * g(nm, 530.9, 16.3, 31.1),
    1.217 * g(nm, 437.0, 11.8, 36.0) + 0.681 * g(nm, 459.0, 26.0, 13.8),
  ];
}

// CIE standard illuminant D65, relative spectral power at 380, 385, ..., 780 nm (CIE 15:2004,
// Table T.1; ISO 11664-2), normalised to 100 at 560 nm.
const D65_5NM = [
  49.9755, 52.3118, 54.6482, 68.7015, 82.7549, 87.1204, 91.486, 92.4589, 93.4318, 90.057,
  86.6823, 95.7736, 104.865, 110.936, 117.008, 117.41, 117.812, 116.336, 114.861, 115.392,
  115.923, 112.367, 108.811, 109.082, 109.354, 108.578, 107.802, 106.296, 104.79, 106.239,
  107.689, 106.047, 104.405, 104.225, 104.046, 102.023, 100, 98.1671, 96.3342, 96.0611,
  95.788, 92.2368, 88.6856, 89.3459, 90.0062, 89.8026, 89.5991, 88.6489, 87.6987, 85.4936,
  83.2886, 83.4939, 83.6992, 81.863, 80.0268, 80.1207, 80.2146, 81.2462, 82.2778, 80.281,
  78.2842, 74.0027, 69.7213, 70.6652, 71.6091, 72.979, 74.349, 67.9765, 61.604, 65.7448,
  69.8856, 72.4863, 75.087, 69.3398, 63.5927, 55.0054, 46.4182, 56.6118, 66.8054, 65.0941,
  63.3828,
];

/** D65's relative power at nm (linear interpolation in the 5 nm table; 0 outside 380-780). */
export function d65(nm) {
  const u = (nm - 380) / 5;
  if (u < 0 || u > 80) return 0;
  const i = Math.min(79, Math.floor(u)), f = u - i;
  return D65_5NM[i] * (1 - f) + D65_5NM[i + 1] * f;
}

export const ILLUMINANTS = {
  d65: { name: 'Daylight (D65)', spd: d65 },
  e: { name: 'Equal energy', spd: () => 100 },
};

// XYZ (D65 white) to linear sRGB (IEC 61966-2-1).
const XYZ_TO_RGB = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.969266, 1.8760108, 0.041556],
  [0.0556434, -0.2040259, 1.0572252],
];
// Bradford cone response matrix and its inverse.
const BRADFORD = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
const mul = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
function inverse3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g_, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * g_), C = d * h - e * g_;
  const det = a * A + b * B + c * C;
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g_) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g_) / det, (a * e - b * d) / det]];
}
const BRADFORD_INV = inverse3(BRADFORD);
// The screen's white: D65, x = 0.3127, y = 0.3290, Y = 1, exactly as the matrix above has it
// (so that it gives R = G = B = 1).
export const D65_WHITE = mul(inverse3(XYZ_TO_RGB), [1, 1, 1]);
const matmul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));

/**
 * A colour calculator for spectra sampled at the wavelengths `nms` (nm, evenly spaced), under
 * an illuminant: .xyz(S) -> [X, Y, Z] with Y = 1 for S = 1 everywhere, .rgb(S, exposure) ->
 * gamma-encoded sRGB in 0..1.  Precomputes the weights I(lambda) * cmf(lambda) * dlambda.
 */
export function colorimeter(nms, illuminant = 'd65') {
  const spd = ILLUMINANTS[illuminant].spd;
  const m = nms.length, wx = new Float64Array(m), wy = new Float64Array(m), wz = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    // Trapezoidal weights.
    const w = i === 0 || i === m - 1 ? 0.5 : 1;
    const [x, y, z] = cmf(nms[i]), I = spd(nms[i]) * w;
    wx[i] = x * I; wy[i] = y * I; wz[i] = z * I;
  }
  let sy = 0;
  for (let i = 0; i < m; i++) sy += wy[i];
  for (let i = 0; i < m; i++) { wx[i] /= sy; wy[i] /= sy; wz[i] /= sy; }
  const white = [wx.reduce((a, b) => a + b, 0), 1, wz.reduce((a, b) => a + b, 0)];
  // Adapt white -> D65_WHITE (Bradford), then XYZ -> linear sRGB.
  const src = mul(BRADFORD, white), dst = mul(BRADFORD, D65_WHITE);
  const D = [[dst[0] / src[0], 0, 0], [0, dst[1] / src[1], 0], [0, 0, dst[2] / src[2]]];
  const M = matmul(XYZ_TO_RGB, matmul(BRADFORD_INV, matmul(D, BRADFORD)));
  return {
    nms, white, matrix: M, wx, wy, wz,
    xyz(S, stride = 1, offset = 0) {
      let X = 0, Y = 0, Z = 0;
      for (let i = 0; i < m; i++) { const s = S[offset + i * stride]; X += s * wx[i]; Y += s * wy[i]; Z += s * wz[i]; }
      return [X, Y, Z];
    },
    /** Linear sRGB of XYZ (D65-adapted). */
    linear(XYZ) { return mul(M, XYZ); },
  };
}

const gammaEncode = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/**
 * Linear sRGB (any brightness) to displayable gamma-encoded sRGB in 0..1, out[0..2].  Colours
 * outside the gamut are brought in by mixing with grey of the same luminance (so a negative
 * channel is lifted to 0 without changing the brightness), and colours brighter than the screen
 * are scaled down as a whole (keeping their hue and saturation).
 */
export function toDisplay(rgb, out = [0, 0, 0]) {
  let [r, g_, b] = rgb;
  const Y = 0.2126729 * r + 0.7151522 * g_ + 0.072175 * b;
  const lo = Math.min(r, g_, b);
  if (lo < 0) {
    if (Y <= 0) { out[0] = out[1] = out[2] = 0; return out; }
    const t = Y / (Y - lo);          // mix fraction that brings the lowest channel to 0
    r = Y + t * (r - Y); g_ = Y + t * (g_ - Y); b = Y + t * (b - Y);
  }
  const hi = Math.max(r, g_, b);
  if (hi > 1) { r /= hi; g_ /= hi; b /= hi; }
  out[0] = gammaEncode(Math.max(0, r)); out[1] = gammaEncode(Math.max(0, g_)); out[2] = gammaEncode(Math.max(0, b));
  return out;
}

/** Chromaticity (x, y) of XYZ. */
export function chromaticity([X, Y, Z]) { const s = X + Y + Z; return s > 0 ? [X / s, Y / s] : [0, 0]; }

/** An sRGB colour for monochromatic light of wavelength nm, for drawing a spectrum band. */
export function spectralColor(nm) {
  const [x, y, z] = cmf(nm);
  // Brightened, then brought into the gamut (spectral colours lie outside it) by toDisplay.
  return toDisplay(mul(XYZ_TO_RGB, [x, y, z]).map((v) => v * 1.6));
}

/** Evenly spaced wavelengths from a to b (inclusive) in steps of h nm. */
export function wavelengths(a = 380, b = 780, h = 5) {
  const m = Math.round((b - a) / h) + 1;
  return Float64Array.from({ length: m }, (_, i) => a + i * h);
}
