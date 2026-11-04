// Radio interferometry: the page.  Four numbered views over one simulation: one source's noise
// (multiply and average); two sources and two antennas (the same noise, a little later: the
// fringe in the separation); the uv plane a pair maps (the sky's Fourier transform); a whole
// array and the turning Earth.  The physics is in sim.js (the correlator), display.js (the
// slowed-down time streams), sky.js and synthesis.js; plots.js draws; this file is the views,
// the controls and the experiments.

import { Simulation, M, CYCLES, HISTORY, bandHalf } from './sim.js';
import { makeTape, receiverStream, realVoltage, voltageAt } from './display.js';
import {
  UNITS, ANGLE, wavelength, angleIn, angleFrom, POINT_PRESETS, pointSources, PICTURES, pictureSky, imageToSky,
  samplePoints, idealGrid, idealAt, idealWindow, totalFlux, N, NS,
} from './sky.js';
import {
  stationXYZ, tracks, gridSamples, dirtyBeam, dirtyImage, cleanStart, cleanSteps, fitBeam, restore, layout, baselineRange, EHT_CENTRE,
} from './synthesis.js';
import { colorize, colorOf, cssColorOf, MODES } from '../lib/complexcolor.js';
import { el, $, slider, segmented, toggle, drawer, toast, readHash, writeHash, setGroups } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors, niceTicks, tickLabel, fillSlots } from '../lib/plot.js';
import { squareArea, blit, pictureAxes, edgeTicks, arrow, line, fillSigned, complexPlane, valueDot, ring, cross, haloText } from './plots.js';

const DEG = Math.PI / 180;
const TWO_PI = 2 * Math.PI;
const POINTS_FOR_PICTURE = 200;     // points that stand in for a picture in the correlator
const DISPLAY_SOURCES = 40;         // of which the time streams on the screen use this many
const SCENE_HALF = 4;               // view 2: the ground reaches ±4 m
const SPEED = 0.1;                  // the streams scroll a tenth of their window each second

// ------------------------------------------------------------------------- state

const DEFAULTS = () => ({
  view: 'one', units: 'bench', nu0: null,
  band: 0.05, noise: 0.5, avg: 30, display: 'real',
  lag: 0, partner: 'self',                                                // view 1
  scene: { sources: [{ theta: 10, I: 1 }], xA: -1, xB: -0.8, ref: 0 },    // view 2: degrees, metres
  coherent: false, cohPhase: 90,
  sky: { kind: 'points', preset: 'pentagon', picture: 'disk', size: 1, rotation: 0, bright: 1 },
  stripes: true,
  pair: { bx: 1.2, by: 0.5, cx: 0, cy: 0, fixA: false },                  // view 3: metres
  tracking: true, hbt: false, sketch: false, autopilot: false, mode: 'complex',
  layout: 'y', n: 8, arm: 1, earth: false, hours: 8, dec: 40, lat: 34, weighting: 'uniform',
  clean: false, gain: 0.1, cleanRun: 100, tNow: 1,
});
let state = DEFAULTS();
const anim = { playing: true, t: 200, earthPlaying: false, pen: true, frames: 0, pilot: 0, lastPaint: 0 };
let testHold = false;

const sim = new Simulation();

// ------------------------------------------------------------------------- units

const spatial = () => state.view === 'uv' || state.view === 'array';
/** The units preset: chosen in views 3 and 4; views 1 and 2 are always the lab bench. */
const U = () => (spatial() ? UNITS[state.units] : UNITS.bench);
const nu0 = () => (spatial() && state.nu0) || U().nu0;
const lambda = () => wavelength(nu0());
const toWaves = (metres) => metres / lambda();
let arrayReach = 0;                         // view 4: the uv picture reaches a little past the longest baseline
const uvMaxM = () => (state.view === 'array' && arrayReach ? arrayReach : U().uvMax);   // the uv picture's half-extent, metres
const uvMax = () => uvMaxM() / lambda();    // and wavelengths
/** Ticks for large numbers: thin-space groups, not powers of ten. */
const bigTick = (v) => (Math.abs(v) >= 1e4 ? (v < 0 ? '−' : '') + Math.round(Math.abs(v)).toLocaleString('en-US').replace(/,/g, ' ') : tickLabel(v));
const fov = () => U().fov;                  // the sky picture's width, direction cosines
const pix = () => fov() / NS;
const lenUnit = () => U().len;
const lenIn = (m) => m / U().lenScale;
const angleSym = () => (U().angle === 'deg' ? '°' : ANGLE[U().angle][1]);
const bw = () => sim.bandwidth();
const freqText = (f = nu0()) => (f >= 1e9 ? `${+(f / 1e9).toPrecision(4)} GHz` : `${+(f / 1e6).toPrecision(4)} MHz`);
const lambdaText = () => { const L = lambda(); return L >= 1 ? `${+L.toPrecision(3)} m` : L >= 0.01 ? `${+(L * 100).toPrecision(3)} cm` : `${+(L * 1000).toPrecision(3)} mm`; };
const fmtWaves = (x) => (Math.abs(x) >= 1e9 ? `${tickLabel(x / 1e9)}G` : Math.abs(x) >= 1e6 ? `${tickLabel(x / 1e6)}M` : Math.abs(x) >= 1e3 ? `${tickLabel(x / 1e3)}k` : tickLabel(x));
/** A direction cosine (or a small angle) in the preset's angle unit. */
const angleOf = (l) => angleIn(U(), l);
const phaseDeg = (z) => Math.atan2(z[1], z[0]) / DEG;

// ------------------------------------------------------------------------- the sky model (views 3, 4)

let skyModel = { kind: 'points', sources: [] };
let skyPicture = null, ownImage = null, grid = null, gridDirty = true;
let uvImage = null, uvDirty = true;

function directions(k) {
  const s = skyModel.sources[k];
  if (s.z !== undefined) { const R = Math.hypot(s.x, s.y, s.z); return [s.x / R, s.y / R]; }
  return [s.l, s.m];
}

function buildSky() {
  const S = state.sky, u = U();
  if (S.kind === 'points') {
    skyModel = { kind: 'points', sources: pointSources(S.preset, { scale: u.pointScale * S.size, rotation: S.rotation * DEG, bright: S.bright, z: u.nearField ? u.z : null }) };
  } else skyModel = { kind: 'picture', sky: skyPicture || new Float64Array(NS * NS) };
  gridDirty = true; uvDirty = true; arrayDirty = true; stripesKey = '';
  applySimSky();
}

/** The correlator's sources: the points themselves, or points drawn from the picture. */
function applySimSky() {
  if (!spatial()) return;
  sim.sources = skyModel.kind === 'points' ? skyModel.sources.map((s) => ({ ...s })) : samplePoints(skyModel.sky, pix(), POINTS_FOR_PICTURE);
  sim.reset(); tapes.key = '';
}

async function loadPicture(id) {
  try { skyPicture = await pictureSky(id, state.sky.size, id === 'own' ? ownImage : null); }
  catch (e) { toast(e.message); return; }
  state.sky.kind = 'picture'; state.sky.picture = id;
  buildSky(); syncPanels(); dirty(); scheduleHash();
}

function ensureGrid() {
  if (!gridDirty && grid) return grid;
  grid = idealGrid(skyModel, pix(), directions);
  gridDirty = false;
  return grid;
}

// ------------------------------------------------------------------------- the simulation for each view

function pairPositions() {
  const p = state.pair;
  if (p.fixA) return [[p.cx, p.cy], [p.cx + p.bx, p.cy + p.by]];
  return [[p.cx - p.bx / 2, p.cy - p.by / 2], [p.cx + p.bx / 2, p.cy + p.by / 2]];
}
const posWaves = ([x, y]) => ({ u: toWaves(x), v: toWaves(y) });

function applySim({ keepAverages = false } = {}) {
  sim.band = state.band; sim.alpha = 1 / state.avg; sim.lambda = lambda();
  sim.hbt = state.hbt && state.view === 'uv'; sim.coherent = state.coherent && (state.view === 'two' || state.view === 'uv');
  sim.coherentPhase = state.cohPhase * DEG;
  sim.tracking = state.tracking; sim.nearField = false; sim.pointing = { l: 0, m: 0 }; sim.gains = null;
  if (state.view === 'one') {
    sim.sources = state.partner === 'self' ? [{ l: 0, m: 0, I: 1 }] : [{ l: 0, m: 0, I: 1 }, { l: 0, m: 0, I: 1 }];
    if (state.partner !== 'self') sim.gains = [[1, 0], [0, 1]];
    sim.receivers = [{ u: 0, v: 0 }, { u: 0, v: 0 }];
    sim.noise = 0; sim.coherent = false; sim.hbt = false;
  } else if (state.view === 'two') {
    const sc = state.scene;
    sim.sources = sc.sources.map((s) => ({ l: Math.sin(s.theta * DEG), m: 0, I: s.I }));
    sim.receivers = [{ u: toWaves(sc.xA), v: 0 }, { u: toWaves(sc.xB), v: 0 }];
    sim.noise = state.noise;
    sim.pointing = { l: Math.sin(sc.ref * DEG), m: 0 };
  } else {
    sim.receivers = pairPositions().map(posWaves);
    sim.noise = state.noise; sim.nearField = U().nearField;
    if (!keepAverages) applySimSky();
  }
  if (!keepAverages) { sim.reset(); tapes.key = ''; }
}

/** Move the pair (view 3) without forgetting the averages: the running average glides. */
function movePair() { sim.receivers = pairPositions().map(posWaves); }
function moveScene() {
  const sc = state.scene;
  sim.sources = sc.sources.map((s) => ({ l: Math.sin(s.theta * DEG), m: 0, I: s.I }));
  sim.receivers = [{ u: toWaves(sc.xA), v: 0 }, { u: toWaves(sc.xB), v: 0 }];
  sim.pointing = { l: Math.sin(sc.ref * DEG), m: 0 };
}

// ------------------------------------------------------------------------- the slowed-down streams

const tapes = { key: '', src: [], noise: [null, null] };
function ensureTapes() {
  const count = state.view === 'one' ? 2 : Math.min(sim.sources.length, DISPLAY_SOURCES);
  const key = `${bw()}|${count}`;
  if (tapes.key === key) return;
  tapes.key = key;
  tapes.src = Array.from({ length: Math.max(1, count) }, () => makeTape(bw(), 1));
  tapes.noise = [makeTape(bw(), 1), makeTape(bw(), 1)];
}
/** What receiver j at r hears, as the correlator sees it (after the electronic delay). */
function terms(j, r) {
  ensureTapes();
  const K = sim.sources.length, D = Math.min(K, DISPLAY_SOURCES), scale = Math.sqrt(K / Math.max(1, D)), track = sim.trackAt(r), out = [];
  for (let k = 0; k < D; k++) {
    const [d, a] = sim.delayAt(r, k);
    out.push({ tape: sim.coherent ? tapes.src[0] : tapes.src[k], delay: d - track, amp: a * sim.gain(j, k) * Math.sqrt(sim.sources[k].I) * scale, phase: sim.coherent ? sim.coherentPhase * k : 0 });
  }
  return out;
}
const buffers = new Map();
function buf(name, n) {
  let b = buffers.get(name);
  if (!b || b[0].length < n) { b = [new Float64Array(n), new Float64Array(n), new Float64Array(n)]; buffers.set(name, b); }
  return b;
}
/** A stream of `points` envelopes and real voltages over [t0, t1]. */
function stream(name, ts, noise, noiseAmp, t0, t1, points) {
  const b = buf(name, points);
  receiverStream(ts, noise, noiseAmp, t0, t1, points, b);
  realVoltage(b, t0, t1, points, b[2]);
  return { re: b[0], im: b[1], x: b[2], t0, t1, n: points };
}
const windowCycles = () => (state.view === 'one' ? Math.max(24, Math.min(300, 3 / bw())) : Math.max(16, Math.min(120, 2.5 / bw())));
const lagMax = () => Math.max(4, Math.min(300, 3 / bw()));

// ------------------------------------------------------------------------- the array (view 4)

let dishes = [], dishNames = null, tr = null, sampled = null, beam = null, dirtyImg = null, cs = null, restored = null, fit = null;
let arrayDirty = true;

function buildArray() {
  if (state.layout === 'eht') { const l = layout('eht'); dishes = l.dishes; dishNames = l.names; }
  else {
    const R = U().uvMax * state.arm;
    const l = layout(state.layout, { arm: state.layout === 'two' ? 0.6 * R : 0.45 * R, unit: (0.9 * R) / 39, n: state.n });
    dishes = l.dishes; dishNames = null;
  }
  arrayDirty = true;
}

/** A round number at least x: 1, 1.5, 2, 3, 5 or 7 times a power of ten. */
function niceUp(x) { const p = 10 ** Math.floor(Math.log10(x)); for (const m of [1, 1.5, 2, 3, 5, 7, 10]) if (m * p >= x * 0.999) return m * p; return 10 * p; }

function computeArray() {
  if (!arrayDirty && tr) return;
  arrayDirty = false;
  const lat = (state.layout === 'eht' ? EHT_CENTRE.lat : state.lat) * DEG;
  tr = tracks(dishes.map(([e, n]) => stationXYZ(e, n, lat)), { dec: state.dec * DEG, hours: state.earth ? state.hours : 0, steps: 121 });
  // The uv picture reaches a little past the longest baseline seen (not past the grid).
  let far = 0;
  for (let o = 0; o < tr.u.length; o++) if (tr.ok[o]) far = Math.max(far, Math.hypot(tr.u[o], tr.v[o]));
  const gridEdge = (N / 2 - 1) * (1 / (N * pix())) * lambda();
  const reach = Math.min(niceUp(Math.max(far * 1.15, 0.01 * U().uvMax)), niceUp(gridEdge));
  if (reach !== arrayReach) { arrayReach = reach; uvDirty = true; }
  const g = ensureGrid(), upto = state.earth ? Math.round(state.tNow * (tr.nt - 1)) : Infinity;
  sampled = gridSamples(tr, lambda(), N, g.du, { upto, weighting: state.weighting });
  beam = dirtyBeam(sampled.S, N);
  dirtyImg = dirtyImage(sampled.S, g, N);
  fit = null; restored = null;
  cs = cleanStart(dirtyImg);
  if (state.clean && state.cleanRun > 0) runClean(state.cleanRun);
}
function runClean(steps) {
  if (!cs || !beam) return;
  let peak = 0;
  for (const v of dirtyImg) peak = Math.max(peak, Math.abs(v));
  cleanSteps(cs, beam, N, { gain: state.gain, steps, threshold: 0.01 * peak });
  restored = null;
}
function restoredImage() {
  if (!restored) { if (!fit) fit = fitBeam(beam, N); restored = restore(cs, fit, N); }
  return restored;
}

// ------------------------------------------------------------------------- the Etch-a-Sketch

// Every chunk measured is added into the uv grid where the pair is (a small brush) and,
// conjugated, at the mirror point; a cell shows the mean of what has been painted into it.
const paint = { sum: [new Float64Array(N * N), new Float64Array(N * N)], w: new Float64Array(N * N), S: new Float64Array(N * N), image: null, stale: true, cells: 0, chunks: 0 };
function clearPaint() { paint.sum[0].fill(0); paint.sum[1].fill(0); paint.w.fill(0); paint.S.fill(0); paint.image = null; paint.stale = true; paint.cells = 0; paint.chunks = 0; }
const BRUSH = [[0, 0, 1], [1, 0, 0.5], [-1, 0, 0.5], [0, 1, 0.5], [0, -1, 0.5], [1, 1, 0.25], [1, -1, 0.25], [-1, 1, 0.25], [-1, -1, 0.25]];
function paintAt(u, v, re, im) {
  const du = ensureGrid().du, h = N / 2, p0 = Math.round(h + u / du), q0 = Math.round(h - v / du);
  for (const [dp, dq, w] of BRUSH) {
    const p = p0 + dp, q = q0 + dq;
    if (p < 1 || q < 1 || p >= N - 1 || q >= N - 1) continue;
    for (const [i, j, s] of [[p, q, 1], [N - p, N - q, -1]]) {
      const o = j * N + i;
      if (paint.w[o] === 0) paint.cells++;
      paint.sum[0][o] += w * re; paint.sum[1][o] += s * w * im; paint.w[o] += w; paint.S[o] = 1;
    }
  }
  paint.chunks++;
  paint.stale = true;
}
function paintedV() {
  const re = new Float64Array(N * N), im = new Float64Array(N * N);
  for (let o = 0; o < re.length; o++) if (paint.w[o]) { re[o] = paint.sum[0][o] / paint.w[o]; im[o] = paint.sum[1][o] / paint.w[o]; }
  return { re, im };
}
function paintedImage() {
  if (!paint.stale && paint.image) return paint.image;
  paint.image = dirtyImage(paint.S, paintedV(), N);
  paint.stale = false;
  return paint.image;
}

