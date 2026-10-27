// The aperture-synthesis half of the page: dishes on the ground, their tracks in the uv plane,
// the dirty beam, the sky, the dirty image and CLEAN.

import {
  stationXYZ, mapPosition, siteXYZ, tracks, gridSamples, dirtyBeam, skyTransform, dirtyImage,
  cleanStart, cleanSteps, fitBeam, restore, layout, baselineRange, R_EARTH, EHT_CENTRE,
} from './synthesis.js';
import { makeSky, typedSky, SKIES } from './sky.js';
import { loadImage, imageData } from '../fft2d/presets.js';
import { colorize, autoBrightness } from '../lib/complexcolor.js';
import { el, $, slider, segmented, toggle, exprField, fmt } from '../lib/ui.js';
import { fitCanvas, themeColors } from '../lib/plot.js';

const DEG = Math.PI / 180;
const N = 256;                         // the image and uv grids
const MAXDISHES = 40;

// Angles: units for the sliders and labels.
const UNITS = { deg: [DEG, '°'], arcmin: [DEG / 60, '′'], arcsec: [DEG / 3600, '″'], mas: [DEG / 3.6e6, ' mas'], uas: [DEG / 3.6e9, ' µas'] };
export function fmtAngle(r) {
  const a = Math.abs(r);
  const [u, s] = a >= DEG ? UNITS.deg : a >= DEG / 60 ? UNITS.arcmin : a >= DEG / 3600 ? UNITS.arcsec : a >= DEG / 3.6e6 ? UNITS.mas : UNITS.uas;
  return `${fmt(r / u, 3)}${s}`;
}
const fmtLen = (m) => (m >= 1000 ? `${fmt(m / 1000, 3)} km` : `${fmt(m, 3)} m`);
const fmtWaves = (x) => (x >= 1e9 ? `${fmt(x / 1e9, 3)} Gλ` : x >= 1e6 ? `${fmt(x / 1e6, 3)} Mλ` : x >= 1e3 ? `${fmt(x / 1e3, 3)} kλ` : `${fmt(x, 3)} λ`);
const fmtLambda = (m) => (m >= 1 ? `${fmt(m, 3)} m` : m >= 0.01 ? `${fmt(m * 100, 3)} cm` : `${fmt(m * 1000, 3)} mm`);

export const S = {
  preset: 'y', dishes: [], names: null, refLon: 0,
  lat: 34.08, dec: 40, hours: 8, lambda: 0.21,
  sky: 'portrait', size: 8 * DEG / 60, fov: 12 * DEG / 60, unit: 'arcmin',
  weighting: 'uniform', gain: 0.1,
  tNow: 1, playing: false,
  cleanShow: 'restored', running: false,
  selected: -1,
};

let onChange = () => {};
export function onSynthChange(f) { onChange = f; }

// ------------------------------------------------------------------ computing

let pos = [], tr = null, grid = null, beam = null, V = null, skyImg = null, dirty = null, fit = null;
let cs = null, restored = null, uvMax = 1, portrait = null;

const pix = () => S.fov / N;
const du = () => 1 / S.fov;

function geometry() {
  pos = S.dishes.map(([E, Nn]) => stationXYZ(E, Nn, S.lat * DEG));
  const steps = S.hours > 0 ? Math.max(2, Math.min(361, Math.round(S.hours * 30) + 1)) : 1;
  tr = tracks(pos, { dec: S.dec * DEG, hours: S.hours, steps });
  uvMax = 0;
  for (let i = 0; i < tr.u.length; i++) uvMax = Math.max(uvMax, Math.hypot(tr.u[i], tr.v[i]) / S.lambda);
  if (!(uvMax > 0)) uvMax = 1;
}

function sampling() {
  const upto = Math.round(S.tNow * (tr.nt - 1));
  grid = gridSamples(tr, S.lambda, N, du(), { upto, weighting: S.weighting });
  beam = dirtyBeam(grid.S, N);
  fit = fitBeam(beam, N);
}

function makeTheSky() {
  skyImg = S.sky === 'typed' && skyField.expr ? typedSky(skyField.expr, skyField.params, N, pix(), UNITS[S.unit][0]) : makeSky(S.sky, N, pix(), S.size, portrait);
  V = skyTransform(skyImg, N);
}

function imaging() {
  dirty = dirtyImage(grid.S, V, N);
  cs = cleanStart(dirty);
  restored = null;
}

/** What changed decides what is recomputed: 'geometry' > 'sampling' > 'sky' > 'image'. */
let pendingWhat = new Set(), pending = 0;
export function synthChanged(what = 'geometry', hash = true) {
  pendingWhat.add(what);
  if (pending) return;
  pending = requestAnimationFrame(() => {
    pending = 0;
    const w = pendingWhat; pendingWhat = new Set();
    if (w.has('geometry')) geometry();
    if (w.has('sky') || !V) makeTheSky();
    if (w.has('geometry') || w.has('sampling') || !grid) sampling();
    imaging();
    drawAll();
    if (hash) onChange();
  });
}

// ------------------------------------------------------------------ colours

