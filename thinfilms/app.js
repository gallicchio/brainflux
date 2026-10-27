// Interfaces and thin films: build a stack of layers and see what it does to light.
// Lengths in nanometres, angles in degrees.

import { MATERIALS, MATERIAL_ORDER, typedMaterial, indexArray } from './materials.js';
import { solve, rtBoth, field, makeWorkspace, sweepLayer, incidentE2, phaseDifference } from './tmm.js';
import { colorimeter, toDisplay, spectralColor, wavelengths } from './color.js';
import { parseDesign, expandDesign, drainingThickness } from './design.js';
import { tryParse } from '../lib/expr.js';
import { el, $, slider, segmented, toggle, exprField, drawer, readHash, writeHash, fmt } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors, niceTicks } from '../lib/plot.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ----------------------------------------------------------------------------- state

const state = {
  inc: { mat: 'air' },
  layers: [{ mat: 'water', d: 400 }],
  sub: { mat: 'air' },
  sel: 0,                      // -1 the incident medium, 0..L-1 a layer, L the substrate
  lambda: 550, theta: 0,
  pol: 'sp',                   // the plots: 'sp' both, 's', 'p', 'avg' (unpolarised)
  show: { R: true, T: true, A: true, log: false, film: true },
  x2: 'angle',                 // the second plot: 'angle' or 'thickness'
  dmaxPlot: 1000,
  fieldMode: 'E2', fieldPol: 's',
  film: { profile: 'drain', hBottom: 1500, running: true, probe: 0.3, dmax: 1000, view: 'R', bright: 1 },
  illum: 'd65',
  lrange: [380, 780],
};
const H_START = 1500;          // a fresh film's thickness at the bottom of the frame

const nLayers = () => state.layers.length;
let lastLayer = 0;             // the layer selected last: the white-light picture varies it
const medium = (i) => (i < 0 ? state.inc : i >= nLayers() ? state.sub : state.layers[i]);
const isLayer = (i) => i >= 0 && i < nLayers();
/** The layer whose thickness the white-light picture varies (-1 if there are none). */
function filmJ() { return isLayer(state.sel) ? state.sel : isLayer(lastLayer) ? lastLayer : nLayers() ? 0 : -1; }

// ------------------------------------------------------------------------ materials

const exprCache = new Map();
function exprOf(src) {
  if (!exprCache.has(src)) { const r = tryParse(src, { variables: ['lambda'] }); exprCache.set(src, r.expr || null); }
  return exprCache.get(src);
}
const DEFAULT_HINTS = {
  n: { min: 1, max: 4, value: 1.5 }, kappa: { min: 0, max: 6, value: 0 },
  A: { min: 1, max: 2.5, value: 1.5 }, B: { min: 0, max: 0.05, value: 0.004 },
  lambda_p: { min: 0.1, max: 1.5, value: 0.4 }, gamma: { min: 0, max: 1, value: 0.05 },
};
const TYPED_PRESETS = [
  { label: 'n', src: 'n', params: { n: 1.5 }, title: 'A constant index' },
  { label: 'n + iκ', src: 'n + i kappa', params: { n: 0.2, kappa: 3 }, title: 'A constant complex index: κ > 0 absorbs' },
  { label: 'Cauchy', src: 'A + B/lambda^2', params: { A: 1.5, B: 0.004 }, title: "Cauchy's formula for a glass (λ in µm)" },
  { label: 'Free electrons', src: 'sqrt(1 - (lambda/lambda_p)^2)', params: { lambda_p: 0.4 }, title: 'A lossless free-electron metal (plasma): transparent below λ_p, a perfect mirror above' },
];

const typedCache = new Map();
function matOf(m) {
  if (m.mat === 'typed') {
    const e = exprOf(m.src);
    if (!e) return MATERIALS.air;
    const params = {};
    for (const p of e.parameters) params[p] = m.params?.[p] ?? (DEFAULT_HINTS[p]?.value ?? 1);
    const key = m.src + JSON.stringify(params);
    if (!typedCache.has(key)) { if (typedCache.size > 100) typedCache.clear(); typedCache.set(key, typedMaterial(e, params)); }
    return typedCache.get(key);
  }
  return MATERIALS[m.mat] || MATERIALS.air;
}
/** [n[], kappa[]] of medium m over the wavelengths nms; never throws. */
function indices(m, nms) {
  try {
    const [n, k] = indexArray(matOf(m), nms);
    for (let i = 0; i < n.length; i++) {
      if (!Number.isFinite(n[i]) || !Number.isFinite(k[i])) { n[i] = 1; k[i] = 0; }
      else if (n[i] * n[i] + k[i] * k[i] < 1e-12) n[i] = 1e-6;   // N = 0 exactly has no admittance
    }
    return [n, k];
  } catch { return [new Float64Array(nms.length).fill(1), new Float64Array(nms.length)]; }
}
/** [n, kappa] of medium m at one wavelength; never throws. */
function index1(m, nm) {
  try {
    const v = matOf(m).index(nm);
    if (!Number.isFinite(v[0]) || !Number.isFinite(v[1])) return [1, 0];
    return v[0] * v[0] + v[1] * v[1] < 1e-12 ? [1e-6, 0] : v;
  } catch { return [1, 0]; }
}

/** The stack at one wavelength: n0 (real), layer arrays, ns.  reuse: fill a shared object. */
const oneStack = { nr: new Float64Array(0), ni: new Float64Array(0), d: new Float64Array(0), ns: [1, 0], n0: 1 };
function stackAt(nm, reuse = false) {
  const L = nLayers();
  let st = oneStack;
  if (!reuse) st = { nr: new Float64Array(L), ni: new Float64Array(L), d: new Float64Array(L) };
  else if (st.nr.length !== L) { st.nr = new Float64Array(L); st.ni = new Float64Array(L); st.d = new Float64Array(L); }
  for (let j = 0; j < L; j++) { const m = state.layers[j], v = index1(m, nm); st.nr[j] = v[0]; st.ni[j] = v[1]; st.d[j] = m.d; }
  st.n0 = Math.max(0.01, index1(state.inc, nm)[0]); st.ns = index1(state.sub, nm);
  return st;
}
/** Index tables for every medium over nms, and a function filling the stack at sample i. */
function stackTable(nms) {
  const inc = indices(state.inc, nms), sub = indices(state.sub, nms), lay = state.layers.map((m) => indices(m, nms));
  const L = nLayers(), nr = new Float64Array(L), ni = new Float64Array(L), d = Float64Array.from(state.layers, (m) => m.d);
  const ns = [1, 0];
  return {
    at(i) {
      for (let j = 0; j < L; j++) { nr[j] = lay[j][0][i]; ni[j] = lay[j][1][i]; }
      ns[0] = sub[0][i]; ns[1] = sub[1][i];
      return { n0: Math.max(0.01, inc[0][i]), nr, ni, d, ns };
    },
  };
}

// --------------------------------------------------------------------------- computing

let comp = {};                 // everything the drawing needs, recomputed by compute()
let ws = makeWorkspace(64);  // grown as needed: room for every layer

// Each part of the computation is kept until something it depends on changes, so that dragging
// the wavelength does not recompute the curves against wavelength, and so on.
const cache = new Map();
function cached(name, key, f) {
  const c = cache.get(name);
  if (c && c.key === key) return c.value;
  const value = f();
  cache.set(name, { key, value });
  return value;
}

// R, T, A for both polarisations into the curves at sample i; T counts as absorbed when the
// substrate absorbs (a semi-infinite absorbing substrate swallows all that enters it).
const RT = new Float64Array(4);
function both(st, nm, beta, out, i) {
  rtBoth(st.n0, st.nr, st.ni, st.d, st.ns, nm, beta, RT);
  const absorbing = st.ns[1] > 1e-12, Ts = absorbing ? 0 : RT[1], Tp = absorbing ? 0 : RT[3];
  out.R.s[i] = RT[0]; out.R.p[i] = RT[2];
  out.T.s[i] = Ts; out.T.p[i] = Tp;
  out.A.s[i] = 1 - RT[0] - Ts; out.A.p[i] = 1 - RT[2] - Tp;
}
function curves(m) {
  const mk = () => ({ s: new Float64Array(m), p: new Float64Array(m) });
  return { R: mk(), T: mk(), A: mk() };
}

function computeSpectrum(m) {
  const [a, b] = state.lrange;
  const nms = Float64Array.from({ length: m }, (_, i) => a + ((b - a) * i) / (m - 1));
  const tab = stackTable(nms), out = curves(m), s = Math.sin(state.theta * DEG);
  for (let i = 0; i < m; i++) { const st = tab.at(i); both(st, nms[i], st.n0 * s, out, i); }
  out.x = nms;
  return out;
}

function computeAngles(m) {
  const st = stackAt(state.lambda), out = curves(m);
  const xs = Float64Array.from({ length: m }, (_, i) => (89.9 * i) / (m - 1));
  for (let i = 0; i < m; i++) both(st, state.lambda, st.n0 * Math.sin(xs[i] * DEG), out, i);
  out.x = xs;
  return out;
}

function computeThickness(m) {
  const j = state.sel;
  if (!isLayer(j)) return null;
  const st = stackAt(state.lambda), beta = st.n0 * Math.sin(state.theta * DEG), out = curves(m);
  const xs = Float64Array.from({ length: m }, (_, i) => (state.dmaxPlot * i) / (m - 1));
  for (const pol of ['s', 'p']) {
    sweepLayer(st.n0, st.nr, st.ni, st.d, st.ns, state.lambda, beta, pol, j, xs, out.R[pol], out.T[pol]);
    for (let i = 0; i < m; i++) {
      if (st.ns[1] > 1e-12) out.T[pol][i] = 0;
      out.A[pol][i] = 1 - out.R[pol][i] - out.T[pol][i];
    }
  }
  out.x = xs;
  return out;
}

/** The values at the current wavelength and angle. */
function pointValues() {
  const st = stackAt(state.lambda), beta = st.n0 * Math.sin(state.theta * DEG), v = {};
  for (const pol of ['s', 'p']) {
    const r = solve(st.n0, st.nr, st.ni, st.d, st.ns, state.lambda, beta, pol);
    let T = r.T, A = 1 - r.R - r.T;
    if (st.ns[1] > 1e-12) { A += T; T = 0; }
    v[pol] = { ...r, T, A };
  }
  v.st = st; v.beta = beta;
  return v;
}

