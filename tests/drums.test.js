// Drums and billiards: the eigensolver against exact spectra, the time steppers' conservation
// laws, the spectroscopist's peaks against the eigensolver, Weyl's law, level statistics and
// the isospectral drums.
import { test, assert, close } from './harness.js';
import { domainOf, lowestModes, countBelow, applyLaplacian, toGrid } from '../drums/eigen.js';
import { Grid, Membrane, Billiard, packet, bump, randomState, Signal, findPeaks, ModeFilter, realPart, WINDOW_FWHM, energyStats } from '../drums/sim.js';
import { PRESETS, maskFromSdf, besselZeros, GWW, polygon } from '../drums/shapes.js';
import { hearShape, spacings, weyl, gridCorrected } from '../drums/counting.js';
import { synthesize } from '../drums/sound.js';
import { Ray } from '../drums/ray.js';
import { fft } from '../lib/fft.js';

const shape = (id, n, params = {}) => {
  const p = PRESETS[id], vals = Object.fromEntries(Object.entries(p.params).map(([k, v]) => [k, params[k] ?? v.value]));
  const geo = p.make(vals, 1 / (n - 1));
  return { geo, mask: maskFromSdf(n, geo.sdf) };
};
const modesOf = (id, n, count, params, vectors = 0) => {
  const { geo, mask } = shape(id, n, params);
  const dom = domainOf(mask, n, 1 / (n - 1));
  return { geo, mask, dom, ...lowestModes(dom, { count, vectors }) };
};

test('drums: the rectangle\'s grid eigenvalues are the exact products of sines', () => {
  const n = 64, { geo, values, dom } = modesOf('rectangle', n, 60, { a: 1, b: 0.6 });
  const exact = geo.discrete(60);
  let worst = 0;
  for (let k = 0; k < 60; k++) worst = Math.max(worst, Math.abs(values[k] / exact[k] - 1));
  assert(worst < 1e-10, `worst relative error ${worst}`);
  // Sylvester's law of inertia: exactly 60 eigenvalues below the midpoint of the next gap.
  const mid = 0.5 * (exact[59] + geo.discrete(61)[60]);
  if (geo.discrete(61)[60] > exact[59] * (1 + 1e-9)) assert(countBelow(dom, mid) === 60, 'inertia count');
  return `60 eigenvalues to ${worst.toExponential(1)}; the inertia count agrees`;
});

test('drums: the square\'s degenerate pairs (m, n), (n, m) are both found (blocks of four)', () => {
  const n = 48, { geo, values } = modesOf('square', n, 40, {});
  const exact = geo.discrete(40);
  let worst = 0;
  for (let k = 0; k < 40; k++) worst = Math.max(worst, Math.abs(values[k] / exact[k] - 1));
  assert(worst < 1e-10, `worst ${worst}`);
  close(values[1], values[2], 1e-9 * values[1], '(1,2) and (2,1)');
  return `40 eigenvalues, every pair, to ${worst.toExponential(1)}`;
});

test('drums: the rectangle converges to π²(m²/a² + n²/b²) as h², with the predicted coefficient', () => {
  // λ_h = Σ (4/h²) sin²(k h/2) = λ − (k_x⁴ + k_y⁴) h²/12 + O(h⁴).
  const notes = [];
  let prev = null;
  for (const n of [33, 65, 129]) {
    const h = 1 / (n - 1), a = 1, b = 0.5;
    const { values } = modesOf('rectangle', n, 12, { a, b });
    const cont = [];
    for (let m = 1; m < 8; m++) for (let k = 1; k < 5; k++) cont.push({ l: Math.PI ** 2 * (m * m / (a * a) + k * k / (b * b)), q: (m * Math.PI / a) ** 4 + (k * Math.PI / b) ** 4 });
    cont.sort((p, q) => p.l - q.l);
    const err = cont.slice(0, 12).map((c, i) => (values[i] - c.l) / c.l);
    // Leading coefficient check on the first mode.
    close((cont[0].l - values[0]) / (h * h), cont[0].q / 12, 0.02 * cont[0].q / 12, `n = ${n}: coefficient of h²`);
    const worst = Math.max(...err.map(Math.abs));
    if (prev) assert(prev / worst > 3.7 && prev / worst < 4.3, `halving h divides the error by ${(prev / worst).toFixed(2)}`);
    notes.push(`h = 1/${n - 1}: ${(worst * 100).toFixed(3)}%`);
    prev = worst;
  }
  return notes.join(', ');
});

