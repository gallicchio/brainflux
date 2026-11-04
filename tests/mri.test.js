import { test, assert, close } from './harness.js';
import { fftCentered } from '../lib/fft.js';
import { GB, larmorMHz, Spins, sincPulse, sliceProfile, fwhm, blocksFID, blocksProfile, spectrumOf, rotate, TWO_PI, partialSpectrum, lorentzOffsets, sliceMovie, pulseSpectrum } from '../mri/bloch.js';
import { TISSUES, tissueAt, headPhantom, disksPhantom, disk, rasterize, weighting, steadyMz, weightedImage, projection, tissueAtPoint, head3D, sliceOf, tissueAt3D } from '../mri/phantom.js';
import { sequence, lineOrder, pictureOf, kspaceOf, reconstruct, Acquisition, projections, backprojection, rmsDiff, noiseField, spinsOf, phaseMap, echoTrace, traceTimes } from '../mri/scan.js';

const deg = Math.PI / 180;

test('gamma-bar: 42.577 MHz/T; a 10 mT/m gradient shifts the Larmor frequency 425.8 Hz per mm', () => {
  close(larmorMHz(1.5), 63.87, 0.01, 'f0 at 1.5 T');
  close(larmorMHz(3), 127.7, 0.05, 'f0 at 3 T');
  close(GB * 10 * 1, 0.42577, 1e-9, 'kHz per mm at 10 mT/m');
  // A 10 mT/m lobe lasting 1 ms winds 0.426 cycles per mm: a stripe period of 2.35 mm.
  close(1 / (GB * 10 * 1), 2.3487, 1e-3, 'stripe period');
  return `f0 = ${larmorMHz(1.5).toFixed(2)} MHz at 1.5 T; 10 mT/m: ${(GB * 10 * 1000).toFixed(1)} Hz/mm`;
});

test('a pi/2 pulse along -y tips z to +x; a pi pulse along x conjugates Mx + iMy (the refocusing)', () => {
  const s = Spins.row([0, 0], [1, 1]);
  s.pulse(Math.PI / 2, -Math.PI / 2);
  close(s.mx[0], 1, 1e-12, 'Mx'); close(s.my[0], 0, 1e-12, 'My'); close(s.mz[0], 0, 1e-12, 'Mz');
  // Turn one spin to a phase of 50 degrees, then the pi pulse: the phase becomes -50 degrees.
  s.mx[1] = Math.cos(50 * deg); s.my[1] = Math.sin(50 * deg); s.mz[1] = 0;
  s.pulse(Math.PI, 0);
  close(s.phase(1), -50 * deg, 1e-12, 'conjugated phase');
  close(s.phase(0), 0, 1e-12, 'a spin along x stays');
  // rotate(): a right-handed quarter turn about z takes x to y.
  const v = rotate([1, 0, 0], 0, 0, 1, Math.PI / 2);
  close(v[1], 1, 1e-12, 'rotate x about z');
});

test('free precession: the Bloch row against the analytic phase winding -2 pi GB G x t, decaying with T2', () => {
  const xs = Float64Array.from({ length: 41 }, (_, i) => -100 + 5 * i), T2 = 50, G = 7, t = 1.3;
  const s = Spins.row(xs, null, 1e9, T2);
  s.pulse(Math.PI / 2);
  s.precess(t, G);
  let worst = 0, worstMag = 0;
  for (let i = 0; i < xs.length; i++) {
    const want = -TWO_PI * GB * G * xs[i] * t;
    const d = Math.atan2(Math.sin(s.phase(i) - want), Math.cos(s.phase(i) - want));
    worst = Math.max(worst, Math.abs(d));
    worstMag = Math.max(worstMag, Math.abs(s.mxy(i) - Math.exp(-t / T2)));
  }
  assert(worst < 1e-9 && worstMag < 1e-12, `phase off by ${worst}, magnitude by ${worstMag}`);
  // Two short steps equal one long one (the precession is exact for constant gradients).
  const a = Spins.row(xs, null, 800, T2), b = Spins.row(xs, null, 800, T2);
  a.pulse(1); b.pulse(1);
  a.precess(2.5, 3, 0, 0); b.precess(1, 3, 0, 0); b.precess(1.5, 3, 0, 0);
  let d = 0;
  for (let i = 0; i < xs.length; i++) d = Math.max(d, Math.abs(a.mx[i] - b.mx[i]), Math.abs(a.my[i] - b.my[i]), Math.abs(a.mz[i] - b.mz[i]));
  assert(d < 1e-12, `two steps differ from one by ${d}`);
  return `41 spins, G = ${G} mT/m, t = ${t} ms: phases within ${worst.toExponential(1)} rad of -2π GB G x t`;
});

test('a hard pulse by rfStep (a strong, short B1) agrees with pulse()', () => {
  const a = Spins.row([0, 30], null), b = Spins.row([0, 30], null);
  a.pulse(Math.PI / 2, -Math.PI / 2);
  // B1 along -y: the rotation 2 pi b1 (100 dt) = pi/2 in 100 steps of 1e-4 ms (b1 = 25 kHz).
  const dt = 1e-4, b1 = 0.25 / (100 * dt);
  for (let i = 0; i < 100; i++) b.rfStep(0, -b1, dt);
  for (let i = 0; i < 2; i++) { close(b.mx[i], a.mx[i], 1e-9, 'Mx'); close(b.my[i], a.my[i], 1e-9, 'My'); close(b.mz[i], a.mz[i], 1e-9, 'Mz'); }
});

