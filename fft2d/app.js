// The 2D Fourier transform demo: two complex images, each the Fourier transform of the other.
// Paint on either; the other is recomputed once per animation frame.

import { fft2Centered } from '../lib/fft.js';
import { colorize, autoBrightness, drawWheel, MODES } from '../lib/complexcolor.js';
import { el, $, slider, segmented, toggle, drawer, toast, readHash, writeHash, fmt } from '../lib/ui.js';
import { paint, stroke, mask, roll, OPERATIONS, graft, resample } from './tools.js';
import { PRESETS, makePreset, imageData } from './presets.js';

const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  hand: svg('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5V4a1.5 1.5 0 0 1 3 0v8M14 11.5V5.5a1.5 1.5 0 0 1 3 0V13M17 8.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.6-2.2L4.3 15a1.5 1.5 0 0 1 2.3-1.9L8 14.6"/>'),
  brush: svg('<path d="M14.5 4.5l5 5L11 18l-5-5z"/><path d="M6 13c-2 0-3 1.5-3 3.5S2 20 2 20s3.5.5 5.5-1 2.5-3 1.5-4.5"/>'),
  eraser: svg('<path d="M7 20h13M5.5 15.5l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L13 18H8z"/><path d="M10 11l5 5"/>'),
  mask: svg('<circle cx="12" cy="12" r="5"/><rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="2.5 2.5"/>'),
};

// ------------------------------------------------------------------------------- state

const state = {
  n: 256,
  tool: 'brush',
  brush: { shape: 'round', size: 9, strength: 0.35 },
  maskShape: 'circle',
  maskKeep: 'inside',
  value: { mag: 1, phase: 0 }, // the paint, relative to the brightness R of the side painted
  mirror: false,
  repeat: 1,
  preset: 'portrait',
  size: 1,
  customImage: null,
  modified: false, // painted on since the preset was loaded?
  memory: null,    // a remembered transform, for grafting phases or magnitudes
  camera: null,
};

class Side {
  constructor(key) {
    this.key = key;
    this.root = $(`#side-${key}`);
    this.canvas = $('canvas.view', this.root);
    this.ctx = this.canvas.getContext('2d');
    this.readout = $('.readout', this.root);
    this.mode = 'complex';
    this.modeAuto = key === 'x'; // grey while the image is real and positive, colour once not
    this.autoR = 1;
    this.bright = 0;        // the brightness slider: R = autoR / 10^bright
    this.off = document.createElement('canvas');
    this.stale = true;      // the colours need recomputing
    this.hover = null;      // the pixel under the pointer
    this.zoom = 1;          // the view shows the central n/zoom pixels
    this.maskPreview = null;
  }
  get R() { return this.autoR * 10 ** -this.bright; }
  get other() { return this.key === 'x' ? sides.k : sides.x; }
  alloc(n) {
    this.re = new Float64Array(n * n);
    this.im = new Float64Array(n * n);
    this.off.width = this.off.height = n;
    this.offCtx = this.off.getContext('2d');
    this.image = this.offCtx.createImageData(n, n);
    this.stale = true;
  }
}

const sides = { x: new Side('x'), k: new Side('k') };
sides.x.alloc(state.n);
sides.k.alloc(state.n);

// ------------------------------------------------------------------------ the pipeline

let pending = null; // the side that was edited: the other must be recomputed
let raf = 0;

function schedule() { if (!raf) raf = requestAnimationFrame(frame); }

function changed(key) {
  pending = key;
  state.modified = true;
  sides[key].stale = true;
  schedule();
}

function transformFrom(key) {
  const from = sides[key], to = from.other, n = state.n;
  to.re.set(from.re);
  to.im.set(from.im);
  fft2Centered(to.re, to.im, n, n, key === 'k');
  to.stale = true;
  from.stale = true;
}

function frame() {
  raf = 0;
  if (state.camera?.live) grabCamera();
  if (pending) { transformFrom(pending); pending = null; }
  if (sides.x.modeAuto) autoMode();
  render(sides.x);
  render(sides.k);
  if (state.camera?.live) schedule();
}

// A photograph is real and positive: drawn in colour it would be all red (the colour of
// positive reals), so it is drawn in grey, as the old applet's users usually chose, with any
// negative values black.  Filtering a photograph leaves negative ripples (ringing) that don't
// change that; as soon as an edit makes the image complex, or strongly negative, the colours
// come on.
function isRealPositive(re, im) {
  let max = 0, maxRe = 0;
  for (let i = 0; i < re.length; i++) { max = Math.max(max, Math.abs(re[i]), Math.abs(im[i])); maxRe = Math.max(maxRe, re[i]); }
  const tol = 1e-7 * max, ripple = 0.35 * maxRe;
  for (let i = 0; i < re.length; i++) if (re[i] < -ripple || Math.abs(im[i]) > tol) return false;
  return maxRe > 0;
}
let quietAuto = true; // no announcement while a preset is being loaded
function autoMode() {
  const x = sides.x, want = isRealPositive(x.re, x.im) ? 'grey' : 'complex';
  if (want !== x.mode) {
    x.mode = want;
    x.modeSelect.value = want;
    x.stale = true;
    if (want === 'complex' && !quietAuto) toast('The image is no longer a real, positive picture, so its phase is now shown as colour.', 3500);
  }
  quietAuto = false;
}

