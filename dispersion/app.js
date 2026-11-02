// Dispersion and Kramers–Kronig: a medium made of resonances.  Three views: the medium (its index
// and absorption against frequency, with one charge and one wave at the light's frequency), the
// Kramers–Kronig relations drawn by hand (one sliver of absorption at a time), and pulses sent
// through it (in space, and at a detector).  The physics is in medium.js and pulse.js; the two
// small pictures are drawn by pictures.js; this file is the page.

import {
  oscillatorResponse, gridResponse, functionResponse, optics, groupIndex, chiTimeOscillators,
  FreqGrid, kkImToRe, kkReToIm, impulseResponse, sampleOnGrid, sumRuleOscillators, sumRuleGrid, strength,
  drivenCharge, sliverRe, sliverTime,
} from './medium.js';
import { incident, planGrid, Propagator, peakTime, moments, maxBefore, causalEnvelope } from './pulse.js';
import { drawCharge, drawWave } from './pictures.js';
import { el, $, slider, segmented, toggle, exprField, drawer, readHash, writeHash, fmt, setSlots } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors, fillSlots } from '../lib/plot.js';
import { texToMathML } from '../lib/mathml.js';

// ------------------------------------------------------------------ units and media

// The simulation has c = 1 and works in one frequency unit; each medium says what that unit is.
// Frequencies are shown as they are; times are multiplied by tS and distances by zS.
const UNITS = {
  au: { w: 'ω', t: 't', tu: '', tS: 1, z: 'z', zu: '', zS: 1, note: 'c = 1; t in units of 1/ω, z of c/ω' },
  eV: { w: 'ħω (eV)', t: 't (fs)', tu: 'fs', tS: 0.658212, z: 'z (mm)', zu: 'mm', zS: 1.97327e-4, note: 'frequencies are ħω in eV' },
  MHz: { w: 'f (MHz)', t: 't (μs)', tu: 'μs', tS: 0.159155, z: 'z (km)', zu: 'km', zS: 0.0477135, note: 'frequencies are f = ω/2π in MHz' },
  THz: { w: 'ν (THz)', t: 't (ps)', tu: 'ps', tS: 0.159155, z: 'z (μm)', zu: 'μm', zS: 47.7135, note: 'frequencies are ν = ω/2π in THz' },
};

// Fused silica: Malitson's Sellmeier fit, n² = 1 + Σ B λ²/(λ² − λ_j²), is three undamped
// oscillators of strength B ω_j².  The lines are given only a hint of width: a Lorentzian's
// tails absorb far more than real glass does, which is clear over metres.
const SILICA = [[0.6961663, 18.1253, 1e-4], [0.4079426, 10.6661, 1e-4], [0.8974794, 0.125283, 1e-4]].map(([B, w0, g]) => [w0, g, Math.sqrt(B) * w0]);
const VISIBLE = { lo: 1.653, hi: 3.263, label: 'visible', rainbow: true };
// probe: where the light's frequency starts in the medium view.
const MEDIA = {
  one: { label: 'One line', units: 'au', wmax: 4, oscs: [[2, 0.2, 1]], probe: 1.6 },
  weak: { label: 'Weak line', units: 'au', wmax: 4, oscs: [[2, 0.2, 0.2828]], probe: 1.6 },
  two: { label: 'Two lines', units: 'au', wmax: 4, oscs: [[1.4, 0.12, 0.6], [2.8, 0.25, 0.9]], probe: 2.1 },
  glass: { label: 'Fused silica', units: 'eV', wmax: 14, oscs: SILICA, bands: [VISIBLE], probe: 2.2545,
    lines: [[1.8892, '656 nm (red)'], [2.5506, '486 nm (blue)']] },
  sodium: { label: 'Sodium', units: 'eV', wmax: 12, oscs: [[0, 0.02, 5.9]], bands: [VISIBLE], probe: 3 },
  ionosphere: { label: 'Ionosphere', units: 'MHz', wmax: 30, oscs: [[0, 0.01, 9]], probe: 1,
    bands: [{ lo: 0.53, hi: 1.7, label: 'AM' }, { lo: 3, hi: 30, label: 'shortwave' }] },
  nacl: { label: 'Rock salt', units: 'THz', wmax: 12, epsInf: 2.34, oscs: [[4.9, 0.1, 9.2457]], probe: 6.2 },
  brillouin: { label: 'Dense (Brillouin)', units: 'au', wmax: 10, oscs: [[4, 0.56, 4.4721]], probe: 2.5 },
};

const TYPED = {
  lorentz: { label: 'Lorentz', src: 'wp^2/(w0^2 - w^2 - i g w)', params: { wp: 1, w0: 2, g: 0.2 } },
  wrong: { label: '+i: acausal', src: 'wp^2/(w0^2 - w^2 + i g w)', params: { wp: 1, w0: 2, g: 0.2 } },
  absorb: { label: 'Absorption only', src: 'i a (exp(-((w - w0)/s)^2) - exp(-((w + w0)/s)^2))', params: { a: 0.5, w0: 2, s: 0.3 } },
  conductor: { label: 'Conductor', src: 'i s/w', params: { s: 0.5 } },
  constant: { label: 'Constant', src: 'c0', params: { c0: 1 } },
};
const TYPED_HINTS = {
  wp: { min: 0, max: 4, value: 1 }, w0: { min: 0, max: 4, value: 2 }, g: { min: 0, max: 2, value: 0.2 },
  a: { min: -2, max: 2, value: 0.5 }, s: { min: 0.01, max: 2, value: 0.3 }, c0: { min: -1, max: 4, value: 1 },
};

const KK_N = 16384;      // the Kramers–Kronig grid: 16384 points out to ±8 times the plotted range
const KK_RANGE = 8;
const SLIVER = 1 / 40;   // the width of the sliver, as a fraction of the plotted range
const PERIOD = 1.6;      // seconds of the page's clock per period of the light, in the medium view
const RUN = 7;           // seconds for a pulse to cross the picture in the pulse view
const DEG = 180 / Math.PI;

// ------------------------------------------------------------------------- state

const toOsc = ([w0, g, wp]) => ({ w0, g, wp });
const state = {
  view: 'medium',
  medium: 'one', units: 'au', wmax: 4, epsInf: 1,
  oscs: MEDIA.one.oscs.map(toOsc),
  source: 'osc',            // 'osc' | 'typed' | 'drawn'
  display: 'n',             // 'eps' | 'n'
  showNg: true, showSum: false,
  sel: 0,
  probe: 1.6,               // ω of the light in the medium view
  sweep: false,             // the light's frequency sweeping to and fro by itself
  yRange: null,             // the response plot's vertical range, if zoomed by hand
  broken: false, lastDrawn: 'im',
  sliver: 2, showSliver: true,
  // z: the depth of the detector; view: its time axis (in the frame chosen).
  pulse: { shape: 'gauss', w0: 1, T: 20, tf: -12, z: 120, frame: 'vac', log: false, view: [-40, 100] },
  playing: true,
  tView: 40,                // χ(t) is shown for |t| < tView
};
// The clocks: the light's phase in the medium view; the time t of the pulse view (t = 0 when the
// incident peak, or the switch-on, reaches z = 0); the sweep's direction.
const anim = { phase: 0, t: -1e9, hold: 0, sweepDir: 1, crest: null };
let resp = oscillatorResponse(state.oscs, state.epsInf);
let drawn = null;           // { grid, re, im, chiInf } when the medium is drawn by hand
let kkGridCache = null;
let typedExpr = null, typedParams = {};
const cache = {};           // things computed from the medium, cleared when it changes

const U = () => UNITS[state.units];
const media = () => MEDIA[state.medium] || {};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function kkGrid() {
  const Om = KK_RANGE * state.wmax;
  if (!kkGridCache || kkGridCache.Omega !== Om) kkGridCache = new FreqGrid(KK_N, Om);
  return kkGridCache;
}

function typedFn(w) { return typedExpr.evaluate({ w, omega: w, ...typedParams }, w.length); }

/** Rebuild the response after any change to the medium. */
function rebuild() {
  if (state.source === 'drawn' && drawn) resp = gridResponse(drawn.grid, drawn.re, drawn.im, drawn.chiInf);
  else if (state.source === 'typed' && typedExpr) resp = functionResponse(typedFn);
  else resp = oscillatorResponse(state.oscs, state.epsInf);
  for (const k of Object.keys(cache)) delete cache[k];
  pulseMediumDirty = true;
  dirty();
  scheduleHash();
}

/** Turn the current medium into samples on the grid, ready to be drawn on. */
function toDrawn() {
  if (state.source === 'drawn' && drawn) return;
  const g = kkGrid(), { re, im } = sampleOnGrid(resp, g);
  drawn = { grid: g, re, im, chiInf: resp.chiInf };
  setSource('drawn');
}

// ------------------------------------------------------------------- shared drawing

let colors = null;
function readColors() {
  const cs = getComputedStyle(document.documentElement), get = (n, f) => cs.getPropertyValue(n).trim() || f;
  colors = { ...themeColors(), re: get('--re', '#2f62d8'), im: get('--im', '#c8501a'), refl: get('--refl', '#7b3fb5'),
    ng: get('--ng', '#1f7a3a'), spec: get('--spec', 'rgba(90,100,120,0.16)'), charge: get('--charge', '#b0307a'),
    field: get('--field', '#1d1d1f'), sliver: get('--sliver', '#0f8a8a') };
}

function polyline(ctx, f, xs, ys, clipY = true) {
  ctx.beginPath();
  let pen = false;
  const top = f.top - 20, bot = f.bottom + 20; // (far off-frame dashes are slow to draw)
  for (let i = 0; i < xs.length; i++) {
    let y = f.Y(ys[i]);
    if (!Number.isFinite(y)) { pen = false; continue; }
    if (clipY) y = Math.max(top, Math.min(bot, y));
    const x = f.X(xs[i]);
    if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; }
  }
  ctx.stroke();
}

function vline(ctx, f, x, color, dash = [4, 4], label = '', labelAt = 'top', row = 0) {
  const px = Math.round(f.X(x)) + 0.5;
  if (px < f.left - 1 || px > f.right + 1) return;
  ctx.save();
  ctx.strokeStyle = color; ctx.setLineDash(dash); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(px, f.top); ctx.lineTo(px, f.bottom); ctx.stroke();
  if (label) {
    ctx.setLineDash([]); ctx.fillStyle = color; ctx.font = '11px system-ui, sans-serif';
    const w = ctx.measureText(label).width, right = px + 4 + w > f.right;
    ctx.textAlign = right ? 'right' : 'left'; ctx.textBaseline = 'top';
    ctx.fillText(label, right ? px - 4 : px + 4, labelAt === 'top' ? f.top + 3 + 14 * row : f.bottom - 15 - 14 * row);
  }
  ctx.restore();
}

function legend(ctx, f, items, x = f.left + 8, y = f.top + 6) {
  ctx.save();
  ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  for (const it of items) {
    if (it.title) { ctx.fillStyle = colors.ink; ctx.font = '600 12px system-ui, sans-serif'; ctx.fillText(it.title, x, y + 6); x += ctx.measureText(it.title).width + 14; ctx.font = '12px system-ui, sans-serif'; continue; }
    ctx.strokeStyle = it.color; ctx.lineWidth = it.width || 2.2; ctx.setLineDash(it.dash || []);
    if (it.mark) { ctx.fillStyle = it.color; ctx.beginPath(); ctx.arc(x + 8, y + 6, 4, 0, 2 * Math.PI); ctx.fill(); }
    else { ctx.beginPath(); ctx.moveTo(x, y + 6); ctx.lineTo(x + 16, y + 6); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.fillStyle = colors.ink2;
    x += 30 + (Array.isArray(it.label) ? fillSlots(ctx, it.label, x + 21, y + 6) : (ctx.fillText(it.label, x + 21, y + 6), ctx.measureText(it.label).width));
  }
  ctx.restore();
}

/**
 * A data range covering the curves, from column `skip` on (a free-electron term diverges as
 * ω → 0), and leaving out needles: the top and bottom 0.3% of each curve's values (a line far
 * narrower than a pixel would otherwise flatten everything else).
 */
function autorange(arrays, include = [0], skip = 0) {
  let lo = Infinity, hi = -Infinity;
  for (const a of arrays) {
    const v = [];
    for (let i = skip; i < a.length; i++) if (Number.isFinite(a[i])) v.push(a[i]);
    if (!v.length) continue;
    v.sort((x, y) => x - y);
    const cut = v.length > 300 ? Math.floor(0.003 * v.length) : 0;
    lo = Math.min(lo, v[cut]); hi = Math.max(hi, v[v.length - 1 - cut]);
  }
  for (const v of include) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!(hi > lo)) { lo -= 1; hi += 1; }
  const pad = 0.08 * (hi - lo);
  return [lo - pad, hi + pad];
}

// Wavelength (nm) to an sRGB colour, for the visible band (after Bruton's piecewise fit).
function wavelengthRGB(nm) {
  let r = 0, g = 0, b = 0;
  if (nm < 440) { r = (440 - nm) / 60; b = 1; } else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm < 510) { g = 1; b = (510 - nm) / 20; } else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm < 645) { r = 1; g = (645 - nm) / 65; } else r = 1;
  const f = nm < 420 ? 0.3 + (0.7 * (nm - 380)) / 40 : nm > 700 ? 0.3 + (0.7 * (780 - nm)) / 80 : 1;
  return [r, g, b].map((v) => Math.round(255 * Math.pow(Math.max(0, v * f), 0.8)));
}

/** Named bands of frequency (the visible, AM radio...) as a strip along the bottom of a plot. */
function drawBands(ctx, f) {
  for (const b of media().bands || []) {
    if (state.units !== MEDIA[state.medium].units) continue;
    const x0 = Math.max(f.left, f.X(b.lo)), x1 = Math.min(f.right, f.X(b.hi));
    if (x1 <= x0) continue;
    if (b.rainbow) {
      const grad = ctx.createLinearGradient(x0, 0, x1, 0);
      for (let i = 0; i <= 24; i++) grad.addColorStop(i / 24, `rgb(${wavelengthRGB(1239.84 / f.invX(x0 + ((x1 - x0) * i) / 24)).join(',')})`);
      ctx.fillStyle = grad;
      ctx.fillRect(x0, f.bottom - 6, x1 - x0, 6);
    } else {
      ctx.fillStyle = colors.ink3; ctx.globalAlpha = 0.45;
      ctx.fillRect(x0, f.bottom - 6, x1 - x0, 6); ctx.globalAlpha = 1;
    }
    ctx.fillStyle = colors.ink3; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(b.label, Math.max(f.left + 20, (x0 + x1) / 2), f.bottom - 8);
  }
}

