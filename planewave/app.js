// Plane waves: one, two, or a packet of them.

import { fft, ifft, wavenumbers } from '../lib/fft.js';
import { colorize, colorOf } from '../lib/complexcolor.js';
import { texToMathML } from '../lib/mathml.js';
import { parse } from '../lib/expr.js';
import { el, $, slider, segmented, toggle, exprField, drawer, readHash, writeHash, fmt } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors } from '../lib/plot.js';

// The four ways of writing a plane wave: phase = s (k.r) + w omega t.
const CONVENTIONS = [
  { tex: 'e^{i(\\vec k\\cdot\\vec r-\\omega t)}', s: 1, w: -1, note: 'travels along k (physics)' },
  { tex: 'e^{i(\\vec k\\cdot\\vec r+\\omega t)}', s: 1, w: 1, note: 'travels against k' },
  { tex: 'e^{-i(\\vec k\\cdot\\vec r-\\omega t)}', s: -1, w: 1, note: 'travels along k (engineering, j = −i)' },
  { tex: 'e^{-i(\\vec k\\cdot\\vec r+\\omega t)}', s: -1, w: -1, note: 'travels against k' },
];

const DISPERSIONS = {
  light: { label: 'Light', omega: 'c k', params: { c: 1 }, k0: 1.5, dk: 0.2 },
  schrodinger: { label: 'Schrödinger', omega: 'k^2/2', params: {}, k0: 1.5, dk: 0.2 },
  water: { label: 'Deep water', omega: 'sqrt(g k)', params: { g: 4 }, k0: 1.5, dk: 0.2 },
  relativistic: { label: 'Relativistic', omega: 'sqrt(k^2 + mu^2)', params: { mu: 1.5 }, k0: 1.5, dk: 0.2 },
  typed: { label: 'Typed', omega: 'k + 0.1 k^3', params: {}, k0: 1.5, dk: 0.2 },
};

const X = 8;            // the 2D view shows -X..X in x and y
const KVIEW = 3.2;      // the arrow's tip at the edge of the view means |k| = KVIEW

const state = {
  mode: 'one',
  conv: 0,
  k1: [1.2, 0.5], A1: 1, phi1: 0, omega: 1.5,
  k2: [-1.2, -0.5], A2: 1, phi2: 0, c: 1,
  display: 'complex',
  show: { tracker: true, phasor: true },
  running: true, speed: 1, t: 0,
  disp: 'schrodinger', k0: 1.5, dk: 0.2,
};
let omegaExpr = null, omegaParams = {};

// --------------------------------------------------------------------- 2D waves

const waveCanvas = $('#wave');
let off = null, offImg = null;
const RES = 300;

function omegaOf(k, which) {
  if (state.mode === 'one') return state.omega;
  return state.c * Math.hypot(k[0], k[1]);
}

function phaseAt(x, y, k, omega, phi, t) {
  const cv = CONVENTIONS[state.conv];
  return cv.s * (k[0] * x + k[1] * y) + cv.w * omega * t + phi;
}

