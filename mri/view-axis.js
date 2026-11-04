// View 1 · One axis: frequency encoding.  A row of spins along x in a field that rises along x;
// after a pi/2 pulse each turns at its own Larmor frequency, the signal (the sum of their
// arrows) is recorded, and its spectrum is the sample's profile along x: f = GB G x.
//
// The arrows are the pixels of the one-dimensional picture: 33 spins 2 mm apart across a field
// of view of 64 mm (test tubes).  The record goes on until the phase has wound to k = 0.25 per mm, when
// neighbouring arrows point opposite ways: the finest detail the record can show is 2 mm, one
// arrow's spacing (the sampling theorem, Δx = 1/2k).  A stronger gradient winds faster, so the
// record is shorter: T = k / (GB G), at most 5 ms.

import { GB, larmorMHz, TWO_PI, blocksFID, blocksProfile, partialSpectrum, lorentzOffsets } from './bloch.js';
import { el, $, slider, segmented, toggle, setSlots } from '../lib/ui.js';
import { fitCanvas, themeColors, fillSlots, niceTicks, tickLabel } from '../lib/plot.js';
import { compass, complexImage, wheel, arrow, handle, cssComplex, FONT, SMALL, BOLD } from './draw.js';

export const FOV = 64, HALF = 32, DX = 2, NSPIN = 33, KMAX = 0.25, TCAP = 5, GMAX = 5, FAXIS = 8;
const STRIP = 400;                     // columns of the phase strip
const NS = 257;                        // samples of the record
const PULSE = 0.6, HOLD = 2.5;         // seconds of the page's clock for the pulse and the pause after a record
const TAPER = 0.3;                     // the record so far is tapered over its last 30% (no ringing from the cut)

export const SAMPLES = {
  two: { label: 'Two tubes', title: 'Two tubes of water, 12 mm and 6 mm wide', pieces: [{ x: -12, w: 12, rho: 1 }, { x: 10, w: 6, rho: 1 }] },
  one: { label: 'One tube', title: 'One tube of water, 20 mm wide, at the centre', pieces: [{ x: 0, w: 20, rho: 1 }] },
  lines: { label: 'Three thin tubes', title: 'Three tubes 3 mm wide, 7 mm apart: can the record tell them apart?', pieces: [{ x: -7, w: 3, rho: 1 }, { x: 0, w: 3, rho: 1 }, { x: 7, w: 3, rho: 1 }] },
  half: { label: 'Half as dense', title: 'A tube of water and one with half as many protons that the scanner sees', pieces: [{ x: -13, w: 14, rho: 1 }, { x: 13, w: 14, rho: 0.5 }] },
};

/** The length of the record (ms) for a gradient G (mT/m): until k = KMAX, at most TCAP. */
export const recordLength = (G) => (G > 0 ? Math.min(TCAP, KMAX / (GB * G)) : TCAP);

export class AxisView {
  constructor(app) {
    this.app = app;
    this.canvas = $('#v1-main');
    this.s = { G: 2, pieces: SAMPLES.two.pieces.map((p) => ({ ...p })), sample: 'two', slow: 2, T2s: 20, B0: 1.5, playing: true };
    this.clock = { stage: 'record', t: 0.35, u: 1, hold: 0 };   // (opens a little way into the record)
    this.sel = 0;
    this.hover = null;   // { kind: 'x' | 'f', x }
    this.drag = null;
    this.trail = [];
    this.xs = Float64Array.from({ length: NSPIN }, (_, i) => -HALF + i * DX);
    this.stripX = Float64Array.from({ length: STRIP }, (_, i) => -HALF + ((i + 0.5) * FOV) / STRIP);
    this.dirty = true;
    this.buildControls();
    this.recompute();
    this.bindPointer();
  }

  // ------------------------------------------------------------------- the physics

  get T() { return recordLength(this.s.G); }

  /** Everything that depends on the settings: the offsets, the record, its full spectrum. */
  recompute() {
    const s = this.s;
    this.offSpins = lorentzOffsets(NSPIN, s.T2s, 3);
    this.offStrip = lorentzOffsets(STRIP, s.T2s, 5);
    this.rhoSpins = blocksProfile(s.pieces, this.xs);
    this.rhoStrip = blocksProfile(s.pieces, this.stripX);
    const T = this.T, t = Float64Array.from({ length: NS }, (_, i) => (i * T) / (NS - 1));
    const fid = blocksFID(s.pieces, s.G, s.T2s, t);
    this.rec = { t, re: fid.re, im: fid.im };
    this.S0 = s.pieces.reduce((a, p) => a + p.rho * p.w, 0);
    if (this.clock.t > T) { this.clock.t = T; if (this.clock.stage === 'record') { this.clock.stage = 'hold'; this.clock.hold = HOLD; } }
    this.fullKey = null;   // the full spectrum is recomputed for the plotted frequencies when drawn
    this.dirty = true;
    this.app.scheduleHash();
  }

  /** The spins' transverse magnetization now: [re, im] arrays (for the arrows or the strip). */
  magnetization(xs, rho, off) {
    const { G } = this.s, { stage, t, u } = this.clock, n = xs.length;
    const re = new Float64Array(n), im = new Float64Array(n);
    // During the pulse the spins tip over: their part in the plane grows as sin of the angle.
    const tip = stage === 'pulse' ? Math.sin((u * Math.PI) / 2) : 1;
    const tt = stage === 'pulse' ? 0 : t;
    for (let i = 0; i < n; i++) {
      const phi = -TWO_PI * (GB * G * xs[i] + off[i]) * tt, m = rho[i] * tip;
      re[i] = m * Math.cos(phi); im[i] = m * Math.sin(phi);
    }
    return { re, im };
  }

