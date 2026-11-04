// Optical coherence tomography: four views, one step each, from the fringes of one surface to a
// 3D image.  This file holds the light (shared by every view), switches between the views, keeps
// the set-up in the address, runs the clock and holds the guided experiments.  Each view is a
// module of its own (fringes-view.js, ...); the physics is in source.js, sample.js, tdoct.js,
// fdoct.js and scan.js.

import { $, segmented, slider, drawer, readHash, writeHash, setGroups } from '../lib/ui.js';
import { Source, SOURCES } from './source.js';
import * as F from './fringes-view.js';
import * as A from './ascan-view.js';
import * as B from './scan-view.js';
import * as Q from './fourier-view.js';

const VIEWS = { fringes: F, ascan: A, scan: B, fourier: Q };
const VIEW_LIST = [
  { value: 'fringes', label: '1 · Fringes from a layer', title: 'One reflecting surface in the sample arm: a burst of fringes where the paths match' },
  { value: 'ascan', label: '2 · The A-scan', title: 'A layered sample, scanned in depth: the envelope of the fringes is its reflectivity against depth' },
  { value: 'scan', label: '3 · B-scan and volume', title: 'Step the beam across: A-scans side by side make a cross-section; step it along y too and they make a volume' },
  { value: 'fourier', label: '4 · Fourier domain', title: 'The mirror still, a spectrometer: one Fourier transform gives the whole A-scan at once' },
];
const app = { view: 'fringes' };

// --------------------------------------------------------------------- the light

const shared = {
  src: new Source(840, 50),
  onChange: () => scheduleHash(),
  /** A new bandwidth (nm), from the slider or a drag on a spectrum. */
  setBandwidth(v) { setSource(shared.src.lamNm, v); },
  setLambda(nm) { setSource(nm, shared.src.fwhmNm); },
};

let bwSlider = null, lamSeg = null;
function setSource(lam, fwhm) {
  shared.src.set(lam, fwhm);
  if (bwSlider && Math.abs(bwSlider.value - fwhm) > 1e-9 * fwhm) bwSlider.value = +fwhm.toPrecision(4);
  if (lamSeg) lamSeg.value = lam;
  for (const v of Object.values(VIEWS)) v.sourceChanged();
  lightReadout();
  scheduleHash();
}

function lightReadout() {
  const s = shared.src;
  setGroups($('#light-readout'), ['Coherence length', ['ℓ_c = 0.44 λ₀²/Δλ = ', { v: s.lc, dec: s.lc < 100 ? 2 : 0, w: 6 }, ' μm']]);
}

lamSeg = segmented(Object.values(SOURCES).map((p) => ({ value: p.lam, label: p.label, title: p.title })), 840,
  (lam) => setSource(lam, shared.src.fwhmNm), { label: 'Centre wavelength' });
$('#lam-box').append(lamSeg);
bwSlider = slider({ label: 'bandwidth Δλ (nm)', min: 0.05, max: 250, log: true, value: 50, title: 'The full width at half maximum of the source\'s spectrum',
  onInput: (v) => setSource(shared.src.lamNm, v) });
$('#bw-box').append(bwSlider);

// --------------------------------------------------------------------- the views

const viewSeg = segmented(VIEW_LIST, app.view, (v) => setView(v), { label: 'View' });
$('#view-row').append(viewSeg);

function setView(v) {
  if (!VIEWS[v]) return;
  app.view = v;
  viewSeg.value = v;
  $('#main').dataset.view = v;
  VIEWS[v].invalidate();
  scheduleHash();
}

// --------------------------------------------------------------------- the address

let hashTimer = 0;
function scheduleHash() {
  if (hashTimer) return;
  hashTimer = setTimeout(() => {
    hashTimer = 0;
    writeHash({ view: app.view, lam: shared.src.lamNm, bw: +shared.src.fwhmNm.toPrecision(5), ...VIEWS[app.view].toHash() });
  }, 300);
}

function fromHash(h) {
  const num = (k, d) => (h[k] !== undefined && Number.isFinite(+h[k]) ? +h[k] : d);
  setSource(num('lam', 840) === 1300 ? 1300 : 840, Math.max(0.05, Math.min(250, num('bw', 50))));
  const v = VIEWS[h.view] ? h.view : 'fringes';
  setView(v);
  VIEWS[v].fromHash(h, num);
}

// --------------------------------------------------------------------- set-ups

