// Radiation from a moving charge: drag it, or pick a motion, and see its exact
// (Liénard–Wiechert) electric field, the kinks of radiation running out at c.

import { Trajectory, LW, lienardPower, larmorPower, dPdOmega, BETA_MAX } from './lw.js';
import { fieldLines } from './lines.js';
import { PRESETS, Follower, PointerPath, typedMotion, prefill } from './motions.js';
import { fixed } from './format.js';
import { el, $, slider, segmented, toggle, exprField, drawer, readHash, writeHash, fmt } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors } from '../lib/plot.js';

const H = 1 / 240;          // the path is sampled 240 times a second
const CAP = 16384;          // ...and 68 seconds of it are kept
const VIEW = 20;            // the shorter side of the view, in units

const state = {
  preset: 'shuttle',
  c: 8,                     // units per second
  lines: 'total',           // 'total' | 'velocity' | 'off'
  count: 24,
  map: 'field',             // 'off' | 'field' (signed transverse E_rad) | 'flux' (|E_rad|²)
  bright: 0,                // log10 of the colour map's gain
  trail: true, fronts: false, probe: false,
  probeAt: [5, 5],          // relative to the centre of the view
  running: true,
  replay: true,
};

// Parameter values of every preset, starting from the defaults.
const values = {};
for (const [id, p] of Object.entries(PRESETS)) values[id] = Object.fromEntries(Object.entries(p.params).map(([k, q]) => [k, q.value]));
const TYPED = { x: '2 cos(w t)', y: 'sin(2 w t)', params: { w: 1.5 } };

const traj = new Trajectory(H, CAP);
const lw = new LW(traj, state.c);
lw.tol = 1e-12; lw.atol = 2e-6;   // 2 µs: c times that is far below a pixel
const probeLW = new LW(traj, state.c);
const follower = new Follower();
const pointer = new PointerPath(0.03);

let simT = 0;               // the simulation's clock (s)
let mode = 'preset';        // 'preset': a given path; 'hand': following the pointer; 'chase': following a too-fast typed path
let motion = null, offset = 0;
let cam = [0, 0];           // the centre of the view
let dirty = true;

// ------------------------------------------------------------------ the motion

const O = new Float64Array(6), TGT = [0, 0];
function pushSample(t) {
  if (mode === 'preset') { motion.at(t - offset, O); traj.push(O[0], O[1], O[2], O[3], O[4], O[5]); return; }
  if (mode === 'hand') { if (!pointer.at(t, TGT)) { TGT[0] = follower.x; TGT[1] = follower.y; } }
  else {
    motion.at(t - offset, O);
    // (A typed path may be undefined at times: then the charge heads for where it last was.)
    if (Number.isFinite(O[0]) && Number.isFinite(O[1])) { TGT[0] = O[0]; TGT[1] = O[1]; }
  }
  follower.step(H, TGT[0], TGT[1], state.c);
  traj.push(follower.x, follower.y, follower.vx, follower.vy, follower.ax, follower.ay);
}

/** Start (or restart) a motion: its whole past goes into the history at once. */
function startMotion(id, { restart = true, keepLog = false } = {}) {
  state.preset = id;
  lw.c = probeLW.c = state.c;
  let note = '', warn = false;
  if (id === 'typed') motion = makeTyped();
  else motion = PRESETS[id].make(values[id], state.c);
  if (restart || mode !== 'preset') offset = simT;
  mode = 'preset';
  const span = Math.min(CAP * H, 60 / state.c + 2);
  const { bmax, amax } = prefill(traj, motion, simT, offset, span, state.c);
  if (id === 'typed' && (!(bmax <= BETA_MAX) || !(amax < 1e4 * state.c) || !Number.isFinite(bmax))) {
    // Too fast (or jerky) to follow exactly: chase it instead, as a hand would.
    motion.at(simT - offset, O);
    const ok = O.every(Number.isFinite);
    traj.reset(simT, ok ? O[0] : 0, ok ? O[1] : 0);
    follower.start(traj.X[0], traj.Y[0], 0, 0, state.c);
    mode = 'chase';
    note = Number.isFinite(bmax) ? `This path reaches β = ${fmt(bmax, 3)}: too fast, so the charge chases it as fast as it can (0.98 c).` : 'This path is not finite everywhere: the charge chases it as best it can.';
    warn = true;
  }
  if (!motion.follow) cam = [0, 0];
  for (const [k, b] of Object.entries(presetButtons)) b.setAttribute('aria-pressed', String(k === id));
  if (shownParams !== id) showParams(id);
  $('#motion-note').textContent = note;
  $('#motion-note').classList.toggle('warn', warn);
  $('#replay').disabled = id === 'rest';
  if (!keepLog) { powerLog.length = 0; powerTop = 0; }
  probeHist.length = 0;
  dirty = true;
  saveHash();
}

function makeTyped() {
  const ex = typedX.expr, ey = typedY.expr;
  const env = () => ({ ...typedY.params, ...typedX.params, c: state.c });
  const f = (e) => (ts) => {
    if (!e) return new Float64Array(ts.length);
    const v = e.evaluate({ t: ts, ...env() }, ts.length).re;
    return v;
  };
  return typedMotion(f(ex), f(ey));
}

/** Take hold of the charge: from now on it follows the pointer. */
function grab() {
  if (mode !== 'hand') {
    traj.at(traj.tEnd);
    follower.start(traj.wx, traj.wy, traj.vx, traj.vy, state.c);
    mode = 'hand';
    for (const b of Object.values(presetButtons)) b.setAttribute('aria-pressed', 'false');
    showParams(null);
    $('#motion-note').textContent = 'Your hand: release and the charge comes to rest where you let go.';
    $('#motion-note').classList.remove('warn');
    $('#replay').disabled = true;
  }
}

