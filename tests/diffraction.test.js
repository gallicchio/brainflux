import { test, assert, close } from './harness.js';
import { propagate, sideView, diffract, fresnel, sampleAperture, zoneCount, criticalDistance, pitchAt } from '../diffraction/optics.js';
import { besselJ } from '../lib/bessel.js';

// Units: micrometres.  lambda = 0.5, a 256 x 256 grid of 2 um pixels (512 um across).
const n = 256, dx = 2, lambda = 0.5;
const field = (f) => {
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = f((i - n / 2) * dx, (j - n / 2) * dx);
    if (typeof v === 'number') re[j * n + i] = v; else { re[j * n + i] = v[0]; im[j * n + i] = v[1]; }
  }
  return [re, im];
};
const moment2 = (re, im) => {
  let s = 0, m = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const p = re[j * n + i] ** 2 + im[j * n + i] ** 2, x = (i - n / 2) * dx; s += p; m += p * x * x; }
  return m / s;
};

test('a Gaussian beam widens as w0 sqrt(1 + (z/zR)^2), and keeps its power', () => {
  const w0 = 20, zR = (Math.PI * w0 * w0) / lambda;
  const [re, im] = field((x, y) => Math.exp(-(x * x + y * y) / (w0 * w0)));
  let P0 = 0; for (let i = 0; i < re.length; i++) P0 += re[i] ** 2;
  propagate(re, im, n, dx, lambda, zR);
  let P = 0; for (let i = 0; i < re.length; i++) P += re[i] ** 2 + im[i] ** 2;
  close(P / P0, 1, 1e-12, 'power');
  // |U|^2 ~ exp(-2 r^2 / w^2): <x^2> = w^2 / 4.
  close(Math.sqrt(4 * moment2(re, im)), w0 * Math.SQRT2, 0.002 * w0, 'w(zR)');
});

test('a grating images itself at the Talbot distance 2 d^2 / lambda, shifted by d/2 at half of it', () => {
  const d = 16, zT = (2 * d * d) / lambda;
  const g = (x) => 0.5 + 0.5 * Math.cos((2 * Math.PI * x) / d);
  const [r0, i0] = field((x, y) => g(x) * Math.exp(-(y * y) / (150 * 150)));
  const I0 = r0.map((v, i) => v * v + i0[i] * i0[i]);
  const corr = (A, B) => { let ab = 0, aa = 0, bb = 0; for (let i = 0; i < A.length; i++) { ab += A[i] * B[i]; aa += A[i] * A[i]; bb += B[i] * B[i]; } return ab / Math.sqrt(aa * bb); };
  const at = (z) => { const re = r0.slice(), im = i0.slice(); propagate(re, im, n, dx, lambda, z); return re.map((v, i) => v * v + im[i] * im[i]); };
  const [rs, is] = field((x, y) => g(x + d / 2) * Math.exp(-(y * y) / (150 * 150)));
  const Ishift = rs.map((v, i) => v * v + is[i] * is[i]);
  const cT = corr(I0, at(zT)), cHalf = corr(Ishift, at(zT / 2));
  assert(cT > 0.999 && cHalf > 0.999, `correlations ${cT}, ${cHalf}`);
  return `self-image ${cT.toFixed(5)}, shifted image at zT/2 ${cHalf.toFixed(5)}`;
});

test('a thin lens focuses at f', () => {
  const f = 3000, k = (2 * Math.PI) / lambda, a = 100;
  const [re, im] = field((x, y) => { const r2 = x * x + y * y; if (r2 > a * a) return 0; const p = (-k * r2) / (2 * f); return [Math.cos(p), Math.sin(p)]; });
  const centre = (z) => { const r = re.slice(), i = im.slice(); propagate(r, i, n, dx, lambda, z); const o = (n / 2) * n + n / 2; return r[o] ** 2 + i[o] ** 2; };
  const I = [0.8, 0.95, 1, 1.05, 1.2].map((s) => centre(s * f));
  assert(I[2] > I[0] && I[2] > I[4] && I[2] > I[1] * 0.98 && I[2] > I[3] * 0.98, `centre intensities ${I.map((v) => v.toExponential(2))}`);
});

