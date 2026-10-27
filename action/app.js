// The least-action demo: drag the knots of a path between two events, in place and in time;
// watch its action.  Every set-up starts on the true path, so any change shows what it costs.

import { Path, action, knotQuadrature, truePaths, closedOrbits, truthAt, stationaryKnots, freeKnots, knotDerivatives, knotTimeDerivatives, momentum, energy, hamiltonianGrid } from './physics.js';
import { SYSTEMS, typedSystem } from './systems.js';
import { el, $, slider, segmented, toggle, exprField, drawer, readHash, writeHash, fmt } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors, contour } from '../lib/plot.js';
import { texToMathML } from '../lib/mathml.js';

// ----------------------------------------------------------------------------- state

const state = {
  sys: SYSTEMS[0],
  params: {},
  s0: 0, s1: 2, q0: 0, q1: 4,
  knots: new Float64Array(5),   // the knots: where the path is (q) ...
  times: new Float64Array(5),   // ... and when it gets there (s), in increasing order
  mode: 'spline',
  ends: 'fixed',                // or 'periodic': the last knot is the first, the path a closed loop
  show: { truth: true, hints: false, phasor: true },
  hbar: 0.5,
  rolling: false,
  onTrue: false,                // still the true path it was put on: it follows when T or a parameter changes
  sel: 2,                       // the knot the arrow keys move
};
let L = null;                 // the system's Lagrangian object
let typedExpr = null;
let quad = null;
let truths = [];              // the true paths: [{s, q, v, S, index, closed}]
let ref = null;               // the one the path was put on, for the readout
let familyB = 0;              // the oscillator's closed orbit q0 cos ωt + B sin ωt nearest the path
let familyS = NaN;            // ... and the action of the path through it at the same knots
let history = [];             // the action of every path drawn, in order
let current = null;           // {S, samples, kinetic}
let phaseGrid = null;         // {H, nq, np, q0, q1, p0, p1, levels}
let hover = null;             // {s}: the point of the path under the pointer

const HISTORY = 400;
// Roll downhill moves the knots in time as well as up and down: dS/ds_k is the jump in energy
// at the knot, a well-behaved slope (the knots slide until the energy stops jumping).
const ROLL_TIMES = true;

function paramValues() { return { ...state.params }; }
const periodic = () => state.ends === 'periodic';
const qopt = () => ({ count: 600, singularStart: !!state.sys.singularStart });
const uniformTimes = (n) => Float64Array.from({ length: n }, (_, i) => state.s0 + ((state.s1 - state.s0) * i) / (n - 1));
// The knots keep their order in time, at least this far apart.
const gap = () => (0.2 * (state.s1 - state.s0)) / (state.knots.length - 1);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function buildL() {
  const d = state.sys;
  if (d.typed) {
    if (!typedExpr) return null;
    L = typedSystem(d.typed, typedExpr, typedField?.params || {}, state.params.m ?? 1);
  } else L = d.make(paramValues());
  return L;
}

function path() { return new Path(state.s0, state.s1, state.knots, state.mode, { s: state.times, periodic: periodic() }); }

/** The action of the current path, and the kinetic part when the system can say. */
function evaluate() {
  if (!L) { current = null; return; }
  quad = knotQuadrature(state.times, qopt().count, qopt().singularStart);
  const a = action(L, path(), quad);
  let kinetic = null;
  if (L.kinetic || L.vOfP) {
    const m = state.params.m ?? 1;
    kinetic = 0;
    for (let i = 0; i < quad.s.length; i++) kinetic += 0.5 * m * a.samples.v[i] ** 2 * quad.w[i];
  }
  current = { S: a.S, samples: a.samples, kinetic };
  if (periodic() && state.sys.family && !state.onTrue) fitFamily();
}

/** The oscillator's closed orbits are a family: show the one nearest the drawn loop (least squares). */
function fitFamily() {
  const w = state.params.omega, smp = current.samples;
  let num = 0, den = 0;
  for (let j = 0; j < quad.s.length; j++) {
    const u = w * (quad.s[j] - state.s0), sn = Math.sin(u);
    num += quad.w[j] * (smp.q[j] - state.q0 * Math.cos(u)) * sn; den += quad.w[j] * sn * sn;
  }
  if (den > 0) familyB = num / den;
  truths = [state.sys.family(paramValues(), state.s0, state.q0, state.s1, familyB)];
  ref = truths[0];
  const p = path();
  familyS = action(L, p.withKnots(truthAt(ref, state.times)), quad).S;
}

function record() {
  if (!current || !Number.isFinite(current.S)) { history.push(NaN); }
  else history.push(current.S);
  if (history.length > HISTORY) history.splice(0, history.length - HISTORY);
  hashSoon();
}

// The set-up and the drawn path, in the address (a moment after the last change): a link can
// pose "here is a path: what is its action, and which way should it move?"
let hashTimer = 0;
function hashSoon() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const d = state.sys, r = (v) => +v.toPrecision(4);
    const h = { sys: d.id, q: Array.from(state.knots, r).join(','), mode: state.mode === 'segments' ? 'segments' : undefined };
    const even = uniformTimes(state.knots.length);
    if (state.times.some((s, i) => Math.abs(s - even[i]) > 1e-9 * (1 + Math.abs(s)))) h.t = Array.from(state.times, r).join(',');
    if (periodic()) h.ends = 'periodic';
    if (state.s1 - state.s0 !== d.s1 - d.s0) h.T = r(state.s1 - state.s0);
    const p = Object.fromEntries(Object.entries(state.params).filter(([k, v]) => v !== d.params[k]?.value).map(([k, v]) => [k, r(v)]));
    if (Object.keys(p).length) h.p = JSON.stringify(p);
    if (typedField && typedField.source !== d.source) h.L = typedField.source;
    if (typedField && Object.keys(typedField.params).length) h.tp = JSON.stringify(typedField.params);
    writeHash(h);
  }, 300);
}

function fromHash(h) {
  const d = SYSTEMS.find((x) => x.id === h.sys);
  if (!d) return false;
  try {
    const over = {};
    if (h.mode === 'segments') { state.mode = 'segments'; modeSeg.value = 'segments'; }
    if (h.p) over.params = Object.fromEntries(Object.entries(JSON.parse(h.p)).filter(([k]) => k in d.params).map(([k, v]) => [k, +v]));
    if (+h.T > 0 && d.tmax) over.T = +h.T;
    if (h.ends === 'periodic' && d.periodic) over.ends = 'periodic';
    const q = (h.q || '').split(',').map(Number), t = (h.t || '').split(',').map(Number);
    const goodQ = q.length >= 3 && q.length <= 16 && q.every(Number.isFinite);
    if (goodQ) over.knots = q.length;
    setSystem(d, over);
    if (typedField && (h.L || h.tp)) { typedField.set(h.L || d.source, h.tp ? JSON.parse(h.tp) : {}, false); typedExpr = typedField.expr; buildL(); }
    if (goodQ) {
      state.knots = Float64Array.from(q);
      const n = q.length;
      // Knot times from the link if they make sense (in order, the ends where they belong).
      if (t.length === n && t.every(Number.isFinite) && t.every((s, i) => i === 0 || s > t[i - 1])
        && Math.abs(t[0] - state.s0) < 1e-3 && Math.abs(t[n - 1] - state.s1) < 1e-3 * (1 + state.s1)) {
        state.times = Float64Array.from(t); state.times[0] = state.s0; state.times[n - 1] = state.s1;
      }
      state.q0 = q[0]; state.q1 = periodic() ? q[0] : q[n - 1];
      state.onTrue = false;
      history = [];
      evaluate(); record(); recomputeTruth();
    }
  } catch { /* an address that doesn't parse: the system's defaults stand */ }
  return true;
}

