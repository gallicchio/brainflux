// View 4 · Contrast and artefacts.  The same slice made into a picture with the whole of
// k-space at once, so that every setting shows its effect immediately: TR and TE (dragged on
// the curves of recovery along z and of the echo's decay) turn it T1-weighted, T2-weighted or
// proton-density weighted; a field of view smaller than the head wraps it round; fewer
// phase-encoding lines blur and ring along y; noise, and averaging; fat's chemical shift along
// the readout.  And Lauterbur's way (1973): no phase encoding, a gradient turned to many
// angles, each spectrum a projection, back-projected as in the tomography demo.

import { GB, larmorMHz } from './bloch.js';
import { headPhantom, disksPhantom, disk, TISSUES, tissueAt, weighting, projection } from './phantom.js';
import { sequence, Acquisition, backprojection, projections } from './scan.js';
import { el, $, slider, segmented, toggle, setSlots } from '../lib/ui.js';
import { fitCanvas, themeColors, fillSlots, niceTicks, tickLabel } from '../lib/plot.js';
import { complexImage, greyImage, arrow, handle, FONT, SMALL, BOLD, haloText } from './draw.js';

const SHOWN = ['water', 'fat', 'grey', 'white', 'lesion'];
export const CONTRASTS = {
  t1: { label: 'T₁-weighted', TR: 500, TE: 15, title: 'Short TR and short TE: what differs is how far each tissue has recovered along z, so short T₁ is bright (fat), long T₁ dark (fluid)' },
  t2: { label: 'T₂-weighted', TR: 3000, TE: 100, title: 'Long TR (all recover) and long TE: what differs is how fast the echo fades, so long T₂ is bright (fluid, oedema)' },
  pd: { label: 'Proton density', TR: 3000, TE: 15, title: 'Long TR and short TE: nearly every tissue has recovered and hardly faded, so what shows is how many protons it has' },
};
const TMAX1 = 5000, TMAX2 = 300;   // the time axes of the two curves (ms)

export class ContrastView {
  constructor(app) {
    this.app = app;
    this.canvas = $('#v4-main');
    this.s = {
      obj: 'head', mode: 'fourier', type: 'se', TR: 500, TE: 15, N: 128, fov: 256, lines: 128, sigma: 0, nsa: 1, fat: false, Gx: 4, B0: 1.5, T2p: 60,
      nA: 12, filter: true, rate: 3, playing: true, sweep: false,
    };
    this.sweepU = 0; this.sweepDir = 1;
    this.acq = new Acquisition();
    this.lb = { j: 0, u: 0 };   // Lauterbur: angles measured, and the next one's progress
    this.drag = null;
    this.buildControls();
    this.rebuild();
    this.bindPointer();
  }

  shapes() {
    if (this.s.obj === 'disks') return disksPhantom();
    return headPhantom(this.app.slice?.z ?? 0);
  }

  rebuild() {
    const s = this.s;
    // (Short pulses and lobes: this view plays no line, and a short TE must be possible.)
    this.seq = sequence({ type: s.type, TE: s.TE, TR: s.TR, N: s.N, fov: s.fov, Gx: s.Gx, Tpe: 1, Trf: 2, T2prime: s.T2p });
    // A TE shorter than the sequence allows is used as the shortest it allows (and the readout says so).
    this.teRaised = this.seq.TE > s.TE + 1e-9;
    this.TE = this.seq.TE;
    this.acq.N = 0;
    this.acq.set({ shapes: this.shapes(), seq: this.seq, B0: s.B0, sigma: s.sigma, nsa: s.nsa, chemicalShift: s.fat, seed: 7 });
    // The phase-encoding lines measured: the middle `lines` of them.
    const N = s.N, L = Math.min(s.lines, N), lo = N / 2 - Math.floor(L / 2);
    for (let q = lo; q < lo + L; q++) this.acq.measure(q);
    this.img = this.acq.image();
    let top = 0;
    const v = Float64Array.from(this.img.mag).sort();
    top = v[Math.floor(0.997 * (v.length - 1))] || 1;
    this.vmax = top;
    this.kR = kspaceBrightness(this.acq.mre, this.acq.mim);
    this.weights = this.tissueWeights();
    if (s.mode === 'lauterbur') this.buildLauterbur();
    document.querySelector('#main').dataset.mode = s.mode;
    const hint = document.querySelector('#v4-hint');
    if (hint) hint.textContent = s.mode === 'lauterbur' ? 'Watch the gradient turn: each angle\'s spectrum is one projection, smeared back across the picture; raise the angles to sharpen it'
      : s.sweep ? 'TR and TE are sweeping from T₁- to T₂-weighting: drag the TR line or the TE line to take over; the dots where they cross the curves are each tissue\'s brightness'
      : 'Drag the TR line on the recovery curves and the TE line on the echo\'s: the dots where they cross are each tissue\'s brightness in the picture';
    this.madeAt = this.app.slice?.z ?? 0;
    this.dirty = true;
    this.app.scheduleHash();
  }

  /** Each tissue's brightness, rho w, at the settings. */
  tissueWeights() {
    const s = this.s, out = {};
    for (const n of SHOWN) { const t = tissueAt(n, s.B0); out[n] = t.rho * weighting(t, { TR: s.TR, TE: this.TE, type: s.type, T2prime: s.T2p }); }
    return out;
  }

  // ------------------------------------------------------------------- Lauterbur