function drawWave() {
  const { ctx, width, height } = fitCanvas(waveCanvas);
  if (!off) { off = document.createElement('canvas'); off.width = off.height = RES; offImg = off.getContext('2d').createImageData(RES, RES); }
  const t = state.t, cv = CONVENTIONS[state.conv];
  const waves = [[state.k1, state.A1, state.phi1, omegaOf(state.k1, 1)]];
  if (state.mode === 'two') waves.push([state.k2, state.A2, state.phi2, omegaOf(state.k2, 2)]);
  // The wave on a RES x RES grid; e^{i s k.r} = e^{i s kx x} e^{i s ky y}: one row and one
  // column of phases per wave, then a complex product per pixel.
  const re = new Float64Array(RES * RES), im = new Float64Array(RES * RES);
  for (const [k, A, phi, omega] of waves) {
    const cx = new Float64Array(RES), sx = new Float64Array(RES), cy = new Float64Array(RES), sy = new Float64Array(RES);
    const ph0 = cv.w * omega * t + phi;
    for (let i = 0; i < RES; i++) {
      const x = -X + ((i + 0.5) * 2 * X) / RES, y = X - ((i + 0.5) * 2 * X) / RES;
      cx[i] = Math.cos(cv.s * k[0] * x + ph0); sx[i] = Math.sin(cv.s * k[0] * x + ph0);
      cy[i] = Math.cos(cv.s * k[1] * y); sy[i] = Math.sin(cv.s * k[1] * y);
    }
    for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
      const o = j * RES + i;
      re[o] += A * (cx[i] * cy[j] - sx[i] * sy[j]);
      im[o] += A * (cx[i] * sy[j] + sx[i] * cy[j]);
    }
  }
  if (state.display === 'real') {
    const top = waves.reduce((s, w) => s + w[1], 0) || 1;
    for (let o = 0; o < RES * RES; o++) {
      const g = Math.round(127.5 + 127.5 * (re[o] / top));
      offImg.data[4 * o] = offImg.data[4 * o + 1] = offImg.data[4 * o + 2] = g; offImg.data[4 * o + 3] = 255;
    }
  } else colorize(re, im, offImg.data, waves.length === 1 ? Math.max(state.A1, 1e-6) : 1.2, 'complex');
  off.getContext('2d').putImageData(offImg, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, 0, 0, width, height);

  // The wavevector arrows, from the centre.
  const cx0 = width / 2, cy0 = height / 2, scale = (width / 2) / KVIEW;
  arrowTips = [];
  const drawArrow = (k, label, color) => {
    const tx = cx0 + k[0] * scale, ty = cy0 - k[1] * scale;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 6; line(ctx, cx0, cy0, tx, ty);
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; line(ctx, cx0, cy0, tx, ty);
    const a = Math.atan2(ty - cy0, tx - cx0);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(tx, ty);
    ctx.lineTo(tx - 13 * Math.cos(a - 0.4), ty - 13 * Math.sin(a - 0.4));
    ctx.lineTo(tx - 13 * Math.cos(a + 0.4), ty - 13 * Math.sin(a + 0.4));
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(tx, ty, 9, 0, 2 * Math.PI); ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.font = 'italic 15px "Times New Roman", serif'; ctx.fillStyle = color;
    ctx.fillText(label, tx + 12, ty - 8);
    arrowTips.push([tx, ty]);
  };
  drawArrow(state.k1, 'k₁', '#ffffff');
  if (state.mode === 'two') drawArrow(state.k2, 'k₂', '#ffe08a');

  // A crest tracker: a dot riding one crest of wave 1, moving at the phase velocity.
  if (state.show.tracker && state.mode === 'one') {
    const k = state.k1, kk = Math.hypot(k[0], k[1]);
    if (kk > 1e-3) {
      const vp = (-cv.w / cv.s) * (state.omega / kk);          // along k-hat
      // The crest nearest the centre at t = 0, then carried along and wrapped across the view.
      const r0 = -state.phi1 / (cv.s * kk);
      // Wrap across the view by a whole number of wavelengths, so the dot stays on a crest.
      const lam = (2 * Math.PI) / kk, span = lam * Math.max(1, Math.round((2 * X * 1.2) / lam));
      let r = r0 + vp * t;
      r = ((((r + span / 2) % span) + span) % span) - span / 2;
      const px = cx0 + ((r * k[0]) / kk) * (width / (2 * X)), py = cy0 - ((r * k[1]) / kk) * (width / (2 * X));
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 6, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    }
  }
  // The phasor: psi at the centre, in the complex plane.
  if (state.show.phasor) {
    const R = 44, ox = 14 + R, oy = height - 14 - R;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(ox, oy, R + 8, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(ox, oy, R, 0, 2 * Math.PI); ctx.moveTo(ox - R, oy); ctx.lineTo(ox + R, oy); ctx.moveTo(ox, oy - R); ctx.lineTo(ox, oy + R); ctx.stroke();
    let zr = 0, zi = 0, amax = 0;
    for (const [k, A, phi, omega] of waves) {
      const p = phaseAt(0, 0, k, omega, phi, t);
      zr += A * Math.cos(p); zi += A * Math.sin(p); amax += A;
    }
    const s = R / Math.max(amax, 1e-6);
    ctx.strokeStyle = `rgb(${colorOf(zr, zi, 1).join(',')})`; ctx.lineWidth = 3;
    line(ctx, ox, oy, ox + zr * s, oy - zi * s);
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('ψ(0, t)', ox - 18, oy - R - 12);
  }
}