test('the side view is the middle row of the field, near (angular spectrum) and far (Fresnel transform)', () => {
  const [re, im] = field((x, y) => (Math.abs(x) < 20 && Math.abs(y) < 60 ? 1 : 0));
  const zs = [0, 500, 2000, 3000, 20000];   // z_c = n dx^2 / lambda = 2048
  const sv = sideView(re, im, n, dx, lambda, zs);
  for (const [a, z] of zs.entries()) {
    const f = diffract(re, im, n, dx, lambda, z);
    assert(f.pitch === pitchAt(n, dx, lambda, z), `pitch at ${z}`);
    let worst = 0, peak = 0;
    for (let x = 0; x < n; x++) { const o = (n / 2) * n + x, I = f.re[o] ** 2 + f.im[o] ** 2; worst = Math.max(worst, Math.abs(I - sv[a * n + x])); peak = Math.max(peak, I); }
    assert(worst < 1e-9 * peak, `z=${z}: ${worst}`);
  }
});

// ------------------------------------------------- from the aperture to the far field
//
// At the demo's own sampling: 512 x 512 pixels of 8 um (4.1 mm), green light, so the angular
// spectrum hands over to the Fresnel transform at z_c = 59.6 mm.  The ground truths are
// independent of the FFT: Fresnel integrals, Rayleigh-Sommerfeld on the axis of a hole, and
// radial integrals for the zone plate.

const N = 512, DX = 8, LAM = 0.55, K = (2 * Math.PI) / LAM, ZC = criticalDistance(N, DX, LAM);
const aperture = (t, opts) => sampleAperture(N, DX, t, opts);
const relL2 = (A, B) => { let d = 0, s = 0; for (let i = 0; i < A.length; i++) { d += (A[i] - B[i]) ** 2; s += B[i] ** 2; } return Math.sqrt(d / s); };
const pct = (v) => `${(100 * v).toFixed(2)}%`;
// Intensities over the middle half of a computed field (what the demo draws), and the
// truth I(x, y) at the same points: pixel (i, j) is at x = (i - N/2) p, y = (N/2 - j) p.
function compare(f, truth) {
  const m = N / 2, A = new Float64Array(m * m), B = new Float64Array(m * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const o = (j + m / 2) * N + i + m / 2;
    A[j * m + i] = f.re[o] ** 2 + f.im[o] ** 2;
    B[j * m + i] = truth((i - m / 2) * f.pitch, (m / 2 - j) * f.pitch);
  }
  return relL2(A, B);
}

// The Fresnel integrals C(x) and S(x) (Numerical Recipes' frenel: a power series up to 1.5, a
// continued fraction beyond), good to 1e-13.
function fresnelCS(x) {
  const ax = Math.abs(x), EPS = 1e-16;
  let c, s;
  if (ax < 1e-150) { c = ax; s = 0; }
  else if (ax <= 1.5) {
    let sum = 0, sums = 0, sumc = ax, sign = 1, odd = true, term = ax, m = 3;
    const fact = (Math.PI / 2) * ax * ax;
    for (let k = 1; k < 200; k++) {
      term *= fact / k;
      sum += (sign * term) / m;
      const tst = Math.abs(sum) * EPS;
      if (odd) { sign = -sign; sums = sum; sum = sumc; } else { sumc = sum; sum = sums; }
      if (term < tst) break;
      odd = !odd; m += 2;
    }
    c = sumc; s = sums;
  } else {
    // Lentz's method on complex numbers [re, im].
    const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
    const div = (a, b) => { const q = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / q, (a[1] * b[0] - a[0] * b[1]) / q]; };
    const pix2 = Math.PI * ax * ax;
    let b = [1, -pix2], cc = [1e30, 0], d = div([1, 0], b), h = d, m = -1;
    for (let k = 2; k < 200; k++) {
      m += 2;
      const a = -m * (m + 1);
      b = [b[0] + 4, b[1]];
      d = div([1, 0], [a * d[0] + b[0], a * d[1] + b[1]]);
      const q = div([a, 0], cc);
      cc = [b[0] + q[0], b[1] + q[1]];
      const del = mul(cc, d);
      h = mul(h, del);
      if (Math.abs(del[0] - 1) + Math.abs(del[1]) < EPS) break;
    }
    h = mul([ax, -ax], h);
    const e = mul([Math.cos(pix2 / 2), Math.sin(pix2 / 2)], h);
    const cs = mul([0.5, 0.5], [1 - e[0], -e[1]]);
    c = cs[0]; s = cs[1];
  }
  return x < 0 ? [-c, -s] : [c, s];
}

