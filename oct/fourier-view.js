// View 4, "Fourier-domain OCT": the reference mirror stays still, and a spectrometer (a grating
// and a line camera) records the interference spectrum: a fringe in wavenumber for every layer,
// the finer the deeper.  One Fourier transform gives the whole A-scan at once: the interferometer
// demo's spectrometer run backwards.  The camera's pixels are δk apart, which sets the depth range
// z_max = π/(2nδk); the spectrum is real, so a reflector the other side of zero path looks the
// same as this side (the mirror image).  Then a whole B-scan the same way, refolded live as the
// sample moves.

import { $, slider, segmented, toggle, setGroups } from '../lib/ui.js';
import { fitCanvas, Frame } from '../lib/plot.js';
import { STACKS, makeStack, bursts, mulberry32, SCENES, makeScene } from './sample.js';
import { makeSpectrometer, cameraSpectrum, fdAScan, fold, noiseSigma } from './fdoct.js';
import { peaks } from './tdoct.js';
import { BScan, sceneBeam } from './scan.js';
import { drawMichelson } from './pictures.js';
import { octColors, fieldAt, paintImage, um, smoothFor } from './plots.js';
import { scopeTrace } from '../lib/scope.js';

export const state = {
  mode: 'ascan', sample: 'one', offset: 40, N: 1024, subtract: true, both: false, td: true, scale: 'db', noise: -80,
  motor: true, pick: 0, scene: 'retina', shift: 120,
};
const NS = [128, 256, 512, 1024, 2048, 4096];