function line(ctx, x0, y0, x1, y1) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }

let arrowTips = [], dragging = -1;
waveCanvas.addEventListener('pointerdown', (e) => {
  const r = waveCanvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  // Grab the nearest arrow tip (or, with one wave, set k wherever you press).
  let best = -1, bd = Infinity;
  arrowTips.forEach(([x, y], i) => { const d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = i; } });
  if (state.mode === 'two' && bd > 40) return;
  dragging = best < 0 ? 0 : best;
  waveCanvas.setPointerCapture(e.pointerId);
  setK(px, py, r);
});
waveCanvas.addEventListener('pointermove', (e) => {
  if (dragging < 0) return;
  setK(e.clientX - waveCanvas.getBoundingClientRect().left, e.clientY - waveCanvas.getBoundingClientRect().top, waveCanvas.getBoundingClientRect());
});
const stopDrag = () => { dragging = -1; };
waveCanvas.addEventListener('pointerup', stopDrag);
waveCanvas.addEventListener('pointercancel', stopDrag);
function setK(px, py, r) {
  const scale = (r.width / 2) / KVIEW;
  let kx = (px - r.width / 2) / scale, ky = (r.height / 2 - py) / scale;
  const kk = Math.hypot(kx, ky);
  if (kk > KVIEW) { kx *= KVIEW / kk; ky *= KVIEW / kk; }
  if (dragging === 1) state.k2 = [kx, ky]; else state.k1 = [kx, ky];
  kick();
}

// --------------------------------------------------------------------- packets

const NP = 2048, LP = 256;
const kgrid = wavenumbers(NP, LP / NP);
let packetData = null;

function omegaFn() {
  return (k) => {
    const v = omegaExpr.evaluate({ k, ...omegaParams }, k.length);
    return v.re;
  };
}

function preparePacket() {
  // psi~(k) = exp(-(k - k0)^2 / (4 dk^2)), centred at x = 0, each k with omega(|k|):
  // exp(i(kx - omega t)) with k < 0 goes left, as it should.  Where omega(k) is not finite
  // (1/k at k = 0, say) that wave is left out: such k carry no weight in the packet anyway.
  const kabs = Float64Array.from(kgrid, Math.abs);
  const w = omegaFn()(kabs);
  for (let i = 0; i < w.length; i++) if (!Number.isFinite(w[i])) w[i] = NaN;
  packetData = { w, amp: Float64Array.from(kgrid, (k) => Math.exp(-((k - state.k0) ** 2) / (4 * state.dk ** 2))) };
}

function packetAt(t) {
  const re = new Float64Array(NP), im = new Float64Array(NP), { w, amp } = packetData;
  for (let i = 0; i < NP; i++) {
    if (Number.isNaN(w[i])) continue;
    const ph = -w[i] * t;
    re[i] = amp[i] * Math.cos(ph); im[i] = amp[i] * Math.sin(ph);
  }
  ifft(re, im);
  // Peak 1 at t = 0: sum amp over the grid.
  let s = 0;
  for (let i = 0; i < NP; i++) s += amp[i];
  for (let i = 0; i < NP; i++) { re[i] *= NP / s; im[i] *= NP / s; }
  return { re, im };
}

function velocities() {
  const f = omegaFn(), k0 = state.k0, h = 1e-4 * (1 + Math.abs(k0));
  const [w0, wp, wm] = f(Float64Array.from([k0, k0 + h, k0 - h]));
  const vg = (wp - wm) / (2 * h);
  return { w0, vp: w0 / k0, vg: Number.isFinite(vg) ? vg : 0 };
}

