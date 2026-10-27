import { test, assert, close } from './harness.js';
import {
  sheppLogan, disk, blob, shapesMass, projectShapes, rasterizeShapes, prepareRaster, projectRaster,
  filterResponse, padLength, measureRow, transmission, MU, projectionSpectrum, objectSpectrum, erf, TWO_PI,
  poisson, random, waterCorrect,
} from '../tomography/radon.js';
import { Scanner } from '../tomography/scan.js';
import { besselJ } from '../lib/bessel.js';

const N = 256, h = 2 / N;
const deg = Math.PI / 180;

// The exact 2D Fourier transform of analytic shapes, F(k) = integral f e^{-i k.r} d^2r: an
// ellipse gives rho 2 pi a b J1(q)/q e^{-i k.r0}, q = |(a k_u, b k_v)|; a Gaussian
// rho 2 pi sigma^2 exp(-k^2 sigma^2 / 2) e^{-i k.r0}.
function shapesFT(shapes, kx, ky) {
  let re = 0, im = 0;
  for (const sh of shapes) {
    let amp;
    if (sh.type === 'ellipse') {
      const c = Math.cos(sh.phi), s = Math.sin(sh.phi);
      const q = Math.hypot(sh.a * (kx * c + ky * s), sh.b * (-kx * s + ky * c));
      amp = sh.rho * TWO_PI * sh.a * sh.b * (q < 1e-8 ? 0.5 : besselJ(1, q)[1] / q);
    } else amp = sh.rho * TWO_PI * sh.sigma ** 2 * Math.exp(-((kx * kx + ky * ky) * sh.sigma ** 2) / 2);
    const ph = -(kx * sh.x + ky * sh.y);
    re += amp * Math.cos(ph); im += amp * Math.sin(ph);
  }
  return [re, im];
}

test('erf against tabulated values', () => {
  for (const [x, v] of [[0.1, 0.1124629160182849], [0.5, 0.5204998778130465], [1, 0.8427007929497149], [2, 0.9953222650189527], [3.5, 0.9999992569016276]]) {
    close(erf(x), v, 1e-15, `erf(${x})`);
    close(erf(-x), -v, 1e-15, `erf(${-x})`);
  }
});

test('a disk projects to its chord length 2 rho sqrt(R^2 - s^2), at every angle', () => {
  const R = 0.6, rho = 1.5, x0 = 0.2, y0 = -0.1, M = 256, ds = 2 / M;
  const shapes = [disk(x0, y0, R, rho)];
  let worst = 0;
  for (const th of [0, 17, 45, 90, 133]) {
    const t = th * deg, s0 = x0 * Math.cos(t) + y0 * Math.sin(t);
    // Narrow bins are point samples of p.
    const p = projectShapes(shapes, t, M, ds, 1e-4, new Float64Array(M));
    for (let k = 0; k < M; k++) {
      // (Within 1e-4 of the rim the narrow bin's average differs from the point value: there
      // the chord changes infinitely fast.)
      const s = (k - M / 2) * ds - s0, want = Math.abs(s) < R ? 2 * rho * Math.sqrt(R * R - s * s) : 0;
      if (Math.abs(Math.abs(s) - R) > 1e-4) worst = Math.max(worst, Math.abs(p[k] - want));
    }
    // Full-width bins keep the mass exactly.
    const q = projectShapes(shapes, t, M, ds, 1, new Float64Array(M));
    close(q.reduce((a, v) => a + v, 0) * ds, Math.PI * R * R * rho, 1e-12, `mass at ${th} degrees`);
  }
  assert(worst < 1e-8, `largest difference from the chord length ${worst}`);
  return `point samples within ${worst.toExponential(1)}; bin averages keep the mass to 1e-12`;
});