// |int_{-a}^{a} exp(i k (x' - x)^2 / 2z) dx'|^2 / (lambda z): one factor of the intensity
// behind a rectangle, in the Fresnel approximation (which, for the angles the grid carries,
// differs from Rayleigh-Sommerfeld by less than 1e-3).
function slitFactor(x, a, z) {
  const s = Math.sqrt(2 / (LAM * z)), [c1, s1] = fresnelCS((-a - x) * s), [c2, s2] = fresnelCS((a - x) * s);
  return ((c2 - c1) ** 2 + (s2 - s1) ** 2) / 2;
}
// The truth for a rectangle 2a x 2b; the factors are cached per row and column.
function rectangle(a, b, z) {
  const fx = new Map(), fy = new Map();
  return (x, y) => {
    if (!fx.has(x)) fx.set(x, slitFactor(x, a, z));
    if (!fy.has(y)) fy.set(y, slitFactor(y, b, z));
    return fx.get(x) * fy.get(y);
  };
}

test('energy is conserved, near and far: sum |U|^2 pitch^2 is the light through the aperture', () => {
  const [re, im] = aperture((x, y) => +(Math.abs(x) < 100 && Math.abs(y) < 700));
  let P0 = 0; for (let i = 0; i < re.length; i++) P0 += (re[i] ** 2 + im[i] ** 2) * DX * DX;
  let worst = 0;
  for (const z of [1e3, 0.99 * ZC, 1.01 * ZC, 1e6, 1e7]) {
    const f = diffract(re, im, N, DX, LAM, z);
    let P = 0; for (let i = 0; i < f.re.length; i++) P += (f.re[i] ** 2 + f.im[i] ** 2) * f.pitch * f.pitch;
    worst = Math.max(worst, Math.abs(P / P0 - 1));
  }
  assert(worst < 1e-12, `worst ${worst}`);
  return `worst relative change ${worst.toExponential(1)}`;
});

test('at z_c the Fresnel transform and the angular spectrum are the same sum', () => {
  // Off centre and lopsided, so that a flip or a shift would show.
  const [re, im] = aperture((x, y) => +((x - 200) ** 2 + (y - 80) ** 2 < 120 ** 2 || (x > -300 && x < -100 && y > -50 && y < 400)));
  const a = [re.slice(), im.slice()], b = [re.slice(), im.slice()];
  propagate(a[0], a[1], N, DX, LAM, ZC, true);
  const p = fresnel(b[0], b[1], N, DX, LAM, ZC);
  close(p, DX, 1e-9, 'pitch');
  let worst = 0, peak = 0;
  for (let i = 0; i < re.length; i++) { worst = Math.max(worst, Math.hypot(a[0][i] - b[0][i], a[1][i] - b[1][i])); peak = Math.max(peak, Math.hypot(a[0][i], a[1][i])); }
  assert(worst < 1e-10 * peak, `paraxial angular spectrum vs Fresnel: ${worst / peak}`);
  // With the exact kz (what the demo uses below z_c) the switch is a step too small to see.
  const e = diffract(re, im, N, DX, LAM, ZC), f = diffract(re, im, N, DX, LAM, ZC * 1.000001);
  const Ie = e.re.map((v, i) => v * v + e.im[i] ** 2), If = f.re.map((v, i) => v * v + f.im[i] ** 2);
  const step = relL2(Ie, If);
  assert(step < 3e-3, `exact kz vs Fresnel at z_c: ${step}`);
  return `same field to ${(worst / peak).toExponential(1)}; with the exact kz, a step of ${pct(step)} in intensity`;
});

test('a slit (200 x 1400 um): the drawn pattern agrees with the exact Fresnel integrals from 10 mm to 10 m', () => {
  const [re, im] = aperture((x, y) => +(Math.abs(x) < 100 && Math.abs(y) < 700));
  const out = [];
  for (const [zmm, tol] of [[10, 0.06], [30, 0.05], [59, 0.015], [61, 0.015], [200, 0.01], [1000, 0.01], [3000, 0.01], [10000, 0.01]]) {
    const z = zmm * 1000, e = compare(diffract(re, im, N, DX, LAM, z), rectangle(100, 700, z));
    assert(e < tol, `z = ${zmm} mm: ${pct(e)}`);
    out.push(`${zmm} mm ${pct(e)}`);
  }
  // (Near the aperture the truth has fringes finer than a pixel, from light bent by more than
  // lambda / 2dx = 34 mrad, which the grid can't carry.)
  return out.join(', ');
});