function computeTruths() {
  const d = state.sys, P = paramValues();
  if (periodic()) {
    if (d.family) return [d.family(P, state.s0, state.q0, state.s1, familyB)];
    return closedOrbits(L, state.s0, state.q0, state.s1, { qrange: d.periodic.range || d.qrange });
  }
  return d.truePaths
    ? d.truePaths(P, state.s0, state.q0, state.s1, state.q1)
    : truePaths(L, state.s0, state.q0, state.s1, state.q1, { vmax: d.vmax, max: 6 });
}

/** The true path most like the one the path was put on (after T or a parameter changed). */
function sameTruth(old) {
  if (!old || !truths.length) return truths[0] || null;
  let best = truths[0], bestD = Infinity;
  for (const t of truths) {
    const dd = Math.abs(t.v0 - old.v0) + Math.abs(t.q[0] - old.q[0]) + Math.abs(t.S - old.S) * 1e-3;
    if (dd < bestD) { bestD = dd; best = t; }
  }
  return best;
}

let truthTimer = 0;
/** Find the true paths again; snap: put the path on the one of least action. */
function recomputeTruth(delay = 0, { snap = false } = {}) {
  clearTimeout(truthTimer);
  const run = () => {
    if (!L) { truths = []; ref = null; return; }
    try { truths = computeTruths(); } catch { truths = []; }
    ref = snap ? truths[0] || null : sameTruth(ref);
    if ((snap || state.onTrue) && ref) snapTo(ref);
    computePhaseGrid();
    evaluate();
    if (snap) slots = null;
    if (snap) record();
    showTruthList();
    draw();
  };
  if (delay) truthTimer = setTimeout(run, delay); else run();
}

/**
 * Put the path on a true path: knots evenly spaced in time, on the true path, then nudged (by
 * far less than a pixel, as a rule) to where the action of the path drawn through them is
 * stationary, so that every drag changes S at second order only.
 */
function snapTo(t) {
  if (!t || !L) return;
  const n = state.knots.length;
  state.times = uniformTimes(n);
  const q = truthAt(t, state.times);
  if (periodic()) { state.q0 = state.q1 = t.q[0]; q[0] = q[n - 1] = t.q[0]; }
  else { q[0] = state.q0; q[n - 1] = state.q1; }
  let p = new Path(state.s0, state.s1, q, state.mode, { s: state.times, periodic: periodic() });
  if (!t.family) {
    // The ends stay put (a closed orbit's start too: it fixes where on the loop the trip begins).
    try {
      const r = stationaryKnots(L, p, { ...qopt(), free: freeKnots(p).filter((k) => k > 0) });
      if (Number.isFinite(r.gradient)) p = r.path;
    } catch { /* keep the true path's own values */ }
  }
  state.knots = Float64Array.from(p.q);
  state.onTrue = true;
  ref = t;
}

// ---------------------------------------------------------------------- systems

const sysButtons = {};
for (const d of SYSTEMS) {
  const b = el('button', { type: 'button', 'aria-pressed': 'false', title: d.blurb, onclick: () => go(d.id, { keepShow: true, mode: d.mode || (state.sys.mode ? 'spline' : state.mode) }) }, d.label);
  $('#systems').append(b);
  sysButtons[d.id] = b;
}

let typedField = null;
let paramSliders = {};

/**
 * Choose a system, with optional knot count, duration T, parameters and ends, and put the path
 * on its true path (the one of least action).
 */
function setSystem(d, { knots, T, params, ends = 'fixed' } = {}) {
  setRolling(false);
  state.sys = d;
  for (const [id, b] of Object.entries(sysButtons)) b.setAttribute('aria-pressed', String(id === d.id));
  state.params = Object.fromEntries(Object.entries(d.params).map(([k, v]) => [k, v.value]));
  if (params) Object.assign(state.params, params);
  state.ends = ends === 'periodic' && d.periodic ? 'periodic' : 'fixed';
  state.s0 = d.s0; state.s1 = d.s0 + (T || d.s1 - d.s0); state.q0 = d.q0; state.q1 = periodic() ? d.q0 : d.q1;
  if (periodic() && d.periodic.period) state.s1 = state.s0 + d.periodic.period(state.params);
  const n = knots || d.knots;
  state.times = uniformTimes(n);
  state.knots = Float64Array.from(state.times, (_, i) => state.q0 + ((state.q1 - state.q0) * i) / (n - 1));
  state.sel = n >> 1;
  knotSlider.value = n;
  $('#formula').innerHTML = texToMathML(d.formula, true);
  $('#blurb').textContent = d.blurb;
  $('#howto').textContent = d.s === 't' && !d.vertical
    ? 'Drag a knot up or down to change where the path goes, sideways to change when it gets there.  The slope is the velocity: point at the path to read it.'
    : d.vertical ? 'Drag an event sideways to change where the traveller is, up or down to change when.  The slope is the velocity: point at the world line to read it.'
      : 'Drag a knot anywhere: the curve passes through it (the knots stay in order across).  Point at the curve to read its slope.';
  // Typed systems get an expression field (its free symbols get sliders).
  const typedBox = $('#typed');
  typedBox.replaceChildren();
  typedField = null;
  if (d.typed) {
    typedField = exprField({
      label: d.typed === 'V' ? '<math><mi>V</mi><mo>(</mo><mi>x</mi><mo>,</mo><mi>t</mi><mo>)</mo><mo>=</mo></math>'
        : '<math><mi>L</mi><mo>(</mo><mi>x</mi><mo>,</mo><mi>v</mi><mo>,</mo><mi>t</mi><mo>)</mo><mo>=</mo></math>',
      value: d.source, variables: d.typed === 'V' ? ['x', 't'] : ['x', 'v', 't'], reserved: ['m'],
      hints: { gamma: { min: -1, max: 1, value: 0.3 }, a: { min: 0, max: 3, value: 1 }, k: { min: 0, max: 5, value: 1 } },
      onChange: (expr) => { typedExpr = expr; rebuild(); },
    });
    typedExpr = typedField.expr;
    typedBox.append(typedField);
  } else typedExpr = null;
  // Parameter sliders, and the duration for the systems where it matters.
  const box = $('#params');
  box.replaceChildren();
  paramSliders = {};
  for (const [k, p] of Object.entries(d.params)) {
    const label = { m: '<math><mi>m</mi></math>', g: '<math><mi>g</mi></math>', omega: '<math><mi>ω</mi></math>',
      n0: '<math><msub><mi>n</mi><mn>0</mn></msub></math>', alpha: '<math><mi>α</mi></math>',
      n1: '<math><msub><mi>n</mi><mn>1</mn></msub></math>', n2: '<math><msub><mi>n</mi><mn>2</mn></msub></math>' }[k] || k;
    const s = slider({ label, labelHTML: true, min: p.min, max: p.max, value: state.params[k],
      onInput: (v) => { state.params[k] = v; rebuild(); } });
    box.append(s);
    paramSliders[k] = s;
  }
  if (d.tmax) {
    const s = slider({ label: `<math><mi>${d.s === 't' ? 'T' : 'X'}</mi></math>`, labelHTML: true, min: 0.3, max: d.tmax, value: state.s1 - state.s0,
      title: 'How long the trip takes', onInput: (v) => { setDuration(v); rebuild(); } });
    box.append(s);
    paramSliders.T = s;
  }
  endsBox.hidden = !d.periodic;
  endsSeg.value = state.ends;
  lockDuration();
  history = [];
  familyB = 0;
  ref = null;
  rebuild({ snap: true });
}

