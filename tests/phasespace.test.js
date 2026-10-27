import { test, assert, close } from './harness.js';
import { Sim1D, eigenstates } from '../schrodinger1d/sim.js';
import { PhaseGrid, bandLimit, rng32 } from '../phasespace/wigner.js';
import { Ensemble, PotentialTable, sampleDensity } from '../phasespace/classical.js';
import { addGaussian, gaussianWigner, gaussianCovariance, catState, hermiteFunction, normalize } from '../phasespace/states.js';

// Units hbar = m = 1 throughout.

/** A grid of n points on [a, b) (the Sim1D convention). */
function line(n, a, b) {
  const dx = (b - a) / n, x = new Float64Array(n);
  for (let j = 0; j < n; j++) x[j] = a + j * dx;
  return { n, dx, xmin: a, x };
}

function gaussian(L, opts) {
  const re = new Float64Array(L.n), im = new Float64Array(L.n);
  addGaussian(L.x, re, im, opts);
  normalize(re, im, L.dx);
  return { re, im };
}

/** W on a grid that covers the whole state, every grid point a column. */
function wignerOf(L, psi, window = { x0: -6, x1: 6, p0: -6, p1: 6 }, opts = {}) {
  const g = new PhaseGrid(L, window, { cols: 100000, rows: 400, q: 1, ...opts });
  const b = g.prepare(psi.re, psi.im);
  g.wigner(b.re, b.im);
  return { g, b };
}

/**
 * W(x, p) = (1/pi) integral psi*(x + y) psi(x - y) exp(2ipy) dy by direct quadrature, from a
 * closed-form psi: an implementation independent of the FFT one.
 */
function wignerDirect(psi, x, p, Y = 9, dy = 0.004) {
  let s = 0;
  for (let y = -Y; y <= Y; y += dy) {
    const [ar, ai] = psi(x + y), [br, bi] = psi(x - y);
    const cr = ar * br + ai * bi, ci = ar * bi - ai * br, a = 2 * p * y;
    s += cr * Math.cos(a) - ci * Math.sin(a);
  }
  return (s * dy) / Math.PI;
}

/** A closed-form cat state (normalised), psi(x) -> [re, im]. */
function catFunction(x0, p0, phi) {
  const coh = (x, a, b) => {
    const m = Math.PI ** -0.25 * Math.exp(-((x - a) ** 2) / 2), ph = b * (x - a / 2);
    return [m * Math.cos(ph), m * Math.sin(ph)];
  };
  const raw = (x) => {
    const [a, b] = coh(x, x0, p0), [c, d] = coh(x, -x0, -p0), C = Math.cos(phi), S = Math.sin(phi);
    return [a + C * c - S * d, b + C * d + S * c];
  };
  let s = 0;
  for (let x = -15; x < 15; x += 0.001) { const [r, i] = raw(x); s += (r * r + i * i) * 0.001; }
  const k = 1 / Math.sqrt(s);
  return (x) => { const [r, i] = raw(x); return [r * k, i * k]; };
}

// ---------------------------------------------------------------------- the Wigner function

test('Wigner: a coherent state is the positive Gaussian exp(-(x-x0)^2 - (p-p0)^2)/pi', () => {
  const L = line(1024, -12, 12), x0 = 2, p0 = 1;      // p0 > 0 must put the blob at p > 0
  const { g } = wignerOf(L, gaussian(L, { x0, p0 }));
  let err = 0, min = Infinity;
  for (let c = 0; c < g.cols; c++) for (let r = 0; r < g.rows; r++) {
    const v = g.W[c * g.rows + r];
    err = Math.max(err, Math.abs(v - Math.exp(-((g.x[c] - x0) ** 2) - (g.p[r] - p0) ** 2) / Math.PI));
    min = Math.min(min, v);
  }
  assert(err < 1e-9, `max |W - exact| = ${err}`);
  assert(min > -1e-9, `W dips to ${min}`);
  return `max error ${err.toExponential(1)}, min W ${min.toExponential(1)}`;
});

