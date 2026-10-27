import { test, assert, close } from './harness.js';
import { spectrum, pupil, shifted, coherentField, coherentImage, intensity, otf, intensitySpectrum, incoherentImage,
  sourcePoints, PartialImage, stats, throughput, pxPerNA } from '../imaging/optics.js';
import { grating, snapPeriod, encode, twoPoints, edge, siemensStar, barTarget, cells, diatom } from '../imaging/objects.js';

const sumSq = (A) => { let s = 0; for (let o = 0; o < A.re.length; o++) s += A.re[o] ** 2 + A.im[o] ** 2; return s; };
const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
const field = (n, f) => {
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = f(i - n / 2, n / 2 - j);
    if (typeof v === 'number') re[j * n + i] = v; else { re[j * n + i] = v[0]; im[j * n + i] = v[1]; }
  }
  return { re, im };
};
const phaseObject = (n, phi) => field(n, (x, y) => { const p = phi(x, y); return [Math.cos(p), Math.sin(p)]; });
const maxAbs = (a, b) => { let m = 0; for (let o = 0; o < a.length; o++) m = Math.max(m, Math.abs(a[o] - b[o])); return m; };

test('Parseval: the light is the same in the object, the Fourier plane, and the image of an open pupil', () => {
  const n = 64, r = rng(3), t = field(n, () => [r(), r()]);
  const T = spectrum(t.re, t.im, n);
  close(sumSq(T) / sumSq(t), 1, 1e-12, 'object vs spectrum');
  // Through any pupil, the image holds exactly the light that passed it.
  const P = pupil(n, { cut: 12.5, stop: 2, dot: { r: 0, phase: Math.PI / 2, amp: 0.5 }, defocus: 0.01 });
  const E = coherentField(T, P, n);
  let passed = 0;
  for (let o = 0; o < n * n; o++) passed += (T.re[o] ** 2 + T.im[o] ** 2) * (P.re[o] ** 2 + P.im[o] ** 2);
  close(sumSq(E) / passed, 1, 1e-12, 'image vs filtered spectrum');
  close(throughput(T, P, n), passed / sumSq(T), 1e-12, 'throughput');
});

test('a pure phase object through an unobstructed pupil gives a uniform image: it is invisible', () => {
  const n = 128;
  const t = phaseObject(n, (x, y) => 1.7 * Math.exp(-(x * x + y * y) / 200) + 0.9 * (Math.abs(x - 20) < 8 && Math.abs(y) < 30));
  const I = coherentImage(spectrum(t.re, t.im, n), pupil(n, {}), n);
  const s = stats(I);
  assert(Math.abs(s.max - 1) < 1e-12 && Math.abs(s.min - 1) < 1e-12, `I from ${s.min} to ${s.max}`);
  // A finite aperture cuts off the steep parts of the phase, and the object shows faintly.
  const cut = stats(coherentImage(spectrum(t.re, t.im, n), pupil(n, { cut: 10 }), n));
  assert(cut.max - cut.min > 1e-3, 'a small aperture makes it faintly visible');
  return `uniform to ${Math.max(s.max - 1, 1 - s.min).toExponential(1)}; through a small aperture, contrast ${cut.contrast.toFixed(3)}`;
});

