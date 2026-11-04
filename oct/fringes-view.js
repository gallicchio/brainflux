// View 1, "Fringes from a layer": the Michelson of the coherence demo with its second mirror
// replaced by a sample, one reflecting surface (and, if wanted, the back face of a glass plate).
// Moving the reference mirror through the surface's depth makes a burst of fringes as wide as
// the coherence length.  Lengths in μm; d is the mirror's position, measured from where the two
// arms are equal, and z the surface's depth from the same place.

import { el, $, slider, segmented, toggle, setGroups } from '../lib/ui.js';
import { fitCanvas, Frame } from '../lib/plot.js';
import { plateStack, bursts } from './sample.js';
import { dcLevel, complexEnvelope } from './tdoct.js';
import { glassBeta, glassAt, spectrumPerNm } from './source.js';
import { drawMichelson } from './pictures.js';
import { octColors, fieldAt, addInterval, covers, um, fringePixels, smoothFor } from './plots.js';
import { scopeTrace } from '../lib/scope.js';

export const state = {
  d: 32, motor: 'sweep', speed: 8,
  z: 50, two: false, t: 100, n: 1.5, glass: 0,
  win: [20, 80],
};
const D_LIM = [-200, 3000];
const ZOOM = 8;            // the magnified view: ±8 μm of mirror travel about the mirror

let S = null;              // the page's shared things: the source, the hash
let B = [], dc = 1, amp = 0.2, sweepDir = 1;
let record = [];           // the mirror positions the detector has seen: [[a, b], ...]
let dirty = true, hits = null, drag = null, specHits = null;

const schem = $('#f-schem'), specC = $('#f-spec'), zoomC = $('#f-zoom'), traceC = $('#f-trace');

// --------------------------------------------------------------------- the sample

/** The bursts the sample makes, for the present source and sample. */
function rebuild() {
  const beta = state.glass > 0 ? glassBeta(S.src, state.glass * 1000) : 0;
  B = bursts(plateStack({ two: state.two, t: state.t, n: state.n }), state.z, beta);
  dc = dcLevel(B, S.src);
  amp = B.reduce((s, b) => s + Math.abs(b.a), 0) || 0.2;
  dirty = true;
}

export function sourceChanged() { rebuild(); }

/** The surfaces at their optical depths (where the mirror finds them), for the pictures. */
function surfaces() {
  const out = [{ d: state.z, r: B[0].r, label: state.two ? 'front face' : 'reflecting surface' }];
  if (state.two) out.push({ d: state.z + state.n * state.t, r: B[1].r, label: 'back face' });
  return out;
}

// --------------------------------------------------------------------- the mirror

function clampD(d) { return Math.max(D_LIM[0], Math.min(D_LIM[1], d)); }

/** Move the mirror to d; continuous: the detector sees everything on the way. */
export function setMirror(d, continuous = true) {
  d = clampD(d);
  if (continuous) record = addInterval(record, state.d, d);
  else record = addInterval(record, d, d);
  state.d = d;
  follow();
  if (mirrorSlider) mirrorSlider.value = +d.toFixed(3);
  dirty = true;
  S.onChange();
}

function follow() {
  const [w0, w1] = state.win, W = w1 - w0, d = state.d;
  if (d >= w0 && d <= w1) return;
  if (d > w1) state.win = [d - 0.94 * W, d + 0.06 * W];
  else state.win = [d - 0.06 * W, d + 0.94 * W];
}

export function setWindow(w0, w1) { state.win = [w0, w1]; if (winSlider) winSlider.value = +(w1 - w0).toPrecision(4); dirty = true; S.onChange(); }
export function clearRecord() { record = []; dirty = true; }

export function setMotor(m) { state.motor = m; if (motorSeg) motorSeg.value = m; dirty = true; S.onChange(); }