function render(side) {
  const { canvas, ctx } = side;
  if (!canvas.width) return;
  if (side.stale) {
    colorize(side.re, side.im, side.image.data, side.R, side.mode);
    side.offCtx.putImageData(side.image, 0, 0);
    side.stale = false;
  }
  ctx.imageSmoothingEnabled = false;
  const n = state.n, v = n / side.zoom, o = (n - v) / 2;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(side.off, o, o, v, v, 0, 0, canvas.width, canvas.height);
  drawOverlay(side);
}

function drawOverlay(side) {
  const { ctx, canvas } = side, n = state.n, s = (canvas.width * side.zoom) / n;
  const dpr = window.devicePixelRatio || 1;
  ctx.save();
  // Data pixel coordinates to canvas coordinates, through the zoom.
  ctx.translate(-((n - n / side.zoom) / 2) * s, -((n - n / side.zoom) / 2) * s);
  ctx.lineWidth = 1.25 * dpr;
  // The origin.
  const o = (n / 2 + 0.5) * s, a = 5 * dpr;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.moveTo(o - 2 * a, o); ctx.lineTo(o - a, o); ctx.moveTo(o + a, o); ctx.lineTo(o + 2 * a, o);
  ctx.moveTo(o, o - 2 * a); ctx.lineTo(o, o - a); ctx.moveTo(o, o + a); ctx.lineTo(o, o + 2 * a);
  ctx.stroke();
  // The mask being dragged.
  const mp = side.maskPreview;
  if (mp) {
    const shapes = [[mp.cx, mp.cy]];
    if (state.mirror) shapes.push([(n - mp.cx) % n, (n - mp.cy) % n]);
    ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    for (const [cx, cy] of shapes) {
      const x = (cx + 0.5) * s, y = (cy + 0.5) * s, r = mp.r * s;
      ctx.beginPath();
      if (state.maskShape === 'square') ctx.rect(x - r, y - r, 2 * r, 2 * r); else ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  // The brush outline under the pointer.
  const h = side.hover;
  if (h && (state.tool === 'brush' || state.tool === 'eraser') && !side.maskPreview) {
    // Hard brushes of even size are centred on a pixel corner (see stamp()); the soft one on
    // the pixel's centre, with the outline at 2 sigma.
    const size = state.brush.size, c = size / 2;
    const centre = state.brush.shape === 'soft' || size % 2 ? 0.5 : 1;
    const px = (h.i + centre) * s, py = (h.j + centre) * s;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3 * dpr;
    const outline = () => {
      ctx.beginPath();
      if (state.brush.shape === 'square') ctx.rect(px - c * s, py - c * s, 2 * c * s, 2 * c * s);
      else ctx.arc(px, py, Math.max(c * s, 2 * dpr), 0, 2 * Math.PI);
      ctx.stroke();
    };
    outline();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.25 * dpr;
    outline();
  }
  ctx.restore();
}

function fitCanvases() {
  for (const side of Object.values(sides)) {
    const r = side.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr));
    if (side.canvas.width !== w) { side.canvas.width = w; side.canvas.height = w; }
  }
  schedule();
}
new ResizeObserver(fitCanvases).observe($('#side-x .canvas-wrap'));
new ResizeObserver(fitCanvases).observe($('#side-k .canvas-wrap'));

// ------------------------------------------------------------------------- brightness

/** A brightness for the transform side: bright enough that more than the DC pixel shows. */
function transformBrightness(re, im) {
  const n = re.length, mags = new Float64Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) { mags[i] = Math.hypot(re[i], im[i]); if (mags[i] > max) max = mags[i]; }
  if (max === 0) return 1;
  mags.sort();
  // Most transforms of pictures are a few huge values near k = 0 and a wide sea of small ones:
  // set R where 1.5% of the pixels are brighter than half, but no lower than 1% of the peak,
  // so that compact spectra (a Gaussian's) are not burnt out.
  const q = mags[Math.floor(0.985 * (n - 1))];
  return Math.max(q, 1e-2 * max);
}

function autoBright(key) {
  const side = sides[key];
  // A picture: typical values light grey, as a photograph should look.
  side.autoR = key === 'x' ? autoBrightness(side.re, side.im, 0.5) / 2 : transformBrightness(side.re, side.im);
  side.bright = 0;
  side.brightSlider.value = 0;
  side.stale = true;
}

