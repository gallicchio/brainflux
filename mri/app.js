// MRI: from spins to an image.  Four views, each a step of the story: one axis by frequency
// encoding, a slice by a shaped pulse, the second axis by phase encoding (k-space filled line
// by line, the image forming), then contrast and the artefacts of a real scan.  The physics is
// in bloch.js, phantom.js and scan.js; each view is a module; this file is the page: the tabs,
// the clock, the address and the experiments.

import { AxisView } from './view-axis.js';
import { SliceView } from './view-slice.js';
import { KspaceView } from './view-kspace.js';
import { ContrastView } from './view-contrast.js';
import { $, segmented, drawer, readHash, writeHash } from '../lib/ui.js';

const VIEWS = [
  { id: 'axis', label: '1 · One axis', make: (app) => new AxisView(app) },
  { id: 'slice', label: '2 · A slice', make: (app) => new SliceView(app) },
  { id: 'kspace', label: '3 · The second axis', make: (app) => new KspaceView(app) },
  { id: 'contrast', label: '4 · Contrast and artefacts', make: (app) => new ContrastView(app) },
];

// (Declared before the views are made: they schedule the address and the clock as they start.)
let raf = 0, lastT = 0, testHold = false, hashTimer = 0;

const app = {
  view: 'axis',
  views: {},
  slice: { z: 0, thickness: 5 },   // the slice picked in view 2, which views 3 and 4 make a picture of
  colors: {},
  scheduleHash, kick,
};

function readColors() {
  const cs = getComputedStyle(document.documentElement), get = (n, f) => cs.getPropertyValue(n).trim() || f;
  app.colors = {
    pieces: [get('--piece-0', '#1f8f8a'), get('--piece-1', '#c45a16'), get('--piece-2', '#7b3fb5'), get('--piece-3', '#2f7a2f')],
    field: get('--field', '#2f62d8'), spec: get('--spec', '#1d1d1f'), sigRe: get('--sig-re', '#2f62d8'), sigIm: get('--sig-im', '#c8501a'),
    fan: get('--fan', 'rgba(90,100,120,0.16)'), ring: get('--ring', 'rgba(90,100,120,0.35)'),
    tissue: { water: get('--t-water', '#2f7fe0'), fat: get('--t-fat', '#d49b00'), grey: get('--t-grey', '#6f6f6f'), white: get('--t-white', '#a9a9a9'), lesion: get('--t-lesion', '#e0507a') },
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
  // (Views 3 and 4 show the slice picked in view 2: make them again for it if it has moved.)
  const z = app.slice?.z ?? 0, w = app.views[v];
  if ((v === 'kspace' || v === 'contrast') && w.s.obj === 'head' && w.madeAt !== z) { w.madeAt = z; w.rebuild(); }
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
  // (Views 3 and 4 measure one more line, or angle, on the right arrow.)
  if (e.key === 'ArrowRight' && current().step) { e.preventDefault(); current().step(); }
});

// ------------------------------------------------------------------- the address

function scheduleHash() { clearTimeout(hashTimer); hashTimer = setTimeout(saveHash, 300); }
function saveHash() { writeHash({ v: app.view, ...current().toHash() }); }

// ----------------------------------------------------------------------- set-ups

const AXIS = { G: 2, slow: 2, T2s: 200, B0: 1.5 };
const SLICE = { Gz: 4, bw: 1.5, fc: 0, T: 3, flip: 90, rephase: true, slow: 1.5 };
const KSP = { obj: 'head', type: 'se', TE: 20, TR: 500, N: 64, T2p: 200, order: 'centre', rate: 12, slow: 9, show: 'spins' };
const CON = { obj: 'head', mode: 'fourier', type: 'se', TR: 500, TE: 15, N: 128, fov: 256, lines: 128, sigma: 0, nsa: 1, fat: false, Gx: 4, B0: 1.5, T2p: 60, nA: 12, filter: true, rate: 3 };
/** The slice of views 3 and 4 back at the middle of the head (as view 2 opens). */
const slice0 = () => { if (Math.abs(app.views.slice.centre) > 1e-9) app.views.slice.set({ ...SLICE, playing: app.views.slice.s.playing }); };
const setups = {
  // 1 · One axis
  axis: () => { setView('axis'); app.views.axis.set({ ...AXIS, sample: 'two', t: 0.35 }); },
  drag: () => { setView('axis'); app.views.axis.set({ ...AXIS, pieces: [{ x: -10, w: 20, rho: 1 }] }); },
  stronger: () => { setView('axis'); app.views.axis.set({ ...AXIS, sample: 'two', G: 5 }); },
  winding: () => { setView('axis'); app.views.axis.set({ ...AXIS, sample: 'one', slow: 6 }); },
  resolution: () => { setView('axis'); app.views.axis.set({ ...AXIS, sample: 'lines', slow: 3 }); },
  // 2 · A slice
  slice: () => { setView('slice'); app.views.slice.set({ ...SLICE }); },
  moveslice: () => { setView('slice'); app.views.slice.set({ ...SLICE, fc: -6.47 }); },
  thin: () => { setView('slice'); app.views.slice.set({ ...SLICE, bw: 0.75 }); },
  rephase: () => { setView('slice'); app.views.slice.set({ ...SLICE, rephase: false, fc: 3 }); },
  // 3 · The second axis
  encode: () => { setView('kspace'); slice0(); const v = app.views.kspace; v.set({ ...KSP, cue: { q: 22, t: 0 } }); v.cue(22, v.seq.gyStart - 0.4); },
  fill: () => { setView('kspace'); slice0(); app.views.kspace.set({ ...KSP }); },
  centre: () => { setView('kspace'); slice0(); app.views.kspace.set({ ...KSP, only: 'centre' }); },
  spinecho: () => { setView('kspace'); slice0(); const v = app.views.kspace; v.set({ ...KSP, T2p: 8, slow: 14, cue: { q: 32, t: 0 } }); v.cue(32, 0); },
  motion: () => { setView('kspace'); app.views.kspace.set({ ...KSP, obj: 'disks', order: 'up', rate: 5, ramp: false }); },
  // 4 · Contrast and artefacts
  contrast: () => { setView('contrast'); slice0(); app.views.contrast.set({ ...CON }); },
  wrap: () => { setView('contrast'); slice0(); app.views.contrast.set({ ...CON, fov: 180 }); },
  lines: () => { setView('contrast'); slice0(); app.views.contrast.set({ ...CON, lines: 32 }); },
  noise: () => { setView('contrast'); slice0(); app.views.contrast.set({ ...CON, sigma: 0.05 }); },
  fat: () => { setView('contrast'); slice0(); app.views.contrast.set({ ...CON, fat: true, Gx: 0.5 }); },
  lauterbur: () => { setView('contrast'); slice0(); app.views.contrast.set({ ...CON, obj: 'disks', mode: 'lauterbur', nA: 4, rate: 1.5 }); },
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
