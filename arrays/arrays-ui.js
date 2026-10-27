// The antenna-array half of the page: the waves in the plane of the elements, animated, and the
// far-field power pattern on a polar plot, with its read-outs.  Lengths in wavelengths.

import {
  K, patterns, angles, analysePattern, lineAxis, directivity, taper, steerPhases, focusPhases,
  nearField, fieldAt, extent, centroid,
} from './antenna.js';
import { colorize, colorOf } from '../lib/complexcolor.js';
import { el, $, slider, segmented, toggle, setSlots } from '../lib/ui.js';
import { fitCanvas, themeColors } from '../lib/plot.js';

const DEG = Math.PI / 180;
const G = 256;                 // the field is computed on G x G points
const TH = angles(3600);       // the pattern every 0.1 degrees
const MAXN = 64;

export const A = {
  els: [],
  layout: 'line', n: 8, d: 0.5, radius: 2, aperture: 10, seed: 1, cy: 0,
  kind: 'iso', dipAngle: 0,                    // degrees, from +x anticlockwise
  phaseMode: 'steer', theta0: 20, focus: [0, 5], sweep: false,
  taper: 'uniform', sll: 30,
  view: 16, display: 'real', bright: 0, db: true, factors: false,
  running: true, speed: 1, t: 0,
  selected: -1,
};

let onChange = () => {};
export function onArraysChange(f) { onChange = f; }

// ------------------------------------------------------------------ layouts

function rng(seed) { let s = (seed * 2654435761) % 2147483647 || 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

function makeLayout() {
  if (A.layout === 'custom') A.layout = 'line';
  const { n, d, cy } = A, els = [];
  if (A.layout === 'line') for (let i = 0; i < n; i++) els.push({ x: (i - (n - 1) / 2) * d, y: cy });
  else if (A.layout === 'circle') for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; els.push({ x: A.radius * Math.sin(a), y: cy + A.radius * Math.cos(a) }); }
  else if (A.layout === 'random') {
    // Random points in a disk, no two closer than 0.6 wavelengths.
    const R = rng(A.seed), rad = A.aperture / 2;
    for (let tries = 0; els.length < n && tries < 20000; tries++) {
      const r = rad * Math.sqrt(R()), a = 2 * Math.PI * R(), x = r * Math.cos(a), y = cy + r * Math.sin(a);
      if (els.every((e) => Math.hypot(e.x - x, e.y - y) > 0.6)) els.push({ x, y });
    }
  }
  A.els = els.map((e) => ({ x: +e.x.toFixed(4), y: +e.y.toFixed(4), amp: 1, phase: 0 }));
  A.selected = -1;
}

const elem = () => ({ kind: A.kind, angle: A.dipAngle * DEG });

/** Amplitudes from the taper, phases from the steering angle or the focus. */
function applyWeights() {
  if (A.taper !== 'manual') { const w = taper(A.els, A.taper, A.sll); A.els.forEach((e, i) => { e.amp = w[i]; }); }
  if (A.phaseMode === 'steer') { const p = steerPhases(A.els, A.theta0 * DEG); A.els.forEach((e, i) => { e.phase = p[i]; }); }
  else if (A.phaseMode === 'focus') { const p = focusPhases(A.els, ...A.focus); A.els.forEach((e, i) => { e.phase = p[i]; }); }
}

// ------------------------------------------------------------------ computing

const fre = new Float64Array(G * G), fim = new Float64Array(G * G);
let pat = null, info = null, D = 0, fieldDirty = true;
// While something is being dragged the waves are computed on half as many points each way
// (four times faster), and in full when it is let go.
let res = G;

function grid() { const h = A.view / res; return { g: res, h, x0: -A.view / 2, y0: A.view / 2 }; }

function compute() {
  applyWeights();
  pat = patterns(A.els, elem(), TH);
  const prefer = A.phaseMode === 'steer' ? A.theta0 * DEG : A.phaseMode === 'focus' ? Math.atan2(A.focus[0] - centroid(A.els)[0], A.focus[1] - centroid(A.els)[1]) : 0;
  info = A.els.length ? analysePattern(pat.total, { prefer, mirror: A.els.length > 1 ? lineAxis(A.els) : null }) : null;
  D = info && info.beam !== null ? directivity(A.els, elem(), info.beam) : 0;
  fieldDirty = true;
}

/** Something changed: recompute and redraw (once per frame). */
let pending = 0;
export function arraysChanged(hash = true) {
  if (pending) return;
  pending = requestAnimationFrame(() => {
    pending = 0;
    compute();
    drawPolar(); readouts(); syncSelected();
    kick();
    if (hash) onChange();
  });
}

// ------------------------------------------------------------------ the waves

const fieldCanvas = $('#field');
let off = null, offImg = null;
const disp = new Float64Array(G * G), dispI = new Float64Array(G * G);