// ------------------------------------------------------------------------- colours

let C = themeColors(), colours = {};
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function readColours() {
  C = themeColors();
  colours = {
    a: cssVar('--ant-a'), b: cssVar('--ant-b'), env: cssVar('--env'), cross: cssVar('--cross'), pos: cssVar('--pos'), neg: cssVar('--neg'),
    src: [cssVar('--src-1'), cssVar('--src-2')], crest: cssVar('--crest').split(',').map(Number), trough: cssVar('--trough').split(',').map(Number),
    panel2: cssVar('--panel-2'),
  };
}
const srcColour = (k) => colours.src[k % 2];

// ------------------------------------------------------------------------- line plots

function plotFrame(canvas, m = {}) {
  const { ctx, width, height } = fitCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height, f: new Frame(ctx, width, height, { left: 10, right: 10, top: 8, bottom: 22, ...m }) };
}

/** Time streams: each trace {s: stream, colour, dash, envelope, lane}; lanes stack them.  Time
 *  runs left to right and the stream scrolls; instead of tick labels (the cycles of a recording
 *  mean nothing) a bar shows the coherence time 1/Δν, as on the slides. */
function drawStreams(canvas, traces, { lanes = 1, labels = null } = {}) {
  const { ctx, f } = plotFrame(canvas, { left: labels ? 18 : 8, bottom: 18, top: 6 });
  const s0 = traces[0].s;
  f.x0 = s0.t0; f.x1 = s0.t1;
  // One scale for all, from the largest envelope.
  let top = 0;
  for (const { s } of traces) for (let i = 0; i < s.n; i++) top = Math.max(top, Math.hypot(s.re[i], s.im[i]));
  top = Math.max(top * Math.SQRT2, 0.3) * 1.08;
  f.y0 = -top * lanes; f.y1 = top * lanes;
  f.axes({ colors: C, yTicks: false, xTicks: false });
  scaleBar(ctx, f, 1 / bw(), `1/Δν = ${fixedCycles(1 / bw())}`);
  f.clip();
  const real = state.display === 'real';
  for (const t of traces) {
    const { s } = t, lane = t.lane || 0, off = lanes === 1 ? 0 : top * (lanes - 1 - 2 * lane);
    const X = (i) => f.X(s.t0 + ((s.t1 - s.t0) * i) / (s.n - 1));
    ctx.strokeStyle = C.line; ctx.lineWidth = 1;
    if (lanes > 1) { ctx.beginPath(); ctx.moveTo(f.left, f.Y(off)); ctx.lineTo(f.right, f.Y(off)); ctx.stroke(); }
    if (real) {
      if (t.envelope !== false) {
        ctx.strokeStyle = colours.env; ctx.lineWidth = 1;
        for (const sg of [1, -1]) line(ctx, s.n, X, (i) => f.Y(off + sg * Math.SQRT2 * Math.hypot(s.re[i], s.im[i])));
      }
      ctx.strokeStyle = t.colour; ctx.lineWidth = t.width || 1.3; ctx.setLineDash(t.dash || []);
      line(ctx, s.n, X, (i) => f.Y(off + s.x[i]));
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = t.colour; ctx.lineWidth = t.width || 1.3;
      ctx.setLineDash(t.dash || []); line(ctx, s.n, X, (i) => f.Y(off + Math.SQRT2 * s.re[i]));
      ctx.setLineDash(t.dash ? [1, 3] : [4, 3]); line(ctx, s.n, X, (i) => f.Y(off + Math.SQRT2 * s.im[i]));
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
  if (labels) {
    ctx.save(); ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    labels.forEach(([text, colour], lane) => { ctx.fillStyle = colour; ctx.fillText(text, 9, f.Y(top * (lanes - 1 - 2 * lane))); });
    ctx.restore();
  }
  return f;
}

/** A bar along the bottom of a time plot, `length` cycles long, with its label. */
function scaleBar(ctx, f, length, label) {
  const w = (length / (f.x1 - f.x0)) * f.w;
  if (!(w > 2)) return;
  const x0 = f.left + 6, y = f.bottom + 9, x1 = x0 + Math.min(w, f.w - 12);
  ctx.save();
  ctx.strokeStyle = C.ink2; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x0, y - 3); ctx.lineTo(x0, y + 3); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.moveTo(x1, y - 3); ctx.lineTo(x1, y + 3); ctx.stroke();
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = C.ink2; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(label, x1 + 6, y);
  ctx.restore();
}
const fixedCycles = (c) => (c >= 10 ? `${Math.round(c)} cycles` : c >= 1 ? `${c.toFixed(1)} cycles` : `${c.toFixed(2)} cycle`);

/** A product of two real voltages over a stretch, filled (blue above zero, red below), its mean
 *  over the stretch and the correlator's long-run average. */
function drawProduct(canvas, a, b, longRun, { scale = 0 } = {}) {
  const { ctx, f } = plotFrame(canvas, { left: 36, bottom: 18, top: 6 });
  const n = a.n, p = buf('prod', n)[0], real = state.display === 'real';
  let mean = 0, top = 0;
  for (let i = 0; i < n; i++) {
    // Real voltages: x_A x_B.  Envelopes: Re[s_A s_B*] (the complex correlator's real part).
    const v = real ? a.x[i] * b.x[i] : a.re[i] * b.re[i] + a.im[i] * b.im[i];
    p[i] = v; mean += v / n; top = Math.max(top, Math.abs(v));
  }
  top = Math.max(top, Math.abs(longRun) * 1.2, scale, 0.2) * 1.05;
  f.x0 = a.t0; f.x1 = a.t1; f.y0 = -top; f.y1 = top;
  f.axes({ colors: C, xTicks: false });
  scaleBar(ctx, f, 1 / bw(), `1/Δν`);
  f.clip();
  const X = (i) => f.X(a.t0 + ((a.t1 - a.t0) * i) / (n - 1)), Y = (i) => f.Y(p[i]);
  fillSigned(ctx, n, X, Y, f.Y(0), colours.pos, colours.neg);
  ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(f.left, f.Y(mean)); ctx.lineTo(f.right, f.Y(mean)); ctx.stroke();
  ctx.strokeStyle = C.accent; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(f.left, f.Y(longRun)); ctx.lineTo(f.right, f.Y(longRun)); ctx.stroke(); ctx.setLineDash([]);
  ctx.restore();
  return mean;
}

/** The value of a correlation array (from sim.lags) at lag τ, by linear interpolation. */
function lagValue(R, tau) {
  const n = R[0].length, tm = R.tauMax, x = ((tau + tm) / (2 * tm)) * (n - 1);
  const i = Math.max(0, Math.min(n - 2, Math.floor(x))), fr = x - i;
  return [R[0][i] * (1 - fr) + R[0][i + 1] * fr, R[1][i] * (1 - fr) + R[1][i + 1] * fr];
}
/** The real voltages' correlation from the envelopes': Re[R(τ) e^{−2πiν₀τ}]. */
const realCorr = (z, tau) => z[0] * Math.cos(TWO_PI * tau) + z[1] * Math.sin(TWO_PI * tau);

/** Correlations against lag: series [{key, colour, faint}], a marker and a dot.  scale: the
 *  smallest half-height of the plot (so that a correlation near zero looks near zero). */
function drawLags(canvas, series, { marker = null, dotAt = null, tmax = lagMax(), scale = 0, xlabel = null } = {}) {
  const { ctx, width, f } = plotFrame(canvas, { left: 36, bottom: xlabel ? 34 : 22 });
  const pts = Math.max(201, Math.min(2001, Math.round(width * 2) | 1));
  sim.lags(tmax, pts);
  f.x0 = -tmax; f.x1 = tmax;
  let top = 0;
  for (const s of series) { const R = sim[s.key]; for (let p = 0; p < pts; p++) top = Math.max(top, Math.hypot(R[0][p], R[1][p])); }
  top = Math.max(top * 1.12, scale, 0.05);
  f.y0 = -top; f.y1 = top;
  f.axes({ colors: C, xlabel });
  f.clip();
  const real = state.display === 'real', tau = (p) => -tmax + (2 * tmax * p) / (pts - 1), X = (p) => f.X(tau(p));
  ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(f.left, f.Y(0)); ctx.lineTo(f.right, f.Y(0)); ctx.stroke();
  for (const s of series) {
    const R = sim[s.key];
    ctx.globalAlpha = s.faint ? 0.35 : 1;
    if (real) {
      ctx.strokeStyle = colours.env; ctx.lineWidth = 1;
      for (const sg of [1, -1]) line(ctx, pts, X, (p) => f.Y(sg * Math.hypot(R[0][p], R[1][p])));
      ctx.strokeStyle = s.colour; ctx.lineWidth = 1.3;
      line(ctx, pts, X, (p) => f.Y(realCorr([R[0][p], R[1][p]], tau(p))));
    } else {
      ctx.strokeStyle = s.colour; ctx.lineWidth = 1.3;
      line(ctx, pts, X, (p) => f.Y(R[0][p]));
      ctx.setLineDash([4, 3]); line(ctx, pts, X, (p) => f.Y(R[1][p])); ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }
  if (marker !== null) {
    const x = Math.round(f.X(marker)) + 0.5;
    ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, f.top); ctx.lineTo(x, f.bottom); ctx.stroke(); ctx.setLineDash([]);
  }
  if (dotAt) {
    ctx.fillStyle = C.accent; ctx.strokeStyle = C.panel; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(f.X(dotAt[0]), f.Y(dotAt[1]), 5.5, 0, TWO_PI); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
  if (marker !== null) {
    // A handle at the top to drag.
    const x = f.X(marker);
    ctx.fillStyle = C.accent; ctx.beginPath(); ctx.moveTo(x, f.top + 9); ctx.lineTo(x - 6, f.top); ctx.lineTo(x + 6, f.top); ctx.closePath(); ctx.fill();
  }
  return f;
}

/** The two-sided spectrum of view 1 (or the envelope's), with the band's edges to drag, and a
 *  magnified look at the band when it is narrow. */
function drawSpectrum1(canvas) {
  const { ctx, width, f } = plotFrame(canvas, { left: 12, top: 12, bottom: 34 });
  const real = state.display === 'real', B = bw(), half = B / 2;
  f.x0 = real ? -2 : -1; f.x1 = -f.x0;
  let top = 0;
  for (let b = 0; b < M; b++) top = Math.max(top, sim.specAA[b]);
  f.y0 = 0; f.y1 = Math.max(top, 1e-9) * (real ? 0.5 : 1) * 1.25;
  f.axes({ colors: C, xlabel: real ? 'frequency ν, in units of ν₀' : 'frequency ν − ν₀, in units of ν₀', yTicks: false });
  f.clip();
  const binW = 1 / CYCLES;
  const bars = (map, col, scale) => {
    ctx.fillStyle = col;
    for (let b = 0; b < M; b++) {
      const v = sim.specAA[b];
      if (!v) continue;
      const q = (b < M / 2 ? b : b - M) / CYCLES;
      for (const c of map(q)) { const x0 = f.X(c - binW / 2), x1 = f.X(c + binW / 2), y = f.Y(v * scale); ctx.fillRect(x0, y, Math.max(1, x1 - x0), f.bottom - y); }
    }
  };
  // The real signal's power splits between the two halves, the negative one the mirror image.
  bars(real ? (q) => [1 + q, -1 - q] : (q) => [q], colours.src[0], real ? 0.5 : 1);
  ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
  const edges = real ? [1 + half, 1 - half, -1 + half, -1 - half] : [half, -half];
  for (const c of edges) { const x = Math.round(f.X(c)) + 0.5; ctx.beginPath(); ctx.moveTo(x, f.top); ctx.lineTo(x, f.bottom); ctx.stroke(); }
  ctx.setLineDash([]);
  ctx.restore();
  // The handle on the upper edge of the positive band.
  const hx = f.X(real ? 1 + half : half);
  ctx.fillStyle = C.accent; ctx.beginPath(); ctx.moveTo(hx, f.top + 9); ctx.lineTo(hx - 6, f.top - 1); ctx.lineTo(hx + 6, f.top - 1); ctx.closePath(); ctx.fill();
  // Words for the two halves of the real spectrum.
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = C.ink2; ctx.textBaseline = 'top';
  if (real) {
    ctx.textAlign = 'left'; ctx.fillText('the band at +ν₀', Math.min(f.X(1) + 8, f.right - 90), f.top + 4);
    ctx.textAlign = 'right'; ctx.fillText('its mirror image at −ν₀', Math.max(f.X(-1) - 8, f.left + 130), f.top + 4);
    ctx.textAlign = 'center'; ctx.fillText('nothing at 0', f.X(0), f.top + 4);
  }
  // The band magnified, when it is too narrow to see its shape.
  if (B < 0.3 && width > 260) {
    const w = Math.min(150, width * 0.32), h = (f.bottom - f.top) * 0.6, x0 = real ? f.X(0) - w / 2 : f.right - w - 6, y0 = f.top + (real ? 26 : 8);
    ctx.save();
    ctx.fillStyle = C.panel; ctx.strokeStyle = C.line; ctx.fillRect(x0, y0, w, h); ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
    const lo = -1.6 * half, hi = 1.6 * half, Xi = (q) => x0 + ((q - lo) / (hi - lo)) * w;
    ctx.fillStyle = colours.src[0];
    for (let b = 0; b < M; b++) {
      const v = sim.specAA[b];
      if (!v) continue;
      const q = (b < M / 2 ? b : b - M) / CYCLES, yy = y0 + h - 4 - (v / Math.max(top, 1e-12)) * (h - 18);
      ctx.fillRect(Xi(q - binW / 2) + 0.5, yy, Math.max(1, Xi(q + binW / 2) - Xi(q - binW / 2) - 1), y0 + h - 4 - yy);
    }
    ctx.strokeStyle = C.accent; ctx.setLineDash([3, 3]);
    for (const q of [-half, half]) { ctx.beginPath(); ctx.moveTo(Xi(q), y0 + 12); ctx.lineTo(Xi(q), y0 + h); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.fillStyle = C.ink2; ctx.font = '10.5px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(real ? 'the band at +ν₀, magnified' : 'the band, magnified', x0 + w / 2, y0 + 2);
    ctx.restore();
  }
  return f;
}

/** The spectra across the band (A, B as lines) and the cross-spectrum A·B* as bars coloured by
 *  its phase: a delay winds the phase across the band. */
function drawBandSpectra(canvas) {
  const { ctx, f } = plotFrame(canvas, { left: 10, top: 10 });
  const B = bw(), half = B / 2, h = bandHalf(state.band, CYCLES);
  f.x0 = -1.25 * half; f.x1 = 1.25 * half;
  let top = 0;
  for (let q = -h; q <= h; q++) { const b = (q + M) % M; top = Math.max(top, sim.specAA[b], sim.specBB[b], Math.hypot(sim.specAB[0][b], sim.specAB[1][b])); }
  f.y0 = 0; f.y1 = Math.max(top, 1e-9) * 1.15;
  f.axes({ colors: C, yTicks: false, xTicks: true });
  f.clip();
  const dq = 1 / CYCLES, R = Math.max(1e-12, top / 2);
  for (let q = -h; q <= h; q++) {
    const b = (q + M) % M, re = sim.specAB[0][b], im = sim.specAB[1][b], y = f.Y(Math.hypot(re, im));
    ctx.fillStyle = cssColorOf(re, im, R);
    ctx.fillRect(f.X(q * dq - dq / 2), y, Math.max(1, f.X(dq) - f.X(0) - (h < 60 ? 1 : 0)), f.bottom - y);
  }
  for (const [spec, col] of [[sim.specAA, colours.a], [sim.specBB, colours.b]]) {
    ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let q = -h; q <= h; q++) { const x = f.X(q * dq), y = f.Y(spec[(q + M) % M]); q === -h ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.stroke();
  }
  ctx.restore();
}

// ------------------------------------------------------------------------- view 1 · one source

const v1 = { mean: 0, longRun: 0 };
function drawOne() {
  const W = windowCycles(), T = anim.t, P = Math.max(200, Math.min(2400, Math.round(W * 8))), tau = state.lag;
  ensureTapes();
  const self = state.partner === 'self';
  const a = stream('x1', [{ tape: tapes.src[0], delay: 0, amp: 1 }], null, 0, T - W, T, P);
  const b = stream('x2', [{ tape: self ? tapes.src[0] : tapes.src[1], delay: 0, amp: 1 }], null, 0, T - W + tau, T + tau, P);
  // The copy is drawn against the same times as the original: x(t + τ) above t.
  const copy = { ...b, t0: a.t0, t1: a.t1 };
  drawStreams($('#stream1'), [
    { s: a, colour: colours.src[0], width: 1.4 },
    { s: copy, colour: self ? C.ink : colours.src[1], dash: [5, 3], envelope: false, width: 1.1 },
  ]);
  const tm = lagMax();
  sim.lags(tm, 1201);
  const R = sim[self ? 'lagAA' : 'lagAB'], z = lagValue(R, tau), rt = state.display === 'real' ? realCorr(z, tau) : z[0];
  v1.longRun = rt;
  v1.mean = drawProduct($('#product1'), a, copy, rt, { scale: 2 });
  drawSpectrum1($('#spec1'));
  // Two independent noises: their correlation, on the scale of one noise's autocorrelation (faint).
  drawLags($('#lag1'), self ? [{ key: 'lagAA', colour: colours.src[0] }] : [{ key: 'lagAA', colour: colours.src[0], faint: true }, { key: 'lagAB', colour: colours.src[1] }],
    { marker: tau, dotAt: [tau, rt], tmax: tm, xlabel: 'lag τ, in cycles of the carrier' });
}

function readoutOne() {
  const B = bw(), dn = B * nu0(), tc = 1 / B, self = state.partner === 'self', tau = state.lag;
  setGroups($('#spec1-foot'), [['Band Δν =', { v: B * 100, dec: 1, w: 5 }, '% of ν₀'], ['=', { v: dn / 1e6, dec: 1, w: 6 }, ` MHz at ${freqText()};`], ['coherence time 1/Δν =', { v: tc, dec: 1, w: 5 }, ' cycles'], ['=', { v: (tc / nu0()) * 1e9, dec: 1, w: 5 }, ' ns']]);
  setGroups($('#lag1-foot'), [['Lag τ =', { v: tau, dec: 2, w: 7 }, ' cycles'], ['=', { v: (tau / nu0()) * 1e9, dec: 2, w: 7 }, ' ns:'], [self ? 'R(τ) =' : 'their correlation =', { v: v1.longRun, dec: 2, w: 5 }]]);
  setGroups($('#product1-foot'), [['The average of this stretch:', { v: v1.mean, dec: 2, w: 5 }, ';'], ['the correlator’s long average:', { v: v1.longRun, dec: 2, w: 5 }, self ? ', the dot on R(τ)' : ', zero in the end']]);
}

// ------------------------------------------------------------------------- view 2 · the scene

const scene = { W: 0, H: 0, groundY: 0, cx: 0, xScale: 1, arcR: 0 };
const sceneX = (m) => scene.cx + m * scene.xScale;
function sourcePoint(theta) { const a = theta * DEG; return [scene.cx + scene.arcR * Math.sin(a), scene.groundY - scene.arcR * Math.cos(a)]; }
let fieldImg = null;

function drawScene() {
  const canvas = $('#scene'), { ctx, width, height } = fitCanvas(canvas);
  Object.assign(scene, { W: width, H: height, groundY: height - 30, cx: width / 2 });
  scene.xScale = (width - 24) / (2 * SCENE_HALF);
  scene.arcR = Math.min(scene.groundY - 16, width / 2 - 70);
  ctx.clearRect(0, 0, width, height);
  const sc = state.scene, gy = scene.groundY, L = lambda(), T = anim.t;
  // The waves of noise over the ground: the real field of each source, delayed by where it is.
  ensureTapes();
  const step = 3, nx = Math.ceil(width / step), nz = Math.ceil(gy / step);
  if (!fieldImg || fieldImg.width !== nx || fieldImg.height !== nz) fieldImg = new ImageData(nx, nz);
  const d = fieldImg.data, sig = Math.sqrt(sc.sources.reduce((s, q) => s + q.I, 0)) || 1, s2 = [0, 0];
  const srcs = sc.sources.map((s, k) => ({ sn: Math.sin(s.theta * DEG), cs: Math.cos(s.theta * DEG), amp: Math.sqrt(s.I), tape: sim.coherent ? tapes.src[0] : tapes.src[k] || tapes.src[0], ph: sim.coherent ? sim.coherentPhase * k : 0 }));
  const [cr, cg, cb] = colours.crest, [tr0, tg, tb] = colours.trough;
  for (let j = 0; j < nz; j++) {
    const z = (gy - (j + 0.5) * step) / scene.xScale;
    for (let i = 0; i < nx; i++) {
      const x = ((i + 0.5) * step - scene.cx) / scene.xScale;
      let v = 0;
      for (const s of srcs) v += voltageAt(s.tape, T + (x * s.sn + z * s.cs) / L, s.amp, s.ph, s2);
      const a = Math.min(1, Math.abs(v) / (2 * sig)), o = 4 * (j * nx + i);
      if (v >= 0) { d[o] = cr; d[o + 1] = cg; d[o + 2] = cb; } else { d[o] = tr0; d[o + 1] = tg; d[o + 2] = tb; }
      d[o + 3] = Math.round(150 * a);
    }
  }
  const off = drawScene.off || (drawScene.off = document.createElement('canvas'));
  off.width = nx; off.height = nz; off.getContext('2d').putImageData(fieldImg, 0, 0);
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.drawImage(off, 0, 0, nx * step, nz * step); ctx.restore();
  // The sky: an arc of directions, with angle ticks.
  ctx.save();
  ctx.strokeStyle = C.ink3; ctx.lineWidth = 1; ctx.globalAlpha = 0.8;
  ctx.beginPath(); ctx.arc(scene.cx, gy, scene.arcR, Math.PI + 0.35, -0.35); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let t = -60; t <= 60; t += 20) {
    const [x, y] = sourcePoint(t), a = t * DEG;
    ctx.strokeStyle = C.ink3; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 5 * Math.sin(a), y - 5 * Math.cos(a)); ctx.stroke();
    // (Not where a source's own label would cover it.)
    // (A source's label runs outward from it, over the next tick.)
    if (sc.sources.some((s) => Math.abs(s.theta - t) < 9 || (s.theta >= 0 ? t > s.theta && t - s.theta < 25 : t < s.theta && s.theta - t < 25))) continue;
    haloText(ctx, `${t}°`, x + 15 * Math.sin(a), y - 13 * Math.cos(a), { fill: C.ink2, halo: C.panel, width: 3 });
  }
  // Straight up, and the reference direction the correlator's delay points at.
  ctx.setLineDash([3, 4]); ctx.strokeStyle = C.ink3;
  ctx.beginPath(); ctx.moveTo(scene.cx, gy); ctx.lineTo(scene.cx, gy - scene.arcR + 8); ctx.stroke();
  if (sc.ref !== 0) {
    const [rx, ry] = sourcePoint(sc.ref), a = sc.ref * DEG;
    ctx.strokeStyle = state.tracking ? C.accent : C.ink3; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(scene.cx, gy); ctx.lineTo(scene.cx + (rx - scene.cx) * 0.94, gy + (ry - gy) * 0.94); ctx.stroke();
    // The label along the line, near its far end.
    ctx.save(); ctx.translate(scene.cx + (rx - scene.cx) * 0.62, gy + (ry - gy) * 0.62); ctx.rotate(a > 0 ? a - Math.PI / 2 : a + Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.font = '11px system-ui, sans-serif';
    haloText(ctx, state.tracking ? 'reference: the delay is set for here' : 'reference (delay tracking off)', 0, -3, { fill: ctx.strokeStyle, halo: C.panel });
    ctx.restore();
  }
  ctx.setLineDash([]);
  // The ground and its scale.
  ctx.strokeStyle = C.ink2; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(6, gy + 0.5); ctx.lineTo(width - 6, gy + 0.5); ctx.stroke();
  ctx.fillStyle = C.ink2; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineWidth = 1;
  for (const t of niceTicks(-SCENE_HALF, SCENE_HALF, 8)) {
    const x = sceneX(t);
    ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy + 4); ctx.stroke();
    ctx.fillText(tickLabel(t), x, gy + 6);
  }
  ctx.textAlign = 'right'; ctx.fillText('x, metres', width - 8, gy + 17);
  // The extra path to the farther antenna, for source 1: D sin θ.
  const s1 = sc.sources[0], sn = Math.sin(s1.theta * DEG), csn = Math.cos(s1.theta * DEG);
  const far = sc.xA * sn < sc.xB * sn ? 'A' : 'B', xf = far === 'A' ? sc.xA : sc.xB, xn = far === 'A' ? sc.xB : sc.xA;
  const ext = Math.abs(sc.xB - sc.xA) * Math.abs(sn);
  if (ext * scene.xScale > 4) {
    const px = sceneX(xf) + ext * sn * scene.xScale, py = gy - ext * csn * scene.xScale;
    ctx.strokeStyle = C.ink; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(sceneX(xf), gy); ctx.lineTo(px, py); ctx.stroke();
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(sceneX(xn), gy); ctx.lineTo(px, py); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    const left = (px + sceneX(xf)) / 2 < sceneX(xn);
    ctx.textAlign = left ? 'right' : 'left';
    const lx = (px + sceneX(xf)) / 2 + (left ? -10 : 10), ly = (py + gy) / 2 - 6;
    ctx.fillStyle = C.ink;
    const parts = ['D sin θ = ', { v: ext / L, dec: 3, w: 6 }, ' λ'];
    ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = C.panel; ctx.lineJoin = 'round';
    // (fillSlots has no halo: draw the text twice, the halo first.)
    ctx.fillStyle = C.panel; for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) fillSlots(ctx, parts, lx + dx, ly + dy);
    ctx.restore(); ctx.fillStyle = C.ink; fillSlots(ctx, parts, lx, ly);
  }
  // The antennas.
  for (const [x, colour, name] of [[sc.xA, colours.a, 'A'], [sc.xB, colours.b, 'B']]) dish(ctx, sceneX(x), gy, colour, name);
  // The sources, on the arc.
  sc.sources.forEach((s, k) => {
    const [x, y] = sourcePoint(s.theta);
    ctx.fillStyle = srcColour(k); ctx.strokeStyle = C.panel; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 6 + 5 * Math.sqrt(s.I), 0, TWO_PI); ctx.fill(); ctx.stroke();
    ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    const right = x >= scene.cx;
    ctx.textAlign = right ? 'left' : 'right';
    ctx.fillStyle = C.ink;
    fillSlots(ctx, [`source ${k + 1}, θ = `, { v: s.theta, dec: 1, w: 5 }, '°'], x + (right ? 15 : -15), y);
  });
  ctx.restore();
}