/** A set-up: the view, the light, and the view's own settings. */
function go(view, { lam = 840, bw = 50, ...o } = {}) {
  setSource(lam, bw);
  setView(view);
  VIEWS[view].configure(o);
  scheduleHash();
}

const setups = {
  // (Also what the page opens with.)
  start: () => go('fringes', { d: 32, z: 50, motor: 'sweep', speed: 8, win: [20, 80] }),
  bandwidth: () => go('fringes', { bw: 10, d: 20, z: 60, motor: 'sweep', speed: 20, win: [0, 120] }),
  two: () => go('fringes', { d: 30, z: 40, two: true, t: 100, n: 1.5, motor: 'sweep', speed: 30, win: [15, 215] }),
  dispersion: () => go('fringes', { bw: 150, d: 40, z: 50, glass: 2, motor: 'sweep', speed: 3, win: [30, 70] }),
  ascan: () => go('ascan', { sample: 'slide', scale: 'lin', noise: -60 }),
  resolution: () => go('ascan', { sample: 'pair', gap: 8, scale: 'lin', noise: -120, whole: true, d: 10 }),
  retina: () => go('ascan', { sample: 'retina', scale: 'db', noise: -60 }),
  bscan: () => go('scan', { scene: 'retina' }),
  speckle: () => go('scan', { scene: 'retina', done: true, probe: 128 }),
  average: () => go('scan', { scene: 'retina', avg: 16, rate: 1024 }),
  lateral: () => go('scan', { scene: 'beads', NA: 0.1, focus: 300, done: true }),
  tilt: () => go('scan', { scene: 'plate', tilt: 5, done: true }),
  volume: () => go('scan', { scene: 'retina', mode: 'volume', ix: 46, iy: 33, m: 83 }),
  flatten: () => go('scan', { scene: 'retina', mode: 'volume', follow: true, layer: 7, below: 11, ix: 32, iy: 32 }),
  fourier: () => go('fourier', { sample: 'one', offset: 40, motor: true, pick: 0 }),
  conjugate: () => go('fourier', { sample: 'film', offset: -60, both: true, motor: false, pick: 0, scale: 'lin' }),
  range: () => go('fourier', { sample: 'slide', N: 256, offset: 60, motor: false, pick: 1 }),
  fdbscan: () => go('fourier', { mode: 'bscan', scene: 'retina', shift: 120, motor: true }),
};

// --------------------------------------------------------------------- start

F.init(shared);
A.init(shared);
B.init(shared);
Q.init(shared);
drawer($('#help'), $('#help-button'), setups);
lightReadout();

const hash = readHash();
if (setups[hash.setup]) setups[hash.setup]();
else if (Object.keys(hash).length) fromHash(hash);
else setups.start();
// An address typed or pasted in while the page is open (the page's own writes do not fire this).
window.addEventListener('hashchange', () => {
  const h = readHash();
  if (setups[h.setup]) setups[h.setup](); else if (Object.keys(h).length) fromHash(h);
});

// --------------------------------------------------------------------- the clock

let last = 0, held = false;
function loop(now) {
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  if (!held && !document.hidden) VIEWS[app.view].tick(dt);
  VIEWS[app.view].draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.addEventListener('resize', () => VIEWS[app.view].invalidate());
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => VIEWS[app.view].invalidate());

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ' && (app.view === 'fringes' || app.view === 'ascan')) { e.preventDefault(); const V = VIEWS[app.view]; V.setMotor(V.state.motor === 'stop' ? 'sweep' : 'stop'); }
  if (app.view === 'scan' && e.key === ' ') { e.preventDefault(); $('#s-play').click(); }
  if (app.view === 'scan' && e.key === 'ArrowRight') { e.preventDefault(); B.stepScan(); }
});

window.__app = {
  ready: true, setups, setView, views: VIEWS, F, A, B, Q, src: shared.src, shared,
  get view() { return app.view; },
  /** Hold the clock (the tests move it with step) or let it run again.  Held, view 3 computes its
   *  A-scans itself as the clock is stepped, rather than in its worker. */
  hold(on = true) { held = on; shared.held = on; last = 0; },
  /** Move the clock on by dt seconds, n times, and draw. */
  step(dt = 1 / 60, n = 1) { for (let i = 0; i < n; i++) VIEWS[app.view].tick(dt); VIEWS[app.view].draw(true); },
};
