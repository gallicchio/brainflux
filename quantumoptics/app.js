// Quantum optics: squeezed light and LIGO.  Four views, each a step: one mode of the field as
// a cloud in the quadrature plane; squeezing it; homodyne detection; LIGO.  The physics is in
// states.js, homodyne.js, ligo.js and detector.js (LIGO's output: noise, chirp, matched filter);
// the quadrature plane is drawn by plane.js and the sketches by pictures.js; this file is the page.

import {
  gaussianState, rotated, quadratureMean, quadratureVariance, principalSpreads, samplePoint, meanPhotons,
  squeezeDb, rFromDb, lossyVariance, photonDistribution, poisson, photonMoments,
} from './states.js';
import { Rng, sample, VarianceRecord, noiseDb, phaseMeasurement } from './homodyne.js';
import {
  DEFAULTS, noiseBudget, quantumNoise, sqlFrequency, darkPortPhase, chirpMass, iscoFrequency, chirpSignal, amplitudeSpectrum, MPC,
} from './ligo.js';
import { Detector } from './detector.js';
import { Plane, drawColorbar } from './plane.js';
import { drawSqueezer, drawHomodyne, drawLigo } from './pictures.js';
import { el, $, slider, segmented, toggle, drawer, readHash, writeHash, setSlots, setGroups } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors, fillSlots, slotsWidth, niceTicks, tickLabel } from '../lib/plot.js';
import { fft } from '../lib/fft.js';
import { scopeTrace } from '../lib/scope.js';

const DEG = Math.PI / 180;
const EXTENT = 5;                 // the quadrature plane shows |X| < 5
const TRACE_PERIODS = 4;          // periods of the field shown
const SAMPLE_RATE = 2400;         // homodyne samples per second of the page's clock
const STRIP_N = 500;              // samples on the strip chart
const HIST_BINS = 60;             // value bins of the histogram over [−EXTENT, EXTENT]
const SQ6 = Math.LN2;             // the presets' squeezing, r = ln 2: ΔX = 1/4 and 1 exactly, 6.02 dB
const SOURCES = {
  bns: { label: 'Two neutron stars', m1: 1.4, m2: 1.4, fmin: 70, d: 40, fs: 8192, title: '1.4 + 1.4 solar masses, as GW170817; from 70 Hz, a few seconds to merger' },
  bbh: { label: 'Two black holes', m1: 10, m2: 10, fmin: 20, d: 500, fs: 4096, title: '10 + 10 solar masses, from 20 Hz: heavier, so louder, and merging at 220 Hz' },
};
// The detector's output: 8 s at 4096 samples a second, the chirp merging at 7 s; the noise's
// seed (113: a typical realisation, its filter output near 0 at the merger); the template slides
// along the data in 6 s.
const DET_FS = 4096, DET_T = 8, DET_MERGE = 7, DET_SEED = 113, SLIDE_RATE = DET_T / 6;

// ------------------------------------------------------------------------- state

const state = {
  view: 'mode',                   // 'mode' | 'squeeze' | 'homodyne' | 'ligo'
  kind: 'laser',                  // 'vacuum' | 'laser'
  alpha: 3, phase: 0,             // |α| and its phase (degrees)
  r: 0, psi: 0, eta: 1,           // squeezing, its angle (degrees), the transmission after loss
  period: 4,                      // seconds of the page's clock per period of the light
  running: true,
  show: { ellipse: true, wedge: false },
  theta: 0, motor: 'stop', rate: 30, shift: 0,     // the LO's phase (degrees), its motor, degrees per second, the phase shift (rad)
  ligo: { P: DEFAULTS.P, fc: DEFAULTS.fc, M: DEFAULTS.M },
  sq: { on: false, dB: 6, angle: 90, eta: 0.8, fd: false },
  source: 'bns', distance: 40,
  seed: DET_SEED, data: 'white', template: true,   // the noise's seed, whitened or raw data, the template drawn
  lag: DET_MERGE,                 // where the template's merger is put (s): lined up with the chirp's
};
// The clocks.  t: the time in periods of the light (views 1 and 2); the point drawn from the
// cloud for the current period; the field's record.  Homodyne: the samples.
const anim = { t: 0, sample: null, samplePeriod: -1, trace: [], sweepDir: 1, sliding: false };
const rng = new Rng(12345);
const record = new VarianceRecord(180);
let hist2d = new Uint32Array(record.bins * HIST_BINS);
const strip = new Float32Array(STRIP_N);
let stripN = 0, stripPos = 0;
let chirp = null;                 // {signal, spec (log-binned), key}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r5 = (v) => +(+v).toPrecision(5);

/** The state of the mode, unturned (t = 0), in the lab frame. */
function baseState() {
  const a = state.kind === 'vacuum' ? 0 : state.alpha, ph = state.phase * DEG;
  return gaussianState({ x1: a * Math.cos(ph), x2: a * Math.sin(ph), r: state.r, psi: state.psi * DEG, eta: state.eta });
}
/** The homodyne signal: the base state turned by the phase shift. */
function signalState() { return state.shift ? rotated(baseState(), state.shift) : baseState(); }

// ------------------------------------------------------------------- colours

let colors = null;
function readColors() {
  const cs = getComputedStyle(document.documentElement), get = (n, f) => cs.getPropertyValue(n).trim() || f;
  const t = themeColors();
  colors = { ...t, signal: get('--signal', '#c8501a'), lo: get('--lo', '#d9a400'), axis: get('--lo', '#d9a400'), band: get('--band', 'rgba(90,100,120,0.22)'),
    pump: get('--pump', '#1f7a3a'), shot: get('--shot', '#2f62d8'), rp: get('--rp', '#7b3fb5'), thermal: get('--thermal', '#b0307a'), seismic: get('--seismic', '#8a8b91'),
    chirp: get('--chirp', '#1f7a3a'), sq: get('--sq', '#0f8a8a'),
    cloud: 'rgba(220, 60, 50, 0.6)', sqFill: 'rgba(15, 138, 138, 0.6)', histFill: 'rgba(217, 164, 0, 0.35)', crystal: 'rgba(120, 190, 240, 0.35)', lossFill: 'rgba(128, 128, 128, 0.18)', bsFill: 'rgba(120, 160, 220, 0.3)' };
}

// ------------------------------------------------------------- views 1 and 2: the plane

const plane = new Plane($('#plane'), { extent: EXTENT });
let lastTurned = null;

function currentTurn() { return 2 * Math.PI * anim.t; }

/** The point of the cloud for this period, drawn afresh each period. */
function ensureSample(base) {
  const k = Math.floor(anim.t);
  if (anim.samplePeriod !== k || !anim.sample) {
    anim.sample = samplePoint(base, () => rng.gauss());
    anim.samplePeriod = k;
  }
  return anim.sample;
}

function fieldNow(base) {
  const s = ensureSample(base), th = currentTurn();
  return s[0] * Math.cos(th) + s[1] * Math.sin(th);
}

function drawPlaneView() {
  const base = baseState(), th = currentTurn();
  const turned = rotated(base, -th);
  lastTurned = turned;
  const s = ensureSample(base), c = Math.cos(th), sn = Math.sin(th);
  const stick = [s[0] * c + s[1] * sn, -s[0] * sn + s[1] * c];
  plane.draw(base, th, turned, { stick, ellipse: state.show.ellipse, wedge: state.show.wedge, colors, xnote: '(the field now)' });
}

// The field E(t): the shadow of the point on the X1 axis, recorded as the clock runs.
const traceCanvas = $('#trace');
function recordField() {
  const base = baseState();
  const E = fieldNow(base);
  const tr = anim.trace;
  if (tr.length && tr[tr.length - 1][0] >= anim.t) return;
  tr.push([anim.t, E]);
  const t0 = anim.t - TRACE_PERIODS - 0.2;
  let k = 0;
  while (k < tr.length && tr[k][0] < t0) k++;
  if (k) tr.splice(0, k);
}

function drawTrace() {
  const { ctx, width, height } = fitCanvas(traceCanvas);
  const c = colors;
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 40, right: 12, top: 30, bottom: 34 });
  f.x0 = anim.t - TRACE_PERIODS + 0.3; f.x1 = anim.t + 0.3;
  const base = baseState(), sp = principalSpreads(base), a = Math.hypot(base.x1, base.x2);
  const ymax = Math.max(1.2, 1.15 * (a + 1.6 * sp.max));
  f.y0 = -ymax; f.y1 = ymax;
  ctx.fillStyle = c.panel; ctx.fillRect(f.left, f.top, f.w, f.h);
  f.clip();
  // The band ⟨X_θ⟩ ± ΔX_θ at θ = 2πt, and the mean field.
  const N = 240, xs = [], up = [], lo = [], mid = [];
  for (let i = 0; i <= N; i++) {
    const t = f.x0 + ((f.x1 - f.x0) * i) / N, th = 2 * Math.PI * t;
    const m = quadratureMean(base, th), sd = Math.sqrt(quadratureVariance(base, th));
    xs.push(f.X(t)); mid.push(f.Y(m)); up.push(f.Y(m + sd)); lo.push(f.Y(m - sd));
  }
  ctx.fillStyle = c.band;
  ctx.beginPath(); ctx.moveTo(xs[0], up[0]);
  for (let i = 1; i <= N; i++) ctx.lineTo(xs[i], up[i]);
  for (let i = N; i >= 0; i--) ctx.lineTo(xs[i], lo[i]);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = c.ink3; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
  ctx.beginPath(); for (let i = 0; i <= N; i++) i ? ctx.lineTo(xs[i], mid[i]) : ctx.moveTo(xs[i], mid[i]); ctx.stroke();
  ctx.setLineDash([]);
  // Zero.
  ctx.strokeStyle = c.line; ctx.beginPath(); ctx.moveTo(f.left, f.Y(0) + 0.5); ctx.lineTo(f.right, f.Y(0) + 0.5); ctx.stroke();
  // The record.
  const tr = anim.trace;
  ctx.strokeStyle = c.signal; ctx.lineWidth = 2;
  ctx.beginPath();
  let pen = false, lastPeriod = -1;
  for (const [t, E] of tr) {
    const k = Math.floor(t);
    if (k !== lastPeriod) { pen = false; lastPeriod = k; }   // a new point of the cloud: a new piece
    const x = f.X(t), y = f.Y(E);
    if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    pen = true;
  }
  ctx.stroke();
  if (tr.length) {
    const [t, E] = tr[tr.length - 1];
    ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(f.X(t), f.Y(E), 4, 0, 2 * Math.PI); ctx.fill();
  }
  // Period marks.
  ctx.strokeStyle = c.line; ctx.setLineDash([2, 4]);
  for (let k = Math.ceil(f.x0); k <= f.x1; k++) { const x = Math.round(f.X(k)) + 0.5; ctx.beginPath(); ctx.moveTo(x, f.top); ctx.lineTo(x, f.bottom); ctx.stroke(); }
  ctx.setLineDash([]);
  ctx.restore();
  f.axes({ colors: c, xlabel: 'time, in periods of the light', ylabel: 'E(t) ∝ X₁(t)', xTicks: true });
  // A legend.
  ctx.save(); ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillStyle = c.ink2; ctx.textAlign = 'left';
  let x = f.left + 8; const y = f.bottom - 10;
  ctx.fillStyle = c.band; ctx.fillRect(x, y - 5, 16, 10); x += 20; ctx.fillStyle = c.ink2; ctx.fillText('mean ± ΔX', x, y); x += ctx.measureText('mean ± ΔX').width + 14;
  ctx.strokeStyle = c.signal; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 16, y); ctx.stroke(); x += 20; ctx.fillText('one point of the cloud, as it turns', x, y);
  ctx.restore();
}