/** A square handle above a plot at x, with a dotted line down through it and a label beside it. */
function topHandle(ctx, f, x, label, color, dash = [2, 3]) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.3; ctx.setLineDash(dash);
  ctx.beginPath(); ctx.moveTo(x + 0.5, f.top); ctx.lineTo(x + 0.5, f.bottom); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = colors.panel; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.rect(x - 6, f.top - 14, 12, 12); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color; ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
  // Beside the handle, on whichever side it fits (or as near as it can get).
  const w = ctx.measureText(label).width, cv = ctx.canvas.getBoundingClientRect().width;
  let lx = x + 10;
  if (lx + w > cv - 4) lx = x - 10 - w;
  if (lx < 4) lx = Math.max(4, Math.min(cv - 4 - w, x + 10));
  ctx.textAlign = 'left';
  ctx.fillText(label, lx, f.top - 8);
  ctx.restore();
}

// --------------------------------------------------------------- the response plot

const respCanvas = $('#resp');
let respFrame = null, handles = [], frozenRange = null, respRange = null;

/** How many columns at the left an automatic range skips: more when free electrons diverge there. */
function skipColumns(n) {
  const free = state.source === 'osc' && state.oscs.some((o) => o.w0 === 0 && o.wp > 0);
  return Math.ceil(n * (free ? 0.15 : 0.03));
}

function columnsFor(f) {
  const n = Math.max(2, Math.round(f.w)), ws = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) ws[i] = f.x0 + ((f.x1 - f.x0) * i) / n;
  ws[0] = Math.max(ws[0], 1e-6 * state.wmax);
  return ws;
}

/** n_g at ω (numerical derivative; a drawn medium needs a step of a couple of grid points). */
function ngAt(w) {
  const h = state.source === 'drawn' && drawn ? 2 * drawn.grid.dw : 2e-4 * state.wmax;
  return groupIndex(resp, Float64Array.of(Math.max(w, h)), h)[0];
}

/** The displayed imaginary quantity (ε'' or κ) at one frequency, for a trial set of oscillators. */
function imagAt(oscs, w) {
  const o = optics(oscillatorResponse(oscs, state.epsInf), Float64Array.of(w));
  return state.display === 'eps' ? o.ei[0] : o.k[0];
}

function drawResponse() {
  const { ctx, width, height } = fitCanvas(respCanvas);
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 50, right: 14, top: 36, bottom: 34 });
  respFrame = f;
  f.x0 = 0; f.x1 = state.wmax;
  const ws = columnsFor(f), o = optics(resp, ws);
  const [A, B] = state.display === 'eps' ? [o.er, o.ei] : [o.n, o.k];
  const showNg = state.showNg && state.view === 'pulse';
  const ng = showNg ? groupIndex(resp, ws, state.source === 'drawn' && drawn ? 2 * drawn.grid.dw : 2e-4 * state.wmax) : null;
  respRange = frozenRange || state.yRange || autorange([A, B], [0, 1], skipColumns(ws.length));
  [f.y0, f.y1] = respRange;

  f.clip();
  drawBands(ctx, f);
  // The pulse's spectrum.
  if (state.view === 'pulse') {
    const sp = pulseSpectrum(ws);
    if (sp) {
      ctx.fillStyle = colors.spec;
      ctx.beginPath(); ctx.moveTo(f.left, f.bottom);
      for (let i = 0; i < ws.length; i++) ctx.lineTo(f.X(ws[i]), f.bottom - 0.42 * f.h * sp[i]);
      ctx.lineTo(f.right, f.bottom); ctx.closePath(); ctx.fill();
    }
  }
  // Zero (and 1 for n), lightly.
  ctx.strokeStyle = colors.line; ctx.lineWidth = 1;
  for (const v of state.display === 'n' ? [0, 1] : [0]) { const y = Math.round(f.Y(v)) + 0.5; ctx.beginPath(); ctx.moveTo(f.left, y); ctx.lineTo(f.right, y); ctx.stroke(); }
  if (ng) { ctx.strokeStyle = colors.ng; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]); polyline(ctx, f, ws, ng); ctx.setLineDash([]); }
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = colors.im; polyline(ctx, f, ws, B);
  ctx.strokeStyle = colors.re; polyline(ctx, f, ws, A);
  ctx.restore();

  // Handles: the resonances, then the light's frequency (medium view) or the carrier (pulses).
  handles = [];
  if (state.source === 'osc') drawHandles(ctx, f);
  const top = (w, label, type) => {
    const x = f.X(w);
    if (x < f.left - 1 || x > f.right + 1) return;
    topHandle(ctx, f, x, label, colors.ink2);
    handles.push({ type, x, y: f.top - 8, r: 15 });
  };
  const sym = U().w.split(' ')[0];
  if (state.view === 'medium') top(state.probe, state.sweep ? `the light’s ${sym} (sweeping: drag to stop)` : `the light’s ${sym}: drag`, 'probe');
  if (state.view === 'pulse') top(state.pulse.w0, 'carrier ω_c: drag', 'carrier');
  f.axes({ xlabel: U().w, colors });
  const items = state.display === 'eps'
    ? [{ label: 'ε′ = Re ε', color: colors.re }, { label: 'ε″ = Im ε (absorption)', color: colors.im }]
    : [{ label: 'n', color: colors.re }, { label: 'κ (absorption)', color: colors.im }];
  if (ng) items.push({ label: 'n_g = c dk/dω', color: colors.ng, dash: [5, 3], width: 1.5 });
  legend(ctx, f, items, f.left + 4, 1);
  ctx.save(); ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = colors.ink3; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  if (state.yRange) ctx.fillText('zoomed (double-click for automatic)', f.right, 6);
  else if (state.source === 'osc' && state.oscs.length && width > 760) ctx.fillText('● drag a line about (up: stronger) · ◇ its width', f.right, 6);
  ctx.restore();
}

function drawHandles(ctx, f) {
  const sel = state.sel;
  state.oscs.forEach((o, j) => {
    const selected = j === sel;
    ctx.save();
    ctx.lineWidth = selected ? 2.2 : 1.5;
    if (o.w0 === 0) {
      // A free electron: one handle at ω_p on the real curve (ε' = 0 there for weak damping).
      const wp = o.wp, x = f.X(wp);
      if (x < f.left || x > f.right) { ctx.restore(); return; }
      const o2 = optics(resp, Float64Array.of(wp)), yv = state.display === 'eps' ? o2.er[0] : o2.n[0];
      const y = Math.max(f.top + 6, Math.min(f.bottom - 6, f.Y(yv)));
      ctx.fillStyle = colors.re; ctx.strokeStyle = selected ? colors.ink : colors.panel;
      ctx.beginPath(); ctx.arc(x, y, selected ? 8 : 7, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      ctx.fillStyle = colors.ink2; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText('ω_p', x + 9, y - 4);
      handles.push({ type: 'free', j, x, y, r: 14 });
      ctx.restore();
      return;
    }
    const x = f.X(o.w0);
    if (x < f.left - 2 || x > f.right + 2) { ctx.restore(); return; }
    const yv = imagAt(state.oscs, o.w0);
    let y = f.Y(yv), clipped = false;
    if (y < f.top + 6) { y = f.top + 6; clipped = true; }
    if (y > f.bottom - 6) y = f.bottom - 6;
    // Width handles at ω0 ± γ/2 (the half maximum of this line's ε'').
    for (const s of [-1, 1]) {
      const w = o.w0 + (s * o.g) / 2;
      if (w <= 0 || w > state.wmax) continue;
      const xx = f.X(w), yy = Math.max(f.top + 4, Math.min(f.bottom - 4, f.Y(imagAt(state.oscs, w))));
      ctx.fillStyle = colors.panel; ctx.strokeStyle = colors.im;
      ctx.beginPath(); ctx.moveTo(xx, yy - 5); ctx.lineTo(xx + 5, yy); ctx.lineTo(xx, yy + 5); ctx.lineTo(xx - 5, yy); ctx.closePath(); ctx.fill(); ctx.stroke();
      handles.push({ type: s < 0 ? 'wl' : 'wr', j, x: xx, y: yy, r: 11 });
    }
    ctx.fillStyle = colors.im; ctx.strokeStyle = selected ? colors.ink : colors.panel;
    ctx.beginPath();
    if (clipped) { ctx.moveTo(x, y - 8); ctx.lineTo(x + 7, y + 4); ctx.lineTo(x - 7, y + 4); ctx.closePath(); }
    else ctx.arc(x, y, selected ? 8 : 7, 0, 2 * Math.PI);
    ctx.fill(); ctx.stroke();
    if (state.oscs.length > 1) {
      ctx.fillStyle = colors.ink2; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(String(j + 1), x + 9, y - 4);
    }
    handles.push({ type: 'peak', j, x, y, r: 15 });
    ctx.restore();
  });
}

// Dragging on the response plot: a handle if one is under the pointer, else (in the medium
// view) the light's frequency.
let drag = null;
function pointerXY(e, canvas) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

respCanvas.addEventListener('pointerdown', (e) => {
  const [px, py] = pointerXY(e, respCanvas), f = respFrame;
  if (!f) return;
  const slack = e.pointerType === 'touch' ? 10 : 0;
  let best = null, bd = Infinity;
  for (const h of handles) { const d = Math.hypot(h.x - px, h.y - py); if (d < h.r + slack && d < bd) { bd = d; best = h; } }
  if (!best && state.view !== 'medium') return;
  respCanvas.setPointerCapture(e.pointerId);
  stopSweep();
  if (best) {
    drag = { ...best, py0: py, dx: best.x - px };
    if (best.j !== undefined) selectOsc(best.j);
    if (best.type !== 'probe' && best.type !== 'carrier') frozenRange = respRange;
  } else drag = { type: 'probe', dx: 0 };
  moveDrag(px, py);
});
respCanvas.addEventListener('pointermove', (e) => {
  const [px, py] = pointerXY(e, respCanvas);
  if (drag) { moveDrag(px, py); return; }
  hoverCursor(px, py);
});
const endDrag = () => {
  if (!drag) return;
  const wasPulse = drag.type === 'carrier';
  drag = null; frozenRange = null;
  if (wasPulse) checkView();
  scheduleHash(); dirty();
};
respCanvas.addEventListener('pointerup', endDrag);
respCanvas.addEventListener('pointercancel', endDrag);
// The wheel zooms the vertical axis about the pointer; a double click goes back to automatic.
respCanvas.addEventListener('wheel', (e) => {
  if (!respFrame || !respRange) return;
  e.preventDefault();
  const [, py] = pointerXY(e, respCanvas), y0 = respFrame.invY(py), k = Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * 0.0015)));
  state.yRange = [y0 + (respRange[0] - y0) * k, y0 + (respRange[1] - y0) * k];
  dirty();
}, { passive: false });
respCanvas.addEventListener('dblclick', () => { state.yRange = null; dirty(); });
// The arrow keys move the light's frequency (or the carrier), a little, or ten times as far with shift.
respCanvas.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const d = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 0.05 : 0.005) * state.wmax;
  if (state.view === 'medium') { stopSweep(); setProbe(state.probe + d); }
  else if (state.view === 'pulse') { state.pulse.w0 = clamp(state.pulse.w0 + d, 0.02 * state.wmax, state.wmax); syncPulseSliders(); pulseChanged(); }
});

function hoverCursor(px, py) {
  const near = handles.some((h) => Math.hypot(h.x - px, h.y - py) < h.r);
  respCanvas.style.cursor = near ? 'grab' : state.view === 'medium' ? 'ew-resize' : 'default';
}

function moveDrag(px, py) {
  // (A handle keeps the offset at which it was grabbed, so it does not jump to the pointer.)
  const f = respFrame, w = f.invX(px + (drag.dx || 0)), y = f.invY(py), W = state.wmax;
  if (drag.type === 'probe') { setProbe(w); return; }
  if (drag.type === 'carrier') { state.pulse.w0 = clamp(w, 0.02 * W, W); syncPulseSliders(); pulseChanged(); return; }
  const o = state.oscs[drag.j];
  if (drag.type === 'free') o.wp = clamp(w, 0, 2 * W);
  else if (drag.type === 'wl' || drag.type === 'wr') o.g = clamp(2 * Math.abs(f.invX(px) - o.w0), 1e-4 * W, 2 * W);
  else if (drag.type === 'peak') {
    o.w0 = clamp(w, 0.01 * W, W);
    // Up and down sets the strength; a sideways drag (within a few pixels) only moves the line.
    if (drag.moved || Math.abs(py - drag.py0) > 5) { drag.moved = true; setStrengthForHeight(drag.j, Math.max(0, y)); }
  }
  syncOscSliders();
  rebuild();
}

/** Choose oscillator j's strength so that the displayed ε'' (or κ) at its resonance is y. */
function setStrengthForHeight(j, y) {
  const o = state.oscs[j], trial = state.oscs.map((q) => ({ ...q }));
  const at = (S) => { trial[j].wp = Math.sqrt(S); return imagAt(trial, o.w0); };
  if (at(0) >= y) { o.wp = 0; return; }
  let lo = 0, hi = 1e-4 * state.wmax * state.wmax;
  for (let i = 0; i < 80 && at(hi) < y; i++) hi *= 2;
  for (let i = 0; i < 60; i++) { const mid = 0.5 * (lo + hi); if (at(mid) < y) lo = mid; else hi = mid; }
  o.wp = Math.sqrt(0.5 * (lo + hi));
}

/** The light's frequency in the medium view. */
function setProbe(w, { fromSlider = false } = {}) {
  state.probe = clamp(w, 0.002 * state.wmax, state.wmax);
  if (!fromSlider) probeSlider.value = state.probe;
  dirty(); scheduleHash();
}
function stopSweep() { if (state.sweep) { state.sweep = false; sweepToggle.on = false; } }

// ------------------------------------------------------------------- reflectance

const reflCanvas = $('#refl');
let reflFrame = null;
function drawReflectance() {
  const { ctx, width, height } = fitCanvas(reflCanvas);
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 50, right: 14, top: 22, bottom: 34 });
  reflFrame = f;
  f.x0 = 0; f.x1 = state.wmax; f.y0 = 0; f.y1 = 1.05;
  const ws = columnsFor(f), { R } = optics(resp, ws);
  f.clip();
  drawBands(ctx, f);
  ctx.fillStyle = colors.refl; ctx.globalAlpha = 0.12;
  ctx.beginPath(); ctx.moveTo(f.left, f.bottom);
  for (let i = 0; i < ws.length; i++) ctx.lineTo(f.X(ws[i]), f.Y(R[i]));
  ctx.lineTo(f.right, f.bottom); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = colors.refl; ctx.lineWidth = 2.2; polyline(ctx, f, ws, R);
  if (state.view === 'medium') vline(ctx, f, state.probe, colors.ink2, [2, 3]);
  ctx.restore();
  f.axes({ xlabel: U().w, colors });
  legend(ctx, f, [{ label: width > 640 ? 'R = |(ñ − 1)/(ñ + 1)|², the fraction reflected at normal incidence' : 'R, the fraction reflected', color: colors.refl }], f.left + 4, 2);
}
// The reflectance plot moves the light's frequency too.
let reflDrag = false;
reflCanvas.addEventListener('pointerdown', (e) => { if (!reflFrame) return; reflCanvas.setPointerCapture(e.pointerId); reflDrag = true; stopSweep(); setProbe(reflFrame.invX(pointerXY(e, reflCanvas)[0])); });
reflCanvas.addEventListener('pointermove', (e) => { if (reflDrag) setProbe(reflFrame.invX(pointerXY(e, reflCanvas)[0])); });
for (const ev of ['pointerup', 'pointercancel']) reflCanvas.addEventListener(ev, () => { reflDrag = false; });

