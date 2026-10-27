// Diffraction: paint an aperture, move the screen.  Lengths in micrometres.

import { propagate, sideView } from './optics.js';
import { fft2Centered } from '../lib/fft.js';
import { colorize } from '../lib/complexcolor.js';
import { stroke as paintStroke, paint } from '../fft2d/tools.js';
import { el, $, slider, segmented, toggle, drawer, readHash, writeHash, fmt } from '../lib/ui.js';

const N = 512;            // the grid
const DX = 8;             // micrometres per pixel: the window is 4.096 mm across
const SHOW = 256;         // the middle 256 pixels (2.05 mm) are drawn
const OFF = (N - SHOW) / 2;

const state = {
  z: 10000,               // screen distance, um
  lambda: 0.55,           // um
  white: false,
  far: false,
  display: 'intensity',
  bright: 0,
  tool: 'open',
  brush: 6,
  preset: 'slit',
  size: 200,              // the preset's characteristic size, um
};

const ap = { re: new Float64Array(N * N), im: new Float64Array(N * N) };
const coord = (i) => (i - N / 2) * DX;

// --------------------------------------------------------------------- presets

// A soft-edged window so that apertures "open everywhere" (the disk, the edge) don't
// diffract from the edges of the computing window.
const window_ = (x, y) => {
  const r = Math.max(Math.abs(x), Math.abs(y)), edge = (N / 2) * DX * 0.8;
  return r < edge ? 1 : Math.max(0, Math.cos(((r - edge) / ((N / 2) * DX * 0.2)) * (Math.PI / 2)));
};

const PRESETS = {
  slit: { label: 'Slit', size: [20, 600, 200], f: (x, y, s) => +(Math.abs(x) < s / 2 && Math.abs(y) < 700) },
  double: { label: 'Two slits', size: [40, 800, 250], f: (x, y, s) => +((Math.abs(x - s / 2) < s / 8 || Math.abs(x + s / 2) < s / 8) && Math.abs(y) < 700) },
  hole: { label: 'Round hole', size: [20, 800, 300], f: (x, y, s) => +(x * x + y * y < (s / 2) ** 2) },
  square: { label: 'Square hole', size: [20, 800, 300], f: (x, y, s) => +(Math.abs(x) < s / 2 && Math.abs(y) < s / 2) },
  edge: { label: 'Straight edge', size: [0, 0, 0], f: (x, y) => +(x > 0) * window_(x, y) },
  disk: { label: 'Opaque disk', size: [100, 900, 500], f: (x, y, s) => +(x * x + y * y > (s / 2) ** 2) * window_(x, y) },
  grating: { label: 'Grating', size: [16, 200, 48], f: (x, y, s) => (0.5 + 0.5 * Math.cos((2 * Math.PI * x) / s)) * +(Math.abs(x) < 750 && Math.abs(y) < 750) },
  zone: { label: 'Zone plate', size: [10, 200, 50], fz: true, f: (x, y, s, lam) => { const n = (x * x + y * y) / (lam * s * 1000); return +(n < 24 && Math.floor(n) % 2 === 0); } },
  lens: { label: 'Lens', size: [10, 200, 50], phase: true, f: (x, y, s, lam) => { const r2 = x * x + y * y; if (r2 > 600 * 600) return 0; const p = (-(2 * Math.PI) / lam) * r2 / (2 * s * 1000); return [Math.cos(p), Math.sin(p)]; } },
  random: { label: 'Rough glass', size: [8, 80, 24], phase: true, f: (x, y, s) => {
    if (x * x + y * y > 500 * 500) return 0;
    const cx = Math.floor(x / s), cy = Math.floor(y / s);
    let h = (cx * 73856093) ^ (cy * 19349663); h = (h ^ (h >>> 13)) * 1274126177; const p = ((h >>> 0) % 1000) / 1000 * 2 * Math.PI;
    return [Math.cos(p), Math.sin(p)];
  } },
};

