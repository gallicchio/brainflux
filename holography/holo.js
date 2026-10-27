// Holography: record the interference of an object wave with a reference wave on a camera, then
// light the recording again and look through it.  No DOM here, so the tests can import it.
//
// Units: lengths in micrometres (the page shows nm, µm and mm).  The plate (a camera sensor) is
// an n x n grid of pixels of pitch p.  Pixel (i, j), column i and row j, sits at
//     x = (i - n/2) p,   y = (n/2 - j) p,
// so y points up and the middle of the plate is pixel (n/2, n/2), as in the other demos.  Light
// travels along +z with time dependence exp(-iwt), so exp(ikz) travels forwards.  The object is
// behind the plate: a point "at depth z" sits at (x, y, -z); the viewer is in front.
//
// Recording.  The plate records the intensity H = |O + R|^2 of the object wave O and the
// reference wave R, optionally rounded to a few grey levels, and parts of it may be covered.
//
// Reconstruction.  Lit by a wave C, the plate passes H C = (|R|^2 + |O|^2) C + O R* C + O* R C.
// With C = R the third term is |R|^2 O: the object's own wave, which seems to come from the
// object (the virtual image); the fourth, O* R^2, converges to a real image in front of the
// plate (the twin); the first goes straight on (the zero order).  We look at this light the way
// a camera looking through the plate does: a lens focused at distance d, then the light's
// directions (its angular spectrum, one FFT).  A point that is in focus lands on one direction,
// x/d; everything is drawn in those direction units, so the picture keeps its scale as the
// focus changes.  This is the Fresnel transform of digital holography, with the exact
// (non-paraxial) phase of a lens focused on the axis.  Directions are sampled every
// lambda/(n p) radians out to +-lambda/2p, which is as fine and as wide as the plate allows: the
// pixels cannot record fringes finer than two pixels, nor send light to larger angles.
// (Why not propagate the plate's light by the angular spectrum, on the plate's own grid, as
// diffraction/optics.js does?  At the image the zero order and the twin have moved sideways by
// one to three plate widths; on a periodic grid one plate wide they wrap round onto the image,
// and off-axis holography would look no better than in-line.  The tests check this Fresnel
// transform against optics.js where both apply.)

import { fft2Centered } from '../lib/fft.js';

export const TWO_PI = 2 * Math.PI;

/** The largest angle (its sine) whose fringes the pixels can record: a period of 2 pixels. */
export const sinNyquist = (lambda, p) => lambda / (2 * p);

/**
 * The distance at which the light of a point spreads over the whole plate at the largest
 * angle the pixels allow: n p^2 / lambda.  Closer than this, the outer zones of a point's zone
 * plate are finer than two pixels.
 */
export const criticalDistance = (n, p, lambda) => (n * p * p) / lambda;

export function field(n) { return { re: new Float64Array(n * n), im: new Float64Array(n * n) }; }

// cos and sin from a table with linear interpolation (error below 3e-7): the spherical waves are
// recomputed while a point is dragged, and Math.cos and Math.sin were most of their cost.
const TAB = 4096, TC = new Float64Array(TAB + 1), TS = new Float64Array(TAB + 1), PER_RAD = TAB / (2 * Math.PI);
for (let i = 0; i <= TAB; i++) { TC[i] = Math.cos(i / PER_RAD); TS[i] = Math.sin(i / PER_RAD); }

// ------------------------------------------------------------------------------- waves

/**
 * The wave of one point source at (x, y, depth z), amplitude a at the middle of the plate,
 * written into out (or added to it).  Exact spherical wave a (z/r) exp(ik(r - z)): the point is
 * lit by a plane wave travelling along the axis, so its light leaves it with the phase that wave
 * had there, exp(-ikz).
 */
export function pointWave(n, p, lambda, pt, out, add = false) {
  const k = TWO_PI / lambda, { x, y, z } = pt, a = pt.a ?? 1, ph0 = pt.phase || 0;
  const { re, im } = out, h = n / 2, z2 = z * z;
  for (let j = 0; j < n; j++) {
    const dy = (h - j) * p - y, dyz = dy * dy + z2;
    for (let i = 0, o = j * n; i < n; i++, o++) {
      const dx = (i - h) * p - x, r = Math.sqrt(dx * dx + dyz);
      const amp = (a * z) / r, u = (k * (r - z) + ph0) * PER_RAD;
      let f = Math.floor(u);
      const t = u - f;
      f &= TAB - 1;
      const c = amp * (TC[f] + (TC[f + 1] - TC[f]) * t), s = amp * (TS[f] + (TS[f + 1] - TS[f]) * t);
      if (add) { re[o] += c; im[o] += s; } else { re[o] = c; im[o] = s; }
    }
  }
  return out;
}