test('the spin echo: spins spread by an uneven field refocus at TE, with the T2 decay only', () => {
  const n = 400, s = new Spins(n), T2 = 80, TE = 30;
  // Offsets spread over +-60 Hz (a Lorentzian of width 1/(pi T2') would do the same).
  for (let i = 0; i < n; i++) { s.df[i] = (-0.06 + (0.12 * (i + 0.5)) / n); s.T2[i] = T2; }
  s.reset();
  s.pulse(Math.PI / 2);
  const mag = (t) => Math.hypot(...s.signal()) / n;
  s.precess(TE / 2);
  const before = mag(TE / 2);
  s.pulse(Math.PI, 0);
  s.precess(TE / 2 - 1);
  const early = mag(TE - 1);
  s.precess(1);
  const atTE = mag(TE);
  s.precess(1);
  const late = mag(TE + 1);
  assert(before < 0.1, `dephased to ${before} by TE/2`);
  close(atTE, Math.exp(-TE / T2), 1e-9, 'the echo at TE');
  assert(early < atTE && late < atTE, `the echo peaks at TE (${early}, ${atTE}, ${late})`);
  return `at TE/2 the signal is ${before.toFixed(3)} of M0; at TE it is back to e^(-TE/T2) = ${atTE.toFixed(4)}`;
});

test('slice selection: a sinc pulse under Gz tips a slab bw / (GB Gz) thick, centred at fc / (GB Gz)', () => {
  const notes = [];
  for (const [Gz, bw, fc] of [[6, 1.3, 0], [10, 1.3, 2], [6, 2.6, -1.5]]) {
    const zs = Float64Array.from({ length: 1201 }, (_, i) => -120 + 0.2 * i);
    const r = sliceProfile({ Gz, bw, T: 3, fc, zs });
    // A pi/2 pulse tips a slab a little wider than the small-tip rule says (about 9%); a small
    // tip follows the rule.
    const err = Math.abs(r.fwhm - r.thickness) / r.thickness;
    assert(err < 0.12, `FWHM ${r.fwhm} against ${r.thickness}`);
    const small = sliceProfile({ Gz, bw, T: 3, fc, zs, flip: 15 * deg });
    assert(Math.abs(small.fwhm - small.thickness) < 0.03 * small.thickness, `small tip: FWHM ${small.fwhm} against ${small.thickness}`);
    // The centre: the midpoint of the half-maximum points.
    let imax = 0;
    for (let i = 0; i < zs.length; i++) if (r.mxy[i] > r.mxy[imax]) imax = i;
    assert(Math.abs(zs[imax] - r.centre) < 1.5, `centre ${zs[imax]} against ${r.centre}`);
    // Inside the slab the spins are tipped nearly flat; well outside they stand.
    const inside = r.mxy[imax], outside = r.mxy[Math.round((r.centre + 3 * r.thickness + 120) / 0.2)];
    assert(inside > 0.95 && outside < 0.05, `inside ${inside}, outside ${outside}`);
    // With the rephasing lobe the phase is flat across the slab; without it, it winds.
    const noRe = sliceProfile({ Gz, bw, T: 3, fc, zs, rephase: false });
    const span = (p, lo, hi) => { let a = Infinity, b = -Infinity; for (let i = lo; i <= hi; i++) { a = Math.min(a, p[i]); b = Math.max(b, p[i]); } return b - a; };
    const lo = Math.round((r.centre - 0.3 * r.thickness + 120) / 0.2), hi = Math.round((r.centre + 0.3 * r.thickness + 120) / 0.2);
    // (At 90 degrees a little phase is left, as with any large tip: the rephasing area that is
    // exact for small tips leaves about 0.1 rad per mm; at 15 degrees it is flat.)
    const flat = span(r.phase, lo, hi), wound = Math.abs(noRe.phase[hi] - noRe.phase[lo]);
    const flatSmall = span(small.phase, lo, hi);
    assert(flat < 0.6 && flatSmall < 0.05 && wound > 3 * flat, `phase span ${flat} (90°) and ${flatSmall} (15°) with the rephaser, ${wound} without`);
    notes.push(`Gz ${Gz}, bw ${bw} kHz: ${r.fwhm.toFixed(2)} mm at 90°, ${small.fwhm.toFixed(2)} at 15° (formula ${r.thickness.toFixed(2)})`);
  }
  // The pulse's flip angle: 2 pi integral of b1 dt = pi/2.
  const p = sincPulse(1.3, 3);
  let area = 0;
  for (const v of p.b1) area += v * p.dt;
  close(TWO_PI * area, Math.PI / 2, 1e-12, 'flip angle');
  return notes.join('; ');
});

