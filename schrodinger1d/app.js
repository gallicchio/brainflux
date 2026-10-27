// The 1D Schrödinger demo: choose a potential and an initial state, press Play.

import { Sim1D, eigenstates, prepareSharpPotential } from './sim.js';
import { POTENTIALS, PACKET } from './presets.js';
import { parse } from '../lib/expr.js';
import { el, $, slider, segmented, toggle, exprField, drawer, toast, readHash, writeHash, fmt } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors } from '../lib/plot.js';
import { colorOf, colorize, drawWheel } from '../lib/complexcolor.js';

// ----------------------------------------------------------------------------- state

const state = {
  pot: POTENTIALS[2],
  init: null,                 // the initial state, as in presets.js
  view: 'density',
  show: { levels: true, classical: true, momentum: true, carpet: true },
  running: false,
  direction: 1,
  speed: 1,                   // simulated time per second
  domain: [-10, 10], n: 1024, boundary: 'walls', mass: 1,
};

let sim = null;
let Vexpr = null, Vparams = {}, Vdynamic = false;
let shownV = null;            // V as typed (cell-averaged), for drawing: the simulation uses a
                              // version with its sharpest edges softened (prepareSharpPotential)
let levels = [];              // [{E, psi}], the stationary states (of V at t = 0 if V changes)
let shownLevels = [];         // the ones drawn: bound states, or all of them between walls
let dtMax = 0.01;
let maxSteps = 400;           // per frame, to keep the page responsive
let classical = null;         // {x, p, alive}
let scale = { density: 1, amplitude: 1, momentum: 1, current: 1e-6 };
let started = false;          // has the clock run since the last restart?
let slowed = false;           // could not keep up with the requested speed
let frames = 0, slowFrames = 0;
let errorText = '';
let lastE = 0;                // <E>, for choosing the time step
let dtCal = 0.02;             // the step that conserved energy in a trial run (see calibrateStep)

const PHASE_COLORS = Array.from({ length: 360 }, (_, i) => {
  const a = (i * Math.PI) / 180;
  return `rgb(${colorOf(Math.cos(a), Math.sin(a), 1).join(',')})`;
});
const phaseColor = (re, im) => PHASE_COLORS[(Math.round((Math.atan2(im, re) * 180) / Math.PI) + 360) % 360];

// ------------------------------------------------------------------- the potential

// A static potential is averaged over each grid cell (8 samples), so that a sharp edge falls
// where it was typed, to a sixteenth of a cell, whatever the grid; a time-dependent one is
// sampled at the points, being evaluated every step.
const SUB = 8;
let subX = null;
function evalV(t) {
  const n = sim.n, sub = Vdynamic ? 1 : SUB;
  let xs = sim.x;
  if (sub > 1) {
    if (!subX || subX.length !== n * sub || subX.x0 !== sim.x[0] || subX.dx !== sim.dx) {
      subX = new Float64Array(n * sub);
      for (let j = 0; j < n; j++) for (let s = 0; s < sub; s++) subX[j * sub + s] = sim.x[j] + ((s + 0.5) / sub - 0.5) * sim.dx;
      subX.x0 = sim.x[0]; subX.dx = sim.dx;
    }
    xs = subX;
  }
  const v = Vexpr.evaluate({ x: xs, t, m: state.mass, ...Vparams }, n * sub).re;
  const clean = (y) => (Number.isFinite(y) ? Math.max(-1e6, Math.min(1e6, y)) : Number.isNaN(y) ? 0 : Math.sign(y) * 1e6);
  const out = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    let a = 0;
    for (let s = 0; s < sub; s++) a += clean(v[j * sub + s]);
    out[j] = a / sub;
  }
  shownV = out;
  // Sharp edges are made fit for the method: see prepareSharpPotential.
  return prepareSharpPotential(out, sim.dx, { kc: state.pot.kc || 16 });
}

function applyPotential({ keepState }) {
  if (!sim || !Vexpr) return;
  Vdynamic = Vexpr.uses('t');
  subX = null;
  const V = evalV(keepState ? sim.t : 0);
  sim.setPotential(V);
  computeLevels(V);
}

function computeLevels(V) {
  const n = sim.n, walls = state.boundary === 'walls';
  const [lo, hi] = state.pot.erange || potentialRange();
  levels = eigenstates(V, sim.dx, state.mass, 60, {
    first: walls ? 1 : 0, last: n - 1, maxE: hi + 2 * (hi - lo),
  });
  // Between walls every state counts; otherwise only the bound ones (below both ends of V).
  const edge = Math.min(V[0], V[n - 1]);
  shownLevels = state.pot.noLevels ? [] : walls ? levels : levels.filter((s) => s.E < edge - 1e-9);
}

// A typed potential's energy range: from its minimum to a few times the spread of its middle.
function potentialRange() {
  const V = sim.V;
  let lo = Infinity;
  for (let j = 0; j < V.length; j++) lo = Math.min(lo, V[j]);
  const sorted = Float64Array.from(V).sort();
  const mid = sorted[Math.floor(sorted.length * 0.5)];
  return [lo, lo + Math.max(1, 1.5 * (mid - lo))];
}

function energyRange() {
  if (state.pot.erange) return state.pot.erange;
  // For drawing, no higher than ten times the state's energy above the bottom: a box with
  // walls 500 high is drawn up to a few times its ground state, not up to 500.
  const [lo, hiV] = potentialRange();
  const hi = Math.min(hiV, lo + Math.max(2, 10 * (lastE - lo)));
  return [lo - 0.05 * (hi - lo), hi];
}

// --------------------------------------------------------------- the initial state