/** Advance the motor by dt seconds. */
export function tick(dt) {
  if (state.motor === 'stop' || !(state.speed > 0) || !dt) return false;
  let dir = state.motor === 'fwd' ? 1 : state.motor === 'back' ? -1 : sweepDir;
  if (state.motor === 'sweep') {
    const [w0, w1] = state.win, m = 0.04 * (w1 - w0);
    if (state.d >= w1 - m && dir > 0) dir = sweepDir = -1;
    else if (state.d <= w0 + m && dir < 0) dir = sweepDir = 1;
  }
  // The mirror moves in steps of at most a tenth of a fringe, so the record misses nothing.
  setMirror(state.d + dir * state.speed * Math.min(dt, 0.1));
  return true;
}

// --------------------------------------------------------------------- measuring the burst

/** The full width at half maximum, in mirror travel, of burst i's envelope (exact, by bisection),
 *  or NaN if another burst overlaps it. */
export function burstWidth(i = 0) {
  const b = B[i], src = S.src, g = [0, 0];
  if (!b) return NaN;
  const reach = src.reachWith(b.beta || 0);
  for (const o of B) if (o !== b && Math.abs(o.D - b.D) < 1.2 * reach) return NaN;
  const peak = Math.hypot(...fieldAt(B, src, b.D, g)), half = peak / 2;
  const side = (s) => {
    let lo = 0, hi = reach;
    for (let k = 0; k < 60; k++) { const m = 0.5 * (lo + hi); if (Math.hypot(...fieldAt(B, src, b.D + s * m, g)) > half) lo = m; else hi = m; }
    return 0.5 * (lo + hi);
  };
  return (side(1) + side(-1)) / 2;   // (Δ₊ + Δ₋)/2: the width in Δ is twice that in d
}

/** The mirror position (μm) where burst i's envelope peaks: a golden-section search of |E|. */
export function burstCentre(i = 0) {
  const b = B[i], src = S.src, g = [0, 0];
  if (!b) return NaN;
  const f = (D) => Math.hypot(...fieldAt(B, src, D, g));
  let a = b.D - src.lc, c = b.D + src.lc;
  const r = (Math.sqrt(5) - 1) / 2;
  for (let k = 0; k < 80; k++) { const x1 = c - r * (c - a), x2 = a + r * (c - a); if (f(x1) > f(x2)) c = x2; else a = x1; }
  return (a + c) / 4;   // Δ/2
}

/** The detector's signal with the mirror at d. */
export const signal = (d) => dc + 2 * fieldAt(B, S.src, 2 * d)[0];

// --------------------------------------------------------------------- drawing

function drawSchem() {
  hits = drawMichelson(schem, {
    win: state.win, d: state.d, lc: S.src.lc * S.src.spread(B[0]?.beta || 0), surfaces: surfaces(),
    slab: state.two ? { d0: state.z, d1: state.z + state.n * state.t } : null,
    label: `glass, n = ${state.n}`,
    level: (signal(state.d) - (dc - 2 * amp)) / (4 * amp), sourceLabel: `${S.src.lamNm} nm`,
    glass: state.glass,
  });
}

function drawSpectrum(c) {
  const { ctx, width, height } = fitCanvas(specC), src = S.src;
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 16, right: 22, top: 10, bottom: 34 });
  const lam = src.lamNm, span = lam < 1000 ? 420 : 620;
  f.x0 = lam - span / 2; f.x1 = lam + span / 2; f.y0 = 0;
  const peak = spectrumPerNm(src, lam);
  f.y1 = 1.15;
  f.axes({ colors: c, xlabel: 'wavelength λ (nm)', yTicks: false });
  f.clip();
  ctx.beginPath();
  for (let i = 0; i <= f.w; i++) { const nm = f.invX(f.left + i), v = spectrumPerNm(src, nm) / peak; if (i) ctx.lineTo(f.left + i, f.Y(v)); else ctx.moveTo(f.left + i, f.Y(v)); }
  ctx.lineTo(f.right, f.bottom); ctx.lineTo(f.left, f.bottom); ctx.closePath();
  ctx.fillStyle = 'rgba(255,90,60,0.25)'; ctx.fill();
  ctx.strokeStyle = '#e0482a'; ctx.lineWidth = 1.5; ctx.stroke();
  // The full width at half maximum, with its handles.
  const a = lam - src.fwhmNm / 2, b = lam + src.fwhmNm / 2, y = f.Y(0.5);
  ctx.strokeStyle = c.ink2; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(f.X(a), y); ctx.lineTo(f.X(b), y); ctx.stroke(); ctx.setLineDash([]);
  specHits = [];
  for (const x of [a, b]) {
    const px = Math.max(f.left, Math.min(f.right, f.X(x)));
    ctx.fillStyle = c.panel; ctx.strokeStyle = c.ink; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px, y - 6); ctx.lineTo(px + 6, y); ctx.lineTo(px, y + 6); ctx.lineTo(px - 6, y); ctx.closePath(); ctx.fill(); ctx.stroke();
    specHits.push(px);
  }
  ctx.restore();
  ctx.fillStyle = c.ink2; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(`Δλ = ${+src.fwhmNm.toPrecision(3)} nm at half height`, f.left + 6, f.top + 2);
  specFrame = f;
}
let specFrame = null;