// A diverging map for real images: 0 black, positive through red and yellow to white,
// negative through blue.  t in [-1, 1], stretched as |t|^0.6 so that faint sidelobes show.
const STRETCH = 0.6;
const LUT = (() => {
  const m = 1024, out = new Uint8ClampedArray(m * 3), c = (x) => Math.max(0, Math.min(1, x));
  for (let k = 0; k < m; k++) {
    const t = (2 * k) / (m - 1) - 1;
    let r, g, b;
    if (t >= 0) { const s = Math.pow(t, STRETCH); r = c(2.4 * s); g = c(2.4 * s - 0.9); b = c(3 * s - 2); }
    else { const s = Math.pow(-t, STRETCH); r = c(2.2 * s - 1.3) * 0.7; g = c(2.2 * s - 0.6) * 0.85; b = c(2 * s); }
    out[3 * k] = 255 * r; out[3 * k + 1] = 255 * g; out[3 * k + 2] = 255 * b;
  }
  return out;
})();

function paintReal(data, values, scale) {
  const m = LUT.length / 3 - 1, inv = scale > 0 ? 1 / scale : 0;
  for (let i = 0, o = 0; i < values.length; i++, o += 4) {
    let t = values[i] * inv;
    if (t > 1) t = 1; else if (t < -1) t = -1;
    const k = 3 * Math.round(((t + 1) / 2) * m);
    data[o] = LUT[k]; data[o + 1] = LUT[k + 1]; data[o + 2] = LUT[k + 2]; data[o + 3] = 255;
  }
}

const offs = new Map();
function blitImage(canvas, values, scale, { smooth = true, zoom = N } = {}) {
  const { ctx, width, height } = fitCanvas(canvas);
  let o = offs.get(canvas);
  if (!o) { const c = document.createElement('canvas'); c.width = c.height = N; o = { c, img: c.getContext('2d').createImageData(N, N) }; offs.set(canvas, o); }
  paintReal(o.img.data, values, scale);
  o.c.getContext('2d').putImageData(o.img, 0, 0);
  ctx.imageSmoothingEnabled = smooth;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
  const a = (N - zoom) / 2;
  ctx.drawImage(o.c, a, a, zoom, zoom, 0, 0, width, height);
  return { ctx, width, height };
}

function maxAbs(a) { let m = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; } return m; }

// ------------------------------------------------------------------ drawing

function label(ctx, text, x, y, align = 'left') {
  ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const w = ctx.measureText(text).width, x0 = align === 'left' ? x - 3 : align === 'right' ? x - w - 3 : x - w / 2 - 3;
  ctx.fillRect(x0, y - 12, w + 6, 16);
  ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillText(text, x, y);
}

/** A scale bar for an image of angular width S.fov drawn w pixels wide, and a compass. */
function angularBar(ctx, w, h, span = S.fov) {
  const target = span / 4, [u] = UNITS[S.unit], v = target / u, p = 10 ** Math.floor(Math.log10(v));
  const nice = (v / p >= 5 ? 5 : v / p >= 2 ? 2 : 1) * p, len = ((nice * u) / span) * w;
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(10, h - 12, len, 3);
  label(ctx, fmtAngle(nice * u), 10, h - 17);
  // N up, E to the right (as on the map).
  const x = w - 34, y = h - 12;
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x - 8, y - 33, 38, 41);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x, y - 18); ctx.lineTo(x, y); ctx.lineTo(x + 18, y); ctx.stroke();
  ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.textAlign = 'center';
  ctx.fillText('N', x, y - 21); ctx.textAlign = 'left'; ctx.fillText('E', x + 21, y + 4);
}

/** The clean beam's half-maximum ellipse in the bottom-left corner. */
function beamEllipse(ctx, w, h) {
  if (!fit || fit.stripes) return;
  const s = w / N, rx = (fit.major / 2) * s, ry = (fit.minor / 2) * s;
  if (rx > w / 6) return;
  ctx.save();
  ctx.translate(14 + Math.max(rx, 6), h - 30 - Math.max(rx, 6));
  ctx.rotate(fit.angle);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.ellipse(0, 0, Math.max(rx, 1), Math.max(ry, 1), 0, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawAll() { drawMap(); drawSky(); drawMoving(); }
function drawMoving() { drawUV(); drawBeam(); drawDirty(); drawClean(); notes(); }

let beamZoom = N;
function drawBeam() {
  // Show about 25 beam widths across (all of it for a wide beam or a fringe).
  beamZoom = fit && !fit.stripes ? Math.min(N, Math.max(32, 2 * Math.round(fit.major * 12.5))) : N;
  const { ctx, width, height } = blitImage($('#beam'), beam, 1, { zoom: beamZoom });
  angularBar(ctx, width, height, (S.fov * beamZoom) / N);
  if (beamZoom < N) label(ctx, `the middle ${fmt((100 * beamZoom) / N, 2)}% of the field`, 10, 20);
}
function drawSky() {
  const m = maxAbs(skyImg);
  const { ctx, width, height } = blitImage($('#sky'), skyImg, m);
  // Point sources are single pixels: ring them so they can be seen.
  if (S.sky === 'point' || S.sky === 'double') {
    ctx.strokeStyle = 'rgba(255,200,80,0.9)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < skyImg.length; i++) if (skyImg[i] > 0) {
      const x = ((i % N) + 0.5) * (width / N), y = (Math.floor(i / N) + 0.5) * (height / N);
      ctx.beginPath(); ctx.arc(x, y, 7, 0, 2 * Math.PI); ctx.stroke();
    }
  }
  angularBar(ctx, width, height);
}
function drawDirty() {
  const { ctx, width, height } = blitImage($('#dirty'), dirty, maxAbs(dirty));
  angularBar(ctx, width, height); beamEllipse(ctx, width, height);
}
function drawClean() {
  const canvas = $('#clean');
  if (!cs || cs.iterations === 0) {
    const { ctx, width, height } = blitImage(canvas, cs ? cs.residual : dirty, maxAbs(dirty));
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, width, height);
    label(ctx, 'Press Step or Run to CLEAN', width / 2, height / 2, 'center');
    return;
  }
  let data = cs.residual;
  if (S.cleanShow === 'restored') { if (!restored) restored = restore(cs, fit, N); data = restored; }
  else if (S.cleanShow === 'model') data = cs.model;
  const scale = S.cleanShow === 'model' ? maxAbs(cs.model) : S.cleanShow === 'residual' ? maxAbs(dirty) : maxAbs(data);
  const { ctx, width, height } = blitImage(canvas, data, scale, { smooth: S.cleanShow !== 'model' });
  angularBar(ctx, width, height);
  if (S.cleanShow === 'restored') beamEllipse(ctx, width, height);
}

