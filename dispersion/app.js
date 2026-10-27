// Dispersion and Kramers–Kronig: a medium made of resonances, its index, absorption and
// reflectance; the Kramers–Kronig relations drawn by hand; pulses sent through it.
// The physics is in medium.js and pulse.js; this file is the page.

import {
  oscillatorResponse, gridResponse, functionResponse, optics, groupIndex, chiTimeOscillators,
  FreqGrid, kkImToRe, kkReToIm, impulseResponse, sampleOnGrid, sumRuleOscillators, sumRuleGrid, strength,
} from './medium.js';
import { incident, planGrid, Propagator, peakTime, moments, maxBefore, causalEnvelope } from './pulse.js';
import { el, $, slider, segmented, toggle, exprField, drawer, readHash, writeHash, fmt } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors } from '../lib/plot.js';
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
const MEDIA = {
  one: { label: 'One line', units: 'au', wmax: 4, oscs: [[2, 0.2, 1]] },
  weak: { label: 'Weak line', units: 'au', wmax: 4, oscs: [[2, 0.2, 0.2828]] },
  two: { label: 'Two lines', units: 'au', wmax: 4, oscs: [[1.4, 0.12, 0.6], [2.8, 0.25, 0.9]] },
  glass: { label: 'Fused silica', units: 'eV', wmax: 14, oscs: SILICA, bands: [VISIBLE],
    lines: [[1.8892, 'red (656 nm)'], [2.5506, 'blue (486 nm)']] },
  sodium: { label: 'Sodium', units: 'eV', wmax: 12, oscs: [[0, 0.02, 5.9]], bands: [VISIBLE] },
  ionosphere: { label: 'Ionosphere', units: 'MHz', wmax: 30, oscs: [[0, 0.01, 9]],
    bands: [{ lo: 0.53, hi: 1.7, label: 'AM' }, { lo: 3, hi: 30, label: 'shortwave' }] },
  nacl: { label: 'Rock salt', units: 'THz', wmax: 12, epsInf: 2.34, oscs: [[4.9, 0.1, 9.2457]] },
  brillouin: { label: 'Dense (Brillouin)', units: 'au', wmax: 10, oscs: [[4, 0.56, 4.4721]] },
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

// ------------------------------------------------------------------------- state

const toOsc = ([w0, g, wp]) => ({ w0, g, wp });
const state = {
  view: 'pulse',
  medium: 'one', units: 'au', wmax: 4, epsInf: 1,
  oscs: MEDIA.one.oscs.map(toOsc),
  source: 'osc',            // 'osc' | 'typed' | 'drawn'
  display: 'n',             // 'eps' | 'n'
  showNg: true,
  sel: 0,
  probe: null,              // ω of the probe line
  yRange: null,             // the response plot's vertical range, if zoomed by hand
  broken: false, lastDrawn: 'im',
  pulse: { shape: 'gauss', w0: 1, T: 20, tf: -12, z: 0, zmax: 200, frame: 'vac', log: false, view: [-40, 100] },
  playing: true, hold: 0,
  tView: 40,                // χ(t) is shown for |t| < tView
};
let resp = oscillatorResponse(state.oscs, state.epsInf);
let drawn = null;           // { grid, re, im, chiInf } when the medium is drawn by hand
let kkGridCache = null;
let typedExpr = null, typedParams = {};
const cache = {};           // things computed from the medium, cleared when it changes

const U = () => UNITS[state.units];
const media = () => MEDIA[state.medium] || {};

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
    ng: get('--ng', '#1f7a3a'), spec: get('--spec', 'rgba(90,100,120,0.16)') };
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
    ctx.strokeStyle = it.color; ctx.lineWidth = it.width || 2.2; ctx.setLineDash(it.dash || []);
    ctx.beginPath(); ctx.moveTo(x, y + 6); ctx.lineTo(x + 16, y + 6); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = colors.ink2; ctx.fillText(it.label, x + 21, y + 6);
    x += 30 + ctx.measureText(it.label).width;
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
  const f = new Frame(ctx, width, height, { left: 50, right: 14, top: state.view === 'pulse' ? 34 : 24, bottom: 34 });
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
  // The pulse's spectrum, and its carrier.
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
  if (state.probe !== null) vline(ctx, f, state.probe, colors.ink3, [3, 3]);
  ctx.restore();

  // Handles.
  handles = [];
  if (state.source === 'osc') drawHandles(ctx, f);
  if (state.view === 'pulse') {
    const x = f.X(state.pulse.w0);
    if (x >= f.left && x <= f.right) {
      ctx.save(); ctx.strokeStyle = colors.ink2; ctx.lineWidth = 1.2; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(x, f.top); ctx.lineTo(x, f.bottom); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = colors.panel; ctx.strokeStyle = colors.ink2; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.rect(x - 6, f.top - 13, 12, 12); ctx.fill(); ctx.stroke();
      ctx.fillStyle = colors.ink2; ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
      ctx.textAlign = x > f.right - 70 ? 'right' : 'left';
      ctx.fillText('carrier ω₀: drag', x > f.right - 70 ? x - 10 : x + 10, f.top - 7);
      ctx.restore();
      handles.push({ type: 'carrier', x, y: f.top - 7, r: 14 });
    }
  }
  f.axes({ xlabel: U().w, colors });
  const items = state.display === 'eps'
    ? [{ label: 'ε′ = Re ε', color: colors.re }, { label: 'ε″ = Im ε', color: colors.im }]
    : [{ label: 'n', color: colors.re }, { label: 'κ', color: colors.im }];
  if (ng) items.push({ label: 'n_g = c dk/dω', color: colors.ng, dash: [5, 3], width: 1.5 });
  legend(ctx, f, items, f.left + 4, 1);
  if (state.yRange) {
    ctx.save(); ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = colors.ink3; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText('zoomed (double-click for automatic)', f.right, 6); ctx.restore();
  }
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

