// The 2D scattering demo: a packet, a target, and the scattering theory measured as it goes.

import { Sim2D, Packet, Detector, fromPartialWaves, bornCrossSection, radialWaves, preparePotential2D, fraunhofer, classicalHardDisk, wallRadius } from './sim.js';
import { fft2Centered } from '../lib/fft.js';
import { colorize, autoBrightness } from '../lib/complexcolor.js';
import { parse } from '../lib/expr.js';
import { el, $, slider, segmented, toggle, exprField, drawer, readHash, writeHash, fmt, setGroups } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors, niceTicks } from '../lib/plot.js';

// The targets: typed potentials in x, y, r, theta, with their parameters.
const TARGETS = [
  { id: 'disk', label: 'Hard disk', V: 'V0/(1 + exp((r - a)/w))', params: { V0: 8, a: 1.5, w: 0.25 } },
  { id: 'bump', label: 'Weak bump', V: 'V0 exp(-r^2/(2 a^2))', params: { V0: 1, a: 1 } },
  { id: 'well', label: 'Attractive well', V: '-V0/(1 + exp((r - a)/w))', params: { V0: 2.5, a: 2, w: 0.25 } },
  { id: 'coulomb', label: 'Screened Coulomb', V: 'Z exp(-r/l)/sqrt(r^2 + 0.25)', params: { Z: 1, l: 4 } },
  { id: 'two', label: 'Two disks', V: 'V0/(1 + exp((sqrt(x^2 + (y-d/2)^2) - a)/w)) + V0/(1 + exp((sqrt(x^2 + (y+d/2)^2) - a)/w))', params: { V0: 8, a: 0.7, w: 0.2, d: 5 } },
  { id: 'slits', label: 'Double slit', V: 'V0 (abs(x) < 0.4) (abs(abs(y) - d/2) > a/2)', params: { V0: 12, d: 5, a: 1.2 }, extended: true },
  // A square of 7 x 7 atoms, c apart, the edges half way between atoms.
  { id: 'crystal', label: 'Crystal', V: 'V0 exp(-((x - c round(x/c))^2 + (y - c round(y/c))^2)/(2 s^2)) (abs(x) < 3.5 c) (abs(y) < 3.5 c)', params: { V0: 2, c: 2, s: 0.3 } },
  { id: 'typed', label: 'Typed', V: 'V0 (abs(x) < a) (abs(y) < a)', params: { V0: 3, a: 1 } },
];

const state = {
  target: TARGETS[0],
  n: 256, L: 64,
  k0: 2, sy: 6, sx: 2.5, b: 0,
  turn: 0,                // the target turned anticlockwise, in degrees
  view: 'total',          // 'total' | 'scattered'
  display: 'complex',     // 'complex' | 'intensity'
  bright: 0,
  show: { circle: true, potential: true },
  running: false,
  speed: 4,
  qAngle: 60,             // the direction of k on the momentum panel's circle, whole degrees
};

let sim, packet, detector, Vexpr, Vparams = {};
let dt = 0.05, born = null, exact = null, waves = null, pwResult = null, slit = null, classical = null, warning = '';
let finished = false, tEnd = 30, potentialImage = null, round = true, wideTarget = false;

// --------------------------------------------------------------------- set-up

function evalPotential() {
  const n = state.n, N = n * n;
  // The target turned anticlockwise by `turn`: x, y, theta are the target's own coordinates.
  const a = (state.turn * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const x = new Float64Array(N), y = new Float64Array(N), r = new Float64Array(N), th = new Float64Array(N);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, xv = ca * sim.coord[i] + sa * sim.coord[j], yv = -sa * sim.coord[i] + ca * sim.coord[j];
    x[k] = xv; y[k] = yv; r[k] = Math.hypot(xv, yv); th[k] = Math.atan2(yv, xv);
  }
  const v = Vexpr.evaluate({ x, y, r, theta: th, ...Vparams }, N).re;
  const V = new Float64Array(N);
  for (let i = 0; i < N; i++) V[i] = Number.isFinite(v[i]) ? Math.max(-1e4, Math.min(1e4, v[i])) : 0;
  return V;
}

/** The detector radius: as large as fits inside the absorbing border with room to spare. */
function detectorRadius() { return Math.max(6, Math.min(18, sim.inner - 6)); }

// The set-up in the address, at every restart: target (with its typed V and parameters if
// changed), packet, grid.
function updateHash() {
  const t = state.target, r = (v) => +(+v).toPrecision(4), h = { target: t.id };
  if (vField.source !== t.V) h.V = vField.source;
  const p = Object.fromEntries(Object.entries(Vparams).map(([k, v]) => [k, r(v)]));
  if (JSON.stringify(p) !== JSON.stringify(Object.fromEntries(Object.entries(t.params).map(([k, v]) => [k, r(v)])))) h.p = JSON.stringify(p);
  for (const k of ['k0', 'sy', 'sx', 'b', 'turn']) if (state[k] !== { k0: 2, sy: 6, sx: 2.5, b: 0, turn: 0 }[k]) h[k] = r(state[k]);
  if (state.n !== 256) h.n = state.n;
  if (state.L !== 64) h.L = state.L;
  writeHash(h);
}

