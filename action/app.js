// The least-action demo: drag the knots of a path between two events; watch its action.

import { Path, action, quadrature, truePaths, knotGradient, knotCurvature, momentum, energy, hamiltonianGrid } from './physics.js';
import { SYSTEMS, typedSystem, parseTyped } from './systems.js';
import { el, $, slider, segmented, toggle, exprField, drawer, readHash, writeHash, fmt } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors, contour } from '../lib/plot.js';
import { texToMathML } from '../lib/mathml.js';

// ----------------------------------------------------------------------------- state

const state = {
  sys: SYSTEMS[0],
  params: {},
  s0: 0, s1: 2, q0: 0, q1: 4,
  knots: new Float64Array(5),
  mode: 'spline',
  show: { truth: false, hints: false, phasor: true },
  hbar: 0.5,
  rolling: false,
};
let L = null;                 // the system's Lagrangian object
let typedExpr = null;
let quad = null;
let truths = [];              // the true paths: [{s, q, v, S, index}]
let history = [];             // the action of every path drawn, in order
let current = null;           // {S, samples, kinetic}
let phaseGrid = null;         // {H, nq, np, q0, q1, p0, p1, levels}

const HISTORY = 400;

function paramValues() { return { ...state.params }; }

function buildL() {
  const d = state.sys;
  if (d.typed) {
    if (!typedExpr) return null;
    L = typedSystem(d.typed, typedExpr, typedField?.params || {}, state.params.m ?? 1);
  } else L = d.make(paramValues());
  return L;
}

function makeQuad() {
  const segs = state.knots.length - 1;
  quad = quadrature(state.s0, state.s1, state.mode === 'segments' ? segs * 80 : 600, !!state.sys.singularStart);
}

function path() { return new Path(state.s0, state.s1, state.knots, state.mode); }

/** The action of the current path, and the kinetic part when the system can say. */
function evaluate() {
  if (!L) { current = null; return; }
  const a = action(L, path(), quad);
  let kinetic = null;
  if (L.kinetic || L.vOfP) {
    const m = state.params.m ?? 1;
    kinetic = 0;
    for (let i = 0; i < quad.s.length; i++) kinetic += 0.5 * m * a.samples.v[i] ** 2 * quad.w[i];
  }
  current = { S: a.S, samples: a.samples, kinetic };
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
  setSystem(d);
  try {
    if (h.mode === 'segments') { state.mode = 'segments'; modeSeg.value = 'segments'; }
    if (h.p) for (const [k, v] of Object.entries(JSON.parse(h.p))) if (k in state.params) { state.params[k] = +v; paramSliders[k] && (paramSliders[k].value = +v); }
    if (+h.T > 0 && d.tmax) { state.s1 = state.s0 + +h.T; paramSliders.T && (paramSliders.T.value = +h.T); }
    if (typedField && (h.L || h.tp)) { typedField.set(h.L || d.source, h.tp ? JSON.parse(h.tp) : {}, false); typedExpr = typedField.expr; }
    if (h.q) {
      const q = h.q.split(',').map(Number);
      if (q.length >= 3 && q.length <= 16 && q.every(Number.isFinite)) {
        state.knots = Float64Array.from(q); state.q0 = q[0]; state.q1 = q[q.length - 1];
        knotSlider.value = q.length;
      }
    }
    history = [];
    rebuild();
  } catch { /* an address that doesn't parse: the system's defaults stand */ }
  return true;
}

let truthTimer = 0;
function recomputeTruth(delay = 0) {
  clearTimeout(truthTimer);
  const run = () => {
    if (!L) { truths = []; return; }
    const d = state.sys;
    try {
      truths = d.truePaths
        ? d.truePaths(paramValues(), state.s0, state.q0, state.s1, state.q1)
        : truePaths(L, state.s0, state.q0, state.s1, state.q1, { vmax: d.vmax, max: 6 });
    } catch { truths = []; }
    computePhaseGrid();
    showTruthList();
    draw();
  };
  if (delay) truthTimer = setTimeout(run, delay); else run();
}

// ---------------------------------------------------------------------- systems