test('one axis: the spectrum of the FID under a gradient is the profile of the sample, f = GB G x', () => {
  const blocks = [{ x: -40, w: 30, rho: 1 }, { x: 30, w: 15, rho: 1 }], G = 10, T2 = 40;
  const fmax = GB * G * 100, dt = 1 / (2.5 * fmax), n = 8192;
  const t = Float64Array.from({ length: n }, (_, i) => i * dt);
  const fid = blocksFID(blocks, G, T2, t);
  close(fid.re[0], 45, 1e-12, 's(0) = sum of rho w');
  const sp = spectrumOf(fid.re, fid.im, dt, 2048, fftCentered);
  // The absorption spectrum (the real part) is the profile: rho / (2 GB G) between
  // GB G (x -+ w/2) and ~0 outside (the tails of a Lorentzian 1/(pi T2) = 8 Hz wide).
  const xs = Float64Array.from(sp.f, (f) => f / (GB * G)), prof = blocksProfile(blocks, xs);
  const rho = Float64Array.from(sp.re, (v) => 2 * GB * G * v);
  let inside = 0, nIn = 0, outside = 0, nOut = 0;
  for (let m = 0; m < sp.M; m++) {
    const x = xs[m], nearEdge = blocks.some((b) => Math.abs(Math.abs(x - b.x) - b.w / 2) < 1.5);
    if (nearEdge) continue;
    if (prof[m] > 0) { inside += Math.abs(rho[m] - prof[m]); nIn++; } else if (Math.abs(x) < 100) { outside += Math.abs(rho[m]); nOut++; }
  }
  assert(inside / nIn < 0.03 && outside / nOut < 0.02, `inside ${inside / nIn}, outside ${outside / nOut}`);
  // The half-maximum points of the wide block's peak sit at its edges.
  const lo = sp.f.findIndex((f) => f / (GB * G) > -70), hi = sp.f.findIndex((f) => f / (GB * G) > -10);
  const seg = rho.subarray(lo, hi), fs = xs.subarray(lo, hi);
  close(fwhm(fs, seg), 30, 0.4, 'the width of the wide block from the spectrum');
  // Position from frequency: the two peaks' centres are GB G (70 mm) apart.
  const centroid = (a, b) => { let s = 0, w = 0; for (let m = a; m < b; m++) { s += rho[m] * sp.f[m]; w += rho[m]; } return s / w; };
  const mid = sp.f.findIndex((f) => f > 0), c1 = centroid(lo, mid), c2 = centroid(mid, sp.f.findIndex((f) => f / (GB * G) > 60));
  close((c2 - c1) / (GB * G), 70, 0.3, 'the distance between the pieces from the spectrum');
  return `the spectrum follows the profile to ${(inside / nIn).toFixed(3)} inside, ${(outside / nOut).toFixed(3)} outside; the pieces ${((c2 - c1) / (GB * G)).toFixed(1)} mm apart (70)`;
});

test('the sequences: k(t) runs through ky = GB Gy Tpe and sweeps kx across the readout, the echo at TE', () => {
  const notes = [];
  for (const type of ['gre', 'se']) {
    const seq = sequence({ type, TE: 20, TR: 500, N: 128, fov: 256, Gx: 10, Tpe: 1 });
    close(seq.Tro, 128 / 256 / (GB * 10), 1e-12, 'readout length');
    for (const q of [0, 20, 64, 100]) {
      const ky = seq.ky(q);
      close(GB * seq.Gy(q) * seq.Tpe, ky, 1e-12, 'ky from the lobe');
      const [kx0, ky0] = seq.kOf(q, seq.adc[0]), [kxE, kyE] = seq.kOf(q, seq.tEcho), [kx1, ky1] = seq.kOf(q, seq.adc[1]);
      close(kx0, -seq.N / 2 * seq.dk, 1e-9, 'kx at the start of the readout');
      close(kx1, seq.N / 2 * seq.dk, 1e-9, 'kx at its end');
      close(kxE, 0, 1e-9, 'kx = 0 at the echo');
      for (const v of [ky0, kyE, ky1]) close(v, ky, 1e-9, 'ky held through the readout');
    }
    if (type === 'se') {
      // Before the pi pulse the prephaser has taken kx to +kmax; the pulse turns it into -kmax.
      const before = seq.kOf(64, seq.t180 - 1e-6)[0], after = seq.kOf(64, seq.t180 + 1e-6)[0];
      close(before, seq.N / 2 * seq.dk, 1e-9, 'before the pi pulse');
      close(after, -seq.N / 2 * seq.dk, 1e-9, 'after it');
      close(seq.t180 - seq.t90, seq.TE / 2, 1e-12, 'the pi pulse at TE/2');
    }
    close(seq.tEcho - seq.t90, seq.TE, 1e-12, 'the readout centred at TE');
    notes.push(`${type}: Tro ${seq.Tro.toFixed(3)} ms, TEmin ${seq.TEmin.toFixed(2)} ms`);
  }
  // A TE below the minimum is raised to it.
  const s = sequence({ type: 'se', TE: 1 });
  close(s.TE, s.TEmin, 1e-12, 'TE raised');
  const o = lineOrder(8, 'centre');
  assert(o.join() === '4,3,5,2,6,1,7,0', `centre-out order ${o}`);
  assert(lineOrder(4, 'up').join() === '3,2,1,0', 'bottom-up order');
  return notes.join('; ');
});

