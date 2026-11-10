// View 2 · A slice: slice selection.  A gradient Gz along the body makes the Larmor frequency
// rise with height; a shaped pulse (a sinc) contains only the frequencies f0 + fc +- Δf/2, so
// it tips only the spins whose frequency lies in that band: a slab Δz = Δf / (GB Gz) thick at
// z = fc / (GB Gz).  The picture is a graphical construction: the pulse's spectrum (a box) sends
// a band down onto the line f = GB Gz z, and where they cross a slab goes across to the head,
// lit by the spins it has tipped.  Beside it, the spins across the slab, magnified, and the
// slice seen from above.  z is drawn upwards, along B0, so a spin at rest points up.

import { GB, TWO_PI, sliceMovie, pulseSpectrum, fwhm } from './bloch.js';
import { head3D, sliceOf, tissueAt3D, tissueAtPoint, TISSUES } from './phantom.js';
import { el, $, slider, toggle, setSlots } from '../lib/ui.js';
import { fitCanvas, themeColors, fillSlots, niceTicks, tickLabel } from '../lib/plot.js';
import { arrow, handle, cssComplex, FONT, SMALL, BOLD, haloText } from './draw.js';
import { colorOf } from '../lib/complexcolor.js';

export const ZMAX = 125, FMAX = 25;
const NZ = 501, ZS = Float64Array.from({ length: NZ }, (_, i) => -ZMAX + (2 * ZMAX * i) / (NZ - 1));
const HOLD = 2.5, BEFORE = 0.6;           // seconds of the page's clock after a run, and before it

const HEAD = head3D();
// The head from the side (the plane x = 0): y across (front to the right), z up; tissue per pixel.
const SIDE = { ny: 120, nz: 125, dy: 2, dz: 2 };
SIDE.t = (() => {
  const out = new Array(SIDE.ny * SIDE.nz);
  for (let j = 0; j < SIDE.nz; j++) for (let i = 0; i < SIDE.ny; i++) {
    const y = -120 + (i + 0.5) * SIDE.dy, z = ZMAX - (j + 0.5) * SIDE.dz;
    out[j * SIDE.ny + i] = tissueAt3D(HEAD, 0, y, z);
  }
  return out;
})();
const RGB = Object.fromEntries(Object.entries(TISSUES).map(([k, t]) => [k, [1, 3, 5].map((o) => parseInt(t.colour.slice(o, o + 2), 16))]));

export class SliceView {
  constructor(app) {
    this.app = app;
    this.canvas = $('#v2-main');
    this.s = { Gz: 4, bw: 1.5, fc: 0, T: 3, flip: 90, rephase: true, slow: 1.5, playing: true };
    this.clock = { stage: 'run', t: 1.2, wait: 0 };
    this.drag = null;
    this.buildControls();
    this.recompute();
    this.bindPointer();
  }

  get centre() { return this.s.fc / (GB * this.s.Gz); }
  get thickness() { return this.s.bw / (GB * this.s.Gz); }
  get Tend() { return 1.5 * this.s.T; }

  recompute() {
    const s = this.s;
    this.movie = sliceMovie({ Gz: s.Gz, bw: s.bw, T: s.T, flip: (s.flip * Math.PI) / 180, fc: s.fc, rephase: s.rephase, zs: ZS, frames: 120 });
    const last = this.movie.mx.length - 1, mxy = Float64Array.from(this.movie.mx[last], (v, i) => Math.hypot(v, this.movie.my[last][i]));
    this.measured = fwhm(ZS, mxy);
    // The slice for the other views: its centre and thickness.
    this.app.slice = { z: this.centre, thickness: this.thickness };
    this.axial = null;
    this.clock.t = Math.min(this.clock.t, this.Tend);
    this.dirty = true;
    this.app.scheduleHash();
  }

  /** The column's state at the time t (ms), interpolated between the movie's frames. */
  stateAt(t) {
    const m = this.movie, f = Math.max(0, Math.min(m.times.length - 1, (t / m.Tend) * (m.times.length - 1)));
    const i = Math.min(m.times.length - 2, Math.floor(f)), u = f - i;
    const mix = (A) => Float32Array.from(A[i], (v, k) => v + (A[i + 1][k] - v) * u);
    return { mx: mix(m.mx), my: mix(m.my), mz: mix(m.mz) };
  }

  advance(dt) {
    const c = this.clock;
    if (!this.s.playing) return;
    if (c.stage === 'before') { c.wait -= dt; if (c.wait <= 0) { c.stage = 'run'; c.t = 0; } }
    else if (c.stage === 'run') { c.t += dt / this.s.slow; if (c.t >= this.Tend) { c.t = this.Tend; c.stage = 'hold'; c.wait = HOLD; } }
    else { c.wait -= dt; if (c.wait <= 0) this.again(); }
    this.dirty = true;
  }
  again() { Object.assign(this.clock, { stage: 'before', t: 0, wait: BEFORE }); this.dirty = true; }
  get animating() { return this.s.playing; }
  get tNow() { return this.clock.stage === 'before' ? 0 : this.clock.t; }