test('Wigner: a squeezed, rotated, displaced Gaussian matches its closed form', () => {
  const L = line(1024, -12, 12);
  for (const opts of [{ x0: 1, p0: -2, r: 0.7, theta: 0.5 }, { x0: -2, p0: 0.5, r: -0.5, theta: 1.2, omega: 2 }]) {
    const { g } = wignerOf(L, gaussian(L, opts), { x0: -7, x1: 7, p0: -8, p1: 8 });
    let err = 0;
    for (let c = 0; c < g.cols; c += 3) for (let r = 0; r < g.rows; r++) err = Math.max(err, Math.abs(g.W[c * g.rows + r] - gaussianWigner(g.x[c], g.p[r], opts)));
    assert(err < 1e-8, `${JSON.stringify(opts)}: max error ${err}`);
  }
});

test('Wigner: the FFT version agrees with direct quadrature for a cat state, off the axes', () => {
  const L = line(1024, -12, 12), f = catFunction(2.5, 1, 1);
  const re = new Float64Array(L.n), im = new Float64Array(L.n);
  for (let j = 0; j < L.n; j++) [re[j], im[j]] = f(L.x[j]);
  const { g } = wignerOf(L, { re, im });
  let err = 0, count = 0;
  for (let c = 7; c < g.cols; c += 37) for (let r = 5; r < g.rows; r += 23) {
    err = Math.max(err, Math.abs(g.W[c * g.rows + r] - wignerDirect(f, g.x[c], g.p[r])));
    count++;
  }
  assert(err < 1e-7, `max difference ${err} over ${count} points`);
  return `${count} points, max difference ${err.toExponential(1)}`;
});

test('Wigner: the integral of W over phase space is 1', () => {
  const L = line(1024, -12, 12);
  const states = {
    coherent: gaussian(L, { x0: 1.5, p0: -1 }),
    squeezed: gaussian(L, { x0: -1, p0: 0.5, r: 0.8, theta: 0.7 }),
    cat: (() => { const s = catState(L.x, { x0: 3, p0: 1, phi: 2 }); normalize(s.re, s.im, L.dx); return s; })(),
    'n = 3': { re: hermiteFunction(L.x, 3), im: new Float64Array(L.n) },
  };
  for (const [name, psi] of Object.entries(states)) {
    const { g } = wignerOf(L, psi, { x0: -8, x1: 8, p0: -8, p1: 8 });
    close(g.stats().total, 1, 1e-9, name);
  }
});

test('Wigner: the marginals are |psi(x)|^2 and |phi(p)|^2', () => {
  const L = line(512, -12, 12), f = catFunction(2.5, 1.5, 0.7);
  const re = new Float64Array(L.n), im = new Float64Array(L.n);
  for (let j = 0; j < L.n; j++) [re[j], im[j]] = f(L.x[j]);
  // Every grid point a column, from one end of the domain to the other.
  const { g, b } = wignerOf(L, { re, im }, { x0: L.xmin, x1: L.xmin + (L.n - 1) * L.dx, p0: -7, p1: 7 }, { margin: 1.2 });
  const xm = g.xMarginal(), pm = g.pMarginal();
  let ex = 0, peakx = 0;
  for (let c = 0; c < g.cols; c++) {
    const j = g.j0 + c * g.q, d = b.re[j] ** 2 + b.im[j] ** 2;
    ex = Math.max(ex, Math.abs(xm[c] - d)); peakx = Math.max(peakx, d);
  }
  // |phi(p)|^2 by a direct Fourier sum at each row's momentum.
  let ep = 0, peakp = 0;
  for (let r = 0; r < g.rows; r += 3) {
    const p = g.p[r];
    let sr = 0, si = 0;
    for (let j = 0; j < L.n; j++) {
      const a = -p * L.x[j], c = Math.cos(a), s = Math.sin(a);
      sr += b.re[j] * c - b.im[j] * s; si += b.re[j] * s + b.im[j] * c;
    }
    const d = ((sr * sr + si * si) * L.dx * L.dx) / (2 * Math.PI);
    ep = Math.max(ep, Math.abs(pm[r] - d)); peakp = Math.max(peakp, d);
  }
  assert(ex < 1e-12 * peakx + 1e-14, `x marginal off by ${ex} (peak ${peakx})`);
  assert(ep < 1e-10 * peakp, `p marginal off by ${ep} (peak ${peakp})`);
  return `|errors| ${ex.toExponential(1)} (x), ${ep.toExponential(1)} (p)`;
});

