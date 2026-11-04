// The plots of the NMR page: the detected signal against time (the mixer's two outputs and the
// detector's envelope), the coil's EMF as a scope shows it, the spectrum, and a curve of
// amplitudes with its fit.  Each takes a canvas context, its size, and plain data.  The traces of
// sampled signals (the record, the EMF, OUT) are drawn as a digital phosphor scope draws them
// (lib/scope.js): a slow line as a line, a band of many cycles to a pixel graded, brightest where
// the trace lingers; ?scope=fast in the address brings back the old per-column drawing.

import { Frame, fillSlots, niceTicks } from '../lib/plot.js';
import { scopeTrace, scopeMode } from '../lib/scope.js';
import { rawPlan, rawFill } from './signal.js';

/**
 * A key for a trace's kept picture (lib/scope.js), but only while what it shows stands still:
 * the same `still` (the record's id and version, say) at this place (`at`) as the last time it
 * was drawn.  A trace that changes every frame (a record growing as the clock runs) is drawn
 * afresh with no key, as making and throwing away a kept picture each frame would cost more.
 */
const lastSeen = new Map();
function keyIfStill(at, still, key) {
  const same = lastSeen.get(at) === still;
  lastSeen.set(at, still);
  return same ? `${at} ${still} ${key}` : undefined;
}

/**
 * Draw a trace that grows at its right end (a record filling as the clock runs) in two parts: the
 * columns already final, kept in a picture of their own and drawn into it only as they become
 * final, CHUNK device columns at a time; and the rest, drawn afresh every frame.  So a frame costs
 * the newest columns and one copy, not the whole trace.  `sig` names everything the trace depends
 * on but its growth (the record's id and epoch, the scales, the colours, the mode): when it or the
 * plot's place on the canvas changes, the picture starts again.  finalX: the drawing x up to which
 * the trace will not change; endX: where it ends (nothing is drawn past it).  draw(c, region, xa, xb) draws the trace from drawing x xa to xb (it
 * may draw a little more) onto the context c inside the region (a Frame-like box; lib/scope.js
 * clips to it), c being a scratch picture's context whose transform makes the drawing coordinates
 * the same as on the canvas.  Each part is a whole number of device columns, drawn two columns
 * wider on each side than it is copied out (a column's shade depends on its neighbours'), its
 * samples running MARGIN columns further, so the seams between parts don't show.
 */
