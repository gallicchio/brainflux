// Imaging: a 4f microscope whose pupil you can paint.  Abbe's theory of image formation, dark
// field, schlieren and Zernike's phase contrast.  Lengths in micrometres; the physics is in
// optics.js and the objects in objects.js.

import { spectrum, pupil as makePupil, shifted, coherentImage, otf, intensitySpectrum, incoherentImage,
  sourcePoints, PartialImage, stats, throughput, pxPerNA } from './optics.js';
import { grating, snapPeriod, barTarget, siemensStar, diatom, cells, edge, twoPoints, encode } from './objects.js';
import { colorize, colorOf } from '../lib/complexcolor.js';
import { fftCentered } from '../lib/fft.js';
import { paint as stamp } from '../fft2d/tools.js';
import { loadImage, imageData } from '../fft2d/presets.js';
import { el, $, slider, segmented, toggle, exprField, drawer, readHash, writeHash, fmt } from '../lib/ui.js';
import { Frame, themeColors } from '../lib/plot.js';

const N = 256;             // grid points across
const DX = 0.1;            // micrometres per point: the field of view is 25.6 um
const L = N * DX;
const C = N / 2;           // the centre pixel (x = 0, and f = 0)
const SPOKES = 18;         // the Siemens star's ink sectors

// ------------------------------------------------------------------------------- state

const DEFAULTS = {
  preset: 'cells',
  d: 1.28, profile: 'bars',          // grating
  spacing: 0.6,                      // diatom pores
  sep: 0.6, pphase: 0,               // two points: separation (um) and phase (degrees)
  enc: 'phase', absorb: 1, phi0: 0.3,
  objView: 'phase',
  NA: 0.5, lambda: 0.55, z: 0,
  filter: 'dot', stopNA: 0.02, dotPhase: -90, dotNA: 0.02, dotAmp: 1, knifeNA: 0, knifeAngle: 0,
  illum: 'coherent', condNA: 0.25, tiltNA: 0, tiltDir: 0,
  fpView: 'light', zoom: 4, fpBright: 0, fpLog: false, xzoom: 1,
  exposure: 'auto', imgBright: 0,
  row: C,
  formula: 'exp(i a (r < R))',
};
const state = { ...DEFAULTS, objTool: 'add', objBrush: 8, fpTool: 'block', fpBrush: 3, fpMirror: false };

const kappa = () => pxPerNA(N, DX, state.lambda);       // frequency pixels per unit of NA
const deg = Math.PI / 180;

// ------------------------------------------------------------------------------ the object

let ink = new Float64Array(N * N);   // 0 clear .. 1 inked
let base = null;                     // a transmission given directly (two points, formula)
let groups = null;                   // where the bar target's groups are, for labels
let t = null, T = null, S = null;    // the transmission, its spectrum, the spectrum of |t|^2
let fpAutoR = 1;                     // the Fourier plane's brightness
const scratch = new Float64Array(N * N);

function letters() {
  const s = 4, m = N * s, c = document.createElement('canvas');
  c.width = c.height = m;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, m, m);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(m * 0.23)}px system-ui, "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText('PHASE', m / 2, m * 0.5, m * 0.9);
  const data = ctx.getImageData(0, 0, m, m).data, g = new Float64Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let sum = 0;
    for (let b = 0; b < s; b++) for (let a = 0; a < s; a++) sum += data[4 * ((j * s + b) * m + i * s + a)];
    g[j * N + i] = sum / (255 * s * s);
  }
  return g;
}

async function portrait() {
  const [grey] = imageData(await loadImage('../fft2d/images/fourier-portrait.png'), N, 'fit');
  return grey.map((v) => 1 - v);
}

let formulaExpr = null, formulaParams = {};
function formulaField() {
  const xs = new Float64Array(N * N), ys = new Float64Array(N * N), rs = new Float64Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const o = j * N + i; xs[o] = (i - C) * DX; ys[o] = (C - j) * DX; rs[o] = Math.hypot(xs[o], ys[o]);
  }
  const re = new Float64Array(N * N), im = new Float64Array(N * N);
  if (!formulaExpr) { re.fill(1); return { re, im }; }
  const v = formulaExpr.evaluate({ ...formulaParams, x: xs, y: ys, r: rs }, N * N);
  for (let o = 0; o < N * N; o++) {
    const a = v.re[o], b = v.im ? v.im[o] : 0;
    if (Number.isFinite(a) && Number.isFinite(b)) { re[o] = a; im[o] = b; }
  }
  return { re, im };
}

const PRESETS = {
  grating: { label: 'Grating', enc: 'amplitude', title: 'Lines of one period: its light leaves in a few directions only (the orders)',
    make: () => grating(N, snapPeriod(state.d, N, DX).m, state.profile) },
  bars: { label: 'Bar target', enc: 'amplitude', rowY: 8.5, title: 'Groups of three bars, periods from 2 µm down to 0.4 µm',
    make: () => { const b = barTarget(N, DX); groups = b.groups; return b.g; } },
  star: { label: 'Siemens star', enc: 'amplitude', rowY: 2.5, title: '36 spokes whose period shrinks towards the centre',
    make: () => siemensStar(N, DX, SPOKES) },
  diatom: { label: 'Diatom', enc: 'amplitude', absorb: 0.7, title: 'A silica shell pierced by a lattice of pores (Abbe tested objectives on these)',
    make: () => diatom(N, DX, state.spacing) },
  cells: { label: 'Cells', enc: 'phase', phi0: 0.3, title: 'Transparent cells: they delay the light (phase) but hardly absorb it',
    make: () => cells(N, DX) },
  letters: { label: 'Letters', enc: 'phase', phi0: 0.5, title: 'Letters written in phase only', make: letters },
  portrait: { label: 'Fourier', enc: 'amplitude', title: 'Joseph Fourier (engraving, public domain): as ink, or written in phase', make: portrait },
  edge: { label: 'Edge', enc: 'amplitude', title: 'A wide clear band: two straight edges', make: () => edge(N) },
  points: { label: 'Two points', field: true, title: 'Two pinholes: Rayleigh’s criterion',
    make: () => twoPoints(N, Math.max(1, Math.round(state.sep / DX)), state.pphase * deg) },
  formula: { label: 'Formula', field: true, title: 'Type the transmission t(x, y)', make: formulaField },
};

let loadToken = 0;
async function loadPreset(id, opts = {}) {
  const token = ++loadToken, p = PRESETS[id] || PRESETS.cells;
  state.preset = PRESETS[id] ? id : 'cells';
  groups = null;
  const made = await p.make();
  if (token !== loadToken) return;
  if (p.field) { base = made; ink = new Float64Array(N * N); } else { base = null; ink = made; }
  if (opts.row !== false) state.row = C - Math.round((p.rowY || 0) / DX);
  rebright = true;
  syncControls();
  dirty.object = true;
  schedule();
}

let rebright = true;
let tmax = 0, phaseCache = null;       // max |T|; the object's phase range
function buildT() {
  const field = PRESETS[state.preset].field;
  t = encode(ink, field ? 'amplitude' : state.enc, field ? 1 : state.absorb, state.phi0, base, t);
  T = spectrum(t.re, t.im, N);
  S = null; phaseCache = null;
  tmax = 0;
  for (let o = 0; o < N * N; o++) { const m = T.re[o] * T.re[o] + T.im[o] * T.im[o]; if (m > tmax) tmax = m; }
  tmax = Math.sqrt(tmax);
  if (rebright) { fpAutoR = transformBrightness(T); rebright = false; }
}

/** A brightness for a spectrum: bright enough that more than the zero order shows (as in fft2d). */
function transformBrightness({ re, im }) {
  const mags = new Float64Array(re.length);
  let max = 0;
  for (let i = 0; i < re.length; i++) { mags[i] = Math.hypot(re[i], im[i]); if (mags[i] > max) max = mags[i]; }
  if (max === 0) return 1;
  mags.sort();
  return Math.max(mags[Math.floor(0.985 * (mags.length - 1))], 1e-2 * max);
}

// ------------------------------------------------------------------------------ the pupil

const paintLayer = { re: new Float64Array(N * N), im: new Float64Array(N * N), mask: new Float64Array(N * N), used: false };
function clearPaint() { paintLayer.re.fill(0); paintLayer.im.fill(0); paintLayer.mask.fill(0); paintLayer.used = false; }

function pupilOptions(withDefocus = true) {
  const k = kappa(), o = { cut: state.NA * k, paint: paintLayer.used ? paintLayer : null };
  if (state.filter === 'stop') o.stop = state.stopNA * k;
  if (state.filter === 'dot') o.dot = { r: state.dotNA * k, phase: state.dotPhase * deg, amp: state.dotAmp };
  if (state.filter === 'knife') o.knife = { e: state.knifeNA * k, angle: state.knifeAngle * deg };
  if (withDefocus && state.z) o.defocus = (Math.PI * state.lambda * state.z) / (L * L);
  return o;
}

