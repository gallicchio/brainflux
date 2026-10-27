import { test, assert, close } from './harness.js';
import { propagate, sideView } from '../diffraction/optics.js';

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

test('the side view is the middle row of the propagated field', () => {
  const [re, im] = field((x, y) => (Math.abs(x) < 20 && Math.abs(y) < 60 ? 1 : 0));
  const zs = [0, 500, 2000];
  const sv = sideView(re, im, n, dx, lambda, zs);
  for (const [a, z] of zs.entries()) {
    const r = re.slice(), i = im.slice(); propagate(r, i, n, dx, lambda, z);
    let worst = 0, peak = 0;
    for (let x = 0; x < n; x++) { const o = (n / 2) * n + x, I = r[o] ** 2 + i[o] ** 2; worst = Math.max(worst, Math.abs(I - sv[a * n + x])); peak = Math.max(peak, I); }
    assert(worst < 1e-9 * peak, `z=${z}: ${worst}`);
  }
});
