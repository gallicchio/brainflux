// Interferometers and coherence: a Michelson interferometer whose light you choose or draw, and
// Michelson's stellar interferometer.  This file switches between the two, keeps the set-up in
// the address, and holds the guided experiments.

import { $, segmented, drawer, readHash, writeHash } from '../lib/ui.js';
import * as M from './michelson-view.js';
import * as S from './stellar-view.js';
import { SOURCES, Spectrum, GRID, gaussianLine } from './spectrum.js';
import { visibility } from './stars.js';

const app = { mode: 'michelson' };

// --------------------------------------------------------------------- modes

const modeSeg = segmented([
  { value: 'michelson', label: 'Michelson', title: 'The Michelson interferometer and Fourier-transform spectroscopy' },
  { value: 'stellar', label: 'Stellar', title: 'Michelson\'s stellar interferometer: measuring a star' },
], app.mode, (m) => setMode(m), { label: 'Interferometer' });
$('#mode-box').append(modeSeg);

function setMode(m) {
  app.mode = m;
  modeSeg.value = m;
  $('#michelson').hidden = m !== 'michelson';
  $('#m-controls').hidden = m !== 'michelson';
  $('#stellar').hidden = m !== 'stellar';
  $('#s-controls').hidden = m !== 'stellar';
  if (m === 'michelson') M.invalidate(); else S.invalidate();
  saveHash();
}

// --------------------------------------------------------------------- the address

let hashTimer = 0;
function saveHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    if (app.mode === 'stellar') {
      const s = S.state;
      writeHash({ mode: 'stellar', kind: s.kind, th: s.theta, ld: s.limb || undefined, rho: s.kind === 'binary' ? s.rho : undefined,
        pa: s.kind === 'binary' ? s.pa : undefined, ratio: s.kind === 'binary' ? s.ratio : undefined, B: +s.B.toFixed(4), lam: s.lam, bw: s.bw || undefined,
        seeing: s.seeing ? 1 : undefined });
      return;
    }
    const m = M.state, p = m.params[m.source];
    writeHash({
      src: m.source === 'drawn' ? undefined : m.source,
      lam: m.source === 'gauss' ? p.lam : undefined, fwhm: m.source === 'gauss' ? p.fwhm : undefined, T: m.source === 'lamp' ? Math.round(p.T) : undefined,
      d: +(m.dc + m.df).toFixed(4), tilt: m.tilt || undefined, motor: m.motor, v: m.speed,
      plot: m.plot === 'fts' ? 'fts' : undefined, L: m.plot === 'fts' ? m.fts.L : undefined, step: m.plot === 'fts' ? m.fts.step : undefined,
      apo: m.fts.apodize ? 1 : undefined, axis: m.axis === 'lambda' ? 'lambda' : undefined,
      w0: +m.win[0].toPrecision(7), w1: +m.win[1].toPrecision(7), s0: +m.view[0].toPrecision(6), s1: +m.view[1].toPrecision(6),
    });
  }, 300);
}

// --------------------------------------------------------------------- set-ups

/** Set up the Michelson: source, mirror, motor, windows. */
function michelson(o = {}) {
  setMode('michelson');
  const m = M.state;
  M.setSource(o.source || 'hene', o.params);
  m.motor = o.motor ?? 'stop';
  m.speed = o.speed ?? 0.3;
  m.axis = o.axis || 'sigma';
  m.plot = o.plot || 'trace';
  m.fts.L = o.L ?? 50; m.fts.step = o.step ?? 0.1; m.fts.apodize = !!o.apodize;
  const d = o.d ?? 0;
  M.placeMirror(d, { tilt: o.tilt || 0 });
  const D = 2 * d, W = o.window ?? 15;
  m.win = o.win || [D - 0.2 * W, D + 0.8 * W];
  if (o.view) m.view = o.view.slice();
  else M.viewPreset('visible');
  if (o.viewPreset) M.viewPreset(o.viewPreset);
  M.syncControls();
  if (o.record) M.recordRange(o.record[0], o.record[1]);
  saveHash();
}

function stellar(o = {}) {
  setMode('stellar');
  S.configure({ kind: 'single', theta: 47, limb: 0, rho: 50, pa: 0, ratio: 0.8, B: 0.5, lam: 575, bw: 0, seeing: false, sweeping: true, ...o });
  saveHash();
}