// ----------------------------------------------------------------------- undo and redo

const undoStack = [], redoStack = [];
const UNDO_DEPTH = 24;

function snapshot(key) {
  const s = sides[key];
  return { key, n: state.n, re: Float32Array.from(s.re), im: Float32Array.from(s.im), modified: state.modified,
    preset: state.preset, customImage: state.customImage, size: state.size };
}
function pushUndo(key) {
  undoStack.push(snapshot(key));
  if (undoStack.length > UNDO_DEPTH) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
}
function restore(entry) {
  const s = sides[entry.key];
  s.re.set(entry.re); s.im.set(entry.im);
  state.modified = entry.modified;
  // What the picture was made from, so a change of resolution remakes the right thing.
  state.preset = entry.preset; state.customImage = entry.customImage; state.size = entry.size;
  for (const [k, b] of Object.entries(presetButtons)) b.setAttribute('aria-pressed', String(k === entry.preset));
  const p = PRESETS.find((q) => q.id === entry.preset);
  sizeBox.style.visibility = p?.sized ? 'visible' : 'hidden';
  presetSize.value = entry.size;
  updateHash();
  pending = entry.key;
  s.stale = true;
  schedule();
}
function undo() {
  const e = undoStack.pop();
  if (!e) return;
  redoStack.push(snapshot(e.key));
  restore(e);
  updateUndoButtons();
}
function redo() {
  const e = redoStack.pop();
  if (!e) return;
  undoStack.push(snapshot(e.key));
  restore(e);
  updateUndoButtons();
}
function clearUndo() { undoStack.length = 0; redoStack.length = 0; updateUndoButtons(); }
function updateUndoButtons() {
  $('#undo').disabled = !undoStack.length;
  $('#redo').disabled = !redoStack.length;
}

// --------------------------------------------------------------------------- painting

function pixelAt(side, e) {
  const r = side.canvas.getBoundingClientRect(), n = state.n, v = n / side.zoom, o = (n - v) / 2;
  const fx = o + ((e.clientX - r.left) / r.width) * v, fy = o + ((e.clientY - r.top) / r.height) * v;
  return {
    i: Math.min(n - 1, Math.max(0, Math.floor(fx))),
    j: Math.min(n - 1, Math.max(0, Math.floor(fy))),
    fx, fy,
  };
}

function paintValue(side, tool = state.tool) {
  if (tool === 'eraser') return [0, 0];
  const R = side.R * state.value.mag;
  return [R * Math.cos(state.value.phase), R * Math.sin(state.value.phase)];
}

let drag = null;

function onDown(side, e) {
  if (e.button !== 0) return;
  if (state.camera?.live) { pauseCamera(); toast('Camera paused: paint on the frozen picture, or press Camera again to go live.'); }
  side.canvas.setPointerCapture(e.pointerId);
  const p = pixelAt(side, e), n = state.n;
  pushUndo(side.key);
  // The tool is the one the drag began with, even if a key changes it halfway.
  drag = { side, start: p, last: p, tool: state.tool };
  const tool = drag.tool;
  if (tool === 'brush' || tool === 'eraser') {
    const [vr, vi] = paintValue(side, tool);
    paint(side.re, side.im, n, p.i, p.j, state.brush, vr, vi, { repeat: state.repeat, mirror: state.mirror });
    changed(side.key);
  } else if (tool === 'hand') {
    drag.re = side.re.slice(); drag.im = side.im.slice();
    side.canvas.classList.add('dragging');
  } else if (tool === 'mask') {
    // Snap to the origin when pressed near it: filters are centred on k = 0.
    let { i, j } = p;
    if (Math.hypot(i - n / 2, j - n / 2) < Math.max(3, n * 0.03)) { i = n / 2; j = n / 2; }
    drag.re = side.re.slice(); drag.im = side.im.slice();
    drag.cx = i; drag.cy = j;
    side.maskPreview = { cx: i, cy: j, r: 0 };
    applyMask(side, 0);
  }
  e.preventDefault();
}

function applyMask(side, r) {
  side.re.set(drag.re); side.im.set(drag.im);
  mask(side.re, side.im, state.n, drag.cx, drag.cy, r, state.maskShape === 'square' ? 'square' : 'circle', state.maskKeep, state.mirror);
  side.maskPreview = { cx: drag.cx, cy: drag.cy, r };
  changed(side.key);
}

