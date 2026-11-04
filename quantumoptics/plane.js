// The quadrature plane: the state's Wigner function as a cloud (red where positive, as in the
// phase-space demo; a Gaussian state is never negative, so blue never appears), its mean on a
// stick from the origin, a point drawn from the cloud, the 1σ ellipse, the phase-noise wedge,
// a measurement axis at an angle with the samples' histogram projected onto it.

import { fitCanvas, Frame, themeColors } from '../lib/plot.js';
import { wignerGrid, W_MAX, principalSpreads } from './states.js';

const IMG = 320;    // the Wigner image's pixels across

let lut = null, lutDark = null;
function isDark() {
  const c = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim();
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(c);
  if (!m) return window.matchMedia('(prefers-color-scheme: dark)').matches;
  return 0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16) < 128;
}
/** The phase-space demo's diverging map: zero is the panel's colour, positive warm, negative cool. */
function buildLut() {
  const dark = isDark();
  const stops = dark
    ? [[-1, [120, 200, 255]], [-0.5, [40, 105, 190]], [0, [28, 29, 34]], [0.5, [185, 75, 40]], [1, [255, 185, 95]]]
    : [[-1, [33, 102, 172]], [-0.5, [140, 192, 222]], [0, [255, 255, 255]], [0.5, [244, 165, 130]], [1, [178, 24, 43]]];
  const N = 1024, out = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    const v = -1 + (2 * i) / (N - 1);
    let k = 0;
    while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
    const [va, ca] = stops[k], [vb, cb] = stops[k + 1], t = (v - va) / (vb - va);
    for (let c = 0; c < 3; c++) out[i * 4 + c] = ca[c] + t * (cb[c] - ca[c]);
    out[i * 4 + 3] = 255;
  }
  lut = out; lutDark = dark;
}
export function colorAt(v) {
  if (!lut || lutDark !== isDark()) buildLut();
  const i = Math.round(((Math.max(-1, Math.min(1, v)) + 1) / 2) * 1023) * 4;
  return `rgb(${lut[i]},${lut[i + 1]},${lut[i + 2]})`;
}
/** The colour bar's canvas, from −2/π to +2/π. */
export function drawColorbar(cv) {
  const { ctx, width, height } = fitCanvas(cv);
  for (let i = 0; i < width; i++) { ctx.fillStyle = colorAt(-1 + (2 * (i + 0.5)) / width); ctx.fillRect(i, 0, 1, height); }
  ctx.strokeStyle = themeColors().line; ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
}

export class Plane {
  constructor(canvas, { extent = 5, labels = ['X₁', 'X₂'] } = {}) {
    this.canvas = canvas; this.extent = extent; this.labels = labels;
    this.image = document.createElement('canvas');
    this.image.width = this.image.height = IMG;
    this.imgData = this.image.getContext('2d').createImageData(IMG, IMG);
    this.grid = new Float32Array(IMG * IMG);
    this.imageKey = '';
    this.frame = null;
  }

  /** Recompute the Wigner image for the (unturned) state st if it changed. */
  prepare(st) {
    const key = [st.x1, st.x2, st.s11, st.s12, st.s22, this.extent, isDark()].map((v) => (typeof v === 'number' ? v.toPrecision(6) : v)).join(',');
    if (key === this.imageKey) return;
    this.imageKey = key;
    if (!lut || lutDark !== isDark()) buildLut();
    wignerGrid(st, IMG, this.extent, this.grid);
    const d = this.imgData.data, inv = 1 / W_MAX;
    for (let j = 0; j < IMG; j++) {
      const row = (IMG - 1 - j) * IMG;      // X2 up
      for (let i = 0; i < IMG; i++) {
        const v = Math.min(1, this.grid[j * IMG + i] * inv);
        const li = Math.round((v + 1) * 511.5) * 4, pi = (row + i) * 4;
        d[pi] = lut[li]; d[pi + 1] = lut[li + 1]; d[pi + 2] = lut[li + 2]; d[pi + 3] = 255;
      }
    }
    this.image.getContext('2d').putImageData(this.imgData, 0, 0);
  }

