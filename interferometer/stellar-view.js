// Michelson's stellar interferometer on the page: the beam across the telescope (drag the outer
// mirrors), the star with the interferometer's fringe pattern projected on the sky, the fringes
// at the focus in true colour, and the visibility against baseline.
//
// In Michelson's design (Mount Wilson, 1920) two outer mirrors a distance B apart collect the
// starlight and two inner mirrors, at a fixed separation b, send it into the telescope.  The
// fringe spacing at the focus is set by b, so it does not change; their visibility is set by B.

import { el, $, slider, segmented, toggle, fmt } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors } from '../lib/plot.js';
import { MAS, makeModel, visibility, bandVisibility, bandSamples, firstNull, airyAmp } from './stars.js';
import { cmf, xyzToLinear, gamutFix, wavelengthColour, toBytes, ENCODE_TABLE, ENCODE_SCALE } from './colour.js';

export const state = {
  kind: 'single', theta: 47, limb: 0, rho: 50, pa: 0, ratio: 0.8,
  B: 1, lam: 575, bw: 0, seeing: false, sweeping: true,
};

const B_INNER = 1.14;     // the inner mirrors' separation (m), drawn only
let model = null, xmax = 6, dirty = true, sweepDir = 1, atm = 0, onChange = () => {};
let bSlider, thetaSlider, limbSlider, rhoSlider, paSlider, ratioSlider, lamSlider, bwSlider, kindSeg, seeingToggle;

export const getModel = () => model;

function rebuild(keepRange = false) {
  model = makeModel({ theta: state.theta * MAS, binary: state.kind === 'binary', rho: state.rho * MAS, pa: (state.pa * Math.PI) / 180, ratio: state.ratio, limb: state.limb });
  if (!keepRange) {
    // Show the first null (or a few beats) and some way beyond.
    const lam = state.lam * 1e-9, single = makeModel({ theta: state.theta * MAS, limb: state.limb });
    const B1 = state.theta > 0 ? firstNull(single, lam, (5 * lam) / (state.theta * MAS)) : Infinity;
    const proj = Math.abs(state.rho * MAS * Math.cos((state.pa * Math.PI) / 180));
    const beat = state.kind === 'binary' && proj > 0 ? lam / proj : Infinity;
    let X = Math.min(3.3 * B1, 4 * beat);
    if (!Number.isFinite(X)) X = 10;
    xmax = Math.max(0.5, Math.min(400, X));
    if (bSlider) bSlider.setRange(0, +xmax.toPrecision(3));
  }
  if (state.B > xmax) xmax = state.B * 1.1;
  dirty = true;
}

export function firstNullB() {
  const lam = state.lam * 1e-9, single = makeModel({ theta: state.theta * MAS, limb: state.limb });
  return state.theta > 0 ? firstNull(single, lam, (5 * lam) / (state.theta * MAS)) : Infinity;
}

const samples = () => bandSamples(state.lam * 1e-9, state.bw * 1e-9, state.bw > 0 ? 25 : 1);

/** The complex visibility at the central fringe, for the light's band. */
export function currentV() { return bandVisibility(model, state.B, samples()); }

// --------------------------------------------------------------------- schematic

const schem = $('#st-schematic');
let hits = null, drag = null;

function beamLength() { return Math.max(6.1, xmax); }

