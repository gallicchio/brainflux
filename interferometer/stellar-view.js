// Michelson's stellar interferometer on the page: the beam across the telescope (drag the outer
// mirrors), the star with the interferometer's fringe pattern projected on the sky, the fringes
// at the focus in true colour, and the visibility against baseline.
//
// In Michelson's design (Mount Wilson, 1920) two outer mirrors a distance B apart collect the
// starlight and two inner mirrors, at a fixed separation b, send it into the telescope.  The
// fringe spacing at the focus is set by b, so it does not change; their visibility is set by B.

import { el, $, slider, segmented, toggle, fmt, setGroups } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors, fillSlots } from '../lib/plot.js';
import { MAS, makeModel, visibility, bandVisibility, bandSamples, firstNull, airyAmp } from './stars.js';
import { cmf, xyzToLinear, gamutFix, wavelengthColour, toBytes, ENCODE_TABLE, ENCODE_SCALE } from './colour.js';

export const state = {
  kind: 'single', theta: 47, limb: 0, rho: 50, pa: 0, ratio: 0.8,
  B: 1, lam: 575, bw: 0, seeing: false, sweeping: true,
};

const B_INNER = 1.14;     // the inner mirrors' separation (m), drawn only
let model = null, xmax = 6, dirty = true, sweepDir = 1, atm = 0, onChange = () => {}, nullB = Infinity;
let bSlider, thetaSlider, limbSlider, rhoSlider, paSlider, ratioSlider, lamSlider, bwSlider, kindSeg, seeingToggle;

export const getModel = () => model;

function rebuild(keepRange = false) {
  model = makeModel({ theta: state.theta * MAS, binary: state.kind === 'binary', rho: state.rho * MAS, pa: (state.pa * Math.PI) / 180, ratio: state.ratio, limb: state.limb });
  const lam = state.lam * 1e-9, single = makeModel({ theta: state.theta * MAS, limb: state.limb });
  nullB = state.theta > 0 ? firstNull(single, lam, (5 * lam) / (state.theta * MAS)) : Infinity;
  if (!keepRange) {
    // Show the first null (or a few beats) and some way beyond.
    const B1 = nullB;
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

/** The first null of a single disk like the star (cached when the star or the light changes). */
export function firstNullB() { return nullB; }

const samples = () => bandSamples(state.lam * 1e-9, state.bw * 1e-9, state.bw > 0 ? 21 : 1);

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
    // A label with a live number comes as parts for fillSlots, its words kept still.
    ctx.fillStyle = col; if (Array.isArray(s)) fillSlots(ctx, s, px, py); else ctx.fillText(s, px, py);
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
  label(['beam, ', { v: Lb, dec: 1, w: 4 }, ' m long'], 4, by + 4.5, 'left', dim, 9);
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
  label(['B = ', { v: state.B, dec: 3, w: 6 }, ' m'], Math.max(xo[1] + 2, 60), dimY, 'left', text, 11);
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
  const per = { v: period, dec: 1, w: 6 };
  if (pxPer > 3) fillSlots(ctx, ['fringes on the sky: λ/B = ', per, ' mas'], width - 10, height - 8);
  else if (state.B > 0) fillSlots(ctx, ['λ/B = ', per, ' mas: too fine to draw'], width - 10, height - 8);
  else ctx.fillText('B = 0: no fringes', width - 10, height - 8);
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('baseline →', 12, 10);
  setGroups($('#sky-note'), binary ? [['two stars ', { v: state.rho, dec: 1, w: 5 }, ' mas apart,'], ['each ', { v: state.theta, dec: 1, w: 5 }, ' mas across']]
    : [[{ v: state.theta, dec: 1, w: 5 }, ' mas'], ['= ', { v: state.theta / 1000, dec: 5, w: 7 }, '″ across']]);
}
function niceLen(x) { const p = 10 ** Math.floor(Math.log10(x)), f = x / p; return (f < 2 ? 1 : f < 5 ? 2 : 5) * p; }

// --------------------------------------------------------------------- the fringes at the focus

const fringeCanvas = $('#fringes');
let fOff = null, fImg = null, envelope = null;
const FX = 7, FY = 3.6;    // the image spans ±FX fringes across and ±FY up and down
let lastProfile = null;

/** Wavelength samples for the image: enough that the fringe phase 2πfλ0/λ moves < 0.6 rad between them at f = FX. */
function imageSamples() {
  if (!(state.bw > 0)) return samples();
  const lam = state.lam, sd = state.bw / 2.3548, lo = Math.max(300, lam - 2.5 * sd), hi = lam + 2.5 * sd;
  const n = Math.max(9, Math.min(161, Math.ceil((2 * Math.PI * FX * (lam / lo - lam / hi)) / 0.6) + 1));
  return bandSamples(lam * 1e-9, state.bw * 1e-9, n | 1);
}

// The diffraction envelope of the (round) inner mirrors, (2J₁(a)/a)², a = (π/4) ρ in units of
// the fringe spacing (inner mirrors 4 diameters apart): drawn for the central wavelength.
function envelopeOf(nx, ny) {
  if (envelope && envelope.nx === nx && envelope.ny === ny) return envelope.A;
  const A = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const y = FY - ((j + 0.5) * 2 * FY) / ny;
    for (let i = 0; i < nx; i++) { const x = -FX + ((i + 0.5) * 2 * FX) / nx; A[j * nx + i] = airyAmp((Math.PI / 4) * Math.sqrt(x * x + y * y)) ** 2; }
  }
  envelope = { nx, ny, A };
  return A;
}