function loadPreset(id, size) {
  const p = PRESETS[id];
  state.preset = id;
  if (size !== undefined) state.size = size;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const v = p.f(coord(i), -coord(j), state.size, state.lambda), o = j * N + i;
    if (typeof v === 'number') { ap.re[o] = v; ap.im[o] = 0; } else { ap.re[o] = v[0]; ap.im[o] = v[1]; }
  }
  for (const [k, b] of Object.entries(presetButtons)) b.setAttribute('aria-pressed', String(k === id));
  sizeSlider.hidden = !p.size[1];
  if (p.size[1]) { sizeSlider.setRange(p.size[0], p.size[1]); sizeSlider.value = state.size; sizeLabel(p); }
  if (p.phase && state.display === 'intensity') { /* the aperture is drawn in colour anyway */ }
  update();
  writeHash({ preset: id, size: state.size, z: Math.round(state.z) });
}
function sizeLabel(p) {
  sizeSlider.querySelector('label').textContent = p.fz ? 'focus f (mm)' : p.label === 'Grating' ? 'period (µm)' : p.label === 'Rough glass' ? 'grain (µm)' : 'size (µm)';
}

// --------------------------------------------------------------------- computing

const WAVES = { white: [[0.65, [1, 0, 0]], [0.55, [0, 1, 0]], [0.45, [0, 0, 1]]] };

function wavelengths() { return state.white ? WAVES.white : [[state.lambda, wavelengthRGB(state.lambda)]]; }

/** An approximate colour for a wavelength (after Dan Bruton). */
function wavelengthRGB(lam) {
  const w = lam * 1000;
  let r = 0, g = 0, b = 0;
  if (w < 440) { r = -(w - 440) / 60; b = 1; } else if (w < 490) { g = (w - 440) / 50; b = 1; }
  else if (w < 510) { g = 1; b = -(w - 510) / 20; } else if (w < 580) { r = (w - 510) / 70; g = 1; }
  else if (w < 645) { r = 1; g = -(w - 645) / 65; } else r = 1;
  const f = w < 420 ? 0.3 + (0.7 * (w - 380)) / 40 : w > 700 ? 0.3 + (0.7 * (780 - w)) / 80 : 1;
  return [r * f, g * f, b * f];
}

let fields = [];      // per wavelength: {re, im, rgb}
let sideData = null;  // per wavelength intensities for the side view

function update() {
  fields = wavelengths().map(([lam, rgb]) => {
    const re = Float64Array.from(ap.re), im = Float64Array.from(ap.im);
    if (state.far) fft2Centered(re, im, N, N);
    else propagate(re, im, N, DX, lam, state.z);
    return { re, im, rgb, lam };
  });
  drawAperture(); drawField(); updateNotes();
  scheduleSide();
}

let sideTimer = 0;
function scheduleSide() {
  clearTimeout(sideTimer);
  sideTimer = setTimeout(() => {
    const zs = Array.from({ length: 96 }, (_, a) => ((a + 0.5) / 96) * 2 * state.z);
    sideData = wavelengths().map(([lam, rgb]) => ({ I: sideView(ap.re, ap.im, N, DX, lam, zs), rgb }));
    drawSide();
  }, 120);
}

// --------------------------------------------------------------------- drawing

function canvasSize(cv) {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return [w, h];
}

function blit(cv, img, m) {
  const [w, h] = canvasSize(cv), ctx = cv.getContext('2d');
  const c = document.createElement('canvas'); c.width = m; c.height = img.height;
  c.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, 0, 0, w, h);
  return ctx;
}

function drawAperture() {
  const cv = $('#aperture'), img = new ImageData(SHOW, SHOW);
  const re = new Float64Array(SHOW * SHOW), im = new Float64Array(SHOW * SHOW);
  for (let j = 0; j < SHOW; j++) for (let i = 0; i < SHOW; i++) {
    const o = (j + OFF) * N + i + OFF;
    re[j * SHOW + i] = ap.re[o]; im[j * SHOW + i] = ap.im[o];
  }
  const hasPhase = im.some((v) => Math.abs(v) > 1e-9) || re.some((v) => v < -1e-9);
  colorize(re, im, img.data, 0.35, hasPhase ? 'complex' : 'magnitude');
  const ctx = blit(cv, img, SHOW);
  scaleBar(ctx, cv.width, cv.height, SHOW * DX);
}

