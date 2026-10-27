import { test, assert, close } from './harness.js';
import {
  free, lens, mirror, mul, applyABCD, qOfWaist, beamOf, analytic, traceBench, beamAt, waists,
  envelope, lensLaw, coupling, gouyThrough, hermite,
} from '../beams/gauss.js';
import { gParams, isStable, roundTrip, eigenmode, closedForms, modeLines, bounce, afterRoundTrip } from '../beams/cavity.js';
import { fillMode, hg1d, laguerre, order, overlap, modeAt, spectrum, fromSpectrum } from '../beams/modes.js';
import { propagate } from '../diffraction/optics.js';

const LAMBDA = 633e-6; // mm

test('beams: q through free space gives the closed-form w(z), R(z) and Gouy phase', () => {
  for (const w0 of [0.01, 0.2, 1.5]) {
    for (const z of [-3000, -50, -1, 0, 0.3, 7, 400, 1e4]) {
      const q = applyABCD(free(z), qOfWaist(w0, 0, LAMBDA));
      const b = beamOf(q, LAMBDA), a = analytic(w0, z, LAMBDA);
      close(b.w, a.w, 1e-12 * a.w, `w0=${w0} z=${z} w`);
      if (z !== 0) close(1 / b.R, 1 / a.R, 1e-12 / Math.abs(a.R) + 1e-15, `w0=${w0} z=${z} 1/R`);
      else assert(b.R === Infinity, 'flat at the waist');
      close(b.gouy, a.gouy, 1e-12, 'Gouy phase');
      close(b.w0, w0, 1e-12 * w0, 'the waist is remembered');
    }
  }
  // In glass: zR = pi w0^2 n / lambda0, and R in the glass.
  const n = 1.5, w0 = 0.1, z = 30;
  const q = applyABCD(free(z, n), qOfWaist(w0, 0, LAMBDA, n));
  const b = beamOf(q, LAMBDA, n), a = analytic(w0, z, LAMBDA / n);
  close(b.w, a.w, 1e-12, 'w in glass'); close(b.R, a.R, 1e-9 * a.R, 'R in glass'); close(b.zR, a.zR, 1e-9, 'zR in glass');
});

test('beams: a thin lens focuses a beam where the Gaussian lens law says', () => {
  // A collimated beam (waist on the lens): the focus is a little short of f, and
  // w_f = w0 f / sqrt(f^2 + zR^2) -> lambda f / (pi w0) when zR >> f.
  const w0 = 1, f = 100, zR = (Math.PI * w0 * w0) / LAMBDA;
  const tr = traceBench({ lambda: LAMBDA, w0, z0: 0 }, [{ type: 'lens', z: 0, f }], -10, 400);
  const ws = waists(tr), focus = ws[ws.length - 1];
  close(focus.z, (f * zR * zR) / (f * f + zR * zR), 1e-9, 'focus position');
  close(focus.w0, (w0 * f) / Math.sqrt(f * f + zR * zR), 1e-12, 'focused waist');
  close(focus.w0, (LAMBDA * f) / (Math.PI * w0), 3e-4 * focus.w0, 'lambda f / pi w (zR = 5 m >> f)');
  // A waist at distance s before the lens, against Self's formula and the ray matrix.
  for (const s of [-200, 0, 50, 99, 100, 101, 150, 300, 3000]) {
    for (const zr of [1, 30, 100, 500]) {
      const qin = { re: s, im: zr }, qout = applyABCD(lens(f), qin);
      const L = lensLaw(s, zr, f);
      close(-qout.re, L.s2, 1e-9 * (1 + Math.abs(L.s2)), `s=${s} zR=${zr}: image distance`);
      close(Math.sqrt(qout.im / zr), L.m, 1e-9 * L.m, `s=${s} zR=${zr}: magnification`);
    }
  }
  // Far from the focal point, or with zR -> 0, the geometric lens law.
  const g = lensLaw(300, 1e-3, f);
  close(g.s2, g.geometric, 1e-6, 'geometric limit');
  // The furthest the waist can be put: s = f + zR gives s2 = f + f^2 / (2 zR).
  const zr = 40, best = lensLaw(f + zr, zr, f);
  close(best.s2, f + (f * f) / (2 * zr), 1e-9, 'maximum image distance');
  assert(lensLaw(f + zr * 1.1, zr, f).s2 < best.s2 && lensLaw(f + zr * 0.9, zr, f).s2 < best.s2, 'it is a maximum');
});

