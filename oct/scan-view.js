// View 3, "B-scan and the volume": a galvo mirror steps the beam across a scene, each step an
// A-scan, and the A-scans stack into a cross-section, the B-scan (x across, depth down, grey in
// dB as clinical OCT shows it).  The B-scan can be measured N times and the repeats' brightness
// averaged, which calms the speckle as 1/√N while the layers stay.  Then a second axis: the
// B-scans stack along y into a volume, shown as three orthogonal slices (a B-scan, a
// cross-section, an en-face slab at one depth, flat or following a layer's curve) and as planes in
// a cube.  Lengths in μm; the images' depth is the optical depth ÷ the index the instrument
// assumes (the scene's nView).

import { $, slider, segmented, toggle, setGroups } from '../lib/ui.js';
import { fitCanvas } from '../lib/plot.js';
import { SCENES, makeScene } from './sample.js';
import { BScan, Volume, sceneBeam, column, speckleRegion, speckleContrast, averagedContrast, regionWidths } from './scan.js';
import { drawScene, drawCube, SLICE } from './pictures.js';
import { octColors, paintImage } from './plots.js';

export const state = {
  mode: 'bscan', scene: 'retina', speckle: true, lesion: true, tilt: 0, rough: 0, seed: 1,
  NA: 0.03, focus: 260, noise: -72, range: 38, playing: true, rate: 128, vrate: 8, probe: null,
  ix: 32, iy: 32, m: 120, slab: 12,
  avg: 1, how: 'tissue', step: 9,                   // averaging: N repeats, what moves between them
  follow: false, layer: 7, below: 11,                // the en-face slab: flat, or following a layer
};
const BUDGET = 14;           // ms of measuring per animation frame
const VOL = { nx: 64, ny: 64, nz: 256 };
const AVERAGES = [1, 2, 4, 8, 16];
/** The layers an en-face slab can follow: the band whose top it follows. */
const LAYERS = [
  { value: 0, label: 'the surface', title: 'Follow the sample\'s top surface (for the retina: the inner limiting membrane), pit and all' },
  { value: 7, label: 'the pigment epithelium', title: 'Follow the top of the retinal pigment epithelium, the bright layer at the back of the retina, as clinics do', scene: 'retina' },
];

let S = null, scene = null, beam = null, bs = null, vol = null, level = -20;
let next = 0, progress = 0, fast = false;                 // the B-scan's scan, in tasks (repeat k, column ix: k nx + ix)
let vnext = 0, vprogress = 0, vfast = false;               // the volume's, in columns (iy * nx + ix)
let dirty = true, pointer = null;
// The speckle contrast: the speckle-free picture of a quarter of the columns (ref), made when it is
// first wanted; the contrast after each complete repeat (chist); the beam's width where it is measured.
let ref = null, refCols = [], chist = [], cWidths = null;
// The en-face slab's layer: its optical depth under every A-scan of the volume.
let layerD = null, layerKey = '';
const sceneC = $('#s-scene'), bscanC = $('#s-bscan'), ascanC = $('#s-ascan'), cplotC = $('#s-cplot');
const cubeC = $('#s-cube'), xyC = $('#s-xy'), xzC = $('#s-xz'), yzC = $('#s-yz');
const bImg = document.createElement('canvas'), xzImg = document.createElement('canvas'), yzImg = document.createElement('canvas'), xyImg = document.createElement('canvas');
let bImgStale = true;

const SCENE_LAYOUT = { left: 50, right: 10, top: 0, bottom: 20 };
const BSCAN_LAYOUT = { left: 50, right: 10, top: 6, bottom: 28 };

/** The noise in the image, σ_r per component, from the floor in dB (20 log₁₀ of its rms). */
const sigmaR = () => (state.noise <= -119 ? 0 : 10 ** (state.noise / 20) / Math.SQRT2);
const opts = () => ({ beam, speckle: state.speckle, noise: sigmaR(), seed: state.seed });