function advance(dt) {
  simT += dt;
  let n = Math.floor((simT - traj.tEnd) / H + 1e-9);
  if (n > 120) { n = 120; }
  for (let k = 0; k < n; k++) pushSample(traj.tEnd + H);
  if (simT - traj.tEnd > H) simT = traj.tEnd;   // the tab slept: drop the lost time
  if (mode === 'preset' && motion.follow) { traj.at(traj.tEnd); cam = [traj.wx, traj.wy]; }
  // One-shot motions start again once their radiation has left the view.
  if (mode === 'preset' && motion.end !== undefined && state.replay) {
    const clear = (viewHalfDiagonal() + 6) / state.c + 1.5;
    if (traj.tEnd - offset > motion.end + clear) startMotion(state.preset, { keepLog: true });
  }
}

// ------------------------------------------------------------------ geometry

const fieldCanvas = $('#field');
let view = { W: 1, H: 1, s: 1 };   // canvas size (CSS px) and pixels per unit
const toPx = (x, y) => [view.W / 2 + (x - cam[0]) * view.s, view.H / 2 - (y - cam[1]) * view.s];
const toWorld = (px, py) => [cam[0] + (px - view.W / 2) / view.s, cam[1] - (py - view.H / 2) / view.s];
function viewBox() {
  const hw = view.W / 2 / view.s, hh = view.H / 2 / view.s;
  return [cam[0] - hw, cam[0] + hw, cam[1] - hh, cam[1] + hh];
}
function viewHalfDiagonal() { return Math.hypot(view.W, view.H) / 2 / view.s; }

// ------------------------------------------------------------------ the field picture

const mapCanvas = document.createElement('canvas');
let mapCell = 4, mapMs = [], mapVals = new Float32Array(0), mapImg = null;

/** The radiation field on a coarse grid over the view. */
function computeMap(t) {
  const gw = Math.max(8, Math.ceil(view.W / mapCell)), gh = Math.max(8, Math.ceil(view.H / mapCell));
  if (mapVals.length !== gw * gh) { mapVals = new Float32Array(gw * gh); mapImg = new ImageData(gw, gh); mapCanvas.width = gw; mapCanvas.height = gh; }
  const [x0, x1, y0, y1] = viewBox(), dx = (x1 - x0) / gw, dy = (y1 - y0) / gh;
  let rowGuess = NaN;
  const t0 = performance.now();
  // If the charge never accelerated in all its stored past, there is no radiation anywhere.
  const quiet = traj.activity(traj.tStart, t)[0] <= 1e-6 * state.c * state.c;
  if (quiet) mapVals.fill(0);
  for (let j = 0; j < (quiet ? 0 : gh); j++) {
    const y = y1 - (j + 0.5) * dy;
    let guess = rowGuess;
    for (let i = 0; i < gw; i++) {
      lw.field(x0 + (i + 0.5) * dx, y, 0, t, guess);
      guess = lw.tr;
      if (i === 0) rowGuess = guess;
      // E_rad is perpendicular to n: in the plane, E_rad = E⊥ (ẑ × n).  E⊥ > 0 is anticlockwise.
      mapVals[j * gw + i] = lw.eay * lw.nx - lw.eax * lw.ny;
    }
  }
  // Keep this under about 10 ms a frame: coarser cells if it is slow, finer if fast.
  mapMs.push(performance.now() - t0);
  if (mapMs.length >= 8) {
    const ms = mapMs.reduce((a, b) => a + b) / mapMs.length;
    mapMs = [];
    if (ms > 11 && mapCell < 10) mapCell++;
    else if (ms < 4 && mapCell > 3) mapCell--;
  }
  // Colours: anticlockwise orange, clockwise blue (field); or black → red → yellow (flux).
  const d = mapImg.data, gain = Math.pow(10, state.bright) / E_REF;
  for (let o = 0; o < gw * gh; o++) {
    const v = mapVals[o] * gain;
    let r, g, b;
    if (state.map === 'flux') {
      const a = Math.tanh(v * v);
      r = 255 * Math.min(1, 1.6 * a); g = 255 * Math.max(0, Math.min(1, 1.6 * a - 0.55)); b = 255 * Math.max(0, 2.2 * a - 1.6);
      r *= 0.85; g *= 0.85; b *= 0.85;
    } else {
      const a = 0.8 * Math.tanh(Math.abs(v));
      if (v > 0) { r = 255 * a; g = 135 * a; b = 30 * a; } else { r = 50 * a; g = 140 * a; b = 255 * a; }
    }
    d[4 * o] = r; d[4 * o + 1] = g; d[4 * o + 2] = b; d[4 * o + 3] = 255;
  }
  mapCanvas.getContext('2d').putImageData(mapImg, 0, 0);
}
// The colour map's scale: the Coulomb field 5 units from the charge.
const E_REF = 1 / 25;

let lines = [], lineEvals = 0, lastFrameMs = 0;
const timing = {};

