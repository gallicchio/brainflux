// What the Michelson shows: the coloured fringes on its screen, the detector's trace, and a
// fringe counter.  No DOM here: images are written into plain RGBA arrays.
//
// The screen.  Looking into the interferometer with the eye focused at infinity, the light
// arriving at angle θ from the axis has crossed the "air plate" between M1 and the image of M2
// twice at an angle, a path difference Δ cos θ: fringes of equal inclination, circles.  Tilting
// M2 by α makes a wedge, adding 2αx across the mirror: straight fringes of equal thickness.
// This demo uses the simple sum  Δ'(x, y) = Δ cos θ + 2αx  (θ in proportion to the distance from
// the centre of the screen, x across the mirror), which gives rings, straight fringes and the
// curved ones between, as a real instrument does (the two kinds of fringe really form in
// different planes; the sum is a model of what one sees, not an exact calculation).
//
// Colour.  Each point of the screen gets the tristimulus values
//     X(Δ') = ∫ S(σ) x̄(σ) [1 + cos 2πσΔ'] dσ   (and Y, Z alike),
// which depend on Δ' alone, so they are computed once per frame on a fine grid of Δ' (averaged
// over each grid cell, exactly, by a factor sinc(πσh) on each wavenumber) and summed into a
// table; each pixel then takes the average over the range of Δ' it covers, including the motion
// of the mirror during the frame.  Fine fringes therefore blur as they would to the eye, instead
// of making moiré patterns.

import { cmfSigma, xyzToLinear, gamutFix, ENCODE_TABLE, ENCODE_SCALE } from './colour.js';
import { GRID, BROAD_W, TWO_PI, sinc, sinc2 } from './spectrum.js';

const CMF_GRID = Array.from({ length: GRID.n }, (_, i) => cmfSigma(GRID.s0 + i * GRID.ds));

/** A spectrum weighted by the three colour matching functions. */
export class ColourModel {
  constructor(spec) {
    // Narrow lines keep their own Γ; everything else goes on GRID, times x̄, ȳ, z̄.
    this.lines = spec.lines.filter((l) => l.w < BROAD_W && l.A !== 0).map((l) => {
      const c = cmfSigma(l.s);
      return { s: l.s, w: l.w, cx: l.A * c[0], cy: l.A * c[1], cz: l.A * c[2] };
    });
    const g = spec.gridValues();
    const n = GRID.n, wx = new Float64Array(n), wy = new Float64Array(n), wz = new Float64Array(n);
    let i0 = n, i1 = -1;
    for (let i = 0; i < n; i++) {
      const c = CMF_GRID[i];
      wx[i] = g[i] * c[0]; wy[i] = g[i] * c[1]; wz[i] = g[i] * c[2];
      if (wx[i] || wy[i] || wz[i]) { i0 = Math.min(i0, i); i1 = i; }
    }
    Object.assign(this, { wx, wy, wz, i0, i1 });
    const base = [0, 0, 0];
    for (const l of this.lines) { base[0] += l.cx; base[1] += l.cy; base[2] += l.cz; }
    for (let i = i0; i <= i1; i++) { base[0] += wx[i] * GRID.ds; base[1] += wy[i] * GRID.ds; base[2] += wz[i] * GRID.ds; }
    this.base = base;   // X, Y, Z without interference (the mean over many fringes)
    // The largest wavenumber with any colour: fixes how fine the table must be.
    let top = i1 >= i0 ? GRID.s0 + (i1 + 1) * GRID.ds : 0;
    for (const l of this.lines) top = Math.max(top, l.s);
    this.sigmaTop = top || 2.6;
    // Exposure: constructive interference (twice the mean) is full brightness.
    const rgb = gamutFix(xyzToLinear(2 * base[0], 2 * base[1], 2 * base[2]));
    const m = Math.max(...rgb);
    this.exposure = m > 0 ? 1 / m : 0;
  }