function scaleBar(ctx, w, h, span) {
  const dpr = window.devicePixelRatio || 1, len = 500, px = (len / span) * w;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(10 * dpr, h - 14 * dpr, px, 3 * dpr);
  ctx.font = `${11 * dpr}px system-ui, sans-serif`;
  ctx.fillText(span > 50000 ? '' : '0.5 mm', 10 * dpr, h - 20 * dpr);
}

/** Intensities of the fields over the drawn region, to a coloured image. */
function intensityImage(getI, m, rgbs, ref) {
  const img = new ImageData(m, m), d = img.data;
  for (let o = 0; o < m * m; o++) {
    let r = 0, g = 0, b = 0;
    rgbs.forEach((rgb, w) => {
      const v = Math.min(1, Math.sqrt(getI(w, o) / ref));
      r += rgb[0] * v; g += rgb[1] * v; b += rgb[2] * v;
    });
    d[4 * o] = 255 * Math.min(1, r); d[4 * o + 1] = 255 * Math.min(1, g); d[4 * o + 2] = 255 * Math.min(1, b); d[4 * o + 3] = 255;
  }
  return img;
}

function drawField() {
  const cv = $('#field');
  // The far field: the middle of the transform; else the middle of the window.
  const pick = (f, o) => { const j = Math.floor(o / SHOW) + OFF, i = (o % SHOW) + OFF; return [f.re[j * N + i], f.im[j * N + i]]; };
  let ref = 0;
  const Is = fields.map((f) => {
    const I = new Float64Array(SHOW * SHOW);
    for (let o = 0; o < SHOW * SHOW; o++) { const [a, b] = pick(f, o); I[o] = a * a + b * b; }
    return I;
  });
  for (const I of Is) { const s = Float64Array.from(I).sort(); ref = Math.max(ref, s[Math.floor(0.995 * (s.length - 1))]); }
  ref = (ref || 1) * 10 ** -state.bright;
  let img;
  if (state.display === 'complex' && fields.length === 1) {
    img = new ImageData(SHOW, SHOW);
    const re = new Float64Array(SHOW * SHOW), im = new Float64Array(SHOW * SHOW);
    for (let o = 0; o < SHOW * SHOW; o++) { const [a, b] = pick(fields[0], o); re[o] = a; im[o] = b; }
    colorize(re, im, img.data, Math.sqrt(ref) * 0.5, 'complex');
  } else img = intensityImage((w, o) => Is[w][o], SHOW, fields.map((f) => f.rgb), ref);
  const ctx = blit(cv, img, SHOW);
  if (!state.far) scaleBar(ctx, cv.width, cv.height, SHOW * DX);
  else {
    // Angles: the transform's pixel is lambda / (N dx) radians.
    const dpr = window.devicePixelRatio || 1, lam = fields[0].lam, step = (lam / (N * DX)) * 1000; // mrad per pixel
    const mrad = 5, px = (mrad / step / SHOW) * cv.width;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(10 * dpr, cv.height - 14 * dpr, px, 3 * dpr);
    ctx.font = `${11 * dpr}px system-ui, sans-serif`;
    ctx.fillText(`${mrad} mrad${state.white ? ' (green)' : ''}`, 10 * dpr, cv.height - 20 * dpr);
  }
}

function drawSide() {
  const cv = $('#side');
  if (!sideData) return;
  const nz = 96, m = SHOW;
  const img = new ImageData(m, nz), d = img.data;
  let ref = 0;
  for (const { I } of sideData) {
    // Ignore the very first rows (the aperture itself) when choosing the brightness.
    const s = Float64Array.from(I.subarray(N * 4)).sort();
    ref = Math.max(ref, s[Math.floor(0.995 * (s.length - 1))]);
  }
  ref = (ref || 1) * 10 ** -state.bright;
  for (let a = 0; a < nz; a++) for (let i = 0; i < m; i++) {
    let r = 0, g = 0, b = 0;
    for (const { I, rgb } of sideData) {
      const v = Math.min(1, Math.sqrt(I[a * N + i + OFF] / ref));
      r += rgb[0] * v; g += rgb[1] * v; b += rgb[2] * v;
    }
    const o = (a * m + i) * 4;
    d[o] = 255 * Math.min(1, r); d[o + 1] = 255 * Math.min(1, g); d[o + 2] = 255 * Math.min(1, b); d[o + 3] = 255;
  }
  const [w, h] = canvasSize(cv), ctx = cv.getContext('2d');
  const c = document.createElement('canvas'); c.width = m; c.height = nz;
  c.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(c, 0, 0, w, h);
  // The screen's distance is the middle of the side view.
  const dpr = window.devicePixelRatio || 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.setLineDash([6 * dpr, 4 * dpr]); ctx.lineWidth = dpr;
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = `${11 * dpr}px system-ui, sans-serif`;
  ctx.fillText('z = 0', 6 * dpr, 13 * dpr);
  ctx.fillText(`z = ${fmtZ(state.z)} (the screen)`, 6 * dpr, h / 2 - 4 * dpr);
  ctx.fillText(`${fmtZ(2 * state.z)}`, 6 * dpr, h - 5 * dpr);
}