// The photon numbers.
const photonsCanvas = $('#photons');
let photonCache = { key: '', P: null, Q: null };
function photons() {
  const b = baseState(), key = [b.x1, b.x2, b.s11, b.s12, b.s22].map((v) => v.toPrecision(5)).join(',');
  if (photonCache.key !== key) {
    const a = state.kind === 'vacuum' ? 0 : state.alpha, ph = state.phase * DEG;
    const P = photonDistribution({ x1: a * Math.cos(ph), x2: a * Math.sin(ph), r: state.r, psi: state.psi * DEG, eta: state.eta }, 200);
    const nbar = meanPhotons(b), Q = poisson(nbar, 200);
    photonCache = { key, P, Q, moments: photonMoments(P), nbar };
  }
  return photonCache;
}

function drawPhotons() {
  const { ctx, width, height } = fitCanvas(photonsCanvas);
  const c = colors, { P, Q, moments, nbar } = photons();
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 44, right: 12, top: 28, bottom: 28 });
  const nShow = clamp(Math.ceil(moments.mean + 4 * moments.sd + 4), 12, 80);
  f.x0 = -0.5; f.x1 = nShow + 0.5;
  let pmax = 0;
  for (let n = 0; n <= nShow; n++) pmax = Math.max(pmax, P[n], Q[n]);
  f.y0 = 0; f.y1 = pmax * 1.12 || 1;
  ctx.fillStyle = c.panel; ctx.fillRect(f.left, f.top, f.w, f.h);
  f.clip();
  const bw = f.w / (nShow + 1);
  for (let n = 0; n <= nShow; n++) {
    const x = f.X(n), y = f.Y(P[n]);
    ctx.fillStyle = c.cloud; ctx.fillRect(x - bw * 0.38, y, bw * 0.76, f.bottom - y);
  }
  // The Poisson distribution of the same mean, for comparison, when the state is not coherent.
  const squeezed = state.r > 0;
  if (squeezed && nbar > 0.05) {
    ctx.strokeStyle = c.ink2; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let n = 0; n <= nShow; n++) { const x = f.X(n), y = f.Y(Q[n]); ctx.moveTo(x - bw * 0.38, y); ctx.lineTo(x + bw * 0.38, y); }
    ctx.stroke(); ctx.setLineDash([]);
  }
  if (nbar > 0.05) { const x = Math.round(f.X(moments.mean)) + 0.5; ctx.strokeStyle = c.ink; ctx.setLineDash([5, 3]); ctx.beginPath(); ctx.moveTo(x, f.top); ctx.lineTo(x, f.bottom); ctx.stroke(); ctx.setLineDash([]); }
  ctx.restore();
  f.axes({ colors: c, xlabel: 'photon number n', ylabel: 'P(n)' });
  ctx.save(); ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = c.ink2; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  const parts = nbar > 0.05
    ? ['⟨n⟩ = ', { v: moments.mean, dec: 2, w: 6 }, ',  Δn = ', { v: moments.sd, dec: 2, w: 5 }, squeezed ? '   (dashes: Poisson, Δn = ' : '   (Poisson: Δn = √⟨n⟩ = ', { v: Math.sqrt(nbar), dec: 2, w: 5 }, ')']
    : ['no photons: P(0) = ', { v: P[0], dec: 3, w: 5 }];
  fillSlots(ctx, parts, f.right - 4, f.top + 4);
  ctx.restore();
}

// The squeezer sketch.
function drawSqueezerView() {
  const { ctx, width, height } = fitCanvas($('#squeezer'));
  const a = state.kind === 'vacuum' ? 0 : state.alpha, ph = state.phase * DEG;
  const input = gaussianState({ x1: a * Math.cos(ph), x2: a * Math.sin(ph) });
  const squeezed = gaussianState({ x1: input.x1, x2: input.x2, r: state.r, psi: state.psi * DEG });
  drawSqueezer(ctx, width, height, { input, squeezed, out: baseState(), r: state.r, dB: squeezeDb(state.r), eta: state.eta, isVacuum: state.kind === 'vacuum' }, colors);
}

// ------------------------------------------------------------------ view 3: homodyne

function takeSamples(dt) {
  const n = Math.round(dt * SAMPLE_RATE);
  if (n <= 0) return;
  const st = signalState(), th = state.theta * DEG, m = quadratureMean(st, th), sd = Math.sqrt(quadratureVariance(st, th));
  const tb = record.bin(th);
  for (let i = 0; i < n; i++) {
    const x = m + sd * rng.gauss();
    record.add(th, x);
    const vb = Math.floor(((x + EXTENT) / (2 * EXTENT)) * HIST_BINS);
    if (vb >= 0 && vb < HIST_BINS) hist2d[tb * HIST_BINS + vb]++;
    strip[stripPos] = x; stripPos = (stripPos + 1) % STRIP_N; stripN = Math.min(STRIP_N, stripN + 1);
  }
}

function clearRecord() {
  record.reset(); hist2d.fill(0); stripN = 0; stripPos = 0;
  dirty();
}

function motorStep(dt) {
  if (state.motor === 'stop') return;
  let th = state.theta;
  if (state.motor === 'scan') th += state.rate * dt;
  else { th += anim.sweepDir * state.rate * dt; if (th >= 180) { th = 180; anim.sweepDir = -1; } if (th <= 0) { th = 0; anim.sweepDir = 1; } }
  th = ((th % 360) + 360) % 360;
  state.theta = th;
  if (thetaSlider) thetaSlider.value = Math.round(th);   // the box shows whole degrees as it turns
}

function histogramAt(thetaDeg) {
  const tb = record.bin(thetaDeg * DEG), centers = [], counts = [];
  let max = 0;
  for (let v = 0; v < HIST_BINS; v++) {
    const n = hist2d[tb * HIST_BINS + v];
    centers.push(-EXTENT + ((v + 0.5) * 2 * EXTENT) / HIST_BINS); counts.push(n); max = Math.max(max, n);
  }
  return { centers, counts, max };
}

function drawHomodynePlane() {
  const st = signalState();
  plane.draw(st, 0, st, { stick: null, ellipse: state.show.ellipse, wedge: false, axis: state.theta, hist: histogramAt(state.theta), colors, axisLabel: 'X_θ', reference: state.shift ? baseState() : null, xnote: '(the LO\'s frame: the cloud stands still)' });
}

function drawApparatus() {
  const { ctx, width, height } = fitCanvas($('#apparatus'));
  drawHomodyne(ctx, width, height, { signal: signalState(), theta: state.theta }, colors);
}

function drawStrip() {
  const { ctx, width, height } = fitCanvas($('#strip'));
  const c = colors;
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 40, right: 12, top: 30, bottom: 30 });
  const st = signalState(), th = state.theta * DEG, m = quadratureMean(st, th), sd = Math.sqrt(quadratureVariance(st, th));
  const sp = principalSpreads(st), a = Math.hypot(st.x1, st.x2), ymax = Math.max(1.2, 1.15 * (a + 1.6 * sp.max));
  f.x0 = 0; f.x1 = STRIP_N; f.y0 = -ymax; f.y1 = ymax;
  ctx.fillStyle = c.panel; ctx.fillRect(f.left, f.top, f.w, f.h);
  f.clip();
  ctx.fillStyle = c.band; ctx.fillRect(f.left, f.Y(m + sd), f.w, f.Y(m - sd) - f.Y(m + sd));
  ctx.strokeStyle = c.ink3; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(f.left, f.Y(m)); ctx.lineTo(f.right, f.Y(m)); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = c.line; ctx.beginPath(); ctx.moveTo(f.left, f.Y(0) + 0.5); ctx.lineTo(f.right, f.Y(0) + 0.5); ctx.stroke();
  ctx.strokeStyle = c.lo; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < stripN; i++) {
    const k = (stripPos - stripN + i + STRIP_N) % STRIP_N, x = f.X(STRIP_N - stripN + i), y = f.Y(strip[k]);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
  f.axes({ colors: c, xlabel: 'sample', ylabel: 'X_θ', xTicks: false });
  ctx.save(); ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  let x = f.left + 8; const y = f.bottom - 10;
  ctx.fillStyle = c.band; ctx.fillRect(x, y - 5, 16, 10); x += 20; ctx.fillStyle = c.ink2; ctx.fillText('theory: ⟨X_θ⟩ ± ΔX_θ', x, y);
  ctx.restore();
}

let varianceFrame = null;
function drawVariance() {
  const { ctx, width, height } = fitCanvas($('#variance'));
  const c = colors;
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 44, right: 12, top: 30, bottom: 30 });
  const st = signalState(), sp = principalSpreads(st);
  const top = Math.max(4, Math.ceil(noiseDb(sp.max ** 2) + 2)), bottom = Math.min(-4, Math.floor(noiseDb(sp.min ** 2) - 2));
  f.x0 = 0; f.x1 = 360; f.y0 = Math.max(bottom, -22); f.y1 = Math.min(top, 22);
  varianceFrame = f;
  ctx.fillStyle = c.panel; ctx.fillRect(f.left, f.top, f.w, f.h);
  f.clip();
  // The vacuum's level.
  ctx.strokeStyle = c.ink3; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(f.left, f.Y(0) + 0.5); ctx.lineTo(f.right, f.Y(0) + 0.5); ctx.stroke(); ctx.setLineDash([]);
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = c.ink2; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText('the vacuum\'s noise, ¼ (shot noise)', f.left + 6, f.Y(0) - 2);
  // Theory.
  ctx.strokeStyle = c.ink; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i <= 180; i++) { const th = 2 * i, y = f.Y(noiseDb(quadratureVariance(st, th * DEG))); i ? ctx.lineTo(f.X(th), y) : ctx.moveTo(f.X(th), y); }
  ctx.stroke();
  // Measured.
  ctx.fillStyle = c.lo;
  for (let k = 0; k < record.bins; k++) {
    const s = record.stats(k);
    if (!s || s.variance <= 0) continue;
    ctx.beginPath(); ctx.arc(f.X((s.theta / DEG) % 360), f.Y(noiseDb(s.variance)), 2.5, 0, 2 * Math.PI); ctx.fill();
  }
  // The LO's phase now.
  const x = Math.round(f.X(state.theta)) + 0.5;
  ctx.strokeStyle = c.lo; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, f.top); ctx.lineTo(x, f.bottom); ctx.stroke();
  ctx.restore();
  f.axes({ colors: c, xlabel: 'the LO\'s phase θ (degrees)', ylabel: 'noise, dB re ¼' });
}

