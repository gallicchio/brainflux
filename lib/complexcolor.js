// Drawing complex numbers as colours ("domain colouring").
//
// The phase becomes the hue and the magnitude the lightness: 0 is black, |z| = R is a fully
// coloured pixel, and infinity is white.  The magnitude is squeezed into [0, 1) with
// t = (2/pi) arctan(|z| / R), so that values spanning many orders of magnitude (Fourier
// transforms!) stay visible and R is the one "brightness" knob.  This is the old BrainFlux
// mapping (brainflux.graphics.ComplexColor, 2001), itself in the spirit of Bernd Thaller's
// Visual Quantum Mechanics.
//
// The hues are the old applet's: HSV, bent by sin(3 phi)/5 so they don't rush through yellow,
// cyan and magenta.  What is new is one correction measured in OKLab, a perceptual colour
// space: HSV hues are not equally bright (yellow looks far lighter than blue at the same |z|),
// so each hue reaches full colour at a magnitude that leans towards its own lightness, and a
// ring of equal |z| looks nearly equally bright.  (A fully perceptual map, lightness exactly
// |z| and hue angle uniform in OKLab, was tried: sRGB cannot show a bright blue or a dark
// yellow, so it came out muddy, and pure green and blue shrank to seams.)  Positive real is
// red, +i yellow-green, negative real cyan, -i blue-violet.
//
// Colours come from a lookup table indexed by (phase, t), so drawing a 512 x 512 image costs
// one atan2 and one arctan per pixel.

const PHASES = 360;     // hue steps around the circle
const LEVELS = 256;     // lightness steps from black to white