  // ------------------------------------------------------------------- controls

  buildControls() {
    const s = this.s, set = (k) => (v) => { s[k] = v; this.recompute(); };
    this.sl = {
      fc: slider({ label: 'centre f_c (kHz)', min: -15, max: 15, step: 0.01, value: s.fc, title: 'The pulse\'s frequency, above f₀: it picks the height of the slice', onInput: set('fc') }),
      bw: slider({ label: 'band Δf (kHz)', min: 0.25, max: 4, step: 0.01, value: s.bw, title: 'The range of frequencies the pulse contains: it sets the slice\'s thickness', onInput: set('bw') }),
      Gz: slider({ label: 'gradient G_z (mT/m)', min: 1, max: 8, step: 0.01, value: s.Gz, title: 'How fast the field rises along the body while the pulse is on', onInput: set('Gz') }),
      T: slider({ label: 'pulse length (ms)', min: 1, max: 8, step: 0.1, value: s.T, title: 'How long the pulse lasts: a longer sinc has more lobes and a sharper edge to its band', onInput: set('T') }),
      flip: slider({ label: 'tip angle (°)', min: 10, max: 180, step: 1, value: s.flip, title: 'How far the pulse tips the spins at the centre of its band', onInput: set('flip') }),
    };
    $('#v2-slice-box').append(this.sl.fc, this.sl.bw, this.sl.Gz);
    this.playBtn = el('button', { type: 'button', class: 'primary play', title: 'Pause or go on (space bar)', onclick: () => this.setPlaying(!s.playing) }, 'Pause');
    $('#v2-play-row').append(this.playBtn, el('button', { type: 'button', title: 'Send the pulse again', onclick: () => { this.again(); this.setPlaying(true); } }, 'Pulse again'));
    this.speed = slider({ label: 'slow motion', min: 0.25, max: 10, log: true, value: s.slow, title: 'Seconds of the page for one millisecond of the spins', onInput: (v) => { s.slow = v; this.app.scheduleHash(); } });
    $('#v2-speed-box').append(this.speed);
    this.rephaseBtn = toggle('Rephasing lobe', s.rephase, (on) => { s.rephase = on; this.recompute(); }, 'After the pulse, turn the gradient the other way for half the pulse\'s length: it undoes the twist the gradient gave the slab');
    $('#v2-rephase-row').append(this.rephaseBtn);
    $('#v2-more-box').append(this.sl.T, this.sl.flip);
  }
  setPlaying(on) { this.s.playing = on; this.playBtn.textContent = on ? 'Pause' : 'Play'; this.app.kick(); }

  set(o) {
    const s = this.s;
    for (const k of ['Gz', 'bw', 'fc', 'T', 'flip', 'rephase', 'slow']) if (o[k] !== undefined) s[k] = o[k];
    for (const k of Object.keys(this.sl)) this.sl[k].value = s[k];
    this.speed.value = s.slow; this.rephaseBtn.on = s.rephase;
    this.setPlaying(o.playing ?? true);
    this.recompute();
    if (o.t !== undefined) Object.assign(this.clock, { stage: 'run', t: Math.min(o.t, this.Tend) }); else this.again();
  }
  toHash() {
    const s = this.s, r = (v) => +(+v).toPrecision(4);
    return { Gz: r(s.Gz), bw: r(s.bw), fc: r(s.fc), T: s.T !== 3 ? r(s.T) : undefined, flip: s.flip !== 90 ? s.flip : undefined, rp: s.rephase ? undefined : 0, sl: s.slow !== 1.5 ? r(s.slow) : undefined };
  }
  fromHash(h) {
    const num = (v, d, lo = -Infinity, hi = Infinity) => (v !== undefined && Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);
    this.set({ Gz: num(h.Gz, 4, 0.5, 20), bw: num(h.bw, 1.5, 0.05, 10), fc: num(h.fc, 0, -40, 40), T: num(h.T, 3, 0.5, 20), flip: num(h.flip, 90, 1, 360), rephase: h.rp !== '0', slow: num(h.sl, 1.5, 0.1, 50) });
  }

  // ------------------------------------------------------------------- layout