let P = null, O = null;   // the pupil, the OTF
// How the pupil is drawn over the light: a brightness factor per pixel (dim what it blocks) and
// a tint (the colour of its phase, defocus aside) where it shifts the phase.
const overlay = { f: new Float32Array(N * N), tint: new Uint8ClampedArray(3 * N * N), has: new Uint8Array(N * N) };
function buildP() {
  P = makePupil(N, pupilOptions(true));
  const shape = state.z ? makePupil(N, pupilOptions(false)) : P;
  O = null;
  overlay.has.fill(0);
  for (let o = 0; o < N * N; o++) {
    const a = Math.hypot(shape.re[o], shape.im[o]);
    overlay.f[o] = a < 0.999 ? 0.22 + 0.78 * Math.min(1, a) : 1;
    if (a > 1e-6 && Math.abs(shape.im[o]) > 1e-3 * a) {
      const c = colorOf(shape.re[o], shape.im[o], a);
      overlay.has[o] = 1; overlay.tint[3 * o] = c[0]; overlay.tint[3 * o + 1] = c[1]; overlay.tint[3 * o + 2] = c[2];
    }
  }
}

function tiltPx() {
  const k = kappa();
  return [Math.round(state.tiltNA * Math.cos(state.tiltDir * deg) * k), Math.round(state.tiltNA * Math.sin(state.tiltDir * deg) * k)];
}

// ------------------------------------------------------------------------------ the image

let I = new Float64Array(N * N).fill(1);
const partial = new PartialImage(N);
const Ts = { re: new Float64Array(N * N), im: new Float64Array(N * N) };   // the spectrum, tilted

function startImage() {
  const [sx, sy] = tiltPx();
  shifted(T, N, sx, sy, Ts);
  if (state.illum === 'incoherent') {
    S = S || intensitySpectrum(t, N);
    O = O || otf(P, N);
    I = incoherentImage(S, O, N);
  } else if (state.illum === 'condenser') {
    partial.start(T, P, sourcePoints(state.condNA * kappa(), sx, sy, 40));
  } else {
    I = coherentImage(Ts, P, N);
  }
}

// ------------------------------------------------------------------------------ the frame loop

const dirty = { object: true, pupil: true, image: true };
const need = { obj: true, fp: true, img: true };
let raf = 0;
function schedule() { if (!raf) raf = requestAnimationFrame(frame); }
function changed(what) {
  if (what === 'object') dirty.object = true;
  else if (what === 'pupil') dirty.pupil = true;
  else if (what === 'image') dirty.image = true;
  else if (what === 'fp') need.fp = true;
  else if (what === 'obj') need.obj = true;
  else if (what === 'img') need.img = true;
  schedule();
  hashSoon();
}

const timing = {};
const timed = (name, f) => { const t = performance.now(); f(); timing[name] = performance.now() - t; };
function frame() {
  raf = 0;
  if (!ready) return;
  const t0 = performance.now();
  for (const k in timing) delete timing[k];
  if (dirty.object) { timed('object', buildT); dirty.object = false; dirty.image = true; need.obj = need.fp = true; }
  if (dirty.pupil) { timed('pupil', buildP); dirty.pupil = false; dirty.image = true; need.fp = true; }
  if (dirty.image) { timed('image', startImage); dirty.image = false; need.img = true; need.fp = true; }
  if (state.illum === 'condenser' && !partial.done) {
    do partial.step(1); while (!partial.done && performance.now() - t0 < 22);
    I = partial.image; need.img = true;
    if (!partial.done) schedule();
  }
  if (state.fpView === 'otf' && !O) { O = otf(P, N); need.fp = true; }
  if (need.obj) timed('drawObject', drawObject);
  if (need.fp) timed('drawFourier', drawFourier);
  if (need.img) { timed('drawImage', drawImage); timed('drawProfile', drawProfile); timed('readouts', readouts); }
  need.obj = need.fp = need.img = false;
  timing.total = performance.now() - t0;
}

// ------------------------------------------------------------------------------ drawing

const dpr = () => window.devicePixelRatio || 1;
const sizes = new Map();   // canvas -> [width, height] in device pixels, kept by a ResizeObserver
const sizeObserver = new ResizeObserver((entries) => {
  for (const e of entries) {
    const box = e.devicePixelContentBoxSize?.[0];
    sizes.set(e.target, box ? [box.inlineSize, box.blockSize] : [Math.round(e.contentRect.width * dpr()), Math.round(e.contentRect.height * dpr())]);
  }
  need.obj = need.fp = need.img = true;
  schedule();
});
function canvasSize(cv) {
  let [w, h] = sizes.get(cv) || [0, 0];
  if (!w || !h) { const r = cv.getBoundingClientRect(); w = Math.round(r.width * dpr()); h = Math.round(r.height * dpr()); }
  w = Math.max(1, w); h = Math.max(1, h);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return [w, h];
}

class Layer {
  constructor(m = N) { this.c = document.createElement('canvas'); this.ctx = this.c.getContext('2d'); this.size(m); }
  size(m) {
    if (this.m === m) return;
    this.m = m; this.c.width = this.c.height = m; this.img = this.ctx.createImageData(m, m);
  }
  put() { this.ctx.putImageData(this.img, 0, 0); }
}
// The pixels of the N x N grid that a view magnified `zoom` times shows, row by row.
const windows = new Map();
function windowMap(zoom) {
  if (!windows.has(zoom)) {
    const v = N / zoom, o = (N - v) / 2, map = new Int32Array(v * v);
    for (let j = 0; j < v; j++) for (let i = 0; i < v; i++) map[j * v + i] = (o + j) * N + o + i;
    windows.set(zoom, map);
  }
  return windows.get(zoom);
}
const layers = { obj: new Layer(), fp: new Layer(), img: new Layer() };

// Intensities 0..1 to sRGB grey, so that the screen's luminance is proportional to I.
const GREY = new Uint8ClampedArray(4096);
for (let q = 0; q < 4096; q++) { const x = q / 4095; GREY[q] = 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055); }
function greyInto(d, values, scale, offset = 0) {
  for (let o = 0, p = 0; o < values.length; o++, p += 4) {
    let v = (values[o] - offset) * scale;
    v = v <= 0 ? 0 : v >= 1 ? 4095 : (v * 4095) | 0;
    const g = GREY[v];
    d[p] = g; d[p + 1] = g; d[p + 2] = g; d[p + 3] = 255;
  }
}

// Viridis (a perceptually even colour map) for the phase, from Matt Zucker's polynomial fit.
const VIRIDIS = (() => {
  const c = [[0.2777273272234177, 0.005407344544966578, 0.3340998053353061], [0.1050930431085774, 1.404613529898575, 1.384590162594685],
    [-0.3308618287255563, 0.214847559468213, 0.09509516302823659], [-4.634230498983486, -5.799100973351585, -19.33244095627987],
    [6.228269936347081, 14.17993336680509, 56.69055260068105], [4.776384997670288, -13.74514537774601, -65.35303263337234],
    [-5.435455855934631, 4.645852612178535, 26.3124352495832]];
  const lut = new Uint8ClampedArray(256 * 3);
  for (let q = 0; q < 256; q++) {
    const x = q / 255;
    for (let k = 0; k < 3; k++) { let v = 0; for (let m = 6; m >= 0; m--) v = v * x + c[m][k]; lut[3 * q + k] = 255 * v; }
  }
  return lut;
})();

function phaseRange() {
  if (phaseCache) return phaseCache;
  let lo = Infinity, hi = -Infinity;
  for (let o = 0; o < N * N; o++) {
    if (t.re[o] * t.re[o] + t.im[o] * t.im[o] < 0.0025) continue;
    const p = Math.atan2(t.im[o], t.re[o]);
    if (p < lo) lo = p; if (p > hi) hi = p;
  }
  if (!(hi >= lo)) { lo = 0; hi = 0; }
  if (Math.abs(lo) < 1e-9) lo = 0;
  return (phaseCache = [lo, hi]);
}

function blit(cv, layer, zoom = 1) {
  const [w, h] = canvasSize(cv), ctx = cv.getContext('2d');
  const v = N / zoom, o = (N - v) / 2;
  ctx.imageSmoothingEnabled = false;
  // A layer holding the whole grid is cut; one holding only the window is drawn whole.
  if (layer.m === N) ctx.drawImage(layer.c, o, o, v, v, 0, 0, w, h);
  else ctx.drawImage(layer.c, 0, 0, layer.m, layer.m, 0, 0, w, h);
  return { ctx, w, h, s: w / v, o };
}