function varianceClick(e) {
  if (!varianceFrame) return;
  const r = $('#variance').getBoundingClientRect();
  const th = clamp(varianceFrame.invX(e.clientX - r.left), 0, 360);
  setTheta(th);
}

function setTheta(th, { fromSlider = false } = {}) {
  state.theta = ((th % 360) + 360) % 360;
  if (!fromSlider && thetaSlider) thetaSlider.value = state.theta;
  dirty(); scheduleHash();
}

// ---------------------------------------------------------------------- view 4: LIGO

const SENS_F0 = 5, SENS_F1 = 5000, SENS_N = 220;
const sensF = Array.from({ length: SENS_N }, (_, i) => SENS_F0 * (SENS_F1 / SENS_F0) ** (i / (SENS_N - 1)));

function ligoParams() { return { ...DEFAULTS, ...state.ligo }; }
function squeezeParams() { return { on: state.sq.on, dB: state.sq.dB, angle: state.sq.angle, eta: state.sq.eta, fd: state.sq.fd }; }
const Sn = (sq) => (f) => noiseBudget(f, ligoParams(), sq).total;

/** The chirp of the chosen source at the chosen distance, with its spectrum binned on the sensitivity plot's grid. */
function ensureChirp() {
  const src = SOURCES[state.source], key = state.source;
  if (chirp && chirp.key === key) return chirp;
  const mc = chirpMass(src.m1, src.m2), fisco = iscoFrequency(src.m1, src.m2);
  const sig = chirpSignal(mc, MPC, src.fmin, fisco, src.fs);       // at 1 Mpc: scaled by 1/d after
  const spec = amplitudeSpectrum(sig.h, sig.dt, fft);
  // Power in each log bin, Σ|h̃|² df, and the mean |h̃| for the plot.
  const edges = sensF.map((f, i) => (i ? Math.sqrt(sensF[i - 1] * f) : f * Math.sqrt(SENS_F0 / sensF[1])));
  edges.push(SENS_F1 * Math.sqrt(sensF[1] / SENS_F0));
  const power = new Float64Array(SENS_N), count = new Float64Array(SENS_N), mag = new Float64Array(SENS_N);
  let b = 0;
  for (let i = 1; i < spec.f.length; i++) {
    const f = spec.f[i];
    if (f < src.fmin || f > fisco) continue;
    while (b < SENS_N && f >= edges[b + 1]) b++;
    if (b >= SENS_N) break;
    if (f < edges[b]) continue;
    power[b] += spec.mag[i] ** 2 * spec.df; count[b]++; mag[b] += spec.mag[i];
  }
  for (let i = 0; i < SENS_N; i++) if (count[i]) mag[i] /= count[i];
  let hmax = 0;
  for (let i = 0; i < sig.n; i++) hmax = Math.max(hmax, Math.abs(sig.h[i]));
  chirp = { key, mc, fisco, sig, power, mag, count, hmax, src };
  return chirp;
}

/** The matched-filter SNR at the chosen distance against the noise with and without squeezing. */
function snr() {
  const ch = ensureChirp(), d = state.distance;
  const calc = (sq) => {
    const S = Sn(sq);
    let s = 0;
    for (let i = 0; i < SENS_N; i++) if (ch.count[i]) s += ch.power[i] / S(sensF[i]);
    return Math.sqrt(4 * s) / d;
  };
  const without = calc({ ...squeezeParams(), on: false }), withSq = calc(squeezeParams());
  return { without, with: withSq, ratio: withSq / without, rangeWithout: (d * without) / 8, rangeWith: (d * withSq) / 8 };
}

function drawLigoSketch() {
  const { ctx, width, height } = fitCanvas($('#ligo'));
  const sq = state.sq, inject = sq.on ? gaussianState({ r: rFromDb(sq.dB), psi: sq.angle * DEG, eta: sq.eta }) : gaussianState({});
  drawLigo(ctx, width, height, { P: state.ligo.P, sq, inject }, colors);
}

/** Log axes for the sensitivity plot. */
function logAxes(ctx, f, c, { xlabel, ylabel }) {
  ctx.save();
  ctx.font = '11px system-ui, sans-serif'; ctx.lineWidth = 1; ctx.strokeStyle = c.line;
  ctx.strokeRect(f.left + 0.5, f.top + 0.5, f.w - 1, f.h - 1);
  ctx.fillStyle = c.ink2; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let e = Math.ceil(f.x0); e <= f.x1; e++) {
    for (let m = 1; m < 10; m++) {
      const v = e + Math.log10(m);
      if (v < f.x0 - 1e-9 || v > f.x1 + 1e-9) continue;
      const px = Math.round(f.X(v)) + 0.5;
      ctx.strokeStyle = c.line; ctx.globalAlpha = m === 1 ? 0.9 : 0.35; ctx.beginPath(); ctx.moveTo(px, f.top); ctx.lineTo(px, f.bottom); ctx.stroke(); ctx.globalAlpha = 1;
      if (m === 1 || m === 2 || m === 5) ctx.fillText(tickLabel(10 ** v), px, f.bottom + 5);
    }
  }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let e = Math.ceil(f.y0); e <= f.y1; e++) {
    const py = Math.round(f.Y(e)) + 0.5;
    ctx.strokeStyle = c.line; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.moveTo(f.left, py); ctx.lineTo(f.right, py); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillText(`10${sup(e)}`, f.left - 5, py);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(xlabel, f.left + f.w / 2, f.bottom + 18);
  ctx.save(); ctx.translate(12, f.top + f.h / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'middle'; ctx.fillText(ylabel, 0, 0); ctx.restore();
  ctx.restore();
}
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sup = (n) => String(n).split('').map((ch) => SUP[ch] || ch).join('');

function drawSens() {
  const { ctx, width, height } = fitCanvas($('#sens'));
  const c = colors;
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 50, right: 14, top: 28, bottom: 34 });
  f.x0 = Math.log10(SENS_F0); f.x1 = Math.log10(SENS_F1); f.y0 = -24.5; f.y1 = -20;
  ctx.fillStyle = c.panel; ctx.fillRect(f.left, f.top, f.w, f.h);
  f.clip();
  const p = ligoParams(), sq = squeezeParams(), vac = { ...sq, on: false };
  const curves = { seismic: [], thermal: [], shot: [], rp: [], quantum: [], total: [], sql: [], qvac: [], tvac: [] };
  for (const fq of sensF) {
    const b = noiseBudget(fq, p, sq), v = sq.on ? noiseBudget(fq, p, vac) : b;
    curves.seismic.push(b.seismic); curves.thermal.push(b.thermal); curves.shot.push(b.shot); curves.rp.push(b.rp);
    curves.quantum.push(b.quantum); curves.total.push(b.total); curves.sql.push(b.sql); curves.qvac.push(v.quantum); curves.tvac.push(v.total);
  }
  const line = (ys, color, w, dash = [], alpha = 1) => {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash); ctx.globalAlpha = alpha;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < SENS_N; i++) {
      const y = ys[i] > 0 ? 0.5 * Math.log10(ys[i]) : NaN;
      if (!Number.isFinite(y)) { pen = false; continue; }
      const px = f.X(Math.log10(sensF[i])), py = clamp(f.Y(y), f.top - 30, f.bottom + 30);
      if (pen) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      pen = true;
    }
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  };
  // The chirp, as 2|h̃|√f: its height over the noise, summed over octaves, is the SNR.
  const ch = ensureChirp();
  ctx.fillStyle = c.chirp; ctx.globalAlpha = 0.22;
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i < SENS_N; i++) {
    if (!ch.count[i]) { continue; }
    const y = 0.5 * Math.log10((2 * ch.mag[i] * Math.sqrt(sensF[i]) / state.distance) ** 2), px = f.X(Math.log10(sensF[i])), py = clamp(f.Y(y), f.top, f.bottom);
    if (pen) ctx.lineTo(px, py); else { ctx.moveTo(px, f.bottom); ctx.lineTo(px, py); }
    pen = true;
  }
  if (pen) { ctx.lineTo(f.X(Math.log10(ch.fisco)), f.bottom); ctx.closePath(); ctx.fill(); }
  ctx.globalAlpha = 1;
  line(curves.seismic, c.seismic, 1.2);
  line(curves.thermal, c.thermal, 1.2);
  line(curves.sql, c.ink, 1.2, [2, 3]);
  if (sq.on) { line(curves.qvac, c.shot, 1.2, [], 0.35); line(curves.tvac, c.ink, 2.2, [], 0.25); }
  line(curves.shot, c.shot, 1.2, [6, 3]);
  line(curves.rp, c.rp, 1.2, [6, 3]);
  line(curves.quantum, sq.on ? c.sq : c.shot, 2);
  line(curves.total, c.ink, 2.6);
  ctx.restore();
  logAxes(ctx, f, c, { xlabel: 'frequency (Hz)', ylabel: '√Sₕ  (1/√Hz)' });
  // A legend inside the frame.
  ctx.save(); ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const items = [
    ['total', c.ink, 2.6, []], [sq.on ? 'quantum, squeezed' : 'quantum noise', sq.on ? c.sq : c.shot, 2, []], ['shot noise', c.shot, 1.2, [6, 3]], ['radiation pressure', c.rp, 1.2, [6, 3]],
    ['standard quantum limit', c.ink, 1.2, [2, 3]], ['thermal', c.thermal, 1.2, []], ['seismic', c.seismic, 1.2, []],
    ...(sq.on ? [['without squeezing', c.ink, 2.2, [], 0.3]] : []), ['the chirp, 2|h̃|√f', c.chirp, 6, [], 0.3],
  ];
  const rows = f.w < 560 ? 5 : 3, cols = Math.ceil(items.length / rows);
  const colW = Math.max(...items.map((it) => ctx.measureText(it[0]).width)) + 34;
  let x = f.right - cols * colW + 6, y = f.top + 12;
  items.forEach(([label, color, w, dash, alpha = 1], i) => {
    if (i && i % rows === 0) { x += colW; y = f.top + 12; }
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash); ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 18, y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.fillStyle = c.ink2; ctx.fillText(label, x + 24, y);
    y += 14;
  });
  ctx.restore();
}

