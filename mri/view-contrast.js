// View 4 · Contrast and artefacts.  The same slice made into a picture with the whole of
// k-space at once, so that every setting shows its effect immediately: TR and TE (dragged on
// the curves of recovery along z and of the echo's decay) turn it T1-weighted, T2-weighted or
// proton-density weighted; a field of view smaller than the head wraps it round; fewer
// phase-encoding lines blur and ring along y; noise, and averaging; fat's chemical shift along
// the readout.  And Lauterbur's way (1973): no phase encoding, a gradient turned to many
// angles, each spectrum a projection, back-projected as in the tomography demo.

import { GB, larmorMHz } from './bloch.js';
import { headPhantom, disksPhantom, tubesPhantom, TUBE_HEIGHT, disk, TISSUES, tissueAt, weighting, projection } from './phantom.js';
import { sequence, Acquisition, backprojection, projections, readoutBlurPixels } from './scan.js';
import { MAGNETS, MAGNET_IDS, BOARD, magnetOf, larmorHz, signalPerProton, chemicalShiftHz, boardPixelSNR, concomitantShift } from './magnets.js';
import { el, $, slider, segmented, toggle, setSlots } from '../lib/ui.js';
import { fitCanvas, themeColors, fillSlots, niceTicks, tickLabel } from '../lib/plot.js';
import { complexImage, greyImage, arrow, handle, FONT, SMALL, BOLD, haloText, quantile, kspaceBrightness } from './draw.js';

const SHOWN = ['water', 'fat', 'grey', 'white', 'lesion'], TUBES = ['tap', 'cuso4', 'oil'];
/** A short name for a tissue in the bars and the readout. */
const short = (n) => TISSUES[n].label.replace(' (CSF)', '').replace(' (oedema)', '');
/** A number as a × 10^n, for the signal per proton. */
export function sci(v, dec = 2) {
  if (!(v > 0)) return '0';
  const e = Math.floor(Math.log10(v)), m = v / 10 ** e, sup = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  return e === 0 ? v.toFixed(dec) : `${m.toFixed(dec)} × 10${String(e).split('').map((ch) => sup[ch]).join('')}`;
}
export const CONTRASTS = {
  t1: { label: 'T₁-weighted', TR: 500, TE: 15, title: 'Short TR and short TE: what differs is how far each tissue has recovered along z, so short T₁ is bright (fat), long T₁ dark (fluid)' },
  t2: { label: 'T₂-weighted', TR: 3000, TE: 100, title: 'Long TR (all recover) and long TE: what differs is how fast the echo fades, so long T₂ is bright (fluid, oedema)' },
  pd: { label: 'Proton density', TR: 3000, TE: 15, title: 'Long TR and short TE: nearly every tissue has recovered and hardly faded, so what shows is how many protons it has' },
};
const TMAX1 = 5000;   // the time axis of the recovery (ms); the echo's is the magnet's Tmax2