  buildLauterbur() {
    const s = this.s, N = s.N, dx = s.fov / N, pic = this.acq.picture.total;
    this.angles = Float64Array.from({ length: s.nA }, (_, j) => (j * Math.PI) / s.nA);
    this.profiles = projections(pic, N, dx, this.angles).profiles;
    this.lb.j = Math.min(this.lb.j, s.nA);
    this.bp = null;
  }
  /** The back-projection of the angles measured so far. */
  backproj() {
    const s = this.s, j = this.lb.j;
    if (this.bp && this.bp.j === j && this.bp.filter === s.filter) return this.bp;
    const N = s.N, dx = s.fov / N;
    const r = j ? backprojection(this.profiles.slice(0, j), this.angles.slice(0, j), N, dx, s.filter) : { filtered: new Float64Array(N * N), unfiltered: new Float64Array(N * N) };
    // (Measured over half a turn so far: the sum is scaled as if the other angles were alike, so
    // the picture's brightness does not grow as angles come in.)
    const img = s.filter ? r.filtered : r.unfiltered, scale = j ? s.nA / j : 1;
    for (let i = 0; i < img.length; i++) img[i] *= scale;
    let top = 0;
    for (const v of img) top = Math.max(top, v);
    this.bp = { j, filter: s.filter, img, top: top || 1 };
    return this.bp;
  }

  /** The opening's sweep: TR and TE glide together (logarithmically) from T1-weighting
   *  (500, 15 ms) to T2-weighting (3000, 100 ms) and back, 7 s each way, until a drag. */
  sweepTo(u) {
    const s = this.s;
    this.sweepU = u;
    s.TR = Math.round(500 * 6 ** u); s.TE = +(15 * (100 / 15) ** u).toFixed(1);
    this.trSl.value = s.TR; this.teSl.value = s.TE;
    this.custom('TR'); this.rebuild();
  }
  stopSweep() { if (this.s.sweep) { this.s.sweep = false; this.sweepBtn.on = false; this.app.scheduleHash(); } }

  advance(dt) {
    if (this.s.mode === 'fourier' && this.s.sweep) {
      let u = this.sweepU + (this.sweepDir * dt) / 7;
      if (u >= 1) { u = 1; this.sweepDir = -1; } else if (u <= 0) { u = 0; this.sweepDir = 1; }
      this.sweepTo(u);
      return;
    }
    if (this.s.mode !== 'lauterbur' || !this.s.playing) return;
    const lb = this.lb;
    if (lb.j >= this.s.nA) { this.setPlaying(false); return; }
    lb.u += dt * this.s.rate;
    while (lb.u >= 1 && lb.j < this.s.nA) { lb.u -= 1; lb.j++; this.bp = null; }
    if (lb.j >= this.s.nA) { lb.u = 0; this.setPlaying(false); }
    this.dirty = true;
  }
  get animating() { return (this.s.mode === 'lauterbur' && this.s.playing) || (this.s.mode === 'fourier' && this.s.sweep); }
  /** Lauterbur: measure one more angle and stop. */
  step() {
    if (this.s.mode !== 'lauterbur') return;
    this.setPlaying(false);
    if (this.lb.j < this.s.nA) { this.lb.j++; this.lb.u = 0; this.bp = null; }
    this.dirty = true; this.app.kick();
  }
  setPlaying(on) { this.s.playing = on; if (this.playBtn) this.playBtn.textContent = on ? 'Pause' : this.lb.j >= this.s.nA ? 'Again' : 'Go on'; this.app.kick(); }

  // ------------------------------------------------------------------- controls