let S = null, stack = null, B = [], spec = null, cam = null, fd = null, seed = 1, dirty = true, motorDir = 1;
let bscan = null, bscanKey = '', fdImg = document.createElement('canvas'), fdKey = '';
// A new light for the same scene: the B-scan is measured again in a worker (scan-worker.js, the
// same numbers as here), while the one already measured stays on show, folded with the new
// spectrometer (its depth range and fall-off, what the bandwidth changes most); summing all the
// scatterers again takes 0.1 to 0.2 s, which a slider's every step would otherwise wait for.
// (Started the first time it is wanted.)
let worker, pending = null, jobSeq = 0;
function getWorker() {
  if (worker === undefined) {
    try {
      worker = new Worker(new URL('./scan-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = onWorker;
      worker.onerror = (e) => { e.preventDefault?.(); worker = null; pending = null; bscanKey = ''; dirty = true; };
    } catch (e) { worker = null; }
  }
  return worker;
}
const schemC = $('#q-schem'), specC = $('#q-spec'), scanC = $('#q-scan'), imgC = $('#q-bscan');

const sigmaR = () => (state.noise <= -119 ? 0 : 10 ** (state.noise / 20) / Math.SQRT2);
/** The depth range in optical path (n = 1): half of Δ_max = π/δk. */
export const dMax = () => spec.DMax / 2;

// --------------------------------------------------------------------- the physics of one A-scan

function compute() {
  spec = makeSpectrometer(S.src, state.N);
  stack = makeStack(state.sample, {});
  B = bursts(stack, state.offset);
  cam = cameraSpectrum(B, S.src, spec, { noise: sigmaR(), rng: mulberry32(500 + seed) });
  fd = fdAScan(cam, spec, { subtract: state.subtract, pad: 4 });
  dirty = true;
}
export function sourceChanged() { if (S) { compute(); fdKey = ''; } }

/** The FD A-scan at optical depth d (= Δ/2), interpolated. */
export function fdAt(d) {
  const u = (2 * d - fd.D0) / fd.h, j = Math.floor(u), t = u - j;
  if (j < 0 || j + 1 >= fd.L) return 0;
  return fd.A[j] * (1 - t) + fd.A[j + 1] * t;
}

/** Peaks of the FD A-scan for d ≥ 0 (above 4 × the noise's rms and 2% of the strongest layer). */
export function foundPeaks() {
  const m0 = fd.L / 2, A = fd.A.subarray(m0), top = Math.max(...B.map((b) => Math.abs(b.a)));
  const floor = Math.max(4 * Math.SQRT2 * sigmaR(), 0.02 * top);
  return peaks(A, 0, fd.h, floor).map((p) => ({ d: p.D / 2, a: p.a })).filter((p) => p.d > S.src.lc).sort((p, q) => p.d - q.d);
}

/** The stage motor: the sample moves slowly back and forth in depth. */
export function tick(dt) {
  if (!dt) return false;
  if (state.mode === 'ascan' && state.motor) {
    const thick = stack.n * Math.max(...stack.layers.map((l) => l.z)), lo = 15, hi = stack.layers.length === 1 ? 160 : Math.max(lo + 60, Math.min(0.92 * dMax() - thick, 600));
    let o = state.offset + motorDir * dt * (hi - lo) / 8;
    if (o > hi) { o = hi; motorDir = -1; } else if (o < lo) { o = lo; motorDir = 1; }
    state.offset = o; offsetS.value = +o.toFixed(1);
    seed++; compute();
    return true;
  }
  if (state.mode === 'bscan' && state.motor) {
    // Far enough each way to fold the retina's top over zero path and its bottom past the range.
    const lo = -380, hi = Math.max(200, dMax() - 750);
    let s = state.shift + motorDir * dt * 60;
    if (s > hi) { s = hi; motorDir = -1; } else if (s < lo) { s = lo; motorDir = 1; }
    state.shift = s; shiftS.value = +s.toFixed(1); dirty = true;
    return true;
  }
  return false;
}

// --------------------------------------------------------------------- drawing: one A-scan

function drawSchem() {
  const c = 0.5 * dMax();
  drawMichelson(schemC, {
    fd: true, dFixed: 0, win: [-0.08 * dMax(), 1.02 * dMax()], d: 0, lc: S.src.lc,
    surfaces: B.map((b) => ({ d: b.D / 2, r: b.r })), slab: stack.n > 1 ? { d0: B[0].D / 2, d1: B[B.length - 1].D / 2 } : null,
    label: stack.n > 1 ? `n = ${stack.n}` : '', sourceLabel: `${S.src.lamNm} nm`, spectrum: cameraPixels(),
  });
  void c;
}

/** The camera's pixels scaled to 0..1 for the picture (at most 160 of them). */
function cameraPixels() {
  const n = Math.min(160, spec.N), out = new Float32Array(n), top = cam.dc * S.src.spectrum(S.src.k0) * 1.5;
  for (let i = 0; i < n; i++) out[i] = cam.I[Math.floor(((i + 0.5) / n) * spec.N)] / top;
  return out;
}

function drawSpectrum(c) {
  const { ctx, width, height } = fitCanvas(specC);
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 46, right: 14, top: 22, bottom: 34 });
  f.x0 = spec.kLo; f.x1 = spec.kHi;
  const ref = S.src.spectrum(S.src.k0) * cam.dc, amp = B.reduce((s, b) => s + Math.abs(b.a), 0);
  f.y0 = 0; f.y1 = (cam.dc + 2.2 * amp) * 1.05;
  f.axes({ colors: c, xlabel: 'wavenumber k = 2π/λ (rad/μm), one point per pixel', ylabel: 'light on the pixel' });
  f.clip();
  // The source's spectrum, dashed: the level with no interference (the reference and the sample's
  // light added without fringes).
  ctx.strokeStyle = c.ink3; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.beginPath();
  for (let j = 0; j < spec.N; j++) { const x = f.X(spec.k(j)), y = f.Y((cam.dc * S.src.spectrum(spec.k(j))) / S.src.spectrum(S.src.k0)); if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  ctx.stroke(); ctx.setLineDash([]);
  // The picked layer's own fringe, S(k)[1 + 2a cos(kΔ)] (times the fall-off), and over it the
  // camera's pixels: both at the pixels' wavenumbers, drawn as a digital phosphor scope draws a
  // trace (lib/scope.js).  Where the finest fringe the pixels make has fewer than 8 of them (the
  // finer the deeper the layer; visible noise: 2), with the band-limited interpolation of the
  // scope's sin(x)/x display, so a fringe too fine for the camera shows as the coarser one its
  // samples make: folded back.  Smoothed across columns only where that fringe has fewer than
  // three device pixels.
  const pk = B[state.pick], s0 = S.src.spectrum(S.src.k0), x0 = f.X(spec.k(0)), x1 = f.X(spec.k(spec.N - 1)), dpr = ctx.getTransform().a;
  const perPixel = ((x1 - x0) * dpr) / (spec.N - 1);
  const pixelsPerFringe = (D) => { const q = Math.abs((D * spec.dk) / (2 * Math.PI)) % 1; return 1 / Math.min(q, 1 - q); };
  const look = (px) => ({ bandlimited: px < 8, smooth: smoothFor(px * perPixel) });
  const noisy = sigmaR() > 0 && (noiseSigma(S.src, spec, sigmaR()) / s0) * (f.h / (f.y1 - f.y0)) * dpr > 0.5;
  if (pk) {
    const r = spec.rolloff(pk.D);
    scopeTrace(ctx, f, { n: spec.N, y: (j) => { const k = spec.k(j); return f.Y((S.src.spectrum(k) * (cam.dc + 2 * pk.a * r * Math.cos(k * pk.D))) / s0); }, x0, x1,
      color: c.layer, width: 1.2, ...look(pixelsPerFringe(pk.D)) });
  }
  scopeTrace(ctx, f, { n: spec.N, y: (j) => f.Y(cam.I[j] / s0), x0, x1, color: c.sig, width: 1.2, ...look(Math.min(noisy ? 2 : Infinity, ...B.map((b) => pixelsPerFringe(b.D)))) });
  ctx.restore();
  // Wavelengths at the ends.
  ctx.fillStyle = c.ink2; ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'top';
  const nm = (k) => (2000 * Math.PI) / k;
  ctx.textAlign = 'left'; ctx.fillText(`λ = ${nm(spec.kLo).toFixed(0)} nm`, f.left, 4);
  ctx.textAlign = 'right'; ctx.fillText(`${nm(spec.kHi).toFixed(0)} nm`, f.right, 4);
  ctx.textAlign = 'center'; ctx.fillStyle = c.ink2;
  if (f.w > 480) ctx.fillText(`${spec.N} pixels, δk = ${(spec.dk * 1000).toFixed(2)} × 10⁻³ rad/μm apart`, (f.left + f.right) / 2, 4);
  if (pk) { ctx.fillStyle = c.layer; ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText(`purple: the fringe the ${pk.name} makes by itself`, f.right - 4, f.top + 4); }
}

let scanFrame = null;
function drawScan(c) {
  const { ctx, width, height } = fitCanvas(scanC);
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 52, right: 14, top: 12, bottom: 34 });
  const DM = dMax();
  f.x0 = state.both ? -DM : 0; f.x1 = DM;
  const db = state.scale === 'db', top = Math.max(...B.map((b) => Math.abs(b.a)));
  if (db) { f.y0 = Math.max(-100, Math.min(state.noise - 12, -60)); f.y1 = state.subtract ? Math.ceil((20 * Math.log10(top) + 6) / 10) * 10 : 10; }
  else { f.y0 = 0; f.y1 = state.subtract ? top * 1.25 : Math.max(top * 1.25, 1.1); }
  const Y = (a) => f.Y(db ? (a > 0 ? Math.max(f.y0 - 5, 20 * Math.log10(a)) : f.y0 - 5) : a);
  f.axes({ colors: c, xlabel: width > 700 ? 'optical depth n z beyond zero path (μm) — all of it from one camera frame' : 'optical depth n z beyond zero path (μm)', ylabel: db ? 'reflection (dB)' : 'reflectivity |r|', grid: db });
  f.clip();
  // The other side of zero path, shaded: where the mirror image lands.
  if (state.both) { ctx.fillStyle = c.faint; ctx.fillRect(f.left, f.top, f.X(0) - f.left, f.h); }
  // The fall-off with depth, dashed: how much of a reflector's height survives at each depth.
  ctx.strokeStyle = c.noise; ctx.lineWidth = 1; ctx.setLineDash([2, 4]); ctx.beginPath();
  for (let i = 0; i <= f.w; i += 2) { const d = f.invX(f.left + i), y = Y(top * spec.rolloff(2 * Math.abs(d))); if (i) ctx.lineTo(f.left + i, y); else ctx.moveTo(f.left + i, y); }
  ctx.stroke(); ctx.setLineDash([]);
  // The time-domain A-scan of the same sample (what view 2 measures), in grey.
  if (state.td) {
    const g = [0, 0];
    ctx.strokeStyle = c.ink3; ctx.lineWidth = 3; ctx.globalAlpha = 0.45; ctx.beginPath();
    for (let i = 0; i <= f.w; i++) { const d = f.invX(f.left + i), y = Y(Math.hypot(...fieldAt(B, S.src, 2 * d, g))); if (i) ctx.lineTo(f.left + i, y); else ctx.moveTo(f.left + i, y); }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  // The FD A-scan: the camera's spectrum transformed.
  ctx.strokeStyle = c.env; ctx.lineWidth = 1.5; ctx.beginPath();
  const per = (2 * (f.x1 - f.x0)) / f.w / fd.h;   // samples per pixel
  for (let i = 0; i <= f.w; i++) {
    const d0 = f.invX(f.left + i), d1 = f.invX(f.left + i + 1);
    let v = 0;
    if (per > 1) { const j0 = Math.floor((2 * d0 - fd.D0) / fd.h), j1 = Math.ceil((2 * d1 - fd.D0) / fd.h); for (let j = Math.max(0, j0); j <= Math.min(fd.L - 1, j1); j++) v = Math.max(v, fd.A[j]); }
    else v = fdAt(d0);
    const y = Y(v);
    if (i) ctx.lineTo(f.left + i, y); else ctx.moveTo(f.left + i, y);
  }
  ctx.stroke();
  // The layers' true depths and strengths.
  B.forEach((b, i) => {
    const x = f.X(b.D / 2), y = Y(Math.abs(b.a));
    ctx.fillStyle = i === state.pick ? c.layer : c.layer; ctx.globalAlpha = i === state.pick ? 1 : 0.55;
    ctx.beginPath(); ctx.moveTo(x, y - 1); ctx.lineTo(x - 5, y - 10); ctx.lineTo(x + 5, y - 10); ctx.closePath(); ctx.fill();
    if (state.both && b.D !== 0) { ctx.globalAlpha = 0.3; const xm = f.X(-b.D / 2); ctx.beginPath(); ctx.moveTo(xm, y - 1); ctx.lineTo(xm - 5, y - 10); ctx.lineTo(xm + 5, y - 10); ctx.closePath(); ctx.fill(); }
    ctx.globalAlpha = 1;
  });
  // Layers the image shows somewhere else: folded back from past the range, or mirrored from
  // the other side of zero path.  A hollow marker where they land, saying where they are.
  ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  B.forEach((b) => {
    const d = b.D / 2, shown = state.both ? (Math.abs(d) <= DM ? null : Math.sign(d) * fold(d, DM)) : (d >= 0 && d <= DM ? null : fold(d, DM));
    if (shown === null) return;
    const x = f.X(shown), y = Y(Math.abs(b.a) * spec.rolloff(Math.abs(b.D)));
    ctx.strokeStyle = c.layer; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y - 1); ctx.lineTo(x - 5, y - 10); ctx.lineTo(x + 5, y - 10); ctx.closePath(); ctx.stroke();
    const text = d < 0 ? `mirrored from ${d.toFixed(0)} μm` : `folded back from ${d.toFixed(0)} μm`, half = ctx.measureText(text).width / 2 + 2;
    ctx.fillStyle = c.layer; ctx.fillText(text, Math.max(f.left + half, Math.min(f.right - half, x)), Math.max(f.top + 14, y - 12));
  });
  // Where the layers' light interferes among itself (the autocorrelation terms): at their separations.
  ctx.strokeStyle = c.ink3; ctx.lineWidth = 1.2;
  if (B.length <= 4) for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
    const dd = Math.abs(B[i].D - B[j].D) / 2, y = Y(Math.abs(B[i].a * B[j].a));
    for (const x of state.both ? [f.X(dd), f.X(-dd)] : [f.X(dd)]) { ctx.beginPath(); ctx.moveTo(x, y - 1); ctx.lineTo(x - 4, y - 8); ctx.lineTo(x + 4, y - 8); ctx.closePath(); ctx.stroke(); }
  }
  // Zero path.
  const x0 = f.X(0);
  ctx.strokeStyle = c.mirror; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x0, f.top); ctx.lineTo(x0, f.bottom); ctx.stroke();
  ctx.restore();
  ctx.font = '11px system-ui, sans-serif';
  legendLine();
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillStyle = c.mirror; ctx.fillText('zero path', x0 + 4, f.bottom - 3);
  scanFrame = f;
}