const VIEW = [-10, 70];

function drawPacket() {
  const cv = $('#packet');
  const { ctx, width, height } = fitCanvas(cv);
  const c = themeColors();
  ctx.clearRect(0, 0, width, height);
  if (!packetData) preparePacket();
  const { vp, vg } = velocities();
  // Loop: when the group has crossed the view, start again.
  if (vg * state.t > VIEW[1] - 5 || vg * state.t < VIEW[0] - 20) state.t = 0;
  const { re, im } = packetAt(state.t);
  const f = new Frame(ctx, width, height, { left: 40, right: 12, top: 12, bottom: 32 });
  f.x0 = VIEW[0]; f.x1 = VIEW[1]; f.y0 = -1.15; f.y1 = 1.15;
  const dx = LP / NP;
  const val = (x) => { const i = (((Math.round(x / dx)) % NP) + NP) % NP; return [re[i], im[i]]; };
  f.clip();
  // |psi| filled with the phase colour, mirrored, and Re psi on top.
  for (let px = 0; px < f.w; px++) {
    const [a, b] = val(f.invX(f.left + px + 0.5)), m = Math.hypot(a, b);
    if (m < 2e-3) continue;
    ctx.fillStyle = `rgb(${colorOf(a, b, m || 1).join(',')})`;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(f.left + px, f.Y(m), 1, f.Y(-m) - f.Y(m));
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = c.ink; ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let px = 0; px <= f.w; px++) {
    const [a] = val(f.invX(f.left + px)), y = f.Y(a);
    if (px === 0) ctx.moveTo(f.left, y); else ctx.lineTo(f.left + px, y);
  }
  ctx.stroke();
  // Markers: a crest (phase velocity) and the group (group velocity).
  const t = state.t;
  if (state.show.tracker) {
    const xg = vg * t;
    ctx.fillStyle = c.accent;
    ctx.beginPath(); ctx.moveTo(f.X(xg), f.bottom - 12); ctx.lineTo(f.X(xg) - 8, f.bottom); ctx.lineTo(f.X(xg) + 8, f.bottom); ctx.closePath(); ctx.fill();
    // The crest at x = 0 at t = 0, carried at vp, shifted by whole wavelengths to stay near the packet.
    const lam = (2 * Math.PI) / state.k0;
    let xc = vp * t;
    xc += lam * Math.round((xg - xc) / lam);
    ctx.fillStyle = c.warn; ctx.strokeStyle = c.panel; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(f.X(xc), f.Y(val(xc)[0]), 6, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
  f.axes({ xlabel: 'x', ylabel: 'Re ψ and |ψ|' });
}

function drawDispersion() {
  const cv = $('#dispersion');
  const { ctx, width, height } = fitCanvas(cv);
  const c = themeColors();
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 44, right: 12, top: 12, bottom: 32 });
  const kmax = Math.max(3, 2 * state.k0), ks = Float64Array.from({ length: 200 }, (_, i) => (kmax * i) / 199);
  const ws = omegaFn()(ks);
  const { w0, vp, vg } = velocities();
  let wmax = 0;
  for (const w of ws) if (Number.isFinite(w)) wmax = Math.max(wmax, w);
  f.x0 = 0; f.x1 = kmax; f.y0 = 0; f.y1 = Math.max(1, wmax * 1.05);
  f.clip();
  ctx.strokeStyle = c.ink; ctx.lineWidth = 2;
  ctx.beginPath();
  ks.forEach((k, i) => { const y = f.Y(ws[i]); if (i === 0) ctx.moveTo(f.X(k), y); else ctx.lineTo(f.X(k), y); });
  ctx.stroke();
  // Phase velocity: the line from the origin to (k0, w0).  Group velocity: the tangent there.
  ctx.strokeStyle = c.warn; ctx.lineWidth = 1.6; ctx.setLineDash([6, 4]);
  line(ctx, f.X(0), f.Y(0), f.X(kmax), f.Y(vp * kmax));
  ctx.strokeStyle = c.accent;
  line(ctx, f.X(0), f.Y(w0 - vg * state.k0), f.X(kmax), f.Y(w0 + vg * (kmax - state.k0)));
  ctx.setLineDash([]);
  ctx.fillStyle = c.ink; ctx.beginPath(); ctx.arc(f.X(state.k0), f.Y(w0), 5, 0, 2 * Math.PI); ctx.fill();
  ctx.restore();
  f.axes({ xlabel: 'k', ylabel: 'ω' });
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = c.warn; ctx.fillText(`phase velocity ω/k = ${fmt(vp, 3)}`, f.left + 8, f.top + 14);
  ctx.fillStyle = c.accent; ctx.fillText(`group velocity dω/dk = ${fmt(vg, 3)}`, f.left + 8, f.top + 30);
}