// The map of the dishes.
const mapCanvas = $('#map');
let mapHalf = 1000;        // metres from the centre to the edge of the map
function fitMap() {
  let m = 0;
  for (const [E, Nn] of S.dishes) m = Math.max(m, Math.abs(E), Math.abs(Nn));
  mapHalf = Math.max(30, m * 1.18);
}
const mapPx = (E, Nn, w) => [w / 2 + (E / mapHalf) * (w / 2), w / 2 - (Nn / mapHalf) * (w / 2)];
const mapFromPx = (x, y, w) => [((x - w / 2) / (w / 2)) * mapHalf, ((w / 2 - y) / (w / 2)) * mapHalf];

function drawMap() {
  const { ctx, width, height } = fitCanvas(mapCanvas), c = themeColors();
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  // An Earth-sized array: draw the latitudes and longitudes.
  if (mapHalf > 300e3) {
    const lat0 = S.lat * DEG;
    ctx.lineWidth = 1;
    const path = (pts, style) => {
      ctx.strokeStyle = style; ctx.beginPath();
      let prev = null;
      for (const P of pts) {
        const [E, Nn] = mapPosition(P, lat0), [x, y] = mapPx(E, Nn, width);
        if (prev && Math.hypot(x - prev[0], y - prev[1]) < width / 4) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        prev = [x, y];
      }
      ctx.stroke();
    };
    for (let la = -60; la <= 60; la += 30) path(Array.from({ length: 181 }, (_, k) => siteXYZ(la, -180 + 2 * k - S.refLon)), la === 0 ? c.ink3 : c.line);
    for (let lo = -180; lo < 180; lo += 30) path(Array.from({ length: 91 }, (_, k) => siteXYZ(-90 + 2 * k, lo - S.refLon)), c.line);
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = c.ink3;
    const [ex, ey] = mapPx(...mapPosition(siteXYZ(0, -100 - S.refLon), lat0), width);
    ctx.fillText('equator', ex + 4, ey - 4);
  }
  // Scale bar and north arrow.
  const target = mapHalf / 2, p = 10 ** Math.floor(Math.log10(target)), nice = (target / p >= 5 ? 5 : target / p >= 2 ? 2 : 1) * p;
  const len = (nice / mapHalf) * (width / 2);
  ctx.fillStyle = c.ink2; ctx.fillRect(10, height - 12, len, 3);
  ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(fmtLen(nice), 10, height - 17);
  ctx.strokeStyle = c.ink2; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(width - 16, height - 12); ctx.lineTo(width - 16, height - 34); ctx.lineTo(width - 20, height - 27); ctx.moveTo(width - 16, height - 34); ctx.lineTo(width - 12, height - 27); ctx.stroke();
  ctx.textAlign = 'center'; ctx.fillText('N', width - 16, height - 38);
  // The dishes.
  S.dishes.forEach(([E, Nn], i) => {
    const [x, y] = mapPx(E, Nn, width);
    ctx.fillStyle = c.accent; ctx.strokeStyle = c.panel; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    if (i === S.selected) { ctx.strokeStyle = c.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 9, 0, 2 * Math.PI); ctx.stroke(); }
    if (S.names && S.names[i]) {
      ctx.fillStyle = c.ink2; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left';
      const dup = S.names.findIndex((n, k) => k < i && Math.hypot(S.dishes[k][0] - E, S.dishes[k][1] - Nn) < mapHalf * 0.05);
      ctx.fillText(S.names[i], x + 8, y + (dup >= 0 ? 12 : -4));
    }
  });
  ctx.restore();
}

