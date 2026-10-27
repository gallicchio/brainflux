// The optical bench: a Gaussian beam through lenses, mirrors and slabs of glass that you drag
// along the axis.  The beam is drawn to scale along z and stretched E times sideways.
//
// Stretching a paraxial beam sideways by E is the same as making its wavelength E^2 times longer
// (the paraxial wave equation, d^2/dx^2 + 2ik d/dz, keeps its form if x -> x/E and k -> k/E^2).
// So the field picture is drawn as a beam of wavelength lambda E^2: its crests are then exactly
// as curved as the wavefront arcs drawn over it (circles of radius R in the stretched picture),
// and their Gouy shift through a focus is exactly half a (drawn) wavelength.

import { traceBench, beamAt, segmentAt, waists, hermite, lensLaw, coupling } from './gauss.js';
import { eigenmode } from './cavity.js';
import { el, $, slider, segmented, toggle, fmt } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors, niceTicks, tickLabel } from '../lib/plot.js';
import { colorize } from '../lib/complexcolor.js';
import { fmtLen, fmtAngle, fmtPi, wavelengthRGB, realTable, intensityTable, signedSlider, arrow, arcPath, haloText } from './common.js';

const MARGIN = { left: 52, right: 14, top: 26, bottom: 30 };
const DARK = '#07080b';
const ELEMENT_DEFAULTS = { lens: { f: 100 }, mirror: { R: 200 }, slab: { t: 20, n: 1.5 } };
const MAX_ELEMENTS = 10;
const CREST_RATE = 0.6;   // crests passing a point per second

