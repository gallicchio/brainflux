// Drawing the fields: colour maps, the field image with the materials tinted underneath, and the
// outlines of the materials (marching squares on each material's share of every cell).

import { contour } from '../lib/plot.js';
import { SUB } from './scene.js';

const LUT_N = 1024;

function ramp(stops) {
  const lut = new Uint8ClampedArray(LUT_N * 3);
  for (let q = 0; q < LUT_N; q++) {
    const v = q / (LUT_N - 1);
    let s = 0;
    while (s < stops.length - 2 && v > stops[s + 1][0]) s++;
    const [v0, c0] = stops[s], [v1, c1] = stops[s + 1], t = Math.min(1, Math.max(0, (v - v0) / (v1 - v0)));
    for (let c = 0; c < 3; c++) lut[3 * q + c] = c0[c] + (c1[c] - c0[c]) * t;
  }
  return lut;
}

/** A diverging map, dark at zero (so the tint of the materials shows through): blue for
 *  negative, red and yellow for positive.  Index 0 is -1, LUT_N - 1 is +1. */
export const DIVERGING = ramp([
  [0, [215, 240, 255]], [0.15, [95, 175, 255]], [0.3, [35, 95, 215]], [0.42, [12, 34, 96]], [0.5, [0, 0, 0]],
  [0.58, [100, 22, 12]], [0.7, [215, 72, 30]], [0.85, [255, 165, 60]], [1, [255, 246, 214]],
]);

/** A sequential map for intensities: black, violet, red, orange, pale yellow. */
export const SEQUENTIAL = ramp([
  [0, [0, 0, 0]], [0.18, [40, 12, 90]], [0.38, [130, 28, 110]], [0.58, [215, 70, 60]], [0.78, [250, 160, 40]], [1, [252, 252, 200]],
]);

/** The colour of the materials under the field, per material of the scene's palette. */
export function tintOf(mat) {
  if (mat.pec) return [150, 156, 166];
  if (mat.sig) return [52, 34, 20];
  if (mat.bg) return [0, 0, 0];
  const n = Math.sqrt(mat.eps);
  if (n <= 1.001) return [0, 0, 0];
  const t = Math.min(1, (n - 1) / 0.5), h = Math.min(1, Math.max(0, (n - 1.5) / 2));
  return [(34 + 40 * h) * t, (54 - 10 * h) * t, (82 + 30 * h) * t];
}

/**
 * The scene's interior as RGB tints (one per cell) and a mask of metal cells, from the fine
 * samples: the average colour of the samples of each cell, and the background's index shown
 * as a faint glow where it is not vacuum.
 */
export function materialImage(scene) {
  const { cw, ch, pml, fx, fine, palette, bgEps } = scene;
  const tint = new Uint8ClampedArray(cw * ch * 3), metal = new Uint8Array(cw * ch);
  const tints = palette.map(tintOf);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    let r = 0, g = 0, b = 0, m = 0;
    for (let q = 0; q < SUB; q++) {
      const row = ((j + pml) * SUB + q) * fx + (i + pml) * SUB;
      for (let p = 0; p < SUB; p++) {
        const f = row + p, id = fine[f], mat = palette[id];
        if (mat.pec) m++;
        if (mat.bg && bgEps && bgEps[f] > 1.0001) { const c = tintOf({ eps: bgEps[f] }); r += c[0]; g += c[1]; b += c[2]; }
        else { const c = tints[id]; r += c[0]; g += c[1]; b += c[2]; }
      }
    }
    // Row 0 of the image is the top of the box.
    const o = (ch - 1 - j) * cw + i, S2 = SUB * SUB;
    tint[3 * o] = r / S2; tint[3 * o + 1] = g / S2; tint[3 * o + 2] = b / S2;
    metal[o] = 2 * m >= S2 ? 1 : 0;
  }
  return { tint, metal };
}

/**
 * Outlines of the painted materials as segments in box coordinates (vacuum wavelengths): for
 * each material, the half-way contour of its share of each cell.
 */