test("a picture's numerical projections match the exact ones (Joseph's method)", () => {
  // A smooth-edged object and the sharp phantom, both as pictures, against the exact
  // projections of their analytic forms.
  const M = 256, ds = 2 / M, out = [];
  for (const [name, shapes, tol] of [['blobs', [blob(0.3, 0.2, 0.08, 0.1), blob(-0.35, -0.3, 0.05, 0.03)], 2e-3], ['phantom', sheppLogan('modified'), 1.5e-2]]) {
    const raster = prepareRaster(rasterizeShapes(shapes, N, 8), N);
    let worst = 0, peak = 0, l1 = 0, l1ref = 0;
    for (const th of [0, 10, 30, 45, 61, 90, 120, 172]) {
      const a = projectRaster(raster, th * deg, M, ds, 1, new Float64Array(M));
      const b = projectShapes(shapes, th * deg, M, ds, 1, new Float64Array(M));
      for (let k = 0; k < M; k++) { worst = Math.max(worst, Math.abs(a[k] - b[k])); peak = Math.max(peak, b[k]); l1 += Math.abs(a[k] - b[k]); l1ref += Math.abs(b[k]); }
    }
    assert(l1 / l1ref < tol, `${name}: mean relative difference ${l1 / l1ref}`);
    out.push(`${name}: mean ${(100 * l1 / l1ref).toFixed(2)}%, worst ${(100 * worst / peak).toFixed(1)}% of the peak`);
  }
  return out.join('; ');
});

test('a point traces the sinusoid s = x0 cos(theta) + y0 sin(theta)', () => {
  const x0 = 0.45, y0 = -0.25, M = 256, ds = 2 / M;
  const shapes = [blob(x0, y0, 1.2 * h, 1)];
  const raster = prepareRaster(rasterizeShapes(shapes, N), N);
  let worstA = 0, worstR = 0;
  for (let th = 0; th < 180; th += 7) {
    const t = th * deg, want = x0 * Math.cos(t) + y0 * Math.sin(t);
    const centroid = (p) => { let m = 0, ms = 0; for (let k = 0; k < M; k++) { m += p[k]; ms += p[k] * (k - M / 2) * ds; } return ms / m; };
    worstA = Math.max(worstA, Math.abs(centroid(projectShapes(shapes, t, M, ds, 1, new Float64Array(M))) - want));
    worstR = Math.max(worstR, Math.abs(centroid(projectRaster(raster, t, M, ds, 1, new Float64Array(M))) - want));
  }
  assert(worstA < 1e-12 && worstR < 0.02 * h, `centroids off by ${worstA}, ${worstR}`);
  return `exact projections: ${worstA.toExponential(1)}; projections of the picture: ${(worstR / h).toExponential(1)} pixel`;
});