test('Zernike: a +pi/2 dot on the zero order gives I = 1 + 2(phi - <phi>) + O(phi^2); -pi/2 gives 1 - 2(phi - <phi>)', () => {
  const n = 128;
  const shape = (x, y) => Math.exp(-((x - 10) ** 2 + y * y) / 150) - 0.6 * Math.exp(-((x + 25) ** 2 + (y - 15) ** 2) / 60) + 0.3 * Math.cos((2 * Math.PI * 5 * x) / n);
  const errs = [];
  for (const sign of [1, -1]) {
    for (const eps of [0.02, 0.01]) {
      const phi = new Float64Array(n * n);
      const t = phaseObject(n, (x, y) => eps * shape(x, y));
      let mean = 0;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { phi[j * n + i] = eps * shape(i - n / 2, n / 2 - j); mean += phi[j * n + i]; }
      mean /= n * n;
      const I = coherentImage(spectrum(t.re, t.im, n), pupil(n, { dot: { r: 0, phase: (sign * Math.PI) / 2, amp: 1 } }), n);
      let e = 0;
      for (let o = 0; o < n * n; o++) e = Math.max(e, Math.abs(I[o] - (1 + 2 * sign * (phi[o] - mean))));
      errs.push(e);
      assert(e < 2 * eps * eps, `sign ${sign}, eps ${eps}: error ${e}`);
    }
  }
  // The error is second order: halving phi divides it by 4.
  const ratio = errs[0] / errs[1];
  assert(ratio > 3.6 && ratio < 4.4, `error ratio ${ratio}`);
  return `max |I - (1 + 2 phi)| = ${errs[0].toExponential(2)} at max phi 0.026, ${errs[1].toExponential(2)} at half that (ratio ${ratio.toFixed(2)})`;
});

test('Zernike with an absorbing dot: I = a^2 + 2a(phi - <phi>) for small phi, contrast 1/a times higher', () => {
  const n = 64, eps = 0.005, a = 0.3, k = (2 * Math.PI * 4) / n;
  const t = phaseObject(n, (x) => eps * Math.cos(k * x));
  const I = coherentImage(spectrum(t.re, t.im, n), pupil(n, { dot: { r: 0, phase: Math.PI / 2, amp: a } }), n);
  let e = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) e = Math.max(e, Math.abs(I[j * n + i] - (a * a + 2 * a * eps * Math.cos(k * (i - n / 2)))));
  assert(e < 3 * eps * eps, `error ${e}`);
});

test('Abbe: a grating is resolved exactly when its first orders are inside the pupil (d = lambda / NA)', () => {
  const n = 128, dx = 0.1, lambda = 0.55;
  for (const profile of ['cosine', 'bars']) {
    for (const m of [8, 13, 20]) {
      const t = encode(grating(n, m, profile), 'amplitude', 1, 0);
      const T = spectrum(t.re, t.im, n), d = (n * dx) / m;
      const NA = lambda / d, R = NA * pxPerNA(n, dx, lambda);
      close(R, m, 1e-9, 'the first order sits at lambda/d');
      const below = stats(coherentImage(T, pupil(n, { cut: R * 0.98 }), n)).contrast;
      const at = stats(coherentImage(T, pupil(n, { cut: R }), n)).contrast;
      assert(below < 1e-10, `${profile} m=${m}: contrast ${below} with NA just below lambda/d`);
      assert(at > 0.6, `${profile} m=${m}: contrast ${at} with NA = lambda/d`);
    }
  }
});

test('the image of a grating through 0 and +-1 orders is a sinusoid of the same period', () => {
  const n = 128, m = 9;
  const t = encode(grating(n, m, 'bars'), 'amplitude', 1, 0);
  const I = coherentImage(spectrum(t.re, t.im, n), pupil(n, { cut: m + 0.5 }), n);
  const S = spectrum(I, null, n), c = (n / 2) * n + n / 2;
  // Intensity has frequencies 0, m and 2m only (2m from the +1 and -1 orders beating).
  let other = 0, total = 0;
  for (let i = 0; i < n; i++) {
    const f = i - n / 2, p = S.re[c + f] ** 2 + S.im[c + f] ** 2;
    total += p;
    if (![0, m, -m, 2 * m, -2 * m].includes(f)) other += p;
  }
  assert(other < 1e-24 * total, `power elsewhere ${other / total}`);
  assert(S.re[c + m] ** 2 > 1e-3 * total, 'the fundamental is there');
});

