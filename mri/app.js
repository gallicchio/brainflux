// MRI: from spins to an image.  Four views, each a step of the story: one axis by frequency
// encoding, a slice by a shaped pulse, the second axis by phase encoding (k-space filled line
// by line, the image forming), then contrast and the artefacts of a real scan.  The physics is
// in bloch.js, phantom.js and scan.js; each view is a module; this file is the page: the tabs,
// the clock, the address and the experiments.

import { AxisView } from './view-axis.js';
import { $, segmented, drawer, readHash, writeHash } from '../lib/ui.js';

const VIEWS = [
  { id: 'axis', label: '1 · One axis', make: (app) => new AxisView(app) },
];

// (Declared before the views are made: they schedule the address and the clock as they start.)
let raf = 0, lastT = 0, testHold = false, hashTimer = 0;

const app = {
  view: 'axis',
  views: {},
  colors: {},
  scheduleHash, kick,
};

function readColors() {
  const cs = getComputedStyle(document.documentElement), get = (n, f) => cs.getPropertyValue(n).trim() || f;
  app.colors = {
    pieces: [get('--piece-0', '#1f8f8a'), get('--piece-1', '#c45a16'), get('--piece-2', '#7b3fb5'), get('--piece-3', '#2f7a2f')],
    field: get('--field', '#2f62d8'), spec: get('--spec', '#1d1d1f'), sigRe: get('--sig-re', '#2f62d8'), sigIm: get('--sig-im', '#c8501a'),
    fan: get('--fan', 'rgba(90,100,120,0.16)'), ring: get('--ring', 'rgba(90,100,120,0.35)'),
  };
}
readColors();

for (const v of VIEWS) app.views[v.id] = v.make(app);
const current = () => app.views[app.view];

// ------------------------------------------------------------------------- the views

const viewSeg = segmented(VIEWS.map((v) => ({ value: v.id, label: v.label })), app.view, (v) => setView(v), { label: 'View' });
$('#view-row').append(viewSeg);

function setView(v) {
  if (!app.views[v]) return;
  app.view = v; viewSeg.value = v;
  $('#main').dataset.view = v;
  current().dirty = true;
  kick(); scheduleHash();
}

// ------------------------------------------------------------------------- the clock

function kick() { if (!raf) raf = requestAnimationFrame(loop); }
function loop(now) {
  raf = 0;
  const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0;
  lastT = now;
  const v = current(), animating = !document.hidden && v.animating;
  if (animating && !testHold) v.advance(dt);
  if (v.dirty || animating) v.draw();
  if (animating && !testHold) raf = requestAnimationFrame(loop); else lastT = 0;
}
window.addEventListener('resize', () => { current().dirty = true; kick(); });
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { readColors(); current().dirty = true; kick(); });
document.addEventListener('visibilitychange', () => { lastT = 0; kick(); });
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ' && current().setPlaying) { e.preventDefault(); current().setPlaying(!current().s.playing); }
});

// ------------------------------------------------------------------- the address

function scheduleHash() { clearTimeout(hashTimer); hashTimer = setTimeout(saveHash, 300); }
function saveHash() { writeHash({ v: app.view, ...current().toHash() }); }

// ----------------------------------------------------------------------- set-ups

const AXIS = { G: 2, slow: 2, T2s: 20, B0: 1.5 };
const setups = {
  // 1 · One axis
  axis: () => { setView('axis'); app.views.axis.set({ ...AXIS, sample: 'two', t: 0.35 }); },
  drag: () => { setView('axis'); app.views.axis.set({ ...AXIS, pieces: [{ x: -10, w: 20, rho: 1 }] }); },
  stronger: () => { setView('axis'); app.views.axis.set({ ...AXIS, sample: 'two', G: 5 }); },
  winding: () => { setView('axis'); app.views.axis.set({ ...AXIS, sample: 'one', slow: 6 }); },
  resolution: () => { setView('axis'); app.views.axis.set({ ...AXIS, sample: 'lines', slow: 3 }); },
};
drawer($('#help'), $('#help-button'), setups);

function fromAddress() {
  const h = readHash();
  if (setups[h.setup]) setups[h.setup]();
  else if (h.v && app.views[h.v]) { setView(h.v); app.views[h.v].fromHash(h); }
  else setups.axis();
}
fromAddress();
window.addEventListener('hashchange', fromAddress);
kick();

window.__app = {
  app, setups, setView, ready: true,
  get view() { return app.view; },
  views: app.views,
  /** Hold the clock (the tests move it with step) or let it run again. */
  hold(on = true) { testHold = on; lastT = 0; kick(); },
  /** Move the clock on by dt seconds, n times, and draw. */
  step(dt = 1 / 60, n = 1) { const v = current(); for (let i = 0; i < n; i++) v.advance(dt); v.draw(); return v.probe(); },
  draw() { const v = current(); v.draw(); return v.probe(); },
};