  layout(W, H) {
    const narrow = W < 700;
    if (narrow) {
      const L = 44, R = 10, x1 = W - R;
      const seq = { x0: L, x1, y0: 26, y1: 130 };
      const spec = { x0: L, x1, y0: seq.y1 + 30, y1: seq.y1 + 100 };
      const cons = { x0: L, x1, y0: spec.y1 + 8, y1: spec.y1 + 8 + Math.round(0.36 * H) };
      const side = { x0: L, x1: L + Math.round(0.5 * (x1 - L)), y0: cons.y1 + 54, y1: H - 196 };
      const mag = { x0: side.x1 + 30, x1, y0: side.y0, y1: side.y1 };
      const axial = { x0: L, y0: H - 170, s: 150 };
      return { narrow, W, H, seq, spec, cons, side, mag, axial, sameZ: false };
    }
    const L = 50, wl = Math.round(0.44 * W), top = 26;
    const seq = { x0: L, x1: L + wl, y0: top, y1: top + 104 };
    const spec = { x0: L, x1: L + wl, y0: seq.y1 + 34, y1: seq.y1 + 112 };
    const cons = { x0: L, x1: L + wl, y0: spec.y1 + 10, y1: H - 40 };
    const side = { x0: cons.x1 + 26, x1: cons.x1 + 26 + Math.round(0.25 * W), y0: cons.y0, y1: cons.y1 };
    const mag = { x0: side.x1 + 44, x1: W - 14, y0: cons.y0, y1: cons.y1 };
    const s = Math.min(spec.y1 - top, side.x1 - side.x0);
    const axial = { x0: side.x0 + (side.x1 - side.x0 - s) / 2, y0: top + 4, s };
    return { narrow, W, H, seq, spec, cons, side, mag, axial, sameZ: true };
  }
  Fx(f) { const b = this.lay.cons; return b.x0 + ((f + FMAX) / (2 * FMAX)) * (b.x1 - b.x0); }
  invFx(px) { const b = this.lay.cons; return -FMAX + ((px - b.x0) / (b.x1 - b.x0)) * 2 * FMAX; }
  Z(z, b = this.lay.cons) { return b.y0 + ((ZMAX - z) / (2 * ZMAX)) * (b.y1 - b.y0); }
  invZ(py, b = this.lay.cons) { return ZMAX - ((py - b.y0) / (b.y1 - b.y0)) * 2 * ZMAX; }
  /** The magnified range of z about the slice. */
  get magRange() { const h = Math.max(12, 2.6 * this.thickness); return [this.centre - h, this.centre + h]; }

  // ------------------------------------------------------------------- drawing

  draw() {
    const { ctx, width: W, height: H } = fitCanvas(this.canvas);
    const c = { ...themeColors(), ...this.app.colors };
    this.lay = this.layout(W, H);
    ctx.clearRect(0, 0, W, H);
    this.st = this.stateAt(this.tNow);
    this.drawSequence(ctx, c);
    this.drawPulseSpectrum(ctx, c);
    this.drawConstruction(ctx, c);
    this.drawSide(ctx, c);
    this.drawMagnified(ctx, c);
    this.drawAxial(ctx, c);
    this.readout();
    this.dirty = false;
  }

