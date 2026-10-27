// Things to look at.  Each pattern is an n x n array g of "ink", 0 (clear glass) to 1 (fully
// inked), on the grid of optics.js (pixel (i, j) is x = (i - n/2) dx, y = (n/2 - j) dx, in
// micrometres).  The ink becomes a transmission by encode(): as an absorber, t = 1 - a g, or as
// a transparent layer that delays the light, t = exp(i phi0 g), or both.  Two objects are given
// as transmissions directly (two pinholes, a typed formula): fields().
//
// Shapes are drawn with 4 x 4 samples per pixel (their area-averaged ink), so that their edges
// don't alias; the gratings are built from their Fourier series, so they hold only orders that
// the grid can represent and each order is exactly one pixel of the spectrum.

const TAU = 2 * Math.PI;

/** The ink of f(x, y) (0 or 1) averaged over s x s points in each pixel. */
export function supersample(n, dx, f, s = 4) {
  const g = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let b = 0; b < s; b++) {
        const y = (n / 2 - j - (b + 0.5) / s + 0.5) * dx;
        for (let a = 0; a < s; a++) sum += f((i - n / 2 + (a + 0.5) / s - 0.5) * dx, y);
      }
      g[j * n + i] = sum / (s * s);
    }
  }
  return g;
}

/** A periodic grating needs a whole number of periods across the window: the nearest such period. */
export function snapPeriod(d, n, dx) {
  const L = n * dx, m = Math.max(1, Math.min(Math.floor(n / 2) - 1, Math.round(L / d)));
  return { d: L / m, m };
}

/**
 * Vertical lines: ink bars of width duty * d (profile 'bars', a square wave with its Fourier
 * series cut off below the grid's Nyquist frequency and softened by Lanczos factors, then
 * rescaled to 0..1) or a sinusoid, ink = (1 - cos(2 pi x / d)) / 2 ('cosine').  A clear line is
 * centred on x = 0.  m whole periods across the window.
 */
export function grating(n, m, profile = 'bars', duty = 0.5) {
  const row = new Float64Array(n);
  if (profile === 'cosine') {
    for (let i = 0; i < n; i++) row[i] = 0.5 - 0.5 * Math.cos((TAU * m * (i - n / 2)) / n);
  } else {
    const K = Math.ceil(n / 2 / m) - 1; // harmonics k m < n / 2
    for (let i = 0; i < n; i++) {
      const ph = (TAU * m * (i - n / 2)) / n;
      // Ink where |x mod d - d/2| < duty d / 2: the ink is centred half a period from x = 0.
      let v = duty;
      for (let k = 1; k <= K; k++) {
        const sigma = Math.sin((Math.PI * k) / (K + 1)) / ((Math.PI * k) / (K + 1));
        v += sigma * ((2 * Math.sin(Math.PI * k * duty)) / (Math.PI * k)) * Math.cos(k * (ph - Math.PI));
      }
      row[i] = v;
    }
    let lo = Infinity, hi = -Infinity;
    for (const v of row) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (let i = 0; i < n; i++) row[i] = hi > lo ? (row[i] - lo) / (hi - lo) : duty;
  }
  const g = new Float64Array(n * n);
  for (let j = 0; j < n; j++) g.set(row, j * n);
  return g;
}

/** The periods (micrometres) of the eight groups of the bar target. */
export const BAR_PERIODS = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => +(2 * 2 ** (-k / 3)).toFixed(3));

/**
 * A resolution target: eight groups, periods from 2 um down to 0.4 um, each three dark vertical
 * bars above three dark horizontal ones (bar width half the period), in a 4 x 2 arrangement.
 * Returns the ink, and where each group is (for labels).
 */
export function barTarget(n, dx) {
  const L = n * dx, cw = L / 4, ch = L / 2;
  const groups = BAR_PERIODS.map((p, k) => {
    const col = k % 4, row = Math.floor(k / 4);
    return { p, x: -L / 2 + cw * (col + 0.5), y: L / 2 - ch * (row + 0.5) };
  });
  const inGroup = (x, y, { p, x: gx, y: gy }) => {
    const w = 2.5 * p, u = x - gx, v = y - gy;
    if (Math.abs(u) > w / 2) return 0;
    // Vertical bars in the upper square, horizontal ones in the lower, a period apart.
    const top = v - (0.5 * p + w / 2), bottom = v + (0.5 * p + w / 2);
    if (Math.abs(top) <= w / 2) return +(((u + w / 2) % p) < p / 2);
    if (Math.abs(bottom) <= w / 2 && Math.abs(u) <= w / 2) return +((((bottom + w / 2) % p) + p) % p < p / 2);
    return 0;
  };
  const g = supersample(n, dx, (x, y) => {
    for (const gr of groups) if (Math.abs(x - gr.x) < cw / 2 && Math.abs(y - gr.y) < ch / 2) return inGroup(x, y, gr);
    return 0;
  });
  return { g, groups };
}

/** A Siemens star: `spokes` ink sectors (and as many clear) out to radius R um. */
export function siemensStar(n, dx, spokes = 18, R = 11) {
  return supersample(n, dx, (x, y) => {
    const r2 = x * x + y * y;
    if (r2 > R * R) return 0;
    const th = Math.atan2(y, x) + Math.PI;
    return +(Math.floor((th * spokes) / Math.PI) % 2 === 0);
  });
}

/**
 * A diatom-like valve: a lanceolate shell of silica, its rim and midrib (the raphe) thick, the
 * rest pierced by a hexagonal lattice of pores `spacing` um apart (rows spacing sqrt(3)/2 apart).
 */