function drawSchematic() {
  const { ctx, width, height } = fitCanvas(schem);
  const u = Math.min(width / 100, height / 64), ox = (width - 100 * u) / 2, oy = (height - 64 * u) / 2;
  const P = (x, y) => [ox + x * u, oy + y * u];
  ctx.fillStyle = '#0d1020'; ctx.fillRect(0, 0, width, height);
  const [r, g, b] = toBytes(wavelengthColour(state.lam).map((c) => 0.3 + 0.7 * c));
  const beam = `rgb(${r},${g},${b})`, text = 'rgba(225,228,240,0.85)', dim = 'rgba(225,228,240,0.55)';
  const line = (pts, w, style) => { ctx.strokeStyle = style; ctx.lineWidth = w; ctx.beginPath(); pts.forEach(([x, y], i) => { const [px, py] = P(x, y); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }); ctx.stroke(); };
  const label = (s, x, y, align = 'center', col = text, size = 11, back = false) => {
    ctx.font = `${size}px system-ui, sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle';
    const [px, py] = P(x, y);
    if (back) { const w = ctx.measureText(s).width + 8, x0 = align === 'center' ? px - w / 2 : align === 'right' ? px - w + 4 : px - 4; ctx.fillStyle = 'rgba(13,16,32,0.85)'; ctx.fillRect(x0, py - size * 0.7, w, size * 1.4); }
    ctx.fillStyle = col; ctx.fillText(s, px, py);
  };
  // Not to scale across: the inner mirrors are drawn at ±6, the outer ones from there out to ±44.
  const Lb = beamLength(), xOf = (B) => 6 + 38 * Math.min(1, B / Lb);
  const xo = [50 - xOf(state.B), 50 + xOf(state.B)], xi = [44, 56];
  const by = 19;
  // Starlight: plane wavefronts coming down.
  for (let y = 2; y <= 8; y += 3) line([[4, y], [96, y]], 1, 'rgba(255,255,255,0.18)');
  label('starlight: plane wavefronts', 50, 11, 'center', dim, 9, true);
  // The beam.
  ctx.fillStyle = '#2a2f45'; { const [x0, y0] = P(4, by - 1.6); ctx.fillRect(x0, y0, 92 * u, 3.2 * u); }
  label(`beam, ${fmt(Lb, 3)} m long`, 4, by + 4.5, 'left', dim, 9);
  // Light paths: down to the outer mirrors, in to the inner ones, down into the telescope, to the focus.
  ctx.lineCap = 'round';
  const paths = [0, 1].map((s) => [[xo[s], 1], [xo[s], by], [xi[s], by], [xi[s], 30], [50, 56]]);
  for (const p of paths) line(p, 2.6 * u, `rgba(${r},${g},${b},0.18)`);
  for (const p of paths) line(p, Math.max(1.2, 0.4 * u), beam);
  // Mirrors at 45°.
  const mirror = (x, s) => line([[x - 2.2 * s, by - 2.2], [x + 2.2 * s, by + 2.2]], 0.8 * u, '#e6e9f0');
  mirror(xo[0], 1); mirror(xo[1], -1); mirror(xi[0], -1); mirror(xi[1], 1);
  // Handles on the outer mirrors.
  ctx.fillStyle = 'rgba(255,224,138,0.9)';
  const handles = xo.map((x) => P(x, by));
  for (const [hx, hy] of handles) { ctx.beginPath(); ctx.arc(hx, hy, Math.max(5, 1.5 * u), 0, 2 * Math.PI); ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1; }
  // The baseline B, above the beam.
  const dimY = by + 6.5;
  line([[xo[0], dimY], [xo[1], dimY]], 1, dim); line([[xo[0], dimY - 1.2], [xo[0], dimY + 1.2]], 1, dim); line([[xo[1], dimY - 1.2], [xo[1], dimY + 1.2]], 1, dim);
  label(`B = ${fmt(state.B, 3)} m`, Math.max(xo[1] + 2, 60), dimY, 'left', text, 11);
  // The telescope: an objective and its tube, the light coming to a focus.
  line([[36, 31], [64, 31]], 1.2 * u, 'rgba(180,200,255,0.7)');
  line([[36, 31], [36, 58]], 1, 'rgba(255,255,255,0.25)'); line([[64, 31], [64, 58]], 1, 'rgba(255,255,255,0.25)');
  label('telescope', 66, 42, 'left', dim, 10);
  label('inner mirrors: fixed', 66, 36, 'left', dim, 9);
  ctx.fillStyle = '#ffe08a'; { const [fx, fy] = P(50, 56); ctx.beginPath(); ctx.arc(fx, fy, 1 * u, 0, 2 * Math.PI); ctx.fill(); }
  label('focus: the fringes', 53, 60, 'left', text, 10);
  hits = { handles, u, P, ox, Lb };
}

schem.addEventListener('pointerdown', (e) => {
  if (!hits) return;
  const r = schem.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  const i = hits.handles.findIndex(([hx, hy]) => Math.hypot(px - hx, py - hy) < Math.max(14, 3 * hits.u));
  if (i < 0) return;
  schem.setPointerCapture(e.pointerId);
  drag = { i, Lb: hits.Lb };
  setSweep(false);
});
schem.addEventListener('pointermove', (e) => {
  const r = schem.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  if (!drag) {
    const near = hits && hits.handles.some(([hx, hy]) => Math.hypot(px - hx, py - hy) < Math.max(14, 3 * hits.u));
    schem.style.cursor = near ? 'ew-resize' : 'default';
    return;
  }
  const x = (px - hits.ox) / hits.u, half = Math.abs(x - 50);
  setB(Math.max(0, Math.min(drag.Lb, ((half - 6) / 38) * drag.Lb)));
});
const endDrag = () => { drag = null; };
schem.addEventListener('pointerup', endDrag);
schem.addEventListener('pointercancel', endDrag);

export function setB(B) {
  state.B = B;
  if (bSlider) bSlider.value = +B.toPrecision(5);
  if (B > xmax) { xmax = B * 1.1; bSlider?.setRange(0, +xmax.toPrecision(3)); }
  dirty = true;
  onChange();
}

export function setSweep(on) {
  state.sweeping = on;
  const b = $('#st-play');
  b.setAttribute('aria-pressed', String(on));
  b.textContent = on ? 'Pause sweep' : 'Sweep';
}

// --------------------------------------------------------------------- the sky

const sky = $('#sky');
function drawSky() {
  const { ctx, width, height } = fitCanvas(sky);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
  const lam = state.lam * 1e-9, binary = state.kind === 'binary';
  // The field of view (mas across the shorter side).
  const extent = Math.max(state.theta, 1) + (binary ? state.rho : 0);
  const F = 2.4 * extent, scale = Math.min(width, height) / F;    // px per mas
  const cx = width / 2, cy = height / 2;
  // The interferometer's fringes on the sky: brightness response 1 + cos(2π B x / λ).
  const period = state.B > 0 ? lam / state.B / MAS : Infinity;          // mas
  const pxPer = period * scale;
  if (pxPer > 3) {
    for (let x = 0; x < width; x++) {
      const ph = (2 * Math.PI * ((x + 0.5 - cx) / scale)) / period;
      const a = 0.5 + 0.5 * Math.cos(ph);
      ctx.fillStyle = `rgba(120,160,255,${(0.22 * a).toFixed(3)})`;
      ctx.fillRect(x, 0, 1, height);
    }
  }
  // The star(s), limb darkened if asked.
  const R = (state.theta / 2) * scale;
  for (const s of model.stars) {
    const x = cx + (s.x / MAS) * scale, y = cy - (s.y / MAS) * scale, rad = Math.max(R, 1.5);
    const grd = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const steps = 8;
    for (let k = 0; k <= steps; k++) {
      const rr = k / steps, mu = Math.sqrt(Math.max(0, 1 - rr * rr)), I = (1 - state.limb * (1 - mu)) * Math.sqrt(s.flux / Math.max(...model.stars.map((q) => q.flux)));
      grd.addColorStop(Math.min(0.999, rr), `rgba(255,${Math.round(214 + 30 * I)},${Math.round(150 + 80 * I)},${(0.25 + 0.75 * I).toFixed(3)})`);
    }
    grd.addColorStop(1, 'rgba(255,220,170,0)');
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(x, y, rad, 0, 2 * Math.PI); ctx.fill();
  }
  // Labels: scale bar, baseline direction, fringe period.
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'bottom';
  const bar = niceLen(F / 4), bw = bar * scale;
  ctx.fillRect(12, height - 16, bw, 3);
  ctx.textAlign = 'left'; ctx.fillText(`${fmt(bar, 3)} mas`, 12, height - 20);
  ctx.textAlign = 'right';
  ctx.fillText(pxPer > 3 ? `fringes on the sky: λ/B = ${fmt(period, 3)} mas` : state.B > 0 ? `λ/B = ${fmt(period, 3)} mas: too fine to draw` : 'B = 0: no fringes', width - 10, height - 8);
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('baseline →', 12, 10);
  $('#sky-note').textContent = binary ? `two stars ${fmt(state.rho, 3)} mas apart, each ${fmt(state.theta, 3)} mas across` : `${fmt(state.theta, 3)} mas = ${fmt(state.theta / 1000, 3)}″ across`;
}
function niceLen(x) { const p = 10 ** Math.floor(Math.log10(x)), f = x / p; return (f < 2 ? 1 : f < 5 ? 2 : 5) * p; }

// --------------------------------------------------------------------- the fringes at the focus

const fringeCanvas = $('#fringes');
let fOff = null, fImg = null;
const AIRY_N = 4096, AIRY_MAX = 16, AIRY = new Float64Array(AIRY_N + 1);
for (let i = 0; i <= AIRY_N; i++) { const a = (i * AIRY_MAX) / AIRY_N; AIRY[i] = airyAmp(a) ** 2; }
const airy2 = (a) => { const p = (a / AIRY_MAX) * AIRY_N; if (p >= AIRY_N) return 0; const i = Math.floor(p), t = p - i; return AIRY[i] * (1 - t) + AIRY[i + 1] * t; };
const FX = 7, FY = 3.2;    // the image spans ±FX fringes across and ±FY up and down
let lastProfile = null;

function drawFringes() {
  const { ctx, width, height } = fitCanvas(fringeCanvas);
  const c = themeColors();
  const imgH = Math.round(height * 0.66), dpr = window.devicePixelRatio || 1;
  const nx = Math.max(64, Math.min(480, Math.round(width * dpr * 0.75))), ny = Math.max(24, Math.round((nx * imgH) / width));
  if (!fOff || fOff.width !== nx || fOff.height !== ny) { fOff = document.createElement('canvas'); fOff.width = nx; fOff.height = ny; fImg = fOff.getContext('2d').createImageData(nx, ny); }
  const lam0 = state.lam * 1e-9, S = samples(), v = [0, 0];
  const waves = S.map(([lam, w]) => {
    visibility(model, state.B / lam, v);
    const k = lam0 / lam, cm = cmf(lam * 1e9);
    return { w, k, re: v[0], im: v[1], cx: w * cm[0], cy: w * cm[1], cz: w * cm[2] };
  });
  let base = [0, 0, 0];
  for (const q of waves) { base[0] += q.cx; base[1] += q.cy; base[2] += q.cz; }
  const rgbMax = gamutFix(xyzToLinear(2 * base[0], 2 * base[1], 2 * base[2])), expo = 1 / Math.max(...rgbMax, 1e-9);
  // Per wave, the fringe term along x: Re(V e^{i(2π f k + φ)}).
  const fr = waves.map((q) => {
    const a = new Float64Array(nx);
    for (let i = 0; i < nx; i++) {
      const f = -FX + ((i + 0.5) * 2 * FX) / nx, ph = 2 * Math.PI * f * q.k + atm;
      a[i] = q.re * Math.cos(ph) - q.im * Math.sin(ph);
    }
    return a;
  });
  const d = fImg.data, prof = new Float64Array(nx);
  for (let j = 0; j < ny; j++) {
    const y = FY - ((j + 0.5) * 2 * FY) / ny;
    for (let i = 0; i < nx; i++) {
      const x = -FX + ((i + 0.5) * 2 * FX) / nx, rho = Math.hypot(x, y);
      let X = 0, Y = 0, Z = 0;
      for (let q = 0; q < waves.length; q++) {
        const wv = waves[q], A = airy2((Math.PI / 4) * rho * wv.k) * (1 + fr[q][i]);
        X += wv.cx * A; Y += wv.cy * A; Z += wv.cz * A;
      }
      if (j === (ny >> 1)) prof[i] = Y / (2 * base[1]);
      let [R, G, B] = xyzToLinear(X * expo, Y * expo, Z * expo);
      [R, G, B] = gamutFix([R, G, B]);
      const o = 4 * (j * nx + i);
      d[o] = ENCODE_TABLE[Math.round(Math.max(0, Math.min(1, R)) * ENCODE_SCALE)];
      d[o + 1] = ENCODE_TABLE[Math.round(Math.max(0, Math.min(1, G)) * ENCODE_SCALE)];
      d[o + 2] = ENCODE_TABLE[Math.round(Math.max(0, Math.min(1, B)) * ENCODE_SCALE)];
      d[o + 3] = 255;
    }
  }
  fOff.getContext('2d').putImageData(fImg, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(fOff, 0, 0, width, imgH);
  // The brightness across the middle, below the image.
  const f = new Frame(ctx, width, height - imgH, { left: 8, right: 8, top: 6, bottom: 6 });
  f.top += imgH; f.bottom += imgH;
  f.x0 = -FX; f.x1 = FX; f.y0 = 0; f.y1 = 1.05;
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(f.left, f.Y(0.5)); ctx.lineTo(f.right, f.Y(0.5)); ctx.stroke();
  ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i < nx; i++) { const x = f.X(-FX + ((i + 0.5) * 2 * FX) / nx), y = f.Y(prof[i]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  ctx.stroke();
  lastProfile = prof;
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('brightness across the middle', f.left + 2, f.top);
  const V = Math.hypot(...currentV());
  $('#fringe-note').textContent = `visibility ${V.toFixed(3)}${state.bw > 0 ? ` over ${fmt(state.bw, 3)} nm` : ''}`;
  void c;
}

// --------------------------------------------------------------------- visibility plot

const visCanvas = $('#visibility');
let visFrame = null, visDrag = false;
function drawVisibility() {
  const { ctx, width, height } = fitCanvas(visCanvas);
  const c = themeColors();
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 40, right: 12, top: 12, bottom: 34 });
  visFrame = f;
  f.x0 = 0; f.x1 = xmax; f.y0 = 0; f.y1 = 1.05;
  const lam = state.lam * 1e-9, n = Math.max(200, Math.floor(f.w)), v = [0, 0];
  f.clip();
  // The first null of a single disk.
  const B1 = firstNullB();
  if (Number.isFinite(B1) && B1 < xmax) {
    ctx.strokeStyle = c.ink3; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(f.X(B1) + 0.5, f.top); ctx.lineTo(f.X(B1) + 0.5, f.bottom); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = c.ink2; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const k = (B1 * state.theta * MAS) / lam;
    ctx.fillText(`${fmt(k, 3)} λ/θ = ${fmt(B1, 3)} m`, f.X(B1) + 4, f.top + 4);
  }
  // Monochromatic |V(B/λ)|, and over the band.
  const curve = (fn, style, dash, w) => {
    ctx.strokeStyle = style; ctx.lineWidth = w; ctx.setLineDash(dash); ctx.beginPath();
    for (let i = 0; i <= n; i++) { const B = (xmax * i) / n, y = f.Y(fn(B)); if (i) ctx.lineTo(f.X(B), y); else ctx.moveTo(f.X(B), y); }
    ctx.stroke(); ctx.setLineDash([]);
  };
  curve((B) => Math.hypot(...visibility(model, B / lam, v)), c.accent, [], 2);
  const S = samples();
  if (state.bw > 0) curve((B) => Math.hypot(...bandVisibility(model, B, S, v)), c.ink2, [5, 4], 1.5);
  // The present baseline.
  const Vn = Math.hypot(...currentV()), x = f.X(state.B);
  ctx.strokeStyle = c.warn; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, f.top); ctx.lineTo(x, f.bottom); ctx.stroke();
  ctx.fillStyle = c.warn; ctx.beginPath(); ctx.arc(x, f.Y(Vn), 5, 0, 2 * Math.PI); ctx.fill();
  ctx.restore();
  f.axes({ xlabel: 'baseline B (m)', ylabel: '|V|', colors: c });
  ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  ctx.fillStyle = c.accent; ctx.fillText(`at λ = ${fmt(state.lam, 4)} nm`, f.right - 6, f.top + 4);
  if (state.bw > 0) { ctx.fillStyle = c.ink2; ctx.fillText(`- - over ${fmt(state.bw, 3)} nm`, f.right - 6, f.top + 18); }
  $('#vis-note').textContent = 'click or drag to set the baseline';
}
function visPointer(e) { const r = visCanvas.getBoundingClientRect(); return visFrame.invX(e.clientX - r.left); }
visCanvas.addEventListener('pointerdown', (e) => { if (!visFrame) return; visCanvas.setPointerCapture(e.pointerId); visDrag = true; setSweep(false); setB(Math.max(0, Math.min(xmax, visPointer(e)))); });
visCanvas.addEventListener('pointermove', (e) => { if (visDrag) setB(Math.max(0, Math.min(xmax, visPointer(e)))); });
visCanvas.addEventListener('pointerup', () => { visDrag = false; });
visCanvas.addEventListener('pointercancel', () => { visDrag = false; });

// --------------------------------------------------------------------- read-outs and controls

function updateReadout() {
  const V = currentV(), lam = state.lam * 1e-9, B1 = firstNullB();
  const parts = [`|V| = ${Math.hypot(...V).toFixed(3)} at B = ${fmt(state.B, 4)} m`];
  if (Number.isFinite(B1)) parts.push(`first null of one star: B = ${fmt(B1, 4)} m`);
  if (state.B > 0) parts.push(`fringes on the sky λ/B = ${fmt(lam / state.B / MAS, 3)} mas`);
  if (state.kind === 'binary') {
    const proj = state.rho * Math.cos((state.pa * Math.PI) / 180);
    if (Math.abs(proj) > 1e-6) parts.push(`beat period λ/(ρ cos φ) = ${fmt(lam / (Math.abs(proj) * MAS), 3)} m`);
  }
  $('#st-readout').innerHTML = parts.join('<br>');
}

export function tick(dt) {
  let busy = false;
  if (state.sweeping) {
    busy = true;
    let B = state.B + sweepDir * (xmax / 14) * Math.min(dt, 0.1);
    if (B > xmax) { B = xmax; sweepDir = -1; }
    if (B < 0) { B = 0; sweepDir = 1; }
    state.B = B;
    if (bSlider) bSlider.value = +B.toPrecision(5);
    dirty = true;
  }
  if (state.seeing) {
    busy = true;
    atm += (Math.random() - 0.5) * 4 * Math.sqrt(Math.min(dt, 0.1));
    dirty = true;
  }
  return busy;
}

export function isBusy() { return state.sweeping || state.seeing; }

export function frame() {
  if (!dirty) return;
  dirty = false;
  drawSchematic(); drawSky(); drawFringes(); drawVisibility(); updateReadout();
}

export function invalidate() { dirty = true; }

function showKind() {
  $('#binary-box').hidden = state.kind !== 'binary';
}

export function init(hooks) {
  onChange = hooks.onChange || onChange;
  const changed = (keep = false) => { rebuild(keep); onChange(); };
  kindSeg = segmented([{ value: 'single', label: 'One star' }, { value: 'binary', label: 'Two stars' }], state.kind,
    (k) => { state.kind = k; showKind(); changed(); }, { label: 'Star' });
  $('#star-kind').append(kindSeg);
  thetaSlider = slider({ label: 'θ (mas)', min: 0, max: 200, step: 0.1, value: state.theta, title: 'The angular diameter, in milliarcseconds (1 mas = 0.001″)', onInput: (v) => { state.theta = Math.max(0, v); changed(); } });
  limbSlider = slider({ label: 'limb dark.', min: 0, max: 1, step: 0.01, value: state.limb, title: 'Linear limb darkening: brightness 1 - a(1 - cos) across the face; 0 is a uniform disk', onInput: (v) => { state.limb = v; changed(); } });
  $('#star-box').append(thetaSlider, limbSlider);
  rhoSlider = slider({ label: 'ρ (mas)', min: 1, max: 300, log: true, value: state.rho, title: 'The separation of the two stars', onInput: (v) => { state.rho = v; changed(); } });
  paSlider = slider({ label: 'angle (°)', min: -90, max: 90, step: 1, value: state.pa, title: 'The angle between the line joining the stars and the baseline', onInput: (v) => { state.pa = v; changed(); } });
  ratioSlider = slider({ label: 'ratio', min: 0.05, max: 1, step: 0.01, value: state.ratio, title: 'The fainter star\'s brightness over the brighter\'s', onInput: (v) => { state.ratio = v; changed(true); } });
  $('#binary-box').append(rhoSlider, paSlider, ratioSlider);
  bSlider = slider({ label: 'B (m)', min: 0, max: 10, step: 0.001, value: state.B, title: 'The baseline: the distance between the outer mirrors', onInput: (v) => { setSweep(false); setB(Math.max(0, v)); } });
  $('#baseline-box').append(bSlider);
  lamSlider = slider({ label: 'λ (nm)', min: 400, max: 800, step: 1, value: state.lam, title: 'The middle of the band of light used', onInput: (v) => { state.lam = v; changed(); } });
  bwSlider = slider({ label: 'Δλ (nm)', min: 0, max: 300, step: 1, value: state.bw, title: 'The width of the band (0: one wavelength)', onInput: (v) => { state.bw = v; changed(true); } });
  $('#light-box').append(lamSlider, bwSlider);
  seeingToggle = toggle('Atmosphere', state.seeing, (on) => { state.seeing = on; onChange(); hooks.kick?.(); }, 'The air above the telescope delays the two beams differently, and the fringes dance');
  $('#seeing-box').append(seeingToggle);
  $('#st-play').addEventListener('click', () => { setSweep(!state.sweeping); hooks.kick?.(); });
  const targets = {
    betelgeuse: ['Betelgeuse', 'Measured at Mount Wilson in December 1920'],
    capella: ['Capella-like pair', 'Two similar stars about 50 mas apart'],
    sun: ['The Sun at 10 pc', 'A star like the Sun, 10 parsecs away: 0.93 mas'],
  };
  for (const [id, [label, title]] of Object.entries(targets)) $('#targets').append(el('button', { type: 'button', title, onclick: () => hooks.target?.(id) }, label));
  window.addEventListener('resize', () => { dirty = true; });
  rebuild();
  showKind();
}

/** Set everything at once (for set-ups and the hash). */
export function configure(s) {
  Object.assign(state, s);
  rebuild();
  thetaSlider.value = state.theta; limbSlider.value = state.limb; rhoSlider.value = state.rho; paSlider.value = state.pa;
  ratioSlider.value = state.ratio; lamSlider.value = state.lam; bwSlider.value = state.bw; kindSeg.value = state.kind;
  seeingToggle.on = state.seeing;
  bSlider.setRange(0, +xmax.toPrecision(3)); bSlider.value = state.B;
  setSweep(state.sweeping);
  showKind();
  dirty = true;
}

export function profile() { return lastProfile; }