/** The A-scan's legend, as a line of text over the plot (rebuilt only when it changes). */
function legendLine() {
  const parts = [['env', '— from the spectrum, by one Fourier transform'], ...(state.td ? [['td', '— the time-domain A-scan of view 2']] : []), ['fall', '··· the fall-off with depth'],
    ['lay', '▼ the layers (click one to see its fringe)'], ...(B.length > 1 && B.length <= 4 ? [['ac', '▽ two layers\' light interfering']] : [])];
  const box = $('#q-legend'), key = parts.map((p) => p[0]).join();
  if (box._key === key) return;
  box._key = key;
  box.replaceChildren(...parts.map(([k, t]) => { const e = document.createElement('span'); e.className = `lg-${k}`; e.textContent = t; return e; }));
}

// --------------------------------------------------------------------- drawing: a B-scan

/** The scene's B-scan in the envelope domain, measured once (its depth profile does not change
 *  as the sample moves: only where it lands does). */
function ensureBscan() {
  const key = `${state.scene}|${S.src.lamNm}|${S.src.fwhmNm}`;
  if (bscanKey === key) { cancel(); return; }
  // The same scene in new light: measured in the worker (unless the tests hold the clock), the
  // old picture kept meanwhile.
  if (bscan && bscan.scene.name === state.scene && !S.held && getWorker()) {
    if (!pending || pending.key !== key) post(key);
    return;
  }
  cancel();
  bscanKey = key;
  // The same scene object while the scene is the same: its scatterers are kept with it (scan.js's
  // cell cache), so a new bandwidth sums them again instead of making them again.
  if (!ensureBscan.scene || ensureBscan.scene.name !== state.scene) ensureBscan.scene = makeScene(state.scene, {});
  const sc = ensureBscan.scene;
  const beam = sceneBeam(sc, S.src, sc.NA, sc.focus);
  const bs = new BScan(sc, S.src, { nx: 256 });
  bs.measureAll({ beam, speckle: true, noise: 0 });
  adopt(bs);
}

