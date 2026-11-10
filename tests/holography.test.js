import { test, assert, close } from './harness.js';
import {
  field, pointWave, planeWave, sphericalWave, pictureWave, diffuser, record, quantize, lens, look,
  viewImage, spectrum, images, termWave, rayAt, islandBoxes, overlaps,
  pointDescription, planeDescription, sphereDescription, criticalDistance,
} from '../holography/holo.js';
import { propagate } from '../diffraction/optics.js';

// The demo's camera: 256 x 256 pixels of 5 um, HeNe light.  Lengths in micrometres.
const n = 256, p = 5, lambda = 0.633, h = n / 2;
const dU = lambda / (n * p);               // one display pixel, in radians of direction

const hologram = (O, R) => record(O, R, new Float64Array(n * n));
/** The camera view (intensities on the display grid) of hologram H lit by C, focused at d. */
function view(H, C, d, { lam = lambda, win = null } = {}) {
  const eye = look(H, C, lens(n, p, lam, d), n, p, win, field(n));
  return viewImage(eye, n, d, lam / lambda);
}
const sum = (a) => a.reduce((s, v) => s + v, 0);
function peak(I) {
  let best = 0, at = 0;
  for (let o = 0; o < I.length; o++) if (I[o] > best) { best = I[o]; at = o; }
  return { I: best, i: at % n, j: Math.floor(at / n) };
}
/** Intensity-weighted centre of the (2r+1)^2 pixels around (i, j). */
function centroid(I, i, j, r = 3) {
  let s = 0, si = 0, sj = 0;
  for (let b = j - r; b <= j + r; b++) for (let a = i - r; a <= i + r; a++) { const v = I[b * n + a]; s += v; si += v * a; sj += v * b; }
  return [si / s, sj / s];
}
function corr(A, B, box) {
  const [i0, j0, i1, j1] = box;
  let ma = 0, mb = 0, m = 0;
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { ma += A[j * n + i]; mb += B[j * n + i]; m++; }
  ma /= m; mb /= m;
  let ab = 0, aa = 0, bb = 0;
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
    const a = A[j * n + i] - ma, b = B[j * n + i] - mb; ab += a * b; aa += a * a; bb += b * b;
  }
  return ab / Math.sqrt(aa * bb);
}
/** A letter F, 2 samples of soft edge, w samples wide, centred: brightness 0..1. */
function letterF(w) {
  const t = { re: new Float64Array(n * n), im: null }, s = w / 5;
  const inside = (x, y) => (x >= -2.5 * s && x < -1.5 * s && Math.abs(y) <= 2.5 * s)      // stem
    || (y > 1.5 * s && y <= 2.5 * s && x >= -2.5 * s && x <= 2.5 * s)                   // top bar
    || (y > -0.5 * s && y <= 0.5 * s && x >= -2.5 * s && x <= 1.5 * s);                   // middle bar
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let v = 0;   // 3 x 3 supersampling: soft edges
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) v += inside(i - h + a / 3, h - j + b / 3);
    t.re[j * n + i] = v / 9;
  }
  return t;
}
function withDiffuser(t, seed = 7) {
  const D = diffuser(n, seed), out = field(n);
  for (let o = 0; o < n * n; o++) { const a = Math.sqrt(t.re[o]); out.re[o] = a * D.re[o]; out.im[o] = a * D.im[o]; }
  return out;
}
function scaleTo(O, rms) {
  let s = 0; for (let o = 0; o < n * n; o++) s += O.re[o] ** 2 + O.im[o] ** 2;
  const g = rms / Math.sqrt(s / (n * n));
  for (let o = 0; o < n * n; o++) { O.re[o] *= g; O.im[o] *= g; }
  return O;
}

test('the hologram of a point is a zone plate: bright and dark rings at r_n = sqrt(n lambda z)', () => {
  const z = 30000, a = 0.2;
  const O = pointWave(n, p, lambda, { x: 0, y: 0, z, a }, field(n));
  const R = planeWave(n, p, lambda, 0, field(n));
  const H = hologram(O, R);
  // Along the row through the middle: extrema by a parabola through three samples.
  const row = H.subarray(h * n, h * n + n);
  const radii = [];
  for (let i = h + 1; i < n - 1; i++) {
    const [l, c, r] = [row[i - 1], row[i], row[i + 1]];
    if ((c > l && c >= r) || (c < l && c <= r)) radii.push(((i - h) + (0.5 * (l - r)) / (l - 2 * c + r)) * p);
  }
  let worst = 0;
  radii.forEach((rho, m) => { worst = Math.max(worst, Math.abs(rho - Math.sqrt((m + 1) * lambda * z))); });
  assert(radii.length >= 20, `found ${radii.length} rings`);
  assert(worst < 0.1 * p, `worst ring radius error ${worst.toFixed(3)} um`);
  // The middle is bright: the point's light and the reference arrive in step.
  assert(row[h] > row[h + 4], 'bright centre');
  return `${radii.length} rings out to ${radii.at(-1).toFixed(0)} um, worst error ${(worst / p).toFixed(3)} pixel`;
});

