// Bloch sphere and NMR: the page.  One spin (or many) on the Bloch sphere, pulses sent in by hand
// or by a sequence, the signal a coil would record, and the Earth's-field board's
// polarize-and-listen.  The physics is in bloch.js, engine.js, signal.js and sequence.js; the
// sphere is drawn by sphere.js and the plots by charts.js; this file is the page.

import { GAMMA_HZ, pulseField, pulseDuration, spinHalf, T2star, spreadT2, toLab, adiabaticity, coilAxis } from './bloch.js';
import { Engine } from './engine.js';
import { spectrum, fitShape } from './signal.js';
import { PRESETS, buildSequence, runSequence, echoAmplitudes, startSequence, clockSample, clockFits, clockTrain } from './sequence.js';
import { SphereView } from './sphere.js';
import { drawSignal, drawRaw, drawSpectrum, drawCurve, drawTrace, drawTank, drawClocks, timeUnit, pulseName, duration, legend } from './charts.js';
import { TANK, RECEIVER, bankC, switchesOn, codeFor, resonance, capacitanceFor, quality, tankWidth, tuneFor, tankH, filterH, noiseDensity, receiverNoise, kTC, synthOut } from './receiver.js';
import { el, $, $$, slider, segmented, drawer, readHash, writeHash, setSlots, setGroups } from '../lib/ui.js';
import { fitCanvas, Frame } from '../lib/plot.js';
import { renderMath } from '../lib/mathml.js';

const DEG = Math.PI / 180;
const NSIG = 4096;       // the spins the ensemble's signal is made of (the sphere shows a few)
const SCREEN = 10;       // seconds of the page's time that the scrolling plots hold
const SAMPLES_PER_WINDOW = 1000;
const BUDGET = 4e5;      // spin-steps a frame at most

// ------------------------------------------------------------------- the two instruments

const INSTRUMENTS = {
  teachspin: {
    label: 'TeachSpin (5 MHz)', short: 'TeachSpin',
    title: 'The TeachSpin pulsed NMR: protons in a 0.117 T magnet, at 5 MHz; RF pulses of a few microseconds',
    B0: 5e6 / GAMMA_HZ, B0range: [0.02, 0.25], B0unit: { s: 1e3, u: 'mT', dec: 2 },
    pi2: 2.5e-6, B1range: [5e-5, 2e-2], B1unit: { s: 1e3, u: 'mT', dec: 3 },
    offsetRange: [-300e3, 300e3], offsetUnit: { s: 1e-3, u: 'kHz', dec: 1 },
    spread: 500, spreadRange: [5, 20000], spreadUnit: { s: 1, u: 'Hz', dec: 0 },
    T1range: [1e-3, 10], T2range: [1e-4, 10],
    speedRange: [1e-9, 1], speedLab: 2e-7,
    fUnit: { s: 1e-6, u: 'MHz', dec: 6 },
    samples: {
      oil: { label: 'Mineral oil', T1: 0.025, T2: 0.020, title: 'Light mineral oil: T₁ about 25 ms, T₂ about 20 ms at 5 MHz' },
      cuso4: { label: 'Water + CuSO₄', T1: 0.012, T2: 0.010, title: 'Water with a little copper sulphate, whose ions shorten T₁ and T₂ to about 10 ms' },
      water: { label: 'Pure water', T1: 2.5, T2: 2.0, title: 'Pure water: T₁ and T₂ of seconds (repeat slowly!)' },
    },
    sample: 'oil',
  },
  earth: {
    label: "Earth's field (board)", short: 'the board',
    title: "The Earth's-field NMR board: a litre of water in the Earth's 46.0 μT (Claremont), protons at 1960 Hz",
    B0: 46.03e-6, B0range: [20e-6, 70e-6], B0unit: { s: 1e6, u: 'μT', dec: 2 },
    pi2: 2.5e-3, B1range: [1e-8, 1e-5], B1unit: { s: 1e6, u: 'μT', dec: 3 },
    offsetRange: [-50, 50], offsetUnit: { s: 1, u: 'Hz', dec: 2 },
    spread: GAMMA_HZ * 5e-9, spreadRange: [0.01, 50], spreadUnit: { s: 1, u: 'Hz', dec: 3 },
    T1range: [0.01, 10], T2range: [0.01, 10],
    speedRange: [1e-6, 10], speedLab: 5e-4,
    fUnit: { s: 1, u: 'Hz', dec: 2 },
    samples: {
      water: { label: 'Tap water', T1: 2.5, T2: 2.0, title: 'A litre of tap water: T₁ about 2.5 s (2 to 3 s)' },
      cuso4: { label: 'Copper sulphate', T1: 0.3, T2: 0.25, title: 'Tap water with a pinch of copper sulphate: T₁ falls to a few tenths of a second' },
      oil: { label: 'Oil', T1: 0.1, T2: 0.08, title: 'Cooking oil: T₁ about 0.1 s, and fewer protons per litre than water' },
    },
    sample: 'water',
  },
};
const inst = () => INSTRUMENTS[state.inst];

// ------------------------------------------------------------------------------ state

const state = {
  view: 'one', inst: 'teachspin', sample: 'oil',
  B0: INSTRUMENTS.teachspin.B0, B1: pulseField(Math.PI / 2, 2.5e-6), offsetHz: 0,
  T1: 0.025, T2: 0.020, T1on: false, T2on: false,
  ensemble: false, spreadHz: 500, arrows: 32,
  noiseOn: false, snr: 20, averages: 1,
  frame: 'lab', speed: 2e-7, playing: true,
  custom: { angle: 45, phase: 0 },
};

const eng = new Engine({});
/** A scripted run: pulses (centres at t), the clock from t0 to span, and again if loop. */
let run = null, pauseLeft = 0, freeStart = 0, runId = 0;
// The noise is drawn afresh for every run, from a seed that a set-up resets: so each set-up's
// first run (the one its help quotes) is the same every time, and its repeats differ.
let seedCount = 0;
function reseed() { eng.noiseSeed = (20261104 + 7919 * seedCount++) >>> 0; }
const view = new SphereView();
let trail = [];

function applyEngine() {
  eng.configure({
    B0: state.B0, B1: state.B1, offsetHz: state.offsetHz,
    T1: state.T1on ? state.T1 : Infinity, T2: state.T2on ? state.T2 : Infinity,
    N: state.ensemble ? NSIG : 1, spreadHz: state.ensemble ? state.spreadHz : 0,
    averages: state.averages,
  });
}
const sigma = () => (state.noiseOn ? 1 / state.snr : 0);
const T1eff = () => (state.T1on ? state.T1 : Infinity);
const T2eff = () => (state.T2on ? state.T2 : Infinity);

/** The window of time the plots show. */
function windowNow() {
  if (run) return [run.t0, run.span];
  const W = SCREEN * state.speed, t = eng.t;
  return [Math.max(freeStart, t - W), Math.max(freeStart + W, t)];
}

/** Sample often enough for the window shown. */
function resample() {
  const [a, b] = windowNow();
  eng.setSampling((b - a) / SAMPLES_PER_WINDOW);
}

/** Start a scripted run: every spin along z, the pulses at their times (centres). */
function startRun(r) {
  run = { loop: true, ...r }; runId++;
  const starts = run.pulses.map((q) => q.t - pulseDuration(q.angle * DEG, state.B1) / 2);
  run.t0 = Math.min(0, ...starts);
  eng.setSampling((run.span - run.t0) / SAMPLES_PER_WINDOW);
  reseed();
  eng.reset([0, 0, 1], run.t0);
  eng.tEnd = run.span;
  run.pulses.forEach((q, i) => eng.schedule(starts[i], q.angle, q.phase, state.B1));
  trail = []; pauseLeft = 0;
  dirty();
}

/** Leave the scripted run (if any) and carry on freely from where the clock is. */
function goFree() {
  if (!run) return;
  freeStart = run.t0;
  run = null;
  eng.tEnd = Infinity; eng.done = false;
  resample();
}

/** Start afresh with no script: the spins along v, the clock at 0. */
function startFree(v = [0, 0, 1]) {
  run = null; freeStart = 0; runId++;
  eng.reset(v, 0);
  resample();
  trail = [];
  dirty();
}

// --------------------------------------------------------------------------- colours

let C = null;
function readColors() {
  const cs = getComputedStyle(document.documentElement), g = (n, d) => cs.getPropertyValue(n).trim() || d;
  C = {
    ink: g('--ink', '#1d1d1f'), ink2: g('--ink-2', '#555'), ink3: g('--ink-3', '#888'), line: g('--line', '#ddd'), panel: g('--panel', '#fff'),
    mx: g('--mx', '#2f62d8'), my: g('--my', '#c8501a'), mxy: g('--mxy', '#000'), mz: g('--mz', '#1f8a4a'), m: g('--m', '#d1243f'),
    trail: g('--trail', '#e0607a'), b0: g('--b0', '#7b3fb5'), b1: g('--b1', '#b0307a'), beff: g('--beff', '#8a5a00'),
    raw: g('--raw', '#3b4a6b'), spec: g('--spec', '#0f7a8a'), fit: g('--fit', '#b8860b'), points: g('--points', '#000'),
    cone: g('--cone', '#d1243f'), sphereHi: g('--sphere-hi', '#fff'), sphereLo: g('--sphere-lo', '#eee'), coil: g('--coil', '#b87333'),
    slow: g('--slow', '#5b3fc0'), fast: g('--fast', '#d07a00'), perp: g('--perp', '#1d6fd1'),
  };
}
function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(',')})`;
}

// ----------------------------------------------------------------------- formatting

const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
/** 2e-7 as "2×10⁻⁷" (1 as "1"). */
function sci(x) {
  if (x >= 0.1 && x < 100) return String(+x.toPrecision(2));
  const e = Math.floor(Math.log10(x) + 1e-9), m = +(x / 10 ** e).toPrecision(2);
  return `${m === 1 ? '' : `${m}×`}10${String(e).split('').map((ch) => SUP[ch]).join('')}`;
}
/** A time in a unit fixed for the slot: [{v, dec, w}, ' unit']. */
function timeParts(t, unit, dec = 2, w = 7) { return [{ v: t * unit.s, dec, w, class: 'b' }, ` ${unit.u}`]; }
/** Three significant figures in a slot of six: {v, dec, w}. */
function sig3(v, cls = 'b') { const a = Math.abs(v); return { v, dec: a >= 99.95 ? 0 : a >= 9.995 ? 1 : 2, w: 6, class: cls }; }
/** A time in the unit that suits it, to three figures: [{…}, ' unit']. */
function time3(t) { if (!Number.isFinite(t)) return [{ text: '∞', w: 6, class: 'b' }, '']; const u = unitOf(t); return [sig3(t * u.s), ` ${u.u}`]; }
/** A time to three figures in the unit that suits another (a time set, beside its measurement). */
function timeLike(t, ref) { if (!Number.isFinite(t)) return time3(t); const u = unitOf(Number.isFinite(ref) ? ref : t); return [sig3(t * u.s), ` ${u.u}`]; }
/** A time to three figures for a line drawn on a canvas. */
function canvasTime(t) { const u = unitOf(t), v = sig3(t * u.s, ''); return [{ v: v.v, dec: v.dec, w: 5 }, ` ${u.u}`]; }
/** The unit that puts a time between 1 and 1000 of it. */
function unitOf(t) {
  const a = Math.abs(t) * 1.0000001;
  return a < 1e-6 ? { s: 1e9, u: 'ns' } : a < 1e-3 ? { s: 1e6, u: 'μs' } : a < 1 ? { s: 1e3, u: 'ms' } : { s: 1, u: 's' };
}

// ------------------------------------------------------------------------- the sphere

const sphereCanvas = $('#sphere');
let drag = null, hoverTip = false, hoverCoil = false;

function tipScreen() {
  const m = shownSum();
  return view.P(m);
}
/** The arrow the sphere shows as the main one: the spin, or the sum of the ensemble. */
function shownSum() { return eng.sum(state.frame); }

sphereCanvas.addEventListener('pointerdown', (e) => {
  const r = sphereCanvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const T = tipScreen(), m = shownSum();
  sphereCanvas.setPointerCapture(e.pointerId);
  // (The board's spins are set by its cycle: there the sphere turns, and the coil's ends turn
  // the coil.)
  if (state.view !== 'earth' && Math.hypot(x - T[0], y - T[1]) < 18 && Math.hypot(...m) > 0.05) {
    drag = { kind: 'tip', back: T[2] < 0 };
    leaveClocks();
    goFree();
    eng.queue = [];
  } else if (nearCoilEnd(x, y)) drag = { kind: 'coil' };
  else drag = { kind: 'turn', x, y };
  sphereCanvas.classList.add('dragging');
});
/** Whether the screen point is on one of the coil's end handles (view 4). */
function nearCoilEnd(x, y) {
  return state.view === 'earth' && view.coilEnds(coilAxis(board.angle * DEG)).some((p) => Math.hypot(x - p[0], y - p[1]) < 20);
}
sphereCanvas.addEventListener('pointermove', (e) => {
  const r = sphereCanvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if (!drag) {
    const T = tipScreen(), on = state.view !== 'earth' && Math.hypot(x - T[0], y - T[1]) < 18;
    const onCoil = nearCoilEnd(x, y);
    if (on !== hoverTip) { hoverTip = on; sphereCanvas.classList.toggle('on-tip', on || onCoil); }
    if (onCoil !== hoverCoil) { hoverCoil = onCoil; sphereCanvas.classList.toggle('on-tip', on || onCoil); dirty(); }
    return;
  }
  if (drag.kind === 'turn') { view.turn(x - drag.x, y - drag.y); drag.x = x; drag.y = y; trail = trail.slice(-2); }
  else if (drag.kind === 'coil') {
    const a = view.angleXZ(x, y);
    if (a !== null) setAngle(a / DEG);
  } else {
    const v = view.pick(x, y, drag.back);
    eng.setVector(v, state.frame);
    trail = [];
    scheduleHash();
  }
  dirty();
});
const endDrag = () => { drag = null; sphereCanvas.classList.remove('dragging'); };
sphereCanvas.addEventListener('pointerup', endDrag);
sphereCanvas.addEventListener('pointercancel', endDrag);

/** How many turns of the precession the sphere would show in one frame (at 60 frames a second). */
function turnsPerFrame() {
  let f = state.frame === 'lab' ? eng.f0 : Math.abs(state.offsetHz);
  if (state.view === 'earth' && eng.earth && state.frame === 'lab') {
    const E = eng.earth, s = eng.t < E.tp ? 1 : eng.t < E.tp + E.ramp ? Math.max(0, 1 - (eng.t - E.tp) / E.ramp) : 0;
    const n = coilAxis(board.angle * DEG);
    f = GAMMA_HZ * Math.hypot(Bp() * s * n[0], board.BE + Bp() * s * n[2]);
  } else if (state.view === 'earth' && eng.earth) f = eng.t < eng.earth.tp + eng.earth.ramp ? eng.f0 : 0;
  return (f * speedNow()) / 60;
}

function drawSphere() {
  const { ctx, width, height } = fitCanvas(sphereCanvas);
  ctx.clearRect(0, 0, width, height);
  // (On the board the sphere, with the coil round it, keeps above the note that says what the cycle does.)
  const noteH = state.view === 'earth' ? 0.2 * height : 0;
  view.fit(width, height - noteH);
  const lab = state.frame === 'lab', fields = [];
  const fast = turnsPerFrame() > 0.12;
  const m = shownSum();
  const P = eng.pulse;
  const E = state.view === 'earth' && eng.earth ? eng.earth : null;
  let coneAxis = [0, 0, 1];
  const nC = coilAxis(board.angle * DEG);
  if (E) {
    const s = eng.t < E.tp ? 1 : eng.t < E.tp + E.ramp ? Math.max(0, 1 - (eng.t - E.tp) / E.ramp) : 0;
    if (lab) {
      fields.push({ v: [0, 0, 0.4], from: [0, 0, 1.04], color: C.b0, label: 'B_E (the Earth\'s)', dx: 48 });
      if (s > 0) {
        const len = 0.15 + 0.3 * s;
        fields.push({ v: nC.map((x) => len * x), from: nC.map((x) => 1.16 * x), color: C.coil, label: `B_p = ${(Bp() * s / board.BE).toFixed(Bp() * s / board.BE < 9.95 ? 1 : 0)} B_E`, dy: -16, dx: 10 });
        const b = [Bp() * s * nC[0], 0, board.BE + Bp() * s * nC[2]], n = Math.hypot(...b);
        coneAxis = b.map((x) => x / n);
        // (Labelled once it has turned off the coil's axis, where B_p's label is.)
        if (eng.t >= E.tp) fields.push({ v: coneAxis.map((x) => 1.12 * x), color: C.beff, label: coneAxis[2] > 0.3 ? 'B (total)' : '', dash: [6, 4], dy: -16 });
      }
    }
  } else if (lab) {
    fields.push({ v: [0, 0, 0.4], from: [0, 0, 1.04], color: C.b0, label: 'B₀', dx: 16 });
    if (P && !fast) {
      const a = P.phase * DEG - eng.omegaRef * eng.t;
      fields.push({ v: [0.8 * Math.cos(a), 0.8 * Math.sin(a), 0], color: C.b1, label: 'B₁' });
    }
  } else {
    const B = eng.fieldNow(), dB = B[2];
    if (P) {
      const b1 = Math.hypot(B[0], B[1]);
      fields.push({ v: [(0.85 * B[0]) / b1, (0.85 * B[1]) / b1, 0], color: C.b1, label: 'B₁' });
    }
    if (state.offsetHz !== 0) {
      if (P) {
        const b = Math.hypot(B[0], B[1], dB);
        fields.push({ v: [(1.1 * B[0]) / b, (1.1 * B[1]) / b, (1.1 * dB) / b], color: C.beff, label: 'B_eff', dash: [6, 4] });
      } else {
        fields.push({ v: [0, 0, 0.75 * Math.sign(dB)], color: C.beff, label: 'B_eff = ΔB', dash: [6, 4], dx: 34 });
      }
    }
  }
  const spins = [];
  if (state.ensemble && !(lab && fast)) {
    const vs = eng.vectors(state.frame, state.arrows), n = vs.length;
    vs.forEach((v, k) => {
      const q = n > 1 ? k / (n - 1) : 0.5;
      spins.push({ v, color: q < 0.5 ? mix(C.slow, C.ink3.startsWith('#') ? C.ink3 : '#8a8b91', q * 2) : mix(C.ink3.startsWith('#') ? C.ink3 : '#8a8b91', C.fast, q * 2 - 1), width: 1.3, alpha: 0.8 });
    });
  }
  view.draw(ctx, {
    colors: C, axisLabels: lab ? ['x', 'y', 'z'] : ['x′', 'y′', 'z'],
    fields, spins, sum: m, sumWidth: state.ensemble ? 4.5 : 4,
    trail: E ? trail : trailPoints(), projections: true,
    // (The three clocks: the ring the spins' tips lie on, its radius each one's own part across B₀.)
    rings: clocks.on ? [{ z: m[2], r: eng.meanTransverse(), color: C.perp, width: 2.4, label: 'each spin\'s |M⊥|' }] : [],
    cone: lab && fast ? { axis: coneAxis, v: m } : null, coil: !!E && lab, coilAxis: nC, coilHover: hoverCoil || drag?.kind === 'coil',
    tipHover: hoverTip || drag?.kind === 'tip',
  });
  sphereNote(fast);
}

function sphereNote(fast) {
  const lab = state.frame === 'lab', u = inst().fUnit, f = (eng.f0 + state.offsetHz) * u.s;
  let s;
  const turns = Math.round(turnsPerFrame() * 60).toLocaleString('en');
  const E = state.view === 'earth' && eng.earth;
  if (E) {
    const t = eng.t, now = t < E.tp ? `<b>Polarizing</b>: the current's field B_p magnetizes the water along the coil (${(100 * polarizedAt(t)).toFixed(0)}% so far)`
      : t < E.tp + E.ramp ? `<b>Switching off</b>: B_p falls and the total field turns from the coil's axis to the Earth's; ${adiabaticity(Bp(), board.BE, board.ramp, board.angle * DEG) < 0.3 ? 'too fast for M, which stays where it was' : 'slowly enough for M to follow it'}`
        : t < tOpenAbs() ? '<b>The receiver is off</b> for 19 ms while the relay hands the coil over; M goes round the Earth\'s field'
          : eng.done ? '<b>Done</b>: the cycle starts again (Repeat)' : `<b>Listening</b>: M goes round the Earth's field at ${eng.f0.toFixed(0)} Hz and the coil picks it up`;
    const cone = fast && t >= E.tp + E.ramp, square = Math.abs(board.angle - 90) < 0.05;
    const axis = square ? 'the coil along x (east–west), square to it' : `the coil at α = ${board.angle.toFixed(1)}° to it: sin α = ${Math.sin(board.angle * DEG).toFixed(2)} of M precesses, and the coil sees sin α of that`;
    s = `${now}.  <span class="more">${lab ? `Lab frame: B_E along z, ${axis}.${cone ? `  The cone is the tip's path (${turns} turns a second on screen).` : ''}` : 'Rotating frame, at the Larmor frequency in the Earth\'s field.'}</span>`;
  } else if (lab) s = `<b>Lab frame</b>: the field B₀ along z, the coil along x.${fast ? `  <span class="more">At this speed the spin turns ${turns} times a second on screen, too fast to draw: the cone is the path of its tip.  </span>Slow the clock, or use the rotating frame.` : ''}`;
  else s = `<b>Rotating frame</b>: turning with the RF, at ${f.toFixed(u.dec)} ${u.u}, so B₀ is gone${state.offsetHz ? ' but for ΔB, as the RF is off resonance' : ''}.`;
  if (clocks.on) s += '  <span class="more">The blue ring is where the spins\' tips lie: its radius is each spin\'s own part across B₀ (T₂ shrinks it), its height M<sub>z</sub> (T₁ lifts it); the red arrow is their sum, what the coil sees (the fan shortens it).</span>';
  const P = eng.pulse;
  if (P && !E) {
    const done = Math.min(1, Math.max(0, (eng.t - P.t0) / P.dur)), u = unitOf(P.dur);
    s += `  <b>RF on</b>: ${pulseName(P.angle, P.phase)}, ${(done * P.dur * u.s).toFixed(2)} of ${(P.dur * u.s).toFixed(2)} ${u.u}.`;
  }
  const note = $('#sphere-note');
  if (note._s !== s) { note.innerHTML = s; note._s = s; }
}