function dish(ctx, x, y, colour, name) {
  ctx.save();
  ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 9); ctx.stroke();
  ctx.lineWidth = 3.5; ctx.beginPath(); ctx.arc(x, y - 18, 10, 0.18 * Math.PI, 0.82 * Math.PI, false); ctx.stroke();
  ctx.font = 'bold 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  haloText(ctx, name, x, y - 25, { fill: colour, halo: C.panel });
  ctx.restore();
}

/** The fringe: the correlation against B's position (A where it is), and the power at B. */
function drawFringe() {
  const { ctx, width, f } = plotFrame($('#fringe'), { left: 38, bottom: 26, top: 10 });
  const sc = state.scene, L = lambda(), rA = { u: toWaves(sc.xA), v: 0 }, n = Math.max(200, Math.round(width));
  const xs = new Float64Array(n), re = new Float64Array(n), mag = new Float64Array(n), pw = new Float64Array(n), each = sc.sources.map(() => new Float64Array(n));
  let top = 0;
  for (let i = 0; i < n; i++) {
    const x = -SCENE_HALF + (2 * SCENE_HALF * i) / (n - 1), rB = { u: x / L, v: 0 }, V = sim.expectedAt(rA, rB);
    xs[i] = x; re[i] = V[0]; mag[i] = Math.hypot(V[0], V[1]); pw[i] = sim.powerAt(rB, 1);
    if (sc.sources.length > 1 && !sim.coherent) sc.sources.forEach((s, k) => { each[k][i] = sim.expectedAt(rA, rB, 0, 1, k)[0]; });
    top = Math.max(top, mag[i], pw[i]);
  }
  top = Math.max(top, 0.2) * 1.1;
  f.x0 = -SCENE_HALF; f.x1 = SCENE_HALF; f.y0 = -top; f.y1 = top;
  f.axes({ colors: C, xlabel: 'where B is (metres)' });
  f.clip();
  const X = (i) => f.X(xs[i]);
  ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(f.left, f.Y(0)); ctx.lineTo(f.right, f.Y(0)); ctx.stroke();
  if (sc.sources.length > 1 && !sim.coherent) sc.sources.forEach((s, k) => { ctx.strokeStyle = srcColour(k); ctx.globalAlpha = 0.6; ctx.lineWidth = 1; line(ctx, n, X, (i) => f.Y(each[k][i])); ctx.globalAlpha = 1; });
  ctx.strokeStyle = C.ink3; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
  line(ctx, n, X, (i) => f.Y(mag[i])); line(ctx, n, X, (i) => f.Y(-mag[i]));
  ctx.setLineDash([]);
  ctx.strokeStyle = colours.b; ctx.lineWidth = 1.5; line(ctx, n, X, (i) => f.Y(pw[i]));
  ctx.strokeStyle = C.ink; ctx.lineWidth = 2; line(ctx, n, X, (i) => f.Y(re[i]));
  // Where A is, and the live values where B is.
  const ax = f.X(sc.xA), bx = f.X(sc.xB);
  ctx.fillStyle = colours.a; ctx.beginPath(); ctx.moveTo(ax, f.bottom); ctx.lineTo(ax - 6, f.bottom - 10); ctx.lineTo(ax + 6, f.bottom - 10); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = colours.b; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(bx, f.top); ctx.lineTo(bx, f.bottom); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = colours.b; ctx.strokeStyle = C.panel; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(bx, f.Y(sim.powerB), 4.5, 0, TWO_PI); ctx.fill(); ctx.stroke();
  valueDot(ctx, bx, f.Y(sim.avg[0]), sim.avg[0], sim.avg[1], Math.max(1e-9, sim.sources.reduce((s, q) => s + q.I, 0) / 2), 6);
  ctx.restore();
  ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = colours.a;
  ctx.fillText('A', ax + 7, f.bottom - 13);
}

