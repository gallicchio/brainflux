// Holography: record the interference of an object wave and a reference wave on a camera, then
// light the recording to bring the object back.  The physics is in holo.js; this is the page.
// Lengths are kept in micrometres and angles in radians; the controls show mm, nm and degrees.

import {
  field, pointWave, planeWave, sphericalWave, pictureWave, diffuser, record, quantize, lens, look,
  viewImage, spectrum, images, pointDescription, planeDescription, sphereDescription, criticalDistance,
} from './holo.js';
import { fft2Centered } from '../lib/fft.js';
import { colorize } from '../lib/complexcolor.js';
import { paint, stroke as paintStroke, mask as maskOut } from '../fft2d/tools.js';
import { el, $, slider, segmented, toggle, drawer, readHash, writeHash, fmt } from '../lib/ui.js';
import { fitCanvas, themeColors, niceTicks, tickLabel } from '../lib/plot.js';

const N = 256, HN = N / 2;
const MM = 1000, DEG = Math.PI / 180;

// ------------------------------------------------------------------------------- state

const DEFAULTS = () => ({
  lambda: 0.633, pitch: 5,
  object: 'points',
  points: [
    { x: -450, y: 250, z: 60000, b: 1 },
    { x: 350, y: -300, z: 90000, b: 1 },
    { x: 50, y: 500, z: 130000, b: 1 },
  ],
  sel: 1,
  picture: 'F', picZ: 150000, picSize: 5000, diffuser: true,
  ref: 'plane', theta: 2.3 * DEG, refSrc: { x: 0, y: -1500, z: 60000 },
  ratio: 0.3, bits: 0,
  relight: 'ref', sameColour: true, lambda2: 0.633,
  focus: 90000,
  window: false, win: { x: 0, y: 0, r: 200 },
  tool: 'window', brush: 16,
  zoomH: 2, zoomS: 1, zoomR: 4, brightS: 0, brightR: 0,
  sweepFocus: false, sweepWindow: false,
});
let state = DEFAULTS();

const plateL = () => N * state.pitch;
const sinMax = () => state.lambda / (2 * state.pitch);
const dU = () => state.lambda / (N * state.pitch);             // one display pixel, radians
const lam2 = () => (state.sameColour ? state.lambda : state.lambda2);

// ---------------------------------------------------------------------------- pictures

// Brightness 0..1 on [-1/2, 1/2]^2, y up.
function letterF(u, v) {
  const s = 0.2;
  return (u >= -2.5 * s && u < -1.5 * s && Math.abs(v) <= 2.5 * s)
    || (v > 1.5 * s && v <= 2.5 * s && u >= -2.5 * s && u <= 2.5 * s)
    || (v > -0.5 * s && v <= 0.5 * s && u >= -2.5 * s && u <= 1.5 * s) ? 1 : 0;
}
function bars(u, v) {
  // Three bars of each width, upright on the left and lying down on the right; wide at the top.
  for (const [vc, w] of [[0.3, 0.06], [0, 0.04], [-0.3, 0.025]]) {
    const y = v - (vc - 2.5 * w);
    if (y < 0 || y >= 5 * w) continue;
    const x = u + 0.45;
    if (x >= 0 && x < 5 * w && Math.floor(x / w) % 2 === 0) return 1;
    if (u >= 0.08 && u < 0.45 && Math.floor(y / w) % 2 === 0) return 1;
  }
  return 0;
}
const PICTURES = {
  F: { label: 'Letter F', title: 'A letter F: lopsided, so it can be told from its mirror image', f: letterF },
  bars: { label: 'Bars', title: 'Bars of three widths, to judge the resolution', f: bars },
  fourier: { label: 'Fourier', title: 'Joseph Fourier, engraved by Geille after a drawing by J. Boilly (public domain)', image: '../fft2d/images/fourier-portrait.png' },
};
const pictureImages = {};
let picVersion = 0;
function loadPicture(id) {
  const P = PICTURES[id];
  if (!P.image || pictureImages[id]) return;
  pictureImages[id] = 'loading';
  const img = new Image();
  img.onload = () => { pictureImages[id] = img; picVersion++; schedule(); };
  img.onerror = () => { pictureImages[id] = null; };
  img.src = P.image;
}

/** The picture's brightness on the n x n grid of directions, w samples wide, centred. */
function rasterize(id, w) {
  const B = new Float64Array(N * N), P = PICTURES[id];
  if (P.f) {
    const lo = Math.max(0, Math.floor(HN - w / 2)), hi = Math.min(N - 1, Math.ceil(HN + w / 2));
    for (let j = lo; j <= hi; j++) for (let i = lo; i <= hi; i++) {
      let v = 0;   // 3 x 3 samples per pixel: soft edges
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) v += P.f((i - HN + a / 3) / w, (HN - j + b / 3) / w);
      B[j * N + i] = v / 9;
    }
    return B;
  }
  const img = pictureImages[id];
  if (!(img instanceof HTMLImageElement)) return B;
  const c = document.createElement('canvas'); c.width = c.height = N;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, N, N);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, HN - w / 2, HN - w / 2, w, w);
  const d = ctx.getImageData(0, 0, N, N).data;
  for (let o = 0; o < N * N; o++) B[o] = (d[4 * o] + d[4 * o + 1] + d[4 * o + 2]) / 765;
  return B;
}

// ------------------------------------------------------------------------- the pipeline

const D = diffuser(N, 7);                   // the same ground glass every time
const W = {
  O: field(N), R: field(N), Hraw: new Float64Array(N * N), H: new Float64Array(N * N),
  mask: new Float64Array(N * N).fill(1), junk: new Float64Array(N * N),
  S: field(N), C: field(N), L: field(N), eye: field(N), view: new Float32Array(N * N),
  OR: field(N), picB: null,
};
const keys = {};
let maskVersion = 0;
const pointCache = new WeakMap();
const islands = { image: null, twin: null, auto: null };

function objectWave() {
  const { O } = W, p = state.pitch, lam = state.lambda;
  if (state.object === 'points') {
    O.re.fill(0); O.im.fill(0);
    for (const pt of state.points) {
      const key = [pt.x, pt.y, pt.z, pt.b, lam, p].join();
      let c = pointCache.get(pt);
      if (!c || c.key !== key) {
        c = { key, f: c?.f || field(N) };
        pointWave(N, p, lam, { x: pt.x, y: pt.y, z: pt.z, a: pt.b }, c.f);
        pointCache.set(pt, c);
      }
      for (let o = 0; o < N * N; o++) { O.re[o] += c.f.re[o]; O.im[o] += c.f.im[o]; }
    }
  } else {
    const w = state.picSize / (state.picZ * dU());
    const B = rasterize(state.picture, w);
    W.picB = B;
    const t = field(N);
    for (let o = 0; o < N * N; o++) {
      const a = Math.sqrt(B[o]);
      if (state.diffuser) { t.re[o] = a * D.re[o]; t.im[o] = a * D.im[o]; } else t.re[o] = a;
    }
    pictureWave(t, N, p, lam, state.picZ, O);
  }
  // The object's light at the plate, scaled so that its r.m.s. amplitude is the beam ratio.
  let s = 0;
  for (let o = 0; o < N * N; o++) s += O.re[o] * O.re[o] + O.im[o] * O.im[o];
  const g = s > 0 ? state.ratio / Math.sqrt(s / (N * N)) : 0;
  for (let o = 0; o < N * N; o++) { O.re[o] *= g; O.im[o] *= g; }
}

function referenceWave(lam, out, conj = false) {
  if (state.ref === 'plane') planeWave(N, state.pitch, lam, state.theta, out, conj);
  else sphericalWave(N, state.pitch, lam, state.refSrc, out, conj);
}

/** Paraxial descriptions of the waves, for images() and the islands. */
const refDesc = (conj = false) => (state.ref === 'plane' ? planeDescription(state.theta, conj) : sphereDescription(state.refSrc, conj));
const objectPoints = () => (state.object === 'points' ? state.points : [{ x: 0, y: 0, z: state.picZ }]);