test('lit again, a point hologram focuses at the recording distance, behind (virtual) and in front (real)', () => {
  const pt = { x: 100, y: -60, z: 40000, a: 0.3 };
  const H = hologram(pointWave(n, p, lambda, pt, field(n)), planeWave(n, p, lambda, 0, field(n)));
  const ds = [0.8, 0.9, 0.95, 1, 1.05, 1.1, 1.25];
  const peaks = ds.map((s) => peak(view(H, null, s * pt.z)).I);
  const best = ds[peaks.indexOf(Math.max(...peaks))];
  assert(best === 1, `the sharpest focus is at ${best} z: peaks ${peaks.map((v) => v.toExponential(2))}`);
  // Where: x/z, y/z in display pixels.
  const I = view(H, null, pt.z), pk = peak(I), [ci, cj] = centroid(I, pk.i, pk.j);
  const want = [h + pt.x / pt.z / dU, h - pt.y / pt.z / dU];
  assert(Math.hypot(ci - want[0], cj - want[1]) < 0.25, `virtual image at (${ci.toFixed(2)}, ${cj.toFixed(2)}), expected (${want[0].toFixed(2)}, ${want[1].toFixed(2)})`);
  // The twin: the same zone plate also focuses light to a real image at z in front.
  const Ir = view(H, null, -pt.z), pr = peak(Ir), [ri, rj] = centroid(Ir, pr.i, pr.j);
  assert(Math.hypot(ri - want[0], rj - want[1]) < 0.25, `real image at (${ri.toFixed(2)}, ${rj.toFixed(2)})`);
  // In focus, the 3 x 3 pixels round the peak hold most of the image's own light: the term
  // O |R|^2 alone, which is a plate of transmission 1 lit by O.
  const O = pointWave(n, p, lambda, pt, field(n)), PO = sum(O.re.map((v, o) => v * v + O.im[o] ** 2));
  const Io = viewImage(look(new Float64Array(n * n).fill(1), O, lens(n, p, lambda, pt.z), n, p, null, field(n)), n, pt.z);
  let s3 = 0; for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) s3 += Io[(pk.j + b) * n + pk.i + a];
  assert(s3 > 0.7 * PO, `3 x 3 pixels hold ${s3 / PO} of the image's light`);
  return `the peak at d = z is ${(peaks[3] / peaks[0]).toFixed(1)}x the peak at 0.8 z; in focus, 3 x 3 pixels hold ${(100 * s3 / PO).toFixed(0)}% of the image's light`;
});

test('off axis: the image sideband of the transform sits at -sin(theta)/lambda, the twin at +sin(theta)/lambda', () => {
  const s = 0.04, z = 80000;
  const H = hologram(pointWave(n, p, lambda, { x: 0, y: 0, z, a: 0.3 }, field(n)), planeWave(n, p, lambda, Math.asin(s), field(n)));
  const F = spectrum(H, n);
  // Centroids of |F|^2 below and above the middle (rows away from the zero order).
  const cent = (j0, j1) => {
    let w = 0, wi = 0, wj = 0;
    for (let j = j0; j < j1; j++) for (let i = 0; i < n; i++) { const v = F.re[j * n + i] ** 2 + F.im[j * n + i] ** 2; w += v; wi += v * i; wj += v * j; }
    return [wi / w, wj / w];
  };
  const carrier = (s / lambda) * n * p;   // in bins
  const below = cent(h + 40, n), above = cent(1, h - 40);
  close(below[1], h + carrier, 0.3, 'image island row');
  close(above[1], h - carrier, 0.3, 'twin island row');
  close(below[0], h, 0.3, 'image island column');
  return `islands at rows ${below[1].toFixed(2)} and ${above[1].toFixed(2)}; sin(theta)/lambda is ${carrier.toFixed(2)} bins from the middle`;
});