/**
 * The signal over the window, sampled finely enough for any fringe the source makes: every λ₀/16
 * of mirror travel (8 samples to the centre wavelength's fringe, 6 to the shortest's at 250 nm of
 * bandwidth, as view 2's detector samples), and at least four times a device pixel, so that a
 * fringe a few pixels wide keeps its peaks (in ?scope=fast too).  Kept while the window, the
 * sample, the source and the plot's width are unchanged.
 */
let sampled = { key: '', I: null, n: 0 };
function sampleSignal(x0, x1, devW) {
  const src = S.src, step = Math.min(src.lam0 / 16, (x1 - x0) / Math.max(1, 4 * devW)), n = Math.max(2, Math.ceil((x1 - x0) / step) + 1);
  const key = `${src.lamNm} ${src.fwhmNm} ${state.z} ${state.two} ${state.t} ${state.n} ${state.glass} ${x0} ${x1} ${n}`;
  if (sampled.key === key) return sampled;
  const re = new Float64Array(n), im = new Float64Array(n), I = new Float32Array(n), h = (x1 - x0) / (n - 1);
  complexEnvelope(B, src, 2 * x0, 2 * h, n, re, im);
  for (let i = 0; i < n; i++) I[i] = dc + 2 * re[i];
  sampled = { key, I, n };
  return sampled;
}