test('blocking the zero order of a sinusoidal amplitude grating doubles its frequency (dark field)', () => {
  const n = 64, m = 5;
  const t = field(n, (x) => 0.5 + 0.3 * Math.cos((2 * Math.PI * m * x) / n));
  const I = coherentImage(spectrum(t.re, t.im, n), pupil(n, { stop: 0 }), n);
  // E = 0.3 cos(kx), so I = 0.045 (1 + cos 2kx).
  let e = 0;
  for (let i = 0; i < n; i++) e = Math.max(e, Math.abs(I[(n / 2) * n + i] - 0.045 * (1 + Math.cos((4 * Math.PI * m * (i - n / 2)) / n))));
  assert(e < 1e-14, `error ${e}`);
  const S = spectrum(I, null, n), c = (n / 2) * n + n / 2;
  assert(Math.hypot(S.re[c + m], S.im[c + m]) < 1e-12 && Math.hypot(S.re[c + 2 * m], S.im[c + 2 * m]) > 0.1, 'only the doubled frequency');
});

test('oblique illumination resolves a grating twice as fine: 0 and +1 orders through a pupil of radius just over half', () => {
  const n = 128, m = 20;
  const t = encode(grating(n, m, 'cosine'), 'amplitude', 1, 0);
  const T = spectrum(t.re, t.im, n), P = pupil(n, { cut: 10.5 });
  const axial = stats(coherentImage(T, P, n)).contrast;
  const I = coherentImage(T, P, n, -10, 0);
  const tilted = stats(I).contrast;
  assert(axial < 1e-10 && tilted > 0.8, `axial ${axial}, tilted ${tilted}`);
  // The fringes have the grating's own period (one order beating with the zero order).
  const S = spectrum(I, null, n), c = (n / 2) * n + n / 2;
  assert(Math.hypot(S.re[c + m], S.im[c + m]) > 0.1 && Math.hypot(S.re[c + 2 * m], S.im[c + 2 * m]) < 1e-12, 'period d');
  return `contrast ${axial.toExponential(1)} on axis, ${tilted.toFixed(3)} tilted`;
});

test('the incoherent OTF is the normalised autocorrelation of the pupil (asymmetric, complex pupil)', () => {
  const n = 32;
  const P = pupil(n, { cut: 6, knife: { e: -2, angle: 0.4 }, dot: { r: 1.5, phase: 1, amp: 0.4 }, defocus: 0.05 });
  // Add a lump off to one side so that nothing is symmetric.
  P.re[(n / 2 - 3) * n + n / 2 + 4] = 0.7; P.im[(n / 2 - 3) * n + n / 2 + 4] = -0.2;
  const O = otf(P, n);
  let worst = 0, norm = 0;
  for (let o = 0; o < n * n; o++) norm += P.re[o] ** 2 + P.im[o] ** 2;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    // sum_g P(g) P*(g - f), f = pixel (i, j) relative to the centre, indices wrapping.
    const fi = i - n / 2, fj = j - n / 2;
    let ar = 0, ai = 0;
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
      const g = b * n + a, h = (((b - fj) % n + n) % n) * n + (((a - fi) % n + n) % n);
      ar += P.re[g] * P.re[h] + P.im[g] * P.im[h];
      ai += P.im[g] * P.re[h] - P.re[g] * P.im[h];
    }
    worst = Math.max(worst, Math.hypot(O.re[j * n + i] - ar / norm, O.im[j * n + i] - ai / norm));
  }
  assert(worst < 1e-12, `largest difference ${worst}`);
  return `agree to ${worst.toExponential(1)}`;
});

test('partial coherence: one direction is the coherent image; every direction is the incoherent image', () => {
  const n = 32, r = rng(11), t = field(n, () => [r(), r()]);
  const T = spectrum(t.re, t.im, n), P = pupil(n, { cut: 5, stop: 1 });
  const part = new PartialImage(n);
  part.start(T, P, [[2, -1]]);
  close(maxAbs(part.run(), coherentImage(T, P, n, 2, -1)), 0, 1e-15, 'one direction');
  const all = [];
  for (let b = -n / 2; b < n / 2; b++) for (let a = -n / 2; a < n / 2; a++) all.push([a, b]);
  part.start(T, P, all);
  const Ip = part.run(), Ii = incoherentImage(intensitySpectrum(t, n), otf(P, n), n);
  const scale = sumSq(P) / (n * n);   // the mean over directions of |P(s)|^2
  let worst = 0;
  for (let o = 0; o < n * n; o++) worst = Math.max(worst, Math.abs(Ip[o] - scale * Ii[o]));
  assert(worst < 1e-12, `${worst}`);
  return `the sum over all ${all.length} directions matches the OTF image to ${worst.toExponential(1)}`;
});

