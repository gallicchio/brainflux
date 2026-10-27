// The quantum phase-space demo: the Wigner function W(x, p) of a wave function evolving under
// H = p^2/2m + V(x) (hbar = m = 1), with a classical ensemble flowing under the same H.

import { Sim1D, eigenstates, prepareSharpPotential } from '../schrodinger1d/sim.js';
import { parse } from '../lib/expr.js';
import { el, $, slider, segmented, toggle, exprField, drawer, toast, readHash, writeHash, fmt } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors, contour } from '../lib/plot.js';
import { fft } from '../lib/fft.js';
import { PhaseGrid, rng32 } from './wigner.js';
import { Ensemble, PotentialTable, sampleDensity } from './classical.js';
import { POTENTIALS, addGaussian, catState, normalize } from './states.js';

// ----------------------------------------------------------------------------- state

const KINDS = ['coherent', 'squeezed', 'cat', 'eigen', 'two', 'typed'];
const TYPED_PSI = 'exp(-(x/a)^8)';
const state = {
  pot: POTENTIALS.find((p) => p.id === 'quartic'),
  // One record for every kind of initial state, so switching kinds keeps the centre.
  init: { kind: 'coherent', x0: 3, p0: 0, r: 0.6, theta: 0, phi: 0, n: 1, m: 0, psi: TYPED_PSI, params: { a: 2 } },
  view: 'W',                      // 'W' (Wigner) or 'Q' (Husimi)
  show: { dots: true, contours: true, marginals: true, quadrature: false },
  quad: 30,                       // the quadrature's angle, degrees
  running: true,
  speed: 2,                       // simulated time per second
  dots: 3000,
  proxy: 'Q',                     // where W < 0, points come from Q or from |psi|^2 |phi|^2 ('product')
  scale: 'fixed',                 // colours saturate at 1/pi hbar ('fixed') or at the largest |W| ('auto')
  zoom: 1,                        // the window of phase space, relative to the preset's
};

let sim = null;
let Vexpr = null, Vparams = {};
let shownV = null;                // V as typed (cell-averaged), for the classical force and contours
let table = null;                 // V and its force for the classical points
let levels = [];                  // stationary states [{E, psi}] (bound ones)
let omegaRef = 1;                 // the frequency of small oscillations: the coherent states' width
let grid = null, gridKey = '';    // the phase-space grid of W and Q
let win = null;                   // the window of phase space on screen {x0, x1, p0, p1}
let bl = null;                    // psi, band-limited for W
let Wstats = null;
const ens = new Ensemble(0);
let dotsFrom = 'W';
let dirty = true;
let errorText = '';
let E0 = 0, dtCal = 0.02, dtMax = 0.01, maxSteps = 400;
let frames = 0, slowFrames = 0;
let scaleX = 1, scaleP = 1;       // marginal plot scales, growing only, reset at a restart
let hover = null;
let Vversion = 0;

// ------------------------------------------------------------------- the potential

const SUB = 8;
/**
 * V on the simulation grid, each cell the average of 8 samples (an edge falls where typed).
 * out.jumps: whether V jumps somewhere: one step between samples far bigger than its
 * neighbours (a smooth V, however steep, changes by nearly equal steps from sample to sample).
 */
function evalVOnGrid() {
  const n = sim.n, N = n * SUB, xs = new Float64Array(N);
  for (let j = 0; j < n; j++) for (let s = 0; s < SUB; s++) xs[j * SUB + s] = sim.x[j] + ((s + 0.5) / SUB - 0.5) * sim.dx;
  const v = Vexpr.evaluate({ x: xs, ...Vparams }, N).re.map(clean);
  const out = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    let a = 0;
    for (let s = 0; s < SUB; s++) a += v[j * SUB + s];
    out[j] = a / SUB;
  }
  out.jumps = false;
  for (let i = 4; i < N - 5 && !out.jumps; i++) {
    const d = Math.abs(v[i + 1] - v[i]);
    if (d < 1e-3) continue;
    let nb = 0;
    for (let k = -4; k <= 4; k++) if (k) nb = Math.max(nb, Math.abs(v[i + 1 + k] - v[i + k]));
    if (d > 20 * nb) out.jumps = true;
  }
  return out;
}
const clean = (y) => (Number.isFinite(y) ? Math.max(-1e6, Math.min(1e6, y)) : Number.isNaN(y) ? 0 : Math.sign(y) * 1e6);

function applyPotential() {
  if (!sim || !Vexpr) return;
  shownV = evalVOnGrid();
  // Only a V with jumps is softened for the split-operator method (see schrodinger1d/sim.js).
  // A smooth V, however steep its walls, is used exactly as typed: softening it would ripple
  // it inside the well.
  const V = shownV.jumps ? prepareSharpPotential(shownV, sim.dx) : shownV;
  sim.setPotential(V);
  if (V.jumps) {
    // A potential with jumps: the classical points feel the same softened V as the wave.
    const lin = (xs) => xs.map((x) => {
      const f = Math.max(0, Math.min(sim.n - 1.000001, (x - sim.xmin) / sim.dx)), j = Math.floor(f);
      return V[j] + (f - j) * (V[Math.min(sim.n - 1, j + 1)] - V[j]);
    });
    table = new PotentialTable(lin, sim.xmin, sim.xmax, 8192);
  } else {
    table = new PotentialTable((xs) => Vexpr.evaluate({ x: xs, ...Vparams }, xs.length).re, sim.xmin, sim.xmax, 8192);
  }
  omegaRef = referenceOmega();
  computeLevels(V);
  Vversion++;
}

/** The frequency of small oscillations about the potential's lowest point in the window. */
function referenceOmega() {
  const p = state.pot;
  if (p.omegaOf) {
    const w = p.omegaOf(Vparams);
    if (w > 0 && Number.isFinite(w)) return w;
  }
  const n = sim.n, w0 = p.window.x;
  let best = -1, vmin = Infinity;
  for (let j = 5; j < n - 5; j++) {
    if (sim.x[j] < w0[0] || sim.x[j] > w0[1]) continue;
    if (shownV[j] < vmin) { vmin = shownV[j]; best = j; }
  }
  if (best < 0) return 1;
  const k = 5, d2 = (shownV[best + k] - 2 * shownV[best] + shownV[best - k]) / (k * sim.dx) ** 2;
  return d2 > 0.01 ? Math.max(0.2, Math.min(10, Math.sqrt(d2))) : 1;
}

function computeLevels(V) {
  levels = [];
  if (state.pot.noLevels) return;
  const n = sim.n, walls = state.pot.boundary === 'walls';
  const edge = Math.min(V[walls ? 1 : 0], V[n - 1]);
  // Only levels whose orbits fit in the window: below the least energy on its border.
  const w = baseWindow();
  let Emax = Infinity;
  for (let j = 0; j < n; j++) {
    const x = sim.x[j];
    if (x >= w.x0 && x <= w.x1) Emax = Math.min(Emax, shownV[j] + Math.min(w.p0 ** 2, w.p1 ** 2) / 2);
  }
  Emax = Math.min(Emax, shownV[Math.max(0, Math.round((w.x0 - sim.xmin) / sim.dx))] ?? Infinity, shownV[Math.min(n - 1, Math.round((w.x1 - sim.xmin) / sim.dx))] ?? Infinity);
  const maxE = Math.min(edge, Emax);
  try {
    levels = eigenstates(V, sim.dx, 1, 30, { first: walls ? 1 : 0, last: n - 1, maxE }).filter((s) => s.E < edge - 1e-9);
  } catch { levels = []; }
}

// --------------------------------------------------------------- the initial state