  /** The signal now, as a fraction of its size just after the pulse: [re, im]. */
  signalNow() {
    if (!(this.S0 > 0)) return [0, 0];
    const { stage, t, u } = this.clock;
    if (stage === 'pulse') return [Math.sin((u * Math.PI) / 2), 0];
    const r = this.rec, dt = r.t[1] - r.t[0], m = Math.min(NS - 2, Math.floor(t / dt)), f = Math.min(1, t / dt - m);
    return [(r.re[m] + (r.re[m + 1] - r.re[m]) * f) / this.S0, (r.im[m] + (r.im[m + 1] - r.im[m]) * f) / this.S0];
  }

  /** The time recorded so far (ms). */
  get tNow() { return this.clock.stage === 'pulse' ? 0 : this.clock.t; }

  // ------------------------------------------------------------------- the clock

  advance(dt) {
    const c = this.clock;
    if (!this.s.playing) return;
    if (c.stage === 'pulse') {
      c.u += dt / PULSE;
      if (c.u >= 1) { c.u = 1; c.stage = 'record'; c.t = 0; this.trail = []; }
    } else if (c.stage === 'record') {
      c.t += dt / this.s.slow;
      if (c.t >= this.T) { c.t = this.T; c.stage = 'hold'; c.hold = HOLD; }
    } else {
      c.hold -= dt;
      if (c.hold <= 0) this.pulseAgain();
    }
    this.dirty = true;
  }

  pulseAgain() { Object.assign(this.clock, { stage: 'pulse', u: 0, t: 0, hold: 0 }); this.trail = []; this.dirty = true; }

  get animating() { return this.s.playing; }

  // ------------------------------------------------------------------- the controls

  buildControls() {
    const s = this.s;
    this.gSlider = slider({ label: 'gradient G (mT/m)', min: 0, max: GMAX, step: 0.01, value: s.G, title: 'How fast the field rises along x, in millitesla per metre', onInput: (v) => { s.G = v; this.recompute(); } });
    $('#v1-gradient-box').append(this.gSlider);
    this.playBtn = el('button', { type: 'button', class: 'primary play', title: 'Pause or go on (space bar)', onclick: () => this.setPlaying(!s.playing) }, 'Pause');
    $('#v1-play-row').append(this.playBtn,
      el('button', { type: 'button', title: 'Tip the spins over again with a new π/2 pulse and listen again', onclick: () => { this.pulseAgain(); this.setPlaying(true); } }, 'Pulse again'));
    this.speedSlider = slider({ label: 'slow motion', min: 0.25, max: 20, log: true, value: s.slow, title: 'Seconds of the page for one millisecond of the spins', onInput: (v) => { s.slow = v; this.app.scheduleHash(); } });
    $('#v1-speed-box').append(this.speedSlider, el('div', { class: 'small muted', id: 'v1-speed-note' }));
    this.sampleBtns = {};
    for (const [id, smp] of Object.entries(SAMPLES)) {
      const b = el('button', { type: 'button', title: smp.title, 'aria-pressed': String(id === s.sample), onclick: () => this.loadSample(id) }, smp.label);
      $('#v1-samples').append(b); this.sampleBtns[id] = b;
    }
    $('#v1-piece-row').append(
      el('button', { type: 'button', title: 'Add a tube of water at the centre', onclick: () => this.addPiece() }, '+ tube'),
      el('button', { type: 'button', title: 'Remove the tube you last touched', onclick: () => this.removePiece() }, 'remove'));
    this.t2Slider = slider({ label: 'T₂* (ms)', min: 1, max: 200, log: true, value: s.T2s, title: 'How long the spins stay in step on their own: a magnet whose field is not quite even makes neighbouring spins drift apart in T₂*', onInput: (v) => { s.T2s = v; this.recompute(); } });
    this.b0Seg = segmented([{ value: 1.5, label: '1.5 T' }, { value: 3, label: '3 T' }], s.B0, (v) => { s.B0 = v; this.dirty = true; this.app.scheduleHash(); }, { label: 'Field B0' });
    $('#v1-more-box').append(this.t2Slider,
      el('div', { class: 'small muted' }, 'T₂*: the magnet is never perfectly even, so spins at the same place drift apart and the signal fades in T₂* (each line of the spectrum widens to 1/πT₂*).'),
      el('div', { class: 'row' }, el('span', { class: 'small muted' }, 'field B₀'), this.b0Seg),
      el('div', { class: 'small muted' }, 'The main field sets the frequency at the centre, f₀ = γ̄B₀; the gradient only adds to it.'));
  }

  setPlaying(on) { this.s.playing = on; this.playBtn.textContent = on ? 'Pause' : 'Play'; this.app.kick(); }

  loadSample(id) {
    this.s.sample = id;
    this.s.pieces = SAMPLES[id].pieces.map((p) => ({ ...p }));
    this.sel = 0;
    for (const [k, b] of Object.entries(this.sampleBtns)) b.setAttribute('aria-pressed', String(k === id));
    this.recompute();
  }
  custom() { if (this.s.sample) { this.s.sample = null; for (const b of Object.values(this.sampleBtns)) b.setAttribute('aria-pressed', 'false'); } }
  addPiece() { if (this.s.pieces.length >= 4) return; this.custom(); this.s.pieces.push({ x: 0, w: 10, rho: 1 }); this.sel = this.s.pieces.length - 1; this.recompute(); }
  removePiece() { if (!this.s.pieces.length) return; this.custom(); this.s.pieces.splice(Math.min(this.sel, this.s.pieces.length - 1), 1); this.sel = 0; this.recompute(); }

