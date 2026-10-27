// Diffraction: paint an aperture, move the screen.  Lengths in micrometres.

import { diffract, sideView, spectrumOf, sampleAperture, zoneCount, criticalDistance, pitchAt } from './optics.js';
import { colorize } from '../lib/complexcolor.js';
import { stroke as paintStroke, paint } from '../fft2d/tools.js';
import { el, $, slider, segmented, toggle, drawer, readHash, writeHash, fmt } from '../lib/ui.js';

const N = 512;            // the grid
const DX = 8;             // micrometres per pixel: the window is 4.096 mm across
const SHOW = 256;         // the middle 256 pixels (2.05 mm) of the aperture are drawn, and the
                          // middle half of the field's grid (which grows with z past z_c)
const OFF = (N - SHOW) / 2;
const ZMIN = 100, ZMAX = 1e7; // the screen's range, 0.1 mm to 10 m: at 10 m every aperture
                          // here is in its far field (see the tests)
const NZ = 96;            // rows of the side view

const state = {
  z: 10000,               // screen distance, um
  lambda: 0.55,           // um
  white: false,
  display: 'intensity',
  scale: 'sqrt',          // brightness in proportion to sqrt(I), or 'linear': to I
  zoom: 1,                // the screen magnified about its middle: 1, 4 or 16
  bright: 0,
  tool: 'open',
  brush: 6,
  preset: 'slit',
  size: 200,              // the preset's characteristic size, um (for the zone plate and the lens, f in mm)
};

const ap = { re: new Float64Array(N * N), im: new Float64Array(N * N) };

// --------------------------------------------------------------------- presets

// A soft-edged round beam, 3.3 mm across, for the apertures "open everywhere" (the edge, the
// disk), so that they don't diffract from the edges of the computing window.
const beam = (x, y) => {
  const r = Math.hypot(x, y), R = (N / 2) * DX, edge = 0.8 * R;
  return r < edge ? 1 : r < R ? Math.cos(((r - edge) / (R - edge)) * (Math.PI / 2)) : 0;
};

// A zone plate's rings go out to 0.8 mm, but none narrower than 2.5 pixels (see zoneCount):
// with lambda = 550 nm, 17 zones at f = 50 mm.  A lens likewise bends light by at most
// lambda / 4dx, the edge of the far-field view.  (f, lambda in um.)
const zones = (f, lam) => zoneCount(f, lam, DX);
const lensRadius = (f, lam) => Math.min(600, (lam * f) / (4 * DX));

// f(x, y, size, lambda): the transmission, or with phase: true the phase (NaN where opaque).
const PRESETS = {
  slit: { label: 'Slit', size: [20, 600, 200], f: (x, y, s) => +(Math.abs(x) < s / 2 && Math.abs(y) < 700) },
  double: { label: 'Two slits', size: [40, 800, 250], f: (x, y, s) => +((Math.abs(x - s / 2) < s / 8 || Math.abs(x + s / 2) < s / 8) && Math.abs(y) < 700) },
  hole: { label: 'Round hole', size: [20, 800, 300], f: (x, y, s) => +(x * x + y * y < (s / 2) ** 2) },
  square: { label: 'Square hole', size: [20, 800, 300], f: (x, y, s) => +(Math.abs(x) < s / 2 && Math.abs(y) < s / 2) },
  edge: { label: 'Straight edge', size: [0, 0, 0], f: (x, y) => +(x > 0) * beam(x, y) },
  disk: { label: 'Opaque disk', size: [100, 900, 500], f: (x, y, s) => +(x * x + y * y > (s / 2) ** 2) * beam(x, y) },
  grating: { label: 'Grating', size: [16, 200, 48], f: (x, y, s) => (0.5 + 0.5 * Math.cos((2 * Math.PI * x) / s)) * +(Math.abs(x) < 750 && Math.abs(y) < 750) },
  zone: { label: 'Zone plate', size: [10, 200, 50], fz: true, f: (x, y, s, lam) => { const n = (x * x + y * y) / (lam * s * 1000); return +(n < zones(s * 1000, lam) && Math.floor(n) % 2 === 0); } },
  lens: { label: 'Lens', size: [10, 200, 50], fz: true, phase: true, f: (x, y, s, lam) => { const r2 = x * x + y * y; return r2 > lensRadius(s * 1000, lam) ** 2 ? NaN : (-(2 * Math.PI) / lam) * r2 / (2 * s * 1000); } },
  random: { label: 'Rough glass', size: [8, 80, 24], phase: true, f: (x, y, s) => {
    if (x * x + y * y > 500 * 500) return NaN;
    const cx = Math.floor(x / s), cy = Math.floor(y / s);
    let h = (cx * 73856093) ^ (cy * 19349663); h = (h ^ (h >>> 13)) * 1274126177;
    return ((h >>> 0) % 1000) / 1000 * 2 * Math.PI;
  } },
};