function initialPsi() {
  const n = sim.n, x = sim.x, it = state.init;
  let re = new Float64Array(n), im = new Float64Array(n);
  const deg = Math.PI / 180;
  if (it.kind === 'coherent') addGaussian(x, re, im, { x0: it.x0, p0: it.p0, omega: omegaRef });
  else if (it.kind === 'squeezed') addGaussian(x, re, im, { x0: it.x0, p0: it.p0, r: it.r, theta: it.theta * deg, omega: omegaRef });
  else if (it.kind === 'cat') ({ re, im } = catState(x, { x0: it.x0, p0: it.p0, phi: it.phi * deg, omega: omegaRef }));
  else if (it.kind === 'eigen' || it.kind === 'two') {
    const need = Math.max(it.n, it.kind === 'two' ? it.m : 0) + 1;
    if (!levels.length) throw new Error('This potential has no bound states: choose another kind of state.');
    if (need > levels.length) throw new Error(`Only ${levels.length} stationary states fit in this window (n = 0…${levels.length - 1}).`);
    if (it.kind === 'eigen') re.set(levels[it.n].psi);
    else for (let j = 0; j < n; j++) re[j] = (levels[it.n].psi[j] + levels[it.m].psi[j]) / Math.SQRT2;
  } else {
    const e = parse(it.psi, { variables: ['x'] });
    const v = e.evaluate({ x, ...it.params }, n);
    let peak = 0;
    for (let j = 0; j < n; j++) {
      const a = v.re[j], b = v.im ? v.im[j] : 0;
      if (Math.abs(a) === Infinity || Math.abs(b) === Infinity) throw new Error('ψ₀ is infinite somewhere in the domain: it grows too fast.');
      re[j] = Number.isFinite(a) ? a : 0; im[j] = Number.isFinite(b) ? b : 0;
      peak = Math.max(peak, Math.abs(re[j]), Math.abs(im[j]));
    }
    if (peak > 0) for (let j = 0; j < n; j++) { re[j] /= peak; im[j] /= peak; }
  }
  if (state.pot.boundary === 'walls') { re[0] = 0; im[0] = 0; }
  if (!normalize(re, im, sim.dx)) throw new Error('The initial wave function is zero everywhere in the domain.');
  return { re, im };
}

/** Back to t = 0 from the initial state.  quick: skip the time-step trial (while dragging). */
function restart({ quick = false } = {}) {
  if (!sim) return;
  errorText = '';
  try {
    const { re, im } = initialPsi();
    sim.setPsi(re, im);
  } catch (err) {
    errorText = err.message;
    sim.setPsi(new Float64Array(sim.n), null);
  }
  sim.normalize();
  const o = sim.observables();
  E0 = o.E;
  sim.absorbSpeed = Math.max(1.5, Math.abs(o.p) + 3 * o.sp);
  sim.h = 0;
  if (!quick) dtCal = sim.calibrateStep(sim.suggestedStep(E0));
  dtMax = Math.min(dtCal, sim.suggestedStep(E0));
  if (!quick) measureSpeed();
  scaleX = 0; scaleP = 0;
  energyPath = null;
  if (ensureGrid()) { computePhase(); sampleDots(); }
  dirty = true;
  updateReadouts();
  if (!quick) updateHash();
}

/** How long a step takes, to keep a frame's work to about 10 ms. */
function measureSpeed() {
  const keep = { re: sim.re.slice(), im: sim.im.slice(), t: sim.t };
  const t0 = performance.now();
  sim.step(dtMax * 1e-3, 20);
  const per = (performance.now() - t0) / 20;
  sim.re.set(keep.re); sim.im.set(keep.im); sim.t = keep.t; sim.h = 0;
  maxSteps = Math.max(10, Math.min(2000, Math.floor(10 / Math.max(per, 1e-3))));
}

function advance(T) {
  if (!(T > 0) || errorText) return;
  dtMax = Math.min(dtCal, sim.suggestedStep(E0));
  let steps = Math.max(1, Math.ceil(T / dtMax));
  frames++;
  if (steps > maxSteps) { steps = maxSteps; T = steps * dtMax; slowFrames++; }
  const h = T / steps;
  sim.step(h, steps);
  // The classical points take steps of at most 0.01 (more of them when h is larger).
  const sub = Math.max(1, Math.ceil(h / 0.01));
  if (ens.N) ens.step(table, h / sub, steps * sub, 1, state.pot.boundary === 'walls' ? [sim.xmin, sim.xmax] : null);
  dirty = true;
}

// ------------------------------------------------------------------ phase space

/** The preset's window, zoomed. */
function baseWindow() {
  const w = state.pot.window, z = state.zoom;
  const cx = (w.x[0] + w.x[1]) / 2, cp = (w.p[0] + w.p[1]) / 2, X = (w.x[1] - w.x[0]) * z, P = (w.p[1] - w.p[0]) * z;
  return { x0: cx - X / 2, x1: cx + X / 2, p0: cp - P / 2, p1: cp + P / 2 };
}

/** The window fitted to the plot's shape: the preset's window is meant to fill a square. */
function fittedWindow(w, h) {
  const b = baseWindow();
  const cx = (b.x0 + b.x1) / 2, cp = (b.p0 + b.p1) / 2;
  let X = b.x1 - b.x0, P = b.p1 - b.p0;
  if (h >= w) P *= h / w; else X *= w / h;
  return { x0: cx - X / 2, x1: cx + X / 2, p0: cp - P / 2, p1: cp + P / 2 };
}

/** Make the grid for the current plot size and window.  False if the plot has no size yet. */
function ensureGrid() {
  if (!layout || !sim) return false;
  const m = layout.main, w = m.right - m.left, h = m.bottom - m.top;
  if (!(w > 20 && h > 20)) return false;
  win = fittedWindow(w, h);
  const cols = Math.min(320, Math.round(w / 2.2)), rows = Math.min(320, Math.round(h / 1.8));
  const key = [win.x0, win.x1, win.p0, win.p1, cols, rows, sim.n, sim.dx, sim.xmin].map((v) => +v.toPrecision(6)).join(',');
  if (key !== gridKey) {
    // psi is band-limited at twice the window's largest momentum: a state that reaches a
    // little beyond the window keeps its true W inside it.
    grid = new PhaseGrid({ n: sim.n, dx: sim.dx, xmin: sim.xmin }, win, { cols, rows, margin: 2 });
    gridKey = key;
    contourKey = '';
    energyPath = null;
    if (!bl || bl.re.length !== sim.n) bl = { re: new Float64Array(sim.n), im: new Float64Array(sim.n) };
    image = null;
  }
  return true;
}

const sigmaQ = () => Math.sqrt(1 / (2 * omegaRef));

function computePhase() {
  const n = sim.n;
  grid.prepare(sim.re.subarray(0, n), sim.im.subarray(0, n), bl);
  grid.wigner(bl.re, bl.im);
  if (state.view === 'Q') grid.husimi(bl.re, bl.im, sigmaQ());
  Wstats = grid.stats(grid.W);
  momentumDensity();
}

/**
 * Classical points drawn from W where it is a probability density (no negative part to speak
 * of), else from a positive stand-in: the Husimi Q, or |psi(x)|^2 |phi(p)|^2.  The same seed
 * every time, so a set-up always gets the same points.
 */