function drawField() {
  const { ctx, width, height } = fitCanvas(fieldCanvas);
  view = { W: width, H: height, s: Math.min(width, height) / VIEW };
  const t = traj.tEnd;
  if (mode === 'preset' && motion.follow) { traj.at(t); cam = [traj.wx, traj.wy]; }
  ctx.fillStyle = '#05070b';
  ctx.fillRect(0, 0, width, height);
  const t0 = performance.now();
  if (state.map !== 'off') {
    computeMap(t);
    timing.map = performance.now() - t0;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(mapCanvas, 0, 0, width, height);
  }
  drawGrid(ctx);
  if (state.fronts) drawFronts(ctx, t);
  if (state.trail) drawTrail(ctx);
  if (state.lines !== 'off') {
    const t1 = performance.now();
    const r = fieldLines(lw, t, state.lines, state.count, viewBox(), { tol: 1.5e-3 * VIEW / 20, maxEvaluations: 60000 });
    lines = r.lines; lineEvals = r.evaluations;
    timing.lines = performance.now() - t1;
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = state.lines === 'velocity' ? 'rgba(150, 205, 255, 0.95)' : 'rgba(236, 240, 255, 0.92)';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const ox = view.W / 2 - cam[0] * view.s, oy = view.H / 2 + cam[1] * view.s, sc = view.s;
    for (const L of lines) {
      ctx.moveTo(ox + L[0] * sc, oy - L[1] * sc);
      for (let i = 2; i < L.length; i += 2) ctx.lineTo(ox + L[i] * sc, oy - L[i + 1] * sc);
    }
    ctx.stroke();
  } else lines = [];
  if (state.probe) drawProbe(ctx, t);
  drawCharge(ctx, t);
  drawScale(ctx);
  lastFrameMs = performance.now() - t0;
}

function drawGrid(ctx) {
  // Dots every 2 units, fixed in the lab: when the view follows the charge they slide by.
  const [x0, x1, y0, y1] = viewBox(), step = 2;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      const [px, py] = toPx(x, y);
      ctx.fillRect(px - 0.75, py - 0.75, 1.5, 1.5);
    }
  }
}