function onMove(side, e) {
  const p = pixelAt(side, e);
  side.hover = p;
  showReadout(side, p);
  if (!drag || drag.side !== side) { schedule(); return; }
  const n = state.n, tool = drag.tool;
  if (tool === 'brush' || tool === 'eraser') {
    const [vr, vi] = paintValue(side, tool);
    stroke(side.re, side.im, n, drag.last.i, drag.last.j, p.i, p.j, state.brush, vr, vi, { repeat: state.repeat, mirror: state.mirror });
    changed(side.key);
  } else if (tool === 'hand') {
    roll(drag.re, drag.im, side.re, side.im, n, Math.round(p.fx - drag.start.fx), Math.round(p.fy - drag.start.fy));
    changed(side.key);
  } else if (tool === 'mask') {
    applyMask(side, Math.hypot(p.fx - (drag.cx + 0.5), p.fy - (drag.cy + 0.5)));
  }
  drag.last = p;
}

function onUp(side) {
  if (!drag) return;
  side.canvas.classList.remove('dragging');
  side.maskPreview = null;
  drag = null;
  schedule();
}

function showReadout(side, p) {
  const n = state.n, x = p.i - n / 2, y = n / 2 - p.j, idx = p.j * n + p.i;
  const re = side.re[idx], im = side.im[idx], mag = Math.hypot(re, im);
  const phase = mag ? `${Math.round((Math.atan2(im, re) * 180) / Math.PI)}°` : '';
  const value = `|${side.key === 'x' ? 'f' : 'F'}| ${fmt(mag)}${phase ? ' ∠ ' + phase : ''}`;
  if (side.key === 'x') {
    side.readout.textContent = `x ${x}, y ${y}   ${value}`;
  } else {
    const k = Math.hypot(x, y);
    const wave = k ? `   λ ${fmt(n / k)} px, ${Math.round((Math.atan2(y, x) * 180) / Math.PI)}°` : '   (the average)';
    side.readout.textContent = `kx ${x}, ky ${y}   ${value}${wave}`;
  }
}

for (const side of Object.values(sides)) {
  const c = side.canvas;
  c.addEventListener('pointerdown', (e) => onDown(side, e));
  c.addEventListener('pointermove', (e) => onMove(side, e));
  c.addEventListener('pointerup', () => onUp(side));
  c.addEventListener('pointercancel', () => onUp(side));
  c.addEventListener('pointerleave', () => { side.hover = null; side.readout.innerHTML = '&nbsp;'; schedule(); });
}

// -------------------------------------------------------------------------- the tools

const toolButtons = {};
for (const [tool, label, key] of [['hand', 'Hand', 'H'], ['brush', 'Brush', 'B'], ['eraser', 'Eraser', 'E'], ['mask', 'Mask', 'M']]) {
  const b = el('button', { type: 'button', 'aria-pressed': 'false', title: `${label} (${key})` });
  b.innerHTML = `${ICONS[tool]}<span>${label}</span>`;
  b.addEventListener('click', () => setTool(tool));
  $('#tool-buttons').append(b);
  toolButtons[tool] = b;
}

const sizeSlider = slider({ label: 'Size', min: 1, max: 64, step: 1, value: state.brush.size, title: 'Brush diameter in pixels ([ and ] change it)',
  onInput: (v) => { state.brush.size = Math.round(v); schedule(); } });
const shapeSeg = segmented([
  { value: 'round', label: 'Round', title: 'A hard round brush' },
  { value: 'square', label: 'Square', title: 'A hard square brush' },
  { value: 'soft', label: 'Soft', title: 'An airbrush: blends towards the colour with a Gaussian falloff' },
], state.brush.shape, (v) => { state.brush.shape = v; schedule(); }, { label: 'Brush shape' });
const maskShapeSeg = segmented([
  { value: 'circle', label: 'Circle' }, { value: 'square', label: 'Square' },
], state.maskShape, (v) => { state.maskShape = v; }, { label: 'Mask shape' });
const maskKeepSeg = segmented([
  { value: 'inside', label: 'Keep inside', title: 'Zero everything outside: centred on the transform, a low-pass filter' },
  { value: 'outside', label: 'Keep outside', title: 'Zero everything inside: centred on the transform, a high-pass filter' },
], state.maskKeep, (v) => { state.maskKeep = v; }, { label: 'Mask keeps' });
const handHint = el('div', { class: 'small muted' }, 'Drag either picture to shift it; it wraps around the edges.');
const maskHint = el('div', { class: 'small muted' }, 'Press and drag outwards. Press near the centre to centre the mask on the origin.');

function setTool(tool) {
  state.tool = tool;
  for (const [t, b] of Object.entries(toolButtons)) b.setAttribute('aria-pressed', String(t === tool));
  const box = $('#tool-options');
  box.replaceChildren();
  if (tool === 'brush' || tool === 'eraser') box.append(shapeSeg, sizeSlider);
  else if (tool === 'mask') box.append(maskShapeSeg, maskKeepSeg, maskHint);
  else box.append(handHint);
  $('#picker-box').hidden = tool !== 'brush';
  for (const s of Object.values(sides)) s.canvas.classList.toggle('hand', tool === 'hand');
  schedule();
}