/**
 * The path of the main arrow's tip over the last 2.5 s on screen, from the record (its
 * rotating-frame components, interpolated, turned into the lab frame when that is shown): smooth
 * however fast the clock runs, and the same path the plots record.
 */
function trailPoints() {
  const R = eng.record, n0 = R.length;
  if (n0 < 2 || turnsPerFrame() > 0.12) return [];
  const t1 = eng.t, t0 = Math.max(R.t[0], t1 - 2.5 * speedNow());
  if (t1 <= t0) return [];
  const lab = state.frame === 'lab', w = eng.omegaRef;
  const turns = (lab ? eng.f0 + state.offsetHz : Math.abs(state.offsetHz)) * (t1 - t0);
  const n = Math.min(1200, Math.max(60, Math.ceil(turns * 48)));
  const out = [], tmp = [0, 0, 0];
  for (let k = 0; k <= n; k++) {
    const t = t0 + ((t1 - t0) * k) / n, m = R.at(t, 0, tmp);
    out.push(lab ? toLab(m, w, t) : [m[0], m[1], m[2]]);
  }
  out.push(eng.sum(state.frame));
  return out;
}

// ---------------------------------------------------------------------------- the plots

let specCache = { key: '', spec: null, frame: 0 }, lastSpec = null;

function drawPlots() {
  if (state.view === 'earth') { drawBoardPlots(); return; }
  if (clocks.on) { drawClocksPlot(); return; }
  const [t0, t1] = windowNow(), sg = sigma();
  {
    const { ctx, width, height } = fitCanvas($('#signal'));
    ctx.clearRect(0, 0, width, height);
    drawSignal(ctx, width, height, {
      record: eng.record, t0, t1, ymax: 1.12, sigma: sg, colors: C, sent: eng.sent, now: eng.t,
      title: 'The signal with the RF taken out (the mixer\'s outputs):', show: { mx: true, my: true, mxy: true, mz: true },
    });
  }
  {
    const { ctx, width, height } = fitCanvas($('#raw'));
    ctx.clearRect(0, 0, width, height);
    drawRaw(ctx, width, height, {
      record: eng.record, omegaRef: eng.omegaRef, t0, t1, ymax: 1.12, sigma: sg, colors: C, sent: eng.sent, now: eng.t,
      title: 'The voltage in the coil (what a scope on it shows)',
    });
  }
  if (state.view === 'many') drawSpec(t0, t1);
  if (state.view === 'seq') { drawTimeline(); drawSpec(t0, t1, seq.acq); drawSeqCurve(); }
}

/** The spectrum of the signal since the last pulse ended (or of the whole window), sampled
 *  finely enough for the line and padded so its bins are a small part of the plotted range. */
function specOf(a, b, span, sg = sigma()) {
  const win = b - a;
  let n = 64;
  while (n < 2048 && win / n > 1 / (8 * span)) n *= 2;
  const dt = win / n;
  let N = 4 * n;
  while (N < 65536 && N * dt < 150 / span) N *= 2;
  return spectrum(eng.record, a, b, sg, n, N / n);
}
function drawSpec(t0, t1, acq = null) {
  const { ctx, width, height } = fitCanvas($('#spec'));
  ctx.clearRect(0, 0, width, height);
  const last = eng.sent.length ? eng.sent[eng.sent.length - 1].t1 : t0;
  const a = acq ? acq[0] : Math.max(t0, last), b = Math.min(acq ? acq[1] : t1, eng.t);
  const line = 1 / (Math.PI * T2star(T2eff(), state.ensemble ? state.spreadHz : 0));
  const span = Math.max(state.inst === 'earth' ? 2 : 200, 3 * (Number.isFinite(line) && line > 0 ? line : 0) + 1.2 * Math.abs(state.offsetHz));
  let spec = null;
  if (b - a > (t1 - t0) * 0.02) {
    // (Recomputed every few frames while the record grows, at once when anything else changed.)
    const key = `${a}|${eng.record.length}|${sigma()}|${span}`, same = specCache.run === `${runId}|${a}|${sigma()}|${span}`;
    const grown = eng.record.length > 1.05 * (specCache.n || 0) + 8;
    if (specCache.key !== key && (!same || grown || specCache.frame++ % 4 === 0)) specCache = { key, run: `${runId}|${a}|${sigma()}|${span}`, spec: specOf(a, b, span), frame: 1, n: eng.record.length };
    spec = specCache.spec;
  }
  lastSpec = spec;
  const fu = span > 3000 ? { s: 1e-3, u: 'kHz', dec: 2 } : { s: 1, u: 'Hz', dec: state.inst === 'earth' ? 2 : 0 };
  drawSpectrum(ctx, width, height, {
    spec, fmin: -span, fmax: span, unit: fu, colors: C, mark: true,
    title: 'Its spectrum (power)', xlabel: `frequency − f₀ (${fu.u})`,
    note: spec && spec.fwhm > 0 ? ['width at half power ', { v: spec.fwhm * fu.s, dec: fu.dec, w: 6 }, ` ${fu.u} · 1/(πT₂*) = `, { v: line * fu.s, dec: fu.dec, w: 6 }, ` ${fu.u}`] : null,
  });
}

// ---------------------------------------------------------------------------- readouts

function readout() {
  const I = inst(), bu = I.B0unit, fu = I.fUnit, ou = I.offsetUnit;
  const m = eng.sum(state.frame), r = Math.hypot(...m), mxy = Math.hypot(m[0], m[1]);
  const lines = [];
  if (state.view === 'earth') {
    boardReadout(lines);
    lines.push(['Slow motion:', ['time ×', { text: sci(boardSpeed()), w: 8 }], board.speedMode === 'auto' ? '(Auto: slower through the switch-off and the first turns)' : '', ['· t = ', ...timeParts(eng.t, { s: 1, u: 's' }, 4, 7)]]);
    const box = $('#readout');
    if (box.children.length !== lines.length) box.replaceChildren(...lines.map(() => el('div')));
    lines.forEach((g, i) => setGroups(box.children[i], g));
    return;
  }
  lines.push(['Field', ['B₀ = ', { v: state.B0 * bu.s, dec: bu.dec, w: 6, class: 'b' }, ` ${bu.u}:`], 'Larmor frequency',
    ['f₀ = γB₀/2π = ', { v: eng.f0 * fu.s, dec: fu.dec, w: fu.dec + (state.inst === 'earth' ? 5 : 3), class: 'b' }, ` ${fu.u}`], '· the RF is', [{ v: state.offsetHz * ou.s, dec: ou.dec, w: 6, plus: '+' }, ` ${ou.u}`], 'off it']);
  const th = r > 1e-9 ? Math.acos(Math.max(-1, Math.min(1, m[2] / r))) / DEG : 0;
  lines.push([state.ensemble ? 'The sum of the spins:' : 'The arrow:', ['θ = ', { v: th, dec: 1, w: 5, class: 'b' }, '°'], 'from B₀ · along B₀',
    ['M', { html: '<sub>z</sub>' }, ' = ', { v: m[2], dec: 3, w: 6, class: 'b' }], '· across it',
    ['|M', { html: '<sub>xy</sub>' }, '| = ', { v: mxy, dec: 3, w: 5, class: 'b' }], '(what the coil sees)']);
  if (state.ensemble) {
    const t2p = spreadT2(state.spreadHz), t2s = T2star(T2eff(), state.spreadHz);
    lines.push(['Spread', ['Δf = ', { v: state.spreadHz * I.spreadUnit.s, dec: I.spreadUnit.dec, w: 6, class: 'b' }, ` ${I.spreadUnit.u}:`],
      ['T₂′ = 1/(πΔf) = ', ...time3(t2p)], state.T2on ? '· with T₂,' : '· with no T₂,', ['T₂* = ', ...time3(t2s)],
      `· ${NSIG} spins, ${state.arrows} drawn`]);
  }
  if (state.view === 'seq') seqReadout(lines);
  if (clocks.on) clocksReadout(lines);
  const [a, b] = windowNow(), tu = timeUnit(b - a), pu = timeUnit(pulseDuration(Math.PI / 2, state.B1));
  if (clocks.on) {
    lines.push(['Slow motion:', ['time ×', { text: sci(speedNow()), w: 8 }], `now, faster as time goes on: a decade every ${CLOCKS.perDecade} s on screen, so the log axis fills evenly`,
      ['· t = ', ...timeParts(eng.t, tu, 2, 7)], '· a π/2 pulse lasts', [...timeParts(pulseDuration(Math.PI / 2, state.B1), pu, 2, 6)]]);
  } else {
    lines.push(['Slow motion:', ['time ×', { text: sci(state.speed), w: 8 }, ','], 'so one second here is', [...timeParts(state.speed, unitOf(state.speed), 2, 6)], 'of the real thing',
      ['· t = ', ...timeParts(eng.t, tu, 2, 7)], '· a π/2 pulse lasts', [...timeParts(pulseDuration(Math.PI / 2, state.B1), pu, 2, 6)]]);
  }
  // Settling at this speed: how long T2 (or T1) takes on screen, when it is too long to watch.
  const tset = state.T2on ? state.T2 : state.T1on ? state.T1 : 0;
  if (tset && !clocks.on && tset / state.speed > 60) lines.push([`${state.T2on ? 'T₂' : 'T₁'} would take`, [{ text: sci(tset / state.speed), w: 8 }, ' s'], 'on screen at this speed: speed the clock up (in the rotating frame) to watch the spins settle']);
  const box = $('#readout');
  if (box.children.length !== lines.length) box.replaceChildren(...lines.map(() => el('div')));
  lines.forEach((g, i) => setGroups(box.children[i], g));
}

function spinHalfBox() {
  // One spin: the arrow.  Many: the spin at the middle of the line (each behaves as one spin).
  const v = state.ensemble ? eng.vectors(state.frame, 1)[0] : eng.sum(state.frame);
  const s = spinHalf(v);
  setGroups($('#amps'), [['= ', { v: s.up, dec: 3, w: 5, class: 'b' }, ' |↑⟩ + ', { v: s.down, dec: 3, w: 5, class: 'b' }, ' e', { html: '<sup><i>iφ</i></sup>' }, ' |↓⟩'],
    ['with θ = ', { v: s.theta / DEG, dec: 1, w: 5 }, '°, φ = ', { v: ((s.phi / DEG) + 360) % 360, dec: 0, w: 3 }, '°']]);
  const pu = (1 + v[2] / Math.max(1e-12, s.length)) / 2;
  $('#bar-up').style.width = `${(100 * pu).toFixed(1)}%`;
  $('#bar-down').style.width = `${(100 * (1 - pu)).toFixed(1)}%`;
  $('#p-up').textContent = pu.toFixed(3);
  $('#p-down').textContent = (1 - pu).toFixed(3);
  const why = state.ensemble
    ? `This is the state of the spin at the middle of the line; each arrow behaves as one spin would.  Their sum, ${Math.hypot(...eng.sum('rot')).toFixed(2)} as long as one spin, is no single state: a mixed state.`
    : '↑ is along B₀, the lower energy for a proton.  P(↑) is the chance of finding the spin up if you measured it along B₀.';
  if ($('#spin-why').textContent !== why) $('#spin-why').textContent = why;
}

// ------------------------------------------------------------------------------ the loop

let raf = 0, lastT = 0, testHold = false, needDraw = true;
function dirty() { needDraw = true; kick(); }
function kick() { if (!raf) raf = requestAnimationFrame(loop); }

/** The page's clock speed now: simulated seconds per second (the three clocks' run speeds up in
 *  step with the time since its pulse, so a decade takes as long on screen as the last). */
function speedNow() {
  if (state.view === 'earth') return boardSpeed();
  if (run && run.clocks) return state.speed * Math.max(1, eng.t / clocks.lo);
  return state.speed;
}

/** Move on by dt seconds of the page's time. */
function tick(dt) {
  if (state.view === 'seq') scanStep();
  if (state.view === 'earth') boardScanStep();
  if (clocks.on) clocksCheck();
  if (run && eng.done) {
    if (!run.loop) { if (!run.earth && !run.clocks) goFree(); return; }
    if (pauseLeft <= 0) pauseLeft = 1.5;
    pauseLeft -= dt;
    if (pauseLeft <= 0) { if (run.seq) runSeq(); else if (run.earth) startBoard(); else startRun(run); }
    return;
  }
  if (run && run.earth) { tickBoard(dt); return; }
  eng.advance(dt * speedNow(), BUDGET);
  if (run && run.clocks) clocksTick();
  if (!run) {
    eng.trim(eng.t - 1.5 * SCREEN * state.speed);
    resample();
  }
}

function loop(now) {
  raf = 0;
  const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0;
  lastT = now;
  if (state.playing && !testHold && !document.hidden) tick(dt);
  draw();
  if (!document.hidden) raf = requestAnimationFrame(loop); else lastT = 0;
}