function drawChirp() {
  const { ctx, width, height } = fitCanvas($('#chirp'));
  const c = colors, ch = ensureChirp(), s = ch.sig, d = state.distance;
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 50, right: 14, top: 10, bottom: 30 });
  const hm = ch.hmax / d;
  f.x0 = 0; f.x1 = s.tc; f.y0 = -1.1 * hm; f.y1 = 1.1 * hm;
  ctx.fillStyle = c.panel; ctx.fillRect(f.left, f.top, f.w, f.h);
  f.clip();
  ctx.strokeStyle = c.line; ctx.beginPath(); ctx.moveTo(f.left, f.Y(0) + 0.5); ctx.lineTo(f.right, f.Y(0) + 0.5); ctx.stroke();
  // Thousands of cycles: drawn as a digital phosphor scope draws them (lib/scope.js).
  scopeTrace(ctx, f, { n: s.n, y: (i) => f.Y(s.h[i] / d), x0: f.X(0), x1: f.X((s.n - 1) * s.dt), color: c.chirp, bandlimited: true, key: `chirp ${state.source} ${d} ${s.n}` });
  ctx.restore();
  const scale = 10 ** Math.floor(Math.log10(hm));
  f.y0 /= scale; f.y1 /= scale;
  f.axes({ colors: c, xlabel: 'time (s)', ylabel: `h(t), ×10${sup(Math.round(Math.log10(scale)))}` });
  ctx.save(); ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = c.ink2; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  fillSlots(ctx, [`${ch.src.label.toLowerCase()} at `, { v: d, dec: 0, w: 4 }, ' Mpc: from ', { v: ch.src.fmin, dec: 0, w: 3 }, ' Hz to the innermost stable orbit at ', { v: ch.fisco, dec: 0, w: 4 }, ' Hz in ', { v: s.tc, dec: 2, w: 5 }, ' s'], f.right - 4, f.top + 4);
  ctx.restore();
}

// The detector's output: 8 s of noise drawn from the total noise curve with the chirp in it,
// whitened or raw, and the matched filter's output.  The noise is made once per seed and
// spectrum (a squeezing slider's change, not a frame); the distance only rescales the chirp.
const detector = new Detector({ fs: DET_FS, T: DET_T });
const detectorVac = new Detector({ fs: DET_FS, T: DET_T });     // the same noise without squeezing, for the ghost
let detectorSource = null;

function ensureDetector() {
  if (detectorSource !== state.source) {
    const src = SOURCES[state.source], mc = chirpMass(src.m1, src.m2), fisco = iscoFrequency(src.m1, src.m2);
    const h1 = chirpSignal(mc, MPC, src.fmin, fisco, DET_FS).h;   // at 1 Mpc
    for (const det of [detector, detectorVac]) det.setSignal(h1, DET_MERGE, [src.fmin, fisco]);
    detectorSource = state.source;
  }
  const p = ligoParams(), sq = squeezeParams(), vac = { ...sq, on: false };
  const spectrum = (det, s) => { det.setSeed(state.seed); det.setSpectrum((f) => noiseBudget(f, p, s).total, JSON.stringify([p, s.on ? s : 0])); };
  spectrum(detector, sq);
  if (sq.on) spectrum(detectorVac, vac);
  return detector;
}

/** The numbers the detector strip shows, at the chosen distance (also for the tests). */
function detectorFindings() {
  const det = ensureDetector(), g = 1 / state.distance, F = det.findings(state.distance);
  const lagIndex = clamp(Math.round(state.lag * DET_FS), 0, det.N - 1);
  let whitePeak = 0, rawPeak = 0, rawVar = 0;
  for (let j = 0; j < det.N; j++) { whitePeak = Math.max(whitePeak, Math.abs(g * det.whiteSignal1[j])); rawPeak = Math.max(rawPeak, Math.abs(g * det.signal1[j])); rawVar += det.rawNoise[j] ** 2; }
  const out = { ...F, zAtLag: det.mfNoise[lagIndex] + g * det.mfSignal1[lagIndex], lag: state.lag, whitePeak, rawPeak, rawRms: Math.sqrt(rawVar / det.N), sigma1: det.sigma1 };
  if (state.sq.on) { const v = detectorVac.findings(state.distance); out.without = { rho: v.rho, atMerger: v.atMerger, noisePeak: v.noisePeak }; }
  else out.without = null;
  return out;
}

/** value(j) for j < jEnd, sample j at time j/DET_FS, as a dense trace (lib/scope.js) in the given colour. */
function columnTrace(ctx, f, N, value, jEnd = N, color, width = 1, alpha = 1, floor) {
  const n = Math.min(N, jEnd);
  if (n < 2) return;
  scopeTrace(ctx, f, { n, y: (j) => f.Y(value(j)), x0: f.X(0), x1: f.X(((n - 1) * DET_T) / N), color, width, alpha, floor });
}

let detectorFrame = null;
function drawDetector() {
  const det = ensureDetector(), d = state.distance, g = 1 / d, c = colors, N = det.N, F = detectorFindings();
  const { ctx, width, height } = fitCanvas($('#detector'));
  ctx.clearRect(0, 0, width, height);
  const narrow = width < 600, top = narrow ? 44 : 28, bottom = 32, gap = 10, h1 = Math.max(40, 0.45 * (height - top - bottom - gap));
  const f1 = new Frame(ctx, width, height, { left: 50, right: 14, top, bottom: height - top - h1 });
  const f2 = new Frame(ctx, width, height, { left: 50, right: 14, top: top + h1 + gap, bottom });
  detectorFrame = f2;
  f1.x0 = f2.x0 = 0; f1.x1 = f2.x1 = DET_T;
  const raw = state.data === 'raw', noise = raw ? det.rawNoise : det.whiteNoise, sig = raw ? det.signal1 : det.whiteSignal1;
  const lagShift = Math.round((state.lag - DET_MERGE) * DET_FS), lagIndex = clamp(Math.round(state.lag * DET_FS), 0, N - 1);
  const seconds = (f) => { ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.setLineDash([2, 4]); ctx.beginPath(); for (let t = 1; t < DET_T; t++) { const x = Math.round(f.X(t)) + 0.5; ctx.moveTo(x, f.top); ctx.lineTo(x, f.bottom); } ctx.stroke(); ctx.setLineDash([]); };

  // The data: noise + chirp, and the template at its lag over it.
  let ymax = 0;
  for (let j = 0; j < N; j++) ymax = Math.max(ymax, Math.abs(noise[j] + g * sig[j]));
  ymax = raw ? 1.08 * ymax : Math.max(5, 1.08 * ymax);      // whitened: σ = 1
  f1.y0 = -ymax; f1.y1 = ymax;
  ctx.fillStyle = c.panel; ctx.fillRect(f1.left, f1.top, f1.w, f1.h);
  f1.clip();
  seconds(f1);
  columnTrace(ctx, f1, N, (j) => noise[j] + g * sig[j], N, c.seismic);
  if (state.template) columnTrace(ctx, f1, N, (j) => { const i = j - lagShift; return i >= 0 && i < N ? g * sig[i] : 0; }, N, c.chirp, 1, 0.9);
  ctx.restore();
  let scale = 1;
  if (raw) { scale = 10 ** Math.floor(Math.log10(F.rawRms)); f1.y0 /= scale; f1.y1 /= scale; }
  f1.axes({ colors: c, xTicks: false, ylabel: raw ? `h, ×10${sup(Math.round(Math.log10(scale)))}` : 'whitened (σ)' });
  // A legend.
  ctx.save(); ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const lined = Math.abs(state.lag - DET_MERGE) < 1e-6;
  const lg = [[narrow ? 'data' : 'data: noise + chirp', c.seismic], ...(state.template ? [[narrow ? (lined ? 'the template, lined up' : 'the template') : lined ? 'the template, lined up with the chirp' : 'the template, slid along', c.chirp]] : [])];
  let lx = f1.left + 6; const ly = f1.bottom - 10;
  for (const [label, color] of lg) {
    const w = ctx.measureText(label).width + 30;
    ctx.globalAlpha = 0.85; ctx.fillStyle = c.panel; ctx.fillRect(lx - 3, ly - 8, w, 16); ctx.globalAlpha = 1;
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 16, ly); ctx.stroke();
    ctx.fillStyle = c.ink2; ctx.fillText(label, lx + 22, ly); lx += w + 6;
  }
  ctx.restore();

  // The matched filter's output, z(t): the template's merger put at t.
  const zEnd = anim.sliding ? lagIndex + 1 : N;
  let zmax = Math.max(10, F.rho + 4);
  for (let j = 0; j < N; j++) zmax = Math.max(zmax, Math.abs(det.mfNoise[j] + g * det.mfSignal1[j]));
  zmax *= 1.25;
  f2.y0 = -zmax; f2.y1 = zmax;
  ctx.fillStyle = c.panel; ctx.fillRect(f2.left, f2.top, f2.w, f2.h);
  f2.clip();
  seconds(f2);
  // The unit noise, ρ expected and the threshold 8.
  ctx.fillStyle = c.band; ctx.fillRect(f2.left, f2.Y(1), f2.w, f2.Y(-1) - f2.Y(1));
  const hline = (y, dash, color, w = 1) => { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(f2.left, Math.round(f2.Y(y)) + 0.5); ctx.lineTo(f2.right, Math.round(f2.Y(y)) + 0.5); ctx.stroke(); ctx.setLineDash([]); };
  hline(8, [2, 3], c.warn);
  hline(F.rho, [6, 4], c.ink3);
  if (F.without) hline(F.without.rho, [6, 4], c.ink3);
  // The template's place, under the output.
  const lx2 = Math.round(f2.X(state.lag)) + 0.5;
  ctx.strokeStyle = c.chirp; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(lx2, f2.top); ctx.lineTo(lx2, f2.bottom); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  columnTrace(ctx, f2, N, (j) => det.mfNoise[j] + g * det.mfSignal1[j], zEnd, state.sq.on ? c.sq : c.ink, 1.5, 1, 0.8);   // the peak is the point
  // Without squeezing (the same noise): where the peak would be.
  if (F.without && !anim.sliding) { ctx.fillStyle = c.ink3; ctx.beginPath(); ctx.arc(f2.X(F.tMerge), f2.Y(F.without.atMerger), 3.5, 0, 2 * Math.PI); ctx.fill(); }
  ctx.fillStyle = c.chirp; ctx.beginPath(); ctx.arc(lx2, f2.Y(F.zAtLag), 3.5, 0, 2 * Math.PI); ctx.fill();
  ctx.restore();
  // The cursor through the data too.
  ctx.save(); ctx.beginPath(); ctx.rect(f1.left, f1.top, f1.w, f1.h); ctx.clip();
  ctx.strokeStyle = c.chirp; ctx.globalAlpha = 0.6; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(lx2, f1.top); ctx.lineTo(lx2, f1.bottom); ctx.stroke();
  ctx.restore();
  f2.axes({ colors: c, xlabel: 'time (s): where the template\'s merger is put', ylabel: 'filter output z' });
  // Labels on the lines.
  ctx.save(); ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
  const tag = (y, text, color) => { const py = f2.Y(y) - 2; if (py < f2.top + 12 || py > f2.bottom - 2) return; const w = ctx.measureText(text).width; ctx.globalAlpha = 0.85; ctx.fillStyle = c.panel; ctx.fillRect(f2.left + 4, py - 12, w + 6, 13); ctx.globalAlpha = 1; ctx.fillStyle = color; ctx.fillText(text, f2.left + 7, py); };
  tag(8, '8: the threshold', c.warn);
  if (F.rho > 11) tag(F.rho, state.sq.on ? 'ρ with squeezing: the expected peak' : 'ρ: the expected peak', c.ink2);
  if (F.without && F.without.rho > 11 && f2.Y(F.without.rho) - f2.Y(F.rho) > 15) tag(F.without.rho, 'ρ without squeezing (the grey dot)', c.ink2);
  ctx.restore();
  detectorReadout(F, raw, scale);
}

