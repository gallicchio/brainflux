// Radio interferometry: the page.  Four numbered views over one simulation (sim.js): one
// source's noise; two sources and two antennas; the uv plane a pair maps; a whole array and
// the turning Earth.  The physics is in sim.js, sky.js and synthesis.js; this file is the
// pictures and the controls.

import { Simulation, M, UP, HISTORY, sinc } from './sim.js';
import {
  UNITS, ANGLE, wavelength, angleIn, angleFrom, POINT_PRESETS, pointSources, PICTURES, pictureSky, imageToSky,
  samplePoints, idealGrid, idealAt, idealWindow, pointsToGrid, totalFlux, N, NS,
} from './sky.js';
import {
  stationXYZ, tracks, gridSamples, dirtyBeam, dirtyImage, cleanStart, cleanSteps, fitBeam, restore, layout, baselineRange, EHT_CENTRE,
} from './synthesis.js';
import { colorize, colorOf, cssColorOf, MODES } from '../lib/complexcolor.js';
import { el, $, $$, slider, segmented, toggle, drawer, toast, readHash, writeHash, setSlots, fixedNum } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors, fillSlots, niceTicks, tickLabel } from '../lib/plot.js';

const DEG = Math.PI / 180;
const TWO_PI = 2 * Math.PI;
const POINTS_FOR_PICTURE = 200;     // points that stand in for a picture in the live simulation
const SRC_COLOURS = ['--src-1', '--src-2', '--good', '--warn', '--accent', '--ink-2'];

// ------------------------------------------------------------------------- state

const DEFAULTS = () => ({
  view: 'one', units: 'bench', nu0: null,
  band: 0.05, noise: 0.5, avg: 20, display: 'real',
  scene: { sources: [{ theta: 10, I: 1 }], xA: -0.5, xB: 0.5, ref: 0 },
  sky: { kind: 'points', preset: 'pentagon', picture: 'disk', size: 1, rotation: 0, bright: 1 },
  pair: { bx: 1.64, by: 0.5, cx: 0, cy: 0, fixA: false },
  tracking: true, hbt: false, coherent: false, cohPhase: 90,
  sketch: false, mode: 'complex',
  layout: 'y', n: 8, arm: 1, earth: false, hours: 8, dec: 40, lat: 34, weighting: 'uniform',
  clean: false, gain: 0.1, cleanRun: 100, tNow: 1,
});
let state = DEFAULTS();
const anim = { earthPlaying: false, pen: true, frames: 0 };
let testHold = false;

const sim = new Simulation();

// ------------------------------------------------------------------------- units

const U = () => UNITS[state.units];
const nu0 = () => state.nu0 || U().nu0;
const lambda = () => wavelength(nu0());
const toWaves = (metres) => metres / lambda();
/** The uv picture's half-extent, in metres and in wavelengths. */
const uvMaxM = () => U().uvMax;
const uvMax = () => uvMaxM() / lambda();
const fov = () => U().fov;
const pix = () => fov() / NS;
const lenUnit = () => U().len;
const lenIn = (m) => m / U().lenScale;
const angleUnit = () => ANGLE[U().angle][1].trim();
/** Parts for setSlots: a length in the preset's unit. */
const lenParts = (m, w = 6, dec = 2) => [{ v: lenIn(m), dec, w }, ` ${lenUnit()}`];
const angleParts = (l, w = 6, dec = 1) => [{ v: angleIn(U(), l), dec, w }, U().angle === 'deg' ? '°' : ` ${angleUnit()}`];
const freqText = () => { const f = nu0(); return f >= 1e9 ? `${+(f / 1e9).toPrecision(4)} GHz` : `${+(f / 1e6).toPrecision(4)} MHz`; };
const lambdaText = () => { const L = lambda(); return L >= 1 ? `${+L.toPrecision(3)} m` : L >= 0.01 ? `${+(L * 100).toPrecision(3)} cm` : `${+(L * 1000).toPrecision(3)} mm`; };

// ------------------------------------------------------------------------- the sky model

let skyModel = { kind: 'points', sources: [] };     // what the pictures show
let skyPicture = null;                              // the picture's brightness (NS x NS), when it is one
let ownImage = null;                                // the student's own picture
let grid = null;                                    // the ideal V on the N x N grid (for pictures and the array)
let uvImage = null;                                 // the uv picture, drawn at its own resolution
let uvDirty = true, gridDirty = true;

/** Direction cosines of source k of the model (near-field sources from their positions). */
function directions(k) {
  const s = skyModel.sources[k];
  if (s.z !== undefined) { const R = Math.hypot(s.x, s.y, s.z); return [s.x / R, s.y / R]; }
  return [s.l, s.m];
}

function buildSky() {
  const S = state.sky, u = U();
  if (S.kind === 'points') {
    skyModel = { kind: 'points', sources: pointSources(S.preset, { scale: u.pointScale * S.size, rotation: S.rotation * DEG, bright: S.bright, z: u.nearField ? u.z : null }) };
    skyPicture = null;
  } else {
    skyModel = { kind: 'picture', sky: skyPicture || new Float64Array(NS * NS) };
  }
  gridDirty = true; uvDirty = true;
  applySimSky();
}

/** The sources the live simulation uses: the points themselves, or points drawn from a picture. */
function applySimSky() {
  if (state.view !== 'uv' && state.view !== 'array') return;
  if (skyModel.kind === 'points') sim.sources = skyModel.sources.map((s) => ({ ...s }));
  else sim.sources = samplePoints(skyModel.sky, pix(), POINTS_FOR_PICTURE);
  sim.reset();
}

async function loadPicture(id) {
  try {
    skyPicture = await pictureSky(id, state.sky.size, id === 'own' ? ownImage : null);
  } catch (e) { toast(e.message); return; }
  state.sky.kind = 'picture'; state.sky.picture = id;
  buildSky(); syncSkyButtons(); dirty(); scheduleHash();
}

function ensureGrid() {
  if (!gridDirty && grid) return grid;
  grid = idealGrid(skyModel, pix(), directions);
  gridDirty = false;
  return grid;
}

// ------------------------------------------------------------------------- the pair and the sim

/** Receiver positions (metres) of the pair in view 3: symmetric about the centre, or A at the centre. */
function pairPositions() {
  const p = state.pair;
  if (p.fixA) return [[p.cx, p.cy], [p.cx + p.bx, p.cy + p.by]];
  return [[p.cx - p.bx / 2, p.cy - p.by / 2], [p.cx + p.bx / 2, p.cy + p.by / 2]];
}

/** Put the state into the simulation for the current view. */
function applySim() {
  sim.band = state.band; sim.alpha = 1 / state.avg; sim.lambda = lambda();
  sim.hbt = state.hbt; sim.coherent = state.coherent; sim.coherentPhase = state.cohPhase * DEG;
  sim.tracking = state.tracking; sim.nearField = false; sim.pointing = { l: 0, m: 0 };
  if (state.view === 'one') {
    sim.sources = [{ l: 0, m: 0, I: 1 }]; sim.receivers = [{ u: 0, v: 0 }, { u: 0, v: 0 }];
    sim.noise = 0; sim.streams = 0; sim.coherent = false; sim.hbt = false;
  } else if (state.view === 'two') {
    const sc = state.scene;
    sim.sources = sc.sources.map((s) => ({ l: Math.sin(s.theta * DEG), m: 0, I: s.I }));
    sim.receivers = [{ u: toWaves(sc.xA), v: 0 }, { u: toWaves(sc.xB), v: 0 }];
    sim.noise = state.noise; sim.streams = 2;
    sim.pointing = { l: Math.sin(sc.ref * DEG), m: 0 };
  } else {
    const [a, b] = pairPositions();
    sim.receivers = [{ u: toWaves(a[0]), v: toWaves(a[1]) }, { u: toWaves(b[0]), v: toWaves(b[1]) }];
    sim.noise = state.noise; sim.streams = 0; sim.nearField = U().nearField;
    applySimSky();
  }
  sim.reset();
}

// ------------------------------------------------------------------------- the array (view 4)

let dishes = [], dishNames = null, tr = null, sampled = null, beam = null, dirtyImg = null, cs = null, restored = null, fit = null;
let arrayDirty = true;

/** The array's dishes on the ground, in metres east and north. */
function buildArray() {
  const u = U();
  if (state.layout === 'eht') { const l = layout('eht'); dishes = l.dishes; dishNames = l.names; }
  else {
    const arm = state.arm * (state.layout === 'line' ? 1 : 1) * uvMaxM() * 0.45;
    const l = layout(state.layout, { arm, unit: (uvMaxM() * 0.9) / 34, n: state.n });
    dishes = l.dishes.map(([e, n]) => [e, n]); dishNames = null;
  }
  arrayDirty = true;
}

/** The tracks, the sampling, the beam and the dirty image, from the dishes and the sky. */
function computeArray() {
  if (!arrayDirty) return;
  arrayDirty = false;
  const lat = (state.layout === 'eht' ? EHT_CENTRE.lat : state.lat) * DEG;
  const pos = dishes.map(([e, n]) => stationXYZ(e, n, lat));
  tr = tracks(pos, { dec: state.dec * DEG, hours: state.earth ? state.hours : 0, steps: 121 });
  resample();
}