function draw() {
  needDraw = false;
  if (clocks.on) clocksCheck();
  readColors();
  drawSphere();
  drawPlots();
  readout();
  spinHalfBox();
}

// ----------------------------------------------------------------------------- controls

renderMath($('#spin-half'));
// On a phone the spin-½ box comes between the sphere and the plots: folded there until opened.
if (window.matchMedia('(max-width: 900px)').matches) $('#spin-half').open = false;

const viewSeg = segmented([
  { value: 'one', label: '1 · One spin' }, { value: 'many', label: '2 · Many spins' },
  { value: 'seq', label: '3 · Pulse sequences' }, { value: 'earth', label: "4 · The Earth's field" },
], state.view, (v) => { setView(v); defaultsFor(v); }, { label: 'View' });
$('#view-row').append(viewSeg);

const instSeg = segmented(Object.entries(INSTRUMENTS).map(([value, I]) => ({ value, label: I.label, title: I.title })), state.inst, (v) => {
  loadInstrument(v); defaultsFor(state.view);
}, { label: 'Instrument' });
$('#inst-row').append(instSeg);

// Pulses.
const pulsePanel = $('#pulse-panel');
pulsePanel.append(el('div', { class: 'label' }, 'Send a pulse'),
  el('div', { class: 'gloss' }, 'A burst of RF at the Larmor frequency: it turns the spin about an axis across B₀, x′ or y′ in the frame that turns with it, by an angle θ = γB₁τ.'));
const pbox = el('div', { class: 'pulse-buttons' });
for (const [angle, phase, title] of [[90, 0, 'Turn the spin a quarter turn about x′'], [180, 0, 'Turn the spin half a turn about x′'], [90, 90, 'Turn the spin a quarter turn about y′'], [180, 90, 'Turn the spin half a turn about y′']]) {
  pbox.append(el('button', { type: 'button', title, onclick: () => sendPulse(angle, phase) }, `${pulseName(angle, phase).replace(' ', ' about ')}`));
}
pulsePanel.append(pbox);
const angleSlider = slider({ label: 'angle θ (°)', min: 0, max: 360, step: 1, value: state.custom.angle, onInput: (v) => { state.custom.angle = v; updatePulseNote(); scheduleHash(); } });
const phaseSeg = segmented([{ value: 0, label: 'x′' }, { value: 90, label: 'y′' }, { value: 180, label: '−x′' }, { value: 270, label: '−y′' }], 0, (v) => { state.custom.phase = v; if (typeof phaseSlider !== 'undefined') phaseSlider.value = v; scheduleHash(); }, { label: 'Axis' });
const sendButton = el('button', { type: 'button', class: 'primary', onclick: () => sendPulse(state.custom.angle, state.custom.phase) }, 'Send');
pulsePanel.append(el('div', { class: 'small muted' }, 'Or one of your own:'), angleSlider, el('div', { class: 'row' }, el('span', { class: 'small muted' }, 'about'), phaseSeg, sendButton));
const b1Slider = slider({ label: 'RF field B₁', min: 1, max: 2, log: true, value: 1, title: 'The RF field\'s strength: a weaker one takes longer to turn the spin, τ = θ/γB₁',
  onInput: (v) => { state.B1 = v / inst().B1unit.s; applyEngine(); updatePulseNote(); scheduleHash(); } });
const offsetSlider = slider({ label: 'RF off by', min: -1, max: 1, value: 0, title: 'How far the RF\'s frequency is above the Larmor frequency',
  onInput: (v) => { state.offsetHz = v / inst().offsetUnit.s; applyEngine(); scheduleHash(); dirty(); } });
const pulseNote = el('div', { class: 'note' });
pulsePanel.append(b1Slider, pulseNote, offsetSlider, el('div', { class: 'gloss', id: 'offset-gloss' }, 'Off resonance the pulse turns the spin about a tilted axis, and after it the mixer\'s outputs beat at the difference.'));
function updatePulseNote() {
  const I = inst(), tp = pulseDuration(Math.PI / 2, state.B1), tc = pulseDuration(state.custom.angle * DEG, state.B1);
  setSlots(pulseNote, ['B₁ = ', { v: state.B1 * I.B1unit.s, dec: I.B1unit.dec, w: 6 }, ` ${I.B1unit.u}: a π/2 lasts `, ...timeParts(tp, timeUnit(tp), 2, 6), ', yours ', ...timeParts(tc, timeUnit(tp), 2, 7),
    ' (nutation ', { v: (GAMMA_HZ * state.B1) * (state.inst === 'earth' ? 1 : 1e-3), dec: 1, w: 6 }, state.inst === 'earth' ? ' Hz)' : ' kHz)']);
}

function sendPulse(angle, phase) {
  if (clocks.on && (!run || !run.clocks || eng.done)) leaveClocks();
  if (run) { run.loop = false; if (eng.done) goFree(); }
  if (eng.done) goFree();
  const q = eng.pulseNow(angle, phase, state.B1);
  // (During the three clocks a pulse joins the run, and the fits stop where it starts.)
  if (run && run.clocks && clocks.manual === null) clocks.manual = q.t;
  dirty();
}

// The spins.
const spinsPanel = $('#spins-panel');
const frameSeg = segmented([{ value: 'lab', label: 'Lab frame', title: 'As seen in the laboratory: the spin precesses about B₀' }, { value: 'rot', label: 'Rotating frame', title: 'Turning with the RF at its frequency: the precession is gone, the pulses and the slow changes are left' }],
  state.frame, (v) => { state.frame = v; trail = []; scheduleHash(); dirty(); }, { label: 'Frame' });
const ensembleCheck = el('input', { type: 'checkbox', onchange: () => { state.ensemble = ensembleCheck.checked; applyEngine(); syncEnsemble(); scheduleHash(); dirty(); } });
const spreadSlider = slider({ label: 'spread Δf', min: 1, max: 2, log: true, value: 1, title: 'How far apart the spins\' Larmor frequencies are spread (full width at half height)',
  onInput: (v) => { state.spreadHz = v / inst().spreadUnit.s; applyEngine(); scheduleHash(); dirty(); } });
const arrowsSlider = slider({ label: 'arrows drawn', min: 4, max: 256, step: 1, log: true, value: state.arrows, title: 'How many of the 4096 spins to draw',
  onInput: (v) => { state.arrows = Math.round(v); scheduleHash(); dirty(); } });
const ensembleBox = el('div', { class: 'stack' }, spreadSlider,
  el('div', { class: 'gloss' }, 'The field is not quite the same all through the sample, so the spins\' frequencies differ.'), arrowsSlider);
spinsPanel.append(el('div', { class: 'label' }, 'The spin'), frameSeg,
  el('div', { class: 'row', id: 'equilibrium-row' }, el('button', { type: 'button', title: 'Every spin back along B₀, as after waiting many T₁', onclick: () => { leaveClocks(); goFree(); eng.setVector([0, 0, 1], 'rot'); trail = []; dirty(); } }, 'Back to equilibrium')),
  el('label', { class: 'check' }, ensembleCheck, 'Many spins (an ensemble)'), ensembleBox);
function syncEnsemble() { ensembleCheck.checked = state.ensemble; ensembleBox.hidden = !state.ensemble; }

// Settling: relaxation.
const settlePanel = $('#settle-panel');
function toggledSlider(key, label, gloss, title) {
  const check = el('input', { type: 'checkbox', 'aria-label': `${label} on` });
  const s = slider({ label, min: 1, max: 2, log: true, value: 1, title, onInput: (v) => {
    state[key] = v / 1000; if (!state[`${key}on`]) { state[`${key}on`] = true; check.checked = true; s.classList.remove('off'); }
    if (key === 'T2' && state.T1on && state.T2 > 2 * state.T1) { state.T1 = state.T2 / 2; t1Slider.value = state.T1 * 1000; }
    if (key === 'T1' && state.T2on && state.T2 > 2 * state.T1) { state.T2 = 2 * state.T1; t2Slider.value = state.T2 * 1000; }
    applyEngine(); scheduleHash(); dirty();
  } });
  check.addEventListener('change', () => { state[`${key}on`] = check.checked; s.classList.toggle('off', !check.checked); applyEngine(); scheduleHash(); dirty(); });
  s.check = check;
  return [el('div', { class: 'toggled-slider' }, check, s), el('div', { class: 'gloss' }, gloss)];
}
const [t1Row, t1Gloss] = toggledSlider('T1', 'T₁ (ms)', 'Back to equilibrium: M_z returns to 1 along B₀ (unticked: never).', 'The spin-lattice time: how long the spins take to give their energy to the surroundings');
const [t2Row, t2Gloss] = toggledSlider('T2', 'T₂ (ms)', 'Each spin\'s own loss of step with its neighbours: the part across B₀ fades (unticked: never).', 'The spin-spin time');
const t1Slider = t1Row.querySelector('.slider'), t2Slider = t2Row.querySelector('.slider');
const sampleRow = el('div', { class: 'row' });
settlePanel.append(el('div', { class: 'label' }, 'Settling (relaxation)'), t1Row, t1Gloss, t2Row, t2Gloss, el('div', { class: 'small muted' }, 'Samples:'), sampleRow);
function syncSettle() {
  t1Slider.value = state.T1 * 1000; t2Slider.value = state.T2 * 1000;
  t1Slider.check.checked = state.T1on; t2Slider.check.checked = state.T2on;
  t1Slider.classList.toggle('off', !state.T1on); t2Slider.classList.toggle('off', !state.T2on);
}

// Noise and averaging.
const noisePanel = $('#noise-panel');
const noiseCheck = el('input', { type: 'checkbox', onchange: () => { state.noiseOn = noiseCheck.checked; snrSlider.classList.toggle('off', !state.noiseOn); scheduleHash(); dirty(); } });
const snrSlider = slider({ label: 'signal / noise', min: 1, max: 1000, log: true, value: state.snr, title: 'The full signal (all of M across the field) over the r.m.s. noise of one record',
  onInput: (v) => { state.snr = v; state.noiseOn = true; noiseCheck.checked = true; snrSlider.classList.remove('off'); scheduleHash(); dirty(); } });
const avgSeg = segmented([1, 4, 16, 64, 256].map((n) => ({ value: n, label: String(n) })), 1, (n) => { state.averages = n; applyEngine(); scheduleHash(); dirty(); }, { label: 'Average' });
// (On the board the noise is the receiver's own, set by the coil, the tank and the preamplifier.)
const boardNoiseNote = el('div', { class: 'gloss', id: 'board-noise-note' }, 'On the board the noise is the receiver\'s own: the coil\'s thermal noise, which the tank shapes as it shapes the FID, and the preamplifier\'s, flat across the band (the tank\'s plot shows both).');
noisePanel.append(el('div', { class: 'label' }, 'Noise'), el('label', { class: 'check' }, noiseCheck, 'Thermal noise in the receiver'), snrSlider, boardNoiseNote,
  el('div', { class: 'row' }, el('span', { class: 'small muted' }, 'repeat and average'), avgSeg),
  el('div', { class: 'gloss' }, 'Averaging N repeats keeps the signal and divides the noise by √N.'));
function syncNoise() { noiseCheck.checked = state.noiseOn; snrSlider.value = state.snr; snrSlider.classList.toggle('off', !state.noiseOn); avgSeg.value = state.averages; }

// The clock.
const clockPanel = $('#clock-panel');
const playButton = el('button', { type: 'button', id: 'play', title: 'Stop or start the clock (space)', onclick: () => {
  state.playing = !state.playing; playButton.textContent = state.playing ? 'Pause' : 'Play'; lastT = 0;
  if (typeof boardPause !== 'undefined') boardPause.textContent = playButton.textContent;
} }, 'Pause');
const speedSlider = slider({ label: 'time ×', min: 1e-9, max: 1, log: true, value: state.speed, title: 'Slow motion: seconds of the real thing per second on screen',
  onInput: (v) => { state.speed = v; if (!run) resample(); trail = []; scheduleHash(); dirty(); } });
const restartButton = el('button', { type: 'button', title: 'Run the sequence again from the start', onclick: () => { if (run && run.clocks) startClocks(); else if (run) startRun(run); else { startFree(eng.sum('rot')); } } }, 'Restart');
clockPanel.append(el('div', { class: 'label' }, 'Slow motion'), speedSlider, el('div', { class: 'gloss' }, 'Seconds of the real thing per second on screen.'), el('div', { class: 'row' }, playButton, restartButton));

// More: the magnet, the RF frequency, the samples.
const phaseSlider = slider({ label: 'your pulse\'s phase (°)', min: 0, max: 360, step: 1, value: 0, title: 'The phase of the RF in your pulse: 0° turns the spin about x′, 90° about y′, and any angle between',
  onInput: (v) => { state.custom.phase = v; phaseSeg.value = [0, 90, 180, 270].includes(v) ? v : -1; scheduleHash(); } });
$('#more-box').append(phaseSlider, el('div', { class: 'gloss' }, 'The axis of a pulse is the phase of its RF: x′ is 0°, y′ is 90°.'));
const b0Slider = slider({ label: 'field B₀', min: 1, max: 2, value: 1, title: 'The magnet\'s field: the Larmor frequency is γB₀/2π',
  onInput: (v) => { state.B0 = v / inst().B0unit.s; applyEngine(); trail = []; scheduleHash(); dirty(); } });
$('#more-box').append(b0Slider, el('div', { class: 'gloss' }, 'The Larmor frequency follows the field: f₀ = γB₀/2π, γ/2π = 42.577 MHz/T.'));

function syncSliders() {
  const I = inst();
  b0Slider.setRange(I.B0range[0] * I.B0unit.s, I.B0range[1] * I.B0unit.s); b0Slider.value = +(state.B0 * I.B0unit.s).toPrecision(6);
  b0Slider.querySelector('label').textContent = `field B₀ (${I.B0unit.u})`;
  b1Slider.setRange(I.B1range[0] * I.B1unit.s, I.B1range[1] * I.B1unit.s); b1Slider.value = +(state.B1 * I.B1unit.s).toPrecision(6);
  b1Slider.querySelector('label').textContent = `RF field B₁ (${I.B1unit.u})`;
  offsetSlider.setRange(I.offsetRange[0] * I.offsetUnit.s, I.offsetRange[1] * I.offsetUnit.s); offsetSlider.value = +(state.offsetHz * I.offsetUnit.s).toPrecision(6);
  offsetSlider.querySelector('label').textContent = `RF off by (${I.offsetUnit.u})`;
  spreadSlider.setRange(I.spreadRange[0], I.spreadRange[1]); spreadSlider.value = +(state.spreadHz * I.spreadUnit.s).toPrecision(5);
  spreadSlider.querySelector('label').textContent = `spread Δf (${I.spreadUnit.u})`;
  t1Slider.setRange(I.T1range[0] * 1000, I.T1range[1] * 1000); t2Slider.setRange(I.T2range[0] * 1000, I.T2range[1] * 1000);
  speedSlider.setRange(I.speedRange[0], I.speedRange[1]); speedSlider.value = state.speed;
  angleSlider.value = state.custom.angle; phaseSeg.value = state.custom.phase; phaseSlider.value = state.custom.phase;
  frameSeg.value = state.frame; arrowsSlider.value = state.arrows;
  syncEnsemble(); syncSettle(); syncNoise(); updatePulseNote();
  sampleRow.replaceChildren(...Object.entries(I.samples).map(([id, s]) => el('button', { type: 'button', title: s.title, 'aria-pressed': String(id === state.sample), onclick: () => loadSample(id) }, s.label)));
  instSeg.value = state.inst; viewSeg.value = state.view;
}

function loadSample(id, { on = true } = {}) {
  const s = inst().samples[id];
  state.sample = id; state.T1 = s.T1; state.T2 = s.T2;
  if (on) { state.T1on = true; state.T2on = true; }
  applyEngine(); syncSliders(); scheduleHash(); dirty();
}

/** The instrument's numbers: the field, the RF's strength, the sample, the spread, the clock. */
function loadInstrument(id) {
  state.inst = id;
  const I = inst();
  state.B0 = I.B0; state.B1 = pulseField(Math.PI / 2, I.pi2); state.offsetHz = 0;
  state.spreadHz = I.spread; state.speed = I.speedLab;
  const s = I.samples[I.sample];
  state.sample = I.sample; state.T1 = s.T1; state.T2 = s.T2;
  applyEngine(); syncSliders(); scheduleHash(); dirty();
}

const HINTS = {
  one: 'Drag the arrow\'s tip to tip the spin, or press a pulse button; drag anywhere else on the sphere to turn it',
  many: 'Press a pulse button and watch the spins fan out and the sum shrink; drag the sphere to turn it',
  seq: 'Watch the spins as the sequence runs (the timeline below sets it); drag the sphere to turn it',
  clocks: 'Watch the spins fan out (T₂*), the ring of their tips shrink (T₂) and climb the axis (T₁); drag the sphere to turn it',
  earth: 'Press Polarize and listen; drag the coil\'s end to turn it against the Earth\'s field; slide the switch-off: fast leaves M across the field to ring, slow lets it follow',
};
function setView(v) {
  if (v === 'earth' && state.inst !== 'earth') { loadInstrument('earth'); }
  state.view = v; viewSeg.value = v;
  $('#main').dataset.view = v;
  $('#sphere-hint').textContent = HINTS[v];
  b0Slider.hidden = v === 'earth'; currentSlider.hidden = v !== 'earth';
  phaseSlider.hidden = v === 'earth'; phaseSlider.nextElementSibling.hidden = v === 'earth';
  $('#equilibrium-row').hidden = v === 'earth';
  spreadSlider.hidden = v === 'earth'; spreadSlider.nextElementSibling.hidden = v === 'earth';
  snrSlider.hidden = v === 'earth'; boardNoiseNote.hidden = v !== 'earth';
  // The board's coil is seen from the side, as a solenoid is drawn; the others from the usual corner.
  if (v === 'earth') view.look(1.3, 0.22); else view.look(0.55, 0.32);
  for (const p of $$('#controls [data-views]')) p.hidden = !p.dataset.views.split(' ').includes(v);
  syncClocks();
  scheduleHash(); dirty();
}