function computeField(zs) {
  const st = stackAt(state.lambda, true), beta = st.n0 * Math.sin(state.theta * DEG);
  if (ws.Br.length < st.nr.length) ws = makeWorkspace(2 * st.nr.length);
  solve(st.n0, st.nr, st.ni, st.d, st.ns, state.lambda, beta, state.fieldPol, ws);
  const f = field(ws, zs), norm = incidentE2(ws);
  for (let i = 0; i < zs.length; i++) f.E2[i] /= norm;
  f.norm = Math.sqrt(norm);
  return f;
}

// White light.  The swatches: 1 nm steps (sharp Fabry-Perot peaks need them); the film
// picture: 5 nm steps, which resolve the fringes of films up to several micrometres.
const colorCache = {};
function meter(step) {
  const key = `${state.illum}:${step}`;
  if (!colorCache[key]) colorCache[key] = colorimeter(wavelengths(380, 780, step), state.illum);
  return colorCache[key];
}

/** XYZ of the reflected and transmitted light for the stack as it is (unpolarised). */
function stackXYZ() {
  // 1 nm steps when the stack is optically thick enough for sharp fringes (a Fabry-Perot), 4 nm
  // otherwise: a spectrum's fringes are about lambda^2 / 2nd apart.
  const optical = state.layers.reduce((a, m) => a + m.d * Math.max(1, index1(m, 550)[0]), 0);
  const cm = meter(optical > 1200 ? 1 : 4), nms = cm.nms, tab = stackTable(nms), m = nms.length;
  const R = new Float64Array(m), T = new Float64Array(m), s = Math.sin(state.theta * DEG);
  for (let i = 0; i < m; i++) {
    const st = tab.at(i);
    rtBoth(st.n0, st.nr, st.ni, st.d, st.ns, nms[i], st.n0 * s, RT);
    R[i] = (RT[0] + RT[2]) / 2; T[i] = st.ns[1] > 1e-12 ? 0 : (RT[1] + RT[3]) / 2;
  }
  return { R: cm.xyz(R), T: cm.xyz(T), cm };
}

/** Film rows: XYZ of R and T for the selected layer at each of the thicknesses hs. */
function filmXYZ(hs) {
  const cm = meter(5), nms = cm.nms, j = filmJ(), rows = hs.length;
  const XR = new Float64Array(rows * 3), XT = new Float64Array(rows * 3);
  const R = new Float64Array(rows), T = new Float64Array(rows), tab = stackTable(nms), s = Math.sin(state.theta * DEG);
  for (let i = 0; i < nms.length; i++) {
    const st = tab.at(i), beta = st.n0 * s, wx = cm.wx[i], wy = cm.wy[i], wz = cm.wz[i];
    // Unpolarised light: the average of s and p, which are the same at normal incidence.
    const pols = beta === 0 ? ['s'] : ['s', 'p'], w = 1 / pols.length;
    for (const pol of pols) {
      sweepLayer(st.n0, st.nr, st.ni, st.d, st.ns, nms[i], beta, pol, j, hs, R, T);
      const absorbing = st.ns[1] > 1e-12;
      for (let k = 0; k < rows; k++) {
        const r = R[k] * w, t = absorbing ? 0 : T[k] * w;
        XR[3 * k] += r * wx; XR[3 * k + 1] += r * wy; XR[3 * k + 2] += r * wz;
        XT[3 * k] += t * wx; XT[3 * k + 1] += t * wy; XT[3 * k + 2] += t * wz;
      }
    }
  }
  return { XR, XT, cm };
}

// The brightness of the picture: set so that the brightest colour any thickness of the selected
// layer (0 to 1.5 um, or the wedge's range) can give fills the screen, so that the picture does
// not flicker as the film drains.  Recomputed only when something other than that thickness
// changes.
let exposureKey = '', exposure = { R: 1, T: 1 };
function updateExposure() {
  const fj = filmJ();
  const key = JSON.stringify([state.inc, state.sub, state.layers.map((m, j) => (j === fj ? m.mat : m)), fj, state.theta, state.illum, state.film.profile, state.film.dmax]);
  if (key === exposureKey) return;
  exposureKey = key;
  let YR = 0, YT = 0;
  if (isLayer(fj)) {
    const top = state.film.profile === 'wedge' ? Math.max(state.film.dmax, 50) : H_START;
    const hs = Float64Array.from({ length: 121 }, (_, i) => (top * i) / 120);
    const { XR, XT } = filmXYZ(hs);
    for (let k = 0; k < hs.length; k++) { YR = Math.max(YR, lum(XR, k)); YT = Math.max(YT, lum(XT, k)); }
  } else {
    const x = stackXYZ();
    YR = lumOf(x.cm.linear(x.R)); YT = lumOf(x.cm.linear(x.T));
  }
  exposure = { R: clamp(0.85 / Math.max(YR, 1e-6), 1, 40), T: clamp(0.85 / Math.max(YT, 1e-6), 1, 40) };
}
// Luminance of linear sRGB, and the largest channel, for exposure: use the brightest channel so
// that saturated colours are not clipped.
const lumOf = (rgb) => Math.max(rgb[0], rgb[1], rgb[2]);
function lum(X, k) { const cm = meter(5); return lumOf(cm.linear([X[3 * k], X[3 * k + 1], X[3 * k + 2]])); }

// The selected layer's thickness at fractional height y of the picture (0 top, 1 bottom).
function filmThickness(y) {
  return state.film.profile === 'wedge' ? state.film.dmax * y : drainingThickness(y, state.film.hBottom);
}
// Where in the picture the selected layer has thickness d (or null).
function filmHeightOf(d) {
  if (state.film.profile === 'wedge') return state.film.dmax > 0 && d <= state.film.dmax ? d / state.film.dmax : null;
  if (d < 25) return null;
  const y = (d / state.film.hBottom) ** 2;
  return y <= 1 ? y : null;
}

function compute() {
  const ms = {}, T = (k, f) => { const t0 = performance.now(); const r = f(); ms[k] = performance.now() - t0; return r; };
  const stackKey = JSON.stringify([state.inc, state.layers, state.sub]);
  // The stack without the selected layer's thickness: what the film picture and the plot against
  // thickness depend on.
  const free = (k) => JSON.stringify([state.inc, state.layers.map((m, j) => (j === k ? { ...m, d: 0 } : m)), state.sub, k]);
  const selFree = free(state.sel), filmFree = free(filmJ());
  const mSpec = clamp(Math.round((comp.specWidth || 600) * 1.25), 200, 1400), mAng = clamp(Math.round(comp.angWidth || 600), 150, 900);
  comp.spec = T('spec', () => cached('spec', JSON.stringify([stackKey, state.theta, state.lrange, mSpec]), () => computeSpectrum(mSpec)));
  comp.x2kind = state.x2 === 'thickness' && isLayer(state.sel) ? 'thickness' : 'angle';
  comp.x2 = T('x2', () => (comp.x2kind === 'thickness'
    ? cached('thick', JSON.stringify([selFree, state.lambda, state.theta, state.dmaxPlot, mAng]), () => computeThickness(mAng))
    : cached('angle', JSON.stringify([stackKey, state.lambda, mAng]), () => computeAngles(mAng))));
  comp.point = T('point', pointValues);
  comp.white = T('white', () => cached('white', JSON.stringify([stackKey, state.theta, state.illum]), stackXYZ));
  if (state.show.film) {
    T('exposure', updateExposure);
    const rows = 180, f = state.film;
    comp.film = T('film', () => cached('film', JSON.stringify([filmFree, state.theta, state.illum, f.profile, f.hBottom, f.dmax, rows]), () => {
      if (!isLayer(filmJ())) return null;
      const hs = Float64Array.from({ length: rows }, (_, k) => filmThickness((k + 0.5) / rows));
      return { hs, ...filmXYZ(hs) };
    }));
  }
  comp.rpMin = T('rpMin', () => (comp.x2kind === 'angle' ? cached('rpMin', JSON.stringify([stackKey, state.lambda, mAng]), rpMinimum) : null));
  comp.finesse = T('finesse', () => finesse(JSON.stringify([stackKey, state.theta, state.lrange, mSpec])));
  comp.swatch = T('swatch', swatchColors);
  comp.ms = ms;                // milliseconds per part, for the tests and for profiling
}

// The angle of least R_p, refined, if there is a clear dip (the Brewster angle, a plasmon).
function rpMinimum() {
  if (comp.x2kind !== 'angle') return null;
  const { x, R } = comp.x2;
  let k = 0;
  for (let i = 1; i < x.length; i++) if (R.p[i] < R.p[k]) k = i;
  if (k === 0 || k === x.length - 1) return null;
  // Only a dip that absorption makes (a plasmon, a metal's principal angle): a lossless stack's
  // R_p can vanish at several angles, and the Brewster angle has its own mark.
  if (!comp.x2.A.p.some((a) => a > 1e-4)) return null;
  let max = 0;
  for (let i = 0; i < x.length; i++) max = Math.max(max, R.p[i]);
  if (!(R.p[k] < max - 0.02)) return null;
  // Golden-section refinement between the neighbours.
  const st = stackAt(state.lambda);
  const Rp = (th) => rtBoth(st.n0, st.nr, st.ni, st.d, st.ns, state.lambda, st.n0 * Math.sin(th * DEG), RT)[2];
  let a = x[k - 1], b = x[k + 1];
  for (let it = 0; it < 40; it++) {
    const c = b - (b - a) * 0.618, d = a + (b - a) * 0.618;
    if (Rp(c) < Rp(d)) b = d; else a = c;
  }
  const th = (a + b) / 2;
  return { theta: th, R: Rp(th) };
}