function resample() {
  const g = ensureGrid(), du = g.du;
  const upto = state.earth ? Math.round(state.tNow * (tr.nt - 1)) : Infinity;
  sampled = gridSamples(tr, lambda(), N, du, { upto, weighting: state.weighting });
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

const paint = { sum: [new Float64Array(N * N), new Float64Array(N * N)], count: new Float64Array(N * N), S: new Float64Array(N * N), image: null, stale: true, cells: 0 };
function clearPaint() { paint.sum[0].fill(0); paint.sum[1].fill(0); paint.count.fill(0); paint.S.fill(0); paint.image = null; paint.stale = true; paint.cells = 0; }
/** Paint a measured value at (u, v) and its conjugate at (−u, −v). */
function paintAt(u, v, re, im) {
  const g = ensureGrid(), du = g.du, h = N / 2;
  const p = Math.round(h + u / du), q = Math.round(h - v / du);
  if (p < 1 || q < 1 || p >= N - 1 || q >= N - 1) return;
  for (const [i, j, s] of [[p, q, 1], [N - p, N - q, -1]]) {
    const o = j * N + i;
    if (paint.count[o] === 0) paint.cells++;
    paint.sum[0][o] += re; paint.sum[1][o] += s * im; paint.count[o] += 1; paint.S[o] = 1;
  }
  paint.stale = true;
}
function paintedV() {
  const re = new Float64Array(N * N), im = new Float64Array(N * N);
  for (let o = 0; o < re.length; o++) if (paint.count[o]) { re[o] = paint.sum[0][o] / paint.count[o]; im[o] = paint.sum[1][o] / paint.count[o]; }
  return { re, im };
}
function paintedImage() {
  if (!paint.stale && paint.image) return paint.image;
  paint.image = dirtyImage(paint.S, paintedV(), N);
  paint.stale = false;
  return paint.image;
}

// ------------------------------------------------------------------------- drawing helpers

let C = themeColors();
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
let colours = {};
function readColours() {
  C = themeColors();
  colours = { a: cssVar('--ant-a'), b: cssVar('--ant-b'), env: cssVar('--env'), cross: cssVar('--cross'), src: SRC_COLOURS.map(cssVar) };
}

/** How many cycles the time streams show: a few coherence times, within 32..128. */
const streamCycles = () => Math.round(Math.max(32, Math.min(128, 3 / state.band)));
const lagMax = () => Math.max(6, Math.min(400, 3 / state.band));

const scratch = new Float64Array(M * UP);
/** A time stream: the real voltage (and its envelope) or I and Q. */
function drawStream(canvas, fine, colour, title, { envelope = true } = {}) {
  const { ctx, width, height } = fitCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 34, right: 8, top: 18, bottom: 22 });
  const W = streamCycles(), pts = W * 2 * UP;
  f.x0 = 0; f.x1 = W;
  let amp = 0;
  for (let i = 0; i < pts; i++) amp = Math.max(amp, Math.hypot(fine[0][i], fine[1][i]));
  amp = Math.max(amp, 0.2) * 1.15;
  f.y0 = -amp; f.y1 = amp;
  f.axes({ colors: C, xlabel: 'time (cycles)', yTicks: false });
  f.clip();
  const real = state.display === 'real';
  if (real) {
    const n = sim.realSignal(fine, W, scratch);
    if (envelope) {
      ctx.strokeStyle = colours.env; ctx.lineWidth = 1; ctx.globalAlpha = 0.8;
      for (const sgn of [1, -1]) {
        ctx.beginPath();
        for (let i = 0; i < pts; i++) { const x = f.X(i / (2 * UP)), y = f.Y(sgn * Math.hypot(fine[0][i], fine[1][i])); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = colour; ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const x = f.X(i / (2 * UP)), y = f.Y(scratch[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
  } else {
    for (const [arr, col, dash] of [[fine[0], colour, []], [fine[1], colour, [4, 3]]]) {
      ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.setLineDash(dash);
      ctx.beginPath();
      for (let i = 0; i < pts; i++) { const x = f.X(i / (2 * UP)), y = f.Y(arr[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  ctx.restore();
  ctx.fillStyle = C.ink; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(title + (real ? '' : '  (I solid, Q dashed)'), f.left + 4, 3);
}

/** Spectra: two-sided for the real signal (the band at ±ν₀), one band at 0 for the envelope. */
function drawSpectrum(canvas, specs, title, { dragEdge = false } = {}) {
  const { ctx, width, height } = fitCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  const real = state.display === 'real';
  const f = new Frame(ctx, width, height, { left: 34, right: 8, top: 18, bottom: 24 });
  f.x0 = real ? -2 : -1; f.x1 = -f.x0;
  let top = 0;
  for (const { spec } of specs) for (let b = 0; b < M; b++) top = Math.max(top, spec[b]);
  f.y0 = 0; f.y1 = Math.max(top, 1e-6) * 1.15;
  f.axes({ colors: C, xlabel: real ? 'ν / ν₀' : '(ν − ν₀) / ν₀', yTicks: false });
  f.clip();
  const bw = (2 / M) * (real ? 0.5 : 1);     // one bin's width in the plotted units
  for (const { spec, colour } of specs) {
    ctx.fillStyle = colour; ctx.globalAlpha = specs.length > 1 ? 0.55 : 0.8;
    for (let b = 0; b < M; b++) {
      if (!spec[b]) continue;
      const fq = (2 * (b < M / 2 ? b : b - M)) / M;
      const centres = real ? [1 + fq, -1 - fq] : [fq];
      for (const c of centres) {
        const x0 = f.X(c - bw / 2), x1 = f.X(c + bw / 2), y = f.Y(spec[b]);
        ctx.fillRect(x0, y, Math.max(1, x1 - x0), f.bottom - y);
      }
    }
    ctx.globalAlpha = 1;
  }
  // The band's edges, draggable in view 1.
  if (dragEdge) {
    const half = state.band / 2;
    ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    for (const c of real ? [1 + half, 1 - half, -1 + half, -1 - half] : [half, -half]) {
      const x = Math.round(f.X(c)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, f.top); ctx.lineTo(x, f.bottom); ctx.stroke();
    }
    ctx.setLineDash([]);
    // A handle on the upper edge of the band at +ν₀ (or +Δν/2).
    const hx = f.X(real ? 1 + half : half), hy = f.top + 10;
    ctx.fillStyle = C.accent; ctx.strokeStyle = C.panel; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(hx, hy + 8); ctx.lineTo(hx - 7, hy - 4); ctx.lineTo(hx + 7, hy - 4); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = C.ink; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(title, f.left + 4, 3);
}

/** Correlations against lag: the real signal's R(τ) = Re[R_s e^{2πiτ}] under its envelope, or
 *  the envelope's Re and Im. */
function drawLags(canvas, series, title, { marker = null } = {}) {
  const { ctx, width, height } = fitCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  const tmax = lagMax(), pts = Math.max(201, Math.min(1601, Math.round(width * 2) | 1));
  sim.lags(tmax, pts);
  const f = new Frame(ctx, width, height, { left: 34, right: 8, top: 18, bottom: 24 });
  f.x0 = -tmax; f.x1 = tmax;
  for (const s of series) s.data = sim[s.key];      // (made by sim.lags just now)
  let top = 0;
  for (const { data } of series) for (let p = 0; p < pts; p++) top = Math.max(top, Math.hypot(data[0][p], data[1] ? data[1][p] : 0));
  top = Math.max(top, 1e-6) * 1.15;
  f.y0 = -top; f.y1 = top;
  f.axes({ colors: C, xlabel: 'lag τ (cycles)', yTicks: false });
  f.clip();
  const real = state.display === 'real';
  ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(f.left, f.Y(0)); ctx.lineTo(f.right, f.Y(0)); ctx.stroke();
  for (const { data, colour, complex } of series) {
    const R = data;
    if (real) {
      ctx.strokeStyle = colours.env; ctx.lineWidth = 1; ctx.globalAlpha = 0.8;
      for (const sgn of [1, -1]) {
        ctx.beginPath();
        for (let p = 0; p < pts; p++) { const x = f.X(-tmax + (2 * tmax * p) / (pts - 1)), y = f.Y(sgn * Math.hypot(R[0][p], complex ? R[1][p] : 0)); p ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colour; ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let p = 0; p < pts; p++) {
        const tau = -tmax + (2 * tmax * p) / (pts - 1), c = Math.cos(TWO_PI * tau), s = Math.sin(TWO_PI * tau);
        const v = R[0][p] * c - (complex ? R[1][p] : 0) * s;
        const x = f.X(tau), y = f.Y(v); p ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    } else {
      for (const [arr, dash] of [[R[0], []], [complex ? R[1] : null, [4, 3]]]) {
        if (!arr) continue;
        ctx.strokeStyle = colour; ctx.lineWidth = 1.2; ctx.setLineDash(dash);
        ctx.beginPath();
        for (let p = 0; p < pts; p++) { const x = f.X(-tmax + (2 * tmax * p) / (pts - 1)), y = f.Y(arr[p]); p ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }
  if (marker !== null) {
    const x = Math.round(f.X(marker)) + 0.5;
    ctx.strokeStyle = C.ink3; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x, f.top); ctx.lineTo(x, f.bottom); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.restore();
  ctx.fillStyle = C.ink; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(title, f.left + 4, 3);
}

/** The brightness R of the uv picture and the complex plane: half the total brightness. */
function brightnessR() { return Math.max(1e-9, totalFlux(skyModel) / 2); }
function brightnessR2() { return Math.max(1e-9, sim.sources.reduce((a, s) => a + s.I, 0) / 2); }

/**
 * The complex plane: the running average as a big dot in its own colour (the colour the uv
 * picture would give it), the last chunk averages as a scatter, the ideal V as a ring, the
 * expected value (band, delays) as a cross, and the self and cross terms if asked.
 */
function drawPlane(canvas, { R, extent, ideal, expected, terms = false, title }) {
  const { ctx, width, height } = fitCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  const size = Math.min(width - 10, height - 24), cx = width / 2, cy = 14 + size / 2, sc = size / (2 * extent);
  const X = (re) => cx + re * sc, Y = (im) => cy - im * sc;
  // The colour wheel behind, faintly: the hue of every phase, the lightness of every magnitude.
  const n = Math.max(16, Math.round(size / 3)), img = ctx.createImageData(n, n), re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { re[j * n + i] = ((i + 0.5) / n - 0.5) * 2 * extent; im[j * n + i] = (0.5 - (j + 0.5) / n) * 2 * extent; }
  colorize(re, im, img.data, R, state.hbt ? 'magnitude' : 'complex');
  const off = document.createElement('canvas'); off.width = off.height = n;
  off.getContext('2d').putImageData(img, 0, 0);
  ctx.save(); ctx.globalAlpha = 0.5; ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, cx - size / 2, cy - size / 2, size, size); ctx.restore();
  ctx.strokeStyle = C.line; ctx.lineWidth = 1;
  ctx.strokeRect(cx - size / 2 + 0.5, cy - size / 2 + 0.5, size - 1, size - 1);
  ctx.beginPath(); ctx.moveTo(cx - size / 2, Y(0)); ctx.lineTo(cx + size / 2, Y(0)); ctx.moveTo(X(0), cy - size / 2); ctx.lineTo(X(0), cy + size / 2); ctx.stroke();
  ctx.save(); ctx.beginPath(); ctx.rect(cx - size / 2, cy - size / 2, size, size); ctx.clip();
  // The scatter of chunk averages.
  ctx.fillStyle = C.ink; ctx.globalAlpha = 0.35;
  for (const [a, b] of sim.history) { ctx.beginPath(); ctx.arc(X(a), Y(b), 1.6, 0, TWO_PI); ctx.fill(); }
  ctx.globalAlpha = 1;
  // The self terms laid end to end, and the cross terms.
  if (terms && sim.avgSelfK) {
    let ax = 0, ay = 0;
    for (let k = 0; k < sim.sources.length; k++) {
      const dx = sim.avgSelfK[2 * k], dy = sim.avgSelfK[2 * k + 1];
      ctx.strokeStyle = colours.src[k % colours.src.length]; ctx.lineWidth = 2.5;
      arrow(ctx, X(ax), Y(ay), X(ax + dx), Y(ay + dy));
      ax += dx; ay += dy;
    }
    ctx.fillStyle = colours.cross; ctx.strokeStyle = colours.cross; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(X(sim.avgCross[0]), Y(sim.avgCross[1]), 5, 0, TWO_PI); ctx.fill();
  }
  // The ideal V (ring) and the expected value (cross).
  if (ideal) { ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(ideal[0]), Y(ideal[1]), 7, 0, TWO_PI); ctx.stroke(); }
  if (expected) { ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2; const x = X(expected[0]), y = Y(expected[1]); ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x - 5, y + 5); ctx.lineTo(x + 5, y - 5); ctx.stroke(); }
  // The running average: a dot in its own colour.
  const avg = state.hbt ? [sim.avgHbt, 0] : sim.avg;
  ctx.fillStyle = cssColorOf(avg[0], avg[1], R); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(X(avg[0]), Y(avg[1]), 6, 0, TWO_PI); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(X(avg[0]), Y(avg[1]), 7.5, 0, TWO_PI); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = C.ink; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(title, 4, 2);
  ctx.fillStyle = C.ink2; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText('Re →', cx + size / 2 - 3, Y(0) - 2);
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('Im ↑', X(0) + 3, cy - size / 2 + 2);
}

function arrow(ctx, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  if (L < 4) return;
  const ux = dx / L, uy = dy / L, h = Math.min(8, L / 2);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - h * ux + 0.5 * h * uy, y1 - h * uy - 0.5 * h * ux); ctx.lineTo(x1 - h * ux - 0.5 * h * uy, y1 - h * uy + 0.5 * h * ux); ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle; ctx.fill();
}

// ------------------------------------------------------------------------- view 1

function drawOne() {
  drawStream($('#stream1'), sim.fineA, colours.src[0], 'One source: the voltage it sends (grey: its envelope)');
  drawSpectrum($('#spec1'), [{ spec: sim.specAA, colour: colours.src[0] }], 'Its spectrum (averaged)', { dragEdge: true });
  drawLags($('#lag1'), [{ key: 'lagAA', colour: colours.src[0], complex: false }], 'Its autocorrelation R(τ) = ⟨x(t) x(t + τ)⟩, grey: its envelope');
}

// ------------------------------------------------------------------------- view 2: the scene

const scene = { W: 0, H: 0, groundY: 0, arcR: 0, xScale: 1, xHalf: 6, angleScale: 1, phase: 0 };
/** The scene's geometry: the ground along the bottom, the sky an arc above it. */
function sceneGeometry(width, height) {
  const u = U();
  scene.W = width; scene.H = height;
  scene.groundY = height - 36;
  scene.xHalf = uvMaxM() / 2;
  scene.xScale = (width - 40) / (2 * scene.xHalf);
  scene.arcR = scene.groundY - 30;
  const halfDeg = Math.asin(Math.min(1, fov() / 2)) / DEG;
  scene.angleScale = Math.max(1, 50 / halfDeg);       // tiny fields are exaggerated on the screen
}
const sceneX = (m) => scene.W / 2 + m * scene.xScale;
/** Where a source at θ (degrees from straight up) is drawn, on the arc. */
function sourcePoint(theta) {
  const a = theta * scene.angleScale * DEG;
  return [scene.W / 2 + scene.arcR * Math.sin(a), scene.groundY - scene.arcR * Math.cos(a)];
}

function drawScene() {
  const canvas = $('#scene'), { ctx, width, height } = fitCanvas(canvas);
  sceneGeometry(width, height);
  ctx.clearRect(0, 0, width, height);
  const sc = state.scene, gy = scene.groundY;
  // The sky: a faint arc with angle ticks.
  ctx.save();
  ctx.strokeStyle = C.line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(width / 2, gy, scene.arcR, Math.PI, 0); ctx.stroke();
  ctx.fillStyle = C.ink3; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  const halfDeg = Math.asin(Math.min(1, fov() / 2)) / DEG;
  for (const t of niceTicks(-halfDeg, halfDeg, 6)) {
    const [x, y] = sourcePoint(t), a = t * scene.angleScale * DEG;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 5 * Math.sin(a), y - 5 * Math.cos(a)); ctx.stroke();
    ctx.fillText(U().angle === 'deg' ? `${tickLabel(t)}°` : `${tickLabel(t / ANGLE[U().angle][0] * DEG)}${angleUnit()}`, x + 12 * Math.sin(a), y - 8 * Math.cos(a));
  }
  // Straight up, and the reference direction the correlator delays towards.
  ctx.setLineDash([3, 4]); ctx.strokeStyle = C.ink3;
  ctx.beginPath(); ctx.moveTo(width / 2, gy); ctx.lineTo(width / 2, gy - scene.arcR * 0.95); ctx.stroke();
  if (sc.ref !== 0 || !state.tracking) {
    const [rx, ry] = sourcePoint(sc.ref);
    ctx.strokeStyle = state.tracking ? C.accent : C.ink3;
    ctx.beginPath(); ctx.moveTo(width / 2, gy); ctx.lineTo(width / 2 + (rx - width / 2) * 0.95, gy + (ry - gy) * 0.95); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(state.tracking ? 'reference direction (the delay points here)' : 'reference direction (tracking off)', width / 2 + (rx - width / 2) * 0.6 + 8, gy + (ry - gy) * 0.6);
  }
  ctx.setLineDash([]);
  // The wavefronts of source 1 (and 2), moving down, and the delay bracket of source 1.
  const xA = sceneX(sc.xA), xB = sceneX(sc.xB);
  sc.sources.forEach((s, k) => {
    const a = s.theta * scene.angleScale * DEG, ux = Math.sin(a), uy = -Math.cos(a);   // towards the source
    const spacing = 22, colour = colours.src[k];
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, width, gy); ctx.clip();
    ctx.strokeStyle = colour; ctx.globalAlpha = k ? 0.18 : 0.3; ctx.lineWidth = 1.5;
    const L = Math.hypot(width, height);
    for (let d = -L; d < L; d += spacing) {
      const dd = d + ((scene.phase * spacing) % spacing);
      const px = width / 2 + ux * dd, py = gy + uy * dd;
      ctx.beginPath(); ctx.moveTo(px - uy * L, py + ux * L); ctx.lineTo(px + uy * L, py - ux * L); ctx.stroke();
    }
    ctx.restore();
    if (k === 0 && Math.abs(xB - xA) > 2) {
      // The farther antenna from the source waits for the wavefront that has reached the nearer.
      const far = (xB - xA) * ux > 0 ? xA : xB, near = far === xA ? xB : xA, Dpx = Math.abs(xB - xA);
      const len = Dpx * Math.abs(ux);
      ctx.strokeStyle = C.ink; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(far, gy); ctx.lineTo(far + ux * len, gy + uy * len); ctx.stroke();
      ctx.strokeStyle = C.ink3; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(near, gy); ctx.lineTo(far + ux * len, gy + uy * len); ctx.stroke(); ctx.setLineDash([]);
      const D = Math.abs(sc.xB - sc.xA), tau = toWaves(D * Math.sin(s.theta * DEG));
      ctx.fillStyle = C.ink; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = far < near ? 'right' : 'left'; ctx.textBaseline = 'bottom';
      fillSlots(ctx, ['cτ = D sin θ = ', { v: Math.abs(tau), dec: 2, w: 5 }, ' λ'], far + ux * len * 0.5 + (far < near ? -8 : 8), gy + uy * len * 0.5 - 2);
    }
  });
  // The ground and the antennas.
  ctx.strokeStyle = C.ink2; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(10, gy + 0.5); ctx.lineTo(width - 10, gy + 0.5); ctx.stroke();
  ctx.fillStyle = C.ink2; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const t of niceTicks(-scene.xHalf, scene.xHalf, 8)) {
    const x = sceneX(t);
    ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy + 4); ctx.stroke();
    ctx.fillText(`${tickLabel(lenIn(t))}`, x, gy + 6);
  }
  ctx.textAlign = 'right'; ctx.fillText(`x, ${lenUnit()}`, width - 12, gy + 18);
  for (const [x, colour, name] of [[xA, colours.a, 'A'], [xB, colours.b, 'B']]) dish(ctx, x, gy, colour, name);
  // The sources themselves.
  sc.sources.forEach((s, k) => {
    const [x, y] = sourcePoint(s.theta);
    ctx.fillStyle = colours.src[k]; ctx.strokeStyle = C.panel; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 5 + 5 * Math.sqrt(s.I), 0, TWO_PI); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.ink; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = x < width / 2 ? 'right' : 'left'; ctx.textBaseline = 'middle';
    fillSlots(ctx, [`source ${k + 1}, θ = `, { v: s.theta, dec: 1, w: 5 }, '°'], x + (x < width / 2 ? -14 : 14), y);
  });
  ctx.restore();
}

/** A dish: a small arc with a stem, and its letter. */
function dish(ctx, x, y, colour, name) {
  ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 10); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y - 16, 9, 0.15 * Math.PI, 0.85 * Math.PI, false); ctx.lineWidth = 3; ctx.stroke();
  ctx.font = 'bold 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(name, x, y - 24);
}

function drawTwo() {
  scene.phase += 0.12;
  drawScene();
  const sc = state.scene;
  drawStream($('#src1'), sim.srcTime[0] || sim.fineA, colours.src[0], 'Source 1: what it sends');
  $('#src2-wrap').hidden = sc.sources.length < 2;
  if (sc.sources.length > 1 && sim.srcTime[1]) drawStream($('#src2'), sim.srcTime[1], colours.src[1], 'Source 2: what it sends');
  drawStream($('#vA2'), sim.fineA, colours.a, 'Antenna A hears the sources, plus its own noise');
  drawStream($('#vB2'), sim.fineB, colours.b, 'Antenna B: the same noise, delayed');
  drawSpectrum($('#spec2'), [{ spec: sim.specAA, colour: colours.a }, { spec: sim.specBB, colour: colours.b }], 'Spectra of A (blue) and B (orange)');
  drawLags($('#auto2'), [{ key: 'lagAA', colour: colours.a }, { key: 'lagBB', colour: colours.b }], 'Autocorrelations of A and B');
  const rel = relativeDelay();
  drawLags($('#cross2'), [{ key: 'lagAB', colour: C.ink, complex: true }], 'Cross-correlation ⟨v_A(t) v_B*(t + τ)⟩: peak at B’s delay', { marker: rel });
  const F = sim.sources.reduce((a, s) => a + s.I, 0);
  drawPlane($('#plane2'), { R: F / 2, extent: F * 1.25, ideal: sim.ideal(...sim.baseline()), expected: sim.expected(), terms: true, title: 'Complex plane: ⟨v_A v_B*⟩ settling (ring: ideal)' });
}

/** The delay of source 1 at B relative to A, in cycles, after tracking. */
function relativeDelay() {
  if (!sim.sources.length) return null;
  const [dA] = sim.delay(0, 0), [dB] = sim.delay(1, 0);
  return (dB - sim.trackDelay(1)) - (dA - sim.trackDelay(0));
}

// ------------------------------------------------------------------------- views 3 and 4: the pictures

/** Pixel coordinates of (u, v) wavelengths on a square picture of half-extent umax. */
function uvToPx(u, v, size) { const s = size / (2 * uvMax()); return [size / 2 + u * s, size / 2 - v * s]; }
function pxToUv(x, y, size) { const s = size / (2 * uvMax()); return [(x - size / 2) / s, (size / 2 - y) / s]; }
function lmToPx(l, m, size) { const s = size / fov(); return [size / 2 + l * s, size / 2 - m * s]; }
function pxToLm(x, y, size) { const s = size / fov(); return [(x - size / 2) / s, (size / 2 - y) / s]; }

/** Axes drawn over a square picture: ticks along the bottom and the left (and the top for a second unit). */
function pictureAxes(ctx, size, { bottom, left, top, colour = '#ddd' }) {
  ctx.save();
  ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = colour; ctx.strokeStyle = colour; ctx.lineWidth = 1; ctx.globalAlpha = 0.9;
  const tick = (ticks, where) => {
    for (const { pos, label } of ticks) {
      if (pos < 2 || pos > size - 2) continue;
      ctx.beginPath();
      if (where === 'bottom') { ctx.moveTo(pos, size); ctx.lineTo(pos, size - 5); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.stroke(); ctx.fillText(label, pos, size - 6); }
      else if (where === 'top') { ctx.moveTo(pos, 0); ctx.lineTo(pos, 5); ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.stroke(); ctx.fillText(label, pos, 6); }
      else { ctx.moveTo(0, pos); ctx.lineTo(5, pos); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.stroke(); ctx.fillText(label, 7, pos); }
    }
  };
  if (bottom) tick(bottom.ticks, 'bottom');
  if (left) tick(left.ticks, 'left');
  if (top) tick(top.ticks, 'top');
  ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  if (bottom) ctx.fillText(bottom.label, size - 4, size - 18);
  if (top) { ctx.textBaseline = 'top'; ctx.fillText(top.label, size - 4, 18); }
  if (left) { ctx.save(); ctx.translate(14, 4); ctx.rotate(Math.PI / 2); ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(left.label, 4, -2); ctx.restore(); }
  ctx.restore();
}

function angleTicks(size) {
  const half = angleIn(U(), fov() / 2), ticks = [];
  for (const t of niceTicks(-half, half, 5)) { const l = angleFrom(U(), t); ticks.push({ pos: lmToPx(l, 0, size)[0], label: tickLabel(t), l }); }
  return ticks;
}

function drawSky() {
  const canvas = $('#sky'), { ctx, width, height } = fitCanvas(canvas), size = Math.min(width, height);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
  if (skyModel.kind === 'picture') {
    const sky = skyModel.sky, img = ctx.createImageData(NS, NS);
    let top = 0;
    for (const v of sky) top = Math.max(top, v);
    for (let i = 0; i < NS * NS; i++) { const g = Math.round(255 * Math.sqrt(sky[i] / (top || 1))); img.data[4 * i] = g; img.data[4 * i + 1] = g; img.data[4 * i + 2] = g; img.data[4 * i + 3] = 255; }
    const off = document.createElement('canvas'); off.width = off.height = NS; off.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(off, 0, 0, size, size);
  } else {
    skyModel.sources.forEach((s, k) => {
      const [l, m] = directions(k), [x, y] = lmToPx(l, m, size), r = 3 + 6 * Math.sqrt(s.I / (state.sky.bright || 1));
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2);
      g.addColorStop(0, colours.src[Math.min(k, 1) === 0 && skyModel.sources.length <= 2 ? k : 0]); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2, 0, TWO_PI); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, Math.max(2, r * 0.45), 0, TWO_PI); ctx.fill();
    });
  }
  const at = angleTicks(size);
  pictureAxes(ctx, size, {
    bottom: { ticks: at.map((t) => ({ pos: t.pos, label: t.label })), label: `l, ${U().angle === 'deg' ? 'degrees (sin θ)' : angleUnit()} east →` },
    left: { ticks: at.map((t) => ({ pos: size - t.pos, label: t.label })), label: 'm, north ↑' },
  });
}

/** The uv picture at its own resolution (recomputed when the sky, the units or the mode change). */
function uvPictureImage(size) {
  const n = Math.max(64, Math.min(256, Math.round(size)));
  if (!uvDirty && uvImage && uvImage.n === n && uvImage.mode === state.mode) return uvImage;
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  if (skyModel.kind === 'picture') idealWindow(skyModel, pix(), directions, ensureGrid(), uvMax(), n, n, re, im);
  else idealWindow(skyModel, pix(), directions, null, uvMax(), n, n, re, im);
  const img = new ImageData(n, n);
  colourV(re, im, img.data, brightnessR(), state.mode);
  const off = document.createElement('canvas'); off.width = off.height = n; off.getContext('2d').putImageData(img, 0, 0);
  uvImage = { n, mode: state.mode, canvas: off, re, im };
  uvDirty = false;
  return uvImage;
}

/** Colour V with the chosen mode (the FFT demo's, plus a log scale; HBT shows |V|²). */
function colourV(re, im, data, R, mode) {
  if (state.hbt) mode = 'intensity';
  if (mode === 'log') {
    const n = re.length, lr = new Float64Array(n);
    for (let i = 0; i < n; i++) lr[i] = Math.log10(1 + (99 * Math.hypot(re[i], im[i])) / (2 * R)) / 2;
    colorize(lr, null, data, 0.5, 'magnitude');
    return;
  }
  colorize(re, im, data, R, mode);
}

function uvTicks(size) {
  const m = uvMaxM(), ticks = [];
  for (const t of niceTicks(-lenIn(m), lenIn(m), 5)) ticks.push({ pos: uvToPx(toWaves(t * U().lenScale), 0, size)[0], label: tickLabel(t) });
  const w = uvMax(), wt = [];
  for (const t of niceTicks(-w, w, 5)) wt.push({ pos: uvToPx(t, 0, size)[0], label: fmtWaves(t) });
  return { metres: ticks, waves: wt };
}
const fmtWaves = (x) => (Math.abs(x) >= 1e9 ? `${tickLabel(x / 1e9)}G` : Math.abs(x) >= 1e6 ? `${tickLabel(x / 1e6)}M` : Math.abs(x) >= 1e3 ? `${tickLabel(x / 1e3)}k` : tickLabel(x));

function drawUV() {
  const canvas = $('#uv'), { ctx, width, height } = fitCanvas(canvas), size = Math.min(width, height);
  const img = uvPictureImage(size);
  ctx.imageSmoothingEnabled = skyModel.kind !== 'picture';
  ctx.drawImage(img.canvas, 0, 0, size, size);
  const t = uvTicks(size);
  pictureAxes(ctx, size, {
    bottom: { ticks: t.metres, label: `Δx, Δy in ${lenUnit()} (separation of the pair)` },
    left: { ticks: t.metres.map((k) => ({ pos: size - k.pos, label: k.label })), label: `Δy, ${lenUnit()} ↑` },
    top: { ticks: t.waves, label: 'u = Δx/λ, v = Δy/λ in wavelengths: fringes 1/u apart' },
  });
  if (state.view === 'array') { drawTracks(ctx, size); return; }
  // The pair: the baseline ● and its mirror ○.
  const [u, v] = sim.baseline();
  const [x, y] = uvToPx(u, v, size), [x2, y2] = uvToPx(-u, -v, size);
  ctx.save();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.arc(x, y, 7, 0, TWO_PI); ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 7, 0, TWO_PI); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3, 0, TWO_PI); ctx.fill();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x2, y2, 6, 0, TWO_PI); ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2]); ctx.beginPath(); ctx.arc(x2, y2, 6, 0, TWO_PI); ctx.stroke(); ctx.setLineDash([]);
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.strokeText('A→B', x + 10, y); ctx.fillText('A→B', x + 10, y);
  ctx.strokeText('B→A', x2 + 9, y2); ctx.fillText('B→A', x2 + 9, y2);
  ctx.restore();
}