test('power is conserved: angular-spectrum propagation, the Fresnel transform, and the camera view', () => {
  // optics.js, a band-limited field (nothing evanescent) on this grid, propagated 50 mm.
  const g = field(n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = (i - h) * p, y = (h - j) * p; g.re[j * n + i] = Math.exp(-(x * x + y * y) / (2 * 60 * 60)) * Math.cos(0.01 * x); }
  const P0 = sum(g.re.map((v, o) => v * v + g.im[o] ** 2));
  propagate(g.re, g.im, n, p, lambda, 50000);
  const P1 = sum(g.re.map((v, o) => v * v + g.im[o] ** 2));
  close(P1 / P0, 1, 1e-12, 'angular spectrum');
  // A picture to the plate: sum |O|^2 p^2 = sum |t|^2 dS^2.
  const z = 120000, dS = (lambda * z) / (n * p), t = withDiffuser(letterF(60));
  const O = pictureWave(t, n, p, lambda, z, field(n));
  const Pt = sum(t.re.map((v, o) => v * v + t.im[o] ** 2)) * dS * dS, PO = sum(O.re.map((v, o) => v * v + O.im[o] ** 2)) * p * p;
  close(PO / Pt, 1, 1e-12, 'Fresnel transform');
  // The camera view is unitary: the light through the window, all of it, somewhere.
  const H = hologram(O, planeWave(n, p, lambda, 0.03, field(n)));
  const win = { x: 100, y: -50, r: 300 }, L = lens(n, p, lambda, z);
  const eye = look(H, null, L, n, p, win, field(n));
  let Pin = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = (i - h) * p - win.x, y = (h - j) * p - win.y; if (x * x + y * y <= win.r * win.r) Pin += H[j * n + i] ** 2; }
  close(sum(eye.re.map((v, o) => v * v + eye.im[o] ** 2)) / Pin, 1, 1e-12, 'camera view');
});

test('the Fresnel transform of a picture agrees with angular-spectrum propagation (diffraction/optics.js)', () => {
  // A small, smooth picture 40 mm away; the angular spectrum on a grid twice as wide, so that
  // its light does not wrap around, then the middle n x n compared with the Fresnel transform.
  const z = 40000, dS = (lambda * z) / (n * p), m = 2 * n;
  const t = letterF(40);
  const O = pictureWave(t, n, p, lambda, z, field(n));
  // The same picture on the plate's grid (pitch p), by bilinear interpolation of its samples.
  const re = new Float64Array(m * m), im = new Float64Array(m * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const fx = h + ((i - m / 2) * p) / dS, fy = h + ((j - m / 2) * p) / dS, x0 = Math.floor(fx), y0 = Math.floor(fy);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= n || y0 + 1 >= n) continue;
    const tx = fx - x0, ty = fy - y0, T = (a, b) => t.re[b * n + a];
    re[j * m + i] = (T(x0, y0) * (1 - tx) + T(x0 + 1, y0) * tx) * (1 - ty) + (T(x0, y0 + 1) * (1 - tx) + T(x0 + 1, y0 + 1) * tx) * ty;
  }
  propagate(re, im, m, p, lambda, z);
  const A = new Float64Array(n * n), B = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const o = (j + n / 2) * m + i + n / 2;
    A[j * n + i] = re[o] ** 2 + im[o] ** 2; B[j * n + i] = O.re[j * n + i] ** 2 + O.im[j * n + i] ** 2;
  }
  // Also the phase: the overlap of the two complex fields.
  let ab = 0, abi = 0, aa = 0, bb = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const o = (j + n / 2) * m + i + n / 2, q = j * n + i;
    ab += re[o] * O.re[q] + im[o] * O.im[q]; abi += im[o] * O.re[q] - re[o] * O.im[q];
    aa += re[o] ** 2 + im[o] ** 2; bb += O.re[q] ** 2 + O.im[q] ** 2;
  }
  const overlap = Math.hypot(ab, abi) / Math.sqrt(aa * bb), c = corr(A, B, [0, 0, n, n]);
  assert(overlap > 0.98 && c > 0.98, `field overlap ${overlap}, intensity correlation ${c}`);
  return `overlap of the fields ${overlap.toFixed(4)}, of the intensities ${c.toFixed(4)}`;
});

