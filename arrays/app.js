// Antenna arrays and aperture synthesis: two modes sharing one idea, that the far-field
// pattern of a set of antennas is the Fourier transform of their layout.

import { A, configureArrays, arraysChanged, setArraysActive, onArraysChange, arraysHash, arraysFromHash, arraysApi } from './arrays-ui.js';
import { S, loadPreset, setSynthActive, onSynthChange, synthHash, synthFromHash, synthApi, synthChanged } from './synth-ui.js';
import { $, $$, segmented, drawer, readHash, writeHash } from '../lib/ui.js';

const state = { mode: 'arrays' };

const modeSeg = segmented([
  { value: 'arrays', label: 'Antenna arrays', title: 'Radiators in a plane, their waves and their far-field pattern' },
  { value: 'synth', label: 'Aperture synthesis', title: 'Radio dishes on the turning Earth, making an image of the sky' },
], state.mode, (m) => setMode(m), { label: 'Mode' });
$('#mode-row').append(modeSeg);

let synthStarted = false;
function setMode(m) {
  state.mode = m; modeSeg.value = m;
  const arrays = m === 'arrays';
  $('#arrays-stage').hidden = !arrays; $('#arrays-controls').hidden = !arrays;
  $('#synth-stage').hidden = arrays; $('#synth-controls').hidden = arrays;
  if (!arrays && !synthStarted) { synthStarted = true; loadPreset('y'); }
  setArraysActive(arrays);
  setSynthActive(!arrays);
  saveHash();
}

// ------------------------------------------------------------------ the address

let hashTimer = 0;
function saveHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => writeHash({ mode: state.mode, ...(state.mode === 'arrays' ? arraysHash() : synthHash()) }), 150);
}
onArraysChange(saveHash);
onSynthChange(saveHash);

// ------------------------------------------------------------------ experiments

const arr = (o) => { setMode('arrays'); configureArrays(o); };
const syn = (id, o) => { if (!synthStarted) synthStarted = true; setMode('synth'); loadPreset(id, o); };
const ring6 = Array.from({ length: 6 }, (_, k) => [Math.round(700 * Math.cos(2.1 * k + 0.4) * (0.4 + 0.12 * k)), Math.round(700 * Math.sin(2.1 * k + 0.4) * (0.4 + 0.12 * k))]);

const setups = {
  // Antenna arrays.
  two: () => arr({ n: 2, d: 0.5, theta0: 0, view: 10 }),
  endfire: () => arr({ n: 2, d: 0.5, theta0: 90, view: 10 }),
  cardioid: () => arr({ n: 2, d: 0.25, theta0: 90, view: 10 }),
  line: () => arr({ n: 8, d: 0.5, theta0: 0, view: 16 }),
  steer: () => arr({ n: 16, d: 0.5, theta0: 30, view: 20 }),
  sweep: () => arr({ n: 16, d: 0.5, theta0: 0, view: 20, sweep: true }),
  grating: () => arr({ n: 12, d: 0.8, theta0: 0, view: 20 }),
  grating2: () => arr({ n: 12, d: 2, theta0: 0, view: 24 }),
  taper: () => arr({ n: 16, d: 0.5, theta0: 0, view: 20 }),
  dipoles: () => arr({ n: 4, d: 0.5, theta0: 0, kind: 'dipole', dipAngle: 0, factors: true, view: 12 }),
  random: () => arr({ layout: 'random', n: 24, aperture: 14, seed: 3, theta0: 0, view: 24 }),
  focus: () => arr({ n: 24, d: 0.5, cy: -7, phaseMode: 'focus', focus: [0, 0], view: 20, display: 'intensity' }),
  // Aperture synthesis.
  fringe: () => syn('two'),
  six: () => syn('two', { dishes: ring6 }),
  rotation: () => syn('y', { hours: 0, sky: 'portrait' }),
  ellipses: () => syn('line', { dec: 90 }),
  equator: () => syn('line', { dec: 5 }),
  resolution: () => syn('y', { arm: 600, sky: 'double', size: 0.5, fov: 4, hours: 8, dec: 50 }),
  shortspacing: () => syn('y', { arm: 4000, sky: 'disk', size: 6, fov: 12, hours: 8, dec: 50 }),
  eht: () => syn('eht'),
  clean: () => syn('y', { sky: 'double', size: 2, fov: 8, hours: 2, dec: 50, cleanShow: 'residual' }),
};

drawer($('#help'), $('#help-button'), setups);
// Second set-ups inside an experiment's text.
for (const b of $$('#help .setup-alt')) {
  b.addEventListener('click', () => {
    setups[b.dataset.alt]?.();
    if (window.matchMedia('(max-width: 900px)').matches) $('#help').classList.remove('open');
  });
}

// ------------------------------------------------------------------ start

function fromAddress() {
  const hash = readHash();
  if (setups[hash.setup]) setups[hash.setup]();
  else if (hash.mode === 'synth') { synthStarted = true; setMode('synth'); synthFromHash(hash); }
  else {
    if (Object.keys(hash).length > 1) arraysFromHash(hash);
    else configureArrays({ n: 8, d: 0.5, theta0: 20, view: 16 });
    setMode('arrays');
  }
}
fromAddress();
// An address typed or pasted while the page is open (the page itself rewrites the address
// without this event firing).
window.addEventListener('hashchange', fromAddress);

window.__app = { state, setups, setMode, A, S, arrays: arraysApi, synth: synthApi, synthChanged, arraysChanged, ready: true };