/** A new duration: the knots keep their places in proportion. */
function setDuration(T) {
  const old = state.s1 - state.s0;
  state.s1 = state.s0 + T;
  state.times = Float64Array.from(state.times, (s) => state.s0 + ((s - state.s0) * T) / old);
  state.times[state.times.length - 1] = state.s1;
  if (paramSliders.T) paramSliders.T.value = T;
}

/** The oscillator's closed orbits all take one period: T is fixed then. */
function lockDuration() {
  const locked = periodic() && !!state.sys.periodic?.period;
  if (paramSliders.T) for (const i of paramSliders.T.querySelectorAll('input')) i.disabled = locked;
}

function rebuild({ snap = false } = {}) {
  buildL();
  if (!L) return;
  if (periodic() && state.sys.periodic?.period) {
    const T = state.sys.periodic.period(paramValues());
    if (Math.abs(state.s1 - state.s0 - T) > 1e-12) setDuration(T);
  }
  evaluate();
  if (!snap) record();
  recomputeTruth(0, { snap });
}

// ----------------------------------------------------------------- path controls

const knotSlider = slider({ label: 'Knots', min: 3, max: 16, step: 1, value: 5, title: 'How many points the path is drawn through',
  onInput: (v) => setKnotCount(Math.round(v)) });
$('#knot-box').append(knotSlider);

function setKnotCount(n) {
  if (n === state.knots.length) return;
  setRolling(false);
  if (state.onTrue && ref) {
    state.knots = new Float64Array(n);
    snapTo(ref);
  } else {
    // Keep the shape: resample the current path at evenly spaced new knots.
    const p = path(), ss = uniformTimes(n);
    state.knots = p.sample(ss).q;
    state.times = ss;
    state.knots[0] = state.q0; state.knots[n - 1] = state.q1;
  }
  state.sel = Math.min(state.sel, n - 2);
  evaluate(); record(); draw();
}

const modeSeg = segmented([
  { value: 'spline', label: 'Smooth', title: 'A smooth curve (cubic spline) through the knots' },
  { value: 'segments', label: 'Straight segments', title: 'Straight lines between the knots: constant speed along each' },
], state.mode, (v) => {
  state.mode = v;
  if (state.onTrue && ref) snapTo(ref);
  evaluate(); record(); draw();
}, { label: 'Path shape' });
$('#mode-box').append(modeSeg);

const endsSeg = segmented([
  { value: 'fixed', label: 'Fixed ends', title: 'The path starts and ends at two given events' },
  { value: 'periodic', label: 'Periodic', title: 'The path ends where it started, with the same velocity: a closed loop in phase space' },
], state.ends, (v) => setEnds(v), { label: 'End conditions' });
const endsBox = el('div', { class: 'row' }, endsSeg);
$('#mode-box').append(endsBox);

function setEnds(v) {
  const d = state.sys;
  if (v === state.ends || (v === 'periodic' && !d.periodic)) return;
  // Leaving the oscillator's one period for its usual trip.
  const T = v === 'fixed' && d.periodic?.period ? d.s1 - d.s0 : state.s1 - state.s0;
  const knots = v === 'periodic' ? Math.max(state.knots.length, 9) : state.knots.length;
  go(d.id, { ends: v, T, knots, mode: state.mode, params: { ...state.params }, keepShow: true });
}

$('#straight').addEventListener('click', () => {
  setRolling(false);
  const n = state.knots.length;
  state.knots = Float64Array.from(state.times, (s) => state.q0 + ((state.q1 - state.q0) * (s - state.s0)) / (state.s1 - state.s0));
  if (periodic()) state.knots.fill(state.q0);
  state.knots[n - 1] = state.q1;
  state.onTrue = false;
  evaluate(); record(); regrid(); draw();
});

$('#reset').addEventListener('click', () => {
  setRolling(false);
  if (periodic() && state.sys.family && !truths.length) return;
  const t = ref || truths[0];
  if (!t) return;
  snapTo(t);
  evaluate(); record(); draw();
});

/** Bend the path by half a sine wave (a whole one for a loop); shift-click bends the other way. */
function bend(sign) {
  setRolling(false);
  const [qlo, qhi] = state.sys.qrange, a = 0.12 * (qhi - qlo) * sign, T = state.s1 - state.s0;
  const k = periodic() ? 2 : 1;
  state.knots = Float64Array.from(state.knots, (q, i) => q + a * Math.sin((k * Math.PI * (state.times[i] - state.s0)) / T));
  state.onTrue = false;
  evaluate(); record(); regrid(); draw();
}
$('#bend').addEventListener('click', (e) => bend(e.shiftKey ? -1 : 1));

const rollButton = $('#roll');
rollButton.addEventListener('click', () => setRolling(!state.rolling));
function setRolling(on) {
  state.rolling = on;
  rollButton.setAttribute('aria-pressed', String(on));
  if (on) { rollFrames = 0; rollLog = []; requestAnimationFrame(roll); }
}

/**
 * The slope of the action at every knot, up-down (q) and in time (s), with the curvatures:
 * {gq, cq, gs, cs} over all knots, zero where a knot may not move.
 */
function downhill(p) {
  const n = p.q.length, free = freeKnots(p).filter((k) => !(k === 0 && state.sys.lockStart));
  const D = knotDerivatives(L, p, quad, free), T = knotTimeDerivatives(L, p, qopt());
  const gq = new Float64Array(n), cq = new Float64Array(n);
  free.forEach((k, a) => { gq[k] = D.g[a]; cq[k] = D.H[a][a]; });
  if (p.periodic) { gq[n - 1] = gq[0]; cq[n - 1] = cq[0]; }
  return { gq, cq, gs: T.g, cs: T.c, free };
}

let rollFrames = 0, rollLog = [];
function roll() {
  if (!state.rolling || !L) return;
  const p = path(), n = p.q.length, { gq, cq, gs, cs, free } = downhill(p);
  let cmax = 0, gmax = 0, tmax = 0, tgmax = 0;
  for (const k of free) { cmax = Math.max(cmax, cq[k]); gmax = Math.max(gmax, Math.abs(gq[k])); }
  for (let k = 1; k < n - 1; k++) { tmax = Math.max(tmax, cs[k]); tgmax = Math.max(tgmax, Math.abs(gs[k])); }
  if (!(cmax > 0) || !Number.isFinite(gmax) || !Number.isFinite(tgmax)) { setRolling(false); return; }
  // Steepest descent with a step set by the stiffest knot: stable where S curves upwards,
  // and running away (as it should) along any direction where S curves down.  Up-down and in
  // time each get their own step, a little shorter when both move (they are coupled).
  const [qlo, qhi] = state.sys.qrange, span = qhi - qlo, T = state.s1 - state.s0;
  const withTimes = ROLL_TIMES && tmax > 0, kq = withTimes ? 0.4 : 0.5;
  for (const k of free) state.knots[k] += clamp((-kq * gq[k]) / cmax, -0.04 * span, 0.04 * span);
  if (periodic()) state.knots[n - 1] = state.knots[0];
  if (periodic()) state.q0 = state.q1 = state.knots[0];
  if (withTimes) {
    const g = gap();
    for (let k = 1; k < n - 1; k++) {
      const s = state.times[k] + clamp((-0.4 * gs[k]) / tmax, -0.02 * T, 0.02 * T);
      state.times[k] = clamp(s, state.times[k - 1] + g, state.times[k + 1] - g);
    }
  }
  state.onTrue = false;
  evaluate(); record(); draw();
  rollFrames++;
  // Done when nothing moves any more, or the action has stopped falling.
  rollLog.push(current.S);
  const old = rollLog.length > 90 ? rollLog[rollLog.length - 91] : NaN;
  const settled = gmax / cmax < 1e-6 * span && (!withTimes || tgmax / tmax < 1e-6 * T);
  const stalled = Math.abs(old - current.S) < 1e-9 * (1 + Math.abs(current.S));
  const away = state.knots.some((q) => q < qlo - span || q > qhi + span);
  if (settled || stalled || away || !Number.isFinite(current.S) || rollFrames > 2000) {
    setRolling(false);
    if (periodic()) recomputeTruth(0); else { regrid(); draw(); }
    return;
  }
  requestAnimationFrame(roll);
}

