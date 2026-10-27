// The Michelson interferometer on the page: its schematic (drag the mirror), the screen in true
// colour, the spectrum (draw on it) and the interferogram (the detector's trace, or the
// samples of a Fourier-transform spectrometer, which can be drawn too).
//
// Lengths in micrometres.  The mirror M2 sits a distance d = dc + df from equal paths (a coarse
// and a fine part, like a micrometer and its fine screw); the path difference is Δ = 2d.

import { el, $, slider, segmented, toggle, fmt } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors, niceTicks, tickLabel } from '../lib/plot.js';
import { SOURCES, GRID, GRID_HI, BROAD_W, Spectrum, normalCdf } from './spectrum.js';
import { ColourModel, renderScreen, minMaxOver, FringeCounter } from './fringes.js';
import { sampleInterferogram, recoverSpectrum, nextPow2 } from './fts.js';
import { spectralFill, toBytes, xyzToLinear, gamutFix } from './colour.js';

export const THETA_MAX = 0.1;      // half the field of view of the screen, rad (5.7°)
export const MIRROR_HALF = 6000;   // half the width of mirror seen on the screen, μm
export const D_LIMIT = 2500;       // the mirror's travel each way, μm
const MAX_K = 65536;               // most samples in a scan
const TILT_MAX = 500;              // μrad

export const state = {
  source: 'hene', params: { gauss: { lam: 550, fwhm: 10 }, lamp: { T: 3000 } },
  dc: 500, df: 0, tilt: 0,
  motor: 'fwd', speed: 0.3,
  plot: 'trace', win: [997, 1012],
  axis: 'sigma', view: [GRID.s0, GRID_HI],
  fts: { L: 50, step: 0.1, apodize: false },
};

let spec = null, colour = null, version = 0, sigmaTop = 2.8, sweepDir = 1;
let record = [];                         // the path differences the detector has seen: [[a, b], ...]
const counter = new FringeCounter();
const fts = { samples: null, K: 0, shown: 0, scanning: false, drawn: false, norm: 1, rec: null, recKey: '', recFull: null };
const dirty = { screen: true, schem: true, spec: true, trace: true, readout: true };
let blurFrom = null;                     // Δ at the last screen frame, if the mirror moved continuously since
let onChange = () => {};                 // the app's hook: write the hash

export const D = () => 2 * (state.dc + state.df);
export const getSpectrum = () => spec;
export const getFts = () => fts;
export const getRecord = () => record;
export const getCounter = () => counter;

// --------------------------------------------------------------------- the light

export function setSource(id, params) {
  state.source = id;
  if (params && state.params[id]) Object.assign(state.params[id], params);
  const s = SOURCES[id] || SOURCES.hene;
  spec = s.make(state.params[id]).normalize();
  fts.drawn = false;
  specChanged();
  showSourceControls();
}

/** Use a spectrum made elsewhere (a drawing to start from). */
export function useSpectrum(sp, label = 'drawn') {
  spec = sp;
  state.source = label;
  fts.drawn = false;
  specChanged();
  showSourceControls();
}

function specChanged() {
  spec.update();
  colour = new ColourModel(spec);
  const [, hi] = spec.range();
  sigmaTop = Math.max(0.5, Math.min(hi, 3.2));
  version++;
  if (!fts.drawn) fts.samples = null;
  fts.rec = null;
  Object.keys(dirty).forEach((k) => { dirty[k] = true; });
  onChange();
}

/** The mean wavenumber, for read-outs. */
function meanSigma() {
  let p = 0, m = 0;
  for (const l of spec.lines) { p += l.A; m += l.A * l.s; }
  if (spec.cont) { const { s0, ds, v } = spec.cont; for (let i = spec.i0; i <= spec.i1; i++) { p += v[i]; m += v[i] * (s0 + i * ds); } }
  return p > 0 ? m / p : 1.6;
}

// --------------------------------------------------------------------- the mirror

function carry() {
  if (Math.abs(state.df) >= 1) { const k = Math.trunc(state.df); state.dc += k; state.df -= k; }
  const d = state.dc + state.df;
  if (d > D_LIMIT) { state.dc = D_LIMIT - state.df; if (state.motor !== 'sweep') setMotor('stop'); }
  if (d < -D_LIMIT) { state.dc = -D_LIMIT - state.df; if (state.motor !== 'sweep') setMotor('stop'); }
  syncMirrorSliders();
}

/** After any change of dc, df: record what the detector saw, count fringes, follow with the window. */
function moved(oldD, continuous = true) {
  carry();
  const newD = D();
  if (newD === oldD) return;
  if (continuous) {
    addRecord(oldD, newD);
    counter.advance(spec, oldD, newD, sigmaTop);
    if (blurFrom === null) blurFrom = oldD;
  } else blurFrom = null;
  followWindow(oldD, newD);
  dirty.screen = dirty.schem = dirty.readout = dirty.trace = true;
  onChange();
}

/** Move the mirror so that the path difference is newD. */
export function setPath(newD, continuous = true) {
  const old = D(), d = Math.max(-D_LIMIT, Math.min(D_LIMIT, newD / 2));
  state.dc = d - state.df;
  moved(old, continuous);
}

function followWindow(oldD, newD) {
  const [w0, w1] = state.win, W = w1 - w0;
  if (newD >= w0 && newD <= w1) return;
  if (Math.abs(newD - oldD) > W) state.win = [newD - W / 2, newD + W / 2];
  else if (newD > w1) state.win = [newD - 0.06 * W, newD + 0.94 * W];
  else state.win = [newD - 0.94 * W, newD + 0.06 * W];
}

function addRecord(a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const out = [];
  let nlo = lo, nhi = hi, placed = false;
  for (const iv of record) {
    if (iv[1] < nlo) out.push(iv);
    else if (iv[0] > nhi) { if (!placed) { out.push([nlo, nhi]); placed = true; } out.push(iv); }
    else { nlo = Math.min(nlo, iv[0]); nhi = Math.max(nhi, iv[1]); }
  }
  if (!placed) out.push([nlo, nhi]);
  record = out;
  trace.pending = trace.pending ? [Math.min(trace.pending[0], lo), Math.max(trace.pending[1], hi)] : [lo, hi];
}

/** Record [a, b] as seen by the detector, without moving the mirror. */
export function recordRange(a, b) { addRecord(a, b); dirty.trace = true; }

export function clearRecord() { record = []; trace.key = ''; dirty.trace = true; }

export function setMotor(m) {
  state.motor = m;
  if (motorSeg) motorSeg.value = m;
  dirty.readout = true;
}

/** Advance the motor and the scan by dt seconds.  Returns true if anything moves. */
export function tick(dt) {
  let busy = false;
  if (fts.scanning) {
    busy = true;
    // The scan takes about 4 s, whatever its length.
    const rate = fts.K / 4;
    fts.shownF = Math.min(fts.K, (fts.shownF ?? 0) + rate * dt);
    fts.shown = Math.floor(fts.shownF);
    const old = D();
    state.df = 0; state.dc = (fts.shown * state.fts.step) / 2;
    moved(old, true);
    if (fts.shown >= fts.K) fts.scanning = false;
    fts.rec = null; dirty.spec = dirty.trace = true;
  } else if (state.motor !== 'stop' && state.speed > 0) {
    busy = true;
    const old = D();
    let dir = state.motor === 'fwd' ? 1 : state.motor === 'back' ? -1 : sweepDir;
    if (state.motor === 'sweep') {
      const [w0, w1] = state.win, m = 0.04 * (w1 - w0);
      if (old >= w1 - m && dir > 0) dir = sweepDir = -1;
      else if (old <= w0 + m && dir < 0) dir = sweepDir = 1;
    }
    state.df += dir * state.speed * Math.min(dt, 0.1);
    moved(old, true);
  }
  return busy;
}

// --------------------------------------------------------------------- the spectrometer

const ftsK = () => Math.max(4, Math.min(MAX_K, Math.round(state.fts.L / state.fts.step)));