function restart() {
  updateHash();
  if (!sim || sim.n !== state.n || sim.L !== state.L) sim = new Sim2D({ n: state.n, L: state.L });
  warning = '';
  // The absorbing border must be wider than the longest wavelength in the packet, or slow waves
  // bounce off it (at least a tenth of the box, at most a quarter).
  const kSlow = Math.max(0.2, state.k0 - 1 / state.sx);
  const want = Math.ceil((1.2 * 2 * Math.PI) / kSlow / sim.dx);
  sim.layer = Math.min(Math.round(state.n / 4), Math.max(Math.round(state.n / 10), want));
  if (want > state.n / 4) warning = 'The packet is too slow for this box: its longest waves reflect off the border.  Enlarge the box (Grid).';
  if (state.k0 + 2 / state.sx > (0.7 * Math.PI) / sim.dx) warning = `The grid is too coarse for k₀ = ${fmt(state.k0, 3)}: refine it or shrink the box (Grid).`;
  const raw = evalPotential();
  const prep = preparePotential2D(raw, state.n, sim.dx);
  sim.setPotential(prep.V);
  sim.absorbSpeed = state.k0 + 4 / state.sx;
  sim.h = 0;
  // The packet starts clear of the target (where |V| is more than a twentieth of E or of its
  // largest value, and at least x < -2.5) and of the absorbing border; a packet too long for
  // the room between them is shortened to fit.
  const n = state.n, lay = sim.layer;
  let left = -2.5, vmax = 0;
  for (let i = 0; i < prep.V.length; i++) vmax = Math.max(vmax, Math.abs(prep.V[i]));
  const edge = Math.max(state.k0 ** 2 / 2, vmax) / 20;
  for (let j = lay; j < n - lay; j++) {
    for (let i = lay; i < n - lay && sim.coord[i] < left; i++) if (Math.abs(prep.V[j * n + i]) > edge) { left = sim.coord[i]; break; }
  }
  const room = Math.max(sim.inner / 3, sim.inner + left - 0.5);
  // A target wider than the beam (beyond two widths of it, on either side of its centre) is
  // only partly lit: its totals depend on the beam, not on the target alone.
  wideTarget = false;
  for (let j = lay; j < n - lay && !wideTarget; j++) {
    if (Math.abs(sim.coord[j] - state.b) < 2 * state.sy) continue;
    for (let i = lay; i < n - lay; i++) if (Math.abs(prep.V[j * n + i]) > edge) { wideTarget = true; break; }
  }
  if (6.6 * state.sx > room) {
    state.sx = Math.max(0.5, room / 6.6); packetSliders.sx.value = +state.sx.toFixed(2);
    warning = warning || 'The packet was shortened to fit the box.';
  }
  const x0 = -(sim.inner - 3.6 * state.sx);
  packet = new Packet({ x0, y0: state.b, sx: state.sx, sy: state.sy, k0: state.k0 });
  const N = state.n * state.n, re = new Float64Array(N), im = new Float64Array(N);
  packet.grid(sim, 0, re, im);
  sim.setPsi(re, im);
  // The time step: |V - E| dt below a third of a radian.  (Sharp potentials have been prepared;
  // in 2D that is enough, see preparePotential2D.)
  const E = packet.energy;
  let vs = 0.5;
  for (let i = 0; i < N; i++) if (prep.V[i] !== 0) vs = Math.max(vs, Math.abs(prep.V[i] - E));
  dt = Math.min(0.05, 0.33 / vs);
  // Done when the scattered wave has had time to pass the detector and the slowest part too.
  const R = detectorRadius();
  detector = new Detector(R, 256);
  detector.reset(E);
  // Done when the slowest part of the packet (no slower than 0.3 k0) has passed the detector.
  const vSlow = Math.max(state.k0 - 1 / state.sx, 0.3 * state.k0);
  tEnd = (Math.abs(x0) + R + 4 * state.sx) / vSlow + 6;
  finished = false;
  $('#play').textContent = state.running ? 'Pause' : 'Play';
  const th = Array.from(detector.theta);
  born = state.target.extended ? null : bornCrossSection(sim, state.k0, th);
  slit = state.target.extended ? slitPattern(th, prep.V) : null;
  // Classical particles off the disk: a hard disk of the radius where V = E, where one coming
  // head on is turned back (see wallRadius); none if the packet's energy is over the top.
  classical = null;
  if (state.target.id === 'disk') {
    const r = wallRadius(Vparams.V0, Vparams.a, Vparams.w, E);
    if (r > 0) classical = { r, dsdt: classicalHardDisk(r, th) };
  }
  // Turning matters only for a target that isn't round; phase shifts belong to round ones.
  round = !(Vexpr && ['x', 'y', 'theta'].some((v) => Vexpr.uses(v)));
  turnSlider.hidden = round;
  // For a potential that depends on r alone, the exact answer of time-independent scattering
  // theory: phase shifts from the radial equation (see radialWaves), for the very same V.
  exact = null;
  if (Vexpr && !['x', 'y', 'theta'].some((v) => Vexpr.uses(v))) {
    try {
      const Vr = (r) => Vexpr.evaluate({ r, x: r, y: new Float64Array(r.length), theta: new Float64Array(r.length), ...Vparams }, r.length).re;
      const w = radialWaves(Vr, state.k0, 24);
      exact = { waves: w, pw: fromPartialWaves(w, state.k0, th) };
    } catch { exact = null; }
  }
  waves = null; pwResult = null;
  potentialImage = makePotentialImage(prep.V);
  autoBright();
  draw();
}

/**
 * A wall with openings (the double slit): the openings are where V < E along the wall's middle
 * line (the target's own y axis), the incident wave there is A(y) (Kirchhoff), and the
 * Fraunhofer pattern (see fraunhofer) is averaged over the packet's energies, as the measured
 * flux is.  Returns {dsdt, open, blind}: dsigma/dtheta at the detector's angles, the open
 * width, and the angles where the detector circle runs inside the wall (V > E there).
 */
