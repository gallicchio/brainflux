// The plots of the NMR page: the detected signal against time (the mixer's two outputs and the
// detector's envelope), the coil's EMF as a scope shows it, the spectrum, and a curve of
// amplitudes with its fit.  Each takes a canvas context, its size, and plain data.

import { Frame, fillSlots, niceTicks } from '../lib/plot.js';
import { rawColumns } from './signal.js';

/** A time unit for a span of seconds: {s: scale, u: name}. */
export function timeUnit(span) {
  const a = Math.abs(span);
  if (a < 2e-6) return { s: 1e9, u: 'ns' };
  if (a < 2e-3) return { s: 1e6, u: 'μs' };
  if (a < 2) return { s: 1e3, u: 'ms' };
  return { s: 1, u: 's' };
}

/** A duration in words: "2.50 μs". */
export function duration(t, digits = 3) {
  if (!Number.isFinite(t)) return '∞';
  const { s, u } = timeUnit(t * 1.0001);
  return `${(+(t * s).toPrecision(digits)).toString()} ${u}`;
}

/** Shade the pulses sent (bands where B1 was on), labelled with their angle and phase. */
export function pulseBands(ctx, f, sent, c, labelAll = true, now = Infinity) {
  ctx.save();
  f.clip();
  ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  let lastX = -1e9;
  for (const p of sent) {
    if (p.t0 > now) continue;
    const x0 = f.X(p.t0), x1 = Math.max(x0 + 2, f.X(Math.min(p.t1, now)));
    if (x1 < f.left || x0 > f.right) continue;
    ctx.fillStyle = c.b1; ctx.globalAlpha = 0.22;
    ctx.fillRect(x0, f.top, x1 - x0, f.h);
    ctx.globalAlpha = 1;
    const xm = (x0 + x1) / 2;
    if (labelAll && xm - lastX > 34) { ctx.fillStyle = c.b1; ctx.fillText(pulseName(p.angle, p.phase), xm, f.top + 2); lastX = xm; }
  }
  ctx.restore();
}

/** "π/2 x′", "π y′", "37° −x′": a pulse's name. */
export function pulseName(angle, phase) {
  const a = Math.abs(angle - 90) < 1e-6 ? 'π/2' : Math.abs(angle - 180) < 1e-6 ? 'π' : Math.abs(angle - 270) < 1e-6 ? '3π/2' : Math.abs(angle - 360) < 1e-6 ? '2π' : `${Math.round(angle)}°`;
  const ph = ((phase % 360) + 360) % 360;
  const axis = Math.abs(ph) < 1e-6 ? 'x′' : Math.abs(ph - 90) < 1e-6 ? 'y′' : Math.abs(ph - 180) < 1e-6 ? '−x′' : Math.abs(ph - 270) < 1e-6 ? '−y′' : `${Math.round(ph)}°`;
  return `${a} ${axis}`;
}

/**
 * Per pixel column, the lowest and highest of get(i) over the record's samples in it, or the
 * record interpolated at the column's middle where a column holds fewer than two samples.
 * Returns {lo, hi, has} (has: the column holds a sample or lies between two).
 */
function columnsOf(record, get, t0, t1, cols, interp) {
  const lo = new Float32Array(cols), hi = new Float32Array(cols), has = new Uint8Array(cols);
  const T = record.t, n = T.length;
  if (!n) return { lo, hi, has };
  const w = (t1 - t0) / cols;
  for (let c = 0; c < cols; c++) {
    const ta = t0 + c * w, tb = ta + w;
    if (tb < T[0] || ta > T[n - 1]) continue;
    let i = Math.max(0, record.index(ta)), a = Infinity, b = -Infinity, k = 0;
    if (T[i] < ta) i++;
    for (; i < n && T[i] <= tb; i++) { const v = get(i); if (v < a) a = v; if (v > b) b = v; k++; }
    if (k < 2) { const v = interp(Math.min(T[n - 1], Math.max(T[0], (ta + tb) / 2))); if (k === 0) a = b = v; else { a = Math.min(a, v); b = Math.max(b, v); } }
    lo[c] = a; hi[c] = b; has[c] = 1;
  }
  return { lo, hi, has };
}

/** Draw a trace given per-column ranges: a line through the middles, filled where it spreads. */
function drawColumns(ctx, f, cols, colsData, Y, color, width, fill = true) {
  const { lo, hi, has } = colsData;
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width;
  ctx.beginPath();
  let on = false;
  for (let c = 0; c < cols; c++) {
    if (!has[c]) { on = false; continue; }
    const x = f.left + ((c + 0.5) * f.w) / cols, y = Y((lo[c] + hi[c]) / 2);
    if (on) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    on = true;
  }
  ctx.stroke();
  if (fill) {
    ctx.globalAlpha = 0.55;
    for (let c = 0; c < cols; c++) {
      if (!has[c]) continue;
      const y0 = Y(hi[c]), y1 = Y(lo[c]);
      if (y1 - y0 > width) ctx.fillRect(f.left + (c * f.w) / cols, y0, Math.max(1, f.w / cols), y1 - y0);
    }
  }
  ctx.restore();
}

/**
 * The detected signal against time: the mixer's outputs M_x′ and M_y′, the envelope |M_xy|, and
 * (faint) M_z, which the coil does not see.  opts: {record, t0, t1, ymax, sigma, scale (units per
 * M0), unit, colors, sent, show: {mx, my, mxy, mz}, now, title, echoes: [t...], fit: {t0, A, tau}}.
 */