test('beams: a bench traces like the product of its matrices; a telescope magnifies by f2/f1', () => {
  const beam = { lambda: LAMBDA, w0: 0.5, z0: -100 };
  const els = [{ type: 'lens', z: 50, f: 50 }, { type: 'slab', z: 120, t: 40, n: 1.6 }, { type: 'mirror', z: 300, R: -400 }, { type: 'lens', z: 360, f: 200 }];
  const tr = traceBench(beam, els, 0, 600);
  const qin = qOfWaist(0.5, 100, LAMBDA);                       // at z = 0
  const M = mul(free(240), lens(200), free(60), mirror(-400), free(140), free(40, 1.6), free(70), lens(50), free(50));
  const qout = applyABCD(M, qin), b = beamAt(tr, 600);
  close(b.q.re, qout.re, 1e-9 * Math.abs(qout.re), 'Re q'); close(b.q.im, qout.im, 1e-9 * qout.im, 'Im q');
  // The accumulated Gouy phase agrees with -arg(A + B/q) modulo 2 pi.
  const dpsi = b.gouy - beamAt(tr, 0).gouy, abcd = gouyThrough(M, qin);
  const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  close(wrap(dpsi - abcd), 0, 1e-9, 'Gouy phase: piecewise vs ABCD');
  // A Keplerian telescope (lenses f1 + f2 apart) with a large input waist on the first lens.
  const f1 = 25, f2 = 100, w0 = 0.6;
  const t2 = traceBench({ lambda: LAMBDA, w0, z0: 0 }, [{ type: 'lens', z: 0, f: f1 }, { type: 'lens', z: f1 + f2, f: f2 }], 0, 1000);
  const out = waists(t2)[2];
  close(out.w0, (w0 * f2) / f1, 1e-3 * w0 * f2 / f1, 'beam expander: w0 * f2/f1');
});

test('beams: a slab moves a focus back by t (1 - 1/n); the Gouy phase through a focus is pi', () => {
  const w0 = 0.02, n = 1.5, zR = (Math.PI * w0 * w0) / LAMBDA;
  // A waist that would be at z = 50 in air, behind a slab from 30 to 50: it moves to
  // 50 + t (1 - 1/n), with the same size.
  const after = traceBench({ lambda: LAMBDA, w0, z0: 50 }, [{ type: 'slab', z: 30, t: 20, n }], 0, 150);
  const out = waists(after)[2];
  close(out.z - 50, 20 * (1 - 1 / n), 1e-9, 'focal shift t(1 - 1/n)');
  close(out.w0, w0, 1e-12, 'same waist');
  assert(out.real && !waists(after)[1].real, 'the waist is after the slab');
  // A waist inside a long slab (30 to 90): the light reaches it 20 n = 30 mm into the glass,
  // with the same w0 and a Rayleigh range n times longer.
  const inside = waists(traceBench({ lambda: LAMBDA, w0, z0: 50 }, [{ type: 'slab', z: 30, t: 60, n }], 0, 150))[1];
  close(inside.z, 60, 1e-9, 'waist position in the glass');
  close(inside.w0, w0, 1e-12, 'waist size in the glass');
  close(inside.zR, n * zR, 1e-9, 'Rayleigh range in the glass');
  // Gouy: from far before to far after a focus, pi.
  const far = traceBench({ lambda: LAMBDA, w0, z0: 0 }, [], -1e4 * zR, 1e4 * zR);
  close(beamAt(far, 1e4 * zR).gouy - beamAt(far, -1e4 * zR).gouy, Math.PI, 2e-4, 'Gouy phase pi');
  // Through a lens focus too (lens at 0, collimated input): the accumulated phase is continuous.
  const fl = traceBench({ lambda: LAMBDA, w0: 1, z0: 0 }, [{ type: 'lens', z: 0, f: 100 }], -1, 1e5);
  const before = beamAt(fl, -1e-9).gouy, at = beamAt(fl, 0).gouy;
  close(at - before, 0, 1e-9, 'no jump at a thin lens');
  // The collimated beam is at its own waist on the lens (psi = 0 there); after it the focused
  // beam starts at -atan(f'/zR') with f' the distance to the new focus, and ends near pi/2.
  const foc = waists(fl)[1];
  close(beamAt(fl, 1e5).gouy - at, Math.atan((1e5 - foc.z) / foc.zR) + Math.atan(foc.z / foc.zR), 1e-9, 'Gouy phase through the lens focus');
  close(beamAt(fl, 1e5).gouy - at, Math.PI, 0.03, 'nearly pi');
});