/** The detector strip's numbers, under it: words and numbers in fixed slots. */
function detectorReadout(F, raw, scale) {
  const e = Math.round(Math.log10(scale));
  const groups = [
    ['The data', ...(raw
      ? ['raw strain above 10 Hz: the noise\'s spread ', bold(num(F.rawRms / scale, 2, 4)), `, the chirp at most `, bold(num(F.rawPeak / scale, 2, 4)), ` × 10${sup(e)}`]
      : ['whitened, so the noise\'s spread is σ = 1; the chirp in it is at most ', bold(num(F.whitePeak, 2, 5)), ' σ high'])],
    ['The filter', 'with the template\'s merger at ', num(state.lag, 2, 4), ' s, z = ', bold(num(F.zAtLag, 1, 6)), '; lined up (', num(F.tMerge, 2, 4), ' s), z = ', bold(num(F.atMerger, 1, 6)), ' against the expected ρ = ', bold(num(F.rho, 1, 6)), ' ± 1; elsewhere the noise reaches ', bold(num(F.noisePeak, 1, 4))],
  ];
  if (F.without) groups.push(['Without squeezing', 'the same noise: lined up, z = ', num(F.without.atMerger, 1, 6), ' against ρ = ', num(F.without.rho, 1, 6), '; elsewhere the noise reaches ', num(F.without.noisePeak, 1, 4)]);
  setGroupsKeyed($('#det-readout'), groups);
}

function detectorPointer(e) {
  if (!detectorFrame) return;
  const r = $('#detector').getBoundingClientRect();
  anim.sliding = false;
  state.lag = clamp(detectorFrame.invX(e.clientX - r.left), 0, DET_T);
  dirty();
}

function startSlide() {
  if (state.view !== 'ligo') return;
  state.lag = 0; anim.sliding = true; lastT = 0;
  dirty();
}

// ---------------------------------------------------------------------- readouts

const num = (v, dec, w, extra = {}) => ({ v, dec, w, ...extra });
const bold = (p) => ({ ...p, class: 'b' });
function readout() {
  const box = $('#readout');
  if (state.view === 'ligo') return readoutLigo(box);
  if (state.view === 'homodyne') return readoutHomodyne(box);
  const b = baseState(), sp = principalSpreads(b), a = Math.hypot(b.x1, b.x2), nbar = meanPhotons(b), { moments } = photons();
  const dphi = a > 1e-9 ? Math.sqrt(quadratureVariance(b, Math.atan2(b.x2, b.x1) + Math.PI / 2)) / a : NaN;
  const groups = [
    ['Mean field', '|α| = ', bold(num(a, 2, 5)), ' at ', num(state.kind === 'vacuum' ? 0 : state.phase, 0, 4), '°: ⟨n⟩ = ', bold(num(nbar, 2, 6)), ' photons, Δn = ', num(moments.sd, 2, 5)],
    ['Noise', 'narrowest ΔX = ', bold(num(sp.min, 3, 5)), ' (along ', num(sp.angle / DEG, 0, 4), '°), widest ', bold(num(sp.max, 3, 5)), ', product ', num(sp.min * sp.max, 3, 5), ' (the limit is ¼)'],
  ];
  if (a > 1e-9) groups.push(['Phase noise', 'Δφ ≈ ΔX/|α| = ', bold(num(dphi, 3, 5)), ' rad = ', num(dphi / DEG, 1, 5), '°', state.r > 0 ? '' : ' (= 1/(2|α|), the standard quantum limit)']);
  else groups.push(['Phase noise', 'no mean field, so no phase to be uncertain about']);
  if (state.view === 'squeeze' || state.r > 0) {
    groups.push(['Squeezing', 'r = ', bold(num(state.r, 2, 4)), ' = ', num(squeezeDb(state.r), 1, 4), ' dB; through loss η = ', num(state.eta, 2, 4), ' the squeezed quadrature reads ', bold(num(lossyVariance(state.r, state.eta), 3, 5)), ' of the vacuum\'s variance: ', num(-10 * Math.log10(lossyVariance(state.r, state.eta)), 1, 4), ' dB of squeezing']);
  }
  setGroupsKeyed(box, groups);
}

/** Lines of the readout: each a word for the thing, then its parts. */
function setGroupsKeyed(box, groups) {
  const key = groups.map((g) => g[0]).join('|');
  if (box._key !== key) {
    box._key = key;
    box.replaceChildren(...groups.map((g) => el('div', {}, el('span', { class: 'k' }, g[0] + ': '), el('span', { class: 'vals' }))));
  }
  groups.forEach((g, i) => setSlots(box.children[i].lastChild, g.slice(1)));
}

function readoutHomodyne(box) {
  const st = signalState(), th = state.theta * DEG, m = quadratureMean(st, th), v = quadratureVariance(st, th);
  const s = record.stats(record.bin(th));
  const groups = [
    ['Reading', 'the LO at θ = ', bold(num(state.theta, 0, 4)), '° reads X_θ: mean ', bold(num(m, 3, 6)), ', noise ΔX_θ = ', bold(num(Math.sqrt(v), 3, 5)), ' = ', num(noiseDb(v), 1, 5), ' dB re the vacuum'],
    ['Measured', s ? 'at this θ, ' : 'no samples at this θ yet', ...(s ? [num(s.n, 0, 7), ' samples: mean ', num(s.mean, 3, 6), ', variance ', num(s.variance, 4, 6), ' = ', num(noiseDb(s.variance), 1, 5), ' dB; ', num(record.count, 0, 8), ' in the record'] : [])],
  ];
  if (state.shift) {
    const pm = phaseMeasurement(st, baseState(), th);
    groups.push(['Phase shift', 'φ = ', bold(num(state.shift, 3, 5)), ' rad moves the mean by |α| sin φ = ', bold(num(pm.shift, 3, 6)), ' against noise ', num(pm.noise, 3, 5), ': signal-to-noise ', bold(num(pm.snr, 2, 5)), ' per sample; smallest shift at ratio 1: Δφ = ', bold(num(pm.minimum, 3, 5)), ' rad', state.r > 0 ? '' : ' = 1/(2|α|), the standard quantum limit']);
  }
  setGroupsKeyed(box, groups);
}

function readoutLigo(box) {
  const p = ligoParams(), sq = squeezeParams(), vac = { ...sq, on: false };
  const b100 = noiseBudget(100, p, vac), s100 = noiseBudget(100, p, sq), v1k = noiseBudget(1000, p, vac), s1k = noiseBudget(1000, p, sq), v10 = noiseBudget(10, p, vac), s10 = noiseBudget(10, p, sq);
  const e24 = (x) => Math.sqrt(x) / 1e-24;
  const fs = sqlFrequency(p), r = snr(), ch = ensureChirp();
  const groups = [
    ['At 100 Hz', 'shot noise ', num(e24(b100.shot), 2, 5), ', radiation pressure ', num(e24(b100.rp), 2, 5), ', thermal ', num(e24(b100.thermal), 2, 5), ', total ', bold(num(e24(b100.total), 2, 5)), ' × 10⁻²⁴ /√Hz without squeezing; the standard quantum limit is touched at ', num(fs, 0, 4), ' Hz'],
  ];
  if (sq.on) groups.push(['With squeezing', 'total ', bold(num(e24(s100.total), 2, 5)), ' × 10⁻²⁴ /√Hz at 100 Hz; shot noise at 1 kHz down by ', bold(num(-10 * Math.log10(s1k.shot / v1k.shot), 1, 5)), ' dB; radiation pressure at 10 Hz changed by ', num(10 * Math.log10(s10.rp / v10.rp), 1, 5, { plus: '+' }), ' dB']);
  groups.push(['Signal-to-noise ratio', 'ρ = ', bold(num(r.without, 1, 6)), ' without squeezing', ...(sq.on ? [', ', bold(num(r.with, 1, 6)), ' with: ', bold(num(r.ratio, 2, 5)), ' times as far, a volume ', bold(num(r.ratio ** 3, 2, 5)), ' times as big; '] : ['; ']),
    'reach (ρ = 8): ', bold(num(r.rangeWithout, 0, 5)), ' Mpc', ...(sq.on ? [' without, ', bold(num(r.rangeWith, 0, 5)), ' Mpc with'] : [])]);
  groups.push(['Scale', 'a strain of 10⁻²¹ changes the arms\' difference by ', num(1e-21 * p.L / 1e-18, 1, 4), ' × 10⁻¹⁸ m and the dark port\'s phase by ', num(darkPortPhase(1e-21, p) / 1e-11, 1, 4), ' × 10⁻¹¹ rad']);
  setGroupsKeyed(box, groups);
}

function updateLegend() {
  const lg = $('#legend');
  lg.hidden = state.view === 'ligo';
  if (lg.hidden) return;
  if (!lg._made) {
    lg._made = true;
    lg.replaceChildren(
      el('span', { class: 'cbar' }, 'W(X₁, X₂): 0 ', el('canvas', { id: 'colorbar', 'aria-hidden': 'true' }), ' +2/π (red where positive; a Gaussian state is never negative, so no blue)'),
      el('span', {}, el('span', { class: 'sw', style: { background: 'var(--ink)' } }), 'the mean field α, on its stick'),
      el('span', { id: 'lg-point' }, el('span', { class: 'sw', style: { background: 'var(--accent)' } }), 'one point of the cloud, and its shadow on X₁'),
      el('span', { id: 'lg-axis' }, el('span', { class: 'sw', style: { background: 'var(--lo)' } }), 'the LO\'s axis X_θ with the histogram of the samples'),
    );
  }
  $('#lg-point').hidden = state.view === 'homodyne';
  $('#lg-axis').hidden = state.view !== 'homodyne';
  drawColorbar($('#colorbar'));
}

// ---------------------------------------------------------------------- the loop

let raf = 0, lastT = 0, needDraw = true, testHold = false;
function dirty() { needDraw = true; kick(); }
function kick() { if (!raf) raf = requestAnimationFrame(loop); }