  /**
   * The averages of X, Y, Z over n cells of width h starting at D0, as a running sum: returns
   * Float64Array(3 (n + 1)), C[3k + c] = ∫ from D0 to D0 + kh of channel c.
   */
  table(D0, h, n) {
    const avg = new Float64Array(3 * n);
    const PI2 = Math.PI * Math.PI;
    // Lines: A c̄ e^{-2π²w²Δ²} cos(2πsΔ) averaged over the cell -> times sinc(πsh).
    for (const l of this.lines) {
      const k = sinc(Math.PI * l.s * h), g = 2 * PI2 * l.w * l.w;
      for (let j = 0; j < n; j++) {
        const D = D0 + (j + 0.5) * h, e = k * Math.exp(-g * D * D) * Math.cos(TWO_PI * l.s * D);
        avg[3 * j] += l.cx * e; avg[3 * j + 1] += l.cy * e; avg[3 * j + 2] += l.cz * e;
      }
    }
    // The grid: Σ_i w_i ds sinc²(π ds Δ) cos(2πσ_iΔ) sinc(πσ_i h), by rotation along the cells.
    if (this.i1 >= this.i0) {
      const tx = new Float64Array(n), ty = new Float64Array(n), tz = new Float64Array(n);
      const { wx, wy, wz } = this;
      for (let i = this.i0; i <= this.i1; i++) {
        const s = GRID.s0 + i * GRID.ds, k = sinc(Math.PI * s * h);
        const ax = wx[i] * k, ay = wy[i] * k, az = wz[i] * k;
        if (!ax && !ay && !az) continue;
        const a = TWO_PI * s * (D0 + 0.5 * h), st = TWO_PI * s * h, cs = Math.cos(st), ss = Math.sin(st);
        let c = Math.cos(a), sn = Math.sin(a);
        for (let j = 0; j < n; j++) {
          tx[j] += ax * c; ty[j] += ay * c; tz[j] += az * c;
          const t = c * cs - sn * ss; sn = c * ss + sn * cs; c = t;
        }
      }
      for (let j = 0; j < n; j++) {
        const D = D0 + (j + 0.5) * h, env = GRID.ds * sinc2(Math.PI * GRID.ds * D);
        avg[3 * j] += tx[j] * env; avg[3 * j + 1] += ty[j] * env; avg[3 * j + 2] += tz[j] * env;
      }
    }
    const C = new Float64Array(3 * (n + 1)), [X0, Y0, Z0] = this.base;
    for (let j = 0; j < n; j++) {
      C[3 * j + 3] = C[3 * j] + (X0 + avg[3 * j]) * h;
      C[3 * j + 4] = C[3 * j + 1] + (Y0 + avg[3 * j + 1]) * h;
      C[3 * j + 5] = C[3 * j + 2] + (Z0 + avg[3 * j + 2]) * h;
    }
    return C;
  }

  /** X, Y, Z at one path difference (no averaging), for tests and read-outs. */
  xyzAt(D) {
    const C = this.table(D - 1e-6, 2e-6, 1);
    return [C[3] / 2e-6, C[4] / 2e-6, C[5] / 2e-6];
  }
}

/** Δ' at a point of the screen: u, v in -1..1 across it. */
export function screenPath(u, v, opts) {
  const r = Math.hypot(u, v);
  return opts.D * Math.cos(opts.thetaMax * r) + opts.tilt * u;
}

/**
 * Draw the screen into img (Uint8ClampedArray of n*n*4).
 *   opts: D (path difference at the centre, μm), Dprev (at the previous frame, for motion blur),
 *         tilt (2α times the half-width of the mirror: Δ' changes by ±tilt across the screen),
 *         thetaMax (the angle at the edge of the screen, rad), n (pixels across).
 * Returns { lo, hi, h, cells } (the table used) for read-outs.
 */
// Per-pixel geometry of the round screen, kept between frames: u (across), cos θ, sin θ, and the
// soft edge (0 outside the field of view).
let geo = null;
function geometry(n, thetaMax) {
  if (geo && geo.n === n && geo.thetaMax === thetaMax) return geo;
  const N = n * n, U = new Float32Array(N), CT = new Float32Array(N), ST = new Float32Array(N), EDGE = new Float32Array(N), half = n / 2;
  for (let y = 0; y < n; y++) {
    const v = (half - y - 0.5) / half;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5 - half) / half, p = y * n + x, r = Math.sqrt(u * u + v * v);
      U[p] = u; CT[p] = Math.cos(thetaMax * r); ST[p] = Math.sin(thetaMax * r);
      EDGE[p] = r >= 1 ? 0 : Math.min(1, (1 - r) * half * 0.7);
    }
  }
  geo = { n, thetaMax, U, CT, ST, EDGE };
  return geo;
}