test('a round hole: on its axis, the exact Rayleigh-Sommerfeld intensity, near and far', () => {
  const a = 150, [re, im] = aperture((x, y) => +(x * x + y * y < a * a));
  const out = [];
  for (const NF of [3, 2, 1, 0.5, 0.1, 0.01, 0.00409]) {
    const z = (a * a) / (LAM * NF), R = Math.hypot(z, a), ph = K * (R - z);
    const truth = (1 - (z / R) * Math.cos(ph)) ** 2 + ((z / R) * Math.sin(ph)) ** 2;
    // Each pixel averages the aperture over its 8 um: across it, the wave from the rim is a plane
    // wave of spatial frequency nu = a / lambda z, which the average scales by
    // sinc(dx nu cos phi) sinc(dx nu sin phi), phi going round the rim.
    let sAvg = 0;
    const sinc = (t) => (t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t)), nu = a / (LAM * z);
    for (let q = 0; q < 360; q++) { const phi = ((q + 0.5) * Math.PI) / 180; sAvg += sinc(DX * nu * Math.cos(phi)) * sinc(DX * nu * Math.sin(phi)) / 360; }
    const pixels = (1 - sAvg * (z / R) * Math.cos(ph)) ** 2 + (sAvg * (z / R) * Math.sin(ph)) ** 2;
    const f = diffract(re, im, N, DX, LAM, z), o = (N / 2) * N + N / 2, I = f.re[o] ** 2 + f.im[o] ** 2;
    // Near (on the scale of the maximum, 4): within 1% of that, and within 5% of the sharp
    // edge's.  Far, where it falls as 1/z^2: within 1%.
    if (NF >= 0.5) assert(Math.abs(I - pixels) < 0.01 * 4 && Math.abs(I - truth) < 0.05 * 4, `N_F = ${NF}: ${I} vs ${truth}, ${pixels}`);
    else assert(Math.abs(I / truth - 1) < 0.01, `N_F = ${NF}: ${I} vs ${truth}`);
    out.push(`N_F ${NF}: ${I.toPrecision(4)} (${truth.toPrecision(4)}; averaged over pixels ${pixels.toPrecision(4)})`);
  }
  return out.join(', ');
});

// The Fraunhofer pattern of a round aperture made of rings [r1, r2], as a function of the
// angle theta: |FT|^2 / (lambda z)^2 at distance z.
function ringsFraunhofer(rings, z) {
  const disc = (r, nu) => { const u = 2 * Math.PI * r * nu; return u < 1e-9 ? Math.PI * r * r : (Math.PI * r * r * 2 * besselJ(1, u)[1]) / u; };
  // Tabulated finely in theta and interpolated (the pattern is round).
  const top = 0.05, steps = 4000, table = new Float64Array(steps + 2);
  for (let s = 0; s <= steps + 1; s++) { const nu = (s / steps) * top / LAM; let A = 0; for (const [r1, r2] of rings) A += disc(r2, nu) - disc(r1, nu); table[s] = (A / (LAM * z)) ** 2; }
  return (x, y) => { const u = (Math.hypot(x, y) / z / top) * steps, s = Math.floor(u); return table[s] + (u - s) * (table[s + 1] - table[s]); };
}

test('at the end of the slider (10 m) the pattern is the Fraunhofer pattern: slit, hole, zone plate', () => {
  const z = 1e7, sinc = (t) => (t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t)), out = [];
  const slit = aperture((x, y) => +(Math.abs(x) < 100 && Math.abs(y) < 700));
  const eSlit = compare(diffract(slit[0], slit[1], N, DX, LAM, z), (x, y) => ((200 * 1400 * sinc((200 * x) / z / LAM) * sinc((1400 * y) / z / LAM)) / (LAM * z)) ** 2);
  const hole = aperture((x, y) => +(x * x + y * y < 150 * 150));
  const eHole = compare(diffract(hole[0], hole[1], N, DX, LAM, z), ringsFraunhofer([[0, 150]], z));
  const f = 50000, M = zoneCount(f, LAM, DX), r = (m) => Math.sqrt(m * LAM * f), rings = [];
  for (let m = 0; m < M; m += 2) rings.push([r(m), r(m + 1)]);
  const zone = aperture((x, y) => { const q = (x * x + y * y) / (LAM * f); return +(q < M && Math.floor(q) % 2 === 0); });
  const eZone = compare(diffract(zone[0], zone[1], N, DX, LAM, z), ringsFraunhofer(rings, z));
  assert(eSlit < 0.012 && eHole < 0.005 && eZone < 0.02, `slit ${eSlit}, hole ${eHole}, zone plate ${eZone}`);
  return `rel. L2 error over the view: slit ${pct(eSlit)}, hole ${pct(eHole)}, zone plate ${pct(eZone)}`;
});

