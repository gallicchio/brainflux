// Drawing helpers for the radio interferometry page: square pictures with their axes outside
// them, the complex plane with its colour wheel, waves, filled products and arrows.  They draw
// what they are given; the page decides what that is.

import { colorize, cssColorOf } from '../lib/complexcolor.js';
import { fitCanvas, niceTicks, tickLabel } from '../lib/plot.js';

const TWO_PI = 2 * Math.PI;

/**
 * Size a canvas and find the largest square inside it that leaves the margins free (for tick
 * labels): returns {ctx, width, height, x, y, s}, the square's top left corner and side.
 */
export function squareArea(canvas, { left = 38, right = 6, top = 6, bottom = 30 } = {}) {
  const { ctx, width, height } = fitCanvas(canvas);
  const s = Math.max(20, Math.min(width - left - right, height - top - bottom));
  const x = left + Math.max(0, (width - left - right - s) / 2), y = top + Math.max(0, (height - top - bottom - s) / 2);
  return { ctx, width, height, x, y, s };
}

/** Put an n x n RGBA image into the square area (smoothed or as blocks). */
export function blit(ctx, area, data, n, smooth = true) {
  const off = blit.canvas || (blit.canvas = document.createElement('canvas'));
  if (off.width !== n) { off.width = off.height = n; }
  const octx = off.getContext('2d');
  octx.putImageData(data instanceof ImageData ? data : new ImageData(data, n, n), 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = smooth;
  ctx.drawImage(off, area.x, area.y, area.s, area.s);
  ctx.restore();
}

/**
 * Ticks and labels round a square picture, outside it.  axes: {bottom, top, left}, each
 * {ticks: [{f, label}], title}, with f the fraction along the edge (0 left/bottom, 1 right/top).
 */
export function pictureAxes(ctx, area, axes, C) {
  const { x, y, s } = area;
  ctx.save();
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = C.ink2; ctx.strokeStyle = C.ink3; ctx.lineWidth = 1;
  ctx.strokeStyle = C.line; ctx.strokeRect(x - 0.5, y - 0.5, s + 1, s + 1); ctx.strokeStyle = C.ink3;
  const tick = (side) => {
    const a = axes[side];
    if (!a) return;
    for (const { f, label } of a.ticks) {
      if (f < -1e-9 || f > 1 + 1e-9) continue;
      ctx.beginPath();
      if (side === 'bottom') { const px = Math.round(x + f * s) + 0.5; ctx.moveTo(px, y + s); ctx.lineTo(px, y + s + 4); ctx.stroke(); ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(label, px, y + s + 5); }
      else if (side === 'top') { const px = Math.round(x + f * s) + 0.5; ctx.moveTo(px, y); ctx.lineTo(px, y - 4); ctx.stroke(); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(label, px, y - 5); }
      else { const py = Math.round(y + (1 - f) * s) + 0.5; ctx.moveTo(x, py); ctx.lineTo(x - 4, py); ctx.stroke(); ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(label, x - 6, py); }
    }
  };
  tick('bottom'); tick('top'); tick('left');
  ctx.fillStyle = C.ink2;
  if (axes.bottom?.title) { ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText(axes.bottom.title, x + s, y + s + 17); }
  if (axes.top?.title) { ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(axes.top.title, x + s, y - 17); }
  if (axes.left?.title) {
    ctx.save(); ctx.translate(9, y + s / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(axes.left.title, 0, 0); ctx.restore();
  }
  ctx.restore();
}

/** Ticks for a picture spanning values lo..hi along an edge: [{f, label}], at nice values. */
export function edgeTicks(lo, hi, target = 5, format = tickLabel) {
  return niceTicks(lo, hi, target).map((v) => ({ f: (v - lo) / (hi - lo), label: format(v) }));
}

/** An arrow from (x0, y0) to (x1, y1) in the current stroke colour. */
export function arrow(ctx, x0, y0, x1, y1, head = 8) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  if (L < 3) return;
  const ux = dx / L, uy = dy / L, h = Math.min(head, L / 2);
  ctx.beginPath(); ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - h * ux + 0.5 * h * uy, y1 - h * uy - 0.5 * h * ux);
  ctx.lineTo(x1 - h * ux - 0.5 * h * uy, y1 - h * uy + 0.5 * h * ux); ctx.closePath();
  const f = ctx.fillStyle; ctx.fillStyle = ctx.strokeStyle; ctx.fill(); ctx.fillStyle = f;
}

/** A polyline of values against x (pixel positions given by X and Y maps). */
export function line(ctx, n, X, Y) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) { const px = X(i), py = Y(i); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  ctx.stroke();
}

