// View 3 · The second axis: phase encoding, and k-space filled line by line.
//
// Each line of the scan is one pass of the sequence: a pi/2 pulse (and for a spin echo a pi
// pulse), a lobe of Gy that winds the phase across y, and the readout under Gx, which sweeps k
// along one row of k-space while the ADC records it.  Three pictures follow it: the slice's
// spins, as a map of their phase, which is the object times a plane wave e^{-2 pi i k(t).r}
// (the stripes of the FFT and plane-wave demos); k-space, filling row by row in the FFT demo's
// colours, with the path k(t) traced; and the picture from what has been measured so far, the
// inverse 2D FFT.  Underneath, the sequence diagram, with the moment now and the echo.

import { GB, larmorMHz } from './bloch.js';
import { headPhantom, disksPhantom, disk, TISSUES, tissueAt } from './phantom.js';
import { sequence, lineOrder, Acquisition, spinsOf, phaseMap, echoTrace, traceTimes } from './scan.js';
import { el, $, slider, segmented, toggle, setSlots } from '../lib/ui.js';
import { fitCanvas, themeColors, fillSlots, niceTicks, tickLabel } from '../lib/plot.js';
import { complexImage, greyImage, arrow, wheel, cssComplex, FONT, SMALL, BOLD, haloText } from './draw.js';
import { colorize } from '../lib/complexcolor.js';

export const FOV = 256;
const NF = 128;                         // the spins of the live pictures: 128 x 128, 2 mm apart
const GX = 2, TPE = 2, TRF = 3;         // the readout gradient (mT/m), the phase-encode lobe's and the pulses' lengths (ms)
const RAMP = 2.2;                       // in the opening scan each line goes this much faster than the last

// How much of a line's slow-motion time each part of the sequence gets, per ms of it: the
// gradients and the readout slowly, the waiting quickly.
const WARP = { rf: 0.55, rephase: 0.35, prephase: 2.6, pe: 5, readout: 2.6, idle: 0.07 };

export class KspaceView {
  constructor(app) {
    this.app = app;
    this.canvas = $('#v3-main');
    this.s = {
      obj: 'head', disks: disksPhantom().map((d) => ({ ...d })), type: 'se', TE: 20, TR: 500, N: 64, T2p: 60,
      order: 'centre', rate: 12, slow: 9, show: 'spins', playing: true,
    };
    this.acq = new Acquisition();
    this.scan = { cur: null, n: 0, ramp: true, done: false };
    this.hover = null;   // a k-space pixel pointed at: {p, q}
    this.drag = null;
    this.traces = new Map();
    this.buildControls();
    this.rebuild();
    this.startNext();
    this.bindPointer();
  }

  // ------------------------------------------------------------------- the physics

  shapes() {
    if (this.s.obj === 'disks') return this.s.disks.map((d) => disk(d.x, d.y, d.a, d.tissue));
    return headPhantom(this.app.slice?.z ?? 0);
  }

  /** After any change: the sequence, the acquisition, the live spins, the warp of time. */
  rebuild() {
    const s = this.s;
    this.seq = sequence({ type: s.type, TE: s.TE, TR: s.TR, N: s.N, fov: FOV, Gx: GX, Tpe: TPE, Trf: TRF, T2prime: s.T2p });
    this.acq.set({ shapes: this.shapes(), seq: this.seq, B0: 1.5 });
    if (this.scan.done) this.acq.remeasure();
    this.sp = spinsOf(this.shapes(), this.seq, 1.5, NF, FOV);
    let mmax = 0;
    for (const v of this.sp.m) mmax = Math.max(mmax, v);
    this.mmax = mmax || 1;
    this.re = new Float64Array(NF * NF); this.im = new Float64Array(NF * NF);
    this.order = lineOrder(s.N, s.order);
    this.traces.clear();
    this.buildWarp();
    this.kR = kspaceBrightness(this.acq.kre, this.acq.kim);
    this.madeAt = this.app.slice?.z ?? 0;
    let pmax = 0;
    for (const v of this.acq.picture.total) pmax = Math.max(pmax, v);
    this.pmax = pmax || 1;
    this.dirty = true;
    this.app.scheduleHash();
  }

