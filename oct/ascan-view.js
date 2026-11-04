// View 2, "The A-scan": a layered sample in the sample arm and the motor scanning the reference
// mirror through all of it.  Every interface makes its own burst of fringes; the envelope of the
// detector's signal, demodulated from the noisy trace, is the sample's reflectivity against
// depth: the A-scan.  Lengths in μm; the depth axis of every plot is the mirror's position d, i.e.
// the optical depth n z of what it matches, from where the two arms are equal.

import { $, slider, segmented, toggle, setGroups } from '../lib/ui.js';
import { fitCanvas, Frame } from '../lib/plot.js';
import { STACKS, makeStack, bursts, mulberry32 } from './sample.js';
import { detectorTrace, demodulate, peaks } from './tdoct.js';
import { octColors, addInterval, covers, greyOf, um } from './plots.js';

export const OFFSET = 20;     // the sample's front face is 20 μm beyond equal paths
const PASS = 5;               // seconds for one pass of the mirror, by default

export const state = { sample: 'slide', gap: 8, noise: -60, motor: 'sweep', speed: 50, scale: 'db', d: 0, alone: true };

let S = null, stack = null, B = [], pass = null, seed = 1, sweepDir = 1, record = [], dirty = true;
const stripC = $('#a-strip'), traceC = $('#a-trace'), scanC = $('#a-scan'), greyC = $('#a-grey');

/** The mirror's travel for this sample: from a little before its front to a little past its back. */
export function range() {
  const deep = OFFSET + stack.n * Math.max(...stack.layers.map((l) => l.z));
  return [0, Math.ceil((deep + Math.max(20, 4 * S.src.lc)) / 10) * 10];
}

/** The noise in the A-scan, as σ_r per component: the floor (dB) is 20 log₁₀ of its rms, √2 σ_r. */
const sigmaR = () => (state.noise <= -119 ? 0 : 10 ** (state.noise / 20) / Math.SQRT2);

/** Everything one pass of the mirror records: the noisy trace, its demodulated envelope (the
 *  A-scan), and the envelope with no noise (for comparison). */
function compute() {
  const src = S.src, [d0, d1] = range();
  const h = src.lam0 / 8, D0 = 2 * d0, N = Math.ceil((2 * (d1 - d0)) / h) + 1;
  const tr = detectorTrace(B, src, D0, h, N, { noise: sigmaR(), rng: mulberry32(1000 + seed) });
  const A = demodulate(tr, src), E = new Float32Array(N);
  for (let j = 0; j < N; j++) E[j] = Math.hypot(tr.re[j], tr.im[j]);
  pass = { I: Float32Array.from(tr.I), A: Float32Array.from(A), E, D0, h, N, dc: tr.dc, d0, d1, sigmaI: tr.sigmaI };
  dirty = true;
}

function rebuild() {
  stack = makeStack(state.sample, { gap: state.gap });
  B = bursts(stack, OFFSET);
  compute();
}
export function sourceChanged() { if (S) rebuild(); }

// --------------------------------------------------------------------- the motor

export function setMirror(d, continuous = true) {
  const [d0, d1] = range();
  d = Math.max(d0, Math.min(d1, d));
  record = addInterval(record, continuous ? state.d : d, d);
  state.d = d;
  dirty = true;
}

/** Start a new pass from where the mirror is: a fresh measurement (new noise). */
function newPass() { seed++; record = addInterval([], state.d, state.d); compute(); }

export function setMotor(m) { state.motor = m; if (motorSeg) motorSeg.value = m; dirty = true; S.onChange(); }

export function tick(dt) {
  if (state.motor === 'stop' || !dt) return false;
  const [d0, d1] = range();
  let dir = state.motor === 'fwd' ? 1 : sweepDir;
  let d = state.d + dir * state.speed * Math.min(dt, 0.1);
  if (d >= d1) {
    setMirror(d1);
    if (state.motor === 'fwd') { setMotor('stop'); return true; }
    sweepDir = -1; newPass(); return true;
  }
  if (d <= d0) { setMirror(d0); sweepDir = 1; newPass(); return true; }
  setMirror(d);
  return true;
}

/** Record the whole range at once (the "Whole scan" button). */
export function wholeScan() { const [d0, d1] = range(); record = [[d0, d1]]; setMotor('stop'); dirty = true; }

// --------------------------------------------------------------------- what the A-scan shows

/** The peaks of the recovered A-scan above four times the noise's rms (which noise alone passes
 *  with a chance e^{−16}) and 2% of the largest layer: [{ d, a }] in order of depth. */