function initialPsi() {
  const n = sim.n, init = state.init;
  const re = new Float64Array(n), im = new Float64Array(n);
  if (init.kind === 'eigen' || init.kind === 'two') {
    // Only the states drawn as levels (bound ones, or all of them between walls): not a state
    // of the computing box that happens to fit below some cut-off.
    const count = shownLevels.length, need = Math.max(init.n, init.kind === 'two' ? init.m : 0) + 1;
    if (!count) throw new Error('This potential has no bound states: try a packet.');
    if (need > count) throw new Error(`This potential has only ${count} bound state${count > 1 ? 's' : ''} (n = ${nOffset()}${count > 1 ? '…' + (count - 1 + nOffset()) : ''}).`);
    const a = shownLevels[init.n];
    if (init.kind === 'eigen') { re.set(a.psi); return { re, im }; }
    const b = shownLevels[init.m];
    for (let j = 0; j < n; j++) re[j] = (a.psi[j] + b.psi[j]) / Math.SQRT2;
    return { re, im };
  }
  const src = init.kind === 'packet' ? PACKET : init.psi;
  const e = parse(src, { variables: ['x'] });
  const v = e.evaluate({ x: sim.x, m: state.mass, ...init.params }, n);
  // NaN (0/0 at a point) is taken as 0; but an infinity means the formula overflows
  // somewhere in the domain (exp(40 x), say), and no normalisation can rescue that.
  let peak = 0;
  for (let j = 0; j < n; j++) {
    const a = v.re[j], b = v.im ? v.im[j] : 0;
    if (a === Infinity || a === -Infinity || b === Infinity || b === -Infinity) throw new Error('ψ₀ is infinite somewhere in the domain: it grows too fast.');
    re[j] = Number.isFinite(a) ? a : 0;
    im[j] = Number.isFinite(b) ? b : 0;
    peak = Math.max(peak, Math.abs(re[j]), Math.abs(im[j]));
  }
  // Scale before normalising, so that huge (but finite) values don't overflow the sum.
  if (peak > 0) for (let j = 0; j < n; j++) { re[j] /= peak; im[j] /= peak; }
  return { re, im };
}

function restart() {
  if (!sim) return;
  errorText = '';
  if (Vdynamic || started) applyPotential({ keepState: false });
  try {
    const { re, im } = initialPsi();
    sim.setPsi(re, im);
    if (!sim.normalize()) throw new Error('The initial wave function is zero everywhere in the domain.');
  } catch (err) {
    errorText = err.message;
    sim.setPsi(new Float64Array(sim.n), null);
  }
  started = false;
  const o = sim.observables();
  // The absorber must stop the fastest part of the packet.
  sim.absorbSpeed = Math.max(1.5, (Math.abs(o.p) + 3 * o.sp) / state.mass);
  sim.h = 0;
  classical = { x: o.x, p: o.p, alive: true };
  lastE = o.E;
  dtCal = Vdynamic ? 0.02 : sim.calibrateStep(sim.suggestedStep(lastE));
  dtMax = Math.min(dtCal, sim.suggestedStep(lastE));
  // Scales for the plots, fixed until the next restart (so spreading shows as falling).
  let dmax = 0;
  for (let j = 0; j < sim.n; j++) dmax = Math.max(dmax, sim.re[j] ** 2 + sim.im[j] ** 2);
  scale.density = dmax * 1.25 || 1;
  scale.amplitude = Math.sqrt(dmax) * 1.25 || 1;
  const ph = sim.momentum();
  let pmax = 0;
  for (let i = 0; i < ph.re.length; i++) pmax = Math.max(pmax, ph.re[i] ** 2 + ph.im[i] ** 2);
  scale.momentum = pmax * 1.25 || 1;
  // The current is at most |psi|^2 times a typical speed: start the scale there (a stationary
  // state carries no current at all, and its plot should show that, not blow up the noise).
  scale.current = (dmax * (Math.abs(o.p) + o.sp)) / state.mass || 1e-3;
  clearCarpet();
  measureSpeed();
  updateClock();
  draw();
  updateHash();
}

/** How long a step takes, to cap the steps per frame at about 12 ms of work. */
function measureSpeed() {
  if (!(dtMax > 0)) dtMax = 0.01;
  const keep = { re: sim.re.slice(), im: sim.im.slice(), t: sim.t, a: sim.absorbed, al: sim.absorbedLeft };
  const t0 = performance.now();
  sim.step(dtMax * 1e-3, 20);
  const per = (performance.now() - t0) / 20 + (Vdynamic ? sim.n * 2e-5 : 0);
  sim.re.set(keep.re); sim.im.set(keep.im); sim.t = keep.t; sim.absorbed = keep.a; sim.absorbedLeft = keep.al;
  maxSteps = Math.max(10, Math.min(2000, Math.floor(12 / Math.max(per, 1e-3))));
}

// ------------------------------------------------------------------------ the sim

function rebuild() {
  const [xmin, xmax] = state.domain;
  sim = new Sim1D({ n: state.n, xmin, xmax, mass: state.mass, boundary: state.boundary });
  applyPotential({ keepState: false });
  restart();
}

function advance(T) {
  if (T === 0) return;
  dtMax = Math.min(dtCal, sim.suggestedStep(lastE));
  // Running backwards stops at t = 0: the initial state, recovered.
  if (state.direction < 0 && sim.t + T < 0) { T = -sim.t; setRunning(false); toast('Back at t = 0.'); }
  if (Math.abs(T) < 1e-12) return;
  let steps = Math.max(1, Math.ceil(Math.abs(T) / dtMax));
  slowed = false;
  if (steps > maxSteps) { steps = maxSteps; T = Math.sign(T) * steps * dtMax; slowed = true; slowFrames++; }
  frames++;
  const h = T / steps;
  if (Vdynamic) {
    // V(x, t) changes: re-evaluate it every step; the classical particle follows.
    const potentialAt = (t) => evalV(t);
    for (let s = 0; s < steps; s++) {
      sim.step(h, 1, potentialAt);
      stepClassical(h);
    }
  } else {
    sim.step(h, steps);
    for (let s = 0; s < steps; s++) stepClassical(h);
  }
  started = true;
}

function forceAt(x) {
  const { V, dx, n, xmin } = sim;
  const f = (x - xmin) / dx, j = Math.floor(f);
  if (j < 1 || j >= n - 2) return 0;
  const g0 = (V[j + 1] - V[j - 1]) / (2 * dx), g1 = (V[j + 2] - V[j]) / (2 * dx);
  return -(g0 + (g1 - g0) * (f - j));
}

