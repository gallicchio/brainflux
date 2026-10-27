// The 2D scattering demo: a packet, a target, and the scattering theory measured as it goes.

import { Sim2D, Packet, Detector, fromPartialWaves, bornCrossSection, hardDiskWaves, preparePotential2D } from './sim.js';
import { fft2Centered } from '../lib/fft.js';
import { colorize, autoBrightness } from '../lib/complexcolor.js';
import { parse } from '../lib/expr.js';
import { el, $, slider, segmented, toggle, exprField, drawer, readHash, writeHash, fmt } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors } from '../lib/plot.js';

// The targets: typed potentials in x, y, r, theta, with their parameters.
const TARGETS = [
  { id: 'disk', label: 'Hard disk', V: 'V0/(1 + exp((r - a)/w))', params: { V0: 8, a: 1.5, w: 0.25 }, hardDisk: true },
  { id: 'bump', label: 'Weak bump', V: 'V0 exp(-r^2/(2 a^2))', params: { V0: 0.3, a: 1 } },
  { id: 'well', label: 'Attractive well', V: '-V0/(1 + exp((r - a)/w))', params: { V0: 2.5, a: 2, w: 0.25 } },
  { id: 'coulomb', label: 'Screened Coulomb', V: 'Z exp(-r/l)/sqrt(r^2 + 0.25)', params: { Z: 1, l: 4 } },
  { id: 'two', label: 'Two disks', V: 'V0/(1 + exp((sqrt(x^2 + (y-d/2)^2) - a)/w)) + V0/(1 + exp((sqrt(x^2 + (y+d/2)^2) - a)/w))', params: { V0: 8, a: 0.7, w: 0.2, d: 5 } },
  { id: 'slits', label: 'Double slit', V: 'V0 (abs(x) < 0.4) (abs(abs(y) - d/2) > a/2)', params: { V0: 12, d: 5, a: 1.2 }, extended: true },
  { id: 'crystal', label: 'Crystal', V: 'V0 exp(-((x - c round(x/c))^2 + (y - c round(y/c))^2)/(2 s^2)) (abs(x) < 5.5) (abs(y) < 5.5)', params: { V0: 1.5, c: 2.5, s: 0.3 } },
  { id: 'typed', label: 'Typed', V: 'V0 (abs(x) < a) (abs(y) < a)', params: { V0: 3, a: 1 } },
];

const state = {
  target: TARGETS[0],
  n: 256, L: 64,
  k0: 2, sy: 6, sx: 2.5, b: 0,
  view: 'total',          // 'total' | 'scattered'
  display: 'complex',     // 'complex' | 'intensity'
  bright: 0,
  show: { circle: true, potential: true },
  running: false,
  speed: 4,
};

let sim, packet, detector, Vexpr, Vparams = {};
let dt = 0.05, born = null, exact = null, waves = null, pwResult = null;
let finished = false, tEnd = 30, potentialImage = null;

// --------------------------------------------------------------------- set-up

function evalPotential() {
  const n = state.n, N = n * n;
  const x = new Float64Array(N), y = new Float64Array(N), r = new Float64Array(N), th = new Float64Array(N);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, xv = sim.coord[i], yv = sim.coord[j];
    x[k] = xv; y[k] = yv; r[k] = Math.hypot(xv, yv); th[k] = Math.atan2(yv, xv);
  }
  const v = Vexpr.evaluate({ x, y, r, theta: th, ...Vparams }, N).re;
  const V = new Float64Array(N);
  for (let i = 0; i < N; i++) V[i] = Number.isFinite(v[i]) ? Math.max(-1e4, Math.min(1e4, v[i])) : 0;
  return V;
}

/** The detector radius: as large as fits inside the absorbing border with room to spare. */
function detectorRadius() { return Math.max(6, Math.min(18, sim.inner - 6)); }