test('the zone plate focuses at f, f/3 and f/5, with the focal spot of the continuous plate', () => {
  const f = 50000, M = zoneCount(f, LAM, DX), r = (m) => Math.sqrt(m * LAM * f);
  const [re, im] = aperture((x, y) => { const q = (x * x + y * y) / (LAM * f); return +(q < M && Math.floor(q) % 2 === 0); });
  const out = [`${M} zones out to ${r(M).toFixed(0)} um, the outermost ${(r(M) - r(M - 1)).toFixed(1)} um wide`];
  // The brightest point on the axis near each focus, from the side view (steps of 0.25%).
  for (const m of [1, 3, 5]) {
    const zs = Array.from({ length: 41 }, (_, a) => (f / m) * (0.95 + a * 0.0025));
    const sv = sideView(re, im, N, DX, LAM, zs);
    let best = 0;
    for (let a = 1; a < zs.length; a++) if (sv[a * N + N / 2] > sv[best * N + N / 2]) best = a;
    const peak = zs[best] / (f / m);
    assert(Math.abs(peak - 1) < 0.01, `focus ${m}: at ${peak} f/${m}`);
    out.push(`f/${m} at ${peak.toFixed(4)} f/${m}, I = ${sv[best * N + N / 2].toFixed(0)}`);
  }
  // The focal spot: the first zero of the middle row at z = f, by band-limited (sinc)
  // interpolation of the row, against the radial Fresnel integral of the continuous plate,
  // U(r) = (k/z) int t(rho) e^{ik rho^2/2z} J0(k r rho/z) rho drho.
  const g = diffract(re, im, N, DX, LAM, f), row = [], up = 32;
  for (let i = 0; i < N; i++) row.push([g.re[(N / 2) * N + i], g.im[(N / 2) * N + i]]);
  const at = (x) => { let sr = 0, si = 0; for (let i = 0; i < N; i++) { const t = x / DX - (i - N / 2), w = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t); sr += w * row[i][0]; si += w * row[i][1]; } return sr * sr + si * si; };
  const firstZero = (I) => { let x = 0, prev = I(0); for (x = 0.25; ; x += 0.25) { const v = I(x); if (v > prev) return x - 0.25; prev = v; } };
  const j0 = (x) => { let t = 1, sum = 1; for (let k = 1; k < 30; k++) { t *= -(x * x) / (4 * k * k); sum += t; } return sum; }; // x < 7 here
  const truth = (rr) => {
    let sr = 0, si = 0;
    for (let m = 0; m < M; m += 2) {
      const steps = 400, h = (r(m + 1) - r(m)) / steps;
      for (let s = 0; s < steps; s++) {
        const rho = r(m) + (s + 0.5) * h, p = (K * rho * rho) / (2 * f), j = j0((K * rr * rho) / f) * rho * h;
        sr += Math.cos(p) * j; si += Math.sin(p) * j;
      }
    }
    return ((K / f) ** 2) * (sr * sr + si * si);
  };
  const zGrid = firstZero(at), zTrue = firstZero(truth);
  assert(Math.abs(zGrid / zTrue - 1) < 0.05, `first zero ${zGrid} um, continuous plate ${zTrue} um`);
  // And the peak: M^2 / 4 x 4 (each open zone adds 2 to the amplitude) for the continuous plate;
  // area sampling softens the outer rings by a few per cent.
  const I0 = at(0), ideal = (2 * Math.ceil(M / 2)) ** 2;
  assert(I0 > 0.85 * ideal && I0 < 1.02 * ideal, `peak ${I0} vs ${ideal}`);
  out.push(`spot's first zero ${zGrid} um (continuous plate ${zTrue} um; 0.61 lambda f / R = ${((0.61 * LAM * f) / r(M)).toFixed(1)}); peak ${I0.toFixed(0)} (continuous ${ideal})`);
  return out.join('; ');
});