// The colour picker: the complex plane out to |w| = 3, coloured as it will look when painted.
const picker = $('#picker');
const PICK_EXTENT = 3;
function drawPicker() {
  const dpr = window.devicePixelRatio || 1;
  const size = Math.round(120 * dpr);
  if (picker.width !== size) { picker.width = picker.height = size; }
  drawWheel(picker, 1, PICK_EXTENT);
  const ctx = picker.getContext('2d');
  const w = state.value;
  const m = Math.min(w.mag, PICK_EXTENT);
  const cx = size / 2 + (m * Math.cos(w.phase) * size) / (2 * PICK_EXTENT);
  const cy = size / 2 - (m * Math.sin(w.phase) * size) / (2 * PICK_EXTENT);
  ctx.lineWidth = 2 * dpr;
  ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.arc(cx, cy, 6 * dpr, 0, 2 * Math.PI); ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, 4.5 * dpr, 0, 2 * Math.PI); ctx.stroke();
  showValue();
}
function pick(e) {
  const r = picker.getBoundingClientRect();
  const u = (((e.clientX - r.left) / r.width) - 0.5) * 2 * PICK_EXTENT;
  const v = (0.5 - (e.clientY - r.top) / r.height) * 2 * PICK_EXTENT;
  state.value = { mag: Math.min(PICK_EXTENT, Math.hypot(u, v)), phase: Math.atan2(v, u) };
  drawPicker();
}
picker.addEventListener('pointerdown', (e) => { picker.setPointerCapture(e.pointerId); pick(e); });
picker.addEventListener('pointermove', (e) => { if (e.buttons) pick(e); });
for (const [label, mag, phase] of [['0', 0, 0], ['1', 1, 0], ['−1', 1, Math.PI], ['i', 1, Math.PI / 2], ['−i', 1, -Math.PI / 2]]) {
  $('#quick-values').append(el('button', { type: 'button', title: mag ? `Paint ${label} (times the brightness)` : 'Paint 0: the same as the eraser',
    onclick: () => { state.value = { mag, phase }; drawPicker(); } }, label));
}

// The paint as numbers, in either form: typing in one pair updates the other.  The box being
// typed in is left alone, so that "-" or "0." can be on the way to a number.
const valueFields = {};
for (const [key, label, title] of [['re', 'Re', 'Real part'], ['im', 'Im', 'Imaginary part'],
  ['mag', '|w|', 'Magnitude'], ['deg', '∠°', 'Phase in degrees, anticlockwise from the positive real axis']]) {
  const input = el('input', { type: 'number', step: 'any', id: `value-${key}`, title, oninput: () => typeValue(key) });
  input.addEventListener('change', showValue);
  valueFields[key] = input;
  $('#value-fields').append(el('label', { for: `value-${key}`, title }, label), input);
}
function showValue() {
  const { mag, phase } = state.value;
  const tidy = (v) => (Math.abs(v) < 1e-12 * Math.max(1, mag) ? 0 : v);
  const shown = { re: fmt(tidy(mag * Math.cos(phase))), im: fmt(tidy(mag * Math.sin(phase))),
    mag: fmt(mag), deg: fmt(tidy((phase * 180) / Math.PI)) };
  for (const [k, input] of Object.entries(valueFields)) if (input !== document.activeElement) input.value = shown[k];
}
function typeValue(key) {
  const v = Object.fromEntries(Object.entries(valueFields).map(([k, input]) => [k, input.value === '' ? NaN : +input.value]));
  let mag, phase;
  if (key === 're' || key === 'im') {
    const re = Number.isFinite(v.re) ? v.re : 0, im = Number.isFinite(v.im) ? v.im : 0;
    if (!Number.isFinite(v[key])) return;
    mag = Math.hypot(re, im); phase = mag ? Math.atan2(im, re) : state.value.phase;
  } else {
    if (!Number.isFinite(v[key])) return;
    mag = Number.isFinite(v.mag) ? v.mag : state.value.mag;
    phase = Number.isFinite(v.deg) ? (v.deg * Math.PI) / 180 : state.value.phase;
    if (mag < 0) { mag = -mag; phase += Math.PI; }
  }
  state.value = { mag, phase };
  drawPicker();
}

const mirrorToggle = toggle('Mirror', state.mirror, (on) => { state.mirror = on; },
  'Also paint the mirror point through the origin with the complex conjugate, so that the other picture stays real');
const repeatSelect = el('select', { 'aria-label': 'Repeat each mark on a lattice', title: 'Repeat every mark on a lattice (convolution with a comb)' },
  ...[1, 2, 4, 8, 16].map((m) => el('option', { value: m }, m === 1 ? 'No repeat' : `Repeat ${m}×${m}`)));
repeatSelect.addEventListener('change', () => { state.repeat = +repeatSelect.value; });
$('#paint-options').append(mirrorToggle, repeatSelect);

// ----------------------------------------------------------- display modes and operations