test('Wigner: |n> has W(0, 0) = (-1)^n / pi hbar; |1> from the eigensolver too', () => {
  const L = line(1024, -12, 12), z = new Float64Array(L.n);
  const at00 = (psi) => {
    const { g } = wignerOf(L, { re: psi, im: z }, { x0: -1, x1: 1, p0: -6, p1: 6 });
    const c = Math.round(-g.x[0] / g.cellX), r = Math.round(-g.p[0] / g.dp);
    assert(Math.abs(g.x[c]) < 1e-12 && Math.abs(g.p[r]) < 1e-12, 'the origin is on the grid');
    return g.W[c * g.rows + r] * Math.PI;
  };
  for (let n = 0; n <= 6; n++) close(at00(hermiteFunction(L.x, n)), (-1) ** n, 1e-10, `n = ${n}`);
  const V = L.x.map((x) => x * x / 2);
  const [, one] = eigenstates(V, L.dx, 1, 2, { first: 1, last: L.n - 1 });
  const w = at00(one.psi);
  close(w, -1, 2e-4, 'eigensolver |1>');
  return `eigensolver |1>: pi W(0,0) = ${w.toFixed(6)}`;
});

test('Wigner: a pure state has 2 pi hbar times the integral of W^2 equal to 1', () => {
  const L = line(1024, -12, 12);
  const cat = catState(L.x, { x0: 2, p0: -1, phi: 1 });
  normalize(cat.re, cat.im, L.dx);
  const states = { coherent: gaussian(L, { x0: 1, p0: 2 }), squeezed: gaussian(L, { r: 1, theta: 0.3 }), cat, 'n = 4': { re: hermiteFunction(L.x, 4), im: new Float64Array(L.n) } };
  const out = [];
  for (const [name, psi] of Object.entries(states)) {
    const { g } = wignerOf(L, psi, { x0: -8, x1: 8, p0: -8, p1: 8 });
    const pur = g.stats().purity;
    close(pur, 1, 1e-8, name);
    out.push(`${name} ${pur.toFixed(10)}`);
  }
  // A mixture is not pure: (W_a + W_b)/2 of two far-apart coherent states has purity 1/2.
  const a = wignerOf(L, gaussian(L, { x0: -3 }), { x0: -8, x1: 8, p0: -8, p1: 8 }).g, bb = wignerOf(L, gaussian(L, { x0: 3 }), { x0: -8, x1: 8, p0: -8, p1: 8 }).g;
  for (let i = 0; i < a.W.length; i++) a.W[i] = (a.W[i] + bb.W[i]) / 2;
  close(a.stats().purity, 0.5, 1e-6, 'mixture');
  return out.join(', ');
});

test('Wigner: W is never below -1/pi hbar (the bound), and a cat has W(0,0) = parity / pi hbar', () => {
  const L = line(1024, -12, 12);
  for (const [phi, parity] of [[0, 1], [Math.PI, -1]]) {
    const s = catState(L.x, { x0: 3, p0: 0, phi });
    normalize(s.re, s.im, L.dx);
    const { g } = wignerOf(L, s);
    const st = g.stats();
    assert(st.min >= -1 / Math.PI - 1e-12 && st.max <= 1 / Math.PI + 1e-12, `range ${st.min * Math.PI} .. ${st.max * Math.PI}`);
    const c = Math.round(-g.x[0] / g.cellX), r = Math.round(-g.p[0] / g.dp);
    close(g.W[c * g.rows + r] * Math.PI, parity, 1e-9, `phi = ${phi}`);
  }
});