/** The array's baselines (and tracks) on the uv picture. */
function drawTracks(ctx, size) {
  computeArray();
  const L = lambda(), upto = state.earth ? Math.round(state.tNow * (tr.nt - 1)) : 0;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1;
  for (let p = 0; p < tr.nb; p++) {
    for (const sgn of [1, -1]) {
      if (state.earth && tr.nt > 1) {
        ctx.beginPath();
        let pen = false;
        for (let k = 0; k <= upto; k++) {
          const o = p * tr.nt + k;
          if (!tr.ok[o]) { pen = false; continue; }
          const [x, y] = uvToPx((sgn * tr.u[o]) / L, (sgn * tr.v[o]) / L, size);
          pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true;
        }
        ctx.stroke();
      }
      const o = p * tr.nt + Math.min(upto, tr.nt - 1);
      if (tr.ok[o]) { const [x, y] = uvToPx((sgn * tr.u[o]) / L, (sgn * tr.v[o]) / L, size); ctx.beginPath(); ctx.arc(x, y, 2, 0, TWO_PI); ctx.fill(); }
    }
  }
  ctx.restore();
}

/** The sampled uv plane: the painted or array samples, V there and black elsewhere. */
function drawSampled() {
  const canvas = $('#sampled'), { ctx, width, height } = fitCanvas(canvas), size = Math.min(width, height);
  const g = ensureGrid();
  let S, V;
  if (state.view === 'array') { computeArray(); S = sampled.S; V = g; }
  else { S = paint.S; V = paintedV(); }
  const n = Math.min(256, Math.round(size)), re = new Float64Array(n * n), im = new Float64Array(n * n), du = g.du, h = N / 2, umax = uvMax();
  for (let y = 0; y < n; y++) {
    const v = ((n / 2 - y - 0.5) / n) * 2 * umax, q = Math.round(h - v / du);
    for (let x = 0; x < n; x++) {
      const u = ((x + 0.5 - n / 2) / n) * 2 * umax, p = Math.round(h + u / du);
      if (p >= 0 && p < N && q >= 0 && q < N && S[q * N + p]) { re[y * n + x] = V.re[q * N + p]; im[y * n + x] = V.im[q * N + p]; }
    }
  }
  const img = new ImageData(n, n);
  colourV(re, im, img.data, brightnessR(), state.mode);
  const off = document.createElement('canvas'); off.width = off.height = n; off.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, size, size);
  const t = uvTicks(size);
  pictureAxes(ctx, size, { bottom: { ticks: t.metres, label: `Δx, ${lenUnit()}` }, top: { ticks: t.waves, label: 'u, wavelengths' } });
}