function slitPattern(th, V) {
  const a = (state.turn * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const dy = 0.01, count = Math.round((2 * sim.inner) / dy);
  const Y = Float64Array.from({ length: count }, (_, i) => -sim.inner + (i + 0.5) * dy);
  const v = Vexpr.evaluate({ x: new Float64Array(count), y: Y, r: Y.map(Math.abs), theta: Y.map((y) => (Math.sign(y) * Math.PI) / 2), ...Vparams }, count).re;
  // The wall's point Y is at x = -Y sin a, y = Y cos a: the beam's profile across itself there,
  // relative to the origin, times exp(i k x) (below, for each k).
  const ys = [], A = [];
  for (let i = 0; i < count; i++) {
    if (v[i] < packet.energy) { ys.push(Y[i]); A.push(Math.exp(-((Y[i] * ca - state.b) ** 2 - state.b ** 2) / (4 * state.sy ** 2))); }
  }
  const thw = th.map((t) => t - a), sk = 1 / (2 * state.sx), out = new Float64Array(th.length);
  let wsum = 0;
  for (let z = -3; z <= 3; z += 0.25) {
    const k = state.k0 + z * sk, w = Math.exp((-z * z) / 2);
    if (!(k > 0)) continue;
    const f = fraunhofer(k, ys, A.map((m, p) => m * Math.cos(k * sa * ys[p])), A.map((m, p) => -m * Math.sin(k * sa * ys[p])), dy, thw);
    for (let j = 0; j < th.length; j++) out[j] += w * f[j];
    wsum += w;
  }
  for (let j = 0; j < th.length; j++) out[j] /= wsum;
  const n = state.n, R = detector.R, at = (u) => Math.min(n - 1, Math.max(0, Math.round(u / sim.dx + n / 2)));
  const blind = th.map((t) => V[at(R * Math.sin(t)) * n + at(R * Math.cos(t))] > packet.energy);
  return { dsdt: out, open: ys.length * dy, blind };
}

function makePotentialImage(V) {
  const n = state.n, c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d'), img = ctx.createImageData(n, n);
  let vmax = 1e-12;
  for (let i = 0; i < V.length; i++) vmax = Math.max(vmax, Math.abs(V[i]));
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    // Row 0 of the image is the top: y = +L/2.
    const v = V[(n - 1 - j) * n + i] / vmax, o = (j * n + i) * 4;
    const a = Math.min(1, Math.abs(v)) * 150;
    if (v > 0) { img.data[o] = 255; img.data[o + 1] = 255; img.data[o + 2] = 255; } else { img.data[o] = 80; img.data[o + 1] = 140; img.data[o + 2] = 255; }
    img.data[o + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// --------------------------------------------------------------------- running

let raf = 0, last = 0;
function loop(now) {
  raf = 0;
  const real = last ? Math.min(0.05, (now - last) / 1000) : 0;
  last = now;
  if (state.running && !finished) {
    const target = sim.t + state.speed * real;
    const t0 = performance.now();
    while (sim.t < target && performance.now() - t0 < 11) {
      sim.step(dt);
      detector.record(sim, packet, dt);
      if (hasGone()) { finished = true; setRunning(false); break; }
    }
    frames++;
    // The partial waves come from time Fourier transforms over the whole collision: only once
    // the packet has gone do they mean anything.
    if (finished) analyse();
  }
  draw();
  if (state.running) raf = requestAnimationFrame(loop);
  else last = 0;
}
let frames = 0;
function kick() { if (!raf) raf = requestAnimationFrame(loop); }
function setRunning(on) {
  state.running = on;
  $('#play').textContent = on ? 'Pause' : finished ? 'Done' : 'Play';
  kick();
}

/**
 * Done when the slowest part of the packet has had time to pass the detector (tEnd) and the
 * box has emptied, less than 0.2% of the packet left: a resonance holds part of the wave back
 * and leaks it out late, and the partial waves need all of it (a time Fourier transform cut
 * short reads |S_m| < 1: 0.95 for the resonance stopped at tEnd, 0.997 once the well has
 * emptied).  At the latest, half as long again (the slow packet's tail).
 */
function hasGone() { return sim.t >= tEnd && (sim.t >= 1.5 * tEnd || boxNorm() < 0.002); }

function analyse() {
  // A wall that runs out past the detector is not a localised target: no cross section.  And
  // only a round target scatters each partial wave e^{im theta} into itself, with a phase shift:
  // others mix them (the S-matrix is not diagonal in m), and S_m means nothing.
  if (state.target.extended || !round) { waves = null; pwResult = null; return; }
  const k = state.k0;
  waves = detector.partialWaves(k, 24, packet);
  if (waves) pwResult = fromPartialWaves(waves, k, Array.from(detector.theta));
}

/**
 * Run the collision on to simulated time t (by default, to its end) at once, without waiting for
 * animation frames: the same steps as the animation, so the tests don't depend on how fast the
 * computer is.
 */
function runUntil(t = Infinity) {
  setRunning(false);
  while (!finished && sim.t < t) {
    sim.step(dt);
    detector.record(sim, packet, dt);
    if (hasGone()) finished = true;
  }
  if (finished) analyse();
  setRunning(false);
  draw();
  return sim.t;
}

// --------------------------------------------------------------------- drawing

const viewCanvas = $('#view');
let viewImage = null, flipMap = null, momCanvas = null;

function autoBright() {
  state.autoR = autoBrightness(sim.re, sim.im, 0.5) * 0.7;
}

function scatteredGrid() {
  const N = sim.re.length, re = new Float64Array(N), im = new Float64Array(N);
  packet.grid(sim, sim.t, re, im);
  for (let i = 0; i < N; i++) { re[i] = sim.re[i] - re[i]; im[i] = sim.im[i] - im[i]; }
  return [re, im];
}

function draw() {
  if (!sim) return;
  drawView();
  drawMomentum();
  drawCrossSection();
  drawWaves();
  updateReadouts();
}

function drawView() {
  const { ctx, width, height } = fitCanvas(viewCanvas);
  const n = state.n;
  if (!viewImage || viewImage.width !== n) {
    viewImage = document.createElement('canvas'); viewImage.width = viewImage.height = n;
  }
  const ictx = viewImage.getContext('2d'), img = ictx.createImageData(n, n);
  const [re, im] = state.view === 'scattered' ? scatteredGrid() : [sim.re, sim.im];
  // Flip rows so that +y is up.
  if (!flipMap || flipMap.length !== n * n) {
    flipMap = new Int32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) flipMap[j * n + i] = (n - 1 - j) * n + i;
  }
  const map = flipMap;
  const R = state.autoR * 10 ** -state.bright * (state.view === 'scattered' ? 0.5 : 1);
  colorize(re, im, img.data, R, state.display, map);
  ictx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(viewImage, 0, 0, width, height);
  if (state.show.potential && potentialImage) { ctx.globalAlpha = 0.55; ctx.drawImage(potentialImage, 0, 0, width, height); ctx.globalAlpha = 1; }
  // The absorbing border, and the detector.
  const s = width / state.L, cx = width / 2, cy = height / 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
  const inner = sim.inner * s;
  ctx.strokeRect(cx - inner, cy - inner, 2 * inner, 2 * inner);
  if (state.show.circle) {
    ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(cx, cy, detector.R * s, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '12px system-ui, sans-serif';
  ctx.fillText(state.view === 'scattered' ? 'scattered: ψ − ψ_inc' : 'ψ', 8, 16);
}

/** The crystal's lattice spacing c and its turn a (radians), if the target is the crystal. */
function crystalLattice() {
  return state.target.id === 'crystal' && Vparams.c > 0 ? { c: Vparams.c, a: (state.turn * Math.PI) / 180 } : null;
}

let momHalf = 0;   // the momentum picture shows |kx|, |ky| up to momHalf dk

function drawMomentum() {
  // Every other frame while running: the transform costs as much as a time step.  (The curves
  // and the arrows on it are drawn every time.)
  if (!(state.running && frames % 2) || !momCanvas) {
    const n = state.n;
    const [re, im] = state.view === 'scattered' ? scatteredGrid() : [Float64Array.from(sim.re), Float64Array.from(sim.im)];
    fft2Centered(re, im, n, n);
    // Show |k| up to 2.2 k0: a square of side 2 * 2.2 k0 / dk pixels around the centre.
    const dk = (2 * Math.PI) / state.L, half = Math.min(n / 2, Math.ceil((2.2 * state.k0) / dk));
    const m = 2 * half, sub = new Float64Array(m * m), subI = new Float64Array(m * m);
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
      const src = (n / 2 + half - 1 - j) * n + (n / 2 - half + i);
      sub[j * m + i] = re[src]; subI[j * m + i] = im[src];
    }
    if (!momCanvas || momCanvas.width !== m) { momCanvas = document.createElement('canvas'); momCanvas.width = momCanvas.height = m; }
    const c = momCanvas, cctx = c.getContext('2d'), img = cctx.createImageData(m, m);
    colorize(sub, subI, img.data, autoBrightness(sub, subI, 0.97) * 0.3, 'magnitude');
    cctx.putImageData(img, 0, 0);
    momHalf = half;
  }
  paintMomentum();
}

/**
 * dsigma/dtheta at the direction theta (radians) from a curve given at the detector's angles,
 * interpolated between them.
 */
function atAngle(curve, theta) {
  const M = detector.M, u = ((((theta / (2 * Math.PI)) * M) % M) + M) % M, j = Math.floor(u), f = u - j;
  return (1 - f) * curve[j % M] + f * curve[(j + 1) % M];
}

/**
 * The momentum picture and what is drawn on it: the energy circle |k| = k0; outside it, the
 * cross section for each direction of k as a distance out from the circle, measured (the flux
 * through the detector) and Born's, m^2 |V~(k - k0)|^2 / (2 pi hbar^4 k), on one scale; the
 * incident k0, a k on the circle at the chosen angle and the momentum transfer q = k - k0.
 */
function paintMomentum() {
  const cv = $('#momentum');
  const { ctx, width, height } = fitCanvas(cv);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(momCanvas, 0, 0, width, height);
  const dk = (2 * Math.PI) / state.L, half = momHalf, k0 = state.k0;
  // The energy shell |k| = k0, and the axes.
  const s = width / (2 * half * dk), cx = width / 2, cy = height / 2;
  const P = (kx, ky) => [cx + kx * s, cy - ky * s];
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(width, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, height); ctx.stroke();
  // The crystal's reciprocal lattice, G = (2 pi / c)(n1, n2) turned with the crystal, drawn from
  // the incident spot: k0 + G.  A wave k0 + G is allowed where it is also on the energy circle:
  // a Bragg beam (Ewald's construction).  Filled: within 2 pi / (the crystal's width, 7c) of the
  // circle, as sharp as so small a crystal can tell.
  const lat = crystalLattice();
  if (lat) {
    const g = (2 * Math.PI) / lat.c, ca = Math.cos(lat.a), sa = Math.sin(lat.a), lim = half * dk, near = Math.PI / (3.5 * lat.c);
    const nmax = Math.ceil((lim + k0) / g) + 1;
    for (let n1 = -nmax; n1 <= nmax; n1++) for (let n2 = -nmax; n2 <= nmax; n2++) {
      const kx = k0 + g * (n1 * ca - n2 * sa), ky = g * (n1 * sa + n2 * ca);
      if (Math.abs(kx) > lim || Math.abs(ky) > lim) continue;
      const on = Math.abs(Math.hypot(kx, ky) - k0) < near;
      ctx.beginPath(); ctx.arc(cx + kx * s, cy - ky * s, 3.5, 0, 2 * Math.PI);
      if (on) { ctx.fillStyle = 'rgba(255,210,80,0.9)'; ctx.fill(); } else { ctx.strokeStyle = 'rgba(140,200,255,0.8)'; ctx.lineWidth = 1.2; ctx.stroke(); }
    }
  }
  // dsigma/dtheta round the circle: a distance out from it in proportion, the larger curve's
  // peak 0.75 k0 out.  Elastic scattering puts the scattered wave on the circle, at each
  // direction of k as much as dsigma/dtheta sends there; Born says how much: the potential's
  // Fourier transform at k - k0.  Where a curve is less than a pixel out it is left out, so
  // as not to hide the circle.
  const curves = momentumCurves();
  if (curves.top > 0) {
    const th = detector.theta, M = detector.M, room = 0.75 * k0, px = 1 / s;
    for (const [vals, colour, dash, lw] of [[curves.born, 'rgba(205,206,212,0.95)', [5, 4], 1.4], [curves.measured, 'rgba(110,170,255,0.95)', [], 1.7]]) {
      if (!vals) continue;
      ctx.strokeStyle = colour; ctx.setLineDash(dash); ctx.lineWidth = lw;
      ctx.beginPath();
      let on = false;
      for (let a = 0; a <= M; a++) {
        const j = a % M, out = (room * Math.max(0, vals[j])) / curves.top;
        if (out < px) { on = false; continue; }
        const [x, y] = P((k0 + out) * Math.cos(th[j]), (k0 + out) * Math.sin(th[j]));
        if (on) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        on = true;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  // The energy circle over them.
  ctx.strokeStyle = 'rgba(255,210,80,0.8)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(cx, cy, k0 * s, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
  // k0, a k on the circle at the chosen angle, and the momentum transfer q = k - k0 between their tips.
  const t = (state.qAngle * Math.PI) / 180, kx = k0 * Math.cos(t), ky = k0 * Math.sin(t);
  const arrow = (x0, y0, x1, y1, colour, lw, head) => {
    const [a, b] = P(x0, y0), [c, d] = P(x1, y1), len = Math.hypot(c - a, d - b);
    if (len < 1) return;
    const ux = (c - a) / len, uy = (d - b) / len;
    ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c - ux * head * 0.8, d - uy * head * 0.8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c, d); ctx.lineTo(c - ux * head - uy * head * 0.45, d - uy * head + ux * head * 0.45);
    ctx.lineTo(c - ux * head + uy * head * 0.45, d - uy * head - ux * head * 0.45); ctx.closePath(); ctx.fill();
  };
  arrow(0, 0, k0, 0, 'rgba(255,255,255,0.75)', 1.2, 7);
  arrow(0, 0, kx, ky, 'rgba(255,255,255,0.75)', 1.2, 7);
  arrow(k0, 0, kx, ky, 'rgb(255,120,190)', 2, 9);
  ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // Each label beside the middle of its arrow, on the side away from the triangle's inside.
  const label = (text, mx, my, ox, oy, colour) => {
    const [x, y] = P(mx, my), n = Math.hypot(ox, oy) || 1;
    ctx.fillStyle = colour; ctx.fillText(text, x + (ox / n) * 10, y - (oy / n) * 10);
  };
  const qx = kx - k0, qy = ky, side = Math.sign(state.qAngle) || 1;
  if (Math.abs(state.qAngle) > 3) {
    label('q', k0 + qx / 2, qy / 2, qy * side, -qx * side, 'rgb(255,150,205)');
    label('k', kx / 2, ky / 2, -ky * side, kx * side, 'rgba(255,255,255,0.85)');
  }
  label('k₀', k0 / 2, 0, 0, -side, 'rgba(255,255,255,0.85)');
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '11px system-ui, sans-serif';
  ctx.fillText('kx →', width - 34, cy - 4); ctx.fillText('ky ↑', cx + 4, 12);
  ctx.fillText(`dashed: |k| = k₀ = ${fmt(state.k0, 3)}, the packet's energy`, 6, height - 6);
}

/** The curves drawn round the momentum circle: measured and Born's dsigma/dtheta, and the larger peak. */
function momentumCurves() {
  const measured = !state.target.extended && detector.fluence > 1e-6 ? detector.crossSection() : null;
  const b = state.target.extended ? null : born;
  let top = 0;
  for (const c of [measured, b]) if (c) for (const v of c) if (v > top) top = v;
  return { measured, born: b, top };
}

/** The readout under the momentum picture: the chosen angle, q there, and dsigma/dtheta measured and by Born. */
function qReadout() {
  const t = (state.qAngle * Math.PI) / 180, q = 2 * state.k0 * Math.abs(Math.sin(t / 2)), c = momentumCurves();
  const fig = (v) => (v === null ? '–' : !(v >= 0.0005) ? '0.000' : v >= 1000 ? v.toExponential(1).replace('e+', 'e') : v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : v >= 1 ? 2 : 3));
  const meas = c.measured ? atAngle(c.measured, t) : null, bornV = c.born ? atAngle(c.born, t) : null;
  setGroups($('#q-readout'), [
    ['angle θ ', { text: String(state.qAngle).replace('-', '−'), w: 4 }, '°,'],
    ['momentum transfer q = 2k₀ sin(θ/2) = ', { text: q.toFixed(3), w: 6 }, ';'],
    ['dσ/dθ there: measured ', { text: fig(meas), w: 6 }, ','],
    ['Born ', { text: fig(bornV), w: 6 }],
  ]);
  return { theta: state.qAngle, q, measured: meas, born: bornV };
}

// Point at the momentum picture (or drag a finger round it) to turn k round the circle.
{
  const cv = $('#momentum');
  const pick = (e) => {
    if (!momHalf) return;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left - r.width / 2, y = r.height / 2 - (e.clientY - r.top);
    const ring = (state.k0 * r.width) / (2 * momHalf * ((2 * Math.PI) / state.L));   // the circle's radius, CSS pixels
    if (Math.hypot(x, y) < 0.25 * ring) return;
    let a = Math.round((Math.atan2(y, x) * 180) / Math.PI);
    if (a === -180) a = 180;
    if (a !== state.qAngle) { state.qAngle = a; paintMomentum(); qReadout(); }
  };
  cv.addEventListener('pointermove', pick);
  cv.addEventListener('pointerdown', (e) => { pick(e); cv.setPointerCapture?.(e.pointerId); });
}

const COLORS = { flux: null, pw: '#e07b39', born: '#8a8b91', exact: '#2e9e5b', fraunhofer: '#e07b39', classical: '#9a6bd1' };

function drawCrossSection() {
  const cv = $('#xsec');
  const { ctx, width, height } = fitCanvas(cv);
  const c = themeColors();
  COLORS.flux = c.accent;
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 48, right: 8, top: 8, bottom: 32 });
  const th = detector.theta, M = th.length;

  const flux = detector.crossSection();
  const series = [];
  if (state.target.extended) { drawTransmitted(f, c); return; }
  if (detector.fluence > 1e-6) series.push(['flux', flux]);
  if (pwResult) series.push(['pw', pwResult.f.map(([a, b]) => a * a + b * b)]);
  if (born) series.push(['born', born]);
  if (exact) series.push(['exact', exact.pw.f.map(([a, b]) => a * a + b * b)]);
  if (classical) series.push(['classical', classical.dsdt]);
  if (warning) { ctx.save(); ctx.fillStyle = c.warn; ctx.font = '12px system-ui, sans-serif'; ctx.fillText(warning.split(':')[0], f.left + 6, f.top + 14); ctx.restore(); }
  // Log scale, from the largest value down five decades.
  let top = 0;
  for (const [, s] of series) for (let j = 0; j < M; j++) if (Number.isFinite(s[j])) top = Math.max(top, s[j]);
  if (!(top > 0)) { f.x0 = -180; f.x1 = 180; f.y0 = 0; f.y1 = 1; f.axes({ xlabel: 'θ (degrees)' }); return; }
  const lt = Math.ceil(Math.log10(top) + 0.2), lb = lt - 5;
  f.x0 = -180; f.x1 = 180; f.y0 = lb; f.y1 = lt;
  f.clip();
  for (const [key, s] of series) {
    ctx.strokeStyle = COLORS[key]; ctx.lineWidth = key === 'flux' ? 2 : key === 'classical' ? 1.2 : 1.6;
    ctx.setLineDash(key === 'flux' ? [] : key === 'exact' ? [2, 3] : key === 'classical' ? [3, 3] : [6, 4]);
    ctx.beginPath();
    let on = false;
    for (let a = 0; a <= M; a++) {
      const j = (a + M / 2) % M, d = -180 + (360 * a) / M; // from -180 to 180
      const v = s[j];
      if (!(v > 0)) { on = false; continue; }
      const x = f.X(d), y = f.Y(Math.log10(v));
      if (!on) { ctx.moveTo(x, y); on = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.restore();
  f.axes({ xlabel: 'θ (degrees)', ylabel: 'log₁₀ dσ/dθ' });
}

/**
 * Behind a wall there is no incident wave to subtract: what is measured is the flux of psi
 * itself through the half of the detector circle beyond the wall, the angles within 90 degrees
 * of its normal, against Fraunhofer's prediction.  The shapes are compared, each curve divided
 * by its largest value: how much gets through slits about a wavelength wide, with soft edges,
 * is beyond Kirchhoff's assumption (the table has the measured total).  On a linear scale, so
 * fringes look like fringes.
 */
function drawTransmitted(f, c) {
  const { ctx } = f, th = detector.theta, wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
  const pts = [];
  for (let j = 0; j < th.length; j++) {
    const d = wrap((th[j] * 180) / Math.PI - state.turn);
    if (Math.abs(d) <= 90) pts.push([state.turn + d, detector.fluence > 1e-6 ? detector.Ptot[j] : NaN, slit ? slit.dsdt[j] : NaN, slit?.blind[j]]);
  }
  pts.sort((p, q) => p[0] - q[0]);
  for (const col of [1, 2]) {
    let top = 0;
    for (const p of pts) if (Number.isFinite(p[col])) top = Math.max(top, p[col]);
    for (const p of pts) p[col] = top > 0 ? p[col] / top : NaN;
  }
  f.x0 = state.turn - 90; f.x1 = state.turn + 90; f.y0 = 0; f.y1 = 1.1;
  // Where the detector circle runs inside the wall, nothing can be measured.
  ctx.fillStyle = c.line;
  const step = 360 / th.length;
  for (const p of pts) if (p[3]) ctx.fillRect(f.X(p[0] - step / 2), f.top, f.X(p[0] + step / 2) - f.X(p[0] - step / 2) + 0.5, f.h);
  f.clip();
  for (const [key, col] of [['fraunhofer', 2], ['flux', 1]]) {
    ctx.strokeStyle = COLORS[key]; ctx.lineWidth = key === 'flux' ? 2 : 1.6;
    ctx.setLineDash(key === 'flux' ? [] : [6, 4]);
    ctx.beginPath();
    let on = false;
    for (const p of pts) {
      if (!Number.isFinite(p[col])) { on = false; continue; }
      const x = f.X(p[0]), y = f.Y(p[col]);
      if (!on) { ctx.moveTo(x, y); on = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.restore();
  f.axes({ xlabel: 'θ (degrees)', ylabel: 'dσ/dθ, relative' });
  // The ends of the range, the directions along the wall (unless a tick is labelled near them).
  const ticks = niceTicks(f.x0, f.x1, Math.max(2, Math.round(f.w / 80)));
  ctx.fillStyle = c.ink2; ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'top';
  for (const [d, align] of [[-90, 'left'], [90, 'right']]) {
    if (ticks.some((v) => Math.abs(v - state.turn - d) < 25)) continue;
    ctx.textAlign = align;
    ctx.fillText(String(Math.round(state.turn + d)).replace('-', '−'), f.X(state.turn + d), f.bottom + 6);
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

function drawWaves() {
  const cv = $('#waves');
  const { ctx, width, height } = fitCanvas(cv);
  const c = themeColors();
  ctx.clearRect(0, 0, width, height);
  const mmax = 12;
  const f = new Frame(ctx, width, height, { left: 34, right: 8, top: 8, bottom: 22 });
  f.x0 = -mmax - 0.5; f.x1 = mmax + 0.5; f.y0 = 0; f.y1 = 1.05;
  const bw = Math.max(2, (f.w / (2 * mmax + 1)) * 0.7);
  if (waves) {
    for (const w of waves) {
      if (Math.abs(w.m) > mmax) continue;
      const s2 = ((w.Sre - 1) ** 2 + w.Sim ** 2) / 4, x = f.X(w.m);
      ctx.fillStyle = c.accent;
      ctx.fillRect(x - bw / 2, f.Y(Math.min(1.05, s2)), bw, f.Y(0) - f.Y(Math.min(1.05, s2)));
      const S = Math.hypot(w.Sre, w.Sim);
      ctx.fillStyle = c.warn;
      ctx.beginPath(); ctx.arc(x, f.Y(Math.min(1.05, S)), 2.2, 0, 2 * Math.PI); ctx.fill();
    }
  }
  if (exact) {
    ctx.strokeStyle = COLORS.exact; ctx.lineWidth = 1.5;
    for (const w of exact.waves) {
      if (Math.abs(w.m) > mmax) continue;
      const s2 = ((w.Sre - 1) ** 2 + w.Sim ** 2) / 4, x = f.X(w.m), y = f.Y(s2);
      ctx.beginPath(); ctx.moveTo(x - bw / 2 - 1, y); ctx.lineTo(x + bw / 2 + 1, y); ctx.stroke();
    }
  }
  f.axes({ xlabel: '', yTicks: true, xTicks: false });
  ctx.fillStyle = c.ink2; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
  for (let m = -mmax; m <= mmax; m += 4) ctx.fillText(m === 0 ? 'm = 0' : String(m), f.X(m), f.bottom + 4 + 9);
  ctx.textAlign = 'left';
  if (state.target.extended || !round) {
    ctx.fillStyle = c.ink2;
    ctx.fillText(state.target.extended ? '(not for a target bigger than the detector)' : '(phase shifts are for round targets: this one mixes the m)', f.left + 8, f.top + 30);
  }
}

function updateReadouts() {
  qReadout();
  const inBox = boxNorm();
  // Each number in a slot of its own width, with fixed decimals: nothing moves as they change.
  $('#readouts').innerHTML = [
    ['time t', sim.t.toFixed(2), 6], ['momentum k₀', state.k0.toFixed(3), 5], ['wavelength λ', ((2 * Math.PI) / state.k0).toFixed(3), 6],
    ['energy E', packet.energy.toFixed(3), 6], ['probability in the box', inBox.toFixed(4), 6], ['time step', dt.toFixed(4), 6],
  ].map(([k, v, w]) => `<span class="ro">${k} <b style="width:${w}ch">${v}</b></span>`).join('')
    + `<span class="ro status">${finished ? '<b>done</b>: the packet has gone' : ''}</span>`
    + (warning ? `<span class="warning">${warning}</span>` : '');
  // Bragg's condition for the crystal's rows (turned by alpha from the beam) and columns.
  const lat = crystalLattice(), lam = (2 * Math.PI) / state.k0;
  $('#mom-note').textContent = lat ? `2c sin α/λ = ${(Math.abs(2 * lat.c * Math.sin(lat.a)) / lam).toFixed(2)} (rows), 2c cos α/λ = ${(Math.abs(2 * lat.c * Math.cos(lat.a)) / lam).toFixed(2)} (columns)`
    : 'the wave sorted by momentum ħk';
  // The table of total cross sections: the same rows from start to end (values to come shown
  // as such), so that nothing jumps as the measurements arrive.
  const dth = (2 * Math.PI) / detector.M, tot = detector.totals(), lit = detector.fluence > 1e-6;
  const rows = [];
  if (!state.target.extended) {
    rows.push(['scattered flux, ∫ dσ/dθ', lit ? tot.scattered : null], ['shadow: flux lost forward', lit ? tot.shadow : null]);
    if (round) rows.push(['partial waves, (1/k) Σ |S−1|²', pwResult ? pwResult.sigma : NaN], ['optical theorem, from f(0)', pwResult ? pwResult.optical : NaN]);
  }
  if (born) rows.push(['first Born approximation', born.reduce((s, v) => s + v * dth, 0)]);
  if (exact) rows.push(['exact: the radial equation', exact.pw.sigma]);
  if (classical) rows.push(['classical: the width it blocks, 2r', 2 * classical.r]);
  if (state.target.extended) {
    // Through the wall: the far half of the detector, and the openings' width.
    const half = (P) => P.reduce((s, v, j) => s + (Math.cos(detector.theta[j] - (state.turn * Math.PI) / 180) > 0 ? v * dth : 0), 0);
    rows.push(['through the wall, ∫ dσ/dθ', lit ? half(detector.Ptot) / detector.fluence : null]);
    if (slit) rows.push(['the openings\' width', slit.open]);
  }
  // The crystal: how much of the packet goes where the rows (turned by alpha) and the columns
  // would mirror it, 2 alpha and 2 alpha - 180 degrees.
  if (lat) {
    rows.push(['share of the packet sent to 2α ± 15° (rows)', lit ? braggShare(2 * state.turn, 15) : null],
      ['… to 2α − 180° ± 15° (columns)', lit ? braggShare(2 * state.turn - 180, 15) : null]);
  }
  const num = (v) => (v === null ? '…' : Number.isNaN(v) ? 'at the end' : (Math.abs(v) < 5e-4 ? 0 : v).toFixed(3).replace('-', '−'));
  $('#sigmas').innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${num(v)}</td></tr>`).join('')
    + (rows.length ? '<tr><td colspan="2" class="muted">σ is a length in 2D'
      + (wideTarget && !state.target.extended ? '; the beam lights only part of this target, so its totals depend on the beam' : '') + '</td></tr>' : '');
  const legend = state.target.extended ? [['flux', 'measured'], ['fraunhofer', 'Fraunhofer']]
    : [['flux', 'measured'], ...(round ? [['pw', 'partial waves at k₀']] : []), ['born', 'Born']];
  if (exact) legend.push(['exact', 'exact at k₀']);
  if (classical) legend.push(['classical', 'classical']);
  $('#xs-legend').innerHTML = legend.filter(([k]) => k !== 'born' || born).map(([k, l]) => `<span><i style="border-color:${COLORS[k] || themeColors().accent}${k === 'flux' ? '' : ';border-top-style:dashed'}"></i>${l}</span>`).join('');
}

/** The probability scattered through the detector within half degrees of the direction centre. */
function braggShare(centre, half) {
  const dth = (2 * Math.PI) / detector.M;
  let s = 0;
  for (let j = 0; j < detector.M; j++) {
    const d = (((((detector.theta[j] * 180) / Math.PI - centre) % 360) + 540) % 360) - 180;
    if (Math.abs(d) <= half) s += detector.Psc[j] * dth;
  }
  return s;
}

function boxNorm() {
  const n = state.n, lay = sim.layer;
  let s = 0;
  for (let j = lay; j < n - lay; j++) for (let i = lay; i < n - lay; i++) s += sim.re[j * n + i] ** 2 + sim.im[j * n + i] ** 2;
  return s * sim.dx * sim.dx;
}

// --------------------------------------------------------------------- controls

$('#play').addEventListener('click', () => { if (finished) { restart(); } setRunning(!state.running || finished); });
$('#restart').addEventListener('click', () => { restart(); kick(); });
const speedSlider = slider({ label: 'Speed', min: 0.2, max: 20, log: true, value: state.speed, title: 'Simulated time per second (as fast as the computer allows)',
  onInput: (v) => { state.speed = v; } });
$('#speed-box').append(speedSlider);

const targetButtons = {};
for (const t of TARGETS) {
  // A new target starts square to the beam.
  const b = el('button', { type: 'button', 'aria-pressed': 'false', onclick: () => { state.turn = 0; turnSlider.value = 0; chooseTarget(t); } }, t.label);
  $('#targets').append(b);
  targetButtons[t.id] = b;
}
const vField = exprField({
  label: '<math><mi>V</mi><mo>(</mo><mi>x</mi><mo>,</mo><mi>y</mi><mo>)</mo><mo>=</mo></math>',
  value: state.target.V, variables: ['x', 'y', 'r', 'theta'],
  hints: { V0: { min: -5, max: 20, value: 2 }, a: { min: 0.2, max: 4, value: 1 }, w: { min: 0.05, max: 1, value: 0.25 },
    Z: { min: -3, max: 3, value: 1 }, l: { min: 0.5, max: 10, value: 4 }, d: { min: 0, max: 12, value: 5 }, c: { min: 1, max: 5, value: 2.5 }, s: { min: 0.1, max: 1, value: 0.3 } },
  onChange: (expr, params) => {
    Vexpr = expr; Vparams = params;
    // A formula of one's own is a typed target: the preset's notes no longer apply.
    if (expr.source !== state.target.V && state.target.id !== 'typed') {
      state.target = { ...byId('typed'), V: expr.source, params };
      for (const [id, b] of Object.entries(targetButtons)) b.setAttribute('aria-pressed', String(id === 'typed'));
    }
    restartSoon();
  },
});
$('#v-field').append(vField);
// Turning the target in a fixed beam is the same as sending the packet in from another
// direction (and it is how a diffractometer does it); theta stays the scattering angle.
const turnSlider = slider({ label: 'turn (°)', min: -90, max: 90, step: 0.5, value: state.turn,
  title: 'Turn the target anticlockwise about the origin, in degrees: the same as sending the packet in from another direction',
  onInput: (v) => { state.turn = clampTo('turn', v); if (state.turn !== v) turnSlider.value = state.turn; restartSoon(); } });
$('#turn-box').append(turnSlider);

let restartTimer = 0;
function restartSoon() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => { const run = state.running; restart(); setRunning(run); }, 120);
}

function chooseTarget(t, { run = true } = {}) {
  state.target = t;
  for (const [id, b] of Object.entries(targetButtons)) b.setAttribute('aria-pressed', String(id === t.id));
  vField.set(t.V, t.params, false);
  Vexpr = vField.expr; Vparams = vField.params;
  restart();
  setRunning(run);
}

// The packet.
// Typed values can be anything: keep them where the simulation makes sense.
const LIMITS = { k0: [0.3, 6], sy: [0.5, 20], sx: [0.5, 10], b: [-20, 20], L: [32, 128], turn: [-180, 180] };
const clampTo = (k, v) => Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], v));
const packetSlider = (k, opts) => {
  const sl = slider({ ...opts, value: state[k], onInput: (v) => { state[k] = clampTo(k, v); if (state[k] !== v) sl.value = state[k]; restartSoon(); } });
  return sl;
};
const packetSliders = {
  k0: packetSlider('k0', { label: '<math><msub><mi>k</mi><mn>0</mn></msub></math>', labelHTML: true, min: 0.5, max: 4, title: 'The momentum (and wavenumber) of the packet: λ = 2π/k₀' }),
  sy: packetSlider('sy', { label: 'width', min: 1, max: 10, title: 'The width of the beam across its direction (σ of |ψ|²): wide is plane-wave-like' }),
  sx: packetSlider('sx', { label: 'length', min: 1, max: 5, title: 'The length of the packet along its direction: longer means a narrower spread of energies' }),
  b: packetSlider('b', { label: '<math><mi>b</mi></math>', labelHTML: true, min: -10, max: 10, title: 'The impact parameter: how far off centre the packet is aimed' }),
};
$('#packet-box').append(...Object.values(packetSliders));

// What to show.
const viewSeg = segmented([
  { value: 'total', label: 'ψ', title: 'The whole wave function' },
  { value: 'scattered', label: 'Scattered only', title: 'ψ − ψ_inc: the difference the target makes' },
], state.view, (v) => { state.view = v; kick(); }, { label: 'View' });
const displaySeg = segmented([
  { value: 'complex', label: 'Phase', title: 'Colour is the phase, brightness the magnitude' },
  { value: 'intensity', label: '|ψ|²', title: 'Probability density, in grey' },
], state.display, (v) => { state.display = v; kick(); }, { label: 'Colours' });
$('#view-mode').append(viewSeg, displaySeg);
$('#shows').append(
  toggle('Detector', state.show.circle, (on) => { state.show.circle = on; kick(); }, 'The circle where the scattered wave is measured'),
  toggle('Potential', state.show.potential, (on) => { state.show.potential = on; kick(); }, 'Draw the potential (white: repulsive, blue: attractive)'),
);
$('#bright-box').append(slider({ label: 'Brightness', min: -1.5, max: 1.5, value: 0, step: 0.01, onInput: (v) => { state.bright = v; kick(); } }));

// The grid.
const gridSeg = segmented([128, 256, 512].map((n) => ({ value: n, label: `${n}²`, title: n === 512 ? 'Finer but four times slower' : n === 128 ? 'Coarser and four times faster' : 'The default' })),
  state.n, (n) => { state.n = n; restart(); kick(); }, { label: 'Grid' });
const boxSlider = slider({ label: 'box', min: 32, max: 128, step: 16, value: state.L, title: 'The side of the square simulated (the absorbing border is a tenth of it on each side, or more for slow packets)',
  onInput: (v) => { state.L = clampTo('L', v); if (state.L !== v) boxSlider.value = state.L; restartSoon(); } });
$('#grid-box').append(gridSeg, boxSlider, el('div', { class: 'small muted' }, 'Units: ħ = m = 1.  A finer grid follows sharper potentials and faster packets.'));

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ') { e.preventDefault(); $('#play').click(); }
  else if (e.key === 'r' || e.key === 'R') { restart(); kick(); }
});
window.addEventListener('resize', () => kick());

// --------------------------------------------------------------------- experiments

const byId = (id) => TARGETS.find((t) => t.id === id);
function go(id, { k0 = 2, sy = 6, sx = 2.5, b = 0, turn = 0, view = 'total', params, speed = 4, L = 64, angle = 60 } = {}) {
  Object.assign(state, { k0, sy, sx, b, turn, view, speed, L, qAngle: angle });
  boxSlider.value = L; turnSlider.value = turn;
  packetSliders.k0.value = k0; packetSliders.sy.value = sy; packetSliders.sx.value = sx; packetSliders.b.value = b;
  viewSeg.value = view; speedSlider.value = speed;
  const t = byId(id);
  chooseTarget(params ? { ...t, params: { ...t.params, ...params } } : t, { run: false });
  setRunning(true);
}
const setups = {
  disk: () => go('disk'),
  shadow: () => go('disk', { view: 'scattered' }),
  classical: () => go('disk', { k0: 3, sy: 8, params: { V0: 15, a: 2.5, w: 0.15 } }),
  born: () => go('bump'),
  ring: () => go('bump', { view: 'scattered' }),
  swave: () => go('disk', { k0: 0.8, sx: 3, sy: 8, L: 112, params: { a: 1, w: 0.2 }, speed: 6 }),
  resonance: () => go('well', { k0: 1.2, sx: 3, sy: 7 }),
  coulomb: () => go('coulomb', { k0: 2 }),
  two: () => go('two', { sy: 8 }),
  slits: () => go('slits', { sy: 8, sx: 2 }),
  crystal: () => go('crystal', { k0: Math.PI, sy: 3, sx: 2.2, turn: 30 }),
  offbragg: () => go('crystal', { k0: Math.PI, sy: 3, sx: 2.2, turn: 20, angle: 40 }),
  impact: () => go('disk', { sy: 1.5, b: 1.5 }),
  typed: () => go('typed'),
};
drawer($('#help'), $('#help-button'), setups);

// --------------------------------------------------------------------- start

const hash = readHash();
if (setups[hash.setup]) setups[hash.setup]();
else {
  const t = byId(hash.target) || TARGETS[0];
  try {
    for (const k of ['k0', 'sy', 'sx', 'b', 'turn']) if (hash[k] !== undefined && Number.isFinite(+hash[k])) { state[k] = clampTo(k, +hash[k]); (packetSliders[k] || turnSlider).value = state[k]; }
    if ([128, 256, 512].includes(+hash.n)) { state.n = +hash.n; gridSeg.value = state.n; }
    if (+hash.L >= 32 && +hash.L <= 128) { state.L = +hash.L; boxSlider.value = state.L; }
    const typed = hash.V || hash.p ? { ...t, V: hash.V || t.V, params: hash.p ? JSON.parse(hash.p) : t.params } : t;
    chooseTarget(typed, { run: true });
  } catch { chooseTarget(t, { run: true }); }
}

window.__app = { state, get sim() { return sim; }, get detector() { return detector; }, get packet() { return packet; }, get pw() { return pwResult; },
  get waves() { return waves; }, get exact() { return exact; }, get born() { return born; }, get slit() { return slit; }, get finished() { return finished; },
  get tEnd() { return tEnd; }, get dt() { return dt; }, get classical() { return classical; }, q: () => qReadout(), setAngle: (deg) => { state.qAngle = Math.round(deg); if (sim) paintMomentum(); return qReadout(); },
  momentumCurves, setups, restart, runUntil, ready: true, parse };