/** What each view starts with when its tab is pressed: its first experiment. */
function defaultsFor(v) {
  const first = { one: 'larmor', many: 'spread', seq: 'cpmg', earth: 'board' }[v];
  if (setups[first]) setups[first]({ keepInstrument: true });
}

// Space pauses and plays (not while typing in a box).
document.addEventListener('keydown', (e) => {
  if (e.key !== ' ' || e.target.closest?.('input, textarea, select, button')) return;
  e.preventDefault();
  playButton.click();
});
window.addEventListener('resize', dirty);
document.addEventListener('visibilitychange', () => { lastT = 0; kick(); });
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', dirty);

// ------------------------------------------------------------------ view 3: pulse sequences

const SEQ = {
  teachspin: { tau: { fid: 1e-3, echo: 1.5e-3, ir: 10e-3, cpmg: 2e-3, cp: 2e-3 }, n: 16, tauRange: [5e-5, 0.2] },
  earth: { tau: { fid: 0.1, echo: 0.5, ir: 1, cpmg: 0.15, cp: 0.15 }, n: 12, tauRange: [5e-3, 10] },
};
const seq = { preset: 'cpmg', tau: 2e-3, n: 16, error: 0, pulses: [], span: 1, echoes: [], acq: [0, 1], sel: -1, loop: true, edited: false, scan: null };
const pulseEndT = (q) => q.t + pulseDuration(q.angle * DEG, state.B1) / 2;

/** T2* for laying out a sequence (a stand-in when nothing decays). */
function layoutT2s() {
  const t = T2star(T2eff(), state.ensemble ? state.spreadHz : 0);
  return Number.isFinite(t) ? t : 4 * seq.tau;
}

/** The preset's pulses, span, echoes and acquisition window for the present τ and n. */
function buildSeq() {
  const T2s = layoutT2s(), s = buildSequence(seq.preset, seq.tau, seq.n, T2s);
  seq.pulses = s.pulses.map((p) => ({ ...p }));
  seq.span = s.span; seq.echoes = s.echoes; seq.edited = false; seq.sel = -1;
  const p = seq.pulses;
  if (seq.preset === 'echo') seq.acq = [Math.max(pulseEndT(p[1]), 2 * seq.tau - 3 * T2s), Math.min(s.span, 2 * seq.tau + 3 * T2s)];
  else if (seq.preset === 'cpmg' || seq.preset === 'cp') seq.acq = [pulseEndT(p[0]), s.span];
  else seq.acq = [pulseEndT(p[p.length - 1]), s.span];
  seq.scan = null;
}

/** Run the sequence on the sphere, with the pulse error applied. */
function runSeq() {
  const k = 1 + seq.error;
  startRun({ pulses: seq.pulses.map((q) => ({ ...q, angle: q.angle * k })), span: seq.span, loop: seq.loop, seq: true });
}

function setPreset(name, { tau } = {}) {
  seq.preset = name;
  seq.tau = tau ?? SEQ[state.inst].tau[name];
  seq.n = SEQ[state.inst].n;
  buildSeq();
  state.speed = seq.span / SCREEN; speedSlider.value = state.speed;
  syncSeq(); runSeq(); scheduleHash();
}

// The timeline: pulses as bars (height by angle, colour by axis), the acquisition window as a band.
const tlCanvas = $('#timeline');
let tlFrame = null, tlDrag = null;
function axisColor(phase) { const p = ((phase % 360) + 360) % 360; return p === 90 || p === 270 ? C.my : C.mx; }

function drawTimeline() {
  const { ctx, width, height } = fitCanvas(tlCanvas);
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 48, right: 12, top: 34, bottom: 34 });
  f.x0 = run ? run.t0 : 0; f.x1 = seq.span; f.y0 = 0; f.y1 = 1;
  tlFrame = f;
  const tu = timeUnit(seq.span);
  // The acquisition window.
  const xa = f.X(seq.acq[0]), xb = f.X(seq.acq[1]);
  ctx.fillStyle = C.spec; ctx.globalAlpha = 0.10; ctx.fillRect(xa, f.top, xb - xa, f.h); ctx.globalAlpha = 0.5;
  ctx.fillRect(xa, f.bottom - 8, xb - xa, 8); ctx.globalAlpha = 1;
  ctx.fillStyle = C.spec; ctx.fillRect(xa - 2, f.bottom - 14, 4, 14); ctx.fillRect(xb - 2, f.bottom - 14, 4, 14);
  ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
  ctx.fillText('acquisition (the spectrum)', Math.min(xa + 4, f.right - 130), f.bottom - 10);
  // The echoes expected.
  ctx.strokeStyle = C.ink3; ctx.setLineDash([2, 3]);
  for (const te of seq.echoes) { const x = f.X(te); ctx.beginPath(); ctx.moveTo(x, f.top); ctx.lineTo(x, f.bottom); ctx.stroke(); }
  ctx.setLineDash([]);
  // The pulses.
  ctx.textAlign = 'center';
  let lastLabel = -1e9;
  seq.pulses.forEach((q, i) => {
    const dur = pulseDuration(q.angle * DEG, state.B1), x0 = f.X(q.t - dur / 2), x1 = f.X(q.t + dur / 2);
    const w = Math.max(6, x1 - x0), xm = (x0 + x1) / 2, hgt = f.h * Math.min(1, 0.3 + (0.7 * q.angle) / 180);
    ctx.fillStyle = axisColor(q.phase);
    ctx.fillRect(xm - w / 2, f.bottom - hgt, w, hgt);
    if (i === seq.sel) { ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.strokeRect(xm - w / 2 - 2, f.bottom - hgt - 2, w + 4, hgt + 4); ctx.lineWidth = 1; }
    const name = pulseName(q.angle, q.phase), wl = ctx.measureText(name).width;
    if (xm - lastLabel > wl + 4 || i === seq.sel) { ctx.fillStyle = C.ink2; ctx.fillText(name, xm, f.bottom - hgt - 3); lastLabel = xm; }
  });
  if (run && eng.t >= f.x0 && eng.t <= f.x1) {
    ctx.strokeStyle = C.m; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(f.X(eng.t), f.top - 4); ctx.lineTo(f.X(eng.t), f.bottom); ctx.stroke(); ctx.lineWidth = 1;
  }
  const g = new Frame(ctx, width, height, { left: 48, right: 12, top: 34, bottom: 34 });
  g.x0 = f.x0 * tu.s; g.x1 = f.x1 * tu.s; g.y0 = 0; g.y1 = 1;
  g.axes({ xlabel: `time (${tu.u}): drag a pulse, or the ends of the acquisition band`, yTicks: false, colors: C });
  ctx.fillStyle = C.ink; ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  ctx.fillText(`The sequence: ${PRESETS[seq.preset].label}${seq.edited ? ' (edited)' : ''}`, f.right, 3);
}

function tlHit(x, y) {
  const f = tlFrame;
  if (!f) return null;
  let best = null, bd = 9;
  seq.pulses.forEach((q, i) => { const d = Math.abs(f.X(q.t) - x) - (i === seq.sel ? 2 : 0); if (d < bd && y > f.top - 16 && y < f.bottom + 2) { bd = d; best = { kind: 'pulse', i }; } });
  if (best) return best;
  if (Math.abs(f.X(seq.acq[0]) - x) < 7) return { kind: 'acqA' };
  if (Math.abs(f.X(seq.acq[1]) - x) < 7) return { kind: 'acqB' };
  if (x > f.X(seq.acq[0]) && x < f.X(seq.acq[1]) && y > f.bottom - 16 && y < f.bottom + 4) return { kind: 'acq', t: f.invX(x) };
  return null;
}
tlCanvas.addEventListener('pointerdown', (e) => {
  const r = tlCanvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, h = tlHit(x, y);
  if (!h) { seq.sel = -1; syncSeq(); dirty(); return; }
  tlCanvas.setPointerCapture(e.pointerId);
  tlDrag = { ...h, moved: false };
  if (h.kind === 'pulse') { seq.sel = h.i; syncSeq(); }
  dirty();
});
tlCanvas.addEventListener('pointermove', (e) => {
  const r = tlCanvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if (!tlDrag) { const h = tlHit(x, y); tlCanvas.style.cursor = h ? (h.kind === 'pulse' || h.kind === 'acq' ? 'ew-resize' : 'col-resize') : 'default'; return; }
  const f = tlFrame, t = Math.max(0, Math.min(seq.span, f.invX(x)));
  tlDrag.moved = true;
  if (tlDrag.kind === 'pulse') { seq.pulses[tlDrag.i].t = t; seq.edited = true; seq.scan = null; }
  else if (tlDrag.kind === 'acqA') seq.acq[0] = Math.min(t, seq.acq[1] - seq.span / 200);
  else if (tlDrag.kind === 'acqB') seq.acq[1] = Math.max(t, seq.acq[0] + seq.span / 200);
  else { const d = t - tlDrag.t, w = seq.acq[1] - seq.acq[0]; let a = Math.max(0, Math.min(seq.span - w, seq.acq[0] + d)); seq.acq = [a, a + w]; tlDrag.t = t; }
  syncSeq(); dirty();
});
const tlEnd = () => {
  if (tlDrag && tlDrag.kind === 'pulse' && tlDrag.moved) {
    const q = seq.pulses[tlDrag.i];
    seq.pulses.sort((a, b) => a.t - b.t); seq.sel = seq.pulses.indexOf(q);
    runSeq();
  }
  tlDrag = null; scheduleHash();
};
tlCanvas.addEventListener('pointerup', tlEnd);
tlCanvas.addEventListener('pointercancel', tlEnd);

// The sequence's panel.
const seqPanel = $('#seq-panel');
const presetButtons = {};
const presetGrid = el('div', { class: 'button-grid' });
for (const [id, P] of Object.entries(PRESETS)) {
  presetButtons[id] = el('button', { type: 'button', title: P.title, 'aria-pressed': 'false', onclick: () => setPreset(id) }, P.label);
  presetGrid.append(presetButtons[id]);
}
const tauSlider = slider({ label: 'delay τ', min: 1, max: 2, log: true, value: 1, title: 'The spacing of the pulses',
  onInput: (v) => { seq.tau = v / timeUnit(SEQ[state.inst].tauRange[1]).s; buildSeq(); state.speed = seq.span / SCREEN; speedSlider.value = state.speed; syncSeq(); runSeq(); scheduleHash(); } });
const nSlider = slider({ label: 'π pulses', min: 1, max: 40, step: 1, value: 16, title: 'How many π pulses in the train (how many echoes)',
  onInput: (v) => { seq.n = Math.round(v); buildSeq(); state.speed = seq.span / SCREEN; speedSlider.value = state.speed; syncSeq(); runSeq(); scheduleHash(); } });
const errorSlider = slider({ label: 'pulses off by (%)', min: -25, max: 25, step: 1, value: 0, title: 'Every pulse turns the spins this much too far (or too little): a miscalibrated pulse width or B₁',
  onInput: (v) => { seq.error = v / 100; seq.scan = null; runSeq(); scheduleHash(); } });
const selBox = el('div', { class: 'stack' });
const selNote = el('div', { class: 'note' });
const selAngle = slider({ label: 'its angle (°)', min: 0, max: 360, step: 1, value: 90, onInput: (v) => { const q = seq.pulses[seq.sel]; if (!q) return; q.angle = v; seq.edited = true; seq.scan = null; runSeq(); syncSeq(); } });
const selAxis = segmented([{ value: 0, label: 'x′' }, { value: 90, label: 'y′' }, { value: 180, label: '−x′' }, { value: 270, label: '−y′' }], 0, (v) => { const q = seq.pulses[seq.sel]; if (!q) return; q.phase = v; seq.edited = true; seq.scan = null; runSeq(); syncSeq(); }, { label: 'Its axis' });
const selDelete = el('button', { type: 'button', onclick: () => { if (seq.sel < 0) return; seq.pulses.splice(seq.sel, 1); seq.sel = -1; seq.edited = true; seq.scan = null; runSeq(); syncSeq(); } }, 'Delete it');
selBox.append(selNote, selAngle, el('div', { class: 'row' }, el('span', { class: 'small muted' }, 'about'), selAxis, selDelete));
const addButton = el('button', { type: 'button', title: 'A π pulse about y′ halfway along, to drag where you want it', onclick: () => {
  seq.pulses.push({ t: seq.span / 2, angle: 180, phase: 90 }); seq.pulses.sort((a, b) => a.t - b.t);
  seq.sel = seq.pulses.findIndex((q) => q.t === seq.span / 2); seq.edited = true; seq.scan = null; runSeq(); syncSeq();
} }, 'Add a pulse');
const loopButton = el('button', { type: 'button', 'aria-pressed': 'true', title: 'Run the sequence again and again, each time from equilibrium (as the instrument does, waiting many T₁ between runs)',
  onclick: () => { seq.loop = !seq.loop; loopButton.setAttribute('aria-pressed', String(seq.loop)); if (run) run.loop = seq.loop; } }, 'Repeat');
const runButton = el('button', { type: 'button', class: 'primary', onclick: () => runSeq() }, 'Run it');
const scanButton = el('button', { type: 'button', title: 'Run the sequence for many delays τ and plot what it measures against τ', onclick: () => startScan() }, 'Scan τ');
const seqResult = el('div', { class: 'note', id: 'seq-result' });
seqPanel.append(el('div', { class: 'label' }, 'The sequence'), presetGrid, tauSlider, nSlider, errorSlider,
  el('div', { class: 'gloss' }, 'A pulse error is a π pulse that is really, say, 170°: the TeachSpin\'s widths are set by hand.'),
  el('div', { class: 'row' }, runButton, loopButton, scanButton, addButton), selBox, seqResult);

function syncSeq() {
  for (const [id, b] of Object.entries(presetButtons)) b.setAttribute('aria-pressed', String(id === seq.preset && !seq.edited));
  const R = SEQ[state.inst].tauRange, tu = timeUnit(R[1]);
  tauSlider.setRange(R[0] * tu.s, R[1] * tu.s); tauSlider.value = +(seq.tau * tu.s).toPrecision(5);
  tauSlider.querySelector('label').textContent = `delay τ (${tu.u})`;
  nSlider.value = seq.n; nSlider.hidden = !(seq.preset === 'cpmg' || seq.preset === 'cp');
  errorSlider.value = Math.round(seq.error * 100);
  scanButton.hidden = !(seq.preset === 'ir' || seq.preset === 'echo');
  const q = seq.pulses[seq.sel];
  selBox.hidden = !q;
  if (q) { const tu2 = timeUnit(seq.span); setSlots(selNote, ['Chosen: ', { text: pulseName(q.angle, q.phase), w: 7 }, ' at ', { v: q.t * tu2.s, dec: 3, w: 7 }, ` ${tu2.u}`]); selAngle.value = q.angle; selAxis.value = q.phase; }
  loopButton.setAttribute('aria-pressed', String(seq.loop));
}

// Scanning τ: one run per frame, silently, the points added to the plot as they come.
function batchParams() {
  return { B0: state.B0, B1: state.B1, offsetHz: state.offsetHz, T1: T1eff(), T2: T2eff(), N: state.ensemble ? NSIG : 1, spreadHz: state.ensemble ? state.spreadHz : 0, averages: state.averages };
}
function startScan() {
  const kind = seq.preset, T2s = layoutT2s();
  let taus;
  if (kind === 'ir') {
    const T = Number.isFinite(T1eff()) ? T1eff() : 10 * seq.tau;
    taus = Array.from({ length: 15 }, (_, i) => 0.04 * T * (100 ** (i / 14)));
  } else {
    const T = Number.isFinite(T2eff()) ? T2eff() : 20 * T2s, lo = Math.max(2 * T2s, 0.03 * T);
    taus = Array.from({ length: 12 }, (_, i) => lo + ((1.2 * T - lo) * i) / 11);
  }
  seq.scan = { kind, taus, x: [], y: [], fit: null, params: batchParams(), sigma: sigma(), seed: 101 };
  dirty();
}
function scanStep() {
  const S = seq.scan;
  if (!S || S.x.length >= S.taus.length) return;
  const tau = S.taus[S.x.length], k = 1 + seq.error, P = S.params, T2s = layoutT2s();
  const pulses = buildSequence(S.kind, tau, 1, T2s).pulses.map((q) => ({ ...q, angle: q.angle * k }));
  if (S.kind === 'ir') {
    const t0 = pulseEndT(pulses[1]), w = Math.min(0.05 * T2s, 0.1 * tau), e = runSequence(P, pulses, t0 + w, w / 20, S.seed++, [[t0, t0 + w]]);
    S.x.push(tau); S.y.push(e.record.meanY(t0, t0 + w, S.sigma));
  } else {
    const w = Math.min(T2s, tau / 2), e = runSequence(P, pulses, 2 * tau + w, w / 40, S.seed++, [[2 * tau - w, 2 * tau + w]]);
    S.x.push(2 * tau); S.y.push(e.record.envelopeMax(2 * tau - w, 2 * tau + w, S.sigma).max);
  }
  if (S.x.length >= 3) {
    const fit = fitShape(S.x, S.y, S.kind === 'ir' ? 'recovery' : 'decay');
    S.fit = { A: fit.A, tau: fit.tau, null: fit.tau * Math.LN2 };
  }
}