// --------------------------------------------------------------------- the worker
// While the clock runs, the A-scans are computed off the page's thread (scan-worker.js), ahead
// of the scan, and the page only reveals them at the scan's speed and paints: a frame costs a
// few milliseconds however slow the machine.  With the clock held (the tests, the still
// pictures) or without a worker, the page computes them itself, a frame's budget at a time.  A
// job is one scan from one task on, with everything that decides its numbers; `epoch` counts the
// scans started afresh, so a job from an older one is replaced.
let worker = null, job = null, jobSeq = 0, epoch = 0;
try {
  worker = new Worker(new URL('./scan-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = onWorker;
  worker.onerror = (e) => { e.preventDefault?.(); worker = null; job = null; };
} catch (e) { worker = null; }
const useWorker = () => !!worker && !S.held;

/** The job for the scan of the current mode, from its next task (started if it is not running). */
function currentJob() {
  const kind = state.mode, grid = kind === 'bscan' ? bs : vol, from = kind === 'bscan' ? next : vnext;
  if (job && job.kind === kind && job.grid === grid && job.epoch === epoch && from <= job.have + 64) return job;
  const id = ++jobSeq, o = opts();
  delete o.beam;
  const msg = { type: 'job', id, kind, from, scene: state.scene, sceneOpts: { tilt: state.tilt, rough: state.rough, lesion: state.lesion, seed: state.seed },
    lam: S.src.lamNm, fwhm: S.src.fwhmNm, NA: state.NA, focus: state.focus, opts: o, nz: grid.nz, nx: grid.nx };
  if (kind === 'bscan') Object.assign(msg, { y: bs.y, N: bs.N, how: bs.how, step: bs.step, ref: !ref });
  else msg.ny = vol.ny;
  job = { id, kind, grid, epoch, from, have: from, chunks: [] };
  worker.postMessage(msg);
  return job;
}

function onWorker(e) {
  const m = e.data;
  // (A job's results are dropped when its scan has gone: a new scene, a new set-up.)
  if (!job || m.id !== job.id || job.grid !== (job.kind === 'volume' ? vol : bs)) return;
  if (m.type === 'ref') {
    if (ref || job.grid !== bs) return;
    const nz = bs.nz;
    ref = new Float32Array(bs.nx * nz); refCols = m.cols; cWidths = null;
    m.cols.forEach((ix, i) => ref.set(m.data.subarray(i * nz, (i + 1) * nz), ix * nz));
    return;
  }
  if (job.kind === 'volume') vol.data.set(m.data, m.from * vol.nz);   // hidden until the scan reaches it
  else job.chunks.push(m);
  job.have = m.to;
}

/** The B-scan's task t from the worker's results (dropping those before it). */
function take(t) {
  const c = job.chunks;
  while (c.length && c[0].to <= t) c.shift();
  if (!c.length || c[0].from > t) return null;
  const nz = bs.nz;
  return c[0].data.subarray((t - c[0].from) * nz, (t - c[0].from + 1) * nz);
}

/** Reveal the worker's results up to `upto` (within a few milliseconds), as the page's own
 *  computing would have measured them. */
function revealB(upto) {
  const j = currentJob(), t0 = performance.now();
  let did = 0;
  while (next < Math.min(upto, j.have, bs.tasks) && (did === 0 || performance.now() - t0 < 6)) {
    const A = take(next);
    if (!A) break;
    bs.add(next % bs.nx, A, Math.floor(next / bs.nx)); paintColumn(next % bs.nx); next++; did++;
    if (next % bs.nx === 0) repeatDone(next / bs.nx);
  }
  if (next >= bs.tasks) { state.playing = false; fast = false; updatePlay(); }
  return did;
}
function revealV(upto) {
  const j = currentJob(), total = vol.nx * vol.ny, to = Math.min(Math.floor(upto), j.have, total);
  if (to <= vnext) return 0;
  const did = to - vnext;
  vnext = to;
  for (let iy = 0; iy < vol.ny; iy++) if (!vol.done[iy] && vnext >= (iy + 1) * vol.nx) { vol.done[iy] = 1; vol.count++; }
  if (vnext >= total) { state.playing = false; vfast = false; updatePlay(); }
  return did;
}
/** The volume starts again (its next scan is a new job). */
function resetVolume() { vol.reset(); vnext = 0; vprogress = 0; epoch++; }

// --------------------------------------------------------------------- the scene and the scans

function makeAll() {
  scene = makeScene(state.scene, { tilt: state.tilt, rough: state.rough, lesion: state.lesion, seed: state.seed });
  beam = sceneBeam(scene, S.src, state.NA, state.focus);
  bs = new BScan(scene, S.src);
  bs.setAverage(state.avg, state.how, state.step);
  vol = null; layerD = null;
  autoLevel();
  restart();
}

/** White in the images at the brightest 0.5% of a preview of a few columns; black range dB below. */
function autoLevel() {
  const nz = bs.nz, a = new Float64Array(nz), all = [];
  for (let k = 0; k < 9; k++) {
    column(scene, S.src, -scene.halfWidth * 0.9 + (k * 1.8 * scene.halfWidth) / 8, 0, bs.hd, nz, a, opts());
    for (let m = 0; m < nz; m++) all.push(a[m]);
  }
  all.sort((p, q) => p - q);
  const top = all[Math.floor(0.995 * (all.length - 1))] || 1e-3;
  level = 20 * Math.log10(top) + 2;
}

/** Start the B-scan again from the first column; quick: as fast as the machine allows. */
export function restart(quick = false) {
  next = 0; progress = 0; fast = quick; epoch++;
  bs.reset();
  chist = []; ref = null;
  if (!quick) bImgStale = true;
  state.playing = true;
  if (vol) { resetVolume(); vfast = false; }
  updatePlay();
  dirty = true;
}

/** Measure as many of the B-scan's tasks as the budget allows, up to `upto`. */
function measureB(upto) {
  const t0 = performance.now(), total = bs.tasks;
  let did = 0;
  while (next < total && next < upto && (did === 0 || performance.now() - t0 < BUDGET)) {
    bs.measureTask(next, opts()); paintColumn(next % bs.nx); next++; did++;
    if (next % bs.nx === 0) repeatDone(next / bs.nx);
  }
  if (next >= total) { state.playing = false; fast = false; updatePlay(); }
  return did;
}

function ensureVolume() {
  if (vol) return;
  vol = new Volume(scene, S.src, VOL);
  vnext = 0; vprogress = 0;
  state.ix = Math.min(state.ix, VOL.nx - 1); state.iy = Math.min(state.iy, VOL.ny - 1); state.m = Math.min(state.m, VOL.nz - 1);
}

function measureV(upto) {
  const t0 = performance.now(), total = vol.nx * vol.ny;
  let did = 0;
  while (vnext < total && vnext < upto && (did === 0 || performance.now() - t0 < BUDGET)) {
    const iy = Math.floor(vnext / vol.nx), ix = vnext % vol.nx, ix1 = Math.min(vol.nx, ix + 8, ix + Math.max(1, Math.ceil(upto - vnext)));
    vol.measure(iy, opts(), ix, ix1);
    did += ix1 - ix; vnext += ix1 - ix;
  }
  if (vnext >= total) { state.playing = false; vfast = false; updatePlay(); }
  return did;
}

export function tick(dt) {
  if (!state.playing) return false;
  const w = useWorker();
  if (state.mode === 'bscan') {
    progress = fast ? bs.tasks : progress + state.rate * Math.min(dt, 0.1);
    if (w ? revealB(Math.floor(progress)) : measureB(Math.floor(progress))) dirty = true;
  } else {
    ensureVolume();
    vprogress = vfast ? vol.nx * vol.ny : vprogress + state.vrate * vol.nx * Math.min(dt, 0.1);
    if (w ? revealV(vprogress) : measureV(Math.floor(vprogress))) dirty = true;
  }
  return true;
}

/** One more column (B-scan) or one more B-scan (volume), then pause. */
export function stepScan() {
  state.playing = false;
  if (state.mode === 'bscan') { if (next >= bs.tasks) restart(); state.playing = false; measureB(next + 1); progress = next; }
  else { ensureVolume(); if (vnext >= vol.nx * vol.ny) resetVolume(); const end = (Math.floor(vnext / vol.nx) + 1) * vol.nx; while (vnext < end) measureV(end); vprogress = vnext; }
  state.playing = false; updatePlay(); dirty = true;
}

/** Everything that is left, as fast as the machine allows. */
export function finishScan() {
  if (state.mode === 'bscan') { fast = true; if (next >= bs.tasks) return; }
  else { ensureVolume(); vfast = true; if (vnext >= vol.nx * vol.ny) return; }
  state.playing = true; updatePlay();
}

/** For the tests: finish now, synchronously. */
export function finishNow() {
  if (state.mode === 'bscan') {
    while (next < bs.tasks) { bs.measureTask(next, opts()); paintColumn(next % bs.nx); next++; if (next % bs.nx === 0) repeatDone(next / bs.nx); }
  } else { ensureVolume(); while (vnext < vol.nx * vol.ny) { const iy = Math.floor(vnext / vol.nx); vol.measure(iy, opts()); vnext = (iy + 1) * vol.nx; } }
  state.playing = false; fast = vfast = false; updatePlay(); dirty = true;
}

export function sourceChanged() { if (S) { makeAll(); } }

// --------------------------------------------------------------------- the speckle contrast

/** The speckle-free picture of every fourth column that has tissue to measure in (made once). */
function ensureRef() {
  if (ref) return;
  const nz = bs.nz;
  ref = new Float32Array(bs.nx * nz); refCols = [];
  for (let ix = 2; ix < bs.nx; ix += 4) {
    if (!speckleRegion(scene, bs.x(ix), bs.y, bs.hd, nz).length) continue;
    refCols.push(ix);
    column(scene, S.src, bs.x(ix), bs.y, bs.hd, nz, ref.subarray(ix * nz, (ix + 1) * nz), { beam, speckle: false, quick: true });
  }
  cWidths = null;
}

/** The B-scan's speckle contrast now (NaN where there is too little tissue to measure it in). */
function contrastNow() {
  ensureRef();
  const r = speckleContrast(bs, ref, refCols, { noisePower: 2 * sigmaR() ** 2 });
  return r.n >= 400 ? r.C : NaN;
}

/** Repeat k (1, 2, ...) is complete: measure the contrast it leaves. */
function repeatDone(k) { chist[k - 1] = contrastNow(); }

/** What averaging the first k repeats should leave, as a fraction of one B-scan's contrast. */
function expectedFactor(k) {
  if (bs.how !== 'beam') return 1 / Math.sqrt(k);
  ensureRef();
  if (!cWidths) cWidths = regionWidths(bs, beam, refCols);
  return averagedContrast(bs.plan.slice(0, k), cWidths.length ? cWidths : [beam.w0]);
}

// --------------------------------------------------------------------- the en-face slab

const followBand = () => (LAYERS.some((l) => l.value === state.layer && (!l.scene || l.scene === state.scene)) ? state.layer : 0);
const layerName = () => LAYERS.find((l) => l.value === followBand()).label;
function ensureLayer() {
  ensureVolume();
  const key = `${followBand()}`;
  if (layerD && layerKey === key) return;
  layerD = vol.layerDepths(followBand()); layerKey = key;
}
/** The depth sample (fractional) at the middle of the en-face slab under A-scan (ix, iy). */
function slabRow(ix, iy) {
  if (!state.follow) return state.m;
  ensureLayer();
  return vol.followRow(layerD[iy * vol.nx + ix], state.below);
}
/** The first depth sample of the slab under (ix, iy), and how many it spans. */
function slabRange(ix, iy) {
  const n = slabSamples();
  const m0 = state.follow ? Math.round(slabRow(ix, iy) - (n - 1) / 2) : state.m - Math.floor(n / 2);
  const a = Math.max(0, m0), b = Math.min(vol.nz, m0 + n);
  return [a, Math.max(a + 1, b)];
}

/**
 * Flat plane or following a layer, keeping the slab's mean depth, so that the two can be compared:
 * the flat plane goes to the followed slab's mean depth, the followed slab to the depth below
 * its layer that puts its mean at the flat plane's.
 */
export function setFollow(f) {
  f = !!f;
  if (f !== state.follow && vol) {
    ensureLayer();
    const n = vol.nx * vol.ny;
    if (f) { let s = 0; for (let i = 0; i < n; i++) s += layerD[i]; state.below = Math.round(((state.m + 0.5) * vol.hd - s / n) / scene.nView); }
    else { let s = 0; for (let iy = 0; iy < vol.ny; iy++) for (let ix = 0; ix < vol.nx; ix++) s += slabRow(ix, iy); state.m = Math.max(0, Math.min(vol.nz - 1, Math.round(s / n))); }
  }
  state.follow = f;
  syncSlices(); dirty = true; S.onChange();
}

/** Which layers the slab's middle passes through: { counts: Map(name → A-scans), total }. */
let layerStats = null, layerStatsKey = '';
function slabLayers() {
  const key = `${state.follow}|${followBand()}|${state.below}|${state.m}|${state.scene}|${state.lesion}|${state.tilt}|${state.rough}|${S.src.lamNm}`;
  if (layerStats && layerStatsKey === key) return layerStats;
  const counts = new Map(), nb = scene.nb;
  for (let iy = 0; iy < vol.ny; iy++) for (let ix = 0; ix < vol.nx; ix++) {
    const x = vol.x(ix), y = vol.y(iy), prof = scene.profile(x, y), d = (slabRow(ix, iy) + 0.5) * vol.hd;
    let lo = 0, hi = scene.depth;
    for (let it = 0; it < 26; it++) { const z = 0.5 * (lo + hi); if (scene.zToD(prof, z) < d) lo = z; else hi = z; }
    const z = 0.5 * (lo + hi), b = scene.bandAt(prof, z);
    const name = scene.inLesion(x, y, z) ? (scene.lesion.gain === 0 ? 'the cyst' : 'the lump') : b < 0 ? 'above the sample' : b >= nb ? 'below the sample' : scene.bands[b].name;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const bands = new Set(scene.bands.map((b) => b.name));
  layerStats = { counts, total: vol.nx * vol.ny, layers: [...counts.keys()].filter((k) => bands.has(k)).length }; layerStatsKey = key;
  return layerStats;
}

// --------------------------------------------------------------------- the images

/** The B-scan's grey levels, column by column as they are measured. */
let bData = null;
/** The grey scale: white at `level`, black `range` dB below it, but never below the noise. */
const blackAt = () => Math.max(level - state.range, sigmaR() ? state.noise + 6 : -300);

function paintColumn(ix) {
  if (bImgStale) return;
  const nx = bs.nx, nz = bs.nz, lo = blackAt(), k = 255 / (level - lo), l10 = 20 / Math.LN10;
  if (!bData || bData.width !== nx || bData.height !== nz) { bImgStale = true; return; }
  const px = new Uint32Array(bData.data.buffer), A = bs.img;
  for (let m = 0; m < nz; m++) {
    const a = A[ix * nz + m], t = a > 0 ? (l10 * Math.log(a) - lo) * k : 0, g = t <= 0 ? 0 : t >= 255 ? 255 : t | 0;
    px[m * nx + ix] = (0xff000000 | (g << 16) | (g << 8) | g) >>> 0;
  }
  bImg.getContext('2d').putImageData(bData, 0, 0, ix, 0, 1, nz);
}
function repaintB() {
  const nx = bs.nx, nz = bs.nz;
  paintImage(bImg, nx, nz, (i, j) => (bs.done[i] || bs.img[i * nz + j] > 0 ? bs.img[i * nz + j] : null), blackAt(), level);
  bData = bImg.getContext('2d').getImageData(0, 0, nx, nz);
  bImgStale = false;
}

function paintSlices() {
  const { nx, ny, nz } = vol, lo = blackAt(), hi = level, D = vol.data;
  const row = (iy) => vol.done[iy] || vnext > iy * nx;
  paintImage(xzImg, nx, nz, (i, j) => (row(state.iy) && (vol.done[state.iy] || vnext > state.iy * nx + i) ? D[(state.iy * nx + i) * nz + j] : null), lo, hi);
  paintImage(yzImg, ny, nz, (i, j) => (vol.done[i] || vnext > i * nx + state.ix ? D[(i * nx + state.ix) * nz + j] : null), lo, hi);
  paintImage(xyImg, nx, ny, (i, j) => {
    if (!(vol.done[j] || vnext > j * nx + i)) return null;
    const [m0, m1] = slabRange(i, j);
    let s = 0;
    for (let m = m0; m < m1; m++) s += D[(j * nx + i) * nz + m];
    return s / (m1 - m0);
  }, lo, hi);
}
const slabSamples = () => Math.max(1, Math.round(state.slab / (vol ? vol.hd / scene.nView : 1)));

// --------------------------------------------------------------------- drawing

/** The depth shown (μm, tissue) of image row m on a grid of step hd (optical). */
const rowDepth = (m, hd) => ((m + 0.5) * hd) / scene.nView;

let sceneMap = null, bFrame = null;
function currentColumn() { return state.probe ?? (next > 0 ? (next - 1) % bs.nx : 0); }

function drawSceneView() {
  const ix = currentColumn();
  const h = sceneC.getBoundingClientRect().height;
  sceneMap = drawScene(sceneC, { scene, beam, x: bs.x(ix), layout: { ...SCENE_LAYOUT, top: Math.max(46, Math.round(0.2 * h)) }, pointer: pointer && pointer.where === 'scene' ? pointer : null });
  // The depth axis.
  const ctx = sceneC.getContext('2d');
  ctx.fillStyle = 'rgba(225,226,230,0.7)'; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let z = 0; z <= scene.depth; z += scene.depth > 400 ? 200 : 100) ctx.fillText(`${z}`, sceneMap.left - 5, sceneMap.Z(z));
  ctx.save(); ctx.translate(12, sceneMap.top + sceneMap.h / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('depth z (μm)', 0, 0); ctx.restore();
}

function drawBscan() {
  const { ctx, width, height } = fitCanvas(bscanC);
  ctx.fillStyle = '#0d0f14'; ctx.fillRect(0, 0, width, height);
  if (bImgStale) repaintB();
  const L = BSCAN_LAYOUT, w = width - L.left - L.right, h = height - L.top - L.bottom;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bImg, L.left, L.top, w, h);
  const X = (x) => L.left + ((x + scene.halfWidth) / (2 * scene.halfWidth)) * w, Zd = (z) => L.top + (z / scene.depth) * h;
  bFrame = { X, Zd, left: L.left, top: L.top, w, h, invX: (px) => -scene.halfWidth + ((px - L.left) / w) * 2 * scene.halfWidth, invZ: (py) => ((py - L.top) / h) * scene.depth };
  // The column the beam is at.
  const ix = currentColumn(), bx = X(bs.x(ix));
  ctx.strokeStyle = 'rgba(255,90,60,0.85)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx + 0.5, L.top); ctx.lineTo(bx + 0.5, L.top + h); ctx.stroke();
  // Averaging: which repeat is being measured, in the corner.
  if (bs.N > 1) {
    const k = Math.min(bs.N, Math.floor(next / bs.nx) + (next % bs.nx ? 1 : 0));
    ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const t = next >= bs.tasks ? `the average of ${bs.N} B-scans` : `B-scan ${Math.max(1, k)} of ${bs.N}, averaged with those before it`;
    ctx.fillStyle = 'rgba(13,15,20,0.7)'; ctx.fillRect(L.left + 4, L.top + 4, ctx.measureText(t).width + 10, 17);
    ctx.fillStyle = 'rgba(255,224,138,0.95)'; ctx.fillText(t, L.left + 9, L.top + 7);
  }
  // Axes: x in mm along the bottom, depth on the left.
  ctx.fillStyle = 'rgba(225,226,230,0.75)'; ctx.font = '10px system-ui, sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
  const step = scene.halfWidth >= 1000 ? 500 : 100;
  for (let x = -Math.floor(scene.halfWidth / step) * step; x <= scene.halfWidth; x += step) {
    ctx.fillRect(X(x), L.top + h, 1, 4);
    ctx.fillText(step >= 500 ? `${(x / 1000).toFixed(1)}` : `${x}`, X(x), L.top + h + 5);
  }
  ctx.textAlign = 'right';
  ctx.fillText(step >= 500 ? 'x (mm)' : 'x (μm)', L.left + w, L.top + h + 15);
  ctx.textBaseline = 'middle';
  for (let z = 0; z <= scene.depth; z += scene.depth > 400 ? 200 : 100) ctx.fillText(`${z}`, L.left - 5, Zd(z));
  ctx.save(); ctx.translate(12, L.top + h / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center';
  ctx.fillText(scene.nView > 1 ? `depth = optical depth ÷ ${scene.nView} (μm)` : 'depth = optical depth (μm)', 0, 0); ctx.restore();
  if (pointer && pointer.where === 'bscan') drawLoupe(ctx, X(pointer.x), Zd(pointer.z), w, h);
}

/** A magnifier at the pointer: the B-scan's own pixels, four times larger than drawn. */
function drawLoupe(ctx, px, py, w, h) {
  const L = BSCAN_LAYOUT, size = Math.min(150, Math.floor(h * 0.6)), mag = 4;
  const sx = (w / bs.nx) * mag, sy = (h / bs.nz) * mag, cols = size / sx, rows = size / sy;
  const ix = ((px - L.left) / w) * bs.nx, m = ((py - L.top) / h) * bs.nz;
  const dx = px < L.left + w / 2 ? px + 24 : px - 24 - size, dy = Math.max(L.top + 2, Math.min(L.top + h - size - 2, py - size / 2));
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#000'; ctx.fillRect(dx, dy, size, size);
  ctx.drawImage(bImg, ix - cols / 2, m - rows / 2, cols, rows, dx, dy, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5; ctx.strokeRect(dx - 0.5, dy - 0.5, size + 1, size + 1);
  ctx.lineWidth = 1; ctx.strokeRect(px - (size / mag) / 2, py - (size / mag) / 2, size / mag, size / mag);
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const across = cols * bs.pitch, deep = (rows * bs.hd) / scene.nView;
  ctx.fillText(`×${mag}: ${across.toFixed(0)} × ${deep.toFixed(0)} μm`, dx + 4, dy + 3);
  ctx.restore();
}

function drawColumn(c) {
  const { ctx, width, height } = fitCanvas(ascanC);
  ctx.clearRect(0, 0, width, height);
  const L = BSCAN_LAYOUT, top = L.top, h = height - L.top - L.bottom, left = 6, w = width - 12;
  const ix = currentColumn(), measured = bs.done[ix], A = bs.img.subarray(ix * bs.nz, (ix + 1) * bs.nz);
  const lo = blackAt() - 6, hi = level + 4, X = (db) => left + ((db - lo) / (hi - lo)) * w;
  ctx.fillStyle = c.panel; ctx.fillRect(left, top, w, h);
  ctx.strokeStyle = c.line; ctx.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);
  if (measured) {
    ctx.strokeStyle = c.env; ctx.lineWidth = 1.2; ctx.beginPath();
    for (let m = 0; m < bs.nz; m++) {
      const db = A[m] > 0 ? Math.max(lo, 20 * Math.log10(A[m])) : lo, y = top + ((m + 0.5) / bs.nz) * h;
      if (m) ctx.lineTo(X(db), y); else ctx.moveTo(X(db), y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = c.ink2; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(measured ? 'dB →' : 'not yet', left + w / 2, top + h + 5);
  for (const db of [Math.ceil((lo + 6) / 20) * 20]) { ctx.fillText(`${db}`, X(db), top + h + 15); ctx.fillRect(X(db), top + h, 1, 3); }
}

/** The speckle contrast against the number of B-scans averaged: measured dots on the expected curve. */
function drawContrastPlot(c) {
  const { ctx, width, height } = fitCanvas(cplotC);
  ctx.clearRect(0, 0, width, height);
  const L = { left: 30, right: 10, top: 18, bottom: 28 }, w = width - L.left - L.right, h = height - L.top - L.bottom;
  const N = bs.N, C1 = chist[0], cmax = Math.max(1.5, Number.isFinite(C1) ? 1.12 * C1 : 0);
  const X = (k) => L.left + (Math.log2(k) / Math.log2(N)) * w, Y = (C) => L.top + h - (C / cmax) * h;
  ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.strokeRect(L.left + 0.5, L.top + 0.5, w, h);
  ctx.fillStyle = c.ink2; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const v of [0, 0.5, 1, 1.5]) if (v <= cmax) { ctx.fillText(v.toFixed(1), L.left - 4, Y(v)); ctx.fillStyle = c.line; ctx.fillRect(L.left, Y(v), w, 1); ctx.fillStyle = c.ink2; }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let k = 1; k <= N; k *= 2) ctx.fillText(`${k}`, X(k), L.top + h + 3);
  ctx.fillText('B-scans averaged, N', L.left + w / 2, L.top + h + 14);
  ctx.textAlign = 'left'; ctx.fillStyle = c.ink; ctx.fillText('Speckle contrast against N', 4, 3); ctx.fillStyle = c.ink2; ctx.textAlign = 'center';
  if (!Number.isFinite(C1)) {
    ctx.fillStyle = c.ink3; ctx.textBaseline = 'middle';
    ctx.fillText(chist.length ? 'no tissue here to measure it in' : 'measured as each B-scan is done', L.left + w / 2, L.top + h / 2);
    return;
  }
  // What the repeats should leave: C₁ √(Σρ)/k (C₁/√k when they are independent).
  ctx.strokeStyle = c.ink3; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]); ctx.beginPath();
  if (bs.how === 'beam') for (let k = 1; k <= N; k++) { const p = [X(k), Y(C1 * expectedFactor(k))]; if (k === 1) ctx.moveTo(...p); else ctx.lineTo(...p); }
  else for (let i = 0; i <= 60; i++) { const k = N ** (i / 60), p = [X(k), Y(C1 / Math.sqrt(k))]; if (i) ctx.lineTo(...p); else ctx.moveTo(...p); }
  ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = c.env;
  chist.forEach((C, i) => { if (Number.isFinite(C)) { ctx.beginPath(); ctx.arc(X(i + 1), Y(C), 3.2, 0, 2 * Math.PI); ctx.fill(); } });
  ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.font = '10.5px system-ui, sans-serif';
  ctx.fillStyle = c.env; ctx.fillText('● measured', L.left + w - 4, L.top + 3);
  ctx.fillStyle = c.ink3; ctx.fillText(bs.how === 'beam' ? '- - expected, beams δ apart' : '- - C₁/√N', L.left + w - 4, L.top + 16);
}

function drawLegend() {
  const box = $('#s-legend');
  const key = `${state.scene}|${state.lesion}`;
  if (box._key === key) return;
  box._key = key;
  box.replaceChildren(...scene.bands.map((b) => {
    const row = document.createElement('div');
    row.className = 'legend-row';
    const sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = b.colour;
    row.append(sw, b.name);
    return row;
  }));
  if (scene.lesion && state.lesion) { const row = document.createElement('div'); row.className = 'legend-row'; const sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = '#0c121e'; sw.style.outline = '1px solid #999'; row.append(sw, scene.lesion.gain === 0 ? 'a cyst (fluid)' : 'a bright lump'); box.append(row); }
  if (scene.beads) { const row = document.createElement('div'); row.className = 'legend-row'; const sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = '#fff'; row.append(sw, 'beads'); box.append(row); }
}

function drawSlice(canvas, img, o) {
  const { ctx, width, height } = fitCanvas(canvas);
  ctx.fillStyle = '#0d0f14'; ctx.fillRect(0, 0, width, height);
  const L = { left: 40, right: 8, top: 6, bottom: 22 }, w = width - L.left - L.right, h = height - L.top - L.bottom;
  // Keep the picture's shape for the en-face slice (x and y both in μm).
  let iw = w, ih = h;
  if (o.square) { iw = ih = Math.min(w, h); }
  const ox = L.left + (w - iw) / 2, oy = L.top;
  ctx.imageSmoothingEnabled = true;
  if (img.width) ctx.drawImage(img, ox, oy, iw, ih);
  ctx.strokeStyle = o.colour; ctx.lineWidth = 2; ctx.strokeRect(ox - 1, oy - 1, iw + 2, ih + 2);
  // The other two slices, as lines in their colours (the en-face slab, when it follows a layer,
  // as the curve it follows).
  for (const ln of o.lines) {
    ctx.strokeStyle = ln.colour; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.beginPath();
    if (ln.curve) ln.curve.forEach((v, i) => { const x = ox + ((i + 0.5) / ln.curve.length) * iw, y = oy + v * ih; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    else if (ln.u !== undefined) { const x = ox + ln.u * iw; ctx.moveTo(x, oy); ctx.lineTo(x, oy + ih); }
    else { const y = oy + ln.v * ih; ctx.moveTo(ox, y); ctx.lineTo(ox + iw, y); }
    ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.fillStyle = 'rgba(225,226,230,0.75)'; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(o.xlabel, ox + iw / 2, oy + ih + 6);
  ctx.save(); ctx.translate(14, oy + ih / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(o.ylabel, 0, 0); ctx.restore();
  return { ox, oy, iw, ih };
}

let sliceMaps = {};
function drawVolume() {
  ensureVolume();
  paintSlices();
  const { nx, ny, nz } = vol, u = (i, n) => (i + 0.5) / n;
  const hwmm = (scene.halfWidth / 1000).toFixed(1), dshow = scene.depth;
  const frac = (ix, iy) => (slabRow(ix, iy) + 0.5) / nz;
  const xyLine = (along) => (state.follow
    ? { curve: Array.from({ length: along === 'x' ? nx : ny }, (_, i) => (along === 'x' ? frac(i, state.iy) : frac(state.ix, i))), colour: SLICE.xy }
    : { v: u(state.m, nz), colour: SLICE.xy });
  sliceMaps.xy = drawSlice(xyC, xyImg, { colour: SLICE.xy, square: true, xlabel: `x (−${hwmm} to ${hwmm} mm)`, ylabel: 'y ↓',
    lines: [{ u: u(state.ix, nx), colour: SLICE.yz }, { v: u(state.iy, ny), colour: SLICE.xz }] });
  sliceMaps.xz = drawSlice(xzC, xzImg, { colour: SLICE.xz, xlabel: `x (−${hwmm} to ${hwmm} mm)`, ylabel: `depth (0 to ${dshow} μm)`,
    lines: [{ u: u(state.ix, nx), colour: SLICE.yz }, xyLine('x')] });
  sliceMaps.yz = drawSlice(yzC, yzImg, { colour: SLICE.yz, xlabel: `y (−${hwmm} to ${hwmm} mm)`, ylabel: `depth (0 to ${dshow} μm)`,
    lines: [{ u: u(state.iy, ny), colour: SLICE.xz }, xyLine('y')] });
  let surface = null;
  if (state.follow) { surface = new Float32Array(nx * ny); for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) surface[iy * nx + ix] = frac(ix, iy); }
  drawCube(cubeC, { nx, ny, nz, ix: state.ix, iy: state.iy, m: state.m, xz: xzImg, yz: yzImg, xy: xyImg, done: vol.done, surface });
}

function readout() {
  const src = S.src, n = scene.nView;
  if (state.mode === 'bscan') {
    const ix = currentColumn();
    if (bs.N > 1) {
      const k = Math.min(bs.N, Math.floor(Math.max(0, next - 1) / bs.nx) + 1), inRep = next >= bs.tasks ? bs.nx : next - (k - 1) * bs.nx;
      setGroups($('#s-readout-1'), [['B-scan ', { v: next ? k : 0, dec: 0, w: 2 }, ` of ${bs.N}:`], ['columns measured ', { v: inRep, dec: 0, w: 3 }, ` of ${bs.nx},`], ['one every ', { v: bs.pitch, dec: 1, w: 4 }, ' μm;'],
        ['the beam at x = ', { v: bs.x(ix) / 1000, dec: 3, w: 6 }, ' mm']]);
    } else {
      setGroups($('#s-readout-1'), [['Columns measured: ', { v: bs.count, dec: 0, w: 3 }, ` of ${bs.nx},`], ['one every ', { v: bs.pitch, dec: 1, w: 4 }, ' μm;'],
        ['the beam at x = ', { v: bs.x(ix) / 1000, dec: 3, w: 6 }, ' mm']]);
    }
    contrastReadout();
  } else {
    ensureVolume();
    setGroups($('#s-readout-1'), [['B-scans measured: ', { v: vol.count, dec: 0, w: 2 }, ` of ${vol.ny}`], `(${vol.nx} A-scans each, of ${vol.nz} depths: ${(vol.nx * vol.ny * vol.nz).toLocaleString('en')} voxels);`,
      ['slices at x = ', { v: vol.x(state.ix) / 1000, dec: 2, w: 5 }, ' mm,'], ['y = ', { v: vol.y(state.iy) / 1000, dec: 2, w: 5 }, ' mm,'],
      state.follow ? ['en face ', { v: state.below, dec: 0, w: 4 }, ` μm below ${layerName()}`] : ['depth ', { v: rowDepth(state.m, vol.hd), dec: 0, w: 4 }, ' μm']]);
    slabReadout();
  }
  setGroups($('#s-readout-2'), [['Across: the beam\'s waist w₀ = λ₀/(π NA) = ', { v: beam.w0, dec: 1, w: 4 }, ' μm,'],
    ['in focus over 2z_R = ', { v: 2 * beam.zR, dec: 0, w: 4 }, ' μm.'],
    ['In depth: ℓ_c/n = ', { v: src.lc / n, dec: 1, w: 4 }, ' μm,'], ['whatever the NA.']]);
  const p = pointer;
  if (p) {
    const prof = scene.profile(p.x, 0), b = scene.bandAt(prof, p.z), name = b < 0 ? (scene.n0 > 1.2 ? 'the fluid above the sample' : 'the air above the sample') : b >= scene.nb ? 'below the sample' : scene.bands[b].name;
    const inL = scene.inLesion(p.x, 0, p.z);
    setGroups($('#s-readout-3'), [[`At x = `, { v: p.x / 1000, dec: 2, w: 5 }, ' mm,'], ['depth ', { v: p.z, dec: 0, w: 4 }, ' μm:'], inL ? (scene.lesion.gain === 0 ? 'inside the cyst' : 'inside the lump') : name]);
  } else setGroups($('#s-readout-3'), [state.mode === 'bscan' ? 'Point at either picture to name what is there.' : 'Click a slice to move the other two through that point.']);
}

/** The speckle contrast, measured after each complete B-scan (and each repeat when averaging). */
function contrastReadout() {
  const e = $('#s-readout-4'), C1 = chist[0], k = chist.length, Ck = chist[k - 1];
  if (!k) { setGroups(e, ['Speckle contrast: measured when the B-scan is complete.']); return; }
  if (!Number.isFinite(C1)) { setGroups(e, [scene.beads ? 'Speckle contrast: none to measure, the gel is clear and each bead a single point.' : 'Speckle contrast: measured in uniform bands of scatterers (the retina, the paint under the glass plate).']); return; }
  if (bs.N === 1) { setGroups(e, ['Speckle contrast (σ/mean of the brightness in the tissue, against the smooth picture):', ['', { v: C1, dec: 2, w: 4 }], '(fully developed speckle: 1).']); return; }
  const f = expectedFactor(k);
  setGroups(e, [['Speckle contrast: one B-scan ', { v: C1, dec: 2, w: 4 }, ';'], ['the average of ', { v: k, dec: 0, w: 2 }, ': ', { v: Ck, dec: 2, w: 4 }, ';'],
    bs.how === 'beam' ? ['expected ', { v: C1 * f, dec: 2, w: 4 }, ' (beams δ apart share e^(−2δ²/w²) of their grain)'] : ['C₁/√', { v: k, dec: 0, w: 2 }, ' = ', { v: C1 * f, dec: 2, w: 4 }]]);
}

/** Which layers the en-face slab passes through. */
function slabReadout() {
  const e = $('#s-readout-4'), st = slabLayers(), list = [...st.counts.entries()].sort((a, b) => b[1] - a[1]);
  const [name, cnt] = list[0], pct = (100 * cnt) / st.total;
  const what = state.follow ? `following ${layerName()}` : 'a flat plane';
  setGroups(e, [`The en-face slab (${what}) lies in`, ['', { v: st.layers, dec: 0, w: 2 }, st.layers === 1 ? ' layer' : ' layers', list.length > st.layers ? ' (and more):' : ':'],
    [`${name}, under `, { v: pct, dec: 0, w: 3 }, '% of the A-scans', list.length > 1 ? ';' : '.'], ...(list.length > 1 ? [`${list[1][0]}, ${Math.round((100 * list[1][1]) / st.total)}%.`] : [])]);
}

export function draw(force = false) {
  if (!dirty && !force) return;
  dirty = false;
  const c = octColors();
  const plot = state.mode === 'bscan' && bs.N > 1;
  $('#s-foot').classList.toggle('with-plot', plot);
  if (state.mode === 'bscan') { drawSceneView(); drawBscan(); drawColumn(c); drawLegend(); if (plot) drawContrastPlot(c); } else drawVolume();
  readout();
}
export function invalidate() { dirty = true; bImgStale = true; }

// --------------------------------------------------------------------- pointer

function at(cv, e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

for (const [cv, where] of [[sceneC, 'scene'], [bscanC, 'bscan']]) {
  let down = false;
  const locate = (e) => {
    const [px, py] = at(cv, e), m = where === 'scene' ? sceneMap : bFrame;
    if (!m) return null;
    const x = m.invX(px), z = m.invZ(py);
    if (x < -scene.halfWidth || x > scene.halfWidth || z < 0 || z > scene.depth) return null;
    return { x, z, where };
  };
  cv.addEventListener('pointermove', (e) => {
    pointer = locate(e);
    if (down && pointer) pick(pointer.x);
    dirty = true;
  });
  cv.addEventListener('pointerleave', () => { pointer = null; dirty = true; });
  cv.addEventListener('pointerdown', (e) => { const p = locate(e); if (!p) return; cv.setPointerCapture(e.pointerId); down = true; pick(p.x); e.preventDefault(); });
  cv.addEventListener('pointerup', () => { down = false; });
  cv.addEventListener('pointercancel', () => { down = false; });
}

/** Point the beam at x: pause the scan and show that column's A-scan (measured now if it was
 *  not, every repeat of it when averaging). */
function pick(x) {
  const ix = Math.max(0, Math.min(bs.nx - 1, Math.floor((x + scene.halfWidth) / bs.pitch)));
  if (state.playing) { state.playing = false; updatePlay(); }
  if (!bs.done[ix]) { for (let k = 0; k < bs.N; k++) bs.measure(ix, opts(), k); paintColumn(ix); }
  state.probe = ix;
  dirty = true;
}

for (const [cv, which] of [[xyC, 'xy'], [xzC, 'xz'], [yzC, 'yz']]) {
  let down = false;
  const set = (e) => {
    const m = sliceMaps[which];
    if (!m || !vol) return;
    const [px, py] = at(cv, e), u = Math.max(0, Math.min(0.9999, (px - m.ox) / m.iw)), v = Math.max(0, Math.min(0.9999, (py - m.oy) / m.ih));
    // A depth picked on a cross-section: the flat plane's row, or the slab's depth below its layer.
    const pickDepth = (ix, iy) => {
      const row = Math.floor(v * vol.nz);
      if (!state.follow) { state.m = row; return; }
      ensureLayer();
      state.below = Math.round(((row + 0.5) * vol.hd - layerD[iy * vol.nx + ix]) / scene.nView);
    };
    if (which === 'xy') { state.ix = Math.floor(u * vol.nx); state.iy = Math.floor(v * vol.ny); }
    else if (which === 'xz') { state.ix = Math.floor(u * vol.nx); pickDepth(state.ix, state.iy); }
    else { state.iy = Math.floor(u * vol.ny); pickDepth(state.ix, state.iy); }
    syncSlices(); dirty = true; S.onChange();
  };
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); down = true; set(e); e.preventDefault(); });
  cv.addEventListener('pointermove', (e) => { if (down) set(e); });
  cv.addEventListener('pointerup', () => { down = false; });
  cv.addEventListener('pointercancel', () => { down = false; });
}

// --------------------------------------------------------------------- controls

let modeSeg, sceneSeg, speckleT, lesionT, tiltS, roughS, naS, focusS, noiseS, rangeS, rateS, xS, yS, mS, slabS;
let avgSeg, howSeg, stepS, followSeg, layerSeg, belowS;
function updatePlay() {
  const b = $('#s-play');
  if (!b) return;
  const done = state.mode === 'bscan' ? next >= (bs?.tasks ?? 1) : vol && vnext >= vol.nx * vol.ny;
  b.textContent = state.playing ? 'Pause' : done ? 'Scan again' : 'Go on';
}

export function setMode(m) {
  state.mode = m === 'volume' ? 'volume' : 'bscan';
  modeSeg.value = state.mode;
  $('#v-scan').dataset.mode = state.mode; $('#main').dataset.smode = state.mode;
  if (state.mode === 'volume') { ensureVolume(); if (vnext < vol.nx * vol.ny) state.playing = true; }
  else if (next < bs.tasks) state.playing = true;
  updatePlay();
  dirty = true; bImgStale = true;
  S.onChange();
}

function rebuildScene() { makeAll(); syncSlices(); drawLegend(); S.onChange(); }
function rescan() { if (state.mode === 'volume') { ensureVolume(); resetVolume(); vfast = true; state.playing = true; } else restart(next >= bs.tasks); updatePlay(); S.onChange(); }

/** A new number of repeats, or a new way for them to differ: the B-scan starts again. */
export function setAverage(N = state.avg, how = state.how, step = state.step) {
  state.avg = AVERAGES.includes(N) ? N : 1; state.how = how === 'beam' ? 'beam' : 'tissue'; state.step = step;
  // Sixteen B-scans at 128 A-scans a second would take a minute: averaging goes at least eight times faster.
  if (state.avg > 1 && state.rate < 1024) state.rate = 1024;
  bs.setAverage(state.avg, state.how, state.step);
  state.probe = null;
  syncAverage();
  restart();
  S.onChange();
}

function syncAverage() {
  avgSeg.value = state.avg; howSeg.value = state.how; stepS.value = state.step; stepS.hidden = state.how !== 'beam';
  rateS.value = state.rate;
  $('#v-scan').toggleAttribute('data-avg', state.avg > 1);
  if (state.how === 'beam' || state.step !== 9) $('#s-avg-more').open = true;
}

function syncSlices() {
  if (!xS) return;
  const hw = scene.halfWidth, p = (2 * hw) / VOL.nx;
  xS.setRange(-hw / 1000, hw / 1000); yS.setRange(-hw / 1000, hw / 1000); mS.setRange(0, scene.depth);
  xS.value = +((-hw + (state.ix + 0.5) * p) / 1000).toFixed(3);
  yS.value = +((-hw + (state.iy + 0.5) * ((2 * hw) / VOL.ny)) / 1000).toFixed(3);
  mS.value = Math.round(((state.m + 0.5) / VOL.nz) * scene.depth);
  belowS.value = state.below;
  followSeg.value = state.follow; layerSeg.value = followBand();
  [...layerSeg.children].forEach((b, i) => { b.hidden = !!LAYERS[i].scene && LAYERS[i].scene !== state.scene; });
  mS.hidden = state.follow; belowS.hidden = layerSeg.hidden = !state.follow;
  $('#s-xy-note').textContent = state.follow ? `a slab following ${layerName()}, seen from above` : 'the plane at one depth, seen from above';
}

export function init(shared) {
  S = shared;
  modeSeg = segmented([{ value: 'bscan', label: 'Cross-section (B-scan)', title: 'Step the beam along x: one A-scan per column' },
    { value: 'volume', label: 'Volume (3D)', title: 'Step along y too: a stack of B-scans' }], state.mode, (m) => setMode(m), { label: 'What to build' });
  $('#s-mode-box').append(modeSeg);
  sceneSeg = segmented(Object.entries(SCENES).map(([k, s]) => ({ value: k, label: s.label, title: s.title })), state.scene, (v) => setScene(v), { label: 'Sample' });
  sceneSeg.classList.add('button-grid');
  $('#s-scene-box').append(sceneSeg);
  speckleT = toggle('Speckle', state.speckle, (on) => { state.speckle = on; autoLevel(); bImgStale = true; rescan(); }, 'Add the scatterers\' light coherently (on, as it really is) or their average power (off)');
  lesionT = toggle('Cyst / lump', state.lesion, (on) => { state.lesion = on; rebuildScene(); }, 'Put the lesion in the sample, or take it out');
  $('#s-toggles').append(speckleT, lesionT);
  $('#s-reseed').addEventListener('click', () => { state.seed++; rebuildScene(); });
  tiltS = slider({ label: 'tilt (°)', min: -15, max: 15, step: 0.1, value: state.tilt, title: 'Tilt the sample about the y axis', onInput: (v) => { state.tilt = v; rebuildScene(); } });
  roughS = slider({ label: 'roughness (μm)', min: 0, max: 30, step: 0.5, value: state.rough, title: 'How far the top surface wanders up and down', onInput: (v) => { state.rough = v; rebuildScene(); } });
  $('#s-shape-box').append(tiltS, roughS);
  naS = slider({ label: 'aperture NA', min: 0.01, max: 0.2, log: true, value: state.NA, title: 'The numerical aperture: the sine of the half-angle of the cone of light the lens focuses',
    onInput: (v) => { state.NA = v; beam = sceneBeam(scene, S.src, state.NA, state.focus); rescan(); } });
  focusS = slider({ label: 'focus depth (μm)', min: 0, max: 700, step: 1, value: state.focus, title: 'How deep in the sample the beam is focused',
    onInput: (v) => { state.focus = v; beam = sceneBeam(scene, S.src, state.NA, state.focus); rescan(); } });
  $('#s-beam-box').append(naS, focusS);
  noiseS = slider({ label: 'noise floor (dB)', min: -120, max: -20, step: 0.5, value: state.noise, title: 'The detector\'s noise, as the reflection it equals (−120: none)',
    onInput: (v) => { state.noise = v; bImgStale = true; rescan(); } });
  rangeS = slider({ label: 'grey range (dB)', min: 10, max: 70, step: 1, value: state.range, title: 'How many decibels below white the image turns black',
    onInput: (v) => { state.range = v; bImgStale = true; dirty = true; S.onChange(); } });
  rateS = slider({ label: 'speed (A-scans/s)', min: 4, max: 2000, log: true, value: state.rate, title: 'How fast the beam steps across (in a B-scan)',
    onInput: (v) => { state.rate = v; state.vrate = Math.max(1, v / 8); S.onChange(); } });
  $('#s-image-box').append(rateS, noiseS, rangeS);
  // Averaging.
  avgSeg = segmented(AVERAGES.map((N) => ({ value: N, label: `${N}`, title: N === 1 ? 'One B-scan, no averaging' : `Measure the line ${N} times and average the brightness` })), state.avg,
    (N) => setAverage(N), { label: 'B-scans to average' });
  $('#s-avg-box').append(avgSeg);
  howSeg = segmented([{ value: 'tissue', label: 'The tissue', title: 'The tissue moves a little between repeats (as a living eye\'s does): a new speckle pattern each time' },
    { value: 'beam', label: 'The beam, along y', title: 'The tissue still; the beam steps sideways (along y, out of the B-scan\'s plane) between repeats' }], state.how,
  (how) => setAverage(state.avg, how), { label: 'What moves between repeats' });
  stepS = slider({ label: 'beam step (μm)', min: 0, max: 30, step: 0.5, value: state.step, title: 'How far the beam moves along y between repeats (0: nothing moves)',
    onInput: (v) => setAverage(state.avg, state.how, v) });
  $('#s-how-box').append(howSeg, stepS);
  // The slices.
  xS = slider({ label: 'cross-section at x (mm)', min: -1.5, max: 1.5, step: 0.001, value: 0, title: 'Where the cross-section across y is (cyan)', onInput: (v) => { state.ix = Math.max(0, Math.min(VOL.nx - 1, Math.floor(((v * 1000 + scene.halfWidth) / (2 * scene.halfWidth)) * VOL.nx))); dirty = true; S.onChange(); } });
  yS = slider({ label: 'B-scan at y (mm)', min: -1.5, max: 1.5, step: 0.001, value: 0, title: 'Where the B-scan is (magenta)', onInput: (v) => { state.iy = Math.max(0, Math.min(VOL.ny - 1, Math.floor(((v * 1000 + scene.halfWidth) / (2 * scene.halfWidth)) * VOL.ny))); dirty = true; S.onChange(); } });
  followSeg = segmented([{ value: false, label: 'Flat plane', title: 'The en-face slab at one depth everywhere' },
    { value: true, label: 'Follow a layer', title: 'The en-face slab a set depth below a layer in every A-scan, following its curve' }], state.follow,
  (f) => setFollow(f), { label: 'En-face slab' });
  layerSeg = segmented(LAYERS.map((l) => ({ value: l.value, label: l.label, title: l.title })), state.layer,
    (v) => { state.layer = v; syncSlices(); dirty = true; S.onChange(); }, { label: 'The layer it follows' });
  mS = slider({ label: 'en face at (μm)', min: 0, max: 650, step: 1, value: 300, title: 'The depth of the en-face plane (yellow)', onInput: (v) => { state.m = Math.max(0, Math.min(VOL.nz - 1, Math.floor((v / scene.depth) * VOL.nz))); dirty = true; S.onChange(); } });
  belowS = slider({ label: 'below the layer (μm)', min: -300, max: 450, step: 1, value: state.below, title: 'How far below the layer the en-face slab is (negative: above it)', onInput: (v) => { state.below = v; dirty = true; S.onChange(); } });
  slabS = slider({ label: 'en face over (μm)', min: 1, max: 60, step: 1, value: state.slab, title: 'Average the en-face plane over this much depth (a slab), to calm the speckle', onInput: (v) => { state.slab = v; dirty = true; S.onChange(); } });
  $('#s-slice-box').append(xS, yS);
  $('#s-follow-box').append(followSeg, layerSeg, mS, belowS, slabS);
  $('#s-play').addEventListener('click', () => {
    const done = state.mode === 'bscan' ? next >= bs.tasks : vol && vnext >= vol.nx * vol.ny;
    if (state.playing) state.playing = false;
    else if (done) { if (state.mode === 'bscan') restart(); else { resetVolume(); state.playing = true; } }
    else { state.playing = true; state.probe = null; if (state.mode === 'bscan') progress = next; else vprogress = vnext; }
    updatePlay(); dirty = true;
  });
  $('#s-step').addEventListener('click', () => { state.probe = null; stepScan(); });
  $('#s-finish').addEventListener('click', () => { state.probe = null; finishScan(); });
  makeAll();
  syncSlices();
  syncAverage();
}

export function setScene(v) {
  state.scene = SCENES[v] ? v : 'retina';
  sceneSeg.value = state.scene;
  const p = SCENES[state.scene];
  state.NA = p.NA; state.focus = p.focus; state.tilt = 0; state.rough = 0; state.probe = null;
  sync();
  rebuildScene();
}

export function sync() {
  modeSeg.value = state.mode; sceneSeg.value = state.scene; speckleT.on = state.speckle; lesionT.on = state.lesion;
  lesionT.hidden = !SCENES[state.scene].lesion;
  tiltS.value = state.tilt; roughS.value = state.rough; naS.value = state.NA; focusS.value = state.focus; focusS.setRange(0, SCENES[state.scene].depth);
  noiseS.value = state.noise; rangeS.value = state.range; rateS.value = state.rate; slabS.value = state.slab;
  $('#v-scan').dataset.mode = state.mode; $('#main').dataset.smode = state.mode;
  if (state.tilt || state.rough) $('#s-more').open = true;
  syncAverage();
  dirty = true; bImgStale = true;
}

export function configure(o = {}) {
  const p = SCENES[o.scene] || SCENES.retina;
  Object.assign(state, { mode: 'bscan', scene: 'retina', speckle: true, lesion: true, tilt: 0, rough: 0, seed: 1, NA: p.NA, focus: p.focus, noise: -72, range: 38,
    playing: true, rate: 128, vrate: 8, probe: null, ix: 32, iy: 32, m: 120, slab: 12, avg: 1, how: 'tissue', step: 9, follow: false, layer: 7, below: 11 }, o);
  if (!AVERAGES.includes(state.avg)) state.avg = 1;
  sync();
  makeAll();
  if (o.done) finishNow();
  if (state.mode === 'volume') { ensureVolume(); if (o.vdone) finishNow(); }
  syncSlices();
  updatePlay();
}

export function toHash() {
  const s = state, vm = s.mode === 'volume';
  return { mode: vm ? 'volume' : undefined, scene: s.scene, speckle: s.speckle ? undefined : 0, lesion: s.lesion ? undefined : 0, tilt: s.tilt || undefined,
    rough: s.rough || undefined, seed: s.seed > 1 ? s.seed : undefined, NA: s.NA, focus: s.focus, noise: s.noise, range: s.range, rate: s.rate,
    avg: s.avg > 1 ? s.avg : undefined, how: s.avg > 1 && s.how === 'beam' ? 'beam' : undefined, step: s.avg > 1 && s.how === 'beam' ? s.step : undefined,
    ix: vm ? s.ix : undefined, iy: vm ? s.iy : undefined, m: vm && !s.follow ? s.m : undefined,
    follow: vm && s.follow ? 1 : undefined, layer: vm && s.follow ? followBand() : undefined, below: vm && s.follow ? s.below : undefined };
}
export function fromHash(h, num) {
  configure({ mode: h.mode === 'volume' ? 'volume' : 'bscan', scene: SCENES[h.scene] ? h.scene : 'retina', speckle: h.speckle !== '0', lesion: h.lesion !== '0',
    tilt: num('tilt', 0), rough: num('rough', 0), seed: num('seed', 1), NA: num('NA', (SCENES[h.scene] || SCENES.retina).NA), focus: num('focus', (SCENES[h.scene] || SCENES.retina).focus),
    noise: num('noise', -72), range: num('range', 38), rate: num('rate', 128), ix: num('ix', 32), iy: num('iy', 32), m: num('m', 120),
    avg: num('avg', 1), how: h.how === 'beam' ? 'beam' : 'tissue', step: num('step', 9), follow: h.follow === '1', layer: num('layer', 7), below: num('below', 11) });
}

/** For the tests. */
export const peek = () => ({ scene, beam, bs, vol, level, next, vnext, chist: chist.slice(), ref, refCols, layerD, slabLayers: () => (vol ? slabLayers() : null), expectedFactor });