// ----------------------------------------------------------------------------- dynamics

test('harmonic evolution turns W rigidly: W(x, p, t) = W0(x cos t - p sin t, p cos t + x sin t)', () => {
  const n = 1024, sim = new Sim1D({ n, xmin: -12, xmax: 12, boundary: 'walls' });
  sim.setPotential(sim.x.map((x) => x * x / 2));
  const f = catFunction(2.5, 1, 1);
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let j = 0; j < n; j++) [re[j], im[j]] = f(sim.x[j]);
  sim.setPsi(re, im); sim.normalize();
  const t = 1.3;
  sim.step(0.005, Math.round(t / 0.005));
  const g = new PhaseGrid(sim, { x0: -5, x1: 5, p0: -5, p1: 5 }, { cols: 200, rows: 200, margin: 2 });
  const b = g.prepare(sim.re.subarray(0, n), sim.im.subarray(0, n));
  g.wigner(b.re, b.im);
  const c = Math.cos(t), s = Math.sin(t);
  let err = 0, count = 0;
  for (let i = 3; i < g.cols; i += 19) for (let r = 2; r < g.rows; r += 17) {
    const x = g.x[i], p = g.p[r];
    err = Math.max(err, Math.abs(g.W[i * g.rows + r] - wignerDirect(f, x * c - p * s, p * c + x * s)));
    count++;
  }
  assert(err < 1e-4, `max difference ${err} (peak 1/pi = 0.318)`);
  return `${count} points, max |W(t) - rotated W(0)| = ${err.toExponential(1)}`;
});

test('free evolution shears W: W(x, p, t) = W0(x - p t, p)', () => {
  const n = 2048, sim = new Sim1D({ n, xmin: -40, xmax: 40, boundary: 'periodic' });
  sim.setPotential(new Float64Array(n));
  const opts = { x0: -3, p0: 1, r: 0.4, theta: 0.3 };
  const psi = gaussian(sim, opts);
  sim.setPsi(psi.re, psi.im);
  const t = 3;
  sim.step(0.05, t / 0.05);
  const g = new PhaseGrid(sim, { x0: -8, x1: 8, p0: -5, p1: 5 }, { cols: 200, rows: 200, margin: 2 });
  const b = g.prepare(sim.re, sim.im);
  g.wigner(b.re, b.im);
  let err = 0;
  for (let i = 0; i < g.cols; i += 3) for (let r = 0; r < g.rows; r += 3) err = Math.max(err, Math.abs(g.W[i * g.rows + r] - gaussianWigner(g.x[i] - g.p[r] * t, g.p[r], opts)));
  assert(err < 1e-8, `max difference ${err}`);
  return `max difference ${err.toExponential(1)}`;
});

// ------------------------------------------------------------------------------ Husimi Q

test('Husimi: a coherent state gives Q = exp(-((x-x0)^2 + (p-p0)^2)/2) / 2 pi; Q >= 0; integral 1', () => {
  const L = line(1024, -12, 12), x0 = -1.5, p0 = 2;
  const g = new PhaseGrid(L, { x0: -8, x1: 8, p0: -8, p1: 8 }, { cols: 300, rows: 300 });
  const b = g.prepare(...Object.values(gaussian(L, { x0, p0 })));
  g.husimi(b.re, b.im, Math.SQRT1_2);
  let err = 0;
  for (let c = 0; c < g.cols; c++) for (let r = 0; r < g.rows; r++) err = Math.max(err, Math.abs(g.Q[c * g.rows + r] - Math.exp(-((g.x[c] - x0) ** 2 + (g.p[r] - p0) ** 2) / 2) / (2 * Math.PI)));
  const peak = 1 / (2 * Math.PI);
  assert(err < 3e-3 * peak, `max error ${err / peak} of the peak`);
  close(g.stats(g.Q).total, 1, 1e-4, 'integral of Q');
  // A cat state: W is negative between the blobs, Q is not.
  const cat = catState(L.x, { x0: 3, p0: 0, phi: Math.PI });
  normalize(cat.re, cat.im, L.dx);
  const bc = g.prepare(cat.re, cat.im);
  g.husimi(bc.re, bc.im, Math.SQRT1_2);
  g.wigner(bc.re, bc.im);
  const sq = g.stats(g.Q), sw = g.stats(g.W);
  assert(sq.min > -1e-12 && sw.min < -0.3, `min Q ${sq.min}, min W ${sw.min}`);
  return `coherent: max error ${(err / peak).toExponential(1)} of the peak; cat: min W ${(sw.min * Math.PI).toFixed(3)}/pi, min Q ${sq.min.toExponential(1)}`;
});

