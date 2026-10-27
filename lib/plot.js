// Small helpers for drawing graphs on a canvas: sharp on high-resolution screens, "nice" tick
// values, and axes in the page's colours (so dark mode works).

import { fixedNum } from './ui.js';

/** Size a canvas's backing store to its displayed size times the device pixel ratio, and
 *  return a context scaled so that drawing coordinates are CSS pixels. */
export function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: r.width, height: r.height, dpr };
}

/** Tick values between lo and hi: steps of 1, 2 or 5 times a power of ten. */
export function niceTicks(lo, hi, target = 5) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / target, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
  const out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9 * step; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

export function tickLabel(v) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e4 || a < 1e-3) return v.toExponential(0).replace('e+', 'e');
  return String(+v.toPrecision(4)).replace('-', '−');
}

/**
 * Draw a line of words and live numbers on a canvas so that nothing in it moves as the numbers
 * change: parts as for setSlots in ui.js (strings, and {v, dec, w, plus, tiny} or {text, w} for each
 * number), every number right-aligned in a slot w figures wide (plus room for a minus sign).
 * The line as a whole follows ctx.textAlign.  Returns its width, the same for any numbers.
 */
export function fillSlots(ctx, parts, x, y) {
  const fig = ctx.measureText('0').width, minus = Math.max(0, ctx.measureText('−').width - fig);
  const widths = parts.map((p) => (typeof p === 'string' ? ctx.measureText(p).width : p.w * fig + minus));
  const total = widths.reduce((a, b) => a + b, 0), align = ctx.textAlign;
  let px = align === 'center' ? x - total / 2 : align === 'right' || align === 'end' ? x - total : x;
  parts.forEach((p, i) => {
    if (typeof p === 'string') { ctx.textAlign = 'left'; ctx.fillText(p, px, y); }
    else {
      ctx.textAlign = 'right';
      ctx.fillText(p.text !== undefined ? String(p.text) : fixedNum(p.v, p.dec ?? 2, p.w, { plus: p.plus ?? '', tiny: p.tiny }), px + widths[i], y);
    }
    px += widths[i];
  });
  ctx.textAlign = align;
  return total;
}

/** Colours from the page's CSS custom properties. */
export function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const get = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  return {
    ink: get('--ink', '#1d1d1f'), ink2: get('--ink-2', '#555'), ink3: get('--ink-3', '#888'),
    line: get('--line', '#ddd'), panel: get('--panel', '#fff'), bg: get('--bg', '#f4f3ef'),
    accent: get('--accent', '#2f62d8'), warn: get('--warn', '#b3261e'), good: get('--good', '#1f7a3a'),
  };
}

/**
 * A rectangular plot area inside a canvas, with linear maps from data to pixels.
 *   const p = new Frame(ctx, width, height, { left: 44, right: 10, top: 8, bottom: 26 });
 *   p.x0 = -10; p.x1 = 10; p.y0 = 0; p.y1 = 1;
 *   p.X(x), p.Y(y)  data -> CSS pixels
 */
export class Frame {
  constructor(ctx, width, height, margin = {}) {
    this.ctx = ctx;
    this.m = { left: 46, right: 12, top: 10, bottom: 28, ...margin };
    this.left = this.m.left; this.top = this.m.top;
    this.w = Math.max(10, width - this.m.left - this.m.right);
    this.h = Math.max(10, height - this.m.top - this.m.bottom);
    this.right = this.left + this.w; this.bottom = this.top + this.h;
    this.x0 = 0; this.x1 = 1; this.y0 = 0; this.y1 = 1;
  }
  X(x) { return this.left + ((x - this.x0) / (this.x1 - this.x0)) * this.w; }
  Y(y) { return this.bottom - ((y - this.y0) / (this.y1 - this.y0)) * this.h; }
  invX(px) { return this.x0 + ((px - this.left) / this.w) * (this.x1 - this.x0); }
  invY(py) { return this.y0 + ((this.bottom - py) / this.h) * (this.y1 - this.y0); }

  clip() {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(this.left, this.top, this.w, this.h);
    this.ctx.clip();
  }