/** The signal over mirror positions [x0, x1] drawn into frame f, where the detector has been if recorded. */
function drawSignal(ctx, f, x0, x1, c, recorded) {
  const cols = Math.max(1, Math.round(f.w)), has = new Uint8Array(cols), envU = new Float32Array(cols);
  for (let i = 0; i < cols; i++) {
    const a = x0 + ((x1 - x0) * i) / cols, b = x0 + ((x1 - x0) * (i + 1)) / cols;
    if (recorded && !covers(record, a, b)) continue;
    has[i] = 1;
    envU[i] = Math.hypot(...fieldAt(B, S.src, a + b));
  }
  // The signal, drawn as a digital phosphor scope draws it (lib/scope.js): where many fringes
  // share a pixel, a band brightest at its turning points; where a fringe has a few pixels, the
  // fringe itself, anti-aliased.  Computed for the whole window, shown where the detector has been.
  const ivs = recorded ? record.filter((iv) => iv[1] > iv[0] && iv[1] > x0 && iv[0] < x1) : [[x0, x1]];
  if (ivs.length) {
    const devW = f.w * ctx.getTransform().a, sm = sampleSignal(x0, x1, devW), I = sm.I;
    ctx.save();
    ctx.beginPath();
    for (const iv of ivs) ctx.rect(f.X(iv[0]), f.top, f.X(iv[1]) - f.X(iv[0]), f.h);
    ctx.clip();
    scopeTrace(ctx, f, { n: sm.n, y: (i) => f.Y(I[i]), x0: f.X(x0), x1: f.X(x1), color: c.sig,
      smooth: smoothFor(fringePixels(S.src, x1 - x0, devW)), key: `oct f-trace ${sm.key} ${f.y0} ${f.y1}` });
    ctx.restore();
  }
  // The envelope dc ± 2|E| (what OCT keeps), dashed.
  if (recorded) {
    ctx.strokeStyle = c.env; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]);
    for (const s of [1, -1]) {
      ctx.beginPath(); let on = false;
      for (let i = 0; i < cols; i++) {
        if (!has[i]) { on = false; continue; }
        const y = f.Y(dc + s * 2 * envU[i]);
        if (on) ctx.lineTo(f.left + i + 0.5, y); else { ctx.moveTo(f.left + i + 0.5, y); on = true; }
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
}

function yRange() { return [dc - 2.25 * amp, dc + 2.25 * amp]; }

function drawTrace(c) {
  const { ctx, width, height } = fitCanvas(traceC);
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 46, right: 14, top: 14, bottom: 34 });
  [f.x0, f.x1] = state.win; [f.y0, f.y1] = yRange();
  f.axes({ colors: c, xlabel: 'mirror position d (μm)', ylabel: 'signal' });
  f.clip();
  // Where the detector has not been: a faint note.
  ctx.fillStyle = c.faint; ctx.fillRect(f.left, f.top, f.w, f.h);
  for (const iv of record) { const a = Math.max(f.left, f.X(iv[0])), b = Math.min(f.right, f.X(iv[1])); if (b > a) { ctx.fillStyle = c.panel; ctx.fillRect(a, f.top, b - a, f.h); } }
  // The level with no fringes.
  ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(f.left, f.Y(dc)); ctx.lineTo(f.right, f.Y(dc)); ctx.stroke();
  drawSignal(ctx, f, f.x0, f.x1, c, true);
  // The surfaces' depths: where a burst should be.
  for (const s of surfaces()) {
    const x = f.X(s.d);
    if (x < f.left - 1 || x > f.right + 1) continue;
    ctx.fillStyle = c.layer; ctx.beginPath(); ctx.moveTo(x, f.top + 9); ctx.lineTo(x - 5, f.top); ctx.lineTo(x + 5, f.top); ctx.closePath(); ctx.fill();
    ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = x > f.right - 90 ? 'right' : 'left';
    ctx.fillText(`${s.label} at ${um(s.d)}`, x + (ctx.textAlign === 'left' ? 7 : -7), f.top + 1);
  }
  // The mirror.
  const mx = f.X(state.d);
  ctx.strokeStyle = c.mirror; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(mx, f.top); ctx.lineTo(mx, f.bottom); ctx.stroke();
  ctx.fillStyle = c.mirror; ctx.beginPath(); ctx.arc(mx, f.bottom - 6, 5, 0, 2 * Math.PI); ctx.fill();
  ctx.restore();
  // A legend.
  ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
  ctx.fillStyle = c.env; ctx.fillText('- - envelope of the fringes', f.right - 4, f.bottom - 10);
  traceFrame = f;
}
let traceFrame = null;

function drawZoom(c) {
  const { ctx, width, height } = fitCanvas(zoomC);
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 46, right: 14, top: 10, bottom: 34 });
  f.x0 = state.d - ZOOM; f.x1 = state.d + ZOOM; [f.y0, f.y1] = yRange();
  f.axes({ colors: c, xlabel: 'mirror position d (μm)', ylabel: 'signal' });
  f.clip();
  ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(f.left, f.Y(dc)); ctx.lineTo(f.right, f.Y(dc)); ctx.stroke();
  const g = [0, 0];
  ctx.strokeStyle = c.env; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
  for (const s of [1, -1]) {
    ctx.beginPath();
    for (let i = 0; i <= f.w; i += 2) { const d = f.invX(f.left + i), y = f.Y(dc + s * 2 * Math.hypot(...fieldAt(B, S.src, 2 * d, g))); if (i) ctx.lineTo(f.left + i, y); else ctx.moveTo(f.left + i, y); }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = c.sig; ctx.lineWidth = 1.4; ctx.beginPath();
  const n = Math.max(2, Math.round(f.w * 2));
  for (let i = 0; i <= n; i++) { const d = f.x0 + ((f.x1 - f.x0) * i) / n, y = f.Y(signal(d)); if (i) ctx.lineTo(f.X(d), y); else ctx.moveTo(f.X(d), y); }
  ctx.stroke();
  const mx = f.X(state.d);
  ctx.strokeStyle = c.mirror; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(mx, f.top); ctx.lineTo(mx, f.bottom); ctx.stroke();
  // A scale bar: one fringe is λ₀/2 of mirror travel.
  const half = S.src.lam0 / 2, bx = f.left + 8, by = f.top + 10;
  ctx.strokeStyle = c.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + f.X(f.x0 + half) - f.left, by); ctx.stroke();
  ctx.fillStyle = c.ink2; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(`one fringe: λ₀/2 = ${(half * 1000).toFixed(0)} nm of mirror travel`, bx + f.X(f.x0 + half) - f.left + 6, by);
  ctx.restore();
}