test('a flat picture is reconstructed at the right focus, and only there', () => {
  // The carrier n/4 bins from the middle: the twin, leaving at twice the angle, folds back
  // (past the largest angle, lambda/2p) to the far edge, clear of the image.
  const z = 150000, s = lambda / (4 * p), w = 70;
  const t = letterF(w), td = withDiffuser(t);
  const O = scaleTo(pictureWave(td, n, p, lambda, z, field(n)), 0.3);
  const R = planeWave(n, p, lambda, Math.asin(s), field(n));
  const H = hologram(O, R);
  const box = [h - w / 2 - 4, h - w / 2 - 4, h + w / 2 + 4, h + w / 2 + 4];
  const scan = [0.7, 0.85, 0.95, 1, 1.05, 1.15, 1.3, 2].map((s) => corr(view(H, R, s * z), t.re, box));
  const c = scan[3];
  assert(c > 0.95, `correlation in focus ${c}`);
  assert(scan.every((v, a) => a === 3 || v < c), `the best focus is at z: ${scan.map((v) => v.toFixed(3))}`);
  // In line, the twin lies on top of the image.
  const R0 = planeWave(n, p, lambda, 0, field(n)), c0 = corr(view(hologram(O, R0), R0, z), t.re, box);
  assert(c0 < c - 0.1, `in line ${c0}, off axis ${c}`);
  return `correlation with the picture at d/z = 0.7 ... 2: ${scan.map((v) => v.toFixed(3)).join(', ')}; in line (twin on top) ${c0.toFixed(3)}`;
});

test('cut the hologram of a diffuse picture: the whole picture survives', () => {
  const z = 150000, s = lambda / (4 * p), w = 70;
  const t = letterF(w);
  const O = scaleTo(pictureWave(withDiffuser(t), n, p, lambda, z, field(n)), 0.3);
  const R = planeWave(n, p, lambda, Math.asin(s), field(n));
  const H = hologram(O, R);
  const box = [h - w / 2 - 4, h - w / 2 - 4, h + w / 2 + 4, h + w / 2 + 4];
  // Cover all but a quarter of the plate's width (1/16 of its area), off centre.
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (!(i >= 40 && i < 104 && j >= 150 && j < 214)) H[j * n + i] = 0;
  const I = view(H, R, z);
  // Blur away the speckle (the resolution is 4 times coarser) before comparing.
  const B = new Float32Array(n * n);
  for (let j = 4; j < n - 4; j++) for (let i = 4; i < n - 4; i++) { let v = 0; for (let b = -4; b <= 4; b++) for (let a = -4; a <= 4; a++) v += I[(j + b) * n + i + a]; B[j * n + i] = v; }
  const c = corr(B, t.re, box);
  // Both halves of the letter are there.
  const half = (i0, i1) => { let v = 0; for (let j = box[1]; j < box[3]; j++) for (let i = i0; i < i1; i++) v += I[j * n + i] * t.re[j * n + i]; return v; };
  const left = half(box[0], h), right = half(h, box[2]);
  assert(c > 0.6, `correlation ${c}`);
  assert(left > 0.3 * right && right > 0.3 * left, `left ${left}, right ${right}`);
  return `a sixteenth of the plate: correlation with the picture ${c.toFixed(3)} (after averaging the speckle)`;
});

test('relit at another wavelength, the image moves to z lambda/lambda2 and its direction scales', () => {
  const pt = { x: 150, y: 90, z: 40000, a: 0.3 }, lam2 = 0.532;
  const H = hologram(pointWave(n, p, lambda, pt, field(n)), planeWave(n, p, lambda, 0, field(n)));
  const zz = (pt.z * lambda) / lam2;
  const ds = [0.9, 0.95, 1, 1.05, 1.1].map((s) => s * zz);
  const peaks = ds.map((d) => peak(view(H, null, d, { lam: lam2 })).I);
  assert(peaks.indexOf(Math.max(...peaks)) === 2, `peaks ${peaks.map((v) => v.toExponential(2))}`);
  const pred = images(pointDescription(pt), planeDescription(0), planeDescription(0), lam2 / lambda).image;
  close(pred.R, zz, 1e-6, 'images(): the distance');
  close(pred.x, pt.x, 1e-9, 'images(): the lateral position');
  const I = view(H, null, zz, { lam: lam2 }), pk = peak(I), [ci, cj] = centroid(I, pk.i, pk.j);
  const want = [h + pred.ux / dU, h - pred.uy / dU];
  assert(Math.hypot(ci - want[0], cj - want[1]) < 0.35, `image at (${ci.toFixed(2)}, ${cj.toFixed(2)}), expected (${want[0].toFixed(2)}, ${want[1].toFixed(2)})`);
  return `focus at ${(zz / 1000).toFixed(2)} mm instead of 40 mm; drawn at (${(ci - h).toFixed(2)}, ${(h - cj).toFixed(2)}) pixels, predicted (${(want[0] - h).toFixed(2)}, ${(h - want[1]).toFixed(2)})`;
});