const sysButtons = {};
for (const d of SYSTEMS) {
  const b = el('button', { type: 'button', 'aria-pressed': 'false', title: d.blurb, onclick: () => setSystem(d) }, d.label);
  $('#systems').append(b);
  sysButtons[d.id] = b;
}

let typedField = null;
let paramSliders = {};

function setSystem(d, { knots, bend = 0 } = {}) {
  state.sys = d;
  for (const [id, b] of Object.entries(sysButtons)) b.setAttribute('aria-pressed', String(id === d.id));
  state.params = Object.fromEntries(Object.entries(d.params).map(([k, v]) => [k, v.value]));
  state.s0 = d.s0; state.s1 = d.s1; state.q0 = d.q0; state.q1 = d.q1;
  const n = knots || d.knots;
  state.knots = Float64Array.from({ length: n }, (_, i) => d.q0 + ((d.q1 - d.q0) * i) / (n - 1) + bend * Math.sin((Math.PI * i) / (n - 1)));
  knotSlider.value = n;
  $('#formula').innerHTML = texToMathML(d.formula, true);
  $('#blurb').textContent = d.blurb;
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
      onChange: (expr) => { typedExpr = expr; rebuild({ keepPath: true }); },
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
    const s = slider({ label, labelHTML: true, min: p.min, max: p.max, value: p.value,
      onInput: (v) => { state.params[k] = v; rebuild({ keepPath: true }); } });
    box.append(s);
    paramSliders[k] = s;
  }
  if (d.tmax) {
    const s = slider({ label: `<math><mi>${d.s === 't' ? 'T' : 'X'}</mi></math>`, labelHTML: true, min: 0.3, max: d.tmax, value: d.s1 - d.s0,
      title: 'How long the trip takes', onInput: (v) => { state.s1 = state.s0 + v; rebuild({ keepPath: true }); } });
    box.append(s);
    paramSliders.T = s;
  }
  history = [];
  rebuild({ keepPath: true });
}

function rebuild() {
  buildL();
  if (!L) return;
  makeQuad();
  evaluate();
  record();
  recomputeTruth();
}

// ----------------------------------------------------------------- path controls

const knotSlider = slider({ label: 'Knots', min: 3, max: 16, step: 1, value: 5, title: 'How many points the path is drawn through',
  onInput: (v) => setKnotCount(Math.round(v)) });
$('#knot-box').append(knotSlider);

function setKnotCount(n) {
  if (n === state.knots.length) return;
  // Keep the shape: resample the current path at the new knots.
  const p = path(), ss = Float64Array.from({ length: n }, (_, i) => state.s0 + ((state.s1 - state.s0) * i) / (n - 1));
  state.knots = p.sample(ss).q;
  state.knots[0] = state.q0; state.knots[n - 1] = state.q1;
  makeQuad(); evaluate(); record(); draw();
}

const modeSeg = segmented([
  { value: 'spline', label: 'Smooth', title: 'A smooth curve (cubic spline) through the knots' },
  { value: 'segments', label: 'Straight segments', title: 'Straight lines between the knots: constant speed along each' },
], state.mode, (v) => { state.mode = v; makeQuad(); evaluate(); record(); draw(); }, { label: 'Path shape' });
$('#mode-box').append(modeSeg);

$('#straight').addEventListener('click', () => {
  const n = state.knots.length;
  state.knots = Float64Array.from({ length: n }, (_, i) => state.q0 + ((state.q1 - state.q0) * i) / (n - 1));
  evaluate(); record(); draw();
});

const rollButton = $('#roll');
rollButton.addEventListener('click', () => setRolling(!state.rolling));
function setRolling(on) {
  state.rolling = on;
  rollButton.setAttribute('aria-pressed', String(on));
  if (on) requestAnimationFrame(roll);
}

