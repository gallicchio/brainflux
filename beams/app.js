// Gaussian beams and laser cavities: three views (the bench, the cavity, the modes), the
// experiments drawer, the address bar and the animation loop.

import { createBench } from './bench-view.js';
import { createCavity } from './cavity-view.js';
import { createModes } from './modes-view.js';
import { eigenmode } from './cavity.js';
import { $, $$, segmented, drawer, readHash, writeHash, toast } from '../lib/ui.js';

const state = {
  view: 'bench',
  bench: {
    lambda: 633, w0: 0.5, z0: 0, elements: [], sel: null, vz0: -20, vz1: 420, E: 120,
    field: 'real', m: 0, play: true, wavefronts: false, target: false, tz: 300, bright: 0,
  },
  cavity: { L: 250, R1: 500, R2: 500, rays: true, play: true },
  modes: {
    family: 'hg', m: 2, n: 1, p: 0, l: 1, alpha: Math.PI / 4, phi: Math.PI / 2, zeta: 0.5,
    cross: 'phase', side: 'real', fft: false, travel: false, play: true,
  },
};

const app = { state, toast };
let views = null;

// ------------------------------------------------------------------- the address

let hashTimer = 0;
app.hashSoon = () => {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    writeHash({ v: state.view, ...views.bench.toHash(), ...views.cavity.toHash(), ...views.modes.toHash() });
  }, 250);
};

// ------------------------------------------------------------------- animation

let running = false, last = 0;
function loop(t) {
  const dt = Math.min(0.1, Math.max(0, (t - last) / 1000));
  last = t;
  const busy = views[state.view].tick(dt);
  if (busy) requestAnimationFrame(loop); else running = false;
}
app.animate = () => {
  if (running) return;
  running = true; last = performance.now();
  requestAnimationFrame(loop);
};

// ------------------------------------------------------------------- views

const bench = createBench(app);
const cavity = createCavity(app);
const modes = createModes(app);
views = { bench, cavity, modes };
app.cavityChanged = () => { if (state.bench.target) bench.refreshTarget(); };

const tabs = segmented([
  { value: 'bench', label: 'Bench', title: 'A beam through lenses, mirrors and glass' },
  { value: 'cavity', label: 'Cavity', title: 'Two mirrors: stability, the mode, rays, the spectrum' },
  { value: 'modes', label: 'Modes', title: 'Hermite–Gauss and Laguerre–Gauss beams' },
], state.view, (v) => setView(v), { label: 'View' });
$('#tabs').append(tabs);

function setView(v) {
  state.view = v;
  tabs.value = v;
  for (const name of Object.keys(views)) {
    $(`#view-${name}`).hidden = name !== v;
    for (const c of $$(`.view-controls[data-view="${name}"]`)) c.hidden = name !== v;
  }
  views[v].show();
  app.animate();
  app.hashSoon();
}

document.addEventListener('keydown', (e) => {
  if (e.key !== ' ' || e.target.closest('input, textarea, button, select, canvas')) return;
  // Space: play or pause whatever moves in this view.
  const s = state[state.view];
  const btn = $(`.view-controls[data-view="${state.view}"] button.primary`);
  if (btn) { btn.click(); e.preventDefault(); }
  void s;
});

// ------------------------------------------------------------------- experiments

const LAMBDA_MM = 633e-6;
function onBench(cfg) { setView('bench'); bench.load(cfg); }
function onCavity(cfg) { setView('cavity'); cavity.set({ rays: true, play: true, ...cfg }); }
function onModes(cfg) { setView('modes'); modes.set(cfg); }

const setups = {
  start: () => onBench({ w0: 0.5, z0: 0, elements: [{ type: 'lens', z: 100, f: 150 }], view: [-20, 420] }),
  waist: () => onBench({ w0: 0.2, z0: 0, elements: [], view: [-600, 600], fill: 0.8 }),
  focus: () => onBench({ w0: 1, z0: 0, elements: [{ type: 'lens', z: 50, f: 100 }], view: [0, 250], field: 'intensity', select: 0, fill: 0.85 }),
  gouy: () => onBench({ w0: 0.5, z0: 0, elements: [{ type: 'lens', z: 0, f: 200 }], focus: true }),
  telescope: () => onBench({ w0: 0.5, z0: 0, elements: [{ type: 'lens', z: 50, f: 50 }, { type: 'lens', z: 300, f: 200 }], view: [-20, 700], fill: 0.8, field: 'intensity' }),
  imaging: () => onBench({ w0: 0.1, z0: 0, elements: [{ type: 'lens', z: 100, f: 50 }], view: [-20, 300], select: 0, field: 'intensity', fill: 0.8 }),
  slab: () => onBench({ w0: 0.6, z0: 0, elements: [{ type: 'lens', z: 0, f: 150 }, { type: 'slab', z: 80, t: 40, n: 1.5 }], view: [-10, 250], select: 1, fill: 0.8 }),
  stability: () => onCavity({ L: 250, R1: 1000, R2: 500 }),
  rays: () => onCavity({ L: 250, R1: 400, R2: 400 }),
  confocal: () => onCavity({ L: 250, R1: 250, R2: 250 }),
  waveguide: () => {
    // A stable cavity unfolded: lenses f = R/2 every L.  Launch the cavity's own mode.
    const L = 150, R = 200, md = eigenmode(L, R, R, LAMBDA_MM);
    onBench({
      w0: md.w0, z0: 0, view: [-20, 920], fill: 0.6, field: 'intensity',
      elements: [0, 1, 2, 3, 4, 5].map((k) => ({ type: 'lens', z: 75 + 150 * k, f: R / 2 })),
    });
  },
  matching: () => {
    state.cavity.L = 200; state.cavity.R1 = 300; state.cavity.R2 = 300;
    onBench({ w0: 0.3, z0: 0, elements: [{ type: 'lens', z: 250, f: 200 }], target: true, tz: 500, view: [-20, 760], select: 0, fill: 0.7 });
  },
  hermite: () => onModes({ family: 'hg', m: 2, n: 1, zeta: 0.5 }),
  donut: () => onModes({ family: 'lg', p: 0, l: 1, zeta: 0.6 }),
  fft: () => onModes({ family: 'hg', m: 3, n: 1, zeta: 1.5, fft: true }),
};
drawer($('#help'), $('#help-button'), setups);

// ------------------------------------------------------------------- start

const hash = readHash();
if (setups[hash.setup]) setups[hash.setup]();
else if (hash.v) {
  bench.fromHash(hash); cavity.fromHash(hash); modes.fromHash(hash);
  setView(['bench', 'cavity', 'modes'].includes(hash.v) ? hash.v : 'bench');
} else setups.start();

window.__app = { state, setups, bench, cavity, modes, setView, ready: true };