test('phase encoding: under the Gy lobe the phase map winds stripes of period 1 / ky across y', () => {
  const seq = sequence({ type: 'gre', TE: 6, TR: 300, N: 64, fov: 256, Gx: 10, Tpe: 1 });
  const N = 64, dx = seq.fov / N, ys = Float64Array.from({ length: N }, (_, j) => (N / 2 - j) * dx);
  const s = new Spins(N);
  for (let j = 0; j < N; j++) s.y[j] = ys[j];
  s.reset();
  for (const q of [20, 32, 45]) {
    s.reset(); s.pulse(Math.PI / 2);
    const bp = seq.breakpoints(q);
    for (let i = 0; i + 1 < bp.length && bp[i] < seq.adc[0]; i++) { const [Gx, Gy] = seq.gradientsAt(q, bp[i] + 1e-9); s.precess(Math.min(bp[i + 1], seq.adc[0]) - bp[i], Gx, Gy); }
    // At the start of the readout: phase = -2 pi (kx y... no: kx x + ky y) with x = 0 here.
    const ky = seq.ky(q);
    let worst = 0;
    for (let j = 0; j < N; j++) {
      const want = -TWO_PI * ky * ys[j], d = Math.atan2(Math.sin(s.phase(j) - want), Math.cos(s.phase(j) - want));
      worst = Math.max(worst, Math.abs(d));
    }
    assert(worst < 1e-9, `row ${q}: phase off by ${worst}`);
    // The stripe period from the phase map: the phase advances 2 pi over 1/ky.
    if (ky !== 0) { const slope = (s.phase(N / 2 - 1) - s.phase(N / 2)) / dx; close(Math.abs(1 / (slope / TWO_PI)), 1 / Math.abs(ky), 1e-6, 'stripe period'); }
  }
  return `rows 20, 32, 45 of 64: the phase map's stripes are 1/ky = ${(1 / seq.ky(20)).toFixed(2)}, ∞, ${(1 / seq.ky(45)).toFixed(2)} mm apart`;
});

test('the weighting: (1 - e^{-TR/T1}) e^{-TE/T2} at 90 degrees; T2* for a gradient echo; the steady state', () => {
  const t = tissueAt('white', 1.5);
  close(weighting(t, { TR: 500, TE: 15, type: 'se' }), (1 - Math.exp(-500 / t.T1)) * Math.exp(-15 / t.T2), 1e-15, 'spin echo');
  const T2s = 1 / (1 / 90 + 1 / 40);
  close(weighting(t, { TR: 500, TE: 15, type: 'gre' }), (1 - Math.exp(-500 / t.T1)) * Math.exp(-15 / T2s), 1e-15, 'gradient echo');
  // The Ernst angle gives the most signal for a given TR.
  const E1 = Math.exp(-50 / t.T1), ernst = Math.acos(E1);
  const w = (a) => weighting(t, { TR: 50, TE: 2, type: 'gre', alpha: a });
  assert(w(ernst) > w(ernst - 0.2) && w(ernst) > w(ernst + 0.2), 'Ernst angle');
  close(steadyMz(t, { TR: 500 }), 1 - Math.exp(-500 / t.T1), 1e-15, 'steady Mz');
  // Contrast: T1-weighted makes fat brightest and CSF dark; T2-weighted makes CSF brightest.
  const sig = (seq) => Object.fromEntries(['water', 'fat', 'grey', 'white'].map((n) => [n, tissueAt(n).rho * weighting(tissueAt(n), seq)]));
  const t1w = sig({ TR: 500, TE: 15 }), t2w = sig({ TR: 3000, TE: 100 });
  assert(t1w.fat > t1w.white && t1w.white > t1w.grey && t1w.grey > t1w.water, `T1w: ${JSON.stringify(t1w)}`);
  assert(t2w.water > t2w.grey && t2w.grey > t2w.white, `T2w: ${JSON.stringify(t2w)}`);
  return `T1w (TR 500, TE 15): fat ${t1w.fat.toFixed(3)} > white ${t1w.white.toFixed(3)} > grey ${t1w.grey.toFixed(3)} > CSF ${t1w.water.toFixed(3)}; T2w (3000, 100): CSF ${t2w.water.toFixed(3)} > grey ${t2w.grey.toFixed(3)} > white ${t2w.white.toFixed(3)}`;
});