function restart() {
  if (!sim || sim.n !== state.n || sim.L !== state.L) sim = new Sim2D({ n: state.n, L: state.L });
  const raw = evalPotential();
  const prep = preparePotential2D(raw, state.n, sim.dx);
  sim.setPotential(prep.V);
  sim.absorbSpeed = state.k0 + 4 / state.sx;
  // The packet starts clear of the target and of the absorbing border.
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
  tEnd = (Math.abs(x0) + R + 4 * state.sx) / (state.k0 - 2 / (2 * state.sx)) + 6;
  finished = false;
  // Born and, for the hard disk, the exact answer (radius where V crosses E, roughly).
  const th = Array.from(detector.theta);
  born = state.target.extended ? null : bornCrossSection(sim, state.k0, th);
  exact = null;
  if (state.target.hardDisk && Vparams.V0 > E) {
    const a = Vparams.a + Vparams.w * Math.log(Vparams.V0 / E - 1);
    exact = { a, pw: fromPartialWaves(hardDiskWaves(state.k0, a, 30), state.k0, th) };
  }
  waves = null; pwResult = null;
  potentialImage = makePotentialImage(prep.V);
  autoBright();
  draw();
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
      if (sim.t >= tEnd) { finished = true; setRunning(false); break; }
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

function analyse() {
  // A wall that runs out past the detector is not a localised target: no cross section.
  if (state.target.extended) { waves = null; pwResult = null; return; }
  const k = state.k0;
  waves = detector.partialWaves(k, 24, packet);
  if (waves) pwResult = fromPartialWaves(waves, k, Array.from(detector.theta));
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

function drawMomentum() {
  // Every other frame while running: the transform costs as much as a time step.
  if (state.running && frames % 2) return;
  const cv = $('#momentum');
  const { ctx, width, height } = fitCanvas(cv);
  const n = state.n;
  const [re, im] = state.view === 'scattered' ? scatteredGrid() : [Float64Array.from(sim.re), Float64Array.from(sim.im)];
  fft2Centered(re, im, n, n);
  // Show |k| up to 2.2 k0: a square of side 2 * 2.2 k0 / dk pixels around the centre.
  const dk = (2 * Math.PI) / state.L, half = Math.min(n / 2, Math.ceil((2.2 * state.k0) / dk));
  const m = 2 * half, sub = new Float64Array(m * m), subI = new Float64Array(m * m), map = new Int32Array(m * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const src = (n / 2 + half - 1 - j) * n + (n / 2 - half + i);
    sub[j * m + i] = re[src]; subI[j * m + i] = im[src]; map[j * m + i] = j * m + i;
  }
  if (!momCanvas || momCanvas.width !== m) { momCanvas = document.createElement('canvas'); momCanvas.width = momCanvas.height = m; }
  const c = momCanvas, cctx = c.getContext('2d'), img = cctx.createImageData(m, m);
  colorize(sub, subI, img.data, autoBrightness(sub, subI, 0.97) * 0.3, 'magnitude');
  cctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(c, 0, 0, width, height);
  // The energy shell |k| = k0, and the axes.
  const s = width / (2 * half * dk), cx = width / 2, cy = height / 2;
  ctx.strokeStyle = 'rgba(255,210,80,0.8)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(cx, cy, state.k0 * s, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(width, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, height); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '11px system-ui, sans-serif';
  ctx.fillText('kx →', width - 34, cy - 4); ctx.fillText('ky ↑', cx + 4, 12);
  ctx.fillText(`|k| = k₀ = ${fmt(state.k0, 3)}`, 6, height - 6);
}

const COLORS = { flux: null, pw: '#e07b39', born: '#8a8b91', exact: '#2e9e5b' };

function drawCrossSection() {
  const cv = $('#xsec');
  const { ctx, width, height } = fitCanvas(cv);
  const c = themeColors();
  COLORS.flux = c.accent;
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 48, right: 8, top: 8, bottom: 32 });
  const th = detector.theta, M = th.length;
  const deg = (j) => { let d = (th[j] * 180) / Math.PI; if (d > 180) d -= 360; return d; };
  const flux = detector.crossSection();
  const series = [];
  if (state.target.extended) {
    f.x0 = -180; f.x1 = 180; f.y0 = 0; f.y1 = 1;
    f.axes({ xlabel: 'θ (degrees)', yTicks: false });
    ctx.fillStyle = c.ink2; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('The wall runs out past the detector circle,', f.left + f.w / 2, f.top + f.h / 2 - 8);
    ctx.fillText('so there is no cross section to measure: watch the fringes.', f.left + f.w / 2, f.top + f.h / 2 + 10);
    ctx.textAlign = 'left';
    return;
  }
  if (detector.fluence > 1e-6) series.push(['flux', flux]);
  if (pwResult) series.push(['pw', pwResult.f.map(([a, b]) => a * a + b * b)]);
  if (born) series.push(['born', born]);
  if (exact) series.push(['exact', exact.pw.f.map(([a, b]) => a * a + b * b)]);
  // Log scale, from the largest value down five decades.
  let top = 0;
  for (const [, s] of series) for (let j = 0; j < M; j++) if (Number.isFinite(s[j])) top = Math.max(top, s[j]);
  if (!(top > 0)) { f.x0 = -180; f.x1 = 180; f.y0 = 0; f.y1 = 1; f.axes({ xlabel: 'θ (degrees)' }); return; }
  const lt = Math.ceil(Math.log10(top) + 0.2), lb = lt - 5;
  f.x0 = -180; f.x1 = 180; f.y0 = lb; f.y1 = lt;
  f.clip();
  for (const [key, s] of series) {
    ctx.strokeStyle = COLORS[key]; ctx.lineWidth = key === 'flux' ? 2 : 1.6;
    ctx.setLineDash(key === 'flux' ? [] : key === 'exact' ? [2, 3] : [6, 4]);
    ctx.beginPath();
    let on = false;
    for (let a = 0; a <= M; a++) {
      const j = (a + M / 2) % M; // from -180 to 180
      const v = s[j], d = a === M ? 180 : deg(j);
      if (!(v > 0)) { on = false; continue; }
      const x = f.X(d), y = f.Y(Math.log10(v));
      if (!on) { ctx.moveTo(x, y); on = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.restore();
  f.axes({ xlabel: 'θ (degrees)', ylabel: 'log₁₀ dσ/dθ' });
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
    const hd = hardDiskWaves(state.k0, exact.a, mmax);
    for (const w of hd) {
      const s2 = ((w.Sre - 1) ** 2 + w.Sim ** 2) / 4, x = f.X(w.m), y = f.Y(s2);
      ctx.beginPath(); ctx.moveTo(x - bw / 2 - 1, y); ctx.lineTo(x + bw / 2 + 1, y); ctx.stroke();
    }
  }
  f.axes({ xlabel: '', yTicks: true, xTicks: false });
  ctx.fillStyle = c.ink2; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
  for (let m = -mmax; m <= mmax; m += 4) ctx.fillText(m === 0 ? 'm = 0' : String(m), f.X(m), f.bottom + 4 + 9);
  ctx.textAlign = 'left';
  if (state.target.extended) {
    ctx.fillStyle = c.ink2; ctx.fillText('(not for a target bigger than the detector)', f.left + 8, f.top + 30);
  }
}

function updateReadouts() {
  const inBox = boxNorm();
  $('#readouts').innerHTML = [
    ['t', sim.t.toFixed(2)], ['k₀', fmt(state.k0, 3)], ['λ', fmt((2 * Math.PI) / state.k0, 3)],
    ['E', fmt(packet.energy, 3)], ['in the box', fmt(inBox, 3)], ['time step', fmt(dt, 2)],
  ].map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join('') + (finished ? '<span><b>done</b>: the packet has gone</span>' : '');
  // The table of total cross sections.
  const dth = (2 * Math.PI) / detector.M, tot = detector.totals();
  const rows = [];
  if (detector.fluence > 1e-6 && !state.target.extended) {
    rows.push(['scattered flux, ∫ dσ/dθ', tot.scattered], ['shadow: flux lost forward', tot.shadow]);
  }
  if (pwResult) rows.push(['partial waves, (1/k) Σ |S−1|²', pwResult.sigma], ['optical theorem, from f(0)', pwResult.optical]);
  else if (!state.target.extended && detector.fluence > 1e-6) rows.push(['partial waves and optical theorem', NaN]);
  if (born) rows.push(['first Born approximation', born.reduce((s, v) => s + v * dth, 0)]);
  if (exact) rows.push([`exact hard disk, a = ${fmt(exact.a, 3)}`, exact.pw.sigma]);
  $('#sigmas').innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${Number.isNaN(v) ? 'when the packet has gone' : fmt(v, 4)}</td></tr>`).join('')
    + (rows.length ? '<tr><td colspan="2" class="muted">σ is a length in 2D</td></tr>' : '');
  const legend = [['flux', 'measured'], ['pw', '|f|² at k₀'], ['born', 'Born']];
  if (exact) legend.push(['exact', 'hard disk']);
  $('#xs-legend').innerHTML = legend.filter(([k]) => k !== 'born' || born).map(([k, l]) => `<span><i style="border-color:${COLORS[k] || themeColors().accent}${k === 'flux' ? '' : ';border-top-style:dashed'}"></i>${l}</span>`).join('');
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
  const b = el('button', { type: 'button', 'aria-pressed': 'false', onclick: () => chooseTarget(t) }, t.label);
  $('#targets').append(b);
  targetButtons[t.id] = b;
}
const vField = exprField({
  label: '<math><mi>V</mi><mo>(</mo><mi>x</mi><mo>,</mo><mi>y</mi><mo>)</mo><mo>=</mo></math>',
  value: state.target.V, variables: ['x', 'y', 'r', 'theta'],
  hints: { V0: { min: -5, max: 20, value: 2 }, a: { min: 0.2, max: 4, value: 1 }, w: { min: 0.05, max: 1, value: 0.25 },
    Z: { min: -3, max: 3, value: 1 }, l: { min: 0.5, max: 10, value: 4 }, d: { min: 0, max: 12, value: 5 }, c: { min: 1, max: 5, value: 2.5 }, s: { min: 0.1, max: 1, value: 0.3 } },
  onChange: (expr, params) => { Vexpr = expr; Vparams = params; restartSoon(); },
});
$('#v-field').append(vField);

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
  writeHash({ target: t.id });
}

// The packet.
const packetSliders = {
  k0: slider({ label: '<math><msub><mi>k</mi><mn>0</mn></msub></math>', labelHTML: true, min: 0.5, max: 4, value: state.k0, title: 'The momentum (and wavenumber) of the packet: λ = 2π/k₀',
    onInput: (v) => { state.k0 = v; restartSoon(); } }),
  sy: slider({ label: 'width', min: 1, max: 10, value: state.sy, title: 'The width of the beam across its direction (σ of |ψ|²): wide is plane-wave-like',
    onInput: (v) => { state.sy = v; restartSoon(); } }),
  sx: slider({ label: 'length', min: 1, max: 5, value: state.sx, title: 'The length of the packet along its direction: longer means a narrower spread of energies',
    onInput: (v) => { state.sx = v; restartSoon(); } }),
  b: slider({ label: '<math><mi>b</mi></math>', labelHTML: true, min: -10, max: 10, value: state.b, title: 'The impact parameter: how far off centre the packet is aimed',
    onInput: (v) => { state.b = v; restartSoon(); } }),
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
const boxSlider = slider({ label: 'box', min: 32, max: 128, step: 16, value: state.L, title: 'The side of the square simulated (the absorbing border is a tenth of it on each side)',
  onInput: (v) => { state.L = v; restartSoon(); } });
$('#grid-box').append(gridSeg, boxSlider, el('div', { class: 'small muted' }, 'Units: ħ = m = 1.  A finer grid follows sharper potentials and faster packets.'));

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ') { e.preventDefault(); $('#play').click(); }
  else if (e.key === 'r' || e.key === 'R') { restart(); kick(); }
});
window.addEventListener('resize', () => kick());

// --------------------------------------------------------------------- experiments

const byId = (id) => TARGETS.find((t) => t.id === id);
function go(id, { k0 = 2, sy = 6, sx = 2.5, b = 0, view = 'total', params, speed = 4 } = {}) {
  Object.assign(state, { k0, sy, sx, b, view, speed });
  packetSliders.k0.value = k0; packetSliders.sy.value = sy; packetSliders.sx.value = sx; packetSliders.b.value = b;
  viewSeg.value = view; speedSlider.value = speed;
  const t = byId(id);
  chooseTarget(params ? { ...t, params: { ...t.params, ...params } } : t, { run: false });
  setRunning(true);
}
const setups = {
  disk: () => go('disk'),
  shadow: () => go('disk', { view: 'scattered' }),
  born: () => go('bump'),
  ring: () => go('bump', { params: { V0: 0.6 } }),
  swave: () => go('disk', { k0: 0.8, sx: 3, sy: 8, params: { a: 1, w: 0.2 } }),
  resonance: () => go('well', { k0: 1.2, sx: 3, sy: 7 }),
  coulomb: () => go('coulomb', { k0: 2 }),
  two: () => go('two', { sy: 8 }),
  slits: () => go('slits', { sy: 8, sx: 2 }),
  crystal: () => go('crystal', { k0: 2.5, sy: 8, sx: 3 }),
  impact: () => go('disk', { sy: 1.5, b: 1.5 }),
  typed: () => go('typed'),
};
drawer($('#help'), $('#help-button'), setups);

// --------------------------------------------------------------------- start

const hash = readHash();
if (setups[hash.setup]) setups[hash.setup]();
else { chooseTarget(byId(hash.target) || TARGETS[0], { run: true }); }

window.__app = { state, get sim() { return sim; }, get detector() { return detector; }, get pw() { return pwResult; }, get born() { return born; },
  get finished() { return finished; }, setups, restart, ready: true, parse };