const OVERLAY = 'rgba(255,255,255,0.85)';
/** Text on a translucent dark tag, readable on black and on white. */
function label(ctx, text, x, y, align = 'left', color = OVERLAY) {
  const d = dpr();
  ctx.font = `${11 * d}px system-ui, sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width, x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x0 - 3 * d, y - 7.5 * d, w + 6 * d, 15 * d);
  ctx.fillStyle = color; ctx.fillText(text, x0, y + 0.5 * d);
}

/** A bar `len` long in canvas pixels, labelled, at the bottom left. */
function scaleBar(ctx, h, len, text) {
  const d = dpr();
  label(ctx, text, 10 * d, h - 26 * d);
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(7 * d, h - 17 * d, len + 6 * d, 9 * d);
  ctx.fillStyle = OVERLAY; ctx.fillRect(10 * d, h - 14 * d, len, 3 * d);
}

/** Micrometres to canvas pixels in the (magnified) object and image views. */
function xyMap(w) {
  const v = N / state.xzoom, o = (N - v) / 2, s = w / v;
  return { X: (x) => (C + 0.5 + x / DX - o) * s, Y: (y) => (C + 0.5 - y / DX - o) * s, s, um: s / DX };
}
const SCALE = { 1: [5, '5 µm'], 2: [2, '2 µm'], 4: [1, '1 µm'] };

function rowLine(ctx, w, h) {
  const d = dpr(), y = xyMap(w).Y((C - state.row) * DX);
  ctx.save();
  ctx.setLineDash([5 * d, 4 * d]); ctx.lineWidth = 1.2 * d;
  ctx.strokeStyle = 'rgba(255,200,40,0.85)';
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  ctx.restore();
}

/** The radius (um) inside which the Siemens star's spokes are finer than the cutoff frequency. */
function starRadius() {
  const fc = cutoff().f;
  return fc > 0 ? SPOKES / (2 * Math.PI * fc) : Infinity;
}

function drawObject() {
  const d = layers.obj.img.data;
  let legend = null;
  if (state.objView === 'amplitude') {
    const a2 = new Float64Array(N * N);
    for (let o = 0; o < N * N; o++) a2[o] = t.re[o] * t.re[o] + t.im[o] * t.im[o];
    greyInto(d, a2, 1);
  } else {
    const [lo, hi] = phaseRange(), span = hi - lo > 1e-9 ? hi - lo : 1;
    for (let o = 0, p = 0; o < N * N; o++, p += 4) {
      const m2 = t.re[o] * t.re[o] + t.im[o] * t.im[o];
      if (m2 < 0.0025) { d[p] = d[p + 1] = d[p + 2] = 0; d[p + 3] = 255; continue; }
      const q = 3 * Math.max(0, Math.min(255, Math.round(((Math.atan2(t.im[o], t.re[o]) - lo) / span) * 255)));
      d[p] = VIRIDIS[q]; d[p + 1] = VIRIDIS[q + 1]; d[p + 2] = VIRIDIS[q + 2]; d[p + 3] = 255;
    }
    legend = [lo, hi];
  }
  layers.obj.put();
  const { ctx, w, h } = blit($('#object'), layers.obj, state.xzoom);
  const dd = dpr(), map = xyMap(w), [len, text] = SCALE[state.xzoom];
  rowLine(ctx, w, h);
  scaleBar(ctx, h, len * map.um, text);
  if (groups && state.preset === 'bars') {
    // Each group's period (um), under it.
    for (const g of groups) label(ctx, fmt(g.p, 2), map.X(g.x), map.Y(g.y - 3 * g.p - 1.0), 'center', 'rgb(255,170,60)');
  }
  if (legend) {
    // A colour bar, bottom right.
    const bw = 70 * dd, bh = 7 * dd, x0 = w - bw - 10 * dd, y0 = h - 15 * dd;
    for (let k = 0; k < bw; k++) {
      const q = 3 * Math.round((k / (bw - 1)) * 255);
      ctx.fillStyle = `rgb(${VIRIDIS[q]},${VIRIDIS[q + 1]},${VIRIDIS[q + 2]})`;
      ctx.fillRect(x0 + k, y0, 1, bh);
    }
    const [lo, hi] = legend;
    label(ctx, `${fmt(lo, 2)}`, x0, y0 - 8 * dd, 'center');
    label(ctx, hi - lo > 1e-9 ? `${fmt(hi, 2)} rad` : 'rad', x0 + bw, y0 - 8 * dd, 'right');
  }
}

function drawFourier() {
  const [sx, sy] = tiltPx(), view = state.fpView, map = windowMap(state.zoom);
  layers.fp.size(N / state.zoom);
  const d = layers.fp.img.data;
  if (view === 'pupil') colorize(P.re, P.im, d, 1, 'complex', map);
  else if (view === 'otf') colorize(O.re, O.im, d, 0.3, 'complex', map);
  else {
    let src = Ts, R = fpAutoR * 10 ** -state.fpBright;
    if (state.fpLog) {
      // Lightness proportional to log |T|, over 4 decades below the strongest point (more or
      // fewer with the brightness slider): rescale each |T| so that colorize's arctan gives
      // lightness 0.85 v.
      src = { re: new Float64Array(N * N), im: new Float64Array(N * N) };
      const decades = Math.max(1, 4 + 2 * state.fpBright), floor = tmax * 10 ** -decades;
      for (const o of map) {
        const m = Math.hypot(Ts.re[o], Ts.im[o]);
        if (!m) continue;
        const v = Math.min(1, Math.max(0, Math.log10(m / floor) / decades)), f = Math.tan(0.85 * (Math.PI / 2) * v) / m;
        src.re[o] = Ts.re[o] * f; src.im[o] = Ts.im[o] * f;
      }
      R = 1;
    }
    colorize(src.re, src.im, d, R, 'complex', map);
    // Dim what the pupil blocks; tint what it shifts in phase (defocus aside).
    const { f, tint, has } = overlay;
    for (let a = 0, p = 0; a < map.length; a++, p += 4) {
      const o = map[a], k = f[o];
      if (k !== 1) { d[p] *= k; d[p + 1] *= k; d[p + 2] *= k; }
      if (has[o]) { const q = 3 * o; d[p] = 0.55 * d[p] + 0.45 * tint[q]; d[p + 1] = 0.55 * d[p + 1] + 0.45 * tint[q + 1]; d[p + 2] = 0.55 * d[p + 2] + 0.45 * tint[q + 2]; }
    }
  }
  layers.fp.put();
  const cv = $('#fourier');
  const { ctx, w, s, o } = blit(cv, layers.fp, state.zoom);
  const dd = dpr(), k = kappa();
  const X = (u) => (C + 0.5 + u - o) * s, Y = (v) => (C + 0.5 - v - o) * s;   // frequency pixels to canvas
  ctx.save();
  ctx.lineWidth = 1.4 * dd;
  const circle = (u, v, r, color, dash = null) => {
    ctx.strokeStyle = color; ctx.setLineDash(dash || []);
    ctx.beginPath(); ctx.arc(X(u), Y(v), Math.max(r * s, 2.5 * dd), 0, 2 * Math.PI); ctx.stroke();
  };
  if (view === 'otf') {
    circle(0, 0, 2 * state.NA * k, 'rgba(255,255,255,0.55)', [5 * dd, 4 * dd]);
    label(ctx, 'cutoff 2NA/λ', X(0) + 2 * state.NA * k * s * 0.72, Y(0) - 2 * state.NA * k * s * 0.72 - 8 * dd);
  } else {
    const R = state.NA * k;
    circle(0, 0, R, 'rgba(255,255,255,0.8)');
    label(ctx, `NA ${fmt(state.NA, 3)}`, X(0) + R * s * 0.72 + 4 * dd, Y(0) - R * s * 0.72 - 6 * dd);
    if (state.filter === 'stop') circle(0, 0, state.stopNA * k, 'rgba(255,255,255,0.9)', [3 * dd, 3 * dd]);
    if (state.filter === 'dot') {
      const c = colorOf(Math.cos(state.dotPhase * deg), Math.sin(state.dotPhase * deg), 0.6);
      circle(0, 0, Math.max(state.dotNA * k, 0.5), `rgb(${c[0]},${c[1]},${c[2]})`);
    }
    if (state.filter === 'knife') {
      // Pixels with u ca + v sa >= e are kept: the edge runs half a pixel below that line.
      const a = state.knifeAngle * deg, e = state.knifeNA * k - 0.5, ca = Math.cos(a), sa = Math.sin(a);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(X(e * ca - N * sa), Y(e * sa + N * ca));
      ctx.lineTo(X(e * ca + N * sa), Y(e * sa - N * ca));
      ctx.stroke();
    }
    if (state.illum === 'condenser') {
      circle(sx, sy, state.condNA * k, 'rgba(120,200,255,0.9)', [4 * dd, 3 * dd]);
    }
    // A grating's orders are single points: ring and number them (white: through the pupil).
    for (const { q, u, v, pass } of gratingOrderList() || []) {
      const x = X(u), y = Y(v);
      if (x < 0 || x > w || y < 0 || y > w) continue;
      const col = pass ? 'rgba(255,255,255,0.95)' : 'rgba(255,110,110,0.95)';
      ctx.strokeStyle = col; ctx.setLineDash([]); ctx.lineWidth = 1.2 * dd;
      ctx.beginPath(); ctx.arc(x, y, 5 * dd, 0, 2 * Math.PI); ctx.stroke();
      label(ctx, orderName(q), x, y - 15 * dd, 'center', col);
    }
    if (state.tiltNA > 0 && state.illum !== 'incoherent') {
      ctx.strokeStyle = 'rgba(120,200,255,0.9)'; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(sx), Y(sy)); ctx.stroke();
      circle(sx, sy, 1.2, 'rgba(120,200,255,0.95)');
    }
  }
  ctx.restore();
  // A scale bar: sin(theta) = 0.5 (a frequency 0.5 / lambda), or 0.2 when magnified.
  const step = state.zoom >= 4 ? 0.2 : 0.5;
  scaleBar(ctx, cv.height, step * k * s, `sin θ = ${step}`);
}

// The grey scale: the brightest point white ('auto'), clear glass white ('fixed'), or the darkest
// point black and the brightest white ('stretch': faint contrast made visible, as a camera's
// contrast stretch does; a uniform image, to round-off, stays uniform).
let exposure = 1, offset = 0;
function drawImage() {
  const s = stats(I), gain = 10 ** state.imgBright;
  offset = 0;
  if (state.exposure === 'fixed') exposure = gain;
  else if (state.exposure === 'stretch' && s.max - s.min > 1e-9 * s.max) { offset = s.min; exposure = gain / (s.max - s.min); }
  else exposure = (s.max > 0 ? 1 / s.max : 1) * gain;
  greyInto(layers.img.img.data, I, exposure, offset);
  layers.img.put();
  const { ctx, w, h } = blit($('#image'), layers.img, state.xzoom);
  const map = xyMap(w), [len, text] = SCALE[state.xzoom];
  rowLine(ctx, w, h);
  scaleBar(ctx, h, len * map.um, text);
  if (state.preset === 'star') {
    // Inside this circle the spokes' period 2 pi r / 18 is finer than the cutoff.
    const r = starRadius(), dd = dpr();
    if (r < L / 2) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,90,90,0.9)'; ctx.setLineDash([5 * dd, 4 * dd]); ctx.lineWidth = 1.4 * dd;
      ctx.beginPath(); ctx.arc(map.X(0), map.Y(0), r * map.um, 0, 2 * Math.PI); ctx.stroke();
      ctx.restore();
      label(ctx, `period ${cutoff().name}`, map.X(0), map.Y(r) - 10 * dd, 'center', 'rgb(255,150,150)');
    }
  }
}

/** The finest period the light can carry: its spatial frequency and how it is named. */
function cutoff() {
  if (state.illum === 'incoherent') return { f: (2 * state.NA) / state.lambda, name: 'λ/2NA' };
  if (state.illum === 'condenser') return { f: (state.NA + Math.min(state.condNA, state.NA)) / state.lambda, name: 'λ/(NA+NAc)' };
  return { f: state.NA / state.lambda, name: 'λ/NA' };
}

// The profile: the image along the dashed row, with the object (or a formula) to compare.
function profileReference() {
  const row = state.row * N, field = PRESETS[state.preset].field;
  if (state.preset === 'points') return null;
  if (field || state.enc !== 'phase') {
    const v = new Float64Array(N);
    for (let i = 0; i < N; i++) v[i] = t.re[row + i] ** 2 + t.im[row + i] ** 2;
    return { v, label: 'object |t|²', axis: 'left' };
  }
  // A phase object.  With a phase dot (and nothing else changed), the small-phase formula
  // I = a^2 + 2 a sin(alpha) (phi - phi_mean); otherwise the phase itself.
  const [sx, sy] = tiltPx();
  let mr = 0, mi = 0;
  for (let o = 0; o < N * N; o++) { mr += t.re[o]; mi += t.im[o]; }
  const mean = Math.atan2(mi, mr), v = new Float64Array(N);
  for (let i = 0; i < N; i++) v[i] = Math.atan2(t.im[row + i], t.re[row + i]) - mean;
  if ((state.filter === 'dot' || state.filter === 'open') && !state.z && !sx && !sy && state.illum === 'coherent' && !paintLayer.used) {
    const a = state.filter === 'dot' ? state.dotAmp : 1, al = state.filter === 'dot' ? state.dotPhase * deg : 0;
    for (let i = 0; i < N; i++) v[i] = a * a + 2 * a * Math.sin(al) * v[i];
    return { v, label: 'small-phase formula', axis: 'left' };
  }
  return { v, label: 'phase φ − φ̄ (rad, right)', axis: 'right' };
}

let profilePeriod = null, colors = null;   // the theme's colours, read once (and again when it changes)
function drawProfile() {
  // Sized from the ResizeObserver, drawn in CSS pixels.
  const cv = $('#profile'), [W, H] = canvasSize(cv), dd = dpr(), ctx = cv.getContext('2d'), width = W / dd, height = H / dd;
  ctx.setTransform(dd, 0, 0, dd, 0, 0);
  const col = colors || (colors = themeColors());
  ctx.clearRect(0, 0, width, height);
  const row = I.subarray(state.row * N, state.row * N + N), ref = profileReference();
  let hi = 0;
  for (const v of row) hi = Math.max(hi, v);
  if (ref && ref.axis === 'left') for (const v of ref.v) hi = Math.max(hi, Math.min(v, 4 * hi + 1));
  hi = hi > 0 ? hi * 1.08 : 1;
  const f = new Frame(ctx, width, height, { left: 44, right: ref && ref.axis === 'right' ? 46 : 14, top: 18, bottom: 34 });
  const half = L / 2 / state.xzoom, i0 = Math.round(C - half / DX), i1 = Math.round(C + half / DX) - 1;
  f.x0 = -half; f.x1 = half; f.y0 = 0; f.y1 = hi;
  f.axes({ xlabel: 'x (µm)', ylabel: 'I', colors: col });
  f.clip();
  const X = (i) => f.X((i - C) * DX);
  if (ref) {
    let Y = (v) => f.Y(v);
    if (ref.axis === 'right') {
      let lo = Infinity, top = -Infinity;
      for (const v of ref.v) { lo = Math.min(lo, v); top = Math.max(top, v); }
      if (top - lo < 1e-6) { lo -= 0.5; top += 0.5; }
      const pad = 0.1 * (top - lo);
      ctx.restore();
      Y = f.rightAxis(lo - pad, top + pad, '', col);
      f.clip();
    }
    ctx.strokeStyle = col.ink3; ctx.lineWidth = 1.3; ctx.setLineDash([5, 4]);
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) { const x = X(i), y = Y(ref.v[i]); i > i0 ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.strokeStyle = col.accent; ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (let i = i0; i <= i1; i++) { const x = X(i), y = f.Y(row[i]); i > i0 ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke();
  ctx.restore();
  // Legend.
  ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  let x = f.left + 8;
  const key = (text, color, dash) => {
    ctx.strokeStyle = color; ctx.lineWidth = dash ? 1.3 : 1.8; ctx.setLineDash(dash ? [5, 4] : []);
    ctx.beginPath(); ctx.moveTo(x, 9); ctx.lineTo(x + 18, 9); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = col.ink2; ctx.fillText(text, x + 22, 9);
    x += 30 + ctx.measureText(text).width;
  };
  key('image I', col.accent, false);
  if (ref) key(ref.label, col.ink3, true);
  // The strongest period along the line.
  const re = Float64Array.from(row), im = new Float64Array(N);
  let mean = 0; for (const v of row) mean += v / N;
  for (let i = 0; i < N; i++) re[i] -= mean;
  fftCentered(re, im);
  let best = 0, kb = 0, total = 0;
  for (let q = 1; q < N / 2; q++) { const p = re[C + q] ** 2 + im[C + q] ** 2; total += p; if (p > best) { best = p; kb = q; } }
  // Only when one period dominates the line (a grating, not a cell).
  profilePeriod = ['grating', 'formula'].includes(state.preset) && kb && best > 0.6 * total && mean > 0 && Math.sqrt(2 * best / N) > 0.01 * mean ? L / kb : null;
  ctx.textAlign = 'right'; ctx.fillStyle = col.ink2;
  ctx.fillText(profilePeriod ? `strongest period along the line: ${fmt(profilePeriod, 3)} µm` : '', f.right - 4, 9);
}

// ------------------------------------------------------------------------------ readouts

/** The grating's orders: where each is in the Fourier plane (with the tilt) and whether it gets through. */
function gratingOrderList() {
  if (state.preset !== 'grating' || !T || !P) return null;
  const m = snapPeriod(state.d, N, DX).m, [sx, sy] = tiltPx(), out = [];
  const K = Math.floor((N / 2 - 1) / m);
  for (let q = -K; q <= K; q++) {
    const src = C * N + C + q * m;
    if (Math.hypot(T.re[src], T.im[src]) < 1e-6 * tmax) continue;  // a missing order
    const i = (((C + sx + q * m) % N) + N) % N, j = (((C - sy) % N) + N) % N;
    out.push({ q, u: sx + q * m, v: sy, pass: Math.hypot(P.re[j * N + i], P.im[j * N + i]) > 1e-9 });
  }
  return out;
}
function gratingOrders() {
  if (state.illum === 'incoherent') return null;
  const list = gratingOrderList();
  return list && list.filter((o) => o.pass).map((o) => o.q);
}
const orderName = (q) => (q > 0 ? '+' + q : q === 0 ? '0' : '−' + -q);

function readouts() {
  const s = stats(I), [sx, sy] = tiltPx();
  const p = PRESETS[state.preset];
  // The object.
  let obj = '';
  if (state.preset === 'grating') {
    const g = snapPeriod(state.d, N, DX);
    obj = `period d = ${fmt(g.d, 3)} µm (${g.m} across); orders at sin θ = ${fmt(state.lambda / g.d, 3)} × m`;
  } else if (state.preset === 'diatom') obj = `pore rows ${fmt(state.spacing * Math.sqrt(3) / 2, 3)} µm apart: λ/d = ${fmt(state.lambda / (state.spacing * Math.sqrt(3) / 2), 3)}`;
  else if (state.preset === 'points') obj = `${fmt(Math.round(state.sep / DX) * DX, 3)} µm apart = ${fmt(Math.round(state.sep / DX) * DX * state.NA / state.lambda, 3)} λ/NA`;
  else if (state.preset === 'bars') obj = 'bar periods in µm (orange)';
  else if (state.objView === 'phase') { const [lo, hi] = phaseRange(); obj = `phase φ from ${fmt(lo, 3)} to ${fmt(hi, 3)} rad`; }
  else {
    let lo = Infinity, hi = 0;
    for (let o = 0; o < N * N; o++) { const a2 = t.re[o] ** 2 + t.im[o] ** 2; lo = Math.min(lo, a2); hi = Math.max(hi, a2); }
    obj = `transmitted intensity |t|² from ${fmt(lo, 3)} to ${fmt(hi, 3)}`;
  }
  objNote = obj;
  if (!hover.obj) show('#obj-read', obj);
  // The Fourier plane.
  const orders = gratingOrders();
  let fp;
  if (state.illum === 'incoherent') fp = `OTF reaches 2NA/λ = ${fmt((2 * state.NA) / state.lambda, 3)} cycles/µm`;
  else if (orders) fp = `orders through the pupil: ${orders.length ? orders.map(orderName).join(', ') : 'none'}`;
  else fp = `light through the pupil: ${fmt(100 * throughput(Ts, P, N), 3)}%`;
  fpNote = fp;
  if (!hover.fp) show('#fp-read', fp);
  // The image.
  let im = `I from ${fmt(s.min, 3)} to ${fmt(s.max, 3)}, contrast ${s.contrast < 1e-9 ? 0 : fmt(s.contrast, 2)}`;
  if (state.illum === 'condenser' && !partial.done) im += ` · ${partial.count}/${partial.points.length} directions`;
  imgNote = im;
  if (!hover.img) show('#img-read', im);
  // The limit.
  const c = cutoff();
  let lim = `Smallest period through the pupil: <b>${c.name} = ${fmt(1 / c.f, 3)} µm</b>`;
  if (state.illum === 'coherent') lim += sx || sy ? ` on axis; tilted light reaches λ/(NA + sin θ) = ${fmt(state.lambda / (state.NA + state.tiltNA), 3)} µm in one direction` : ' (light along the axis)';
  if (state.illum === 'incoherent') lim += `; Rayleigh 0.61λ/NA = ${fmt((0.61 * state.lambda) / state.NA, 3)} µm`;
  show('#limit', lim);
}
let objNote = '', fpNote = '', imgNote = '';
const shown = new Map();
function show(sel, html) { if (shown.get(sel) !== html) { shown.set(sel, html); $(sel).innerHTML = html; } }
const hover = { obj: false, fp: false, img: false };

// ------------------------------------------------------------------------------ pointers

function pixelOf(cv, e, zoom = 1) {
  const r = cv.getBoundingClientRect(), v = N / zoom, o = (N - v) / 2;
  const fx = o + ((e.clientX - r.left) / r.width) * v, fy = o + ((e.clientY - r.top) / r.height) * v;
  return { i: Math.max(0, Math.min(N - 1, Math.floor(fx))), j: Math.max(0, Math.min(N - 1, Math.floor(fy))) };
}

// The object: paint ink on or off.
const objCanvas = $('#object');
let objDrag = null;
function paintObject(p, from) {
  const brush = { shape: 'round', size: state.objBrush };
  const v = state.objTool === 'add' ? 1 : 0;
  if (from) {
    const dist = Math.hypot(p.i - from.i, p.j - from.j), steps = Math.max(1, Math.ceil(dist / Math.max(0.5, state.objBrush / 3)));
    for (let s = 1; s <= steps; s++) stamp(ink, scratch, N, Math.round(from.i + ((p.i - from.i) * s) / steps), Math.round(from.j + ((p.j - from.j) * s) / steps), brush, v, 0);
  } else stamp(ink, scratch, N, p.i, p.j, brush, v, 0);
  changed('object');
}
objCanvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  objCanvas.setPointerCapture(e.pointerId);
  objDrag = pixelOf(objCanvas, e, state.xzoom);
  paintObject(objDrag, null);
  e.preventDefault();
});
objCanvas.addEventListener('pointermove', (e) => {
  const p = pixelOf(objCanvas, e, state.xzoom);
  showObjHover(p);
  if (!objDrag) return;
  paintObject(p, objDrag);
  objDrag = p;
});
for (const ev of ['pointerup', 'pointercancel']) objCanvas.addEventListener(ev, () => { objDrag = null; });
objCanvas.addEventListener('pointerleave', () => { hover.obj = false; show('#obj-read', objNote); });
function showObjHover({ i, j }) {
  if (!ready) return;
  hover.obj = true;
  const o = j * N + i, a2 = t.re[o] ** 2 + t.im[o] ** 2, ph = Math.atan2(t.im[o], t.re[o]);
  shown.delete('#obj-read');
  $('#obj-read').textContent = `x ${fmt((i - C) * DX, 3)}, y ${fmt((C - j) * DX, 3)} µm: |t|² ${fmt(a2, 3)}${a2 > 1e-6 ? `, φ ${fmt(ph, 3)} rad` : ''}`;
}

// The Fourier plane: paint the pupil, or drag the light (tilt).
const fpCanvas = $('#fourier');
let fpDrag = null;
const PAINT = { block: [0, 0], open: [1, 0], plus: [0, 1], minus: [0, -1] };
function paintPupil(p, from) {
  const brush = { shape: 'round', size: state.fpBrush };
  const pts = [];
  if (from) {
    const dist = Math.hypot(p.i - from.i, p.j - from.j), steps = Math.max(1, Math.ceil(dist / Math.max(0.5, state.fpBrush / 3)));
    for (let s = 1; s <= steps; s++) pts.push([Math.round(from.i + ((p.i - from.i) * s) / steps), Math.round(from.j + ((p.j - from.j) * s) / steps)]);
  } else pts.push([p.i, p.j]);
  for (const [i, j] of pts) {
    const at = state.fpMirror ? [[i, j], [(N - i) % N, (N - j) % N]] : [[i, j]];
    for (const [a, b] of at) {
      if (state.fpTool === 'erase') stamp(paintLayer.mask, scratch, N, a, b, brush, 0, 0);
      else {
        const [vr, vi] = PAINT[state.fpTool];
        stamp(paintLayer.re, paintLayer.im, N, a, b, brush, vr, vi);
        stamp(paintLayer.mask, scratch, N, a, b, brush, 1, 0);
      }
    }
  }
  paintLayer.used = paintLayer.mask.some((v) => v > 0);
  clearPaintButton.disabled = !paintLayer.used;
  changed('pupil');
}
function tiltTo(p) {
  const k = kappa(), u = p.i - C, v = C - p.j;
  state.tiltNA = +(Math.hypot(u, v) / k).toFixed(3);
  state.tiltDir = Math.round(Math.atan2(v, u) / deg);
  if (state.illum === 'incoherent') setIllum('coherent');
  ctl.tiltNA.value = state.tiltNA; ctl.tiltDir.value = state.tiltDir;
  syncVisibility();
  changed('image');
}
fpCanvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  fpCanvas.setPointerCapture(e.pointerId);
  const p = pixelOf(fpCanvas, e, state.zoom);
  fpDrag = p;
  if (state.fpTool === 'tilt') tiltTo(p); else paintPupil(p, null);
  e.preventDefault();
});
fpCanvas.addEventListener('pointermove', (e) => {
  const p = pixelOf(fpCanvas, e, state.zoom);
  showFpHover(p);
  if (!fpDrag) return;
  if (state.fpTool === 'tilt') tiltTo(p); else paintPupil(p, fpDrag);
  fpDrag = p;
});
for (const ev of ['pointerup', 'pointercancel']) fpCanvas.addEventListener(ev, () => { fpDrag = null; });
fpCanvas.addEventListener('pointerleave', () => { hover.fp = false; show('#fp-read', fpNote); });
function showFpHover({ i, j }) {
  if (!ready) return;
  hover.fp = true;
  const k = kappa(), u = (i - C) / k, v = (C - j) / k, o = j * N + i;
  const pr = P.re[o], pi = P.im[o], pm = Math.hypot(pr, pi);
  const pupilText = pm < 1e-9 ? 'blocked' : `P = ${fmt(pm, 2)}${Math.abs(pi) > 1e-6 * pm || pr < 0 ? ` ∠ ${Math.round(Math.atan2(pi, pr) / deg)}°` : ''}`;
  shown.delete('#fp-read');
  $('#fp-read').textContent = `sin θ = (${fmt(u, 3)}, ${fmt(v, 3)}), |sin θ| ${fmt(Math.hypot(u, v), 3)}: ${pupilText}`;
}

// The image: drag to move the profile's row.
const imgCanvas = $('#image');
let imgDrag = false;
function setRow(e) { state.row = pixelOf(imgCanvas, e, state.xzoom).j; need.obj = need.img = true; schedule(); hashSoon(); }
imgCanvas.addEventListener('pointerdown', (e) => { imgCanvas.setPointerCapture(e.pointerId); imgDrag = true; setRow(e); e.preventDefault(); });
imgCanvas.addEventListener('pointermove', (e) => {
  const p = pixelOf(imgCanvas, e, state.xzoom);
  hover.img = true;
  shown.delete('#img-read');
  $('#img-read').textContent = `x ${fmt((p.i - C) * DX, 3)}, y ${fmt((C - p.j) * DX, 3)} µm: I = ${fmt(I[p.j * N + p.i], 4)}`;
  if (imgDrag) setRow(e);
});
for (const ev of ['pointerup', 'pointercancel']) imgCanvas.addEventListener(ev, () => { imgDrag = false; });
imgCanvas.addEventListener('pointerleave', () => { hover.img = false; show('#img-read', imgNote); });

// ------------------------------------------------------------------------------ controls

const ctl = {};
const S_ = (key, opts, what = 'pupil') => (ctl[key] = slider({ ...opts, value: state[key], onInput: (v) => { state[key] = v; opts.after?.(v); changed(what); } }));

// The object panel.
const presetButtons = {};
for (const [id, p] of Object.entries(PRESETS)) {
  presetButtons[id] = el('button', { type: 'button', title: p.title, 'aria-pressed': 'false', onclick: () => choosePreset(id) }, p.label);
  $('#presets').append(presetButtons[id]);
}
function choosePreset(id) {
  const p = PRESETS[id];
  if (!p.field) {
    state.enc = p.enc; state.phi0 = p.phi0 ?? state.phi0; state.absorb = p.absorb ?? 1;
    state.objView = state.enc === 'amplitude' ? 'amplitude' : 'phase';
  } else state.objView = 'amplitude';
  loadPreset(id);
  hashSoon();
}
const reload = () => { loadPreset(state.preset, { row: false }); hashSoon(); };
ctl.d = slider({ label: 'period d (µm)', min: 0.3, max: 4, log: true, value: state.d, title: 'Rounded so that a whole number of periods fits across the field',
  onInput: (v) => { state.d = snapPeriod(v, N, DX).d; reload(); } });
ctl.profile = segmented([{ value: 'bars', label: 'Bars', title: 'Equal bars and gaps: odd orders only' }, { value: 'cosine', label: 'Sinusoid', title: 'A sinusoidal transmission: orders 0 and ±1 only' }],
  state.profile, (v) => { state.profile = v; reload(); }, { label: 'Grating profile' });
ctl.spacing = slider({ label: 'pore spacing (µm)', min: 0.3, max: 1.2, step: 0.01, value: state.spacing, onInput: (v) => { state.spacing = v; reload(); } });
ctl.sep = slider({ label: 'separation (µm)', min: 0.1, max: 3, step: 0.1, value: state.sep, onInput: (v) => { state.sep = v; reload(); } });
ctl.pphase = slider({ label: 'phase (°)', min: -180, max: 180, step: 1, value: state.pphase, title: 'The phase of the right pinhole relative to the left (matters only in coherent light)',
  onInput: (v) => { state.pphase = v; reload(); } });
const EXAMPLES = [
  ['exp(i a (r < R))', 'A phase disk'],
  ['exp(i a exp(-r^2/w^2))', 'A phase bump: a weak lens'],
  ['exp(i a cos(2 pi x/d))', 'A sinusoidal phase grating'],
  ['(1 + cos(2 pi x/d))/2', 'A sinusoidal amplitude grating'],
  ['exp(i a sin(2 pi x/d)) (abs(y) < 5) + (abs(y) >= 5) (1 + cos(2 pi x/d))/2', 'A phase grating above an amplitude grating'],
];
ctl.formula = exprField({
  label: '<math><mi>t</mi><mo>(</mo><mi>x</mi><mo>,</mo><mi>y</mi><mo>)</mo><mo>=</mo></math>', value: state.formula, variables: ['x', 'y', 'r'],
  hints: { a: { min: 0, max: 3.14, value: 0.5 }, R: { min: 0.2, max: 10, value: 3 }, w: { min: 0.2, max: 10, value: 3 }, d: { min: 0.2, max: 5, value: 1.5 },
    m: { min: 0, max: 1, value: 0.5 }, s: { min: 0.2, max: 10, value: 2 } },
  onChange: (expr, params) => {
    formulaExpr = expr; formulaParams = params; state.formula = expr.source;
    if (state.preset === 'formula') reload();
  },
});
formulaExpr = ctl.formula.expr; formulaParams = ctl.formula.params;
const examples = el('div', { class: 'examples' }, ...EXAMPLES.map(([src, title]) => el('button', { type: 'button', title, onclick: () => { ctl.formula.set(src); } }, src.length > 26 ? src.slice(0, 24) + '…' : src)));
const formulaNote = el('div', { class: 'note' }, 'x, y and r in µm; i, pi, exp, cos, (r < R) ... work.');
const formulaBox = el('div', { class: 'stack' }, ctl.formula, examples, formulaNote);
$('#preset-params').append(ctl.d, ctl.profile, ctl.spacing, ctl.sep, ctl.pphase, formulaBox);

ctl.enc = segmented([
  { value: 'amplitude', label: 'Amplitude', title: 'The ink absorbs: t = 1 − a·ink' },
  { value: 'phase', label: 'Phase', title: 'The ink is transparent but delays the light: t = exp(i φ0·ink)' },
  { value: 'both', label: 'Both', title: 't = (1 − a·ink) exp(i φ0·ink)' },
], state.enc, (v) => { state.enc = v; state.objView = v === 'amplitude' ? 'amplitude' : 'phase'; objView.value = state.objView; syncVisibility(); rebright = true; changed('object'); }, { label: 'Kind of object' });
ctl.absorb = S_('absorb', { label: 'absorption a', min: 0, max: 1, step: 0.01, title: 'The fraction of the amplitude the darkest ink removes' }, 'object');
ctl.phi0 = S_('phi0', { label: 'phase φ₀ (rad)', min: 0, max: 3.14, step: 0.01, title: 'The phase delay of the thickest ink' }, 'object');
const encLabel = el('div', { class: 'note' }, 'The object is:');
$('#enc-box').append(el('div', { class: 'stack' }, encLabel, ctl.enc), ctl.absorb, ctl.phi0);

// The objective panel.
S_('NA', { label: 'NA', min: 0.05, max: 1.4, step: 0.01, title: 'The objective’s numerical aperture n sin θmax: the pupil passes |f| ≤ NA/λ' });
// λ is in micrometres in the state, nanometres on the slider.
ctl.lambda = slider({ label: 'λ (nm)', min: 400, max: 700, step: 1, value: state.lambda * 1000, title: 'The wavelength (in vacuum)',
  onInput: (v) => { state.lambda = v / 1000; changed('pupil'); } });
S_('z', { label: 'defocus z (µm)', min: -5, max: 5, step: 0.05, title: 'Focus a distance z beyond the object (paraxial)' });
$('#objective').append(ctl.NA, ctl.lambda, ctl.z);

// The Fourier-plane filters.
ctl.filter = segmented([
  { value: 'open', label: 'Open', title: 'Just the aperture' },
  { value: 'stop', label: 'Stop', title: 'A central stop over the zero order: dark field (large: an annular pupil)' },
  { value: 'dot', label: 'Phase dot', title: 'Zernike’s phase dot: shift the zero order by a quarter wave' },
  { value: 'knife', label: 'Knife edge', title: 'Foucault’s knife edge: block half the plane (schlieren)' },
], state.filter, (v) => { state.filter = v; syncVisibility(); changed('pupil'); }, { label: 'Filter in the Fourier plane' });
S_('stopNA', { label: 'radius (NA)', min: 0, max: 1.2, step: 0.005, title: 'Radius of the stop, in units of NA (0: the zero order alone)' });
S_('dotPhase', { label: 'phase (°)', min: -180, max: 180, step: 1, title: 'The dot’s phase shift: −90° advances the zero order a quarter wave (dark contrast), +90° delays it (bright)' });
const dotQuick = el('div', { class: 'row' }, ...[[-90, '−90° (dark contrast)'], [90, '+90° (bright)']].map(([v, text]) =>
  el('button', { type: 'button', onclick: () => { state.dotPhase = v; ctl.dotPhase.value = v; changed('pupil'); } }, text)));
S_('dotNA', { label: 'radius (NA)', min: 0, max: 0.4, step: 0.005, title: 'Radius of the dot in units of NA (0: the zero order alone)' });
S_('dotAmp', { label: 'amplitude', min: 0.05, max: 1, step: 0.01, title: 'The dot’s amplitude transmission: a dot that also absorbs raises the contrast' });
S_('knifeNA', { label: 'position (NA)', min: -0.6, max: 0.6, step: 0.005, title: 'Where the edge is, in units of NA; 0 cuts through the zero order’s pixel and keeps it' });
S_('knifeAngle', { label: 'angle (°)', min: -180, max: 180, step: 1, title: 'The direction of the kept half' });
const stopQuick = el('div', { class: 'row' }, ...[[0.02, 'Zero order only'], [0.08, 'Dark field'], [null, 'Annulus']].map(([v, text]) =>
  el('button', { type: 'button', title: v === null ? 'A stop 80% of the aperture: an annular pupil' : `Stop radius ${v} NA`,
    onclick: () => { state.stopNA = v === null ? +(0.8 * state.NA).toFixed(3) : v; ctl.stopNA.value = state.stopNA; changed('pupil'); } }, text)));
const filterParams = {
  stop: el('div', { class: 'stack' }, ctl.stopNA, stopQuick),
  dot: el('div', { class: 'stack' }, ctl.dotPhase, dotQuick, ctl.dotNA, ctl.dotAmp),
  knife: el('div', { class: 'stack' }, ctl.knifeNA, ctl.knifeAngle),
};
$('#filter').append(ctl.filter, ...Object.values(filterParams));

// Illumination.
ctl.illum = segmented([
  { value: 'coherent', label: 'Coherent', title: 'A plane wave from one direction (a point source, a laser)' },
  { value: 'condenser', label: 'Condenser', title: 'Partially coherent: light from every direction inside the condenser’s NA, added as intensities' },
  { value: 'incoherent', label: 'Incoherent', title: 'Every point of the object independent (self-luminous, or a very wide condenser): intensities convolve with |h|²' },
], state.illum, (v) => setIllum(v), { label: 'Illumination' });
function setIllum(v) {
  const was = state.illum;
  state.illum = v; ctl.illum.value = v;
  if (v === 'incoherent' && state.fpView === 'light') { state.fpView = 'otf'; fpView.value = 'otf'; }
  else if (was === 'incoherent' && v !== 'incoherent' && state.fpView === 'otf') { state.fpView = 'light'; fpView.value = 'light'; }
  syncVisibility();
  changed('image');
}
S_('condNA', { label: 'condenser NA', min: 0.01, max: 1.4, step: 0.01, title: 'The condenser’s numerical aperture: how wide a cone of directions lights the object' }, 'image');
S_('tiltNA', { label: 'tilt sin θ', min: 0, max: 1.4, step: 0.005, title: 'Oblique light: the illumination arrives at sin θ to the axis (the spectrum slides by sin θ / λ)' }, 'image');
S_('tiltDir', { label: 'direction (°)', min: -180, max: 180, step: 1, title: 'Which way the light is tilted' }, 'image');
const tiltBox = el('div', { class: 'stack' }, ctl.tiltNA, ctl.tiltDir);
$('#illum').append(ctl.illum, ctl.condNA, tiltBox);

// Under the canvases.
const objView = segmented([{ value: 'amplitude', label: 'Amplitude', title: 'The transmitted intensity |t|² in grey' }, { value: 'phase', label: 'Phase', title: 'The phase φ in colour' }],
  state.objView, (v) => { state.objView = v; changed('obj'); if (ready) readouts(); }, { label: 'Show the object as' });
$('#obj-view').append(objView);
const objTool = segmented([{ value: 'add', label: 'Add ink', title: 'Paint ink onto the object' }, { value: 'remove', label: 'Remove', title: 'Paint clear glass' }],
  state.objTool, (v) => { state.objTool = v; }, { label: 'Object brush' });
ctl.objBrush = slider({ label: 'brush', min: 1, max: 40, step: 1, value: state.objBrush, onInput: (v) => { state.objBrush = Math.round(v); } });
$('#obj-tools').append(objTool, ctl.objBrush);

const fpView = el('select', { 'aria-label': 'What to show in the Fourier plane', title: 'What to show in the Fourier plane' },
  el('option', { value: 'light' }, 'Light'), el('option', { value: 'pupil' }, 'Pupil P'), el('option', { value: 'otf' }, 'OTF'));
fpView.value = state.fpView;
fpView.addEventListener('change', () => { state.fpView = fpView.value; changed('fp'); });
const zoomSel = el('select', { 'aria-label': 'Magnify the Fourier plane', title: 'Magnify the middle of the Fourier plane' },
  ...[1, 2, 4].map((z) => el('option', { value: z }, `${z}×`)));
zoomSel.value = state.zoom;
zoomSel.addEventListener('change', () => { state.zoom = +zoomSel.value; changed('fp'); });
const logToggle = toggle('log', state.fpLog, (on) => { state.fpLog = on; changed('fp'); }, 'Brightness on a logarithmic scale');
$('#fp-view').append(fpView, zoomSel, logToggle);
const fpTool = segmented([
  { value: 'tilt', label: 'Tilt', title: 'Drag the light: where you press is where the zero order goes (oblique illumination)' },
  { value: 'block', label: 'Block', title: 'Paint the pupil opaque' },
  { value: 'open', label: 'Open', title: 'Paint the pupil clear' },
  { value: 'minus', label: '−90°', title: 'Paint a quarter-wave advance' },
  { value: 'plus', label: '+90°', title: 'Paint a quarter-wave delay' },
  { value: 'erase', label: 'Unpaint', title: 'Remove paint: back to the controls’ pupil' },
], state.fpTool, (v) => { state.fpTool = v; fpCanvas.classList.toggle('tilt', v === 'tilt'); }, { label: 'Fourier-plane tool' });
ctl.fpBrush = slider({ label: 'brush', min: 1, max: 30, step: 1, value: state.fpBrush, onInput: (v) => { state.fpBrush = Math.round(v); } });
const mirrorToggle = toggle('Mirror', state.fpMirror, (on) => { state.fpMirror = on; }, 'Paint the point opposite through the centre too');
const clearPaintButton = el('button', { type: 'button', title: 'Remove all paint from the pupil', disabled: true, onclick: () => { clearPaint(); clearPaintButton.disabled = true; changed('pupil'); } }, 'Clear');
$('#fp-tools').append(fpTool, ctl.fpBrush, mirrorToggle, clearPaintButton);
ctl.fpBright = slider({ label: 'bright', min: -3, max: 3, step: 0.01, value: 0, title: 'How bright to draw the Fourier plane (factors of 10)', onInput: (v) => { state.fpBright = v; changed('fp'); } });
$('#fp-tools').append(ctl.fpBright);
const xzoomSel = el('select', { 'aria-label': 'Magnify the object and the image', title: 'Magnify the middle of the object and the image' },
  ...[1, 2, 4].map((z) => el('option', { value: z }, `${z}×`)));
xzoomSel.value = state.xzoom;
xzoomSel.addEventListener('change', () => { state.xzoom = +xzoomSel.value; need.obj = true; changed('img'); });
$('#img-view').append(xzoomSel);
const exposureSel = el('select', { 'aria-label': 'Grey scale', title: 'How intensity becomes grey: brightest point white; clear glass (I = 1) white; or darkest black and brightest white (contrast stretch)' },
  el('option', { value: 'auto' }, 'Brightest = white'), el('option', { value: 'fixed' }, 'I = 1 white'), el('option', { value: 'stretch' }, 'Stretch'));
exposureSel.value = state.exposure;
exposureSel.addEventListener('change', () => { state.exposure = exposureSel.value; changed('img'); hashSoon(); });
ctl.imgBright = slider({ label: 'bright', min: -2, max: 2, step: 0.01, value: 0, title: 'Brighten or darken the image (factors of 10); the data do not change', onInput: (v) => { state.imgBright = v; changed('img'); } });
$('#img-tools').append(exposureSel, ctl.imgBright);

function syncVisibility() {
  const id = state.preset, field = PRESETS[id].field;
  ctl.d.hidden = ctl.profile.hidden = id !== 'grating';
  ctl.spacing.hidden = id !== 'diatom';
  ctl.sep.hidden = ctl.pphase.hidden = id !== 'points';
  formulaBox.hidden = id !== 'formula';
  $('#enc-box').hidden = !!field;
  ctl.absorb.hidden = state.enc === 'phase';
  ctl.phi0.hidden = state.enc === 'amplitude';
  for (const [k, box] of Object.entries(filterParams)) box.hidden = state.filter !== k;
  ctl.condNA.hidden = state.illum !== 'condenser';
  tiltBox.hidden = state.illum === 'incoherent';
  for (const [k, b] of Object.entries(presetButtons)) b.setAttribute('aria-pressed', String(k === id));
}

function syncControls() {
  for (const k of ['absorb', 'phi0', 'NA', 'z', 'stopNA', 'dotPhase', 'dotNA', 'dotAmp', 'knifeNA', 'knifeAngle', 'condNA', 'tiltNA', 'tiltDir', 'spacing', 'sep', 'pphase', 'd', 'fpBright', 'imgBright']) ctl[k].value = state[k];
  ctl.lambda.value = +(state.lambda * 1000).toFixed(1);
  ctl.profile.value = state.profile; ctl.enc.value = state.enc; ctl.filter.value = state.filter; ctl.illum.value = state.illum;
  objView.value = state.objView; fpView.value = state.fpView; zoomSel.value = state.zoom; xzoomSel.value = state.xzoom;
  logToggle.on = state.fpLog; exposureSel.value = state.exposure;
  syncVisibility();
}

// ------------------------------------------------------------------------------ the address

const HASH_KEYS = ['preset', 'd', 'profile', 'spacing', 'sep', 'pphase', 'enc', 'absorb', 'phi0', 'NA', 'lambda', 'z', 'filter', 'stopNA', 'dotPhase', 'dotNA', 'dotAmp',
  'knifeNA', 'knifeAngle', 'illum', 'condNA', 'tiltNA', 'tiltDir', 'fpView', 'zoom', 'objView', 'xzoom', 'row', 'fpBright', 'fpLog', 'exposure', 'imgBright'];
let hashTimer = 0;
function hashSoon() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const out = {};
    for (const k of HASH_KEYS) if (state[k] !== DEFAULTS[k]) out[k] = typeof state[k] === 'number' ? +state[k].toPrecision(5) : state[k];
    if (state.preset === 'formula') {
      out.formula = state.formula;
      for (const [k, v] of Object.entries(formulaParams)) out[`p_${k}`] = +v.toPrecision(5);
    }
    writeHash(out);
  }, 250);
}
function fromHash(h) {
  for (const k of HASH_KEYS) {
    if (h[k] === undefined) continue;
    const d = DEFAULTS[k];
    state[k] = typeof d === 'number' ? (Number.isFinite(+h[k]) ? +h[k] : d) : typeof d === 'boolean' ? h[k] === 'true' : h[k];
  }
  if (!PRESETS[state.preset]) state.preset = 'cells';
  if (h.formula) {
    const params = {};
    for (const [k, v] of Object.entries(h)) if (k.startsWith('p_') && Number.isFinite(+v)) params[k.slice(2)] = +v;
    ctl.formula.set(h.formula, params, false);
    formulaExpr = ctl.formula.expr; formulaParams = ctl.formula.params; state.formula = h.formula;
  }
}

// ------------------------------------------------------------------------------ experiments

async function configure(cfg) {
  const p = PRESETS[cfg.preset || DEFAULTS.preset];
  const enc = cfg.enc || p.enc || 'amplitude';
  Object.assign(state, DEFAULTS, { enc, phi0: p.phi0 ?? DEFAULTS.phi0, absorb: p.absorb ?? 1, objView: p.field || enc === 'amplitude' ? 'amplitude' : 'phase' }, cfg);
  clearPaint(); clearPaintButton.disabled = true;
  syncControls();
  dirty.pupil = true;
  await loadPreset(state.preset, { row: cfg.row === undefined });
  hashSoon();
}

const setups = {
  abbe: () => configure({ preset: 'grating', d: 1.28, NA: 0.35, filter: 'open' }),
  zero: () => configure({ preset: 'grating', d: 1.28, NA: 0.6, filter: 'stop', stopNA: 0.02 }),
  oblique: () => configure({ preset: 'grating', d: 0.8, NA: 0.4, filter: 'open', tiltNA: 0.35, tiltDir: 180 }),
  diatom: () => configure({ preset: 'diatom', NA: 0.65, filter: 'open', zoom: 2, xzoom: 2 }),
  invisible: () => configure({ preset: 'cells', NA: 1.4, filter: 'open', zoom: 1 }),
  defocus: () => configure({ preset: 'cells', NA: 0.5, filter: 'open', z: 1, zoom: 4 }),
  darkfield: () => configure({ preset: 'letters', NA: 0.5, filter: 'stop', stopNA: 0.08 }),
  zernike: () => configure({ preset: 'cells', NA: 0.5, filter: 'dot', dotPhase: -90, dotNA: 0.02, phi0: 0.3, zoom: 4 }),
  halo: () => configure({ preset: 'cells', NA: 0.5, filter: 'dot', dotPhase: -90, dotNA: 0.1, phi0: 0.3, zoom: 4 }),
  schlieren: () => configure({ preset: 'cells', NA: 0.5, filter: 'knife', knifeNA: 0, knifeAngle: 0, zoom: 4 }),
  portrait: () => configure({ preset: 'portrait', enc: 'phase', phi0: 0.3, NA: 0.5, filter: 'open', objView: 'phase' }),
  coherence: () => configure({ preset: 'bars', NA: 0.5, filter: 'open', zoom: 1 }),
  star: () => configure({ preset: 'star', NA: 0.5, filter: 'open', zoom: 1 }),
  rayleigh: () => configure({ preset: 'points', sep: 0.6, NA: 0.56, filter: 'open', illum: 'incoherent', fpView: 'otf', zoom: 1, xzoom: 4 }),
};
const help = drawer($('#help'), $('#help-button'), setups);

// ------------------------------------------------------------------------------ start

let ready = false;
for (const id of ['#object', '#fourier', '#image', '#profile']) {
  try { sizeObserver.observe($(id), { box: 'device-pixel-content-box' }); } catch { sizeObserver.observe($(id)); }
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { colors = null; need.img = true; schedule(); });

const hash = readHash();
const started = (async () => {
  if (setups[hash.setup]) await setups[hash.setup]();
  else {
    fromHash(hash);
    syncControls();
    await loadPreset(state.preset, { row: hash.row === undefined });
  }
  ready = true;
  frame();
  window.__app.ready = true;
})();

window.__app = {
  state, setups, configure, loadPreset, setIllum, changed, help,
  get t() { return t; }, get T() { return T; }, get P() { return P; }, get I() { return I; }, get ink() { return ink; },
  get partialDone() { return state.illum !== 'condenser' || partial.done; },
  get profilePeriod() { return profilePeriod; },
  orders: () => gratingOrders(),
  timing,
  frameNow(what) { for (const w of what) if (w in dirty) dirty[w] = true; else need[w] = true; frame(); return { ...timing }; },
  set(values) {
    const reloadObject = ['d', 'profile', 'spacing', 'sep', 'pphase', 'preset'].some((k) => k in values);
    Object.assign(state, values);
    syncControls();
    dirty.object = dirty.pupil = dirty.image = true;
    if (reloadObject) loadPreset(state.preset, { row: false }); else schedule();
    hashSoon();
  },
  stats: () => stats(I),
  throughput: () => throughput(Ts, P, N),
  N, DX, ready: false, started,
};