/** The echoes so far in this run's record, and their fit A e^{−t/T2}. */
function trainEchoes() {
  if (!(seq.preset === 'cpmg' || seq.preset === 'cp') || !run) return null;
  const done = seq.echoes.filter((t) => t < eng.t - seq.tau / 4);
  if (!done.length) return { t: [], amp: [], fit: null };
  return echoAmplitudes(eng.record, done, Math.min(seq.tau / 2, layoutT2s()), sigma());
}

/** The FID's envelope in the acquisition window, and its fit A e^{−(t − t0)/T2*}. */
function fidFit() {
  const [a, b0] = seq.acq, b = Math.min(b0, eng.t);
  if (b - a < (seq.acq[1] - seq.acq[0]) * 0.3) return null;
  // The mixer's output in phase with the FID's start: unlike the envelope it averages noise to
  // zero (the envelope of noise alone is σ√(π/2) on average, which would lengthen the fit).
  const m0 = eng.record.at(a, 0), ph = Math.atan2(m0[1], m0[0]), ux = Math.cos(ph), uy = Math.sin(ph);
  const t = [], y = [], tmp = [0, 0, 0], sg = sigma();
  for (let k = 0; k < 200; k++) { const tk = a + ((b - a) * k) / 199, m = eng.record.at(tk, sg, tmp); t.push(tk - a); y.push(m[0] * ux + m[1] * uy); }
  const f = fitShape(t, y, 'decay');
  return { t0: a, A: f.A, tau: f.tau, t, y };
}

function drawSeqCurve() {
  const { ctx, width, height } = fitCanvas($('#curve'));
  ctx.clearRect(0, 0, width, height);
  const S = seq.scan;
  if (seq.preset === 'ir' || seq.preset === 'echo') {
    const ir = seq.preset === 'ir';
    const xmax = S ? S.taus[S.taus.length - 1] * (ir ? 1.05 : 2.1) : (ir ? 4 : 2.4) * (Number.isFinite(ir ? T1eff() : T2eff()) ? (ir ? T1eff() : T2eff()) : seq.tau);
    const xu = timeUnit(xmax);
    const fit = S && S.fit ? (ir ? (x) => S.fit.A * (1 - 2 * Math.exp(-x / S.fit.tau)) : (x) => S.fit.A * Math.exp(-x / S.fit.tau)) : null;
    const tq = (v) => [{ v: v * xu.s, dec: 2, w: 6 }, ` ${xu.u}`];
    curveFrame = drawCurve(ctx, width, height, {
      x: S ? S.x : [], y: S ? S.y : [], fit, xmax, ymin: ir ? -1.1 : 0, ymax: 1.1, colors: C, xunit: xu,
      title: ir ? 'The FID\'s start against τ: click to run at a τ' : 'The echo\'s height against 2τ: click to run there',
      xlabel: ir ? `delay τ (${xu.u})` : `time of the echo, 2τ (${xu.u})`,
      current: ir ? seq.tau : 2 * seq.tau,
      marks: S && S.fit && ir ? [{ x: S.fit.null, label: 'null: T₁ ln 2' }] : [],
      note: S && S.fit ? (ir ? ['fit: T₁ = ', ...canvasTime(S.fit.tau)] : ['fit: T₂ = ', ...canvasTime(S.fit.tau)]) : (S ? null : ['press Scan τ']),
    });
    return;
  }
  if (seq.preset === 'cpmg' || seq.preset === 'cp') {
    const tr = trainEchoes(), xmax = seq.span, xu = timeUnit(xmax);
    const fit = tr && tr.fit ? (x) => tr.fit.A * Math.exp(-x / tr.fit.T2) : null;
    drawCurve(ctx, width, height, {
      x: tr ? tr.t : [], y: tr ? tr.amp : [], fit, xmax, ymin: 0, ymax: 1.1, colors: C, xunit: xu,
      title: 'The echoes\' heights', xlabel: `time (${xu.u})`,
      note: tr && tr.fit ? ['fit: T₂ = ', ...canvasTime(tr.fit.T2)] : null,
    });
    return;
  }
  // The FID: its envelope and the fit.
  const ff = fidFit(), xmax = seq.acq[1] - seq.acq[0], xu = timeUnit(xmax);
  drawCurve(ctx, width, height, {
    x: ff ? ff.t : [], y: ff ? ff.y : [], fit: ff ? (x) => ff.A * Math.exp(-x / ff.tau) : null, xmax, ymin: 0, ymax: 1.1, colors: C, xunit: xu,
    title: 'The FID (the mixer in phase with its start)', xlabel: `time after the window opens (${xu.u})`,
    note: ff ? ['fit: T₂* = ', ...canvasTime(ff.tau)] : null,
  });
}

// Clicking the plot of a scan runs the sequence at the delay clicked: the spins at the null, say.
let curveFrame = null;
$('#curve').addEventListener('pointerdown', (e) => {
  if (state.view !== 'seq' || !(seq.preset === 'ir' || seq.preset === 'echo') || !curveFrame) return;
  const r = $('#curve').getBoundingClientRect(), x = curveFrame.invX(e.clientX - r.left);
  if (!(x > 0)) return;
  const tau = seq.preset === 'ir' ? x : x / 2, R = SEQ[state.inst].tauRange;
  seq.tau = Math.max(R[0], Math.min(R[1], tau));
  const scan = seq.scan;
  buildSeq(); seq.scan = scan;
  state.speed = seq.span / SCREEN; speedSlider.value = state.speed;
  syncSeq(); runSeq(); scheduleHash();
});

function seqReadout(lines) {
  const S = seq.scan, tu = (t) => time3(t), dash = [{ text: '–', w: 6, class: 'b' }, ''];
  const t2s = T2star(T2eff(), state.ensemble ? state.spreadHz : 0);
  if (seq.preset === 'ir') {
    lines.push(S && S.fit
      ? [`T₁ from the fit to ${S.x.length} delays:`, [...tu(S.fit.tau)], '· the null at', ['τ = ', ...tu(S.fit.null)], '= T₁ ln 2 · set:', ['T₁ = ', ...tu(T1eff())]]
      : ['Inversion recovery: π flips M to −z; it climbs back with T₁; the π/2 at τ reads how far it got.  Press Scan τ to measure T₁.']);
  } else if (seq.preset === 'echo') {
    lines.push(S && S.fit
      ? [`T₂ from ${S.x.length} echoes:`, [...tu(S.fit.tau)], '· set:', ['T₂ = ', ...tu(T2eff())], '· the FID decays with', ['T₂* = ', ...tu(t2s)]]
      : ['The echo at', ['2τ = ', ...tu(2 * seq.tau)], '·', ['e^(−2τ/T₂) = ', { v: Math.exp(-2 * seq.tau / T2eff()), dec: 3, w: 5, class: 'b' }], '· Scan τ to measure T₂']);
  } else if (seq.preset === 'cpmg' || seq.preset === 'cp') {
    const tr = trainEchoes();
    lines.push([[{ v: tr ? tr.t.length : 0, dec: 0, w: 2, class: 'b' }, ' echoes'], 'so far · fit', ['T₂ = ', ...(tr && tr.fit ? tu(tr.fit.T2) : dash)], '· set:', ['T₂ = ', ...tu(T2eff())]]);
  } else {
    const ff = fidFit();
    lines.push(['The FID\'s envelope: fit', ['T₂* = ', ...(ff ? tu(ff.tau) : dash)], '· 1/T₂* = 1/T₂ + πΔf gives', [...tu(t2s)]]);
  }
}

// -------------------------------------------------------------- view 4: the Earth's-field board

// The board's numbers (sim/design.json of github.com/gallicchio/earth-nmr-pcb): 5.225 mT per amp
// at the middle of the coil, 1.5 A, and an EMF of 1.199 μV from a litre of water fully polarized
// at 1.5 A precessing at 1959.8 Hz; the relay hands the coil to the receiver 19 ms after the
// switch-off; the tank (receiver.js) is tuned by switches 1 2 4 7 (code 75); the field in
// Claremont dips 58.89° below the horizontal (so a coil laid north–south is at 58.89° to it).
const BOARD = { BpPerA: 5.2249e-3, emf: 1.199e-6, emfI: 1.5, emfB: 46.028e-6, tOpen: 0.019, snr: 285, claremont: 46.03e-6, code: 75, dip: 58.89 };
const board = { tp: 3, ramp: 0.4e-3, tl: 2, I: 1.5, BE: BOARD.claremont, gradNT: 5, angle: 90, code: BOARD.code, speedMode: 'auto', loop: true, points: [], scan: null, listen: 0, afterRamp: null };
const Bp = () => BOARD.BpPerA * board.I;
const sinA = () => Math.max(1e-6, Math.sin(board.angle * DEG));
/** The EMF in the coil of the full polarization precessing across the Earth's field, per unit of
 *  the record's M: ∝ the current (M), the field (ω), and sin α (what the coil picks up of it). */
const Vfull = () => BOARD.emf * (board.I / BOARD.emfI) * (board.BE / BOARD.emfB) * sinA();
const tOpenAbs = () => board.tp + board.ramp + BOARD.tOpen;

// The receiver: the tank's capacitance and response at the protons' frequency, the gain to OUT,
// the noise.  (The tank changes only what the receiver makes of the FID, not the spins: it acts
// on the record as it is drawn, so retuning shows at once, without a new cycle.)
const tankC = () => bankC(board.code);
const fLarmor = () => GAMMA_HZ * board.BE;
const tankNow = () => tankH(fLarmor(), tankC());
/** Volts at OUT (on HIGH) per unit of the record's transverse M. */
const outPerM = () => Vfull() * tankNow().mag * RECEIVER.gain.high * filterH(fLarmor()).mag;
/** The scale of the plots at OUT: the FID of the full polarization with the tank tuned exactly
 *  and the coil square to the field. */
const outRef = () => BOARD.emf * (board.I / BOARD.emfI) * (board.BE / BOARD.emfB) * quality(fLarmor()) * RECEIVER.gain.high * filterH(fLarmor()).mag;
let noiseCache = { code: -1 };
/** The receiver's noise for the switches now: r.m.s. at the tank over its whole band. */
function rxNoise() { if (noiseCache.code !== board.code) noiseCache = { code: board.code, ...receiverNoise(tankC()) }; return noiseCache; }
/** The board's noise in the record's units: on a scope trace, the receiver's whole band
 *  (r.m.s. at OUT over the FID's size at OUT)... */
function sigmaBand() { return state.noiseOn ? (rxNoise().total * RECEIVER.gain.high) / outPerM() : 0; }
/** ...and for what is read in a narrow band at the protons' frequency (the spectrum, the FID's
 *  start), the density there over the record's bandwidth 1/dt. */
function sigmaAt(dt = eng.dtSample) {
  return state.noiseOn ? noiseDensity(fLarmor(), tankC()).total / (Math.sqrt(dt) * Vfull() * tankNow().mag) : 0;
}

function boardParams() {
  return { B0: board.BE, B1: state.B1, offsetHz: 0, T1: T1eff(), T2: T2eff(), N: state.ensemble ? NSIG : 1, spreadHz: state.ensemble ? state.spreadHz : 0, averages: state.averages };
}
/** The cycle's settings for the engine. */
const earthCycle = (o = {}) => ({ Bp: Bp(), BE: board.BE, tp: board.tp, ramp: board.ramp, tl: board.tl, tOpen: BOARD.tOpen, angle: board.angle * DEG, ...o });

/** Start the board's cycle: polarize, switch off, listen. */
function startBoard() {
  state.B0 = board.BE; state.offsetHz = 0;
  applyEngine();
  eng.setSampling(board.tl / SAMPLES_PER_WINDOW);
  reseed();
  eng.startEarth(earthCycle());
  run = { earth: true, t0: 0, span: eng.tEnd, loop: board.loop, pulses: [] }; runId++;
  board.listen = 0; board.afterRamp = null; board.recorded = false; pauseLeft = 0;
  trail = [];
  dirty();
}

/**
 * The page's speed in the board's cycle: real time while it polarizes; through the switch-off,
 * slow enough that the total field's direction turns evenly on screen, its swing from the coil's
 * axis to B_E taking 2 s (it turns only at the end of the ramp: dα/dt = (Bp/B_E τ)/(1 + u²), with
 * u = Bp s/B_E), and the rest of the ramp at least 0.6 s; then the first turns of the precession
 * at 10⁻³, speeding up to real time.
 */
function boardSpeed() {
  if (board.speedMode === 'real') return 1;
  if (board.speedMode === 'slow') return 1e-3;
  const e = eng.earth;
  if (!e) return 1;
  if (eng.t < e.tp) return 1;
  if (eng.t < e.tp + e.ramp) {
    const s = 1 - (eng.t - e.tp) / e.ramp, u = (Bp() * s) / board.BE;
    const even = ((Math.PI / 2) / 2) * (board.BE * e.ramp * (1 + u * u)) / Bp();
    return Math.max(1e-10, Math.min(e.ramp / 0.6, even));
  }
  return Math.min(1, 1e-3 * 10 ** (Math.max(0, board.listen - 1.5) / 0.6));
}

function tickBoard(dt) {
  let left = dt;
  for (let k = 0; k < 24 && left > 1e-6 && !eng.done; k++) {
    const e = eng.earth, sp = boardSpeed(), inRamp = eng.t >= e.tp && eng.t < e.tp + e.ramp;
    const bound = eng.t < e.tp ? e.tp : eng.t < e.tp + e.ramp ? e.tp + e.ramp : eng.tEnd;
    // (Through the switch-off the speed changes as the field turns: a frame in small pieces.)
    const sim = Math.min((inRamp ? Math.min(left, dt / 16) : left) * sp, bound - eng.t);
    const listening = eng.t >= e.tp + e.ramp;
    eng.advance(sim, BUDGET);
    if (listening) board.listen += sim / sp;
    left -= sim / sp;
    if (!board.afterRamp && eng.t >= e.tp + e.ramp) {
      const m = eng.sum('lab'), r = Math.hypot(...m) || 1;
      board.afterRamp = { across: Math.hypot(m[0], m[1]) / r, size: r };
    }
  }
  if (turnsPerFrame() <= 0.12) { trail.push(eng.sum(state.frame)); if (trail.length > 90) trail.shift(); } else trail = [];
  if (eng.done && !board.recorded) { board.recorded = true; recordPoint(); }
}

/** The FID's start, read from this cycle's record (the envelope's mean over its first 50 ms). */
function fidStart(record = eng.record, sg = sigmaAt()) {
  const t0 = tOpenAbs();
  return record.meanEnvelope(t0, t0 + 0.05, sg);
}

function recordPoint() {
  const a = fidStart();
  board.points.push({ tp: board.tp, amp: a });
  if (board.points.length > 40) board.points.shift();
  fitPoints();
}
function fitPoints() {
  const P = board.scan ? board.scan.points : board.points;
  const tps = new Set(P.map((p) => p.tp));
  board.fit = tps.size >= 3 ? (() => { const f = fitShape(P.map((p) => p.tp), P.map((p) => p.amp), 'rise'); return { A: f.A, T1: f.tau }; })() : null;
}

/** Measure T1: one silent cycle a frame, polarizing from 0.2 to 4.7 s. */
function startBoardScan() {
  board.scan = { tps: [0.2, 0.35, 0.5, 0.75, 1, 1.4, 1.8, 2.3, 2.9, 3.5, 4.1, 4.7], points: [], seed: 300 };
  board.fit = null; dirty();
}
function boardScanStep() {
  const S = board.scan;
  if (!S || S.points.length >= S.tps.length) return;
  const tp = S.tps[S.points.length], e = new Engine(boardParams());
  e.noiseSeed = S.seed++;
  e.setSampling(Infinity);
  e.startEarth(earthCycle({ tp, tl: BOARD.tOpen + 0.05 }));
  const t0 = tp + board.ramp + BOARD.tOpen;
  e.advance(t0 - e.t); e.setSampling(0.05 / 30); e.advance(e.tEnd - e.t);
  S.points.push({ tp, amp: e.record.meanEnvelope(t0, t0 + 0.05, sigmaAt(0.05 / 30)) });
  fitPoints();
}