// The uv plane over the sky's transform.
const uvCanvas = $('#uv');
const UVRES = 200;
let uvOff = null;
function drawUV() {
  const { ctx, width, height } = fitCanvas(uvCanvas);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
  const half = uvMax * 1.15, dU = du();
  // The visibilities of the sky on the plotted region (domain colours), dimmed; redrawn only
  // when the sky or the region changes.
  if (!uvOff) { uvOff = document.createElement('canvas'); uvOff.width = uvOff.height = UVRES; }
  if (!uvKey || uvKey.V !== V || uvKey.half !== half || uvKey.dU !== dU) { uvBackground(half, dU); uvKey = { V, half, dU }; }
  ctx.globalAlpha = 0.6; ctx.imageSmoothingEnabled = true; ctx.drawImage(uvOff, 0, 0, width, height); ctx.globalAlpha = 1;
  uvTracks(ctx, width, height, half);
}
let uvKey = null;
function uvBackground(half, dU) {
  const re = new Float64Array(UVRES * UVRES), im = new Float64Array(UVRES * UVRES);
  for (let j = 0; j < UVRES; j++) for (let i = 0; i < UVRES; i++) {
    const u = ((i + 0.5) / UVRES * 2 - 1) * half, v = (1 - (j + 0.5) / UVRES * 2) * half;
    // Between the grid's points, interpolate (the grid is coarse for a large field).
    const p = N / 2 + u / dU, q = N / 2 - v / dU, p0 = Math.floor(p), q0 = Math.floor(q), fp = p - p0, fq = q - q0;
    if (p0 < 0 || q0 < 0 || p0 >= N - 1 || q0 >= N - 1) continue;
    const a = q0 * N + p0, b = a + 1, c = a + N, d = c + 1, o = j * UVRES + i;
    re[o] = (V.re[a] * (1 - fp) + V.re[b] * fp) * (1 - fq) + (V.re[c] * (1 - fp) + V.re[d] * fp) * fq;
    im[o] = (V.im[a] * (1 - fp) + V.im[b] * fp) * (1 - fq) + (V.im[c] * (1 - fp) + V.im[d] * fp) * fq;
  }
  const img = uvOff.getContext('2d').createImageData(UVRES, UVRES);
  colorize(re, im, img.data, 2 * (autoBrightness(re, im, 0.6) || 1), 'complex');
  uvOff.getContext('2d').putImageData(img, 0, 0);
}
function uvTracks(ctx, width, height, half) {
  // Axes.
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height); ctx.stroke();
  // The tracks, up to now.
  const X = (u) => width / 2 + (u / S.lambda / half) * (width / 2), Y = (v) => height / 2 - (v / S.lambda / half) * (height / 2);
  const upto = Math.round(S.tNow * (tr.nt - 1));
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1.3;
  if (tr.nt === 1) {
    for (let p = 0; p < tr.nb; p++) if (tr.ok[p]) for (const s of [1, -1]) {
      ctx.beginPath(); ctx.arc(X(s * tr.u[p]), Y(s * tr.v[p]), 3, 0, 2 * Math.PI); ctx.fill();
    }
  } else {
    const stride = Math.max(1, Math.floor(tr.nt / 90));
    for (const s of [1, -1]) {
      ctx.beginPath();
      for (let p = 0; p < tr.nb; p++) {
        let on = false;
        for (let k = 0; k <= upto; k = k < upto && k + stride > upto ? upto : k + stride) {
          const o = p * tr.nt + k;
          if (!tr.ok[o]) { on = false; continue; }
          const x = X(s * tr.u[o]), y = Y(s * tr.v[o]);
          if (on) ctx.lineTo(x, y); else { ctx.moveTo(x, y); on = true; }
        }
      }
      ctx.stroke();
    }
    // Where the baselines are now.
    if (S.playing || S.tNow < 1) {
      for (let p = 0; p < tr.nb; p++) {
        const o = p * tr.nt + upto;
        if (!tr.ok[o]) continue;
        for (const s of [1, -1]) { ctx.beginPath(); ctx.arc(X(s * tr.u[o]), Y(s * tr.v[o]), 2.5, 0, 2 * Math.PI); ctx.fill(); }
      }
    }
  }
  // Scale.
  const target = half / 2, p10 = 10 ** Math.floor(Math.log10(target)), nice = (target / p10 >= 5 ? 5 : target / p10 >= 2 ? 2 : 1) * p10;
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(10, height - 12, (nice / half) * (width / 2), 3);
  label(ctx, fmtWaves(nice), 10, height - 17);
  ctx.font = 'italic 13px "Times New Roman", serif'; ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.textAlign = 'right';
  ctx.fillText('u', width - 6, height / 2 - 6); ctx.textAlign = 'left'; ctx.fillText('v', width / 2 + 6, 14);
}

function notes() {
  const [lo, hi] = baselineRange(pos), nb = (S.dishes.length * (S.dishes.length - 1)) / 2;
  $('#map-note').textContent = `${S.dishes.length} dishes, ${nb} baseline${nb === 1 ? '' : 's'}`;
  $('#uv-note').textContent = S.hours > 0 ? `${fmt(S.hours, 3)} h at declination ${fmt(S.dec, 3)}°` : `a snapshot at declination ${fmt(S.dec, 3)}°`;
  $('#beam-note').textContent = !fit ? '' : fit.stripes ? 'stripes: no single peak to fit'
    : `${fmtAngle(fit.major * pix())} × ${fmtAngle(fit.minor * pix())} at half power`;
  $('#sky-note').textContent = `${SKIES[S.sky]}${S.sky === 'point' || S.sky === 'typed' ? '' : `, ${fmtAngle(S.size)}`}; field ${fmtAngle(S.fov)}`;
  let up = 0;
  for (let k = 0; k < tr.nt; k++) { let n = 0; for (let a = 0; a < pos.length; a++) n += tr.up[a * tr.nt + k]; if (n >= 2) up++; }
  const total = grid.samples + grid.dropped;
  const lines = [
    `Longest baseline ${fmtLen(hi)} = ${fmtWaves(hi / S.lambda)}: λ/B = ${fmtAngle(S.lambda / hi)}`,
    `Shortest ${fmtLen(lo)}: nothing larger than about λ/B = ${fmtAngle(S.lambda / lo)} is seen`,
    S.hours > 0 ? `Two or more dishes see the source (above 10°) for ${fmt((S.hours * (up - (up ? 1 : 0))) / Math.max(1, tr.nt - 1), 3)} of the ${fmt(S.hours, 3)} hours` : (up ? 'The source is up' : 'The source is below the horizon'),
  ];
  if (total === 0) lines.push('<span class="warn">No samples: the source is never above 10° for two dishes at once.</span>');
  else if (grid.dropped) lines.push(`<span class="warn">${fmt((100 * grid.dropped) / total, 2)}% of the samples are beyond the grid: make the field smaller</span>`);
  $('#obs-note').innerHTML = lines.join('<br>');
  if (cs) {
    const flux = cs.model.reduce((a, v) => a + v, 0);
    $('#clean-note').textContent = cs.iterations ? `${cs.iterations} steps, ${cs.components} components, ${fmt(flux, 3)} Jy of 1` : '';
  }
}