function drawTwo() {
  drawScene();
  const sc = state.scene, W = windowCycles(), T = anim.t, P = Math.max(160, Math.min(1200, Math.round(W * 8)));
  ensureTapes();
  const srcStream = (k) => stream(`s${k}`, [{ tape: sim.coherent ? tapes.src[0] : tapes.src[k], delay: 0, amp: Math.sqrt(sc.sources[k].I), phase: sim.coherent ? sim.coherentPhase * k : 0 }], null, 0, T - W, T, P);
  drawStreams($('#src1'), [{ s: srcStream(0), colour: srcColour(0) }]);
  $('#fig-src2').hidden = sc.sources.length < 2;
  if (sc.sources.length > 1) drawStreams($('#src2'), [{ s: srcStream(1), colour: srcColour(1) }]);
  const rA = sim.receivers[0], rB = sim.receivers[1];
  const a = stream('vA', terms(0, rA), tapes.noise[0], Math.sqrt(sim.noise), T - W, T, P), b = stream('vB', terms(1, rB), tapes.noise[1], Math.sqrt(sim.noise), T - W, T, P);
  drawStreams($('#vA2'), [{ s: a, colour: colours.a }]);
  drawStreams($('#vB2'), [{ s: b, colour: colours.b }]);
  // (What the correlator multiplies: after its electronic delay, if it makes one.)
  const delayed = sim.tracking && sc.ref !== 0;
  $('#cap-vA2').textContent = delayed ? 'Antenna A, after the electronic delay' : 'Antenna A hears';
  $('#cap-vB2').textContent = delayed ? 'Antenna B, after the electronic delay' : 'Antenna B hears';
  drawProduct($('#prod2'), a, b, sim.avg[0]);
  drawBandSpectra($('#spec2'));
  const tm = Math.max(4, Math.min(120, 3 / bw()));
  drawLags($('#auto2'), [{ key: 'lagAA', colour: colours.a }, { key: 'lagBB', colour: colours.b, faint: true }], { tmax: tm });
  const rel = (sim.delay(1, 0)[0] - sim.trackDelay(1)) - (sim.delay(0, 0)[0] - sim.trackDelay(0));
  drawLags($('#cross2'), [{ key: 'lagAB', colour: C.ink }], { tmax: tm, marker: rel });
  // The complex plane, with each source's own term and the cross terms.
  const F = sim.sources.reduce((s, q) => s + q.I, 0);
  drawMeasured($('#plane2'), { R: F / 2, extent: planeExtent(), ideal: sim.ideal(...sim.baseline()), expected: sim.expected(), selfTerms: !sim.coherent && sim.sources.length > 1, crossTerm: !sim.coherent && sim.sources.length > 1 });
  drawFringe();
}

function readoutTwo() {
  const sc = state.scene, L = lambda(), D = sc.xB - sc.xA, dA = sim.delay(0, 0)[0], dB = sim.delay(1, 0)[0], early = dA - dB;
  const id = sim.ideal(...sim.baseline());
  setGroups($('#fringe-foot'), [
    ['A at', { v: sc.xA, dec: 2, w: 5 }, ' m, B at', { v: sc.xB, dec: 2, w: 5 }, ' m:'],
    ['separation D =', { v: D, dec: 2, w: 5 }, ' m =', { v: D / L, dec: 2, w: 6 }, ' λ;'],
    ['source 1 reaches B', { v: Math.abs(early), dec: 3, w: 6 }, early >= 0 ? ' cycles before A' : ' cycles after A'],
  ]);
  const parts = [
    ['Measured:', { v: Math.hypot(...sim.avg), dec: 2, w: 4 }, ' at', { v: phaseDeg(sim.avg), dec: 0, w: 4 }, '°;'],
    ['exact V:', { v: Math.hypot(...id), dec: 2, w: 4 }, ' at', { v: phaseDeg(id), dec: 0, w: 4 }, '°.'],
    ['Power at A', { v: sim.powerA, dec: 2, w: 4 }, ', at B', { v: sim.powerB, dec: 2, w: 4 }, sc.sources.length > 1 && !sim.coherent ? ';' : ''],
  ];
  if (sc.sources.length > 1 && !sim.coherent) parts.push(['the cross terms', { v: Math.hypot(...sim.avgCross), dec: 3, w: 5 }]);
  setGroups($('#plane2-foot'), parts);
}

// ------------------------------------------------------------------------- the complex plane (views 2, 3)

/** How far the complex plane reaches: past the largest correlation the sources can give, which
 *  is ΣI for incoherent sources and (Σ√I)² for coherent ones (they can add in step). */
function planeExtent() {
  const F = sim.sources.reduce((s, q) => s + q.I, 0), G = sim.sources.reduce((s, q) => s + Math.sqrt(q.I), 0) ** 2;
  return Math.max(0.5, 1.3 * (sim.coherent ? G : F));
}

/** The correlator's output: the running average as a dot in its own colour, the last chunks as a
 *  scatter, the exact V as a ring and what this band and these delays give as a cross; and, for
 *  a few sources, each one's share as arrows laid end to end (live in view 2, exact in view 3). */
function drawMeasured(canvas, { R, extent, ideal, expected, selfTerms = false, crossTerm = false, phasors = null, hbt = false }) {
  const { ctx, X, Y, area } = complexPlane(canvas, { extent, R, mode: hbt ? 'magnitude' : 'complex', C, alpha: hbt ? 0.35 : 0.55 });
  ctx.save();
  ctx.beginPath(); ctx.rect(area.x, area.y, area.s, area.s); ctx.clip();
  ctx.fillStyle = C.ink; ctx.globalAlpha = 0.45;
  for (const [a, b] of sim.history) { ctx.beginPath(); ctx.arc(X(a), Y(b), 1.7, 0, TWO_PI); ctx.fill(); }
  ctx.globalAlpha = 1;
  if (phasors) {
    let x = 0, y = 0;
    for (const [pr, pi] of phasors) {
      // In the full colour of its phase (as the source's ring on the sky).
      ctx.strokeStyle = cssColorOf(pr, pi, Math.max(1e-12, Math.hypot(pr, pi))); ctx.lineWidth = 2.5;
      ctx.save(); ctx.strokeStyle = C.panel; ctx.lineWidth = 5; ctx.globalAlpha = 0.7; arrow(ctx, X(x), Y(y), X(x + pr), Y(y + pi), 8); ctx.restore();
      arrow(ctx, X(x), Y(y), X(x + pr), Y(y + pi), 8);
      x += pr; y += pi;
    }
  }
  if (selfTerms && sim.avgSelfK) {
    let x = 0, y = 0;
    for (let k = 0; k < sim.sources.length; k++) {
      const dx = sim.avgSelfK[2 * k], dy = sim.avgSelfK[2 * k + 1];
      ctx.save(); ctx.strokeStyle = C.panel; ctx.lineWidth = 5; ctx.globalAlpha = 0.7; arrow(ctx, X(x), Y(y), X(x + dx), Y(y + dy)); ctx.restore();
      ctx.strokeStyle = srcColour(k); ctx.lineWidth = 2.5; arrow(ctx, X(x), Y(y), X(x + dx), Y(y + dy));
      x += dx; y += dy;
    }
  }
  if (crossTerm) {
    // The cross terms: a grey diamond, from the origin (they add nothing, on average).
    const cx = X(sim.avgCross[0]), cy = Y(sim.avgCross[1]);
    ctx.fillStyle = colours.cross; ctx.strokeStyle = C.panel; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx + 6, cy); ctx.lineTo(cx, cy + 6); ctx.lineTo(cx - 6, cy); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  if (ideal) ring(ctx, X(ideal[0]), Y(ideal[1]), 8, C);
  if (expected) cross(ctx, X(expected[0]), Y(expected[1]), 5, C);
  const avg = hbt ? [sim.avgHbt, 0] : sim.avg;
  valueDot(ctx, X(avg[0]), Y(avg[1]), avg[0], avg[1], R, 7);
  ctx.restore();
}

// ------------------------------------------------------------------------- views 3 and 4 · the pictures

const area = {};                      // the square of each picture, for the pointer
const uvToF = (u, v) => [0.5 + u / (2 * uvMax()), 0.5 + v / (2 * uvMax())];
const fToUv = (fx, fy) => [(fx - 0.5) * 2 * uvMax(), (fy - 0.5) * 2 * uvMax()];
const lmToF = (l, m) => [0.5 + l / fov(), 0.5 + m / fov()];
const toPx = (g, [fx, fy]) => [g.x + fx * g.s, g.y + (1 - fy) * g.s];
const fromPx = (g, x, y) => [(x - g.x) / g.s, 1 - (y - g.y) / g.s];

function skyTicks() {
  const half = angleOf(fov() / 2);
  return niceTicks(-half, half, 5).map((t) => ({ f: lmToF(angleFrom(U(), t), 0)[0], label: tickLabel(t) }));
}
function uvTicks() {
  const m = lenIn(uvMaxM());
  return {
    metres: niceTicks(-m, m, 5).map((t) => ({ f: 0.5 + t / (2 * m), label: bigTick(t) })),
    waves: niceTicks(-uvMax(), uvMax(), 4).map((t) => ({ f: 0.5 + t / (2 * uvMax()), label: fmtWaves(t) })),
  };
}

let stripesKey = '', stripesImg = null;
function drawSky() {
  const g = area.sky = squareArea($('#sky'), { left: 40, bottom: 30, top: 6, right: 8 });
  const { ctx, width, height } = g;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#000'; ctx.fillRect(g.x, g.y, g.s, g.s);
  if (skyModel.kind === 'picture') {
    const sky = skyModel.sky, img = new ImageData(NS, NS);
    let top = 0;
    for (const v of sky) top = Math.max(top, v);
    for (let i = 0; i < NS * NS; i++) { const q = Math.round(255 * Math.sqrt(sky[i] / (top || 1))); img.data[4 * i] = q; img.data[4 * i + 1] = q; img.data[4 * i + 2] = q; img.data[4 * i + 3] = 255; }
    blit(ctx, g, img, NS, true);
  }
  const [u, v] = sim.baseline(), showStripes = state.stripes && state.view === 'uv' && !state.hbt;
  // The pair's stripes: e^{−2πi(ul + vm)} over the sky, coloured by phase, and their crests.
  if (showStripes) {
    const n = 96, key = `${u}|${v}|${fov()}`;
    if (key !== stripesKey) {
      stripesKey = key;
      const re = new Float64Array(n * n), im = new Float64Array(n * n);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const l = ((i + 0.5) / n - 0.5) * fov(), m = (0.5 - (j + 0.5) / n) * fov(), a = -TWO_PI * (u * l + v * m);
        re[j * n + i] = Math.cos(a); im[j * n + i] = Math.sin(a);
      }
      stripesImg = new ImageData(n, n);
      colorize(re, im, stripesImg.data, 1, 'complex');
    }
    ctx.save(); ctx.globalAlpha = skyModel.kind === 'picture' ? 0.3 : 0.38; blit(ctx, g, stripesImg, n, true); ctx.restore();
    // Crests: u l + v m = integer.
    const b2 = u * u + v * v;
    if (b2 > 1e-12) {
      ctx.save(); ctx.beginPath(); ctx.rect(g.x, g.y, g.s, g.s); ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1;
      const b = Math.sqrt(b2), nmax = Math.ceil(b * fov() + 1), dl = -v / b, dm = u / b, L = 2 * fov();
      for (let k = -nmax; k <= nmax; k++) {
        // The crest u l + v m = k: the line through k (u, v)/b², along (−v, u).
        const l0 = (k * u) / b2, m0 = (k * v) / b2;
        const [x0, y0] = toPx(g, lmToF(l0 - dl * L, m0 - dm * L)), [x1, y1] = toPx(g, lmToF(l0 + dl * L, m0 + dm * L));
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
      ctx.restore();
    }
  }
  if (skyModel.kind === 'points') {
    const Imax = Math.max(...skyModel.sources.map((s) => s.I), 1e-9);
    skyModel.sources.forEach((s, k) => {
      const [l, m] = directions(k), [x, y] = toPx(g, lmToF(l, m)), r = 3 + 5 * Math.sqrt(s.I / Imax);
      const grd = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
      grd.addColorStop(0, 'rgba(255,250,220,0.95)'); grd.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, TWO_PI); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, Math.max(2.2, r * 0.55), 0, TWO_PI); ctx.fill();
      if (showStripes) {
        const a = -TWO_PI * (u * l + v * m);
        ctx.strokeStyle = cssColorOf(Math.cos(a), Math.sin(a), 1); ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, r + 5, 0, TWO_PI); ctx.stroke();
        ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r + 7, 0, TWO_PI); ctx.stroke();
      }
    });
  }
  const t = skyTicks(), unit = U().angle === 'deg' ? 'degrees (sin θ)' : ANGLE[U().angle][1].trim();
  pictureAxes(ctx, g, { bottom: { ticks: t, title: `l, east, ${unit} →` }, left: { ticks: t, title: 'm, north ↑' } }, C);
}

/** The colour of V in the chosen display mode (the FFT demo's menu, and a log scale). */
function colourV(re, im, data, R, mode) {
  if (state.hbt && state.view === 'uv') {
    const n = re.length, i2 = new Float64Array(n);
    for (let i = 0; i < n; i++) i2[i] = re[i] * re[i] + im[i] * im[i];
    colorize(i2, null, data, R * R, 'magnitude');
    return;
  }
  if (mode === 'log') {
    const n = re.length, lr = new Float64Array(n);
    for (let i = 0; i < n; i++) lr[i] = Math.log10(1 + (99 * Math.hypot(re[i], im[i])) / (2 * R)) / 2;
    colorize(lr, null, data, 0.5, 'magnitude');
    return;
  }
  colorize(re, im, data, R, mode);
}
/** The brightness of the uv picture (the magnitude drawn at full colour), and so of the dots in
 *  the complex plane: half the total for points; for a picture, whose V falls off fast away from
 *  the middle, half the value that 1.5% of the picture is brighter than (as the FFT demo does for
 *  transforms), but at least 0.3% of the total. */
let pictureR = 0;
const brightnessR = () => Math.max(1e-9, skyModel.kind === 'picture' && pictureR ? pictureR : totalFlux(skyModel) / 2);

function uvPicture(n) {
  if (!uvDirty && uvImage && uvImage.n === n && uvImage.mode === state.mode && uvImage.hbt === state.hbt) return uvImage;
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  idealWindow(skyModel, pix(), directions, null, uvMax(), n, n, re, im);
  if (skyModel.kind === 'picture') {
    const mags = Float64Array.from(re, (r, i) => Math.hypot(r, im[i])).sort();
    pictureR = Math.max(mags[Math.floor(0.985 * (mags.length - 1))] / 2, 0.003 * totalFlux(skyModel));
  }
  const img = new ImageData(n, n);
  colourV(re, im, img.data, brightnessR(), state.mode);
  uvImage = { n, mode: state.mode, hbt: state.hbt, img };
  uvDirty = false;
  return uvImage;
}

function uvAxes(ctx, g, { left = true } = {}) {
  const t = uvTicks();
  pictureAxes(ctx, g, {
    bottom: { ticks: t.metres, title: `Δx, ${lenUnit() === 'm' ? 'metres' : 'km'} →` },
    left: left ? { ticks: t.metres, title: `Δy, ${lenUnit() === 'm' ? 'metres' : 'km'} ↑` } : null,
    top: { ticks: t.waves, title: 'u = Δx/λ, wavelengths' },
  }, C);
}

function drawUV() {
  const g = area.uv = squareArea($('#uv'), { left: 40, bottom: 30, top: 30, right: 8 });
  const { ctx, width, height } = g;
  ctx.clearRect(0, 0, width, height);
  const n = Math.max(64, Math.min(200, Math.round(g.s * 0.6)));
  blit(ctx, g, uvPicture(n).img, n, true);
  uvAxes(ctx, g);
  ctx.save(); ctx.beginPath(); ctx.rect(g.x, g.y, g.s, g.s); ctx.clip();
  if (state.view === 'array') { drawTracks(ctx, g); ctx.restore(); return; }
  if (state.sketch) {
    // Where something has been painted, faintly outlined.
    ctx.globalAlpha = 0.5; ctx.fillStyle = '#fff';
    const du = ensureGrid().du, h = N / 2, cell = (du / (2 * uvMax())) * g.s;
    if (paint.cells && cell > 1.2) for (let q = 0; q < N; q++) for (let p = 0; p < N; p++) if (paint.S[q * N + p]) {
      const [x, y] = toPx(g, uvToF((p - h) * du, (h - q) * du));
      ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;
  }
  const [u, v] = sim.baseline(), [x, y] = toPx(g, uvToF(u, v)), [x2, y2] = toPx(g, uvToF(-u, -v));
  ctx.lineWidth = 3.5; ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.arc(x, y, 8, 0, TWO_PI); ctx.stroke();
  ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 8, 0, TWO_PI); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TWO_PI); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.arc(x2, y2, 7, 0, TWO_PI); ctx.stroke();
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.setLineDash([3, 2]); ctx.beginPath(); ctx.arc(x2, y2, 7, 0, TWO_PI); ctx.stroke(); ctx.setLineDash([]);
  ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  haloText(ctx, 'A→B', x + 11, y); haloText(ctx, 'B→A', x2 + 10, y2);
  ctx.restore();
}