// ----------------------------------------------------- one charge and one wave, at ω

/** The oscillator the charge picture shows: the selected one, if the medium is made of them. */
function pictureOsc() { return state.source === 'osc' ? state.oscs[state.sel] || null : null; }

/** What the charge picture shows at ω: its amplitude and lag (for a typed or drawn medium, the
 *  polarisation's: |χ| and arg χ). */
function chargeAt(w) {
  const o = pictureOsc();
  if (o && strength(o) > 0) return { ...drivenCharge(o, w), free: o.w0 === 0, osc: o };
  const c = resp.chi(Float64Array.of(w)), re = c.re[0] - resp.chiInf, im = c.im[0];
  return { amp: Math.hypot(re, im), lag: Math.atan2(im, re), free: false, osc: null };
}

function drawPictures() {
  for (const id of ['charge', 'wave']) {
    const cv = $('#' + id), { ctx, width, height } = fitCanvas(cv), w = state.probe;
    if (id === 'charge') {
      const ch = chargeAt(w), o = ch.osc, many = state.oscs.length > 1;
      const title = !o ? 'The polarisation P, driven at ω' : o.w0 === 0 ? 'A free charge, driven at ω' : many ? `The charge of line ${state.sel + 1}, driven at ω` : 'A charge on a spring, driven at ω';
      drawCharge(ctx, width, height, { phase: anim.phase, amp: ch.amp, lag: ch.lag, free: ch.free, title, colors, polarisation: !o });
    } else {
      const op = optics(resp, Float64Array.of(w));
      drawWave(ctx, width, height, { n: op.n[0], k: op.k[0], R: op.R[0], phase: anim.phase, colors, title: 'The light at ω, meeting the medium' });
    }
  }
}

// ---------------------------------------------------------------- Kramers–Kronig

/** χ on the plotted range for the KK view: grid samples when drawn, else exact at each column. */
function kkCurves(f) {
  if (state.source === 'drawn' && drawn) {
    const g = drawn.grid, kmax = Math.min(g.N / 2 - 1, Math.ceil(state.wmax / g.dw) + 1);
    const ws = new Float64Array(kmax + 1), re = new Float64Array(kmax + 1), im = new Float64Array(kmax + 1);
    for (let k = 0; k <= kmax; k++) { ws[k] = k * g.dw; re[k] = drawn.re[k] + drawn.chiInf; im[k] = drawn.im[k]; }
    if (kmax > 0) re[0] = re[1]; // (a Drude δ(ω) is not drawn)
    return { ws, re, im };
  }
  const ws = columnsFor(f), { re, im } = resp.chi(ws);
  return { ws, re, im };
}

/** χ(t) on a set of times: exact for oscillators, from the FFT otherwise. */
function chiT() {
  if (cache.chiT) return cache.chiT;
  if (state.source === 'osc') { cache.chiT = { exact: true }; return cache.chiT; }
  const g = state.source === 'drawn' && drawn ? drawn.grid : kkGrid();
  let re, im;
  if (state.source === 'drawn' && drawn) { re = drawn.re; im = drawn.im; }
  else { const s = sampleOnGrid(resp, g); re = s.re; im = s.im; }
  const c = impulseResponse(g, re, im);
  cache.chiT = { exact: false, grid: g, c: c.re };
  return cache.chiT;
}

function chiTAt(ts) {
  const ct = chiT();
  if (ct.exact) return chiTimeOscillators(state.oscs, ts);
  const { grid: g, c } = ct, N = g.N, out = new Float64Array(ts.length);
  for (let i = 0; i < ts.length; i++) {
    const u = ts[i] / g.dt, k = Math.floor(u), fr = u - k;
    const a = c[((k % N) + N) % N], b = c[(((k + 1) % N) + N) % N];
    out[i] = a * (1 - fr) + b * fr;
  }
  return out;
}

/** The sliver: [a, b] and its height h, Im χ at its middle. */
function sliver() {
  if (!state.showSliver) return null;
  const d = SLIVER * state.wmax, wq = clamp(state.sliver, d / 2 + 1e-9, state.wmax - d / 2);
  const h = resp.chi(Float64Array.of(wq)).im[0];
  return { w: wq, a: wq - d / 2, b: wq + d / 2, h: Number.isFinite(h) ? h : 0 };
}

let kkFrames = {}, kkRange = null, kkFrozen = null;

function drawKK() {
  const fIm = setupKKFrame('#kkim'), fRe = setupKKFrame('#kkre'), sl = sliver();
  const { ws, re, im } = kkCurves(fIm.f);
  kkRange = kkFrozen || autorange([re, im], [0], skipColumns(ws.length));
  const narrow = fIm.f.w < 580;
  for (const [{ ctx, f }, data, color, name] of [[fIm, im, colors.im, narrow ? 'Im χ, absorption: draw' : 'Im χ: the absorption (draw on it)'], [fRe, re, colors.re, narrow ? 'Re χ, dispersion: draw' : 'Re χ: the dispersion (draw on it)']]) {
    [f.y0, f.y1] = kkRange;
    f.clip();
    drawBands(ctx, f);
    ctx.strokeStyle = colors.line; ctx.lineWidth = 1;
    const y0 = Math.round(f.Y(0)) + 0.5; ctx.beginPath(); ctx.moveTo(f.left, y0); ctx.lineTo(f.right, y0); ctx.stroke();
    if (data === im) {
      // Im χ < 0 for ω > 0 would be gain: shade it.
      ctx.fillStyle = colors.warn; ctx.globalAlpha = 0.18;
      for (let i = 1; i < ws.length; i++) if (im[i] < 0) { const x0 = f.X(ws[i - 1]), x1 = f.X(ws[i]); ctx.fillRect(x0, f.Y(0), Math.max(1, x1 - x0), f.Y(im[i]) - f.Y(0)); }
      ctx.globalAlpha = 1;
      if (sl) { ctx.fillStyle = colors.sliver; ctx.globalAlpha = 0.45; ctx.fillRect(f.X(sl.a), f.Y(Math.max(0, sl.h)), f.X(sl.b) - f.X(sl.a), Math.abs(f.Y(sl.h) - f.Y(0))); ctx.globalAlpha = 1; }
    }
    ctx.strokeStyle = color; ctx.lineWidth = 2.2; polyline(ctx, f, ws, data);
    if (data === re && sl && !state.broken) {
      // The sliver's share of Re χ, at true scale.
      const cols = columnsFor(f), share = sliverRe(sl.a, sl.b, sl.h, cols);
      // (Filled lightly, so that its long tails show: + below the sliver, − above.)
      ctx.fillStyle = colors.sliver; ctx.globalAlpha = 0.16; ctx.beginPath(); ctx.moveTo(f.X(cols[0]), f.Y(0));
      for (let i = 0; i < cols.length; i++) ctx.lineTo(f.X(cols[i]), clamp(f.Y(share[i]), f.top - 2, f.bottom + 2));
      ctx.lineTo(f.X(cols[cols.length - 1]), f.Y(0)); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.sliver; ctx.lineWidth = 2; ctx.setLineDash([5, 3]); polyline(ctx, f, cols, share); ctx.setLineDash([]);
    }
    ctx.restore();
    if (data === im && sl) { const x = f.X(sl.w); topHandle(ctx, f, x, 'one sliver: drag', colors.sliver, [1, 4]); kkSliverX = x; }
    f.axes({ xlabel: U().w, colors });
    const items = [{ label: name, color }];
    if (data === re && sl && !state.broken) items.push({ label: narrow ? 'sliver’s share' : 'the sliver’s share', color: colors.sliver, dash: [5, 3], width: 2 });
    legend(ctx, f, items, f.left + 4, 4);
    if (state.broken) {
      ctx.save(); ctx.fillStyle = colors.warn; ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillText(narrow ? 'causality broken' : 'causality broken: the other side does not follow', f.right - 4, narrow ? f.top + 4 : 6); ctx.restore();
    }
  }
  drawChiT(sl);
}
let kkSliverX = null;

function setupKKFrame(sel) {
  const cv = $(sel), { ctx, width, height } = fitCanvas(cv);
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 50, right: 14, top: sel === '#kkim' ? 36 : 24, bottom: 32 });
  f.x0 = 0; f.x1 = state.wmax;
  kkFrames[sel] = f;
  return { ctx, f };
}

function drawChiT(sl) {
  const cv = $('#kkt'), { ctx, width, height } = fitCanvas(cv);
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 50, right: 14, top: 24, bottom: 32 });
  const T = state.tView, n = Math.max(200, Math.round(f.w * 2)), tS = U().tS;
  const ts = Float64Array.from({ length: n + 1 }, (_, i) => -T + (2 * T * i) / n);
  const c = chiTAt(ts), share = sl ? sliverTime(sl.a, sl.b, sl.h, ts, !state.broken) : null;
  f.x0 = -T * tS; f.x1 = T * tS;
  [f.y0, f.y1] = autorange(share ? [c, share] : [c], [0]);
  f.clip();
  // The past: shaded.
  ctx.fillStyle = colors.spec; ctx.fillRect(f.left, f.top, f.X(0) - f.left, f.h);
  ctx.strokeStyle = colors.line; ctx.lineWidth = 1;
  const y0 = Math.round(f.Y(0)) + 0.5; ctx.beginPath(); ctx.moveTo(f.left, y0); ctx.lineTo(f.right, y0); ctx.stroke();
  const tsS = Float64Array.from(ts, (t) => t * tS);
  ctx.strokeStyle = colors.accent; ctx.lineWidth = 2;
  polyline(ctx, f, tsS, c);
  if (share) { ctx.strokeStyle = colors.sliver; ctx.lineWidth = 2; ctx.setLineDash([5, 3]); polyline(ctx, f, tsS, share); ctx.setLineDash([]); }
  // The instantaneous part, (ε∞ − 1) δ(t), as an arrow.
  const chiInf = resp.chiInf || 0;
  if (Math.abs(chiInf) > 1e-9) {
    const x = f.X(0), yTop = chiInf > 0 ? f.top + 8 : f.bottom - 8;
    ctx.strokeStyle = colors.ink2; ctx.fillStyle = colors.ink2; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, f.Y(0)); ctx.lineTo(x, yTop); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, yTop); ctx.lineTo(x - 5, yTop + (chiInf > 0 ? 9 : -9)); ctx.lineTo(x + 5, yTop + (chiInf > 0 ? 9 : -9)); ctx.closePath(); ctx.fill();
    ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(`(ε∞ − 1) δ(t)`, x + 6, chiInf > 0 ? f.top + 6 : f.bottom - 20);
  }
  ctx.restore();
  f.axes({ xlabel: U().t, colors });
  ctx.save(); ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = colors.ink3; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('before the kick', (f.left + f.X(0)) / 2, f.top + 22);
  ctx.restore();
  const narrow = f.w < 580;
  const items = [{ label: narrow ? 'χ(t), after a kick at t = 0' : 'χ(t): the response to a kick of E at t = 0', color: colors.accent }];
  if (share) items.push({ label: state.broken ? (narrow ? 'sliver' : 'the sliver alone') : (narrow ? 'sliver' : 'the sliver’s share'), color: colors.sliver, dash: [5, 3], width: 2 });
  legend(ctx, f, items, f.left + 4, 4);
  cache.acausal = acausalFraction();
}

/** The largest |χ(t)| for t < 0 over the largest for t > 0 (on |t| < tView). */
function acausalFraction() {
  // From an FFT, χ(t) is blurred over a few time steps either side of t = 0 by the finite range
  // of frequencies (a 1/ω² tail cut off at Ω): those are left out.
  const ct = chiT(), t0 = ct.exact ? 0 : 5 * ct.grid.dt;
  const T = state.tView, n = 2000, tsN = Float64Array.from({ length: n }, (_, i) => -T + ((T - t0) * (i + 0.5)) / n);
  const tsP = Float64Array.from(tsN, (t) => -t);
  const a = chiTAt(tsN), b = chiTAt(tsP);
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma = Math.max(ma, Math.abs(a[i])); mb = Math.max(mb, Math.abs(b[i])); }
  return { before: ma, after: mb };
}

// Drawing on the KK plots (or, at the top of Im χ, moving the sliver).
let kkDraw = null;
for (const [sel, side] of [['#kkim', 'im'], ['#kkre', 're']]) {
  const cv = $(sel);
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const [px, py] = pointerXY(e, cv), f = kkFrames[sel];
    if (side === 'im' && f && kkSliverX !== null && (py < f.top || Math.abs(px - kkSliverX) < 9 && py < f.top + 12)) {
      kkDraw = { sliver: true, sel };
      moveSliver(px);
      return;
    }
    toDrawn();
    kkDraw = { side, sel, last: -1, lastV: 0 };
    kkFrozen = kkRange;
    paintKK(e);
  });
  cv.addEventListener('pointermove', (e) => {
    if (kkDraw && kkDraw.sel === sel) { if (kkDraw.sliver) moveSliver(pointerXY(e, cv)[0]); else paintKK(e); return; }
    if (side === 'im' && kkFrames[sel]) { const [px, py] = pointerXY(e, cv); cv.style.cursor = py < kkFrames[sel].top || (kkSliverX !== null && Math.abs(px - kkSliverX) < 9 && py < kkFrames[sel].top + 12) ? 'ew-resize' : 'crosshair'; }
  });
  const end = () => { if (!kkDraw) return; const was = kkDraw; kkDraw = null; kkFrozen = null; if (was.sliver) { scheduleHash(); return; } rebuild(); };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
}
function moveSliver(px) { const f = kkFrames['#kkim']; if (!f) return; state.sliver = clamp(f.invX(px), 0, state.wmax); dirty(); }

function paintKK(e) {
  const f = kkFrames[kkDraw.sel];
  if (!f) return;
  const [px, py] = pointerXY(e, $(kkDraw.sel));
  const g = drawn.grid, N = g.N, kmax = Math.floor(state.wmax / g.dw);
  const k = clamp(Math.round(f.invX(px) / g.dw), 0, kmax);
  let v = f.invY(py);
  if (kkDraw.side === 're') v -= drawn.chiInf;
  const k0 = kkDraw.last < 0 ? k : kkDraw.last, v0 = kkDraw.last < 0 ? v : kkDraw.lastV;
  const arr = kkDraw.side === 'im' ? drawn.im : drawn.re, sign = kkDraw.side === 'im' ? -1 : 1;
  for (let j = Math.min(k0, k); j <= Math.max(k0, k); j++) {
    const val = k === k0 ? v : v0 + ((v - v0) * (j - k0)) / (k - k0);
    if (j === 0) { if (kkDraw.side === 're') arr[0] = val; continue; }
    arr[j] = val; arr[N - j] = sign * val;
  }
  kkDraw.last = k; kkDraw.lastV = v;
  state.lastDrawn = kkDraw.side;
  if (!state.broken) applyKK();
  rebuild();
}