for (const side of Object.values(sides)) {
  const mode = $('select.mode', side.root);
  for (const [k, v] of Object.entries(MODES)) mode.append(el('option', { value: k }, v));
  mode.addEventListener('change', () => { side.mode = mode.value; side.modeAuto = false; side.stale = true; schedule(); });
  side.modeSelect = mode;

  const zoom = el('select', { class: 'zoom', 'aria-label': 'Zoom', title: 'Magnify the middle of the picture' },
    ...[1, 2, 4, 8].map((z) => el('option', { value: z }, z === 1 ? 'Whole' : `${z}× zoom`)));
  zoom.addEventListener('change', () => { side.zoom = +zoom.value; schedule(); });
  mode.after(zoom);
  side.zoomSelect = zoom;

  const ops = $('select.ops', side.root);
  $('.side-foot', side.root).append(el('div', { class: 'foot-row' }, ops, side.readout));
  ops.append(el('option', { value: '', disabled: true, selected: true }, 'Operations…'));
  for (const [k, op] of Object.entries(OPERATIONS)) ops.append(el('option', { value: k, title: op.title }, op.label));
  ops.append(el('option', { value: '', disabled: true }, '──────────'));
  ops.append(el('option', { value: 'remember', title: 'Keep a copy of this picture for the two items below' }, 'Remember this'));
  ops.append(el('option', { value: 'graft-phase', title: 'Keep this magnitude, take the phase from the remembered picture' }, 'Use remembered phase'));
  ops.append(el('option', { value: 'graft-magnitude', title: 'Keep this phase, take the magnitude from the remembered picture' }, 'Use remembered magnitude'));
  ops.addEventListener('change', () => { runOperation(side, ops.value); ops.value = ''; });

  const b = slider({ label: 'Brightness', min: -3, max: 3, step: 0.01, value: 0,
    title: 'How bright to draw (only the drawing changes, not the data); in factors of 10',
    onInput: (v) => { side.bright = v; side.stale = true; schedule(); } });
  const auto = el('button', { type: 'button', title: 'Choose a brightness that suits the data' }, 'Auto');
  auto.addEventListener('click', () => { autoBright(side.key); schedule(); });
  b.append(auto);
  b.style.gridTemplateColumns = '5.4em 1fr 4.4em auto';
  $('.bright', side.root).append(b);
  side.brightSlider = b;
}

function runOperation(side, what) {
  if (!what) return;
  if (what === 'remember') {
    state.memory = { n: state.n, re: side.re.slice(), im: side.im.slice() };
    toast('Remembered.  Load another picture, then use its phase or magnitude.');
    return;
  }
  if (what.startsWith('graft')) {
    if (!state.memory || state.memory.n !== state.n) { toast('Choose "Remember this" on a picture first (at this resolution).'); return; }
    pushUndo(side.key);
    graft(side.re, side.im, state.memory.re, state.memory.im, what === 'graft-phase' ? 'magnitude' : 'phase');
    changed(side.key);
    return;
  }
  pushUndo(side.key);
  OPERATIONS[what].run(side.re, side.im, state.n);
  changed(side.key);
}

// ---------------------------------------------------------------------- the gallery

const sizeBox = $('#size-box');
const presetSize = slider({ label: 'Size', min: 0.25, max: 4, log: true, value: 1,
  title: 'Scale the shape: bigger in the image means smaller in the transform',
  onInput: (v) => { state.size = v; loadPreset(state.preset, { keepBrightness: true }); } });
sizeBox.append(presetSize);

const presetButtons = {};
for (const p of PRESETS) {
  const thumb = el('canvas', { width: 64, height: 64 });
  const b = el('button', { type: 'button', title: p.title, 'aria-pressed': 'false', onclick: () => loadPreset(p.id) }, thumb, p.label);
  $('#presets').append(b);
  presetButtons[p.id] = b;
  makePreset(p, 64, 1).then(([re, im]) => {
    const ctx = thumb.getContext('2d'), img = ctx.createImageData(64, 64);
    const R = p.side === 'x' ? autoBrightness(re, im, 0.5) : Math.max(...re.map(Math.abs)) / 2;
    colorize(re, im, img.data, R, isRealPositive(re, im) ? 'grey' : 'complex');
    ctx.putImageData(img, 0, 0);
  }).catch(() => {});
}

async function loadPreset(id, { keepBrightness = false, push = true } = {}) {
  const p = PRESETS.find((q) => q.id === id) || PRESETS[0];
  if (state.camera) stopCamera();
  if (push && !keepBrightness) pushUndo(p.side);
  let data;
  try { data = await makePreset(p, state.n, state.size); }
  catch (err) { toast(err.message); return; }
  state.preset = p.id;
  state.customImage = null;
  setData(p.side, data[0], data[1], !keepBrightness);
  for (const [k, b] of Object.entries(presetButtons)) b.setAttribute('aria-pressed', String(k === p.id));
  sizeBox.style.visibility = p.sized ? 'visible' : 'hidden';
  updateHash();
}