/** Fill the area between a curve and zero: one colour above, another below. */
export function fillSigned(ctx, n, X, Y, y0, above, below) {
  for (const [colour, keep] of [[above, (v) => v > y0], [below, (v) => v < y0]]) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(X(0), y0);
    for (let i = 0; i < n; i++) { const py = Y(i); ctx.lineTo(X(i), keep(py) ? y0 : py); }
    ctx.lineTo(X(n - 1), y0); ctx.closePath(); ctx.fill();
  }
}

/** The colour wheel of the complex plane, RGBA n x n, for values out to ±extent, brightness R. */
export function wheel(n, extent, R, mode = 'complex') {
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { re[j * n + i] = ((i + 0.5) / n - 0.5) * 2 * extent; im[j * n + i] = (0.5 - (j + 0.5) / n) * 2 * extent; }
  const img = new ImageData(n, n);
  colorize(re, im, img.data, R, mode);
  return img;
}

/**
 * The complex plane: the colour wheel behind it (faintly), the axes, and a function to place
 * points.  Returns {X, Y, area} for drawing on it.
 */
export function complexPlane(canvas, { extent, R, mode = 'complex', C, alpha = 0.5, titles = ['real part →', 'imaginary part ↑'] }) {
  const area = squareArea(canvas, { left: 38, right: 8, top: 8, bottom: 26 });
  const { ctx, width, height, x, y, s } = area;
  ctx.clearRect(0, 0, width, height);
  const n = Math.max(24, Math.min(160, Math.round(s / 2)));
  const key = `${n}|${extent}|${R}|${mode}`;
  if (complexPlane.key !== key) { complexPlane.key = key; complexPlane.img = wheel(n, extent, R, mode); }
  ctx.save(); ctx.globalAlpha = alpha; blit(ctx, area, complexPlane.img, n, true); ctx.restore();
  const X = (re) => x + s / 2 + (re / extent) * (s / 2), Y = (im) => y + s / 2 - (im / extent) * (s / 2);
  ctx.save();
  ctx.strokeStyle = C.ink3; ctx.lineWidth = 1; ctx.globalAlpha = 0.7;
  ctx.beginPath(); ctx.moveTo(x, Y(0) + 0.5); ctx.lineTo(x + s, Y(0) + 0.5); ctx.moveTo(X(0) + 0.5, y); ctx.lineTo(X(0) + 0.5, y + s); ctx.stroke();
  ctx.restore();
  const ticks = edgeTicks(-extent, extent, Math.max(3, Math.round(s / 70)));
  pictureAxes(ctx, area, { bottom: { ticks, title: titles[0] }, left: { ticks, title: titles[1] } }, C);
  return { ctx, X, Y, area };
}

/** A dot coloured as the uv picture would colour the value (re, im), ringed so it shows on any hue. */
export function valueDot(ctx, px, py, re, im, R, r = 6) {
  ctx.save();
  ctx.fillStyle = cssColorOf(re, im, R);
  ctx.beginPath(); ctx.arc(px, py, r, 0, TWO_PI); ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.lineWidth = 1; ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.arc(px, py, r + 1.5, 0, TWO_PI); ctx.stroke();
  ctx.restore();
}

/** A ring (the exact value) and a cross (what this band and these delays give). */
export function ring(ctx, px, py, r, C) {
  ctx.save();
  ctx.lineWidth = 3; ctx.strokeStyle = C.panel; ctx.beginPath(); ctx.arc(px, py, r, 0, TWO_PI); ctx.stroke();
  ctx.lineWidth = 1.5; ctx.strokeStyle = C.ink; ctx.beginPath(); ctx.arc(px, py, r, 0, TWO_PI); ctx.stroke();
  ctx.restore();
}
export function cross(ctx, px, py, r, C) {
  ctx.save();
  ctx.lineWidth = 1.5; ctx.strokeStyle = C.ink;
  ctx.beginPath(); ctx.moveTo(px - r, py - r); ctx.lineTo(px + r, py + r); ctx.moveTo(px - r, py + r); ctx.lineTo(px + r, py - r); ctx.stroke();
  ctx.restore();
}

/** Text with a halo, readable over any picture. */
export function haloText(ctx, text, px, py, { fill = '#fff', halo = 'rgba(0,0,0,0.75)', width = 3 } = {}) {
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineWidth = width; ctx.strokeStyle = halo; ctx.strokeText(text, px, py);
  ctx.fillStyle = fill; ctx.fillText(text, px, py);
  ctx.restore();
}
