// Maxwell's equations in 2D: paint materials, place sources, watch the fields.
// Units: c = 1, lengths in vacuum wavelengths of the source, time in its periods.

import { Yee2D, PointSource, BeamSource, MovingSource, Probe, FluxLine, FlowField, PULSE, isOn } from './fdtd.js';
import { Scene, SHAPES, MATERIALS, GUIDE_START, BEND_Y } from './scene.js';
import { DIVERGING, SEQUENTIAL, materialImage, outlines, fieldImage, typical, tintOf } from './render.js';
import * as theory from './theory.js';
import { el, $, slider, segmented, toggle, exprField, drawer, readHash, writeHash, fmt, toast } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors, contour } from '../lib/plot.js';

const deg = Math.PI / 180;
const PML = 16;

const state = {
  W: 16, H: 10, ppw: 24,
  mode: 'TM',
  shape: 'prism', p: SHAPES.prism.p[2], n: 1.5,
  bg: '1', bgParams: {},
  paint: [],
  brush: 'glass', brushN: 2, brushSize: 0.3,
  src: { type: 'beam', x: -5, y: -0.6, angle: 0, width: 1, wave: 'cw', beta: 0.9, mwave: 'steady' },
  view: 'field', flow: false, probe: null, meters: [],
  running: true, speed: 2, bright: 0,
};

let scene, sim, source = null, probe = null, meters = [], flow = null;
let mats = null, lines = [], bgLines = null, offscreen = null, offImg = null, offTime = 0;
let brightR = 1e-3, brightI = 1e-6, warning = '', srcWarning = '';

// --------------------------------------------------------------------------- building

const materialOf = (key) => {
  if (key === 'typed') return { n: state.brushN };
  const m = MATERIALS[key];
  return m.pec ? { pec: true } : m.absorb ? { absorb: true } : m.bg ? { bg: true } : { n: m.n };
};

let bgFn = null;
function build() {
  scene = new Scene({ W: state.W, H: state.H, ppw: state.ppw, pml: PML });
  state.W = scene.W; state.H = scene.H;
  scene.setBackground(bgFn);
  scene.shapeOps = state.shape ? SHAPES[state.shape].build(state.p, state.n, scene.W, scene.H) : [];
  scene.paintOps = state.paint;
  scene.rebuild();
  sim = new Yee2D({ nx: scene.nx, ny: scene.ny, dx: scene.dx, pml: PML, x0: scene.x0, y0: scene.y0, mode: state.mode, precision: 32 });
  scene.applyTo(sim);
  sim.trackIntensity(state.view === 'intensity', 1, false);
  refreshMaterials();
  makeSource(true);
  makeMonitors();
  layout();
}

/** After the materials change: the pictures of them, and the grid's resolution. */
function refreshMaterials() {
  mats = materialImage(scene);
  lines = outlines(scene);
  bgLines = backgroundContours();
  const nmax = scene.maxIndex(), cells = state.ppw / nmax;
  warning = cells < 10 ? `Too coarse: ${fmt(cells, 2)} cells per wavelength in n = ${fmt(nmax, 3)} (want 15 or more): raise the cells per λ (Grid).`
    : cells < 15 ? `Coarse: ${fmt(cells, 2)} cells per wavelength in n = ${fmt(nmax, 3)}; 15 or more is better (Grid).` : '';
  if (source) makeSource(false);
}

/** Contours of the background index, if it was typed and is not uniform: up to five levels. */
function backgroundContours() {
  if (!scene.bgEps) return null;
  const { cw, ch, pml, fx, bgEps } = scene, S = 4, nx = cw, n = new Float32Array(cw * ch);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const v = Math.sqrt(bgEps[((j + pml) * S + 2) * fx + (i + pml) * S + 2]);
    n[j * nx + i] = v; lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  if (!(hi - lo > 1e-3)) return null;
  const step = niceStep((hi - lo) / 5), segs = [];
  for (let level = Math.ceil(lo / step + 1e-9) * step; level < hi - 1e-9; level += step) {
    const out = [];
    contour(n, cw, ch, level, (x0, y0, x1, y1) => out.push((x0 + 0.5) * scene.dx - scene.W / 2, (y0 + 0.5) * scene.dx - scene.H / 2, (x1 + 0.5) * scene.dx - scene.W / 2, (y1 + 0.5) * scene.dx - scene.H / 2));
    segs.push(Float32Array.from(out));
  }
  return { segs, lo, hi, step };
}
function niceStep(raw) { const p = 10 ** Math.floor(Math.log10(raw)), f = raw / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; }

/** Zero the fields inside perfect conductors (they are frozen there, and must be zero). */
function clearMetal(region) {
  const [i0, i1, j0, j1] = region, { nx, u, a, b, Ku, Cu, Ka, Ca, Kb, Cb } = sim;
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
    const k = j * nx + i;
    if (Ku[k] === 0 && Cu[k] === 0) u[k] = 0;
    if (Ka[k] === 0 && Ca[k] === 0) a[k] = 0;
    if (Kb[k] === 0 && Cb[k] === 0) b[k] = 0;
  }
}

/** The sim's source from state.src; `fresh` starts it at t = now (else keeps its clock). */
function makeSource(fresh) {
  const s = state.src, t0 = fresh || !source ? (sim.t > 0 ? sim.t : 0) : source.t0;
  srcWarning = '';
  if (s.type === 'point') source = new PointSource({ x: s.x, y: s.y, wave: s.wave, t0 });
  else if (s.type === 'beam') {
    const m = scene.materialAt(s.x, s.y), n = m.pec ? 1 : m.n;
    if (m.pec || m.absorb) srcWarning = 'The beam starts inside metal or absorber: move it.';
    // Its injection line must lie in one uniform medium: shorten it where it meets another.
    const c = Math.cos(s.angle * deg), si = Math.sin(s.angle * deg), want = 2.6 * s.width;
    let L = want;
    for (let d = 0; d <= want; d += scene.dx / 2) {
      let differs = false;
      for (const sign of [1, -1]) for (const off of [-1.5 * scene.dx, 0, 1.5 * scene.dx]) {
        const x = s.x - sign * d * si + off * c, y = s.y + sign * d * c + off * si;
        if (Math.abs(x) > scene.W / 2 || Math.abs(y) > scene.H / 2) continue;
        const mm = scene.materialAt(x, y);
        if (mm.pec !== m.pec || mm.absorb !== m.absorb || Math.abs(mm.n - m.n) > 1e-6) differs = true;
      }
      if (differs) { L = Math.max(scene.dx, d - scene.dx); break; }
    }
    if (L < 2 * s.width && !srcWarning) srcWarning = `The beam's source line meets another material ${fmt(L, 2)} λ from its centre and is cut short there: move it into a uniform region.`;
    source = new BeamSource({ x: s.x, y: s.y, angle: s.angle * deg, width: s.width, wave: s.wave, t0, n, halfLength: L });
  } else if (s.type === 'moving') {
    source = new MovingSource({ x: s.x, y: s.y, angle: s.angle * deg, beta: s.beta, wave: s.mwave, t0, size: 0.2,
      box: [-scene.W / 2, scene.W / 2, -scene.H / 2, scene.H / 2] });
  } else source = null;
  sim.sources = source ? [source] : [];
}

function makeMonitors() {
  probe = state.probe ? new Probe({ x: state.probe.x, y: state.probe.y }) : null;
  meters = state.meters.map((m) => new FluxLine(m));
  flow = state.flow ? new FlowField(flowNodes()) : null;
  sim.monitors = [probe, ...meters, flow].filter(Boolean);
}

/** Nodes for the energy-flow arrows: a coarse grid, about 34 px apart on the screen. */
function flowNodes() {
  const out = [], { cw, ch } = scene, px = (viewCanvas.clientWidth || 800) / cw;
  const step = Math.max(2, Math.round(34 / px));
  for (let j = Math.floor(step / 2); j < ch; j += step) for (let i = Math.floor(step / 2); i < cw; i += step) out.push((j + PML) * scene.nx + i + PML);
  return out;
}