/** A real image NS x NS from the central part of an N x N grid, grey, scaled to its peak. */
function drawImageGrid(canvas, data, { scale = null, signed = false, overlay = null } = {}) {
  const { ctx, width, height } = fitCanvas(canvas), size = Math.min(width, height);
  const o = (N - NS) / 2, img = ctx.createImageData(NS, NS);
  let top = scale;
  if (top === null) { top = 1e-12; for (let j = 0; j < NS; j++) for (let i = 0; i < NS; i++) top = Math.max(top, Math.abs(data[(j + o) * N + i + o])); }
  for (let j = 0; j < NS; j++) for (let i = 0; i < NS; i++) {
    const v = data[(j + o) * N + i + o] / top, k = 4 * (j * NS + i);
    if (signed) {
      // Positive white, negative a dim blue (the dirty image's negative bowl).
      const g = Math.round(255 * Math.sqrt(Math.min(1, Math.abs(v))));
      if (v >= 0) { img.data[k] = g; img.data[k + 1] = g; img.data[k + 2] = g; } else { img.data[k] = 0; img.data[k + 1] = Math.round(g * 0.4); img.data[k + 2] = g; }
    } else { const g = Math.round(255 * Math.sqrt(Math.max(0, Math.min(1, v)))); img.data[k] = g; img.data[k + 1] = g; img.data[k + 2] = g; }
    img.data[k + 3] = 255;
  }
  const off = document.createElement('canvas'); off.width = off.height = NS; off.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
  ctx.drawImage(off, 0, 0, size, size);
  const at = angleTicks(size);
  pictureAxes(ctx, size, { bottom: { ticks: at.map((t) => ({ pos: t.pos, label: t.label })), label: `l, ${U().angle === 'deg' ? '°' : angleUnit()}` } });
  if (overlay) overlay(ctx, size);
  return top;
}

function drawRecon() {
  if (state.view === 'array') {
    computeArray();
    const data = state.clean ? restoredImage() : dirtyImg;
    drawImageGrid($('#recon'), data, { signed: true });
    $('#recon-title').textContent = state.clean ? 'CLEAN image' : 'Dirty image';
    $('#recon-note').textContent = state.clean ? 'the CLEAN components smoothed by the clean beam, plus the residual' : 'the inverse transform of the sampled plane: the sky blurred by the dirty beam';
    drawImageGrid($('#beam'), beam, { scale: 1, signed: true });
  } else {
    $('#recon-title').textContent = 'Image from what you have kept';
    $('#recon-note').textContent = paint.cells ? 'the inverse transform of the painted uv plane' : 'nothing painted yet: drag the ● with "Keep what you measure" on';
    drawImageGrid($('#recon'), paint.cells ? paintedImage() : new Float64Array(N * N), { signed: true });
  }
}

/** The ground from above: the two antennas (view 3, small) or the array's dishes (view 4). */
function drawGround(canvas, { dishesToo = false }) {
  const { ctx, width, height } = fitCanvas(canvas), size = Math.min(width, height);
  ctx.fillStyle = C.panel; ctx.fillRect(0, 0, width, height);
  const half = dishesToo ? groundHalf() : uvMaxM() / 2;
  const toPx = (x, y) => [size / 2 + (x / half) * (size / 2), size / 2 - (y / half) * (size / 2)];
  ctx.strokeStyle = C.line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, size / 2 + 0.5); ctx.lineTo(size, size / 2 + 0.5); ctx.moveTo(size / 2 + 0.5, 0); ctx.lineTo(size / 2 + 0.5, size); ctx.stroke();
  ctx.fillStyle = C.ink3; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  for (const t of niceTicks(-lenIn(half), lenIn(half), 4)) { const [x] = toPx(t * U().lenScale, 0); if (x > 8 && x < size - 8) ctx.fillText(tickLabel(t), x, size - 3); }
  ctx.textAlign = 'right'; ctx.fillText(`east, ${lenUnit()} →`, size - 4, size - 14);
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('north ↑', 4, 4);
  if (dishesToo) {
    dishes.forEach(([e, n], i) => {
      const [x, y] = toPx(e, n);
      ctx.fillStyle = C.accent; ctx.strokeStyle = C.panel; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, TWO_PI); ctx.fill(); ctx.stroke();
      if (dishNames) { ctx.fillStyle = C.ink2; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(dishNames[i], x + 7, y); }
    });
    return;
  }
  const [a, b] = pairPositions(), [ax, ay] = toPx(...a), [bx, by] = toPx(...b);
  ctx.strokeStyle = C.ink3; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
  const [cx, cy] = toPx(state.pair.cx, state.pair.cy);
  ctx.strokeStyle = C.ink3; ctx.beginPath(); ctx.moveTo(cx - 4, cy); ctx.lineTo(cx + 4, cy); ctx.moveTo(cx, cy - 4); ctx.lineTo(cx, cy + 4); ctx.stroke();
  for (const [x, y, colour, name] of [[ax, ay, colours.a, 'A'], [bx, by, colours.b, 'B']]) {
    ctx.fillStyle = colour; ctx.strokeStyle = C.panel; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 8, 0, TWO_PI); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(name, x, y + 0.5);
  }
  ctx.fillStyle = C.ink; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('The pair on the ground: drag A or B', 4, 16);
}
/** The ground picture's half-extent for the array: the dishes plus a margin. */
function groundHalf() {
  let r = 0;
  for (const [e, n] of dishes) r = Math.max(r, Math.abs(e), Math.abs(n));
  return Math.max(r * 1.2, uvMaxM() * 0.1);
}