/** Recompute the side not drawn last from the side drawn last. */
function applyKK() {
  if (!drawn) return;
  if (state.lastDrawn === 'im') kkImToRe(drawn.im, drawn.re);
  else kkReToIm(drawn.re, drawn.im);
}

// ------------------------------------------------------------------------- pulses

let prop = null, propKey = '', pulseMediumDirty = true, vacCache = null, traceCache = null;

/** The pulse's parameters in simulation units. */
function pulseParams() { const p = state.pulse; return { w0: p.w0, T: p.T, tf: p.tf }; }

function ensurePropagator() {
  const p = pulseParams(), sh = state.pulse.shape;
  const key = JSON.stringify([sh, p, state.pulse.view, state.wmax]);
  if (key !== propKey) {
    const g = planGrid(sh, p, state.pulse.view, state.wmax);
    prop = new Propagator(g.N, g.dt, g.t0);
    prop.setInput(incident(sh, p, prop.t), g.smooth);
    prop.shape = sh; prop.p = p;
    propKey = key; pulseMediumDirty = true; vacCache = null; traceCache = null;
  }
  if (pulseMediumDirty) { prop.setMedium(resp); pulseMediumDirty = false; cache.ng0 = undefined; traceCache = null; }
  if (cache.ng0 === undefined) cache.ng0 = ngAt(state.pulse.w0);
  return prop;
}

/** |E(0, ω)|² on the given frequencies, scaled to a peak of 1 (for the response plot). */
function pulseSpectrum(ws) {
  const P = ensurePropagator(), out = new Float64Array(ws.length);
  let top = 0;
  for (let k = 0; k < P.half; k++) top = Math.max(top, P.Xr[k] ** 2 + P.Xi[k] ** 2);
  if (!(top > 0)) return null;
  for (let i = 0; i < ws.length; i++) {
    const u = ws[i] / P.dw, k = Math.floor(u), fr = u - k;
    if (k + 1 >= P.half) continue;
    const a = (P.Xr[k] ** 2 + P.Xi[k] ** 2), b = (P.Xr[k + 1] ** 2 + P.Xi[k + 1] ** 2);
    out[i] = (a * (1 - fr) + b * fr) / top;
  }
  return out;
}

const frameShift = (z) => (state.pulse.frame === 'group' && Number.isFinite(cache.ng0) ? z * (cache.ng0 - 1) : 0);

/** The pulse at distance z: medium and vacuum analytic signals (copies), times in the frame, and measurements. */
function pulseAt(z) {
  const P = ensurePropagator(), tc = frameShift(z), N = P.N;
  const a = P.field(z, tc), mr = Float64Array.from(a.re), mi = Float64Array.from(a.im);
  // The vacuum pulse is the incident one (as smoothed for the grid), moved by the frame's shift:
  // read off by interpolation, never through the FFT, so that it cannot wrap round the periodic
  // window when the frame moving with the pulse has left it far behind.
  if (!vacCache || vacCache.P !== P) { const v = P.field(0, 0, true); vacCache = { P, br: Float64Array.from(v.re), bi: Float64Array.from(v.im), tc: NaN }; }
  if (vacCache.tc !== tc) {
    const { br, bi } = vacCache, vr = new Float64Array(N), vi = new Float64Array(N), shift = tc / P.dt;
    for (let n = 0; n < N; n++) {
      const u = n + shift, k = Math.floor(u), f = u - k;
      if (k < 0 || k + 1 >= N) continue;
      vr[n] = br[k] * (1 - f) + br[k + 1] * f; vi[n] = bi[k] * (1 - f) + bi[k + 1] * f;
    }
    Object.assign(vacCache, { tc, vr, vi, env: null });
  }
  // (br, bi: the incident pulse itself, unshifted: the reference for heights, energies and lengths.)
  return { P, tc, t: P.t, mr, mi, vr: vacCache.vr, vi: vacCache.vi, br: vacCache.br, bi: vacCache.bi, N };
}

/** The pulse at the detector (depth state.pulse.z), and what is measured of it: kept until
 *  something changes, since the animation only moves the clock. */
function trace() {
  const P = ensurePropagator(), z = state.pulse.z, key = `${z}|${state.pulse.frame}|${cache.ng0}`;
  if (!traceCache || traceCache.P !== P || traceCache.key !== key) {
    const d = pulseAt(z);
    traceCache = { P, key, d, ms: measure(d, z) };
  }
  return traceCache;
}

function measure(d, z) {
  const { t, mr, mi, br, bi, tc } = d, sh = state.pulse.shape;
  const m = moments(t, mr, mi), m0 = moments(t, br, bi);
  // Times in the frame shown (peak, predicted) and after z/c (peakVac, predictedVac).
  const out = { energy: m.energy / m0.energy, ng: cache.ng0, predicted: z * (cache.ng0 - 1) - tc, predictedVac: z * (cache.ng0 - 1) };
  if (sh !== 'step') {
    const pk = peakTime(t, mr, mi), pv = peakTime(t, br, bi);
    out.peak = pk.t; out.peakVac = pk.t + tc; out.height = pk.peak / pv.peak; out.stretch = m.rms / m0.rms;
  }
  if (sh !== 'gauss') {
    const front = (sh === 'front' ? state.pulse.tf : 0) - tc, margin = 12 * d.P.dt;
    let top = 0;
    for (let i = 0; i < mr.length; i++) top = Math.max(top, Math.abs(mr[i]));
    out.before = maxBefore(t, mr, front - margin) / top;
    out.front = front;
  }
  if (sh === 'step') out.brillouin = z * (optics(resp, Float64Array.of(1e-6 * state.wmax)).n[0] - 1) - tc;
  return out;
}

const pulseCanvas = $('#pulse');
let lastPulse = null;