/** The cycle as a strip: the polarizing current, M along the coil, the receiver, the FID. */
function drawBoardStrip() {
  const { ctx, width, height } = fitCanvas($('#board'));
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 48, right: 12, top: 22, bottom: 34 });
  const T = board.tp + board.ramp + board.tl;
  f.x0 = 0; f.x1 = T; f.y0 = 0; f.y1 = 1.15;
  const e = eng.earth, xs = f.X(board.tp), xo = f.X(tOpenAbs());
  ctx.save(); f.clip();
  ctx.fillStyle = C.coil; ctx.globalAlpha = 0.14; ctx.fillRect(f.left, f.top, xs - f.left, f.h); ctx.globalAlpha = 1;
  ctx.fillStyle = C.spec; ctx.globalAlpha = 0.10; ctx.fillRect(xo, f.top, f.right - xo, f.h); ctx.globalAlpha = 1;
  // The current, and M along the coil as it builds: 1 − e^{−t/T1}.
  ctx.strokeStyle = C.coil; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(f.left, f.Y(1)); ctx.lineTo(xs, f.Y(1)); ctx.lineTo(xs, f.Y(0)); ctx.lineTo(f.right, f.Y(0)); ctx.stroke();
  ctx.strokeStyle = C.m; ctx.setLineDash([5, 3]); ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let k = 0; k <= 100; k++) { const t = (board.tp * k) / 100, y = f.Y(polarizedAt(t)); if (k) ctx.lineTo(f.X(t), y); else ctx.moveTo(f.X(t), y); }
  ctx.stroke(); ctx.setLineDash([]);
  // The FID's envelope from the record.
  const R = eng.record;
  if (R.length > 1 && eng.t > tOpenAbs()) {
    ctx.strokeStyle = C.mxy; ctx.lineWidth = 1.6; ctx.beginPath();
    const tmp = [0, 0, 0], a = tOpenAbs(), b = eng.t;
    for (let k = 0; k <= 200; k++) { const t = a + ((b - a) * k) / 200, m = R.at(t, 0, tmp), y = f.Y(Math.hypot(m[0], m[1])); if (k) ctx.lineTo(f.X(t), y); else ctx.moveTo(f.X(t), y); }
    ctx.stroke();
  }
  if (e) { ctx.strokeStyle = C.m; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(f.X(eng.t), f.top); ctx.lineTo(f.X(eng.t), f.bottom); ctx.stroke(); }
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = C.ink2; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ctx.fillText(`polarize ${board.tp.toFixed(1)} s at ${board.I.toFixed(1)} A`, f.left + 4, f.Y(1) + 3);
  ctx.textAlign = 'left';
  { // (On a narrow strip, the short form, where it fits after the switch-off.)
    const long = `switch off in ${duration(board.ramp)}; the receiver opens 19 ms later and listens ${board.tl.toFixed(1)} s`, short = `off in ${duration(board.ramp)}, listen ${board.tl.toFixed(1)} s`;
    const text = ctx.measureText(long).width < f.right - xs - 10 || f.w > 700 ? long : short;
    ctx.fillText(text, Math.max(f.left + 4, Math.min(xs + 6, f.right - ctx.measureText(text).width - 4)), f.top + 2);
  }
  ctx.restore();
  const g = new Frame(ctx, width, height, { left: 48, right: 12, top: 22, bottom: 34 });
  g.x0 = 0; g.x1 = T; g.y0 = 0; g.y1 = 1.15;
  g.axes({ xlabel: 'time (s)', colors: C, yTicks: false });
  legend(ctx, f.left + 6, 4, [{ text: 'The board\'s cycle', color: C.ink, bold: true }, { text: 'the polarizing current', color: C.coil }, { text: 'M along the coil', color: C.m }, { text: 'the FID\'s envelope', color: C.mxy }], C, width - 70);
}
function polarizedAt(t) {
  const T1 = T1eff(), n = coilAxis(board.angle * DEG), bz = board.BE + Bp() * n[2], m0 = (board.BE * bz) / ((Bp() * n[0]) ** 2 + bz * bz);
  return Number.isFinite(T1) ? 1 - (1 - m0) * Math.exp(-t / T1) : m0;
}

/** OUT, as the receiver makes it, at 48 kHz from t0 for n samples: the FID from the record (its
 *  EMF), the tank's and the filters' gain and phase, the receiver's noise. */
function outSamples(record, omegaRef, t0, n, fs = 48000, seed = eng.noiseSeed) {
  const V = Vfull(), tmp = [0, 0, 0], open = tOpenAbs();
  return synthOut({
    fs, t0, n, fL: omegaRef / (2 * Math.PI), C: tankC(), seed, averages: state.averages, noise: state.noiseOn,
    emf: (t, m) => { if (t < open) { m[0] = m[1] = 0; return; } const r = record.at(t, 0, tmp); m[0] = V * r[0]; m[1] = V * r[1]; },
  });
}

/** A round number at or above x: 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10ⁿ. */
function niceUp(x) {
  const e = 10 ** Math.floor(Math.log10(x));
  return e * [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => m * e >= x * (1 - 1e-9));
}

let zoomKept = { key: null, y: null };
function drawBoardPlots() {
  drawBoardStrip();
  drawTankPlot();
  const a = board.tp + board.ramp, b = board.tp + board.ramp + board.tl, V = Vfull() * 1e6, Vo = niceUp(1.1 * outRef()) / 1.1;
  {
    const { ctx, width, height } = fitCanvas($('#signal'));
    ctx.clearRect(0, 0, width, height);
    drawRaw(ctx, width, height, { record: eng.record, omegaRef: eng.omegaRef, t0: a, t1: b, ymax: 1.1 * Vo, scale: outPerM(), sigma: sigmaBand(), colors: C,
      title: 'The FID at OUT (V): what the scope and the headphones get', zoomNote: 'thousands of cycles: the band is the oscillation (zoom below)' });
  }
  {
    const { ctx, width, height } = fitCanvas($('#zoom'));
    ctx.clearRect(0, 0, width, height);
    // A scope's sweep of 10 ms: the newest 10 ms while the FID comes in, its first 10 ms after.
    const open = tOpenAbs(), live = run && !eng.done && eng.t > open + 0.01;
    const z1 = live ? eng.t : open + 0.01, z0 = z1 - 0.01;
    // (Once the sweep stands still, OUT's samples and their picture are kept until anything they
    // depend on changes: the record, the switches, the noise, the coil's EMF, the receiver's opening.)
    const zkey = live ? null : `nmr out ${eng.record.id} ${eng.record.version} ${eng.omegaRef} ${z0} ${board.code} ${state.noiseOn} ${state.averages} ${eng.noiseSeed} ${Vfull()} ${open}`;
    if (!zkey || zoomKept.key !== zkey) zoomKept = { key: zkey, y: outSamples(eng.record, eng.omegaRef, z0, 480) };
    const y = zoomKept.y;
    drawTrace(ctx, width, height, { t0: z0, t1: z1, y, ymax: 1.1 * Vo, colors: C, key: zkey,
      title: eng.t < open ? '10 ms of OUT: the receiver opens 19 ms after the switch-off' : live ? 'The last 10 ms at OUT (V): the oscillation itself' : 'Its first 10 ms at OUT (V)' });
  }
  {
    const { ctx, width, height } = fitCanvas($('#spec'));
    ctx.clearRect(0, 0, width, height);
    const sg = sigmaAt(), t0 = tOpenAbs(), t1 = Math.min(b, eng.t), f0 = eng.f0;
    const line = 1 / (Math.PI * T2star(T2eff(), state.ensemble ? state.spreadHz : 0)), span = Math.max(2, 4 * (Number.isFinite(line) ? line : 0));
    let spec = null;
    if (t1 - t0 > 0.1) {
      const key = `b|${t0}|${eng.record.length}|${sg}|${span}`, same = specCache.run === `b${runId}|${sg}|${span}`;
      const grown = eng.record.length > 1.05 * (specCache.n || 0) + 8;
      if (specCache.key !== key && (!same || grown || specCache.frame++ % 6 === 0)) specCache = { key, run: `b${runId}|${sg}|${span}`, spec: specOf(t0, t1, span, sg), frame: 1, n: eng.record.length };
      spec = specCache.spec;
    }
    board.spec = spec;
    drawSpectrum(ctx, width, height, { spec, f0, fmin: -span, fmax: span, unit: { s: 1, u: 'Hz' }, colors: C, mark: true,
      title: 'Its spectrum', xlabel: 'frequency (Hz)',
      note: spec ? ['peak at ', { v: f0 + spec.peak.f, dec: 2, w: 7 }, ' Hz: B = ', { v: (f0 + spec.peak.f) / GAMMA_HZ * 1e9, dec: 1, w: 7 }, ' nT'] : null });
  }
  {
    const { ctx, width, height } = fitCanvas($('#curve'));
    ctx.clearRect(0, 0, width, height);
    const P = board.scan ? board.scan.points : board.points, fit = board.fit;
    drawCurve(ctx, width, height, {
      x: P.map((p) => p.tp), y: P.map((p) => p.amp * V), fit: fit ? (x) => fit.A * V * (1 - Math.exp(-x / fit.T1)) : null,
      xmax: 5, ymin: 0, ymax: 1.1 * V, colors: C, xunit: { s: 1, u: 's' },
      title: 'FID\'s start (μV)', xlabel: 'polarizing time (s)', current: board.tp,
      note: fit ? ['fit: T₁ = ', { v: fit.T1, dec: 2, w: 5 }, ' s'] : ['each cycle adds a point'],
    });
  }
}

// The tank's plot: its range of frequencies, kept while its peak is dragged; the drag tunes it.
let tankFrame = null, tankDrag = false, tankRange = null;
/** A range that holds the tank's resonance and the protons' frequency, in steps of 300 Hz × 2ⁿ
 *  centred on a multiple of 25 Hz (only the protons' when the tank is far out of the band). */
function tankRangeNow() {
  const fT = resonance(tankC()), fL = fLarmor(), inBand = fT > 600 && fT < 4500;
  const lo = Math.min(fL, inBand ? fT : fL) - 70, hi = Math.max(fL, inBand ? fT : fL) + 70;
  let span = 300;
  while (span < hi - lo && span < 4800) span *= 2;
  const mid = Math.round((lo + hi) / 2 / 25) * 25;
  return [mid - span / 2, mid + span / 2];
}
function drawTankPlot() {
  const { ctx, width, height } = fitCanvas($('#tank'));
  ctx.clearRect(0, 0, width, height);
  if (!tankDrag || !tankRange) tankRange = tankRangeNow();
  const C0 = tankC(), fT = resonance(C0), fL = fLarmor(), d = noiseDensity(fL, C0);
  tankFrame = drawTank(ctx, width, height, {
    f0: tankRange[0], f1: tankRange[1], fT, fL, Q: quality(fT), width: tankWidth(),
    mag: (f) => tankH(f, C0).mag, phase: (f) => tankH(f, C0).phase,
    noiseK: Math.hypot(d.coil, d.bias) / tankH(fL, C0).mag, floor: RECEIVER.enAmp,
    ymax: 1.12 * (fT > tankRange[0] && fT < tankRange[1] ? Math.max(quality(fL), quality(fT)) : quality(fL)),
    colors: C, title: 'The tank',
    off: fT > tankRange[1] ? `the tank resonates at ${fT.toFixed(0)} Hz, far above: ×${tankNow().mag.toFixed(2)} here` : fT < tankRange[0] ? `the tank resonates at ${fT.toFixed(0)} Hz, far below` : '',
  });
}
const tankCanvas = $('#tank');
tankCanvas.addEventListener('pointerdown', (e) => {
  if (!tankFrame) return;
  tankDrag = true; tankCanvas.setPointerCapture(e.pointerId); tankCanvas.classList.add('dragging');
  tuneTo(tankFrame.invX(e.clientX - tankCanvas.getBoundingClientRect().left));
});
tankCanvas.addEventListener('pointermove', (e) => { if (tankDrag) tuneTo(tankFrame.invX(e.clientX - tankCanvas.getBoundingClientRect().left)); });
const tankEnd = () => { if (!tankDrag) return; tankDrag = false; tankCanvas.classList.remove('dragging'); dirty(); };
tankCanvas.addEventListener('pointerup', tankEnd);
tankCanvas.addEventListener('pointercancel', tankEnd);
/** Set the switches nearest the capacitance that puts the tank at f. */
function tuneTo(f) { if (f > 0) setCode(codeFor(capacitanceFor(f))); }
/** Set the switches (a code 0–255): the tank and what the receiver makes of the FID change at once. */
function setCode(code) {
  code = Math.max(0, Math.min(255, Math.round(code)));
  if (code === board.code) return;
  board.code = code; syncTank(); scheduleHash(); dirty();
}
/** Turn the coil to the angle α (degrees) to the Earth's field: a new cycle. */
function setAngle(deg) {
  board.angle = Math.max(0, Math.min(90, +(+deg).toFixed(1)));
  coilSlider.value = board.angle; syncAngleButtons(); startBoard(); scheduleHash();
}

function boardReadout(lines) {
  const f0 = eng.f0, A = adiabaticity(Bp(), board.BE, board.ramp, board.angle * DEG), dash = (w) => ({ text: '–', w, class: 'b' });
  lines.push(['Earth\'s field', ['B_E = ', { v: board.BE * 1e6, dec: 2, w: 5, class: 'b' }, ' μT:'], 'protons at', ['f₀ = ', { v: f0, dec: 1, w: 6, class: 'b' }, ' Hz'],
    '(a turn in', [{ v: 1e3 / f0, dec: 3, w: 5 }, ' ms)']]);
  lines.push(['Polarizing:', [{ v: board.I, dec: 2, w: 4 }, ' A'], 'makes', ['B_p = ', { v: Bp() * 1e3, dec: 2, w: 5, class: 'b' }, ' mT,'], [{ v: Bp() / board.BE, dec: 0, w: 4 }, ' × B_E,'],
    'along the coil, at', ['α = ', { v: board.angle, dec: 1, w: 4, class: 'b' }, '°'], 'to B_E; M grows as 1 − e^(−t/T₁):', [{ v: polarizedAt(board.tp), dec: 3, w: 5, class: 'b' }], `of all of it after ${board.tp.toFixed(1)} s`]);
  const ar = board.afterRamp;
  lines.push(['Switch-off in', [...time3(board.ramp), ':'], ['A = γB_E²τ/B_p = ', { v: A, dec: A < 0.01 ? 4 : A < 10 ? 3 : 1, w: 6, class: 'b' }],
    A < 0.3 ? '(≪ 1: sudden, M is left behind)' : A > 3 ? '(≫ 1: adiabatic, M follows the field)' : '(near 1: M partly follows)',
    '· after it,', [ar ? { v: 100 * ar.across, dec: 1, w: 5, class: 'b' } : dash(5), '%'], 'of M is across B_E']);
  const fs = eng.t > tOpenAbs() + 0.05 ? fidStart() : NaN, ok = Number.isFinite(fs), H = tankNow(), G = filterH(fLarmor()).mag * RECEIVER.gain.high;
  lines.push(['Listening: the FID starts at', [ok ? { v: fs * Vfull() * 1e6, dec: 3, w: 5, class: 'b' } : dash(5), ' μV'], 'in the coil, × the tank\'s', [{ v: H.mag, dec: 1, w: 4, class: 'b' }, ':'],
    [ok ? { v: fs * Vfull() * H.mag * 1e6, dec: 1, w: 5, class: 'b' } : dash(5), ' μV'], 'on the tank, × the receiver\'s', [{ v: G, dec: 0, w: 6 }, ':'], [ok ? { v: fs * outPerM(), dec: 3, w: 5, class: 'b' } : dash(5), ' V'], 'at OUT']);
  const t2s = T2star(T2eff(), state.ensemble ? state.spreadHz : 0), sp = board.spec, nOut = rxNoise().total * RECEIVER.gain.high;
  lines.push([['T₂* = ', ...time3(t2s)], '· its peak gives', ['B = ', sp ? { v: (f0 + sp.peak.f) / GAMMA_HZ * 1e9, dec: 1, w: 7, class: 'b' } : dash(7), ' nT'],
    '· the receiver\'s noise at OUT:', [{ v: nOut * 1e3, dec: 1, w: 4, class: 'b' }, ' mV'], 'r.m.s.; the FID is', [ok && state.noiseOn ? { v: (fs * outPerM()) / (nOut / Math.sqrt(state.averages)), dec: 1, w: 5, class: 'b' } : dash(5), ' ×'], 'it']);
}

// The board's panel.
const earthPanel = $('#earth-panel');
const cycleButton = el('button', { type: 'button', class: 'primary', onclick: () => startBoard() }, 'Polarize and listen');
const boardLoop = el('button', { type: 'button', 'aria-pressed': 'true', title: 'Run the cycle again and again, as the board\'s sequencer does', onclick: () => { board.loop = !board.loop; boardLoop.setAttribute('aria-pressed', String(board.loop)); if (run) run.loop = board.loop; } }, 'Repeat');
const boardPause = el('button', { type: 'button', title: 'Stop or start the clock (space), to look at the sphere', onclick: () => playButton.click() }, 'Pause');
const hearButton = el('button', { type: 'button', title: 'Play OUT through the speakers or headphones, as the board\'s headphone jack does (start quietly)', onclick: () => hearIt() }, 'Hear it');
const tpSlider = slider({ label: 'polarize (s)', min: 0.2, max: 4.7, step: 0.05, value: board.tp, title: 'How long the current flows: the board\'s POLARIZE TIME, 0.2 to 4.7 s',
  onInput: (v) => { board.tp = v; startBoard(); scheduleHash(); } });
const rampSlider = slider({ label: 'switch-off (ms)', min: 0.01, max: 1000, log: true, value: board.ramp * 1e3, title: 'How long the polarizing current takes to fall to zero: the board\'s is 0.4 ms',
  onInput: (v) => { board.ramp = v / 1e3; startBoard(); scheduleHash(); } });
const tlSlider = slider({ label: 'listen (s)', min: 0.2, max: 4.8, step: 0.05, value: board.tl, title: 'How long the receiver listens: the board\'s LISTEN TIME, 0.2 to 4.8 s',
  onInput: (v) => { board.tl = v; startBoard(); scheduleHash(); } });
const beSlider = slider({ label: 'Earth\'s field (μT)', min: 20, max: 70, value: board.BE * 1e6, title: 'The Earth\'s field where the board is: 22 to 67 μT round the world, 46.0 μT in Claremont',
  onInput: (v) => { board.BE = v / 1e6; startBoard(); scheduleHash(); } });
{ // A tick on the Earth's-field slider at Claremont's 46.0 μT.
  const list = el('datalist', { id: 'claremont-tick' }, el('option', { value: String(Math.round(((46.03 - 20) / 50) * 1000)), label: 'Claremont' }));
  beSlider.append(list); beSlider.input.setAttribute('list', 'claremont-tick');
}
const claremont = el('button', { type: 'button', title: 'Harvey Mudd, Claremont: 46.0 μT (IGRF-14), protons at 1960 Hz', onclick: () => { board.BE = BOARD.claremont; beSlider.value = board.BE * 1e6; startBoard(); scheduleHash(); } }, 'Claremont: 46.0 μT');
const gradSlider = slider({ label: 'field spread (nT)', min: 0.5, max: 500, log: true, value: board.gradNT, title: 'How much the field differs across the bottle: steel nearby (a tool, a desk, a car) makes it far more',
  onInput: (v) => { board.gradNT = v; state.spreadHz = GAMMA_HZ * v * 1e-9; startBoard(); scheduleHash(); } });