const setups = {
  count: () => michelson({ source: 'hene', d: 250, motor: 'fwd', speed: 0.5, window: 16 }),
  tilt: () => michelson({ source: 'hene', d: 0, tilt: 150, window: 6 }),
  sodium: () => michelson({ source: 'sodium', d: 0, motor: 'fwd', speed: 60, win: [-60, 2440], viewPreset: 'fit' }),
  white: () => michelson({ source: 'white', d: -1.6, tilt: 200, motor: 'sweep', speed: 0.12, win: [-4, 4] }),
  coherence: () => michelson({ source: 'gauss', params: { lam: 550, fwhm: 10 }, d: -20, motor: 'sweep', speed: 3, win: [-45, 45] }),
  led: () => michelson({ source: 'led', d: -5, tilt: 120, motor: 'sweep', speed: 0.4, win: [-12, 12] }),
  draws: () => {
    michelson({ source: 'draw', d: 0, win: [-12, 12], record: [-12, 12] });
    // Something to start from: two bands, which the student draws over.
    const sp = M.getSpectrum();
    sp.prepareForDrawing();
    for (let i = 0; i < GRID.n; i++) {
      const s = GRID.s0 + i * GRID.ds;
      sp.cont.v[i] = Math.exp(-0.5 * ((s - 2.0) / 0.02) ** 2) + 0.8 * Math.exp(-0.5 * ((s - 1.67) / 0.02) ** 2);
    }
    M.useSpectrum(sp.update());
  },
  fts: () => { michelson({ source: 'mercury', d: 0, plot: 'fts', L: 60, step: 0.1 }); M.startScan(); },
  resolution: () => { michelson({ source: 'sodium', d: 0, plot: 'fts', L: 1200, step: 0.25, viewPreset: 'fit' }); M.startScan(); },
  aliasing: () => michelson({ source: 'hene', d: 0, plot: 'fts', L: 20, step: 0.4, view: [0, 3.2] }),
  drawi: () => michelson({ source: 'hene', d: 0, plot: 'fts', L: 10, step: 0.05, view: [0, 3.2] }),
  star: () => stellar({ theta: 20, lam: 550, B: 1, sweeping: true }),
  betelgeuse: () => stellar({ theta: 47, lam: 575, B: 0.5, sweeping: true }),
  binary: () => stellar({ kind: 'binary', theta: 6, rho: 50, pa: 0, ratio: 0.9, lam: 550, B: 0.2, sweeping: true }),
};

function target(id) {
  if (id === 'betelgeuse') setups.betelgeuse();
  else if (id === 'capella') setups.binary();
  else stellar({ theta: 0.93, lam: 550, B: 20, sweeping: true });
}

// --------------------------------------------------------------------- start

M.init({ onChange: saveHash });
S.init({ onChange: saveHash, target, kick: () => {} });
drawer($('#help'), $('#help-button'), setups);

function fromHash(h) {
  if (h.mode === 'stellar') {
    const n = (k, d) => (Number.isFinite(+h[k]) && h[k] !== undefined ? +h[k] : d);
    stellar({ kind: h.kind === 'binary' ? 'binary' : 'single', theta: n('th', 47), limb: n('ld', 0), rho: n('rho', 50), pa: n('pa', 0),
      ratio: n('ratio', 0.8), B: n('B', 0.5), lam: n('lam', 575), bw: n('bw', 0), seeing: h.seeing === '1', sweeping: false });
    return;
  }
  const num = (k) => (h[k] !== undefined && Number.isFinite(+h[k]) ? +h[k] : undefined);
  const src = SOURCES[h.src] && h.src !== 'draw' ? h.src : 'hene';
  const params = src === 'gauss' ? { lam: num('lam') ?? 550, fwhm: num('fwhm') ?? 10 } : src === 'lamp' ? { T: num('T') ?? 3000 } : undefined;
  michelson({
    source: src, params, d: num('d') ?? 500, tilt: num('tilt') ?? 0, motor: ['fwd', 'back', 'stop', 'sweep'].includes(h.motor) ? h.motor : 'fwd',
    speed: num('v') ?? 0.3, plot: h.plot === 'fts' ? 'fts' : 'trace', L: num('L') ?? 50, step: num('step') ?? 0.1, apodize: h.apo === '1',
    axis: h.axis === 'lambda' ? 'lambda' : 'sigma',
    win: num('w0') !== undefined && num('w1') > num('w0') ? [num('w0'), num('w1')] : undefined,
    view: num('s0') !== undefined && num('s1') > num('s0') ? [num('s0'), num('s1')] : undefined,
  });
}

const hash = readHash();
if (setups[hash.setup]) setups[hash.setup]();
else if (Object.keys(hash).length) fromHash(hash);
else michelson({ source: 'hene', d: 500, motor: 'fwd', speed: 0.3, window: 15 });

// --------------------------------------------------------------------- the loop

let last = 0;
function loop(now) {
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  if (app.mode === 'michelson') { M.tick(dt); M.frame(); } else { S.tick(dt); S.frame(); }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ' && app.mode === 'michelson') { e.preventDefault(); M.setMotor(M.state.motor === 'stop' ? 'fwd' : 'stop'); }
  if (e.key === ' ' && app.mode === 'stellar') { e.preventDefault(); S.setSweep(!S.state.sweeping); }
});

window.__app = {
  ready: true, setups, setMode,
  get mode() { return app.mode; },
  state: { michelson: M.state, stellar: S.state },
  M, S,
  spectrum: () => M.getSpectrum(),
  D: () => M.D(),
  intensity: (D) => M.getSpectrum().intensity(D),
  visibilityAt: (D) => M.getSpectrum().visibility(D),
  counter: () => M.getCounter(),
  record: () => M.getRecord(),
  fts: () => M.getFts(),
  recovered: (w) => M.recoveredSpectrum(w),
  starV: (B) => Math.hypot(...visibility(S.getModel(), B / (S.state.lam * 1e-9))),
  bandV: () => Math.hypot(...S.currentV()),
  firstNull: () => S.firstNullB(),
  Spectrum, gaussianLine,
};