const growing = new Map(), CHUNK = 32, MARGIN = 3, WIDEN = 2;
let partCanvas = null;
function growingTrace(ctx, f, at, sig, finalX, endX, draw) {
  const M = ctx.getTransform(), sx = M.a, sy = M.d;
  // (?scope=fast draws each column's extremes, which costs less than keeping a picture would.)
  if (scopeMode() === 'fast') { draw(ctx, f, f.left - MARGIN / sx, endX + MARGIN / sx); return; }
  const L = Math.floor(M.e + sx * f.left), T = Math.floor(M.f + sy * f.top);
  const W = Math.max(1, Math.ceil(M.e + sx * (f.left + f.w)) - L), H = Math.max(1, Math.ceil(M.f + sy * (f.top + f.h)) - T);
  const full = `${sig}|${L} ${T} ${W} ${H} ${sx} ${sy} ${M.e} ${M.f}`;
  let g = growing.get(at);
  if (!g) { g = { canvas: document.createElement('canvas'), full: '', done: 0 }; growing.set(at, g); }
  if (g.full !== full) {
    g.full = full; g.done = 0;
    if (g.canvas.width !== W || g.canvas.height !== H) { g.canvas.width = W; g.canvas.height = H; } else g.canvas.getContext('2d').clearRect(0, 0, W, H);
  }
  // Device columns [c0, c1) of the plot as a region in drawing coordinates (nudged inward, so that
  // it rounds to exactly those columns), and the drawing x of column c's left edge.
  const region = (c0, c1) => ({ left: (L + c0 + 1e-4 - M.e) / sx, top: f.top, w: (c1 - c0 - 2e-4) / sx, h: f.h });
  const xOf = (c) => (L + c - M.e) / sx;
  // Columns [c0, c1) of the trace, drawn into the scratch picture over [c0 - WIDEN, c1 + WIDEN).
  const part = (c0, c1) => {
    if (!partCanvas) partCanvas = document.createElement('canvas');
    if (partCanvas.width < W || partCanvas.height < H) { partCanvas.width = Math.max(W, partCanvas.width); partCanvas.height = Math.max(H, partCanvas.height); }
    const pc = partCanvas.getContext('2d'), e0 = Math.max(0, c0 - WIDEN), e1 = Math.min(W, c1 + WIDEN);
    pc.setTransform(1, 0, 0, 1, 0, 0); pc.clearRect(e0, 0, e1 - e0, H);
    pc.setTransform(sx, 0, 0, sy, M.e - L, M.f - T);
    draw(pc, region(e0, e1), xOf(e0 - MARGIN), xOf(e1 + MARGIN));
    return partCanvas;
  };
  const fin = Math.min(W, Math.floor(M.e + sx * finalX) - L - MARGIN), end = Math.max(0, Math.min(W, Math.ceil(M.e + sx * endX) - L + MARGIN));
  if (fin - g.done >= CHUNK || (fin === W && g.done < W)) {
    const kc = g.canvas.getContext('2d');
    kc.setTransform(1, 0, 0, 1, 0, 0);
    kc.drawImage(part(g.done, fin), g.done, 0, fin - g.done, H, g.done, 0, fin - g.done, H);
    g.done = fin;
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (g.done > 0) ctx.drawImage(g.canvas, 0, 0, g.done, H, L, T, g.done, H);
  if (g.done < end) ctx.drawImage(part(g.done, end), g.done, 0, end - g.done, H, L + g.done, T, end - g.done, H);
  ctx.restore();
}

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
  const sh = o.show || { mx: true, my: true, mxy: true, mz: true };
  // The record's samples in the window, and the one either side of it (so the trace reaches the
  // edges; nothing is drawn beyond the record's ends).  Without noise the record is a smooth
  // line, a sample or two a pixel, and is drawn as one (anti-aliased by the canvas).  With noise,
  // which is new at every sample, two or more samples a device pixel (a narrow plot) make a band,
  // drawn through scopeTrace as a scope shows noise (?scope=fast: the old per-column drawing) and
  // kept as it grows; fewer are a line too.  (Decided for the whole trace, so that the parts kept
  // as it grows don't each decide for themselves.)
  const N = R.length, traces = [
    sh.mz && [(i) => R.z[i], c.mz, 1.2],
    // The envelope first and thick, so that a mixer's output lying on it shows on top of it.
    sh.mxy && [(i) => Math.hypot(R.x[i] + sg * R.nx[i], R.y[i] + sg * R.ny[i]), c.mxy, 3.2],
    sh.mx && [(i) => R.x[i] + sg * R.nx[i], c.mx, 1.5],
    sh.my && [(i) => R.y[i] + sg * R.ny[i], c.my, 1.5],
  ].filter(Boolean);
  const span = (ta, tb) => [Math.max(0, R.index(ta)), Math.min(N - 1, R.index(tb) + 1)];
  // (With noise, one sample a noise index: a sample off the grid, at the end of a pulse or of a
  // frame's step of the clock, shares the noise of its grid sample, and would draw it as a flat
  // step, where a scope's trace lingers and shows a bright dash.)
  const pick = (i0, i1) => { const out = []; for (let i = i0; i <= i1; i++) if (!out.length || R.k[i] !== R.k[out[out.length - 1]]) out.push(i); return out; };
  const [v0, v1] = span(o.t0, o.t1), all = sg > 0 && v1 > v0 ? pick(v0, v1) : null;
  const dense = all && all.length - 1 >= 2 * (f.X(R.t[v1]) - f.X(R.t[v0])) * ctx.getTransform().a;
  if (N >= 2 && dense) {
    const draw = (cx, region, xa, xb) => {
      const [i0, i1] = span(Math.max(o.t0, f.invX(xa)), Math.min(o.t1, f.invX(xb))), I = pick(i0, i1);
      if (I.length < 2) return;
      for (const [value, color, width] of traces) scopeTrace(cx, region, { n: I.length, x: (j) => f.X(R.t[I[j]]), y: (j) => f.Y(k * value(I[j])), color, width });
    };
    growingTrace(ctx, f, `${ctx.canvas.id} signal`, `${R.id} ${R.epoch} ${sg} ${k} ${o.t0} ${o.t1} ${o.ymax} ${traces.map((q) => q[1]).join(' ')} ${scopeMode()}`, f.X(R.t[N - 1]), f.X(R.t[N - 1]), draw);
  } else if (N >= 2) {
    const I = all || Array.from({ length: Math.max(0, v1 - v0 + 1) }, (_, j) => v0 + j);
    for (const [value, color, width] of traces) {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round';
      ctx.beginPath();
      I.forEach((i, j) => { const x = f.X(R.t[i]), y = f.Y(k * value(i)); if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
    }
  }
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

/** The coil's EMF as a scope on it shows it: the oscillation at the Larmor frequency, or, where
 *  a pixel holds many periods, the band they make, graded by the time the trace spends across it
 *  (signal.js rawPlan and rawFill sample it; lib/scope.js draws it).  opts: {record, omegaRef,
 *  t0, t1, ymax, sigma, scale, unit, colors, sent, title, zoomNote}. */
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
      // The samples are laid out over the whole window, so that they stay where they are as the
      // record grows (and the trace's picture can be kept as it grows); those in the record are drawn.
      const fast = scopeMode() === 'fast', sg = o.sigma || 0;
      const plan = rawPlan(o.omegaRef, o.t0, o.t1, f.w * ctx.getTransform().a, { fast }), dt = (o.t1 - o.t0) / (plan.n - 1);
      envelope = plan.band;
      const draw = (cx, region, xa, xb) => {
        const j0 = Math.max(0, Math.ceil((Math.max(ta, f.invX(xa)) - o.t0) / dt - 1e-9)), j1 = Math.min(plan.n - 1, Math.floor((Math.min(tb, f.invX(xb)) - o.t0) / dt + 1e-9));
        if (j1 <= j0) return;
        const v = rawFill(R, o.omegaRef, o.t0, o.t1, plan, sg, rawBuffer(j1 - j0 + 1), j0, j1);
        scopeTrace(cx, region, { n: j1 - j0 + 1, y: (j) => f.Y(k * v[j]), x0: f.X(o.t0 + j0 * dt), x1: f.X(o.t0 + j1 * dt), color: c.raw, width: 1.3, alpha: fast && plan.band ? 0.75 : 1 });
      };
      growingTrace(ctx, f, `${ctx.canvas.id} raw`, `${R.id} ${R.epoch} ${o.omegaRef} ${o.t0} ${o.t1} ${ta} ${sg} ${k} ${o.ymax} ${c.raw} ${plan.n} ${scopeMode()}`, f.X(tb), f.X(tb), draw);
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

let rawBuf = new Float32Array(0);
/** A buffer of at least n floats for the raw trace's samples, reused from frame to frame. */
function rawBuffer(n) { if (rawBuf.length < n) rawBuf = new Float32Array(Math.ceil(n * 1.25)); return rawBuf; }

/** A trace given as evenly spaced samples (OUT at an audio rate), as a scope draws it: through
 *  lib/scope.js, interpolated as the band-limited signal it is (OUT is filtered far below half its
 *  sampling rate) where its samples are sparse, so a crest between samples comes out and the
 *  receiver's noise is a band.  opts: {t0, t1, y (Float32Array over [t0, t1]), ymax, colors,
 *  title, note, key (names everything y depends on, when it is kept)}. */
export function drawTrace(ctx, width, height, o) {
  const c = o.colors, f = new Frame(ctx, width, height, { left: 48, right: 12, top: 22, bottom: 34 });
  const tu = timeUnit(o.t1 - o.t0), y = o.y, n = y.length;
  f.x0 = o.t0; f.x1 = o.t1; f.y0 = -o.ymax; f.y1 = o.ymax;
  ctx.save(); f.clip();
  ctx.strokeStyle = c.line;
  ctx.beginPath(); ctx.moveTo(f.left, f.Y(0)); ctx.lineTo(f.right, f.Y(0)); ctx.stroke();
  if (n > 1) scopeTrace(ctx, f, { n, y: (i) => f.Y(y[i]), x0: f.X(o.t0), x1: f.X(o.t1), color: c.raw, width: 1.3, bandlimited: true, key: o.key ? keyIfStill(`nmr trace ${o.title}`, o.key, o.ymax) : undefined });
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