/** Move the clocks on by dt seconds of the page's time. */
function advance(dt) {
  if (state.view === 'ligo') {
    // The template slides along the data (its own clock: the Animation panel is not in this view).
    if (anim.sliding) {
      state.lag += dt * SLIDE_RATE;
      if (state.lag >= DET_T) { state.lag = DET_MERGE; anim.sliding = false; slideButton.textContent = 'Slide the template'; }
    }
    return;
  }
  if (!state.running) return;
  if (state.view === 'mode' || state.view === 'squeeze') {
    anim.t += dt / state.period;
    recordField();
  } else if (state.view === 'homodyne') {
    motorStep(dt);
    takeSamples(dt);
  }
}

function loop(now) {
  raf = 0;
  const dtReal = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0;
  lastT = now;
  const animating = !document.hidden && (state.view === 'ligo' ? anim.sliding : state.running);
  if (animating && !testHold) advance(dtReal);
  if (needDraw || animating) { needDraw = false; drawNow(); }
  if (animating) raf = requestAnimationFrame(loop); else lastT = 0;
}

function drawNow() {
  readColors();
  if (state.view === 'mode' || state.view === 'squeeze') {
    if (state.view === 'squeeze') drawSqueezerView();
    drawPlaneView(); drawTrace(); drawPhotons();
  } else if (state.view === 'homodyne') {
    drawApparatus(); drawHomodynePlane(); drawStrip(); drawVariance();
  } else {
    drawLigoSketch(); drawSens(); drawChirp(); drawDetector();
  }
  updateLegend();
  readout();
}

// ---------------------------------------------------------------------- controls

const viewSeg = segmented([
  { value: 'mode', label: '1 · One mode', title: 'The vacuum and a laser\'s coherent state as clouds in the quadrature plane' },
  { value: 'squeeze', label: '2 · Squeezing', title: 'The crystal that squeezes the cloud into an ellipse, and what loss does' },
  { value: 'homodyne', label: '3 · Homodyne', title: 'Reading one quadrature with a local oscillator; measuring a phase' },
  { value: 'ligo', label: '4 · LIGO', title: 'The detector\'s noise curve with a squeezed vacuum at its dark port, and a chirp\'s signal-to-noise ratio' },
], state.view, (v) => setView(v), { label: 'View' });
$('#view-row').append(viewSeg);

function setView(v) {
  state.view = v; viewSeg.value = v;
  $('#main').dataset.view = v;
  // The plane sits beside the field in views 1–2 and beside the apparatus in view 3.
  const wrap = $('#plane-wrap');
  if (v === 'homodyne') { if (wrap.parentNode !== $('#hom-pair')) $('#plane-slot').replaceWith(wrap); }
  else if (wrap.parentNode !== $('#top-pair')) { const slot = el('div', { id: 'plane-slot' }); wrap.replaceWith(slot); $('#top-pair').prepend(wrap); }
  $('#plane-cap').innerHTML = v === 'homodyne' ? '<b>The quadrature plane</b> in the LO\'s frame' : '<b>The quadrature plane</b>, turning at ω (slowed)';
  $('#state-panel').hidden = v === 'ligo';
  $('#state-label').textContent = v === 'squeeze' ? 'What goes into the crystal' : v === 'homodyne' ? 'The signal' : 'The state of the mode';
  $('#squeeze-panel').hidden = v !== 'squeeze' && v !== 'homodyne';
  $('#lo-panel').hidden = v !== 'homodyne';
  $('#ligo-panel').hidden = v !== 'ligo';
  $('#chirp-panel').hidden = v !== 'ligo';
  // The clock's button: in the homodyne view, beside the motor and the record it runs (that
  // view's controls are long, and the Animation panel would fall below the fold); else in
  // the Animation panel.
  const clockHome = v === 'homodyne' ? $('#clock-row') : $('#anim-row');
  if ($('#run').parentNode !== clockHome) { clockHome.prepend($('#run')); clockHome.append($('#show-row')); }
  $('#anim-panel').hidden = v === 'ligo' || v === 'homodyne';
  if (v !== 'ligo' && anim.sliding) { anim.sliding = false; state.lag = DET_MERGE; slideButton.textContent = 'Slide the template'; }
  periodSlider.hidden = v === 'homodyne';
  wedgeToggle.hidden = v === 'homodyne';
  $('#run').textContent = state.running ? 'Pause' : 'Run';
  if (v === 'homodyne') { $('#kind-note').textContent = 'What is measured: the vacuum, a laser\'s coherent state, or either one squeezed (the panel below).'; }
  else if (v === 'squeeze') { $('#kind-note').textContent = 'The crystal squeezes whatever comes in: the vacuum, or a laser\'s field (which it also keeps).'; }
  else $('#kind-note').textContent = 'A laser makes a coherent state: the vacuum\'s round cloud displaced to the mean field α.';
  lastT = 0;
  dirty(); scheduleHash();
}

const kindSeg = segmented([
  { value: 'vacuum', label: 'Vacuum', title: 'No light: the mean field is zero, the noise is not' },
  { value: 'laser', label: 'Laser (coherent state)', title: 'The vacuum\'s cloud displaced to the mean field α' },
], state.kind, (v) => { state.kind = v; alphaSlider.hidden = phaseSlider.hidden = v === 'vacuum'; changed(); }, { label: 'The state' });
$('#kind-row').append(kindSeg);
const alphaSlider = slider({ label: 'mean field |α|', min: 0, max: 4, step: 0.01, value: state.alpha, title: 'The amplitude of the classical field; |α|² is the mean photon number', onInput: (v) => { state.alpha = v; changed(); } });
const phaseSlider = slider({ label: 'its phase (°)', min: -180, max: 180, step: 1, value: state.phase, title: 'The phase of α: where in the plane the cloud sits (or drag the dot)', onInput: (v) => { state.phase = v; changed(); } });
$('#state-box').append(alphaSlider, phaseSlider);

// Squeezing.
const sqPresets = segmented([
  { value: 'amp', label: 'Along the field', title: 'Amplitude-squeezed: the ellipse thin along α, so the wave\'s crests are quiet' },
  { value: 'phase', label: 'Across it', title: 'Phase-squeezed: the ellipse thin across α, so the wave\'s phase is sharp' },
  { value: 'off', label: 'None', title: 'No squeezing: the round cloud' },
], 'off', (v) => {
  if (v === 'off') state.r = 0;
  else { if (state.r === 0) state.r = SQ6; state.psi = ((state.kind === 'vacuum' ? 0 : state.phase) + (v === 'phase' ? 90 : 0) + 360) % 180; }
  rSlider.value = state.r; psiSlider.value = state.psi; changed();
}, { label: 'Squeeze' });
$('#sq-presets').append(sqPresets);
const rSlider = slider({ label: 'squeezing r', min: 0, max: 1.5, step: 0.01, value: state.r, title: 'The squeezing parameter: ΔX = e^−r/2 along the squeezed direction', onInput: (v) => { state.r = v; changed(); } });
const psiSlider = slider({ label: 'angle ψ (°)', min: 0, max: 180, step: 1, value: state.psi, title: 'The direction of the ellipse\'s thin side, from the X₁ axis', onInput: (v) => { state.psi = v; changed(); } });
const lossSlider = slider({ label: 'loss (%)', min: 0, max: 90, step: 1, value: 0, title: 'The fraction of the light lost after the crystal; the vacuum takes its place (η = 1 − loss)', onInput: (v) => { state.eta = 1 - v / 100; changed(); } });
$('#sq-box').append(rSlider, psiSlider, lossSlider);

function syncSqPresets() {
  const rel = ((state.psi - (state.kind === 'vacuum' ? 0 : state.phase)) % 180 + 180) % 180;
  sqPresets.value = state.r === 0 ? 'off' : Math.abs(rel) < 1 || Math.abs(rel - 180) < 1 ? 'amp' : Math.abs(rel - 90) < 1 ? 'phase' : 'custom';
  setSlots($('#sq-note'), state.r > 0 ? ['r = ', { v: state.r, dec: 2, w: 4 }, ' is ', { v: squeezeDb(state.r), dec: 1, w: 4 }, ' dB of squeezing: ΔX = e⁻ʳ/2 = ', { v: Math.exp(-state.r) / 2, dec: 3, w: 5 }, ' along ψ, e^r/2 = ', { v: Math.exp(state.r) / 2, dec: 3, w: 5 }, ' across'] : ['r = 0: no squeezing, the cloud is round']);
}

// The local oscillator.
let thetaSlider = null;
thetaSlider = slider({ label: 'LO phase θ (°)', min: 0, max: 360, step: 1, value: state.theta, title: 'The local oscillator\'s phase: which quadrature X_θ is read (or drag the yellow axis)', onInput: (v) => { stopMotor(); setTheta(v, { fromSlider: true }); } });
const rateSlider = slider({ label: 'motor (°/s)', min: 5, max: 180, step: 1, value: state.rate, title: 'How fast the motor turns the local oscillator\'s phase', onInput: (v) => { state.rate = v; scheduleHash(); } });
const shiftSlider = slider({ label: 'phase shift φ (rad)', min: 0, max: 0.5, step: 0.005, value: state.shift, title: 'A small phase shift on the signal, as an interferometer\'s arm would give: the cloud turns about the origin', onInput: (v) => { state.shift = v; changed(); } });
$('#lo-box').append(thetaSlider, rateSlider);
$('#shift-box').append(shiftSlider);
const motorSeg = segmented([
  { value: 'stop', label: 'Stop' }, { value: 'scan', label: 'Scan', title: 'Turn θ round and round' }, { value: 'sweep', label: 'Sweep', title: 'Turn θ to and fro between 0° and 180°' },
], state.motor, (m) => { state.motor = m; if (m !== 'stop') setRunning(true); dirty(); scheduleHash(); }, { label: 'Motor' });
$('#motor-box').append(motorSeg);
function stopMotor() { if (state.motor !== 'stop') { state.motor = 'stop'; motorSeg.value = 'stop'; } }
$('#clear').addEventListener('click', clearRecord);
$('#variance').addEventListener('pointerdown', (e) => { stopMotor(); varianceClick(e); const move = (ev) => varianceClick(ev); const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); });