function stepClassical(h) {
  const c = classical;
  if (!c || !c.alive) return;
  const m = state.mass;
  c.p += (forceAt(c.x) * h) / 2;
  c.x += (c.p / m) * h;
  const { xmin, xmax } = sim;
  if (state.boundary === 'walls') {
    if (c.x < xmin) { c.x = 2 * xmin - c.x; c.p = -c.p; }
    if (c.x > xmax) { c.x = 2 * xmax - c.x; c.p = -c.p; }
  } else if (state.boundary === 'periodic') {
    c.x = xmin + ((((c.x - xmin) % sim.L) + sim.L) % sim.L);
  } else if (c.x < xmin + sim.L / 8 || c.x > xmax - sim.L / 8) c.alive = false;
  c.p += (forceAt(c.x) * h) / 2;
}

// ---------------------------------------------------------------------- drawing

const plotCanvas = $('#plot'), momCanvas = $('#momentum'), carpetCanvas = $('#carpet');
let mainFrame = null, energyY = null, hover = null;

function coefficients() {
  // c_n = <psi_n | psi>, for the bars beside the levels and for measuring the energy.
  const { re, im, dx, n } = sim;
  return shownLevels.map((s) => {
    let a = 0, b = 0;
    for (let j = 0; j < n; j++) { a += s.psi[j] * re[j]; b += s.psi[j] * im[j]; }
    return (a * a + b * b) * dx * dx;
  });
}

function draw() {
  if (!sim) return;
  drawMain();
  if (state.show.momentum) drawMomentum();
  updateReadouts();
}

/** The part of the domain to draw: without the absorbing layers, which are not part of the physics. */
function viewRange() {
  if (state.boundary === 'absorbing') return [sim.xmin + sim.L / 8, sim.xmax - sim.L / 8];
  return [sim.xmin, sim.xmax];
}