// The brightness scale R (the |psi| drawn at half lightness), chosen when the field changes.
let Rfield = 1;
function chooseBrightness() {
  if (A.phaseMode === 'focus') {
    // Half lightness at half the field at the focus, so the focus stands out.
    const [a, b] = fieldAt(A.els, elem(), ...A.focus);
    Rfield = 0.5 * Math.hypot(a, b);
  } else {
    // Half lightness where the waves of all the elements, in step (the beam), are a quarter
    // of the view away: the beam stands out, sidelobes are dimmer, the elements saturate.
    const sum = A.els.reduce((a, e) => a + e.amp, 0);
    Rfield = sum / (K * A.view / 4);
  }
  if (!(Rfield > 0)) Rfield = 1;
}

let fieldRes = 0;
function drawField() {
  if (fieldDirty) { nearField(A.els, elem(), grid(), fre, fim); fieldRes = res; chooseBrightness(); fieldDirty = false; }
  const { ctx, width, height } = fitCanvas(fieldCanvas), g = fieldRes, m = g * g;
  if (!off || off.width !== g) { off = document.createElement('canvas'); off.width = off.height = g; offImg = off.getContext('2d').createImageData(g, g); }
  const w = 2 * Math.PI * A.t, c = Math.cos(w), s = Math.sin(w);
  // Intensity falls off as 1/r^2: away from a focus, show it four times brighter.
  const R = Rfield * 10 ** -A.bright * (A.display === 'intensity' && A.phaseMode !== 'focus' ? 0.5 : 1);
  const dr = disp.subarray(0, m), di = dispI.subarray(0, m);
  if (A.display === 'intensity') {
    for (let i = 0; i < m; i++) dr[i] = Math.hypot(fre[i], fim[i]);
    colorize(dr, null, offImg.data, R, 'intensity');
  } else {
    // Re[psi exp(-i w t)] (and Im for the phase colours).
    for (let i = 0; i < m; i++) { dr[i] = fre[i] * c + fim[i] * s; di[i] = fim[i] * c - fre[i] * s; }
    colorize(dr, A.display === 'complex' ? di : null, offImg.data, R, A.display === 'complex' ? 'complex' : 'real');
  }
  off.getContext('2d').putImageData(offImg, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, 0, 0, width, height);
  drawOverlay(ctx, width, height);
}

const toPx = (x, y, w) => [((x + A.view / 2) / A.view) * w, ((A.view / 2 - y) / A.view) * w];
const fromPx = (px, py, w) => [(px / w) * A.view - A.view / 2, A.view / 2 - (py / w) * A.view];