// ------------------------------------------------------------------ pointer on the map

let dragDish = null;
function hitDish(px, py, w) {
  let best = -1, bd = 12;
  S.dishes.forEach(([E, Nn], i) => { const [x, y] = mapPx(E, Nn, w), d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = i; } });
  return best;
}
mapCanvas.addEventListener('pointerdown', (e) => {
  const r = mapCanvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  const i = hitDish(px, py, r.width);
  S.selected = i;
  if (i >= 0) {
    const [x, y] = mapPx(...S.dishes[i], r.width);
    dragDish = { i, dx: x - px, dy: y - py };
    mapCanvas.setPointerCapture(e.pointerId);
  }
  drawMap();
});
mapCanvas.addEventListener('pointermove', (e) => {
  if (!dragDish) return;
  const r = mapCanvas.getBoundingClientRect();
  let [E, Nn] = mapFromPx(e.clientX - r.left + dragDish.dx, e.clientY - r.top + dragDish.dy, r.width);
  E = Math.max(-mapHalf, Math.min(mapHalf, E)); Nn = Math.max(-mapHalf, Math.min(mapHalf, Nn));
  const lim = 0.98 * Math.PI * R_EARTH, s = Math.hypot(E, Nn);
  if (s > lim) { E *= lim / s; Nn *= lim / s; }
  S.dishes[dragDish.i] = [+E.toPrecision(6), +Nn.toPrecision(6)];
  S.preset = 'custom'; syncPresetButtons();
  synthChanged('geometry');
});
const endDish = () => { if (dragDish) { dragDish = null; syncScale(); } };
mapCanvas.addEventListener('pointerup', endDish);
mapCanvas.addEventListener('pointercancel', endDish);
mapCanvas.addEventListener('dblclick', (e) => {
  const r = mapCanvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  if (hitDish(px, py, r.width) >= 0) return;
  addDish(...mapFromPx(px, py, r.width));
});
mapCanvas.addEventListener('keydown', (e) => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && S.selected >= 0) { e.preventDefault(); removeDish(); }
});
function addDish(E, Nn) {
  if (S.dishes.length >= MAXDISHES) return;
  if (E === undefined) {
    // Somewhere new, inside the map.
    const a = 2.4 * S.dishes.length;
    E = 0.6 * mapHalf * Math.cos(a); Nn = 0.6 * mapHalf * Math.sin(a);
  }
  S.dishes.push([+E.toPrecision(6), +Nn.toPrecision(6)]);
  if (S.names) S.names.push('');
  S.selected = S.dishes.length - 1;
  S.preset = 'custom'; syncPresetButtons(); syncScale();
  synthChanged('geometry');
}
function removeDish() {
  if (S.dishes.length <= 2) return;
  const i = S.selected >= 0 ? S.selected : S.dishes.length - 1;
  S.dishes.splice(i, 1);
  if (S.names) S.names.splice(i, 1);
  S.selected = -1;
  S.preset = 'custom'; syncPresetButtons(); syncScale();
  synthChanged('geometry');
}

// ------------------------------------------------------------------ the Earth turning, CLEAN

let raf = 0, last = 0, active = false, lastCleanDraw = 0;
// Run stops when the brightest pixel left is below 0.5% of the dirty peak, or after 30000 steps.
const CLEAN_STOP = 0.005, CLEAN_MAX = 30000;
function loop(now) {
  raf = 0;
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
  last = now;
  let again = false;
  if (S.playing) {
    // The whole observation in about 8 seconds.
    S.tNow = Math.min(1, S.tNow + dt / 8);
    sampling(); imaging(); drawMoving();
    if (S.tNow >= 1) { S.playing = false; earthButton.textContent = 'Turn the Earth'; onChange(); } else again = true;
  } else if (S.running && cs) {
    // CLEAN for about 25 ms a frame, and show the result a few times a second.
    const thr = CLEAN_STOP * maxAbs(dirty), t0 = performance.now();
    do cleanSteps(cs, beam, N, { gain: S.gain, steps: 10, threshold: thr });
    while (!cs.done && cs.iterations < CLEAN_MAX && performance.now() - t0 < 25);
    restored = null;
    const finished = cs.done || cs.iterations >= CLEAN_MAX;
    if (finished || now - lastCleanDraw > 200) { drawClean(); notes(); lastCleanDraw = now; }
    if (finished) setRunning(false); else again = true;
  }
  if (active && again) raf = requestAnimationFrame(loop); else last = 0;
}
function kick() { if (!raf && active) raf = requestAnimationFrame(loop); }
export function setSynthActive(on) {
  active = on;
  if (on) { synthChanged('geometry', false); kick(); }
}

// ------------------------------------------------------------------ controls

const PRESETS = { two: 'Two dishes', line: 'East–west line', y: 'A Y (like the VLA)', eht: 'Earth-sized (EHT)' };
const presetButtons = {};
for (const [id, labelText] of Object.entries(PRESETS)) {
  const b = el('button', { type: 'button', 'aria-pressed': 'false', onclick: () => loadPreset(id) }, labelText);
  $('#arrays-presets').append(b); presetButtons[id] = b;
}
function syncPresetButtons() { for (const [id, b] of Object.entries(presetButtons)) b.setAttribute('aria-pressed', String(id === S.preset)); latSlider.input.disabled = S.preset === 'eht'; }

