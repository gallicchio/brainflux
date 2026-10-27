// Model skies for aperture synthesis, on an n x n grid of pixels pix radians across.  Pixel
// (i, j), column i and row j, is the direction l = (i - n/2) pix east, m = (n/2 - j) pix north
// of the centre.  Every sky is scaled to a total flux of 1 (jansky, say).

export const SKIES = {
  point: 'Point',
  double: 'Double',
  disk: 'Disk',
  ring: 'Ring',
  portrait: 'Fourier',
  typed: 'Typed',
};

/**
 * A sky typed as a formula I(x, y) (an Expression from lib/expr.js), with x east and y north
 * in units of `unit` radians.  Negative brightness is set to zero; the total is scaled to 1.
 */
export function typedSky(expr, params, n, pix, unit) {
  const x = new Float64Array(n * n), y = new Float64Array(n * n), s = pix / unit;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { x[j * n + i] = (i - n / 2) * s; y[j * n + i] = (n / 2 - j) * s; }
  const { re } = expr.evaluate({ ...params, x, y }, n * n);
  const sky = new Float64Array(n * n);
  let total = 0;
  for (let i = 0; i < sky.length; i++) { const v = re[i]; if (v > 0 && Number.isFinite(v)) { sky[i] = v; total += v; } }
  if (total > 0) for (let i = 0; i < sky.length; i++) sky[i] /= total;
  return sky;
}

/**
 * Make a sky.
 *   kind   'point' | 'double' | 'disk' | 'ring' | 'portrait'
 *   size   its angular size (radians): the separation of the double, the diameter of the disk
 *          and the ring, the width of the portrait
 *   image  for the portrait: { data: Float64Array of grey levels 0..1, w, h }
 */
export function makeSky(kind, n, pix, size, image = null) {
  const sky = new Float64Array(n * n), h = n / 2, s = size / pix;   // size in pixels
  if (kind === 'point') sky[h * n + h] = 1;
  else if (kind === 'double') {
    // Two points s apart at position angle 60 degrees (north through east), fluxes 1 : 0.6.
    const pa = (60 * Math.PI) / 180, dx = Math.round((s / 2) * Math.sin(pa)), dy = Math.round((s / 2) * Math.cos(pa));
    sky[(h - dy) * n + h + dx] += 1;
    sky[(h + dy) * n + h - dx] += 0.6;
  } else if (kind === 'disk' || kind === 'ring') {
    // Supersampled 4 x 4 per pixel, so the edges are smooth.
    const R = s / 2, w = 0.08 * s;
    const f = kind === 'disk'
      ? (x, y) => +(x * x + y * y < R * R)
      : (x, y) => {
        // A thin ring, brighter on its southern side (as the ring of M87* is).
        const r = Math.hypot(x, y), b = Math.exp(-((r - R) ** 2) / (2 * w * w));
        return r > 0 ? b * (1 - 0.6 * (y / r)) : b;
      };
    const reach = Math.min(h - 1, Math.ceil(R + (kind === 'ring' ? 5 * w : 1)));
    for (let j = h - reach; j <= h + reach; j++) for (let i = h - reach; i <= h + reach; i++) {
      let acc = 0;
      for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) acc += f(i - h + (a - 1.5) / 4, h - j - (b - 1.5) / 4);
      sky[j * n + i] = acc / 16;
    }
  } else if (kind === 'portrait' && image) {
    // The picture, s pixels wide, light where the paper is, in a soft round frame.
    const { data, w: iw, h: ih } = image, side = Math.min(iw, ih), R = s / 2;
    const reach = Math.min(h - 1, Math.ceil(R));
    for (let j = h - reach; j <= h + reach; j++) for (let i = h - reach; i <= h + reach; i++) {
      const x = (i - h) / s + 0.5, y = (j - h) / s + 0.5;       // 0..1 across the picture
      const r = Math.hypot(x - 0.5, y - 0.5) * 2;
      if (r >= 1) continue;
      const frame = r < 0.8 ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (r - 0.8)) / 0.2);
      const px = Math.min(iw - 1, Math.max(0, x * side + (iw - side) / 2)), py = Math.min(ih - 1, Math.max(0, y * side + (ih - side) / 2));
      sky[j * n + i] = frame * bilinear(data, iw, ih, px, py);
    }
  }
  let total = 0;
  for (let i = 0; i < sky.length; i++) total += sky[i];
  if (total > 0) for (let i = 0; i < sky.length; i++) sky[i] /= total;
  return sky;
}

function bilinear(d, w, h, x, y) {
  const i = Math.min(w - 2, Math.floor(x)), j = Math.min(h - 2, Math.floor(y)), fx = x - i, fy = y - j;
  return (d[j * w + i] * (1 - fx) + d[j * w + i + 1] * fx) * (1 - fy) + (d[(j + 1) * w + i] * (1 - fx) + d[(j + 1) * w + i + 1] * fx) * fy;
}