test('the phantom: rasterized fractions sum to at most 1 and keep each tissue\'s area', () => {
  const shapes = headPhantom(), N = 128, dx = 2, r = rasterize(shapes, N, N, dx, 4);
  let worst = 0;
  for (let i = 0; i < N * N; i++) { let s = 0; for (const f of Object.values(r.fills)) s += f[i]; worst = Math.max(worst, s - 1); }
  assert(worst < 1e-6, `fractions sum to ${1 + worst}`);
  // The lesion's area: an ellipse 12 x 9, nothing on top of it.
  let area = 0;
  for (const v of r.fills.lesion) area += v * dx * dx;
  close(area, Math.PI * 12 * 9, 0.02 * Math.PI * 12 * 9, 'lesion area');
  assert(tissueAtPoint(shapes, 38, -38) === 'lesion' && tissueAtPoint(shapes, 0, 0) === 'white' && tissueAtPoint(shapes, 0, 108) === 'fat' && tissueAtPoint(shapes, 0, 115) === null, 'tissueAtPoint');
  const d = disksPhantom();
  assert(d.length === 3 && tissueAtPoint(d, -45, 22) === 'water', 'the disks');
  return `the lesion's area ${area.toFixed(1)} mm² (π·12·9 = ${(Math.PI * 108).toFixed(1)})`;
});

test('full k-space gives back the weighted phantom to numerical precision', () => {
  const seq = sequence({ type: 'se', TE: 20, TR: 500, N: 128, fov: 256, Gx: 10 });
  const acq = new Acquisition().set({ shapes: headPhantom(), seq, B0: 1.5 });
  acq.measureAll();
  const img = acq.image();
  const { rms, max } = rmsDiff(img.mag, acq.picture.total);
  assert(rms < 1e-12 * max, `rms ${rms} of max ${max}`);
  let imag = 0;
  for (const v of img.im) imag = Math.max(imag, Math.abs(v));
  assert(imag < 1e-12 * max, `imaginary part ${imag}`);
  assert(!acq.picture.folded, 'the head fits the field of view');
  // Half the lines: the picture is blurred, not the same.
  acq.clear();
  for (const q of lineOrder(128, 'centre').slice(0, 32)) acq.measure(q);
  const part = rmsDiff(acq.image().mag, acq.picture.total);
  assert(part.rms > 1e-3 * max, `32 lines: rms ${part.rms}`);
  return `128 lines: rms ${(rms / max).toExponential(1)} of the brightest pixel; 32 central lines: ${(part.rms / max).toFixed(3)}`;
});

test('aliasing: with the field of view halved, what lies outside folds in, fov away', () => {
  // A small disk at y = 80 mm; the field of view 128 mm: it lands at 80 - 128 = -48 mm.
  const N = 64, fov = 128;
  const seq = sequence({ type: 'se', TE: 20, TR: 2000, N, fov, Gx: 10 });
  const shapes = [disk(0, 80, 10, 'water')];
  const acq = new Acquisition().set({ shapes, seq });
  acq.measureAll();
  const img = acq.image().mag, dx = fov / N;
  let sx = 0, sy = 0, w = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const v = img[j * N + i]; sx += v * (i - N / 2) * dx; sy += v * (N / 2 - j) * dx; w += v; }
  const x = sx / w, y = sy / w;
  assert(Math.abs(x) < 0.1 && Math.abs(y + 48) < 0.1, `the copy landed at (${x}, ${y})`);
  assert(acq.picture.folded, 'folded');
  // Its total brightness is the disk's (nothing is lost, only misplaced); and it is the same
  // picture as sampling the full field of view's k-space every other line.
  const big = sequence({ type: 'se', TE: 20, TR: 2000, N: 2 * N, fov: 2 * fov, Gx: 10 });
  const full = new Acquisition().set({ shapes, seq: big });
  full.measureAll();
  // Every other row of the big k-space (same dk*2 = 1/fov), the central N columns... the big
  // picture has pixels of the same size, so its k-space extends to the same kmax: take every
  // other row and every other column, times 2 for the unitary scaling.
  const re = new Float64Array(N * N), im = new Float64Array(N * N);
  for (let q = 0; q < N; q++) for (let p = 0; p < N; p++) { re[q * N + p] = 2 * full.kre[(2 * q) * 2 * N + 2 * p]; im[q * N + p] = 2 * full.kim[(2 * q) * 2 * N + 2 * p]; }
  const sub = reconstruct(re, im, N, new Uint8Array(N).fill(1));
  // (Every other column too: the x direction then also folds, but the disk is at x = 0.)
  const d = rmsDiff(sub.mag, img);
  assert(d.rms < 1e-10 * d.max, `subsampled big k-space differs by ${d.rms / d.max}`);
  return `the disk at y = 80 mm appears at y = ${y.toFixed(0)} mm with a 128 mm field of view (formula: −48)`;
});

test('the chemical shift: fat lands shifted along x by -3.4 ppm f0 / (GB Gx), the water stays', () => {
  const N = 64, fov = 128, Gx = 2;
  const seq = sequence({ type: 'se', TE: 20, TR: 2000, N, fov, Gx });
  const shapes = [disk(-30, 0, 12, 'water'), disk(30, 0, 12, 'fat')];
  const a = new Acquisition().set({ shapes, seq, B0: 1.5, chemicalShift: true }), b = new Acquisition().set({ shapes, seq, B0: 1.5 });
  a.measureAll(); b.measureAll();
  const want = -(3.4e-6 * 63.87e3) / (GB * Gx);
  close(a.fatShift, want, 0.01, 'the shift in mm');
  const dx = fov / N, cx = (img, x0) => { let s = 0, w = 0; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = (i - N / 2) * dx; if (Math.abs(x - x0) < 25) { s += img[j * N + i] * x; w += img[j * N + i]; } } return s / w; };
  const fatA = cx(a.image().mag, 30), fatB = cx(b.image().mag, 30), watA = cx(a.image().mag, -30), watB = cx(b.image().mag, -30);
  close(fatA - fatB, want, 0.15, 'fat moved (the shifted disk rings a little: it is not band-limited)');
  close(watA - watB, 0, 0.05, 'water stayed (to the ringing of the shifted fat)');
  return `at 1.5 T and Gx = ${Gx} mT/m fat moves ${(fatA - fatB).toFixed(2)} mm (formula ${want.toFixed(2)})`;
});