  buildControls() {
    const s = this.s, set = (k, rebuild = true) => (v) => { if (k === 'TR' || k === 'TE') this.stopSweep(); s[k] = v; this.custom(k); if (rebuild) this.rebuild(); this.app.kick(); };
    this.modeSeg = segmented([{ value: 'fourier', label: 'Phase encoding', title: 'The picture as views 1 to 3 make it: k-space line by line, then the inverse 2D FFT' },
      { value: 'lauterbur', label: 'Lauterbur (1973)', title: 'How MRI began: a gradient turned to many angles, each spectrum a projection, back-projected' }], s.mode,
      (v) => { s.mode = v; this.lb.j = 0; this.lb.u = 0; this.rebuild(); this.setPlaying(v === 'lauterbur'); }, { label: 'Picture by' });
    $('#v4-mode-row').append(this.modeSeg);
    // Contrast.
    this.cBtns = {};
    for (const [id, cpr] of Object.entries(CONTRASTS)) {
      const b = el('button', { type: 'button', title: cpr.title, 'aria-pressed': 'false', onclick: () => this.setContrast(id) }, cpr.label);
      $('#v4-contrast-row').append(b); this.cBtns[id] = b;
    }
    this.trSl = slider({ label: 'repeat time TR (ms)', min: 100, max: 6000, log: true, value: s.TR, title: 'From one π/2 pulse to the next: the time the spins have to recover along z', onInput: set('TR') });
    this.teSl = slider({ label: 'echo time TE (ms)', min: 4, max: 250, log: true, value: s.TE, step: 0.5, title: 'From the π/2 pulse to the echo: the time the signal has to fade', onInput: set('TE') });
    $('#v4-contrast-box').append(this.trSl, this.teSl);
    this.typeSeg = segmented([{ value: 'se', label: 'Spin echo' }, { value: 'gre', label: 'Gradient echo' }], s.type, (v) => { s.type = v; this.rebuild(); this.app.kick(); }, { label: 'Sequence' });
    this.sweepBtn = toggle('Sweep', s.sweep, (on) => { s.sweep = on; if (on) { this.sweepU = 0; this.sweepDir = 1; } this.app.kick(); this.app.scheduleHash(); }, 'Let TR and TE glide by themselves between T₁- and T₂-weighting');
    $('#v4-type-row').append(this.typeSeg, this.sweepBtn);
    // The scan's settings.
    this.fovSl = slider({ label: 'field of view (mm)', min: 120, max: 320, step: 1, value: s.fov, title: 'How big a square the picture covers; k-space is sampled every 1/FOV', onInput: (v) => { s.fov = v; this.rebuild(); this.app.kick(); } });
    this.linesSl = slider({ label: 'phase lines', min: 8, max: 256, step: 1, value: s.lines, title: 'How many rows of k-space are measured (the middle ones); the rest are taken as zero', onInput: (v) => { s.lines = Math.round(v); this.rebuild(); this.app.kick(); } });
    this.nSeg = segmented([64, 128, 256].map((n) => ({ value: n, label: String(n) })), s.N, (v) => { s.N = v; s.lines = Math.min(s.lines === this.lastN ? v : s.lines, v); this.lastN = v; this.linesSl.setRange(8, v); this.linesSl.value = s.lines; this.rebuild(); this.app.kick(); }, { label: 'Matrix' });
    this.lastN = s.N;
    this.noiseSl = slider({ label: 'noise σ (%)', min: 0, max: 20, step: 0.1, value: 100 * s.sigma, title: 'The receiver\'s noise per sample, as a percentage of the brightest pixel', onInput: (v) => { s.sigma = v / 100; this.rebuild(); this.app.kick(); } });
    this.nsaSl = slider({ label: 'averages', min: 1, max: 16, step: 1, value: s.nsa, title: 'Measure every line this many times and average: the noise falls as 1/√(averages), the time grows in proportion', onInput: (v) => { s.nsa = Math.round(v); this.rebuild(); this.app.kick(); } });
    $('#v4-scan-box').append(this.fovSl, this.linesSl, el('div', { class: 'row' }, el('span', { class: 'small muted' }, 'matrix'), this.nSeg), this.noiseSl, this.nsaSl);
    this.fatBtn = toggle('Fat\'s chemical shift', s.fat, (on) => { s.fat = on; this.rebuild(); this.app.kick(); }, 'Fat\'s protons turn 3.4 parts per million slower than water\'s: under the readout gradient that is a shift along x');
    this.gxSl = slider({ label: 'readout G_x (mT/m)', min: 0.3, max: 8, log: true, value: s.Gx, title: 'The readout gradient: the weaker it is, the further fat\'s small offset in frequency moves it', onInput: (v) => { s.Gx = v; this.rebuild(); this.app.kick(); } });
    $('#v4-fat-box').append(el('div', { class: 'row' }, this.fatBtn), this.gxSl);
    this.objSeg = segmented([{ value: 'head', label: 'The head' }, { value: 'disks', label: 'Three disks' }], s.obj, (v) => { s.obj = v; this.rebuild(); this.app.kick(); }, { label: 'Object' });
    this.b0Seg = segmented([{ value: 1.5, label: '1.5 T' }, { value: 3, label: '3 T' }], s.B0, (v) => { s.B0 = v; this.rebuild(); this.app.kick(); }, { label: 'Field' });
    $('#v4-obj-row').append(this.objSeg, this.b0Seg);
    // Lauterbur.
    this.playBtn = el('button', { type: 'button', class: 'primary play', onclick: () => { if (this.lb.j >= s.nA) { this.lb.j = 0; this.lb.u = 0; this.bp = null; } this.setPlaying(!s.playing); } }, 'Pause');
    $('#v4-lb-row').append(this.playBtn,
      el('button', { type: 'button', title: 'One more angle (→ key)', onclick: () => this.step() }, 'Step'),
      el('button', { type: 'button', title: 'Every angle at once', onclick: () => { this.lb.j = s.nA; this.bp = null; this.setPlaying(false); this.dirty = true; this.app.kick(); } }, 'Finish'));
    this.nASl = slider({ label: 'angles', min: 2, max: 180, step: 1, value: s.nA, title: 'How many directions the gradient is turned to, over half a turn', onInput: (v) => { s.nA = Math.round(v); this.lb.j = Math.min(this.lb.j, s.nA); this.buildLauterbur(); this.dirty = true; this.app.kick(); this.app.scheduleHash(); } });
    this.filterBtn = toggle('Ramp filter', s.filter, (on) => { s.filter = on; this.bp = null; this.dirty = true; this.app.kick(); this.app.scheduleHash(); }, 'Sharpen each projection before smearing it back (filtered back-projection); off, the plain back-projection is blurred');
    $('#v4-lb-box').append(this.nASl, el('div', { class: 'row' }, this.filterBtn));
  }

  custom(k) {
    if (k === 'TR' || k === 'TE') for (const [id, b] of Object.entries(this.cBtns)) b.setAttribute('aria-pressed', String(CONTRASTS[id].TR === this.s.TR && CONTRASTS[id].TE === this.s.TE));
  }
  setContrast(id) {
    this.stopSweep();
    const cpr = CONTRASTS[id];
    this.s.TR = cpr.TR; this.s.TE = cpr.TE; this.trSl.value = cpr.TR; this.teSl.value = cpr.TE;
    this.custom('TR'); this.rebuild(); this.app.kick();
  }