function drawTrail(ctx) {
  // The last few seconds of the path.
  const k1 = traj.n - 1, k0 = Math.max(traj.kStart, k1 - Math.round(4 / H));
  ctx.strokeStyle = 'rgba(255, 120, 110, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  const ox = view.W / 2 - cam[0] * view.s, oy = view.H / 2 + cam[1] * view.s, sc = view.s;
  for (let k = k1; k >= k0; k -= 2) {
    const i = k % CAP, px = ox + traj.X[i] * sc, py = oy - traj.Y[i] * sc;
    if (k === k1) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawFronts(ctx, t) {
  // Light sent out every 2/c seconds (2 units apart), drawn where it has got to now.
  const dt = 2 / state.c, rmax = viewHalfDiagonal() * 2 + 4;
  ctx.strokeStyle = 'rgba(255, 230, 140, 0.35)';
  ctx.lineWidth = 1;
  for (let te = Math.floor(t / dt) * dt; t - te < rmax / state.c; te -= dt) {
    traj.at(te, false);
    const [px, py] = toPx(traj.wx, traj.wy), r = state.c * (t - te) * view.s;
    if (r < 1) continue;
    ctx.beginPath(); ctx.arc(px, py, r, 0, 2 * Math.PI); ctx.stroke();
    ctx.fillStyle = 'rgba(255, 230, 140, 0.5)';
    ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
  }
}

function drawCharge(ctx, t) {
  traj.at(t);
  const [px, py] = toPx(traj.wx, traj.wy);
  if (mode === 'hand' && !pointer.empty) {
    // Where the hand is (the charge lags a little behind it).
    const n = pointer.x.length, [tx, ty] = toPx(pointer.x[n - 1], pointer.y[n - 1]);
    if (Math.hypot(tx - px, ty - py) > 4) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(tx, ty, 11, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  ctx.fillStyle = '#ff5a4f'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(px, py, 7.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(px - 4, py); ctx.lineTo(px + 4, py); ctx.moveTo(px, py - 4); ctx.lineTo(px, py + 4); ctx.stroke();
}

function drawScale(ctx) {
  // How far light goes in a second (or a half, or a fifth, if that would not fit).
  let sec = 1;
  while (state.c * sec * view.s > view.W * 0.4 && sec > 0.05) sec /= 2;
  const len = state.c * sec * view.s, x = 12, y = view.H - 14;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillRect(x, y, len, 2.5);
  ctx.fillRect(x, y - 4, 1.5, 10); ctx.fillRect(x + len - 1.5, y - 4, 1.5, 10);
  ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'bottom';
  ctx.fillText(`light in ${sec === 1 ? '1 s' : fmt(sec, 2) + ' s'}`, x, y - 5);
  if (state.map !== 'off') {
    ctx.textAlign = 'right';
    ctx.fillText(state.map === 'flux' ? 'colour: |E_rad|², the radiated energy flux' : 'colour: E_rad (orange ↺, blue ↻)', view.W - 12, view.H - 8);
    ctx.textAlign = 'left';
  }
}

// --------------------------------------------------------------------- the probe

function drawProbe(ctx, t) {
  const [qx, qy] = [cam[0] + state.probeAt[0], cam[1] + state.probeAt[1]];
  probeLW.field(qx, qy, 0, t);
  const f = probeLW, [px, py] = toPx(qx, qy);
  // The retarded position, the light ray from it, and where the charge would be now had it
  // kept its retarded velocity (the velocity field points away from there).
  const [rx, ry] = toPx(f.px, f.py), vxp = f.px + f.R * f.bx, vyp = f.py + f.R * f.by, [ex, ey] = toPx(vxp, vyp);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(255, 220, 120, 0.8)'; ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(px, py); ctx.stroke();
  ctx.strokeStyle = 'rgba(140, 200, 255, 0.6)'; ctx.setLineDash([2, 3]);
  ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(px, py); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255, 220, 120, 0.95)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(rx, ry, 6, 0, 2 * Math.PI); ctx.stroke();
  ctx.strokeStyle = 'rgba(140, 200, 255, 0.95)';
  ctx.beginPath(); ctx.moveTo(ex - 5, ey - 5); ctx.lineTo(ex + 5, ey + 5); ctx.moveTo(ex - 5, ey + 5); ctx.lineTo(ex + 5, ey - 5); ctx.stroke();
  // The fields at the probe, on one scale (so that they add as arrows): the biggest is 70 px.
  const vec = [[f.evx, f.evy, '#6cb4ff'], [f.eax, f.eay, '#ffa040'], [f.ex, f.ey, '#ffffff']];
  const big = Math.max(...vec.map(([a, b]) => Math.hypot(a, b))) || 1;
  for (const [a, b, col] of vec) arrow(ctx, px, py, px + (70 * a) / big, py - (70 * b) / big, col);
  ctx.fillStyle = '#ffd75e'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(px, py, 5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'; ctx.textBaseline = 'middle';
  ctx.fillText('then', rx + 9, ry);
  // The read-out: the two parts now, and the largest radiation field of the last 3 seconds,
  // looked at every 1/240 s (not just once a frame: a shell can pass between frames).
  const ev = Math.hypot(f.evx, f.evy), eaRaw = Math.hypot(f.eax, f.eay), ea = eaRaw < 1e-9 * ev ? 0 : eaRaw;
  const last = probeHist.length ? probeHist[probeHist.length - 1][0] : -Infinity, peakLW = probeLW.tr;
  for (let ts = Math.max(last + H, t - 0.25); ts < t - 1e-9; ts += H) {
    const g = probeLW.field(qx, qy, 0, ts), v = Math.hypot(g.evx, g.evy), a = Math.hypot(g.eax, g.eay);
    probeHist.push([ts, a < 1e-9 * v ? 0 : a]);
  }
  probeHist.push([t, ea]);
  while (probeHist.length && probeHist[0][0] < t - 3) probeHist.shift();
  let peak = 0;
  for (const [, a] of probeHist) peak = Math.max(peak, a);
  probeInfo = { ev, ea, peak, tr: peakLW };
}
let probeInfo = null;
const probeHist = [];   // [time, |E_acc|] at the probe

function arrow(ctx, x0, y0, x1, y1, col) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 2) return;
  const a = Math.atan2(y1 - y0, x1 - x0), hd = Math.min(9, len * 0.5);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)'; ctx.lineWidth = 4.5;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - 0.6 * hd * Math.cos(a), y1 - 0.6 * hd * Math.sin(a)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - hd * Math.cos(a - 0.4), y1 - hd * Math.sin(a - 0.4));
  ctx.lineTo(x1 - hd * Math.cos(a + 0.4), y1 - hd * Math.sin(a + 0.4));
  ctx.closePath(); ctx.fill();
}

// ----------------------------------------------------------- the angular distribution

const polarCanvas = $('#polar'), POLAR = new Float64Array(720);
// Fonts for the plots' labels, and where those labels went (for the tests).
const FONT = '12px system-ui, sans-serif', MONO = '12px ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
const canvasLabels = {};
function drawPolar() {
  const { ctx, width, height } = fitCanvas(polarCanvas), col = themeColors();
  ctx.clearRect(0, 0, width, height);
  const { vx, vy, ax, ay } = present(), c = state.c;
  const cx = width / 2, cy = height / 2 + 8, R = Math.min(width, height - 16) / 2 - 12;
  ctx.strokeStyle = col.line; ctx.lineWidth = 1;
  for (const f of [0.5, 1]) { ctx.beginPath(); ctx.arc(cx, cy, R * f, 0, 2 * Math.PI); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = col.ink2; ctx.textBaseline = 'top';
  ctx.fillText('dP/dΩ, in the plane', 6, 4);
  const N = 720, vals = POLAR;
  let max = 0;
  for (let k = 0; k < N; k++) {
    const ph = (2 * Math.PI * k) / N;
    vals[k] = dPdOmega(Math.cos(ph), Math.sin(ph), 0, vx, vy, ax, ay, c);
    if (vals[k] > max) max = vals[k];
  }
  const amag = Math.hypot(ax, ay);
  if (!(max > 1e-14) || amag < 1e-9) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = col.ink3;
    ctx.fillText('a = 0: no radiation', cx, cy + R * 0.25);
    ctx.textAlign = 'left';
  } else {
    ctx.beginPath();
    for (let k = 0; k <= N; k++) {
      const ph = (2 * Math.PI * k) / N, r = (R * vals[k % N]) / max;
      const x = cx + r * Math.cos(ph), y = cy - r * Math.sin(ph);
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.fillStyle = col.accent; ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = col.accent; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = col.ink3; ctx.textBaseline = 'bottom';
    ctx.fillText('max', 6, height - 3);
    ctx.font = MONO; ctx.textAlign = 'right';
    const right = 6 + ctx.measureText('max 0000000000').width;
    ctx.fillText(fixed(max, 5, 10), right, height - 3);
    ctx.textAlign = 'left'; ctx.font = '11px system-ui, sans-serif';
    canvasLabels.polar = [6, right];
  }
  // The velocity (as β, the whole radius being c) and the direction of the acceleration.
  const b = Math.hypot(vx, vy) / c;
  if (b > 1e-3) arrowPlain(ctx, cx, cy, cx + (R * vx) / c, cy - (R * vy) / c, col.good, 'v');
  if (amag > 1e-9) arrowPlain(ctx, cx, cy, cx + (0.45 * R * ax) / amag, cy - (0.45 * R * ay) / amag, col.warn, 'a');
}

function arrowPlain(ctx, x0, y0, x1, y1, color, label) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - 8 * Math.cos(a - 0.4), y1 - 8 * Math.sin(a - 0.4));
  ctx.lineTo(x1 - 8 * Math.cos(a + 0.4), y1 - 8 * Math.sin(a + 0.4));
  ctx.closePath(); ctx.fill();
  ctx.font = 'italic 13px "Times New Roman", serif'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x1 + 6 * Math.cos(a) - 3, y1 + 6 * Math.sin(a));
}