function setData(key, re, im, rebright = true) {
  quietAuto = true;
  sides[key].re.set(re);
  sides[key].im.set(im);
  transformFrom(key);
  if (rebright) { autoBright('x'); autoBright('k'); }
  state.modified = false;
  schedule();
}

function updateHash() {
  writeHash({ preset: state.customImage ? undefined : state.preset, n: state.n !== 256 ? state.n : undefined,
    size: state.size !== 1 ? +state.size.toPrecision(3) : undefined });
}

// Pictures of your own: the file button, dropping onto the image, or pasting.
async function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) { toast('That is not a picture.'); return; }
  try {
    const img = await createImageBitmap(file);
    if (state.camera) stopCamera();
    pushUndo('x');
    state.customImage = img;
    state.preset = 'custom';
    const [re, im] = imageData(img, state.n, 'fit');
    setData('x', re, im);
    for (const b of Object.values(presetButtons)) b.setAttribute('aria-pressed', 'false');
    sizeBox.style.visibility = 'hidden';
    updateHash();
  } catch { toast('Could not read that picture.'); }
}
$('#upload').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', (e) => loadFile(e.target.files[0]));
const dropZone = $('#side-x .canvas-wrap');
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drop'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drop'));
dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('drop'); loadFile(e.dataTransfer.files[0]); });
document.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) loadFile(item.getAsFile());
});

// The camera: the image is the camera's picture, transformed every frame.
const cameraButton = $('#camera');
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    const video = el('video', { muted: true, playsInline: true });
    video.srcObject = stream;
    await video.play();
    state.camera = { stream, video, live: true, first: true };
    state.preset = 'camera';
    for (const b of Object.values(presetButtons)) b.setAttribute('aria-pressed', 'false');
    sizeBox.style.visibility = 'hidden';
    cameraButton.setAttribute('aria-pressed', 'true');
    pushUndo('x');
    schedule();
  } catch (err) {
    toast(location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? 'No camera available (or permission was refused).' : 'Browsers allow the camera only on https:// pages.');
  }
}
function grabCamera() {
  const cam = state.camera;
  if (cam.video.readyState < 2) return;
  const [re, im] = imageData(cam.video, state.n, 'fit');
  // A mirror image, as people expect of a camera facing them.
  const n = state.n, x = sides.x;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { x.re[j * n + i] = re[j * n + (n - 1 - i)]; x.im[j * n + i] = im[j * n + (n - 1 - i)]; }
  pending = 'x';
  if (cam.first) { transformFrom('x'); autoBright('x'); autoBright('k'); cam.first = false; }
}
function pauseCamera() {
  if (!state.camera) return;
  state.camera.live = false;
  cameraButton.setAttribute('aria-pressed', 'false');
  cameraButton.textContent = 'Camera (paused)';
}
function stopCamera() {
  if (!state.camera) return;
  state.camera.stream.getTracks().forEach((t) => t.stop());
  state.camera = null;
  cameraButton.setAttribute('aria-pressed', 'false');
  cameraButton.textContent = 'Camera';
}
cameraButton.addEventListener('click', () => {
  if (!state.camera) startCamera();
  else if (state.camera.live) stopCamera();
  else { state.camera.live = true; cameraButton.setAttribute('aria-pressed', 'true'); cameraButton.textContent = 'Camera'; schedule(); }
});

// ----------------------------------------------------------------------- resolution

const resolution = segmented([64, 128, 256, 512].map((m) => ({ value: m, label: String(m), title: `${m} × ${m} pixels` })),
  state.n, (m) => setResolution(m), { label: 'Resolution' });
$('#resolution').append(resolution);

async function setResolution(m) {
  if (m === state.n) return;
  const old = state.n, x = sides.x;
  let data = null;
  // Painted on, or a frozen camera picture: keep it, resampled.
  if ((state.modified && !state.camera) || (state.camera && !state.camera.live)) data = resample(x.re, x.im, old, m);
  state.n = m;
  sides.x.alloc(m); sides.k.alloc(m);
  clearUndo();
  state.memory = null;
  if (data) setData('x', data[0], data[1]);
  else if (state.customImage) { const [re, im] = imageData(state.customImage, m, 'fit'); setData('x', re, im); }
  else if (state.camera?.live) { state.camera.first = true; schedule(); }
  else await loadPreset(state.preset, { push: false });
  updateHash();
}