// --------------------------------------------------------------------- formula line

function updateFormula() {
  const box = $('#formula');
  if (state.mode === 'packet') {
    const { vp, vg } = velocities();
    box.innerHTML = `${texToMathML('\\psi(x,t)=\\int dk\\,\\tilde\\psi(k)\\,e^{i(kx-\\omega(k)t)}')} &nbsp; `
      + `<span class="small">red dot: a crest, at ${fmt(vp, 3)}; blue triangle: the group, at ${fmt(vg, 3)}</span>`;
    return;
  }
  const cv = CONVENTIONS[state.conv], k = state.k1, kk = Math.hypot(k[0], k[1]);
  const lam = kk > 1e-6 ? (2 * Math.PI) / kk : Infinity;
  const omega = omegaOf(k, 1);
  box.innerHTML = `${texToMathML('\\psi=A\\,' + cv.tex)} &nbsp; <span class="small">|k| = ${fmt(kk, 3)}, λ = 2π/|k| = ${fmt(lam, 3)},
    ω = ${fmt(omega, 3)}, crests move at ω/|k| = ${fmt(kk > 0 ? omega / kk : 0, 3)}, ${cv.note}</span>`;
}

// --------------------------------------------------------------------- loop

let raf = 0, last = 0;
function loop(now) {
  raf = 0;
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
  last = now;
  if (state.running) state.t += dt * state.speed;
  if (state.mode === 'packet') { drawPacket(); drawDispersion(); } else drawWave();
  updateFormula();
  if (state.running) raf = requestAnimationFrame(loop); else last = 0;
}
function kick() { if (!raf) raf = requestAnimationFrame(loop); }

// --------------------------------------------------------------------- controls

const modeSeg = segmented([
  { value: 'one', label: 'One wave' }, { value: 'two', label: 'Two waves' }, { value: 'packet', label: 'A packet: dispersion' },
], state.mode, (m) => setMode(m), { label: 'Mode' });
$('#mode-row').append(modeSeg);

function setMode(m) {
  state.mode = m; modeSeg.value = m;
  $('#wave-wrap').hidden = m === 'packet';
  $('#packet-wrap').hidden = m !== 'packet';
  $('#wave-panel').hidden = m === 'packet';
  $('#two-panel').hidden = m !== 'two';
  $('#packet-panel').hidden = m !== 'packet';
  omegaSlider.hidden = m !== 'one';
  cSlider.hidden = m !== 'two';
  state.t = 0;
  writeHash({ mode: m === 'one' ? undefined : m });
  kick();
}

$('#play').addEventListener('click', () => { state.running = !state.running; $('#play').textContent = state.running ? 'Pause' : 'Play'; kick(); });
$('#reset').addEventListener('click', () => { state.t = 0; kick(); });
const speedSlider = slider({ label: 'Speed', min: 0.05, max: 5, log: true, value: state.speed, onInput: (v) => { state.speed = v; } });
$('#speed-box').append(speedSlider);

const convButtons = CONVENTIONS.map((cv, i) => {
  const b = el('button', { type: 'button', 'aria-pressed': String(i === state.conv), title: cv.note });
  b.innerHTML = texToMathML(cv.tex);
  b.addEventListener('click', () => setConvention(i));
  $('#convention').append(b);
  return b;
});
function setConvention(i) { state.conv = i; convButtons.forEach((b, j) => b.setAttribute('aria-pressed', String(j === i))); kick(); }