test('lit by the conjugate reference, the hologram makes a real image in front of the plate', () => {
  const pt = { x: -120, y: 80, z: 60000, a: 0.3 }, th = Math.asin(0.04);
  const R = planeWave(n, p, lambda, th, field(n)), Rc = planeWave(n, p, lambda, th, field(n), true);
  const H = hologram(pointWave(n, p, lambda, pt, field(n)), R);
  const pred = images(pointDescription(pt), planeDescription(th), planeDescription(th, true), 1).twin;
  close(pred.R, -pt.z, 1e-6, 'images(): in front, at z');
  const ds = [-0.9, -1, -1.1].map((s) => s * pt.z);
  const peaks = ds.map((d) => peak(view(H, Rc, d)).I);
  assert(peaks[1] > peaks[0] && peaks[1] > peaks[2], `peaks ${peaks.map((v) => v.toExponential(2))}`);
  const I = view(H, Rc, -pt.z), pk = peak(I), [ci, cj] = centroid(I, pk.i, pk.j);
  const want = [h + pt.x / pt.z / dU, h - pt.y / pt.z / dU];
  assert(Math.hypot(ci - want[0], cj - want[1]) < 0.25, `real image at (${ci.toFixed(2)}, ${cj.toFixed(2)}), expected (${want[0].toFixed(2)}, ${want[1].toFixed(2)})`);
});

test('a binary (thresholded) hologram still reconstructs the picture', () => {
  const z = 150000, s = lambda / (4 * p), w = 70, t = letterF(w);
  const O = scaleTo(pictureWave(withDiffuser(t), n, p, lambda, z, field(n)), 0.3);
  const R = planeWave(n, p, lambda, Math.asin(s), field(n));
  const box = [h - w / 2 - 4, h - w / 2 - 4, h + w / 2 + 4, h + w / 2 + 4];
  const H = quantize(hologram(O, R), 1);
  assert(H.every((v) => v === 0 || v === 1), 'only 0 and 1');
  const c = corr(view(H, R, z), t.re, box);
  const H4 = quantize(hologram(O, R), 4), c4 = corr(view(H4, R, z), t.re, box);
  assert(c > 0.8, `binary: correlation ${c}`);
  return `correlation with the picture: binary ${c.toFixed(3)}, 4 bits ${c4.toFixed(3)}`;
});

test('lensless Fourier hologram: with the reference point beside the object, the transform is the image', () => {
  const z = 60000, ref = { x: 0, y: 900, z };
  const pts = [{ x: -300, y: -200, z, a: 0.2 }, { x: 250, y: -400, z, a: 0.2 }];
  const O = field(n);
  for (const pt of pts) pointWave(n, p, lambda, pt, O, true);
  const F = spectrum(hologram(O, sphericalWave(n, p, lambda, ref, field(n))), n);
  const A = F.re.map((v, o) => v * v + F.im[o] ** 2);
  for (const pt of pts) {
    // O R* has the frequency (x_ref - x)/(lambda z): straight fringes, one spot each.
    const fi = h + ((ref.x - pt.x) / (lambda * z)) * n * p, fj = h - ((ref.y - pt.y) / (lambda * z)) * n * p;
    let best = 0, at = 0;
    for (let j = Math.round(fj) - 3; j <= Math.round(fj) + 3; j++) for (let i = Math.round(fi) - 3; i <= Math.round(fi) + 3; i++) if (A[j * n + i] > best) { best = A[j * n + i]; at = j * n + i; }
    const [ci, cj] = centroid(A, at % n, Math.floor(at / n), 2);
    assert(Math.hypot(ci - fi, cj - fj) < 0.5, `spot at (${ci.toFixed(2)}, ${cj.toFixed(2)}), expected (${fi.toFixed(2)}, ${fj.toFixed(2)})`);
    // A sharp spot: most of the island's power in a few bins.
    let near = 0, island = 0;
    for (let j = Math.round(fj) - 12; j <= Math.round(fj) + 12; j++) for (let i = Math.round(fi) - 12; i <= Math.round(fi) + 12; i++) {
      island += A[j * n + i]; if (Math.hypot(i - ci, j - cj) < 2.5) near += A[j * n + i];
    }
    assert(near > 0.7 * island, `spot holds ${near / island} of its island`);
  }
});