test('drums: Bessel zeros', () => {
  close(besselZeros(0, 1)[0], 2.404825557695773, 1e-12, 'j01');
  close(besselZeros(1, 2)[1], 7.015586669815619, 1e-12, 'j12');
  close(besselZeros(5, 3)[2], 15.70017407971167, 1e-11, 'j53');
  close(besselZeros(20, 1)[0], 25.41714081407252, 1e-10, 'j20,1');
});

test('drums: the circle converges to (j_mk/R)² (staircase edge: about first order, averaging out)', () => {
  const notes = [], errs = [];
  for (const n of [49, 97, 193]) {
    const { geo, values } = modesOf('circle', n, 10, { R: 0.45 });
    const ex = geo.exact(values[9] * 1.2).map((e) => e.lambda);
    const err = Math.max(...values.slice(0, 10).map((v, i) => Math.abs(v / ex[i] - 1)));
    errs.push(err);
    notes.push(`R = ${Math.round(0.45 * (n - 1))}h: ${(err * 100).toFixed(2)}%`);
  }
  assert(errs[2] < errs[0] / 2.5, 'the error falls as the grid is refined');
  assert(errs[2] < 0.004, `finest grid within 0.4% (${errs[2]})`);
  return 'worst of the first 10: ' + notes.join(', ');
});

test('drums: the equilateral triangle converges to (16π²/9s²)(m² + mn + n²)', () => {
  const notes = [], errs = [];
  for (const n of [49, 97, 193]) {
    const { geo, values } = modesOf('triangle', n, 8, { s: 0.9 });
    const ex = geo.exact(values[7] * 1.3).map((e) => e.lambda);
    const err = Math.max(...values.slice(0, 8).map((v, i) => Math.abs(v / ex[i] - 1)));
    errs.push(err); notes.push(`n = ${n}: ${(err * 100).toFixed(2)}%`);
  }
  assert(errs[2] < errs[0] / 2 && errs[2] < 0.01, `errors ${errs}`);
  return notes.join(', ');
});

test('drums: the two GWW drums have the same spectrum on the grid, though they are different shapes', () => {
  const n = 128, h = 1 / (n - 1);
  const a = modesOf('gww1', n, 60, { l: 0.33 }), b = modesOf('gww2', n, 60, { l: 0.33 });
  assert(a.dom.N === b.dom.N, 'same number of free points (same area)');
  let differ = 0;
  for (let g = 0; g < n * n; g++) if (a.mask[g] !== b.mask[g]) differ++;
  assert(differ > 1000, 'different shapes');
  let worst = 0;
  for (let k = 0; k < 60; k++) worst = Math.max(worst, Math.abs(a.values[k] / b.values[k] - 1));
  assert(worst < 1e-10, `isospectral to ${worst}`);
  // Their geometry, as Weyl's law needs it, is identical too.
  close(a.geo.area, b.geo.area, 1e-12, 'area'); close(a.geo.perimeter, b.geo.perimeter, 1e-12, 'perimeter'); close(a.geo.K, b.geo.K, 1e-12, 'K');
  return `60 eigenvalues agree to ${worst.toExponential(1)} (leg ${Math.round(a.geo.leg / h)}h); λ₁ = ${a.values[0].toFixed(3)}, λ₁ℓ² = ${(a.values[0] * a.geo.leg ** 2).toFixed(4)}`;
});

test('drums: the GWW drums converge to Driscoll\'s λ₁ (re-entrant corners: slowly)', () => {
  // Driscoll (1997): λ₁ = 2.53794399980 for triangles with legs 2, i.e. λ₁ℓ² = 10.1517759992.
  const out = [];
  for (const M of [8, 16, 32, 64]) {
    const n = 3 * M + 3, h = 1 / (n - 1);
    const { values, geo } = modesOf('gww1', n, 1, { l: M * h });
    out.push(values[0] * geo.leg * geo.leg);
  }
  const target = 4 * 2.53794399980, errs = out.map((v) => Math.abs(v / target - 1));
  assert(errs[3] < errs[0] && errs[3] < 0.003, `errors ${errs}`);
  return `λ₁ℓ² = ${out.map((v) => v.toFixed(4)).join(', ')} for legs of 8, 16, 32, 64 steps; Driscoll: ${target.toFixed(4)}`;
});