const omegaSlider = slider({ label: '<math><mi>ω</mi></math>', labelHTML: true, min: 0, max: 5, value: state.omega, title: 'The angular frequency', onInput: (v) => { state.omega = v; kick(); } });
const cSlider = slider({ label: '<math><mi>c</mi></math>', labelHTML: true, min: 0, max: 3, value: state.c, title: 'Both waves have ω = c|k| (like light)', onInput: (v) => { state.c = v; kick(); } });
const a1Slider = slider({ label: '<math><mo>|</mo><msub><mi>A</mi><mn>1</mn></msub><mo>|</mo></math>', labelHTML: true, min: 0, max: 2, value: state.A1, onInput: (v) => { state.A1 = v; kick(); } });
const p1Slider = slider({ label: '<math><mi>arg</mi><msub><mi>A</mi><mn>1</mn></msub></math>', labelHTML: true, min: -Math.PI, max: Math.PI, value: 0, title: 'The phase of the amplitude: shifts every crest', onInput: (v) => { state.phi1 = v; kick(); } });
$('#wave-box').append(omegaSlider, cSlider, a1Slider, p1Slider);
cSlider.hidden = true;

const a2Slider = slider({ label: '<math><mo>|</mo><msub><mi>A</mi><mn>2</mn></msub><mo>|</mo></math>', labelHTML: true, min: 0, max: 2, value: state.A2, onInput: (v) => { state.A2 = v; kick(); } });
const p2Slider = slider({ label: '<math><mi>arg</mi><msub><mi>A</mi><mn>2</mn></msub></math>', labelHTML: true, min: -Math.PI, max: Math.PI, value: 0, onInput: (v) => { state.phi2 = v; kick(); } });
$('#two-box').append(a2Slider, p2Slider, el('div', { class: 'small muted' }, 'Drag either arrow to change its wavevector.'));
const twoPresets = {
  Standing: () => { state.k2 = [-state.k1[0], -state.k1[1]]; },
  Crossed: () => { const a = Math.PI / 3, [x, y] = state.k1; state.k2 = [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]; },
  Beats: () => { state.k2 = [state.k1[0] * 1.45, state.k1[1] * 1.45]; },
};
for (const [label, f] of Object.entries(twoPresets)) $('#two-presets').append(el('button', { type: 'button', onclick: () => { f(); kick(); } }, label));

// Packets.
const dispButtons = {};
for (const [id, d] of Object.entries(DISPERSIONS)) {
  const b = el('button', { type: 'button', 'aria-pressed': 'false', onclick: () => setDispersion(id) }, d.label);
  $('#dispersions').append(b);
  dispButtons[id] = b;
}
const omegaField = exprField({
  label: '<math><mi>ω</mi><mo>(</mo><mi>k</mi><mo>)</mo><mo>=</mo></math>', value: DISPERSIONS.schrodinger.omega, variables: ['k'],
  hints: { c: { min: 0, max: 3, value: 1 }, g: { min: 0.5, max: 10, value: 4 }, mu: { min: 0, max: 3, value: 1.5 } },
  onChange: (expr, params) => {
    omegaExpr = expr; omegaParams = params; packetData = null; state.t = 0;
    for (const [k, b] of Object.entries(dispButtons)) b.setAttribute('aria-pressed', String(DISPERSIONS[k].omega === expr.source && k === state.disp));
    kick();
  },
});
$('#omega-field').append(omegaField);
const k0Slider = slider({ label: '<math><msub><mi>k</mi><mn>0</mn></msub></math>', labelHTML: true, min: 0.3, max: 4, value: state.k0, onInput: (v) => { state.k0 = v; packetData = null; state.t = 0; kick(); } });
const dkSlider = slider({ label: '<math><mi>Δk</mi></math>', labelHTML: true, min: 0.05, max: 0.8, value: state.dk, title: 'The spread of wavenumbers: a wider spread makes a shorter packet', onInput: (v) => { state.dk = v; packetData = null; state.t = 0; kick(); } });
$('#packet-box').append(k0Slider, dkSlider);

