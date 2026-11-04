// Small drawing helpers shared by the views: the page's colours, the field of a set of bursts,
// the detector's trace drawn column by column, grey-scale images in decibels.

import { themeColors } from '../lib/plot.js';

/** The theme's colours and this demo's own (oct.css). */
export function octColors() {
  const cs = getComputedStyle(document.documentElement), g = (n, f) => cs.getPropertyValue(n).trim() || f;
  return {
    ...themeColors(),
    sig: g('--sig', '#2f62d8'), env: g('--env', '#c8501a'), gate: g('--gate', '#9a7400'), layer: g('--layer', '#7b3fb5'),
    noise: g('--noisec', '#8a8b91'), faint: g('--faint', 'rgba(0,0,0,0.05)'), mirror: g('--mirrorc', '#1f7a3a'),
  };
}

/** E(Δ) = Σ a_i γ(Δ − Δ_i) (with each burst's dispersion), as [re, im]. */
export function fieldAt(bursts, src, D, out = [0, 0]) {
  let re = 0, im = 0;
  const g = [0, 0];
  for (const b of bursts) {
    if (Math.abs(D - b.D) > src.reachWith(b.beta || 0)) continue;
    src.gamma(D - b.D, g, b.beta || 0);
    re += b.a * g[0]; im += b.a * g[1];
  }
  out[0] = re; out[1] = im;
  return out;
}

/**
 * The lowest and highest detector signal I = dc + 2 Re E over round-trip paths [Da, Db]: the
 * envelope dc ± 2|E| when the interval holds a whole fringe (λ₀/2 of Δ), else sampled.
 */
export function signalRange(bursts, src, dc, Da, Db, out = [0, 0]) {
  const g = [0, 0];
  let lo = Infinity, hi = -Infinity;
  if (Db - Da >= src.lam0 / 2) {
    let e = 0;
    for (let i = 0; i <= 4; i++) { fieldAt(bursts, src, Da + ((Db - Da) * i) / 4, g); e = Math.max(e, Math.hypot(g[0], g[1])); }
    out[0] = dc - 2 * e; out[1] = dc + 2 * e;
    return out;
  }
  const n = Math.max(2, Math.ceil((Db - Da) / (src.lam0 / 24)) + 1);
  for (let i = 0; i < n; i++) {
    const I = dc + 2 * fieldAt(bursts, src, Da + ((Db - Da) * i) / (n - 1), g)[0];
    if (I < lo) lo = I;
    if (I > hi) hi = I;
  }
  out[0] = lo; out[1] = hi;
  return out;
}

/** Merge [a, b] into a sorted list of disjoint intervals. */
export function addInterval(list, a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b), out = [];
  let nlo = lo, nhi = hi, placed = false;
  for (const iv of list) {
    if (iv[1] < nlo) out.push(iv);
    else if (iv[0] > nhi) { if (!placed) { out.push([nlo, nhi]); placed = true; } out.push(iv); }
    else { nlo = Math.min(nlo, iv[0]); nhi = Math.max(nhi, iv[1]); }
  }
  if (!placed) out.push([nlo, nhi]);
  return out;
}

/** Does the list of intervals cover [a, b] (any part of it)? */
export function covers(list, a, b) {
  for (const iv of list) if (iv[1] >= a && iv[0] <= b) return true;
  return false;
}

/**
 * Grey levels for an amplitude in decibels: 0 at `lo` dB and below, 255 at `hi` and above
 * (20 log₁₀ of the amplitude, so 10 log₁₀ of the reflected power), as clinical OCT shows it.
 */
export function greyOf(a, lo, hi) {
  const db = a > 0 ? 20 * Math.log10(a) : -300;
  const t = (db - lo) / (hi - lo);
  return t <= 0 ? 0 : t >= 1 ? 255 : Math.round(255 * t);
}

/**
 * Paint an image of amplitudes into a canvas of nx × ny pixels: value(i, j) for pixel column i,
 * row j; grey levels from lo to hi dB; unmeasured (value null) drawn dark blue-grey.
 */
export function paintImage(canvas, nx, ny, value, lo, hi) {
  if (canvas.width !== nx || canvas.height !== ny) { canvas.width = nx; canvas.height = ny; }
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(nx, ny), px = new Uint32Array(img.data.buffer);
  const LUT = new Uint32Array(256);
  for (let g = 0; g < 256; g++) LUT[g] = (0xff000000 | (g << 16) | (g << 8) | g) >>> 0;
  const EMPTY = 0xff2a2018 >>> 0;   // ABGR: rgb(24, 32, 42)
  const k = 255 / (hi - lo), l10 = 20 / Math.LN10;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = value(i, j);
    if (a === null) { px[j * nx + i] = EMPTY; continue; }
    const t = a > 0 ? (l10 * Math.log(a) - lo) * k : 0;
    px[j * nx + i] = LUT[t <= 0 ? 0 : t >= 255 ? 255 : t | 0];
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** A tick step of 1, 2 or 5 times a power of ten giving about n ticks over a span. */
export function niceStep(span, n = 5) {
  const raw = span / n, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

/** A length in μm for a label: "250 μm", "1.2 mm", "0.42 μm". */
export function um(v, dec) {
  const a = Math.abs(v);
  if (a >= 1000) return `${(v / 1000).toFixed(dec ?? (a >= 10000 ? 0 : 1))} mm`;
  return `${dec !== undefined ? v.toFixed(dec) : +v.toPrecision(3)} μm`;
}
