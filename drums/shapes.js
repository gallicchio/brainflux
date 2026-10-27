// The drums: preset shapes with their exact geometry, the masks drawn from them on the grid, and
// the exactly known spectra.  No DOM.
//
// The box is the square −1/2 ≤ x, y ≤ 1/2 with n × n grid points x_i = −1/2 + i h, h = 1/(n − 1).
// A grid point is free (the membrane moves there) if it is more than h/2 inside the shape;
// the others are walls (u = 0).  The discrete drum then behaves as if its edge were at its
// walls, which on average sit on the true edge: a curved edge becomes a staircase whose error in
// λ is first order in h but averages out (straight edges along grid lines or diagonals, through
// grid points, are exact).  Shapes are placed so that their straight edges do just that.
//
// Every preset gives sdf(x, y), the signed distance to its edge (positive inside), used for the
// mask and for the classical ray's reflections; its area A, perimeter P and the constant K of
// Weyl's law,  N(λ) ≈ Aλ/4π − P√λ/4π + K,  with K = Σ_corners (π² − θ²)/(24πθ) + ∫κ ds/12π;
// and, when known, its exact eigenvalues.

import { besselJ } from '../lib/bessel.js';

const PI = Math.PI;

/** Snap a length to a whole number of grid steps. */
const snap = (v, h) => Math.max(1, Math.round(v / h)) * h;
/** Snap a coordinate to the grid. */
const onGrid = (v, h) => -0.5 + Math.round((v + 0.5) / h) * h;

// ------------------------------------------------------------------ geometry helpers

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** A polygon (array of [x, y], counter-clockwise): sdf, area, perimeter, Weyl's K. */
export function polygon(pts) {
  const n = pts.length;
  let area = 0, perimeter = 0, K = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n];
    area += x0 * y1 - x1 * y0;
    perimeter += Math.hypot(x1 - x0, y1 - y0);
  }
  area /= 2;
  const s = area < 0 ? -1 : 1;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[(i + n - 1) % n], [bx, by] = pts[i], [cx, cy] = pts[(i + 1) % n];
    // Interior angle at b: π minus the turning angle (counter-clockwise).
    const turn = Math.atan2((bx - ax) * (cy - by) - (by - ay) * (cx - bx), (bx - ax) * (cx - bx) + (by - ay) * (cy - by));
    const theta = PI - s * turn;
    K += (PI * PI - theta * theta) / (24 * PI * theta);
  }
  const sdf = (x, y) => {
    let d = Infinity, inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      d = Math.min(d, segDist(x, y, xj, yj, xi, yi));
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside ? d : -d;
  };
  return { sdf, area: Math.abs(area), perimeter, K, outline: [pts.concat([pts[0]])] };
}

