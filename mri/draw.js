// Drawing helpers shared by the views: spins as little compass needles, the transverse
// magnetization as a strip or a map of complex colour (the colouring of the FFT and plane-wave
// demos: hue is the phase, lightness the magnitude), the colour wheel that says so, and a few
// shapes.  Everything comes in as arguments; nothing here knows the physics.

import { colorOf, colorize, drawWheel } from '../lib/complexcolor.js';

export const FONT = '12px system-ui, sans-serif', SMALL = '11px system-ui, sans-serif', BOLD = '600 12px system-ui, sans-serif';

/** The CSS colour of the complex number re + i im at brightness R (lib/complexcolor.js). */
export function cssComplex(re, im, R = 1) {
  const [r, g, b] = colorOf(re, im, R);
  return `rgb(${r},${g},${b})`;
}

/** The colour of a phase phi at full colour. */
export const phaseColour = (phi) => cssComplex(Math.cos(phi), Math.sin(phi), 1);

/** An arrow from (x0, y0) to (x1, y1) with a filled head. */
export function arrow(ctx, x0, y0, x1, y1, head = 7, width = null) {
  const a = Math.atan2(y1 - y0, x1 - x0), L = Math.hypot(x1 - x0, y1 - y0);
  if (width) ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - 0.6 * Math.min(head, 0.8 * L) * Math.cos(a), y1 - 0.6 * Math.min(head, 0.8 * L) * Math.sin(a)); ctx.stroke();
  if (L < 1.5) return;
  const h = Math.min(head, 0.8 * L);
  ctx.beginPath(); ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - h * Math.cos(a - 0.42), y1 - h * Math.sin(a - 0.42));
  ctx.lineTo(x1 - h * Math.cos(a + 0.42), y1 - h * Math.sin(a + 0.42));
  ctx.closePath(); ctx.fill();
}

/**
 * One spin seen from above, as a compass: a faint ring of radius r and a needle of length
 * len * r pointing at the phase phi (x' to the right, y' up), coloured by its phase.
 */
export function compass(ctx, cx, cy, r, phi, len, ringColour) {
  ctx.strokeStyle = ringColour; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.stroke();
  if (len <= 0.02) { ctx.fillStyle = ringColour; ctx.beginPath(); ctx.arc(cx, cy, 1.5, 0, 2 * Math.PI); ctx.fill(); return; }
  const c = phaseColour(phi);
  ctx.strokeStyle = c; ctx.fillStyle = c;
  arrow(ctx, cx, cy, cx + len * r * Math.cos(phi), cy - len * r * Math.sin(phi), Math.max(3.5, 0.5 * r), Math.max(1.4, 0.18 * r));
}

/** A strip (or map) of complex values, w x h samples, drawn into the box (x, y, W, H). */
export function complexImage(ctx, re, im, w, h, x, y, W, H, R = 1, smooth = false, mode = 'complex') {
  const off = complexImage.off || (complexImage.off = document.createElement('canvas'));
  if (off.width !== w || off.height !== h) { off.width = w; off.height = h; }
  const octx = off.getContext('2d'), img = octx.createImageData(w, h);
  colorize(re, im, img.data, R, mode);
  octx.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = smooth;
  ctx.drawImage(off, x, y, W, H);
  ctx.restore();
}

/** A grey picture (values from 0 to vmax, clipped), w x h, into the box (x, y, W, H). */
export function greyImage(ctx, v, w, h, x, y, W, H, vmax, smooth = false) {
  const off = greyImage.off || (greyImage.off = document.createElement('canvas'));
  if (off.width !== w || off.height !== h) { off.width = w; off.height = h; }
  const octx = off.getContext('2d'), img = octx.createImageData(w, h), d = img.data, s = vmax > 0 ? 255 / vmax : 0;
  for (let i = 0, o = 0; i < w * h; i++, o += 4) {
    const g = Math.max(0, Math.min(255, v[i] * s));
    d[o] = d[o + 1] = d[o + 2] = g; d[o + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = smooth;
  ctx.drawImage(off, x, y, W, H);
  ctx.restore();
}

let WHEEL = null;
/** The colour wheel (phase as hue, magnitude as lightness) as a disk of radius r at (cx, cy). */
export function wheel(ctx, cx, cy, r) {
  if (!WHEEL) { WHEEL = document.createElement('canvas'); WHEEL.width = WHEEL.height = 96; drawWheel(WHEEL, 1, 1.6); }
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.clip();
  ctx.drawImage(WHEEL, cx - r, cy - r, 2 * r, 2 * r);
  ctx.restore();
}

/** A label with a halo in the background colour, so that it reads over a picture. */
export function haloText(ctx, text, x, y, ink, halo, width = 3) {
  ctx.save();
  ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.strokeStyle = halo; ctx.strokeText(text, x, y);
  ctx.fillStyle = ink; ctx.fillText(text, x, y);
  ctx.restore();
}

/** A small round handle (for dragging), filled, with a ring. */
export function handle(ctx, x, y, r, fill, ring) {
  ctx.fillStyle = fill; ctx.strokeStyle = ring; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
}

/**
 * The value at the fraction q of the way up a list of numbers (the one a sort would put at
 * floor(q (n − 1))), found by quickselect in place, in linear time: the brightness scales of the
 * pictures and of k-space, made again at every change, without sorting 16 384 numbers each time.
 * a is a Float64Array that is reordered.
 */
export function quantile(a, q) {
  const n = a.length;
  if (!n) return 0;
  const k = Math.floor(q * (n - 1));
  let lo = 0, hi = n - 1;
  while (hi > lo) {
    // (The median of three as the pivot; Hoare's partition.)
    const mid = (lo + hi) >> 1;
    let x = a[lo], y = a[mid], z = a[hi];
    const p = x < y ? (y < z ? y : x < z ? z : x) : (x < z ? x : y < z ? z : y);
    let i = lo, j = hi;
    while (i <= j) {
      while (a[i] < p) i++;
      while (a[j] > p) j--;
      if (i <= j) { x = a[i]; a[i] = a[j]; a[j] = x; i++; j--; }
    }
    if (k <= j) hi = j; else if (k >= i) lo = i; else return a[k];
  }
  return a[k];
}

/** A brightness for k-space: the magnitude that 3% of its pixels exceed (so the centre's
 *  bright few do not drown the rest), as the FFT demo's transforms are drawn. */
export function kspaceBrightness(re, im) {
  const n = re.length, mags = new Float64Array(n);
  for (let i = 0; i < n; i++) mags[i] = Math.hypot(re[i], im[i]);
  return quantile(mags, 0.97) || 1;
}

/** A seeded uniform random generator (xorshift32), for spins' offsets that stay put. */
export function seeded(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