test('the image equations predict the focus for a spherical reference and a different illumination', () => {
  // Record with a point reference; light with a point source somewhere else and another colour.
  const pt = { x: 200, y: -100, z: 50000, a: 0.3 }, ref = { x: 0, y: -1500, z: 80000 }, ill = { x: 0, y: -1500, z: 120000 }, lam2 = 0.55;
  const H = hologram(pointWave(n, p, lambda, pt, field(n)), sphericalWave(n, p, lambda, ref, field(n)));
  const C = sphericalWave(n, p, lam2, ill, field(n));
  const pred = images(pointDescription(pt), sphereDescription(ref), sphereDescription(ill), lam2 / lambda).image;
  const ds = [0.9, 0.95, 1, 1.05, 1.1].map((s) => s * pred.R);
  const peaks = ds.map((d) => peak(view(H, C, d, { lam: lam2 })).I);
  assert(peaks.indexOf(Math.max(...peaks)) === 2, `focus scan around ${pred.R.toFixed(0)}: ${peaks.map((v) => v.toExponential(2))}`);
  const I = view(H, C, pred.R, { lam: lam2 }), pk = peak(I), [ci, cj] = centroid(I, pk.i, pk.j);
  const want = [h + pred.ux / dU, h - pred.uy / dU];
  assert(Math.hypot(ci - want[0], cj - want[1]) < 0.5, `image at (${ci.toFixed(2)}, ${cj.toFixed(2)}), predicted (${want[0].toFixed(2)}, ${want[1].toFixed(2)})`);
  return `predicted image ${(pred.R / 1000).toFixed(2)} mm behind the plate at (${pred.x.toFixed(0)}, ${pred.y.toFixed(0)}) um; found there`;
});

test('parallax: through a window that moves, a near point and a far point slide past each other', () => {
  const near = { x: 0, y: 0, z: 40000, a: 0.3 }, far = { x: 0, y: 0, z: 80000, a: 0.3 }, d = 53333;
  const O = field(n); pointWave(n, p, lambda, near, O); pointWave(n, p, lambda, far, O, true);
  // Off axis, so that the zero order (as bright as both points together, through a small
  // window) is out of the way.
  const R = planeWave(n, p, lambda, Math.asin(0.04), field(n));
  const H = hologram(O, R);
  // Separate the two spots by where each is predicted (their blur centres), then measure.
  const at = (xw) => {
    const I = view(H, R, d, { win: { x: xw, y: 0, r: 150 } });
    return [near, far].map((pt) => {
      const u = xw / d + (pt.x - xw) / pt.z, i = Math.round(h + u / dU);
      let best = 0, bi = i;
      for (let a = i - 3; a <= i + 3; a++) if (I[h * n + a] > best) { best = I[h * n + a]; bi = a; }
      return centroid(I, bi, h, 3)[0];
    });
  };
  const L = at(-450), Rr = at(450);
  const moveNear = Rr[0] - L[0], moveFar = Rr[1] - L[1];
  const predNear = (900 * (1 / d - 1 / near.z)) / dU, predFar = (900 * (1 / d - 1 / far.z)) / dU;
  assert(Math.sign(moveNear) === -Math.sign(moveFar), `they move the opposite ways: ${moveNear}, ${moveFar}`);
  close(moveNear, predNear, 1, 'near point');
  close(moveFar, predFar, 1, 'far point');
  return `moving the window 0.9 mm: the near point moves ${moveNear.toFixed(1)} pixels (predicted ${predNear.toFixed(1)}), the far one ${moveFar.toFixed(1)} (${predFar.toFixed(1)})`;
});

test('sampling: the plate records fringes down to two pixels; a point closer than n p^2/lambda overfills it', () => {
  const zc = criticalDistance(n, p, lambda);
  close(zc, (n * p * p) / lambda, 1e-9);
  // The largest reference angle: fringes of period lambda / sin(theta) = 2 p.
  const H = hologram(field(n), planeWave(n, p, lambda, Math.asin(lambda / (2 * p)), field(n)));
  assert(H.every((v) => Math.abs(v - 1) < 1e-12), 'a plane wave alone is uniform');
  const Rq = planeWave(n, p, lambda, Math.asin(lambda / (2 * p)), field(n));
  const row = Rq.re.filter((_, o) => o % n === 0);   // the first column, going down
  for (let j = 0; j + 2 < n; j++) close(row[j], row[j + 2], 1e-9, 'period two pixels');
  return `n p^2/lambda = ${(zc / 1000).toFixed(2)} mm`;
});