function arcPoints(cx, cy, r, a0, a1, steps = 64) {
  const out = [];
  for (let k = 0; k <= steps; k++) { const a = a0 + ((a1 - a0) * k) / steps; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
}

// ------------------------------------------------------------------ exact spectra

/** The first `count` zeros of J_m (bracketed on a fine scan, then bisection). */
export function besselZeros(m, count) {
  const out = [];
  const J = (x) => besselJ(m, x)[m];
  let x = Math.max(0.5, m * 0.9), fx = J(x);
  const dx = 0.05;
  while (out.length < count) {
    const y = x + dx, fy = J(y);
    if (fx === 0) out.push(x);
    else if (fx * fy < 0) {
      let a = x, b = y, fa = fx;
      for (let k = 0; k < 60; k++) {
        const c = 0.5 * (a + b), fc = J(c);
        if (fa * fc <= 0) b = c; else { a = c; fa = fc; }
      }
      out.push(0.5 * (a + b));
    }
    x = y; fx = fy;
  }
  return out;
}

/** Sorted list of {lambda, label} for the rectangle a × b (continuum). */
function rectangleSpectrum(a, b, lmax) {
  const out = [];
  for (let m = 1; (m * PI / a) ** 2 < lmax; m++) {
    for (let k = 1; ; k++) {
      const l = (m * PI / a) ** 2 + (k * PI / b) ** 2;
      if (l > lmax) break;
      out.push({ lambda: l, label: `(${m}, ${k})` });
    }
  }
  return out.sort((p, q) => p.lambda - q.lambda);
}

/** Disc of radius R (m ≥ 0; m ≥ 1 twice, cos and sin) or half disc (m ≥ 1, once). */
function discSpectrum(R, lmax, half) {
  const out = [];
  const jmax = R * Math.sqrt(lmax);
  for (let m = half ? 1 : 0; m < jmax; m++) {
    const n = Math.ceil(jmax / PI) + 2;
    const zeros = besselZeros(m, n);
    zeros.forEach((j, k) => {
      if (j > jmax) return;
      const l = (j / R) ** 2;
      if (half || m === 0) out.push({ lambda: l, label: `(${m}, ${k + 1})`, j });
      else { out.push({ lambda: l, label: `(±${m}, ${k + 1})`, j }); out.push({ lambda: l, label: `(±${m}, ${k + 1})`, j }); }
    });
  }
  return out.sort((p, q) => p.lambda - q.lambda);
}

/** Equilateral triangle of side s (Lamé): λ = (16π²/9s²)(m² + mn + n²), m, n ≥ 1. */
function triangleSpectrum(s, lmax) {
  const out = [], c = (16 * PI * PI) / (9 * s * s);
  for (let m = 1; c * (m * m + m + 1) <= lmax; m++) {
    for (let n = 1; c * (m * m + m * n + n * n) <= lmax; n++) out.push({ lambda: c * (m * m + m * n + n * n), label: `(${m}, ${n})` });
  }
  return out.sort((p, q) => p.lambda - q.lambda);
}

// ------------------------------------------------------------------ the presets

// The two drums of Gordon, Webb and Wolpert (1992), each seven right isosceles triangles with
// legs of length 1, glued as the points and as the lines of the Fano plane (Sunada's method):
// different shapes, the same spectrum.  Their legs lie along grid lines and their hypotenuses
// along grid diagonals, through grid points, so the grid sees the triangles' mirror lines
// exactly and the two discrete drums are isospectral too (to rounding error: see the tests).
export const GWW = [
  [[0, 0], [1, 0], [1, 1], [2, 1], [3, 2], [2, 2], [2, 3], [0, 1]],
  [[0, 1], [2, 1], [2, 0], [3, 1], [2, 2], [1, 2], [1, 3], [0, 2]],
];

/**
 * Each preset: label, params {name: {min, max, value, label, title}}, and make(params, h) giving
 * { sdf, area, perimeter, K, outline: [polylines], exact?(lmax), discrete?(count) , note }.
 */
export const PRESETS = {
  square: {
    label: 'Square',
    params: { a: { min: 0.3, max: 1, value: 1, label: 'side', title: 'The side of the square (the box is 1)' } },
    make({ a }, h) {
      a = Math.min(1, Math.max(4 * h, 1 - 2 * Math.round((1 - a) / (2 * h)) * h));
      return { ...rect(a, a, h), name: 'square' };
    },
  },
  rectangle: {
    label: 'Rectangle',
    params: {
      a: { min: 0.3, max: 1, value: 1, label: 'width', title: 'Width (the box is 1)' },
      b: { min: 0.2, max: 1, value: 0.618, label: 'height', title: 'Height; with a ratio of sides far from a fraction, the spectrum has no regularity left (Poisson statistics)' },
    },
    make({ a, b }, h) {
      a = Math.min(1, Math.max(4 * h, 1 - 2 * Math.round((1 - a) / (2 * h)) * h));
      b = Math.max(4 * h, snap(b, h));
      return rect(a, b, h);
    },
  },
  circle: {
    label: 'Circle',
    params: { R: { min: 0.1, max: 0.49, value: 0.48, label: 'radius', title: 'The radius (the box is 1 wide)' } },
    make({ R }) {
      return {
        sdf: (x, y) => R - Math.hypot(x, y), area: PI * R * R, perimeter: 2 * PI * R, K: 1 / 6,
        outline: [arcPoints(0, 0, R, 0, 2 * PI, 160)],
        exact: (lmax) => discSpectrum(R, lmax, false),
        exactNote: 'λ = (jₘₖ/R)², jₘₖ the k-th zero of the Bessel function Jₘ; (m, k) with ±m for cos mθ and sin mθ',
      };
    },
  },
  halfdisc: {
    label: 'Half circle',
    params: { R: { min: 0.1, max: 0.49, value: 0.49, label: 'radius', title: 'The radius' } },
    make({ R }, h) {
      const y0 = onGrid(-R / 2, h);
      return {
        sdf: (x, y) => Math.min(R - Math.hypot(x, y - y0), y - y0),
        area: (PI * R * R) / 2, perimeter: PI * R + 2 * R, K: 1 / 8 + 1 / 12,
        outline: [[...arcPoints(0, y0, R, 0, PI, 100), [R, y0]]],
        exact: (lmax) => discSpectrum(R, lmax, true),
        exactNote: 'λ = (jₘₖ/R)² with m ≥ 1 only: the circle\'s modes sin mθ',
      };
    },
  },
  stadium: {
    label: 'Stadium',
    params: {
      r: { min: 0.05, max: 0.49, value: 0.245, label: 'radius', title: 'The radius of the round ends' },
      a: { min: 0, max: 0.45, value: 0.245, label: 'straight', title: 'Half the length of the straight sides (0: a circle)' },
    },
    make({ r, a }, h) {
      r = Math.max(2 * h, onGrid(Math.min(r, 0.49), h)); // the straight sides on grid lines
      a = Math.max(0, Math.min(a, 0.49 - r));
      const sdf = (x, y) => r - Math.hypot(Math.max(0, Math.abs(x) - a), y);
      const top = [[-a, r], ...arcPoints(-a, 0, r, PI / 2, 1.5 * PI, 80), [a, -r], ...arcPoints(a, 0, r, -PI / 2, PI / 2, 80)];
      top.push(top[0]);
      return { sdf, area: 4 * a * r + PI * r * r, perimeter: 4 * a + 2 * PI * r, K: 1 / 6, outline: [top], orbitScale: { a, r } };
    },
  },
  qstadium: {
    label: 'Quarter stadium',
    params: {
      r: { min: 0.1, max: 0.98, value: 0.495, label: 'radius', title: 'The radius of the round end' },
      a: { min: 0, max: 0.8, value: 0.495, label: 'straight', title: 'The length of the straight side' },
    },
    make({ r, a }, h) {
      r = snap(Math.min(r, 0.99), h); a = Math.max(0, Math.min(a, 0.99 - r));
      const x0 = -0.5, y0 = -0.5;
      const sdf = (x, y) => Math.min(x - x0, y - y0, r - Math.hypot(Math.max(0, x - x0 - a), y - y0));
      const out = [[x0, y0], [x0 + a + r, y0], ...arcPoints(x0 + a, y0, r, 0, PI / 2, 60), [x0, y0 + r], [x0, y0]];
      return {
        sdf, area: a * r + (PI * r * r) / 4, perimeter: 2 * a + 2 * r + (PI * r) / 2, K: 3 / 16 + 1 / 24, outline: [out],
        note: 'One quarter of a stadium: one of its four symmetry classes, so no symmetry is left to hide the level repulsion',
      };
    },
  },
  sinai: {
    label: 'Sinai billiard',
    params: { R: { min: 0.05, max: 0.45, value: 0.25, label: 'disk', title: 'The radius of the disk in the middle' } },
    make({ R }) {
      const box = rect(1, 1, 1);
      return {
        sdf: (x, y) => Math.min(box.sdf(x, y), Math.hypot(x, y) - R), area: 1 - PI * R * R, perimeter: 4 + 2 * PI * R, K: 1 / 4 - 1 / 6,
        outline: [box.outline[0], arcPoints(0, 0, R, 0, 2 * PI, 120)],
      };
    },
  },
  sinai8: {
    label: 'Sinai, ⅛',
    params: { R: { min: 0.1, max: 0.8, value: 0.4, label: 'disk', title: 'The radius of the disk' } },
    make({ R }) {
      // One eighth of a square with a disk in its middle, as Bohigas, Giannoni and Schmit (1984)
      // used it: 0 ≤ y ≤ x ≤ 1 outside the disk, from the corner of the box.
      const x0 = -0.5, y0 = -0.5, s2 = Math.SQRT1_2;
      const sdf = (x, y) => { const X = x - x0, Y = y - y0; return Math.min(Y, (X - Y) * s2, 1 - X, Math.hypot(X, Y) - R); };
      const out = [[x0 + R, y0], [x0 + 1, y0], [x0 + 1, y0 + 1], ...arcPoints(x0, y0, R, PI / 4, 0, 40)];
      out.push(out[0]);
      return {
        sdf, area: 0.5 - (PI * R * R) / 8, perimeter: 2 + Math.SQRT2 - 2 * R + (PI * R) / 4, K: 3 / 16 + 5 / 32 - 1 / 48, outline: [out],
        note: 'One eighth of the Sinai billiard: no symmetry left',
      };
    },
  },
  cardioid: {
    label: 'Cardioid',
    params: { a: { min: 0.1, max: 0.377, value: 0.377, label: 'size', title: 'r = a(1 + cos θ)' } },
    make({ a }) {
      const cx = -0.875 * a; // the cusp, so that the cardioid is centred in the box
      const f = (x, y) => { const X = x - cx, rr = X * X + y * y, q = rr - a * X; return q * q - a * a * rr; };
      const sdf = (x, y) => {
        const e = 1e-6, v = f(x, y), gx = (f(x + e, y) - f(x - e, y)) / (2 * e), gy = (f(x, y + e) - f(x, y - e)) / (2 * e);
        return -v / Math.max(1e-12, Math.hypot(gx, gy));
      };
      const out = [];
      for (let k = 0; k <= 240; k++) { const t = -PI + (2 * PI * k) / 240, r = a * (1 + Math.cos(t)); out.push([cx + r * Math.cos(t), r * Math.sin(t)]); }
      return { sdf, area: 1.5 * PI * a * a, perimeter: 8 * a, K: 3 / 12 - 1 / 16, outline: [out] };
    },
  },
  triangle: {
    label: 'Triangle',
    params: { s: { min: 0.2, max: 0.98, value: 0.98, label: 'side', title: 'The side of the equilateral triangle' } },
    make({ s }, h) {
      const H = (s * Math.sqrt(3)) / 2, y0 = onGrid(-H / 2, h);
      const p = polygon([[-s / 2, y0], [s / 2, y0], [0, y0 + H]]);
      return {
        ...p, K: 1 / 3,
        exact: (lmax) => triangleSpectrum(s, lmax),
        exactNote: 'λ = (16π²/9s²)(m² + mn + n²), m, n ≥ 1 (Lamé, 1833)',
      };
    },
  },
  gww1: {
    label: 'GWW drum 1',
    params: { l: { min: 0.08, max: 0.33, value: 0.33, label: 'size', title: 'The legs of the seven triangles (both drums use the same)' } },
    make({ l }, h) { return gwwDrum(0, l, h); },
  },
  gww2: {
    label: 'GWW drum 2',
    params: { l: { min: 0.08, max: 0.33, value: 0.33, label: 'size', title: 'The legs of the seven triangles (both drums use the same)' } },
    make({ l }, h) { return gwwDrum(1, l, h); },
  },
};

function rect(a, b, h) {
  const y0 = onGrid(-b / 2, h);
  const x0 = -a / 2, yc = y0 + b / 2;
  const sdf = (x, y) => {
    const dx = Math.abs(x) - a / 2, dy = Math.abs(y - yc) - b / 2;
    return dx < 0 && dy < 0 ? -Math.max(dx, dy) : -Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  };
  return {
    sdf, area: a * b, perimeter: 2 * (a + b), K: 1 / 4,
    outline: [[[x0, y0], [x0 + a, y0], [x0 + a, y0 + b], [x0, y0 + b], [x0, y0]]],
    exact: (lmax) => rectangleSpectrum(a, b, lmax),
    exactNote: 'λ = π²(m²/a² + n²/b²), a × b the sides',
    // The 5-point Laplacian's own eigenvalues for this rectangle: products of sines.
    discrete: (count) => {
      const Ma = Math.round(a / h) - 1, Mb = Math.round(b / h) - 1, out = [];
      for (let m = 1; m <= Ma; m++) for (let k = 1; k <= Mb; k++) {
        out.push((4 / (h * h)) * (Math.sin((m * PI * h) / (2 * a)) ** 2 + Math.sin((k * PI * h) / (2 * b)) ** 2));
      }
      return out.sort((p, q) => p - q).slice(0, count);
    },
    sides: [a, b],
  };
}

function gwwDrum(which, l, h) {
  l = Math.max(2 * h, snap(l, h));
  // Centre the 3l × 3l bounding box, on grid points.
  const off = onGrid(-1.5 * l, h);
  const p = polygon(GWW[which].map(([x, y]) => [off + x * l, off + y * l]));
  return { ...p, leg: l, note: 'One of the pair of Gordon, Webb and Wolpert (1992): two shapes, one spectrum' };
}

// ------------------------------------------------------------------ masks

/** The mask of a shape: free where sdf > h/2 (and not on the box's outer ring). */
export function maskFromSdf(n, sdf) {
  const h = 1 / (n - 1), mask = new Uint8Array(n * n);
  for (let j = 1; j < n - 1; j++) {
    const y = -0.5 + j * h;
    for (let i = 1; i < n - 1; i++) if (sdf(-0.5 + i * h, y) > 0.5 * h) mask[j * n + i] = 1;
  }
  return mask;
}

/** A mask from a predicate evaluated at the grid points (typed shapes). */
export function maskFromValues(n, values) {
  const mask = new Uint8Array(n * n);
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) { const v = values[j * n + i]; if (v > 0 && Number.isFinite(v)) mask[j * n + i] = 1; }
  return mask;
}