let rollFrames = 0;
function roll() {
  if (!state.rolling || !L) return;
  const p = path();
  const g = knotGradient(L, p, quad), c = knotCurvature(L, p, quad);
  let cmax = 0, gmax = 0;
  for (let k = 1; k < g.length - 1; k++) { cmax = Math.max(cmax, c[k]); gmax = Math.max(gmax, Math.abs(g[k])); }
  if (!(cmax > 0) || !Number.isFinite(gmax)) { setRolling(false); return; }
  // Steepest descent with a step set by the stiffest knot: stable where S curves upwards,
  // and running away (as it should) along any direction where S curves down.
  const [qlo, qhi] = state.sys.qrange, span = qhi - qlo;
  for (let k = 1; k < g.length - 1; k++) {
    const step = Math.max(-0.04 * span, Math.min(0.04 * span, (-0.5 * g[k]) / cmax));
    state.knots[k] += step;
  }
  evaluate(); record(); draw();
  rollFrames++;
  const away = state.knots.some((q) => q < qlo - span || q > qhi + span);
  if (gmax / cmax < 1e-6 * span || away || rollFrames > 2000) { setRolling(false); rollFrames = 0; return; }
  requestAnimationFrame(roll);
}

// What to show.
const showToggles = {
  truth: toggle('True path', state.show.truth, (on) => { state.show.truth = on; showTruthList(); draw(); }, 'The path(s) that make the action stationary, dashed'),
  hints: toggle('Hints', state.show.hints, (on) => { state.show.hints = on; draw(); }, 'Arrows: where each knot would go to lower the action most'),
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
  if (!truths.length) { box.append(el('div', {}, 'No true path found between these end points.')); return; }
  truths.forEach((t, i) => {
    const kind = t.index === 0 ? 'minimum' : `saddle point, index ${t.index}`;
    box.append(el('div', { class: 'path' }, el('span', { class: 'swatch', style: { borderColor: truthColor(i, t) } }),
      `${actionWord()} ${fmt(t.S, 5)} (${kind})`));
  });
}

// ------------------------------------------------------------------- drawing

const pathCanvas = $('#path');
let frame = null;            // the path plot's frame
let toPx = null, fromPx = null;