function readout() {
  const src = S.src, s = surfaces(), d = state.d;
  const near = s.reduce((p, q) => (Math.abs(q.d - d) < Math.abs(p.d - d) ? q : p));
  setGroups($('#f-readout-1'), [['Mirror at d = ', { v: d, dec: 2, w: 6 }, ' μm;'], [`the ${near.label} is `, { v: near.d, dec: 1, w: 5 }, ' μm away in optical path,'],
    ['so the two paths differ by ', { v: 2 * (d - near.d), dec: 2, w: 7, plus: '+' }, ' μm']]);
  const w = burstWidth(0), spread = src.spread(B[0]?.beta || 0);
  const wide = src.lc > 999;
  const parts = [['The burst\'s width at half height: ', Number.isFinite(w) && !wide ? { v: w, dec: 2, w: 5 } : { text: wide ? 'all' : '–', w: 5 }, ' μm'],
    spread > 1.0005 ? ['(ℓ_c = 0.44 λ₀²/Δλ = ', { v: src.lc, dec: 2, w: 5 }, ' μm,'] : ['(ℓ_c = 0.44 λ₀²/Δλ = ', { v: src.lc, dec: wide ? 0 : 2, w: 5 }, ' μm)'],
    ...(spread > 1.0005 ? [['spread ', { v: spread, dec: 2, w: 4 }, ' times by the glass)']] : [])];
  setGroups($('#f-readout-2'), parts);
  if (state.two) {
    const sep = burstCentre(1) - burstCentre(0);
    setGroups($('#f-readout-3'), [['The two bursts\' centres are ', { v: sep, dec: 2, w: 6 }, ' μm apart:'], ['n t = ', { v: state.n, dec: 2, w: 4 }, ' × ', { v: state.t, dec: 1, w: 5 }, ' μm,'],
      'the plate\'s optical thickness, not its thickness']);
  } else setGroups($('#f-readout-3'), ['One surface: one burst.  Add the back face (on the right) to see two.']);
}

export function draw(force = false) {
  if (!dirty && !force) return;
  dirty = false;
  const c = octColors();
  drawSchem(); drawSpectrum(c); drawTrace(c); drawZoom(c); readout();
}
export function invalidate() { dirty = true; }

// --------------------------------------------------------------------- pointer

function canvasPoint(cv, e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

function onMirror(px, py) {
  if (!hits) return false;
  const [x, y, w, h] = hits.mirror;
  return px >= x - 8 && px <= x + w + 8 && py >= y - 10 && py <= y + h + 6;
}
schem.addEventListener('pointerdown', (e) => {
  const [px, py] = canvasPoint(schem, e);
  if (!onMirror(px, py)) return;
  schem.setPointerCapture(e.pointerId);
  drag = { px, d: state.d };
  setMotor('stop');
  e.preventDefault();
});
schem.addEventListener('pointermove', (e) => {
  const [px, py] = canvasPoint(schem, e);
  if (!drag) { schem.style.cursor = onMirror(px, py) ? 'ew-resize' : 'default'; return; }
  // The rail spans state.win over 2 × span drawn units.
  const perPx = (state.win[1] - state.win[0]) / (2 * hits.span * hits.u);
  setMirror(drag.d + (px - drag.px) * perPx);
});
const endDrag = () => { drag = null; };
schem.addEventListener('pointerup', endDrag);
schem.addEventListener('pointercancel', endDrag);
schem.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 1 : 0.05;
  if (e.key === 'ArrowRight') setMirror(state.d + step); else if (e.key === 'ArrowLeft') setMirror(state.d - step); else return;
  setMotor('stop'); e.preventDefault();
});