// LIGO.
const sqOn = toggle('Squeezed light', state.sq.on, (on) => { state.sq.on = on; changed(); }, 'Inject a squeezed vacuum into the dark port instead of letting the plain vacuum in');
$('#sq-row').append(sqOn);
const dbSlider = slider({ label: 'squeezing (dB)', min: 0, max: 15, step: 0.1, value: state.sq.dB, title: 'The squeezer\'s output: 10 log₁₀ e^2r', onInput: (v) => { state.sq.dB = v; changed(); } });
const angleSlider = slider({ label: 'angle (°)', min: 0, max: 180, step: 1, value: state.sq.angle, title: 'The squeezed quadrature\'s angle from the amplitude quadrature: 90° is phase-squeezed', onInput: (v) => { state.sq.angle = v; changed(); } });
const lossLigoSlider = slider({ label: 'loss (%)', min: 0, max: 60, step: 1, value: Math.round(100 * (1 - state.sq.eta)), title: 'The fraction of the squeezed light lost between the squeezer and the photodiode', onInput: (v) => { state.sq.eta = 1 - v / 100; changed(); } });
$('#ligo-box').append(dbSlider, angleSlider, lossLigoSlider);
const fdToggle = toggle('Frequency-dependent (filter cavity)', state.sq.fd, (on) => { state.sq.fd = on; angleSlider.hidden = on; changed(); }, 'A filter cavity turns the squeezing angle with frequency so that it follows the readout: phase-squeezed at high frequency, amplitude-squeezed at low');
$('#fd-row').append(fdToggle);
const powerSlider = slider({ label: 'arm power (kW)', min: 10, max: 2000, log: true, value: state.ligo.P / 1e3, title: 'The light circulating in each arm cavity: shot noise falls as 1/√P, radiation pressure rises as √P', onInput: (v) => { state.ligo.P = v * 1e3; changed(); } });
const massSlider = slider({ label: 'mirror mass (kg)', min: 5, max: 200, log: true, value: state.ligo.M, title: 'Each test mass: heavier mirrors are pushed less', onInput: (v) => { state.ligo.M = v; changed(); } });
const fcSlider = slider({ label: 'arm bandwidth (Hz)', min: 20, max: 2000, log: true, value: state.ligo.fc, title: 'The arm cavities\' bandwidth: shot noise rises above it', onInput: (v) => { state.ligo.fc = v; changed(); } });
$('#ifo-box').append(powerSlider, massSlider, fcSlider);
const sourceSeg = segmented(Object.entries(SOURCES).map(([value, s]) => ({ value, label: s.label, title: s.title })), state.source, (v) => { state.source = v; state.distance = SOURCES[v].d; distSlider.value = state.distance; changed(); }, { label: 'The source' });
$('#source-row').append(sourceSeg);
const distSlider = slider({ label: 'distance (Mpc)', min: 10, max: 2000, log: true, value: state.distance, title: 'How far away the binary is: the signal falls as 1/d', onInput: (v) => { state.distance = v; changed(); } });
const hearButton = el('button', { type: 'button', title: 'Play the chirp as sound: its frequencies are in the audible range', onclick: () => hearChirp() }, 'Hear it');
$('#chirp-box').append(distSlider, el('div', { class: 'row' }, hearButton));
$('#chirp-note').textContent = 'The Newtonian chirp of the two masses, face on and overhead, from its starting frequency to the innermost stable orbit, where the inspiral ends.  ρ, in the read-out, is the signal-to-noise ratio of a matched filter; 8 is the usual threshold for a detection.';
// The detector's output.
const dataSeg = segmented([
  { value: 'white', label: 'Whitened', title: 'Each frequency divided by the noise there: the noise comes out flat, in units of its spread σ, and the chirp is weighted as the matched filter weighs it' },
  { value: 'raw', label: 'Raw', title: 'The strain the detector records (above 10 Hz): the noise of every frequency at once, the chirp lost in it' },
], state.data, (v) => { state.data = v; dirty(); scheduleHash(); }, { label: 'The data' });
const templateToggle = toggle('Template', state.template, (on) => { state.template = on; dirty(); scheduleHash(); }, 'Draw the template, a copy of the chirp, over the data where its merger is put: lined up with the chirp unless you slide it or click elsewhere');
$('#data-row').append(dataSeg, templateToggle);
const slideButton = el('button', { type: 'button', title: 'Slide the template along the data from the start: the filter\'s output is drawn as it goes, and leaps up when the template lines up with the chirp', onclick: () => { if (anim.sliding) { anim.sliding = false; dirty(); slideButton.textContent = 'Slide the template'; } else { startSlide(); slideButton.textContent = 'Stop'; } } }, 'Slide the template');
const noiseButton = el('button', { type: 'button', title: 'Another realisation of the noise, from the same spectrum: the peak moves by about ±1, the filter noise\'s spread', onclick: () => { state.seed += 1; changed(); } }, 'New noise');
$('#slide-row').append(slideButton, noiseButton);
const detectorCanvas = $('#detector');
detectorCanvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  detectorCanvas.setPointerCapture(e.pointerId);
  slideButton.textContent = 'Slide the template';
  detectorPointer(e);
  const move = (ev) => detectorPointer(ev);
  const up = () => { detectorCanvas.removeEventListener('pointermove', move); detectorCanvas.removeEventListener('pointerup', up); };
  detectorCanvas.addEventListener('pointermove', move); detectorCanvas.addEventListener('pointerup', up);
});
detectorCanvas.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  anim.sliding = false; slideButton.textContent = 'Slide the template';
  state.lag = clamp(state.lag + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 0.1 : 0.005), 0, DET_T);
  dirty();
});

/** The chirp as sound (its frequencies are in the audible range), through Web Audio. */
let audio = null;
function hearChirp() {
  try {
    const ch = ensureChirp(), s = ch.sig;
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const buf = audio.createBuffer(1, s.n, s.fs), d = buf.getChannelData(0);
    let m = 0;
    for (let i = 0; i < s.n; i++) m = Math.max(m, Math.abs(s.h[i]));
    for (let i = 0; i < s.n; i++) d[i] = (0.5 * s.h[i]) / m;
    const src = audio.createBufferSource();
    src.buffer = buf; src.connect(audio.destination); src.start();
  } catch (e) { /* no audio here */ }
}

// Animation.
const periodSlider = slider({ label: 'seconds per period', min: 1, max: 12, step: 0.5, value: state.period, title: 'How slowly the cloud turns: seconds of your time per period of the light', onInput: (v) => { state.period = v; scheduleHash(); } });
$('#anim-box').append(periodSlider);
const ellipseToggle = toggle('1σ ellipse', state.show.ellipse, (on) => { state.show.ellipse = on; dirty(); scheduleHash(); }, 'Outline the cloud at one standard deviation');
const wedgeToggle = toggle('phase wedge', state.show.wedge, (on) => { state.show.wedge = on; dirty(); scheduleHash(); }, 'Two lines from the origin touching the cloud: ± the phase uncertainty Δφ');
$('#show-row').append(ellipseToggle, wedgeToggle);
function setRunning(on) { state.running = on; $('#run').textContent = on ? 'Pause' : 'Run'; lastT = 0; kick(); }
$('#run').addEventListener('click', () => setRunning(!state.running));
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea, button') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ' && state.view !== 'ligo') { e.preventDefault(); setRunning(!state.running); }
});

/** After any change of the state: sliders in step, the record cleared where it no longer applies, redraw. */
function changed() {
  syncSqPresets();
  anim.sample = null;              // the point on the stick belongs to the old cloud: draw a new one
  alphaSlider.hidden = phaseSlider.hidden = state.kind === 'vacuum';
  lossSlider.value = Math.round(100 * (1 - state.eta));
  kindSeg.value = state.kind;
  if (state.view === 'homodyne') clearRecord();
  dirty(); scheduleHash();
}

// Dragging in the plane: the mean field (views 1–2) or the LO's axis (view 3).
const planeCanvas = $('#plane');
let planeDrag = null;
function planePoint(e) { const r = planeCanvas.getBoundingClientRect(); return plane.fromPixel(e.clientX - r.left, e.clientY - r.top); }
planeCanvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  planeCanvas.setPointerCapture(e.pointerId);
  planeDrag = state.view === 'homodyne' ? 'axis' : 'alpha';
  planeCanvas.classList.add('dragging');
  planeMove(e);
});
planeCanvas.addEventListener('pointermove', (e) => { if (planeDrag) planeMove(e); });
const endPlaneDrag = () => { planeDrag = null; planeCanvas.classList.remove('dragging'); };
planeCanvas.addEventListener('pointerup', endPlaneDrag);
planeCanvas.addEventListener('pointercancel', endPlaneDrag);
function planeMove(e) {
  const [X1, X2] = planePoint(e);
  if (planeDrag === 'axis') { stopMotor(); setTheta(Math.atan2(X2, X1) / DEG); return; }
  // The point under the pointer is the turned cloud's mean: turn it back to t = 0.
  const th = currentTurn(), c = Math.cos(th), s = Math.sin(th);
  const x1 = c * X1 - s * X2, x2 = s * X1 + c * X2;
  const a = Math.hypot(x1, x2);
  if (a < 0.15) { state.kind = 'vacuum'; }
  else { state.kind = 'laser'; state.alpha = clamp(+a.toFixed(2), 0, 4.5); state.phase = Math.round(Math.atan2(x2, x1) / DEG); alphaSlider.value = state.alpha; phaseSlider.value = state.phase; }
  changed();
}
planeCanvas.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 10 : 1;
  if (state.view === 'homodyne') { if (e.key === 'ArrowLeft') setTheta(state.theta - step); else if (e.key === 'ArrowRight') setTheta(state.theta + step); else return; }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { state.phase += e.key === 'ArrowRight' ? -step : step; phaseSlider.value = state.phase; changed(); }
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { state.alpha = clamp(state.alpha + (e.key === 'ArrowUp' ? 0.1 : -0.1) * step, 0, 4.5); state.kind = state.alpha > 0 ? 'laser' : 'vacuum'; alphaSlider.value = state.alpha; changed(); }
  else return;
  e.preventDefault();
});

window.addEventListener('resize', dirty);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { dirty(); });
document.addEventListener('visibilitychange', () => { lastT = 0; kick(); });

// ------------------------------------------------------------------- the address