function drawOverlay(ctx, w, h) {
  const scale = w / A.view;
  ctx.save();
  ctx.font = '12px system-ui, sans-serif';
  // The far field begins about 2 D^2 / lambda from the array.
  const [cx, cy] = centroid(A.els), Dsz = extent(A.els), rf = 2 * Dsz * Dsz;
  if (A.els.length > 1 && rf * scale < w * 0.7 && rf > 1.5) {
    const [px, py] = toPx(cx, cy, w);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.setLineDash([5, 5]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(px, py, rf * scale, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText('2D²/λ', px + rf * scale * 0.71 + 4, py - rf * scale * 0.71 - 4);
  }
  // The beam's direction.
  if (info && info.beam !== null && !info.omni && A.phaseMode !== 'focus') {
    const [px, py] = toPx(cx, cy, w), L = w * 0.75;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.setLineDash([2, 6]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + L * Math.sin(info.beam), py - L * Math.cos(info.beam)); ctx.stroke();
    ctx.setLineDash([]);
  }
  // The focus.
  if (A.phaseMode === 'focus') {
    const [px, py] = toPx(...A.focus, w);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px - 10, py); ctx.lineTo(px + 10, py); ctx.moveTo(px, py - 10); ctx.lineTo(px, py + 10); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(px, py, 12, 0, 2 * Math.PI); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.fillText('focus', px + 14, py - 8);
  }
  // The elements: colour is the phase, size the amplitude.
  const amax = Math.max(1e-9, ...A.els.map((e) => e.amp));
  A.els.forEach((e, i) => {
    const [px, py] = toPx(e.x, e.y, w), r = 3 + 4 * Math.sqrt(e.amp / amax);
    if (A.kind === 'dipole') {
      const L = Math.max(7, 0.2 * scale), dx = L * Math.cos(A.dipAngle * DEG), dy = -L * Math.sin(A.dipAngle * DEG);
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#000'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(px - dx, py - dy); ctx.lineTo(px + dx, py + dy); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(px - dx, py - dy); ctx.lineTo(px + dx, py + dy); ctx.stroke();
    }
    ctx.fillStyle = `rgb(${colorOf(Math.cos(e.phase), Math.sin(e.phase), 0.6).join(',')})`;
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(px, py, r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    if (i === A.selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, r + 5, 0, 2 * Math.PI); ctx.stroke(); }
  });
  // A scale bar: one wavelength.
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(12, h - 14, scale, 3);
  ctx.fillText('λ', 12 + scale / 2 - 3, h - 19);
  ctx.restore();
}

// ------------------------------------------------------------------ pointer

let drag = null;
// Fingers need bigger targets than a mouse pointer.
let reach = 14;
function hit(px, py, w) {
  let best = -1, bd = reach;
  A.els.forEach((e, i) => { const [x, y] = toPx(e.x, e.y, w), d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = i; } });
  return best;
}
fieldCanvas.addEventListener('pointerdown', (e) => {
  const r = fieldCanvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  reach = e.pointerType === 'touch' ? 26 : 14;
  if (A.phaseMode === 'focus') {
    const [fx, fy] = toPx(...A.focus, r.width);
    if (Math.hypot(fx - px, fy - py) < reach + 2) { drag = { focus: true }; fieldCanvas.setPointerCapture(e.pointerId); return; }
  }
  const i = hit(px, py, r.width);
  A.selected = i;
  if (i >= 0) {
    const [ex, ey] = toPx(A.els[i].x, A.els[i].y, r.width);
    drag = { i, dx: ex - px, dy: ey - py };
    fieldCanvas.setPointerCapture(e.pointerId);
  } else if (A.phaseMode === 'focus') {
    // Anywhere else: move the focus there.
    A.focus = fromPx(px, py, r.width).map((v) => +v.toFixed(3));
    drag = { focus: true }; fieldCanvas.setPointerCapture(e.pointerId);
    syncFocus(); arraysChanged();
  }
  syncSelected(); kick();
});
fieldCanvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  res = G / 2;
  const r = fieldCanvas.getBoundingClientRect();
  if (drag.focus) {
    A.focus = fromPx(e.clientX - r.left, e.clientY - r.top, r.width).map((v) => +Math.max(-A.view / 2, Math.min(A.view / 2, v)).toFixed(3));
    syncFocus();
  } else {
    const [x, y] = fromPx(e.clientX - r.left + drag.dx, e.clientY - r.top + drag.dy, r.width);
    const lim = A.view / 2;
    A.els[drag.i].x = +Math.max(-lim, Math.min(lim, x)).toFixed(3);
    A.els[drag.i].y = +Math.max(-lim, Math.min(lim, y)).toFixed(3);
    markCustom();
  }
  arraysChanged();
});
const endDrag = () => { if (drag) { drag = null; res = G; fieldDirty = true; kick(); } };
fieldCanvas.addEventListener('pointerup', endDrag);
fieldCanvas.addEventListener('pointercancel', endDrag);
fieldCanvas.addEventListener('dblclick', (e) => {
  const r = fieldCanvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  if (hit(px, py, r.width) >= 0) return;
  addElement(...fromPx(px, py, r.width));
});
fieldCanvas.addEventListener('keydown', (e) => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && A.selected >= 0) { e.preventDefault(); removeSelected(); }
});

function addElement(x, y) {
  if (A.els.length >= MAXN) return;
  if (x === undefined) {
    // Next to the last one, along the line.
    const last = A.els[A.els.length - 1] || { x: 0, y: A.cy };
    x = last.x + A.d; y = last.y;
    if (Math.abs(x) > A.view / 2) { x = 0; y = A.cy + 1; }
  }
  A.els.push({ x: +x.toFixed(3), y: +y.toFixed(3), amp: 1, phase: 0 });
  A.selected = A.els.length - 1;
  markCustom(); arraysChanged();
}
function removeSelected() {
  if (A.selected < 0) A.selected = A.els.length - 1;
  if (A.selected < 0 || A.els.length <= 1) return;
  A.els.splice(A.selected, 1);
  A.selected = -1;
  markCustom(); arraysChanged();
}
function markCustom() {
  if (A.layout === 'custom') return;
  A.layout = 'custom';
  syncLayoutButtons();
}

// ------------------------------------------------------------------ the polar plot

const polarCanvas = $('#polar');
const DB_RANGE = 40;

