import { test, assert, close, maxAbsDiff } from './harness.js';
import { fft, ifft, fft2, fftCentered, fft2Centered, dft, wavenumbers } from '../lib/fft.js';

function randomComplex(n, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648) - 0.5;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) { re[i] = rnd(); im[i] = rnd(); }
  return [re, im];
}

test('fft matches the direct DFT for n = 1..256', () => {
  for (let n = 1; n <= 256; n *= 2) {
    const [re, im] = randomComplex(n, n);
    const [dr, di] = dft(re, im);
    fft(re, im);
    const err = Math.max(maxAbsDiff(re, dr), maxAbsDiff(im, di));
    assert(err < 1e-10 * n, `n=${n}: max error ${err}`);
  }
});

test('ifft undoes fft', () => {
  const [re, im] = randomComplex(1024, 7);
  const r0 = re.slice(), i0 = im.slice();
  fft(re, im); ifft(re, im);
  assert(Math.max(maxAbsDiff(re, r0), maxAbsDiff(im, i0)) < 1e-12);
});

test('fft2 matches row-then-column DFTs', () => {
  const nx = 8, ny = 4;
  const [re, im] = randomComplex(nx * ny, 3);
  const er = re.slice(), ei = im.slice();
  for (let y = 0; y < ny; y++) {
    const [r, i] = dft(er.slice(y * nx, y * nx + nx), ei.slice(y * nx, y * nx + nx));
    er.set(r, y * nx); ei.set(i, y * nx);
  }
  for (let x = 0; x < nx; x++) {
    const cr = new Float64Array(ny), ci = new Float64Array(ny);
    for (let y = 0; y < ny; y++) { cr[y] = er[y * nx + x]; ci[y] = ei[y * nx + x]; }
    const [r, i] = dft(cr, ci);
    for (let y = 0; y < ny; y++) { er[y * nx + x] = r[y]; ei[y * nx + x] = i[y]; }
  }
  fft2(re, im, nx, ny);
  assert(Math.max(maxAbsDiff(re, er), maxAbsDiff(im, ei)) < 1e-12);
});

test('centred unitary FFT: delta at the centre is flat, Parseval holds, inverse undoes', () => {
  const n = 64;
  const re = new Float64Array(n), im = new Float64Array(n);
  re[n / 2] = 1;
  fftCentered(re, im);
  for (let k = 0; k < n; k++) { close(re[k], 1 / Math.sqrt(n), 1e-14); close(im[k], 0, 1e-14); }
  const [a, b] = randomComplex(n, 11);
  const a0 = a.slice(), b0 = b.slice();
  let e0 = 0, e1 = 0;
  for (let i = 0; i < n; i++) e0 += a[i] ** 2 + b[i] ** 2;
  fftCentered(a, b);
  for (let i = 0; i < n; i++) e1 += a[i] ** 2 + b[i] ** 2;
  close(e1, e0, 1e-12, 'Parseval');
  fftCentered(a, b, true);
  assert(Math.max(maxAbsDiff(a, a0), maxAbsDiff(b, b0)) < 1e-13);
});

test('centred FFT of a shifted delta is a phase ramp exp(-i k x0)', () => {
  const n = 32, x0 = 3;
  const re = new Float64Array(n), im = new Float64Array(n);
  re[n / 2 + x0] = 1;
  fftCentered(re, im);
  for (let i = 0; i < n; i++) {
    const k = i - n / 2, a = (-2 * Math.PI * k * x0) / n;
    close(re[i], Math.cos(a) / Math.sqrt(n), 1e-14);
    close(im[i], Math.sin(a) / Math.sqrt(n), 1e-14);
  }
});

test('2D centred FFT of a centred Gaussian is a real centred Gaussian', () => {
  const n = 64, s = 4;
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    re[y * n + x] = Math.exp(-((x - n / 2) ** 2 + (y - n / 2) ** 2) / (2 * s * s));
  }
  fft2Centered(re, im, n, n);
  // Continuous-limit width in k-index units: n / (2 pi s).
  const sk = n / (2 * Math.PI * s), peak = re[(n / 2) * n + n / 2];
  for (const [dx, dy] of [[0, 0], [2, 0], [0, 3], [2, 2]]) {
    const v = re[(n / 2 + dy) * n + n / 2 + dx];
    close(v / peak, Math.exp(-(dx * dx + dy * dy) / (2 * sk * sk)), 1e-9);
    close(im[(n / 2 + dy) * n + n / 2 + dx], 0, 1e-12);
  }
});

test('wavenumbers are in FFT order', () => {
  const k = wavenumbers(8, 0.5), dk = 2 * Math.PI / 4;
  const want = [0, 1, 2, 3, -4, -3, -2, -1].map(i => i * dk);
  assert(maxAbsDiff(k, want) < 1e-15);
});

test('speed: 256x256 and 512x512 2D FFTs', () => {
  const out = [];
  for (const n of [256, 512]) {
    const [re, im] = randomComplex(n * n, 5);
    fft2(re, im, n, n);
    const reps = n === 256 ? 20 : 5, t0 = performance.now();
    for (let r = 0; r < reps; r++) fft2(re, im, n, n);
    out.push(`${n}^2: ${((performance.now() - t0) / reps).toFixed(2)} ms`);
  }
  return out.join(', ');
});