// Dragging on the response plot.
let drag = null;
function pointerXY(e, canvas) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

respCanvas.addEventListener('pointerdown', (e) => {
  const [px, py] = pointerXY(e, respCanvas), f = respFrame;
  if (!f) return;
  const slack = e.pointerType === 'touch' ? 10 : 0;
  let best = null, bd = Infinity;
  for (const h of handles) { const d = Math.hypot(h.x - px, h.y - py); if (d < h.r + slack && d < bd) { bd = d; best = h; } }
  respCanvas.setPointerCapture(e.pointerId);
  if (best) {
    drag = { ...best, py0: py, dx: best.x - px };
    if (best.j !== undefined) selectOsc(best.j);
    frozenRange = respRange;
  } else drag = { type: 'probe' };
  moveDrag(px, py);
});
respCanvas.addEventListener('pointermove', (e) => {
  const [px, py] = pointerXY(e, respCanvas);
  if (drag) { moveDrag(px, py); return; }
  if (e.pointerType === 'mouse' && respFrame && px > respFrame.left && px < respFrame.right) { state.probe = respFrame.invX(px); dirty(); }
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
// The wheel zooms the vertical axis about the pointer; a double click goes back to automatic.
respCanvas.addEventListener('wheel', (e) => {
  if (!respFrame || !respRange) return;
  e.preventDefault();
  const [, py] = pointerXY(e, respCanvas), y0 = respFrame.invY(py), k = Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * 0.0015)));
  state.yRange = [y0 + (respRange[0] - y0) * k, y0 + (respRange[1] - y0) * k];
  dirty();
}, { passive: false });
respCanvas.addEventListener('dblclick', () => { state.yRange = null; dirty(); });
respCanvas.addEventListener('pointercancel', endDrag);

function hoverCursor(px, py) {
  const near = handles.some((h) => Math.hypot(h.x - px, h.y - py) < h.r);
  respCanvas.style.cursor = near ? 'grab' : 'crosshair';
}

function moveDrag(px, py) {
  // (A handle keeps the offset at which it was grabbed, so it does not jump to the pointer.)
  const f = respFrame, w = f.invX(px + (drag.dx || 0)), y = f.invY(py), W = state.wmax;
  if (drag.type === 'probe') { state.probe = Math.max(0, Math.min(W, w)); dirty(); return; }
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

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------- reflectance

function drawReflectance() {
  const cv = $('#refl'), { ctx, width, height } = fitCanvas(cv);
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 50, right: 14, top: 22, bottom: 34 });
  f.x0 = 0; f.x1 = state.wmax; f.y0 = 0; f.y1 = 1.05;
  const ws = columnsFor(f), { R } = optics(resp, ws);
  f.clip();
  drawBands(ctx, f);
  ctx.fillStyle = colors.refl; ctx.globalAlpha = 0.12;
  ctx.beginPath(); ctx.moveTo(f.left, f.bottom);
  for (let i = 0; i < ws.length; i++) ctx.lineTo(f.X(ws[i]), f.Y(R[i]));
  ctx.lineTo(f.right, f.bottom); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = colors.refl; ctx.lineWidth = 2.2; polyline(ctx, f, ws, R);
  if (state.probe !== null) vline(ctx, f, state.probe, colors.ink3, [3, 3]);
  ctx.restore();
  f.axes({ xlabel: U().w, colors });
  legend(ctx, f, [{ label: 'R = |(ñ − 1)/(ñ + 1)|², reflected at normal incidence', color: colors.refl }], f.left + 4, 2);
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

let kkFrames = {}, kkRange = null, kkFrozen = null;

function drawKK() {
  const fIm = setupKKFrame('#kkim'), fRe = setupKKFrame('#kkre');
  const { ws, re, im } = kkCurves(fIm.f);
  kkRange = kkFrozen || autorange([re, im], [0], skipColumns(ws.length));
  for (const [{ ctx, f }, data, color, name] of [[fIm, im, colors.im, 'Im χ (absorption): draw on it'], [fRe, re, colors.re, 'Re χ (dispersion): draw on it']]) {
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
    }
    ctx.strokeStyle = color; ctx.lineWidth = 2.2; polyline(ctx, f, ws, data);
    if (state.probe !== null) vline(ctx, f, state.probe, colors.ink3, [3, 3]);
    ctx.restore();
    f.axes({ xlabel: U().w, colors });
    legend(ctx, f, [{ label: name, color }], f.left + 4, 2);
    if (state.broken) {
      ctx.save(); ctx.fillStyle = colors.warn; ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillText('causality broken: the other side does not follow', f.right - 4, 6); ctx.restore();
    }
  }
  drawChiT();
}

function setupKKFrame(sel) {
  const cv = $(sel), { ctx, width, height } = fitCanvas(cv);
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 50, right: 14, top: 22, bottom: 32 });
  f.x0 = 0; f.x1 = state.wmax;
  kkFrames[sel] = f;
  return { ctx, f };
}