/** The longest baseline (the straight distance between two dishes, through the Earth). */
function longest() { return baselineRange(S.dishes.map(([E, Nn]) => stationXYZ(E, Nn, S.lat * DEG)))[1]; }
const scaleSlider = slider({ label: 'longest (km)', min: 0.05, max: 12700, log: true, value: 3.4, title: 'The longest baseline: every dish moves in or out from the centre of the map',
  onInput: (v) => {
    // Scale the map; on a curved Earth the longest baseline isn't quite proportional, so
    // repeat until it is right.
    for (let it = 0; it < 6; it++) {
      const now = longest() / 1000;
      if (!(now > 0) || Math.abs(now / v - 1) < 1e-4) break;
      const f = v / now, lim = 0.98 * Math.PI * R_EARTH;
      S.dishes = S.dishes.map(([E, Nn]) => {
        let e = E * f, n = Nn * f;
        const r = Math.hypot(e, n); if (r > lim) { e *= lim / r; n *= lim / r; }
        return [+e.toPrecision(7), +n.toPrecision(7)];
      });
    }
    fitMap(); synthChanged('geometry');
  } });
function syncScale() { scaleSlider.value = +(longest() / 1000).toPrecision(4); }
$('#scale-box').append(scaleSlider);
$('#dish-edit').append(
  el('button', { type: 'button', onclick: () => addDish(), title: 'Add a dish (or double-click on the map)' }, 'Add a dish'),
  el('button', { type: 'button', onclick: () => removeDish(), title: 'Remove the selected dish (Delete)' }, 'Remove one'),
);

const latSlider = slider({ label: 'latitude (°)', min: -90, max: 90, step: 0.1, value: S.lat, title: 'Where on Earth the array is',
  onInput: (v) => { S.lat = v; synthChanged('geometry'); } });
const decSlider = slider({ label: 'declination (°)', min: -90, max: 90, step: 0.1, value: S.dec, title: 'How far north of the celestial equator the source is',
  onInput: (v) => { S.dec = v; synthChanged('geometry'); } });
const hoursSlider = slider({ label: 'hours', min: 0, max: 24, step: 0.1, value: S.hours, title: 'How long the observation lasts, centred on the source crossing the meridian (0: a snapshot)',
  onInput: (v) => { S.hours = v; S.tNow = 1; synthChanged('geometry'); } });
const lambdaSlider = slider({ label: 'λ (mm)', min: 0.3, max: 2000, log: true, value: S.lambda * 1000, title: 'The wavelength (21 cm: hydrogen; 1.3 mm: the EHT)',
  onInput: (v) => { S.lambda = v / 1000; synthChanged('geometry'); } });
$('#obs-box').append(latSlider, decSlider, hoursSlider, lambdaSlider);
const earthButton = el('button', { type: 'button', class: 'primary', title: 'Replay the observation: the baselines sweep out their tracks as the Earth turns, and the image builds up' }, 'Turn the Earth');
earthButton.addEventListener('click', () => {
  if (S.playing) { S.playing = false; earthButton.textContent = 'Turn the Earth'; return; }
  if (S.hours <= 0) { S.hours = 12; hoursSlider.value = 12; geometry(); }
  setRunning(false);
  S.playing = true; S.tNow = 0; earthButton.textContent = 'Stop';
  kick();
});
$('#earth-box').append(earthButton);

const skyButtons = {};
for (const [id, labelText] of Object.entries(SKIES)) {
  const b = el('button', { type: 'button', 'aria-pressed': 'false', onclick: () => { if (id === 'typed' && S.sky !== 'typed') resetTyped(); setSky(id); } }, labelText);
  $('#skies').append(b); skyButtons[id] = b;
}
async function setSky(id) {
  S.sky = id;
  for (const [k, b] of Object.entries(skyButtons)) b.setAttribute('aria-pressed', String(k === id));
  if (sizeSlider) sizeSlider.hidden = id === 'point' || id === 'typed';
  skyField.hidden = id !== 'typed';
  if (id === 'portrait' && !portrait) {
    try {
      const img = await loadImage('../fft2d/images/fourier-portrait.png');
      const [g] = imageData(img, 512, 'fit');
      portrait = { data: g, w: 512, h: 512 };
    } catch { portrait = null; }
  }
  synthChanged('sky');
}