test('beams: the bench\'s field is the field the angular spectrum method computes (through a lens)', () => {
  // A round beam (HG00, then HG20), a lens, a focus: the field drawn on the bench (from q,
  // segment by segment, with the Gouy phase (m+1) psi accumulated) against the FFT propagator of
  // the diffraction demo applied step by step, the lens as a phase screen.  The waist starts
  // 30 mm before the bench, so the Gouy phase doesn't start at zero.
  const n = 256, dx = 0.01, lambda = 6.33e-4, w0 = 0.25, f = 120;
  const k0 = (2 * Math.PI) / lambda;
  const tr = traceBench({ lambda, w0, z0: -30 }, [{ type: 'lens', z: 20, f }], 0, 300);
  const xs = (i) => (i - n / 2) * dx;
  // HG_m0 in 2D: the bench's x profile times the fundamental's y profile.
  const field2d = (b, m, x, y) => {
    const [a, c] = envelope(tr, b, x, m, w0), g = Math.exp(-(y * y) / (b.w * b.w)), p = 0.5 * k0 * y * y * b.curv;
    return [g * (a * Math.cos(p) - c * Math.sin(p)), g * (a * Math.sin(p) + c * Math.cos(p))];
  };
  const notes = [];
  for (const m of [0, 2]) {
    const re = new Float64Array(n * n), im = new Float64Array(n * n);
    const b0 = beamAt(tr, 0);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) [re[j * n + i], im[j * n + i]] = field2d(b0, m, xs(i), xs(j));
    propagate(re, im, n, dx, lambda, 20, true);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const r2 = xs(i) ** 2 + xs(j) ** 2, ph = (-k0 * r2) / (2 * f), o = j * n + i;
      const c = Math.cos(ph), s = Math.sin(ph), a = re[o];
      re[o] = a * c - im[o] * s; im[o] = a * s + im[o] * c;
    }
    const z = 20 + 112;                      // near the focus
    propagate(re, im, n, dx, lambda, z - 20, true);
    const b = beamAt(tr, z);
    let err = 0, peak = 0;
    for (let j = n / 2 - 40; j <= n / 2 + 40; j += 8) for (let i = 0; i < n; i++) {
      const [a, c] = field2d(b, m, xs(i), xs(j)), o = j * n + i;
      err = Math.max(err, Math.hypot(re[o] - a, im[o] - c)); peak = Math.max(peak, Math.hypot(a, c));
    }
    assert(err < 2e-3 * peak, `HG${m}0: max |FFT - analytic| = ${err.toExponential(2)} of peak ${peak.toFixed(3)}`);
    notes.push(`HG${m}0 ${(err / peak).toExponential(1)}`);
  }
  return `max difference from the FFT, as a fraction of the peak: ${notes.join(', ')}`;
});

test('beams: mode matching efficiency', () => {
  const q = { re: 12, im: 30 };
  close(coupling(q, q), 1, 1e-15, 'identical beams');
  const q2 = { re: -5, im: 80 };
  const e = coupling(q, q2), e2 = coupling({ re: q.re + 100, im: q.im }, { re: q2.re + 100, im: q2.im });
  close(e, e2, 1e-14, 'unchanged by propagation');
  assert(e > 0 && e < 1, 'between 0 and 1');
  // Waists of different size at the same plane: (2 w1 w2 / (w1^2 + w2^2))^2.
  const w1 = 0.1, w2 = 0.3, a = qOfWaist(w1, 0, LAMBDA), b = qOfWaist(w2, 0, LAMBDA);
  close(coupling(a, b), ((2 * w1 * w2) / (w1 * w1 + w2 * w2)) ** 2, 1e-14, 'size mismatch');
  // Against a numerical overlap of two round Gaussians with different curvature.
  const n = 200, h = 0.004, k0 = (2 * Math.PI) / LAMBDA, A = beamOf(q, LAMBDA), B = beamOf(q2, LAMBDA);
  let sr = 0, si = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i - n / 2 + 0.5) * h, y = (j - n / 2 + 0.5) * h, r2 = x * x + y * y;
    const a1 = Math.exp(-r2 / A.w ** 2) / A.w, p1 = (k0 * r2) / (2 * A.R);
    const a2 = Math.exp(-r2 / B.w ** 2) / B.w, p2 = (k0 * r2) / (2 * B.R);
    sr += a1 * a2 * Math.cos(p2 - p1); si += a1 * a2 * Math.sin(p2 - p1);
  }
  const norm = (2 / Math.PI) * h * h;
  close((sr * sr + si * si) * norm * norm, e, 1e-6, 'numerical overlap');
});