/**
 * A plane wave of unit amplitude travelling at angle theta to the axis, tilted towards +y:
 * exp(ik y sin(theta)); conj gives its complex conjugate (the beam reversed).
 */
export function planeWave(n, p, lambda, theta, out, conj = false) {
  const ky = ((TWO_PI / lambda) * Math.sin(theta)) * (conj ? -1 : 1), { re, im } = out, h = n / 2;
  for (let j = 0; j < n; j++) {
    const ph = ky * (h - j) * p, c = Math.cos(ph), s = Math.sin(ph);
    re.fill(c, j * n, j * n + n); im.fill(s, j * n, j * n + n);
  }
  return out;
}

/**
 * The wave of a point source at (x, y, depth z), unit amplitude across the plate:
 * exp(ik(r - z)).  With conj, the conjugate: a wave converging to the mirror point in front.
 */
export function sphericalWave(n, p, lambda, src, out, conj = false) {
  pointWave(n, p, lambda, { x: src.x, y: src.y, z: src.z, a: 1 }, out);
  // Unit amplitude: the 1/r fall-off of a reference beam is not the point of it.
  const { re, im } = out;
  for (let o = 0; o < re.length; o++) {
    const m = Math.hypot(re[o], im[o]);
    re[o] /= m; im[o] = (conj ? -im[o] : im[o]) / m;
  }
  return out;
}

/**
 * The light of a flat picture at depth z, arriving at the plate (the Fresnel transform):
 *   O(x) = (1/i lambda z) exp(i pi x^2 / lambda z) Int t(s) exp(i pi s^2 / lambda z) exp(-2 pi i x s / lambda z) ds
 * The picture t is sampled every dS = lambda z / (n p) in its own plane, which is one step of
 * direction lambda / (n p) as seen from the plate: the same grid as the reconstruction, so a
 * picture n_s samples wide is n_s directions wide.  (One FFT does it; the result is scaled so
 * that power is conserved: sum |O|^2 p^2 = sum |t|^2 dS^2.)  This is paraxial, which is accurate
 * here: the angles are a few degrees.  The picture's samples must sit within the middle
 * n p of its plane unless it has a diffuser: light that would miss the plate otherwise wraps
 * around (the transform is periodic).
 */
export function pictureWave(t, n, p, lambda, z, out) {
  const dS = (lambda * z) / (n * p), h = n / 2, a = Math.PI / (lambda * z);
  const { re, im } = out;
  // t times exp(i pi s^2 / lambda z), separably: the chirp is a product of a row and a column.
  const cs = new Float64Array(n), sn = new Float64Array(n), cp = new Float64Array(n), sp = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = (i - h) * dS, ps = a * s * s; cs[i] = Math.cos(ps); sn[i] = Math.sin(ps);
    const x = (i - h) * p, px = a * x * x; cp[i] = Math.cos(px); sp[i] = Math.sin(px);
  }
  for (let j = 0; j < n; j++) for (let i = 0, o = j * n; i < n; i++, o++) {
    // exp(i(phi_i + phi_j)) = (c_i c_j - s_i s_j) + i (s_i c_j + c_i s_j)
    const c = cs[i] * cs[j] - sn[i] * sn[j], s = sn[i] * cs[j] + cs[i] * sn[j];
    const tr = t.re[o], ti = t.im ? t.im[o] : 0;
    re[o] = tr * c - ti * s; im[o] = tr * s + ti * c;
  }
  fft2Centered(re, im, n, n);
  // The unitary transform keeps sum |.|^2; the physical one keeps sum |.|^2 times the pixel area.
  // The factor 1/i: a quarter-period lag, as in every diffraction integral.
  const g = dS / p;
  for (let j = 0; j < n; j++) for (let i = 0, o = j * n; i < n; i++, o++) {
    const c = cp[i] * cp[j] - sp[i] * sp[j], s = sp[i] * cp[j] + cp[i] * sp[j];
    const r = re[o] * c - im[o] * s, q = re[o] * s + im[o] * c;
    re[o] = g * q; im[o] = -g * r;
  }
  return out;
}