const currentSlider = slider({ label: 'current (A)', min: 0.5, max: 3, step: 0.05, value: board.I, title: 'The polarizing current: the field, and so M and the signal, grow with it',
  onInput: (v) => { board.I = v; startBoard(); scheduleHash(); } });
const scanT1Button = el('button', { type: 'button', title: 'Run cycles polarizing from 0.2 to 4.7 s and fit the FID\'s start, A(1 − e^(−t/T₁))', onclick: () => startBoardScan() }, 'Measure T₁');
const boardSpeedSeg = segmented([{ value: 'auto', label: 'Auto', title: 'Real time, but slow motion through the switch-off and the first turns' }, { value: 'real', label: 'Real time' }, { value: 'slow', label: '×10⁻³', title: 'A thousand times slower: two turns a second' }],
  board.speedMode, (v) => { board.speedMode = v; trail = []; scheduleHash(); }, { label: 'Speed' });
// The coil's angle to the Earth's field, and the three ways to lay it (in Claremont, where the
// field dips 58.9° below the horizontal to the north).
const coilSlider = slider({ label: 'coil to B_E (°)', min: 0, max: 90, step: 0.1, value: board.angle, title: 'The angle α between the coil\'s axis and the Earth\'s field: the FID goes as sin² α',
  onInput: (v) => setAngle(v) });
const ORIENT = [
  { label: 'East–west', angle: 90, title: 'Horizontal, pointing magnetic east–west: square to the field anywhere on Earth' },
  { label: 'North–south', angle: BOARD.dip, title: `Horizontal, pointing magnetic north: at the dip, ${BOARD.dip}°, to Claremont's field` },
  { label: 'Upright', angle: +(90 - BOARD.dip).toFixed(2), title: `Vertical: at 90° − the dip, ${(90 - BOARD.dip).toFixed(2)}°, to Claremont's field` },
];
const orientButtons = ORIENT.map((o) => el('button', { type: 'button', title: o.title, onclick: () => setAngle(o.angle) }, o.label));
function syncAngleButtons() { ORIENT.forEach((o, i) => orientButtons[i].setAttribute('aria-pressed', String(Math.abs(board.angle - o.angle) < 0.06))); }
const audioNote = el('div', { class: 'gloss' }, 'Sound starts only after a click.  Headphones, at a low volume.');
earthPanel.append(el('div', { class: 'label' }, 'The board'),
  el('div', { class: 'row' }, cycleButton, boardLoop, boardPause, hearButton), audioNote,
  tpSlider, el('div', { class: 'gloss' }, 'The current magnetizes the water along the coil, with T₁.'),
  rampSlider, el('div', { class: 'gloss' }, 'Faster than the protons can turn (sudden), M is left across the Earth\'s field and rings; slower (adiabatic), it follows the field round and nothing rings.'),
  tlSlider, beSlider, el('div', { class: 'row' }, claremont),
  coilSlider, el('div', { class: 'row orient' }, ...orientButtons),
  el('div', { class: 'gloss' }, 'The FID goes as sin² α: once for the part of M left across the field, once for what the coil picks up of it.  Or drag the coil\'s end on the sphere.'),
  gradSlider, el('div', { class: 'gloss' }, 'A steel tool near the coil spreads the field across the bottle, and the FID dies sooner (T₂*).'),
  el('div', { class: 'row' }, scanT1Button), el('div', { class: 'row' }, el('span', { class: 'small muted' }, 'speed'), boardSpeedSeg));
$('#more-box').append(currentSlider);

// The tank's panel: the eight DIP switches of SW1, and the handbook's recipe for the field now.
const tankPanel = $('#tank-panel');
const dipButtons = TANK.switches.map((c, i) => el('button', { type: 'button', 'aria-pressed': 'false', title: `Switch ${i + 1}: ${+(c * 1e9).toFixed(1)} nF across the coil when ON`,
  onclick: () => setCode(board.code ^ (1 << i)) }, el('span', { class: 'n' }, String(i + 1)), el('span', { class: 'knob' }), el('span', { class: 'c' }, String(+(c * 1e9).toFixed(1)))));
const tankNote = el('div', { class: 'note' }), recipeNote = el('div', { class: 'note' });
const tuneButton = el('button', { type: 'button', class: 'primary', title: 'Set the switches the handbook\'s way, for the field now', onclick: () => setCode(tuneFor(board.BE, GAMMA_HZ).code) }, 'Tune to the protons');
const allOff = el('button', { type: 'button', title: 'Every switch OFF: only the clamp\'s 0.39 nF across the coil, so it resonates far above the band', onclick: () => setCode(0) }, 'All off');
tankPanel.append(el('div', { class: 'label' }, 'The tank: switches SW1 (nF)'),
  el('div', { class: 'gloss' }, 'Each switch ON adds its capacitance across the coil; the tank resonates at f_T = 1/(2π√(LC)) and multiplies the FID by up to Q = 37 there.'),
  el('div', { class: 'dip', role: 'group', 'aria-label': 'The DIP switches' }, ...dipButtons), tankNote,
  el('div', { class: 'row' }, tuneButton, allOff), recipeNote);
function syncTank() {
  dipButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(((board.code >> i) & 1) === 1)));
  const C0 = tankC(), fT = resonance(C0), on = switchesOn(board.code);
  setSlots(tankNote, ['C = ', { v: C0 * 1e9, dec: 2, w: 6 }, ' nF: f_T = ', { v: fT, dec: 1, w: 7 }, ' Hz, Q = ', { v: quality(fT), dec: 1, w: 5 }, ` · ON: ${on.length ? on.join(' ') : 'none'}`]);
  const t = tuneFor(board.BE, GAMMA_HZ), short = t.C > bankC(255) * 1.01;
  setSlots(recipeNote, ['The handbook\'s recipe for ', { v: board.BE * 1e6, dec: 2, w: 5 }, ' μT: f = 42.577 Hz/μT × B = ', { v: t.f, dec: 1, w: 6 }, ' Hz; C = 1/(4π²f²L) = ', { v: t.C * 1e9, dec: 1, w: 6 },
    ` nF (L = ${(TANK.L * 1e3).toFixed(1)} mH); ${short ? 'more than the bank holds: all ON,' : 'the nearest the switches make:'} `, { v: t.Cset * 1e9, dec: 2, w: 6 }, ' nF, ', { v: t.fT, dec: 1, w: 6 }, ` Hz: ${short ? 'all of them' : `switches ${t.switches.join(' ')}`}`]);
}

function syncBoard() {
  tpSlider.value = board.tp; rampSlider.value = board.ramp * 1e3; tlSlider.value = board.tl; beSlider.value = +(board.BE * 1e6).toPrecision(5);
  gradSlider.value = board.gradNT; currentSlider.value = board.I; boardSpeedSeg.value = board.speedMode;
  coilSlider.value = board.angle; syncAngleButtons(); syncTank();
  boardLoop.setAttribute('aria-pressed', String(board.loop));
}

// Hear it: a cycle run silently with the settings now, and OUT as the receiver gives it (the FID
// through the tank, the filters and the gain, with the receiver's noise), through Web Audio.
let audio = null;
function hearIt() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { audioNote.textContent = 'This browser has no Web Audio.'; return; }
  if (!audio) audio = new AC();
  audio.resume?.();
  const e = new Engine(boardParams());
  e.noiseSeed = 77;
  e.setSampling(Infinity);
  e.startEarth(earthCycle());
  const t0 = tOpenAbs();
  e.advance(t0 - e.t); e.setSampling(board.tl / 4000); e.advance(e.tEnd - e.t);
  const rate = audio.sampleRate, n = Math.max(1, Math.round((e.tEnd - t0) * rate));
  const out = outSamples(e.record, e.omegaRef, t0, n, rate, 77);
  const buf = audio.createBuffer(1, n, rate), d = buf.getChannelData(0);
  // 1 V at OUT is 0.4 of full scale (the FID of a litre of water, tuned, is about 0.6 V).
  for (let i = 0; i < n; i++) d[i] = Math.max(-1, Math.min(1, 0.4 * out[i] * Math.min(1, i / (0.005 * rate), (n - i) / (0.02 * rate))));
  const src = audio.createBufferSource(), g = audio.createGain();
  g.gain.value = 0.8;
  src.buffer = buf; src.connect(g); g.connect(audio.destination);
  src.start();
  let peak = 0, s2 = 0;
  for (let i = 0; i < n; i++) { peak = Math.max(peak, Math.abs(out[i])); }
  const tail = Math.floor(0.9 * n);
  for (let i = tail; i < n; i++) s2 += out[i] * out[i];
  board.heard = { n, rate, peak: 0.4 * peak, outPeak: peak, tailRms: Math.sqrt(s2 / Math.max(1, n - tail)) };
  audioNote.textContent = `Playing ${(n / rate).toFixed(1)} s of OUT: the FID at ${eng.f0.toFixed(0)} Hz, ${peak.toFixed(2)} V at its start, and the receiver's hiss.`;
}

// ------------------------------------------------------------- view 2: the three clocks
//
// One π/2 pulse, then the three clocks on one plot against the time on a log scale: the sum of the
// spins, what the coil sees (T2*); each spin's own part across the field (T2); M_z (T1).  On the
// sphere, the ring the spins' tips lie on.  The clock speeds up in step with the time since the
// pulse, a decade every CLOCKS.perDecade seconds on screen, so the log axis fills evenly.  A CPMG
// run goes alongside in an engine of its own, kept level with the page's clock, so its echoes come
// as the clock reaches them.

// A made-up sample with its three times a decade apart; the spread is the Lorentzian whose T2′,
// with T2, makes T2* exactly 1 ms (1/T2* = 1/T2 + πΔf: Δf = 900/π = 286.5 Hz).
const CLOCKS = { T1: 0.1, T2: 0.01, T2s: 1e-3, perDecade: 3, lo: 1e-4, look: [0.55, 0.62] };
CLOCKS.spread = (1 / CLOCKS.T2s - 1 / CLOCKS.T2) / Math.PI;
CLOCKS.speed = (CLOCKS.lo * Math.LN10) / CLOCKS.perDecade;
const clocks = { on: false, cpmg: true, lo: CLOCKS.lo, hi: 0.3, key: '', trace: null, echo: null, manual: null, fits: null, fitN: -1 };
let clocksFrame = null;

/** The log axis for the times set: from under T2* (0.1 ms at the most) to three times the
 *  longest of T1 and T2 (0.3 s at the least). */
function clocksRange() {
  const t2s = T2star(T2eff(), state.ensemble ? state.spreadHz : 0);
  const lo = Number.isFinite(t2s) ? Math.min(CLOCKS.lo, 10 ** Math.floor(Math.log10(t2s / 5))) : CLOCKS.lo;
  const longest = Math.max(0, ...[T1eff(), T2eff()].filter(Number.isFinite));
  return [lo, Math.max(0.3, longest > 0 ? niceUp(3 * longest) : 0)];
}
/** What the run depends on: when any of it changes, the run starts again. */
function clocksKey() { return [T1eff(), T2eff(), state.ensemble, state.spreadHz, state.B1, state.offsetHz].join('|'); }

/** Start the three clocks afresh: every spin along z, one π/2 pulse about x′ at t = 0. */
function startClocks() {
  [clocks.lo, clocks.hi] = clocksRange();
  clocks.key = clocksKey();
  clocks.trace = { t: [], sig: [], perp: [], mz: [] };
  clocks.manual = null; clocks.fits = null; clocks.fitN = -1; clocks.echo = null;
  startRun({ pulses: [{ t: 0, angle: 90, phase: 0 }], span: clocks.hi, loop: false, clocks: true });
  if (clocks.cpmg) startClockEcho();
}

/** The CPMG run beside it (clockTrain lays it out), sampled finely enough for an echo's shape,
 *  an eighth of T2*, on a grid that falls on every echo's top (at most 4000 samples). */
function startClockEcho() {
  const T2s = T2star(T2eff(), state.ensemble ? state.spreadHz : 0);
  clocks.echo = null;
  if (!Number.isFinite(T2s)) return;
  const { tau, n } = clockTrain(T2s, T2eff(), clocks.hi), s = buildSequence('cpmg', tau, n, T2s);
  const m = Math.min(Math.max(40, Math.ceil((2 * tau) / (T2s / 8))), Math.max(8, Math.floor((4000 * 2 * tau) / s.span)));
  clocks.echo = { eng: startSequence(batchParams(), s.pulses, s.span, (2 * tau) / m, 5), tau, n, times: s.echoes, w: Math.min(tau / 2, T2s), peaks: null, done: -1, y: null, yN: -1 };
  clockEchoLevel();
}
/** Bring the CPMG run level with the page's clock. */
function clockEchoLevel() {
  const E = clocks.echo;
  if (!E) return;
  const to = Math.min(eng.t, E.eng.tEnd);
  if (to > E.eng.t) E.eng.advance(to - E.eng.t);
}

/** After each step of the clock: the three clocks now, and the CPMG run brought level. */
function clocksTick() {
  if (!clocks.trace) return;
  clockSample(eng, clocks.trace);
  clockEchoLevel();
}
/** A change to what the run depends on starts it again (once a frame, at most). */
function clocksCheck() { if (run && run.clocks && clocksKey() !== clocks.key) startClocks(); }

/** The fits so far, each once its clock has run (to the first pulse sent by hand, if any): made
 *  again every third sample, and once the run is over. */
function clocksFitsNow() {
  const T = clocks.trace;
  if (!T) return { T2s: null, T2: null, T1: null };
  if (!clocks.fits || T.t.length >= clocks.fitN + 3 || (eng.done && T.t.length !== clocks.fitN)) {
    clocks.fits = clockFits(T, { from: clocks.lo, until: clocks.manual ?? Infinity });
    clocks.fitN = T.t.length;
  }
  return clocks.fits;
}
/** The CPMG run's echoes that have come, their tops, and the fit A e^{−t/T2} (from two on). */
function clockEchoPeaks() {
  const E = clocks.echo;
  if (!E) return null;
  const done = E.times.filter((t) => t < E.eng.t - E.w);
  if (done.length !== E.done) { E.done = done.length; E.peaks = done.length ? echoAmplitudes(E.eng.record, done, E.w) : null; }
  return E.peaks;
}

function drawClocksPlot() {
  const { ctx, width, height } = fitCanvas($('#clocks'));
  ctx.clearRect(0, 0, width, height);
  const E = clocks.echo;
  let echo = null;
  if (E) {
    const R = E.eng.record;
    if (E.yN !== R.length) { E.y = Float64Array.from(R.x, (x, i) => Math.hypot(x, R.y[i])); E.yN = R.length; }
    echo = { t: R.t, y: E.y, from: E.tau, peaks: clockEchoPeaks() };
  }
  clocksFrame = drawClocks(ctx, width, height, {
    t0: clocks.lo, t1: clocks.hi, now: eng.t, trace: clocks.trace,
    set: { T2s: T2star(T2eff(), state.ensemble ? state.spreadHz : 0), T2: T2eff(), T1: T1eff() },
    fits: clocksFitsNow(), echo, pulses: eng.sent.slice(1), colors: C, short: width < 560,
  });
}

function clocksReadout(lines) {
  const F = clocksFitsNow(), P = clockEchoPeaks(), dash = [{ text: '–', w: 6, class: 'b' }, ''];
  const t2s = T2star(T2eff(), state.ensemble ? state.spreadHz : 0), set = { T2s: t2s, T2: T2eff(), T1: T1eff() };
  // (Each in the unit of the time set, so that 0.9999 ms reads 1.00 ms, not 1000 μs.)
  const fit = (k) => (F[k] ? timeLike(F[k].tau, set[k]) : dash);
  lines.push(['Fitted, each once its clock has run: the sum, what the coil sees,', ['T₂* = ', ...fit('T2s')], '· each spin\'s own part,', ['T₂ = ', ...fit('T2')],
    ['· M', { html: '<sub>z</sub>' }, ','], ['T₁ = ', ...fit('T1')], '· set:', [...time3(t2s), ','], [...time3(T2eff()), ','], [...time3(T1eff())],
    ...(clocks.echo ? ['· the CPMG run\'s echoes,', ['T₂ = ', ...(P && P.fit && P.t.length >= 3 ? timeLike(P.fit.T2, set.T2) : dash)]] : []),
    ...(clocks.manual !== null ? ['(the fits stop at your pulse: Restart to measure again)'] : [])]);
  lines.push(['T₂* ≤ T₂ ≤ 2T₁.  The coil sees the spins\' sum, which can be no longer than they are, and the fan only shortens it: an echo undoes the fan, never a spin\'s own loss.  And whatever turns a spin over to take its energy away (T₁) costs it its phase too: 1/T₂ ≥ 1/(2T₁).']);
}

/** Leave the three clocks (the reader has taken the spins over): the clock carries on freely at
 *  the speed it had, but no faster than experiment 5's for this spread (the fan still watchable). */
function leaveClocks() {
  if (!clocks.on) return;
  if (run && run.clocks) {
    state.speed = Math.min(speedNow(), 0.628 * spreadT2(state.ensemble ? state.spreadHz : 0));
    speedSlider.value = state.speed; goFree();
  }
  clocks.on = false; clocks.echo = null;
  syncClocks(); scheduleHash(); dirty();
}