function loadPreset(id, size) {
  const p = PRESETS[id];
  state.preset = id;
  if (size !== undefined) state.size = size;
  const [re, im] = sampleAperture(N, DX, (x, y) => p.f(x, y, state.size, state.lambda), { phase: !!p.phase });
  ap.re.set(re); ap.im.set(im);
  apertureChanged();
  for (const [k, b] of Object.entries(presetButtons)) b.setAttribute('aria-pressed', String(k === id));
  sizeSlider.hidden = !p.size[1];
  if (p.size[1]) { sizeSlider.setRange(p.size[0], p.size[1]); sizeSlider.value = state.size; sizeLabel(p); }
  update();
  saveHash();
}
function sizeLabel(p) {
  sizeSlider.querySelector('label').textContent = p.fz ? 'focus f (mm)' : p.label === 'Grating' ? 'period (µm)' : p.label === 'Rough glass' ? 'grain (µm)' : 'size (µm)';
}

let hashTimer = 0;
function saveHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => writeHash({ preset: state.preset, size: state.size, z: Math.round(state.z),
    scale: state.scale === 'linear' ? 'linear' : undefined, zoom: state.zoom > 1 ? state.zoom : undefined }), 300);
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

let fields = [];      // per wavelength: {re, im, pitch, rgb, lam}
let sideData = null;  // the side view: {z, rows: per wavelength {I, lam, rgb}}

// The aperture's angular spectrum at each wavelength, kept while the aperture stays the same:
// moving the screen then costs one transform per frame.
let spectra = new Map();
function apertureChanged() { spectra = new Map(); }

function update() {
  const old = spectra;
  spectra = new Map();
  fields = wavelengths().map(([lam, rgb]) => {
    let sp = old.get(lam);
    if (!sp && state.z <= criticalDistance(N, DX, lam)) sp = spectrumOf(ap.re, ap.im, N);
    if (sp) spectra.set(lam, sp);
    // Without the curvature of the spherical wave: past z_c its phase turns faster than the
    // pixels, and the intensity doesn't need it.
    const f = diffract(ap.re, ap.im, N, DX, lam, state.z, { curvature: false, spectrum: sp });
    return { ...f, rgb, lam };
  });
  drawAperture(); drawField(); updateNotes();
  scheduleSide();
}

let sideTimer = 0;
function scheduleSide() {
  clearTimeout(sideTimer);
  sideTimer = setTimeout(() => {
    const z = state.z, zs = Array.from({ length: NZ }, (_, a) => ((a + 0.5) / NZ) * 2 * z);
    sideData = { z, rows: wavelengths().map(([lam, rgb]) => ({ I: sideView(ap.re, ap.im, N, DX, lam, zs), lam, rgb })) };
    drawSide();
  }, 120);
}

/** The screen's pixel at distance z: the field's pitch (in white light the blue's, the finest). */
const screenPitch = (z = state.z) => pitchAt(N, DX, Math.min(...wavelengths().map(([lam]) => lam)), z);

// --------------------------------------------------------------------- drawing

function canvasSize(cv) {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return [w, h];
}