// What to show.
const showToggles = {
  truth: toggle('True path', state.show.truth, (on) => { state.show.truth = on; showTruthList(); draw(); }, 'The path(s) that make the action stationary, dashed'),
  hints: toggle('Downhill arrows', state.show.hints, (on) => { state.show.hints = on; draw(); }, 'Arrows: where each knot would go, on its own, to lower the action most'),
  phasor: toggle('Phasor', state.show.phasor, (on) => { state.show.phasor = on; $('#phasor').hidden = !on; $('#hbar-box').hidden = !on; draw(); }, "Feynman's arrow exp(iS/ħ) for your path"),
};
$('#shows').append(...Object.values(showToggles));
const hbarSlider = slider({ label: '<math><mi>ħ</mi></math>', labelHTML: true, min: 0.01, max: 10, log: true, value: state.hbar,
  title: "Planck's constant, for the phasor", onInput: (v) => { state.hbar = v; draw(); } });
$('#hbar-box').append(hbarSlider);

function showTruthList() {
  const box = $('#truth');
  box.replaceChildren();
  if (!state.show.truth) return;
  const d = state.sys;
  if (!truths.length) {
    const T = state.s1 - state.s0;
    box.append(el('div', {}, periodic()
      ? (d.id === 'pendulum' && T <= 2 * Math.PI ? 'No closed orbit: a pendulum takes at least 2π for a swing.  Make T longer.' : 'No closed orbit of this period.')
      : 'No true path found between these end points.'));
    return;
  }
  if (periodic() && d.family) box.append(el('div', { class: 'muted' }, 'Every swing takes one period: each of these loops is a true orbit, all with S = 0.  Shown: the one nearest your path.'));
  else if (periodic() && !truths[0].through) box.append(el('div', { class: 'muted' }, `The closed orbit of period ${fmt(state.s1 - state.s0, 3)} never reaches ${d.q} = ${fmt(state.q0, 3)}; it starts here at its turning point.`));
  truths.forEach((t, i) => {
    const kind = t.closed ? 'closed orbit' : t.index === 0 ? 'minimum' : `saddle point, index ${t.index}`;
    const way = t.closed && !t.family && truths.length > 1 && Math.abs(t.v0) > 1e-9 ? (t.v0 > 0 ? ', moving up first' : ', moving down first') : '';
    box.append(el('button', { type: 'button', class: 'path', title: 'Put your path on this true path', onclick: () => { setRolling(false); snapTo(t); evaluate(); record(); showTruthList(); draw(); } },
      el('span', { class: 'swatch', style: { borderColor: truthColor(i) } }),
      `${actionWord()} ${fmt(t.S, 5)} (${kind}${way})`, t === ref ? el('span', { class: 'mark' }, ' ◂') : null));
  });
}

// ------------------------------------------------------------------- drawing

const pathCanvas = $('#path');
let frame = null;            // the path plot's frame
let toPx = null, fromPx = null;

function truthColor(i) {
  return [themeColors().good, '#d9822b', '#b5527c', '#7d5bd0', '#3d8fb0'][i % 5];
}

function actionWord() {
  return { twin: 'S =', mirage: 'optical path', refraction: 'optical path', brachistochrone: 'time' }[state.sys.id] || 'S =';
}

function draw() {
  drawPath();
  drawHistory();
  drawPhase();
  drawEnergy();
  drawPhasor();
  updateReadout();
}

/** The range of q shown: the system's, widened to show the true paths whole. */
function viewRange() {
  let [lo, hi] = state.sys.qrange;
  const span = hi - lo;
  for (const t of truths) for (const q of t.q) if (Number.isFinite(q)) { lo = Math.min(lo, q - 0.05 * span); hi = Math.max(hi, q + 0.05 * span); }
  return [lo, hi];
}

/** The point of the path at s: [q, slope], or null. */
function pointAt(p, s) {
  const r = p.at(p.interval(s), s);
  return Number.isFinite(r[0]) && Number.isFinite(r[1]) ? r : null;
}

function drawPath() {
  const { ctx, width, height } = fitCanvas(pathCanvas);
  const c = themeColors(), d = state.sys;
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 52, right: 16, top: 12, bottom: 36 });
  frame = f;
  const [qlo, qhi] = viewRange();
  // A little room beyond the end points, so their squares show whole.
  const pad = 0.015 * (state.s1 - state.s0);
  if (d.vertical) { f.x0 = qlo; f.x1 = qhi; f.y0 = state.s0 - pad; f.y1 = state.s1 + pad; }
  else { f.x0 = state.s0 - pad; f.x1 = state.s1 + pad; f.y0 = d.flip ? qhi : qlo; f.y1 = d.flip ? qlo : qhi; }
  toPx = d.vertical ? (s, q) => [f.X(q), f.Y(s)] : (s, q) => [f.X(s), f.Y(q)];
  fromPx = d.vertical ? (px, py) => [f.invY(py), f.invX(px)] : (px, py) => [f.invX(px), f.invY(py)];

  f.clip();
  decorate(ctx, f, c);
  // True paths, dashed.
  if (state.show.truth) {
    truths.forEach((t, i) => {
      ctx.setLineDash([7, 5]);
      ctx.strokeStyle = truthColor(i);
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let j = 0; j < t.s.length; j++) {
        const [x, y] = toPx(t.s[j], t.q[j]);
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }
  // The drawn path.
  const p = path(), tr = p.trace(30);
  const bad = current && !Number.isFinite(current.S);
  ctx.strokeStyle = bad ? c.warn : c.accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let j = 0; j < tr.s.length; j++) {
    const [x, y] = toPx(tr.s[j], tr.q[j]);
    if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  if (state.show.hints && L && Number.isFinite(current?.S)) drawHints(ctx, f, c, p);
  drawSlope(ctx, c, p);
  // The knots: circles, the end points squares (a loop's two ends are one point: both filled).
  const n = state.knots.length, focused = document.activeElement === pathCanvas;
  for (let k = 0; k < n; k++) {
    const [x, y] = toPx(state.times[k], state.knots[k]), end = k === 0 || k === n - 1;
    ctx.fillStyle = end && periodic() ? c.accent : c.panel; ctx.strokeStyle = bad ? c.warn : c.accent; ctx.lineWidth = 2.5;
    ctx.beginPath();
    if (end) ctx.rect(x - 6, y - 6, 12, 12);
    else ctx.arc(x, y, 6.5, 0, 2 * Math.PI);
    ctx.fill(); ctx.stroke();
    if (dragging && dragging.k === k) { ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(x, y, 3, 0, 2 * Math.PI); ctx.fill(); }
    if (focused && state.sel === k) { ctx.strokeStyle = c.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 11, 0, 2 * Math.PI); ctx.stroke(); }
  }
  ctx.restore();
  f.axes({ xlabel: d.vertical ? d.q : d.s, ylabel: d.vertical ? d.s : d.q });
}

/**
 * Downhill arrows: at each knot, the way to move it (up or down, sooner or later) that lowers
 * the action fastest: straight downhill on the screen, time across and position up counted
 * pixel for pixel.  The steepest knot gets the longest arrow, and all shrink as the path nears
 * a stationary one (where a knot moved on its own would go only a few pixels).
 */