/** The layout and the panels for the three clocks (on only in view 2). */
function syncClocks() {
  clocks.on = clocks.on && state.view === 'many';
  $('#main').classList.toggle('clocks', clocks.on);
  clocksPanel.hidden = !clocks.on;
  if (clocks.on) noisePanel.hidden = true;
  else noisePanel.hidden = !noisePanel.dataset.views.split(' ').includes(state.view);
  clocksEchoCheck.checked = clocks.cpmg;
  $('#sphere-hint').textContent = clocks.on ? HINTS.clocks : HINTS[state.view];
}

const clocksPanel = $('#clocks-panel');
const clocksEchoCheck = el('input', { type: 'checkbox', checked: true, onchange: () => {
  clocks.cpmg = clocksEchoCheck.checked;
  if (!clocks.cpmg) clocks.echo = null; else if (run && run.clocks && !clocks.echo) startClockEcho();
  scheduleHash(); dirty();
} });
clocksPanel.append(el('div', { class: 'label' }, 'Three clocks'),
  el('div', { class: 'gloss' }, 'One π/2 pulse, then the clock speeds up as it goes, a decade every 3 s, so the plot\'s log time axis fills evenly: T₂* first, then T₂, then T₁.'),
  el('label', { class: 'check' }, clocksEchoCheck, 'Another run beside it: a CPMG train of π pulses about y′, its echoes'),
  el('div', { class: 'row' }, el('button', { type: 'button', class: 'primary', title: 'Every spin back along B₀, and the π/2 pulse again', onclick: () => startClocks() }, 'Run it again')),
  el('div', { class: 'gloss' }, 'Slide T₂, T₁ or the spread (Δf) and it starts again with them; a pulse sent now joins the run: try π about y′ at 3 ms.'));

// ------------------------------------------------------------------------ the address

let hashTimer = 0;
function scheduleHash() { clearTimeout(hashTimer); hashTimer = setTimeout(saveHash, 300); }
const r4 = (v) => +(+v).toPrecision(4);
function saveHash() {
  const m = eng.sum('rot'), s = spinHalf(m);
  writeHash({
    v: state.view, i: state.inst, fr: state.frame, sp: r4(state.speed),
    e: state.ensemble ? 1 : undefined, n: state.ensemble ? state.arrows : undefined, df: state.ensemble ? r4(state.spreadHz) : undefined,
    s: state.sample, t1: state.T1on ? r4(state.T1) : 'off', t2: state.T2on ? r4(state.T2) : 'off',
    nz: state.noiseOn ? r4(state.snr) : undefined, av: state.averages > 1 ? state.averages : undefined,
    b0: state.B0 !== inst().B0 ? r4(state.B0) : undefined, b1: r4(state.B1), off: state.offsetHz ? r4(state.offsetHz) : undefined,
    a: state.custom.angle !== 45 ? state.custom.angle : undefined, ph: state.custom.phase || undefined,
    m: !run ? `${r4(s.theta / DEG)}_${r4(s.phi / DEG)}` : undefined,
    q: state.view === 'seq' ? seq.preset : undefined, tau: state.view === 'seq' ? r4(seq.tau) : undefined,
    pn: state.view === 'seq' && (seq.preset === 'cpmg' || seq.preset === 'cp') ? seq.n : undefined,
    err: state.view === 'seq' && seq.error ? r4(seq.error) : undefined,
    ck: clocks.on ? 1 : undefined, ce: clocks.on && !clocks.cpmg ? 0 : undefined,
    ...(state.view === 'earth' ? { tp: r4(board.tp), ramp: r4(board.ramp), tl: r4(board.tl), be: r4(board.BE), gr: r4(board.gradNT), I: r4(board.I), bs: board.speedMode, sp: undefined,
      sw: board.code, ang: board.angle !== 90 ? board.angle : undefined } : {}),
  });
}
function loadHash(h) {
  const num = (x, d) => (x !== undefined && x !== '' && Number.isFinite(+x) ? +x : d);
  clocks.on = false;
  loadInstrument(INSTRUMENTS[h.i] ? h.i : 'teachspin');
  const I = inst();
  state.frame = h.fr === 'rot' ? 'rot' : 'lab';
  state.speed = num(h.sp, state.speed);
  state.ensemble = h.e === '1'; state.arrows = Math.round(num(h.n, 32)); state.spreadHz = num(h.df, I.spread);
  if (I.samples[h.s]) { state.sample = h.s; state.T1 = I.samples[h.s].T1; state.T2 = I.samples[h.s].T2; }
  else if (h.ck === '1') state.sample = null;   // (the three clocks' made-up sample)
  state.T1on = h.t1 !== undefined && h.t1 !== 'off'; state.T1 = num(h.t1, state.T1);
  state.T2on = h.t2 !== undefined && h.t2 !== 'off'; state.T2 = num(h.t2, state.T2);
  state.noiseOn = h.nz !== undefined; state.snr = num(h.nz, 20); state.averages = num(h.av, 1);
  state.B0 = num(h.b0, I.B0); state.B1 = num(h.b1, state.B1); state.offsetHz = num(h.off, 0);
  state.custom.angle = num(h.a, 45); state.custom.phase = num(h.ph, 0);
  applyEngine(); syncSliders();
  if (h.v === 'earth') {
    boardSetup({ tp: num(h.tp, 3), ramp: num(h.ramp, 0.4e-3), tl: num(h.tl, 2), BE: num(h.be, BOARD.claremont), gradNT: num(h.gr, 5), I: num(h.I, 1.5), speedMode: ['auto', 'real', 'slow'].includes(h.bs) ? h.bs : 'auto',
      code: Math.max(0, Math.min(255, Math.round(num(h.sw, BOARD.code)))), angle: Math.max(0, Math.min(90, num(h.ang, 90))) });
    if (I.samples[h.s]) loadSample(h.s);
    state.T1on = h.t1 !== 'off'; state.T2on = h.t2 !== 'off'; state.T1 = num(h.t1, state.T1); state.T2 = num(h.t2, state.T2);
    state.noiseOn = h.nz !== undefined; state.snr = num(h.nz, BOARD.snr); state.averages = num(h.av, 1);
    state.ensemble = h.e === '1'; state.frame = h.fr === 'rot' ? 'rot' : 'lab';
    applyEngine(); syncSliders(); startBoard();
    return;
  }
  setView(['one', 'many', 'seq', 'earth'].includes(h.v) ? h.v : 'one');
  if (state.view === 'many' && h.ck === '1') { clocks.on = true; clocks.cpmg = h.ce !== '0'; syncClocks(); view.look(...CLOCKS.look); startClocks(); return; }
  if (state.view === 'seq') {
    seq.error = num(h.err, 0);
    setPreset(PRESETS[h.q] ? h.q : 'cpmg', { tau: num(h.tau, undefined) });
    if (h.pn) { seq.n = num(h.pn, seq.n); buildSeq(); syncSeq(); runSeq(); }
    state.speed = num(h.sp, state.speed); speedSlider.value = state.speed;
    return;
  }
  const [th, ph] = (h.m || '0_0').split('_').map(Number);
  startFree([Math.sin(th * DEG) * Math.cos(ph * DEG), Math.sin(th * DEG) * Math.sin(ph * DEG), Math.cos(th * DEG)]);
}

// -------------------------------------------------------------------------- the experiments

/** A set-up: the view, the instrument and every setting it names; the rest at their defaults. */
function setup(o) {
  seedCount = 0;
  if (!o.keepInstrument || o.inst) loadInstrument(o.inst || 'teachspin');
  if (o.sample !== undefined) state.sample = o.sample;
  state.frame = o.frame || 'lab';
  state.ensemble = !!o.ensemble; state.arrows = o.arrows ?? 32;
  state.spreadHz = o.spread ?? inst().spread;
  state.offsetHz = o.offset ?? 0;
  if (o.B1) state.B1 = o.B1;
  state.T1on = !!o.T1; state.T2on = !!o.T2;
  const smp = inst().samples[state.sample] || inst().samples[inst().sample];
  state.T1 = typeof o.T1 === 'number' ? o.T1 : smp.T1; state.T2 = typeof o.T2 === 'number' ? o.T2 : smp.T2;
  state.noiseOn = !!o.snr; state.snr = o.snr || 20; state.averages = o.averages || 1;
  state.speed = o.speed ?? inst().speedLab;
  state.custom = { angle: o.angle ?? 45, phase: o.phase ?? 0 };
  state.playing = true; playButton.textContent = 'Pause';
  clocks.on = !!o.clocks; clocks.cpmg = o.cpmg ?? true;
  applyEngine(); syncSliders();
  setView(o.view || 'one');
  if (o.view === 'seq') {
    seq.error = o.error ?? 0; seq.loop = true;
    setPreset(o.preset || 'cpmg', { tau: o.tau });
    if (o.n) { seq.n = o.n; buildSeq(); state.speed = seq.span / SCREEN; speedSlider.value = state.speed; syncSeq(); runSeq(); }
    if (o.scan) startScan();
  } else if (o.clocks) { view.look(...CLOCKS.look); startClocks(); }
  else if (o.script) startRun(o.script); else startFree(o.M || [0, 0, 1]);
  scheduleHash();
}
const S45 = Math.SQRT1_2;
/** The times a set-up of views 1 and 2 is laid out in, for the instrument it will have: the π/2's
 *  length p, T2′ = 1/(πΔf) of its spread, and the nutation rate γB1/2π (TeachSpin: 2.5 μs,
 *  0.637 ms, 100 kHz). */
function scales(k) {
  const I = INSTRUMENTS[k.keepInstrument ? state.inst : 'teachspin'];
  return { I, p: I.pi2, T2p: 1 / (Math.PI * I.spread), nut: 1 / (4 * I.pi2) };
}
const setups = {
  larmor: (k = {}) => { const { I } = scales(k); setup({ ...k, view: 'one', frame: 'lab', speed: I.speedLab, M: [S45, 0, S45] }); },
  pulse90: (k = {}) => { const { p } = scales(k); setup({ ...k, view: 'one', frame: 'lab', speed: 0.4 * p, script: { pulses: [{ t: 0.8 * p, angle: 90, phase: 0 }], span: 4.8 * p, loop: false } }); },
  rotating: (k = {}) => { const { p } = scales(k); setup({ ...k, view: 'one', frame: 'rot', speed: 0.4 * p, script: { pulses: [{ t: 0.8 * p, angle: 90, phase: 0 }], span: 3.2 * p } }); },
  offres: (k = {}) => { const { p, nut } = scales(k); setup({ ...k, view: 'one', frame: 'rot', speed: 0.8 * p, offset: 0.5 * nut, script: { pulses: [{ t: 0.8 * p, angle: 90, phase: 0 }], span: 12 * p } }); },
  spread: (k = {}) => { const { T2p } = scales(k); setup({ ...k, view: 'many', frame: 'rot', ensemble: true, speed: 0.628 * T2p, script: { pulses: [{ t: 0, angle: 90, phase: 0 }], span: 6.28 * T2p } }); },
  echo: (k = {}) => { const { T2p } = scales(k); setup({ ...k, view: 'many', frame: 'rot', ensemble: true, T1: true, T2: true, speed: 0.785 * T2p, script: { pulses: [{ t: 0, angle: 90, phase: 0 }, { t: 2.356 * T2p, angle: 180, phase: 0 }], span: 7.85 * T2p } }); },
  // (On the TeachSpin, whatever the instrument was: its 2.5 μs pulse, and a made-up sample.)
  threeclocks: () => setup({ view: 'many', frame: 'rot', ensemble: true, sample: null, T1: CLOCKS.T1, T2: CLOCKS.T2, spread: CLOCKS.spread, speed: CLOCKS.speed, clocks: true }),
  cpmg: (k = {}) => setup({ ...k, view: 'seq', frame: 'rot', ensemble: true, T1: true, T2: true, preset: 'cpmg' }),
  mg: (k = {}) => setup({ ...k, view: 'seq', frame: 'rot', ensemble: true, T1: true, T2: true, preset: 'cp', error: 0.1 }),
  ir: (k = {}) => setup({ ...k, view: 'seq', frame: 'rot', ensemble: true, T1: true, T2: true, preset: 'ir', scan: true }),
  noise: (k = {}) => setup({ ...k, view: 'seq', frame: 'rot', ensemble: true, T1: true, T2: true, preset: 'fid', snr: 5 }),
  board: () => boardSetup({}),
  adiabatic: () => boardSetup({ ramp: 0.3 }),
  angle: () => boardSetup({ angle: BOARD.dip }),
  tune: () => boardSetup({ code: 0 }),
  elsewhere: () => boardSetup({ BE: 50e-6 }),
  tanknoise: () => boardSetup({ code: 79 }),
  t1board: () => boardSetup({ scan: true }),
  field: () => boardSetup({ tl: 4.8, speedMode: 'real' }),
  steel: () => boardSetup({ gradNT: 100 }),
};
/** A set-up of the board: tap water, the board's numbers, and those named. */
function boardSetup(o) {
  seedCount = 0;
  loadInstrument('earth');
  Object.assign(board, { tp: 3, ramp: 0.4e-3, tl: 2, I: 1.5, BE: BOARD.claremont, gradNT: 5, angle: 90, code: BOARD.code, speedMode: 'auto', loop: true, points: [], scan: null, fit: null }, o);
  delete board.scan; board.scan = null;
  state.frame = 'lab'; state.ensemble = true; state.arrows = 24;
  state.spreadHz = GAMMA_HZ * board.gradNT * 1e-9;
  state.T1on = true; state.T2on = true; loadSample('water', { on: true });
  state.noiseOn = true; state.snr = BOARD.snr; state.averages = 1;
  state.playing = true; playButton.textContent = 'Pause'; boardPause.textContent = 'Pause';
  applyEngine(); syncSliders(); syncBoard();
  setView('earth');
  startBoard();
  if (o.scan) startBoardScan();
  scheduleHash();
}
drawer($('#help'), $('#help-button'), setups);

function fromAddress() {
  const h = readHash();
  if (setups[h.setup]) setups[h.setup]();
  else if (h.v) loadHash(h);
  else setups.larmor();
}
fromAddress();
window.addEventListener('hashchange', fromAddress);
kick();

// ------------------------------------------------------------------------------ for the tests

window.__app = {
  state, setups, eng, view, ready: true,
  get run() { return run; },
  /** Hold the page's clock (the tests move it with step) or let it run again. */
  hold(on = true) { testHold = on; lastT = 0; kick(); },
  /** Move the page's clock on by dt seconds of screen time, n times, and draw. */
  step(dt = 1 / 60, n = 1) { for (let i = 0; i < n; i++) tick(dt); draw(); return { t: eng.t, m: eng.sum('rot') }; },
  /** Run the clock until the simulated time t (in steps of the page's frames), and draw. */
  runTo(t, maxSteps = 1e5) { for (let i = 0; i < maxSteps && eng.t < t && !(run && eng.done); i++) tick(1 / 60); draw(); return eng.t; },
  setView, sendPulse, startRun, startFree, goFree, loadInstrument, loadSample, windowNow, sigma, turnsPerFrame,
  seq, setPreset, buildSeq, runSeq, startScan, scanStep, trainEchoes, fidFit,
  board, BOARD, startBoard, boardSpeed, startBoardScan, fidStart, hearIt,
  setCode, setAngle, tuneTo, outSamples, outPerM, outRef, sigmaAt, sigmaBand, Vfull,
  /** The tank and the receiver now: the capacitance, the resonance, the gain and phase at the
   *  protons' frequency, the noise at OUT. */
  get tank() {
    const C0 = tankC(), fT = resonance(C0), H = tankNow(), n = rxNoise(), d = noiseDensity(fLarmor(), C0);
    return { code: board.code, switches: switchesOn(board.code), C: C0, fT, Q: quality(fT), width: tankWidth(), fL: fLarmor(), gain: H.mag, phase: H.phase / DEG,
      outNoise: n.total * RECEIVER.gain.high, coilNoise: kTC(C0), density: d, outPerM: outPerM(), recipe: tuneFor(board.BE, GAMMA_HZ) };
  },
  get tankFrame() { return tankFrame && { left: tankFrame.left, right: tankFrame.right, top: tankFrame.top, bottom: tankFrame.bottom, f0: tankFrame.x0, f1: tankFrame.x1 }; },
  finishBoardScan() { while (board.scan && board.scan.points.length < board.scan.tps.length) boardScanStep(); draw(); return board.fit; },
  /** Run the board's cycle to its end (in the page's frames), and draw. */
  runBoard(maxSteps = 2e5) { for (let i = 0; i < maxSteps && !eng.done; i++) tick(1 / 60); draw(); return eng.t; },
  /** Finish the τ scan now. */
  finishScan() { while (seq.scan && seq.scan.x.length < seq.scan.taus.length) scanStep(); draw(); return seq.scan; },
  sum: (frame = 'rot') => eng.sum(frame),
  /** The three clocks: their state, the fits so far ({T2s, T2, T1}: {A, tau} or null) and the
   *  CPMG run's echoes ({t, amp, fit: {A, T2}}), and the plot's frame (x: log10 of the time). */
  clocks, CLOCKS, startClocks, leaveClocks,
  clockFits: () => clocksFitsNow(), clockEchoes: () => clockEchoPeaks(),
  get clocksFrame() { return clocksFrame && { left: clocksFrame.left, right: clocksFrame.right, top: clocksFrame.top, bottom: clocksFrame.bottom, x0: clocksFrame.x0, x1: clocksFrame.x1 }; },
  /** The spectrum last drawn (view 2 or 3): {peak, fwhm, df}. */
  get spec() { return lastSpec && { peak: lastSpec.peak, fwhm: lastSpec.fwhm, df: lastSpec.df }; },
  tip: () => tipScreen(),
};