function drawPulse() {
  const { ctx, width, height } = fitCanvas(pulseCanvas);
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 50, right: 14, top: 24, bottom: 34 });
  const z = state.pulse.z, tr = trace(), d = tr.d, sh = state.pulse.shape, tS = U().tS, log = state.pulse.log;
  const [lo, hi] = state.pulse.view;
  f.x0 = lo * tS; f.x1 = hi * tS;
  const { t, mr, mi, vr, vi } = d, dt = d.P.dt;
  // Samples per pixel column.
  const cols = Math.max(2, Math.round(f.w));
  const colOf = (tt) => Math.floor(((tt - lo) / (hi - lo)) * cols);
  // Envelopes: the analytic signal for a Gaussian, a causal running maximum for a front (the
  // analytic signal's envelope reaches ahead of a front).
  const win = Math.max(1, Math.round((2 * Math.PI) / (state.pulse.w0 * dt)));
  const causal = !(sh === 'gauss' && !log);
  if (causal && (!tr.envM || tr.win !== win)) { tr.envM = causalEnvelope(mr, win); tr.envV = causalEnvelope(vr, win); tr.win = win; }
  const envM = causal ? tr.envM : null, envV = causal ? tr.envV : null;
  // Column extrema.
  const fmin = new Float64Array(cols).fill(Infinity), fmax = new Float64Array(cols).fill(-Infinity);
  const em = new Float64Array(cols), ev = new Float64Array(cols), wloc = new Float64Array(cols).fill(NaN);
  let vmax = 0, mmax = 0;
  for (let n = 0; n < t.length; n++) {
    const c = colOf(t[n]);
    if (c < 0 || c >= cols) continue;
    const v = mr[n];
    if (v < fmin[c]) fmin[c] = v;
    if (v > fmax[c]) fmax[c] = v;
    const amp = envM ? envM[n] : Math.sqrt(mr[n] * mr[n] + mi[n] * mi[n]), vamp = envV ? envV[n] : Math.sqrt(vr[n] * vr[n] + vi[n] * vi[n]);
    if (amp > em[c]) {
      em[c] = amp;
      if (!envM && n + 1 < t.length && amp > 1e-9) {
        // The local frequency, −d(arg a)/dt.
        const re = mr[n + 1] * mr[n] + mi[n + 1] * mi[n], im = mi[n + 1] * mr[n] - mr[n + 1] * mi[n];
        wloc[c] = -Math.atan2(im, re) / dt;
      }
    }
    if (vamp > ev[c]) ev[c] = vamp;
    mmax = Math.max(mmax, amp);
  }
  // The scale is the incident pulse's peak, wherever the vacuum pulse is (it may be out of view).
  for (let n = 0; n < t.length; n++) vmax = Math.max(vmax, Math.sqrt(d.br[n] * d.br[n] + d.bi[n] * d.bi[n]));
  // A column no sample fell in borrows from the one before (only on very wide plots).
  for (let c = 1; c < cols; c++) if (!(fmax[c] >= fmin[c])) { fmin[c] = fmin[c - 1]; fmax[c] = fmax[c - 1]; em[c] = em[c - 1]; ev[c] = ev[c - 1]; wloc[c] = wloc[c - 1]; }
  // Scale the pulse in the medium up if it is small, and say so.
  // Below a millionth, nothing is drawn: the medium has absorbed the pulse.
  let scale = 1;
  const absorbed = !log && !(mmax > 1e-6 * vmax);
  if (!log && !absorbed && (mmax < 0.4 * vmax || mmax > 1.5 * vmax)) { // (a gain medium amplifies)
    const want = (0.8 * vmax) / mmax, p = 10 ** Math.floor(Math.log10(want)), m = want / p;
    scale = (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
  }
  if (absorbed) { scale = 0; em.fill(0); fmin.fill(0); fmax.fill(0); }
  // Y: the pulse in the medium, scaled up (or down) to be seen; Yv: the vacuum pulse, never scaled.
  const Y = log ? (v) => Math.log10(Math.max(v, 1e-14) / vmax) : (v) => v * scale / vmax;
  const Yv = log ? Y : (v) => v / vmax;
  if (log) { f.y0 = -12; f.y1 = 0.5; } else { f.y0 = -1.15; f.y1 = 1.15; }
  const X = (c) => f.left + ((c + 0.5) * f.w) / cols;

  f.clip();
  ctx.strokeStyle = colors.line; ctx.lineWidth = 1;
  if (!log) { const y0 = Math.round(f.Y(0)) + 0.5; ctx.beginPath(); ctx.moveTo(f.left, y0); ctx.lineTo(f.right, y0); ctx.stroke(); }
  // The envelope of the pulse in the medium: filled, coloured by the local frequency for a Gaussian.
  if (!log && sh !== 'step') fillEnvelope(ctx, f, cols, X, em, wloc, scale, vmax, Y, !envM);
  // The vacuum pulse: its envelope, dashed.
  ctx.strokeStyle = colors.ink3; ctx.lineWidth = 1.3; ctx.setLineDash([5, 4]);
  for (const s of log ? [1] : [1, -1]) {
    ctx.beginPath(); let pen = false;
    for (let c = 0; c < cols; c++) {
      if (!(ev[c] > 0)) { pen = false; continue; }
      const y = f.Y(s * Yv(ev[c]));
      if (pen) ctx.lineTo(X(c), y); else { ctx.moveTo(X(c), y); pen = true; }
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // The field in the medium (or, on the log scale, its envelope).
  ctx.strokeStyle = colors.ink; ctx.lineWidth = log ? 1.6 : 1.1;
  ctx.beginPath();
  if (log) {
    let pen = false;
    for (let c = 0; c < cols; c++) {
      if (!(em[c] > 0)) { pen = false; continue; }
      const y = f.Y(Y(em[c]));
      if (pen) ctx.lineTo(X(c), y); else { ctx.moveTo(X(c), y); pen = true; }
    }
  } else {
    let prev = null;
    for (let c = 0; c < cols; c++) {
      if (!(fmax[c] >= fmin[c])) continue;
      const a = f.Y(Y(fmax[c])), b = f.Y(Y(fmin[c]));
      if (prev === null) ctx.moveTo(X(c), a);
      else ctx.lineTo(X(c), prev > a ? a : b);
      ctx.lineTo(X(c), b < a ? a : b); ctx.lineTo(X(c), a);
      prev = b;
    }
  }
  ctx.stroke();
  // Markers: when light through vacuum arrives, the group-velocity prediction, the front, Brillouin.
  const tc = d.tc, ms = tr.ms;
  lastPulse = { ...ms, z, scale, absorbed };
  const at = (tt) => tt * tS;
  vline(ctx, f, at(-tc), colors.accent, [2, 3], 'light through vacuum');
  if (at(-tc) < f.x0) {
    ctx.save(); ctx.fillStyle = colors.accent; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const { dec, w } = timeSlot();
    fillSlots(ctx, ['← light through vacuum arrived ', { v: tc * tS, dec, w }, `${U().tu ? ' ' + U().tu : ''} earlier`], f.left + 4, f.top + 20); ctx.restore();
  }
  if (Number.isFinite(ms.predicted) && z > 0 && sh !== 'step') vline(ctx, f, at(ms.predicted), colors.ng, [6, 3], 'group velocity says', 'bottom');
  if (sh === 'step' && z > 0) {
    vline(ctx, f, at(ms.brillouin), colors.im, [6, 3], 'n(0) z/c', 'bottom', 1);
    if (Number.isFinite(ms.predicted) && ms.predicted > 0) vline(ctx, f, at(ms.predicted), colors.ng, [6, 3], 'z/v_g', 'bottom');
  }
  // Now, while the pulse runs.
  const now = anim.t - z - tc;
  if (state.playing && now > lo && now < hi) vline(ctx, f, at(now), colors.ink2, [1, 2], 'now', 'top', 1);
  ctx.restore();
  f.axes({ xlabel: state.pulse.frame === 'group' ? `${U().t} − z/v_g (moving with the pulse)` : `${U().t} − z/c (after light through vacuum would arrive)`, colors, yTicks: log, ylabel: log ? 'log₁₀ |E|' : '' });
  const zz = zSlot();
  const narrow = width < 640;
  const items = [{ title: ['At the detector, z = ', { v: z * U().zS, dec: zz.dec, w: zz.w }, U().zu ? ' ' + U().zu : ''] },
    { label: log ? 'log₁₀ |E|' : scale !== 1 ? [narrow ? 'E ×' : 'E, enlarged ', { text: fmt(scale), w: 4 }, narrow ? '' : '×'] : 'E', color: colors.ink, width: 1.5 },
    { label: narrow ? 'vacuum' : 'the same pulse in vacuum', color: colors.ink3, dash: [5, 4], width: 1.3 }];
  legendParts(ctx, f, items);
  if (absorbed && z > 0) {
    ctx.save(); ctx.font = '13px system-ui, sans-serif'; ctx.fillStyle = colors.warn; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('absorbed: less than a millionth of the field gets this far', f.left + f.w / 2, f.Y(0) - 8); ctx.restore();
  }
  if (!log && sh === 'gauss' && f.w > 620) {
    ctx.save(); ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = colors.ink3; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText('colour: the local frequency, redder or bluer than ω_c', f.right - 4, f.top + 4); ctx.restore();
  }
}

/** A legend whose first item is a title made of parts (with a live number in a fixed slot). */
function legendParts(ctx, f, items) {
  ctx.save();
  ctx.font = '600 12px system-ui, sans-serif'; ctx.fillStyle = colors.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const w = fillSlots(ctx, items[0].title, f.left + 4, 10);
  ctx.restore();
  legend(ctx, f, items.slice(1), f.left + 4 + w + 14, 4);
}

/** The envelope of a pulse as a filled band, coloured by its local frequency (or grey). */
function fillEnvelope(ctx, f, cols, X, em, wloc, scale, vmax, Y, colour) {
  const w0 = state.pulse.w0, dW = (2 * Math.LN2) / state.pulse.T;
  // One path per colour (the local frequency in 33 steps), so the fill style changes rarely.
  const paths = new Map();
  for (let c = 0; c < cols; c++) {
    if (em[c] * scale < 0.004 * vmax) continue;
    let key = -1;
    if (colour && Number.isFinite(wloc[c])) key = Math.round(16 * (1 + clamp((wloc[c] - w0) / (1.5 * dW), -1, 1)));
    if (!paths.has(key)) paths.set(key, new Path2D());
    const yTop = f.Y(Y(em[c])), yBot = f.Y(-Y(em[c]));
    paths.get(key).rect(X(c) - 0.5, yTop, 1.2, yBot - yTop);
  }
  for (const [key, path] of paths) {
    if (key < 0) ctx.fillStyle = colors.spec;
    else { const u = key / 16 - 1, hue = u < 0 ? 75 * (1 + u) : 75 + 155 * u; ctx.fillStyle = `hsla(${hue.toFixed(0)}, 80%, 50%, 0.32)`; }
    ctx.fill(path);
  }
}

// ------------------------------------------------------- the pulse in space, at time t

/**
 * The stretch of depth the picture in space shows at time t: the medium from its surface to a
 * little past the detector, with room in front for the incident pulse (fixed); or, moving with
 * the pulse (in the frame t − z/v_g, for a Gaussian that goes forwards), a window about it.
 */
function snapWindow(t = anim.t) {
  const P = state.pulse, L = P.z, ng = cache.ng0;
  if (P.frame === 'group' && P.shape === 'gauss' && ng > 0.3) {
    const len = P.T / ng, st = traceCache?.ms?.stretch ?? 1, W = Math.max(10 * len * Math.sqrt(Math.max(1, st)), 12 * (2 * Math.PI) / P.w0);
    const zc = t < 0 ? t : Math.min(t / ng, L);
    return { moving: true, z0: zc - W / 2, z1: zc + W / 2, W };
  }
  const a = P.shape === 'step' ? Math.max(0.3 * L, 6 / P.w0) : Math.max(0.2 * L, 2.2 * P.T, P.shape === 'front' ? -1.3 * P.tf : 0);
  return { moving: false, z0: -a, z1: L + 0.06 * (L + a) };
}

/** The run of the pulse view's clock: from the incident pulse coming into the picture to the end
 *  of the detector's time axis (or the vacuum pulse leaving the picture). */
function pulseRun() {
  ensurePropagator();
  const P = state.pulse, L = P.z, sh = P.shape, [lo, hi] = P.view, shift = L + frameShift(L);
  const lead = sh === 'gauss' ? 1.8 * P.T : sh === 'front' ? -P.tf : 0, tail = sh === 'gauss' || sh === 'front' ? 1.8 * P.T : 0;
  const w = snapWindow(0);
  if (w.moving) { const ng = cache.ng0; return [-w.W / 2 - lead, ng * L + w.W / 2]; }
  return [Math.min(w.z0 - lead, lo + shift), Math.max(hi + shift, w.z1 + tail)];
}

const snapCanvas = $('#snap');
function drawSnapshot() {
  const { ctx, width, height } = fitCanvas(snapCanvas);
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 50, right: 14, top: 24, bottom: 34 });
  const P = ensurePropagator(), Pp = state.pulse, sh = Pp.shape, L = Pp.z, t = anim.t, zS = U().zS, win = snapWindow(t);
  f.x0 = win.z0 * zS; f.x1 = win.z1 * zS; f.y0 = -1.15; f.y1 = 1.15;
  const cols = Math.max(60, Math.round(f.w)), carrierPx = (2 * Math.PI / Pp.w0) / ((win.z1 - win.z0) / cols);
  // Samples per column: enough to catch every crest when they are close together (a Gaussian's
  // few frequencies are cheap); one for a sharp front or a switch-on, which have them all.
  const spc = sh === 'gauss' ? clamp(Math.ceil(8 / carrierPx), 1, 4) : 1, M = cols * spc, dz = (win.z1 - win.z0) / M;
  const re = new Float64Array(M), im = new Float64Array(M), wl = new Float64Array(M).fill(NaN), vac = new Float64Array(M);
  let first = M;
  for (let j = 0; j < M; j++) {
    const z = win.z0 + (j + 0.5) * dz, [ar, ai] = P.incidentAt(t - z);
    vac[j] = Math.hypot(ar, ai);
    if (z < 0) { re[j] = ar; im[j] = ai; wl[j] = sh === 'gauss' && vac[j] > 1e-4 ? Pp.w0 : NaN; } else if (first === M) first = j;
  }
  if (first < M) {
    const s = P.snapshot(t, win.z0 + (first + 0.5) * dz, dz, M - first, sh === 'gauss' ? 0 : 6 * state.wmax + 3 * Pp.w0);
    re.set(s.re, first); im.set(s.im, first); wl.set(s.w, first);
  }
  // Per column: the extremes of E, the envelope, the local frequency at the envelope's top.
  const fmin = new Float64Array(cols).fill(Infinity), fmax = new Float64Array(cols).fill(-Infinity);
  const em = new Float64Array(cols), ev = new Float64Array(cols), wc = new Float64Array(cols).fill(NaN);
  for (let j = 0; j < M; j++) {
    const c = Math.floor(j / spc), v = re[j], a = Math.hypot(re[j], im[j]);
    if (v < fmin[c]) fmin[c] = v;
    if (v > fmax[c]) fmax[c] = v;
    if (a > em[c]) { em[c] = a; wc[c] = wl[j]; }
    if (vac[j] > ev[c]) ev[c] = vac[j];
  }
  const X = (c) => f.left + ((c + 0.5) * f.w) / cols, Y = (v) => v;
  f.clip();
  // The medium, tinted, and the detector.
  const xs = Math.max(f.left, f.X(0));
  ctx.fillStyle = colors.spec; ctx.globalAlpha = 0.7; ctx.fillRect(xs, f.top, f.right - xs, f.h); ctx.globalAlpha = 1;
  ctx.strokeStyle = colors.line; ctx.lineWidth = 1;
  const y0 = Math.round(f.Y(0)) + 0.5; ctx.beginPath(); ctx.moveTo(f.left, y0); ctx.lineTo(f.right, y0); ctx.stroke();
  if (sh !== 'step') fillEnvelope(ctx, f, cols, X, em, wc, 1, 1, Y, sh === 'gauss');
  // The same pulse with no medium: its envelope, dashed.
  ctx.strokeStyle = colors.ink3; ctx.lineWidth = 1.3; ctx.setLineDash([5, 4]);
  for (const sgn of [1, -1]) {
    ctx.beginPath(); let pen = false;
    for (let c = 0; c < cols; c++) { if (!(ev[c] > 1e-3)) { pen = false; continue; } const y = f.Y(sgn * ev[c]); pen ? ctx.lineTo(X(c), y) : ctx.moveTo(X(c), y); pen = true; }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // The field.
  ctx.strokeStyle = colors.ink; ctx.lineWidth = 1.2; ctx.beginPath();
  let prev = null;
  for (let c = 0; c < cols; c++) {
    if (!(fmax[c] >= fmin[c])) continue;
    const a = f.Y(fmax[c]), b = f.Y(fmin[c]);
    if (spc === 1) { prev === null ? ctx.moveTo(X(c), a) : ctx.lineTo(X(c), a); prev = a; continue; }
    if (prev === null) ctx.moveTo(X(c), a); else ctx.lineTo(X(c), prev > a ? a : b);
    ctx.lineTo(X(c), b < a ? a : b); ctx.lineTo(X(c), a); prev = b;
  }
  ctx.stroke();
  // A crest, riding at c/n, and the peak of the envelope, at c/n_g (a Gaussian going forwards).
  const ng = cache.ng0, op = optics(resp, Float64Array.of(Pp.w0)), n = op.n[0];
  const envAt = (z) => { const c = Math.floor(((z - win.z0) / (win.z1 - win.z0)) * cols); return c >= 0 && c < cols ? em[c] : 0; };
  if (sh === 'gauss' && n > 0.05 && Number.isFinite(ng)) {
    const zg = t < 0 ? t : t / ng, half = 0.75 * Pp.T / Math.max(ng, 1), lam = (2 * Math.PI) / Pp.w0;
    // Crest m crosses z = 0 at t_m = m λ0/c, then goes at c/n.
    const zOf = (m) => { const tm = m * lam, dt = t - tm; return dt < 0 ? dt : dt / n; };
    const fwd = 1 / n > 1 / Math.max(ng, 1e-9) || ng < 0; // crests outrun the envelope
    let m = anim.crest;
    const out = (zz) => (fwd ? zz > zg + half : zz < zg - half);
    if (m === null || out(zOf(m)) || Math.abs(zOf(m) - zg) > 3 * half) {
      // A new crest, at the back of the pulse (or the front, if the crests fall behind).
      const target = fwd ? zg - half : zg + half, tm = t - (target >= 0 ? target * n : target);
      m = Math.round(tm / lam); anim.crest = m;
    }
    const zp = zOf(m), e = envAt(zp);
    if (zp > win.z0 && zp < win.z1 && e > 0.05) {
      ctx.fillStyle = colors.charge; ctx.strokeStyle = colors.panel; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(f.X(zp * zS), f.Y(e), 5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    }
    if (ng > 0 && zg > win.z0 && zg < win.z1) {
      const x = f.X(zg * zS), y = f.Y(Math.max(envAt(zg), 0.1)) - 6;
      ctx.fillStyle = colors.ng; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 6, y - 9); ctx.lineTo(x + 6, y - 9); ctx.closePath(); ctx.fill();
    }
  }
  const xd = f.X(L * zS);
  ctx.restore();
  ctx.save(); ctx.strokeStyle = colors.accent; ctx.lineWidth = 2; ctx.setLineDash([6, 3]);
  if (xd >= f.left && xd <= f.right) { ctx.beginPath(); ctx.moveTo(xd + 0.5, f.top); ctx.lineTo(xd + 0.5, f.bottom); ctx.stroke(); }
  ctx.setLineDash([]); ctx.fillStyle = colors.accent; ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'top';
  if (xd >= f.left && xd <= f.right) { ctx.textAlign = xd > f.right - 60 ? 'right' : 'left'; ctx.fillText('detector', xd > f.right - 60 ? xd - 4 : xd + 4, f.top + 4); }
  const xm = f.X(0);
  if (xm > f.left + 4 && xm < f.right - 40) {
    ctx.lineWidth = 3; ctx.strokeStyle = colors.panel; ctx.lineJoin = 'round'; ctx.fillStyle = colors.ink2;
    for (const [txt, x, al] of [['medium →', xm + 5, 'left'], ['← vacuum', xm - 5, 'right']]) { ctx.textAlign = al; ctx.strokeText(txt, x, f.bottom - 15); ctx.fillText(txt, x, f.bottom - 15); }
  }
  ctx.restore();
  f.axes({ xlabel: win.moving ? `${U().z}: the picture moves with the pulse` : `${U().z}, depth in the medium`, colors, yTicks: false });
  const narrow = width < 640;
  const items = [{ title: 'Inside, at one moment' }, ...(narrow ? [] : [{ label: 'E', color: colors.ink, width: 1.5 }]), { label: narrow ? 'vacuum' : 'in vacuum', color: colors.ink3, dash: [5, 4], width: 1.3 }];
  if (sh === 'gauss') items.push({ label: narrow ? 'crest' : 'a crest: c/n', color: colors.charge, mark: true }, { label: narrow ? 'peak' : 'the peak: c/n_g', color: colors.ng, mark: true });
  legend(ctx, f, items, f.left + 4, 4);
}

/** If the pulse at the detector has left the time axis, fit it again. */
let checkTimer = 0;
function checkView() {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(() => {
    if (state.view !== 'pulse' || state.pulse.shape === 'step') return;
    const d = pulseAt(state.pulse.z), [lo, hi] = state.pulse.view;
    const pk = peakTime(d.t, d.mr, d.mi), pv = peakTime(d.t, d.vr, d.vi);
    let inside = 0, all = 0;
    for (let n = 0; n < d.t.length; n++) { const e = d.mr[n] ** 2 + d.mi[n] ** 2; all += e; if (d.t[n] >= lo && d.t[n] <= hi) inside += e; }
    // (In the frame moving with the pulse, the vacuum pulse is meant to be out of view.)
    const vacOut = state.pulse.frame !== 'group' && (pv.t < lo || pv.t > hi);
    if (pk.t < lo || pk.t > hi || vacOut || inside < 0.97 * all) fitView();
  }, 300);
}

/** Choose the time axis: everything of the pulse at the detector, and the vacuum pulse. */
function fitView() {
  const sh = state.pulse.shape, p = pulseParams(), zmax = state.pulse.z, P = state.pulse;
  ensurePropagator();
  const ng = cache.ng0;
  if (sh === 'step') {
    const n0 = optics(resp, Float64Array.of(1e-6 * state.wmax)).n[0];
    const L = Math.max(zmax * (n0 - 1) * 1.6, Number.isFinite(ng) && ng > 1 ? zmax * (ng - 1) * 1.4 : 0, 30 / p.w0);
    P.frame = 'vac'; frameSeg.value = 'vac';
    P.view = [-0.05 * L, L];
  } else {
    const tg = P.frame === 'group' || !Number.isFinite(ng) ? 0 : zmax * (ng - 1);
    let view = [Math.min(sh === 'front' ? p.tf : -1.6 * p.T, tg) - 3 * p.T, Math.max(1.6 * p.T, tg) + 3 * p.T];
    for (let attempt = 0; attempt < 5; attempt++) {
      P.view = view; propKey = '';
      const d = pulseAt(zmax);
      let top = 0;
      for (let n = 0; n < d.N; n++) top = Math.max(top, d.mr[n] * d.mr[n] + d.mi[n] * d.mi[n]);
      let a = Infinity, b = -Infinity;
      for (let n = 0; n < d.N; n++) if (d.mr[n] * d.mr[n] + d.mi[n] * d.mi[n] > 4e-6 * top) { a = Math.min(a, d.t[n]); b = Math.max(b, d.t[n]); }
      if (!(b > a)) { a = view[0]; b = view[1]; } // (nothing came through)
      const w = d.t[d.N - 1] - d.t[0];
      const lo = Math.min(a, sh === 'front' ? p.tf : -1.6 * p.T, P.frame === 'group' ? -1.6 * p.T : 0), hi = Math.max(b, 1.6 * p.T);
      const touches = a < d.t[0] + 0.03 * w || b > d.t[d.N - 1] - 0.03 * w;
      const pad = 0.06 * (hi - lo);
      view = [lo - pad, hi + pad];
      if (!touches) break;
      view = [view[0] - (view[1] - view[0]), view[1] + (view[1] - view[0])];
    }
    P.view = view;
  }
  propKey = '';
  restartRun();
  dirty(); scheduleHash();
}

/** Back to the pulse's run, a quarter of the way in (so that a new set-up opens with the pulse in
 *  the picture; the repeats start from the beginning, the pulse coming in). */
function restartRun() { ensurePropagator(); const [t0, t1] = pulseRun(); anim.t = t0 + 0.25 * (t1 - t0); anim.hold = 0; anim.crest = null; }

// ---------------------------------------------------------------------- read-outs

// Every number in a slot of its own, a fixed number of characters wide, with decimals fixed for
// the quantity (from the scale of the medium, the distance or the time axis), so that the words
// keep their places, and the lines their breaks, while the numbers change: only a change of words
// moves anything.  (The widths stay the same when a scale changes and the decimals with it.)
/** Decimals for about sig figures in numbers up to scale, in a slot w characters wide. */
function slotFor(scale, sig, w) {
  const ints = Math.max(1, Math.floor(Math.log10(Math.max(scale, 1e-12))) + 1);
  return { dec: Math.max(0, Math.min(5, sig - ints)), w };
}
const timeSlot = () => { const v = state.pulse.view; return slotFor(Math.max(Math.abs(v[0]), Math.abs(v[1])) * U().tS, 4, 6); };
const zSlot = () => slotFor(2 * Math.max(state.pulse.z, 1e-9) * U().zS, 4, 6);
/** Frequencies to about four figures over the plotted range (three decimals from 1 to 100). */
const wSlot = () => { const W = state.wmax; return { dec: W < 1 ? 4 : W < 100 ? 3 : W < 1000 ? 2 : 1, w: 6 }; };
/** The sum rule's numbers, (π/2) ω_p², scale as the square of the range. */
const sumSlot = () => slotFor(state.wmax ** 2, 5, 7);
const sub = (t) => ({ html: `<sub>${t}</sub>` });
const num = (v, dec, w, extra = {}) => ({ v, dec, w, ...extra });
const bold = (p) => ({ ...p, class: 'b' });

function readout() {
  const box = $('#readout'), u = U(), lines = [];
  const tt = (t) => [bold(num(t * u.tS, timeSlot().dec, timeSlot().w)), u.tu ? ' ' + u.tu : ''];
  const ws = wSlot(), wName = u.w.split(' ')[0];
  if (state.view === 'medium') {
    const w = state.probe, o = optics(resp, Float64Array.of(Math.max(w, 1e-9)));
    // (Beyond ten thousand wavelengths the fading says more about the Lorentzian's tails than about
    // the material: glass absorbs far less than its lines' tails would.)
    const fade = 1 / (Math.max(o.k[0], 1e-300) * Math.max(w, 1e-9)), lam = (2 * Math.PI) / Math.max(w, 1e-9);
    const line = [`The light at ${wName} = `, bold(num(w, ws.dec, ws.w)), ': n = ', bold(num(o.n[0], 3, 6)), ', κ = ', bold(num(o.k[0], 3, 6, { tiny: true })),
      ...(fade < 1e4 * lam ? [' · inside, the crests go at c/n and the wave fades by 1/e in c/κω = ', ...lengthParts(fade)] : [' · inside, the crests go at c/n, and the wave hardly fades (over 10⁴ wavelengths)'])];
    lines.push(line);
    const lns = media().lines && state.units === MEDIA[state.medium].units ? media().lines : [];
    if (lns.length) {
      const ol = optics(resp, Float64Array.from(lns, (l) => l[0]));
      lines.push(lns.flatMap((l, i) => [...(i ? [' · '] : []), `n at ${l[1]} = `, bold(num(ol.n[i], 4, 7))]));
    }
    if (state.showSum) {
      const sr = sumRule(), S = sumSlot();
      const l2 = ['Sum rule: ∫', sub('0'), { html: '<sup>∞</sup>' }, ' ω ε″ dω = (π/2) × ', bold(num(sr.integral / (Math.PI / 2), S.dec, S.w))];
      if (sr.wp2 !== null) l2.push(', and Σ ω', sub('p'), { html: '<sup>2</sup>' }, ' of the lines = ', num(sr.wp2, S.dec, S.w));
      lines.push(l2);
    }
  }
  if (state.view === 'kk') {
    const a = cache.acausal || { before: 0, after: 1 }, frac = a.after > 0 ? a.before / a.after : 0;
    const causal = frac < 0.01;
    const shown = frac === 0 ? '0' : frac < 1e-3 ? frac.toExponential(1).replace('e-', 'e−').replace('e+', 'e') : `${(frac * 100).toFixed(1)}%`;
    lines.push(['Before the kick, χ(t) is at most ', bold({ text: shown, w: 6 }), ' of its size after it: ',
      causal ? 'causal.' : { html: '<span class="warn">not causal: the medium responds before it is kicked.</span>' }]);
    const sl = sliver();
    if (sl) lines.push(['The sliver at ω′ = ', bold(num(sl.w, ws.dec, ws.w)), ' (Im χ = ', num(sl.h, 3, 6), '): ',
      state.broken ? 'alone, it rings before the kick as much as after.' : 'its share of Re χ is + below ω′, − above; with it, its ring starts at the kick.']);
    const sr = sumRule(), S = sumSlot();
    lines.push(['Sum rule: ∫', sub('0'), { html: '<sup>∞</sup>' }, ' ω Im χ dω = (π/2) × ', num(sr.integral / (Math.PI / 2), S.dec, S.w), ' = (π/2) ω', sub('p'), { html: '<sup>2</sup>' }]);
    // Lines narrower than the grid cannot survive being drawn on.
    const dw = kkGrid().dw, thin = state.source === 'osc' ? state.oscs.filter((o) => o.w0 > 0 && o.wp > 0 && o.g < 2 * dw) : [];
    if (thin.length) lines.push({ cls: 'warn', parts: [`${thin.length === 1 ? 'A line is' : 'Some lines are'} narrower than the grid (γ < 2Δω = `, num(2 * dw, 3, 6, { tiny: true }), `): drawing would lose ${thin.length === 1 ? 'it' : 'them'}.`] });
  }
  if (state.view === 'pulse') {
    const tr = trace(), L = tr.ms, sh = state.pulse.shape, w = state.pulse.w0, o = optics(resp, Float64Array.of(w));
    lines.push(['Carrier ω', sub('c'), ' = ', bold(num(w, ws.dec, ws.w)), ': crests at c/n = ', bold(num(1 / o.n[0], 3, 6)), ' c, the envelope at c/n', sub('g'), ' = ', bold(num(1 / L.ng, 3, 6)), ' c',
      ' (n = ', num(o.n[0], 3, 6), ', n', sub('g'), ' = ', num(L.ng, 3, 6), ', κ = ', num(o.k[0], 3, 6, { tiny: true }), ')']);
    const zz = zSlot(), at = ['At z = ', bold(num(state.pulse.z * u.zS, zz.dec, zz.w)), u.zu ? ' ' + u.zu : ''];
    const absorbed = lastPulse && lastPulse.absorbed && state.pulse.z > 0;
    if (absorbed) lines.push([...at, ': ', { html: '<span class="warn">the pulse is absorbed</span>' }]);
    else if (sh !== 'step') {
      lines.push([...at, ' the peak comes ', ...tt(Math.abs(L.peakVac)), L.peakVac < 0 ? ' before' : ' after', ' light through vacuum would; z/v', sub('g'), ' − z/c = ', ...tt(L.predictedVac),
        ' · ', num(100 * L.height, 0, 3), '% as high, ', num(L.stretch, 2, 5), '× as long']);
    } else {
      lines.push([...at, ': the first wiggles at z/c; the slow swing near n(0)z/c, ', ...tt(L.brillouin), ' later; the group delay would be ', ...tt(L.predictedVac)]);
    }
    if (sh !== 'gauss') {
      const before = L.before > 0 ? L.before.toExponential(1).replace('e-', 'e−').replace('e+', 'e') : '0';
      lines.push([`Before the front arrives (t < ${sh === 'front' ? 't_f + ' : ''}z/c), the field is at most `, bold({ text: before, w: 7 }), ' of its peak.']);
    } else if (o.k[0] > 0.5 * o.n[0] && o.k[0] > 0.05) lines.push({ cls: 'warn', parts: ['κ is as big as n at the carrier: the wave hardly travels (it is evanescent or strongly absorbed), and the group velocity means little here.'] });
    else if (L.ng < 1) lines.push({ cls: 'warn', parts: ['n', sub('g'), ` ${L.ng < 0 ? '< 0: the peak inside moves backwards' : '< 1: the peak goes faster than c'} (the front never does).`] });
  }
  // One line of its own for each; a line's words and slots are made again only when they change.
  const all = lines.map((l) => (Array.isArray(l) ? { cls: '', parts: l } : l));
  if (box.children.length !== all.length) box.replaceChildren(...all.map(() => el('div')));
  all.forEach((l, i) => { const d = box.children[i]; if (d.className !== l.cls) d.className = l.cls; setSlots(d, l.parts); });
}

/** A distance in simulation units, with a sensible SI prefix when the medium has real units: parts
 *  for setSlots, the number in a slot of fixed width. */
function lengthParts(z) {
  if (!(z < 1e30)) return [{ text: '∞', w: 6 }];
  const metres = { eV: 1.97327e-7, MHz: 47.7135, THz: 4.77135e-5 }[state.units];
  if (!metres) return [num(z, 2, 8, { tiny: true })];
  const m = z * metres;
  for (const [f, u] of [[1e3, 'km'], [1, 'm'], [1e-3, 'mm'], [1e-6, 'μm'], [1e-9, 'nm']]) if (m >= f || u === 'nm') return [num(m / f, 2, 7, { tiny: true }), ` ${u}`];
  return [num(m, 2, 7), ' m'];
}

function sumRule() {
  if (cache.sum) return cache.sum;
  let integral, wp2 = null;
  if (state.source === 'osc') { integral = sumRuleOscillators(state.oscs); wp2 = state.oscs.reduce((s, o) => s + strength(o), 0); }
  else if (state.source === 'drawn' && drawn) integral = sumRuleGrid(drawn.grid, drawn.im);
  else { const g = kkGrid(), s = sampleOnGrid(resp, g); integral = sumRuleGrid(g, s.im); }
  cache.sum = { integral, wp2 };
  return cache.sum;
}

// ----------------------------------------------------------------------- the loop

let raf = 0, lastT = 0, needDraw = true;
function dirty() { needDraw = true; kick(); }
function kick() { if (!raf) raf = requestAnimationFrame(loop); }

/** Move the clocks on by dt seconds of the page's time (the tests call this through __app.step). */
function advance(dt) {
  if (state.view === 'medium') {
    anim.phase += (2 * Math.PI * dt) / PERIOD;
    if (state.sweep) sweepStep(dt);
  }
  if (state.view === 'pulse' && state.playing) {
    const [t0, t1] = pulseRun();
    if (anim.hold > 0) { anim.hold -= dt; if (anim.hold <= 0) { anim.t = t0; anim.crest = null; } }
    else {
      anim.t = Math.max(anim.t, t0) + ((t1 - t0) * dt) / RUN;
      if (anim.t >= t1) { anim.t = t1; anim.hold = 1.2; }
    }
  }
}

/** The light's frequency sweeping across the plotted range, slowing down near each line. */
function sweepStep(dt) {
  const W = state.wmax, lo = 0.2 * W, hi = 0.9 * W;
  let slow = 1;
  if (state.source === 'osc') for (const o of state.oscs) { const g = Math.max(o.g, 0.02 * W), c = o.w0 > 0 ? o.w0 : o.wp; slow += 5 / (1 + ((state.probe - c) / (1.5 * g)) ** 2); }
  let w = state.probe + (anim.sweepDir * (hi - lo) * dt) / (9 * slow);
  if (w > hi) { w = hi; anim.sweepDir = -1; }
  if (w < lo) { w = lo; anim.sweepDir = 1; }
  state.probe = w; probeSlider.value = w;
}

function loop(now) {
  raf = 0;
  const dtReal = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0;
  lastT = now;
  const animating = !document.hidden && (state.view === 'medium' || (state.view === 'pulse' && state.playing));
  if (animating && !testHold) advance(dtReal);
  if (needDraw || (state.view === 'medium' && state.sweep)) { needDraw = false; drawNow(); }
  else if (animating) { readColors(); if (state.view === 'medium') drawPictures(); else { drawSnapshot(); drawPulse(); } }
  if (animating) raf = requestAnimationFrame(loop); else lastT = 0;
}
let testHold = false; // (set by the tests, which move the clocks themselves)

function drawNow() {
  readColors();
  if (state.view === 'medium') { drawResponse(); drawPictures(); drawReflectance(); }
  else if (state.view === 'pulse') { drawResponse(); drawSnapshot(); drawPulse(); }
  else drawKK();
  readout();
}

// ---------------------------------------------------------------------- controls

const viewSeg = segmented([
  { value: 'medium', label: '1 · Medium' }, { value: 'kk', label: '2 · Kramers–Kronig' }, { value: 'pulse', label: '3 · Pulses' },
], state.view, (v) => setView(v), { label: 'View' });
$('#view-row').append(viewSeg);

function setView(v) {
  state.view = v; viewSeg.value = v;
  $('#main').dataset.view = v;
  ngToggle.hidden = v !== 'pulse'; sumToggle.hidden = v !== 'medium';
  if (v === 'pulse') { $('#play').textContent = state.playing ? 'Pause' : 'Play'; ensurePropagator(); if (anim.t < -1e8) restartRun(); }
  dirty(); scheduleHash();
}

// Media.
const mediaButtons = {};
for (const [id, m] of Object.entries(MEDIA)) {
  const b = el('button', { type: 'button', 'aria-pressed': 'false', onclick: () => {
    const w0 = state.wmax;
    loadMedium(id);
    // The pulse keeps its place relative to the plotted range of frequencies.
    const k = state.wmax / w0, P = state.pulse;
    if (k !== 1) { P.w0 *= k; P.T /= k; P.tf /= k; P.z /= k; syncPulseSliders(); }
    rebuild();
    if (state.view === 'pulse') fitView();
  } }, m.label);
  $('#media').append(b);
  mediaButtons[id] = b;
}

function loadMedium(id, { keepUnits = false } = {}) {
  const m = MEDIA[id];
  state.medium = id;
  if (!keepUnits) { state.units = m.units; state.wmax = m.wmax; }
  state.epsInf = m.epsInf ?? 1;
  state.oscs = m.oscs.map(toOsc);
  state.sel = 0;
  state.probe = m.probe ?? 0.4 * state.wmax;
  state.sliver = state.oscs.find((o) => o.w0 > 0 && o.w0 < state.wmax)?.w0 ?? 0.5 * state.wmax;
  drawn = null;
  setSource('osc', false);
  for (const [k, b] of Object.entries(mediaButtons)) b.setAttribute('aria-pressed', String(k === id));
  state.yRange = null;
  rebuildOscUI(); syncRangeSliders(); syncPulseSliders();
  propKey = '';
}

// Source: oscillators, a typed χ, or drawn.
$('#back-row').append(el('button', { type: 'button', title: 'Forget the drawing and go back to the oscillators', onclick: () => setSource('osc') }, 'Back to the oscillators'));
const sourceSeg = segmented([{ value: 'osc', label: 'Oscillators' }, { value: 'typed', label: 'Typed χ(ω)' }], 'osc',
  (v) => setSource(v), { label: 'Medium made of' });
$('#source-row').append(sourceSeg);

function setSource(v, fire = true) {
  state.source = v;
  sourceSeg.value = v === 'drawn' ? null : v;
  $('#osc-box').hidden = v !== 'osc';
  $('#typed-box').hidden = v !== 'typed';
  const note = $('#source-note');
  note.textContent = '';
  $('#back-row').hidden = v !== 'drawn';
  if (v === 'drawn') note.textContent = 'Drawn by hand, in the Kramers–Kronig view.';
  else if (v === 'osc') note.textContent = U().note;
  if (fire) rebuild();
}

// The oscillators: chips to pick one, its sliders, add and remove.
let oscSliders = null;
function rebuildOscUI() {
  const chips = $('#osc-chips');
  chips.textContent = '';
  state.oscs.forEach((o, j) => {
    const b = el('button', { type: 'button', 'aria-pressed': String(j === state.sel), title: o.w0 === 0 ? 'Free electrons' : `Line ${j + 1}`, onclick: () => selectOsc(j) },
      el('span', { class: 'swatch', style: o.w0 === 0 ? { background: 'var(--re)' } : {} }), o.w0 === 0 ? 'free' : String(j + 1));
    chips.append(b);
  });
  chips.append(
    el('button', { type: 'button', title: 'Add a resonance (bound charges)', onclick: () => addOsc(false) }, '+ line'),
    el('button', { type: 'button', title: 'Add free electrons (a Drude term)', onclick: () => addOsc(true) }, '+ free'),
    el('button', { type: 'button', title: 'Remove the selected one', disabled: state.oscs.length === 0, onclick: removeOsc }, 'remove'),
  );
  const box = $('#osc-sliders');
  box.textContent = '';
  oscSliders = null;
  const o = state.oscs[state.sel];
  if (!o) return;
  const W = state.wmax, set = (k) => (v) => { const q = state.oscs[state.sel]; if (q) { q[k] = v; rebuild(); } };
  oscSliders = {
    // (Each track covers the present value: glass has lines 1e-4 wide and far above the plot.)
    w0: slider({ label: '<math><msub><mi>ω</mi><mn>0</mn></msub></math>', labelHTML: true, min: 0.01 * W, max: Math.max(W, o.w0), value: o.w0, title: 'The resonance: the natural frequency of the charge on its spring', onInput: set('w0') }),
    g: slider({ label: '<math><mi>γ</mi></math>', labelHTML: true, min: Math.min(1e-4 * W, Math.max(o.g, 1e-9)), max: Math.max(W, o.g), log: true, value: Math.max(o.g, 1e-9), title: 'The damping rate: the width of the line', onInput: set('g') }),
    wp: slider({ label: '<math><msub><mi>ω</mi><mi>p</mi></msub></math>', labelHTML: true, min: 0, max: Math.max(1.5 * W, 1.2 * o.wp), value: o.wp, title: 'Its strength: ω_p² = N q²/ε₀m for these charges (times their oscillator strength f)', onInput: set('wp') }),
  };
  oscSliders.w0.hidden = o.w0 === 0;
  box.append(oscSliders.w0, oscSliders.g, oscSliders.wp);
}
function syncOscSliders() {
  const o = state.oscs[state.sel];
  if (!o || !oscSliders) return;
  oscSliders.w0.value = o.w0; oscSliders.g.value = o.g; oscSliders.wp.value = o.wp;
}
function selectOsc(j) {
  if (j === state.sel) return;
  state.sel = j;
  rebuildOscUI();
  dirty();
}
function addOsc(free) {
  if (state.oscs.length >= 8) return;
  const W = state.wmax;
  if (free) state.oscs.push({ w0: 0, g: 0.02 * W, wp: 0.5 * W });
  else state.oscs.push({ w0: state.view === 'medium' ? state.probe : 0.6 * W, g: 0.05 * W, wp: 0.15 * W });
  state.sel = state.oscs.length - 1;
  rebuildOscUI(); rebuild();
}
function removeOsc() {
  if (!state.oscs.length) return;
  state.oscs.splice(state.sel, 1);
  state.sel = Math.max(0, Math.min(state.sel, state.oscs.length - 1));
  rebuildOscUI(); rebuild();
}

// A typed χ(ω).
const chiField = exprField({
  label: '<math><mi>χ</mi><mo>(</mo><mi>ω</mi><mo>)</mo><mo>=</mo></math>', value: TYPED.lorentz.src, params: TYPED.lorentz.params,
  variables: ['w', 'omega'], hints: TYPED_HINTS,
  onChange: (expr, params) => { typedExpr = expr; typedParams = params; if (state.source === 'typed') rebuild(); },
});
typedExpr = chiField.expr; typedParams = chiField.params;
const typedHint = el('div', { class: 'small muted' });
typedHint.innerHTML = `Type w for ω and i for √−1.  Fields go as ${texToMathML('e^{-i\\omega t}')}, so a causal χ has its poles below the real axis.`;
$('#chi-field').append(chiField, typedHint);
for (const [id, t] of Object.entries(TYPED)) {
  $('#typed-presets').append(el('button', { type: 'button', onclick: () => setTyped(id) }, t.label));
}
function setTyped(id) {
  const t = TYPED[id];
  chiField.set(t.src, t.params, false);
  typedExpr = chiField.expr; typedParams = chiField.params;
  setSource('typed');
}

// Background and range.
const epsInfSlider = slider({ label: 'ε∞', min: 1, max: 10, value: 1, title: 'The response of charges whose resonances lie far above the plotted range: instantaneous here', onInput: (v) => { state.epsInf = v; rebuild(); } });
const wmaxSlider = slider({ label: 'ω range', min: 0.5, max: 100, log: true, value: 4, title: 'The highest frequency plotted', onInput: (v) => setRange(v) });
$('#range-box').append(epsInfSlider, wmaxSlider);
function syncRangeSliders() {
  epsInfSlider.value = state.epsInf; wmaxSlider.setRange(MEDIA[state.medium]?.wmax / 5 || 0.5, (MEDIA[state.medium]?.wmax || 20) * 5); wmaxSlider.value = state.wmax;
  probeSlider.setRange(0.002 * state.wmax, state.wmax); probeSlider.value = state.probe;
  // The light's frequency by the medium's own name for it (ħω in eV, f in MHz, ν in THz).
  probeSlider.querySelector('label').innerHTML = `<math>${{ au: '<mi>ω</mi>', eV: '<mi>ħ</mi><mi>ω</mi>', MHz: '<mi>f</mi>', THz: '<mi>ν</mi>' }[state.units]}</math>`;
}
function setRange(v) {
  state.wmax = v;
  if (drawn) {
    // Resample the drawing onto the new grid.
    const g = kkGrid(), r = gridResponse(drawn.grid, drawn.re, drawn.im, 0), s = r.chi(g.w);
    s.im[g.N / 2] = 0;
    // A δ(ω) at ω = 0 keeps its weight: one sample of height weight/dω.
    s.re[0] = s.re[1] + ((drawn.re[0] - drawn.re[1]) * drawn.grid.dw) / g.dw;
    drawn = { ...drawn, grid: g, re: s.re, im: s.im };
  }
  state.probe = Math.min(state.probe, v);
  rebuildOscUI(); syncRangeSliders(); propKey = ''; rebuild();
}

// The light (medium view).
const probeSlider = slider({ label: '<math><mi>ω</mi></math>', labelHTML: true, min: 0.008, max: 4, value: state.probe, title: 'The frequency of the light (or drag it on the plot)', onInput: (v) => { stopSweep(); setProbe(v, { fromSlider: true }); } });
const sweepToggle = toggle('Sweep', state.sweep, (on) => { state.sweep = on; dirty(); }, 'Let the light’s frequency sweep slowly to and fro across the plot');
$('#light-box').append(probeSlider);
$('#light-row').append(sweepToggle);

// Kramers–Kronig controls.
const breakToggle = toggle('Break causality', state.broken, (on) => {
  state.broken = on;
  if (!on) applyKK();
  rebuild();
}, 'Let one side be drawn without the other following');
const sliverToggle = toggle('One sliver', state.showSliver, (on) => { state.showSliver = on; dirty(); scheduleHash(); }, 'Show one sliver of the absorption, its share of Re χ and its ring in time');
$('#kk-row').append(breakToggle, sliverToggle,
  el('button', { type: 'button', title: 'Start from nothing: χ = 0', onclick: () => { toDrawn(); drawn.re.fill(0); drawn.im.fill(0); rebuild(); } }, 'Clear'),
  el('button', { type: 'button', title: 'Smooth the drawing a little (both sides)', onclick: smoothDrawn }, 'Smooth'));
function smoothDrawn() {
  if (!drawn) return;
  for (const [arr, sign] of [[drawn.im, -1], [drawn.re, 1]]) {
    const N = arr.length, half = N / 2, src = Float64Array.from(arr), kmax = Math.ceil((1.2 * state.wmax) / drawn.grid.dw);
    for (let k = 1; k < Math.min(half, kmax); k++) {
      let s = 0, wsum = 0;
      for (let j = -6; j <= 6; j++) { const w = Math.exp(-(j * j) / 8), q = k + j, v = q >= 0 ? src[q] : sign * src[-q]; s += w * v; wsum += w; }
      arr[k] = s / wsum; arr[N - k] = sign * arr[k];
    }
  }
  if (!state.broken) applyKK();
  rebuild();
}

// Pulse controls.
$('#play').addEventListener('click', () => { state.playing = !state.playing; $('#play').textContent = state.playing ? 'Pause' : 'Play'; kick(); dirty(); });
$('#fit').addEventListener('click', fitView);
const shapeSeg = segmented([
  { value: 'gauss', label: 'Gaussian', title: 'A smooth Gaussian pulse' },
  { value: 'front', label: 'Cut front', title: 'The same Gaussian with nothing before a sharp front' },
  { value: 'step', label: 'Switched on', title: 'A carrier switched on suddenly at t = 0 (Sommerfeld and Brillouin)' },
], state.pulse.shape, (v) => { state.pulse.shape = v; syncPulseSliders(); propKey = ''; fitView(); }, { label: 'Pulse shape' });
$('#shape-row').append(shapeSeg);
const w0Slider = slider({ label: '<math><msub><mi>ω</mi><mi>c</mi></msub></math>', labelHTML: true, min: 0.02, max: 4, value: 1, title: 'The carrier frequency (or drag the carrier on the plot)', onInput: (v) => { state.pulse.w0 = v; pulseChanged(); } });
const TSlider = slider({ label: 'T', min: 1, max: 100, log: true, value: 20, title: 'The duration: full width at half maximum of |E|²', onInput: (v) => { state.pulse.T = v / U().tS; pulseChanged(); } });
const tfSlider = slider({ label: 'front', min: -100, max: 0, value: -12, title: 'When the cut front passes z = 0 (the Gaussian peaks at 0)', onInput: (v) => { state.pulse.tf = v / U().tS; pulseChanged(); } });
const zSlider = slider({ label: 'z', min: 0, max: 200, value: 120, title: 'How deep in the medium the detector is', onInput: (v) => { state.pulse.z = v / U().zS; pulseChanged(); } });
$('#pulse-box').append(w0Slider, TSlider, tfSlider, zSlider);
const frameSeg = segmented([
  { value: 'vac', label: 't − z/c', title: 'Time after a flash of light through vacuum would arrive' },
  { value: 'group', label: 't − z/v_g', title: 'Moving with the group velocity at the carrier' },
], state.pulse.frame, (v) => { state.pulse.frame = v; propKey = ''; fitView(); }, { label: 'Time axis' });
// (Moving with the pulse only makes sense for a Gaussian: a front travels at c, and would be left
// behind, out of the computing window.)
function syncFrame() {
  if (state.pulse.shape !== 'gauss') state.pulse.frame = 'vac';
  frameSeg.value = state.pulse.frame;
  frameSeg.querySelectorAll('button')[1].disabled = state.pulse.shape !== 'gauss';
}
const logToggle = toggle('log |E|', state.pulse.log, (on) => { state.pulse.log = on; dirty(); scheduleHash(); }, 'Show the envelope at the detector on a logarithmic scale: how small is the field before the front?');
$('#frame-row').append(frameSeg, logToggle);

let zRangeBase = 200;
function syncPulseSliders() {
  const P = state.pulse, u = U(), W = state.wmax;
  w0Slider.setRange(0.02 * W, W); w0Slider.value = P.w0;
  TSlider.setRange((4 * Math.PI / W) * u.tS, (4000 * Math.PI / W) * u.tS); TSlider.value = P.T * u.tS;
  tfSlider.setRange(-2 * P.T * u.tS, 0); tfSlider.value = P.tf * u.tS;
  zSlider.setRange(0, Math.max(zRangeBase, P.z) * u.zS); zSlider.value = P.z * u.zS;
  TSlider.hidden = P.shape === 'step';
  tfSlider.hidden = P.shape !== 'front';
  shapeSeg.value = P.shape; syncFrame(); logToggle.on = P.log;
  zSlider.querySelector('label').textContent = u.zu ? `z (${u.zu})` : 'z';
  TSlider.querySelector('label').textContent = u.tu ? `T (${u.tu})` : 'T';
  tfSlider.querySelector('label').textContent = u.tu ? `front (${u.tu})` : 'front';
}
function pulseChanged() { cache.ng0 = undefined; traceCache = null; anim.crest = null; dirty(); scheduleHash(); if (!drag) checkView(); }

// Show.
const displaySeg = segmented([{ value: 'n', label: 'n, κ' }, { value: 'eps', label: 'ε′, ε″' }], state.display,
  (v) => { state.display = v; state.yRange = null; dirty(); scheduleHash(); }, { label: 'Plot' });
const ngToggle = toggle('n_g', state.showNg, (on) => { state.showNg = on; dirty(); scheduleHash(); }, 'The group index n_g = n + ω dn/dω (in the pulse view)');
const sumToggle = toggle('Sum rule', state.showSum, (on) => { state.showSum = on; dirty(); scheduleHash(); }, 'The f-sum rule: ∫ ω ε″ dω = (π/2) ω_p², in the read-out');
$('#shows').append(displaySeg, ngToggle, sumToggle);

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ' && state.view === 'pulse') { e.preventDefault(); $('#play').click(); }
});
window.addEventListener('resize', dirty);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', dirty);
document.addEventListener('visibilitychange', () => { lastT = 0; kick(); });