export function foundPeaks() {
  const { A, D0, h } = pass, floor = Math.max(4 * Math.SQRT2 * sigmaR(), 0.02 * Math.max(...B.map((b) => Math.abs(b.a))));
  return peaks(A, D0, h, floor).map((p) => ({ d: p.D / 2, a: p.a })).sort((p, q) => p.d - q.d);
}

/** The A-scan at mirror position d (interpolated). */
export function aAt(d, which = 'A') {
  const { D0, h, N } = pass, arr = pass[which], u = (2 * d - D0) / h, j = Math.floor(u), t = u - j;
  if (j < 0 || j + 1 >= N) return 0;
  return arr[j] * (1 - t) + arr[j + 1] * t;
}

// --------------------------------------------------------------------- drawing

function frameFor(canvas, margins) {
  const { ctx, width, height } = fitCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 52, right: 14, ...margins });
  [f.x0, f.x1] = range();
  return { ctx, f, width, height };
}

/** Column ranges of the pass's arrays: for pixel i, the samples j0 ≤ j < j1. */
function columns(f) {
  const cols = Math.max(1, Math.round(f.w)), { D0, h, N } = pass, out = [];
  for (let i = 0; i < cols; i++) {
    const a = f.x0 + ((f.x1 - f.x0) * i) / cols, b = f.x0 + ((f.x1 - f.x0) * (i + 1)) / cols;
    const j0 = Math.max(0, Math.floor((2 * a - D0) / h)), j1 = Math.min(N, Math.max(j0 + 1, Math.ceil((2 * b - D0) / h)));
    out.push({ a, b, j0, j1, on: covers(record, a, b) });
  }
  return out;
}

function drawStrip(c) {
  const { ctx, f, width, height } = frameFor(stripC, { top: 6, bottom: 18 });
  ctx.fillStyle = '#1b1d22'; ctx.fillRect(f.left, f.top, f.w, f.h);
  // The sample: tinted from its front face to its back, in optical depth.
  const xf = f.X(OFFSET);
  if (stack.n > 1) { ctx.fillStyle = 'rgba(120,170,220,0.16)'; ctx.fillRect(xf, f.top, f.X(OFFSET + stack.n * Math.max(...stack.layers.map((l) => l.z))) - xf, f.h); }
  // The gate: where the mirror matches, ±ℓ_c/2.
  const gx = f.X(state.d), gw = Math.max(2, f.X(state.d + S.src.lc / 2) - f.X(state.d - S.src.lc / 2));
  ctx.fillStyle = 'rgba(255,224,138,0.35)'; ctx.fillRect(gx - gw / 2, f.top, gw, f.h);
  ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(gx, f.top); ctx.lineTo(gx, f.bottom); ctx.stroke(); ctx.setLineDash([]);
  // The interfaces, as bright as they reflect.
  for (const b of B) {
    const x = f.X(b.D / 2);
    ctx.strokeStyle = `rgba(240,240,250,${Math.min(1, 0.35 + 6 * Math.abs(b.a))})`; ctx.lineWidth = Math.abs(b.a) > 0.1 ? 2 : 1.2;
    ctx.beginPath(); ctx.moveTo(x + 0.5, f.top + 3); ctx.lineTo(x + 0.5, f.bottom - 3); ctx.stroke();
  }
  ctx.fillStyle = c.ink2; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText('sample', f.left - 6, f.top + f.h / 2);
}