test("tilt the reference: the rings' centre moves up to z tan(theta), where the point's light arrives parallel to it", () => {
  const z = 60000, th = 0.3 * Math.PI / 180;
  const H = hologram(pointWave(n, p, lambda, { x: 0, y: 0, z, a: 0.3 }, field(n)), planeWave(n, p, lambda, th, field(n)));
  // The middle column, folded about y0, matches itself best at the centre of the rings.
  const at = (y) => { const j = Math.floor(y), t = y - j; return H[j * n + h] * (1 - t) + H[(j + 1) * n + h] * t; };
  let m = 0; for (let j = 0; j < n; j++) m += H[j * n + h] / n;
  let best = -Infinity, arg = 0;
  for (let y = 40; y <= 120; y += 0.05) { let c = 0; for (let k = 1; k <= 40; k++) c += (at(y + k) - m) * (at(y - k) - m); if (c > best) { best = c; arg = y; } }
  const y0 = (h - arg) * p, want = z * Math.tan(th);
  close(y0, want, 0.5 * p, 'centre of the rings, um above the middle');
  return `centred ${y0.toFixed(1)} um above the middle; z tan(theta) = ${want.toFixed(1)} um`;
});

test('islands: one point, the image and twin islands part at sin(theta) = L/2z; a picture, at B and B + W/z', () => {
  const L = n * p, hl = L / 2, z = 60000, pt = [pointDescription({ x: 0, y: 0, z })];
  const s0 = hl / z, at = (s) => islandBoxes(pt, planeDescription(Math.asin(s)), hl);
  assert(overlaps(at(0.99 * s0).image, at(0.99 * s0).twin) && !overlaps(at(1.01 * s0).image, at(1.01 * s0).twin), 'one point: apart at L/2z');
  // A point has no |O|^2 island (it does not interfere with itself): a box of no size.
  assert(at(s0).auto.every((v) => v === 0), 'one point: no |O|^2');
  // A picture W wide at z, lit through ground glass: each corner lights the whole plate.
  const W = 2000, Z = 120000, c = [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b]) => pointDescription({ x: a * W / 2, y: b * W / 2, z: Z }));
  const B = (W + L) / (2 * Z), A = W / Z, box = (s) => islandBoxes(c, planeDescription(Math.asin(s)), hl);
  close(box(0.03).image[3] - box(0.03).image[2], 2 * B, 1e-12, 'image island 2B tall');
  close(box(0.03).auto[3], A, 1e-12, '|O|^2 island reaches W/z');
  assert(overlaps(box(0.99 * B).image, box(0.99 * B).twin) && !overlaps(box(1.01 * B).image, box(1.01 * B).twin), 'twin clears at B');
  assert(overlaps(box(0.99 * (B + A)).image, box(0.99 * (B + A)).auto) && !overlaps(box(1.01 * (B + A)).image, box(1.01 * (B + A)).auto), 'haze clears at B + W/z');
  // Points at different depths: their |O|^2 fringes do depend on where on the plate.
  const two = [pointDescription({ x: 0, y: 0, z: 50000 }), pointDescription({ x: 0, y: 0, z: 130000 })];
  close(islandBoxes(two, planeDescription(0.03), hl).auto[3], hl * (1 / 50000 - 1 / 130000), 1e-12, 'two depths: |O|^2 reaches L/2 |1/z1 - 1/z2|');
  const deg = (v) => (Math.asin(v) * 180 / Math.PI).toFixed(3);
  return `one point at 60 mm: ${deg(s0)} deg; the F (2 mm at 120 mm): twin clear at ${deg(B)} deg, haze at ${deg(B + A)} deg`;
});

test('how steep: an object spread over +-lambda/8p fits between the middle island and the edge at sin(theta) = 3 lambda/8p, and no wider one does', () => {
  // A picture much bigger than the plate (so B = (W + L)/2z is nearly W/2z), lit through ground glass.
  const L = n * p, hl = L / 2, Z = 1e6, sMax = lambda / (2 * p);
  const fits = (B, s) => {
    const W = 2 * Z * B - L, c = [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b]) => pointDescription({ x: a * W / 2, y: b * W / 2, z: Z }));
    const box = islandBoxes(c, planeDescription(Math.asin(s)), hl);
    return !overlaps(box.image, box.auto) && !overlaps(box.image, box.twin) && Math.max(...box.image.map(Math.abs)) <= sMax * (1 + 1e-9);
  };
  const B0 = lambda / (8 * p);
  assert(fits(0.999 * B0, 3 * B0), `B = lambda/8p fits at sin(theta) = 3 lambda/8p`);
  let any = false;
  for (let s = 0; s <= sMax; s += sMax / 2000) any = any || fits(1.03 * B0, s);
  assert(!any, 'a 3% wider object fits at no angle');
  return `lambda/8p = ${(1000 * B0).toFixed(1)} mrad, at sin(theta) = ${(3000 * B0).toFixed(1)} mrad (${(Math.asin(3 * B0) * 180 / Math.PI).toFixed(2)} deg)`;
});