let hashTimer = 0;
function scheduleHash() { clearTimeout(hashTimer); hashTimer = setTimeout(saveHash, 300); }
function saveHash() {
  const h = {
    v: state.view, k: state.kind === 'vacuum' ? 'vac' : undefined, a: r5(state.alpha), ph: state.phase || undefined,
    r: state.r || undefined, psi: state.r ? state.psi : undefined, eta: state.eta < 1 ? r5(state.eta) : undefined,
    per: state.period !== 4 ? state.period : undefined, run: state.running ? undefined : 0,
    el: state.show.ellipse ? undefined : 0, wd: state.show.wedge ? 1 : undefined,
    th: state.view === 'homodyne' ? Math.round(state.theta) : undefined, mo: state.motor !== 'stop' ? state.motor : undefined, rate: state.rate !== 30 ? state.rate : undefined,
    sh: state.shift ? r5(state.shift) : undefined,
    P: state.ligo.P !== DEFAULTS.P ? r5(state.ligo.P) : undefined, M: state.ligo.M !== DEFAULTS.M ? r5(state.ligo.M) : undefined, fc: state.ligo.fc !== DEFAULTS.fc ? r5(state.ligo.fc) : undefined,
    sq: state.sq.on ? 1 : undefined, db: r5(state.sq.dB), an: state.sq.angle, lo: r5(1 - state.sq.eta) || undefined, fd: state.sq.fd ? 1 : undefined,
    src: state.source, d: r5(state.distance),
    ns: state.seed !== DET_SEED ? state.seed : undefined, dv: state.data === 'raw' ? 'raw' : undefined, tp: state.template ? undefined : 0,
  };
  writeHash(h);
}
function loadHash(h) {
  const numv = (s, d) => (s !== undefined && Number.isFinite(+s) ? +s : d);
  state.kind = h.k === 'vac' ? 'vacuum' : 'laser';
  state.alpha = clamp(numv(h.a, 3), 0, 4.5); state.phase = numv(h.ph, 0);
  state.r = clamp(numv(h.r, 0), 0, 2); state.psi = numv(h.psi, 0); state.eta = clamp(numv(h.eta, 1), 0.01, 1);
  state.period = clamp(numv(h.per, 4), 0.5, 30); state.running = h.run !== '0';
  state.show.ellipse = h.el !== '0'; state.show.wedge = h.wd === '1';
  state.theta = numv(h.th, 0); state.motor = ['scan', 'sweep'].includes(h.mo) ? h.mo : 'stop'; state.rate = numv(h.rate, 30);
  state.shift = clamp(numv(h.sh, 0), 0, 1);
  state.ligo.P = numv(h.P, DEFAULTS.P); state.ligo.M = numv(h.M, DEFAULTS.M); state.ligo.fc = numv(h.fc, DEFAULTS.fc);
  state.sq.on = h.sq === '1'; state.sq.dB = clamp(numv(h.db, 6), 0, 20); state.sq.angle = numv(h.an, 90); state.sq.eta = 1 - clamp(numv(h.lo, 0), 0, 0.99); state.sq.fd = h.fd === '1';
  state.source = SOURCES[h.src] ? h.src : 'bns'; state.distance = clamp(numv(h.d, SOURCES[state.source].d), 1, 1e4);
  state.seed = Math.round(numv(h.ns, DET_SEED)); state.data = h.dv === 'raw' ? 'raw' : 'white'; state.template = h.tp !== '0'; state.lag = DET_MERGE;
  finishSetup(['mode', 'squeeze', 'homodyne', 'ligo'].includes(h.v) ? h.v : 'mode');
}

// ----------------------------------------------------------------------- set-ups

/** Everything back to its default unless given, then the view; then the page scrolled to the top, or to the picture focus names. */
function setup(o, focus = null) {
  const d = { view: 'mode', kind: 'laser', alpha: 3, phase: 0, r: 0, psi: 0, eta: 1, period: 4, running: true, show: { ellipse: true, wedge: false },
    theta: 0, motor: 'stop', rate: 30, shift: 0, ligo: { P: DEFAULTS.P, fc: DEFAULTS.fc, M: DEFAULTS.M }, sq: { on: false, dB: 6, angle: 90, eta: 0.8, fd: false }, source: 'bns', distance: 40,
    seed: DET_SEED, data: 'white', template: true, lag: DET_MERGE, ...o };
  Object.assign(state, { ...d, show: { ...d.show }, ligo: { ...d.ligo }, sq: { ...d.sq } });
  finishSetup(d.view);
  if (focus) $(focus).scrollIntoView({ block: 'end' }); else window.scrollTo(0, 0);
}

function finishSetup(view) {
  anim.t = 0; anim.trace = []; anim.sample = null; anim.samplePeriod = -1; anim.sweepDir = 1; anim.sliding = false;
  // Some history on the field's chart at once: the first periods, recorded without drawing.
  if (view === 'mode' || view === 'squeeze') for (let i = 0; i < TRACE_PERIODS * 60; i++) { anim.t += 1 / 60; recordField(); }
  clearRecord();
  alphaSlider.value = state.alpha; phaseSlider.value = state.phase; rSlider.value = state.r; psiSlider.value = state.psi;
  thetaSlider.value = state.theta; rateSlider.value = state.rate; shiftSlider.value = state.shift; motorSeg.value = state.motor;
  periodSlider.value = state.period; ellipseToggle.on = state.show.ellipse; wedgeToggle.on = state.show.wedge;
  sqOn.on = state.sq.on; dbSlider.value = state.sq.dB; angleSlider.value = state.sq.angle; lossLigoSlider.value = Math.round(100 * (1 - state.sq.eta)); fdToggle.on = state.sq.fd;
  angleSlider.hidden = state.sq.fd;
  powerSlider.value = state.ligo.P / 1e3; massSlider.value = state.ligo.M; fcSlider.value = state.ligo.fc;
  sourceSeg.value = state.source; distSlider.value = state.distance;
  dataSeg.value = state.data; templateToggle.on = state.template; slideButton.textContent = 'Slide the template';
  $('#run').textContent = state.running ? 'Pause' : 'Run';
  syncSqPresets();
  alphaSlider.hidden = phaseSlider.hidden = state.kind === 'vacuum';
  lossSlider.value = Math.round(100 * (1 - state.eta));
  kindSeg.value = state.kind;
  setView(view);
  if (state.view === 'homodyne') takeSamples(0.5);   // something on the chart at once
}

const setups = {
  // 1 · One mode
  vacuum: () => setup({ view: 'mode', kind: 'vacuum' }),
  coherent: () => setup({ view: 'mode', kind: 'laser', alpha: 3 }),
  phase: () => setup({ view: 'mode', kind: 'laser', alpha: 2, show: { ellipse: true, wedge: true } }),
  // 2 · Squeezing
  squeezevac: () => setup({ view: 'squeeze', kind: 'vacuum', r: SQ6, psi: 0 }),
  phasesq: () => setup({ view: 'squeeze', kind: 'laser', alpha: 3, r: SQ6, psi: 90 }),
  loss: () => setup({ view: 'squeeze', kind: 'vacuum', r: rFromDb(10), psi: 0, eta: 0.5 }),
  // 3 · Homodyne
  quadrature: () => setup({ view: 'homodyne', kind: 'laser', alpha: 2, theta: 0 }),
  scan: () => setup({ view: 'homodyne', kind: 'vacuum', r: SQ6, psi: 0, theta: 0, motor: 'scan', rate: 30 }),
  phaseshift: () => setup({ view: 'homodyne', kind: 'laser', alpha: 3, theta: 90, shift: 0.1 }),
  // 4 · LIGO
  darkport: () => setup({ view: 'ligo', sq: { on: false, dB: 6, angle: 90, eta: 0.65, fd: false } }),
  inject: () => setup({ view: 'ligo', sq: { on: true, dB: 6, angle: 90, eta: 0.65, fd: false } }),
  radiation: () => setup({ view: 'ligo', sq: { on: true, dB: 10, angle: 90, eta: 1, fd: false } }),
  fdsqz: () => setup({ view: 'ligo', sq: { on: true, dB: 10, angle: 90, eta: 1, fd: true } }),
  chirp: () => setup({ view: 'ligo', sq: { on: true, dB: 6, angle: 90, eta: 0.8, fd: true }, source: 'bns', distance: 40 }),
  buried: () => setup({ view: 'ligo', sq: { on: true, dB: 6, angle: 90, eta: 0.8, fd: true }, source: 'bns', distance: 40 }, '#det-readout'),
  reach: () => setup({ view: 'ligo', sq: { on: false, dB: 6, angle: 90, eta: 0.8, fd: true }, source: 'bns', distance: 361 }, '#det-readout'),
};
drawer($('#help'), $('#help-button'), setups);

// -------------------------------------------------------------------------- start

function fromAddress() {
  const hash = readHash();
  if (setups[hash.setup]) setups[hash.setup]();
  else if (hash.v) loadHash(hash);
  else setups.vacuum();
}
fromAddress();
window.addEventListener('hashchange', fromAddress);

window.__app = {
  state, setups, anim, ready: true, setView, setRunning, setTheta, clearRecord,
  base: () => baseState(), signal: () => signalState(), turned: () => lastTurned,
  /** The pixel (CSS, from the plane canvas's top left) of a point of the quadrature plane. */
  pixelOf: (x1, x2) => [plane.X(x1), plane.Y(x2)],
  photons: () => { const p = photons(); return { P: Array.from(p.P.slice(0, 40)), mean: p.moments.mean, sd: p.moments.sd, nbar: p.nbar }; },
  trace: () => anim.trace.map((x) => [...x]),
  record: () => { const out = []; for (let k = 0; k < record.bins; k++) { const s = record.stats(k); if (s) out.push(s); } return out; },
  histogram: () => histogramAt(state.theta),
  reading: () => { const st = signalState(), th = state.theta * DEG; return { mean: quadratureMean(st, th), variance: quadratureVariance(st, th), db: noiseDb(quadratureVariance(st, th)) }; },
  phase: () => phaseMeasurement(signalState(), baseState(), state.theta * DEG),
  noise: (f) => { const p = ligoParams(); const b = noiseBudget(f, p, squeezeParams()), v = noiseBudget(f, p, { ...squeezeParams(), on: false }); return { ...b, vacuum: v }; },
  sqlFrequency: () => sqlFrequency(ligoParams()),
  snr: () => snr(),
  chirp: () => { const ch = ensureChirp(); return { tc: ch.sig.tc, fisco: ch.fisco, mc: ch.mc, hmax: ch.hmax / state.distance, n: ch.sig.n, fmin: ch.src.fmin }; },
  /** The detector strip's numbers; white: the first whitened-noise samples (the realisation), mfVar: the filter noise's sample variance. */
  detector: () => {
    const F = detectorFindings(), det = detector;
    let s2 = 0;
    for (let j = 0; j < det.N; j++) s2 += det.mfNoise[j] ** 2;
    return { ...F, white: Array.from(det.whiteNoise.slice(0, 64)), mfVar: s2 / det.N, seed: state.seed, sliding: anim.sliding, N: det.N };
  },
  slide: () => startSlide(),
  hold(on = true) { testHold = on; lastT = 0; kick(); },
  /** Restart the samples' random generator (views 1–3), so a still picture is the same each time it is made. */
  reseed(seed = 12345) { rng.s = seed >>> 0; rng.spare = null; },
  /** Move the clocks on by dt seconds, n times, drawing the last frame. */
  step(dt = 1 / 60, n = 1) { for (let i = 0; i < n; i++) advance(dt); needDraw = false; drawNow(); return { t: anim.t, theta: state.theta, samples: record.count }; },
  draw: () => drawNow(),
  /** Milliseconds per frame of the animation, the best of three runs of n frames. */
  bench(n = 10) {
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) { advance(1 / 60); drawNow(); }
      best = Math.min(best, (performance.now() - t0) / n);
    }
    return best;
  },
};