/** Paint a disk of radius r (in grid steps) into the mask with value v (1 free, 0 wall). */
export function paintMask(mask, n, ci, cj, r, v) {
  const R = Math.max(0.5, r), reach = Math.ceil(R);
  for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
    if (di * di + dj * dj > R * R) continue;
    const i = Math.round(ci) + di, j = Math.round(cj) + dj;
    if (i < 1 || j < 1 || i > n - 2 || j > n - 2) continue;
    mask[j * n + i] = v;
  }
}

/**
 * A signed distance for a mask (drawn and typed shapes): the distance from each free point to
 * the nearest wall point and from each wall point to the nearest free point (two-pass chamfer
 * transform with steps 1 and √2), shifted by half a step so that zero lies half way between,
 * smoothed twice over 3 × 3 points so that its gradient (the ray's normal) does not follow
 * every stair, and bilinearly interpolated.  Positive inside; in units of the box.
 */
export function levelSetOfMask(mask, n) {
  const h = 1 / (n - 1), N = n * n, BIG = 1e9, r2 = Math.SQRT2;
  const chamfer = (inside) => {
    const d = new Float64Array(N);
    for (let g = 0; g < N; g++) d[g] = (mask[g] === 1) === inside ? BIG : 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const g = j * n + i;
      if (!d[g]) continue;
      let v = d[g];
      if (i > 0) v = Math.min(v, d[g - 1] + 1);
      if (j > 0) { v = Math.min(v, d[g - n] + 1); if (i > 0) v = Math.min(v, d[g - n - 1] + r2); if (i < n - 1) v = Math.min(v, d[g - n + 1] + r2); }
      d[g] = v;
    }
    for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
      const g = j * n + i;
      if (!d[g]) continue;
      let v = d[g];
      if (i < n - 1) v = Math.min(v, d[g + 1] + 1);
      if (j < n - 1) { v = Math.min(v, d[g + n] + 1); if (i < n - 1) v = Math.min(v, d[g + n + 1] + r2); if (i > 0) v = Math.min(v, d[g + n - 1] + r2); }
      d[g] = v;
    }
    return d;
  };
  const din = chamfer(true), dout = chamfer(false);
  let f = new Float64Array(N);
  for (let g = 0; g < N; g++) f[g] = mask[g] ? Math.min(din[g], 1e3) - 0.5 : -(Math.min(dout[g], 1e3) - 0.5);
  for (let pass = 0; pass < 2; pass++) {
    const s = new Float64Array(N);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      let acc = 0, wsum = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const w = (2 - Math.abs(di)) * (2 - Math.abs(dj));
        acc += w * f[jj * n + ii]; wsum += w;
      }
      s[j * n + i] = acc / wsum;
    }
    f = s;
  }
  return (x, y) => {
    const u = (x + 0.5) / h, v = (y + 0.5) / h;
    if (u < 0 || v < 0 || u > n - 1 || v > n - 1) return -h;
    const i = Math.min(n - 2, Math.floor(u)), j = Math.min(n - 2, Math.floor(v)), a = u - i, b = v - j;
    const val = (1 - a) * (1 - b) * f[j * n + i] + a * (1 - b) * f[j * n + i + 1] + (1 - a) * b * f[(j + 1) * n + i] + a * b * f[(j + 1) * n + i + 1];
    return val * h;
  };
}

/**
 * Area and perimeter of a drawn mask as the drum hears them: the length of the level set above
 * (staircases smoothed), and the area inside the walls (half a step beyond the level set).
 */
export function maskGeometry(mask, n, contour) {
  const h = 1 / (n - 1);
  const sdf = levelSetOfMask(mask, n);
  const vals = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) vals[j * n + i] = sdf(-0.5 + i * h, -0.5 + j * h);
  let perimeter = 0;
  contour(vals, n, n, 0, (x0, y0, x1, y1) => { perimeter += Math.hypot(x1 - x0, y1 - y0) * h; });
  let free = 0;
  for (let g = 0; g < n * n; g++) free += mask[g];
  return { sdf, area: free * h * h + 0.5 * perimeter * h, perimeter, K: null };
}

/** The shapes' coordinates of grid point g. */
export function coords(g, n) { const h = 1 / (n - 1), i = g % n; return [-0.5 + i * h, -0.5 + ((g - i) / n) * h]; }