test('drums: Weyl\'s law, and the area and perimeter heard from 200 modes', () => {
  const n = 128, h = 1 / (n - 1), notes = [];
  for (const id of ['stadium', 'circle', 'sinai8']) {
    const { geo, values } = modesOf(id, n, 200, {});
    // The staircase against Weyl's three terms, with the grid's own correction to λ.
    let worst = 0;
    for (let k = 0; k < values.length; k++) worst = Math.max(worst, Math.abs(k + 0.5 - weyl(geo.area, geo.perimeter, geo.K, gridCorrected(values[k], h))));
    const fit = hearShape(values, { h, K: geo.K });
    assert(worst < 7, `${id}: staircase within ${worst.toFixed(1)} of Weyl`);
    assert(Math.abs(fit.area / geo.area - 1) < 0.01, `${id}: area ${fit.area} vs ${geo.area}`);
    assert(Math.abs(fit.perimeter / geo.perimeter - 1) < 0.05, `${id}: perimeter ${fit.perimeter} vs ${geo.perimeter}`);
    notes.push(`${id}: |N − Weyl| ≤ ${worst.toFixed(1)}, heard A ${(100 * (fit.area / geo.area - 1)).toFixed(2)}%, P ${(100 * (fit.perimeter / geo.perimeter - 1)).toFixed(1)}%`);
  }
  return notes.join('; ');
});

test('drums: level spacings — Poisson for the rectangle, repulsion for the quarter stadium and Sinai', () => {
  const n = 128;
  const rect = spacings(modesOf('rectangle', n, 200, { a: 1, b: 0.618 }).values);
  const stad = spacings(modesOf('qstadium', n, 200, {}).values);
  const sinai = spacings(modesOf('sinai8', n, 200, {}).values);
  assert(rect.small > 0.13, `rectangle small spacings ${rect.small}`);
  assert(stad.small < 0.09, `stadium small spacings ${stad.small}`);
  assert(sinai.small < 0.09, `Sinai small spacings ${sinai.small}`);
  return `fraction of spacings below 1/4: rectangle ${rect.small.toFixed(3)}, quarter stadium ${stad.small.toFixed(3)}, Sinai ⅛ ${sinai.small.toFixed(3)} (Poisson 0.221, Wigner 0.048)`;
});

test('drums: leapfrog conserves its energy, Visscher its norm (to rounding)', () => {
  const n = 64, { mask } = shape('stadium', n);
  const grid = new Grid(n, mask);
  const m = new Membrane(grid);
  m.strike(bump(grid, 0.1, 0.05, 0.03));
  const e0 = m.energy();
  for (let k = 0; k < 3000; k++) m.step();
  const e1 = m.energy();
  close(e1 / e0, 1, 1e-11, 'leapfrog energy');
  const b = new Billiard(grid);
  b.set(...packet(grid, -0.1, 0, 40, 25, 0.05));
  const n0 = b.norm();
  for (let k = 0; k < 3000; k++) b.step();
  close(b.norm() / n0, 1, 1e-11, 'Visscher norm');
  return `energy ${Math.abs(e1 / e0 - 1).toExponential(1)}, norm ${Math.abs(b.norm() / n0 - 1).toExponential(1)} after 3000 steps`;
});

// Compare the peaks of a spectrum (in the variable x) with the eigenvalues (in x too): every
// eigenvalue at least 3 peak widths from its neighbours must have a peak within 2% of a width
// (what is left is the neighbours' side lobes).  Closer pairs merge into one peak, as they
// should at that resolution.
function checkPeaks(peaksX, levelsX, fwhm, what) {
  let worst = 0, isolated = 0, found = 0;
  for (let k = 0; k < levelsX.length; k++) {
    const gap = Math.min(k > 0 ? levelsX[k] - levelsX[k - 1] : Infinity, k + 1 < levelsX.length ? levelsX[k + 1] - levelsX[k] : Infinity);
    if (gap < 3 * fwhm) continue;
    isolated++;
    const d = Math.min(...peaksX.map((p) => Math.abs(p - levelsX[k])));
    if (d < 0.5 * fwhm) { found++; worst = Math.max(worst, d / fwhm); }
  }
  assert(isolated >= 6 && found >= isolated - 1, `${what}: ${found} of ${isolated} isolated levels have a peak`);
  assert(worst < 0.02, `${what}: worst offset ${worst} of a peak width`);
  return `${what}: ${found} of ${isolated} isolated levels found, within ${(worst * 100).toFixed(2)}% of a peak width`;
}