// smooth: interpolate between pixels (the field is band-limited: square pixels would be wrong).
function blit(cv, img, m, smooth = false) {
  const [w, h] = canvasSize(cv), ctx = cv.getContext('2d');
  const c = document.createElement('canvas'); c.width = m; c.height = img.height;
  c.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = smooth;
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

const round125 = (v) => { const e = 10 ** Math.floor(Math.log10(v)), m = v / e; return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * e; };
const fmtLen = (um) => (um < 100 ? `${fmt(um, 3)} µm` : `${fmt(um / 1000, 3)} mm`);

// A scale bar about a quarter of the width: a round length; or, given the screen's distance z
// once the screen spans a fixed range of angles (past z_c), a round angle and its length there.
function scaleBar(ctx, w, h, span, z = 0) {
  const dpr = window.devicePixelRatio || 1;
  let len, text;
  if (z) { const mrad = round125((span / z) * 250); len = (mrad / 1000) * z; text = `${mrad} mrad (${fmtLen(len)})`; }
  else { len = round125(span / 4); text = fmtLen(len); }
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(10 * dpr, h - 14 * dpr, (len / span) * w, 3 * dpr);
  ctx.font = `${11 * dpr}px system-ui, sans-serif`;
  ctx.fillText(text, 10 * dpr, h - 20 * dpr);
}

/**
 * Intensities of the fields over the drawn region, to a coloured image: brightness in
 * proportion to the amplitude, sqrt(I / ref) (faint light shows), or if linear to the
 * intensity itself, I / ref (the true contrast).
 */
function intensityImage(getI, m, rgbs, ref, linear = false) {
  const img = new ImageData(m, m), d = img.data;
  for (let o = 0; o < m * m; o++) {
    let r = 0, g = 0, b = 0;
    rgbs.forEach((rgb, w) => {
      const v = Math.min(1, linear ? getI(w, o) / ref : Math.sqrt(getI(w, o) / ref));
      r += rgb[0] * v; g += rgb[1] * v; b += rgb[2] * v;
    });
    d[4 * o] = 255 * Math.min(1, r); d[4 * o + 1] = 255 * Math.min(1, g); d[4 * o + 2] = 255 * Math.min(1, b); d[4 * o + 3] = 255;
  }
  return img;
}

// Weights for reading a band-limited sequence at the fractional index u: a sinc, windowed
// (Lanczos) to LANCZOS samples either side.  [the first index, the weights]
const LANCZOS = 6;
function lanczos(u) {
  const i0 = Math.floor(u) - LANCZOS + 1, w = new Float64Array(2 * LANCZOS);
  for (let t = 0; t < w.length; t++) {
    const d = u - (i0 + t);
    w[t] = d === 0 ? 1 : (LANCZOS * Math.sin(Math.PI * d) * Math.sin((Math.PI * d) / LANCZOS)) / (Math.PI * Math.PI * d * d);
  }
  return [i0, w];
}

/**
 * Each field on the screen, SHOW x SHOW pixels of pitch P / zoom about the middle (P: the
 * finest field's pitch, so unzoomed the middle half of its grid).  Where these aren't the
 * field's own samples (zoomed in, or the coarser grids of the redder light in white light) the
 * field is read between its samples as the band-limited function it is.  Returns [{re, im}].
 */
function screenFields(P) {
  return fields.map((f) => {
    const step = P / state.zoom / f.pitch, re = new Float64Array(SHOW * SHOW), im = new Float64Array(SHOW * SHOW);
    if (step === 1) {
      for (let j = 0; j < SHOW; j++) for (let i = 0; i < SHOW; i++) { const o = (j + OFF) * N + i + OFF; re[j * SHOW + i] = f.re[o]; im[j * SHOW + i] = f.im[o]; }
      return { re, im };
    }
    // The same positions across and down; along the rows first, for the rows needed.
    const at = Array.from({ length: SHOW }, (_, i) => lanczos((i - SHOW / 2) * step + N / 2));
    const lo = at[0][0], rows = at[SHOW - 1][0] + 2 * LANCZOS - lo;
    const tr = new Float64Array(rows * SHOW), ti = new Float64Array(rows * SHOW);
    for (let r = 0; r < rows; r++) {
      for (let i = 0, base = (lo + r) * N; i < SHOW; i++) {
        const [i0, w] = at[i];
        let sr = 0, si = 0;
        for (let t = 0; t < w.length; t++) { sr += w[t] * f.re[base + i0 + t]; si += w[t] * f.im[base + i0 + t]; }
        tr[r * SHOW + i] = sr; ti[r * SHOW + i] = si;
      }
    }
    for (let j = 0; j < SHOW; j++) {
      const [j0, w] = at[j];
      for (let i = 0; i < SHOW; i++) {
        let sr = 0, si = 0;
        for (let t = 0; t < w.length; t++) { const o = (j0 - lo + t) * SHOW + i; sr += w[t] * tr[o]; si += w[t] * ti[o]; }
        re[j * SHOW + i] = sr; im[j * SHOW + i] = si;
      }
    }
    return { re, im };
  });
}

// The intensity drawn white: the brightest point (linear scale), or all but the brightest 0.5%
// (the compressed scale, which then shows faint light); then the Brightness slider.
function whiteLevel(Is, linear, from = 0) {
  let ref = 0;
  for (const I of Is) {
    if (linear) { for (let o = from; o < I.length; o++) ref = Math.max(ref, I[o]); }
    else { const s = Float64Array.from(I.subarray(from)).sort(); ref = Math.max(ref, s[Math.floor(0.995 * (s.length - 1))]); }
  }
  return (ref || 1) * 10 ** -state.bright;
}

let shown = null;     // what the screen shows: {Is, ref}, for the tests
function drawField() {
  const cv = $('#field'), P = screenPitch();
  const Fs = screenFields(P), Is = Fs.map(({ re, im }) => re.map((v, o) => v * v + im[o] * im[o]));
  const linear = state.scale === 'linear', ref = whiteLevel(Is, linear);
  shown = { Is, ref, linear };
  let img;
  if (state.display === 'complex' && fields.length === 1) {
    img = new ImageData(SHOW, SHOW);
    colorize(Fs[0].re, Fs[0].im, img.data, Math.sqrt(ref) * 0.5, 'complex');
  } else img = intensityImage((w, o) => Is[w][o], SHOW, fields.map((f) => f.rgb), ref, linear);
  const ctx = blit(cv, img, SHOW, true);
  scaleBar(ctx, cv.width, cv.height, (SHOW * P) / state.zoom, P > DX ? state.z : 0);
}

// One row of the side view on the screen's pixels (pitch P) from a row of the computed field
// (pitch p, centred at N/2): interpolated where p is coarser, averaged where finer, and dark
// outside the middle half of the row's grid, the angles the grid follows reliably.
function resampleRow(I, off, p, P, out, outOff, gain) {
  const half = N / 4, c = off + N / 2;
  for (let i = 0; i < SHOW; i++) {
    const x = (i - SHOW / 2) * P;
    let v = 0;
    if (P <= p) {
      const u = x / p, u0 = Math.floor(u), fu = u - u0;
      if (Math.abs(u) <= half) v = (1 - fu) * I[c + u0] + fu * I[c + u0 + 1];
    } else {
      const lo = Math.max(-half, Math.ceil((x - P / 2) / p)), hi = Math.min(half, Math.ceil((x + P / 2) / p) - 1);
      for (let u = lo; u <= hi; u++) v += I[c + u];
      if (hi >= lo) v /= hi - lo + 1;
    }
    out[outOff + i] = v * gain;
  }
}

function drawSide() {
  const cv = $('#side');
  if (!sideData) return;
  const { z, rows } = sideData, P = screenPitch(z), m = SHOW, zs = Array.from({ length: NZ }, (_, a) => ((a + 0.5) / NZ) * 2 * z);
  // Past z_c the light spreads over an area growing as z^2: each row is brightened by
  // (pitch / dx)^2 to make up for it, so the far field's rays stay equally bright.
  const Is = rows.map(({ I, lam }) => {
    const out = new Float64Array(NZ * m);
    zs.forEach((zz, a) => { const p = pitchAt(N, DX, lam, zz); resampleRow(I, a * N, p, P, out, a * m, (p / DX) ** 2); });
    return out;
  });
  // Always on the compressed scale, which shows the whole beam.  Ignore the very first rows (the
  // aperture itself) when choosing the brightness.
  const ref = whiteLevel(Is, false, m * 4);
  const img = intensityImage((w, o) => Is[w][o], m, rows.map((r) => r.rgb), ref);
  const [w, h] = canvasSize(cv), ctx = cv.getContext('2d');
  const c = document.createElement('canvas'); c.width = m; c.height = NZ;
  c.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(c, 0, 0, w, h);
  // The screen's distance is the middle of the side view.
  const dpr = window.devicePixelRatio || 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.setLineDash([6 * dpr, 4 * dpr]); ctx.lineWidth = dpr;
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke(); ctx.setLineDash([]);
  if (state.zoom > 1) {
    // The part of the screen shown zoomed in.
    const a = (w / 2) * (1 - 1 / state.zoom), b = w - a;
    ctx.lineWidth = 2 * dpr; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.moveTo(a, h / 2 - 6 * dpr); ctx.lineTo(a, h / 2 + 6 * dpr); ctx.moveTo(b, h / 2 - 6 * dpr); ctx.lineTo(b, h / 2 + 6 * dpr); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = `${11 * dpr}px system-ui, sans-serif`;
  ctx.fillText('z = 0', 6 * dpr, 13 * dpr);
  ctx.fillText(`z = ${fmtZ(z)} (the screen)`, 6 * dpr, h / 2 - 4 * dpr);
  ctx.fillText(`${fmtZ(2 * z)}`, 6 * dpr, h - 5 * dpr);
  const zc = criticalDistance(N, DX, state.white ? 0.45 : state.lambda);
  $('#side-note').textContent = 'the middle row of the screen, as z goes from 0 (top) to twice the screen\'s distance (bottom)' +
    (2 * z > zc ? `; past ${fmtZ(zc)} brightened ∝ z², against the spreading` : '');
}

function fmtZ(z) { return z >= 1e6 ? `${fmt(z / 1e6, 3)} m` : z >= 1000 ? `${fmt(z / 1000, 3)} mm` : `${fmt(z, 3)} µm`; }

function updateNotes() {
  const P = screenPitch(), span = (SHOW * P) / state.zoom, far = P > DX;
  $('#field-note').textContent = `z = ${fmtZ(state.z)}` +
    (state.zoom > 1 ? `, zoomed ${state.zoom}×: ${fmtLen(span)} across` : far ? `: ${fmtLen(span)} across` : '') +
    (far ? `, ±${fmt((span / 2 / state.z) * 1000, 3)} mrad` : '') +
    (state.z >= ZMAX ? ', the far field' : '');
  const p = PRESETS[state.preset];   // undefined when painted by hand
  const lam = state.white ? 0.55 : state.lambda, z = state.z;
  let text = '';
  if (p?.fz) {
    const f = state.size * 1000;
    if (state.preset === 'zone') {
      const M = zones(f, lam), R = Math.sqrt(M * lam * f);
      text = `Focus at f = ${fmt(state.size, 3)} mm (and f/3, f/5...): ${Math.ceil(M / 2)} open rings out to r = ${fmt(R / 1000, 2)} mm, the outermost ${fmt(R - Math.sqrt((M - 1) * lam * f), 2)} µm wide`;
    } else text = `Focus at f = ${fmt(state.size, 3)} mm; the lens is ${fmt((2 * lensRadius(f, lam)) / 1000, 2)} mm across`;
  } else if (state.preset === 'grating') text = `Talbot length 2d²/λ = ${fmtZ((2 * state.size * state.size) / lam)}`;
  else if (state.preset === 'edge') text = `Fringes about √(λz) = ${fmtLen(Math.sqrt(lam * z))} apart`;
  else if (p?.size[1] && !p.phase) {
    const a = state.size / 2, NF = (a * a) / (lam * z);
    text = `Fresnel number a²/λz = ${fmt(NF, 3)} (a = ${fmt(a, 3)} µm): ${NF > 3 ? 'near field, a sharp shadow' : NF > 0.3 ? 'in between' : 'far field: the pattern is the Fourier transform'}`;
  }
  if (far && state.display === 'complex' && !state.white) text += `${text ? '. ' : ''}The phase is shown relative to a spherical wave from the aperture`;
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
  apertureChanged();
  requestUpdate();
});
apCanvas.addEventListener('pointermove', (e) => {
  if (!painting) return;
  const [i, j] = apPixel(e);
  paintStroke(ap.re, ap.im, N, last[0], last[1], i, j, { shape: 'round', size: state.brush }, state.tool === 'open' ? 1 : 0, 0);
  last = [i, j];
  apertureChanged();
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

function setZ(z) { state.z = z; zSlider.value = z / 1000; requestUpdate(); saveHash(); }
const zSlider = slider({ label: 'z (mm)', min: ZMIN / 1000, max: ZMAX / 1000, log: true, value: state.z / 1000, title: 'The distance from the aperture to the screen, 0.1 mm to 10 m',
  onInput: (v) => setZ(v * 1000) });
$('#z-box').append(zSlider);
$('#far-box').append(el('button', { type: 'button', onclick: () => setZ(ZMAX),
  title: 'Move the screen to the end of the range, 10 m away, where the pattern is the Fraunhofer pattern (the Fourier transform of the aperture) to within about 1%' }, 'Far field'));

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
$('#tool-box').append(toolSeg, el('button', { type: 'button', onclick: () => { ap.re.fill(0); ap.im.fill(0); state.preset = 'custom'; for (const b of Object.values(presetButtons)) b.setAttribute('aria-pressed', 'false'); apertureChanged(); update(); } }, 'Close all'));
$('#brush-box').append(slider({ label: 'brush', min: 1, max: 40, step: 1, value: state.brush, onInput: (v) => { state.brush = Math.round(v); } }));

const displaySeg = segmented([
  { value: 'intensity', label: 'Intensity' }, { value: 'complex', label: 'Field (phase)' },
], state.display, (v) => { state.display = v; drawField(); updateNotes(); }, { label: 'Show' });
$('#show-box').append(displaySeg);
const scaleSeg = segmented([
  { value: 'sqrt', label: '√I', title: 'Brightness in proportion to the amplitude |U| = √I, all but the brightest 0.5% within range: faint fringes show' },
  { value: 'linear', label: 'I', title: 'Brightness in proportion to the intensity I = |U|², the brightest point white: the true contrast (the screen only; the side view stays on √I)' },
], state.scale, (v) => { state.scale = v; drawField(); saveHash(); }, { label: 'Scale' });
const zoomSeg = segmented([1, 4, 16].map((zm) => ({ value: zm, label: `${zm}×`, title: zm === 1 ? 'The whole screen' : `The middle of the screen, magnified ${zm} times` })),
  state.zoom, (v) => { state.zoom = v; drawField(); drawSide(); updateNotes(); saveHash(); }, { label: 'Zoom' });
$('#scale-box').append(el('span', { class: 'small muted' }, 'Scale:'), scaleSeg, el('span', { class: 'small muted' }, 'Zoom:'), zoomSeg);
$('#bright-box').append(slider({ label: 'Brightness', min: -2, max: 2, step: 0.01, value: 0, onInput: (v) => { state.bright = v; drawField(); drawSide(); } }));

window.addEventListener('resize', () => { drawAperture(); drawField(); drawSide(); });

// --------------------------------------------------------------------- experiments

function go(preset, { z = 10000, size, white = false, lambda = 0.55, scale = 'sqrt', zoom = 1 } = {}) {
  state.z = z; zSlider.value = z / 1000;
  state.scale = scale; scaleSeg.value = scale;
  state.zoom = zoom; zoomSeg.value = zoom;
  state.white = white; whiteToggle.on = white;
  state.lambda = lambda; lambdaSlider.value = lambda * 1000;
  loadPreset(preset, size ?? PRESETS[preset].size[2]);
}
const setups = {
  slit: () => go('slit', { z: 10000, size: 200 }),
  edge: () => go('edge', { z: 20000 }),
  arago: () => go('disk', { z: 150000, size: 500 }),
  double: () => go('double', { z: 80000, size: 250 }),
  talbot: () => go('grating', { z: (2 * 48 * 48) / 0.55 / 2, size: 48 }),
  zone: () => go('zone', { z: 50000, size: 50, scale: 'linear', zoom: 4 }),
  lens: () => go('lens', { z: 50000, size: 50, scale: 'linear', zoom: 4 }),
  white: () => go('grating', { z: 60000, size: 48, white: true }),
  speckle: () => go('random', { z: 200000, size: 24 }),
};
drawer($('#help'), $('#help-button'), setups);

// --------------------------------------------------------------------- start

const hash = readHash();
if (setups[hash.setup]) setups[hash.setup]();
else {
  if (+hash.z > 0) { state.z = +hash.z; zSlider.value = state.z / 1000; }
  if (hash.scale === 'linear') { state.scale = 'linear'; scaleSeg.value = 'linear'; }
  if ([4, 16].includes(+hash.zoom)) { state.zoom = +hash.zoom; zoomSeg.value = state.zoom; }
  const id = PRESETS[hash.preset] ? hash.preset : 'slit';
  loadPreset(id, +hash.size > 0 ? +hash.size : PRESETS[id].size[2]);
}
window.__app = { state, setups, ap, ZMAX, DX, screenPitch, get fields() { return fields; }, get sideData() { return sideData; }, get screen() { return shown; }, ready: true };