// ------------------------------------------------------------------- the address

let hashTimer = 0;
function scheduleHash() { clearTimeout(hashTimer); hashTimer = setTimeout(saveHash, 300); }
const r4 = (v) => +(+v).toPrecision(4);

function saveHash() {
  const P = state.pulse, m = MEDIA[state.medium];
  const custom = JSON.stringify(state.oscs.map((o) => [o.w0, o.g, o.wp].map(r4))) !== JSON.stringify(m.oscs.map((o) => o.map(r4)));
  const h = {
    v: state.view, m: state.medium,
    o: custom ? state.oscs.map((o) => [o.w0, o.g, o.wp].map(r4).join('_')).join('~') : undefined,
    e: state.epsInf !== (m?.epsInf ?? 1) ? r4(state.epsInf) : undefined,
    W: state.wmax !== m?.wmax ? r4(state.wmax) : undefined,
    d: state.display, ng: state.showNg ? undefined : 0, sum: state.showSum ? 1 : undefined,
    w: r4(state.probe), sl: state.showSliver ? r4(state.sliver) : 'off',
    src: state.source === 'typed' ? 'typed' : undefined,
    x: state.source === 'typed' ? chiField.source : undefined,
    xp: state.source === 'typed' ? Object.entries(chiField.params).map(([k, v]) => `${k}:${r4(v)}`).join(',') : undefined,
    br: state.broken ? 1 : undefined,
    ps: P.shape, pw: r4(P.w0), pT: r4(P.T), ptf: P.shape === 'front' ? r4(P.tf) : undefined, pz: r4(P.z),
    pf: P.frame === 'group' ? 'group' : undefined, lg: P.log ? 1 : undefined,
    tv: r4(state.tView),
    pv: P.view.map(r4).join('_'),
  };
  writeHash(h);
}