function ensureSamples() {
  const K = ftsK();
  if (fts.drawn) return;
  if (!fts.samples || fts.K !== K || fts.samplesFor !== `${version},${state.fts.step}`) {
    fts.K = K;
    fts.samples = sampleInterferogram(spec, state.fts.step, K);
    fts.samplesFor = `${version},${state.fts.step}`;
    fts.norm = 2 * spec.I0 || 1;
    if (!fts.scanning) { fts.shown = K; fts.shownF = K; }
    fts.rec = null;
  }
}

/** The recovered spectrum from the samples shown so far, fine enough for the spectrum plot. */
function recovered(colWidth) {
  ensureSamples();
  const k = Math.max(1, fts.shown), step = state.fts.step;
  const need = Math.min(fts.scanning ? 1 << 17 : 1 << 18, nextPow2(2 / (Math.max(colWidth, 1e-7) * step)));
  const L = Math.max(nextPow2(2 * (k + 1)), need);
  const key = `${version},${k},${L},${state.fts.apodize},${fts.drawn ? fts.drawnVersion : 0},${step}`;
  if (fts.rec && fts.recKey === key) return fts.rec;
  const I = fts.samples.subarray(0, k + 1);
  const r = recoverSpectrum(I, step, { apodize: state.fts.apodize, length: L });
  const cum = new Float64Array(r.v.length + 1);
  for (let i = 0; i < r.v.length; i++) cum[i + 1] = cum[i] + r.v[i];
  r.cum = cum;
  fts.rec = r; fts.recKey = key;
  return r;
}

export function startScan() {
  fts.drawn = false;
  ensureSamples();
  fts.scanning = true; fts.shown = 0; fts.shownF = 0; fts.rec = null;
  setMotor('stop');
  setPlot('fts');
  const old = D();
  state.df = 0; state.dc = 0;
  moved(old, false);
}

/** Stop using a drawn interferogram: the spectrum it implies becomes the light source. */
function adoptDrawn() {
  if (!fts.drawn) return;
  const r = recovered(GRID.ds);
  const s = new Spectrum([], r);
  spec = new Spectrum([], { s0: GRID.s0, ds: GRID.ds, v: s.gridValues() });
  fts.drawn = false; fts.saved = null;
  state.source = 'drawn';
  showSourceControls();
  specChanged();
}

export function undoDrawing() {
  if (fts.saved) { spec = fts.saved.spec; state.source = fts.saved.source; fts.saved = null; }
  fts.drawn = false;
  fts.samples = null;
  specChanged();
  showSourceControls();
}

// --------------------------------------------------------------------- the schematic

const schem = $('#schematic');
let hits = null, schemDrag = null, boardCache = null;
// The mirror's drawn offset (design units) against d: compressed so nanometres and millimetres both show.
const OFF_MAX = 8, OFF_K = Math.asinh(D_LIMIT / 2);
const offOf = (d) => (OFF_MAX * Math.asinh(d / 2)) / OFF_K;
const dOf = (off) => 2 * Math.sinh((Math.max(-OFF_MAX, Math.min(OFF_MAX, off)) * OFF_K) / OFF_MAX);
const TILT_DRAW = 0.35 / TILT_MAX;     // drawn angle (rad) per μrad

function sourceRGB() {
  const b = colour.base, rgb = gamutFix(xyzToLinear(b[0], b[1], b[2])), m = Math.max(...rgb, 1e-9);
  return toBytes(rgb.map((c) => 0.25 + (0.75 * c) / m));
}