function drawUVView() {
  drawSky(); drawUV();
  $('#main').classList.toggle('sketching', state.sketch);
  if (state.view === 'array') { drawGround($('#ground'), { dishesToo: true }); drawSampled(); drawRecon(); return; }
  if (state.sketch) { drawSampled(); drawRecon(); }
  drawStream($('#vA3'), sim.fineA, colours.a, 'Antenna A');
  drawStream($('#vB3'), sim.fineB, colours.b, 'Antenna B');
  drawSpectrum($('#spec3'), [{ spec: sim.specAA, colour: colours.a }, { spec: sim.specBB, colour: colours.b }], 'Spectra of A and B');
  drawLags($('#cross3'), [{ key: 'lagAB', colour: C.ink, complex: true }], 'Cross-correlation against lag');
  const [u, v] = sim.baseline(), ideal = idealAt(skyModel, pix(), directions, u, v);
  const F = totalFlux(skyModel);
  drawPlane($('#plane3'), { R: brightnessR(), extent: Math.max(F, 1e-6) * 1.25, ideal: state.hbt ? [ideal[0] ** 2 + ideal[1] ** 2, 0] : ideal, expected: state.hbt ? null : sim.expected(), title: state.hbt ? '⟨ΔI_A ΔI_B⟩ settling (ring: |V|²)' : '⟨v_A v_B*⟩ settling (ring: V, ×: with this band)' });
  drawGround($('#pair'), {});
}

// ------------------------------------------------------------------------- the read-out

function readout() {
  const e = $('#readout');
  if (state.view === 'one') {
    const dn = state.band * nu0(), tc = 1 / state.band;
    setSlots(e, ['Band Δν = ', { v: state.band * 100, dec: 1, w: 5 }, '% of ν₀ (', { v: dn >= 1e9 ? dn / 1e9 : dn / 1e6, dec: 1, w: 6 }, dn >= 1e9 ? ' GHz' : ' MHz', ' at ', freqText(), '): the lumps last about 1/Δν = ', { v: tc, dec: 1, w: 6 }, ' cycles = ', { v: (tc / nu0()) * 1e9, dec: 2, w: 7 }, ' ns.  Power ⟨|s|²⟩ = ', { v: sim.powerA, dec: 2, w: 5 }, '.']);
    return;
  }
  if (state.view === 'two') {
    const sc = state.scene, D = sc.xB - sc.xA, tau = toWaves(D * Math.sin(sc.sources[0].theta * DEG));
    const mag = Math.hypot(...sim.avg), ph = Math.atan2(sim.avg[1], sim.avg[0]) / DEG, id = sim.ideal(...sim.baseline());
    setSlots(e, ['Separation ', { v: lenIn(D), dec: 2, w: 6 }, ` ${lenUnit()} = `, { v: toWaves(D), dec: 2, w: 7 }, ' λ.  Source 1 reaches B ', { v: tau, dec: 2, w: 6 }, ' cycles after A.  ⟨v_A v_B*⟩: magnitude ', { v: mag, dec: 2, w: 5 }, ', phase ', { v: ph, dec: 0, w: 4 }, '° (ideal ', { v: Math.hypot(...id), dec: 2, w: 5 }, ' at ', { v: Math.atan2(id[1], id[0]) / DEG, dec: 0, w: 4 }, '°); cross terms ', { v: Math.hypot(...sim.avgCross), dec: 3, w: 5 }, '.']);
    return;
  }
  if (state.view === 'array') {
    computeArray();
    const [lo, hi] = baselineRange(dishes.map(([a, b]) => [a, b, 0])), L = lambda();
    const parts = [{ v: dishes.length, dec: 0, w: 3 }, ' dishes, ', { v: tr.nb, dec: 0, w: 4 }, ' pairs, ', { v: sampled.samples * 2, dec: 0, w: 6 }, ' samples.  Longest baseline ', ...lenParts(hi, 7, 2), ': finest fringe λ/B = ', ...angleParts(L / hi, 7, 2), '; shortest ', ...lenParts(lo, 7, 2), ': λ/B = ', ...angleParts(L / lo, 7, 2), '.'];
    if (state.clean && cs) parts.push('  CLEAN: ', { v: cs.iterations, dec: 0, w: 5 }, ' steps, ', { v: cs.components, dec: 0, w: 4 }, ' components.');
    setSlots(e, parts);
    return;
  }
  const [u, v] = sim.baseline(), b = Math.hypot(u, v) * lambda(), ideal = idealAt(skyModel, pix(), directions, u, v);
  const mag = Math.hypot(...sim.avg), ph = Math.atan2(sim.avg[1], sim.avg[0]) / DEG;
  const parts = ['Separation Δx = ', ...lenParts(u * lambda()), ', Δy = ', ...lenParts(v * lambda()), ': u = ', { v: u, dec: 1, w: 7 }, ', v = ', { v: v, dec: 1, w: 7 }, ' wavelengths; |b| = ', ...lenParts(b), ', fringes 1/|b| = ', ...angleParts(Math.min(1, lambda() / Math.max(b, 1e-9)), 6, 2), ' apart.  '];
  if (state.hbt) parts.push('⟨ΔI_A ΔI_B⟩ = ', { v: sim.avgHbt, dec: 2, w: 6 }, '; |V|² = ', { v: ideal[0] ** 2 + ideal[1] ** 2, dec: 2, w: 6 }, '.');
  else parts.push('Measured ', { v: mag, dec: 2, w: 5 }, ' at ', { v: ph, dec: 0, w: 4 }, '°; the exact V(u, v) is ', { v: Math.hypot(...ideal), dec: 2, w: 5 }, ' at ', { v: Math.atan2(ideal[1], ideal[0]) / DEG, dec: 0, w: 4 }, '°.');
  if (state.sketch) parts.push('  Painted ', { v: paint.cells, dec: 0, w: 5 }, ' cells.');
  setSlots(e, parts);
}

// ------------------------------------------------------------------------- the loop

let raf = 0, needDraw = true;
function dirty() { needDraw = true; kick(); }
function kick() { if (!raf) raf = requestAnimationFrame(loop); }

function advance() {
  if (state.view !== 'array') sim.step();
  if (state.view === 'uv' && state.sketch && anim.pen) { const [u, v] = sim.baseline(); const a = state.hbt ? [sim.avgHbt, 0] : sim.avg; paintAt(u, v, a[0], a[1]); }
  if (state.view === 'array' && anim.earthPlaying) {
    state.tNow = Math.min(1, state.tNow + 1 / 240);
    arrayDirty = true;
    if (state.tNow >= 1) { anim.earthPlaying = false; earthButton.textContent = 'Turn the Earth'; }
    scheduleHash();
  }
  anim.frames++;
}

function loop() {
  raf = 0;
  const animating = !document.hidden && (state.view !== 'array' || anim.earthPlaying);
  if (animating && !testHold) advance();
  if (needDraw || animating) { needDraw = false; drawNow(); }
  if (animating) raf = requestAnimationFrame(loop);
}

function drawNow() {
  readColours();
  if (state.view === 'one') drawOne();
  else if (state.view === 'two') drawTwo();
  else drawUVView();
  readout();
}

// ------------------------------------------------------------------------- controls

const VIEWS = { one: '1 · One source', two: '2 · Two sources, two antennas', uv: '3 · The uv plane', array: '4 · Many baselines' };
const viewSeg = segmented(Object.entries(VIEWS).map(([value, label]) => ({ value, label })), state.view, (v) => setView(v), { label: 'View' });
$('#view-row').append(viewSeg);

const HINTS = {
  uv: 'Drag the ● on the uv plane (its mirror ○ follows): the pair\'s separation.  The dot in the complex plane settles on the colour under it.  Drag a source on the sky to change the picture',
  array: 'Drag a dish on the ground: its baselines move on the uv plane, and the sampled plane and the image follow.  Turn the Earth to sweep the tracks',
};
function setView(v) {
  if (state.view === v) { $('#main').dataset.view = v; return; }
  state.view = v; viewSeg.value = v;
  $('#main').dataset.view = v;
  $('#hint-uv').textContent = HINTS[v] || HINTS.uv;
  if (v === 'array') { buildArray(); gridDirty = true; }
  applySim();
  if (v === 'uv' && skyModel.kind === 'picture') { /* keep */ } else if (v === 'uv' || v === 'array') buildSky();
  syncPanels();
  dirty(); scheduleHash();
}

// The noise.
const bandSlider = slider({ label: 'Bandwidth Δν/ν₀', min: 0.01, max: 2, log: true, value: state.band, title: 'The band the receivers pass, as a fraction of the carrier; 2 is white (0 to 2ν₀)',
  onInput: (v) => { state.band = v; sim.band = v; sim.reset(); dirty(); scheduleHash(); } });
const noiseSlider = slider({ label: 'Receiver noise', min: 0, max: 3, step: 0.05, value: state.noise, title: 'Each antenna\'s own noise power, for a source of brightness 1',
  onInput: (v) => { state.noise = v; sim.noise = state.view === 'one' ? 0 : v; dirty(); scheduleHash(); } });
const avgSlider = slider({ label: 'Averaging', min: 2, max: 200, log: true, value: state.avg, title: 'The running average\'s time constant, in chunks of 512 cycles (one chunk per frame)',
  onInput: (v) => { state.avg = v; sim.alpha = 1 / v; dirty(); scheduleHash(); } });
$('#signal-box').append(bandSlider, noiseSlider, avgSlider);
const displaySeg = segmented([
  { value: 'real', label: 'Real signal', title: 'The voltage x(t) = Re[s e^{2πiν₀t}], its two-sided spectrum and its oscillating autocorrelation' },
  { value: 'complex', label: 'Complex envelope', title: 'The envelope s(t), I and Q, that the receiver mixes down to: one band at zero frequency' },
], state.display, (v) => { state.display = v; dirty(); scheduleHash(); }, { label: 'Show' });
$('#signal-row').append(displaySeg);