export function drawSignal(ctx, width, height, o) {
  const c = o.colors, f = new Frame(ctx, width, height, { left: 48, right: 12, top: 22, bottom: 34 });
  const tu = timeUnit(o.t1 - o.t0), R = o.record, sg = o.sigma || 0, k = o.scale || 1;
  f.x0 = o.t0; f.x1 = o.t1; f.y0 = -o.ymax; f.y1 = o.ymax;
  pulseBands(ctx, f, o.sent || [], c, true, o.now ?? Infinity);
  ctx.save(); f.clip();
  ctx.strokeStyle = c.line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(f.left, f.Y(0)); ctx.lineTo(f.right, f.Y(0)); ctx.stroke();
  const cols = Math.max(20, Math.round(f.w));
  const tmp = [0, 0, 0];
  const at = (t) => R.at(t, sg, tmp);
  const sh = o.show || { mx: true, my: true, mxy: true, mz: true };
  if (sh.mz) drawColumns(ctx, f, cols, columnsOf(R, (i) => k * R.z[i], o.t0, o.t1, cols, (t) => k * at(t)[2]), (v) => f.Y(v), c.mz, 1.2, false);
  // The envelope first and thick, so that a mixer's output lying on it shows on top of it.
  if (sh.mxy) drawColumns(ctx, f, cols, columnsOf(R, (i) => k * Math.hypot(R.x[i] + sg * R.nx[i], R.y[i] + sg * R.ny[i]), o.t0, o.t1, cols, (t) => { const m = at(t); return k * Math.hypot(m[0], m[1]); }), (v) => f.Y(v), c.mxy, 3.2);
  if (sh.mx) drawColumns(ctx, f, cols, columnsOf(R, (i) => k * (R.x[i] + sg * R.nx[i]), o.t0, o.t1, cols, (t) => k * at(t)[0]), (v) => f.Y(v), c.mx, 1.5);
  if (sh.my) drawColumns(ctx, f, cols, columnsOf(R, (i) => k * (R.y[i] + sg * R.ny[i]), o.t0, o.t1, cols, (t) => k * at(t)[1]), (v) => f.Y(v), c.my, 1.5);
  if (o.fit && o.fit.A) {
    ctx.strokeStyle = c.fit; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    ctx.beginPath();
    for (let px = 0; px <= f.w; px += 3) { const t = f.invX(f.left + px); if (t < o.fit.t0) continue; const y = f.Y(k * o.fit.A * Math.exp(-(t - o.fit.t0) / o.fit.tau)); if (px === 0 || t - 3 * (o.t1 - o.t0) / f.w < o.fit.t0) ctx.moveTo(f.left + px, y); else ctx.lineTo(f.left + px, y); }
    ctx.stroke(); ctx.setLineDash([]);
  }
  for (const te of o.echoes || []) {
    if (te < o.t0 || te > o.t1) continue;
    ctx.strokeStyle = c.ink3; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(f.X(te), f.top); ctx.lineTo(f.X(te), f.bottom); ctx.stroke(); ctx.setLineDash([]);
  }
  if (o.now !== undefined && o.now >= o.t0 && o.now <= o.t1) {
    ctx.strokeStyle = c.ink3; ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.moveTo(f.X(o.now), f.top); ctx.lineTo(f.X(o.now), f.bottom); ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.restore();
  ctx.save();
  // Ticks in the time unit: the frame's own ticks would be in seconds.
  const g = new Frame(ctx, width, height, { left: 48, right: 12, top: 22, bottom: 34 });
  g.x0 = o.t0 * tu.s; g.x1 = o.t1 * tu.s; g.y0 = f.y0; g.y1 = f.y1;
  g.axes({ xlabel: `time (${tu.u})`, colors: c });
  ctx.restore();
  legend(ctx, f.left + 6, 4, [
    ...(o.title ? [{ text: o.title, color: c.ink, bold: true }] : []),
    ...(sh.mx ? [{ text: 'Mx′', color: c.mx }] : []), ...(sh.my ? [{ text: 'My′', color: c.my }] : []),
    ...(sh.mxy ? [{ text: '|Mxy| (the envelope)', color: c.mxy }] : []), ...(sh.mz ? [{ text: 'Mz (not seen by the coil)', color: c.mz }] : []),
    ...(o.fit && o.fit.label ? [{ text: o.fit.label, color: c.fit }] : []),
  ], c, width - f.left - 12);
  return f;
}

/** The coil's EMF as a scope on it shows it: the oscillation at the Larmor frequency (or its
 *  envelope where the plot holds too many periods to draw).  opts: {record, omegaRef, t0, t1,
 *  ymax, sigma, scale, unit, colors, sent, title, zoomNote}. */
export function drawRaw(ctx, width, height, o) {
  const c = o.colors, f = new Frame(ctx, width, height, { left: 48, right: 12, top: 22, bottom: 34 });
  const tu = timeUnit(o.t1 - o.t0), k = o.scale || 1;
  f.x0 = o.t0; f.x1 = o.t1; f.y0 = -o.ymax; f.y1 = o.ymax;
  pulseBands(ctx, f, o.sent || [], c, false, o.now ?? Infinity);
  ctx.save(); f.clip();
  ctx.strokeStyle = c.line;
  ctx.beginPath(); ctx.moveTo(f.left, f.Y(0)); ctx.lineTo(f.right, f.Y(0)); ctx.stroke();
  const R = o.record;
  let envelope = false;
  if (R.length) {
    const ta = Math.max(o.t0, R.t[0]), tb = Math.min(o.t1, R.t[R.length - 1]);
    if (tb > ta) {
      const cols = Math.max(10, Math.round((f.w * (tb - ta)) / (o.t1 - o.t0)));
      const r = rawColumns(R, o.omegaRef, ta, tb, cols, o.sigma || 0, 6);
      envelope = r.envelope;
      const x0 = f.X(ta), w = f.X(tb) - x0;
      ctx.strokeStyle = c.raw; ctx.fillStyle = c.raw; ctx.lineWidth = 1.3;
      if (r.envelope) {
        ctx.globalAlpha = 0.75;
        for (let i = 0; i < cols; i++) { const y0 = f.Y(k * r.hi[i]), y1 = f.Y(k * r.lo[i]); ctx.fillRect(x0 + (i * w) / cols, y0, Math.max(1, w / cols + 0.5), Math.max(1, y1 - y0)); }
        ctx.globalAlpha = 1;
      } else {
        ctx.beginPath();
        for (let i = 0; i < cols; i++) {
          const x = x0 + ((i + 0.5) * w) / cols;
          // Within a column the trace runs from one end of its range to the other.
          const a = f.Y(k * r.lo[i]), b = f.Y(k * r.hi[i]);
          if (i === 0) ctx.moveTo(x, (a + b) / 2);
          if (Math.abs(a - b) > 1.5) { ctx.lineTo(x, a); ctx.lineTo(x, b); } else ctx.lineTo(x, (a + b) / 2);
        }
        ctx.stroke();
      }
    }
  }
  ctx.restore();
  ctx.save();
  const g = new Frame(ctx, width, height, { left: 48, right: 12, top: 22, bottom: 34 });
  g.x0 = o.t0 * tu.s; g.x1 = o.t1 * tu.s; g.y0 = f.y0; g.y1 = f.y1;
  g.axes({ xlabel: `time (${tu.u})`, colors: c });
  ctx.restore();
  legend(ctx, f.left + 6, 4, [{ text: o.title, color: c.ink, bold: true }, { text: envelope ? (o.zoomNote || 'too many cycles to draw: the band is the oscillation') : '', color: c.ink3 }], c, width - f.left - 12);
  return { frame: f, envelope };
}

/** A trace given as evenly spaced samples (OUT at an audio rate), as a scope draws it: per pixel
 *  column the samples' range.  opts: {t0, t1, y (Float32Array over [t0, t1]), ymax, colors,
 *  title, note}. */
export function drawTrace(ctx, width, height, o) {
  const c = o.colors, f = new Frame(ctx, width, height, { left: 48, right: 12, top: 22, bottom: 34 });
  const tu = timeUnit(o.t1 - o.t0), y = o.y, n = y.length;
  f.x0 = o.t0; f.x1 = o.t1; f.y0 = -o.ymax; f.y1 = o.ymax;
  ctx.save(); f.clip();
  ctx.strokeStyle = c.line;
  ctx.beginPath(); ctx.moveTo(f.left, f.Y(0)); ctx.lineTo(f.right, f.Y(0)); ctx.stroke();
  if (n > 1) {
    const cols = Math.max(10, Math.round(f.w));
    ctx.strokeStyle = c.raw; ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let i = 0; i < cols; i++) {
      const a0 = Math.floor((i * (n - 1)) / cols), a1 = Math.max(a0, Math.floor(((i + 1) * (n - 1)) / cols));
      let lo = Infinity, hi = -Infinity;
      for (let j = a0; j <= a1; j++) { if (y[j] < lo) lo = y[j]; if (y[j] > hi) hi = y[j]; }
      const x = f.left + ((i + 0.5) * f.w) / cols, ya = f.Y(lo), yb = f.Y(hi);
      if (i === 0) ctx.moveTo(x, (ya + yb) / 2);
      if (Math.abs(ya - yb) > 1.5) { ctx.lineTo(x, ya); ctx.lineTo(x, yb); } else ctx.lineTo(x, (ya + yb) / 2);
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.save();
  const g = new Frame(ctx, width, height, { left: 48, right: 12, top: 22, bottom: 34 });
  g.x0 = o.t0 * tu.s; g.x1 = o.t1 * tu.s; g.y0 = f.y0; g.y1 = f.y1;
  g.axes({ xlabel: `time (${tu.u})`, colors: c });
  ctx.restore();
  legend(ctx, f.left + 6, 4, [{ text: o.title, color: c.ink, bold: true }, ...(o.note ? [{ parts: o.note, color: c.ink3 }] : [])], c, width - f.left - 12);
  return f;
}

/**
 * The tank's response against frequency, as a Bode plot: the gain |H| (the tank's voltage per
 * volt of EMF) above, which read on the right axis is also the coil's thermal noise through the
 * tank (nV/√Hz), with the preamplifier's flat noise dashed across it; the phase below; the
 * protons' frequency as a line through both, with a dot where it meets each curve.
 * opts: {f0, f1 (Hz), fT, fL, Q, mag(f), phase(f) (radians), noiseK (V/√Hz per unit of |H|),
 * floor (V/√Hz), ymax, width (Hz, the half-power width), colors, title, off (a note when fT
 * is off the plot)}.  Returns the gain's Frame (its X maps frequency).
 */
export function drawTank(ctx, width, height, o) {
  const c = o.colors, L = 48, Rm = 44, top = 22, bottom = 34, gap = 14;
  const inner = height - top - bottom - gap, hMag = Math.round(inner * 0.66);
  const fm = new Frame(ctx, width, height, { left: L, right: Rm, top, bottom: height - top - hMag });
  const fp = new Frame(ctx, width, height, { left: L, right: Rm, top: top + hMag + gap, bottom });
  fm.x0 = fp.x0 = o.f0; fm.x1 = fp.x1 = o.f1;
  fm.y0 = 0; fm.y1 = o.ymax; fp.y0 = -180; fp.y1 = 0;
  const cols = Math.max(20, Math.round(fm.w)), DEGS = 180 / Math.PI;
  const xs = Array.from({ length: cols + 1 }, (_, i) => o.f0 + ((o.f1 - o.f0) * i) / cols);
  // The gain, and the preamplifier's noise on the same scale (which happens to lie close to the
  // half-power level, Q/√2).
  ctx.save(); fm.clip();
  const yFloor = fm.Y(o.floor / o.noiseK);
  ctx.strokeStyle = c.ink3; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(fm.left, yFloor); ctx.lineTo(fm.right, yFloor); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = c.ink3; ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'bottom';
  // (Its label on the side away from the peak.)
  const peakRight = o.fT > (o.f0 + o.f1) / 2 && o.fT < o.f1;
  ctx.textAlign = peakRight ? 'left' : 'right';
  ctx.fillText('the preamplifier\'s noise', peakRight ? fm.left + 4 : fm.right - 4, yFloor - 2);
  ctx.strokeStyle = c.coil; ctx.lineWidth = 2.2;
  ctx.beginPath();
  xs.forEach((fx, i) => { const y = fm.Y(o.mag(fx)); if (i) ctx.lineTo(fm.X(fx), y); else ctx.moveTo(fm.X(fx), y); });
  ctx.stroke();
  ctx.restore();
  // The phase.
  ctx.save(); fp.clip();
  ctx.strokeStyle = c.line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(fp.left, fp.Y(-90)); ctx.lineTo(fp.right, fp.Y(-90)); ctx.stroke();
  ctx.strokeStyle = c.coil; ctx.lineWidth = 1.6;
  ctx.beginPath();
  xs.forEach((fx, i) => { const y = fp.Y(o.phase(fx) * DEGS); if (i) ctx.lineTo(fp.X(fx), y); else ctx.moveTo(fp.X(fx), y); });
  ctx.stroke();
  ctx.restore();
  // The protons' frequency through both, and where it meets each curve; its labels on the side
  // away from the tank's peak (where they fit), the peak's on the other.
  const inL = o.fL > o.f0 && o.fL < o.f1, inT = o.fT > o.f0 && o.fT < o.f1;
  const xL = fm.X(o.fL), xT = fm.X(o.fT);
  // (The labels away from the peak where they fit; the line's name is in the legend.)
  let right = !(inT && o.fT > o.fL);
  if (right && xL + 50 > fm.right) right = false;
  else if (!right && xL - 50 < fm.left) right = true;
  if (inL) {
    ctx.save();
    ctx.strokeStyle = c.m; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(xL, fm.top); ctx.lineTo(xL, fm.bottom); ctx.moveTo(xL, fp.top); ctx.lineTo(xL, fp.bottom); ctx.stroke();
    const g = o.mag(o.fL), p = Math.round(o.phase(o.fL) * DEGS) || 0;
    ctx.fillStyle = c.m;
    for (const [px, py] of [[xL, fm.Y(g)], [xL, fp.Y(p)]]) { ctx.beginPath(); ctx.arc(px, py, 4, 0, 2 * Math.PI); ctx.fill(); }
    ctx.font = '600 12px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    ctx.textAlign = right ? 'left' : 'right';
    const lx = xL + (right ? 7 : -7);
    ctx.fillText(`×${g.toFixed(g < 9.95 ? 2 : 1)}`, lx, Math.max(fm.top + 22, Math.min(fm.bottom - 8, fm.Y(g))));
    ctx.fillText(`${p}°`, lx, Math.max(fp.top + 8, Math.min(fp.bottom - 8, fp.Y(p))));
    ctx.restore();
  }
  if (inT) {
    ctx.save();
    ctx.fillStyle = c.coil; ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    const label = `f_T ${o.fT.toFixed(1)} Hz`, w = ctx.measureText(label).width;
    // Above the peak where there is room and the protons' line is clear of it; else beside the
    // peak, on the side away from that line (or where it fits).
    const yP = fm.Y(o.mag(o.fT)), above = yP - 20 > fm.top && !(inL && Math.abs(xL - xT) < w / 2 + 8);
    if (above) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(label, Math.max(fm.left + w / 2 + 2, Math.min(fm.right - w / 2 - 2, xT)), yP - 5);
    } else {
      let side = inL && Math.abs(xL - xT) < w + 60 ? (o.fT > o.fL ? 1 : -1) : (xT + 6 + w < fm.right ? 1 : -1);
      if (side > 0 && xT + 6 + w > fm.right) side = -1;
      if (side < 0 && xT - 6 - w < fm.left) side = 1;
      ctx.textAlign = side > 0 ? 'left' : 'right';
      ctx.fillText(label, xT + 6 * side, Math.max(fm.top + 8, yP + 2));
    }
    ctx.restore();
  } else if (o.off) {
    ctx.save();
    ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = Math.min(fm.w - 8, ctx.measureText(o.off).width + 10), y = fm.top + fm.h * 0.7;
    ctx.fillStyle = c.panel; ctx.globalAlpha = 0.9; ctx.fillRect(fm.left + fm.w / 2 - tw / 2, y - 9, tw, 18); ctx.globalAlpha = 1;
    ctx.fillStyle = c.coil;
    ctx.fillText(o.off, fm.left + fm.w / 2, y, fm.w - 10);
    ctx.restore();
  }
  ctx.save();
  fm.axes({ colors: c, xTicks: false, ylabel: 'gain |H|' });
  fm.rightAxis(0, o.ymax * o.noiseK * 1e9, 'noise, nV/√Hz', c);
  fp.axes({ xlabel: 'frequency (Hz)', colors: c, yTicks: false, ylabel: 'phase' });
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = c.ink2; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const v of [0, -90, -180]) ctx.fillText(`${v}°`, fp.left - 6, fp.Y(v));
  ctx.restore();
  legend(ctx, fm.left + 6, 4, [{ text: o.title || 'The tank', color: c.ink, bold: true }, ...(o.width ? [{ text: `${o.width.toFixed(1)} Hz wide`, color: c.coil }] : []), { text: `the protons, ${o.fL.toFixed(1)} Hz`, color: c.m }], c, width - fm.left - 12);
  return fm;
}