function drawTracks(ctx, g) {
  computeArray();
  const L = lambda(), upto = state.earth ? Math.round(state.tNow * (tr.nt - 1)) : 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.fillStyle = '#fff'; ctx.lineWidth = 1;
  for (let p = 0; p < tr.nb; p++) {
    for (const sg of [1, -1]) {
      if (state.earth && tr.nt > 1) {
        ctx.beginPath();
        let pen = false;
        for (let k = 0; k <= upto; k++) {
          const o = p * tr.nt + k;
          if (!tr.ok[o]) { pen = false; continue; }
          const [x, y] = toPx(g, uvToF((sg * tr.u[o]) / L, (sg * tr.v[o]) / L));
          pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true;
        }
        ctx.stroke();
      }
      const o = p * tr.nt + Math.min(upto, tr.nt - 1);
      if (tr.ok[o]) { const [x, y] = toPx(g, uvToF((sg * tr.u[o]) / L, (sg * tr.v[o]) / L)); ctx.beginPath(); ctx.arc(x, y, 2, 0, TWO_PI); ctx.fill(); }
    }
  }
}

/** The sampled uv plane: V where something has been measured, black elsewhere. */
function drawSampled() {
  // (Its left margin holds the arrow to the image, so its left axis is left out.)
  const phone = window.matchMedia('(max-width: 600px)').matches;
  const g = squareArea($('#sampled'), { left: phone ? 40 : 58, bottom: 30, top: 30, right: 8 });
  const { ctx, width, height } = g;
  ctx.clearRect(0, 0, width, height);
  const G = ensureGrid();
  let S, V;
  if (state.view === 'array') { computeArray(); S = sampled.S; V = G; } else { S = paint.S; V = paintedV(); }
  const n = Math.max(64, Math.min(220, Math.round(g.s * 0.7))), re = new Float64Array(n * n), im = new Float64Array(n * n), du = G.du, h = N / 2, um = uvMax();
  for (let y = 0; y < n; y++) {
    const v = ((n / 2 - y - 0.5) / n) * 2 * um, q = Math.round(h - v / du);
    for (let x = 0; x < n; x++) {
      const u = ((x + 0.5 - n / 2) / n) * 2 * um, p = Math.round(h + u / du);
      if (p >= 0 && p < N && q >= 0 && q < N && S[q * N + p]) { re[y * n + x] = V.re[q * N + p]; im[y * n + x] = V.im[q * N + p]; }
    }
  }
  const img = new ImageData(n, n);
  colourV(re, im, img.data, brightnessR(), state.mode);
  ctx.fillStyle = '#000'; ctx.fillRect(g.x, g.y, g.s, g.s);
  blit(ctx, g, img, n, false);
  uvAxes(ctx, g, { left: phone });
}

/** A real image (the central NS x NS of an N x N grid): grey for positive, blue for negative. */
function drawImageGrid(canvas, data, { scale = null } = {}) {
  const g = squareArea(canvas, { left: 40, bottom: 30, top: 6, right: 8 });
  const { ctx, width, height } = g;
  ctx.clearRect(0, 0, width, height);
  const o = (N - NS) / 2, img = new ImageData(NS, NS);
  let top = scale;
  if (top === null) { top = 1e-12; for (let j = 0; j < NS; j++) for (let i = 0; i < NS; i++) top = Math.max(top, Math.abs(data[(j + o) * N + i + o])); }
  for (let j = 0; j < NS; j++) for (let i = 0; i < NS; i++) {
    const v = data[(j + o) * N + i + o] / top, k = 4 * (j * NS + i), q = Math.round(255 * Math.sqrt(Math.min(1, Math.abs(v))));
    if (v >= 0) { img.data[k] = q; img.data[k + 1] = q; img.data[k + 2] = q; } else { img.data[k] = 0; img.data[k + 1] = Math.round(q * 0.45); img.data[k + 2] = q; }
    img.data[k + 3] = 255;
  }
  blit(ctx, g, img, NS, true);
  const t = skyTicks();
  pictureAxes(ctx, g, { bottom: { ticks: t, title: `l, ${U().angle === 'deg' ? 'degrees' : ANGLE[U().angle][1].trim()} →` }, left: { ticks: t } }, C);
  return top;
}

function drawRecon() {
  if (state.view === 'array') {
    computeArray();
    drawImageGrid($('#recon'), state.clean ? restoredImage() : dirtyImg);
    drawImageGrid($('#beam'), beam, { scale: 1 });
  } else {
    // (The image is a 256 × 256 transform: remade every fourth frame at most while painting.)
    if (paint.stale && (!paint.image || anim.frames - anim.lastPaint >= 4 || testHold)) { anim.lastPaint = anim.frames; paintedImage(); }
    drawImageGrid($('#recon'), paint.cells && paint.image ? paint.image : new Float64Array(N * N));
  }
}

/** The ground from above: the pair (view 3) or the array's dishes (view 4). */
function drawGround() {
  const g = area.ground = squareArea($('#ground'), { left: 40, bottom: 30, top: 6, right: 8 });
  const { ctx, width, height } = g;
  ctx.clearRect(0, 0, width, height);
  const half = groundHalf(), F = (x, y) => [0.5 + x / (2 * half), 0.5 + y / (2 * half)];
  ctx.fillStyle = colours.panel2; ctx.fillRect(g.x, g.y, g.s, g.s);
  ctx.strokeStyle = C.line; ctx.lineWidth = 1;
  const [ox, oy] = toPx(g, [0.5, 0.5]);
  ctx.beginPath(); ctx.moveTo(g.x, oy + 0.5); ctx.lineTo(g.x + g.s, oy + 0.5); ctx.moveTo(ox + 0.5, g.y); ctx.lineTo(ox + 0.5, g.y + g.s); ctx.stroke();
  const m = lenIn(half), t = niceTicks(-m, m, 4).map((v) => ({ f: 0.5 + v / (2 * m), label: bigTick(v) })), unit = lenUnit() === 'm' ? 'metres' : 'km';
  pictureAxes(ctx, g, { bottom: { ticks: t, title: `east, ${unit} →` }, left: { ticks: t, title: 'north ↑' } }, C);
  ctx.save(); ctx.beginPath(); ctx.rect(g.x, g.y, g.s, g.s); ctx.clip();
  if (state.view === 'array') {
    const labelled = [];
    dishes.forEach(([e, n], i) => {
      const [x, y] = toPx(g, F(e, n));
      ctx.fillStyle = C.accent; ctx.strokeStyle = C.panel; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, TWO_PI); ctx.fill(); ctx.stroke();
      if (dishNames) {
        const near = labelled.find((q) => Math.hypot(q[0] - x, q[1] - y) < 12);
        if (near) near[2].push(dishNames[i]); else labelled.push([x, y, [dishNames[i]]]);
      }
    });
    ctx.fillStyle = C.ink2; ctx.font = '10.5px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const [x, y, names] of labelled) ctx.fillText(names.join(', '), x + 7, y);
  } else {
    const [a, b] = pairPositions(), [ax, ay] = toPx(g, F(...a)), [bx, by] = toPx(g, F(...b));
    ctx.strokeStyle = C.ink3; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
    for (const [x, y, colour, name] of [[ax, ay, colours.a, 'A'], [bx, by, colours.b, 'B']]) {
      ctx.fillStyle = colour; ctx.strokeStyle = C.panel; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, TWO_PI); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(name, x, y + 0.5);
    }
  }
  ctx.restore();
}
function groundHalf() {
  if (state.view !== 'array') return U().uvMax / 2;
  let r = 0;
  for (const [e, n] of dishes) r = Math.max(r, Math.abs(e), Math.abs(n));
  return Math.max(r * 1.15, uvMaxM() * 0.05);
}

/** The correlation as the pair slides sideways (its separation kept): flat, for incoherent
 *  sources far away; not for coherent ones, nor quite in the near field. */
/** How far the pair slides each way: as far as the ground reaches, or 1 m in the near field (as
 *  the notebook's mean X). */
const slideHalf = () => (U().nearField ? 1 : U().uvMax / 2);
function drawSlide() {
  const { ctx, width, f } = plotFrame($('#slide3'), { left: 36, bottom: 26, top: 10 });
  const p = state.pair, half = slideHalf(), n = Math.max(120, Math.round(width)), re = new Float64Array(n), im = new Float64Array(n), xs = new Float64Array(n);
  let top = 0;
  for (let i = 0; i < n; i++) {
    const c = -half + (2 * half * i) / (n - 1), A = p.fixA ? [c, p.cy] : [c - p.bx / 2, p.cy - p.by / 2], B = p.fixA ? [c + p.bx, p.cy + p.by] : [c + p.bx / 2, p.cy + p.by / 2];
    const V = sim.hbt ? (() => { const z = sim.expectedAt(posWaves(A), posWaves(B)); return [z[0] ** 2 + z[1] ** 2, 0]; })() : sim.expectedAt(posWaves(A), posWaves(B));
    xs[i] = c; re[i] = V[0]; im[i] = V[1]; top = Math.max(top, Math.hypot(V[0], V[1]));
  }
  const F = totalFlux(skyModel), avg = sim.hbt ? [sim.avgHbt, 0] : sim.avg;
  top = Math.max(top, Math.hypot(...avg), (sim.hbt ? F * F : F) * 0.3, 0.05) * 1.15;
  f.x0 = -lenIn(half); f.x1 = lenIn(half); f.y0 = -top; f.y1 = top;
  f.axes({ colors: C, xlabel: `where the pair’s centre is (${lenUnit() === 'm' ? 'metres' : 'km'})` });
  f.clip();
  const X = (i) => f.X(lenIn(xs[i]));
  ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(f.left, f.Y(0)); ctx.lineTo(f.right, f.Y(0)); ctx.stroke();
  ctx.strokeStyle = C.ink; ctx.lineWidth = 2; line(ctx, n, X, (i) => f.Y(re[i]));
  ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]); line(ctx, n, X, (i) => f.Y(im[i])); ctx.setLineDash([]);
  const cx = f.X(lenIn(p.fixA ? p.cx + p.bx / 2 : p.cx));
  ctx.strokeStyle = C.accent; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(cx, f.top); ctx.lineTo(cx, f.bottom); ctx.stroke(); ctx.setLineDash([]);
  const R = brightnessR();
  valueDot(ctx, cx, f.Y(avg[0]), avg[0], avg[1], R, 5.5);
  ctx.fillStyle = C.panel; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, f.Y(avg[1]), 4, 0, TWO_PI); ctx.fill(); ctx.stroke();
  ctx.restore();
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = C.ink2; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('real part (solid), imaginary (dashed)', f.left + 4, f.top + 2);
}

function drawUVView() {
  $('#main').classList.toggle('sketching', state.sketch && state.view === 'uv');
  if (state.view === 'array') computeArray();
  drawSky(); drawUV(); drawGround();
  if (state.view === 'array') { drawSampled(); drawRecon(); return; }
  if (state.sketch) { drawSampled(); drawRecon(); }
  const [u, v] = sim.baseline(), ideal = idealAt(skyModel, pix(), directions, u, v), F = totalFlux(skyModel), R = brightnessR();
  let phasors = null;
  if (skyModel.kind === 'points' && skyModel.sources.length <= 8 && !sim.coherent && !sim.hbt) phasors = skyModel.sources.map((s, k) => { const [l, m] = directions(k), a = -TWO_PI * (u * l + v * m); return [s.I * Math.cos(a), s.I * Math.sin(a)]; });
  const G = skyModel.kind === 'points' ? skyModel.sources.reduce((s, q) => s + Math.sqrt(q.I), 0) ** 2 : F;
  drawMeasured($('#plane3'), {
    R: sim.hbt ? R * R : R, extent: Math.max(sim.hbt ? F * F : sim.coherent ? G : F, 1e-6) * 1.25, hbt: sim.hbt, phasors,
    ideal: sim.hbt ? [ideal[0] ** 2 + ideal[1] ** 2, 0] : ideal, expected: sim.hbt ? null : sim.expected(),
  });
  const W = windowCycles(), T = anim.t, P = Math.max(160, Math.min(1000, Math.round(W * 6)));
  const a = stream('vA', terms(0, sim.receivers[0]), tapes.noise[0], Math.sqrt(sim.noise), T - W, T, P);
  const b = stream('vB', terms(1, sim.receivers[1]), tapes.noise[1], Math.sqrt(sim.noise), T - W, T, P);
  drawStreams($('#streams3'), [{ s: a, colour: colours.a, lane: 0 }, { s: b, colour: colours.b, lane: 1 }], { lanes: 2, labels: [['A', colours.a], ['B', colours.b]] });
  drawBandSpectra($('#spec3'));
  drawSlide();
}

/** A length in the preset's unit, as text for a slot: "1.20 m", "12 700 km". */
function lenText(m) {
  const v = lenIn(m), a = Math.abs(v), sign = v < 0 ? '−' : '';
  return sign + (a >= 1e4 ? bigTick(a) : a >= 100 ? a.toFixed(0) : a >= 10 ? a.toFixed(1) : a.toFixed(2)) + ` ${lenUnit()}`;
}
/** An angle (a direction cosine, or a small angle) as text: "14.6°", "0.42″", "21 µas". */
function angleText(l) {
  const v = angleOf(l), a = Math.abs(v);
  return (a >= 100 ? a.toFixed(0) : a >= 10 ? a.toFixed(1) : a.toFixed(2)) + angleSym();
}
const wavesText = (x) => { const a = Math.abs(x), s = x < 0 ? '−' : ''; return s + (a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e4 ? `${(a / 1e3).toFixed(0)}k` : a >= 100 ? a.toFixed(0) : a.toFixed(1)); };

function readoutUV() {
  const [u, v] = sim.baseline(), L = lambda(), b = Math.hypot(u, v);
  if (state.view === 'array') {
    computeArray();
    const lat = (state.layout === 'eht' ? EHT_CENTRE.lat : state.lat) * DEG, [lo, hi] = baselineRange(dishes.map(([e, n]) => stationXYZ(e, n, lat)));
    setGroups($('#uv-foot'), [[{ v: dishes.length, dec: 0, w: 2 }, ' dishes make'], [{ v: tr.nb, dec: 0, w: 3 }, ' pairs:'], [{ v: 2 * tr.nb, dec: 0, w: 3 }, ' points of the uv plane at a time']]);
    setGroups($('#recon-foot'), [['Longest baseline', { text: lenText(hi), w: 10 }, ':'], ['finest detail λ/B =', { text: angleText(L / hi), w: 7 }]]);
    setGroups($('#beam-foot'), [['Shortest baseline', { text: lenText(lo), w: 10 }, ':'], ['λ/B =', { text: angleText(L / Math.max(lo, 1e-9)), w: 7 }, ', the largest scale it sees']]);
    const dropped = sampled.dropped ? [`(${sampled.dropped} beyond the grid’s edge)`] : [];
    setGroups($('#sampled-foot'), state.clean && cs ? [['CLEAN:', { v: cs.iterations, dec: 0, w: 5 }, ' steps,'], [{ v: cs.components, dec: 0, w: 4 }, ' points found']] : [[{ v: sampled.samples * 2, dec: 0, w: 6 }, ' samples'], state.earth ? `over ${state.hours} hours` : 'in a snapshot', ...dropped]);
    return;
  }
  setGroups($('#uv-foot'), [
    ['Δx =', { text: lenText(u * L), w: 9 }, ', Δy =', { text: lenText(v * L), w: 9 }, ':'],
    ['u =', { text: wavesText(u), w: 6 }, ', v =', { text: wavesText(v), w: 6 }, ' wavelengths;'],
    ['u = Δx/λ: fringes 1/|b| =', { text: angleText(Math.min(1, 1 / Math.max(b, 1e-9))), w: 7 }, ' apart on the sky'],
  ]);
  const ideal = idealAt(skyModel, pix(), directions, u, v), avg = sim.hbt ? [sim.avgHbt, 0] : sim.avg;
  setGroups($('#plane3-foot'), sim.hbt
    ? [['Measured ⟨ΔI_A ΔI_B⟩:', { v: avg[0], dec: 2, w: 5 }, ';'], ['|V|² under the ●:', { v: ideal[0] ** 2 + ideal[1] ** 2, dec: 2, w: 5 }]]
    : [['Measured:', { v: Math.hypot(...avg), dec: 2, w: 4 }, ' at', { v: phaseDeg(avg), dec: 0, w: 4 }, '°;'], ['V under the ●:', { v: Math.hypot(...ideal), dec: 2, w: 4 }, ' at', { v: phaseDeg(ideal), dec: 0, w: 4 }, '°']]);
  if (state.sketch) setGroups($('#recon-foot'), paint.cells ? [['Painted', { v: paint.cells, dec: 0, w: 5 }, ' cells with'], [{ v: paint.chunks, dec: 0, w: 6 }, ' measurements']] : ['Nothing kept yet: drag the ● on the uv plane']);
  const p = state.pair;
  setGroups($('#slide3-foot'), [['Centre at', { text: lenText(p.fixA ? p.cx + p.bx / 2 : p.cx), w: 8 }, ':'], [sim.coherent ? 'coherent sources: it changes' : U().nearField ? 'the near field: it drifts' : 'far, incoherent sources: flat']]);
}