function truthColor(i, t) {
  const c = themeColors();
  return t.index === 0 ? c.good : ['#d9822b', '#b5527c', '#7d5bd0', '#3d8fb0'][i % 4];
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

function drawPath() {
  const { ctx, width, height } = fitCanvas(pathCanvas);
  const c = themeColors(), d = state.sys;
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 52, right: 16, top: 12, bottom: 36 });
  frame = f;
  const [qlo, qhi] = d.qrange;
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
      ctx.strokeStyle = truthColor(i, t);
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
  const p = path(), ss = Float64Array.from({ length: 300 }, (_, i) => state.s0 + ((state.s1 - state.s0) * i) / 299);
  const smp = p.sample(ss);
  const bad = current && !Number.isFinite(current.S);
  ctx.strokeStyle = bad ? c.warn : c.accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let j = 0; j < ss.length; j++) {
    const [x, y] = toPx(ss[j], smp.q[j]);
    if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // Hints: where each knot would go, alone, to lower S most (a Newton step along that knot).
  if (state.show.hints && L) {
    const g = knotGradient(L, p, quad), cv = knotCurvature(L, p, quad);
    const span = qhi - qlo, ks = p.knotS;
    ctx.strokeStyle = c.ink2; ctx.fillStyle = c.ink2; ctx.lineWidth = 1.5;
    for (let k = 1; k < state.knots.length - 1; k++) {
      let dq = cv[k] > 0 ? -g[k] / cv[k] : -Math.sign(g[k]) * 0.25 * span;
      dq = Math.max(-0.35 * span, Math.min(0.35 * span, dq));
      const [x0, y0] = toPx(ks[k], state.knots[k]), [x1, y1] = toPx(ks[k], state.knots[k] + dq);
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 4) continue;
      arrow(ctx, x0, y0, x1, y1);
    }
  }
  // The knots: circles, the end points squares.
  const ks = p.knotS;
  for (let k = 0; k < state.knots.length; k++) {
    const [x, y] = toPx(ks[k], state.knots[k]);
    ctx.fillStyle = c.panel; ctx.strokeStyle = bad ? c.warn : c.accent; ctx.lineWidth = 2.5;
    ctx.beginPath();
    if (k === 0 || k === state.knots.length - 1) ctx.rect(x - 6, y - 6, 12, 12);
    else ctx.arc(x, y, 6.5, 0, 2 * Math.PI);
    ctx.fill(); ctx.stroke();
    if (dragging && dragging.k === k) { ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(x, y, 3, 0, 2 * Math.PI); ctx.fill(); }
  }
  ctx.restore();
  f.axes({ xlabel: d.vertical ? d.q : d.s, ylabel: d.vertical ? d.s : d.q });
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
  const sorted = [...vals].sort((a, b) => a - b);
  let lo = sorted[0], hi = sorted[Math.floor(0.9 * (sorted.length - 1))];
  if (state.show.truth) for (const t of truths) { lo = Math.min(lo, t.S); hi = Math.max(hi, t.S); }
  if (hi - lo < 1e-9 * (1 + Math.abs(hi))) { hi += 0.5 * (1 + Math.abs(hi)) * 1e-3; lo -= 0.5 * (1 + Math.abs(lo)) * 1e-3; }
  const pad = 0.08 * (hi - lo);
  f.x0 = 0; f.x1 = Math.max(50, history.length); f.y0 = lo - pad; f.y1 = hi + pad;
  f.clip();
  if (state.show.truth) {
    truths.forEach((t, i) => {
      const y = f.Y(t.S);
      ctx.setLineDash([6, 4]); ctx.strokeStyle = truthColor(i, t); ctx.lineWidth = 1.5;
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
  const [qlo, qhi] = d.qrange;
  // The momentum range of the paths, ignoring the extreme 3% (the brachistochrone's momentum
  // is infinite at its start).
  const seen = [];
  const consider = (q, v, s) => { const p = momentum(L, q, v, s); for (const x of p) if (Number.isFinite(x)) seen.push(x); };
  for (const t of truths) consider(t.q, t.v, t.s);
  if (current) consider(current.samples.q, current.samples.v, quad.s);
  if (!seen.length) return;
  seen.sort((a, b) => a - b);
  let plo = seen[Math.floor(0.03 * (seen.length - 1))], phi = seen[Math.floor(0.97 * (seen.length - 1))];
  const pad = 0.6 * Math.max(phi - plo, 0.5);
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

function drawPhase() {
  const cv = $('#phase');
  const { ctx, width, height } = fitCanvas(cv);
  const c = themeColors(), d = state.sys;
  ctx.clearRect(0, 0, width, height);
  ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = c.ink2;
  ctx.fillText('Phase space: the path in (q, p)', 10, 15);
  if (!phaseGrid || !current) {
    ctx.fillStyle = c.ink3;
    const timeDependent = state.sys.typed === 'L' || (state.sys.typed === 'V' && typedExpr?.uses('t'));
    ctx.fillText(phaseGrid ? '' : timeDependent ? 'L depends on time: H is not conserved, no contours' : '', 10, 34);
    if (!current) return;
  }
  const f = new Frame(ctx, width, height, { left: 46, right: 10, top: 22, bottom: 34 });
  const g = phaseGrid;
  f.x0 = g ? g.q0 : d.qrange[0]; f.x1 = g ? g.q1 : d.qrange[1];
  let plo = g?.p0, phi = g?.p1;
  if (!g) {
    const p = momentum(L, current.samples.q, current.samples.v, quad.s);
    plo = Math.min(...p.filter(Number.isFinite)); phi = Math.max(...p.filter(Number.isFinite));
    const pad = 0.2 * (phi - plo || 1); plo -= pad; phi += pad;
  }
  f.y0 = plo; f.y1 = phi;
  f.clip();
  if (g) {
    ctx.strokeStyle = c.line; ctx.lineWidth = 1;
    ctx.beginPath();
    const X = (i) => f.X(g.q0 + ((g.q1 - g.q0) * i) / (g.nq - 1)), Y = (j) => f.Y(g.p0 + ((g.p1 - g.p0) * j) / (g.np - 1));
    for (const level of g.levels) contour(g.H, g.nq, g.np, level, (x0, y0, x1, y1) => { ctx.moveTo(X(x0), Y(y0)); ctx.lineTo(X(x1), Y(y1)); });
    ctx.stroke();
  }
  const curve = (q, v, s, color, dash, width2) => {
    const p = momentum(L, q, v, s);
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
  if (state.show.truth) truths.forEach((t, i) => curve(t.q, t.v, t.s, truthColor(i, t), [6, 4], 1.8));
  curve(current.samples.q, current.samples.v, quad.s, c.accent, [], 2.2);
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
  const E = energy(L, current.samples.q, current.samples.v, quad.s);
  const all = Array.from(E).filter(Number.isFinite);
  const tE = state.show.truth ? truths.map((t) => energy(L, t.q, t.v, t.s)) : [];
  for (const e of tE) for (const x of e) if (Number.isFinite(x)) all.push(x);
  if (!all.length) return;
  const sorted = all.sort((a, b) => a - b);
  let lo = sorted[Math.floor(0.02 * (sorted.length - 1))], hi = sorted[Math.floor(0.98 * (sorted.length - 1))];
  if (hi - lo < 1e-6 * (1 + Math.abs(hi))) { lo -= 0.5 * (1 + Math.abs(lo)) * 0.1; hi += 0.5 * (1 + Math.abs(hi)) * 0.1; }
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
  tE.forEach((e, i) => line(truths[i].s, e, truthColor(i, truths[i]), [6, 4], 1.8));
  line(quad.s, E, c.accent, [], 2);
  ctx.restore();
  f.axes({ xlabel: d.s, ylabel: 'E' });
}

function updateReadout() {
  const box = $('#readout'), d = state.sys;
  if (!current) { box.textContent = ''; return; }
  const S = current.S;
  const parts = [];
  if (!Number.isFinite(S)) {
    const why = d.id === 'twin' ? 'faster than light somewhere: no proper time, no action'
      : d.id === 'brachistochrone' ? 'the bead would have to climb above its start' : 'the action is undefined for this path';
    parts.push(`<span class="big warn">${why}</span>`);
  } else {
    const m = state.params.m ?? 1;
    if (d.id === 'twin') parts.push(`<span class="big">τ = ${fmt(-S / m, 5)}</span>`, `<span>S = −mτ = <span class="mono">${fmt(S, 5)}</span></span>`);
    else parts.push(`<span class="big">${actionWord()} ${fmt(S, 5)}</span>`);
    if (current.kinetic !== null && d.id !== 'twin') {
      parts.push(`<span>∫T dt <span class="mono">${fmt(current.kinetic, 4)}</span></span>`, `<span>−∫V dt <span class="mono">${fmt(S - current.kinetic, 4)}</span></span>`);
    }
    if (state.show.truth && truths.length) {
      const best = truths[0], diff = S - best.S;
      const cls = diff < -1e-9 ? 'warn' : Math.abs(diff) < 1e-3 * (1 + Math.abs(best.S)) ? 'good' : '';
      const note = diff < -1e-9 ? 'below the true path: it is not a minimum!' : Math.abs(diff) < 1e-3 * (1 + Math.abs(best.S)) ? 'on the true path' : 'above the true path';
      parts.push(`<span class="${cls}">${note} (${diff >= 0 ? '+' : ''}${fmt(diff, 3)})</span>`);
    }
  }
  box.innerHTML = parts.join('');
}

// --------------------------------------------------------------- dragging knots

let dragging = null;
pathCanvas.addEventListener('pointerdown', (e) => {
  if (!frame || !toPx) return;
  const r = pathCanvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  // The knot nearest in s (time): pressing anywhere above or below it grabs it.
  const ks = path().knotS;
  let best = -1, bestD = Infinity;
  for (let k = 0; k < ks.length; k++) {
    const [x, y] = toPx(ks[k], state.knots[k]);
    const dAlong = state.sys.vertical ? Math.abs(y - py) : Math.abs(x - px);
    if (dAlong < bestD) { bestD = dAlong; best = k; }
  }
  const spacing = state.sys.vertical ? frame.h / (ks.length - 1) : frame.w / (ks.length - 1);
  if (best < 0 || bestD > spacing / 2 + 8) return;
  dragging = { k: best };
  pathCanvas.setPointerCapture(e.pointerId);
  pathCanvas.classList.add('dragging');
  setRolling(false);
  moveKnot(px, py);
  e.preventDefault();
});
pathCanvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const r = pathCanvas.getBoundingClientRect();
  moveKnot(e.clientX - r.left, e.clientY - r.top);
});
const endDrag = () => { if (dragging) { dragging = null; pathCanvas.classList.remove('dragging'); draw(); } };
pathCanvas.addEventListener('pointerup', endDrag);
pathCanvas.addEventListener('pointercancel', endDrag);

let pending = false;
function moveKnot(px, py) {
  const [, q] = fromPx(px, py), k = dragging.k, n = state.knots.length;
  const [qlo, qhi] = state.sys.qrange, span = qhi - qlo;
  state.knots[k] = Math.max(qlo - 0.05 * span, Math.min(qhi + 0.05 * span, q));
  if (k === 0) state.q0 = state.knots[0];
  if (k === n - 1) state.q1 = state.knots[n - 1];
  if (k === 0 || k === n - 1) recomputeTruth(120);
  // One evaluation and one history point per animation frame, however fast the pointer.
  if (!pending) {
    pending = true;
    requestAnimationFrame(() => { pending = false; evaluate(); record(); draw(); });
  }
}

// Keyboard: arrows move the knot nearest the middle, for those who can't drag.
pathCanvas.addEventListener('keydown', (e) => {
  if (!['ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const k = Math.floor(state.knots.length / 2), span = state.sys.qrange[1] - state.sys.qrange[0];
  state.knots[k] += (e.key === 'ArrowUp' ? 1 : -1) * span * 0.01 * (state.sys.flip ? -1 : 1);
  evaluate(); record(); draw();
});

window.addEventListener('resize', () => draw());

// ------------------------------------------------------------------ experiments

const byId = (id) => SYSTEMS.find((s) => s.id === id);
function setShow(over) {
  for (const [k, t] of Object.entries(showToggles)) {
    const on = over[k] ?? (k === 'phasor');
    t.on = on; state.show[k] = on;
  }
  $('#phasor').hidden = !state.show.phasor; $('#hbar-box').hidden = !state.show.phasor;
}
function go(id, { bend = 0, knots, show = {}, mode = 'spline', T, params } = {}) {
  setRolling(false);
  state.mode = mode; modeSeg.value = mode;
  setShow(show);
  const d = byId(id);
  setSystem(d, { bend, knots });
  if (params) for (const [k, v] of Object.entries(params)) { state.params[k] = v; paramSliders[k] && (paramSliders[k].value = v); }
  if (T) { state.s1 = state.s0 + T; paramSliders.T && (paramSliders.T.value = T); }
  if (params || T) {
    const n = state.knots.length;
    state.knots = Float64Array.from({ length: n }, (_, i) => state.q0 + ((state.q1 - state.q0) * i) / (n - 1) + bend * Math.sin((Math.PI * i) / (n - 1)));
    history = [];
    rebuild();
  }
  showTruthList();
  draw();
}

const setups = {
  find: () => go('free', { bend: 2.5 }),
  throw: () => go('gravity', { bend: 2 }),
  hints: () => go('gravity', { bend: -1, show: { hints: true }, knots: 7 }),
  energy: () => go('gravity', { bend: 3, show: { truth: true }, knots: 6 }),
  phase: () => go('harmonic', { bend: 0.8, show: { truth: true } }),
  saddle: () => go('harmonic', { T: 4, bend: 0.5, show: { truth: true } }),
  pendulum: () => go('pendulum', { show: { truth: true } }),
  twin: () => go('twin', { bend: 3 }),
  light: () => go('refraction', { show: { truth: true } }),
  brach: () => go('brachistochrone', { show: { truth: true } }),
  segments: () => go('gravity', { mode: 'segments', knots: 4, bend: 2, show: { truth: true } }),
  feynman: () => go('gravity', { bend: 1, show: { phasor: true, truth: true } }),
  damped: () => go('typedL', { show: { truth: true } }),
  typed: () => go('typedV', { show: { truth: true } }),
};
drawer($('#help'), $('#help-button'), setups);

// ------------------------------------------------------------------------ start

const hash = readHash();
setShow({});
if (setups[hash.setup]) setups[hash.setup]();
else if (!fromHash(hash)) setSystem(SYSTEMS[1], { bend: 2 });

window.__app = { state, setups, get truths() { return truths; }, get current() { return current; }, get history() { return history; }, setSystem, setRolling, ready: true };
