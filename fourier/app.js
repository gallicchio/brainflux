// Fourier series you can hear: one period of a wave, its harmonics, and the Web Audio API.

import { fft } from '../lib/fft.js';
import { colorOf } from '../lib/complexcolor.js';
import { el, $, slider, drawer, readHash, writeHash, setSlots } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors } from '../lib/plot.js';

const NMAX = 48;          // harmonics kept
const M = 512;            // samples per period

const state = {
  a: new Float64Array(NMAX + 1),   // cosine coefficients a_1 .. a_NMAX
  b: new Float64Array(NMAX + 1),   // sine coefficients
  terms: 15,
  f1: 220,
  volume: 0.4,
  drawn: null,                     // the samples drawn by hand, shown faintly
  preset: 'square',
};

// ------------------------------------------------------------------- the series

/** f(t) at M points of one period, from the first `terms` harmonics. */
function waveform(terms = state.terms) {
  const out = new Float64Array(M);
  for (let n = 1; n <= Math.min(terms, NMAX); n++) {
    const a = state.a[n], b = state.b[n];
    if (a === 0 && b === 0) continue;
    for (let j = 0; j < M; j++) {
      const ph = (2 * Math.PI * n * j) / M;
      out[j] += a * Math.cos(ph) + b * Math.sin(ph);
    }
  }
  return out;
}

/** The harmonics of a sampled period (the DC part is dropped: the ear doesn't hear it). */
function analyse(samples) {
  const re = Float64Array.from(samples), im = new Float64Array(M);
  fft(re, im);
  // f_j = sum c_n e^{2 pi i n j / M}; for a real f: a_n = 2 Re c_n, b_n = -2 Im c_n, c_n = F_n / M.
  for (let n = 1; n <= NMAX; n++) { state.a[n] = (2 * re[n]) / M; state.b[n] = (-2 * im[n]) / M; }
}

const PRESETS = {
  sine: { label: 'Sine', set: () => { state.b[1] = 1; } },
  square: { label: 'Square', set: () => { for (let n = 1; n <= NMAX; n += 2) state.b[n] = 4 / (Math.PI * n); } },
  triangle: { label: 'Triangle', set: () => { for (let n = 1; n <= NMAX; n += 2) state.b[n] = ((((n - 1) / 2) % 2 ? -1 : 1) * 8) / (Math.PI * Math.PI * n * n); } },
  saw: { label: 'Sawtooth', set: () => { for (let n = 1; n <= NMAX; n++) state.b[n] = ((n % 2 ? 1 : -1) * 2) / (Math.PI * n); } },
  pulse: { label: 'Pulses', set: () => { const d = 0.08; for (let n = 1; n <= NMAX; n++) state.a[n] = (2 / (Math.PI * n)) * Math.sin(Math.PI * n * d) * 2.5; } },
  missing: { label: 'No fundamental', set: () => { for (let n = 2; n <= 6; n++) state.a[n] = 0.5; } },
  flat: { label: 'Draw your own', set: () => { state.b[1] = 0.02; } },
};

function loadPreset(id) {
  state.a.fill(0); state.b.fill(0); state.drawn = null;
  PRESETS[id].set();
  state.preset = id;
  for (const [k, b] of Object.entries(presetButtons)) b.setAttribute('aria-pressed', String(k === id));
  changed();
  writeHash({ preset: id });
}

// ---------------------------------------------------------------------- sound

let audio = null;   // {ctx, osc, gain}

function startSound() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { $('#audio-note').textContent = 'This browser has no Web Audio.'; return; }
  const ctx = new AC();
  const osc = ctx.createOscillator(), gain = ctx.createGain(), comp = ctx.createDynamicsCompressor();
  osc.connect(gain); gain.connect(comp); comp.connect(ctx.destination);
  audio = { ctx, osc, gain };
  updateSound();
  osc.start();
  $('#play').textContent = 'Stop sound';
  $('#play').setAttribute('aria-pressed', 'true');
}

function stopSound() {
  if (!audio) return;
  audio.gain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.02);
  const a = audio;
  setTimeout(() => { a.osc.stop(); a.ctx.close(); }, 150);
  audio = null;
  $('#play').textContent = 'Play sound';
  $('#play').setAttribute('aria-pressed', 'false');
}

function updateSound() {
  if (!audio) return;
  const { ctx, osc, gain } = audio, N = Math.min(state.terms, NMAX);
  const real = new Float32Array(N + 1), imag = new Float32Array(N + 1);
  let power = 0;
  for (let n = 1; n <= N; n++) { real[n] = state.a[n]; imag[n] = state.b[n]; power += (state.a[n] ** 2 + state.b[n] ** 2) / 2; }
  // Equal loudness for equal amplitudes (so scrambling the phases doesn't change the volume):
  // scale by the r.m.s., not the peak; the compressor catches the odd peak.
  osc.setPeriodicWave(ctx.createPeriodicWave(real, imag, { disableNormalization: true }));
  osc.frequency.setTargetAtTime(state.f1, ctx.currentTime, 0.01);
  gain.gain.setTargetAtTime(power > 0 ? (0.25 * state.volume) / Math.sqrt(power) : 0, ctx.currentTime, 0.02);
}