// Click or drag on the trace: the mirror goes there.
let traceDrag = false;
traceC.addEventListener('pointerdown', (e) => {
  if (!traceFrame) return;
  const [px] = canvasPoint(traceC, e);
  traceC.setPointerCapture(e.pointerId); traceDrag = true;
  setMotor('stop'); setMirror(traceFrame.invX(px));
  e.preventDefault();
});
traceC.addEventListener('pointermove', (e) => { if (traceDrag) setMirror(traceFrame.invX(canvasPoint(traceC, e)[0])); });
traceC.addEventListener('pointerup', () => { traceDrag = false; });
traceC.addEventListener('pointercancel', () => { traceDrag = false; });

// Drag a ◇ on the spectrum: the bandwidth.
let specDrag = false;
specC.addEventListener('pointerdown', (e) => {
  if (!specHits || !specFrame) return;
  const [px, py] = canvasPoint(specC, e);
  if (!specHits.some((x) => Math.abs(px - x) < 12) || Math.abs(py - specFrame.Y(0.5)) > 14) return;
  specC.setPointerCapture(e.pointerId); specDrag = true; e.preventDefault();
});
specC.addEventListener('pointermove', (e) => {
  const [px, py] = canvasPoint(specC, e);
  if (!specDrag) { specC.style.cursor = specHits && specFrame && specHits.some((x) => Math.abs(px - x) < 12) && Math.abs(py - specFrame.Y(0.5)) < 14 ? 'ew-resize' : 'default'; return; }
  const nm = specFrame.invX(px);
  S.setBandwidth(Math.max(0.05, Math.min(250, 2 * Math.abs(nm - S.src.lamNm))));
});
specC.addEventListener('pointerup', () => { specDrag = false; });
specC.addEventListener('pointercancel', () => { specDrag = false; });

// --------------------------------------------------------------------- controls

let mirrorSlider, motorSeg, speedSlider, winSlider, zSlider, twoToggle, tSlider, nSlider, glassSlider;

function sampleChanged() { rebuild(); S.onChange(); }