/** A random phase for every sample (an ideal diffuser: each sample lights the whole plate). */
export function diffuser(n, seed = 1) {
  const rnd = mulberry32(seed), out = field(n);
  for (let o = 0; o < n * n; o++) { const ph = TWO_PI * rnd(); out.re[o] = Math.cos(ph); out.im[o] = Math.sin(ph); }
  return out;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------- recording

/** H = |O + R|^2 into out (a Float64Array). */
export function record(O, R, out) {
  for (let o = 0; o < out.length; o++) {
    const a = O.re[o] + R.re[o], b = O.im[o] + R.im[o];
    out[o] = a * a + b * b;
  }
  return out;
}

/**
 * Round the hologram to 2^bits grey levels spread from its darkest to its brightest pixel, as a
 * camera exposed to fill its range would.  One bit is a binary hologram: each pixel black or
 * white, split at the average brightness (a computer-generated hologram).  In place.
 */
export function quantize(H, bits) {
  let min = Infinity, max = -Infinity, sum = 0;
  for (let o = 0; o < H.length; o++) { const v = H[o]; if (v < min) min = v; if (v > max) max = v; sum += v; }
  if (bits <= 1) {
    const mean = sum / H.length;
    for (let o = 0; o < H.length; o++) H[o] = H[o] > mean ? 1 : 0;
    return H;
  }
  const levels = 2 ** Math.round(bits) - 1, span = max - min || 1;
  for (let o = 0; o < H.length; o++) H[o] = min + (Math.round(((H[o] - min) / span) * levels) / levels) * span;
  return H;
}

// ----------------------------------------------------------------------- reconstruction

/**
 * The phase of a thin lens focused at distance d: exp(-i sign(d) k (sqrt(r^2 + d^2) - |d|)).
 * It turns the light diverging from a point d behind the plate (d > 0: a virtual image), or
 * converging to a point |d| in front (d < 0: a real image), into a plane wave.  Where this phase
 * would change faster than the pixels can follow (close focus, outer plate) the lens is made
 * opaque, smoothly: a camera focused that close sees only the middle of the plate.
 */
export function lens(n, p, lambda, d, out = field(n)) {
  const k = TWO_PI / lambda, h = n / 2, ad = Math.abs(d), sg = d < 0 ? -1 : 1;
  const s = Math.min(0.999, lambda / (2 * p)), rmax = (ad * s) / Math.sqrt(1 - s * s), edge = 4 * p;
  const { re, im } = out;
  for (let j = 0; j < n; j++) {
    const y = (h - j) * p;
    for (let i = 0, o = j * n; i < n; i++, o++) {
      const x = (i - h) * p, r2 = x * x + y * y, u = -sg * k * (Math.sqrt(r2 + ad * ad) - ad) * PER_RAD;
      let w = 1;
      if (r2 > (rmax - edge) ** 2) { const r = Math.sqrt(r2); w = r >= rmax ? 0 : 0.5 - 0.5 * Math.cos((Math.PI * (rmax - r)) / edge); }
      let f = Math.floor(u);
      const t = u - f;
      f &= TAB - 1;
      // Interpolating between two unit phasors shortens them a little (by up to 3e-7): a lens
      // must not absorb light, so put the length back to exactly 1.
      const c = TC[f] + (TC[f + 1] - TC[f]) * t, s = TS[f] + (TS[f + 1] - TS[f]) * t, g = w / Math.sqrt(c * c + s * s);
      re[o] = g * c; im[o] = g * s;
    }
  }
  return out;
}

/**
 * Look through the plate: the light H C (C the illuminating wave, or null for a plane wave
 * along the axis), seen through a round window {x, y, r} (or the whole plate), by a camera
 * focused at d: the centred, unitary FFT of H C W L, where L = lens(...).  Bin (i, j) is the
 * direction (fx, fy) lambda with fx = (i - n/2)/(n p), fy = (n/2 - j)/(n p).  Unitary: the
 * total power is that of the light leaving the plate through the window.
 */
export function look(H, C, L, n, p, win, out) {
  const { re, im } = out, h = n / 2;
  for (let j = 0; j < n; j++) {
    const y = (h - j) * p;
    for (let i = 0, o = j * n; i < n; i++, o++) {
      let w = H[o];
      if (win) {
        const dx = (i - h) * p - win.x, dy = y - win.y;
        if (dx * dx + dy * dy > win.r * win.r) w = 0;
      }
      let a = L.re[o] * w, b = L.im[o] * w;
      if (C) { const c = C.re[o], s = C.im[o]; const t = a * c - b * s; b = a * s + b * c; a = t; }
      re[o] = a; im[o] = b;
    }
  }
  fft2Centered(re, im, n, n);
  return out;
}

/**
 * The intensity of a camera view, drawn on a fixed grid of directions u = x/|d| (a step of
 * lambda0/(n p) radians, lambda0 the recording wavelength): a point in focus at (x, y) shows at
 * (x, y)/|d|, behind the plate or in front.  The camera's bins are directions lambda f at its own
 * wavelength lambda: with d > 0 the light from (x, y) arrives with f = -(x, y)/(lambda d), so
 * the bins are mirrored; with d < 0 they are not.  scale = lambda / lambda0; directions beyond
 * the camera's +-lambda/2p are dark.  Returns Float32Array(n * n) of intensities, row 0 at the top.
 */
export function viewImage(eye, n, d, scale = 1, out = new Float32Array(n * n)) {
  const h = n / 2, sgn = d < 0 ? 1 : -1, s = sgn / scale;
  const { re, im } = eye;
  const I = (i, j) => { const o = j * n + i; return re[o] * re[o] + im[o] * im[o]; };
  if (scale === 1) {
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = (h + sgn * (i - h) + n) % n, b = (h + sgn * (j - h) + n) % n;
      out[j * n + i] = I(a, b);
    }
    return out;
  }
  for (let j = 0; j < n; j++) {
    const fy = h + s * (j - h), y0 = Math.floor(fy), ty = fy - y0;
    for (let i = 0; i < n; i++) {
      const fx = h + s * (i - h), x0 = Math.floor(fx), tx = fx - x0;
      if (x0 < 0 || y0 < 0 || x0 + 1 >= n || y0 + 1 >= n) { out[j * n + i] = 0; continue; }
      out[j * n + i] = (I(x0, y0) * (1 - tx) + I(x0 + 1, y0) * tx) * (1 - ty) + (I(x0, y0 + 1) * (1 - tx) + I(x0 + 1, y0 + 1) * tx) * ty;
    }
  }
  return out;
}