  /** Put the settings (from a set-up or the address). */
  set(o) {
    const s = this.s;
    if (o.sample && SAMPLES[o.sample]) this.loadSample(o.sample);
    if (o.pieces) { s.pieces = o.pieces.map((p) => ({ ...p })); this.custom(); }
    for (const k of ['G', 'slow', 'T2s', 'B0']) if (o[k] !== undefined) s[k] = o[k];
    this.gSlider.value = s.G; this.speedSlider.value = s.slow; this.t2Slider.value = s.T2s; this.b0Seg.value = s.B0;
    this.setPlaying(o.playing ?? true);
    this.recompute();
    if (o.t !== undefined) Object.assign(this.clock, { stage: 'record', t: Math.min(o.t, this.T), u: 1 });
    else this.pulseAgain();
  }

  toHash() {
    const s = this.s, r = (v) => +(+v).toPrecision(4);
    return { G: r(s.G), smp: s.sample || undefined, pc: s.sample ? undefined : s.pieces.map((p) => [p.x, p.w, p.rho].map(r).join('_')).join('~'),
      sl: s.slow !== 2 ? r(s.slow) : undefined, t2: s.T2s !== 20 ? r(s.T2s) : undefined, B0: s.B0 !== 1.5 ? s.B0 : undefined };
  }
  fromHash(h) {
    const num = (v, d) => (v !== undefined && Number.isFinite(+v) ? +v : d);
    const o = { G: Math.max(0, Math.min(GMAX, num(h.G, 2))), slow: num(h.sl, 2), T2s: num(h.t2, 20), B0: num(h.B0, 1.5) === 3 ? 3 : 1.5 };
    if (h.pc) {
      const pieces = h.pc.split('~').map((q) => q.split('_').map(Number)).filter((a) => a.length === 3 && a.every(Number.isFinite)).map(([x, w, rho]) => ({ x, w, rho }));
      if (pieces.length) o.pieces = pieces.slice(0, 4);
    } else o.sample = SAMPLES[h.smp] ? h.smp : 'two';
    this.set(o);
  }

  // ------------------------------------------------------------------- layout

  /** Where everything goes on the canvas, for a width W and height H. */
  layout(W, H) {
    const narrow = W < 640, L = narrow ? 40 : 58, R = narrow ? 40 : 62, top = 22;
    const hf = Math.round(Math.max(70, (narrow ? 0.11 : 0.15) * H)), hs = Math.round(Math.max(96, (narrow ? 0.14 : 0.19) * H)), hstrip = narrow ? 14 : 18;
    const hfan = Math.round(Math.max(34, (narrow ? 0.05 : 0.07) * H));
    const field = { x0: L, x1: W - R, y0: top, y1: top + hf };
    const sample = { x0: L, x1: W - R, y0: field.y1 + 30, y1: field.y1 + 30 + hs };
    const strip = { x0: L, x1: W - R, y0: sample.y1 + 4, y1: sample.y1 + 4 + hstrip };
    const fan = { y0: strip.y1 + 16, y1: strip.y1 + 16 + hfan };
    // The spectrum and, beside it (or under it, on a narrow screen), the signal.
    let spec, sig;
    if (narrow) {
      const hsp = Math.round(0.24 * H);
      spec = { x0: L, x1: W - R, y0: fan.y1, y1: fan.y1 + hsp };
      sig = { x0: 8, x1: W - 8, y0: spec.y1 + 52, y1: H - 6 };
    } else {
      const split = L + Math.round(0.6 * (W - L - R));
      spec = { x0: L, x1: split, y0: fan.y1, y1: H - 54 };
      sig = { x0: split + 40, x1: W - 12, y0: fan.y1, y1: H - 8 };
    }
    return { W, H, narrow, field, sample, strip, fan, spec, sig };
  }
  X(x) { const b = this.lay.sample; return b.x0 + ((x + HALF) / FOV) * (b.x1 - b.x0); }
  invX(px) { const b = this.lay.sample; return -HALF + ((px - b.x0) / (b.x1 - b.x0)) * FOV; }
  F(f) { const b = this.lay.spec; return b.x0 + ((f + FAXIS) / (2 * FAXIS)) * (b.x1 - b.x0); }
  invF(px) { const b = this.lay.spec; return -FAXIS + ((px - b.x0) / (b.x1 - b.x0)) * 2 * FAXIS; }
  BY(B) { const b = this.lay.field, Bm = GMAX * HALF * 1e-3; return (b.y0 + b.y1) / 2 - (B / Bm) * ((b.y1 - b.y0) / 2 - 4); }
  /** The tops of the bars: density 1 fills the band but for a margin. */
  rhoY(rho) { const b = this.lay.sample; return b.y1 - 2 - rho * (b.y1 - b.y0 - 26); }

  // ------------------------------------------------------------------- drawing

