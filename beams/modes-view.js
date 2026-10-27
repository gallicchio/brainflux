// The modes: Hermite-Gauss and Laguerre-Gauss beams, their cross-sections, their side view and
// their Gouy phase; and a check that the angular spectrum method agrees.

import { fillMode, modeAt, order, overlap } from './modes.js';
import { propagate } from '../diffraction/optics.js';
import { colorize, drawWheel } from '../lib/complexcolor.js';
import { texToMathML } from '../lib/mathml.js';
import { el, $, slider, segmented, toggle, fmt } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors, tickLabel } from '../lib/plot.js';
import { fmtPi, realTable, haloText } from './common.js';

const DARK = '#07080b';
const ZMAX = 3;                    // the side view runs from -3 zR to 3 zR
const CREST_RATE = 0.6;
// The numerical check: a 256 x 256 grid 25.6 w0 across, light with w0 = 20 lambda.
const FN = 256, FDX = 0.1, FLAMBDA = 0.05, FZR = Math.PI / FLAMBDA;

export function createModes(app) {
  const state = app.state.modes;
  const cross = $('#cross'), side = $('#mside'), gcv = $('#mgouy');
  let phase = 0, sideField = null, fft = null, travelDir = 1;

  const mode = () => (state.family === 'hg' ? { family: 'hg', m: state.m, n: state.n }
    : state.family === 'lg' ? { family: 'lg', p: state.p, l: state.l }
      : { family: 'mix', alpha: state.alpha, phi: state.phi });
  const extent = () => Math.sqrt(order(mode()) + 0.5) + 1.6;     // in units of w(z)
  const name = () => (state.family === 'hg' ? `HG${sub(state.m)}${sub(state.n)}` : state.family === 'lg' ? `LG${sub(state.p)}${state.l < 0 ? '₋' : ''}${sub(Math.abs(state.l))}` : 'HG₁₀ + e^{iφ} HG₀₁');
  const sub = (k) => String(k).split('').map((d) => '₀₁₂₃₄₅₆₇₈₉'[+d]).join('');

  // ------------------------------------------------------------------- the cross-section

  let wheel = null;
  function drawCross() {
    const { ctx, width } = fitCanvas(cross);
    const n = Math.max(64, Math.min(320, Math.round(width)));
    const re = new Float64Array(n * n), im = new Float64Array(n * n);
    const z = state.zeta, w = Math.sqrt(1 + z * z), half = extent() * w;
    let peak;
    if (state.fft) peak = fftView(re, im, n, half);
    else peak = fillMode(re, im, n, n, half, mode(), z);
    const img = new ImageData(n, n);
    if (state.cross === 'phase') colorize(re, im, img.data, 0.5 * peak, 'complex');
    else colorize(re, im, img.data, 0.6 * peak, 'intensity');
    const off = document.createElement('canvas'); off.width = n; off.height = n;
    off.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, width, width);
    // The circle r = w(z).
    const r = (w / half) * (width / 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(width / 2, width / 2, r, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    haloText(ctx, `${name()} at z = ${fmt(z, 3)} z_R`, 8, 8);
    ctx.textBaseline = 'bottom';
    haloText(ctx, `dashed: r = w(z) = ${fmt(w, 3)} w₀; the square is ${fmt(2 * half, 3)} w₀ wide`, 8, width - 8, 'rgba(255,255,255,0.8)');
    if (state.fft) { ctx.textAlign = 'right'; ctx.textBaseline = 'top'; haloText(ctx, 'computed by FFT', width - 8, 8, '#ffd166'); }
    if (state.cross === 'phase') {
      if (!wheel) { wheel = document.createElement('canvas'); wheel.width = wheel.height = 56; drawWheel(wheel, 1, 1.6); }
      ctx.save(); ctx.beginPath(); ctx.arc(width - 36, width - 52, 26, 0, 2 * Math.PI); ctx.clip();
      ctx.drawImage(wheel, width - 64, width - 80, 56, 56); ctx.restore();
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = '10px system-ui, sans-serif';
      haloText(ctx, 'phase', width - 36, width - 22, 'rgba(255,255,255,0.8)');
    }
  }

  // ------------------------------------------------------------------- the numerical check

  /** Propagate the mode from its waist by the angular spectrum method (exact kz), resample. */
  function computeFFT() {
    const key = JSON.stringify([mode(), state.zeta]);
    if (fft && fft.key === key) return fft;
    const re = new Float64Array(FN * FN), im = new Float64Array(FN * FN), half = (FN * FDX) / 2;
    fillMode(re, im, FN, FN, half, mode(), 0);
    const R = Float64Array.from(re), I = Float64Array.from(im);
    propagate(R, I, FN, FDX, FLAMBDA, state.zeta * FZR, false);
    // Against the formula at z.
    const A = new Float64Array(FN * FN), B = new Float64Array(FN * FN);
    const peak = fillMode(A, B, FN, FN, half, mode(), state.zeta);
    let err = 0;
    for (let k = 0; k < FN * FN; k++) err = Math.max(err, Math.hypot(R[k] - A[k], I[k] - B[k]));
    const o = overlap(A, B, R, I, FDX * FDX);
    fft = { key, R, I, half, err: err / peak, mag: Math.hypot(o.re, o.im), ph: Math.atan2(o.im, o.re) };
    return fft;
  }

  function fftView(re, im, n, half) {
    const f = computeFFT();
    let peak = 0;
    const dxv = (2 * half) / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      // View pixel to grid coordinates (the grid's row 0 is y = +half too).
      const x = -half + (i + 0.5) * dxv, y = half - (j + 0.5) * dxv;
      const gi = (x + f.half) / FDX - 0.5, gj = (f.half - y) / FDX - 0.5;
      const i0 = Math.floor(gi), j0 = Math.floor(gj), a = gi - i0, b = gj - j0, o = j * n + i;
      if (i0 < 0 || j0 < 0 || i0 + 1 >= FN || j0 + 1 >= FN) { re[o] = 0; im[o] = 0; continue; }
      const k = j0 * FN + i0;
      re[o] = (1 - a) * (1 - b) * f.R[k] + a * (1 - b) * f.R[k + 1] + (1 - a) * b * f.R[k + FN] + a * b * f.R[k + FN + 1];
      im[o] = (1 - a) * (1 - b) * f.I[k] + a * (1 - b) * f.I[k + 1] + (1 - a) * b * f.I[k + FN] + a * b * f.I[k + FN + 1];
      peak = Math.max(peak, Math.hypot(re[o], im[o]));
    }
    return peak || 1;
  }

  function fftNote() {
    const box = $('#fft-note');
    if (!state.fft) { box.textContent = 'Compute the beam at z from the one at the waist with the angular spectrum method of the diffraction demo (exact, not paraxial: w₀ = 20λ), instead of the formula.'; return; }
    const f = computeFFT(), N = order(mode()), psi = Math.atan(state.zeta);
    const measured = (N + 1) * psi - f.ph;
    box.textContent = `Largest difference from the formula: ${(100 * f.err).toPrecision(2)}% of the peak. Overlap with the formula's mode: ${f.mag.toFixed(5)}. Gouy phase of the computed beam: ${fmtPi(measured, 4)} (formula: (N+1) atan(z/z_R) = ${fmtPi((N + 1) * psi, 4)}).`;
  }

  // ------------------------------------------------------------------- the side view

  let sframe = null;
  function computeSide() {
    const { width, height } = fitCanvas(side);
    const F = new Frame(null, width, height, { left: 44, right: 12, top: 20, bottom: 28 });
    const pw = Math.max(2, Math.round(F.w)), ph = Math.max(2, Math.round(F.h));
    // Tall enough for the mode near its waist; further out it spreads past the edges.  (Showing
    // all of it at 3 zR would put the crests too close together to draw.)
    const md = mode(), X = 1.5 * extent();
    const key = JSON.stringify([md, pw, ph, state.side]);
    if (sideField && sideField.key === key) return sideField;
    const re = new Float32Array(pw * ph), im = new Float32Array(pw * ph);
    // Stretched sideways as drawn, the beam is one with a longer wavelength: crests pi (px/pz)^2 zR apart.
    const pz = pw / (2 * ZMAX), px = ph / (2 * X), kd = 2 / (px / pz) ** 2;
    const y0 = md.family === 'hg' && md.n % 2 === 1 ? 0.7 : 0;
    let peak = 0;
    for (let i = 0; i < pw; i++) {
      const zeta = -ZMAX + ((i + 0.5) / pw) * 2 * ZMAX, car = state.side === 'real' ? kd * zeta : 0;
      const c = Math.cos(car), s = Math.sin(car);
      const gz = state.side === 'real' ? kd / pz : 0;
      for (let j = 0; j < ph; j++) {
        const x = X - ((j + 0.5) / ph) * 2 * X, [a, b] = modeAt(md, x, y0, zeta), o = j * pw + i;
        const att = Math.exp(-(gz * gz) / 5);
        re[o] = (a * c - b * s) * att; im[o] = (a * s + b * c) * att;
        peak = Math.max(peak, Math.hypot(a, b));
      }
    }
    const off = document.createElement('canvas'); off.width = pw; off.height = ph;
    // The phase of the beam just off the axis at the left edge, for the plane wave's ticks.
    const [a0, b0] = modeAt(md, 0.25, y0, -ZMAX);
    const p0 = Math.atan2(b0, a0) + kd * ZMAX;
    sideField = { key, re, im, pw, ph, off, img: new ImageData(pw, ph), X, kd, y0, p0, table: realTable(0.45 * peak), peak };
    return sideField;
  }

  function drawSide() {
    const { ctx, width, height } = fitCanvas(side);
    const c = themeColors();
    ctx.clearRect(0, 0, width, height);
    const F = new Frame(ctx, width, height, { left: 44, right: 12, top: 20, bottom: 28 });
    sframe = F;
    const sf = computeSide();
    F.x0 = -ZMAX; F.x1 = ZMAX; F.y0 = -sf.X; F.y1 = sf.X;
    const n = sf.pw * sf.ph, out = new Uint32Array(sf.img.data.buffer);
    if (state.side === 'real') {
      const { lut, size, vmax } = sf.table, L = new Uint32Array(lut.buffer), cs = Math.cos(phase), sn = Math.sin(phase), k = (0.5 * size) / vmax;
      for (let p = 0; p < n; p++) { let q = ((sf.re[p] * cs + sf.im[p] * sn) * k + 0.5 * size) | 0; if (q < 0) q = 0; else if (q >= size) q = size - 1; out[p] = L[q]; }
    } else {
      const d = sf.img.data, ref = 0.35 * sf.peak * sf.peak;
      for (let p = 0; p < n; p++) {
        const I = sf.re[p] ** 2 + sf.im[p] ** 2, t = (2 / Math.PI) * Math.atan(I / ref), g = 255 * Math.min(1, t * 1.15);
        d[4 * p] = g; d[4 * p + 1] = g * 0.92; d[4 * p + 2] = g * 0.85; d[4 * p + 3] = 255;
      }
    }
    sf.off.getContext('2d').putImageData(sf.img, 0, 0);
    ctx.fillStyle = DARK; ctx.fillRect(F.left, F.top, F.w, F.h);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(sf.off, F.left, F.top, F.w, F.h);
    F.clip();
    // +-w(z), and the plane of the cross-section.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
    for (const s of [1, -1]) {
      ctx.beginPath();
      for (let k = 0; k <= 100; k++) { const z = -ZMAX + (2 * ZMAX * k) / 100, w = Math.sqrt(1 + z * z); if (k === 0) ctx.moveTo(F.X(z), F.Y(s * w)); else ctx.lineTo(F.X(z), F.Y(s * w)); }
      ctx.stroke();
    }
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(F.X(state.zeta), F.top); ctx.lineTo(F.X(state.zeta), F.bottom); ctx.stroke();
    // A plane wave's crests, as ticks along the edges, in step with the beam's crests at the
    // left: through the waist the beam's crests run ahead of them, by (N+1)/2 of a wavelength
    // from far before to far after.
    if (state.side === 'real') {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
      // Crests where kd z + p0 - phase = 2 pi m.
      for (let m = Math.floor((-ZMAX * sf.kd + sf.p0 - phase) / (2 * Math.PI)); ; m++) {
        const z = (2 * Math.PI * m + phase - sf.p0) / sf.kd;
        if (z > ZMAX) break;
        if (z < -ZMAX) continue;
        const x = F.X(z);
        ctx.beginPath(); ctx.moveTo(x, F.top); ctx.lineTo(x, F.top + 7); ctx.moveTo(x, F.bottom); ctx.lineTo(x, F.bottom - 7); ctx.stroke();
      }
    }
    ctx.restore();
    F.axes({ colors: c });
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = c.ink2; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(sf.y0 ? `from the side: the plane y = ${sf.y0} w₀ (y = 0 is dark for odd n)` : 'from the side: the plane y = 0', F.left, 14);
    ctx.textAlign = 'right';
    ctx.fillText(state.side === 'real' ? 'ticks: a plane wave\'s crests' : '', F.right, 14);
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText('z / z_R', F.right, F.bottom + 16);
    ctx.save(); ctx.translate(11, F.top + F.h / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('x / w₀', 0, 0); ctx.restore();
  }

  // ------------------------------------------------------------------- the Gouy phase

  function drawGouy() {
    const { ctx, width, height } = fitCanvas(gcv);
    const c = themeColors();
    ctx.clearRect(0, 0, width, height);
    const F = new Frame(ctx, width, height, { left: 44, right: 12, top: 20, bottom: 28 });
    const N = order(mode()), top = Math.max(1, Math.ceil(((N + 1) * Math.atan(ZMAX)) / Math.PI * 2) / 2);
    F.x0 = -ZMAX; F.x1 = ZMAX; F.y0 = -top; F.y1 = top;
    F.clip();
    ctx.strokeStyle = c.line; ctx.lineWidth = 1;
    for (let v = -top; v <= top + 1e-9; v += 0.5) { const y = Math.round(F.Y(v)) + 0.5; ctx.beginPath(); ctx.moveTo(F.left, y); ctx.lineTo(F.right, y); ctx.stroke(); }
    const curve = (k, color, dash, lw) => {
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.setLineDash(dash); ctx.beginPath();
      for (let i = 0; i <= 200; i++) { const z = -ZMAX + (2 * ZMAX * i) / 200, y = (k * Math.atan(z)) / Math.PI; if (i === 0) ctx.moveTo(F.X(z), F.Y(y)); else ctx.lineTo(F.X(z), F.Y(y)); }
      ctx.stroke(); ctx.setLineDash([]);
    };
    if (N > 0) curve(1, c.ink3, [5, 4], 1.5);
    curve(N + 1, c.accent, [], 2.5);
    const y = ((N + 1) * Math.atan(state.zeta)) / Math.PI;
    ctx.fillStyle = '#e0a800'; ctx.beginPath(); ctx.arc(F.X(state.zeta), F.Y(y), 5, 0, 2 * Math.PI); ctx.fill();
    ctx.restore();
    F.axes({ colors: c, yTicks: false });
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = c.ink2; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = -top; v <= top + 1e-9; v += top > 2 ? 1 : 0.5) ctx.fillText(`${tickLabel(v)}π`, F.left - 5, F.Y(v));
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`Gouy phase (N+1)·atan(z/z_R), N = ${N}${N > 0 ? '; dashed: the fundamental, N = 0' : ''}`, F.left, 14);
    ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText('z / z_R', F.right, F.bottom + 16);
  }

  // ------------------------------------------------------------------- the gallery

  function buildGallery() {
    const g = $('#gallery');
    const items = [];
    if (state.family === 'hg') for (let n = 0; n <= 3; n++) for (let m = 0; m <= 3; m++) items.push({ md: { family: 'hg', m, n }, label: `${m},${n}`, set: { m, n } });
    else if (state.family === 'lg') for (let p = 0; p <= 2; p++) for (let l = -3; l <= 3; l++) items.push({ md: { family: 'lg', p, l }, label: `${p},${l}`, set: { p, l } });
    else for (const k of [0, 1, 2, 3, 4, 6]) {
      const phi = (k * Math.PI) / 4;
      items.push({ md: { family: 'mix', alpha: Math.PI / 4, phi }, label: `φ = ${['0', 'π/4', 'π/2', '3π/4', 'π', '', '−π/2'][k]}`, set: { alpha: Math.PI / 4, phi: phi > Math.PI ? phi - 2 * Math.PI : phi } });
    }
    $('#gallery-head').textContent = state.family === 'hg' ? 'Hermite–Gauss HG_mn at the waist (m across, n down): click one'
      : state.family === 'lg' ? 'Laguerre–Gauss LG_pl at the waist (l across from −3 to 3, p down): click one'
        : 'HG₁₀ + e^{iφ} HG₀₁ for several φ: click one';
    g.className = `gallery g-${state.family}`;
    g.replaceChildren(...items.map((it) => {
      const n = 56, c = el('canvas', { width: n, height: n });
      const re = new Float64Array(n * n), im = new Float64Array(n * n);
      const peak = fillMode(re, im, n, n, Math.sqrt(order(it.md) + 0.5) + 1.6, it.md, 0);
      const img = new ImageData(n, n);
      colorize(re, im, img.data, 0.5 * peak, 'complex');
      c.getContext('2d').putImageData(img, 0, 0);
      const pressed = JSON.stringify(it.md) === JSON.stringify(mode());
      return el('button', { type: 'button', class: 'thumb', 'aria-pressed': String(pressed), title: it.label, 'aria-label': it.label,
        onclick: () => { Object.assign(state, it.set); syncControls(); changed(); buildGallery(); } }, c, el('span', {}, it.label));
    }));
  }

  // ------------------------------------------------------------------- controls

  const famSeg = segmented([
    { value: 'hg', label: 'Hermite–Gauss', title: 'HG_mn: products of Hermite functions in x and y' },
    { value: 'lg', label: 'Laguerre–Gauss', title: 'LG_pl: round, with a phase that winds l times round the axis' },
    { value: 'mix', html: 'HG<sub>10</sub> + e<sup>iφ</sup>HG<sub>01</sub>', title: 'A superposition of two modes of the same order' },
  ], state.family, (v) => { state.family = v; buildIndex(); changed(); buildGallery(); }, { label: 'Family' });
  $('#family-box').append(famSeg);

  let idx = {};
  function buildIndex() {
    const box = $('#index-box');
    idx = {};
    const mk = (key, label, min, max, step, title) => (idx[key] = slider({ label, labelHTML: true, min, max, step, value: state[key], title,
      onInput: (v) => { state[key] = step === 1 ? Math.round(v) : v; changed(); buildGallery(); } }));
    if (state.family === 'hg') box.replaceChildren(mk('m', '<math><mi>m</mi></math>', 0, 8, 1, 'Nodes across x'), mk('n', '<math><mi>n</mi></math>', 0, 8, 1, 'Nodes across y'));
    else if (state.family === 'lg') box.replaceChildren(mk('p', '<math><mi>p</mi></math>', 0, 5, 1, 'Dark rings'), mk('l', '<math><mi>l</mi></math>', -6, 6, 1, 'Turns of the phase round the axis'));
    else box.replaceChildren(mk('alpha', '<math><mi>α</mi></math>', 0, Math.PI / 2, 0.001, 'cos α HG₁₀ + sin α e^{iφ} HG₀₁'), mk('phi', '<math><mi>φ</mi></math>', -Math.PI, Math.PI, 0.001, 'The relative phase'));
  }

  const zetaSlider = slider({ label: 'z / z<sub>R</sub>', labelHTML: true, min: -4, max: 4, step: 0.01, value: state.zeta, title: 'Where the cross-section is, in Rayleigh ranges from the waist',
    onInput: (v) => { state.zeta = v; changed(false); } });
  $('#zeta-box').append(zetaSlider);
  const travelToggle = toggle('Travel', state.travel, (on) => { state.travel = on; app.animate(); app.hashSoon(); }, 'Move the cross-section along the beam, from −3 z_R to 3 z_R and back');
  const playButton = el('button', { type: 'button', class: 'primary', title: 'Start or stop the crests in the side view', onclick: () => setPlay(!state.play) }, 'Pause');
  function setPlay(on) { state.play = on; playButton.textContent = on ? 'Pause' : 'Play'; app.animate(); }
  $('#zeta-buttons').append(playButton, travelToggle,
    el('button', { type: 'button', onclick: () => { state.zeta = 0; zetaSlider.value = 0; changed(false); } }, 'Waist'),
    el('button', { type: 'button', onclick: () => { state.zeta = 1; zetaSlider.value = 1; changed(false); } }, 'z = z_R'));
  const crossSeg = segmented([
    { value: 'phase', label: 'Amplitude & phase', title: 'Brightness: amplitude; colour: phase' },
    { value: 'intensity', label: 'Intensity' },
  ], state.cross, (v) => { state.cross = v; changed(false); }, { label: 'Cross-section' });
  const sideSeg = segmented([
    { value: 'real', label: 'Crests', title: 'The field from the side (its real part), moving' },
    { value: 'intensity', label: 'Intensity', title: 'The intensity from the side' },
  ], state.side, (v) => { state.side = v; sideField = null; changed(false); app.animate(); }, { label: 'Side view' });
  $('#cross-show').append(el('span', { class: 'small muted' }, 'Cross-section'), crossSeg);
  $('#side-show').append(el('span', { class: 'small muted' }, 'Side view'), sideSeg);
  const fftToggle = toggle('Propagate by FFT', state.fft, (on) => { state.fft = on; changed(false); }, 'Compute the beam at z numerically, with the diffraction demo\'s angular spectrum method');
  $('#fft-box').append(fftToggle);

  function syncControls() {
    famSeg.value = state.family; zetaSlider.value = state.zeta; travelToggle.on = state.travel;
    crossSeg.value = state.cross; sideSeg.value = state.side; fftToggle.on = state.fft;
    playButton.textContent = state.play ? 'Pause' : 'Play';
    for (const [k, s] of Object.entries(idx)) s.value = state[k];
  }

  function formula() {
    const N = order(mode());
    const tex = state.family === 'hg' ? `N=m+n=${N}` : state.family === 'lg' ? `N=2p+|l|=${N}` : 'N=1+0=1';
    $('#mode-formula').innerHTML = `Order ${texToMathML(tex)}; Gouy phase ${texToMathML(`(N+1)\\psi=${N + 1}\\arctan(z/z_R)`)}`;
  }

  function readout() {
    const z = state.zeta, w = Math.sqrt(1 + z * z), N = order(mode());
    const R = z === 0 ? '∞' : `${fmt(z + 1 / z, 3)} z_R`;
    $('#modes-readout').replaceChildren(
      el('span', {}, el('b', {}, name()), `: order N = ${N}`),
      el('span', {}, `at z = ${fmt(z, 3)} z_R: w = ${fmt(w, 3)} w₀, R = ${R}, Gouy phase ${N + 1}ψ = ${fmtPi((N + 1) * Math.atan(z), 3)}`),
    );
  }

  function changed(rebuildSide = true) {
    if (rebuildSide) sideField = null;
    draw();
    app.hashSoon();
  }

  function draw() {
    drawCross(); drawSide(); drawGouy(); formula(); readout(); fftNote();
  }

  function tick(dt) {
    let busy = false;
    if (state.travel) {
      state.zeta += travelDir * 0.8 * dt;
      if (state.zeta > ZMAX) { state.zeta = ZMAX; travelDir = -1; }
      if (state.zeta < -ZMAX) { state.zeta = -ZMAX; travelDir = 1; }
      zetaSlider.value = +state.zeta.toFixed(2);
      drawCross(); drawGouy(); readout(); fftNote();
      busy = true;
    }
    if (state.play && state.side === 'real') {
      phase = (phase + 2 * Math.PI * CREST_RATE * dt) % (2 * Math.PI);
      busy = true;
    }
    if (busy) drawSide();
    return busy;
  }

  const r = (v) => +(+v).toPrecision(4);
  function toHash() {
    const h = { fam: state.family, z: r(state.zeta), cs: state.cross === 'phase' ? undefined : state.cross, sv: state.side === 'real' ? undefined : state.side, fft: state.fft ? 1 : undefined, travel: state.travel ? 1 : undefined };
    if (state.family === 'hg') h.i = `${state.m},${state.n}`;
    else if (state.family === 'lg') h.i = `${state.p},${state.l}`;
    else h.i = `${r(state.alpha)},${r(state.phi)}`;
    return h;
  }
  function fromHash(h) {
    if (['hg', 'lg', 'mix'].includes(h.fam)) state.family = h.fam;
    const [a, b] = (h.i || '').split(',').map(Number);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      if (state.family === 'hg') { state.m = clampInt(a, 0, 8); state.n = clampInt(b, 0, 8); }
      else if (state.family === 'lg') { state.p = clampInt(a, 0, 5); state.l = clampInt(b, -6, 6); }
      else { state.alpha = a; state.phi = b; }
    }
    if (Number.isFinite(+h.z) && h.z !== undefined) state.zeta = Math.max(-4, Math.min(4, +h.z));
    if (h.cs === 'intensity') state.cross = 'intensity';
    if (h.sv === 'intensity') state.side = 'intensity';
    state.fft = h.fft === '1';
    state.travel = h.travel === '1';
  }
  const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));

  function set(cfg) {
    Object.assign(state, { travel: false, fft: false, cross: 'phase', side: 'real' }, cfg);
    buildIndex(); syncControls(); buildGallery();
    setPlay(cfg.play ?? true);
    changed();
    app.animate();
  }

  function show() { buildIndex(); syncControls(); buildGallery(); sideField = null; draw(); }
  window.addEventListener('resize', () => { if (app.state.view === 'modes') { sideField = null; draw(); } });

  return { show, draw, tick, toHash, fromHash, set, computeFFT, get mode() { return mode(); } };
}