/** The hologram's 2D Fourier transform (centred, unitary): bin (i, j) as in look(). */
export function spectrum(H, n, out = field(n)) {
  out.re.set(H); out.im.fill(0);
  fft2Centered(out.re, out.im, n, n);
  return out;
}

// ------------------------------------------------------------------- where the images go

/**
 * Where a point's images form, from the paraxial holography equations.  Every wave is described
 * at the plate by its curvature c = 1/R (R > 0: diverging from a point R behind the plate;
 * R < 0: converging to a point |R| in front; 0: plane) and its "tilt" t = position/R, so that
 * its phase is (pi/lambda)(c r^2 - 2 t.r) (a plane wave along direction sin(theta) has c = 0 and
 * t = -sin(theta)).  The plate multiplies the phases: lit by C at wavelength lambda2, the
 * images have
 *    c = c_C +- mu (c_O - c_R),   t = t_C +- mu (t_O - t_R),   mu = lambda2 / lambda1,
 * the + sign giving the image that continues the object's own wave (virtual, behind the plate,
 * when C = R) and the - sign its twin.  Each wave is {c, tx, ty}.  Returns, for each image,
 * {R: signed distance (Infinity if it is at infinity), x, y, ux, uy} with u = (x, y)/|R|, the
 * direction in which it is drawn.
 */
export function images(O, R, C, mu) {
  const out = {};
  for (const [name, sg] of [['image', 1], ['twin', -1]]) {
    const c = C.c + sg * mu * (O.c - R.c), tx = C.tx + sg * mu * (O.tx - R.tx), ty = C.ty + sg * mu * (O.ty - R.ty);
    const Rr = c === 0 ? Infinity : 1 / c;
    // u = t sign(R).  An image at infinity (a plane wave travelling along -t) is drawn where a
    // camera focused far behind the plate sees it, at u = t.
    const sg2 = c === 0 ? 1 : Math.sign(Rr);
    out[name] = { R: Rr, x: tx * Rr, y: ty * Rr, ux: tx * sg2, uy: ty * sg2 };
  }
  return out;
}

/** The wave description used by images() for a point at (x, y, depth z). */
export const pointDescription = (pt) => ({ c: 1 / pt.z, tx: pt.x / pt.z, ty: pt.y / pt.z });
/** ... for a plane wave tilted by theta towards +y (conj: the reversed beam). */
export const planeDescription = (theta, conj = false) => ({ c: 0, tx: 0, ty: (conj ? 1 : -1) * Math.sin(theta) });
/** ... for a point source, or (conj) the wave converging back to it. */
export const sphereDescription = (src, conj = false) => {
  const d = pointDescription(src);
  return conj ? { c: -d.c, tx: -d.tx, ty: -d.ty } : d;
};