test('a lens for 550 nm in 650 nm light: the unwrapped phase scaled by 550/650 keeps the focus at f, the wrapped one moves it to 550/650 f', () => {
  const f = 50000, R = 600, lam0 = 0.55, lam = 0.65;
  const [re, im, ph] = aperture((x, y) => { const r2 = x * x + y * y; return r2 > R * R ? NaN : (-(2 * Math.PI) / lam0) * r2 / (2 * f); }, { phase: true });
  const brightest = (r, i) => {   // the brightest point on the axis, from the side view between 0.6 f and 1.3 f
    const zs = Array.from({ length: 141 }, (_, a) => f * (0.6 + a * 0.005)), sv = sideView(r, i, N, DX, lam, zs);
    let best = 0; for (let a = 1; a < zs.length; a++) if (sv[a * N + N / 2] > sv[best * N + N / 2]) best = a;
    return zs[best] / f;
  };
  const s = lam0 / lam, glass = [new Float64Array(N * N), new Float64Array(N * N)], blazed = [new Float64Array(N * N), new Float64Array(N * N)];
  for (let o = 0; o < N * N; o++) {
    const m = Math.hypot(re[o], im[o]);
    glass[0][o] = m * Math.cos(ph[o] * s); glass[1][o] = m * Math.sin(ph[o] * s);
    const w = Math.atan2(im[o], re[o]) * s;   // the phase modulo 2 pi, scaled: a re-blazed diffractive lens
    blazed[0][o] = m * Math.cos(w); blazed[1][o] = m * Math.sin(w);
  }
  const zG = brightest(...glass), zB = brightest(...blazed), zAs = brightest(re, im);
  // (A lens of Fresnel number R^2 / lambda f = 11 has its brightest point 1% short of f: the focal shift.)
  close(zG, 1, 0.02, 'glass: the focus stays at f');
  close(zB, s, 0.02, 'the wrapped phase scaled: a diffractive lens, f x 550/650');
  close(zAs, s, 0.02, 'the phase as it is: a diffractive lens, f x 550/650');
  return `in 650 nm light the focus is at ${zG.toFixed(3)} f with the thickness scaled, ${zAs.toFixed(3)} f with the phase as made for 550 nm, ${zB.toFixed(3)} f with the wrapped phase scaled (550/650 = ${s.toFixed(3)})`;
});

test('area sampling: a 300 um square lets 300^2 um^2 through, a 300 um hole pi 150^2', () => {
  const area = (t) => { const [re] = aperture(t); let s = 0; for (const v of re) s += v; return s * DX * DX; };
  const sq = area((x, y) => +(Math.abs(x) < 150 && Math.abs(y) < 150)), hole = area((x, y) => +(x * x + y * y < 150 * 150));
  close(sq / 90000, 1, 1e-9, 'square');
  close(hole / (Math.PI * 22500), 1, 2e-3, 'hole');
  return `square ${sq.toFixed(0)}, hole ${hole.toFixed(0)} (${(Math.PI * 22500).toFixed(0)})`;
});

// ------------------------------------------------- the numbers the help quotes, re-measured
//
// At the demo's sampling, with the presets as app.js makes them (the "open everywhere"
// apertures sit in its soft-edged 3.3 mm beam).

const centreRow = (f) => { const I = new Float64Array(N); for (let i = 0; i < N; i++) { const o = (N / 2) * N + i; I[i] = f.re[o] ** 2 + f.im[o] ** 2; } return I; };
// The intensity at x (um) on the middle row, the field read between its samples (band-limited;
// past z_c only without the spherical wave's chirp, which is finer than the pixels there).
const rowAt = (f, x) => { let sr = 0, si = 0; const u = x / f.pitch + N / 2; for (let i = 0; i < N; i++) { const t = u - i, w = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t); sr += w * f.re[(N / 2) * N + i]; si += w * f.im[(N / 2) * N + i]; } return sr * sr + si * si; };
const beamT = (x, y) => { const r = Math.hypot(x, y), R = (N / 2) * DX, edge = 0.8 * R; return r < edge ? 1 : r < R ? Math.cos(((r - edge) / (R - edge)) * (Math.PI / 2)) : 0; };
const openBeam = (z) => { const [re, im] = aperture(beamT), b = diffract(re, im, N, DX, LAM, z), o = (N / 2) * N + N / 2; return b.re[o] ** 2 + b.im[o] ** 2; };

test('a straight edge: 1.37 times the open beam at 0.86 sqrt(lambda z) outside the edge, a quarter of it at the edge, fringes closer and closer', () => {
  const z = 20000, [re, im] = aperture((x, y) => +(x > 0) * beamT(x, y)), I = centreRow(diffract(re, im, N, DX, LAM, z)), B = openBeam(z);
  const peaks = []; for (let i = N / 2; i < N / 2 + 60; i++) if (I[i] > I[i - 1] && I[i] >= I[i + 1]) peaks.push(i);
  const s = Math.sqrt(LAM * z), x1 = (peaks[0] - N / 2) * DX, gaps = peaks.slice(1, 4).map((q, a) => (q - peaks[a]) * DX);
  close(I[peaks[0]] / B, 1.37, 0.02, 'the first maximum');
  close(x1 / s, 0.86, 0.1, 'its place');   // to a pixel: 8 um of 90
  assert(gaps[0] > gaps[1] && gaps[1] >= gaps[2], `fringes closer and closer: ${gaps}`);
  close(I[N / 2] / B, 0.25, 0.005, 'at the edge');
  return `first maximum ${(I[peaks[0]] / B).toFixed(3)} at ${x1} um (0.86 sqrt(lambda z) = ${(0.86 * s).toFixed(1)}), then fringes ${gaps.join(', ')} um apart; at the edge ${(I[N / 2] / B).toFixed(3)}`;
});