test('cavity: stable iff 0 <= g1 g2 <= 1, and then the mode reproduces itself', () => {
  let stable = 0, unstable = 0;
  for (let k = 0; k < 400; k++) {
    // g1, g2 spread over [-1.8, 1.8] (some mirrors flat), lengths 20 to 1000 mm.
    const L = 20 + 980 * Math.random();
    const pick = (i) => ((k + i) % 13 === 0 ? Infinity : L / (1 - (3.6 * Math.random() - 1.8)));
    const R1 = pick(0), R2 = pick(5);
    const [g1, g2] = gParams(L, R1, R2), p = g1 * g2;
    const [A, , , D] = roundTrip(L, R1, R2);
    close((A + D) / 2, 2 * p - 1, 1e-9 * (1 + Math.abs(p)), 'half the trace is 2 g1 g2 - 1');
    const mode = eigenmode(L, R1, R2, LAMBDA);
    if (p > 1e-6 && p < 1 - 1e-6) {
      stable++;
      assert(isStable(g1, g2) && mode, `stable: g1 g2 = ${p}`);
      const q2 = afterRoundTrip(L, R1, R2, mode.q1);
      close(q2.re, mode.q1.re, 1e-7 * Math.abs(mode.q1.im), 'Re q after a round trip');
      close(q2.im, mode.q1.im, 1e-7 * mode.q1.im, 'Im q after a round trip');
      // The wavefronts fit the mirrors.
      const b1 = beamOf(mode.q1, LAMBDA), b2 = beamOf({ re: mode.q1.re + L, im: mode.q1.im }, LAMBDA);
      close(1 / b1.R, -1 / R1, 1e-9 / Math.abs(mode.q1.im) + 1e-12, 'wavefront curvature at mirror 1');
      close(1 / b2.R, 1 / R2, 1e-9 / Math.abs(mode.q1.im) + 1e-12, 'wavefront curvature at mirror 2');
      // Rays stay near the axis.
      const r = bounce(L, R1, R2, 1, 0.001, 2000);
      const xmax = Math.max(...r.hits.map((h) => Math.abs(h.x)));
      assert(xmax < 1e4, `stable rays stay bounded (${xmax})`);
    } else if (p < -1e-6 || p > 1 + 1e-6) {
      unstable++;
      assert(!isStable(g1, g2) && !mode, `unstable: g1 g2 = ${p}`);
      const r = bounce(L, R1, R2, 1, 0.001, 2000, 1e6);
      assert(r.lost > 0, `unstable rays walk off (g1g2 = ${p.toFixed(3)})`);
    }
  }
  return `${stable} stable, ${unstable} unstable cavities`;
});