// ------------------------------------------------------------- the power, over time

const powerCanvas = $('#power'), powerLog = [];   // [t, Liénard, Larmor]
const WINDOW = 10;
let powerTop = 0;
function logPower() {
  const { vx, vy, ax, ay } = present();
  const P = lienardPower(vx, vy, ax, ay, state.c), L = larmorPower(ax, ay, state.c);
  const t = traj.tEnd;
  if (powerLog.length && t <= powerLog[powerLog.length - 1][0]) return;
  powerLog.push([t, P, L]);
  while (powerLog.length && powerLog[0][0] < t - WINDOW - 1) powerLog.shift();
}

function drawPower() {
  const { ctx, width, height } = fitCanvas(powerCanvas), col = themeColors();
  ctx.clearRect(0, 0, width, height);
  // The labels and their numbers sit in fixed places (they do not depend on the values):
  // on one line if they fit, else on two.
  const last = powerLog[powerLog.length - 1] || [0, 0, 0];
  const lab1 = 'Liénard P =', W = 9;
  ctx.font = MONO; const wn = ctx.measureText('0'.repeat(W)).width;
  ctx.font = FONT;
  // (On a narrow chart, Larmor's formula is left out of its label.)
  const long = 'Larmor (2/3)q²a²/c³ =', lab2 = 54 + ctx.measureText(long).width + 5 + wn < width - 6 ? long : 'Larmor =';
  const w1 = ctx.measureText(lab1).width, w2 = ctx.measureText(lab2).width;
  const x1 = 54, n1 = x1 + w1 + 5 + wn, oneLine = n1 + 24 + w2 + 5 + wn < width - 6;
  const x2 = oneLine ? n1 + 24 : x1, y2 = oneLine ? 16 : 31, n2 = x2 + w2 + 5 + wn;
  canvasLabels.power = [x1, n1, x2, n2, y2];
  const f = new Frame(ctx, width, height, { left: 50, right: 12, top: oneLine ? 26 : 40, bottom: 30 });
  const t1 = traj.tEnd, t0 = t1 - WINDOW;
  let top = 0;
  for (const [t, P, L] of powerLog) if (t >= t0) top = Math.max(top, P, L);
  // The scale grows at once and shrinks slowly, so that it does not jump about.
  powerTop = top > powerTop ? top * 1.15 : Math.max(top * 1.15, powerTop * 0.98);
  f.x0 = -WINDOW; f.x1 = 0; f.y0 = 0; f.y1 = powerTop > 0 ? powerTop : 1;
  f.clip();
  const line = (k, color, dash) => {
    ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.setLineDash(dash);
    ctx.beginPath();
    let first = true;
    for (const row of powerLog) {
      if (row[0] < t0 - 0.1) continue;
      const x = f.X(row[0] - t1), y = f.Y(row[k]);
      if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.setLineDash([]);
  };
  line(2, col.ink3, [5, 4]);
  line(1, col.accent, []);
  ctx.restore();
  f.axes({ xlabel: 't − now (s)', yTicks: powerTop > 0 });
  ctx.textBaseline = 'alphabetic';
  const put = (lab, x, n, y, v, color) => {
    ctx.fillStyle = color; ctx.font = FONT; ctx.textAlign = 'left'; ctx.fillText(lab, x, y);
    ctx.font = MONO; ctx.textAlign = 'right'; ctx.fillText(fixed(v, 4, W), n, y);
    ctx.textAlign = 'left';
  };
  put(lab1, x1, n1, 16, last[1], col.accent);
  put(lab2, x2, n2, y2, last[2], col.ink2);
  ctx.font = FONT;
  if (!(powerTop > 0)) {
    ctx.fillStyle = col.ink3; ctx.textAlign = 'center';
    ctx.fillText('no acceleration, no radiation', f.left + f.w / 2, f.top + f.h / 2);
    ctx.textAlign = 'left';
  }
}

// ---------------------------------------------------------------------- read-outs

/** The present velocity and acceleration (an acceleration below 1e-6 c per second, like the
 *  tail of the hand's smoothing, counts as none). */
function present() {
  traj.at(traj.tEnd);
  const tiny = Math.hypot(traj.ax, traj.ay) < 1e-6 * state.c;
  return { vx: traj.vx, vy: traj.vy, ax: tiny ? 0 : traj.ax, ay: tiny ? 0 : traj.ay };
}

// The read-outs: each quantity has its own slot, a fixed number of characters wide, and its
// numbers have a fixed layout (format.js), so nothing moves as the values change.  The probe's
// slots are kept (invisible) when the probe is off, so that turning it on moves nothing.
const RO = {};
function readoutSlot(key, label, decimals, width, suffix = '') {
  const lab = el('span', { class: 'lab' }), num = el('span', { class: 'num', style: { width: `${width}ch` } });
  lab.innerHTML = label;
  const item = el('span', { class: 'ro' }, lab, num, suffix ? el('span', { class: 'lab' }, suffix) : null);
  RO[key] = { item, num, decimals, width, text: '' };
  return item;
}
$('#readout').append(
  readoutSlot('beta', 'β =', 3, 5),
  readoutSlot('gamma', 'γ =', 3, 5),
  readoutSlot('a', '|a| =', 2, 7),
  readoutSlot('ratio', 'P/P<sub>Larmor</sub> =', 3, 8),
  readoutSlot('ev', '<i class="sw vel"></i>probe |E<sub>vel</sub>| =', 4, 7),
  readoutSlot('ea', '<i class="sw acc"></i>|E<sub>acc</sub>| =', 4, 7),
  readoutSlot('peak', 'peak', 4, 7),
  readoutSlot('ago', '<i>t</i> − <i>t</i><sub>r</sub> =', 3, 6, 's'),
);
function show(key, v) {
  const r = RO[key], text = fixed(v, r.decimals, r.width);
  if (text !== r.text) { r.num.textContent = text; r.text = text; }
}

function updateReadout() {
  const { vx, vy, ax, ay } = present(), c = state.c, b = Math.hypot(vx, vy) / c, g = 1 / Math.sqrt(1 - b * b);
  const P = lienardPower(vx, vy, ax, ay, c), L = larmorPower(ax, ay, c);
  show('beta', b); show('gamma', g); show('a', Math.hypot(ax, ay));
  show('ratio', L > 1e-12 ? P / L : NaN);   // undefined without acceleration: a dash
  const probe = state.probe && probeInfo;
  for (const k of ['ev', 'ea', 'peak', 'ago']) RO[k].item.style.visibility = probe ? '' : 'hidden';
  if (probe) { show('ev', probeInfo.ev); show('ea', probeInfo.ea); show('peak', probeInfo.peak); show('ago', traj.tEnd - probeInfo.tr); }
}

// ------------------------------------------------------------------------ the loop

let lastNow = 0;
function frame(now) {
  const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
  lastNow = now;
  if (state.running) { advance(dt); dirty = true; }
  if (dirty) {
    dirty = false;
    drawField();
    logPower();
    drawPolar();
    drawPower();
    updateReadout();
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------- pointer

let drag = null;
// Pointer events carry their own time stamps (same clock as the animation frames).
const nowToSim = (stamp) => simT + (Math.abs(stamp - performance.now()) < 1000 ? stamp - lastNow : performance.now() - lastNow) / 1000;
function eventWorld(e) {
  const r = fieldCanvas.getBoundingClientRect();
  const px = Math.max(0, Math.min(r.width, e.clientX - r.left)), py = Math.max(0, Math.min(r.height, e.clientY - r.top));
  return toWorld(px, py);
}
fieldCanvas.addEventListener('pointerdown', (e) => {
  const r = fieldCanvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  fieldCanvas.setPointerCapture(e.pointerId);
  $('#hint').classList.add('gone');
  if (state.probe) {
    const [qx, qy] = toPx(cam[0] + state.probeAt[0], cam[1] + state.probeAt[1]);
    if (Math.hypot(qx - px, qy - py) < 22) { drag = 'probe'; dirty = true; return; }
  }
  if (!state.running) setRunning(true);
  grab();
  drag = 'charge';
  fieldCanvas.classList.add('dragging');
  pointer.add(nowToSim(e.timeStamp), ...eventWorld(e));
  e.preventDefault();
});
fieldCanvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (drag === 'probe') {
    const [x, y] = eventWorld(e);
    state.probeAt = [x - cam[0], y - cam[1]];
    probeHist.length = 0;
    dirty = true; saveHash();
    return;
  }
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of evs.length ? evs : [e]) pointer.add(nowToSim(ev.timeStamp), ...eventWorld(ev));
});
const endDrag = () => { drag = null; fieldCanvas.classList.remove('dragging'); };
fieldCanvas.addEventListener('pointerup', endDrag);
fieldCanvas.addEventListener('pointercancel', endDrag);
fieldCanvas.addEventListener('keydown', (e) => {
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
  if (!d) return;
  e.preventDefault();
  if (!state.running) setRunning(true);
  grab();
  const n = pointer.x.length, x = n ? pointer.x[n - 1] : follower.x, y = n ? pointer.y[n - 1] : follower.y;
  pointer.add(simT, x + d[0], y + d[1]);
});