// Angle sliders in the unit of the moment (minutes of arc for the VLA, microseconds for the EHT).
let sizeSlider = null, fovSlider = null, pendingTyped = null;
function angleSliders() {
  const [u, sym] = UNITS[S.unit];
  const name = { deg: '°', arcmin: '′', arcsec: '″', mas: 'mas', uas: 'µas' }[S.unit];
  const fresh = [
    slider({ label: `size (${name})`, min: (S.fov / u) * 0.01, max: (S.fov / u) * 0.9, log: true, value: +(S.size / u).toPrecision(4), title: 'The angular size of the source',
      onInput: (v) => { S.size = v * u; synthChanged('sky'); } }),
    slider({ label: `field (${name})`, min: (S.fov / u) * 0.1, max: (S.fov / u) * 10, log: true, value: +(S.fov / u).toPrecision(4), title: 'The width of the images: a smaller field has finer pixels',
      onInput: (v) => { S.fov = v * u; synthChanged('sampling'); synthChanged('sky'); } }),
  ];
  void sym;
  $('#sky-box').replaceChildren(...fresh, skyField);
  [sizeSlider, fovSlider] = fresh;
  sizeSlider.hidden = S.sky === 'point' || S.sky === 'typed';
  // The typed sky's parameters get slider ranges that suit the field.
  const f = S.fov / u;
  typedHints = {
    a: { min: 0, max: f / 2, value: +(f / 6).toPrecision(2) }, b: { min: 0, max: f / 2, value: +(f / 8).toPrecision(2) },
    w: { min: f / 200, max: f / 4, value: +(f / 20).toPrecision(2) }, r: { min: f / 200, max: f / 2, value: +(f / 8).toPrecision(2) },
    s: { min: f / 200, max: f / 4, value: +(f / 20).toPrecision(2) },
  };
  skyField.setHints(typedHints);
}
let typedHints = {};
/** The typed sky's parameters back to values that suit the field (new sliders). */
function resetTyped() {
  const p = {};
  for (const k of Object.keys(skyField.params)) p[k] = typedHints[k] ? typedHints[k].value : skyField.params[k];
  skyField.set(skyField.source, p, false);
}

// A sky typed as a formula: x east and y north, in the unit of the sliders.
const SKY_FORMULA = 'exp(-((x - a)^2 + y^2) / w^2) + exp(-((x + a)^2 + y^2) / w^2) + 4 exp(-(x^2 + y^2) / (w/4)^2)';
const skyField = exprField({
  label: '<math><mi>I</mi><mo>(</mo><mi>x</mi><mo>,</mo><mi>y</mi><mo>)</mo><mo>=</mo></math>', value: SKY_FORMULA, variables: ['x', 'y'],
  onChange: () => { if (S.sky === 'typed') synthChanged('sky'); },
});
skyField.hidden = true;
skyField.title = 'The brightness of the sky: x east and y north, in the unit of the field slider; any other letter becomes a slider';

const weightSeg = segmented([
  { value: 'natural', label: 'Natural', title: 'Every sample counts once: the short baselines, sampled most, dominate (smooth, wide beam)' },
  { value: 'uniform', label: 'Uniform', title: 'Every sampled cell of the uv grid counts once: a sharper beam, more sidelobes' },
], S.weighting, (v) => { S.weighting = v; synthChanged('sampling'); }, { label: 'Weighting' });
$('#weight-box').append(el('span', { class: 'small muted' }, 'weighting'), weightSeg);

const stepButton = el('button', { type: 'button', title: 'One CLEAN step: subtract a tenth of the dirty beam at the brightest pixel' }, 'Step');
stepButton.addEventListener('click', () => {
  if (!cs) return;
  S.playing = false; earthButton.textContent = 'Turn the Earth';
  cleanSteps(cs, beam, N, { gain: S.gain, steps: 1 });
  restored = null; drawClean(); notes();
});
const runToggle = toggle('Run', false, (on) => setRunning(on), 'CLEAN until the brightest pixel left is below 0.5% of the dirty image’s peak');
function setRunning(on) {
  S.running = on; runToggle.on = on;
  if (on) { S.playing = false; earthButton.textContent = 'Turn the Earth'; if (cs && cs.done) { cs = cleanStart(dirty); } kick(); }
}
const resetClean = el('button', { type: 'button', title: 'Throw away the CLEAN components' }, 'Start again');
resetClean.addEventListener('click', () => { setRunning(false); cs = cleanStart(dirty); restored = null; drawClean(); notes(); });
$('#clean-box').append(el('span', { class: 'small muted' }, 'CLEAN'), stepButton, runToggle, resetClean);
const gainSlider = slider({ label: 'loop gain', min: 0.01, max: 1, step: 0.01, value: S.gain, title: 'The fraction of the peak removed at each step', onInput: (v) => { S.gain = v; } });
$('#gain-box').append(gainSlider);
const cleanSeg = segmented([
  { value: 'restored', label: 'Restored', title: 'The CLEAN components smoothed by the clean beam, plus the residual' },
  { value: 'residual', label: 'Residual', title: 'What is left of the dirty image' },
  { value: 'model', label: 'Components', title: 'The CLEAN components: points' },
], S.cleanShow, (v) => { S.cleanShow = v; $('#clean-title').textContent = { restored: 'CLEAN image', residual: 'CLEAN residual', model: 'CLEAN components' }[v]; drawClean(); onChange(); }, { label: 'Show' });
$('#clean-show').append(cleanSeg);

// ------------------------------------------------------------------ presets

const DEFAULTS = {
  two: { lat: 34.08, dec: 40, hours: 0, lambda: 0.21, sky: 'point', unit: 'arcmin', size: 1, fov: 8, weighting: 'natural' },
  line: { lat: 52.9, dec: 90, hours: 12, lambda: 0.21, sky: 'double', unit: 'arcmin', size: 1.5, fov: 12, weighting: 'uniform' },
  y: { lat: 34.08, dec: 40, hours: 8, lambda: 0.21, sky: 'portrait', unit: 'arcmin', size: 8, fov: 12, weighting: 'uniform', arm: 1950 },
  eht: { lat: EHT_CENTRE.lat, dec: 12.39, hours: 24, lambda: 0.0013, sky: 'ring', unit: 'uas', size: 42, fov: 300, weighting: 'uniform' },
};