// Transmission peaks of the unpolarised T against wavelength, for the Fabry-Perot readouts:
// the width of the peak nearest the present wavelength (refined on the exact curve) and, if its
// neighbour is a peak like it, their spacing and the finesse, spacing / width.  The refined
// peaks are kept (key: the curve's own inputs), so moving the wavelength costs nothing.
let peakCache = { key: '', widths: new Map() };
function finesse(key) {
  if (peakCache.key !== key) peakCache = { key, widths: new Map() };
  const { x, T } = comp.spec, m = x.length;
  const t = (i) => (T.s[i] + T.p[i]) / 2;
  // Peaks that stand clear: T falls below half the peak on both sides before the next rise.
  const peaks = [];
  for (let i = 1; i < m - 1; i++) {
    if (!(t(i) >= t(i - 1) && t(i) > t(i + 1) && t(i) > 0.02)) continue;
    let l = i, r = i;
    while (l > 0 && t(l - 1) <= t(l) && t(l) > t(i) / 2) l--;
    while (r < m - 1 && t(r + 1) <= t(r) && t(r) > t(i) / 2) r++;
    if (t(l) < t(i) / 2 && t(r) < t(i) / 2) peaks.push(i);
  }
  if (!peaks.length) return null;
  const sinT = Math.sin(state.theta * DEG);
  const Tat = (nm) => {
    const st = stackAt(nm, true);
    rtBoth(st.n0, st.nr, st.ni, st.d, st.ns, nm, st.n0 * sinT, RT);
    return st.ns[1] > 1e-12 ? 0 : (RT[1] + RT[3]) / 2;
  };
  const dx = x[1] - x[0];
  const width = (i) => {
    if (peakCache.widths.has(i)) return peakCache.widths.get(i);
    let lo = x[i] - dx, hi = x[i] + dx;
    for (let it = 0; it < 32; it++) { const c = hi - (hi - lo) * 0.618, d = lo + (hi - lo) * 0.618; if (Tat(c) > Tat(d)) hi = d; else lo = c; }
    const top = (lo + hi) / 2, Tmax = Tat(top);
    const half = (dir) => {
      let a = top, b = top + dir * dx;
      for (let k = 0; k < 400 && Tat(b) > Tmax / 2; k++) { a = b; b += dir * dx; }
      for (let it = 0; it < 32; it++) { const c = (a + b) / 2; if (Tat(c) > Tmax / 2) a = c; else b = c; }
      return (a + b) / 2;
    };
    const w = { peak: top, Tmax, fwhm: half(1) - half(-1) };
    peakCache.widths.set(i, w);
    return w;
  };
  let k = 0;
  peaks.forEach((p, i) => { if (Math.abs(x[p] - state.lambda) < Math.abs(x[peaks[k]] - state.lambda)) k = i; });
  const out = { ...width(peaks[k]) };
  if (!(out.fwhm < (x[m - 1] - x[0]) / 8)) return null;     // a broad hump, not a line
  const k2 = k + 1 < peaks.length ? k + 1 : k - 1;
  if (k2 >= 0 && k2 !== k) {
    const other = width(peaks[k2]);
    if (other.fwhm < 2 * out.fwhm && other.fwhm > out.fwhm / 2) {
      out.spacing = Math.abs(other.peak - out.peak);
      out.F = out.spacing / out.fwhm;
    }
  }
  return out;
}

// ------------------------------------------------------------------------------ drawing

let colors = themeColors();
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
let series = {};
function readColors() {
  colors = themeColors();
  series = { R: css('--c-r') || '#2a78d6', T: css('--c-t') || '#eb6834', A: css('--c-a') || '#1baf7a', field: css('--c-field') || colors.ink };
}
readColors();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { readColors(); kick(); });

// Material tints for the drawing of the stack.
const TINT = {
  air: null, water: [200, 70, 55, 0.22], oil: [42, 80, 50, 0.3], mgf2: [265, 45, 62, 0.25], silica: [185, 30, 55, 0.25],
  bk7: [195, 35, 50, 0.32], tio2: [330, 45, 58, 0.36], silver: [215, 8, 62, 0.7], gold: [42, 70, 50, 0.75], aluminium: [210, 6, 58, 0.7],
};
function tintOf(m, nm) {
  if (m.mat !== 'typed') { const t = TINT[m.mat]; return t ? `hsla(${t[0]},${t[1]}%,${t[2]}%,${t[3]})` : null; }
  const [n, k] = index1(m, nm);
  if (k > 0.5) return `hsla(30,10%,55%,${clamp(0.3 + k / 10, 0.3, 0.75)})`;
  if (Math.abs(n - 1) < 1e-3 && k < 1e-3) return null;
  return `hsla(160,30%,50%,${clamp(0.12 + (n - 1) * 0.2, 0.08, 0.45)})`;
}
const shortName = (m) => (m.mat === 'typed' ? m.label || 'n(λ)' : MATERIALS[m.mat]?.short || m.mat);

function fmtLen(nm) {
  if (nm >= 10000) return `${fmt(nm / 1000, 3)} µm`;
  if (nm >= 1000) return `${fmt(nm / 1000, 3)} µm`;
  return `${nm < 10 ? fmt(nm, 2) : Math.round(nm)} nm`;
}
const pct = (v) => (Math.abs(v) < 1e-9 ? '0%' : v > 0.99995 && v < 1 ? '100%' : v >= 0.9995 && v < 1 ? `${(100 * v).toFixed(2)}%` : v < 0.001 && v > 0 ? `${(100 * v).toExponential(1)}%` : `${(100 * v).toFixed(v < 0.1 ? 2 : 1)}%`);

// --- the stack and the field

let zFrozen = null, frames = {};
function totalThickness() { return state.layers.reduce((a, m) => a + m.d, 0); }
function zRange() {
  if (zFrozen) return zFrozen;
  const t = totalThickness(), m = Math.max(0.3 * t, 300);
  return [-m, t + m];
}
let yMaxField = 2;

function drawStack(now) {
  const cv = $('#stack');
  const { ctx, width, height } = fitCanvas(cv);
  ctx.clearRect(0, 0, width, height);
  const c = colors, f = new Frame(ctx, width, height, { left: 46, right: 12, top: 30, bottom: 34 });
  frames.stack = f;
  const [z0, z1] = zRange();
  f.x0 = z0; f.x1 = z1;
  const L = nLayers(), starts = [0];
  for (const m of state.layers) starts.push(starts[starts.length - 1] + m.d);
  const zs = Float64Array.from({ length: Math.max(2, Math.round(f.w)) + 1 }, (_, i) => z0 + ((z1 - z0) * i) / Math.max(2, Math.round(f.w)));
  const fl = computeField(zs);
  comp.field = fl;
  const wave = state.fieldMode === 'wave';
  // y range: |E|^2 from 0, or +-|E_t| for the wave; grows at once, shrinks with hysteresis.
  let peak = 0;
  for (let i = 0; i < zs.length; i++) peak = Math.max(peak, wave ? Math.hypot(fl.Er[i], fl.Ei[i]) / fl.norm : fl.E2[i]);
  const want = Math.max(wave ? 1.2 : 1.5, peak * 1.1);
  if (want > yMaxField || want < 0.55 * yMaxField || comp.fieldWave !== wave) yMaxField = want;
  comp.fieldWave = wave;
  f.y0 = wave ? -yMaxField : 0; f.y1 = yMaxField;

  // Bands.
  const regions = [[z0, 0, state.inc, -1], ...state.layers.map((m, j) => [starts[j], starts[j + 1], m, j]), [starts[L], z1, state.sub, L]];
  f.clip();
  for (const [a, b, m] of regions) {
    const t = tintOf(m, state.lambda);
    if (!t) continue;
    ctx.fillStyle = t;
    ctx.fillRect(f.X(a), f.top, f.X(b) - f.X(a), f.h);
  }
  // Selected region.
  const selReg = regions[state.sel + 1];
  if (selReg) {
    ctx.fillStyle = c.accent; ctx.globalAlpha = 0.08;
    ctx.fillRect(f.X(selReg[0]), f.top, f.X(selReg[1]) - f.X(selReg[0]), f.h);
    ctx.globalAlpha = 1;
  }
  // The field.
  if (wave) {
    const ph = ((now || performance.now()) / 1000) * 2 * Math.PI * 0.6;
    const cw = Math.cos(ph), sw = Math.sin(ph);
    ctx.beginPath();
    for (let i = 0; i < zs.length; i++) { const v = Math.hypot(fl.Er[i], fl.Ei[i]) / fl.norm, x = f.X(zs[i]); if (i) ctx.lineTo(x, f.Y(v)); else ctx.moveTo(x, f.Y(v)); }
    for (let i = zs.length - 1; i >= 0; i--) { const v = Math.hypot(fl.Er[i], fl.Ei[i]) / fl.norm; ctx.lineTo(f.X(zs[i]), f.Y(-v)); }
    ctx.closePath(); ctx.fillStyle = series.field; ctx.globalAlpha = 0.1; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = series.field; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i < zs.length; i++) {
      // Re(E e^{-i w t})
      const v = (fl.Er[i] * cw + fl.Ei[i] * sw) / fl.norm, x = f.X(zs[i]);
      if (i) ctx.lineTo(x, f.Y(v)); else ctx.moveTo(x, f.Y(v));
    }
    ctx.stroke();
    ctx.strokeStyle = c.ink3; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(f.left, f.Y(0)); ctx.lineTo(f.right, f.Y(0)); ctx.stroke(); ctx.setLineDash([]);
  } else {
    ctx.beginPath(); ctx.moveTo(f.X(zs[0]), f.Y(0));
    for (let i = 0; i < zs.length; i++) ctx.lineTo(f.X(zs[i]), f.Y(fl.E2[i]));
    ctx.lineTo(f.X(zs[zs.length - 1]), f.Y(0)); ctx.closePath();
    ctx.fillStyle = series.field; ctx.globalAlpha = 0.12; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = series.field; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i < zs.length; i++) { const x = f.X(zs[i]), y = f.Y(fl.E2[i]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke();
    // The incoming wave's level.
    ctx.strokeStyle = c.ink3; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(f.left, f.Y(1)); ctx.lineTo(f.right, f.Y(1)); ctx.stroke(); ctx.setLineDash([]);
  }
  // Boundaries.
  ctx.strokeStyle = c.ink2; ctx.lineWidth = 1;
  for (let j = 0; j <= L; j++) { const x = Math.round(f.X(starts[j])) + 0.5; ctx.beginPath(); ctx.moveTo(x, f.top); ctx.lineTo(x, f.bottom); ctx.stroke(); }
  // The incoming light: an arrow at the angle of incidence.
  {
    const x0 = Math.max(f.left + 10, f.X(z0 + (0 - z0) * 0.12)), y0 = f.top + 10, len = 36, a = state.theta * DEG;
    const x1 = x0 + len * Math.cos(a), y1 = y0 + len * Math.sin(a);
    if (x1 < f.X(0) - 4) {
      ctx.strokeStyle = c.ink2; ctx.fillStyle = c.ink2; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - 8 * Math.cos(a - 0.4), y1 - 8 * Math.sin(a - 0.4)); ctx.lineTo(x1 - 8 * Math.cos(a + 0.4), y1 - 8 * Math.sin(a + 0.4)); ctx.closePath(); ctx.fill();
      ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      const label = `${fmt(state.lambda, 4)} nm, ${fmt(state.theta, 3)}°`;
      if (x1 + 10 + ctx.measureText(label).width < f.X(0)) ctx.fillText(label, x1 + 6, y1 + 2);
    }
  }
  ctx.restore();
  f.axes({ colors: c, xlabel: 'depth z (nm)', ylabel: wave ? `Re E (${state.fieldPol === 's' ? 'y' : 'x'}), tangential` : '|E|²' });
  // Handles on each layer's right-hand edge, and labels above the bands.
  ctx.save();
  ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
  for (const [a, b, m, j] of regions) {
    const xa = Math.max(f.left, f.X(a)), xb = Math.min(f.right, f.X(b)), w = xb - xa;
    let text = j < 0 || j >= L ? shortName(m) : `${shortName(m)} ${fmtLen(m.d)}`;
    if (ctx.measureText(text).width > w - 4) text = j < 0 || j >= L ? text : shortName(m);
    if (ctx.measureText(text).width > w - 4 && j !== state.sel) continue;
    ctx.fillStyle = j === state.sel ? c.accent : c.ink2;
    ctx.font = j === state.sel ? '600 11px system-ui, sans-serif' : '11px system-ui, sans-serif';
    ctx.fillText(text, clamp((xa + xb) / 2, f.left + ctx.measureText(text).width / 2, f.right - ctx.measureText(text).width / 2), f.top - 9);
  }
  for (let j = 0; j < L; j++) {
    const x = f.X(starts[j + 1]);
    ctx.fillStyle = dragging === j ? c.accent : hoverHandle === j ? c.accent : c.ink3;
    roundRect(ctx, x - 3, f.top - 6, 6, 14, 2); ctx.fill();
  }
  ctx.restore();
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// --- the R, T, A plots