test('incoherent images never overshoot (|h|^2 >= 0); coherent edges ring by about 18% (Gibbs)', () => {
  const n = 256;
  const t = encode(edge(n), 'amplitude', 1, 0), T = spectrum(t.re, t.im, n);
  const P = pupil(n, { cut: 30 });
  const coh = stats(coherentImage(T, P, n)), inc = stats(incoherentImage(intensitySpectrum(t, n), otf(P, n), n));
  // A straight edge has only fy = 0 frequencies: E = 1/2 + Si(2 pi fc x)/pi, whose peak is
  // 1.0895, so I peaks at 1.187 (on the grid, a sum over 61 frequencies, 1.189).
  assert(coh.max > 1.16 && coh.max < 1.19, `coherent peak ${coh.max}`);
  assert(inc.max <= 1 + 1e-12 && inc.min >= -1e-12, `incoherent from ${inc.min} to ${inc.max}`);
  return `coherent peak ${coh.max.toFixed(4)}, incoherent peak ${inc.max.toFixed(6)}`;
});

test('defocus of a weak phase grating: I = 1 + 2 eps sin(pi lambda z / d^2) cos(2 pi x / d)', () => {
  const n = 128, dx = 0.1, lambda = 0.55, m = 16, d = (n * dx) / m, eps = 0.003;
  const t = phaseObject(n, (x) => eps * Math.cos((2 * Math.PI * m * x) / n)), T = spectrum(t.re, t.im, n);
  const df = 1 / (n * dx);
  for (const z of [-2, 0.5, 1.5, 3]) {
    const I = coherentImage(T, pupil(n, { defocus: Math.PI * lambda * z * df * df }), n);
    const amp = 2 * eps * Math.sin((Math.PI * lambda * z) / (d * d));
    let e = 0;
    for (let i = 0; i < n; i++) e = Math.max(e, Math.abs(I[(n / 2) * n + i] - 1 - amp * Math.cos((2 * Math.PI * m * (i - n / 2)) / n)));
    assert(e < 2 * eps * eps, `z = ${z}: error ${e}`);
  }
});

test('a knife edge (Foucault) turns a weak phase grating into I = 1 - eps sin(kx): the gradient over k', () => {
  const n = 64, m = 6, eps = 0.004, k = (2 * Math.PI * m) / n;
  const t = phaseObject(n, (x) => eps * Math.cos(k * x));
  const I = coherentImage(spectrum(t.re, t.im, n), pupil(n, { knife: { e: 0, angle: 0 } }), n);
  let e = 0;
  for (let i = 0; i < n; i++) e = Math.max(e, Math.abs(I[(n / 2) * n + i] - (1 - eps * Math.sin(k * (i - n / 2)))));
  assert(e < 2 * eps * eps, `error ${e}`);
});