// ------------------------------------------------------------------------- the loop

let raf = 0, needDraw = true, lastNow = 0;
function dirty() { needDraw = true; kick(); }
function kick() { if (!raf) raf = requestAnimationFrame(loop); }

/** Move time on by dt seconds: the streams scroll, the correlator averages a chunk. */
function advance(dt) {
  anim.frames++;
  if (state.view !== 'array') {
    anim.t += SPEED * windowCycles() * dt;
    const chunks = state.view === 'uv' && state.sketch ? 2 : 1;
    for (let c = 0; c < chunks; c++) {
      sim.step();
      if (state.view === 'uv' && state.sketch && anim.pen) { const [u, v] = sim.baseline(), z = sim.hbt ? [sim.chunkHbt, 0] : sim.chunk; paintAt(u, v, z[0], z[1]); }
    }
    if (state.autopilot && state.view === 'uv') autopilotStep(dt);
  } else if (anim.earthPlaying) {
    state.tNow = Math.min(1, state.tNow + dt / 6);
    arrayDirty = true;
    if (state.tNow >= 1) { anim.earthPlaying = false; earthButton.textContent = 'Turn the Earth'; }
    scheduleHash();
  }
}

/** The autopilot: a spiral out from the middle of the uv plane, painting as it goes. */
function autopilotStep(dt) {
  anim.pilot += dt;
  const turns = 14, rMax = 0.95 * uvMaxM(), dur = 50, s = anim.pilot / dur;
  if (s >= 1) { state.autopilot = false; pilotToggle.on = false; return; }
  const r = rMax * Math.sqrt(s), phi = TWO_PI * turns * Math.sqrt(s);
  state.pair.bx = r * Math.cos(phi); state.pair.by = r * Math.sin(phi);
  movePair();
}

function loop(now) {
  raf = 0;
  const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 1 / 60;
  lastNow = now;
  const animating = !document.hidden && anim.playing && (state.view !== 'array' || anim.earthPlaying);
  if (animating && !testHold) advance(dt);
  if (needDraw || animating) { needDraw = false; drawNow(); }
  if (animating) raf = requestAnimationFrame(loop); else lastNow = 0;
}

function drawNow() {
  readColours();
  if (state.view === 'one') { drawOne(); readoutOne(); }
  else if (state.view === 'two') { drawTwo(); readoutTwo(); }
  else { drawUVView(); readoutUV(); }
}

// ------------------------------------------------------------------------- controls

const VIEWS = { one: '1 · One source', two: '2 · Two sources, two antennas', uv: '3 · The uv plane', array: '4 · Many baselines' };
const viewSeg = segmented(Object.entries(VIEWS).map(([value, label]) => ({ value, label })), state.view, (v) => setView(v), { label: 'View' });
const playButton = el('button', { type: 'button', id: 'play', title: 'Pause or run the noise and the correlator (space)', onclick: () => setPlaying(!anim.playing) }, 'Pause');
$('#view-row').append(viewSeg, playButton);
function setPlaying(on) { anim.playing = on; playButton.textContent = on ? 'Pause' : 'Run'; kick(); }
document.addEventListener('keydown', (e) => {
  if (e.key === ' ' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLSelectElement)) { e.preventDefault(); setPlaying(!anim.playing); }
});

const UV_HINTS = {
  uv: 'Drag the ● on the uv plane: the pair’s separation (its mirror ○ follows).  The live dot on the right settles on the colour under the ●; drag a source on the sky',
  array: 'Drag a dish on the ground: its baselines move in the uv plane, and the sampled plane and the image follow.  Turn on Earth rotation to sweep the tracks',
};
function setView(v) {
  state.view = v; viewSeg.value = v;
  $('#main').dataset.view = v;
  $('#hint-uv').textContent = UV_HINTS[v] || UV_HINTS.uv;
  if (v === 'array') buildArray();
  if (spatial()) buildSky();
  applySim();
  syncPanels(); dirty(); scheduleHash();
}

// The noise.
const bandSlider = slider({ label: 'Bandwidth Δν/ν₀', min: 0.01, max: 2, log: true, value: state.band, title: 'The band the receivers pass, as a fraction of the carrier ν₀; 2 is white noise (0 to 2ν₀)',
  onInput: (v) => { setBand(v); } });
function setBand(v) { state.band = v; sim.band = v; sim.reset(); tapes.key = ''; uvDirty = true; dirty(); scheduleHash(); }
const noiseSlider = slider({ label: 'Receiver noise', min: 0, max: 3, step: 0.05, value: state.noise, title: 'Each antenna’s own noise power (a source of brightness 1 sends power 1): it is not correlated between the antennas',
  onInput: (v) => { state.noise = v; sim.noise = state.view === 'one' ? 0 : v; dirty(); scheduleHash(); } });
const avgSlider = slider({ label: 'Averaging', min: 2, max: 300, log: true, value: state.avg, title: 'The running average’s time constant, in chunks of 512 cycles (one chunk a frame): the longer, the steadier the dot, the slower it follows',
  onInput: (v) => { state.avg = v; sim.alpha = 1 / v; dirty(); scheduleHash(); } });
$('#signal-box').append(bandSlider, noiseSlider, avgSlider);
const displaySeg = segmented([
  { value: 'real', label: 'Real voltage', title: 'The voltage x(t) = √2 Re[s e^{2πiν₀t}], its two-sided spectrum and its oscillating correlations' },
  { value: 'complex', label: 'Complex envelope', title: 'The envelope s(t), I and Q, that the receiver mixes the signal down to: one band at zero frequency' },
], state.display, (v) => { state.display = v; dirty(); scheduleHash(); }, { label: 'Show' });
$('#signal-row').append(displaySeg);
const partnerSeg = segmented([
  { value: 'self', label: 'Itself, τ later', title: 'Multiply the noise by a copy of itself shifted by τ: its autocorrelation' },
  { value: 'indep', label: 'An independent noise', title: 'Multiply the noise by a second source’s noise: they have nothing to do with each other' },
], state.partner, (v) => { state.partner = v; applySim(); dirty(); scheduleHash(); }, { label: 'Multiply it by' });
$('#corr-row').append(el('span', { class: 'small muted' }, 'Multiply by'), partnerSeg);

// The sources of view 2.
const countSeg = segmented([{ value: 1, label: 'One source' }, { value: 2, label: 'Two sources' }], state.scene.sources.length, (n) => {
  const sc = state.scene;
  if (n === 2 && sc.sources.length < 2) sc.sources.push({ theta: -25, I: 0.5 });
  if (n === 1) sc.sources.length = 1;
  applySim(); syncPanels(); dirty(); scheduleHash();
}, { label: 'Sources' });
$('#scene-row').append(countSeg);
const th1Slider = slider({ label: 'Source 1 angle θ₁', min: -60, max: 60, step: 0.5, value: 10, title: 'Degrees from straight up, positive towards +x', onInput: (v) => { state.scene.sources[0].theta = v; moveScene(); dirty(); scheduleHash(); } });
const th2Slider = slider({ label: 'Source 2 angle θ₂', min: -60, max: 60, step: 0.5, value: -25, title: 'Degrees from straight up', onInput: (v) => { if (state.scene.sources[1]) state.scene.sources[1].theta = v; moveScene(); dirty(); scheduleHash(); } });
const i2Slider = slider({ label: 'Source 2 brightness', min: 0, max: 2, step: 0.05, value: 0.5, title: 'Relative to source 1', onInput: (v) => { if (state.scene.sources[1]) state.scene.sources[1].I = v; applySim(); dirty(); scheduleHash(); } });
$('#scene-box').append(th1Slider, th2Slider, i2Slider);
const coh2Toggle = toggle('Coherent sources', state.coherent, (on) => setCoherent(on), 'Feed both sources the same noise, as if from one transmitter');
const cohSlider2 = slider({ label: 'Phase between them', min: 0, max: 360, step: 5, value: state.cohPhase, title: 'Degrees between one coherent source and the next', onInput: (v) => setCohPhase(v) });
$('#coh2-row').append(coh2Toggle);
$('#coh2-row').after(cohSlider2);
function setCoherent(on) { state.coherent = on; applySim(); syncPanels(); uvDirty = true; dirty(); scheduleHash(); }
function setCohPhase(v) { state.cohPhase = v; sim.coherentPhase = v * DEG; sim.reset(); syncPanels(); dirty(); scheduleHash(); }

// The antennas (views 2 and 3).
const sepSlider = slider({ label: 'Separation D', min: -8, max: 8, step: 0.01, value: 0.2, title: 'B’s position less A’s, metres',
  onInput: (v) => { const sc = state.scene; sc.xB = Math.max(-SCENE_HALF, Math.min(SCENE_HALF, sc.xA + v)); moveScene(); dirty(); scheduleHash(); } });
const refSlider = slider({ label: 'Reference direction θ₀', min: -60, max: 60, step: 0.5, value: 0, title: 'The direction the correlator’s delay points at, in degrees from straight up: where the array “looks”',
  onInput: (v) => { state.scene.ref = v; moveScene(); sim.reset(); dirty(); scheduleHash(); } });
$('#pair-box').append(sepSlider, refSlider);
const trackToggle = toggle('Delay tracking', state.tracking, (on) => { state.tracking = on; sim.tracking = on; sim.reset(); dirty(); scheduleHash(); }, 'Delay one antenna by the geometric delay towards the reference direction, as a real correlator does');
const fixToggle = toggle('A fixed at the centre', state.pair.fixA, (on) => setFixA(on), 'Keep antenna A at the centre and move only B; otherwise both move, symmetrically about the centre');
$('#pair-row').append(trackToggle, fixToggle);
function setFixA(on) {
  const p = state.pair;
  if (on !== p.fixA) { const [a] = pairPositions(); if (on) { p.cx = a[0]; p.cy = a[1]; } else { p.cx = a[0] + p.bx / 2; p.cy = a[1] + p.by / 2; } }
  p.fixA = on; fixToggle.on = on; movePair(); dirty(); scheduleHash();
}

// The sky (views 3 and 4).
const pointButtons = {}, pictureButtons = {};
for (const [id, p] of Object.entries(POINT_PRESETS)) {
  const b = el('button', { type: 'button', title: p.title, 'aria-pressed': 'false', onclick: () => { state.sky.kind = 'points'; state.sky.preset = id; buildSky(); syncPanels(); dirty(); scheduleHash(); } }, p.label);
  $('#point-presets').append(b); pointButtons[id] = b;
}
for (const [id, p] of Object.entries(PICTURES)) {
  if (id === 'own') continue;
  const b = el('button', { type: 'button', title: p.title, 'aria-pressed': 'false', onclick: () => loadPicture(id) }, p.label);
  $('#picture-presets').append(b); pictureButtons[id] = b;
}
const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: true });
fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); fileInput.value = ''; });
$('#own-row').append(el('button', { type: 'button', title: PICTURES.own.title, onclick: () => fileInput.click() }, 'Your picture…'), fileInput, el('span', { class: 'small muted' }, 'or drop one on the sky, or paste'));
function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) { toast('That is not a picture'); return; }
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => { ownImage = imageToSky(img); URL.revokeObjectURL(url); loadPicture('own'); };
  img.onerror = () => { toast('Could not read that picture'); URL.revokeObjectURL(url); };
  img.src = url;
}
document.addEventListener('paste', (e) => {
  if (!spatial()) return;
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) loadFile(item.getAsFile());
});
{
  const zone = $('#sky').parentElement;
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drop'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drop'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('drop'); loadFile(e.dataTransfer.files[0]); });
}
const sizeSlider = slider({ label: 'Size', min: 0.2, max: 2.5, log: true, value: state.sky.size, title: 'Scale the layout or the picture: larger on the sky means finer patterns in the uv plane',
  onInput: (v) => { state.sky.size = v; if (state.sky.kind === 'picture') loadPicture(state.sky.picture); else { buildSky(); dirty(); } scheduleHash(); } });
const rotSlider = slider({ label: 'Rotation', min: -180, max: 180, step: 1, value: state.sky.rotation, title: 'Turn the layout of points (degrees): the uv plane turns with it',
  onInput: (v) => { state.sky.rotation = v; buildSky(); dirty(); scheduleHash(); } });
const brightSlider = slider({ label: 'Brightness', min: 0.1, max: 3, step: 0.1, value: state.sky.bright, title: 'The brightness of every source: the size of V scales with it',
  onInput: (v) => { state.sky.bright = v; buildSky(); dirty(); scheduleHash(); } });
$('#sky-box').append(sizeSlider, rotSlider, brightSlider);
const stripesToggle = toggle('The pair’s stripes on the sky', state.stripes, (on) => { state.stripes = on; dirty(); scheduleHash(); }, 'Draw e^{−2πi(ul + vm)} over the sky: what one baseline weighs the sky with');
$('#stripes-row').append(stripesToggle);

// The Etch-a-Sketch.
const sketchToggle = toggle('Keep what you measure', state.sketch, (on) => { state.sketch = on; if (!on) { state.autopilot = false; pilotToggle.on = false; } dirty(); scheduleHash(); }, 'Paint each measurement into the sampled uv plane where the pair is, and show the image it makes');
const penToggle = toggle('Pen down', true, (on) => { anim.pen = on; }, 'Lift the pen (or hold Shift while dragging) to move the pair without painting');
const pilotToggle = toggle('Autopilot', false, (on) => { state.autopilot = on; if (on) { anim.pilot = 0; if (!state.sketch) { state.sketch = true; sketchToggle.on = true; } } dirty(); }, 'Let a spiral drive the pair out from the middle and paint the plane');
const clearButton = el('button', { type: 'button', title: 'Forget everything painted so far', onclick: () => { clearPaint(); dirty(); } }, 'Clear');
$('#sketch-row').append(sketchToggle, penToggle, pilotToggle, clearButton);