/** Show a measured B-scan: white at its brightest 0.5%.  (A typed array sorts by number, and fast.) */
function adopt(bs) {
  const all = Float32Array.from(bs.img).sort();
  bs.level = 20 * Math.log10(all[Math.floor(0.995 * (all.length - 1))] || 1e-3) + 2;
  bscan = bs; fdKey = ''; dirty = true;
}

/** Forget the worker's job, if any (the light came back, or a new scene was measured here). */
function cancel() { if (pending) { pending = null; worker?.postMessage({ type: 'stop' }); } }

/** Ask the worker for the scene's B-scan in the present light (it drops any job it was on). */
function post(key) {
  const sc = ensureBscan.scene, id = ++jobSeq, bs = new BScan(sc, S.src, { nx: 256 });
  pending = { id, key, bs };
  worker.postMessage({ type: 'job', id, kind: 'bscan', from: 0, scene: sc.name, sceneOpts: {}, lam: S.src.lamNm, fwhm: S.src.fwhmNm,
    NA: sc.NA, focus: sc.focus, opts: { speckle: true, noise: 0 }, nz: bs.nz, nx: bs.nx, y: 0, N: 1, how: 'tissue', step: 0, ref: false });
}

function onWorker(e) {
  const m = e.data, p = pending;
  if (!p || m.id !== p.id || m.type !== 'tasks') return;
  const nz = p.bs.nz;
  for (let t = m.from; t < m.to; t++) p.bs.add(t, m.data.subarray((t - m.from) * nz, (t - m.from + 1) * nz));
  if (m.to >= p.bs.nx) { pending = null; bscanKey = p.key; adopt(p.bs); }
}