  /** Axes, ticks and labels.  opts: xlabel (a string, or parts for fillSlots), ylabel, colors,
   *  yTicks (false hides), grid. */
  axes(opts = {}) {
    const { ctx } = this, c = opts.colors || themeColors();
    ctx.save();
    ctx.font = '11px system-ui, sans-serif';
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.line;
    ctx.strokeRect(this.left + 0.5, this.top + 0.5, this.w - 1, this.h - 1);
    ctx.fillStyle = c.ink2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const v of opts.xTicks === false ? [] : niceTicks(Math.min(this.x0, this.x1), Math.max(this.x0, this.x1), Math.max(2, Math.round(this.w / 80)))) {
      const px = Math.round(this.X(v)) + 0.5;
      if (opts.grid) { ctx.strokeStyle = c.line; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(px, this.top); ctx.lineTo(px, this.bottom); ctx.stroke(); ctx.globalAlpha = 1; }
      ctx.strokeStyle = c.ink3;
      ctx.beginPath(); ctx.moveTo(px, this.bottom); ctx.lineTo(px, this.bottom + 4); ctx.stroke();
      ctx.fillText(tickLabel(v), px, this.bottom + 6);
    }
    if (opts.xlabel) {
      // Under the tick labels if there is room, else at the right end of the tick row.
      ctx.textBaseline = 'top';
      // A label with live numbers in it comes as parts for fillSlots.
      const put = (x, y) => (Array.isArray(opts.xlabel) ? fillSlots(ctx, opts.xlabel, x, y) : ctx.fillText(opts.xlabel, x, y));
      if (this.m.bottom >= 32) { ctx.textAlign = 'center'; put(this.left + this.w / 2, this.bottom + 19); }
      else { ctx.textAlign = 'left'; put(this.right + 4, this.bottom + 6); }
    }
    if (opts.yTicks !== false) {
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (const v of niceTicks(Math.min(this.y0, this.y1), Math.max(this.y0, this.y1), Math.max(2, Math.round(this.h / 50)))) {
        const py = Math.round(this.Y(v)) + 0.5;
        ctx.strokeStyle = c.ink3;
        ctx.beginPath(); ctx.moveTo(this.left - 4, py); ctx.lineTo(this.left, py); ctx.stroke();
        ctx.fillText(tickLabel(v), this.left - 6, py);
      }
    }
    if (opts.ylabel) {
      ctx.save();
      ctx.translate(12, this.top + this.h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(opts.ylabel, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  /** A second vertical axis on the right, for a quantity with its own range [lo, hi]. */
  rightAxis(lo, hi, label, colors) {
    const { ctx } = this, c = colors || themeColors();
    const Y = (v) => this.bottom - ((v - lo) / (hi - lo)) * this.h;
    ctx.save();
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = c.ink2; ctx.strokeStyle = c.ink3;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const v of niceTicks(lo, hi, Math.max(2, Math.round(this.h / 50)))) {
      const py = Math.round(Y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(this.right, py); ctx.lineTo(this.right + 4, py); ctx.stroke();
      ctx.fillText(tickLabel(v), this.right + 6, py);
    }
    if (label) {
      ctx.save();
      ctx.translate(this.right + this.m.right - 10, this.top + this.h / 2);
      ctx.rotate(Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
    ctx.restore();
    return Y;
  }
}

/**
 * Contour lines of a grid of values (row-major, nx by ny, NaN = no data) by marching squares.
 * Calls segment(x0, y0, x1, y1) with fractional grid coordinates for each piece of the level.
 */
export function contour(grid, nx, ny, level, segment) {
  const interp = (a, b) => (level - a) / (b - a);
  for (let j = 0; j + 1 < ny; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      const a = grid[j * nx + i], b = grid[j * nx + i + 1], c = grid[(j + 1) * nx + i + 1], d = grid[(j + 1) * nx + i];
      if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d))) continue;
      const code = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
      if (code === 0 || code === 15) continue;
      // Crossing points on the four edges: bottom (a-b), right (b-c), top (d-c), left (a-d).
      const B = [i + interp(a, b), j], R = [i + 1, j + interp(b, c)], T = [i + interp(d, c), j + 1], Lf = [i, j + interp(a, d)];
      const pairs = {
        1: [[Lf, B]], 2: [[B, R]], 3: [[Lf, R]], 4: [[R, T]], 5: [[Lf, T], [B, R]], 6: [[B, T]], 7: [[Lf, T]],
        8: [[Lf, T]], 9: [[B, T]], 10: [[Lf, B], [R, T]], 11: [[R, T]], 12: [[Lf, R]], 13: [[B, R]], 14: [[Lf, B]],
      }[code];
      for (const [p, q] of pairs) segment(p[0], p[1], q[0], q[1]);
    }
  }
}