test('Rayleigh: two incoherent points 0.61 lambda/NA apart dip by about 26% between them; coherent ones in phase do not', () => {
  // 0.61 lambda / NA = 8 pixels exactly: the pupil's radius is NA / lambda = 0.61 n / 8 pixels.
  const n = 256, sep = 8, R = (0.61 * n) / sep;
  const t = twoPoints(n, sep, 0), T = spectrum(t.re, t.im, n), P = pupil(n, { cut: R });
  const row = (I) => I.subarray((n / 2) * n, (n / 2 + 1) * n);
  const inc = row(incoherentImage(intensitySpectrum(t, n), otf(P, n), n));
  const i1 = n / 2 - Math.floor(sep / 2), mid = i1 + sep / 2;
  const peak = Math.max(...inc.subarray(i1 - 2, i1 + 3));
  const dip = 1 - inc[mid] / peak;
  // 26.5% for an Airy pattern (the pupil here is a disk of pixels, radius 19.5).
  assert(dip > 0.25 && dip < 0.28, `incoherent dip ${dip}`);
  const coh = row(coherentImage(T, P, n));
  const cdip = 1 - coh[mid] / Math.max(...coh.subarray(i1 - 2, i1 + 3));
  assert(cdip < 0.01, `coherent, in phase: dip ${cdip}`);
  const anti = twoPoints(n, sep, Math.PI), A = row(coherentImage(spectrum(anti.re, anti.im, n), P, n));
  assert(A[mid] < 1e-20, 'coherent, opposite phases: dark between');
  return `incoherent dip ${(100 * dip).toFixed(1)}%, coherent in-phase ${(100 * cdip).toFixed(1)}%`;
});

test('sourcePoints fills the condenser disk, centre first, at most maxPoints', () => {
  const p = sourcePoints(12.3, 2, -1, 40);
  assert(p.length <= 40 && p.length >= 20, `${p.length} points`);
  assert(p[0][0] === 2 && p[0][1] === -1, 'centre first');
  for (const [x, y] of p) assert(Math.hypot(x - 2, y + 1) <= 12.3 + 1e-9, 'inside');
  assert(sourcePoints(0.3).length === 1, 'a point source');
  close(sourcePoints(3, 0, 0, 100).length, 29, 0, 'every pixel of a small disk');
});

test('the shapes: a snapped grating period, ink in 0..1, gratings that are exact orders', () => {
  const n = 128, dx = 0.1;
  const s = snapPeriod(1.0, n, dx);
  close(s.d * s.m, n * dx, 1e-12, 'whole periods');
  for (const g of [grating(n, 7, 'bars'), siemensStar(n, dx), barTarget(n, dx).g, cells(n, dx), diatom(n, dx), edge(n)]) {
    let lo = Infinity, hi = -Infinity;
    for (const v of g) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    assert(lo >= -1e-12 && hi <= 1 + 1e-12 && hi - lo > 0.5, `ink from ${lo} to ${hi}`);
  }
  // The bar grating's spectrum lives on multiples of m only.
  const m = 7, t = encode(grating(n, m, 'bars'), 'amplitude', 1, 0), T = spectrum(t.re, t.im, n);
  let off = 0, on = 0;
  for (let o = 0; o < n * n; o++) {
    const i = (o % n) - n / 2, j = Math.floor(o / n) - n / 2, p = T.re[o] ** 2 + T.im[o] ** 2;
    if (j === 0 && i % m === 0) on += p; else off += p;
  }
  assert(off < 1e-20 * on, `power off the orders ${off / on}`);
  // encode: phase keeps |t| = 1, amplitude keeps t real.
  const g = cells(64, dx), ph = encode(g, 'phase', 1, 0.8), am = encode(g, 'amplitude', 0.5, 0.8);
  for (let o = 0; o < g.length; o++) {
    assert(Math.abs(Math.hypot(ph.re[o], ph.im[o]) - 1) < 1e-14 && am.im[o] === 0, 'encodings');
  }
});

test('tilting the light shifts the spectrum: the zero order moves to s', () => {
  const n = 32, t = field(n, () => 1), T = spectrum(t.re, t.im, n);
  const Ts = shifted(T, n, 3, 5);
  // f = (3, 5) is pixel (n/2 + 3, n/2 - 5).
  close(Ts.re[(n / 2 - 5) * n + n / 2 + 3], n, 1e-12, 'zero order at s');
  // and the image of clear glass is still uniform (a tilted plane wave), I = 1.
  const I = intensity(coherentField(T, pupil(n, { cut: 8 }), n, 3, 5));
  assert(Math.abs(stats(I).max - 1) < 1e-12 && Math.abs(stats(I).min - 1) < 1e-12, 'uniform');
});