function drawFringes() {
  const { ctx, width, height } = fitCanvas(fringeCanvas);
  const imgH = Math.round(height * 0.68), dpr = window.devicePixelRatio || 1;
  const nx = Math.max(64, Math.min(480, Math.round(width * dpr * 0.75))), ny = Math.max(24, Math.round((nx * imgH) / width));
  if (!fOff || fOff.width !== nx || fOff.height !== ny) { fOff = document.createElement('canvas'); fOff.width = nx; fOff.height = ny; fImg = fOff.getContext('2d').createImageData(nx, ny); }
  const lam0 = state.lam * 1e-9, v = [0, 0];
  // The fringe term summed over the band, column by column: X(f) = Σ w x̄ [1 + Re(V e^{i(2πfλ0/λ + φ)})].
  const FXc = new Float64Array(nx), FYc = new Float64Array(nx), FZc = new Float64Array(nx), base = [0, 0, 0];
  for (const [lam, w] of imageSamples()) {
    visibility(model, state.B / lam, v);
    const k = lam0 / lam, cm = cmf(lam * 1e9), cx = w * cm[0], cy = w * cm[1], cz = w * cm[2];
    base[0] += cx; base[1] += cy; base[2] += cz;
    for (let i = 0; i < nx; i++) {
      const f = -FX + ((i + 0.5) * 2 * FX) / nx, ph = 2 * Math.PI * f * k + atm;
      const t = 1 + v[0] * Math.cos(ph) - v[1] * Math.sin(ph);
      FXc[i] += cx * t; FYc[i] += cy * t; FZc[i] += cz * t;
    }
  }
  const rgbMax = gamutFix(xyzToLinear(2 * base[0], 2 * base[1], 2 * base[2])), expo = 1 / Math.max(...rgbMax, 1e-9);
  const A = envelopeOf(nx, ny), out = new Uint32Array(fImg.data.buffer), E = ENCODE_TABLE, ES = ENCODE_SCALE;
  for (let j = 0, p = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++, p++) {
      const g = A[p] * expo, X = FXc[i] * g, Y = FYc[i] * g, Z = FZc[i] * g;
      const R = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z, G = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z, B = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
      out[p] = (0xff000000 | (E[((B <= 0 ? 0 : B >= 1 ? 1 : B) * ES + 0.5) | 0] << 16) | (E[((G <= 0 ? 0 : G >= 1 ? 1 : G) * ES + 0.5) | 0] << 8)
        | E[((R <= 0 ? 0 : R >= 1 ? 1 : R) * ES + 0.5) | 0]) >>> 0;
    }
  }
  fOff.getContext('2d').putImageData(fImg, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(fOff, 0, 0, width, imgH);
  // The brightness across the middle, below the image.
  const prof = new Float64Array(nx);
  for (let i = 0; i < nx; i++) { const f = -FX + ((i + 0.5) * 2 * FX) / nx; prof[i] = (airyAmp((Math.PI / 4) * Math.abs(f)) ** 2 * FYc[i]) / (2 * base[1] || 1); }
  const f = new Frame(ctx, width, height - imgH, { left: 8, right: 8, top: 18, bottom: 6 });
  f.top += imgH; f.bottom += imgH;
  f.x0 = -FX; f.x1 = FX; f.y0 = 0; f.y1 = 1.05;
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(f.left, f.Y(0.5)); ctx.lineTo(f.right, f.Y(0.5)); ctx.stroke();
  ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i < nx; i++) { const x = f.X(-FX + ((i + 0.5) * 2 * FX) / nx), y = f.Y(prof[i]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  ctx.stroke();
  lastProfile = prof;
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('brightness across the middle', f.left + 2, imgH + 4);
  const V = Math.hypot(...currentV());
  setGroups($('#fringe-note'), [['visibility ', { v: V, dec: 3, w: 5 }], ...(state.bw > 0 ? [['over ', { v: state.bw, dec: 0, w: 3 }, ' nm']] : [])]);
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
    fillSlots(ctx, [{ v: k, dec: 2, w: 4 }, ' λ/θ = ', { v: B1, dec: 2, w: 6 }, ' m'], f.X(B1) + 4, f.top + 4);
  }
  // Monochromatic |V(B/λ)|, and over the band.
  const curve = (fn, style, dash, w, m = n) => {
    ctx.strokeStyle = style; ctx.lineWidth = w; ctx.setLineDash(dash); ctx.beginPath();
    for (let i = 0; i <= m; i++) { const B = (xmax * i) / m, y = f.Y(fn(B)); if (i) ctx.lineTo(f.X(B), y); else ctx.moveTo(f.X(B), y); }
    ctx.stroke(); ctx.setLineDash([]);
  };
  curve((B) => Math.hypot(...visibility(model, B / lam, v)), c.accent, [], 2);
  const S = samples();
  if (state.bw > 0) curve((B) => Math.hypot(...bandVisibility(model, B, S, v)), c.ink2, [5, 4], 1.5, Math.ceil(n / 2));
  // The present baseline.
  const Vn = Math.hypot(...currentV()), x = f.X(state.B);
  ctx.strokeStyle = c.warn; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, f.top); ctx.lineTo(x, f.bottom); ctx.stroke();
  ctx.fillStyle = c.warn; ctx.beginPath(); ctx.arc(x, f.Y(Vn), 5, 0, 2 * Math.PI); ctx.fill();
  ctx.restore();
  f.axes({ xlabel: 'baseline B (m)', ylabel: '|V|', colors: c });
  ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  ctx.fillStyle = c.accent; fillSlots(ctx, ['at λ = ', { v: state.lam, dec: 0, w: 3 }, ' nm'], f.right - 6, f.top + 4);
  if (state.bw > 0) { ctx.fillStyle = c.ink2; fillSlots(ctx, ['- - over ', { v: state.bw, dec: 0, w: 3 }, ' nm'], f.right - 6, f.top + 18); }
  $('#vis-note').textContent = 'click or drag to set the baseline';
}
function visPointer(e) { const r = visCanvas.getBoundingClientRect(); return visFrame.invX(e.clientX - r.left); }
visCanvas.addEventListener('pointerdown', (e) => { if (!visFrame) return; visCanvas.setPointerCapture(e.pointerId); visDrag = true; setSweep(false); setB(Math.max(0, Math.min(xmax, visPointer(e)))); });
visCanvas.addEventListener('pointermove', (e) => { if (visDrag) setB(Math.max(0, Math.min(xmax, visPointer(e)))); });
visCanvas.addEventListener('pointerup', () => { visDrag = false; });
visCanvas.addEventListener('pointercancel', () => { visDrag = false; });