export function createBench(app) {
  const state = app.state.bench;
  const canvas = $('#bench'), gouyCanvas = $('#gouy');
  let trace = null, frame = null, gframe = null;
  let field = null;          // { pw, ph, re, im, amp, img, off, table, mode, key }
  let phase = 0;             // omega t
  let hover = null;          // z under the pointer
  let drag = null;
  const pointers = new Map();
  let lensPlot = null;       // the lens-law canvas in the editor

  const lam = () => state.lambda * 1e-6;     // mm

  // ------------------------------------------------------------------- the physics

  let version = 0;            // bumped whenever the beam changes, so the field is recomputed
  function retrace() {
    trace = traceBench({ lambda: lam(), w0: state.w0, z0: state.z0 }, state.elements, state.vz0, state.vz1);
    version++;
  }

  /** The cavity to match, placed with its first mirror at state.tz: { mode, L, R1, R2 } or null. */
  function target() {
    if (!state.target) return null;
    const c = app.state.cavity;
    return { mode: eigenmode(c.L, c.R1, c.R2, lam()), L: c.L, R1: c.R1, R2: c.R2, z: state.tz };
  }

  function matching() {
    const t = target();
    if (!t || !t.mode) return null;
    const b = beamAt(trace, t.z + 1e-9);
    const qt = { re: -t.mode.zw, im: t.mode.zR };
    return { eta: coupling(b.q, qt), b, t, inGlass: b.n !== 1 };
  }

  // ------------------------------------------------------------------- geometry

  function layout() {
    const { ctx, width, height } = fitCanvas(canvas);
    frame = new Frame(ctx, width, height, MARGIN);
    frame.x0 = state.vz0; frame.x1 = state.vz1;
    const sx = frame.w / (state.vz1 - state.vz0), sy = state.E * sx;
    frame.y0 = -frame.h / 2 / sy; frame.y1 = frame.h / 2 / sy;
    return { ctx, width, height, sx, sy };
  }
  const sxNow = () => frame.w / (state.vz1 - state.vz0);

  // ------------------------------------------------------------------- the field picture

  function computeField() {
    const pw = Math.max(2, Math.round(frame.w)), ph = Math.max(2, Math.round(frame.h));
    const mode = state.field;
    const key = [pw, ph, mode, state.m, state.E, state.vz0, state.vz1, state.bright, version].join();
    if (field && field.key === key) return field;
    if (!field || field.pw !== pw || field.ph !== ph) {
      const off = document.createElement('canvas'); off.width = pw; off.height = ph;
      const col = () => new Float64Array(pw);
      field = {
        pw, ph, off, img: new ImageData(pw, ph), re: new Float32Array(pw * ph), im: new Float32Array(pw * ph), amp: new Float32Array(pw * ph), cref: col(),
        // Per column: the recurrence's state and constants (see below).
        FR: col(), FI: col(), RR: col(), RI: col(), QR: col(), QI: col(), CR: col(), CI: col(), G: col(), S: col(), SIG: col(), A0: col(), INVW: col(), KMAX: new Int32Array(pw),
      };
    }
    field.key = key; field.mode = mode;
    if (mode === 'off') return field;
    const { re, im, amp, cref, FR, FI, RR, RI, QR, QI, CR, CI, G, S, SIG, A0, INVW, KMAX } = field;
    const k0 = (2 * Math.PI) / lam(), E = state.E, kd = k0 / (E * E), m = state.m;
    const sx = pw / (state.vz1 - state.vz0), sy = E * sx;
    let norm = 1;
    for (let k = 1; k <= m; k++) norm *= 2 * k;
    norm = 1 / Math.sqrt(norm);
    // Rows come in pairs at x = +-(k + e) dx, dx = 1/sy, e = 1/2 (even ph) or 0 (odd).
    const half = ph / 2, e = ph % 2 ? 0 : 0.5, dx = 1 / sy, d2 = dx * dx, parity = m % 2 ? -1 : 1;
    let seg = null, aMin = Infinity, aMax = 0, kTop = 0;
    for (let i = 0; i < pw; i++) {
      const z = state.vz0 + (i + 0.5) / sx;
      if (!seg || z >= seg.zb || z < seg.za) seg = segmentAt(trace, z);
      const b = beamAt(trace, z, seg);
      // The amplitude goes as w0/w; it is drawn as the square root of that, so that a focus
      // doesn't outshine the rest of the bench (and the intensity as w0/w).
      const peak = Math.sqrt(state.w0 / b.w), a0 = peak * norm, c2 = 0.5 * k0 * b.curv, w2 = b.w * b.w;
      aMin = Math.min(aMin, peak); aMax = Math.max(aMax, peak);
      cref[i] = kd * b.opl;
      const colPhase = (mode === 'real' ? kd * b.opl : 0) - (m + 1) * b.gouy;
      // Crests closer than a few pixels can't be drawn: fade them to their average, zero.  The
      // fading across x, exp(-(2 c2 x / sy)^2 / 5), is itself a Gaussian in x.
      const gz = mode === 'real' ? (kd * b.n) / sx : 0, beta = (4 * c2 * c2) / (5 * sy * sy);
      const A = a0 * Math.exp(-(gz * gz) / 5);
      CR[i] = A * Math.cos(colPhase); CI[i] = A * Math.sin(colPhase);
      // Along the column the field is exp(-alpha x^2), alpha = 1/w^2 + beta - i c2: step from
      // the axis outwards by complex multiplication, f(k+1) = f(k) r(k), r(k+1) = r(k) rho.
      const ar = 1 / w2 + beta;
      let s2 = e * e * d2, mag = Math.exp(-ar * s2);
      FR[i] = mag * Math.cos(c2 * s2); FI[i] = mag * Math.sin(c2 * s2);
      s2 = (2 * e + 1) * d2; mag = Math.exp(-ar * s2);
      RR[i] = mag * Math.cos(c2 * s2); RI[i] = mag * Math.sin(c2 * s2);
      s2 = 2 * d2; mag = Math.exp(-ar * s2);
      QR[i] = mag * Math.cos(c2 * s2); QI[i] = mag * Math.sin(c2 * s2);
      // The real Gaussian alone (for the intensity), the same way.
      G[i] = Math.exp(-(e * e * d2) / w2); S[i] = Math.exp(-((2 * e + 1) * d2) / w2); SIG[i] = Math.exp(-(2 * d2) / w2);
      A0[i] = a0; INVW[i] = Math.SQRT2 / b.w;
      KMAX[i] = Math.min(Math.ceil(half) + 1, Math.ceil(Math.sqrt(14 + m) * b.w * sy));
      kTop = Math.max(kTop, KMAX[i]);
    }
    // Then row by row outwards from the axis, every column at once (memory in order).
    const wantRe = mode !== 'intensity', wantAmp = mode === 'intensity';
    if (wantRe) { re.fill(0); im.fill(0); } else amp.fill(0);
    for (let k = 0; k < kTop; k++) {
      const jU = Math.round(half - 0.5 - (k + e)), jD = Math.round(half - 0.5 + (k + e));
      const oU = jU * pw, oD = jD * pw, up = jU >= 0, down = jD < ph, x = (k + e) * dx;
      for (let i = 0; i < pw; i++) {
        if (k >= KMAX[i]) continue;
        const h = m ? hermite(m, x * INVW[i]) : 1;
        let fr = FR[i], fi = FI[i];
        if (wantRe) {
          const vr = h * (fr * CR[i] - fi * CI[i]), vi = h * (fr * CI[i] + fi * CR[i]);
          if (up) { re[oU + i] = vr; im[oU + i] = vi; }
          if (down) { re[oD + i] = parity * vr; im[oD + i] = parity * vi; }
        }
        if (wantAmp) {
          const a = A0[i] * h * G[i], I = a * a;
          if (up) amp[oU + i] = I;
          if (down) amp[oD + i] = I;
          G[i] *= S[i]; S[i] *= SIG[i];
        }
        const rr = RR[i], ri = RI[i];
        FR[i] = fr * rr - fi * ri; FI[i] = fr * ri + fi * rr;
        RR[i] = rr * QR[i] - ri * QI[i]; RI[i] = rr * QI[i] + ri * QR[i];
      }
    }
    field.aRef = 0.6 * Math.sqrt(aMin * aMax) * 10 ** (-state.bright / 2);
    if (mode === 'real') field.table = realTable(field.aRef);
    else if (mode === 'intensity') field.table = intensityTable(wavelengthRGB(state.lambda), 0.6 * field.aRef * field.aRef);
    else if (mode === 'phase') colorize(re, im, field.img.data, field.aRef, 'complex');
    return field;
  }

  /** The field image at the current time. */
  function paintField() {
    const f = field, n = f.pw * f.ph;
    if (f.mode === 'real') {
      const { lut, size, vmax } = f.table, out = new Uint32Array(f.img.data.buffer), L = new Uint32Array(lut.buffer);
      const c = Math.cos(phase), s = Math.sin(phase), scale = (0.5 * size) / vmax;
      for (let p = 0; p < n; p++) {
        let k = ((f.re[p] * c + f.im[p] * s) * scale + 0.5 * size) | 0;
        if (k < 0) k = 0; else if (k >= size) k = size - 1;
        out[p] = L[k];
      }
    } else if (f.mode === 'intensity') {
      const { lut, size, imax } = f.table, out = new Uint32Array(f.img.data.buffer), L = new Uint32Array(lut.buffer);
      const scale = size / imax;
      for (let p = 0; p < n; p++) { let k = (f.amp[p] * scale) | 0; if (k >= size) k = size - 1; out[p] = L[k]; }
    }
    f.off.getContext('2d').putImageData(f.img, 0, 0);
  }

  // ------------------------------------------------------------------- drawing

  /** Everything: the bench, the Gouy strip, the read-outs. */
  function draw() {
    if (!trace) retrace();
    drawBench();
    drawGouy();
    readout();
    waistTable();
  }

  function drawBench() {
    const { ctx, width, height, sx, sy } = layout();
    const c = themeColors();
    ctx.clearRect(0, 0, width, height);
    const F = frame, yc = F.top + F.h / 2;
    ctx.fillStyle = DARK; ctx.fillRect(F.left, F.top, F.w, F.h);
    if (state.field !== 'off') {
      computeField();
      paintField();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(field.off, F.left, F.top, F.w, F.h);
    }
    F.clip();
    if (state.field === 'real') referenceTicks(ctx, F);
    const Zp = (z) => F.X(z), Xp = (x) => yc - x * sy;
    // Slabs first (under the beam lines).
    state.elements.forEach((e) => {
      if (e.type !== 'slab') return;
      const a = Zp(e.z), b = Zp(e.z + e.t);
      ctx.fillStyle = 'rgba(120,170,255,0.13)'; ctx.fillRect(a, F.top, b - a, F.h);
      ctx.strokeStyle = e === state.sel ? c.accent : 'rgba(160,200,255,0.7)'; ctx.lineWidth = e === state.sel ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(a, F.top); ctx.lineTo(a, F.bottom); ctx.moveTo(b, F.top); ctx.lineTo(b, F.bottom); ctx.stroke();
    });
    drawTarget(ctx, F, Zp, Xp, sx, sy, c);
    // The envelope +-w(z), sampled per pixel column, segment by segment so that it bends at lenses.
    const lineColor = state.field === 'off' ? wavelengthCss() : 'rgba(255,255,255,0.85)';
    ctx.strokeStyle = lineColor; ctx.lineWidth = 1.5;
    for (const sgn of [1, -1]) {
      ctx.beginPath();
      for (const seg of trace.segments) {
        const za = Math.max(seg.za, state.vz0), zb = Math.min(seg.zb, state.vz1);
        if (zb <= za) continue;
        const steps = Math.max(2, Math.ceil((zb - za) * sx / 2));
        for (let k = 0; k <= steps; k++) {
          const z = za + ((zb - za) * k) / steps, b = beamAt(trace, z, seg);
          const px = Zp(z), py = Xp(sgn * b.w);
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
    }
    if (state.field === 'off') {
      // A faint fill so the beam reads as light.
      ctx.fillStyle = wavelengthCss(0.18);
      for (const seg of trace.segments) {
        const za = Math.max(seg.za, state.vz0), zb = Math.min(seg.zb, state.vz1);
        if (zb <= za) continue;
        const steps = Math.max(2, Math.ceil((zb - za) * sx / 3));
        ctx.beginPath();
        for (let k = 0; k <= steps; k++) { const z = za + ((zb - za) * k) / steps; ctx.lineTo(Zp(z), Xp(beamAt(trace, z, seg).w)); }
        for (let k = steps; k >= 0; k--) { const z = za + ((zb - za) * k) / steps; ctx.lineTo(Zp(z), Xp(-beamAt(trace, z, seg).w)); }
        ctx.fill();
      }
    }
    if (state.wavefronts) drawWavefronts(ctx, F, Zp, yc, sx, sy);
    drawWaists(ctx, F, Zp, Xp, sx, sy);
    drawElements(ctx, F, Zp, yc, sx, c);
    drawInputHandle(ctx, Zp, Xp);
    if (hover !== null && !drag) {
      // The probe: a line, and the beam's numbers there in a box beside it.
      const px = Zp(hover), b = beamAt(trace, hover);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, F.top); ctx.lineTo(px, F.bottom); ctx.stroke(); ctx.setLineDash([]);
      const lines = [`z = ${fmtLen(hover)}`, `w = ${fmtLen(b.w)}`, `R = ${fmtLen(b.R)}`, `ψ = ${fmtPi(b.gouy, 3)}`];
      if (b.n !== 1) lines.push(`in glass, n = ${fmt(b.n, 3)}`);
      ctx.font = '12px system-ui, sans-serif';
      const bw = Math.max(...lines.map((t) => ctx.measureText(t).width)) + 14, bh = 16 * lines.length + 8;
      const bx = px + 8 + bw > F.right ? px - 8 - bw : px + 8, by = F.top + 24;
      ctx.fillStyle = 'rgba(10,12,18,0.82)'; ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      lines.forEach((t, k) => ctx.fillText(t, bx + 7, by + 5 + 16 * k));
    }
    // The sideways stretch, in a corner.
    ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    haloText(ctx, `drawn ×${fmt(state.E, 3)} wider than it is`, F.right - 6, F.top + 5, 'rgba(255,255,255,0.75)');
    ctx.restore();
    // Axes: z along the bottom, the true transverse x on the left.
    axes(ctx, F, c, sy);
    drawLabels(ctx, F, Zp, c);
  }

  /**
   * A plane wave's crests, as ticks along the top and bottom edges, in step with the beam's
   * crests near the axis at the left edge: through a focus the beam's crests get half a
   * wavelength ahead of them (the Gouy phase).
   */
  function referenceTicks(ctx, F) {
    const f = field, pw = f.pw, sxp = F.w / pw;
    // The beam's phase a little above the axis, in the first column.
    const lift = Math.max(1, Math.round(0.25 * beamAt(trace, state.vz0).w * state.E * (pw / (state.vz1 - state.vz0))));
    let o = Math.max(0, Math.floor(f.ph / 2) - lift) * pw;
    if (f.re[o] === 0 && f.im[o] === 0) o = Math.floor(f.ph / 2) * pw;
    if (f.re[o] === 0 && f.im[o] === 0) return;
    const p0 = Math.atan2(f.im[o], f.re[o]) - f.cref[0];
    if (pw < 2 || (2 * Math.PI) / Math.abs(f.cref[1] - f.cref[0]) < 5) return;   // too close to draw
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    let prev = Math.floor((f.cref[0] + p0 - phase) / (2 * Math.PI));
    for (let i = 1; i < pw; i++) {
      const k = Math.floor((f.cref[i] + p0 - phase) / (2 * Math.PI));
      if (k === prev) continue;
      const x = F.left + (i + 0.5) * sxp;
      ctx.moveTo(x, F.top); ctx.lineTo(x, F.top + 6); ctx.moveTo(x, F.bottom); ctx.lineTo(x, F.bottom - 6);
      prev = k;
    }
    ctx.stroke();
  }

  function wavelengthCss(alpha = 1) {
    const [r, g, b] = wavelengthRGB(state.lambda);
    return `rgba(${Math.round(255 * r)},${Math.round(255 * g)},${Math.round(255 * b)},${alpha})`;
  }

  function axes(ctx, F, c, sy) {
    ctx.save();
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = c.ink2; ctx.strokeStyle = c.ink3; ctx.lineWidth = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const v of niceTicks(state.vz0, state.vz1, Math.max(2, Math.round(F.w / 90)))) {
      const px = Math.round(F.X(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(px, F.bottom); ctx.lineTo(px, F.bottom + 4); ctx.stroke();
      ctx.fillText(tickLabel(v), px, F.bottom + 6);
    }
    ctx.textAlign = 'right';
    ctx.fillText('z (mm)', F.right, F.bottom + 18);
    // Transverse: ticks in um or mm.
    const xmax = F.h / 2 / sy, um = xmax < 1;
    const unit = um ? 1000 : 1;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const v of niceTicks(-xmax * unit, xmax * unit, Math.max(2, Math.round(F.h / 45)))) {
      const py = Math.round(F.top + F.h / 2 - (v / unit) * sy) + 0.5;
      ctx.beginPath(); ctx.moveTo(F.left - 4, py); ctx.lineTo(F.left, py); ctx.stroke();
      ctx.fillText(tickLabel(v), F.left - 6, py);
    }
    ctx.save();
    ctx.translate(11, F.top + F.h / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center';
    ctx.fillText(um ? 'x (µm)' : 'x (mm)', 0, 0);
    ctx.restore();
    ctx.restore();
  }

  function drawWavefronts(ctx, F, Zp, yc, sx, sy) {
    // Arcs of radius R (in the stretched picture, where they are the crests' true shape), every
    // 70 pixels or so, each as tall as 1.6 w.
    const step = 70 / sx;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.2;
    for (let z = Math.ceil(state.vz0 / step) * step; z < state.vz1; z += step) {
      const b = beamAt(trace, z);
      const h = Math.min(1.6 * b.w * sy, F.h / 2);
      ctx.beginPath(); arcPath(ctx, Zp(z), yc, b.R * sx, h); ctx.stroke();
    }
  }

  function drawWaists(ctx, F, Zp, Xp, sx, sy) {
    ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
    const placed = [];
    for (const w of waists(trace)) {
      if (!w.real || w.z < state.vz0 || w.z > state.vz1) continue;
      const px = Zp(w.z);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, Xp(w.w0)); ctx.lineTo(px, Xp(-w.w0)); ctx.stroke();
      // The Rayleigh range: where w = sqrt2 w0.
      const zrPx = w.zR * sx;
      if (zrPx > 6) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        for (const s of [-1, 1]) {
          const z = w.z + s * w.zR;
          if (z < w.seg.za - 1e-9 || z > w.seg.zb + 1e-9) continue;
          ctx.beginPath(); ctx.moveTo(Zp(z), Xp(Math.SQRT2 * w.w0)); ctx.lineTo(Zp(z), Xp(-Math.SQRT2 * w.w0)); ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      // Label below the beam (inside the picture), unless another waist's label is in the way.
      if (placed.some((x) => Math.abs(x - px) < 100)) continue;
      placed.push(px);
      const y = Math.min(F.bottom - 32, Xp(-Math.SQRT2 * w.w0) + 10);
      const lx = Math.max(F.left + 44, Math.min(F.right - 44, px));
      ctx.textBaseline = 'top';
      haloText(ctx, `w₀ ${fmtLen(w.w0)}`, lx, y);
      if (zrPx > 6) haloText(ctx, `z_R ${fmtLen(w.zR)}`, lx, y + 13, 'rgba(255,255,255,0.8)');
    }
  }

  function drawElements(ctx, F, Zp, yc, sx, c) {
    for (const e of state.elements) {
      const px = Zp(e.z), sel = e === state.sel;
      const col = sel ? c.accent : 'rgba(235,240,255,0.92)';
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = sel ? 2.5 : 2;
      const h = F.h / 2 - 8;
      if (e.type === 'lens') {
        ctx.beginPath(); ctx.moveTo(px, yc - h); ctx.lineTo(px, yc + h); ctx.stroke();
        // Arrowheads: pointing out for a converging lens, in for a diverging one.
        for (const s of [-1, 1]) {
          const end = yc + s * h, inner = end - s * 9;
          const [tip, barbs] = e.f > 0 ? [end, inner] : [inner, end];
          ctx.beginPath(); ctx.moveTo(px - 6, barbs); ctx.lineTo(px, tip); ctx.lineTo(px + 6, barbs); ctx.stroke();
        }
      } else if (e.type === 'mirror') {
        ctx.beginPath(); arcPath(ctx, px, yc, e.R * sx, h); ctx.stroke();
        // Hatching behind it.
        ctx.lineWidth = 1;
        for (let y = -h; y <= h; y += 9) {
          const Rpx = e.R * sx, lim = Math.abs(Rpx) * 0.995;
          if (Math.abs(y) > lim && Number.isFinite(Rpx)) continue;
          const sag = Number.isFinite(Rpx) && Math.abs(Rpx) < 1e7 ? Math.sign(Rpx) * (Math.abs(Rpx) - Math.sqrt(Rpx * Rpx - y * y)) : 0;
          ctx.beginPath(); ctx.moveTo(px - sag, yc + y); ctx.lineTo(px - sag + 6, yc + y - 6); ctx.stroke();
        }
      }
    }
  }

  function drawInputHandle(ctx, Zp, Xp) {
    if (state.z0 < state.vz0 || state.z0 > state.vz1) return;
    const x = Zp(state.z0), y = Xp(state.w0);
    ctx.fillStyle = drag?.kind === 'input' ? '#fff' : 'rgba(0,0,0,0.6)';
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 6, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  }

  function drawTarget(ctx, F, Zp, Xp, sx, sy, c) {
    const t = target();
    if (!t) return;
    const yc = F.top + F.h / 2, h = F.h / 2 - 14;
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2;
    ctx.beginPath(); arcPath(ctx, Zp(t.z), yc, -t.R1 * sx, h); ctx.stroke();
    ctx.beginPath(); arcPath(ctx, Zp(t.z + t.L), yc, t.R2 * sx, h); ctx.stroke();
    if (!t.mode) return;
    ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
    for (const s of [1, -1]) {
      ctx.beginPath();
      for (let k = 0; k <= 80; k++) {
        const z = t.z + (t.L * k) / 80, d = z - (t.z + t.mode.zw);
        const w = t.mode.w0 * Math.sqrt(1 + (d / t.mode.zR) ** 2);
        if (k === 0) ctx.moveTo(Zp(z), Xp(s * w)); else ctx.lineTo(Zp(z), Xp(s * w));
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  function drawLabels(ctx, F, Zp, c) {
    ctx.save();
    ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    for (const e of state.elements) {
      const z = e.type === 'slab' ? e.z + e.t / 2 : e.z;
      if (z < state.vz0 || z > state.vz1) continue;
      ctx.fillStyle = e === state.sel ? c.accent : c.ink2;
      ctx.fillText(elementShort(e), Zp(z), F.top - 8);
    }
    const t = target();
    if (t && t.z + t.L / 2 > state.vz0 && t.z + t.L / 2 < state.vz1) {
      const m = matching();
      ctx.fillStyle = '#c58a00';
      ctx.fillText(m ? `cavity: η = ${(100 * m.eta).toFixed(1)}%` : 'cavity (unstable)', Zp(t.z + t.L / 2), F.top - 8);
    }
    ctx.restore();
  }

  function elementShort(e) {
    if (e.type === 'lens') return `f ${fmtLen(e.f, 3)}`;
    if (e.type === 'mirror') return Number.isFinite(e.R) ? `mirror R ${fmtLen(e.R, 3)}` : 'flat mirror';
    return `n ${fmt(e.n, 3)}`;
  }
  function elementName(e) {
    const i = state.elements.filter((x) => x.type === e.type).indexOf(e) + 1;
    return { lens: 'Lens', mirror: 'Mirror', slab: 'Slab' }[e.type] + ' ' + i;
  }

  // ------------------------------------------------------------------- the Gouy strip

  function drawGouy() {
    const { ctx, width, height } = fitCanvas(gouyCanvas);
    const c = themeColors();
    ctx.clearRect(0, 0, width, height);
    const F = new Frame(ctx, width, height, { left: MARGIN.left, right: MARGIN.right, top: 20, bottom: 24 });
    gframe = F;
    F.x0 = state.vz0; F.x1 = state.vz1;
    const n = Math.max(2, Math.round(F.w / 2)), zs = [], ps = [];
    let lo = Infinity, hi = -Infinity;
    const mult = state.m + 1;
    for (let k = 0; k <= n; k++) {
      const z = state.vz0 + ((state.vz1 - state.vz0) * k) / n, g = beamAt(trace, z).gouy / Math.PI;
      zs.push(z); ps.push(g);
      lo = Math.min(lo, g, mult * g); hi = Math.max(hi, g, mult * g);
    }
    lo = Math.floor(lo * 2 - 0.01) / 2; hi = Math.ceil(hi * 2 + 0.01) / 2;
    if (hi - lo < 1) { const mid = (hi + lo) / 2; lo = mid - 0.5; hi = mid + 0.5; }
    F.y0 = lo; F.y1 = hi;
    F.clip();
    ctx.strokeStyle = c.line; ctx.lineWidth = 1;
    for (let v = Math.ceil(lo * 2) / 2; v <= hi; v += 0.5) { const y = Math.round(F.Y(v)) + 0.5; ctx.beginPath(); ctx.moveTo(F.left, y); ctx.lineTo(F.right, y); ctx.stroke(); }
    for (const e of state.elements) {
      const x = Math.round(F.X(e.z)) + 0.5;
      ctx.strokeStyle = c.ink3; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(x, F.top); ctx.lineTo(x, F.bottom); ctx.stroke(); ctx.setLineDash([]);
    }
    const plot = (k, color, dash) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(dash);
      ctx.beginPath();
      zs.forEach((z, i) => { const x = F.X(z), y = F.Y(k * ps[i]); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.stroke(); ctx.setLineDash([]);
    };
    if (mult > 1) plot(mult, c.warn, [6, 4]);
    plot(1, c.accent, []);
    if (hover !== null) {
      ctx.strokeStyle = c.ink3; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(F.X(hover), F.top); ctx.lineTo(F.X(hover), F.bottom); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
    // Ticks in units of pi.
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = c.ink2; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = Math.ceil(lo * 2) / 2; v <= hi; v += 0.5) ctx.fillText(`${tickLabel(v)}π`, F.left - 6, F.Y(v));
    ctx.strokeStyle = c.line; ctx.strokeRect(F.left + 0.5, F.top + 0.5, F.w - 1, F.h - 1);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = c.ink2;
    ctx.fillText('Gouy phase ψ(z): the extra phase the beam gains, over a plane wave', F.left, 14);
    if (mult > 1) { ctx.fillStyle = c.warn; ctx.textAlign = 'right'; ctx.fillText(`dashed: HG${state.m}0 gains ${mult}ψ`, F.right, 14); }
    ctx.fillStyle = c.ink2; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    for (const v of niceTicks(state.vz0, state.vz1, Math.max(2, Math.round(F.w / 90)))) {
      ctx.textAlign = 'center'; ctx.fillText(tickLabel(v), F.X(v), F.bottom + 5);
    }
  }

  // ------------------------------------------------------------------- read-outs

  let readoutKey = '';
  function readout() {
    const inB = { w0: state.w0, zR: (Math.PI * state.w0 ** 2) / lam() };
    const parts = [
      el('span', {}, `λ = ${fmt(state.lambda, 4)} nm`),
      el('span', {}, 'input waist ', el('b', {}, fmtLen(state.w0)), ` at z = ${fmtLen(state.z0)}, z`, el('sub', {}, 'R'), ` = ${fmtLen(inB.zR)}, divergence λ/πw₀ = ${fmtAngle(lam() / (Math.PI * state.w0))}`),
    ];
    const m = matching();
    if (m) parts.push(el('span', { class: 'good' }, `mode matching η = ${(100 * m.eta).toFixed(1)}%`));
    // Only when it changes (writing the page's text makes the browser lay it out again).
    const key = parts.map((p) => p.textContent).join('|');
    if (key !== readoutKey) { readoutKey = key; $('#bench-readout').replaceChildren(...parts); }
  }

  function waistTable() {
    const rows = [el('tr', {}, ...['', 'waist w₀', 'at z', 'Rayleigh range z_R', 'divergence θ = λ/πnw₀', ''].map((h) => el('th', {}, h)))];
    const segs = trace.segments;
    waists(trace).forEach((w, i) => {
      const seg = w.seg;
      const name = i === 0 ? 'input beam' : seg.n !== 1 ? `in glass (n = ${fmt(seg.n, 3)})` : `after ${seg.after ? elementName(seg.after).toLowerCase() : '?'}`;
      // The input beam's waist is really there if no element comes before it (even off the view).
      const real = i === 0 ? segs.length === 1 || w.z <= segs[1].za + 1e-9 : w.real;
      const note = !real ? 'virtual (outside this stretch)' : w.z < state.vz0 || w.z > state.vz1 ? 'off this view' : '';
      rows.push(el('tr', { class: real ? '' : 'virtual' },
        el('td', {}, name), el('td', {}, fmtLen(w.w0)), el('td', {}, fmtLen(w.z)), el('td', {}, fmtLen(w.zR)),
        el('td', {}, fmtAngle(w.theta)), el('td', { class: 'muted' }, note)));
    });
    $('#waists').replaceChildren(...rows);
  }

  // ------------------------------------------------------------------- the editor

  const laserBox = $('#laser-box');
  const lambdaSlider = slider({ label: 'λ (nm)', min: 350, max: 1600, step: 1, value: state.lambda, title: 'The wavelength in vacuum',
    onInput: (v) => { state.lambda = v; changed(); } });
  const w0Slider = slider({ label: 'w₀ (µm)', min: 2, max: 5000, log: true, value: state.w0 * 1000, title: 'The input beam\'s waist (1/e² intensity radius)',
    onInput: (v) => { state.w0 = v / 1000; changed(); } });
  const z0Slider = slider({ label: 'at z (mm)', min: -1000, max: 1000, step: 0.1, value: state.z0, title: 'Where the input beam has its waist (it may be off the bench)',
    onInput: (v) => { state.z0 = v; changed(); } });
  laserBox.append(lambdaSlider, w0Slider, z0Slider);

  const addBox = $('#add-box');
  for (const type of ['lens', 'mirror', 'slab']) {
    addBox.append(el('button', { type: 'button', title: `Put a ${type} on the bench`, onclick: () => addElement(type) }, `+ ${type[0].toUpperCase() + type.slice(1)}`));
  }

  function addElement(type, props = {}) {
    if (state.elements.length >= MAX_ELEMENTS) { app.toast(`At most ${MAX_ELEMENTS} elements`); return null; }
    const span = state.vz1 - state.vz0;
    let z = state.vz0 + 0.5 * span;
    for (let k = 0; k < 8 && state.elements.some((e) => Math.abs(e.z - z) < 0.04 * span); k++) z += 0.07 * span;
    const e = { type, z: +z.toPrecision(4), ...ELEMENT_DEFAULTS[type], ...props };
    state.elements.push(e);
    select(e);
    changed();
    return e;
  }
  function removeElement(e) {
    state.elements = state.elements.filter((x) => x !== e);
    if (state.sel === e) state.sel = null;
    buildEditor(); changed();
  }
  function select(e) {
    state.sel = e;
    buildEditor();
    draw();
    app.hashSoon();
  }

  function buildChips() {
    const box = $('#chips');
    box.replaceChildren(...state.elements.map((e) => el('button', {
      type: 'button', 'aria-pressed': String(e === state.sel), title: 'Select it (or click it on the bench)',
      onclick: () => select(e === state.sel ? null : e),
    }, `${elementName(e)}: ${elementShort(e)}`)));
  }

  let editorSliders = {};
  function buildEditor() {
    buildChips();
    const box = $('#el-editor');
    const e = state.sel;
    editorSliders = {};
    lensPlot = null;
    if (!e) {
      box.replaceChildren(el('div', { class: 'small muted' }, state.elements.length ? 'Click an element (here or on the bench) to change it.' : 'Add a lens, a mirror or a slab of glass.'));
      return;
    }
    const zs = slider({ label: 'z (mm)', min: Math.min(state.vz0, e.z), max: Math.max(state.vz1, e.z), step: 0.1, value: e.z, title: 'Its position along the bench',
      onInput: (v) => { e.z = v; changed(); } });
    editorSliders.z = zs;
    const parts = [el('div', { class: 'editor-head' }, el('b', {}, elementName(e)),
      el('button', { type: 'button', class: 'remove', title: 'Take it off the bench (Delete)', onclick: () => removeElement(e) }, 'Remove')), zs];
    if (e.type === 'lens') {
      editorSliders.f = signedSlider({ label: 'f (mm)', min: 5, max: 5000, value: e.f, title: 'Focal length',
        signs: [{ value: 1, label: 'converging' }, { value: -1, label: 'diverging' }], onInput: (v) => { e.f = v; changed(); } });
      parts.push(editorSliders.f);
    } else if (e.type === 'mirror') {
      editorSliders.R = signedSlider({ label: 'R (mm)', min: 10, max: 10000, value: e.R, title: 'Radius of curvature',
        signs: [{ value: 1, label: 'concave' }, { value: 0, label: 'flat' }, { value: -1, label: 'convex' }], onInput: (v) => { e.R = v; changed(); } });
      parts.push(editorSliders.R, el('div', { class: 'small muted' }, 'Unfolded: the reflected beam is drawn going on to the right, as if the mirror were a lens of focal length R/2.'));
    } else {
      editorSliders.t = slider({ label: 'thickness (mm)', min: 1, max: 500, log: true, value: e.t, onInput: (v) => { e.t = v; changed(); } });
      editorSliders.n = slider({ label: 'n', min: 1, max: 4, step: 0.001, value: e.n, title: 'Refractive index', onInput: (v) => { e.n = v; changed(); } });
      parts.push(editorSliders.t, editorSliders.n);
    }
    const info = el('div', { class: 'el-info small', id: 'el-info' });
    parts.push(info);
    if (e.type !== 'slab') {
      lensPlot = el('canvas', { class: 'lens-plot', 'aria-label': 'Where the lens puts the waist: the Gaussian lens law against the geometric one' });
      parts.push(el('div', { class: 'lens-plot-wrap' }, lensPlot));
    }
    box.replaceChildren(...parts);
    elementInfo();
  }

  /** What the selected element does to the beam, in words and numbers. */
  function elementInfo() {
    const e = state.sel, info = $('#el-info');
    if (!e || !info) return;
    if (e.type === 'slab') {
      info.replaceChildren(el('div', {}, `Moves a focus behind it back by t(1 − 1/n) = ${fmtLen(e.t * (1 - 1 / e.n))}, and stretches the Rayleigh range n times inside.`));
      return;
    }
    const f = e.type === 'lens' ? e.f : e.R / 2;
    const before = beamAt(trace, e.z - 1e-9), after = beamAt(trace, e.z + 1e-9);
    const seg = segmentAt(trace, e.z + 1e-9);
    const out = waists(trace).find((w) => w.seg === seg);
    const lines = [
      el('div', {}, `On it: w = ${fmtLen(before.w)}, R = ${fmtLen(before.R)} (coming in).`),
    ];
    if (Number.isFinite(f)) {
      lines.push(el('div', {}, `New waist: w₀′ = `, el('b', {}, fmtLen(out.w0)), ` ${out.z >= e.z ? `${fmtLen(out.z - e.z)} after it` : `${fmtLen(e.z - out.z)} before it (virtual)`}.`));
      if (out.w0 < 3 * lam()) lines.push(el('div', { class: 'warn' }, `That is only ${fmt(out.w0 / lam(), 2)} wavelengths: the beam converges at ${fmtAngle(out.theta)}, too steep for paraxial optics, so these numbers are rough.`));
      if (f > 0) lines.push(el('div', {}, `λf/πw = ${fmtLen((lam() * f) / (Math.PI * before.w))} (the focus of a collimated beam of this width).`));
      if (before.n === 1 && after.n === 1) {
        const s = e.z - before.zw, L = lensLaw(s, before.zR, f);
        const where = `${fmtLen(Math.abs(s))} ${s >= 0 ? 'before' : 'after'} it`;
        lines.push(el('div', {}, `Ray optics would image the waist (${where}) ${L.geometric >= 0 ? `to ${fmtLen(L.geometric)} after it` : `to a virtual image ${fmtLen(-L.geometric)} before it`}.`));
      }
    }
    info.replaceChildren(...lines);
    drawLensPlot(e, f, before);
  }

  function drawLensPlot(e, f, before) {
    if (!lensPlot) return;
    const wrap = lensPlot.parentElement;
    if (!(f > 0) || !Number.isFinite(f) || before.n !== 1) { wrap.hidden = true; return; }
    wrap.hidden = false;
    const { ctx, width, height } = fitCanvas(lensPlot);
    const c = themeColors();
    ctx.clearRect(0, 0, width, height);
    const F = new Frame(ctx, width, height, { left: 34, right: 8, top: 18, bottom: 34 });
    F.x0 = -1; F.x1 = 5; F.y0 = -2; F.y1 = 5;
    const s = (e.z - before.zw) / f, Z = before.zR / f;
    F.clip();
    ctx.strokeStyle = c.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(F.X(1), F.top); ctx.lineTo(F.X(1), F.bottom); ctx.moveTo(F.left, F.Y(1)); ctx.lineTo(F.right, F.Y(1)); ctx.stroke();
    const curve = (fn, color, dash) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(dash); ctx.beginPath();
      let pen = false;
      for (let k = 0; k <= 400; k++) {
        const S = F.x0 + ((F.x1 - F.x0) * k) / 400, v = fn(S);
        if (!Number.isFinite(v) || v > 12 || v < -12) { pen = false; continue; }
        if (!pen) { ctx.moveTo(F.X(S), F.Y(v)); pen = true; } else ctx.lineTo(F.X(S), F.Y(v));
      }
      ctx.stroke(); ctx.setLineDash([]);
    };
    curve((S) => S / (S - 1), c.ink3, [5, 4]);
    curve((S) => lensLaw(S, Z, 1).s2, c.accent, []);
    const S2 = lensLaw(s, Z, 1).s2;
    if (s > F.x0 && s < F.x1 && S2 > F.y0 && S2 < F.y1) {
      ctx.fillStyle = c.warn; ctx.beginPath(); ctx.arc(F.X(s), F.Y(S2), 5, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.restore();
    F.axes({ xlabel: 's/f: the waist was this far before the lens', colors: c });
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = c.ink2; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`s′/f: the new waist this far after it (z_R/f = ${fmt(Z, 2)})`, 4, 12);
    ctx.textAlign = 'right'; ctx.fillStyle = c.ink3;
    ctx.fillText('rays: dashed', F.right, F.top + 12);
  }

  // View controls.
  const fieldSeg = segmented([
    { value: 'real', label: 'Crests', title: 'The field itself (its real part), moving' },
    { value: 'intensity', label: 'Intensity', title: 'The intensity |E|²' },
    { value: 'phase', label: 'Phase', title: 'The phase relative to a plane wave, as colour (brightness: amplitude)' },
    { value: 'off', label: 'Off', title: 'Only the outline ±w(z)' },
  ], state.field, (v) => { state.field = v; changed(false); app.animate(); }, { label: 'Field' });
  $('#field-box').append(fieldSeg);
  const playButton = el('button', { type: 'button', class: 'primary', title: 'Start or stop the crests (space)', onclick: () => setPlay(!state.play) }, 'Pause');
  function setPlay(on) { state.play = on; playButton.textContent = on ? 'Pause' : 'Play'; app.animate(); }
  const wfToggle = toggle('Wavefronts', state.wavefronts, (on) => { state.wavefronts = on; changed(false); }, 'Arcs of radius R(z), the shape of the crests');
  $('#view-buttons').append(playButton, wfToggle,
    el('button', { type: 'button', title: 'Show the whole bench', onclick: () => { fit(); changed(); } }, 'Fit'),
    el('button', { type: 'button', title: 'Zoom in on the narrowest waist', onclick: () => { zoomToFocus(); changed(); } }, 'Focus'));
  const mSlider = slider({ label: 'mode m', min: 0, max: 6, step: 1, value: state.m, title: 'Send the Hermite-Gauss mode HG_m0 instead of the fundamental',
    onInput: (v) => { state.m = Math.round(v); changed(false); } });
  const eSlider = slider({ label: 'wider ×', min: 1, max: 100000, log: true, value: state.E, title: 'How many times wider than it is the beam is drawn',
    onInput: (v) => { state.E = v; changed(false); } });
  const bSlider = slider({ label: 'brightness', min: -2, max: 2, step: 0.01, value: state.bright, title: 'The brightness scale is squeezed, so that a focus does not outshine the rest: it is brighter than it looks',
    onInput: (v) => { state.bright = v; requestDraw(); app.hashSoon(); } });
  $('#view-box').append(mSlider, eSlider, bSlider);

  // Mode matching.
  const targetToggle = toggle('Show a cavity to match', state.target, (on) => { state.target = on; if (on && !(state.tz > state.vz0 && state.tz < state.vz1)) state.tz = +(state.vz0 + 0.6 * (state.vz1 - state.vz0)).toPrecision(4); buildTarget(); changed(false); },
    'The mode of the cavity in the Cavity view, placed on the bench: steer the beam into it');
  $('#target-box').append(targetToggle);
  let tzSlider = null;
  function buildTarget() {
    const box = $('#target-more');
    if (!state.target) { box.replaceChildren(el('div', { class: 'small muted' }, 'The cavity of the Cavity view, placed on the bench; the fraction of the beam\'s power that goes into its mode is η.')); tzSlider = null; return; }
    const c = app.state.cavity;
    tzSlider = slider({ label: 'cavity at (mm)', min: state.vz0, max: state.vz1, step: 0.1, value: state.tz, title: 'Where its first mirror is',
      onInput: (v) => { state.tz = v; changed(false); } });
    box.replaceChildren(tzSlider, el('div', { class: 'small muted' },
      `R₁ = ${fmtLen(c.R1)}, R₂ = ${fmtLen(c.R2)}, L = ${fmtLen(c.L)} (change them in the Cavity view). The input mirror is taken to be thin, with no lens effect.`));
  }

  function setCrestNote() {
    const crest = lam() * state.E * state.E, px = frame ? (crest * frame.w) / (state.vz1 - state.vz0) : 10;
    $('#crest-note').textContent = state.field === 'real'
      ? `The crests are drawn ${fmtLen(crest)} apart (really ${fmtLen(lam())}): a beam drawn ${fmt(state.E, 3)} times wider is a beam with a wavelength ${fmt(state.E * state.E, 3)} times longer, and only so do the crests keep their true curvature and Gouy shift.`
        + (px < 4 ? ' Here they are too close together to draw: zoom in, or draw the beam wider.' : '')
      : '';
  }

  // ------------------------------------------------------------------- pointer and keys

  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  function hitTest(p) {
    if (!frame) return null;
    const F = frame, yc = F.top + F.h / 2, sx = sxNow(), sy = state.E * sx;
    if (p.y < 0 || p.y > F.bottom) return null;
    // The input waist's handle.
    if (state.z0 >= state.vz0 && state.z0 <= state.vz1 && Math.hypot(p.x - F.X(state.z0), p.y - (yc - state.w0 * sy)) < 11) return { kind: 'input' };
    let best = null, bd = 12;
    const order = state.sel ? [state.sel, ...state.elements.filter((e) => e !== state.sel)] : state.elements;
    for (const e of order) {
      const d = e.type === 'slab' ? (p.x >= F.X(e.z) - 6 && p.x <= F.X(e.z + e.t) + 6 ? Math.min(Math.abs(p.x - F.X(e.z)), Math.abs(p.x - F.X(e.z + e.t)), 6) : Infinity) : Math.abs(p.x - F.X(e.z));
      if (d < bd) { bd = d; best = e; }
    }
    if (best) return { kind: 'element', el: best };
    const t = target();
    if (t && (Math.abs(p.x - F.X(t.z)) < 10 || Math.abs(p.x - F.X(t.z + t.L)) < 10)) return { kind: 'target' };
    return null;
  }

  function snap(z) {
    const step = 10 ** Math.floor(Math.log10((state.vz1 - state.vz0) / 400));
    return +(Math.round(z / step) * step).toPrecision(8);
  }

  canvas.addEventListener('pointerdown', (ev) => {
    const p = local(ev);
    canvas.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      drag = { kind: 'pinch', d0: Math.abs(a.x - b.x) + 1, span: state.vz1 - state.vz0, mid: frame.invX((a.x + b.x) / 2) };
      return;
    }
    const hit = hitTest(p);
    if (hit?.kind === 'element') {
      if (state.sel !== hit.el) select(hit.el);
      drag = { kind: 'element', el: hit.el, off: frame.invX(p.x) - hit.el.z };
    } else if (hit?.kind === 'input') drag = { kind: 'input', off: frame.invX(p.x) - state.z0 };
    else if (hit?.kind === 'target') drag = { kind: 'target', off: frame.invX(p.x) - state.tz };
    else drag = { kind: 'pan', x: p.x, vz0: state.vz0, vz1: state.vz1, moved: false };
    hover = null;
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (ev) => {
    const p = local(ev);
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, p);
    if (!drag) {
      if (!frame) return;
      const hit = hitTest(p);
      canvas.style.cursor = hit ? (hit.kind === 'input' ? 'move' : 'ew-resize') : 'grab';
      hover = p.x >= frame.left && p.x <= frame.right && p.y >= frame.top && p.y <= frame.bottom ? frame.invX(p.x) : null;
      requestDraw(true);
      return;
    }
    if (drag.kind === 'pinch') {
      if (pointers.size < 2) return;
      const [a, b] = [...pointers.values()];
      const span = (drag.span * drag.d0) / (Math.abs(a.x - b.x) + 1);
      zoomTo(drag.mid - span / 2, drag.mid + span / 2);
      return;
    }
    const z = frame.invX(p.x);
    if (drag.kind === 'element') { drag.el.z = snap(z - drag.off); changed(); }
    else if (drag.kind === 'input') {
      state.z0 = snap(z - drag.off);
      const sy = state.E * sxNow(), x = Math.abs(frame.top + frame.h / 2 - p.y) / sy;
      state.w0 = Math.max(0.002, +x.toPrecision(3));
      changed();
    } else if (drag.kind === 'target') { state.tz = snap(z - drag.off); changed(false); }
    else if (drag.kind === 'pan') {
      const dz = (p.x - drag.x) / sxNow();
      if (Math.abs(p.x - drag.x) > 3) drag.moved = true;
      state.vz0 = drag.vz0 - dz; state.vz1 = drag.vz1 - dz;
      changed();
    }
  });
  const end = (ev) => {
    pointers.delete(ev.pointerId);
    if (drag?.kind === 'pan' && !drag.moved && state.sel) select(null);
    if (pointers.size === 0) { drag = null; canvas.classList.remove('dragging'); syncControls(); requestDraw(); }
    else if (drag?.kind === 'pinch') drag = { kind: 'pan', x: [...pointers.values()][0].x, vz0: state.vz0, vz1: state.vz1, moved: true };
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (!drag) { hover = null; requestDraw(true); } });
  canvas.addEventListener('wheel', (ev) => {
    if (!frame) return;
    ev.preventDefault();
    const z = frame.invX(local(ev).x), k = Math.exp(ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0015));
    zoomTo(z - (z - state.vz0) * k, z + (state.vz1 - z) * k);
  }, { passive: false });
  canvas.addEventListener('keydown', (ev) => {
    const e = state.sel;
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && e) { removeElement(e); ev.preventDefault(); }
    else if ((ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && e) {
      e.z = snap(e.z + (ev.key === 'ArrowLeft' ? -1 : 1) * (state.vz1 - state.vz0) / (ev.shiftKey ? 20 : 200));
      changed(); ev.preventDefault();
    } else if (ev.key === ' ') { setPlay(!state.play); ev.preventDefault(); }
  });

  function zoomTo(a, b) {
    if (!(b - a > 0.01) || b - a > 1e5) return;
    state.vz0 = a; state.vz1 = b;
    changed();
  }

  // ------------------------------------------------------------------- fitting the view

  /** The whole bench in view, and the beam filling 80% of the height at its widest. */
  function fit() {
    const zs = [];
    for (const e of state.elements) { zs.push(e.z); if (e.type === 'slab') zs.push(e.z + e.t); }
    const tr0 = traceBench({ lambda: lam(), w0: state.w0, z0: state.z0 }, state.elements, -1e9, 1e9);
    const ws = waists(tr0).filter((w) => w.real && Math.abs(w.z) < 1e6);
    if (state.target) { zs.push(state.tz, state.tz + app.state.cavity.L); }
    let a, b;
    if (zs.length) {
      a = Math.min(...zs); b = Math.max(...zs);
      for (const w of ws) { a = Math.min(a, w.z); b = Math.max(b, w.z); }
      a = Math.min(a, Math.max(state.z0, a - 0.5 * (b - a + 50)));
      const pad = 0.12 * (b - a) + 10;
      a -= pad; b += pad;
    } else {
      const zR = (Math.PI * state.w0 ** 2) / lam(), span = Math.min(2000, Math.max(20, 3 * zR));
      a = state.z0 - span; b = state.z0 + span;
    }
    state.vz0 = +a.toPrecision(4); state.vz1 = +b.toPrecision(4);
    fitHeight(0.8);
  }
  function fitHeight(frac) {
    if (!frame) layout();
    const tr = traceBench({ lambda: lam(), w0: state.w0, z0: state.z0 }, state.elements, state.vz0, state.vz1);
    let wmax = 0;
    for (let k = 0; k <= 200; k++) wmax = Math.max(wmax, beamAt(tr, state.vz0 + ((state.vz1 - state.vz0) * k) / 200).w);
    const sx = frame.w / (state.vz1 - state.vz0);
    state.E = +Math.max(1, Math.min(1e6, (frac * frame.h) / 2 / (wmax * (1 + 0.6 * state.m ** 0.5)) / sx)).toPrecision(3);
  }
  function zoomToFocus() {
    retrace();
    const ws = waists(trace).filter((w) => w.real);
    if (!ws.length) return;
    const w = ws.reduce((a, b) => (b.w0 < a.w0 ? b : a));
    state.vz0 = +(w.z - 4 * w.zR).toPrecision(5); state.vz1 = +(w.z + 4 * w.zR).toPrecision(5);
    fitHeight(0.85);
  }

  // ------------------------------------------------------------------- bookkeeping

  let pending = 0, light = true;
  /** Redraw at the next frame; light: the waist table hasn't changed. */
  function requestDraw(onlyHover = false) {
    light = light && onlyHover;
    if (pending || app.state.view !== 'bench') return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      if (light) { drawBench(); drawGouy(); readout(); } else draw();
      light = true;
    });
  }
  /** Something changed: recompute, redraw, remember it in the address. */
  function changed(syncSliders = true) {
    retrace();
    if (syncSliders && !drag) syncControls();
    else { buildChips(); if (editorSliders.z && state.sel) editorSliders.z.value = state.sel.z; }
    setCrestNote();
    requestDraw();
    elementInfoSoon();
    app.hashSoon();
  }
  let infoTimer = 0;
  function elementInfoSoon() { clearTimeout(infoTimer); infoTimer = setTimeout(() => { if (trace) elementInfo(); }, 30); }

  function syncControls() {
    lambdaSlider.value = state.lambda; w0Slider.value = state.w0 * 1000; z0Slider.value = state.z0;
    fieldSeg.value = state.field; mSlider.value = state.m; eSlider.value = state.E; wfToggle.on = state.wavefronts; bSlider.value = state.bright;
    targetToggle.on = state.target;
    playButton.textContent = state.play ? 'Pause' : 'Play';
    if (tzSlider) tzSlider.value = state.tz;
    buildChips();
    if (state.sel && editorSliders.z) {
      editorSliders.z.setRange(Math.min(state.vz0, state.sel.z), Math.max(state.vz1, state.sel.z));
      editorSliders.z.value = state.sel.z;
    }
    setCrestNote();
  }

  /** One animation frame: move the crests.  Returns true while there is something to animate. */
  function tick(dt) {
    if (!(state.play && state.field === 'real')) return false;
    phase += 2 * Math.PI * CREST_RATE * dt;
    if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
    if (!pending) drawBench();
    return true;
  }

  // ------------------------------------------------------------------- the address

  const typeCode = { lens: 'L', mirror: 'M', slab: 'S' };
  function toHash() {
    const r = (v) => (Number.isFinite(v) ? +v.toPrecision(6) : 'flat');
    const els = state.elements.map((e) => typeCode[e.type] + [r(e.z), ...(e.type === 'lens' ? [r(e.f)] : e.type === 'mirror' ? [r(e.R)] : [r(e.t), r(e.n)])].join(':')).join(',');
    return {
      lam: r(state.lambda), w0: r(state.w0), z0: r(state.z0), el: els || 'none', E: r(state.E),
      zr: `${r(state.vz0)}:${r(state.vz1)}`, fld: state.field, m: state.m || undefined, wf: state.wavefronts ? 1 : undefined,
      tgt: state.target ? r(state.tz) : undefined, sel: state.sel ? state.elements.indexOf(state.sel) : undefined,
      br: state.bright ? r(state.bright) : undefined,
    };
  }
  function fromHash(h) {
    const num = (s, d) => (s === 'flat' ? Infinity : Number.isFinite(+s) && s !== '' && s !== undefined ? +s : d);
    if (h.lam) state.lambda = Math.max(100, Math.min(20000, num(h.lam, state.lambda)));
    if (h.w0) state.w0 = Math.max(1e-4, num(h.w0, state.w0));
    if (h.z0) state.z0 = num(h.z0, state.z0);
    if (h.el) {
      const els = [];
      for (const part of h.el.split(',')) {
        const t = { L: 'lens', M: 'mirror', S: 'slab' }[part[0]];
        if (!t) continue;
        const v = part.slice(1).split(':').map((s) => num(s, NaN));
        if (!Number.isFinite(v[0])) continue;
        if (t === 'lens' && Number.isFinite(v[1]) && v[1] !== 0) els.push({ type: t, z: v[0], f: v[1] });
        if (t === 'mirror' && v[1] !== 0 && !Number.isNaN(v[1])) els.push({ type: t, z: v[0], R: v[1] });
        if (t === 'slab' && v[1] > 0 && v[2] >= 1) els.push({ type: t, z: v[0], t: v[1], n: v[2] });
      }
      state.elements = els.slice(0, MAX_ELEMENTS);
    }
    if (h.E) state.E = Math.max(1, num(h.E, state.E));
    if (h.zr) { const [a, b] = h.zr.split(':').map(Number); if (b > a) { state.vz0 = a; state.vz1 = b; } }
    if (['real', 'intensity', 'phase', 'off'].includes(h.fld)) state.field = h.fld;
    state.m = Math.max(0, Math.min(6, Math.round(num(h.m, 0))));
    state.wavefronts = h.wf === '1';
    state.target = h.tgt !== undefined;
    if (state.target) state.tz = num(h.tgt, state.tz);
    state.sel = h.sel !== undefined ? state.elements[+h.sel] || null : null;
    state.bright = Math.max(-2, Math.min(2, num(h.br, 0)));
  }

  /** Put a whole set-up on the bench. */
  function load(cfg) {
    Object.assign(state, {
      lambda: 633, w0: 0.5, z0: 0, elements: [], field: 'real', m: 0, wavefronts: false, target: false, sel: null, bright: 0,
    }, cfg);
    state.elements = (cfg.elements || []).map((e) => ({ ...e }));
    state.sel = cfg.select !== undefined ? state.elements[cfg.select] : null;
    if (cfg.view) { state.vz0 = cfg.view[0]; state.vz1 = cfg.view[1]; }
    else fit();
    if (cfg.E) state.E = cfg.E; else if (cfg.view) fitHeight(cfg.fill || 0.8);
    if (cfg.focus) zoomToFocus();
    retrace();
    buildEditor(); buildTarget(); syncControls();
    setPlay(cfg.play ?? true);
    draw();
    app.hashSoon();
  }

  function show() { retrace(); buildEditor(); buildTarget(); syncControls(); draw(); }

  window.addEventListener('resize', () => { if (app.state.view === 'bench') draw(); });

  return {
    show, draw, tick, toHash, fromHash, load, fit, zoomToFocus,
    get trace() { return trace; }, matching, addElement, removeElement, select,
    get frame() { return frame; }, get field() { return field; }, drawBench, hitTest, computeField: () => { version++; layout(); return computeField(); },
    refreshTarget: () => { buildTarget(); retrace(); },
  };
}