test('the lens, worked out once for each distance from the middle, is exp(-i sign(d) k (sqrt(r^2 + d^2) - |d|))', () => {
  const k = 2 * Math.PI / lambda;
  let worst = 0;
  for (const d of [60000, -50000, 12000, -3000]) {
    const L = lens(n, p, lambda, d), s = lambda / (2 * p), rmax = Math.abs(d) * s / Math.sqrt(1 - s * s);
    for (const [i, j] of [[h, h], [h + 37, h - 5], [3, 250], [0, 0], [255, 128], [h - 90, h + 77]]) {
      const x = (i - h) * p, y = (h - j) * p, r = Math.hypot(x, y), o = j * n + i;
      if (r > rmax - 4 * p) { assert(Math.hypot(L.re[o], L.im[o]) <= 1 + 1e-12, 'no gain at the edge'); continue; }
      const ph = -Math.sign(d) * k * (Math.sqrt(r * r + d * d) - Math.abs(d));
      worst = Math.max(worst, Math.hypot(L.re[o] - Math.cos(ph), L.im[o] - Math.sin(ph)));
    }
  }
  assert(worst < 1e-5, `${worst}`);
  return `agrees to ${worst.toExponential(1)}`;
});

test("the beams of the side view: the rays of an image meet at its focus; a plane wave's rays are parallel", () => {
  const pt = { x: 120, y: -200, z: 60000 }, O = pointDescription(pt), R = planeDescription(Math.asin(0.02)), m = 532 / 633;
  for (const sg of [1, -1]) {
    const w = termWave(O, R, R, m, sg), f = images(O, R, R, m)[sg > 0 ? 'image' : 'twin'];
    for (const r of [-640, -100, 0, 333, 640]) close(rayAt(w, r, -f.R), f.y, 1e-9, `ray from ${r} at the focus`);
  }
  const C = planeDescription(Math.asin(0.02));
  for (const r of [-640, 0, 640]) close(rayAt(C, r, 50000) - r, 0.02 * 50000, 1e-9, 'plane wave: slope sin(theta)');
});

test('relit at another wavelength with a plane wave, the image is as big as before, but lambda1/lambda2 as far', () => {
  const R = planeDescription(Math.asin(0.035)), m = 532 / 633, z = 150000;
  const top = images(pointDescription({ x: 0, y: 2000, z }), R, R, m).image, bot = images(pointDescription({ x: 0, y: -2000, z }), R, R, m).image;
  close(top.y - bot.y, 4000, 1e-9, 'the same size');
  close(top.R, z / m, 1e-6, 'farther, by lambda1/lambda2');
  close((top.uy + bot.uy) / 2, -(1 - m) * 0.035, 1e-12, 'moved towards the zero order by (1 - mu) sin(theta)');
  return `4 mm tall either way, at ${(top.R / 1000).toFixed(1)} mm; it looks ${m.toFixed(3)} as big, and ${((1 - m) * 35).toFixed(2)} mrad lower`;
});

test('a binary zone plate has more foci: z/3 as well as z', () => {
  const z = 60000, O = pointWave(n, p, lambda, { x: 0, y: 0, z, a: 0.3 }, field(n)), R = planeWave(n, p, lambda, 0, field(n));
  const grey = hologram(O, R), bin = quantize(hologram(O, R), 1);
  const at = (H, d) => view(H, null, d)[h * n + h];
  const g = [17000, 20000, 23000].map((d) => at(grey, d)), b = [17000, 20000, 23000].map((d) => at(bin, d));
  assert(b[1] > 5 * b[0] && b[1] > 5 * b[2], `binary: a peak at z/3 (${b.map((v) => v.toExponential(2))})`);
  assert(b[1] > 10 * g[1], `the grey one has none there (${g[1].toExponential(2)} against ${b[1].toExponential(2)})`);
  return `at z/3 the binary plate's peak is ${(b[1] / g[1]).toFixed(0)} times the grey one's`;
});

test('lit by the conjugate, the real image of a point is straight in front of it, at the same distance', () => {
  for (const pt of [{ x: -300, y: 250, z: 50000 }, { x: 300, y: -200, z: 90000 }]) {
    const src = { x: 0, y: -1500, z: 70000 };
    for (const [R, C] of [[planeDescription(0.04), planeDescription(0.04, true)], [sphereDescription(src), sphereDescription(src, true)]]) {
      const real = images(pointDescription(pt), R, C, 1).twin;
      close(real.R, -pt.z, 1e-6, 'in front, at z'); close(real.x, pt.x, 1e-6, 'x'); close(real.y, pt.y, 1e-6, 'y');
    }
  }
});
