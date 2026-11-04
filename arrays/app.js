// Antenna arrays: the far-field pattern of a set of antennas is the Fourier transform of their
// layout.  The other half of that idea, radio dishes on the turning Earth measuring the Fourier
// transform of the sky, was the "Aperture synthesis" view of this page and is now a demo of its
// own, ../radiointerferometer/; the old addresses of that view are sent there.

import { A, configureArrays, arraysChanged, setArraysActive, onArraysChange, arraysHash, arraysFromHash, arraysApi } from './arrays-ui.js';
import { $, $$, drawer, readHash, writeHash } from '../lib/ui.js';

// ------------------------------------------------------------------ the old synthesis addresses

const RADIO = '../radiointerferometer/';
// The experiments of the old view, and the keys that named it in a saved address.
const SYNTH_SETUPS = ['fringe', 'six', 'rotation', 'ellipses', 'equator', 'resolution', 'shortspacing', 'eht', 'clean'];
const SYNTH_MODES = ['synth', 'synthesis'];

/** Where an address of the old synthesis view goes, or null if the address is this page's. */
function radioAddress(hash) {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  if (!SYNTH_SETUPS.includes(p.get('setup')) && !SYNTH_MODES.includes(p.get('mode')) && !SYNTH_MODES.includes(p.get('view'))) return null;
  // The #setup= name, or the saved state, goes along for the new demo to honour or ignore.
  p.delete('mode'); p.delete('view');
  const s = p.toString();
  return RADIO + (s ? `#${s}` : '');
}

// Before anything else: an old synthesis address leaves for the new demo, with no history entry.
const radio = radioAddress(location.hash);
if (radio) location.replace(radio);
else start();

function start() {
  setArraysActive(true);

  // ---------------------------------------------------------------- the address

  let hashTimer = 0;
  function saveHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => writeHash(arraysHash()), 150);
  }
  onArraysChange(saveHash);

  // ---------------------------------------------------------------- experiments

  const arr = (o) => { configureArrays(o); saveHash(); };

  const setups = {
    // The opening view: a line of eight, half a wavelength apart, steered to 20 degrees by the
    // phases (beam 13.6 degrees wide, sidelobe -12.8 dB, D = 8).
    start: () => arr({ n: 8, d: 0.5, theta0: 20, view: 16 }),
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
  };

  drawer($('#help'), $('#help-button'), setups);
  // Second set-ups inside an experiment's text.
  for (const b of $$('#help .setup-alt')) {
    b.addEventListener('click', () => {
      setups[b.dataset.alt]?.();
      if (window.matchMedia('(max-width: 900px)').matches) $('#help').classList.remove('open');
    });
  }

  // ---------------------------------------------------------------- start

  function fromAddress() {
    const r = radioAddress(location.hash);
    if (r) { location.replace(r); return; }
    const hash = readHash();
    if (setups[hash.setup]) setups[hash.setup]();
    else if (Object.keys(hash).some((k) => k !== 'setup' && k !== 'mode')) arraysFromHash(hash);
    else setups.start();
  }
  fromAddress();
  // An address typed or pasted while the page is open (the page itself rewrites the address
  // without this event firing).
  window.addEventListener('hashchange', fromAddress);

  window.__app = { setups, A, arrays: arraysApi, arraysChanged, radioAddress, ready: true };
}