function srgbGamma(x) {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

// sRGB to OKLab (Björn Ottosson, 2020), a colour space in which distances look uniform.
function oklabOf(r, g, b) { // sRGB 0..1 (gamma) to OKLab [L, a, b]
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}

// The fully saturated colour of HSV hue h (0..1): the edge of the RGB cube.
function pureHue(h) {
  const f = (n) => { const k = (n + h * 6) % 6; return 1 - Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}

function buildTable() {
  // Black -> pure hue -> white, the pure hue reached at t0 rather than always at 1/2.  t0 leans
  // towards the hue's own perceptual lightness (BALANCE), so dark blue brightens sooner and
  // light yellow later: a ring of equal |z| then looks nearly equally bright all the way round,
  // while the colours stay as vivid as the old applet's.
  const BALANCE = 0.5;
  const table = new Uint8ClampedArray(PHASES * LEVELS * 4);
  for (let p = 0; p < PHASES; p++) {
    const phi = (2 * Math.PI * p) / PHASES;
    // The old hue bend: linger a little longer on yellow, cyan and magenta.
    const hue = (phi + Math.sin(3 * phi) / 5) / (2 * Math.PI);
    const P = pureHue(((hue % 1) + 1) % 1);
    const t0 = 0.5 + BALANCE * (oklabOf(...P)[0] - 0.75);
    for (let q = 0; q < LEVELS; q++) {
      const t = (q + 0.5) / LEVELS;
      const u = t < t0 ? t / t0 : (t - t0) / (1 - t0);
      const rgb = t < t0 ? P.map((c) => c * u) : P.map((c) => c + (1 - c) * u);
      const o = (p * LEVELS + q) * 4;
      table[o] = 255 * rgb[0]; table[o + 1] = 255 * rgb[1]; table[o + 2] = 255 * rgb[2]; table[o + 3] = 255;
    }
  }
  return table;
}

let TABLE = null;
const table = () => TABLE || (TABLE = buildTable());

// Grey levels for magnitude-only drawing, with the same lightness scale (OKLab L = t).
let GREYS = null;
function greys() {
  if (GREYS) return GREYS;
  GREYS = new Uint8ClampedArray(LEVELS);
  for (let q = 0; q < LEVELS; q++) {
    const L = (q + 0.5) / LEVELS;
    GREYS[q] = 255 * srgbGamma(Math.min(1, L * L * L));
  }
  return GREYS;
}

export const MODES = {
  complex: 'magnitude and phase',
  grey: 'grey (a real picture)',
  magnitude: 'magnitude |f|',
  intensity: 'intensity |f|²',
  phase: 'phase only',
  real: 'real part',
  imag: 'imaginary part',
};

const TWO_OVER_PI = 2 / Math.PI;
const PHASE_SCALE = PHASES / (2 * Math.PI);

/** The RGBA of one complex number (mode 'complex'), for legends and pickers. */
export function colorOf(re, im, R = 1) {
  const T = table();
  const t = TWO_OVER_PI * Math.atan(Math.hypot(re, im) / R);
  let p = Math.floor(Math.atan2(im, re) * PHASE_SCALE + PHASES) % PHASES;
  const q = Math.min(LEVELS - 1, Math.floor(t * LEVELS));
  const o = (p * LEVELS + q) * 4;
  return [T[o], T[o + 1], T[o + 2]];
}

export function cssColorOf(re, im, R = 1) {
  const [r, g, b] = colorOf(re, im, R);
  return `rgb(${r},${g},${b})`;
}

/**
 * Colour n complex values into RGBA pixels.
 *   re, im   Float64Arrays (im may be null)
 *   out      Uint8ClampedArray of 4n bytes (an ImageData's data)
 *   R        the magnitude drawn at half lightness (the brightness control)
 *   mode     one of MODES
 *   map      optional Int32Array: pixel i shows value map[i] (for flips and zooms)
 */
export function colorize(re, im, out, R, mode = 'complex', map = null) {
  const T = table(), G = greys();
  const n = out.length >> 2;
  const invR = 1 / R, invR2 = 1 / (R * R);
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const j = map ? map[i] : i;
    let a = re[j], b = im ? im[j] : 0;
    if (mode === 'real') b = 0;
    else if (mode === 'grey') { a = a > 0 ? a : 0; b = 0; }
    else if (mode === 'imag') { a = 0; b = im ? im[j] : 0; }
    let t;
    if (mode === 'intensity') t = TWO_OVER_PI * Math.atan((a * a + b * b) * invR2);
    else if (mode === 'phase') t = a === 0 && b === 0 ? 0 : 0.5;
    else t = TWO_OVER_PI * Math.atan(Math.sqrt(a * a + b * b) * invR);
    const q = t >= 1 ? LEVELS - 1 : (t * LEVELS) | 0;
    if (mode === 'magnitude' || mode === 'intensity' || mode === 'grey') {
      const g = G[q];
      out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255;
      continue;
    }
    let p = (Math.atan2(b, a) * PHASE_SCALE + PHASES) | 0;
    if (p >= PHASES) p -= PHASES;
    const s = (p * LEVELS + q) << 2;
    out[o] = T[s]; out[o + 1] = T[s + 1]; out[o + 2] = T[s + 2]; out[o + 3] = 255;
  }
}

/**
 * A brightness R that suits the data: the magnitude below which `fraction` of the total
 * |f|^2 lies, found from a histogram of log|f|.  For an image this is close to its typical
 * value; for a Fourier transform, whose power sits in a few bright pixels, it picks out the
 * strong components without drowning the weak ones.
 */
export function autoBrightness(re, im, fraction = 0.5) {
  const n = re.length;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const m = re[i] * re[i] + (im ? im[i] * im[i] : 0);
    if (m > max) max = m;
  }
  if (max === 0) return 1;
  const BINS = 400, span = 16; // 16 decades of |f|^2 below the maximum
  const hist = new Float64Array(BINS);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const m = re[i] * re[i] + (im ? im[i] * im[i] : 0);
    if (m === 0) continue;
    let b = Math.floor(((Math.log10(m / max) + span) / span) * BINS);
    if (b < 0) continue;
    if (b >= BINS) b = BINS - 1;
    hist[b] += m; total += m;
  }
  let acc = 0;
  for (let b = 0; b < BINS; b++) {
    acc += hist[b];
    if (acc >= fraction * total) return Math.sqrt(max * 10 ** (((b + 0.5) / BINS) * span - span));
  }
  return Math.sqrt(max);
}

/** Draw the colour wheel (the complex plane: Re to the right, Im up) into a canvas. */
export function drawWheel(canvas, R = 1, extent = 3) {
  const w = canvas.width, h = canvas.height, ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const re = new Float64Array(w * h), im = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    re[y * w + x] = ((x + 0.5) / w - 0.5) * 2 * extent * R;
    im[y * w + x] = (0.5 - (y + 0.5) / h) * 2 * extent * R;
  }
  colorize(re, im, img.data, R);
  ctx.putImageData(img, 0, 0);
}