// The sky (views 3 and 4).
const pointButtons = {}, pictureButtons = {};
for (const [id, p] of Object.entries(POINT_PRESETS)) {
  const b = el('button', { type: 'button', title: p.title, 'aria-pressed': 'false', onclick: () => { state.sky.kind = 'points'; state.sky.preset = id; buildSky(); syncSkyButtons(); dirty(); scheduleHash(); } }, p.label);
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
  if (!file || !file.type.startsWith('image/')) { toast('That is not an image'); return; }
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => { ownImage = imageToSky(img); URL.revokeObjectURL(url); loadPicture('own'); };
  img.onerror = () => { toast('Could not read that picture'); URL.revokeObjectURL(url); };
  img.src = url;
}
document.addEventListener('paste', (e) => {
  if (state.view !== 'uv' && state.view !== 'array') return;
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) loadFile(item.getAsFile());
});
{
  const zone = $('#sky').parentElement;
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drop'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drop'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('drop'); loadFile(e.dataTransfer.files[0]); });
}
const sizeSlider = slider({ label: 'Size', min: 0.2, max: 2.5, log: true, value: state.sky.size, title: 'Scale the layout or the picture: bigger on the sky means finer fringes in the uv plane',
  onInput: (v) => { state.sky.size = v; if (state.sky.kind === 'picture') loadPicture(state.sky.picture); else { buildSky(); dirty(); } scheduleHash(); } });
const rotSlider = slider({ label: 'Rotation', min: -180, max: 180, step: 1, value: state.sky.rotation, title: 'Turn the layout of points (degrees): its stripes in the uv plane turn with it',
  onInput: (v) => { state.sky.rotation = v; buildSky(); dirty(); scheduleHash(); } });
const brightSlider = slider({ label: 'Brightness', min: 0.1, max: 3, step: 0.1, value: state.sky.bright, title: 'The brightness of every source: the magnitude of V scales with it',
  onInput: (v) => { state.sky.bright = v; buildSky(); dirty(); scheduleHash(); } });
$('#sky-box').append(sizeSlider, rotSlider, brightSlider);
function syncSkyButtons() {
  for (const [id, b] of Object.entries(pointButtons)) b.setAttribute('aria-pressed', String(state.sky.kind === 'points' && state.sky.preset === id));
  for (const [id, b] of Object.entries(pictureButtons)) b.setAttribute('aria-pressed', String(state.sky.kind === 'picture' && state.sky.picture === id));
  rotSlider.hidden = brightSlider.hidden = state.sky.kind !== 'points';
}

// The scene (view 2).
const countSeg = segmented([{ value: 1, label: 'One source' }, { value: 2, label: 'Two sources' }], state.scene.sources.length, (n) => {
  const sc = state.scene;
  if (n === 2 && sc.sources.length < 2) sc.sources.push({ theta: -20, I: 0.5 });
  if (n === 1) sc.sources.length = 1;
  applySim(); syncSceneSliders(); dirty(); scheduleHash();
}, { label: 'Sources' });
$('#scene-row').append(countSeg);
const sceneSliders = { th1: null, th2: null, I2: null, xA: null, xB: null };
function sceneSlider(label, key, min, max, step, get, set, title) {
  return slider({ label, min, max, step, value: get(), title, onInput: (v) => { set(v); applySim(); dirty(); scheduleHash(); } });
}
sceneSliders.th1 = sceneSlider('Source 1 angle θ₁', 'th1', -60, 60, 0.5, () => state.scene.sources[0].theta, (v) => { state.scene.sources[0].theta = v; }, 'Degrees from straight up (positive towards +x)');
sceneSliders.th2 = sceneSlider('Source 2 angle θ₂', 'th2', -60, 60, 0.5, () => state.scene.sources[1]?.theta ?? -20, (v) => { if (state.scene.sources[1]) state.scene.sources[1].theta = v; }, 'Degrees from straight up');
sceneSliders.I2 = sceneSlider('Source 2 brightness', 'I2', 0, 2, 0.05, () => state.scene.sources[1]?.I ?? 0.5, (v) => { if (state.scene.sources[1]) state.scene.sources[1].I = v; }, 'Relative to source 1');
$('#scene-box').append(sceneSliders.th1, sceneSliders.th2, sceneSliders.I2);
function syncSceneSliders() {
  const sc = state.scene;
  countSeg.value = sc.sources.length;
  sceneSliders.th1.value = sc.sources[0].theta;
  sceneSliders.th2.hidden = sceneSliders.I2.hidden = sc.sources.length < 2;
  if (sc.sources[1]) { sceneSliders.th2.value = sc.sources[1].theta; sceneSliders.I2.value = sc.sources[1].I; }
}

// The pair (views 2 and 3).
const trackToggle = toggle('Delay tracking', state.tracking, (on) => { state.tracking = on; sim.tracking = on; sim.reset(); dirty(); scheduleHash(); }, 'Delay A against B by the geometric delay towards the reference direction, as a real correlator does');
const fixToggle = toggle('A fixed at the centre', state.pair.fixA, (on) => { setFixA(on); }, 'Keep antenna A at the origin and move only B; otherwise both move symmetrically');
$('#pair-row').append(trackToggle, fixToggle);
function setFixA(on) {
  const p = state.pair;
  if (on && !p.fixA) { p.cx = 0; p.cy = 0; }
  p.fixA = on; fixToggle.on = on;
  applySim(); dirty(); scheduleHash();
}
const refSlider = slider({ label: 'Reference direction θ₀', min: -60, max: 60, step: 0.5, value: state.scene.ref, title: 'The direction the correlator\'s delay points at (degrees from straight up): where the array "looks"',
  onInput: (v) => { state.scene.ref = v; applySim(); dirty(); scheduleHash(); } });
const sepSlider = slider({ label: 'Separation', min: -6, max: 6, step: 0.01, value: 1, title: 'The pair\'s separation xB − xA, in the preset\'s length unit',
  onInput: (v) => { const sc = state.scene, c = (sc.xA + sc.xB) / 2, d = v * U().lenScale; sc.xA = c - d / 2; sc.xB = c + d / 2; applySim(); dirty(); scheduleHash(); } });
$('#pair-box').append(sepSlider, refSlider);
function syncPairControls() {
  const sc = state.scene;
  sepSlider.value = lenIn(sc.xB - sc.xA);
  refSlider.value = sc.ref;
  trackToggle.on = state.tracking; fixToggle.on = state.pair.fixA;
  sepSlider.hidden = refSlider.hidden = state.view !== 'two';
  fixToggle.hidden = state.view !== 'uv';
}

// The Etch-a-Sketch (view 3).
const sketchToggle = toggle('Keep what you measure', state.sketch, (on) => { state.sketch = on; $('#main').classList.toggle('sketching', on); dirty(); scheduleHash(); }, 'Paint each averaged correlation into the sampled uv plane where the pair is, and show the image it makes');
const clearButton = el('button', { type: 'button', title: 'Forget everything painted so far', onclick: () => { clearPaint(); dirty(); } }, 'Clear');
const penToggle = toggle('Pen down', true, (on) => { anim.pen = on; }, 'Lift the pen (or hold Shift while dragging) to move the pair without painting');
$('#sketch-row').append(sketchToggle, penToggle, clearButton);

// The array (view 4).
const LAYOUTS = { two: 'Two dishes', line: 'Line of 8', y: 'A Y, like the VLA', ring: 'Ring', random: 'Random', eht: 'Earth-sized (EHT)' };
const LAYOUT_TITLES = { two: 'One pair: one baseline and its mirror', line: 'Eight dishes at the marks of a Golomb ruler: all 28 spacings different', y: 'Three arms of nine, as the Very Large Array', ring: 'N dishes round a circle', random: 'N dishes thrown at random', eht: 'The nine sites of the Event Horizon Telescope in 2018, on the globe' };
const layoutButtons = {};
for (const [id, label] of Object.entries(LAYOUTS)) {
  const b = el('button', { type: 'button', title: LAYOUT_TITLES[id], 'aria-pressed': 'false', onclick: () => setLayout(id) }, label);
  $('#layouts').append(b); layoutButtons[id] = b;
}
function setLayout(id) {
  state.layout = id;
  if (id === 'eht') { setUnits('eht', { keepSky: true }); if (state.sky.kind === 'points') loadPicture('ring'); }
  buildArray(); syncArrayControls(); dirty(); scheduleHash();
}
const nSlider = slider({ label: 'Dishes N', min: 2, max: 30, step: 1, value: state.n, title: 'How many dishes in the ring or the random array', onInput: (v) => { state.n = Math.round(v); buildArray(); dirty(); scheduleHash(); } });
const armSlider = slider({ label: 'Spread', min: 0.1, max: 2, log: true, value: state.arm, title: 'How far the array reaches: the longest baseline sets the finest detail', onInput: (v) => { state.arm = v; buildArray(); dirty(); scheduleHash(); } });
$('#array-box').append(nSlider, armSlider);
const earthToggle = toggle('Earth rotation', state.earth, (on) => { state.earth = on; state.tNow = 1; arrayDirty = true; syncArrayControls(); dirty(); scheduleHash(); }, 'Let each pair sweep its track in the uv plane as the Earth turns for the hours set below');
const earthButton = el('button', { type: 'button', title: 'Watch the tracks fill in over the observation', onclick: () => {
  if (!state.earth) { state.earth = true; earthToggle.on = true; syncArrayControls(); }
  anim.earthPlaying = !anim.earthPlaying;
  if (anim.earthPlaying) { state.tNow = 0; arrayDirty = true; }
  earthButton.textContent = anim.earthPlaying ? 'Pause' : 'Turn the Earth';
  dirty();
} }, 'Turn the Earth');
$('#earth-row').append(earthToggle, earthButton);
const hoursSlider = slider({ label: 'Hours', min: 0.5, max: 12, step: 0.5, value: state.hours, title: 'The length of the observation, centred on transit', onInput: (v) => { state.hours = v; arrayDirty = true; dirty(); scheduleHash(); } });
const decSlider = slider({ label: 'Declination δ', min: -85, max: 85, step: 1, value: state.dec, title: 'The source\'s declination: the tracks are ellipses of axis ratio sin δ', onInput: (v) => { state.dec = v; arrayDirty = true; dirty(); scheduleHash(); } });
const latSlider = slider({ label: 'Latitude', min: -85, max: 85, step: 1, value: state.lat, title: 'Where the array stands', onInput: (v) => { state.lat = v; arrayDirty = true; dirty(); scheduleHash(); } });
const weightSeg = segmented([{ value: 'natural', label: 'Natural', title: 'Every sample counts' }, { value: 'uniform', label: 'Uniform', title: 'Every sampled cell counts once: a sharper beam, more noise' }], state.weighting, (v) => { state.weighting = v; arrayDirty = true; dirty(); scheduleHash(); }, { label: 'Weighting' });
$('#earth-box').append(hoursSlider, decSlider, latSlider, el('div', { class: 'row' }, el('span', { class: 'small muted' }, 'Weighting'), weightSeg));
const cleanToggle = toggle('CLEAN', state.clean, (on) => { state.clean = on; if (on && cs && cs.iterations === 0) runClean(state.cleanRun); syncArrayControls(); dirty(); scheduleHash(); }, 'Högbom\'s CLEAN: take the dirty beam out of the image point by point');
const stepButton = el('button', { type: 'button', title: 'One CLEAN step', onclick: () => { computeArray(); runClean(1); dirty(); } }, 'Step');
const runButton = el('button', { type: 'button', title: 'Many steps at once', onclick: () => { computeArray(); runClean(state.cleanRun); dirty(); } }, 'Run');
const resetButton = el('button', { type: 'button', title: 'Start CLEAN again from the dirty image', onclick: () => { computeArray(); cs = cleanStart(dirtyImg); restored = null; dirty(); } }, 'Reset');
$('#clean-row').append(cleanToggle, stepButton, runButton, resetButton);
const gainSlider = slider({ label: 'Loop gain', min: 0.02, max: 0.5, step: 0.01, value: state.gain, title: 'The fraction of the brightest pixel taken out at each step', onInput: (v) => { state.gain = v; scheduleHash(); } });
const stepsSlider = slider({ label: 'Steps per run', min: 10, max: 2000, log: true, value: state.cleanRun, title: 'How many steps Run takes', onInput: (v) => { state.cleanRun = Math.round(v); scheduleHash(); } });
$('#clean-box').append(gainSlider, stepsSlider);
function syncArrayControls() {
  for (const [id, b] of Object.entries(layoutButtons)) b.setAttribute('aria-pressed', String(id === state.layout));
  nSlider.hidden = !(state.layout === 'ring' || state.layout === 'random');
  armSlider.hidden = state.layout === 'eht';
  earthToggle.on = state.earth;
  hoursSlider.hidden = decSlider.hidden = !state.earth;
  latSlider.hidden = !state.earth || state.layout === 'eht';
  cleanToggle.on = state.clean;
  gainSlider.hidden = stepsSlider.hidden = stepButton.hidden = runButton.hidden = resetButton.hidden = !state.clean;
  $('#clean-note').textContent = state.clean ? 'Step takes one point out; Run takes many.  The image shows the model smoothed by the clean beam, plus what is left.' : '';
}