function setDispersion(id) {
  const d = DISPERSIONS[id];
  state.disp = id;
  for (const [k, b] of Object.entries(dispButtons)) b.setAttribute('aria-pressed', String(k === id));
  omegaField.set(d.omega, d.params, false);
  omegaExpr = omegaField.expr; omegaParams = omegaField.params;
  state.k0 = d.k0; state.dk = d.dk; k0Slider.value = d.k0; dkSlider.value = d.dk;
  packetData = null; state.t = 0;
  kick();
}

const showToggles = {
  tracker: toggle('Markers', state.show.tracker, (on) => { state.show.tracker = on; kick(); }, 'A dot riding a crest (and, for packets, a triangle marking the group)'),
  phasor: toggle('Phasor', state.show.phasor, (on) => { state.show.phasor = on; kick(); }, 'ψ at the centre, in the complex plane'),
};
const displaySeg = segmented([{ value: 'complex', label: 'Phase colours' }, { value: 'real', label: 'Real part' }], state.display,
  (v) => { state.display = v; kick(); }, { label: 'Colours' });
$('#shows').append(...Object.values(showToggles), displaySeg);

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ') { e.preventDefault(); $('#play').click(); }
});
window.addEventListener('resize', kick);

// --------------------------------------------------------------------- experiments

function resume() {
  state.running = true; $('#play').textContent = 'Pause';
  for (const [k, t] of Object.entries(showToggles)) { t.on = true; state.show[k] = true; }
}
function reset2D(mode, { conv = 0, display = 'complex', k1 = [1.2, 0.5], omega = 1.5, speed = 1 } = {}) {
  setMode(mode);
  state.c = 1; cSlider.value = 1;
  setConvention(conv);
  state.display = display; displaySeg.value = display;
  state.k1 = k1; state.omega = omega; omegaSlider.value = omega;
  state.A1 = 1; a1Slider.value = 1; state.phi1 = 0; p1Slider.value = 0;
  state.A2 = 1; a2Slider.value = 1; state.phi2 = 0; p2Slider.value = 0;
  state.speed = speed; speedSlider.value = speed;
  state.running = true; $('#play').textContent = 'Pause';
  for (const [k, t] of Object.entries(showToggles)) { t.on = true; state.show[k] = true; }
}
const setups = {
  direction: () => reset2D('one'),
  phasor: () => reset2D('one', { k1: [0.8, 0], omega: 2 }),
  real: () => reset2D('one', { display: 'real' }),
  standing: () => { reset2D('two', { k1: [1.5, 0] }); twoPresets.Standing(); },
  crossed: () => { reset2D('two', { k1: [1.5, 0.4] }); twoPresets.Crossed(); },
  beats: () => { reset2D('two', { k1: [1.2, 0], speed: 1 }); twoPresets.Beats(); },
  schrodinger: () => { setMode('packet'); setDispersion('schrodinger'); resume(); },
  water: () => { setMode('packet'); setDispersion('water'); resume(); },
  light: () => { setMode('packet'); setDispersion('light'); resume(); },
  relativistic: () => { setMode('packet'); setDispersion('relativistic'); resume(); },
};
drawer($('#help'), $('#help-button'), setups);

// --------------------------------------------------------------------- start

setDispersion('schrodinger');
const hash = readHash();
if (setups[hash.setup]) setups[hash.setup]();
else setMode(['one', 'two', 'packet'].includes(hash.mode) ? hash.mode : 'one');
kick();

window.__app = { state, setups, setMode, ready: true, parse,
  // For the tests: where the packet's probability is centred at time t, and the velocities.
  centroid(t) { if (!packetData) preparePacket(); const { re, im } = packetAt(t); let s = 0, m = 0; for (let i = 0; i < NP; i++) { let x = i * LP / NP; if (x > LP / 2) x -= LP; const p = re[i] ** 2 + im[i] ** 2; s += p; m += p * x; } return m / s; },
  velocities };