function sampleDots() {
  if (!grid || errorText) { ens.resize(0); return; }
  const rng = rng32(20261027), N = state.dots;
  if (Wstats.negative <= 2e-3) {
    dotsFrom = 'W';
    const s = grid.sample(grid.W, N, rng);
    if (s) ens.set(s.x, s.p); else ens.resize(0);
  } else if (state.proxy === 'Q') {
    dotsFrom = 'Q';
    grid.husimi(bl.re, bl.im, sigmaQ());
    const s = grid.sample(grid.Q, N, rng);
    if (s) ens.set(s.x, s.p); else ens.resize(0);
  } else {
    dotsFrom = 'product';
    const n = sim.n, dens = new Float64Array(n);
    for (let j = 0; j < n; j++) dens[j] = sim.re[j] ** 2 + sim.im[j] ** 2;
    const xs = sampleDensity(dens, sim.xmin, sim.dx, N, rng);
    // |phi(p)|^2 in increasing p (the transform's second half holds the negative momenta).
    const P = mom.d.length, md = new Float64Array(P);
    for (let i = 0; i < P; i++) md[i] = mom.d[(i + P / 2) % P];
    const ps = sampleDensity(md, -(P / 2) * mom.dp, mom.dp, N, rng);
    if (xs && ps) ens.set(xs, ps); else ens.resize(0);
  }
}

// |phi(p)|^2 on a fine grid (psi padded to four times its length).
let mom = null;
function momentumDensity() {
  const n = sim.n, P = 4 * n;
  if (!mom || mom.re.length !== P) mom = { re: new Float64Array(P), im: new Float64Array(P), d: new Float64Array(P) };
  mom.re.fill(0); mom.im.fill(0);
  mom.re.set(sim.re.subarray(0, n)); mom.im.set(sim.im.subarray(0, n));
  fft(mom.re, mom.im);
  const s = (sim.dx * sim.dx) / (2 * Math.PI);
  for (let i = 0; i < P; i++) mom.d[i] = s * (mom.re[i] ** 2 + mom.im[i] ** 2);
  mom.dp = (2 * Math.PI) / (P * sim.dx);
}

// ------------------------------------------------------------------- colours

let lut = null, lutDark = null;
function isDark() {
  const c = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim();
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(c);
  if (!m) return window.matchMedia('(prefers-color-scheme: dark)').matches;
  return 0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16) < 128;
}
/**
 * The diverging colour map: zero is the panel's own colour, positive values warm (to red, or
 * orange on a dark page), negative cool (to blue).  1024 steps from -1 to 1.
 */
function buildLut() {
  const dark = isDark();
  const stops = dark
    ? [[-1, [120, 200, 255]], [-0.5, [40, 105, 190]], [0, [28, 29, 34]], [0.5, [185, 75, 40]], [1, [255, 185, 95]]]
    : [[-1, [33, 102, 172]], [-0.5, [140, 192, 222]], [0, [255, 255, 255]], [0.5, [244, 165, 130]], [1, [178, 24, 43]]];
  const N = 1024, out = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    const v = -1 + (2 * i) / (N - 1);
    let k = 0;
    while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
    const [va, ca] = stops[k], [vb, cb] = stops[k + 1], t = (v - va) / (vb - va);
    for (let c = 0; c < 3; c++) out[i * 4 + c] = ca[c] + t * (cb[c] - ca[c]);
    out[i * 4 + 3] = 255;
  }
  lut = out; lutDark = dark;
}
function colorAt(v) {
  const i = Math.round(((Math.max(-1, Math.min(1, v)) + 1) / 2) * 1023) * 4;
  return `rgb(${lut[i]},${lut[i + 1]},${lut[i + 2]})`;
}

/** The value drawn at full colour. */
function colorScale() {
  if (state.scale === 'auto' && Wstats) {
    const F = state.view === 'Q' ? grid.Q : grid.W;
    let m = 0;
    for (let i = 0; i < F.length; i++) m = Math.max(m, Math.abs(F[i]));
    return m || 1;
  }
  return state.view === 'Q' ? 1 / (2 * Math.PI) : 1 / Math.PI;
}

// ------------------------------------------------------------------- drawing

const plot = $('#plot');
let layout = null;
let image = null;                 // an offscreen canvas, one pixel per grid point
let contourPath = null, contourKey = '';
let energyPath = null;
let frame = null;                 // the main plot's Frame

function computeLayout(width, height) {
  const marg = state.show.marginals;
  const T = marg ? Math.max(44, Math.min(110, Math.round(height * 0.15))) : 0;
  const R = marg ? Math.max(44, Math.min(110, Math.round(width * 0.14))) : 0;
  const gap = marg ? 8 : 0, ml = 46, mb = 34, mt = 8, mr = 12;
  const main = { left: ml, top: mt + T + gap, right: width - mr - R - gap, bottom: height - mb };
  return {
    width, height, main,
    top: { left: main.left, right: main.right, top: mt, bottom: mt + T },
    right: { left: main.right + gap, right: width - mr, top: main.top, bottom: main.bottom },
  };
}

function draw() {
  const { ctx, width, height } = fitCanvas(plot);
  const c = themeColors();
  if (!lut || lutDark !== isDark()) { buildLut(); drawColorbar(); }
  const lay = computeLayout(width, height);
  const sizeChanged = !layout || layout.width !== width || layout.height !== height || layout.main.top !== lay.main.top || layout.main.right !== lay.main.right;
  layout = lay;
  if (sizeChanged || !grid) { if (ensureGrid()) { computePhase(); if (!ens.N) sampleDots(); } }
  ctx.clearRect(0, 0, width, height);
  if (!grid || !win) return;
  const m = layout.main;
  const f = new Frame(ctx, width, height, { left: m.left, right: width - m.right, top: m.top, bottom: height - m.bottom });
  f.x0 = win.x0; f.x1 = win.x1; f.y0 = win.p0; f.y1 = win.p1;
  frame = f;
  ctx.fillStyle = c.panel;
  ctx.fillRect(f.left, f.top, f.w, f.h);
  f.clip();
  drawField(ctx, f);
  if (state.show.contours) drawContours(ctx, f, c);
  if (state.show.quadrature) drawQuadrature(ctx, f, c);
  if (state.show.dots) drawDots(ctx, f, c);
  drawHandle(ctx, f, c);
  if (errorText) {
    ctx.fillStyle = c.warn; ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(errorText, f.left + f.w / 2, f.top + 24);
  }
  ctx.restore();
  f.axes({ xlabel: 'x', ylabel: 'p', colors: c });
  if (state.show.marginals) drawMarginals(ctx, f, c);
}