function fmtZ(z) { return z >= 1000 ? `${fmt(z / 1000, 3)} mm` : `${fmt(z, 3)} µm`; }

function updateNotes() {
  $('#field-title').textContent = state.far ? 'Far field (Fraunhofer)' : 'Light at distance z';
  $('#field-note').textContent = state.far ? 'the Fourier transform of the aperture; angles in milliradians' : `z = ${fmtZ(state.z)}`;
  const p = PRESETS[state.preset] || { size: [0, 0, 0] };   // painted by hand: no one size
  const a = p.size[1] ? (p.fz ? null : state.size / 2) : null;
  const lam = state.white ? 0.55 : state.lambda;
  let text = '';
  if (a) {
    const NF = (a * a) / (lam * state.z);
    text = `Fresnel number a²/λz = ${fmt(NF, 3)} (a = ${fmt(a, 3)} µm): ${NF > 3 ? 'near field, a sharp shadow' : NF > 0.3 ? 'in between' : 'far field: the pattern is the Fourier transform'}`;
  } else if (p.fz) text = `Focus at f = ${fmt(state.size, 3)} mm${state.preset === 'zone' ? ' (and f/3, f/5...)' : ''}`;
  const spread = (lam / 30) * state.z;  // a 30 um feature's diffraction angle times z
  if (!state.far && spread > (N * DX) / 3) text += ' · the light has spread past the window: try Far field';
  $('#fresnel').textContent = text;
}

// --------------------------------------------------------------------- painting

const apCanvas = $('#aperture');
let last = null;
function apPixel(e) {
  const r = apCanvas.getBoundingClientRect();
  return [Math.floor(((e.clientX - r.left) / r.width) * SHOW) + OFF, Math.floor(((e.clientY - r.top) / r.height) * SHOW) + OFF];
}
let painting = false, frame = 0;
apCanvas.addEventListener('pointerdown', (e) => {
  apCanvas.setPointerCapture(e.pointerId);
  painting = true;
  const [i, j] = apPixel(e);
  paint(ap.re, ap.im, N, i, j, { shape: 'round', size: state.brush }, state.tool === 'open' ? 1 : 0, 0);
  last = [i, j];
  state.preset = 'custom';
  for (const b of Object.values(presetButtons)) b.setAttribute('aria-pressed', 'false');
  requestUpdate();
});
apCanvas.addEventListener('pointermove', (e) => {
  if (!painting) return;
  const [i, j] = apPixel(e);
  paintStroke(ap.re, ap.im, N, last[0], last[1], i, j, { shape: 'round', size: state.brush }, state.tool === 'open' ? 1 : 0, 0);
  last = [i, j];
  requestUpdate();
});
const stop = () => { painting = false; };
apCanvas.addEventListener('pointerup', stop);
apCanvas.addEventListener('pointercancel', stop);
function requestUpdate() {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; update(); });
}

// --------------------------------------------------------------------- controls

const zSlider = slider({ label: 'z (mm)', min: 0.1, max: 3000, log: true, value: state.z / 1000, title: 'The distance from the aperture to the screen',
  onInput: (v) => { state.z = v * 1000; if (state.far) { state.far = false; farToggle.on = false; } requestUpdate(); } });