  draw() {
    const { ctx, width: W, height: H } = fitCanvas(this.canvas);
    const c = this.colors = { ...themeColors(), ...this.app.colors };
    this.lay = this.layout(W, H);
    ctx.clearRect(0, 0, W, H);
    this.drawField(ctx, c);
    this.drawSample(ctx, c);
    this.drawStrip(ctx, c);
    this.drawSpectrum(ctx, c);
    this.drawFan(ctx, c);
    if (this.lay.sig) this.drawSignal(ctx, c, this.lay.sig);
    this.drawHover(ctx, c);
    this.readout();
    this.dirty = false;
  }

  drawField(ctx, c) {
    const b = this.lay.field, G = this.s.G, Bm = GMAX * HALF * 1e-3;
    ctx.save();
    ctx.font = BOLD; ctx.fillStyle = c.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('The field along the sample', b.x0, b.y0 - 8);
    const tw = ctx.measureText('The field along the sample').width;
    ctx.font = FONT; ctx.fillStyle = c.ink2;
    if (this.lay.narrow) ctx.fillText(': B = B₀ + G x', b.x0 + tw, b.y0 - 8);
    else fillSlots(ctx, [`: B = B₀ + G x, with B₀ = ${this.s.B0} T at the centre (f₀ = `, { v: larmorMHz(this.s.B0), dec: 2, w: 6 }, ' MHz)'], b.x0 + tw, b.y0 - 8);
    ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0 - 1, b.y1 - b.y0 - 1);
    // B0 itself (zero on these axes).
    const y0 = this.BY(0);
    ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(b.x0, y0); ctx.lineTo(b.x1, y0); ctx.stroke(); ctx.setLineDash([]);
    // Ticks: B - B0 in mT on the left, f - f0 in kHz on the right.
    ctx.font = SMALL; ctx.fillStyle = c.ink2; ctx.textBaseline = 'middle';
    for (const v of niceTicks(-0.95 * Bm, 0.95 * Bm, this.lay.narrow ? 3 : 4)) {
      const y = this.BY(v);
      ctx.textAlign = 'right'; ctx.fillText(tickLabel(v), b.x0 - 4, y);
    }
    // (The frequency's ticks at round kHz, wherever they fall on the field's scale.)
    for (const f of niceTicks(-0.95 * 42.577 * Bm, 0.95 * 42.577 * Bm, 3)) {
      ctx.textAlign = 'left'; ctx.fillText(tickLabel(f), b.x1 + 11, this.BY(f / 42.577));
    }
    ctx.save(); ctx.translate(this.lay.narrow ? 9 : 13, (b.y0 + b.y1) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(this.lay.narrow ? 'B − B₀' : 'B − B₀ (mT)', 0, 0); ctx.restore();
    if (!this.lay.narrow) { ctx.save(); ctx.translate(this.lay.W - 13, (b.y0 + b.y1) / 2); ctx.rotate(Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('f − f₀ (kHz)', 0, 0); ctx.restore(); }
    // The field line, from one edge of the field of view to the other.
    const xa = this.X(-HALF), xb = this.X(HALF), ya = this.BY(-G * HALF * 1e-3), yb = this.BY(G * HALF * 1e-3);
    ctx.strokeStyle = c.field; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(xb, yb); ctx.stroke();
    handle(ctx, xb, yb, 7, c.panel, c.field);
    this.fieldHandle = { x: xb, y: yb };
    ctx.restore();
  }

  drawSample(ctx, c) {
    const b = this.lay.sample, { pieces } = this.s;
    ctx.save();
    ctx.font = BOLD; ctx.fillStyle = c.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const title = this.lay.narrow ? 'The sample and its spins' : 'The sample, and its spins seen from above';
    ctx.fillText(title, b.x0, b.y0 - 8);
    const tw = ctx.measureText(title).width;
    ctx.font = FONT; ctx.fillStyle = c.ink2;
    const st = this.clock.stage;
    const note = st === 'pulse' ? ': a π/2 pulse tips them into the plane' : this.lay.narrow ? '' : ': each turns at its own frequency';
    ctx.fillText(note, b.x0 + tw, b.y0 - 8);
    // The pieces of the sample: a bar each, as high as its density of protons.
    pieces.forEach((p, i) => {
      const col = c.pieces[i % c.pieces.length], xa = this.X(p.x - p.w / 2), xb = this.X(p.x + p.w / 2), yt = this.rhoY(p.rho);
      ctx.fillStyle = col; ctx.globalAlpha = 0.16; ctx.fillRect(xa, yt, xb - xa, b.y1 - yt); ctx.globalAlpha = 1;
      ctx.strokeStyle = col; ctx.lineWidth = i === this.sel ? 2 : 1.4; ctx.strokeRect(xa + 0.5, yt + 0.5, xb - xa - 1, b.y1 - yt - 1);
      ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(xa, yt); ctx.lineTo(xb, yt); ctx.stroke();
    });
    // The axis.
    ctx.strokeStyle = c.ink3; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(b.x0, b.y1 + 0.5); ctx.lineTo(b.x1, b.y1 + 0.5); ctx.stroke();
    // The spins: one compass every 2 mm.
    const m = this.magnetization(this.xs, this.rhoSpins, this.offSpins), sp = (b.x1 - b.x0) / (NSPIN - 1);
    const r = Math.max(3.5, Math.min(14, 0.46 * sp)), yc = this.rhoY(1) + Math.max(r + 3, 0.42 * (b.y1 - this.rhoY(1)));
    this.spinY = yc; this.spinR = r;
    for (let i = 0; i < NSPIN; i++) {
      const rho = this.rhoSpins[i], len = Math.hypot(m.re[i], m.im[i]) / Math.max(rho, 1e-9);
      compass(ctx, this.X(this.xs[i]), yc, r, Math.atan2(m.im[i], m.re[i]), rho > 0 ? Math.min(1, len) * Math.min(1, 0.35 + 0.65 * rho) : 0, c.ring);
    }
    ctx.restore();
  }

  drawStrip(ctx, c) {
    const b = this.lay.strip, m = this.magnetization(this.stripX, this.rhoStrip, this.offStrip);
    complexImage(ctx, m.re, m.im, STRIP, 1, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 1, true);
    ctx.save();
    ctx.strokeStyle = c.line; ctx.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0 - 1, b.y1 - b.y0 - 1);
    // The colour wheel that says what the colours mean.
    const rw = (b.y1 - b.y0) / 2 + 3;
    wheel(ctx, b.x0 - rw - 6, (b.y0 + b.y1) / 2, rw);
    ctx.font = SMALL; ctx.fillStyle = c.ink2; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    if (!this.lay.narrow) ctx.fillText('phase', b.x1 + 4, (b.y0 + b.y1) / 2);
    // Ticks along x, under the strip, in mm.
    ctx.textBaseline = 'top'; ctx.textAlign = 'center'; ctx.fillStyle = c.ink2;
    for (const v of niceTicks(-HALF + 2, HALF - 2, this.lay.narrow ? 4 : 8)) ctx.fillText(tickLabel(v), this.X(v), b.y1 + 2);
    ctx.textAlign = 'left'; ctx.fillStyle = c.ink3;
    ctx.fillText(this.lay.narrow ? 'mm' : 'x (mm)', b.x1 + 4, b.y1 + 2);
    ctx.restore();
  }