// ----------------------------------------------------------------------------- quadratures

test('quadratures: X_theta of a squeezed state has the variance of its rotated covariance', () => {
  const L = line(1024, -12, 12), opts = { x0: 1, p0: -0.5, r: 0.6, theta: 0.4 };
  const { g } = wignerOf(L, gaussian(L, opts), { x0: -7, x1: 7, p0: -7, p1: 7 }, { q: 2 });
  const { sxx, sxp, spp } = gaussianCovariance(opts.r, opts.theta);
  for (const th of [0, Math.PI / 4, Math.PI / 2, 2.3]) {
    const nb = 400, P = g.quadrature(g.W, th, 1, -8, 8, nb), w = 16 / nb;
    let s0 = 0, s1 = 0, s2 = 0;
    for (let i = 0; i < nb; i++) { const X = -8 + (i + 0.5) * w; s0 += P[i] * w; s1 += P[i] * X * w; s2 += P[i] * X * X * w; }
    const mean = s1 / s0, v = s2 / s0 - mean * mean, c = Math.cos(th), s = Math.sin(th);
    close(s0, 1, 1e-6, `norm at ${th}`);
    close(mean, opts.x0 * c + opts.p0 * s, 1e-6, `mean at ${th}`);
    // Cloud-in-cell binning adds w^2/6 to the variance of the samples.
    close(v, sxx * c * c + 2 * sxp * s * c + spp * s * s + (w * w) / 6 + (g.cellX ** 2 * c * c + g.dp ** 2 * s * s) / 12, 2e-3, `variance at ${th}`);
  }
});

// ---------------------------------------------------------------------------- classical

test('classical: leapfrog keeps the oscillator on its circle and conserves energy', () => {
  const table = new PotentialTable((xs) => xs.map((x) => x * x / 2), -20, 20, 16384);
  const e = new Ensemble(2);
  e.set(Float64Array.of(3, 0), Float64Array.of(0, 1.5));
  const h = 0.01, steps = 62800;                     // t = 628, a hundred periods less 0.3
  let worst = 0;
  for (let k = 0; k < 100; k++) {
    e.step(table, h, steps / 100);
    const E = (e.p[0] ** 2 + e.x[0] ** 2) / 2;
    worst = Math.max(worst, Math.abs(E - 4.5) / 4.5);
  }
  assert(worst < 2e-5, `energy drift ${worst}`);
  // After 100 periods the phase error is (h^2 / 24) t = 2.6e-3 radians, so x and p are off
  // by about 3 times that.
  const t = steps * h;
  close(e.x[0], 3 * Math.cos(t), 1e-2, 'x after 100 periods');
  close(e.p[0], -3 * Math.sin(t), 1e-2, 'p after 100 periods');
  close(Math.atan2(-e.p[0], e.x[0]), Math.atan2(Math.sin(t), Math.cos(t)) + (h * h / 24) * t, 1e-5, 'the phase lead h^2 t / 24');
  return `relative energy error at most ${worst.toExponential(1)} over 100 periods`;
});