test('projection-slice theorem: the 1D transform of a projection is a line through the 2D transform', () => {
  const notes = [];
  // 1. Exactly, for a picture, along the axes: the projection at 0 degrees is the column sums.
  const shapes = sheppLogan('modified');
  const f = rasterizeShapes(shapes, N, 4), raster = prepareRaster(f, N);
  const F = objectSpectrum(f, N, 2 * N), K = F.K, L = padLength(N);
  const re = new Float64Array(L), im = new Float64Array(L);
  let worst = 0, peak = 0;
  for (const [th, along] of [[0, 'x'], [90, 'y']]) {
    projectionSpectrum(projectRaster(raster, th * deg, N, h, 1, new Float64Array(N)), N, h, re, im);
    for (let m = 0; m < L; m++) {
      // k = (m - L/2) dk on the kx axis (row K/2) or the ky axis (column K/2, ky up).
      const o = along === 'x' ? (K / 2) * K + m : (K - m) % K * K + K / 2;
      worst = Math.max(worst, Math.hypot(re[m] - F.re[o], im[m] - F.im[o])); peak = Math.max(peak, Math.hypot(re[m], im[m]));
    }
  }
  assert(worst < 1e-10 * peak, `on the axes: ${worst / peak}`);
  notes.push(`on the axes exact to ${(worst / peak).toExponential(1)}`);

  // 2. At any angle, for the picture: against the 2D transform of its pixels evaluated on the
  // line (a direct sum), up to half of Nyquist.  Joseph's projector interpolates linearly
  // along the rows it steps through (a triangle of width 2h, whose transform is sinc^2), so
  // the slice is the pixels' transform times sinc^2(k_row h / 2), k_row = k cos(theta) when
  // it steps through rows and k sin(theta) through columns; what is left is aliasing.
  const dft2 = (kx, ky) => {
    const ex = new Float64Array(2 * N);
    for (let i = 0; i < N; i++) { const a = -kx * (i - N / 2) * h; ex[2 * i] = Math.cos(a); ex[2 * i + 1] = Math.sin(a); }
    let R = 0, I = 0;
    for (let j = 0; j < N; j++) {
      let r = 0, q = 0;
      for (let i = 0; i < N; i++) { const v = f[j * N + i]; if (v) { r += v * ex[2 * i]; q += v * ex[2 * i + 1]; } }
      const b = -ky * (N / 2 - j) * h, c = Math.cos(b), d = Math.sin(b);
      R += r * c - q * d; I += r * d + q * c;
    }
    return [R * h * h, I * h * h];
  };
  const sinc2 = (x) => (x === 0 ? 1 : (Math.sin(x) / x) ** 2);
  let num = 0, num0 = 0, den = 0;
  const dkS = TWO_PI / (L * h);
  for (const th of [20, 37, 45, 71, 115, 160]) {
    const t = th * deg, c = Math.cos(t), sn = Math.sin(t);
    projectionSpectrum(projectRaster(raster, t, N, h, 1, new Float64Array(N)), N, h, re, im);
    for (let m = L / 2 - L / 8; m < L / 2 + L / 8; m += 2) {
      const k = (m - L / 2) * dkS, [a, b] = dft2(k * c, k * sn);
      const w = sinc2((k * (Math.abs(c) >= Math.abs(sn) ? c : sn) * h) / 2);
      num += (re[m] - w * a) ** 2 + (im[m] - w * b) ** 2; num0 += (re[m] - a) ** 2 + (im[m] - b) ** 2; den += a * a + b * b;
    }
  }
  const relPic = Math.sqrt(num / den);
  assert(relPic < 0.003, `oblique slices of the picture: ${relPic}`);
  notes.push(`oblique slices of the picture: ${(100 * relPic).toFixed(2)}% rms from the 2D transform on the line (${(100 * Math.sqrt(num0 / den)).toFixed(1)}% without the interpolation's sinc^2)`);

  // 3. The continuous theorem, for the analytic phantom: exact projections on a fine
  // detector, against the exact 2D transform (Bessel J1), divided by the bins' sinc.
  const M = 1024, ds = 2 / M, LM = padLength(M), r2 = new Float64Array(LM), i2 = new Float64Array(LM), dkM = TWO_PI / (LM * ds);
  let worstC = 0;
  const F0 = shapesFT(shapes, 0, 0)[0];
  for (const th of [0, 33, 90, 147]) {
    projectionSpectrum(projectShapes(shapes, th * deg, M, ds, 1, new Float64Array(M)), M, ds, r2, i2);
    for (let m = LM / 2 - 400; m < LM / 2 + 400; m++) {
      const k = (m - LM / 2) * dkM, sinc = k ? Math.sin(k * ds / 2) / (k * ds / 2) : 1;
      const [a, b] = shapesFT(shapes, k * Math.cos(th * deg), k * Math.sin(th * deg));
      worstC = Math.max(worstC, Math.hypot(r2[m] - sinc * a, i2[m] - sinc * b));
    }
  }
  assert(worstC < 1e-4 * F0, `continuous: ${worstC / F0}`);
  notes.push(`analytic phantom against its exact transform: ${(worstC / F0).toExponential(1)} of F(0) up to |k| = ${Math.round(400 * dkM)}`);
  return notes.join('; ');
});

test('the ramp filter is |nu| with the right average', () => {
  const M = 256, ds = 2 / M, L = padLength(M), H = filterResponse('ramlak', M, ds);
  let worst = 0;
  for (let m = 8; m < L / 2 - 8; m++) worst = Math.max(worst, Math.abs(H[m] - m / (L * ds)) / (m / (L * ds)));
  assert(worst < 0.01, `relative error ${worst}`);
  // The truncated kernel leaves a small positive average, about 1 / (pi^2 L ds) (not zero, as
  // sampling |nu| would give: that error shifts every picture's mean).
  assert(H[0] > 0 && H[0] < 2 / (Math.PI ** 2 * L * ds), `H(0) = ${H[0]}`);
  const hann = filterResponse('hann', M, ds);
  close(hann[L / 2 - 1] / H[L / 2 - 1], 0, 1e-3, 'Hann at Nyquist');
  return `within ${(100 * worst).toFixed(2)}% of |nu| away from 0; H(0) = ${H[0].toExponential(2)}`;
});