function drawChiT() {
  const cv = $('#kkt'), { ctx, width, height } = fitCanvas(cv);
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 50, right: 14, top: 22, bottom: 32 });
  const T = state.tView, n = Math.max(200, Math.round(f.w * 2));
  const ts = Float64Array.from({ length: n + 1 }, (_, i) => -T + (2 * T * i) / n);
  const c = chiTAt(ts);
  f.x0 = -T * U().tS; f.x1 = T * U().tS;
  [f.y0, f.y1] = autorange([c], [0]);
  f.clip();
  // The past: shaded.
  ctx.fillStyle = colors.spec; ctx.fillRect(f.left, f.top, f.X(0) - f.left, f.h);
  ctx.strokeStyle = colors.line; ctx.lineWidth = 1;
  const y0 = Math.round(f.Y(0)) + 0.5; ctx.beginPath(); ctx.moveTo(f.left, y0); ctx.lineTo(f.right, y0); ctx.stroke();
  ctx.strokeStyle = colors.accent; ctx.lineWidth = 2;
  polyline(ctx, f, Float64Array.from(ts, (t) => t * U().tS), c);
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
  ctx.fillText('before the kick', (f.left + f.X(0)) / 2, f.top + 4);
  ctx.restore();
  legend(ctx, f, [{ label: 'χ(t): the response to a kick at t = 0', color: colors.accent }], f.left + 4, 2);
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

// Drawing on the KK plots.
let kkDraw = null;
for (const [sel, side] of [['#kkim', 'im'], ['#kkre', 're']]) {
  const cv = $(sel);
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    toDrawn();
    kkDraw = { side, sel, last: -1, lastV: 0 };
    kkFrozen = kkRange;
    paintKK(e);
  });
  cv.addEventListener('pointermove', (e) => { if (kkDraw && kkDraw.sel === sel) paintKK(e); });
  const end = () => { if (!kkDraw) return; kkDraw = null; kkFrozen = null; rebuild(); };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
}

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

let prop = null, propKey = '', pulseMediumDirty = true, vacCache = null;

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
    propKey = key; pulseMediumDirty = true; vacCache = null;
  }
  if (pulseMediumDirty) { prop.setMedium(resp); pulseMediumDirty = false; cache.ng0 = undefined; }
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
  let vr, vi;
  if (vacCache && vacCache.tc === tc) ({ vr, vi } = vacCache);
  else { const v = P.field(z, tc, true); vr = Float64Array.from(v.re); vi = Float64Array.from(v.im); vacCache = { tc, vr, vi }; }
  return { P, tc, t: P.t, mr, mi, vr, vi, N };
}

function measure(d, z) {
  const { t, mr, mi, vr, vi, tc } = d, sh = state.pulse.shape;
  const m = moments(t, mr, mi), m0 = moments(t, vr, vi);
  // Times in the frame shown (peak, predicted) and after z/c (peakVac, predictedVac).
  const out = { energy: m.energy / m0.energy, ng: cache.ng0, predicted: z * (cache.ng0 - 1) - tc, predictedVac: z * (cache.ng0 - 1) };
  if (sh !== 'step') {
    const pk = peakTime(t, mr, mi), pv = peakTime(t, vr, vi);
    out.peak = pk.t; out.peakVac = pk.t + tc; out.height = pk.peak / pv.peak; out.stretch = m.rms / m0.rms;
  }
  if (sh !== 'gauss') {
    const front = (sh === 'front' ? state.pulse.tf : 0) - tc, margin = 12 * d.P.dt;
    let top = 0;
    for (let i = 0; i < mr.length; i++) top = Math.max(top, Math.abs(mr[i]));
    out.before = maxBefore(t, mr, front - margin) / top;
    out.front = front;
  }
  return out;
}

const pulseCanvas = $('#pulse');
let lastPulse = null;

