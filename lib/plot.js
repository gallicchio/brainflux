// Small helpers for drawing graphs on a canvas: sharp on high-resolution screens, "nice" tick
// values, and axes in the page's colours (so dark mode works).

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

  /** Axes, ticks and labels.  opts: xlabel, ylabel, colors, yTicks (false hides), grid. */
  axes(opts = {}) {
    const { ctx } = this, c = opts.colors || themeColors();
    ctx.save();
    ctx.font = '11px system-ui, sans-serif';
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.line;
    ctx.strokeRect(this.left + 0.5, this.top + 0.5, this.w - 1, this.h - 1);
    ctx.fillStyle = c.ink2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const v of niceTicks(this.x0, this.x1, Math.max(2, Math.round(this.w / 80)))) {
      const px = Math.round(this.X(v)) + 0.5;
      if (opts.grid) { ctx.strokeStyle = c.line; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(px, this.top); ctx.lineTo(px, this.bottom); ctx.stroke(); ctx.globalAlpha = 1; }
      ctx.strokeStyle = c.ink3;
      ctx.beginPath(); ctx.moveTo(px, this.bottom); ctx.lineTo(px, this.bottom + 4); ctx.stroke();
      ctx.fillText(tickLabel(v), px, this.bottom + 6);
    }
    if (opts.xlabel) {
      // Under the tick labels if there is room, else at the right end of the tick row.
      ctx.textBaseline = 'top';
      if (this.m.bottom >= 32) { ctx.textAlign = 'center'; ctx.fillText(opts.xlabel, this.left + this.w / 2, this.bottom + 19); }
      else { ctx.textAlign = 'left'; ctx.fillText(opts.xlabel, this.right + 4, this.bottom + 6); }
    }
    if (opts.yTicks !== false) {
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (const v of niceTicks(this.y0, this.y1, Math.max(2, Math.round(this.h / 50)))) {
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