test('back-projecting every angle of a point gives m / r', () => {
  const sc = new Scanner(N);
  const mass = 0.01;
  sc.setShapes([blob(0, 0, 0.5 * h, mass)]);
  sc.configure({ nA: 720, M: 256 });
  sc.measureAll();
  // The average round circles of radius r.
  const notes = [];
  let worst = 0;
  for (const r of [0.05, 0.1, 0.2, 0.4, 0.6, 0.8]) {
    let s = 0, n = 0;
    for (let a = 0; a < 64; a++) {
      const x = r * Math.cos((a * TWO_PI) / 64), y = r * Math.sin((a * TWO_PI) / 64);
      const i = x / h + N / 2, j = N / 2 - y / h, i0 = Math.floor(i), j0 = Math.floor(j), fx = i - i0, fy = j - j0;
      const v = (sc.bp[j0 * N + i0] * (1 - fx) + sc.bp[j0 * N + i0 + 1] * fx) * (1 - fy) + (sc.bp[(j0 + 1) * N + i0] * (1 - fx) + sc.bp[(j0 + 1) * N + i0 + 1] * fx) * fy;
      s += v; n++;
    }
    const ratio = (s / n) * r / mass;
    worst = Math.max(worst, Math.abs(ratio - 1));
    notes.push(`r ${r}: ${ratio.toFixed(4)}`);
  }
  assert(worst < 0.01, notes.join(', '));
  return `b r / m = ${notes.join(', ')}`;
});

test('filtered back-projection of a uniform disk gives its density', () => {
  const sc = new Scanner(N);
  sc.setShapes([disk(0.1, -0.05, 0.5, 1)]);
  sc.configure({ nA: 360, M: 256 });
  sc.measureAll();
  let s = 0, n = 0, s2 = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i - N / 2) * h - 0.1, y = (N / 2 - j) * h + 0.05;
    if (x * x + y * y < 0.4 * 0.4) { s += sc.fbp[j * N + i]; s2 += sc.fbp[j * N + i] ** 2; n++; }
  }
  const mean = s / n, sd = Math.sqrt(s2 / n - mean * mean);
  close(mean, 1, 2e-3, 'mean inside');
  assert(sd < 3e-3, `ripple ${sd}`);
  return `inside: ${mean.toFixed(5)} +- ${sd.toExponential(1)}`;
});

test('filtered back-projection of the Shepp-Logan phantom converges', () => {
  const sc = new Scanner(N);
  sc.setShapes(sheppLogan('modified'));
  const rows = [];
  let last = Infinity;
  for (const [nA, M] of [[23, 32], [45, 64], [90, 128], [180, 256], [400, 256], [800, 512]]) {
    sc.configure({ nA, M });
    sc.measureAll();
    const e = sc.rmsError(sc.fbp);
    rows.push(`${nA}x${M}: ${e.toFixed(4)}`);
    assert(e < last, `the error grew: ${rows.join(', ')}`);
    last = e;
  }
  return `rms error (angles x detectors) ${rows.join(', ')}`;
});