export function diatom(n, dx, spacing = 0.6) {
  const rot = (25 * Math.PI) / 180, c = Math.cos(rot), s = Math.sin(rot);
  const half = 10.5, W = 3.1;
  const a = spacing, h = (a * Math.sqrt(3)) / 2, pore = 0.3 * a;
  return supersample(n, dx, (x, y) => {
    const u = x * c + y * s, v = -x * s + y * c;   // along the valve, across it
    if (Math.abs(u) >= half) return 0;
    const w = W * (1 - (u / half) ** 2) ** 0.8;   // half-width at u
    if (Math.abs(v) > w) return 0;
    if (Math.abs(v) > w - 0.35) return 1;          // the rim
    if (Math.abs(v) < 0.18 || u * u + v * v < 1.0) return 1;   // the raphe and central nodule
    // The nearest pore on a triangular lattice (rows along u).
    const r = Math.round(v / h), uu = u - (r % 2 ? a / 2 : 0), k = Math.round(uu / a);
    let best = (uu - k * a) ** 2 + (v - r * h) ** 2;
    for (const dr of [-1, 1]) {
      const r2 = r + dr, u2 = u - (Math.abs(r2) % 2 ? a / 2 : 0), k2 = Math.round(u2 / a);
      best = Math.min(best, (u2 - k2 * a) ** 2 + (v - r2 * h) ** 2);
    }
    return best < pore * pore ? 0.1 : 0.75;
  });
}

/**
 * Cells: flat ellipses whose thickness rises like a dome to the edge, each with a thicker
 * nucleus, a nucleolus and a few small granules.  Ink = thickness, scaled to 1 at the thickest.
 */
export function cells(n, dx) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const L = n * dx, list = [];
  for (let tries = 0; list.length < 7 && tries < 400; tries++) {
    const A = 2.6 + 2.0 * rnd(), B = A * (0.55 + 0.35 * rnd());
    const cx = (rnd() - 0.5) * (L - 2 * A - 1), cy = (rnd() - 0.5) * (L - 2 * A - 1), th = rnd() * Math.PI;
    if (list.some((q) => Math.hypot(q.cx - cx, q.cy - cy) < q.A + A + 0.6)) continue;
    const grains = Array.from({ length: 4 }, () => {
      const r = 0.45 + 0.4 * rnd(), ang = rnd() * 2 * Math.PI;
      return { u: r * Math.cos(ang), v: r * Math.sin(ang) * 0.9, r: 0.22 + 0.12 * rnd() };
    });
    list.push({ A, B, cx, cy, c: Math.cos(th), s: Math.sin(th), nu: (rnd() - 0.5) * 0.4, grains });
  }
  const g = supersample(n, dx, (x, y) => {
    for (const q of list) {
      const X = x - q.cx, Y = y - q.cy, u = (X * q.c + Y * q.s) / q.A, v = (-X * q.s + Y * q.c) / q.B;
      const r2 = u * u + v * v;
      if (r2 >= 1) continue;
      let t = 0.45 * Math.sqrt(1 - r2);                          // cytoplasm
      const nu = (u - q.nu) / 0.38, nv = v / 0.5, n2 = nu * nu + nv * nv;
      if (n2 < 1) t += 0.4 * Math.sqrt(1 - n2);                  // nucleus
      const m2 = ((u - q.nu - 0.08) / 0.1) ** 2 + ((v - 0.1) / 0.13) ** 2;
      if (m2 < 1) t += 0.15 * Math.sqrt(1 - m2);                 // nucleolus
      for (const gr of q.grains) if (((u - gr.u) * q.A) ** 2 + ((v - gr.v) * q.B) ** 2 < gr.r * gr.r) t += 0.12;  // granules, in um
      return t;
    }
    return 0;
  }, 3);
  let max = 0;
  for (const v of g) max = Math.max(max, v);
  for (let o = 0; o < g.length; o++) g[o] /= max || 1;
  return g;
}

/** A wide clear band, |x| < L/4, in an opaque screen: two straight edges. */
export function edge(n) {
  const g = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) g[j * n + i] = Math.abs(i - n / 2 + 0.5) < n / 4 ? 0 : 1;
  return g;
}

/**
 * Two pinholes (single pixels) `sep` pixels apart on the middle row, the right one with phase
 * `phase` relative to the left: a transmission, opaque elsewhere.
 */
export function twoPoints(n, sep, phase = 0) {
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  const i1 = n / 2 - Math.floor(sep / 2), i2 = i1 + sep, row = (n / 2) * n;
  re[row + i1] = 1;
  re[row + i2] += Math.cos(phase); im[row + i2] += Math.sin(phase);
  return { re, im };
}

/**
 * Ink to transmission: t = base * (1 - absorb g) * exp(i phi0 g) with mode 'amplitude' (no
 * phase), 'phase' (no absorption) or 'both'.  base (optional) is a transmission to multiply.
 */
export function encode(g, mode, absorb, phi0, base = null, out = null) {
  const m = g.length;
  out = out || { re: new Float64Array(m), im: new Float64Array(m) };
  const A = mode === 'phase' ? 0 : absorb, P = mode === 'amplitude' ? 0 : phi0;
  for (let o = 0; o < m; o++) {
    const a = 1 - A * g[o], p = P * g[o];
    let r = a * Math.cos(p), i = a * Math.sin(p);
    if (base) { const br = base.re[o], bi = base.im[o]; const t = r * br - i * bi; i = r * bi + i * br; r = t; }
    out.re[o] = r; out.im[o] = i;
  }
  return out;
}