// ---------------------------------------------------------------------- controls

const ORDER = ['rest', 'stop', 'shuttle', 'uniform', 'oscillate', 'circle', 'deflect', 'hyperbolic', 'typed'];
const presetButtons = {};
for (const id of ORDER) {
  const label = id === 'typed' ? 'Typed x(t), y(t)' : PRESETS[id].label;
  const b = el('button', { type: 'button', 'aria-pressed': 'false', class: id === 'typed' ? 'wide' : '', onclick: () => startMotion(id) }, label);
  $('#presets').append(b);
  presetButtons[id] = b;
}

let shownParams;
function showParams(id) {
  shownParams = id;
  const box = $('#params');
  box.replaceChildren();
  $('#typed').hidden = id !== 'typed';
  if (!id || id === 'typed') return;
  for (const [k, p] of Object.entries(PRESETS[id].params)) {
    box.append(slider({
      label: p.label, min: p.min, max: p.max, log: p.log, value: values[id][k], title: p.title,
      // A one-shot motion starts again with the new value; a steady one carries on.
      onInput: (v) => { values[id][k] = v; startMotion(id, { restart: motion.end !== undefined }); },
    }));
  }
}

// x(t) and y(t).  A parameter used in both gets one slider, under x(t).
const HINTS = { w: { min: 0.1, max: 6, value: 1.5 }, A: { min: 0, max: 8, value: 2 }, B: { min: 0, max: 8, value: 1 } };
const onTyped = () => { if (state.preset === 'typed' && mode !== 'hand') startMotion('typed', { restart: false }); };
const yOpts = {
  label: '<math><mi>y</mi><mo>(</mo><mi>t</mi><mo>)</mo><mo>=</mo></math>', value: TYPED.y, variables: ['t'], reserved: ['c'],
  params: TYPED.params, hints: HINTS, onChange: onTyped,
};
const typedX = exprField({
  label: '<math><mi>x</mi><mo>(</mo><mi>t</mi><mo>)</mo><mo>=</mo></math>', value: TYPED.x, variables: ['t'], reserved: ['c'],
  params: TYPED.params, hints: HINTS,
  onChange: (expr) => {
    const shared = ['c', ...expr.parameters];
    if (shared.join() !== yOpts.reserved.join()) { yOpts.reserved = shared; typedY.set(typedY.source, {}, false); }
    onTyped();
  },
});
const typedY = exprField(yOpts);
yOpts.reserved = ['c', ...typedX.expr.parameters];
typedY.set(TYPED.y, {}, false);
const typedExamples = {
  'Figure eight': ['2 cos(w t)', 'sin(2 w t)', { w: 1.5 }],
  'Ellipse': ['A cos(w t)', 'B sin(w t)', { A: 3, B: 1, w: 2 }],
  'Back and forth': ['5 tanh(3 sin(w t))', '0', { w: 0.4 }],
};
const exampleRow = el('div', { class: 'row' });
for (const [name, [x, y, p]] of Object.entries(typedExamples)) {
  exampleRow.append(el('button', { type: 'button', onclick: () => { typedX.set(x, p, false); typedY.set(y, p, false); yOpts.reserved = ['c', ...typedX.expr.parameters]; typedY.set(y, {}, false); startMotion('typed'); } }, name));
}
$('#typed').append(typedX, typedY, exampleRow, el('div', { class: 'small muted' }, 'Lengths in units, t in seconds; c may be used.'));