function drawField(ctx, f) {
  const F = state.view === 'Q' ? grid.Q : grid.W, { cols, rows } = grid;
  if (!image || image.width !== cols || image.height !== rows) {
    image = document.createElement('canvas');
    image.width = cols; image.height = rows;
    image.data = image.getContext('2d').createImageData(cols, rows);
  }
  const d = image.data.data, inv = 1 / colorScale();
  for (let cIdx = 0; cIdx < cols; cIdx++) {
    const o = cIdx * rows;
    for (let r = 0; r < rows; r++) {
      let v = F[o + r] * inv;
      v = v > 1 ? 1 : v < -1 ? -1 : v;
      const li = Math.round((v + 1) * 511.5) * 4, pi = ((rows - 1 - r) * cols + cIdx) * 4;
      d[pi] = lut[li]; d[pi + 1] = lut[li + 1]; d[pi + 2] = lut[li + 2]; d[pi + 3] = 255;
    }
  }
  image.getContext('2d').putImageData(image.data, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  const xa = f.X(grid.x[0] - grid.cellX / 2), xb = f.X(grid.x[cols - 1] + grid.cellX / 2);
  const ya = f.Y(grid.p[rows - 1] + grid.dp / 2), yb = f.Y(grid.p[0] - grid.dp / 2);
  ctx.drawImage(image, xa, ya, xb - xa, yb - ya);
}

/** H(x, p) on a coarse grid over the window, for the contours. */
function energyGrid(nx, ny) {
  const H = new Float64Array(nx * ny);
  const xs = Array.from({ length: nx }, (_, i) => win.x0 + ((win.x1 - win.x0) * i) / (nx - 1));
  const Vx = xs.map((x) => table.potential(x));
  for (let j = 0; j < ny; j++) {
    const p = win.p0 + ((win.p1 - win.p0) * j) / (ny - 1);
    for (let i = 0; i < nx; i++) H[j * nx + i] = (p * p) / 2 + Vx[i];
  }
  return H;
}

function contourPathOf(H, nx, ny, lvls, f) {
  const path = new Path2D();
  const X = (i) => f.X(win.x0 + ((win.x1 - win.x0) * i) / (nx - 1)), Y = (j) => f.Y(win.p0 + ((win.p1 - win.p0) * j) / (ny - 1));
  for (const L of lvls) contour(H, nx, ny, L, (a, b, c2, d) => { path.moveTo(X(a), Y(b)); path.lineTo(X(c2), Y(d)); });
  return path;
}

function drawContours(ctx, f, c) {
  const nx = 160, ny = 160;
  const key = [gridKey, Vversion, f.left, f.top, f.w, f.h, levels.length].join('|');
  if (key !== contourKey) {
    const H = energyGrid(nx, ny);
    // The stationary states' energies when there are some: each contour then encloses an
    // area close to 2 pi hbar (n + 1/2).  Otherwise evenly spaced energies.
    let lv = levels.map((s) => s.E);
    if (!lv.length) {
      let lo = Infinity, hi = -Infinity;
      for (const v of H) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      hi = Math.min(hi, lo + 40);
      lv = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * (i + 1)) / 6);
    }
    contourPath = contourPathOf(H, nx, ny, lv, f);
    contourPath.H = H;
    contourKey = key;
    energyPath = null;
  }
  if (!energyPath && Number.isFinite(E0)) energyPath = contourPathOf(contourPath.H, nx, ny, [E0], f);
  ctx.save();
  ctx.strokeStyle = c.ink3; ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
  ctx.stroke(contourPath);
  ctx.globalAlpha = 0.9; ctx.strokeStyle = c.ink2; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.3;
  if (energyPath) ctx.stroke(energyPath);
  ctx.restore();
}

function drawDots(ctx, f, c) {
  const { x, p, N } = ens;
  if (!N) return;
  ctx.save();
  ctx.fillStyle = c.ink;
  // Fainter and smaller when the points are crowded (many of them, or a small plot), so that
  // W shows through.
  const crowd = N / (f.w * f.h) * 1e5;          // points per 100 000 square pixels
  ctx.globalAlpha = Math.max(0.3, Math.min(0.65, 0.65 * Math.sqrt(1000 / Math.max(crowd, 1))));
  const s = crowd > 1500 ? 1.3 : 1.8;
  const ax = f.w / (win.x1 - win.x0), ap = f.h / (win.p1 - win.p0);
  for (let i = 0; i < N; i++) {
    const px = f.left + (x[i] - win.x0) * ax, py = f.bottom - (p[i] - win.p0) * ap;
    if (px < f.left - 2 || px > f.right + 2 || py < f.top - 2 || py > f.bottom + 2) continue;
    ctx.fillRect(px - s / 2, py - s / 2, s, s);
  }
  ctx.restore();
}

const draggable = () => ['coherent', 'squeezed', 'cat'].includes(state.init.kind);
function drawHandle(ctx, f, c) {
  if (!draggable()) return;
  const it = state.init, pts = [[it.x0, it.p0, true]];
  if (it.kind === 'cat') pts.push([-it.x0, -it.p0, false]);
  ctx.save();
  for (const [x, p, main] of pts) {
    const px = f.X(x), py = f.Y(p);
    ctx.lineWidth = 2; ctx.strokeStyle = c.panel; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(px, py, 7, 0, 2 * Math.PI); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = c.ink; ctx.setLineDash(main ? [] : [3, 3]);
    ctx.beginPath(); ctx.arc(px, py, 7, 0, 2 * Math.PI); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(px - 3, py); ctx.lineTo(px + 3, py); ctx.moveTo(px, py - 3); ctx.lineTo(px, py + 3); ctx.stroke();
  }
  ctx.restore();
}