test('too few angles: streaks begin 2 nA ds / pi from a point', () => {
  // The FBP of a point at the centre is a star of 2 nA filtered half-lines.  Round a circle of
  // radius r, their sum varies only at angular frequencies 2 nA m; the filtered projection has
  // wavenumbers up to pi / ds, so on the circle frequencies up to r pi / ds: the first
  // harmonic, the streaks, appears once r pi / ds > 2 nA.  (In k-space: angular samples
  // k pi / nA apart alias a point by 2 pi / (k pi / nA), at most 2 nA ds / pi away.)
  const sc = new Scanner(N);
  sc.setShapes([blob(0, 0, 0.5 * h, 0.01)]);
  const nA = 32, M = 128;
  sc.configure({ nA, M });
  sc.measureAll();
  const rFree = (2 * nA * (2 / M)) / Math.PI;
  const at = (x, y) => {
    const i = x / h + N / 2, j = N / 2 - y / h, i0 = Math.floor(i), j0 = Math.floor(j), a = i - i0, b = j - j0, F = sc.fbp;
    return (F[j0 * N + i0] * (1 - a) + F[j0 * N + i0 + 1] * a) * (1 - b) + (F[(j0 + 1) * N + i0] * (1 - a) + F[(j0 + 1) * N + i0 + 1] * a) * b;
  };
  // The spread of values round a circle of radius r: zero if the picture is round.
  const ripple = (r) => {
    let s = 0, s2 = 0;
    const n = 1440;
    for (let q = 0; q < n; q++) { const v = at(r * Math.cos((q * TWO_PI) / n), r * Math.sin((q * TWO_PI) / n)); s += v; s2 += v * v; }
    return Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
  };
  // (Linear interpolation between bins adds a little above pi / ds, so the streaks set in a
  // little early, at about 0.75 r_free.)
  const rows = [0.3, 0.6, 0.8, 1, 1.3, 1.8].map((f) => [f, ripple(f * rFree)]);
  const inside = Math.max(rows[0][1], rows[1][1]), outside = Math.min(rows[3][1], rows[4][1], rows[5][1]);
  assert(outside > 5 * inside, rows.map(([f, v]) => `${f}: ${v}`).join(', '));
  return `r_free = ${rFree.toFixed(3)}; ripple round circles at ${rows.map(([f, v]) => `${f} r_free: ${v.toExponential(1)}`).join(', ')}`;
});

test('photon counting: Poisson counts, and the noise of -ln(n / I0)', () => {
  // The counts themselves: mean = variance = lambda, below and above the switch of method.
  for (const lam of [0.7, 3.7, 9.9, 10.1, 47, 2500]) {
    const r = random(11);
    let s = 0, s2 = 0;
    const n = 200000;
    for (let i = 0; i < n; i++) { const c = poisson(lam, r); s += c; s2 += c * c; }
    const mean = s / n, v = s2 / n - mean * mean;
    close(mean / lam, 1, 5 * Math.sqrt(1 / (lam * n)), `mean at lambda ${lam}`);
    close(v / lam, 1, 5 * Math.sqrt(2 / n) + 5 / Math.sqrt(lam * n), `variance at lambda ${lam}`);
  }
  // The reported line integrals: variance 1 / (n mu^2) when many photons arrive.
  const M = 50000, p = new Float64Array(M).fill(1.5), out = new Float64Array(M);
  for (const I0 of [1e4, 1e6]) {
    measureRow(p, M, out, { noise: true, I0, poly: false, seed: 7 });
    let s = 0, s2 = 0;
    for (let k = 0; k < M; k++) { s += out[k]; s2 += out[k] ** 2; }
    const mean = s / M, varr = s2 / M - mean * mean;
    const n = I0 * Math.exp(-MU * 1.5), want = 1 / (n * MU * MU);
    close(mean, 1.5, 5 * Math.sqrt(want / M) + 1 / (n * MU), `mean at I0 = ${I0}`);
    close(varr / want, 1, 0.04, `variance at I0 = ${I0}`);
  }
  return `variance of -ln(n / I0) / mu within 4% of 1 / (n mu^2) at I0 = 1e4 and 1e6`;
});