function drawHints(ctx, f, c, p) {
  const d = state.sys, n = p.q.length, { gq, cq, gs, cs, free } = downhill(p);
  const kx = f.w / Math.abs(f.x1 - f.x0), ky = f.h / Math.abs(f.y1 - f.y0);
  const ks = d.vertical ? ky : kx, kq = d.vertical ? kx : ky;
  const knots = [...free.filter((k) => k > 0), ...(periodic() ? [0, n - 1] : [])];
  const G = {};
  let gmax = 0, far = 0;
  for (const k of knots) {
    // The slope in pixels: dS/dpx across (time) and up (position); the ends keep their times.
    const timed = k > 0 && k < n - 1, Gs = timed ? gs[k] / ks : 0, Gq = gq[k] / kq;
    G[k] = [Gs, Gq];
    gmax = Math.max(gmax, Math.hypot(Gs, Gq));
    if (cq[k] > 0) far = Math.max(far, (Math.abs(gq[k]) / cq[k]) * kq);
    if (timed && cs[k] > 0) far = Math.max(far, (Math.abs(gs[k]) / cs[k]) * ks);
  }
  if (!(gmax > 0) || !Number.isFinite(gmax)) return;
  const scale = (60 * Math.min(1, far / 15)) / gmax;
  ctx.strokeStyle = c.ink2; ctx.fillStyle = c.ink2; ctx.lineWidth = 1.5;
  for (const k of knots) {
    const [Gs, Gq] = G[k], g = Math.hypot(Gs, Gq), len = g * scale;
    if (!(len >= 6)) continue;
    const [x0, y0] = toPx(state.times[k], state.knots[k]);
    const [xa, ya] = toPx(state.times[k] - Gs / g / ks, state.knots[k] - Gq / g / kq);
    const dx = xa - x0, dy = ya - y0, m = Math.hypot(dx, dy) || 1;
    arrow(ctx, x0 + (9 * dx) / m, y0 + (9 * dy) / m, x0 + ((9 + len) * dx) / m, y0 + ((9 + len) * dy) / m);
  }
}

/** What the slope of the path is called, and its value. */
function rateText(v, q) {
  const d = state.sys;
  if (Math.abs(v) < 1e-9) v = 0;
  if (d.id === 'twin') return `velocity dx/dt = ${fmt(v, 3)} c`;
  if (d.id === 'brachistochrone') return `slope ${fmt(v, 3)}, speed √(2gy) = ${fmt(Math.sqrt(2 * state.params.g * q), 3)}`;
  if (d.s === 'x') return `slope dy/dx = ${fmt(v, 3)}`;
  const name = d.q === 'θ' ? 'angular velocity θ̇' : `velocity ${d.q}̇`;
  return `${name} = ${fmt(v, 3)}`;
}

/**
 * The velocity, drawn: the tangent to the path where the pointer is, or, while a knot is being
 * dragged, halfway along the stretches before and after it.
 */
function drawSlope(ctx, c, p) {
  const where = [], n = p.q.length, T = state.s1 - state.s0;
  if (dragging) { for (const i of [dragging.k - 1, dragging.k]) if (i >= 0 && i < n - 1) where.push((p.s[i] + p.s[i + 1]) / 2); }
  else if (hover) where.push(clamp(hover.s, state.s0, state.s1));
  ctx.font = '12px system-ui, sans-serif';
  for (const s of where) {
    const pt = pointAt(p, s);
    if (!pt) continue;
    const [q, v] = pt, [x, y] = toPx(s, q), [x2, y2] = toPx(s + 1e-3 * T, q + v * 1e-3 * T);
    const len = Math.hypot(x2 - x, y2 - y) || 1, dx = (x2 - x) / len, dy = (y2 - y) / len;
    ctx.strokeStyle = c.ink; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x - 40 * dx, y - 40 * dy); ctx.lineTo(x + 40 * dx, y + 40 * dy); ctx.stroke();
    ctx.fillStyle = c.ink; ctx.beginPath(); ctx.arc(x, y, 3, 0, 2 * Math.PI); ctx.fill();
    const text = rateText(v, q), w = ctx.measureText(text).width;
    // The label above the line, or below it near the top.
    const lx = clamp(x - w / 2, frame.left + 4, frame.right - w - 4), ly = y - 22 < frame.top + 14 ? y + 30 : y - 22;
    ctx.fillStyle = c.panel; ctx.globalAlpha = 0.85; ctx.fillRect(lx - 3, ly - 12, w + 6, 16); ctx.globalAlpha = 1;
    ctx.fillStyle = c.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, lx, ly);
  }
}

function arrow(ctx, x0, y0, x1, y1) {
  const a = Math.atan2(y1 - y0, x1 - x0), h = 7;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - h * Math.cos(a - 0.4), y1 - h * Math.sin(a - 0.4));
  ctx.lineTo(x1 - h * Math.cos(a + 0.4), y1 - h * Math.sin(a + 0.4));
  ctx.closePath(); ctx.fill();
}

/** Backgrounds that say what the system is: light cones, glass, the potential's lay of the land. */
function decorate(ctx, f, c) {
  const d = state.sys;
  if (d.id === 'twin') {
    // The light cones of the two events: no world line may be flatter than 45°.
    ctx.fillStyle = c.line; ctx.globalAlpha = 0.35;
    for (const [s, q, dir] of [[state.s0, state.q0, 1], [state.s1, state.q1, -1]]) {
      const far = 50;
      ctx.beginPath();
      const [x, y] = toPx(s, q);
      ctx.moveTo(x, y);
      const [xa, ya] = toPx(s + dir * far, q - far), [xb, yb] = toPx(s + dir * far, q + far);
      ctx.lineTo(xa, ya); ctx.lineTo(xb, yb); ctx.closePath();
      // Shade outside the cone: the region a path may not enter.
      ctx.save();
      ctx.beginPath(); ctx.rect(f.left, f.top, f.w, f.h);
      ctx.moveTo(x, y); ctx.lineTo(xb, yb); ctx.lineTo(xa, ya); ctx.closePath();
      ctx.fill('evenodd');
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  } else if (d.id === 'refraction' || d.id === 'mirage') {
    // Shade by refractive index.
    const n = (y) => (d.id === 'mirage' ? state.params.n0 + state.params.alpha * y
      : (state.params.n1 + state.params.n2) / 2 + ((state.params.n1 - state.params.n2) / 2) * Math.tanh(y / 0.15));
    const [qlo, qhi] = d.qrange;
    for (let i = 0; i < 60; i++) {
      const y0 = qlo + ((qhi - qlo) * i) / 60, y1 = qlo + ((qhi - qlo) * (i + 1)) / 60;
      const shade = Math.max(0, Math.min(1, (n((y0 + y1) / 2) - 1) / 1.2));
      ctx.fillStyle = `rgba(80,140,230,${0.45 * shade})`;
      const [, ya] = toPx(state.s0, y0), [, yb] = toPx(state.s0, y1);
      ctx.fillRect(f.left, Math.min(ya, yb), f.w, Math.abs(yb - ya) + 1);
    }
  } else if (d.id === 'brachistochrone') {
    ctx.fillStyle = c.ink3; ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('g ↓', f.right - 34, f.top + 18);
  }
}

// The history of S: every path drawn, newest on the right.
function drawHistory() {
  const cv = $('#history');
  const { ctx, width, height } = fitCanvas(cv);
  const c = themeColors();
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 52, right: 10, top: 22, bottom: 34 });
  const vals = history.filter(Number.isFinite);
  ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = c.ink2;
  ctx.fillText('Action of each path drawn', 10, 15);
  if (!vals.length) return;
  // The range: everything recent, but not dominated by a few wild early values.
  const sorted = [...vals].sort((a, b) => a - b), last = vals[vals.length - 1];
  let lo = Math.min(sorted[0], last), hi = Math.max(sorted[sorted.length < 10 ? sorted.length - 1 : Math.floor(0.9 * (sorted.length - 1))], last);
  if (state.show.truth) for (const t of truths) { lo = Math.min(lo, t.S); hi = Math.max(hi, t.S); }
  // At least a few units of the fourth digit, so that the tick labels differ.
  const least = 2 * 10 ** (Math.floor(Math.log10(Math.max(Math.abs(lo), Math.abs(hi), 1e-6))) - 2);
  if (hi - lo < least) { const mid = (hi + lo) / 2; lo = mid - least / 2; hi = mid + least / 2; }
  const pad = 0.08 * (hi - lo);
  f.x0 = 0; f.x1 = Math.max(50, history.length); f.y0 = lo - pad; f.y1 = hi + pad;
  f.clip();
  if (state.show.truth) {
    truths.forEach((t, i) => {
      const y = f.Y(t.S);
      ctx.setLineDash([6, 4]); ctx.strokeStyle = truthColor(i); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(f.left, y); ctx.lineTo(f.right, y); ctx.stroke();
      ctx.setLineDash([]);
    });
  }
  ctx.strokeStyle = c.accent; ctx.lineWidth = 1.5;
  ctx.beginPath();
  let started = false;
  history.forEach((v, i) => {
    if (!Number.isFinite(v)) { started = false; return; }
    const x = f.X(i), y = f.Y(v);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  });
  ctx.stroke();
  const lastV = history[history.length - 1];
  if (Number.isFinite(lastV)) { ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(f.X(history.length - 1), f.Y(lastV), 3.5, 0, 2 * Math.PI); ctx.fill(); }
  ctx.restore();
  f.axes({ xlabel: 'changes →', yTicks: true });
}