// The array (view 4).
const LAYOUTS = { two: 'Two dishes', line: 'Line of 8', y: 'A Y, like the VLA', ring: 'Ring', random: 'Random', eht: 'Earth-sized (EHT)' };
const LAYOUT_TITLES = { two: 'One pair: one baseline and its mirror', line: 'The slides’ eight dishes on a line: every spacing from 1 to 24 units', y: 'Three arms of nine, as the Very Large Array', ring: 'N dishes round a circle', random: 'N dishes thrown at random', eht: 'The nine sites of the Event Horizon Telescope in 2018, on the globe' };
const layoutButtons = {};
for (const [id, label] of Object.entries(LAYOUTS)) {
  const b = el('button', { type: 'button', title: LAYOUT_TITLES[id], 'aria-pressed': 'false', onclick: () => setLayout(id) }, label);
  $('#layouts').append(b); layoutButtons[id] = b;
}
function setLayout(id) {
  state.layout = id;
  if (id === 'eht' && state.units !== 'eht') { setUnits('eht', { quiet: true }); if (state.sky.kind === 'points') { loadPicture('ring'); } }
  buildArray(); syncPanels(); dirty(); scheduleHash();
}
const nSlider = slider({ label: 'Dishes N', min: 2, max: 30, step: 1, value: state.n, title: 'How many dishes in the ring or the random array', onInput: (v) => { state.n = Math.round(v); buildArray(); dirty(); scheduleHash(); } });
const armSlider = slider({ label: 'Spread', min: 0.05, max: 2, log: true, value: state.arm, title: 'How far the array reaches: the longest baseline sets the finest detail', onInput: (v) => { state.arm = v; buildArray(); dirty(); scheduleHash(); } });
$('#array-box').append(nSlider, armSlider);
const earthToggle = toggle('Earth rotation', state.earth, (on) => { state.earth = on; state.tNow = 1; arrayDirty = true; syncPanels(); dirty(); scheduleHash(); }, 'Let each pair sweep its track in the uv plane as the Earth turns, for the hours set below');
const earthButton = el('button', { type: 'button', title: 'Watch the tracks fill in over the observation', onclick: () => {
  if (!state.earth) { state.earth = true; syncPanels(); }
  anim.earthPlaying = !anim.earthPlaying;
  if (anim.earthPlaying) { state.tNow = 0; arrayDirty = true; }
  earthButton.textContent = anim.earthPlaying ? 'Stop' : 'Turn the Earth';
  kick(); dirty();
} }, 'Turn the Earth');
$('#earth-row').append(earthToggle, earthButton);
const hoursSlider = slider({ label: 'Hours', min: 0.5, max: 24, step: 0.5, value: state.hours, title: 'The length of the observation, centred on the source’s transit', onInput: (v) => { state.hours = v; arrayDirty = true; dirty(); scheduleHash(); } });
const decSlider = slider({ label: 'Declination δ', min: -90, max: 90, step: 1, value: state.dec, title: 'The source’s declination: the tracks are ellipses of axis ratio sin δ', onInput: (v) => { state.dec = v; arrayDirty = true; dirty(); scheduleHash(); } });
const latSlider = slider({ label: 'Latitude', min: -85, max: 85, step: 1, value: state.lat, title: 'Where on the Earth the array stands', onInput: (v) => { state.lat = v; arrayDirty = true; dirty(); scheduleHash(); } });
const weightSeg = segmented([{ value: 'natural', label: 'Natural', title: 'Every sample counts' }, { value: 'uniform', label: 'Uniform', title: 'Every sampled cell counts once: a sharper beam' }], state.weighting, (v) => { state.weighting = v; arrayDirty = true; dirty(); scheduleHash(); }, { label: 'Weighting' });
const weightRow = el('div', { class: 'row' }, el('span', { class: 'small muted' }, 'Weighting'), weightSeg);
$('#earth-box').append(hoursSlider, decSlider, latSlider, weightRow);
const cleanToggle = toggle('CLEAN', state.clean, (on) => { state.clean = on; if (on) { computeArray(); if (cs.iterations === 0) runClean(state.cleanRun); } syncPanels(); dirty(); scheduleHash(); }, 'Högbom’s CLEAN: take the dirty beam out of the image, point by point');
const stepButton = el('button', { type: 'button', title: 'One CLEAN step', onclick: () => { computeArray(); runClean(1); dirty(); } }, 'Step');
const runButton = el('button', { type: 'button', title: 'Many steps at once', onclick: () => { computeArray(); runClean(Math.max(1, state.cleanRun)); dirty(); } }, 'Run');
const resetButton = el('button', { type: 'button', title: 'Start CLEAN again from the dirty image', onclick: () => { computeArray(); cs = cleanStart(dirtyImg); restored = null; dirty(); } }, 'Reset');
$('#clean-row').append(cleanToggle, stepButton, runButton, resetButton);
const gainSlider = slider({ label: 'Loop gain', min: 0.02, max: 0.5, step: 0.01, value: state.gain, title: 'The fraction of the brightest pixel taken out at each step', onInput: (v) => { state.gain = v; scheduleHash(); } });
const stepsSlider = slider({ label: 'Steps per run', min: 10, max: 2000, log: true, value: Math.max(10, state.cleanRun), title: 'How many steps Run takes', onInput: (v) => { state.cleanRun = Math.round(v); scheduleHash(); } });
$('#clean-box').append(gainSlider, stepsSlider);

// Units.
const unitsSeg = segmented(Object.entries(UNITS).map(([value, u]) => ({ value, label: u.label, title: u.title })), state.units, (v) => setUnits(v), { label: 'Units' });
$('#units-row').append(unitsSeg);
function setUnits(id, { quiet = false } = {}) {
  state.units = id; state.nu0 = null;
  const u = UNITS[id];
  state.pair = { bx: u.uvMax * 0.15, by: u.uvMax * 0.06, cx: 0, cy: 0, fixA: state.pair.fixA };
  clearPaint();
  if (spatial()) { buildSky(); if (state.view === 'array') buildArray(); applySim(); }
  if (!quiet) { syncPanels(); dirty(); scheduleHash(); }
}

// More.
const hbtToggle = toggle('HBT: correlate intensities', state.hbt, (on) => { state.hbt = on; if (on) state.mode = 'intensity'; else if (state.mode === 'intensity') state.mode = 'complex'; applySim({ keepAverages: false }); uvDirty = true; clearPaint(); syncPanels(); dirty(); scheduleHash(); }, 'Multiply the intensities |v|² instead of the voltages, as Hanbury Brown and Twiss did: |V|² comes out, without the phase');
const coh3Toggle = toggle('Coherent sources', state.coherent, (on) => setCoherent(on), 'Feed every source the same noise, with a phase step between neighbours: the cross terms then never average away');
const cohSlider3 = slider({ label: 'Phase step', min: 0, max: 360, step: 5, value: state.cohPhase, title: 'The phase between one coherent source and the next, in degrees', onInput: (v) => setCohPhase(v) });
const nu0Slider = slider({ label: 'Carrier ν₀ (MHz)', min: 100, max: 3e5, log: true, value: 915, title: 'The centre frequency; the wavelength follows, and with it u = Δx/λ for the same separation in metres',
  onInput: (v) => { state.nu0 = v * 1e6; gridDirty = true; uvDirty = true; arrayDirty = true; applySim(); unitsNote(); dirty(); scheduleHash(); } });
$('#more-box').append(hbtToggle, coh3Toggle, cohSlider3, nu0Slider);

// The uv picture's display mode.
const modeSelect = $('#uv-mode');
for (const [k, v] of Object.entries(MODES)) if (k !== 'grey') modeSelect.append(el('option', { value: k }, v));
modeSelect.append(el('option', { value: 'log' }, 'log magnitude'));
modeSelect.addEventListener('change', () => { state.mode = modeSelect.value; uvDirty = true; dirty(); scheduleHash(); });

function unitsNote() {
  const u = U();
  $('#units-note').textContent = `${freqText()}, λ = ${lambdaText()}; separations in ${u.len === 'm' ? 'metres' : 'kilometres'}, sky angles in ${u.angle === 'deg' ? 'degrees' : u.angle === 'arcsec' ? 'arcseconds' : 'microarcseconds'}${u.nearField ? `; the sources ${u.z} m above the antennas, with the exact distances` : ''}.`;
  $('#band-note').textContent = `Δν is the band the receivers let through, a fraction of the carrier ν₀ (1% of ${freqText()} is ${+(0.01 * nu0() / 1e6).toPrecision(3)} MHz).  The noise holds together for about 1/Δν: the coherence time.`;
}

function syncPanels() {
  const s = state, sc = s.scene;
  viewSeg.value = s.view; $('#main').dataset.view = s.view;
  bandSlider.value = s.band; noiseSlider.value = s.noise; avgSlider.value = s.avg; displaySeg.value = s.display; partnerSeg.value = s.partner;
  noiseSlider.hidden = s.view === 'one'; $('#corr-row').hidden = s.view !== 'one';
  countSeg.value = sc.sources.length; th1Slider.value = sc.sources[0].theta;
  th2Slider.hidden = i2Slider.hidden = sc.sources.length < 2;
  if (sc.sources[1]) { th2Slider.value = sc.sources[1].theta; i2Slider.value = sc.sources[1].I; }
  coh2Toggle.on = coh3Toggle.on = s.coherent; cohSlider2.value = cohSlider3.value = s.cohPhase;
  cohSlider2.hidden = !s.coherent || sc.sources.length < 2; coh2Toggle.disabled = sc.sources.length < 2;
  $('#coh2-row').hidden = false;
  sepSlider.value = sc.xB - sc.xA; refSlider.value = sc.ref;
  sepSlider.hidden = refSlider.hidden = s.view !== 'two'; fixToggle.hidden = s.view !== 'uv';
  trackToggle.on = s.tracking; fixToggle.on = s.pair.fixA;
  for (const [id, b] of Object.entries(pointButtons)) b.setAttribute('aria-pressed', String(s.sky.kind === 'points' && s.sky.preset === id));
  for (const [id, b] of Object.entries(pictureButtons)) b.setAttribute('aria-pressed', String(s.sky.kind === 'picture' && s.sky.picture === id));
  rotSlider.hidden = brightSlider.hidden = s.sky.kind !== 'points';
  sizeSlider.value = s.sky.size; rotSlider.value = s.sky.rotation; brightSlider.value = s.sky.bright;
  stripesToggle.on = s.stripes; stripesToggle.hidden = s.view !== 'uv';
  sketchToggle.on = s.sketch; pilotToggle.on = s.autopilot;
  for (const [id, b] of Object.entries(layoutButtons)) b.setAttribute('aria-pressed', String(id === s.layout));
  nSlider.hidden = !(s.layout === 'ring' || s.layout === 'random'); armSlider.hidden = s.layout === 'eht';
  nSlider.value = s.n; armSlider.value = s.arm;
  earthToggle.on = s.earth; hoursSlider.hidden = decSlider.hidden = weightRow.hidden = !s.earth; latSlider.hidden = !s.earth || s.layout === 'eht';
  hoursSlider.value = s.hours; decSlider.value = s.dec; latSlider.value = s.lat; weightSeg.value = s.weighting;
  cleanToggle.on = s.clean; gainSlider.hidden = stepsSlider.hidden = stepButton.hidden = runButton.hidden = resetButton.hidden = !s.clean;
  gainSlider.value = s.gain; stepsSlider.value = Math.max(10, s.cleanRun);
  $('#recon-title').textContent = s.view === 'array' ? (s.clean ? 'CLEAN image' : 'Dirty image') : 'Image from what you kept';
  $('#sampled-title').textContent = 'Sampled uv plane';
  $('#ground-title').textContent = s.view === 'array' ? 'The array on the ground' : 'The pair on the ground';
  $('#ground-note').textContent = s.view === 'array' ? 'drag a dish' : 'drag A or B';
  $('#sky-note').textContent = s.sky.kind === 'points' ? 'drag a source' : PICTURES[s.sky.picture]?.label?.toLowerCase() || '';
  unitsSeg.value = s.units;
  hbtToggle.on = s.hbt;
  modeSelect.value = s.hbt ? 'intensity' : s.mode; modeSelect.disabled = s.hbt;
  nu0Slider.value = nu0() / 1e6;
  legends();
  unitsNote();
}

function legends() {
  const items = (list) => list.map(([sw, text]) => `<span class="key"><span class="sw ${sw}"></span>${text}</span>`).join(' ');
  $('#legend2').innerHTML = items([['dot', 'one chunk'], ['ring', 'the exact V'], ['', '× with this band, ● the running average']]) + (state.scene.sources.length > 1 && !state.coherent ? '<br>' + items([['s1', 'source 1’s share'], ['s2', 'source 2’s'], ['dot', 'grey: the cross terms']]) : '');
  $('#legend3').innerHTML = items([['dot', 'one chunk'], ['ring', 'V under the ●'], ['', '× what the correlator’s points give']]) + (skyModel.kind === 'points' && !state.coherent && !state.hbt ? '<br>arrows: each source’s share, in its stripe’s colour' : '');
}

// ------------------------------------------------------------------------- pointer interaction

function pointer(canvas, handlers) {
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    drag = handlers.down(x, y, e, r);
    if (drag) { canvas.setPointerCapture(e.pointerId); e.preventDefault(); handlers.move(drag, x, y, e, r); dirty(); }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = canvas.getBoundingClientRect();
    handlers.move(drag, e.clientX - r.left, e.clientY - r.top, e, r); dirty();
  });
  const up = (e) => { if (drag) { handlers.up?.(drag); drag = null; try { canvas.releasePointerCapture(e.pointerId); } catch { /* released already */ } scheduleHash(); dirty(); } };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
}
/** A plot's frame, rebuilt from its canvas size (to map the pointer as the drawing did). */
function frameOf(r, m, x0, x1) { const f = new Frame(null, r.width, r.height, { left: 10, right: 10, top: 8, bottom: 22, ...m }); f.x0 = x0; f.x1 = x1; return f; }

// View 1: the lag on the autocorrelation; the band's edge on the spectrum.
pointer($('#lag1'), {
  down: () => ({}),
  move: (d, x, y, e, r) => { const tm = lagMax(), f = frameOf(r, { left: 36, bottom: 34 }, -tm, tm); state.lag = Math.round(100 * Math.max(-tm, Math.min(tm, f.invX(x)))) / 100; },
});
pointer($('#spec1'), {
  down: () => ({}),
  move: (d, x, y, e, r) => {
    const real = state.display === 'real', f = frameOf(r, { left: 12, top: 12, bottom: 34 }, real ? -2 : -1, real ? 2 : 1), v = f.invX(x);
    const half = real ? Math.abs(Math.abs(v) - 1) : Math.abs(v);
    state.band = Math.max(0.01, Math.min(2, 2 * half)); bandSlider.value = state.band; sim.band = state.band; sim.reset(); tapes.key = '';
  },
});

// View 2: the sources and antennas on the scene; B on the fringe plot.
pointer($('#scene'), {
  down: (x, y) => {
    const sc = state.scene;
    for (let k = sc.sources.length - 1; k >= 0; k--) { const [sx, sy] = sourcePoint(sc.sources[k].theta); if (Math.hypot(x - sx, y - sy) < 20) return { source: k }; }
    const dA = Math.hypot(x - sceneX(sc.xA), y - scene.groundY + 14), dB = Math.hypot(x - sceneX(sc.xB), y - scene.groundY + 14);
    if (Math.min(dA, dB) < 28) return { antenna: dA < dB ? 'A' : 'B' };
    return null;
  },
  move: (d, x, y) => {
    const sc = state.scene;
    if (d.source !== undefined) {
      const a = Math.atan2(x - scene.cx, scene.groundY - y) / DEG;
      sc.sources[d.source].theta = Math.max(-60, Math.min(60, Math.round(a * 2) / 2));
    } else {
      const m = Math.round(100 * Math.max(-SCENE_HALF, Math.min(SCENE_HALF, (x - scene.cx) / scene.xScale))) / 100;
      if (d.antenna === 'A') sc.xA = m; else sc.xB = m;
    }
    moveScene(); syncPanels();
  },
});
pointer($('#fringe'), {
  down: () => ({}),
  move: (d, x, y, e, r) => { const f = frameOf(r, { left: 38, bottom: 26, top: 10 }, -SCENE_HALF, SCENE_HALF); state.scene.xB = Math.round(100 * Math.max(-SCENE_HALF, Math.min(SCENE_HALF, f.invX(x)))) / 100; moveScene(); syncPanels(); },
});