  /** The RF and Gz against time, with the moment now. */
  drawSequence(ctx, c) {
    const b = this.lay.seq, s = this.s, Tend = this.Tend, p = this.movie.pulse;
    const X = (t) => b.x0 + (t / Tend) * (b.x1 - b.x0);
    const rows = [{ name: 'RF', y0: b.y0, y1: b.y0 + 0.5 * (b.y1 - b.y0 - 18) }, { name: 'G_z', y0: b.y0 + 0.5 * (b.y1 - b.y0 - 18) + 6, y1: b.y1 - 18 }];
    ctx.save();
    ctx.font = BOLD; ctx.fillStyle = c.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(this.lay.narrow ? 'The pulse and the gradient' : 'The pulse, and the gradient while it plays', b.x0, b.y0 - 10);
    ctx.font = SMALL; ctx.textBaseline = 'middle';
    let top = 0;
    for (const v of p.b1) top = Math.max(top, Math.abs(v));
    rows.forEach((r, k) => {
      const ym = (r.y0 + r.y1) / 2, hh = (r.y1 - r.y0) / 2 - 2;
      ctx.fillStyle = c.ink2; ctx.textAlign = 'right'; ctx.fillText(r.name === 'G_z' ? 'G_z' : 'RF', b.x0 - 6, ym);
      ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(b.x0, ym); ctx.lineTo(b.x1, ym); ctx.stroke();
      if (k === 0) {
        ctx.strokeStyle = c.accent; ctx.fillStyle = c.accent; ctx.globalAlpha = 0.18; ctx.beginPath(); ctx.moveTo(X(0), ym);
        for (let i = 0; i < p.b1.length; i++) ctx.lineTo(X(p.t[i]), ym - (p.b1[i] / top) * hh);
        ctx.lineTo(X(s.T), ym); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
        ctx.lineWidth = 1.8; ctx.beginPath();
        for (let i = 0; i < p.b1.length; i++) { const x = X(p.t[i]), y = ym - (p.b1[i] / top) * hh; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
        ctx.fillStyle = c.ink2; ctx.textAlign = 'left';
        if (!this.lay.narrow) fillSlots(ctx, ['a sinc, peak ', { v: (top / GB) * 1e-3 * 1e3, dec: 1, w: 5 }, ' µT, at f₀ + f_c'], X(s.T) + 8, ym - hh * 0.4);
      } else {
        const g = (t) => (t < s.T ? 1 : s.rephase ? -1 : 0);
        ctx.fillStyle = c.field; ctx.globalAlpha = 0.25;
        ctx.fillRect(X(0), ym - hh * 0.8, X(s.T) - X(0), hh * 0.8);
        if (s.rephase) ctx.fillRect(X(s.T), ym, X(Tend) - X(s.T), hh * 0.8);
        ctx.globalAlpha = 1; ctx.strokeStyle = c.field; ctx.lineWidth = 1.8; ctx.beginPath();
        ctx.moveTo(X(0), ym); ctx.lineTo(X(0), ym - hh * 0.8); ctx.lineTo(X(s.T), ym - hh * 0.8); ctx.lineTo(X(s.T), ym + (s.rephase ? hh * 0.8 : 0));
        ctx.lineTo(X(Tend), ym + (s.rephase ? hh * 0.8 : 0)); ctx.lineTo(X(Tend), ym); ctx.stroke();
        ctx.fillStyle = c.ink2; ctx.textAlign = 'left';
        if (s.rephase && !this.lay.narrow) { ctx.textBaseline = 'bottom'; ctx.fillText('the rephasing lobe, −G_z', X(s.T) + 6, ym - 2); ctx.textBaseline = 'middle'; }
        void g;
      }
    });
    // Time axis and the moment now.
    ctx.fillStyle = c.ink2; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const v of niceTicks(0, Tend, 5)) ctx.fillText(tickLabel(v), X(v), b.y1 - 14);
    ctx.textAlign = 'right'; ctx.fillText('t (ms)', b.x1, b.y1 - 1);
    const x = X(this.tNow);
    ctx.strokeStyle = c.ink; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, b.y0); ctx.lineTo(x, b.y1 - 16); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
  }

  /** The pulse's frequencies: the tip angle it gives a spin at each frequency (small tips). */
  drawPulseSpectrum(ctx, c) {
    const b = this.lay.spec, s = this.s, n = 240;
    const fs = Float64Array.from({ length: n + 1 }, (_, i) => -FMAX + (2 * FMAX * i) / n);
    // (The pulse's spectrum and its close-up are made once per pulse: every setting makes a new
    // movie and pulse, and nothing else changes them.)
    if (this.pulseSpec?.pulse !== this.movie.pulse) {
      const span = 1.6 * s.bw, cf = Float64Array.from({ length: 81 }, (_, i) => -span + (2 * span * i) / 80);
      this.pulseSpec = { pulse: this.movie.pulse, sp: pulseSpectrum(this.movie.pulse, Float64Array.from(fs, (f) => f - s.fc)), cf, csp: pulseSpectrum(this.movie.pulse, cf) };
    }
    const sp = this.pulseSpec.sp;
    let top = 0;
    for (const v of sp) top = Math.max(top, v);
    ctx.save();
    ctx.font = BOLD; ctx.fillStyle = c.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('The frequencies in the pulse', b.x0, b.y0 - 8);
    ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0 - 1, b.y1 - b.y0 - 1);
    const Y = (v) => b.y1 - 2 - (v / top) * (b.y1 - b.y0 - 10);
    ctx.fillStyle = c.accent; ctx.globalAlpha = 0.18; ctx.beginPath(); ctx.moveTo(this.Fx(fs[0]), b.y1);
    for (let i = 0; i <= n; i++) ctx.lineTo(this.Fx(fs[i]), Y(sp[i]));
    ctx.lineTo(this.Fx(fs[n]), b.y1); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = c.accent; ctx.lineWidth = 1.8; ctx.beginPath();
    for (let i = 0; i <= n; i++) { const x = this.Fx(fs[i]), y = Y(sp[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    // The handles: the band's centre (on top) and its two edges.
    const xa = this.Fx(s.fc - s.bw / 2), xb = this.Fx(s.fc + s.bw / 2), xm = this.Fx(s.fc), yh = b.y0 + 9;
    ctx.fillStyle = c.panel; ctx.strokeStyle = c.accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(xm, yh - 7); ctx.lineTo(xm + 7, yh); ctx.lineTo(xm, yh + 7); ctx.lineTo(xm - 7, yh); ctx.closePath(); ctx.fill(); ctx.stroke();
    for (const x of [xa, xb]) { ctx.beginPath(); ctx.moveTo(x, Y(top / 2) - 7); ctx.lineTo(x, Y(top / 2) + 7); ctx.stroke(); }
    this.handles = { centre: { x: xm, y: yh }, left: { x: xa, y: Y(top / 2) }, right: { x: xb, y: Y(top / 2) } };
    ctx.font = SMALL; ctx.fillStyle = c.ink2; ctx.textAlign = xb + 90 > b.x1 ? 'right' : 'left'; ctx.textBaseline = 'middle';
    fillSlots(ctx, ['Δf = ', { v: s.bw, dec: 2, w: 4 }, ' kHz'], xb + 90 > b.x1 ? xa - 8 : xb + 8, Y(top / 2));
    // A close-up of the band, in the corner away from it: a box, Δf wide.
    const cw = Math.min(150, 0.32 * (b.x1 - b.x0)), right = s.fc < 0, cx0 = right ? b.x1 - cw - 6 : b.x0 + 6, cx1 = cx0 + cw;
    const cy0 = b.y0 + 6, cy1 = b.y1 - 6, span = 1.6 * s.bw;
    const CX = (f) => cx0 + ((f - s.fc + span) / (2 * span)) * cw, CY = (v) => cy1 - 4 - (v / top) * (cy1 - cy0 - 22);
    ctx.fillStyle = c.panel; ctx.strokeStyle = c.line; ctx.lineWidth = 1;
    ctx.fillRect(cx0, cy0, cw, cy1 - cy0); ctx.strokeRect(cx0 + 0.5, cy0 + 0.5, cw - 1, cy1 - cy0 - 1);
    const m = 80, { cf, csp } = this.pulseSpec;
    ctx.setLineDash([3, 3]); ctx.strokeStyle = c.ink3; ctx.beginPath();
    ctx.moveTo(CX(s.fc - s.bw / 2), CY(0)); ctx.lineTo(CX(s.fc - s.bw / 2), CY(top)); ctx.lineTo(CX(s.fc + s.bw / 2), CY(top)); ctx.lineTo(CX(s.fc + s.bw / 2), CY(0)); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = c.accent; ctx.lineWidth = 1.6; ctx.beginPath();
    for (let i = 0; i <= m; i++) { const x = CX(s.fc + cf[i]), y = CY(csp[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    ctx.fillStyle = c.ink2; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(this.lay.narrow ? 'close up' : 'close up: a box Δf wide', (cx0 + cx1) / 2, cy0 + 2);
    ctx.restore();
  }

  /** z against f: the field's line, the pulse's band, and where they cross, the slab. */
  drawConstruction(ctx, c) {
    const b = this.lay.cons, s = this.s, G = GB * s.Gz, z0 = this.centre, dz = this.thickness;
    ctx.save();
    ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0 - 1, b.y1 - b.y0 - 1);
    // The band: from the pulse's spectrum straight down.
    const xa = this.Fx(s.fc - s.bw / 2), xb = this.Fx(s.fc + s.bw / 2);
    ctx.fillStyle = c.accent; ctx.globalAlpha = 0.16;
    ctx.fillRect(xa, this.lay.spec.y0, xb - xa, b.y1 - this.lay.spec.y0);
    // The slab: across, from the crossing to the head.
    const ya = this.Z(z0 + dz / 2), yb = this.Z(z0 - dz / 2);
    ctx.fillStyle = c.sigIm; ctx.globalAlpha = 0.18;
    ctx.fillRect(xa, ya, (this.lay.sameZ ? this.lay.mag.x0 - 30 : b.x1) - xa, yb - ya);
    ctx.globalAlpha = 1;
    // Ticks.
    ctx.font = SMALL; ctx.fillStyle = c.ink2; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const v of niceTicks(-FMAX, FMAX, this.lay.narrow ? 5 : 6)) ctx.fillText(tickLabel(v), this.Fx(v), b.y1 + 3);
    ctx.textAlign = 'right'; ctx.fillText('f − f₀ (kHz)', b.x1, b.y1 + (this.lay.narrow ? 16 : 17));
    ctx.textBaseline = 'middle';
    for (const v of niceTicks(-ZMAX, ZMAX, 6)) ctx.fillText(tickLabel(v), b.x0 - 5, this.Z(v));
    ctx.save(); ctx.translate(12, (b.y0 + b.y1) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('z (mm), along the body', 0, 0); ctx.restore();
    // The field's line, f = GB Gz z.
    ctx.beginPath(); ctx.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.save(); ctx.clip();
    ctx.strokeStyle = c.field; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(this.Fx(-G * ZMAX), this.Z(-ZMAX)); ctx.lineTo(this.Fx(G * ZMAX), this.Z(ZMAX)); ctx.stroke();
    // Where the band meets it.
    ctx.strokeStyle = c.sigIm; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(xa, ya + (yb - ya)); ctx.lineTo(xb, ya); ctx.stroke();
    ctx.restore();
    // The line's handle: drag it to tilt it.  At the top of the plot, or where it leaves the side.
    const zh = Math.min(0.9 * ZMAX, (0.9 * FMAX) / G), hx = this.Fx(G * zh), hy = this.Z(zh);
    handle(ctx, hx, hy, 7, c.panel, c.field);
    this.handles.line = { x: hx, y: hy, z: zh };
    ctx.font = FONT; ctx.fillStyle = c.field; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    haloText(ctx, 'f = γ̄ G_z z', hx - 12, hy, c.field, c.panel);
    // Δz, beside the slab.
    ctx.fillStyle = c.ink; ctx.textAlign = 'left'; ctx.font = FONT;
    const ly = Math.max(b.y0 + 10, Math.min(b.y1 - 10, (ya + yb) / 2));
    const parts = ['Δz = ', { v: dz, dec: 2, w: 5 }, ' mm'];
    ctx.save(); ctx.font = FONT;
    const lx = Math.max(xb + 10, b.x0 + 6);
    if (lx + 90 < b.x1) { ctx.fillStyle = c.panel; ctx.globalAlpha = 0.75; ctx.fillRect(lx - 3, ly - 9, 92, 18); ctx.globalAlpha = 1; ctx.fillStyle = c.ink; fillSlots(ctx, parts, lx, ly); }
    ctx.restore();
    ctx.restore();
  }

  /** The head from the side, with the slab lit by the spins it has tipped (in the colour of their phase). */
  drawSide(ctx, c) {
    const L = this.lay, b = L.sameZ ? { ...L.side } : L.side, { ny, nz } = SIDE;
    const st = this.st, off = this.sideOff || (this.sideOff = document.createElement('canvas'));
    if (off.width !== ny || off.height !== nz) { off.width = ny; off.height = nz; }
    const octx = off.getContext('2d'), img = octx.createImageData(ny, nz), d = img.data;
    // The transverse magnetization at each row's height.
    const rowRe = new Float64Array(nz), rowIm = new Float64Array(nz);
    for (let j = 0; j < nz; j++) {
      const z = ZMAX - (j + 0.5) * SIDE.dz, u = ((z + ZMAX) / (2 * ZMAX)) * (NZ - 1), k = Math.max(0, Math.min(NZ - 2, Math.floor(u))), f = u - k;
      rowRe[j] = st.mx[k] + (st.mx[k + 1] - st.mx[k]) * f; rowIm[j] = st.my[k] + (st.my[k + 1] - st.my[k]) * f;
    }
    for (let j = 0; j < nz; j++) {
      const m = Math.hypot(rowRe[j], rowIm[j]), col = m > 0.01 ? colorOf(rowRe[j], rowIm[j], 0.5) : null, a = Math.min(1, m * 1.2);
      for (let i = 0; i < ny; i++) {
        const t = SIDE.t[j * ny + i], o = (j * ny + i) * 4;
        if (!t) { d[o + 3] = 0; continue; }
        const base = RGB[t], rho = TISSUES[t].rho;
        let r = base[0], g = base[1], bl = base[2];
        // Tissue muted; where the slab's spins are tipped, their colour, as bright as there are protons.
        r = 0.45 * r + 0.25 * 128; g = 0.45 * g + 0.25 * 128; bl = 0.45 * bl + 0.25 * 128;
        if (col && rho > 0) { const w = a * (0.35 + 0.65 * rho); r = r * (1 - w) + col[0] * w; g = g * (1 - w) + col[1] * w; bl = bl * (1 - w) + col[2] * w; }
        d[o] = r; d[o + 1] = g; d[o + 2] = bl; d[o + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    // The head's box: y from -120 to 120 across, z the same scale as the construction's (if beside it).
    const zb = L.sameZ ? L.cons : b, y0 = this.Z(ZMAX, zb), y1 = this.Z(-ZMAX, zb);
    const wpx = Math.min(b.x1 - b.x0, ((y1 - y0) / (2 * ZMAX)) * 240), x0 = b.x0 + (b.x1 - b.x0 - wpx) / 2;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, x0, y0, wpx, y1 - y0);
    this.sideBox = { x0, x1: x0 + wpx, y0, y1 };
    ctx.font = BOLD; ctx.fillStyle = c.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    if (!L.sameZ) ctx.fillText('The head from the side', b.x0, b.y0 - 8);
    ctx.font = SMALL; ctx.fillStyle = c.ink2; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(L.narrow ? 'click to move the slice' : 'the head from the side (click to move the slice)', (x0 + x0 + wpx) / 2, y1 + 3);
    ctx.fillText('back       front', (x0 + x0 + wpx) / 2, y1 + 16);
    // The slab's edges.
    const z0 = this.centre, dz = this.thickness;
    ctx.strokeStyle = c.sigIm; ctx.lineWidth = 1; ctx.setLineDash([3, 2]);
    for (const z of [z0 - dz / 2, z0 + dz / 2]) { const y = this.Z(z, zb); ctx.beginPath(); ctx.moveTo(x0 - 6, y); ctx.lineTo(x0 + wpx + 6, y); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.restore();
  }

  /** The spins across the slab, magnified: arrows (up along B0, or tipped over), and the profile. */
  drawMagnified(ctx, c) {
    const L = this.lay, b = L.mag, [za, zb] = this.magRange, st = this.st;
    const Y = (z) => b.y0 + ((zb - z) / (zb - za)) * (b.y1 - b.y0);
    const at = (z, A) => { const u = ((z + ZMAX) / (2 * ZMAX)) * (NZ - 1), k = Math.max(0, Math.min(NZ - 2, Math.floor(u))), f = u - k; return A[k] + (A[k + 1] - A[k]) * f; };
    ctx.save();
    ctx.font = BOLD; ctx.fillStyle = c.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(L.narrow ? 'The spins, magnified' : 'The spins across the slice', b.x0, b.y0 - 8);
    ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0 - 1, b.y1 - b.y0 - 1);
    // The zoom: lines from the magnified range to where it is on the head.
    if (L.sameZ && this.sideBox) {
      ctx.strokeStyle = c.ring; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(this.sideBox.x1 + 8, this.Z(zb)); ctx.lineTo(b.x0, b.y0); ctx.moveTo(this.sideBox.x1 + 8, this.Z(za)); ctx.lineTo(b.x0, b.y1); ctx.stroke(); ctx.setLineDash([]);
    }
    // The ideal slab (dashed) and the measured profile |Mxy| (filled, in its colours).
    const z0 = this.centre, dz = this.thickness, xc = b.x0 + 0.42 * (b.x1 - b.x0), A = 0.5 * (b.x1 - b.x0) - 8;
    ctx.fillStyle = c.sigIm; ctx.globalAlpha = 0.1; ctx.fillRect(b.x0, Y(z0 + dz / 2), b.x1 - b.x0, Y(z0 - dz / 2) - Y(z0 + dz / 2)); ctx.globalAlpha = 1;
    const n = Math.max(40, Math.round(b.y1 - b.y0));
    for (let i = 0; i < n; i++) {
      const z = zb - ((i + 0.5) * (zb - za)) / n, re = at(z, st.mx), im = at(z, st.my), m = Math.hypot(re, im);
      if (m < 0.01) continue;
      ctx.fillStyle = cssComplex(re, im, 0.5); ctx.globalAlpha = 0.55;
      ctx.fillRect(xc, Y(z) - (b.y1 - b.y0) / (2 * n), m * A, (b.y1 - b.y0) / n + 0.5);
    }
    ctx.globalAlpha = 1;
    // Mz, as a line.
    ctx.strokeStyle = c.ink3; ctx.lineWidth = 1.2; ctx.beginPath();
    for (let i = 0; i <= n; i++) { const z = zb - (i * (zb - za)) / n, x = xc + at(z, st.mz) * A, y = Y(z); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    // The arrows: up is along B0 (z), right is tipped into the plane; colour, the phase there.
    const na = Math.max(9, Math.min(21, Math.round((b.y1 - b.y0) / 22))), xa = b.x0 + 0.2 * (b.x1 - b.x0), La = Math.min(0.17 * (b.x1 - b.x0), 0.8 * (b.y1 - b.y0) / na);
    for (let i = 0; i < na; i++) {
      const z = zb - ((i + 0.5) * (zb - za)) / na, re = at(z, st.mx), im = at(z, st.my), mz = at(z, st.mz), m = Math.hypot(re, im), y = Y(z);
      ctx.strokeStyle = m > 0.05 ? cssComplex(re, im, 0.5) : c.ink2; ctx.fillStyle = ctx.strokeStyle;
      arrow(ctx, xa, y, xa + La * m, y - La * mz, 6, 2);
    }
    ctx.font = SMALL; ctx.fillStyle = c.ink2; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('spins', xa, b.y1 + 3);
    ctx.fillText(L.narrow ? '|M_xy|' : 'tipped part, |M_xy|', xc + A / 2, b.y1 + 3);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const v of niceTicks(za, zb, 4)) ctx.fillText(tickLabel(+v.toFixed(1)), b.x0 - 4, Y(v));
    ctx.restore();
  }

  /** The slice seen from above: what the next views make a picture of. */
  drawAxial(ctx, c) {
    const a = this.lay.axial, N = 96, z = this.centre;
    if (!this.axial || this.axial.z !== z) {
      const shapes = sliceOf(HEAD, z), img = new ImageData(N, N), d = img.data;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const x = -125 + ((i + 0.5) * 250) / N, y = 125 - ((j + 0.5) * 250) / N, t = tissueAtPoint(shapes, x, y), o = (j * N + i) * 4;
        if (!t) { d[o + 3] = 0; continue; }
        const col = RGB[t]; d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
      }
      const off = document.createElement('canvas'); off.width = off.height = N; off.getContext('2d').putImageData(img, 0, 0);
      this.axial = { z, off, empty: !shapes.length };
    }
    ctx.save();
    ctx.fillStyle = '#000'; ctx.fillRect(a.x0, a.y0, a.s, a.s);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.axial.off, a.x0, a.y0, a.s, a.s);
    ctx.strokeStyle = c.sigIm; ctx.lineWidth = 2; ctx.strokeRect(a.x0 + 1, a.y0 + 1, a.s - 2, a.s - 2);
    ctx.font = SMALL; ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('the slice, from above', a.x0 + 5, a.y0 + 4);
    ctx.textAlign = 'right'; fillSlots(ctx, ['z = ', { v: z, dec: 1, w: 6 }, ' mm'], a.x0 + a.s - 5, a.y0 + a.s - 16);
    if (this.axial.empty) { ctx.textAlign = 'center'; ctx.fillText(z > 0 ? '(above the head)' : '(below the head)', a.x0 + a.s / 2, a.y0 + a.s / 2); }
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillText('↑ front', a.x0 + 5, a.y0 + a.s - 3);
    ctx.restore();
  }

  readout() {
    const s = this.s, box = $('#v2-readout'), per = GB * s.Gz * 1000;
    const st = this.clock.stage, t = this.tNow;
    const lines = [
      ['The pulse holds the band f₀ + ', { v: s.fc, dec: 2, w: 6, plus: '+' }, ' kHz ± ', { v: s.bw / 2, dec: 2, w: 4 }, ' kHz; with G_z = ', { v: s.Gz, dec: 2, w: 4 }, ' mT/m (', { v: per, dec: 1, w: 5 }, ' Hz per mm) that is a slab Δz = Δf / γ̄G_z = ', { v: this.thickness, dec: 2, w: 5, class: 'b' }, ' mm thick at z = f_c / γ̄G_z = ', { v: this.centre, dec: 1, w: 6, class: 'b', plus: '+' }, ' mm.'],
      ['Measured from the spins after the pulse: ', { v: this.measured, dec: 2, w: 5, class: 'b' }, ` mm wide at half height${s.flip > 60 ? ' (a large tip widens a slab a little beyond the rule)' : ''}.`],
      st === 'before' ? ['Spins at rest, all along B₀ (up).'] : st === 'hold' ? ['Done: the slab is tipped', s.rephase ? ', and every spin in it points the same way: its phase is the same right across it.' : '; without the rephasing lobe its phase twists across it (the colours change from edge to edge).']
        : t < s.T ? ['The pulse plays: t = ', { v: t, dec: 2, w: 5 }, ' ms of ', { v: s.T, dec: 2, w: 5 }, ' ms; only the spins in the band follow it down.']
        : ['The rephasing lobe: the gradient reversed for ', { v: s.T / 2, dec: 2, w: 4 }, ' ms unwinds the twist across the slab.'],
    ];
    if (box.children.length !== lines.length) box.replaceChildren(...lines.map(() => el('div')));
    lines.forEach((l, i) => setSlots(box.children[i], l));
  }

  // ------------------------------------------------------------------- pointer

  hit(px, py) {
    const h = this.handles;
    if (!h) return null;
    if (Math.hypot(px - h.centre.x, py - h.centre.y) < 12) return { type: 'centre' };
    if (Math.abs(px - h.left.x) < 8 && Math.abs(py - h.left.y) < 16) return { type: 'left' };
    if (Math.abs(px - h.right.x) < 8 && Math.abs(py - h.right.y) < 16) return { type: 'right' };
    if (Math.hypot(px - h.line.x, py - h.line.y) < 14) return { type: 'line' };
    const sb = this.sideBox;
    if (sb && px >= sb.x0 && px <= sb.x1 && py >= sb.y0 && py <= sb.y1) return { type: 'side' };
    // The band in the spectrum or the construction: grab its middle.
    const L = this.lay, xa = this.Fx(this.s.fc - this.s.bw / 2), xb = this.Fx(this.s.fc + this.s.bw / 2);
    if (px >= xa - 3 && px <= xb + 3 && py >= L.spec.y0 && py <= L.cons.y1) return { type: 'centre' };
    return null;
  }
  bindPointer() {
    const cv = this.canvas, xy = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', (e) => {
      const [px, py] = xy(e), h = this.hit(px, py);
      if (!h) return;
      cv.setPointerCapture(e.pointerId);
      this.drag = h; this.moveDrag(px, py);
    });
    cv.addEventListener('pointermove', (e) => {
      const [px, py] = xy(e);
      if (this.drag) { this.moveDrag(px, py); return; }
      const h = this.hit(px, py);
      cv.style.cursor = !h ? 'default' : h.type === 'side' ? 'pointer' : 'ew-resize';
    });
    const end = () => { this.drag = null; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  }
  moveDrag(px, py) {
    const d = this.drag, s = this.s, f = this.invFx(px);
    if (d.type === 'centre') s.fc = Math.max(-15, Math.min(15, +f.toFixed(2)));
    else if (d.type === 'left') s.bw = Math.max(0.25, Math.min(4, +(2 * (s.fc - f)).toFixed(2)));
    else if (d.type === 'right') s.bw = Math.max(0.25, Math.min(4, +(2 * (f - s.fc)).toFixed(2)));
    else if (d.type === 'line') {
      // Keep the handle's height; the line through it and the origin sets Gz (and the slice keeps its height).
      const z = this.handles.line.z, z0 = this.centre;
      s.Gz = Math.max(1, Math.min(8, +(f / (GB * z)).toFixed(2)));
      s.fc = Math.max(-15, Math.min(15, +(GB * s.Gz * z0).toFixed(2)));
    } else if (d.type === 'side') {
      const z = this.invZ(py, this.lay.sameZ ? this.lay.cons : this.lay.side);
      s.fc = Math.max(-15, Math.min(15, +(GB * s.Gz * z).toFixed(2)));
    }
    for (const k of ['fc', 'bw', 'Gz']) this.sl[k].value = s[k];
    this.recompute();
    this.app.kick();
  }

  probe() {
    return { stage: this.clock.stage, t: this.tNow, centre: this.centre, thickness: this.thickness, measured: this.measured, handles: this.handles, sideBox: this.sideBox, lay: this.lay, s: { ...this.s } };
  }
  /** For the tests: how much in step the slab's spins end, |sum of Mxy| / sum of |Mxy|. */
  coherence() {
    const m = this.movie, L = m.mx.length - 1;
    let sr = 0, si = 0, sm = 0;
    for (let i = 0; i < NZ; i++) { sr += m.mx[L][i]; si += m.my[L][i]; sm += Math.hypot(m.mx[L][i], m.my[L][i]); }
    return Math.hypot(sr, si) / sm;
  }
}