function drawMain() {
  const { ctx, width, height } = fitCanvas(plotCanvas);
  const c = themeColors();
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 50, right: 52, top: 12, bottom: 34 });
  mainFrame = f;
  [f.x0, f.x1] = viewRange();
  const view = state.view;
  let dmax = 0;
  for (let j = 0; j < sim.n; j++) dmax = Math.max(dmax, sim.re[j] ** 2 + sim.im[j] ** 2);
  // Let the scale grow when interference piles probability up (never shrink while running).
  if (dmax > scale.density) { scale.density = dmax * 1.15; scale.amplitude = Math.max(scale.amplitude, Math.sqrt(dmax) * 1.1); }
  let current = null;
  if (view === 'current') {
    current = sim.current();
    let jmax = 0;
    for (let j = 0; j < sim.n; j++) jmax = Math.max(jmax, Math.abs(current[j]));
    if (jmax > scale.current) scale.current = jmax * 1.15;
    f.y0 = -scale.current; f.y1 = scale.current;
  } else if (view === 'reim') { f.y0 = -scale.amplitude; f.y1 = scale.amplitude; }
  else { f.y0 = 0; f.y1 = view === 'density' ? scale.density : scale.amplitude; }
  const [Elo, Ehi] = energyRange();
  const EY = (E) => f.bottom - ((E - Elo) / (Ehi - Elo)) * f.h;
  energyY = EY;

  f.clip();
  // The potential (as typed), filled from the bottom.
  const { x, n } = sim, V = shownV || sim.V;
  ctx.beginPath();
  ctx.moveTo(f.X(x[0]), f.bottom + 2);
  const stride = Math.max(1, Math.floor(n / (f.w * 2)));
  for (let j = 0; j < n; j += stride) ctx.lineTo(f.X(x[j]), Math.max(f.top - 4, Math.min(f.bottom + 2, EY(V[j]))));
  ctx.lineTo(f.X(x[n - 1]), Math.max(f.top - 4, Math.min(f.bottom + 2, EY(V[n - 1]))));
  ctx.lineTo(f.right, f.bottom + 2);
  ctx.closePath();
  ctx.fillStyle = c.line;
  ctx.globalAlpha = 0.6;
  ctx.fill();
  ctx.globalAlpha = 1;
  // The outline: the max and min of V within each pixel column, so that a barrier narrower
  // than a pixel still shows.
  const vPath = new Path2D();
  const clampY = (E) => Math.max(f.top - 4, Math.min(f.bottom + 2, EY(E)));
  let first = true;
  for (let px = 0; px <= f.w; px++) {
    const a = Math.max(0, Math.floor((f.invX(f.left + px - 0.5) - sim.xmin) / sim.dx));
    const b = Math.min(n - 1, Math.ceil((f.invX(f.left + px + 0.5) - sim.xmin) / sim.dx));
    if (b < 0 || a > n - 1) continue;
    let lo = Infinity, hi = -Infinity;
    for (let j = a; j <= b; j++) { lo = Math.min(lo, V[j]); hi = Math.max(hi, V[j]); }
    if (first) { vPath.moveTo(f.left + px, clampY(hi)); first = false; } else vPath.lineTo(f.left + px, clampY(hi));
    if (lo !== hi) { vPath.lineTo(f.left + px, clampY(lo)); vPath.lineTo(f.left + px, clampY(hi)); }
  }

  // Stationary-state energies, and the state's weight in each (bars from the right edge).
  if (state.show.levels && shownLevels.length) {
    const cn = coefficients();
    ctx.lineWidth = 1;
    for (let k = 0; k < shownLevels.length; k++) {
      const y = Math.round(EY(shownLevels[k].E)) + 0.5;
      if (y < f.top || y > f.bottom) continue;
      ctx.strokeStyle = c.ink3;
      ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.moveTo(f.left, y); ctx.lineTo(f.right, y); ctx.stroke();
      ctx.globalAlpha = 1;
      if (cn[k] > 1e-4) {
        ctx.fillStyle = c.accent;
        const w = Math.min(f.w * 0.25, cn[k] * f.w * 0.25);
        ctx.fillRect(f.right - w, y - 2, w, 4);
      }
    }
  }

  // The wave function.
  const xs = f.w, base = f.Y(0);
  if (view === 'density' || view === 'amplitude') {
    for (let px = 0; px < xs; px++) {
      const xv = f.invX(f.left + px + 0.5), j = Math.round((xv - sim.xmin) / sim.dx);
      if (j < 0 || j >= n) continue;
      const a = sim.re[j], b = sim.im[j], d = a * a + b * b;
      const v = view === 'density' ? d : Math.sqrt(d);
      const y = f.Y(v);
      if (base - y < 0.3) continue;
      ctx.fillStyle = phaseColor(a, b);
      ctx.fillRect(f.left + px, y, 1, base - y);
    }
    ctx.beginPath();
    for (let px = 0; px <= xs; px++) {
      const xv = f.invX(f.left + px), j = Math.max(0, Math.min(n - 1, Math.round((xv - sim.xmin) / sim.dx)));
      const d = sim.re[j] ** 2 + sim.im[j] ** 2;
      const y = f.Y(view === 'density' ? d : Math.sqrt(d));
      if (px === 0) ctx.moveTo(f.left, y); else ctx.lineTo(f.left + px, y);
    }
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  } else if (view === 'current') {
    // The probability current j = (hbar/m) Im(psi* dpsi/dx): probability flowing right (up) or
    // left (down).  |psi|^2 in grey for reference, scaled to fit.
    ctx.strokeStyle = c.ink3; ctx.lineWidth = 1; ctx.beginPath();
    for (let px = 0; px <= xs; px++) {
      const xv = f.invX(f.left + px), j = Math.max(0, Math.min(n - 1, Math.round((xv - sim.xmin) / sim.dx)));
      const y = f.Y((scale.current * (sim.re[j] ** 2 + sim.im[j] ** 2)) / scale.density);
      if (px === 0) ctx.moveTo(f.left, y); else ctx.lineTo(f.left + px, y);
    }
    ctx.stroke();
    for (let px = 0; px < xs; px++) {
      const xv = f.invX(f.left + px + 0.5), j = Math.round((xv - sim.xmin) / sim.dx);
      if (j < 0 || j >= n) continue;
      const v = current[j], y = f.Y(v);
      ctx.fillStyle = v >= 0 ? c.accent : c.warn;
      ctx.fillRect(f.left + px, Math.min(y, base), 1, Math.abs(base - y));
    }
    ctx.strokeStyle = c.ink2; ctx.beginPath(); ctx.moveTo(f.left, base); ctx.lineTo(f.right, base); ctx.stroke();
  } else {
    const line = (get, color, width = 1.4) => {
      ctx.beginPath();
      for (let px = 0; px <= xs; px++) {
        const xv = f.invX(f.left + px), j = Math.max(0, Math.min(n - 1, Math.round((xv - sim.xmin) / sim.dx)));
        const y = f.Y(get(j));
        if (px === 0) ctx.moveTo(f.left, y); else ctx.lineTo(f.left + px, y);
      }
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
    };
    line((j) => Math.hypot(sim.re[j], sim.im[j]), c.ink3, 1);
    line((j) => -Math.hypot(sim.re[j], sim.im[j]), c.ink3, 1);
    line((j) => sim.re[j], '#e8453c');
    line((j) => sim.im[j], '#3c7be8');
    ctx.strokeStyle = c.line; ctx.beginPath(); ctx.moveTo(f.left, base); ctx.lineTo(f.right, base); ctx.stroke();
  }

  // The potential's outline, over the wave function so that thin barriers stay visible.
  ctx.strokeStyle = c.ink2;
  ctx.lineWidth = 1.5;
  ctx.stroke(vPath);

  // <E>, dashed.
  const o = sim.observables();
  lastE = o.E;
  const yE = EY(o.E);
  if (yE > f.top && yE < f.bottom) {
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = c.accent; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(f.left, yE); ctx.lineTo(f.right, yE); ctx.stroke();
    ctx.setLineDash([]);
  }
  // <x> (triangle) and the classical particle (dot) at the bottom.
  const tri = (xv, color) => {
    const px = f.X(xv);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(px, f.bottom - 9); ctx.lineTo(px - 6, f.bottom); ctx.lineTo(px + 6, f.bottom); ctx.closePath(); ctx.fill();
  };
  if (o.norm > 1e-3) tri(o.x, c.ink);
  if (state.show.classical && classical?.alive) {
    const px = f.X(classical.x);
    ctx.strokeStyle = c.warn; ctx.globalAlpha = 0.5; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(px, f.top); ctx.lineTo(px, f.bottom); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.fillStyle = c.warn;
    ctx.beginPath(); ctx.arc(px, f.bottom - 14, 5, 0, 2 * Math.PI); ctx.fill();
  }
  ctx.restore(); // the clip

  f.axes({ xlabel: 'x', ylabel: { density: '|ψ|²', amplitude: '|ψ|', reim: 'Re ψ, Im ψ', current: 'current j(x)' }[view] });
  f.rightAxis(Elo, Ehi, 'energy');
  if (hover) {
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = c.ink2; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText(hover, f.right - 6, f.top + 4);
  }
  if (errorText) {
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = c.warn; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(errorText, f.left + f.w / 2, f.top + f.h / 2);
  }
}

function drawMomentum() {
  const { ctx, width, height } = fitCanvas(momCanvas);
  const c = themeColors();
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 50, right: 52, top: 8, bottom: 32 });
  const P = state.pot.prange || 6;
  f.x0 = -P; f.x1 = P; f.y0 = 0; f.y1 = scale.momentum;
  const ph = sim.momentum();
  let pmax = 0;
  for (let i = 0; i < ph.re.length; i++) pmax = Math.max(pmax, ph.re[i] ** 2 + ph.im[i] ** 2);
  if (pmax > scale.momentum) scale.momentum = pmax * 1.15;
  f.y1 = scale.momentum;
  f.clip();
  const base = f.Y(0);
  for (let px = 0; px < f.w; px++) {
    const pv = f.invX(f.left + px + 0.5), i = Math.round(pv / ph.dp + ph.p.length / 2);
    if (i < 0 || i >= ph.p.length) continue;
    const a = ph.re[i], b = ph.im[i], y = f.Y(a * a + b * b);
    if (base - y < 0.3) continue;
    ctx.fillStyle = phaseColor(a, b);
    ctx.fillRect(f.left + px, y, 1, base - y);
  }
  if (state.show.classical && classical?.alive) {
    const px = f.X(classical.p);
    ctx.fillStyle = c.warn;
    ctx.beginPath(); ctx.arc(px, f.bottom - 6, 4, 0, 2 * Math.PI); ctx.fill();
  }
  ctx.restore();
  f.axes({ xlabel: 'p', ylabel: '|ψ̃(p)|²', yTicks: false });
}