/** The B-scan as the Fourier-domain system shows it: each column's power folded into [0, dm],
 *  times the fall-off, plus the DC line at zero path if the reference is not subtracted. */
function fdImage() {
  ensureBscan();
  const dm = dMax(), nz = Math.max(256, Math.min(1024, Math.round(dm / bscan.hd))), h = dm / nz;
  const key = `${state.shift.toFixed(2)}|${state.N}|${spec.dk}|${state.subtract}|${nz}|${bscanKey}`;
  if (key === fdKey) return { nz, h };
  fdKey = key;
  const nx = bscan.nx, P = new Float32Array(nx * nz);
  // The fall-off and the fold depend on the depth alone: worked out once for all the columns.
  const M = bscan.nz, wt = new Float32Array(M), at = new Int32Array(M);
  for (let m = 0; m < M; m++) {
    const d = m * bscan.hd + state.shift, r = spec.rolloff(2 * d);
    wt[m] = r * r * (bscan.hd / h); at[m] = Math.min(nz - 1, Math.floor(fold(d, dm) / h));
  }
  for (let ix = 0; ix < nx; ix++) {
    const A = bscan.img.subarray(ix * M, (ix + 1) * M), o = ix * nz;
    for (let m = 0; m < M; m++) P[o + at[m]] += A[m] * A[m] * wt[m];
    if (!state.subtract) { P[o] += 1; P[o + 1] += 0.3; }
  }
  const lo = bscan.level - 40, hi = bscan.level;
  paintImage(fdImg, nx, nz, (i, j) => Math.sqrt(P[i * nz + j]), lo, hi);
  fdImage.P = P;
  return { nz, h };
}