function compute() {
  const p = state.pitch, lam = state.lambda, l2 = lam2();
  const objKey = state.object === 'points'
    ? 'P' + state.points.map((pt) => [pt.x, pt.y, pt.z, pt.b].join()).join(';')
    : 'I' + [state.picture, state.picZ, state.picSize, state.diffuser, picVersion].join();
  const kO = [objKey, lam, p, state.ratio].join('|');
  const kR = [state.ref, state.theta, state.refSrc.x, state.refSrc.y, state.refSrc.z, lam, p].join('|');
  const changedO = kO !== keys.O, changedR = kR !== keys.R;
  if (changedO) { objectWave(); keys.O = kO; }
  if (changedR) { referenceWave(lam, W.R); keys.R = kR; }
  if (changedO || changedR) findIslands();
  const kH = [kO, kR, state.bits, maskVersion].join('#');
  if (kH !== keys.H) {
    record(W.O, W.R, W.Hraw);
    if (state.bits > 0) quantize(W.Hraw, state.bits);
    for (let o = 0; o < N * N; o++) W.H[o] = W.Hraw[o] * W.mask[o];
    spectrum(W.H, N, W.S);
    keys.H = kH;
    stale.holo = stale.spec = true;
  }
  const kC = [state.relight, state.ref, state.theta, state.refSrc.x, state.refSrc.y, state.refSrc.z, l2, p].join('|');
  if (kC !== keys.C) { referenceWave(l2, W.C, state.relight === 'conj'); keys.C = kC; }
  const kL = [state.focus, l2, p].join();
  if (kL !== keys.L) { lens(N, p, l2, state.focus, W.L); keys.L = kL; }
  const win = state.window ? state.win : null;
  const kE = [kH, kC, kL, win ? [win.x, win.y, win.r].join() : '', lam].join('#');
  if (kE !== keys.E) {
    look(W.H, W.C, W.L, N, p, win, W.eye);
    viewImage(W.eye, N, state.focus, l2 / lam, W.view);
    keys.E = kE;
    stale.recon = true;
  }
}

/**
 * The islands of the hologram's transform, as boxes of directions [x0, x1, y0, y1] (sines):
 * the image term O R*, its twin O* R (the image's mirror through the middle) and the object
 * interfering with itself, |O|^2, round the middle.  A wave's local direction at plate point r
 * is c r - t (holo.js), so each island is bounded by its values at the plate's corners: for
 * points, and for the corners of a picture seen through ground glass (each of its points lights
 * the whole plate).  A picture without a diffuser sends its light more or less straight on; its
 * spread is measured from the transform of O.
 */
function findIslands() {
  const hl = plateL() / 2, R = refDesc(), corners = [[-hl, -hl], [-hl, hl], [hl, -hl], [hl, hl]];
  const box = () => [Infinity, -Infinity, Infinity, -Infinity];
  const grow = (b, x, y) => { b[0] = Math.min(b[0], x); b[1] = Math.max(b[1], x); b[2] = Math.min(b[2], y); b[3] = Math.max(b[3], y); };
  let img = box(), auto = [0, 0, 0, 0], sources = null;
  if (state.object === 'points') sources = state.points.filter((pt) => pt.b > 0).map(pointDescription);
  else if (state.diffuser) {
    const s = state.picSize / 2;
    sources = [[-s, -s], [-s, s], [s, -s], [s, s]].map(([x, y]) => pointDescription({ x, y, z: state.picZ }));
  }
  if (sources) {
    for (const O of sources) {
      for (const [rx, ry] of corners) grow(img, (O.c - R.c) * rx - (O.tx - R.tx), (O.c - R.c) * ry - (O.ty - R.ty));
      // |O|^2: each pair interferes, with directions (c_i - c_j) r - (t_i - t_j).
      for (const Q of sources) for (const [rx, ry] of corners) grow(auto, (O.c - Q.c) * rx - (O.tx - Q.tx), (O.c - Q.c) * ry - (O.ty - Q.ty));
    }
  } else {
    // The box of directions holding all but 1% of the object's light, then moved by the
    // reference's directions across the plate (c_R r - t_R).
    const { OR, O } = W;
    OR.re.set(O.re); OR.im.set(O.im);
    fft2Centered(OR.re, OR.im, N, N);
    const px = new Float64Array(N), py = new Float64Array(N);
    let tot = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const v = OR.re[j * N + i] ** 2 + OR.im[j * N + i] ** 2; px[i] += v; py[j] += v; tot += v; }
    const range = (arr) => { let a = 0, lo = 0, hi = N - 1; for (let i = 0; i < N; i++) { a += arr[i]; if (a < 0.005 * tot) lo = i + 1; if (a < 0.995 * tot) hi = i + 1; } return [lo, hi]; };
    const [i0, i1] = range(px), [j0, j1] = range(py), u = dU();
    const o = [(i0 - HN) * u, (i1 - HN) * u, (HN - j1) * u, (HN - j0) * u];
    const rx = [-R.c * hl - R.tx, R.c * hl - R.tx], ry = [-R.c * hl - R.ty, R.c * hl - R.ty];
    img = [o[0] - Math.max(...rx), o[1] - Math.min(...rx), o[2] - Math.max(...ry), o[3] - Math.min(...ry)];
    const wx = o[1] - o[0], wy = o[3] - o[2];
    auto = [-wx, wx, -wy, wy];
  }
  if (!Number.isFinite(img[0])) { islands.image = islands.twin = islands.auto = null; return; }
  islands.image = img;
  islands.twin = [-img[1], -img[0], -img[3], -img[2]];
  islands.auto = auto;
}
const overlaps = (a, b) => a && b && a[0] < b[1] && b[0] < a[1] && a[2] < b[3] && b[2] < a[3];

// ---------------------------------------------------------------------------- drawing

const stale = { holo: true, spec: true, recon: true };
let raf = 0;
function schedule() { if (!raf) raf = requestAnimationFrame(frame); }
let hashTimer = 0;
function changed() { schedule(); clearTimeout(hashTimer); hashTimer = setTimeout(updateHash, 300); }

let t0 = performance.now();
function frame(now) {
  raf = 0;
  const t = (now - t0) / 1000;
  if (state.sweepFocus) {
    const [a, b] = sweepRange();
    state.focus = a + (b - a) * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 8));
    focusSlider.value = +(state.focus / MM).toFixed(2);
  }
  if (state.sweepWindow && state.window) {
    const reach = Math.max(0, plateL() / 2 - state.win.r);
    state.win.x = reach * Math.sin((2 * Math.PI * t) / 6);
  }
  compute();
  if (stale.holo) drawHolo();
  if (stale.spec) drawSpec();
  if (stale.recon) drawRecon();
  stale.holo = stale.spec = stale.recon = false;
  drawSide(); drawFront(); updateNotes();
  if (state.sweepFocus || (state.sweepWindow && state.window)) schedule();
}

/** An approximate colour for a wavelength in micrometres (after Dan Bruton), as in diffraction/. */
function wavelengthRGB(lam) {
  const w = lam * 1000;
  let r = 0, g = 0, b = 0;
  if (w < 440) { r = -(w - 440) / 60; b = 1; } else if (w < 490) { g = (w - 440) / 50; b = 1; }
  else if (w < 510) { g = 1; b = -(w - 510) / 20; } else if (w < 580) { r = (w - 510) / 70; g = 1; }
  else if (w < 645) { r = 1; g = -(w - 645) / 65; } else r = 1;
  const f = w < 420 ? 0.3 + (0.7 * (w - 380)) / 40 : w > 700 ? 0.3 + (0.7 * (780 - w)) / 80 : 1;
  return [r * f, g * f, b * f];
}
const cssRGB = (rgb, a = 1) => `rgba(${rgb.map((c) => Math.round(255 * Math.min(1, c * 1.0 + 0.15))).join(',')},${a})`;

const off = document.createElement('canvas'); off.width = off.height = N;
const offCtx = off.getContext('2d');
const offImg = offCtx.createImageData(N, N);