const LOG_MIN = -4;
function drawCurves(cv, data, { x0, x1, xlabel, marker, markerText, kind }) {
  const { ctx, width, height } = fitCanvas(cv);
  ctx.clearRect(0, 0, width, height);
  const c = colors, log = state.show.log;
  const f = new Frame(ctx, width, height, { left: 42, right: 12, top: 22, bottom: 34 });
  f.x0 = x0; f.x1 = x1;
  const pols = state.pol === 'sp' ? ['s', 'p'] : state.pol === 'avg' ? ['avg'] : [state.pol];
  const anyA = ['s', 'p'].some((p) => data.A[p].some((v) => v > 1e-5));
  const qs = ['R', 'T', 'A'].filter((q) => state.show[q] && (q !== 'A' || anyA));
  // Linear: 0 to 1, or zoomed in when everything shown stays small (a soap film's R).
  let top = 0;
  for (const q of qs) for (const p of ['s', 'p']) for (const v of data[q][p]) top = Math.max(top, v);
  const yTop = top > 0.4 || !qs.length ? 1 : niceUp(Math.max(top * 1.12, 1e-3));
  if (log) { f.y0 = LOG_MIN; f.y1 = 0; } else { f.y0 = 0; f.y1 = yTop; }
  const Y = log ? (v) => f.Y(Math.log10(Math.max(v, 10 ** (LOG_MIN - 1)))) : (v) => f.Y(v);
  // Grid lines.
  ctx.strokeStyle = c.line; ctx.lineWidth = 1;
  const yt = log ? [-4, -3, -2, -1, 0] : niceTicks(0, yTop, Math.max(2, Math.round(f.h / 50)));
  for (const v of yt) { const y = Math.round(f.Y(v)) + 0.5; ctx.beginPath(); ctx.moveTo(f.left, y); ctx.lineTo(f.right, y); ctx.stroke(); }
  ctx.save(); ctx.beginPath(); ctx.rect(f.left, f.top - 3, f.w, f.h + 6); ctx.clip();
  if (kind === 'spec') ctx.drawImage(spectrumBand(f), f.left, f.bottom - 5, f.w, 5);
  for (const q of qs) for (const pol of pols) {
    const arr = pol === 'avg' ? data[q].s.map((v, i) => (v + data[q].p[i]) / 2) : data[q][pol];
    ctx.strokeStyle = series[q]; ctx.lineWidth = 2; ctx.setLineDash(pol === 'p' ? [6, 4] : []);
    ctx.beginPath();
    for (let i = 0; i < data.x.length; i++) { const x = f.X(data.x[i]), y = Y(arr[i]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // Extras: the critical and Brewster angles, the R_p minimum.
  if (kind === 'angle') angleMarks(ctx, f);
  // The marker.
  const mx = Math.round(f.X(marker)) + 0.5;
  ctx.strokeStyle = c.ink; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(mx, f.top); ctx.lineTo(mx, f.bottom); ctx.stroke();
  ctx.restore();
  // Axes (log ticks by hand).
  f.axes({ colors: c, yTicks: !log });
  ctx.save(); ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = c.ink2; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(xlabel, f.left, f.bottom + 25);
  const labelEnd = f.left + ctx.measureText(xlabel).width;
  ctx.restore();
  if (log) {
    ctx.save(); ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = c.ink2; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const v of yt) ctx.fillText(['10⁻⁴', '0.001', '0.01', '0.1', '1'][v + 4], f.left - 6, f.Y(v));
    ctx.restore();
  }
  // Marker handle and label, above the plot.
  ctx.save();
  ctx.fillStyle = c.ink; ctx.beginPath(); ctx.moveTo(mx - 6, f.top - 9); ctx.lineTo(mx + 6, f.top - 9); ctx.lineTo(mx, f.top); ctx.closePath(); ctx.fill();
  ctx.font = '600 11px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const tw = ctx.measureText(markerText).width;
  const tx = mx + 9 + tw < width - 2 ? mx + 9 : mx - 9 - tw;
  ctx.fillText(markerText, tx, f.top - 9);
  ctx.restore();
  legend(ctx, f, qs, pols, labelEnd);
  return f;
}

// The visible spectrum, drawn under the wavelength axis: one pixel per column, made once for
// each width and range.
let bandCache = { key: '', canvas: null };
function spectrumBand(f) {
  const w = Math.max(1, Math.round(f.w)), key = `${w}:${f.x0}:${f.x1}`;
  if (bandCache.key === key) return bandCache.canvas;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = 1;
  const g = cv.getContext('2d'), img = g.createImageData(w, 1);
  for (let px = 0; px < w; px++) {
    const nm = f.x0 + ((f.x1 - f.x0) * (px + 0.5)) / w;
    if (nm < 380 || nm > 780) continue;
    const rgb = spectralColor(nm), fade = clamp(Math.min(nm - 380, 780 - nm) / 40, 0, 1);
    for (let c = 0; c < 3; c++) img.data[4 * px + c] = Math.round(255 * rgb[c] * fade);
    img.data[4 * px + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  bandCache = { key, canvas: cv };
  return cv;
}

function legend(ctx, f, qs, pols, labelEnd) {
  ctx.save();
  ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const items = qs.map((q) => ({ text: q, color: series[q], dash: [] }));
  if (pols.length === 2) items.push({ text: 's', color: colors.ink2, dash: [] }, { text: 'p', color: colors.ink2, dash: [6, 4] });
  else items.push({ text: pols[0] === 'avg' ? 'unpolarised' : pols[0], color: colors.ink2, dash: pols[0] === 'p' ? [6, 4] : [] });
  const wItem = (it) => 18 + ctx.measureText(it.text).width + 9;
  const total = items.reduce((a, it) => a + wItem(it), 0) - 9;
  // On the x label's row if it fits there, else inside the plot at the top right.
  let x = f.right - total, y = f.bottom + 25;
  if (x < labelEnd + 12) {
    x = f.right - total - 6; y = f.top + 12;
    ctx.fillStyle = colors.panel; ctx.globalAlpha = 0.85; ctx.fillRect(x - 4, y - 8, total + 8, 16); ctx.globalAlpha = 1;
  }
  for (const it of items) {
    ctx.strokeStyle = it.color; ctx.lineWidth = 2; ctx.setLineDash(it.dash);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 14, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = colors.ink2; ctx.fillText(it.text, x + 18, y);
    x += wItem(it);
  }
  ctx.restore();
}

function criticalAngle() {
  const n0 = comp.point.st.n0, ns = comp.point.st.ns;
  return ns[1] < 1e-9 && ns[0] < n0 ? Math.asin(ns[0] / n0) / DEG : null;
}
function brewsterAngle() {
  const n0 = comp.point.st.n0, ns = comp.point.st.ns;
  return nLayers() === 0 && ns[1] < 1e-9 ? Math.atan(ns[0] / n0) / DEG : null;
}
function angleMarks(ctx, f) {
  const marks = [];
  const tc = criticalAngle(), tb = brewsterAngle();
  if (tc !== null) marks.push([tc, 'θc']);
  if (tb !== null) marks.push([tb, 'θB']);
  if (comp.rpMin) marks.push([comp.rpMin.theta, 'Rp least']);
  ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (const [th, label] of marks) {
    const x = f.X(th), w = ctx.measureText(label).width, lx = x + 4 + w < f.right ? x + 4 : x - 4 - w;
    ctx.strokeStyle = colors.ink3; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(x, f.top); ctx.lineTo(x, f.bottom); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = colors.panel; ctx.globalAlpha = 0.85; ctx.fillRect(lx - 2, f.top + 5, w + 4, 14); ctx.globalAlpha = 1;
    ctx.fillStyle = colors.ink2; ctx.fillText(label, lx, f.top + 12);
  }
}

function drawPlots() {
  const sp = comp.spec;
  comp.specWidth = $('#spec').getBoundingClientRect().width;
  comp.angWidth = $('#ang').getBoundingClientRect().width;
  frames.spec = drawCurves($('#spec'), sp, { x0: state.lrange[0], x1: state.lrange[1], xlabel: 'wavelength (nm)', marker: state.lambda, markerText: `${fmt(state.lambda, 4)} nm`, kind: 'spec' });
  if (comp.x2kind === 'thickness') {
    const d = state.layers[state.sel].d;
    frames.ang = drawCurves($('#ang'), comp.x2, { x0: 0, x1: state.dmaxPlot, xlabel: `thickness of layer ${state.sel + 1} (nm)`, marker: d, markerText: fmtLen(d), kind: 'thickness' });
  } else {
    frames.ang = drawCurves($('#ang'), comp.x2, { x0: 0, x1: 90, xlabel: 'angle of incidence (°)', marker: state.theta, markerText: `${fmt(state.theta, 3)}°`, kind: 'angle' });
  }
  $('#x2-title').textContent = comp.x2kind === 'thickness' ? 'Against thickness' : 'Against angle';
  x2Seg.value = comp.x2kind;
  $('#spec-note').textContent = state.theta ? `at ${fmt(state.theta, 3)}°` : 'at normal incidence';
}

// --- the white-light picture

function rgbCss(rgb) { return `rgb(${rgb.map((v) => Math.round(255 * v)).join(',')})`; }
function displayRGB(cm, XYZ, gain) { return toDisplay(cm.linear(XYZ).map((v) => v * gain)); }

let filmImg = null;
function drawFilm() {
  if (!state.show.film) return;
  const cv = $('#film'), { ctx, width, height } = fitCanvas(cv);
  const view = state.film.view;
  $('#film-wrap').classList.toggle('light-bg', view === 'T');
  ctx.clearRect(0, 0, width, height);
  const pad = 14, fx = pad, fy = pad, fw = width - 2 * pad - 34, fh = height - 2 * pad;
  frames.film = { fx, fy, fw, fh };
  const ink = view === 'T' ? '#333' : '#ddd';
  if (!comp.film) {
    ctx.fillStyle = ink; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center';
    wrapText(ctx, 'Select a layer to see its colours as its thickness changes', width / 2, height / 2 - 20, width - 30, 16);
    return;
  }
  const { hs, XR, XT, cm } = comp.film, rows = hs.length, X = view === 'T' ? XT : XR;
  const gain = exposure[view] * state.film.bright;
  if (!filmImg || filmImg.height !== rows) { filmImg = document.createElement('canvas'); filmImg.width = 1; filmImg.height = rows; }
  const g = filmImg.getContext('2d'), img = g.createImageData(1, rows);
  comp.filmRGB = [];
  for (let k = 0; k < rows; k++) {
    const rgb = displayRGB(cm, [X[3 * k], X[3 * k + 1], X[3 * k + 2]], gain);
    comp.filmRGB.push(rgb);
    img.data[4 * k] = 255 * rgb[0]; img.data[4 * k + 1] = 255 * rgb[1]; img.data[4 * k + 2] = 255 * rgb[2]; img.data[4 * k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // The film in a frame with rounded corners (a wire loop).
  ctx.save();
  roundRect(ctx, fx, fy, fw, fh, 10); ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(filmImg, 0, 0, 1, rows, fx, fy, fw, fh);
  ctx.restore();
  ctx.strokeStyle = view === 'T' ? '#777' : '#888'; ctx.lineWidth = 3;
  roundRect(ctx, fx, fy, fw, fh, 10); ctx.stroke();
  // A thickness scale on the right.
  ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = ink; ctx.strokeStyle = ink; ctx.lineWidth = 1;
  const top = state.film.profile === 'wedge' ? state.film.dmax : state.film.hBottom;
  let first = true;           // the unit goes on the first label
  for (const t of niceTicks(0, top, 5)) {
    const y = filmHeightOf(t);
    if (y === null || t === 0 && state.film.profile !== 'wedge') continue;
    const py = fy + y * fh;
    ctx.beginPath(); ctx.moveTo(fx + fw + 2, py); ctx.lineTo(fx + fw + 6, py); ctx.stroke();
    ctx.fillText(first ? `${t} nm` : String(t), fx + fw + 8, py);
    first = false;
  }
  if (state.film.profile === 'drain') {
    const yb = (25 / state.film.hBottom) ** 2;
    if (yb * fh > 14) { ctx.fillStyle = '#999'; ctx.textAlign = 'center'; ctx.fillText('black film', fx + fw / 2, fy + Math.min(yb * fh / 2, fh / 2)); }
  }
  // The probe: where the selected layer's present thickness is.
  const d = state.layers[filmJ()].d, y = filmHeightOf(d);
  if (y !== null) {
    const py = fy + y * fh;
    ctx.strokeStyle = view === 'T' ? '#000' : '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(fx, py); ctx.lineTo(fx + fw, py); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = view === 'T' ? '#000' : '#fff';
    ctx.beginPath(); ctx.moveTo(fx + fw, py); ctx.lineTo(fx + fw + 7, py - 5); ctx.lineTo(fx + fw + 7, py + 5); ctx.closePath(); ctx.fill();
  }
}
function wrapText(ctx, text, x, y, w, lh) {
  const words = text.split(' '); let line = '';
  for (const word of words) {
    const t = line ? line + ' ' + word : word;
    if (ctx.measureText(t).width > w && line) { ctx.fillText(line, x, y); line = word; y += lh; } else line = t;
  }
  ctx.fillText(line, x, y);
}

// The colours of the stack as it is: shown brightened (the same gain as the picture), with
// the real fraction of white light reflected and transmitted.
function swatchColors() {
  const { R, T, cm } = comp.white;
  let gR, gT;
  if (state.show.film) {
    // The same brightening as the picture, so that the swatch matches it.
    updateExposure();
    gR = exposure.R * state.film.bright; gT = exposure.T * state.film.bright;
  } else {
    // On their own (in the readouts): each brightened until its strongest channel is 0.85.
    gR = clamp(0.85 / Math.max(lumOf(cm.linear(R)), 1e-6), 1, 40); gT = clamp(0.85 / Math.max(lumOf(cm.linear(T)), 1e-6), 1, 40);
  }
  return { R: displayRGB(cm, R, gR), T: displayRGB(cm, T, gT), YR: R[1], YT: T[1], gR, gT };
}
const swatchEls = ['reflected', 'transmitted'].map((label) => {
  const chip = el('div', { class: 'chip' }), value = el('span', { class: 'mono' });
  $('#swatches').append(el('div', { class: 'swatch' }, chip, el('span', {}, label), value));
  return { chip, value };
});
function drawSwatches() {
  const s = comp.swatch;
  [[s.R, s.YR, s.gR], [s.T, s.YT, s.gT]].forEach(([rgb, Y, gain], i) => {
    const { chip, value } = swatchEls[i], bg = rgbCss(rgb), text = pct(Y), title = gain > 1.05 ? `brightened ${fmt(gain, 2)} times` : '';
    if (chip.style.background !== bg) chip.style.background = bg;
    if (chip.title !== title) chip.title = title;
    if (value.textContent !== text) value.textContent = text;
  });
}

// --- readouts

let lastReadouts = '';
function readouts() {
  const v = comp.point, s = v.s, p = v.p, out = [];
  const pair = (q, a, b) => `<span>${q} <b>${pct(a)}</b>${Math.abs(a - b) > 5e-5 ? ` s, <b>${pct(b)}</b> p` : ''}</span>`;
  out.push(pair('R', s.R, p.R));
  out.push(pair('T', s.T, p.T));
  if (s.A > 1e-5 || p.A > 1e-5) out.push(pair('A', s.A, p.A));
  const tc = criticalAngle(), tb = brewsterAngle();
  if (tc !== null) out.push(`<span>θ<sub>c</sub> = ${tc.toFixed(1)}°</span>`);
  if (tb !== null) out.push(`<span>θ<sub>B</sub> = ${tb.toFixed(2)}°</span>`);
  // The evanescent wave in the substrate.
  const { st, beta } = v;
  if (st.ns[1] < 1e-9 && beta > st.ns[0]) {
    const decay = state.lambda / (2 * Math.PI * Math.sqrt(beta * beta - st.ns[0] ** 2));
    out.push(`<span>evanescent: |E| falls by 1/e in <b>${decay.toFixed(0)} nm</b></span>`);
    if (nLayers() === 0) out.push(`<span>phase s − p <b>${phaseDifference(s, p).toFixed(1)}°</b></span>`);
  }
  if (comp.rpMin && tb === null && comp.x2kind === 'angle') out.push(`<span>R<sub>p</sub> least at <b>${comp.rpMin.theta.toFixed(2)}°</b> (${pct(comp.rpMin.R)})</span>`);
  if (comp.finesse) {
    const F = comp.finesse, w = F.fwhm < 0.1 ? F.fwhm.toFixed(3) : F.fwhm.toFixed(2);
    out.push(`<span>T peak at ${F.peak.toFixed(1)} nm (${pct(F.Tmax)}), <b>${w} nm</b> wide${F.F ? `; peaks every ${F.spacing.toFixed(1)} nm: finesse <b>${F.F.toFixed(0)}</b>` : ''}</span>`);
  }
  if (!state.show.film) {
    const sw = comp.swatch;
    out.push(`<span>white light: <span class="sw" style="background:${rgbCss(sw.R)}"></span>${pct(sw.YR)} reflected, <span class="sw" style="background:${rgbCss(sw.T)}"></span>${pct(sw.YT)} through</span>`);
  }
  const html = out.join('');
  if (html !== lastReadouts) { $('#readouts').innerHTML = html; lastReadouts = html; }
}

// ---------------------------------------------------------------------------- the loop

let raf = 0, lastT = 0, needCompute = true, blackSince = 0;
function kick(recompute = true) { if (recompute) needCompute = true; if (!raf) raf = requestAnimationFrame(frame); }
function draining() { return state.show.film && state.film.profile === 'drain' && state.film.running && filmJ() >= 0; }
function animating() { return state.fieldMode === 'wave' || draining(); }

function frame(now) {
  raf = 0;
  const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0;
  lastT = now;
  if (draining()) {
    // The film thins (steadily in log thickness), turns black, and a new film is drawn.
    if (state.film.hBottom > 25) { state.film.hBottom *= Math.exp(-dt / 9); blackSince = 0; }
    else if ((blackSince += dt) > 2) state.film.hBottom = H_START;
    hbSlider.value = state.film.hBottom;
    state.layers[filmJ()].d = drainingThickness(state.film.probe, state.film.hBottom);
    syncThickness();
    needCompute = true;
  }
  const t = {}, time = (k, f) => { const t0 = performance.now(); f(); t[k] = performance.now() - t0; };
  if (needCompute) {
    time('compute', compute); needCompute = false;
    time('plots', drawPlots); time('film', drawFilm); time('swatches', () => { if (state.show.film) drawSwatches(); });
    time('readouts', readouts); scheduleHash();
  }
  time('stack', () => drawStack(now));
  comp.drawMs = t;             // milliseconds per drawing step, likewise
  if (animating()) raf = requestAnimationFrame(frame); else lastT = 0;
}

// ------------------------------------------------------------------------- controls

const lambdaSlider = slider({ label: 'λ (nm)', min: 250, max: 1500, value: state.lambda, title: 'The vacuum wavelength', onInput: (v) => { state.lambda = v; kick(); } });
const thetaSlider = slider({ label: 'θ (°)', min: 0, max: 89.9, value: state.theta, title: 'The angle of incidence, in the incident medium', onInput: (v) => { state.theta = clamp(v, 0, 89.99); kick(); } });
$('#light-box').append(lambdaSlider, thetaSlider);
const polSeg = segmented([
  { value: 'sp', label: 's and p', title: 's: E parallel to the surface (solid lines); p: E in the plane of incidence (dashed)' },
  { value: 's', label: 's' }, { value: 'p', label: 'p' }, { value: 'avg', label: 'unpolarised', title: 'The average of s and p' },
], state.pol, (v) => { state.pol = v; kick(); }, { label: 'Polarisation in the plots' });
$('#pol-box').append(polSeg);

// Field display.
const fieldModeSeg = segmented([{ value: 'E2', label: '|E|²', title: 'The time-averaged |E|² (energy density), in units of the incoming wave' }, { value: 'wave', label: 'wave', title: 'The tangential field oscillating in time, inside its envelope' }],
  state.fieldMode, (v) => { state.fieldMode = v; kick(); }, { label: 'Field display' });
const fieldPolSeg = segmented([{ value: 's', label: 's' }, { value: 'p', label: 'p' }], state.fieldPol, (v) => { state.fieldPol = v; kick(); }, { label: 'Polarisation of the field shown' });
$('#field-mode').append(fieldModeSeg); $('#field-pol').append(fieldPolSeg);
const x2Seg = segmented([{ value: 'angle', label: 'angle' }, { value: 'thickness', label: 'thickness', title: "The selected layer's thickness" }], state.x2, (v) => {
  state.x2 = v;
  if (v === 'thickness' && !isLayer(state.sel) && nLayers()) selectMedium(0);
  if (v === 'thickness') fitThicknessRange();
  kick();
}, { label: 'Second plot against' });
$('#x2-seg').append(x2Seg);
function fitThicknessRange() {
  if (!isLayer(state.sel)) return;
  const d = state.layers[state.sel].d;
  state.dmaxPlot = Math.max(100, niceUp(Math.max(2.5 * d, state.lambda / 2)));
}
function niceUp(v) { const p = 10 ** Math.floor(Math.log10(v)), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }

// Presets (the experiments' stacks).
const PRESETS = [
  ['Soap film', 'soap'], ['Glass', 'fresnel'], ['Inside glass', 'tir'], ['Air gap', 'ftir'], ['Oil on water', 'oil'], ['Coated lens', 'ar'],
  ['Bragg mirror', 'bragg'], ['Filter', 'filter'], ['Etalon', 'etalon'], ['Silver', 'silver'], ['Gold', 'gold'], ['Plasmon', 'spr'],
];

// The editor of the selected medium.
const matSelect = $('#material');
for (const id of [...MATERIAL_ORDER, 'typed']) matSelect.append(el('option', { value: id }, id === 'typed' ? 'Typed: n(λ)' : MATERIALS[id].name));
matSelect.addEventListener('change', () => {
  const m = medium(state.sel), id = matSelect.value;
  m.mat = id;
  if (id === 'typed' && !m.src) { const [n, k] = index1({ mat: state.layers[state.sel]?.mat || 'silica' }, state.lambda); m.src = k > 1e-6 ? 'n + i kappa' : 'n'; m.params = { n: +n.toFixed(3), kappa: +k.toFixed(3) }; }
  designLive = false;
  refreshEditor(); fitThicknessRange(); kick();
});
const typedField = exprField({
  label: '<math><mi>n</mi><mo>(</mo><mi>λ</mi><mo>)</mo><mo>=</mo></math>', value: 'n', variables: ['lambda'], hints: DEFAULT_HINTS,
  onChange: (expr, params) => {
    const m = medium(state.sel);
    if (m.mat !== 'typed') return;
    if (expr.source !== m.src) m.label = '';
    m.src = expr.source; m.params = { ...m.params, ...params };
    refreshIndexNote(); kick();
  },
});
const typedPresets = el('div', { class: 'row' }, TYPED_PRESETS.map((t) => el('button', { type: 'button', title: t.title, onclick: () => {
  const m = medium(state.sel); m.mat = 'typed'; m.src = t.src; m.params = { ...t.params }; m.hints = null; refreshEditor(); kick();
} }, t.label)));
$('#typed-box').append(typedField, typedPresets, el('div', { class: 'note' }, 'λ in µm; i is √−1, and κ > 0 absorbs.'));

const thickSlider = slider({ label: 'd (nm)', min: 0, max: 2000, value: 400, title: "The selected layer's thickness", onInput: (v) => setThickness(state.sel, Math.max(0, v)) });
$('#thick-box').append(thickSlider);
function setThickness(j, d, { fromFilm = false } = {}) {
  if (!isLayer(j)) return;
  state.layers[j].d = d;
  if (!fromFilm && j === filmJ()) pauseDrain();
  designLive = false;
  syncThickness();
  kick();
}
function syncThickness() {
  if (!isLayer(state.sel)) return;
  const d = state.layers[state.sel].d;
  thickSlider.value = +d.toPrecision(5);
}
function pauseDrain() {
  if (state.film.running && state.film.profile === 'drain') { state.film.running = false; drainToggle.on = false; drainToggle.textContent = 'Drain'; }
}

const quarter = (frac) => {
  const j = state.sel;
  if (!isLayer(j)) return;
  const n = index1(state.layers[j], state.lambda)[0];
  setThickness(j, +((state.lambda * frac) / Math.max(n, 0.05)).toFixed(2));
};
const insertBtn = el('button', { type: 'button', title: 'Insert a layer after this one', onclick: () => insertLayer() }, '+ layer');
const deleteBtn = el('button', { type: 'button', title: 'Remove this layer', onclick: () => deleteLayer() }, '− layer');
const qBtn = el('button', { type: 'button', title: 'A quarter wave at the present wavelength: d = λ/4n', onclick: () => quarter(0.25) }, '¼ wave');
const hBtn = el('button', { type: 'button', title: 'A half wave at the present wavelength: d = λ/2n', onclick: () => quarter(0.5) }, '½ wave');
$('#layer-buttons').append(qBtn, hBtn, insertBtn, deleteBtn);

function insertLayer() {
  const at = state.sel < 0 ? 0 : Math.min(state.sel + 1, nLayers());
  const like = isLayer(state.sel) ? state.layers[state.sel] : { mat: 'silica' };
  const mat = like.mat === 'air' ? 'silica' : like.mat;
  // A quarter wave of a dielectric; 30 nm of a metal (a quarter wave would be opaque).
  const n = index1({ ...like, mat }, state.lambda)[0], metal = MATERIALS[mat]?.kind === 'metal';
  state.layers.splice(at, 0, { ...JSON.parse(JSON.stringify(like)), mat, d: metal ? 30 : +(state.lambda / (4 * Math.max(n, 1))).toFixed(1) });
  designLive = false;
  selectMedium(at); kick();
}
function deleteLayer() {
  if (!isLayer(state.sel)) return;
  state.layers.splice(state.sel, 1);
  designLive = false;
  // The layer that took its place, or the one before it, or the substrate if none are left.
  selectMedium(nLayers() ? Math.min(state.sel, nLayers() - 1) : 0); kick();
}

function selectMedium(i) {
  state.sel = clamp(i, -1, nLayers());
  if (isLayer(state.sel)) lastLayer = state.sel;
  refreshEditor();
  if (state.x2 === 'thickness') fitThicknessRange();
  kick();
}
$('#sel-prev').addEventListener('click', () => selectMedium(state.sel - 1));
$('#sel-next').addEventListener('click', () => selectMedium(state.sel + 1));

function refreshEditor() {
  const i = state.sel, m = medium(i), L = nLayers();
  $('#sel-what').textContent = i < 0 ? 'Incident medium' : i >= L ? 'Substrate' : `Layer ${i + 1} of ${L}`;
  $('#sel-prev').disabled = i <= -1; $('#sel-next').disabled = i >= L;
  // The incident medium must be transparent: no metals there.
  for (const o of matSelect.options) o.disabled = i < 0 && MATERIALS[o.value]?.kind === 'metal';
  matSelect.value = m.mat;
  $('#typed-box').hidden = m.mat !== 'typed';
  if (m.mat === 'typed') {
    typedField.setHints({ ...DEFAULT_HINTS, ...(m.hints || {}) });
    typedField.set(m.src, m.params || {}, false);
  }
  $('#thick-box').hidden = !isLayer(i); qBtn.hidden = hBtn.hidden = !isLayer(i);
  deleteBtn.disabled = !isLayer(i);
  if (isLayer(i)) {
    const metal = MATERIALS[m.mat]?.kind === 'metal';
    thickSlider.setRange(0, Math.max(metal ? 200 : 2000, m.d));
    syncThickness();
  }
  refreshIndexNote();
}
function refreshIndexNote() {
  const i = state.sel, m = medium(i), [n, k] = index1(m, state.lambda), mat = matOf(m);
  let text = `At ${fmt(state.lambda, 4)} nm: n = ${n.toFixed(4)}${Math.abs(k) > 1e-6 ? ` ${k < 0 ? '−' : '+'} ${Math.abs(k).toFixed(3)}i` : ''}.`;
  if (i < 0 && Math.abs(k) > 1e-6) text += ' (κ is ignored here: the light must arrive through a transparent medium.)';
  if (mat.ref && mat.ref !== 'typed') text += ` ${mat.ref}.`;
  if (mat.range && (state.lambda < mat.range[0] || state.lambda > mat.range[1])) text += ' Outside the range of the fit.';
  $('#index-note').textContent = text;
}

// The design panel.
let designLive = false;
const designSelects = { H: $('#design-H'), L: $('#design-L'), M: $('#design-M') };
for (const s of Object.values(designSelects)) for (const id of MATERIAL_ORDER) s.append(el('option', { value: id }, MATERIALS[id].name));
designSelects.H.value = 'tio2'; designSelects.L.value = 'silica'; designSelects.M.value = 'mgf2';
const design = { lambda0: 550, params: { N: 5 } };
const lambda0Slider = slider({ label: 'λ₀ (nm)', min: 350, max: 1200, value: 550, title: 'The design wavelength', onInput: (v) => { design.lambda0 = v; if (designLive) buildDesign(); } });
$('#design-sliders').append(lambda0Slider);
const designParamSliders = new Map();
function syncDesignSliders() {
  const r = tryDesign();
  $('#design-err').textContent = r.error || '';
  $('#design-text').classList.toggle('bad', !!r.error);
  if (r.error) return null;
  for (const [name, s] of designParamSliders) if (!r.names.includes(name)) { s.remove(); designParamSliders.delete(name); }
  for (const name of r.names) {
    if (designParamSliders.has(name)) continue;
    if (design.params[name] === undefined) design.params[name] = 4;
    const s = slider({ label: name, min: 0, max: 20, step: 1, value: design.params[name], title: 'Repeats', onInput: (v) => { design.params[name] = Math.round(v); if (designLive) buildDesign(); } });
    designParamSliders.set(name, s);
    $('#design-sliders').append(s);
  }
  return r;
}
function tryDesign() {
  try { const d = parseDesign($('#design-text').value); return d; } catch (e) { return { error: e.message + (e.pos !== undefined ? ` (at character ${e.pos + 1})` : '') }; }
}
function buildDesign() {
  const r = syncDesignSliders();
  if (!r) return;
  let list;
  try { list = expandDesign(r.items, design.params, 300); } catch (e) { $('#design-err').textContent = e.message; return; }
  state.layers = list.map(({ m, q }) => {
    const mat = designSelects[m].value, n = index1({ mat }, design.lambda0)[0];
    return { mat, d: +((q * design.lambda0) / (4 * n)).toFixed(2) };
  });
  designLive = true;
  pauseDrain();
  if (!isLayer(state.sel)) state.sel = Math.min(Math.max(state.sel, 0), nLayers());
  refreshEditor();
  kick();
}
$('#design-text').addEventListener('input', () => { if (syncDesignSliders() && designLive) buildDesign(); });
for (const s of Object.values(designSelects)) s.addEventListener('change', () => { if (designLive) buildDesign(); });
$('#design-build').addEventListener('click', buildDesign);
syncDesignSliders();

// Show.
const showToggles = {
  R: toggle('R', state.show.R, (on) => { state.show.R = on; kick(); }, 'Reflectance'),
  T: toggle('T', state.show.T, (on) => { state.show.T = on; kick(); }, 'Transmittance (into the substrate)'),
  A: toggle('A', state.show.A, (on) => { state.show.A = on; kick(); }, 'Absorptance (shown when something absorbs)'),
  log: toggle('log scale', state.show.log, (on) => { state.show.log = on; kick(); }, 'Plot R, T and A on a logarithmic scale, from 0.0001 to 1'),
  film: toggle('white light', state.show.film, (on) => { setFilmShown(on); }, 'The colours of the stack in white light'),
};
$('#show-box').append(...Object.values(showToggles));
function setFilmShown(on) {
  state.show.film = on; showToggles.film.on = on;
  $('#film-col').hidden = !on; $('#top').classList.toggle('nofilm', !on);
  kick();
}

// The white-light picture's own controls.
const filmViewSeg = segmented([{ value: 'R', label: 'reflected' }, { value: 'T', label: 'transmitted' }], state.film.view, (v) => { state.film.view = v; kick(); }, { label: 'Light seen' });
$('#film-view').append(filmViewSeg);
const profileSeg = segmented([
  { value: 'drain', label: 'draining film', title: 'Thickness grows as the square root of the depth, as in a vertical soap film draining under gravity' },
  { value: 'wedge', label: 'wedge', title: 'Thickness grows evenly from 0 at the top' },
], state.film.profile, (v) => { state.film.profile = v; if (v === 'wedge') pauseDrain(); syncFilmControls(); kick(); }, { label: 'Thickness profile' });
const drainToggle = toggle('Pause', state.film.running, (on) => {
  state.film.running = on; drainToggle.textContent = on ? 'Pause' : 'Drain';
  if (on) { state.film.profile = 'drain'; profileSeg.value = 'drain'; if (state.film.hBottom <= 25) state.film.hBottom = H_START; syncProbe(); syncFilmControls(); }
  kick();
}, 'Let the film drain and thin, or stop it');
const hbSlider = slider({ label: 'bottom (nm)', min: 20, max: 3000, log: true, value: state.film.hBottom, title: 'The thickness at the bottom of the draining film', onInput: (v) => { state.film.hBottom = v; pauseDrain(); kick(); } });
const dmaxSlider = slider({ label: 'up to (nm)', min: 20, max: 3000, log: true, value: state.film.dmax, title: "The wedge's thickness at the bottom", onInput: (v) => { state.film.dmax = v; kick(); } });
const brightSlider = slider({ label: 'brightness', min: 0.25, max: 4, log: true, value: 1, title: 'Brighten or dim the picture (1: the brightest colour fills the screen)', onInput: (v) => { state.film.bright = v; kick(); } });
const illumSeg = segmented([{ value: 'd65', label: 'daylight (D65)' }, { value: 'e', label: 'equal energy' }], state.illum, (v) => { state.illum = v; exposureKey = ''; kick(); }, { label: 'Illuminant' });
$('#film-box').append(el('div', { class: 'row' }, profileSeg, drainToggle), hbSlider, dmaxSlider, brightSlider, el('div', { class: 'row' }, el('span', { class: 'small muted' }, 'Light:'), illumSeg),
  el('div', { class: 'note' }, 'The picture shows the selected layer (or the last one selected) getting thicker from top to bottom.  Click it to choose a thickness.'));
function syncFilmControls() {
  const drain = state.film.profile === 'drain';
  hbSlider.hidden = !drain; dmaxSlider.hidden = drain; drainToggle.hidden = !drain;
  drainToggle.on = state.film.running && drain; drainToggle.textContent = drainToggle.on ? 'Pause' : 'Drain';
  hbSlider.value = state.film.hBottom; dmaxSlider.value = state.film.dmax; brightSlider.value = state.film.bright;
  profileSeg.value = state.film.profile; filmViewSeg.value = state.film.view; illumSeg.value = state.illum;
}
// Where the probe sits for the selected layer's present thickness.
function syncProbe() {
  if (filmJ() < 0) return;
  const y = filmHeightOf(state.layers[filmJ()].d);
  if (y !== null) state.film.probe = y;
}

// Range.
const lminSlider = slider({ label: 'from (nm)', min: 200, max: 1400, value: state.lrange[0], onInput: (v) => { state.lrange[0] = Math.min(v, state.lrange[1] - 10); kick(); } });
const lmaxSlider = slider({ label: 'to (nm)', min: 300, max: 2000, value: state.lrange[1], onInput: (v) => { state.lrange[1] = Math.max(v, state.lrange[0] + 10); kick(); } });
$('#range-box').append(lminSlider, lmaxSlider, el('div', { class: 'row' },
  el('button', { type: 'button', onclick: () => setRange(380, 780) }, 'visible'), el('button', { type: 'button', onclick: () => setRange(300, 1200) }, 'wide')));
function setRange(a, b) { state.lrange = [a, b]; lminSlider.value = a; lmaxSlider.value = b; kick(); }

// ----------------------------------------------------------------------- pointer input

let dragging = -1, hoverHandle = -1, plotDrag = null, filmDrag = false;
const stackCanvas = $('#stack');
function handleAt(px) {
  const f = frames.stack;
  if (!f) return -1;
  let best = -1, bd = 9, z = 0;
  state.layers.forEach((m, j) => { z += m.d; const dx = Math.abs(f.X(z) - px); if (dx <= bd) { bd = dx; best = j; } });
  return best;
}
function regionAt(px) {
  const f = frames.stack, z = f.invX(px);
  if (z < 0) return -1;
  let s = 0;
  for (let j = 0; j < nLayers(); j++) { s += state.layers[j].d; if (z <= s) return j; }
  return nLayers();
}
stackCanvas.addEventListener('pointerdown', (e) => {
  const r = stackCanvas.getBoundingClientRect(), px = e.clientX - r.left;
  const h = handleAt(px);
  if (h >= 0) {
    dragging = h; zFrozen = zRange();
    stackCanvas.setPointerCapture(e.pointerId);
    if (state.sel !== h) selectMedium(h);
    return;
  }
  if (frames.stack && px > frames.stack.left && px < frames.stack.right) selectMedium(regionAt(px));
});
stackCanvas.addEventListener('pointermove', (e) => {
  const r = stackCanvas.getBoundingClientRect(), px = e.clientX - r.left;
  if (dragging >= 0) {
    const f = frames.stack;
    let start = 0;
    for (let j = 0; j < dragging; j++) start += state.layers[j].d;
    let d = Math.max(0, f.invX(px) - start);
    d = d < 20 ? Math.round(d * 10) / 10 : Math.round(d);
    setThickness(dragging, d);
    return;
  }
  const h = handleAt(px);
  if (h !== hoverHandle) { hoverHandle = h; kick(false); }
  stackCanvas.style.cursor = h >= 0 ? 'ew-resize' : 'pointer';
});
const endStackDrag = () => { if (dragging >= 0) { dragging = -1; zFrozen = null; kick(false); } };
stackCanvas.addEventListener('pointerup', endStackDrag);
stackCanvas.addEventListener('pointercancel', endStackDrag);
stackCanvas.addEventListener('pointerleave', () => { if (hoverHandle >= 0 && dragging < 0) { hoverHandle = -1; kick(false); } });
// Keys on the drawing: left and right change the selected layer's thickness (1 nm, 10 with
// shift), up and down select the previous and next layer.
stackCanvas.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 10 : 1;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (!isLayer(state.sel)) return;
    e.preventDefault();
    setThickness(state.sel, Math.max(0, Math.round(state.layers[state.sel].d) + (e.key === 'ArrowRight' ? step : -step)));
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    selectMedium(state.sel + (e.key === 'ArrowDown' ? 1 : -1));
  }
});

function plotPointer(cv, key) {
  const set = (e) => {
    const f = frames[key];
    if (!f) return;
    const x = f.invX(e.clientX - cv.getBoundingClientRect().left);
    if (key === 'spec') { state.lambda = +clamp(x, state.lrange[0], state.lrange[1]).toFixed(1); lambdaSlider.value = state.lambda; refreshIndexNote(); kick(); }
    else if (comp.x2kind === 'thickness') setThickness(state.sel, Math.max(0, +x.toFixed(1)));
    else { state.theta = +clamp(x, 0, 89.9).toFixed(2); thetaSlider.value = state.theta; kick(); }
  };
  cv.addEventListener('pointerdown', (e) => { plotDrag = key; cv.setPointerCapture(e.pointerId); set(e); });
  cv.addEventListener('pointermove', (e) => { if (plotDrag === key) set(e); });
  const end = () => { if (plotDrag === key) plotDrag = null; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
}
plotPointer($('#spec'), 'spec');
plotPointer($('#ang'), 'ang');

const filmCanvas = $('#film');
function filmPointer(e) {
  const g = frames.film;
  if (!g || filmJ() < 0) return;
  const r = filmCanvas.getBoundingClientRect(), y = clamp((e.clientY - r.top - g.fy) / g.fh, 0, 1);
  state.film.probe = y;
  setThickness(filmJ(), +filmThickness(y).toFixed(1), { fromFilm: true });
}
filmCanvas.addEventListener('pointerdown', (e) => { filmDrag = true; filmCanvas.setPointerCapture(e.pointerId); filmPointer(e); });
filmCanvas.addEventListener('pointermove', (e) => { if (filmDrag) filmPointer(e); });
filmCanvas.addEventListener('pointerup', () => { filmDrag = false; });
filmCanvas.addEventListener('pointercancel', () => { filmDrag = false; });

window.addEventListener('resize', () => kick());

// ------------------------------------------------------------------------ experiments

const A = (mat, d) => ({ mat, d });
const nAt = (mat, nm) => MATERIALS[mat].index(nm)[0];
function apply(o) {
  state.inc = o.inc || { mat: 'air' };
  state.layers = (o.layers || []).map((m) => ({ ...m }));
  state.sub = o.sub || { mat: 'air' };
  state.lambda = o.lambda ?? 550; state.theta = o.theta ?? 0;
  state.pol = o.pol || 'sp';
  state.x2 = o.x2 || 'angle';
  state.show.log = !!o.log;
  for (const q of ['R', 'T', 'A']) state.show[q] = o.show?.[q] ?? true;
  state.fieldMode = o.fieldMode || 'E2'; state.fieldPol = o.fieldPol || 's';
  state.lrange = o.lrange ? [...o.lrange] : [380, 780];
  state.film = { profile: 'wedge', hBottom: H_START, running: false, probe: 0.3, dmax: 1000, view: 'R', bright: 1, ...(o.film || {}) };
  state.illum = 'd65';
  state.sel = o.sel ?? (nLayers() ? 0 : nLayers());
  lastLayer = o.filmLayer ?? (isLayer(state.sel) ? state.sel : 0);
  designLive = false;
  $('#design-panel').open = !!o.design;
  if (o.design) {
    $('#design-text').value = o.design.text;
    designSelects.H.value = o.design.H; designSelects.L.value = o.design.L;
    design.lambda0 = o.design.lambda0; lambda0Slider.value = o.design.lambda0;
    Object.assign(design.params, o.design.params);
    for (const [k, s] of designParamSliders) s.value = design.params[k];
    buildDesign();
    state.sel = o.sel ?? 0;
    $('#design-panel').open = true;
  }
  if (o.dmaxPlot) state.dmaxPlot = o.dmaxPlot; else fitThicknessRange();
  syncAll();
  setFilmShown(o.filmShown ?? false);
  if (state.film.running && filmJ() >= 0) state.layers[filmJ()].d = drainingThickness(state.film.probe, state.film.hBottom);
  refreshEditor();
  exposureKey = '';
  kick();
}
function syncAll() {
  lambdaSlider.value = state.lambda; thetaSlider.value = state.theta;
  polSeg.value = state.pol; x2Seg.value = state.x2; fieldModeSeg.value = state.fieldMode; fieldPolSeg.value = state.fieldPol;
  for (const q of ['R', 'T', 'A', 'log']) showToggles[q].on = state.show[q];
  lminSlider.value = state.lrange[0]; lmaxSlider.value = state.lrange[1];
  syncFilmControls();
}

const setups = {
  soap: () => apply({ layers: [A('water', 500)], filmShown: true, film: { profile: 'drain', running: true, hBottom: 900, probe: 0.3 }, show: { T: false } }),
  fresnel: () => apply({ sub: { mat: 'bk7' } }),
  brewster: () => apply({ sub: { mat: 'bk7' }, theta: +(Math.atan(nAt('bk7', 550)) / DEG).toFixed(2), fieldPol: 'p' }),
  tir: () => apply({ inc: { mat: 'bk7' }, sub: { mat: 'air' }, theta: 50 }),
  ftir: () => apply({ inc: { mat: 'bk7' }, layers: [A('air', 200)], sub: { mat: 'bk7' }, theta: 45, x2: 'thickness', log: true, dmaxPlot: 1000 }),
  oil: () => apply({ layers: [A('oil', 400)], sub: { mat: 'water' }, filmShown: true, film: { profile: 'wedge', dmax: 1200 }, show: { T: false } }),
  ar: () => apply({ layers: [A('mgf2', +(550 / 4 / nAt('mgf2', 550)).toFixed(1))], sub: { mat: 'bk7' }, log: true, filmShown: true, film: { profile: 'wedge', dmax: 400 } }),
  bragg: () => apply({ sub: { mat: 'bk7' }, design: { text: '(HL)^N H', H: 'tio2', L: 'silica', lambda0: 550, params: { N: 5 } } }),
  filter: () => apply({ sub: { mat: 'bk7' }, design: { text: '(HL)^N 2H (LH)^N', H: 'tio2', L: 'silica', lambda0: 550, params: { N: 4 } }, lrange: [450, 680] }),
  etalon: () => apply({ inc: { mat: 'bk7' }, layers: [A('silver', 40), A('air', 2000), A('silver', 40)], sub: { mat: 'bk7' }, sel: 1, x2: 'thickness', dmaxPlot: 2500 }),
  silver: () => apply({ sub: { mat: 'silver' }, lrange: [280, 900] }),
  gold: () => apply({ layers: [A('gold', 40)], sub: { mat: 'bk7' }, filmShown: true, film: { profile: 'wedge', dmax: 120 } }),
  spr: () => apply({ inc: { mat: 'bk7' }, layers: [A('gold', 50)], sub: { mat: 'typed', label: 'water', src: 'n', params: { n: 1.333 }, hints: { n: { min: 1.3, max: 1.4, value: 1.333 } } },
    lambda: 633, theta: 74.8, fieldPol: 'p', sel: 1, lrange: [450, 900] }),
};
const presetButtons = PRESETS.map(([label, name]) => el('button', { type: 'button', onclick: () => setups[name]() }, label));
$('#presets').append(...presetButtons);
drawer($('#help'), $('#help-button'), setups);

// ------------------------------------------------------------------------------ hash

const r5 = (v) => +(+v).toPrecision(5);
function encodeMedium(m) {
  const a = [m.mat];
  if (m.d !== undefined) a.push(r5(m.d));
  if (m.mat === 'typed') { if (m.d === undefined) a.push(null); a.push(m.src, Object.fromEntries(Object.entries(m.params || {}).map(([k, v]) => [k, r5(v)])), m.label || ''); }
  return a;
}
function decodeMedium(a, layer) {
  if (!Array.isArray(a) || typeof a[0] !== 'string' || !(a[0] === 'typed' || MATERIALS[a[0]])) throw new Error('bad medium');
  const m = { mat: a[0] };
  if (layer) m.d = Math.max(0, +a[1] || 0);
  if (a[0] === 'typed') {
    m.src = String(a[2] ?? 'n'); m.params = {};
    if (a[3] && typeof a[3] === 'object') for (const [k, v] of Object.entries(a[3])) if (Number.isFinite(+v)) m.params[k] = +v;
    if (a[4]) m.label = String(a[4]).slice(0, 20);
  }
  return m;
}
let hashTimer = 0;
function scheduleHash() { clearTimeout(hashTimer); hashTimer = setTimeout(updateHash, 400); }
function updateHash() {
  if (draining()) return;   // not while the film drains: the address keeps the set-up
  writeHash({
    st: JSON.stringify([encodeMedium(state.inc), state.layers.map(encodeMedium), encodeMedium(state.sub)]),
    lam: r5(state.lambda), th: r5(state.theta), sel: state.sel, pol: state.pol === 'sp' ? undefined : state.pol,
    x2: state.x2 === 'angle' ? undefined : state.x2, log: state.show.log ? 1 : undefined,
    rta: state.show.R && state.show.T && state.show.A ? undefined : ['R', 'T', 'A'].filter((q) => state.show[q]).join('') || '-',
    fm: state.fieldMode === 'E2' ? undefined : state.fieldMode, fp: state.fieldPol === 's' ? undefined : state.fieldPol,
    film: state.show.film ? `${state.film.profile},${r5(state.film.profile === 'wedge' ? state.film.dmax : state.film.hBottom)},${state.film.view}` : undefined,
    lr: state.lrange[0] === 380 && state.lrange[1] === 780 ? undefined : state.lrange.join(','),
    ill: state.illum === 'd65' ? undefined : state.illum,
    dmax: state.x2 === 'thickness' ? state.dmaxPlot : undefined,
  });
}
function fromHash(h) {
  if (!h.st) return false;
  try {
    const [inc, layers, sub] = JSON.parse(h.st);
    const o = { inc: decodeMedium(inc, false), layers: layers.map((m) => decodeMedium(m, true)), sub: decodeMedium(sub, false) };
    if (Number.isFinite(+h.lam) && +h.lam > 0) o.lambda = +h.lam;
    if (Number.isFinite(+h.th)) o.theta = clamp(+h.th, 0, 89.9);
    if (['s', 'p', 'avg'].includes(h.pol)) o.pol = h.pol;
    if (h.x2 === 'thickness') o.x2 = 'thickness';
    if (+h.dmax > 0) o.dmaxPlot = +h.dmax;
    o.log = h.log === '1';
    if (h.rta) o.show = { R: h.rta.includes('R'), T: h.rta.includes('T'), A: h.rta.includes('A') };
    if (h.fm === 'wave') o.fieldMode = 'wave';
    if (h.fp === 'p') o.fieldPol = 'p';
    if (h.lr) { const [a, b] = h.lr.split(',').map(Number); if (b > a && a > 0) o.lrange = [a, b]; }
    if (h.film) {
      const [prof, v, view] = h.film.split(',');
      o.filmShown = true;
      o.film = prof === 'wedge' ? { profile: 'wedge', dmax: +v || 1000 } : { profile: 'drain', hBottom: +v || H_START, running: false };
      if (view === 'T') o.film.view = 'T';
    }
    const sel = +h.sel;
    o.sel = Number.isInteger(sel) ? clamp(sel, -1, o.layers.length) : 0;
    apply(o);
    if (h.ill === 'e') { state.illum = 'e'; illumSeg.value = 'e'; }
    if (o.film?.profile === 'drain') syncProbe();
    return true;
  } catch { return false; }
}

// ------------------------------------------------------------------------------ start

const hash = readHash();
if (setups[hash.setup]) setups[hash.setup]();
else if (!fromHash(hash)) setups.soap();

window.__app = {
  state, setups, ready: true, kick, selectMedium, setThickness, zRange,
  get comp() { return comp; }, get exposure() { return exposure; },
  point: () => pointValues(),
  compute: () => { compute(); return comp; },
};
