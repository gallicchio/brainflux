// The least-action demo: drag the knots of a path between two events, in place or in time, and
// watch its action against the true path's.  Every set-up starts on the true path, so any change
// shows what it costs.

import { Path, action, knotQuadrature, truePaths, closedOrbits, truthAt, stationaryKnots, freeKnots, knotDerivatives, knotTimeDerivatives, knotPhasors, momentum, energy, hamiltonianGrid } from './physics.js';
import { SYSTEMS, typedSystem } from './systems.js';
import { el, $, slider, segmented, toggle, exprField, drawer, readHash, writeHash, fmt, fixedNum } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors, contour, fillSlots, slotsWidth } from '../lib/plot.js';
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
  show: { truth: true, hints: false },
  view: 'phase',                // the view under the path: 'phase', 'energy' or 'phasor'
  hbar: 1,
  rolling: false,
  onTrue: false,                // still the true path it was put on: it follows when T or a parameter changes
  sel: 2,                       // the knot the arrow keys move, and whose heights the phasors sum over
};
let L = null;                 // the system's Lagrangian object
let typedExpr = null;
let quad = null;
let truths = [];              // the true paths: [{s, q, v, S, kin, index, closed}]
let ref = null;               // the one the path was put on, for the score
let familyB = 0;              // the oscillator's closed orbit q0 cos ωt + B sin ωt nearest the path
let familyS = NaN;            // ... and the action of the path through it at the same knots
let history = [];             // every path drawn: [{S, tag}], in order
let current = null;           // {S, samples, kinetic}
let phaseGrid = null;         // {H, nq, np, q0, q1, p0, p1, levels}
let hover = null;             // {s, knot}: the time under the pointer, and the knot it is on
let dragging = null;
let pathView = null;          // the q range of the path plot, held while a knot is dragged
let scale = 1;                // the size of the true path's action, for the decimals and the record
let phasor = null;            // the last sum of Feynman's arrows
const ranges = { record: null, p: null, energy: null };   // the plots' ranges, held still (sticky)

const HISTORY = 400, WINDOW = 160;

function paramValues() { return { ...state.params }; }
const periodic = () => state.ends === 'periodic';
const qopt = () => ({ count: 600, singularStart: !!state.sys.singularStart });
const uniformTimes = (n) => Float64Array.from({ length: n }, (_, i) => state.s0 + ((state.s1 - state.s0) * i) / (n - 1));
// The knots keep their order in time, at least this far apart.
const gap = () => (0.2 * (state.s1 - state.s0)) / (state.knots.length - 1);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const busy = () => !!dragging || state.rolling;

function buildL() {
  const d = state.sys;
  if (d.typed) {
    if (!typedExpr) return null;
    L = typedSystem(d.typed, typedExpr, typedField?.params || {}, state.params.m ?? 1);
  } else L = d.make(paramValues());
  return L;
}

function path() { return new Path(state.s0, state.s1, state.knots, state.mode, { s: state.times, periodic: periodic() }); }

/** The kinetic part of the action, ∫ T dt, along samples {q, v} with weights w (or null). */
function kineticIntegral(q, v, w) {
  if (!L?.kinetic) return null;
  const K = L.kinetic(q, v);
  let sum = 0;
  for (let i = 0; i < K.length; i++) sum += K[i] * w[i];
  return sum;
}

/** The kinetic part along a true path's samples (Simpson's rule: an even number of steps). */
function truthKinetic(t) {
  if (!L?.kinetic) return null;
  const n = t.s.length - 1, h = (t.s[n] - t.s[0]) / n, w = new Float64Array(n + 1);
  if (n % 2) { w.fill(h); w[0] = w[n] = h / 2; }
  else for (let j = 0; j <= n; j++) w[j] = (h / 3) * (j === 0 || j === n ? 1 : j % 2 ? 4 : 2);
  return kineticIntegral(t.q, t.v, w);
}

/** The action of the current path, and the kinetic part when the system can say. */
function evaluate() {
  if (!L) { current = null; return; }
  quad = knotQuadrature(state.times, qopt().count, qopt().singularStart);
  const a = action(L, path(), quad);
  current = { S: a.S, samples: a.samples, kinetic: kineticIntegral(a.samples.q, a.samples.v, quad.w) };
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
  truths = [withKinetic(state.sys.family(paramValues(), state.s0, state.q0, state.s1, familyB))];
  ref = truths[0];
  const p = path();
  familyS = action(L, p.withKnots(truthAt(ref, state.times)), quad).S;
}

function withKinetic(t) { if (t) t.kin = truthKinetic(t); return t; }