test('cavity: the mode against the textbook formulas; the confocal spectrum', () => {
  for (const [L, R1, R2] of [[250, 500, 500], [100, 1000, Infinity], [300, 200, 250], [180, -500, 300], [350, 200, 200], [100, 60, 75]]) {
    const [g1, g2] = gParams(L, R1, R2);
    if (!isStable(g1, g2)) continue;
    const m = eigenmode(L, R1, R2, LAMBDA), c = closedForms(L, g1, g2, LAMBDA);
    close(m.w0, c.w0, 1e-9 * c.w0, `w0 (${L}, ${R1}, ${R2})`);
    close(m.w1, c.w1, 1e-9 * c.w1, 'w1'); close(m.w2, c.w2, 1e-9 * c.w2, 'w2');
    close(m.zw, c.zw, 1e-7 * L, 'waist position');
    close(m.gouy, c.gouy, 1e-9, 'one-way Gouy phase = arccos(+-sqrt(g1 g2))');
  }
  // Symmetric confocal (R = L): psi1 = pi/2, so the modes of odd order sit half way between
  // the TEM00 comb, and the even ones on it.
  const conf = eigenmode(200, 200, 200, LAMBDA);
  close(conf.gouy, Math.PI / 2, 1e-12, 'confocal Gouy');
  // It is the limit of symmetric cavities either side of it.
  for (const R of [199.99, 200.01]) {
    const near = eigenmode(200, R, R, LAMBDA);
    close(near.w0, conf.w0, 1e-4 * conf.w0, `R = ${R}: w0`); close(near.zw, 100, 1e-6, 'waist in the middle');
  }
  assert(!eigenmode(200, 199.99, 200.01, LAMBDA), 'an unequal pair either side of R = L is unstable');
  const lines = modeLines(conf.gouy, 5, 0, 3);
  for (const ln of lines) close((2 * ln.nu) % 1, 0, 1e-9, `confocal: every line on the half-FSR grid (N = ${ln.N})`);
  close(conf.w0, Math.sqrt((LAMBDA * 200) / (2 * Math.PI)), 1e-12, 'confocal waist sqrt(lambda L / 2 pi)');
  // Hemispherical (flat + R = L... just inside): the spot on the curved mirror grows without bound.
  const a = eigenmode(99, Infinity, 100, LAMBDA), b = eigenmode(99.9, Infinity, 100, LAMBDA);
  assert(b.w2 > a.w2 && b.w0 < a.w0, 'approaching the hemispherical limit');
});

test('modes: Hermite-Gauss and Laguerre-Gauss modes are orthonormal', () => {
  const n = 160, half = 7, dA = ((2 * half) / n) ** 2;
  const list = [];
  for (let m = 0; m <= 3; m++) for (let k = 0; k <= 3 - m; k++) list.push({ family: 'hg', m, n: k });
  const lg = [{ family: 'lg', p: 0, l: 0 }, { family: 'lg', p: 0, l: 1 }, { family: 'lg', p: 0, l: -1 }, { family: 'lg', p: 1, l: 0 }, { family: 'lg', p: 1, l: 2 }, { family: 'lg', p: 2, l: -1 }];
  let worst = 0;
  for (const set of [list, lg]) {
    for (const zeta of [0, 1.3]) {
      const fields = set.map((md) => { const re = new Float64Array(n * n), im = new Float64Array(n * n); fillMode(re, im, n, n, half, md, zeta); return [re, im]; });
      for (let a = 0; a < set.length; a++) for (let b = a; b < set.length; b++) {
        const o = overlap(fields[a][0], fields[a][1], fields[b][0], fields[b][1], dA);
        const want = a === b ? 1 : 0, err = Math.hypot(o.re - want, o.im);
        worst = Math.max(worst, err);
        assert(err < 1e-6, `<${JSON.stringify(set[a])}|${JSON.stringify(set[b])}> at zeta ${zeta} = ${o.re.toFixed(8)} + ${o.im.toFixed(8)}i`);
      }
    }
  }
  // The 1D functions and the polynomials themselves.
  close(hermite(3, 0.7), 8 * 0.7 ** 3 - 12 * 0.7, 1e-12, 'H_3');
  close(laguerre(2, 1, 0.5), 0.5 * 0.25 - 3 * 0.5 + 3, 1e-12, 'L_2^1');
  return `largest error ${worst.toExponential(1)}`;
});

test('modes: HG10 + i HG01 is the Laguerre-Gauss donut LG01', () => {
  const n = 96, half = 5;
  const a = [new Float64Array(n * n), new Float64Array(n * n)], b = [new Float64Array(n * n), new Float64Array(n * n)];
  for (const zeta of [0, -0.8, 2]) {
    fillMode(a[0], a[1], n, n, half, { family: 'mix', alpha: Math.PI / 4, phi: Math.PI / 2 }, zeta);
    fillMode(b[0], b[1], n, n, half, { family: 'lg', p: 0, l: 1 }, zeta);
    let err = 0;
    for (let k = 0; k < n * n; k++) err = Math.max(err, Math.hypot(a[0][k] - b[0][k], a[1][k] - b[1][k]));
    assert(err < 1e-12, `zeta ${zeta}: max difference ${err}`);
  }
  // modeAt agrees with fillMode.
  const md = { family: 'lg', p: 1, l: -2 }, re = new Float64Array(4 * 4), im = new Float64Array(4 * 4);
  fillMode(re, im, 4, 4, 2, md, 0.6);
  const [r, i] = modeAt(md, -2 + 0.5 + 1, 2 - 0.5, 0.6);
  close(r, re[1], 1e-12, 'modeAt re'); close(i, im[1], 1e-12, 'modeAt im');
  assert(order(md) === 4, 'order 2p + |l|');
});