test('beam hardening: the water correction is exact for water, and short of the truth through metal', () => {
  // Water alone: what the two-energy beam gives, corrected for water, is the path itself.
  let worst = 0;
  for (const p of [0.001, 0.1, 1, 2.5, 5]) worst = Math.max(worst, Math.abs(waterCorrect(-Math.log(transmission(p, 0, true)) / MU) - p));
  assert(worst < 1e-12, `water: ${worst}`);
  // Uncorrected, a long path of water looks shorter (the soft photons are used up first).
  const raw = -Math.log(transmission(1.5, 0, true)) / MU;
  assert(raw < 1.5 && raw > 0.85 * 1.5, `raw ${raw}`);
  // Through metal: the hard photons get through relatively more easily than water would let
  // them, so the corrected value falls short, the more so the more metal.
  const out = [];
  let last = 0;
  for (const pQ of [0.5, 1, 2]) {
    const p = 1.5 + pQ, got = waterCorrect(-Math.log(transmission(p, pQ, true)) / MU);
    assert(got < p && p - got > last, `metal ${pQ}: ${got} of ${p}`);
    last = p - got;
    out.push(`${p} -> ${got.toFixed(3)}`);
  }
  // measureRow without noise does the same.
  const row = measureRow(Float64Array.of(1.5, 3.5), 2, new Float64Array(2), { noise: false, I0: 1e5, poly: true }, Float64Array.of(0, 2));
  close(row[0], 1.5, 1e-12, 'water row'); close(row[1], waterCorrect(-Math.log(transmission(3.5, 2, true)) / MU), 1e-12, 'metal row');
  return `water exact to ${worst.toExponential(0)}; uncorrected 1.5 of water reads ${raw.toFixed(3)}; with metal (1.5 of water plus metal) ${out.join(', ')}`;
});

test('noise in the picture falls as 1/sqrt(I0); the Hann window cuts it', () => {
  const sc = new Scanner(N);
  sc.setShapes([disk(0, 0, 0.7, 1)]);
  sc.configure({ nA: 180, M: 256, noise: true });
  const sd = () => {
    let s = 0, s2 = 0, n = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i - N / 2) * h, y = (N / 2 - j) * h;
      if (x * x + y * y < 0.5 * 0.5) { const v = sc.fbp[j * N + i]; s += v; s2 += v * v; n++; }
    }
    return Math.sqrt(s2 / n - (s / n) ** 2);
  };
  sc.configure({ I0: 1e4 }); sc.measureAll(); const a = sd();
  sc.configure({ I0: 1e6 }); sc.measureAll(); const b = sd();
  sc.configure({ filter: 'hann' }); const c = sd();
  close(a / b, 10, 0.6, 'a hundred times the photons');
  assert(c / b < 0.5 && c / b > 0.2, `Hann / Ram-Lak ${c / b}`);
  return `sigma ${a.toFixed(4)} at I0 = 1e4, ${b.toFixed(5)} at 1e6 (ratio ${(a / b).toFixed(2)}); Hann ${c.toFixed(5)} (${(100 * c / b).toFixed(0)}% of Ram-Lak)`;
});

test('direct Fourier reconstruction (gridding) agrees with filtered back-projection', () => {
  const sc = new Scanner(N);
  sc.setShapes(sheppLogan('modified'));
  sc.configure({ nA: 400, M: 256 });
  sc.measureAll();
  const d = sc.directFourier(), eD = sc.rmsError(d), eF = sc.rmsError(sc.fbp);
  assert(eD < 2 * eF, `direct ${eD}, filtered back-projection ${eF}`);
  // A limited range leaves a wedge empty: both methods lose the same information.
  return `rms error: direct Fourier ${eD.toFixed(4)}, filtered back-projection ${eF.toFixed(4)}`;
});

test('re-measuring an angle replaces its row in the pictures', () => {
  const sc = new Scanner(128);
  sc.setShapes(sheppLogan('modified'));
  sc.configure({ nA: 60, M: 128 });
  sc.measureAll();
  const bp = sc.bp.slice(), fbp = sc.fbp.slice();
  // Change the object, measure everything again (a second turn), then compare with a fresh scan.
  sc.setShapes([disk(0.2, 0.1, 0.3, 1)]);
  for (let j = 0; j < sc.nA; j++) sc.measure(j);
  const again = sc.fbp.slice();
  sc.measureAll();
  let worst = 0, peak = 0;
  for (let i = 0; i < again.length; i++) { worst = Math.max(worst, Math.abs(again[i] - sc.fbp[i])); peak = Math.max(peak, Math.abs(sc.fbp[i])); }
  assert(worst < 1e-12 * peak, `${worst}`);
  assert(bp.some((v, i) => v !== sc.bp[i]) && fbp.length === again.length, 'the pictures changed');
});