test('drums: the spectroscopist\'s peaks sit on the eigenvalues (drum and billiard)', () => {
  const n = 48, { mask } = shape('stadium', n, { r: 0.3, a: 0.15 });
  const grid = new Grid(n, mask), dom = domainOf(mask, n, grid.h);
  const ev = lowestModes(dom, { count: 30, vectors: 0 }).values;
  const notes = [];
  // The drum, struck off centre; the signal is the displacement under the mallet.
  {
    const m = new Membrane(grid), v0 = bump(grid, 0.13, 0.07, 0.04);
    m.strike(v0);
    const stride = 2, sig = new Signal(stride * m.dt, false);
    while (m.t < 150) { m.step(); if (Math.round(m.t / m.dt) % stride === 0) sig.push(grid.dot(v0, m.u)); }
    const sp = sig.spectrum(fft, m.numericalOmega(Math.sqrt(ev[29])), 0.01);
    const peaks = findPeaks(sp.omega, sp.amp, 1e-3).map((p) => m.trueOmega(p.omega));
    notes.push(checkPeaks(peaks, Array.from(ev, Math.sqrt), WINDOW_FWHM / sig.T, 'drum (ω)'));
  }
  // The billiard, from a random state; the signal is the autocorrelation.
  {
    const b = new Billiard(grid), [re, im] = randomState(grid, Math.sqrt(ev[29]) * 1.2, 7);
    b.set(re, im);
    const stride = 2, sig = new Signal(stride * b.dt, true), re0 = Float64Array.from(re), im0 = Float64Array.from(im);
    const steps = Math.ceil(4 / b.dt);
    for (let k = 0; k < steps; k++) {
      b.step();
      if (k % stride === 0) {
        let cr = 0, ci = 0;
        for (const g of grid.inner) { cr += re0[g] * b.re[g] + im0[g] * b.im[g]; ci += re0[g] * b.im[g] - im0[g] * b.re[g]; }
        sig.push(cr * grid.h * grid.h, ci * grid.h * grid.h);
      }
    }
    const sp = sig.spectrum(fft, b.numericalOmega(ev[29] / 2), 0.2);
    const peaks = findPeaks(sp.omega, sp.amp, 1e-3).map((p) => b.trueOmega(p.omega));
    notes.push(checkPeaks(peaks, Array.from(ev, (l) => l / 2), WINDOW_FWHM / sig.T, 'billiard (E)'));
  }
  return notes.join('; ');
});

test('drums: longer runs make narrower peaks (width × T constant)', () => {
  const n = 40, { mask } = shape('circle', n, { R: 0.45 });
  const grid = new Grid(n, mask);
  const m = new Membrane(grid), v0 = bump(grid, 0, 0, 0.05);
  m.strike(v0);
  const sig = new Signal(m.dt, false), widths = [];
  for (const T of [20, 40, 80]) {
    while (m.t < T) { m.step(); sig.push(grid.dot(v0, m.u)); }
    const sp = sig.spectrum(fft, 12, 0.002);
    // The fundamental: its full width at half maximum.
    const pk = findPeaks(sp.omega, sp.amp, 0.05)[0];
    let lo = pk.bin, hi = pk.bin;
    while (sp.amp[lo] > pk.amp / 2) lo--;
    while (sp.amp[hi] > pk.amp / 2) hi++;
    widths.push({ T: sig.T, w: (hi - lo) * (sp.omega[1] - sp.omega[0]) });
  }
  for (const { T, w } of widths) close(w * T, WINDOW_FWHM, 0.06 * WINDOW_FWHM, `width × T at T = ${T.toFixed(0)}`);
  return widths.map(({ T, w }) => `T = ${T.toFixed(0)}: width ${w.toFixed(3)}`).join(', ') + ` (window: ${(WINDOW_FWHM).toFixed(2)}/T)`;
});