let imgFrame = null;
function drawFdBscan(c) {
  const { nz, h } = fdImage();
  const { ctx, width, height } = fitCanvas(imgC);
  ctx.fillStyle = '#0d0f14'; ctx.fillRect(0, 0, width, height);
  const L = { left: 52, right: 10, top: 8, bottom: 28 }, w = width - L.left - L.right, hh = height - L.top - L.bottom;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(fdImg, L.left, L.top, w, hh);
  imgFrame = { L, w, hh, nz, h };
  ctx.fillStyle = 'rgba(225,226,230,0.75)'; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const dm = dMax(), step = dm > 1500 ? 500 : dm > 600 ? 200 : 100;
  for (let d = 0; d <= dm; d += step) ctx.fillText(`${d}`, L.left - 5, L.top + (d / dm) * hh);
  ctx.save(); ctx.translate(12, L.top + hh / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('optical depth beyond zero path (μm)', 0, 0); ctx.restore();
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const hw = bscan.scene.halfWidth;
  for (let x = -hw; x <= hw; x += 500) ctx.fillText(`${(x / 1000).toFixed(1)}`, L.left + ((x + hw) / (2 * hw)) * w, L.top + hh + 5);
  ctx.textAlign = 'right'; ctx.fillText('x (mm)', L.left + w, L.top + hh + 15);
  // Zero path at the top, the end of the range at the bottom.
  ctx.fillStyle = '#7ad694'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('zero path', L.left + 4, L.top + 3);
  ctx.fillStyle = 'rgba(225,226,230,0.75)'; ctx.textBaseline = 'bottom'; ctx.fillText(`the end of the depth range, z_max = ${dm.toFixed(0)} μm of optical path`, L.left + 4, L.top + hh - 3);
  void c; void nz; void h;
}

function readout() {
  const src = S.src;
  if (state.mode === 'ascan') {
    const pk = B[state.pick] || B[0], fr = ((spec.kHi - spec.kLo) * pk.D) / (2 * Math.PI);
    const ppf = spec.N / Math.abs(fr);
    setGroups($('#q-readout-1'), [[`The ${pk.name} is `, { v: pk.D / 2, dec: 1, w: 6 }, ' μm beyond zero path:'],
      ['its fringe has a period 2π/Δ = ', { v: (2 * Math.PI) / Math.abs(pk.D), dec: 4, w: 6 }, ' rad/μm,'], ['', { v: Math.abs(fr), dec: 1, w: 5 }, ' across the camera,'],
      ['', { v: Math.min(ppf, 99999), dec: 1, w: 6 }, ppf < 2 ? ' pixels each: too few (2 needed)' : ' pixels each']]);
    $('#q-readout-1').classList.toggle('warn-line', ppf < 2);
    const found = foundPeaks();
    setGroups($('#q-readout-2'), [['Peaks from the transform: ', { v: found.length, dec: 0, w: 2 }, ';'],
      ...(found.length === 1 ? [['at ', { v: found[0].d, dec: 2, w: 7 }, ' μm']] : found.length > 1 ? [['the first at ', { v: found[0].d, dec: 2, w: 7 }, ' μm,'], ['the last at ', { v: found[found.length - 1].d, dec: 2, w: 7 }, ' μm']] : [])]);
  } else {
    setGroups($('#q-readout-1'), [['The sample\'s top ', { v: state.shift, dec: 0, w: 5, plus: '+' }, ' μm from zero path;'],
      ['its bottom at ', { v: state.shift + bscan.dMax, dec: 0, w: 5, plus: '+' }, ' μm,'], ['the range ends at ', { v: dMax(), dec: 0, w: 5 }, ' μm']]);
    setGroups($('#q-readout-2'), [`${bscan.nx} A-scans, one camera frame each: at 70,000 frames a second that is`, ['', { v: (bscan.nx / 70000) * 1000, dec: 1, w: 4 }, ' ms a B-scan,'], ['', { v: 70000 / bscan.nx, dec: 0, w: 4 }, ' B-scans a second: video rate.']]);
  }
  setGroups($('#q-readout-3'), [['The camera: ', { v: spec.N, dec: 0, w: 4 }, ' pixels,'], ['δk = 3Δk/N = ', { v: spec.dk * 1000, dec: 3, w: 6 }, ' × 10⁻³ rad/μm:'],
    ['depth range z_max = π/(2nδk) = ', { v: dMax(), dec: 0, w: 5 }, ' μm in air,'], ['', { v: dMax() / (state.mode === 'bscan' ? bscan.scene.nView : stack.n), dec: 0, w: 5 }, ` μm at n = ${state.mode === 'bscan' ? bscan.scene.nView : stack.n}`]]);
  void src;
}

export function draw(force = false) {
  if (!dirty && !force) return;
  dirty = false;
  const c = octColors();
  if (state.mode === 'ascan') { drawSchem(); drawSpectrum(c); drawScan(c); } else drawFdBscan(c);
  readout();
}
export function invalidate() { dirty = true; fdKey = ''; }

// --------------------------------------------------------------------- pointer

scanC.addEventListener('pointerdown', (e) => {
  if (!scanFrame) return;
  const r = scanC.getBoundingClientRect(), d = scanFrame.invX(e.clientX - r.left);
  let best = -1, bd = Infinity;
  B.forEach((b, i) => { const q = Math.min(Math.abs(b.D / 2 - d), state.both ? Math.abs(-b.D / 2 - d) : Infinity); if (q < bd) { bd = q; best = i; } });
  if (best >= 0) { state.pick = best; dirty = true; S.onChange(); }
});

// --------------------------------------------------------------------- controls

let modeSeg, sampleSeg, offsetS, nSeg, subT, bothT, tdT, scaleSeg, noiseS, motorT, sceneSeg, shiftS;

export function setMode(m) {
  state.mode = m === 'bscan' ? 'bscan' : 'ascan';
  modeSeg.value = state.mode;
  $('#main').dataset.qmode = state.mode;
  if (state.mode === 'bscan') ensureBscan();
  dirty = true; S.onChange();
}

export function init(shared) {
  S = shared;
  modeSeg = segmented([{ value: 'ascan', label: 'One A-scan', title: 'One A-scan: the spectrum and its transform' },
    { value: 'bscan', label: 'A whole B-scan', title: 'A B-scan the same way, one camera frame per column' }], state.mode, (m) => setMode(m), { label: 'What to show' });
  $('#q-mode-box').append(modeSeg);
  sampleSeg = segmented(Object.entries(STACKS).map(([k, s]) => ({ value: k, label: s.label, title: s.title })), state.sample, (v) => { state.sample = v; state.pick = Math.min(state.pick, makeStack(v).layers.length - 1); compute(); S.onChange(); }, { label: 'Sample' });
  sampleSeg.classList.add('button-grid');
  $('#q-sample-box').append(sampleSeg);
  offsetS = slider({ label: 'sample at (μm)', min: -600, max: 2400, step: 0.5, value: state.offset, title: 'How far beyond zero path the sample\'s front face is (negative: nearer than the reference mirror)',
    onInput: (v) => { state.offset = v; setMotorOn(false); compute(); S.onChange(); } });
  motorT = toggle('Stage motor: move the sample', state.motor, (on) => setMotorOn(on), 'Move the sample slowly back and forth in depth');
  $('#q-pos-box').append(offsetS, motorT);
  nSeg = segmented(NS.map((n) => ({ value: n, label: String(n), title: `${n} pixels on the camera` })), state.N, (v) => { state.N = v; compute(); fdKey = ''; S.onChange(); }, { label: 'Pixels' });
  $('#q-n-box').append(nSeg);
  subT = toggle('Subtract the reference spectrum', state.subtract, (on) => { state.subtract = on; compute(); fdKey = ''; S.onChange(); }, 'Take away the spectrum measured with the sample arm blocked: the big peak at zero path goes');
  bothT = toggle('Show both sides of zero path', state.both, (on) => { state.both = on; dirty = true; S.onChange(); }, 'Show the transform for negative depths too: the mirror image');
  tdT = toggle('Compare with the time-domain A-scan', state.td, (on) => { state.td = on; dirty = true; S.onChange(); }, 'Draw, in grey, what view 2\'s scanning mirror would measure');
  $('#q-show-box').append(subT);
  $('#q-show-a').append(bothT, tdT);
  scaleSeg = segmented([{ value: 'lin', label: 'linear' }, { value: 'db', label: 'dB' }], state.scale, (v) => { state.scale = v; dirty = true; S.onChange(); }, { label: 'Scale' });
  $('#q-scale-box').append(scaleSeg);
  noiseS = slider({ label: 'noise floor (dB)', min: -120, max: -20, step: 0.5, value: state.noise, title: 'The camera\'s noise, as the reflection it equals (−120: none)', onInput: (v) => { state.noise = v; compute(); S.onChange(); } });
  $('#q-noise-box').append(noiseS);
  sceneSeg = segmented(['retina', 'onion'].map((k) => ({ value: k, label: SCENES[k].label, title: SCENES[k].title })), state.scene, (v) => { state.scene = v; bscanKey = ''; dirty = true; S.onChange(); }, { label: 'Scene' });
  $('#q-scene-box').append(sceneSeg);
  shiftS = slider({ label: 'sample at (μm)', min: -900, max: 2400, step: 1, value: state.shift, title: 'Where the top of the picture is, beyond zero path (negative: part of the sample is nearer than the reference)',
    onInput: (v) => { state.shift = v; setMotorOn(false); dirty = true; S.onChange(); } });
  const motorB = toggle('Stage motor: move the sample', state.motor, (on) => setMotorOn(on), 'Move the sample slowly up and down');
  motorT._twin = motorB;
  $('#q-shift-box').append(shiftS, motorB);
  compute();
}

function setMotorOn(on) {
  state.motor = on; motorT.on = on; if (motorT._twin) motorT._twin.on = on;
  dirty = true; S.onChange();
}

export function sync() {
  modeSeg.value = state.mode; sampleSeg.value = state.sample; offsetS.value = state.offset; nSeg.value = state.N; subT.on = state.subtract; bothT.on = state.both;
  tdT.on = state.td; scaleSeg.value = state.scale; noiseS.value = state.noise; motorT.on = state.motor; if (motorT._twin) motorT._twin.on = state.motor;
  sceneSeg.value = state.scene; shiftS.value = state.shift;
  $('#main').dataset.qmode = state.mode;
  dirty = true;
}

export function configure(o = {}) {
  Object.assign(state, { mode: 'ascan', sample: 'one', offset: 40, N: 1024, subtract: true, both: false, td: true, scale: 'db', noise: -80, motor: true, pick: 0, scene: 'retina', shift: 120 }, o);
  motorDir = 1;
  compute();
  state.pick = Math.min(state.pick, B.length - 1);
  if (state.mode === 'bscan') ensureBscan();
  sync();
}

export function toHash() {
  const s = state;
  return { qmode: s.mode === 'bscan' ? 'bscan' : undefined, smp: s.sample, off: +s.offset.toFixed(1), N: s.N, sub: s.subtract ? undefined : 0, both: s.both ? 1 : undefined,
    td: s.td ? undefined : 0, scale: s.scale, noise: s.noise, motor: s.motor ? 1 : 0, pick: s.pick, scene: s.mode === 'bscan' ? s.scene : undefined, shift: s.mode === 'bscan' ? +s.shift.toFixed(0) : undefined };
}
export function fromHash(h, num) {
  configure({ mode: h.qmode === 'bscan' ? 'bscan' : 'ascan', sample: STACKS[h.smp] ? h.smp : 'one', offset: num('off', 40, -600, 2400), N: NS.includes(num('N', 1024)) ? num('N', 1024) : 1024,
    subtract: h.sub !== '0', both: h.both === '1', td: h.td !== '0', scale: h.scale === 'lin' ? 'lin' : 'db', noise: num('noise', -80, -120, -20), motor: h.motor !== '0', pick: Math.round(num('pick', 0, 0, 8)),
    scene: h.scene === 'onion' ? 'onion' : 'retina', shift: num('shift', 120, -900, 2400) });
}

/** For the tests. */
export const peek = () => ({ bursts: B.map((b) => ({ ...b })), spec, cam, fd, bscan, pending: !!pending, dMax: dMax() });