// The space-time "carpet": one row per frame, time running downwards.
let carpetImage = null;
function clearCarpet() {
  const { ctx } = fitCanvas(carpetCanvas);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, carpetCanvas.width, carpetCanvas.height);
  carpetImage = null;
}
function carpetRow() {
  if (!state.show.carpet || !mainFrame) return;
  const cv = carpetCanvas;
  const ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = cv.width, H = cv.height;
  // Align the carpet's columns with the main plot's x axis.
  const left = Math.round(mainFrame.left * dpr), w = Math.round(mainFrame.w * dpr);
  if (!carpetImage || carpetImage.width !== w) carpetImage = ctx.createImageData(w, 1);
  const re = new Float64Array(w), im = new Float64Array(w);
  const [v0, v1] = viewRange();
  for (let i = 0; i < w; i++) {
    const xv = v0 + ((i + 0.5) / w) * (v1 - v0), j = Math.min(sim.n - 1, Math.max(0, Math.round((xv - sim.xmin) / sim.dx)));
    re[i] = sim.re[j]; im[i] = sim.im[j];
  }
  colorize(re, im, carpetImage.data, Math.sqrt(scale.density / 1.25) * 0.6, 'complex');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(cv, 0, 1, W, H - 1, 0, 0, W, H - 1);
  ctx.putImageData(carpetImage, left, H - 1);
}

function updateReadouts() {
  const o = sim.observables();
  const parts = [
    ['t', sim.t.toFixed(2)],
    ['⟨x⟩', fmt(o.x, 3)], ['σx', fmt(o.sx, 3)], ['⟨p⟩', fmt(o.p, 3)], ['σp', fmt(o.sp, 3)],
    ['σxσp', `${fmt(o.sx * o.sp, 3)} ≥ ½`], ['⟨E⟩', fmt(o.E, 4)],
  ];
  if (state.pot.barrier !== undefined) {
    const xb = state.pot.barrier;
    const left = sim.probabilityLeftOf(xb) + sim.absorbedLeft, right = 1 - left;
    parts.push([`P(x < ${xb})`, fmt(left, 3)], [`P(x > ${xb})`, fmt(right, 3)]);
  } else if (state.boundary === 'absorbing') parts.push(['left in view', fmt(o.norm, 3)]);
  $('#readouts').innerHTML = parts.map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join('')
    + (slowed ? '<span class="warn">running as fast as this computer can</span>' : '');
}

function updateClock() {}

// ------------------------------------------------------------------------ the loop

let last = 0, raf = 0;
function loop(now) {
  raf = 0;
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
  last = now;
  if (state.running && sim) {
    advance(state.speed * dt * state.direction);
    carpetRow();
    updateClock();
  }
  draw();
  if (state.running) raf = requestAnimationFrame(loop);
  else last = 0;
}
function kick() { if (!raf) raf = requestAnimationFrame(loop); }

function setRunning(on) {
  state.running = on;
  $('#play').textContent = on ? 'Pause' : 'Play';
  kick();
}

// ---------------------------------------------------------------------- controls

$('#play').addEventListener('click', () => setRunning(!state.running));
$('#restart').addEventListener('click', () => { restart(); kick(); });
const reverseButton = $('#reverse');
reverseButton.addEventListener('click', () => {
  state.direction = -state.direction;
  reverseButton.setAttribute('aria-pressed', String(state.direction < 0));
});

const speedSlider = slider({ label: 'Speed', min: 0.02, max: 100, log: true, value: state.speed,
  title: 'Simulated time per second', onInput: (v) => { state.speed = v; } });
$('#speed-box').append(speedSlider);

// The potential buttons and the typed V.
const potButtons = {};
for (const p of POTENTIALS) {
  const b = el('button', { type: 'button', 'aria-pressed': 'false', onclick: () => choosePotential(p) }, p.label);
  $('#potentials').append(b);
  potButtons[p.id] = b;
}
const vField = exprField({
  label: '<math><mi>V</mi><mo>(</mo><mi>x</mi><mo>,</mo><mi>t</mi><mo>)</mo><mo>=</mo></math>',
  value: state.pot.V, variables: ['x', 't'], reserved: ['m'],
  hints: { V0: { min: -10, max: 20, value: 2 }, a: { min: 0.1, max: 5, value: 1 }, w: { min: 0.01, max: 1, value: 0.05 },
    alpha: { min: -3, max: 3, value: 1 }, omega: { min: 0.1, max: 3, value: 1 }, g: { min: 0, max: 3, value: 1 },
    F: { min: -1, max: 2, value: 0.25 }, L: { min: 1, max: 12, value: 4 } },
  onChange: (expr, params) => {
    Vexpr = expr; Vparams = params;
    if (!sim) return;
    const t0 = !started;
    applyPotential({ keepState: !t0 });
    if (!t0 && !Vdynamic) dtCal = sim.calibrateStep(sim.suggestedStep(lastE));
    if (t0) restart();
    else if (!quenchNoted) { quenchNoted = true; toast('The potential changed while the clock ran: the wave function felt it suddenly. Restart to begin again.', 4000); }
    measureSpeed();
    kick();
  },
});
let quenchNoted = false;
$('#v-field').append(vField);

// The initial state.
const suggestionBox = $('#suggestions');
const kindSeg = segmented([
  { value: 'packet', label: 'Packet', title: 'A Gaussian packet: position x0, width σ, momentum k0' },
  { value: 'eigen', label: 'Stationary', title: 'One stationary state (an eigenstate of the energy)' },
  { value: 'two', label: 'Two states', title: 'An equal superposition of two stationary states' },
  { value: 'typed', label: 'Typed', title: 'Any expression in x' },
], 'packet', (k) => { setKind(k); restart(); kick(); }, { label: 'Kind of initial state' });
$('#kind').append(kindSeg);
const stateBox = $('#state-box');