test('drums: the time-integral filter builds the eigenmode', () => {
  const n = 48, { mask } = shape('stadium', n, { r: 0.3, a: 0.15 });
  const grid = new Grid(n, mask), dom = domainOf(mask, n, grid.h);
  const ex = lowestModes(dom, { count: 12, vectors: 12 });
  const b = new Billiard(grid), [re, im] = randomState(grid, 30, 3);
  b.set(re, im);
  // The most isolated of modes 2..10 (a symmetric stadium has close pairs from different
  // symmetry classes, which only a longer run separates).
  let k = 1, best = 0;
  for (let i = 1; i < 10; i++) { const gap = Math.min(ex.values[i] - ex.values[i - 1], ex.values[i + 1] - ex.values[i]); if (gap > best) { best = gap; k = i; } }
  const E = ex.values[k] / 2, f = new ModeFilter(grid, b.numericalOmega(E), 0);
  const stride = 4, steps = Math.ceil(2 / b.dt);
  const overlap = () => {
    const [fr, fi] = f.result(), phi = toGrid(dom, ex.vectors[k]);
    const { field } = realPart(grid, fr, fi);
    return Math.abs(grid.dot(field, phi)) / Math.sqrt(grid.dot(field) * grid.dot(phi));
  };
  const seen = [];
  for (let s = 0; s < steps; s++) {
    b.step();
    if (s % stride === 0) f.add(b.t, stride * b.dt, b.re, b.im);
    if (s === Math.floor(steps / 8) || s === steps - 1) seen.push(overlap());
  }
  assert(seen[1] > 0.999, `overlap ${seen[1]}`);
  assert(seen[1] > seen[0], 'longer filtering is better');
  return `overlap with the exact mode ${k + 1}: ${seen[0].toFixed(4)} early, ${seen[1].toFixed(6)} at the end`;
});

test('drums: the sound has the drum\'s frequencies', () => {
  const freqs = [220, 351.2, 470.9], s = synthesize(freqs, [1, 0.7, 0.5], [1, 0.6, 0.4], 44100, 1);
  const P = 1 << 16, re = new Float64Array(P), im = new Float64Array(P);
  for (let k = 0; k < s.length; k++) re[k] = s[k];
  fft(re, im);
  const amp = Array.from({ length: P / 2 }, (_, j) => Math.hypot(re[j], im[j]));
  const omega = amp.map((_, j) => j);
  const peaks = findPeaks(omega, Float64Array.from(amp), 0.05).map((p) => (p.omega * 44100) / P);
  for (const f of freqs) assert(peaks.some((p) => Math.abs(p - f) < 1), `a peak at ${f} Hz (found ${peaks.map((p) => p.toFixed(1))})`);
});

test('drums: the classical ray reflects specularly and stays inside', () => {
  const geo = PRESETS.circle.make({ R: 0.4 }, 1 / 127);
  const r = new Ray(geo.sdf, 0.1, 0, 0.3, 1, 1, 0.002);
  r.advance(5);
  assert(r.bounces > 5, 'bounces');
  // In a circle the angle of incidence is the same at every bounce.
  const angles = [];
  for (let i = 2; i < r.path.length; i++) {
    const [x0, y0] = r.path[i - 1], [x1, y1] = r.path[i];
    angles.push(Math.hypot(x1 - x0, y1 - y0));
  }
  for (const a of angles) close(a, angles[0], 1e-6, 'chord length');
  assert(geo.sdf(r.x, r.y) > -1e-9, 'inside');
  return `${r.bounces} bounces, equal chords to 1e-6`;
});

test('drums: polygon geometry (area, perimeter, Weyl constant)', () => {
  const sq = polygon([[0, 0], [1, 0], [1, 1], [0, 1]]);
  close(sq.area, 1, 1e-12); close(sq.perimeter, 4, 1e-12); close(sq.K, 0.25, 1e-12);
  const g = polygon(GWW[0]);
  close(g.area, 3.5, 1e-12); close(g.perimeter, 6 + 3 * Math.SQRT2, 1e-12);
});