function drawPolar() {
  const { ctx, width, height } = fitCanvas(polarCanvas), c = themeColors();
  ctx.clearRect(0, 0, width, height);
  const cx = width / 2, cy = height / 2, R = Math.min(width, height) / 2 - 26;
  ctx.save();
  ctx.font = '11px system-ui, sans-serif';
  // Rings and spokes.
  ctx.strokeStyle = c.line; ctx.fillStyle = c.ink3; ctx.lineWidth = 1;
  const rings = A.db ? [0, -10, -20, -30] : [1, 0.75, 0.5, 0.25];
  for (const v of rings) {
    const r = A.db ? R * (1 + v / DB_RANGE) : R * v;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.stroke();
    // Ring labels along the 105-degree direction, out of the way of the angles.
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(A.db ? `${v} dB` : String(v), cx + r * Math.sin(105 * DEG) + 2, cy - r * Math.cos(105 * DEG) + 1);
  }
  for (let a = 0; a < 360; a += 30) {
    const t = a * DEG;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + R * Math.sin(t), cy - R * Math.cos(t)); ctx.stroke();
    const lab = a > 180 ? a - 360 : a;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`${lab}°`, cx + (R + 14) * Math.sin(t), cy - (R + 13) * Math.cos(t));
  }
  if (!pat || !A.els.length) { ctx.restore(); return; }
  const pmax = Math.max(...pat.total) || 1;
  const rad = (P, ref) => {
    if (A.db) { const v = 10 * Math.log10(P / ref + 1e-30); return R * Math.max(0, 1 + v / DB_RANGE); }
    return (R * P) / ref;
  };
  const curve = (arr, ref) => {
    ctx.beginPath();
    for (let i = 0; i <= TH.length; i++) {
      const k = i % TH.length, r = rad(arr[k], ref), t = TH[k];
      const x = cx + r * Math.sin(t), y = cy - r * Math.cos(t);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  };
  if (A.factors) {
    // The two factors, each scaled to its own maximum.
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c.ink2; ctx.setLineDash([6, 4]);
    curve(pat.af, Math.max(...pat.af) || 1); ctx.stroke();
    if (A.kind === 'dipole') { ctx.strokeStyle = c.warn; ctx.setLineDash([2, 3]); curve(pat.ef, 1); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  curve(pat.total, pmax);
  ctx.fillStyle = c.accent; ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = c.accent; ctx.lineWidth = 2; ctx.stroke();
  // Where a uniform line's grating lobes should be: sin(theta) = sin(theta0) + m lambda / d.
  if (A.layout === 'line' && A.phaseMode === 'steer' && A.n > 1) {
    const s0 = Math.sin(A.theta0 * DEG), axis = lineAxis(A.els) ?? Math.PI / 2;
    ctx.fillStyle = c.warn;
    for (let m = -6; m <= 6; m++) {
      const s = s0 + m / A.d;
      if (m === 0 || Math.abs(s) > 1) continue;
      for (const t of [Math.asin(s), Math.PI - Math.asin(s)]) {
        const tt = t + axis - Math.PI / 2;
        const x = cx + (R + 2) * Math.sin(tt), y = cy - (R + 2) * Math.cos(tt);
        ctx.save(); ctx.translate(x, y); ctx.rotate(tt);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-5, -9); ctx.lineTo(5, -9); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
  }
  // The beam and its half-power width.
  if (info && info.beam !== null && !info.omni && A.phaseMode !== 'focus') {
    ctx.strokeStyle = c.ink; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + R * Math.sin(info.beam), cy - R * Math.cos(info.beam)); ctx.stroke();
    if (info.sll !== null) {
      const r = rad(10 ** (info.sll / 10) * pmax, pmax), t = info.sllAngle;
      ctx.fillStyle = c.warn;
      ctx.beginPath(); ctx.arc(cx + r * Math.sin(t), cy - r * Math.cos(t), 4, 0, 2 * Math.PI); ctx.fill();
    }
  }
  if (A.factors) {
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = c.accent; ctx.fillText('— the pattern', 6, 6);
    ctx.fillStyle = c.ink2; ctx.fillText('- - array factor', 6, 22);
    if (A.kind === 'dipole') { ctx.fillStyle = c.warn; ctx.fillText('··· one element', 6, 38); }
  }
  ctx.restore();
}

// ------------------------------------------------------------------ read-outs

// Each number in the read-outs has a slot of its own, a fixed number of characters wide with
// fixed decimals (directions and widths to a tenth of a degree, levels to a tenth of a dB), so that
// nothing moves as the beam sweeps or the array changes (setSlots).
const deg = (r) => [{ v: r / DEG, dec: 1, w: 6 }, '°'];
const dB = (v) => [{ v, dec: 1, w: 5 }, '\u00a0dB'];
function readouts() {
  const box = $('#readouts'), rows = [];
  const add = (k, parts, cls = '') => rows.push([k, parts, cls]);
  if (!info || !A.els.length) { box.replaceChildren(); box._rows = ''; return; }
  if (A.phaseMode === 'focus') {
    // How sharp the focus can be: the spot's first dark points are about
    // lambda / (sin a1 + sin a2) to either side, a1 and a2 the angles out to the array's ends.
    const [cx, cy] = centroid(A.els), [fx, fy] = A.focus, r = Math.hypot(fx - cx, fy - cy);
    const ax = Math.atan2(cx - fx, cy - fy);
    let lo = 0, hi = 0;
    for (const e of A.els) { const a = Math.atan2(e.x - fx, e.y - fy) - ax, w = Math.atan2(Math.sin(a), Math.cos(a)); lo = Math.min(lo, w); hi = Math.max(hi, w); }
    const s = Math.sin(Math.min(Math.PI / 2, hi)) + Math.sin(Math.min(Math.PI / 2, -lo));
    add('Focus', [{ v: r, dec: 2, w: 5 }, '\u00a0λ from the middle of the array']);
    if (s > 0.02) add('Spot', ['dark about λ/(sin α₁ + sin α₂) = ', { v: 1 / s, dec: 2, w: 4 }, '\u00a0λ to either side']);
    add('Far field', ['no single beam: the waves meet at the focus and spread out again']);
  } else if (info.omni) add('Beam', ['none: the same power within 3 dB in every direction']);
  else {
    add('Beam direction', ['θ = ', ...deg(info.beam)]);
    add('Beamwidth', [{ v: info.hpbw / DEG, dec: 1, w: 5 }, '° between the half-power (−3 dB) points']);
    // A grating lobe proper: an equally spaced line with d > lambda / (1 + |sin theta0|).
    const grating = A.layout === 'line' && A.phaseMode === 'steer' && A.d > 1 / (1 + Math.abs(Math.sin(A.theta0 * DEG))) - 1e-9;
    if (info.sll === null) add('Highest sidelobe', ['none']);
    else if (info.sll > -0.5) add('Highest sidelobe', [...dB(info.sll), ' at ', ...deg(info.sllAngle), `: as strong as the beam${grating ? ' (a grating lobe)' : ''}`], 'warn');
    else add('Highest sidelobe', [...dB(info.sll), ' at ', ...deg(info.sllAngle)]);
  }
  if (D > 0 && A.phaseMode !== 'focus') add('Directivity', [{ v: 10 * Math.log10(D), dec: 1, w: 4 }, '\u00a0dBi (D = ', { v: D, dec: 1, w: 5 }, ')']);
  const Dsz = extent(A.els);
  add('Elements', [{ v: A.els.length, dec: 0, w: 2 }, ', across D = ', { v: Dsz, dec: 1, w: 4 }, '\u00a0λ; far field beyond 2D²/λ = ', { v: 2 * Dsz * Dsz, dec: 1, w: 6 }, '\u00a0λ']);
  // The rows are made again only when the quantities shown change; otherwise only their numbers.
  const key = rows.map(([k, , cls]) => `${k}|${cls}`).join(';');
  if (box._rows !== key) {
    box._rows = key;
    box.replaceChildren(...rows.flatMap(([k, , cls]) => [el('dt', {}, k), el('dd', { class: cls || undefined })]));
  }
  rows.forEach(([, parts], i) => setSlots(box.children[2 * i + 1], parts));
}

// ------------------------------------------------------------------ animation

let raf = 0, last = 0;
function loop(now) {
  raf = 0;
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
  last = now;
  if (A.running) A.t += dt * A.speed;
  if (A.sweep && A.running) {
    // The beam swings back and forth like a radar's, through +-60 degrees every 8 s.
    A.sweepT = (A.sweepT || 0) + dt;
    A.theta0 = +(60 * Math.sin((2 * Math.PI * A.sweepT) / 8)).toFixed(2);
    theta0Slider.value = A.theta0;
    compute(); drawPolar(); readouts();
  }
  if (active) drawField();
  if (active && (A.running || A.sweep)) raf = requestAnimationFrame(loop); else last = 0;
}
function kick() { if (!raf && active) raf = requestAnimationFrame(loop); }
let active = false;
export function setArraysActive(on) { active = on; if (on) { arraysChanged(false); kick(); } }

// ------------------------------------------------------------------ controls

const LAYOUTS = { line: 'Line', circle: 'Circle', random: 'Random' };
const layoutButtons = {};
for (const [id, label] of Object.entries(LAYOUTS)) {
  const b = el('button', { type: 'button', 'aria-pressed': 'false', onclick: () => setLayout(id) }, label);
  $('#layouts').append(b); layoutButtons[id] = b;
}
function syncLayoutButtons() {
  for (const [id, b] of Object.entries(layoutButtons)) b.setAttribute('aria-pressed', String(id === A.layout));
  dSlider.hidden = A.layout !== 'line' && A.layout !== 'custom';
  rSlider.hidden = A.layout !== 'circle';
  apSlider.hidden = A.layout !== 'random';
  newRandom.hidden = A.layout !== 'random';
}
function setLayout(id) {
  A.layout = id;
  makeLayout(); syncLayoutButtons(); arraysChanged();
}
const nSlider = slider({ label: 'N', min: 1, max: 32, step: 1, value: A.n, title: 'The number of elements',
  onInput: (v) => { A.n = Math.max(1, Math.min(MAXN, Math.round(v))); if (A.layout === 'custom') A.layout = 'line'; makeLayout(); syncLayoutButtons(); arraysChanged(); } });
const dSlider = slider({ label: 'spacing d (λ)', min: 0.05, max: 3, step: 0.01, value: A.d, title: 'The distance between neighbours, in wavelengths',
  onInput: (v) => { A.d = v; if (A.layout === 'custom') A.layout = 'line'; makeLayout(); syncLayoutButtons(); arraysChanged(); } });
const rSlider = slider({ label: 'radius (λ)', min: 0.1, max: 8, step: 0.01, value: A.radius, onInput: (v) => { A.radius = v; makeLayout(); arraysChanged(); } });
const apSlider = slider({ label: 'across (λ)', min: 2, max: 30, step: 0.1, value: A.aperture, title: 'The diameter of the region the elements are scattered over',
  onInput: (v) => { A.aperture = v; makeLayout(); arraysChanged(); } });
const newRandom = el('button', { type: 'button', onclick: () => { A.seed++; makeLayout(); arraysChanged(); } }, 'Scatter them again');
$('#layout-box').append(nSlider, dSlider, rSlider, apSlider, newRandom);

const kindSeg = segmented([
  { value: 'iso', label: 'Isotropic', title: 'Point sources radiating equally in every direction' },
  { value: 'dipole', label: 'Short dipoles', title: 'Hertzian dipoles lying in the plane: no radiation along their axis' },
], A.kind, (v) => { A.kind = v; dipSlider.hidden = v !== 'dipole'; arraysChanged(); }, { label: 'Element' });
$('#kind-box').append(kindSeg);
const dipSlider = slider({ label: 'dipole axis', min: -90, max: 90, step: 1, value: A.dipAngle, title: 'The direction of the dipoles, in degrees from horizontal',
  onInput: (v) => { A.dipAngle = v; arraysChanged(); } });
$('#dipole-box').append(dipSlider);
dipSlider.hidden = true;
$('#edit-box').append(
  el('button', { type: 'button', onclick: () => addElement(), title: 'Add an element (or double-click in the picture)' }, 'Add one'),
  el('button', { type: 'button', onclick: () => removeSelected(), title: 'Remove the selected element (Delete)' }, 'Remove one'),
);

const phaseSeg = segmented([
  { value: 'steer', label: 'Steer', title: 'Phases that send the waves out in step in one direction' },
  { value: 'focus', label: 'Focus', title: 'Phases that bring the waves together in step at a point' },
  { value: 'manual', label: 'By hand', title: 'Set each element’s phase yourself (select it in the picture)' },
], A.phaseMode, (v) => setPhaseMode(v), { label: 'Phases' });
$('#phase-mode').append(phaseSeg);
const theta0Slider = slider({ label: 'θ₀ (°)', min: -90, max: 90, step: 0.5, value: A.theta0, title: 'The steering angle, from straight up',
  onInput: (v) => { A.theta0 = v; if (A.phaseMode !== 'steer') setPhaseMode('steer'); arraysChanged(); } });
const sweepToggle = toggle('Sweep', A.sweep, (on) => { A.sweep = on; if (on && A.phaseMode !== 'steer') setPhaseMode('steer'); kick(); arraysChanged(); }, 'Swing the beam back and forth, like a radar');
const steerBox = el('div', { class: 'stack' }, theta0Slider, el('div', { class: 'row' }, sweepToggle,
  el('span', { class: 'note' }, 'each element lags its left neighbour by k d sin θ₀')));
const fxSlider = slider({ label: 'focus x', min: -16, max: 16, step: 0.05, value: A.focus[0], onInput: (v) => { A.focus[0] = v; arraysChanged(); } });
const fySlider = slider({ label: 'focus y', min: -16, max: 16, step: 0.05, value: A.focus[1], onInput: (v) => { A.focus[1] = v; arraysChanged(); } });
const focusBox = el('div', { class: 'stack' }, fxSlider, fySlider, el('div', { class: 'note' }, 'or drag the cross in the picture'));
const manualBox = el('div', { class: 'note' }, 'Click an element to set its amplitude and phase.');
$('#phase-box').append(steerBox, focusBox, manualBox);
function syncFocus() { fxSlider.value = A.focus[0]; fySlider.value = A.focus[1]; }
function setPhaseMode(m) {
  A.phaseMode = m; phaseSeg.value = m;
  steerBox.hidden = m !== 'steer'; focusBox.hidden = m !== 'focus'; manualBox.hidden = m !== 'manual';
  if (m !== 'steer' && A.sweep) { A.sweep = false; sweepToggle.on = false; }
  arraysChanged();
}

const TAPERS = { uniform: 'Uniform', binomial: 'Binomial', hann: 'Hann', taylor: 'Taylor', chebyshev: 'Chebyshev' };
const taperButtons = {};
for (const [id, label] of Object.entries(TAPERS)) {
  const titles = {
    uniform: 'Every element at full strength: the narrowest beam, sidelobes 13 dB down',
    binomial: 'Binomial coefficients: no sidelobes at all (for spacings up to λ/2), but a wide beam',
    hann: 'A cos² taper: low sidelobes, a wider beam',
    taylor: 'Taylor: the first few sidelobes at the chosen level, the rest falling away',
    chebyshev: 'Dolph–Chebyshev: every sidelobe at the chosen level, and the narrowest beam that allows',
  };
  const b = el('button', { type: 'button', 'aria-pressed': 'false', title: titles[id], onclick: () => setTaper(id) }, label);
  $('#tapers').append(b); taperButtons[id] = b;
}
const sllSlider = slider({ label: 'sidelobes (dB)', min: 15, max: 60, step: 1, value: A.sll, title: 'How far below the beam the sidelobes should be',
  onInput: (v) => { A.sll = v; arraysChanged(); } });
$('#sll-box').append(sllSlider);
function setTaper(id) {
  A.taper = id;
  for (const [k, b] of Object.entries(taperButtons)) b.setAttribute('aria-pressed', String(k === id));
  sllSlider.hidden = id !== 'taylor' && id !== 'chebyshev';
  arraysChanged();
}

// The selected element's own amplitude and phase.
const ampSlider = slider({ label: 'amplitude', min: 0, max: 2, step: 0.01, value: 1, onInput: (v) => {
  const e = A.els[A.selected]; if (!e) return;
  if (A.taper !== 'manual') { A.taper = 'manual'; for (const b of Object.values(taperButtons)) b.setAttribute('aria-pressed', 'false'); sllSlider.hidden = true; }
  e.amp = v; arraysChanged();
} });
const phSlider = slider({ label: 'phase (°)', min: -180, max: 180, step: 1, value: 0, title: 'A larger phase is a later signal: exp(i φ) exp(−iωt)', onInput: (v) => {
  const e = A.els[A.selected]; if (!e) return;
  if (A.phaseMode !== 'manual') setPhaseMode('manual');
  e.phase = v * DEG; arraysChanged();
} });
$('#selected-box').append(ampSlider, phSlider);
function syncSelected() {
  const e = A.els[A.selected];
  $('#selected-panel').hidden = !e;
  if (!e) return;
  setSlots($('#selected-label'), ['Element ', { v: A.selected + 1, dec: 0, w: 2 }, ' at (', { v: e.x, dec: 2, w: 6 }, ', ', { v: e.y, dec: 2, w: 6 }, ') λ']);
  ampSlider.value = +e.amp.toFixed(3);
  phSlider.value = +(e.phase / DEG).toFixed(1);
}

// Show.
const playButton = $('#play');
playButton.addEventListener('click', () => setRunning(!A.running));
function setRunning(on) { A.running = on; playButton.textContent = on ? 'Pause' : 'Play'; kick(); }
const dbToggle = toggle('dB', A.db, (on) => { A.db = on; drawPolar(); onChange(); }, 'Draw the pattern in decibels (down to −40 dB) or in plain power');
const factorsToggle = toggle('Factors', A.factors, (on) => { A.factors = on; drawPolar(); onChange(); }, 'Also draw the array factor and one element’s pattern, each scaled to 1');
$('#db-box').append(dbToggle); $('#factors-box').append(factorsToggle);
const displaySeg = segmented([
  { value: 'real', label: 'Waves', title: 'The real part of the field, Re ψ e^(−iωt): crests red, troughs cyan' },
  { value: 'complex', label: 'Phase', title: 'The complex field in phase colours' },
  { value: 'intensity', label: 'Intensity', title: 'The time-averaged intensity |ψ|²' },
], A.display, (v) => { A.display = v; kick(); onChange(); }, { label: 'Show' });
$('#display-box').append(displaySeg);
const speedSlider = slider({ label: 'speed', min: 0.05, max: 4, log: true, value: A.speed, onInput: (v) => { A.speed = v; } });
const brightSlider = slider({ label: 'brightness', min: -2, max: 2, step: 0.01, value: A.bright, onInput: (v) => { A.bright = v; kick(); } });
const viewSlider = slider({ label: 'view (λ)', min: 4, max: 64, log: true, value: A.view, title: 'The width of the picture, in wavelengths',
  onInput: (v) => { A.view = v; fieldDirty = true; arraysChanged(); } });
$('#show-box').append(speedSlider, brightSlider, viewSlider);

/** Set everything at once (the experiments and the address use this). */
export function configureArrays(o = {}) {
  const d = {
    layout: 'line', n: 8, d: 0.5, radius: 2, aperture: 10, seed: 1, cy: 0, kind: 'iso', dipAngle: 0,
    phaseMode: 'steer', theta0: 0, focus: [0, 5], sweep: false, taper: 'uniform', sll: 30,
    view: 16, display: 'real', bright: 0, db: true, factors: false, els: null,
  };
  Object.assign(A, d, o);
  A.sweepT = Math.asin(Math.max(-1, Math.min(1, A.theta0 / 60))) * 8 / (2 * Math.PI);
  if (o.els) { A.els = o.els.map((e) => ({ amp: 1, phase: 0, ...e })); A.selected = -1; } else makeLayout();
  nSlider.value = A.n; dSlider.value = A.d; rSlider.value = A.radius; apSlider.value = A.aperture;
  kindSeg.value = A.kind; dipSlider.hidden = A.kind !== 'dipole'; dipSlider.value = A.dipAngle;
  theta0Slider.value = A.theta0; sweepToggle.on = A.sweep; syncFocus();
  dbToggle.on = A.db; factorsToggle.on = A.factors; displaySeg.value = A.display;
  brightSlider.value = A.bright; viewSlider.value = A.view; sllSlider.value = A.sll;
  fieldDirty = true;
  syncLayoutButtons();
  setTaper(A.taper === 'manual' ? 'uniform' : A.taper);
  if (o.taper === 'manual') { A.taper = 'manual'; for (const b of Object.values(taperButtons)) b.setAttribute('aria-pressed', 'false'); sllSlider.hidden = true; }
  setPhaseMode(A.phaseMode);
  setRunning(true);
}

/** The state worth keeping in the address. */
export function arraysHash() {
  const h = {
    layout: A.layout, n: A.n, d: A.d, kind: A.kind, ph: A.phaseMode, taper: A.taper, view: +A.view.toFixed(2),
  };
  if (A.layout === 'circle') h.r = A.radius;
  if (A.layout === 'random') { h.ap = A.aperture; h.seed = A.seed; }
  if (A.cy) h.cy = A.cy;
  if (A.kind === 'dipole') h.dip = A.dipAngle;
  if (A.phaseMode === 'steer') h.th = A.theta0;
  if (A.phaseMode === 'focus') h.focus = A.focus.join(',');
  if (A.taper === 'taylor' || A.taper === 'chebyshev') h.sll = A.sll;
  if (A.display !== 'real') h.show = A.display;
  if (!A.db) h.db = 0;
  if (A.factors) h.factors = 1;
  if (A.sweep) h.sweep = 1;
  if (A.layout === 'custom' || A.taper === 'manual' || A.phaseMode === 'manual') {
    h.els = A.els.map((e) => [e.x, e.y, +e.amp.toFixed(3), +(e.phase / DEG).toFixed(1)].join(',')).join(';');
  }
  return h;
}

export function arraysFromHash(h) {
  const num = (k, d) => (h[k] !== undefined && Number.isFinite(+h[k]) ? +h[k] : d);
  const o = {
    layout: ['line', 'circle', 'random', 'custom'].includes(h.layout) ? h.layout : 'line',
    n: num('n', 8), d: num('d', 0.5), radius: num('r', 2), aperture: num('ap', 10), seed: num('seed', 1), cy: num('cy', 0),
    kind: h.kind === 'dipole' ? 'dipole' : 'iso', dipAngle: num('dip', 0),
    phaseMode: ['steer', 'focus', 'manual'].includes(h.ph) ? h.ph : 'steer', theta0: num('th', 0),
    taper: Object.keys(TAPERS).includes(h.taper) || h.taper === 'manual' ? h.taper : 'uniform', sll: num('sll', 30),
    view: num('view', 16), display: ['real', 'complex', 'intensity'].includes(h.show) ? h.show : 'real',
    db: h.db !== '0', factors: h.factors === '1', sweep: h.sweep === '1',
  };
  if (h.focus) { const f = h.focus.split(',').map(Number); if (f.length === 2 && f.every(Number.isFinite)) o.focus = f; }
  if (h.els) {
    const els = h.els.split(';').map((s) => s.split(',').map(Number)).filter((a) => a.length === 4 && a.every(Number.isFinite))
      .map(([x, y, amp, ph]) => ({ x, y, amp, phase: ph * DEG }));
    if (els.length) o.els = els.slice(0, MAXN);
  }
  configureArrays(o);
}

export const arraysApi = {
  get info() { return info; }, get D() { return D; }, get pattern() { return pat; }, compute,
  field: { re: fre, im: fim }, grid, setRunning, addElement, removeSelected, configure: configureArrays,
};

document.addEventListener('keydown', (e) => {
  if (!active || e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ') { e.preventDefault(); setRunning(!A.running); }
});
window.addEventListener('resize', () => { if (active) { drawPolar(); kick(); } });