const packetField = exprField({
  label: '<math><msub><mi>ψ</mi><mn>0</mn></msub><mo>=</mo></math>', value: PACKET, variables: ['x'],
  hints: {}, onChange: (expr, params) => { state.init = { kind: 'packet', params }; restartIfIdle(); },
});
packetField.input.readOnly = true;
packetField.input.title = 'The packet formula; choose Typed to write your own';
const typedField = exprField({
  label: '<math><msub><mi>ψ</mi><mn>0</mn></msub><mo>=</mo></math>', value: '(x>-1)(x<1)', variables: ['x'],
  reserved: ['m'], onChange: (expr, params) => { state.init = { kind: 'typed', psi: expr.source, params }; restartIfIdle(); },
});
const nSlider = slider({ label: 'n', min: 0, max: 20, step: 1, value: 0, onInput: (v) => { state.init = { ...state.init, n: Math.round(v) - nOffset() }; restartIfIdle(); } });
const mSlider = slider({ label: 'm', min: 0, max: 20, step: 1, value: 1, onInput: (v) => { state.init = { ...state.init, m: Math.round(v) - nOffset() }; restartIfIdle(); } });
const stateNote = el('div', { class: 'note' });

function nOffset() { return state.pot.nOffset || 0; }

function packetHints() {
  const [a, b] = state.domain;
  const kmax = Math.min(15, Math.PI / ((b - a) / state.n) / 3);
  return {
    x0: { min: a, max: b, value: (a + b) / 2 },
    sigma: { min: 0.05, max: (b - a) / 4, value: 1 },
    k0: { min: -kmax, max: kmax, value: 0 },
    d: { min: 0, max: (b - a) / 2, value: (b - a) / 6 },
  };
}

function setKind(kind, init) {
  kindSeg.value = kind;
  stateBox.replaceChildren();
  const off = nOffset();
  if (kind === 'packet') {
    const params = init?.params || state.init?.params || { x0: 0, sigma: 1, k0: 0 };
    stateBox.append(packetField);
    packetField.setHints(packetHints());
    packetField.set(PACKET, params, false);
    state.init = { kind: 'packet', params: packetField.params };
  } else if (kind === 'typed') {
    stateBox.append(typedField);
    if (init?.psi) typedField.set(init.psi, init.params || {}, false);
    state.init = { kind: 'typed', psi: typedField.source, params: typedField.params };
  } else {
    const count = Math.max(1, shownLevels.length);
    nSlider.setRange(off, off + count - 1);
    mSlider.setRange(off, off + count - 1);
    const n = init?.n ?? 0, m = init?.m ?? 1;
    nSlider.value = n + off; mSlider.value = m + off;
    stateBox.append(nSlider);
    if (kind === 'two') stateBox.append(mSlider);
    stateNote.textContent = shownLevels.length
      ? `${shownLevels.length} stationary state${shownLevels.length > 1 ? 's' : ''} ${state.boundary === 'walls' ? 'below the top of the plot' : 'bound'}; click a level to choose it.`
      : 'This potential has no bound states.';
    stateBox.append(stateNote);
    state.init = { kind, n, m };
  }
}

function restartIfIdle() {
  // Changing the initial state always starts again from it.
  restart();
  kick();
}

function showSuggestions() {
  suggestionBox.replaceChildren();
  for (const s of state.pot.states) {
    suggestionBox.append(el('button', { type: 'button', title: 'Start from this state', onclick: () => { useState(s); restart(); kick(); } }, s.label));
  }
}

function useState(s) {
  setKind(s.kind, s);
  if (s.kind === 'packet') { packetField.set(PACKET, s.params, false); state.init = { kind: 'packet', params: { ...s.params } }; }
  if (s.kind === 'typed') { typedField.set(s.psi, s.params || {}, false); state.init = { kind: 'typed', psi: s.psi, params: typedField.params }; }
  if (s.kind === 'eigen' || s.kind === 'two') state.init = { kind: s.kind, n: s.n, m: s.m ?? 1 };
}

function choosePotential(p, { stateIndex = 0, keepRunning = true } = {}) {
  state.pot = p;
  for (const [id, b] of Object.entries(potButtons)) b.setAttribute('aria-pressed', String(id === p.id));
  state.domain = [...p.domain]; state.n = p.n; state.boundary = p.boundary; state.mass = 1;
  state.speed = p.speed; speedSlider.value = p.speed;
  syncNumerics();
  vField.set(p.V, p.params || {}, false);
  Vexpr = vField.expr; Vparams = vField.params;
  const [xmin, xmax] = state.domain;
  sim = new Sim1D({ n: state.n, xmin, xmax, mass: state.mass, boundary: state.boundary });
  applyPotential({ keepState: false });
  showSuggestions();
  useState(p.states[stateIndex] || p.states[0]);
  restart();
  if (!keepRunning) setRunning(false);
  updateHash();
  kick();
}

// What to show.
const viewSelect = $('#view');
for (const [k, v] of [['density', 'probability |ψ|²'], ['amplitude', 'amplitude |ψ|'], ['reim', 'real and imaginary parts'], ['current', 'probability current j(x)']]) viewSelect.append(el('option', { value: k }, v));
viewSelect.addEventListener('change', () => { state.view = viewSelect.value; kick(); });
const showToggles = {
  levels: toggle('Levels', state.show.levels, (on) => { state.show.levels = on; kick(); }, 'The energies of the stationary states, with bars for the state\'s weight in each'),
  classical: toggle('Classical', state.show.classical, (on) => { state.show.classical = on; kick(); }, 'A classical particle started at ⟨x⟩ and ⟨p⟩ (the red dot)'),
  momentum: toggle('Momentum', state.show.momentum, (on) => { state.show.momentum = on; $('#mom-wrap').hidden = !on; kick(); }, 'The wave function in momentum space'),
  carpet: toggle('Space-time', state.show.carpet, (on) => { state.show.carpet = on; $('#carpet-wrap').hidden = !on; clearCarpet(); kick(); }, 'A picture of ψ(x, t): x across, time downwards'),
};
$('#shows').append(...Object.values(showToggles));