  /** The map from a line's progress u (0 to 1) to its time t (ms): slow through the gradients. */
  buildWarp() {
    const q = this.seq, ev = [];
    const add = (a, b, w) => { if (b > a) ev.push([a, b, w]); };
    add(0, q.Trf, WARP.rf); add(q.Trf, 1.5 * q.Trf, WARP.rephase);
    for (const [a, b, g] of q.gx) add(a, b, b <= q.adc[0] + 1e-9 ? WARP.prephase : WARP.readout);
    add(q.gyStart, q.gyStart + q.Tpe, WARP.pe);
    if (q.t180 !== null) add(q.t180 - q.Trf / 2, q.t180 + q.Trf / 2, WARP.rf);
    // Cut the line into pieces at every edge, each with the largest weight that covers it.
    const cuts = [...new Set([0, q.tEnd, ...ev.flat().filter((v, i) => i % 3 !== 2)])].filter((t) => t >= 0 && t <= q.tEnd).sort((a, b) => a - b);
    const segs = [];
    let total = 0;
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i], b = cuts[i + 1], mid = (a + b) / 2;
      let w = WARP.idle;
      for (const [x, y, ww] of ev) if (mid > x && mid < y) w = Math.max(w, ww);
      segs.push({ a, b, w, c0: total }); total += w * (b - a);
    }
    this.warp = { segs, total };
  }
  tOf(u) {
    const { segs, total } = this.warp, c = Math.max(0, Math.min(1, u)) * total;
    for (const g of segs) if (c <= g.c0 + g.w * (g.b - g.a) + 1e-12) return g.a + (c - g.c0) / g.w;
    return this.seq.tEnd;
  }

  /** The signal of line q (cached). */
  trace(q) {
    let tr = this.traces.get(q);
    if (!tr) {
      const ts = traceTimes(this.seq);
      const { re, im } = echoTrace(this.sp, this.seq, q, ts);
      tr = { ts, re, im };
      this.traces.set(q, tr);
    }
    return tr;
  }

  // ------------------------------------------------------------------- the scan

  get tNow() { return this.scan.cur ? this.tOf(this.scan.cur.u) : this.seq.tEnd; }
  get curQ() { return this.scan.cur ? this.scan.cur.q : null; }

  lineDuration() {
    if (this.scan.cur?.slow) return this.s.slow;
    const fast = 1 / this.s.rate;
    return this.scan.ramp ? Math.max(fast, this.s.slow / RAMP ** this.scan.n) : fast;
  }

  /** Start the next line in the order that has not been measured; or end the scan. */
  startNext(slow = false) {
    const q = this.order.find((r) => !this.acq.mask[r]);
    if (q === undefined) { this.scan.cur = null; this.scan.done = true; this.setPlaying(false); return; }
    this.scan.cur = { q, u: 0, slow };
    this.scan.cur.D = this.lineDuration();
    this.dirty = true;
  }

  advance(dt) {
    const sc = this.scan;
    if (!sc.cur) { if (this.s.playing && !sc.done) this.startNext(); else return; }
    sc.cur.u += dt / sc.cur.D;
    if (sc.cur.u >= 1) {
      this.acq.measure(sc.cur.q);
      sc.n++;
      const wasSlow = sc.cur.slow;
      sc.cur = null;
      if (this.s.playing && !wasSlow) this.startNext();
      else if (!this.order.some((r) => !this.acq.mask[r])) { sc.done = true; this.setPlaying(false); }
    }
    this.dirty = true;
  }
  get animating() { return !!this.scan.cur || (this.s.playing && !this.scan.done); }

  step() { this.setPlaying(false); if (this.scan.cur) { this.acq.measure(this.scan.cur.q); this.scan.n++; } this.startNext(true); this.app.kick(); }
  measureRow(q) {
    this.setPlaying(false);
    if (this.scan.cur && this.scan.cur.q !== q) { /* (the line in progress is left unmeasured) */ }
    this.scan.cur = { q, u: 0, slow: true, D: this.s.slow };
    this.scan.done = false;
    this.dirty = true; this.app.kick();
  }
  /** Measure every row not yet measured, at once (the rows already measured keep what they saw). */
  finish() {
    for (let q = 0; q < this.seq.N; q++) if (!this.acq.mask[q]) this.acq.measure(q);
    this.scan.cur = null; this.scan.done = true; this.setPlaying(false); this.dirty = true; this.app.kick();
  }
  again(ramp = true) {
    this.acq.clear(); this.traces.clear();
    Object.assign(this.scan, { cur: null, n: 0, ramp, done: false });
    this.setPlaying(true); this.startNext(); this.app.kick();
  }
  /** Play row q in slow motion from the time t (ms) of its sequence (a set-up's starting point). */
  cue(q, t, playOn = false) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (this.tOf(m) < t) lo = m; else hi = m; }
    this.scan.cur = { q, u: lo, slow: true, D: this.s.slow };
    this.scan.done = false;
    this.s.playing = playOn; if (this.playBtn) this.playBtn.textContent = playOn ? 'Pause' : 'Go on';
    this.dirty = true; this.app.kick();
  }
  /** Fill k-space at once with only some rows: the centre's or the edges'. */
  only(which) {
    const N = this.s.N, keep = Math.max(4, Math.round(N / 4));
    this.acq.clear();
    for (let q = 0; q < N; q++) {
      const d = Math.abs(q - N / 2);
      if (which === 'centre' ? d < keep / 2 : d >= keep / 2) this.acq.measure(q);
    }
    Object.assign(this.scan, { cur: null, n: this.acq.measuredCount, ramp: false, done: true });
    this.setPlaying(false); this.dirty = true; this.app.kick();
  }
  setPlaying(on) {
    this.s.playing = on;
    if (this.playBtn) this.playBtn.textContent = on ? 'Pause' : this.scan.done ? 'Play' : 'Go on';
    if (on) { this.scan.ramp = this.scan.ramp && this.scan.n < 12; if (this.scan.done) this.again(false); }
    this.app.kick();
  }

  // ------------------------------------------------------------------- the controls

  buildControls() {
    const s = this.s;
    this.playBtn = el('button', { type: 'button', class: 'primary play', title: 'Pause or go on (space bar)', onclick: () => this.setPlaying(!s.playing) }, 'Pause');
    $('#v3-scan-row').append(this.playBtn,
      el('button', { type: 'button', title: 'Measure one more line, in slow motion, and stop (→ key)', onclick: () => this.step() }, 'Step'),
      el('button', { type: 'button', title: 'Measure every line that is left, at once', onclick: () => this.finish() }, 'Finish'),
      el('button', { type: 'button', title: 'Empty k-space and scan again from the first line', onclick: () => this.again() }, 'Again'));
    this.rateSl = slider({ label: 'lines a second', min: 0.2, max: 40, log: true, value: s.rate, title: 'How fast Play measures lines (Step always plays one line in slow motion)', onInput: (v) => { s.rate = v; this.scan.ramp = false; this.app.scheduleHash(); } });
    this.slowSl = slider({ label: 'slow motion (s)', min: 2, max: 40, log: true, value: s.slow, title: 'Seconds of the page for one line played slowly (Step, a click in k-space, the first lines)', onInput: (v) => { s.slow = v; this.app.scheduleHash(); } });
    $('#v3-rate-box').append(this.rateSl, this.slowSl);
    this.orderSeg = segmented([{ value: 'centre', label: 'Centre out', title: 'The middle row of k-space first, then alternately above and below' }, { value: 'up', label: 'Bottom to top', title: 'From the most negative ky to the most positive' }], s.order, (v) => { s.order = v; this.order = lineOrder(s.N, v); this.app.scheduleHash(); }, { label: 'Order of the lines' });
    $('#v3-order-row').append(el('span', { class: 'small muted' }, 'order'), this.orderSeg);
    $('#v3-only-row').append(
      el('button', { type: 'button', title: 'Measure only the middle quarter of the rows (the low spatial frequencies)', onclick: () => this.only('centre') }, 'Only the centre'),
      el('button', { type: 'button', title: 'Measure all but the middle quarter (the high spatial frequencies)', onclick: () => this.only('edges') }, 'Only the edges'));
    this.typeSeg = segmented([{ value: 'se', label: 'Spin echo', title: 'π/2, then a π pulse at TE/2: the echo at TE refocuses an uneven field' }, { value: 'gre', label: 'Gradient echo', title: 'π/2 only: the gradient alone makes the echo; an uneven field is not undone' }], s.type,
      (v) => { s.type = v; s.TE = v === 'se' ? Math.max(s.TE, 12) : Math.min(s.TE, 10); this.teSl.value = s.TE; this.changed(); }, { label: 'Sequence' });
    $('#v3-seq-row').append(this.typeSeg);
    this.teSl = slider({ label: 'echo time TE (ms)', min: 4, max: 120, value: s.TE, step: 0.5, title: 'From the π/2 pulse to the middle of the readout, where k = 0', onInput: (v) => { s.TE = v; this.changed(); } });
    this.trSl = slider({ label: 'repeat time TR (ms)', min: 100, max: 4000, log: true, value: s.TR, title: 'The time from one line\'s π/2 pulse to the next: how much the spins recover along z between lines', onInput: (v) => { s.TR = v; this.changed(); } });
    $('#v3-seq-box').append(this.teSl, this.trSl);
    this.nSeg = segmented([32, 64, 128].map((n) => ({ value: n, label: String(n) })), s.N, (v) => { s.N = v; this.acq.N = 0; this.changed(true); }, { label: 'Lines (and pixels across)' });
    $('#v3-n-row').append(el('span', { class: 'small muted' }, 'matrix'), this.nSeg);
    this.objSeg = segmented([{ value: 'head', label: 'The head', title: 'The slice of the head picked in view 2' }, { value: 'disks', label: 'Three disks', title: 'Water, fat and white matter: drag them on the left picture' }], s.obj, (v) => { s.obj = v; this.changed(); }, { label: 'Object' });
    $('#v3-obj-row').append(this.objSeg);
    this.showSeg = segmented([{ value: 'spins', label: 'The spins', title: 'The spins of the slice: the object times the plane wave' }, { value: 'wave', label: 'The plane wave alone', title: 'Only the plane wave e^{−2πi k·r} that the gradients have wound so far' }], s.show, (v) => { s.show = v; this.dirty = true; this.app.kick(); this.app.scheduleHash(); }, { label: 'The left picture shows' });
    $('#v3-show-row').append(this.showSeg);
    this.t2Sl = slider({ label: 'T₂′ (ms)', min: 2, max: 200, log: true, value: s.T2p, title: 'How fast an uneven magnet dephases spins at the same place (T₂*: with T₂ as well)', onInput: (v) => { s.T2p = v; this.changed(); } });
    $('#v3-more-box').append(this.t2Sl, el('div', { class: 'small muted' }, 'T₂′: the magnet is never perfectly even, so each spin is a little off its frequency and they drift apart; a spin echo\'s π pulse undoes that at TE, a gradient echo does not.'));
  }

  /** A setting changed: rebuild; a scan in progress goes on (the lines already measured keep what they measured). */
  changed(restart = false) {
    if (restart) { this.rebuild(); this.again(false); return; }
    this.rebuild(); this.app.kick();
  }

  set(o) {
    const s = this.s;
    for (const k of ['obj', 'type', 'TE', 'TR', 'N', 'T2p', 'order', 'rate', 'slow', 'show']) if (o[k] !== undefined) s[k] = o[k];
    if (o.disks) s.disks = o.disks.map((d) => ({ ...d }));
    this.rateSl.value = s.rate; this.slowSl.value = s.slow; this.orderSeg.value = s.order; this.typeSeg.value = s.type; this.teSl.value = s.TE; this.trSl.value = s.TR;
    this.nSeg.value = s.N; this.objSeg.value = s.obj; this.showSeg.value = s.show; this.t2Sl.value = s.T2p;
    this.acq.N = 0;
    this.scan.done = false;
    this.rebuild();
    if (o.only) { this.only(o.only); return; }
    if (o.cue) { this.acq.clear(); Object.assign(this.scan, { cur: null, n: 0, ramp: false, done: false }); for (const q of o.measured || []) this.acq.measure(q); this.cue(o.cue.q, o.cue.t); return; }
    if (o.finish) { this.finish(); return; }
    this.acq.clear(); this.traces.clear();
    Object.assign(this.scan, { cur: null, n: 0, ramp: o.ramp ?? true, done: false });
    if (o.step) { this.s.playing = false; this.startNext(true); if (o.u !== undefined) this.scan.cur.u = o.u; this.setPlaying(false); }
    else { this.setPlaying(o.playing ?? true); this.startNext(); if (o.u !== undefined && this.scan.cur) this.scan.cur.u = o.u; }
  }
  toHash() {
    const s = this.s, r = (v) => +(+v).toPrecision(4);
    return { obj: s.obj, seq: s.type, TE: r(s.TE), TR: r(s.TR), N: s.N, t2p: s.T2p !== 60 ? r(s.T2p) : undefined, ord: s.order !== 'centre' ? s.order : undefined,
      rate: s.rate !== 12 ? r(s.rate) : undefined, slow: s.slow !== 9 ? r(s.slow) : undefined, show: s.show !== 'spins' ? s.show : undefined,
      dk: s.obj === 'disks' ? s.disks.map((d) => [d.x, d.y].map(r).join('_')).join('~') : undefined, z: r(this.app.slice?.z ?? 0) };
  }
  fromHash(h) {
    const num = (v, d, lo = -Infinity, hi = Infinity) => (v !== undefined && Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);
    if (h.z !== undefined) this.app.slice = { ...(this.app.slice || {}), z: num(h.z, 0, -125, 125) };
    const o = { obj: h.obj === 'disks' ? 'disks' : 'head', type: h.seq === 'gre' ? 'gre' : 'se', TE: num(h.TE, 20, 1, 300), TR: num(h.TR, 500, 20, 10000), N: [32, 64, 128].includes(+h.N) ? +h.N : 64,
      T2p: num(h.t2p, 60, 1, 1000), order: h.ord === 'up' ? 'up' : 'centre', rate: num(h.rate, 12, 0.05, 100), slow: num(h.slow, 9, 1, 100), show: h.show === 'wave' ? 'wave' : 'spins' };
    if (h.dk) {
      const xy = h.dk.split('~').map((p) => p.split('_').map(Number));
      const d = disksPhantom().map((dd, i) => (xy[i] && xy[i].length === 2 && xy[i].every(Number.isFinite) ? { ...dd, x: xy[i][0], y: xy[i][1] } : dd));
      o.disks = d;
    }
    this.set(o);
  }

  // ------------------------------------------------------------------- layout

  layout(W, H) {
    const narrow = W < 700;
    if (narrow) {
      const S = W - 16, top = 24;
      const sq = [0, 1, 2].map((i) => ({ x0: 8, y0: top + i * (S + 54), s: S }));
      const seq = { x0: 52, x1: W - 8, y0: sq[2].y0 + S + 46, y1: H - 32 };
      return { narrow, W, H, sq, seq };
    }
    const seqH = Math.max(200, Math.round(0.31 * H)), gap = 58;
    const S = Math.floor(Math.min((W - 16 - 2 * gap) / 3, H - 24 - 66 - seqH));
    const x0 = Math.round((W - 3 * S - 2 * gap) / 2);
    const sq = [0, 1, 2].map((i) => ({ x0: x0 + i * (S + gap), y0: 24, s: S }));
    const seq = { x0: 62, x1: W - 14, y0: 24 + S + 66, y1: H - 32 };
    return { narrow, W, H, sq, seq };
  }

  // ------------------------------------------------------------------- drawing

  draw() {
    const { ctx, width: W, height: H } = fitCanvas(this.canvas);
    const c = this.c = { ...themeColors(), ...this.app.colors };
    this.lay = this.layout(W, H);
    ctx.clearRect(0, 0, W, H);
    this.drawSpins(ctx, c, this.lay.sq[0]);
    this.drawKspace(ctx, c, this.lay.sq[1]);
    this.drawImage(ctx, c, this.lay.sq[2]);
    if (!this.lay.narrow) this.drawFlow(ctx, c);
    this.drawSequence(ctx, c, this.lay.seq);
    this.readout();
    this.dirty = false;
  }

  title(ctx, c, b, text, sub) {
    ctx.save();
    ctx.font = BOLD; ctx.fillStyle = c.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, b.x0, b.y0 - 8);
    if (sub) { const w = ctx.measureText(text).width; ctx.font = FONT; ctx.fillStyle = c.ink2; ctx.fillText(sub, b.x0 + w, b.y0 - 8); }
    ctx.restore();
  }

  /** The k (per mm) and the line now, or of the k-space pixel pointed at. */
  kNow() {
    const q = this.curQ, t = this.tNow, sq = this.seq;
    if (q === null || t <= sq.t90) return [0, 0];
    return sq.kOf(q, t);
  }

  drawSpins(ctx, c, b) {
    const n = NF, sq = this.seq, h = this.hover, S = b.s;
    let label, re = this.re, im = this.im, R = 0.5 * this.mmax;
    if (h) {
      // The plane wave that one pixel of k-space measures.
      const kx = (h.p - sq.N / 2) * sq.dk, ky = (sq.N / 2 - h.q) * sq.dk, dx = FOV / n;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const ph = -2 * Math.PI * (kx * (i - n / 2) * dx + ky * (n / 2 - j) * dx), o = j * n + i;
        const m = this.s.show === 'wave' ? 1 : this.sp.m[o] / this.mmax;
        re[o] = m * Math.cos(ph); im[o] = m * Math.sin(ph);
      }
      R = 0.5; label = 'the plane wave of the point pointed at';
    } else {
      // (Between lines the spins are shown in step, as the next pulse will tip them.)
      const q = this.curQ ?? this.order[0], t = this.scan.cur ? this.tNow : sq.t90, tip = this.scan.cur ? Math.min(1, t / sq.t90) : 1;
      if (this.s.show === 'wave') {
        const [kx, ky] = t > sq.t90 ? sq.kOf(q, t) : [0, 0], dx = FOV / n;
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const ph = -2 * Math.PI * (kx * (i - n / 2) * dx + ky * (n / 2 - j) * dx), o = j * n + i; re[o] = Math.cos(ph); im[o] = Math.sin(ph); }
        R = 0.5;
      } else phaseMap(this.sp, sq, q, t, re, im, tip);
      label = this.s.show === 'wave' ? 'the plane wave the gradients have wound' : this.scan.cur ? null : 'between lines: in step, ready for the next pulse';
    }
    complexImage(ctx, re, im, n, n, b.x0, b.y0, S, S, R, false);
    ctx.save();
    ctx.strokeStyle = c.line; ctx.strokeRect(b.x0 - 0.5, b.y0 - 0.5, S + 1, S + 1);
    this.title(ctx, c, b, this.lay.narrow ? 'The spins' : 'The slice\'s spins', ': their phase');
    // The colour wheel, and in words what the stripes are.
    wheel(ctx, b.x0 + S - 14, b.y0 + 14, 11);
    const [kx, ky] = h ? [(h.p - sq.N / 2) * sq.dk, (sq.N / 2 - h.q) * sq.dk] : this.kNow(), kk = Math.hypot(kx, ky);
    ctx.font = SMALL; ctx.fillStyle = c.ink2; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const cap = kk > 1e-6 ? ['k = (', { v: kx, dec: 4, w: 7, plus: '+' }, ', ', { v: ky, dec: 4, w: 7, plus: '+' }, ') per mm: a turn every ', { v: 1 / kk, dec: 1, w: 5 }, ' mm']
      : ['k = 0: every spin in step (no stripes)'];
    fillSlots(ctx, cap, b.x0, b.y0 + S + 5);
    if (label) { ctx.fillStyle = c.accent; fillSlots(ctx, [label], b.x0, b.y0 + S + 19); }
    // A small arrow along k, from the centre.
    if (kk > 1e-6 && !this.lay.narrow) {
      const L = 26, ax = b.x0 + 22, ay = b.y0 + S - 22;
      ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 2;
      arrow(ctx, ax, ay, ax + (L * kx) / kk, ay - (L * ky) / kk, 7, 2);
      ctx.font = SMALL; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText('k', ax + (L * kx) / kk + 4, ay - (L * ky) / kk);
    }
    ctx.restore();
    this.spinBox = b;
  }

  drawKspace(ctx, c, b) {
    const sq = this.seq, N = sq.N, S = b.s, acq = this.acq, cur = this.scan.cur;
    const re = new Float64Array(N * N), im = new Float64Array(N * N);
    for (let q = 0; q < N; q++) if (acq.mask[q]) for (let p = 0; p < N; p++) { re[q * N + p] = acq.mre[q * N + p]; im[q * N + p] = acq.mim[q * N + p]; }
    // The line in progress: the samples the ADC has taken so far.
    let upto = -1;
    if (cur && this.tNow >= sq.adc[0]) {
      upto = Math.min(N - 1, Math.floor((this.tNow - sq.adc[0]) / (sq.Tro / N)));
      for (let p = 0; p <= upto; p++) { re[cur.q * N + p] = acq.nre[cur.q * N + p]; im[cur.q * N + p] = acq.nim[cur.q * N + p]; }
    }
    complexImage(ctx, re, im, N, N, b.x0, b.y0, S, S, this.kR, false);
    ctx.save();
    // Rows not yet measured: hatched grey.
    const rh = S / N;
    ctx.fillStyle = c.line; ctx.globalAlpha = 0.55;
    for (let q = 0; q < N; q++) if (!acq.mask[q] && !(cur && cur.q === q && upto >= 0)) ctx.fillRect(b.x0, b.y0 + q * rh, S, rh);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = c.line; ctx.strokeRect(b.x0 - 0.5, b.y0 - 0.5, S + 1, S + 1);
    this.title(ctx, c, b, 'K-space', this.lay.narrow ? '' : ': what has been measured');
    const X = (kx) => b.x0 + (kx / sq.dk + N / 2 + 0.5) * rh, Y = (ky) => b.y0 + (N / 2 - ky / sq.dk + 0.5) * rh;
    // Axes through k = 0.
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(0), b.y0); ctx.lineTo(X(0), b.y0 + S); ctx.moveTo(b.x0, Y(0)); ctx.lineTo(b.x0 + S, Y(0)); ctx.stroke();
    // The current line, and the path of k so far.
    if (cur) {
      ctx.strokeStyle = c.warn; ctx.lineWidth = 1.5; ctx.strokeRect(b.x0 + 0.5, b.y0 + cur.q * rh, S - 1, rh);
      const t = this.tNow;
      if (t > sq.t90) {
        const pts = [], n = 80;
        for (let i = 0; i <= n; i++) { const tt = sq.t90 + ((t - sq.t90) * i) / n; pts.push(sq.kOf(cur.q, tt)); }
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.setLineDash([4, 3]); ctx.beginPath();
        pts.forEach(([kx, ky], i) => (i ? ctx.lineTo(X(kx), Y(ky)) : ctx.moveTo(X(kx), Y(ky))));
        ctx.stroke(); ctx.setLineDash([]);
        const [kx, ky] = pts[pts.length - 1];
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(X(kx), Y(ky), 4.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      }
    }
    // The pixel pointed at.
    if (this.hover) { ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 2; ctx.strokeRect(b.x0 + this.hover.p * rh, b.y0 + this.hover.q * rh, rh, rh); }
    ctx.font = SMALL; ctx.fillStyle = c.ink2; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    fillSlots(ctx, [{ v: acq.measuredCount, dec: 0, w: 3 }, ` of ${N} lines; kx across, ky up, ±`, { v: (N / 2) * sq.dk, dec: 3, w: 5 }, ' per mm'], b.x0, b.y0 + S + 5);
    ctx.fillStyle = c.ink3; ctx.fillText(this.lay.narrow ? 'tap a row to measure it' : 'click a row to measure it; point to see its plane wave', b.x0, b.y0 + S + 19);
    ctx.restore();
    this.kBox = b;
  }

  drawImage(ctx, c, b) {
    const N = this.seq.N, S = b.s, img = this.acq.image();
    greyImage(ctx, img.mag, N, N, b.x0, b.y0, S, S, this.pmax, false);
    ctx.save();
    ctx.strokeStyle = c.line; ctx.strokeRect(b.x0 - 0.5, b.y0 - 0.5, S + 1, S + 1);
    this.title(ctx, c, b, 'The picture so far', this.lay.narrow ? '' : ': the inverse 2D FFT');
    const n = this.acq.measuredCount;
    ctx.font = SMALL; ctx.fillStyle = c.ink2; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    fillSlots(ctx, ['from ', { v: n, dec: 0, w: 3 }, ` of ${N} lines`, ...(n && n < N ? [` (${this.whichRows()})`] : [])], b.x0, b.y0 + S + 5);
    if (this.s.obj === 'head') { ctx.fillStyle = c.ink3; fillSlots(ctx, ['the slice at z = ', { v: this.app.slice?.z ?? 0, dec: 1, w: 6 }, ' mm (view 2)'], b.x0, b.y0 + S + 19); }
    ctx.restore();
  }

  /** The arrows from the spins to k-space and from k-space to the picture. */
  drawFlow(ctx, c) {
    const [a, k, p] = this.lay.sq, y = a.y0 + a.s / 2;
    ctx.save();
    ctx.strokeStyle = c.ink2; ctx.fillStyle = c.ink2; ctx.font = SMALL; ctx.textAlign = 'center';
    for (const [x0, x1, t1, t2] of [[a.x0 + a.s + 6, k.x0 - 6, 'their', 'sum'], [k.x0 + k.s + 6, p.x0 - 6, 'inverse', 'FFT']]) {
      arrow(ctx, x0, y, x1, y, 7, 1.6);
      ctx.textBaseline = 'bottom'; ctx.fillText(t1, (x0 + x1) / 2, y - 18);
      ctx.fillText(t2, (x0 + x1) / 2, y - 6);
    }
    ctx.restore();
  }

  drawSequence(ctx, c, b) {
    const sq = this.seq, N = sq.N, tEnd = sq.tEnd, q = this.curQ ?? this.order[0], t = this.tNow;
    const X = (tt) => b.x0 + (tt / tEnd) * (b.x1 - b.x0);
    const names = ['RF', 'G_z', 'G_y', 'G_x', 'signal'], nr = names.length, rh = (b.y1 - b.y0) / nr;
    const row = (i) => ({ y0: b.y0 + i * rh, ym: b.y0 + (i + 0.5) * rh, h: rh / 2 - 3 });
    ctx.save();
    ctx.font = BOLD; ctx.fillStyle = c.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('The pulse sequence for this line', b.x0, b.y0 - 10);
    const tw = ctx.measureText('The pulse sequence for this line').width;
    ctx.font = FONT; ctx.fillStyle = c.ink2;
    if (!this.lay.narrow) fillSlots(ctx, [`: ${sq.type === 'se' ? 'spin echo' : 'gradient echo'}, TE = `, { v: sq.TE, dec: 1, w: 5 }, ' ms; the waiting is skipped quickly'], b.x0 + tw, b.y0 - 10);
    ctx.font = SMALL; ctx.textBaseline = 'middle';
    names.forEach((nm, i) => {
      const r = row(i);
      ctx.fillStyle = c.ink2; ctx.textAlign = 'right'; ctx.fillText(nm, b.x0 - 8, r.ym);
      ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(b.x0, r.ym); ctx.lineTo(b.x1, r.ym); ctx.stroke();
    });
    // RF: the sinc pulses.
    const rf = row(0);
    for (const p of sq.rf) {
      const amp = p.flip / Math.PI, n = 40;
      ctx.strokeStyle = c.accent; ctx.lineWidth = 1.6; ctx.beginPath();
      for (let i = 0; i <= n; i++) { const u = (i / n - 0.5) * 2, x = X(p.t0 + ((p.t1 - p.t0) * i) / n), v = Math.abs(u) < 1e-9 ? 1 : Math.sin(Math.PI * 2 * u) / (Math.PI * 2 * u); const y = rf.ym - rf.h * amp * v * (0.54 + 0.46 * Math.cos(Math.PI * u)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
      ctx.fillStyle = c.accent; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(p.label, X(p.t1) + 3, rf.ym - 2);
    }
    // A gradient row from its lobes [t0, t1, G], scaled by gmax.
    const lobes = (r, list, gmax, col, alpha = 0.3, bold = true) => {
      for (const [a, z, g] of list) {
        const hgt = (g / gmax) * r.h;
        ctx.fillStyle = col; ctx.globalAlpha = alpha; ctx.fillRect(X(a), r.ym - Math.max(0, hgt), X(z) - X(a), Math.abs(hgt)); ctx.globalAlpha = 1;
        if (bold) { ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.strokeRect(X(a), r.ym - Math.max(0, hgt), X(z) - X(a), Math.abs(hgt)); }
      }
    };
    lobes(row(1), sq.gz, sq.Gz, c.field);
    // G_y: the ladder of every line's lobe, faint, and this line's, bold.
    const gy = row(2), gmaxY = Math.abs(sq.Gy(0));
    ctx.strokeStyle = c.ink3; ctx.lineWidth = 0.6; ctx.globalAlpha = 0.6;
    for (let r = 0; r < N; r += Math.max(1, N / 16)) { const [[a, z, g]] = sq.gyLobe(r), hgt = (g / gmaxY) * gy.h; ctx.strokeRect(X(a), gy.ym - Math.max(0, hgt), X(z) - X(a), Math.abs(hgt)); }
    ctx.globalAlpha = 1;
    lobes(gy, sq.gyLobe(q), gmaxY, c.sigIm, 0.45);
    ctx.fillStyle = c.ink2; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    if (!this.lay.narrow) ctx.fillText('one step of the ladder per line', X(sq.gyStart + sq.Tpe) + 6, gy.ym - gy.h / 2);
    lobes(row(3), sq.gx, sq.Gx, c.field);
    // The ADC's window, and the signal of this line so far.
    const sg = row(4);
    ctx.fillStyle = c.good; ctx.globalAlpha = 0.12; ctx.fillRect(X(sq.adc[0]), sg.y0 + 2, X(sq.adc[1]) - X(sq.adc[0]), rh - 4); ctx.globalAlpha = 1;
    ctx.fillStyle = c.good; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('ADC', (X(sq.adc[0]) + X(sq.adc[1])) / 2, sg.y0 + 2);
    const tr = this.trace(q);
    ctx.lineWidth = 1.5;
    for (const [arr, col, dash] of [[tr.im, c.sigIm, [3, 2]], [tr.re, c.sigRe, []]]) {
      ctx.strokeStyle = col; ctx.setLineDash(dash); ctx.beginPath(); let pen = false;
      for (let i = 0; i < tr.ts.length && tr.ts[i] <= t + 1e-9; i++) { const x = X(tr.ts[i]), y = sg.ym - arr[i] * sg.h; pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true; }
      ctx.stroke(); ctx.setLineDash([]);
    }
    // The samples the ADC has taken: dots.
    ctx.fillStyle = c.sigRe;
    const first = tr.ts.length - N - 8;
    for (let p = 0; p < N; p++) { const i = first + p; if (tr.ts[i] > t) break; ctx.beginPath(); ctx.arc(X(tr.ts[i]), sg.ym - tr.re[i] * sg.h, N > 64 ? 1 : 1.6, 0, 2 * Math.PI); ctx.fill(); }
    // TE, from the pi/2 pulse's middle to the echo; and the pi pulse at TE/2.
    ctx.strokeStyle = c.ink2; ctx.fillStyle = c.ink2; ctx.lineWidth = 1;
    const yT = b.y1 + 19;
    ctx.beginPath(); ctx.moveTo(X(sq.t90), yT); ctx.lineTo(X(sq.tEcho), yT); ctx.moveTo(X(sq.t90), yT - 4); ctx.lineTo(X(sq.t90), yT + 4); ctx.moveTo(X(sq.tEcho), yT - 4); ctx.lineTo(X(sq.tEcho), yT + 4); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = SMALL;
    haloText(ctx, `TE = ${tickLabel(+sq.TE.toFixed(1))} ms`, (X(sq.t90) + X(sq.tEcho)) / 2, yT, c.ink2, c.panel, 6);
    if (sq.t180 !== null) { ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(X(sq.t180), b.y0); ctx.lineTo(X(sq.t180), b.y1); ctx.stroke(); ctx.setLineDash([]); }
    ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(X(sq.tEcho), b.y0); ctx.lineTo(X(sq.tEcho), b.y1); ctx.stroke(); ctx.setLineDash([]);
    // Now.
    if (this.scan.cur) {
      ctx.strokeStyle = c.ink; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(X(t), b.y0 - 2); ctx.lineTo(X(t), b.y1 + 2); ctx.stroke();
    }
    // Ticks along time.
    ctx.fillStyle = c.ink3; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText('t (ms)', b.x0 - 8, b.y1 + 2);
    ctx.textAlign = 'center';
    for (const v of niceTicks(0, tEnd, this.lay.narrow ? 4 : 8)) ctx.fillText(tickLabel(v), X(v), b.y1 + 2);
    ctx.restore();
    this.seqBox = b;
  }

  readout() {
    const sq = this.seq, box = $('#v3-readout'), q = this.curQ, t = this.tNow, N = sq.N;
    const lines = [];
    if (q !== null) {
      const ky = sq.ky(q), Gy = sq.Gy(q);
      lines.push(['This line: row ', { v: N / 2 - q, dec: 0, w: 4, plus: '+' }, ` of ±${N / 2}, k_y = `, { v: ky, dec: 4, w: 7, plus: '+' }, ' per mm, wound by G_y = ', { v: Gy, dec: 2, w: 5, plus: '+' }, ' mT/m for ', { v: sq.Tpe, dec: 1, w: 3 }, ' ms: stripes along y ', ...(Math.abs(ky) > 1e-9 ? [{ v: 1 / Math.abs(ky), dec: 1, w: 5, class: 'b' }, ' mm apart.'] : [{ text: '∞', w: 5, class: 'b' }, ' apart (none).'])]);
      const se = sq.t180 !== null;
      const stage = t < sq.t90 ? 'the π/2 pulse tips the slice' : t < sq.gyStart ? 'the slice\'s rephasing lobe'
        : t < sq.preStart ? `the phase-encoding lobe winds stripes along y${se ? ' (the π pulse will turn them round)' : ''}`
        : t < sq.preEnd ? (se ? 'the prephasing lobe, +G_x, moves k to the right end of the row' : 'the prephasing lobe, −G_x, moves k to the left end of the row')
        : se && t < sq.t180 - sq.Trf / 2 ? 'waiting for the π pulse' : se && t < sq.t180 + sq.Trf / 2 ? 'the π pulse: every phase turns around, k → −k'
        : t < sq.adc[0] ? 'waiting for the echo' : t <= sq.adc[1] ? 'the readout: the ADC records the signal while k sweeps along the row' : 'the line is measured';
      lines.push(['Now t = ', { v: t, dec: 2, w: 5 }, ' ms: ', stage, '.']);
    } else {
      const all = this.acq.measuredCount === N;
      lines.push([this.scan.done && all ? 'The scan is complete: every row of k-space measured.' : this.scan.done ? `Only some rows measured (${this.whichRows()}); the others are zero.` : 'Paused between lines.'],
        [all ? 'Press Again to scan again, or click a row of k-space to play it in slow motion.' : 'Press Step to play one line in slow motion, or Play.']);
    }
    const n = this.acq.measuredCount;
    // The detail along y: one over the span of ky measured (the middle rows, as far out as they go unbroken).
    let lo = N / 2, hi = N / 2;
    if (this.acq.mask[N / 2]) { while (lo > 0 && this.acq.mask[lo - 1]) lo--; while (hi < N - 1 && this.acq.mask[hi + 1]) hi++; }
    const span = this.acq.mask[N / 2] ? (hi - lo + 1) * sq.dk : 0;
    lines.push(['The picture from ', { v: n, dec: 0, w: 3, class: 'b' }, ` of ${N} lines: detail along y down to `, ...(span > 0 ? [{ v: 1 / span, dec: 1, w: 5, class: 'b' }, ' mm'] : [{ text: '—', w: 5 }, '']), ' (along x, from the readout, ', { v: FOV / N, dec: 1, w: 4 }, ' mm).']);
    if (this.hover) {
      const kx = (this.hover.p - N / 2) * sq.dk, ky = (N / 2 - this.hover.q) * sq.dk, kk = Math.hypot(kx, ky);
      lines[lines.length - 1] = ['Pointed at: k = (', { v: kx, dec: 4, w: 7, plus: '+' }, ', ', { v: ky, dec: 4, w: 7, plus: '+' }, ') per mm, a plane wave with a turn every ',
        ...(kk > 1e-9 ? [{ v: 1 / kk, dec: 1, w: 5, class: 'b' }, ' mm'] : [{ text: '∞', w: 5 }, '']), ': this pixel of k-space is how much of the slice is in step with it.'];
    }
    if (box.children.length !== lines.length) box.replaceChildren(...lines.map(() => el('div')));
    lines.forEach((l, i) => setSlots(box.children[i], l));
  }

  /** In words, which rows have been measured: the middle ones, all but the middle, or some. */
  whichRows() {
    const N = this.seq.N, m = this.acq.mask;
    let lo = N / 2, hi = N / 2;
    if (m[N / 2]) { while (lo > 0 && m[lo - 1]) lo--; while (hi < N - 1 && m[hi + 1]) hi++; }
    const n = this.acq.measuredCount;
    if (m[N / 2] && hi - lo + 1 === n) return 'the middle ones';
    if (!m[N / 2] && !m[N / 2 - 1] && m[0] && m[N - 1]) return 'all but the middle';
    return this.s.order === 'up' && m[N - 1] ? 'from the bottom' : 'some';
  }

  // ------------------------------------------------------------------- the pointer

  bindPointer() {
    const cv = this.canvas, xy = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const inBox = (b, px, py) => b && px >= b.x0 && px < b.x0 + b.s && py >= b.y0 && py < b.y0 + b.s;
    const kPixel = (px, py) => { const b = this.kBox, N = this.seq.N; return { p: Math.floor(((px - b.x0) / b.s) * N), q: Math.floor(((py - b.y0) / b.s) * N) }; };
    const toMM = (px, py) => { const b = this.spinBox; return [((px - b.x0) / b.s - 0.5) * FOV, (0.5 - (py - b.y0) / b.s) * FOV]; };
    cv.addEventListener('pointerdown', (e) => {
      const [px, py] = xy(e);
      if (inBox(this.kBox, px, py)) { const k = kPixel(px, py); this.measureRow(k.q); return; }
      if (this.s.obj === 'disks' && inBox(this.spinBox, px, py)) {
        const [x, y] = toMM(px, py);
        let best = -1, bd = Infinity;
        this.s.disks.forEach((d, i) => { const r = Math.hypot(x - d.x, y - d.y); if (r < d.a && r < bd) { bd = r; best = i; } });
        if (best >= 0) { cv.setPointerCapture(e.pointerId); this.drag = { i: best, dx: x - this.s.disks[best].x, dy: y - this.s.disks[best].y }; }
      }
    });
    cv.addEventListener('pointermove', (e) => {
      const [px, py] = xy(e);
      if (this.drag) {
        const [x, y] = toMM(px, py), d = this.s.disks[this.drag.i];
        d.x = Math.max(-110, Math.min(110, +(x - this.drag.dx).toFixed(1))); d.y = Math.max(-110, Math.min(110, +(y - this.drag.dy).toFixed(1)));
        this.rebuild(); this.app.kick();
        return;
      }
      const h = inBox(this.kBox, px, py) ? kPixel(px, py) : null;
      if (JSON.stringify(h) !== JSON.stringify(this.hover)) { this.hover = h; this.dirty = true; this.app.kick(); }
      cv.style.cursor = h ? 'pointer' : this.s.obj === 'disks' && inBox(this.spinBox, px, py) ? 'grab' : 'default';
    });
    cv.addEventListener('pointerleave', () => { if (this.hover) { this.hover = null; this.dirty = true; this.app.kick(); } });
    const end = () => { this.drag = null; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  }

  probe() {
    return { q: this.curQ, u: this.scan.cur?.u ?? null, t: this.tNow, measured: this.acq.measuredCount, N: this.seq.N, done: this.scan.done, playing: this.s.playing,
      seq: { type: this.seq.type, TE: this.seq.TE, t90: this.seq.t90, t180: this.seq.t180, tEcho: this.seq.tEcho, adc: this.seq.adc, tEnd: this.seq.tEnd, dk: this.seq.dk },
      lay: this.lay, k: this.kNow() };
  }
}

/** A brightness for k-space: the magnitude that 3% of its pixels exceed (so the centre's
 *  bright few do not drown the rest), as the FFT demo's transforms are drawn. */
function kspaceBrightness(re, im) {
  const n = re.length, mags = new Float64Array(n);
  for (let i = 0; i < n; i++) mags[i] = Math.hypot(re[i], im[i]);
  mags.sort();
  return mags[Math.floor(0.97 * (n - 1))] || 1;
}