export function renderScreen(model, opts, img) {
  const { D, tilt, thetaMax, n } = opts, Dprev = opts.Dprev ?? D;
  const blur = Math.abs(D - Dprev), px = 2 / n;
  const cmin = Math.min(D, D * Math.cos(thetaMax)), cmax = Math.max(D, D * Math.cos(thetaMax));
  const foot = Math.abs(D) * thetaMax * Math.sin(thetaMax) * px + Math.abs(tilt) * px;
  const lo = cmin - Math.abs(tilt) - blur - foot - 1e-3, hi = cmax + Math.abs(tilt) + blur + foot + 1e-3;
  const hTarget = 1 / (24 * model.sigmaTop);
  const cells = Math.max(2, Math.min(4096, Math.ceil((hi - lo) / hTarget)));
  const h = (hi - lo) / cells;
  const C = model.table(lo, h, cells);
  const k = model.exposure, inv = 1 / h, dD = D - Dprev;
  const { U, CT, ST, EDGE } = geometry(n, thetaMax);
  const sD = Math.abs(D) * thetaMax * px, sT = Math.abs(tilt) * px, last = cells - 1;
  // One 32-bit write per pixel (RGBA bytes in memory order: little-endian ABGR).
  const out = new Uint32Array(img.buffer, img.byteOffset, n * n), E = ENCODE_TABLE, ES = ENCODE_SCALE;
  for (let p = 0, N = n * n; p < N; p++) {
    const e = EDGE[p];
    if (e === 0) { out[p] = 0xff000000; continue; }
    const ct = CT[p], c = D * ct + tilt * U[p], cp = c - dD * ct, s = 0.5 * (sD * ST[p] + sT);
    // The range of path difference this pixel sees during the frame, in table cells.
    let pa = ((c < cp ? c : cp) - s - lo) * inv, pb = ((c < cp ? cp : c) + s - lo) * inv;
    if (pa < 0) pa = 0; else if (pa > cells) pa = cells;
    if (pb < 0) pb = 0; else if (pb > cells) pb = cells;
    let X, Y, Z;
    if (pb - pa < 1e-3) {
      let j = pa | 0; if (j > last) j = last;
      const q = 3 * j;
      X = (C[q + 3] - C[q]) * inv; Y = (C[q + 4] - C[q + 1]) * inv; Z = (C[q + 5] - C[q + 2]) * inv;
    } else {
      let ja = pa | 0; if (ja > last) ja = last;
      let jb = pb | 0; if (jb > last) jb = last;
      const fa = pa - ja, fb = pb - jb, qa = 3 * ja, qb = 3 * jb, w = inv / (pb - pa);
      X = (C[qb] + fb * (C[qb + 3] - C[qb]) - C[qa] - fa * (C[qa + 3] - C[qa])) * w;
      Y = (C[qb + 1] + fb * (C[qb + 4] - C[qb + 1]) - C[qa + 1] - fa * (C[qa + 4] - C[qa + 1])) * w;
      Z = (C[qb + 2] + fb * (C[qb + 5] - C[qb + 2]) - C[qa + 2] - fa * (C[qa + 5] - C[qa + 2])) * w;
    }
    // Linear sRGB, negative channels cut to zero (gamutFix), a soft edge to the round field.
    const g = e * k;
    const R = (3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z) * g;
    const G = (-0.969266 * X + 1.8760108 * Y + 0.041556 * Z) * g;
    const B = (0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z) * g;
    out[p] = (0xff000000 | (E[((B <= 0 ? 0 : B >= 1 ? 1 : B) * ES + 0.5) | 0] << 16)
      | (E[((G <= 0 ? 0 : G >= 1 ? 1 : G) * ES + 0.5) | 0] << 8) | E[((R <= 0 ? 0 : R >= 1 ? 1 : R) * ES + 0.5) | 0]) >>> 0;
  }
  return { lo, hi, h, cells };
}

/**
 * The smallest and largest detector signal I(Δ) for Δ in [a, b]: sampled finely enough to follow
 * the fringes when there are few, the envelope I0 ± |Γ| when there are many.
 */
export function minMaxOver(spec, a, b, sigmaTop, out = [0, 0]) {
  const per = 1 / sigmaTop, L = b - a, g = [0, 0], I0 = spec.I0;
  let lo = Infinity, hi = -Infinity;
  // Few fringes: sample finely enough to follow them.  Many: the envelope at 16 points.
  const many = L > 4 * per;
  const n = L <= per / 8 ? 2 : many ? 16 : Math.ceil(L / (per / 8)) + 1;
  for (let i = 0; i < n; i++) {
    const D = n === 1 ? a : a + (L * i) / (n - 1);
    spec.gamma(D, g);
    const I = I0 + g[0];
    if (I < lo) lo = I;
    if (I > hi) hi = I;
    if (many) {
      const m = Math.hypot(g[0], g[1]);
      if (I0 - m < lo) lo = I0 - m;
      if (I0 + m > hi) hi = I0 + m;
    }
  }
  out[0] = lo; out[1] = hi;
  return out;
}

/**
 * A fringe counter, as a photodiode and an up/down counter would work: each time the signal
 * rises through I0 (1 + 0.3) after having been below I0 (1 - 0.3), one fringe is counted, plus
 * or minus with the direction of the mirror.  Fringes of low visibility (< 0.3) are missed.
 */
export class FringeCounter {
  constructor() { this.reset(0); }
  reset(D) { this.count = 0; this.start = D; this.armed = null; this.lost = false; }
  /** The mirror moved so that Δ went from D0 to D1. */
  advance(spec, D0, D1, sigmaTop) {
    if (D0 === D1 || !(spec.I0 > 0)) return;
    const step = 1 / (16 * sigmaTop), n = Math.ceil(Math.abs(D1 - D0) / step);
    if (n > 40000) { this.lost = true; return; }   // too fast for the counter
    const hi = 1.3 * spec.I0, lo = 0.7 * spec.I0, dir = Math.sign(D1 - D0);
    for (let i = 1; i <= n; i++) {
      const I = spec.intensity(D0 + ((D1 - D0) * i) / n);
      if (I < lo) this.armed = true;
      else if (I > hi && this.armed) { this.count += dir; this.armed = false; }
    }
  }
}