function setRunning(on) {
  state.running = on;
  $('#play').textContent = on ? 'Pause' : 'Run';
  dirty = true;
}
$('#play').addEventListener('click', () => setRunning(!state.running));
$('#replay').addEventListener('click', () => { if (mode !== 'hand') startMotion(state.preset, { keepLog: true }); });
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ') { e.preventDefault(); setRunning(!state.running); }
});

const cSlider = slider({
  label: 'c (units/s)', min: 1, max: 30, log: true, value: state.c,
  title: 'The speed of light, in units per second (the view is 20 units across its shorter side)',
  onInput: (v) => {
    state.c = v;
    if (mode !== 'hand') startMotion(state.preset);
    else {
      // Slower light might now be slower than the charge: start again from rest.
      traj.at(traj.tEnd);
      lw.c = probeLW.c = v;
      traj.reset(traj.tEnd, traj.wx, traj.wy);
      follower.start(traj.wx, traj.wy, 0, 0, v);
      dirty = true; saveHash();
    }
  },
});
$('#c-box').append(cSlider);

const linesSeg = segmented([
  { value: 'total', label: 'Field lines', title: 'Lines of the whole field E' },
  { value: 'velocity', label: 'Velocity part', title: 'Lines of the velocity field alone (the 1/R² part)' },
  { value: 'off', label: 'None' },
], state.lines, (v) => { state.lines = v; dirty = true; saveHash(); }, { label: 'Field lines' });
$('#lines-box').append(linesSeg);
const countSlider = slider({ label: 'lines', min: 4, max: 64, step: 1, value: state.count, onInput: (v) => { state.count = Math.round(v); dirty = true; saveHash(); } });
$('#count-box').append(countSlider);
const mapSeg = segmented([
  { value: 'off', label: 'No colour' },
  { value: 'field', label: 'Radiation field', title: 'The acceleration field E_rad, which is perpendicular to the line from the retarded position: orange anticlockwise, blue clockwise' },
  { value: 'flux', label: 'Energy flux', title: '|E_rad|², proportional to the radiated energy flowing past' },
], state.map, (v) => { state.map = v; dirty = true; saveHash(); }, { label: 'Colour' });
$('#map-box').append(mapSeg);
const brightSlider = slider({ label: 'brightness', min: -2, max: 2, step: 0.01, value: state.bright, title: 'The colour map\'s gain, in powers of ten', onInput: (v) => { state.bright = v; dirty = true; saveHash(); } });
$('#bright-box').append(brightSlider);
const extras = {
  trail: toggle('Path', state.trail, (on) => { state.trail = on; dirty = true; saveHash(); }, 'The charge\'s path over the last 4 seconds'),
  fronts: toggle('Light fronts', state.fronts, (on) => { state.fronts = on; dirty = true; saveHash(); }, 'Light sent out by the charge at regular intervals, each circle centred where it was sent'),
  probe: toggle('Probe', state.probe, (on) => { state.probe = on; dirty = true; saveHash(); }, 'A point (drag it) showing the two parts of the field there, the retarded position, and the light ray from it'),
};
$('#extras').append(...Object.values(extras));

// ------------------------------------------------------------------ the URL

let hashTimer = 0;
function saveHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const h = { m: state.preset, c: +state.c.toPrecision(4), lines: state.lines, n: state.count, map: state.map, b: state.bright || undefined };
    if (!state.trail) h.trail = 0;
    if (state.fronts) h.fronts = 1;
    if (state.probe) { h.probe = state.probeAt.map((v) => v.toFixed(2)).join(','); }
    if (state.preset === 'typed') { h.x = typedX.source; h.y = typedY.source; Object.assign(h, Object.fromEntries(Object.entries({ ...typedX.params, ...typedY.params }).map(([k, v]) => ['t_' + k, v]))); }
    else for (const [k, v] of Object.entries(values[state.preset] || {})) h['p_' + k] = +v.toPrecision(5);
    writeHash(h);
  }, 300);
}