/** Load an array of dishes, with the observation and sky that suit it (o overrides). */
export function loadPreset(id, o = {}) {
  const d = { ...DEFAULTS[id], ...o };
  const L = layout(id, { arm: d.arm ?? 1950 });
  S.preset = id; S.dishes = L.dishes.map(([E, Nn]) => [+E.toPrecision(6), +Nn.toPrecision(6)]); S.names = L.names ? [...L.names] : null;
  S.refLon = id === 'eht' ? EHT_CENTRE.lon : 0;
  if (o.dishes) { S.dishes = o.dishes.map((p) => [...p]); S.preset = 'custom'; if (S.names && S.names.length !== S.dishes.length) S.names = null; }
  configure(d);
}

function configure(d) {
  S.lat = d.lat; S.dec = d.dec; S.hours = d.hours; S.lambda = d.lambda;
  S.unit = d.unit; const [u] = UNITS[S.unit];
  S.size = d.size * u; S.fov = d.fov * u;
  S.weighting = d.weighting; S.tNow = 1; S.playing = false; S.selected = -1;
  S.cleanShow = d.cleanShow || 'restored';
  latSlider.value = S.lat; decSlider.value = S.dec; hoursSlider.value = S.hours; lambdaSlider.value = +(S.lambda * 1000).toPrecision(5);
  weightSeg.value = S.weighting; cleanSeg.value = S.cleanShow;
  $('#clean-title').textContent = { restored: 'CLEAN image', residual: 'CLEAN residual', model: 'CLEAN components' }[S.cleanShow];
  earthButton.textContent = 'Turn the Earth';
  setRunning(false);
  syncPresetButtons(); fitMap(); syncScale(); angleSliders();
  if (pendingTyped) { skyField.set(pendingTyped.source, pendingTyped.params, false); pendingTyped = null; }
  else if (d.sky === 'typed') { skyField.set(d.formula || SKY_FORMULA, {}, false); resetTyped(); }
  setSky(d.sky);
  synthChanged('geometry');
}

export function synthHash() {
  const [u] = UNITS[S.unit];
  const h = {
    array: S.preset, lat: S.lat, dec: S.dec, hours: S.hours, lam: +S.lambda.toPrecision(5), sky: S.sky,
    unit: S.unit, size: +(S.size / u).toPrecision(4), fov: +(S.fov / u).toPrecision(4), wt: S.weighting,
  };
  if (S.preset === 'custom') h.dishes = S.dishes.map(([E, Nn]) => `${+E.toPrecision(6)},${+Nn.toPrecision(6)}`).join(';');
  if (S.cleanShow !== 'restored') h.cshow = S.cleanShow;
  if (S.sky === 'typed') {
    h.I = skyField.source;
    h.Ip = Object.entries(skyField.params).map(([k, v]) => `${k}:${+v.toPrecision(5)}`).join(',');
  }
  return h;
}

export function synthFromHash(h) {
  const num = (k, d) => (h[k] !== undefined && Number.isFinite(+h[k]) ? +h[k] : d);
  if (h.sky === 'typed' && h.I) {
    const params = Object.fromEntries((h.Ip || '').split(',').map((s) => s.split(':')).filter((a) => a.length === 2 && Number.isFinite(+a[1])).map(([k, v]) => [k, +v]));
    pendingTyped = { source: h.I, params };
  }
  const id = DEFAULTS[h.array] ? h.array : 'y';
  const base = DEFAULTS[id];
  const o = {
    lat: num('lat', base.lat), dec: num('dec', base.dec), hours: num('hours', base.hours), lambda: num('lam', base.lambda),
    sky: SKIES[h.sky] ? h.sky : base.sky, unit: UNITS[h.unit] ? h.unit : base.unit, size: num('size', base.size), fov: num('fov', base.fov),
    weighting: h.wt === 'natural' ? 'natural' : h.wt === 'uniform' ? 'uniform' : base.weighting,
    cleanShow: ['restored', 'residual', 'model'].includes(h.cshow) ? h.cshow : 'restored',
  };
  if (h.array === 'custom' && h.dishes) {
    const dishes = h.dishes.split(';').map((s) => s.split(',').map(Number)).filter((a) => a.length === 2 && a.every(Number.isFinite));
    if (dishes.length >= 2) {
      S.preset = 'custom'; S.dishes = dishes.slice(0, MAXDISHES); S.names = null; S.refLon = 0;
      configure({ ...base, ...o });
      return;
    }
  }
  loadPreset(id, o);
}

export const synthApi = {
  /** Milliseconds each stage takes (for the tests). */
  bench() {
    const t = {}, time = (k, f) => { const t0 = performance.now(); f(); t[k] = +(performance.now() - t0).toFixed(2); };
    time('geometry', geometry); time('sampling', sampling); time('imaging', imaging);
    time('map', drawMap); time('uv', drawUV); time('beam', drawBeam); time('sky', drawSky);
    time('dirty', drawDirty); time('clean', drawClean); time('notes', notes);
    const c = cleanStart(dirty);
    time('clean100', () => cleanSteps(c, beam, N, { steps: 100 }));
    time('restore', () => restore(c, fit, N));
    return t;
  },
  get beam() { return beam; }, get dirty() { return dirty; }, get sky() { return skyImg; }, get grid() { return grid; },
  get cs() { return cs; }, get fit() { return fit; }, get tracks() { return tr; }, N,
  clean(steps) { cleanSteps(cs, beam, N, { gain: S.gain, steps, threshold: CLEAN_STOP * maxAbs(dirty) }); restored = null; drawClean(); notes(); return cs; },
  restored() { return restore(cs, fit, N); },
  setRunning, addDish, removeDish, loadPreset, setSky, skyField,
  turnEarth() { earthButton.click(); },
};

window.addEventListener('resize', () => { if (active && tr) drawAll(); });