test('noise: sigma (of the brightest pixel) per channel in k-space is sigma per pixel in the picture; averaging divides it by sqrt(nsa)', () => {
  const N = 64, seq = sequence({ type: 'se', TE: 20, TR: 2000, N, fov: 128, Gx: 10 });
  const shapes = [disk(0, 0, 20, 'water')];
  const std = (nsa) => { const a = new Acquisition().set({ shapes, seq, sigma: 0.1, nsa, seed: 3 }); a.measureAll(); const img = a.image(); let s = 0, n = 0; for (let i = 0; i < N * N; i++) if (a.picture.total[i] === 0) { s += img.re[i] ** 2; n++; } return Math.sqrt(s / n) / a.peak; };
  const s1 = std(1), s4 = std(4);
  close(s1, 0.1, 0.012, 'sigma in the picture');
  close(s4, 0.05, 0.008, 'four averages');
  const nf = noiseField(16, 1, 5), nf2 = noiseField(16, 1, 5);
  assert(nf.re[3] === nf2.re[3], 'seeded');
  return `background noise ${s1.toFixed(3)} with one average, ${s4.toFixed(3)} with four`;
});

test('Lauterbur: projections under a turned gradient, back-projected with the ramp, give the picture back', () => {
  const N = 64, fov = 128, dx = fov / N;
  const seq = sequence({ type: 'se', TE: 20, TR: 2000, N, fov, Gx: 10 });
  const pic = pictureOf(disksPhantom().map((d) => ({ ...d, x: d.x / 2, y: d.y / 2, a: d.a / 2, b: d.b / 2 })), seq, 1.5, N, fov);
  // A projection at 0 is the column sums; at 90 degrees the row sums.
  const p0 = projection(pic.total, N, N, dx, 0, N, dx), p90 = projection(pic.total, N, N, dx, Math.PI / 2, N, dx);
  let worst = 0;
  for (let i = 1; i < N - 1; i++) {
    let col = 0, row = 0;
    for (let j = 0; j < N; j++) { col += pic.total[j * N + i] * dx; row += pic.total[(N - i) * N + j] * dx; }
    worst = Math.max(worst, Math.abs(p0[i] - col), Math.abs(p90[i] - row));
  }
  assert(worst < 1e-9, `projections along the axes off by ${worst}`);
  const angles = Float64Array.from({ length: 90 }, (_, j) => (j * Math.PI) / 90);
  const pr = projections(pic.total, N, dx, angles, 5);
  // The projector used for this (Joseph's) agrees with the exact sums along the axes.
  let ax = 0;
  for (let k = 1; k < N - 1; k++) ax = Math.max(ax, Math.abs(pr.profiles[0][k] - p0[k]), Math.abs(pr.profiles[45][k] - p90[k]));
  assert(ax < 1e-9, `Joseph's projections along the axes off by ${ax}`);
  const bp = backprojection(pr.profiles, angles, N, dx, true);
  const d = rmsDiff(bp.filtered, pic.total);
  assert(d.rms < 0.06 * d.max, `filtered back-projection rms ${d.rms / d.max}`);
  const u = rmsDiff(bp.unfiltered, pic.total);
  assert(u.rms > d.rms, 'unfiltered is blurred');
  close(pr.fOfS(10), GB * 5 * 10, 1e-12, 'frequency of position');
  return `90 angles: filtered back-projection within ${(d.rms / d.max * 100).toFixed(1)}% rms of the picture`;
});

test('the spectrum of a sampled FID (spectrumOf): one point at x gives a Lorentzian at f = GB G x, of height T2 s(0) and area s(0)/2', () => {
  const G = 5, x = 20, T2 = 20, dt = 0.02, n = 8192, t = Float64Array.from({ length: n }, (_, i) => i * dt);
  const fid = blocksFID([{ x, w: 1e-6, rho: 1e6 }], G, T2, t);   // (a point: rho w = 1)
  const sp = spectrumOf(fid.re, fid.im, dt, 4096, fftCentered);
  let m = 0;
  for (let i = 1; i < sp.M; i++) if (sp.re[i] > sp.re[m]) m = i;
  close(sp.f[m], GB * G * x, sp.df, 'the line at +GB G x');
  close(sp.re[m], T2, 0.02 * T2, 'its height T2 s(0) (per kHz)');
  let area = 0;
  for (let i = 0; i < sp.M; i++) area += sp.re[i] * sp.df;
  close(area, 0.5, 0.01, 'the absorption\'s area, s(0)/2');
  close(fwhm(sp.f, sp.re) * 1000, 1000 / (Math.PI * T2), 2, 'its width 1/(pi T2) in Hz');
  return `the line at ${(sp.f[m] * 1000).toFixed(0)} Hz (GB G x = ${(GB * G * x * 1000).toFixed(0)}), ${(fwhm(sp.f, sp.re) * 1000).toFixed(1)} Hz wide (1/πT2 = ${(1000 / (Math.PI * T2)).toFixed(1)})`;
});

