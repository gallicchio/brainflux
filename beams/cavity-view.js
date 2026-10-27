// The cavity: two mirrors, the stability diagram, the mode, rays, and the mode spectrum.

import { gParams, isStable, eigenmode, fsr, modeLines } from './cavity.js';
import { free, mirror, applyRay } from './gauss.js';
import { el, $, slider, toggle, fmt } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors, niceTicks, tickLabel } from '../lib/plot.js';
import { fmtLen, fmtPi, fmtFreq, wavelengthRGB, signedSlider, arcPath, haloText } from './common.js';

const DARK = '#07080b';
const RAY_COLORS = ['#ffd166', '#5ee1ff', '#ff7ab8'];
const PASS_TIME = 0.07;      // seconds per pass of the rays
const TRAIL = 50;            // passes drawn
const N_COLORS = ['#e8eaf0', '#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7', '#b197fc'];

export function createCavity(app) {
  const state = app.state.cavity;
  const lam = () => app.state.bench.lambda * 1e-6;
  const cv = $('#cavity'), stab = $('#stability'), spec = $('#spectrum'), rph = $('#rayphase');
  let mode = null, rays = [], clock = 0, cframe = null, sframe = null, dragging = null, frozen = null;

  const scale = () => Math.sqrt((lam() * state.L) / Math.PI);   // the natural transverse size
  const halfHeight = () => 3.2 * scale();
  const aperture = () => 0.97 * halfHeight();

  function update() {
    mode = eigenmode(state.L, state.R1, state.R2, lam());
  }

  // ------------------------------------------------------------------- rays

  function launch() {
    const s = scale(), L = state.L;
    rays = [[0.55 * s, 0], [0, 0.55 * s / L], [-0.3 * s, -0.35 * s / L]].map(([x, th], i) => ({
      r: [x, th], hits: [x], phase: [[x, th]], lost: 0, color: RAY_COLORS[i], pass: 0,
    }));
    clock = 0;
  }

  /** Advance every ray by one pass between the mirrors. */
  function step() {
    let alive = 0;
    for (const ray of rays) {
      if (ray.lost) continue;
      const toMirror = ray.pass % 2 === 0 ? 2 : 1;
      ray.r = applyRay(free(state.L), ray.r);
      ray.hits.push(ray.r[0]);
      ray.pass++;
      if (Math.abs(ray.r[0]) > aperture()) { ray.lost = Math.ceil(ray.pass / 2); continue; }
      ray.r = applyRay(mirror(toMirror === 2 ? state.R2 : state.R1), ray.r);
      if (toMirror === 1) { ray.phase.push(ray.r.slice()); if (ray.phase.length > 600) ray.phase.shift(); }
      if (ray.hits.length > TRAIL + 1) ray.hits.shift();
      alive++;
    }
    return alive;
  }

  // ------------------------------------------------------------------- the cavity picture

  function drawCavity() {
    const { ctx, width, height } = fitCanvas(cv);
    const c = themeColors();
    ctx.clearRect(0, 0, width, height);
    const F = new Frame(ctx, width, height, { left: 52, right: 14, top: 22, bottom: 34 });
    cframe = F;
    const L = state.L, view = frozen || [-0.07 * L, 1.07 * L];
    F.x0 = view[0]; F.x1 = view[1];
    const H = halfHeight(); F.y0 = -H; F.y1 = H;
    const sx = F.w / (F.x1 - F.x0), sy = F.h / (2 * H), E = sy / sx, yc = F.top + F.h / 2;
    ctx.fillStyle = DARK; ctx.fillRect(F.left, F.top, F.w, F.h);
    F.clip();
    const rgb = wavelengthRGB(app.state.bench.lambda);
    if (mode) {
      // The mode's intensity (a glow in the laser's colour) and its outline +-w(z).
      const img = ctx.createImageData(Math.max(1, Math.round(F.X(L) - F.X(0))), Math.round(F.h));
      const d = img.data, iw = img.width, ih = img.height;
      for (let i = 0; i < iw; i++) {
        const z = (i + 0.5) / sx, dz = z - mode.zw, w = mode.w0 * Math.sqrt(1 + (dz / mode.zR) ** 2), a = (mode.w0 / w) ** 2;
        for (let j = 0; j < ih; j++) {
          const x = (ih / 2 - j - 0.5) / sy, I = a * Math.exp((-2 * x * x) / (w * w)), v = Math.min(1, 0.75 * Math.sqrt(I));
          const o = 4 * (j * iw + i);
          d[o] = 255 * rgb[0] * v; d[o + 1] = 255 * rgb[1] * v; d[o + 2] = 255 * rgb[2] * v; d[o + 3] = 255;
        }
      }
      ctx.putImageData(img, Math.round(F.X(0)), Math.round(F.top));
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5;
      for (const s of [1, -1]) {
        ctx.beginPath();
        for (let k = 0; k <= 120; k++) {
          const z = (L * k) / 120, w = mode.w0 * Math.sqrt(1 + ((z - mode.zw) / mode.zR) ** 2);
          if (k === 0) ctx.moveTo(F.X(z), yc - s * w * sy); else ctx.lineTo(F.X(z), yc - s * w * sy);
        }
        ctx.stroke();
      }
      // Wavefronts: arcs of radius R(z) in this stretched picture (they fit the mirrors).
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
      for (let k = 1; k < 8; k++) {
        const z = (L * k) / 8, dz = z - mode.zw, w = mode.w0 * Math.sqrt(1 + (dz / mode.zR) ** 2);
        const R = dz === 0 ? Infinity : dz * (1 + (mode.zR / dz) ** 2);
        ctx.beginPath(); arcPath(ctx, F.X(z), yc, R * sx, Math.min(1.5 * w * sy, F.h / 2)); ctx.stroke();
      }
      // The waist.
      if (mode.zw > 0 && mode.zw < L) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(F.X(mode.zw), yc - mode.w0 * sy); ctx.lineTo(F.X(mode.zw), yc + mode.w0 * sy); ctx.stroke();
        ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        haloText(ctx, `w₀ ${fmtLen(mode.w0)}`, F.X(mode.zw), yc + Math.min(F.h / 2 - 30, 1.6 * mode.w0 * sy + 4));
      }
    } else {
      ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      haloText(ctx, 'unstable: no mode, and rays walk off', F.X(L / 2), F.top + 8, '#ff8a80');
      const lost = rays.filter((r) => r.lost).map((r) => r.lost);
      if (lost.length) haloText(ctx, `rays lost after ${lost.join(', ')} round trip${lost.length === 1 && lost[0] === 1 ? '' : 's'}`, F.X(L / 2), F.top + 26, 'rgba(255,255,255,0.85)');
    }
    // Rays: the last passes, fading.
    if (state.rays) {
      // Where a ray at height x meets a mirror as drawn (an arc of radius R in the stretched
      // picture); the ray matrices treat the mirrors as thin, at z = 0 and L.
      const onMirror = (z, x) => {
        const R = z === 0 ? -state.R1 : state.R2, X = x * E;
        if (!Number.isFinite(R) || Math.abs(X) >= Math.abs(R)) return z;
        return z - Math.sign(R) * (Math.abs(R) - Math.sqrt(R * R - X * X));
      };
      for (const ray of rays) {
        const n = ray.hits.length, first = ray.pass - (n - 1);
        ctx.lineWidth = 1.4;
        for (let k = 1; k < n; k++) {
          const z0 = (first + k - 1) % 2 === 0 ? 0 : L, z1 = L - z0;
          ctx.globalAlpha = 0.15 + 0.85 * (k / (n - 1)) ** 2;
          ctx.strokeStyle = ray.color;
          ctx.beginPath();
          ctx.moveTo(F.X(onMirror(z0, ray.hits[k - 1])), yc - ray.hits[k - 1] * sy);
          ctx.lineTo(F.X(onMirror(z1, ray.hits[k])), yc - ray.hits[k] * sy);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
    // The mirrors, as arcs of radius R in the same stretched picture, hatched behind.
    const h = F.h / 2 - 6;
    for (const [z, R, back] of [[0, -state.R1, -1], [L, state.R2, 1]]) {
      const Rpx = R * sx;
      ctx.strokeStyle = '#e8ecf5'; ctx.lineWidth = 3;
      ctx.beginPath(); arcPath(ctx, F.X(z), yc, Rpx, h); ctx.stroke();
      ctx.lineWidth = 1;
      for (let y = -h; y <= h; y += 8) {
        if (Number.isFinite(Rpx) && Math.abs(y) > Math.abs(Rpx) * 0.995) continue;
        const sag = Number.isFinite(Rpx) && Math.abs(Rpx) < 1e7 ? Math.sign(Rpx) * (Math.abs(Rpx) - Math.sqrt(Rpx * Rpx - y * y)) : 0;
        const x = F.X(z) - sag;
        ctx.beginPath(); ctx.moveTo(x, yc + y); ctx.lineTo(x + back * 7, yc + y - 7); ctx.stroke();
      }
    }
    ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    haloText(ctx, `drawn ×${fmt(E, 3)} wider than it is`, F.X(L / 2), F.bottom - 5, 'rgba(255,255,255,0.75)');
    ctx.restore();
    // Axes and labels.
    F.axes({ xlabel: 'z (mm)', yTicks: false, colors: c });
    ctx.save();
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = c.ink2; ctx.strokeStyle = c.ink3;
    const um = H < 1, unit = um ? 1000 : 1;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const v of niceTicks(-H * unit, H * unit, 5)) {
      const py = Math.round(yc - (v / unit) * sy) + 0.5;
      ctx.beginPath(); ctx.moveTo(F.left - 4, py); ctx.lineTo(F.left, py); ctx.stroke();
      ctx.fillText(tickLabel(v), F.left - 6, py);
    }
    ctx.translate(11, yc); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center';
    ctx.fillText(um ? 'x (µm)' : 'x (mm)', 0, 0);
    ctx.restore();
    ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = c.ink2; ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left'; ctx.fillText(`mirror 1: R₁ = ${fmtLen(state.R1)}`, F.left, 15);
    ctx.textAlign = 'right'; ctx.fillText(`mirror 2: R₂ = ${fmtLen(state.R2)}  (drag it)`, F.right, 15);
  }

  // ------------------------------------------------------------------- the stability diagram

  const G = 2.2;
  function drawStability() {
    const { ctx, width, height } = fitCanvas(stab);
    const c = themeColors();
    ctx.clearRect(0, 0, width, height);
    const size = Math.min(width - 50, height - 44);
    const F = new Frame(ctx, size + 50, size + 44, { left: 40, right: 10, top: 14, bottom: 30 });
    F.left += (width - (size + 50)) / 2; F.right = F.left + F.w;
    sframe = F;
    F.x0 = -G; F.x1 = G; F.y0 = -G; F.y1 = G;
    F.clip();
    // The stable region, 0 <= g1 g2 <= 1.
    ctx.fillStyle = c.good; ctx.globalAlpha = 0.16;
    for (const s of [1, -1]) {
      ctx.beginPath(); ctx.moveTo(F.X(0), F.Y(0)); ctx.lineTo(F.X(s * G), F.Y(0)); ctx.lineTo(F.X(s * G), F.Y(s / G));
      for (let k = 0; k <= 60; k++) { const g1 = s * (G - ((G - 1 / G) * k) / 60); ctx.lineTo(F.X(g1), F.Y(1 / g1)); }
      ctx.lineTo(F.X(0), F.Y(s * G)); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = c.ink3; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(F.X(-G), F.Y(0)); ctx.lineTo(F.X(G), F.Y(0)); ctx.moveTo(F.X(0), F.Y(-G)); ctx.lineTo(F.X(0), F.Y(G)); ctx.stroke();
    ctx.strokeStyle = c.good; ctx.lineWidth = 2;
    for (const s of [1, -1]) {
      ctx.beginPath();
      for (let k = 0; k <= 80; k++) { const g1 = s * (1 / G + ((G - 1 / G) * k) / 80); if (k === 0) ctx.moveTo(F.X(g1), F.Y(1 / g1)); else ctx.lineTo(F.X(g1), F.Y(1 / g1)); }
      ctx.stroke();
    }
    // As L changes with the mirrors kept, (g1, g2) moves along a line through (1, 1).
    const [g1, g2] = gParams(state.L, state.R1, state.R2);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = c.ink3; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(F.X(1), F.Y(1));
    const dl = Math.max(Math.abs(1 - g1), Math.abs(1 - g2));
    if (dl > 1e-9) ctx.lineTo(F.X(1 + ((g1 - 1) / dl) * 5), F.Y(1 + ((g2 - 1) / dl) * 5));
    ctx.stroke(); ctx.setLineDash([]);
    // Landmarks.
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = c.ink2;
    const marks = [[1, 1, 'planar', 'right', 'top'], [0, 0, 'confocal', 'left', 'top'], [-1, -1, 'concentric', 'left', 'top'], [1, 0, 'hemispherical', 'left', 'top']];
    for (const [a, b, name, align, base] of marks) {
      ctx.beginPath(); ctx.arc(F.X(a), F.Y(b), 3.5, 0, 2 * Math.PI); ctx.fill();
      ctx.textAlign = align; ctx.textBaseline = base;
      ctx.fillText(name, F.X(a) + (align === 'left' ? 5 : -5), F.Y(b) + 4);
    }
    ctx.fillStyle = c.good; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('g₁g₂ = 1', F.X(G) - 4, F.Y(1 / G) - 4);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('stable', F.X(1.65), F.Y(0.22)); ctx.fillText('stable', F.X(-1.65), F.Y(-0.22));
    ctx.fillStyle = c.warn;
    ctx.fillText('unstable', F.X(1.5), F.Y(1.7)); ctx.fillText('unstable', F.X(-1.2), F.Y(1.2)); ctx.fillText('unstable', F.X(1.2), F.Y(-1.2));
    // The cavity.
    const st = isStable(g1, g2) || !!mode;
    const px = F.X(Math.max(-G, Math.min(G, g1))), py = F.Y(Math.max(-G, Math.min(G, g2)));
    ctx.fillStyle = st ? c.accent : c.warn; ctx.strokeStyle = c.panel; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, 7.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    ctx.restore();
    F.axes({ colors: c });
    ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = c.ink2; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('g₁ = 1 − L/R₁', F.left + F.w / 2, F.bottom + 16);
    ctx.save(); ctx.translate(F.left - 30, F.top + F.h / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'middle';
    ctx.fillText('g₂ = 1 − L/R₂', 0, 0); ctx.restore();
  }

  // ------------------------------------------------------------------- the spectrum

  function drawSpectrum() {
    const { ctx, width, height } = fitCanvas(spec);
    const c = themeColors();
    ctx.clearRect(0, 0, width, height);
    const F = new Frame(ctx, width, height, { left: 52, right: 14, top: 24, bottom: 34 });
    F.x0 = -0.04; F.x1 = 2.04; F.y0 = 0; F.y1 = 1.14;
    const FSR = fsr(state.L);
    ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = c.ink2; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('Resonant frequencies, by mode order N', F.left, 15);
    F.clip();
    if (!mode) {
      ctx.restore();
      F.axes({ yTicks: false, colors: c });
      ctx.fillStyle = c.warn; ctx.textAlign = 'center'; ctx.fillText('unstable: no modes', F.left + F.w / 2, F.top + F.h / 2);
      return;
    }
    const lines = modeLines(mode.gouy, 6, F.x0, F.x1).sort((a, b) => b.N - a.N);
    for (const ln of lines) {
      const x = Math.round(F.X(ln.nu)) + 0.5, h = 1 / (1 + 0.3 * ln.N);
      ctx.strokeStyle = ln.N === 0 ? c.accent : N_COLORS[ln.N];
      ctx.lineWidth = ln.N === 0 ? 3 : 2;
      ctx.beginPath(); ctx.moveTo(x, F.Y(0)); ctx.lineTo(x, F.Y(h)); ctx.stroke();
    }
    // The transverse spacing, from the TEM00 line of the first FSR to N = 1.
    const nu0 = lines.find((l) => l.N === 0 && l.nu >= 0 && l.nu < 1);
    if (nu0) {
      const d = mode.gouy / Math.PI, y = F.Y(1.05);
      let x1 = nu0.nu + d;
      if (x1 > F.x1) x1 -= 1;
      ctx.strokeStyle = c.ink2; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(F.X(nu0.nu), y); ctx.lineTo(F.X(x1), y); ctx.stroke();
      ctx.fillStyle = c.ink2; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      if (Math.abs(F.X(x1) - F.X(nu0.nu)) > 30) ctx.fillText('Δν_T', (F.X(nu0.nu) + F.X(x1)) / 2, y - 1);
    }
    ctx.restore();
    F.axes({ yTicks: false, colors: c });
    ctx.fillStyle = c.ink2; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(`frequency ν, in units of the free spectral range c/2L = ${fmtFreq(FSR)}`, F.left + F.w / 2, F.bottom + 18);
    // A legend of colours.
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '12px system-ui, sans-serif';
    let x = F.right - 7 * 30;
    ctx.fillStyle = c.ink2; ctx.textAlign = 'right'; ctx.fillText('N =', x - 6, 11); ctx.textAlign = 'left';
    for (let N = 0; N <= 6; N++) {
      ctx.fillStyle = N === 0 ? c.accent : N_COLORS[N];
      ctx.fillRect(x, 6, 4, 11);
      ctx.fillStyle = c.ink2; ctx.fillText(`${N}`, x + 8, 11);
      x += 30;
    }
  }

  // ------------------------------------------------------------------- rays in phase space

  function drawRayPhase() {
    const { ctx, width, height } = fitCanvas(rph);
    const c = themeColors();
    ctx.clearRect(0, 0, width, height);
    const size = Math.min(width - 50, height - 52);
    const F = new Frame(ctx, size + 50, size + 52, { left: 40, right: 10, top: 22, bottom: 30 });
    F.left += (width - (size + 50)) / 2; F.right = F.left + F.w;
    const s = scale(), L = state.L;
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = c.ink2; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(mode ? `hits on mirror 1: each round trip turns them by 2ψ₁ = ${fmtPi(2 * mode.gouy)}` : 'hits on mirror 1: they run away',
      F.left + F.w / 2, 14);
    // Scaled to the ellipses (stable), or to where the rays started (unstable: they leave).
    let big = 0;
    for (const ray of rays) for (const [x, th] of mode ? ray.phase : ray.phase.slice(0, 1)) big = Math.max(big, Math.abs(x / s), Math.abs((th * L) / s));
    const A = Math.max(0.4, Math.min(5, (mode ? 1.25 : 2.5) * big)) || 1;
    F.x0 = -A; F.x1 = A; F.y0 = -A; F.y1 = A;
    F.clip();
    ctx.strokeStyle = c.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(F.X(-A), F.Y(0)); ctx.lineTo(F.X(A), F.Y(0)); ctx.moveTo(F.X(0), F.Y(-A)); ctx.lineTo(F.X(0), F.Y(A)); ctx.stroke();
    for (const ray of rays) {
      const n = ray.phase.length;
      ray.phase.forEach(([x, th], k) => {
        ctx.fillStyle = ray.color === RAY_COLORS[0] ? '#d9a400' : ray.color === RAY_COLORS[1] ? '#1c9fc4' : '#d6408a';
        ctx.globalAlpha = k === n - 1 ? 1 : 0.55;
        const r = k === n - 1 ? 4 : 2;
        ctx.beginPath(); ctx.arc(F.X(x / s), F.Y((th * L) / s), r, 0, 2 * Math.PI); ctx.fill();
      });
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    F.axes({ colors: c });
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = c.ink2; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('x at mirror 1 (units of √(λL/π))', F.left + F.w / 2, F.bottom + 16);
    ctx.save(); ctx.translate(F.left - 30, F.top + F.h / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'middle';
    ctx.fillText('angle × L (same units)', 0, 0); ctx.restore();
  }

  // ------------------------------------------------------------------- numbers

  function numbers() {
    const [g1, g2] = gParams(state.L, state.R1, state.R2), p = g1 * g2;
    const st = !!mode;
    const rows = [
      ['g₁, g₂', `${fmt(g1, 3)}, ${fmt(g2, 3)}`],
      ['g₁g₂', `${fmt(p, 3)}: ${p === 0 && mode ? 'confocal, on the edge' : st ? 'stable' : p === 0 || p === 1 ? 'on the edge' : 'unstable'}`],
    ];
    if (mode) {
      rows.push(
        ['waist w₀', fmtLen(mode.w0)],
        ['waist from mirror 1', fmtLen(mode.zw)],
        ['Rayleigh range z_R', fmtLen(mode.zR)],
        ['spot on mirror 1, 2', `${fmtLen(mode.w1)}, ${fmtLen(mode.w2)}`],
        ['Gouy phase ψ₁, one way', fmtPi(mode.gouy)],
        ['free spectral range', fmtFreq(fsr(state.L))],
        ['transverse spacing Δν_T', fmtFreq((fsr(state.L) * mode.gouy) / Math.PI)],
      );
    }
    const nkey = rows.join('|');
    if (nkey !== numbersKey) { numbersKey = nkey; $('#cav-numbers').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])); }
    // A short line, the same length whatever the cavity, so the canvases below don't move
    // while the point is dragged.
    const r = mode
      ? [el('span', { class: 'good' }, `stable: g₁g₂ = ${fmt(p, 3)}`), el('span', {}, 'mode waist ', el('b', {}, fmtLen(mode.w0)), `, Gouy phase ψ₁ = ${fmtPi(mode.gouy)} each way`)]
      : [el('span', { class: 'warn' }, `${p === 0 || p === 1 ? 'on the edge' : 'unstable'}: g₁g₂ = ${fmt(p, 3)}`), el('span', {}, 'no mode')];
    const key = r.map((x) => x.textContent).join('|');
    if (key !== readoutKey) { readoutKey = key; $('#cavity-readout').replaceChildren(...r); }
  }
  let readoutKey = '', numbersKey = '';

  function draw() {
    update();
    drawCavity(); drawStability(); drawSpectrum(); drawRayPhase(); numbers();
  }

  // ------------------------------------------------------------------- controls

  const box = $('#cav-box');
  const Ls = slider({ label: 'L (mm)', min: 10, max: 3000, log: true, value: state.L, title: 'The distance between the mirrors',
    onInput: (v) => { state.L = v; changed(true); } });
  const signs = [{ value: 1, label: 'concave' }, { value: 0, label: 'flat' }, { value: -1, label: 'convex' }];
  const R1s = signedSlider({ label: 'R₁ (mm)', min: 10, max: 10000, value: state.R1, signs, title: 'Radius of curvature of mirror 1',
    onInput: (v) => { state.R1 = v; changed(true); } });
  const R2s = signedSlider({ label: 'R₂ (mm)', min: 10, max: 10000, value: state.R2, signs, title: 'Radius of curvature of mirror 2',
    onInput: (v) => { state.R2 = v; changed(true); } });
  const lamNote = el('div', { class: 'small muted' });
  box.append(Ls, el('div', { class: 'small muted' }, 'Mirror 1'), R1s, el('div', { class: 'small muted' }, 'Mirror 2'), R2s, lamNote);
  const presets = {
    'near planar': [250, 2500, 2500], confocal: [250, 250, 250], 'near concentric': [250, 130, 130],
    hemispherical: [250, Infinity, 270], unstable: [250, 100, 100], 'unequal mirrors': [250, 300, 1000],
  };
  for (const [name, [L, R1, R2]] of Object.entries(presets)) {
    $('#cav-presets').append(el('button', { type: 'button', onclick: () => set({ L, R1, R2 }) }, name[0].toUpperCase() + name.slice(1)));
  }
  const playButton = el('button', { type: 'button', class: 'primary', title: 'Run or stop the rays', onclick: () => setPlay(!state.play) }, 'Pause');
  function setPlay(on) { state.play = on; playButton.textContent = on ? 'Pause' : 'Play'; app.animate(); }
  const raysToggle = toggle('Show rays', state.rays, (on) => { state.rays = on; draw(); app.animate(); app.hashSoon(); }, 'Rays bouncing between the mirrors');
  $('#ray-box').append(playButton, el('button', { type: 'button', title: 'Start the rays again', onclick: () => { launch(); draw(); app.animate(); } }, 'New rays'), raysToggle);

  function syncControls() {
    Ls.value = state.L; R1s.value = state.R1; R2s.value = state.R2; raysToggle.on = state.rays; playButton.textContent = state.play ? 'Pause' : 'Play';
    lamNote.textContent = `Light of λ = ${fmt(app.state.bench.lambda, 4)} nm (set on the Bench).  Concave means curved towards the other mirror.`;
  }

  function changed(relaunch) {
    if (relaunch) launch();
    draw();
    app.hashSoon();
    app.animate();
    app.cavityChanged?.();
  }

  function set(cfg) {
    Object.assign(state, cfg);
    syncControls();
    changed(true);
  }

  // ------------------------------------------------------------------- dragging

  function gFromPointer(ev) {
    const r = stab.getBoundingClientRect(), F = sframe;
    let g1 = F.invX(ev.clientX - r.left), g2 = F.invY(ev.clientY - r.top);
    g1 = Math.max(-G, Math.min(G, g1)); g2 = Math.max(-G, Math.min(G, g2));
    for (const [a, b] of [[1, 1], [0, 0], [-1, -1], [1, 0], [0, 1]]) if (Math.hypot(g1 - a, g2 - b) < 0.07) { g1 = a; g2 = b; }
    return [g1, g2];
  }
  const toR = (g) => (Math.abs(1 - g) < 0.015 ? Infinity : +(state.L / (1 - g)).toPrecision(4));
  stab.addEventListener('pointerdown', (ev) => { stab.setPointerCapture(ev.pointerId); dragging = 'g'; moveG(ev); });
  stab.addEventListener('pointermove', (ev) => { if (dragging === 'g') moveG(ev); });
  function moveG(ev) {
    const [g1, g2] = gFromPointer(ev);
    state.R1 = toR(g1); state.R2 = toR(g2);
    syncControls(); changed(true);
  }
  cv.addEventListener('pointerdown', (ev) => {
    const r = cv.getBoundingClientRect(), x = ev.clientX - r.left;
    if (!cframe || Math.abs(x - cframe.X(state.L)) > 30) return;
    cv.setPointerCapture(ev.pointerId);
    dragging = 'L'; frozen = [cframe.x0, cframe.x1];
  });
  cv.addEventListener('pointermove', (ev) => {
    const r = cv.getBoundingClientRect(), x = ev.clientX - r.left;
    if (dragging !== 'L') { cv.style.cursor = cframe && Math.abs(x - cframe.X(state.L)) < 30 ? 'ew-resize' : 'default'; return; }
    state.L = Math.max(5, +cframe.invX(x).toPrecision(4));
    syncControls(); changed(true);
  });
  // Keys: arrows move the point in the stability diagram (shift: farther); in the picture, the
  // left and right arrows change L.
  stab.addEventListener('keydown', (ev) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[ev.key];
    if (!d) return;
    ev.preventDefault();
    const step = ev.shiftKey ? 0.1 : 0.02, [g1, g2] = gParams(state.L, state.R1, state.R2);
    const clamp = (g) => Math.max(-G, Math.min(G, Math.round((g) / 0.01) * 0.01));
    state.R1 = toR(clamp(g1 + d[0] * step)); state.R2 = toR(clamp(g2 + d[1] * step));
    syncControls(); changed(true);
  });
  cv.addEventListener('keydown', (ev) => {
    const d = { ArrowLeft: -1, ArrowRight: 1 }[ev.key];
    if (!d) return;
    ev.preventDefault();
    state.L = Math.max(5, +(state.L * (1 + d * (ev.shiftKey ? 0.05 : 0.01))).toPrecision(4));
    syncControls(); changed(true);
  });
  const stop = () => { if (dragging === 'L') { frozen = null; draw(); } dragging = null; };
  for (const c of [stab, cv]) { c.addEventListener('pointerup', stop); c.addEventListener('pointercancel', stop); }

  // ------------------------------------------------------------------- animation and address

  function tick(dt) {
    if (!(state.play && state.rays)) return false;
    clock += dt;
    let moved = false;
    if (rays.length && rays.every((r) => r.lost)) {
      // All lost: leave them on show for a moment, then start again.
      if (clock > 1.5) { launch(); moved = true; }
    } else {
      while (clock > PASS_TIME) {
        clock -= PASS_TIME;
        step();
        moved = true;
        if (rays.every((r) => r.lost)) { clock = 0; break; }
      }
    }
    if (moved) { drawCavity(); drawRayPhase(); numbers(); }
    return true;
  }

  const r = (v) => (Number.isFinite(v) ? +v.toPrecision(6) : 'flat');
  function toHash() { return { L: r(state.L), R1: r(state.R1), R2: r(state.R2), rays: state.rays ? undefined : 0 }; }
  function fromHash(h) {
    const num = (s) => (s === 'flat' ? Infinity : +s);
    if (+h.L > 0) state.L = +h.L;
    if (h.R1 && num(h.R1) !== 0 && !Number.isNaN(num(h.R1))) state.R1 = num(h.R1);
    if (h.R2 && num(h.R2) !== 0 && !Number.isNaN(num(h.R2))) state.R2 = num(h.R2);
    state.rays = h.rays !== '0';
  }

  function show() { syncControls(); launch(); draw(); }
  window.addEventListener('resize', () => { if (app.state.view === 'cavity') draw(); });

  return { show, draw, tick, toHash, fromHash, set, launch, get mode() { update(); return mode; }, get rays() { return rays; }, step };
}