// Feynman's arrow exp(iS/hbar).
function drawPhasor() {
  const cv = $('#phasor');
  if (!state.show.phasor) return;
  const { ctx, width } = fitCanvas(cv);
  const c = themeColors(), r = width / 2 - 4, cx = width / 2, cy = width / 2;
  ctx.clearRect(0, 0, width, width);
  ctx.strokeStyle = c.line; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.stroke();
  if (!current || !Number.isFinite(current.S)) return;
  const a = current.S / state.hbar;
  ctx.strokeStyle = c.accent; ctx.fillStyle = c.accent; ctx.lineWidth = 2;
  arrow(ctx, cx, cy, cx + r * 0.85 * Math.cos(a), cy - r * 0.85 * Math.sin(a));
  ctx.fillStyle = c.ink3; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('exp(iS/ħ)', cx, width - 1);
}

function computePhaseGrid() {
  phaseGrid = null;
  if (!L) return;
  const d = state.sys;
  // Only when L does not depend on s: then H(q, p) is conserved and its contours mean something.
  if (d.typed === 'L' || (d.typed === 'V' && typedExpr?.uses('t'))) return;
  const [qlo, qhi] = viewRange();
  // The momentum range of the paths, ignoring the extreme 3% (the brachistochrone's momentum
  // is infinite at its start).
  const seen = [];
  const consider = (q, v, s) => { const p = momentum(L, q, v, s); for (const x of p) if (Number.isFinite(x)) seen.push(x); };
  for (const t of truths) consider(t.q, t.v, t.s);
  if (current) consider(current.samples.q, current.samples.v, quad.s);
  if (!seen.length) return;
  seen.sort((a, b) => a - b);
  let plo = Math.min(0, seen[Math.floor(0.03 * (seen.length - 1))]), phi = Math.max(0, seen[Math.floor(0.97 * (seen.length - 1))]);
  const pad = 0.4 * Math.max(phi - plo, 1);
  plo -= pad; phi += pad;
  if (d.id === 'twin') { plo = Math.min(plo, -2); phi = Math.max(phi, 2); }
  const nq = 72, np = 60;
  const qs = Float64Array.from({ length: nq }, (_, i) => qlo + ((qhi - qlo) * i) / (nq - 1));
  const ps = Float64Array.from({ length: np }, (_, i) => plo + ((phi - plo) * i) / (np - 1));
  const H = hamiltonianGrid(L, qs, ps, state.s0);
  const finite = Array.from(H).filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length < 10) return;
  const levels = [];
  for (let i = 1; i < 14; i++) levels.push(finite[Math.floor((finite.length * i) / 14)]);
  phaseGrid = { H, nq, np, q0: qlo, q1: qhi, p0: plo, p1: phi, levels };
}

/** The hovered point of the path: {s, q, v}, or null. */
function hovered() {
  if (!hover || !current) return null;
  const p = path(), s = clamp(hover.s, state.s0, state.s1), pt = pointAt(p, s);
  return pt ? { s, q: pt[0], v: pt[1] } : null;
}