test('the spot of Arago: as bright as the beam with no disk, in a shadow that is dark around it', () => {
  const z = 150000, a = 250, [re, im] = aperture((x, y) => +(x * x + y * y > a * a) * beamT(x, y));
  const f = diffract(re, im, N, DX, LAM, z), I = centreRow(f), spot = I[N / 2], open = openBeam(z);
  let dark = Infinity; for (let i = N / 2 + 1; (i - N / 2) * f.pitch < a; i++) dark = Math.min(dark, I[i]);
  close(spot / open, 1, 0.02, 'the spot against the open beam');
  assert(dark < 0.1 * open, `the shadow: ${dark / open}`);
  return `the spot ${(spot / open).toFixed(3)} of the open beam; the shadow ${(dark / open).toFixed(3)} of it at its darkest`;
});

test('a round hole 10 m away: the Airy pattern, its first dark ring at 1.22 lambda z / D', () => {
  const D = 300, z = 1e7, [re, im] = aperture((x, y) => +(x * x + y * y < (D / 2) ** 2));
  const f = diffract(re, im, N, DX, LAM, z, { curvature: false }), step = 0.02 * f.pitch;
  let prev = rowAt(f, 0), x0 = NaN;
  for (let x = step; x < 50 * f.pitch; x += step) { const v = rowAt(f, x); if (v > prev) { x0 = x - step; break; } prev = v; }
  close(x0 / ((1.22 * LAM * z) / D), 1, 0.005, 'the first zero');
  return `first zero at ${(x0 / 1000).toFixed(2)} mm; 1.22 lambda z / D = ${((1.22 * LAM * z) / D / 1000).toFixed(2)} mm`;
});

test('two slits: dark fringes at lambda / 2d, the fourth bright fringe missing under the envelope', () => {
  const d = 250, [re, im] = aperture((x, y) => +((Math.abs(x - d / 2) < d / 8 || Math.abs(x + d / 2) < d / 8) && Math.abs(y) < 700)), out = [];
  for (const z of [80000, 1e7]) {
    const f = diffract(re, im, N, DX, LAM, z, { curvature: false }), peak = rowAt(f, 0), s = (LAM * z) / d;
    let dark = Infinity, at = 0; for (let x = 0.3 * s; x < 0.7 * s; x += 0.002 * s) { const v = rowAt(f, x); if (v < dark) { dark = v; at = x; } }
    close(at / (s / 2), 1, 0.01, `the first dark fringe at ${z} um`);
    assert(dark < 0.01 * peak, `dark: ${dark / peak}`);
    const third = rowAt(f, 3 * s) / peak, fourth = rowAt(f, 4 * s) / peak;
    assert(third > 0.05 && fourth < 0.005, `the third fringe ${third}, the fourth ${fourth}`);
    out.push(`${z / 1000} mm: dark at ${(at / s).toFixed(3)} lambda z / d (${(dark / peak).toExponential(1)} of the peak); the third fringe ${third.toFixed(3)} of the peak, the fourth ${fourth.toExponential(1)}`);
  }
  return out.join('; ');
});

test("the slit is within 5% of its Fraunhofer sinc^2 at N_F = 0.3 and within 1% at N_F = 0.1 (the readout's words)", () => {
  const a = 100, [re, im] = aperture((x, y) => +(Math.abs(x) < a && Math.abs(y) < 700)), sinc = (t) => (t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t)), out = [];
  for (const [NF, tol] of [[0.3, 0.06], [0.1, 0.01]]) {
    const z = (a * a) / (LAM * NF), f = diffract(re, im, N, DX, LAM, z), I = centreRow(f), peak = I[N / 2];
    let d = 0, s = 0; for (let i = N / 4; i < (3 * N) / 4; i++) { const v = peak * sinc((2 * a * (i - N / 2) * f.pitch) / z / LAM) ** 2; d += (I[i] - v) ** 2; s += v * v; }
    const e = Math.sqrt(d / s);
    assert(e < tol, `N_F = ${NF}: ${pct(e)}`);
    out.push(`N_F = ${NF} (z = ${(z / 1000).toFixed(0)} mm): ${pct(e)}`);
  }
  return out.join(', ');
});