export class ContrastView {
  constructor(app) {
    this.app = app;
    this.canvas = $('#v4-main');
    this.s = {
      obj: 'head', mode: 'fourier', type: 'se', TR: 500, TE: 15, N: 128, fov: 256, lines: 128, sigma: 0, nsa: 1, fat: false, Gx: 4, B0: 1.5, T2p: 60,
      pol: true, decay: false, nA: 12, filter: true, rate: 3, playing: true, sweep: false,
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
    if (this.s.obj === 'tubes') return tubesPhantom();
    return headPhantom(this.app.slice?.z ?? 0);
  }
  /** The magnet, from the field. */
  get mag() { return magnetOf(this.s.B0); }
  get earth() { return this.mag.id === 'earth'; }
  /** The tissues the curves and bars show. */
  get shown() { return this.s.obj === 'tubes' ? TUBES : SHOWN; }
  /** The signal's size: without the board's polarizing coil, the Earth's field alone polarizes, 170 times less. */
  get gain() { return this.earth && !this.s.pol ? BOARD.BE / BOARD.Bp : 1; }

  rebuild() {
    const s = this.s, m = this.mag;
    // (Short pulses and lobes: this view plays no line, and a short TE must be possible.  In the
    // Earth's field a pulse at 2 kHz lasts milliseconds and the weak gradients need long lobes.)
    this.seq = sequence({ type: s.type, TE: s.TE, TR: s.TR, N: s.N, fov: s.fov, Gx: s.Gx, Tpe: m.Tpe, Trf: m.Trf, T2prime: s.T2p });
    // A TE shorter than the sequence allows is used as the shortest it allows (and the readout says so).
    this.teRaised = this.seq.TE > s.TE + 1e-9;
    this.TE = this.seq.TE;
    // In the Earth's field the noise is the board's: a pixel of water, fully polarized, has the
    // signal-to-noise ratio its volume and the time spent listening give it (magnets.js).
    this.snrWater = this.earth ? boardPixelSNR({ dx: s.fov / s.N, h: TUBE_HEIGHT, Ny: s.N, Tro: this.seq.Tro }) : null;
    this.acq.N = 0;
    this.acq.set({ shapes: this.shapes(), seq: this.seq, B0: s.B0, sigma: s.sigma, noiseAbs: this.earth ? 1 / this.snrWater : null, nsa: s.nsa, gain: this.gain,
      chemicalShift: s.fat, decay: s.decay, seed: 7 });
    // The phase-encoding lines measured: the middle `lines` of them.
    const N = s.N, L = Math.min(s.lines, N), lo = N / 2 - Math.floor(L / 2);
    for (let q = lo; q < lo + L; q++) this.acq.measure(q);
    this.img = this.acq.image();
    this.vmax = quantile(Float64Array.from(this.img.mag), 0.997) || 1;
    this.kR = kspaceBrightness(this.acq.mre, this.acq.mim);
    this.weights = this.tissueWeights();
    // (At 46 µT the noise slider shows the board's noise, as a percentage of the brightest pixel.)
    if (this.earth && this.noiseSl) this.noiseSl.value = +(100 * this.acq.noise * Math.sqrt(s.nsa) / (this.acq.peak || 1)).toPrecision(3);
    this.syncMagnet();
    if (s.mode === 'lauterbur') this.buildLauterbur();
    document.querySelector('#main').dataset.mode = s.mode;
    const hint = document.querySelector('#v4-hint');
    if (hint) hint.textContent = s.mode === 'lauterbur' ? 'Watch the gradient turn: each angle\'s spectrum is one projection, smeared back across the picture; raise the angles to sharpen it'
      : s.sweep ? 'TR and TE are sweeping from T₁- to T₂-weighting: drag the TR line or the TE line to take over; the dots where they cross the curves are each tissue\'s brightness'
      : this.earth ? 'Drag the polarizing time\'s line and the TE line: the dots are each tube\'s brightness; raise the averages to beat the noise, or turn the polarizing coil off'
      : 'Drag the TR line on the recovery curves and the TE line on the echo\'s: the dots where they cross are each tissue\'s brightness in the picture';
    this.madeAt = this.app.slice?.z ?? 0;
    this.dirty = true;
    this.app.scheduleHash();
  }

  /** Each tissue's brightness, rho w, at the settings. */
  tissueWeights() {
    const s = this.s, out = {};
    for (const n of this.shown) { const t = tissueAt(n, s.B0); out[n] = this.gain * t.rho * weighting(t, { TR: s.TR, TE: this.TE, type: s.type, T2prime: s.T2p }); }
    return out;
  }

  /** Each shown tissue's smear along x from its decay during the readout (pixels, FWHM): its
   *  T2' about a spin echo, its T2* in a gradient echo (the T2 part fades rather than smears). */
  blurs() {
    const s = this.s, out = {};
    for (const n of this.shown) {
      const t = tissueAt(n, s.B0), T = s.type === 'se' ? s.T2p : 1 / (1 / t.T2 + 1 / s.T2p);
      out[n] = readoutBlurPixels(this.seq.Tro, T);
    }
    return out;
  }

  /** Set the controls that depend on the magnet: the readout gradient's unit and range, the
   *  echo times, the objects it can image, the noise (the board's, at 46 µT), the polarizing coil. */
  syncMagnet() {
    if (!this.gxSl) return;
    const m = this.mag, s = this.s;
    this.gxSl.querySelector('label').textContent = `readout G_x (${m.gUnit})`;
    this.gxSl.setRange(m.GxRange[0] * m.gMul, m.GxRange[1] * m.gMul); this.gxSl.value = +(s.Gx * m.gMul).toPrecision(4);
    this.teSl.setRange(4, m.TEmax); this.teSl.value = s.TE;
    this.trSl.querySelector('label').textContent = this.earth ? 'polarizing time (ms)' : 'repeat time TR (ms)';
    this.b0Seg.value = m.id;
    this.objSeg.querySelectorAll('button').forEach((b, i) => { const ok = m.objects.includes(['head', 'disks', 'tubes'][i]); b.disabled = !ok; });
    this.objSeg.value = s.obj;
    for (const e of [this.noiseSl.input, this.noiseSl.querySelector('input[type=number]')]) e.disabled = this.earth;
    this.noiseSl.classList.toggle('off', this.earth);
    this.noiseNote.hidden = !this.earth;
    this.polRow.hidden = !this.earth;
    this.polBtn.on = s.pol;
    this.decayBtn.on = s.decay;
    this.t2pSl.value = +s.T2p.toPrecision(4);
  }

  /** Change the magnet: its readout gradient and evenness; tubes, if it cannot image the object. */
  setMagnet(id) {
    const m = MAGNETS[id], s = this.s;
    s.B0 = m.B0; s.Gx = m.Gx; s.T2p = m.T2p;
    if (!m.objects.includes(s.obj)) s.obj = 'tubes';
    this.stopSweep();
    this.rebuild(); this.app.kick();
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
    this.fovSl = slider({ label: 'field of view (mm)', min: 60, max: 320, step: 1, value: s.fov, title: 'How big a square the picture covers; k-space is sampled every 1/FOV', onInput: (v) => { s.fov = v; this.rebuild(); this.app.kick(); } });
    this.linesSl = slider({ label: 'phase lines', min: 8, max: 256, step: 1, value: s.lines, title: 'How many rows of k-space are measured (the middle ones); the rest are taken as zero', onInput: (v) => { s.lines = Math.round(v); this.rebuild(); this.app.kick(); } });
    this.nSeg = segmented([32, 64, 128, 256].map((n) => ({ value: n, label: String(n) })), s.N, (v) => { s.N = v; s.lines = Math.min(s.lines === this.lastN ? v : s.lines, v); this.lastN = v; this.linesSl.setRange(8, v); this.linesSl.value = s.lines; this.rebuild(); this.app.kick(); }, { label: 'Matrix' });
    this.lastN = s.N;
    this.noiseSl = slider({ label: 'noise σ (%)', min: 0, max: 20, step: 0.1, value: 100 * s.sigma, title: 'The receiver\'s noise per sample, as a percentage of the brightest pixel', onInput: (v) => { s.sigma = v / 100; this.rebuild(); this.app.kick(); } });
    this.noiseNote = el('div', { class: 'small muted', hidden: true }, 'At 46 µT the noise is not yours to choose: it is the board\'s coil and receiver, against the little signal a pixel of water gives (the readout says how much).');
    this.nsaSl = slider({ label: 'averages', min: 1, max: 16, step: 1, value: s.nsa, title: 'Measure every line this many times and average: the noise falls as 1/√(averages), the time grows in proportion', onInput: (v) => { s.nsa = Math.round(v); this.rebuild(); this.app.kick(); } });
    $('#v4-scan-box').append(this.fovSl, this.linesSl, el('div', { class: 'row' }, el('span', { class: 'small muted' }, 'matrix'), this.nSeg), this.noiseSl, this.noiseNote, this.nsaSl);
    // The decay during the readout, and (under More) the magnet's evenness.
    this.decayBtn = toggle('Decay during the readout', s.decay, (on) => { s.decay = on; this.rebuild(); this.app.kick(); }, 'Let each tissue go on fading while the readout listens: the early and late samples, the edges of k-space along kx, are weaker, and the picture smears along x');
    this.t2pSl = slider({ label: 'T₂′ (ms)', min: 1, max: 2000, log: true, value: s.T2p, title: 'How long the magnet\'s unevenness takes to dephase the spins in a pixel: 1/T₂* = 1/T₂ + 1/T₂′', onInput: (v) => { s.T2p = v; this.rebuild(); this.app.kick(); } });
    $('#v4-decay-box').append(el('div', { class: 'row' }, this.decayBtn),
      el('div', { class: 'small muted' }, 'Off, each line is read as if it were all measured at the echo.  On, the echo goes on fading while it is read, and a pixel smears along x.'));
    $('#v4-more-box').append(this.t2pSl, el('div', { class: 'small muted' }, 'T₂′: the field is never quite even, so spins in one pixel drift apart.  A spin echo undoes it at the echo; a gradient echo fades with T₂*, 1/T₂* = 1/T₂ + 1/T₂′.  Changing the magnet sets its own.'));
    this.fatBtn = toggle('Fat\'s chemical shift', s.fat, (on) => { s.fat = on; this.rebuild(); this.app.kick(); }, 'Fat\'s (and oil\'s) protons turn 3.4 parts per million slower than water\'s: under the readout gradient that is a shift along x');
    this.gxSl = slider({ label: 'readout G_x (mT/m)', min: 0.3, max: 8, log: true, value: s.Gx, title: 'The readout gradient: the weaker it is, the longer the readout and the further fat\'s small offset in frequency moves it', onInput: (v) => { s.Gx = v / this.mag.gMul; this.rebuild(); this.app.kick(); } });
    $('#v4-fat-box').append(el('div', { class: 'row' }, this.fatBtn), this.gxSl);
    this.objSeg = segmented([{ value: 'head', label: 'The head' }, { value: 'disks', label: 'Three disks' }, { value: 'tubes', label: 'Tubes', title: 'Tubes of tap water, water with copper sulphate and oil, standing in the board\'s coil: the sample a low field can image' }], s.obj,
      (v) => { s.obj = v; this.rebuild(); this.app.kick(); }, { label: 'Object' });
    this.b0Seg = segmented(MAGNET_IDS.map((id) => ({ value: id, label: MAGNETS[id].label, title: MAGNETS[id].title })), this.mag.id, (id) => this.setMagnet(id), { label: 'Magnet' });
    this.polBtn = toggle('Polarizing coil (7.84 mT)', s.pol, (on) => { s.pol = on; this.rebuild(); this.app.kick(); }, 'Polarize the water with the board\'s coil before each line, 170 times the Earth\'s field; off, only the Earth\'s 46 µT polarizes it');
    this.polRow = el('div', { class: 'row', hidden: true }, this.polBtn);
    $('#v4-obj-row').append(this.objSeg);
    $('#v4-mag-row').append(el('span', { class: 'small muted' }, 'magnet'), this.b0Seg);
    $('#v4-pol-row').append(this.polRow);
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
    if (!this.mag.objects.includes(s.obj)) s.obj = 'tubes';
    this.modeSeg.value = s.mode; this.trSl.value = s.TR; this.teSl.value = s.TE; this.typeSeg.value = s.type; this.fovSl.value = s.fov;
    this.linesSl.setRange(8, s.N); this.linesSl.value = s.lines; this.nSeg.value = s.N; this.lastN = s.N; this.noiseSl.value = 100 * s.sigma; this.nsaSl.value = s.nsa;
    this.fatBtn.on = s.fat; this.objSeg.value = s.obj; this.nASl.value = s.nA; this.filterBtn.on = s.filter;
    if (o.more !== undefined) $('#v4-more').open = !!o.more;
    this.sweepBtn.on = s.sweep; this.sweepU = 0; this.sweepDir = 1;
    this.custom('TR');
    this.lb.j = o.angles ?? 0; this.lb.u = 0;
    this.rebuild();
    this.setPlaying(s.mode === 'lauterbur' && (o.playing ?? true) && this.lb.j < s.nA);
  }
  toHash() {
    const s = this.s, r = (v) => +(+v).toPrecision(4);
    const m = this.mag;
    return { obj: s.obj, md: s.mode !== 'fourier' ? s.mode : undefined, seq: s.type, TR: r(s.TR), TE: r(s.TE), N: s.N, fov: r(s.fov), ln: s.lines !== s.N ? s.lines : undefined,
      sg: s.sigma ? r(s.sigma) : undefined, nsa: s.nsa > 1 ? s.nsa : undefined, fat: s.fat ? 1 : undefined, Gx: s.Gx !== m.Gx ? r(s.Gx) : undefined, B0: m.id !== '1.5' ? r(s.B0) : undefined,
      t2p: Math.abs(s.T2p - m.T2p) > 1e-9 ? r(s.T2p) : undefined, pol: m.id === 'earth' && !s.pol ? 0 : undefined, dc: s.decay ? 1 : undefined,
      nA: s.mode === 'lauterbur' ? s.nA : undefined, flt: s.mode === 'lauterbur' && !s.filter ? 0 : undefined, z: r(this.app.slice?.z ?? 0) };
  }
  fromHash(h) {
    const num = (v, d, lo = -Infinity, hi = Infinity) => (v !== undefined && Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);
    if (h.z !== undefined) this.app.slice = { ...(this.app.slice || {}), z: num(h.z, 0, -125, 125) };
    const N = [32, 64, 128, 256].includes(+h.N) ? +h.N : 128, m = magnetOf(num(h.B0, 1.5, 1e-6, 20));
    this.set({ obj: ['disks', 'tubes'].includes(h.obj) ? h.obj : 'head', mode: h.md === 'lauterbur' ? 'lauterbur' : 'fourier', type: h.seq === 'gre' ? 'gre' : 'se', TR: num(h.TR, 500, 20, 20000), TE: num(h.TE, 15, 1, 2000),
      N, fov: num(h.fov, 256, 60, 600), lines: Math.round(num(h.ln, N, 2, N)), sigma: num(h.sg, 0, 0, 1), nsa: Math.round(num(h.nsa, 1, 1, 64)), fat: h.fat === '1', Gx: num(h.Gx, m.Gx, 0.005, 50),
      B0: m.B0, T2p: num(h.t2p, m.T2p, 0.1, 1e5), pol: h.pol !== '0', decay: h.dc === '1', nA: Math.round(num(h.nA, 12, 1, 360)), filter: h.flt !== '0' });
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
    this.title(ctx, c, b.x0, b.y0 - 8, 'The picture', which && !this.teRaised && !this.earth ? `: ${which[1].label}` : `: ${this.earth ? 'Tp' : 'TR'} ${tickLabel(+this.s.TR.toFixed(0))} ms, TE ${tickLabel(+this.TE.toFixed(1))} ms${this.mag.id !== '1.5' ? `, at ${this.mag.label}` : ''}`);
    // With fat's shift on: where the fat really is, dashed.
    const mm = S / this.s.fov, bar = 50 * mm;
    if (this.s.fat) {
      ctx.save(); ctx.beginPath(); ctx.rect(b.x0, b.y0, S, S); ctx.clip();
      ctx.strokeStyle = this.tc.fat; ctx.lineWidth = 1.3; ctx.setLineDash([4, 3]);
      const cx = b.x0 + S / 2, cy = b.y0 + S / 2;
      for (const e of this.shapes()) if (TISSUES[e.tissue].shift) { ctx.beginPath(); ctx.ellipse(cx + e.x * mm, cy - e.y * mm, e.a * mm, e.b * mm, -e.phi, 0, 2 * Math.PI); ctx.stroke(); }
      ctx.restore();
      ctx.font = SMALL; ctx.fillStyle = this.tc.fat; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(`dashed: where the ${this.s.obj === 'tubes' ? 'oil' : 'fat'} really is`, b.x0 + 8, b.y0 + 8);
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
    const s = this.s, X = (t) => b.x0 + (t / TMAX1) * (b.x1 - b.x0), Y = (v) => b.y1 - v * (b.y1 - b.y0 - 6), g = this.gain;
    ctx.save();
    if (this.earth) this.title(ctx, c, b.x0, b.y0 - 10, s.pol ? 'Polarizing' : 'No polarizing', this.lay.narrow ? '' : s.pol ? ', in the coil\'s 7.84 mT' : ': the Earth\'s field alone');
    else this.title(ctx, c, b.x0, b.y0 - 10, 'Recovery along z', this.lay.narrow ? '' : ', after each pulse');
    ctx.strokeStyle = c.line; ctx.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0 - 1, b.y1 - b.y0 - 1);
    for (const n of this.shown) {
      const t = tissueAt(n, s.B0);
      ctx.strokeStyle = this.tc[n]; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i <= 120; i++) { const tt = (TMAX1 * i) / 120, y = Y(g * t.rho * (1 - Math.exp(-tt / t.T1))); i ? ctx.lineTo(X(tt), y) : ctx.moveTo(X(tt), y); }
      ctx.stroke();
      const v = g * t.rho * (1 - Math.exp(-s.TR / t.T1));
      ctx.fillStyle = this.tc[n]; ctx.strokeStyle = c.panel; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(X(Math.min(s.TR, TMAX1)), Y(v), 4.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    }
    // The TR line and its handle.
    const xt = X(Math.min(s.TR, TMAX1));
    ctx.strokeStyle = c.ink; ctx.lineWidth = 1.4; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(xt, b.y0); ctx.lineTo(xt, b.y1); ctx.stroke(); ctx.setLineDash([]);
    handle(ctx, xt, b.y0, 7, c.panel, c.ink);
    this.trHandle = { x: xt, y: b.y0, b };
    ctx.font = SMALL; ctx.fillStyle = c.ink; ctx.textAlign = xt > b.x1 - 70 ? 'right' : 'left'; ctx.textBaseline = 'top';
    fillSlots(ctx, [this.earth ? 'Tp = ' : 'TR = ', { v: s.TR, dec: 0, w: 4 }, ' ms'], xt + (xt > b.x1 - 70 ? -10 : 10), b.y0 + 4);
    ctx.fillStyle = c.ink2; ctx.textAlign = 'center';
    for (const v of niceTicks(0, TMAX1, 4)) ctx.fillText(tickLabel(v / 1000), X(v), b.y1 + 3);
    ctx.textAlign = 'right'; ctx.fillText('t (s)', b.x1, b.y1 + 16);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const v of [0, 0.5, 1]) ctx.fillText(tickLabel(v), b.x0 - 4, Y(v));
    ctx.restore();
  }