function loadHash(h) {
  const num = (s, d) => (s !== undefined && Number.isFinite(+s) ? +s : d);
  const id = MEDIA[h.m] ? h.m : 'one';
  loadMedium(id);
  if (h.o !== undefined) {
    state.oscs = h.o.split('~').map((s) => s.split('_').map(Number)).filter((a) => a.length === 3 && a.every(Number.isFinite)).map(toOsc);
  }
  state.epsInf = num(h.e, state.epsInf);
  state.wmax = num(h.W, state.wmax);
  if (['eps', 'n'].includes(h.d)) state.display = h.d;
  state.showNg = h.ng !== '0';
  state.showSum = h.sum === '1';
  state.broken = h.br === '1';
  state.probe = num(h.w, state.probe);
  if (h.sl === 'off') state.showSliver = false; else { state.showSliver = true; state.sliver = num(h.sl, state.sliver); }
  state.sweep = false;
  const P = state.pulse;
  if (['gauss', 'front', 'step'].includes(h.ps)) P.shape = h.ps;
  // (pz was the largest depth of the old animation; it is now where the detector is.)
  P.w0 = num(h.pw, P.w0); P.T = num(h.pT, P.T); P.tf = num(h.ptf, P.tf); P.z = num(h.pz, P.z);
  P.frame = h.pf === 'group' ? 'group' : 'vac'; P.log = h.lg === '1';
  zRangeBase = 2 * P.z;
  state.tView = num(h.tv, state.tView);
  const pv = (h.pv || '').split('_').map(Number);
  if (pv.length === 2 && pv.every(Number.isFinite) && pv[1] > pv[0]) P.view = pv;
  if (h.src === 'typed' && h.x) {
    const params = {};
    for (const kv of (h.xp || '').split(',')) { const [k, v] = kv.split(':'); if (k && Number.isFinite(+v)) params[k] = +v; }
    chiField.set(h.x, params, false);
    typedExpr = chiField.expr; typedParams = chiField.params;
    if (typedExpr) setSource('typed', false);
  }
  finishSetup(['medium', 'kk', 'pulse'].includes(h.v) ? h.v : 'medium', { fit: !h.pv });
}