// Units.
const unitsSeg = segmented(Object.entries(UNITS).map(([value, u]) => ({ value, label: u.label })), state.units, (v) => setUnits(v), { label: 'Units' });
$('#units-row').append(unitsSeg);
function setUnits(id, { keepSky = false } = {}) {
  state.units = id; unitsSeg.value = id;
  const u = UNITS[id];
  state.pair.bx = u.uvMax * 0.14; state.pair.by = u.uvMax * 0.04; state.pair.cx = 0; state.pair.cy = 0;
  state.scene.xA = -u.uvMax / 24; state.scene.xB = u.uvMax / 24;
  sepSlider.setRange(-lenIn(u.uvMax / 2), lenIn(u.uvMax / 2));
  if (!keepSky) buildSky(); else { gridDirty = true; uvDirty = true; }
  clearPaint();
  if (state.view === 'array') buildArray();
  unitsNote();
  applySim(); syncPairControls(); dirty(); scheduleHash();
}
function unitsNote() {
  const u = U();
  $('#units-note').textContent = `${freqText()}, λ = ${lambdaText()}; separations in ${u.len === 'm' ? 'metres' : 'kilometres'}, sky angles in ${u.angle === 'deg' ? 'degrees' : u.angle === 'arcsec' ? 'arcseconds' : 'microarcseconds'}${u.nearField ? `; the sources ${u.z} m above the ground, with the exact distances` : ''}.`;
  $('#band-note').textContent = `Δν is the band the receivers let through, as a fraction of the carrier ν₀ (1% at ${freqText()} is ${+(0.01 * nu0() / 1e6).toPrecision(3)} MHz); the lumps of the signal last about 1/Δν.`;
}

// More.
const hbtToggle = toggle('HBT: correlate intensities', state.hbt, (on) => { state.hbt = on; sim.hbt = on; sim.reset(); uvDirty = true; clearPaint(); if (on) { state.mode = 'intensity'; modeSelect.value = 'intensity'; } dirty(); scheduleHash(); }, 'Multiply the intensities |v|² instead of the voltages, as Hanbury Brown and Twiss did: |V|² comes out, without the phase');
const cohToggle = toggle('Coherent sources', state.coherent, (on) => { state.coherent = on; sim.coherent = on; sim.reset(); dirty(); scheduleHash(); }, 'Feed every source the same noise, with a phase step between neighbours: the cross terms then never average away');
const cohSlider = slider({ label: 'Phase step', min: 0, max: 360, step: 5, value: state.cohPhase, title: 'The phase between one coherent source and the next, in degrees', onInput: (v) => { state.cohPhase = v; sim.coherentPhase = v * DEG; sim.reset(); dirty(); scheduleHash(); } });
const nu0Slider = slider({ label: 'Carrier ν₀ (MHz)', min: 100, max: 1e6, log: true, value: 915, title: 'The centre frequency; the wavelength follows, and with it u = Δx/λ for the same separation in metres',
  onInput: (v) => { state.nu0 = v * 1e6; gridDirty = true; uvDirty = true; unitsNote(); applySim(); dirty(); scheduleHash(); } });
$('#more-box').append(hbtToggle, cohToggle, cohSlider, nu0Slider);

// The uv picture's display mode.
const modeSelect = $('#uv-mode');
for (const [k, v] of Object.entries(MODES)) if (k !== 'grey') modeSelect.append(el('option', { value: k }, v));
modeSelect.append(el('option', { value: 'log' }, 'log magnitude'));
modeSelect.value = state.mode;
modeSelect.addEventListener('change', () => { state.mode = modeSelect.value; uvDirty = true; dirty(); scheduleHash(); });

function syncPanels() {
  syncSkyButtons(); syncSceneSliders(); syncPairControls(); syncArrayControls();
  bandSlider.value = state.band; noiseSlider.value = state.noise; avgSlider.value = state.avg; displaySeg.value = state.display;
  sketchToggle.on = state.sketch; hbtToggle.on = state.hbt; cohToggle.on = state.coherent; cohSlider.value = state.cohPhase;
  sizeSlider.value = state.sky.size; rotSlider.value = state.sky.rotation; brightSlider.value = state.sky.bright;
  modeSelect.value = state.hbt ? 'intensity' : state.mode;
  nu0Slider.value = nu0() / 1e6;
  $('#main').classList.toggle('sketching', state.sketch);
  unitsNote();
}

// ------------------------------------------------------------------------- pointer interaction

function pointer(canvas, handlers) {
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    drag = handlers.down(x, y, e, r);
    if (drag) { canvas.setPointerCapture(e.pointerId); e.preventDefault(); }
  });
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (drag) { handlers.move(drag, x, y, e, r); dirty(); } else handlers.hover?.(x, y, r);
  });
  const up = (e) => { if (drag) { handlers.up?.(drag); drag = null; try { canvas.releasePointerCapture(e.pointerId); } catch { /* released already */ } dirty(); } };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
}

// View 1: the band's edge on the spectrum.
pointer($('#spec1'), {
  down: () => ({ band: true }),
  move: (d, x, y, e, r) => {
    const real = state.display === 'real', f = new Frame(null, r.width, r.height, { left: 34, right: 8, top: 18, bottom: 24 });
    f.x0 = real ? -2 : -1; f.x1 = -f.x0;
    const v = f.invX(x), half = real ? Math.abs(Math.abs(v) - 1) : Math.abs(v);
    state.band = Math.max(0.01, Math.min(2, 2 * half)); bandSlider.value = state.band; sim.band = state.band; sim.reset(); scheduleHash();
  },
});

// View 2: the scene.
pointer($('#scene'), {
  down: (x, y) => {
    const sc = state.scene;
    for (let k = sc.sources.length - 1; k >= 0; k--) { const [sx, sy] = sourcePoint(sc.sources[k].theta); if (Math.hypot(x - sx, y - sy) < 18) return { source: k }; }
    const dA = Math.hypot(x - sceneX(sc.xA), y - scene.groundY + 14), dB = Math.hypot(x - sceneX(sc.xB), y - scene.groundY + 14);
    if (Math.min(dA, dB) < 24) return { antenna: dA < dB ? 'A' : 'B' };
    return null;
  },
  move: (d, x, y) => {
    const sc = state.scene;
    if (d.source !== undefined) {
      const a = Math.atan2(x - scene.W / 2, scene.groundY - y) / DEG / scene.angleScale;
      sc.sources[d.source].theta = Math.max(-60, Math.min(60, Math.round(a * 2) / 2));
      syncSceneSliders();
    } else {
      const m = Math.max(-scene.xHalf, Math.min(scene.xHalf, (x - scene.W / 2) / scene.xScale));
      if (d.antenna === 'A') sc.xA = m; else sc.xB = m;
      syncPairControls();
    }
    applySim(); scheduleHash();
  },
});

// View 3: the sky's sources.
pointer($('#sky'), {
  down: (x, y, e, r) => {
    if (skyModel.kind !== 'points') return null;
    const size = Math.min(r.width, r.height);
    let best = -1, bd = 16;
    skyModel.sources.forEach((s, k) => { const [l, m] = directions(k), [px, py] = lmToPx(l, m, size); const d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = k; } });
    return best >= 0 ? { k: best, size } : null;
  },
  move: (d, x, y) => {
    const [l, m] = pxToLm(x, y, d.size), s = skyModel.sources[d.k], lim = fov() / 2;
    const L = Math.max(-lim, Math.min(lim, l)), Mm = Math.max(-lim, Math.min(lim, m));
    if (s.z !== undefined) { const R = s.z / Math.sqrt(Math.max(1e-6, 1 - L * L - Mm * Mm)); s.x = L * R; s.y = Mm * R; } else { s.l = L; s.m = Mm; }
    gridDirty = true; uvDirty = true;
    sim.sources = skyModel.sources.map((q) => ({ ...q })); sim.reset();
    if (state.view === 'array') arrayDirty = true;
    scheduleHash();
  },
});

// View 3: the baseline on the uv plane (either dot).
pointer($('#uv'), {
  down: (x, y, e, r) => {
    if (state.view === 'array') return null;
    const size = Math.min(r.width, r.height), [u, v] = sim.baseline();
    const [px, py] = uvToPx(u, v, size), [qx, qy] = uvToPx(-u, -v, size);
    const d1 = Math.hypot(x - px, y - py), d2 = Math.hypot(x - qx, y - qy);
    const sign = d2 < d1 ? -1 : 1;
    anim.pen = !e.shiftKey && penToggle.on;
    return { size, sign };
  },
  move: (d, x, y, e) => {
    const [u, v] = pxToUv(x, y, d.size), L = lambda(), lim = uvMaxM();
    state.pair.bx = Math.max(-lim, Math.min(lim, d.sign * u * L)); state.pair.by = Math.max(-lim, Math.min(lim, d.sign * v * L));
    anim.pen = !e.shiftKey && penToggle.on;
    const [a, b] = pairPositions();
    sim.receivers = [{ u: toWaves(a[0]), v: toWaves(a[1]) }, { u: toWaves(b[0]), v: toWaves(b[1]) }];
    sim.reset(); scheduleHash();
  },
  up: () => { anim.pen = penToggle.on; },
});

// View 3: the pair on the ground.
pointer($('#pair'), {
  down: (x, y, e, r) => {
    const size = Math.min(r.width, r.height), half = uvMaxM() / 2, [a, b] = pairPositions();
    const toPx = (p) => [size / 2 + (p[0] / half) * (size / 2), size / 2 - (p[1] / half) * (size / 2)];
    const [ax, ay] = toPx(a), [bx, by] = toPx(b), dA = Math.hypot(x - ax, y - ay), dB = Math.hypot(x - bx, y - by);
    if (Math.min(dA, dB) > 16) return null;
    return { which: dA <= dB ? 'A' : 'B', size, half };
  },
  move: (d, x, y) => {
    const px = ((x - d.size / 2) / (d.size / 2)) * d.half, py = ((d.size / 2 - y) / (d.size / 2)) * d.half, [a, b] = pairPositions();
    const A = d.which === 'A' ? [px, py] : a, B = d.which === 'B' ? [px, py] : b, p = state.pair;
    p.bx = B[0] - A[0]; p.by = B[1] - A[1];
    if (p.fixA) { p.cx = A[0]; p.cy = A[1]; } else { p.cx = (A[0] + B[0]) / 2; p.cy = (A[1] + B[1]) / 2; }
    sim.receivers = [{ u: toWaves(A[0]), v: toWaves(A[1]) }, { u: toWaves(B[0]), v: toWaves(B[1]) }];
    sim.reset(); scheduleHash();
  },
});