/** A power spectrum: {f, power} with the line's half-power width marked.  opts: {spec, f0,
 *  fmin, fmax, unit {s, u}, colors, title, mark} (f in Hz relative to the reference; f0 added to
 *  label absolute frequencies when given). */
export function drawSpectrum(ctx, width, height, o) {
  const c = o.colors, f = new Frame(ctx, width, height, { left: 48, right: 12, top: 22, bottom: 34 });
  const S = o.spec, u = o.unit || { s: 1, u: 'Hz' };
  f.x0 = o.fmin; f.x1 = o.fmax;
  let top = 0;
  if (S) for (let i = 0; i < S.f.length; i++) if (S.f[i] >= o.fmin && S.f[i] <= o.fmax) top = Math.max(top, S.power[i]);
  f.y0 = 0; f.y1 = Math.max(top * 1.15, 1e-12);
  ctx.save(); f.clip();
  if (S) {
    ctx.strokeStyle = c.spec; ctx.fillStyle = c.spec; ctx.lineWidth = 1.6;
    ctx.beginPath();
    let first = true;
    const step = Math.max(1, Math.floor((S.f.length * (o.fmax - o.fmin)) / ((S.f[S.f.length - 1] - S.f[0]) * f.w * 2)));
    for (let i = 0; i < S.f.length; i += step) {
      if (S.f[i] < o.fmin - (o.fmax - o.fmin) * 0.01 || S.f[i] > o.fmax + (o.fmax - o.fmin) * 0.01) continue;
      let p = S.power[i];
      for (let j = 1; j < step && i + j < S.f.length; j++) p = Math.max(p, S.power[i + j]);
      const x = f.X(S.f[i]), y = f.Y(p);
      if (first) { ctx.moveTo(x, f.Y(0)); ctx.lineTo(x, y); first = false; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    if (o.mark && S.peak && S.fwhm > 0) {
      const y = f.Y(S.peak.power / 2), xa = f.X(S.peak.f - S.fwhm / 2), xb = f.X(S.peak.f + S.fwhm / 2);
      ctx.strokeStyle = c.fit; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(xa, y); ctx.lineTo(xb, y); ctx.moveTo(xa, y - 4); ctx.lineTo(xa, y + 4); ctx.moveTo(xb, y - 4); ctx.lineTo(xb, y + 4); ctx.stroke();
    }
  }
  ctx.restore();
  ctx.save();
  const g = new Frame(ctx, width, height, { left: 48, right: 12, top: 22, bottom: 34 });
  g.x0 = (o.fmin + (o.f0 || 0)) * u.s; g.x1 = (o.fmax + (o.f0 || 0)) * u.s; g.y0 = 0; g.y1 = 1;
  if (!o.f0) g.axes({ xlabel: o.xlabel || `frequency (${u.u})`, colors: c, yTicks: false });
  else {
    // Absolute frequencies a few hertz apart need the decimals their step has (1959.5, 1960):
    // the ticks drawn here, as the frame's would round them to four figures.
    g.axes({ xlabel: o.xlabel || `frequency (${u.u})`, colors: c, yTicks: false, xTicks: false });
    const ticks = niceTicks(g.x0, g.x1, Math.max(2, Math.round(g.w / 80))), step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
    const dec = Math.max(0, Math.min(4, Math.ceil(-Math.log10(step) - 1e-9)));
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = c.ink2; ctx.strokeStyle = c.ink3; ctx.lineWidth = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const v of ticks) {
      const px = Math.round(g.X(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(px, g.bottom); ctx.lineTo(px, g.bottom + 4); ctx.stroke();
      ctx.fillText(v.toFixed(dec), px, g.bottom + 6);
    }
  }
  ctx.restore();
  legend(ctx, f.left + 6, 4, [{ text: o.title, color: c.ink, bold: true }, ...(o.note ? [{ parts: o.note, color: c.fit }] : [])], c, width - f.left - 12);
  return f;
}

/** Points (x, y) with a fitted curve fit(x) and marks: the plot of amplitudes against a delay.
 *  opts: {x, y, fit, xmax, ymin, ymax, colors, title, xlabel, xunit {s, u}, current, marks: [{x, label}], note}. */
export function drawCurve(ctx, width, height, o) {
  const c = o.colors, f = new Frame(ctx, width, height, { left: 48, right: 12, top: 22, bottom: 34 });
  const u = o.xunit || { s: 1, u: 's' };
  f.x0 = 0; f.x1 = o.xmax; f.y0 = o.ymin; f.y1 = o.ymax;
  ctx.save(); f.clip();
  ctx.strokeStyle = c.line;
  ctx.beginPath(); ctx.moveTo(f.left, f.Y(0)); ctx.lineTo(f.right, f.Y(0)); ctx.stroke();
  if (o.fit) {
    ctx.strokeStyle = c.fit; ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let px = 0; px <= f.w; px += 2) { const x = f.invX(f.left + px), y = f.Y(o.fit(x)); if (px) ctx.lineTo(f.left + px, y); else ctx.moveTo(f.left, y); }
    ctx.stroke();
  }
  for (const m of o.marks || []) {
    ctx.strokeStyle = c.ink3; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(f.X(m.x), f.top); ctx.lineTo(f.X(m.x), f.bottom); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = c.ink2; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(m.label, f.X(m.x) + 3, f.bottom - 3);
  }
  ctx.fillStyle = c.points;
  (o.x || []).forEach((x, i) => { ctx.beginPath(); ctx.arc(f.X(x), f.Y(o.y[i]), 3.5, 0, 2 * Math.PI); ctx.fill(); });
  if (o.current !== undefined) {
    ctx.strokeStyle = c.b1; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(f.X(o.current), f.top); ctx.lineTo(f.X(o.current), f.bottom); ctx.stroke();
  }
  ctx.restore();
  ctx.save();
  const g = new Frame(ctx, width, height, { left: 48, right: 12, top: 22, bottom: 34 });
  g.x0 = 0; g.x1 = o.xmax * u.s; g.y0 = o.ymin; g.y1 = o.ymax;
  g.axes({ xlabel: o.xlabel, colors: c });
  ctx.restore();
  legend(ctx, f.left + 6, 4, [{ text: o.title, color: c.ink, bold: true }, ...(o.note ? [{ parts: o.note, color: c.fit }] : [])], c, width - f.left - 12);
  return f;
}

/** A tick's label on a log time axis: 0.1 ms, 1 ms, 10 ms, 100 ms, 1 s… (unit: its decade's). */
function logTimeLabel(t, withUnit) {
  const u = t < 0.99e-4 ? { s: 1e6, u: 'μs' } : t < 0.99 ? { s: 1e3, u: 'ms' } : { s: 1, u: 's' };
  const v = +(t * u.s).toPrecision(3);
  return withUnit ? `${v} ${u.u}` : String(v);
}

/** "e" with a superscript (or "1 − e" and one), at (x, y) on its baseline; align 'left' or
 *  'right'.  Returns its width. */
function expText(ctx, pre, sup, x, y, align = 'left') {
  ctx.save();
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.font = '13px system-ui, sans-serif';
  const w1 = ctx.measureText(pre).width;
  ctx.font = '10px system-ui, sans-serif';
  const w2 = ctx.measureText(sup).width, x0 = align === 'right' ? x - w1 - w2 - 1 : x;
  ctx.fillText(sup, x0 + w1 + 1, y - 6);
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillText(pre, x0, y);
  ctx.restore();
  return w1 + w2 + 1;
}

/** Legend items {text, color, kind: 'line' | 'dash' | 'dot'} as a swatch and words in ink, wrapped
 *  into rows of maxWidth from (x, y).  Returns the number of rows (draw: false only measures). */
function legendRows(ctx, x, y, items, c, maxWidth, draw = true) {
  ctx.save();
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  let px = x, row = 0;
  for (const it of items) {
    ctx.font = `${it.bold ? '600 ' : ''}12px system-ui, sans-serif`;
    const sw = it.color ? 20 : 0, w = sw + ctx.measureText(it.text).width;
    if (px > x && px + w > x + maxWidth) { px = x; row++; }
    if (draw) {
      const yy = y + 16 * row;
      if (it.color) {
        ctx.strokeStyle = it.color; ctx.fillStyle = it.color; ctx.lineWidth = 2;
        if (it.kind === 'dot') { ctx.beginPath(); ctx.arc(px + 7, yy + 7, 3.5, 0, 2 * Math.PI); ctx.fill(); }
        else {
          if (it.kind === 'dash') { ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5; }
          ctx.beginPath(); ctx.moveTo(px, yy + 7); ctx.lineTo(px + 15, yy + 7); ctx.stroke(); ctx.setLineDash([]);
        }
      }
      ctx.fillStyle = it.bold ? c.ink : c.ink2;
      ctx.fillText(it.text, px + sw, yy);
    }
    px += w + 14;
  }
  ctx.restore();
  return row + 1;
}

/**
 * The three clocks after one π/2 pulse, against the time since it on a log axis: what the coil
 * sees, the length of the sum's part across the field |ΣM⊥|/N; each spin's own part, the mean of
 * |M⊥ᵢ|; and M_z.  Under each, faint and dashed, its exponential for the times set, labelled; the
 * times themselves as lines, named in a strip on top, where a bar from T₂* to 2T₁ holds T₂'s
 * mark (the rule T₂* ≤ T₂ ≤ 2T₁); a CPMG run's echoes, with a dot on each one's top; a dot where
 * each fit puts its curve's 1/e.  Everything with time is drawn only up to `now`.
 * opts: {t0, t1 (the axis, s), now, trace: {t, sig, perp, mz}, set: {T2s, T2, T1} (Infinity
 * when off), fits: {T2s, T2, T1: {A, tau} or null}, echo: {t, y, from, peaks: {t, amp}} or null,
 * pulses: [{t0, t1, angle, phase}] (sent after the first), colors, short (shorter words)}.
 * Returns the frame (its x is log10 of the time).
 */
export function drawClocks(ctx, width, height, o) {
  const c = o.colors, S = o.set, short = !!o.short;
  // The legend's rows decide where the strip and the plot begin.
  const items = [
    { text: 'After one π/2 pulse:', bold: true },
    { text: short ? 'the sum |ΣM⊥|/N (the coil)' : 'what the coil sees, the sum |ΣM⊥|/N', color: c.mxy },
    { text: short ? 'each spin\'s own |M⊥ᵢ|' : 'each spin\'s own part across B₀, the mean |M⊥ᵢ|', color: c.perp },
    { text: 'Mz', color: c.mz },
    ...(o.echo ? [{ text: short ? 'echoes (CPMG)' : 'another run\'s echoes (CPMG)', color: c.b1, kind: 'dot' }] : []),
    { text: 'for the times set', color: c.ink3, kind: 'dash' },
  ];
  const L = 44, Rm = 14, rows = legendRows(ctx, 6, 4, items, c, width - 12, false), strip = 30;
  const top = 6 + 16 * rows + strip;
  const f = new Frame(ctx, width, height, { left: L, right: Rm, top, bottom: 36 });
  const lg = (t) => Math.log10(t);
  f.x0 = lg(o.t0); f.x1 = lg(o.t1); f.y0 = 0; f.y1 = 1.05;
  const X = (t) => f.X(lg(t)), inX = (t) => t >= o.t0 && t <= o.t1;
  const E1 = Math.exp(-1);
  const now = o.now ?? Infinity;

  ctx.save(); f.clip();
  // 1/e and 1 − 1/e, the levels the times are read at.
  ctx.strokeStyle = c.ink3; ctx.lineWidth = 1; ctx.setLineDash([2, 4]); ctx.globalAlpha = 0.7;
  for (const v of [E1, 1 - E1]) { ctx.beginPath(); ctx.moveTo(f.left, f.Y(v)); ctx.lineTo(f.right, f.Y(v)); ctx.stroke(); }
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = c.ink3; ctx.textBaseline = 'bottom';
  ctx.textAlign = 'right'; ctx.fillText('1/e', f.right - 4, f.Y(E1) - 2);
  ctx.textAlign = 'left'; ctx.fillText('1 − 1/e', f.left + 4, f.Y(1 - E1) - 2);
  // The times set, as lines up into the strip.
  const lines = [[S.T2s, c.mxy], [S.T2, c.perp], [S.T1, c.mz], [2 * S.T1, c.ink3]];
  ctx.restore();
  ctx.save();
  ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
  for (const [t, col] of lines) {
    if (!Number.isFinite(t) || !inX(t)) continue;
    ctx.strokeStyle = col; ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.moveTo(Math.round(X(t)) + 0.5, f.top - strip + 15); ctx.lineTo(Math.round(X(t)) + 0.5, f.bottom); ctx.stroke();
  }
  ctx.restore();
  ctx.save(); f.clip();
  // Pulses sent by hand during the run.
  for (const p of o.pulses || []) {
    if (!(p.t0 > 0) || p.t0 > now) continue;
    const x0 = X(p.t0), x1 = Math.max(x0 + 2, X(Math.min(p.t1, now)));
    ctx.fillStyle = c.b1; ctx.globalAlpha = 0.25; ctx.fillRect(x0, f.top, x1 - x0, f.h); ctx.globalAlpha = 1;
    ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(pulseName(p.angle, p.phase), x1 + 3, f.top + 2);
  }
  // The exponentials for the times set, faint.
  const curve = (fn, col) => {
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.globalAlpha = 0.65;
    ctx.beginPath();
    for (let px = 0; px <= f.w; px += 2) { const t = 10 ** f.invX(f.left + px), y = f.Y(fn(t)); if (px) ctx.lineTo(f.left + px, y); else ctx.moveTo(f.left, y); }
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  };
  const ex = (T) => (t) => (Number.isFinite(T) ? Math.exp(-t / T) : 1);
  curve((t) => 1 - ex(S.T1)(t), c.mz);
  curve(ex(S.T2), c.perp);
  curve(ex(S.T2s), c.mxy);
  // The CPMG run's echoes so far.
  if (o.echo && o.echo.t.length) {
    const { t, y } = o.echo;
    ctx.strokeStyle = c.b1; ctx.lineWidth = 1.3; ctx.globalAlpha = 0.85;
    ctx.beginPath();
    let on = false;
    for (let i = 0; i < t.length && t[i] <= now; i++) {
      if (t[i] < o.echo.from || t[i] < o.t0 / 2) continue;
      const px = X(t[i]), py = f.Y(y[i]);
      if (on) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      on = true;
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  // The three curves as they come.
  const T = o.trace;
  const trace = (ys, col) => {
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
    let on = false;
    for (let i = 0; i < T.t.length; i++) {
      if (T.t[i] < o.t0 * 0.9) continue;
      const px = X(T.t[i]), py = f.Y(ys[i]);
      if (on) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      on = true;
    }
    ctx.stroke();
  };
  if (T && T.t.length) { trace(T.mz, c.mz); trace(T.perp, c.perp); trace(T.sig, c.mxy); }
  const dot = (x, y, col, r = 4.5) => {
    ctx.fillStyle = c.panel; ctx.beginPath(); ctx.arc(x, y, r + 2, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
  };
  if (o.echo && o.echo.peaks) o.echo.peaks.t.forEach((t, i) => { if (t <= now) dot(X(t), f.Y(o.echo.peaks.amp[i]), c.b1, 3.5); });
  // Where each fit puts its curve's 1/e.
  const F = o.fits || {};
  if (F.T2s) dot(X(F.T2s.tau), f.Y(F.T2s.A * E1), c.mxy);
  if (F.T2) dot(X(F.T2.tau), f.Y(F.T2.A * E1), c.perp);
  if (F.T1) dot(X(F.T1.tau), f.Y(1 - F.T1.A * E1), c.mz);
  // The exponentials' names beside their 1/e points, where the other curves are not.
  ctx.fillStyle = c.ink2;
  if (Number.isFinite(S.T2s) && inX(S.T2s)) expText(ctx, 'e', '−t/T₂*', X(S.T2s) + 9, f.Y(E1) - 5);
  if (Number.isFinite(S.T2) && inX(S.T2)) expText(ctx, 'e', '−t/T₂', X(S.T2) + 9, f.Y(E1) - 5);
  if (Number.isFinite(S.T1) && inX(S.T1)) expText(ctx, '1 − e', '−t/T₁', X(S.T1) - 9, f.Y(1 - E1) - 5, 'right');
  // The clock now.
  if (now >= o.t0 && now <= o.t1) {
    ctx.strokeStyle = c.ink3; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(now), f.top); ctx.lineTo(X(now), f.bottom); ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.restore();

  // The axes: y as usual, x by decades with the steps between.
  f.axes({ colors: c, xTicks: false, xlabel: 'time after the π/2 pulse (log scale)' });
  ctx.save();
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = c.ink2; ctx.strokeStyle = c.ink3; ctx.lineWidth = 1;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const perDecade = f.w / (f.x1 - f.x0);
  let lastRight = -Infinity;
  for (let k = Math.floor(f.x0) - 1; k <= Math.ceil(f.x1); k++) {
    for (let m = 1; m <= 9; m++) {
      const t = m * 10 ** k;
      if (t < o.t0 * 0.999 || t > o.t1 * 1.001) continue;
      const px = Math.round(X(t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(px, f.bottom); ctx.lineTo(px, f.bottom + (m === 1 ? 5 : 3)); ctx.stroke();
      const label = m === 1 ? logTimeLabel(t, true) : (m === 2 || m === 5) && perDecade > 170 ? logTimeLabel(t, false) : null;
      if (!label) continue;
      const w = ctx.measureText(label).width;
      if (px - w / 2 < lastRight + 6 || px + w / 2 > f.right + Rm) continue;
      ctx.fillText(label, px, f.bottom + 6);
      lastRight = px + w / 2;
    }
  }
  ctx.restore();

  // The strip: the times' names over their lines, and the bar T₂* … 2T₁ with T₂'s mark in it.
  ctx.save();
  const sy = f.top - strip;
  ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = c.ink;
  const names = [[S.T2s, 'T₂*'], [S.T2, 'T₂'], [S.T1, 'T₁'], [2 * S.T1, '2T₁']];
  let last = -Infinity;
  for (const [t, name] of names) {
    if (!Number.isFinite(t) || !inX(t)) continue;
    const x = X(t), w = ctx.measureText(name).width, xc = Math.max(x, last + w / 2 + 4);
    ctx.fillStyle = name === '2T₁' ? c.ink2 : c.ink;
    ctx.fillText(name, Math.min(f.right + Rm - w / 2 - 1, xc), sy);
    last = xc + w / 2;
  }
  const a = Number.isFinite(S.T2s) ? X(Math.max(o.t0, S.T2s)) : f.left, b = Number.isFinite(S.T1) ? X(Math.min(o.t1, 2 * S.T1)) : f.right;
  const by = sy + 21;
  ctx.strokeStyle = c.perp; ctx.globalAlpha = 0.35; ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(a, by); ctx.lineTo(b, by); ctx.stroke(); ctx.globalAlpha = 1; ctx.lineCap = 'butt';
  if (Number.isFinite(S.T2) && inX(S.T2)) dot(X(S.T2), by, c.perp, 4);
  ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = c.ink2; ctx.textBaseline = 'middle';
  const rule = 'T₂* ≤ T₂ ≤ 2T₁', rw = ctx.measureText(rule).width;
  if (a - 10 - rw > 4) { ctx.textAlign = 'right'; ctx.fillText(rule, a - 10, by); }
  else if (b + 10 + rw < width - 4) { ctx.textAlign = 'left'; ctx.fillText(rule, b + 10, by); }
  ctx.restore();

  legendRows(ctx, 6, 4, items, c, width - 12);
  return f;
}

/** A line of coloured labels at the top of a plot, cut short to fit maxWidth. */
export function legend(ctx, x, y, items, c, maxWidth = 1e9) {
  ctx.save();
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  let px = x;
  for (const it of items) {
    if (!it.text && !it.parts) continue;
    ctx.font = `${it.bold ? '600 ' : ''}12px system-ui, sans-serif`;
    const w = it.parts ? fillSlotsWidth(ctx, it.parts) : ctx.measureText(it.text).width;
    if (px + w > x + maxWidth) break;
    ctx.fillStyle = it.color;
    if (it.parts) fillSlots(ctx, it.parts, px, y); else ctx.fillText(it.text, px, y);
    px += w + 12;
  }
  ctx.restore();
}

function fillSlotsWidth(ctx, parts) {
  const fig = ctx.measureText('0').width, minus = Math.max(0, ctx.measureText('−').width - fig);
  return parts.reduce((s, p) => s + (typeof p === 'string' ? ctx.measureText(p).width : p.w * fig + minus), 0);
}