test('the spectrum of the record so far: the whole record gives the profile; a taper keeps the area', () => {
  const G = 2, T = 0.25 / (GB * G), n = 257, t = Float64Array.from({ length: n }, (_, i) => (i * T) / (n - 1));
  const blocks = [{ x: -12, w: 12, rho: 1 }, { x: 10, w: 6, rho: 1 }];
  const fid = blocksFID(blocks, G, 1e9, t);
  const xs = [-18, -12, -6.5, 0, 10, 20], fs = Float64Array.from(xs, (x) => GB * G * x);
  const S = partialSpectrum(t, fid.re, fid.im, T, fs, 0.3), rho = Array.from(S.re, (v) => 2 * GB * G * v);
  // Inside the tubes about 1, outside about 0, and half way at an edge (x = -6.5 is 0.5 mm in).
  assert(Math.abs(rho[1] - 1) < 0.08 && Math.abs(rho[4] - 1) < 0.12 && Math.abs(rho[3]) < 0.05 && Math.abs(rho[5]) < 0.05, `profile ${rho.map((v) => v.toFixed(3))}`);
  // The area of the absorption is s(0)/2, with or without the taper, at any moment.
  const f = Float64Array.from({ length: 4001 }, (_, i) => -40 + i * 0.02);
  for (const [tNow, taper] of [[T, 0], [T, 0.3], [T / 3, 0.3]]) {
    const P = partialSpectrum(t, fid.re, fid.im, tNow, f, taper);
    let area = 0;
    for (const v of P.re) area += v * 0.02;
    close(area, 18 / 2, 0.15, `area at t = ${tNow.toFixed(2)}, taper ${taper}`);
  }
  // No jump as the moment passes a sample.
  const a = partialSpectrum(t, fid.re, fid.im, t[40] - 1e-9, fs).re[0], b = partialSpectrum(t, fid.re, fid.im, t[40] + 1e-9, fs).re[0];
  close(a, b, 1e-6, 'continuity');
  return `ρ from the spectrum: ${rho.map((v) => v.toFixed(2)).join(', ')} at x = ${xs.join(', ')} mm`;
});

test('Lorentzian offsets dephase spins as exp(-t / T2prime)', () => {
  const o = lorentzOffsets(200000, 20, 9);
  for (const t of [5, 20, 40]) {
    let sr = 0;
    for (const df of o) sr += Math.cos(TWO_PI * df * t);
    close(sr / o.length, Math.exp(-t / 20), 0.03, `at t = ${t}`);
  }
});

test('slice movie: seen from the slab\'s frame it ends along x\', in step with the lobe and twisted without', () => {
  const zs = Float64Array.from({ length: 501 }, (_, i) => -125 + 0.5 * i), notes = [];
  for (const fc of [0, -6.47, 3]) {
    const coh = (rephase) => {
      const m = sliceMovie({ Gz: 4, bw: 1.5, T: 3, fc, rephase, zs }), L = m.mx.length - 1;
      let sr = 0, si = 0, sm = 0;
      for (let i = 0; i < zs.length; i++) { sr += m.mx[L][i]; si += m.my[L][i]; sm += Math.hypot(m.mx[L][i], m.my[L][i]); }
      const k = Math.round((m.centre + 125) / 0.5);
      return { c: Math.hypot(sr, si) / sm, phase: Math.atan2(m.my[L][k], m.mx[L][k]), centre: m.centre };
    };
    const a = coh(true), b = coh(false);
    assert(Math.abs(a.phase) < 0.02 && a.c > 0.94 && b.c < 0.05, `fc ${fc}: phase ${a.phase}, coherent ${a.c} with the lobe, ${b.c} without`);
    notes.push(`z0 = ${a.centre.toFixed(1)} mm: ${(100 * a.c).toFixed(1)}% in step with the lobe, ${(100 * b.c).toFixed(1)}% without`);
  }
  // Its first frame is at rest and its last is the profile of sliceProfile.
  const m = sliceMovie({ Gz: 6, bw: 1.3, T: 3, zs: Float64Array.from({ length: 1201 }, (_, i) => -120 + 0.2 * i), flip: 15 * Math.PI / 180 });
  assert(m.mz[0].every((v) => v === 1), 'at rest');
  const L = m.mx.length - 1, mxy = Float64Array.from(m.mx[L], (v, i) => Math.hypot(v, m.my[L][i]));
  close(fwhm(m.zs, mxy), m.thickness, 0.03 * m.thickness, 'the movie\'s slab at 15°');
  // The pulse's spectrum is a box of width bw: half height at the edges.
  const sp = pulseSpectrum(sincPulse(1.5, 3), Float64Array.of(0, 0.75, 1.5));
  assert(Math.abs(sp[1] / sp[0] - 0.5) < 0.05 && sp[2] / sp[0] < 0.05, `the band's edge ${sp[1] / sp[0]}, beyond ${sp[2] / sp[0]}`);
  return notes.join('; ');
});