function drawSchematic() {
  const { ctx, width, height } = fitCanvas(schem);
  const u = Math.min(width / 100, height / 64), ox = (width - 100 * u) / 2, oy = (height - 64 * u) / 2;
  const P = (x, y) => [ox + x * u, oy + y * u];
  // An optical breadboard, drawn once per size.
  const dpr = window.devicePixelRatio || 1;
  if (!boardCache || boardCache.width !== schem.width || boardCache.height !== schem.height) {
    boardCache = document.createElement('canvas'); boardCache.width = schem.width; boardCache.height = schem.height;
    const b = boardCache.getContext('2d');
    b.scale(dpr, dpr);
    b.fillStyle = '#1b1d22'; b.fillRect(0, 0, width, height);
    b.fillStyle = 'rgba(255,255,255,0.07)';
    for (let x = 2; x < 100; x += 4) for (let y = 2; y < 64; y += 4) { const [px, py] = P(x, y); b.fillRect(px - 0.8, py - 0.8, 1.6, 1.6); }
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(boardCache, 0, 0); ctx.restore();
  const [r, g, b] = sourceRGB(), beam = `rgb(${r},${g},${b})`;
  const text = 'rgba(225,226,230,0.85)', dim = 'rgba(225,226,230,0.55)';
  const line = (pts, w, style) => { ctx.strokeStyle = style; ctx.lineWidth = w; ctx.beginPath(); pts.forEach(([x, y], i) => { const [px, py] = P(x, y); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }); ctx.stroke(); };
  const label = (s, x, y, align = 'center', col = text, size = 11) => { ctx.fillStyle = col; ctx.font = `${size}px system-ui, sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle'; const [px, py] = P(x, y); ctx.fillText(s, px, py); };
  const d = state.dc + state.df, off = offOf(d), EQ = 76, m2x = EQ + off, by = 32, BS = 42;
  const tiltA = state.tilt * TILT_DRAW;
  // Beams: glow, then core.
  const beams = [[[18, by], [BS, by]], [[BS, by], [BS, 7]], [[BS, by], [m2x, by]], [[BS - 0.6, by], [BS - 0.6, 58]], [[BS + 0.6, by], [BS + 0.6, 58]]];
  ctx.lineCap = 'round';
  for (const bm of beams) line(bm, 3.2 * u, `rgba(${r},${g},${b},0.18)`);
  for (const bm of beams) line(bm, Math.max(1.2, 0.45 * u), beam);
  const arrow = (x, y, dx, dy) => { const [px, py] = P(x, y), s = 1.6 * u; ctx.fillStyle = beam; ctx.beginPath(); ctx.moveTo(px + dx * s, py + dy * s); ctx.lineTo(px - dx * s - dy * s * 0.7, py - dy * s + dx * s * 0.7); ctx.lineTo(px - dx * s + dy * s * 0.7, py - dy * s - dx * s * 0.7); ctx.closePath(); ctx.fill(); };
  arrow(29, by, 1, 0); arrow(BS, 19, 0, -1); arrow(66, by, 1, 0); arrow(BS, 46, 0, 1);
  // The source.
  if (state.source === 'hene') {
    ctx.fillStyle = '#3a3d46'; const [x0, y0] = P(1, by - 3.2); ctx.fillRect(x0, y0, 12 * u, 6.4 * u);
    label('HeNe laser', 7, by, 'center', text, 10);
    line([[16, by - 3], [16, by + 3]], 1.4, 'rgba(180,200,255,0.8)');   // a diverging lens
    label('lens', 16, by + 5.5, 'center', dim, 9);
  } else {
    const [cx, cy] = P(6, by), grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, 5 * u);
    grd.addColorStop(0, `rgba(${r},${g},${b},1)`); grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(cx, cy, 5 * u, 0, 2 * Math.PI); ctx.fill();
    ctx.setLineDash([2, 2]); line([[15, by - 4.5], [15, by + 4.5]], 1.5, 'rgba(220,220,220,0.7)'); ctx.setLineDash([]);
    label(state.source === 'drawn' || state.source === 'draw' ? 'your light' : 'lamp', 6, by + 7, 'center', dim, 10);
    label('diffuser', 15, by - 6.5, 'center', dim, 9);
  }
  // Beam splitter and compensator plate.
  line([[BS - 4, by + 4], [BS + 4, by - 4]], 0.9 * u, 'rgba(170,200,230,0.75)');
  label('beam splitter', BS - 8, by + 7, 'center', dim, 9);
  line([[53, by + 3.5], [60, by - 3.5]], 0.9 * u, 'rgba(170,200,230,0.3)');
  label('compensator', 57, by + 7, 'center', dim, 9);
  // M1, fixed.
  line([[BS - 7, 6], [BS + 7, 6]], 0.9 * u, '#d9dde6');
  for (let x = BS - 7; x <= BS + 7; x += 1.5) line([[x, 6], [x + 1, 4.5]], 1, 'rgba(217,221,230,0.5)');
  label('M1 (fixed)', BS + 10, 6, 'left');
  // Equal paths marker.
  ctx.setLineDash([3, 3]); line([[EQ, by - 10], [EQ, by + 10]], 1, 'rgba(255,255,255,0.25)'); ctx.setLineDash([]);
  label('equal paths', EQ - 1, by + 11.5, 'right', dim, 9);
  // M2 on its carriage, tilted by the drawn angle.
  const [mx, my] = P(m2x, by), hl = 8 * u, ca = Math.cos(tiltA), sa = Math.sin(tiltA);
  const top = [mx + sa * hl, my - ca * hl], bot = [mx - sa * hl, my + ca * hl];
  ctx.fillStyle = '#2d3039'; ctx.fillRect(mx + 1.5 * u, my - 9 * u, 6 * u, 18 * u);
  ctx.strokeStyle = '#e6e9f0'; ctx.lineWidth = 0.9 * u; ctx.beginPath(); ctx.moveTo(...top); ctx.lineTo(...bot); ctx.stroke();
  label('M2', m2x + 9, by - 5, 'left');
  // Tilt handle at the top end, fine knob below.
  ctx.fillStyle = 'rgba(255,224,138,0.9)'; ctx.beginPath(); ctx.arc(top[0], top[1], Math.max(4, 1.3 * u), 0, 2 * Math.PI); ctx.fill();
  label('tilt', m2x - 2.5, by - 9, 'right', dim, 9);
  const [kx, ky] = P(m2x + 4.5, by + 16), kr = 3.2 * u, ka = 2 * Math.PI * state.df;
  line([[m2x + 4.5, by + 9], [m2x + 4.5, by + 13]], 1.5, '#5a5e69');
  ctx.fillStyle = '#3a3d46'; ctx.strokeStyle = '#c9ccd4'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(kx, ky, kr, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  for (let i = 0; i < 12; i++) { const a = ka + (i * Math.PI) / 6; ctx.beginPath(); ctx.moveTo(kx + Math.cos(a) * kr * 0.75, ky + Math.sin(a) * kr * 0.75); ctx.lineTo(kx + Math.cos(a) * kr, ky + Math.sin(a) * kr); ctx.stroke(); }
  ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(kx + Math.cos(ka - Math.PI / 2) * kr, ky + Math.sin(ka - Math.PI / 2) * kr); ctx.stroke();
  label('fine', m2x - 0.5, by + 16, 'right', dim, 9);
  // The screen and detector.
  line([[BS - 6, 52], [BS + 6, 52]], 1.2, 'rgba(180,200,255,0.8)');
  line([[BS - 8, 60], [BS + 8, 60]], 0.8 * u, '#9aa0ad');
  ctx.fillStyle = '#ffe08a'; { const [dx, dy] = P(BS, 60); ctx.beginPath(); ctx.arc(dx, dy, 0.9 * u, 0, 2 * Math.PI); ctx.fill(); }
  label('screen and detector', BS + 10, 60, 'left', text, 10);
  label('lens', BS + 8, 52, 'left', dim, 9);
  hits = { body: [mx - 2 * u, my - 9 * u, 10 * u, 18 * u], top, knob: [kx, ky, kr + 4], P, u, ox, oy, mx, my };
}

function schemPointer(e) {
  const r = schem.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}
function whichPart(px, py) {
  if (!hits) return null;
  const [kx, ky, kr] = hits.knob;
  if (Math.hypot(px - kx, py - ky) <= kr) return 'knob';
  if (Math.hypot(px - hits.top[0], py - hits.top[1]) <= Math.max(10, 2 * hits.u)) return 'tilt';
  const [x, y, w, h] = hits.body;
  if (px >= x - 6 && px <= x + w + 6 && py >= y - 4 && py <= y + h + 4) return 'body';
  return null;
}
schem.addEventListener('pointerdown', (e) => {
  const [px, py] = schemPointer(e), part = whichPart(px, py);
  if (!part) return;
  schem.setPointerCapture(e.pointerId);
  schemDrag = { part, px, py, df: state.df, dc: state.dc, off: offOf(state.dc + state.df) };
  if (part !== 'tilt') setMotor('stop');
  e.preventDefault();
});
schem.addEventListener('pointermove', (e) => {
  const [px, py] = schemPointer(e);
  if (!schemDrag) { const p = whichPart(px, py); schem.style.cursor = p === 'body' ? 'ew-resize' : p ? 'grab' : 'default'; return; }
  const old = D();
  if (schemDrag.part === 'body') {
    const off = schemDrag.off + (px - schemDrag.px) / hits.u;
    state.dc = dOf(off) - state.df;
    moved(old, true);
  } else if (schemDrag.part === 'knob') {
    // 4 nm of mirror travel per pixel: one turn of the knob (250 px) is 1 μm.
    state.df = schemDrag.df + ((px - schemDrag.px) - (py - schemDrag.py)) * 0.004;
    state.dc = schemDrag.dc;
    moved(old, true);
  } else {
    const a = Math.atan2(px - hits.mx, -(py - hits.my));
    setTilt(Math.max(-TILT_MAX, Math.min(TILT_MAX, a / TILT_DRAW)));
  }
});
const endSchem = () => { schemDrag = null; };
schem.addEventListener('pointerup', endSchem);
schem.addEventListener('pointercancel', endSchem);
schem.addEventListener('keydown', (e) => {
  const old = D(), step = e.shiftKey ? 0.1 : 0.01;
  if (e.key === 'ArrowRight') state.df += step; else if (e.key === 'ArrowLeft') state.df -= step;
  else if (e.key === 'ArrowUp') { setTilt(Math.min(TILT_MAX, state.tilt + 10)); e.preventDefault(); return; }
  else if (e.key === 'ArrowDown') { setTilt(Math.max(-TILT_MAX, state.tilt - 10)); e.preventDefault(); return; }
  else return;
  e.preventDefault();
  moved(old, true);
});

export function setTilt(t) {
  state.tilt = t;
  if (tiltSlider) tiltSlider.value = +t.toFixed(2);
  dirty.screen = dirty.schem = dirty.readout = true;
  onChange();
}

// --------------------------------------------------------------------- the screen

const screen = $('#screen');
let screenImg = null, screenOff = null;
function drawScreen() {
  const r = screen.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const n = Math.max(64, Math.min(440, Math.round(r.width * dpr)));
  if (!screenOff || screenOff.width !== n) {
    screenOff = document.createElement('canvas'); screenOff.width = screenOff.height = n;
    screenImg = screenOff.getContext('2d').createImageData(n, n);
  }
  const Dnow = D();
  const t0 = performance.now();
  renderScreen(colour, { D: Dnow, Dprev: blurFrom ?? Dnow, tilt: 2 * state.tilt * 1e-6 * MIRROR_HALF, thetaMax: THETA_MAX, n }, screenImg.data);
  timings.render = performance.now() - t0;
  blurFrom = null;
  screenOff.getContext('2d').putImageData(screenImg, 0, 0);
  const { ctx, width, height } = fitCanvas(screen);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(screenOff, 0, 0, width, height);
  // The detector: a small cross at the centre.
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1;
  const cx = width / 2, cy = height / 2, s = 7;
  ctx.beginPath(); ctx.moveTo(cx - s, cy); ctx.lineTo(cx - 3, cy); ctx.moveTo(cx + 3, cy); ctx.lineTo(cx + s, cy);
  ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy - 3); ctx.moveTo(cx, cy + 3); ctx.lineTo(cx, cy + s); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText('±5.7°', 8, height - 6);
  ctx.textAlign = 'right';
  ctx.fillText('detector at the cross', width - 8, height - 6);
}

// --------------------------------------------------------------------- the spectrum plot

const specCanvas = $('#spectrum');
let specFrame = null, specScale = 1, specCols = null, specDrag = null, specDens = null;

/** The plot's columns: σ edges and the width in axis units (μm⁻¹ or nm). */
function columns(f) {
  const P = Math.max(1, Math.floor(f.w)), sa = new Float64Array(P), sb = new Float64Array(P), wid = new Float64Array(P);
  for (let c = 0; c < P; c++) {
    const a = f.invX(f.left + c), b = f.invX(f.left + c + 1);
    if (state.axis === 'sigma') { sa[c] = a; sb[c] = b; wid[c] = b - a; }
    else { sa[c] = 1000 / b; sb[c] = 1000 / a; wid[c] = b - a; }
  }
  return { P, sa, sb, wid };
}

const fillCache = new Map();
function fillOf(cols, k) {
  const nm = Math.round(2000 / (cols.sa[k] + cols.sb[k]));
  let f = fillCache.get(nm);
  if (!f) { f = `rgb(${toBytes(spectralFill(nm)).join(',')})`; fillCache.set(nm, f); }
  return f;
}

function narrowLines() {
  return spec.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.w < BROAD_W && l.A > 0);
}

function drawSpectrum() {
  const { ctx, width, height } = fitCanvas(specCanvas);
  const c = themeColors();
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 40, right: 12, top: 22, bottom: 34 });
  specFrame = f;
  const [v0, v1] = state.view;
  if (state.axis === 'sigma') { f.x0 = v0; f.x1 = v1; } else { f.x0 = 1000 / v1; f.x1 = 1000 / Math.max(v0, 0.5); }
  const cols = columns(f);
  specCols = cols;
  const showFts = state.plot === 'fts';
  // The light source, as density per column (what a spectrometer with this resolution shows).
  // Lines narrower than a column and a half are sticks of height A / (column width), standing on
  // the rest of the light; everything else is shown as its density averaged over each column.
  const dens = new Float64Array(cols.P);
  const colOf = (sig) => { const x = state.axis === 'sigma' ? f.X(sig) : f.X(1000 / sig); return [x, Math.floor(x - f.left)]; };
  const sticks = [];
  let top = 0;
  if (!fts.drawn) {
    for (let k = 0; k < cols.P; k++) dens[k] = spec.power(cols.sa[k], cols.sb[k]);
    for (const { l, i } of narrowLines()) {
      const [x, k] = colOf(l.s);
      if (k < 0 || k >= cols.P || 2.355 * l.w > 1.5 * (cols.sb[k] - cols.sa[k])) continue;
      for (let q = Math.max(0, k - 3); q <= Math.min(cols.P - 1, k + 3); q++) dens[q] -= l.A * (normalCdf((cols.sb[q] - l.s) / l.w) - normalCdf((cols.sa[q] - l.s) / l.w));
      sticks.push({ l, i, x, k });
    }
    for (let k = 0; k < cols.P; k++) { dens[k] = Math.max(0, dens[k]) / cols.wid[k]; top = Math.max(top, dens[k]); }
    for (const st of sticks) { st.h = dens[st.k] + st.l.A / cols.wid[st.k]; top = Math.max(top, st.h); }
  }
  specDens = dens;
  // The recovered spectrum.
  let rec = null, rtop = 0, rmin = 0;
  if (showFts || fts.drawn) {
    let minw = Infinity;
    for (let k = 0; k < cols.P; k++) minw = Math.min(minw, cols.sb[k] - cols.sa[k]);
    const r = recovered(minw);
    rec = new Float64Array(cols.P);
    const unit = (k) => (state.axis === 'sigma' ? 1 : (cols.sb[k] - cols.sa[k]) / cols.wid[k]);   // dσ/dλ for density per nm
    for (let k = 0; k < cols.P; k++) {
      const a = cols.sa[k] / r.ds, b = cols.sb[k] / r.ds;
      let val;
      if (b - a >= 1) {
        const ia = Math.max(0, Math.ceil(a)), ib = Math.min(r.v.length - 1, Math.floor(b));
        val = ib >= ia ? (r.cum[ib + 1] - r.cum[ia]) / (ib - ia + 1) : 0;
      } else {
        const m = (a + b) / 2, j = Math.floor(m), t = m - j;
        val = j >= 0 && j + 1 < r.v.length ? r.v[j] * (1 - t) + r.v[j + 1] * t : 0;
      }
      rec[k] = val * unit(k);
      rtop = Math.max(rtop, rec[k]); rmin = Math.min(rmin, rec[k]);
    }
  }
  if (!specDrag) specScale = top > 0 ? top : fts.drawn ? 1 : 0.6;
  const lowest = rec && rtop > 0 ? Math.min(0, rmin / rtop) : 0;
  f.y0 = Math.min(0, Math.max(-0.6, lowest * 1.1)); f.y1 = 1.08;
  f.clip();
  // The band outside the drawable grid.
  const gx0 = state.axis === 'sigma' ? f.X(GRID.s0) : f.X(1000 / GRID.s0), gx1 = state.axis === 'sigma' ? f.X(GRID_HI) : f.X(1000 / GRID_HI);
  ctx.fillStyle = c.line; ctx.globalAlpha = 0.35;
  ctx.fillRect(f.left, f.top, Math.max(0, Math.min(gx0, gx1) - f.left), f.h);
  ctx.fillRect(Math.max(gx0, gx1), f.top, Math.max(0, f.right - Math.max(gx0, gx1)), f.h);
  ctx.globalAlpha = 1;
  const y0 = f.Y(0);
  if (!fts.drawn) {
    // Each column filled with the colour of its wavelength.
    for (let k = 0; k < cols.P; k++) {
      if (!(dens[k] > 0)) continue;
      ctx.fillStyle = fillOf(cols, k);
      const y = f.Y(dens[k] / specScale);
      ctx.fillRect(f.left + k, y, 1, y0 - y);
    }
    ctx.strokeStyle = c.ink; ctx.lineWidth = 1.2; ctx.beginPath();
    for (let k = 0; k < cols.P; k++) { const y = f.Y(Math.min(1.2, dens[k] / specScale)); if (k) ctx.lineTo(f.left + k + 0.5, y); else ctx.moveTo(f.left + k + 0.5, y); }
    ctx.stroke();
    // The sticks, in their colours, outlined.
    for (const st of sticks) {
      const y = f.Y(Math.min(1.2, st.h / specScale)), yb = f.Y(dens[st.k] / specScale);
      ctx.fillStyle = `rgb(${toBytes(spectralFill(1000 / st.l.s)).join(',')})`;
      ctx.fillRect(st.x - 1.5, y, 3, yb - y);
      ctx.strokeStyle = c.ink; ctx.lineWidth = 0.8; ctx.strokeRect(st.x - 1.5, y, 3, yb - y);
    }
  }
  if (rec && rtop > 0) {
    if (fts.drawn) {
      for (let k = 0; k < cols.P; k++) {
        const v = rec[k] / rtop, y = f.Y(v);
        if (v >= 0) { ctx.fillStyle = fillOf(cols, k); ctx.fillRect(f.left + k, y, 1, y0 - y); }
        else { ctx.fillStyle = c.warn; ctx.fillRect(f.left + k, y0, 1, y - y0); }
      }
    }
    ctx.strokeStyle = fts.drawn ? c.ink : c.accent; ctx.lineWidth = fts.drawn ? 1.2 : 1.8; ctx.beginPath();
    for (let k = 0; k < cols.P; k++) { const y = f.Y(rec[k] / rtop); if (k) ctx.lineTo(f.left + k + 0.5, y); else ctx.moveTo(f.left + k + 0.5, y); }
    ctx.stroke();
  }
  // The zero line.
  ctx.strokeStyle = c.ink3; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(f.left, y0 + 0.5); ctx.lineTo(f.right, y0 + 0.5); ctx.stroke();
  // Handles on narrow lines, to drag their strength.
  lineHandles = [];
  if (!fts.drawn) for (const { l, i } of narrowLines()) {
    const st = sticks.find((q) => q.i === i), [x, k0] = colOf(l.s);
    if (k0 < 0 || k0 >= cols.P) continue;
    const y = f.Y(Math.min(1.05, (st ? st.h : dens[k0]) / specScale));
    ctx.fillStyle = c.panel; ctx.strokeStyle = c.ink; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    lineHandles.push({ x, y, i, k: k0, stick: !!st });
  }
  ctx.restore();
  f.axes({ xlabel: state.axis === 'sigma' ? 'wavenumber σ = 1/λ (μm⁻¹)' : 'wavelength λ (nm)', yTicks: false, colors: c });
  // The other variable along the top, ticks at least 34 px apart.
  ctx.save();
  ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = c.ink3; ctx.strokeStyle = c.ink3; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  const sig = state.axis === 'sigma';
  const sLo = sig ? f.x0 : 1000 / f.x1, sHi = sig ? f.x1 : 1000 / Math.max(f.x0, 1e-3);
  let cands;
  if (sig) {
    const lo = 1000 / Math.max(sHi, 1e-3), hi = sLo > 0 ? 1000 / sLo : Infinity;
    cands = hi / lo > 1.6 ? [200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 1000, 1500, 2000, 3000, 5000].filter((v) => v >= lo && v <= hi)
      : niceTicks(lo, hi, Math.max(2, Math.round(f.w / 80)));
  } else cands = niceTicks(sLo, sHi, Math.max(2, Math.round(f.w / 80)));
  const xs = cands.map((v) => [v, sig ? f.X(1000 / v) : f.X(1000 / v)]).filter(([v, x]) => v > 0 && x >= f.left + 8 && x <= f.right - 30).sort((a, b) => b[1] - a[1]);
  let lastX = Infinity;
  for (const [v, x] of xs) {
    if (lastX - x < 34) continue;
    lastX = x;
    ctx.beginPath(); ctx.moveTo(x + 0.5, f.top); ctx.lineTo(x + 0.5, f.top - 4); ctx.stroke();
    ctx.fillText(tickLabel(v), x, f.top - 5);
  }
  ctx.textAlign = 'right'; ctx.fillText(sig ? 'λ (nm)' : 'σ (μm⁻¹)', f.right, 11);
  // A legend in spectrometer mode.
  ctx.textAlign = 'left'; ctx.font = '11px system-ui, sans-serif';
  if (fts.drawn) { ctx.fillStyle = c.ink2; ctx.fillText('the spectrum that makes your interferogram', f.left + 6, f.top + 14); }
  else if (rec) {
    ctx.fillStyle = c.ink2; ctx.fillText('light source', f.left + 6, f.top + 14);
    ctx.fillStyle = c.accent; ctx.fillText('recovered from the scan', f.left + 80, f.top + 14);
  }
  ctx.restore();
  const neg = rec && rmin < -0.02 * rtop && fts.drawn;
  $('#spec-note').innerHTML = fts.drawn ? (neg ? '<span class="warn-text">negative in places: no light could make this</span>' : 'heights scaled to fit')
    : rec ? 'each curve scaled to fit' : 'draw on it; drag a line\'s dot';
}
let lineHandles = [];

function specPointer(e) {
  const r = specCanvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, f = specFrame;
  const a = f.invX(px), s = state.axis === 'sigma' ? a : 1000 / a;
  return { px, py, s, y: f.invY(py) };
}
specCanvas.addEventListener('pointerdown', (e) => {
  if (!specFrame) return;
  specCanvas.setPointerCapture(e.pointerId);
  if (fts.drawn) adoptDrawn();
  const p = specPointer(e);
  const h = lineHandles.find((q) => Math.abs(q.x - p.px) < 8 && p.py < specFrame.bottom + 4);
  if (h) { specDrag = { line: h.i, k: h.k, stick: h.stick }; dragLine(p); return; }
  spec.prepareForDrawing();
  state.source = 'drawn';
  showSourceControls();
  specDrag = { last: null };
  drawAt(p);
});
specCanvas.addEventListener('pointermove', (e) => {
  if (!specDrag || !specFrame) return;
  const p = specPointer(e);
  if (specDrag.line !== undefined) dragLine(p); else drawAt(p);
});
const endSpec = () => {
  if (!specDrag) return;
  if (specDrag.line !== undefined) { spec.lines = spec.lines.filter((l) => l.A > 1e-9 || l.w >= BROAD_W); specChanged(); }
  specDrag = null;
  dirty.spec = true;
};
specCanvas.addEventListener('pointerup', endSpec);
specCanvas.addEventListener('pointercancel', endSpec);
specCanvas.addEventListener('wheel', (e) => {
  if (!specFrame) return;
  e.preventDefault();
  const p = specPointer(e), k = Math.exp(Math.sign(e.deltaY) * 0.15);
  let [a, b] = state.view;
  a = p.s + (a - p.s) * k; b = p.s + (b - p.s) * k;
  setView([Math.max(0, a), Math.min(30, b)]);
}, { passive: false });

function dragLine(p) {
  // The handle shows the density in its column, which holds only part of a line spread over
  // several columns: choose A so that the column's density meets the pointer.
  const l = spec.lines[specDrag.line], k = specDrag.k;
  if (!l) return;
  const sa = specCols.sa[k], sb = specCols.sb[k], w = specCols.wid[k];
  if (specDrag.stick) { l.A = Math.max(0, Math.max(0, p.y) * specScale - specDens[k]) * w; specChanged(); return; }
  const frac = Math.max(1e-3, normalCdf((sb - l.s) / l.w) - normalCdf((sa - l.s) / l.w));
  const others = spec.power(sa, sb) - l.A * frac;
  l.A = Math.max(0, (Math.max(0, p.y) * specScale * w - others) / frac);
  specChanged();
}

function drawAt(p) {
  // The pen sets the density; in wavelength mode, density per nm = S(σ) σ²/1000.
  const val = Math.max(0, Math.min(1.08, p.y)) * specScale, s = p.s;
  const toV = (sig, d) => (state.axis === 'sigma' ? d : (1000 * d) / (sig * sig));
  const v = spec.cont.v, at = (sig) => Math.round((sig - GRID.s0) / GRID.ds);
  const last = specDrag.last || { s, val };
  const ia = at(Math.min(last.s, s)), ib = at(Math.max(last.s, s));
  for (let i = Math.max(0, ia); i <= Math.min(GRID.n - 1, ib); i++) {
    const sig = GRID.s0 + i * GRID.ds, t = ib === ia ? 1 : (sig - last.s) / (s - last.s);
    v[i] = Math.max(0, toV(sig, last.val + (val - last.val) * Math.max(0, Math.min(1, t))));
  }
  specDrag.last = { s, val };
  specChanged();
}

export function setView(v) {
  let [a, b] = v;
  if (b - a < 2e-4) { const m = (a + b) / 2; a = m - 1e-4; b = m + 1e-4; }
  state.view = [a, b];
  dirty.spec = true;
  onChange();
}

export function viewPreset(which) {
  if (which === 'visible') setView([GRID.s0, GRID_HI]);
  else if (which === 'wide') setView([0, Math.max(3.2, state.plot === 'fts' ? 1 / (2 * state.fts.step) : 0)]);
  else {
    // Fit the light: the narrow lines (with room around them) or everything.
    const ls = narrowLines().map(({ l }) => l.s);
    if (ls.length && !spec.cont?.v.some((x) => x !== 0)) {
      const lo = Math.min(...ls), hi = Math.max(...ls), pad = Math.max(0.004, 0.5 * (hi - lo));
      setView([lo - pad, hi + pad]);
    } else { const [lo, hi] = spec.range(); const pad = 0.1 * (hi - lo); setView([lo - pad, hi + pad]); }
  }
}

// --------------------------------------------------------------------- the interferogram plot

const traceCanvas = $('#trace');
const trace = { key: '', lo: null, hi: null, has: null, P: 0, pending: null, frame: null, fullKey: '', flo: null, fhi: null };
let traceDrag = null;

function pathUnit(W) { return W >= 2000 ? [1000, 'mm'] : W < 2 ? [1e-3, 'nm'] : [1, 'μm']; }

function computeColumns(c0, c1, x0, W, P) {
  const g = [0, 0];
  for (let col = Math.max(0, c0); col <= Math.min(P - 1, c1); col++) {
    const xa = x0 + (col * W) / P, xb = x0 + ((col + 1) * W) / P;
    let lo = Infinity, hi = -Infinity;
    // Binary search for the first interval ending after xa.
    let a = 0, b = record.length;
    while (a < b) { const m = (a + b) >> 1; if (record[m][1] < xa) a = m + 1; else b = m; }
    for (let i = a; i < record.length && record[i][0] <= xb; i++) {
      const p = Math.max(xa, record[i][0]), q = Math.min(xb, record[i][1]);
      if (q < p) continue;
      minMaxOver(spec, p, q, sigmaTop, g);
      lo = Math.min(lo, g[0]); hi = Math.max(hi, g[1]);
    }
    trace.has[col] = lo <= hi ? 1 : 0;
    trace.lo[col] = lo; trace.hi[col] = hi;
  }
}

function drawTrace() {
  const { ctx, width, height } = fitCanvas(traceCanvas);
  const c = themeColors();
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 40, right: 12, top: 12, bottom: 34 });
  trace.frame = f;
  if (state.plot === 'fts') return drawFtsPlot(f, ctx, c);
  const [w0, w1] = state.win, W = w1 - w0, P = Math.max(1, Math.floor(f.w));
  const key = `${w0},${w1},${P},${version}`;
  if (trace.key !== key) {
    trace.key = key; trace.P = P;
    trace.lo = new Float64Array(P); trace.hi = new Float64Array(P); trace.has = new Uint8Array(P);
    computeColumns(0, P - 1, w0, W, P);
    trace.pending = null;
  } else if (trace.pending) {
    const [a, b] = trace.pending;
    computeColumns(Math.floor(((a - w0) / W) * P), Math.floor(((b - w0) / W) * P), w0, W, P);
    trace.pending = null;
  }
  const [unit, uname] = pathUnit(W), norm = 1 / (2 * spec.I0 || 1);
  f.x0 = w0 / unit; f.x1 = w1 / unit; f.y0 = -0.04; f.y1 = 1.1;
  f.clip();
  // Half the peak: the level with no interference.
  ctx.strokeStyle = c.ink3; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(f.left, f.Y(0.5) + 0.5); ctx.lineTo(f.right, f.Y(0.5) + 0.5); ctx.stroke(); ctx.setLineDash([]);
  // Zero path.
  if (w0 <= 0 && w1 >= 0) { ctx.strokeStyle = c.line; ctx.beginPath(); ctx.moveTo(f.X(0) + 0.5, f.top); ctx.lineTo(f.X(0) + 0.5, f.bottom); ctx.stroke(); }
  ctx.fillStyle = c.accent;
  for (let k = 0; k < P; k++) {
    if (!trace.has[k]) continue;
    const yt = f.Y(trace.hi[k] * norm), yb = f.Y(trace.lo[k] * norm);
    ctx.fillRect(f.left + k, yt - 0.75, 1, Math.max(1.5, yb - yt + 1.5));
  }
  // The mirror's position.
  const Dn = D(), x = f.X(Dn / unit);
  ctx.strokeStyle = c.warn; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, f.top); ctx.lineTo(x, f.bottom); ctx.stroke();
  ctx.fillStyle = c.warn; ctx.beginPath(); ctx.arc(x, f.Y(spec.intensity(Dn) * norm), 4.5, 0, 2 * Math.PI); ctx.fill();
  ctx.restore();
  f.axes({ xlabel: `path difference Δ (${uname})`, colors: c });
  ctx.save(); ctx.fillStyle = c.ink3; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.translate(11, f.top + f.h / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('I / I(0)', 0, 0); ctx.restore();
  $('#trace-note').textContent = record.length ? 'the detector\'s record; click or drag to move the mirror' : 'click or drag to move the mirror';
}

function drawFtsPlot(f, ctx, c) {
  ensureSamples();
  const K = fts.K, step = state.fts.step, Lm = K * step, P = Math.max(1, Math.floor(f.w));
  const [unit, uname] = pathUnit(Lm);
  const norm = 1 / fts.norm;
  let ymin = 0, ymax = 1;
  for (let k = 0; k <= fts.shown; k++) { const v = fts.samples[k] * norm; if (v < ymin) ymin = v; if (v > ymax) ymax = v; }
  f.x0 = 0; f.x1 = Lm / unit; f.y0 = Math.min(-0.04, ymin - 0.04); f.y1 = Math.max(1.1, ymax + 0.05);
  f.clip();
  // The true interferogram, faintly, behind the samples.
  if (!fts.drawn) {
    const key = `${version},${Lm},${P}`;
    if (trace.fullKey !== key) {
      trace.fullKey = key; trace.flo = new Float64Array(P); trace.fhi = new Float64Array(P);
      const g = [0, 0];
      for (let col = 0; col < P; col++) { minMaxOver(spec, (col * Lm) / P, ((col + 1) * Lm) / P, sigmaTop, g); trace.flo[col] = g[0]; trace.fhi[col] = g[1]; }
    }
    ctx.fillStyle = c.line;
    for (let k = 0; k < P; k++) {
      const yt = f.Y(trace.fhi[k] * norm), yb = f.Y(trace.flo[k] * norm);
      ctx.fillRect(f.left + k, yt - 0.5, 1, Math.max(1, yb - yt + 1));
    }
  }
  // The reference level I(0)/2.
  const ref = (fts.samples[0] / 2) * norm;
  ctx.strokeStyle = c.ink3; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(f.left, f.Y(ref) + 0.5); ctx.lineTo(f.right, f.Y(ref) + 0.5); ctx.stroke(); ctx.setLineDash([]);
  // The samples.
  const n = fts.shown;
  if (K + 1 <= P) {
    // At least a pixel per sample: a line through them, and dots when they are well apart.
    ctx.strokeStyle = c.accent; ctx.lineWidth = K + 1 <= P / 3 ? 1 : 1.5; ctx.beginPath();
    for (let k = 0; k <= n; k++) { const x = f.X((k * step) / unit), y = f.Y(fts.samples[k] * norm); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke();
    if (K + 1 <= P / 3) {
      ctx.fillStyle = c.accent;
      for (let k = 0; k <= n; k++) { ctx.beginPath(); ctx.arc(f.X((k * step) / unit), f.Y(fts.samples[k] * norm), K + 1 <= P / 8 ? 3 : 2, 0, 2 * Math.PI); ctx.fill(); }
    }
  } else {
    ctx.fillStyle = c.accent;
    const per = (K + 1) / P;
    for (let col = 0; col < P; col++) {
      const a = Math.floor(col * per), b = Math.min(n, Math.floor((col + 1) * per));
      if (a > n) break;
      let lo = Infinity, hi = -Infinity;
      for (let k = a; k <= b; k++) { const v = fts.samples[k]; if (v < lo) lo = v; if (v > hi) hi = v; }
      const yt = f.Y(hi * norm), yb = f.Y(lo * norm);
      ctx.fillRect(f.left + col, yt - 0.75, 1, Math.max(1.5, yb - yt + 1.5));
    }
  }
  if (fts.scanning) {
    const x = f.X((n * step) / unit);
    ctx.strokeStyle = c.warn; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, f.top); ctx.lineTo(x, f.bottom); ctx.stroke();
  }
  ctx.restore();
  f.axes({ xlabel: `path difference Δ (${uname})`, colors: c });
  ctx.save(); ctx.fillStyle = c.ink3; ctx.font = '10px system-ui, sans-serif'; ctx.translate(11, f.top + f.h / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('I / I(0)', 0, 0); ctx.restore();
  $('#trace-note').textContent = fts.drawn ? 'your interferogram: keep drawing' : fts.scanning ? 'scanning...' : `${K + 1} samples, one every ${fmt(step, 3)} μm; draw on them`;
}

function tracePointer(e) {
  const r = traceCanvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}
traceCanvas.addEventListener('pointerdown', (e) => {
  const f = trace.frame;
  if (!f) return;
  traceCanvas.setPointerCapture(e.pointerId);
  const [px, py] = tracePointer(e);
  if (state.plot === 'fts') {
    ensureSamples();
    if (!fts.drawn) {
      fts.saved = { spec, source: state.source };
      fts.drawn = true; fts.scanning = false; fts.shown = fts.K;
      fts.samples = Float64Array.from(fts.samples); fts.drawnVersion = 0;
    }
    traceDrag = { fts: true, last: null };
    drawSamples(px, py);
  } else {
    setMotor('stop');
    traceDrag = { fts: false };
    const W = state.win[1] - state.win[0], [unit] = pathUnit(W);
    setPath(f.invX(px) * unit, true);
  }
});
traceCanvas.addEventListener('pointermove', (e) => {
  if (!traceDrag) return;
  const [px, py] = tracePointer(e), f = trace.frame;
  if (traceDrag.fts) drawSamples(px, py);
  else { const W = state.win[1] - state.win[0], [unit] = pathUnit(W); setPath(Math.max(state.win[0], Math.min(state.win[1], f.invX(px) * unit)), true); }
});
const endTrace = () => { traceDrag = null; };
traceCanvas.addEventListener('pointerup', endTrace);
traceCanvas.addEventListener('pointercancel', endTrace);
traceCanvas.addEventListener('wheel', (e) => {
  const f = trace.frame;
  if (!f || state.plot !== 'trace') return;
  e.preventDefault();
  const [px] = tracePointer(e), W = state.win[1] - state.win[0], [unit] = pathUnit(W), x = f.invX(px) * unit;
  const k = Math.exp(Math.sign(e.deltaY) * 0.2);
  setWindow([x + (state.win[0] - x) * k, x + (state.win[1] - x) * k]);
}, { passive: false });

function drawSamples(px, py) {
  const f = trace.frame, step = state.fts.step, [unit] = pathUnit(fts.K * step);
  const k = Math.round((f.invX(px) * unit) / step), v = f.invY(py) * fts.norm;
  const last = traceDrag.last || { k, v };
  const a = Math.min(last.k, k), b = Math.max(last.k, k);
  for (let j = Math.max(0, a); j <= Math.min(fts.K, b); j++) {
    const t = b === a ? 1 : (j - last.k) / (k - last.k);
    fts.samples[j] = last.v + (v - last.v) * t;
  }
  traceDrag.last = { k, v };
  fts.drawnVersion = (fts.drawnVersion || 0) + 1;
  // The light source becomes the spectrum that makes this interferogram (on the grid, for the screen).
  const r = recovered(GRID.ds), s = new Spectrum([], r);
  spec = new Spectrum([], { s0: GRID.s0, ds: GRID.ds, v: s.gridValues() });
  state.source = 'drawn';
  showSourceControls();
  specChanged();
}

export function setWindow(w) {
  let [a, b] = w;
  if (b - a < 0.05) { const m = (a + b) / 2; a = m - 0.025; b = m + 0.025; }
  if (b - a > 4 * D_LIMIT + 1000) { const m = (a + b) / 2; a = m - 2 * D_LIMIT - 500; b = m + 2 * D_LIMIT + 500; }
  state.win = [a, b];
  if (windowSlider) windowSlider.value = +(b - a).toPrecision(4);
  dirty.trace = true;
  onChange();
}

export function setPlot(p) {
  state.plot = p;
  if (plotSeg) plotSeg.value = p;
  $('#trace-foot').hidden = p !== 'trace';
  dirty.trace = dirty.spec = dirty.readout = true;
  onChange();
}

// --------------------------------------------------------------------- read-outs

function fmtPath(x) {
  const a = Math.abs(x);
  if (a < 1) return `${(x * 1000).toFixed(1)} nm`;
  if (a < 1000) return `${x.toFixed(3)} μm`;
  return `${(x / 1000).toFixed(6)} mm`;
}

let lastFtsHtml = '';
function updateReadouts() {
  const d = state.dc + state.df;
  $('#mirror-readout').textContent = `M2 is d = ${fmtPath(d)} from equal paths;  Δ = 2d = ${fmtPath(2 * d)}`;
  const travel = (D() - counter.start) / 2;
  $('#counter-readout').textContent = counter.lost ? 'Counter: lost count (the mirror moved too fast); reset it'
    : `Counter: ${counter.count} fringe${Math.abs(counter.count) === 1 ? '' : 's'}; mirror moved ${fmtPath(travel)}`;
  const s = meanSigma(), rate = (2 * state.speed * s);
  $('#motor-note').textContent = state.motor === 'stop' ? 'stopped' : `fringes pass the detector at about 2v/λ = ${fmt(rate, 3)} per second`;
  const V = spec.visibility(D());
  $('#screen-note').textContent = `Δ = ${fmtPath(D())}, visibility ${V.toFixed(3)}`;
  // The spectrometer.
  const K = ftsK(), step = state.fts.step, Lm = K * step, res = 1 / (2 * Lm), sN = 1 / (2 * step);
  const nm = 1000 / s, resNm = (res * nm * nm) / 1000;
  const alias = spec.range()[1] > sN;
  const html = `${K + 1} samples to Δ<sub>max</sub> = ${fmtPath(Lm)}<br>`
    + `resolution 1/(2Δ<sub>max</sub>) = ${fmt(res, 3)} μm⁻¹ (${fmt(resNm, 3)} nm at ${Math.round(nm)} nm)<br>`
    + `<span class="${alias ? 'warn-text' : ''}">Nyquist σ<sub>N</sub> = 1/(2δ) = ${fmt(sN, 3)} μm⁻¹ (λ > ${Math.round(1000 / sN)} nm)${alias ? ': light beyond it folds back' : ''}</span>`;
  if (html !== lastFtsHtml) { $('#fts-readout').innerHTML = html; lastFtsHtml = html; }
  $('#undraw').hidden = !fts.drawn;
  $('#scan').textContent = fts.scanning ? 'Scanning...' : 'Scan';
}

// --------------------------------------------------------------------- controls

let coarseSlider, fineSlider, tiltSlider, speedSlider, motorSeg, plotSeg, windowSlider, axisSeg, LSlider, stepSlider, apodToggle;
const sourceButtons = {};
let paramSliders = {};

function syncMirrorSliders() {
  if (!coarseSlider) return;
  coarseSlider.value = +(state.dc / 1000).toFixed(6);
  fineSlider.value = +(state.df * 1000).toFixed(2);
}

function showSourceControls() {
  for (const [k, b] of Object.entries(sourceButtons)) b.setAttribute('aria-pressed', String(k === state.source));
  const box = $('#source-params');
  box.replaceChildren();
  paramSliders = {};
  const p = state.params[state.source];
  if (state.source === 'gauss') {
    paramSliders.lam = slider({ label: 'λ₀ (nm)', min: 400, max: 700, step: 0.1, value: p.lam, title: 'The centre of the line', onInput: (v) => setSource('gauss', { lam: v }) });
    paramSliders.fwhm = slider({ label: 'Δλ (nm)', min: 0.05, max: 150, log: true, value: p.fwhm, title: 'The full width at half maximum', onInput: (v) => setSource('gauss', { fwhm: v }) });
    box.append(paramSliders.lam, paramSliders.fwhm);
  } else if (state.source === 'lamp') {
    paramSliders.T = slider({ label: 'T (K)', min: 1500, max: 12000, log: true, value: p.T, title: 'The temperature of the filament', onInput: (v) => setSource('lamp', { T: v }) });
    box.append(paramSliders.T);
  }
  const notes = {
    hene: '632.8 nm (in air), a line far narrower than this demo can show',
    sodium: 'D₂ 588.995 nm and D₁ 589.592 nm, strengths 2 : 1; use "Lines" to zoom in',
    mercury: '404.7, 407.8, 435.8, 546.1, 577.0 and 579.1 nm (strengths approximate)',
    gauss: p ? `coherence length λ²/Δλ = ${fmtPath((p.lam * p.lam) / p.fwhm / 1000)}` : '',
    led: 'blue chip at 450 nm (20 nm wide) and phosphor at 565 nm (110 nm wide)',
    lamp: 'Planck\'s law, inside the band 360 to 830 nm',
    white: 'flat per nanometre (CIE illuminant E), inside 360 to 830 nm',
    draw: 'draw on the spectrum',
    drawn: 'your drawing (wavenumbers 1.2 to 2.8 μm⁻¹)',
  };
  $('#source-note').textContent = notes[state.source] || '';
}

export function init(hooks) {
  onChange = hooks.onChange || onChange;
  for (const [id, s] of Object.entries(SOURCES)) {
    const b = el('button', { type: 'button', title: s.title, 'aria-pressed': 'false', onclick: () => { setSource(id); hooks.onSource?.(id); } }, s.label);
    $('#sources').append(b);
    sourceButtons[id] = b;
  }
  coarseSlider = slider({ label: 'd (mm)', min: -D_LIMIT / 1000, max: D_LIMIT / 1000, value: state.dc / 1000, title: 'Coarse: the mirror\'s distance from equal paths, in mm (Δ = 2d)',
    onInput: (v) => { const old = D(); state.dc = Math.max(-D_LIMIT, Math.min(D_LIMIT, v * 1000)); moved(old, true); } });
  fineSlider = slider({ label: 'fine (nm)', min: -1000, max: 1000, step: 0.1, value: state.df * 1000, title: 'Fine: added to d, in nanometres',
    onInput: (v) => { const old = D(); state.df = v / 1000; moved(old, true); } });
  tiltSlider = slider({ label: 'tilt (μrad)', min: -TILT_MAX, max: TILT_MAX, step: 0.1, value: state.tilt, title: 'Tilt M2 about a vertical axis: straight fringes', onInput: (v) => setTilt(v) });
  $('#mirror-box').append(coarseSlider, fineSlider, tiltSlider);
  motorSeg = segmented([
    { value: 'back', label: '◀', title: 'Run the mirror backwards' }, { value: 'stop', label: '■', title: 'Stop' },
    { value: 'fwd', label: '▶', title: 'Run the mirror forwards' }, { value: 'sweep', label: '⇄', title: 'Sweep back and forth across the interferogram\'s window' },
  ], state.motor, (m) => setMotor(m), { label: 'Motor' });
  $('#motor-box').append(motorSeg);
  speedSlider = slider({ label: 'v (μm/s)', min: 0.01, max: 1000, log: true, value: state.speed, title: 'The speed of the mirror',
    onInput: (v) => { state.speed = v; dirty.readout = true; onChange(); } });
  $('#speed-box').append(speedSlider);
  $('#counter-reset').addEventListener('click', () => { counter.reset(D()); dirty.readout = true; });

  axisSeg = segmented([{ value: 'sigma', label: 'σ', title: 'Against wavenumber 1/λ: the Fourier partner of path difference' }, { value: 'lambda', label: 'λ', title: 'Against wavelength (density per nm)' }],
    state.axis, (a) => { state.axis = a; if (a === 'lambda' && state.view[0] < 0.5) state.view[0] = 0.5; dirty.spec = true; onChange(); }, { label: 'Axis' });
  $('#axis-box').append(axisSeg);
  $('#view-box').append(segmented([
    { value: 'visible', label: 'Visible', title: 'The visible band' }, { value: 'wide', label: 'Wide', title: 'From σ = 0 (and up to the Nyquist wavenumber)' },
    { value: 'fit', label: 'Lines', title: 'Zoom in on the light' },
  ], null, (w) => viewPreset(w), { label: 'Spectrum range' }));
  plotSeg = segmented([{ value: 'trace', label: 'Detector', title: 'The detector\'s signal as the mirror moves' }, { value: 'fts', label: 'Spectrometer', title: 'Samples of a Fourier-transform spectrometer: draw on them' }],
    state.plot, (p) => { if (p === 'trace' && fts.drawn) adoptDrawn(); setPlot(p); }, { label: 'Interferogram' });
  $('#plot-box').append(plotSeg);
  windowSlider = slider({ label: 'window (μm)', min: 0.5, max: 12000, log: true, value: state.win[1] - state.win[0], title: 'The width of the interferogram\'s window',
    onInput: (W) => { const Dn = D(), [a, b] = state.win; let t = (Dn - a) / (b - a); if (!(t >= 0 && t <= 1)) t = 0.5; setWindow([Dn - t * W, Dn + (1 - t) * W]); } });
  $('#trace-foot').append(windowSlider,
    el('button', { type: 'button', class: 'small-btn', title: 'Fit the window to what has been recorded', onclick: () => { if (record.length) { const a = record[0][0], b = record[record.length - 1][1], m = 0.04 * (b - a) + 0.05; setWindow([a - m, b + m]); } } }, 'Fit'),
    el('button', { type: 'button', class: 'small-btn', title: 'Forget the record', onclick: () => clearRecord() }, 'Clear'));
  LSlider = slider({ label: 'Δmax (μm)', min: 1, max: 5000, log: true, value: state.fts.L, title: 'How far the scan goes: sets the resolution',
    onInput: (v) => { if (fts.drawn) adoptDrawn(); state.fts.L = v; fts.scanning = false; fts.samples = null; if (state.plot !== 'fts') setPlot('fts'); dirty.spec = dirty.trace = dirty.readout = true; onChange(); } });
  stepSlider = slider({ label: 'step δ (μm)', min: 0.02, max: 2, log: true, value: state.fts.step, title: 'The distance between samples: sets the highest wavenumber',
    onInput: (v) => { if (fts.drawn) adoptDrawn(); state.fts.step = v; fts.scanning = false; fts.samples = null; if (state.plot !== 'fts') setPlot('fts'); dirty.spec = dirty.trace = dirty.readout = true; onChange(); } });
  $('#fts-box').append(LSlider, stepSlider);
  apodToggle = toggle('Apodize', state.fts.apodize, (on) => { state.fts.apodize = on; fts.rec = null; dirty.spec = true; onChange(); }, 'Weight the samples by a triangle, 1 at zero path to 0 at the end: no ringing, but wider lines');
  $('#apod-box').append(apodToggle);
  $('#scan').addEventListener('click', () => startScan());
  $('#undraw').addEventListener('click', () => undoDrawing());
  window.addEventListener('resize', () => { Object.keys(dirty).forEach((k) => { dirty[k] = true; }); trace.key = ''; trace.fullKey = ''; });
}

/** Put every control in step with the state (after a setup or the hash). */
export function syncControls() {
  syncMirrorSliders();
  tiltSlider.value = state.tilt;
  speedSlider.value = state.speed;
  motorSeg.value = state.motor;
  plotSeg.value = state.plot;
  axisSeg.value = state.axis;
  windowSlider.value = +(state.win[1] - state.win[0]).toPrecision(4);
  LSlider.value = state.fts.L; stepSlider.value = state.fts.step; apodToggle.on = state.fts.apodize;
  $('#trace-foot').hidden = state.plot !== 'trace';
  showSourceControls();
  Object.keys(dirty).forEach((k) => { dirty[k] = true; });
}

/** Set the mirror without recording a sweep (for set-ups). */
export function placeMirror(d, { tilt = 0, resetCounter = true, clear = true } = {}) {
  state.dc = d; state.df = 0; state.tilt = tilt;
  if (clear) { record = []; trace.key = ''; }
  blurFrom = null;
  if (resetCounter) counter.reset(D());
  fts.scanning = false;
  syncMirrorSliders();
  Object.keys(dirty).forEach((k) => { dirty[k] = true; });
}

/** Draw whatever needs it. */
export const timings = {};
const timed = (name, fn) => { const t0 = performance.now(); fn(); timings[name] = performance.now() - t0; };
export function frame() {
  if (dirty.schem) { timed('schem', drawSchematic); dirty.schem = false; }
  if (dirty.screen) { timed('screen', drawScreen); dirty.screen = false; }
  if (dirty.spec) { timed('spec', drawSpectrum); dirty.spec = false; }
  if (dirty.trace) { timed('trace', drawTrace); dirty.trace = false; }
  if (dirty.readout) { timed('readout', updateReadouts); dirty.readout = false; }
}

export function invalidate() { Object.keys(dirty).forEach((k) => { dirty[k] = true; }); trace.key = ''; trace.fullKey = ''; }

export function isBusy() { return fts.scanning || (state.motor !== 'stop' && state.speed > 0); }

/** For the tests: the spectrum recovered from the current scan, and the spectrum shown. */
export function recoveredSpectrum(colWidth = 1e-3) { return recovered(colWidth); }

/** For the tests: where the draggable parts of the schematic are (CSS px in the canvas), and the canvas size. */
export function schemPoints() {
  if (!hits) return null;
  const r = schem.getBoundingClientRect();
  return { w: r.width, h: r.height, body: [hits.body[0] + hits.body[2] / 2, hits.body[1] + hits.body[3] / 2], knob: [hits.knob[0], hits.knob[1]], top: hits.top };
}

/** For the tests: the handles of narrow lines on the spectrum plot. */
export function lineHandlePoints() {
  const r = specCanvas.getBoundingClientRect();
  return { w: r.width, h: r.height, handles: lineHandles.map((q) => [q.x, q.y, q.i]), top: specFrame.Y(1), bottom: specFrame.Y(0), left: specFrame.left, right: specFrame.right };
}