function restart() {
  sim.clear();
  if (source) { source.t0 = 0; if (source.type === 'moving') makeSource(true); }
  for (const m of sim.monitors) m.reset?.();
  brightR = 1e-3; brightI = 1e-6;
  kick();
}

// --------------------------------------------------------------------------- the picture

const viewCanvas = $('#view'), wrap = $('#view-wrap');

function layout() {
  wrap.style.aspectRatio = `${scene.W} / ${scene.H}`;
  wrap.style.maxWidth = `calc((100vh - ${state.probe ? 330 : 190}px) * ${scene.W / scene.H})`;
  offscreen = document.createElement('canvas');
  offscreen.width = scene.cw; offscreen.height = scene.ch;
  offImg = offscreen.getContext('2d').createImageData(scene.cw, scene.ch);
  if (state.flow) flow = new FlowField(flowNodes()), sim.monitors = [probe, ...meters, flow].filter(Boolean);
}

let handles = [];
const fieldName = () => (state.mode === 'TM' ? 'Ez' : 'Hz');

function draw() {
  const { ctx, width, height } = fitCanvas(viewCanvas);
  const s = width / scene.W, X = (x) => (x + scene.W / 2) * s, Y = (y) => (scene.H / 2 - y) * s;
  // Brightness: a typical size of the field, followed smoothly.
  if (frameCount % 4 === 0 || !state.running) {
    if (state.view === 'intensity' && sim.intensity) {
      const T = typical(sim.intensity, scene, sim.nx, 0.995) * 0.5;
      brightI = T > 2 * brightI ? T : brightI + 0.15 * (T - brightI);
    } else {
      const T = typical(sim.u, scene, sim.nx, 0.99) * 0.6;
      brightR = T > 2 * brightR ? T : brightR + 0.15 * (T - brightR);
    }
  }
  const R = (state.view === 'intensity' ? Math.max(brightI, 1e-12) : Math.max(brightR, 1e-9)) * 10 ** -state.bright;
  fieldImage(offImg, sim, scene, mats, R, state.view === 'intensity' && sim.intensity ? 'intensity' : 'field');
  offscreen.getContext('2d').putImageData(offImg, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(offscreen, 0, 0, width, height);

  // Contours of a typed background index, then the outlines of the painted materials.
  if (bgLines) {
    ctx.save(); ctx.setLineDash([2, 4]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(170,205,255,0.4)';
    ctx.beginPath();
    for (const g of bgLines.segs) for (let q = 0; q < g.length; q += 4) { ctx.moveTo(X(g[q]), Y(g[q + 1])); ctx.lineTo(X(g[q + 2]), Y(g[q + 3])); }
    ctx.stroke(); ctx.restore();
  }
  ctx.lineWidth = 1;
  for (const o of lines) {
    ctx.strokeStyle = o.pec ? 'rgba(235,240,250,0.9)' : o.absorb ? 'rgba(200,150,110,0.6)' : 'rgba(170,205,255,0.55)';
    ctx.beginPath();
    const g = o.segs;
    for (let q = 0; q < g.length; q += 4) { ctx.moveTo(X(g[q]), Y(g[q + 1])); ctx.lineTo(X(g[q + 2]), Y(g[q + 3])); }
    ctx.stroke();
  }
  if (flow) drawFlow(ctx, X, Y, s);
  drawPhysics(ctx, X, Y, s);
  handles = [];
  drawSource(ctx, X, Y, s);
  drawMeters(ctx, X, Y);
  drawProbe(ctx, X, Y);
  drawLegend(ctx, width, height, s);
}

function arrow(ctx, x0, y0, x1, y1, head = 9) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - head * Math.cos(a - 0.45), y1 - head * Math.sin(a - 0.45));
  ctx.lineTo(x1 - head * Math.cos(a + 0.45), y1 - head * Math.sin(a + 0.45));
  ctx.closePath(); ctx.fill();
}

function drawFlow(ctx, X, Y, s) {
  let top = 0;
  for (let m = 0; m < flow.nodes.length; m++) top = Math.max(top, Math.hypot(flow.sx[m], flow.sy[m]));
  if (!(top > 0)) return;
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.2;
  const L = 26;
  for (let m = 0; m < flow.nodes.length; m++) {
    const k = flow.nodes[m], i = k % sim.nx, j = (k - i) / sim.nx;
    const mag = Math.hypot(flow.sx[m], flow.sy[m]) / top;
    if (mag < 0.02) continue;
    // Length grows as the square root of the power flow, so weak flows still show.
    const len = L * Math.sqrt(mag), ux = flow.sx[m] / (mag * top), uy = flow.sy[m] / (mag * top);
    const x = X(sim.nodeX(i)), y = Y(sim.nodeY(j));
    arrow(ctx, x - (ux * len) / 2, y + (uy * len) / 2, x + (ux * len) / 2, y - (uy * len) / 2, 5);
  }
}

function dashed(ctx, x0, y0, x1, y1) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }

/** What the analytic theory predicts, drawn over the picture: refraction at the surface, the
 *  Cherenkov cone, the directions of the double slit's fringes, the lens's focus. */
function drawPhysics(ctx, X, Y, s) {
  ctx.save();
  ctx.setLineDash([6, 5]); ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '12px system-ui, sans-serif';
  const pred = predictions();
  if (pred.ray) {
    const { hit, refl, trans } = pred.ray, L = 4;
    dashed(ctx, X(hit[0]), Y(hit[1]), X(hit[0] + L * refl[0]), Y(hit[1] + L * refl[1]));
    if (trans) dashed(ctx, X(hit[0]), Y(hit[1]), X(hit[0] + L * trans[0]), Y(hit[1] + L * trans[1]));
  }
  if (pred.cone) {
    const { x, y, ang, alpha } = pred.cone, L = 12;
    for (const sg of [1, -1]) dashed(ctx, X(x), Y(y), X(x - L * Math.cos(ang + sg * alpha)), Y(y - L * Math.sin(ang + sg * alpha)));
  }
  if (pred.fringes) {
    const { x, y, angles } = pred.fringes, L = 12;
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    for (const a of angles) dashed(ctx, X(x), Y(y), X(x + L * Math.cos(a)), Y(y + L * Math.sin(a)));
  }
  if (pred.focus) {
    const [fx, fy] = pred.focus;
    ctx.setLineDash([]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    dashed(ctx, X(fx) - 7, Y(fy), X(fx) + 7, Y(fy)); dashed(ctx, X(fx), Y(fy) - 7, X(fx), Y(fy) + 7);
  }
  ctx.restore();
}

function drawSource(ctx, X, Y, s) {
  const src = state.src;
  if (src.type === 'off' || !source) return;
  ctx.save();
  ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff';
  const x = X(src.x), y = Y(src.y);
  if (src.type === 'point') {
    ctx.beginPath(); ctx.arc(x, y, 7, 0, 2 * Math.PI); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 7, 0, 2 * Math.PI); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 2 * Math.PI); ctx.fill();
    handles.push({ kind: 'move', x, y });
  } else if (src.type === 'beam') {
    const [[xa, ya], [xb, yb]] = source.ends();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3;
    dashed(ctx, X(xa), Y(ya), X(xb), Y(yb));
    const c = Math.cos(src.angle * deg), si = Math.sin(src.angle * deg), w = src.width;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3;
    dashed(ctx, X(src.x + w * si), Y(src.y - w * c), X(src.x - w * si), Y(src.y + w * c));
    const len = Math.max(1.2, 46 / s), tx = X(src.x + len * c), ty = Y(src.y + len * si);
    ctx.lineWidth = 2; arrow(ctx, x, y, tx, ty, 10);
    ctx.beginPath(); ctx.arc(tx, ty, 8, 0, 2 * Math.PI); ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 5, 0, 2 * Math.PI); ctx.fillStyle = '#fff'; ctx.fill();
    handles.push({ kind: 'move', x, y }, { kind: 'aim', x: tx, y: ty });
  } else if (src.type === 'moving') {
    const c = Math.cos(src.angle * deg), si = Math.sin(src.angle * deg), len = Math.max(1.2, 46 / s);
    ctx.setLineDash([4, 5]); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
    dashed(ctx, x, y, X(src.x + 40 * c), Y(src.y + 40 * si));
    ctx.setLineDash([]);
    ctx.strokeRect(x - 5, y - 5, 10, 10);
    const tx = X(src.x + len * c), ty = Y(src.y + len * si);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2; arrow(ctx, x, y, tx, ty, 10);
    ctx.beginPath(); ctx.arc(tx, ty, 8, 0, 2 * Math.PI); ctx.lineWidth = 1.2; ctx.stroke();
    const [px, py] = source.position(sim.t);
    ctx.beginPath(); ctx.arc(X(px), Y(py), 5, 0, 2 * Math.PI); ctx.fillStyle = '#ffe08a'; ctx.fill();
    handles.push({ kind: 'move', x, y }, { kind: 'aim', x: tx, y: ty });
  }
  ctx.restore();
}