  /** Pixel of a point; the frame must have been laid out by draw(). */
  X(x) { return this.frame.X(x); }
  Y(y) { return this.frame.Y(y); }
  /** The point under a pixel of the canvas (CSS pixels from its top left). */
  fromPixel(px, py) { return this.frame ? [this.frame.invX(px), this.frame.invY(py)] : [0, 0]; }

  /**
   * Draw.  base: the state whose image is cached (unturned); turn: the angle (radians,
   * counterclockwise) to turn it by; st: the turned state (its mean and spreads are drawn);
   * opts: {stick: [X1, X2] | null, ellipse, wedge, axis: degrees | null, hist: {centers, counts, max} | null,
   *        reference: state | null, mean: bool, colors, axisLabel, labelAxis: string}
   */
  draw(base, turn, st, opts = {}) {
    const { ctx, width, height } = fitCanvas(this.canvas);
    const c = opts.colors || themeColors();
    this.prepare(base);
    const m = Math.min(width, height);
    const f = new Frame(ctx, width, height, { left: 34, right: 10, top: 10, bottom: 26 });
    // Keep it square: the same scale on both axes.
    const side = Math.min(f.w, f.h);
    f.left = f.left + (f.w - side) / 2; f.top = f.top + (f.h - side) / 2;
    f.w = f.h = side; f.right = f.left + side; f.bottom = f.top + side;
    f.x0 = -this.extent; f.x1 = this.extent; f.y0 = -this.extent; f.y1 = this.extent;
    this.frame = f;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = c.panel; ctx.fillRect(f.left, f.top, f.w, f.h);
    f.clip();
    // The cloud, turned.
    ctx.save();
    ctx.translate(f.X(0), f.Y(0));
    ctx.rotate(turn);      // clockwise on the screen (y points down) by the turn, as the state's mean is
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(this.image, -side / 2, -side / 2, side, side);
    ctx.restore();
    // Axes through the origin.
    ctx.strokeStyle = c.ink3; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(f.left, f.Y(0) + 0.5); ctx.lineTo(f.right, f.Y(0) + 0.5); ctx.moveTo(f.X(0) + 0.5, f.top); ctx.lineTo(f.X(0) + 0.5, f.bottom); ctx.stroke();
    ctx.setLineDash([]);
    if (opts.reference) this.ellipse(ctx, opts.reference, c.ink3, [4, 3]);
    if (opts.ellipse !== false) this.ellipse(ctx, st, c.ink2, []);
    if (opts.wedge) this.wedge(ctx, st, c);
    if (opts.axis !== null && opts.axis !== undefined) this.axis(ctx, opts.axis, st, opts.hist, c, opts.axisLabel);
    if (opts.mean !== false && (st.x1 || st.x2)) {
      const px = f.X(st.x1), py = f.Y(st.x2);
      ctx.strokeStyle = c.ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(f.X(0), f.Y(0)); ctx.lineTo(px, py); ctx.stroke();
      ctx.fillStyle = c.ink; ctx.beginPath(); ctx.arc(px, py, 5, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = c.panel; ctx.beginPath(); ctx.arc(px, py, 2, 0, 2 * Math.PI); ctx.fill();
    }
    if (opts.stick) {
      const [sx, sy] = opts.stick, px = f.X(sx), py = f.Y(sy);
      ctx.strokeStyle = c.accent; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(f.X(0), f.Y(0)); ctx.lineTo(px, py); ctx.stroke();
      ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, f.Y(0)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = c.panel; ctx.beginPath(); ctx.arc(px, py, 4.5, 0, 2 * Math.PI); ctx.fill();
      ctx.beginPath(); ctx.arc(px, py, 4.5, 0, 2 * Math.PI); ctx.stroke();
      // Its shadow on the X1 axis: the field at this moment.
      ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(px, f.Y(0), 4, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.restore();
    f.axes({ colors: c, xlabel: `${this.labels[0]}${opts.xnote ? '  ' + opts.xnote : ''}`, ylabel: this.labels[1] });
    return f;
  }

  /** The 1σ ellipse of a state. */
  ellipse(ctx, st, color, dash) {
    const f = this.frame, sp = principalSpreads(st);
    ctx.save();
    ctx.translate(f.X(st.x1), f.Y(st.x2));
    ctx.rotate(-sp.angle);
    ctx.scale(sp.min * f.w / (2 * this.extent), sp.max * f.h / (2 * this.extent));
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, 2 * Math.PI);
    ctx.restore();
    ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
  }

  /** The phase-noise wedge: two lines from the origin tangent to the 1σ cloud (for a round cloud). */
  wedge(ctx, st, c) {
    const f = this.frame, a = Math.hypot(st.x1, st.x2);
    if (a < 1e-6) return;
    const sp = principalSpreads(st), dir = Math.atan2(st.x2, st.x1);
    const r = Math.sqrt(st.s11 * Math.sin(dir) ** 2 - 2 * st.s12 * Math.sin(dir) * Math.cos(dir) + st.s22 * Math.cos(dir) ** 2);  // ΔX across the mean
    const dphi = Math.atan2(r, a), R = this.extent * 1.6;
    ctx.strokeStyle = c.ink2; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    ctx.beginPath();
    for (const s of [-1, 1]) { ctx.moveTo(f.X(0), f.Y(0)); ctx.lineTo(f.X(R * Math.cos(dir + s * dphi)), f.Y(R * Math.sin(dir + s * dphi))); }
    ctx.stroke(); ctx.setLineDash([]);
    void sp;
  }

  /** The measurement axis at angle deg, through the origin, with the histogram of samples laid along it. */
  axis(ctx, deg, st, hist, c, label) {
    const f = this.frame, th = (deg * Math.PI) / 180, R = this.extent * 1.5;
    const ux = Math.cos(th), uy = Math.sin(th);
    ctx.strokeStyle = c.axis || '#d9a400'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(f.X(-R * ux), f.Y(-R * uy)); ctx.lineTo(f.X(R * ux), f.Y(R * uy)); ctx.stroke();
    // An arrowhead at the positive end, inside the frame.
    const Ra = this.extent * 0.92, ax = f.X(Ra * ux), ay = f.Y(Ra * uy);
    ctx.fillStyle = c.axis || '#d9a400';
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax - 12 * ux + 6 * uy, ay + 12 * uy + 6 * ux); ctx.lineTo(ax - 12 * ux - 6 * uy, ay + 12 * uy - 6 * ux); ctx.closePath(); ctx.fill();
    if (label) {
      ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const Rl = this.extent * 0.78;
      ctx.fillText(label, f.X(Rl * ux) + 14 * uy, f.Y(Rl * uy) + 14 * ux);
    }
    if (hist && hist.counts.length) {
      // Bars perpendicular to the axis on its left side, height ∝ count.
      const hmax = hist.max || 1, hscale = (this.extent * 0.28) / hmax, bw = hist.centers.length > 1 ? hist.centers[1] - hist.centers[0] : 0.1;
      ctx.fillStyle = c.histFill || 'rgba(217,164,0,0.35)'; ctx.strokeStyle = c.axis || '#d9a400'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < hist.centers.length; i++) {
        const s0 = hist.centers[i] - bw / 2, s1 = hist.centers[i] + bw / 2, h = hist.counts[i] * hscale;
        const P = (s, q) => [f.X(s * ux - q * uy), f.Y(s * uy + q * ux)];
        const [x0, y0] = P(s0, 0), [x1, y1] = P(s0, h), [x2, y2] = P(s1, h), [x3, y3] = P(s1, 0);
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath();
      }
      ctx.fill(); ctx.stroke();
    }
  }
}