function drawPhase() {
  const cv = $('#phase');
  const { ctx, width, height } = fitCanvas(cv);
  const c = themeColors(), d = state.sys;
  ctx.clearRect(0, 0, width, height);
  ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = c.ink2;
  ctx.fillText(periodic() ? 'Phase space: a closed path is a loop' : 'Phase space: the path in (q, p)', 10, 15);
  if (!phaseGrid || !current) {
    ctx.fillStyle = c.ink3;
    const timeDependent = state.sys.typed === 'L' || (state.sys.typed === 'V' && typedExpr?.uses('t'));
    ctx.fillText(phaseGrid ? '' : timeDependent ? 'L depends on time: H is not conserved, no contours' : '', 10, 34);
    if (!current) return;
  }
  const f = new Frame(ctx, width, height, { left: 46, right: 10, top: 22, bottom: 34 });
  const g = phaseGrid;
  f.x0 = g ? g.q0 : viewRange()[0]; f.x1 = g ? g.q1 : viewRange()[1];
  const tr = path().trace(30), pTr = momentum(L, tr.q, tr.v, tr.s);
  // The contours' range, stretched (while dragging) to keep the whole path in view.
  const fin = Array.from(pTr).filter(Number.isFinite).sort((a, b) => a - b);
  let plo = g?.p0 ?? Infinity, phi = g?.p1 ?? -Infinity;
  if (fin.length) {
    const a = fin[Math.floor(0.01 * (fin.length - 1))], b = fin[Math.ceil(0.99 * (fin.length - 1))], pad = 0.1 * (b - a || 1);
    if (!g || a < plo || b > phi) { plo = Math.min(plo, a - pad); phi = Math.max(phi, b + pad); }
  }
  if (!(phi > plo)) { plo = -1; phi = 1; }
  f.y0 = plo; f.y1 = phi;
  f.clip();
  if (g) {
    ctx.strokeStyle = c.line; ctx.lineWidth = 1;
    ctx.beginPath();
    const X = (i) => f.X(g.q0 + ((g.q1 - g.q0) * i) / (g.nq - 1)), Y = (j) => f.Y(g.p0 + ((g.p1 - g.p0) * j) / (g.np - 1));
    for (const level of g.levels) contour(g.H, g.nq, g.np, level, (x0, y0, x1, y1) => { ctx.moveTo(X(x0), Y(y0)); ctx.lineTo(X(x1), Y(y1)); });
    ctx.stroke();
  }
  const curve = (q, p, color, dash, width2) => {
    ctx.strokeStyle = color; ctx.lineWidth = width2; ctx.setLineDash(dash);
    ctx.beginPath();
    let on = false;
    for (let i = 0; i < q.length; i++) {
      if (!Number.isFinite(p[i])) { on = false; continue; }
      const x = f.X(q[i]), y = f.Y(p[i]);
      if (!on) { ctx.moveTo(x, y); on = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.setLineDash([]);
  };
  if (state.show.truth) truths.forEach((t, i) => curve(t.q, momentum(L, t.q, t.v, t.s), truthColor(i), [6, 4], 1.8));
  curve(tr.q, pTr, c.accent, [], 2.2);
  // Where the path starts (and, for a loop, ends).
  if (Number.isFinite(pTr[0])) { ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(f.X(tr.q[0]), f.Y(pTr[0]), 3.5, 0, 2 * Math.PI); ctx.fill(); }
  const h = hovered();
  if (h) {
    const ph = momentum(L, Float64Array.of(h.q), Float64Array.of(h.v), Float64Array.of(h.s))[0];
    if (Number.isFinite(ph)) { ctx.strokeStyle = c.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(f.X(h.q), f.Y(ph), 5, 0, 2 * Math.PI); ctx.stroke(); }
  }
  ctx.restore();
  f.axes({ xlabel: d.q, ylabel: 'p' });
}

function drawEnergy() {
  const cv = $('#energy');
  const { ctx, width, height } = fitCanvas(cv);
  const c = themeColors(), d = state.sys;
  ctx.clearRect(0, 0, width, height);
  ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = c.ink2;
  ctx.fillText('Energy along the path', 10, 15);
  if (!current || !L) return;
  const f = new Frame(ctx, width, height, { left: 46, right: 10, top: 22, bottom: 34 });
  const tr = path().trace(30), E = energy(L, tr.q, tr.v, tr.s);
  const all = Array.from(E).filter(Number.isFinite);
  const tE = state.show.truth ? truths.map((t) => energy(L, t.q, t.v, t.s)) : [];
  for (const e of tE) for (const x of e) if (Number.isFinite(x)) all.push(x);
  if (!all.length) return;
  const sorted = all.sort((a, b) => a - b);
  let lo = sorted[Math.floor(0.005 * (sorted.length - 1))], hi = sorted[Math.ceil(0.995 * (sorted.length - 1))];
  // Not so zoomed in that rounding looks like a change of energy: at least a twentieth of the
  // range of the contours in phase space.
  const least = phaseGrid ? 0.05 * (phaseGrid.levels[phaseGrid.levels.length - 1] - phaseGrid.levels[0]) : 1e-6 * (1 + Math.abs(hi));
  if (hi - lo < least) { const mid = (hi + lo) / 2; lo = mid - least / 2; hi = mid + least / 2; }
  const pad = 0.1 * (hi - lo);
  f.x0 = state.s0; f.x1 = state.s1; f.y0 = lo - pad; f.y1 = hi + pad;
  f.clip();
  const line = (s, e, color, dash, w) => {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash); ctx.beginPath();
    let on = false;
    for (let i = 0; i < s.length; i++) {
      if (!Number.isFinite(e[i])) { on = false; continue; }
      if (!on) { ctx.moveTo(f.X(s[i]), f.Y(e[i])); on = true; } else ctx.lineTo(f.X(s[i]), f.Y(e[i]));
    }
    ctx.stroke(); ctx.setLineDash([]);
  };
  tE.forEach((e, i) => line(truths[i].s, e, truthColor(i), [6, 4], 1.8));
  line(tr.s, E, c.accent, [], 2);
  // The knot times, faintly: a straight-segment path's energy jumps there.
  ctx.strokeStyle = c.line; ctx.lineWidth = 1;
  for (let k = 1; k < state.times.length - 1; k++) { const x = Math.round(f.X(state.times[k])) + 0.5; ctx.beginPath(); ctx.moveTo(x, f.bottom - 6); ctx.lineTo(x, f.bottom); ctx.stroke(); }
  const h = hovered();
  if (h) {
    const eh = energy(L, Float64Array.of(h.q), Float64Array.of(h.v), Float64Array.of(h.s))[0];
    if (Number.isFinite(eh)) { ctx.strokeStyle = c.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(f.X(h.s), f.Y(eh), 5, 0, 2 * Math.PI); ctx.stroke(); }
  }
  ctx.restore();
  f.axes({ xlabel: d.s, ylabel: 'E' });
}

// The readout: a row of labelled slots, each number in a fixed width (monospace, a fixed
// number of decimals for the set-up, a place kept for the sign, right-aligned), so that nothing
// moves while the numbers change.  The words about the true path come last.
let slots = null;             // {key: value element}, and the set-up they were made for
function layoutReadout() {
  const box = $('#readout'), d = state.sys, t = ref || truths[0];
  // Decimals from the size of the true action, kept until the next set-up: about five figures.
  const scale = Math.max(1, Math.abs(t?.S ?? current?.S ?? 1), Math.abs(current?.kinetic ?? 0));
  const ints = Math.floor(Math.log10(scale)) + 1, decimals = clamp(5 - ints, 1, 4), width = ints + decimals + 3;
  const items = d.id === 'twin' ? [['main', 'τ ='], ['S', 'S = −mτ =']]
    : [['main', actionWord()], ...(L && (L.kinetic || L.vOfP) ? [['T', '∫T dt'], ['V', '−∫V dt']] : [])];
  items.push(['dS', 'ΔS']);
  box.replaceChildren();
  slots = { decimals, sys: d, ends: state.ends };
  for (const [key, label] of items) {
    const value = el('span', { class: 'num', style: { width: `${width + (key === 'dS' ? 1 : 0)}ch` } });
    box.append(el('span', { class: key === 'main' ? 'slot big' : 'slot' }, el('span', { class: 'lab' }, label), value));
    slots[key] = value;
  }
  slots.note = el('span', { class: 'note' });
  box.append(slots.note);
}

/** A number in the readout's fixed layout: fixed decimals, a sign or a space before it. */
function fixed(v, decimals, plus = ' ') {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v).toFixed(decimals);
  return (v < 0 && Number(a) !== 0 ? '−' : plus) + a;
}

function updateReadout() {
  const d = state.sys;
  if (!slots || slots.sys !== d || slots.ends !== state.ends) layoutReadout();
  const n = slots.decimals, S = current ? current.S : NaN, t = ref || truths[0];
  const m = state.params.m ?? 1, ok = Number.isFinite(S);
  slots.main.textContent = fixed(d.id === 'twin' ? -S / m : S, n);
  if (slots.S) slots.S.textContent = fixed(S, n);
  if (slots.T) slots.T.textContent = fixed(current?.kinetic, n);
  if (slots.V) slots.V.textContent = fixed(S - current?.kinetic, n);
  let note = '', cls = '';
  if (!ok) {
    note = d.id === 'twin' ? 'faster than light somewhere: no proper time, no action'
      : d.id === 'brachistochrone' ? 'the bead would have to climb above its start' : 'the action is undefined for this path';
    cls = 'warn';
  } else if (t) {
    const diff = S - t.S, tol = 2e-4 * (1 + Math.abs(t.S)), what = t.closed ? 'true orbit' : 'true path';
    if (diff < -tol) { note = `below the ${what}: it is a saddle, not a minimum!`; cls = 'warn'; }
    else if (state.onTrue && state.mode === 'segments' && diff > tol) note = `the best straight segments: above the ${what}`;
    else if (state.onTrue && diff > tol) { note = `on the ${what}, as near as ${state.knots.length} knots can draw it`; cls = 'good'; }
    else if (state.onTrue || Math.abs(diff) <= tol) { note = `on the ${what}`; cls = 'good'; }
    else if (t.family && Math.abs(S - familyS) <= tol) { note = `on a true orbit, as near as ${state.knots.length} knots can draw it`; cls = 'good'; }
    else note = `above the ${what}`;
  }
  if (slots.dS) slots.dS.textContent = t && ok ? fixed(S - t.S, n, '+') : '—';
  slots.note.textContent = note;
  slots.note.className = `note ${cls}`;
}