/** Draw the N x N image in offImg into a canvas, magnified about the middle. */
function blit(cv, zoom, smooth) {
  const { ctx, width, height } = fitCanvas(cv);
  offCtx.putImageData(offImg, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = smooth;
  const v = N / zoom, o = (N - v) / 2;
  ctx.drawImage(off, o, o, v, v, 0, 0, width, height);
  return { ctx, width, height };
}
/** Canvas position (CSS pixels) of the plate pixel coordinate (fi, fj), under a zoom. */
const toCanvas = (fi, fj, zoom, w) => [((fi - HN) * zoom / N + 0.5) * w, ((fj - HN) * zoom / N + 0.5) * w];

function scaleBar(ctx, w, h, pxPerUnit, unit, maxFrac = 0.28) {
  const target = (w * maxFrac) / pxPerUnit, p10 = 10 ** Math.floor(Math.log10(target));
  const len = [5, 2, 1].map((m) => m * p10).find((v) => v <= target) || p10;
  const px = len * pxPerUnit;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(10, h - 12, px, 3);
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${tickLabel(len)} ${unit}`, 10, h - 17);
}

function drawHolo() {
  const H = W.H, m = W.mask, d = offImg.data;
  let min = Infinity, max = -Infinity;
  for (let o = 0; o < N * N; o++) if (m[o] > 0) { const v = H[o]; if (v < min) min = v; if (v > max) max = v; }
  const span = max - min || 1;
  for (let o = 0; o < N * N; o++) {
    if (m[o] > 0) { const g = (255 * (H[o] - min)) / span; d[4 * o] = d[4 * o + 1] = d[4 * o + 2] = g; }
    else { const k = ((o % N) + Math.floor(o / N)) % 8 < 4; d[4 * o] = k ? 70 : 52; d[4 * o + 1] = k ? 38 : 30; d[4 * o + 2] = k ? 30 : 26; }
    d[4 * o + 3] = 255;
  }
  const z = state.zoomH, { ctx, width, height } = blit($('#holo'), z, false);
  if (state.window) {
    const fi = HN + state.win.x / state.pitch, fj = HN - state.win.y / state.pitch;
    const [cx, cy] = toCanvas(fi, fj, z, width), r = (state.win.r / state.pitch) * (z / N) * width;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(120,200,255,0.95)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.stroke();
  }
  if (pieceDrag?.r !== undefined) {
    const [cx, cy] = toCanvas(pieceDrag.cx + 0.5, pieceDrag.cy + 0.5, z, width), r = pieceDrag.r * (z / N) * width;
    ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.25;
    ctx.strokeRect(cx - r, cy - r, 2 * r, 2 * r); ctx.setLineDash([]);
  }
  // pixels per micrometre on the canvas
  scaleBar(ctx, width, height, (z * width) / (N * state.pitch), 'µm');
}

/** The q-quantile of every stride-th value. */
function percentile(arr, q, stride = 5) {
  const s = new Float32Array(Math.ceil(arr.length / stride));
  for (let o = 0, k = 0; o < arr.length; o += stride, k++) s[k] = arr[o];
  s.sort();
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
}

/** Canvas position of a direction (sines, x right and y up) on a view of N bins, magnified. */
function dirToCanvas(dx, dy, zoom, w) {
  const u = dU();
  return toCanvas(HN + dx / u + 0.5, HN - dy / u + 0.5, zoom, w);
}

function drawSpec() {
  const { re, im } = W.S, mag = new Float32Array(N * N);
  for (let o = 0; o < N * N; o++) mag[o] = Math.hypot(re[o], im[o]);
  // Bright enough to show the islands, which are far fainter than the middle.
  const R = Math.max(percentile(mag, 0.95), 1e-6 * mag[HN * N + HN]) * 10 ** -state.brightS;
  colorize(re, im, offImg.data, R, 'magnitude');
  const z = state.zoomS, { ctx, width, height } = blit($('#spec'), z, false);
  if (islands.image) {
    const mid = (b) => [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2];
    const ci = mid(islands.image), ct = mid(islands.twin);
    if (Math.hypot(ci[0] - ct[0], ci[1] - ct[1]) / dU() > 30) {
      for (const [d, text] of [[ci, 'image'], [ct, 'twin'], [[0, 0], 'zero order']]) {
        const [x, y] = dirToCanvas(d[0], d[1], z, width);
        if (x > 0 && y > 0 && x < width && y < height) label(ctx, x, y, text, width, height);
      }
    }
  }
  scaleBar(ctx, width, height, (z * width) / N / (dU() * 1000), 'mrad');
}

function label(ctx, x, y, text, w, h) {
  ctx.font = '12px system-ui, sans-serif';
  const tw = ctx.measureText(text).width + 8;
  const lx = Math.max(2, Math.min(w - tw - 2, x - tw / 2)), ly = Math.max(2, Math.min(h - 18, y - 9));
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(lx, ly, tw, 17);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, lx + 4, ly + 9);
}

function drawRecon() {
  const I = W.view, d = offImg.data, z = state.zoomR;
  // The brightness suits the middle half of what is shown, where the image is (off axis the
  // zero order and the twin are off to the sides).  The brightest 1% there saturate and turn
  // white, like a laser spot, so that a focused point does not leave everything else dark.
  const v = N / (2 * z), lo = (N - v) / 2, mid = new Float32Array(v * v);
  let max = 0;
  for (let j = 0; j < v; j++) for (let i = 0; i < v; i++) { const x = I[(j + lo) * N + i + lo]; mid[j * v + i] = x; if (x > max) max = x; }
  const ref = Math.max(percentile(mid, 0.99, 1), max * 0.002, 1e-30);
  const k = 10 ** state.brightR / ref, rgb = wavelengthRGB(lam2());
  for (let o = 0; o < N * N; o++) {
    // Black to the laser's colour (reached at a third of the reference amplitude) to white.
    const a = Math.sqrt(I[o] * k), c = Math.min(1, 1.6 * a), w = Math.min(1, Math.max(0, (a - 0.6) / 1.4)) * 0.85;
    d[4 * o] = 255 * (rgb[0] * c * (1 - w) + w); d[4 * o + 1] = 255 * (rgb[1] * c * (1 - w) + w);
    d[4 * o + 2] = 255 * (rgb[2] * c * (1 - w) + w); d[4 * o + 3] = 255;
  }
  const { ctx, width, height } = blit($('#recon'), z, true);
  // Labels where the zero order and the twin land, unless they are on the image.  A wave of
  // tilt t (holo.js) is drawn at t sign(d), and the camera's directions repeat every N bins.
  const sg = state.focus < 0 ? -1 : 1, u = dU(), period = N * (lam2() / state.lambda);
  const wrap = (v) => v - period * Math.round(v / period);
  const pts = objectPoints(), mean = (f) => pts.reduce((a, q) => a + f(q), 0) / pts.length;
  const O = { c: mean((q) => 1 / q.z), tx: mean((q) => q.x / q.z), ty: mean((q) => q.y / q.z) };
  const C = refDesc(state.relight === 'conj'), im = images(O, refDesc(), C, lam2() / state.lambda);
  const at = (t) => [wrap((sg * t.tx) / u), wrap((sg * t.ty) / u)];
  // Lit by the conjugate, the real image (the twin term) is the one to look at, and the other
  // term is the virtual image.
  const conj = state.relight === 'conj', image = at(tiltOf(conj ? im.twin : im.image));
  const other = conj ? ['virtual image', at(tiltOf(im.image))] : ['twin', at(tiltOf(im.twin))];
  for (const [text, [x, y]] of [['zero order', at(C)], other]) {
    if (Math.hypot(x - image[0], y - image[1]) < 28) continue;
    const [cx, cy] = toCanvas(HN + x + 0.5, HN - y + 0.5, z, width);
    if (cx > 0 && cy > 0 && cx < width && cy < height) label(ctx, cx, cy, text, width, height);
  }
  scaleBar(ctx, width, height, (z * width) / N / (u * 1000), 'mrad');
}
/** The tilt t of an image's wave (images() reports its position; t = position / R). */
function tiltOf(img) {
  if (!Number.isFinite(img.R)) return { tx: img.ux, ty: img.uy };
  return { tx: img.x / img.R, ty: img.y / img.R };
}

// ------------------------------------------------------------------- the side and front

let scene = { back: 150000, front: 40000, ymax: 1000 };
function fitScene() {
  const L = plateL();
  let back = 0, front = 0, ymax = 0.62 * L;
  for (const pt of objectPoints()) { back = Math.max(back, pt.z); ymax = Math.max(ymax, Math.abs(pt.y) * 1.15); }
  if (state.object === 'picture') ymax = Math.max(ymax, (state.picSize / 2) * 1.1);
  if (state.ref === 'point') { back = Math.max(back, state.refSrc.z); ymax = Math.max(ymax, Math.abs(state.refSrc.y) * 1.12); }
  if (state.focus > 0) back = Math.max(back, state.focus); else front = Math.max(front, -state.focus);
  for (const im of imageList()) {
    for (const q of [im.image, im.twin]) {
      if (!Number.isFinite(q.R) || Math.abs(q.R) > 2.5 * back) continue;
      if (q.R > 0) back = Math.max(back, q.R); else front = Math.max(front, -q.R);
    }
  }
  back *= 1.1;
  scene = { back, front: Math.max(front * 1.12, 0.3 * back), ymax: ymax * 1.08 };
}
function imageList() {
  const C = refDesc(state.relight === 'conj'), R = refDesc(), mu = lam2() / state.lambda;
  return objectPoints().map((pt) => images(pointDescription(pt), R, C, mu));
}

function sideGeom(width, height) {
  const ml = 12, mr = 12, mt = 16, mb = 22;
  const sx = (width - ml - mr) / (scene.back + scene.front), sy = (height / 2 - mt) / scene.ymax;
  const yMid = mt + (height - mt - mb) / 2;
  return {
    X: (zs) => ml + (zs + scene.back) * sx, Y: (y) => yMid - y * sy * ((height - mt - mb) / (height - 2 * mt)),
    iX: (px) => (px - ml) / sx - scene.back, iY: (py) => (yMid - py) / (sy * ((height - mt - mb) / (height - 2 * mt))),
    sx, sy: sy * ((height - mt - mb) / (height - 2 * mt)), ml, mr, mt, mb, yMid,
  };
}

function drawSide() {
  const cv = $('#side'), { ctx, width, height } = fitCanvas(cv), c = themeColors(), g = sideGeom(width, height);
  ctx.clearRect(0, 0, width, height);
  const L = plateL(), laser = wavelengthRGB(state.lambda), light2 = wavelengthRGB(lam2());
  // The axis and the depth scale.
  ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(g.X(-scene.back), g.Y(0)); ctx.lineTo(g.X(scene.front), g.Y(0)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = c.ink3; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const v of niceTicks(-scene.back / MM, scene.front / MM, Math.max(3, Math.round(width / 90)))) {
    const x = g.X(v * MM);
    ctx.strokeStyle = c.ink3; ctx.beginPath(); ctx.moveTo(x, height - g.mb + 2); ctx.lineTo(x, height - g.mb + 6); ctx.stroke();
    ctx.fillText(v === 0 ? 'plate' : `${tickLabel(Math.abs(v))} mm`, x, height - g.mb + 7);
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('behind the plate (object side)', 6, 3);
  ctx.textAlign = 'right';
  ctx.fillText('in front (viewer)', width - 6, 3);
  const plateX = g.X(0), top = g.Y(L / 2), bot = g.Y(-L / 2);
  // The object's light reaching the plate.
  const cone = (zs, y0, y1, alpha) => {
    ctx.fillStyle = cssRGB(laser, alpha);
    ctx.beginPath(); ctx.moveTo(g.X(zs), g.Y(y0)); ctx.lineTo(plateX, top); ctx.lineTo(plateX, bot); ctx.lineTo(g.X(zs), g.Y(y1)); ctx.closePath(); ctx.fill();
  };
  if (state.object === 'points') {
    for (const pt of state.points) cone(-pt.z, pt.y, pt.y, 0.10 * pt.b);
  } else {
    const s = state.picSize / 2;
    if (state.diffuser) cone(-state.picZ, s, -s, 0.12);
    else {
      ctx.fillStyle = cssRGB(laser, 0.1);
      ctx.fillRect(g.X(-state.picZ), g.Y(Math.min(s, L / 2)), plateX - g.X(-state.picZ), g.Y(-Math.min(s, L / 2)) - g.Y(Math.min(s, L / 2)));
    }
  }
  // The reference beam.
  ctx.strokeStyle = cssRGB(laser, 0.9); ctx.fillStyle = cssRGB(laser, 0.9); ctx.lineWidth = 1.3;
  if (state.ref === 'plane') {
    const dx = Math.cos(state.theta) * g.sx, dy = -Math.sin(state.theta) * g.sy, len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len, reach = Math.min(0.28 * (plateX - g.ml), 150);
    for (let k = 0; k < 4; k++) {
      const y = -L / 2 + ((k + 0.5) / 4) * L, ex = plateX - 2, ey = g.Y(y);
      arrow(ctx, ex - reach * ux, ey - reach * uy, ex, ey);
    }
  } else {
    const sx = g.X(-state.refSrc.z), sy = g.Y(state.refSrc.y);
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(plateX, top); ctx.moveTo(sx, sy); ctx.lineTo(plateX, bot); ctx.stroke();
    ctx.globalAlpha = 1;
    star(ctx, sx, sy, 6);
  }
  // The plate, and the window in it.
  ctx.fillStyle = c.ink2; ctx.fillRect(plateX - 2, top, 4, bot - top);
  if (state.window) {
    ctx.fillStyle = 'rgb(80,170,240)';
    ctx.fillRect(plateX - 3, g.Y(state.win.y + state.win.r), 6, g.Y(state.win.y - state.win.r) - g.Y(state.win.y + state.win.r));
  }
  // The object.
  if (state.object === 'points') {
    state.points.forEach((pt, k) => {
      const x = g.X(-pt.z), y = g.Y(pt.y);
      ctx.fillStyle = c.ink; ctx.globalAlpha = 0.35 + 0.65 * pt.b;
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 2 * Math.PI); ctx.fill(); ctx.globalAlpha = 1;
      if (k === state.sel) { ctx.strokeStyle = c.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 8, 0, 2 * Math.PI); ctx.stroke(); }
    });
  } else {
    const x = g.X(-state.picZ);
    ctx.fillStyle = c.ink; ctx.fillRect(x - 2, g.Y(state.picSize / 2), 4, g.Y(-state.picSize / 2) - g.Y(state.picSize / 2));
  }
  // Where the images form (when lit): the image solid, the twin dashed.
  ctx.lineWidth = 1.5; ctx.strokeStyle = cssRGB(light2, 1);
  for (const im of imageList()) {
    for (const [q, dash] of [[im.image, []], [im.twin, [3, 3]]]) {
      if (!Number.isFinite(q.R)) continue;
      const x = g.X(-q.R), y = g.Y(q.y);
      if (x < g.ml || x > width - g.mr || y < g.mt || y > height - g.mb) continue;
      ctx.setLineDash(dash); ctx.beginPath(); ctx.arc(x, y, 6.5, 0, 2 * Math.PI); ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  // The camera (an eye) and its focus.
  const ey = g.Y(state.window ? state.win.y : 0), ex = Math.min(width - 22, plateX + Math.max(40, 0.55 * (width - plateX)));
  eye(ctx, ex, ey, c.ink2);
  const fx = g.X(-state.focus);
  ctx.strokeStyle = c.accent; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(fx, g.mt + 4); ctx.lineTo(fx, height - g.mb); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(fx, height - g.mb, 5, 0, 2 * Math.PI); ctx.fill();
  ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('focus', fx, g.mt + 16);
}

function arrow(ctx, x0, y0, x1, y1) {
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  const a = Math.atan2(y1 - y0, x1 - x0), s = 6;
  ctx.beginPath(); ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - s * Math.cos(a - 0.4), y1 - s * Math.sin(a - 0.4));
  ctx.lineTo(x1 - s * Math.cos(a + 0.4), y1 - s * Math.sin(a + 0.4)); ctx.closePath(); ctx.fill();
}
function star(ctx, x, y, r) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) { const a = (k * Math.PI) / 5 - Math.PI / 2, q = k % 2 ? r * 0.45 : r; ctx.lineTo(x + q * Math.cos(a), y + q * Math.sin(a)); }
  ctx.closePath(); ctx.fill();
}
function eye(ctx, x, y, color) {
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x - 11, y); ctx.quadraticCurveTo(x, y - 9, x + 11, y); ctx.quadraticCurveTo(x, y + 9, x - 11, y); ctx.stroke();
  ctx.beginPath(); ctx.arc(x - 3, y, 3.2, 0, 2 * Math.PI); ctx.fill();
}

function frontGeom(width, height) {
  let rng = 0.62 * plateL();
  for (const pt of objectPoints()) rng = Math.max(rng, Math.abs(pt.x) * 1.15, Math.abs(pt.y) * 1.15);
  if (state.object === 'picture') rng = Math.max(rng, (state.picSize / 2) * 1.08);
  if (state.ref === 'point') rng = Math.max(rng, Math.abs(state.refSrc.x) * 1.12, Math.abs(state.refSrc.y) * 1.12);
  const s = (Math.min(width, height) / 2 - 8) / rng;
  return { s, X: (x) => width / 2 + x * s, Y: (y) => height / 2 - y * s, iX: (px) => (px - width / 2) / s, iY: (py) => (height / 2 - py) / s };
}

const thumb = document.createElement('canvas'); thumb.width = thumb.height = 96;
let thumbKey = '';
function drawFront() {
  const cv = $('#front'), { ctx, width, height } = fitCanvas(cv), c = themeColors(), g = frontGeom(width, height);
  ctx.clearRect(0, 0, width, height);
  const L = plateL();
  if (state.object === 'picture') {
    const key = state.picture + picVersion + state.lambda;
    if (key !== thumbKey) {
      // The transparency lit from behind: its brightness in the laser's colour, on black.
      const B = rasterize(state.picture, N), tc = thumb.getContext('2d'), img = tc.createImageData(96, 96), rgb = wavelengthRGB(state.lambda);
      for (let j = 0; j < 96; j++) for (let i = 0; i < 96; i++) {
        const v = B[Math.floor(((j + 0.5) * N) / 96) * N + Math.floor(((i + 0.5) * N) / 96)], o = 4 * (j * 96 + i);
        for (let c = 0; c < 3; c++) img.data[o + c] = 255 * Math.min(1, v * (0.25 + rgb[c]));
        img.data[o + 3] = 255;
      }
      tc.putImageData(img, 0, 0); thumbKey = key;
    }
    const s = state.picSize * g.s;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(thumb, width / 2 - s / 2, height / 2 - s / 2, s, s);
    ctx.strokeStyle = c.ink2; ctx.lineWidth = 1; ctx.strokeRect(width / 2 - s / 2, height / 2 - s / 2, s, s);
  }
  ctx.strokeStyle = c.line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height); ctx.stroke();
  const overPicture = state.object === 'picture' && state.picSize > L * 0.8;
  ctx.strokeStyle = overPicture ? 'rgba(255,255,255,0.85)' : c.ink2; ctx.setLineDash([4, 3]);
  ctx.strokeRect(g.X(-L / 2), g.Y(L / 2), L * g.s, L * g.s); ctx.setLineDash([]);
  ctx.fillStyle = overPicture ? 'rgba(255,255,255,0.9)' : c.ink3; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('plate', g.X(-L / 2) + 3, g.Y(L / 2) + 2);
  if (state.window) {
    ctx.strokeStyle = 'rgb(80,170,240)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(g.X(state.win.x), g.Y(state.win.y), state.win.r * g.s, 0, 2 * Math.PI); ctx.stroke();
  }
  if (state.ref === 'point') { ctx.fillStyle = cssRGB(wavelengthRGB(state.lambda), 0.95); star(ctx, g.X(state.refSrc.x), g.Y(state.refSrc.y), 6); }
  if (state.object === 'points') {
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    state.points.forEach((pt, k) => {
      const x = g.X(pt.x), y = g.Y(pt.y), r = Math.max(3, Math.min(9, (4.5 * 90000) / pt.z));
      ctx.fillStyle = c.ink; ctx.globalAlpha = 0.35 + 0.65 * pt.b;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); ctx.globalAlpha = 1;
      if (k === state.sel) { ctx.strokeStyle = c.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 3.5, 0, 2 * Math.PI); ctx.stroke(); }
      ctx.fillStyle = c.ink2; ctx.fillText(`${fmt(pt.z / MM, 3)}`, x + r + 4, y);
    });
  }
}

// ------------------------------------------------------------------------ notes, verdict

function updateNotes() {
  const p = state.pitch, L = plateL(), sMax = sinMax();
  $('#holo-note').textContent = `${N}² pixels of ${fmt(p, 3)} µm`;
  $('#spec-note').textContent = `to ±${fmt(sMax * 1000, 3)} mrad`;
  const d = state.focus;
  $('#recon-note').textContent = `focus ${fmt(Math.abs(d) / MM, 3)} mm ${d >= 0 ? 'behind' : 'in front'}`;
  $('#side-note').textContent = `plate ${fmt(L / MM, 3)} mm across; drag the points, the focus line${state.ref === 'point' ? ', the reference source' : ''}`;
  let ref = '';
  if (state.ref === 'plane') {
    const s = Math.sin(state.theta);
    ref = s > 1e-9 ? `Fringes every ${fmt(state.lambda / s, 3)} µm = ${fmt(state.lambda / s / p, 3)} pixels (at least 2).` : 'In line: the reference runs along the axis (Gabor).';
  } else {
    ref = `From ${fmt(Math.hypot(state.refSrc.x, state.refSrc.y) / state.refSrc.z * 1000, 3)} mrad off the axis, ${fmt(state.refSrc.z / MM, 3)} mm away.`;
  }
  $('#ref-note').textContent = ref;
  // The verdict on the islands.
  const v = $('#verdict');
  const I = islands;
  if (!I.image) { v.textContent = ''; return; }
  const out = (b) => Math.max(Math.abs(b[0]), Math.abs(b[1]), Math.abs(b[2]), Math.abs(b[3])) > sMax * 1.001;
  let text, cls;
  if (out(I.image)) { text = 'Some of the image island runs past the edge: those fringes are finer than two pixels, and alias.'; cls = 'bad'; }
  else if (overlaps(I.image, I.twin)) { text = 'The image and twin islands overlap: in the view, the twin lies on the image. Tilt the reference more.'; cls = 'bad'; }
  else if (overlaps(I.image, I.auto)) {
    text = state.ratio >= 0.5 ? 'The image island touches the middle one (the object interfering with itself): haze on the image. Weaken the object beam, or tilt the reference more.'
      : 'The image island touches the middle one (the object interfering with itself), but with a weak object beam that haze is faint.';
    cls = state.ratio >= 0.5 ? 'bad' : '';
  }
  else { text = 'Three separate islands: the image comes out clean.'; cls = 'good'; }
  v.replaceChildren(el('span', { class: cls }, text));
}

// ------------------------------------------------------------------------- interaction

function canvasPoint(cv, e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top, r.width, r.height]; }
let sceneDrag = null;

const sideCanvas = $('#side');
sideCanvas.addEventListener('pointerdown', (e) => {
  const [x, y, w, h] = canvasPoint(sideCanvas, e), g = sideGeom(w, h);
  const hits = [];
  if (state.object === 'points') state.points.forEach((pt, k) => hits.push([Math.hypot(x - g.X(-pt.z), y - g.Y(pt.y)), { kind: 'point', k }]));
  else hits.push([Math.abs(x - g.X(-state.picZ)) + (Math.abs(y - g.Y(0)) < g.sy * state.picSize / 2 + 6 ? 0 : 99), { kind: 'picture' }]);
  if (state.ref === 'point') hits.push([Math.hypot(x - g.X(-state.refSrc.z), y - g.Y(state.refSrc.y)), { kind: 'ref' }]);
  hits.push([Math.abs(x - g.X(-state.focus)) + 2, { kind: 'focus' }]);
  hits.sort((a, b) => a[0] - b[0]);
  if (!hits.length || hits[0][0] > 14) return;
  sceneDrag = { view: 'side', ...hits[0][1] };
  if (sceneDrag.kind === 'point') { state.sel = sceneDrag.k; syncPoint(); }
  if (sceneDrag.kind === 'focus') { state.sweepFocus = false; sweepFocusToggle.on = false; }
  sideCanvas.setPointerCapture(e.pointerId);
  sideCanvas.style.cursor = 'grabbing';
  e.preventDefault();
});
sideCanvas.addEventListener('pointermove', (e) => {
  if (!sceneDrag || sceneDrag.view !== 'side') return;
  const [x, y, w, h] = canvasPoint(sideCanvas, e), g = sideGeom(w, h);
  const depth = Math.min(1e6, Math.max(5000, -g.iX(x))), yy = clampY(g.iY(y));
  if (sceneDrag.kind === 'point') { const pt = state.points[sceneDrag.k]; pt.z = depth; pt.y = yy; syncPoint(); }
  else if (sceneDrag.kind === 'picture') { state.picZ = depth; picZSlider.value = +(depth / MM).toFixed(2); }
  else if (sceneDrag.kind === 'ref') { state.refSrc.z = depth; state.refSrc.y = yy; syncRef(); }
  else if (sceneDrag.kind === 'focus') { setFocus(-g.iX(x)); }
  changed();
});
const endSceneDrag = () => { if (sceneDrag) { sceneDrag = null; sideCanvas.style.cursor = ''; frontCanvas.style.cursor = ''; fitScene(); schedule(); } };
sideCanvas.addEventListener('pointerup', endSceneDrag);
sideCanvas.addEventListener('pointercancel', endSceneDrag);
const clampY = (y) => Math.max(-20000, Math.min(20000, y));

const frontCanvas = $('#front');
frontCanvas.addEventListener('pointerdown', (e) => {
  const [x, y, w, h] = canvasPoint(frontCanvas, e), g = frontGeom(w, h);
  const hits = [];
  if (state.object === 'points') state.points.forEach((pt, k) => hits.push([Math.hypot(x - g.X(pt.x), y - g.Y(pt.y)), { kind: 'point', k }]));
  if (state.ref === 'point') hits.push([Math.hypot(x - g.X(state.refSrc.x), y - g.Y(state.refSrc.y)), { kind: 'ref' }]);
  hits.sort((a, b) => a[0] - b[0]);
  if (!hits.length || hits[0][0] > 14) return;
  sceneDrag = { view: 'front', geom: g, ...hits[0][1] };
  if (sceneDrag.kind === 'point') { state.sel = sceneDrag.k; syncPoint(); }
  frontCanvas.setPointerCapture(e.pointerId);
  frontCanvas.style.cursor = 'grabbing';
  e.preventDefault();
});
frontCanvas.addEventListener('pointermove', (e) => {
  if (!sceneDrag || sceneDrag.view !== 'front') return;
  const [x, y] = canvasPoint(frontCanvas, e), g = sceneDrag.geom;   // keep the scale while dragging
  const X = clampY(g.iX(x)), Y = clampY(g.iY(y));
  if (sceneDrag.kind === 'point') { const pt = state.points[sceneDrag.k]; pt.x = X; pt.y = Y; syncPoint(); }
  else { state.refSrc.x = X; state.refSrc.y = Y; syncRef(); }
  changed();
});
frontCanvas.addEventListener('pointerup', endSceneDrag);
frontCanvas.addEventListener('pointercancel', endSceneDrag);

// The hologram: move the window, erase, or keep a square piece.
const holoCanvas = $('#holo');
let holoDrag = null, pieceDrag = null;
function platePixel(e) {
  const [x, y, w, h] = canvasPoint(holoCanvas, e), v = N / state.zoomH;
  const fi = HN + (x / w - 0.5) * v, fj = HN + (y / h - 0.5) * v;
  return { fi, fj, i: Math.max(0, Math.min(N - 1, Math.floor(fi))), j: Math.max(0, Math.min(N - 1, Math.floor(fj))) };
}
holoCanvas.addEventListener('pointerdown', (e) => {
  holoCanvas.setPointerCapture(e.pointerId);
  const q = platePixel(e);
  holoDrag = { tool: state.tool, last: q };
  if (state.tool === 'window') { state.window = true; windowToggle.on = true; moveWindow(q); }
  else if (state.tool === 'erase') { paint(W.mask, W.junk, N, q.i, q.j, { shape: 'round', size: state.brush }, 0, 0); maskChanged(); }
  else if (state.tool === 'piece') { pieceDrag = { cx: q.i, cy: q.j, r: 0, copy: W.mask.slice() }; applyPiece(0); }
  e.preventDefault();
});
holoCanvas.addEventListener('pointermove', (e) => {
  if (!holoDrag) return;
  const q = platePixel(e);
  if (holoDrag.tool === 'window') moveWindow(q);
  else if (holoDrag.tool === 'erase') { paintStroke(W.mask, W.junk, N, holoDrag.last.i, holoDrag.last.j, q.i, q.j, { shape: 'round', size: state.brush }, 0, 0); maskChanged(); }
  else if (holoDrag.tool === 'piece' && pieceDrag) applyPiece(Math.max(Math.abs(q.fi - pieceDrag.cx - 0.5), Math.abs(q.fj - pieceDrag.cy - 0.5)));
  holoDrag.last = q;
});
const endHolo = () => { holoDrag = null; if (pieceDrag) { pieceDrag = null; stale.holo = true; schedule(); } };
holoCanvas.addEventListener('pointerup', endHolo);
holoCanvas.addEventListener('pointercancel', endHolo);
function moveWindow(q) {
  const lim = plateL() / 2;
  state.win.x = Math.max(-lim, Math.min(lim, (q.fi - HN) * state.pitch));
  state.win.y = Math.max(-lim, Math.min(lim, (HN - q.fj) * state.pitch));
  stale.holo = true; changed();
}
function applyPiece(r) {
  W.mask.set(pieceDrag.copy);
  maskOut(W.mask, W.junk, N, pieceDrag.cx, pieceDrag.cy, r, 'square', 'inside');
  pieceDrag.r = r;
  maskChanged();
}
function maskChanged() { maskVersion++; stale.holo = true; schedule(); }
function uncover() { W.mask.fill(1); maskChanged(); }
function coverHalf() { for (let j = 0; j < N; j++) for (let i = 0; i < HN; i++) W.mask[j * N + i] = 0; maskChanged(); }

// --------------------------------------------------------------------------- controls

// Object.
const objectSeg = segmented([
  { value: 'points', label: 'Points', title: 'A few bright points at different depths' },
  { value: 'picture', label: 'Picture', title: 'A flat transparency, lit from behind' },
], state.object, (v) => { state.object = v; showObject(); fitScene(); changed(); }, { label: 'Object' });
$('#object-box').append(objectSeg);

const pointTabs = el('div', { class: 'point-tabs', role: 'group', 'aria-label': 'Which point' });
const ptX = slider({ label: 'x (mm)', min: -1.5, max: 1.5, step: 0.001, value: 0, title: 'Sideways position of the selected point', onInput: (v) => { selPt().x = v * MM; changed(); } });
const ptY = slider({ label: 'y (mm)', min: -1.5, max: 1.5, step: 0.001, value: 0, title: 'Height of the selected point (the reference beam tilts in y)', onInput: (v) => { selPt().y = v * MM; changed(); } });
const ptZ = slider({ label: 'depth (mm)', min: 5, max: 500, log: true, value: 90, title: 'Distance of the selected point behind the plate', onInput: (v) => { selPt().z = Math.max(1000, v * MM); changed(); } });
const ptB = slider({ label: 'brightness', min: 0, max: 1, step: 0.01, value: 1, title: 'Brightness of the selected point, relative to the others', onInput: (v) => { selPt().b = v; changed(); } });
$('#points-box').append(pointTabs, ptX, ptY, ptZ, ptB);
const selPt = () => state.points[state.sel] || state.points[0];
function buildTabs() {
  pointTabs.replaceChildren(el('span', { class: 'small muted' }, 'Point'));
  state.points.forEach((_, k) => pointTabs.append(el('button', { type: 'button', 'aria-pressed': String(k === state.sel), onclick: () => { state.sel = k; syncPoint(); schedule(); } }, String(k + 1))));
  if (state.points.length < 6) pointTabs.append(el('button', { type: 'button', title: 'Add a point', onclick: addPoint }, '+'));
  if (state.points.length > 1) pointTabs.append(el('button', { type: 'button', title: 'Remove the selected point', onclick: removePoint }, '−'));
}
function addPoint() {
  const L = plateL(), k = state.points.length;
  state.points.push({ x: ((k * 0.37) % 1 - 0.5) * L * 0.8, y: ((k * 0.61) % 1 - 0.5) * L * 0.8, z: 70000 + 15000 * k, b: 1 });
  state.sel = state.points.length - 1; syncPoint(); fitScene(); changed();
}
function removePoint() {
  state.points.splice(state.sel, 1); state.sel = Math.min(state.sel, state.points.length - 1);
  syncPoint(); fitScene(); changed();
}
function syncPoint() {
  buildTabs();
  const pt = selPt();
  if (!pt) return;
  ptX.value = +(pt.x / MM).toFixed(3); ptY.value = +(pt.y / MM).toFixed(3); ptZ.value = +(pt.z / MM).toFixed(2); ptB.value = pt.b;
}

const pictureButtons = {};
const pictureGrid = el('div', { class: 'button-grid' });
for (const [id, P] of Object.entries(PICTURES)) {
  const b = el('button', { type: 'button', title: P.title, 'aria-pressed': 'false', onclick: () => { state.picture = id; loadPicture(id); syncPicture(); changed(); } }, P.label);
  pictureButtons[id] = b; pictureGrid.append(b);
}
const picZSlider = slider({ label: 'distance (mm)', min: 10, max: 600, log: true, value: 150, title: 'How far behind the plate the picture is', onInput: (v) => { state.picZ = v * MM; fitScene(); changed(); } });
const picSizeSlider = slider({ label: 'size (mm)', min: 0.2, max: 20, log: true, value: 5, title: 'The width of the picture', onInput: (v) => { state.picSize = v * MM; fitScene(); changed(); } });
const diffuserToggle = toggle('Diffuser', state.diffuser, (on) => { state.diffuser = on; changed(); }, 'Light the picture through ground glass: every point of it sends light to the whole plate');
$('#picture-box').append(pictureGrid, picZSlider, picSizeSlider, el('div', { class: 'row' }, diffuserToggle));
function syncPicture() {
  for (const [id, b] of Object.entries(pictureButtons)) b.setAttribute('aria-pressed', String(id === state.picture));
  picZSlider.value = +(state.picZ / MM).toFixed(2); picSizeSlider.value = +(state.picSize / MM).toFixed(3);
  diffuserToggle.on = state.diffuser;
}
function showObject() {
  objectSeg.value = state.object;
  $('#points-box').hidden = state.object !== 'points';
  $('#picture-box').hidden = state.object !== 'picture';
}

// Reference.
const refSeg = segmented([
  { value: 'plane', label: 'Plane wave', title: 'A collimated beam at an angle' },
  { value: 'point', label: 'Point source', title: 'A diverging beam from a point behind the plate' },
], state.ref, (v) => { state.ref = v; showRef(); fitScene(); changed(); }, { label: 'Reference' });
$('#ref-box').append(refSeg);
const thetaSlider = slider({ label: 'angle (°)', min: 0, max: 3.6, step: 0.01, value: 2.3, title: 'The angle of the reference beam to the axis (0: in line, as Gabor did; tilted: off axis, as Leith and Upatnieks did)',
  onInput: (v) => { state.theta = Math.min(v * DEG, thetaMax()); if (v * DEG > thetaMax()) thetaSlider.value = +(thetaMax() / DEG).toFixed(3); changed(); } });
const refX = slider({ label: 'x (mm)', min: -3, max: 3, step: 0.001, value: 0, onInput: (v) => { state.refSrc.x = v * MM; changed(); } });
const refY = slider({ label: 'y (mm)', min: -3, max: 3, step: 0.001, value: -1.5, onInput: (v) => { state.refSrc.y = v * MM; changed(); } });
const refZ = slider({ label: 'depth (mm)', min: 5, max: 500, log: true, value: 60, onInput: (v) => { state.refSrc.z = Math.max(1000, v * MM); fitScene(); changed(); } });
$('#ref-options').append(thetaSlider, refX, refY, refZ);
/** The steepest reference whose fringes the pixels can record: a period of two pixels. */
const thetaMax = () => Math.asin(Math.min(1, sinMax()));
function showRef() {
  refSeg.value = state.ref;
  thetaSlider.hidden = state.ref !== 'plane';
  refX.hidden = refY.hidden = refZ.hidden = state.ref !== 'point';
}
function syncRef() {
  thetaSlider.setRange(0, +(thetaMax() / DEG).toFixed(3));
  if (state.theta > thetaMax()) state.theta = thetaMax();
  thetaSlider.value = +(state.theta / DEG).toFixed(3);
  refX.value = +(state.refSrc.x / MM).toFixed(3); refY.value = +(state.refSrc.y / MM).toFixed(3); refZ.value = +(state.refSrc.z / MM).toFixed(2);
}

// Relighting.
const relightSeg = segmented([
  { value: 'ref', label: 'The reference', title: 'The same beam that recorded it' },
  { value: 'conj', label: 'Its conjugate', title: 'The reference beam reversed (complex conjugated): it makes the real image' },
], state.relight, (v) => { state.relight = v; fitScene(); changed(); }, { label: 'Light it with' });
$('#relight-box').append(relightSeg);
const sameToggle = toggle('Same colour', state.sameColour, (on) => { state.sameColour = on; if (on) state.lambda2 = state.lambda; syncLambda2(); fitScene(); changed(); }, 'Light the hologram with the wavelength it was recorded with');
const lambda2Slider = slider({ label: 'λ (nm)', min: 400, max: 700, step: 1, value: 633, title: 'The wavelength of the light that lights the hologram',
  onInput: (v) => { state.lambda2 = v / 1000; state.sameColour = false; sameToggle.on = false; fitScene(); changed(); } });
$('#lambda2-box').append(el('div', { class: 'row' }, sameToggle), lambda2Slider);
function syncLambda2() { sameToggle.on = state.sameColour; lambda2Slider.value = Math.round(lam2() * 1000); }

// Laser and camera.
const lambdaSlider = slider({ label: 'laser λ (nm)', min: 400, max: 700, step: 1, value: 633, title: 'The wavelength the hologram is recorded with',
  onInput: (v) => { state.lambda = v / 1000; syncRef(); syncLambda2(); fitScene(); changed(); } });
const pitchSlider = slider({ label: 'pixel (µm)', min: 2, max: 20, step: 0.1, value: 5, title: 'The pixel pitch of the camera',
  onInput: (v) => { state.pitch = v; syncRef(); fitScene(); changed(); } });
const ratioSlider = slider({ label: 'object/ref.', min: 0.03, max: 3, log: true, value: 0.3, title: 'The amplitude of the object light at the plate (r.m.s.) relative to the reference beam',
  onInput: (v) => { state.ratio = v; changed(); } });
const bitsToggle = toggle('Round the grey levels', state.bits > 0, (on) => { state.bits = on ? bitsSlider.value : 0; bitsSlider.hidden = !on; changed(); }, 'Record only a few grey levels, as a cheap camera (or a printer) would');
const bitsSlider = slider({ label: 'bits', min: 1, max: 8, step: 1, value: 1, title: '2^bits grey levels; 1 bit: black or white', onInput: (v) => { state.bits = Math.round(v); changed(); } });
$('#camera-box').append(lambdaSlider, pitchSlider, ratioSlider, el('div', { class: 'row' }, bitsToggle), bitsSlider);
function syncCamera() {
  lambdaSlider.value = Math.round(state.lambda * 1000); pitchSlider.value = state.pitch; ratioSlider.value = state.ratio;
  bitsToggle.on = state.bits > 0; bitsSlider.hidden = !(state.bits > 0); if (state.bits > 0) bitsSlider.value = state.bits;
}

// The hologram's tools.
const toolSeg = segmented([
  { value: 'window', label: 'Move window', title: 'Look through a small part of the plate: drag the window around' },
  { value: 'erase', label: 'Erase', title: 'Cover parts of the plate' },
  { value: 'piece', label: 'Keep a piece', title: 'Drag out a square: the rest of the plate is covered' },
], state.tool, (v) => { state.tool = v; showTool(); }, { label: 'Tool' });
$('#tool-box').append(toolSeg);
const windowToggle = toggle('Window on', state.window, (on) => { state.window = on; if (!on) { state.sweepWindow = false; sweepWindowToggle.on = false; } stale.holo = true; changed(); }, 'Look through a round window in the plate instead of the whole plate');
const windowSlider = slider({ label: 'width (mm)', min: 0.05, max: 1.28, step: 0.01, value: 0.4, title: 'The diameter of the window',
  onInput: (v) => { state.win.r = (v * MM) / 2; state.window = true; windowToggle.on = true; stale.holo = true; changed(); } });
const sweepWindowToggle = toggle('Sweep', false, (on) => { state.sweepWindow = on; if (on) { state.window = true; windowToggle.on = true; t0 = performance.now(); } changed(); }, 'Move the window from side to side');
const brushSlider = slider({ label: 'brush (px)', min: 2, max: 80, step: 1, value: 16, onInput: (v) => { state.brush = Math.round(v); } });
const uncoverButton = () => el('button', { type: 'button', title: 'Take every cover off the plate', onclick: uncover }, 'Uncover all');
const toolOptions = {
  window: el('div', { class: 'stack' }, el('div', { class: 'row' }, windowToggle, sweepWindowToggle), windowSlider),
  erase: el('div', { class: 'stack' }, brushSlider, el('div', { class: 'row' }, uncoverButton())),
  piece: el('div', { class: 'stack' }, el('div', { class: 'small muted' }, 'Drag out a square from its centre.'),
    el('div', { class: 'row' }, el('button', { type: 'button', title: 'Cover the left half of the plate', onclick: coverHalf }, 'Cover half'), uncoverButton())),
};
function showTool() { toolSeg.value = state.tool; $('#tool-options').replaceChildren(toolOptions[state.tool]); }

const zoomSelect = (id, zs, key) => {
  const s = $(id);
  for (const z of zs) s.append(el('option', { value: z }, z === 1 ? 'Whole' : `${z}× zoom`));
  s.addEventListener('change', () => { state[key] = +s.value; stale.holo = stale.spec = stale.recon = true; schedule(); });
  return s;
};
const zoomHolo = zoomSelect('#zoom-holo', [1, 2, 4, 8], 'zoomH');
const zoomSpec = zoomSelect('#zoom-spec', [1, 2, 4], 'zoomS');
const zoomRecon = zoomSelect('#zoom-recon', [1, 2, 4], 'zoomR');

const specBright = slider({ label: 'Brightness', min: -2, max: 2, step: 0.01, value: 0, title: 'Only the drawing changes; in factors of 10', onInput: (v) => { state.brightS = v; stale.spec = true; schedule(); } });
$('#spec-bright').append(specBright);
const reconBright = slider({ label: 'Brightness', min: -2, max: 3, step: 0.01, value: 0, title: 'Only the drawing changes; in factors of 10', onInput: (v) => { state.brightR = v; stale.recon = true; schedule(); } });
$('#recon-bright').append(reconBright);

// The focus: behind the plate (virtual images) is positive, in front (real images) negative.
const focusSlider = slider({ label: 'focus (mm)', min: -300, max: 300, step: 0.1, value: 90, title: 'Where the camera is focused: behind the plate (+, virtual images) or in front of it (−, real images)',
  onInput: (v) => { state.sweepFocus = false; sweepFocusToggle.on = false; setFocus(v * MM, false); } });
$('#focus-box').append(focusSlider);
const sweepFocusToggle = toggle('Sweep', false, (on) => { state.sweepFocus = on; t0 = performance.now(); changed(); }, 'Sweep the focus back and forth through the object');
$('#sweep-box').append(sweepFocusToggle);
function setFocus(d, updateSlider = true) {
  if (Math.abs(d) < 1000) d = d < 0 ? -1000 : 1000;
  state.focus = Math.max(-1e6, Math.min(1e6, d));
  if (updateSlider) focusSlider.value = +(state.focus / MM).toFixed(2);
  changed();
}
function sweepRange() {
  const zs = imageList().map((im) => im.image.R).filter((R) => Number.isFinite(R) && R > 0);
  if (!zs.length) return [0.7 * Math.abs(state.focus), 1.3 * Math.abs(state.focus)];
  return [0.8 * Math.min(...zs), 1.2 * Math.max(...zs)];
}
const jumpImage = el('button', { type: 'button', title: 'Focus on the image (of the selected point)', onclick: () => jump('image') }, 'Focus on the image');
const jumpTwin = el('button', { type: 'button', title: 'Focus on the twin image (of the selected point)', onclick: () => jump('twin') }, 'on the twin');
$('#jump-box').append(jumpImage, jumpTwin);
function jump(which) {
  const pts = objectPoints(), pt = state.object === 'points' ? selPt() : pts[0];
  const im = images(pointDescription(pt), refDesc(), refDesc(state.relight === 'conj'), lam2() / state.lambda)[which];
  state.sweepFocus = false; sweepFocusToggle.on = false;
  if (!Number.isFinite(im.R) || Math.abs(im.R) > 1e6) { setFocus(1e6); return; }
  setFocus(im.R); fitScene();
}

function syncControls() {
  showObject(); syncPoint(); syncPicture(); showRef(); syncRef();
  relightSeg.value = state.relight; syncLambda2(); syncCamera(); showTool();
  windowToggle.on = state.window; windowSlider.value = +((2 * state.win.r) / MM).toFixed(3); brushSlider.value = state.brush;
  sweepWindowToggle.on = state.sweepWindow; sweepFocusToggle.on = state.sweepFocus;
  zoomHolo.value = state.zoomH; zoomSpec.value = state.zoomS; zoomRecon.value = state.zoomR;
  specBright.value = state.brightS; reconBright.value = state.brightR;
  focusSlider.value = +(state.focus / MM).toFixed(2);
  if (state.object === 'picture') loadPicture(state.picture);
}

new ResizeObserver(() => { stale.holo = stale.spec = stale.recon = true; schedule(); }).observe($('.stage'));
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', schedule);

// ------------------------------------------------------------------------- the URL hash

const r4 = (v) => +(v / MM).toFixed(4);
function updateHash() {
  const s = state;
  writeHash({
    obj: s.object,
    pts: s.object === 'points' ? s.points.map((q) => [r4(q.x), r4(q.y), r4(q.z), +q.b.toFixed(2)].join(',')).join(';') : undefined,
    pic: s.object === 'picture' ? s.picture : undefined,
    pz: s.object === 'picture' ? r4(s.picZ) : undefined,
    ps: s.object === 'picture' ? r4(s.picSize) : undefined,
    dif: s.object === 'picture' ? +s.diffuser : undefined,
    ref: s.ref,
    th: s.ref === 'plane' ? +(s.theta / DEG).toFixed(4) : undefined,
    rs: s.ref === 'point' ? [r4(s.refSrc.x), r4(s.refSrc.y), r4(s.refSrc.z)].join(',') : undefined,
    relight: s.relight,
    lam2: s.sameColour ? undefined : Math.round(s.lambda2 * 1000),
    d: r4(s.focus),
    win: s.window ? [r4(s.win.x), r4(s.win.y), r4(s.win.r)].join(',') : undefined,
    lam: Math.round(s.lambda * 1000), pitch: s.pitch, ratio: s.ratio, bits: s.bits || undefined,
    zoom: [s.zoomH, s.zoomS, s.zoomR].join(','),
  });
}
function readState(h) {
  const s = DEFAULTS(), num = (v, f) => (Number.isFinite(+v) && v !== '' ? +v : f);
  const nums = (str) => (str || '').split(',').map(Number);
  if (h.obj === 'points' || h.obj === 'picture') s.object = h.obj;
  if (h.pts) {
    const pts = h.pts.split(';').map(nums).filter((a) => a.length >= 3 && a.every(Number.isFinite) && a[2] > 0)
      .map(([x, y, z, b = 1]) => ({ x: x * MM, y: y * MM, z: z * MM, b }));
    if (pts.length) { s.points = pts.slice(0, 6); s.sel = 0; }
  }
  if (PICTURES[h.pic]) s.picture = h.pic;
  s.picZ = num(h.pz, s.picZ / MM) * MM; s.picSize = num(h.ps, s.picSize / MM) * MM;
  if (h.dif !== undefined) s.diffuser = h.dif !== '0';
  if (h.ref === 'plane' || h.ref === 'point') s.ref = h.ref;
  s.theta = num(h.th, s.theta / DEG) * DEG;
  if (h.rs) { const [x, y, z] = nums(h.rs); if ([x, y, z].every(Number.isFinite) && z > 0) s.refSrc = { x: x * MM, y: y * MM, z: z * MM }; }
  if (h.relight === 'conj' || h.relight === 'ref') s.relight = h.relight;
  s.lambda = num(h.lam, 633) / 1000; s.pitch = num(h.pitch, 5); s.ratio = num(h.ratio, 0.3); s.bits = Math.round(num(h.bits, 0));
  if (h.lam2) { s.lambda2 = num(h.lam2, 633) / 1000; s.sameColour = false; } else s.lambda2 = s.lambda;
  s.focus = num(h.d, s.focus / MM) * MM;
  if (h.zoom) { const [a, b, c] = nums(h.zoom); if ([1, 2, 4, 8].includes(a)) s.zoomH = a; if ([1, 2, 4].includes(b)) s.zoomS = b; if ([1, 2, 4].includes(c)) s.zoomR = c; }
  if (h.win) { const [x, y, r] = nums(h.win); if ([x, y, r].every(Number.isFinite) && r > 0) { s.window = true; s.win = { x: x * MM, y: y * MM, r: r * MM }; } }
  return s;
}

// --------------------------------------------------------------------------- experiments

function apply(s) {
  state = { ...DEFAULTS(), ...s };
  W.mask.fill(1); maskVersion++;
  syncControls(); fitScene(); t0 = performance.now();
  stale.holo = stale.spec = stale.recon = true;
  changed();
}
const P = (x, y, z, b = 1) => ({ x: x * MM, y: y * MM, z: z * MM, b });
const PLANE = (deg) => ({ ref: 'plane', theta: deg * DEG });
const setups = {
  zone: () => apply({ points: [P(0, 0, 30)], sel: 0, ...PLANE(0), focus: 30000, zoomH: 1, zoomS: 1, zoomR: 4 }),
  gabor: () => apply({ points: [P(-0.25, 0.2, 80), P(0.25, 0.2, 80), P(0, -0.25, 80)], sel: 0, ...PLANE(0), focus: 80000, zoomH: 1, zoomR: 4 }),
  offaxis: () => apply({ object: 'picture', picture: 'F', picZ: 120000, picSize: 2000, diffuser: true, ...PLANE(0.4), ratio: 0.5, focus: 120000, zoomR: 1 }),
  islands: () => apply({ object: 'picture', picture: 'F', picZ: 150000, picSize: 4000, diffuser: true, ...PLANE(2), ratio: 0.6, focus: 150000, zoomR: 1 }),
  cut: () => apply({ object: 'picture', picture: 'F', picZ: 150000, picSize: 4000, diffuser: true, ...PLANE(2), focus: 150000, tool: 'piece', zoomR: 2 }),
  parallax: () => apply({ points: [P(0, 0, 40), P(0, 0, 60), P(0, 0, 100)], sel: 1, ...PLANE(2.3), window: true, win: { x: 0, y: 0, r: 150 }, sweepWindow: true, focus: 60000, zoomR: 4 }),
  depth: () => apply({ points: [P(-0.4, 0.3, 40), P(0.35, -0.1, 70), P(0, -0.45, 120)], sel: 1, ...PLANE(2.1), focus: 70000, sweepFocus: true, zoomR: 4 }),
  wavelength: () => apply({ object: 'picture', picture: 'F', picZ: 150000, picSize: 4000, diffuser: true, ...PLANE(2), sameColour: false, lambda2: 0.532, focus: 150000, zoomR: 2 }),
  conjugate: () => apply({ points: [P(-0.3, 0.25, 50), P(0.3, -0.2, 90)], sel: 0, ...PLANE(2.3), relight: 'conj', focus: -50000, zoomR: 4 }),
  binary: () => apply({ object: 'picture', picture: 'F', picZ: 150000, picSize: 4000, diffuser: true, ...PLANE(2), bits: 1, focus: 150000, zoomH: 4, zoomR: 1 }),
  portrait: () => apply({ object: 'picture', picture: 'fourier', picZ: 150000, picSize: 5000, diffuser: true, ...PLANE(2), focus: 150000, zoomR: 2 }),
  fourier: () => apply({ object: 'picture', picture: 'F', picZ: 150000, picSize: 3000, diffuser: true, ref: 'point', refSrc: { x: 0, y: -5000, z: 150000 }, focus: 150000, zoomR: 1 }),
  steep: () => apply({ ...PLANE(90), focus: 90000, zoomR: 1 }),
};
drawer($('#help'), $('#help-button'), setups);

// ------------------------------------------------------------------------------- start

const hash = readHash();
if (setups[hash.setup]) setups[hash.setup]();
else apply(readState(hash));

window.__app = {
  get state() { return state; }, setups, W, islands, apply, setFocus, uncover, coverHalf, maskChanged, compute,
  timing() { const t = performance.now(); keys.O = keys.H = keys.E = ''; pointCache.delete(state.points[0]); compute(); return performance.now() - t; },
  ready: true,
};