// Measurements.
$('#measure-x').addEventListener('click', () => {
  const { re, im, x, n, dx } = sim, t = sim.t;
  let r = Math.random() * sim.norm(), j = 0;
  for (; j < n - 1; j++) { r -= (re[j] ** 2 + im[j] ** 2) * dx; if (r <= 0) break; }
  // A measurement with resolution s: psi -> psi * exp(-(x - x_m)^2 / 4 s^2), renormalised.
  const s = Math.max(3 * dx, sim.L / 200);
  for (let i = 0; i < n; i++) {
    const g = Math.exp(-((x[i] - x[j]) ** 2) / (4 * s * s));
    re[i] *= g; im[i] *= g;
  }
  if (state.boundary === 'walls') sim.setPsi(re.slice(0, n), im.slice(0, n));   // (resets t)
  sim.normalize(); sim.t = t;
  scale.density = Math.max(scale.density, (1.25 / (Math.sqrt(2 * Math.PI) * s)));
  classical = { x: x[j], p: sim.observables().p, alive: true };
  toast(`Found at x = ${fmt(x[j], 3)}`);
  kick();
});
$('#measure-e').addEventListener('click', () => {
  if (!shownLevels.length) { toast('This potential has no stationary states to collapse onto.'); return; }
  const cn = coefficients(), total = cn.reduce((a, b) => a + b, 0);
  if (total < 0.98) { toast(`Only ${(100 * total).toFixed(0)}% of this state is in the levels found; an energy measurement could give a value in the continuum.`, 4000); if (total < 0.5) return; }
  let r = Math.random() * total, k = 0;
  for (; k < cn.length - 1; k++) { r -= cn[k]; if (r <= 0) break; }
  const t = sim.t;
  sim.setPsi(shownLevels[k].psi, null);
  sim.normalize(); sim.t = t;
  toast(`E = ${fmt(shownLevels[k].E, 4)}  (n = ${k + nOffset()})`);
  classical = { ...sim.observables(), alive: false };
  kick();
});

// Clicking a level loads that stationary state; hovering shows values.
plotCanvas.addEventListener('pointermove', (e) => {
  if (!mainFrame) return;
  const r = plotCanvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  const xv = mainFrame.invX(px), j = Math.round((xv - sim.xmin) / sim.dx);
  if (j >= 0 && j < sim.n) {
    const d = sim.re[j] ** 2 + sim.im[j] ** 2;
    hover = `x = ${fmt(xv, 3)}   V = ${fmt((shownV || sim.V)[j], 3)}   |ψ|² = ${fmt(d, 3)}`;
  }
  plotCanvas.style.cursor = levelAt(py) >= 0 ? 'pointer' : 'default';
  if (!state.running) kick();
});
plotCanvas.addEventListener('pointerleave', () => { hover = null; kick(); });
plotCanvas.addEventListener('click', (e) => {
  const r = plotCanvas.getBoundingClientRect(), k = levelAt(e.clientY - r.top);
  if (k < 0) return;
  setKind('eigen', { n: k });
  restart(); kick();
});
function levelAt(py) {
  if (!state.show.levels || !energyY) return -1;
  for (let k = 0; k < shownLevels.length; k++) if (Math.abs(energyY(shownLevels[k].E) - py) < 4) return k;
  return -1;
}

// Domain and numerics.
const numBox = $('#numerics-box');
const xminBox = el('input', { type: 'number', step: 'any', 'aria-label': 'x from' });
const xmaxBox = el('input', { type: 'number', step: 'any', 'aria-label': 'x to' });
const nSelect = el('select', { 'aria-label': 'Grid points' }, ...[256, 512, 1024, 2048, 4096, 8192].map((v) => el('option', { value: v }, `${v} points`)));
const bcSeg = segmented([
  { value: 'walls', label: 'Walls', title: 'ψ = 0 at both ends: an infinitely deep box around the domain' },
  { value: 'periodic', label: 'Ring', title: 'The ends are joined: a particle on a ring' },
  { value: 'absorbing', label: 'Absorbing', title: 'Whatever reaches the ends is absorbed, as if the domain went on forever' },
], state.boundary, (v) => { state.boundary = v; rebuildKeepingInit(); }, { label: 'Boundaries' });
const massSlider = slider({ label: 'mass m', min: 0.1, max: 10, log: true, value: 1, onInput: (v) => { state.mass = v; rebuildKeepingInit(); } });
numBox.append(
  el('div', { class: 'row' }, 'x from', xminBox, 'to', xmaxBox),
  el('div', { class: 'row' }, nSelect),
  bcSeg, massSlider,
  el('div', { class: 'note' }, 'Units: ħ = 1.  The time step adapts to the potential; the speed is simulated time per second.'),
);
for (const b of [xminBox, xmaxBox]) b.addEventListener('change', () => {
  const a = parseFloat(xminBox.value), c = parseFloat(xmaxBox.value);
  if (!(c > a)) { syncNumerics(); return; }
  state.domain = [a, c]; rebuildKeepingInit();
});
nSelect.addEventListener('change', () => { state.n = +nSelect.value; rebuildKeepingInit(); });
function syncNumerics() {
  xminBox.value = state.domain[0]; xmaxBox.value = state.domain[1];
  nSelect.value = state.n; bcSeg.value = state.boundary; massSlider.value = state.mass;
}
function rebuildKeepingInit() {
  const init = state.init;
  const [xmin, xmax] = state.domain;
  sim = new Sim1D({ n: state.n, xmin, xmax, mass: state.mass, boundary: state.boundary });
  applyPotential({ keepState: false });
  state.init = init;
  restart();
  kick();
}

// Keys.
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ') { e.preventDefault(); setRunning(!state.running); }
  else if (e.key === 'r' || e.key === 'R') { restart(); kick(); }
  else if (e.key === 'b' || e.key === 'B') reverseButton.click();
});
window.addEventListener('resize', () => { clearCarpet(); kick(); });