// --------------------------------------------------------------------- read-outs and controls

// A line each, every number in a slot of its own (setGroups), so that nothing moves as they change.
const stLines = [];
function updateReadout() {
  const V = currentV(), lam = state.lam * 1e-9, B1 = firstNullB();
  const lines = [[['|V| = ', { v: Math.hypot(...V), dec: 3, w: 5 }], ['at B = ', { v: state.B, dec: 3, w: 6 }, ' m']]];
  if (Number.isFinite(B1)) lines.push(['first null of one star:', ['B = ', { v: B1, dec: 3, w: 7 }, ' m']]);
  if (state.B > 0) lines.push(['fringes on the sky', ['λ/B = ', { v: lam / state.B / MAS, dec: 1, w: 7 }, ' mas']]);
  if (state.kind === 'binary') {
    const proj = state.rho * Math.cos((state.pa * Math.PI) / 180);
    if (Math.abs(proj) > 1e-6) lines.push(['beat period', ['λ/(ρ cos φ) = ', { v: lam / (Math.abs(proj) * MAS), dec: 3, w: 7 }, ' m']]);
  }
  const box = $('#st-readout');
  while (stLines.length < lines.length) stLines.push(el('div'));
  if (box.childElementCount !== lines.length) box.replaceChildren(...stLines.slice(0, lines.length));
  lines.forEach((l, i) => setGroups(stLines[i], l));
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

export const timings = {};

export function isBusy() { return state.sweeping || state.seeing; }

export function frame() {
  if (!dirty) return;
  dirty = false;
  for (const [k, fn] of [['schem', drawSchematic], ['sky', drawSky], ['fringes', drawFringes], ['vis', drawVisibility], ['readout', updateReadout]]) {
    const t0 = performance.now(); fn(); timings[k] = performance.now() - t0;
  }
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
  bwSlider = slider({ label: 'Δλ (nm)', min: 0, max: 200, step: 1, value: state.bw, title: 'The width of the band (0: one wavelength)', onInput: (v) => { state.bw = v; changed(true); } });
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

/** For the tests: the outer mirrors' handles (CSS px) and the canvas size. */
export function handlePoints() {
  const r = schem.getBoundingClientRect();
  return hits ? { w: r.width, h: r.height, handles: hits.handles } : null;
}