function drawPulse() {
  const { ctx, width, height } = fitCanvas(pulseCanvas);
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 50, right: 14, top: 22, bottom: 34 });
  const z = state.pulse.z, d = pulseAt(z), sh = state.pulse.shape, tS = U().tS, log = state.pulse.log;
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
  const envM = causal ? causalEnvelope(mr, win) : null;
  let envV = null;
  if (causal) {
    if (!vacCache.env || vacCache.env.length !== vr.length || vacCache.win !== win) { vacCache.env = causalEnvelope(vr, win); vacCache.win = win; }
    envV = vacCache.env;
  }
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
  for (let n = 0; n < t.length; n++) vmax = Math.max(vmax, envV ? envV[n] : Math.sqrt(vr[n] * vr[n] + vi[n] * vi[n]));
  // A column no sample fell in borrows from the one before (only on very wide plots).
  for (let c = 1; c < cols; c++) if (!(fmax[c] >= fmin[c])) { fmin[c] = fmin[c - 1]; fmax[c] = fmax[c - 1]; em[c] = em[c - 1]; ev[c] = ev[c - 1]; wloc[c] = wloc[c - 1]; }
  // Scale the pulse in the medium up if it is small, and say so.
  // Below a millionth, nothing is drawn: the medium has absorbed the pulse.
  let scale = 1;
  const absorbed = !log && !(mmax > 1e-6 * vmax);
  if (!log && !absorbed && mmax < 0.4 * vmax) {
    const want = (0.8 * vmax) / mmax, p = 10 ** Math.floor(Math.log10(want)), m = want / p;
    scale = (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
  }
  if (absorbed) { scale = 0; em.fill(0); fmin.fill(0); fmax.fill(0); }
  const Y = log ? (v) => Math.log10(Math.max(v, 1e-14) / vmax) : (v) => v * scale / vmax;
  if (log) { f.y0 = -12; f.y1 = 0.5; } else { f.y0 = -1.15; f.y1 = 1.15; }
  const X = (c) => f.left + ((c + 0.5) * f.w) / cols;

  f.clip();
  ctx.strokeStyle = colors.line; ctx.lineWidth = 1;
  if (!log) { const y0 = Math.round(f.Y(0)) + 0.5; ctx.beginPath(); ctx.moveTo(f.left, y0); ctx.lineTo(f.right, y0); ctx.stroke(); }
  // The envelope of the pulse in the medium: filled, coloured by the local frequency for a Gaussian.
  if (!log && sh !== 'step') {
    const w0 = state.pulse.w0, dW = (2 * Math.LN2) / state.pulse.T;
    // One path per colour (the local frequency in 33 steps), so the fill style changes rarely.
    const paths = new Map();
    for (let c = 0; c < cols; c++) {
      if (em[c] * scale < 0.004 * vmax) continue;
      let key = -1;
      if (!envM && Number.isFinite(wloc[c])) key = Math.round(16 * (1 + clamp((wloc[c] - w0) / (1.5 * dW), -1, 1)));
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
  // The vacuum pulse: its envelope, dashed.
  ctx.strokeStyle = colors.ink3; ctx.lineWidth = 1.3; ctx.setLineDash([5, 4]);
  for (const s of log ? [1] : [1, -1]) {
    ctx.beginPath(); let pen = false;
    for (let c = 0; c < cols; c++) {
      if (!(ev[c] > 0)) { pen = false; continue; }
      const y = f.Y(s * Y(ev[c]));
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
  const tc = d.tc, ms = measure(d, z);
  lastPulse = { ...ms, z, scale, absorbed };
  const at = (tt) => tt * tS;
  vline(ctx, f, at(-tc), colors.accent, [2, 3], 'z/c');
  if (at(-tc) < f.x0) {
    ctx.save(); ctx.fillStyle = colors.accent; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(`← light through vacuum arrived ${fmt(tc * tS, 3)}${U().tu ? ' ' + U().tu : ''} earlier`, f.left + 4, f.top + 20); ctx.restore();
  }
  if (Number.isFinite(ms.predicted) && z > 0 && sh !== 'step') vline(ctx, f, at(ms.predicted), colors.ng, [6, 3], 'z/v_g', 'bottom');
  if (sh === 'step' && z > 0) {
    const n0 = optics(resp, Float64Array.of(1e-6 * state.wmax)).n[0];
    lastPulse.brillouin = z * (n0 - 1) - tc;
    vline(ctx, f, at(lastPulse.brillouin), colors.im, [6, 3], 'n(0) z/c', 'bottom', 1);
    if (Number.isFinite(ms.predicted) && ms.predicted > 0) vline(ctx, f, at(ms.predicted), colors.ng, [6, 3], 'z/v_g', 'bottom');
  }
  ctx.restore();
  f.axes({ xlabel: state.pulse.frame === 'group' ? `${U().t} − z/v_g (moving with the pulse)` : `${U().t} − z/c (after light through vacuum would arrive)`, colors, yTicks: log, ylabel: log ? 'log₁₀ |E|' : '' });
  const items = [{ label: log ? 'log₁₀ |E| in the medium' : 'E in the medium' + (scale !== 1 ? `  (×${fmt(scale)})` : ''), color: colors.ink, width: 1.5 },
    { label: 'the same pulse in vacuum', color: colors.ink3, dash: [5, 4], width: 1.3 }];
  legend(ctx, f, items, f.left + 4, 2);
  if (absorbed && z > 0) {
    ctx.save(); ctx.font = '13px system-ui, sans-serif'; ctx.fillStyle = colors.warn; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('absorbed: less than a millionth of the field gets this far', f.left + f.w / 2, f.Y(0) - 8); ctx.restore();
  }
  if (!log && sh === 'gauss' && f.w > 560) {
    ctx.save(); ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = colors.ink3; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText('envelope colour: local frequency (red lower, blue higher than ω₀)', f.right - 4, f.top + 4); ctx.restore();
  }
}

/** If the pulse at the largest distance has left the time axis, fit it again. */
let checkTimer = 0;
function checkView() {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(() => {
    if (state.view !== 'pulse' || state.pulse.shape === 'step') return;
    const d = pulseAt(state.pulse.zmax), [lo, hi] = state.pulse.view;
    const pk = peakTime(d.t, d.mr, d.mi), pv = peakTime(d.t, d.vr, d.vi);
    let inside = 0, all = 0;
    for (let n = 0; n < d.t.length; n++) { const e = d.mr[n] ** 2 + d.mi[n] ** 2; all += e; if (d.t[n] >= lo && d.t[n] <= hi) inside += e; }
    if (pk.t < lo || pk.t > hi || pv.t < lo || pv.t > hi || inside < 0.97 * all) fitView();
  }, 300);
}

/** Choose the time axis: everything of the pulse at the largest distance, and the vacuum pulse. */
function fitView() {
  const sh = state.pulse.shape, p = pulseParams(), zmax = state.pulse.zmax, P = state.pulse;
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
  dirty(); scheduleHash();
}

// ---------------------------------------------------------------------- read-outs

function readout() {
  const box = $('#readout'), u = U(), parts = [];
  const zz = (z) => `${fmt(z * u.zS, 4)}${u.zu ? ' ' + u.zu : ''}`, tt = (t) => `${fmt(t * u.tS, 3)}${u.tu ? ' ' + u.tu : ''}`;
  if (state.view === 'medium' || (state.view === 'pulse' && state.probe !== null)) {
    if (state.probe !== null) {
      const w = state.probe, o = optics(resp, Float64Array.of(Math.max(w, 1e-9))), ng = ngAt(w);
      const absorb = o.k[0] > 1e-12 ? ` · absorption length c/(2κω) = ${lengthStr(1 / (2 * o.k[0] * Math.max(w, 1e-9)))}` : '';
      parts.push(`At ${u.w.split(' ')[0]} = <b>${fmt(w, 4)}</b>: ε = ${fmt(o.er[0], 4)} ${o.ei[0] < 0 ? '−' : '+'} ${fmt(Math.abs(o.ei[0]), 3)}i · ñ = ${fmt(o.n[0], 4)} ${o.k[0] < 0 ? '−' : '+'} ${fmt(Math.abs(o.k[0]), 3)}i · R = ${fmt(o.R[0], 3)} · n<sub>g</sub> = ${fmt(ng, 4)}${absorb}`);
    } else parts.push('<span class="muted">Tap or point at the plot to read off ε, ñ, R and n<sub>g</sub> at one frequency.</span>');
  }
  if (state.view === 'medium') {
    const sr = sumRule(), lines = media().lines && state.units === MEDIA[state.medium].units ? media().lines : [];
    let s = `Sum rule: ∫<sub>0</sub><sup>∞</sup> ω ε″ dω = <b>${fmt(sr.integral, 4)}</b> = (π/2) × ${fmt(sr.integral / (Math.PI / 2), 4)}`;
    if (sr.wp2 !== null) s += `, and Σ ω<sub>pj</sub>² = ${fmt(sr.wp2, 4)}`;
    const zeros = epsZeros();
    if (zeros.length) s += ` · ε′ = 0 going up at ${zeros.map((w) => fmt(w, 4)).join(', ')}`;
    parts.push(s);
    if (lines.length) {
      const o = optics(resp, Float64Array.from(lines, (l) => l[0]));
      parts.push(lines.map((l, i) => `n(${l[1]}) = <b>${o.n[i].toFixed(4)}</b>`).join(' · '));
    }
  }
  if (state.view === 'kk') {
    const a = cache.acausal || { before: 0, after: 1 }, frac = a.after > 0 ? a.before / a.after : 0;
    const causal = frac < 0.01;
    parts.push(`χ(t) before the kick: largest |χ| is <b>${frac < 1e-3 ? frac.toExponential(1) : (frac * 100).toFixed(1) + '%'}</b> of that after it: ` +
      (causal ? 'causal.' : '<span class="warn">not causal: the medium responds before it is kicked.</span>'));
    const sr = sumRule();
    parts.push(`Sum rule: ∫<sub>0</sub><sup>∞</sup> ω Im χ dω = (π/2) × ${fmt(sr.integral / (Math.PI / 2), 4)}, so ω<sub>p</sub>² = ${fmt(sr.integral / (Math.PI / 2), 4)} · the medium is ${state.source === 'drawn' ? 'drawn by hand' : state.source === 'typed' ? 'typed' : 'the oscillators'}`);
    // Lines narrower than the grid cannot survive being drawn on.
    const dw = kkGrid().dw, thin = state.source === 'osc' ? state.oscs.filter((o) => o.w0 > 0 && o.wp > 0 && o.g < 2 * dw) : [];
    if (thin.length) parts.push(`<span class="warn">${thin.length === 1 ? 'A line is' : 'Some lines are'} narrower than the grid (γ < 2Δω = ${fmt(2 * dw, 2)}): drawing would lose ${thin.length === 1 ? 'it' : 'them'}.</span>`);
  }
  if (state.view === 'pulse' && lastPulse) {
    const L = lastPulse, sh = state.pulse.shape;
    let s = `z = <b>${zz(L.z)}</b> · n<sub>g</sub>(ω₀) = ${fmt(L.ng, 4)}`;
    if (L.absorbed && L.z > 0) s += ' · <span class="warn">the pulse is absorbed</span>';
    else if (sh !== 'step') {
      s += ` · after z/c, the group velocity predicts the peak at z(n<sub>g</sub> − 1)/c = <b>${tt(L.predictedVac)}</b>; it arrives at <b>${tt(L.peakVac)}</b>,` +
        ` ${fmt(L.height, 3)} as high as in vacuum, with ${fmt(L.energy * 100, 3)}% of the energy, ${fmt(L.stretch, 3)} times as long (r.m.s.)`;
    } else {
      s += ` · after z/c: the Sommerfeld precursor at once, the Brillouin precursor near n(0)z/c, <b>${tt(lastPulse.brillouin ?? 0)}</b>`;
      if (L.ng > 1) s += `, the signal near z(n<sub>g</sub> − 1)/c = <b>${tt(L.predictedVac)}</b>`;
    }
    parts.push(s);
    if (sh !== 'gauss') parts.push(`Largest field before the front arrives (t < ${sh === 'front' ? 't_f + ' : ''}z/c): <b>${L.before > 0 ? L.before.toExponential(1) : '0'}</b> of the peak.`);
    else {
      const o = optics(resp, Float64Array.of(state.pulse.w0));
      if (o.k[0] > 0.5 * o.n[0] && o.k[0] > 0.05) parts.push(`<span class="warn">At the carrier κ = ${fmt(o.k[0], 3)} and n = ${fmt(o.n[0], 3)}: the wave hardly propagates (it is evanescent or strongly absorbed), and the group velocity means nothing here.</span>`);
      else if (L.z > 0 && L.ng < 1) parts.push(`<span class="warn">n<sub>g</sub> ${L.ng < 0 ? '&lt; 0' : '&lt; 1'}: the group velocity c/n<sub>g</sub> is ${L.ng < 0 ? 'negative' : 'faster than c'}.</span>`);
    }
  }
  box.innerHTML = parts.join('<br>');
}

/** A distance in simulation units, with a sensible SI prefix when the medium has real units. */
function lengthStr(z) {
  const metres = { eV: 1.97327e-7, MHz: 47.7135, THz: 4.77135e-5 }[state.units];
  if (!metres) return fmt(z, 3);
  const m = z * metres;
  for (const [f, u] of [[1e3, 'km'], [1, 'm'], [1e-3, 'mm'], [1e-6, 'μm'], [1e-9, 'nm']]) if (m >= f || u === 'nm') return `${fmt(m / f, 3)} ${u}`;
  return `${fmt(m, 3)} m`;
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

/** Frequencies in the plotted range where ε' crosses zero going up (ω_p, ω_LO). */
function epsZeros() {
  if (cache.zeros) return cache.zeros;
  const n = 4000, ws = Float64Array.from({ length: n }, (_, i) => ((i + 1) * state.wmax) / n), { er } = optics(resp, ws), out = [];
  for (let i = 1; i < n; i++) if (er[i - 1] < 0 && er[i] >= 0) out.push(ws[i - 1] + ((ws[i] - ws[i - 1]) * -er[i - 1]) / (er[i] - er[i - 1]));
  cache.zeros = out.slice(0, 3);
  return cache.zeros;
}

// ----------------------------------------------------------------------- the loop

let raf = 0, lastT = 0, needDraw = true;
function dirty() { needDraw = true; kick(); }
function kick() { if (!raf) raf = requestAnimationFrame(loop); }

function loop(now) {
  raf = 0;
  const dtReal = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0;
  lastT = now;
  const animating = state.playing && state.view === 'pulse';
  if (animating) {
    const P = state.pulse;
    if (state.hold > 0) { state.hold -= dtReal; if (state.hold <= 0) P.z = 0; }
    else {
      P.z += (P.zmax * dtReal) / 5;
      if (P.z >= P.zmax) { P.z = P.zmax; state.hold = 1.5; }
    }
    zSlider.value = P.z * U().zS;
  }
  if (needDraw) { needDraw = false; drawNow(); }
  else if (animating) { readColors(); drawPulse(); readout(); } // only z changed
  if (animating) raf = requestAnimationFrame(loop); else lastT = 0;
}

function drawNow() {
  readColors();
  if (state.view === 'medium') { drawResponse(); drawReflectance(); }
  else if (state.view === 'pulse') { drawResponse(); drawPulse(); }
  else drawKK();
  readout();
}

// ---------------------------------------------------------------------- controls

const viewSeg = segmented([
  { value: 'medium', label: 'Medium' }, { value: 'kk', label: 'Kramers–Kronig' }, { value: 'pulse', label: 'Pulses' },
], state.view, (v) => setView(v), { label: 'View' });
$('#view-row').append(viewSeg);

function setView(v) {
  state.view = v; viewSeg.value = v;
  $('#main').dataset.view = v;
  ngToggle.hidden = v !== 'pulse';
  if (v === 'pulse') { $('#play').textContent = state.playing ? 'Pause' : 'Play'; }
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
    if (k !== 1) { P.w0 *= k; P.T /= k; P.tf /= k; P.zmax /= k; P.z /= k; syncPulseSliders(); }
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
    w0: slider({ label: '<math><msub><mi>ω</mi><mn>0</mn></msub></math>', labelHTML: true, min: 0.01 * W, max: Math.max(W, o.w0), value: o.w0, title: 'Where the line is', onInput: set('w0') }),
    g: slider({ label: '<math><mi>γ</mi></math>', labelHTML: true, min: Math.min(1e-4 * W, Math.max(o.g, 1e-9)), max: Math.max(W, o.g), log: true, value: Math.max(o.g, 1e-9), title: 'Its width (the damping rate)', onInput: set('g') }),
    wp: slider({ label: '<math><msub><mi>ω</mi><mi>p</mi></msub></math>', labelHTML: true, min: 0, max: Math.max(1.5 * W, 1.2 * o.wp), value: o.wp, title: 'Its strength: ω_p² = f ω_p(total)² = N e²/ε0 m for this kind of charge', onInput: set('wp') }),
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
  else state.oscs.push({ w0: state.probe ?? 0.6 * W, g: 0.05 * W, wp: 0.15 * W });
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
function syncRangeSliders() { epsInfSlider.value = state.epsInf; wmaxSlider.setRange(MEDIA[state.medium]?.wmax / 5 || 0.5, (MEDIA[state.medium]?.wmax || 20) * 5); wmaxSlider.value = state.wmax; }
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
  rebuildOscUI(); propKey = ''; rebuild();
}

// Kramers–Kronig controls.
const breakToggle = toggle('Break causality', state.broken, (on) => {
  state.broken = on;
  if (!on) applyKK();
  rebuild();
}, 'Let one side be drawn without the other following');
$('#kk-row').append(breakToggle,
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
$('#play').addEventListener('click', () => { state.playing = !state.playing; $('#play').textContent = state.playing ? 'Pause' : 'Play'; if (!state.playing) state.hold = 0; kick(); });
$('#fit').addEventListener('click', fitView);
const shapeSeg = segmented([
  { value: 'gauss', label: 'Gaussian', title: 'A smooth Gaussian pulse' },
  { value: 'front', label: 'Cut front', title: 'The same Gaussian with nothing before a sharp front' },
  { value: 'step', label: 'Switched on', title: 'A carrier switched on suddenly at t = 0 (Sommerfeld and Brillouin)' },
], state.pulse.shape, (v) => { state.pulse.shape = v; syncPulseSliders(); propKey = ''; fitView(); }, { label: 'Pulse shape' });
$('#shape-row').append(shapeSeg);
const w0Slider = slider({ label: '<math><msub><mi>ω</mi><mn>0</mn></msub></math>', labelHTML: true, min: 0.02, max: 4, value: 1, title: 'The carrier frequency (or drag the carrier line)', onInput: (v) => { state.pulse.w0 = v; pulseChanged(); } });
const TSlider = slider({ label: 'T', min: 1, max: 100, log: true, value: 20, title: 'The duration: full width at half maximum of |E|²', onInput: (v) => { state.pulse.T = v / U().tS; pulseChanged(); } });
const tfSlider = slider({ label: 'front', min: -100, max: 0, value: -12, title: 'When the cut front passes z = 0 (the Gaussian peaks at 0)', onInput: (v) => { state.pulse.tf = v / U().tS; pulseChanged(); } });
const zSlider = slider({ label: 'z', min: 0, max: 200, value: 0, title: 'How far the pulse has gone into the medium', onInput: (v) => { state.pulse.z = v / U().zS; state.playing = false; $('#play').textContent = 'Play'; dirty(); } });
$('#pulse-box').append(w0Slider, TSlider, tfSlider, zSlider);
const frameSeg = segmented([
  { value: 'vac', label: 't − z/c', title: 'Time after a flash of light through vacuum would arrive' },
  { value: 'group', label: 't − z/v_g', title: 'Moving with the group velocity at the carrier' },
], state.pulse.frame, (v) => { state.pulse.frame = v; propKey = ''; fitView(); }, { label: 'Time axis' });
const logToggle = toggle('log |E|', state.pulse.log, (on) => { state.pulse.log = on; dirty(); scheduleHash(); }, 'Show the envelope on a logarithmic scale: how small is the field before the front?');
$('#frame-row').append(frameSeg, logToggle);

function syncPulseSliders() {
  const P = state.pulse, u = U(), W = state.wmax;
  w0Slider.setRange(0.02 * W, W); w0Slider.value = P.w0;
  TSlider.setRange((4 * Math.PI / W) * u.tS, (4000 * Math.PI / W) * u.tS); TSlider.value = P.T * u.tS;
  tfSlider.setRange(-2 * P.T * u.tS, 0); tfSlider.value = P.tf * u.tS;
  zSlider.setRange(0, P.zmax * u.zS); zSlider.value = P.z * u.zS;
  TSlider.hidden = P.shape === 'step';
  tfSlider.hidden = P.shape !== 'front';
  shapeSeg.value = P.shape; frameSeg.value = P.frame; logToggle.on = P.log;
  zSlider.querySelector('label').textContent = u.zu ? `z (${u.zu})` : 'z';
  TSlider.querySelector('label').textContent = u.tu ? `T (${u.tu})` : 'T';
  tfSlider.querySelector('label').textContent = u.tu ? `front (${u.tu})` : 'front';
}
function pulseChanged() { cache.ng0 = undefined; dirty(); scheduleHash(); if (!drag) checkView(); }

// Show.
const displaySeg = segmented([{ value: 'eps', label: 'ε′, ε″' }, { value: 'n', label: 'n, κ' }], state.display,
  (v) => { state.display = v; state.yRange = null; dirty(); scheduleHash(); }, { label: 'Plot' });
const ngToggle = toggle('n_g', state.showNg, (on) => { state.showNg = on; dirty(); scheduleHash(); }, 'The group index n_g = n + ω dn/dω (in the pulse view)');
$('#shows').append(displaySeg, ngToggle);

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ' && state.view === 'pulse') { e.preventDefault(); $('#play').click(); }
});
window.addEventListener('resize', dirty);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', dirty);

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
    d: state.display, ng: state.showNg ? undefined : 0,
    src: state.source === 'typed' ? 'typed' : undefined,
    x: state.source === 'typed' ? chiField.source : undefined,
    xp: state.source === 'typed' ? Object.entries(chiField.params).map(([k, v]) => `${k}:${r4(v)}`).join(',') : undefined,
    br: state.broken ? 1 : undefined,
    ps: P.shape, pw: r4(P.w0), pT: r4(P.T), ptf: P.shape === 'front' ? r4(P.tf) : undefined, pz: r4(P.zmax),
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
  state.broken = h.br === '1';
  const P = state.pulse;
  if (['gauss', 'front', 'step'].includes(h.ps)) P.shape = h.ps;
  P.w0 = num(h.pw, P.w0); P.T = num(h.pT, P.T); P.tf = num(h.ptf, P.tf); P.zmax = num(h.pz, P.zmax);
  P.frame = h.pf === 'group' ? 'group' : 'vac'; P.log = h.lg === '1';
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
  finishSetup(['medium', 'kk', 'pulse'].includes(h.v) ? h.v : 'pulse', { fit: !h.pv });
}

// ----------------------------------------------------------------------- set-ups

/** Load a medium and a view; everything else back to its default unless given. */
function setup(opts) {
  const o = { medium: 'one', view: 'medium', display: 'eps', showNg: true, broken: false, probe: null, tView: null,
    pulse: {}, playing: true, ...opts };
  loadMedium(o.medium);
  if (o.oscs) state.oscs = o.oscs.map(toOsc);
  if (o.wmax) state.wmax = o.wmax;
  if (o.yRange) state.yRange = o.yRange;
  state.display = o.display; state.showNg = o.showNg; state.broken = o.broken; state.probe = o.probe;
  const P = state.pulse;
  Object.assign(P, { shape: 'gauss', w0: 1, T: 20, tf: -12, z: 0, zmax: 200, frame: 'vac', log: false }, o.pulse);
  state.playing = o.playing; state.hold = 0;
  state.tView = o.tView ?? autoTView();
  finishSetup(o.view, { fit: !o.pulse.view });
  return o;
}

function finishSetup(view, { fit = true } = {}) {
  breakToggle.on = state.broken;
  displaySeg.value = state.display; ngToggle.on = state.showNg;
  rebuildOscUI(); syncRangeSliders(); syncPulseSliders();
  $('#play').textContent = state.playing ? 'Pause' : 'Play';
  propKey = '';
  rebuild();
  if (fit) fitView();
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

const setups = {
  one: () => setup({ medium: 'one', view: 'medium', display: 'eps', probe: 1.9 }),
  delay: () => setup({ medium: 'one', oscs: [[2, 0.1, 1]], view: 'pulse', display: 'n', pulse: { w0: 1, T: 20, zmax: 120 } }),
  spread: () => setup({ medium: 'glass', view: 'pulse', display: 'n', wmax: 4,
    pulse: { w0: 1.55, T: 10 / 0.658212, zmax: 5 / 1.97327e-4, frame: 'group' } }),
  glass: () => setup({ medium: 'glass', view: 'medium', display: 'n', probe: 2.2545, yRange: [-0.1, 3] }),
  metal: () => setup({ medium: 'sodium', view: 'medium', display: 'eps', probe: 4.5 }),
  ionosphere: () => setup({ medium: 'ionosphere', view: 'medium', display: 'n', probe: 1.0 }),
  reststrahlen: () => setup({ medium: 'nacl', view: 'medium', display: 'eps', probe: 6.2 }),
  draw: () => {
    setup({ medium: 'one', view: 'kk', display: 'eps', tView: 40 });
    toDrawn();
    const g = drawn.grid, N = g.N;
    drawn.re.fill(0); drawn.im.fill(0);
    for (let k = Math.round(1.5 / g.dw); k <= Math.round(2.5 / g.dw); k++) { drawn.im[k] = 0.5; drawn.im[N - k] = -0.5; }
    state.lastDrawn = 'im'; applyKK(); rebuild();
  },
  acausal: () => {
    setup({ medium: 'one', view: 'kk', display: 'eps', broken: true, tView: 40 });
    toDrawn();
    drawn.re.fill(0); state.lastDrawn = 'im'; rebuild();
  },
  sumrule: () => setup({ medium: 'one', view: 'medium', display: 'eps', oscs: [[2, 0.2, 1]] }),
  superluminal: () => setup({ medium: 'weak', view: 'pulse', display: 'n', pulse: { w0: 2, T: 40, zmax: 10 } }),
  front: () => setup({ medium: 'weak', view: 'pulse', display: 'n', pulse: { shape: 'front', w0: 2, T: 40, tf: -24, zmax: 10 } }),
  precursors: () => setup({ medium: 'brillouin', view: 'pulse', display: 'n', pulse: { shape: 'step', w0: 2.5, zmax: 10 } }),
  typed: () => { setup({ medium: 'one', view: 'kk', display: 'eps', tView: 40 }); setTyped('lorentz'); },
};
drawer($('#help'), $('#help-button'), setups);

// ------------------------------------------------------------------------- start

function fromAddress() {
  const hash = readHash();
  if (setups[hash.setup]) setups[hash.setup]();
  else if (hash.m || hash.v) loadHash(hash);
  else setups.delay();
}
fromAddress();
// (The page rewrites its own address with history.replaceState, which fires no hashchange.)
window.addEventListener('hashchange', fromAddress);

window.__app = {
  state, setups, ready: true,
  response: () => resp,
  drawn: () => drawn,
  pulse: () => lastPulse,
  pulseAt: (z) => measure(pulseAt(z), z),
  chiT: (ts) => Array.from(chiTAt(Float64Array.from(ts))),
  acausal: () => acausalFraction(),
  sumRule: () => sumRule(),
  handles: () => handles.map((h) => ({ ...h })),
  ng: (w) => ngAt(w),
  optics: (w) => { const o = optics(resp, Float64Array.of(w)); return { n: o.n[0], k: o.k[0], R: o.R[0], er: o.er[0], ei: o.ei[0] }; },
  setView, fitView,
  /** Milliseconds spent in each part of a frame, over n frames. */
  profile(n = 20) {
    const parts = { response: drawResponse, pulse: drawPulse, reflectance: drawReflectance, kk: drawKK, readout };
    const out = {};
    readColors();
    for (const [k, f] of Object.entries(parts)) {
      if ((k === 'pulse' && state.view !== 'pulse') || (k === 'kk' && state.view !== 'kk') || (k === 'reflectance' && state.view !== 'medium')) continue;
      const t0 = performance.now();
      for (let i = 0; i < n; i++) { state.pulse.z = (state.pulse.zmax * (i + 1)) / n; f(); }
      out[k] = +((performance.now() - t0) / n).toFixed(2);
    }
    return out;
  },
  /** Milliseconds per frame of the animation (the pulse at a new z each time, and the read-out),
   *  the best of three runs of n frames (other work on the machine only ever adds time). */
  bench(n = 10) {
    const z0 = state.pulse.z;
    let best = Infinity;
    readColors();
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) { state.pulse.z = (state.pulse.zmax * (i + 1)) / n; drawPulse(); readout(); }
      best = Math.min(best, (performance.now() - t0) / n);
    }
    state.pulse.z = z0;
    return best;
  },
};