// ------------------------------------------------------------------------- keyboard

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod || e.altKey) return;
  const tools = { h: 'hand', b: 'brush', e: 'eraser', m: 'mask' };
  if (tools[e.key.toLowerCase()]) { setTool(tools[e.key.toLowerCase()]); return; }
  if (e.key === '[' || e.key === ']') {
    const s = Math.max(1, Math.min(64, Math.round(state.brush.size * (e.key === ']' ? 1.25 : 0.8)) + (e.key === ']' ? 1 : -1) * (state.brush.size < 4 ? 1 : 0)));
    state.brush.size = s; sizeSlider.value = s; schedule();
  }
});
$('#undo').addEventListener('click', undo);
$('#redo').addEventListener('click', redo);

// ----------------------------------------------------------------------- experiments

function setMode(key, mode) {
  const side = sides[key];
  side.modeAuto = mode === 'auto';
  side.mode = mode === 'auto' ? side.mode : mode;
  side.modeSelect.value = side.mode;
  side.stale = true;
}
function reset({ tool = 'brush', modes = ['auto', 'complex'], mirror = false, repeat = 1 } = {}) {
  setMode('x', modes[0]); setMode('k', modes[1]);
  state.mirror = mirror; mirrorToggle.on = mirror;
  state.repeat = repeat; repeatSelect.value = repeat;
  state.size = 1; presetSize.value = 1;
  for (const s of Object.values(sides)) { s.zoom = 1; s.zoomSelect.value = 1; }
  setTool(tool);
}

const setups = {
  async jacket() {
    reset({ tool: 'eraser', mirror: true });
    state.brush.shape = 'round'; shapeSeg.value = 'round';
    state.brush.size = Math.round(state.n / 20); sizeSlider.value = state.brush.size;
    await loadPreset('jacket');
  },
  async lowpass() {
    reset({ tool: 'mask' });
    state.maskKeep = 'inside'; maskKeepSeg.value = 'inside';
    await loadPreset('portrait');
  },
  async highpass() {
    reset({ tool: 'mask' });
    state.maskKeep = 'outside'; maskKeepSeg.value = 'outside';
    await loadPreset('portrait');
  },
  async gaussian() { reset(); await loadPreset('gaussian'); },
  async shift() { reset({ tool: 'hand', modes: ['auto', 'magnitude'] }); await loadPreset('portrait'); },
  async box() { reset(); await loadPreset('box'); sides.k.bright = 1; sides.k.brightSlider.value = 1; sides.k.stale = true; schedule(); },
  async slits() { reset({ modes: ['auto', 'intensity'] }); await loadPreset('double'); },
  async lattice() { reset(); await loadPreset('lattice'); },
  async hermitian() { reset({ tool: 'brush', mirror: false }); await loadPreset('portrait'); },
  async phase() {
    reset();
    await loadPreset('portrait');
    runOperation(sides.k, 'magnitude');
  },
  async swap() {
    reset();
    await loadPreset('portrait');
    runOperation(sides.k, 'remember');
    await loadPreset('author');
    runOperation(sides.k, 'graft-phase');
  },
  async wave() {
    reset({ tool: 'hand' });
    await loadPreset('wave');
    for (const s of Object.values(sides)) { s.zoom = 1; s.zoomSelect.value = 1; }
    sides.k.zoom = 8; sides.k.zoomSelect.value = 8;
  },
  async comb() {
    reset({ tool: 'brush', repeat: 4 });
    await loadPreset('portrait');
    runOperation(sides.x, 'clear');
    state.brush.shape = 'soft'; shapeSeg.value = 'soft';
    state.brush.size = Math.round(state.n / 12); sizeSlider.value = state.brush.size;
    state.value = { mag: 1.5, phase: 0 }; drawPicker();
    sides.x.autoR = 0.5; sides.k.autoR = 0.1;
    // One mark to start with, so the comb shows at once.
    const n = state.n;
    paint(sides.x.re, sides.x.im, n, n / 2 - n / 16, n / 2 - n / 20, { ...state.brush, strength: 1 }, 0.75, 0, { repeat: 4 });
    changed('x');
  },
};

const help = drawer($('#help'), $('#help-button'), setups);
drawWheel($('#legend'), 1, 3);

// ---------------------------------------------------------------------------- start

const hash = readHash();
if ([64, 128, 256, 512].includes(+hash.n)) { state.n = +hash.n; resolution.value = state.n; sides.x.alloc(state.n); sides.k.alloc(state.n); }
if (+hash.size > 0) { state.size = +hash.size; presetSize.value = state.size; }
setTool(state.tool);
drawPicker();
updateUndoButtons();
window.addEventListener('resize', drawPicker);
const ready = setups[hash.setup]
  ? setups[hash.setup]().then(() => help.open())
  : loadPreset(PRESETS.some((p) => p.id === hash.preset) ? hash.preset : 'portrait', { push: false });

// For the tests (tools/cdp.py) and for curious students with the console open.
window.__app = { state, sides, setups, loadPreset, setResolution, setTool, runOperation, undo, redo, ready: false };
ready.then(() => { window.__app.ready = true; });