test('modes: the split angular spectrum propagator is the diffraction demo\'s propagate()', () => {
  // A tight, off-centre, tilted spot, so that evanescent components matter too.
  const n = 64, dx = 0.02, lambda = 0.05, re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i - 30) * dx, y = (j - 34) * dx, g = Math.exp(-(x * x + y * y) / 0.002);
    re[j * n + i] = g * Math.cos(40 * x); im[j * n + i] = g * Math.sin(40 * x);
  }
  const S = spectrum(re, im, n, dx, lambda);
  let worst = 0;
  for (const z of [0, 0.01, 0.3, 2]) {
    const R = Float64Array.from(re), I = Float64Array.from(im);
    propagate(R, I, n, dx, lambda, z, false);
    const [A, B] = fromSpectrum(S, z);
    for (let k = 0; k < n * n; k++) worst = Math.max(worst, Math.abs(A[k] - R[k]), Math.abs(B[k] - I[k]));
  }
  assert(worst < 1e-12, `largest difference ${worst}`);
  return `largest difference ${worst.toExponential(1)}`;
});

test('modes: propagated by the angular spectrum method, an HG mode keeps its shape and gains (m+n+1) atan(z/zR)', () => {
  // Units of w0; lambda = 0.05 w0 so zR = 20 pi w0.  With the paraxial propagator the modes are
  // exact; with the exact kz they pick up the non-paraxial phase, about z k_perp^4 / 8k^3:
  // a few milliradians here, for k_perp^2 ~ 2(N+1)/w0^2.
  const n = 256, dx = 0.1, lambda = 0.05, zR = Math.PI / lambda, half = (n * dx) / 2;
  const worst = { paraxial: 0, exact: 0 };
  const notes = [];
  for (const [m, k] of [[0, 0], [1, 0], [2, 1], [3, 3]]) {
    const md = { family: 'hg', m, n: k };
    const re = new Float64Array(n * n), im = new Float64Array(n * n);
    fillMode(re, im, n, n, half, md, 0);
    for (const zeta of [0.5, 1, 2]) {
      for (const paraxial of [true, false]) {
        const R = Float64Array.from(re), I = Float64Array.from(im);
        propagate(R, I, n, dx, lambda, zeta * zR, paraxial);
        const R2 = new Float64Array(n * n), I2 = new Float64Array(n * n);
        fillMode(R2, I2, n, n, half, md, zeta);
        // The overlap with the analytic mode at z: magnitude 1 (same shape), phase 0 (the
        // analytic mode carries exp(-i (N+1) atan(z/zR))).
        const o = overlap(R2, I2, R, I, dx * dx);
        const mag = Math.hypot(o.re, o.im), ph = Math.atan2(o.im, o.re), what = `HG${m}${k} at z = ${zeta} zR, ${paraxial ? 'paraxial' : 'exact'} kz`;
        close(mag, 1, paraxial ? 1e-8 : 1e-4, `${what}: |overlap|`);
        close(ph, 0, paraxial ? 1e-8 : 5e-3, `${what}: phase`);
        const key = paraxial ? 'paraxial' : 'exact';
        worst[key] = Math.max(worst[key], Math.abs(ph));
        // The Gouy phase measured from the FFT field, in units of atan(z/zR): the phase it lacks
        // against the mode's shape without its Gouy factor, (N+1) psi - arg(overlap).
        if (zeta === 1 && !paraxial) notes.push(`HG${m}${k}: ${((m + k + 1) - ph / Math.atan(zeta)).toFixed(4)}`);
      }
    }
  }
  return `Gouy phase at z = zR in units of pi/4 (exact kz): ${notes.join(', ')}; largest phase error ${worst.paraxial.toExponential(1)} (paraxial), ${worst.exact.toExponential(1)} (exact kz)`;
});