  /** The spectrum of what has been recorded so far, at the plotted frequencies. */
  spectrumNow(fs) {
    const r = this.rec;
    return partialSpectrum(r.t, r.re, r.im, this.tNow, fs, TAPER);
  }

  drawSpectrum(ctx, c) {
    const b = this.lay.spec, n = Math.max(80, Math.round((b.x1 - b.x0) / 2));
    const fs = Float64Array.from({ length: n + 1 }, (_, i) => -FAXIS + (2 * FAXIS * i) / n);
    // The scale: the spectrum of the whole record, which the one so far grows into.
    const key = `${n}|${this.s.G}|${this.s.T2s}|${JSON.stringify(this.s.pieces)}`;
    if (this.fullKey !== key) {
      const full = partialSpectrum(this.rec.t, this.rec.re, this.rec.im, this.T, fs, TAPER);
      let top = 0;
      for (const v of full.re) top = Math.max(top, v);
      this.top = top > 0 ? top : 1; this.fullKey = key;
    }
    const S = this.spectrumNow(fs);
    this.lastSpectrum = { fs, re: S.re };
    // (Zero a tenth of the way up, for the ringing below it; the top of the full spectrum 3/4 up.)
    const Yz = (v) => b.y1 - (0.1 + 0.68 * (v / this.top)) * (b.y1 - b.y0);
    ctx.save();
    ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0 - 1, b.y1 - b.y0 - 1);
    ctx.font = BOLD; ctx.fillStyle = c.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('The spectrum of the signal', b.x0 + 6, b.y0 + 5);
    const tw = ctx.measureText('The spectrum of the signal').width;
    ctx.font = FONT; ctx.fillStyle = c.ink2;
    ctx.fillText(this.clock.stage === 'hold' ? (this.lay.narrow ? ': done' : ': the sample, along x') : ': so far', b.x0 + 6 + tw, b.y0 + 5);
    ctx.beginPath(); ctx.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.clip();
    const yz = Math.round(Yz(0)) + 0.5;
    ctx.beginPath(); ctx.moveTo(b.x0, yz); ctx.lineTo(b.x1, yz); ctx.stroke();
    // What the spectrum should become: the profile, mapped by f = GB G x (dashed).
    const G = this.s.G;
    if (G > 0.05) {
      ctx.strokeStyle = c.ink3; ctx.lineWidth = 1.3; ctx.setLineDash([5, 4]); ctx.beginPath();
      const prof = blocksProfile(this.s.pieces, Float64Array.from(fs, (f) => f / (GB * G)));
      for (let i = 0; i <= n; i++) { const x = this.F(fs[i]), y = Yz(prof[i] / (2 * GB * G)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    // The spectrum so far: filled, under a line.
    ctx.fillStyle = c.fan; ctx.beginPath(); ctx.moveTo(this.F(fs[0]), yz);
    for (let i = 0; i <= n; i++) ctx.lineTo(this.F(fs[i]), Yz(S.re[i]));
    ctx.lineTo(this.F(fs[n]), yz); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = c.spec; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i <= n; i++) { const x = this.F(fs[i]), y = Yz(S.re[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    ctx.restore();
    // Ticks: the frequency in kHz, and under it where that frequency comes from, in mm.
    ctx.save();
    ctx.font = SMALL; ctx.fillStyle = c.ink2; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const v of niceTicks(-FAXIS, FAXIS, this.lay.narrow ? 5 : 8)) ctx.fillText(tickLabel(v), this.F(v), b.y1 + 3);
    ctx.textAlign = 'right';
    ctx.fillText('f − f₀ (kHz)', b.x1, b.y1 + 31);
    if (G > 0.2) {
      ctx.fillStyle = c.ink3; ctx.textAlign = 'center';
      for (const x of this.lay.narrow ? [-20, 0, 20] : [-30, -20, -10, 0, 10, 20, 30]) { const f = GB * G * x; if (Math.abs(f) < FAXIS * 0.97) ctx.fillText(`${tickLabel(x)}`, this.F(f), b.y1 + 17); }
      ctx.textAlign = 'left'; ctx.fillText(this.lay.narrow ? 'x = f / γ̄G (mm)' : 'grey: x = f / γ̄G (mm)', b.x0, b.y1 + 31);
    } else {
      ctx.fillStyle = c.ink3; ctx.textAlign = 'left';
      ctx.fillText('no gradient: every spin at f₀, one line', b.x0, b.y1 + 17);
    }
    ctx.restore();
  }

  drawFan(ctx, c) {
    const L = this.lay, G = this.s.G, yTop = L.strip.y1 + 15, yBot = L.spec.y0 - 1;
    ctx.save();
    // The field of view's edges and centre, then each piece, from x to f = GB G x.
    ctx.strokeStyle = c.ring; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    for (const x of [-HALF, 0, HALF]) {
      const f = Math.max(-FAXIS, Math.min(FAXIS, GB * G * x));
      ctx.beginPath(); ctx.moveTo(this.X(x), yTop); ctx.lineTo(this.F(f), yBot); ctx.stroke();
    }
    ctx.setLineDash([]);
    this.s.pieces.forEach((p, i) => {
      const col = c.pieces[i % c.pieces.length], a = p.x - p.w / 2, z = p.x + p.w / 2;
      const fa = Math.max(-FAXIS, Math.min(FAXIS, GB * G * a)), fz = Math.max(-FAXIS, Math.min(FAXIS, GB * G * z));
      ctx.fillStyle = col; ctx.globalAlpha = 0.2;
      ctx.beginPath(); ctx.moveTo(this.X(a), yTop); ctx.lineTo(this.X(z), yTop); ctx.lineTo(this.F(fz), yBot); ctx.lineTo(this.F(fa), yBot); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.7; ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(this.X(a), yTop); ctx.lineTo(this.F(fa), yBot); ctx.moveTo(this.X(z), yTop); ctx.lineTo(this.F(fz), yBot); ctx.stroke();
      ctx.globalAlpha = 1;
    });
    ctx.restore();
  }

  drawSignal(ctx, c, b) {
    const [sr, si] = this.signalNow();
    ctx.save();
    ctx.font = BOLD; ctx.fillStyle = c.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('The signal: all the arrows added', b.x0, b.y0 + 5);
    // The dial: the signal as an arrow in the same plane as the spins' (x' right, y' up).
    const R = Math.min(62, 0.3 * (b.x1 - b.x0), 0.2 * (b.y1 - b.y0)), cx = b.x0 + R + 12, cy = b.y0 + 34 + R;
    ctx.strokeStyle = c.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - R - 4, cy); ctx.lineTo(cx + R + 4, cy); ctx.moveTo(cx, cy - R - 4); ctx.lineTo(cx, cy + R + 4); ctx.stroke();
    ctx.font = SMALL; ctx.fillStyle = c.ink3; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText('x′', cx + R + 6, cy); ctx.textAlign = 'center'; ctx.fillText('y′', cx, cy - R - 10);
    // Its trail, then the arrow.
    if (this.clock.stage !== 'pulse') { this.trail.push([sr, si]); if (this.trail.length > 90) this.trail.shift(); }
    ctx.strokeStyle = c.ink3; ctx.lineWidth = 1; ctx.beginPath();
    this.trail.forEach(([a, q], i) => { const x = cx + R * a, y = cy - R * q; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    const mag = Math.hypot(sr, si);
    ctx.strokeStyle = cssComplex(sr, si, 0.5); ctx.fillStyle = ctx.strokeStyle;
    if (mag > 0.01) arrow(ctx, cx, cy, cx + R * sr, cy - R * si, 9, 3);
    // In words beside it.
    const tx = cx + R + 22;
    ctx.font = FONT; ctx.fillStyle = c.ink2; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    fillSlots(ctx, [{ v: 100 * mag, dec: 0, w: 3 }, '% of its size'], tx, cy - 8);
    ctx.fillText('after the pulse', tx, cy + 8);
    // The record against time: Re and Im, with t's axis and k's.
    const f = { x0: b.x0 + 34, x1: b.x1 - 6, y0: cy + R + 46, y1: b.y1 - 34 };
    if (f.y1 - f.y0 > 50) {
      const T = this.T, X = (t) => f.x0 + (t / T) * (f.x1 - f.x0), Y = (v) => (f.y0 + f.y1) / 2 - v * 0.46 * (f.y1 - f.y0);
      ctx.strokeStyle = c.line; ctx.strokeRect(f.x0 + 0.5, f.y0 + 0.5, f.x1 - f.x0 - 1, f.y1 - f.y0 - 1);
      ctx.beginPath(); ctx.moveTo(f.x0, Y(0)); ctx.lineTo(f.x1, Y(0)); ctx.stroke();
      const r = this.rec, now = this.tNow, S0 = this.S0 || 1;
      for (const [arr, col, dash] of [[r.im, c.sigIm, [4, 3]], [r.re, c.sigRe, []]]) {
        ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.setLineDash(dash); ctx.beginPath();
        let pen = false;
        for (let i = 0; i < NS && r.t[i] <= now + 1e-12; i++) { const x = X(r.t[i]), y = Y(arr[i] / S0); pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true; }
        if (pen) { const [a, q] = [sr, si]; ctx.lineTo(X(now), Y(arr === r.re ? a : q)); }
        ctx.stroke(); ctx.setLineDash([]);
      }
      // The cursor.
      ctx.strokeStyle = c.ink2; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(X(now), f.y0); ctx.lineTo(X(now), f.y1); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = SMALL; ctx.fillStyle = c.ink2; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const v of niceTicks(0, T, 4)) ctx.fillText(tickLabel(v), X(v), f.y1 + 3);
      ctx.textAlign = 'right'; ctx.fillText('t (ms)', f.x1, f.y1 + 17);
      // k = GB G t along the top: how tightly the phase is wound.
      const kT = GB * this.s.G * T;
      ctx.textBaseline = 'bottom'; ctx.textAlign = 'center'; ctx.fillStyle = c.ink3;
      if (kT > 0.01) for (const v of niceTicks(0, kT, 4)) ctx.fillText(tickLabel(v), X(v / (GB * this.s.G)), f.y0 - 2);
      ctx.textAlign = 'left'; ctx.fillText('k = γ̄Gt (turns per mm)', f.x0, f.y0 - 15);
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = c.sigRe; ctx.fillText('real', f.x0, f.y1 + 17);
      ctx.fillStyle = c.sigIm; ctx.fillText('imaginary', f.x0 + 34, f.y1 + 17);
    }
    ctx.restore();
  }

  drawHover(ctx, c) {
    const h = this.hover, L = this.lay, G = this.s.G;
    if (!h || this.drag) return;
    let x, f;
    if (h.kind === 'x') { x = h.x; f = GB * G * x; } else { f = h.f; x = G > 0.05 ? f / (GB * G) : NaN; }
    ctx.save();
    ctx.strokeStyle = c.accent; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]);
    ctx.beginPath();
    if (Number.isFinite(x) && Math.abs(x) <= HALF) { ctx.moveTo(this.X(x), L.field.y0); ctx.lineTo(this.X(x), L.strip.y1 + 15); }
    if (Math.abs(f) <= FAXIS) {
      if (Number.isFinite(x) && Math.abs(x) <= HALF) { ctx.moveTo(this.X(x), L.strip.y1 + 15); ctx.lineTo(this.F(f), L.spec.y0); }
      ctx.moveTo(this.F(f), L.spec.y0); ctx.lineTo(this.F(f), L.spec.y1);
    }
    ctx.stroke();
    ctx.restore();
    this.hoverXF = { x, f };
  }

  readout() {
    const s = this.s, G = s.G, per = GB * G * 1000, box = $('#v1-readout');
    const lines = [];
    lines.push(G > 0.005
      ? ['Gradient ', { v: G, dec: 2, w: 4, class: 'b' }, ' mT/m: the Larmor frequency rises by ', { v: per, dec: 1, w: 5, class: 'b' }, ' Hz for each millimetre, so a difference of 1 kHz is ', { v: 1000 / per, dec: 2, w: 6, class: 'b' }, ' mm.']
      : ['No gradient: every spin turns at f₀, and the spectrum is one line.', { text: '', w: 0 }]);
    const T = this.T, t = this.tNow, k = GB * G * t;
    if (this.clock.stage === 'pulse') lines.push(['A π/2 pulse tips the spins into the plane; listening starts when it ends (t = 0).']);
    else if (G > 0.005) {
      const done = this.clock.stage === 'hold';
      lines.push([done ? 'Recorded for ' : 'Listening: t = ', { v: t, dec: 3, w: 5, class: 'b' }, done ? ' ms' : ` ms of `, ...(done ? [] : [{ v: T, dec: 3, w: 5 }, ' ms']),
        ': the phase now winds once every ', { v: k > 1e-6 ? 1 / k : Infinity, dec: 2, w: 6, class: 'b' }, ' mm across the sample, so the spectrum shows detail down to ', { v: k > 1e-6 ? 1 / (2 * k) : Infinity, dec: 2, w: 6, class: 'b' }, ' mm.']);
    } else lines.push(['Listening: t = ', { v: t, dec: 3, w: 5, class: 'b' }, ' ms of ', { v: T, dec: 3, w: 5 }, ' ms; all the arrows stay together.']);
    const h = this.hoverXF && this.hover;
    if (h) {
      const { x, f } = this.hoverXF;
      lines.push(Number.isFinite(x) && Math.abs(x) <= HALF
        ? ['Pointer: the spins at x = ', { v: x, dec: 1, w: 6, plus: '+' }, ' mm turn at f₀ ', { v: f, dec: 3, w: 7, plus: '+' }, ' kHz.']
        : ['Pointer: f₀ ', { v: f, dec: 3, w: 7, plus: '+' }, ' kHz: no spins in the field of view turn at that frequency.']);
    } else lines.push(['Point at the sample or the spectrum to read off where a frequency comes from.']);
    if (box.children.length !== lines.length) box.replaceChildren(...lines.map(() => el('div')));
    lines.forEach((l, i) => setSlots(box.children[i], l));
    const gloss = $('#v1-gloss');
    setSlots(gloss, G > 0.005 ? [{ v: per, dec: 1, w: 5 }, ' Hz per mm here.'] : ['not at all, with G = 0.']);
    setSlots($('#v1-speed-note'), ['1 ms of the spins takes ', { v: s.slow, dec: 2, w: 5 }, ' s here (they turn ', { v: s.slow * 1000, dec: 0, w: 6 }, ' times slower).']);
  }

  // ------------------------------------------------------------------- the pointer

  /** What is under the pointer: the field handle, a piece's side, top or body, or nothing. */
  hit(px, py) {
    const L = this.lay;
    if (!L) return null;
    const fh = this.fieldHandle;
    if (fh && Math.hypot(px - fh.x, py - fh.y) < 14) return { type: 'field' };
    // (Anywhere near the field line's right half also grabs it.)
    if (py >= L.field.y0 && py <= L.field.y1 && px > this.X(10)) {
      const yl = this.BY(this.s.G * this.invX(px) * 1e-3);
      if (Math.abs(py - yl) < 10) return { type: 'field' };
    }
    if (py >= L.sample.y0 - 4 && py <= L.sample.y1 + 4) {
      for (let i = this.s.pieces.length - 1; i >= 0; i--) {
        const p = this.s.pieces[i], xa = this.X(p.x - p.w / 2), xb = this.X(p.x + p.w / 2), yt = this.rhoY(p.rho);
        if (px < xa - 6 || px > xb + 6 || py < yt - 7) continue;
        if (Math.abs(px - xa) <= 6) return { type: 'left', i };
        if (Math.abs(px - xb) <= 6) return { type: 'right', i };
        if (Math.abs(py - yt) <= 6) return { type: 'top', i };
        if (px > xa && px < xb) return { type: 'move', i, dx: this.invX(px) - p.x };
      }
    }
    return null;
  }

  bindPointer() {
    const cv = this.canvas, xy = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', (e) => {
      const [px, py] = xy(e), h = this.hit(px, py);
      if (!h) return;
      cv.setPointerCapture(e.pointerId);
      this.drag = h;
      if (h.i !== undefined) this.sel = h.i;
      this.moveDrag(px, py);
    });
    cv.addEventListener('pointermove', (e) => {
      const [px, py] = xy(e);
      if (this.drag) { this.moveDrag(px, py); return; }
      const h = this.hit(px, py);
      cv.style.cursor = !h ? 'default' : h.type === 'field' || h.type === 'top' ? 'ns-resize' : h.type === 'move' ? 'grab' : 'ew-resize';
      const L = this.lay;
      let hv = null;
      if (L && px >= L.sample.x0 && px <= L.sample.x1 && py >= L.field.y0 && py <= L.strip.y1 + 14) hv = { kind: 'x', x: this.invX(px) };
      else if (L && px >= L.spec.x0 && px <= L.spec.x1 && py >= L.spec.y0 && py <= L.spec.y1) hv = { kind: 'f', f: this.invF(px) };
      this.hover = hv; if (!hv) this.hoverXF = null;
      this.dirty = true; this.app.kick();
    });
    cv.addEventListener('pointerleave', () => { if (!this.drag) { this.hover = null; this.hoverXF = null; this.dirty = true; this.app.kick(); } });
    const end = () => { if (this.drag) { this.drag = null; this.dirty = true; this.app.kick(); } };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }

  moveDrag(px, py) {
    const d = this.drag, s = this.s;
    if (d.type === 'field') {
      const Bm = GMAX * HALF * 1e-3, b = this.lay.field, B = (((b.y0 + b.y1) / 2 - py) / ((b.y1 - b.y0) / 2 - 4)) * Bm;
      s.G = Math.max(0, Math.min(GMAX, +(B / (HALF * 1e-3)).toFixed(2)));
      this.gSlider.value = s.G;
    } else {
      const p = s.pieces[d.i], x = this.invX(px);
      this.custom();
      if (d.type === 'move') p.x = Math.max(-HALF + p.w / 2, Math.min(HALF - p.w / 2, +(x - d.dx).toFixed(1)));
      else if (d.type === 'left') { const z = p.x + p.w / 2, a = Math.max(-HALF, Math.min(z - 2, x)); p.w = +(z - a).toFixed(1); p.x = +(z - p.w / 2).toFixed(2); }
      else if (d.type === 'right') { const a = p.x - p.w / 2, z = Math.min(HALF, Math.max(a + 2, x)); p.w = +(z - a).toFixed(1); p.x = +(a + p.w / 2).toFixed(2); }
      else if (d.type === 'top') {
        const b = this.lay.sample, rho = (b.y1 - 2 - py) / (b.y1 - b.y0 - 26);
        p.rho = Math.max(0.1, Math.min(1, +rho.toFixed(2)));
      }
    }
    this.recompute();
    this.app.kick();
  }

  // ------------------------------------------------------------------- for the tests

  probe() {
    const m = this.magnetization(this.xs, this.rhoSpins, this.offSpins);
    return {
      stage: this.clock.stage, t: this.tNow, T: this.T, G: this.s.G, pieces: this.s.pieces.map((p) => ({ ...p })),
      phases: Array.from(this.xs, (_, i) => Math.atan2(m.im[i], m.re[i])), mags: Array.from(this.xs, (_, i) => Math.hypot(m.re[i], m.im[i])),
      signal: this.signalNow(), spectrum: this.lastSpectrum ? { fs: Array.from(this.lastSpectrum.fs), re: Array.from(this.lastSpectrum.re) } : null,
      handle: this.fieldHandle, spinY: this.spinY, lay: this.lay,
    };
  }
}