// ------------------------------------------------------------------ experiments

const byId = (id) => POTENTIALS.find((p) => p.id === id);
function go(potId, { stateIndex = 0, params, init, speed, show = {}, view = 'density', run = true } = {}) {
  state.direction = 1; reverseButton.setAttribute('aria-pressed', 'false');
  for (const [k, t] of Object.entries(showToggles)) {
    const on = show[k] ?? true;
    t.on = on; state.show[k] = on;
  }
  $('#mom-wrap').hidden = !state.show.momentum; $('#carpet-wrap').hidden = !state.show.carpet;
  state.view = view; viewSelect.value = view;
  choosePotential(byId(potId), { stateIndex, keepRunning: false });
  if (params) { vField.set(vField.source, params, false); Vexpr = vField.expr; Vparams = vField.params; applyPotential({ keepState: false }); }
  if (init) useState(init);
  if (speed) { state.speed = speed; speedSlider.value = speed; }
  restart();
  setRunning(run);
}

const setups = {
  spread: () => go('free', { stateIndex: 1, speed: 1 }),
  phase: () => go('free', { stateIndex: 0, speed: 3 }),
  collide: () => go('free', { stateIndex: 2, speed: 3 }),
  stationary: () => go('box', { stateIndex: 2, speed: 1 }),
  revival: () => go('box', { stateIndex: 0, speed: 16, show: { carpet: true } }),
  coherent: () => go('harmonic', { stateIndex: 0, speed: 1.5 }),
  squeezed: () => go('harmonic', { stateIndex: 4, speed: 1 }),
  tunnel: () => go('barrier', { stateIndex: 0, speed: 6 }),
  step: () => go('step', { stateIndex: 1, speed: 6 }),
  well: () => go('well', { stateIndex: 1, speed: 1 }),
  double: () => go('double', { stateIndex: 0, speed: 4, show: { carpet: true } }),
  delta: () => go('delta', { stateIndex: 1, speed: 4 }),
  bouncer: () => go('bouncer', { stateIndex: 0, speed: 3, show: { carpet: true } }),
  bloch: () => go('lattice', { stateIndex: 0, speed: 8, show: { carpet: true } }),
  driven: () => go('driven', { stateIndex: 0, speed: 3 }),
  quench: () => {
    go('custom', { run: false });
    state.domain = [-8, 8]; state.n = 1024; state.boundary = 'walls'; syncNumerics();
    vField.set('V0 (abs(x) > L/2)', { V0: 500, L: 3 }, false);
    Vexpr = vField.expr; Vparams = vField.params;
    sim = new Sim1D({ n: state.n, xmin: -8, xmax: 8, mass: 1, boundary: 'walls' });
    applyPotential({ keepState: false });
    useState({ kind: 'eigen', n: 0 });
    state.speed = 1; speedSlider.value = 1;
    restart(); setRunning(true);
  },
  measure: () => go('box', { stateIndex: 0, speed: 1, run: false }),
  backwards: () => {
    go('barrier', { stateIndex: 0, speed: 6, run: false });
    state.boundary = 'walls'; syncNumerics();
    rebuildKeepingInit();
    // Run forward to t = 16 straight away (not limited by the per-frame budget), then wait,
    // with Backwards already on, for Play.
    for (let i = 0; i < 100000 && sim.t < 16 - 1e-9; i++) advance(Math.min(1, 16 - sim.t));
    state.direction = -1; reverseButton.setAttribute('aria-pressed', 'true');
    updateClock(); kick();
  },
};

drawer($('#help'), $('#help-button'), setups);
drawWheel($('#legend'), 1, 2.2);

// ------------------------------------------------------------------------ hash

// The set-up, in the address: the potential (with its typed formula and parameters if they
// changed), the initial state, and the domain if it changed.  Copy the address and a student
// opening it gets exactly this set-up.
const rounded = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'number' ? +v.toPrecision(5) : v)));
function updateHash() {
  if (!sim || !state.init) return;
  const p = state.pot, h = { pot: p.id };
  if (vField.source !== p.V) h.V = vField.source;
  const vp = rounded(Vparams);
  if (Object.keys(vp).length) h.vp = JSON.stringify(vp);
  h.init = JSON.stringify(rounded(state.init));
  if (state.domain[0] !== p.domain[0] || state.domain[1] !== p.domain[1]) h.dom = state.domain.join(',');
  if (state.n !== p.n) h.n = state.n;
  if (state.boundary !== p.boundary) h.bc = state.boundary;
  if (state.mass !== 1) h.m = state.mass;
  writeHash(h);
}

function fromHash(h) {
  const pot = byId(h.pot);
  if (!pot) return false;
  choosePotential(pot, { keepRunning: false });
  try {
    if (h.dom) { const [a, b] = h.dom.split(',').map(Number); if (b > a) state.domain = [a, b]; }
    if ([256, 512, 1024, 2048, 4096, 8192].includes(+h.n)) state.n = +h.n;
    if (['walls', 'periodic', 'absorbing'].includes(h.bc)) state.boundary = h.bc;
    if (+h.m > 0) state.mass = +h.m;
    syncNumerics();
    if (h.V || h.vp) {
      vField.set(h.V || pot.V, h.vp ? JSON.parse(h.vp) : {}, false);
      if (vField.expr) { Vexpr = vField.expr; Vparams = vField.params; }
    }
    if (h.init) {
      const init = JSON.parse(h.init);
      if (['packet', 'eigen', 'two', 'typed'].includes(init.kind)) state.init = init;
    }
    const keep = state.init;
    rebuildKeepingInit();
    useState(keep);
    restart();
  } catch { /* an address that doesn't parse: the preset stands */ }
  return true;
}

// ------------------------------------------------------------------------ start

const hash = readHash();
if (setups[hash.setup]) setups[hash.setup]();
else if (!fromHash(hash)) choosePotential(POTENTIALS[2], { keepRunning: false });
setRunning(true);

window.__app = { state, get sim() { return sim; }, get slow() { const r = [slowFrames, frames]; slowFrames = frames = 0; return r; }, setups, choosePotential, restart, advance, get levels() { return shownLevels; }, ready: true };