  set(o) {
    const s = this.s;
    for (const k of Object.keys(s)) if (o[k] !== undefined) s[k] = o[k];
    if (o.contrast) { s.TR = CONTRASTS[o.contrast].TR; s.TE = CONTRASTS[o.contrast].TE; }
    this.modeSeg.value = s.mode; this.trSl.value = s.TR; this.teSl.value = s.TE; this.typeSeg.value = s.type; this.fovSl.value = s.fov;
    this.linesSl.setRange(8, s.N); this.linesSl.value = s.lines; this.nSeg.value = s.N; this.lastN = s.N; this.noiseSl.value = 100 * s.sigma; this.nsaSl.value = s.nsa;
    this.fatBtn.on = s.fat; this.gxSl.value = s.Gx; this.objSeg.value = s.obj; this.b0Seg.value = s.B0; this.nASl.value = s.nA; this.filterBtn.on = s.filter;
    this.sweepBtn.on = s.sweep; this.sweepU = 0; this.sweepDir = 1;
    this.custom('TR');
    this.lb.j = o.angles ?? 0; this.lb.u = 0;
    this.rebuild();
    this.setPlaying(s.mode === 'lauterbur' && (o.playing ?? true) && this.lb.j < s.nA);
  }
  toHash() {
    const s = this.s, r = (v) => +(+v).toPrecision(4);
    return { obj: s.obj, md: s.mode !== 'fourier' ? s.mode : undefined, seq: s.type, TR: r(s.TR), TE: r(s.TE), N: s.N, fov: r(s.fov), ln: s.lines !== s.N ? s.lines : undefined,
      sg: s.sigma ? r(s.sigma) : undefined, nsa: s.nsa > 1 ? s.nsa : undefined, fat: s.fat ? 1 : undefined, Gx: s.Gx !== 4 ? r(s.Gx) : undefined, B0: s.B0 !== 1.5 ? s.B0 : undefined,
      nA: s.mode === 'lauterbur' ? s.nA : undefined, flt: s.mode === 'lauterbur' && !s.filter ? 0 : undefined, z: r(this.app.slice?.z ?? 0) };
  }
  fromHash(h) {
    const num = (v, d, lo = -Infinity, hi = Infinity) => (v !== undefined && Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);
    if (h.z !== undefined) this.app.slice = { ...(this.app.slice || {}), z: num(h.z, 0, -125, 125) };
    const N = [64, 128, 256].includes(+h.N) ? +h.N : 128;
    this.set({ obj: h.obj === 'disks' ? 'disks' : 'head', mode: h.md === 'lauterbur' ? 'lauterbur' : 'fourier', type: h.seq === 'gre' ? 'gre' : 'se', TR: num(h.TR, 500, 20, 20000), TE: num(h.TE, 15, 1, 500),
      N, fov: num(h.fov, 256, 60, 600), lines: Math.round(num(h.ln, N, 2, N)), sigma: num(h.sg, 0, 0, 1), nsa: Math.round(num(h.nsa, 1, 1, 64)), fat: h.fat === '1', Gx: num(h.Gx, 4, 0.05, 50),
      B0: num(h.B0, 1.5) === 3 ? 3 : 1.5, nA: Math.round(num(h.nA, 12, 1, 360)), filter: h.flt !== '0' });
  }

  // ------------------------------------------------------------------- layout

  layout(W, H) {
    const narrow = W < 700;
    if (narrow) {
      const S = W - 16;
      const img = { x0: 8, y0: 24, s: S };
      const p1 = { x0: 46, x1: W - 10, y0: img.y0 + S + 56, y1: img.y0 + S + 56 + 150 };
      const p2 = { x0: 46, x1: W - 10, y0: p1.y1 + 50, y1: p1.y1 + 50 + 150 };
      const k = { x0: 8, y0: p2.y1 + 56, s: Math.round(0.5 * (W - 24)) };
      const bars = { x0: k.x0 + k.s + 12, x1: W - 8, y0: k.y0, y1: k.y0 + k.s };
      return { narrow, W, H, img, p1, p2, k, bars };
    }
    const S = Math.min(H - 60, Math.round(0.46 * W));
    const img = { x0: 10, y0: 24, s: S };
    const rx0 = img.x0 + S + 56, rw = W - rx0 - 14, ph = Math.round(0.42 * (H - 70));
    const p1 = { x0: rx0, x1: rx0 + Math.round(0.47 * rw) - 10, y0: 30, y1: 30 + ph };
    const p2 = { x0: p1.x1 + 48, x1: W - 14, y0: 30, y1: 30 + ph };
    const ks = Math.min(H - (p1.y1 + 80) - 30, Math.round(0.45 * rw));
    const k = { x0: rx0 - 10, y0: p1.y1 + 66, s: ks };
    const bars = { x0: k.x0 + ks + 40, x1: W - 14, y0: k.y0, y1: k.y0 + ks };
    return { narrow, W, H, img, p1, p2, k, bars };
  }

  // ------------------------------------------------------------------- drawing

  draw() {
    const { ctx, width: W, height: H } = fitCanvas(this.canvas);
    const c = { ...themeColors(), ...this.app.colors };
    this.tc = this.app.colors.tissue;
    this.lay = this.layout(W, H);
    ctx.clearRect(0, 0, W, H);
    if (this.s.mode === 'lauterbur') {
      this.drawLauterburImage(ctx, c, this.lay.img);
      this.drawProjection(ctx, c);
      this.drawSinogram(ctx, c, this.lay.k);
    } else {
      this.drawPicture(ctx, c, this.lay.img);
      this.drawRecovery(ctx, c, this.lay.p1);
      this.drawDecay(ctx, c, this.lay.p2);
      this.drawKspace(ctx, c, this.lay.k);
    }
    this.drawBars(ctx, c, this.lay.bars);
    this.readout();
    this.dirty = false;
  }