const METER_NAMES = ['A', 'B'];
function drawMeters(ctx, X, Y) {
  ctx.save();
  ctx.font = '600 12px system-ui, sans-serif';
  state.meters.forEach((m, q) => {
    const x0 = X(m.x0), y0 = Y(m.y0), x1 = X(m.x1), y1 = Y(m.y1);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4; dashed(ctx, x0, y0, x1, y1);
    ctx.strokeStyle = '#7ef0c8'; ctx.lineWidth = 2; dashed(ctx, x0, y0, x1, y1);
    // The direction counted as positive: to the right of the way from the first end to the second.
    const L = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / L, ny = (x1 - x0) / L, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    ctx.fillStyle = '#7ef0c8'; ctx.lineWidth = 1.5;
    arrow(ctx, mx, my, mx + 16 * nx, my + 16 * ny, 6);
    for (const [hx, hy, end] of [[x0, y0, 0], [x1, y1, 1]]) {
      ctx.beginPath(); ctx.arc(hx, hy, 5, 0, 2 * Math.PI); ctx.fill();
      handles.push({ kind: 'meter', q, end, x: hx, y: hy });
    }
    const label = `${METER_NAMES[q]} ${meterText(q)}`;
    const tw = ctx.measureText(label).width, lx = Math.min(viewCanvas.clientWidth - tw - 6, Math.max(4, mx + 12 * nx + (nx > 0 ? 0 : -tw))), ly = Math.max(14, my + 12 * ny + 4);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(lx - 3, ly - 12, tw + 6, 16);
    ctx.fillStyle = '#7ef0c8'; ctx.fillText(label, lx, ly);
  });
  ctx.restore();
}

/** A meter's reading: a percentage of the beam's power, or (for other sources) of meter A. */
function meterValue(q) {
  const m = meters[q];
  if (!m || !m.filled) return NaN;
  if (source && source.type === 'beam' && state.src.wave === 'cw') return m.power / source.power(state.mode);
  if (q > 0 && meters[0] && Math.abs(meters[0].power) > 0) return m.power / meters[0].power;
  return m.power;
}
function meterText(q) {
  const v = meterValue(q);
  if (!Number.isFinite(v)) return '';
  if (source && source.type === 'beam' && state.src.wave === 'cw') return `${fmt(100 * v, 3)}%`;
  if (q > 0) return `${fmt(100 * v, 3)}% of A`;
  return fmt(v, 3);
}

function drawProbe(ctx, X, Y) {
  if (!state.probe) return;
  const x = X(state.probe.x), y = Y(state.probe.y);
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 4;
  dashed(ctx, x - 9, y, x + 9, y); dashed(ctx, x, y - 9, x, y + 9);
  ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 2;
  dashed(ctx, x - 9, y, x + 9, y); dashed(ctx, x, y - 9, x, y + 9);
  ctx.fillStyle = '#ffe08a'; ctx.font = '600 12px system-ui, sans-serif'; ctx.fillText('probe', x + 8, y - 8);
  ctx.restore();
  handles.push({ kind: 'probe', x, y });
}