function drawTrace(c) {
  const { ctx, f } = frameFor(traceC, { top: 8, bottom: 26 });
  const amp = B.reduce((s, b) => s + Math.abs(b.a), 0), noise = 3.5 * pass.sigmaI;
  f.y0 = pass.dc - 2.2 * amp - noise; f.y1 = pass.dc + 2.2 * amp + noise;
  f.axes({ colors: c, xTicks: false, ylabel: 'signal' });
  f.clip();
  ctx.fillStyle = c.faint; ctx.fillRect(f.left, f.top, f.w, f.h);
  ctx.fillStyle = c.panel;
  for (const iv of record) { const a = Math.max(f.left, f.X(iv[0])), b = Math.min(f.right, f.X(iv[1])); if (b > a) ctx.fillRect(a, f.top, b - a, f.h); }
  ctx.fillStyle = c.sig;
  const { I } = pass;
  columns(f).forEach((col, i) => {
    if (!col.on) return;
    let lo = Infinity, hi = -Infinity;
    for (let j = col.j0; j < col.j1; j++) { const v = I[j]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const y0 = f.Y(hi), y1 = f.Y(lo);
    ctx.fillRect(f.left + i, y0, 1, Math.max(1, y1 - y0));
  });
  const mx = f.X(state.d);
  ctx.strokeStyle = c.mirror; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(mx, f.top); ctx.lineTo(mx, f.bottom); ctx.stroke();
  ctx.restore();
}

function dbFloor() { return Math.max(-90, Math.min(state.noise - 12, -40)); }

function drawScan(c) {
  const { ctx, f } = frameFor(scanC, { top: 10, bottom: 34 });
  const db = state.scale === 'db', top = Math.max(...B.map((b) => Math.abs(b.a)));
  if (db) { f.y0 = dbFloor(); f.y1 = Math.min(5, Math.ceil((20 * Math.log10(top) + 6) / 10) * 10); } else { f.y0 = 0; f.y1 = Math.max(top * 1.2, 4 * Math.SQRT2 * sigmaR()); }
  const Y = (a) => f.Y(db ? (a > 0 ? Math.max(f.y0 - 5, 20 * Math.log10(a)) : f.y0 - 5) : a);
  f.axes({ colors: c, xlabel: 'mirror position d = optical depth n z (μm)', ylabel: db ? 'reflection (dB)' : 'reflectivity |r|', grid: db });
  f.clip();
  ctx.fillStyle = c.faint; ctx.fillRect(f.left, f.top, f.w, f.h);
  ctx.fillStyle = c.panel;
  for (const iv of record) { const a = Math.max(f.left, f.X(iv[0])), b = Math.min(f.right, f.X(iv[1])); if (b > a) ctx.fillRect(a, f.top, b - a, f.h); }
  // The noise floor.
  if (sigmaR() > 0) {
    const y = Y(Math.SQRT2 * sigmaR());
    ctx.strokeStyle = c.noise; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(f.left, y); ctx.lineTo(f.right, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = c.noise; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('noise floor', f.right - 4, y - 2);
  }
  // Each surface alone (two surfaces only): what each would make by itself.
  if (state.sample === 'pair' && state.alone) {
    ctx.strokeStyle = c.layer; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    for (const b of B) {
      ctx.beginPath();
      for (let i = 0; i <= f.w; i++) { const d = f.invX(f.left + i), y = Y(Math.abs(b.a) * S.src.envelope(2 * d - b.D)); if (i) ctx.lineTo(f.left + i, y); else ctx.moveTo(f.left + i, y); }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  // The recovered A-scan, where the mirror has been.
  const { A } = pass;
  ctx.strokeStyle = c.env; ctx.lineWidth = 1.6; ctx.beginPath();
  let on = false;
  columns(f).forEach((col, i) => {
    if (!col.on) { on = false; return; }
    let hi = 0;
    for (let j = col.j0; j < col.j1; j++) if (A[j] > hi) hi = A[j];
    const y = Y(hi);
    if (on) ctx.lineTo(f.left + i + 0.5, y); else { ctx.moveTo(f.left + i + 0.5, y); on = true; }
  });
  ctx.stroke();
  // Where the layers really are, and how strongly they reflect: the markers the peaks should reach.
  ctx.fillStyle = c.layer;
  for (const b of B) {
    const x = f.X(b.D / 2), y = Y(Math.abs(b.a));
    ctx.beginPath(); ctx.moveTo(x, y - 1); ctx.lineTo(x - 4.5, y - 9); ctx.lineTo(x + 4.5, y - 9); ctx.closePath(); ctx.fill();
  }
  const mx = f.X(state.d);
  ctx.strokeStyle = c.mirror; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(mx, f.top); ctx.lineTo(mx, f.bottom); ctx.stroke();
  ctx.restore();
  ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = c.layer;
  ctx.fillText('▼ where each layer is, and how strongly it reflects', f.left + 6, f.top + 3);
  scanFrame = f;
}
let scanFrame = null;

function drawGrey(c) {
  const { ctx, f } = frameFor(greyC, { top: 2, bottom: 2 });
  const cols = columns(f), { A } = pass, top = Math.max(...B.map((b) => Math.abs(b.a)));
  const lo = Math.max(dbFloor() + 8, state.noise + 6), hi = 20 * Math.log10(top);
  cols.forEach((col, i) => {
    if (!col.on) { ctx.fillStyle = 'rgb(24,32,42)'; ctx.fillRect(f.left + i, f.top, 1, f.h); return; }
    let m = 0;
    for (let j = col.j0; j < col.j1; j++) if (A[j] > m) m = A[j];
    const g = greyOf(m, lo, hi);
    ctx.fillStyle = `rgb(${g},${g},${g})`; ctx.fillRect(f.left + i, f.top, 1, f.h);
  });
  ctx.fillStyle = c.ink2; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText('grey', f.left - 6, f.top + f.h / 2);
}

function describe() {
  const st = STACKS[state.sample], last = Math.max(...stack.layers.map((l) => l.z)), first = Math.min(...stack.layers.map((l) => l.z));
  const t = last - first;
  $('#a-describe').textContent = state.sample === 'pair'
    ? `${st.label}, in air: ${t.toFixed(2)} μm apart, at ${OFFSET + stack.n * first} and ${(OFFSET + stack.n * last).toFixed(2)} μm.`
    : `${st.label}: ${B.length} interfaces over ${um(t)} of material of index n = ${stack.n}, which is ${um(stack.n * t)} of optical path; its front ${OFFSET} μm beyond equal paths.`;
}

function readout() {
  describe();
  const found = foundPeaks().filter((p) => covers(record, p.d - 0.5, p.d + 0.5)), d = state.d;
  const near = B.reduce((p, q) => (Math.abs(q.D / 2 - d) < Math.abs(p.D / 2 - d) ? q : p));
  setGroups($('#a-readout-1'), [['Mirror at d = ', { v: d, dec: 1, w: 6 }, ' μm;'], ['the nearest layer, ', near.name + ',', ' is at ', { v: near.D / 2, dec: 1, w: 6 }, ' μm'],
    ...(stack.n > 1 ? [[`= ${OFFSET} μm of air + n z = `, { v: stack.n, dec: 2, w: 4 }, ' × ', { v: near.z, dec: 1, w: 5 }, ' μm']] : [])]);
  if (state.sample === 'pair') {
    const sep = state.gap;
    const shown = found.slice(0, 3).map((p) => p.d);
    setGroups($('#a-readout-2'), [['Two surfaces ', { v: sep, dec: 2, w: 5 }, ' μm apart (ℓ_c = ', { v: S.src.lc, dec: 2, w: 5 }, ' μm):'],
      found.length === 1 ? ['the A-scan shows one peak, at ', { v: shown[0], dec: 2, w: 6 }, ' μm'] :
        found.length === 2 ? ['two peaks, at ', { v: shown[0], dec: 2, w: 6 }, ' and ', { v: shown[1], dec: 2, w: 6 }, ' μm,', ' ', { v: shown[1] - shown[0], dec: 2, w: 5 }, ' μm apart'] :
          [`${found.length} peaks`]]);
  } else {
    setGroups($('#a-readout-2'), [['Layers: ', { v: B.length, dec: 0, w: 2 }, ';'], ['peaks above the noise so far: ', { v: found.length, dec: 0, w: 2 }, ';'],
      ['the weakest layer: ', { v: 20 * Math.log10(Math.min(...B.map((b) => Math.abs(b.a)))), dec: 1, w: 5 }, ' dB,'],
      ['the noise floor: ', sigmaR() ? { v: state.noise, dec: 1, w: 5 } : { text: 'none', w: 5 }, sigmaR() ? ' dB' : '']]);
  }
}

export function draw(force = false) {
  if (!dirty && !force) return;
  dirty = false;
  const c = octColors();
  drawStrip(c); drawTrace(c); drawScan(c); drawGrey(c); readout();
}
export function invalidate() { dirty = true; }

// --------------------------------------------------------------------- pointer: click to put the mirror there

for (const cv of [stripC, traceC, scanC, greyC]) {
  let on = false;
  const at = (e) => { const r = cv.getBoundingClientRect(); return scanFrame ? scanFrame.invX(e.clientX - r.left) : 0; };
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); on = true; setMotor('stop'); setMirror(at(e)); e.preventDefault(); });
  cv.addEventListener('pointermove', (e) => { if (on) setMirror(at(e)); });
  cv.addEventListener('pointerup', () => { on = false; });
  cv.addEventListener('pointercancel', () => { on = false; });
}

// --------------------------------------------------------------------- controls

let sampleSeg, gapSlider, noiseSlider, motorSeg, speedSlider, scaleSeg, aloneToggle;

export function init(shared) {
  S = shared;
  sampleSeg = segmented(Object.entries(STACKS).map(([k, s]) => ({ value: k, label: s.label, title: s.title })), state.sample, (v) => setSample(v), { label: 'Sample' });
  sampleSeg.classList.add('button-grid');
  $('#a-sample-box').append(sampleSeg);
  gapSlider = slider({ label: 'gap (μm)', min: 0.5, max: 30, step: 0.01, value: state.gap, title: 'How far apart the two surfaces are (in air, so geometric and optical are the same)',
    onInput: (v) => { state.gap = v; rebuild(); S.onChange(); } });
  aloneToggle = toggle('Show each surface alone', state.alone, (on) => { state.alone = on; dirty = true; S.onChange(); }, 'Draw, dashed, the A-scan each surface would make by itself');
  $('#a-gap-box').append(gapSlider, aloneToggle);
  noiseSlider = slider({ label: 'noise floor (dB)', min: -120, max: -10, step: 0.5, value: state.noise, title: 'The detector\'s noise, as the reflection it equals (−120: none)',
    onInput: (v) => { state.noise = v; compute(); S.onChange(); } });
  $('#a-noise-box').append(noiseSlider);
  motorSeg = segmented([
    { value: 'stop', label: '■', title: 'Stop' }, { value: 'fwd', label: '▶', title: 'One pass, front to back' },
    { value: 'sweep', label: '⇄', title: 'Scan back and forth, a new A-scan each pass' },
  ], state.motor, (m) => { if (m === 'fwd') { const [d0] = range(); state.d = d0; newPass(); } setMotor(m); }, { label: 'Motor' });
  $('#a-motor-box').append(motorSeg);
  speedSlider = slider({ label: 'speed (μm/s)', min: 2, max: 1000, log: true, value: state.speed, title: 'How fast the motor moves the mirror',
    onInput: (v) => { state.speed = v; S.onChange(); } });
  $('#a-speed-box').append(speedSlider);
  $('#a-whole').addEventListener('click', () => wholeScan());
  scaleSeg = segmented([{ value: 'lin', label: 'linear', title: 'The A-scan as reflectivity |r|' }, { value: 'db', label: 'dB', title: 'The A-scan in decibels, 20 log₁₀|r|: weak and strong layers on one plot' }],
    state.scale, (v) => { state.scale = v; dirty = true; S.onChange(); }, { label: 'Scale' });
  $('#a-scale-box').append(scaleSeg);
}

export function setSample(v) {
  state.sample = STACKS[v] ? v : 'slide';
  sampleSeg.value = state.sample;
  $('#a-gap-box').hidden = state.sample !== 'pair';
  rebuild();
  const [d0, d1] = range();
  state.speed = +((d1 - d0) / PASS).toPrecision(2); speedSlider.value = state.speed;
  state.d = Math.max(d0, Math.min(d1, state.d));
  record = addInterval([], state.d, state.d);
  S.onChange();
}

export function sync() {
  sampleSeg.value = state.sample; gapSlider.value = state.gap; noiseSlider.value = state.noise; motorSeg.value = state.motor;
  speedSlider.value = state.speed; scaleSeg.value = state.scale; aloneToggle.on = state.alone;
  $('#a-gap-box').hidden = state.sample !== 'pair';
  dirty = true;
}

export function configure(o = {}) {
  Object.assign(state, { sample: 'slide', gap: 8, noise: -60, motor: 'sweep', scale: 'db', d: 0, alone: true }, o);
  stack = makeStack(state.sample, { gap: state.gap });
  const [d0, d1] = range();
  if (o.speed === undefined) state.speed = +((d1 - d0) / PASS).toPrecision(2);
  sweepDir = 1;
  rebuild();
  record = o.whole ? [[d0, d1]] : addInterval([], state.d, state.d);
  if (o.whole) state.motor = 'stop';
  sync();
}

export function toHash() {
  const s = state;
  return { smp: s.sample, gap: s.sample === 'pair' ? s.gap : undefined, noise: s.noise, motor: s.motor, v: s.speed, scale: s.scale, d: +s.d.toFixed(2) };
}
export function fromHash(h, num) {
  configure({ sample: STACKS[h.smp] ? h.smp : 'slide', gap: num('gap', 8), noise: num('noise', -60), motor: ['stop', 'fwd', 'sweep'].includes(h.motor) ? h.motor : 'sweep',
    speed: num('v', undefined), scale: h.scale === 'lin' ? 'lin' : 'db', d: num('d', 0) });
}

/** For the tests. */
export const peek = () => ({ bursts: B.map((b) => ({ ...b })), pass, record: record.map((r) => r.slice()), range: range(), sigmaR: sigmaR(), seed });