function fromHash(h) {
  if (!PRESETS[h.m] && h.m !== 'typed') return false;
  if (+h.c > 0) { state.c = +h.c; cSlider.value = state.c; }
  if (['total', 'velocity', 'off'].includes(h.lines)) { state.lines = h.lines; linesSeg.value = h.lines; }
  if (+h.n >= 1) { state.count = Math.round(+h.n); countSlider.value = state.count; }
  if (['off', 'field', 'flux'].includes(h.map)) { state.map = h.map; mapSeg.value = h.map; }
  if (Number.isFinite(+h.b)) { state.bright = +h.b; brightSlider.value = state.bright; }
  setExtras({ trail: h.trail !== '0', fronts: h.fronts === '1', probe: !!h.probe });
  if (h.probe) { const p = h.probe.split(',').map(Number); if (p.length === 2 && p.every(Number.isFinite)) state.probeAt = p; }
  if (h.m === 'typed') {
    const p = Object.fromEntries(Object.entries(h).filter(([k]) => k.startsWith('t_')).map(([k, v]) => [k.slice(2), +v]));
    typedX.set(h.x ?? TYPED.x, p, false);
    yOpts.reserved = ['c', ...typedX.expr.parameters];
    typedY.set(h.y ?? TYPED.y, p, false);
  } else {
    for (const k of Object.keys(values[h.m])) if (Number.isFinite(+h['p_' + k]) && h['p_' + k] !== undefined) values[h.m][k] = +h['p_' + k];
  }
  shownParams = undefined;   // the values changed under the sliders
  startMotion(h.m);
  return true;
}

function setExtras(on) {
  for (const [k, t] of Object.entries(extras)) { t.on = !!on[k]; state[k] = !!on[k]; }
}

// ---------------------------------------------------------------- experiments

function go(id, { params = {}, c = 8, lines = 'total', count = 24, map = 'off', bright = 0, trail = true, fronts = false, probe = null } = {}) {
  values[id] && Object.assign(values[id], Object.fromEntries(Object.entries(PRESETS[id].params).map(([k, q]) => [k, q.value])), params);
  state.c = c; cSlider.value = c;
  state.lines = lines; linesSeg.value = lines;
  state.count = count; countSlider.value = count;
  state.map = map; mapSeg.value = map;
  state.bright = bright; brightSlider.value = bright;
  setExtras({ trail, fronts, probe: !!probe });
  if (probe) state.probeAt = probe;
  setRunning(true);
  shownParams = undefined;
  startMotion(id);
}

const setups = {
  coulomb: () => go('rest'),
  kink: () => go('stop', { params: { beta: 0.6, tau: 0.15 } }),
  inside: () => go('stop', { params: { beta: 0.8, tau: 0.1 }, probe: [-3, 7] }),
  far: () => go('stop', { params: { beta: 0.5, tau: 0.1 }, map: 'field', bright: 0.5, probe: [0, 8] }),
  heaviside: () => go('uniform', { params: { beta: 0.8 }, probe: [-2, 5], fronts: true }),
  dipole: () => go('oscillate', { params: { beta: 0.1, period: 1 }, map: 'field', bright: 1 }),
  axis: () => go('oscillate', { params: { beta: 0.2, period: 1 }, map: 'flux', bright: 0.5, probe: [0, 7] }),
  fastdipole: () => go('oscillate', { params: { beta: 0.8, period: 2 }, map: 'field', bright: 0 }),
  synchrotron: () => go('circle', { params: { beta: 0.9, radius: 2 }, map: 'flux', bright: -0.5, count: 8 }),
  power: () => go('circle', { params: { beta: 0.7, radius: 2 }, map: 'off' }),
  hyperbolic: () => go('hyperbolic', { params: { beta: 0.9, alpha: 1 }, map: 'field' }),
  deflect: () => go('deflect', { params: { beta: 0.9, angle: 60, tau: 0.25 }, map: 'flux', bright: -0.5 }),
  parts: () => go('shuttle', { params: { beta: 0.6 }, lines: 'velocity', map: 'field' }),
  hand: () => { go('rest', { map: 'field' }); grab(); },
};
drawer($('#help'), $('#help-button'), setups);

// ---------------------------------------------------------------------- start

window.addEventListener('resize', () => { dirty = true; });
const hash = readHash();
if (setups[hash.setup]) setups[hash.setup]();
else if (!fromHash(hash)) startMotion('shuttle');
requestAnimationFrame(frame);

window.__app = {
  state, setups, traj, values,
  get mode() { return mode; }, get lines() { return lines; }, get lineEvals() { return lineEvals; },
  get frameMs() { return lastFrameMs; }, timing, get mapCell() { return mapCell; }, get probe() { return probeInfo; },
  get powerLog() { return powerLog; }, canvasLabels,
  startMotion, setRunning, grab,
  setProbe(x, y) { state.probeAt = [x, y]; probeHist.length = 0; dirty = true; },
  /** The field at a point of the plane now (for the tests). */
  field(x, y) { const f = new LW(traj, state.c).field(x, y, 0, traj.tEnd); return { ex: f.ex, ey: f.ey, evx: f.evx, evy: f.evy, eax: f.eax, eay: f.eay, tr: f.tr }; },
  /** The present state of the charge. */
  charge() { traj.at(traj.tEnd); return { t: traj.tEnd, x: traj.wx, y: traj.wy, vx: traj.vx, vy: traj.vy, ax: traj.ax, ay: traj.ay, c: state.c }; },
  dPdOmega: (phi) => { traj.at(traj.tEnd); return dPdOmega(Math.cos(phi), Math.sin(phi), 0, traj.vx, traj.vy, traj.ax, traj.ay, state.c); },
  ready: true,
};