  title(ctx, c, x, y, text, sub) {
    ctx.save();
    ctx.font = BOLD; ctx.fillStyle = c.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, x, y);
    if (sub) { const w = ctx.measureText(text).width; ctx.font = FONT; ctx.fillStyle = c.ink2; ctx.fillText(sub, x + w, y); }
    ctx.restore();
  }

  drawPicture(ctx, c, b) {
    const N = this.s.N, S = b.s;
    greyImage(ctx, this.img.mag, N, N, b.x0, b.y0, S, S, this.vmax, N < 128);
    ctx.save();
    ctx.strokeStyle = c.line; ctx.strokeRect(b.x0 - 0.5, b.y0 - 0.5, S + 1, S + 1);
    const which = Object.entries(CONTRASTS).find(([, cp]) => cp.TR === this.s.TR && cp.TE === this.s.TE);
    this.title(ctx, c, b.x0, b.y0 - 8, 'The picture', which && !this.teRaised ? `: ${which[1].label}` : `: TR ${tickLabel(+this.s.TR.toFixed(0))} ms, TE ${tickLabel(+this.TE.toFixed(1))} ms`);
    // With fat's shift on: where the fat really is, dashed.
    const mm = S / this.s.fov, bar = 50 * mm;
    if (this.s.fat) {
      ctx.save(); ctx.beginPath(); ctx.rect(b.x0, b.y0, S, S); ctx.clip();
      ctx.strokeStyle = this.tc.fat; ctx.lineWidth = 1.3; ctx.setLineDash([4, 3]);
      const cx = b.x0 + S / 2, cy = b.y0 + S / 2;
      for (const e of this.shapes()) if (e.tissue === 'fat') { ctx.beginPath(); ctx.ellipse(cx + e.x * mm, cy - e.y * mm, e.a * mm, e.b * mm, -e.phi, 0, 2 * Math.PI); ctx.stroke(); }
      ctx.restore();
      ctx.font = SMALL; ctx.fillStyle = this.tc.fat; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('dashed: where the fat really is', b.x0 + 8, b.y0 + 8);
    }
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(b.x0 + 10, b.y0 + S - 12); ctx.lineTo(b.x0 + 10 + bar, b.y0 + S - 12); ctx.stroke();
    ctx.font = SMALL; ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('50 mm', b.x0 + 10, b.y0 + S - 15);
    ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('x: readout (frequency) →', b.x0 + S - 8, b.y0 + S - 6);
    ctx.save(); ctx.translate(b.x0 + S - 8, b.y0 + 8); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText('y: phase encoding →', 0, 0); ctx.restore();
    ctx.font = SMALL; ctx.fillStyle = c.ink2; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    fillSlots(ctx, [`${N} × ${N} pixels of `, { v: this.s.fov / N, dec: 2, w: 4 }, ' mm; ', { v: this.acq.measuredCount, dec: 0, w: 3 }, ` of ${N} phase lines`], b.x0, b.y0 + S + 5);
    ctx.restore();
  }

  /** Mz(t) = rho (1 - e^{-t/T1}) for each tissue, with the TR line. */
  drawRecovery(ctx, c, b) {
    const s = this.s, X = (t) => b.x0 + (t / TMAX1) * (b.x1 - b.x0), Y = (v) => b.y1 - v * (b.y1 - b.y0 - 6);
    ctx.save();
    this.title(ctx, c, b.x0, b.y0 - 10, 'Recovery along z', this.lay.narrow ? '' : ', after each pulse');
    ctx.strokeStyle = c.line; ctx.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0 - 1, b.y1 - b.y0 - 1);
    for (const n of SHOWN) {
      const t = tissueAt(n, s.B0);
      ctx.strokeStyle = this.tc[n]; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i <= 120; i++) { const tt = (TMAX1 * i) / 120, y = Y(t.rho * (1 - Math.exp(-tt / t.T1))); i ? ctx.lineTo(X(tt), y) : ctx.moveTo(X(tt), y); }
      ctx.stroke();
      const v = t.rho * (1 - Math.exp(-s.TR / t.T1));
      ctx.fillStyle = this.tc[n]; ctx.strokeStyle = c.panel; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(X(Math.min(s.TR, TMAX1)), Y(v), 4.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    }
    // The TR line and its handle.
    const xt = X(Math.min(s.TR, TMAX1));
    ctx.strokeStyle = c.ink; ctx.lineWidth = 1.4; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(xt, b.y0); ctx.lineTo(xt, b.y1); ctx.stroke(); ctx.setLineDash([]);
    handle(ctx, xt, b.y0, 7, c.panel, c.ink);
    this.trHandle = { x: xt, y: b.y0, b };
    ctx.font = SMALL; ctx.fillStyle = c.ink; ctx.textAlign = xt > b.x1 - 70 ? 'right' : 'left'; ctx.textBaseline = 'top';
    fillSlots(ctx, ['TR = ', { v: s.TR, dec: 0, w: 4 }, ' ms'], xt + (xt > b.x1 - 70 ? -10 : 10), b.y0 + 4);
    ctx.fillStyle = c.ink2; ctx.textAlign = 'center';
    for (const v of niceTicks(0, TMAX1, 4)) ctx.fillText(tickLabel(v / 1000), X(v), b.y1 + 3);
    ctx.textAlign = 'right'; ctx.fillText('t (s)', b.x1, b.y1 + 16);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const v of [0, 0.5, 1]) ctx.fillText(tickLabel(v), b.x0 - 4, Y(v));
    ctx.restore();
  }

  /** The echo after the pulse: rho (1 - e^{-TR/T1}) e^{-t/T2} (T2* for a gradient echo), with the TE line. */
  drawDecay(ctx, c, b) {
    const s = this.s, X = (t) => b.x0 + (t / TMAX2) * (b.x1 - b.x0), Y = (v) => b.y1 - v * (b.y1 - b.y0 - 6);
    ctx.save();
    this.title(ctx, c, b.x0, b.y0 - 10, 'The echo fades', this.lay.narrow ? '' : `, as ${s.type === 'se' ? 'T₂' : 'T₂*'}`);
    ctx.strokeStyle = c.line; ctx.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0 - 1, b.y1 - b.y0 - 1);
    for (const n of SHOWN) {
      const t = tissueAt(n, s.B0), m0 = t.rho * (1 - Math.exp(-s.TR / t.T1)), T2 = s.type === 'gre' ? 1 / (1 / t.T2 + 1 / s.T2p) : t.T2;
      ctx.strokeStyle = this.tc[n]; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i <= 120; i++) { const tt = (TMAX2 * i) / 120, y = Y(m0 * Math.exp(-tt / T2)); i ? ctx.lineTo(X(tt), y) : ctx.moveTo(X(tt), y); }
      ctx.stroke();
      ctx.fillStyle = this.tc[n]; ctx.strokeStyle = c.panel; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(X(Math.min(this.TE, TMAX2)), Y(this.weights[n]), 4.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    }
    const xt = X(Math.min(this.TE, TMAX2));
    ctx.strokeStyle = c.ink; ctx.lineWidth = 1.4; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(xt, b.y0); ctx.lineTo(xt, b.y1); ctx.stroke(); ctx.setLineDash([]);
    handle(ctx, xt, b.y0, 7, c.panel, c.ink);
    this.teHandle = { x: xt, y: b.y0, b };
    ctx.font = SMALL; ctx.fillStyle = c.ink; ctx.textAlign = xt > b.x1 - 70 ? 'right' : 'left'; ctx.textBaseline = 'top';
    fillSlots(ctx, ['TE = ', { v: this.TE, dec: 0, w: 3 }, ' ms'], xt + (xt > b.x1 - 70 ? -10 : 10), b.y0 + 4);
    ctx.fillStyle = c.ink2; ctx.textAlign = 'center';
    for (const v of niceTicks(0, TMAX2, 4)) ctx.fillText(tickLabel(v), X(v), b.y1 + 3);
    ctx.textAlign = 'right'; ctx.fillText('t (ms)', b.x1, b.y1 + 16);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const v of [0, 0.5, 1]) ctx.fillText(tickLabel(v), b.x0 - 4, Y(v));
    ctx.restore();
  }

  drawKspace(ctx, c, b) {
    const N = this.s.N, S = b.s;
    complexImage(ctx, this.acq.mre, this.acq.mim, N, N, b.x0, b.y0, S, S, this.kR, false);
    ctx.save();
    const rh = S / N;
    ctx.fillStyle = c.line; ctx.globalAlpha = 0.55;
    for (let q = 0; q < N; q++) if (!this.acq.mask[q]) ctx.fillRect(b.x0, b.y0 + q * rh, S, rh);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = c.line; ctx.strokeRect(b.x0 - 0.5, b.y0 - 0.5, S + 1, S + 1);
    this.title(ctx, c, b.x0, b.y0 - 8, 'K-space', this.lay.narrow ? '' : ' as measured');
    ctx.font = SMALL; ctx.fillStyle = c.ink2; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    fillSlots(ctx, ['samples every 1/FOV = ', { v: 1 / this.s.fov, dec: 4, w: 6 }, ' per mm'], b.x0, b.y0 + S + 5);
    ctx.restore();
  }

  /** Each tissue's brightness at these settings. */
  drawBars(ctx, c, b) {
    const w = this.weights, n = SHOWN.length, rh = Math.min(30, (b.y1 - b.y0) / n), x0 = b.x0 + 84, x1 = b.x1 - 44;
    ctx.save();
    this.title(ctx, c, b.x0, b.y0 - 8, 'Brightness', this.lay.narrow ? '' : ' of each tissue');
    SHOWN.forEach((nm, i) => {
      const y = b.y0 + 6 + i * rh, v = w[nm];
      ctx.fillStyle = c.ink2; ctx.font = SMALL; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(TISSUES[nm].label.replace(' (CSF)', '').replace(' (oedema)', ''), x0 - 6, y + rh / 2 - 2);
      ctx.fillStyle = this.tc[nm]; ctx.fillRect(x0, y + 4, (x1 - x0) * Math.min(1, v), rh - 12);
      ctx.strokeStyle = c.line; ctx.strokeRect(x0 + 0.5, y + 4.5, x1 - x0, rh - 12);
      ctx.fillStyle = c.ink; ctx.textAlign = 'left';
      fillSlots(ctx, [{ v, dec: 3, w: 5 }], x1 + 4, y + rh / 2 - 2);
    });
    ctx.font = SMALL; ctx.fillStyle = c.ink3; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(this.lay.narrow ? 'ρ (1 − e^−TR/T₁) e^−TE/T₂' : 'ρ (1 − e^(−TR/T₁)) e^(−TE/T₂): 1 is water, fully', b.x0, b.y0 + 8 + n * rh);
    if (!this.lay.narrow) ctx.fillText('recovered, not faded', b.x0, b.y0 + 22 + n * rh);
    ctx.restore();
  }

  // -------------------------------------------------------- Lauterbur's pictures

  drawLauterburImage(ctx, c, b) {
    const N = this.s.N, S = b.s, bp = this.backproj(), j = this.lb.j;
    const v = Float64Array.from(bp.img, (x) => Math.max(0, x));
    greyImage(ctx, v, N, N, b.x0, b.y0, S, S, bp.top, true);
    ctx.save();
    ctx.strokeStyle = c.line; ctx.strokeRect(b.x0 - 0.5, b.y0 - 0.5, S + 1, S + 1);
    this.title(ctx, c, b.x0, b.y0 - 8, 'Back-projected', `: ${j} of ${this.s.nA} angles${this.s.filter ? ', filtered' : ', no filter'}`);
    // The gradient's direction now.
    const th = this.angles[Math.min(j, this.s.nA - 1)] ?? 0, cx = b.x0 + S / 2, cy = b.y0 + S / 2, L = 0.42 * S;
    if (j < this.s.nA) {
      ctx.strokeStyle = '#7fd3ff'; ctx.fillStyle = '#7fd3ff'; ctx.lineWidth = 2.5;
      arrow(ctx, cx - L * Math.cos(th), cy + L * Math.sin(th), cx + L * Math.cos(th), cy - L * Math.sin(th), 12, 2.5);
      ctx.font = FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      haloText(ctx, 'the gradient now', cx + L * Math.cos(th) + 6, cy - L * Math.sin(th) - 4, '#7fd3ff', '#000');
    }
    ctx.font = SMALL; ctx.fillStyle = c.ink2; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('each angle\'s spectrum is a projection, smeared back across the picture', b.x0, b.y0 + S + 5);
    ctx.restore();
  }

  /** The spectrum of the FID with the gradient turned to the angle now: a projection. */
  drawProjection(ctx, c) {
    const L = this.lay, b = { x0: L.p1.x0, x1: L.p2.x1, y0: L.p1.y0, y1: L.p1.y1 }, s = this.s, N = s.N, dx = s.fov / N;
    const j = Math.min(this.lb.j, s.nA - 1), prof = this.profiles[j];
    let top = 0;
    for (const p of this.profiles) for (const v of p) top = Math.max(top, v);
    const X = (k) => b.x0 + ((k + 0.5) / N) * (b.x1 - b.x0), Y = (v) => b.y1 - 4 - (v / (top || 1)) * (b.y1 - b.y0 - 26);
    ctx.save();
    this.title(ctx, c, b.x0, b.y0 - 10, 'The spectrum, with the gradient at this angle', `: θ = ${(this.angles[j] * 180 / Math.PI).toFixed(0)}°`);
    ctx.strokeStyle = c.line; ctx.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0 - 1, b.y1 - b.y0 - 1);
    ctx.fillStyle = '#7fd3ff'; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.moveTo(X(0), Y(0));
    for (let k = 0; k < N; k++) ctx.lineTo(X(k), Y(prof[k]));
    ctx.lineTo(X(N - 1), Y(0)); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = c.accent; ctx.lineWidth = 2; ctx.beginPath();
    for (let k = 0; k < N; k++) (k ? ctx.lineTo(X(k), Y(prof[k])) : ctx.moveTo(X(k), Y(prof[k])));
    ctx.stroke();
    // Its axes: the frequency, and the distance along the gradient it stands for (G = 2 mT/m).
    const G = 2;
    ctx.font = SMALL; ctx.fillStyle = c.ink2; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const smm of niceTicks(-s.fov / 2, s.fov / 2, 6)) { const k = smm / dx + N / 2 - 0.5; ctx.fillText(tickLabel(+(GB * G * smm).toFixed(2)), X(k), b.y1 + 3); ctx.fillStyle = c.ink3; ctx.fillText(tickLabel(smm), X(k), b.y1 + 16); ctx.fillStyle = c.ink2; }
    ctx.textAlign = 'right'; ctx.fillText('f − f₀ (kHz), at 2 mT/m', b.x1, b.y1 + 30);
    ctx.fillStyle = c.ink3; ctx.textAlign = 'left'; ctx.fillText('s, along the gradient (mm)', b.x0, b.y1 + 30);
    ctx.restore();
  }

  /** The projections so far, one row per angle: a sinogram, as in the tomography demo. */
  drawSinogram(ctx, c, b) {
    const s = this.s, N = s.N, nA = s.nA, S = b.s;
    let top = 0;
    for (const p of this.profiles) for (const v of p) top = Math.max(top, v);
    const v = new Float64Array(nA * N);
    for (let j = 0; j < Math.min(this.lb.j, nA); j++) v.set(this.profiles[j], j * N);
    greyImage(ctx, v, N, nA, b.x0, b.y0, S, S, top || 1, false);
    ctx.save();
    ctx.strokeStyle = c.line; ctx.strokeRect(b.x0 - 0.5, b.y0 - 0.5, S + 1, S + 1);
    this.title(ctx, c, b.x0, b.y0 - 8, 'The projections', this.lay.narrow ? '' : ', one row per angle');
    if (this.lb.j < nA) { ctx.strokeStyle = '#7fd3ff'; ctx.lineWidth = 1.5; ctx.strokeRect(b.x0 + 0.5, b.y0 + (this.lb.j * S) / nA, S - 1, S / nA); }
    ctx.font = SMALL; ctx.fillStyle = c.ink2; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(this.lay.narrow ? 'a sinogram' : 'a sinogram: see the tomography demo', b.x0, b.y0 + S + 5);
    ctx.restore();
  }

  readout() {
    const s = this.s, box = $('#v4-readout'), w = this.weights, lines = [];
    const order = [...SHOWN].sort((a, b) => w[b] - w[a]);
    lines.push(['Brightest to darkest: ', ...order.flatMap((n, i) => [i ? ' > ' : '', TISSUES[n].label.replace(' (CSF)', '').replace(' (oedema)', '').replace(' matter', ''), ' ', { v: w[n], dec: 3, w: 5 }]),
      ...(this.teRaised ? ['  (TE raised to the shortest this readout allows, ', { v: this.TE, dec: 1, w: 4 }, ' ms)'] : [])]);
    if (s.mode === 'lauterbur') {
      lines.push(['Lauterbur: ', { v: this.lb.j, dec: 0, w: 3, class: 'b' }, ` of ${s.nA} angles measured, every `, { v: 180 / s.nA, dec: 1, w: 5 }, '°; each is one FID, whose spectrum is the slice summed along lines across the gradient.']);
    } else {
      const fatShift = (3.4e-6 * larmorMHz(s.B0) * 1e6) / (GB * 1000 * s.Gx);
      lines.push(['Field of view ', { v: s.fov, dec: 0, w: 3, class: 'b' }, ' mm', s.obj === 'head' ? ' (the head is 220 mm front to back and 190 mm across)' : '', '; detail ',
        { v: s.fov / s.N, dec: 2, w: 4 }, ' mm along x and ', { v: s.fov / Math.min(s.lines, s.N), dec: 2, w: 5, class: 'b' }, ` mm along y (${Math.min(s.lines, s.N)} phase lines).`]);
      lines.push([s.fat ? 'Fat turns ' : 'Fat\'s shift is off (it would turn ', { v: 3.4 * larmorMHz(s.B0), dec: 0, w: 4 }, ' Hz slower than water', s.fat ? ', which the readout gradient of ' : ', which at ', { v: s.Gx, dec: 2, w: 4 }, ' mT/m', s.fat ? ' reads as a shift of ' : ' would read as ', { v: fatShift, dec: 2, w: 5, class: 'b' }, ' mm along x', s.fat ? '.' : ').',
        ...(s.sigma > 0 ? ['  Noise ', { v: 100 * s.sigma, dec: 1, w: 4 }, '%, averaged ', { v: s.nsa, dec: 0, w: 2 }, ' times: ', { v: (100 * s.sigma) / Math.sqrt(s.nsa), dec: 2, w: 5, class: 'b' }, '% left.'] : [])]);
    }
    if (box.children.length !== lines.length) box.replaceChildren(...lines.map(() => el('div')));
    lines.forEach((l, i) => setSlots(box.children[i], l));
  }

  // ------------------------------------------------------------------- pointer

  bindPointer() {
    const cv = this.canvas, xy = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const near = (h, px, py) => h && Math.abs(px - h.x) < 10 && py >= h.b.y0 - 10 && py <= h.b.y1;
    cv.addEventListener('pointerdown', (e) => {
      if (this.s.mode !== 'fourier') return;
      const [px, py] = xy(e);
      if (near(this.trHandle, px, py)) this.drag = 'TR'; else if (near(this.teHandle, px, py)) this.drag = 'TE';
      else if (this.trHandle && px >= this.trHandle.b.x0 && px <= this.trHandle.b.x1 && py >= this.trHandle.b.y0 && py <= this.trHandle.b.y1) this.drag = 'TR';
      else if (this.teHandle && px >= this.teHandle.b.x0 && px <= this.teHandle.b.x1 && py >= this.teHandle.b.y0 && py <= this.teHandle.b.y1) this.drag = 'TE';
      if (this.drag) { this.stopSweep(); cv.setPointerCapture(e.pointerId); this.moveDrag(px); }
    });
    cv.addEventListener('pointermove', (e) => {
      const [px, py] = xy(e);
      if (this.drag) { this.moveDrag(px); return; }
      const over = this.s.mode === 'fourier' && [this.trHandle, this.teHandle].some((h) => h && px >= h.b.x0 && px <= h.b.x1 && py >= h.b.y0 - 10 && py <= h.b.y1);
      cv.style.cursor = over ? 'ew-resize' : 'default';
    });
    const end = () => { this.drag = null; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  }
  moveDrag(px) {
    const s = this.s;
    if (this.drag === 'TR') { const b = this.trHandle.b; s.TR = Math.max(100, Math.min(TMAX1, Math.round(((px - b.x0) / (b.x1 - b.x0)) * TMAX1 / 10) * 10)); this.trSl.value = s.TR; }
    else { const b = this.teHandle.b; s.TE = Math.max(this.seq.TEmin, Math.min(TMAX2, Math.round(((px - b.x0) / (b.x1 - b.x0)) * TMAX2))); this.teSl.value = s.TE; }
    this.custom('TR'); this.rebuild(); this.app.kick();
  }

  /** For the tests: the spread of the picture where there is nothing (the noise), as a fraction of its brightest. */
  background() {
    const img = this.img.mag, re = this.img.re, truth = this.acq.picture.total;
    let s2 = 0, n = 0, max = 0;
    for (let i = 0; i < img.length; i++) { max = Math.max(max, truth[i]); if (truth[i] === 0) { s2 += re[i] ** 2; n++; } }
    return Math.sqrt(s2 / n) / max;
  }
  /** For the tests: the picture along y through x = 0, against the true values: [y (mm), picture, truth]. */
  columnX0() {
    const N = this.s.N, i = N / 2, dx = this.s.fov / N, img = this.img.mag, t = this.acq.picture.total;
    return Array.from({ length: N }, (_, j) => [(N / 2 - j) * dx, img[j * N + i], t[j * N + i]]);
  }

  probe() {
    return { s: { ...this.s }, weights: { ...this.weights }, measured: this.acq.measuredCount, folded: this.acq.picture.folded, fatShift: this.acq.fatShift, lb: { ...this.lb }, lay: this.lay,
      trHandle: this.trHandle, teHandle: this.teHandle };
  }
}

function kspaceBrightness(re, im) {
  const n = re.length, mags = new Float64Array(n);
  for (let i = 0; i < n; i++) mags[i] = Math.hypot(re[i], im[i]);
  mags.sort();
  return mags[Math.floor(0.97 * (n - 1))] || 1;
}