test('the sequence plays its parts in turn; TE_min; the pi pulse makes the dephasing time zero at the echo', () => {
  for (const type of ['se', 'gre']) {
    const q = sequence({ type, TE: 1, N: 64, fov: 256, Gx: 2, Tpe: 2, Trf: 3 });
    assert(q.gyStart >= 1.5 * q.Trf - 1e-12 && q.preStart === q.gyStart + q.Tpe && q.preEnd <= q.adc[0] + 1e-9, `order ${q.gyStart}, ${q.preStart}, ${q.preEnd}, ${q.adc[0]}`);
    const want = type === 'se' ? 3 * q.Trf + 2 * q.Tpe + q.Tro : q.Trf + q.Tpe + q.Tro;
    close(q.TEmin, want + 0.05, 1e-9, `${type} TE_min`);
    // With phase encoding only (before the prephaser), k is (0, ky) for a gradient echo, (0, -ky) for a spin echo.
    const [kx, ky] = q.kOf(20, q.preStart);
    close(kx, 0, 1e-12, 'kx after the phase-encoding lobe');
    close(ky, (type === 'se' ? -1 : 1) * q.ky(20), 1e-12, 'ky after the phase-encoding lobe');
    close(q.dephaseTime(q.tEcho), type === 'se' ? 0 : q.TE, 1e-12, 'dephasing time at the echo');
  }
});

test('the live spins: the echo is their sum; a spin echo refocuses an uneven field, a gradient echo does not', () => {
  const shapes = headPhantom(), notes = [];
  for (const type of ['se', 'gre']) {
    const q = sequence({ type, TE: 20, TR: 500, N: 32, fov: 256, Gx: 2, Tpe: 2, Trf: 3, T2prime: 8 });
    const sp = spinsOf(shapes, q, 1.5, 64, 256), ts = traceTimes(q), tr = echoTrace(sp, q, 16, ts);
    const iE = ts.findIndex((t) => Math.abs(t - q.tEcho) < 1e-9);
    const echo = Math.hypot(tr.re[iE], tr.im[iE]);
    // The same from the phase map at that moment.
    const re = new Float64Array(64 * 64), im = new Float64Array(64 * 64);
    phaseMap(sp, q, 16, q.tEcho, re, im);
    let sr = 0, si = 0, sm = 0;
    for (let i = 0; i < re.length; i++) { sr += re[i]; si += im[i]; sm += sp.m[i]; }
    close(Math.hypot(sr, si) / sm, echo, 1e-9, `${type}: the phase map's sum`);
    if (type === 'se') close(echo, 1, 1e-9, 'the spin echo, all back in step');
    else assert(Math.abs(echo - Math.exp(-20 / 8)) < 0.03, `the gradient echo ${echo} against exp(-TE/T2') = ${Math.exp(-20 / 8)}`);
    // Just after the pulse they are all in step.
    close(Math.hypot(tr.re[0], tr.im[0]), 1, 1e-9, 'just after the pulse');
    notes.push(`${type}: echo ${echo.toFixed(3)}`);
  }
  return notes.join(', ') + ` (exp(−TE/T₂′) = ${Math.exp(-20 / 8).toFixed(3)})`;
});

test('the head in three dimensions: its middle slice is the picture of before; the eyes are low in front', () => {
  const h = head3D(), mid = sliceOf(h, 0), flat = headPhantom();
  assert(mid.length === flat.length && mid.every((e, i) => e.a === flat[i].a && e.tissue === flat[i].tissue), 'z = 0');
  assert(tissueAt3D(h, 30, 74, -38) === 'water' && sliceOf(h, -38).some((e) => e.y === 74) && !mid.some((e) => e.y === 74), 'the eyes');
  assert(tissueAt3D(h, 0, 0, 125) === null && sliceOf(h, 130).length === 0, 'above the head');
  // A 180 mm field of view folds the back of the head (y = -110 to -104 mm) to +70 to +76 mm.
  const q = sequence({ type: 'se', TE: 15, TR: 500, N: 128, fov: 180, Gx: 4, Tpe: 1, Trf: 2 }), pic = pictureOf(h.length ? flat : flat, q, 1.5, 128, 180);
  assert(pic.folded, 'folded');
  const dx = 180 / 128, col = 64, bright = [];
  for (let j = 0; j < 128; j++) if (pic.total[j * 128 + col] > 0.5) bright.push((128 / 2 - j) * dx);
  assert(bright.some((y) => y > 69 && y < 77) && bright.some((y) => y < -69 && y > -77), `bright rows at ${bright.map((y) => y.toFixed(1))}`);
  return `fat at x = 0 with a 180 mm field of view: ${bright.map((y) => y.toFixed(1)).join(', ')} mm`;
});