// View 4: the dishes.
pointer($('#ground'), {
  down: (x, y, e, r) => {
    const size = Math.min(r.width, r.height), half = groundHalf();
    let best = -1, bd = 14;
    dishes.forEach(([ex, ny], i) => { const px = size / 2 + (ex / half) * (size / 2), py = size / 2 - (ny / half) * (size / 2); const d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = i; } });
    return best >= 0 ? { i: best, size, half } : null;
  },
  move: (d, x, y) => {
    dishes[d.i] = [((x - d.size / 2) / (d.size / 2)) * d.half, ((d.size / 2 - y) / (d.size / 2)) * d.half];
    arrayDirty = true;
  },
});

// ------------------------------------------------------------------------- the address

let hashTimer = 0;
function scheduleHash() { clearTimeout(hashTimer); hashTimer = setTimeout(updateHash, 300); }
function updateHash() {
  const s = state, h = { v: s.view, u: s.units, band: +s.band.toPrecision(3), noise: s.noise, avg: Math.round(s.avg) };
  if (s.display !== 'real') h.show = s.display;
  if (s.view === 'two') { const sc = s.scene; h.th1 = sc.sources[0].theta; if (sc.sources[1]) { h.th2 = sc.sources[1].theta; h.i2 = sc.sources[1].I; } h.xa = +sc.xA.toPrecision(4); h.xb = +sc.xB.toPrecision(4); if (sc.ref) h.ref = sc.ref; }
  if (s.view === 'uv' || s.view === 'array') {
    if (s.sky.kind === 'points') { h.src = s.sky.preset; if (s.sky.rotation) h.rot = s.sky.rotation; if (s.sky.bright !== 1) h.bright = s.sky.bright; } else if (s.sky.picture !== 'own') h.pic = s.sky.picture;
    if (s.sky.size !== 1) h.size = +s.sky.size.toPrecision(3);
    if (s.mode !== 'complex') h.mode = s.mode;
  }
  if (s.view === 'uv') { const p = s.pair; h.bx = +p.bx.toPrecision(4); h.by = +p.by.toPrecision(4); if (p.cx || p.cy) { h.cx = +p.cx.toPrecision(4); h.cy = +p.cy.toPrecision(4); } if (p.fixA) h.fix = 1; if (s.sketch) h.keep = 1; }
  if (!s.tracking) h.track = 0;
  if (s.hbt) h.hbt = 1;
  if (s.coherent) { h.coh = 1; h.cph = s.cohPhase; }
  if (s.nu0) h.nu0 = +(s.nu0 / 1e6).toPrecision(4);
  if (s.view === 'array') { h.lay = s.layout; if (s.layout === 'ring' || s.layout === 'random') h.n = s.n; if (s.arm !== 1) h.arm = +s.arm.toPrecision(3); if (s.earth) { h.earth = 1; h.hours = s.hours; h.dec = s.dec; h.lat = s.lat; } if (s.weighting !== 'uniform') h.w = s.weighting; if (s.clean) { h.clean = 1; h.gain = s.gain; } }
  writeHash(h);
}

/** Load a saved state from the address (unknown keys are ignored). */
function loadHash(h) {
  const num = (k, lo, hi, d) => { const v = parseFloat(h[k]); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  state = DEFAULTS();
  const s = state;
  if (VIEWS[h.v]) s.view = h.v; else if (h.hours !== undefined || h.dec !== undefined || h.lay !== undefined) s.view = 'array';
  if (UNITS[h.u]) s.units = h.u;
  s.band = num('band', 0.01, 2, s.band); s.noise = num('noise', 0, 3, s.noise); s.avg = num('avg', 2, 200, s.avg);
  if (h.show === 'complex') s.display = 'complex';
  s.scene.sources[0].theta = num('th1', -60, 60, 10);
  if (h.th2 !== undefined) s.scene.sources.push({ theta: num('th2', -60, 60, -20), I: num('i2', 0, 2, 0.5) });
  const u = UNITS[s.units];
  s.scene.xA = num('xa', -u.uvMax / 2, u.uvMax / 2, -u.uvMax / 24); s.scene.xB = num('xb', -u.uvMax / 2, u.uvMax / 2, u.uvMax / 24); s.scene.ref = num('ref', -60, 60, 0);
  if (POINT_PRESETS[h.src]) { s.sky.kind = 'points'; s.sky.preset = h.src; } else if (PICTURES[h.pic] && h.pic !== 'own') { s.sky.kind = 'picture'; s.sky.picture = h.pic; }
  s.sky.size = num('size', 0.2, 2.5, 1); s.sky.rotation = num('rot', -180, 180, 0); s.sky.bright = num('bright', 0.1, 3, 1);
  if (MODES[h.mode] || h.mode === 'log') s.mode = h.mode;
  s.pair.bx = num('bx', -u.uvMax, u.uvMax, u.uvMax * 0.14); s.pair.by = num('by', -u.uvMax, u.uvMax, u.uvMax * 0.04);
  s.pair.cx = num('cx', -u.uvMax, u.uvMax, 0); s.pair.cy = num('cy', -u.uvMax, u.uvMax, 0); s.pair.fixA = h.fix === '1';
  s.sketch = h.keep === '1'; s.tracking = h.track !== '0'; s.hbt = h.hbt === '1'; s.coherent = h.coh === '1'; s.cohPhase = num('cph', 0, 360, 90);
  if (h.nu0) s.nu0 = num('nu0', 100, 1e6, 915) * 1e6;
  if (LAYOUTS[h.lay]) s.layout = h.lay;
  s.n = Math.round(num('n', 2, 30, 8)); s.arm = num('arm', 0.1, 2, 1);
  s.earth = h.earth === '1' || h.hours !== undefined; s.hours = num('hours', 0.5, 12, 8); s.dec = num('dec', -85, 85, 40); s.lat = num('lat', -85, 85, 34);
  if (h.w === 'natural') s.weighting = 'natural';
  s.clean = h.clean === '1'; s.gain = num('gain', 0.02, 0.5, 0.1);
  // The old arrays demo's saved states: its sky names.
  if (h.sky === 'double') { s.sky.kind = 'points'; s.sky.preset = 'binary'; } else if (h.sky === 'disk' || h.sky === 'ring' || h.sky === 'portrait') { s.sky.kind = 'picture'; s.sky.picture = h.sky; }
  applyState();
}

/** Put the whole state into the controls, the sky and the simulation. */
async function applyState() {
  const s = state;
  $('#main').dataset.view = s.view; viewSeg.value = s.view;
  $('#hint-uv').textContent = HINTS[s.view] || HINTS.uv;
  unitsSeg.value = s.units;
  sepSlider.setRange(-lenIn(U().uvMax / 2), lenIn(U().uvMax / 2));
  clearPaint();
  if (s.sky.kind === 'picture') { try { skyPicture = await pictureSky(s.sky.picture, s.sky.size, ownImage); } catch { skyPicture = null; s.sky.kind = 'points'; } }
  buildSky();
  if (s.view === 'array') buildArray();
  applySim();
  syncPanels();
  dirty();
}

// ------------------------------------------------------------------------- experiments

function setup(over) {
  state = DEFAULTS();
  const assign = (dst, src) => { for (const [k, v] of Object.entries(src)) { if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object') assign(dst[k], v); else dst[k] = v; } };
  assign(state, over);
  anim.earthPlaying = false; earthButton.textContent = 'Turn the Earth';
  return applyState().then(() => { scheduleHash(); });
}
const setups = {
  noise: () => setup({ view: 'one', band: 0.05 }),
  white: () => setup({ view: 'one', band: 2 }),
  envelope: () => setup({ view: 'one', band: 0.05, display: 'complex' }),
  fringe: () => setup({ view: 'two', band: 0.05, noise: 0.3, scene: { sources: [{ theta: 10, I: 1 }], xA: -0.5, xB: 0.5 } }),
  twosources: () => setup({ view: 'two', band: 0.05, noise: 0.3, scene: { sources: [{ theta: 10, I: 1 }, { theta: -20, I: 0.5 }], xA: -0.5, xB: 0.5 } }),
  delay: () => setup({ view: 'two', band: 0.4, noise: 0.2, tracking: false, scene: { sources: [{ theta: 30, I: 1 }], xA: -1.5, xB: 1.5, ref: 30 } }),
  uv: () => setup({ view: 'uv', band: 0.02, sky: { preset: 'pentagon' }, pair: { bx: 1.64, by: 0.5 } }),
  picture: () => setup({ view: 'uv', band: 0.02, sky: { kind: 'picture', picture: 'disk', size: 1 }, pair: { bx: 0.6, by: 0 } }),
  sketch: () => setup({ view: 'uv', band: 0.02, avg: 8, sky: { preset: 'triangle' }, sketch: true, pair: { bx: 0.6, by: 0.3 } }),
  nearfield: () => setup({ view: 'uv', units: 'benchNear', band: 0.02, sky: { preset: 'pentagon' }, pair: { bx: 2, by: 0 } }),
  array: () => setup({ view: 'array', units: 'vla', sky: { kind: 'picture', picture: 'galaxy' }, layout: 'y', arm: 1, earth: false }),
  rotation: () => setup({ view: 'array', units: 'vla', sky: { kind: 'picture', picture: 'galaxy' }, layout: 'y', arm: 1, earth: true, hours: 8, dec: 40 }),
  resolution: () => setup({ view: 'array', units: 'vla', sky: { preset: 'binary', size: 1 }, layout: 'y', arm: 0.11, earth: true, hours: 2, dec: 40 }),
  eht: () => setup({ view: 'array', units: 'eht', sky: { kind: 'picture', picture: 'ring', size: 1 }, layout: 'eht', earth: true, hours: 12, dec: 12.4, weighting: 'uniform' }),
  clean: () => setup({ view: 'array', units: 'vla', sky: { preset: 'binary' }, layout: 'y', arm: 0.3, earth: true, hours: 2, dec: 40, clean: true, cleanRun: 0 }),
  coherent: () => setup({ view: 'uv', band: 0.02, sky: { preset: 'pentagon' }, coherent: true, cohPhase: 90, pair: { bx: 1.64, by: 0.5 } }),
  hbt: () => setup({ view: 'uv', band: 0.05, avg: 40, sky: { preset: 'triangle' }, hbt: true, mode: 'intensity', pair: { bx: 1.0, by: 0.6 } }),
};
// The old antenna-arrays demo's synthesis experiments open the nearest one here.
const ALIASES = { six: 'array', ellipses: 'rotation', equator: 'rotation', shortspacing: 'resolution' };

const help = drawer($('#help'), $('#help-button'), setups);

// ------------------------------------------------------------------------- start

function fromAddress() {
  const h = readHash(), name = ALIASES[h.setup] || h.setup;
  if (setups[name]) { setups[name](); if (ALIASES[h.setup] === 'rotation' && h.setup === 'equator') { state.dec = 5; decSlider.value = 5; arrayDirty = true; } }
  else if (Object.keys(h).length) loadHash(h);
  else setups.noise();
}
window.addEventListener('resize', dirty);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', dirty);
document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
window.addEventListener('hashchange', fromAddress);
fromAddress();

// For the tests (tools/cdp.py) and for curious students with the console open.
window.__app = {
  sim, setups, anim, ready: true,
  get state() { return state; },
  setView,
  /** Hold the animation (the tests step the simulation themselves). */
  hold(on) { testHold = on; if (!on) kick(); },
  /** Advance n chunks and draw once. */
  step(n = 1) { for (let i = 0; i < n; i++) advance(); drawNow(); },
  draw: drawNow,
  skyModel: () => skyModel,
  idealAt: (u, v) => idealAt(skyModel, pix(), directions, u, v),
  expected: () => sim.expected(),
  baseline: () => sim.baseline(),
  lambda, uvMax, fov,
  paint: () => paint,
  array: () => { computeArray(); return { dishes, tr, sampled, beam, dirtyImg, cs }; },
  grid: ensureGrid,
  runClean, clearPaint, loadPicture,
  sceneGeometry: () => scene,
  sourcePoint,
};