test("the sine grating's Talbot carpet: the image shifted by d/2 at z_T/2, half the period at z_T/4", () => {
  const d = 48, zT = (2 * d * d) / LAM, g = (x, y) => (0.5 + 0.5 * Math.cos((2 * Math.PI * x) / d)) * +(Math.abs(x) < 750 && Math.abs(y) < 750);
  const [re, im] = aperture(g), [rs, is] = aperture((x, y) => g(x + d / 2, y));
  const I0 = centreRow({ re, im }), Is = centreRow({ re: rs, im: is });
  const corr = (A, B) => { let ab = 0, aa = 0, bb = 0; for (let i = N / 2 - 80; i < N / 2 + 80; i++) { ab += A[i] * B[i]; aa += A[i] ** 2; bb += B[i] ** 2; } return ab / Math.sqrt(aa * bb); };
  // The strength of a period in the middle ten periods of the row, read between the samples.
  const harmonic = (f, period) => { let cr = 0, ci = 0; const n = 480; for (let q = 0; q < n; q++) { const x = (q / n - 0.5) * 10 * period, v = rowAt(f, x); cr += v * Math.cos((2 * Math.PI * x) / period); ci += v * Math.sin((2 * Math.PI * x) / period); } return Math.hypot(cr, ci) / n; };
  const f0 = diffract(re, im, N, DX, LAM, 1), fQ = diffract(re, im, N, DX, LAM, zT / 4);
  const cT = corr(centreRow(diffract(re, im, N, DX, LAM, zT)), I0), cH = corr(centreRow(diffract(re, im, N, DX, LAM, zT / 2)), Is);
  const h1 = harmonic(fQ, d) / harmonic(f0, d), h2 = harmonic(fQ, d / 2) / harmonic(f0, d);
  assert(cT > 0.999 && cH > 0.999, `the images: ${cT}, ${cH}`);
  assert(h1 < 0.02 && h2 > 0.1, `at z_T/4 the period d is ${h1} of the grating's, the period d/2 ${h2}`);
  return `self-image ${cT.toFixed(4)}, shifted image at z_T/2 ${cH.toFixed(4)}; at z_T/4 the period d has ${(100 * h1).toFixed(1)}% of the grating's strength, the period d/2 ${(100 * h2).toFixed(0)}%`;
});

test('speckle from rough glass: contrast 1, grains about lambda z / D across', () => {
  const z = 200000, s = 24, D = 1000;
  const [re, im] = aperture((x, y) => {
    if (x * x + y * y > (D / 2) ** 2) return NaN;
    const cx = Math.floor(x / s), cy = Math.floor(y / s);
    let h = (cx * 73856093) ^ (cy * 19349663); h = (h ^ (h >>> 13)) * 1274126177;
    return (((h >>> 0) % 1000) / 1000) * 2 * Math.PI;
  }, { phase: true });
  // The middle +-1 mm, well inside the grains' own sinc envelope (first zero at lambda z / s = 4.6 mm).
  const f = diffract(re, im, N, DX, LAM, z), W = 36, lo = N / 2 - W, hi = N / 2 + W;
  const I = (i, j) => f.re[j * N + i] ** 2 + f.im[j * N + i] ** 2;
  let mean = 0, n = 0; for (let j = lo; j < hi; j++) for (let i = lo; i < hi; i++) { mean += I(i, j); n++; } mean /= n;
  const ac = (sx) => { let a = 0, c = 0; for (let j = lo; j < hi; j++) for (let i = lo; i < hi - sx; i++) { a += I(i, j) * I(i + sx, j); c++; } return a / c / (mean * mean) - 1; };
  const a0 = ac(0); let half = NaN, prev = a0; for (let t = 1; t < 30; t++) { const v = ac(t); if (v < a0 / 2) { half = t - 1 + (prev - a0 / 2) / (prev - v); break; } prev = v; }
  const fwhm = 2 * half * f.pitch, airy = (1.03 * LAM * z) / D;   // the intensity autocorrelation of a round patch is the Airy pattern
  close(Math.sqrt(a0), 1, 0.1, 'the contrast');
  close(fwhm / airy, 1, 0.2, 'the grain size');
  return `contrast ${Math.sqrt(a0).toFixed(2)}; grains ${fwhm.toFixed(0)} um wide (the Airy width 1.03 lambda z / D = ${airy.toFixed(0)} um)`;
});