test('classical: an anharmonic flow conserves energy and phase-space area (symplectic)', () => {
  const V = (x) => x * x / 2 + 0.05 * x ** 4;
  const table = new PotentialTable((xs) => xs.map(V), -10, 10, 16384);
  // The exact force, so that the map is smooth: then a small triangle of points must keep
  // its area while it is stretched and turned.
  const exact = { force: (x) => -(x + 0.2 * x ** 3), potential: V };
  // (Small enough that the sheared sliver it becomes stays straight: its sagitta along the
  // curved orbit must be far less than its width.)
  const d = 1e-7, e = new Ensemble(3);
  e.set(Float64Array.of(3, 3 + d, 3), Float64Array.of(0, 0, d));
  const E0 = [0, 1, 2].map((i) => e.p[i] ** 2 / 2 + V(e.x[i]));
  e.step(exact, 0.002, 10000);                       // t = 20, several periods
  const area = ((e.x[1] - e.x[0]) * (e.p[2] - e.p[0]) - (e.x[2] - e.x[0]) * (e.p[1] - e.p[0])) / (d * d);
  const drift = Math.max(...[0, 1, 2].map((i) => Math.abs(e.p[i] ** 2 / 2 + V(e.x[i]) - E0[i]) / E0[i]));
  close(area, 1, 1e-3, 'area ratio');
  assert(drift < 1e-4, `energy drift ${drift}`);
  close(table.potential(1.2345), V(1.2345), 1e-8, 'tabulated V');
  close(table.force(1.2345), exact.force(1.2345), 1e-5, 'tabulated force');
  // The tabulated force (what the demo uses) conserves energy as well.
  const f = new Ensemble(1);
  f.set(Float64Array.of(3), Float64Array.of(0));
  f.step(table, 0.002, 25000);
  const drift2 = Math.abs(f.p[0] ** 2 / 2 + V(f.x[0]) - V(3)) / V(3);
  assert(drift2 < 1e-4, `energy drift with the table ${drift2}`);
  return `area ratio ${area.toFixed(6)}, energy drift ${drift.toExponential(1)} (exact force), ${drift2.toExponential(1)} (table)`;
});

test('classical: points drawn from a coherent state W have its mean and variances', () => {
  const L = line(1024, -12, 12), x0 = 2, p0 = -1;
  const { g } = wignerOf(L, gaussian(L, { x0, p0 }), { x0: -6, x1: 6, p0: -6, p1: 6 }, { q: 2 });
  const N = 40000, s = g.sample(g.W, N, rng32(7));
  const e = new Ensemble(); e.set(s.x, s.p);
  const st = e.stats(new PotentialTable((xs) => xs.map((x) => x * x / 2), -12, 12));
  const se = 3 / Math.sqrt(N) * Math.SQRT1_2;
  close(st.x, x0, se, '<x>'); close(st.p, p0, se, '<p>');
  close(st.sx ** 2, 0.5, 0.02, 'var x'); close(st.sp ** 2, 0.5, 0.02, 'var p');
  // The mean energy of the ensemble is the quantum <H> = (x0^2 + p0^2)/2 + 1/2.
  close(st.E, (x0 * x0 + p0 * p0) / 2 + 0.5, 0.05, '<H>');
  return `<x> ${st.x.toFixed(3)}, <p> ${st.p.toFixed(3)}, var ${(st.sx ** 2).toFixed(3)}, ${(st.sp ** 2).toFixed(3)}, <H> ${st.E.toFixed(3)}`;
});

test('classical: points from |psi|^2 |phi|^2 have the quantum mean energy (the |1> state)', () => {
  const L = line(1024, -12, 12), psi = hermiteFunction(L.x, 1), N = 40000, rng = rng32(3);
  const xs = sampleDensity(psi.map((v) => v * v), L.xmin, L.dx, N, rng);
  // |phi_1(p)|^2 has the same form as |psi_1(x)|^2 (the oscillator's Fourier symmetry).
  const ps = sampleDensity(psi.map((v) => v * v), L.xmin, L.dx, N, rng);
  let E = 0;
  for (let i = 0; i < N; i++) E += (xs[i] ** 2 + ps[i] ** 2) / 2;
  close(E / N, 1.5, 0.03, '<H>');
});