/** Add the current action to the record; tag: a word for what made the change (a button). */
function record(tag = null) {
  history.push({ S: current && Number.isFinite(current.S) ? current.S : NaN, tag });
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
    if (state.view !== 'phase') h.view = state.view;
    if (state.view === 'phasor') { h.hbar = r(state.hbar); h.k = state.sel; }
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
    if (VIEWS.some((v) => v.value === h.view)) setView(h.view);
    if (+h.hbar > 0) { state.hbar = +h.hbar; hbarSlider.value = state.hbar; }
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
      if (Number.isInteger(+h.k) && +h.k >= 0 && +h.k < n) state.sel = +h.k;
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

let truthTimer = 0, truthPending = false;
/** Find the true paths again; snap: put the path on the one of least action. */
function recomputeTruth(delay = 0, { snap = false } = {}) {
  clearTimeout(truthTimer);
  const run = () => {
    truthPending = false;
    if (!L) { truths = []; ref = null; return; }
    try { truths = computeTruths().map(withKinetic); } catch { truths = []; }
    ref = snap ? truths[0] || null : sameTruth(ref);
    if ((snap || state.onTrue) && ref) snapTo(ref);
    evaluate();
    if (snap) {
      slots = null;
      const t = ref || truths[0];
      scale = Math.max(1e-3, Math.abs(t?.S ?? current?.S ?? 1), Math.abs(t?.kin ?? 0), Math.abs((t?.S ?? 0) - (t?.kin ?? 0)));
      ranges.record = ranges.p = ranges.energy = null;
      pathView = null;
      record('start');
    }
    if (!dragging) pathView = null;
    computePhaseGrid();
    showTruthList();
    draw();
  };
  if (delay) { truthPending = true; truthTimer = setTimeout(run, delay); } else run();
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
  const b = el('button', { type: 'button', 'aria-pressed': 'false', title: d.blurb, onclick: () => go(d.id, { keepShow: true, view: state.view, mode: d.mode || (state.sys.mode ? 'spline' : state.mode) }) }, d.label);
  $('#systems').append(b);
  sysButtons[d.id] = b;
}

let typedField = null;
let paramSliders = {};

/** What a knot is called, and how it moves, for the key and the instructions. */
function words() {
  const d = state.sys;
  if (d.vertical) return { knot: 'event', move: 'drag ↔ where, ↕ when', end: 'drag ↔' };
  if (d.s === 'x') return { knot: 'point', move: 'drag ↕ or ↔', end: d.lockStart ? 'end: drag ↕ (the start stays)' : 'drag ↕' };
  return { knot: 'knot', move: 'drag ↕ where, ↔ when', end: 'drag ↕' };
}

function setKey() {
  const w = words(), truth = { brachistochrone: 'cycloid', refraction: 'true ray', mirage: 'true ray' }[state.sys.id] || (periodic() ? 'true orbit' : 'true path');
  const endText = periodic() ? '<span><i class="end filled"></i>start = end: drag ↕</span>'
    : state.sys.lockStart ? `<span><i class="end"></i>${w.end}</span>` : `<span><i class="end"></i>end: ${w.end}</span>`;
  $('#path-key').innerHTML = `<span><i class="you"></i>your path</span>${state.show.truth ? `<span><i class="true"></i>${truth}<span class="under"></span></span>` : ''}`
    + `<span><i class="knot"></i>${w.knot}: ${w.move}</span>${endText}`;
}

/**
 * Choose a system, with optional knot count, duration T, parameters and ends, and put the path
 * on its true path (the one of least action).
 */
function setSystem(d, { knots, T, params, ends = 'fixed' } = {}) {
  setRolling(false);
  stopMorph();
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
  $('#howto').textContent = d.vertical
    ? 'Drag an event ○ sideways to change where the traveller is, or up or down to change when.  A drag moves one way only (Shift: both ways).  The slope is the velocity: point at the world line to read it.'
    : d.s === 'x'
      ? 'Drag a point ○ up or down to move the curve, or sideways to slide the point along it.  A drag moves one way only (Shift: both ways).'
      : `Drag a knot ○ up or down to change where the particle is, sideways to change when.  A drag moves one way only (Shift: both ways); the ${periodic() ? 'shared end ■ moves' : 'ends □ move'} up and down.  The slope is the velocity: point at the path to read it.`;
  // The wrong paths to try, named for this plot.
  const up = d.vertical ? 'Bend →' : 'Bend ↑', down = d.vertical ? 'Bend ←' : 'Bend ↓';
  $('#bend-up').textContent = up; $('#bend-down').textContent = down;
  $('#rush').hidden = d.s !== 't';
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
  setKey();
  setCaption();
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
  setCaption();
  recomputeTruth(0, { snap });
}

// ----------------------------------------------------------------- path controls

const knotSlider = slider({ label: 'Knots', min: 3, max: 16, step: 1, value: 5, title: 'How many points the path is drawn through',
  onInput: (v) => setKnotCount(Math.round(v)) });
$('#knot-box').append(knotSlider);

function setKnotCount(n) {
  if (n === state.knots.length) return;
  setRolling(false);
  stopMorph();
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
  evaluate(); record('knots'); draw();
}

const modeSeg = segmented([
  { value: 'spline', label: 'Smooth', title: 'A smooth curve (cubic spline) through the knots' },
  { value: 'segments', label: 'Straight segments', title: 'Straight lines between the knots: constant speed along each' },
], state.mode, (v) => {
  state.mode = v;
  if (state.onTrue && ref) snapTo(ref);
  evaluate(); record(v === 'segments' ? 'segments' : 'smooth'); draw();
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
  go(d.id, { ends: v, T, knots, mode: state.mode, params: { ...state.params }, keepShow: true, view: v === 'periodic' ? 'phase' : state.view });
}

/**
 * A change made by a button, shown as it happens: the knots move from where they are to
 * (knots, times) over a dozen frames, every frame a point in the record (the first one tagged),
 * so you see the path bend and its action climb.  after: what to do once there.
 */
let morph = null;
const MORPH_FRAMES = 12;
function morphTo(knots, times, tag, after = null) {
  setRolling(false);
  state.onTrue = false;
  morph = { q0: Float64Array.from(state.knots), s0: Float64Array.from(state.times), q1: Float64Array.from(knots), s1: Float64Array.from(times), frame: 0, tag, after };
  requestAnimationFrame(morphStep);
}
function morphStep() {
  const m = morph;
  if (!m) return;
  m.frame++;
  const u = Math.min(1, m.frame / MORPH_FRAMES), e = 0.5 - 0.5 * Math.cos(Math.PI * u);
  state.knots = Float64Array.from(m.q0, (a, i) => a + (m.q1[i] - a) * e);
  state.times = Float64Array.from(m.s0, (a, i) => a + (m.s1[i] - a) * e);
  if (u >= 1) { state.knots = m.q1; state.times = m.s1; morph = null; m.after?.(); }
  evaluate(); record(m.frame === 1 ? m.tag : null);
  if (!morph) regrid();
  draw();
  if (morph) requestAnimationFrame(morphStep);
}
/** Stop a change half-way (a knot was grabbed). */
function stopMorph() { morph = null; }

function straight() {
  const n = state.knots.length;
  const q = Float64Array.from(state.times, (s) => state.q0 + ((state.q1 - state.q0) * (s - state.s0)) / (state.s1 - state.s0));
  if (periodic()) q.fill(state.q0);
  q[n - 1] = state.q1;
  morphTo(q, state.times, 'straight');
}
$('#straight').addEventListener('click', straight);

/** Put the path back on the true path t (by default the one it was on), moving there. */
function backToTrue(t = ref || truths[0]) {
  setRolling(false);
  if (!t || (periodic() && state.sys.family && !truths.length)) return;
  // Where snapTo would put it: worked out, then the path moved there.
  const q = state.knots, s = state.times, q0 = state.q0, q1 = state.q1;
  snapTo(t);
  const target = [state.knots, state.times];
  state.knots = q; state.times = s; state.q0 = q0; state.q1 = q1;
  if (periodic()) { state.q0 = state.q1 = target[0][0]; }
  morphTo(target[0], target[1], 'true', () => { state.onTrue = true; ref = t; showTruthList(); });
}
$('#reset').addEventListener('click', () => backToTrue());

/** Bend the path by half a sine wave (a whole one for a loop): sign +1 up the screen (or right). */
function bend(sign) {
  const d = state.sys, [qlo, qhi] = d.qrange, a = 0.12 * (qhi - qlo) * sign * (d.flip ? -1 : 1), T = state.s1 - state.s0;
  const k = periodic() ? 2 : 1, base = morph ? morph.q1 : state.knots, times = morph ? morph.s1 : state.times;
  const q = Float64Array.from(base, (x, i) => x + a * Math.sin((k * Math.PI * (times[i] - state.s0)) / T));
  morphTo(q, times, sign > 0 ? (d.vertical ? 'bend →' : 'bend ↑') : (d.vertical ? 'bend ←' : 'bend ↓'));
}
$('#bend-up').addEventListener('click', () => bend(1));
$('#bend-down').addEventListener('click', () => bend(-1));

/**
 * Reach every knot sooner and dawdle afterwards: t -> t - c sin(π t/T), the knots keeping their
 * places, so the path passes the same places at the wrong times.  (c π/T < 1 keeps the order.)
 */
function rush() {
  const T = state.s1 - state.s0, c = 0.12 * T, n = state.times.length, g = gap(), from = morph ? morph.s1 : state.times;
  const t = Float64Array.from(from, (s) => s - c * Math.sin((Math.PI * (s - state.s0)) / T));
  t[0] = state.s0; t[n - 1] = state.s1;
  for (let k = 1; k < n - 1; k++) t[k] = clamp(t[k], t[k - 1] + g, state.s1 - (n - 1 - k) * g);
  morphTo(morph ? morph.q1 : state.knots, t, 'rush');
}
$('#rush').addEventListener('click', rush);

const rollButton = $('#roll');
rollButton.addEventListener('click', () => setRolling(!state.rolling));
function setRolling(on) {
  const was = state.rolling;
  state.rolling = on;
  rollButton.setAttribute('aria-pressed', String(on));
  if (on && !was) { stopMorph(); rollFrames = 0; rollLog = []; record('roll'); requestAnimationFrame(roll); }
}

/**
 * The slope of the action at every knot, up-down (q) and in time (s), with the curvatures:
 * {gq, cq, gs, cs} over all knots, zero where a knot may not move.
 */
function downhill(p, inTime = true) {
  const n = p.q.length, free = freeKnots(p).filter((k) => !(k === 0 && state.sys.lockStart));
  const D = knotDerivatives(L, p, quad, free), T = inTime ? knotTimeDerivatives(L, p, qopt()) : null;
  const gq = new Float64Array(n), cq = new Float64Array(n);
  free.forEach((k, a) => { gq[k] = D.g[a]; cq[k] = D.H[a][a]; });
  if (p.periodic) { gq[n - 1] = gq[0]; cq[n - 1] = cq[0]; }
  return { gq, cq, gs: T?.g, cs: T?.c, free };
}

let rollFrames = 0, rollLog = [];
/**
 * One step of rolling downhill; false when it is over (settled, stalled or running away).  The
 * knots slide up and down only, each by its own slope over its own curvature (half a Newton
 * step for it alone): stable where S curves upwards, and running away, as it should, along any
 * direction where S curves down.  They keep their times: moving them in time as well made them
 * bunch, which stiffened the path and slowed a run-away from a saddle to a crawl.  So the path
 * settles on the true path through knots at the times they have (the arrows still show the
 * slope in time).
 */
function rollStep() {
  if (!state.rolling || !L) return false;
  const p = path(), n = p.q.length, { gq, cq, free } = downhill(p, false);
  let cmax = 0, worst = 0;
  for (const k of free) cmax = Math.max(cmax, cq[k]);
  if (!(cmax > 0)) { stopRolling(); return false; }
  const [qlo, qhi] = state.sys.qrange, span = qhi - qlo;
  for (const k of free) {
    const c = cq[k] > 1e-6 * cmax ? cq[k] : cmax, step = (-0.5 * gq[k]) / c;
    if (!Number.isFinite(step)) { stopRolling(); return false; }
    worst = Math.max(worst, Math.abs(step));
    // As far as a drag may take it: a run-away ends against the edge of the plot.
    state.knots[k] = clamp(state.knots[k] + clamp(step, -0.04 * span, 0.04 * span), qlo - 0.05 * span, qhi + 0.05 * span);
  }
  if (periodic()) { state.knots[n - 1] = state.knots[0]; state.q0 = state.q1 = state.knots[0]; }
  state.onTrue = false;
  evaluate(); record();
  rollFrames++;
  // Done when nothing moves any more, or the action has stopped falling.
  rollLog.push(current.S);
  const old = rollLog.length > 90 ? rollLog[rollLog.length - 91] : NaN;
  const settled = worst < 1e-7 * span;
  const stalled = Math.abs(old - current.S) < 1e-9 * (1 + Math.abs(current.S));
  const away = state.knots.some((q) => q < qlo - span || q > qhi + span);
  if (settled || stalled || away || !Number.isFinite(current.S) || rollFrames > 2000) { stopRolling(); return false; }
  return true;
}
function stopRolling() {
  setRolling(false);
  if (periodic()) recomputeTruth(0); else { regrid(); draw(); }
}
function roll() {
  if (!state.rolling) return;
  const more = rollStep();
  draw();
  if (more) requestAnimationFrame(roll);
}

// What to show.
const showToggles = {
  truth: toggle('True path', state.show.truth, (on) => { state.show.truth = on; setKey(); showTruthList(); draw(); }, 'The path(s) that make the action stationary, dashed'),
  hints: toggle('Downhill arrows', state.show.hints, (on) => { state.show.hints = on; draw(); }, 'Arrows: where each knot would go, on its own, to lower the action most'),
};
$('#shows').append(...Object.values(showToggles));

// The view under the path.
const VIEWS = [
  { value: 'phase', label: 'Phase space', title: 'The path in (q, p), over the contours of the energy' },
  { value: 'energy', label: 'Energy', title: 'The energy along the path' },
  { value: 'phasor', label: "Feynman's arrows", title: 'The sum of exp(iS/ħ) over the heights of one knot' },
];
const viewSeg = segmented(VIEWS, state.view, (v) => setView(v), { label: 'View' });
$('#view-tabs').append(viewSeg);
const hbarSlider = slider({ label: '<math><mi>ħ</mi></math>', labelHTML: true, min: 0.01, max: 10, log: true, value: state.hbar,
  title: "Planck's constant, in the units of the action", onInput: (v) => { state.hbar = v; hashSoon(); draw(); } });
hbarSlider.classList.add('hbar');
$('#view-foot').append(hbarSlider);
function setView(v) {
  state.view = v;
  viewSeg.value = v;
  hbarSlider.hidden = v !== 'phasor';
  $('#view-foot').hidden = v !== 'phasor';
  setCaption();
  hashSoon();
  draw();
}

/** What the view shows and what to look for, in a line or two. */
function setCaption() {
  const d = state.sys, x = d.q, dot = d.q === 'θ' ? 'θ̇' : d.s === 'x' ? `${d.q}′` : `${d.q}̇`;
  const text = {
    phase: timeDependent()
      ? `The path in phase space, (${x}, p), p = ∂L/∂${dot}.  L depends on ${d.s}: no conserved energy, so no contours.`
      : `The path in phase space, (${x}, p), p = ∂L/∂${dot}, over contours of the energy.  The true path keeps to one${periodic() ? ' (a loop, if closed)' : ''}; a wrong one crosses them.`,
    energy: timeDependent()
      ? `E = ${dot} ∂L/∂${dot} − L along the path.  L depends on ${d.s}, so E changes even on the true path.`
      : `E = ${dot} ∂L/∂${dot} − L along the path: constant on the true path (L has no ${d.s} in it); a wrong one's wanders.`,
    phasor: `Each height of the ringed knot makes a path with an arrow ${texToMathML('e^{iS/\\hbar}')}, added here head to tail.  Near the stationary height they line up and add (green: the band on the path plot); elsewhere they curl up and cancel.  Yours: the blue dot.`,
  }[state.view];
  $('#view-cap').innerHTML = text;
}
hbarSlider.hidden = state.view !== 'phasor';
$('#view-foot').hidden = state.view !== 'phasor';

function truthWord(t) {
  if (t?.closed) return 'true orbit';
  return { brachistochrone: 'cycloid', refraction: 'true ray', mirage: 'true ray' }[state.sys.id] || 'true path';
}

function showTruthList() {
  const box = $('#truth');
  box.replaceChildren();
  if (!state.show.truth) return;
  const d = state.sys;
  if (!truths.length) {
    const T = state.s1 - state.s0;
    box.append(el('div', {}, periodic()
      ? (d.id === 'pendulum' && T <= 2 * Math.PI ? 'No closed orbit: a pendulum takes at least 2π for a swing.  Make T longer.' : 'No closed orbit of this period.')
      : d.s === 'x' && d.id !== 'brachistochrone' ? 'No ray joins these two points (none leaves the first at a slope below ±' + d.vmax + ' and reaches the second).'
        : 'No true path found between these end points.'));
    return;
  }
  if (periodic() && d.family) box.append(el('div', { class: 'muted' }, 'Every swing takes one period: each of these loops is a true orbit, all with S = 0.  Shown: the one nearest your path.'));
  else if (periodic() && !truths[0].through) box.append(el('div', { class: 'muted' }, `The closed orbit of period ${fmt(state.s1 - state.s0, 3)} never reaches ${d.q} = ${fmt(state.q0, 3)}; it starts here at its turning point.`));
  if (truths.length > 1) box.append(el('div', { class: 'muted' }, `${truths.length} true paths join these ends.  Click one to put your path on it:`));
  truths.forEach((t, i) => {
    const kind = t.closed ? 'closed orbit' : t.index === 0 ? 'a minimum' : `a saddle, index ${t.index}`;
    const way = t.closed && !t.family && truths.length > 1 && Math.abs(t.v0) > 1e-9 ? (t.v0 > 0 ? ', moving up first' : ', moving down first') : '';
    box.append(el('button', { type: 'button', class: 'path', title: 'Put your path on this true path', onclick: () => backToTrue(t) },
      el('span', { class: 'swatch', style: { borderColor: truthColor(i) } }),
      `${actionWord()} ${fmt(t.S, 5)} (${kind}${way})`, t === ref ? el('span', { class: 'mark' }, ' ◂ yours') : null));
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
  phasor = state.view === 'phasor' && current && L ? computePhasor() : null;
  drawPath();
  drawRecord();
  drawView();
  updateScore();
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

/** The knot whose heights Feynman's arrows run over: the selected one if it may move, else the middle. */
function phasorKnot() {
  const n = state.knots.length, k = state.sel;
  if (k > 0 && k < n - 1) return k;
  if (periodic() && !state.sys.lockStart) return 0;
  return n >> 1;
}

function drawPath() {
  const { ctx, width, height } = fitCanvas(pathCanvas);
  const c = themeColors(), d = state.sys;
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 52, right: 16, top: 8, bottom: 36 });
  frame = f;
  // The range holds still while a knot is dragged (an end point moves the true paths).
  if (!pathView || !dragging) pathView = viewRange();
  const [qlo, qhi] = pathView;
  // A little room beyond the end points, so their squares show whole.
  const pad = 0.015 * (state.s1 - state.s0);
  if (d.vertical) { f.x0 = qlo; f.x1 = qhi; f.y0 = state.s0 - pad; f.y1 = state.s1 + pad; }
  else { f.x0 = state.s0 - pad; f.x1 = state.s1 + pad; f.y0 = d.flip ? qhi : qlo; f.y1 = d.flip ? qlo : qhi; }
  toPx = d.vertical ? (s, q) => [f.X(q), f.Y(s)] : (s, q) => [f.X(s), f.Y(q)];
  fromPx = d.vertical ? (px, py) => [f.invY(py), f.invX(px)] : (px, py) => [f.invX(px), f.invY(py)];

  f.clip();
  decorate(ctx, f, c);
  // Feynman's view: the heights of the knot whose arrows add up, a band.
  if (state.view === 'phasor' && phasor?.zone) {
    const k = phasorKnot(), s = state.times[k], [a, b] = phasor.zone;
    const [x1, y1] = toPx(s, a), [x2, y2] = toPx(s, b);
    ctx.fillStyle = c.good; ctx.globalAlpha = 0.22;
    if (d.vertical) ctx.fillRect(Math.min(x1, x2), y1 - 7, Math.abs(x2 - x1), 14);
    else ctx.fillRect(x1 - 7, Math.min(y1, y2), 14, Math.abs(y2 - y1));
    ctx.globalAlpha = 1;
  }
  // True paths, dashed.
  if (state.show.truth) {
    truths.forEach((t, i) => {
      ctx.setLineDash([7, 5]);
      ctx.strokeStyle = truthColor(i);
      ctx.lineWidth = t === ref ? 2.2 : 1.6;
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
  if (dragging) drawGuide(ctx, f, c);
  // The knots: circles, the end points squares (a loop's two ends are one point: both filled).
  const n = state.knots.length, focused = document.activeElement === pathCanvas, pk = state.view === 'phasor' ? phasorKnot() : -1;
  for (let k = 0; k < n; k++) {
    const [x, y] = toPx(state.times[k], state.knots[k]), end = k === 0 || k === n - 1;
    const hot = (hover && hover.knot === k) || (dragging && dragging.k === k);
    ctx.fillStyle = end && periodic() ? c.accent : c.panel; ctx.strokeStyle = bad ? c.warn : c.accent; ctx.lineWidth = 2.5;
    const r = hot ? 8 : 6.5;
    ctx.beginPath();
    if (end) ctx.rect(x - r + 0.5, y - r + 0.5, 2 * r - 1, 2 * r - 1);
    else ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fill(); ctx.stroke();
    if (dragging && dragging.k === k) { ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(x, y, 3, 0, 2 * Math.PI); ctx.fill(); }
    if ((focused && state.sel === k) || k === pk) { ctx.strokeStyle = k === pk ? c.good : c.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 12, 0, 2 * Math.PI); ctx.stroke(); }
  }
  ctx.restore();
  f.axes({ xlabel: d.vertical ? d.q : d.s, ylabel: d.vertical ? d.s : d.qlabel || d.q });
  const under = $('#path-key .under');
  if (under) under.textContent = state.onTrue && current && ref && Math.abs(current.S - ref.S) < 1e-3 * (1 + Math.abs(ref.S)) ? ' (under yours)' : '';
}

/** While a knot is dragged: the line it is moving along, and where (or when) it is. */
function drawGuide(ctx, f, c) {
  const d = state.sys, k = dragging.k, s = state.times[k], q = state.knots[k], n = state.knots.length;
  const [x, y] = toPx(s, q);
  ctx.save();
  ctx.strokeStyle = c.ink3; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
  const inTime = dragging.axis === 'time' || dragging.axis === 'both', inPlace = dragging.axis === 'place' || dragging.axis === 'both';
  if (inPlace) {
    // Along q, at the knot's time.
    const [xa, ya] = toPx(s, pathView[0]), [xb, yb] = toPx(s, pathView[1]);
    ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(xb, yb); ctx.stroke();
  }
  if (inTime && k > 0 && k < n - 1) {
    // Along s, between the neighbours.
    const [xa, ya] = toPx(state.times[k - 1], q), [xb, yb] = toPx(state.times[k + 1], q);
    ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(xb, yb); ctx.stroke();
  }
  ctx.setLineDash([]);
  if (dragging.axis) {
    const qName = d.q, sName = d.s, dec = 2;
    const parts = dragging.axis === 'time' ? [`when: ${sName} = `, { v: s, dec, w: 5 }]
      : dragging.axis === 'place' ? [`where: ${qName} = `, { v: q, dec, w: 6 }]
        : [`${sName} = `, { v: s, dec, w: 5 }, `, ${qName} = `, { v: q, dec, w: 6 }];
    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    // Beside the knot, on the side with room.
    const w = slotsWidth(ctx, parts), right = x + 16 + w < f.right - 4;
    const lx = right ? x + 16 : x - 16 - w, ly = clamp(y + 4, f.top + 14, f.bottom - 4);
    ctx.fillStyle = c.panel; ctx.globalAlpha = 0.9; ctx.fillRect(lx - 3, ly - 12, w + 6, 16); ctx.globalAlpha = 1;
    ctx.fillStyle = c.ink;
    fillSlots(ctx, parts, lx, ly);
  }
  ctx.restore();
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

/** What the slope of the path is called, and its value, as parts for fillSlots. */
function rateParts(v, q) {
  const d = state.sys;
  if (Math.abs(v) < 1e-9) v = 0;
  if (d.id === 'twin') return ['velocity dx/dt = ', { v, dec: 3, w: 5 }, ' c'];
  if (d.id === 'brachistochrone') return ['slope ', { v, dec: 2, w: 6 }, ', speed √(2gy) = ', { v: Math.sqrt(2 * state.params.g * q), dec: 2, w: 5 }];
  if (d.s === 'x') return ['slope dy/dx = ', { v, dec: 3, w: 6 }];
  const name = d.q === 'θ' ? 'angular velocity θ̇' : `velocity ${d.q}̇`;
  return [`${name} = `, { v, dec: 2, w: 5 }];
}

/**
 * The velocity, drawn: the tangent to the path where the pointer is, or, while a knot is being
 * dragged, halfway along the stretches before and after it.
 */
function drawSlope(ctx, c, p) {
  const where = [], n = p.q.length;
  const T = state.s1 - state.s0;
  if (dragging) { for (const i of [dragging.k - 1, dragging.k]) if (i >= 0 && i < n - 1) where.push((p.s[i] + p.s[i + 1]) / 2); }
  else if (hover && hover.knot < 0) where.push(clamp(hover.s, state.s0, state.s1));
  ctx.font = '12px system-ui, sans-serif';
  for (const s of where) {
    const pt = pointAt(p, s);
    if (!pt) continue;
    const [q, v] = pt, [x, y] = toPx(s, q), [x2, y2] = toPx(s + 1e-3 * T, q + v * 1e-3 * T);
    const len = Math.hypot(x2 - x, y2 - y) || 1, dx = (x2 - x) / len, dy = (y2 - y) / len;
    ctx.strokeStyle = c.ink; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x - 40 * dx, y - 40 * dy); ctx.lineTo(x + 40 * dx, y + 40 * dy); ctx.stroke();
    ctx.fillStyle = c.ink; ctx.beginPath(); ctx.arc(x, y, 3, 0, 2 * Math.PI); ctx.fill();
    const parts = rateParts(v, q);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const w = slotsWidth(ctx, parts);
    // The label above the line, or below it near the top.
    const lx = clamp(x - w / 2, frame.left + 4, frame.right - w - 4), ly = y - 22 < frame.top + 14 ? y + 30 : y - 22;
    ctx.fillStyle = c.panel; ctx.globalAlpha = 0.85; ctx.fillRect(lx - 3, ly - 12, w + 6, 16); ctx.globalAlpha = 1;
    ctx.fillStyle = c.ink;
    fillSlots(ctx, parts, lx, ly);
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
      const [x, y] = toPx(s, q);
      const [xa, ya] = toPx(s + dir * far, q - far), [xb, yb] = toPx(s + dir * far, q + far);
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
    const [qlo, qhi] = pathView;
    for (let i = 0; i < 60; i++) {
      const y0 = qlo + ((qhi - qlo) * i) / 60, y1 = qlo + ((qhi - qlo) * (i + 1)) / 60;
      const shade = Math.max(0, Math.min(1, (n((y0 + y1) / 2) - 1) / 1.2));
      ctx.fillStyle = `rgba(80,140,230,${0.45 * shade})`;
      const [, ya] = toPx(state.s0, y0), [, yb] = toPx(state.s0, y1);
      ctx.fillRect(f.left, Math.min(ya, yb), f.w, Math.abs(yb - ya) + 1);
    }
  } else if (d.id === 'brachistochrone') {
    ctx.fillStyle = c.ink3; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('g ↓', f.left + 10, f.bottom - 10);
  }
}

/**
 * A plot range that holds still: kept while the data stay inside it, grown with room to spare
 * when they leave it, and fitted afresh between drags (settle) when they leave it or it has
 * become far too big for them.  minSpan: the least range, so rounding never fills a plot.
 */
function sticky(r, lo, hi, minSpan, settle) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return r;
  if (hi - lo < minSpan) { const m = (lo + hi) / 2; lo = m - minSpan / 2; hi = m + minSpan / 2; }
  const fit = { lo: lo - 0.12 * (hi - lo), hi: hi + 0.12 * (hi - lo) };
  if (!r) return fit;
  const inside = lo >= r.lo && hi <= r.hi;
  if (inside && !(settle && r.hi - r.lo > 3 * (fit.hi - fit.lo))) return r;
  if (settle) return fit;
  const span = Math.max(r.hi - r.lo, hi - lo);
  return { lo: lo < r.lo ? lo - 0.25 * span : r.lo, hi: hi > r.hi ? hi + 0.25 * span : r.hi };
}

// The record of S: every path drawn, newest on the right, against the true path's.
function drawRecord() {
  const cv = $('#record');
  const { ctx, width, height } = fitCanvas(cv);
  const c = themeColors();
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 56, right: 12, top: 10, bottom: 34 });
  const start = Math.max(0, history.length - WINDOW), shown = history.slice(start);
  const vals = shown.map((h) => h.S).filter(Number.isFinite);
  const t = ref || truths[0];
  if (!vals.length && !t) return;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (state.show.truth) for (const tt of truths) { lo = Math.min(lo, tt.S); hi = Math.max(hi, tt.S); }
  if (!vals.length) lo = hi = t.S;
  ranges.record = sticky(ranges.record, lo, hi, 0.03 * scale, !busy());
  f.x0 = 0; f.x1 = WINDOW - 1; f.y0 = ranges.record.lo; f.y1 = ranges.record.hi;
  const dec = slots?.decimals ?? 3;
  f.clip();
  ctx.font = '11px system-ui, sans-serif';
  // The true paths' actions, dashed, the one yours is compared with labelled (at the right,
  // above its line, where your newest point is not, unless the record is full).
  let trueBox = null;
  if (state.show.truth) {
    truths.forEach((tt, i) => {
      const y = f.Y(tt.S);
      ctx.setLineDash([6, 4]); ctx.strokeStyle = truthColor(i); ctx.lineWidth = tt === t ? 2 : 1.2;
      ctx.beginPath(); ctx.moveTo(f.left, y); ctx.lineTo(f.right, y); ctx.stroke();
      ctx.setLineDash([]);
      if (tt === t) {
        const parts = [`${truthWord(tt)}  `, { v: tt.S, dec, w: dec + 5 }], w = slotsWidth(ctx, parts);
        const full = shown.length > WINDOW / 2, lx = full ? f.left + 6 : f.right - 6 - w;
        const ly = y - 5 > f.top + 12 ? y - 5 : y + 14;
        ctx.fillStyle = truthColor(i); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        fillSlots(ctx, parts, lx, ly);
        trueBox = [lx - 2, ly - 11, lx + w + 2, ly + 3];
      }
    });
  }
  // Where a button changed the path: a faint line and its name.
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  let lastRight = -Infinity;
  shown.forEach((h, i) => {
    if (!h.tag || h.tag === 'start') return;
    const x = f.X(i);
    ctx.strokeStyle = c.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, f.top); ctx.lineTo(Math.round(x) + 0.5, f.bottom); ctx.stroke();
    const tw = ctx.measureText(h.tag).width, cx = clamp(x, f.left + tw / 2 + 3, f.right - tw / 2 - 3);
    if (cx - tw / 2 > lastRight + 6) { ctx.fillStyle = c.ink3; ctx.fillText(h.tag, cx, f.top + 2); lastRight = cx + tw / 2; }
  });
  // Your paths.
  ctx.strokeStyle = c.accent; ctx.lineWidth = 1.8;
  ctx.beginPath();
  let on = false;
  shown.forEach((h, i) => {
    if (!Number.isFinite(h.S)) { on = false; return; }
    const x = f.X(i), y = f.Y(h.S);
    if (!on) { ctx.moveTo(x, y); on = true; } else ctx.lineTo(x, y);
  });
  ctx.stroke();
  const last = shown[shown.length - 1];
  if (last && Number.isFinite(last.S)) {
    const x = f.X(shown.length - 1), y = f.Y(last.S);
    ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(x, y, 4, 0, 2 * Math.PI); ctx.fill();
    // Its value, beside it (on the side with room).
    const parts = ['you  ', { v: last.S, dec, w: dec + 5 }];
    ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    const w = slotsWidth(ctx, parts), right = x + 10 + w < f.right, lx = right ? x + 10 : x - 10 - w;
    let ly = clamp(y, f.top + 8, f.bottom - 8);
    // Off the true path's label (and its line) if they would meet: below the line, or above it.
    const yt = t ? f.Y(t.S) : NaN, hits = (yy) => trueBox && lx < trueBox[2] && lx + w > trueBox[0] && yy + 8 > trueBox[1] && yy - 8 < trueBox[3];
    if (Math.abs(yt - ly) < 9 || hits(ly)) ly = yt + 13 < f.bottom - 6 ? yt + 13 : yt - 22;
    ctx.fillStyle = c.panel; ctx.globalAlpha = 0.85; ctx.fillRect(lx - 2, ly - 8, w + 4, 16); ctx.globalAlpha = 1;
    ctx.fillStyle = c.accent; ctx.textAlign = 'left';
    fillSlots(ctx, parts, lx, ly);
  }
  if (history.length < 2) {
    // A hint while the record is empty, in lines that fit.
    ctx.fillStyle = c.ink3; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const words = `Drag a knot, or try a wrong path: every change you make adds a point here, its ${actionWord() === 'S =' ? 'action' : actionWord()}.`.split(' ');
    const lines = [''];
    for (const w of words) {
      const next = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${w}` : w;
      if (ctx.measureText(next).width > f.w - 20 && lines[lines.length - 1]) lines.push(w); else lines[lines.length - 1] = next;
    }
    const y = t && f.Y(t.S) > f.top + f.h / 2 ? f.top + f.h * 0.25 : f.top + f.h * 0.75;
    lines.forEach((l, i) => ctx.fillText(l, f.left + f.w / 2, y + 16 * (i - (lines.length - 1) / 2)));
  }
  ctx.restore();
  f.axes({ xlabel: 'each change you make adds a point →', xTicks: false, ylabel: actionWord() === 'S =' ? 'S' : actionWord() });
}

// --------------------------------------------------------------- the view below

function drawView() {
  const cv = $('#view');
  const { ctx, width, height } = fitCanvas(cv);
  const c = themeColors();
  ctx.clearRect(0, 0, width, height);
  if (!current || !L) return;
  if (state.view === 'energy') drawEnergy(ctx, width, height, c);
  else if (state.view === 'phasor') drawPhasor(ctx, width, height, c);
  else drawPhase(ctx, width, height, c);
}

const timeDependent = () => state.sys.typed === 'L' || (state.sys.typed === 'V' && typedExpr?.uses('t'));

function computePhaseGrid() {
  phaseGrid = null;
  if (!L || timeDependent()) return;
  const [qlo, qhi] = pathView || viewRange();
  const r = ranges.p || phaseRange(true);
  if (!r) return;
  const nq = 72, np = 60;
  const qs = Float64Array.from({ length: nq }, (_, i) => qlo + ((qhi - qlo) * i) / (nq - 1));
  const ps = Float64Array.from({ length: np }, (_, i) => r.lo + ((r.hi - r.lo) * i) / (np - 1));
  const H = hamiltonianGrid(L, qs, ps, state.s0);
  const finite = Array.from(H).filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length < 10) return;
  const levels = [];
  for (let i = 1; i < 14; i++) levels.push(finite[Math.floor((finite.length * i) / 14)]);
  phaseGrid = { H, nq, np, q0: qlo, q1: qhi, p0: r.lo, p1: r.hi, levels };
}

/** The momentum range for phase space (sticky), from the true paths and yours (1% to 99%). */
function phaseRange(settle) {
  const seen = [];
  const consider = (q, v, s) => { const p = momentum(L, q, v, s); for (const x of p) if (Number.isFinite(x)) seen.push(x); };
  for (const t of truths) consider(t.q, t.v, t.s);
  if (current) consider(current.samples.q, current.samples.v, quad.s);
  if (!seen.length) return ranges.p;
  seen.sort((a, b) => a - b);
  let lo = Math.min(0, seen[Math.floor(0.01 * (seen.length - 1))]), hi = Math.max(0, seen[Math.ceil(0.99 * (seen.length - 1))]);
  if (state.sys.id === 'twin') { lo = Math.min(lo, -2); hi = Math.max(hi, 2); }
  ranges.p = sticky(ranges.p, lo, hi, Math.max(1e-3, 0.3 * (hi - lo)), settle);
  return ranges.p;
}

/** New contours for phase space if the path has left the old ones (between drags). */
function regrid() {
  if (!current || !L) return;
  const before = ranges.p;
  phaseRange(true);
  if (!phaseGrid || ranges.p !== before) computePhaseGrid();
}

/** The hovered point of the path: {s, q, v}, or null. */
function hovered() {
  if (!hover || !current) return null;
  const p = path(), s = clamp(hover.s, state.s0, state.s1), pt = pointAt(p, s);
  return pt ? { s, q: pt[0], v: pt[1] } : null;
}

function drawPhase(ctx, width, height, c) {
  const d = state.sys;
  const f = new Frame(ctx, width, height, { left: 46, right: 12, top: 8, bottom: 32 });
  const r = phaseRange(!busy());
  if (phaseGrid && r && (phaseGrid.p0 !== r.lo || phaseGrid.p1 !== r.hi) && !busy()) computePhaseGrid();
  const g = phaseGrid, [qlo, qhi] = pathView || viewRange();
  f.x0 = qlo; f.x1 = qhi; f.y0 = r?.lo ?? -1; f.y1 = r?.hi ?? 1;
  const tr = path().trace(30), pTr = momentum(L, tr.q, tr.v, tr.s);
  f.clip();
  if (g) {
    ctx.strokeStyle = c.line; ctx.lineWidth = 1;
    ctx.beginPath();
    const X = (i) => f.X(g.q0 + ((g.q1 - g.q0) * i) / (g.nq - 1)), Y = (j) => f.Y(g.p0 + ((g.p1 - g.p0) * j) / (g.np - 1));
    for (const level of g.levels) contour(g.H, g.nq, g.np, level, (x0, y0, x1, y1) => { ctx.moveTo(X(x0), Y(y0)); ctx.lineTo(X(x1), Y(y1)); });
    ctx.stroke();
  } else if (timeDependent()) {
    ctx.fillStyle = c.ink3; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('L depends on t: no conserved H, so no contours', f.left + 8, f.top + 6);
  }
  const curve = (q, p, color, dash, w) => {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash);
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
  // Where the path starts (and, for a loop, ends), and which way it goes.
  if (Number.isFinite(pTr[0])) {
    ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(f.X(tr.q[0]), f.Y(pTr[0]), 4, 0, 2 * Math.PI); ctx.fill();
    const j = Math.floor(tr.q.length * 0.3);
    if (Number.isFinite(pTr[j]) && Number.isFinite(pTr[j + 2])) { ctx.strokeStyle = c.accent; ctx.lineWidth = 1.5; arrow(ctx, f.X(tr.q[j]), f.Y(pTr[j]), f.X(tr.q[j + 2]), f.Y(pTr[j + 2])); }
  }
  const h = hovered();
  if (h) {
    const ph = momentum(L, Float64Array.of(h.q), Float64Array.of(h.v), Float64Array.of(h.s))[0];
    if (Number.isFinite(ph)) { ctx.strokeStyle = c.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(f.X(h.q), f.Y(ph), 5, 0, 2 * Math.PI); ctx.stroke(); }
  }
  ctx.restore();
  f.axes({ xlabel: d.qlabel || d.q, ylabel: 'p' });
}

function drawEnergy(ctx, width, height, c) {
  const d = state.sys;
  const f = new Frame(ctx, width, height, { left: 52, right: 12, top: 8, bottom: 32 });
  const tr = path().trace(30), E = energy(L, tr.q, tr.v, tr.s);
  const all = Array.from(E).filter(Number.isFinite);
  const tE = state.show.truth ? truths.map((t) => energy(L, t.q, t.v, t.s)) : [];
  for (const e of tE) for (const x of e) if (Number.isFinite(x)) all.push(x);
  if (!all.length) return;
  const sorted = all.sort((a, b) => a - b);
  const lo = sorted[Math.floor(0.005 * (sorted.length - 1))], hi = sorted[Math.ceil(0.995 * (sorted.length - 1))];
  // Not so zoomed in that rounding looks like a change of energy: at least a twentieth of the
  // range of the contours in phase space.
  const least = phaseGrid ? 0.05 * (phaseGrid.levels[phaseGrid.levels.length - 1] - phaseGrid.levels[0]) : 0.05 * (1 + Math.abs(hi));
  ranges.energy = sticky(ranges.energy, lo, hi, least, !busy());
  f.x0 = state.s0; f.x1 = state.s1; f.y0 = ranges.energy.lo; f.y1 = ranges.energy.hi;
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
  for (let k = 1; k < state.times.length - 1; k++) { const x = Math.round(f.X(state.times[k])) + 0.5; ctx.beginPath(); ctx.moveTo(x, f.top); ctx.lineTo(x, f.bottom); ctx.stroke(); }
  const h = hovered();
  if (h) {
    const eh = energy(L, Float64Array.of(h.q), Float64Array.of(h.v), Float64Array.of(h.s))[0];
    if (Number.isFinite(eh)) { ctx.strokeStyle = c.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(f.X(h.s), f.Y(eh), 5, 0, 2 * Math.PI); ctx.stroke(); }
  }
  ctx.restore();
  f.axes({ xlabel: d.s, ylabel: 'E' });
}

/**
 * Feynman's arrows: the paths through every height of one knot (the band of heights the plot
 * shows), each with its arrow e^{iS/ħ}, added head to tail.  The arrows of the heights near the
 * stationary one point the same way and make the straight middle of the spiral (green, and the
 * green band on the path plot); the rest curl up and cancel.  Your path's arrow is the blue dot.
 */
function computePhasor() {
  const [lo, hi] = pathView || viewRange(), k = phasorKnot();
  return { ...knotPhasors(L, path(), quad, k, lo, hi, state.hbar), k, lo, hi };
}

function drawPhasor(ctx, width, height, c) {
  if (!phasor) return;
  const { x, y, h, zone, k, lo, hi } = phasor, M = h.length;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let j = 0; j <= M; j++) { x0 = Math.min(x0, x[j]); x1 = Math.max(x1, x[j]); y0 = Math.min(y0, y[j]); y1 = Math.max(y1, y[j]); }
  const m = 12, sc = Math.min((width - 2 * m) / (x1 - x0 || 1), (height - 2 * m) / (y1 - y0 || 1));
  const cx = width / 2 - (sc * (x0 + x1)) / 2, cy = height / 2 + (sc * (y0 + y1)) / 2;
  const X = (u) => cx + sc * u, Y = (v) => cy - sc * v;
  // The chain, thinned to about a pixel per point; the part that adds up in green.
  const inZone = (j) => zone && h[Math.min(M - 1, j)] >= zone[0] && h[Math.min(M - 1, j)] <= zone[1];
  const stroke = (pick, color, w) => {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath();
    let on = false, px = NaN, py = NaN;
    for (let j = 0; j <= M; j++) {
      if (!pick(j)) { on = false; continue; }
      const u = X(x[j]), v = Y(y[j]);
      if (on && Math.abs(u - px) < 0.6 && Math.abs(v - py) < 0.6 && j < M) continue;
      if (!on) { ctx.moveTo(u, v); on = true; } else ctx.lineTo(u, v);
      px = u; py = v;
    }
    ctx.stroke();
  };
  stroke(() => true, c.ink3, 1.2);
  if (zone) stroke(inZone, c.good, 3);
  // The sum: from the first arrow's tail to the last one's head.
  ctx.strokeStyle = c.ink2; ctx.fillStyle = c.ink2; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]);
  arrow(ctx, X(x[0]), Y(y[0]), X(x[M]), Y(y[M]));
  ctx.setLineDash([]);
  // Your path: the arrow for the knot's own height.
  const j = clamp(Math.round(((state.knots[k] - lo) / (hi - lo)) * M), 0, M);
  ctx.fillStyle = c.accent; ctx.strokeStyle = c.panel; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(X(x[j]), Y(y[j]), 5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
}

// The score: your path and the true path, side by side, every number in a slot of fixed width
// (monospace, a fixed number of decimals for the set-up, right-aligned), so that nothing moves
// while the numbers change; then ΔS and what it means.
let slots = null;             // {key: value element}, and the set-up they were made for
function scoreColumns() {
  const d = state.sys;
  if (d.id === 'twin') return [['tau', 'proper time τ'], ['S', 'S = −mc²τ']];
  if (d.s === 'x') return [['S', d.id === 'brachistochrone' ? 'time ∫ds/v' : 'optical path ∫n ds']];
  if (L?.kinetic) return [['S', 'action S'], ['K', d.q === 'θ' ? '∫ ½θ̇² dt' : '∫ ½mẋ² dt'], ['V', '− ∫ V dt']];
  return [['S', 'action S']];
}

function layoutScore() {
  const box = $('#score'), d = state.sys;
  const ints = Math.max(3, Math.floor(Math.log10(Math.max(1, scale))) + 1), decimals = clamp(5 - (Math.floor(Math.log10(Math.max(1, scale))) + 1), 1, 4);
  const width = ints + decimals + 2, cols = scoreColumns();
  const grid = el('div', { class: 'score-grid', style: { gridTemplateColumns: `auto repeat(${cols.length}, auto)` } });
  slots = { decimals, width, sys: d, ends: state.ends, cols, you: {}, tru: {} };
  grid.append(el('span'));
  for (const [, label] of cols) grid.append(el('span', { class: 'h' }, label));
  const row = (cls, name) => {
    slots[cls].label = el('span', { class: `rl ${cls}` }, name);
    grid.append(slots[cls].label);
    cols.forEach(([key], i) => {
      const v = el('span', { class: `num${i === 0 && cls === 'you' ? ' main' : ''}`, style: { width: `${width}ch` } });
      grid.append(el('span', { class: cls }, v));
      slots[cls][key] = v;
    });
  };
  row('you', 'your path');
  row('tru', 'true path');
  slots.dS = el('span', { class: 'num', style: { width: `${width + 1}ch` } });
  slots.note = el('span', { class: 'note' });
  const verdict = el('div', { class: 'verdict' },
    el('span', { class: 'line' }, `${d.id === 'brachistochrone' ? 'Δt' : 'ΔS'} = yours − true = `, slots.dS), slots.note);
  box.replaceChildren(grid, verdict);
}

function updateScore() {
  const d = state.sys;
  if (!slots || slots.sys !== d || slots.ends !== state.ends || slots.cols.length !== scoreColumns().length) layoutScore();
  const n = slots.decimals, w = slots.width, S = current ? current.S : NaN, t = ref || truths[0];
  const m = state.params.m ?? 1, ok = Number.isFinite(S);
  const put = (row, vals) => {
    for (const [key] of slots.cols) {
      const v = vals[key] ?? NaN, s = fixedNum(Number.isFinite(v) ? v : NaN, n, w);
      if (row[key].textContent !== s) row[key].textContent = s;
    }
  };
  put(slots.you, { S, tau: -S / m, K: current?.kinetic, V: S - current?.kinetic });
  put(slots.tru, t ? { S: t.S, tau: -t.S / m, K: t.kin, V: t.S - t.kin } : {});
  const ti = Math.max(0, truths.indexOf(t));
  slots.tru.label.textContent = truthWord(t);
  slots.tru.label.style.color = truthColor(ti);
  let note = '', cls = '';
  if (!ok) {
    note = d.id === 'twin' ? 'faster than light somewhere: no proper time, no action'
      : d.id === 'brachistochrone' ? 'the bead would have to climb above its start' : 'the action is undefined for this path';
    cls = 'warn';
  } else if (t) {
    const diff = S - t.S, tol = 2e-4 * (1 + Math.abs(t.S)), what = truthWord(t);
    const more = { twin: 'more action, less proper time, than the true world line', mirage: 'a longer optical path than the true ray', refraction: 'a longer optical path than the true ray', brachistochrone: 'slower than the cycloid' }[d.id] || `more action than the ${what}`;
    if (diff < -tol) { note = `less than the ${what}: it is a saddle, not a minimum!`; cls = 'warn'; }
    else if (state.onTrue && state.mode === 'segments' && diff > tol) note = `the best straight segments through these knots: just above the ${what}`;
    else if (state.onTrue && diff > tol) { note = `on the ${what}, as near as ${state.knots.length} knots can draw it`; cls = 'good'; }
    else if (state.onTrue || Math.abs(diff) <= tol) { note = `on the ${what}`; cls = 'good'; }
    else if (t.family && Math.abs(S - familyS) <= tol) { note = `on a true orbit, as near as ${state.knots.length} knots can draw it`; cls = 'good'; }
    else note = more;
  } else note = 'no true path to compare with';
  const dS = t && ok ? fixedNum(S - t.S, n, w + 1, { plus: '+' }) : '–';
  if (slots.dS.textContent !== dS) slots.dS.textContent = dS;
  slots.note.textContent = note;
  slots.note.className = `note ${cls}`;
}

// --------------------------------------------------------------- dragging knots

// Press on a knot and drag: the first few pixels decide which way it moves, up-down (where) or
// sideways (when), and it moves only that way, so a drag up never shifts the time by accident.
// Shift frees it to move both ways.  The ends move in place only.
const local = (e) => { const r = pathCanvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

/** The knot within reach of (px, py), or -1. */
function knotNear(px, py, reach) {
  let best = -1, bestD = reach;
  for (let k = 0; k < state.knots.length; k++) {
    if (k === 0 && state.sys.lockStart) continue;   // the brachistochrone's bead starts from rest at the top
    const [x, y] = toPx(state.times[k], state.knots[k]), dd = Math.hypot(x - px, y - py);
    if (dd < bestD) { bestD = dd; best = k; }
  }
  return best;
}
const reachFor = (e) => (e.pointerType === 'touch' ? 30 : e.pointerType === 'pen' ? 20 : 16);

// On a touch screen the page scrolls when a finger lands off the knots, and the knot moves when
// it lands on one.
pathCanvas.addEventListener('touchstart', (e) => {
  if (!frame || !toPx || e.touches.length !== 1) return;
  const r = pathCanvas.getBoundingClientRect(), t = e.touches[0];
  if (knotNear(t.clientX - r.left, t.clientY - r.top, 30) >= 0) e.preventDefault();
}, { passive: false });

pathCanvas.addEventListener('pointerdown', (e) => {
  if (!frame || !toPx) return;
  const [px, py] = local(e), k = knotNear(px, py, reachFor(e));
  if (k < 0) return;
  const n = state.knots.length, end = k === 0 || k === n - 1;
  const [s, q] = fromPx(px, py);
  stopMorph();
  dragging = { k, ds: state.times[k] - s, dq: state.knots[k] - q, x0: px, y0: py, axis: end ? 'place' : null, end };
  state.sel = k;
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
    if (!frame) return;
    const inside = px >= frame.left && px <= frame.right && py >= frame.top && py <= frame.bottom;
    const k = inside ? knotNear(px, py, reachFor(e)) : -1;
    const was = hover;
    hover = inside ? { s: fromPx(px, py)[0], knot: k } : null;
    pathCanvas.classList.toggle('over', k >= 0);
    if (hover || was) refresh(false);
    return;
  }
  const dx = px - dragging.x0, dy = py - dragging.y0, vertical = state.sys.vertical;
  if (!dragging.end) {
    if (e.shiftKey) dragging.axis = 'both';
    else if (!dragging.axis || dragging.axis === 'both') {
      if (Math.hypot(dx, dy) < 5) { dragging.axis = null; return; }
      const across = Math.abs(dx) > Math.abs(dy);
      dragging.axis = across !== !!vertical ? 'time' : 'place';
    }
  }
  if (!dragging.axis) return;
  // Hold the other direction at the press point.
  const time = dragging.axis === 'time', place = dragging.axis === 'place';
  const moveX = vertical ? !time : !place, moveY = vertical ? !place : !time;
  const [s, q] = fromPx(moveX ? px : dragging.x0, moveY ? py : dragging.y0);
  moveKnotTo(dragging.k, s + dragging.ds, q + dragging.dq);
  refresh(true);
});
const endDrag = () => {
  if (!dragging) return;
  dragging = null;
  pathCanvas.classList.remove('dragging');
  if (!truthPending) pathView = null;
  regrid(); draw();
};

pathCanvas.addEventListener('pointerup', endDrag);
pathCanvas.addEventListener('pointercancel', endDrag);
pathCanvas.addEventListener('pointerleave', () => { if (!dragging && hover) { hover = null; pathCanvas.classList.remove('over'); refresh(false); } });

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
function refresh(changedPath) {
  pathChanged ||= changedPath;
  if (frameDue) return;
  frameDue = true;
  requestAnimationFrame(() => {
    frameDue = false;
    if (pathChanged) { pathChanged = false; evaluate(); record(); }
    draw();
  });
}

// Keyboard: [ and ] choose a knot, the arrow keys move it (Shift: further), R goes back to the
// true path: for those who can't drag.
pathCanvas.addEventListener('keydown', (e) => {
  const n = state.knots.length, first = state.sys.lockStart ? 1 : 0;
  if (e.key === '[' || e.key === ']') {
    e.preventDefault();
    state.sel = clamp(state.sel + (e.key === ']' ? 1 : -1), first, n - 1);
    draw();
    return;
  }
  if (e.key === 'r' || e.key === 'R') { e.preventDefault(); backToTrue(); return; }
  stopMorph();
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
    const on = over[k] ?? (k === 'truth');
    t.on = on; state.show[k] = on;
  }
}
/** Set up a system on its true path; `then` changes it afterwards (a bend, say). */
function go(id, { knots, show = {}, mode = 'spline', T, params, ends = 'fixed', keepShow = false, view = 'phase', hbar, then } = {}) {
  setRolling(false);
  state.mode = mode; modeSeg.value = mode;
  if (!keepShow) setShow(show);
  if (hbar) { state.hbar = hbar; hbarSlider.value = hbar; }
  state.view = view; viewSeg.value = view; hbarSlider.hidden = $('#view-foot').hidden = view !== 'phasor';
  setSystem(byId(id), { knots, T, params, ends });
  setCaption();
  then?.();
  showTruthList();
  draw();
}

const setups = {
  find: () => go('free'),
  throw: () => go('gravity'),
  hints: () => go('gravity', { show: { hints: true }, knots: 7, then: () => bend(-1) }),
  energy: () => go('gravity', { knots: 6, view: 'energy' }),
  phase: () => go('harmonic'),
  orbit: () => go('pendulum', { ends: 'periodic', T: 8, knots: 12 }),
  saddle: () => go('harmonic', { T: 4 }),
  pendulum: () => go('pendulum'),
  twin: () => go('twin', { mode: 'segments' }),
  light: () => go('refraction'),
  mirage: () => go('mirage'),
  brach: () => go('brachistochrone'),
  segments: () => go('gravity', { mode: 'segments', knots: 4, view: 'energy' }),
  feynman: () => go('gravity', { view: 'phasor', hbar: 1 }),
  damped: () => go('typedL', { view: 'energy' }),
  typed: () => go('typedV'),
};
drawer($('#help'), $('#help-button'), setups);

// ------------------------------------------------------------------------ start

const hash = readHash();
setShow({});
if (setups[hash.setup]) setups[hash.setup]();
else if (!fromHash(hash)) go('gravity');

window.__app = {
  state, setups, setSystem, setRolling, rollStep, snapTo, bend, rush, straight, backToTrue, path, downhill, moveKnotTo, setView,
  /** Move knot k to (s, q) as a drag would, and show it. */
  move(k, s, q) { stopMorph(); setRolling(false); moveKnotTo(k, s, q); refresh(true); },
  /** Roll downhill to the end, at once (for tests: no waiting on animation frames). */
  rollToEnd(max = 3000) { setRolling(true); for (let i = 0; i < max && rollStep(); i++); setRolling(false); draw(); return rollFrames; },
  get truths() { return truths; }, get ref() { return ref; }, get current() { return current; }, get history() { return history; },
  get frame() { return frame; }, get hover() { return hover; }, get phasor() { return phasor; }, get ranges() { return ranges; },
  get idle() { return !frameDue && !truthPending && !dragging && !state.rolling && !morph; },
  get truthPending() { return truthPending; },
  toPx: (s, q) => toPx(s, q),
  ready: true,
};