// --------------------------------------------------------------------- drawing

const waveCanvas = $('#wave'), specCanvas = $('#spectrum');
let waveFrame = null, specFrame = null, range = 1.5;

function changed() { draw(); updateSound(); }

function draw() {
  drawWave();
  drawSpectrum();
}

function drawWave() {
  const { ctx, width, height } = fitCanvas(waveCanvas);
  const c = themeColors();
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 46, right: 12, top: 10, bottom: 34 });
  waveFrame = f;
  const w = waveform();
  let peak = 0;
  for (const v of w) peak = Math.max(peak, Math.abs(v));
  if (state.drawn) for (const v of state.drawn) peak = Math.max(peak, Math.abs(v));
  // The vertical range only grows while drawing, so the pen doesn't chase it.
  if (!drawing) range = Math.max(1, peak * 1.15);
  f.x0 = 0; f.x1 = 1; f.y0 = -range; f.y1 = range;
  f.clip();
  ctx.strokeStyle = c.line; ctx.beginPath(); ctx.moveTo(f.left, f.Y(0)); ctx.lineTo(f.right, f.Y(0)); ctx.stroke();
  if (state.drawn) {
    ctx.strokeStyle = c.ink3; ctx.lineWidth = 4; ctx.globalAlpha = 0.35;
    ctx.beginPath();
    state.drawn.forEach((v, j) => { const x = f.X(j / M), y = f.Y(v); if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = c.accent; ctx.lineWidth = 2.2;
  ctx.beginPath();
  for (let j = 0; j <= M; j++) { const x = f.X(j / M), y = f.Y(w[j % M]); if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.stroke();
  ctx.restore();
  // The period in a slot of its own, and the count of harmonics: nothing moves as they change.
  f.axes({ xlabel: ['t / T  (one period, T = 1/f₁ = ', { v: 1000 / state.f1, dec: 2, w: 5 }, ' ms)'] });
  setSlots($('#wave-note'), ['drawn with the first ', { v: state.terms, dec: 0, w: 2 }, ` harmonic${state.terms > 1 ? 's' : ''}; draw on it`]);
}

function drawSpectrum() {
  const { ctx, width, height } = fitCanvas(specCanvas);
  const c = themeColors();
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 46, right: 12, top: 10, bottom: 34 });
  specFrame = f;
  const shown = Math.max(16, Math.min(NMAX, state.terms + 8));
  let top = 0;
  for (let n = 1; n <= NMAX; n++) top = Math.max(top, Math.hypot(state.a[n], state.b[n]));
  f.x0 = 0.5; f.x1 = shown + 0.5; f.y0 = 0; f.y1 = Math.max(0.2, top * 1.15);
  const bw = Math.max(2, (f.w / shown) * 0.7);
  for (let n = 1; n <= shown; n++) {
    const a = state.a[n], b = state.b[n], A = Math.hypot(a, b), x = f.X(n);
    // The colour of the complex amplitude a + i b: the phase.
    ctx.fillStyle = A > 1e-9 ? `rgb(${colorOf(a, b, A).join(',')})` : c.line;
    ctx.globalAlpha = n <= state.terms ? 1 : 0.25;
    ctx.fillRect(x - bw / 2, f.Y(A), bw, f.Y(0) - f.Y(A));
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = c.ink2; ctx.setLineDash([4, 3]);
  const xt = f.X(state.terms + 0.5);
  ctx.beginPath(); ctx.moveTo(xt, f.top); ctx.lineTo(xt, f.bottom); ctx.stroke(); ctx.setLineDash([]);
  f.axes({ xlabel: 'harmonic n  (frequency n f₁)', ylabel: 'amplitude' });
}

// ---------------------------------------------------------------------- drawing by hand

let drawing = false, lastJ = -1;
waveCanvas.addEventListener('pointerdown', (e) => {
  waveCanvas.setPointerCapture(e.pointerId);
  drawing = true;
  state.drawn = waveform(NMAX);
  state.preset = 'drawn';
  for (const b of Object.values(presetButtons)) b.setAttribute('aria-pressed', 'false');
  lastJ = -1;
  drawAt(e);
});
waveCanvas.addEventListener('pointermove', (e) => { if (drawing) drawAt(e); });
const endDraw = () => { if (!drawing) return; drawing = false; changed(); };
waveCanvas.addEventListener('pointerup', endDraw);
waveCanvas.addEventListener('pointercancel', endDraw);

function drawAt(e) {
  const r = waveCanvas.getBoundingClientRect(), f = waveFrame;
  const j = Math.max(0, Math.min(M - 1, Math.round(f.invX(e.clientX - r.left) * M)));
  const v = Math.max(-range, Math.min(range, f.invY(e.clientY - r.top)));
  // Fill in between pointer events, so a quick stroke leaves no gaps.
  const from = lastJ < 0 ? j : lastJ, v0 = lastJ < 0 ? v : state.drawn[lastJ];
  const lo = Math.min(from, j), hi = Math.max(from, j);
  for (let k = lo; k <= hi; k++) state.drawn[k] = hi === lo ? v : v0 + ((v - v0) * (k - from)) / (j - from);
  lastJ = j;
  analyse(state.drawn);
  requestAnimationFrame(changed);
}

// Dragging a bar sets that harmonic's amplitude, keeping its phase.
let dragN = 0;
specCanvas.addEventListener('pointerdown', (e) => {
  specCanvas.setPointerCapture(e.pointerId);
  const r = specCanvas.getBoundingClientRect();
  dragN = Math.round(specFrame.invX(e.clientX - r.left));
  if (dragN < 1 || dragN > NMAX) { dragN = 0; return; }
  setAmp(e);
});
specCanvas.addEventListener('pointermove', (e) => { if (dragN) setAmp(e); });
specCanvas.addEventListener('pointerup', () => { dragN = 0; });
function setAmp(e) {
  const r = specCanvas.getBoundingClientRect();
  const A = Math.max(0, specFrame.invY(e.clientY - r.top)), n = dragN;
  const old = Math.hypot(state.a[n], state.b[n]);
  if (old > 1e-9) { state.a[n] *= A / old; state.b[n] *= A / old; } else { state.a[n] = 0; state.b[n] = A; }
  if (n > state.terms) { state.terms = n; termsSlider.value = n; }
  state.drawn = null;
  changed();
}

// ---------------------------------------------------------------------- controls

$('#play').addEventListener('click', () => (audio ? stopSound() : startSound()));
$('#audio-note').textContent = 'Browsers start sound only after a click.  Headphones, low volume.';
const f1Slider = slider({ label: 'f₁ (Hz)', min: 55, max: 880, log: true, value: state.f1, title: 'The fundamental frequency (220 Hz is the A below middle C)',
  onInput: (v) => { state.f1 = v; changed(); } });
const volSlider = slider({ label: 'volume', min: 0, max: 1, value: state.volume, onInput: (v) => { state.volume = v; updateSound(); } });
$('#sound-box').append(f1Slider, volSlider);

const presetButtons = {};
for (const [id, p] of Object.entries(PRESETS)) {
  const b = el('button', { type: 'button', 'aria-pressed': 'false', onclick: () => loadPreset(id) }, p.label);
  $('#presets').append(b);
  presetButtons[id] = b;
}
const termsSlider = slider({ label: 'terms', min: 1, max: NMAX, step: 1, value: state.terms, title: 'How many harmonics to add up (and to play)',
  onInput: (v) => { state.terms = Math.round(v); changed(); } });
$('#terms-box').append(termsSlider);
$('#scramble').addEventListener('click', () => {
  for (let n = 1; n <= NMAX; n++) {
    const A = Math.hypot(state.a[n], state.b[n]), p = Math.random() * 2 * Math.PI;
    state.a[n] = A * Math.cos(p); state.b[n] = A * Math.sin(p);
  }
  state.drawn = null; changed();
});
$('#zero-phase').addEventListener('click', () => {
  for (let n = 1; n <= NMAX; n++) { state.a[n] = Math.hypot(state.a[n], state.b[n]); state.b[n] = 0; }
  state.drawn = null; changed();
});
$('#lowpass').addEventListener('click', () => { state.terms = Math.max(1, Math.floor(state.terms / 2)); termsSlider.value = state.terms; changed(); });

window.addEventListener('resize', draw);

// ---------------------------------------------------------------------- experiments

function go(id, { terms = 15, f1 = 220 } = {}) {
  state.terms = terms; termsSlider.value = terms;
  state.f1 = f1; f1Slider.value = f1;
  loadPreset(id);
}
const setups = {
  square: () => go('square', { terms: 5 }),
  phases: () => go('saw', { terms: 20 }),
  saw: () => go('saw', { terms: 30 }),
  draw: () => go('flat', { terms: 30 }),
  pulse: () => go('pulse', { terms: 40 }),
  missing: () => go('missing', { terms: 6, f1: 150 }),
};
drawer($('#help'), $('#help-button'), setups);

const hash = readHash();
if (setups[hash.setup]) setups[hash.setup]();
else loadPreset(PRESETS[hash.preset] ? hash.preset : 'square');

window.__app = { state, setups, waveform, analyse, ready: true };