function drawLegend(ctx, width, height, s) {
  ctx.save();
  const lut = state.view === 'intensity' ? SEQUENTIAL : DIVERGING, w = 90, h = 8, x0 = 10, y0 = height - 18;
  for (let q = 0; q < w; q++) {
    const c = 3 * Math.round((q / (w - 1)) * 1023);
    ctx.fillStyle = `rgb(${lut[c]},${lut[c + 1]},${lut[c + 2]})`;
    ctx.fillRect(x0 + q, y0, 1, h);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(x0 - 0.5, y0 - 0.5, w + 1, h + 1);
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(state.view === 'intensity' ? `time average of ${fieldName()}²` : `${fieldName()}: − 0 +`, x0, y0 - 4);
  // A scale bar of one wavelength.
  const L = s, xr = width - 12 - L;
  ctx.fillRect(xr, y0 + 2, L, 3);
  ctx.textAlign = 'center'; ctx.fillText('λ', xr + L / 2, y0 - 3);
  ctx.restore();
}

// --------------------------------------------------------------------------- predictions

function predictions() {
  const out = {}, src = state.src;
  if (src.type === 'beam' && state.shape === 'surface') {
    const tau = state.p * deg, tx = Math.cos(tau), ty = Math.sin(tau), nx = -ty, ny = tx;   // normal into the upper side
    const dx = Math.cos(src.angle * deg), dy = Math.sin(src.angle * deg);
    const sn = src.x * nx + src.y * ny, dn = dx * nx + dy * ny;
    const lam = -sn / dn;
    if (lam > 0 && Math.abs(dn) > 1e-6) {
      const hit = [src.x + lam * dx, src.y + lam * dy];
      const sideN = Math.sign(sn) || 1;   // the incident side's normal
      const n1 = scene.materialAt(hit[0] + 0.05 * sideN * nx, hit[1] + 0.05 * sideN * ny).n;
      const n2 = scene.materialAt(hit[0] - 0.05 * sideN * nx, hit[1] - 0.05 * sideN * ny).n;
      const cos1 = Math.abs(dn), th1 = Math.acos(Math.min(1, cos1)), tc = dx * tx + dy * ty;
      const refl = [dx - 2 * dn * nx, dy - 2 * dn * ny];
      const s2 = (n1 / n2) * Math.sin(th1);
      let trans = null, th2 = NaN;
      if (s2 <= 1 && Number.isFinite(n2)) {
        th2 = Math.asin(s2);
        const st = (n1 / n2) * tc, cn = Math.cos(th2);
        trans = [st * tx - sideN * cn * nx, st * ty - sideN * cn * ny];
      }
      out.ray = { hit, refl, trans, th1, th2, n1, n2 };
    }
  }
  if (src.type === 'moving') {
    const [x, y] = source ? source.position(sim.t) : [src.x, src.y];
    const n = scene.materialAt(x, y).n;
    if (Number.isFinite(n) && n * src.beta > 1) out.cone = { x, y, ang: src.angle * deg, alpha: Math.asin(1 / (n * src.beta)), n };
  }
  if (state.shape === 'slits') {
    const d = state.p, x = -scene.W / 4 + 0.25, angles = [0];
    for (let m = 1; m <= 3; m++) if (m / d < 1) angles.push(Math.asin(m / d), -Math.asin(m / d));
    out.fringes = { x, y: 0, angles };
  }
  if (state.shape === 'lens') {
    const op = scene.shapeOps[0], f = paraxialFocus(op, state.n);
    if (Number.isFinite(f)) out.focus = [op.x + f, op.y];
  }
  return out;
}

/** Where a ray parallel to the axis, close to it, crosses the axis after the lens (from the
 *  lens's centre), by Snell's law at both surfaces: the paraxial focus of a thick lens. */
function paraxialFocus(op, n) {
  const { R, h } = op, sag = R - Math.sqrt(R * R - h * h), c = R - sag, y0 = 1e-3;
  // First surface: the circle centred at (+c, 0), its left face; second: centred at (-c, 0).
  const meet = (ox, oy, dx, dy, cx) => {   // the ray's first crossing of the circle around (cx, 0)
    const fx = ox - cx, b = fx * dx + oy * dy, cc = fx * fx + oy * oy - R * R, disc = b * b - cc;
    return -b - Math.sqrt(disc) > 1e-9 ? -b - Math.sqrt(disc) : -b + Math.sqrt(disc);
  };
  const refract = (dx, dy, nx, ny, n1, n2) => {
    let ci = -(dx * nx + dy * ny);
    if (ci < 0) { nx = -nx; ny = -ny; ci = -ci; }
    const r = n1 / n2, k = 1 - r * r * (1 - ci * ci);
    const ct = Math.sqrt(k);
    return [r * dx + (r * ci - ct) * nx, r * dy + (r * ci - ct) * ny];
  };
  let ox = -2 * R, oy = y0, dx = 1, dy = 0;
  let t = meet(ox, oy, dx, dy, c); ox += t * dx; oy += t * dy;
  [dx, dy] = refract(dx, dy, (ox - c) / R, oy / R, 1, n);
  t = meet(ox, oy, dx, dy, -c);
  // The second crossing is on the far side of the circle centred at -c: take the larger root.
  const fx = ox + c, b = fx * dx + oy * dy, cc = fx * fx + oy * oy - R * R;
  t = -b + Math.sqrt(b * b - cc);
  ox += t * dx; oy += t * dy;
  [dx, dy] = refract(dx, dy, (ox + c) / R, oy / R, n, 1);
  if (dy >= 0) return NaN;
  return ox + (oy / -dy) * dx;
}

// --------------------------------------------------------------------------- readouts

const readouts = $('#readouts'), notes = $('#notes');
let hover = null;

function updateReadouts() {
  const items = [`<span>t <b>${sim.t.toFixed(2)}</b> periods</span>`,
    `<span>grid <b>${scene.cw}×${scene.ch}</b>, ${state.ppw} cells/λ</span>`];
  if (limited) items.push('<span class="muted">(as fast as this computer goes)</span>');
  if (hover) {
    const m = scene.materialAt(hover.x, hover.y);
    const v = sim.sample(hover.x, hover.y);
    items.push(`<span>x <b>${hover.x.toFixed(2)}</b> y <b>${hover.y.toFixed(2)}</b> λ: ${m.pec ? 'metal' : m.absorb ? 'absorber' : `n <b>${fmt(m.n, 3)}</b>`}, ${fieldName()} <b>${fmt(v, 3)}</b></span>`);
  }
  if (warning) items.push(`<span class="warn">${warning}</span>`);
  if (srcWarning) items.push(`<span class="warn">${srcWarning}</span>`);
  readouts.innerHTML = items.join('');
  notes.innerHTML = physicsNotes().join(' · ');
}

const pct = (v) => (Math.abs(v) < 5e-5 ? '0' : fmt(100 * v, 3));
function physicsNotes() {
  const out = [], src = state.src, pred = predictions(), pol = state.mode === 'TM' ? 'TM (s)' : 'TE (p)';
  if (pred.ray) {
    const { th1, th2, n1, n2 } = pred.ray;
    out.push(`incidence <b>${(th1 / deg).toFixed(1)}°</b> from n = ${fmt(n1, 3)} into n = ${fmt(n2, 3)}`);
    if (Number.isFinite(th2)) {
      out.push(`Snell: refracted at <b>${(th2 / deg).toFixed(1)}°</b> (dashed)`);
      const Rp = theory.reflectance(n1, n2, th1, state.mode);
      let fres = `Fresnel, ${pol}: R = <b>${pct(Rp)}%</b> for a plane wave`;
      if (src.type === 'beam') fres += `, ${pct(theory.beamAverage((t) => theory.reflectance(n1, n2, t, state.mode), th1, n1, src.width))}% for this beam (a spread of angles)`;
      out.push(fres);
      if (n2 > n1) out.push(`Brewster's angle ${(theory.brewsterAngle(n1, n2) / deg).toFixed(1)}°`);
    } else {
      out.push(`beyond the critical angle ${(theory.criticalAngle(n1, n2) / deg).toFixed(1)}°: total internal reflection; the evanescent field falls by 1/e in <b>${fmt(theory.evanescentDepth(n1, n2, th1), 2)} λ</b>`);
    }
  }
  if (state.shape === 'gap' && src.type === 'beam') {
    const n = state.n, th = Math.abs(90 - Math.abs(src.angle)) * deg;
    const T = theory.beamAverage((t) => theory.layerTransmission(n, 1, state.p, t, state.mode), th, n, src.width);
    out.push(`incidence ${(th / deg).toFixed(1)}° (critical ${(theory.criticalAngle(n, 1) / deg).toFixed(1)}°); through a gap of ${fmt(state.p, 3)} λ the plane-wave theory, averaged over this beam's angles, gives T = <b>${fmt(100 * T, 3)}%</b>`);
  }
  if (state.shape === 'metalguide') {
    const w = state.p;
    if (state.mode === 'TE') out.push('TE: the plates guide a wave with E across the gap at any width (no cutoff)');
    else if (w < 0.5) {
      const k = theory.metalGuideDecay(w);
      out.push(`TM needs a width over λ/2: at ${fmt(w, 3)} λ the field decays as e<sup>−κx</sup>, κ = <b>${fmt(k, 3)}</b>/λ, by ${fmt(Math.exp(-4 * k), 2)} over the 4 λ guide`);
    } else out.push(`width ${fmt(w, 3)} λ: over the cutoff λ/2, ${Math.floor(2 * w)} TM mode${Math.floor(2 * w) > 1 ? 's' : ''} can travel`);
  }
  if ((state.shape === 'crystal' || state.shape === 'pcbend') && src) out.push(`lattice a = ${fmt(state.p, 3)} λ: a/λ = <b>${fmt(state.p, 3)}</b> (rods of n = ${fmt(state.n, 3)}, radius a/5)`);
  if (pred.cone) out.push(`nβ = ${fmt(pred.cone.n * src.beta, 3)} > 1: Cherenkov cone at <b>θ = ${(theory.cherenkovAngle(pred.cone.n, src.beta) / deg).toFixed(1)}°</b> to the motion, cos θ = 1/nβ (dashed)`);
  else if (src.type === 'moving' && source) {
    const [x, y] = source.position(sim.t), n = scene.materialAt(x, y).n;
    out.push(`nβ = ${fmt(n * src.beta, 3)} < 1: slower than light in this medium, no cone`);
  }
  if (pred.fringes) out.push(`bright fringes where sin θ = mλ/d: θ = ${pred.fringes.angles.filter((a) => a > 0).map((a) => (a / deg).toFixed(1) + '°').join(', ')} (dashed)`);
  if (pred.focus) out.push(`paraxial focus (+) ${fmt(pred.focus[0] - scene.shapeOps[0].x, 3)} λ from the lens's centre`);
  if (state.shape === 'guide' || state.shape === 'bend') {
    const w = state.shape === 'guide' ? state.p : 0.5;
    out.push(`core ${fmt(w, 3)} λ of n = ${fmt(state.n, 3)}: ${theory.slabModeCount(state.n, 1, w)} guided mode${theory.slabModeCount(state.n, 1, w) > 1 ? 's' : ''} per polarisation`);
  }
  return out;
}

// --------------------------------------------------------------------------- the probe's trace

const traceWrap = $('#trace-wrap'), traceCanvas = $('#trace');
let lastFit = null;
function drawTrace() {
  traceWrap.hidden = !state.probe;
  if (!state.probe || !probe) return;
  const { ctx, width, height } = fitCanvas(traceCanvas), c = themeColors();
  ctx.clearRect(0, 0, width, height);
  const spp = sim.stepsPerPeriod, span = 30 * spp;
  const { t, v } = probe.last(span);
  const f = new Frame(ctx, width, height, { left: 44, right: 10, top: 8, bottom: 26 });
  const t1 = sim.t, t0 = Math.max(0, t1 - 30);
  let top = 1e-12;
  for (let q = 0; q < v.length; q++) top = Math.max(top, Math.abs(v[q]));
  f.x0 = t0; f.x1 = Math.max(t1, t0 + 1); f.y0 = -top * 1.1; f.y1 = top * 1.1;
  f.axes({ xlabel: 'periods', ylabel: fieldName(), yTicks: false });
  f.clip();
  ctx.strokeStyle = c.accent; ctx.lineWidth = 1.3; ctx.beginPath();
  for (let q = 0; q < t.length; q++) { const x = f.X(t[q]), y = f.Y(v[q]); if (q) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  ctx.stroke();
  // A ring-down: once the source has stopped, fit the decay of the peaks.
  lastFit = null;
  // Quiet: the source is off, or its pulse is over; fit from 3 periods after that.
  const end = !source ? offTime : source.wave === 'pulse' ? source.t0 + 2 * PULSE.delay * PULSE.width : Infinity;
  if (sim.t > end + 6) {
    const from = Math.max(t0, end + 3);
    const r = theory.ringdown(t, v, { from, floor: top * 1e-4 });
    if (r && r.dev < 0.2 && r.f > 0) {
      // Too little decay over the window to measure: say only how large Q must be.
      const span = t1 - from, decay = -r.slope * span;
      lastFit = { ...r, bound: decay < 0.05 ? (Math.PI * r.f * span) / 0.05 : null };
    }
    if (lastFit && !lastFit.bound) {
      const r = lastFit;
      ctx.strokeStyle = c.warn; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
      for (const sg of [1, -1]) {
        ctx.beginPath();
        for (let x = from; x <= t1; x += 0.25) { const y = f.Y(sg * Math.exp(r.intercept + r.slope * x)); if (x === from) ctx.moveTo(f.X(x), y); else ctx.lineTo(f.X(x), y); }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
  ctx.fillStyle = c.ink2; ctx.font = '12px system-ui, sans-serif';
  const label = !lastFit ? `${fieldName()} at the probe, the last 30 periods`
    : lastFit.bound ? `ringing at f = ${fmt(lastFit.f, 4)}, hardly decaying: Q > ${fmt(lastFit.bound, 2)}`
      : `ringing at f = ${fmt(lastFit.f, 4)}, Q = ${fmt(lastFit.Q, 3)} (the energy falls by 1/e in Q/2π = ${fmt(lastFit.Q / (2 * Math.PI), 3)} periods)`;
  ctx.fillText(label, f.left + 6, f.top + 13);
}

// --------------------------------------------------------------------------- running

let raf = 0, last = 0, pending = 0, limited = false, frameCount = 0;
let stepMs = 1;
/** Advance n steps; the time average of the intensity is taken from the last of them. */
function advance(n) {
  const t0 = performance.now(), simT0 = sim.t;
  for (let q = 0; q < n; q++) { if (q === n - 1) sim.beginAverage(); sim.step(); }
  if (n > 0) {
    stepMs += 0.25 * ((performance.now() - t0) / n - stepMs);
    sim.accumulate(Math.min(1, sim.t - simT0));
  }
}
function loop(now) {
  raf = 0;
  const real = last ? Math.min(0.05, (now - last) / 1000) : 0;
  last = now;
  if (state.running) {
    pending += (state.speed * real) / sim.dt;
    // As many steps as the speed asks for, but no more than fit in about 14 ms.
    let n = Math.floor(pending);
    const budget = Math.max(1, Math.floor(14 / Math.max(stepMs, 0.01)));
    limited = n > budget;
    if (limited) n = budget;
    advance(n);
    pending -= n;
    if (limited) pending = Math.min(pending, 1);
  } else limited = false;
  frameCount++;
  draw();
  if (frameCount % 3 === 0 || !state.running) { updateReadouts(); drawTrace(); }
  if (state.running) raf = requestAnimationFrame(loop);
  else last = 0;
}
function kick() { if (!raf) raf = requestAnimationFrame(loop); }
function setRunning(on) { state.running = on; $('#play').textContent = on ? 'Pause' : 'Play'; kick(); }

// --------------------------------------------------------------------------- pointer

const local = (e) => { const r = viewCanvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
const toBox = (px, py) => { const s = viewCanvas.clientWidth / scene.W; return [px / s - scene.W / 2, scene.H / 2 - py / s]; };
const clampBox = (x, y, m = 0.05) => [Math.max(-scene.W / 2 + m, Math.min(scene.W / 2 - m, x)), Math.max(-scene.H / 2 + m, Math.min(scene.H / 2 - m, y))];
let drag = null;

function hitTest(px, py, e) {
  const R = e.pointerType === 'touch' ? 22 : 13;
  let best = null, bd = R;
  for (const h of handles) { const d = Math.hypot(h.x - px, h.y - py); if (d < bd) { bd = d; best = h; } }
  return best;
}

viewCanvas.addEventListener('pointerdown', (e) => {
  const [px, py] = local(e), [x, y] = toBox(px, py), h = hitTest(px, py, e);
  viewCanvas.setPointerCapture(e.pointerId);
  if (h) { drag = h; viewCanvas.classList.add('grabbing'); return; }
  if (!state.brush) return;
  drag = { kind: 'paint', op: { k: 'path', pts: [x, y], r: state.brushSize / 2, mat: materialOf(state.brush) } };
  state.paint.push(drag.op);
  applyStroke(drag.op, x, y, x, y);
});

function applyStroke(op, x0, y0, x1, y1) {
  const region = scene.stroke({ k: 'seg', x0, y0, x1, y1, r: op.r, mat: op.mat });
  if (!region) return;
  scene.applyTo(sim, region);
  clearMetal(region);
  mats = materialImage(scene);
  strokeDirty = true;
}
let strokeDirty = false, outlineTimer = 0;

viewCanvas.addEventListener('pointermove', (e) => {
  const [px, py] = local(e), [x, y] = toBox(px, py);
  hover = { x, y };
  if (!drag) {
    viewCanvas.classList.toggle('grab', !!hitTest(px, py, e));
    if (!state.running) updateReadouts();
    return;
  }
  const [cx, cy] = clampBox(x, y);
  if (drag.kind === 'paint') {
    const p = drag.op.pts, lx = p[p.length - 2], ly = p[p.length - 1];
    if (Math.hypot(x - lx, y - ly) < 0.3 * state.brushSize) return;
    p.push(x, y);
    applyStroke(drag.op, lx, ly, x, y);
    if (!outlineTimer) outlineTimer = setTimeout(() => { outlineTimer = 0; lines = outlines(scene); }, 120);
  } else if (drag.kind === 'move') {
    state.src.x = cx; state.src.y = cy; makeSource(false); sourceChanged();
  } else if (drag.kind === 'aim') {
    state.src.angle = Math.round(Math.atan2(y - state.src.y, x - state.src.x) / deg * 10) / 10;
    sourceSliders.angle.value = state.src.angle;
    makeSource(false); sourceChanged();
  } else if (drag.kind === 'probe') {
    state.probe = { x: cx, y: cy }; probe.x = cx; probe.y = cy; probe.reset(); hashSoon();
  } else if (drag.kind === 'meter') {
    const m = state.meters[drag.q];
    if (drag.end) { m.x1 = cx; m.y1 = cy; } else { m.x0 = cx; m.y0 = cy; }
    makeMonitors(); hashSoon();
  }
  if (!state.running) kick();
});

function endDrag() {
  if (drag?.kind === 'paint') { refreshMaterials(); strokeDirty = false; hashSoon(); }
  drag = null; viewCanvas.classList.remove('grabbing');
  if (!state.running) kick();
}
viewCanvas.addEventListener('pointerup', endDrag);
viewCanvas.addEventListener('pointercancel', endDrag);
viewCanvas.addEventListener('pointerleave', () => { hover = null; });

// --------------------------------------------------------------------------- controls

$('#play').addEventListener('click', () => setRunning(!state.running));
$('#step').addEventListener('click', () => { setRunning(false); advance(Math.max(1, Math.round(0.1 / sim.dt))); kick(); });
$('#restart').addEventListener('click', () => restart());
const speedSlider = slider({ label: 'speed', min: 0.05, max: 20, log: true, value: state.speed, title: 'Periods of the source per second (as fast as the computer allows)',
  onInput: (v) => { state.speed = v; } });
$('#speed-box').append(speedSlider, el('div', { class: 'hint' }, 'periods per second'));

// The source.
const srcType = segmented([
  { value: 'point', label: 'Point', title: 'A line current along z: circular waves' },
  { value: 'beam', label: 'Beam', title: 'A Gaussian beam (the total-field / scattered-field method)' },
  { value: 'moving', label: 'Moving', title: 'A source moving in a straight line (Cherenkov, Doppler)' },
  { value: 'off', label: 'Off' },
], state.src.type, (v) => { state.src.type = v; if (v === 'off') offTime = sim.t; if (v === 'moving' && state.src.mwave === 'steady') sourceSliders.beta.value = state.src.beta; makeSource(true); sourceChanged(); showSourceControls(); }, { label: 'Source' });
const srcWave = segmented([
  { value: 'cw', label: 'Continuous', title: 'A steady sinusoid at the source frequency' },
  { value: 'pulse', label: 'Pulse', title: 'A short Gaussian pulse around the source frequency' },
], state.src.wave, (v) => { state.src.wave = v; makeSource(true); sourceChanged(); showSourceControls(); }, { label: 'Time dependence' });
const fireButton = el('button', { type: 'button', title: 'Send another pulse now', onclick: () => { if (source) { source.t0 = sim.t; for (const m of meters) m.reset(); } kick(); } }, 'Fire');
const movWave = segmented([
  { value: 'steady', label: 'Steady', title: 'A steady current: like a moving charge' },
  { value: 'cw', label: 'Oscillating', title: 'An oscillating source: the Doppler effect' },
], state.src.mwave, (v) => { state.src.mwave = v; makeSource(true); sourceChanged(); }, { label: 'Moving source' });
$('#src-type').append(srcType);
$('#src-wave').append(srcWave, fireButton, movWave);
const sourceSliders = {
  angle: slider({ label: 'angle (°)', min: -180, max: 180, step: 0.5, value: state.src.angle, title: 'Direction of the beam or the motion, from the x axis',
    onInput: (v) => { state.src.angle = v; makeSource(false); sourceChanged(); } }),
  width: slider({ label: 'width (λ)', min: 0.3, max: 8, value: state.src.width, title: 'The beam\'s half-width at its waist (1/e of the amplitude)',
    onInput: (v) => { state.src.width = v; makeSource(false); sourceChanged(); } }),
  beta: slider({ label: 'β = v/c', min: 0.05, max: 0.99, step: 0.01, value: state.src.beta, title: 'The speed of the moving source',
    onInput: (v) => { state.src.beta = Math.min(0.99, v); makeSource(true); sourceChanged(); } }),
};
$('#src-box').append(...Object.values(sourceSliders), el('div', { class: 'hint' }, 'Drag the source on the picture; drag its arrow to aim it.'));
function showSourceControls() {
  const t = state.src.type;
  srcWave.hidden = !(t === 'point' || t === 'beam');
  fireButton.hidden = !(t === 'point' || t === 'beam') || state.src.wave !== 'pulse';
  movWave.hidden = t !== 'moving';
  sourceSliders.angle.hidden = !(t === 'beam' || t === 'moving');
  sourceSliders.width.hidden = t !== 'beam';
  sourceSliders.beta.hidden = t !== 'moving';
  srcType.value = t; srcWave.value = state.src.wave; movWave.value = state.src.mwave;
  sourceSliders.angle.value = state.src.angle; sourceSliders.width.value = state.src.width; sourceSliders.beta.value = state.src.beta;
}
function sourceChanged() { for (const m of meters) m.reset(); hashSoon(); kick(); }

// Painting.
const matButtons = {};
for (const [key, m] of Object.entries(MATERIALS)) {
  const sw = el('span', { class: 'swatch' });
  const t = m.pec ? [150, 156, 166] : m.absorb ? [110, 70, 40] : m.bg ? [0, 0, 0] : tintOf({ eps: (key === 'typed' ? 2 : m.n) ** 2 }).map((v) => Math.min(255, v * 2.4));
  sw.style.background = `rgb(${t.join(',')})`;
  const b = el('button', { type: 'button', 'aria-pressed': String(key === state.brush), title: m.title, onclick: () => setBrush(key) }, sw, key === 'typed' ? 'n = …' : m.label);
  matButtons[key] = b;
  $('#materials').append(b);
}
function setBrush(key) {
  state.brush = key;
  for (const [k, b] of Object.entries(matButtons)) b.setAttribute('aria-pressed', String(k === state.brush));
  brushNSlider.hidden = state.brush !== 'typed';
}
const brushNSlider = slider({ label: 'n', min: 1, max: 4, step: 0.01, value: state.brushN, title: 'The index of the n = … brush', onInput: (v) => { state.brushN = Math.max(1, Math.min(6, v)); } });
brushNSlider.hidden = true;
$('#n-box').append(brushNSlider);
$('#brush-box').append(
  slider({ label: 'brush (λ)', min: 0.05, max: 2, value: state.brushSize, title: 'The brush\'s diameter', onInput: (v) => { state.brushSize = v; } }),
  el('div', { class: 'row' }, el('button', { type: 'button', onclick: () => { state.paint.length = 0; rebuildMaterials(); } }, 'Clear paint'),
    el('span', { class: 'hint' }, 'drag on the picture to paint')));

function rebuildMaterials() {
  scene.shapeOps = state.shape ? SHAPES[state.shape].build(state.p, state.n, scene.W, scene.H) : [];
  scene.paintOps = state.paint;
  const region = scene.rebuild();
  scene.applyTo(sim, region);
  clearMetal(region);
  refreshMaterials();
  for (const m of meters) m.reset();
  hashSoon(); kick();
}

// Shapes.
const shapeButtons = {};
for (const [id, sh] of [...Object.entries(SHAPES), ['none', { label: 'None' }]]) {
  const b = el('button', { type: 'button', 'aria-pressed': 'false', onclick: () => setShape(id === 'none' ? null : id) }, sh.label);
  shapeButtons[id] = b;
  $('#shapes').append(b);
}
const shapeP = slider({ label: 'size', min: 0, max: 1, value: 0, onInput: (v) => { state.p = v; rebuildMaterials(); } });
const shapeN = slider({ label: 'n', min: 1, max: 4, step: 0.01, value: 1.5, title: 'The shape\'s refractive index', onInput: (v) => { state.n = Math.max(1, Math.min(6, v)); rebuildMaterials(); } });
$('#shape-box').append(shapeP, shapeN);
function showShapeControls() {
  const sh = state.shape && SHAPES[state.shape];
  for (const [k, b] of Object.entries(shapeButtons)) b.setAttribute('aria-pressed', String(k === (state.shape || 'none')));
  shapeP.hidden = !sh || !sh.pLabel;
  shapeN.hidden = !sh || sh.n === undefined;
  if (sh && sh.pLabel) { shapeP.querySelector('label').textContent = sh.pLabel; shapeP.setRange(sh.p[0], sh.p[1]); shapeP.value = state.p; }
  if (sh && sh.n !== undefined) shapeN.value = state.n;
}
function setShape(id, { p, n } = {}) {
  state.shape = id;
  if (id) { state.p = p ?? SHAPES[id].p[2]; state.n = n ?? SHAPES[id].n ?? 1.5; }
  showShapeControls();
  rebuildMaterials();
}

// What to show.
const viewSeg = segmented([
  { value: 'field', label: 'Field', title: 'The field itself: red positive, blue negative' },
  { value: 'intensity', label: 'Intensity', title: 'Its square averaged over about a period' },
], state.view, (v) => setView(v), { label: 'Show' });
const polSeg = segmented([
  { value: 'TM', label: 'TM: Ez', title: 'E along z, out of the picture (s polarisation)' },
  { value: 'TE', label: 'TE: Hz', title: 'H along z, E in the picture (p polarisation: has a Brewster angle)' },
], state.mode, (v) => { state.mode = v; build(); hashSoon(); kick(); }, { label: 'Polarisation' });
const flowToggle = toggle('Energy flow', state.flow, (on) => { state.flow = on; makeMonitors(); hashSoon(); kick(); }, 'Arrows: the Poynting vector E × H averaged over a period');
const probeToggle = toggle('Probe', !!state.probe, (on) => { state.probe = on ? { x: 0, y: 0 } : null; makeMonitors(); layout(); hashSoon(); kick(); }, 'The field at a point against time (and Q, when it rings down)');
const meterButton = el('button', { type: 'button', title: 'A line that measures the power crossing it (drag its ends)', onclick: () => {
  if (state.meters.length >= 2) state.meters.length = 0;
  else { const y = state.meters.length ? -1 : 1; state.meters.push({ x0: 1, y0: y - 1.5, x1: 1, y1: y + 1.5 }); }
  makeMonitors(); meterButton.textContent = state.meters.length >= 2 ? 'Remove meters' : 'Add meter'; hashSoon(); kick();
} }, 'Add meter');
$('#show-mode').append(viewSeg);
$('#show-pol').append(polSeg);
$('#show-toggles').append(flowToggle, probeToggle, meterButton);
const brightSlider = slider({ label: 'brightness', min: -2, max: 2, step: 0.01, value: 0, onInput: (v) => { state.bright = v; kick(); } });
$('#bright-box').append(brightSlider);
function setView(v) { state.view = v; viewSeg.value = v; sim.trackIntensity(v === 'intensity', 1, false); hashSoon(); kick(); }

// The grid and the background.
const gridSliders = {
  ppw: slider({ label: 'cells per λ', min: 10, max: 80, step: 1, value: state.ppw, title: 'Cells per vacuum wavelength: 15 or more in the highest index', onInput: (v) => { state.ppw = Math.round(Math.max(6, Math.min(120, v))); regridSoon(); } }),
  W: slider({ label: 'width (λ)', min: 3, max: 30, step: 0.5, value: state.W, onInput: (v) => { state.W = Math.max(2, Math.min(40, v)); regridSoon(); } }),
  H: slider({ label: 'height (λ)', min: 3, max: 24, step: 0.5, value: state.H, onInput: (v) => { state.H = Math.max(2, Math.min(40, v)); regridSoon(); } }),
};
let regridTimer = 0;
function regridSoon() { clearTimeout(regridTimer); regridTimer = setTimeout(() => { build(); hashSoon(); kick(); }, 200); }
const BG_PRESETS = {
  Vacuum: ['1', {}],
  'Luneburg lens': ['sqrt(max(2 - (r/R)^2, 1))', { R: 3 }],
  'Graded fibre': ['max(1, n0 - (n0 - 1) (y/a)^2)', { n0: 1.5, a: 1.5 }],
  Gradient: ['1 + g (y + 5)', { g: 0.05 }],
};
const bgField = exprField({
  label: '<math><mi>n</mi><mo>(</mo><mi>x</mi><mo>,</mo><mi>y</mi><mo>)</mo><mo>=</mo></math>', value: state.bg, variables: ['x', 'y', 'r'],
  hints: { R: { min: 0.5, max: 6, value: 3 }, n0: { min: 1, max: 3, value: 1.5 }, a: { min: 0.2, max: 5, value: 1.5 }, g: { min: -0.2, max: 0.2, value: 0.05 } },
  onChange: (expr, params) => { setBackground(expr, params); },
});
function setBackground(expr, params, rebuild = true) {
  state.bg = expr.source; state.bgParams = params;
  const trivial = /^\s*1(\.0*)?\s*$/.test(expr.source);
  bgFn = trivial ? null : (xs, ys) => {
    const r = new Float64Array(xs.length);
    for (let q = 0; q < xs.length; q++) r[q] = Math.hypot(xs[q], ys[q]);
    return expr.evaluate({ x: xs, y: ys, r, ...params }, xs.length).re;
  };
  if (!rebuild) return;
  clearTimeout(bgTimer);
  bgTimer = setTimeout(() => { scene.setBackground(bgFn); rebuildMaterials(); }, 150);
}
let bgTimer = 0;
const bgButtons = el('div', { class: 'row' }, ...Object.entries(BG_PRESETS).map(([label, [src, p]]) =>
  el('button', { type: 'button', onclick: () => bgField.set(src, p) }, label)));
$('#grid-box').append(...Object.values(gridSliders),
  el('div', { class: 'hint' }, 'A finer grid is more accurate and slower.  The absorbing layer around the box is 16 cells thick.'),
  el('div', { class: 'label' }, 'Background'), bgField, bgButtons,
  el('div', { class: 'hint' }, 'The index everywhere you haven\'t painted (x, y, r in wavelengths from the centre).'));

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ') { e.preventDefault(); setRunning(!state.running); }
});
window.addEventListener('resize', () => { if (state.flow) makeMonitors(); kick(); });

// --------------------------------------------------------------------------- the address

let hashTimer = 0;
function hashSoon() { clearTimeout(hashTimer); hashTimer = setTimeout(saveHash, 300); }
const r3 = (v) => +(+v).toFixed(3);
function encodeMat(m) { return m.pec ? 'm' : m.absorb ? 'a' : m.bg ? 'e' : `n${m.n}`; }
function decodeMat(s) { return s === 'm' ? { pec: true } : s === 'a' ? { absorb: true } : s === 'e' ? { bg: true } : { n: +s.slice(1) }; }
function saveHash() {
  const s = state.src, h = {
    W: r3(state.W), H: r3(state.H), ppw: state.ppw, mode: state.mode === 'TM' ? undefined : 'TE',
    shape: state.shape || 'none', p: state.shape ? r3(state.p) : undefined, n: state.shape && SHAPES[state.shape].n !== undefined ? r3(state.n) : undefined,
    src: s.type, sx: r3(s.x), sy: r3(s.y), ang: s.type === 'beam' || s.type === 'moving' ? r3(s.angle) : undefined,
    w: s.type === 'beam' ? r3(s.width) : undefined, wave: s.type === 'point' || s.type === 'beam' ? s.wave : undefined,
    beta: s.type === 'moving' ? r3(s.beta) : undefined, mwave: s.type === 'moving' ? s.mwave : undefined,
    view: state.view === 'field' ? undefined : state.view, flow: state.flow ? 1 : undefined,
    probe: state.probe ? `${r3(state.probe.x)},${r3(state.probe.y)}` : undefined,
    meters: state.meters.length ? state.meters.map((m) => [m.x0, m.y0, m.x1, m.y1].map((v) => r3(v)).join(',')).join(';') : undefined,
    bg: state.bg.trim() !== '1' ? state.bg : undefined, bgp: state.bg.trim() !== '1' && Object.keys(state.bgParams).length ? JSON.stringify(state.bgParams) : undefined,
  };
  const paint = state.paint.map((op) => `${encodeMat(op.mat)}:${r3(op.r)}:${op.pts.map((v) => v.toFixed(2)).join(',')}`).join(';');
  if (paint.length < 6000) h.paint = paint || undefined;
  else if (!saveHash.warned) { saveHash.warned = true; toast('The painting is too detailed to keep in the address.'); }
  writeHash(h);
}
function loadHash(h) {
  const num = (k, d) => (h[k] !== undefined && Number.isFinite(+h[k]) ? +h[k] : d);
  Object.assign(state, { W: num('W', state.W), H: num('H', state.H), ppw: Math.round(num('ppw', state.ppw)), mode: h.mode === 'TE' ? 'TE' : 'TM' });
  state.shape = SHAPES[h.shape] ? h.shape : h.shape === 'none' ? null : state.shape;
  if (state.shape) { state.p = num('p', SHAPES[state.shape].p[2]); state.n = num('n', SHAPES[state.shape].n ?? 1.5); }
  const s = state.src;
  if (['point', 'beam', 'moving', 'off'].includes(h.src)) s.type = h.src;
  Object.assign(s, { x: num('sx', s.x), y: num('sy', s.y), angle: num('ang', s.angle), width: num('w', s.width), beta: Math.min(0.99, num('beta', s.beta)) });
  if (h.wave === 'pulse' || h.wave === 'cw') s.wave = h.wave;
  if (h.mwave === 'steady' || h.mwave === 'cw') s.mwave = h.mwave;
  state.view = h.view === 'intensity' ? 'intensity' : 'field';
  state.flow = h.flow === '1';
  if (h.probe) { const [x, y] = h.probe.split(',').map(Number); if (Number.isFinite(x) && Number.isFinite(y)) state.probe = { x, y }; }
  if (h.meters) state.meters = h.meters.split(';').map((m) => m.split(',').map(Number)).filter((v) => v.length === 4 && v.every(Number.isFinite)).slice(0, 2).map(([x0, y0, x1, y1]) => ({ x0, y0, x1, y1 }));
  if (h.paint) {
    state.paint = h.paint.split(';').map((p) => {
      const [m, r, pts] = p.split(':');
      return { k: 'path', mat: decodeMat(m), r: +r, pts: pts.split(',').map(Number) };
    }).filter((op) => op.pts.length >= 2 && op.pts.every(Number.isFinite) && op.r > 0);
  }
  if (h.bg) { let p = {}; try { p = JSON.parse(h.bgp || '{}'); } catch { p = {}; } bgField.set(h.bg, p, false); setBackground(bgField.expr, bgField.params, false); }
}

// --------------------------------------------------------------------------- experiments

/** Set everything up at once. */
function go({ W = 16, H = 10, ppw = 24, mode = 'TM', shape = null, p, n, bg = '1', bgParams = {}, src = {}, view = 'field', flow = false,
  probe = null, meters = [], speed = 2, brush = undefined } = {}) {
  Object.assign(state, { W, H, ppw, mode, shape, view, flow, probe, meters, speed, bright: 0 });
  if (shape) { state.p = p ?? SHAPES[shape].p[2]; state.n = n ?? SHAPES[shape].n ?? 1.5; }
  state.paint = [];
  state.src = { type: 'off', x: 0, y: 0, angle: 0, width: 1, wave: 'cw', beta: 0.9, mwave: 'steady', ...src };
  bgField.set(bg, bgParams, false); setBackground(bgField.expr, bgField.params, false);
  if (brush !== undefined) setBrush(brush);
  syncControls();
  build();
  restart();
  setRunning(true);
  hashSoon();
}
/** A beam aimed at the point (tx, ty) from `dist` away, travelling at `angle` degrees. */
const aimed = (angle, dist, tx = 0, ty = 0, extra = {}) => ({ type: 'beam', x: tx - dist * Math.cos(angle * deg), y: ty - dist * Math.sin(angle * deg), angle, ...extra });
/** A meter through (x, y), `half` long each way, counting the power flowing towards `angle` degrees. */
const across = (x, y, angle, half) => {
  const c = Math.cos(angle * deg), s = Math.sin(angle * deg);
  // The counted side is to the right of the way from the first end to the second.
  return { x0: x + half * s, y0: y - half * c, x1: x - half * s, y1: y + half * c };
};

function syncControls() {
  speedSlider.value = state.speed; brightSlider.value = state.bright;
  viewSeg.value = state.view; polSeg.value = state.mode;
  flowToggle.on = state.flow; probeToggle.on = !!state.probe;
  meterButton.textContent = state.meters.length >= 2 ? 'Remove meters' : 'Add meter';
  gridSliders.ppw.value = state.ppw; gridSliders.W.value = state.W; gridSliders.H.value = state.H;
  showShapeControls(); showSourceControls();
}

const setups = {
  circles: () => go({ src: { type: 'point', x: -2, y: 0 } }),
  snell: () => go({ W: 14, H: 10, ppw: 30, shape: 'surface', src: aimed(-60, 4, 0, 0, { width: 1.2 }) }),
  tir: () => go({ W: 14, H: 10, ppw: 30, shape: 'surface', src: aimed(40, 5, 0, 0, { width: 1 }) }),
  // The reflected beam leaves the gap at -40°; the transmitted one goes on at 40° above it.
  ftir: () => go({ W: 14, H: 11, ppw: 30, shape: 'gap', p: 0.3, src: aimed(40, 5, 0, -0.15, { width: 1.2 }),
    meters: [across(0, 1.4, 90, 6.4), across(3.5 * Math.cos(40 * deg), -0.15 - 3.5 * Math.sin(40 * deg), -40, 2.5)] }),
  brewster: () => go({ W: 16, H: 10, ppw: 30, mode: 'TE', shape: 'surface', src: aimed(-(90 - 56.3), 5.2, -1.5, 0, { width: 1.2 }),
    meters: [across(0, -0.5, -90, 7.7)] }),
  guide: () => {
    const W = 14, H = 10, x0 = GUIDE_START(W), y0 = BEND_Y(H);
    go({ W, H, ppw: 30, shape: 'bend', p: 2.5, src: { type: 'beam', x: x0 - 0.25, y: y0, angle: 0, width: 0.35 },
      meters: [across(x0 + 3, y0, 0, 1.2), across(W / 2 - 2.2, 2.5, 90, 1.2)], speed: 4 });
  },
  cutoff: () => go({ W: 12, H: 6, ppw: 30, shape: 'metalguide', p: 0.4, src: aimed(0, 2.6, -2, 0, { width: 0.8 }),
    meters: [across(3.2, 0, 0, 2.6)] }),
  lens: () => go({ W: 16, H: 10, ppw: 30, shape: 'lens', p: 5, src: aimed(0, 2, -4, 0, { width: 2 }), view: 'intensity' }),
  grin: () => go({ W: 14, H: 10, ppw: 24, bg: 'sqrt(max(2 - (r/R)^2, 1))', bgParams: { R: 3 }, src: aimed(0, 4, -1, 0, { width: 2.5 }), view: 'intensity' }),
  slits: () => go({ W: 16, H: 12, ppw: 24, shape: 'slits', p: 2.5, src: aimed(0, 2.6, -4, 0, { width: 4 }) }),
  crystal: () => go({ W: 10, H: 8, ppw: 48, shape: 'crystal', p: 0.37, n: 3, src: aimed(0, 2.4, -1, 0, { width: 1.2 }),
    meters: [across(4, 0, 0, 2.5)] }),
  pcbend: () => go({ W: 10, H: 8, ppw: 48, shape: 'pcbend', p: 0.37, n: 3, src: { type: 'point', x: -3.15, y: 0 } }),
  cavity: () => go({ W: 4, H: 3, ppw: 41, shape: 'cavity', p: 0.4, src: { type: 'point', x: 0, y: 0, wave: 'pulse' }, probe: { x: 0.18, y: 0.18 }, speed: 3 }),
  cherenkov: () => go({ W: 16, H: 9, ppw: 24, shape: 'fill', n: 1.5, src: { type: 'moving', x: -7, y: 0, angle: 0, beta: 0.9, mwave: 'steady' } }),
};
drawer($('#help'), $('#help-button'), setups);

// --------------------------------------------------------------------------- start

const welcome = () => go({ W: 16, H: 10, ppw: 30, shape: 'prism', p: 7, src: aimed(8, 5.5, -0.6, -0.2, { width: 1 }) });
const hash = readHash();
if (setups[hash.setup]) setups[hash.setup]();
else if (Object.keys(hash).length) { try { loadHash(hash); } catch { /* keep the defaults */ } syncControls(); build(); restart(); setRunning(true); }
else welcome();

window.__app = {
  state, setups, ready: true, theory,
  get sim() { return sim; }, get scene() { return scene; }, get source() { return source; },
  get meters() { return meters; }, get probe() { return probe; }, get fit() { return lastFit; },
  meterValue, predictions, build, restart,
  /** Run n periods as fast as possible (for the tests). */
  run(periods) { advance(Math.round(periods / sim.dt)); draw(); updateReadouts(); drawTrace(); return sim.t; },
  get stepMs() { return stepMs; },
};