  /** The echo after the pulse: rho (1 - e^{-TR/T1}) e^{-t/T2} (T2* for a gradient echo), with the TE line. */
  drawDecay(ctx, c, b) {
    const s = this.s, TMAX2 = this.mag.Tmax2, X = (t) => b.x0 + (t / TMAX2) * (b.x1 - b.x0), Y = (v) => b.y1 - v * (b.y1 - b.y0 - 6);
    ctx.save();
    this.title(ctx, c, b.x0, b.y0 - 10, 'The echo fades', this.lay.narrow ? '' : `, as ${s.type === 'se' ? 'T₂' : 'T₂*'}`);
    ctx.strokeStyle = c.line; ctx.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0 - 1, b.y1 - b.y0 - 1);
    // The readout, as a band about TE: the time it listens (over which the decay smears the picture).
    const r0 = X(Math.max(0, this.TE - this.seq.Tro / 2)), r1 = X(Math.min(TMAX2, this.TE + this.seq.Tro / 2));
    if (r1 - r0 > 1.5) {
      ctx.fillStyle = c.accent; ctx.globalAlpha = 0.12; ctx.fillRect(r0, b.y0 + 1, r1 - r0, b.y1 - b.y0 - 2); ctx.globalAlpha = 1;
      if (r1 - r0 > 50 && !this.lay.narrow) { ctx.font = SMALL; ctx.fillStyle = c.ink3; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText('readout', (r0 + r1) / 2, b.y1 - 3); }
    }
    for (const n of this.shown) {
      const t = tissueAt(n, s.B0), m0 = this.gain * t.rho * (1 - Math.exp(-s.TR / t.T1)), T2 = s.type === 'gre' ? 1 / (1 / t.T2 + 1 / s.T2p) : t.T2;
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
    const w = this.weights, shown = this.shown, n = SHOWN.length, rh = Math.min(30, (b.y1 - b.y0) / n), x0 = b.x0 + 84, x1 = b.x1 - 44;
    ctx.save();
    this.title(ctx, c, b.x0, b.y0 - 8, 'Brightness', this.lay.narrow ? '' : ' of each tissue');
    shown.forEach((nm, i) => {
      const y = b.y0 + 6 + i * rh, v = w[nm];
      ctx.fillStyle = c.ink2; ctx.font = SMALL; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(short(nm), x0 - 6, y + rh / 2 - 2);
      ctx.fillStyle = this.tc[nm]; ctx.fillRect(x0, y + 4, (x1 - x0) * Math.min(1, v), rh - 12);
      ctx.strokeStyle = c.line; ctx.strokeRect(x0 + 0.5, y + 4.5, x1 - x0, rh - 12);
      ctx.fillStyle = c.ink; ctx.textAlign = 'left';
      fillSlots(ctx, [{ v, dec: v < 0.01 && v > 0 ? 4 : 3, w: 6 }], x1 + 4, y + rh / 2 - 2);
    });
    ctx.font = SMALL; ctx.fillStyle = c.ink3; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const yt = b.y0 + 8 + shown.length * rh, tr = this.earth ? 'Tp' : 'TR';
    ctx.fillText(this.lay.narrow ? `ρ (1 − e^−${tr}/T₁) e^−TE/T₂` : `ρ (1 − e^(−${tr}/T₁)) e^(−TE/T₂): 1 is water, fully`, b.x0, yt);
    if (!this.lay.narrow) ctx.fillText(this.earth ? (this.s.pol ? 'polarized by the coil, not faded' : 'polarized by the coil (now off)') : 'recovered, not faded', b.x0, yt + 14);
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
    // Its axes: the frequency, and the distance along the gradient it stands for (G = 2 mT/m;
    // in the Earth's field 100 µT/m, and the frequencies in Hz).
    const G = this.earth ? 0.1 : 2, fmul = this.earth ? 1000 : 1;
    ctx.font = SMALL; ctx.fillStyle = c.ink2; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const smm of niceTicks(-s.fov / 2, s.fov / 2, 6)) { const k = smm / dx + N / 2 - 0.5; ctx.fillText(tickLabel(+(fmul * GB * G * smm).toFixed(2)), X(k), b.y1 + 3); ctx.fillStyle = c.ink3; ctx.fillText(tickLabel(smm), X(k), b.y1 + 16); ctx.fillStyle = c.ink2; }
    ctx.textAlign = 'right'; ctx.fillText(this.earth ? 'f − f₀ (Hz), at 100 µT/m' : 'f − f₀ (kHz), at 2 mT/m', b.x1, b.y1 + 30);
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
    const m = this.mag, earth = this.earth, shown = this.shown;
    const order = [...shown].sort((a, b) => w[b] - w[a]), dw = earth && !s.pol ? 4 : 3;
    lines.push(['Brightest to darkest: ', ...order.flatMap((n, i) => [i ? ' > ' : '', short(n).replace(' matter', ''), ' ', { v: w[n], dec: dw, w: dw + 2 }]),
      ...(this.teRaised ? ['  (TE raised to the shortest this readout allows, ', { v: this.TE, dec: 1, w: 5 }, ' ms)'] : [])]);
    // The readout gradient in its unit (µT/m in the Earth's field), and what it spreads over a mm.
    const gx = { v: s.Gx * m.gMul, dec: earth ? 0 : 2, w: 4 }, gu = ` ${m.gUnit}`, perMM = GB * s.Gx * 1000, Tro = this.seq.Tro;
    const scanMin = (Math.min(s.lines, s.N) * s.nsa * s.TR) / 60000;
    if (s.mode === 'lauterbur') {
      lines.push(['Lauterbur: ', { v: this.lb.j, dec: 0, w: 3, class: 'b' }, ` of ${s.nA} angles measured, every `, { v: 180 / s.nA, dec: 1, w: 5 }, '°; each is one FID, whose spectrum is the slice summed along lines across the gradient.']);
    } else {
      const fatHz = chemicalShiftHz(s.B0), fatShift = fatHz / (perMM), fd = fatHz < 1 ? 4 : 0, sd = fatShift < 0.01 ? 4 : 2;
      const which = s.obj === 'tubes' ? 'Oil' : 'Fat';
      lines.push(['Field of view ', { v: s.fov, dec: 0, w: 3, class: 'b' }, ' mm', s.obj === 'head' ? ' (the head is 220 mm front to back and 190 mm across)' : '', '; detail ',
        { v: s.fov / s.N, dec: 2, w: 4 }, ' mm along x and ', { v: s.fov / Math.min(s.lines, s.N), dec: 2, w: 5, class: 'b' }, ` mm along y (${Math.min(s.lines, s.N)} phase lines).  The scan: `,
        { v: Math.min(s.lines, s.N), dec: 0, w: 3 }, ' lines × ', { v: s.nsa, dec: 0, w: 2 }, earth ? ' averages × Tp ' : ' averages × TR ', { v: s.TR / 1000, dec: 2, w: 4 }, ' s = ', { v: scanMin, dec: 1, w: 5, class: 'b' }, ' min.']);
      lines.push([s.fat ? `${which} turns ` : `${which}'s shift is off (it would turn `, { v: fatHz, dec: fd, w: 6 }, ' Hz slower than water', s.fat ? ', which the readout gradient of ' : ', which at ', gx, gu, s.fat ? ' reads as a shift of ' : ' would read as ', { v: fatShift, dec: sd, w: 6, class: 'b' }, ' mm along x', s.fat ? '.' : ').',
        ...(!earth && s.sigma > 0 ? ['  Noise ', { v: 100 * s.sigma, dec: 1, w: 4 }, '%, averaged ', { v: s.nsa, dec: 0, w: 2 }, ' times: ', { v: (100 * s.sigma) / Math.sqrt(s.nsa), dec: 2, w: 5, class: 'b' }, '% left.'] : [])]);
    }
    // The magnet: the frequencies, the readout's length, the signal per proton.
    const f0 = larmorHz(s.B0), f0txt = f0 < 1e4 ? [{ v: f0, dec: 1, w: 6, class: 'b' }, ' Hz'] : [{ v: f0 / 1e6, dec: 2, w: 6, class: 'b' }, ' MHz'];
    lines.push([`${m.label}: f₀ = `, ...f0txt, '; the readout gradient ', gx, gu, ' spreads ', { v: perMM, dec: 2, w: 6 }, ' Hz over each mm, so the readout lasts ', { v: Tro, dec: 1, w: 5, class: 'b' }, ' ms.  ',
      earth ? (s.pol ? 'Polarized in 7.84 mT, each proton gives ' : 'Polarized by the Earth\'s field alone, each proton gives ') : 'Each proton gives ', { text: sci(signalPerProton(m, s.pol)), w: 12, class: 'b' }, ' of its signal at 1.5 T (∝ B_pol B₀).',
      ...(earth ? ['  The gradient\'s sideways field misplaces the tubes\' ends, 50 mm up and down, by ', { v: concomitantShift(s.Gx, TUBE_HEIGHT / 2, s.B0), dec: 2, w: 5 }, ' mm (left out of the picture).'] : [])]);
    if (earth) {
      const snr = this.snrWater * Math.sqrt(s.nsa), V = (s.fov / s.N) ** 2 * TUBE_HEIGHT / 1000, best = Math.max(...shown.map((n) => w[n]));
      lines.push(['The board\'s coil: a ', { v: s.fov / s.N, dec: 1, w: 4 }, ' mm pixel of water (', { v: V, dec: 2, w: 4 }, ' mL through the tubes\' 100 mm) has SNR ', { v: this.snrWater, dec: 2, w: 5 }, ' per average, fully polarized; the brightest tube here ',
        { v: best * this.snrWater, dec: 2, w: 6 }, ', and with ', { v: s.nsa, dec: 0, w: 2 }, ' averages ', { v: best * snr, dec: 1, w: 6, class: 'b' }, '.']);
    }
    if (s.decay && s.mode !== 'lauterbur') {
      const bl = this.blurs(), vals = shown.map((n) => bl[n]);
      lines.push(s.type === 'se'
        ? ['Decay during the readout: T₂′ = ', { v: s.T2p, dec: 1, w: 6 }, ' ms, undone at the echo, smears every pixel along x over ', { v: vals[0], dec: 2, w: 5, class: 'b' }, ' pixels (Tro/πT₂′); T₂ fades the edges of k-space too, unevenly.']
        : ['Decay during the readout: each tissue\'s T₂* smears it along x over ', { v: Math.min(...vals), dec: 2, w: 5 }, ' to ', { v: Math.max(...vals), dec: 2, w: 5, class: 'b' }, ' pixels (Tro/πT₂*), and fades it too.']);
    }
    if (box.children.length !== lines.length) box.replaceChildren(...lines.map(() => el('div')));
    lines.forEach((l, i) => setSlots(box.children[i], l));
    // The gloss under the magnet's buttons.
    setSlots($('#v4-mag-gloss'), earth
      ? ['The Earth\'s field: protons at ', { v: f0, dec: 1, w: 6 }, ' Hz.  The board\'s coil polarizes them first; the gradients are µT/m.']
      : ['Protons at ', { v: f0 / 1e6, dec: 2, w: 6 }, ' MHz; each gives ', { text: sci(signalPerProton(m)), w: 12 }, ' of its signal at 1.5 T.']);
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
    else { const b = this.teHandle.b, T = this.mag.Tmax2; s.TE = Math.max(this.seq.TEmin, Math.min(T, Math.round(((px - b.x0) / (b.x1 - b.x0)) * T))); this.teSl.value = s.TE; }
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