export function init(shared) {
  S = shared;
  zSlider = slider({ label: 'surface depth z (μm)', min: 0, max: 300, step: 0.1, value: state.z, title: 'How far beyond equal paths the (front) surface is',
    onInput: (v) => { state.z = v; sampleChanged(); } });
  twoToggle = toggle('Add the back face: a glass plate', state.two, (on) => { state.two = on; $('#f-plate-box').hidden = !on; sampleChanged(); },
    'Make the surface the front of a plate of glass, and let its back face reflect too');
  tSlider = slider({ label: 'thickness t (μm)', min: 5, max: 500, step: 0.5, value: state.t, onInput: (v) => { state.t = v; sampleChanged(); } });
  nSlider = slider({ label: 'index n', min: 1, max: 2.4, step: 0.01, value: state.n, title: 'The glass\'s refractive index (taken the same for every wavelength here)',
    onInput: (v) => { state.n = v; sampleChanged(); } });
  glassSlider = slider({ label: 'BK7 glass (mm)', min: 0, max: 10, step: 0.05, value: state.glass,
    title: 'A block of BK7 glass in the sample arm, with no twin in the reference arm', onInput: (v) => { state.glass = v; sampleChanged(); } });
  $('#f-sample-box').append(zSlider, twoToggle);
  $('#f-plate-box').append(tSlider, nSlider);
  $('#f-plate-box').hidden = !state.two;
  $('#f-glass-box').append(glassSlider);

  mirrorSlider = slider({ label: 'mirror d (μm)', min: D_LIM[0], max: 600, step: 0.01, value: state.d, title: 'The reference mirror\'s position',
    onInput: (v) => { setMotor('stop'); setMirror(v); } });
  motorSeg = segmented([
    { value: 'back', label: '◀', title: 'Run the mirror backwards' }, { value: 'stop', label: '■', title: 'Stop' },
    { value: 'fwd', label: '▶', title: 'Run the mirror forwards' }, { value: 'sweep', label: '⇄', title: 'Sweep back and forth across the trace\'s window' },
  ], state.motor, (m) => setMotor(m), { label: 'Motor' });
  speedSlider = slider({ label: 'speed (μm/s)', min: 0.2, max: 200, log: true, value: state.speed, title: 'How fast the motor moves the mirror',
    onInput: (v) => { state.speed = v; S.onChange(); } });
  winSlider = slider({ label: 'window (μm)', min: 4, max: 3000, log: true, value: state.win[1] - state.win[0], title: 'How much mirror travel the trace shows',
    onInput: (W) => { const d = state.d, [a, b] = state.win; let t = (d - a) / (b - a); if (!(t >= 0 && t <= 1)) t = 0.5; setWindow(d - t * W, d + (1 - t) * W); } });
  $('#f-mirror-box').append(mirrorSlider);
  $('#f-motor-box').append(motorSeg);
  $('#f-speed-box').append(speedSlider, winSlider);
  $('#f-clear').addEventListener('click', () => clearRecord());
  $('#f-fit').addEventListener('click', () => fitWindow());
  rebuild();
}

/** Fit the window to both surfaces (or the one), with room for their bursts. */
export function fitWindow() {
  const s = surfaces(), a = Math.min(...s.map((q) => q.d)), b = Math.max(...s.map((q) => q.d)), m = Math.max(4 * S.src.lc, 0.15 * (b - a), 10);
  setWindow(a - m, b + m);
}

/** Put the controls in step with the state. */
export function sync() {
  zSlider.value = state.z; twoToggle.on = state.two; tSlider.value = state.t; nSlider.value = state.n; glassSlider.value = state.glass;
  $('#f-plate-box').hidden = !state.two;
  mirrorSlider.value = state.d; motorSeg.value = state.motor; speedSlider.value = state.speed; winSlider.value = +(state.win[1] - state.win[0]).toPrecision(4);
  if (state.glass > 0) $('#f-more').open = true;
  dirty = true;
}

/** A set-up: the sample, the mirror, the motor and the window. */
export function configure(o = {}) {
  Object.assign(state, { d: 32, motor: 'sweep', speed: 8, z: 50, two: false, t: 100, n: 1.5, glass: 0, win: [20, 80] }, o);
  record = [];
  rebuild();
  sync();
  if (o.fit) fitWindow();
  record = addInterval([], state.d, state.d);
}

export function toHash() {
  const s = state;
  return { d: +s.d.toFixed(3), z: s.z, two: s.two ? 1 : undefined, t: s.two ? s.t : undefined, n: s.two ? s.n : undefined, glass: s.glass || undefined,
    motor: s.motor, v: s.speed, w0: +s.win[0].toPrecision(6), w1: +s.win[1].toPrecision(6) };
}
export function fromHash(h, num) {
  configure({ d: num('d', 32), z: num('z', 50), two: h.two === '1', t: num('t', 100), n: num('n', 1.5), glass: num('glass', 0),
    motor: ['fwd', 'back', 'stop', 'sweep'].includes(h.motor) ? h.motor : 'sweep', speed: num('v', 8),
    win: num('w1', NaN) > num('w0', NaN) ? [num('w0'), num('w1')] : [20, 80] });
}

/** For the tests. */
export const peek = () => ({ bursts: B.map((b) => ({ ...b })), dc, record: record.map((r) => r.slice()), win: state.win.slice() });