// --------------------------------------------------------------- dragging knots

// Press anywhere: the nearest knot follows the pointer from where it was (up-down moves it in
// place, sideways in time).  Shift keeps it to one direction.
let dragging = null;
const local = (e) => { const r = pathCanvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
pathCanvas.addEventListener('pointerdown', (e) => {
  if (!frame || !toPx) return;
  const [px, py] = local(e);
  let best = -1, bestD = Infinity;
  for (let k = 0; k < state.knots.length; k++) {
    if (k === 0 && state.sys.lockStart) continue;   // the brachistochrone's bead starts from rest at the top
    const [x, y] = toPx(state.times[k], state.knots[k]), dd = Math.hypot(x - px, y - py);
    if (dd < bestD) { bestD = dd; best = k; }
  }
  if (best < 0) return;
  const [s, q] = fromPx(px, py);
  dragging = { k: best, ds: state.times[best] - s, dq: state.knots[best] - q, x0: px, y0: py, axis: null };
  state.sel = best;
  hover = null;
  pathCanvas.setPointerCapture(e.pointerId);
  pathCanvas.classList.add('dragging');
  setRolling(false);
  refresh(false);
  e.preventDefault();
});
pathCanvas.addEventListener('pointermove', (e) => {
  let [px, py] = local(e);
  if (!dragging) {
    hover = frame && px >= frame.left && px <= frame.right && py >= frame.top && py <= frame.bottom ? { s: fromPx(px, py)[0] } : null;
    refresh(false);
    return;
  }
  if (e.shiftKey) {
    if (!dragging.axis && Math.hypot(px - dragging.x0, py - dragging.y0) > 4) dragging.axis = Math.abs(px - dragging.x0) > Math.abs(py - dragging.y0) ? 'x' : 'y';
    if (dragging.axis === 'x') py = dragging.y0; else if (dragging.axis === 'y') px = dragging.x0;
  } else dragging.axis = null;
  const [s, q] = fromPx(px, py);
  moveKnotTo(dragging.k, s + dragging.ds, q + dragging.dq);
  refresh(true);
});
const endDrag = () => { if (dragging) { dragging = null; pathCanvas.classList.remove('dragging'); regrid(); draw(); } };

/** New contours for phase space if the path has left the old ones. */
function regrid() {
  if (!phaseGrid || !current) return;
  const p = momentum(L, current.samples.q, current.samples.v, quad.s), fin = Array.from(p).filter(Number.isFinite).sort((a, b) => a - b);
  if (!fin.length) return;
  const a = fin[Math.floor(0.03 * (fin.length - 1))], b = fin[Math.floor(0.97 * (fin.length - 1))];
  if (a < phaseGrid.p0 || b > phaseGrid.p1) computePhaseGrid();
}
pathCanvas.addEventListener('pointerup', endDrag);
pathCanvas.addEventListener('pointercancel', endDrag);
pathCanvas.addEventListener('pointerleave', () => { if (!dragging && hover) { hover = null; refresh(false); } });

/** Move knot k to (s, q), as far as it may go: in order in time, the ends at their times. */
function moveKnotTo(k, s, q) {
  const n = state.knots.length, d = state.sys, [qlo, qhi] = d.qrange, span = qhi - qlo;
  if (k === 0 && d.lockStart) return;
  q = clamp(q, qlo - 0.05 * span, qhi + 0.05 * span);
  const end = k === 0 || k === n - 1;
  if (!end) state.times[k] = clamp(s, state.times[k - 1] + gap(), state.times[k + 1] - gap());
  state.knots[k] = q;
  if (periodic() && end) { state.knots[0] = state.knots[n - 1] = q; state.q0 = state.q1 = q; }
  else if (k === 0) state.q0 = q;
  else if (k === n - 1) state.q1 = q;
  state.onTrue = false;
  if (end) recomputeTruth(120);
}

// One evaluation and one history point per animation frame, however fast the pointer.
let frameDue = false, pathChanged = false;
function refresh(changed) {
  pathChanged ||= changed;
  if (frameDue) return;
  frameDue = true;
  requestAnimationFrame(() => {
    frameDue = false;
    if (pathChanged) { pathChanged = false; evaluate(); record(); }
    draw();
  });
}

// Keyboard: [ and ] choose a knot, the arrow keys move it (Shift: further), for those who can't drag.
pathCanvas.addEventListener('keydown', (e) => {
  const n = state.knots.length, first = state.sys.lockStart ? 1 : 0;
  if (e.key === '[' || e.key === ']') {
    e.preventDefault();
    state.sel = clamp(state.sel + (e.key === ']' ? 1 : -1), first, n - 1);
    draw();
    return;
  }
  const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
  if (!dir || !frame) return;
  e.preventDefault();
  setRolling(false);
  const k = clamp(state.sel, first, n - 1), stepPx = (e.shiftKey ? 25 : 5);
  const [x, y] = toPx(state.times[k], state.knots[k]);
  const [s, q] = fromPx(x + dir[0] * stepPx, y + dir[1] * stepPx);
  moveKnotTo(k, s, q);
  refresh(true);
});
pathCanvas.addEventListener('focus', () => draw());
pathCanvas.addEventListener('blur', () => draw());

window.addEventListener('resize', () => draw());

// ------------------------------------------------------------------ experiments

const byId = (id) => SYSTEMS.find((s) => s.id === id);
function setShow(over) {
  for (const [k, t] of Object.entries(showToggles)) {
    const on = over[k] ?? (k === 'phasor' || k === 'truth');
    t.on = on; state.show[k] = on;
  }
  $('#phasor').hidden = !state.show.phasor; $('#hbar-box').hidden = !state.show.phasor;
}
/** Set up a system on its true path; `then` changes it afterwards (a bend, say). */
function go(id, { knots, show = {}, mode = 'spline', T, params, ends = 'fixed', keepShow = false, then } = {}) {
  setRolling(false);
  state.mode = mode; modeSeg.value = mode;
  if (!keepShow) setShow(show);
  setSystem(byId(id), { knots, T, params, ends });
  then?.();
  showTruthList();
  draw();
}

const setups = {
  find: () => go('free'),
  throw: () => go('gravity'),
  hints: () => go('gravity', { show: { hints: true }, knots: 7, then: () => bend(-1) }),
  energy: () => go('gravity', { knots: 6 }),
  phase: () => go('harmonic'),
  orbit: () => go('pendulum', { ends: 'periodic', T: 8, knots: 12 }),
  saddle: () => go('harmonic', { T: 4 }),
  pendulum: () => go('pendulum'),
  twin: () => go('twin', { mode: 'segments' }),
  light: () => go('refraction'),
  brach: () => go('brachistochrone'),
  segments: () => go('gravity', { mode: 'segments', knots: 4 }),
  feynman: () => go('gravity'),
  damped: () => go('typedL'),
  typed: () => go('typedV'),
};
drawer($('#help'), $('#help-button'), setups);

// ------------------------------------------------------------------------ start

const hash = readHash();
setShow({});
if (setups[hash.setup]) setups[hash.setup]();
else if (!fromHash(hash)) go('gravity');

window.__app = {
  state, setups, setSystem, setRolling, snapTo, bend, path, downhill, moveKnotTo,
  get truths() { return truths; }, get ref() { return ref; }, get current() { return current; }, get history() { return history; },
  get frame() { return frame; }, get hover() { return hover; }, toPx: (s, q) => toPx(s, q),
  ready: true,
};