// View 3: the sources on the sky, the baseline on the uv plane, the pair on the ground, the slide.
pointer($('#sky'), {
  down: (x, y) => {
    if (skyModel.kind !== 'points' || !area.sky) return null;
    let best = -1, bd = 18;
    skyModel.sources.forEach((s, k) => { const [px, py] = toPx(area.sky, lmToF(...directions(k))); const dd = Math.hypot(x - px, y - py); if (dd < bd) { bd = dd; best = k; } });
    return best >= 0 ? { k: best } : null;
  },
  move: (d, x, y) => {
    const [fx, fy] = fromPx(area.sky, x, y), lim = fov() / 2, s = skyModel.sources[d.k];
    const l = Math.max(-lim, Math.min(lim, (fx - 0.5) * fov())), m = Math.max(-lim, Math.min(lim, (fy - 0.5) * fov()));
    if (s.z !== undefined) { const R = s.z / Math.sqrt(Math.max(1e-6, 1 - l * l - m * m)); s.x = l * R; s.y = m * R; } else { s.l = l; s.m = m; }
    gridDirty = true; uvDirty = true; arrayDirty = true; stripesKey = '';
    sim.sources = skyModel.sources.map((q) => ({ ...q }));
  },
});
pointer($('#uv'), {
  down: (x, y, e) => {
    if (state.view === 'array' || !area.uv) return null;
    const [u, v] = sim.baseline(), [px, py] = toPx(area.uv, uvToF(u, v)), [qx, qy] = toPx(area.uv, uvToF(-u, -v));
    anim.pen = !e.shiftKey && penToggle.on;
    if (state.autopilot) { state.autopilot = false; pilotToggle.on = false; }
    return { sign: Math.hypot(x - qx, y - qy) < Math.hypot(x - px, y - py) ? -1 : 1 };
  },
  move: (d, x, y, e) => {
    const [u, v] = fToUv(...fromPx(area.uv, x, y)), L = lambda(), lim = uvMaxM();
    state.pair.bx = Math.max(-lim, Math.min(lim, d.sign * u * L)); state.pair.by = Math.max(-lim, Math.min(lim, d.sign * v * L));
    anim.pen = !e.shiftKey && penToggle.on;
    movePair();
  },
  up: () => { anim.pen = penToggle.on; },
});
pointer($('#ground'), {
  down: (x, y) => {
    if (!area.ground) return null;
    const half = groundHalf(), F = (px, py) => toPx(area.ground, [0.5 + px / (2 * half), 0.5 + py / (2 * half)]);
    if (state.view === 'array') {
      let best = -1, bd = 14;
      dishes.forEach(([ex, ny], i) => { const [px, py] = F(ex, ny); const dd = Math.hypot(x - px, y - py); if (dd < bd) { bd = dd; best = i; } });
      return best >= 0 ? { i: best, half } : null;
    }
    const [a, b] = pairPositions(), [ax, ay] = F(...a), [bx, by] = F(...b), dA = Math.hypot(x - ax, y - ay), dB = Math.hypot(x - bx, y - by);
    if (Math.min(dA, dB) > 18) return null;
    return { which: dA <= dB ? 'A' : 'B', half };
  },
  move: (d, x, y) => {
    const [fx, fy] = fromPx(area.ground, x, y), px = (fx - 0.5) * 2 * d.half, py = (fy - 0.5) * 2 * d.half;
    if (d.i !== undefined) { dishes[d.i] = [px, py]; arrayDirty = true; return; }
    const [a, b] = pairPositions(), A = d.which === 'A' ? [px, py] : a, B = d.which === 'B' ? [px, py] : b, p = state.pair;
    p.bx = B[0] - A[0]; p.by = B[1] - A[1];
    if (p.fixA) { p.cx = A[0]; p.cy = A[1]; } else { p.cx = (A[0] + B[0]) / 2; p.cy = (A[1] + B[1]) / 2; }
    movePair();
  },
});
pointer($('#slide3'), {
  down: () => ({}),
  move: (d, x, y, e, r) => {
    const half = lenIn(slideHalf()), f = frameOf(r, { left: 36, bottom: 26, top: 10 }, -half, half), c = Math.max(-half, Math.min(half, f.invX(x))) * U().lenScale, p = state.pair;
    if (p.fixA) p.cx = c - p.bx / 2; else p.cx = c;
    movePair();
  },
});

// ------------------------------------------------------------------------- the address

let hashTimer = 0;
function scheduleHash() { clearTimeout(hashTimer); hashTimer = setTimeout(updateHash, 300); }
const r4 = (x) => +(+x).toPrecision(4);
function updateHash() {
  const s = state, h = { v: s.view, band: r4(s.band) };
  if (s.view !== 'one') h.noise = s.noise;
  if (s.avg !== 30) h.avg = Math.round(s.avg);
  if (s.display !== 'real') h.show = s.display;
  if (s.view === 'one') { if (s.lag) h.lag = r4(s.lag); if (s.partner !== 'self') h.with = s.partner; }
  if (s.view === 'two') { const sc = s.scene; h.th1 = sc.sources[0].theta; if (sc.sources[1]) { h.th2 = sc.sources[1].theta; h.i2 = sc.sources[1].I; } h.xa = r4(sc.xA); h.xb = r4(sc.xB); if (sc.ref) h.ref = sc.ref; }
  if (spatial()) {
    h.u = s.units;
    if (s.sky.kind === 'points') { h.src = s.sky.preset; if (s.sky.rotation) h.rot = s.sky.rotation; if (s.sky.bright !== 1) h.bright = s.sky.bright; } else if (s.sky.picture !== 'own') h.pic = s.sky.picture;
    if (s.sky.size !== 1) h.size = r4(s.sky.size);
    if (s.mode !== 'complex') h.mode = s.mode;
    if (s.nu0) h.nu0 = r4(s.nu0 / 1e6);
  }
  if (s.view === 'uv') { const p = s.pair; h.bx = r4(p.bx); h.by = r4(p.by); if (p.cx || p.cy) { h.cx = r4(p.cx); h.cy = r4(p.cy); } if (p.fixA) h.fix = 1; if (s.sketch) h.keep = 1; if (s.hbt) h.hbt = 1; if (!s.stripes) h.stripes = 0; }
  if (s.view !== 'one' && !s.tracking) h.track = 0;
  if ((s.view === 'two' || s.view === 'uv') && s.coherent) { h.coh = 1; h.cph = s.cohPhase; }
  if (s.view === 'array') { h.lay = s.layout; if (s.layout === 'ring' || s.layout === 'random') h.n = s.n; if (s.arm !== 1) h.arm = r4(s.arm); if (s.earth) { h.earth = 1; h.hours = s.hours; h.dec = s.dec; h.lat = s.lat; } if (s.weighting !== 'uniform') h.w = s.weighting; if (s.clean) { h.clean = 1; h.gain = s.gain; } }
  writeHash(h);
}

/** A saved state from the address.  Unknown keys are ignored, and the old antenna-arrays
 *  demo's synthesis states (hours, dec, sky, ...) open view 4. */
function loadHash(h) {
  const num = (k, lo, hi, d) => { const v = parseFloat(h[k]); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  state = DEFAULTS();
  const s = state;
  if (VIEWS[h.v]) s.view = h.v; else if (h.hours !== undefined || h.dec !== undefined || h.lay !== undefined || h.sky !== undefined) s.view = 'array';
  if (UNITS[h.u]) s.units = h.u;
  s.band = num('band', 0.01, 2, s.band); s.noise = num('noise', 0, 3, s.noise); s.avg = num('avg', 2, 300, s.avg);
  if (h.show === 'complex') s.display = 'complex';
  s.lag = num('lag', -300, 300, 0); if (h.with === 'indep') s.partner = 'indep';
  s.scene.sources[0].theta = num('th1', -60, 60, 10);
  if (h.th2 !== undefined) s.scene.sources.push({ theta: num('th2', -60, 60, -25), I: num('i2', 0, 2, 0.5) });
  s.scene.xA = num('xa', -SCENE_HALF, SCENE_HALF, -1); s.scene.xB = num('xb', -SCENE_HALF, SCENE_HALF, -0.8); s.scene.ref = num('ref', -60, 60, 0);
  if (POINT_PRESETS[h.src]) { s.sky.kind = 'points'; s.sky.preset = h.src; } else if (PICTURES[h.pic] && h.pic !== 'own') { s.sky.kind = 'picture'; s.sky.picture = h.pic; }
  // The arrays demo's sky names.
  if (h.sky === 'double' || h.sky === 'point') { s.sky.kind = 'points'; s.sky.preset = h.sky === 'point' ? 'one' : 'binary'; }
  else if (h.sky === 'disk' || h.sky === 'ring' || h.sky === 'portrait') { s.sky.kind = 'picture'; s.sky.picture = h.sky; }
  s.sky.size = num('size', 0.2, 2.5, 1); s.sky.rotation = num('rot', -180, 180, 0); s.sky.bright = num('bright', 0.1, 3, 1);
  if (MODES[h.mode] || h.mode === 'log') s.mode = h.mode;
  const u = UNITS[s.units];
  s.pair.bx = num('bx', -u.uvMax, u.uvMax, s.pair.bx); s.pair.by = num('by', -u.uvMax, u.uvMax, s.pair.by);
  s.pair.cx = num('cx', -u.uvMax, u.uvMax, 0); s.pair.cy = num('cy', -u.uvMax, u.uvMax, 0); s.pair.fixA = h.fix === '1';
  s.sketch = h.keep === '1'; s.tracking = h.track !== '0'; s.hbt = h.hbt === '1'; s.stripes = h.stripes !== '0';
  s.coherent = h.coh === '1'; s.cohPhase = num('cph', 0, 360, 90);
  if (h.nu0) s.nu0 = num('nu0', 100, 3e5, 915) * 1e6;
  if (LAYOUTS[h.lay]) s.layout = h.lay;
  s.n = Math.round(num('n', 2, 30, 8)); s.arm = num('arm', 0.05, 2, 1);
  s.earth = h.earth === '1' || h.hours !== undefined; s.hours = num('hours', 0.5, 24, 8); s.dec = num('dec', -90, 90, 40); s.lat = num('lat', -85, 85, 34);
  if (h.w === 'natural' || h.weighting === 'natural') s.weighting = 'natural';
  s.clean = h.clean === '1'; s.gain = num('gain', 0.02, 0.5, 0.1);
  return applyState();
}

/** Put the whole state into the controls, the sky and the simulation. */
async function applyState() {
  const s = state;
  anim.earthPlaying = false; earthButton.textContent = 'Turn the Earth';
  $('#main').dataset.view = s.view;
  $('#hint-uv').textContent = UV_HINTS[s.view] || UV_HINTS.uv;
  clearPaint();
  if (s.sky.kind === 'picture') { try { skyPicture = await pictureSky(s.sky.picture, s.sky.size, ownImage); } catch { skyPicture = null; s.sky.kind = 'points'; } }
  buildSky();
  if (s.view === 'array') buildArray();
  applySim();
  syncPanels();
  dirty();
}

// ------------------------------------------------------------------------- experiments

function setup(over, after = null) {
  state = DEFAULTS();
  const assign = (dst, src) => { for (const [k, v] of Object.entries(src)) { if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object') assign(dst[k], v); else dst[k] = v; } };
  assign(state, over);
  setPlaying(true);
  return applyState().then(() => { after?.(); scheduleHash(); dirty(); });
}
const setups = {
  noise: () => setup({ view: 'one', band: 0.05 }),
  lag: () => setup({ view: 'one', band: 0.05, lag: 0.5 }),
  white: () => setup({ view: 'one', band: 2 }),
  envelope: () => setup({ view: 'one', band: 0.05, display: 'complex', lag: 3 }),
  independent: () => setup({ view: 'one', band: 0.05, partner: 'indep', lag: 0 }),
  fringe: () => setup({ view: 'two', band: 0.05, noise: 0.3 }),
  twosources: () => setup({ view: 'two', band: 0.05, noise: 0.3, scene: { sources: [{ theta: 10, I: 1 }, { theta: -25, I: 0.5 }], xA: -1, xB: 0.6 } }),
  young: () => setup({ view: 'two', band: 0.05, noise: 0.3, coherent: true, cohPhase: 0, scene: { sources: [{ theta: 10, I: 1 }, { theta: -25, I: 0.5 }], xA: -1, xB: 0.6 } }),
  delay: () => setup({ view: 'two', band: 0.4, noise: 0.2, tracking: false, scene: { sources: [{ theta: 30, I: 1 }], xA: -1.5, xB: 1.5, ref: 30 } }),
  stripes: () => setup({ view: 'uv', band: 0.02, sky: { kind: 'points', preset: 'offset' }, pair: { bx: 1.2, by: 0.5 } }),
  uv: () => setup({ view: 'uv', band: 0.02, sky: { preset: 'pentagon' }, pair: { bx: 1.2, by: 0.5 } }),
  picture: () => setup({ view: 'uv', band: 0.02, sky: { kind: 'picture', picture: 'disk', size: 1 }, pair: { bx: 1.0, by: 0 } }),
  sketch: () => setup({ view: 'uv', band: 0.05, avg: 10, noise: 0.3, sky: { preset: 'triangle' }, sketch: true, pair: { bx: 0.8, by: 0.3 } }),
  nearfield: () => setup({ view: 'uv', units: 'benchNear', band: 0.02, sky: { preset: 'pentagon' }, pair: { bx: 2, by: 0 } }),
  coherent: () => setup({ view: 'uv', band: 0.02, sky: { preset: 'pentagon' }, coherent: true, cohPhase: 90, pair: { bx: 1.2, by: 0.5 } }),
  hbt: () => setup({ view: 'uv', band: 0.05, avg: 60, sky: { preset: 'triangle' }, hbt: true, mode: 'intensity', pair: { bx: 1.0, by: 0.6 } }),
  line: () => setup({ view: 'array', units: 'vla', sky: { preset: 'binary' }, layout: 'line', arm: 1, earth: false }),
  array: () => setup({ view: 'array', units: 'vla', sky: { kind: 'picture', picture: 'portrait' }, layout: 'y', arm: 1, earth: false }),
  rotation: () => setup({ view: 'array', units: 'vla', sky: { kind: 'picture', picture: 'portrait' }, layout: 'y', arm: 1, earth: true, hours: 8, dec: 40 }),
  resolution: () => setup({ view: 'array', units: 'vla', sky: { preset: 'binary' }, layout: 'y', arm: 0.065, earth: true, hours: 4, dec: 40 }),
  eht: () => setup({ view: 'array', units: 'eht', sky: { kind: 'picture', picture: 'ring', size: 1 }, layout: 'eht', earth: true, hours: 12, dec: 12, weighting: 'uniform' }),
  clean: () => setup({ view: 'array', units: 'vla', sky: { preset: 'binary' }, layout: 'y', arm: 0.3, earth: true, hours: 2, dec: 40, clean: true, cleanRun: 0 }),
};
// The old antenna-arrays demo's synthesis experiments (its addresses now lead here) open the
// nearest one here.
const ALIASES = {
  six: ['array'], ellipses: ['rotation', { layout: 'line', dec: 90, hours: 12 }], equator: ['rotation', { dec: 5 }], shortspacing: ['resolution', { sky: { kind: 'picture', picture: 'disk', size: 2 }, arm: 0.5 }],
};
function runSetup(name) {
  if (setups[name]) return setups[name]();
  const a = ALIASES[name];
  if (!a) return null;
  const [base, extra = {}] = a, keepSky = extra.sky;
  return setups[base]().then(() => {
    if (keepSky) state.sky = { ...state.sky, ...extra.sky };
    for (const [k, v] of Object.entries(extra)) if (k !== 'sky') state[k] = v;
    return applyState();
  });
}

const help = drawer($('#help'), $('#help-button'), setups);

// ------------------------------------------------------------------------- start

function fromAddress() {
  const h = readHash();
  if (h.setup && (setups[h.setup] || ALIASES[h.setup])) return runSetup(h.setup);
  if (Object.keys(h).length) return loadHash(h);
  return setups.noise();
}
window.addEventListener('resize', dirty);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', dirty);
document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
window.addEventListener('hashchange', fromAddress);
const ready = fromAddress();

// For the tests (tools/cdp.py) and for curious students with the console open.
window.__app = {
  sim, setups, anim, aliases: ALIASES, runSetup, ready: false,
  get state() { return state; },
  setView,
  /** Hold the clock (the tests move it themselves with step). */
  hold(on) { testHold = on; if (!on) kick(); },
  /** Move time on by n frames of 1/60 s and draw once. */
  step(n = 1) { for (let i = 0; i < n; i++) advance(1 / 60); drawNow(); },
  draw: drawNow,
  skyModel: () => skyModel,
  idealAt: (u, v) => idealAt(skyModel, pix(), directions, u, v),
  expected: () => sim.expected(),
  baseline: () => sim.baseline(),
  lambda, uvMax, fov, bandwidth: bw,
  paint: () => paint, paintedImage,
  array: () => { computeArray(); return { dishes, tr, sampled, beam, dirtyImg, cs }; },
  grid: ensureGrid,
  runClean, clearPaint, loadPicture, setBand, movePair, moveScene, applySim,
  view1: () => ({ ...v1 }),
  scene: () => ({ ...scene }), sourcePoint, sceneX,
  area: () => area,
};
Promise.resolve(ready).then(() => { window.__app.ready = true; });