/** The shadow of W (or Q) on a line at angle theta: what a homodyne detector measures. */
function drawQuadrature(ctx, f, c) {
  const th = (state.quad * Math.PI) / 180, u = omegaRef, F = state.view === 'Q' ? grid.Q : grid.W;
  // In the oscillator's own units (x, p/u) the line is a diameter at angle theta.
  const R = Math.hypot(Math.max(Math.abs(win.x0), Math.abs(win.x1)), Math.max(Math.abs(win.p0), Math.abs(win.p1)) / u);
  const nb = 160, P = grid.quadrature(F, th, u, -R, R, nb);
  let pk = 0;
  for (const v of P) pk = Math.max(pk, v);
  const ex = Math.cos(th), ep = Math.sin(th);           // along the line, natural units
  const toPx = (X, Y) => [f.X(X * ex - Y * ep), f.Y(u * (X * ep + Y * ex))];
  const hgt = (0.28 * Math.min(win.x1 - win.x0, (win.p1 - win.p0) / u)) / (pk || 1);
  ctx.save();
  ctx.strokeStyle = c.accent; ctx.lineWidth = 1.2; ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(...toPx(-R, 0)); ctx.lineTo(...toPx(R, 0)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  for (let i = 0; i < nb; i++) {
    const X = -R + ((i + 0.5) * 2 * R) / nb;
    const [px, py] = toPx(X, P[i] * hgt);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.lineWidth = 2; ctx.stroke();
  ctx.globalAlpha = 0.15; ctx.fillStyle = c.accent;
  ctx.lineTo(...toPx(R, 0)); ctx.lineTo(...toPx(-R, 0)); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
  // A label at the positive end.
  const [lx, ly] = toPx(0.8 * Math.min(win.x1, (win.p1) / u, R), -0.05 * R);
  ctx.fillStyle = c.accent; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(`X at ${Math.round(state.quad)}°`, lx, ly + 14);
  ctx.restore();
}

function classicalHistogram(values, lo, hi, nb) {
  const h = new Float64Array(nb), w = (hi - lo) / nb, N = ens.N;
  for (let i = 0; i < N; i++) {
    const k = Math.floor((values[i] - lo) / w);
    if (k >= 0 && k < nb) h[k]++;
  }
  for (let k = 0; k < nb; k++) h[k] /= N * w;
  return h;
}

function drawMarginals(ctx, f, c) {
  const T = layout.top, R = layout.right, n = sim.n;
  ctx.save();
  // ---- |psi(x)|^2 above
  const j0 = Math.max(0, Math.ceil((win.x0 - sim.xmin) / sim.dx)), j1 = Math.min(n - 1, Math.floor((win.x1 - sim.xmin) / sim.dx));
  let mx = 0;
  for (let j = j0; j <= j1; j++) mx = Math.max(mx, sim.re[j] ** 2 + sim.im[j] ** 2);
  const nb = 90, hx = state.show.dots && ens.N ? classicalHistogram(ens.x, win.x0, win.x1, nb) : null;
  if (hx) for (const v of hx) mx = Math.max(mx, v);
  scaleX = Math.max(scaleX, 1.1 * mx || 1);
  const th = T.bottom - T.top, ty = (v) => T.bottom - (v / scaleX) * (th - 4);
  ctx.strokeStyle = c.line; ctx.strokeRect(T.left + 0.5, T.top + 0.5, T.right - T.left - 1, th - 1);
  ctx.beginPath();
  ctx.moveTo(f.X(sim.x[j0]), T.bottom);
  for (let j = j0; j <= j1; j++) ctx.lineTo(f.X(sim.x[j]), ty(sim.re[j] ** 2 + sim.im[j] ** 2));
  ctx.lineTo(f.X(sim.x[j1]), T.bottom); ctx.closePath();
  ctx.fillStyle = colorAt(0.55); ctx.fill();
  ctx.strokeStyle = colorAt(0.95); ctx.lineWidth = 1.5; ctx.stroke();
  if (state.view === 'Q') {
    const qm = grid.xMarginal(grid.Q);
    ctx.setLineDash([4, 3]); ctx.strokeStyle = c.ink2; ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let k = 0; k < grid.cols; k++) { const px = f.X(grid.x[k]), py = ty(qm[k]); if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.stroke(); ctx.setLineDash([]);
  }
  if (hx) stepLine(ctx, hx, (k) => f.X(win.x0 + ((win.x1 - win.x0) * k) / nb), ty, c, false);
  ctx.fillStyle = c.ink2; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('|ψ(x)|²', T.left + 6, T.top + 4);

  // ---- |phi(p)|^2 at the right
  const P = mom.d.length, dp = mom.dp;
  const k0 = Math.ceil(win.p0 / dp), k1 = Math.floor(win.p1 / dp);
  let mp = 0;
  for (let k = k0; k <= k1; k++) mp = Math.max(mp, mom.d[(k + P) % P]);
  const hp = state.show.dots && ens.N ? classicalHistogram(ens.p, win.p0, win.p1, nb) : null;
  if (hp) for (const v of hp) mp = Math.max(mp, v);
  scaleP = Math.max(scaleP, 1.1 * mp || 1);
  const rw = R.right - R.left, rx = (v) => R.left + (v / scaleP) * (rw - 4);
  ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.strokeRect(R.left + 0.5, R.top + 0.5, rw - 1, R.bottom - R.top - 1);
  ctx.beginPath();
  ctx.moveTo(R.left, f.Y(k0 * dp));
  for (let k = k0; k <= k1; k++) ctx.lineTo(rx(mom.d[(k + P) % P]), f.Y(k * dp));
  ctx.lineTo(R.left, f.Y(k1 * dp)); ctx.closePath();
  ctx.fillStyle = colorAt(0.55); ctx.fill();
  ctx.strokeStyle = colorAt(0.95); ctx.lineWidth = 1.5; ctx.stroke();
  if (state.view === 'Q') {
    const qm = grid.pMarginal(grid.Q);
    ctx.setLineDash([4, 3]); ctx.strokeStyle = c.ink2; ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let r = 0; r < grid.rows; r++) { const px = rx(qm[r]), py = f.Y(grid.p[r]); if (r) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.stroke(); ctx.setLineDash([]);
  }
  if (hp) stepLine(ctx, hp, (k) => f.Y(win.p0 + ((win.p1 - win.p0) * k) / nb), rx, c, true);
  ctx.save();
  ctx.translate(R.right - 6, R.top + 6); ctx.rotate(Math.PI / 2);
  ctx.fillStyle = c.ink2; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('|φ(p)|²', 0, 0);
  ctx.restore();
  ctx.restore();
}

/** A histogram as a stepped line: edge(k) maps bin edges, val(v) the heights. */
function stepLine(ctx, h, edge, val, c, vertical) {
  ctx.save();
  ctx.strokeStyle = c.ink; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.8;
  ctx.beginPath();
  for (let k = 0; k < h.length; k++) {
    const a = edge(k), b = edge(k + 1), v = val(h[k]);
    if (vertical) { if (k) ctx.lineTo(v, a); else ctx.moveTo(v, a); ctx.lineTo(v, b); }
    else { if (k) ctx.lineTo(a, v); else ctx.moveTo(a, v); ctx.lineTo(b, v); }
  }
  ctx.stroke();
  ctx.restore();
}

// The colour bar under the plot.
function drawColorbar() {
  const cv = $('#colorbar');
  if (!cv || !lut) return;
  const { ctx, width, height } = fitCanvas(cv);
  for (let i = 0; i < width; i++) {
    ctx.fillStyle = colorAt(-1 + (2 * (i + 0.5)) / width);
    ctx.fillRect(i, 0, 1, height);
  }
  ctx.strokeStyle = themeColors().line; ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
}

function updateLegend() {
  const s = colorScale(), name = state.view === 'Q' ? 'Q' : 'W';
  const fixedLabel = state.view === 'Q' ? '1/2πħ' : '1/πħ';
  $('#cb-lo').textContent = state.scale === 'fixed' ? `−${fixedLabel}` : `−${fmt(s, 2)}`;
  $('#cb-hi').textContent = state.scale === 'fixed' ? `+${fixedLabel}` : `+${fmt(s, 2)}`;
  $('#cb-name').textContent = name === 'W' ? 'W(x, p)' : 'Q(x, p)';
  const dots = $('#dots-note');
  if (!state.show.dots || !ens.N) dots.textContent = '';
  else dots.textContent = `• ${ens.N} classical points, drawn at t = 0 from ` + {
    W: 'W',
    Q: 'the Husimi Q (W < 0 in places, so it is not a probability density)',
    product: '|ψ(x)|² |φ(p)|² (W < 0 in places, so it is not a probability density)',
  }[dotsFrom];
  $('#hover').textContent = hover || '';
}

// ------------------------------------------------------------------ readouts

function updateReadouts() {
  const box = $('#readouts');
  if (!sim) return;
  const o = sim.observables();
  const parts = [
    `<span>t <b>${fmt(sim.t, 3)}</b></span>`,
    `<span>⟨x⟩ <b>${fmt(o.x, 3)}</b></span>`,
    `<span>⟨p⟩ <b>${fmt(o.p, 3)}</b></span>`,
    `<span>σ<sub>x</sub>σ<sub>p</sub> <b>${fmt(o.sx * o.sp, 3)}</b> ≥ ħ/2</span>`,
    `<span>⟨E⟩ <b>${fmt(o.E, 4)}</b></span>`,
  ];
  if (Wstats) {
    const neg = Wstats.min < -1e-4 / Math.PI;
    parts.push(`<span${neg ? ' class="neg"' : ''}>min W <b>${neg ? '−' : ''}${fmt(Math.abs(Wstats.min) * Math.PI, 3)}</b>/πħ</span>`);
    parts.push(`<span>W&lt;0 volume <b>${fmt(Wstats.negative < 1e-5 ? 0 : Wstats.negative, 3)}</b></span>`);
  }
  if (ens.N && state.show.dots) {
    const s = ens.stats(table);
    parts.push(`<span class="cl">classical ⟨E⟩ <b>${fmt(s.E, 4)}</b></span>`);
  }
  if (slowNote) parts.push(`<span class="warn">${slowNote}</span>`);
  box.innerHTML = parts.join('');
}
let slowNote = '';

// ------------------------------------------------------------------- the loop

let last = 0, dragging = null;
function loop(now) {
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  if (state.running && !dragging && sim && !errorText) advance(state.speed * dt);
  if (dirty) {
    if (grid) computePhase();
    draw();
    updateLegend();
    if (frameCount++ % 4 === 0 || !state.running) updateReadouts();
    dirty = false;
  }
  requestAnimationFrame(loop);
}
let frameCount = 0;
const kick = () => { dirty = true; };

// ------------------------------------------------------------------- controls

// Transport.
const playButton = $('#play');
function setRunning(on) {
  state.running = on;
  playButton.textContent = on ? 'Pause' : 'Play';
  playButton.setAttribute('aria-pressed', String(on));
}
playButton.addEventListener('click', () => setRunning(!state.running));
$('#restart').addEventListener('click', () => { restart(); kick(); });
const speedSlider = slider({ label: 'Speed', min: 0.1, max: 20, log: true, value: state.speed, title: 'Simulated time per second', onInput: (v) => { state.speed = v; updateHash(); } });
$('#speed-box').append(speedSlider);

// Potentials.
const potButtons = {};
for (const p of POTENTIALS) {
  potButtons[p.id] = el('button', { type: 'button', 'aria-pressed': 'false', onclick: () => { choosePotential(p); kick(); } }, p.label);
  $('#potentials').append(potButtons[p.id]);
}
const vField = exprField({
  label: '<math><mi>V</mi><mo>(</mo><mi>x</mi><mo>)</mo><mo>=</mo></math>', value: state.pot.V, variables: ['x'],
  params: state.pot.params,
  hints: { omega: { min: 0.2, max: 3, value: 1 }, lambda: { min: 0, max: 0.5, value: 0.05 }, D: { min: 1, max: 20, value: 8 }, a: { min: 0.2, max: 3, value: 1 }, V0: { min: 0, max: 10, value: 3 } },
  onChange: (expr, params) => {
    Vexpr = expr; Vparams = params;
    applyPotential();
    syncKindControls();
    restart();
    kick();
  },
});
$('#v-field').append(vField);

// Initial state.
const kindButtons = segmented([
  { value: 'coherent', label: 'Coherent', title: 'A coherent state: the ground state of the well\'s small oscillations, displaced to (x₀, p₀). Drag its centre on the plot.' },
  { value: 'squeezed', label: 'Squeezed', title: 'A squeezed Gaussian: narrower than a coherent state one way (by e^−r), wider the other' },
  { value: 'cat', label: 'Cat', title: 'Two coherent states at (x₀, p₀) and (−x₀, −p₀), added with relative phase φ' },
  { value: 'eigen', label: 'Eigenstate', title: 'A stationary state |n⟩ of the potential' },
  { value: 'two', label: 'Two levels', title: '(|n⟩ + |m⟩)/√2: two stationary states added' },
  { value: 'typed', label: 'Typed ψ₀', title: 'Any formula in x' },
], state.init.kind, (k) => { state.init.kind = k; syncKindControls(); restart(); kick(); }, { label: 'Kind of initial state' });
kindButtons.classList.add('kinds');
$('#kind').append(kindButtons);
const setInit = (key) => (v) => { state.init[key] = v; restart(); kick(); };
const x0Slider = slider({ label: '<math><msub><mi>x</mi><mn>0</mn></msub></math>', labelHTML: true, min: -6, max: 6, value: state.init.x0, onInput: setInit('x0') });
const p0Slider = slider({ label: '<math><msub><mi>p</mi><mn>0</mn></msub></math>', labelHTML: true, min: -6, max: 6, value: state.init.p0, onInput: setInit('p0') });
const rSlider = slider({ label: 'squeeze <math><mi>r</mi></math>', labelHTML: true, min: -2, max: 2, value: state.init.r, title: 'The ellipse is e^r times longer and e^−r times narrower than a coherent state', onInput: setInit('r') });
const thetaSlider = slider({ label: 'angle', min: -90, max: 90, value: state.init.theta, title: 'The direction of the narrow axis, in degrees from the x axis (in the oscillator\'s own units)', onInput: setInit('theta') });
const phiSlider = slider({ label: 'phase <math><mi>φ</mi></math>', labelHTML: true, min: 0, max: 360, value: state.init.phi, title: 'The relative phase of the two coherent states, in degrees: 0 even, 180 odd', onInput: setInit('phi') });
const nSlider = slider({ label: '<math><mi>n</mi></math>', labelHTML: true, min: 0, max: 20, step: 1, value: state.init.n, onInput: (v) => setInit('n')(Math.round(v)) });
const mSlider = slider({ label: '<math><mi>m</mi></math>', labelHTML: true, min: 0, max: 20, step: 1, value: state.init.m, onInput: (v) => setInit('m')(Math.round(v)) });
const typedField = exprField({
  label: '<math><msub><mi>ψ</mi><mn>0</mn></msub><mo>=</mo></math>', value: state.init.psi, variables: ['x'], params: state.init.params,
  hints: { a: { min: 0.1, max: 4, value: 1 }, x0: { min: -5, max: 5, value: 0 }, k: { min: -6, max: 6, value: 2 } },
  onChange: (expr, params) => { state.init.psi = expr.source; state.init.params = params; if (state.init.kind === 'typed') { restart(); kick(); } },
});
const stateNote = el('div', { class: 'note' });
$('#state-box').append(x0Slider, p0Slider, rSlider, thetaSlider, phiSlider, nSlider, mSlider, typedField, stateNote);

function syncKindControls() {
  const k = state.init.kind;
  kindButtons.value = k;
  const it = state.init;
  x0Slider.hidden = p0Slider.hidden = !['coherent', 'squeezed', 'cat'].includes(k);
  rSlider.hidden = thetaSlider.hidden = k !== 'squeezed';
  phiSlider.hidden = k !== 'cat';
  nSlider.hidden = !['eigen', 'two'].includes(k);
  mSlider.hidden = k !== 'two';
  typedField.hidden = k !== 'typed';
  const b = baseWindow();
  x0Slider.setRange(Math.min(b.x0, it.x0), Math.max(b.x1, it.x0));
  p0Slider.setRange(Math.min(b.p0, it.p0), Math.max(b.p1, it.p0));
  x0Slider.value = it.x0; p0Slider.value = it.p0; rSlider.value = it.r; thetaSlider.value = it.theta; phiSlider.value = it.phi;
  const top = Math.max(1, levels.length - 1);
  nSlider.setRange(0, top); mSlider.setRange(0, top);
  nSlider.value = it.n; mSlider.value = it.m;
  const harmonic = state.pot.id === 'harmonic';
  if (['coherent', 'squeezed', 'cat'].includes(k)) stateNote.textContent = 'Drag the centre on the plot (or use the arrow keys there).';
  else if (k === 'eigen' || k === 'two') stateNote.textContent = levels.length
    ? `${levels.length} stationary states fit in the window (n = 0…${levels.length - 1})${harmonic ? ': the oscillator\'s number states |n⟩' : ''}.`
    : 'This potential has no bound states.';
  else stateNote.textContent = 'Any formula in x; each new symbol gets a slider.  It is normalised for you.';
}

// What to show.
const viewSeg = segmented([
  { value: 'W', label: 'Wigner W', title: 'The Wigner function: its marginals are the probability densities; it can be negative' },
  { value: 'Q', label: 'Husimi Q', title: 'The Husimi function: W smoothed by a coherent state; never negative' },
], state.view, (v) => { state.view = v; kick(); updateHash(); }, { label: 'Which phase-space function' });
$('#view').append(viewSeg);
const showToggles = {
  dots: toggle('Classical points', state.show.dots, (on) => { state.show.dots = on; kick(); updateHash(); }, 'An ensemble of classical particles, drawn at t = 0 from W (or Q), each following Hamilton\'s equations'),
  contours: toggle('Energy contours', state.show.contours, (on) => { state.show.contours = on; kick(); updateHash(); }, 'Contours of H(x, p) = p²/2m + V(x) at the stationary states\' energies; dashed: ⟨E⟩'),
  marginals: toggle('Marginals', state.show.marginals, (on) => { state.show.marginals = on; layout = null; kick(); updateHash(); }, '|ψ(x)|² above and |φ(p)|² at the right: the integrals of W over p and over x'),
  quadrature: toggle('Quadrature', state.show.quadrature, (on) => { state.show.quadrature = on; quadSlider.hidden = !on; kick(); updateHash(); }, 'The distribution of x cos θ + (p/mω) sin θ: the shadow of W on a line at angle θ'),
};
$('#shows').append(...Object.values(showToggles));
const quadSlider = slider({ label: 'angle <math><mi>θ</mi></math>', labelHTML: true, min: -180, max: 180, value: state.quad, title: 'The quadrature\'s angle in degrees: 0 is x, 90 is p/mω', onInput: (v) => { state.quad = v; kick(); updateHash(); } });
quadSlider.hidden = !state.show.quadrature;
$('#quad-box').append(quadSlider);

// Numerics.
const dotsSlider = slider({ label: 'points', min: 200, max: 10000, step: 100, log: true, value: state.dots, title: 'How many classical points', onInput: (v) => { state.dots = Math.round(v); sampleDots(); kick(); } });
const scaleSeg = segmented([
  { value: 'fixed', label: 'Colours to ±1/πħ', title: 'Full colour at |W| = 1/πħ, the largest value W can take' },
  { value: 'auto', label: 'Auto', title: 'Full colour at the largest |W| shown' },
], state.scale, (v) => { state.scale = v; kick(); updateHash(); }, { label: 'Colour scale' });
const zoomSlider = slider({ label: 'window', min: 0.4, max: 3, log: true, value: state.zoom, title: 'The size of the window of phase space, relative to the preset', onInput: (v) => { state.zoom = v; gridKey = ''; ensureGrid(); syncKindControls(); sampleDots(); kick(); updateHash(); } });
const proxySeg = segmented([
  { value: 'Q', label: 'Husimi Q', title: 'W smoothed by a coherent state: positive, keeps the shape, but adds about ħω/2 of energy' },
  { value: 'product', label: '|ψ|²|φ|²', title: 'x and p drawn independently from their own distributions: the right marginals and mean energy, but no correlation between x and p' },
], state.proxy, (v) => { state.proxy = v; sampleDots(); kick(); updateHash(); }, { label: 'Where W is negative, draw the points from' });
const gridNote = el('div', { class: 'note' });
$('#numerics-box').append(dotsSlider, el('div', { class: 'note' }, 'Where W < 0 the points come from:'), proxySeg, scaleSeg, zoomSlider, gridNote);
function updateGridNote() {
  if (!grid || !sim) return;
  gridNote.textContent = `ψ: ${sim.n} points on [${fmt(sim.xmin, 3)}, ${fmt(sim.xmax, 3)}], ${state.pot.boundary}.  W: ${grid.cols} × ${grid.rows} points, `
    + `ψ band-limited to |p| < ${fmt(grid.pmax, 3)}.  Time step ${fmt(dtMax, 2)}.  Units ħ = m = 1.`;
}

// ------------------------------------------------------------------ choosing

function choosePotential(p, { keepInit = true } = {}) {
  state.pot = p;
  for (const [id, b] of Object.entries(potButtons)) b.setAttribute('aria-pressed', String(id === p.id));
  sim = new Sim1D({ n: p.n, xmin: p.domain[0], xmax: p.domain[1], boundary: p.boundary });
  gridKey = '';
  vField.set(p.V, { ...p.params }, false);
  Vexpr = vField.expr; Vparams = vField.params;
  applyPotential();
  state.speed = p.speed; speedSlider.value = p.speed;
  if (!keepInit) return;
  // Keep the kind of state, but put a displaced state somewhere sensible in this window.
  const b = baseWindow(), it = state.init;
  if (it.x0 < b.x0 || it.x0 > b.x1 || it.p0 < b.p0 || it.p0 > b.p1) { it.x0 = b.x0 + 0.7 * (b.x1 - b.x0); it.p0 = 0; }
  if ((it.kind === 'eigen' || it.kind === 'two') && !levels.length) it.kind = 'coherent';
  if (it.n >= levels.length) it.n = 0;
  if (it.m >= levels.length) it.m = Math.min(1, levels.length - 1);
  syncKindControls();
  restart();
}

// ------------------------------------------------------------------- pointer

function eventPoint(e) {
  const r = plot.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}
function inMain(px, py) {
  const m = layout?.main;
  return m && px >= m.left && px <= m.right && py >= m.top && py <= m.bottom;
}
let pendingMove = null;
plot.addEventListener('pointerdown', (e) => {
  const [px, py] = eventPoint(e);
  if (!frame || !inMain(px, py)) return;
  if (!draggable()) { toast('Coherent, squeezed and cat states can be dragged; this one stays put.'); return; }
  // A cat state: grab whichever of its two blobs is nearer.
  const it = state.init, x = frame.invX(px), p = frame.invY(py);
  const sign = it.kind === 'cat' && Math.hypot(frame.X(-it.x0) - px, frame.Y(-it.p0) - py) < Math.hypot(frame.X(it.x0) - px, frame.Y(it.p0) - py) ? -1 : 1;
  dragging = { sign };
  plot.setPointerCapture(e.pointerId);
  plot.classList.add('dragging');
  moveTo(x, p);
  e.preventDefault();
});
plot.addEventListener('pointermove', (e) => {
  const [px, py] = eventPoint(e);
  if (dragging) { moveTo(frame.invX(px), frame.invY(py)); return; }
  if (frame && grid && inMain(px, py)) {
    const x = frame.invX(px), p = frame.invY(py), F = state.view === 'Q' ? grid.Q : grid.W, v = grid.at(F, x, p);
    hover = `x = ${fmt(x, 3)}, p = ${fmt(p, 3)}:  ${state.view} = ${fmt(v, 3)} = ${fmt(v * Math.PI, 3)}/πħ`;
    plot.style.cursor = draggable() ? 'grab' : 'crosshair';
  } else hover = null;
  if (!state.running) updateLegend();
});
plot.addEventListener('pointerleave', () => { hover = null; updateLegend(); });
const endDrag = () => {
  if (!dragging) return;
  dragging = null; plot.classList.remove('dragging');
  restart(); kick();
};
plot.addEventListener('pointerup', endDrag);
plot.addEventListener('pointercancel', endDrag);

function moveTo(x, p) {
  const b = win;
  x = Math.max(b.x0, Math.min(b.x1, x)); p = Math.max(b.p0, Math.min(b.p1, p));
  state.init.x0 = dragging?.sign === -1 ? -x : x;
  state.init.p0 = dragging?.sign === -1 ? -p : p;
  // One restart per animation frame, however fast the pointer moves.
  if (!pendingMove) {
    pendingMove = requestAnimationFrame(() => {
      pendingMove = null;
      x0Slider.value = state.init.x0; p0Slider.value = state.init.p0;
      restart({ quick: true });
      kick();
    });
  }
}

// Keys: arrows move the centre; space plays and pauses; R restarts.
plot.addEventListener('keydown', (e) => {
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
  if (!d || !draggable()) return;
  e.preventDefault();
  const step = 0.02 * (win.x1 - win.x0) * (e.shiftKey ? 5 : 1);
  state.init.x0 += d[0] * step; state.init.p0 += d[1] * step * (win.p1 - win.p0) / (win.x1 - win.x0);
  x0Slider.value = state.init.x0; p0Slider.value = state.init.p0;
  restart(); kick();
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ') { e.preventDefault(); setRunning(!state.running); }
  else if (e.key === 'r' || e.key === 'R') { restart(); kick(); }
});
window.addEventListener('resize', () => { layout = null; kick(); });
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { lut = null; kick(); });

// ------------------------------------------------------------------ experiments

const byId = (id) => POTENTIALS.find((p) => p.id === id);
/**
 * Set up an experiment: potential (with parameters), initial state, what to show, speed.
 * t: run to this time straight away (then pause, unless run is true).
 */
function go(potId, { params, init = {}, view = 'W', show = {}, speed, quad, run = true, t = 0, zoom = 1, scale = 'fixed', proxy = 'Q' } = {}) {
  state.proxy = proxy; proxySeg.value = proxy;
  state.view = view; viewSeg.value = view;
  for (const [k, b] of Object.entries(showToggles)) {
    const on = show[k] ?? (k !== 'quadrature');
    b.on = on; state.show[k] = on;
  }
  quadSlider.hidden = !state.show.quadrature;
  if (quad !== undefined) { state.quad = quad; quadSlider.value = quad; }
  state.scale = scale; scaleSeg.value = scale;
  state.zoom = zoom; zoomSlider.value = zoom;
  layout = null;
  Object.assign(state.init, { r: 0.6, theta: 0, phi: 0, n: 1, m: 0 }, init);
  choosePotential(byId(potId), { keepInit: false });
  if (params) {
    vField.set(vField.source, params, false);
    Vexpr = vField.expr; Vparams = vField.params;
    applyPotential();
  }
  if (init.kind === 'typed' && init.psi) typedField.set(init.psi, init.params || {}, false);
  if (speed) { state.speed = speed; speedSlider.value = speed; }
  syncKindControls();
  // The plot must have its size before the first W.
  const r = fitCanvas(plot);
  layout = computeLayout(r.width, r.height);
  restart();
  if (t > 0) { for (let i = 0; i < 100000 && sim.t < t - 1e-9; i++) { const save = maxSteps; maxSteps = 100000; advance(Math.min(1, t - sim.t)); maxSteps = save; } }
  setRunning(run);
  kick();
  updateHash();
}

const setups = {
  coherent: () => go('harmonic', { init: { kind: 'coherent', x0: 3, p0: 0 }, speed: 1.5 }),
  squeezed: () => go('harmonic', { init: { kind: 'squeezed', x0: 3, p0: 0, r: 0.8, theta: 0 }, speed: 1 }),
  number: () => go('harmonic', { init: { kind: 'eigen', n: 1 }, show: { dots: true }, speed: 1 }),
  cat: () => go('harmonic', { init: { kind: 'cat', x0: 3, p0: 0, phi: 0 }, speed: 0.6 }),
  marginals: () => go('harmonic', { init: { kind: 'cat', x0: 0, p0: 3, phi: 0 }, show: { dots: false }, run: false }),
  free: () => go('free', { init: { kind: 'squeezed', x0: -5, p0: 1, r: 0.3, theta: 0 }, speed: 1 }),
  anharmonic: () => go('quartic', { init: { kind: 'coherent', x0: 3, p0: 0 }, speed: 2 }),
  orbits: () => go('morse', { init: { kind: 'eigen', n: 4 }, show: { dots: false }, speed: 1 }),
  tunnel: () => go('double', { init: { kind: 'two', n: 0, m: 1 }, speed: 6, proxy: 'product' }),
  uncertainty: () => go('harmonic', { init: { kind: 'squeezed', x0: 0, p0: 0, r: 1.2, theta: 30 }, show: { dots: false }, speed: 0.5 }),
  husimi: () => go('harmonic', { init: { kind: 'cat', x0: 3, p0: 0, phi: 0 }, view: 'Q', show: { dots: false }, run: false }),
  tomography: () => go('harmonic', { init: { kind: 'cat', x0: 3, p0: 0, phi: 0 }, show: { dots: false, quadrature: true }, quad: 0, speed: 0.5 }),
  typed: () => go('harmonic', { init: { kind: 'typed', psi: TYPED_PSI, params: { a: 2 } }, show: { dots: false }, speed: 0.5 }),
};
drawer($('#help'), $('#help-button'), setups);

// ------------------------------------------------------------------------ hash

const r5 = (v) => +(+v).toPrecision(5);
function updateHash() {
  if (!sim) return;
  const p = state.pot, it = state.init, h = { pot: p.id };
  if (vField.source !== p.V) h.V = vField.source;
  const vp = Object.fromEntries(Object.entries(Vparams).map(([k, v]) => [k, r5(v)]));
  if (Object.keys(vp).length) h.vp = JSON.stringify(vp);
  const init = { kind: it.kind };
  if (['coherent', 'squeezed', 'cat'].includes(it.kind)) Object.assign(init, { x0: r5(it.x0), p0: r5(it.p0) });
  if (it.kind === 'squeezed') Object.assign(init, { r: r5(it.r), theta: r5(it.theta) });
  if (it.kind === 'cat') init.phi = r5(it.phi);
  if (it.kind === 'eigen' || it.kind === 'two') init.n = it.n;
  if (it.kind === 'two') init.m = it.m;
  if (it.kind === 'typed') { init.psi = it.psi; init.params = Object.fromEntries(Object.entries(it.params).map(([k, v]) => [k, r5(v)])); }
  h.init = JSON.stringify(init);
  if (state.view !== 'W') h.view = state.view;
  const off = Object.entries(state.show).filter(([k, v]) => v !== (k !== 'quadrature')).map(([k]) => k);
  if (off.length) h.flip = off.join(',');
  if (state.show.quadrature) h.quad = r5(state.quad);
  if (state.scale !== 'fixed') h.scale = state.scale;
  if (state.proxy !== 'Q') h.proxy = state.proxy;
  if (state.zoom !== 1) h.zoom = r5(state.zoom);
  h.speed = r5(state.speed);
  writeHash(h);
}

function fromHash(h) {
  const pot = byId(h.pot);
  if (!pot) return false;
  try {
    const init = h.init ? JSON.parse(h.init) : {};
    if (!KINDS.includes(init.kind)) delete init.kind;
    const show = {};
    for (const k of (h.flip || '').split(',')) if (k in state.show) show[k] = k === 'quadrature';
    go(pot.id, {
      init, view: h.view === 'Q' ? 'Q' : 'W', show, quad: h.quad !== undefined ? +h.quad : undefined,
      speed: +h.speed > 0 ? +h.speed : undefined, zoom: +h.zoom > 0 ? +h.zoom : 1, scale: h.scale === 'auto' ? 'auto' : 'fixed',
      proxy: h.proxy === 'product' ? 'product' : 'Q',
      params: h.vp ? JSON.parse(h.vp) : undefined,
    });
    if (h.V) {
      vField.set(h.V, h.vp ? JSON.parse(h.vp) : {}, false);
      if (vField.expr) { Vexpr = vField.expr; Vparams = vField.params; applyPotential(); syncKindControls(); restart(); }
    }
  } catch { return false; }
  return true;
}

// ------------------------------------------------------------------------ start

const hash = readHash();
if (setups[hash.setup]) setups[hash.setup]();
else if (!fromHash(hash)) go('quartic', { init: { kind: 'coherent', x0: 3, p0: 0 }, speed: 2 });
setInterval(() => { updateGridNote(); slowNote = slowFrames > 5 ? 'running slower than the speed asked for' : ''; slowFrames = 0; }, 1000);
requestAnimationFrame(loop);

window.__app = {
  state, setups, go, restart, advance,
  get sim() { return sim; }, get grid() { return grid; }, get ens() { return ens; }, get levels() { return levels; },
  get Wstats() { return Wstats; }, get dotsFrom() { return dotsFrom; }, get table() { return table; }, get omegaRef() { return omegaRef; },
  computePhase, draw, frames: () => frameCount, frame: () => frame,
  ready: true,
};