$('#z-box').append(zSlider);
const farToggle = toggle('Far field', state.far, (on) => { state.far = on; requestUpdate(); }, 'Infinitely far: the Fraunhofer pattern, the Fourier transform of the aperture');
$('#far-box').append(farToggle);

const lambdaSlider = slider({ label: 'λ (nm)', min: 400, max: 700, step: 1, value: state.lambda * 1000,
  onInput: (v) => { state.lambda = v / 1000; if (PRESETS[state.preset]?.fz || PRESETS[state.preset]?.phase) loadPreset(state.preset); else requestUpdate(); } });
$('#lambda-box').append(lambdaSlider);
const whiteToggle = toggle('White light', state.white, (on) => { state.white = on; requestUpdate(); }, 'Red, green and blue at once (650, 550 and 450 nm)');
$('#light-box').append(whiteToggle);

const presetButtons = {};
for (const [id, p] of Object.entries(PRESETS)) {
  const b = el('button', { type: 'button', 'aria-pressed': 'false', onclick: () => loadPreset(id, p.size[2]) }, p.label);
  $('#presets').append(b);
  presetButtons[id] = b;
}
const sizeSlider = slider({ label: 'size (µm)', min: 20, max: 600, value: state.size, onInput: (v) => loadPreset(state.preset, v) });
$('#preset-size').append(sizeSlider);
const toolSeg = segmented([
  { value: 'open', label: 'Open', title: 'Paint light through' }, { value: 'close', label: 'Close', title: 'Paint darkness' },
], state.tool, (v) => { state.tool = v; }, { label: 'Tool' });
$('#tool-box').append(toolSeg, el('button', { type: 'button', onclick: () => { ap.re.fill(0); ap.im.fill(0); state.preset = 'custom'; for (const b of Object.values(presetButtons)) b.setAttribute('aria-pressed', 'false'); update(); } }, 'Close all'));
$('#brush-box').append(slider({ label: 'brush', min: 1, max: 40, step: 1, value: state.brush, onInput: (v) => { state.brush = Math.round(v); } }));

const displaySeg = segmented([
  { value: 'intensity', label: 'Intensity' }, { value: 'complex', label: 'Field (phase)' },
], state.display, (v) => { state.display = v; drawField(); }, { label: 'Show' });
$('#show-box').append(displaySeg);
$('#bright-box').append(slider({ label: 'Brightness', min: -2, max: 2, step: 0.01, value: 0, onInput: (v) => { state.bright = v; drawField(); drawSide(); } }));

window.addEventListener('resize', () => { drawAperture(); drawField(); drawSide(); });

// --------------------------------------------------------------------- experiments

function go(preset, { z = 10000, size, white = false, far = false, lambda = 0.55 } = {}) {
  state.z = z; zSlider.value = z / 1000;
  state.white = white; whiteToggle.on = white;
  state.far = far; farToggle.on = far;
  state.lambda = lambda; lambdaSlider.value = lambda * 1000;
  loadPreset(preset, size ?? PRESETS[preset].size[2]);
}
const setups = {
  slit: () => go('slit', { z: 10000, size: 200 }),
  edge: () => go('edge', { z: 20000 }),
  arago: () => go('disk', { z: 150000, size: 500 }),
  double: () => go('double', { z: 80000, size: 250 }),
  talbot: () => go('grating', { z: (2 * 48 * 48) / 0.55 / 2, size: 48 }),
  zone: () => go('zone', { z: 50000, size: 50 }),
  lens: () => go('lens', { z: 50000, size: 50 }),
  white: () => go('grating', { z: 60000, size: 48, white: true }),
  speckle: () => go('random', { z: 200000, size: 24 }),
};
drawer($('#help'), $('#help-button'), setups);

// --------------------------------------------------------------------- start

const hash = readHash();
if (setups[hash.setup]) setups[hash.setup]();
else {
  if (+hash.z > 0) { state.z = +hash.z; zSlider.value = state.z / 1000; }
  const id = PRESETS[hash.preset] ? hash.preset : 'slit';
  loadPreset(id, +hash.size > 0 ? +hash.size : PRESETS[id].size[2]);
}
window.__app = { state, setups, ap, get fields() { return fields; }, ready: true };