// ----------------------------------------------------------------------- set-ups

/** Load a medium and a view; everything else back to its default unless given. */
function setup(opts) {
  const o = { medium: 'one', view: 'medium', display: 'n', showNg: true, showSum: false, broken: false, sweep: false, tView: null,
    showSliver: true, pulse: {}, playing: true, ...opts };
  loadMedium(o.medium);
  if (o.oscs) state.oscs = o.oscs.map(toOsc);
  if (o.wmax) state.wmax = o.wmax;
  if (o.yRange) state.yRange = o.yRange;
  if (o.probe !== undefined) state.probe = o.probe;
  if (o.sliver !== undefined) state.sliver = o.sliver;
  if (o.sel !== undefined) state.sel = o.sel;
  state.display = o.display; state.showNg = o.showNg; state.showSum = o.showSum; state.broken = o.broken;
  state.sweep = o.sweep; state.showSliver = o.showSliver; anim.sweepDir = 1;
  const P = state.pulse;
  Object.assign(P, { shape: 'gauss', w0: 1, T: 20, tf: -12, z: 120, frame: 'vac', log: false }, o.pulse);
  zRangeBase = 2 * P.z;
  state.playing = o.playing;
  state.tView = o.tView ?? autoTView();
  finishSetup(o.view, { fit: !o.pulse.view });
  return o;
}

function finishSetup(view, { fit = true } = {}) {
  breakToggle.on = state.broken; sliverToggle.on = state.showSliver; sweepToggle.on = state.sweep;
  displaySeg.value = state.display; ngToggle.on = state.showNg; sumToggle.on = state.showSum;
  rebuildOscUI(); syncRangeSliders(); syncPulseSliders();
  $('#play').textContent = state.playing ? 'Pause' : 'Play';
  propKey = '';
  rebuild();
  if (fit) fitView(); else restartRun();
  setView(view);
}

/** A time range for χ(t): a few decay times of the slowest line, a few periods of the lowest. */
function autoTView() {
  let t = 0;
  for (const o of state.oscs) {
    if (strength(o) === 0) continue;
    if (o.w0 === 0) t = Math.max(t, 4 / Math.max(o.g, 1e-3 * state.wmax));
    else t = Math.max(t, Math.min(8 / Math.max(o.g, 1e-6), 30 * 2 * Math.PI / o.w0), 6 * 2 * Math.PI / o.w0);
  }
  return Math.min(t || 30 * 2 * Math.PI / state.wmax, (0.25 * 2 * Math.PI) / kkGrid().dw);
}

const drawBox = () => {
  const g = drawn.grid, N = g.N;
  drawn.re.fill(0); drawn.im.fill(0);
  for (let k = Math.round(1.5 / g.dw); k <= Math.round(2.5 / g.dw); k++) { drawn.im[k] = 0.5; drawn.im[N - k] = -0.5; }
};
const setups = {
  // The medium: one charge, one wave.
  one: () => setup({ medium: 'one', view: 'medium', sweep: true }),
  wave: () => setup({ medium: 'one', view: 'medium', probe: 1.6 }),
  metal: () => setup({ medium: 'sodium', view: 'medium', probe: 3 }),
  ionosphere: () => setup({ medium: 'ionosphere', view: 'medium', probe: 1.0 }),
  glass: () => setup({ medium: 'glass', view: 'medium', probe: 2.2545, yRange: [-0.1, 3] }),
  reststrahlen: () => setup({ medium: 'nacl', view: 'medium', display: 'eps', probe: 6.2 }),
  sumrule: () => setup({ medium: 'one', view: 'medium', display: 'eps', showSum: true, probe: 3 }),
  // Kramers–Kronig.
  sliver: () => setup({ medium: 'one', view: 'kk', sliver: 2.0, tView: 40 }),
  draw: () => {
    setup({ medium: 'one', view: 'kk', display: 'eps', tView: 40, sliver: 2.2 });
    toDrawn(); drawBox();
    state.lastDrawn = 'im'; applyKK(); rebuild();
  },
  acausal: () => {
    setup({ medium: 'one', view: 'kk', display: 'eps', broken: true, tView: 40, sliver: 2.0 });
    toDrawn();
    drawn.re.fill(0); state.lastDrawn = 'im'; rebuild();
  },
  typed: () => { setup({ medium: 'one', view: 'kk', display: 'eps', tView: 40, showSliver: false }); setTyped('lorentz'); },
  // Pulses.
  delay: () => setup({ medium: 'one', oscs: [[2, 0.1, 1]], view: 'pulse', pulse: { w0: 1, T: 20, z: 120 } }),
  spread: () => setup({ medium: 'glass', view: 'pulse', wmax: 4,
    pulse: { w0: 1.55, T: 10 / 0.658212, z: 5 / 1.97327e-4, frame: 'group' } }),
  superluminal: () => setup({ medium: 'weak', view: 'pulse', pulse: { w0: 2, T: 40, z: 10 } }),
  front: () => setup({ medium: 'weak', view: 'pulse', pulse: { shape: 'front', w0: 2, T: 40, tf: -24, z: 10 } }),
  precursors: () => setup({ medium: 'brillouin', view: 'pulse', pulse: { shape: 'step', w0: 2.5, z: 10 } }),
};
drawer($('#help'), $('#help-button'), setups);

// ------------------------------------------------------------------------- start

function fromAddress() {
  const hash = readHash();
  if (setups[hash.setup]) setups[hash.setup]();
  else if (hash.m || hash.v) loadHash(hash);
  else setups.one();
}
fromAddress();
// (The page rewrites its own address with history.replaceState, which fires no hashchange.)
window.addEventListener('hashchange', fromAddress);

window.__app = {
  state, setups, anim, ready: true,
  response: () => resp,
  drawn: () => drawn,
  pulse: () => lastPulse,
  pulseAt: (z) => measure(pulseAt(z), z),
  chiT: (ts) => Array.from(chiTAt(Float64Array.from(ts))),
  /** The largest |E| of the vacuum pulse inside the time axis at distance z. */
  vacuumInView(z) {
    const d = pulseAt(z), [lo, hi] = state.pulse.view;
    let m = 0;
    for (let n = 0; n < d.N; n++) if (d.t[n] >= lo && d.t[n] <= hi) m = Math.max(m, Math.hypot(d.vr[n], d.vi[n]));
    return m;
  },
  /** The field at depth z (in the frame shown) between times lo and hi, every step-th sample:
   *  {t, E, env} (env: the running maximum of |E| over the last period, as drawn for a front). */
  fieldAt(z, lo = -Infinity, hi = Infinity, step = 1) {
    const d = pulseAt(z), win = Math.max(1, Math.round((2 * Math.PI) / (state.pulse.w0 * d.P.dt))), env = causalEnvelope(d.mr, win);
    const out = { t: [], E: [], env: [] };
    for (let n = 0; n < d.N; n += step) if (d.t[n] >= lo && d.t[n] <= hi) { out.t.push(d.t[n]); out.E.push(d.mr[n]); out.env.push(env[n]); }
    return out;
  },
  acausal: () => acausalFraction(),
  sumRule: () => sumRule(),
  rebuild: () => rebuild(),
  handles: () => handles.map((h) => ({ ...h })),
  ng: (w) => ngAt(w),
  optics: (w) => { const o = optics(resp, Float64Array.of(w)); return { n: o.n[0], k: o.k[0], R: o.R[0], er: o.er[0], ei: o.ei[0] }; },
  charge: (w = state.probe) => { const c = chargeAt(w); return { amp: c.amp, lag: c.lag * DEG, free: c.free }; },
  sliver: () => sliver(),
  /** The sliver's share of Re χ at the frequencies ws, and its ring at the times ts. */
  sliverShare(ws, ts = []) {
    const sl = sliver();
    if (!sl) return null;
    return { re: Array.from(sliverRe(sl.a, sl.b, sl.h, Float64Array.from(ws))), t: Array.from(sliverTime(sl.a, sl.b, sl.h, Float64Array.from(ts), !state.broken)) };
  },
  /** The picture in space at time t: the depth of the envelope's peak, its height, and where the
   *  window is. */
  snapshotPeak(t) {
    const P = ensurePropagator(), win = snapWindow(t), M = 1600, dz = (win.z1 - win.z0) / M;
    const z0 = Math.max(0, win.z0), s = P.snapshot(t, z0, dz, Math.ceil((win.z1 - z0) / dz));
    let j = 0;
    for (let i = 0; i < s.re.length; i++) if (s.re[i] ** 2 + s.im[i] ** 2 > s.re[j] ** 2 + s.im[j] ** 2) j = i;
    return { z: z0 + j * dz, height: Math.hypot(s.re[j], s.im[j]), w: s.w[j], window: [win.z0, win.z1] };
  },
  run: () => pulseRun(),
  /** Hold the clocks (the tests move them with step) or let them run again. */
  hold(on = true) { testHold = on; lastT = 0; kick(); },
  /** Move the clocks on by dt seconds, n times, drawing each frame. */
  step(dt = 1 / 60, n = 1) { for (let i = 0; i < n; i++) advance(dt); needDraw = false; drawNow(); return { t: anim.t, phase: anim.phase, probe: state.probe }; },
  setView, fitView,
  /** Milliseconds spent in each part of a frame, over n frames. */
  profile(n = 20) {
    const parts = { response: drawResponse, pulse: drawPulse, snapshot: drawSnapshot, reflectance: drawReflectance, pictures: drawPictures, kk: drawKK, readout };
    const out = {};
    readColors();
    const [t0r, t1r] = pulseRun();
    for (const [k, f] of Object.entries(parts)) {
      if (((k === 'pulse' || k === 'snapshot') && state.view !== 'pulse') || (k === 'kk' && state.view !== 'kk') || ((k === 'reflectance' || k === 'pictures') && state.view !== 'medium')) continue;
      const t0 = performance.now();
      for (let i = 0; i < n; i++) { anim.t = t0r + ((t1r - t0r) * (i + 1)) / n; anim.phase += 0.3; f(); }
      out[k] = +((performance.now() - t0) / n).toFixed(2);
    }
    return out;
  },
  /** Milliseconds per frame of the animation (the clock moved on, the moving pictures drawn),
   *  the best of three runs of n frames (other work on the machine only ever adds time). */
  bench(n = 10) {
    const t0s = anim.t;
    let best = Infinity;
    readColors();
    const [t0r, t1r] = pulseRun();
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        anim.t = t0r + ((t1r - t0r) * (i + 1)) / n; anim.phase += 0.3;
        if (state.view === 'pulse') { drawSnapshot(); drawPulse(); } else if (state.view === 'medium') drawPictures();
        readout();
      }
      best = Math.min(best, (performance.now() - t0) / n);
    }
    anim.t = t0s;
    return best;
  },
};