export function outlines(scene) {
  const { cw, ch, pml, fx, fine, palette, dx, W, H } = scene, S2 = SUB * SUB;
  const ids = new Set();
  for (let q = pml * SUB; q < (pml + ch) * SUB; q++) for (let p = pml * SUB; p < (pml + cw) * SUB; p++) ids.add(fine[q * fx + p]);
  const segs = [];
  // Pad by one cell of zeros so that shapes touching the edge of the box are closed there.
  const nx = cw + 2, ny = ch + 2;
  for (const id of ids) {
    if (palette[id].bg) continue;
    const share = new Float32Array(nx * ny);
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      let c = 0;
      for (let q = 0; q < SUB; q++) {
        const row = ((j + pml) * SUB + q) * fx + (i + pml) * SUB;
        for (let p = 0; p < SUB; p++) if (fine[row + p] === id) c++;
      }
      share[(j + 1) * nx + i + 1] = c / S2;
    }
    // Copy the edge cells outwards: no outline along the edge of the box.
    for (let i = 0; i < nx; i++) { share[i] = share[nx + i]; share[(ny - 1) * nx + i] = share[(ny - 2) * nx + i]; }
    for (let j = 0; j < ny; j++) { share[j * nx] = share[j * nx + 1]; share[j * nx + nx - 1] = share[j * nx + nx - 2]; }
    const out = [];
    contour(share, nx, ny, 0.5, (x0, y0, x1, y1) => {
      // Grid point (i, j) of the padded array is the centre of cell (i - 1, j - 1).
      out.push((x0 - 0.5) * dx - W / 2, (y0 - 0.5) * dx - H / 2, (x1 - 0.5) * dx - W / 2, (y1 - 0.5) * dx - H / 2);
    });
    segs.push({ id, pec: !!palette[id].pec, absorb: !!palette[id].sig, segs: Float32Array.from(out) });
  }
  return segs;
}

/**
 * Fill an ImageData (cw x ch, top row = top of the box) with the field u over the materials.
 *   mode 'field': u / R through the diverging map; 'intensity': I / R through the sequential one.
 */
export function fieldImage(img, sim, scene, mats, R, mode) {
  const { cw, ch, pml } = scene, nx = sim.nx, d = img.data, { tint, metal } = mats;
  const src = mode === 'intensity' ? sim.intensity : sim.u;
  const lut = mode === 'intensity' ? SEQUENTIAL : DIVERGING, inv = 1 / R, top = LUT_N - 1;
  for (let j = 0; j < ch; j++) {
    const row = (j + pml) * nx + pml, o0 = (ch - 1 - j) * cw;
    for (let i = 0; i < cw; i++) {
      const o = o0 + i, p = 4 * o;
      if (metal[o]) { d[p] = tint[3 * o]; d[p + 1] = tint[3 * o + 1]; d[p + 2] = tint[3 * o + 2]; d[p + 3] = 255; continue; }
      const v = src ? src[row + i] * inv : 0;
      let q;
      if (mode === 'intensity') q = (top * (v / (1 + v))) | 0;
      else q = (top * 0.5 * (1 + v / (1 + Math.abs(v)))) | 0;
      const c = 3 * q;
      d[p] = tint[3 * o] + lut[c]; d[p + 1] = tint[3 * o + 1] + lut[c + 1]; d[p + 2] = tint[3 * o + 2] + lut[c + 2]; d[p + 3] = 255;
    }
  }
}

/** A typical size of the field in the box (the 99th percentile of |f| over a sample of cells). */
export function typical(f, scene, nx, fraction = 0.99) {
  const { cw, ch, pml } = scene, M = 4096, vals = new Float64Array(M);
  const step = Math.max(1, Math.floor((cw * ch) / M));
  let m = 0;
  for (let s = 0; s < cw * ch && m < M; s += step) {
    const i = s % cw, j = (s - i) / cw;
    vals[m++] = Math.abs(f[(j + pml) * nx + pml + i]);
  }
  const v = vals.subarray(0, m).sort();
  return v[Math.min(m - 1, Math.floor(fraction * m))] || 0;
}
